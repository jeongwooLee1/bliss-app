import { useRef } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, STATUS, getDow0Mon, fmtDs } from './scheduleConstants'

export default function OwnerSettingsModal({ allEmployees, empSettings, ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSetOwnerRepeat, onClose }) {
  const ownerDragRef = useRef({ active:false, empId:null, mode:null })

  const ownersAndFreelancers = allEmployees.filter(e => e.isOwner || e.isFreelancer || empSettings[e.id]?.isFreelancer)

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div onMouseUp={() => { ownerDragRef.current.active = false }} onMouseLeave={() => { ownerDragRef.current.active = false }}
      style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,900px)', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>👑 원장 / 프리랜서 지정 휴무 설정</div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <button onClick={() => onSaveOwnerReqs(ownerReqs)} style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #c0a07a', background:'#fdf8f0', color:'#7a4a18', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>💾 저장</button>
          <button onClick={() => { if (window.confirm('이번달 원장 휴무 설정을 초기화할까요?')) { onSetOwnerReqs(prev => { const next = { ...prev }; Object.keys(next).forEach(k => { if (k.includes('__'+curMonthStr) || k.includes('__'+nextMonthStr)) delete next[k] }); return next }) }}}
            style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #ddd', background:T.bgCard, color:T.textMuted, cursor:'pointer', fontFamily:'inherit' }}>🗑 초기화</button>
          <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
      </div>
      <div style={{ fontSize:12, color:T.textMuted, marginBottom:16 }}>자동배치 전 원장님 고정 휴무일을 먼저 설정하세요. 요일 버튼으로 매주 반복 지정 또는 날짜 드래그로 개별 선택.</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14 }}>
        {ownersAndFreelancers.map(emp => {
          const isFL = emp.isFreelancer || empSettings[emp.id]?.isFreelancer
          const reqs = isFL ? empReqs : ownerReqs
          const setReq = (key, val) => {
            if (isFL) {
              onSetEmpReqs(prev => { const next = { ...prev }; if (val) next[key] = val; else delete next[key]; return next })
            } else {
              onSetOwnerReqs(prev => { const next = { ...prev }; if (val) next[key] = val; else delete next[key]; return next })
            }
          }
          const bc = isFL ? '#7a7a7a' : (BRANCHES_SCH.find(b => b.id === emp.branch)?.color || T.textSub)
          const myReqs = Object.entries(reqs).filter(([k]) => k.startsWith(emp.id+'__'))

          const isDowFull = (dow) => {
            const matchDays = days.filter(day => !day.isNext && day.dow === dow)
            return matchDays.length > 0 && matchDays.every(day => !!reqs[emp.id+'__'+day.ds])
          }
          const toggleDow = (dow) => {
            const full = isDowFull(dow)
            days.filter(day => !day.isNext && day.dow === dow).forEach(day => {
              setReq(emp.id+'__'+day.ds, full ? null : STATUS.MUST_OFF)
            })
          }

          const rep = ownerRepeat[emp.id] || { enabled:false, dows:[] }
          const toggleRepeat = () => {
            const activeDows = []
            for (let dow = 0; dow < 7; dow++) { if (isDowFull(dow)) activeDows.push(dow) }
            onSetOwnerRepeat({ ...ownerRepeat, [emp.id]:{ enabled:!rep.enabled, dows:activeDows } })
          }
          const toggleDowWithRepeat = (dow) => {
            const wasFullBefore = isDowFull(dow)
            toggleDow(dow)
            if (rep.enabled) {
              const newDows = wasFullBefore ? rep.dows.filter(d => d !== dow) : [...new Set([...rep.dows, dow])]
              onSetOwnerRepeat({ ...ownerRepeat, [emp.id]:{ ...rep, dows:newDows } })
            }
          }

          // Calendar grid
          const firstDowSun = (getDow0Mon(year, month, 1)+1) % 7
          const cells = []
          for (let i = 0; i < firstDowSun; i++) cells.push(null)
          days.forEach(d => cells.push(d))
          while (cells.length % 7 !== 0) cells.push(null)

          return (
            <div key={emp.id} style={{ border:`1.5px solid ${bc}55`, borderRadius:10, padding:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontWeight:700, fontSize:13, color:bc }}>{emp.name}</div>
                <button onClick={toggleRepeat} title="반복 ON: 매달 같은 요일 자동 휴무 지정"
                  style={{ padding:'3px 10px', fontSize:11, fontWeight:700, borderRadius:5, border:`1.5px solid ${rep.enabled ? '#e0a030' : T.border}`, background:rep.enabled ? '#fff8e8' : T.bgCard, color:rep.enabled ? '#c07000' : T.textMuted, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                  {rep.enabled ? '🔁 반복중' : '🔁 반복'}
                </button>
              </div>
              <div style={{ display:'flex', gap:4, marginBottom:10, alignItems:'center' }}>
                {['일','월','화','수','목','금','토'].map((dn, di) => {
                  const dow = (di+6) % 7
                  const full = isDowFull(dow)
                  return <button key={di} onClick={() => toggleDowWithRepeat(dow)}
                    style={{ flex:1, padding:'4px 0', fontSize:11, fontWeight:700, borderRadius:5, border:`1.5px solid ${full ? bc : T.border}`, background:full ? bc : T.bgCard, color:full ? '#fff' : T.textMuted, cursor:'pointer', fontFamily:'inherit' }}>
                    {dn}
                  </button>
                })}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3 }}>
                {cells.map((day, ci) => {
                  if (!day) return <div key={'e'+ci} style={{ height:30 }}/>
                  const key = emp.id+'__'+day.ds
                  const _rep = ownerRepeat[emp.id] || { enabled:false, dows:[] }
                  const on = !!reqs[key] || (!isFL && _rep.enabled && _rep.dows.includes(day.dow))
                  const isSun = day.dow === 6, isSat = day.dow === 5
                  return <div key={day.ds}
                    onMouseDown={e => { e.preventDefault(); const dr = ownerDragRef.current; dr.active = true; dr.empId = emp.id; dr.mode = reqs[key] ? 'off' : 'on'; setReq(key, reqs[key] ? null : STATUS.MUST_OFF) }}
                    onMouseEnter={() => { const dr = ownerDragRef.current; if (!dr.active || dr.empId !== emp.id) return; if (dr.mode === 'on' && !reqs[key]) setReq(key, STATUS.MUST_OFF); if (dr.mode === 'off' && reqs[key]) setReq(key, null) }}
                    style={{ height:30, borderRadius:5, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:11, fontWeight:700,
                      background:on ? bc : day.isNext ? '#ede8f5' : '#f5f0ea',
                      color:on ? '#fff' : day.isNext ? T.purple : isSun ? T.danger : isSat ? T.primary : T.textSub,
                      border:`1.5px solid ${on ? bc : day.isNext ? '#c4b3e0' : T.border}`,
                      userSelect:'none', opacity:day.isNext ? 0.85 : 1 }}>
                    <div style={{ fontSize:11, lineHeight:1 }}>{day.d}</div>
                    {day.isNext && <div style={{ fontSize:7, lineHeight:1, marginTop:1 }}>{(month+2 > 12 ? 1 : month+2)}월</div>}
                  </div>
                })}
              </div>
              <div style={{ marginTop:8, fontSize:11, color:'#b0a090' }}>{isFL ? '📌 프리랜서' : '👑 원장'} 지정: {myReqs.filter(([k]) => k.includes('__'+curMonthStr) || k.includes('__'+nextMonthStr)).length}일</div>
            </div>
          )
        })}
      </div>
    </div>
  </>
}
