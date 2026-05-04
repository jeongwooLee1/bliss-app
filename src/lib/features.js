// 멀티테넌트 기능 토글 + 요금제 시스템
// businesses.settings.features 에 boolean map 으로 사업장별 활성화 제어
// AppShell이 로그인 직후 setFeatures(...) 호출 → _features 적재
// UI: hasFeature('schedule_advanced') 검사

// 사용 가능한 모든 기능 키 + 설명 (관리자 UI 표시용)
export const ALL_FEATURES = {
  // 운영 (Operations)
  schedule_advanced:  { label: '직원근무표 고급', desc: '자동배정·룰위반·스냅샷·룰설정' },

  // 멤버십·패키지 (Membership)
  customer_packages:  { label: '고객 보유권',     desc: '다회권/연간회원권 구매·차감' },
  package_share:      { label: '보유권 쉐어',     desc: '고객끼리 보유권 공유' },
  member_pricing:     { label: '회원가',          desc: '보유권 보유시 자동 할인가' },

  // 마케팅 (Marketing)
  event_engine:       { label: '이벤트 엔진',     desc: '자동 포인트/쿠폰 발행' },
  coupons:            { label: '쿠폰',            desc: '쿠폰 발행/사용' },
  points:             { label: '포인트',          desc: '포인트 적립·사용' },

  // 메시지 발송 (Messaging — Starter+)
  kakao_alimtalk:     { label: '카카오 알림톡',   desc: '알림톡 발송' },
  aligo_sms:          { label: '알리고 SMS',      desc: '문자 발송' },

  // 메시지함·외부 채널 (Inbox — Pro 전용)
  messages_inbox:     { label: '메시지함',        desc: '수신·답장 메뉴 활성화' },
  naver_scrape:       { label: '네이버 예약 수신', desc: '네이버 스마트플레이스 자동 수신' },
  naver_block:        { label: '네이버 막기',     desc: '네이버 슬롯 막기 토글' },
  whatsapp:           { label: 'WhatsApp',        desc: 'WhatsApp Business 메시지' },
  instagram_dm:       { label: 'Instagram DM',    desc: '인스타 DM 송수신' },
  line_chat:          { label: 'LINE',            desc: 'LINE 메시지' },

  // AI (Pro 전용)
  ai_auto_reply:      { label: 'AI 자동답변',     desc: '문의에 AI 자동 답변' },
  ai_book:            { label: 'AI 자동예약',     desc: 'AI가 예약 의도 파싱·등록' },
  bliss_ai:           { label: '블리스 AI',       desc: '관리자용 AI 어시스턴트' },

  // 동의서 (Pro 전용)
  consent:            { label: '동의서',          desc: '태블릿 동의서 사인' },

  // 업종 특화 (Pro 전용 — 왁싱·뷰티)
  care_sms:           { label: '케어 SMS',        desc: '시술 후 N일 자동 케어 안내' },
  external_prepaid:   { label: '외부 플랫폼',     desc: '서울뷰티·크리에이트립 등 선결제' },
}

// 신규 사업장 기본값 (전부 false → trial 모드)
export const DEFAULT_FEATURES_NEW_BIZ = Object.fromEntries(
  Object.keys(ALL_FEATURES).map(k => [k, false])
)

// ─────────────────────────────────────────────────────
// Plan 정의: trial / starter / pro (3-tier)
// 가격은 별도. plan_subscriptions.price_monthly 가 truth.
// ─────────────────────────────────────────────────────

const STARTER_FEATURES = {
  kakao_alimtalk: true,
  aligo_sms: true,
  customer_packages: true,
  package_share: true,
  member_pricing: true,
  event_engine: true,
  coupons: true,
  points: true,
}

const PRO_FEATURES = {
  ...STARTER_FEATURES,
  // 메시지함
  messages_inbox: true,
  naver_scrape: true,
  naver_block: true,
  whatsapp: true,
  instagram_dm: true,
  line_chat: true,
  // AI
  ai_auto_reply: true,
  ai_book: true,
  bliss_ai: true,
  // 동의서
  consent: true,
  // 운영 고급
  schedule_advanced: true,
  // 업종 특화
  care_sms: true,
  external_prepaid: true,
}

export const PLANS = {
  trial: {
    label: '체험',
    desc: '14일 무료. 핵심 기능만 (예약·매출·고객)',
    price: 0,
    monthly_credit: 1000,
    features: {},  // 전부 false
  },
  starter: {
    label: '스타터',
    desc: '메시지 발송 + 멤버십 + 마케팅',
    price: 33000,
    monthly_credit: 3000,
    features: STARTER_FEATURES,
  },
  pro: {
    label: '프로',
    desc: '메시지함 + AI + 동의서 + 자동배정 + 케어SMS + 외부플랫폼',
    price: 77000,
    monthly_credit: 7000,
    features: PRO_FEATURES,
  },
}

// 단가 (1P = 1원). usage_logs.points_charged 계산.
export const POINT_PRICING = {
  alimtalk: 10,    // 알림톡
  sms: 20,         // SMS 단문
  lms: 60,         // SMS 장문
  whatsapp: 30,    // WhatsApp
  ai_call: 100,    // AI 호출 평균 (실제는 토큰 기반 변동)
}

// Plan key → features map (전 키 채움)
export function featuresForPlan(planKey) {
  const p = PLANS[planKey] || PLANS.trial
  return { ...DEFAULT_FEATURES_NEW_BIZ, ...p.features }
}

// 런타임 상태
let _features = {}

export function setFeatures(featuresMap) {
  _features = featuresMap || {}
}

export function getFeatures() {
  return _features
}

export function hasFeature(name) {
  return !!_features[name]
}

// businesses.settings.features 추출. 없으면 plan으로 derive.
// 하우스왁싱 legacy: features 미설정 + plan 미설정 → 'pro'로 간주 (호환).
export function extractFeatures(settings, bizId, plan) {
  let parsed = settings
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = {} }
  }
  parsed = parsed || {}
  if (parsed.features && typeof parsed.features === 'object') return parsed.features
  // plan 컬럼 있으면 그걸로 derive
  if (plan) return featuresForPlan(plan)
  // legacy 하우스왁싱: pro 처럼 동작
  if (bizId === 'biz_khvurgshb') return featuresForPlan('pro')
  return DEFAULT_FEATURES_NEW_BIZ
}
