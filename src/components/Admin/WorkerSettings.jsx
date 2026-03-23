import { T } from '../../lib/constants'
export default function WorkerSettings({ data, onBack }) {
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:T.bgCard,borderBottom:`1px solid ${T.border}`}}>
        <button onClick={onBack} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:18}}>‹</button>
        <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>직원 관리</span>
      </div>
      <div style={{padding:20,color:T.textMuted,fontSize:T.fs.sm}}>직원 관리 기능을 준비 중입니다.</div>
    </div>
  )
}
