// 빌링 차감 helper — billing_usage_logs INSERT + billing_balances 차감 (atomic via RPC)
import { SB_URL, SB_KEY } from './sb'

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

// 단가 (1P = 1원). lib/features.js POINT_PRICING과 동일하게 유지.
export const PRICE = {
  alimtalk: 10,
  sms: 20,
  lms: 60,
  whatsapp: 1,
  ai_call: 5,
  chat_msg: 1,
}

/**
 * 빌링 차감 호출 (실패 시 silent log).
 * @param {Object} p - {bizId, branchId, kind, count?, points?, refTable?, refId?}
 *   - kind: 'alimtalk' | 'sms' | 'lms' | 'whatsapp' | 'ai_call'
 *   - count 기본 1, points 미지정 시 PRICE[kind] * count
 */
export async function deductBilling({ bizId, branchId, kind, count = 1, points, refTable = null, refId = null }) {
  if (!bizId || !branchId || !kind) return false
  const pts = typeof points === 'number' ? points : (PRICE[kind] || 0) * count
  if (pts <= 0) return false
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/deduct_billing`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        p_business_id: bizId,
        p_branch_id: branchId,
        p_kind: kind,
        p_count: count,
        p_points: pts,
        p_ref_table: refTable,
        p_ref_id: refId ? String(refId) : null,
      }),
    })
    return true
  } catch (e) {
    console.warn('[deductBilling]', kind, e)
    return false
  }
}
