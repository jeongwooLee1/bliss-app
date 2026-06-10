import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { SB_URL, sb, sbHeaders } from '../../lib/sb'
import { fromDb } from '../../lib/db'
import I from '../common/I'
import {
  byteLen, renderTemplate, normPhone, callSendSms, isAck,
  deductSmsBilling, applyAdFormat, isNightBlocked,
} from '../../lib/smsSend'

// 세그먼트 프리셋 — CustomersPage 와 동일 기준 (공비서 대비)
const PRESETS = [
  ['all', '전체', '전체 고객'],
  ['new', '신규', '1회 이하 방문'],
  ['repeat', '재방문', '2회 이상 방문'],
  ['vip', '단골', '10회 이상 방문'],
  ['churned', '이탈', '90일 이상 미방문'],
  ['noshow', '노쇼주의', '노쇼 이력 있는 고객'],
  ['pkg', '보유권', '정액권·다회권 잔여 보유'],
]

const _id = (p) => p + Math.random().toString(36).slice(2, 12)
const _ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
// datetime-local 기본값: 지금 + 1시간, 5분 올림
function _defaultSchedule() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// 세그먼트 → PostgREST 필터 조건 (business_id 전체 — 사업체 전체 고객 대상)
// 수신동의(sms_consent !== false) + 숨김 제외. 휴대폰 유효성은 fetch 후 클라에서 검증.
function buildSegmentFilter(bizId, segment, params = {}) {
  const parts = [`business_id=eq.${bizId}`, `is_hidden=not.is.true`]
  // 수신동의: sms_consent 가 null(기본 동의) 또는 true
  parts.push(`or=(sms_consent.is.null,sms_consent.eq.true)`)
  if (params.joinFrom) parts.push(`join_date=gte.${params.joinFrom}`)
  if (params.joinTo) parts.push(`join_date=lte.${params.joinTo}`)
  if (segment === 'new') parts.push(`visits=lte.1`)
  else if (segment === 'repeat') parts.push(`visits=gte.2`)
  else if (segment === 'vip') parts.push(`visits=gte.10`)
  else if (segment === 'churned') {
    const c = new Date(); c.setDate(c.getDate() - 90)
    parts.push(`visits=gte.1`); parts.push(`last_visit=lt.${_ymd(c)}`); parts.push(`last_visit=gte.2020-01-01`)
  } else if (segment === 'noshow') parts.push(`no_show_count=gte.1`)
  return parts.join('&')
}

export default function MarketingBroadcast({ data, userBranches = [], bizId, currentUser, isMaster }) {
  const branches = data?.branches || []
  // 발신 지점 후보 — sms_callback 등록 + 권한 지점
  const branchOptions = useMemo(() => {
    const allowed = (userBranches && userBranches.length) ? new Set(userBranches) : null
    return branches.filter(b => (b.smsCallback || b.sms_callback) && (!allowed || allowed.has(b.id)))
  }, [branches, userBranches])

  const [segment, setSegment] = useState('all')
  const [joinFrom, setJoinFrom] = useState('')
  const [joinTo, setJoinTo] = useState('')
  const [branchId, setBranchId] = useState('')
  const [message, setMessage] = useState('')
  const [isAd, setIsAd] = useState(false)
  const [optout080, setOptout080] = useState('')          // businesses.settings.ad_optout_080
  const [optoutDraft, setOptoutDraft] = useState('')
  const [optoutSaving, setOptoutSaving] = useState(false)
  const [scheduleMode, setScheduleMode] = useState('now') // now | scheduled
  const [scheduledAt, setScheduledAt] = useState(_defaultSchedule())
  const [count, setCount] = useState(null)                // 수신동의 고객 수 (휴대폰 미검증)
  const [counting, setCounting] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)          // {sent,total,ok,fail}
  const [confirmInfo, setConfirmInfo] = useState(null)    // 커스텀 발송 확인 모달
  const [toast, setToast] = useState('')                  // "저장됨✓" 등
  const [alertMsg, setAlertMsg] = useState('')            // 커스텀 alert
  const [campaigns, setCampaigns] = useState([])          // 최근 캠페인

  const branch = useMemo(() => branches.find(b => b.id === branchId) || {}, [branches, branchId])
  const cb = (b) => b?.smsCallback || b?.sms_callback || ''

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }
  const showAlert = (m) => setAlertMsg(m)

  // 발신 지점 기본값
  useEffect(() => { if (!branchId && branchOptions[0]) setBranchId(branchOptions[0].id) }, [branchOptions, branchId])

  // businesses.settings.ad_optout_080 로드
  useEffect(() => {
    if (!bizId) return
    let on = true
    ;(async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
        const rows = await r.json()
        const raw = rows?.[0]?.settings
        const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
        if (on) { setOptout080(parsed.ad_optout_080 || ''); setOptoutDraft(parsed.ad_optout_080 || '') }
      } catch (e) { console.error('[marketing] settings load', e) }
    })()
    return () => { on = false }
  }, [bizId])

  // 최근 캠페인 로드
  const loadCampaigns = useCallback(async () => {
    if (!bizId) return
    try {
      const rows = await sb.get('marketing_campaigns', `&business_id=eq.${bizId}&order=created_at.desc&limit=10`)
      setCampaigns(rows || [])
    } catch (e) { console.error('[marketing] campaigns load', e) }
  }, [bizId])
  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  // 080 저장
  const saveOptout = async () => {
    const v = optoutDraft.trim()
    setOptoutSaving(true)
    try {
      // settings 전체 read → ad_optout_080만 교체 → write (문자열 스프레드 사고 방지)
      const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
      const rows = await r.json()
      const raw = rows?.[0]?.settings
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
      parsed.ad_optout_080 = v
      const w = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ settings: JSON.stringify(parsed) }),
      })
      if (!w.ok) throw new Error('저장 실패 ' + w.status)
      setOptout080(v); showToast('저장됨 ✓')
    } catch (e) { showAlert('080 번호 저장 실패: ' + (e?.message || e)) }
    finally { setOptoutSaving(false) }
  }

  // 세그먼트 대상 카운트 (수신동의 고객, count=exact)
  const fetchCount = useCallback(async () => {
    if (!bizId) return
    setCounting(true); setCount(null)
    try {
      if (segment === 'pkg') {
        // 보유권 — RPC (count 미지원) → rows 받아 길이로 근사
        const r = await fetch(`${SB_URL}/rest/v1/rpc/get_customers_with_active_pkg`, {
          method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_biz: bizId, p_bid: null, p_search: null, p_offset: 0, p_limit: 10000 }),
        })
        const rows = r.ok ? await r.json() : []
        // 수신동의 + 휴대폰 보유만 카운트
        const valid = (rows || []).filter(c => c.sms_consent !== false && normPhone(c.phone))
        setCount(valid.length)
      } else {
        const filter = buildSegmentFilter(bizId, segment, { joinFrom, joinTo })
        const cr = await fetch(`${SB_URL}/rest/v1/customers?${filter}&select=id`, {
          headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' },
        })
        const range = cr.headers.get('content-range') || ''
        const tot = range.includes('/') ? parseInt(range.split('/')[1], 10) : NaN
        setCount(Number.isFinite(tot) ? tot : null)
      }
    } catch (e) { console.error('[marketing] count', e); setCount(null) }
    finally { setCounting(false) }
  }, [bizId, segment, joinFrom, joinTo])
  useEffect(() => { fetchCount() }, [fetchCount])

  // 발송 대상 전체 fetch (id,name,phone,bid,cust_num) → 유효 휴대폰만
  const fetchRecipients = async () => {
    let rows = []
    if (segment === 'pkg') {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/get_customers_with_active_pkg`, {
        method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_biz: bizId, p_bid: null, p_search: null, p_offset: 0, p_limit: 50000 }),
      })
      rows = r.ok ? await r.json() : []
    } else {
      // 페이지네이션 (db-max-rows 1000 캡 우회)
      const filter = buildSegmentFilter(bizId, segment, { joinFrom, joinTo })
      const PAGE = 1000
      for (let off = 0; off < 100000; off += PAGE) {
        const r = await fetch(`${SB_URL}/rest/v1/customers?${filter}&select=id,name,phone,bid,cust_num,sms_consent&order=id.asc&offset=${off}&limit=${PAGE}`, { headers: sbHeaders })
        if (!r.ok) break
        const batch = await r.json()
        rows = rows.concat(batch)
        if (batch.length < PAGE) break
      }
    }
    const mapped = fromDb('customers', rows)
    // 수신동의 + 유효 휴대폰
    const seen = new Set(); const valid = []
    for (const c of mapped) {
      if (c.smsConsent === false) continue
      const ph = normPhone(c.phone)
      if (!ph) continue
      if (seen.has(ph)) continue
      seen.add(ph)
      valid.push({ id: c.id, name: c.name || '', phone: ph, bid: c.bid })
    }
    return valid
  }

  // 최종 본문 (광고 포맷 적용, 미리보기·byte용 — 변수는 샘플 치환)
  const fields0 = useMemo(() => ({
    고객명: '고객', 매장명: branch.name || '', 지점명: branch.short || branch.name || '', 대표전화번호: branch.phone || '',
  }), [branch])
  const previewMsg = useMemo(() => applyAdFormat(renderTemplate(message, fields0), isAd, optout080), [message, fields0, isAd, optout080])
  const mb = byteLen(previewMsg)
  const msgType = mb <= 90 ? 'SMS' : mb <= 2000 ? 'LMS' : 'OVER'
  const perCost = mb > 90 ? 60 : 20
  const estCost = (count || 0) * perCost

  const insertVar = (k) => setMessage(prev => prev + `#{${k}}`)

  // 발송 가능 검증 → 확인 모달 오픈
  const requestSend = async () => {
    if (!branchId) return showAlert('발신 지점을 선택해주세요.')
    if (!message.trim()) return showAlert('메시지를 입력해주세요.')
    if (mb > 2000) return showAlert('LMS 한도 2,000byte를 초과했습니다.')
    if (isAd && !optout080.trim()) return showAlert('광고성 문자는 무료수신거부 080 번호가 필요합니다.\n아래 "광고 수신거부 번호"를 먼저 등록해주세요. (없으면 광고 발송 불가)')
    // 야간 차단 (즉시=지금 / 예약=지정시각)
    const when = scheduleMode === 'scheduled' ? new Date(scheduledAt) : new Date()
    if (scheduleMode === 'scheduled') {
      if (!scheduledAt || isNaN(when.getTime())) return showAlert('예약 발송 시각을 선택해주세요.')
      if (when.getTime() < Date.now() + 60 * 1000) return showAlert('예약 시각은 현재보다 이후여야 합니다.')
    }
    if (isNightBlocked(when)) return showAlert('야간(21:00~08:00) 발송은 차단됩니다.\n08:00~21:00 사이로 발송해주세요.')

    // 즉시: 대상 fetch 후 정확 카운트로 확인. 예약: 카운트는 발송 시점 재평가되므로 근사값 안내.
    if (scheduleMode === 'now') {
      setSending(true)
      try {
        const recipients = await fetchRecipients()
        setSending(false)
        if (recipients.length === 0) return showAlert('발송 가능한 수신자(수신동의+휴대폰 보유)가 없습니다.')
        setConfirmInfo({ mode: 'now', recipients, count: recipients.length })
      } catch (e) { setSending(false); showAlert('대상 조회 실패: ' + (e?.message || e)) }
    } else {
      setConfirmInfo({ mode: 'scheduled', count: count || 0, when })
    }
  }

  // 실제 발송 (즉시) — 확인 모달에서 호출
  const doSendNow = async () => {
    const recipients = confirmInfo.recipients
    setConfirmInfo(null)
    setSending(true)
    setProgress({ sent: 0, total: recipients.length, ok: 0, fail: 0 })
    // 캠페인 레코드 생성
    const campId = _id('mkc_')
    await sb.insert('marketing_campaigns', {
      id: campId, business_id: bizId, bid: branchId, name: '', segment,
      segment_params: { joinFrom, joinTo }, message, is_ad: isAd, optout_080: isAd ? optout080 : null,
      channel: 'sms', scheduled_at: null, status: 'sending', target_count: recipients.length,
      sent_count: 0, fail_count: 0, created_by: currentUser?.name || currentUser?.login_id || '',
    })
    const hasVar = /#\{[^}]+\}/.test(message)
    let ok = 0, fail = 0
    const sendLogs = []
    try {
      if (!hasVar) {
        // 변수 없음 → 모든 수신자 동일 본문 (광고 포맷 1회 적용)
        const finalMsg = applyAdFormat(message, isAd, optout080)
        const BATCH = 100
        for (let i = 0; i < recipients.length; i += BATCH) {
          const slice = recipients.slice(i, i + BATCH)
          const res = await callSendSms(branchId, finalMsg, slice.map(c => ({ phone: c.phone, userKey: c.id || c.phone })))
          const good = res.ok && isAck(res.body)
          slice.forEach(c => sendLogs.push({ c, ok: good }))
          if (good) { ok += slice.length; deductSmsBilling({ bizId, branchId, message: finalMsg, count: slice.length }) }
          else { fail += slice.length; console.warn('[marketing] batch fail', res) }
          setProgress({ sent: i + slice.length, total: recipients.length, ok, fail })
        }
      } else {
        // 변수 사용 → 1명씩 치환
        for (let i = 0; i < recipients.length; i++) {
          const c = recipients[i]
          const personal = applyAdFormat(renderTemplate(message, {
            고객명: c.name || '', 매장명: branch.name || '', 지점명: branch.short || branch.name || '', 대표전화번호: branch.phone || '',
          }), isAd, optout080)
          const res = await callSendSms(branchId, personal, [{ phone: c.phone, userKey: c.id || c.phone }])
          const good = res.ok && isAck(res.body)
          sendLogs.push({ c, ok: good })
          if (good) { ok++; deductSmsBilling({ bizId, branchId, message: personal, count: 1 }) }
          else { fail++ }
          setProgress({ sent: i + 1, total: recipients.length, ok, fail })
        }
      }
      // 발송 로그 + 캠페인 상태 갱신
      const nowIso = new Date().toISOString()
      const rows = sendLogs.map(({ c, ok }) => ({
        id: _id('mks_'), campaign_id: campId, business_id: bizId, customer_id: c.id || null,
        phone: c.phone, status: ok ? 'sent' : 'failed', sent_at: ok ? nowIso : null,
      }))
      // 대량이면 1000개씩 끊어서 upsert
      for (let i = 0; i < rows.length; i += 1000) await sb.upsert('marketing_sends', rows.slice(i, i + 1000))
      await sb.update('marketing_campaigns', campId, { status: 'done', sent_count: ok, fail_count: fail, updated_at: nowIso })
      showAlert(`발송 완료\n성공 ${ok}건 / 실패 ${fail}건`)
      setMessage(''); loadCampaigns()
    } catch (e) {
      await sb.update('marketing_campaigns', campId, { status: 'failed', sent_count: ok, fail_count: fail })
      showAlert('발송 중 오류: ' + (e?.message || e))
    } finally { setSending(false); setProgress(null) }
  }

  // 예약 발송 — 캠페인만 큐 적재 (서버 스케줄러가 발송 시점 세그먼트 재평가)
  const doSchedule = async () => {
    const when = confirmInfo.when
    setConfirmInfo(null)
    try {
      await sb.insert('marketing_campaigns', {
        id: _id('mkc_'), business_id: bizId, bid: branchId, name: '', segment,
        segment_params: { joinFrom, joinTo }, message, is_ad: isAd, optout_080: isAd ? optout080 : null,
        channel: 'sms', scheduled_at: when.toISOString(), status: 'scheduled', target_count: count || 0,
        sent_count: 0, fail_count: 0, created_by: currentUser?.name || currentUser?.login_id || '',
      })
      showAlert(`예약 발송이 등록됐어요.\n${when.toLocaleString('ko-KR')} 에 발송됩니다.\n(예약 발송은 서버 스케줄러 적용 후 동작)`)
      setMessage(''); loadCampaigns()
    } catch (e) { showAlert('예약 등록 실패: ' + (e?.message || e)) }
  }

  // 테스트 발송 (본인 1건)
  const testSend = async () => {
    if (!branchId) return showAlert('발신 지점을 선택해주세요.')
    if (!message.trim()) return showAlert('메시지를 입력해주세요.')
    let phone = prompt('테스트 받을 본인 휴대폰 (예: 01012345678)', '')
    if (!phone) return
    phone = String(phone).replace(/[^0-9]/g, '')
    if (!normPhone(phone)) return showAlert('휴대폰 번호 형식 오류')
    const personal = applyAdFormat(renderTemplate(message, fields0), isAd, optout080)
    setSending(true)
    try {
      const res = await callSendSms(branchId, personal, [{ phone, userKey: 'test_' + Date.now() }])
      if (res.ok && isAck(res.body)) showAlert('테스트 발송 완료 — 폰을 확인하세요.')
      else showAlert('테스트 발송 실패: ' + JSON.stringify(res.body).slice(0, 200))
    } finally { setSending(false) }
  }

  if (!isMaster) {
    return <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>마케팅 발송은 매장 관리자만 사용할 수 있어요.</div>
  }

  const ST = {
    card: { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 14 },
    label: { fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6 },
    sel: { width: '100%', padding: '9px 11px', border: '1px solid ' + T.border, borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 16px' }}>
        <I name="msgSq" size={20} />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>마케팅 단체 문자 발송</h2>
      </div>

      {/* 1. 세그먼트 */}
      <div style={ST.card}>
        <div style={ST.label}>1. 발송 대상 (사업체 전체 고객)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {PRESETS.map(([k, lbl, tip]) => (
            <button key={k} type="button" title={tip} onClick={() => setSegment(k)}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: segment === k ? 800 : 600, borderRadius: 999,
                border: '1px solid ' + (segment === k ? T.primary : T.border),
                background: segment === k ? T.primary : '#fff', color: segment === k ? '#fff' : T.textSub, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>가입일 범위(선택)</span>
          <input type="date" value={joinFrom} onChange={e => setJoinFrom(e.target.value)} style={{ ...ST.sel, width: 'auto', padding: '6px 8px', fontSize: 13 }} />
          <span style={{ color: T.textMuted }}>~</span>
          <input type="date" value={joinTo} onChange={e => setJoinTo(e.target.value)} style={{ ...ST.sel, width: 'auto', padding: '6px 8px', fontSize: 13 }} />
          {(joinFrom || joinTo) && <button onClick={() => { setJoinFrom(''); setJoinTo('') }} style={{ fontSize: 12, border: '1px solid ' + T.border, borderRadius: 6, background: '#fff', padding: '5px 9px', cursor: 'pointer' }}>초기화</button>}
        </div>
        <div style={{ padding: '10px 12px', background: T.primaryLt, borderRadius: 8, fontSize: 13 }}>
          {counting ? '대상 집계 중…'
            : count == null ? '대상 집계 실패 — 다시 시도해주세요.'
            : <>수신동의 고객 <b style={{ color: T.primary, fontSize: 15 }}>{count.toLocaleString('ko-KR')}명</b>
              <span style={{ color: T.textMuted, marginLeft: 6 }}>· 발송 시 휴대폰 미보유분은 자동 제외</span></>}
        </div>
      </div>

      {/* 2. 발신 지점 */}
      <div style={ST.card}>
        <div style={ST.label}>2. 발신 번호 (지점 선택){branchOptions.length === 0 && <span style={{ color: T.danger, marginLeft: 6 }}>· 발신번호 등록 지점 없음</span>}</div>
        <select value={branchId} onChange={e => setBranchId(e.target.value)} style={ST.sel}>
          <option value="">선택</option>
          {branchOptions.map(b => <option key={b.id} value={b.id}>{b.short || b.name} · {cb(b)}</option>)}
        </select>
      </div>

      {/* 3. 메시지 */}
      <div style={ST.card}>
        <div style={ST.label}>3. 메시지</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: T.textMuted }}>변수:</span>
          {['고객명', '매장명', '지점명', '대표전화번호'].map(k => (
            <button key={k} onClick={() => insertVar(k)} style={{ padding: '3px 9px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 6, background: '#fff', color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>#{k}</button>
          ))}
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="예시: #{고객명}님, 이번 주 #{지점명} 브라질리언 왁싱 20% 이벤트 진행해요! 예약 문의 환영합니다."
          style={{ width: '100%', minHeight: 120, padding: '11px 12px', border: '1px solid ' + T.border, borderRadius: 8, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', lineHeight: 1.55 }} />

        {/* 광고성 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={isAd} onChange={e => setIsAd(e.target.checked)} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>광고성 메시지</span>
          <span style={{ fontSize: 11, color: T.textMuted }}>(켜면 "(광고)" + 무료수신거부 080 자동 표기)</span>
        </label>
        {isAd && (
          <div style={{ marginTop: 8, padding: '10px 12px', background: T.warningLt, borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#92400E' }}>광고 수신거부 번호 (080)</div>
            {optout080 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{optout080}</span>
                <button onClick={() => setOptout080('')} style={{ fontSize: 11, border: '1px solid ' + T.border, borderRadius: 6, background: '#fff', padding: '4px 8px', cursor: 'pointer' }}>변경</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={optoutDraft} onChange={e => setOptoutDraft(e.target.value)} placeholder="080-XXXX-XXXX"
                  style={{ ...ST.sel, width: 180, padding: '6px 9px', fontSize: 13 }} />
                <button onClick={saveOptout} disabled={optoutSaving || !optoutDraft.trim()}
                  style={{ fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 6, background: T.primary, color: '#fff', padding: '7px 13px', cursor: 'pointer' }}>
                  {optoutSaving ? '저장 중…' : '저장'}
                </button>
                <span style={{ fontSize: 11, color: '#92400E' }}>080 미등록 시 광고 발송 불가 (법규)</span>
              </div>
            )}
          </div>
        )}

        {/* byte / 차감 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
          <span style={{ color: mb > 2000 ? T.danger : mb > 90 ? T.warning : T.textMuted, fontWeight: 600 }}>
            {mb} byte · {msgType === 'LMS' ? '장문(LMS)' : msgType}{msgType === 'OVER' ? ' (한도 초과)' : ''}
          </span>
          <span style={{ color: T.textSub }}>
            건당 {perCost}P · 예상 차감 <b style={{ color: T.primary }}>{estCost.toLocaleString('ko-KR')}P</b>
          </span>
        </div>
        {msgType === 'LMS' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '8px 11px', background: '#FFF7ED', borderRadius: 8, fontSize: 12, color: '#B45309', fontWeight: 600 }}>
            <I name="alert" size={13} /> 90byte 초과 — 장문(LMS)으로 발송됩니다 (요금 단문의 약 3배).
          </div>
        )}

        {/* 미리보기 */}
        {message.trim() && (
          <div style={{ marginTop: 12, padding: '11px 13px', background: '#FEF3C7', borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>미리보기</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{previewMsg}</div>
          </div>
        )}
      </div>

      {/* 4. 즉시/예약 */}
      <div style={ST.card}>
        <div style={ST.label}>4. 발송 시점</div>
        <div style={{ display: 'flex', gap: 14, marginBottom: scheduleMode === 'scheduled' ? 10 : 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} /> 즉시 발송
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" checked={scheduleMode === 'scheduled'} onChange={() => setScheduleMode('scheduled')} /> 예약 발송
          </label>
        </div>
        {scheduleMode === 'scheduled' && (
          <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={{ ...ST.sel, width: 'auto' }} />
        )}
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>야간(21:00~08:00) 발송은 법규상 차단됩니다.</div>
      </div>

      {/* 액션 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={testSend} disabled={sending}
          style={{ padding: '11px 16px', border: '1px solid ' + T.primary, background: '#fff', color: T.primary, borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: sending ? 0.5 : 1 }}>
          테스트 1건
        </button>
        <button onClick={requestSend} disabled={sending || !message.trim() || mb > 2000 || branchOptions.length === 0}
          style={{ flex: 1, padding: '11px 16px', border: 'none', background: sending ? T.textMuted : T.primary, color: '#fff', borderRadius: 9, fontWeight: 800, fontSize: 15, cursor: sending ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {sending ? '처리 중…' : scheduleMode === 'scheduled' ? '예약 발송 등록' : '지금 발송'}
        </button>
      </div>

      {/* 진행률 */}
      {progress && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: '#EFF6FF', borderRadius: 8, fontSize: 13 }}>
          발송 {progress.sent}/{progress.total} · 성공 {progress.ok} / 실패 {progress.fail}
        </div>
      )}

      {/* 최근 캠페인 */}
      {campaigns.length > 0 && (
        <div style={{ ...ST.card, marginTop: 18 }}>
          <div style={ST.label}>최근 발송</div>
          {campaigns.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid ' + T.border, fontSize: 12 }}>
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                background: c.status === 'done' ? T.successLt : c.status === 'scheduled' ? T.primaryLt : c.status === 'failed' ? T.dangerLt : T.warningLt,
                color: c.status === 'done' ? T.successDk : c.status === 'scheduled' ? T.primary : c.status === 'failed' ? T.danger : '#92400E' }}>
                {c.status === 'done' ? '발송완료' : c.status === 'scheduled' ? '예약' : c.status === 'sending' ? '발송중' : c.status === 'failed' ? '실패' : c.status}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.textSub }}>
                {PRESETS.find(p => p[0] === c.segment)?.[1] || c.segment} · {(c.message || '').slice(0, 24)}
              </span>
              <span style={{ color: T.textMuted }}>
                {c.status === 'scheduled' && c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : `${c.sent_count || 0}건`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 토스트 */}
      {toast && createPortal(
        <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, zIndex: 99999 }}>{toast}</div>, document.body)}

      {/* 커스텀 alert */}
      {alertMsg && createPortal(
        <div onClick={() => setAlertMsg('')} style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 380, width: '100%', padding: 22 }}>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>{alertMsg}</div>
            <button onClick={() => setAlertMsg('')} style={{ width: '100%', padding: '11px', border: 'none', background: T.primary, color: '#fff', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>확인</button>
          </div>
        </div>, document.body)}

      {/* 발송 확인 모달 (커스텀) */}
      {confirmInfo && createPortal(
        <div onClick={() => setConfirmInfo(null)} style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%', padding: 22 }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              {confirmInfo.mode === 'scheduled' ? '예약 발송 확인' : '발송 확인'}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              <div>대상 <b style={{ color: T.primary }}>{confirmInfo.count.toLocaleString('ko-KR')}명</b>{confirmInfo.mode === 'scheduled' ? ' (발송 시점 재집계)' : ''}</div>
              {confirmInfo.mode === 'scheduled' && <div>발송 시각: <b>{confirmInfo.when.toLocaleString('ko-KR')}</b></div>}
              <div>예상 차감: <b style={{ color: T.primary }}>{(confirmInfo.count * perCost).toLocaleString('ko-KR')}P</b> ({msgType === 'LMS' ? '장문' : '단문'} {perCost}P/건)</div>
              {isAd && <div style={{ color: '#B45309', fontSize: 13 }}>광고성 — "(광고)" + 수신거부 {optout080} 자동 표기</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmInfo(null)} style={{ flex: 1, padding: '11px', border: '1px solid ' + T.border, background: '#fff', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>취소</button>
              <button onClick={() => confirmInfo.mode === 'scheduled' ? doSchedule() : doSendNow()}
                style={{ flex: 1, padding: '11px', border: 'none', background: T.primary, color: '#fff', borderRadius: 9, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                {confirmInfo.mode === 'scheduled' ? '예약 등록' : '발송'}
              </button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  )
}
