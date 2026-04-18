import { useMemo } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, BRANCH_LABEL, STATUS, isSupport, DNAMES } from './scheduleConstants'

export default function DailyView({ days, sch, allEmployees, year, month, maleRotation }) {
  const monthDays = useMemo(() => days.filter(d => !d.isNext), [days])

  const getMaleRotBranch = (empId, dateStr) => {
    const rot = (maleRotation || {})[empId]
    if (!rot?.branches?.length || !rot.startDate) return null
    const start = new Date(rot.startDate)
    const target = new Date(dateStr)
    const diffDays = Math.floor((target - start) / (1000*60*60*24))
    const weekIdx = Math.floor(diffDays / 7)
    const idx = ((weekIdx % rot.branches.length) + rot.branches.length) % rot.branches.length
    return rot.branches[idx]
  }

  // 각 지점의 최대 직원 수 계산 (모든 날짜 중 가장 많은 인원)
  const branchMaxCounts = useMemo(() => {
    const maxMap = {}
    BRANCHES_SCH.forEach(b => { maxMap[b.id] = { present:0, off:0 } })

    monthDays.forEach(day => {
      const maleBranchMap = {}
      allEmployees.filter(e => e.isMale).forEach(emp => {
        const s = sch[emp.id]?.[day.ds] || ''
        if (s === STATUS.OFF || s === STATUS.MUST_OFF || s === STATUS.UNPAID) return
        const rotBranch = getMaleRotBranch(emp.id, day.ds)
        if (rotBranch) {
          if (!maleBranchMap[rotBranch]) maleBranchMap[rotBranch] = 0
          maleBranchMap[rotBranch]++
        }
      })

      BRANCHES_SCH.forEach(branch => {
        const branchEmps = allEmployees.filter(e => e.branch === branch.id && !e.isMale)
        const working = branchEmps.filter(e => {
          const s = sch[e.id]?.[day.ds] || ''
          return s === STATUS.WORK || s === STATUS.SHARE || s === ''
        }).length
        const supporters = allEmployees.filter(e => {
          const s = sch[e.id]?.[day.ds] || ''
          return isSupport(s) && s.includes(branch.name)
        }).length
        const males = maleBranchMap[branch.id] || 0
        const off = branchEmps.filter(e => {
          const s = sch[e.id]?.[day.ds] || ''
          return s === STATUS.OFF || s === STATUS.MUST_OFF || s === STATUS.UNPAID
        }).length

        const present = working + supporters + males
        if (present > maxMap[branch.id].present) maxMap[branch.id].present = present
        if (off > maxMap[branch.id].off) maxMap[branch.id].off = off
      })
    })
    return maxMap
  }, [monthDays, sch, allEmployees, maleRotation])

  // 지점별 고정 높이 계산: 헤더(18) + present행(ceil(max/3)*22) + off행(ceil(max/3)*18) + padding
  const branchHeights = useMemo(() => {
    const h = {}
    BRANCHES_SCH.forEach(b => {
      const mc = branchMaxCounts[b.id]
      const presentRows = Math.max(1, Math.ceil(mc.present / 3))
      const offRows = mc.off > 0 ? Math.ceil(mc.off / 3) : 0
      h[b.id] = 20 + presentRows * 24 + offRows * 20 + 12
    })
    return h
  }, [branchMaxCounts])

  return (
    <div style={{ display:'flex', gap:6, padding:'8px 4px', minWidth:'max-content' }}>
      {monthDays.map(day => {
        const isSun = day.dow === 6, isSat = day.dow === 5
        const today = new Date()
        const isToday = day.ds === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

        const maleBranchMap = {}
        allEmployees.filter(e => e.isMale).forEach(emp => {
          const s = sch[emp.id]?.[day.ds] || ''
          if (s === STATUS.OFF || s === STATUS.MUST_OFF || s === STATUS.UNPAID) return
          const rotBranch = getMaleRotBranch(emp.id, day.ds)
          if (rotBranch) {
            if (!maleBranchMap[rotBranch]) maleBranchMap[rotBranch] = []
            maleBranchMap[rotBranch].push(emp)
          }
        })

        return (
          <div key={day.ds} style={{ width:130, flexShrink:0 }}>
            <div style={{
              textAlign:'center', padding:'6px 4px', marginBottom:4,
              background:isToday ? T.primary : '#fff', color:isToday ? '#fff' : isSun ? T.danger : isSat ? T.purple : T.text,
              borderRadius:8, fontWeight:800, fontSize:14,
              boxShadow:isToday ? '0 2px 8px rgba(124,124,200,.3)' : '0 1px 3px rgba(0,0,0,.06)'
            }}>
              <div>{day.d}</div>
              <div style={{ fontSize:10, fontWeight:500, opacity:0.7 }}>{DNAMES[day.dow]}</div>
            </div>

            {BRANCHES_SCH.map(branch => {
              const branchEmps = allEmployees.filter(e => e.branch === branch.id && !e.isMale)
              const working = branchEmps.filter(e => {
                const s = sch[e.id]?.[day.ds] || ''
                return s === STATUS.WORK || s === STATUS.SHARE || s === ''
              })
              const supporters = allEmployees.filter(e => {
                const s = sch[e.id]?.[day.ds] || ''
                return isSupport(s) && s.includes(branch.name)
              })
              const off = branchEmps.filter(e => {
                const s = sch[e.id]?.[day.ds] || ''
                return s === STATUS.OFF || s === STATUS.MUST_OFF || s === STATUS.UNPAID
              })
              const malesHere = maleBranchMap[branch.id] || []
              const allPresent = [...working, ...supporters, ...malesHere]

              return (
                <div key={branch.id} style={{
                  marginBottom:4, borderRadius:8, padding:'4px 6px',
                  background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.05)',
                  borderLeft:`3px solid ${branch.color}`,
                  height:branchHeights[branch.id], boxSizing:'border-box',
                  display:'flex', flexDirection:'column'
                }}>
                  <div style={{ fontSize:9, fontWeight:700, color:branch.color, marginBottom:2, flexShrink:0 }}>
                    {branch.name} <span style={{ fontWeight:500, color:T.textMuted }}>{allPresent.length}</span>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:2, alignContent:'flex-start', flex:1 }}>
                    {working.map(emp => (
                      <span key={emp.id} style={{ fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:4, background:'#f5f5f7', color:T.gray700, lineHeight:'18px' }}>{emp.name}</span>
                    ))}
                    {supporters.map(emp => (
                      <span key={emp.id} style={{ fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:4, background:T.orangeLt, color:T.orange, lineHeight:'18px' }}>{emp.name}↗</span>
                    ))}
                    {malesHere.map(emp => (
                      <span key={emp.id} style={{ fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:4, background:T.primaryLt, color:T.primaryDk, lineHeight:'18px' }}>{emp.name}</span>
                    ))}
                  </div>
                  {off.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:2, marginTop:2, flexShrink:0 }}>
                      {off.map(emp => (
                        <span key={emp.id} style={{ fontSize:9, fontWeight:500, padding:'0px 4px', borderRadius:3, background:T.purpleLt, color:T.purple, opacity:0.6, lineHeight:'16px' }}>{emp.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
