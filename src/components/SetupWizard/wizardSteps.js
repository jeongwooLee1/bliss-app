/**
 * 설정 마법사 스텝 정의 + AI 프롬프트 (사진 기반)
 */

export const STEPS = [
  {
    id: 'photo_upload',
    label: '사진 업로드',
    required: true,
    acceptsImage: true,
    greeting: '안녕하세요! Bliss 설정을 도와드릴게요.\n\n아래 파일을 보내주시면 자동으로 설정해드려요:\n\n📋 메뉴판 / 가격표 사진\n📄 사업자등록증\n📱 네이버플레이스 캡처\n📊 시술목록 엑셀 / 텍스트 파일\n\n여러 개 보내셔도 돼요!\n사진이나 파일이 없으면 "없어요"라고 하시면 직접 입력으로 진행합니다.',
    systemPrompt: null // Vision API 전용 프롬프트는 별도
  },
  {
    id: 'review',
    label: '확인',
    required: true,
    greeting: null, // 동적 생성
    systemPrompt: `사용자가 파싱 결과에 대해 수정을 요청합니다.
현재 등록 데이터를 기반으로 수정사항을 반영하세요.

응답 JSON: {"message":"확인 메시지","data":{수정된 필드만},"done":true}
"괜찮아" "확인" "넘어가" → done:true, data:{}
수정 요청이면 해당 필드만 data에 포함.
예: "브라질리언 가격이 11만원이야" → {"message":"수정했어요!","data":{"services":[{"name":"브라질리언","priceF":110000}]},"done":true}`
  },
  {
    id: 'staff',
    label: '직원 등록',
    required: true,
    greeting: '직원(시술사) 이름을 알려주세요.\n예: "소연, 경아, 재윤" 또는 "저 혼자예요"',
    systemPrompt: `사용자가 직원 이름을 말합니다.
"혼자" "1인" 등이면 사업장 이름 또는 "원장님"을 staff로.
응답 JSON: {"message":"확인 메시지","data":{"staff":["이름1","이름2"]},"done":true}`
  },
  {
    id: 'sources',
    label: '예약경로',
    required: false,
    greeting: '네이버 예약 외에 다른 예약 경로가 있나요?\n예: "인스타, 카카오" 또는 "네이버만 써요"\n\n건너뛰셔도 됩니다.',
    systemPrompt: `사용자가 예약경로를 말합니다. 네이버는 기본 포함.
"건너뛸게" "나중에" "패스" "네이버만" → done:true, sources:[], skipped:true
응답 JSON: {"message":"확인 메시지","data":{"sources":["인스타","카카오"],"skipped":false},"done":true}`
  },
  // AI 설정은 시스템에서 제공 — 개별 설정 불필요
  {
    id: 'complete',
    label: '완료',
    required: true,
    greeting: '기본 설정이 완료됐어요!\n\n등록된 내용은 관리설정에서 언제든 수정할 수 있어요.\n추가로 궁금한 게 있으면 물어보세요!',
    systemPrompt: null
  }
];

export const VISION_PROMPT = `이 사진들은 뷰티샵/미용실의 자료입니다 (메뉴판, 사업자등록증, 네이버플레이스 캡처 등).
모든 사진에서 아래 정보를 최대한 추출하세요.

추출 항목:
- bizType: 업종 (왁싱샵, 네일샵, 헤어샵, 피부관리 등). 없으면 빈 문자열.
- bizName: 상호명. 없으면 빈 문자열.
- address: 주소. 없으면 빈 문자열.
- phone: 전화번호. 없으면 빈 문자열.
- openTime: 영업 시작시간 "HH:MM". 없으면 빈 문자열.
- closeTime: 영업 종료시간 "HH:MM". 없으면 빈 문자열.
- categories: 시술 카테고리 배열 (예: ["왁싱","제모","케어"]). 시술 목록에서 유추.
- services: 시술 상품 배열. 각 항목: {"name":"시술명","dur":소요시간(분),"priceF":여성가격,"priceM":남성가격,"cat":"카테고리"}
  - 가격: 숫자로 변환 (10만→100000, 3만5천→35000, 33,000→33000)
  - 소요시간 없으면 dur:30
  - 성별 가격이 같으면 priceF=priceM=해당가격
  - 남성/여성 구분 없으면 priceF에만 넣고 priceM:0
- staffNames: 직원/시술사 이름 배열 (있으면). 없으면 빈 배열.

중요: 마크다운 없이 순수 JSON만 출력하세요.
{"bizType":"","bizName":"","address":"","phone":"","openTime":"","closeTime":"","categories":[],"services":[],"staffNames":[]}`;

export const SOURCE_COLORS = {
  '네이버': '#03c75a', '카카오': '#fee500', '인스타': '#e4405f',
  '인스타그램': '#e4405f', '구글': '#4285f4', '전화': '#7c7cc8',
  '직접': '#7c7cc8', '워크인': '#636e72', '소개': '#9b72cb', '기타': '#636e72',
};

export const getSourceColor = (name) => {
  for (const [key, color] of Object.entries(SOURCE_COLORS)) {
    if (name.includes(key)) return color;
  }
  return '#636e72';
};
