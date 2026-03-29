/**
 * 공통 UI 컴포넌트 라이브러리
 * AppShell, ReservationsPage 등에서 중복 정의되던 컴포넌트를 통합
 */
import React from 'react'
import { T } from '../../lib/constants'

// ── Utilities ──
export const fmt = (n) => n == null ? "0" : Number(n).toLocaleString("ko-KR");

// ── Layout ──
export const GridLayout = ({ cols=2, gap=12, children, style={}, ...p }) => {
  const gc = typeof cols === "number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:gc,gap,...style}} {...p}>{children}</div>;
};

// ── Button ──
export const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={}, ...p }) => {
  const base = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
    border:"none", borderRadius:T.radius.md, cursor:disabled?"not-allowed":"pointer",
    fontFamily:"inherit", fontWeight:T.fw.bold, transition:"opacity .15s",
    opacity: disabled ? 0.5 : 1 };
  const sizes = { sm:{padding:"4px 10px",fontSize:T.fs.sm}, md:{padding:"7px 14px",fontSize:T.fs.md}, lg:{padding:"10px 20px",fontSize:T.fs.lg} };
  const variants = {
    primary:   { background:T.primary,   color:T.bgCard },
    secondary: { background:T.gray200,   color:T.gray800 },
    danger:    { background:T.danger,    color:T.bgCard },
    ghost:     { background:"transparent", color:T.primary, border:`1px solid ${T.border}` },
    outline:   { background:"transparent", color:T.primary, border:`1px solid ${T.primary}` },
  };
  return <button onClick={disabled?undefined:onClick} style={{...base,...sizes[size],...variants[variant],...style}} {...p}>{children}</button>;
};

// ── Loading / Spinner ──
export function Spinner({size=20}) {
  return <div style={{width:size,height:size,border:`2px solid ${T.primaryLt}`,borderTop:`2px solid ${T.primary}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}></div>;
}
export function Loading({msg}) {
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100dvh",gap:12,color:T.textSub,fontSize:T.fs.md}}>
    <Spinner size={28}/>
    <div>{msg||"로딩 중..."}</div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
  </div>;
}

// ── Empty State ──
export const Empty = ({icon, msg, children}) => (
  <div style={{textAlign:"center",padding:"40px 20px",color:T.textMuted}}>
    {icon && <div style={{fontSize:32,marginBottom:8}}>{icon}</div>}
    <div style={{fontSize:T.fs.sm}}>{msg||"데이터가 없습니다"}</div>
    {children}
  </div>
);

// ── Badge / Tag / Chip ──
export const Badge = ({children, color=T.primary, bg, style={}}) => (
  <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,color:color,background:bg||color+"18",...style}}>{children}</span>
);
export const Tag = ({children, color=T.primary, style={}}) => (
  <span style={{display:"inline-block",fontSize:10,fontWeight:600,padding:"1px 5px",borderRadius:3,color:color,background:color+"15",...style}}>{children}</span>
);
export const Chip = ({label, onRemove, color=T.primary}) => (
  <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:12,color,background:color+"12",border:`1px solid ${color}30`}}>
    {label}
    {onRemove && <span onClick={onRemove} style={{cursor:"pointer",fontWeight:800,fontSize:13,lineHeight:1}}>×</span>}
  </span>
);

// ── Modal ──
export const Modal = ({children, onClose, width=480, style={}}) => (
  <div className="ov" style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.4)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
    <div className="modal" style={{background:T.bgCard,borderRadius:T.radius.xl,width,maxWidth:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:T.shadow.lg,padding:20,...style}} onClick={e=>e.stopPropagation()}>
      {children}
    </div>
  </div>
);

// ── StatCard ──
export const StatCard = ({ label, value, sub, color }) => (
  <div style={{background:T.bgCard,borderRadius:T.radius.md,padding:"14px 16px",boxShadow:T.shadow.sm,borderLeft:`3px solid ${color||T.primary}`}}>
    <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:4}}>{label}</div>
    <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:color||T.text}}>{value}</div>
    {sub && <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>{sub}</div>}
  </div>
);

// ── DataTable ──
export function DataTable({ cols=[], rows=[], onRow, card=true, children }) {
  const thS = {padding:"7px 10px",background:T.gray100,borderBottom:"1px solid "+T.border,textAlign:"left",fontWeight:600,fontSize:12,whiteSpace:"nowrap"};
  const tdS = {padding:"7px 10px",borderBottom:"1px solid "+T.border,fontSize:13,verticalAlign:"middle"};
  if (children) {
    return <div style={{overflowX:"auto",borderRadius:T.radius.md,border:"1px solid "+T.border}}>
      <style>{`.bliss-tbl th{padding:7px 10px;background:${T.gray100};border-bottom:1px solid ${T.border};text-align:left;font-weight:600;font-size:12px;white-space:nowrap}.bliss-tbl td{padding:7px 10px;border-bottom:1px solid ${T.border};font-size:13px;vertical-align:middle}.bliss-tbl tbody tr:last-child td{border-bottom:none}.bliss-tbl tbody tr:hover{background:${T.gray100}}`}</style>
      <table className="bliss-tbl" style={{width:"100%",borderCollapse:"collapse"}}>{children}</table>
    </div>;
  }
  return <div style={{overflowX:"auto",...(card?{borderRadius:T.radius.md,border:"1px solid "+T.border}:{})}}>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead><tr>{cols.map((c,i) => <th key={i} style={{...thS,...(c.style||{})}}>{c.label||c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r,ri) => (
          <tr key={ri} onClick={()=>onRow?.(r,ri)} style={{cursor:onRow?"pointer":"default"}}>
            {cols.map((c,ci) => <td key={ci} style={{...tdS,...(c.tdStyle||{})}}>{c.render?c.render(r,ri):r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

// ── Form Field ──
export const FLD = ({label, children, style={}}) => (
  <div style={{marginBottom:10,...style}}>
    {label && <label style={{display:"block",fontSize:T.fs.xs,fontWeight:T.fw.bold,color:T.textSub,marginBottom:4}}>{label}</label>}
    {children}
  </div>
);
