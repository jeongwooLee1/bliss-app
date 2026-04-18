// 사내 메신저 UI 데모용 메시지
// user_id는 실제 employees_v1에 등록된 id(=이름) 기준
// 실제 Supabase 연동 전까지 UI 확인용

const now = Date.now()
const m = (offsetMin) => new Date(now - offsetMin*60_000).toISOString()

export const MOCK_MESSAGES = [
  { id:"msg1",  user_id:"서현",  body:"오늘 10시 예약 변경 요청 들어왔어요",          created_at: m(240) },
  { id:"msg2",  user_id:"경아",  body:"네 확인했습니다 10시 30분으로 옮길게요",         created_at: m(238) },
  { id:"msg3",  user_id:"재윤",  body:"용산 에어컨 누수 있어요 A/S 부를게요",          created_at: m(90) },
  { id:"msg4",  user_id:"경아",  body:"강남 오늘 마지막 예약 확인했습니다",            created_at: m(30) },
  { id:"msg5",  user_id:"서현",  body:"내일 직원 회의 10시 맞죠?",                   created_at: m(12) },
  { id:"msg6",  user_id:"재윤",  body:"네 10시 본사 2층입니다",                      created_at: m(8) },
  { id:"msg7",  user_id:"민정",  body:"참고로 차 막히면 10분 정도 늦을 수 있어요",     created_at: m(3) },
]

// 특정 시점 이후는 "안 읽음" 처리
export const MOCK_LAST_READ_AT = m(15)
