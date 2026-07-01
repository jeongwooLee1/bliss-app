/**
 * actionSchemas.js — 블리스 AI가 수행 가능한 쓰기 액션 정의
 *
 * 각 액션:
 *   label: 유저에게 보여줄 한글 이름
 *   table: Supabase 테이블 (schedule_data 키 기반은 scheduleKey)
 *   scheduleKey: schedule_data.key (직원 등)
 *   dangerous: true면 red 테마, 삭제 등
 *   doubleConfirm: true면 2단계 확인 (삭제 전 "정말 삭제?")
 *   fieldsAllowed: LLM이 제시할 수 있는 필드 목록 (나머지는 무시)
 *   validate: (params) => null(정상) | "에러메시지"
 *   preview: (params, context) => [{label, before, after}] 또는 설명문
 *
 * 동작:
 *   LLM이 {action, target, changes} JSON 생성 → 여기서 검증 + 프리뷰 → confirm UI → actionRunner 실행
 */

// ─── 지점 ───────────────────────────────────────────────────────────────────
const BRANCH = {
  create_branch: {
    label: '지점 추가', table: 'branches', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'short', 'phone', 'address', 'open_time', 'close_time', 'sort', 'use_yn'],
    validate: (p) => !p.name ? '지점명이 필요합니다' : null,
  },
  update_branch: {
    label: '지점 수정', table: 'branches', op: 'update', icon: '✏️',
    fieldsAllowed: ['name', 'short', 'phone', 'address', 'open_time', 'close_time', 'sort', 'use_yn'],
    targetField: 'short,name', // 검색할 때 사용
  },
  delete_branch: {
    label: '지점 삭제', table: 'branches', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'short,name',
  },
};

// ─── 시술 카테고리 ───────────────────────────────────────────────────────────
const SERVICE_CATEGORY = {
  create_service_category: {
    label: '시술 카테고리 추가', table: 'service_categories', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'sort'],
    validate: (p) => !p.name ? '카테고리명이 필요합니다' : null,
  },
  update_service_category: {
    label: '시술 카테고리 수정', table: 'service_categories', op: 'update', icon: '✏️',
    fieldsAllowed: ['name', 'sort'],
    targetField: 'name',
  },
  delete_service_category: {
    label: '시술 카테고리 삭제', table: 'service_categories', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'name',
  },
};

// ─── 시술 ───────────────────────────────────────────────────────────────────
const SERVICE = {
  create_service: {
    label: '시술 추가', table: 'services', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'cat', 'cat_name', 'price_f', 'price_m', 'member_price_f', 'member_price_m', 'dur', 'sort', 'is_active'],
    validate: (p) => !p.name ? '시술명이 필요합니다' : null,
  },
  bulk_create_services: {
    label: '시술 일괄 추가', table: 'services', op: 'bulk_create', icon: '📦',
    fieldsAllowed: ['items'], // items: [{name, cat, price_f, ...}]
    validate: (p) => !Array.isArray(p.items) || !p.items.length ? '시술 목록이 비었습니다' : null,
  },
  update_service: {
    label: '시술 수정', table: 'services', op: 'update', icon: '✏️',
    fieldsAllowed: ['name', 'cat', 'price_f', 'price_m', 'member_price_f', 'member_price_m', 'dur', 'sort', 'is_active'],
    targetField: 'name',
  },
  delete_service: {
    label: '시술 삭제', table: 'services', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'name',
  },
};

// ─── 담당자 (rooms) ─────────────────────────────────────────────────────────
const ROOM = {
  create_room: {
    label: '담당자 추가', table: 'rooms', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'bid', 'sort', 'use_yn'],
    validate: (p) => !p.name ? '담당자명이 필요합니다' : null,
  },
  update_room: {
    label: '담당자 수정', table: 'rooms', op: 'update', icon: '✏️',
    fieldsAllowed: ['name', 'bid', 'sort', 'use_yn'],
    targetField: 'name',
  },
  delete_room: {
    label: '담당자 삭제', table: 'rooms', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'name',
  },
};

// ─── 직원 (schedule_data.employees_v1) ─────────────────────────────────────
const STAFF = {
  create_staff: {
    label: '직원 추가', scheduleKey: 'employees_v1', op: 'schedule_list_add', icon: '➕',
    fieldsAllowed: ['id', 'name', 'branch', 'gender', 'sort'],
    validate: (p) => !p.name ? '직원명이 필요합니다' : null,
  },
  bulk_create_staff: {
    label: '직원 일괄 추가', scheduleKey: 'employees_v1', op: 'schedule_list_bulk_add', icon: '📦',
    fieldsAllowed: ['items'],
  },
  update_staff: {
    label: '직원 수정', scheduleKey: 'employees_v1', op: 'schedule_list_update', icon: '✏️',
    fieldsAllowed: ['name', 'branch', 'gender', 'sort'],
    targetField: 'name,id',
  },
  delete_staff: {
    label: '직원 삭제', scheduleKey: 'employees_v1', op: 'schedule_list_delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'name,id',
  },
};

// ─── 예약 경로 ──────────────────────────────────────────────────────────────
const RES_SOURCE = {
  create_res_source: {
    label: '예약 경로 추가', table: 'reservation_sources', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'color', 'sort', 'use_yn'],
    validate: (p) => !p.name ? '예약 경로명이 필요합니다' : null,
  },
  delete_res_source: {
    label: '예약 경로 삭제', table: 'reservation_sources', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    targetField: 'name',
  },
};

// ─── 고객 ───────────────────────────────────────────────────────────────────
const CUSTOMER = {
  update_customer: {
    label: '고객 정보 수정', table: 'customers', op: 'update', icon: '✏️',
    fieldsAllowed: ['name', 'name2', 'phone', 'phone2', 'email', 'gender', 'memo', 'sms_consent', 'bid', 'join_date'],
    targetField: 'name,phone,cust_num',
  },
  delete_customer: {
    label: '고객 삭제', table: 'customers', op: 'soft_delete', icon: '🗑', dangerous: true, doubleConfirm: true,
    // soft delete: is_hidden=true
    targetField: 'name,phone,cust_num',
  },
};

// ─── 사업 기본정보 (businesses) ─────────────────────────────────────────────
const BUSINESS = {
  update_business: {
    label: '사업 기본정보 수정', table: 'businesses', op: 'update_self', icon: '✏️',
    fieldsAllowed: ['name', 'address', 'phone', 'biz_type', 'email'],
  },
  update_business_setting: {
    label: '앱 설정 변경', table: 'businesses', op: 'update_setting', icon: '⚙️',
    // changes: {key:"member_price_rules"|"ai_rules"|...,  value: any}
    fieldsAllowed: ['key', 'value'],
    validate: (p) => !p.key ? 'setting key가 필요합니다' : null,
  },
};

// ─── 알림톡/문자 설정 (branches.noti_config) ────────────────────────────────
// notiKey → 한글 라벨 (AI 프롬프트 매핑 + 프리뷰 공용)
export const NOTI_KEY_LABELS = {
  rsv_confirm: '예약 확정 알림',
  rsv_1day: '1일 전(전날) 알림',
  rsv_today: '당일 알림',
  after_1d_first_only: '시술 후 1일 (신규·1회)',
  after_5d: '시술 후 5일',
  after_10d: '시술 후 10일',
  after_18d_first_only: '시술 후 18일 (신규·1회)',
  after_21d: '시술 후 21일',
  after_35d: '시술 후 35일',
  after_60d: '시술 후 60일',
};
const NOTI = {
  update_noti_config: {
    label: '알림톡/문자 설정', op: 'update_noti_config', icon: '🔔',
    table: 'branches', targetField: 'name,short',   // 지점 findTarget
    // target: 지점명(단일 지점이면 생략 가능) / changes: { notiKey, on?, msgTpl?, sendTime? }
    fieldsAllowed: ['notiKey', 'on', 'msgTpl', 'sendTime'],
    validate: (p) => !p.notiKey ? '어떤 알림인지 알려주세요 (예약확정 / 1일전 / 당일 / 시술후 5·10·21·35·60일)' : null,
  },
};

// ─── AI 자동응대 (businesses.settings) ───────────────────────────────────────
export const AI_CHANNEL_LABELS = {
  naver: '네이버 톡톡', instagram: '인스타그램', whatsapp: '왓츠앱',
  line: '라인', kakao: '카카오', sms: '문자(SMS)',
};
const AI_REPLY = {
  toggle_ai_reply: {
    label: 'AI 자동응대', op: 'toggle_ai_reply', icon: '🤖',
    // changes: { on(필수), channel?(없으면 전체 채널) }
    fieldsAllowed: ['on', 'channel'],
    validate: (p) => (p.on == null) ? 'AI 자동응대를 켤지 끌지 알려주세요' : null,
  },
  add_faq: {
    label: 'AI FAQ 추가', op: 'add_faq', icon: '💬',
    // changes: { q(질문), a(답변), category? }
    fieldsAllowed: ['q', 'a', 'category'],
    validate: (p) => (!p.q || !p.a) ? 'FAQ 질문과 답변을 모두 알려주세요' : null,
  },
};

// ─── 제품 (products) ─────────────────────────────────────────────────────────
const PRODUCT = {
  create_product: {
    label: '제품 추가', table: 'products', op: 'create', icon: '➕',
    fieldsAllowed: ['name', 'price', 'cat', 'note', 'stock', 'is_active'],
    validate: (p) => !p.name ? '제품 이름이 필요합니다' : null,
  },
  update_product: {
    label: '제품 수정', table: 'products', op: 'update', icon: '✏️', targetField: 'name',
    fieldsAllowed: ['name', 'price', 'cat', 'note', 'stock', 'is_active'],
  },
  delete_product: {
    label: '제품 삭제', table: 'products', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true, targetField: 'name',
  },
};

// ─── 태그 (service_tags) ─────────────────────────────────────────────────────
const TAG = {
  create_tag: {
    label: '태그 추가', table: 'service_tags', op: 'create', icon: '➕',
    // color: hex(#RRGGBB), use_yn: 사용여부(기본 true), schedule_yn 미지정 → 예약 태그(DB 기본 false)
    fieldsAllowed: ['name', 'color', 'use_yn'],
    validate: (p) => !p.name ? '태그 이름이 필요합니다' : null,
  },
  update_tag: {
    label: '태그 수정', table: 'service_tags', op: 'update', icon: '✏️', targetField: 'name',
    fieldsAllowed: ['name', 'color', 'use_yn'],
  },
  delete_tag: {
    label: '태그 삭제', table: 'service_tags', op: 'delete', icon: '🗑', dangerous: true, doubleConfirm: true, targetField: 'name',
  },
};

// ─── 재방문 스탬프 / 이벤트 (businesses.settings) ─────────────────────────────
const PROGRAM = {
  toggle_stamp_program: {
    label: '재방문 스탬프 제도', op: 'toggle_stamp_program', icon: '🎟️',
    // changes: { on(필수) }
    fieldsAllowed: ['on'],
    validate: (p) => (p.on == null) ? '재방문 스탬프 제도를 켤지 끌지 알려주세요' : null,
  },
  toggle_events_master: {
    label: '이벤트 엔진 전체', op: 'toggle_events_master', icon: '💥',
    // changes: { on(필수) } — 이벤트 엔진 마스터 스위치. OFF면 모든 이벤트 매출 반영 중단
    fieldsAllowed: ['on'],
    validate: (p) => (p.on == null) ? '이벤트 엔진을 켤지 끌지 알려주세요' : null,
  },
  toggle_event: {
    label: '개별 이벤트', op: 'toggle_event', icon: '🎉',
    // target: 이벤트 이름 / changes: { on(필수) }
    fieldsAllowed: ['on'],
    targetField: 'name',
    validate: (p) => (p.on == null) ? '이벤트를 켤지 끌지 알려주세요' : null,
  },
};

// ─── 예약 생성 (자연어 파싱 기반) ────────────────────────────────────────
const RESERVATION = {
  create_reservation: {
    label: '예약 추가',
    op: 'create_reservation',
    icon: '📅',
    // changes:
    //   input: 자연어 (필수, 최초 intent 단계에서 채움)
    //   _parsed: { custName, custPhone, custEmail, date, time, dur, branch, matchedServiceIds, ... }
    //            BlissAI에서 미리 파싱해 채워줌 (preview 표시용)
    //   _matchedCustId: 검색된 기존 고객 ID (있으면 표시용)
    fieldsAllowed: ['input', '_parsed', '_matchedCustId'],
    validate: (p) => {
      const ps = p?._parsed || {}
      const missing = []
      if (!ps.date) missing.push('날짜')
      if (!ps.time) missing.push('시간')
      if (!ps.branch) missing.push('지점')
      if (!ps.custName && !ps.custPhone && !ps.custEmail) missing.push('고객 (이름/연락처/이메일)')
      if (missing.length > 0) return `다음 정보가 필요합니다: ${missing.join(', ')}`
      return null
    },
  },
  cancel_reservation: {
    label: '예약 취소',
    op: 'cancel_reservation',
    icon: '❌',
    dangerous: true,
    // changes:
    //   input: 자연어 (필수)
    //   _parsed: AI Book 파서 결과 (고객/날짜/시간 매칭용)
    //   _matchedRes: 검색된 예약 목록 (preview 표시용)
    fieldsAllowed: ['input', '_parsed', '_matchedRes'],
    validate: (p) => {
      const matches = p?._matchedRes || []
      if (matches.length === 0) return '취소할 예약을 찾지 못했습니다 (고객 이름·전화·날짜·시간 확인)'
      return null
    },
  },
}

// ─── 세팅 마법사 전용 액션 ─────────────────────────────────────────────────
const SETUP = {
  setup_initial: {
    label: '초기 세팅 일괄 적용',
    op: 'setup_initial',
    icon: '🎉',
    // changes: {biz:{...}, branches:[...], categories:[...], services:[...], staff:[...], res_sources:[...]}
    fieldsAllowed: ['biz', 'branches', 'categories', 'services', 'staff', 'res_sources'],
  },
};

// ─── 통합 ───────────────────────────────────────────────────────────────────
export const ACTION_SCHEMAS = {
  ...BRANCH,
  ...SERVICE_CATEGORY,
  ...SERVICE,
  ...ROOM,
  ...STAFF,
  ...RES_SOURCE,
  ...CUSTOMER,
  ...BUSINESS,
  ...NOTI,
  ...AI_REPLY,
  ...PRODUCT,
  ...TAG,
  ...PROGRAM,
  ...RESERVATION,
  ...SETUP,
};

export const ACTION_LIST = Object.keys(ACTION_SCHEMAS);

// ─── LLM 프롬프트 ──────────────────────────────────────────────────────────
// 유저 질문 → {intent, action, target, changes} JSON 추출
export function buildWriteIntentPrompt(question, stateSnapshot) {
  const list = ACTION_LIST.join('\n  - ');
  return `당신은 뷰티샵 관리 앱의 명령 해석기입니다. 사용자가 설정/데이터 변경을 요청하면 JSON 액션으로 변환하세요.

[허용된 액션]
  - ${list}

[현재 데이터 요약]
${stateSnapshot || '(없음)'}

[응답 규칙]
1. 사용자가 데이터 변경을 명확히 요청하면 → {"intent":"write","action":"...","target":"...","changes":{...}}
2. 사용자가 질문/조회만 하면 → {"intent":"query"}
3. 여러 변경 동시 요청되면 action=bulk_* 사용
4. 반드시 target은 사용자가 지정한 대상(지점명, 시술명, 고객명 등) 그대로
5. changes에는 변경할 필드만 (fieldsAllowed 참고)
6. 모호하면 {"intent":"ambiguous","need_info":"어느 지점 전화번호를 바꿀까요?"}

[예시]
사용자: "강남점 전화번호 02-111-2222로 바꿔"
응답: {"intent":"write","action":"update_branch","target":"강남","changes":{"phone":"02-111-2222"}}

사용자: "브라질리언 가격 11만원으로 수정"
응답: {"intent":"write","action":"update_service","target":"브라질리언","changes":{"price_f":110000,"price_m":110000}}

사용자: "신규 시술 '왁싱 케어' 45분 7만원"
응답: {"intent":"write","action":"create_service","changes":{"name":"왁싱 케어","dur":45,"price_f":70000,"price_m":70000}}

사용자: "강남점 없애줘"
응답: {"intent":"write","action":"delete_branch","target":"강남"}

[알림톡/문자 설정 — update_noti_config]
notiKey 매핑: rsv_confirm(예약확정) / rsv_1day(1일전·전날 리마인더) / rsv_today(당일 알림) / after_5d·after_10d·after_21d·after_35d·after_60d(시술 후 N일 케어) / after_1d_first_only·after_18d_first_only(신규 첫방문 케어)
- 지점 명시 안 하면 target은 빈 문자열(단일 지점이면 자동 적용, 여러 지점이면 시스템이 지점을 물음)
- 켜기=on:true, 끄기=on:false, 문구=msgTpl, 발송시각=sendTime("HH:MM")

사용자: "예약확정 알림톡 켜줘"
응답: {"intent":"write","action":"update_noti_config","target":"","changes":{"notiKey":"rsv_confirm","on":true}}

사용자: "강남점 당일 알림 문구 바꿔 — 오늘 예약 잊지 마세요 :)"
응답: {"intent":"write","action":"update_noti_config","target":"강남","changes":{"notiKey":"rsv_today","msgTpl":"오늘 예약 잊지 마세요 :)"}}

사용자: "전날 리마인더 10시에 보내줘"
응답: {"intent":"write","action":"update_noti_config","target":"","changes":{"notiKey":"rsv_1day","sendTime":"10:00"}}

사용자: "시술 후 5일 케어문자 꺼줘"
응답: {"intent":"write","action":"update_noti_config","target":"","changes":{"notiKey":"after_5d","on":false}}

[AI 자동응대 — toggle_ai_reply / add_faq]
- toggle_ai_reply: 받은 메시지에 AI가 자동으로 답하는 기능. changes.channel 없으면 전체 채널, 있으면 그 채널만
- channel 매핑: naver(네이버 톡톡) / instagram(인스타) / whatsapp(왓츠앱) / line(라인) / kakao(카카오) / sms(문자)
- add_faq: AI가 참고할 질문·답변(FAQ) 추가. changes.q(질문), changes.a(답변)

사용자: "AI 자동응대 켜줘"
응답: {"intent":"write","action":"toggle_ai_reply","changes":{"on":true}}

사용자: "인스타 AI 자동응답 꺼줘"
응답: {"intent":"write","action":"toggle_ai_reply","changes":{"on":false,"channel":"instagram"}}

사용자: "왓츠앱 자동응대 켜"
응답: {"intent":"write","action":"toggle_ai_reply","changes":{"on":true,"channel":"whatsapp"}}

사용자: "AI가 '주차 되나요?'라고 물으면 '건물 지하에 무료주차 가능해요'라고 답하게 해줘"
응답: {"intent":"write","action":"add_faq","changes":{"q":"주차 되나요?","a":"건물 지하에 무료주차 가능해요"}}

[제품(판매상품) 관리 — products]
- create_product(추가) / update_product(수정) / delete_product(삭제). 시술(services)이 아니라 매장에서 파는 제품(디퓨저·홈케어 등)
- 필드: name(이름) / price(가격) / cat(분류) / note(메모) / stock(재고) / is_active(판매여부)

사용자: "디퓨저 제품 2만원에 추가해줘"
응답: {"intent":"write","action":"create_product","changes":{"name":"디퓨저","price":20000}}

사용자: "홈케어 오일 가격 3만5천원으로 수정"
응답: {"intent":"write","action":"update_product","target":"홈케어 오일","changes":{"price":35000}}

사용자: "진정크림 재고 10개로 바꿔"
응답: {"intent":"write","action":"update_product","target":"진정크림","changes":{"stock":10}}

사용자: "디퓨저 제품 판매 중지"
응답: {"intent":"write","action":"update_product","target":"디퓨저","changes":{"is_active":false}}

사용자: "디퓨저 제품 삭제해줘"
응답: {"intent":"write","action":"delete_product","target":"디퓨저"}

[태그 관리 — create_tag / update_tag / delete_tag]
- 예약·고객에 붙이는 태그(예: VIP, 재방문, 주의). color는 hex(#FF5733)

사용자: "VIP 태그 추가해줘"
응답: {"intent":"write","action":"create_tag","changes":{"name":"VIP"}}

사용자: "재방문 태그 빨간색으로 추가"
응답: {"intent":"write","action":"create_tag","changes":{"name":"재방문","color":"#E53935"}}

사용자: "VIP 태그 삭제"
응답: {"intent":"write","action":"delete_tag","target":"VIP"}

[재방문 스탬프 / 이벤트 — 켜고 끄기]
- toggle_stamp_program: 재방문 스탬프 적립 제도 on/off
- toggle_events_master: 이벤트 엔진 전체 마스터 스위치 (OFF면 모든 이벤트 중단)
- toggle_event: 특정 이벤트 이름으로 on/off (target=이벤트명)

사용자: "재방문 스탬프 제도 켜줘"
응답: {"intent":"write","action":"toggle_stamp_program","changes":{"on":true}}

사용자: "이벤트 전체 꺼줘"
응답: {"intent":"write","action":"toggle_events_master","changes":{"on":false}}

사용자: "'첫방문 10% 적립' 이벤트 꺼줘"
응답: {"intent":"write","action":"toggle_event","target":"첫방문 10% 적립","changes":{"on":false}}

사용자: "오늘 예약 몇 건?"
응답: {"intent":"query"}

사용자: "내일 오후 3시 강남점 김철수 010-1234-5678 브라질리언 예약해줘"
응답: {"intent":"write","action":"create_reservation","changes":{"input":"내일 오후 3시 강남점 김철수 010-1234-5678 브라질리언 예약해줘"}}

사용자: "5/3 19시 왕십리 이정우 01057028008 음모왁싱 예약 잡아줘"
응답: {"intent":"write","action":"create_reservation","changes":{"input":"5/3 19시 왕십리 이정우 01057028008 음모왁싱 예약 잡아줘"}}

사용자: "정우 8008 오늘 8시 음모왁싱 예약해"
응답: {"intent":"write","action":"create_reservation","changes":{"input":"정우 8008 오늘 8시 음모왁싱 예약해"}}

사용자: "이정우 8시 강남 브라질리언 예약"
응답: {"intent":"write","action":"create_reservation","changes":{"input":"이정우 8시 강남 브라질리언 예약"}}

사용자: "이정우 5/3 7시 예약 취소해줘"
응답: {"intent":"write","action":"cancel_reservation","changes":{"input":"이정우 5/3 7시 예약 취소해줘"}}

사용자: "정우 8008 오늘 예약 취소"
응답: {"intent":"write","action":"cancel_reservation","changes":{"input":"정우 8008 오늘 예약 취소"}}

[예약 생성 규칙 — 매우 중요]
- "예약해줘/예약 잡아줘/예약 등록/추가해줘/예약해" 등 예약 의도가 있으면 create_reservation
- **부분 정보(전화 뒷자리만, 이름만)는 허용** — 시스템이 기존 고객 검색·매칭으로 보강
- 단 **다음 정보가 명시되지 않으면 ambiguous로 응답하고 묻기**:
  · 지점 (강남/왕십리/홍대/마곡/잠실/위례/용산/천호 중 하나가 텍스트에 없으면)
  · 시간 (몇 시인지 모르면)
  · 날짜 (오늘/내일/모레/요일/날짜 표기 없으면)
  · 고객 정보 (이름·전화·이메일 중 하나도 없으면)
- ambiguous 응답: {"intent":"ambiguous","need_info":"지점을 알려주세요. (강남/왕십리/홍대/마곡/잠실/위례/용산/천호)"}
- 절대 추측 금지 — 모르면 묻기
- changes.input에는 사용자 원문 그대로 (이름/연락처/시간/지점/시술 정보 추출은 후속 단계)

사용자: "오늘 8시 음모왁싱 예약해"
응답: {"intent":"ambiguous","need_info":"지점과 고객 정보(이름 또는 연락처)를 알려주세요. 지점: 강남/왕십리/홍대/마곡/잠실/위례/용산/천호"}

사용자: "정우 8008 8시 음모왁싱"
응답: {"intent":"ambiguous","need_info":"지점과 날짜를 알려주세요. 지점: 강남/왕십리/홍대/마곡/잠실/위례/용산/천호"}

사용자: "강남 정우 8008 8시 음모왁싱"
응답: {"intent":"ambiguous","need_info":"날짜를 알려주세요. (오늘/내일/날짜)"}

[사용자 요청]
${question}

JSON만 출력 (마크다운 없이):`
}
