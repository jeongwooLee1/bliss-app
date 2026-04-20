import React from 'react'
import { createPortal } from 'react-dom'
import { T, STATUS_CLR_DEFAULT, STATUS_KEYS, STATUS_LABEL } from '../../lib/constants'
import I from '../common/I'

function EyeDrop({ onPick, size=28 }) {
  const pick = async () => {
    if (!window.EyeDropper) return;
    try { const r = await new window.EyeDropper().open(); onPick(r.sRGBHex); } catch(e) {}
  };
  if (!window.EyeDropper) return null;
  return <button onClick={pick} style={{width:size,height:size,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}} title="색상 추출"><I name="eyedropper" size={14} color={T.gray600}/></button>;
}

const GridLayout = ({ cols=2, gap=12, children, style={}, ...p }) => {
  const gc = typeof cols === "number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:gc,gap,...style}} {...p}>{children}</div>;
};

function TimelineSettings({
  showSettings, setShowSettings,
  isMaster, accessibleBids, userBranches, expanded, toggleExpand,
  viewBids, toggleView, allBranchList,
  rowH, setRowH, colW, setColW, blockFs, setBlockFs, blockOp, setBlockOp,
  startHour, setStartHour, endHour, setEndHour,
  timeUnit, setTimeUnit,
  statusClr, setStatusClr,
  tlSharedKeys = {}, setTlSharedKey,
}) {
  // 전지점 공통 토글(🌐)은 대표/관리자(isMaster)만 변경 가능. 일반 직원은 아예 안 보임
  const ShareCheck = ({ k }) => (setTlSharedKey && isMaster) ? (
    <label title="전 지점 공통 적용" style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:9,color:tlSharedKeys[k]?T.primary:T.gray500,cursor:"pointer",marginLeft:6,padding:"1px 5px",borderRadius:4,background:tlSharedKeys[k]?T.primaryLt:"transparent",border:`1px solid ${tlSharedKeys[k]?T.primary:T.border}`,flexShrink:0,fontWeight:tlSharedKeys[k]?700:500}}>
      <input type="checkbox" checked={!!tlSharedKeys[k]} onChange={e=>setTlSharedKey(k, e.target.checked)} style={{accentColor:T.primary,width:11,height:11,margin:0}}/>
      🌐
    </label>
  ) : null;
  if (!showSettings) return null;

  const handleTouchStart = e => {
    const el = e.currentTarget;
    el.dataset.sy = e.touches[0].clientY;
    el.dataset.dragging = "1";
    el.style.transition = "none";
  };
  const handleTouchMove = e => {
    const el = e.currentTarget;
    if (el.dataset.dragging !== "1") return;
    const dy = Math.max(0, e.touches[0].clientY - Number(el.dataset.sy||0));
    el.style.transform = `translateY(${dy}px)`;
    // fade overlay
    const ov = el.previousElementSibling;
    if (ov) ov.style.opacity = Math.max(0, 1 - dy / 300);
  };
  const handleTouchEnd = e => {
    const el = e.currentTarget;
    el.dataset.dragging = "0";
    const dy = e.changedTouches[0].clientY - Number(el.dataset.sy||0);
    if (dy > 80) {
      el.style.transition = "transform .3s cubic-bezier(.4,0,1,1)";
      el.style.transform = `translateY(${el.offsetHeight}px)`;
      const ov = el.previousElementSibling;
      if (ov) { ov.style.transition = "opacity .3s"; ov.style.opacity = "0"; }
      setTimeout(() => setShowSettings(false), 300);
    } else {
      el.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
      el.style.transform = "translateY(0)";
      const ov = el.previousElementSibling;
      if (ov) { ov.style.transition = "opacity .25s"; ov.style.opacity = "1"; }
    }
  };

  return createPortal(<>
    <div style={{position:"fixed",inset:0,width:"100vw",height:"100vh",zIndex:99,background:"rgba(0,0,0,.3)",animation:"ovFadeIn .25s"}} onClick={()=>{
      const p=document.querySelector('[data-settings-panel]');
      const o=document.querySelector('[data-settings-ov]');
      if(p){p.style.transition='transform .3s ease-out';p.style.transform='translateY(100%)';}
      if(o){o.style.transition='opacity .3s';o.style.opacity='0';}
      setTimeout(()=>setShowSettings(false),300);
    }} data-settings-ov/>
    <div
      data-settings-panel
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{position:"fixed",bottom:0,left:0,right:0,width:"100vw",boxSizing:"border-box",
      background:T.bgCard,borderRadius:"16px 16px 0 0",padding:"20px 20px calc(32px + 56px + env(safe-area-inset-bottom))",boxShadow:"0 -8px 32px rgba(0,0,0,.15)",zIndex:100,
      maxHeight:"80vh",overflowY:"auto",overflowX:"hidden",animation:"bottomSheet .4s cubic-bezier(.22,1,.36,1)",willChange:"transform"}}>
      <div style={{width:36,height:4,borderRadius:T.radius.sm,background:T.gray300,margin:"0 auto 16px",cursor:"grab"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}><I name="settings" size={14}/> 타임라인 설정</div>
        {isMaster && <div style={{fontSize:9,color:T.textMuted}}>🌐 = 전 지점 공통 적용</div>}
      </div>
      {/* 지점 보기 토글 - staff만 */}
      {!isMaster && accessibleBids.length > userBranches.length && (
        <div style={{background:T.gray100,borderRadius:T.radius.lg,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.gray700}}>타 지점 보기</div>
            <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>{expanded ? "읽기 권한 있는 전 지점 표시 중" : "내 지점만 표시 중"}</div>
          </div>
          <div onClick={toggleExpand} style={{width:46,height:26,borderRadius:13,background:expanded?T.primary:T.gray300,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:expanded?22:3,width:20,height:20,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.2)",transition:"left .2s"}}/>
          </div>
        </div>
      )}
      {/* 지점별 표시 토글 */}
      {allBranchList && allBranchList.length > 1 && (
        <div style={{background:T.gray100,borderRadius:T.radius.lg,padding:"10px 14px",marginBottom:8}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.gray700,marginBottom:8}}>지점 표시</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {allBranchList.filter(b => isMaster || accessibleBids.includes(b.id)).map(b => {
              const on = (viewBids||[]).includes(b.id);
              return <button key={b.id} onClick={()=>toggleView(b.id)}
                style={{padding:"5px 12px",fontSize:T.fs.sm,border:"1px solid "+(on?T.primary:"#ddd"),borderRadius:T.radius.md,
                  background:on?T.primary:T.bgCard,color:on?"#fff":T.gray600,fontWeight:on?700:400,cursor:"pointer",transition:"all .15s"}}>
                {(b.short||b.name||"").replace(/하우스왁싱\s*/,"")}
              </button>;
            })}
          </div>
        </div>
      )}
      <GridLayout cols={2} gap={8}>
    {[
        {label:"줄간격",key:"rh",val:rowH,dec:()=>setRowH(h=>Math.max(6,h-2)),inc:()=>setRowH(h=>Math.min(30,h+2))},
        {label:"열너비",key:"cw",val:colW,dec:()=>setColW(w=>Math.max(80,w-20)),inc:()=>setColW(w=>Math.min(300,w+20))},
        {label:"글자크기",key:"fs",val:blockFs,dec:()=>setBlockFs(f=>Math.max(6,f-1)),inc:()=>setBlockFs(f=>Math.min(16,f+1))},
        {label:"불투명도",key:"op",val:blockOp,suffix:"%",dec:()=>setBlockOp(o=>Math.max(10,o-10)),inc:()=>setBlockOp(o=>Math.min(100,o+10))},
        {label:"시작시간",key:"sh",val:startHour,suffix:"시",dec:()=>setStartHour(h=>Math.max(0,h-1)),inc:()=>setStartHour(h=>Math.min(endHour-1,h+1))},
        {label:"종료시간",key:"eh",val:endHour,suffix:"시",dec:()=>setEndHour(h=>Math.max(startHour+1,h-1)),inc:()=>setEndHour(h=>Math.min(24,h+1))},
      ].map(r=><div key={r.label} style={{background:T.gray100,borderRadius:T.radius.lg,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:T.fs.sm,color:T.gray700,fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center"}}>{r.label}<ShareCheck k={r.key}/></span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={r.dec} style={{width:32,height:32,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="minus" size={16} color={T.gray700}/></button>
          <span style={{fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,width:36,textAlign:"center"}}>{r.val}{r.suffix||""}</span>
          <button onClick={r.inc} style={{width:32,height:32,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}><I name="plus" size={16} color={T.gray700}/></button>
        </div>
      </div>)}
      </GridLayout>
      <div style={{background:T.gray100,borderRadius:T.radius.lg,padding:"10px 12px",marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:T.fs.sm,color:T.gray700,fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center"}}>시간단위<ShareCheck k="tu"/></span>
        <div style={{display:"flex",gap:T.sp.xs}}>
          {[5,10,15,30,60].map(u=><button key={u} onClick={()=>setTimeUnit(u)}
            style={{padding:"6px 12px",fontSize:T.fs.sm,border:"1px solid #ddd",borderRadius:T.radius.md,background:timeUnit===u?T.primary:T.bgCard,
              color:timeUnit===u?T.bgCard:T.gray600,fontWeight:timeUnit===u?700:400,cursor:"pointer"}}>{u}분</button>)}
        </div>
      </div>

      <div style={{marginTop:8}}>
        <span style={{fontSize:T.fs.sm,color:T.gray700,fontWeight:T.fw.bold,marginBottom:6,display:"inline-flex",alignItems:"center"}}>예약상태 색상<ShareCheck k="sc"/></span>
        <GridLayout cols={2} gap={6}>
          {STATUS_KEYS.map(k=><div key={k} style={{background:T.gray100,borderRadius:T.radius.lg,padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:statusClr[k]}}>{STATUS_LABEL[k]}</span>
            <div style={{display:"flex",alignItems:"center",gap:T.sp.xs}}>
              <input type="color" value={statusClr[k]||STATUS_CLR_DEFAULT[k]} onChange={e=>setStatusClr(k,e.target.value)}
                style={{width:32,height:28,border:"1px solid #ddd",borderRadius:T.radius.md,cursor:"pointer",padding:1}}/>
              <EyeDrop onPick={c=>setStatusClr(k,c)} size={28}/>
            </div>
          </div>)}
        </GridLayout>
      </div>
    </div>
  </>, document.body);
}

export default TimelineSettings
