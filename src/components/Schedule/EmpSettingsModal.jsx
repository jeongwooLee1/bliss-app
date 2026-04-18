import { useState, useRef } from 'react'
import { T } from '../../lib/constants'
import { useScheduleData } from '../../lib/useData'
import { BRANCHES_SCH, BRANCH_LABEL, STATUS, DB_KEYS, getDow0Mon, fmtDs } from './scheduleConstants'

export default function EmpSettingsModal({ allEmployees, empSettings, customEmployees, deletedEmpIds, maleRotation, onSetEmpSetting, onAddEmp, onDeleteEmp, onSaveMaleRotation, onUpdateEmp, onClose,
  ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSetOwnerRepeat }) {
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [tab, setTab] = useState('settings') // 'settings' | 'schedule'
  const todayStr = new Date().toISOString().slice(0, 10)
  const [newEmp, setNewEmp] = useState({ name:'', branch:'gangnam', rank:'시니어', weeklyOff:2, mustStay:false, isFreelancer:false, startDate:todayStr, nonSchedule:false, groupName:'', gender:'F' })
  const { data:nonSchedEmps, save:saveNonSched } = useScheduleData(DB_KEYS.nonScheduleEmployees, [])
  const nonSchedList = Array.isArray(nonSchedEmps) ? nonSchedEmps : []
  const existingGroups = Array.from(new Set(nonSchedList.map(e => e.groupName).filter(Boolean)))

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
      {/* 탭 */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid '+T.border, marginBottom:14 }}>
        {[['settings','직급 / 근무'],['schedule','휴무 설정']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{ padding:'8px 18px', fontSize:12, fontWeight:tab===k?700:400, color:tab===k?T.primary:T.textSub, background:'none', border:'none',
              borderBottom:tab===k?'2px solid '+T.primary:'2px solid transparent', cursor:'pointer', fontFamily:'inherit', marginBottom:-1 }}>
            {l}
          </button>
        ))}
      </div>

      {tab==='settings' && <>

      {BRANCHES_SCH.map(branch => {
        const emps = allEmployees.filter(e => e.branch === branch.id)
        if (!emps.length) return null
        return (
          <div key={branch.id} style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:branch.color, marginBottom:8, borderBottom:`1px solid ${branch.color}33`, paddingBottom:4 }}>{branch.name}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {emps.map(emp => <EmpCard key={emp.id} emp={emp} branch={branch} empSettings={empSettings} onSetEmpSetting={onSetEmpSetting} onDeleteEmp={onDeleteEmp} onUpdateEmp={onUpdateEmp} customEmployees={customEmployees} deletedEmpIds={deletedEmpIds}/>)}
            </div>
          </div>
        )
      })}

      {/* 근무표 외 직원 (소속만 등록 · 매장 근무 X) */}
      {nonSchedList.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:T.textSub, marginBottom:8, borderBottom:`1px solid ${T.border}`, paddingBottom:4 }}>근무표 외 직원 <span style={{fontSize:10,color:T.textMuted,fontWeight:400}}>소속만 등록 · 매장 근무 X · 팀 채팅 참여</span></div>
          {(() => {
            const byGroup = {}
            nonSchedList.forEach(e => { const g = e.groupName || '기타'; (byGroup[g] = byGroup[g] || []).push(e) })
            return Object.entries(byGroup).map(([g, list]) => (
              <div key={g} style={{ marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:600, color:T.textMuted, marginBottom:4 }}>📍 {g}</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {list.map(e => (
                    <div key={e.id} style={{ display:'flex', alignItems:'center', gap:6, border:'1px solid '+T.border, borderRadius:6, padding:'5px 10px', background:T.bgCard, fontSize:12 }}>
                      <span style={{ fontSize:9, color: e.gender==='M' ? T.male : T.female, fontWeight:700, padding:'1px 5px', background: e.gender==='M' ? T.maleLt : T.femaleLt, borderRadius:3 }}>{e.gender==='M'?'남':'여'}</span>
                      <span style={{ fontWeight:600 }}>{e.name}</span>
                      <button onClick={() => { if(confirm(`${e.name} 삭제?`)) saveNonSched(nonSchedList.filter(x => x.id !== e.id)) }}
                        style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:'1px solid #f5b3b3', background:T.dangerLt, color:T.danger, cursor:'pointer', fontFamily:'inherit' }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()}
        </div>
      )}

      {/* 로테이션 직원 (maleRotation에 등록된) */}
      {(() => {
        const rotEmps = allEmployees.filter(e => maleRotation[e.id]?.branches?.length > 0)
        if (!rotEmps.length) return null
        return (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.primary, marginBottom:8, borderBottom:`1px solid ${T.primary}33`, paddingBottom:4 }}>로테이션 직원</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {rotEmps.map(emp => {
                const rot = maleRotation[emp.id] || { branches:[], startDate:'' }
                const allBranches = BRANCHES_SCH.map(b => b.id)
                return (
                  <div key={emp.id} style={{ border:'1px solid #b8d0e8', borderRadius:8, padding:'8px 12px', minWidth:180, background:T.gray100 }}>
                    <div style={{ fontWeight:700, fontSize:12, color:'#2a5080', marginBottom:4 }}>{emp.name} <span style={{fontSize:9,color:RANK_COLOR[emp.rank||'시니어'],fontWeight:600}}>{emp.rank||'시니어'}</span></div>
                    <div style={{ fontSize:11, color:T.textSub, marginBottom:4 }}>주간 로테이션 지점</div>
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
      </>}

      {/* 휴무 설정 탭 */}
      {tab==='schedule' && <ScheduleTab allEmployees={allEmployees} empSettings={empSettings}
        ownerReqs={ownerReqs} empReqs={empReqs} ownerRepeat={ownerRepeat} days={days} year={year} month={month}
        curMonthStr={curMonthStr} nextMonthStr={nextMonthStr}
        onSetOwnerReqs={onSetOwnerReqs} onSetEmpReqs={onSetEmpReqs} onSaveOwnerReqs={onSaveOwnerReqs} onSetOwnerRepeat={onSetOwnerRepeat}/>}
    </div>

    {/* 직원 추가 모달 */}
    {showAddEmp && <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:300 }} onClick={() => setShowAddEmp(false)}/>
      <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:301, width:'min(96vw,400px)', boxShadow:'0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>＋ 직원 추가</div>
          <button onClick={() => setShowAddEmp(false)} style={{ fontSize:16, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
        {/* 구분 토글 */}
        <div style={{ marginBottom:14, display:'flex', gap:6, padding:3, background:T.gray100, borderRadius:8 }}>
          {[['schedule','지점 근무직원'],['nonSchedule','근무표 외 직원 (소속만 등록)']].map(([k,l]) => {
            const active = (k==='nonSchedule') === !!newEmp.nonSchedule
            return <button key={k} onClick={() => setNewEmp(p => ({ ...p, nonSchedule: k==='nonSchedule' }))}
              style={{ flex:1, padding:'6px 0', borderRadius:6, fontSize:11, fontFamily:'inherit', cursor:'pointer',
                background:active?T.bgCard:'transparent', color:active?T.primary:T.textMuted, fontWeight:active?700:500, border:'none', boxShadow:active?'0 1px 2px rgba(0,0,0,.05)':'none' }}>{l}</button>
          })}
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>이름</div>
          <input value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name:e.target.value }))} placeholder="이름 입력"
            style={{ width:'100%', padding:'8px 10px', borderRadius:7, border:'1.5px solid #e4ddd0', fontSize:13, fontFamily:'inherit', outline:'none' }}/>
        </div>
        {!newEmp.nonSchedule ? (
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
        ) : (
          <>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>소속 (회사/팀명 자유 입력)</div>
              <input value={newEmp.groupName} onChange={e => setNewEmp(p => ({ ...p, groupName:e.target.value }))} placeholder="예: 테라포트, 마케팅팀, 본사, 외주 등"
                list="ns-group-suggest"
                style={{ width:'100%', padding:'8px 10px', borderRadius:7, border:'1.5px solid #e4ddd0', fontSize:13, fontFamily:'inherit', outline:'none' }}/>
              <datalist id="ns-group-suggest">
                {existingGroups.map(g => <option key={g} value={g}/>)}
              </datalist>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.textSub, marginBottom:5, fontWeight:600 }}>성별</div>
              <div style={{ display:'flex', gap:6 }}>
                {[['F','여성'],['M','남성']].map(([g,l]) => (
                  <button key={g} onClick={() => setNewEmp(p => ({ ...p, gender:g }))}
                    style={{ flex:1, padding:'7px 0', borderRadius:7, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                      border:`1.5px solid ${newEmp.gender===g ? (g==='M'?T.male:T.female) : T.border}`,
                      background:newEmp.gender===g ? (g==='M'?T.maleLt:T.femaleLt) : T.bgCard,
                      color:newEmp.gender===g ? (g==='M'?T.male:T.female) : T.textMuted,
                      fontWeight:newEmp.gender===g ? 700 : 400 }}>{l}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {!newEmp.nonSchedule && <>
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
        </>}
        <button disabled={!newEmp.name.trim() || (newEmp.nonSchedule && !newEmp.groupName.trim())} onClick={() => {
          const id = newEmp.name.trim()
          if (!id) return
          if (newEmp.nonSchedule) {
            if (!newEmp.groupName.trim()) return
            if (nonSchedList.some(e => e.id === id)) { alert('이미 같은 이름의 직원이 있습니다.'); return }
            if (allEmployees.some(e => e.id === id)) { alert('같은 이름의 근무표 직원이 이미 있습니다.'); return }
            saveNonSched([...nonSchedList, { id, name:id, groupName:newEmp.groupName.trim(), gender:newEmp.gender }])
          } else {
            if (allEmployees.some(e => e.id === id)) { alert('이미 같은 이름의 직원이 있습니다.'); return }
            onAddEmp({ ...newEmp, id, name:id })
          }
          setNewEmp({ name:'', branch:'gangnam', rank:'시니어', weeklyOff:2, mustStay:false, isFreelancer:false, startDate:todayStr, nonSchedule:false, groupName:'', gender:'F' })
          setShowAddEmp(false)
        }} style={{ width:'100%', padding:'10px 0', borderRadius:8, fontSize:13, fontFamily:'inherit', cursor:'pointer', fontWeight:700,
          background:(newEmp.name.trim() && (!newEmp.nonSchedule || newEmp.groupName.trim())) ? T.primary : T.border, color:(newEmp.name.trim() && (!newEmp.nonSchedule || newEmp.groupName.trim())) ? '#fff' : T.textMuted, border:'none' }}>
          추가하기
        </button>
      </div>
    </>}
  </>
}

const RANKS = ['원장','마스터','시니어','인턴'];
const RANK_COLOR = {원장:'#8B4513',마스터:'#2a6099',시니어:'#4CAF50',인턴:'#999'};

function EmpCard({ emp, branch, empSettings, onSetEmpSetting, onDeleteEmp, onUpdateEmp }) {
  const cfg = empSettings[emp.id] || { weeklyWork:5, altPattern:false }
  return (
    <div style={{ border:'1px solid #e4ddd0', borderRadius:8, padding:'8px 12px', minWidth:180, background:T.bgCard }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:12, color:'#3a2010' }}>{emp.name}</div>
        <button onClick={() => onDeleteEmp(emp.id)} style={{ fontSize:10, padding:'1px 5px', borderRadius:4, border:'1px solid #f5b3b3', background:T.dangerLt, color:T.danger, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
      </div>
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

function ScheduleTab({ allEmployees, empSettings, ownerReqs, empReqs, ownerRepeat, days, year, month, curMonthStr, nextMonthStr, onSetOwnerReqs, onSetEmpReqs, onSaveOwnerReqs, onSetOwnerRepeat }) {
  const dragRef = useRef({ active:false, empId:null, mode:null })
  // 원장+프리랜서만 표시 (직급으로 필터)
  const targetEmps = allEmployees.filter(e => e.isOwner || e.rank==='원장' || e.isFreelancer || empSettings[e.id]?.isFreelancer)

  if (!days?.length) return <div style={{padding:20,color:T.textMuted,textAlign:'center'}}>달력 데이터 로드 중...</div>

  return <div onMouseUp={()=>{dragRef.current.active=false}} onMouseLeave={()=>{dragRef.current.active=false}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
      <div style={{fontSize:12,color:T.textMuted}}>원장/프리랜서 고정 휴무일을 드래그로 설정합니다.</div>
      <button onClick={()=>onSaveOwnerReqs(ownerReqs)} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid #c0a07a',background:'#fdf8f0',color:'#7a4a18',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>💾 저장</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:14}}>
      {targetEmps.map(emp => {
        const isFL = emp.isFreelancer || empSettings[emp.id]?.isFreelancer
        const reqs = isFL ? empReqs : ownerReqs
        const setReq = (key, val) => {
          if (isFL) onSetEmpReqs(prev => { const next={...prev}; if(val) next[key]=val; else delete next[key]; return next })
          else onSetOwnerReqs(prev => { const next={...prev}; if(val) next[key]=val; else delete next[key]; return next })
        }
        const bc = BRANCHES_SCH.find(b=>b.id===emp.branch)?.color || T.textSub
        const isDowFull = (dow) => { const md=days.filter(d=>!d.isNext&&d.dow===dow); return md.length>0&&md.every(d=>!!reqs[emp.id+'__'+d.ds]) }
        const rep = (ownerRepeat||{})[emp.id] || {enabled:false,dows:[]}
        const toggleDow = (dow) => {
          const full=isDowFull(dow)
          days.filter(d=>!d.isNext&&d.dow===dow).forEach(d=>setReq(emp.id+'__'+d.ds, full?null:STATUS.MUST_OFF))
          if(rep.enabled) onSetOwnerRepeat({...ownerRepeat,[emp.id]:{...rep,dows:full?rep.dows.filter(d=>d!==dow):[...new Set([...rep.dows,dow])]}})
        }
        const firstDowSun = (getDow0Mon(year,month,1)+1)%7
        const cells=[]; for(let i=0;i<firstDowSun;i++) cells.push(null); days.forEach(d=>cells.push(d)); while(cells.length%7) cells.push(null)

        return <div key={emp.id} style={{border:`1.5px solid ${bc}55`,borderRadius:10,padding:12}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:13,color:bc}}>{emp.name} <span style={{fontSize:10,color:RANK_COLOR[emp.rank||'시니어']}}>{emp.rank||'시니어'}</span></div>
            <button onClick={()=>onSetOwnerRepeat({...ownerRepeat,[emp.id]:{enabled:!rep.enabled,dows:Array.from({length:7},(_,i)=>i).filter(isDowFull)}})}
              style={{padding:'3px 10px',fontSize:11,fontWeight:700,borderRadius:5,border:`1.5px solid ${rep.enabled?'#e0a030':T.border}`,background:rep.enabled?'#fff8e8':T.bgCard,color:rep.enabled?'#c07000':T.textMuted,cursor:'pointer',fontFamily:'inherit'}}>
              {rep.enabled?'🔁 반복중':'🔁 반복'}
            </button>
          </div>
          <div style={{display:'flex',gap:4,marginBottom:10}}>
            {['일','월','화','수','목','금','토'].map((dn,di)=>{
              const dow=(di+6)%7; const full=isDowFull(dow)
              return <button key={di} onClick={()=>toggleDow(dow)}
                style={{flex:1,padding:'4px 0',fontSize:11,fontWeight:700,borderRadius:5,border:`1.5px solid ${full?bc:T.border}`,background:full?bc:T.bgCard,color:full?'#fff':T.textMuted,cursor:'pointer',fontFamily:'inherit'}}>{dn}</button>
            })}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
            {cells.map((day,ci)=>{
              if(!day) return <div key={'e'+ci} style={{height:30}}/>
              const key=emp.id+'__'+day.ds
              const on=!!reqs[key]||(rep.enabled&&rep.dows.includes(day.dow))
              const isSun=day.dow===6,isSat=day.dow===5
              return <div key={day.ds}
                onMouseDown={e=>{e.preventDefault();const dr=dragRef.current;dr.active=true;dr.empId=emp.id;dr.mode=reqs[key]?'off':'on';setReq(key,reqs[key]?null:STATUS.MUST_OFF)}}
                onMouseEnter={()=>{const dr=dragRef.current;if(!dr.active||dr.empId!==emp.id)return;if(dr.mode==='on'&&!reqs[key])setReq(key,STATUS.MUST_OFF);if(dr.mode==='off'&&reqs[key])setReq(key,null)}}
                style={{height:30,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:11,fontWeight:700,
                  background:on?bc:day.isNext?'#ede8f5':'#f5f0ea',
                  color:on?'#fff':day.isNext?T.purple:isSun?T.danger:isSat?T.primary:T.textSub,
                  border:`1.5px solid ${on?bc:day.isNext?'#c4b3e0':T.border}`,userSelect:'none',opacity:day.isNext?0.85:1}}>
                {day.d}
              </div>
            })}
          </div>
          <div style={{marginTop:6,fontSize:10,color:'#b0a090'}}>{isFL?'📌 프리랜서':'👑 원장'} 지정 휴무: {Object.keys(reqs).filter(k=>k.startsWith(emp.id+'__')&&(k.includes(curMonthStr)||k.includes(nextMonthStr))).length}일</div>
        </div>
      })}
    </div>
    {targetEmps.length===0 && <div style={{padding:30,textAlign:'center',color:T.textMuted}}>원장/프리랜서 직급인 직원이 없습니다.</div>}
  </div>
}
