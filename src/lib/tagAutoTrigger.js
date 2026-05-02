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
export const TAG_TRIGGER_TYPES = [
  { type: 'is_new_customer',        label: '🆕 신규 고객 (미등록 또는 첫 방문)' },
  { type: 'package_low_count',      label: '📦 패키지 잔여 회수 ≤ N',  params: [{ key: 'threshold', label: '회 이하', default: 1 }] },
  { type: 'package_expired',        label: '⌛ 보유 패키지/연간권 만료' },
  { type: 'coupon_expiring_days',   label: '🎫 쿠폰 N일 내 만료',     params: [{ key: 'days', label: '일 이내', default: 7 }] },
  { type: 'customer_inactive_days', label: '😴 N일 이상 미방문 (기존상담)', params: [{ key: 'days', label: '일 이상', default: 90 }] },
];

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

/**
 * 단일 트리거 평가
 * @returns boolean
 */
export function evaluateTrigger(trigger, ctx) {
  if (!trigger || !trigger.type) return false;
  const { customer, custPkgs = [], todayStr } = ctx;
  const today = new Date(todayStr + 'T00:00:00');

  switch (trigger.type) {
    case 'is_new_customer': {
      if (!customer) return true;
      return Number(customer.visits || 0) === 0;
    }
    case 'package_low_count': {
      const threshold = Number(trigger.threshold ?? 1);
      // 다회권(total_count > 0)만 대상. 잔여 ≤ threshold + 0이 아닌 경우 (사용 가능한 보유권에 한함)
      return custPkgs.some(p => {
        if (Number(p.total_count || 0) <= 0) return false;
        const rem = _remainingCount(p);
        if (rem <= 0) return false; // 이미 다 쓴 건 제외
        if (_isExpired(p, todayStr)) return false; // 만료된 건 제외
        return rem <= threshold;
      });
    }
    case 'package_expired': {
      // 보유 패키지/쿠폰 중 만료된 게 1건 이상
      return custPkgs.some(p => _isExpired(p, todayStr));
    }
    case 'coupon_expiring_days': {
      const days = Number(trigger.days ?? 7);
      return custPkgs.some(p => {
        const rem = _remainingCount(p);
        if (rem <= 0) return false;
        if (_isExpired(p, todayStr)) return false;
        const d = _daysUntilExpire(p, today);
        return d >= 0 && d <= days;
      });
    }
    case 'customer_inactive_days': {
      if (!customer) return false; // 미등록 고객은 신규 트리거가 처리
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
export function evaluateTagTriggers({ tags = [], customer = null, custPkgs = [], todayStr = null } = {}) {
  if (!todayStr) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    todayStr = kst.toISOString().slice(0, 10);
  }
  const ctx = { customer, custPkgs, todayStr };
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
