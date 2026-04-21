// ═══════════════════════════════════════════════════════════════
// 이벤트 엔진 v2 — 매출 등록 시 활성 이벤트 평가 + 보상 계산
// 범용 엔진: 매장별 커스텀 코드 없이 설정(events 배열)만으로 동작
//
// 이벤트 스키마:
// {
//   id, name, enabled, desc,
//   trigger: 'new_first_sale' | 'prepaid_purchase' | 'pkg_purchase' | 'annual_purchase' | 'any_sale',
//   // 레거시: 'prepaid_recharge' | 'pkg_repurchase' 도 허용
//   conditions: {
//     servicesAny, servicesAll, servicesNone,    // service id 배열
//     categoriesAny,                              // category id 배열
//     prepaidServiceIds, pkgServiceIds, annualServiceIds,  // 정확 매칭
//     amountMin, amountMax,                       // 시술합계 또는 충전금액
//     customerHasActivePrepaid, customerHasActivePkg, customerHasActiveAnnual, // null|true|false
//   },
//   rewards: [                                    // 최대 3개
//     { type:'point_earn', base:'svc'|'svc_prod'|'prepaid_amount'|'pkg_amount'|'category'|'services'|'fixed', rate, value, expiryMonths, baseCategoryIds, baseServiceIds },
//     { type:'discount_pct', rate, base, baseCategoryIds, baseServiceIds },
//     { type:'discount_flat', value },
//     { type:'coupon_issue', couponName, qty, expiryMonths },
//     { type:'prepaid_bonus', rate },
//     { type:'free_service', serviceIds },
//   ],
//   // 레거시 단일 보상 필드: rewardType/base/rate/value/couponName/qty/expiryMonths → 자동 래핑
// }
// ═══════════════════════════════════════════════════════════════

/**
 * 레거시 이벤트를 신규 스키마로 정규화
 *   - rewardType 필드만 있고 rewards 배열이 없으면 rewards[0]로 래핑
 *   - trigger 'prepaid_recharge'/'pkg_repurchase'는 *_purchase + 기존 보유 조건으로 변환
 */
function normalize(evt) {
  if (!evt || typeof evt !== 'object') return evt
  const out = { ...evt, conditions: { ...(evt.conditions||{}) } }

  // 레거시 트리거 변환
  if (out.trigger === 'prepaid_recharge') {
    out.trigger = 'prepaid_purchase'
    if (out.conditions.customerHasActivePrepaid == null) out.conditions.customerHasActivePrepaid = true
  } else if (out.trigger === 'pkg_repurchase') {
    out.trigger = 'pkg_purchase'
    if (out.conditions.customerHasActivePkg == null) out.conditions.customerHasActivePkg = true
  }

  // 레거시 단일 보상 → rewards[]
  if (!Array.isArray(out.rewards) || out.rewards.length === 0) {
    if (out.rewardType) {
      const r = { type: out.rewardType }
      if (out.rewardType === 'discount') r.type = 'discount_pct' // 더 과거 레거시
      if (out.base !== undefined) r.base = out.base
      if (out.rate !== undefined) r.rate = out.rate
      if (out.value !== undefined) r.value = out.value
      if (out.couponName !== undefined) r.couponName = out.couponName
      if (out.qty !== undefined) r.qty = out.qty
      if (out.expiryMonths !== undefined) r.expiryMonths = out.expiryMonths
      if (out.baseCategoryIds !== undefined) r.baseCategoryIds = out.baseCategoryIds
      if (out.baseServiceIds !== undefined) r.baseServiceIds = out.baseServiceIds
      if (out.serviceIds !== undefined) r.serviceIds = out.serviceIds
      out.rewards = [r]
    } else {
      out.rewards = []
    }
  }

  return out
}

/**
 * 트리거 평가
 */
export function evaluateTrigger(evt, ctx) {
  const t = evt.trigger
  if (t === 'any_sale') return true
  if (t === 'new_first_sale') return !!ctx.isNewCustomer
  if (t === 'prepaid_purchase') return !!ctx.hasAnyPrepaidPurchase
  if (t === 'pkg_purchase') return !!ctx.hasAnyPkgPurchase
  if (t === 'annual_purchase') return !!ctx.hasAnyAnnualPurchase
  return false
}

/**
 * 조건 AND 평가 — 모든 조건이 true여야 통과
 */
export function evaluateConditions(evt, ctx) {
  const c = evt.conditions || {}
  const items = ctx.items || {}
  const checkedSvcIds = new Set(
    (ctx.svcList || []).filter(s => items[s.id]?.checked).map(s => s.id)
  )
  const checkedCatIds = new Set(
    (ctx.svcList || []).filter(s => items[s.id]?.checked).map(s => s.cat).filter(Boolean)
  )

  // 시술 포함 조건
  if (Array.isArray(c.servicesAny) && c.servicesAny.length) {
    if (!c.servicesAny.some(id => checkedSvcIds.has(id))) return false
  }
  if (Array.isArray(c.servicesAll) && c.servicesAll.length) {
    if (!c.servicesAll.every(id => checkedSvcIds.has(id))) return false
  }
  if (Array.isArray(c.servicesNone) && c.servicesNone.length) {
    if (c.servicesNone.some(id => checkedSvcIds.has(id))) return false
  }
  if (Array.isArray(c.categoriesAny) && c.categoriesAny.length) {
    if (!c.categoriesAny.some(id => checkedCatIds.has(id))) return false
  }

  // 다담권/패키지/연간 상품 정확 매칭
  const prepaidIds = new Set((ctx.newPrepaidItems || []).map(it => it.id))
  const pkgIds = new Set((ctx.newPkgItems || []).map(it => it.id))
  const annualIds = new Set((ctx.newAnnualItems || []).map(it => it.id))
  if (Array.isArray(c.prepaidServiceIds) && c.prepaidServiceIds.length) {
    if (!c.prepaidServiceIds.some(id => prepaidIds.has(id))) return false
  }
  if (Array.isArray(c.pkgServiceIds) && c.pkgServiceIds.length) {
    if (!c.pkgServiceIds.some(id => pkgIds.has(id))) return false
  }
  if (Array.isArray(c.annualServiceIds) && c.annualServiceIds.length) {
    if (!c.annualServiceIds.some(id => annualIds.has(id))) return false
  }

  // 금액 범위 — 트리거 맥락에 따라 기준 금액 결정
  const amtForRange = (() => {
    if (evt.trigger === 'prepaid_purchase') return ctx.prepaidPurchaseAmount || 0
    if (evt.trigger === 'pkg_purchase') return ctx.pkgPurchaseAmount || 0
    if (evt.trigger === 'annual_purchase') return ctx.annualPurchaseAmount || 0
    return (ctx.svcTotal || 0) + (ctx.prodTotal || 0)
  })()
  if (c.amountMin != null && c.amountMin !== '' && Number(c.amountMin) > 0) {
    if (amtForRange < Number(c.amountMin)) return false
  }
  if (c.amountMax != null && c.amountMax !== '' && Number(c.amountMax) > 0) {
    if (amtForRange > Number(c.amountMax)) return false
  }

  // 고객 상태 플래그
  if (c.customerHasActivePrepaid === true && !ctx.hasActivePrepaid) return false
  if (c.customerHasActivePrepaid === false && ctx.hasActivePrepaid) return false
  if (c.customerHasActivePkg === true && !ctx.hasActivePkg) return false
  if (c.customerHasActivePkg === false && ctx.hasActivePkg) return false
  if (c.customerHasActiveAnnual === true && !ctx.hasActiveAnnual) return false
  if (c.customerHasActiveAnnual === false && ctx.hasActiveAnnual) return false

  // 결제 수단 플래그 (이번 매출의 결제 수단 사용 여부)
  if (c.paymentUsesPrepaid === true && !ctx.paymentUsesPrepaid) return false
  if (c.paymentUsesPrepaid === false && ctx.paymentUsesPrepaid) return false
  if (c.paymentUsesPoint === true && !ctx.paymentUsesPoint) return false
  if (c.paymentUsesPoint === false && ctx.paymentUsesPoint) return false
  if (c.paymentUsesCoupon === true && !ctx.paymentUsesCoupon) return false
  if (c.paymentUsesCoupon === false && ctx.paymentUsesCoupon) return false

  return true
}

/**
 * 적립/할인 기준 금액 계산
 */
function baseAmount(reward, ctx) {
  const base = reward.base || 'svc'
  if (base === 'svc_prod') return (ctx.svcTotal||0) + (ctx.prodTotal||0)
  if (base === 'net_pay') return ctx.netAmount || 0 // 할인 후 실결제액 (2-pass에서 계산됨)
  if (base === 'prepaid_amount') return ctx.prepaidPurchaseAmount || 0
  if (base === 'pkg_amount') return ctx.pkgPurchaseAmount || 0
  if (base === 'annual_amount') return ctx.annualPurchaseAmount || 0
  if (base === 'fixed') return 0 // 고정금액은 rate가 아니라 value 사용
  if (base === 'category' && Array.isArray(reward.baseCategoryIds) && reward.baseCategoryIds.length) {
    const items = ctx.items || {}
    const svcList = ctx.svcList || []
    return svcList.reduce((sum, s) => {
      if (!reward.baseCategoryIds.includes(s.cat)) return sum
      const it = items[s.id]
      if (!it?.checked) return sum
      return sum + (it.amount || 0)
    }, 0)
  }
  if (base === 'services' && Array.isArray(reward.baseServiceIds) && reward.baseServiceIds.length) {
    const items = ctx.items || {}
    return reward.baseServiceIds.reduce((sum, sid) => {
      const it = items[sid]
      if (!it?.checked) return sum
      return sum + (it.amount || 0)
    }, 0)
  }
  return ctx.svcTotal || 0 // default
}

/**
 * 단일 보상 적용 → result 누적
 */
function applyReward(reward, evt, ctx, result, now) {
  switch (reward.type) {
    case 'point_earn': {
      let earn = 0
      if (reward.base === 'fixed') {
        earn = Math.round(Number(reward.value) || 0)
      } else {
        const b = baseAmount(reward, ctx)
        earn = Math.round(b * (Number(reward.rate)||0) / 100)
      }
      if (earn > 0) {
        result.pointEarn += earn
        if (reward.expiryMonths && !result.pointExpiresAt) {
          const d = new Date(now); d.setMonth(d.getMonth() + Number(reward.expiryMonths))
          result.pointExpiresAt = d.toISOString()
        }
      }
      break
    }
    case 'discount_pct':
    case 'discount': { // 레거시
      // 트리거가 구매 계열이면 해당 풀의 pct로 분리 (현재는 시술·제품만 pct 지원)
      result.discountPct += Number(reward.rate)||0
      break
    }
    case 'discount_flat': {
      const val = Number(reward.value)||0
      // 트리거별 할인 풀 분리 — 패키지/다담권/연간권 구매 할인은 해당 구매 금액에만 적용
      if (evt.trigger === 'pkg_purchase') result.discountFlatPkg = (result.discountFlatPkg||0) + val
      else if (evt.trigger === 'prepaid_purchase') result.discountFlatPrepaid = (result.discountFlatPrepaid||0) + val
      else if (evt.trigger === 'annual_purchase') result.discountFlatAnnual = (result.discountFlatAnnual||0) + val
      else result.discountFlat += val
      break
    }
    case 'coupon_issue': {
      const qty = Math.max(1, Number(reward.qty)||1)
      let exp = null
      if (reward.expiryMonths) {
        const d = new Date(now); d.setMonth(d.getMonth() + Number(reward.expiryMonths))
        exp = d.toISOString()
      }
      if (reward.couponName) {
        result.issueCoupons.push({ name: reward.couponName, qty, expiresAt: exp, evtName: evt.name })
      }
      break
    }
    case 'prepaid_bonus': {
      const bonus = Math.round((ctx.prepaidPurchaseAmount||0) * (Number(reward.rate)||0) / 100)
      if (bonus > 0) result.prepaidBonus += bonus
      break
    }
    case 'free_service': {
      if (Array.isArray(reward.serviceIds) && reward.serviceIds.length) {
        result.virtualCoupons.push({
          _virtual: true,
          id: 'evt_v_' + evt.id + '_' + (reward._idx||0),
          service_name: evt.name,
          promoConfig: {
            couponType: 'free_service',
            couponTarget: 'specific_service',
            couponTargetServiceIds: reward.serviceIds,
            autoApply: true,
            consumeOnUse: false,
          }
        })
      }
      break
    }
    default: break
  }
}

/**
 * 활성 이벤트 목록 평가 → 누적 보상
 */
export function applyEvents(events, ctx) {
  const result = {
    pointEarn: 0,
    pointExpiresAt: null,
    discountFlat: 0,        // 시술·제품 대상 (new_first_sale / any_sale)
    discountFlatPkg: 0,     // 패키지 구매 자체 할인
    discountFlatPrepaid: 0, // 다담권 구매 자체 할인
    discountFlatAnnual: 0,  // 연간권 구매 자체 할인
    discountPct: 0,
    prepaidBonus: 0,
    issueCoupons: [],
    virtualCoupons: [],
    appliedEvents: [],
  }
  if (!Array.isArray(events)) return result
  const now = new Date()

  // Pass 1: 트리거·조건 평가 + 할인·쿠폰·다담권 보너스 집계 (point_earn은 건너뜀)
  events.forEach(rawEvt => {
    if (!rawEvt?.enabled) return
    const evt = normalize(rawEvt)
    if (!evaluateTrigger(evt, ctx)) return
    if (!evaluateConditions(evt, ctx)) return

    result.appliedEvents.push(evt)
    const rewards = Array.isArray(evt.rewards) ? evt.rewards : []
    rewards.forEach((reward, idx) => {
      if (reward.type === 'point_earn') return
      applyReward({ ...reward, _idx: idx }, evt, ctx, result, now)
    })
  })

  // 할인 후 실결제액(netAmount) 계산 — point_earn base='net_pay'에서 사용
  const netAmount = Math.max(0,
    (ctx.svcTotal||0) + (ctx.prodTotal||0)
    - (result.discountFlat||0)
    - Math.round((ctx.svcTotal||0) * (result.discountPct||0) / 100)
  )
  const ctx2 = { ...ctx, netAmount }

  // Pass 2: point_earn만 계산 (netAmount 반영)
  result.appliedEvents.forEach(evt => {
    const rewards = Array.isArray(evt.rewards) ? evt.rewards : []
    rewards.forEach((reward, idx) => {
      if (reward.type !== 'point_earn') return
      applyReward({ ...reward, _idx: idx }, evt, ctx2, result, now)
    })
  })

  return result
}

export default { evaluateTrigger, evaluateConditions, applyEvents }
