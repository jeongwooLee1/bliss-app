import { T } from '../../lib/constants'
export default function TagSettings({ data, onBack }) {
  const tags = data?.serviceTags||[]
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:T.bgCard,borderBottom:`1px solid ${T.border}`}}>
        <button onClick={onBack} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:18}}>‹</button>
        <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>태그 관리</span>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:12,display:'flex',flexWrap:'wrap',gap:8,alignContent:'flex-start'}}>
        {tags.map(t=>(
          <div key={t.id} style={{padding:'4px 12px',borderRadius:T.radius.full,background:t.color+'22',border:`1px solid ${t.color}`,color:t.color,fontSize:T.fs.xs,fontWeight:T.fw.bold}}>
            {t.name}
          </div>
        ))}
      </div>
    </div>
  )
}
