// ═══════════════════════════════════════════════════════════════
// 이벤트 엔진 — 매출 등록 시 활성 이벤트 평가 + 보상 계산
// 범용 엔진: 매장별 커스텀 코드 없이 설정(events 배열)만으로 동작
// ═══════════════════════════════════════════════════════════════

/**
 * 트리거 평가
 * @param {object} evt - 이벤트 설정 객체
 * @param {object} ctx - 매출 등록 컨텍스트
 *   - isNewCustomer: boolean
 *   - hasPrepaidRecharge: boolean (기존 다담권 보유 + 이번 매출에 다담권 추가)
 *   - hasPkgRepurchase: boolean (기존 패키지 보유 + 이번 매출에 패키지 추가)
 *   - hasAnyPrepaidPurchase: boolean
 *   - hasAnyPkgPurchase: boolean
 */
export function evaluateTrigger(evt, ctx) {
  const t = evt.trigger
  if (t === 'new_first_sale') {
    return !!ctx.isNewCustomer && !ctx.hasAnyPrepaidPurchase && !ctx.hasAnyPkgPurchase
  }
  if (t === 'prepaid_recharge') {
    return !!ctx.hasPrepaidRecharge
  }
  if (t === 'pkg_repurchase') {
    return !!ctx.hasPkgRepurchase
  }
  return false
}

/**
 * 적립 기준 금액 계산
 * - 'svc' (기본): 시술만
 * - 'svc_prod': 시술+제품
 * - 'prepaid_amount': 이번 매출의 다담권 충전금액
 * - 'category': evt.baseCategoryIds에 포함된 카테고리의 시술 금액 합
 * - 'services': evt.baseServiceIds에 포함된 서비스 금액 합
 */
function baseAmount(evt, ctx) {
  const base = evt.base || 'svc'
  if (base === 'svc_prod') return (ctx.svcTotal||0) + (ctx.prodTotal||0)
  if (base === 'prepaid_amount') return ctx.prepaidPurchaseAmount || 0
  if (base === 'category' && Array.isArray(evt.baseCategoryIds) && evt.baseCategoryIds.length) {
    // items 중 체크된 서비스만 합산, 해당 카테고리만
    const items = ctx.items || {}
    const svcList = ctx.svcList || []
    return svcList.reduce((sum, s) => {
      if (!evt.baseCategoryIds.includes(s.cat)) return sum
      const it = items[s.id]
      if (!it?.checked) return sum
      return sum + (it.amount || 0)
    }, 0)
  }
  if (base === 'services' && Array.isArray(evt.baseServiceIds) && evt.baseServiceIds.length) {
    const items = ctx.items || {}
    return evt.baseServiceIds.reduce((sum, sid) => {
      const it = items[sid]
      if (!it?.checked) return sum
      return sum + (it.amount || 0)
    }, 0)
  }
  return ctx.svcTotal || 0 // default
}

/**
 * 활성 이벤트 목록 평가 → 누적 보상
 * @returns {
 *   pointEarn: int,
 *   pointExpiresAt: ISO string | null,
 *   discountFlat: int,
 *   discountPct: number,   // 시술 기준 %
 *   prepaidBonus: int,     // 충전 보너스 (다담권 잔액 가산)
 *   issueCoupons: [{name, qty, expiresAt}],
 *   virtualCoupons: [{...coupon-like...}], // 기존 쿠폰엔진에 주입할 임시 쿠폰
 *   appliedEvents: [evt],  // 디버그/표시용
 * }
 */
export function applyEvents(events, ctx) {
  const result = {
    pointEarn: 0,
    pointExpiresAt: null,
    discountFlat: 0,
    discountPct: 0,
    prepaidBonus: 0,
    issueCoupons: [],
    virtualCoupons: [],
    appliedEvents: [],
  }
  if (!Array.isArray(events)) return result
  const now = new Date()

  events.forEach(evt => {
    if (!evt?.enabled) return
    if (!evaluateTrigger(evt, ctx)) return

    result.appliedEvents.push(evt)
    const base = baseAmount(evt, ctx)

    switch (evt.rewardType) {
      case 'point_earn': {
        const earn = Math.round(base * (Number(evt.rate)||0) / 100)
        if (earn > 0) {
          result.pointEarn += earn
          if (evt.expiryMonths && !result.pointExpiresAt) {
            const d = new Date(now); d.setMonth(d.getMonth() + Number(evt.expiryMonths))
            result.pointExpiresAt = d.toISOString()
          }
        }
        break
      }
      case 'discount_pct': {
        result.discountPct += Number(evt.rate)||0
        break
      }
      case 'discount_flat': {
        result.discountFlat += Number(evt.value)||0
        break
      }
      case 'coupon_issue': {
        const qty = Math.max(1, Number(evt.qty)||1)
        let exp = null
        if (evt.expiryMonths) {
          const d = new Date(now); d.setMonth(d.getMonth() + Number(evt.expiryMonths))
          exp = d.toISOString()
        }
        result.issueCoupons.push({ name: evt.couponName, qty, expiresAt: exp, evtName: evt.name })
        break
      }
      case 'prepaid_bonus': {
        const bonus = Math.round((ctx.prepaidPurchaseAmount||0) * (Number(evt.rate)||0) / 100)
        if (bonus > 0) result.prepaidBonus += bonus
        break
      }
      case 'free_service': {
        // 특정 시술 무료 — 기존 쿠폰 엔진이 처리하는 형태의 가상 쿠폰으로 주입
        // (serviceIds 지정 필요 — 설정에 evt.serviceIds)
        if (Array.isArray(evt.serviceIds) && evt.serviceIds.length) {
          result.virtualCoupons.push({
            _virtual: true,
            id: 'evt_v_' + evt.id,
            service_name: evt.name,
            promoConfig: {
              couponType: 'free_service',
              couponTarget: 'specific_service',
              couponTargetServiceIds: evt.serviceIds,
              autoApply: true,
              consumeOnUse: false, // 이벤트는 소진 없이 일회성 트리거
            }
          })
        }
        break
      }
      default:
        break
    }
  })

  return result
}

export default { evaluateTrigger, applyEvents }
