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
  no_show:'노쇼', pending:'확정대기',
  naver_cancelled:'네이버취소', naver_changed:'변경됨',
}[s] || s)

export const getStatusColor = (s, T) => {
  if (s==='confirmed') return T.success
  if (s==='completed') return T.textMuted
  if (s==='cancelled'||s==='naver_cancelled') return T.danger
  if (s==='pending') return T.orange
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
    const n = s?.name||'?';
    return qty>1 ? n+' x'+qty : n;
  });
}
