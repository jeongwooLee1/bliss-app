import { T } from '../../lib/constants'
export default function BranchSettings({ data, onBack }) {
  const branches = data?.branches||[]
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:T.bgCard,borderBottom:`1px solid ${T.border}`}}>
        <button onClick={onBack} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:18}}>‹</button>
        <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>지점 관리</span>
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        {branches.map(b=>(
          <div key={b.id} style={{padding:'12px 16px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:b.color||T.primary,flexShrink:0}}/>
            <div>
              <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{b.name}</div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{b.address||''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
