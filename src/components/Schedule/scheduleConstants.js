import { T } from '../../lib/constants'

export const BRANCHES_SCH = [
  { id:'gangnam',   name:'강남',   color:'#c8793a', minStaff:1 },
  { id:'wangsimni', name:'왕십리', color:'#d4923a', minStaff:1 },
  { id:'hongdae',   name:'홍대',   color:'#3a9e8e', minStaff:1 },
  { id:'magok',     name:'마곡',   color:'#2e8a7a', minStaff:1 },
  { id:'yongsan',   name:'용산',   color:'#8b6fa3', minStaff:1 },
  { id:'jamsil',    name:'잠실',   color:'#3a7aaf', minStaff:1 },
  { id:'wirye',     name:'위례',   color:'#5a9abf', minStaff:1 },
  { id:'cheonho',   name:'천호',   color:'#a07040', minStaff:1 },
]

export const BRANCH_LABEL = Object.fromEntries(BRANCHES_SCH.map(b => [b.id, b.name]))

export const STATUS = { WORK:'근무', OFF:'휴무', MUST_OFF:'휴무(꼭)', UNPAID:'무급', SUPPORT:'지원', SHARE:'전체쉐어' }

// 휴무 계열 (휴무/휴무(꼭)/무급) — isOffStatus() 헬퍼로 일괄 체크
export const OFF_STATUSES = ['휴무', '휴무(꼭)', '무급']
export function isOffStatus(s) { return OFF_STATUSES.includes(s) }

export const S_COLOR = {
  '근무':     { bg:'#ffffff',     text:'#b0b8c1',   border:'#eef0f2' },
  '휴무':     { bg:T.purpleLt,   text:T.purple,    border:'#c4a4e8', bold:true },
  '휴무(꼭)': { bg:T.primaryLt,  text:T.primaryDk, border:T.primary, bold:true },
  '무급':     { bg:'#f5f5f5',    text:'#757575',   border:'#bdbdbd', bold:true },
  '지원':     { bg:T.orangeLt,   text:T.orange,    border:'#ffb74d' },
  '전체쉐어': { bg:T.tealLt,     text:T.teal,      border:'#80cbc4', bold:true },
}

export const DNAMES = ['월','화','수','목','금','토','일']

export function isSupport(s) { return s && (s === '지원' || s.startsWith('지원(')) }
export function getSColor(s) {
  if (isSupport(s)) return S_COLOR['지원']
  return S_COLOR[s] || { bg:'#f8f5f0', text:T.gray400, border:'#eee' }
}

export function getDim(y, m) { return new Date(y, m+1, 0).getDate() }
export function fmtDs(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
export function getDow0Mon(y, m, d) { const w = new Date(y, m, d).getDay(); return w === 0 ? 6 : w-1 }
export function addDays(ds, n) { const d = new Date(ds); d.setDate(d.getDate()+n); return fmtDs(d.getFullYear(), d.getMonth(), d.getDate()) }

// DB storage keys
export const DB_KEYS = {
  schHistory:      'schHistory_v1',
  employees:       'employees_v1',
  ownerReqs:       'ownerReqs_v1',
  empReqs:         'empReqs_v1',
  empReqsTs:       'empReqs_ts_v1',
  ownerRepeat:     'ownerRepeat_v1',
  ruleConfig:      'ruleConfig_v1',
  supportOrder:    'supportOrder_v1',
  lockStatus:      'lockStatus_v1',
  maleRotation:    'maleRotation_v1',
  customEmployees: 'customEmployees_v1',
  empSettings:     'empSettings_v1',
  deletedEmpIds:   'deletedEmpIds_v1',
  customRules:     'customRules_v1',
  schSnapshots:    'schSnapshots_v1',
  cellTagDefs:     'cellTagDefs_v1',
  schTagsHistory:  'schTagsHistory_v1',
  nonScheduleEmployees: 'nonScheduleEmployees_v1',
}

// 셀 태그 기본 정의 (최초 로드 시)
export const DEFAULT_CELL_TAGS = [
  { id:'tag_share',  name:'쉐어', color:'#4CAF50' },
  { id:'tag_sunrise', name:'일출', color:'#FF9800' },
]

export const DEFAULT_RULES = [
  ['🌍 전체',['주 시작: 월요일','일 근무인원: 최소 11명 ~ 최대 15명','하루 전체 휴무 최대 5명 (남자직원 제외)','휴무 텀: 최대 6일(7일 초과 금지)','연속 2일 휴무: 월 2회 허용','3일 연속 휴무: 절대 금지']],
  ['📍 강남&왕십리',['경아·서현·소연·수연 로테이션','그룹 내 지원 우선, 부족 시 외부 지원']],
  ['📍 홍대&마곡',['현아·혜경·지은·민아 로테이션','현아 타지점 이동 불가(mustStay)','지은 원장: 지정 휴무일 고정']],
  ['📍 용산',['보령(원장) 타지점 이동 불가','희서·민정 지원 가능','보령: 지정 휴무일 고정']],
  ['📍 잠실&위례',['소이·유라·다해 로테이션','그룹 내 지원 우선, 부족 시 외부 지원']],
  ['📍 천호',['미진(원장) 타지점 이동 불가','수민 지원 가능','수민·미진 동시 휴무 금지']],
  ['🔄 지원 우선순위',['각 지점 minStaff 미달 시 그룹 내 → supportOrder → 나머지 순']],
]
