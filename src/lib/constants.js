export const BUSINESS_ID = 'biz_khvurgshb'

export const T = {
  primary:'#7c7cc8', primaryLt:'#ede9fe', primaryDk:'#5b5bb8', primaryHover:'#f5f5ff',
  danger:'#ef5350', dangerLt:'#fdecea',
  success:'#6ab56a', successLt:'#e8f5e9', successDk:'#2e7d32',
  warning:'#e8b830', warningLt:'#fffde7',
  orange:'#e65100', orangeLt:'#fff3e0',
  purple:'#9b72cb', purpleLt:'#ede8ff',
  teal:'#5cb5c5', tealLt:'#e8f5f0',
  gray100:'#f9fafb', gray200:'#f2f4f6', gray300:'#e5e8eb',
  gray400:'#d1d6db', gray500:'#b0b8c1', gray600:'#6b7684',
  gray700:'#4e5968', gray800:'#191f28',
  text:'#191f28', textSub:'#6b7684', textMuted:'#b0b8c1',
  bg:'#f9fafb', bgCard:'#ffffff', border:'#e5e8eb',
  radius:{ sm:4, md:8, lg:12, xl:16, full:999 },
  fs:{ nano:9, xxs:11, xs:12, sm:13, md:14, lg:16, xl:18, xxl:22 },
  fw:{ normal:400, medium:500, bold:600, bolder:700, black:800 },
  shadow:{ sm:'0 1px 3px rgba(0,0,0,.08)', md:'0 4px 12px rgba(0,0,0,.10)', lg:'0 8px 24px rgba(0,0,0,.14)' },
  sp:{ xs:4, sm:8, md:12, lg:16, xl:24 },
  info: '#5cb5c5', infoLt: '#e0f7fa', infoLt2: '#e8f5f0',
  male: '#4a7cc8', maleLt: '#e3f0ff',
  female: '#d96570', femaleLt: '#fce8e8',
  naver: '#03c75a', kakao: '#fee500', google: '#4285f4', instagram: '#e4405f',
  borderFocus: '#7c7cc8'
}

export const SCH_BRANCH_MAP = {
  gangnam:'br_4bcauqvrb', wangsimni:'br_wkqsxj6k1',
  hongdae:'br_l6yzs2pkq', magok:'br_k57zpkbx1',
  yongsan:'br_ybo3rmulv', jamsil:'br_lfv2wgdf1',
  wirye:'br_g768xdu4w', cheonho:'br_xu60omgdf',
}

// MALE_EMPLOYEES 삭제됨 — 전 직원이 employees_v1에 통합
export const MALE_EMPLOYEES = []

export const STATUS_LABEL = {
  confirmed:'진행', completed:'완료', cancelled:'취소',
  no_show:'노쇼', pending:'확정대기', request:'AI신청',
  naver_cancelled:'네이버취소', naver_changed:'변경됨',
}

// 지점별 기본 색상 (DB color가 없거나 흰색일 때 사용)
export const BRANCH_DEFAULT_COLORS = {
  'br_4bcauqvrb': '#7c7cc8', // 강남
  'br_wkqsxj6k1': '#5cb5c5', // 왕십리
  'br_l6yzs2pkq': '#e65100', // 홍대
  'br_k57zpkbx1': '#6ab56a', // 마곡
  'br_lfv2wgdf1': '#9b72cb', // 잠실
  'br_g768xdu4w': '#e8b830', // 위례
  'br_ybo3rmulv': '#d96570', // 용산
  'br_xu60omgdf': '#4a7cc8', // 천호
}

export function branchColor(branchId, dbColor) {
  if (dbColor && dbColor !== '#f8f8fc' && dbColor !== '#ffffff' && dbColor !== '') {
    return dbColor
  }
  return BRANCH_DEFAULT_COLORS[branchId] || '#7c7cc8'
}

// 원본 L473~ 상수들
export const NAVER_COLS = [
  { key:"상품",     label:"상품",     kws:["상품"] },
  { key:"시술메뉴",  label:"시술메뉴",  kws:["시술메뉴"] },
  { key:"유입경로",  label:"유입경로",  kws:["유입경로"] },
  { key:"관리부위",  label:"관리부위",  kws:["시술부위","관리받으실 부위","관리받을 부위","부위","Please tell me which part"] },
  { key:"주차",     label:"주차",     kws:["주차"] },
  { key:"첫방문",   label:"첫방문",   kws:["첫방문","first"] },
  { key:"요청",     label:"요청사항", kws:["요청"] },
]

export const getNaverVal = (requestMsg, keywords) => {
  if (!requestMsg) return ""
  if (requestMsg.trim().startsWith("[")) {
    try {
      const items = JSON.parse(requestMsg)
      for (const it of items) {
        if (keywords.some(kw => (it.label||"").includes(kw))) return it.value || ""
      }
    } catch(e) {}
  }
  return ""
}

export const STATUS_CLR = {
  confirmed: T.male, completed: T.success, cancelled: T.warning,
  no_show: T.danger, naver_cancelled: T.warning, naver_changed: T.gray500,
  pending: T.orange,
  request: '#9C27B0',
}

export const BLOCK_COLORS = {
  reservation: T.primary, memo: T.danger, clockin: T.gray400,
  cleaning: T.teal, break: T.purple,
}

export const DEFAULT_SOURCES = ["네이버","전화","방문","소개","인스타","카카오","기타"]
export const STATUS_KEYS = ["confirmed","completed","cancelled","no_show"]

export const SYSTEM_TAG_NAME_NEW_CUST = "신규"
export const SYSTEM_TAG_NAME_PREPAID  = "예약금완료"
export const SYSTEM_SRC_NAME_NAVER    = "네이버"

export const STATUS_CLR_DEFAULT = { confirmed:T.male, completed:T.success, cancelled:T.warning, no_show:T.danger, naver_cancel:T.danger }
