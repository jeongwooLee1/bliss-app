import { T } from '../../lib/constants'
import { BRANCHES_SCH } from './scheduleConstants'

export default function SupportSettingsModal({ supportOrder, onSave, onClose }) {
  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,480px)', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>🏢 지점지원설정</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>
      <div style={{ fontSize:12, color:T.textMuted, marginBottom:18 }}>각 지점 minStaff 미달 시 외부 지원 나가는 지점 우선순위를 설정하세요.</div>
      <div style={{ fontSize:12, fontWeight:700, color:'#4a2c14', marginBottom:10 }}>📌 외부 지원 우선순위</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {BRANCHES_SCH.filter(b => b.id !== 'male').map(b => {
          const idx = supportOrder.indexOf(b.id)
          const isOn = idx !== -1
          return <div key={b.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:8, border:`1.5px solid ${isOn ? b.color : T.border}`, background:isOn ? b.color+'18' : T.bgCard, cursor:'pointer', transition:'all .12s' }}
            onClick={() => onSave(isOn ? supportOrder.filter(id => id !== b.id) : [...supportOrder, b.id])}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:isOn ? b.color : T.border }}/>
              <span style={{ fontSize:13, fontWeight:isOn ? 700 : 400, color:isOn ? b.color : T.textMuted }}>{b.name}</span>
            </div>
            {isOn
              ? <span style={{ fontSize:11, background:b.color, color:'#fff', borderRadius:5, padding:'2px 8px', fontWeight:700 }}>{idx+1}순위</span>
              : <span style={{ fontSize:11, color:T.gray400 }}>미사용</span>
            }
          </div>
        })}
      </div>
      <div style={{ marginTop:12, fontSize:11, color:'#bbb' }}>순위 변경: 켜진 항목을 해제 후 원하는 순서로 다시 켜세요.</div>
    </div>
  </>
}
