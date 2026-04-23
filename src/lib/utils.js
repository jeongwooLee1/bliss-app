import { useState, useEffect, useRef } from 'react'

// ── sessionStorage 연동 state 훅 (새로고침 시 유지, 탭 닫으면 초기화) ──
export function useSessionState(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw)
    } catch(e) {}
    return typeof initial === 'function' ? initial() : initial
  })
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(val)) } catch(e) {}
  }, [key, val])
  return [val, setVal]
}

// ── 스크롤 위치 자동 저장/복원 ──
// key만 주면 새 ref 리턴. externalRef 주면 기존 ref에 훅 부착만 (ref 그대로 리턴)
export function useScrollRestore(key, externalRef) {
  const newRef = useRef(null)
  const ref = externalRef || newRef
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let tries = 0
    const restore = () => {
      const saved = sessionStorage.getItem('scroll_' + key)
      if (!saved) return
      const target = parseInt(saved, 10)
      if (isNaN(target)) return
      if (el.scrollHeight > target + el.clientHeight / 2 || tries > 20) {
        el.scrollTop = target
      } else {
        tries++
        setTimeout(restore, 150)
      }
    }
    restore()
    let tm = null
    const onScroll = () => {
      if (tm) clearTimeout(tm)
      tm = setTimeout(() => {
        if (el.scrollTop > 0) sessionStorage.setItem('scroll_' + key, String(el.scrollTop))
      }, 150)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (tm) clearTimeout(tm) }
  }, [key, ref])
  return ref
}

// ── 날짜/시간 유틸 ──────────────────────────────────────────
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

export const pad = (n) => String(n).padStart(2, '0')

export const fmtDate = (ds) => {
  if (!ds) return ''
  const d = new Date(ds)
  if (isNaN(d)) return ds
  return `${d.getMonth()+1}.${pad(d.getDate())}`
}

export const fmtDt = (v) => {
  const d = new Date(v)
  if (isNaN(d)) return v
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fmtTime = (t) => {
  if (!t) return ''
  return t.slice(0, 5)
}

export const addMinutes = (timeStr, mins) => {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${pad(Math.floor(total/60) % 24)}:${pad(total % 60)}`
}

export const diffMins = (t1, t2) => {
  const toMins = t => { const [h,m]=t.split(':').map(Number); return h*60+m }
  return toMins(t2) - toMins(t1)
}

export const getDow = (ds) => ['일','월','화','수','목','금','토'][new Date(ds).getDay()]

// ── 예약 유틸 ──────────────────────────────────────────────
export const genId = (prefix='id') => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const rand = Array.from({length:10}, () => chars[Math.floor(Math.random()*chars.length)]).join('')
  return `${prefix}_${rand}`
}

export const getStatusLabel = (s) => ({
  confirmed:'진행', completed:'완료', cancelled:'취소',
  no_show:'노쇼', pending:'확정대기', request:'AI신청',
  naver_cancelled:'네이버취소', naver_changed:'변경됨',
}[s] || s)

export const getStatusColor = (s, T) => {
  if (s==='confirmed') return T.success
  if (s==='completed') return T.textMuted
  if (s==='cancelled'||s==='naver_cancelled') return T.danger
  if (s==='pending') return T.orange
  if (s==='request') return '#9C27B0'
  return T.textSub
}

// 전화번호 포맷
export const fmtPhone = (p) => {
  if (!p) return ''
  const n = p.replace(/\D/g,'')
  if (n.length===11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`
  if (n.length===10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`
  return p
}

// 서비스 이름 조합
export const getSvcNames = (svcIds, services) => {
  if (!svcIds?.length) return ''
  return svcIds.map(id => services?.find(s=>s.id===id)?.name || '').filter(Boolean).join(', ')
}

// 태그 이름 조합
export const getTagNames = (tagIds, tags) => {
  if (!tagIds?.length) return []
  return tagIds.map(id => tags?.find(t=>t.id===id)).filter(Boolean)
}

// 요일별 날짜 목록 (이번달)
export const getMonthDays = (year, month) => {
  const days = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    days.push(new Date(d))
    d.setDate(d.getDate()+1)
  }
  return days
}

// 시간 슬롯 (분 단위 → 픽셀)
export const timeToY = (timeStr, startHour=10, pixPerHour=60) => {
  const [h,m] = timeStr.split(':').map(Number)
  return (h - startHour) * pixPerHour + (m/60) * pixPerHour
}

export const durationToH = (mins, pixPerHour=60) => (mins/60) * pixPerHour

export const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
export const dateFromStr = (s) => { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
export const isoDate = (d) => d ? fmtLocal(new Date(d)) : ''

export const groupSvcNames = (ids, svcs) => {
  const counts = {};
  (ids||[]).forEach(id => { counts[id] = (counts[id]||0)+1; });
  return Object.entries(counts).map(([id,qty]) => {
    const s = svcs?.find(x=>x.id===id);
    let name = s?.name;
    if (!name && typeof id === 'string' && id.startsWith('pkg__')) {
      name = id.slice(5);
    }
    if (!name) return null;
    return qty>1 ? name+' x'+qty : name;
  }).filter(Boolean);
}

// ── 지점명 → 이니셜 매핑 (id_imgr471swt-3 수정요청) ──────────────────
// 강남 N / 왕십리 W / 홍대 H / 마곡 M / 잠실 J / 위례 R / 용산 Y / 천호 C
export const BRANCH_INITIAL_MAP = {
  '강남': 'N', '왕십리': 'W', '홍대': 'H', '마곡': 'M',
  '잠실': 'J', '위례': 'R', '용산': 'Y', '천호': 'C',
}

// branch 이름에서 이니셜 추출 ("강남본점", "하우스왁싱 마곡점" 등 유연 처리)
export const branchNameToInitial = (branchName) => {
  if (!branchName) return ''
  const clean = String(branchName).replace(/하우스왁싱\s*/g, '').replace(/본점|점$/g, '').trim()
  for (const key in BRANCH_INITIAL_MAP) {
    if (clean.includes(key)) return BRANCH_INITIAL_MAP[key]
  }
  return ''
}

// 단일 패키지의 구매지점 short 이름 추출 (id_imgr471swt-4 수정요청용)
// 우선순위: bid/branch_id → note "매장:XX" 첫 토큰
export const getPkgPurchaseBranchShort = (pkg, branches) => {
  if (!pkg) return ''
  const bid = pkg.bid || pkg.branch_id
  if (bid && Array.isArray(branches)) {
    const b = branches.find(x => x.id === bid)
    if (b) return (b.short || b.name || '').replace(/하우스왁싱\s*/g, '').replace(/본점$|점$/g, '').trim()
  }
  const m = (pkg.note||'').match(/매장:([^|\n]+)/)
  if (m) {
    const firstBranch = m[1].split('/')[0].trim()
    return firstBranch.replace(/하우스왁싱\s*/g, '').replace(/본점$|점$/g, '').trim()
  }
  return ''
}
// 현재 지점에서 이 보유권 사용이 허용되는가
// 정책(id_ebgbebctt3):
//   1) 연간회원권 → 전 지점 허용 (회원가 자격도 전 브랜드 공통)
//   2) branch_id 미판정 → 허용 (Phase 2 조사 대기)
//   3) 구매지점과 동일 → 허용
//   4) 같은 branch_group 멤버 → 허용 (관리설정에서 사장이 관리)
//   5) pkg.allowed_branch_ids 에 포함 → 허용 (개별 예외)
// branches, branchGroups 파라미터는 data에서 전달 (호출자 책임)
export const canUsePkgAtBranch = (pkg, currentBid, branches, branchGroups) => {
  if (!pkg) return true
  const svcName = pkg.service_name || pkg.serviceName || ''
  // 연간회원권은 전 지점 공통
  if (/연간(회원|할인)?권/.test(svcName)) return true
  // 구매지점 미판정(NULL) — Phase 2 조사 완료 전까지는 허용
  if (!pkg.branch_id) return true
  // 동일 지점
  if (pkg.branch_id === currentBid) return true
  // 같은 묶음(그룹) 멤버
  if (Array.isArray(branchGroups)) {
    for (const g of branchGroups) {
      const ids = g.branch_ids || g.branchIds || []
      if (ids.includes(pkg.branch_id) && ids.includes(currentBid)) return true
    }
  }
  // 개별 예외 허용 지점
  const allowed = pkg.allowed_branch_ids || pkg.allowedBranchIds || []
  if (allowed.includes(currentBid)) return true
  return false
}

// customer_packages 배열에서 유효한 패키지(잔여/잔액 > 0, 미만료) 중 최초 구매지점 이니셜
// pkgs: [{purchased_at, note, bid, branch_id, expires_at, total_count, used_count, ...}]
// branches: data.branches 배열
export const getCustPkgBranchInitial = (pkgs, branches) => {
  if (!Array.isArray(pkgs) || pkgs.length === 0) return ''
  const today = todayStr()
  const validPkgs = pkgs.filter(p => {
    // 유효기간 체크
    const expNote = (p.note||'').match(/유효:(\d{4}-\d{2}-\d{2})/)
    const exp = p.expires_at || (expNote ? expNote[1] : null)
    if (exp && String(exp).slice(0,10) < today) return false
    // 잔액/잔여 체크
    const balMatch = (p.note||'').match(/잔액:([0-9,]+)/)
    if (balMatch) {
      if (Number(balMatch[1].replace(/,/g,'')) <= 0) return false
    } else {
      const remain = (p.total_count||0) - (p.used_count||0)
      if (remain <= 0) return false
    }
    return true
  })
  if (validPkgs.length === 0) return ''
  // 구매일 오름차순 — 최초
  validPkgs.sort((a,b) => (a.purchased_at||'').localeCompare(b.purchased_at||''))
  const first = validPkgs[0]
  // 1) bid/branch_id 우선
  const bid = first.bid || first.branch_id
  if (bid && Array.isArray(branches)) {
    const b = branches.find(x => x.id === bid)
    if (b) return branchNameToInitial(b.short || b.name)
  }
  // 2) note의 "매장:XX" 첫 토큰
  const m = (first.note||'').match(/매장:([^|\s]+)/)
  if (m) {
    const firstBranch = m[1].split('/')[0].trim()
    return branchNameToInitial(firstBranch)
  }
  return ''
}
