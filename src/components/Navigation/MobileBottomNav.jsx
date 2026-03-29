import React, { useState } from 'react'
import { T } from '../../lib/constants'
import I from '../common/I'

function MobileBottomNav({ nav, page, setPage, isChatOpen=false }) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  if(isChatOpen) return null;
  const mainItems = [
    ...(nav.find(n=>n.id==="timeline")    ? [{id:"timeline",   label:"타임라인", icon:"calendar"}]  : []),
    ...(nav.find(n=>n.id==="sales")       ? [{id:"sales",      label:"매출",     icon:"wallet"}]    : []),
    ...(nav.find(n=>n.id==="messages")    ? [{id:"messages",   label:"메시지함",  icon:"msgSq", badge: nav.find(n=>n.id==="messages")?.badge||0}] : []),
    ...(nav.find(n=>n.id==="customers")   ? [{id:"customers",  label:"고객",     icon:"users"}]     : []),
  ];
  const moreItems = nav.filter(n=>!["timeline","sales","messages","customers"].includes(n.id));
  const items = [...mainItems, {id:"__more", label:"더보기", icon:"menu"}];
  return (
    <>
      {moreOpen && <div style={{position:"fixed",inset:0,zIndex:99}} onClick={()=>setMoreOpen(false)}/>}
      {moreOpen && <div style={{position:"fixed",bottom:56,left:0,right:0,zIndex:101,background:T.bgCard,borderTop:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",boxShadow:"0 -4px 20px rgba(0,0,0,.12)",padding:"12px 8px",animation:"slideUp .2s ease-out"}}>
        {moreItems.map(n=>(
          <button key={n.id} onClick={()=>{setPage(n.id);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 16px",border:"none",background:page===n.id?T.primaryLt:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:page===n.id?700:500,color:page===n.id?T.primary:T.text}}>
            {n.icon}{n.label}
            {n.badge>0 && <span style={{marginLeft:"auto",background:T.danger,color:"#fff",borderRadius:8,fontSize:10,fontWeight:700,padding:"2px 6px"}}>{n.badge}</span>}
          </button>
        ))}
      </div>}
      <nav className="mob-bottom-nav" style={{position:"fixed",bottom:16,left:0,right:0,background:T.bgCard,borderTop:`1px solid ${T.border}`,zIndex:100,display:"flex",alignItems:"center",paddingTop:6,paddingBottom:4}}>
        {items.map(item=>{
          const isMore = item.id==="__more";
          const active = isMore ? moreOpen : page===item.id;
          return (
            <button key={item.id} onClick={()=>isMore?setMoreOpen(v=>!v):setPage(item.id)} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",gap:4,flex:1,paddingTop:0,border:"none",background:"none",cursor:"pointer",fontFamily:"inherit",color:active?T.primary:T.textMuted,transition:"color .15s"}}>
              <div style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                <I name={item.icon} size={22} style={{strokeWidth: active ? 2.5 : 1.8}}/>
                {item.badge>0 && !active && <span style={{position:"absolute",top:-4,right:-6,background:T.danger,color:"#fff",borderRadius:8,fontSize:9,fontWeight:700,padding:"1px 4px",minWidth:14,textAlign:"center"}}>{item.badge>99?"99+":item.badge}</span>}
              </div>
              <span style={{fontSize:10,fontWeight:active?T.fw.bolder:T.fw.medium,letterSpacing:-0.2}}>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

export default MobileBottomNav
