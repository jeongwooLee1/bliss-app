// 근무표 - Supabase에서 직원/지점 동적 로드, 하드코딩 없음
import { useState, useMemo } from 'react'
import { useSchHistory } from '../../lib/useData'
import { T, SCH_BRANCH_MAP } from '../../lib/constants'

const BRANCHES_SCHEDULE = [
  { id:'gangnam',   name:'강남',   color:'#c8793a', minStaff:1 },
  { id:'wangsimni', name:'왕십리', color:'#d4923a', minStaff:1 },
  { id:'hongdae',   name:'홍대',   color:'#3a9e8e', minStaff:1 },
  { id:'magok',     name:'마곡',   color:'#2e8a7a', minStaff:1 },
  { id:'yongsan',   name:'용산',   color:'#8b6fa3', minStaff:1 },
  { id:'jamsil',    name:'잠실',   color:'#3a7aaf', minStaff:1 },
  { id:'wirye',     name:'위례',   color:'#5a9abf', minStaff:1 },
  { id:'cheonho',   name:'천호',   color:'#a07040', minStaff:1 },
]

const STATUS = { WORK:'근무', OFF:'휴무', MUST_OFF:'휴무(꼭)', SUPPORT:'지원' }
const S_COLOR = {
  '근무':    { bg:T.successLt, text:T.successDk, border:T.success },
  '휴무':    { bg:T.purpleLt,  text:T.purple,    border:'#c4a4e8', bold:true },
  '휴무(꼭)':{ bg:T.primaryLt, text:T.primaryDk, border:T.primary, bold:true },
  '지원':    { bg:T.orangeLt,  text:T.orange,    border:'#ffb74d' },
}

function getDaysInMonth(year, month) {
  const days = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

export default function SchedulePage({ employees }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const { schHistory, setSchHistory, save } = useSchHistory()

  const days = useMemo(() => getDaysInMonth(year, month), [year, month])
  const curKey = `${year}-${String(month+1).padStart(2,'0')}`

  const sch = useMemo(() => {
    const base = {}
    employees.forEach(e => { base[e.id] = {} })
    Object.entries(schHistory[curKey] || {}).forEach(([emp, dayMap]) => {
      if (base[emp]) Object.assign(base[emp], dayMap)
    })
    return base
  }, [schHistory, curKey, employees])

  const setCell = (empId, ds, val) => {
    setSchHistory(prev => {
      const cur = prev[curKey] || {}
      const empDays = { ...(cur[empId] || {}), [ds]: val }
      const next = { ...prev, [curKey]: { ...cur, [empId]: empDays } }
      save(next)
      return next
    })
  }

  const cycleStatus = (empId, ds) => {
    const cur = sch[empId]?.[ds] || STATUS.WORK
    const cycle = [STATUS.WORK, STATUS.OFF, STATUS.MUST_OFF]
    const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length]
    setCell(empId, ds, next)
  }

  const nonMale = employees.filter(e => !e.isMale)
  const grouped = BRANCHES_SCHEDULE.map(br => ({
    ...br,
    emps: nonMale.filter(e => e.branch === br.id)
  })).filter(br => br.emps.length > 0)

  return (
    <div style={{ padding:'16px 0' }}>
      {/* 헤더 */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={() => { const d = new Date(year, month-1); setYear(d.getFullYear()); setMonth(d.getMonth()) }}
            style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${T.border}`, background:T.bgCard, cursor:'pointer', fontSize:14 }}>‹</button>
          <span style={{ fontSize:T.fs.md, fontWeight:T.fw.bolder }}>{year}년 {month+1}월</span>
          <button onClick={() => { const d = new Date(year, month+1); setYear(d.getFullYear()); setMonth(d.getMonth()) }}
            style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${T.border}`, background:T.bgCard, cursor:'pointer', fontSize:14 }}>›</button>
        </div>
      </div>

      {/* 근무표 테이블 */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', fontSize:10, minWidth:'max-content' }}>
          <thead>
            <tr>
              <th style={{ position:'sticky', left:0, zIndex:10, width:130, background:T.gray100, padding:'6px 8px', borderBottom:`1px solid ${T.border}`, textAlign:'left', fontSize:T.fs.xs, color:T.textSub }}>직원</th>
              {days.map(d => (
                <th key={d.toISOString()} style={{ minWidth:36, padding:'4px 2px', textAlign:'center', borderBottom:`1px solid ${T.border}`, background:T.gray100, color: d.getDay()===0?T.danger:d.getDay()===6?T.primary:T.textSub }}>
                  <div style={{ fontSize:10 }}>{d.getDate()}</div>
                  <div style={{ fontSize:9, color:T.textMuted }}>{'일월화수목금토'[d.getDay()]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(br => (
              <>
                <tr key={`br-${br.id}`}>
                  <td colSpan={days.length+1} style={{ padding:'4px 8px', background:br.color+'22', borderLeft:`3px solid ${br.color}`, fontSize:T.fs.xs, fontWeight:T.fw.bold, color:br.color }}>
                    {br.name}
                  </td>
                </tr>
                {br.emps.map(emp => (
                  <tr key={emp.id}>
                    <td style={{ position:'sticky', left:0, zIndex:5, background:T.bgCard, padding:'3px 8px', borderLeft:`3px solid ${br.color}`, borderBottom:`1px solid ${T.border}`, minWidth:130 }}>
                      <div style={{ fontSize:11, fontWeight:emp.isOwner?T.fw.bolder:T.fw.medium }}>{emp.name}</div>
                      <div style={{ fontSize:9, color:T.textMuted }}>{br.name}</div>
                    </td>
                    {days.map(d => {
                      const ds = d.toISOString().slice(0,10)
                      const status = sch[emp.id]?.[ds] || STATUS.WORK
                      const sc = S_COLOR[status] || S_COLOR['근무']
                      return (
                        <td key={ds} onClick={() => cycleStatus(emp.id, ds)}
                          style={{ padding:2, textAlign:'center', borderBottom:`1px solid ${T.border}`, cursor:'pointer' }}>
                          <div style={{ background:sc.bg, color:sc.text, border:`1px solid ${sc.border}`,
                            borderRadius:4, padding:'2px 1px', fontSize:9, fontWeight:sc.bold?700:500, minWidth:30 }}>
                            {status === STATUS.WORK ? '근무' : status === STATUS.OFF ? '휴무' : status === STATUS.MUST_OFF ? '꼭' : status.replace('지원(','').replace(')','지원')}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
