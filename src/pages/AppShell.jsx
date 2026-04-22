import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { T, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../lib/sb'
import { supabase as _supaClient } from '../lib/supabase'
import { fromDb, resolveSystemIds, setActiveBiz, _activeBizId } from '../lib/db'
import Timeline from '../components/Timeline/TimelinePage'
import ReservationList from '../components/Reservations/ReservationsPage'
import AdminInbox from '../components/Messages/MessagesPage'
import { todayStr, pad, genId, useScrollRestore } from '../lib/utils'
import I from '../components/common/I'
import { AdminPage, UsersPage as UsersPageReal } from '../components/Reservations/ReservationsPage'
import { Btn, Loading, GridLayout, DataTable, FLD } from '../components/common'
import SalesPage from '../components/Sales/SalesPage'
import CustomersPage from '../components/Customers/CustomersPage'
import MobileBottomNav from '../components/Navigation/MobileBottomNav'
import Sidebar from '../components/Navigation/Sidebar'
import SchedulePage from '../components/Schedule/SchedulePage'
import SetupWizard from '../components/SetupWizard/SetupWizard'
import BlissAI from '../components/BlissAI/BlissAI'
import BlissRequests from '../components/BlissRequests/BlissRequests'

const uid = genId;
const BLISS_V = "3.6.25"

// 라우트별 스크롤 위치 자동 유지 (새로고침 시 복원)
function ScrollArea({ storageKey, children }) {
  const ref = useScrollRestore(storageKey)
  return <div ref={ref} className="fade-in" style={{overflow:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>{children}</div>
}
const BIZ_ID = 'biz_khvurgshb'
const PAGE_ROUTES = { timeline:"/timeline", reservations:"/reservations", sales:"/sales", customers:"/customers", users:"/users", messages:"/messages", admin:"/settings", wizard:"/wizard", schedule:"/schedule", requests:"/requests", blissai:"/blissai" };
// 과거 데이터 백그라운드 로드 (초기 14d/30d 이전 예약/매출) — UI 렌더 후 머지
async function loadHistoricalInBackground(bizId, setData) {
  const resBefore = new Date(Date.now()-14*86400000).toISOString().slice(0,10);
  const salBefore = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const salSince  = new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  try {
    const [oldRes, oldSal] = await Promise.all([
      sb.getAll("reservations", `&business_id=eq.${bizId}&date=lt.${resBefore}&order=date.desc,time.asc`).catch(()=>[]),
      sb.getAll("sales", `&business_id=eq.${bizId}&date=gte.${salSince}&date=lt.${salBefore}&order=date.desc`).catch(()=>[]),
    ]);
    if (!oldRes.length && !oldSal.length) return;
    const mappedRes = fromDb("reservations", oldRes);
    const mappedSal = fromDb("sales", oldSal);
    setData(prev => prev ? {
      ...prev,
      reservations: [...(prev.reservations||[]), ...mappedRes.filter(r => !(prev.reservations||[]).some(x => x.id === r.id))],
      sales: [...(prev.sales||[]), ...mappedSal.filter(s => !(prev.sales||[]).some(x => x.id === s.id))],
    } : prev);
  } catch(e) { console.warn("[historical load]", e); }
}

async function loadAllFromDb(bizId) {
  const [branches, services, categories, tags, sources, users, rooms, customers, reservations, sales, products, branchGroups] = await Promise.all([
    sb.getByBiz("branches", bizId).catch(()=>[]),
    sb.getByBiz("services", bizId).catch(()=>[]),
    sb.getByBiz("service_categories", bizId).catch(()=>[]),
    sb.getByBiz("service_tags", bizId).catch(()=>[]),
    sb.getByBiz("reservation_sources", bizId).catch(()=>[]),
    sb.getByBiz("app_users", bizId).catch(()=>[]),
    sb.getByBiz("rooms", bizId).catch(()=>[]),
    sb.get("customers", `&business_id=eq.${bizId}&is_hidden=eq.false&order=join_date.desc.nullslast,created_at.desc&limit=100`).catch(()=>[]),
    sb.get("reservations", `&business_id=eq.${bizId}&order=date.desc,time.asc&limit=3000`).catch(()=>[]),
    sb.get("sales", `&business_id=eq.${bizId}&date=gte.${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}&order=date.desc&limit=5000`).catch(()=>[]),
    sb.getByBiz("products", bizId).catch(()=>[]),
    sb.getByBiz("branch_groups", bizId).catch(()=>[]),
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
    branchGroups: Array.isArray(branchGroups) ? branchGroups : [],
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
          {/* 소셜 로그인 */}
          <button onClick={()=>{import('../lib/supabase').then(m=>m.supabase.auth.signInWithOAuth({provider:'kakao',options:{redirectTo:window.location.origin+'/'}}))}} style={{width:"100%",height:48,display:"flex",alignItems:"center",justifyContent:"center",gap:10,background:"#FEE500",color:"#3C1E1E",border:"none",borderRadius:T.radius.md,fontSize:T.fs.md,fontWeight:T.fw.bold,cursor:"pointer",fontFamily:"inherit"}}>💬 카카오로 시작하기</button>
          <button onClick={()=>{import('../lib/supabase').then(m=>m.supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/'}}))}} style={{width:"100%",height:48,display:"flex",alignItems:"center",justifyContent:"center",gap:10,background:"#fff",color:"#333",border:`1px solid ${T.border}`,borderRadius:T.radius.md,fontSize:T.fs.md,fontWeight:T.fw.bold,cursor:"pointer",fontFamily:"inherit"}}>🔍 Google로 시작하기</button>
          {/* 구분선 */}
          <div style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}><div style={{flex:1,height:1,background:T.border}}/><span style={{fontSize:T.fs.xs,color:T.textMuted}}>또는</span><div style={{flex:1,height:1,background:T.border}}/></div>
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
    if (!bizName.trim()) { alert('브랜드명을 입력해주세요.'); return; }
    // 지점 없으면 브랜드명으로 기본 지점 자동 생성
    const finalBranches = branches.length > 0 ? branches : [{name: bizName.trim(), phone: ''}];
    setSaving(true);
    try {
      const ex = await sb.get('app_users','&login_id=eq.'+encodeURIComponent(acct.loginId));
      if (ex.length > 0) { alert('이미 사용 중인 아이디입니다.'); setSaving(false); return; }
      const bizId = 'biz_'+uid();
      const oId = 'acc_'+uid();
      const exp = new Date(); exp.setDate(exp.getDate()+14);
      await sb.insert('businesses', {
        id: bizId, name: bizName.trim(), code: acct.loginId, phone: finalBranches[0].phone||'',
        settings: JSON.stringify({ plan:'trial', planExpiry: exp.toISOString().slice(0,10) }), use_yn: true
      });
      const brIds = [];
      for (let i=0; i<finalBranches.length; i++) {
        const brId = 'br_'+uid();
        brIds.push(brId);
        await sb.insert('branches', {
          id: brId, business_id: bizId, name: finalBranches[i].name, short: finalBranches[i].name.slice(0,5),
          phone: finalBranches[i].phone||'', sort: i, use_yn: true
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
        <input style={{...inp,borderColor:errs.loginId?T.danger:T.border}} value={acct.loginId} onChange={e=>setA('loginId',e.target.value.toLowerCase())} placeholder="예: myshop"/>
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
      <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:16,lineHeight:1.5}}>사업장 정보를 등록해주세요.</div>
      <div style={{marginBottom:16}}>
        <label style={lbl}>브랜드명 <span style={{color:T.danger}}>*</span></label>
        <input style={inp} value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="브랜드 또는 상호명"/>
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
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,textAlign:'center',marginBottom:14}}>여러 지점이 있으면 추가해주세요 (선택)</div>
      <button onClick={submit} disabled={saving||!bizName.trim()}
        style={{width:'100%',padding:13,borderRadius:T.radius.lg,border:'none',
          background:(saving||!bizName.trim())?T.gray200:'linear-gradient(135deg,#7c7cc8,#9b9be0)',
          color:(saving||!bizName.trim())?T.gray400:'#fff',
          fontSize:T.fs.md,fontWeight:T.fw.bolder,cursor:saving?'not-allowed':'pointer',fontFamily:'inherit'}}>
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
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [pendingReqCount, setPendingReqCount] = useState(0);
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
  const page = useMemo(() => {
    const p = location.pathname.replace(/^\//, "").split("/")[0] || "timeline";
    if (p === "settings") return "admin";
    return Object.keys(PAGE_ROUTES).includes(p) ? p : "timeline";
  }, [location.pathname]);
  const [pendingOpenRes, setPendingOpenRes] = useState(null);
  const [pendingOpenCust, setPendingOpenCust] = useState(null); // 고객관리 페이지에서 자동 오픈할 cust_id
  const [pendingChat, setPendingChat] = useState(null); // {user_id, channel, account_id}
  const [serverV, setServerV] = useState(null);
  const [scraperStatus, setScraperStatus] = useState(null); // {lastSeen, lastScraped, isAlive, isWarning}
  const [naverColShow, setNaverColShowRaw] = useState(()=>{ try{return JSON.parse(localStorage.getItem("bliss_naver_cols")||"null")||{};}catch(e){return{};} });
  // DB에서 컬럼 설정 복원 (localStorage보다 우선)
  useEffect(()=>{
    if(!data?.businesses?.[0]?.settings) return;
    try{
      const s = typeof data.businesses[0].settings === 'string' ? JSON.parse(data.businesses[0].settings) : data.businesses[0].settings;
      if(s?.naver_col_show && typeof s.naver_col_show === 'object'){
        setNaverColShowRaw(s.naver_col_show);
        try{localStorage.setItem("bliss_naver_cols",JSON.stringify(s.naver_col_show));}catch(e){}
      }
    }catch(e){}
  },[data?.businesses]);
  const [sideOpen, setSideOpen] = useState(false);
  const [loadMsg, setLoadMsg] = useState("연결 중...");
  useEffect(() => {
    // data.branches에서 동적으로 계정 매핑
    const accIds = (userBranches||[]).map(bid => (data?.branches||[]).find(b=>b.id===bid)?.naverAccountId).filter(Boolean);
    const SOCIAL_CH = ["whatsapp","telegram","instagram","kakao"];
    const load = () => {
      // userBranches 아직 안 로드됐으면 스킵 (isMaster는 전체 허용)
      if(accIds.length===0 && !isMaster && userBranches !== null) { setUnreadMsgCount(0); return; }
      fetch(SB_URL+"/rest/v1/messages?is_read=eq.false&direction=eq.in&select=id,account_id,channel&limit=999",
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
    // Realtime: INSERT/UPDATE 시 재카운트
    const rt = window._sbClient?.channel("unread_badge")
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},
        p=>{ if(p?.new?.direction==="in"&&!p?.new?.is_read) load(); }
      )
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},
        p=>{ if(p?.new?.is_read===true) load(); }
      )?.subscribe();
    return ()=>{ try{rt?.unsubscribe();}catch(e){} };
  }, [userBranches, isMaster]);
  // 수정요청 pending 카운트
  useEffect(() => {
    const load = () => {
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.bliss_requests_v1&select=value`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer "+SB_KEY, "Cache-Control":"no-cache" },
        cache: "no-store",
      }).then(r=>r.json()).then(rows=>{
        const v = rows?.[0]?.value;
        if (!v) { setPendingReqCount(0); return; }
        const list = typeof v === "string" ? JSON.parse(v) : (Array.isArray(v) ? v : []);
        const cnt = Array.isArray(list) ? list.filter(r => r.status === "pending").length : 0;
        setPendingReqCount(cnt);
      }).catch(()=>{});
    };
    load();
    const rt = window._sbClient?.channel("requests_badge")
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"schedule_data",filter:"key=eq.bliss_requests_v1"}, load)
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"schedule_data",filter:"key=eq.bliss_requests_v1"}, load)
      ?.subscribe();
    const poll = setInterval(load, 60_000);
    return () => { try{rt?.unsubscribe();}catch(e){} clearInterval(poll); };
  }, []);
  // 팀채팅 공지(📣) Realtime — is_announce=true 신규 메시지 → 전체 화면 배너
  useEffect(() => {
    const supaClient = window._sbClient;
    if (!supaClient) return;
    const DISMISS_KEY = 'bliss_dismissed_announces';
    const getDismissed = () => {
      try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
    };
    const addDismissed = (id) => {
      const s = getDismissed(); s.add(id);
      const arr = [...s].slice(-200);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify(arr)); } catch {}
    };
    const AUTO_DISMISS_MS = 60 * 60 * 1000; // 1시간 후 자동 닫힘
    const showAnnounce = (row) => {
      if (!row || !row.is_announce) return;
      if (getDismissed().has(row.id)) return;
      const existingKey = '__blissAnnounce_' + row.id;
      if (window[existingKey]) return;
      const div = document.createElement('div');
      window[existingKey] = div;
      const esc = (s) => String(s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
      div.innerHTML = `<div style="position:fixed;top:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#ff9800,#f57c00);color:#fff;padding:14px 20px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:14px;font-weight:700;cursor:pointer;max-width:340px;max-height:60vh;overflow-y:auto;animation:slideIn .3s;border:2px solid #fff8e1;">📣 ${esc(row.user_id)} 공지<div style="font-size:13px;font-weight:500;margin-top:4px;white-space:pre-wrap;word-break:break-word;">${esc(row.body)}</div><div style="font-size:10px;opacity:.75;margin-top:6px;">탭하면 닫힘 · 1시간 후 자동 종료</div></div>`;
      const dismiss = () => {
        addDismissed(row.id);
        try { div.remove(); } catch {}
        try { clearTimeout(window[existingKey + '_to']); } catch {}
        delete window[existingKey];
        delete window[existingKey + '_to'];
      };
      div.addEventListener('click', dismiss, { once: true });
      window[existingKey + '_to'] = setTimeout(dismiss, AUTO_DISMISS_MS);
      document.body.appendChild(div);
    };
    // 최근 공지(5분 이내, dismiss 안 된 것)만 복원 — Realtime 붙기 전 갭 보정용
    (async () => {
      try {
        const since = new Date(Date.now() - AUTO_DISMISS_MS).toISOString();
        const { data } = await supaClient.from('team_chat_messages')
          .select('id,user_id,body,created_at,is_announce')
          .eq('is_announce', true).gte('created_at', since)
          .order('created_at', { ascending: true }).limit(20);
        (data || []).forEach(showAnnounce);
      } catch {}
    })();
    const ch = supaClient.channel('rt_announce_' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' },
        (payload) => { if (payload?.new?.is_announce) showAnnounce(payload.new); })
      .subscribe();
    return () => { try { supaClient.removeChannel(ch); } catch {} };
  }, []);

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
  const setNaverColShow = v => {
    setNaverColShowRaw(v);
    try{localStorage.setItem("bliss_naver_cols",JSON.stringify(v));}catch(e){}
    // DB에도 저장 (businesses.settings)
    try{
      const biz = data?.businesses?.[0];
      if(biz){
        const s = typeof biz.settings === 'string' ? JSON.parse(biz.settings||"{}") : (biz.settings||{});
        s.naver_col_show = v;
        sb.update("businesses", biz.id, {settings: JSON.stringify(s)}).catch(()=>{});
      }
    }catch(e){}
  };
  const setPage = useCallback((p) => {
    const url = PAGE_ROUTES[p] || "/timeline";
    navigate(url);
  }, [navigate]);

  // 새 버전 감지 — 자동 새로고침 대신 배너 표시
  const [newVer, setNewVer] = useState(null);
  const [reloadCountdown, setReloadCountdown] = useState(0);
  useEffect(() => {
    let timer;
    const check = () => {
      fetch("/version.txt?t=" + Date.now(), {cache: "no-store", headers: {"Cache-Control": "no-cache"}})
        .then(r => r.ok ? r.text() : "")
        .then(remote => {
          remote = remote.trim();
          if (remote && remote !== BLISS_V) setNewVer(remote);
        }).catch(() => {});
      timer = setTimeout(check, 15000); // 15초마다 체크 (강제 업데이트 빠르게)
    };
    timer = setTimeout(check, 3000);
    return () => clearTimeout(timer);
  }, []);
  // 새 버전 감지 시 1분 카운트다운 후 강제 새로고침
  useEffect(() => {
    if (!newVer) return;
    setReloadCountdown(60);
    const tick = setInterval(() => {
      setReloadCountdown(c => {
        if (c <= 1) {
          clearInterval(tick);
          try { window.location.href = window.location.pathname + "?v=" + newVer; }
          catch(e) { window.location.reload(); }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [newVer]);

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
          // OAuth 리다이렉트 체크 (Google/Kakao 로그인 후 돌아온 경우) — 5초 타임아웃
          let authSession = null;
          try {
            const res = await Promise.race([
              _supaClient.auth.getSession(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("auth_timeout")), 5000))
            ]);
            authSession = res?.data?.session || null;
          } catch(e) { console.warn("[auth.getSession] timeout/err:", e?.message); }
          if (authSession?.user) {
            const authUser = authSession.user;
            const email = authUser.email || '';
            const authId = authUser.id;
            const provider = authUser.app_metadata?.provider || 'oauth';
            // 이메일 또는 login_id(provider_xxx)로 기존 유저 검색
            let oauthUser = email ? users.find(u => u.email === email) : null;
            if (!oauthUser) oauthUser = users.find(u => u.login_id?.startsWith(provider + '_'));
            if (!oauthUser) {
              // 신규 OAuth 유저 → 자동 계정 생성
              const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.user_metadata?.preferred_username || (email ? email.split('@')[0] : provider + '사용자');
              const bizId = 'biz_' + uid(); const brId = 'br_' + uid(); const accId = 'acc_' + uid();
              const loginId = provider + '_' + uid();
              const bizName = name + '님의 사업장';
              const exp = new Date(); exp.setDate(exp.getDate() + 14);
              await sb.insert('businesses', { id: bizId, name: bizName, code: loginId, phone: '', settings: JSON.stringify({ plan:'trial', planExpiry: exp.toISOString().slice(0,10) }), use_yn: true });
              await sb.insert('branches', { id: brId, business_id: bizId, name: bizName, short: name.slice(0,5), phone: '', sort: 0, use_yn: true });
              await sb.insert('app_users', { id: accId, business_id: bizId, login_id: loginId, password: uid(), name, role: 'owner', email: email || null, branch_ids: JSON.stringify([brId]), view_branch_ids: JSON.stringify([brId]) });
              const newUsers = fromDb("app_users", await sb.get("app_users"));
              setAllUsers(newUsers);
              oauthUser = newUsers.find(u => u.id === accId);
              sessionStorage.setItem('bliss_new_oauth_user', 'true');
            }
            if (oauthUser) { handleLogin(oauthUser, true); return; }
          }
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
          }
          const AI_RULES_KEY = "bliss_ai_rules";
          if (memo.ai_rules?.length && !localStorage.getItem(AI_RULES_KEY)) {
            localStorage.setItem(AI_RULES_KEY, JSON.stringify(memo.ai_rules));
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
          sb.upsert("reservation_sources",[{id:ns.id,business_id:_activeBizId,name:ns.name,color:ns.color,use_yn:true,sort:0}]);
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
          businesses: bizList,
          branches: db.branches, rooms: db.rooms, services: db.services, products: db.products,
          categories: db.cats, serviceTags: db.serviceTags,
          branchSettings: db.branches.map(b => ({...b, useYn: b.use_yn !== false})),
          users: db.users, customers: db.customers, reservations: db.reservations, sales: db.sales,
          staff, resSources: db.resSources || [],
          branchGroups: db.branchGroups || [],
        });
        // 권한: owner/super=전지점, manager=본인 branch_ids만
        const userBids = (() => {
          let b = user.branch_ids || user.branches;
          if (typeof b === "string") { try { b = JSON.parse(b); } catch(e) { b = []; } }
          return Array.isArray(b) ? b.filter(Boolean) : [];
        })();
        const isPrivileged = user.role === "super" || user.role === "owner";
        setUserBranches(isPrivileged || userBids.length === 0 ? db.branches.map(b=>b.id) : userBids);
        setViewBranches([]);
        // page is derived from URL via useLocation()
        setPhase("app");
        // 새 OAuth 유저 → 설정 마법사 자동 시작
        if (sessionStorage.getItem('bliss_new_oauth_user')) {
          sessionStorage.removeItem('bliss_new_oauth_user');
          setTimeout(() => setPage("wizard"), 500);
        }
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
        sb.upsert("reservation_sources",[{id:ns.id,business_id:_activeBizId,name:ns.name,color:ns.color,use_yn:true,sort:0}]);
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
        businesses: bizList,
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
    try{localStorage.removeItem("bliss_session");}catch(e){}
    navigate("/timeline", {replace:true});
    setCurrentUser(null); setCurrentBizId(null); setCurrentBiz(null);
    setData(null); setSuperData(null); setRole("staff");
    setUserBranches([]); setViewBranches([]); setPage("timeline");
    setActiveBiz(null);
    setPhase("login");
  };

  // ─── 타임라인에서만 복사/선택 방지, 그 외(모달/목록)는 허용 ───
  useEffect(() => {
    const prevent = e => {
      const el = e.target;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (el.closest(".tl-grid, .tl-block, .tl-col-header, nav, aside")) e.preventDefault();
    };
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
          const rows = await sb.getAll("reservations", `&business_id=eq.${currentBizId}&order=date.desc,time.asc`);
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
            console.log("[RT] reservation", ev, row?.id||oldRow?.id, row?.time, "bid=", row?.bid);
            setData(prev => {
              if (!prev) return prev;
              try {
                const parsed = row.id ? fromDb("reservations", [row])[0] : null;
                if (ev === "INSERT" && parsed) {
                  // 네이버 신규 예약 알림
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
                    } catch(e){}
                  }
                  if ((prev?.reservations||[]).some(r => r.id === parsed.id)) return prev;
                  return {...prev, reservations: [...(prev?.reservations||[]), parsed]};
                }
                if (ev === "UPDATE" && parsed) {
                  return {...prev, reservations: (prev?.reservations||[]).map(r => r.id === parsed.id ? {...r, ...parsed} : r)};
                }
                if (ev === "DELETE") {
                  const delId = oldRow.id;
                  return delId ? {...prev, reservations: (prev?.reservations||[]).filter(r => r.id !== delId)} : prev;
                }
              } catch(e) { console.error("[RT] handler error:", e); }
              return prev;
            });
          })
          .subscribe((status, err) => {
            console.log("[RT reservations]:", status, err||"");
            if (status === "SUBSCRIBED") console.log("[RT] ✓ 실시간 동기화 시작");
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.error("[RT] ✗ 채널 오류:", status, err);
              // 재연결 시도
              setTimeout(() => {
                try { channel?.subscribe(); } catch(e) {}
              }, 3000);
            }
          });
      } catch(e) { console.error("[RT] setup error:", e); }
    }

    // 연결 복귀 시 1회 재동기화 (네트워크 끊김 후 재연결용)
    const onOnline = async () => {
      try {
        const rows = await sb.getAll("reservations", `&business_id=eq.${currentBizId}&order=date.desc,time.asc`);
        const parsed = fromDb("reservations", rows);
        setData(prev => prev ? {...prev, reservations: parsed} : prev);
      } catch(e) {}
    };
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (channel && supaClient) { try { supaClient.removeChannel(channel); } catch(e){} }
    };
  }, [phase, currentBizId]);


  const handleBackToSuper = async () => {
    try{const s=JSON.parse(localStorage.getItem("bliss_session")||"{}");delete s.bizId;localStorage.setItem("bliss_session",JSON.stringify(s));}catch(e){}
    setLoadMsg("관리자 데이터 로딩 중...");
    setPhase("loading");
    try {
      const sd = await loadAllFromDb(null);
      setSuperData(sd);
      setRole("super");
      setCurrentBizId(null); setCurrentBiz(null); setData(null); setActiveBiz(null);
      setPhase("super");
    } catch(e) {
      console.error("handleBackToSuper error:", e);
      setPhase("super");
    }
  };

  if (phase === "loading") return <Loading msg={loadMsg} />;
  if (phase === "login") return <Login users={allUsers} onLogin={handleLogin} onSignup={async (newUser) => {
    setAllUsers(prev => [...prev, newUser]);
    await handleLogin(newUser);
    setTimeout(() => setPage("wizard"), 500); // 가입 직후 설정 마법사 자동 시작
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
    { id:"customers", label:"고객관리", icon:<I name="users" size={16}/> },
    ...((role==="owner"||role==="super")?[{ id:"users", label:"사용자관리", icon:<I name="user" size={16}/> }]:[]),
    { id:"messages", label:"받은메시지함", icon:<I name="msgSq" size={16}/>, badge:unreadMsgCount },
    { id:"blissai", label:"블리스 AI", icon:"🤖" },
    { id:"admin", label:"관리설정", icon:<I name="settings" size={16}/> },
    { id:"requests", label:"공지 & 요청", icon:"📢", badge:pendingReqCount },
  ];

  const branchNames = userBranches.map(bid => (data.branches||[]).find(b=>b.id===bid)?.short||bid).filter(Boolean).join(", ");
  const bizName = currentBiz?.name || "";

  return (
    <div style={S.root}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      <aside className="sidebar-d" style={S.sidebar}>
        <Sidebar nav={nav} page={page} setPage={setPage} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV} BLISS_V={BLISS_V}/>
      </aside>
      {sideOpen && <div className="sidebar-m" style={{position:"fixed",inset:0,zIndex:300}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={()=>setSideOpen(false)}/>
        <div style={{position:"relative",width:260,height:"100%",background:T.bgCard,display:"flex",flexDirection:"column",animation:"slideIn .5s cubic-bezier(.22,1,.36,1)"}}>
          <Sidebar nav={nav} page={page} setPage={p=>{setPage(p);setSideOpen(false)}} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV} BLISS_V={BLISS_V} isMobile/>
        </div>
      </div>}
      {newVer && <div onClick={()=>{try{window.location.href=window.location.pathname+"?v="+newVer;}catch(e){window.location.reload();}}} style={{position:"fixed",top:10,right:10,zIndex:9999,background:T.primary,color:"#fff",padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.25)",animation:"ovFadeIn .3s"}}>
        🔄 새 버전 v{newVer} {reloadCountdown > 0 ? `(${reloadCountdown}초 후 자동 업데이트)` : "— 즉시 업데이트"}
      </div>}
      <main className="main-c" style={S.main}>
        <div className="mob-hdr" style={{display:"none"}}></div>
        <div className="page-pad" style={{flex:1,padding:(page==="timeline"||page==="messages"||page==="schedule")?"0":"16px 20px 16px",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
          <Routes>
            <Route path="/timeline" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><Timeline data={data} setData={setData} userBranches={userBranches} viewBranches={viewBranches} isMaster={isMaster} currentUser={currentUser} setPage={setPage} bizId={currentBizId} onMenuClick={()=>setSideOpen(true)} bizName={bizName} pendingOpenRes={pendingOpenRes} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} scraperStatus={scraperStatus} setPendingChat={setPendingChat} setPendingOpenCust={setPendingOpenCust}/></div>}/>
            <Route path="/reservations" element={<ScrollArea storageKey="page_reservations"><ReservationList data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} setNaverColShow={setNaverColShow}/></ScrollArea>}/>
            <Route path="/sales" element={<ScrollArea storageKey="page_sales"><SalesPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage} role={role} setPendingOpenCust={setPendingOpenCust}/></ScrollArea>}/>
            <Route path="/customers" element={<ScrollArea storageKey="page_customers"><CustomersPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} pendingOpenCust={pendingOpenCust} setPendingOpenCust={setPendingOpenCust}/></ScrollArea>}/>
            <Route path="/users" element={<ScrollArea storageKey="page_users"><UsersPage data={data} setData={setData} bizId={currentBizId}/></ScrollArea>}/>
            <Route path="/messages" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><AdminInbox sb={sb} branches={data?.branches} data={data} userBranches={userBranches} isMaster={isMaster} onRead={(cnt)=>setUnreadMsgCount(prev=>Math.max(0,prev-(cnt||1)))} onChatOpen={setIsChatOpen} pendingChat={pendingChat} onPendingChatDone={()=>setPendingChat(null)} setPendingOpenRes={setPendingOpenRes} setPage={setPage}/></div>}/>
            <Route path="/schedule" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>{isMaster && <SchedulePage/>}</div>}/>
            <Route path="/settings/*" element={<ScrollArea storageKey="page_settings"><AdminPage data={data} setData={setData} bizId={currentBizId} serverV={serverV} onLogout={handleLogout} currentUser={currentUser} userBranches={userBranches}/></ScrollArea>}/>
            <Route path="/wizard" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><SetupWizard bizId={currentBizId} bizName={bizName} geminiKey={(() => { try { return window.__systemGeminiKey || window.__geminiKey || JSON.parse(currentBiz?.settings||'{}').gemini_key || localStorage.getItem('bliss_gemini_key') || ''; } catch { return ''; } })()} sb={sb} data={data} setData={setData} onComplete={()=>setPage("timeline")} onClose={()=>setPage("timeline")}/></div>}/>
            <Route path="/requests" element={<ScrollArea storageKey="page_requests"><BlissRequests data={data} currentUser={currentUser} userBranches={userBranches} isMaster={isMaster}/></ScrollArea>}/>
            <Route path="/blissai" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}><BlissAI data={data} currentUser={currentUser} userBranches={userBranches} isMaster={isMaster} bizId={currentBizId}/></div>}/>
            <Route path="*" element={<Navigate to="/timeline" replace/>}/>
          </Routes>
        </div>
      </main>
      <MobileBottomNav nav={nav} page={page} setPage={setPage} isChatOpen={isChatOpen}/>
    </div>
  );
}


// ═══════════════════════════════════════════
// TIMELINE VIEW (myCream-style)
// ═══════════════════════════════════════════
export function MiniCal({ selDate, onSelect, onClose }) {
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
