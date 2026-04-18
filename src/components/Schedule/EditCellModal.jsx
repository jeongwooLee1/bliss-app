import { useState } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, STATUS, getSColor, DNAMES } from './scheduleConstants'

export default function EditCellModal({
  editCell, empSettings, onSet, onClose,
  // 셀 태그
  cellTagDefs = [], getCellTags = () => [], setCellTag = () => {},
  onAddTagDef = () => {}, onDeleteTagDef = () => {},
}) {
  if (!editCell) return null
  const { emp, day, cur } = editCell
  // 전체쉐어는 제거 — 근무 + 쉐어 태그 조합으로 대체
  const statusOptions = ['근무','휴무','휴무(꼭)','무급']

  // 현재 셀의 태그
  const activeTags = new Set(getCellTags(emp.id, day.ds))
  // 반복 설정 대상 태그 (칩 클릭 후 펼쳐지는 영역)
  const [repeatTagId, setRepeatTagId] = useState(null)
  const [repeat, setRepeat] = useState('none')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [manageMode, setManageMode] = useState(false)

  // 새 태그 추가 UI state
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#607D8B')

  const toggleTag = async (tagId) => {
    const turnOn = !activeTags.has(tagId)
    // 켜는 경우이고 반복 옵션 입력창이 아직 안 열려있으면, 일단 반복 설정 패널 열기
    if (turnOn) {
      if (repeatTagId !== tagId) {
        setRepeatTagId(tagId)
        setRepeat('none')
        setRepeatUntil('')
        // 단발로 바로 적용하되, 반복 바꾸려면 패널에서 다시 적용
        await setCellTag(emp.id, day.ds, tagId, true, 'none', '')
        return
      }
    }
    // 끄는 경우: 단발 해제 (반복 해제는 별도 버튼에서)
    setRepeatTagId(null)
    await setCellTag(emp.id, day.ds, tagId, false, 'none', '')
  }

  const applyRepeat = async () => {
    if (!repeatTagId) return
    await setCellTag(emp.id, day.ds, repeatTagId, true, repeat, repeatUntil)
    setRepeatTagId(null)
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.3)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:22, zIndex:201, width:320, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.2)' }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'#221810' }}>{emp.name}</div>
        <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>{day.d}일 {DNAMES[day.dow]}요일</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
        {/* 삭제(빈칸) */}
        <button onClick={() => { onSet(emp.id, day.ds, ''); onClose() }}
          style={{ padding:'9px 14px', borderRadius:8, border:`2px solid ${!cur ? T.border : '#e4ddd6'}`,
            background:!cur ? T.gray100 : T.bgCard, color:T.textMuted,
            fontFamily:'inherit', fontSize:13, fontWeight:!cur ? 700 : 400,
            cursor:'pointer', textAlign:'left', transition:'all .12s' }}>
          — 삭제 (빈칸) {!cur ? '✓' : ''}
        </button>
        {statusOptions.map(s => {
          const sc = getSColor(s)
          const active = cur === s
          return <button key={s} onClick={() => { onSet(emp.id, day.ds, s); onClose() }}
            style={{ padding:'9px 14px', borderRadius:8, border:`2px solid ${active ? sc.border : '#e4ddd6'}`,
              background:active ? sc.bg : T.bgCard, color:active ? sc.text : '#666',
              fontFamily:'inherit', fontSize:13, fontWeight:active ? 700 : 400,
              cursor:'pointer', textAlign:'left', transition:'all .12s' }}>
            {s} {active ? '✓' : ''}
          </button>
        })}
        {BRANCHES_SCH.map(b => {
          const sv = `지원(${b.name})`
          const sc = getSColor(sv)
          const active = cur === sv
          return <button key={sv} onClick={() => { onSet(emp.id, day.ds, sv); onClose() }}
            style={{ padding:'9px 14px', borderRadius:8, border:`2px solid ${active ? sc.border : '#e4ddd6'}`,
              background:active ? sc.bg : T.bgCard, color:active ? sc.text : '#c87020',
              fontFamily:'inherit', fontSize:13, fontWeight:active ? 700 : 400,
              cursor:'pointer', textAlign:'left', transition:'all .12s' }}>
            지원 → {b.name} {active ? '✓' : ''}
          </button>
        })}
      </div>

      {/* ─── 직원 태그 섹션 ─── */}
      <div style={{ marginTop:16, paddingTop:12, borderTop:'1px solid '+T.border }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.textSub }}>🏷 태그</span>
          <button onClick={()=>setManageMode(v=>!v)} style={{ border:'none', background:'none', cursor:'pointer', fontSize:11, color:T.textMuted, textDecoration:'underline' }}>
            {manageMode ? '완료' : '관리'}
          </button>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {(cellTagDefs||[]).map(t => {
            const on = activeTags.has(t.id)
            return <span key={t.id} style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
              <button onClick={()=>toggleTag(t.id)}
                style={{ padding:'5px 10px', borderRadius:14, border:`1.5px solid ${on?t.color:T.border}`,
                  background:on?t.color+'22':'#fff', color:on?t.color:T.textSub,
                  fontSize:12, fontWeight:on?700:500, cursor:'pointer', fontFamily:'inherit' }}>
                {t.name}{on?' ✓':''}
              </button>
              {manageMode && <button onClick={()=>{ if(confirm(`태그 "${t.name}" 삭제?`)) onDeleteTagDef(t.id) }}
                style={{ border:'none', background:'none', color:T.danger, cursor:'pointer', fontSize:12, padding:'2px 4px' }}>×</button>}
            </span>
          })}
          {/* + 새 태그 */}
          {manageMode ? (
            <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 8px', border:'1.5px dashed '+T.border, borderRadius:14 }}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="태그명" style={{ border:'none', outline:'none', fontSize:12, width:60, fontFamily:'inherit' }}/>
              <input type="color" value={newColor} onChange={e=>setNewColor(e.target.value)} style={{ width:18, height:18, border:'none', padding:0, cursor:'pointer' }}/>
              <button onClick={async()=>{ if(newName.trim()){ await onAddTagDef(newName.trim(), newColor); setNewName(''); }}} style={{ border:'none', background:'none', color:T.primary, cursor:'pointer', fontSize:13, fontWeight:700 }}>+</button>
            </span>
          ) : (
            <button onClick={()=>setManageMode(true)} style={{ padding:'5px 10px', borderRadius:14, border:'1.5px dashed '+T.border, background:'transparent', color:T.textMuted, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>+ 추가</button>
          )}
        </div>

        {/* 반복 설정 패널 — 태그 방금 켰을 때 노출 */}
        {repeatTagId && (
          <div style={{ marginTop:10, padding:10, background:T.gray100, borderRadius:8, border:'1px solid '+T.border }}>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:6 }}>
              "{cellTagDefs.find(t=>t.id===repeatTagId)?.name}" 반복 적용
            </div>
            {/* 프리셋: 하루 / 1주 / 1달 */}
            <div style={{ display:'flex', gap:4, marginBottom:6 }}>
              {[
                {label:'하루만', r:'none', days:0},
                {label:'1주', r:'daily', days:6},
                {label:'1달', r:'daily', days:29},
              ].map(p => (
                <button key={p.label} onClick={()=>{
                  setRepeat(p.r);
                  if (p.days > 0) {
                    const d = new Date(day.ds); d.setDate(d.getDate()+p.days);
                    setRepeatUntil(d.toISOString().slice(0,10));
                  } else { setRepeatUntil(''); }
                }}
                  style={{ flex:1, padding:'5px 8px', fontSize:11, fontWeight:700, borderRadius:8, cursor:'pointer',
                    border:`1px solid ${T.primary}`, background:T.primaryLt, color:T.primary, fontFamily:'inherit' }}>{p.label}</button>
              ))}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
              {[{v:'none',l:'단발'},{v:'daily',l:'매일'},{v:'weekly',l:'매주 같은요일'},{v:'monthly',l:'매월 같은일'}].map(o => (
                <button key={o.v} onClick={()=>setRepeat(o.v)}
                  style={{ padding:'4px 8px', fontSize:11, fontWeight:repeat===o.v?700:400, borderRadius:12, cursor:'pointer',
                    border:`1px solid ${repeat===o.v?T.primary:T.border}`,
                    background:repeat===o.v?T.primaryLt:'transparent',
                    color:repeat===o.v?T.primary:T.textSub, fontFamily:'inherit' }}>{o.l}</button>
              ))}
            </div>
            {repeat !== 'none' && (
              <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8 }}>
                <span style={{ fontSize:11, color:T.textSub }}>종료일:</span>
                <input type="date" value={repeatUntil} onChange={e=>setRepeatUntil(e.target.value)} min={day.ds}
                  style={{ fontSize:11, padding:'4px 6px', border:'1px solid '+T.border, borderRadius:6, fontFamily:'inherit' }}/>
              </div>
            )}
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={applyRepeat} disabled={repeat!=='none' && !repeatUntil}
                style={{ flex:1, padding:'5px', fontSize:11, fontWeight:700, borderRadius:6, cursor:'pointer',
                  background:T.primary, color:'#fff', border:'none', opacity:(repeat!=='none' && !repeatUntil)?0.5:1, fontFamily:'inherit' }}>
                {repeat==='none'?'오늘만 적용 (이미 적용됨)':'반복 적용'}
              </button>
              <button onClick={()=>setRepeatTagId(null)}
                style={{ padding:'5px 10px', fontSize:11, borderRadius:6, cursor:'pointer', background:'transparent', color:T.textMuted, border:'1px solid '+T.border, fontFamily:'inherit' }}>닫기</button>
            </div>
          </div>
        )}
      </div>

      <button onClick={onClose} style={{ marginTop:12, width:'100%', padding:'8px', border:'1px solid #ddd', borderRadius:8, background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:12, color:'#999' }}>닫기</button>
    </div>
  </>
}
