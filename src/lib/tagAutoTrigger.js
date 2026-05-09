/**
 * 시술태그 자동 부여 트리거 평가 엔진
 *
 * service_tags.auto_trigger jsonb에 매장이 등록한 트리거 설정을 기반으로,
 * 예약/고객/보유권 데이터를 평가해 자동으로 부여될 태그 ID 배열을 반환.
 *
 * 트리거 타입 (확장 가능):
 *  - is_new_customer        : 미등록 고객 또는 visits=0
 *  - package_low_count      : 보유 패키지/다회권 잔여 회수 ≤ threshold (기본 1)
 *  - package_expired        : 보유 패키지/연간권/쿠폰의 유효기간 지남
 *  - coupon_expiring_days   : 쿠폰의 만료가 N일 이내
 *  - customer_inactive_days : 마지막 방문이 N일 이상 지남 (기존상담)
 */

// ─── 트리거 카탈로그 (UI 드롭다운 + 파라미터 라벨용) ─────────────────────────
// param.type: 'number' | 'bool' | 'category_multi' | 'service_multi'  (UI 렌더 분기)
export const TAG_TRIGGER_TYPES = [
  { type: 'is_new_customer',        label: '🆕 처음 오신 손님' },
  { type: 'package_low_count',      label: '📦 보유권 횟수가 거의 다 됐을 때',
    params: [
      { key: 'threshold', label: '회 이하 남았을 때', type: 'number', default: 1 },
      { key: 'categoryIds', label: '어떤 종류의 보유권을 볼까요? (비우면 패키지+연간권)', type: 'category_multi', default: [] },
      { key: 'serviceIds', label: '특정 시술만 따질까요? (비우면 위 카테고리 전체)', type: 'service_multi', default: [] },
      { key: 'matchReservationService', label: '오늘 예약한 시술과 같은 종류만 따지기', type: 'bool', default: false },
    ]
  },
  { type: 'package_expired',        label: '⌛ 보유권이 이미 만료됐을 때',
    params: [
      { key: 'categoryIds', label: '어떤 종류의 보유권을 볼까요? (비우면 전체)', type: 'category_multi', default: [] },
    ]
  },
  { type: 'coupon_expiring_days',   label: '🎫 쿠폰 만료가 다가올 때',
    params: [{ key: 'days', label: '일 이내로 만료', type: 'number', default: 7 }]
  },
  { type: 'customer_inactive_days', label: '😴 오랫동안 안 오신 손님',
    params: [{ key: 'days', label: '일 이상 안 오셨을 때', type: 'number', default: 90 }]
  },
];

// 트리거 + 현재 params를 한 문장 자연어로 변환 (자동태그 설정 화면 미리보기용)
// ctx: { categories, services, tagName }
export function describeTrigger(trigger, ctx = {}) {
  if (!trigger || !trigger.type) return '';
  const cats = ctx.categories || [];
  const svcs = ctx.services || [];
  const tagName = ctx.tagName || '이 태그';
  const t = trigger;
  const catNames = (ids) => (ids||[]).map(id => cats.find(c=>c.id===id)?.name).filter(Boolean).join(', ');
  const svcLabel = (ids) => {
    const list = (ids||[]).map(id => svcs.find(s=>s.id===id)?.name).filter(Boolean);
    if (list.length === 0) return '';
    if (list.length <= 2) return list.join(', ');
    return list.slice(0,2).join(', ') + ` 외 ${list.length-2}개`;
  };
  let who = '';
  switch (t.type) {
    case 'is_new_customer':
      who = '미등록이거나 처음 방문한 손님';
      break;
    case 'package_low_count': {
      const n = t.threshold ?? 1;
      let scope = '보유권';
      if (Array.isArray(t.serviceIds) && t.serviceIds.length) scope = svcLabel(t.serviceIds);
      else if (Array.isArray(t.categoryIds) && t.categoryIds.length) scope = catNames(t.categoryIds);
      const matchPart = t.matchReservationService ? ' (오늘 예약 시술과 같은 종류만)' : '';
      who = `${scope} 잔여 ${n}회 이하인 손님${matchPart}`;
      break;
    }
    case 'package_expired': {
      let scope = '보유권';
      if (Array.isArray(t.categoryIds) && t.categoryIds.length) scope = catNames(t.categoryIds);
      who = `${scope}이(가) 이미 만료된 손님 (활성 보유권 없음)`;
      break;
    }
    case 'coupon_expiring_days':
      who = `쿠폰이 ${t.days ?? 7}일 안에 만료되는 손님`;
      break;
    case 'customer_inactive_days':
      who = `마지막 방문이 ${t.days ?? 90}일 이상 지난 손님`;
      break;
    default:
      return '';
  }
  return `${who}에게 ${tagName}가 자동으로 붙어요`;
}

// 패키지 유효기간 파싱 — note 안의 "유효:YYYY-MM-DD" 패턴 우선, 없으면 expires_at, 또는 무제한
function _pkgExpiresAt(pkg) {
  if (!pkg) return null;
  const note = pkg.note || '';
  const m = String(note).match(/유효[:：]\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (pkg.expires_at) return String(pkg.expires_at).slice(0, 10);
  return null;
}

function _isExpired(pkg, todayStr) {
  const exp = _pkgExpiresAt(pkg);
  if (!exp) return false; // 만료일 없으면 무제한 → 만료 X
  return exp < todayStr;
}

function _daysUntilExpire(pkg, today) {
  const exp = _pkgExpiresAt(pkg);
  if (!exp) return Infinity;
  const e = new Date(exp + 'T00:00:00');
  const diff = Math.floor((e - today) / 86400000);
  return diff;
}

function _remainingCount(pkg) {
  // 다회권: total_count - used_count (남은 회수). 다담권(잔액제 won)은 패스.
  const t = Number(pkg?.total_count || 0);
  const u = Number(pkg?.used_count || 0);
  if (t <= 0) return Infinity;
  return Math.max(0, t - u);
}

// 다담권(잔액제) 식별 — note에 "잔액:NNN" 패턴이 있거나 service_name에 다담권/바프권 키워드
function _isPrepaid(pkg) {
  const note = String(pkg?.note || '');
  if (/잔액\s*[:：]\s*[0-9]/.test(note)) return true;
  const name = String(pkg?.service_name || '');
  if (/다담권|바프권/.test(name)) return true;
  return false;
}

// 쿠폰 식별 — service_name에 "쿠폰" 키워드만 (note의 "쿠폰SEQ:"는 네이버 결제 추적 번호라 X)
// 쿠폰은 다회권/패키지와 의미 다름 — 마지막회차/기존상담 트리거 대상 X
function _isCoupon(pkg) {
  const name = String(pkg?.service_name || '');
  if (/쿠폰/.test(name)) return true;
  return false;
}

// 활성 보유권 보유 여부 — 다담권 잔액>0 또는 다회권/연간권 잔여>0 + 비만료 (쿠폰 제외)
function _hasActivePackage(custPkgs, todayStr) {
  return (custPkgs || []).some(p => {
    if (_isCoupon(p)) return false;
    if (_isExpired(p, todayStr)) return false;
    // 다담권: note의 "잔액:N" > 0
    if (_isPrepaid(p)) {
      const m = String(p?.note || '').match(/잔액\s*[:：]\s*([0-9,]+)/);
      const bal = m ? Number(m[1].replace(/,/g,'')) : 0;
      return bal > 0;
    }
    // 다회권/연간권: total>0 + 잔여>0
    if (Number(p.total_count || 0) <= 0) return false;
    return _remainingCount(p) > 0;
  });
}

// 패키지 카테고리 ID 식별 — services에서 cat 조회 + service_categories에서 "패키지" 카테고리 ID 매칭
function _isPackageCategory(pkg, services, packageCatIds) {
  if (!packageCatIds || !packageCatIds.size) return true; // cat 정보 없으면 종전대로 모두 허용
  const sid = pkg?.service_id;
  if (!sid) return false;
  const svc = (services || []).find(s => s.id === sid);
  if (!svc) return false;
  return packageCatIds.has(svc.cat);
}

/**
 * 단일 트리거 평가
 * @returns boolean
 */
export function evaluateTrigger(trigger, ctx) {
  if (!trigger || !trigger.type) return false;
  const { customer, custPkgs = [], todayStr, services = [], packageCatIds = null, hasPaidSale = null } = ctx;
  const today = new Date(todayStr + 'T00:00:00');

  switch (trigger.type) {
    case 'is_new_customer': {
      if (!customer) return true;
      // 미방문(visits=0) → 신규
      if (Number(customer.visits || 0) === 0) return true;
      // visits 있어도 유료 매출(>0원) 0건이면 신규로 취급 (체험단 케이스)
      // hasPaidSale가 명시적으로 false면 신규. null/undefined(미체크)면 visits만 보고 판단(이전 동작 유지).
      if (hasPaidSale === false) return true;
      return false;
    }
    case 'package_low_count': {
      const threshold = Number(trigger.threshold ?? 1);
      const userCatIds = Array.isArray(trigger.categoryIds) ? new Set(trigger.categoryIds.filter(Boolean)) : null;
      const userSvcIds = Array.isArray(trigger.serviceIds) ? new Set(trigger.serviceIds.filter(Boolean)) : null;
      const matchRes = !!trigger.matchReservationService;
      // 예약 시술이 있으면 그 시술의 카테고리 set + 시술 ID set 추출
      const _resSvcIds = Array.isArray(ctx.reservationServiceIds) ? ctx.reservationServiceIds.filter(Boolean) : [];
      const _resCatIds = new Set(_resSvcIds.map(sid => (services||[]).find(s => s.id === sid)?.cat).filter(Boolean));
      // 매장 설정한 카테고리 우선, 없으면 디폴트 패키지+회원권
      const effectiveCatIds = (userCatIds && userCatIds.size) ? userCatIds : packageCatIds;
      return custPkgs.some(p => {
        if (_isPrepaid(p)) return false;
        if (_isCoupon(p)) return false;
        if (Number(p.total_count || 0) <= 0) return false;
        const rem = _remainingCount(p);
        if (rem <= 0) return false;
        if (_isExpired(p, todayStr)) return false;
        // 시술 ID 필터 (가장 정밀)
        if (userSvcIds && userSvcIds.size && !userSvcIds.has(p.service_id)) return false;
        // 카테고리 필터 (위에서 우선 선정한 effectiveCatIds 적용)
        if (effectiveCatIds && effectiveCatIds.size && !_isPackageCategory(p, services, effectiveCatIds)) return false;
        // 예약 시술 매칭 모드 — 시술 ID 또는 카테고리 둘 중 하나 일치 필요
        if (matchRes && (_resSvcIds.length > 0 || _resCatIds.size > 0)) {
          const sid = p.service_id;
          const svc = (services||[]).find(s => s.id === sid);
          const sameSvc = sid && _resSvcIds.includes(sid);
          const sameCat = svc && _resCatIds.has(svc.cat);
          if (!sameSvc && !sameCat) return false;
        }
        return rem <= threshold;
      });
    }
    case 'package_expired': {
      // 만료된 보유 패키지/연간권 1건 이상 + 활성 보유권 없음 (재구매 유도 대상)
      // 활성 보유권 있으면 "기존상담" 부적합 (단골 활성 고객)
      // 유료 매출 0원 고객은 신규로 간주 → 기존상담 X
      if (hasPaidSale === false) return false;
      const userCatIds = Array.isArray(trigger.categoryIds) ? new Set(trigger.categoryIds.filter(Boolean)) : null;
      const _matchCat = (p) => {
        if (!userCatIds || !userCatIds.size) return true;
        const svc = (services||[]).find(s => s.id === p.service_id);
        return svc && userCatIds.has(svc.cat);
      };
      const hasExpired = custPkgs.some(p => !_isCoupon(p) && _isExpired(p, todayStr) && _matchCat(p));
      if (!hasExpired) return false;
      return !_hasActivePackage(custPkgs, todayStr);
    }
    case 'coupon_expiring_days': {
      const days = Number(trigger.days ?? 7);
      return custPkgs.some(p => {
        if (_isPrepaid(p)) return false; // 다담권/바프권은 회수 개념 없음
        const rem = _remainingCount(p);
        if (rem <= 0) return false;
        if (_isExpired(p, todayStr)) return false;
        const d = _daysUntilExpire(p, today);
        return d >= 0 && d <= days;
      });
    }
    case 'customer_inactive_days': {
      if (!customer) return false; // 미등록 고객은 신규 트리거가 처리
      // 유료 매출 0원 고객은 신규로 간주 → 기존고객 inactive 판정 X
      if (hasPaidSale === false) return false;
      const days = Number(trigger.days ?? 90);
      const last = customer.lastDate || customer.last_date || '';
      if (!last) return false;
      const l = new Date(String(last).slice(0,10) + 'T00:00:00');
      const diff = Math.floor((today - l) / 86400000);
      return diff >= days;
    }
    default:
      return false;
  }
}

/**
 * 모든 active 태그를 순회해 자동 부여될 태그 ID 배열 반환
 * @param {object} args
 * @param {Array} args.tags        service_tags 배열 (id, name, autoTrigger | auto_trigger, scheduleYn, useYn)
 * @param {object} args.customer   선택된 고객 (없으면 미등록 신규로 평가)
 * @param {Array}  args.custPkgs   해당 고객의 customer_packages
 * @param {string} args.todayStr   YYYY-MM-DD (기본: 오늘 KST)
 * @returns {string[]}
 */
export function evaluateTagTriggers({ tags = [], customer = null, custPkgs = [], todayStr = null, services = [], serviceCategories = [], hasPaidSale = null } = {}) {
  if (!todayStr) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    todayStr = kst.toISOString().slice(0, 10);
  }
  // 패키지 카테고리 ID 추출 — service_categories.name === "패키지" 인 카테고리만 대상
  // package_low_count(★마지막회차) 트리거가 패키지 카테고리 보유권만 평가하도록.
  const packageCatIds = new Set(
    (serviceCategories || [])
      .filter(c => c && (c.name === "패키지" || c.name === "회원권"))
      .map(c => c.id)
  );
  const ctx = { customer, custPkgs, todayStr, services, packageCatIds, hasPaidSale };
  const matched = [];
  tags.forEach(t => {
    if (!t || !t.id) return;
    if (t.useYn === false || t.use_yn === false) return;
    if (t.scheduleYn === true || t.schedule_yn === true) return; // 스케줄 전용 태그는 제외
    const trig = t.autoTrigger || t.auto_trigger;
    if (!trig || !trig.type) return;
    if (evaluateTrigger(trig, ctx)) matched.push(t.id);
  });
  return matched;
}

export default { TAG_TRIGGER_TYPES, evaluateTrigger, evaluateTagTriggers };
