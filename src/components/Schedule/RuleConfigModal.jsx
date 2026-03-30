import { T } from '../../lib/constants'
import { BRANCHES_SCH } from './scheduleConstants'

export default function RuleConfigModal({ ruleConfig, allEmployees, empSettings, onSetRule, onClose }) {
  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,820px)', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>⚙️ 배정 규칙 설정</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>
      <div style={{ fontSize:11, color:T.textMuted, marginBottom:18 }}>변경 후 자동배치를 다시 실행하면 반영됩니다.</div>

      {/* 전체 규칙 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>🌍 전체 근무인원</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          {[
            { key:'minWork', label:'일 최소 근무인원', unit:'명', min:8, max:18 },
            { key:'maxWork', label:'일 최대 근무인원', unit:'명', min:8, max:18 },
            { key:'maxDailyOff', label:'하루 최대 휴무', unit:'명', min:1, max:10 },
          ].map(({ key, label, unit, min, max }) => (
            <div key={key} style={{ background:T.bgCard, borderRadius:8, padding:'10px 14px', minWidth:160, border:'1px solid #e4ddd0' }}>
              <div style={{ fontSize:11, color:T.textSub, marginBottom:8 }}>{label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={() => onSetRule(key, Math.max(min, ruleConfig[key]-1))}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                <span style={{ fontSize:16, fontWeight:700, color:'#4a2c14', minWidth:28, textAlign:'center' }}>{ruleConfig[key]}</span>
                <button onClick={() => onSetRule(key, Math.min(max, ruleConfig[key]+1))}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                <span style={{ fontSize:11, color:T.textMuted }}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 지점별 최소 근무인원 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>📍 지점별 최소 근무인원</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {BRANCHES_SCH.map(b => (
            <div key={b.id} style={{ background:T.bgCard, borderRadius:8, padding:'10px 14px', minWidth:140, border:`1.5px solid ${b.color}44` }}>
              <div style={{ fontSize:11, fontWeight:700, color:b.color, marginBottom:8 }}>{b.name}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={() => onSetRule('branchMinStaff', { ...ruleConfig.branchMinStaff, [b.id]:Math.max(0, (ruleConfig.branchMinStaff[b.id] ?? b.minStaff)-1) })}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>−</button>
                <span style={{ fontSize:16, fontWeight:700, color:'#4a2c14', minWidth:24, textAlign:'center' }}>{ruleConfig.branchMinStaff[b.id] ?? b.minStaff}</span>
                <button onClick={() => onSetRule('branchMinStaff', { ...ruleConfig.branchMinStaff, [b.id]:Math.min(10, (ruleConfig.branchMinStaff[b.id] ?? b.minStaff)+1) })}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>+</button>
                <span style={{ fontSize:11, color:T.textMuted }}>명</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 동시 휴무 금지 그룹 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:6, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>🚫 동시 휴무 금지 그룹</div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:12 }}>직원을 선택해 그룹을 만들면 해당 그룹 내에서 동시 허용 인원 수를 초과할 수 없습니다.</div>
        {(ruleConfig.noSimultaneousOff || []).map((group, gi) => (
          <div key={gi} style={{ marginBottom:10, padding:'10px 12px', borderRadius:10, border:'1.5px solid '+T.border, background:T.bgCard }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.text }}>그룹 {gi+1}</span>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ fontSize:11, color:T.textMuted }}>동시 허용</span>
                <button onClick={() => { const g = [...ruleConfig.noSimultaneousOff]; g[gi] = { ...g[gi], max:Math.max(1, g[gi].max-1) }; onSetRule('noSimultaneousOff', g) }}
                  style={{ width:22, height:22, borderRadius:4, border:'1px solid '+T.border, background:T.bgCard, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>−</button>
                <span style={{ fontSize:13, fontWeight:700, color:'#7a4a18', minWidth:16, textAlign:'center' }}>{group.max}</span>
                <span style={{ fontSize:11, color:T.textMuted }}>명까지</span>
                <button onClick={() => { const g = [...ruleConfig.noSimultaneousOff]; g[gi] = { ...g[gi], max:Math.min(group.ids.length, g[gi].max+1) }; onSetRule('noSimultaneousOff', g) }}
                  style={{ width:22, height:22, borderRadius:4, border:'1px solid '+T.border, background:T.bgCard, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>+</button>
                <button onClick={() => { const g = ruleConfig.noSimultaneousOff.filter((_, i) => i !== gi); onSetRule('noSimultaneousOff', g) }}
                  style={{ marginLeft:4, padding:'2px 8px', borderRadius:5, border:'1px solid #f0c0c0', background:'#fff5f5', color:'#c06060', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
              </div>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {allEmployees.filter(e => !e.isMale && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)).map(emp => {
                const inGroup = group.ids.includes(emp.id)
                const bc = BRANCHES_SCH.find(b => b.id === emp.branch)?.color || T.border
                return <button key={emp.id} onClick={() => {
                  const g = [...ruleConfig.noSimultaneousOff]
                  const ids = inGroup ? group.ids.filter(id => id !== emp.id) : [...group.ids, emp.id]
                  g[gi] = { ...g[gi], ids }
                  onSetRule('noSimultaneousOff', g)
                }} style={{ padding:'4px 10px', borderRadius:6, fontSize:11, fontFamily:'inherit', cursor:'pointer',
                  border:`1.5px solid ${inGroup ? bc : T.border}`, background:inGroup ? bc+'22' : T.bgCard,
                  color:inGroup ? bc : T.textMuted, fontWeight:inGroup ? 700 : 400 }}>
                  {emp.name}
                </button>
              })}
            </div>
          </div>
        ))}
        <button onClick={() => onSetRule('noSimultaneousOff', [...(ruleConfig.noSimultaneousOff || []), { ids:[], max:1 }])}
          style={{ width:'100%', padding:'8px 0', borderRadius:8, border:'1.5px dashed '+T.border, background:'transparent', color:T.textMuted, fontSize:12, cursor:'pointer', fontFamily:'inherit', marginTop:4 }}>
          + 그룹 추가
        </button>
      </div>

      {/* 2주 연속휴무 보장 */}
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:6, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>🔁 2주 연속휴무 보장</div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:10 }}>ON: 모든 직원이 2주에 한 번은 연속(2일) 이상 휴무를 갖도록 자동 배정</div>
        <div onClick={() => onSetRule('biweeklyConsecOff', !ruleConfig.biweeklyConsecOff)}
          style={{ display:'inline-flex', alignItems:'center', gap:10, padding:'10px 16px', borderRadius:8, border:`1.5px solid ${ruleConfig.biweeklyConsecOff ? T.primary : T.border}`, background:ruleConfig.biweeklyConsecOff ? '#fdf8f0' : T.bgCard, cursor:'pointer' }}>
          <span style={{ fontSize:12, fontWeight:700, color:ruleConfig.biweeklyConsecOff ? '#7a4a18' : T.textMuted }}>2주 연속휴무 보장</span>
          <span style={{ fontSize:11, background:ruleConfig.biweeklyConsecOff ? T.primary : T.border, color:'#fff', borderRadius:4, padding:'2px 8px', fontWeight:700 }}>{ruleConfig.biweeklyConsecOff ? 'ON' : 'OFF'}</span>
        </div>
      </div>
    </div>
  </>
}
