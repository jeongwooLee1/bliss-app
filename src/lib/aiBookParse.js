/**
 * aiBookParse.js — AI Book 자연어 예약 파서
 *
 * 자연어 텍스트(또는 이미지/음성)를 받아 Gemini로 파싱 → 구조화된 예약 정보 반환
 * QuickBookModal과 BlissAI(create_reservation 액션)에서 공통 사용
 */

import { sb, buildTokenSearch } from './sb'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// AI Book 파싱 결과로 기존 고객 찾기 (부분 검색 포함) + ps 정보 보강
// 매칭 정책:
//   1) phone/email 정확 일치 (가장 신뢰도 높음)
//   2) 이름·전화(부분포함) 토큰 AND ilike (예: "정우 8008", "박성진 6262")
//   매칭 시 ps의 빈 필드(이름·전화·이메일·성별)를 매칭 고객 정보로 채워줌
// rawInput: 사용자 원문 — AI 파서가 부분 전화(4자리 등)를 무시했을 때 직접 추출용
// 반환: { custId | null, matched: customer | null }
export async function findCustomerForBooking(ps, bizId, rawInput) {
  if (!ps || !bizId) return { custId: null, matched: null }
  const phone = String(ps.custPhone || '').replace(/[^0-9+]/g, '')
  const email = String(ps.custEmail || '').trim().toLowerCase()
  const name = String(ps.custName || '').trim()
  // rawInput에서 4자리 이상 숫자 시퀀스 추출 (AI 파서가 부분 전화 무시 케이스 대비)
  // 시간 표현(8시, 14시 등)은 1-2자리라 4자리+ 필터로 자연스럽게 제외됨
  // 시간/년월일/dur 등 4자리 가능 케이스: 2026, 1430(시:분 합본 드물지만 가능), 50분(2자리), 90분(2자리), 35분
  // → 4자리 이상이면서 ps.date/time/dur과 일치하지 않는 것만 phone 토큰 후보로
  const phoneDigitTokens = []
  if (rawInput) {
    const digitMatches = String(rawInput).match(/\d{4,}/g) || []
    const dateDigits = String(ps.date || '').replace(/-/g, '')
    const timeDigits = String(ps.time || '').replace(/:/g, '')
    const durStr = String(ps.dur || '')
    digitMatches.forEach(d => {
      // ps.date(YYYYMMDD), ps.time(HHMM), 이미 ps.custPhone에 있는 것 제외
      if (d === dateDigits || d === timeDigits || d === durStr) return
      if (phone && phone.includes(d)) return // 이미 phone에 포함됨
      // 연도(2026) 등 자주 등장하는 4자리 제외
      if (/^(19|20)\d{2}$/.test(d) && d.length === 4) return
      phoneDigitTokens.push(d)
    })
  }
  // 매칭된 고객 정보로 ps 덮어쓰기 (부분 입력 → 정확한 전체 정보로 교정)
  // 단 외부에서 명시적으로 채워진 이메일·성별은 보존 (드물게 다른 값 가능)
  // phone 비어있으면 phone2 사용 (일부 고객은 보조번호에만 정확한 번호 저장)
  const enrichFromMatched = (m) => {
    if (m.name) ps.custName = m.name
    const fullPhone = m.phone || m.phone2 || ''
    if (fullPhone) ps.custPhone = fullPhone
    if (m.email && !ps.custEmail) ps.custEmail = m.email
    if (m.gender && !ps.custGender) ps.custGender = m.gender
  }
  // Step 1: 정확 일치
  if (phone || email) {
    const orParts = []
    if (phone) {
      const dashed = phone.length === 11 ? `${phone.slice(0,3)}-${phone.slice(3,7)}-${phone.slice(7)}` : phone
      orParts.push(`phone.eq.${phone}`, `phone.eq.${dashed}`, `phone2.eq.${phone}`, `phone2.eq.${dashed}`)
    }
    if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)
    if (orParts.length) {
      try {
        const found = await sb.get('customers', `&business_id=eq.${bizId}&or=(${orParts.join(',')})&limit=5`)
        if (Array.isArray(found) && found.length > 0) {
          enrichFromMatched(found[0])
          return { custId: found[0].id, matched: found[0] }
        }
      } catch {}
    }
  }
  // Step 2: 부분 일치 (이름 + 전화 + rawInput에서 추출한 숫자 토큰 AND ilike)
  if (name || phone || phoneDigitTokens.length > 0) {
    const tokens = []
    if (name) tokens.push(name)
    if (phone) tokens.push(phone)
    // rawInput 숫자 토큰 (4자리+) — 동명이인 식별에 결정적
    phoneDigitTokens.forEach(t => { if (!tokens.includes(t)) tokens.push(t) })
    const cond = buildTokenSearch(tokens.join(' '), ['name', 'name2', 'phone', 'phone2', 'email'])
    if (cond) {
      try {
        const found = await sb.get('customers', `&business_id=eq.${bizId}${cond}&limit=10`)
        if (Array.isArray(found) && found.length > 0) {
          let pick = found[0]
          if (ps.custGender) {
            const same = found.find(c => (c.gender || '').toUpperCase() === ps.custGender.toUpperCase())
            if (same) pick = same
          }
          enrichFromMatched(pick)
          return { custId: pick.id, matched: pick }
        }
      } catch {}
    }
  }
  return { custId: null, matched: null }
}

// 자연어 파싱 결과(ps)와 매칭 고객으로 취소 대상 예약 찾기
// 우선순위: cust_id 일치 > (cust_phone OR cust_name) 일치
// 추가 필터: 날짜·시간 (있을 경우)
// 반환: 매칭된 reservations 배열 (status가 cancelled/completed가 아닌 것만)
export async function findReservationsToCancel(ps, custId, bizId) {
  if (!bizId) return []
  const filters = [`business_id=eq.${bizId}`, `status=in.(reserved,confirmed,pending,request)`]
  // 1) cust_id 우선
  if (custId) {
    filters.push(`cust_id=eq.${custId}`)
  } else {
    // 2) cust_phone OR cust_name 부분 일치
    const phone = String(ps.custPhone || '').replace(/[^0-9+]/g, '')
    const name = String(ps.custName || '').trim()
    const orParts = []
    if (phone) {
      orParts.push(`cust_phone.ilike.*${encodeURIComponent(phone)}*`)
    }
    if (name) {
      orParts.push(`cust_name.ilike.*${encodeURIComponent(name)}*`)
    }
    if (orParts.length === 0) return []
    filters.push(`or=(${orParts.join(',')})`)
  }
  // 날짜 필터 (있으면)
  if (ps.date) filters.push(`date=eq.${ps.date}`)
  // 시간 필터 (있으면, ±10분 여유)
  // 정확 매칭 우선이지만 다른 시간도 보여주기 위해 일단 날짜만 적용
  const filter = '&' + filters.join('&')
  try {
    const rows = await sb.get('reservations', `${filter}&order=date.desc,time.desc&limit=20`)
    if (!Array.isArray(rows)) return []
    // 시간 필터 (있으면 클라이언트 사이드)
    let result = rows
    if (ps.time) {
      const [hh, mm] = String(ps.time).split(':').map(Number)
      const targetMin = hh * 60 + mm
      result = rows.filter(r => {
        if (!r.time) return false
        const [rh, rm] = String(r.time).split(':').map(Number)
        const rMin = rh * 60 + rm
        return Math.abs(rMin - targetMin) <= 30 // 30분 여유
      })
      // 시간 필터로 빈 결과면 전체 반환 (사용자가 보고 판단하도록)
      if (result.length === 0) result = rows.slice(0, 5)
    }
    return result
  } catch (e) {
    console.warn('[findReservationsToCancel] 검색 실패:', e?.message)
    return []
  }
}

// 프롬프트 빌더 — data(서비스/태그/지점/예약경로)를 컨텍스트로 주입
export function buildAiBookPrompt(data) {
  const today = new Date(), dow = ['일','월','화','수','목','금','토']
  const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')} (${dow[today.getDay()]})`
  const tags = (data?.serviceTags || []).filter(t => t.useYn !== false && t.scheduleYn !== 'Y')
  const svcs = (data?.services || []).filter(s => s.useYn !== false)
  const tagList = tags.map(t => `"${t.id}":"${t.name}"${t.dur ? `(${t.dur}분)` : ''}`).join(', ')
  const svcList = svcs.map(s => `"${s.id}":"${s.name}"${s.dur ? `(${s.dur}분)` : ''}`).join(', ')
  const srcList = (data?.resSources || []).filter(s => s.useYn !== false).map(s => s.name)
  const branchList = (data?.branches || []).filter(b => b.useYn !== false).map(b => b.short || b.name)
  // AI 커스텀 규칙
  let aiRules = []
  try { aiRules = JSON.parse(localStorage.getItem('bliss_ai_rules') || '[]') } catch {}
  const rulesBlock = aiRules.length > 0 ? '\n[추가 판단 규칙]\n' + aiRules.map((r,i) => `${i+1}. ${r}`).join('\n') : ''

  return `당신은 미용실/왁싱샵 예약 정보를 추출하는 AI입니다.
오늘 날짜: ${ds}

아래 텍스트/이미지/음성에서 예약 정보를 추출해 JSON으로만 응답하세요.
마크다운 백틱이나 설명 없이 순수 JSON만 출력하세요.

[이미지] 채팅 앱 스크린샷 분석 시 반드시 다음 순서로 처리:
1단계: 화면 최상단 헤더 영역에서 전화번호/이름을 먼저 추출
2단계: 대화 내용에서 날짜, 시간, 시술 정보 추출
3단계: 앱 종류 판별
※ 헤더의 전화번호가 고객 전화번호입니다.

[이미지 - 크림POS/예약관리 시스템 스크린샷인 경우]
- 화면에 체크박스(□/☑)가 있는 항목들이 보입니다. 체크(☑)된 항목만 예약 정보에 반영하세요. 체크 안 된(□) 항목은 완전히 무시하세요.
- 예약메모(텍스트 입력 영역)에서 실제 시술 내용과 특이사항을 추출하세요.
- 메모에 "X" 또는 "×" 표시가 붙은 항목은 해당 시술을 하지 않는다는 의미입니다. (예: "에너지테라피 ×" → 에너지테라피 선택하지 마세요)

[음성] 오디오 첨부 시 음성을 듣고 추출. 공=0,일=1,이=2,삼=3,사=4,오=5,육=6,칠=7,팔=8,구=9. 공일공=010.

[등록된 서비스태그] {${tagList || '없음'}}
[등록된 시술상품] {${svcList || '없음'}}
[등록된 예약경로] [${srcList.length ? srcList.map(s => `"${s}"`).join(',') : '없음'}]
[등록된 지점] [${branchList.length ? branchList.map(s => `"${s}"`).join(',') : '없음'}]

[태그 선택 규칙 - 매우 중요]
- 체크박스가 있는 항목: 체크(☑)된 것만 태그로 선택. 체크 안 된 것은 절대 선택 금지.
- 체크박스가 없는 항목: 메모에 직원이 명시적으로 언급한 경우만 선택.
- "신규", "예약금완료" 태그는 절대 선택 금지 (시스템 자동 처리)
- "주차" 태그는 고객이 직접 주차를 요청한 경우에만
- 확실하지 않으면 선택하지 마세요

[시술상품 선택 규칙]
- 메모에서 실제 시술 부위/시술명을 찾아 매칭
[왁싱 용어 매핑] 음모왁싱=브라질리언, eyebrows=눈썹, underarm=겨드랑이, leg=다리, arm=팔, bikini=비키니, full body=전신
- '재방문', '신규', '이벤트' 단독은 시술이 아닙니다
${rulesBlock}

추출 항목:
- custName: 고객 이름 (없으면 "")
- custPhone: 전화번호 (010-XXXX-XXXX. 해외번호 원본유지)
- custEmail: 이메일 (예약자 이메일 @ 포함. 없으면 "")
- date: YYYY-MM-DD
- time: HH:MM 24시간
- dur: 소요시간(분) (없으면 0)
- memo: 직원이 반드시 알아야 할 특이사항/주의사항. 시술명/지점명/날짜/연락처/시간은 넣지 마세요. 특이사항이 없으면 ""
- branch: 지점명 (강남점/홍대점 등 등록된 지점에서 매칭. 없으면 "")
- source: 예약경로 (등록된 목록에서만 선택. 명시적 언급만. 없으면 "")
- custGender: "M" or "F" or ""
- externalPlatform: 외부 예약 플랫폼명 (없으면 "")
- externalPrepaid: 외부 선결제 금액(숫자, 원 단위). 없으면 0
- matchedTagIds: 매칭된 서비스태그 ID 배열. 없으면 []
- matchedServiceIds: 매칭된 시술상품 ID 배열. 없으면 []`
}

// 자연어 → 구조화 예약 정보
// opts: { text?, imgData?, audioData? } - 최소 하나 필요
// returns: parsed JSON object
export async function parseBookingWithAI(opts, data, apiKey) {
  if (!apiKey) throw new Error('Gemini API 키가 필요합니다 (관리설정 → AI 설정)')
  const text = (opts?.text || '').trim()
  const imgData = opts?.imgData
  const audioData = opts?.audioData
  if (!text && !imgData && !audioData) throw new Error('텍스트/이미지/음성 중 하나는 입력해야 합니다')

  const parts = [{ text: buildAiBookPrompt(data) }]
  if (text) parts.push({ text: '입력:\n' + text })
  if (imgData) parts.push({ inlineData: { mimeType: imgData.mimeType, data: imgData.base64 } })
  if (audioData) parts.push({ inlineData: { mimeType: audioData.mimeType, data: audioData.base64 } })

  const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } }),
  })
  if (!r.ok) throw new Error('Gemini API 실패: ' + (await r.text()).slice(0, 120))
  const d = await r.json()
  const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}
