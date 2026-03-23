import { T } from '../../lib/constants'
export default function ServiceSettings({ data, onBack }) {
  const services = data?.services||[]
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:T.bgCard,borderBottom:`1px solid ${T.border}`}}>
        <button onClick={onBack} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:18}}>‹</button>
        <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>시술 상품</span>
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        {services.map(s=>(
          <div key={s.id} style={{padding:'12px 16px',borderBottom:`1px solid ${T.border}`}}>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{s.name}</div>
            <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{s.dur}분 · {(s.price||0).toLocaleString()}원</div>
          </div>
        ))}
      </div>
    </div>
  )
}
