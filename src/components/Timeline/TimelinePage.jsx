import { useState, useMemo } from 'react'
import { T, SCH_BRANCH_MAP } from '../../lib/constants'

function todayStr() { return new Date().toISOString().slice(0,10) }
function pad(n) { return String(n).padStart(2,'0') }

export default function TimelinePage({ data, employees, schHistory, currentUser, isMaster }) {
  const [selDate, setSelDate] = useState(todayStr())

  const branches = data?.branches || []
  const reservations = data?.reservations || []

  // 오늘 근무하는 직원을 지점별로 분류
  const workingByBranch = useMemo(() => {
    const map = {}
    branches.forEach(br => { map[br.id] = [] })

    employees.forEach(emp => {
      if (emp.isMale) return
      const status = schHistory[emp.id]?.[selDate]
      // 휴무면 제외
      if (status === '휴무' || status === '휴무(꼭)') return

      // 지원 근무 처리
      if (status?.startsWith('지원(')) {
        const brName = status.replace('지원(','').replace(')','')
        const br = branches.find(b => b.short === brName || b.name.includes(brName))
        if (br && map[br.id]) { map[br.id].push({ ...emp, isSupport: true }); return }
      }

      // 원래 지점
      const branchId = SCH_BRANCH_MAP[emp.branch]
      if (branchId && map[branchId]) map[branchId].push(emp)
    })
    return map
  }, [employees, schHistory, selDate, branches])

  // 날짜 이동
  const changeDate = (delta) => {
    const d = new Date(selDate)
    d.setDate(d.getDate() + delta)
    setSelDate(d.toISOString().slice(0,10))
  }

  const dateObj = new Date(selDate)
  const DOW = ['일','월','화','수','목','금','토']

  const userBranches = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const visibleBranches = branches.filter(b => userBranches.includes(b.id))

  // 시간대 (10:00 ~ 21:00)
  const hours = Array.from({length:12}, (_,i) => i+10)

  return (
    <div>
      {/* 날짜 헤더 */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, position:'sticky', top:0, zIndex:20 }}>
        <button onClick={()=>changeDate(-1)} style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${T.border}`, background:'none', cursor:'pointer' }}>‹</button>
        <div style={{ flex:1, textAlign:'center' }}>
          <span style={{ fontSize:T.fs.md, fontWeight:T.fw.bolder }}>
            {dateObj.getMonth()+1}.{pad(dateObj.getDate())} ({DOW[dateObj.getDay()]})
          </span>
        </div>
        <button onClick={()=>changeDate(1)} style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${T.border}`, background:'none', cursor:'pointer' }}>›</button>
        <button onClick={()=>setSelDate(todayStr())} style={{ fontSize:T.fs.xs, padding:'4px 10px', borderRadius:T.radius.md, border:`1px solid ${T.border}`, background:'none', cursor:'pointer', color:T.textSub }}>오늘</button>
      </div>

      {/* 지점별 타임라인 */}
      <div style={{ overflowX:'auto' }}>
        {visibleBranches.map(br => {
          const staff = workingByBranch[br.id] || []
          const brRes = reservations.filter(r => r.bid === br.id && r.date === selDate && r.status !== 'naver_cancelled' && r.status !== 'naver_changed')

          return (
            <div key={br.id} style={{ marginBottom:16 }}>
              {/* 지점 헤더 */}
              <div style={{ padding:'6px 16px', background:br.color+'22', borderLeft:`3px solid ${br.color}`, fontSize:T.fs.xs, fontWeight:T.fw.bold, color:br.color }}>
                {br.short || br.name} {staff.length > 0 ? `· ${staff.map(e=>e.id).join(', ')}` : ''}
              </div>

              {/* 직원 컬럼 */}
              {staff.length === 0 ? (
                <div style={{ padding:'12px 16px', color:T.textMuted, fontSize:T.fs.xs }}>오늘 근무자 없음</div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <div style={{ display:'flex', minWidth:'max-content' }}>
                    {/* 시간축 */}
                    <div style={{ width:36, flexShrink:0, borderRight:`1px solid ${T.border}` }}>
                      <div style={{ height:32 }} /> {/* 헤더 공간 */}
                      {hours.map(h => (
                        <div key={h} style={{ height:40, padding:'4px 4px 0', fontSize:9, color:T.textMuted, borderTop:`1px solid ${T.gray200}` }}>{h}:00</div>
                      ))}
                    </div>

                    {/* 직원별 컬럼 */}
                    {staff.map(emp => {
                      const empRes = brRes.filter(r => r.staff_id === emp.id || !r.staff_id)
                      return (
                        <div key={emp.id} style={{ width:80, flexShrink:0, borderRight:`1px solid ${T.border}` }}>
                          {/* 직원명 헤더 */}
                          <div style={{ height:32, display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:T.fs.xs, fontWeight:T.fw.bold, borderBottom:`1px solid ${T.border}`,
                            color: emp.isSupport ? T.orange : br.color }}>
                            {emp.id}{emp.isSupport ? '↓' : ''}
                          </div>
                          {/* 시간 슬롯 */}
                          <div style={{ position:'relative' }}>
                            {hours.map(h => (
                              <div key={h} style={{ height:40, borderTop:`1px solid ${T.gray200}` }} />
                            ))}
                            {/* 예약 블록 */}
                            {empRes.map(r => {
                              const [rh, rm] = r.time.split(':').map(Number)
                              const top = (rh - 10) * 40 + (rm/60)*40
                              const height = ((r.dur||60)/60)*40
                              return (
                                <div key={r.id} style={{
                                  position:'absolute', top, left:2, right:2, height: Math.max(height,20),
                                  background: br.color+'33', border:`1px solid ${br.color}`,
                                  borderRadius:4, padding:'2px 3px', overflow:'hidden', fontSize:9
                                }}>
                                  <div style={{ fontWeight:700, color:br.color }}>{r.time}</div>
                                  <div style={{ color:T.text }}>{r.cust_name}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
