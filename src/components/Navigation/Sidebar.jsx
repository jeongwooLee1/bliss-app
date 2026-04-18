import React, { useState } from 'react'
import { T } from '../../lib/constants'
import I from '../common/I'
import { Btn } from '../common'
import { TeamChat } from '../Chat'

function Sidebar({ nav, page, setPage, role, branchNames, onLogout, bizName="", isSuper=false, onBackToSuper, serverV, scraperStatus=null, BLISS_V="" }) {
  const [chatOpen, setChatOpen] = useState(true);
  const cats = [
    { label:"예약 관리", items: nav.filter(n=>["timeline","reservations"].includes(n.id)) },
    { label:"고객 관리", items: nav.filter(n=>["customers"].includes(n.id)) },
    { label:"매출 관리", items: nav.filter(n=>["sales"].includes(n.id)) },
    ...(nav.find(n=>n.id==="admin") ? [{ label:"시스템", items: nav.filter(n=>["users","messages","admin","wizard","requests"].includes(n.id)) }] : []),
  ];
  return <>
    <div style={{padding:`${T.sp.md}px ${T.sp.lg}px`,borderBottom:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
        <div style={{flex:1,minWidth:0,cursor:"pointer",userSelect:"none"}} onClick={()=>window.location.reload()} title="새로고침">
          <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:T.primary,letterSpacing:-.5,lineHeight:1.15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{bizName||"Bliss"}</div>
          <div style={{fontSize:T.fs.xs,color:T.textSub,marginTop:2}}>{role==="owner"?"대표 관리자":role==="super"?"슈퍼관리자":role==="manager"?"지점 원장":branchNames||"직원"}</div>
        </div>
        <button onClick={onLogout} title="로그아웃" style={{flexShrink:0,padding:"4px 8px",fontSize:10,fontWeight:T.fw.bolder,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,borderRadius:6,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>로그아웃</button>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10,color:T.textMuted,flexWrap:"wrap"}}>
        <span style={{color:T.danger,fontWeight:T.fw.bolder}}>v{BLISS_V}</span>
        <span style={{color:T.gray400}}>·</span>
        <span style={{color:serverV?"#03C75A":T.textMuted}}>서버 {serverV?`v${serverV}`:"…"}</span>
        {scraperStatus && <>
          <span style={{color:T.gray400}}>·</span>
          <span style={{color:scraperStatus.isWarning?"#E65100":T.textMuted,fontWeight:scraperStatus.isWarning?700:400}} title={scraperStatus.lastScraped?`마지막 스크래핑: ${(()=>{const h=Math.floor(scraperStatus.scrapedDiffH);const m=Math.floor((scraperStatus.scrapedDiffH%1)*60);return h>0?`${h}시간${m>0?` ${m}분`:""} 전`:`${m}분 전`;})()}`:"스크래핑 기록 없음"}>
            {scraperStatus.isWarning?"⚠️":"✅"}
          </span>
        </>}
        {isSuper && <button onClick={onBackToSuper} style={{marginLeft:"auto",fontSize:10,padding:"2px 6px",border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,borderRadius:4,cursor:"pointer",fontFamily:"inherit"}}>← 관리자</button>}
      </div>
    </div>
    <div style={{flex:1,padding:"8px 0",overflowY:"auto"}}>
      {cats.map((cat,ci) => (
        <div key={ci}>
          <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.gray500,padding:`12px ${T.sp.lg}px 4px`,letterSpacing:.5}}>{cat.label}</div>
          {cat.items.map(n=>(
            <button key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",alignItems:"center",gap:10,padding:`9px ${T.sp.lg}px`,border:"none",cursor:"pointer",fontSize:T.fs.sm,fontWeight:page===n.id?T.fw.bolder:T.fw.normal,
              background:page===n.id?T.primaryHover:"transparent",color:page===n.id?T.primaryDk:T.gray700,
              borderLeft:page===n.id?`3px solid ${T.primary}`:"3px solid transparent",
              fontFamily:"inherit",width:"100%",textAlign:"left",transition:"all .1s"}}>
              <span style={{width:20,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{n.icon}</span>
              <span style={{flex:1}}>{n.label}</span>
              {n.badge>0&&<span style={{background:T.danger,color:"#fff",borderRadius:10,fontSize:10,fontWeight:700,padding:"1px 6px",minWidth:18,textAlign:"center"}}>{n.badge>99?"99+":n.badge}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
    <div style={{borderTop:`2px solid ${T.primary}`,display:"flex",flexDirection:"column",flexShrink:0,height:chatOpen?420:36,transition:"height .15s"}}>
      <button onClick={()=>setChatOpen(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",border:"none",background:T.primaryLt,color:T.primaryDk,fontSize:T.fs.xs,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit",textAlign:"left",letterSpacing:.3}}>
        <I name={chatOpen?"chevD":"chevR"} size={12}/> 팀 채팅
      </button>
      {chatOpen && <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column"}}><TeamChat mock/></div>}
    </div>
  </>;
}

export default Sidebar
