import { useState, useMemo, useCallback } from 'react'
import { T, MALE_EMPLOYEES } from '../../lib/constants'
import { useSchHistory } from '../../lib/useData'
import { pad, getMonthDays } from '../../lib/utils'
import autoAssign from './autoAssign'

const BRANCHES_SCH = [
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
  '근무':     { bg:T.successLt, text:T.successDk, border:T.success },
  '휴무':     { bg:T.purpleLt,  text:T.purple,    border:'#c4a4e8', bold:true },
  '휴무(꼭)': { bg:T.primaryLt, text:T.primaryDk, border:T.primary, bold:true },
  '지원':     { bg:T.orangeLt,  text:T.orange,    border:'#ffb74d' },
}
const S_CYCLE = [STATUS.WORK, STATUS.OFF, STATUS.MUST_OFF]
const DOW = ['일','월','화','수','목','금','토']

export default function SchedulePage({ employees }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [assigning, setAssigning] = useState(false)
  const [msg, setMsg] = useState('')

  const { schHistory, setSchHistory, save } = useSchHistory()
  const days = useMemo(() => getMonthDays(year, month), [year, month])
  const curKey = `${year}-${pad(month+1)}`

  // 현재 월 근무표
  const sch = useMemo(() => {
    const base = {}
    employees.forEach(e => { base[e.id] = {} })
    const cur = schHistory[curKey] || {}
    Object.entries(cur).forEach(([emp, dayMap]) => {
      if (base[emp]) Object.assign(base[emp], dayMap)
    })
    return base
  }, [schHistory, curKey, employees])

  const getS = (empId, ds) => sch[empId]?.[ds] || STATUS.WORK

  const setCell = useCallback((empId, ds, val) => {
    setSchHistory(prev => {
      const cur = prev[curKey] || {}
      const empDays = { ...(cur[empId]||{}), [ds]: val }
      const next = { ...prev, [curKey]: { ...cur, [empId]: empDays } }
      save(next)
      return next
    })
  }, [curKey, setSchHistory, save])

  const cycleCell = (empId, ds) => {
    const cur = getS(empId, ds)
    const idx = S_CYCLE.indexOf(cur)
    const next = S_CYCLE[(idx+1) % S_CYCLE.length]
    setCell(empId, ds, next)
  }

  const handleAutoAssign = async () => {
    const nonMale = employees.filter(e => !e.isMale)
    if (!nonMale.length) { setMsg('직원 데이터 없음'); return }

    setAssigning(true)
    setMsg('')
    try {
      // empSettings 로드
      const empSettings = {}
      nonMale.forEach(e => {
        empSettings[e.id] = {
          weeklyWork: 7 - (e.weeklyOff||2),
          altPattern: e.altPattern||false,
          isFreelancer: e.isFreelancer||false,
        }
      })

      // 전달 데이터
      const prevKey = month === 0
        ? `${year-1}-12`
        : `${year}-${pad(month)}`
      const prevSchData = schHistory[prevKey] || {}

      const result = await new Promise((resolve) => {
        setTimeout(() => {
          try {
            const r = autoAssign(year, month, {}, prevSchData, empSettings, {}, nonMale, BRANCHES_SCH)
            resolve(r)
          } catch(e) { resolve(null) }
        }, 10)
      })

      if (result) {
        setSchHistory(prev => {
          const next = { ...prev, [curKey]: result }
          save(next)
          return next
        })
        setMsg('자동배치 완료!')
      } else {
        setMsg('자동배치 실패')
      }
    } finally {
      setAssigning(false)
    }
  }

  const prevMonth = () => {
    const d = new Date(year, month-1)
    setYear(d.getFullYear()); setMonth(d.getMonth())
  }
  const nextMonth = () => {
    const d = new Date(year, month+1)
    setYear(d.getFullYear()); setMonth(d.getMonth())
  }

  const nonMale = employees.filter(e => !e.isMale)
  const maleEmps = employees.filter(e => e.isMale)

  const grouped = BRANCHES_SCH.map(br => ({
    ...br, emps: nonMale.filter(e => e.branch === br.id)
  })).filter(br => br.emps.length > 0)

  // 일 근무인원 집계
  const dailyCount = (ds) => nonMale.filter(e => {
    const s = getS(e.id, ds)
    return s === STATUS.WORK || s?.startsWith('지원')
  }).length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh' }}>
      {/* 헤더 */}
      <div style={{ padding:'10px 12px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontSize:T.fs.md, fontWeight:T.fw.bolder }}>{year}년 {month+1}월</span>
            <button onClick={nextMonth} style={navBtn}>›</button>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {msg && <span style={{ fontSize:T.fs.xxs, color:T.success, alignSelf:'center' }}>{msg}</span>}
            <button onClick={handleAutoAssign} disabled={assigning} style={{
              padding:'6px 14px', borderRadius:T.radius.md,
              background:assigning?T.gray300:T.primary, color:'#fff', border:'none',
              fontSize:T.fs.xs, fontWeight:T.fw.bold, cursor:'pointer',
            }}>
              {assigning ? '배치중...' : '⚡ 자동배치'}
            </button>
          </div>
        </div>
      </div>

      {/* 근무표 테이블 */}
      <div style={{ flex:1, overflow:'auto' }}>
        <table style={{ borderCollapse:'collapse', fontSize:10, minWidth:'max-content', tableLayout:'fixed' }}>
          <thead style={{ position:'sticky', top:0, zIndex:10 }}>
            <tr>
              <th style={{ ...stickyCol, background:T.gray100, padding:'5px 8px', borderBottom:`2px solid ${T.border}`, textAlign:'left', fontSize:T.fs.xxs, color:T.textSub, width:140, minWidth:140 }}>직원</th>
              {days.map(d => {
                const isWeekend = d.getDay()===0||d.getDay()===6
                const ds = d.toISOString().slice(0,10)
                return (
                  <th key={ds} style={{ minWidth:36, width:36, padding:'3px 1px', textAlign:'center', borderBottom:`2px solid ${T.border}`, background:T.gray100, color:isWeekend?(d.getDay()===0?T.danger:T.primary):T.textSub }}>
                    <div style={{ fontSize:10 }}>{d.getDate()}</div>
                    <div style={{ fontSize:8 }}>{DOW[d.getDay()]}</div>
                  </th>
                )
              })}
            </tr>
            {/* 일 근무인원 */}
            <tr>
              <td style={{ ...stickyCol, background:T.gray200, padding:'3px 8px', borderBottom:`1px solid ${T.border}`, fontSize:T.fs.xxs, color:T.textSub, fontWeight:T.fw.bold }}>일 근무인원</td>
              {days.map(d => {
                const ds = d.toISOString().slice(0,10)
                const cnt = dailyCount(ds)
                const ok = cnt >= 10 && cnt <= 15
                return (
                  <td key={ds} style={{ textAlign:'center', borderBottom:`1px solid ${T.border}`, background:T.gray200, color:ok?T.successDk:T.danger, fontWeight:T.fw.bolder, fontSize:10 }}>
                    {cnt}
                  </td>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {grouped.map(br => (
              <>
                <tr key={`hd-${br.id}`}>
                  <td colSpan={days.length+1} style={{ padding:'4px 8px', background:br.color+'20', borderLeft:`3px solid ${br.color}`, fontSize:T.fs.xxs, fontWeight:T.fw.bolder, color:br.color, borderBottom:`1px solid ${T.border}` }}>
                    {br.name}
                  </td>
                </tr>
                {br.emps.map(emp => (
                  <tr key={emp.id}>
                    <td style={{ ...stickyCol, padding:'3px 8px', borderLeft:`3px solid ${br.color}`, borderBottom:`1px solid ${T.border}` }}>
                      <EmpCell emp={emp} br={br} sch={sch} year={year} month={month} />
                    </td>
                    {days.map(d => {
                      const ds = d.toISOString().slice(0,10)
                      const status = getS(emp.id, ds)
                      const sc = S_COLOR[status] || (status?.startsWith('지원') ? S_COLOR['지원'] : S_COLOR['근무'])
                      const label = status===STATUS.WORK?'근무':status===STATUS.OFF?'휴':status===STATUS.MUST_OFF?'꼭':status.replace('지원(','↗').replace(')','')
                      return (
                        <td key={ds} onClick={()=>cycleCell(emp.id,ds)} style={{ padding:2, textAlign:'center', borderBottom:`1px solid ${T.border}`, cursor:'pointer', userSelect:'none' }}>
                          <div style={{ background:sc.bg, color:sc.text, border:`1px solid ${sc.border}`, borderRadius:3, padding:'2px 0', fontSize:9, fontWeight:sc.bold?700:500 }}>
                            {label}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </>
            ))}

            {/* 남자직원 */}
            {maleEmps.length > 0 && <>
              <tr>
                <td colSpan={days.length+1} style={{ padding:'4px 8px', background:'#e8f0fb', borderLeft:'3px solid #2a6099', fontSize:T.fs.xxs, fontWeight:T.fw.bolder, color:'#2a6099', borderBottom:`1px solid ${T.border}` }}>
                  남자직원
                </td>
              </tr>
              {maleEmps.map(emp => (
                <tr key={emp.id}>
                  <td style={{ ...stickyCol, padding:'3px 8px', borderLeft:'3px solid #2a6099', borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ fontSize:11 }}>{emp.name}</div>
                    <div style={{ fontSize:8, color:T.textMuted }}>남직원</div>
                  </td>
                  {days.map(d => {
                    const ds = d.toISOString().slice(0,10)
                    const status = getS(emp.id, ds)
                    const sc = S_COLOR[status] || S_COLOR['근무']
                    return (
                      <td key={ds} onClick={()=>cycleCell(emp.id,ds)} style={{ padding:2, textAlign:'center', borderBottom:`1px solid ${T.border}`, cursor:'pointer', userSelect:'none' }}>
                        <div style={{ background:sc.bg, color:sc.text, border:`1px solid ${sc.border}`, borderRadius:3, padding:'2px 0', fontSize:9, fontWeight:sc.bold?700:500 }}>
                          {status===STATUS.WORK?'근':status===STATUS.OFF?'휴':'꼭'}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmpCell({ emp, br, sch, year, month }) {
  const curMs = `${year}-${pad(month+1)}`
  const empSch = sch[emp.id] || {}
  const workDays = Object.entries(empSch).filter(([ds,s])=>ds.startsWith(curMs)&&(s==='근무'||s?.startsWith('지원')||s==='')).length
  const offDays = Object.entries(empSch).filter(([ds,s])=>ds.startsWith(curMs)&&(s==='휴무'||s==='휴무(꼭)')).length

  const supportMap = {}
  Object.values(empSch).forEach(s => {
    if (s?.startsWith('지원(')) {
      const bn = s.replace('지원(','').replace(')','')
      supportMap[bn] = (supportMap[bn]||0)+1
    }
  })
  const supportEntries = Object.entries(supportMap)

  return (
    <>
      <div style={{ fontSize:11, fontWeight:emp.isOwner?T.fw.bolder:T.fw.medium, display:'flex', alignItems:'center', gap:4 }}>
        {emp.name}
        {supportEntries.length>0 && (
          <span style={{ fontSize:8, background:'#fff4e0', color:'#c87020', border:'1px solid #ffd090', borderRadius:3, padding:'0 3px' }}>
            {supportEntries.map(([bn,cnt])=>`${bn}:${cnt}`).join(' ')}
          </span>
        )}
      </div>
      <div style={{ fontSize:8, color:T.textMuted, display:'flex', gap:4 }}>
        <span>{br.name}</span>
        {(workDays>0||offDays>0) && (
          <span style={{ fontWeight:700, color:(workDays<11||workDays>15)?T.danger:T.textSub }}>
            근{workDays}·휴{offDays}
          </span>
        )}
      </div>
    </>
  )
}

const stickyCol = { position:'sticky', left:0, zIndex:5, background:T.bgCard }
const navBtn = { width:28, height:28, borderRadius:'50%', border:`1px solid ${T.border}`, background:'none', cursor:'pointer', fontSize:16 }
