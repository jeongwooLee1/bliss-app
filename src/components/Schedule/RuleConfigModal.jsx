import { useMemo } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH } from './scheduleConstants'

// 모든 배정 규칙 정의 — 코드 하드코딩 규칙도 여기에서 토글/우선순위 관리
export const ALL_RULES = [
  { key:'weeklyOff',        label:'직원 weeklyOff 갯수 보장',      desc:'각 직원이 주별 휴무 갯수만큼 쉼', alwaysOn:true },
  { key:'branchMinStaff',   label:'지점별 최소 근무인원',          desc:'각 지점에 minStaff 이상 근무 보장' },
  { key:'noSimultaneousOff',label:'동시 휴무 금지 그룹',           desc:'그룹별 동시 휴무 max 인원 제한' },
  { key:'workCount',        label:'전체 근무인원 (min/max)',       desc:'일별 전체 근무 인원수 범위' },
  { key:'biweeklyConsecOff',label:'2주 연속 휴무 보장',            desc:'2주에 한 번은 연속 2일 휴무' },
  { key:'maxConsecWork',    label:'최대 연속 근무일',              desc:'연속 근무 일수 제한' },
  { key:'threeDaysConsecOff', label:'3일 연속 휴무 금지',          desc:'3일 연속 휴무 절대 금지' },
  { key:'popPattern',       label:'퐁당퐁당 (휴-근-휴) 금지',      desc:'휴무-근무-휴무 패턴 방지' },
  { key:'sundayMaleOne',    label:'일요일 남자 1명만',             desc:'일요일에 남자직원 정확히 1명 근무' },
  { key:'maleAllOff',       label:'남직원 전원 휴무 금지',         desc:'남자직원 최소 1명 근무' },
  { key:'mustStayBranch',   label:'타지점 이동 불가 직원 보호',    desc:'mustStay 직원은 본 지점 고정' },
]

const DEFAULT_ORDER = ALL_RULES.map(r => r.key)

export default function RuleConfigModal({ ruleConfig, allEmployees, empSettings, onSetRule, onClose }) {
  const rulesMeta = ruleConfig.rulesMeta || {}
  const rulesOrderRaw = Array.isArray(ruleConfig.rulesOrder) ? ruleConfig.rulesOrder : DEFAULT_ORDER
  // 새로 추가된 규칙은 끝에 자동 추가, 사라진 규칙은 제외
  const rulesOrder = useMemo(() => {
    const known = new Set(ALL_RULES.map(r => r.key))
    const valid = rulesOrderRaw.filter(k => known.has(k))
    const missing = ALL_RULES.map(r => r.key).filter(k => !valid.includes(k))
    return [...valid, ...missing]
  }, [rulesOrderRaw])

  const isEnabled = (key) => {
    const r = ALL_RULES.find(x => x.key === key)
    if (r?.alwaysOn) return true
    return rulesMeta[key]?.enabled !== false // default ON
  }
  const toggleRule = (key) => {
    const r = ALL_RULES.find(x => x.key === key)
    if (r?.alwaysOn) return
    const next = { ...rulesMeta, [key]: { ...(rulesMeta[key] || {}), enabled: !isEnabled(key) } }
    onSetRule('rulesMeta', next)
  }
  const moveRule = (key, dir) => {
    const idx = rulesOrder.indexOf(key)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= rulesOrder.length) return
    const next = [...rulesOrder]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    onSetRule('rulesOrder', next)
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:20, zIndex:201, width:'min(96vw,920px)', maxHeight:'92vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>⚙️ 배정 규칙 설정</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>
      <div style={{ fontSize:11, color:T.textMuted, marginBottom:14 }}>변경 후 자동배치를 다시 실행하면 반영됩니다.</div>

      {/* 우선순위 + 토글 */}
      <div style={{ marginBottom:18, padding:'12px 14px', background:'#fff8f0', borderRadius:10, border:'1px solid #f0ddc4' }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:8 }}>📊 규칙 우선순위 + ON/OFF</div>
        <div style={{ fontSize:10, color:T.textMuted, marginBottom:10 }}>위에 있는 규칙일수록 우선 적용. ↑↓ 으로 순서 변경.</div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {rulesOrder.map((key, idx) => {
            const r = ALL_RULES.find(x => x.key === key)
            if (!r) return null
            const on = isEnabled(key)
            return (
              <div key={key} style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'7px 10px', borderRadius:7,
                border:`1px solid ${on ? '#d4b894' : '#e0e0e0'}`,
                background:on ? '#fff' : '#f8f8f8',
                opacity: r.alwaysOn ? 1 : (on ? 1 : 0.55)
              }}>
                <span style={{ fontSize:11, fontWeight:700, color:'#7a4a18', minWidth:24, textAlign:'center', background:'#f5e8d0', borderRadius:4, padding:'2px 4px' }}>
                  {idx+1}
                </span>
                <button onClick={()=>moveRule(key, -1)} disabled={idx===0}
                  style={{ width:24, height:24, borderRadius:5, border:'1px solid #ddd', background:idx===0?'#f5f5f5':'#fff', cursor:idx===0?'default':'pointer', fontSize:11, fontFamily:'inherit', color:'#7a4a18' }}>▲</button>
                <button onClick={()=>moveRule(key, 1)} disabled={idx===rulesOrder.length-1}
                  style={{ width:24, height:24, borderRadius:5, border:'1px solid #ddd', background:idx===rulesOrder.length-1?'#f5f5f5':'#fff', cursor:idx===rulesOrder.length-1?'default':'pointer', fontSize:11, fontFamily:'inherit', color:'#7a4a18' }}>▼</button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:T.text }}>{r.label}{r.alwaysOn && <span style={{ marginLeft:6, fontSize:9, color:'#7a4a18', background:'#f5e8d0', borderRadius:3, padding:'1px 5px' }}>필수</span>}</div>
                  <div style={{ fontSize:10, color:T.textMuted, marginTop:1 }}>{r.desc}</div>
                </div>
                <button onClick={()=>toggleRule(key)} disabled={r.alwaysOn}
                  style={{ padding:'4px 10px', borderRadius:5, border:'none', background:r.alwaysOn?'#bba07a':on?'#7a4a18':'#bbb', color:'#fff', fontSize:10, fontWeight:700, cursor:r.alwaysOn?'default':'pointer', fontFamily:'inherit' }}>
                  {on?'ON':'OFF'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* 전체 근무 인원 */}
      {isEnabled('workCount') && <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>🌍 전체 근무인원</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          {[
            { key:'minWork', label:'일 최소 근무인원', unit:'명', min:0, max:25 },
            { key:'maxWork', label:'일 최대 근무인원', unit:'명', min:0, max:25 },
            { key:'maxDailyOff', label:'하루 최대 휴무', unit:'명', min:0, max:15 },
          ].map(({ key, label, unit, min, max }) => (
            <div key={key} style={{ background:T.bgCard, borderRadius:8, padding:'10px 14px', minWidth:160, border:'1px solid #e4ddd0' }}>
              <div style={{ fontSize:11, color:T.textSub, marginBottom:8 }}>{label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={() => onSetRule(key, Math.max(min, ruleConfig[key]-1))}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>−</button>
                <span style={{ fontSize:16, fontWeight:700, color:'#4a2c14', minWidth:28, textAlign:'center' }}>{ruleConfig[key]}</span>
                <button onClick={() => onSetRule(key, Math.min(max, ruleConfig[key]+1))}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>+</button>
                <span style={{ fontSize:11, color:T.textMuted }}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* 최대 연속 근무 */}
      {isEnabled('maxConsecWork') && <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>📅 최대 연속 근무일</div>
        <div style={{ background:T.bgCard, borderRadius:8, padding:'10px 14px', minWidth:160, border:'1px solid #e4ddd0', display:'inline-flex', alignItems:'center', gap:8 }}>
          <button onClick={() => onSetRule('maxConsecWork', Math.max(2, (ruleConfig.maxConsecWork||6)-1))}
            style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14 }}>−</button>
          <span style={{ fontSize:16, fontWeight:700, color:'#4a2c14', minWidth:28, textAlign:'center' }}>{ruleConfig.maxConsecWork||6}</span>
          <button onClick={() => onSetRule('maxConsecWork', Math.min(14, (ruleConfig.maxConsecWork||6)+1))}
            style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14 }}>+</button>
          <span style={{ fontSize:11, color:T.textMuted }}>일</span>
        </div>
      </div>}

      {/* 지점별 최소 근무인원 */}
      {isEnabled('branchMinStaff') && <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>📍 지점별 최소 근무인원</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {BRANCHES_SCH.map(b => (
            <div key={b.id} style={{ background:T.bgCard, borderRadius:8, padding:'10px 14px', minWidth:140, border:`1.5px solid ${b.color}44` }}>
              <div style={{ fontSize:11, fontWeight:700, color:b.color, marginBottom:8 }}>{b.name}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={() => onSetRule('branchMinStaff', { ...ruleConfig.branchMinStaff, [b.id]:Math.max(0, (ruleConfig.branchMinStaff?.[b.id] ?? b.minStaff)-1) })}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>−</button>
                <span style={{ fontSize:16, fontWeight:700, color:'#4a2c14', minWidth:24, textAlign:'center' }}>{ruleConfig.branchMinStaff?.[b.id] ?? b.minStaff}</span>
                <button onClick={() => onSetRule('branchMinStaff', { ...ruleConfig.branchMinStaff, [b.id]:Math.min(10, (ruleConfig.branchMinStaff?.[b.id] ?? b.minStaff)+1) })}
                  style={{ width:26, height:26, borderRadius:5, border:'1px solid #ddd', background:T.gray100, cursor:'pointer', fontSize:14, fontFamily:'inherit', color:'#5c4028' }}>+</button>
                <span style={{ fontSize:11, color:T.textMuted }}>명</span>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* 동시 휴무 금지 그룹 */}
      {isEnabled('noSimultaneousOff') && <div style={{ marginBottom:18 }}>
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
                <button onClick={() => { const g = [...ruleConfig.noSimultaneousOff]; g[gi] = { ...g[gi], max:Math.min(group.ids.length || 1, g[gi].max+1) }; onSetRule('noSimultaneousOff', g) }}
                  style={{ width:22, height:22, borderRadius:4, border:'1px solid '+T.border, background:T.bgCard, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>+</button>
                <button onClick={() => { const g = ruleConfig.noSimultaneousOff.filter((_, i) => i !== gi); onSetRule('noSimultaneousOff', g) }}
                  style={{ marginLeft:4, padding:'2px 8px', borderRadius:5, border:'1px solid #f0c0c0', background:'#fff5f5', color:'#c06060', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>삭제</button>
              </div>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {allEmployees.filter(e =>
                !(e.isFreelancer || empSettings[e.id]?.isFreelancer)
                && !empSettings[e.id]?.excludeFromSchedule
              ).map(emp => {
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
                  {emp.name}{emp.isMale ? ' ♂' : ''}
                </button>
              })}
            </div>
          </div>
        ))}
        <button onClick={() => onSetRule('noSimultaneousOff', [...(ruleConfig.noSimultaneousOff || []), { ids:[], max:1 }])}
          style={{ width:'100%', padding:'8px 0', borderRadius:8, border:'1.5px dashed '+T.border, background:'transparent', color:T.textMuted, fontSize:12, cursor:'pointer', fontFamily:'inherit', marginTop:4 }}>
          + 그룹 추가
        </button>
      </div>}

      {/* 2주 연속휴무 보장 */}
      {isEnabled('biweeklyConsecOff') && <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:6, borderBottom:'1px solid #f0ebe2', paddingBottom:6 }}>🔁 2주 연속휴무 보장</div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:10 }}>모든 직원이 2주에 한 번은 연속(2일) 이상 휴무를 갖도록 자동 배정</div>
        <div onClick={() => onSetRule('biweeklyConsecOff', !ruleConfig.biweeklyConsecOff)}
          style={{ display:'inline-flex', alignItems:'center', gap:10, padding:'10px 16px', borderRadius:8, border:`1.5px solid ${ruleConfig.biweeklyConsecOff ? T.primary : T.border}`, background:ruleConfig.biweeklyConsecOff ? '#fdf8f0' : T.bgCard, cursor:'pointer' }}>
          <span style={{ fontSize:12, fontWeight:700, color:ruleConfig.biweeklyConsecOff ? '#7a4a18' : T.textMuted }}>2주 연속휴무 보장</span>
          <span style={{ fontSize:11, background:ruleConfig.biweeklyConsecOff ? T.primary : T.border, color:'#fff', borderRadius:4, padding:'2px 8px', fontWeight:700 }}>{ruleConfig.biweeklyConsecOff ? 'ON' : 'OFF'}</span>
        </div>
      </div>}

      <div style={{ marginTop:20, padding:'10px 14px', background:'#f5f0ea', borderRadius:8, fontSize:10, color:T.textMuted, lineHeight:1.6 }}>
        💡 위 규칙들 외에 코드 내장 규칙(3일 연속 휴무 금지, 퐁당퐁당, 일요일 남자 1명 등)은 ON/OFF만 가능. 값 조정은 코드 변경 필요.
      </div>
    </div>
  </>
}
