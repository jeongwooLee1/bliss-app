import React, { useState } from 'react'
import { T } from '../../lib/constants'
import I from '../common/I'
import useTouchDragSort from '../../hooks/useTouchDragSort'

function AConfirm({ open, title, desc, onOk, onCancel, okLabel="삭제", danger=true }) {
  if (!open) return null;
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
    <div style={{background:"#fff",borderRadius:16,padding:"28px 24px",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
      <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:T.text,marginBottom:6}}>{title}</div>
      {desc&&<div style={{fontSize:T.fs.sm,color:T.textSub,marginBottom:24,lineHeight:1.6}}>{desc}</div>}
      <div style={{display:"flex",gap:10,marginTop:desc?0:20}}>
        <button onClick={onCancel} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid "+T.border,background:"none",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
        <button onClick={onOk} style={{flex:1,padding:"11px",borderRadius:10,border:"none",background:danger?T.danger:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{okLabel}</button>
      </div>
    </div>
  </div>;
}

function ASheet({ open, onClose, title, children, onSave, saveLabel, saving, saveDisabled }) {
  if (!open) return null;
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:540,maxHeight:"88vh",display:"flex",flexDirection:"column",WebkitOverflowScrolling:"touch"}}>
      <div style={{padding:"20px 20px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,borderBottom:"1px solid "+T.gray100}}>
        <div style={{fontSize:T.fs.md,fontWeight:T.fw.black,color:T.text}}>{title}</div>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:"50%",border:"none",background:T.gray100,color:T.gray500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="x" size={14}/></button>
      </div>
      <div style={{padding:"20px",overflowY:"auto",flex:1}}>{children}</div>
      {onSave && <div style={{padding:"12px 20px",borderTop:"1px solid "+T.gray100,flexShrink:0,paddingBottom:"calc(90px + env(safe-area-inset-bottom))"}}><AIBtn onClick={onSave} saving={saving} disabled={saving||saveDisabled} label={saveLabel||"저장"} style={{width:"100%"}}/></div>}
    </div>
  </div>;
}

function AField({ label, required, error, children, hint }) {
  return <div style={{marginBottom:14}}>
    <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:error?T.danger:T.gray500,marginBottom:5,display:"flex",gap:3}}>
      {label}{required&&<span style={{color:T.danger}}>*</span>}
    </div>
    {children}
    {hint&&!error&&<div style={{fontSize:T.fs.nano,color:T.textMuted,marginTop:3}}>{hint}</div>}
    {error&&<div style={{fontSize:T.fs.nano,color:T.danger,marginTop:3}}>{error}</div>}
  </div>;
}

const AInp = {width:"100%",padding:"10px 12px",border:"1.5px solid #e8e8f0",borderRadius:10,fontSize:14,fontFamily:"inherit",color:"#1a1a2e",outline:"none",background:"#fff",boxSizing:"border-box"};

function AEmpty({ icon="plus", message, onAdd, addLabel }) {
  return <div style={{textAlign:"center",padding:"52px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
    <div style={{width:52,height:52,borderRadius:"50%",background:T.gray100,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <I name={icon} size={22} style={{color:T.gray300}}/>
    </div>
    <div style={{fontSize:T.fs.sm,color:T.textMuted}}>{message}</div>
    {onAdd&&<button onClick={onAdd} style={{marginTop:4,padding:"9px 20px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
      <I name="plus" size={14}/>{addLabel||"추가"}
    </button>}
  </div>;
}

function APageHeader({ title, count, onAdd, addLabel="추가", desc }) {
  return <div style={{marginBottom:20}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,display:"flex",alignItems:"baseline",gap:8}}>
        <h2 style={{margin:0,fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text,letterSpacing:"-.5px"}}>{title}</h2>
        {count!=null&&count>0&&<span style={{fontSize:T.fs.sm,color:T.textMuted,fontWeight:T.fw.medium}}>{count}개</span>}
      </div>
      {onAdd&&<button onClick={onAdd} style={{height:34,padding:"0 14px",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <I name="plus" size={14}/>{addLabel}
      </button>}
    </div>
    {desc&&<div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:4}}>{desc}</div>}
  </div>;
}

function AListItem({ left, title, sub, right, onClick, borderBottom=true, ...rest }) {
  const [hov,setHov]=React.useState(false);
  return <div onClick={onClick} onMouseOver={()=>onClick&&setHov(true)} onMouseOut={()=>setHov(false)}
    style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",cursor:onClick?"pointer":"default",
      background:hov&&onClick?T.primaryHover:"transparent",transition:"background .1s",
      borderBottom:borderBottom?"1px solid "+T.gray100:"none"}} {...rest}>
    {left&&<div style={{flexShrink:0}}>{left}</div>}
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
      {sub&&<div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>{sub}</div>}
    </div>
    {right&&<div style={{flexShrink:0}}>{right}</div>}
  </div>;
}

function AToggle({ on, onChange, size="md" }) {
  const w=size==="sm"?36:44,h=size==="sm"?20:24,d=size==="sm"?14:18;
  return <div onClick={()=>onChange&&onChange(!on)} style={{width:w,height:h,borderRadius:h/2,background:on?T.primary:"#d1d5db",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
    <div style={{position:"absolute",top:(h-d)/2,left:on?w-d-(h-d)/2:(h-d)/2,width:d,height:d,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
  </div>;
}

function AColorDot({ color, size=20 }) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:color||"#e8e8f0",border:"2px solid rgba(0,0,0,.06)",flexShrink:0}}/>;
}

function ABadge({ children, color=T.primary, bg, style={} }) {
  return <div style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:20,fontSize:T.fs.nano,fontWeight:T.fw.bolder,color,background:bg||(color+"1a"),...style}}>{children}</div>;
}

const PALETTE=["#7c7cc8","#e17055","#00b894","#f39c12","#0984e3","#fd79a8","#6c5ce7","#00cec9","#636e72","#2d3436"];

function APalette({ value, onChange }) {
  return <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    {PALETTE.map(c=><div key={c} onClick={()=>onChange(c)}
      style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",
        outline:value===c?"3px solid "+T.text:"3px solid transparent",outlineOffset:2,transition:"outline .1s"}}/>)}
  </div>;
}

function AIBtn({ onClick, disabled, saving, label, style={} }) {
  return <button onClick={onClick} disabled={disabled}
    style={{width:"100%",padding:"12px",borderRadius:10,border:"none",
      background:disabled?"#e8e8f0":T.primary,color:disabled?T.gray400:"#fff",
      fontSize:T.fs.sm,fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",
      display:"flex",alignItems:"center",justifyContent:"center",gap:8,...style}}>
    {saving&&<div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.4)",borderTopColor:"#fff",animation:"spin 1s linear infinite"}}/>}
    {label}
  </button>;
}

export { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AListItem, AToggle, AColorDot, ABadge, APalette, AIBtn, PALETTE, useTouchDragSort }
