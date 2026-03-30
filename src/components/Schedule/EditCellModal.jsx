import { T } from '../../lib/constants'
import { BRANCHES_SCH, STATUS, getSColor, DNAMES } from './scheduleConstants'

export default function EditCellModal({ editCell, empSettings, onSet, onClose }) {
  if (!editCell) return null
  const { emp, day, cur } = editCell
  const isFL = emp.isFreelancer || empSettings[emp.id]?.isFreelancer
  const statusOptions = isFL ? ['근무','휴무','휴무(꼭)'] : ['근무','휴무','휴무(꼭)','전체쉐어']

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.3)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:22, zIndex:201, width:260, boxShadow:'0 10px 40px rgba(0,0,0,.2)' }}>
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
      <button onClick={onClose} style={{ marginTop:12, width:'100%', padding:'8px', border:'1px solid #ddd', borderRadius:8, background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:12, color:'#999' }}>닫기</button>
    </div>
  </>
}
