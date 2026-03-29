import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, BRANCH_DEFAULT_COLORS, branchColor, STATUS_LABEL, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../lib/sb'
import { supabase as _supaClient } from '../lib/supabase'
import { fromDb, toDb, resolveSystemIds, setActiveBiz, _activeBizId } from '../lib/db'
import Timeline from '../components/Timeline/TimelinePage'
import ReservationList, { SmartDatePicker } from '../components/Reservations/ReservationsPage'
import AdminInbox from '../components/Messages/MessagesPage'
import { todayStr, pad, fmtDate, getDow, genId, fmtLocal } from '../lib/utils'
import I from '../components/common/I'
import TimelineModal, { DetailedSaleForm } from '../components/Timeline/ReservationModal'
import SchedulePage from '../components/Schedule/SchedulePage'
import { AdminPage, UsersPage as UsersPageReal } from '../components/Reservations/ReservationsPage'

const uid = genId;
const BLISS_V = "1.2.0"
const BIZ_ID = 'biz_khvurgshb'

const fmt = (n) => n == null ? "0" : Number(n).toLocaleString("ko-KR");

const GridLayout = ({ cols=2, gap=12, children, style={}, ...p }) => {
  const gc = typeof cols === "number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:gc,gap,...style}} {...p}>{children}</div>;
};

const StatCard = ({ label, value, sub, color }) => (
  <div style={{background:T.bgCard,borderRadius:T.radius.md,padding:"14px 16px",boxShadow:T.shadow.sm,borderLeft:`3px solid ${color||T.primary}`}}>
    <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:4}}>{label}</div>
    <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:color||T.text}}>{value}</div>
    {sub && <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>{sub}</div>}
  </div>
);

function Spinner({size=20}) {
  return <div style={{width:size,height:size,border:`2px solid ${T.primaryLt}`,borderTop:`2px solid ${T.primary}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}></div>;
}
function Loading({msg}) {
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100dvh",gap:12,color:T.textSub,fontSize:T.fs.md}}>
    <Spinner size={28}/>
    <div>{msg||"로딩 중..."}</div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
  </div>;
}


const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={}, ...p }) => {
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

function DataTable({ cols=[], rows=[], onRow, card=true, children }) {
  const thS = {padding:"7px 10px",background:T.gray100,borderBottom:"1px solid "+T.border,textAlign:"left",fontWeight:600,fontSize:12,whiteSpace:"nowrap"};
  const tdS = {padding:"7px 10px",borderBottom:"1px solid "+T.border,fontSize:13,verticalAlign:"middle"};
  if (children) {
    return <div style={{overflowX:"auto",borderRadius:T.radius.md,border:"1px solid "+T.border}}>
      <style>{`.bliss-tbl th{padding:7px 10px;background:${T.gray100};border-bottom:1px solid ${T.border};text-align:left;font-weight:600;font-size:12px;white-space:nowrap}.bliss-tbl td{padding:7px 10px;border-bottom:1px solid ${T.border};font-size:13px;vertical-align:middle}.bliss-tbl tbody tr:last-child td{border-bottom:none}.bliss-tbl tbody tr:hover{background:${T.gray100}}`}</style>
      <table className="bliss-tbl" style={{width:"100%",borderCollapse:"collapse"}}>{children}</table>
    </div>;
  }
  return <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
    <thead><tr>{cols.map(c=><th key={c.key} style={thS}>{c.label}</th>)}</tr></thead>
    <tbody>{(rows||[]).map((r,i)=><tr key={i} onClick={()=>onRow&&onRow(r)} style={{cursor:onRow?"pointer":"default",borderBottom:"1px solid "+T.border}}>{cols.map(c=><td key={c.key} style={{padding:"7px 10px"}}>{r[c.key]}</td>)}</tr>)}</tbody>
  </table></div>;
}
async function loadAllFromDb(bizId) {
  const [branches, services, categories, tags, sources, users, rooms, customers, reservations, sales, products] = await Promise.all([
    sb.getByBiz("branches", bizId).catch(()=>[]),
    sb.getByBiz("services", bizId).catch(()=>[]),
    sb.getByBiz("service_categories", bizId).catch(()=>[]),
    sb.getByBiz("service_tags", bizId).catch(()=>[]),
    sb.getByBiz("reservation_sources", bizId).catch(()=>[]),
    sb.getByBiz("app_users", bizId).catch(()=>[]),
    sb.getByBiz("rooms", bizId).catch(()=>[]),
    sb.get("customers", `&business_id=eq.${bizId}&is_hidden=eq.false&order=created_at.desc&limit=500`).catch(()=>[]),
    sb.get("reservations", `&business_id=eq.${bizId}&order=date.desc,time.asc&limit=3000`).catch(()=>[]),
    sb.get("sales", `&business_id=eq.${bizId}&date=gte.${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}&order=date.desc&limit=5000`).catch(()=>[]),
    sb.getByBiz("products", bizId).catch(()=>[]),
  ]);
  return {
    branches: fromDb("branches", branches),
    services: fromDb("services", services),
    cats: fromDb("service_categories", categories),
    serviceTags: fromDb("service_tags", tags),
    resSources: fromDb("reservation_sources", sources),
    users: fromDb("app_users", users),
    rooms,
    customers: fromDb("customers", customers),
    reservations: fromDb("reservations", reservations),
    sales: fromDb("sales", sales),
    products: fromDb("services", products),
  };
}
function SuperDashboard({ superData, setSuperData, currentUser, onLogout, onEnterBiz }) {
  const [tab, setTab] = useState("businesses");
  const { businesses=[], groups=[], groupMembers=[], users=[] } = superData || {};

  // ── Business CRUD ──
  const [bizForm, setBizForm] = useState(null);
  const saveBiz = async () => {
    if (!bizForm?.name || !bizForm?.code) return alert("업체명과 대표 아이디를 입력하세요");
    const isNew = !bizForm.id;
    const biz = isNew ? { ...bizForm, id: "biz_" + genId() } : bizForm;
    if (isNew) {
      await sb.insert("businesses", { id:biz.id, name:biz.name, code:biz.code, phone:biz.phone||"", settings:biz.settings||"" });
      const ownerId = "acc_" + genId();
      await sb.insert("app_users", { id:ownerId, business_id:biz.id, login_id:biz.code, password:"1234", name:biz.name+" 대표", role:"owner", branch_ids:"[]", view_branch_ids:"[]" });
      // Auto-assign group if selected
      if (bizForm.groupId) {
        const gm = { id:"gm_"+genId(), group_id:bizForm.groupId, business_id:biz.id };
        await sb.insert("business_group_members", gm);
        setSuperData(p => ({...p, businesses:[...p.businesses, biz], users:[...p.users, {id:ownerId, businessId:biz.id, loginId:biz.code, pw:"1234", name:biz.name+" 대표", role:"owner", branches:[], viewBranches:[]}], groupMembers:[...p.groupMembers, gm]}));
      } else {
        setSuperData(p => ({...p, businesses:[...p.businesses, biz], users:[...p.users, {id:ownerId, businessId:biz.id, loginId:biz.code, pw:"1234", name:biz.name+" 대표", role:"owner", branches:[], viewBranches:[]}]}));
      }
    } else {
      await sb.update("businesses", biz.id, { name:biz.name, code:biz.code, phone:biz.phone||"", settings:biz.settings||"" });
      // Update group membership
      const curMem = groupMembers.find(m=>m.business_id===biz.id);
      if (bizForm.groupId && (!curMem || curMem.group_id!==bizForm.groupId)) {
        if (curMem) await sb.del("business_group_members", curMem.id);
        const gm = { id:"gm_"+genId(), group_id:bizForm.groupId, business_id:biz.id };
        await sb.insert("business_group_members", gm);
        setSuperData(p => ({...p, businesses:p.businesses.map(b=>b.id===biz.id?biz:b), groupMembers:[...(p?.groupMembers||[]).filter(m=>m.business_id!==biz.id), gm]}));
      } else if (!bizForm.groupId && curMem) {
        await sb.del("business_group_members", curMem.id);
        setSuperData(p => ({...p, businesses:p.businesses.map(b=>b.id===biz.id?biz:b), groupMembers:(p?.groupMembers||[]).filter(m=>m.business_id!==biz.id)}));
      } else {
        setSuperData(p => ({...p, businesses:p.businesses.map(b=>b.id===biz.id?biz:b)}));
      }
    }
    setBizForm(null);
  };
  const deleteBiz = async (id) => {
    if (!confirm("이 사업자를 삭제하시겠습니까? 모든 데이터가 삭제됩니다.")) return;
    await sb.del("businesses", id);
    setSuperData(p => ({...p, businesses:(p?.businesses||[]).filter(b=>b.id!==id)}));
  };
  const seedBizTemplates = async (bizId) => {
    const prefix = bizId.replace("biz_","");
    const br = { id:`br_${prefix}_1`, business_id:bizId, name:"본점", short:"본점", phone:"", address:"", color:T.bgCard, sort:0, use_yn:true };
    await sb.insert("branches", br);
    await sb.insert("rooms", { id:`rm_${prefix}_1`, business_id:bizId, branch_id:br.id, name:"담당자1", color:"", sort_order:0 });
    const cats = ["왁싱","페이셜","바디","기타"];
    for (let i=0;i<cats.length;i++) await sb.insert("service_categories", { id:`cat_${prefix}_${i}`, business_id:bizId, name:cats[i], sort:i });
    alert("기본 템플릿이 등록되었습니다.");
  };
  const startEditBiz = (b) => {
    const curMem = groupMembers.find(m=>m.business_id===b.id);
    setBizForm({...b, groupId: curMem?.group_id||""});
  };

  // ── Group quick-add (inline) ──
  const [newGrp, setNewGrp] = useState("");
  const addGroup = async () => {
    if (!newGrp.trim()) return;
    const grp = { id:"grp_"+genId(), name:newGrp.trim(), memo:"" };
    await sb.insert("business_groups", grp);
    setSuperData(p => ({...p, groups:[...p.groups, grp]}));
    setNewGrp("");
  };

  const [sideOpen, setSideOpen] = useState(false);
  const tabs = [{id:"businesses",label:<><I name="building" size={15}/> 업체 관리</>},{id:"users",label:<><I name="user" size={15}/> 사용자</>},{id:"settings",label:<><I name="settings" size={15}/> 시스템 설정</>}];

  const SideContent = () => <>
    <div style={{padding:"20px 16px 16px",borderBottom:"1px solid "+T.border}}>
      <div style={{fontSize:T.fs.xxl,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>Bliss</div>
      <div style={{fontSize:T.fs.xxs,color:T.textSub,marginTop:4}}>슈퍼관리자 · {currentUser?.name}</div>
    </div>
    <div style={{flex:1,padding:"12px 0"}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>{setTab(t.id);setSideOpen(false)}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",border:"none",cursor:"pointer",fontSize:T.fs.sm,fontWeight:tab===t.id?700:400,
          background:tab===t.id?T.primaryHover:"transparent",color:tab===t.id?T.primary:T.gray700,
          borderLeft:tab===t.id?"3px solid #7c7cc8":"3px solid transparent",
          fontFamily:"inherit",width:"100%",textAlign:"left"}}>{t.label}</button>
      ))}
    </div>
    <div style={{padding:12,borderTop:"1px solid "+T.border}}>
      <button onClick={onLogout} style={{width:"100%",padding:"8px 14px",borderRadius:T.radius.sm,border:"1px solid #d0d0d0",background:T.bgCard,color:T.textSub,cursor:"pointer",fontSize:T.fs.sm,fontWeight:T.fw.bold,fontFamily:"inherit"}}>로그아웃</button>
    </div>
  </>;

  return (
    <div style={{display:"flex",height:"100dvh",fontFamily:"'Pretendard',sans-serif",background:T.gray100,position:"fixed",top:0,left:0,right:0,bottom:0}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      {/* Desktop sidebar */}
      <aside className="sidebar-d" style={{width:220,background:T.bgCard,borderRight:"1px solid "+T.border,display:"flex",flexDirection:"column"}}>
        <SideContent/>
      </aside>
      {/* Mobile sidebar overlay */}
      {sideOpen && <div className="sidebar-m" style={{position:"fixed",inset:0,zIndex:300}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={()=>setSideOpen(false)}/>
        <div style={{position:"relative",width:260,height:"100%",background:T.bgCard,display:"flex",flexDirection:"column",animation:"slideIn .5s cubic-bezier(.22,1,.36,1)"}}>
          <SideContent/>
        </div>
      </div>}
      <main className="main-c" style={{flex:1,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",paddingBottom:0}}>
        {/* Mobile header */}
        <div className="mob-hdr" style={{padding:"10px 16px",background:T.bgCard,borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",gap:T.sp.md,justifyContent:"space-between"}}>
          <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.primary}}>Bliss 슈퍼관리자</span>
          <span style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.danger}}>v{BLISS_V}</span>
        </div>
        <div className="page-pad" style={{flex:1,padding:24,overflow:"auto",WebkitOverflowScrolling:"touch"}}>
        {/* ── 업체 관리 ── */}
        {tab==="businesses" && <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
            <h2 style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text}}><I name="building" size={18}/> 업체 관리</h2>
            <span style={{fontSize:T.fs.sm,color:T.textSub}}>{businesses.length}개 업체</span>
            <Btn variant="primary" style={{marginLeft:"auto"}} onClick={()=>setBizForm({name:"",code:"",phone:"",memo:"",groupId:""})}><I name="plus" size={12}/> 업체 추가</Btn>
          </div>
          {bizForm && <div className="card" style={{padding:16,marginBottom:16}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
              <FLD label="업체명"><input className="inp" style={{width:"100%",maxWidth:160}} value={bizForm.name} onChange={e=>setBizForm({...bizForm,name:e.target.value})} placeholder="업체명 입력"/></FLD>
              <FLD label="대표 아이디"><input className="inp" style={{width:"100%",maxWidth:140}} value={bizForm.code} onChange={e=>setBizForm({...bizForm,code:e.target.value.toLowerCase().replace(/[^a-z0-9]/g,"")})} placeholder="영문소문자+숫자"/></FLD>
              <FLD label="전화"><input className="inp" style={{width:"100%",maxWidth:140}} value={bizForm.phone||""} onChange={e=>setBizForm({...bizForm,phone:e.target.value})} placeholder="02-0000-0000"/></FLD>
              <FLD label="그룹">
                <div style={{display:"flex",gap:T.sp.xs}}>
                  <select className="inp" style={{width:"100%",maxWidth:130}} value={bizForm.groupId||""} onChange={e=>setBizForm({...bizForm,groupId:e.target.value})}>
                    <option value="">없음</option>
                    {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <div style={{display:"flex",gap:2}}>
                    <input className="inp" style={{width:80,fontSize:T.fs.xs,padding:"4px 6px"}} value={newGrp} onChange={e=>setNewGrp(e.target.value)} placeholder="새 그룹" onKeyDown={e=>e.key==="Enter"&&addGroup()}/>
                    <Btn variant="secondary" style={{padding:"2px 6px",fontSize:T.fs.xs}} onClick={addGroup}>+</Btn>
                  </div>
                </div>
              </FLD>
              <FLD label="메모"><input className="inp" style={{width:"100%",maxWidth:160}} value={ (() => { try { const m=JSON.parse(bizForm.settings||"{}"); return m.gemini_key ? "" : (bizForm.settings||""); } catch { return bizForm.settings||""; } })() } onChange={e=>{ try { const m=JSON.parse(bizForm.settings||"{}"); if(m.gemini_key){setBizForm({...bizForm,settings:JSON.stringify({...m,_note:e.target.value})});}else{setBizForm({...bizForm,settings:e.target.value});} } catch { setBizForm({...bizForm,settings:e.target.value}); } }} placeholder="메모"/></FLD>
              <Btn variant="primary" onClick={saveBiz}>{bizForm.id?"저장":"추가"}</Btn>
              <Btn variant="secondary" onClick={()=>setBizForm(null)}>취소</Btn>
            </div>
            {!bizForm.id && <div style={{marginTop:8,fontSize:T.fs.xxs,color:T.gray500}}>* 대표 아이디로 대표 계정이 자동 생성됩니다 (초기 비밀번호: 1234)</div>}
          </div>}
          <DataTable card><thead><tr>
              <th>업체명</th><th>대표 아이디</th><th>전화</th><th>그룹</th><th>계정수</th><th>메모</th><th>관리</th>
            </tr></thead><tbody>
              {businesses.map(b=>{
                const bizUsers = users.filter(u=>u.businessId===b.id);
                const grps = groupMembers.filter(m=>m.business_id===b.id).map(m=>groups.find(g=>g.id===m.group_id)?.name).filter(Boolean);
                return <tr key={b.id}>
                  <td style={{fontWeight:T.fw.bolder}}>{b.name}</td>
                  <td style={{color:T.primary,fontFamily:"monospace",fontSize:T.fs.sm}}>{b.code}</td>
                  <td style={{fontSize:T.fs.sm,color:T.textSub}}>{b.phone||"-"}</td>
                  <td>{grps.length>0 ? <span style={{fontSize:T.fs.xs,color:T.info,background:"#5cb5c520",padding:"2px 8px",borderRadius:T.radius.md}}>{grps.join(", ")}</span> : <span style={{color:T.gray400}}>-</span>}</td>
                  <td style={{color:T.textSub}}>{bizUsers.length}명</td>
                  <td style={{fontSize:T.fs.sm,color:T.textSub}}>{ (() => { try { const m=JSON.parse(b.settings||"{}"); return m.gemini_key ? <span style={{color:T.gray400,fontStyle:"italic"}}>설정값</span> : (b.settings||"-"); } catch { return b.settings||"-"; } })() }</td>
                  <td style={{display:"flex",gap:T.sp.xs}}>
                    <Btn variant="primary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>onEnterBiz(b.id)}>접속</Btn>
                    <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>startEditBiz(b)}>수정</Btn>
                    <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>seedBizTemplates(b.id)}>템플릿</Btn>
                    <Btn variant="danger" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>deleteBiz(b.id)}>삭제</Btn>
                  </td>
                </tr>;
              })}
              {businesses.length===0 && <tr><td colSpan={7} style={{textAlign:"center",color:T.gray500,padding:40}}>등록된 업체가 없습니다</td></tr>}
            </tbody></DataTable>
        </div>}

        {/* ── 사용자 ── */}
        {tab==="users" && <SuperUsers users={users} businesses={businesses} superData={superData} setSuperData={setSuperData}/>}
        {tab==="settings" && <SuperSystemSettings/>}
        </div>
      </main>
    </div>
  );
}

function FLD({ label, children }) {
  return <div><label style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.textSub,marginBottom:5,display:"block"}}>{label}</label>{children}</div>;
}
function Login({ users, onLogin, onSignup }) {
  const [showSignup, setShowSignup] = useState(false);
  const [loginId, setLoginId] = useState(() => {try{return localStorage.getItem("savedLoginId")||"";}catch(e){return "";}});
  const [pw, setPw] = useState("");
  const [saveId, setSaveId] = useState(() => {try{return localStorage.getItem("savedLoginId")!==null;}catch(e){return false;}});
  const [err, setErr] = useState("");
  const handleLogin = () => {
    const u = users.find(u => (u.loginId||u.login_id) === loginId && (u.pw||u.password) === pw);
    if (!u) { setErr("아이디 또는 비밀번호가 일치하지 않습니다."); return; }
    try{if(saveId)localStorage.setItem("savedLoginId",loginId);else localStorage.removeItem("savedLoginId");}catch(e){}
    onLogin(u);
  };
  const bgGrad = "linear-gradient(135deg,#e8e8f0 0%,#d8d8e8 50%,#c8c8d8 100%)";
  const cardStyle = {background:T.bgCard,borderRadius:T.radius.lg,border:`1px solid ${T.border}`,boxShadow:T.shadow.md,animation:"slideUp .6s cubic-bezier(.22,1,.36,1)"};
  if (showSignup) return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,overflowY:"auto",WebkitOverflowScrolling:"touch",background:bgGrad,fontFamily:"'Pretendard',sans-serif",padding:"20px 16px 80px",boxSizing:"border-box",zIndex:9999}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      <div style={{...cardStyle,padding:"28px 24px",width:"92%",maxWidth:460,marginTop:20}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:T.fs.xxl,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>Bliss</div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:4}}>신규 가입</div>
        </div>
        <SignupWizard onComplete={(newUser)=>{ setShowSignup(false); onSignup(newUser); }} onBack={()=>setShowSignup(false)}/>
      </div>
    </div>
  );
  return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:bgGrad,fontFamily:"'Pretendard',sans-serif",padding:T.sp.lg}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      <div style={{...cardStyle,padding:"32px 28px",width:"92%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:28,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>Bliss</div>
          <div style={{fontSize:T.fs.sm,color:T.textMuted,marginTop:T.sp.sm}}>통합 예약 & 매출 관리 시스템</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <FLD label="아이디"><input className="inp" placeholder="아이디 입력" value={loginId} onChange={e=>{setLoginId(e.target.value);setErr("")}}/></FLD>
          <FLD label="비밀번호"><input className="inp" type="password" placeholder="비밀번호 입력" value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/></FLD>
          {err && <div style={{fontSize:T.fs.sm,color:T.danger,textAlign:"center"}}>{err}</div>}
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:T.fs.sm,color:T.textSub,cursor:"pointer"}}>
            <input type="checkbox" checked={saveId} onChange={e=>setSaveId(e.target.checked)} style={{accentColor:T.primary,width:14,height:14}}/>
            아이디 저장
          </label>
          <Btn onClick={handleLogin} style={{width:"100%",padding:13,fontSize:T.fs.lg,marginTop:4}}>로그인</Btn>
          <div style={{borderTop:`1px solid ${T.gray200}`,marginTop:T.sp.sm,paddingTop:T.sp.md,textAlign:"center"}}>
            <span style={{fontSize:T.fs.sm,color:T.textMuted}}>아직 계정이 없으신가요? </span>
            <button onClick={()=>setShowSignup(true)} style={{background:"none",border:"none",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>무료 체험 시작 →</button>
          </div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,textAlign:"center",marginTop:4}}>앱 v{BLISS_V}</div>
        </div>
      </div>
    </div>
  );
}

// Stub 컴포넌트 (별도 페이지로 이식 전 임시)
const sx = {
  // 레이아웃
  flex:        (gap=0) => ({ display:"flex", alignItems:"center", gap }),
  flexBetween: (gap=0) => ({ display:"flex", alignItems:"center", justifyContent:"space-between", gap }),
  flexCenter:  { display:"flex", alignItems:"center", justifyContent:"center" },
  flexCol:     (gap=0) => ({ display:"flex", flexDirection:"column", gap }),
  // 텍스트 자르기
  ellipsis:    { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  // 텍스트 스타일
  label:       { fontSize:T.fs.xxs, fontWeight:T.fw.bolder, color:T.textSub, letterSpacing:.3 },
  caption:     { fontSize:T.fs.nano, color:T.textMuted },
  title:       { fontSize:T.fs.md,  fontWeight:T.fw.bolder, color:T.text },
  // 성별
  genderBadge: (g) => ({
    fontSize:T.fs.nano, fontWeight:T.fw.bolder, borderRadius:T.radius.sm, padding:"1px 4px",
    background: g==="M" ? T.maleLt : T.femaleLt,
    color:      g==="M" ? T.male   : T.female,
  }),
  // 입력
  inputBase:   {
    width:"100%", height:36, borderRadius:T.radius.md, border:"1px solid "+T.border,
    padding:"0 12px", fontSize:T.fs.sm, outline:"none", boxSizing:"border-box",
    fontFamily:"inherit", color:T.text, background:T.bgCard,
  },
};

function SalesPage({ data, setData, userBranches, isMaster, setPage }) {
  const dateAnchorRef = React.useRef(null);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [periodKey, setPeriodKey] = useState("1day");
  const [showSheet, setShowSheet] = useState(false);
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const inRange = (date) => {
    if (periodKey==="all" || (!startDate && !endDate)) return true;
    if (startDate && endDate) return date >= startDate && date <= endDate;
    return true;
  };

  const sales = (data?.sales||[]).filter(s => {
    if (!(vb==="all" ? userBranches.includes(s.bid) : s.bid===vb)) return false;
    if (q) {
      const sq = q.toLowerCase();
      return (s.custName||"").toLowerCase().includes(sq) ||
             (s.custPhone||"").includes(sq) ||
             (s.staffName||"").toLowerCase().includes(sq) ||
             (s.custNum||"").includes(sq) ||
             (s.memo||"").toLowerCase().includes(sq);
    }
    return inRange(s.date);
  });

  const totals = sales.reduce((a,s) => {
    const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
    return {
      svc:  a.svc+sv,  svcCash:a.svcCash+s.svcCash, svcTransfer:a.svcTransfer+s.svcTransfer,
      svcCard:a.svcCard+s.svcCard, svcPoint:a.svcPoint+s.svcPoint,
      prod: a.prod+pr, prodCash:a.prodCash+s.prodCash, prodTransfer:a.prodTransfer+s.prodTransfer,
      prodCard:a.prodCard+s.prodCard, prodPoint:a.prodPoint+s.prodPoint,
      gift: a.gift+(s.gift||0), total: a.total+sv+pr+(s.gift||0),
    };
  }, {svc:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prod:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0,gift:0,total:0});

  const handleDelete = (id) => { setData(prev=>({...prev,sales:(prev?.sales||[]).filter(s=>s.id!==id)})); sb.del("sales",id).catch(console.error); };
  const handleSave   = (item) => { setData(prev=>({...prev,sales:[...prev.sales,item]})); sb.insert("sales",toDb("sales",item)).catch(console.error); setShowModal(false); };
  const handleEditSave = (item) => {
    const fi = {...item, id:editSale.id};
    setData(prev=>({...prev, sales:(prev?.sales||[]).map(s=>s.id===editSale.id?fi:s)}));
    sb.update("sales",editSale.id,toDb("sales",fi)).catch(console.error);
    setEditSale(null);
  };

  // 날짜 표시 포맷
  const fmtShort = (ds) => {
    if (!ds) return "";
    const d = new Date(ds);
    const dow = ["일","월","화","수","목","금","토"][d.getDay()];
    return `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}.${d.getDate()}(${dow})`;
  };
  const dateLabel = periodKey==="all" ? "전체"
    : (periodKey==="1day"||startDate===endDate) ? fmtShort(startDate)
    : `${fmtShort(startDate)} ~ ${fmtShort(endDate)}`;

  // 결제수단 칩
  const PayChips = ({svcCash,svcTransfer,svcCard,svcPoint,prodCash,prodTransfer,prodCard,prodPoint,gift}) => {
    const chips = [
      {lbl:"시술현금",  v:svcCash,     c:T.primary},
      {lbl:"시술입금",  v:svcTransfer, c:T.primary},
      {lbl:"시술카드",  v:svcCard,     c:T.primary},
      {lbl:"시술포인트",v:svcPoint,    c:T.primary},
      {lbl:"제품현금",  v:prodCash,    c:T.infoLt2},
      {lbl:"제품입금",  v:prodTransfer,c:T.infoLt2},
      {lbl:"제품카드",  v:prodCard,    c:T.infoLt2},
      {lbl:"제품포인트",v:prodPoint,   c:T.infoLt2},
      {lbl:"상품권",    v:gift,        c:T.orange},
    ].filter(x=>x.v>0);
    if (!chips.length) return <span style={{color:T.textMuted,fontSize:T.fs.xxs}}>-</span>;
    return <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
      {chips.map(({lbl,v,c})=>(
        <span key={lbl} style={{fontSize:T.fs.nano,padding:"2px 6px",borderRadius:T.radius.sm,background:c+"18",color:c,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>
          {lbl} {fmt(v)}
        </span>
      ))}
    </div>;
  };

  return <div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 관리</h2>
      <Btn variant="primary" onClick={()=>setShowModal(true)}><I name="plus" size={12}/> 매출등록</Btn>
    </div>

    {/* Filters */}
    <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.sm,flexWrap:"wrap",alignItems:"center"}}>
      <button ref={dateAnchorRef} onClick={()=>setShowSheet(true)}
        style={{height:36,borderRadius:T.radius.md,border:"1px solid "+T.primary+"44",background:T.primaryHover,
                fontSize:T.fs.sm,padding:"0 14px",cursor:"pointer",fontFamily:"inherit",color:T.primaryDk,
                fontWeight:T.fw.bold,display:"flex",alignItems:"center",gap:T.sp.xs,outline:"none",flexShrink:0}}>
        <I name="calendar" size={14} color={T.primary}/>
        <span>{dateLabel}</span>
        <I name="chevD" size={12} color={T.primary}/>
      </button>
      <select className="inp" style={{flex:1,minWidth:100,height:36}} value={vb} onChange={e=>setVb(e.target.value)}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div style={{position:"relative",flex:2,minWidth:160}}>
        <I name="search" size={14} color={T.gray400} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:32,paddingRight:q?30:12,height:36}}
          placeholder="고객명, 연락처, 담당자, 메모" value={q} onChange={e=>setQ(e.target.value)}/>
        {q && <button onClick={()=>setQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
          background:"none",border:"none",cursor:"pointer",color:T.gray400,fontSize:T.fs.lg,lineHeight:1,padding:0}}>×</button>}
      </div>
      <span style={{fontSize:T.fs.sm,color:T.textSub,whiteSpace:"nowrap",flexShrink:0}}>{sales.length}건</span>
    </div>

    {/* 요약 합계 바 */}
    {sales.length > 0 && (
      <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.md,flexWrap:"wrap"}}>
        {[
          {lbl:"총 매출",  v:totals.total, c:T.info,    bold:true},
          {lbl:"시술",     v:totals.svc,   c:T.primary},
          {lbl:"제품",     v:totals.prod,  c:T.infoLt2},
          {lbl:"상품권",   v:totals.gift,  c:T.orange},
        ].map(({lbl,v,c,bold})=>(
          <div key={lbl} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,
            padding:"6px 14px",display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{lbl}</span>
            <span style={{fontSize:T.fs.sm,fontWeight:bold?T.fw.black:T.fw.bolder,color:c}}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    )}

    {/* 테이블 */}
    <DataTable card>
      <thead><tr>
        <th style={{width:36}}>#</th>
        <th>날짜</th>
        <th>지점</th>
        <th>이름</th>
        <th>담당자</th>
        <th>시술합계</th>
        <th>제품합계</th>
        <th>총합계</th>
        <th>메모</th>
        <th style={{width:60}}></th>
      </tr></thead>
      <tbody>
        {sales.length===0
          ? <tr><td colSpan={10}><Empty msg="매출 기록 없음" icon="wallet"/></td></tr>
          : sales.map((s,i) => {
              const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
              const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
              const total = sv+pr+(s.gift||0);
              const isExp = expandedId===s.id;
              const br = (data.branches||[]).find(b=>b.id===s.bid);
              return <React.Fragment key={s.id}>
                <tr style={{cursor:"pointer",background:isExp?T.primaryHover:"transparent"}}
                  onClick={()=>setExpandedId(isExp?null:s.id)}>
                  <td style={{color:T.textMuted}}>{i+1}</td>
                  <td style={{whiteSpace:"nowrap",color:T.textSub,fontSize:T.fs.xxs}}>{s.date}</td>
                  <td><span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span></td>
                  <td style={{fontWeight:T.fw.bold}}>
                    {s.custGender && <span style={{...sx.genderBadge(s.custGender),marginRight:4}}>{s.custGender==="M"?"남":"여"}</span>}
                    {s.custName||"-"}
                    {s.custNum && <span style={{fontSize:T.fs.nano,color:T.textMuted,marginLeft:4}}>#{s.custNum}</span>}
                  </td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{s.staffName||"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.primary}}>{sv>0?fmt(sv):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.infoLt2}}>{pr>0?fmt(pr):<Z/>}</td>
                  <td style={{fontWeight:T.fw.black,color:T.info}}>{fmt(total)}</td>
                  <td style={{...sx.ellipsis,maxWidth:100,fontSize:T.fs.xxs,color:T.textSub}}>{s.memo||""}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:3}}>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>setEditSale(s)}><I name="edit" size={12}/></Btn>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>handleDelete(s.id)}><I name="trash" size={12}/></Btn>
                    </div>
                  </td>
                </tr>
                {isExp && <tr><td colSpan={10} style={{padding:0,background:T.gray100}}>
                  <div style={{padding:"10px 16px",display:"flex",gap:T.sp.lg,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>결제 수단</div>
                      <PayChips {...s}/>
                    </div>
                    {s.custPhone && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>연락처</div>
                      <span style={{fontSize:T.fs.sm,color:T.primary}}>{s.custPhone}</span>
                    </div>}
                    {s.memo && <div style={{flex:1}}>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>메모</div>
                      <span style={{fontSize:T.fs.sm,color:T.text}}>{s.memo}</span>
                    </div>}
                    {s.createdAt && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>등록시간</div>
                      <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{new Date(s.createdAt).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
                    </div>}
                  </div>
                </td></tr>}
              </React.Fragment>;
            })
        }
        {/* 합계 행 */}
        {sales.length>0 && <tr style={{background:T.gray200,fontWeight:T.fw.bolder}}>
          <td colSpan={5} style={{textAlign:"right",color:T.textSub,fontSize:T.fs.xxs}}>합 계</td>
          <td style={{color:T.primary}}>{fmt(totals.svc)}</td>
          <td style={{color:T.infoLt2}}>{fmt(totals.prod)}</td>
          <td style={{color:T.info}}>{fmt(totals.total)}</td>
          <td colSpan={2}/>
        </tr>}
      </tbody>
    </DataTable>

    {showModal && <DetailedSaleForm
      reservation={{id:genId(),bid:userBranches[0],custId:null,custName:"",custPhone:"",custGender:"",
        staffId:(data.staff||[]).find(s=>s.bid===(userBranches[0]))?.id||"",serviceId:null,date:todayStr()}}
      branchId={userBranches[0]}
      onSubmit={handleSave}
      onClose={()=>_mc(()=>setShowModal(false))} data={data} setData={setData}/>}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo:editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))} data={data} setData={setData}/>}
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
  </div>;
}

// ── 공통 헬퍼 ─────────────────────────────────────────
const _mc = (fn) => { if(fn) fn(); };
function Empty({ msg='데이터 없음', icon='inbox' }) {
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 0',gap:8,color:T.textMuted}}>
    <I name={icon} size={28} color={T.gray400}/>
    <span style={{fontSize:T.fs.sm}}>{msg}</span>
  </div>;
}
function CustModal({ item, onSave, onClose, defBranch, userBranches, branches }) {
  const isNew = !item?.id;
  const [form, setForm] = React.useState(() => item ? {...item} : {id:'cust_'+uid(),name:'',phone:'',gender:'',bid:defBranch||'',memo:'',visits:0});
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return <div style={{position:'fixed',inset:0,zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.45)'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:T.bgCard,borderRadius:T.radius.lg,padding:24,width:'100%',maxWidth:440,boxShadow:T.shadow.md}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
        <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{isNew?'고객 등록':'고객 수정'}</span>
        <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:T.gray400,lineHeight:1}}>×</button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <FLD label="매장">
          <select className="inp" value={form.bid} onChange={e=>f('bid',e.target.value)}>
            {(branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FLD>
        <FLD label="이름"><input className="inp" value={form.name} onChange={e=>f('name',e.target.value)} placeholder="고객 이름"/></FLD>
        <FLD label="연락처"><input className="inp" value={form.phone} onChange={e=>f('phone',e.target.value)} placeholder="01012345678"/></FLD>
        <FLD label="성별">
          <div style={{display:'flex',gap:8}}>
            {[['F','여성'],['M','남성'],['','미지정']].map(([v,l])=>(
              <button key={v} onClick={()=>f('gender',v)} style={{flex:1,padding:'6px',border:'1.5px solid',borderRadius:T.radius.md,cursor:'pointer',fontFamily:'inherit',fontSize:T.fs.sm,fontWeight:form.gender===v?T.fw.bolder:T.fw.normal,background:form.gender===v?T.primary:T.bgCard,color:form.gender===v?T.bgCard:T.gray700,borderColor:form.gender===v?T.primary:T.border}}>{l}</button>
            ))}
          </div>
        </FLD>
        <FLD label="메모"><textarea className="inp" rows={2} value={form.memo||''} onChange={e=>f('memo',e.target.value)} placeholder="메모"/></FLD>
      </div>
      <div style={{display:'flex',gap:10,marginTop:20}}>
        <Btn variant="secondary" style={{flex:1}} onClick={onClose}>취소</Btn>
        <Btn variant="primary" style={{flex:2}} onClick={()=>{ if(!form.name.trim()) return alert('이름을 입력하세요'); onSave(form); }}>저장</Btn>
      </div>
    </div>
  </div>;
}

function Z() { return <span style={{color:T.gray400}}>0</span>; }

// ═══════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════
function StatsPage({ data, userBranches, isMaster, role }) {
  const [period, setPeriod] = useState("7");
  const [vb, setVb] = useState("all");
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - parseInt(period));
  
  const filtered = (data?.sales||[]).filter(s => {
    const d = new Date(s.date);
    return d >= start && d <= end && ((vb==="all"?userBranches.includes(s.bid):s.bid===vb));
  });

  const t = filtered.reduce((a,s)=>({
    svcTotal:a.svcTotal+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint),
    prodTotal:a.prodTotal+(s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint),
    gift:a.gift+s.gift,
    total:a.total+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift),
    count:a.count+1,
    svcCash:a.svcCash+s.svcCash,svcTransfer:a.svcTransfer+s.svcTransfer,svcCard:a.svcCard+s.svcCard,svcPoint:a.svcPoint+s.svcPoint,
    prodCash:a.prodCash+s.prodCash,prodTransfer:a.prodTransfer+s.prodTransfer,prodCard:a.prodCard+s.prodCard,prodPoint:a.prodPoint+s.prodPoint,
  }),{svcTotal:0,prodTotal:0,gift:0,total:0,count:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0});

  const days = parseInt(period);

  // By staff
  const byStaff = {};
  filtered.forEach(s => {
    if(!byStaff[s.staffName]) byStaff[s.staffName]={count:0,total:0};
    byStaff[s.staffName].count++;
    byStaff[s.staffName].total+=(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift);
  });
  const staffRank = Object.entries(byStaff).sort((a,b)=>b[1].total-a[1].total);

  // By branch
  const byBranch = {};
  if (isMaster) {
    filtered.forEach(s => {
      const bn = (data.branches||[]).find(b=>b.id===s.bid)?.short||"";
      if(!byBranch[bn]) byBranch[bn]={count:0,total:0};
      byBranch[bn].count++;
      byBranch[bn].total+=(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift);
    });
  }
  const branchRank = Object.entries(byBranch).sort((a,b)=>b[1].total-a[1].total);

  // Chart data (7 days)
  const chartDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = fmtLocal(d);
    const dayData = (data?.sales||[]).filter(s=>s.date===ds && ((vb==="all"?userBranches.includes(s.bid):s.bid===vb)));
    const svc = dayData.reduce((a,s)=>a+s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint,0);
    const prod = dayData.reduce((a,s)=>a+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint,0);
    chartDays.push({label:`${d.getMonth()+1}/${d.getDate()}`,svc,prod,total:svc+prod});
  }
  const maxChart = Math.max(...chartDays.map(d=>d.total),1);

  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 통계</h2>
      <div style={{display:"flex",gap:T.sp.sm}}>
        {<select className="inp" style={{maxWidth:130,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        <select className="inp" style={{maxWidth:110,width:"auto"}} value={period} onChange={e=>setPeriod(e.target.value)}>
          <option value="7">7일</option><option value="14">14일</option><option value="30">30일</option>
        </select>
      </div>
    </div>
    {/* Summary Cards */}
    <GridLayout className="stat-cards" cols="repeat(auto-fit,minmax(160px,1fr))" gap={12} style={{marginBottom:20}}>
      <SC label="총 매출" val={`${fmt(t.total)}원`} sub={`${t.count}건`} clr={T.info}/>
      <SC label="시술 매출" val={`${fmt(t.svcTotal)}원`} sub="시술 합계" clr={T.primary}/>
      <SC label="제품 매출" val={`${fmt(t.prodTotal)}원`} sub="제품 합계" clr={T.infoLt2}/>
      <SC label="상품권" val={`${fmt(t.gift)}원`} sub="상품권 합계" clr={T.danger}/>
      <SC label="일 평균" val={`${fmt(Math.round(t.total/days))}원`} sub={`${days}일 평균`} clr={T.info}/>
      <SC label="객단가" val={`${fmt(t.count>0?Math.round(t.total/t.count):0)}원`} sub="건당 평균" clr={T.gray400}/>
    </GridLayout>
    {/* Chart */}
    <div className="card" style={{padding:20,marginBottom:16}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:16}}>최근 7일 매출 (시술 + 제품)</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:130}}>
        {chartDays.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:T.sp.xs}}>
            <span style={{fontSize:T.fs.nano,color:T.textSub}}>{d.total>0?`${fmt(Math.round(d.total/10000))}만`:""}</span>
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:1}}>
              <div style={{width:"100%",height:`${Math.max((d.prod/maxChart)*80,0)}px`,background:T.infoLt2,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
              <div style={{width:"100%",height:`${Math.max((d.svc/maxChart)*80,2)}px`,background:T.primary,borderRadius:"0 0 4px 4px",transition:"height .3s"}}/>
            </div>
            <span style={{fontSize:T.fs.xs,color:T.gray500}}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:T.sp.md,justifyContent:"center",marginTop:10}}>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.primary}}/>시술</span>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.infoLt2}}/>제품</span>
      </div>
    </div>
    <GridLayout className="stat-charts" cols="repeat(auto-fit,minmax(300px,1fr))" gap={16}>
      {/* Payment Breakdown */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>결제수단별 시술 매출</div>
        {[["현금",t.svcCash,T.infoLt2],["입금",t.svcTransfer,T.danger],["카드",t.svcCard,T.primary],["포인트",t.svcPoint,T.gray400]].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:45,color:c,fontWeight:T.fw.bold}}>{l}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${t.svcTotal>0?(v/t.svcTotal)*100:0}%`,background:c,borderRadius:T.radius.sm}}/>
            </div>
            <span style={{width:80,textAlign:"right",fontWeight:T.fw.bold}}>{fmt(v)}원</span>
          </div>
        ))}
      </div>
      {/* Staff Rank */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>매니저별 매출</div>
        {staffRank.slice(0,8).map(([n,v],i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.info:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{flex:1,fontWeight:T.fw.medium}}>{n}</span>
            <span style={{color:T.textSub,fontSize:T.fs.xxs}}>{v.count}건</span>
            <span style={{fontWeight:T.fw.bolder,color:T.info,width:80,textAlign:"right"}}>{fmt(v.total)}원</span>
          </div>
        ))}
      </div>
      {/* Branch Rank (master) */}
      {isMaster && <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>매장별 매출</div>
        {branchRank.map(([n,v],i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.primary:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{width:55,fontWeight:T.fw.bold}}>{n}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${branchRank[0][1].total>0?(v.total/branchRank[0][1].total)*100:0}%`,background:"linear-gradient(90deg,#5cb5c5,#7c7cc8)",borderRadius:T.radius.sm}}/>
            </div>
            <span style={{fontWeight:T.fw.bolder,width:85,textAlign:"right"}}>{fmt(v.total)}원</span>
          </div>
        ))}
      </div>}
    </GridLayout>
  </div>;
}

// SC → StatCard alias (기존 호환)
const SC = ({label, val, sub, clr}) => <StatCard label={label} value={val} sub={sub} color={clr}/>;

// ═══════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════
function CustomersPage({ data, setData, userBranches, isMaster }) {
  const [q, setQ] = useState("");
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailCust, setDetailCust] = useState(null);
  const [detailTab, setDetailTab] = useState("pkg"); // "pkg" | "sales"
  const [serverCusts, setServerCusts] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [custPage, setCustPage] = useState(0);
  const CUST_PER_PAGE = 50;

  // 서버사이드 검색 (디바운스)
  useEffect(() => {
    if (!q || q.length < 1) { setServerCusts(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const encoded = encodeURIComponent(q);
        const filter = `&business_id=eq.${_activeBizId}&or=(name.ilike.*${encoded}*,phone.ilike.*${encoded}*,memo.ilike.*${encoded}*)&order=created_at.desc.nullslast&limit=200`;
        const results = await sb.get("customers", filter);
        setServerCusts(fromDb("customers", results));
      } catch(e) { console.error("Customer search failed:", e); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const baseCusts = (q && serverCusts !== null) ? serverCusts : (data?.customers||[]);
  const custs = baseCusts.filter(c => {
    const bm = vb==="all" ? userBranches.includes(c.bid) : c.bid===vb;
    const sm = !q || c.name?.includes(q) || c.phone?.includes(q) || (c.memo||"").includes(q);
    const hm = q || showHidden || !c.isHidden;
    return bm && sm && hm;
  }).sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  const handleSave = (item) => {
    const normalized = {...item, phone: (item.phone || "").replace(/[^0-9]/g, "")};
    setData(prev => {
      const ex = (prev?.customers||[]).find(c=>c.id===normalized.id);
      if (ex) { sb.update("customers",normalized.id,toDb("customers",normalized)).catch(console.error); return {...prev,customers:(prev?.customers||[]).map(c=>c.id===normalized.id?normalized:c)}; }
      sb.insert("customers",toDb("customers",normalized)).catch(console.error);
      return {...prev,customers:[...prev.customers,normalized]};
    });
    setShowModal(false); setEditItem(null);
  };

  const [custSales, setCustSales] = useState([]);
  const [custPkgsServer, setCustPkgsServer] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  useEffect(() => {
    if (!detailCust) { setCustSales([]); setCustPkgsServer([]); setLoadingDetail(false); return; }
    setLoadingDetail(true);
    Promise.all([
      sb.get("sales", `&cust_id=eq.${detailCust.id}&order=date.desc&limit=500`)
        .then(rows => setCustSales(fromDb("sales", rows)))
        .catch(() => setCustSales([])),
      sb.get("customer_packages", `&customer_id=eq.${detailCust.id}`)
        .then(rows => setCustPkgsServer(rows))
        .catch(() => setCustPkgsServer([]))
    ]).finally(() => setLoadingDetail(false));
  }, [detailCust?.id]);
  // 동일 이름 → 최신(유효기간 가장 먼 것)만 표시
  const custPkgs = (() => {
    const byName = {};
    custPkgsServer.forEach(p => {
      const key = p.service_name || p.id;
      const exp = ((p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1] || "0000";
      if (!byName[key] || exp > (byName[key]._exp||"0000")) {
        byName[key] = {...p, _exp: exp};
      }
    });
    return Object.values(byName);
  })();
  const pkgSvcs   = (data.services||[]).filter(s=>s.isPackage);

  // 패키지 타입 판별
  const pkgType = (p) => {
    const n = (p.service_name||"").toLowerCase();
    if (n.includes("다담권") || n.includes("선불") || n.includes("10%추가적립")) return "prepaid"; // 선불카드/다담권
    if (n.includes("연간") || n.includes("할인권") || n.includes("회원권")) return "annual"; // 연간할인권
    return "package"; // 일반 다회권(PKG)
  };

  // 다회권/다담권/연간할인권 카드
  const PkgCard = ({p}) => {
    const type = pkgType(p);
    const isPrepaid = type === "prepaid";
    const isAnnual = type === "annual";

    // 다담권: note에서 잔액 파싱
    const parseNote = (note) => {
      const m = (note||"").match(/잔액:([0-9,]+)/);
      return m ? Number(m[1].replace(/,/g,"")) : 0;
    };
    const balance = isPrepaid ? parseNote(p.note) : 0;
    const charged = isPrepaid ? p.total_count : 0;
    const spent = isPrepaid ? p.used_count : 0;

    // 유효기간 파싱
    const parseExpiry = (note) => {
      const m = (note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    };
    const expiry = parseExpiry(p.note);
    const isExpired = expiry && expiry < todayStr();

    // 일반 다회권
    const remain = p.total_count - p.used_count;
    const pct = p.total_count > 0 ? (remain/p.total_count)*100 : 0;
    const isDone = isPrepaid ? balance <= 0 : remain <= 0;

    return <div style={{border:"1px solid "+(isDone?T.gray300:isExpired?T.danger+"44":T.border),borderRadius:T.radius.md,padding:"10px 12px",background:isDone?T.gray100:T.bgCard,minWidth:180,flex:"0 0 auto",opacity:isDone?0.6:1}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        <span style={{fontSize:9,padding:"1px 5px",borderRadius:T.radius.full,fontWeight:T.fw.bolder,
          background:isPrepaid?T.orange+"22":isAnnual?T.info+"22":T.primaryLt,
          color:isPrepaid?T.orange:isAnnual?T.info:T.primary}}>
          {isPrepaid?"선불":isAnnual?"연간":"다회"}
        </span>
        <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.service_name}</span>
      </div>

      {/* 다담권(선불): 잔액 표시 */}
      {isPrepaid && <div>
        <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:balance>0?T.primary:T.textMuted,marginBottom:4}}>
          {balance.toLocaleString()}<span style={{fontSize:T.fs.xxs,color:T.textMuted}}>원</span>
        </div>
        <div style={{fontSize:T.fs.nano,color:T.textMuted,marginBottom:6}}>
          충전 {charged.toLocaleString()} / 사용 {spent.toLocaleString()}
        </div>
      </div>}

      {/* 연간할인권: 유효기간 표시 */}
      {isAnnual && <div>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:isExpired?T.danger:T.info,marginBottom:4}}>
          {isExpired ? "만료" : "이용중"} {expiry ? `(~${expiry})` : ""}
        </div>
        <div style={{fontSize:T.fs.nano,color:T.textMuted,marginBottom:6}}>연간 할인 적용</div>
      </div>}

      {/* 일반 다회권: 잔여횟수 + 프로그레스바 */}
      {!isPrepaid && !isAnnual && <div>
        <div style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:6}}>
          <div style={{flex:1,height:5,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
            <div style={{width:pct+"%",height:"100%",background:pct>30?"linear-gradient(90deg,"+T.male+","+T.purple+")":T.female,borderRadius:T.radius.sm,transition:"width .3s"}}/>
          </div>
          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:pct>30?T.primary:T.female,whiteSpace:"nowrap"}}>
            {remain}<span style={{fontSize:T.fs.nano,color:T.textMuted}}>/{p.total_count}</span>
          </span>
        </div>
      </div>}

      {/* 유효기간 (모든 타입 공통) */}
      {expiry && <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,padding:"4px 8px",borderRadius:T.radius.sm,
        background:isExpired?T.dangerLt:T.gray100}}>
        <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:isExpired?T.danger:T.textSub}}>
          유효 ~{expiry} {isExpired?"(만료)":""}
        </span>
        <button onClick={(e)=>{
          e.stopPropagation();
          const newExp = prompt("새 유효기간 (YYYY-MM-DD):", expiry);
          if(!newExp || !/^\d{4}-\d{2}-\d{2}$/.test(newExp)) return;
          const newNote = expiry ? (p.note||"").replace(/유효:\d{4}-\d{2}-\d{2}/, `유효:${newExp}`) : (p.note||"")+` | 유효:${newExp}`;
          sb.update("customer_packages",p.id,{note:newNote}).catch(console.error);
          setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x,note:newNote}:x));
        }} style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,border:"1px solid "+T.border,
          background:T.bgCard,color:T.primary,cursor:"pointer",fontFamily:"inherit",fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>
          연장
        </button>
      </div>}

      {/* 액션 버튼 */}
      <div style={{display:"flex",gap:T.sp.xs}}>
        {/* 다회권: 1회 사용 */}
        {!isPrepaid && !isAnnual && <Btn variant="primary" size="sm" style={{flex:1,justifyContent:"center",fontSize:T.fs.nano}} onClick={()=>{
          if(remain<=0) return alert("잔여 횟수가 없습니다");
          const up = {...p, used_count:p.used_count+1};
          sb.update("customer_packages",p.id,{used_count:up.used_count}).catch(console.error);
          setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?up:x));
        }}>1회 사용</Btn>}

        {/* 다담권: 금액 차감 */}
        {isPrepaid && balance > 0 && <Btn variant="primary" size="sm" style={{flex:1,justifyContent:"center",fontSize:T.fs.nano}} onClick={()=>{
          const amt = prompt("차감할 금액을 입력하세요:", "0");
          if(!amt || isNaN(amt) || Number(amt) <= 0) return;
          const deduct = Number(amt);
          if(deduct > balance) return alert("잔액보다 큰 금액입니다");
          const newBal = balance - deduct;
          const newSpent = spent + deduct;
          const newNote = (p.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
          sb.update("customer_packages",p.id,{used_count:newSpent, note:newNote}).catch(console.error);
          setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x, used_count:newSpent, note:newNote}:x));
        }}>금액 차감</Btn>}

        <Btn variant="danger" size="sm" style={{padding:"3px 8px",fontSize:T.fs.nano}} onClick={()=>{
          if(!confirm("삭제하시겠습니까?")) return;
          sb.del("customer_packages",p.id).catch(console.error);
          setCustPkgsServer(prev=>prev.filter(x=>x.id!==p.id));
        }}><I name="trash" size={11}/></Btn>
      </div>
    </div>;
  };

  return <div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <h2 className="page-title" style={{marginBottom:0}}>고객 관리</h2>
      <Btn variant="primary" onClick={()=>{setEditItem(null);setShowModal(true)}}><I name="plus" size={12}/> 고객 등록</Btn>
    </div>

    {/* 검색 & 필터 */}
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{position:"relative",flex:1,minWidth:200,maxWidth:360}}>
        <I name="search" size={14} color={T.gray400} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:34,height:38,borderRadius:T.radius.md,fontSize:T.fs.xs}} placeholder="이름, 전화번호, 메모 검색..." value={q} onChange={e=>{setQ(e.target.value);setCustPage(0);}}/>
      </div>
      <select className="inp" style={{maxWidth:130,width:"auto",height:38,borderRadius:T.radius.md,fontSize:T.fs.xs}} value={vb} onChange={e=>{setVb(e.target.value);setCustPage(0);}}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:T.fs.xxs,color:T.textSub,cursor:"pointer",flexShrink:0}}>
        <input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)} style={{accentColor:T.primary}}/>
        숨김 포함
      </label>
      <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>{custs.length}명</span>
      {searching && <span style={{fontSize:T.fs.xxs,color:T.orange}}>검색중...</span>}
    </div>

    {/* 카드형 고객 리스트 */}
    {(()=>{
      const totalPages = Math.ceil(custs.length / CUST_PER_PAGE);
      const paged = custs.slice(custPage * CUST_PER_PAGE, (custPage + 1) * CUST_PER_PAGE);
      return <>
      {paged.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:T.textMuted}}><I name="users" size={24}/><div style={{marginTop:8,fontSize:T.fs.xs}}>고객 없음</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:1,background:T.border,borderRadius:T.radius.md,overflow:"hidden",border:"1px solid "+T.border}}>
            {paged.map(c => {
              const br = (data.branches||[]).find(b=>b.id===c.bid);
              const isOpen = detailCust?.id===c.id;
              return <div key={c.id}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 14px",background:isOpen?T.primaryHover:T.bgCard,cursor:"pointer",transition:"background .15s"}}
                  onClick={()=>{ setDetailCust(isOpen?null:c); setDetailTab("sales"); }}>
                  <div style={{flex:"0 0 140px",minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                      <span style={{fontWeight:T.fw.bolder,fontSize:T.fs.xs,color:T.text}}>{c.name}</span>
                      {c.gender && <span style={{...sx.genderBadge(c.gender),fontSize:9,padding:"0 4px"}}>{c.gender==="F"?"여":"남"}</span>}
                    </div>
                    <div style={{fontSize:T.fs.xxs,color:T.primary,marginBottom:2}}>{c.phone}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:9,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px",color:T.textSub}}>{br?.short||"-"}</span>
                      <span style={{fontSize:9,color:T.textMuted}}>{c.visits||0}회</span>
                      {c.lastVisit && <span style={{fontSize:9,color:T.textMuted}}>{c.lastVisit}</span>}
                      {c.isHidden && <span style={{fontSize:9,color:T.danger,fontWeight:T.fw.bold}}>숨김</span>}
                    </div>
                  </div>
                  <div style={{flex:1,fontSize:T.fs.xxs,color:T.textSub,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:isOpen?"none":60,overflow:"hidden"}}>
                    {c.memo||<span style={{color:T.textMuted}}>-</span>}
                  </div>
                  <div style={{flex:"0 0 auto",display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                    <Btn variant="secondary" size="sm" onClick={()=>{setEditItem(c);setShowModal(true)}} style={{padding:"4px 6px"}}><I name="edit" size={11}/></Btn>
                    <Btn variant="danger" size="sm" style={{padding:"4px 6px"}} onClick={()=>{
                      if(!confirm(`"${c.name}" 삭제?`)) return;
                      sb.del("customers",c.id).catch(console.error);
                      sb.delWhere("customer_packages","customer_id",c.id).catch(console.error);
                      setData(prev=>({...prev,customers:(prev.customers||[]).filter(x=>x.id!==c.id),custPackages:(prev.custPackages||[]).filter(x=>x.customer_id!==c.id)}));
                      if(detailCust?.id===c.id) setDetailCust(null);
                    }}><I name="trash" size={11}/></Btn>
                  </div>
                </div>

                {/* 상세 패널 */}
                {isOpen && <div style={{background:T.gray100,borderTop:"2px solid "+T.primaryLt}}>
                    {/* 탭 */}
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                      {[["sales","매출 내역 ("+custSales.length+")"],["pkg","보유권 ("+custPkgs.filter(p=>{const t=pkgType(p);return t==="prepaid"?((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"0").replace(/,/g,"")>0:(p.total_count-p.used_count)>0;}).length+"/"+custPkgs.length+")"]].map(([tab,lbl])=>(
                        <button key={tab} onClick={()=>setDetailTab(tab)}
                          style={{padding:"8px 16px",fontSize:T.fs.xs,fontWeight:detailTab===tab?T.fw.bolder:T.fw.normal,
                            color:detailTab===tab?T.primary:T.textSub,background:"none",border:"none",
                            borderBottom:detailTab===tab?"2px solid "+T.primary:"2px solid transparent",
                            cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                          {lbl}
                        </button>
                      ))}
                    </div>

                    <div style={{padding:"12px 16px"}}>
                      {/* 다회권 탭 */}
                      {detailTab==="pkg" && <div>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          {pkgSvcs.length>0 && <select className="inp" style={{width:"auto",fontSize:T.fs.xs,height:30}}
                            value="" onChange={e=>{
                              if(!e.target.value) return;
                              const svc = pkgSvcs.find(s=>s.id===e.target.value);
                              if(!svc) return;
                              const pkg = {id:genId(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
                                service_name:svc.name,total_count:svc.pkgCount||5,used_count:0,
                                purchased_at:new Date().toISOString(),note:""};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">+ 다회권 추가</option>
                            {pkgSvcs.map(s=><option key={s.id} value={s.id}>{s.name} ({s.pkgCount}회)</option>)}
                          </select>}
                        </div>
                        {custPkgs.length===0
                          ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>보유 다회권 없음</div>
                          : <div style={{display:"flex",gap:T.sp.sm,flexWrap:"wrap"}}>
                              {custPkgs.map(p=><PkgCard key={p.id} p={p}/>)}
                            </div>
                        }
                      </div>}

                      {/* 매출 내역 탭 */}
                      {detailTab==="sales" && <div style={{maxHeight:480,overflowY:"auto"}}>
                        {loadingDetail
                          ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>로딩 중...</div>
                          : custSales.length===0
                          ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>매출 기록 없음</div>
                          : custSales.map(s=>{
                              const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
                              const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
                              const total = sv+pr+(s.gift||0);
                              const brName = (data.branches||[]).find(b=>b.id===s.bid)?.short||"";
                              return <div key={s.id} style={{borderBottom:"1px solid "+T.border,padding:"10px 0"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.text}}>{s.date}</span>
                                  <span style={{fontSize:T.fs.nano,background:T.gray200,borderRadius:T.radius.sm,padding:"2px 6px"}}>{brName}</span>
                                  <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.bold}}>{s.staffName}</span>
                                </div>
                                <div style={{display:"flex",gap:12,marginBottom:6,padding:"6px 10px",background:"linear-gradient(90deg,"+T.primaryHover+",transparent)",borderRadius:T.radius.sm}}>
                                  <span style={{fontSize:T.fs.xs}}>시술 <b style={{color:T.primary}}>{fmt(sv)}</b></span>
                                  <span style={{fontSize:T.fs.xs}}>제품 <b style={{color:T.infoLt2}}>{fmt(pr)}</b></span>
                                  <span style={{fontSize:T.fs.xs,marginLeft:"auto"}}>합계 <b style={{color:T.info,fontSize:T.fs.sm}}>{fmt(total)}</b></span>
                                </div>
                                {s.memo && <div style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"pre-wrap",lineHeight:1.6,background:T.bgCard,borderRadius:T.radius.sm,padding:"6px 8px"}}>{s.memo}</div>}
                              </div>;
                            })
                        }
                      </div>}
                    </div>
                </div>}
              </div>;
            })}
          </div>}

      {/* 페이지네이션 */}
      {totalPages > 1 && <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:12}}>
        <button disabled={custPage===0} onClick={()=>setCustPage(0)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage===0?"default":"pointer",opacity:custPage===0?.4:1}}>«</button>
        <button disabled={custPage===0} onClick={()=>setCustPage(p=>p-1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage===0?"default":"pointer",opacity:custPage===0?.4:1}}>‹</button>
        <span style={{fontSize:T.fs.xs,color:T.textSub,padding:"0 8px"}}>{custPage+1} / {totalPages}</span>
        <button disabled={custPage>=totalPages-1} onClick={()=>setCustPage(p=>p+1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage>=totalPages-1?"default":"pointer",opacity:custPage>=totalPages-1?.4:1}}>›</button>
        <button disabled={custPage>=totalPages-1} onClick={()=>setCustPage(totalPages-1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage>=totalPages-1?"default":"pointer",opacity:custPage>=totalPages-1?.4:1}}>»</button>
      </div>}
      </>;
    })()}

    {showModal && <CustModal item={editItem} onSave={handleSave}
      onClose={()=>_mc(()=>{setShowModal(false);setEditItem(null)})}
      defBranch={userBranches[0]} userBranches={userBranches} branches={data.branches||[]}/>}
  </div>;
}
function UsersPage(p) { return <UsersPageReal {...p} />; }
function SuperUsers({ users, businesses, superData, setSuperData }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);

  const startAdd = () => { setEditId("new"); setForm({name:"", loginId:"", pw:"1234", role:"owner", businessId:businesses[0]?.id||"", branches:[], viewBranches:[]}); };
  const startEdit = (u) => { setEditId(u.id); setForm({...u}); };
  const cancel = () => { setEditId(null); setForm(null); };

  const save = async () => {
    if(!form.name||!form.loginId||!form.pw) { alert("이름, 아이디, 비밀번호를 입력하세요."); return; }
    if(editId==="new") {
      const newU = {...form, id:"acc_"+uid()};
      await sb.insert("app_users", {id:newU.id, business_id:newU.businessId||null, login_id:newU.loginId, password:newU.pw, name:newU.name, role:newU.role, branch_ids:JSON.stringify(newU.branches||[]), view_branch_ids:JSON.stringify(newU.viewBranches||[])}).catch(console.error);
      setSuperData(p=>({...p, users:[...p.users, newU]}));
    } else {
      await sb.update("app_users", editId, {business_id:form.businessId||null, login_id:form.loginId, password:form.pw, name:form.name, role:form.role, branch_ids:JSON.stringify(form.branches||[]), view_branch_ids:JSON.stringify(form.viewBranches||[])}).catch(console.error);
      setSuperData(p=>({...p, users:p.users.map(u=>u.id===editId?{...form}:u)}));
    }
    cancel();
  };
  const remove = async (id) => {
    if(!window.confirm("이 사용자를 삭제하시겠습니까?")) return;
    await sb.del("app_users", id).catch(console.error);
    setSuperData(p=>({...p, users:(p?.users||[]).filter(u=>u.id!==id)}));
  };

  const roleLabel = (r) => r==="super"?"슈퍼":r==="owner"?"대표":"직원";
  const roleBg = (r) => r==="super"?"#e5737315":r==="owner"?"#7c7cc815":T.bg;
  const roleClr = (r) => r==="super"?T.female:r==="owner"?T.primary:T.gray600;

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <h2 style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text}}><I name="user" size={18}/> 전체 사용자 <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,color:T.gray500}}>{users.length}명</span></h2>
      <Btn variant="primary" onClick={startAdd}><I name="plus" size={12}/> 사용자 추가</Btn>
    </div>

    {form && <div className="card" style={{padding:20,marginBottom:16}}>
      <h3 style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,marginBottom:12}}>{editId==="new"?"사용자 추가":"사용자 수정"}</h3>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <FLD label="이름"><input className="inp" style={{width:"100%",maxWidth:120}} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/></FLD>
        <FLD label="아이디"><input className="inp" style={{width:"100%",maxWidth:120}} value={form.loginId} onChange={e=>setForm(p=>({...p,loginId:e.target.value}))}/></FLD>
        <FLD label="비밀번호"><input className="inp" style={{width:"100%",maxWidth:100}} value={form.pw} onChange={e=>setForm(p=>({...p,pw:e.target.value}))}/></FLD>
        <FLD label="유형"><select className="inp" style={{width:"100%",maxWidth:90}} value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
          <option value="super">슈퍼</option><option value="owner">대표</option><option value="staff">직원</option>
        </select></FLD>
        <FLD label="업체"><select className="inp" style={{width:"100%",maxWidth:150}} value={form.businessId||""} onChange={e=>setForm(p=>({...p,businessId:e.target.value}))}>
          <option value="">없음</option>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select></FLD>
        <div style={{display:"flex",gap:6}}>
          <Btn variant="primary" style={{padding:"7px 16px"}} onClick={save}>{editId==="new"?"추가":"저장"}</Btn>
          <Btn variant="secondary" style={{padding:"7px 16px"}} onClick={cancel}>취소</Btn>
        </div>
      </div>
    </div>}

    <DataTable card><thead><tr>
        <th>이름</th><th>아이디</th><th>유형</th><th>업체</th><th>비밀번호</th><th style={{width:120}}>관리</th>
      </tr></thead><tbody>
        {users.map(u=>{
          const biz = businesses.find(b=>b.id===u.businessId);
          return <tr key={u.id}>
            <td style={{fontWeight:T.fw.bold}}>{u.name}</td>
            <td style={{color:T.primary}}>{u.loginId||u.login_id}</td>
            <td><span style={{fontSize:T.fs.xs,padding:"2px 8px",borderRadius:T.radius.lg,background:roleBg(u.role),color:roleClr(u.role),fontWeight:T.fw.bold}}>{roleLabel(u.role)}</span></td>
            <td style={{fontSize:T.fs.sm,color:T.gray700}}>{biz?.name||"-"}</td>
            <td style={{color:T.textMuted}}>{"•".repeat((u.pw||u.password||"").length)}</td>
            <td style={{display:"flex",gap:T.sp.xs}}>
              <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>startEdit(u)}>수정</Btn>
              {u.role!=="super" && <Btn variant="danger" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>remove(u.id)}>삭제</Btn>}
            </td>
          </tr>;
        })}
      </tbody></DataTable>
  </div>;
}

function SuperSystemSettings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rows = await sb.get("businesses","&code=eq.__system__");
        if (rows.length > 0) {
          const m = JSON.parse(rows[0].settings||"{}");
          setKey(m.system_gemini_key||"");
        }
      } catch(e){}
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    try {
      const rows = await sb.get("businesses","&code=eq.__system__");
      const settings = JSON.stringify({ system_gemini_key: key.trim() });
      if (rows.length > 0) {
        await sb.update("businesses", rows[0].id, { settings });
      } else {
        await sb.insert("businesses",{ id:"biz_system", name:"[시스템]", code:"__system__", phone:"", settings });
      }
      window.__systemGeminiKey = key.trim();
      setSaved(true);
      setTimeout(()=>setSaved(false), 2500);
    } catch(e) { alert("저장 실패: "+e.message); }
  };

  if (loading) return <div style={{padding:40,textAlign:"center",color:T.gray500}}>로딩 중...</div>;

  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:24}}>
      <div style={{fontSize:T.fs.md,fontWeight:T.fw.black,color:T.text,marginBottom:4}}>시스템 설정</div>
      <div style={{fontSize:T.fs.sm,color:T.gray500,marginBottom:24}}>일반 사용자에게는 표시되지 않는 개발자 전용 설정입니다.</div>

      <div style={{background:T.bgCard,border:"1px solid #e8e8e8",borderRadius:T.radius.lg,padding:20,display:"flex",flexDirection:"column",gap:T.sp.lg}}>
        <div>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.gray700,marginBottom:4}}>Gemini API 키 (시스템)</div>
          <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:10}}>
            가입 시 사업자등록증 자동 인식에 사용됩니다. 사용자에게는 노출되지 않습니다.
          </div>
          <div style={{display:"flex",gap:T.sp.sm}}>
            <input
              type="password"
              value={key}
              onChange={e=>{setKey(e.target.value);setSaved(false);}}
              placeholder="AIza..."
              style={{flex:1,padding:"10px 12px",fontSize:T.fs.sm,borderRadius:T.radius.md,border:"1px solid "+T.border,outline:"none",fontFamily:"inherit"}}
            />
            <button onClick={save}
              style={{padding:"10px 20px",borderRadius:T.radius.md,border:"none",background:T.primary,color:T.bgCard,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {saved ? "✓ 저장됨" : "저장"}
            </button>
          </div>
          {key && <div style={{fontSize:T.fs.xxs,color:T.primary,marginTop:6}}>✓ 키 등록됨 — 신규 가입 시 OCR 자동 활성화</div>}
          {!key && <div style={{fontSize:T.fs.xxs,color:"#f4a",marginTop:6}}>키 미등록 — 신규 가입자는 직접 입력 방식으로 진행됩니다</div>}
        </div>

        <div style={{borderTop:"1px solid #f0f0f0",paddingTop:14}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:8}}>요금제 안내</div>
          <GridLayout cols={3} gap={8}>
            {[
              {name:"체험",id:"trial",color:T.gray500,desc:"14일 무료"},
              {name:"Basic",id:"basic",color:T.male,desc:"지점 1 · 직원 3"},
              {name:"Pro",id:"pro",color:T.primary,desc:"무제한"},
            ].map(p=>(
              <div key={p.id} style={{border:"1px solid #e8e8e8",borderRadius:T.radius.md,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:p.color}}>{p.name}</div>
                <div style={{fontSize:T.fs.xxs,color:T.gray500,marginTop:2}}>{p.desc}</div>
              </div>
            ))}
          </GridLayout>
          <div style={{fontSize:T.fs.xxs,color:T.gray400,marginTop:10}}>* 결제 연동은 추후 구현 예정</div>
        </div>
      </div>
    </div>
  );
}

function SignupWizard({ onComplete, onBack }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [acct, setAcct] = useState({ name:'', loginId:'', pw:'', pw2:'' });
  const setA = (k,v) => setAcct(p=>({...p,[k]:v}));
  const [bizName, setBizName] = useState('');
  const [branches, setBranches] = useState([]);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [errs, setErrs] = useState({});
  const setErr = (k,v) => setErrs(p=>({...p,[k]:v}));

  const nextStep1 = () => {
    const e = {};
    if (!acct.name.trim()) e.name = '이름을 입력해주세요';
    if (!acct.loginId.trim()) e.loginId = '아이디를 입력해주세요';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(acct.loginId)) e.loginId = '아이디는 영문/숫자/언더바 3~20자로 입력해주세요';
    if (acct.pw.length < 4) e.pw = '비밀번호는 4자 이상이어야 해요';
    if (acct.pw !== acct.pw2) e.pw2 = '비밀번호가 일치하지 않아요';
    setErrs(e);
    if (Object.keys(e).length === 0) setStep(2);
  };

  const addBranchItem = () => {
    if (!addName.trim()) { setErr('addName','지점 이름을 입력해주세요'); return; }
    if (branches.length >= 3) return;
    setBranches(p=>[...p,{name:addName.trim(), phone:addPhone.trim()}]);
    setAddName(''); setAddPhone(''); setShowAddForm(false); setErr('addName','');
  };
  const removeBranch = (i) => setBranches(p=>p.filter((_,idx)=>idx!==i));

  const submit = async () => {
    if (branches.length === 0) { alert('지점을 먼저 등록해주세요.'); return; }
    if (!bizName.trim()) { alert('브랜드명을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const ex = await sb.get('app_users','&login_id=eq.'+encodeURIComponent(acct.loginId));
      if (ex.length > 0) { alert('이미 사용 중인 아이디입니다.'); setSaving(false); return; }
      const bizId = 'biz_'+uid();
      const oId = 'acc_'+uid();
      const exp = new Date(); exp.setDate(exp.getDate()+14);
      await sb.insert('businesses', {
        id: bizId, name: bizName.trim(), code: acct.loginId, phone: branches[0].phone||'',
        settings: JSON.stringify({ plan:'trial', planExpiry: exp.toISOString().slice(0,10) }), use_yn: true
      });
      const brIds = [];
      for (let i=0; i<branches.length; i++) {
        const brId = 'br_'+uid();
        brIds.push(brId);
        await sb.insert('branches', {
          id: brId, business_id: bizId, name: branches[i].name, short: branches[i].name.slice(0,5),
          phone: branches[i].phone||'', sort: i, use_yn: true
        });
      }
      await sb.insert('app_users', {
        id: oId, business_id: bizId, login_id: acct.loginId, password: acct.pw,
        name: acct.name.trim(), role: 'owner', branch_ids: JSON.stringify(brIds), view_branch_ids: JSON.stringify(brIds)
      });
      setStep(3);
      setTimeout(()=>onComplete({
        id:oId, businessId:bizId, loginId:acct.loginId, pw:acct.pw,
        name:acct.name.trim(), role:'owner', branchIds:brIds, viewBranchIds:brIds
      }), 2000);
    } catch(e) {
      alert('가입 실패: '+(e.message||'다시 시도해주세요.'));
    } finally { setSaving(false); }
  };

  const inp = {width:'100%',padding:'11px 13px',fontSize:T.fs.md,borderRadius:T.radius.lg,border:'1px solid '+T.border,outline:'none',fontFamily:'inherit',color:T.text,background:'#fff'};
  const lbl = {fontSize:T.fs.xxs,color:T.gray500,fontWeight:T.fw.bold,marginBottom:5,display:'block'};
  const errStyle = {fontSize:T.fs.xxs,color:T.danger,marginTop:3};

  const StepBar = () => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',marginBottom:24,gap:0}}>
      {[['1','계정'],['2','사업장'],['3','완료']].map(([n,lv],i,arr)=><React.Fragment key={n}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
          <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:12,fontWeight:700,
            background: step>i+1?T.primary : step===i+1?T.primary:'#e8e8f0',
            color: step>=i+1?'#fff':T.gray400,
            boxShadow: step===i+1?'0 0 0 4px #f0f0fa':'none',
            transition:'all .3s'}}>
            {step>i+1?'✓':n}
          </div>
          <div style={{fontSize:10,fontWeight:600,color:step===i+1?T.primary:T.gray400}}>{lv}</div>
        </div>
        {i<2&&<div style={{width:44,height:2,background:step>i+1?T.primary:'#e8e8f0',margin:'0 6px',marginBottom:16,transition:'background .3s'}}/>}
      </React.Fragment>)}
    </div>
  );

  if (step===1) return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      <StepBar/>
      <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,marginBottom:4}}>계정 만들기</div>
      <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:20,lineHeight:1.5}}>아이디와 비밀번호로 Bliss 계정을 만들어요.</div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>이름</label>
        <input style={{...inp,borderColor:errs.name?T.danger:T.border}} value={acct.name} onChange={e=>setA('name',e.target.value)} placeholder="홍길동"/>
        {errs.name&&<div style={errStyle}>{errs.name}</div>}
      </div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>아이디 (영문/숫자/언더바 3~20자)</label>
        <input style={{...inp,borderColor:errs.loginId?T.danger:T.border}} value={acct.loginId} onChange={e=>setA('loginId',e.target.value.toLowerCase())} placeholder="예: housewaxing"/>
        {errs.loginId&&<div style={errStyle}>{errs.loginId}</div>}
      </div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>비밀번호</label>
        <input style={{...inp,borderColor:errs.pw?T.danger:T.border}} type="password" value={acct.pw} onChange={e=>setA('pw',e.target.value)} placeholder="4자 이상"/>
        {errs.pw&&<div style={errStyle}>{errs.pw}</div>}
      </div>
      <div style={{marginBottom:20}}>
        <label style={lbl}>비밀번호 확인</label>
        <input style={{...inp,borderColor:errs.pw2?T.danger:T.border}} type="password" value={acct.pw2} onChange={e=>setA('pw2',e.target.value)} placeholder="비밀번호 재입력"/>
        {errs.pw2&&<div style={errStyle}>{errs.pw2}</div>}
      </div>
      <button onClick={nextStep1} style={{width:'100%',padding:13,borderRadius:T.radius.lg,border:'none',background:T.primary,color:'#fff',fontSize:T.fs.md,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>
        다음 — 사업장 등록 →
      </button>
      <button onClick={onBack} style={{background:'none',border:'none',fontSize:T.fs.sm,color:T.gray400,cursor:'pointer',marginTop:12,fontFamily:'inherit'}}>← 로그인으로 돌아가기</button>
    </div>
  );

  if (step===2) return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      <StepBar/>
      <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,marginBottom:4}}>사업장 등록</div>
      <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:16,lineHeight:1.5}}>운영하시는 브랜드명과 지점을 등록해주세요.</div>
      <div style={{marginBottom:16}}>
        <label style={lbl}>브랜드명 <span style={{color:T.danger}}>*</span></label>
        <input style={inp} value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="예: 하우스왁싱"/>
      </div>
      <div style={{marginBottom:10,display:'flex',flexDirection:'column',gap:8}}>
        {branches.map((b,i)=>(
          <div key={i} style={{border:'1.5px solid '+(i===0?T.primary:T.border),borderRadius:T.radius.lg,padding:'12px 14px',background:i===0?T.primaryHover:'#fff',position:'relative'}}>
            <div style={{fontSize:10,fontWeight:800,color:T.primary,marginBottom:4}}>지점 {i+1}</div>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>{b.name}</div>
            {b.phone&&<div style={{fontSize:T.fs.xxs,color:T.textSub,marginTop:2}}>{b.phone}</div>}
            {i>0&&<button onClick={()=>removeBranch(i)} style={{position:'absolute',top:8,right:10,background:'none',border:'none',cursor:'pointer',color:T.gray400,fontSize:16}}>×</button>}
          </div>
        ))}
      </div>
      {showAddForm ? (
        <div style={{border:'1.5px solid '+T.border,borderRadius:T.radius.lg,padding:'14px',marginBottom:10,background:'#fafafa'}}>
          <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,marginBottom:10,color:T.text}}>지점 등록</div>
          <div style={{marginBottom:10}}>
            <label style={lbl}>지점 이름 <span style={{color:T.danger}}>*</span></label>
            <input style={{...inp,borderColor:errs.addName?T.danger:T.border}} value={addName} onChange={e=>{setAddName(e.target.value);setErr('addName','')}} placeholder="예: 강남점"/>
            {errs.addName&&<div style={errStyle}>{errs.addName}</div>}
          </div>
          <div style={{marginBottom:12}}>
            <label style={lbl}>전화번호 (선택)</label>
            <input style={inp} value={addPhone} onChange={e=>setAddPhone(e.target.value)} placeholder="02-0000-0000"/>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={addBranchItem} style={{flex:1,padding:'10px',borderRadius:T.radius.lg,border:'none',background:T.primary,color:'#fff',fontSize:T.fs.sm,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>등록</button>
            <button onClick={()=>{setShowAddForm(false);setAddName('');setAddPhone('');setErr('addName','');}} style={{padding:'10px 16px',borderRadius:T.radius.lg,border:'1px solid '+T.border,background:'#fff',color:T.gray600,fontSize:T.fs.sm,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
          </div>
        </div>
      ) : (
        branches.length < 3 && (
          <button onClick={()=>setShowAddForm(true)} style={{width:'100%',padding:11,border:'1.5px dashed #ccc',borderRadius:T.radius.lg,background:'none',color:T.textMuted,fontSize:T.fs.sm,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:10,fontFamily:'inherit'}}>
            + 지점 등록 ({branches.length}/3)
          </button>
        )
      )}
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,textAlign:'center',marginBottom:14}}>지점은 최대 <b style={{color:T.primary}}>3개</b>까지 등록할 수 있어요</div>
      <button onClick={submit} disabled={saving||branches.length===0||!bizName.trim()}
        style={{width:'100%',padding:13,borderRadius:T.radius.lg,border:'none',
          background:(saving||branches.length===0||!bizName.trim())?T.gray200:'linear-gradient(135deg,#7c7cc8,#9b9be0)',
          color:(saving||branches.length===0||!bizName.trim())?T.gray400:'#fff',
          fontSize:T.fs.md,fontWeight:T.fw.bolder,cursor:saving||branches.length===0?'not-allowed':'pointer',fontFamily:'inherit'}}>
        {saving?'처리 중...':'완료 — 시작하기 →'}
      </button>
      <button onClick={()=>setStep(1)} style={{background:'none',border:'none',fontSize:T.fs.sm,color:T.gray400,cursor:'pointer',marginTop:10,fontFamily:'inherit'}}>← 이전</button>
    </div>
  );

  return (
    <div style={{textAlign:'center',padding:'20px 0',display:'flex',flexDirection:'column',alignItems:'center',gap:16}}>
      <div style={{fontSize:56}}>🎉</div>
      <div style={{fontSize:T.fs.xxl,fontWeight:T.fw.black,color:T.successDk||T.primary}}>가입 완료!</div>
      <div style={{fontSize:T.fs.sm,color:T.gray600,lineHeight:1.8}}>
        <b style={{color:T.text}}>{acct.name}</b>님,<br/>14일 무료 체험이 시작되었습니다.
      </div>
      <div style={{width:'60%',height:4,background:'#e0e0f0',borderRadius:T.radius.sm,overflow:'hidden'}}>
        <div style={{height:'100%',background:T.primary,borderRadius:T.radius.sm,width:'100%',animation:'loadingBar 1.8s linear forwards'}}/>
      </div>
    </div>
  );
}


function App() {
  const [phase, setPhase] = useState("loading");
 // loading, login, super, app
  const [pageHistory, setPageHistory] = React.useState([]);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentBizId, setCurrentBizId] = useState(null);
  const [currentBiz, setCurrentBiz] = useState(null);
  const [data, setData] = useState(null);
  const dataRef = useRef(null); // 항상 최신 data를 참조 (클로저 문제 방지)
  useEffect(() => { dataRef.current = data; }, [data]);
  const [superData, setSuperData] = useState(null);
  const [role, setRole] = useState("staff");
  const [userBranches, setUserBranches] = useState([]);
  const isMaster = role === "owner" || role === "super" || role === "manager";
  const [viewBranches, setViewBranches] = useState([]);
  const [page, setPageRaw] = useState(() => {
    try { const p = sessionStorage.getItem("bliss_page"); console.log("[SESSION] page restore:", p); return p || "timeline"; } catch(e){ return "timeline"; }
  });
  const [pendingOpenRes, setPendingOpenRes] = useState(null);
  const [serverV, setServerV] = useState(null);
  const [scraperStatus, setScraperStatus] = useState(null); // {lastSeen, lastScraped, isAlive, isWarning}
  const [naverColShow, setNaverColShowRaw] = useState(()=>{ try{return JSON.parse(localStorage.getItem("bliss_naver_cols")||"null")||{};}catch(e){return{};} });
  const [sideOpen, setSideOpen] = useState(false);
  const [loadMsg, setLoadMsg] = useState("연결 중...");
  useEffect(() => {
    const BR_ACC = {"br_4bcauqvrb":"101171979","br_wkqsxj6k1":"102071377","br_l6yzs2pkq":"102507795",
      "br_k57zpkbx1":"101521969","br_lfv2wgdf1":"101522539","br_g768xdu4w":"101517367",
      "br_ybo3rmulv":"101476019","br_xu60omgdf":"101988152"};
    const accIds = (userBranches||[]).map(b=>BR_ACC[b]).filter(Boolean);
    const SOCIAL_CH = ["whatsapp","telegram","instagram","kakao"];
    const load = () => {
      // userBranches 아직 안 로드됐으면 스킵 (isMaster는 전체 허용)
      if(accIds.length===0 && !isMaster && userBranches !== null) { setUnreadMsgCount(0); return; }
      fetch(SB_URL+"/rest/v1/naver_messages?is_read=eq.false&direction=eq.in&select=id,account_id,channel&limit=999",
        {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY,"Cache-Control":"no-cache"},cache:"no-store"})
        .then(r=>r.json())
        .then(arr=>{
          if(!Array.isArray(arr)) return;
          // 네이버(지점 필터) + 소셜채널(전체 허용) 합산
          const count = arr.filter(m =>
            SOCIAL_CH.includes(m.channel) || accIds.length===0 || accIds.includes(String(m.account_id))
          ).length;
          setUnreadMsgCount(count);
        })
        .catch(()=>{});
    };
    load();
    // 10초 폴링 (Realtime 실패 대비)
    const poll = setInterval(load, 10000);
    // Realtime: INSERT/UPDATE 시 재카운트
    const rt = window._sbClient?.channel("unread_badge")
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"naver_messages"},
        p=>{ if(p?.new?.direction==="in"&&!p?.new?.is_read) load(); }
      )
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"naver_messages"},
        p=>{ if(p?.new?.is_read===true) load(); }
      )?.subscribe();
    return ()=>{ clearInterval(poll); try{rt?.unsubscribe();}catch(e){} };
  }, [userBranches, isMaster]);
  // App Badge API — 홈화면 아이콘 배지 (미읽 메시지 + 확정대기 예약)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const pendingRes = (data?.reservations||[]).filter(r => {
      if (r.status !== 'pending') return false;
      if (isMaster) return true;
      return (userBranches||[]).includes(r.branch_id);
    }).length;
    const total = unreadMsgCount + pendingRes;
    if (total > 0) navigator.setAppBadge(total).catch(()=>{});
    else navigator.clearAppBadge().catch(()=>{});
  }, [unreadMsgCount, data, userBranches, isMaster]);
  // server_logs에서 서버 버전 + 스크래퍼 상태 1분마다 폴링
  React.useEffect(()=>{
    const fetchServerV = async ()=>{
      try {
        const r = await fetch(`${SB_URL}/rest/v1/server_logs?select=extra,updated_at,scraper_status,last_processed&order=updated_at.desc&limit=5`,{headers:sbHeaders});
        const rows = await r.json();
        const oracleRow = rows?.find(r=>r.extra?.scraper_version) || rows?.[0];
        if (oracleRow?.extra?.scraper_version) setServerV(oracleRow.extra.scraper_version);
        if (oracleRow?.updated_at) {
          const lastSeen = new Date(oracleRow.updated_at);
          const lastScraped = oracleRow.last_processed ? new Date(oracleRow.last_processed) : null;
          const diffH = (Date.now() - lastSeen.getTime()) / 3600000;
          const scrapedDiffH = lastScraped ? (Date.now() - lastScraped.getTime()) / 3600000 : 999;
          const scraper = oracleRow.scraper_status || "";
          // 서버가 6시간 이상 응답 없거나 DEAD면 세션 죽은 것
          const isSessionDead = scraper.includes("DEAD") || scraper.includes("error") || diffH > 6;
          // last_processed가 없고 서버가 살아있으면 경고 안 띄움 (방금 시작한 것)
          const isScrapingStale = lastScraped ? scrapedDiffH > 12 : false;
          const isWarning = isSessionDead || isScrapingStale;
          setScraperStatus({
            lastSeen, lastScraped, diffH, scrapedDiffH,
            isAlive: !isWarning, isWarning, isSessionDead, isScrapingStale,
            statusText: scraper
          });
        }
      } catch(e){}
    };
    fetchServerV();
    const t = setInterval(fetchServerV, 60000);
    return ()=>clearInterval(t);
  },[]);
  const setNaverColShow = v => { setNaverColShowRaw(v); try{localStorage.setItem("bliss_naver_cols",JSON.stringify(v));}catch(e){} };
  const setPage = useCallback((p) => {
    console.log("[SESSION] page save:", p);
    setPageRaw(prev => {
      if (prev && prev !== p) setPageHistory(h => [...h.slice(-9), prev]);
      return p;
    });
    try { sessionStorage.setItem("bliss_page", p); } catch(e){}
    try { window.history.pushState({page: p}, ""); } catch(e){}
  }, []);

  React.useEffect(() => {
    const onPop = () => {
      setPageHistory(h => {
        if (h.length === 0) return h;
        const prev = h[h.length - 1];
        setPageRaw(prev);
        try { sessionStorage.setItem("bliss_page", prev); } catch(e){}
        return h.slice(0, -1);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Page is persisted directly via setPage → sessionStorage.setItem("bliss_page")

  // Safe version check (runs after React mount, no DOM conflict)
// Safe version check — 새 버전 감지 시 자동 새로고침
  useEffect(() => {
  let timer;
  const check = () => {
  fetch("/bliss/version.txt?t=" + Date.now())
    .then(r => r.text())
    .then(remote => {
      remote = remote.trim();
      // bliss-app은 별도 배포 - 자동 새로고침 비활성화
      // if (remote && remote !== BLISS_V) { location.reload(true); }
    }).catch(() => {});
  timer = setTimeout(check, 30000);
  };
  timer = setTimeout(check, 5000);
  return () => clearTimeout(timer);
  }, []);

  // Phase 1: Load all users on mount + auto-login from saved session
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      try {
        // 시스템 Gemini 키 사전 로드 (가입 OCR용)
        try {
          const cfg = await sb.get("businesses", "&code=eq.__system__");
          if (cfg.length > 0) {
            const m = JSON.parse(cfg[0].settings || "{}");
            if (m.system_gemini_key) { window.__systemGeminiKey = m.system_gemini_key; }
          }
        } catch(e) {}
        const users = fromDb("app_users", await sb.get("app_users"));
        if (users.length === 0) {
          setAllUsers([{id:"acc_super", loginId:"admin", pw:"1234", name:"Bliss 관리자", role:"super", branches:[], viewBranches:[]}]);
          setPhase("login");
        } else {
          setAllUsers(users);
          // Check saved session for auto-login
          try {
            const saved = JSON.parse(localStorage.getItem("bliss_session")||"null");
            console.log("Session restore:", saved);
            if (saved?.userId) {
              const u = users.find(u => u.id === saved.userId);
              if (u) {
                console.log("Auto-login:", u.role, "bizId:", saved.bizId);
                handleLogin(u, true); return;
              }
            }
          } catch(e){}
          setPhase("login");
        }
      } catch(e) {
        console.error("DB 연결 실패:", e);
        setAllUsers([{id:"acc_super", loginId:"admin", pw:"1234", name:"Bliss 관리자", role:"super", branches:[], viewBranches:[]}]);
        setPhase("login");
      }
    })();
  }, []);

  // Handle login → route to super dashboard or business app
  const handleLogin = async (user, isAutoLogin) => {
    setCurrentUser(user);
    setRole(user.role);
    // Save session only on manual login (auto-login already has session)
    if (!isAutoLogin) {
      try{localStorage.setItem("bliss_session",JSON.stringify({userId:user.id,loginId:user.loginId||user.login_id}));}catch(e){}
    }
    if (user.role === "super") {
      setLoadMsg("매장 데이터 로딩 중...");
      setPhase("loading");
      try {
        // 세션에 저장된 bizId 또는 housewaxing 업체로 바로 진입
        let targetBiz;
        try { targetBiz = JSON.parse(localStorage.getItem("bliss_session")||"{}").bizId; } catch(e){}
        if (!targetBiz) {
          // businesses 목록에서 housewaxing 찾기
          const bizList = await sb.get("businesses", "");
          const hw = bizList.find(b => b.code === "housewaxing" || (b.name && b.name.includes("하우스왁싱")));
          targetBiz = hw?.id || bizList.find(b => b.id !== "biz_system")?.["id"];
        }
        if (targetBiz) { handleEnterBiz(targetBiz); return; }
        // fallback: 슈퍼 화면
        const sd = await loadAllFromDb(null);
        setSuperData(sd);
        setPhase("super");
      } catch(e) {
        console.error(e);
        setSuperData({ businesses:[], groups:[], groupMembers:[], users:[] });
        setPhase("super");
      }
    } else {
      const bizId = user.businessId || user.business_id || "biz_khvurgshb";
      if (!bizId) { alert("사업자 연결 정보가 없습니다."); setPhase("login"); return; }
      setCurrentBizId(bizId);
      setActiveBiz(bizId);
      setLoadMsg("매장 데이터 로딩 중...");
      setPhase("loading");
      try {
        // Load business info
        const bizList = await sb.get("businesses", `&id=eq.${bizId}`);
        setCurrentBiz(bizList[0] || { name: "매장" });
        // businesses.settings에서 gemini_key / ai_rules 복원 (localStorage 삭제 후 복구)
        try {
          const memo = JSON.parse(bizList[0]?.settings || "{}");
          if (memo.gemini_key) {
            localStorage.setItem("bliss_gemini_key", memo.gemini_key);
            window.__geminiKey = memo.gemini_key;
            console.log("✅ Gemini key 복원");
          }
          const AI_RULES_KEY = "bliss_ai_rules";
          if (memo.ai_rules?.length && !localStorage.getItem(AI_RULES_KEY)) {
            localStorage.setItem(AI_RULES_KEY, JSON.stringify(memo.ai_rules));
            console.log("✅ AI 규칙 복원:", memo.ai_rules.length + "개");
          }
        } catch(e) {}
        // Load business data
        const db = await loadAllFromDb(bizId);
        const staff = db.rooms.map(r => ({ id: r.id, dn: r.name, bid: r.branch_id }));
        resolveSystemIds(db.serviceTags, db.resSources);
        // ── 시스템 예약경로: 네이버 ──
        if (!db.resSources.find(s=>s.name===SYSTEM_SRC_NAME_NAVER)) {
          const ns={id:"src_naver_sys",name:SYSTEM_SRC_NAME_NAVER,color:T.naver,useYn:true,sort:0};
          db.resSources=[ns,...db.resSources.map((s,i)=>({...s,sort:i+1}))];
          sb.insert("reservation_sources",{id:ns.id,business_id:_activeBizId,name:ns.name,color:ns.color,use_yn:true,sort:0}).catch(()=>{});
          resolveSystemIds(db.serviceTags, db.resSources);
        } else {
          const ni=db.resSources.findIndex(s=>s.name===SYSTEM_SRC_NAME_NAVER);
          if(ni>0){const [ns]=db.resSources.splice(ni,1);db.resSources=[{...ns,sort:0},...db.resSources.map((s,i)=>({...s,sort:i+1}))];resolveSystemIds(db.serviceTags,db.resSources);}
        }
        // ── 시스템 태그: 신규, 예약금완료 (없으면 자동 생성) ──
        const ensureTag = (name, color, scheduleYn="N") => {
          if (!db.serviceTags.find(t=>t.name===name && t.scheduleYn!=="Y")) {
            const nt={id:`tag_sys_${name}`,name,color,useYn:true,scheduleYn};
            db.serviceTags=[...db.serviceTags,nt];
            sb.upsert("service_tags",[{id:nt.id,business_id:_activeBizId,name,color,use_yn:true,schedule_yn:scheduleYn}]);
            resolveSystemIds(db.serviceTags, db.resSources);
          }
        };
        ensureTag(SYSTEM_TAG_NAME_NEW_CUST, T.primary);
        ensureTag(SYSTEM_TAG_NAME_PREPAID,  T.success);
        setData({
          branches: db.branches, rooms: db.rooms, services: db.services, products: db.products,
          categories: db.cats, serviceTags: db.serviceTags,
          branchSettings: db.branches.map(b => ({...b, useYn: b.use_yn !== false})),
          users: db.users, customers: db.customers, reservations: db.reservations, sales: db.sales,
          staff, resSources: db.resSources || [],
        });
        setUserBranches((user.role === "owner" || user.role === "super") ? db.branches.map(b=>b.id) : (user.branches || []));
        setViewBranches(user.viewBranches || []);
        // page is already restored from sessionStorage("bliss_page") via useState initializer
        setPhase("app");
      } catch(e) {
        console.error("Data load error:", e);
        setLoadMsg("데이터 로딩 실패");
      }
    }
  };

  // Super admin: enter a specific business
  const handleEnterBiz = async (bizId) => {
    try{const s=JSON.parse(localStorage.getItem("bliss_session")||"{}");s.bizId=bizId;localStorage.setItem("bliss_session",JSON.stringify(s));}catch(e){}
    setLoadMsg("매장 데이터 로딩 중...");
    setPhase("loading");
    try {
      const bizList = await sb.get("businesses", `&id=eq.${bizId}`);
      setCurrentBiz(bizList[0] || { name: "매장" });
      setCurrentBizId(bizId);
      setActiveBiz(bizId);
      const db = await loadAllFromDb(bizId);
      const staff = db.rooms.map(r => ({ id: r.id, dn: r.name, bid: r.branch_id }));
      resolveSystemIds(db.serviceTags, db.resSources);
      if (!db.resSources.find(s=>s.name===SYSTEM_SRC_NAME_NAVER)) {
        const ns={id:"src_naver_sys",name:SYSTEM_SRC_NAME_NAVER,color:T.naver,useYn:true,sort:0};
        db.resSources=[ns,...db.resSources.map((s,i)=>({...s,sort:i+1}))];
        sb.insert("reservation_sources",{id:ns.id,business_id:_activeBizId,name:ns.name,color:ns.color,use_yn:true,sort:0}).catch(()=>{});
        resolveSystemIds(db.serviceTags, db.resSources);
      } else {
        const ni=db.resSources.findIndex(s=>s.name===SYSTEM_SRC_NAME_NAVER);
        if(ni>0){const [ns]=db.resSources.splice(ni,1);db.resSources=[{...ns,sort:0},...db.resSources.map((s,i)=>({...s,sort:i+1}))];resolveSystemIds(db.serviceTags,db.resSources);}
      }
      const ensureTag2 = (name, color, scheduleYn="N") => {
        if (!db.serviceTags.find(t=>t.name===name && t.scheduleYn!=="Y")) {
          const nt={id:`tag_sys_${name}`,name,color,useYn:true,scheduleYn};
          db.serviceTags=[...db.serviceTags,nt];
          sb.upsert("service_tags",[{id:nt.id,business_id:_activeBizId,name,color,use_yn:true,schedule_yn:scheduleYn}]);
          resolveSystemIds(db.serviceTags, db.resSources);
        }
      };
      ensureTag2(SYSTEM_TAG_NAME_NEW_CUST, T.primary);
      ensureTag2(SYSTEM_TAG_NAME_PREPAID,  T.success);
      setData({
        branches: db.branches, rooms: db.rooms, services: db.services, products: db.products,
        categories: db.cats, serviceTags: db.serviceTags,
        branchSettings: db.branches.map(b => ({...b, useYn: b.use_yn !== false})),
        users: db.users, customers: db.customers, reservations: db.reservations, sales: db.sales,
        staff, resSources: db.resSources || [],
      });
      setRole("owner"); // super acts as owner inside a business
      setUserBranches(db.branches.map(b => b.id));
      setViewBranches([]);
      // page is already restored from sessionStorage("bliss_page") via useState initializer
      setPhase("app");
    } catch(e) { console.error(e); setPhase("super"); }
  };

  const handleLogout = () => {
    try{localStorage.removeItem("bliss_session");sessionStorage.removeItem("bliss_page");sessionStorage.removeItem("bliss_adminTab");}catch(e){}
    setCurrentUser(null); setCurrentBizId(null); setCurrentBiz(null);
    setData(null); setSuperData(null); setRole("staff");
    setUserBranches([]); setViewBranches([]); setPage("timeline");
    setActiveBiz(null);
    setPhase("login");
  };

  // ─── 복사/선택 방지 ───
  useEffect(() => {
    const prevent = e => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") e.preventDefault(); };
    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    return () => { document.removeEventListener("copy", prevent); document.removeEventListener("cut", prevent); };
  }, []);




  // ─── 예약 실시간 동기화 ───
  useEffect(() => {
    if (phase !== "app" || !currentBizId) return;
    let channel = null;
    const supaClient = _supaClient;

    // iOS PWA: 백그라운드→포그라운드 복귀 시 한번만 fetch
    const onVisible = async () => {
      if (!document.hidden) {
        try {
          const rows = await sb.get("reservations", `&business_id=eq.${currentBizId}&order=date.desc,time.asc&limit=3000`);
          const parsed = fromDb("reservations", rows);
          setData(prev => prev ? {...prev, reservations: parsed} : prev);
        } catch(e) {}
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Realtime 구독
    if (supaClient) {
      try {
        channel = supaClient.channel("rt_" + Date.now())
          .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: "business_id=eq." + currentBizId }, (payload) => {
            const ev = payload.eventType;
            const row = payload.new || {};
            const oldRow = payload.old || {};
            setData(prev => {
              if (!prev) return prev;
              try {
                const parsed = row.id ? fromDb("reservations", [row])[0] : null;
                if (ev === "INSERT" && parsed) {
                  // 새 예약 → 즉시 알림 (네이버 예약이면 status 무관)
                  if (parsed.source === "naver" || parsed.source === "네이버") {
                    try {
                      const isPending = parsed.status === "pending";
                      if (window.__blissAlertDiv) window.__blissAlertDiv.remove();
                      const div = document.createElement("div");
                      window.__blissAlertDiv = div;
                      const bg = isPending ? "#ff9800" : "#4CAF50";
                      const label = isPending ? "확정대기" : "새 예약";
                      div.innerHTML = `<div style="position:fixed;top:20px;right:20px;z-index:99999;background:${bg};color:#fff;padding:16px 24px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.3);font-size:15px;font-weight:800;animation:slideIn .3s;cursor:pointer;max-width:350px;" onclick="this.parentElement.remove()">🔔 ${label}<br><span style="font-size:13px;font-weight:500;">${parsed.custName||"네이버 예약"} ${parsed.date||""} ${parsed.time||""}</span></div>`;
                      document.body.appendChild(div);
                      setTimeout(()=>{ try{div.remove();}catch(e){} }, 20000);
                      try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Nk4yGfHJ0fIaNkImBd3F2gIqRjYaCeHR4gImQi4R/d3V5goqPi4N+d3Z6g4uPioJ9d3d7hIyOiYF8d3h8hY2NiIF8eHl9hoyMh4B7eXp+h42LhX96ent/iIyKhH56e3yAiYuJg356fH2BiomHgn17fH6Ci4iGgX17fX+Di4eFgH18foGEioSDf3x9f4KFiYOCfn1+gIOGiIKBfn5/gYSHh4GAf39/goWGhYB/f4CBg4aFhIB/gICCg4WEg39/gIGDhISCf3+AgYKDhIOBf4CBgoOEg4F/gIGCg4SDgX+AgYKDg4OBf4CCgoODgoF/gIGCg4OCgX+AgoKDg4KBf4CCgoODgoF/gIGCg4OCgX+AgYKDg4KBf4CBgoKDgoF/gIGCgoOCgX+AgYKCg4KBf4CBgoKDgoF/gIGCgoOCgX+AgYKCg4KBf4CBgoKCgoF/gIGCgoKCgX+AgYKCgoKBf4CBgoKCgoF/gIGCgoKCgX+AgYKCgoKBgICBgoKCgoGAgIGCgoKCgYCAgYKCgoKBgICBgoKCgoGAgIGCgoKCgYCAgYKCgoKBgA==").play(); } catch(e){}
                    } catch(e){}
                  }
                  if (isModalOpenRef.current) {
                    if (!pendingRTQueueRef.current.some(q=>q.ev==="INSERT"&&q.data.id===parsed.id)) {
                      pendingRTQueueRef.current = [...pendingRTQueueRef.current, {ev:"INSERT",data:parsed}];
                      setRtPendingCount(pendingRTQueueRef.current.length);
                    }
                    return prev;
                  }
                  if ((prev?.reservations||[]).some(r => r.id === parsed.id)) return prev;
                  return {...prev, reservations: [...(prev?.reservations||[]), parsed]};
                }
                if (ev === "UPDATE" && parsed) {
                  if (isModalOpenRef.current) {
                    pendingRTQueueRef.current = [
                      ...pendingRTQueueRef.current.filter(q=>!(q.ev==="UPDATE"&&q.data.id===parsed.id)),
                      {ev:"UPDATE",data:parsed}
                    ];
                    setRtPendingCount(pendingRTQueueRef.current.length);
                    return prev;
                  }
                  const before = (prev?.reservations||[]).find(r => r.id === parsed.id);
                  const isNaver = parsed.source === "naver" || parsed.source === "네이버";
                  return {...prev, reservations: (prev?.reservations||[]).map(r => r.id === parsed.id ? {...r, ...parsed} : r)};
                }
                if (ev === "DELETE") {
                  const delId = oldRow.id;
                  return delId ? {...prev, reservations: (prev?.reservations||[]).filter(r => r.id !== delId)} : prev;
                }
              } catch(e) {}
              return prev;
            });
          })
          .subscribe((status) => {
            console.log("RT:", status);
          });
      } catch(e) { console.log("RT setup error:", e); }
    }

    // 예약 폴링 (15초) — Realtime 실패 대비
    const resPoll = setInterval(async () => {
      try {
        const rows = await sb.get("reservations", `&business_id=eq.${currentBizId}&order=date.desc,time.asc&limit=3000`);
        const parsed = fromDb("reservations", rows);
        setData(prev => {
          if (!prev) return prev;
          const oldRes = prev.reservations || [];
          const oldIds = new Set(oldRes.map(r=>r.id));
          const changed = parsed.length !== oldRes.length
            || parsed.some(r => { const o = oldRes.find(x=>x.id===r.id); return !o || o.status !== r.status || o.memo !== r.memo || o.naverConfirmedDt !== r.naverConfirmedDt; });
          if (changed) {
            // 새 예약 or 확정대기 감지 → 알림
            const newPending = parsed.filter(r => r.status === "pending" && !oldIds.has(r.id));
            const newConfirmed = parsed.filter(r => r.status === "confirmed" && oldRes.find(x=>x.id===r.id && x.status==="pending"));
            if (newPending.length > 0) {
              const names = newPending.map(r=>r.custName||"고객").join(", ");
              if (window.__blissAlertDiv) window.__blissAlertDiv.remove();
              const div = document.createElement("div");
              div.id = "bliss-new-res-alert";
              window.__blissAlertDiv = div;
              div.innerHTML = `<div style="position:fixed;top:20px;right:20px;z-index:99999;background:#ff9800;color:#fff;padding:16px 24px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.3);font-size:15px;font-weight:800;animation:slideIn .3s;cursor:pointer;max-width:350px;" onclick="this.parentElement.remove()">🔔 새 예약 ${newPending.length}건 (확정대기)<br><span style="font-size:13px;font-weight:500;">${names}</span></div>`;
              document.body.appendChild(div);
              setTimeout(()=>{ try{div.remove();}catch(e){} }, 15000);
              // 소리
              try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Nk4yGfHJ0fIaNkImBd3F2gIqRjYaCeHR4gImQi4R/d3V5goqPi4N+d3Z6g4uPioJ9d3d7hIyOiYF8d3h8hY2NiIF8eHl9hoyMh4B7eXp+h42LhX96ent/iIyKhH56e3yAiYuJg356fH2BiomHgn17fH6Ci4iGgX17fX+Di4eFgH18foGEioSDf3x9f4KFiYOCfn1+gIOGiIKBfn5/gYSHh4GAf39/goWGhYB/f4CBg4aFhIB/gICCg4WEg39/gIGDhISCf3+AgYKDhIOBf4CBgoOEg4F/gIGCg4SDgX+AgYKDg4OBf4CCgoODgoF/gIGCg4OCgX+AgoKDg4KBf4CCgoODgoF/gIGCg4OCgX+AgYKDg4KBf4CBgoKDgoF/gIGCgoOCgX+AgYKCg4KBf4CBgoKDgoF/gIGCgoOCgX+AgYKCg4KBf4CBgoKCgoF/gIGCgoKCgX+AgYKCgoKBf4CBgoKCgoF/gIGCgoKCgX+AgYKCgoKBgICBgoKCgoGAgIGCgoKCgYCAgYKCgoKBgICBgoKCgoGAgIGCgoKCgYCAgYKCgoKBgA==").play(); } catch(e){}
            }
          }
          return changed ? {...prev, reservations: parsed} : prev;
        });
      } catch(e) {}
    }, 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(resPoll);
      if (channel && supaClient) { try { supaClient.removeChannel(channel); } catch(e){} }
    };
  }, [phase, currentBizId]);


  const handleBackToSuper = async () => {
    try{const s=JSON.parse(localStorage.getItem("bliss_session")||"{}");delete s.bizId;localStorage.setItem("bliss_session",JSON.stringify(s));}catch(e){}
    setLoadMsg("관리자 데이터 로딩 중...");
    setPhase("loading");
    const sd = await loadAllFromDb(null);
    setSuperData(sd);
    setRole("super");
    setCurrentBizId(null); setCurrentBiz(null); setData(null); setActiveBiz(null);
    setPhase("super");
  };

  if (phase === "loading") return <Loading msg={loadMsg} />;
  if (phase === "login") return <Login users={allUsers} onLogin={handleLogin} onSignup={async (newUser) => {
    setAllUsers(prev => [...prev, newUser]);
    await handleLogin(newUser);
  }} />;
  if (phase === "super") return <SuperDashboard superData={superData} setSuperData={setSuperData} currentUser={currentUser} onLogout={handleLogout} onEnterBiz={handleEnterBiz} />;

  // Phase: app (owner or staff)

  const S = {
    root: { display:"flex", height:"100dvh", fontFamily:"'Pretendard',-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif", background:T.gray100, color:T.text, overflow:"hidden", position:"fixed", top:0, left:0, right:0, bottom:0 },
    sidebar: { width:200, background:T.bgCard, borderRight:"1px solid "+T.border, display:"flex", flexDirection:"column", height:"100dvh", flexShrink:0, position:"fixed", left:0, top:0, bottom:0, zIndex:200 },
    main: { flex:1, marginLeft:200, display:"flex", flexDirection:"column", height:"100dvh", minHeight:0, background:T.bgCard, overflow:"hidden" },
    mobHdr: { padding:"10px 16px", background:T.bgCard, display:"flex", alignItems:"center", gap:12 },
    menuBtn: { background:"none", border:"none", color:T.text, cursor:"pointer", fontSize:22, fontFamily:"inherit" }
  }
  if (!data) return <Loading msg="데이터 로딩 중..." />;

  const isSuper = currentUser?.role === "super";
  const nav = [
    { id:"timeline", label:"타임라인", icon:<I name="calendar" size={16}/> },
    { id:"reservations", label:"예약목록", icon:<I name="clipboard" size={16}/> },
    { id:"sales", label:"매출관리", icon:<I name="wallet" size={16}/> },
    { id:"stats", label:"매출통계", icon:<I name="chart" size={16}/> },
    { id:"customers", label:"고객관리", icon:<I name="users" size={16}/> },
    ...(isMaster?[{ id:"users", label:"사용자관리", icon:<I name="user" size={16}/> }]:[]),
    { id:"messages", label:"받은메시지함", icon:<I name="msgSq" size={16}/>, badge:unreadMsgCount },
    { id:"admin", label:"관리설정", icon:<I name="settings" size={16}/> },
  ];

  const branchNames = userBranches.map(bid => (data.branches||[]).find(b=>b.id===bid)?.short||bid).filter(Boolean).join(", ");
  const bizName = currentBiz?.name || "";

  return (
    <div style={S.root}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      <aside className="sidebar-d" style={S.sidebar}>
        <Sidebar nav={nav} page={page} setPage={setPage} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV}/>
      </aside>
      {sideOpen && <div className="sidebar-m" style={{position:"fixed",inset:0,zIndex:300}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={()=>setSideOpen(false)}/>
        <div style={{position:"relative",width:260,height:"100%",background:T.bgCard,display:"flex",flexDirection:"column",animation:"slideIn .5s cubic-bezier(.22,1,.36,1)"}}>
          <Sidebar nav={nav} page={page} setPage={p=>{setPage(p);setSideOpen(false)}} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV}/>
        </div>
      </div>}
      <main className="main-c" style={S.main}>
        <div className="mob-hdr" style={{display:"none"}}></div>
        <div className="page-pad" style={{flex:1,padding:(page==="timeline"||page==="messages")?"0":"16px 20px 16px",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
          <div className={page==="timeline"?"":"fade-in"} key={page} style={page==="timeline"?{flex:1,display:"flex",flexDirection:"column",minHeight:0}:{overflow:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>
            {page==="timeline" && <Timeline data={data} setData={setData} userBranches={userBranches} viewBranches={viewBranches} isMaster={isMaster} currentUser={currentUser} setPage={setPage} bizId={currentBizId} onMenuClick={()=>setSideOpen(true)} bizName={bizName} pendingOpenRes={pendingOpenRes} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} scraperStatus={scraperStatus}/>}
            {page==="reservations" && <ReservationList data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} setNaverColShow={setNaverColShow}/>}
            {page==="sales" && <SalesPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage}/>}
            {page==="stats" && <StatsPage data={data} userBranches={userBranches} isMaster={isMaster} role={role}/>}
            {page==="customers" && <CustomersPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster}/>}
            {page==="users" && <UsersPage data={data} setData={setData} bizId={currentBizId}/>}
            {page==="messages" && <AdminInbox sb={sb} branches={data?.branches} data={data} userBranches={userBranches} isMaster={isMaster} onRead={(cnt)=>setUnreadMsgCount(prev=>Math.max(0,prev-(cnt||1)))} onChatOpen={setIsChatOpen}/>}
            {page==="admin" && <AdminPage data={data} setData={setData} bizId={currentBizId} serverV={serverV} onLogout={handleLogout} currentUser={currentUser}/>}
          </div>
        </div>
      </main>
      <div className="hide-mobile" style={{position:"fixed",bottom:"calc(56px + env(safe-area-inset-bottom) + 2px)",left:0,right:0,height:16,display:isChatOpen?"none":"flex",alignItems:"center",justifyContent:"center",gap:6,zIndex:199,pointerEvents:"none"}}>
        <span style={{fontSize:9,color:T.danger,fontWeight:800,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff"}}>v{BLISS_V}</span>
        <span style={{fontSize:9,color:serverV?"#03C75A":T.textMuted,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff"}}>서버 {serverV?`v${serverV}`:"…"}</span>
        {scraperStatus && <span style={{fontSize:9,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff",color:scraperStatus.isWarning?"#E65100":T.textMuted,fontWeight:scraperStatus.isWarning?800:400}}>{scraperStatus.isWarning?"⚠️":"✅"}{scraperStatus.lastScraped?(()=>{const h=Math.floor(scraperStatus.scrapedDiffH);const m=Math.floor((scraperStatus.scrapedDiffH%1)*60);return h>0?`${h}h${m>0?` ${m}m`:""} 전`:`${m}m 전`;})():"스크래핑 기록없음"}</span>}
      </div>
      <MobileBottomNav nav={nav} page={page} setPage={setPage} isChatOpen={isChatOpen}/>
    </div>
  );
}

function MobileBottomNav({ nav, page, setPage, isChatOpen=false }) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  if(isChatOpen) return null;
  const mainItems = [
    ...(nav.find(n=>n.id==="timeline")    ? [{id:"timeline",   label:"타임라인", icon:"calendar"}]  : []),
    ...(nav.find(n=>n.id==="reservations")? [{id:"reservations",label:"예약목록",  icon:"clipboard"}] : []),
    ...(nav.find(n=>n.id==="messages")    ? [{id:"messages",   label:"메시지함",  icon:"msgSq", badge: nav.find(n=>n.id==="messages")?.badge||0}] : []),
    ...(nav.find(n=>n.id==="customers")   ? [{id:"customers",  label:"고객관리",  icon:"users"}]     : []),
  ];
  const moreItems = nav.filter(n=>!["timeline","reservations","messages","customers"].includes(n.id));
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
      <nav className="mob-bottom-nav" style={{position:"fixed",bottom:0,left:0,right:0,background:T.bgCard,borderTop:`1px solid ${T.border}`,zIndex:100,display:"flex",alignItems:"center",paddingTop:8,paddingBottom:"calc(10px + env(safe-area-inset-bottom, 0px))",paddingLeft:"env(safe-area-inset-left, 0px)",paddingRight:"env(safe-area-inset-right, 0px)"}}>
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

// ─── Sidebar ───

function Sidebar({ nav, page, setPage, role, branchNames, onLogout, bizName="", isSuper=false, onBackToSuper, serverV, scraperStatus=null }) {
  const cats = [
    { label:"예약 관리", items: nav.filter(n=>["timeline","reservations"].includes(n.id)) },
    { label:"고객 관리", items: nav.filter(n=>["customers"].includes(n.id)) },
    { label:"매출 관리", items: nav.filter(n=>["sales","stats"].includes(n.id)) },
    ...(nav.find(n=>n.id==="admin") ? [{ label:"시스템", items: nav.filter(n=>["users","messages","admin"].includes(n.id)) }] : []),
  ];
  return <>
    <div style={{padding:`${T.sp.lg}px ${T.sp.lg}px ${T.sp.md}px`,borderBottom:`1px solid ${T.border}`}}>
      {bizName ? <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.primary,letterSpacing:-.5}}>{bizName}</div>
        : <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.primary}}>Bliss</div>}
      <div style={{fontSize:T.fs.sm,color:T.textSub,marginTop:4}}>{role==="owner"?"대표 관리자":role==="super"?"슈퍼관리자":role==="manager"?"지점 원장":branchNames||"직원"}</div>
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
    <div style={{padding:T.sp.md,borderTop:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:6}}>
      {isSuper && <Btn variant="outline" size="sm" onClick={onBackToSuper} style={{width:"100%"}}><I name="arrowL" size={14}/> 관리자 대시보드</Btn>}
      <Btn variant="ghost" size="sm" onClick={onLogout} style={{width:"100%",color:T.textSub}}>로그아웃</Btn>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,textAlign:"center",marginTop:2,lineHeight:1.8}}>
        <span style={{color:T.danger}}>앱 v{BLISS_V}</span><br/>
        <span style={{color:serverV?"#03C75A":T.textMuted}}>서버 {serverV?`v${serverV}`:"연결중…"}</span>
        {scraperStatus && <><br/>
          <span style={{color:scraperStatus.isWarning?"#E65100":T.textMuted,fontWeight:scraperStatus.isWarning?700:400}}>
            {scraperStatus.isWarning?"⚠️ ":"✅ "}스크래핑{" "}
            {scraperStatus.lastScraped
              ? (()=>{const h=Math.floor(scraperStatus.scrapedDiffH);const m=Math.floor((scraperStatus.scrapedDiffH%1)*60);return h>0?`${h}시간${m>0?` ${m}분`:""} 전`:`${m}분 전`;})()
              : "기록 없음"}
          </span>
        </>}
      </div>
    </div>
  </>;
}

// ═══════════════════════════════════════════
// TIMELINE VIEW (myCream-style)
// ═══════════════════════════════════════════
function MiniCal({ selDate, onSelect, onClose }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(selDate); return { y: d.getFullYear(), m: d.getMonth() };
  });
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, [onClose]);
  const { y, m } = viewDate;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  const weeks = [];
  let week = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }
  const prevM = () => setViewDate(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 });
  const nextM = () => setViewDate(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 });
  const dayNames = ["일","월","화","수","목","금","토"];
  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) ref.current.style.left = "auto";
      if (rect.right > window.innerWidth - 8) ref.current.style.right = "0";
      if (rect.right > window.innerWidth - 8) ref.current.style.transform = "none";
      if (rect.left < 8) { ref.current.style.left = "0"; ref.current.style.transform = "none"; }
    }
  }, []);
  return <div ref={ref} style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",zIndex:100,background:T.bgCard,border:"1px solid #d0d0d0",borderRadius:T.radius.md,boxShadow:"0 8px 24px rgba(0,0,0,.15)",padding:10,width:250,marginTop:4}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
      <button onClick={prevM} style={{background:"none",border:"none",cursor:"pointer",padding:4,color:T.gray600}}><I name="chevL" size={14}/></button>
      <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>{y}년 {m+1}월</span>
      <button onClick={nextM} style={{background:"none",border:"none",cursor:"pointer",padding:4,color:T.gray600}}><I name="chevR" size={14}/></button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,textAlign:"center"}}>
      {dayNames.map((dn,i) => <div key={dn} style={{fontSize:T.fs.xs,fontWeight:T.fw.bold,color:i===0?T.female:i===6?T.primary:T.gray500,padding:"2px 0"}}>{dn}</div>)}
      {weeks.flat().map((d, i) => {
        if (!d) return <div key={"e"+i}/>;
        const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const isSel = ds === selDate;
        const isToday = ds === today;
        const dow = new Date(y, m, d).getDay();
        return <button key={i} onClick={() => onSelect(ds)} style={{
          width:30,height:30,margin:"1px auto",borderRadius:"50%",border:isToday&&!isSel?"1.5px solid #7c7cc8":"none",
          background:isSel?T.primary:"transparent",color:isSel?T.bgCard:dow===0?T.female:dow===6?T.primary:T.text,
          fontSize:T.fs.sm,fontWeight:isSel||isToday?700:400,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"
        }}>{d}</button>;
      })}
    </div>
  </div>;
}


export default App
