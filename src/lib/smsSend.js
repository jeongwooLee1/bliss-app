// 마케팅 단체발송 · 일반 SMS 공통 발송 헬퍼 (send-sms Edge Function / UMS NPRO)
// SendSmsModal.jsx 의 인라인 로직을 추출 — 마케팅 페이지에서 재사용.
import { SB_URL, SB_KEY } from './sb'

// EUC-KR byte (한글 2 / ASCII 1). 90byte 이하 SMS, 초과 LMS.
export const byteLen = (s) => { let b = 0; for (const ch of String(s || '')) b += ch.charCodeAt(0) > 127 ? 2 : 1; return b }

// 변수 치환 — #{고객명} 등
export function renderTemplate(tpl, fields) {
  let out = tpl || ''
  for (const [k, v] of Object.entries(fields || {})) out = out.split(`#{${k}}`).join(v == null ? '' : String(v))
  return out
}

// 휴대폰(010~019) 정규화·검증
export function normPhone(raw) {
  const ph = String(raw || '').replace(/[^0-9]/g, '')
  const isMobile = /^01[0-9]/.test(ph) && ph.length >= 10 && ph.length <= 11
  return isMobile ? ph : null
}

// send-sms Edge Function 호출 (receivers: [{phone,userKey}])
export async function callSendSms(branchId, message, receivers) {
  const r = await fetch(`${SB_URL}/functions/v1/send-sms`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch_id: branchId, message, receivers }),
  })
  let body = null
  try { body = await r.json() } catch { body = { _raw: 'parse fail' } }
  return { ok: r.ok, status: r.status, body }
}

// UMS 응답 — code='100/200' + data[].msgKey 가 발급되어야 실제 발송 성공
export function isAck(b) {
  if (!b || typeof b !== 'object') return false
  const code = String(b.code || '')
  if (code !== '100' && code !== '200' && b.ok !== true) return false
  const list = Array.isArray(b.data) ? b.data : (Array.isArray(b.data?.resultList) ? b.data.resultList : [])
  if (list.length === 0 && b.ok === true) return true
  return list.length > 0 && list.every(d => d?.msgKey)
}

// billing 차감 (kind=sms/lms, 90byte 초과면 lms)
export async function deductSmsBilling({ bizId, branchId, message, count, ref = 'marketing_broadcast' }) {
  try {
    const bytes = byteLen(message)
    const kind = bytes > 90 ? 'lms' : 'sms'
    const points = (bytes > 90 ? 60 : 20) * count
    await fetch(`${SB_URL}/rest/v1/rpc/deduct_billing`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_business_id: bizId, p_branch_id: branchId, p_kind: kind,
        p_count: count, p_points: points, p_ref_table: ref, p_ref_id: null,
      }),
    })
  } catch (e) { console.warn('[smsSend] billing deduct err', e) }
}

// 광고성 문자 법규 포맷: (광고) 본문 + 무료수신거부 080
// 변수 치환된 개인 본문(personalMsg)에 적용. optout080 없으면 호출 측에서 발송 차단해야 함.
export function applyAdFormat(msg, isAd, optout080) {
  if (!isAd) return msg
  let out = msg || ''
  if (!/^\(광고\)/.test(out.trim())) out = '(광고) ' + out
  if (optout080 && !out.includes(optout080)) out = out.trimEnd() + `\n무료수신거부 ${optout080}`
  return out
}

// KST 야간(21:00~08:00) 발송 차단 판정 — 광고성 정보통신망법 준수
export function isNightBlocked(date) {
  const h = (date instanceof Date ? date : new Date(date)).getHours()
  return h >= 21 || h < 8
}
