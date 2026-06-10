import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { T, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../lib/sb'
import { supabase as _supaClient } from '../lib/supabase'
import { fromDb, resolveSystemIds, setActiveBiz, _activeBizId } from '../lib/db'
import { refreshBranchesSch } from '../components/Schedule/scheduleConstants'
import { setFeatures, extractFeatures } from '../lib/features'
import Timeline from '../components/Timeline/TimelinePage'
import ReservationList from '../components/Reservations/ReservationsPage'
import AdminInbox from '../components/Messages/MessagesPage'
import { todayStr, pad, genId, useScrollRestore } from '../lib/utils'
import I from '../components/common/I'
import { AdminPage, UsersPage as UsersPageReal } from '../components/Reservations/ReservationsPage'
import { Btn, Loading, GridLayout, DataTable, FLD } from '../components/common'
import SalesPage from '../components/Sales/SalesPage'
import SaleSummary from '../components/Sales/SaleSummary'
import CustomersPage from '../components/Customers/CustomersPage'
import MobileBottomNav from '../components/Navigation/MobileBottomNav'
import Sidebar from '../components/Navigation/Sidebar'
import SchedulePage from '../components/Schedule/SchedulePage'
import SetupWizard from '../components/SetupWizard/SetupWizard'
import BlissAI from '../components/BlissAI/BlissAI'
import FloatingAI from '../components/BlissAI/FloatingAI'
import QuickRequest from '../components/common/QuickRequest'
import BlissRequests from '../components/BlissRequests/BlissRequests'
import MarketingBroadcast from '../components/Marketing/MarketingBroadcast'

const uid = genId;
const BLISS_V = "3.8.46"

// 라우트별 스크롤 위치 자동 유지 (새로고침 시 복원)
function ScrollArea({ storageKey, children }) {
  const ref = useScrollRestore(storageKey)
  return <div ref={ref} className="fade-in" style={{overflow:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>{children}</div>
}
const PAGE_ROUTES = { timeline:"/timeline", reservations:"/reservations", sales:"/sales", customers:"/customers", marketing:"/marketing", users:"/users", messages:"/messages", admin:"/settings", schedule:"/schedule", requests:"/requests", blissai:"/blissai" };
// reservations 테이블엔 대용량 JSONB 없음 (snapshot_data는 sales 테이블에만 존재)
// type/is_schedule/source/repeat 등 필터링 필수 컬럼이 누락되면 화면 비어짐 → * 사용이 안전
const RES_SELECT = "*";

async function loadAllFromDb(bizId) {
  // ⚡ 초기 블로킹 로드 — reservations 제외. 30일+미래 ~8천건/10MB/~3.3초라 첫 렌더를 막음.
  // 예약은 setPhase("app") 직후 loadReservations()로 백그라운드 보충.
  // (타임라인 첫 화면은 자체 on-demand fetch로 동작 → 전역 reservations 없어도 무방)
  const [branches, services, categories, tags, sources, users, rooms, customers, snsCustomers, sales, products, branchGroups] = await Promise.all([
    sb.getByBiz("branches", bizId).catch(()=>[]),
    sb.getByBiz("services", bizId).catch(()=>[]),
    sb.getByBiz("service_categories", bizId).catch(()=>[]),
    sb.getByBiz("service_tags", bizId).catch(()=>[]),
    sb.getByBiz("reservation_sources", bizId).catch(()=>[]),
    sb.getByBiz("app_users_safe", bizId).catch(()=>[]),
    sb.getByBiz("rooms", bizId).catch(()=>[]),
    sb.get("customers", `&business_id=eq.${bizId}&is_hidden=eq.false&order=join_date.desc.nullslast,created_at.desc&limit=100`).catch(()=>[]),
    // SNS 실제 연결된 고객만 (빈 배열 제외) — 부분 인덱스로 빠름
    sb.get("customers", `&business_id=eq.${bizId}&is_hidden=eq.false&sns_accounts=neq.${encodeURIComponent('[]')}&limit=500`).catch(()=>[]),
    sb.getAll("sales", `&business_id=eq.${bizId}&date=gte.${new Date(Date.now()-14*86400000).toISOString().slice(0,10)}&order=date.desc`).catch(()=>[]),
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
    customers: (() => {
      // 메인 100명 + SNS 연결된 고객 병합 (id 중복 제거)
      const main = fromDb("customers", customers) || [];
      const sns = fromDb("customers", snsCustomers) || [];
      const seen = new Set(main.map(c => c.id));
      const extras = sns.filter(c => !seen.has(c.id));
      return [...main, ...extras];
    })(),
    reservations: [],  // 백그라운드 로드 — loadReservations() 참고
    sales: fromDb("sales", sales),
    products: fromDb("services", products),
    branchGroups: Array.isArray(branchGroups) ? branchGroups : [],
  };
}

// 예약 백그라운드 로더 — 첫 렌더(setPhase("app")) 직후 호출. 최근 30일 + 미래 전체.
// getAll 페이지네이션 필수 (sb.get은 PostgREST db-max-rows 1000에 잘림 → 과거 데이터 누락)
async function loadReservations(bizId) {
  if (!bizId) return [];
  const since = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const rows = await sb.getAll("reservations", `&business_id=eq.${bizId}&is_beta=eq.false&date=gte.${since}&order=date.desc,time.asc&select=${RES_SELECT}`).catch(()=>[]);
  return fromDb("reservations", rows);
}

// 멤버십(app_users 행) + 계정 → 앱이 쓰는 currentUser 형태로 매핑.
// 멤버십 모델: account = 사람, app_users 행 = 한 매장에서의 멤버십(역할·지점·근무표직원).
function mapMembership(m, account) {
  const parseArr = (v) => typeof v === 'string' ? (()=>{try{return JSON.parse(v)}catch{return []}})() : (Array.isArray(v) ? v : []);
  const branches = parseArr(m.branch_ids);
  const viewBranches = parseArr(m.view_branch_ids);
  const loginId = account?.login_id || m.login_id;
  const accId = account?.id || m.account_id;
  return {
    id: m.id,
    account_id: accId, accountId: accId,
    business_id: m.business_id, businessId: m.business_id,
    login_id: loginId, loginId,
    name: m.name || account?.name, role: m.role,
    branch_ids: branches, branchIds: branches, branches,
    view_branch_ids: viewBranches, viewBranchIds: viewBranches, viewBranches,
    created_at: m.created_at, createdAt: m.created_at,
    timeline_settings: m.timeline_settings, timelineSettings: m.timeline_settings,
    email: m.email || account?.email,
    emp_name: m.emp_name, empName: m.emp_name,
    status: m.status,
  };
}
// 어드민(super) 로그인 시 "매장 선택" 화면 — 원하는 업체를 골라 그 매장 타임라인으로 진입
function BizPicker({ businesses=[], onPick, onManage, onLogout }) {
  const alias = (b) => ((/체험|데모|demo/i.test(b.code||"") || /체험|데모/.test(b.name||"")) && /하우스왁싱/.test(b.name||"")) ? "체험 매장" : (b.name || b.id);
  const real = (businesses||[]).filter(Boolean);
  return (
    <div style={{position:"fixed",inset:0,background:T.gray100,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Pretendard',sans-serif",overflow:"auto"}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      <div style={{width:"100%",maxWidth:520,background:T.bgCard,borderRadius:16,padding:"28px 24px",boxShadow:"0 8px 40px rgba(0,0,0,.12)"}}>
        <div style={{fontSize:13,fontWeight:800,color:T.primary,letterSpacing:.3}}>블리스 관리자</div>
        <div style={{fontSize:22,fontWeight:900,color:T.text,marginTop:6,letterSpacing:-.5}}>어느 매장을 보시겠어요?</div>
        <div style={{fontSize:13,color:T.textSub,marginTop:6,marginBottom:18}}>모니터링할 매장을 선택하면 그 매장 타임라인으로 들어갑니다.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {real.map(b => (
            <button key={b.id} onClick={()=>onPick(b.id)}
              style={{padding:"16px 14px",borderRadius:11,border:`1.5px solid ${T.border}`,background:T.bgCard,color:T.text,cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:800,textAlign:"left",transition:"all .12s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.primary;e.currentTarget.style.background=T.primaryHover;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.bgCard;}}>
              {alias(b)}
            </button>
          ))}
          {real.length===0 && <div style={{gridColumn:"1/-1",textAlign:"center",color:T.gray500,padding:30}}>등록된 매장이 없습니다</div>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:22,paddingTop:16,borderTop:`1px solid ${T.border}`}}>
          <button onClick={onManage} style={{fontSize:13,fontWeight:700,color:T.textSub,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>⚙ 업체 관리(추가·수정)</button>
          <button onClick={onLogout} style={{fontSize:13,fontWeight:700,color:T.textSub,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:7,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit"}}>로그아웃</button>
        </div>
      </div>
    </div>
  );
}

function SuperDashboard({ superData, setSuperData, currentUser, onLogout, onEnterBiz, onBackToPicker }) {
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
      <div style={{fontSize:T.fs.xxl,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>BlissMe</div>
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
      {onBackToPicker && <button onClick={onBackToPicker} style={{width:"100%",marginBottom:8,padding:"8px 14px",borderRadius:T.radius.sm,border:`1px solid ${T.primary}`,background:T.bgCard,color:T.primaryDk,cursor:"pointer",fontSize:T.fs.sm,fontWeight:T.fw.bold,fontFamily:"inherit"}}>← 매장 선택</button>}
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

function Login({ users, onAccountLogin, onSignup }) {
  const [showSignup, setShowSignup] = useState(false);
  const [showHelp, setShowHelp] = useState(null); // 'findId' | 'resetPw' | null
  const [loginId, setLoginId] = useState(() => {try{return localStorage.getItem("savedLoginId")||"";}catch(e){return "";}});
  const [pw, setPw] = useState("");
  const [saveId, setSaveId] = useState(() => {try{return localStorage.getItem("savedLoginId")!==null;}catch(e){return false;}});
  const [err, setErr] = useState("");
  const handleLogin = async () => {
    setErr("");
    try {
      const { SB_URL, SB_KEY } = await import('../lib/supabase');
      // 멤버십 모델: auth_login_v2 → { account, memberships[] }
      const res = await fetch(`${SB_URL}/rest/v1/rpc/auth_login_v2`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_login_id: loginId, p_password: pw }),
      });
      if (!res.ok) { setErr("아이디 또는 비밀번호가 일치하지 않습니다."); return; }
      const data = await res.json();
      if (!data || !data.account) { setErr("아이디 또는 비밀번호가 일치하지 않습니다."); return; }
      try{if(saveId)localStorage.setItem("savedLoginId",loginId);else localStorage.removeItem("savedLoginId");}catch(e){}
      onAccountLogin(data.account, data.memberships || []);
    } catch (e) {
      console.error('[login] error', e);
      setErr("로그인 중 오류가 발생했습니다.");
    }
  };
  const bgGrad = "linear-gradient(135deg,#e8e8f0 0%,#d8d8e8 50%,#c8c8d8 100%)";
  const cardStyle = {background:T.bgCard,borderRadius:T.radius.lg,border:`1px solid ${T.border}`,boxShadow:T.shadow.md,animation:"slideUp .6s cubic-bezier(.22,1,.36,1)"};
  if (showSignup) return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,overflowY:"auto",WebkitOverflowScrolling:"touch",background:bgGrad,fontFamily:"'Pretendard',sans-serif",padding:"20px 16px 80px",boxSizing:"border-box",zIndex:9999}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      
      <div style={{...cardStyle,padding:"28px 24px",width:"92%",maxWidth:460,marginTop:20}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:T.fs.xxl,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>BlissMe</div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:4}}>신규 가입</div>
        </div>
        <SignupWizard onComplete={(newUser)=>{ setShowSignup(false); onSignup(newUser); }} onBack={()=>setShowSignup(false)}/>
      </div>
    </div>
  );
  return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:bgGrad,fontFamily:"'Pretendard',sans-serif",padding:T.sp.lg,position:"relative",overflow:"hidden"}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      {/* 블리스미 첫페이지 흐린 배경 */}
      <iframe src="/landing.html" title="" tabIndex={-1} aria-hidden="true" scrolling="no"
        style={{position:"absolute",top:"-4%",left:"-4%",width:"108%",height:"108%",border:"none",filter:"blur(9px) saturate(1.08)",transform:"scale(1.04)",pointerEvents:"none",zIndex:0}}/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg, rgba(124,93,250,.30) 0%, rgba(216,216,232,.55) 55%, rgba(255,255,255,.45) 100%)",zIndex:1,pointerEvents:"none"}}/>
      <div style={{...cardStyle,padding:"32px 28px",width:"92%",maxWidth:420,position:"relative",zIndex:2}}>
        <button onClick={()=>{window.location.href='/';}} aria-label="닫기" title="홈으로"
          style={{position:"absolute",top:12,right:12,width:32,height:32,borderRadius:"50%",border:"none",background:T.gray100,color:T.textSub,fontSize:20,lineHeight:1,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:28,fontWeight:T.fw.black,color:T.primary,letterSpacing:-1}}>BlissMe</div>
          <div style={{fontSize:T.fs.sm,color:T.textMuted,marginTop:T.sp.sm}}>통합 예약 & 매출 관리 시스템</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* 소셜 로그인 */}
          <button onClick={()=>{import('../lib/supabase').then(m=>m.supabase.auth.signInWithOAuth({provider:'kakao',options:{redirectTo:window.location.origin+'/'}}))}} style={{width:"100%",height:48,display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:"#FEE500",color:"#3C1E1E",border:"none",borderRadius:T.radius.md,fontSize:T.fs.md,fontWeight:T.fw.bold,cursor:"pointer",fontFamily:"inherit"}}><I name="msgSq" size={17} style={{color:"#3C1E1E"}}/>카카오로 시작하기</button>
          <button onClick={()=>{import('../lib/supabase').then(m=>m.supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/'}}))}} style={{width:"100%",height:48,display:"flex",alignItems:"center",justifyContent:"center",gap:8,background:"#fff",color:"#333",border:`1px solid ${T.border}`,borderRadius:T.radius.md,fontSize:T.fs.md,fontWeight:T.fw.bold,cursor:"pointer",fontFamily:"inherit"}}>
            <svg width="17" height="17" viewBox="0 0 48 48" style={{flexShrink:0}}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.9 38 46.5 31.8 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.9-6.1C1 16.9 0 20.3 0 24s1 7.1 2.6 10.4l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.3-5.7c-2 1.4-4.7 2.3-8.2 2.3-6.3 0-11.7-3.7-13.5-9.3l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Google로 시작하기
          </button>
          {/* 구분선 */}
          <div style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}><div style={{flex:1,height:1,background:T.border}}/><span style={{fontSize:T.fs.xs,color:T.textMuted}}>또는</span><div style={{flex:1,height:1,background:T.border}}/></div>
          <FLD label="아이디"><input className="inp" placeholder="아이디 입력" value={loginId} onChange={e=>{setLoginId(e.target.value);setErr("")}}/></FLD>
          <FLD label="비밀번호"><input className="inp" type="password" placeholder="비밀번호 입력" value={pw} onChange={e=>{setPw(e.target.value);setErr("")}} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/></FLD>
          {err && <div style={{fontSize:T.fs.sm,color:T.danger,textAlign:"center"}}>{err}</div>}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:T.fs.sm,color:T.textSub,cursor:"pointer"}}>
              <input type="checkbox" checked={saveId} onChange={e=>setSaveId(e.target.checked)} style={{accentColor:T.primary,width:14,height:14}}/>
              아이디 저장
            </label>
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:T.fs.xs}}>
              <button onClick={()=>setShowHelp('findId')} style={{background:"none",border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,padding:0}}>아이디 찾기</button>
              <span style={{color:T.gray300}}>·</span>
              <button onClick={()=>setShowHelp('resetPw')} style={{background:"none",border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,padding:0}}>비밀번호 찾기</button>
            </div>
          </div>
          <Btn onClick={handleLogin} style={{width:"100%",padding:13,fontSize:T.fs.lg,marginTop:4}}>로그인</Btn>
          <div style={{borderTop:`1px solid ${T.gray200}`,marginTop:T.sp.sm,paddingTop:T.sp.md,textAlign:"center"}}>
            <span style={{fontSize:T.fs.sm,color:T.textMuted}}>아직 계정이 없으신가요? </span>
            <button onClick={()=>setShowSignup(true)} style={{background:"none",border:"none",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>무료 체험 시작 →</button>
          </div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,textAlign:"center",marginTop:4}}>앱 v{BLISS_V}</div>
          {/* 체험(데모) 계정 안내 */}
          <div style={{marginTop:10,padding:"10px 12px",background:T.primaryHover||T.gray100,borderRadius:T.radius.md,textAlign:"center"}}>
            <div style={{fontSize:T.fs.xs,color:T.primary,fontWeight:T.fw.bolder,marginBottom:3}}>체험용 데모 계정</div>
            <div style={{fontSize:T.fs.sm,color:T.text}}>아이디 <b>demo</b> · 비밀번호 <b>demo1234</b></div>
            <button onClick={()=>{setLoginId("demo");setPw("demo1234");setErr("");}}
              style={{marginTop:7,padding:"5px 12px",borderRadius:T.radius.sm,border:`1px solid ${T.primary}`,background:"#fff",color:T.primary,fontSize:T.fs.xs,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>
              데모 계정으로 채우기
            </button>
          </div>
        </div>
      </div>
      {showHelp && <AuthHelpModal initialMode={showHelp} onClose={()=>setShowHelp(null)} onUseId={(id)=>{setLoginId(id);setErr("");}}/>}
      {/* 사업자정보 푸터 — PG(토스) 심사용. 모바일에서도 항상 노출 */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:2,padding:"7px 12px 9px",textAlign:"center",fontSize:10,lineHeight:1.65,color:"rgba(45,38,75,.82)",background:"rgba(255,255,255,.5)",backdropFilter:"blur(2px)"}}>
        <div>(주)테라포트 · 대표 권신영 · 사업자등록번호 632-81-02070 · 통신판매업 제2022-성남수정-0100호</div>
        <div>서울특별시 강남구 논현로 641, 420호 · 070-8983-6838 · contact@blissme.ai</div>
        <div style={{marginTop:2}}>
          <a href="/terms.html" target="_blank" rel="noopener" style={{color:"rgba(45,38,75,.9)",margin:"0 5px",textDecoration:"underline"}}>이용약관</a>
          <a href="/privacy.html" target="_blank" rel="noopener" style={{color:"rgba(45,38,75,.9)",margin:"0 5px",textDecoration:"underline"}}>개인정보처리방침</a>
          <a href="/refund.html" target="_blank" rel="noopener" style={{color:"rgba(45,38,75,.9)",margin:"0 5px",textDecoration:"underline"}}>환불정책</a>
          <a href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=6328102070" target="_blank" rel="noopener" style={{color:"rgba(45,38,75,.9)",margin:"0 5px",textDecoration:"underline"}}>사업자정보확인</a>
        </div>
      </div>
    </div>
  );
}

// 멤버십 게이트 — 로그인했으나 활성 멤버십이 1개가 아닐 때(여러개 선택 / 승인대기 / 미가입)
const ROLE_LABEL = { owner:"대표", manager:"매니저", staff:"직원", super:"관리자" };
function AccountGate({ mode, pendingAccount, onPick, onLogout, onJoinSuccess, onCreateBiz }) {
  const acc = pendingAccount?.account;
  const memberships = pendingAccount?.memberships || [];
  const [bizNames, setBizNames] = useState({});
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState("");
  const doJoin = async () => {
    if (!code.trim()) { setJoinErr("매장 코드를 입력하세요"); return; }
    if (!acc?.id) { setJoinErr("계정 정보 오류"); return; }
    setJoining(true); setJoinErr("");
    try {
      const { SB_URL, SB_KEY } = await import('../lib/supabase');
      const res = await fetch(`${SB_URL}/rest/v1/rpc/staff_join_request`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_account_id: acc.id, p_store_code: code.trim() }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (t.includes("store_not_found")) setJoinErr("해당 매장 코드를 찾을 수 없습니다");
        else if (t.includes("already_member")) setJoinErr("이미 요청했거나 소속된 매장입니다");
        else setJoinErr("요청 실패. 다시 시도해주세요");
        setJoining(false); return;
      }
      onJoinSuccess && onJoinSuccess();
    } catch (e) { setJoinErr("요청 실패"); setJoining(false); }
  };
  const [bizMode, setBizMode] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const doCreateBiz = async () => {
    if (!bizName.trim()) { setJoinErr("사업장 이름을 입력하세요"); return; }
    if (!acc?.id) { setJoinErr("계정 정보 오류"); return; }
    setBizSaving(true); setJoinErr("");
    try {
      const exp = new Date(); exp.setDate(exp.getDate() + 14);
      const bizId = "biz_" + uid(), brId = "br_" + uid(), mbrId = "mbr_" + uid();
      await sb.insert("businesses", { id: bizId, name: bizName.trim(), code: acc.login_id, phone: "",
        settings: JSON.stringify({ plan: "trial", planExpiry: exp.toISOString().slice(0,10) }), use_yn: true });
      await sb.insert("branches", { id: brId, business_id: bizId, name: bizName.trim(),
        short: bizName.trim().slice(0,5), phone: "", sort: 0, use_yn: true });
      await sb.insert("app_users", { id: mbrId, account_id: acc.id, business_id: bizId,
        login_id: acc.login_id, name: acc.name, role: "owner", status: "active",
        branch_ids: JSON.stringify([brId]), view_branch_ids: JSON.stringify([brId]) });
      onCreateBiz && onCreateBiz(mapMembership({
        id: mbrId, account_id: acc.id, business_id: bizId, role: "owner", status: "active",
        branch_ids: [brId], view_branch_ids: [brId], name: acc.name, email: acc.email,
      }, acc));
    } catch (e) { setJoinErr("사업장 생성 실패"); setBizSaving(false); }
  };
  useEffect(() => {
    const bids = [...new Set(memberships.map(m=>m.business_id).filter(Boolean))];
    if (!bids.length) return;
    sb.get("businesses", `&id=in.(${bids.map(b=>`"${b}"`).join(',')})&select=id,name`)
      .then(rows => { const map={}; (rows||[]).forEach(b=>{map[b.id]=b.name}); setBizNames(map); })
      .catch(()=>{});
  }, []);
  const bg = "linear-gradient(135deg,#e8e8f0 0%,#d8d8e8 50%,#c8c8d8 100%)";
  const wrap = (children) => (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:bg,fontFamily:"'Pretendard',sans-serif",padding:20}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>
      <div style={{background:T.bgCard,borderRadius:16,border:`1px solid ${T.border}`,padding:"32px 28px",width:"92%",maxWidth:420,boxShadow:T.shadow.md}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:28,fontWeight:900,color:T.primary,letterSpacing:-1}}>BlissMe</div>
          {acc?.name && <div style={{fontSize:13,color:T.textMuted,marginTop:6}}>{acc.name}님</div>}
        </div>
        {children}
        <button onClick={onLogout} style={{width:"100%",marginTop:16,padding:10,background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>로그아웃</button>
      </div>
    </div>
  );
  if (mode === "pick_membership") {
    return wrap(<>
      <div style={{fontSize:14,fontWeight:700,marginBottom:12,textAlign:"center"}}>접속할 매장을 선택하세요</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {memberships.map(m => (
          <button key={m.id} onClick={()=>onPick(m)} style={{padding:"14px 16px",border:`1px solid ${T.border}`,borderRadius:10,background:"#fff",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
            <div style={{fontSize:14,fontWeight:700}}>{bizNames[m.business_id]||m.business_id||"매장"}</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{ROLE_LABEL[m.role]||m.role}</div>
          </button>
        ))}
      </div>
    </>);
  }
  if (mode === "staff_pending") {
    return wrap(<div style={{textAlign:"center",fontSize:14,color:T.textSub,lineHeight:1.8}}>
      매장 등록 요청이 접수되었습니다.<br/>관리자 승인을 기다리고 있습니다.<br/>
      <span style={{fontSize:12,color:T.textMuted}}>승인되면 다시 로그인해 주세요.</span>
    </div>);
  }
  // no_membership — 매장 합류 요청 / 사업장 생성
  if (bizMode) {
    return wrap(<>
      <div style={{fontSize:14,fontWeight:700,marginBottom:6,textAlign:"center"}}>내 사업장 만들기</div>
      <div style={{fontSize:12,color:T.textSub,marginBottom:12,textAlign:"center",lineHeight:1.6}}>
        사업장(브랜드)명을 입력하세요. 14일 무료 체험으로 시작됩니다.
      </div>
      <input value={bizName} onChange={e=>{setBizName(e.target.value);setJoinErr("")}} placeholder="브랜드 또는 상호명"
        onKeyDown={e=>e.key==="Enter"&&doCreateBiz()}
        style={{width:"100%",padding:"11px 13px",fontSize:14,borderRadius:10,border:`1px solid ${joinErr?T.danger:T.border}`,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
      {joinErr && <div style={{fontSize:12,color:T.danger,marginTop:4}}>{joinErr}</div>}
      <button onClick={doCreateBiz} disabled={bizSaving} style={{width:"100%",marginTop:10,padding:12,borderRadius:10,border:"none",background:bizSaving?T.gray200:T.primary,color:bizSaving?T.gray400:"#fff",fontWeight:700,cursor:bizSaving?"not-allowed":"pointer",fontFamily:"inherit",fontSize:14}}>
        {bizSaving?"생성 중...":"사업장 만들기"}
      </button>
      <button onClick={()=>{setBizMode(false);setJoinErr("")}} style={{width:"100%",marginTop:8,padding:10,background:"none",border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>← 뒤로</button>
    </>);
  }
  return wrap(<>
    <div style={{fontSize:14,fontWeight:700,marginBottom:6,textAlign:"center"}}>매장에 합류하기</div>
    <div style={{fontSize:12,color:T.textSub,marginBottom:12,textAlign:"center",lineHeight:1.6}}>
      근무하는 매장의 코드를 입력해 직원 등록을 요청하세요.<br/>매장 코드는 매장 관리자에게 문의하세요.
    </div>
    <input value={code} onChange={e=>{setCode(e.target.value);setJoinErr("")}} placeholder="매장 코드"
      onKeyDown={e=>e.key==="Enter"&&doJoin()}
      style={{width:"100%",padding:"11px 13px",fontSize:14,borderRadius:10,border:`1px solid ${joinErr?T.danger:T.border}`,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
    {joinErr && <div style={{fontSize:12,color:T.danger,marginTop:4}}>{joinErr}</div>}
    <button onClick={doJoin} disabled={joining} style={{width:"100%",marginTop:10,padding:12,borderRadius:10,border:"none",background:joining?T.gray200:T.primary,color:joining?T.gray400:"#fff",fontWeight:700,cursor:joining?"not-allowed":"pointer",fontFamily:"inherit",fontSize:14}}>
      {joining?"요청 중...":"직원 등록 요청"}
    </button>
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
      <div style={{flex:1,height:1,background:T.border}}/><span style={{fontSize:11,color:T.textMuted}}>또는</span><div style={{flex:1,height:1,background:T.border}}/>
    </div>
    <button onClick={()=>{setBizMode(true);setJoinErr("")}} style={{width:"100%",padding:12,borderRadius:10,border:`1px solid ${T.border}`,background:"#fff",color:T.text,fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
      내 사업장 만들기
    </button>
  </>);
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

// 계정 인증 서버 API 베이스 (nginx → Flask 프록시)
const ACCT_API = 'https://blissme.ai';
async function acctApi(path, body) {
  const r = await fetch(`${ACCT_API}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  let j = {}; try { j = await r.json(); } catch(e){}
  return { ok: r.ok, status: r.status, data: j };
}
const _normPhone = s => (s||'').replace(/[^0-9]/g,'');
const _fmtPhone = s => { const d=_normPhone(s); if(d.length<4)return d; if(d.length<8)return d.slice(0,3)+'-'+d.slice(3); return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7,11); };

// 통합 가입 — account(사람)만 생성. 사업장 미생성. 가입 후 합류/생성은 AccountGate에서.
function SignupWizard({ onComplete, onBack }) {
  const [saving, setSaving] = useState(false);
  const [acct, setAcct] = useState({ name:'', loginId:'', pw:'', pw2:'', email:'', phone:'' });
  const setA = (k,v) => setAcct(p=>({...p,[k]:v}));
  const [errs, setErrs] = useState({});
  // 휴대폰 인증
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  // 약관
  const [agree, setAgree] = useState({ terms:false, privacy:false, marketing:false });
  const allAgree = agree.terms && agree.privacy && agree.marketing;
  const toggleAll = () => { const v=!allAgree; setAgree({terms:v,privacy:v,marketing:v}); };

  useEffect(() => { if(countdown<=0) return; const t=setInterval(()=>setCountdown(c=>c<=1?0:c-1),1000); return ()=>clearInterval(t); }, [countdown]);

  const sendCode = async () => {
    const ph = _normPhone(acct.phone);
    if (!/^01[0-9]{8,9}$/.test(ph)) { setErrs(e=>({...e,phone:'휴대폰 번호를 정확히 입력해주세요'})); return; }
    setSmsBusy(true); setErrs(e=>({...e,phone:undefined}));
    const { ok, data } = await acctApi('account-verify-send', { phone: ph });
    setSmsBusy(false);
    if (!ok || !data.ok) {
      if (data.error==='rate_limited') setErrs(e=>({...e,phone:`잠시 후 다시 시도 (${data.retry_after||60}초)`}));
      else setErrs(e=>({...e,phone:'인증번호 발송 실패. 번호를 확인해주세요'}));
      return;
    }
    setCodeSent(true); setVerified(false); setCode(''); setCountdown(180);
  };
  const checkCode = async () => {
    const ph = _normPhone(acct.phone);
    if (!code.trim()) return;
    setSmsBusy(true);
    const { data } = await acctApi('account-verify-check', { phone: ph, code: code.trim() });
    setSmsBusy(false);
    if (data.ok) { setVerified(true); setErrs(e=>({...e,code:undefined})); }
    else setErrs(e=>({...e,code: data.error==='wrong_code'?'인증번호가 일치하지 않아요':data.error==='expired'?'인증번호가 만료됐어요. 다시 받아주세요':'인증 실패'}));
  };

  const submit = async () => {
    const e = {};
    if (!acct.name.trim()) e.name = '이름을 입력해주세요';
    if (!/^[a-z0-9_]{4,20}$/.test(acct.loginId)) e.loginId = '아이디는 영 소문자/숫자/언더바 4~20자';
    if (!(acct.pw.length>=8 && acct.pw.length<=20 && /[a-zA-Z]/.test(acct.pw) && /[0-9]/.test(acct.pw))) e.pw = '영문+숫자 포함 8~20자';
    if (acct.pw !== acct.pw2) e.pw2 = '비밀번호가 일치하지 않아요';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(acct.email.trim())) e.email = '이메일을 정확히 입력해주세요';
    if (!verified) e.phone = '휴대폰 인증을 완료해주세요';
    if (!agree.terms || !agree.privacy) e.agree = '필수 약관에 동의해주세요';
    setErrs(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      const { SB_URL, SB_KEY } = await import('../lib/supabase');
      const res = await fetch(`${SB_URL}/rest/v1/rpc/account_signup`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_login_id: acct.loginId, p_password: acct.pw, p_name: acct.name.trim(), p_email: acct.email.trim(), p_phone: _normPhone(acct.phone) }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (t.includes('login_id_taken')) { setErrs({ loginId: '이미 사용 중인 아이디입니다' }); setSaving(false); return; }
        alert('가입 실패: 다시 시도해주세요.'); setSaving(false); return;
      }
      const account = await res.json();
      onComplete(account);
    } catch (e) {
      alert('가입 실패: ' + (e.message || '다시 시도해주세요.'));
      setSaving(false);
    }
  };

  const inp = {width:'100%',padding:'11px 13px',fontSize:T.fs.md,borderRadius:T.radius.lg,border:'1px solid '+T.border,outline:'none',fontFamily:'inherit',color:T.text,background:'#fff',boxSizing:'border-box'};
  const lbl = {fontSize:T.fs.xxs,color:T.gray500,fontWeight:T.fw.bold,marginBottom:5,display:'block'};
  const hint = {fontSize:T.fs.xxs,color:T.gray400,marginTop:4};
  const errStyle = {fontSize:T.fs.xxs,color:T.danger,marginTop:3};
  const smallBtn = (disabled,bg) => ({padding:'0 14px',height:44,flexShrink:0,borderRadius:T.radius.lg,border:'none',background:disabled?T.gray200:(bg||T.primary),color:disabled?T.gray400:'#fff',fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:disabled?'not-allowed':'pointer',fontFamily:'inherit',whiteSpace:'nowrap'});

  return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,marginBottom:4}}>계정 만들기</div>
      <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:18,lineHeight:1.5}}>
        가입 후 매장에 직원으로 합류하거나 내 사업장을 만들 수 있어요.
      </div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>아이디 *</label>
        <input style={{...inp,borderColor:errs.loginId?T.danger:T.border}} value={acct.loginId} onChange={e=>setA('loginId',e.target.value.toLowerCase())} placeholder="영 소문자·숫자 4~20자"/>
        {errs.loginId?<div style={errStyle}>{errs.loginId}</div>:<div style={hint}>영 소문자, 숫자를 사용해 4~20자 이내로 입력해 주세요.</div>}
      </div>
      <div style={{marginBottom:8}}>
        <label style={lbl}>비밀번호 *</label>
        <input style={{...inp,borderColor:errs.pw?T.danger:T.border}} type="password" value={acct.pw} onChange={e=>setA('pw',e.target.value)} placeholder="비밀번호를 입력해 주세요."/>
        {errs.pw&&<div style={errStyle}>{errs.pw}</div>}
      </div>
      <div style={{marginBottom:13}}>
        <input style={{...inp,borderColor:errs.pw2?T.danger:T.border}} type="password" value={acct.pw2} onChange={e=>setA('pw2',e.target.value)} placeholder="비밀번호를 한 번 더 입력해 주세요."/>
        {errs.pw2?<div style={errStyle}>{errs.pw2}</div>:<div style={hint}>영문+숫자 포함 8~20자 이내로 입력해 주세요.</div>}
      </div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>이름 *</label>
        <input style={{...inp,borderColor:errs.name?T.danger:T.border}} value={acct.name} onChange={e=>setA('name',e.target.value)} placeholder="이름을 입력해 주세요."/>
        {errs.name?<div style={errStyle}>{errs.name}</div>:<div style={hint}>예약 캘린더에 노출할 이름을 입력해 주세요.</div>}
      </div>
      <div style={{marginBottom:13}}>
        <label style={lbl}>이메일 *</label>
        <input style={{...inp,borderColor:errs.email?T.danger:T.border}} type="email" value={acct.email} onChange={e=>setA('email',e.target.value)} placeholder="비밀번호 찾기에 사용돼요" disabled={verified&&false}/>
        {errs.email?<div style={errStyle}>{errs.email}</div>:<div style={hint}>비밀번호 분실 시 임시 비밀번호를 받을 주소예요.</div>}
      </div>
      <div style={{marginBottom:18}}>
        <label style={lbl}>휴대폰 인증 *</label>
        <div style={{display:'flex',gap:8}}>
          <input style={{...inp,borderColor:errs.phone?T.danger:(verified?T.success:T.border)}} value={_fmtPhone(acct.phone)} onChange={e=>{setA('phone',e.target.value);setVerified(false);setCodeSent(false);}} placeholder="휴대폰 번호를 입력해 주세요." disabled={verified}/>
          <button onClick={sendCode} disabled={smsBusy||verified} style={smallBtn(smsBusy||verified)}>{verified?'완료':codeSent?'재전송':'전송'}</button>
        </div>
        {errs.phone&&<div style={errStyle}>{errs.phone}</div>}
        {codeSent && !verified && (
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <input style={{...inp,borderColor:errs.code?T.danger:T.border}} value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} placeholder="인증번호 6자리" inputMode="numeric"/>
            <button onClick={checkCode} disabled={smsBusy||code.length<6} style={smallBtn(smsBusy||code.length<6,T.success||'#16a34a')}>확인</button>
          </div>
        )}
        {codeSent && !verified && countdown>0 && <div style={hint}>인증번호 입력 시간 {Math.floor(countdown/60)}:{String(countdown%60).padStart(2,'0')}</div>}
        {errs.code&&<div style={errStyle}>{errs.code}</div>}
        {verified && <div style={{fontSize:T.fs.xxs,color:T.success||'#16a34a',marginTop:4,fontWeight:T.fw.bolder}}>휴대폰 인증 완료</div>}
      </div>
      {/* 약관 */}
      <div style={{borderTop:`1px solid ${T.gray200}`,paddingTop:14,marginBottom:16}}>
        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:10}}>
          <input type="checkbox" checked={allAgree} onChange={toggleAll} style={{accentColor:T.primary,width:16,height:16}}/> 전체 동의
        </label>
        {[['terms','이용약관 동의 (필수)','/terms.html'],['privacy','개인정보 처리방침 (필수)','/privacy.html'],['marketing','마케팅 정보 수신 동의 (선택)',null]].map(([k,label,url])=>(
          <label key={k} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:T.fs.xs,color:T.textSub,padding:'4px 0'}}>
            <input type="checkbox" checked={agree[k]} onChange={e=>setAgree(p=>({...p,[k]:e.target.checked}))} style={{accentColor:T.primary,width:14,height:14}}/>
            {url?<a href={url} target="_blank" rel="noreferrer" style={{color:T.textSub}}>{label}</a>:label}
          </label>
        ))}
        {errs.agree&&<div style={errStyle}>{errs.agree}</div>}
      </div>
      <button onClick={submit} disabled={saving}
        style={{width:'100%',padding:13,borderRadius:T.radius.lg,border:'none',background:saving?T.gray200:T.primary,color:saving?T.gray400:'#fff',fontSize:T.fs.md,fontWeight:T.fw.bolder,cursor:saving?'not-allowed':'pointer',fontFamily:'inherit'}}>
        {saving?'처리 중...':'회원가입 완료'}
      </button>
      <button onClick={onBack} style={{background:'none',border:'none',fontSize:T.fs.sm,color:T.gray400,cursor:'pointer',marginTop:12,fontFamily:'inherit'}}>← 로그인으로 돌아가기</button>
    </div>
  );
}


// 아이디 찾기 / 비밀번호 찾기 모달 (휴대폰 인증 / 이메일 임시비번)
function AuthHelpModal({ initialMode, onClose, onUseId }) {
  const [mode, setMode] = useState(initialMode || 'findId'); // findId | resetPw
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [foundIds, setFoundIds] = useState(null);
  const [resetTab, setResetTab] = useState('email'); // email | sms
  const [loginId, setLoginId] = useState('');
  const [multiIds, setMultiIds] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => { if(countdown<=0) return; const t=setInterval(()=>setCountdown(c=>c<=1?0:c-1),1000); return ()=>clearInterval(t); }, [countdown]);
  useEffect(() => { const h=e=>{if(e.key==='Escape'&&!e.isComposing)onClose?.();}; window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h); }, [onClose]);

  const reset = () => { setPhone('');setCode('');setCodeSent(false);setErr('');setName('');setFoundIds(null);setLoginId('');setMultiIds(null);setNewPw('');setNewPw2('');setDone('');setCountdown(0); };
  const switchMode = m => { reset(); setMode(m); };

  const sendCode = async () => {
    const ph=_normPhone(phone);
    if(!/^01[0-9]{8,9}$/.test(ph)){setErr('휴대폰 번호를 정확히 입력해주세요');return;}
    setBusy(true);setErr('');
    const {data}=await acctApi('account-verify-send',{phone:ph});
    setBusy(false);
    if(!data.ok){setErr(data.error==='rate_limited'?`잠시 후 다시 (${data.retry_after||60}초)`:'인증번호 발송 실패');return;}
    setCodeSent(true);setCountdown(180);setCode('');
  };
  const doFindId = async () => {
    const ph=_normPhone(phone);
    if(code.length<6){setErr('인증번호 6자리를 입력해주세요');return;}
    setBusy(true);setErr('');
    const {data}=await acctApi('account-find-id',{phone:ph,code:code.trim(),name:name.trim()});
    setBusy(false);
    if(!data.ok){setErr(data.error==='wrong_code'?'인증번호가 일치하지 않아요':data.error==='expired'?'인증번호 만료. 다시 받아주세요':'인증 실패');return;}
    setFoundIds(data.ids||[]);
  };
  const doResetEmail = async () => {
    const id=loginId.trim().toLowerCase();
    if(!id){setErr('아이디를 입력해주세요');return;}
    setBusy(true);setErr('');
    const {data}=await acctApi('account-reset-email',{login_id:id});
    setBusy(false);
    if(data.ok && data.sent) setDone(`임시 비밀번호를 메일(${data.email_masked})로 보냈어요. 로그인 후 변경해주세요.`);
    else setDone('__no_email__');
  };
  const doResetSms = async () => {
    const ph=_normPhone(phone);
    if(code.length<6){setErr('인증번호 6자리를 입력해주세요');return;}
    if(!(newPw.length>=8&&newPw.length<=20&&/[a-zA-Z]/.test(newPw)&&/[0-9]/.test(newPw))){setErr('새 비밀번호: 영문+숫자 포함 8~20자');return;}
    if(newPw!==newPw2){setErr('새 비밀번호가 일치하지 않아요');return;}
    setBusy(true);setErr('');
    const {data}=await acctApi('account-reset-sms',{phone:ph,code:code.trim(),new_password:newPw,login_id:loginId.trim().toLowerCase()||undefined});
    setBusy(false);
    if(data.ok){setDone(`비밀번호가 재설정됐어요. 아이디 ${data.login_id}로 로그인해주세요.`);return;}
    if(data.error==='multiple'){setMultiIds(data.ids||[]);setErr('이 번호로 등록된 계정이 여러 개예요. 아이디를 선택해주세요.');return;}
    setErr(data.error==='wrong_code'?'인증번호가 일치하지 않아요':data.error==='expired'?'인증번호 만료. 다시 받아주세요':data.error==='no_account'?'해당 번호로 등록된 계정이 없어요':'재설정 실패');
  };

  const inp={width:'100%',padding:'11px 13px',fontSize:T.fs.md,borderRadius:T.radius.lg,border:'1px solid '+T.border,outline:'none',fontFamily:'inherit',color:T.text,background:'#fff',boxSizing:'border-box'};
  const lbl={fontSize:T.fs.xxs,color:T.gray500,fontWeight:T.fw.bold,marginBottom:5,display:'block'};
  const errStyle={fontSize:T.fs.xxs,color:T.danger,marginTop:6};
  const sBtn=(d,bg)=>({padding:'0 14px',height:44,flexShrink:0,borderRadius:T.radius.lg,border:'none',background:d?T.gray200:(bg||T.primary),color:d?T.gray400:'#fff',fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:d?'not-allowed':'pointer',fontFamily:'inherit',whiteSpace:'nowrap'});
  const tab=(active)=>({flex:1,padding:'10px 0',textAlign:'center',fontSize:T.fs.sm,fontWeight:active?T.fw.bolder:T.fw.medium,color:active?T.primary:T.textMuted,borderBottom:active?`2px solid ${T.primary}`:'2px solid transparent',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'});

  const phoneVerifyBlock = (onSubmitLabel, onSubmit) => (<>
    <div style={{marginBottom:12}}>
      <label style={lbl}>휴대폰 번호</label>
      <div style={{display:'flex',gap:8}}>
        <input style={inp} value={_fmtPhone(phone)} onChange={e=>{setPhone(e.target.value);setCodeSent(false);}} placeholder="가입한 휴대폰 번호" disabled={busy}/>
        <button onClick={sendCode} disabled={busy} style={sBtn(busy)}>{codeSent?'재전송':'인증번호'}</button>
      </div>
    </div>
    {codeSent && <div style={{marginBottom:12}}>
      <label style={lbl}>인증번호</label>
      <input style={inp} value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} placeholder="6자리" inputMode="numeric"/>
      {countdown>0 && <div style={{fontSize:T.fs.xxs,color:T.gray400,marginTop:4}}>입력 시간 {Math.floor(countdown/60)}:{String(countdown%60).padStart(2,'0')}</div>}
    </div>}
  </>);

  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 16px'}}
    onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:'#fff',borderRadius:14,padding:'24px 22px',width:'100%',maxWidth:400,maxHeight:'90vh',overflowY:'auto'}}>
      <div style={{display:'flex',marginBottom:18,borderBottom:`1px solid ${T.gray200}`}}>
        <button style={tab(mode==='findId')} onClick={()=>switchMode('findId')}>아이디 찾기</button>
        <button style={tab(mode==='resetPw')} onClick={()=>switchMode('resetPw')}>비밀번호 찾기</button>
      </div>

      {mode==='findId' && (foundIds ? (
        <div>
          {foundIds.length===0
            ? <div style={{fontSize:T.fs.sm,color:T.textSub,lineHeight:1.6}}>이 번호로 가입된 아이디를 찾지 못했어요.<br/>가입 시 인증한 번호인지 확인해주세요.</div>
            : <div>
                <div style={{fontSize:T.fs.sm,color:T.textSub,marginBottom:10}}>회원님의 아이디예요:</div>
                {foundIds.map((a,i)=><div key={i} style={{padding:'10px 12px',background:T.primaryHover,borderRadius:8,marginBottom:6,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontWeight:T.fw.black,color:T.primary}}>{a.login_id}</span>
                  <button onClick={()=>{onUseId&&onUseId(a.login_id);onClose();}} style={{...sBtn(false),height:32,fontSize:T.fs.xs}}>이 아이디로 로그인</button>
                </div>)}
              </div>}
          <button onClick={reset} style={{width:'100%',marginTop:12,padding:11,borderRadius:T.radius.lg,border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>다시 찾기</button>
        </div>
      ) : (
        <div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:14,lineHeight:1.5}}>가입 시 인증한 휴대폰으로 본인확인 후 아이디를 알려드려요.</div>
          <div style={{marginBottom:12}}>
            <label style={lbl}>이름 (선택)</label>
            <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="이름"/>
          </div>
          {phoneVerifyBlock()}
          {err&&<div style={errStyle}>{err}</div>}
          <button onClick={doFindId} disabled={busy||!codeSent} style={{...sBtn(busy||!codeSent),width:'100%',marginTop:6}}>아이디 찾기</button>
        </div>
      ))}

      {mode==='resetPw' && (done ? (
        <div style={{textAlign:'center',padding:'10px 0'}}>
          {done==='__no_email__'
            ? <div style={{fontSize:T.fs.sm,color:T.textSub,lineHeight:1.7}}>등록된 이메일이 없거나 일치하는 계정을 찾지 못했어요.<br/>휴대폰 인증으로 재설정하거나<br/>고객센터(070-8983-6838)로 문의해주세요.</div>
            : <div style={{fontSize:T.fs.sm,color:T.text,lineHeight:1.7,fontWeight:T.fw.bold}}>{done}</div>}
          <button onClick={onClose} style={{width:'100%',marginTop:16,padding:12,borderRadius:T.radius.lg,border:'none',background:T.primary,color:'#fff',fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>확인</button>
        </div>
      ) : (
        <div>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button onClick={()=>{setResetTab('email');setErr('');}} style={{flex:1,padding:'8px 0',borderRadius:8,border:`1px solid ${resetTab==='email'?T.primary:T.border}`,background:resetTab==='email'?T.primaryHover:'#fff',color:resetTab==='email'?T.primary:T.textSub,fontSize:T.fs.xs,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>이메일로 받기</button>
            <button onClick={()=>{setResetTab('sms');setErr('');}} style={{flex:1,padding:'8px 0',borderRadius:8,border:`1px solid ${resetTab==='sms'?T.primary:T.border}`,background:resetTab==='sms'?T.primaryHover:'#fff',color:resetTab==='sms'?T.primary:T.textSub,fontSize:T.fs.xs,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>휴대폰 인증</button>
          </div>
          {resetTab==='email' ? (
            <div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12,lineHeight:1.5}}>아이디를 입력하면 가입 이메일로 임시 비밀번호를 보내드려요.</div>
              <label style={lbl}>아이디</label>
              <input style={inp} value={loginId} onChange={e=>setLoginId(e.target.value.toLowerCase())} placeholder="아이디" onKeyDown={e=>e.key==='Enter'&&doResetEmail()}/>
              {err&&<div style={errStyle}>{err}</div>}
              <button onClick={doResetEmail} disabled={busy} style={{...sBtn(busy),width:'100%',marginTop:14}}>임시 비밀번호 받기</button>
            </div>
          ) : (
            <div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12,lineHeight:1.5}}>가입한 휴대폰 인증 후 새 비밀번호를 설정해요.</div>
              {phoneVerifyBlock()}
              {multiIds && <div style={{marginBottom:12}}>
                <label style={lbl}>아이디 선택</label>
                <select style={inp} value={loginId} onChange={e=>setLoginId(e.target.value)}>
                  <option value="">선택</option>
                  {multiIds.map(id=><option key={id} value={id}>{id}</option>)}
                </select>
              </div>}
              {codeSent && <>
                <div style={{marginBottom:12}}>
                  <label style={lbl}>새 비밀번호</label>
                  <input style={inp} type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="영문+숫자 8~20자"/>
                </div>
                <div style={{marginBottom:4}}>
                  <label style={lbl}>새 비밀번호 확인</label>
                  <input style={inp} type="password" value={newPw2} onChange={e=>setNewPw2(e.target.value)} placeholder="새 비밀번호 재입력"/>
                </div>
              </>}
              {err&&<div style={errStyle}>{err}</div>}
              <button onClick={doResetSms} disabled={busy||!codeSent} style={{...sBtn(busy||!codeSent),width:'100%',marginTop:14}}>비밀번호 재설정</button>
            </div>
          )}
        </div>
      ))}

      <button onClick={onClose} style={{width:'100%',marginTop:14,background:'none',border:'none',fontSize:T.fs.sm,color:T.gray400,cursor:'pointer',fontFamily:'inherit'}}>닫기</button>
    </div>
  </div>;
}

// ── 상단 마퀴 배너 — 팀채팅 is_announce=true 메시지 가로 흐름 표시 (세션 단위 dismiss) ──
// overrideItems prop 있으면 fetch 안 하고 그 데이터로만 표시 (디자인 테스트용)
function AnnouncesMarquee({ overrideItems }) {
  const [items, setItems] = useState(overrideItems || []);
  // 닫기 버튼이 흐르는 마퀴 안에 있어 움직이는 표적이 됨 → hover/touch 시 흐름 일시정지
  const [paused, setPaused] = useState(false);
  const resumeTimerRef = useRef(null);
  const pauseOnTouch = () => {
    setPaused(true);
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => setPaused(false), 6000);
  };
  useEffect(() => () => clearTimeout(resumeTimerRef.current), []);
  const SESSION_KEY = 'bliss_announce_dismissed_session';
  const getDismissed = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')); } catch { return new Set(); }
  };
  const addDismissed = (id) => {
    const s = getDismissed(); s.add(id);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify([...s])); } catch {}
  };
  const load = async () => {
    try {
      const supa = window._sbClient;
      if (!supa) return;
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: rows } = await supa.from('team_chat_messages')
        .select('id,user_id,body,created_at,is_announce')
        .eq('is_announce', true).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(20);
      const dis = getDismissed();
      const filtered = (rows || []).filter(r => !dis.has(r.id)).reverse();
      setItems(filtered);
    } catch {}
  };
  useEffect(() => {
    if (overrideItems) { setItems(overrideItems); return; } // 테스트 모드 — fetch 스킵
    load();
    const supa = window._sbClient;
    if (!supa) return;
    const ch = supa.channel('rt_announce_marquee_' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' },
        (payload) => { if (payload?.new?.is_announce) load(); })
      .subscribe();
    return () => { try { supa.removeChannel(ch); } catch {} };
  }, [overrideItems]);
  if (items.length === 0) return null;
  const closeAll = () => { items.forEach(it => addDismissed(it.id)); setItems([]); };
  // 흐름 속도 — 글자 길이에 비례, 최소 30s ~ 최대 90s
  const totalChars = items.reduce((s, it) => s + Math.min(200, (it.body||"").length) + 30, 0);
  const duration = Math.max(30, Math.min(90, totalChars * 0.4));
  return (
    <div style={{position:"relative",display:"flex",alignItems:"center",background:"#fafbfc",borderBottom:"1px solid #e8eaef",zIndex:50,flexShrink:0}}>
      <div onMouseEnter={()=>{ clearTimeout(resumeTimerRef.current); setPaused(true); }}
        onMouseLeave={()=>setPaused(false)}
        onTouchStart={pauseOnTouch}
        style={{flex:1,minWidth:0,overflow:"hidden",padding:"3px 0",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{display:"inline-flex",alignItems:"center",animation:`marquee-scroll ${duration}s linear infinite`,animationPlayState: paused ? "paused" : "running",paddingLeft:"100%",whiteSpace:"nowrap"}}>
        {/* 달리는 고양이 — 4발 swing + 꼬리 흔들 */}
        <span style={{display:"inline-block",marginRight:14,animation:"cat-bob .3s ease-in-out infinite alternate"}}>
          <svg width="36" height="22" viewBox="0 0 56 36">
            <ellipse cx="28" cy="18" rx="14" ry="6" fill="#A78BFA"/>
            <circle cx="42" cy="14" r="6" fill="#8B5CF6"/>
            <polygon points="38,9 39,5 42,8" fill="#8B5CF6"/>
            <polygon points="46,8 49,5 50,9" fill="#8B5CF6"/>
            <circle cx="44" cy="13" r="1" fill="#fff"/>
            <circle cx="40" cy="13" r="1" fill="#fff"/>
            <path d="M 42 16 Q 44 17 42 18" stroke="#fff" strokeWidth="0.8" fill="none"/>
            <path d="M 14 16 Q 4 12, 8 6" stroke="#8B5CF6" strokeWidth="3.5" fill="none" strokeLinecap="round">
              <animate attributeName="d" dur="0.4s" repeatCount="indefinite"
                values="M 14 16 Q 4 12, 8 6;M 14 16 Q 6 14, 10 8;M 14 16 Q 4 12, 8 6"/>
            </path>
            <line x1="36" y1="22" x2="38" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
              <animate attributeName="x2" values="38;30;38" dur="0.3s" repeatCount="indefinite"/>
            </line>
            <line x1="32" y1="22" x2="30" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
              <animate attributeName="x2" values="30;38;30" dur="0.3s" repeatCount="indefinite"/>
            </line>
            <line x1="22" y1="22" x2="24" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
              <animate attributeName="x2" values="24;16;24" dur="0.3s" repeatCount="indefinite"/>
            </line>
            <line x1="18" y1="22" x2="16" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
              <animate attributeName="x2" values="16;24;16" dur="0.3s" repeatCount="indefinite"/>
            </line>
          </svg>
        </span>
        {items.map((it) => (
          <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:8,marginRight:60,fontSize:14,color:"#1e293b",fontWeight:500,whiteSpace:"nowrap",fontFamily:"'KotraHandwritingFont', 'Pretendard', sans-serif",letterSpacing:.3}}>
            <span style={{fontWeight:700,color:"#5b21b6"}}>{String(it.user_id||"").slice(0,8)}</span>
            <span style={{opacity:.4}}>—</span>
            <span>{String(it.body||"").replace(/\s+/g," ").slice(0,300)}</span>
          </span>
        ))}
        </div>
      </div>
      <button onClick={closeAll} title="공지 닫기 (이번 세션만)"
        style={{flexShrink:0,width:26,height:26,marginRight:6,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.14)",color:"#333",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>
      <style>{`
        @keyframes marquee-scroll {
          0%   { transform: translateX(0); }
          22%  { transform: translateX(-25%); }
          28%  { transform: translateX(-25%); }
          47%  { transform: translateX(-50%); }
          53%  { transform: translateX(-50%); }
          72%  { transform: translateX(-75%); }
          78%  { transform: translateX(-75%); }
          97%  { transform: translateX(-100%); }
          100% { transform: translateX(-100%); }
        }
        @keyframes cat-bob { 0% { transform: translateY(0); } 100% { transform: translateY(-3px); } }
      `}</style>
    </div>
  );
}

// ── 🏦 미매칭 입금 배너 — bank_deposits 폴링 + Realtime ──
// 직원 등록 요청 배너 — pending 멤버십을 마스터/매니저에게 노출, 수락(근무표 직원 연결)/거절
function StaffRequestsBanner({ bizId, role, branches=[] }) {
  const [reqs, setReqs] = useState([]);
  const [open, setOpen] = useState(false);
  const [emps, setEmps] = useState([]);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const canApprove = role === "owner" || role === "manager" || role === "super";
  const load = async () => {
    if (!bizId || !canApprove) { setReqs([]); return; }
    try {
      const r = await fetch(`${SB_URL}/rest/v1/app_users_safe?business_id=eq.${bizId}&status=eq.pending&role=eq.staff&select=id,name,account_id,created_at&order=created_at.asc`, { headers:{...sbHeaders,'Cache-Control':'no-cache'}, cache:'no-store' });
      if (r.ok) setReqs(await r.json() || []);
    } catch {}
  };
  useEffect(() => { load(); const t=setInterval(load,120000); return ()=>clearInterval(t); }, [bizId, role]);
  useEffect(() => {
    if (!window._sbClient || !bizId || !canApprove) return;
    const ch = window._sbClient.channel('staff_req_'+Date.now())
      .on('postgres_changes',{event:'*',schema:'public',table:'app_users',filter:`business_id=eq.${bizId}`}, load)
      .subscribe();
    return ()=>{ try{window._sbClient.removeChannel(ch)}catch{} };
  }, [bizId, role]);
  useEffect(() => {
    if (!open || !bizId) return;
    fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${bizId}&key=eq.employees_v1&select=value`, { headers:sbHeaders })
      .then(r=>r.json()).then(rows=>{
        try { const v = rows?.[0]?.value; const list = typeof v==='string'?JSON.parse(v):v; setEmps(Array.isArray(list)?list:[]); } catch { setEmps([]); }
      }).catch(()=>setEmps([]));
  }, [open, bizId]);
  if (!canApprove || reqs.length === 0) return null;
  const allBids = (branches||[]).map(b=>b.id);
  const decide = async (req, action) => {
    setBusy(true);
    try {
      const body = action === "approve"
        ? { status:"active", emp_name: pick[req.id]||null, branch_ids: allBids, view_branch_ids: allBids }
        : { status:"rejected" };
      await fetch(`${SB_URL}/rest/v1/app_users?id=eq.${req.id}`, {
        method:"PATCH", headers:{...sbHeaders,'Cache-Control':'no-cache'}, body: JSON.stringify(body),
      });
      await load();
    } catch {} finally { setBusy(false); }
  };
  return <>
    <div onClick={()=>setOpen(true)} style={{flexShrink:0,cursor:'pointer',background:'#EDE7F6',borderBottom:'1px solid #d1c4e9',padding:'9px 16px',display:'flex',alignItems:'center',gap:8,fontSize:13}}>
      <I name="users" size={15}/>
      <span style={{fontWeight:800,color:'#4527A0'}}>직원 등록 요청 {reqs.length}건</span>
      <span style={{color:'#7E57C2'}}>· 탭하여 승인</span>
    </div>
    {open && <div style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setOpen(false)}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:440,maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontWeight:800,fontSize:15}}>직원 등록 요청</span>
          <button onClick={()=>setOpen(false)} style={{border:'none',background:'none',fontSize:20,cursor:'pointer',color:T.textSub}}>×</button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:12,display:'flex',flexDirection:'column',gap:10}}>
          {reqs.length===0 && <div style={{textAlign:'center',color:T.textMuted,padding:24,fontSize:13}}>대기 중인 요청이 없습니다.</div>}
          {reqs.map(req => (
            <div key={req.id} style={{border:`1px solid ${T.border}`,borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>{req.name||'(이름없음)'}</div>
              <div style={{fontSize:11,color:T.textSub,marginBottom:6}}>근무표 직원과 연결 (타임라인 본인 컬럼 인식용)</div>
              <select value={pick[req.id]||''} onChange={e=>setPick(p=>({...p,[req.id]:e.target.value}))}
                style={{width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${T.border}`,fontFamily:'inherit',fontSize:13,marginBottom:8}}>
                <option value="">— 직원 선택 (선택사항) —</option>
                {emps.map(e=>{const n=e.id||e;return <option key={n} value={n}>{n}</option>;})}
              </select>
              <div style={{display:'flex',gap:8}}>
                <button disabled={busy} onClick={()=>decide(req,'approve')} style={{flex:1,padding:9,border:'none',borderRadius:8,background:T.primary,color:'#fff',fontWeight:700,cursor:'pointer',fontFamily:'inherit',fontSize:13}}>수락</button>
                <button disabled={busy} onClick={()=>decide(req,'reject')} style={{padding:'9px 16px',border:`1px solid ${T.border}`,borderRadius:8,background:'#fff',color:T.textSub,cursor:'pointer',fontFamily:'inherit',fontSize:13}}>거절</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>}
  </>;
}

// 미매칭 입금 배너 — 표시 전용. count/latest는 AppShell 단일 소스에서 props로 받음.
function DepositsAlertBanner({ count=0, latest=null, onOpen }) {
  if (count === 0) return null;
  const fmt = n => Number(n||0).toLocaleString();
  return (
    <div onClick={onOpen} style={{
      flexShrink:0,
      cursor:'pointer',
      background:'#FFF8E1',
      borderBottom:'1px solid #f0e3a6',
      padding:'7px 16px',
      display:'flex', alignItems:'center', gap:10,
      fontSize:13, color:'#7a5a00', fontWeight:600,
    }}>
      <I name="building" size={15} color="#7a5a00"/>
      <span><b>미매칭 입금 {count}건</b></span>
      {latest && (
        <span style={{opacity:.75,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          · 최근: {latest.transferer_name || '(이름없음)'} +{fmt(latest.amount)}원
        </span>
      )}
      <span style={{marginLeft:'auto',fontSize:12,color:'#8a6900'}}>확인 →</span>
    </div>
  );
}

// ── 예약변경요청 배너 (AI가 자동 변경 못 한 건 → 직원이 메시지함에서 처리) ──
function ChangeReqBanner({ userBranches=[], onOpen }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!userBranches?.length) { setRows([]); return; }
    let alive = true;
    const bidIn = userBranches.map(b=>`"${b}"`).join(',');
    const fetchPending = async () => {
      try {
        const url = `${SB_URL}/rest/v1/ai_change_requests?select=id,reservation_id,channel,account_id,user_id,cust_name,kind,req_date,req_time,created_at&status=eq.pending&branch_id=in.(${bidIn})&order=created_at.desc&limit=20`;
        const r = await fetch(url, { headers:{...sbHeaders,'Cache-Control':'no-cache'}, cache:'no-store' });
        if (!alive || !r.ok) return;
        const data = await r.json();
        setRows(Array.isArray(data) ? data : []);
      } catch {}
    };
    fetchPending();
    const t = setInterval(fetchPending, 120000);
    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient.channel('rt_changereq_banner_'+Date.now())
        .on('postgres_changes',{event:'*',schema:'public',table:'ai_change_requests'}, fetchPending)
        .subscribe();
    }
    return () => { alive=false; clearInterval(t); if (ch && window._sbClient) window._sbClient.removeChannel(ch); };
  }, [userBranches?.join('|')]);
  if (!rows.length) return null;
  const latest = rows[0];
  const kindLabel = latest.kind === 'cross_day' ? '다른 날로 변경' : '시간 변경';
  return (
    <div onClick={()=>onOpen(latest)} style={{
      flexShrink:0, cursor:'pointer',
      background:'#EDE9FE', borderBottom:'1px solid #ddd0fb',
      padding:'7px 16px', display:'flex', alignItems:'center', gap:10,
      fontSize:13, color:'#5b21b6', fontWeight:600,
    }}>
      <I name="calendar" size={15} color="#5b21b6"/>
      <span><b>예약변경요청 {rows.length}건</b></span>
      <span style={{opacity:.8,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
        · 최근: {latest.cust_name || '고객'} {latest.req_date||''} {latest.req_time||''} ({kindLabel})
      </span>
      <span style={{marginLeft:'auto',fontSize:12,color:'#6d28d9'}}>확인 →</span>
    </div>
  );
}

// ── 공지 배너 디자인 갤러리 (테스트용) ──
function AnnounceDesignGallery() {
  const fakeItems = [
    {id:'g1',user_id:'경아',body:'시간날때 공지사항 읽고 각자 자기 이름 체크해'},
    {id:'g2',user_id:'미진',body:'내일 10시 마곡점 미팅 잊지 마세요!'},
    {id:'g3',user_id:'대표',body:'이번주 매출 목표 다 같이 화이팅~~ 🎉'},
  ];
  const dur = 50;
  const renderItems = (extraStyle={}) => fakeItems.map((it,i)=>(
    <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:8,marginRight:60,fontSize:14,fontWeight:500,whiteSpace:"nowrap",...extraStyle}}>
      <span style={{fontWeight:700,opacity:.85}}>{it.user_id}</span>
      <span style={{opacity:.4}}>—</span>
      <span>{it.body}</span>
    </span>
  ));
  const Card = ({title, desc, children}) => (
    <div style={{marginBottom:24,border:"1px solid #e8eaef",borderRadius:12,overflow:"hidden",background:"#fff"}}>
      <div style={{padding:"10px 16px",background:"#f8fafc",borderBottom:"1px solid #e8eaef"}}>
        <div style={{fontSize:14,fontWeight:700,color:"#1a1a2e"}}>{title}</div>
        <div style={{fontSize:11,color:"#666",marginTop:2}}>{desc}</div>
      </div>
      <div style={{position:"relative"}}>{children}</div>
    </div>
  );
  return <div style={{padding:24,background:"#f4f5f7",height:"100%",overflowY:"auto",flex:1,minHeight:0}}>
    <div style={{maxWidth:1100,margin:"0 auto"}}>
    <h2 style={{margin:"0 0 6px",fontSize:22}}>📢 공지 배너 디자인 갤러리</h2>
    <p style={{fontSize:13,color:"#666",margin:"0 0 20px"}}>가짜 데이터 — DB 영향 없음. 마음에 드는 디자인 번호 알려줘.</p>

    <Card title="① Aurora Glow" desc="보라→핑크→파랑 흐르는 그라디언트 + 텍스트 살짝 발광. Linear / Vercel 스타일.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#0a0a1a",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,#a78bfa,#ec4899,#06b6d4,#a78bfa)",backgroundSize:"200% 100%",animation:"aurora 6s linear infinite",opacity:.18,pointerEvents:"none"}}/>
        <div style={{display:"inline-flex",animation:`marquee-1 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap",position:"relative"}}>
          {renderItems({color:"#fff",textShadow:"0 0 8px rgba(167,139,250,.5), 0 0 16px rgba(236,72,153,.3)"})}
        </div>
      </div>
    </Card>

    <Card title="② Glassmorphism" desc="반투명 유리 + backdrop blur. 미세한 그림자.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",
        background:"linear-gradient(135deg,#dbeafe 0%,#fce7f3 50%,#dbeafe 100%)",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{position:"absolute",inset:"4px 0",background:"rgba(255,255,255,.55)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",pointerEvents:"none"}}/>
        <div style={{display:"inline-flex",animation:`marquee-2 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap",position:"relative",zIndex:1}}>
          {renderItems({color:"#1e293b"})}
        </div>
      </div>
    </Card>

    <Card title="③ Holographic Shimmer" desc="텍스트 위로 무지개 빛이 스쳐 지나감. 게이밍/하이엔드 느낌.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#1a1a2e",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{display:"inline-flex",animation:`marquee-3 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap"}}>
          {fakeItems.map(it => (
            <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:8,marginRight:60,fontSize:14,fontWeight:500,whiteSpace:"nowrap",
              background:"linear-gradient(90deg,#fff 30%,#ff80ff 50%,#80ffff 60%,#fff 70%)",
              backgroundSize:"200% 100%",backgroundClip:"text",WebkitBackgroundClip:"text",color:"transparent",
              animation:"holo 3s linear infinite"}}>
              <span style={{fontWeight:700}}>{it.user_id}</span>
              <span style={{opacity:.5}}>—</span>
              <span>{it.body}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>

    <Card title="④ Particle Trail" desc="텍스트 사이사이 ✨ 입자 반짝거림.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#fafbfc",borderTop:"1px solid #e8eaef",borderBottom:"1px solid #e8eaef",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{display:"inline-flex",alignItems:"center",animation:`marquee-4 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap"}}>
          {fakeItems.map((it,i) => (
            <span key={it.id} style={{display:"inline-flex",alignItems:"center",gap:8,marginRight:60,fontSize:14,fontWeight:500,whiteSpace:"nowrap",color:"#444"}}>
              <span style={{fontSize:14,animation:"sparkle 1.4s ease-in-out infinite",animationDelay:`${i*0.3}s`}}>✨</span>
              <span style={{fontWeight:700,color:"#5b21b6"}}>{it.user_id}</span>
              <span style={{opacity:.4}}>—</span>
              <span>{it.body}</span>
              <span style={{fontSize:12,opacity:.6,animation:"sparkle 1.6s ease-in-out infinite",animationDelay:`${i*0.4+0.5}s`}}>⭐</span>
            </span>
          ))}
        </div>
      </div>
    </Card>

    <Card title="⑤ Liquid Morph" desc="배경 blob이 부드럽게 형태 변화. 2024 트렌드.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#fff",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{position:"absolute",top:-20,left:"10%",width:200,height:80,background:"radial-gradient(closest-side,rgba(167,139,250,.4),transparent)",animation:"blob 8s ease-in-out infinite alternate",pointerEvents:"none"}}/>
        <div style={{position:"absolute",top:-10,right:"20%",width:180,height:80,background:"radial-gradient(closest-side,rgba(236,72,153,.35),transparent)",animation:"blob2 10s ease-in-out infinite alternate",pointerEvents:"none"}}/>
        <div style={{display:"inline-flex",animation:`marquee-5 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap",position:"relative",zIndex:1}}>
          {renderItems({color:"#1e1e2e"})}
        </div>
      </div>
    </Card>

    <Card title="⑥ Pure Minimal" desc="Apple 스타일 미니멀. 단정한 흰 배경 + 깔끔한 글자만.">
      <div style={{position:"relative",overflow:"hidden",padding:"12px 0",background:"#fff",borderTop:"1px solid #f0f0f0",borderBottom:"1px solid #f0f0f0",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 80px, #000 calc(100% - 80px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 80px, #000 calc(100% - 80px), transparent 100%)"}}>
        <div style={{display:"inline-flex",animation:`marquee-6 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap"}}>
          {renderItems({color:"#1d1d1f",letterSpacing:"-0.01em"})}
        </div>
      </div>
    </Card>

    <Card title="⑦ Running Character (사람)" desc="진짜 다리·팔 swing하며 달리는 사람 SVG. 인라인. 외부 의존 X.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#fafbfc",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{display:"inline-flex",alignItems:"center",animation:`marquee-7 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap"}}>
          {/* 달리는 사람 SVG — 다리·팔이 실제로 swing */}
          <span style={{display:"inline-block",marginRight:18,animation:"runner-bob .35s ease-in-out infinite alternate"}}>
            <svg width="40" height="44" viewBox="0 0 40 44">
              <circle cx="22" cy="7" r="4" fill="#FCD34D"/>
              <line x1="20" y1="11" x2="18" y2="24" stroke="#3B82F6" strokeWidth="4.5" strokeLinecap="round"/>
              {/* 팔 — 앞뒤 swing */}
              <line x1="19" y1="15" x2="26" y2="20" stroke="#FCD34D" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="26;10;26" dur="0.4s" repeatCount="indefinite"/>
                <animate attributeName="y2" values="20;14;20" dur="0.4s" repeatCount="indefinite"/>
              </line>
              <line x1="19" y1="15" x2="10" y2="14" stroke="#FCD34D" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="10;26;10" dur="0.4s" repeatCount="indefinite"/>
                <animate attributeName="y2" values="14;20;14" dur="0.4s" repeatCount="indefinite"/>
              </line>
              {/* 다리 — 달리기 swing */}
              <line x1="18" y1="24" x2="26" y2="36" stroke="#1F2937" strokeWidth="3" strokeLinecap="round">
                <animate attributeName="x2" values="26;8;26" dur="0.4s" repeatCount="indefinite"/>
                <animate attributeName="y2" values="36;28;36" dur="0.4s" repeatCount="indefinite"/>
              </line>
              <line x1="18" y1="24" x2="8" y2="32" stroke="#1F2937" strokeWidth="3" strokeLinecap="round">
                <animate attributeName="x2" values="8;26;8" dur="0.4s" repeatCount="indefinite"/>
                <animate attributeName="y2" values="32;36;28" dur="0.4s" repeatCount="indefinite"/>
              </line>
            </svg>
          </span>
          {renderItems({color:"#1e293b"})}
        </div>
      </div>
    </Card>

    <Card title="⑧ Running Cat (고양이)" desc="진짜 4발로 달리는 고양이 + 꼬리 흔들. 인라인 SVG.">
      <div style={{position:"relative",overflow:"hidden",padding:"10px 0",background:"#fafbfc",
        WebkitMaskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)",
        maskImage:"linear-gradient(to right, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%)"}}>
        <div style={{display:"inline-flex",alignItems:"center",animation:`marquee-8 ${dur}s linear infinite`,paddingLeft:"100%",whiteSpace:"nowrap"}}>
          <span style={{display:"inline-block",marginRight:18,animation:"runner-bob .3s ease-in-out infinite alternate"}}>
            <svg width="56" height="36" viewBox="0 0 56 36">
              {/* 몸 */}
              <ellipse cx="28" cy="18" rx="14" ry="6" fill="#A78BFA"/>
              {/* 머리 */}
              <circle cx="42" cy="14" r="6" fill="#8B5CF6"/>
              <polygon points="38,9 39,5 42,8" fill="#8B5CF6"/>
              <polygon points="46,8 49,5 50,9" fill="#8B5CF6"/>
              <circle cx="44" cy="13" r="1" fill="#fff"/>
              <circle cx="40" cy="13" r="1" fill="#fff"/>
              <path d="M 42 16 Q 44 17 42 18" stroke="#fff" strokeWidth="0.8" fill="none"/>
              {/* 꼬리 — 흔들 */}
              <path d="M 14 16 Q 4 12, 8 6" stroke="#8B5CF6" strokeWidth="3.5" fill="none" strokeLinecap="round">
                <animate attributeName="d" dur="0.4s" repeatCount="indefinite"
                  values="M 14 16 Q 4 12, 8 6;M 14 16 Q 6 14, 10 8;M 14 16 Q 4 12, 8 6"/>
              </path>
              {/* 앞다리 2개 */}
              <line x1="36" y1="22" x2="38" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="38;30;38" dur="0.3s" repeatCount="indefinite"/>
              </line>
              <line x1="32" y1="22" x2="30" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="30;38;30" dur="0.3s" repeatCount="indefinite"/>
              </line>
              {/* 뒷다리 2개 */}
              <line x1="22" y1="22" x2="24" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="24;16;24" dur="0.3s" repeatCount="indefinite"/>
              </line>
              <line x1="18" y1="22" x2="16" y2="32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round">
                <animate attributeName="x2" values="16;24;16" dur="0.3s" repeatCount="indefinite"/>
              </line>
            </svg>
          </span>
          {renderItems({color:"#1e293b"})}
        </div>
      </div>
    </Card>

    <style>{`
      @keyframes marquee-1 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-2 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-3 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-4 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-5 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-6 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-7 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes marquee-8 { 0%{transform:translateX(0)} 100%{transform:translateX(-100%)} }
      @keyframes runner-bob { 0%{transform:translateY(0)} 100%{transform:translateY(-3px)} }
      @keyframes aurora { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
      @keyframes holo { 0%{background-position:0% 50%} 100%{background-position:-200% 50%} }
      @keyframes sparkle {
        0%,100%{opacity:.3;transform:scale(.8)}
        50%{opacity:1;transform:scale(1.3)}
      }
      @keyframes blob {
        0%{transform:translate(0,0) scale(1)}
        100%{transform:translate(40px,8px) scale(1.2)}
      }
      @keyframes blob2 {
        0%{transform:translate(0,0) scale(1)}
        100%{transform:translate(-30px,-4px) scale(1.15)}
      }
    `}</style>
    </div>
  </div>;
}

function App() {
  const [phase, setPhase] = useState("loading");
 // loading, login, super, app
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [unreadDelayedCount, setUnreadDelayedCount] = useState(0); // 1분 이상 미응답 (타임라인 배너용)
  const loadUnreadRef = useRef(null); // 미읽/배너 카운트 재계산 함수 ref — 대화창 읽음(markRead) 직후 즉시 호출용 (Realtime 미수신 시에도 배너 즉시 해제)
  const [unreadSample, setUnreadSample] = useState([]); // 배너용: [{user_id, channel, user_name, message_text, created_at, account_id}]
  const [aiActiveCount, setAiActiveCount] = useState(0); // AI 상담중(직원 미응답으로 AI가 답변 시작) 대화 수 — 타임라인 배너 + 알람용
  // 팀채팅 미읽음 카운트는 사이드바 배지에 합산하지 않음 (유저 요청 2026-05-20).
  // 받은메시지함 안 팀채팅 탭의 미읽 표시는 별도 hook(useTeamChat)이 담당 — 영향 없음.
  const [pendingDepositCount, setPendingDepositCount] = useState(0); // 미매칭 입금 (사이드바 합산용)
  const [depositLatest, setDepositLatest] = useState(null); // 미매칭 입금 최근 1건 (배너 미리보기)
  const [pendingReviewCount, setPendingReviewCount] = useState(0); // 답글 안 단 네이버 리뷰 (사이드바 합산용)
  const [pendingReqCount, setPendingReqCount] = useState(0);
  const [unackNoticesPopup, setUnackNoticesPopup] = useState(null); // {count, ids}
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [pendingAccount, setPendingAccount] = useState(null); // {account, memberships} — 멤버십 미선택/승인대기/미가입
  const [currentBizId, setCurrentBizId] = useState(null);
  const [currentBiz, setCurrentBiz] = useState(null);
  const [data, setData] = useState(null);
  const dataRef = useRef(null); // 항상 최신 data를 참조 (클로저 문제 방지)
  useEffect(() => { dataRef.current = data; }, [data]);
  const [superData, setSuperData] = useState(null);
  const [superBizList, setSuperBizList] = useState([]); // 어드민(super) 매장 전환 드롭다운용 전체 업체 목록
  const [role, setRole] = useState("staff");
  const [userBranches, setUserBranches] = useState([]);
  const isMaster = role === "owner" || role === "super" || role === "manager";
  // 연계지점 자동 머지 — userBranches에 같은 branchGroup 멤버가 있으면 자동으로 추가.
  // 예: 홍대 사용자인데 홍대-마곡이 같은 그룹이면 userBranches=[홍대,마곡]으로 확장.
  // 모든 컴포넌트가 prop으로 받는 userBranches가 자동으로 연계지점 포함됨 → 권한 일관성.
  useEffect(() => {
    if (!Array.isArray(userBranches) || userBranches.length === 0) return;
    const groups = data?.branchGroups || [];
    if (!groups.length) return;
    const set = new Set(userBranches);
    let added = false;
    groups.forEach(g => {
      const ids = g.branch_ids || g.branchIds || [];
      if (ids.some(b => set.has(b))) {
        ids.forEach(b => { if (b && !set.has(b)) { set.add(b); added = true; } });
      }
    });
    if (added) setUserBranches([...set]);
  }, [data?.branchGroups, userBranches]);
  const [viewBranches, setViewBranches] = useState([]);
  const page = useMemo(() => {
    const p = location.pathname.replace(/^\//, "").split("/")[0] || "timeline";
    if (p === "settings") return "admin";
    return Object.keys(PAGE_ROUTES).includes(p) ? p : "timeline";
  }, [location.pathname]);
  // 로그인 안 된 상태에선 URL을 /login 으로 표시(앱 경로에 로그인 화면이 뜨는 혼동 방지),
  // 로그인 후 /login 이면 /timeline 으로 보냄
  useEffect(() => {
    if (phase === "login") {
      if (location.pathname !== "/login") { try { navigate("/login", { replace: true }); } catch (e) {} }
    } else if (phase === "app" && location.pathname === "/login") {
      try { navigate("/timeline", { replace: true }); } catch (e) {}
    }
  }, [phase, location.pathname]);
  const [pendingOpenRes, setPendingOpenRes] = useState(null);
  const [pendingOpenCust, setPendingOpenCust] = useState(null); // 고객관리 페이지에서 자동 오픈할 cust_id
  const [pendingChat, setPendingChat] = useState(null); // {user_id, channel, account_id}
  const [serverV, setServerV] = useState(null);
  const [scraperStatus, setScraperStatus] = useState(null); // {lastSeen, lastScraped, isAlive, isWarning}
  // 사업장 빌링 정보 — 사이드바에 잔액·종료일 표시
  const [billingState, setBillingState] = useState({ totalBalance: 0, planEnd: null, planLabel: '', planKey: '' });
  useEffect(() => {
    if (!currentBizId) return;
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const load = () => Promise.all([
      fetch(`${SB_URL}/rest/v1/billing_balances?business_id=eq.${currentBizId}&select=balance`, { headers: H }).then(r=>r.json()).catch(()=>[]),
      fetch(`${SB_URL}/rest/v1/billing_subscriptions?business_id=eq.${currentBizId}&select=plan_key,current_period_end&order=current_period_end.asc&limit=1`, { headers: H }).then(r=>r.json()).catch(()=>[]),
    ]).then(([balances, subs]) => {
      const totalBalance = (Array.isArray(balances) ? balances : []).reduce((s,b)=>s+(b.balance||0),0);
      const sub = Array.isArray(subs) ? subs[0] : null;
      setBillingState({
        totalBalance,
        planEnd: sub?.current_period_end || null,
        planKey: sub?.plan_key || '',
        planLabel: '',
      });
    });
    load();
    const t = setInterval(load, 120000); // 2분 폴링 (Realtime 백업)
    return () => clearInterval(t);
  }, [currentBizId]);
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
    // 사용자 지점에 매핑된 모든 채널의 account_id (네이버 + IG + WA)
    const allowedAccIds = new Set();
    (userBranches||[]).forEach(bid => {
      const b = (data?.branches||[]).find(x => x.id === bid);
      if (!b) return;
      if (b.naverAccountId) allowedAccIds.add(String(b.naverAccountId));
      if (b.instagramAccountId) allowedAccIds.add(String(b.instagramAccountId));
      if (b.whatsappAccountId) allowedAccIds.add(String(b.whatsappAccountId));
    });
    // 브랜드 전체에 매핑된 account_id 집합 (이 집합에 속하는 메시지는 지점 분기 적용, 그 외 채널은 fallback 통과)
    const allMappedAccIds = new Set();
    (data?.branches||[]).forEach(b => {
      if (b.naverAccountId) allMappedAccIds.add(String(b.naverAccountId));
      if (b.instagramAccountId) allMappedAccIds.add(String(b.instagramAccountId));
      if (b.whatsappAccountId) allMappedAccIds.add(String(b.whatsappAccountId));
    });
    // settings.ig_branch_override — 추가 IG 계정을 특정 지점에 매핑 (branches 컬럼이 1개라 못 잡는 케이스)
    try {
      const _s = (data?.businesses||[])[0]?.settings;
      const _parsed = typeof _s === 'string' ? JSON.parse(_s) : _s || {};
      const _igOverride = _parsed?.ig_branch_override || {};
      Object.entries(_igOverride).forEach(([igId, bid]) => {
        if (!igId || !bid) return;
        allMappedAccIds.add(String(igId));
        if ((userBranches||[]).includes(bid)) allowedAccIds.add(String(igId));
      });
    } catch {}
    const load = () => {
      // userBranches 아직 안 로드됐으면 스킵 (isMaster는 전체 허용)
      if(allowedAccIds.size===0 && !isMaster && userBranches !== null) { setUnreadMsgCount(0); setUnreadDelayedCount(0); return; }
      if (!_activeBizId) { setUnreadMsgCount(0); setUnreadDelayedCount(0); return; }
      // 모든 미읽 IN 메시지 fetch — 사이드바 뱃지(즉시) + 배너(1분 이상 미응답) 두 가지로 분리 계산
      fetch(SB_URL+`/rest/v1/messages?business_id=eq.${_activeBizId}&is_read=eq.false&direction=eq.in&select=id,account_id,channel,user_id,user_name,message_text,created_at&order=created_at.desc&limit=999`,
        {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY,"Cache-Control":"no-cache"},cache:"no-store"})
        .then(r=>r.json())
        .then(arr=>{
          if(!Array.isArray(arr)) return;
          // 패널(MessagesPage threads 필터)과 동일 규칙으로 카운트 — 사이드바 배지 ≠ 화면 표시 불일치 방지.
          // 패널: WhatsApp·Line·account 미지정은 노출, ai_test 미노출, 그 외는 지점 account_id 일치 시만.
          // ★ isMaster(매니저 포함) 전체통과 제거 — 지점장도 패널처럼 자기 지점 account만 카운트.
          //   대표/슈퍼는 userBranches가 전 지점이라 allowedAccIds에 모든 계정 포함 → 자연히 전체 카운트.
          //   userBranches 미로드(allowedAccIds 0)면 pass-all로 안전.
          const filtered = arr.filter(m => {
            const ch = String(m.channel || "");
            if (ch === "ai_test") return false;                  // 패널 미노출 채널
            if (ch === "whatsapp" || ch === "line") return true; // 전지점 공통
            const accId = String(m.account_id || "");
            if (ch === "sms") {                                  // SMS account_id = 지점 bid
              if (userBranches === null) return true;
              return (userBranches||[]).includes(accId);
            }
            if (!accId || accId === "unknown") return true;      // 지점 미지정 메시지 → 노출
            if (allowedAccIds.size === 0) return true;
            return allowedAccIds.has(accId);
          });
          // 사이드바 뱃지: 모든 미읽 즉시
          setUnreadMsgCount(filtered.length);
          // 타임라인 배너: 1분 이상 답변 안 된 것만 (즉시 응답 중인 상담은 제외)
          const delayCutoff = Date.now() - 60_000;
          const delayed = filtered.filter(m => new Date(m.created_at).getTime() <= delayCutoff);
          setUnreadDelayedCount(delayed.length);
          // 스레드별 최신 1건 (user_id+channel 기준) — 배너 미리보기 (delayed 기준)
          const seen = new Set(); const threads = [];
          for (const m of delayed) {
            const key = (m.channel||"")+"_"+(m.user_id||"");
            if (seen.has(key)) continue;
            seen.add(key); threads.push(m);
            if (threads.length >= 5) break;
          }
          setUnreadSample(threads);
        })
        .catch(()=>{});
    };
    loadUnreadRef.current = load;
    load();
    // Realtime: INSERT 시 사이드바 뱃지는 즉시 갱신, 1분 뒤 재평가로 배너 카운트도 갱신. UPDATE(읽음 처리) 즉시 재카운트
    const rt = window._sbClient?.channel("unread_badge")
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},
        p=>{ if(p?.new?.direction==="in"&&!p?.new?.is_read){ load(); setTimeout(load, 60_000); } }
      )
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},
        p=>{ if(p?.new?.is_read===true) load(); }
      )?.subscribe();
    // 30초마다 재평가 (1분 경과 자동 반영)
    const int = setInterval(load, 120_000);
    return ()=>{ try{rt?.unsubscribe();}catch(e){} clearInterval(int); };
  }, [userBranches, isMaster]);
  // 수정요청 pending 카운트 — 테넌트(currentBizId)별. 전환 시 즉시 재조회 (직전 사업장 stale 값 방지)
  useEffect(() => {
    if (!currentBizId) { setPendingReqCount(0); return; }
    setPendingReqCount(0);  // 테넌트 전환 순간 직전 사업장 stale 값 즉시 초기화 (폴링 120초 대기 안 함)
    const load = () => {
      if (!_activeBizId) { setPendingReqCount(0); return; }
      fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.bliss_requests_v1&select=value`, {
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
    const rt = window._sbClient?.channel("requests_badge_"+currentBizId)
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"schedule_data",filter:"key=eq.bliss_requests_v1"}, load)
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"schedule_data",filter:"key=eq.bliss_requests_v1"}, load)
      ?.subscribe();
    const poll = setInterval(load, 120_000);
    return () => { try{rt?.unsubscribe();}catch(e){} clearInterval(poll); };
  }, [currentBizId]);
  // 미확인 공지 팝업 — 본인 이름이 employees_v1에 있고 acks에 없는 공지가 있으면 팝업
  useEffect(() => {
    if (!currentUser?.name) return;
    const DISMISS_KEY = 'bliss_unack_notices_dismissed_v1';
    const getDismissed = () => { try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); } };
    const check = async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=in.(bliss_notices_v1,employees_v1)&select=key,value`, {
          headers: { apikey: SB_KEY, Authorization: "Bearer "+SB_KEY, "Cache-Control":"no-cache" },
          cache: "no-store",
        });
        const rows = await r.json();
        const ntcRow = rows.find(x=>x.key==='bliss_notices_v1');
        const empRow = rows.find(x=>x.key==='employees_v1');
        const ntc = (() => { const v=ntcRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
        const emp = (() => { const v=empRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
        // 본인이 employees_v1에 등록된 직원인 경우만 팝업 대상
        const isEmp = (emp||[]).some(e => e.id === currentUser.name);
        if (!isEmp) return;
        const dismissed = getDismissed();
        const unack = (ntc||[]).filter(n => !(n.acks?.[currentUser.name]) && !dismissed.has(n.id));
        if (unack.length > 0) {
          setUnackNoticesPopup({ count: unack.length, ids: unack.map(n=>n.id) });
        } else {
          setUnackNoticesPopup(null);
        }
      } catch (e) { /* ignore */ }
    };
    check();
    const rt = window._sbClient?.channel("notices_popup")
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"schedule_data",filter:"key=eq.bliss_notices_v1"}, check)
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"schedule_data",filter:"key=eq.bliss_notices_v1"}, check)
      ?.subscribe();
    const poll = setInterval(check, 120_000);
    return () => { try{rt?.unsubscribe();}catch(e){} clearInterval(poll); };
  }, [currentUser?.name]);
  // 팀채팅 공지(📣) — 상단 마퀴 배너로 통합 (AnnouncesMarquee 컴포넌트). 우상단 플로팅 팝업 제거.

  // 팀채팅 안읽음 카운트 (사이드바 합산용) — last_read_at 이후 메시지 수
  // 미매칭 입금 — 단일 소스(배너 + 사이드바 배지 + 메시지함 탭 배지 공용). count + 최근 1건.
  useEffect(() => {
    if (!userBranches?.length) { setPendingDepositCount(0); setDepositLatest(null); return; }
    let alive = true;
    const bidIn = userBranches.map(b=>`"${b}"`).join(',');
    const fetchPending = async () => {
      try {
        const url = `${SB_URL}/rest/v1/bank_deposits?select=id,transferer_name,amount,sms_sent_at&status=eq.pending&bid=in.(${bidIn})&order=sms_sent_at.desc&limit=999`;
        const r = await fetch(url, { headers:{...sbHeaders,'Cache-Control':'no-cache'}, cache:'no-store' });
        if (!alive) return;
        if (r.ok) { const rows = await r.json(); const arr = Array.isArray(rows) ? rows : []; setPendingDepositCount(arr.length); setDepositLatest(arr[0] || null); }
      } catch {}
    };
    fetchPending();
    const t = setInterval(fetchPending, 120000);
    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient.channel('rt_deposits_badge_'+Date.now())
        .on('postgres_changes',{event:'*',schema:'public',table:'bank_deposits'}, fetchPending)
        .subscribe();
    }
    return () => { alive=false; clearInterval(t); if (ch && window._sbClient) window._sbClient.removeChannel(ch); };
  }, [userBranches?.join('|')]);

  // 답글 안 단 네이버 리뷰 — 단일 소스(사이드바 배지 + 메시지함 탭 배지). 폴링만(리뷰는 실시간성 낮음, Realtime 미사용 — 부하 다이어트).
  useEffect(() => {
    if (!userBranches?.length) { setPendingReviewCount(0); return; }
    let alive = true;
    const bidIn = userBranches.map(b=>`"${b}"`).join(',');
    const fetchPendingReviews = async () => {
      try {
        const url = `${SB_URL}/rest/v1/naver_reviews?select=id&has_reply=eq.false&bid=in.(${bidIn})&limit=999`;
        const r = await fetch(url, { headers:{...sbHeaders,'Cache-Control':'no-cache'}, cache:'no-store' });
        if (!alive) return;
        if (r.ok) { const rows = await r.json(); setPendingReviewCount(Array.isArray(rows) ? rows.length : 0); }
      } catch {}
    };
    fetchPendingReviews();
    const t = setInterval(fetchPendingReviews, 600000);
    return () => { alive=false; clearInterval(t); };
  }, [userBranches?.join('|')]);

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

  // 🔔 알림 사운드 — 확정대기/미답변 배너가 0→1 으로 전환될 때 짧은 비프음 재생
  const _prevCountsRef = React.useRef({ msg: 0, pending: 0, initialized: false });
  const _audioCtxRef = React.useRef(null);
  const _pendingAlarmRef = React.useRef(null); // 확정대기 1분 반복 알람 interval
  // times: 패턴 반복 횟수 (처음=1, 반복알람=4). 음량 0.7로 키움(직원이 놓치지 않게)
  const _playBeep = React.useCallback((pattern = "msg", times = 1) => {
    try {
      // 사용자 제스처 후에만 AudioContext 생성 가능 — 실패 시 무음
      if (!_audioCtxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        _audioCtxRef.current = new AC();
      }
      const ctx = _audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(()=>{});
      const tones = pattern === "pending" ? [880, 1175, 880] : [1046, 1318]; // 확정대기: 도미도 / 메시지: 도미
      const dur = 0.16;
      const patLen = tones.length * (dur + 0.05);
      for (let rep = 0; rep < Math.max(1, times); rep++) {
        const base = ctx.currentTime + rep * (patLen + 0.3); // 반복 사이 0.3초 간격
        tones.forEach((freq, i) => {
          const t0 = base + i * (dur + 0.05);
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          osc.connect(gain); gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.02); // 0.25 → 0.7 (더 크게)
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          osc.start(t0); osc.stop(t0 + dur + 0.02);
        });
      }
    } catch(e) { /* 무음 */ }
  }, []);
  useEffect(() => {
    const pendingCnt = (data?.reservations||[]).filter(r =>
      (r.status === "pending" || r.status === "request") &&
      !(r.memo && r.memo.includes("확정완료")) &&
      (userBranches||[]).includes(r.bid)   // 알림음은 본인 접근 지점만 (마스터=전지점 userBranches, 원장=본인지점) — 소이 요청 2026-06-06
    ).length;
    const prev = _prevCountsRef.current;
    // 첫 로드에선 사운드 울리지 않음 (기존 상태 동기화용)
    if (!prev.initialized) {
      _prevCountsRef.current = { msg: unreadMsgCount, pending: pendingCnt, initialized: true };
      return;
    }
    // 확정대기 증가 감지 (우선) — 처음 1번
    if (pendingCnt > prev.pending) { _playBeep("pending", 1); }
    else if (unreadMsgCount > prev.msg) { _playBeep("msg", 1); }
    _prevCountsRef.current = { msg: unreadMsgCount, pending: pendingCnt, initialized: true };
  }, [unreadMsgCount, data?.reservations, userBranches, isMaster, _playBeep]);
  // 🤖 AI 상담중 — 직원이 답 안 해서 AI가 답변 시작한 대화 (최근 10분 내 마지막 발신이 AI). 30초 폴링
  // 직원이 [확인]으로 dismiss하면 그 시점까지 확인 처리 → 새 AI 활동(더 최근 AI 발신) 생길 때만 다시 뜸.
  const _aiActiveRawRef = React.useRef({}); // {sessionKey: {ts, channel, user_id, account_id}}
  const [aiActiveSample, setAiActiveSample] = useState(null); // 첫 AI 상담중 세션 → 배너 클릭 시 그 대화로 이동
  // 확인(dismiss)을 서버(ai_active_ack)에 기록 → 어느 PC에서 확인해도 모든 PC에서 종료 (localStorage 브라우저별 → 서버 공유)
  const dismissAiActive = React.useCallback(() => {
    setAiActiveCount(0); // 이 PC 즉시 클리어
    const biz = currentBizId;
    const acks = Object.entries(_aiActiveRawRef.current||{}).map(([k,v]) => ({ business_id: biz, session_key: k, acked_ts: (v&&v.ts)||v }));
    if (!biz || !acks.length) return;
    fetch(`${SB_URL}/rest/v1/ai_active_ack?on_conflict=business_id,session_key`, {
      method:'POST', headers:{...sbHeaders, 'Content-Type':'application/json', 'Prefer':'resolution=merge-duplicates,return=minimal'},
      body: JSON.stringify(acks)
    }).catch(()=>{});
  }, [currentBizId]);
  useEffect(() => {
    if (!currentBizId) { setAiActiveCount(0); setAiActiveSample(null); return; }
    let alive = true;
    let failCnt = 0; // 폴링 연속 실패 시 마지막 카운트(>0)가 고착돼 유령 알람 → 3회(90초) 실패하면 0으로 decay
    const _fail = () => { failCnt += 1; if (failCnt >= 3 && alive) { setAiActiveCount(0); setAiActiveSample(null); } };
    const load = async () => {
      try {
        const since = new Date(Date.now() - 10*60*1000).toISOString().replace('+','%2B');
        // 인바운드는 더 넓게(70분) — "AI 상담중" = 고객 메시지에 AI가 '응답'한 대화만.
        // 리마인더·포인트알림 등 시스템 선발송(is_ai=true지만 고객 메시지 없음)은 제외 (id_a5r0bbcvyn 오알람 fix)
        const sinceIn = new Date(Date.now() - 70*60*1000).toISOString().replace('+','%2B');
        const [mr, ir, ar] = await Promise.all([
          fetch(`${SB_URL}/rest/v1/messages?business_id=eq.${currentBizId}&direction=eq.out&created_at=gte.${since}&select=channel,user_id,account_id,is_ai,created_at&order=created_at.desc&limit=300`,
            { headers: {...sbHeaders, 'Cache-Control':'no-cache'}, cache:'no-store' }),
          fetch(`${SB_URL}/rest/v1/messages?business_id=eq.${currentBizId}&direction=eq.in&created_at=gte.${sinceIn}&select=channel,user_id,created_at&order=created_at.desc&limit=400`,
            { headers: {...sbHeaders, 'Cache-Control':'no-cache'}, cache:'no-store' }),
          fetch(`${SB_URL}/rest/v1/ai_active_ack?business_id=eq.${currentBizId}&select=session_key,acked_ts`,
            { headers: {...sbHeaders, 'Cache-Control':'no-cache'}, cache:'no-store' }),
        ]);
        if (!alive) return;
        if (!mr.ok) { _fail(); return; }
        failCnt = 0;
        const rows = await mr.json();
        const inRows = ir.ok ? await ir.json() : [];
        const ackRows = ar.ok ? await ar.json() : [];
        const ack = {}; for (const a of (ackRows||[])) ack[a.session_key] = a.acked_ts;
        const inFirst = {}; // 세션별 가장 이른(=가장 오래된) 인바운드 시각 — desc 순회라 마지막 할당이 earliest
        for (const m of (inRows||[])) { inFirst[(m.channel||'')+'_'+m.user_id] = m.created_at; }
        const latest = {};
        for (const m of (rows||[])) { const k=(m.channel||'')+'_'+m.user_id; if(!latest[k]) latest[k]=m; } // desc → 첫 게 최신
        // 마지막 발신이 AI + 그 발신 전에 고객 인바운드가 있던 대화만(=응답) + 확인(ack) 안 된 것
        const live = Object.entries(latest).filter(([k,m]) =>
          m.is_ai && inFirst[k] && inFirst[k] <= m.created_at && !(ack[k] && ack[k] >= m.created_at));
        _aiActiveRawRef.current = Object.fromEntries(live.map(([k,m]) => [k, {ts:m.created_at, channel:m.channel, user_id:m.user_id, account_id:m.account_id}]));
        setAiActiveCount(live.length);
        const first = live[0]?.[1];
        setAiActiveSample(first ? {channel:first.channel, user_id:first.user_id, account_id:first.account_id} : null);
      } catch { _fail(); }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive=false; clearInterval(t); };
  }, [currentBizId]);
  // 🔔 확정대기/AI상담중 반복 알람 — 처음 1번 울린 뒤, 남아있는 동안 1분마다 4번씩 (직원이 확인할 때까지)
  // 울리기 직전 ref로 최신 조건 재확인 — effect 재실행이 늦어도(절전·백그라운드 탭) 조건 꺼지면 즉시 무음 (유령 알람 방지)
  const _alarmOnRef = React.useRef(false);
  const _alarmCtxRef = React.useRef({ userBranches: [], aiActiveCount: 0 }); // 인터벌 콜백용 최신 컨텍스트 (인터벌은 한 번 만들면 클로저가 고정이라 ref 경유)
  useEffect(() => {
    const hasPending = (data?.reservations||[]).some(r =>
      (r.status === "pending" || r.status === "request") &&
      !(r.memo && r.memo.includes("확정완료")) &&
      (userBranches||[]).includes(r.bid)   // 본인 접근 지점만 (소이 요청 2026-06-06)
    );
    const hasAlarm = hasPending || aiActiveCount > 0;
    _alarmOnRef.current = hasAlarm;
    _alarmCtxRef.current = { userBranches: userBranches||[], aiActiveCount };
    if (hasAlarm && !_pendingAlarmRef.current) {
      // 울리기 직전 서버 재검증 (v3.8.45 유령 알람 2차 방어) — 클라이언트 stale 데이터가 확정대기를 가짜로 들고 있어도
      // 서버에 실제 pending/request가 없으면 무음 + 알람 강제 해제. 알람 활성 중에만 1분당 1건짜리 가벼운 조회.
      _pendingAlarmRef.current = setInterval(async () => {
        if (!_alarmOnRef.current) return;
        const ctx = _alarmCtxRef.current || {};
        try {
          if (_activeBizId && (ctx.userBranches||[]).length && !(ctx.aiActiveCount > 0)) {
            const bidIn = (ctx.userBranches||[]).map(encodeURIComponent).join(',');
            const vr = await fetch(`${SB_URL}/rest/v1/reservations?business_id=eq.${_activeBizId}&status=in.(pending,request)&is_beta=eq.false&bid=in.(${bidIn})&or=(memo.is.null,memo.not.like.*${encodeURIComponent('확정완료')}*)&select=id&limit=1`,
              { headers: { apikey: SB_KEY, Authorization: "Bearer "+SB_KEY, "Cache-Control": "no-cache" }, cache: "no-store" });
            if (vr.ok) {
              const rows = await vr.json();
              if (!(Array.isArray(rows) && rows.length > 0)) { _alarmOnRef.current = false; return; } // 서버에 없음 = 유령 → 무음
            }
          }
        } catch {} // 검증 실패(네트워크 등) 시엔 기존 동작 유지 (실제 확정대기 놓치는 것보다 안전)
        if (_alarmOnRef.current) _playBeep("pending", 4);
      }, 60000);
    } else if (!hasAlarm && _pendingAlarmRef.current) {
      clearInterval(_pendingAlarmRef.current);
      _pendingAlarmRef.current = null;
    }
  }, [data?.reservations, userBranches, isMaster, aiActiveCount, _playBeep]);
  useEffect(() => () => { if (_pendingAlarmRef.current) clearInterval(_pendingAlarmRef.current); }, []);
  // AI 상담중 0→증가 시 즉시 1번 (확정대기 증가감지 effect와 별개)
  const _prevAiActiveRef = React.useRef(0);
  useEffect(() => {
    if (aiActiveCount > _prevAiActiveRef.current) _playBeep("pending", 1);
    _prevAiActiveRef.current = aiActiveCount;
  }, [aiActiveCount, _playBeep]);
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
  const [messagesPanelOpen, setMessagesPanelOpen] = useState(false);
  // 사이드바에서 받은메시지함 클릭할 때마다 카운터 증가 → AdminInbox가 sel 리셋 (첫 화면으로)
  const [inboxResetKey, setInboxResetKey] = useState(0);
  // body data attribute로 패널 상태 토글 — 글로벌 CSS에서 모달이 메시지함 영역 침범 안 하도록
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.msgPanel = messagesPanelOpen ? "open" : "closed";
    return () => { try { delete document.body.dataset.msgPanel; } catch {} };
  }, [messagesPanelOpen]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.msgChatOpen = isChatOpen ? "open" : "closed";
    return () => { try { delete document.body.dataset.msgChatOpen; } catch {} };
  }, [isChatOpen]);
  const setPage = useCallback((p) => {
    // 받은메시지함은 라우트 이동 대신 우측 사이드 패널 (모바일은 기존 풀스크린 라우팅 유지)
    const isMob = typeof window !== "undefined" && window.innerWidth < 768;
    if (p === "messages" && !isMob) {
      // 항상 오픈 (재클릭 토글 X). 닫기는 × 버튼으로 — race condition 방지
      // 클릭마다 inboxResetKey 증가 → AdminInbox가 sel 리셋해서 첫 화면(리스트)으로 돌아감
      setMessagesPanelOpen(true);
      setInboxResetKey(k => k + 1);
      return;
    }
    // 다른 페이지로 이동 — 패널은 그대로 유지 (사용자가 채팅하면서 페이지 작업)
    const url = PAGE_ROUTES[p] || "/timeline";
    navigate(url);
  }, [navigate]);
  // pendingChat이 설정되면 사이드 패널 자동 오픈 (예약 모달 → 대화보기 등)
  useEffect(() => {
    if (pendingChat && typeof window !== "undefined" && window.innerWidth >= 768) {
      setMessagesPanelOpen(true);
    }
  }, [pendingChat]);

  // 새 버전 감지 — 강제 reload 안 함. 페이지 이동(라우트 변경) 시점에 자동 reload.
  const [newVer, setNewVer] = useState(null);
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
  // 새 버전 감지 시 — 강제 reload 안 함. 사용자가 60초 이상 무입력 + 모달/입력창 없을 때 자동 reload.
  // 메모/예약/매출 모달 작성 중에는 절대 reload 안 일어나도록 보호.
  useEffect(() => {
    if (!newVer) return;
    const lastActivity = { t: Date.now() };
    const onActivity = () => { lastActivity.t = Date.now(); };
    window.addEventListener('keydown', onActivity, true);
    window.addEventListener('mousemove', onActivity, true);
    window.addEventListener('click', onActivity, true);
    window.addEventListener('touchstart', onActivity, true);
    window.addEventListener('scroll', onActivity, true);
    const tryReload = () => {
      // 1) 60초 무입력 체크
      if (Date.now() - lastActivity.t < 60_000) return;
      // 2) 입력창 focus 체크 (input/textarea/contenteditable)
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      // 3) 큰 fixed overlay (모달/패널) 존재 체크 — z-index ≥ 90, 화면 절반 이상
      const all = document.querySelectorAll('div');
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of all) {
        const cs = window.getComputedStyle(el);
        if (cs.position !== 'fixed') continue;
        const z = parseInt(cs.zIndex || '0', 10);
        if (!(z >= 90)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.4 || r.height < vh * 0.3) continue;
        // 모달/패널 열려있음 → reload 보류
        return;
      }
      // 모든 조건 통과 → reload
      try { window.location.href = window.location.pathname + "?v=" + newVer; }
      catch(e) { window.location.reload(); }
    };
    const iv = setInterval(tryReload, 10_000);
    return () => {
      clearInterval(iv);
      window.removeEventListener('keydown', onActivity, true);
      window.removeEventListener('mousemove', onActivity, true);
      window.removeEventListener('click', onActivity, true);
      window.removeEventListener('touchstart', onActivity, true);
      window.removeEventListener('scroll', onActivity, true);
    };
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
        const users = fromDb("app_users", await sb.get("app_users_safe"));
        if (users.length === 0) {
          setAllUsers([{id:"acc_super", loginId:"admin", pw:"1234", name:"BlissMe 관리자", role:"super", branches:[], viewBranches:[]}]);
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
            const provider = authUser.app_metadata?.provider || 'oauth';
            const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.user_metadata?.preferred_username || (email ? email.split('@')[0] : provider + '사용자');
            // 멤버십 모델: auth_oauth → account 찾기/생성(사업장 미생성). provider+authId = 안정 login_id.
            const provLogin = provider + '_' + authUser.id;
            try {
              const { SB_URL, SB_KEY } = await import('../lib/supabase');
              const r = await fetch(`${SB_URL}/rest/v1/rpc/auth_oauth`, {
                method: 'POST',
                headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_email: email, p_provider_login: provLogin, p_name: name }),
              });
              if (r.ok) {
                const d = await r.json();
                if (d?.account) { handleAccountLogin(d.account, d.memberships || [], true); return; }
              }
            } catch(e) { console.warn('[oauth] err', e); }
          }
          setPhase("login");
        }
      } catch(e) {
        console.error("DB 연결 실패:", e);
        setAllUsers([{id:"acc_super", loginId:"admin", pw:"1234", name:"BlissMe 관리자", role:"super", branches:[], viewBranches:[]}]);
        setPhase("login");
      }
    })();
  }, []);

  // 멤버십 모델 진입점 — account + memberships 목록을 받아 분기
  // 활성 멤버십 1개 → 바로 진입 / 여러개 → 선택 / 0개 → 승인대기 or 미가입
  const handleAccountLogin = (account, memberships, isAutoLogin) => {
    const active = (memberships || []).filter(m => m.status === "active");
    if (active.length === 1) {
      handleLogin(mapMembership(active[0], account), isAutoLogin);
    } else if (active.length > 1) {
      setPendingAccount({ account, memberships: active });
      setPhase("pick_membership");
    } else {
      const hasPending = (memberships || []).some(m => m.status === "pending");
      setPendingAccount({ account, memberships: memberships || [] });
      setPhase(hasPending ? "staff_pending" : "no_membership");
    }
  };

  // Handle login → route to super dashboard or business app
  const handleLogin = async (user, isAutoLogin) => {
    setCurrentUser(user);
    setRole(user.role);
    // 계정 보안 감시 — 로그인 접속정보 기록 (IP/국가/OS/브라우저/기기는 서버가 CF헤더·UA로 채움)
    try {
      fetch("https://blissme.ai/log-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: user.account_id || user.accountId || "",
          login_id: user.loginId || user.login_id || "",
          business_id: user.businessId || user.business_id || "",
          name: user.name || "", role: user.role || "",
          ua: navigator.userAgent,
        }),
      }).catch(() => {});
    } catch {}
    // Save session only on manual login (auto-login already has session)
    if (!isAutoLogin) {
      try{localStorage.setItem("bliss_session",JSON.stringify({userId:user.id,loginId:user.loginId||user.login_id}));}catch(e){}
    }
    if (user.role === "super") {
      setLoadMsg("매장 데이터 로딩 중...");
      setPhase("loading");
      try {
        // 어드민은 로그인 시 "매장 선택" 화면 — 원하는 업체를 직접 골라야 그 매장 타임라인이 보임(자동 진입 X).
        const bizList = (await sb.get("businesses", "")).filter(b => b.id !== "biz_system");
        setSuperBizList(bizList);
        setPhase("pick_biz");
      } catch(e) {
        console.error(e);
        setSuperData({ businesses:[], groups:[], groupMembers:[], users:[] });
        setPhase("super");
      }
    } else {
      const bizId = user.businessId || user.business_id;
      if (!bizId) { alert("사업자 연결 정보가 없습니다."); setPhase("login"); return; }
      setCurrentBizId(bizId);
      setActiveBiz(bizId);
      setLoadMsg("매장 데이터 로딩 중...");
      setPhase("loading");
      try {
        // Load business info
        const bizList = await sb.get("businesses", `&id=eq.${bizId}`);
        setCurrentBiz(bizList[0] || { name: "매장" });
        // 기능 토글 로드 (사업장별 features → 런타임 _features에 적재). plan 컬럼 fallback으로 derive
        setFeatures(extractFeatures(bizList[0]?.settings, bizId, bizList[0]?.plan));
        // businesses.settings에서 gemini_key / ai_rules 복원 (localStorage 삭제 후 복구)
        try {
          const memo = JSON.parse(bizList[0]?.settings || "{}");
          if (memo.gemini_key) {
            localStorage.setItem("bliss_gemini_key", memo.gemini_key);
            window.__geminiKey = memo.gemini_key;
            // 키 일원화: 로그인 후엔 시스템 변수도 매장 키(서버 공용·단일 관리)로 덮어 stale 시스템 키가 1순위로 끼어드는 것 방지
            window.__systemGeminiKey = memo.gemini_key;
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
        // SchedulePage 등에서 쓰는 BRANCHES_SCH 동적 갱신 (멀티테넌트)
        refreshBranchesSch(db.branches);
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
        // 예약 백그라운드 로드 — 첫 화면 렌더 후 보충 (예약목록·신규예약 배지용)
        loadReservations(bizId).then(res => { if (res.length) setData(prev => {
          const map = new Map(res.map(r => [r.id, r]));
          (prev?.reservations||[]).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
          return { ...prev, reservations: Array.from(map.values()) };
        }); }).catch(()=>{});
        // 새 OAuth 유저 → 블리스 AI 설정 마법사 자동 시작
        if (sessionStorage.getItem('bliss_new_oauth_user')) {
          sessionStorage.removeItem('bliss_new_oauth_user');
          sessionStorage.setItem('bliss_open_setup', '1');
          setTimeout(() => setPage("blissai"), 500);
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
      // 어드민(super) 매장 전환 드롭다운용 전체 업체 목록 (한 번만 로드)
      if (currentUser?.role === "super") {
        sb.get("businesses", "").then(all => setSuperBizList((all||[]).filter(b => b.id !== "biz_system"))).catch(()=>{});
      }
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
      // 예약 백그라운드 로드 — 첫 화면 렌더 후 보충
      loadReservations(bizId).then(res => { if (res.length) setData(prev => {
        const map = new Map(res.map(r => [r.id, r]));
        (prev?.reservations||[]).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
        return { ...prev, reservations: Array.from(map.values()) };
      }); }).catch(()=>{});
    } catch(e) { console.error(e); setPhase("super"); }
  };

  const handleLogout = () => {
    try{localStorage.removeItem("bliss_session");}catch(e){}
    navigate("/timeline", {replace:true});
    setCurrentUser(null); setCurrentBizId(null); setCurrentBiz(null);
    setPendingAccount(null);
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




  // ─── 직원(staff) 라우트 가드 — 공지·타임라인 외 경로 접근 차단 ───
  useEffect(() => {
    if (phase !== "app" || role !== "staff") return;
    const p = location.pathname;
    const allowed = p === "/" || p.startsWith("/timeline") || p.startsWith("/requests");
    if (!allowed) navigate("/timeline", { replace: true });
  }, [phase, role, location.pathname]);

  // ─── 예약 실시간 동기화 ───
  useEffect(() => {
    if (phase !== "app" || !currentBizId) return;
    let channel = null;
    const supaClient = _supaClient;

    // iOS PWA: 백그라운드→포그라운드 복귀 시 30일 전체 동기화.
    // 단, 60초 내 이미 전체 동기화했으면 스킵 — 짧은 앱 전환마다 ~10MB 중복 fetch 방지(RT 구독 + 120s 폴링이 그 사이 커버).
    let lastResFull = Date.now();
    const onVisible = async () => {
      if (document.hidden) return;
      if (Date.now() - lastResFull < 60000) return;
      lastResFull = Date.now();
      try {
        // 최근 30일 범위만 갱신 (전체 history reload 방지) — 윈도우 안은 교체(삭제 반영), 밖은 on-demand 로드분 보존
        const _since = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        const rows = await sb.getAll("reservations", `&business_id=eq.${currentBizId}&is_beta=eq.false&date=gte.${_since}&order=date.desc,time.asc`);
        const parsed = fromDb("reservations", rows);
        setData(prev => {
          if (!prev) return prev;
          const kept = (prev.reservations||[]).filter(r => !r.date || r.date < _since);
          return {...prev, reservations: [...kept, ...parsed]};
        });
      } catch(e) {}
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
            // 베타 격리: 라이브 화면에는 is_beta=true 예약 전파 안 함 (베타 페이지는 자체 fetch)
            if (row.is_beta === true || (ev === "DELETE" && oldRow.is_beta === true)) return;
            console.log("[RT] reservation", ev, row?.id||oldRow?.id, row?.time, "bid=", row?.bid);
            setData(prev => {
              if (!prev) return prev;
              try {
                const parsed = row.id ? fromDb("reservations", [row])[0] : null;
                if (ev === "INSERT" && parsed) {
                  // 네이버 신규 예약 우상단 플로팅 팝업 제거(2026-05-29 정우님 요청) — 알림은 상단 막대배너(TimelinePage 확정대기/신규고객)로만 유지
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
      if (Date.now() - lastResFull < 60000) return;
      lastResFull = Date.now();
      try {
        // 최근 30일 범위만 갱신 (전체 history reload 방지) — 윈도우 안은 교체(삭제 반영), 밖은 on-demand 로드분 보존
        const _since = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        const rows = await sb.getAll("reservations", `&business_id=eq.${currentBizId}&is_beta=eq.false&date=gte.${_since}&order=date.desc,time.asc`);
        const parsed = fromDb("reservations", rows);
        setData(prev => {
          if (!prev) return prev;
          const kept = (prev.reservations||[]).filter(r => !r.date || r.date < _since);
          return {...prev, reservations: [...kept, ...parsed]};
        });
      } catch(e) {}
    };
    window.addEventListener("online", onOnline);

    // 폴링 fallback — Realtime 채널 오류 시에도 stale state 방지 (120초, 최근 예약 범위만)
    const pollInt = setInterval(async () => {
      if (document.hidden) return; // 백그라운드 탭은 스킵
      try {
        const today = new Date();
        const d2s = (d) => d.toISOString().slice(0,10);
        const from = new Date(today); from.setDate(today.getDate() - 3);
        const to   = new Date(today); to.setDate(today.getDate() + 60);
        const rows = await sb.getAll("reservations",
          `&business_id=eq.${currentBizId}&is_beta=eq.false&date=gte.${d2s(from)}&date=lte.${d2s(to)}&order=date.desc,time.asc`);
        const parsed = fromDb("reservations", rows||[]);
        if (parsed.length > 0) {
          setData(prev => {
            if (!prev) return prev;
            const map = new Map((prev.reservations||[]).map(r => [r.id, r]));
            parsed.forEach(r => map.set(r.id, r));
            return { ...prev, reservations: Array.from(map.values()) };
          });
        }
      } catch(e) {}
    }, 120000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(pollInt);
      if (channel && supaClient) { try { supaClient.removeChannel(channel); } catch(e){} }
    };
  }, [phase, currentBizId]);


  // "← 매장 선택" — 매장 선택 화면(picker)으로 복귀 (다른 매장 골라 모니터링)
  const handleBackToSuper = async () => {
    try{const s=JSON.parse(localStorage.getItem("bliss_session")||"{}");delete s.bizId;localStorage.setItem("bliss_session",JSON.stringify(s));}catch(e){}
    setLoadMsg("매장 목록 불러오는 중...");
    setPhase("loading");
    try {
      const bizList = (await sb.get("businesses", "")).filter(b => b.id !== "biz_system");
      setSuperBizList(bizList);
      setRole("super");
      setCurrentBizId(null); setCurrentBiz(null); setData(null); setActiveBiz(null);
      setPhase("pick_biz");
    } catch(e) {
      console.error("handleBackToSuper error:", e);
      setPhase("pick_biz");
    }
  };
  // 업체 관리(추가/수정/삭제) — 전체 SuperDashboard CRUD 화면으로
  const handleOpenManage = async () => {
    setLoadMsg("관리자 데이터 로딩 중...");
    setPhase("loading");
    try { const sd = await loadAllFromDb(null); setSuperData(sd); setRole("super"); setPhase("super"); }
    catch(e) { console.error(e); setSuperData({ businesses:[], groups:[], groupMembers:[], users:[] }); setPhase("super"); }
  };

  if (phase === "loading") return <Loading msg={loadMsg} />;
  if (phase === "login") return <Login users={allUsers} onAccountLogin={handleAccountLogin}
    onSignup={(account) => handleAccountLogin(account, [])} />;
  if (phase === "pick_membership" || phase === "staff_pending" || phase === "no_membership")
    return <AccountGate mode={phase} pendingAccount={pendingAccount}
      onPick={(m)=>handleLogin(mapMembership(m, pendingAccount?.account))}
      onJoinSuccess={()=>setPhase("staff_pending")}
      onCreateBiz={(membership)=>handleLogin(membership)}
      onLogout={handleLogout} />;
  if (phase === "pick_biz") return <BizPicker businesses={superBizList} onPick={handleEnterBiz} onManage={handleOpenManage} onLogout={handleLogout} />;
  if (phase === "super") return <SuperDashboard superData={superData} setSuperData={setSuperData} currentUser={currentUser} onLogout={handleLogout} onEnterBiz={handleEnterBiz} onBackToPicker={handleBackToSuper} />;

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
  // 직원(staff)은 공지·타임라인만. 그 외 메뉴 비노출 (라우트 가드와 함께 동작)
  const nav = role === "staff" ? [
    { id:"timeline", label:"타임라인", icon:<I name="calendar" size={16}/> },
    { id:"requests", label:"공지 & 요청", icon:"📢", badge:pendingReqCount },
  ] : [
    { id:"timeline", label:"타임라인", icon:<I name="calendar" size={16}/> },
    { id:"reservations", label:"예약목록", icon:<I name="clipboard" size={16}/> },
    { id:"sales", label:"매출관리", icon:<I name="wallet" size={16}/> },
    { id:"customers", label:"고객관리", icon:<I name="users" size={16}/> },
    { id:"marketing", label:"마케팅", icon:<I name="msgSq" size={16}/> },
    ...((role==="owner"||role==="super")?[{ id:"users", label:"사용자관리", icon:<I name="user" size={16}/> }]:[]),
    { id:"messages", label:"받은메시지함", icon:<I name="msgSq" size={16}/>, badge: unreadMsgCount + pendingDepositCount + pendingReviewCount },
    { id:"admin", label:"관리설정", icon:<I name="settings" size={16}/> },
    { id:"requests", label:"공지 & 요청", icon:"📢", badge:pendingReqCount },
  ];

  const branchNames = userBranches.map(bid => (data.branches||[]).find(b=>b.id===bid)?.short||bid).filter(Boolean).join(", ");
  // 데모/체험 테넌트는 실제 브랜드명(하우스왁싱 등) 노출 금지 — 화면 표시만 가명
  const _isDemoBiz = (b) => !!b && (/^(DEMOHW|TOSS_DEMO)$/i.test(b.code||"") || /체험|데모|demo/i.test(b.code||"") || /체험|데모/.test(b.name||""));
  const bizName = (() => {
    const n = currentBiz?.name || "";
    if (_isDemoBiz(currentBiz) && /하우스왁싱/.test(n)) return "체험 매장";
    return n;
  })();
  // 어드민(super) 매장 전환 드롭다운 — 매장을 휙휙 바꿔가며 타임라인 모니터링 (데모는 가명 표시)
  const bizSwitcher = isSuper ? {
    current: currentBizId,
    onSwitch: handleEnterBiz,
    options: (superBizList||[]).map(b => ({
      id: b.id,
      name: (_isDemoBiz(b) && /하우스왁싱/.test(b.name||"")) ? "체험 매장" : (b.name || b.id),
    })),
  } : null;

  return (
    <div style={S.root}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet"/>

      <aside className="sidebar-d" style={S.sidebar}>
        <Sidebar nav={nav} page={page} setPage={setPage} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV} BLISS_V={BLISS_V} billingState={billingState} scraperStatus={scraperStatus} bizSwitcher={bizSwitcher}/>
      </aside>
      {sideOpen && <div className="sidebar-m" style={{position:"fixed",inset:0,zIndex:300}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}} onClick={()=>setSideOpen(false)}/>
        <div style={{position:"relative",width:260,height:"100%",background:T.bgCard,display:"flex",flexDirection:"column",animation:"slideIn .5s cubic-bezier(.22,1,.36,1)"}}>
          <Sidebar nav={nav} page={page} setPage={p=>{setPage(p);setSideOpen(false)}} role={role} branchNames={branchNames} onLogout={handleLogout} bizName={bizName} isSuper={isSuper} onBackToSuper={handleBackToSuper} serverV={serverV} BLISS_V={BLISS_V} billingState={billingState} scraperStatus={scraperStatus} bizSwitcher={bizSwitcher} isMobile/>
        </div>
      </div>}
      {newVer && <div onClick={()=>{try{window.location.href=window.location.pathname+"?v="+newVer;}catch(e){window.location.reload();}}} style={{position:"fixed",top:10,right:10,zIndex:9999,background:T.primary,color:"#fff",padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.25)",animation:"ovFadeIn .3s"}}>
        🔄 새 버전 v{newVer} — 즉시 업데이트
      </div>}
      {/* 플로팅 AI — 우하단 항상 표시 */}
      {/* 블리스 AI 플로팅 버튼 — 공지 발송 등 버튼 가림 이슈로 일단 숨김 (복구: false→true, 정우님 2026-06-01) */}
      {false && <FloatingAI data={data} currentUser={currentUser} isMaster={isMaster} bizId={currentBizId}/>}
      {/* 우클릭 → 수정 요청(화면 캡처 + 바로 등록) — 전 직원 */}
      <QuickRequest currentUser={currentUser} userBranches={userBranches}/>
      {/* 받은메시지함 사이드 패널 — 좌측(사이드바 우측) 슬라이드, 다른 페이지 작업 가능 */}
      {messagesPanelOpen && (
        <div className="msg-panel" style={{position:"fixed",top:0,left:200,bottom:0,width:340,maxWidth:"95vw",background:"#fff",borderRight:"1px solid "+T.border,boxShadow:"4px 0 16px rgba(0,0,0,.08)",zIndex:400,display:"flex",flexDirection:"column",animation:"slideIn .3s cubic-bezier(.22,1,.36,1)"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border,background:T.bgCard,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:T.fw.bolder}}>
              <I name="msgSq" size={14}/> 받은메시지함
              {(unreadMsgCount + pendingDepositCount + pendingReviewCount) > 0 && <span style={{background:T.danger,color:"#fff",borderRadius:10,fontSize:10,fontWeight:700,padding:"1px 6px"}}>{unreadMsgCount + pendingDepositCount + pendingReviewCount}</span>}
            </div>
            <button onClick={()=>setMessagesPanelOpen(false)} title="닫기" style={{width:24,height:24,borderRadius:12,border:"none",background:T.gray100,color:T.textSub,cursor:"pointer",fontSize:16,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>×</button>
          </div>
          <div style={{flex:1,minHeight:0,overflow:"hidden",position:"relative"}}>
            <AdminInbox sb={sb} branches={data?.branches} data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} currentUser={currentUser} onRead={(cnt)=>{setUnreadMsgCount(prev=>Math.max(0,prev-(cnt||1)));loadUnreadRef.current&&loadUnreadRef.current();}} onChatOpen={setIsChatOpen} pendingChat={pendingChat} onPendingChatDone={()=>setPendingChat(null)} setPendingOpenRes={setPendingOpenRes} setPage={setPage} forceCompact={true} inboxResetKey={inboxResetKey} depositPending={pendingDepositCount} reviewPending={pendingReviewCount} onClosePanel={()=>setMessagesPanelOpen(false)} setPendingOpenCust={setPendingOpenCust} onReviewReplied={()=>setPendingReviewCount(p=>Math.max(0,p-1))}/>
          </div>
        </div>
      )}
      {/* 미확인 공지 팝업 */}
      {unackNoticesPopup && unackNoticesPopup.count > 0 && (
        <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{
            try {
              const cur = JSON.parse(sessionStorage.getItem('bliss_unack_notices_dismissed_v1') || '[]');
              const next = Array.from(new Set([...cur, ...unackNoticesPopup.ids]));
              sessionStorage.setItem('bliss_unack_notices_dismissed_v1', JSON.stringify(next));
            } catch {}
            setUnackNoticesPopup(null);
          }}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,borderRadius:16,maxWidth:360,width:"100%",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,.4)",animation:"ovFadeIn .25s"}}>
            <div style={{fontSize:34,marginBottom:8,textAlign:"center"}}>📢</div>
            <div style={{fontSize:18,fontWeight:T.fw.black,color:T.text,textAlign:"center",marginBottom:8}}>
              확인 안 한 공지가 {unackNoticesPopup.count}건 있어요
            </div>
            <div style={{fontSize:13,color:T.textMuted,textAlign:"center",lineHeight:1.5,marginBottom:18}}>
              공지를 열어 본인 이름을 클릭해<br/>확인 완료 처리해주세요.
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{
                try {
                  const cur = JSON.parse(sessionStorage.getItem('bliss_unack_notices_dismissed_v1') || '[]');
                  const next = Array.from(new Set([...cur, ...unackNoticesPopup.ids]));
                  sessionStorage.setItem('bliss_unack_notices_dismissed_v1', JSON.stringify(next));
                } catch {}
                setUnackNoticesPopup(null);
              }}
                style={{flex:1,padding:"11px 0",borderRadius:10,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                나중에
              </button>
              <button onClick={()=>{
                setUnackNoticesPopup(null);
                navigate("/requests");
              }}
                style={{flex:1.4,padding:"11px 0",borderRadius:10,border:"none",background:"#7C3AED",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                지금 확인하기 →
              </button>
            </div>
          </div>
        </div>
      )}
      <main className="main-c" style={{...S.main, marginLeft: 200 + (messagesPanelOpen ? 340 : 0), transition:"margin-left .25s cubic-bezier(.22,1,.36,1)"}}>
        <div className="mob-hdr" style={{display:"none"}}></div>
        <AnnouncesMarquee/>
        <StaffRequestsBanner bizId={currentBizId} role={role} branches={data?.branches} />
        {role !== "staff" && <DepositsAlertBanner
          count={pendingDepositCount} latest={depositLatest}
          onOpen={() => {
            window.__bliss_inbox_initial_tab = 'deposits';
            setMessagesPanelOpen(true);
            setTimeout(() => {
              try { window.dispatchEvent(new CustomEvent('bliss:inbox_tab', { detail:{ tab:'deposits' } })); } catch {}
            }, 60);
          }}
        />}
        {role !== "staff" && <ChangeReqBanner
          userBranches={userBranches}
          onOpen={(row) => {
            if (row?.user_id) setPendingChat({ user_id: row.user_id, channel: row.channel, account_id: row.account_id });
            setMessagesPanelOpen(true);
            try {
              fetch(`${SB_URL}/rest/v1/ai_change_requests?id=eq.${row.id}`, {
                method:'PATCH',
                headers:{...sbHeaders,'Content-Type':'application/json','Prefer':'return=minimal'},
                body: JSON.stringify({ status:'handled', handled_at: new Date().toISOString() }),
              });
            } catch {}
          }}
        />}
        <div className="page-pad" style={{flex:1,padding:(page==="timeline"||page==="messages"||page==="schedule")?"0":"16px 20px 16px",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
          <Routes>
            <Route path="/announce-test" element={<AnnounceDesignGallery/>}/>
            <Route path="/timeline" element={<div className="tl-card-wrap" style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><div className="tl-card-inner" style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><Timeline data={data} setData={setData} userBranches={userBranches} viewBranches={viewBranches} isMaster={isMaster} currentUser={currentUser} setPage={setPage} bizId={currentBizId} onMenuClick={()=>setSideOpen(true)} bizName={bizName} pendingOpenRes={pendingOpenRes} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} scraperStatus={scraperStatus} setPendingChat={setPendingChat} setPendingOpenCust={setPendingOpenCust} unreadMsgCount={unreadMsgCount} unreadDelayedCount={unreadDelayedCount} unreadSample={unreadSample} messagesPanelOpen={messagesPanelOpen} aiActiveCount={aiActiveCount} aiActiveSample={aiActiveSample} dismissAiActive={dismissAiActive}/></div></div>}/>
            <Route path="/timeline-preview" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><Timeline data={data} setData={setData} userBranches={userBranches} viewBranches={viewBranches} isMaster={isMaster} currentUser={currentUser} setPage={setPage} bizId={currentBizId} onMenuClick={()=>setSideOpen(true)} bizName={bizName} pendingOpenRes={pendingOpenRes} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} scraperStatus={scraperStatus} setPendingChat={setPendingChat} setPendingOpenCust={setPendingOpenCust} unreadMsgCount={unreadMsgCount} unreadSample={unreadSample} previewBlockStyle={true}/></div>}/>
            <Route path="/reservations" element={<ScrollArea storageKey="page_reservations"><ReservationList data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage} setPendingOpenRes={setPendingOpenRes} naverColShow={naverColShow} setNaverColShow={setNaverColShow}/></ScrollArea>}/>
            <Route path="/sales" element={<ScrollArea storageKey="page_sales"><SalesPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} setPage={setPage} role={role} setPendingOpenCust={setPendingOpenCust}/></ScrollArea>}/>
            <Route path="/sale-summary" element={<ScrollArea storageKey="page_sale_summary"><SaleSummary/></ScrollArea>}/>
            <Route path="/customers" element={<ScrollArea storageKey="page_customers"><CustomersPage data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} pendingOpenCust={pendingOpenCust} setPendingOpenCust={setPendingOpenCust} setPage={setPage} setPendingOpenRes={setPendingOpenRes}/></ScrollArea>}/>
            <Route path="/marketing" element={<ScrollArea storageKey="page_marketing"><MarketingBroadcast data={data} userBranches={userBranches} bizId={currentBizId} currentUser={currentUser} isMaster={isMaster}/></ScrollArea>}/>
            <Route path="/users" element={<ScrollArea storageKey="page_users"><UsersPage data={data} setData={setData} bizId={currentBizId}/></ScrollArea>}/>
            <Route path="/messages" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}><AdminInbox sb={sb} branches={data?.branches} data={data} setData={setData} userBranches={userBranches} isMaster={isMaster} currentUser={currentUser} onRead={(cnt)=>{setUnreadMsgCount(prev=>Math.max(0,prev-(cnt||1)));loadUnreadRef.current&&loadUnreadRef.current();}} onChatOpen={setIsChatOpen} pendingChat={pendingChat} onPendingChatDone={()=>setPendingChat(null)} setPendingOpenRes={setPendingOpenRes} setPage={setPage} depositPending={pendingDepositCount} reviewPending={pendingReviewCount} setPendingOpenCust={setPendingOpenCust} onReviewReplied={()=>setPendingReviewCount(p=>Math.max(0,p-1))}/></div>}/>
            <Route path="/schedule" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>{isMaster && <SchedulePage/>}</div>}/>
            <Route path="/settings/*" element={<ScrollArea storageKey="page_settings"><AdminPage data={data} setData={setData} bizId={currentBizId} serverV={serverV} onLogout={handleLogout} currentUser={currentUser} userBranches={userBranches} setPage={setPage} setPendingOpenCust={setPendingOpenCust}/></ScrollArea>}/>
            <Route path="/wizard" element={<Navigate to="/blissai" replace/>}/>
            <Route path="/requests" element={<ScrollArea storageKey="page_requests"><BlissRequests data={data} currentUser={currentUser} userBranches={userBranches} isMaster={isMaster}/></ScrollArea>}/>
            <Route path="/blissai" element={<div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}><BlissAI data={data} setData={setData} currentUser={currentUser} userBranches={userBranches} isMaster={isMaster} bizId={currentBizId} bizName={bizName}/></div>}/>
            <Route path="*" element={<Navigate to="/timeline" replace/>}/>
          </Routes>
        </div>
        {/* 메인 하단 footer — 사업자정보 + 약관 페이지 (PG 심사용 + 빈 공간 채움) */}
        <footer className="main-footer-d" style={{flexShrink:0,padding:"8px 20px",borderTop:`1px solid ${T.gray200}`,background:T.bgCard,fontSize:11,color:T.textMuted,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <a href="/about.html" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none"}}>회사소개</a>
            <span style={{color:T.gray300}}>·</span>
            <a href="/pricing.html" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none"}}>요금제</a>
            <span style={{color:T.gray300}}>·</span>
            <a href="/terms.html" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none"}}>이용약관</a>
            <span style={{color:T.gray300}}>·</span>
            <a href="/privacy.html" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none",fontWeight:600}}>개인정보처리방침</a>
            <span style={{color:T.gray300}}>·</span>
            <a href="/refund.html" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none"}}>환불정책</a>
            <span style={{color:T.gray300}}>·</span>
            <a href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=6328102070" target="_blank" rel="noopener" style={{color:T.textSub,textDecoration:"none"}}>사업자정보확인</a>
          </div>
          <div style={{color:T.textMuted,fontSize:10,display:"flex",gap:6,flexWrap:"wrap"}}>
            <span>(주)테라포트</span><span>·</span>
            <span>대표 권신영</span><span>·</span>
            <span>632-81-02070</span><span>·</span>
            <span>서울특별시 강남구 논현로 641, 420호</span><span>·</span>
            <span>070-8983-6838</span><span>·</span>
            <span>contact@blissme.ai</span>
          </div>
        </footer>
      </main>
      <MobileBottomNav nav={nav} page={page} setPage={(p)=>{ if(window.innerWidth<=768) setMessagesPanelOpen(false); setPage(p); }} isChatOpen={isChatOpen && (messagesPanelOpen || page === "messages")}/>
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
