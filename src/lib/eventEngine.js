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
//     paymentMethodType,                           // null|'cash'|'card' — 무관/현금만/카드만
//     customerQualify: { any:[], M:[], F:[] },     // 성별별 자격 리스트 (OR). 각 컬럼 qualifier: 'new'|'prepaid'|'barf'|'pkg'|'annual'
//       - 전부 비어있음 → 조건 무시 (모두 통과)
//       - 고객 성별 M이면 any+M의 합집합이 applicable (OR 평가)
//       - applicable이 비어있으면 fail (해당 성별은 이 이벤트 대상 아님)
//     prepaidMinRatioPct: { any:0, M:0, F:0 },     // 0~100, 컬럼별 — 'prepaid' qualifier + 컬럼별 추가 제약
//     prepaidMinBalance: { any:0, M:0, F:0 },      // 원 단위, 컬럼별 — 'prepaid' qualifier + 컬럼별 추가 제약
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
  const c = out.conditions

  // 레거시 트리거 변환
  if (out.trigger === 'prepaid_recharge') {
    out.trigger = 'prepaid_purchase'
    if (c.customerHasActivePrepaid == null) c.customerHasActivePrepaid = true
  } else if (out.trigger === 'pkg_repurchase') {
    out.trigger = 'pkg_purchase'
    if (c.customerHasActivePkg == null) c.customerHasActivePkg = true
  }

  // 레거시 고객상태 flag (TriFlag) → customerQualifyAny 배열로 승격 (1차 마이그레이션)
  if (!Array.isArray(c.customerQualifyAny) && !c.customerQualify) {
    const q = []
    if (c.customerIsNew === true) q.push('new')
    if (c.customerHasActivePrepaid === true) q.push('prepaid')
    if (c.customerHasActivePkg === true) q.push('pkg')
    if (c.customerHasActiveAnnual === true) q.push('annual')
    c.customerQualifyAny = q
  }
  // customerQualifyAny + customerGender → customerQualify {any,M,F} (2차 마이그레이션)
  if (!c.customerQualify || typeof c.customerQualify !== 'object') {
    const qa = Array.isArray(c.customerQualifyAny) ? c.customerQualifyAny : []
    const cq = { any: [], M: [], F: [] }
    if (c.customerGender === 'M') cq.M = qa
    else if (c.customerGender === 'F') cq.F = qa
    else cq.any = qa
    c.customerQualify = cq
  }
  // 누락된 컬럼 보강
  if (!Array.isArray(c.customerQualify.any)) c.customerQualify.any = []
  if (!Array.isArray(c.customerQualify.M)) c.customerQualify.M = []
  if (!Array.isArray(c.customerQualify.F)) c.customerQualify.F = []
  // prepaidMinRatioPct/Balance: number → {any,M,F} 마이그레이션
  if (typeof c.prepaidMinRatioPct === 'number') {
    const legacyGender = c.customerGender
    const obj = { any:0, M:0, F:0 }
    if (legacyGender === 'M') obj.M = c.prepaidMinRatioPct
    else if (legacyGender === 'F') obj.F = c.prepaidMinRatioPct
    else obj.any = c.prepaidMinRatioPct
    c.prepaidMinRatioPct = obj
  } else if (!c.prepaidMinRatioPct || typeof c.prepaidMinRatioPct !== 'object') {
    c.prepaidMinRatioPct = { any:0, M:0, F:0 }
  }
  if (typeof c.prepaidMinBalance === 'number') {
    const legacyGender = c.customerGender
    const obj = { any:0, M:0, F:0 }
    if (legacyGender === 'M') obj.M = c.prepaidMinBalance
    else if (legacyGender === 'F') obj.F = c.prepaidMinBalance
    else obj.any = c.prepaidMinBalance
    c.prepaidMinBalance = obj
  } else if (!c.prepaidMinBalance || typeof c.prepaidMinBalance !== 'object') {
    c.prepaidMinBalance = { any:0, M:0, F:0 }
  }
  if (!c.barfMinRatioPct || typeof c.barfMinRatioPct !== 'object') c.barfMinRatioPct = { any:0, M:0, F:0 }
  if (!c.barfMinBalance || typeof c.barfMinBalance !== 'object') c.barfMinBalance = { any:0, M:0, F:0 }

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

  // 보유권 EXCLUSION (TriFlag false = 보유 시 제외)
  // 예: "첫방문 5만 할인" 이벤트에 customerHasActivePkg=false → 패키지 보유 고객 제외
  if (c.customerHasActivePrepaid === false && ctx.hasActivePrepaid) return false
  if (c.customerHasActivePkg === false && ctx.hasActivePkg) return false
  if (c.customerHasActiveAnnual === false && ctx.hasActiveAnnual) return false

  // 시술 포함 조건
  if (Array.isArray(c.servicesAny) && c.servicesAny.length) {
    if (!c.servicesAny.some(id => checkedSvcIds.has(id))) return false
  }
  if (Array.isArray(c.servicesAll) && c.servicesAll.length) {
    if (!c.servicesAll.every(id => checkedSvcIds.has(id))) return false
  }
  if (Array.isArray(c.servicesNone) && c.servicesNone.length) {
    // 카트에 담긴 시술 중 제외 ID 있으면 미반영
    if (c.servicesNone.some(id => checkedSvcIds.has(id))) return false
    // 추가: 고객이 이미 보유한 보유권(다담권/패키지/연간권)도 제외 ID와 동일 시술명이면 미반영
    // 예: "첫방문 5만 할인" 제외 목록에 "다담권 50만" 추가 → 다담권 50만 보유 고객 자동 제외
    const ownedPkgNames = new Set((ctx.customerPkgs || []).map(p => p.service_name).filter(Boolean))
    if (ownedPkgNames.size > 0) {
      const noneNames = c.servicesNone.map(id => {
        const sv = (ctx.svcList || []).find(s => s.id === id)
        return sv?.name
      }).filter(Boolean)
      if (noneNames.some(n => ownedPkgNames.has(n))) return false
    }
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

  // 고객 자격 (성별별 OR) — customerQualify: {any, M, F}
  const cq = c.customerQualify || { any:[], M:[], F:[] }
  const qAny = Array.isArray(cq.any) ? cq.any : []
  const qM = Array.isArray(cq.M) ? cq.M : []
  const qF = Array.isArray(cq.F) ? cq.F : []
  const hasAnyCheck = qAny.length > 0 || qM.length > 0 || qF.length > 0
  if (hasAnyCheck) {
    // [col, qual] 쌍으로 구성 — 컬럼별 임계값 참조용
    const pairs = []
    qAny.forEach(q => pairs.push(['any', q]))
    if (ctx.customerGender === 'M') qM.forEach(q => pairs.push(['M', q]))
    else if (ctx.customerGender === 'F') qF.forEach(q => pairs.push(['F', q]))
    if (pairs.length === 0) return false
    const getPct = (col) => Number((c.prepaidMinRatioPct||{})[col] || 0)
    const getBal = (col) => Number((c.prepaidMinBalance||{})[col] || 0)
    const checkPair = (col, qual) => {
      if (qual === 'new') return !!ctx.isNewCustomer
      if (qual === 'prepaid') {
        if (!ctx.hasActivePrepaid) return false
        const pctT = getPct(col), balT = getBal(col)
        if (pctT > 0 && Number(ctx.prepaidBalanceRatioPct || 0) < pctT) return false
        if (balT > 0 && Number(ctx.prepaidMaxBalance || 0) < balT) return false
        return true
      }
      if (qual === 'barf') {
        if (!ctx.hasActiveBarf) return false
        const pctT = Number((c.barfMinRatioPct||{})[col] || 0)
        const balT = Number((c.barfMinBalance||{})[col] || 0)
        if (pctT > 0 && Number(ctx.barfBalanceRatioPct || 0) < pctT) return false
        if (balT > 0 && Number(ctx.barfMaxBalance || 0) < balT) return false
        return true
      }
      if (qual === 'pkg') return !!ctx.hasActivePkg
      if (qual === 'annual') return !!ctx.hasActiveAnnual
      return false
    }
    if (!pairs.some(([col, q]) => checkPair(col, q))) return false
  }

  // 결제 방식 (이번 매출의 결제 수단) — 'cash' | 'card' | null(무관)
  if (c.paymentMethodType === 'cash' && !ctx.paymentUsesCash) return false
  if (c.paymentMethodType === 'card' && !ctx.paymentUsesCard) return false

  return true
}

/**
 * 적립/할인 기준 금액 계산
 *
 * baseCategoryIds / baseServiceIds 가 설정되면 base 종류와 무관하게 그 카테고리/시술로 한정.
 * - svc / svc_prod / category / services: 카트 합계만 계산 (할인 전)
 * - net_pay: 카트 합계의 비율로 net_pay 비례 배분 (할인 후)
 */
function baseAmount(reward, ctx) {
  const base = reward.base || 'svc'
  if (base === 'fixed') return 0 // 고정금액은 rate가 아니라 value 사용
  if (base === 'prepaid_amount') return ctx.prepaidPurchaseAmount || 0
  if (base === 'pkg_amount') return ctx.pkgPurchaseAmount || 0
  if (base === 'annual_amount') return ctx.annualPurchaseAmount || 0

  const items = ctx.items || {}
  const svcList = ctx.svcList || []
  const hasCatFilter = Array.isArray(reward.baseCategoryIds) && reward.baseCategoryIds.length > 0
  const hasSvcFilter = Array.isArray(reward.baseServiceIds) && reward.baseServiceIds.length > 0

  // 카테고리/시술 필터가 있으면 — base 종류와 무관하게 그 시술 합계만 사용
  if (hasCatFilter || hasSvcFilter || base === 'category' || base === 'services') {
    const matchedSubtotal = svcList.reduce((sum, s) => {
      const it = items[s.id]
      if (!it?.checked) return sum
      if (hasSvcFilter && !reward.baseServiceIds.includes(s.id)) return sum
      if (hasCatFilter && !reward.baseCategoryIds.includes(s.cat)) return sum
      return sum + (it.amount || 0)
    }, 0)

    // net_pay base + 카테고리/시술 필터:
    //   매칭 대상이 모두 시술이면 → svcNetAmount(=시술합계-시술할인) 기준 비례
    //   매칭 대상이 제품 포함이면 → 전체 net_pay 비례 (혼합 fallback)
    if (base === 'net_pay') {
      // 시술 단독 매칭 판정 (제품이 아닌 시술만 매칭됐는지)
      const prodIds = new Set((ctx.prodList || []).map(p => p.id))
      const matchedItems = svcList.filter(s => {
        const it = items[s.id]; if (!it?.checked) return false
        if (hasSvcFilter && !reward.baseServiceIds.includes(s.id)) return false
        if (hasCatFilter && !reward.baseCategoryIds.includes(s.cat)) return false
        return true
      })
      const allSvc = matchedItems.length > 0 && matchedItems.every(s => !prodIds.has(s.id))
      if (allSvc && (ctx.svcTotal || 0) > 0) {
        // 시술합계 대비 매칭 비율 × 시술 실결제액
        const ratio = matchedSubtotal / (ctx.svcTotal || 1)
        return Math.round((ctx.svcNetAmount || 0) * ratio)
      }
      // fallback: 매출 전체 net_pay 비례
      const grossTotal = (ctx.svcTotal || 0) + (ctx.prodTotal || 0)
      if (grossTotal <= 0) return 0
      const ratio = (ctx.netAmount || 0) / grossTotal
      return Math.round(matchedSubtotal * ratio)
    }
    return matchedSubtotal
  }

  if (base === 'svc_prod') return (ctx.svcTotal||0) + (ctx.prodTotal||0)
  if (base === 'net_pay') return ctx.netAmount || 0
  return ctx.svcTotal || 0 // svc default
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
        // trigger·expiryMonths도 같이 전달 (SaleForm에서 보유권 연결 처리에 사용)
        result.issueCoupons.push({
          name: reward.couponName, qty, expiresAt: exp, evtName: evt.name,
          trigger: evt.trigger, expiryMonths: Number(reward.expiryMonths) || 0,
        })
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
  // externalDiscount: 엔진 외부 차감 (수동 할인 + 쿠폰 + 프로모 + 체험단)
  const netAmount = Math.max(0,
    (ctx.svcTotal||0) + (ctx.prodTotal||0)
    - (result.discountFlat||0)
    - Math.round((ctx.svcTotal||0) * (result.discountPct||0) / 100)
    - (ctx.externalDiscount||0)
  )
  // 시술 실결제액 — 시술합계 - 시술 적용 할인 (point_earn 카테고리 기준 적립에 사용)
  const svcDiscountTotal = (result.discountFlat||0)
    + Math.round((ctx.svcTotal||0) * (result.discountPct||0) / 100)
    + (ctx.externalSvcDiscount||0)
  const svcNetAmount = Math.max(0, (ctx.svcTotal||0) - svcDiscountTotal)
  const ctx2 = { ...ctx, netAmount, svcNetAmount }

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
