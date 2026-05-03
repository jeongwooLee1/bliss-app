// 멀티테넌트 기능 토글 시스템
// businesses.settings.features 에 저장된 boolean map 으로 사업장별 기능 활성화 제어
// AppShell이 로그인 직후 setFeatures(...) 호출 → 전역 _features 에 적재
// UI에서 hasFeature('schedule_advanced') 등으로 검사

// 사용 가능한 모든 기능 키 + 기본 설명 (관리자 UI 표시용)
export const ALL_FEATURES = {
  // 운영 (Operations)
  schedule_advanced:  { label: '직원근무표 고급', desc: '자동배정·룰위반·스냅샷·룰설정' },
  branch_support:     { label: '지점 지원',       desc: '"지원(강남)" 등 다지점 지원 상태' },
  male_rotation:      { label: '남자 로테이션',   desc: '남자 직원 주간 단위 지점 로테이션' },
  branch_groups:      { label: '지점 그룹',       desc: '다지점 그룹 묶기' },

  // 멤버십·패키지 (Membership)
  customer_packages:  { label: '고객 보유권',     desc: '다회권/연간회원권 구매·차감' },
  package_share:      { label: '보유권 쉐어',     desc: '고객끼리 보유권 공유' },
  member_pricing:     { label: '회원가',          desc: '보유권 보유시 자동 할인가' },

  // 마케팅 (Marketing)
  event_engine:       { label: '이벤트 엔진',     desc: '자동 포인트/쿠폰 발행' },
  coupons:            { label: '쿠폰',            desc: '쿠폰 발행/사용' },
  points:             { label: '포인트',          desc: '포인트 적립·사용' },

  // 커뮤니케이션 (Communication)
  kakao_alimtalk:     { label: '카카오 알림톡',   desc: '알림톡 발송' },
  aligo_sms:          { label: '알리고 SMS',      desc: '문자 발송' },
  naver_scrape:       { label: '네이버 예약 수신', desc: '네이버 스마트플레이스 예약 자동 수신' },
  naver_block:        { label: '네이버 막기',     desc: '네이버 슬롯 막기 토글' },
  whatsapp:           { label: 'WhatsApp',        desc: 'WhatsApp Business 메시지' },
  instagram_dm:       { label: 'Instagram DM',    desc: '인스타 DM 송수신' },
  line_chat:          { label: 'LINE',            desc: 'LINE 메시지' },
  ai_auto_reply:      { label: 'AI 자동답변',     desc: '문의에 AI 자동 답변' },
  ai_book:            { label: 'AI 자동예약',     desc: 'AI가 예약 의도 파싱·등록' },

  // 업종 특화 (Vertical)
  care_sms:           { label: '케어 SMS',        desc: '시술 후 N일 자동 케어 안내' },
  external_prepaid:   { label: '외부 플랫폼',     desc: '서울뷰티/크리에이트립 등 선결제' },

  // AI 도구
  bliss_ai:           { label: '블리스 AI',       desc: '관리자용 AI 어시스턴트' },

  // 엔터프라이즈
  oracle_sync:        { label: 'Oracle 동기화',   desc: '외부 DB 동기화 (구 시스템 연동)' },
}

// 신규 사업장 기본값 (전부 false → trial 시 단순 모드)
export const DEFAULT_FEATURES_NEW_BIZ = Object.fromEntries(
  Object.keys(ALL_FEATURES).map(k => [k, false])
)

// 하우스왁싱 backfill 값 (전부 true)
export const HOUSEWAXING_FEATURES = Object.fromEntries(
  Object.keys(ALL_FEATURES).map(k => [k, true])
)

// 요금제 (Plan) → features 매핑
// 가격은 별도. 여기서는 기능 묶음만 정의.
// trial(14일 무료) → starter → pro → pro_plus(왁싱특화) → enterprise(전기능)
export const PLANS = {
  trial: {
    label: '체험',
    desc: '14일 무료. 핵심 기능만',
    features: {
      // 핵심만 (예약·매출·고객·메시지는 항상 켬)
    }
  },
  starter: {
    label: '스타터',
    desc: '기본 운영 도구',
    features: {
      kakao_alimtalk: true,
      aligo_sms: true,
      member_pricing: true,
      customer_packages: true,
    }
  },
  pro: {
    label: '프로',
    desc: '마케팅 + 다지점 운영',
    features: {
      kakao_alimtalk: true, aligo_sms: true,
      member_pricing: true, customer_packages: true, package_share: true,
      event_engine: true, coupons: true, points: true,
      schedule_advanced: true, branch_support: true, branch_groups: true,
      ai_auto_reply: true, ai_book: true, bliss_ai: true,
      whatsapp: true, instagram_dm: true, line_chat: true,
      naver_scrape: true,
    }
  },
  pro_plus_waxing: {
    label: '프로+ (왁싱)',
    desc: '왁싱샵 풀세트',
    features: {
      kakao_alimtalk: true, aligo_sms: true,
      member_pricing: true, customer_packages: true, package_share: true,
      event_engine: true, coupons: true, points: true,
      schedule_advanced: true, branch_support: true, branch_groups: true, male_rotation: true,
      ai_auto_reply: true, ai_book: true, bliss_ai: true,
      whatsapp: true, instagram_dm: true, line_chat: true,
      naver_scrape: true, naver_block: true,
      care_sms: true, external_prepaid: true,
    }
  },
  enterprise: {
    label: '엔터프라이즈',
    desc: '전 기능 + 커스텀',
    features: HOUSEWAXING_FEATURES,
  },
}

// Plan으로부터 features map 생성 (정의되지 않은 기능은 false로 채움)
export function featuresForPlan(planKey) {
  const p = PLANS[planKey] || PLANS.trial
  return { ...DEFAULT_FEATURES_NEW_BIZ, ...p.features }
}

// 런타임 상태 (AppShell이 로그인 직후 setFeatures 호출)
let _features = {}

export function setFeatures(featuresMap) {
  _features = featuresMap || {}
}

export function getFeatures() {
  return _features
}

// 기능 활성화 검사 — UI 분기 + 서버 호출 분기에서 사용
export function hasFeature(name) {
  return !!_features[name]
}

// businesses.settings에서 features 추출. 없으면 비어있는 obj.
// 하우스왁싱(legacy)는 settings.features 비어있으면 모두 true로 간주 (호환).
export function extractFeatures(settings, bizId) {
  let parsed = settings
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = {} }
  }
  parsed = parsed || {}
  if (parsed.features && typeof parsed.features === 'object') return parsed.features
  // legacy 하우스왁싱: features 미설정 → 전부 true
  if (bizId === 'biz_khvurgshb') return HOUSEWAXING_FEATURES
  // 그 외 신규: 전부 false
  return DEFAULT_FEATURES_NEW_BIZ
}
