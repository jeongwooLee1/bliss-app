// 신규 고객 판정 — Single Source of Truth
// 자동태그(is_new_customer) / 이벤트엔진(new_first_sale) / 서버 ai_analyze 모두 동일 룰 사용.
// 룰 변경 시 이 함수 1곳만 수정 + 서버 bliss_naver.py의 _is_new_customer() 함수도 동일하게.

/**
 * @param {object|null} customer  매칭된 customer row (visits 등). null/undefined면 매칭 보류 → false 반환 (보수적).
 * @param {boolean|null} hasPaidSale  유료 매출(결제수단 합>0) 1건이라도 있는지. 모르면 null로 호출 시 visits만 평가.
 * @returns {boolean}
 *
 * 룰:
 *  1) customer 매칭 안 됨 → false (모달에서 직원이 phone 검색 중인 race 케이스 등 보호)
 *  2) visits === 0 → true (진짜 첫 방문)
 *  3) hasPaidSale === false → true (visits>0이지만 체험단/0원 매출만 있음)
 *  4) 그 외 → false (단골)
 */
export function isNewCustomer(customer, hasPaidSale = null) {
  if (!customer) return false;
  if (Number(customer.visits || 0) === 0) return true;
  if (hasPaidSale === false) return true;
  return false;
}
