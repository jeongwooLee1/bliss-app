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
  shadow:{ sm:'0 1px 3px rgba(0,0,0,.08)', md:'0 4px 12px rgba(0,0,0,.10)' }
}

export const SCH_BRANCH_MAP = {
  gangnam:'br_4bcauqvrb', wangsimni:'br_wkqsxj6k1',
  hongdae:'br_l6yzs2pkq', magok:'br_k57zpkbx1',
  yongsan:'br_ybo3rmulv', jamsil:'br_lfv2wgdf1',
  wirye:'br_g768xdu4w', cheonho:'br_xu60omgdf',
}

export const MALE_EMPLOYEES = [
  { id:'재윤', name:'재윤', branch:'male', branches:['male'], isOwner:false, weeklyOff:2, isMale:true },
  { id:'주용', name:'주용', branch:'male', branches:['male'], isOwner:false, weeklyOff:2, isMale:true },
]

export const STATUS_LABEL = {
  confirmed:'진행', completed:'완료', cancelled:'취소',
  no_show:'노쇼', pending:'확정대기',
  naver_cancelled:'네이버취소', naver_changed:'변경됨',
}
