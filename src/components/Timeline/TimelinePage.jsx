import { useState, useMemo, useRef, useCallback } from 'react'
import { T, SCH_BRANCH_MAP } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import ReservationModal from './ReservationModal'

function todayStr() { return new Date().toISOString().slice(0,10) }
function pad(n) { return String(n).padStart(2,'0') }
const DOW = ['일','월','화','수','목','금','토']
const HOURS = Array.from({length:12}, (_,i) => i+10) // 10~21

function timeToY(time) {
  const [h,m] = time.split(':').map(Number)
  return (h - 10) * 60 + m
}
function yToTime(y) {
  const totalMin = Math.max(0, Math.min(660, Math.round(y/1) ))
  const h = Math.floor(totalMin/60) + 10
  const m = Math.floor((totalMin%60)/15)*15
  return `${pad(h)}:${pad(m)}`
}

export default function TimelinePage({ data, employees, schHistory, currentUser, isMaster, setData }) {
  const [selDate, setSelDate] = useState(todayStr())
  const [modal, setModal] = useState(null) // {res, branch, staff}
  const [selBranch, setSelBranch] = useState(null)

  const branches = data?.branches || []
  const reservations = data?.reservations || []

  // 지원 근무 포함 오늘 근무 직원 - 지점별
  const workingByBranch = useMemo(() => {
    const map = {}
    branches.forEach(br => { map[br.id] = [] })
    employees.filter(e => !e.isMale).forEach(emp => {
      const status = schHistory[emp.id]?.[selDate]
      if (status === '휴무' || status === '휴무(꼭)') return
      if (status?.startsWith('지원(')) {
        const brName = status.replace('지원(','').replace(')','')
        const br = branches.find(b => (b.short||b.name).includes(brName) || brName.includes(b.short||''))
        if (br) { map[br.id] = [...(map[br.id]||[]), {...emp, isSupport:true}]; return }
      }
      const brId = SCH_BRANCH_MAP[emp.branch]
      if (brId && map[brId]) map[brId] = [...map[brId], emp]
    })
    return map
  }, [employees, schHistory, selDate, branches])

  const userBranchIds = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const visibleBranches = branches.filter(b => userBranchIds.includes(b.id))
  const displayBranches = selBranch ? visibleBranches.filter(b=>b.id===selBranch) : visibleBranches

  const dateObj = new Date(selDate+'T00:00:00')
  const changeDate = (d) => {
    const nd = new Date(selDate+'T00:00:00'); nd.setDate(nd.getDate()+d)
    setSelDate(nd.toISOString().slice(0,10))
  }

  const handleCellClick = (br, staff, yPx) => {
    const time = yToTime(yPx)
    setModal({ res: null, branch: br, staffId: staff?.id || null, date: selDate, time })
  }

  const handleResClick = (e, res, br) => {
    e.stopPropagation()
    setModal({ res, branch: br, staffId: res.staff_id, date: selDate, time: res.time })
  }

  const handleSave = async (saved) => {
    if (saved.id) {
      setData(p => ({...p, reservations: p.reservations.map(r => r.id===saved.id ? saved : r)}))
    } else {
      setData(p => ({...p, reservations: [...(p.reservations||[]), saved]}))
    }
    setModal(null)
  }

  const handleDelete = async (id) => {
    setData(p => ({...p, reservations: p.reservations.filter(r=>r.id!==id)}))
    setModal(null)
  }

  const PX_PER_MIN = 1

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100dvh', overflow:'hidden'}}>
      {/* 날짜 헤더 */}
      <div style={{flexShrink:0, background:T.bgCard, borderBottom:`1px solid ${T.border}`, zIndex:20}}>
        <div style={{display:'flex', alignItems:'center', gap:6, padding:'10px 12px'}}>
          <button onClick={()=>changeDate(-1)} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:16}}>‹</button>
          <div style={{flex:1,textAlign:'center',fontSize:T.fs.md,fontWeight:T.fw.bolder}}>
            {dateObj.getMonth()+1}.{pad(dateObj.getDate())} ({DOW[dateObj.getDay()]})
          </div>
          <button onClick={()=>changeDate(1)} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:16}}>›</button>
          <button onClick={()=>setSelDate(todayStr())} style={{fontSize:T.fs.xs,padding:'4px 8px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,background:'none',cursor:'pointer',color:T.textSub}}>오늘</button>
        </div>
        {/* 지점 탭 */}
        {visibleBranches.length > 1 && (
          <div style={{display:'flex',gap:4,padding:'0 12px 8px',overflowX:'auto'}}>
            <button onClick={()=>setSelBranch(null)}
              style={{flexShrink:0,padding:'4px 10px',borderRadius:T.radius.full,border:`1px solid ${selBranch===null?T.primary:T.border}`,background:selBranch===null?T.primaryLt:'none',fontSize:T.fs.xs,fontWeight:selBranch===null?T.fw.bold:T.fw.normal,color:selBranch===null?T.primary:T.textSub,cursor:'pointer'}}>
              전체
            </button>
            {visibleBranches.map(br=>(
              <button key={br.id} onClick={()=>setSelBranch(br.id)}
                style={{flexShrink:0,padding:'4px 10px',borderRadius:T.radius.full,border:`1px solid ${selBranch===br.id?br.color:T.border}`,background:selBranch===br.id?br.color+'22':'none',fontSize:T.fs.xs,fontWeight:selBranch===br.id?T.fw.bold:T.fw.normal,color:selBranch===br.id?br.color:T.textSub,cursor:'pointer'}}>
                {br.short||br.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 타임라인 본체 */}
      <div style={{flex:1, overflowY:'auto', overflowX:'auto'}}>
        {displayBranches.map(br => {
          const staff = workingByBranch[br.id] || []
          const brRes = reservations.filter(r =>
            r.bid===br.id && r.date===selDate &&
            r.status!=='naver_cancelled' && r.status!=='naver_changed'
          )
          const cols = staff.length > 0 ? staff : [{id:'미배정', name:'미배정', isBlank:true}]

          return (
            <div key={br.id} style={{marginBottom:1}}>
              {/* 지점 헤더 */}
              <div style={{padding:'4px 12px',background:br.color+'18',borderLeft:`3px solid ${br.color}`,fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:br.color,position:'sticky',left:0}}>
                {br.short||br.name}
                {staff.length>0 && <span style={{fontWeight:T.fw.normal,marginLeft:6,color:T.textMuted}}>{staff.map(e=>e.id).join(' · ')}</span>}
              </div>

              <div style={{display:'flex', borderBottom:`2px solid ${T.border}`}}>
                {/* 시간축 */}
                <div style={{width:38,flexShrink:0,borderRight:`1px solid ${T.border}`,background:T.gray100}}>
                  <div style={{height:28}} />
                  {HOURS.map(h=>(
                    <div key={h} style={{height:60*PX_PER_MIN,borderTop:`1px solid ${T.gray200}`,padding:'2px 4px 0',fontSize:9,color:T.textMuted,position:'relative'}}>
                      {h}:00
                    </div>
                  ))}
                </div>

                {/* 직원 컬럼들 */}
                {cols.map(emp => {
                  const empRes = brRes.filter(r => emp.isBlank ? !r.staff_id : r.staff_id===emp.id)
                  const naverRes = brRes.filter(r => emp.isBlank ? false : false) // 네이버 미배정

                  return (
                    <div key={emp.id} style={{flex:1,minWidth:72,borderRight:`1px solid ${T.border}`,position:'relative'}}>
                      {/* 직원명 */}
                      <div style={{height:28,display:'flex',alignItems:'center',justifyContent:'center',
                        borderBottom:`1px solid ${T.border}`,fontSize:T.fs.xs,fontWeight:T.fw.bold,
                        color:emp.isBlank?T.textMuted:emp.isSupport?T.orange:br.color,
                        background:T.bgCard,position:'sticky',top:0,zIndex:5}}>
                        {emp.id}{emp.isSupport?'↗':''}
                      </div>

                      {/* 시간 격자 */}
                      <div style={{position:'relative',height:660*PX_PER_MIN}}
                        onClick={e => {
                          if(emp.isBlank) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          handleCellClick(br, emp, e.clientY - rect.top)
                        }}>
                        {HOURS.map(h=>(
                          <div key={h} style={{position:'absolute',top:(h-10)*60*PX_PER_MIN,left:0,right:0,height:60*PX_PER_MIN,borderTop:`1px solid ${T.gray200}`}}>
                            <div style={{position:'absolute',top:'50%',left:0,right:0,height:1,background:T.gray200,opacity:.5}}/>
                          </div>
                        ))}

                        {/* 예약 블록 */}
                        {empRes.map(r => {
                          const top = timeToY(r.time) * PX_PER_MIN
                          const height = Math.max(((r.dur||60)) * PX_PER_MIN, 20)
                          const isConfirmed = r.status==='confirmed'
                          const isCompleted = r.status==='completed'
                          return (
                            <div key={r.id}
                              onClick={e=>handleResClick(e,r,br)}
                              style={{
                                position:'absolute',top,left:2,right:2,height,
                                background: isCompleted ? T.gray200 : br.color+'30',
                                border:`1.5px solid ${isCompleted?T.gray400:br.color}`,
                                borderRadius:4,padding:'2px 4px',overflow:'hidden',
                                cursor:'pointer',zIndex:3,
                                boxShadow: isConfirmed?`0 1px 4px ${br.color}44`:undefined
                              }}>
                              <div style={{fontSize:9,fontWeight:700,color:isCompleted?T.textMuted:br.color,whiteSpace:'nowrap',overflow:'hidden'}}>{r.time}</div>
                              <div style={{fontSize:9,color:isCompleted?T.textMuted:T.text,whiteSpace:'nowrap',overflow:'hidden'}}>{r.cust_name}</div>
                              {r.dur>=30 && <div style={{fontSize:8,color:T.textMuted,whiteSpace:'nowrap',overflow:'hidden'}}>{r.dur}분</div>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* 예약 모달 */}
      {modal && (
        <ReservationModal
          data={modal}
          allData={data}
          employees={employees}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={()=>setModal(null)}
        />
      )}
    </div>
  )
}
