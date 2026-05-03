/**
 * FloatingAI.jsx — 화면 우상단 플로팅 AI 도우미
 * 단순 1세션, 컨텍스트(FAQ/지점/시술/가격) 자동 주입, Gemini 호출
 */
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { genId } from '../../lib/utils'
import { buildFullPrompt } from './contextBuilder'
import { searchDocs, buildDocsContext } from '../../lib/aiDocs'
import { buildWriteIntentPrompt, ACTION_SCHEMAS } from './actionSchemas'
import { validateAction, buildPreview, executeAction } from './actionRunner'
import { parseBookingWithAI, findCustomerForBooking, findReservationsToCancel } from '../../lib/aiBookParse'
import ActionConfirmCard from './ActionConfirmCard'

const CLAUDE_URL = 'https://blissme.ai/bliss-ai-chat'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const STORAGE_KEY = 'bliss_floating_ai_v3'

// Typebot 스타일 인사말 — 3개 버블이 순차적으로 등장
const GREETING_BUBBLES = [
  '안녕하세요 👋',
  '블리스 AI에요.',
  '무엇을 도와드릴까요?',
]

// "모른다" 패턴 — AI 답변에 이런 표현이 보이면 unknown question 요청사항으로 자동 등록
const UNKNOWN_PATTERNS = [
  /FAQ에 등록된 내용이 없/,
  /정확히 안내드리기 어려/,
  /모르겠습니다/,
  /확실하지 않/,
  /해당 정보가 없/,
  /등록되어 있지 않/,
  /확인이 어려/,
  /담당자[에게]?\s*(직접\s*)?문의/,
  /대표[에게]?\s*(직접\s*)?문의/,
  /담당자[에게]?\s*확인/,
  /관리자[에게]?\s*문의/,
  /I don'?t (know|have)/i,
]
function detectUnknown(answer) {
  const t = String(answer || '')
  return UNKNOWN_PATTERNS.some(re => re.test(t))
}
async function logUnknownAsRequest({ question, answer, currentUser }) {
  try {
    const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }
    // 기존 목록 가져오기
    const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.bliss_requests_v1&select=value`, { headers: H })
    const rows = await r.json()
    const v = rows?.[0]?.value
    const list = (() => { try { return typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : []); } catch { return []; } })()
    // 같은 질문이 최근 3일 내 이미 등록되어 있으면 스킵 (중복 방지)
    const cutoff = Date.now() - 3 * 24 * 3600 * 1000
    const dup = list.find(x => x._aiQuestion === question && new Date(x.createdAt || 0).getTime() > cutoff)
    if (dup) return
    const newReq = {
      id: genId(),
      name: 'AI 자동 등록 — ' + (currentUser?.name || '사용자'),
      branchId: '',
      description: `[AI가 답변하지 못한 질문]\n\nQ: ${question}\n\nAI 응답:\n${(answer || '').slice(0, 500)}\n\n→ FAQ·정책·매장 데이터로 답변할 수 있도록 보강이 필요합니다.`,
      imageData: '',
      status: 'pending',
      reply: '',
      createdAt: new Date().toISOString(),
      _aiQuestion: question,
      _autoAi: true,
    }
    const next = [newReq, ...list]
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'bliss_requests_v1', key: 'bliss_requests_v1', value: JSON.stringify(next) }),
    })
  } catch (e) { /* ignore */ }
}

// Typebot 스타일 — 잠깐 "…" 타이핑 점 애니메이션 후 메시지 통째로 fade-in
function Typewriter({ text }) {
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setRevealed(false)
    // 천천히 — 짧은 메시지 1200ms, 긴 메시지 최대 3600ms (이전 대비 2x)
    const delay = Math.min(3600, Math.max(1200, (text?.length || 0) * 28))
    const id = setTimeout(() => setRevealed(true), delay)
    return () => clearTimeout(id)
  }, [text])
  if (!revealed) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED', opacity: 0.7, animation: 'tbDot 1.2s infinite', animationDelay: '0s' }}/>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED', opacity: 0.7, animation: 'tbDot 1.2s infinite', animationDelay: '0.2s' }}/>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED', opacity: 0.7, animation: 'tbDot 1.2s infinite', animationDelay: '0.4s' }}/>
    </span>
  }
  return <span style={{ animation: 'tbFadeIn .35s ease-out' }}>{text}</span>
}

const greeting = () => ({
  role: 'assistant',
  text: `안녕하세요, 블리스 AI에요. 무엇을 도와드릴까요? 🙂`,
  at: Date.now(),
  _typewriter: true,
})


export default function FloatingAI({ data, currentUser, isMaster, bizId }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {}
    return [] // 비어있으면 open 시 useEffect가 GREETING_BUBBLES 순차 추가
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [attachedImage, setAttachedImage] = useState(null) // {base64, mimeType, preview}
  const [recording, setRecording] = useState(false)
  const listRef = useRef(null)
  const fileRef = useRef(null)
  const recogRef = useRef(null)

  // 이미지 첨부
  const onPickImage = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 4 * 1024 * 1024) { setError('이미지는 4MB 이하로 첨부해주세요.'); return }
    const r = new FileReader()
    r.onload = () => {
      const data = r.result
      const base64 = String(data).split(',')[1]
      setAttachedImage({ base64, mimeType: f.type || 'image/png', preview: data })
      setError('')
    }
    r.readAsDataURL(f)
    e.target.value = ''
  }

  // Web Speech API 음성 → 텍스트
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('이 브라우저는 음성 입력을 지원하지 않습니다 (Chrome 권장).'); return }
    if (recording) {
      try { recogRef.current?.stop() } catch {}
      return
    }
    const r = new SR()
    r.lang = 'ko-KR'
    r.continuous = false
    r.interimResults = false
    r.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript || ''
      if (transcript) setInput(prev => prev ? prev + ' ' + transcript : transcript)
    }
    r.onerror = (e) => { setError('음성 인식 오류: ' + (e.error || '알 수 없음')); setRecording(false) }
    r.onend = () => setRecording(false)
    recogRef.current = r
    setRecording(true)
    r.start()
  }

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))) } catch {}
  }, [messages])
  // 열릴 때마다 사용자 메시지가 없으면 인사말 버블을 처음부터 순차 재생 (Typebot 스타일)
  useEffect(() => {
    if (!open) return
    const hasUserMsg = messages.some(m => m.role === 'user')
    if (hasUserMsg) return // 이미 대화 중 — 그대로 둠
    setMessages([]) // 캐시된 인사말 클리어
    const timers = []
    GREETING_BUBBLES.forEach((text, i) => {
      timers.push(setTimeout(() => {
        setMessages(prev => [...prev, { role: 'assistant', text, at: Date.now() + i, _typewriter: true, _greeting: true }])
      }, i * 2200))
    })
    return () => timers.forEach(t => clearTimeout(t))
  }, [open])
  useEffect(() => {
    if (!listRef.current) return
    // 창 열림/메시지 변경 시 맨 아래로 — DOM mount/typewriter 대비 RAF 2회
    const scroll = () => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }
    scroll()
    requestAnimationFrame(() => { scroll(); requestAnimationFrame(scroll) })
  }, [messages, open])

  // 마크다운 sanitize — **볼드**, *이탤릭*, # 헤더, --- 구분선 등 제거 (평문화)
  const _sanitize = (s) => String(s || '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')      // **볼드**
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1') // *이탤릭*
    .replace(/^#{1,6}\s+/gm, '')               // # 헤더
    .replace(/^>\s+/gm, '')                    // > 인용
    .replace(/^---+$/gm, '')                   // --- 구분선
    .replace(/`([^`\n]+)`/g, '$1')             // `코드`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [텍스트](url)

  const faqItems = useMemo(() => {
    try {
      const biz = (data?.businesses || [])[0]
      const s = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : (biz?.settings || {})
      return Array.isArray(s?.ai_faq) ? s.ai_faq : []
    } catch { return [] }
  }, [data?.businesses])

  const geminiKey = useMemo(() => {
    return window.__systemGeminiKey
      || window.__geminiKey
      || (() => { try { return JSON.parse((data?.businesses?.[0]?.settings) || '{}').gemini_key || '' } catch { return '' } })()
      || localStorage.getItem('bliss_gemini_key')
      || ''
  }, [data?.businesses])

  // 모델 호출 — 기본 Gemini Flash (이미지 첨부 시 무조건 Gemini), smart=true면 Claude Sonnet 4.5
  const callAI = async (prompt, { smart = false, image = null } = {}) => {
    const histTurns = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10)
      .map(m => ({ role: m.role, text: m.text || '' }))
    // 이미지 첨부된 경우: Gemini만 (서버 Claude 프록시는 아직 멀티모달 미지원)
    if (image && geminiKey) {
      const contents = []
      histTurns.forEach(m => contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text || '' }] }))
      contents.push({ role: 'user', parts: [
        { inlineData: { mimeType: image.mimeType, data: image.base64 } },
        { text: prompt || '이 이미지를 분석해서 설명해주세요.' }
      ]})
      const rImg = await fetch(GEMINI_URL + '?key=' + geminiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }),
      })
      if (rImg.ok) {
        const dd = await rImg.json()
        const txt = dd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (txt) return txt
      }
      throw new Error('이미지 분석 실패 (Gemini)')
    }
    if (smart) {
      // Sonnet 4.5
      const r = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ messages: [...histTurns, { role: 'user', text: prompt }] }),
      })
      if (r.ok) { const d = await r.json(); if (d?.answer) return d.answer }
      throw new Error('Claude 응답 실패')
    }
    // 기본: Gemini Flash
    if (geminiKey) {
      const contents = []
      histTurns.forEach(m => contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text || '' }] }))
      contents.push({ role: 'user', parts: [{ text: prompt }] })
      const r2 = await fetch(GEMINI_URL + '?key=' + geminiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }),
      })
      if (r2.ok) {
        const dd = await r2.json()
        const txt = dd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (txt) return txt
      }
    }
    // Gemini 실패 시 Sonnet 폴백
    const r3 = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ messages: [...histTurns, { role: 'user', text: prompt }] }),
    })
    if (r3.ok) { const d = await r3.json(); if (d?.answer) return d.answer }
    throw new Error('AI 호출 실패')
  }

  // write intent 판별 (예약 생성 등)
  const tryParseWriteIntent = async (question) => {
    try {
      const snap = [
        `지점: ${(data?.branches||[]).map(b=>b.short||b.name).filter(Boolean).join(', ')}`,
        `카테고리: ${(data?.serviceCategories||data?.categories||[]).map(c=>c.name).filter(Boolean).slice(0,20).join(', ')}`,
      ].join('\n')
      const prompt = buildWriteIntentPrompt(question, snap)
      const raw = await callAI(prompt, { smart: false })
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return null
      return JSON.parse(m[0])
    } catch (e) { return null }
  }

  const handleSend = async (text, opts = {}) => {
    const q = (text || '').trim()
    const img = attachedImage
    if (!q && !img) return
    if (sending) return
    setError('')
    setInput('')
    setAttachedImage(null)
    setMessages(prev => [...prev, { role: 'user', text: q || (img ? '[이미지]' : ''), at: Date.now(), image: img?.preview }])
    setSending(true)
    try {
      // ── 1단계: 이미지 첨부 시 — 텍스트로 의도가 명시된 경우만 예약 파싱 시도, 그 외는 의도 묻기
      if (img) {
        const wantsReservation = q && /(예약|booking|reservation|appoint)/i.test(q)
        if (wantsReservation) {
          try {
            const parsed = await parseBookingWithAI({ text: q, imgData: { base64: img.base64, mimeType: img.mimeType } }, data, geminiKey)
            const { custId: matchedCustId } = await findCustomerForBooking(parsed, bizId, q || (writeCheck?.changes?.input))
            const writeCheck = {
              intent: 'write',
              action: 'create_reservation',
              changes: { input: q, _parsed: parsed, _matchedCustId: matchedCustId },
            }
            const validateErr = validateAction(writeCheck.action, writeCheck.changes)
            const preview = buildPreview(writeCheck, data)
            if (validateErr) preview.error = validateErr
            setMessages(prev => [...prev, {
              role: 'assistant',
              text: validateErr ? `이미지에서 일부 정보를 추출했지만 부족합니다. 답글로 추가 정보를 알려주세요.` : '이미지에서 예약 정보를 추출했어요. 확인해주세요:',
              action: { ...writeCheck, preview, schema: ACTION_SCHEMAS[writeCheck.action], status: 'pending' },
              at: Date.now(),
            }])
            return
          } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', text: '❌ 이미지 분석 실패: ' + (e?.message || e), at: Date.now() }])
            return
          }
        }
        // 의도 명시 없음 — 사용자에게 묻기
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: '이미지를 받았습니다. 이 이미지로 무엇을 도와드릴까요?\n\n예시:\n• "예약 등록해줘" — 카톡/스크린샷에서 예약 정보 추출해 등록\n• "내용 분석해줘" — 이미지에 적힌 내용 설명\n• "시술 가격 보고 등록" — 시술상품 추가 (현재는 관리설정에서만)\n\n원하시는 작업과 함께 이미지를 다시 보내주세요.',
          at: Date.now(),
        }])
        return
      }
      // ── 2단계: 텍스트만 있을 때 쓰기 인텐트 체크
      if (q && !img) {
        const writeCheck = await tryParseWriteIntent(q)
        // 정보 부족 — 사용자에게 묻기 (추측 금지)
        if (writeCheck?.intent === 'ambiguous') {
          setMessages(prev => [...prev, { role: 'assistant', text: writeCheck.need_info || '정보가 부족합니다. 자세히 알려주세요.', at: Date.now() }])
          return
        }
        if (writeCheck?.intent === 'write' && writeCheck.action) {
          const isReservationOp = writeCheck.action === 'create_reservation' || writeCheck.action === 'cancel_reservation'
          // 예약 생성·취소는 전 사용자 / 그 외 설정 변경은 마스터만
          if (!isMaster && !isReservationOp) {
            setMessages(prev => [...prev, { role: 'assistant', text: '⛔ 설정 변경은 브랜드 대표만 가능합니다. 예약 생성·취소와 조회는 가능합니다.', at: Date.now() }])
            return
          }
          // 예약 생성: AI Book 파서로 자연어 → 구조화
          if (writeCheck.action === 'create_reservation') {
            const inputText = writeCheck.changes?.input || q
            try {
              const parsed = await parseBookingWithAI({ text: inputText }, data, geminiKey)
              const { custId: matchedCustId } = await findCustomerForBooking(parsed, bizId, inputText)
              writeCheck.changes = { ...writeCheck.changes, _parsed: parsed, _matchedCustId: matchedCustId }
              // 필수 정보 검증 — 부족하면 confirm 카드 대신 묻기
              const missing = []
              if (!parsed.date) missing.push('날짜')
              if (!parsed.time) missing.push('시간')
              if (!parsed.branch) missing.push('지점 (강남/왕십리/홍대/마곡/잠실/위례/용산/천호)')
              if (!parsed.custName && !parsed.custPhone && !parsed.custEmail) missing.push('고객 (이름·연락처·이메일 중 하나)')
              if (missing.length > 0) {
                setMessages(prev => [...prev, { role: 'assistant', text: `다음 정보가 필요해요. 알려주세요:\n• ${missing.join('\n• ')}`, at: Date.now() }])
                return
              }
            } catch (e) {
              setMessages(prev => [...prev, { role: 'assistant', text: '❌ 예약 정보 분석 실패: ' + (e?.message || e) + '\n예: "내일 3시 강남 김철수 010-1234-5678 브라질리언 예약"', at: Date.now() }])
              return
            }
          }
          // 예약 취소: 자연어 파싱 → 고객 매칭 → 예약 검색
          if (writeCheck.action === 'cancel_reservation') {
            const inputText = writeCheck.changes?.input || q
            try {
              const parsed = await parseBookingWithAI({ text: inputText }, data, geminiKey)
              const { custId: matchedCustId } = await findCustomerForBooking(parsed, bizId, inputText)
              const matched = await findReservationsToCancel(parsed, matchedCustId, bizId)
              writeCheck.changes = { ...writeCheck.changes, _parsed: parsed, _matchedRes: matched }
            } catch (e) {
              setMessages(prev => [...prev, { role: 'assistant', text: '❌ 예약 검색 실패: ' + (e?.message || e), at: Date.now() }])
              return
            }
          }
          const validateErr = validateAction(writeCheck.action, writeCheck.changes)
          const preview = buildPreview(writeCheck, data)
          if (validateErr) preview.error = validateErr
          setMessages(prev => [...prev, {
            role: 'assistant',
            text: '요청을 확인해주세요:',
            action: { ...writeCheck, preview, schema: ACTION_SCHEMAS[writeCheck.action], status: 'pending' },
            at: Date.now(),
          }])
          return
        }
      }
      // ── 2단계: 일반 조회/대화
      const role = isMaster ? 'master' : 'staff'
      // 📚 RAG: 업로드된 문서에서 질문 관련 청크 검색 → extraContext에 주입
      let extraContext = ''
      try {
        const apiKey = window.__systemGeminiKey || window.__geminiKey || localStorage.getItem('bliss_gemini_key') || ''
        if (apiKey && bizId) {
          const hits = await searchDocs({ question: q, businessId: bizId, geminiKey: apiKey, threshold: 0.0, count: 8 })
          const ctx = buildDocsContext(hits)
          if (ctx) extraContext = ctx
        }
      } catch (_) { /* 문서 검색 실패해도 답변 진행 */ }
      const prompt = buildFullPrompt({ question: q, data, faqItems, role, extraContext })
      const answer = await callAI(prompt, { smart: !!opts.smart, image: img })
      const unk = detectUnknown(answer)
      setMessages(prev => [...prev, { role: 'assistant', text: answer, at: Date.now(), unknown: unk, smart: !!opts.smart, _typewriter: true }])
      // AI가 답변 못한 질문 → 요청사항으로 자동 등록 (백그라운드)
      if (unk) logUnknownAsRequest({ question: q, answer, currentUser })
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', text: '⚠️ ' + (e?.message || '오류'), at: Date.now() }])
    } finally { setSending(false) }
  }

  // 액션 실행/취소
  const updateActionStatus = (msgIdx, status, errMsg) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.action) return m
      return { ...m, action: { ...m.action, status, errMsg } }
    }))
  }
  const runAction = async (msgIdx, actionPayload) => {
    const isReservationOp = actionPayload?.action === 'create_reservation' || actionPayload?.action === 'cancel_reservation'
    if (!isMaster && !isReservationOp) {
      updateActionStatus(msgIdx, 'error', '권한 없음')
      return
    }
    updateActionStatus(msgIdx, 'running')
    try {
      const res = await executeAction(actionPayload, data, { bizId, currentUser })
      updateActionStatus(msgIdx, 'done')
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `✅ "${actionPayload.preview?.label || actionPayload.action}" 실행 완료`,
        at: Date.now(),
      }])
    } catch (e) {
      updateActionStatus(msgIdx, 'error', e?.message || String(e))
      setMessages(prev => [...prev, { role: 'assistant', text: '❌ 실행 실패: ' + (e?.message || e), at: Date.now() }])
    }
  }
  const cancelAction = (msgIdx) => {
    updateActionStatus(msgIdx, 'cancelled')
    setMessages(prev => [...prev, { role: 'assistant', text: '요청을 진행하지 않았어요. 다시 말씀해주세요.', at: Date.now() }])
  }

  const reset = () => {
    if (!confirm('대화를 초기화할까요?')) return
    setMessages([]) // useEffect가 인사말 버블 다시 순차 추가
  }

  // 닫혀있을 때: 플로팅 버튼만
  if (!open) {
    const isMob = typeof window !== 'undefined' && window.innerWidth < 768
    return (
      <button onClick={() => setOpen(true)} title="블리스 AI"
        style={{
          position: 'fixed', bottom: isMob ? 84 : 18, right: isMob ? 12 : 18, zIndex: 350,
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #C4B5FD, #A78BFA)',
          color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(167,139,250,.35), 0 1px 3px rgba(0,0,0,.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontFamily: 'inherit',
          opacity: .85,
          transition: 'transform .15s, opacity .15s, box-shadow .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.opacity = '.85'; }}>
        ✨
      </button>
    )
  }

  // 열려있을 때: 채팅 패널
  return (
    <div style={(() => {
      const isMob = typeof window !== 'undefined' && window.innerWidth < 768
      const base = {
        position: 'fixed',
        right: isMob ? 8 : 18,
        zIndex: 350,
        width: 380, maxWidth: 'calc(100vw - 16px)',
        background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.25), 0 4px 12px rgba(0,0,0,.1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'ovFadeIn .2s ease-out',
      }
      if (isMob) {
        // 모바일: top·bottom 고정으로 상단 status bar / 하단 BottomNav 모두 회피
        return { ...base, top: 'calc(env(safe-area-inset-top, 0px) + 12px)', bottom: 78, height: 'auto' }
      }
      // 데스크탑: 우하단 540px 고정
      return { ...base, bottom: 18, height: 540, maxHeight: 'calc(100vh - 36px)' }
    })()}>
      {/* Header — 단순: 제목 + 닫기. 연한 배경 */}
      <div style={{
        padding: '8px 12px', background: '#F5F3FF', color: '#5B21B6',
        borderBottom: '1px solid #E9D5FF',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>✨</span>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>블리스 AI</div>
        <button onClick={() => setOpen(false)} title="닫기"
          style={{ width: 26, height: 26, borderRadius: 13, border: 'none', background: 'rgba(124,58,237,.12)', color: '#5B21B6', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', background: '#FAFAFA', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m, i) => {
          const isUser = m.role === 'user'
          // 액션 confirm 카드
          if (!isUser && m.action) {
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#1F1F23' }}>{m.text}</div>
                <ActionConfirmCard
                  preview={m.action.preview}
                  schema={m.action.schema}
                  status={m.action.status}
                  onConfirm={() => runAction(i, m.action)}
                  onCancel={() => cancelAction(i)}
                />
              </div>
            )
          }
          return (
            <div key={i} style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
                <div style={isUser
                  ? {
                      padding: m.image ? '6px 6px 10px' : '10px 14px',
                      borderRadius: 18,
                      background: '#F4F4F5', color: '#27272A',
                      fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      border: 'none',
                    }
                  : {
                      padding: 0,
                      background: 'transparent', color: '#1F1F23',
                      fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                  {m.image && <img src={m.image} alt="첨부" style={{ display: 'block', maxWidth: 260, maxHeight: 260, borderRadius: 12, marginBottom: m.text && m.text !== '[이미지]' ? 6 : 0 }}/>}
                  {(!m.image || (m.text && m.text !== '[이미지]')) && (
                    <div style={{ padding: m.image && isUser ? '0 8px' : 0 }}>
                      {m._typewriter ? <Typewriter text={isUser ? m.text : _sanitize(m.text)}/> : (isUser ? m.text : _sanitize(m.text))}
                    </div>
                  )}
                </div>
                {!isUser && !m.action && m.text && (
                  <button onClick={async () => {
                    try { await navigator.clipboard.writeText(_sanitize(m.text)); }
                    catch { /* noop */ }
                  }}
                    title="답변 복사"
                    style={{ fontSize: 10, color: T.gray500, background: '#fff', border: '1px solid '+T.border, padding: '2px 8px', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📋 복사
                  </button>
                )}
                {!isUser && m.unknown && (
                  <span style={{ fontSize: 10, color: '#B45309', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '2px 7px', borderRadius: 10, fontWeight: 700 }}>
                    📌 답변 부족 — 요청사항으로 자동 등록됨
                  </span>
                )}
                {!isUser && i === messages.length - 1 && !sending && messages[i - 1]?.role === 'user' && !m.smart && (
                  <button onClick={() => {
                    const prevQ = messages[i - 1]?.text || ''
                    if (!prevQ) return
                    setMessages(prev => prev.slice(0, i))
                    handleSend(prevQ, { smart: true })
                  }}
                    title="Claude Sonnet 4.5로 다시 답변 (더 정확·고비용)"
                    style={{ fontSize: 10, color: '#7C3AED', background: '#fff', border: '1px solid #C4B5FD', padding: '2px 8px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    💎 Sonnet으로 더 똑똑하게
                  </button>
                )}
                {!isUser && m.smart && (
                  <span style={{ fontSize: 9, color: '#7C3AED', fontWeight: 700, opacity: 0.7 }}>💎 Sonnet 4.5</span>
                )}
              </div>
            </div>
          )
        })}
        {sending && <div style={{ alignSelf: 'flex-start', fontSize: 11, color: T.textMuted, padding: '4px 10px' }}>답변 작성 중...</div>}
      </div>


      {error && <div style={{ padding: '6px 12px', fontSize: 11, color: T.danger, background: '#FEF2F2', borderTop: '1px solid #FCA5A5' }}>{error}</div>}

      {/* Input — Claude 모바일 스타일: 둥근 컨테이너 안에 textarea + 하단 [+] / [전송·마이크] */}
      <div style={{ padding: '10px 12px 12px', background: '#fff', flexShrink: 0 }}>
        {/* 이미지 미리보기 (입력 컨테이너 위) */}
        {attachedImage && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '5px 8px 5px 5px', background: '#F4F4F5', borderRadius: 12 }}>
            <img src={attachedImage.preview} alt="첨부" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }}/>
            <span style={{ fontSize: 12, color: '#52525B', fontWeight: 500 }}>이미지 1</span>
            <button onClick={() => setAttachedImage(null)} title="첨부 제거"
              style={{ width: 22, height: 22, borderRadius: 11, border: 'none', background: 'rgba(0,0,0,.08)', color: '#52525B', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>×</button>
          </div>
        )}
        {/* 컨테이너: 둥근 박스 안에 textarea (위) + 버튼 행 (아래) */}
        <div style={{
          border: '1px solid #E5E5E7', borderRadius: 22, background: '#fff',
          padding: '10px 12px 8px',
          boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          transition: 'border-color .15s',
        }}>
          <textarea value={input}
            ref={el => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(180, el.scrollHeight) + 'px'; } }}
            onChange={e => { setInput(e.target.value); const ta = e.target; ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(input) } }}
            onPaste={e => {
              const items = e.clipboardData?.items || []
              for (const it of items) {
                if (it.kind === 'file' && it.type?.startsWith('image/')) {
                  const f = it.getAsFile()
                  if (!f) continue
                  if (f.size > 4 * 1024 * 1024) { setError('이미지는 4MB 이하만 가능합니다.'); return }
                  e.preventDefault()
                  const r = new FileReader()
                  r.onload = () => {
                    const dataUrl = r.result
                    setAttachedImage({ base64: String(dataUrl).split(',')[1], mimeType: f.type, preview: dataUrl })
                    setError('')
                  }
                  r.readAsDataURL(f)
                  return
                }
              }
            }}
            placeholder={recording ? '듣는 중...' : ''}
            disabled={sending}
            rows={1}
            style={{ width: '100%', padding: 0, border: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'none', lineHeight: 1.55, minHeight: 22, maxHeight: 180, overflowY: 'auto', boxSizing: 'border-box', background: 'transparent', color: '#1F1F23' }}/>
          {/* 하단 버튼 행 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }}/>
            <button onClick={() => fileRef.current?.click()} disabled={sending} title="이미지 첨부"
              style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: 'transparent', color: '#71717A', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <div style={{ flex: 1 }}/>
            {/* 마이크 — 항상 표시 */}
            <button onClick={startVoice} disabled={sending} title={recording ? '듣는 중... (클릭해서 중지)' : '음성 입력'}
              style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: recording ? '#EF4444' : 'transparent', color: recording ? '#fff' : '#52525B', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            {/* 전송 — 입력 있을 때만 */}
            {(input.trim() || attachedImage) && (
              <button onClick={() => handleSend(input)} disabled={sending} title="전송"
                style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: '#1F1F23', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
