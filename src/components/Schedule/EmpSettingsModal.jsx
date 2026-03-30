import { useState } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, BRANCH_LABEL } from './scheduleConstants'

export default function EmpSettingsModal({ allEmployees, empSettings, customEmployees, deletedEmpIds, maleRotation, onSetEmpSetting, onAddEmp, onDeleteEmp, onSaveMaleRotation, onClose }) {
  const [showAddEmp, setShowAddEmp] = useState(false)
  const todayStr = new Date().toISOString().slice(0, 10)
  const [newEmp, setNewEmp] = useState({ name:'', branch:'gangnam', isOwner:false, weeklyOff:2, isMale:false, mustStay:false, isFreelancer:false, startDate:todayStr })

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,820px)', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>👤 직원별 근무 설정</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={() => setShowAddEmp(true)}
            style={{ fontSize:12, padding:'5px 12px', borderRadius:7, border:'1.5px solid #c0a07a', background:'#fdf8f0', color:'#7a4a18', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
            ＋ 직원 추가
          </button>
          <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
      </div>
      <div style={{ fontSize:11, color:T.textMuted, marginBottom:14 }}>주 근무일수와 격주 패턴을 설정합니다. 자동배치에 반영됩니다.</div>

      {BRANCHES_SCH.map(branch => {
        const emps = allEmployees.filter(e => e.branch === branch.id)
        if (!emps.length) return null
        return (
          <div key={branch.id} style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:branch.color, marginBottom:8, borderBottom:`1px solid ${branch.color}33`, paddingBottom:4 }}>{branch.name}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {emps.map(emp => <EmpCard key={emp.id} emp={emp} branch={branch} empSettings={empSettings} onSetEmpSetting={onSetEmpSetting} onDeleteEmp={onDeleteEmp} customEmployees={customEmployees} deletedEmpIds={deletedEmpIds}/>)}
            </div>
          </div>
        )
      })}

      {/* 남자직원 */}
      {(() => {
        const maleEmps = allEmployees.filter(e => e.isMale)
        if (!maleEmps.length) return null
        const maleColor = T.primary
        return (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:maleColor, marginBottom:8, borderBottom:`1px solid ${maleColor}33`, paddingBottom:4 }}>남자직원</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {maleEmps.map(emp => {
                const cfg = empSettings[emp.id] || { weeklyWork:5, altPattern:false }
                const rot = maleRotation[emp.id] || { branches:[], startDate:'' }
                const allBranches = BRANCHES_SCH.map(b => b.id)
                return (
                  <div key={emp.id} style={{ border:'1px solid #b8d0e8', borderRadius:8, padding:'8px 12px', minWidth:160, background:T.gray100 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                      <div style={{ fontWeight:700, fontSize:12, color:'#2a5080' }}>{emp.name}</div>
                      <button onClick={() => onDeleteEmp(emp.id)} style={{ fontSize:10, padding:'1px 5px', borderRadius:4, border:'1px solid #f5b3b3', background:T.dangerLt, color:T.danger, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
                    </div>
                    <div style={{ fontSize:11, color:T.textSub, marginBottom:4 }}>주 근무일수</div>
                    <div style={{ display:'flex', gap:4, marginBottom:4 }}>
                      {[5,6].map(n => (
                        <button key={n} onClick={() => onSetEmpSetting(emp.id, 'weeklyWork', n)}
                          style={{ flex:1, padding:'4px 0', borderRadius:5, border:`1.5px solid ${cfg.weeklyWork===n ? maleColor : T.border}`, background:cfg.weeklyWork===n ? maleColor+'22' : '#fff', color:cfg.weeklyWork===n ? maleColor : '#999', fontSize:11, fontWeight:cfg.weeklyWork===n ? 700 : 400, cursor:'pointer', fontFamily:'inherit' }}>
                          {n}일<span style={{ fontSize:9, display:'block', color:cfg.weeklyWork===n ? maleColor : '#bbb' }}>휴무{7-n}일</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:T.textSub, marginTop:6, marginBottom:4 }}>주간 로테이션 지점</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginBottom:4 }}>
                      {rot.branches.map((b, i) => (
                        <span key={i} style={{ background:'#2a6099', color:'#fff', borderRadius:4, padding:'2px 6px', fontSize:10, fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
                          {i+1}.{BRANCH_LABEL[b] || b}
                          <span style={{ cursor:'pointer', fontSize:8 }} onClick={() => onSaveMaleRotation({ ...maleRotation, [emp.id]:{ ...rot, branches:rot.branches.filter((_, j) => j !== i) } })}>✕</span>
                        </span>
                      ))}
                    </div>
                    <select value="" onChange={e => {
                      if (!e.target.value) return
                      onSaveMaleRotation({ ...maleRotation, [emp.id]:{ ...rot, branches:[...rot.branches, e.target.value] } })
                    }} style={{ width:'100%', padding:'3px 4px', borderRadius:5, border:'1px solid '+T.border, fontSize:10, fontFamily:'inherit', marginBottom:4 }}>
                      <option value="">지점 추가...</option>
                      {allBranches.filter(b => !rot.branches.includes(b)).map(b => <option key={b} value={b}>{BRANCH_LABEL[b]}</option>)}
                    </select>
                    <div style={{ fontSize:10, color:'#888', marginBottom:2 }}>시작일 (월요일)</div>
                    <input type="date" value={rot.startDate || ''} onChange={e => onSaveMaleRotation({ ...maleRotation, [emp.id]:{ ...rot, startDate:e.target.value } })}
                      style={{ width:'100%', padding:'3px 4px', borderRadius:5, border:'1px solid '+T.border, fontSize:10, fontFamily:'inherit' }}/>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
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
            {[...BRANCHES_SCH, { id:'male', name:'남직원', color:T.primary }].map(b => (
              <button key={b.id} onClick={() => setNewEmp(p => ({ ...p, branch:b.id, isMale:b.id==='male' }))}
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
        <div style={{ marginBottom:20, display:'flex', gap:10, flexWrap:'wrap' }}>
          {[{ key:'isOwner', label:'원장' }, { key:'mustStay', label:'타지점이동불가' }, { key:'isFreelancer', label:'프리랜서' }].map(({ key, label }) => (
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
          setNewEmp({ name:'', branch:'gangnam', isOwner:false, weeklyOff:2, isMale:false, mustStay:false, isFreelancer:false, startDate:todayStr })
          setShowAddEmp(false)
        }} style={{ width:'100%', padding:'10px 0', borderRadius:8, fontSize:13, fontFamily:'inherit', cursor:'pointer', fontWeight:700,
          background:newEmp.name.trim() ? T.primary : T.border, color:newEmp.name.trim() ? '#fff' : T.textMuted, border:'none' }}>
          추가하기
        </button>
      </div>
    </>}
  </>
}

function EmpCard({ emp, branch, empSettings, onSetEmpSetting, onDeleteEmp }) {
  const cfg = empSettings[emp.id] || { weeklyWork:5, altPattern:false }
  return (
    <div style={{ border:'1px solid #e4ddd0', borderRadius:8, padding:'8px 12px', minWidth:160, background:T.bgCard }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontWeight:700, fontSize:12, color:'#3a2010' }}>{emp.name}</div>
        <button onClick={() => onDeleteEmp(emp.id)} style={{ fontSize:10, padding:'1px 5px', borderRadius:4, border:'1px solid #f5b3b3', background:T.dangerLt, color:T.danger, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
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
    </div>
  )
}
