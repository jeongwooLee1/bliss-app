// 사내 메신저 UI 개발용 mock 데이터
// 실제 Supabase 연동 전 단계에서 UI 반복을 위한 샘플

export const MOCK_USERS = [
  { id: "u_me",     name: "이정우", branch: "본사",   gender: "M", online: true },
  { id: "u_seo",    name: "서현",   branch: "강남",   gender: "F", online: true },
  { id: "u_gyu",    name: "경아",   branch: "강남",   gender: "F", online: true },
  { id: "u_min",    name: "민지",   branch: "왕십리", gender: "F", online: false },
  { id: "u_jaey",   name: "재윤",   branch: "용산",   gender: "M", online: true },
  { id: "u_jwa",    name: "주연",   branch: "마곡",   gender: "F", online: false },
  { id: "u_hye",    name: "혜진",   branch: "위례",   gender: "F", online: true },
]

export const CURRENT_USER_ID = "u_me"

const now = Date.now()
const m = (offsetMin) => new Date(now - offsetMin*60_000).toISOString()

export const MOCK_MESSAGES = [
  { id:"msg1",  user_id:"u_seo",  body:"안녕하세요 오늘 10시 예약 변경 요청 들어왔어요",                created_at: m(240) },
  { id:"msg2",  user_id:"u_seo",  body:"강남점 2층 대기 중이세요",                                       created_at: m(239) },
  { id:"msg3",  user_id:"u_gyu",  body:"네 확인했습니다 10시 30분으로 옮길게요",                          created_at: m(238) },
  { id:"msg4",  user_id:"u_min",  body:"왕십리 오늘 수건 부족해요 본사 발주 가능할까요?",                 created_at: m(180) },
  { id:"msg5",  user_id:"u_me",   body:"오늘 오후에 가져다 드릴게요",                                    created_at: m(175) },
  { id:"msg6",  user_id:"u_me",   body:"몇 박스 필요한가요?",                                            created_at: m(174) },
  { id:"msg7",  user_id:"u_min",  body:"두 박스면 충분합니다 감사합니다",                                created_at: m(170) },
  { id:"msg8",  user_id:"u_jaey", body:"용산 에어컨 누수 있어요 A/S 부를게요",                            created_at: m(90) },
  { id:"msg9",  user_id:"u_hye",  body:"위례 오늘 마감 30분 단축 가능할까요 예약 없어요",                  created_at: m(45) },
  { id:"msg10", user_id:"u_gyu",  body:"강남 오늘 마지막 예약 확인했습니다",                              created_at: m(30) },
  { id:"msg11", user_id:"u_seo",  body:"내일 직원 회의 10시 맞죠?",                                      created_at: m(12) },
  { id:"msg12", user_id:"u_jaey", body:"네 10시 본사 2층입니다",                                         created_at: m(8) },
  { id:"msg13", user_id:"u_min",  body:"참고로 차 막히면 10분 정도 늦을 수 있어요",                       created_at: m(3) },
]

// 특정 시점 이후는 "안 읽음" 처리
export const MOCK_LAST_READ_AT = m(15) // 15분 전까지 읽음
