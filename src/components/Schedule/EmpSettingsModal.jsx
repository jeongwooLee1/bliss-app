import { useState, useRef } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, BRANCH_LABEL, STATUS, getDow0Mon, fmtDs } from './scheduleConstants'

const RANKS = ['원장','마스터','시니어','인턴'];
const RANK_COLOR = {원장:'#8B4513',마스터:'#2a6099',시니어:'#4CAF50',인턴:'#999'};

export default function EmpSettingsModal({ allEmployees, empSettings, customEmployees, deletedEmpIds, maleRotation, onSetEmpSetting, onAddEmp, onDeleteEmp, onSaveMaleRotation, onUpdateEmp, onClose,
  ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSaveEmpReqs, onSetOwnerRepeat }) {
  const [showAddEmp, setShowAddEmp] = useState(false)
  const todayStr = new Date().toISOString().slice(0, 10)
  const [newEmp, setNewEmp] = useState({ name:'', branch:'gangnam', rank:'시니어', weeklyOff:2, mustStay:false, isFreelancer:false, startDate:todayStr })
  const dragRef = useRef({ active:false, empId:null, mode:null })

  const reqCtx = { ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSaveEmpReqs, onSetOwnerRepeat, dragRef, maleRotation, onSaveMaleRotation }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,960px)', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}
      onMouseUp={()=>{dragRef.current.active=false}} onMouseLeave={()=>{dragRef.current.active=false}}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>👤 직원별 근무 설정</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={() => setShowAddEmp(true)}
            style={{ fontSize:12, padding:'5px 12px', borderRadius:7, border:'1.5px solid #c0a07a', background:'#fdf8f0', color:'#7a4a18', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
            ＋ 직원 추가
          </button>
          <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
      </div>

      {BRANCHES_SCH.map(branch => {
        const emps = allEmployees.filter(e => e.branch === branch.id)
        if (!emps.length) return null
        return (
          <div key={branch.id} style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:branch.color, marginBottom:8, borderBottom:`1px solid ${branch.color}33`, paddingBottom:4 }}>{branch.name}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
              {emps.map(emp => <EmpCard key={emp.id} emp={emp} branch={branch} empSettings={empSettings} onSetEmpSetting={onSetEmpSetting} onDeleteEmp={onDeleteEmp} onUpdateEmp={onUpdateEmp} reqCtx={reqCtx}/>)}
            </div>
          </div>
        )
      })}

    </div>

    {/* 직원 추가 모달 */}
    {showAddEmp && <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:300 }} onClick={() => setShowAddEmp(false)}/>
      <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:301, width:'min(96vw,400px)', boxShadow:'0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>＋ 직원 추가</div>
          <button onClick={() => setShowAddEmp(false)} style={{ fontSize:16, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>이름</div>
          <input value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name:e.target.value }))} placeholder="이름 입력"
            style={{ width:'100%', padding:'8px 10px', borderRadius:7, border:'1.5px solid #e4ddd0', fontSize:13, fontFamily:'inherit', outline:'none' }}/>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>지점</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {BRANCHES_SCH.map(b => (
              <button key={b.id} onClick={() => setNewEmp(p => ({ ...p, branch:b.id }))}
                style={{ padding:'5px 12px', borderRadius:7, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                  border:`1.5px solid ${newEmp.branch===b.id ? b.color : T.border}`, background:newEmp.branch===b.id ? b.color+'22' : T.bgCard,
                  color:newEmp.branch===b.id ? b.color : T.textMuted, fontWeight:newEmp.branch===b.id ? 700 : 400 }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>주 휴무일수</div>
          <div style={{ display:'flex', gap:8 }}>
            {[1,2].map(n => (
              <button key={n} onClick={() => setNewEmp(p => ({ ...p, weeklyOff:n }))}
                style={{ flex:1, padding:'7px 0', borderRadius:7, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                  border:`1.5px solid ${newEmp.weeklyOff===n ? T.primary : T.border}`, background:newEmp.weeklyOff===n ? '#fdf3e0' : T.bgCard,
                  color:newEmp.weeklyOff===n ? '#7a4a18' : T.textMuted, fontWeight:newEmp.weeklyOff===n ? 700 : 400 }}>
                {n}일 휴무
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>근무 시작일</div>
          <input type="date" value={newEmp.startDate || ''} onChange={e => setNewEmp(p => ({ ...p, startDate:e.target.value }))}
            style={{ width:'100%', padding:'8px 10px', borderRadius:7, border:'1.5px solid #e4ddd0', fontSize:13, fontFamily:'inherit', outline:'none' }}/>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>직급</div>
          <div style={{ display:'flex', gap:6 }}>
            {RANKS.map(r=>(
              <button key={r} onClick={()=>setNewEmp(p=>({...p,rank:r,isOwner:r==='원장'}))}
                style={{ flex:1, padding:'6px 0', borderRadius:7, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                  border:`1.5px solid ${newEmp.rank===r?RANK_COLOR[r]:T.border}`,
                  background:newEmp.rank===r?RANK_COLOR[r]+'22':T.bgCard,
                  color:newEmp.rank===r?RANK_COLOR[r]:T.textMuted, fontWeight:newEmp.rank===r?700:400 }}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:20, display:'flex', gap:10, flexWrap:'wrap' }}>
          {[{ key:'mustStay', label:'타지점이동불가' }, { key:'isFreelancer', label:'프리랜서' }].map(({ key, label }) => (
            <button key={key} onClick={() => setNewEmp(p => ({ ...p, [key]:!p[key] }))}
              style={{ padding:'5px 12px', borderRadius:7, fontSize:11, fontFamily:'inherit', cursor:'pointer',
                border:`1.5px solid ${newEmp[key] ? T.textSub : T.border}`, background:newEmp[key] ? '#f5e8d0' : T.bgCard,
                color:newEmp[key] ? '#7a4a18' : T.textMuted, fontWeight:newEmp[key] ? 700 : 400 }}>
              {newEmp[key] ? '✓ ' : ''}{label}
            </button>
          ))}
        </div>
        <button disabled={!newEmp.name.trim()} onClick={() => {
          const id = newEmp.name.trim()
          if (!id) return
          if (allEmployees.some(e => e.id === id)) { alert('이미 같은 이름의 직원이 있습니다.'); return }
          onAddEmp({ ...newEmp, id, name:id })
          setNewEmp({ name:'', branch:'gangnam', rank:'시니어', weeklyOff:2, mustStay:false, isFreelancer:false, startDate:todayStr })
          setShowAddEmp(false)
        }} style={{ width:'100%', padding:'10px 0', borderRadius:8, fontSize:13, fontFamily:'inherit', cursor:'pointer', fontWeight:700,
          background:newEmp.name.trim() ? T.primary : T.border, color:newEmp.name.trim() ? '#fff' : T.textMuted, border:'none' }}>
          추가하기
        </button>
      </div>
    </>}
  </>
}

function EmpCard({ emp, branch, empSettings, onSetEmpSetting, onDeleteEmp, onUpdateEmp, reqCtx }) {
  const cfg = empSettings[emp.id] || { weeklyWork:5, altPattern:false }
  const excluded = !!cfg.excludeFromSchedule
  const isOwner = emp.isOwner || emp.rank === '원장'
  const isFL = emp.isFreelancer || cfg.isFreelancer
  const { maleRotation = {}, onSaveMaleRotation } = reqCtx || {}
  const fixedOffEnabled = !!cfg.fixedOffEnabled
  const showCalendar = !excluded && fixedOffEnabled && reqCtx?.days?.length > 0
  const rot = maleRotation[emp.id] || null
  const isRotation = !!rot && Array.isArray(rot.branches)
  const allBranchIds = BRANCHES_SCH.map(b => b.id)
  const toggleRotation = () => {
    if (!onSaveMaleRotation) return
    if (isRotation) {
      if (!confirm(`${emp.name} 로테이션 설정을 해제할까요?`)) return
      const next = { ...maleRotation }
      delete next[emp.id]
      onSaveMaleRotation(next)
    } else {
      onSaveMaleRotation({ ...maleRotation, [emp.id]: { branches:[], startDate:'' } })
    }
  }

  return (
    <div style={{ border:`1.5px solid ${excluded ? T.gray400 : '#e4ddd0'}`, borderRadius:8, padding:'8px 12px', minWidth:240, background: excluded ? T.gray100 : T.bgCard, opacity:excluded ? 0.85 : 1 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:12, color:'#3a2010' }}>{emp.name}</div>
        <button onClick={() => onDeleteEmp(emp.id)} style={{ fontSize:10, padding:'1px 5px', borderRadius:4, border:'1px solid #f5b3b3', background:T.dangerLt, color:T.danger, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
      </div>
      {/* 근무 제외 + 로테이션 토글 */}
      <div style={{ display:'flex', gap:12, marginBottom:6, padding:'3px 0', flexWrap:'wrap' }}>
        <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color: excluded ? T.danger : T.textSub, cursor:'pointer' }}>
          <input type="checkbox" checked={excluded} onChange={e => onSetEmpSetting(emp.id, 'excludeFromSchedule', e.target.checked)} style={{ cursor:'pointer' }}/>
          <span style={{ fontWeight: excluded ? 700 : 500 }}>근무 제외</span>
          <span style={{ fontSize:9, color:T.textMuted }}>(채팅만)</span>
        </label>
        {!excluded && (
          <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color: isRotation ? '#2a5080' : T.textSub, cursor:'pointer' }}>
            <input type="checkbox" checked={isRotation} onChange={toggleRotation} style={{ cursor:'pointer' }}/>
            <span style={{ fontWeight: isRotation ? 700 : 500 }}>🔄 로테이션</span>
          </label>
        )}
        {!excluded && (
          <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color: fixedOffEnabled ? '#7a4a18' : T.textSub, cursor:'pointer' }}>
            <input type="checkbox" checked={fixedOffEnabled} onChange={e => onSetEmpSetting(emp.id, 'fixedOffEnabled', e.target.checked)} style={{ cursor:'pointer' }}/>
            <span style={{ fontWeight: fixedOffEnabled ? 700 : 500 }}>🔒 휴무 고정</span>
          </label>
        )}
      </div>
      {isRotation && !excluded && (
        <div style={{ marginBottom:8, padding:8, background:'#eef4fc', border:'1px solid #c4d4e8', borderRadius:6 }}>
          <div style={{ fontSize:10, color:'#2a5080', fontWeight:700, marginBottom:4 }}>주간 로테이션 지점</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginBottom:4 }}>
            {rot.branches.map((b, i) => (
              <span key={i} style={{ background:'#2a6099', color:'#fff', borderRadius:4, padding:'2px 6px', fontSize:10, fontWeight:600, display:'inline-flex', alignItems:'center', gap:3 }}>
                {i+1}.{BRANCH_LABEL[b] || b}
                <span style={{ cursor:'pointer', fontSize:8, lineHeight:1 }} onClick={() => onSaveMaleRotation({ ...maleRotation, [emp.id]: { ...rot, branches: rot.branches.filter((_, j) => j !== i) } })}>✕</span>
              </span>
            ))}
          </div>
          <select value="" onChange={e => {
            if (!e.target.value) return
            onSaveMaleRotation({ ...maleRotation, [emp.id]: { ...rot, branches: [...rot.branches, e.target.value] } })
          }} style={{ width:'100%', padding:'3px 4px', borderRadius:5, border:'1px solid '+T.border, fontSize:10, fontFamily:'inherit', marginBottom:4 }}>
            <option value="">지점 추가...</option>
            {allBranchIds.filter(b => !rot.branches.includes(b)).map(b => <option key={b} value={b}>{BRANCH_LABEL[b]}</option>)}
          </select>
          <div style={{ fontSize:9, color:'#666', marginBottom:2 }}>시작일 (월요일)</div>
          <input type="date" value={rot.startDate || ''} onChange={e => onSaveMaleRotation({ ...maleRotation, [emp.id]: { ...rot, startDate: e.target.value } })}
            style={{ width:'100%', padding:'3px 4px', borderRadius:5, border:'1px solid '+T.border, fontSize:10, fontFamily:'inherit' }}/>
        </div>
      )}
      {!excluded && <>
        <div style={{ display:'flex', gap:3, marginBottom:6 }}>
          {RANKS.map(r=>(
            <button key={r} onClick={()=>onUpdateEmp(emp.id, 'rank', r)}
              style={{ flex:1, padding:'3px 0', borderRadius:4, fontSize:9, fontWeight:(emp.rank||'시니어')===r?700:400, cursor:'pointer', fontFamily:'inherit',
                border:`1.5px solid ${(emp.rank||'시니어')===r?RANK_COLOR[r]:T.border}`,
                background:(emp.rank||'시니어')===r?RANK_COLOR[r]+'22':'#fff',
                color:(emp.rank||'시니어')===r?RANK_COLOR[r]:'#bbb' }}>
              {r}
            </button>
          ))}
        </div>
        {/* 성별 (남/여) */}
        <div style={{ display:'flex', gap:3, marginBottom:6 }}>
          {[
            { v:'F', label:'여', clr:'#E91E63' },
            { v:'M', label:'남', clr:'#1976D2' },
          ].map(({v,label,clr})=>{
            const cur = emp.gender || (emp.isMale ? 'M' : 'F')
            const on = cur === v
            return <button key={v}
              onClick={()=>{
                onUpdateEmp(emp.id, '__merge', { gender: v, isMale: v === 'M' })
              }}
              style={{ flex:1, padding:'3px 0', borderRadius:4, fontSize:10, fontWeight:on?700:400, cursor:'pointer', fontFamily:'inherit',
                border:`1.5px solid ${on?clr:T.border}`,
                background:on?clr+'22':'#fff',
                color:on?clr:'#bbb' }}>
              {label}
            </button>
          })}
        </div>
        <div style={{ fontSize:11, color:cfg.altPattern ? T.gray400 : T.textSub, marginBottom:4 }}>
          주 근무일수{cfg.altPattern && <span style={{ fontSize:9, color:'#bbb', marginLeft:4 }}>(격주패턴 우선)</span>}
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:8 }}>
          {[5,6].map(n => (
            <button key={n} onClick={() => { if (!cfg.altPattern) onSetEmpSetting(emp.id, 'weeklyWork', n) }}
              style={{ flex:1, padding:'4px 0', borderRadius:5, border:`1.5px solid ${cfg.altPattern ? '#eee' : cfg.weeklyWork===n ? branch.color : T.border}`,
                background:cfg.altPattern ? '#f5f5f5' : cfg.weeklyWork===n ? branch.color+'22' : '#fff',
                color:cfg.altPattern ? T.gray400 : cfg.weeklyWork===n ? branch.color : '#999',
                fontSize:11, fontWeight:(!cfg.altPattern && cfg.weeklyWork===n) ? 700 : 400,
                cursor:cfg.altPattern ? 'not-allowed' : 'pointer', fontFamily:'inherit' }}>
              {n}일<span style={{ fontSize:9, display:'block', color:cfg.altPattern ? T.border : cfg.weeklyWork===n ? branch.color : '#bbb' }}>휴무{7-n}일</span>
            </button>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, color:T.textSub }}>격주패턴</span>
          <button onClick={() => onSetEmpSetting(emp.id, 'altPattern', !cfg.altPattern)}
            style={{ padding:'3px 10px', borderRadius:5, border:`1.5px solid ${cfg.altPattern ? branch.color : T.border}`, background:cfg.altPattern ? branch.color+'22' : '#fff', color:cfg.altPattern ? branch.color : '#bbb', fontSize:10, fontWeight:cfg.altPattern ? 700 : 400, cursor:'pointer', fontFamily:'inherit' }}>
            {cfg.altPattern ? 'ON' : 'OFF'}
          </button>
        </div>
        {cfg.altPattern && (
          <div style={{ marginTop:4 }}>
            <div style={{ fontSize:9, color:T.textMuted, marginBottom:4 }}>홀수주 {Math.max(1, 7-cfg.weeklyWork-1)}일 / 짝수주 {7-cfg.weeklyWork}일</div>
            <div style={{ fontSize:9, color:T.textSub, marginBottom:3 }}>휴무 선호 요일</div>
            <div style={{ display:'flex', gap:2 }}>
              {['월','화','수','목','금','토','일'].map((dn, di) => {
                const prefDows = cfg.prefDows || []
                const on = prefDows.includes(di)
                return <button key={di} onClick={() => {
                  const next = on ? prefDows.filter(d => d !== di) : [...prefDows, di]
                  onSetEmpSetting(emp.id, 'prefDows', next)
                }} style={{ flex:1, padding:'3px 0', fontSize:9, fontWeight:700, borderRadius:4,
                  border:`1.5px solid ${on ? branch.color : T.border}`, background:on ? branch.color+'22' : '#fff',
                  color:on ? branch.color : '#bbb', cursor:'pointer', fontFamily:'inherit' }}>
                  {dn}
                </button>
              })}
            </div>
            {(cfg.prefDows || []).length === 0 && <div style={{ fontSize:8, color:'#bbb', marginTop:2 }}>미선택 시 자동 배정</div>}
          </div>
        )}
        {/* 근무 시작일 */}
        <div style={{ marginTop:8, borderTop:'1px solid #f0ebe2', paddingTop:6 }}>
          <div style={{ fontSize:10, color:T.textSub, marginBottom:3 }}>근무 시작일</div>
          <input type="date" value={cfg.startDate || ''} onChange={e => onSetEmpSetting(emp.id, 'startDate', e.target.value)}
            style={{ width:'100%', padding:'3px 4px', borderRadius:5, border:'1px solid '+T.border, fontSize:10, fontFamily:'inherit' }}/>
          {cfg.startDate && <div style={{ fontSize:8, color:T.textMuted, marginTop:2 }}>이 날짜 이전은 자동배치/편집 불가</div>}
        </div>
        {/* 휴무 설정 (원장·프리랜서) */}
        {showCalendar && <EmbeddedCalendar emp={emp} isOwner={isOwner} isFL={isFL} branchColor={branch.color} reqCtx={reqCtx}/>}
      </>}
    </div>
  )
}

// 카드 내 임베드되는 휴무 달력 (모든 직원용, 변경 시 auto-save)
function EmbeddedCalendar({ emp, isOwner, isFL, branchColor, reqCtx }) {
  const { ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSaveEmpReqs, onSetOwnerRepeat, dragRef } = reqCtx
  // 원장은 ownerReqs에, 나머지(프리랜서·일반직원)는 empReqs에 저장
  const useOwnerBucket = !!isOwner
  const reqs = useOwnerBucket ? (ownerReqs || {}) : (empReqs || {})
  const saveTimerRef = useRef(null)
  const scheduleSave = (next) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const fn = useOwnerBucket ? onSaveOwnerReqs : onSaveEmpReqs
    if (!fn) return
    saveTimerRef.current = setTimeout(() => fn(next), 350)
  }
  const setReq = (key, val) => {
    if (useOwnerBucket) onSetOwnerReqs(prev => { const next={...prev}; if(val) next[key]=val; else delete next[key]; scheduleSave(next); return next })
    else onSetEmpReqs(prev => { const next={...prev}; if(val) next[key]=val; else delete next[key]; scheduleSave(next); return next })
  }
  const roleLabel = '🔒 휴무 고정'
  const bc = branchColor || T.textSub
  const isDowFull = (dow) => { const md=days.filter(d=>!d.isNext&&d.dow===dow); return md.length>0&&md.every(d=>!!reqs[emp.id+'__'+d.ds]) }
  const rep = (ownerRepeat||{})[emp.id] || {enabled:false,dows:[]}
  const toggleDow = (dow) => {
    const full=isDowFull(dow)
    days.filter(d=>!d.isNext&&d.dow===dow).forEach(d=>setReq(emp.id+'__'+d.ds, full?null:STATUS.MUST_OFF))
    if(rep.enabled) onSetOwnerRepeat({...ownerRepeat,[emp.id]:{...rep,dows:full?rep.dows.filter(d=>d!==dow):[...new Set([...rep.dows,dow])]}})
  }
  const firstDowSun = (getDow0Mon(year,month,1)+1)%7
  const cells=[]; for(let i=0;i<firstDowSun;i++) cells.push(null); days.forEach(d=>cells.push(d)); while(cells.length%7) cells.push(null)

  return (
    <div style={{ marginTop:10, borderTop:'1px dashed '+T.border, paddingTop:8 }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
        <div style={{fontSize:10,fontWeight:700,color:bc}}>{roleLabel}</div>
        <button onClick={()=>onSetOwnerRepeat({...ownerRepeat,[emp.id]:{enabled:!rep.enabled,dows:Array.from({length:7},(_,i)=>i).filter(isDowFull)}})}
          style={{padding:'2px 8px',fontSize:10,fontWeight:700,borderRadius:5,border:`1.5px solid ${rep.enabled?'#e0a030':T.border}`,background:rep.enabled?'#fff8e8':T.bgCard,color:rep.enabled?'#c07000':T.textMuted,cursor:'pointer',fontFamily:'inherit'}}>
          {rep.enabled?'🔁 반복중':'🔁 반복'}
        </button>
      </div>
      <div style={{display:'flex',gap:3,marginBottom:6}}>
        {['일','월','화','수','목','금','토'].map((dn,di)=>{
          const dow=(di+6)%7; const full=isDowFull(dow)
          return <button key={di} onClick={()=>toggleDow(dow)}
            style={{flex:1,padding:'3px 0',fontSize:10,fontWeight:700,borderRadius:4,border:`1.5px solid ${full?bc:T.border}`,background:full?bc:T.bgCard,color:full?'#fff':T.textMuted,cursor:'pointer',fontFamily:'inherit'}}>{dn}</button>
        })}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
        {cells.map((day,ci)=>{
          if(!day) return <div key={'e'+ci} style={{height:22}}/>
          const key=emp.id+'__'+day.ds
          const on=!!reqs[key]||(rep.enabled&&rep.dows.includes(day.dow))
          const isSun=day.dow===6,isSat=day.dow===5
          return <div key={day.ds}
            onMouseDown={e=>{e.preventDefault();const dr=dragRef.current;dr.active=true;dr.empId=emp.id;dr.mode=reqs[key]?'off':'on';setReq(key,reqs[key]?null:STATUS.MUST_OFF)}}
            onMouseEnter={()=>{const dr=dragRef.current;if(!dr.active||dr.empId!==emp.id)return;if(dr.mode==='on'&&!reqs[key])setReq(key,STATUS.MUST_OFF);if(dr.mode==='off'&&reqs[key])setReq(key,null)}}
            style={{height:22,borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:9,fontWeight:700,
              background:on?bc:day.isNext?'#ede8f5':'#f5f0ea',
              color:on?'#fff':day.isNext?T.purple:isSun?T.danger:isSat?T.primary:T.textSub,
              border:`1px solid ${on?bc:day.isNext?'#c4b3e0':T.border}`,userSelect:'none',opacity:day.isNext?0.85:1}}>
            {day.d}
          </div>
        })}
      </div>
      <div style={{marginTop:4,fontSize:9,color:'#b0a090'}}>지정 휴무: {Object.keys(reqs).filter(k=>k.startsWith(emp.id+'__')&&(k.includes(curMonthStr)||k.includes(nextMonthStr))).length}일</div>
    </div>
  )
}
