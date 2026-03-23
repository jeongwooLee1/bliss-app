import { useState, useMemo, useCallback } from 'react'
import { useSchHistory } from '../../lib/useData'
import { T } from '../../lib/constants'

const BRANCHES = [
  {id:'gangnam',name:'강남',color:'#c8793a'},{id:'wangsimni',name:'왕십리',color:'#d4923a'},
  {id:'hongdae',name:'홍대',color:'#3a9e8e'},{id:'magok',name:'마곡',color:'#2e8a7a'},
  {id:'yongsan',name:'용산',color:'#8b6fa3'},{id:'jamsil',name:'잠실',color:'#3a7aaf'},
  {id:'wirye',name:'위례',color:'#5a9abf'},{id:'cheonho',name:'천호',color:'#a07040'},
]
const STATUS = {WORK:'근무',OFF:'휴무',MUST_OFF:'휴무(꼭)',SUPPORT:'지원'}
const S_COLOR = {
  '근무':{bg:T.successLt,text:T.successDk,border:T.success},
  '휴무':{bg:T.purpleLt,text:T.purple,border:'#c4a4e8',bold:true},
  '휴무(꼭)':{bg:T.primaryLt,text:T.primaryDk,border:T.primary,bold:true},
  '지원':{bg:T.orangeLt,text:T.orange,border:'#ffb74d'},
}

function getDays(year, month) {
  const days=[]; const d=new Date(year,month,1)
  while(d.getMonth()===month){days.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1)}
  return days
}
function pad(n){return String(n).padStart(2,'0')}

export default function SchedulePage({ employees }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const { schHistory, setSchHistory, save } = useSchHistory()
  const [saving, setSaving] = useState(false)

  const days = useMemo(()=>getDays(year,month),[year,month])
  const curKey = `${year}-${pad(month+1)}`

  const sch = useMemo(()=>{
    const base={}
    employees.forEach(e=>{base[e.id]={}})
    const cur = schHistory[curKey]||{}
    employees.forEach(e=>{
      if(cur[e.id]) Object.assign(base[e.id], cur[e.id])
    })
    return base
  },[schHistory,curKey,employees])

  const cycleStatus = useCallback((empId, ds) => {
    const cur = sch[empId]?.[ds]||STATUS.WORK
    const cycle=[STATUS.WORK,STATUS.OFF,STATUS.MUST_OFF]
    const next=cycle[(cycle.indexOf(cur)+1)%cycle.length]
    setSchHistory(prev=>{
      const cur2=prev[curKey]||{}
      const empDays={...(cur2[empId]||{}),[ds]:next}
      const next2={...prev,[curKey]:{...cur2,[empId]:empDays}}
      save(next2)
      return next2
    })
  },[sch,curKey,setSchHistory,save])

  const nonMale = employees.filter(e=>!e.isMale)
  const grouped = BRANCHES.map(br=>({...br, emps:nonMale.filter(e=>e.branch===br.id)})).filter(b=>b.emps.length>0)

  const prevMonth=()=>{const d=new Date(year,month-1);setYear(d.getFullYear());setMonth(d.getMonth())}
  const nextMonth=()=>{const d=new Date(year,month+1);setYear(d.getFullYear());setMonth(d.getMonth())}

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      {/* 헤더 */}
      <div style={{flexShrink:0,background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={prevMonth} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:16}}>‹</button>
          <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>{year}년 {month+1}월</span>
          <button onClick={nextMonth} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:16}}>›</button>
        </div>
        <div style={{fontSize:T.fs.xs,color:T.textMuted}}>셀 터치로 상태 변경</div>
      </div>

      {/* 근무표 */}
      <div style={{flex:1,overflow:'auto'}}>
        <table style={{borderCollapse:'collapse',fontSize:10,minWidth:'max-content'}}>
          <thead>
            <tr style={{position:'sticky',top:0,zIndex:20}}>
              <th style={{position:'sticky',left:0,zIndex:21,width:120,background:T.gray100,padding:'6px 8px',borderBottom:`2px solid ${T.border}`,textAlign:'left',fontSize:T.fs.xs,color:T.textSub}}>직원</th>
              {days.map(ds=>{
                const d=new Date(ds+'T00:00:00'),dow=d.getDay()
                return (
                  <th key={ds} style={{minWidth:32,maxWidth:36,padding:'4px 2px',textAlign:'center',borderBottom:`2px solid ${T.border}`,background:T.gray100,color:dow===0?T.danger:dow===6?T.primary:T.textSub,borderLeft:`1px solid ${T.gray200}`}}>
                    <div style={{fontSize:10}}>{d.getDate()}</div>
                    <div style={{fontSize:8,color:T.textMuted}}>{'일월화수목금토'[dow]}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {grouped.map(br=>(
              <>
                <tr key={`h-${br.id}`}>
                  <td colSpan={days.length+1} style={{padding:'3px 8px',background:br.color+'18',borderLeft:`3px solid ${br.color}`,fontSize:T.fs.xs,fontWeight:T.fw.bold,color:br.color,position:'sticky',left:0}}>
                    {br.name}
                  </td>
                </tr>
                {br.emps.map(emp=>{
                  const curMs=`${year}-${pad(month+1)}`
                  const workDays=days.filter(ds=>!['휴무','휴무(꼭)'].includes(sch[emp.id]?.[ds]||STATUS.WORK)).length
                  const offDays=days.filter(ds=>['휴무','휴무(꼭)'].includes(sch[emp.id]?.[ds]||STATUS.WORK)).length
                  return (
                    <tr key={emp.id}>
                      <td style={{position:'sticky',left:0,zIndex:5,background:T.bgCard,padding:'3px 8px',borderLeft:`3px solid ${br.color}`,borderBottom:`1px solid ${T.border}`,minWidth:120}}>
                        <div style={{fontSize:11,fontWeight:emp.isOwner?T.fw.bolder:T.fw.medium,color:T.text}}>{emp.name||emp.id}</div>
                        <div style={{fontSize:9,color:T.textMuted,display:'flex',gap:4}}>
                          <span>{br.name}</span>
                          {(workDays>0||offDays>0)&&<span style={{color:workDays<11||workDays>15?T.danger:T.textSub,fontWeight:700}}>근{workDays}·휴{offDays}</span>}
                        </div>
                      </td>
                      {days.map(ds=>{
                        const status=sch[emp.id]?.[ds]||STATUS.WORK
                        const isSupport=status.startsWith('지원(')
                        const sc=isSupport?S_COLOR['지원']:(S_COLOR[status]||S_COLOR['근무'])
                        const dow=new Date(ds+'T00:00:00').getDay()
                        return (
                          <td key={ds} onClick={()=>cycleStatus(emp.id,ds)}
                            style={{padding:'2px 1px',textAlign:'center',borderBottom:`1px solid ${T.border}`,borderLeft:`1px solid ${T.gray200}`,cursor:'pointer',background:dow===0?'#fff8f8':dow===6?'#f8f8ff':undefined}}>
                            <div style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,borderRadius:3,padding:'2px 0',fontSize:9,fontWeight:sc.bold?700:500,minWidth:28,textAlign:'center'}}>
                              {status===STATUS.WORK?'근':status===STATUS.OFF?'휴':status===STATUS.MUST_OFF?'꼭':isSupport?status.replace('지원(','').replace(')','')+'↗':'?'}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
