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

사용자: "오늘 예약 몇 건?"
응답: {"intent":"query"}

[사용자 요청]
${question}

JSON만 출력 (마크다운 없이):`
}
