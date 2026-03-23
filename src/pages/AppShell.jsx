import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, BRANCH_DEFAULT_COLORS, branchColor, STATUS_LABEL } from '../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../lib/sb'
import { fromDb, toDb, resolveSystemIds, setActiveBiz } from '../lib/db'
import { todayStr, pad, fmtDate, getDow, genId } from '../lib/utils'
import I from '../components/common/I'
import TimelineModal from '../components/Timeline/ReservationModal'
import SchedulePage from '../components/Schedule/SchedulePage'
import AdminPage from '../components/Admin/AdminPage'

const BLISS_V = "bliss-app"
const BIZ_ID = 'biz_khvurgshb'

function Spinner({size=20}) {
  return <div style={{width:size,height:size,border:`2px solid ${T.primaryLt}`,borderTop:`2px solid ${T.primary}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}></div>;
}
function Loading({msg}) {
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100dvh",gap:12,color:T.textSub,fontSize:T.fs.md}}>
    <Spinner size={28}/>
    <div>{msg||"로딩 중..."}</div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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

function DataTable({ cols=[], rows=[], onRow }) {
  return <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
    <thead><tr>{cols.map(c=><th key={c.key} style={{padding:"6px 10px",background:"#f5f5f5",borderBottom:"1px solid #eee",textAlign:"left",fontWeight:600}}>{c.label}</th>)}</tr></thead>
    <tbody>{(rows||[]).map((r,i)=><tr key={i} onClick={()=>onRow&&onRow(r)} style={{cursor:onRow?"pointer":"default",borderBottom:"1px solid #f0f0f0"}}>{cols.map(c=><td key={c.key} style={{padding:"6px 10px"}}>{r[c.key]}</td>)}</tr>)}</tbody>
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
    sb.getByBiz("customers", bizId).catch(()=>[]),
    sb.get("reservations", `&business_id=eq.${bizId}&order=date.desc,time.asc&limit=3000`).catch(()=>[]),
    sb.getByBiz("sales", bizId).catch(()=>[]),
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
    const biz = isNew ? { ...bizForm, id: "biz_" + uid() } : bizForm;
    if (isNew) {
      await sb.insert("businesses", { id:biz.id, name:biz.name, code:biz.code, phone:biz.phone||"", settings:biz.settings||"" });
      const ownerId = "acc_" + uid();
      await sb.insert("app_users", { id:ownerId, business_id:biz.id, login_id:biz.code, password:"1234", name:biz.name+" 대표", role:"owner", branch_ids:"[]", view_branch_ids:"[]" });
      // Auto-assign group if selected
      if (bizForm.groupId) {
        const gm = { id:"gm_"+uid(), group_id:bizForm.groupId, business_id:biz.id };
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
        const gm = { id:"gm_"+uid(), group_id:bizForm.groupId, business_id:biz.id };
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
    const grp = { id:"grp_"+uid(), name:newGrp.trim(), memo:"" };
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
function SalesPage(p) { return <div style={{padding:20,color:'#666'}}>매출 페이지 준비 중</div>; }
function StatsPage(p) { return <div style={{padding:20,color:'#666'}}>통계 페이지 준비 중</div>; }
function CustomersPage(p) { return <div style={{padding:20,color:'#666'}}>고객 페이지 준비 중</div>; }
function UsersPage(p) { return <div style={{padding:20,color:'#666'}}>계정 관리 페이지 준비 중</div>; }

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
    const load = () => {
      // userBranches 아직 안 로드됐으면 스킵 (isMaster는 전체 허용)
      if(accIds.length===0 && !isMaster && userBranches !== null) { setUnreadMsgCount(0); return; }
      let url = SB_URL+"/rest/v1/naver_messages?is_read=eq.false&direction=eq.in&select=id&limit=999";
      if(accIds.length>0) url += "&account_id=in.("+accIds.join(",")+")";
      fetch(url,{headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY}})
        .then(r=>r.json())
        .then(arr=>{ if(Array.isArray(arr)) setUnreadMsgCount(arr.length); })
        .catch(()=>{});
    };
    load();
    // Realtime: INSERT/UPDATE 시 지점 필터 후 재카운트
    const rt = window._sbClient?.channel("unread_badge")
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"naver_messages"},
        p=>{ if(p?.new?.direction==="in"&&!p?.new?.is_read&&(accIds.length===0||accIds.includes(p.new.account_id))) load(); }
      )
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"naver_messages"},
        p=>{ if(p?.new?.is_read===true&&(accIds.length===0||accIds.includes(p.new.account_id))) load(); }
      )?.subscribe();
    return ()=>{ try{rt?.unsubscribe();}catch(e){} };
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
          // 서버가 1시간 이상 응답 없거나 DEAD면 세션 죽은 것
          const isSessionDead = scraper.includes("DEAD") || scraper.includes("error") || diffH > 1;
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
          const rows = await sb.getByBiz("reservations", currentBizId);
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

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
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
        <div className="mob-hdr" style={{...S.mobHdr,position:"relative",...{display:"none"}}}>
          {pageHistory.length > 0
            ? <button onClick={()=>{
                setPageHistory(h=>{
                  const prev=h[h.length-1];
                  setPageRaw(prev);
                  try{sessionStorage.setItem("bliss_page",prev);}catch(e){}
                  return h.slice(0,-1);
                });
              }} style={{...S.menuBtn,display:"flex",alignItems:"center",gap:2,color:T.primary,fontWeight:T.fw.bolder}}>
                <I name="chevron-left" size={22}/><span style={{fontSize:T.fs.md}}>뒤로</span>
              </button>
            : <span/>
          }
          {bizName && <span style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:T.primary,position:"absolute",left:"50%",transform:"translateX(-50%)"}}>{bizName}</span>}
          <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.danger}}>앱 v{BLISS_V}</span>
            <span style={{fontSize:T.fs.nano,fontWeight:T.fw.medium,color:serverV?"#03C75A":T.textMuted}}>
              서버 {serverV?`v${serverV}`:"연결중…"}
            </span>
          </div>
        </div>
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
      <div style={{position:"fixed",bottom:"calc(56px + env(safe-area-inset-bottom) + 2px)",left:0,right:0,height:16,display:isChatOpen?"none":"flex",alignItems:"center",justifyContent:"center",gap:6,zIndex:199,pointerEvents:"none"}}>
        <span style={{fontSize:9,color:T.danger,fontWeight:800,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff"}}>v{BLISS_V}</span>
        <span style={{fontSize:9,color:serverV?"#03C75A":T.textMuted,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff"}}>서버 {serverV?`v${serverV}`:"…"}</span>
        {scraperStatus && <span style={{fontSize:9,opacity:.85,textShadow:"0 0 4px #fff,0 0 4px #fff",color:scraperStatus.isWarning?"#E65100":T.textMuted,fontWeight:scraperStatus.isWarning?800:400}}>{scraperStatus.isWarning?"⚠️":"✅"}{scraperStatus.lastScraped?(()=>{const h=Math.floor(scraperStatus.scrapedDiffH);const m=Math.floor((scraperStatus.scrapedDiffH%1)*60);return h>0?`${h}h${m>0?` ${m}m`:""} 전`:`${m}m 전`;})():"스크래핑 기록없음"}</span>}
      </div>
      <MobileBottomNav nav={nav} page={page} setPage={setPage} isChatOpen={isChatOpen}/>
    </div>
  );
}

function MobileBottomNav({ nav, page, setPage, isChatOpen=false }) {
  if(isChatOpen) return null;
  const items = [
    ...(nav.find(n=>n.id==="timeline")    ? [{id:"timeline",   label:"타임라인", icon:"calendar"}]  : []),
    ...(nav.find(n=>n.id==="reservations")? [{id:"reservations",label:"예약목록",  icon:"clipboard"}] : []),
    ...(nav.find(n=>n.id==="messages")    ? [{id:"messages",   label:"메시지함",  icon:"msgSq", badge: nav.find(n=>n.id==="messages")?.badge||0}] : []),
    ...(nav.find(n=>n.id==="customers")   ? [{id:"customers",  label:"고객관리",  icon:"users"}]     : []),
    ...(nav.find(n=>n.id==="admin")       ? [{id:"admin",      label:"메뉴",       icon:"settings"}]  : []),
  ];
  return (
    <nav className="mob-bottom-nav" style={{position:"fixed",bottom:0,left:0,right:0,background:T.bgCard,borderTop:`1px solid ${T.border}`,zIndex:100,display:"flex",alignItems:"flex-start",paddingTop:8,paddingBottom:"env(safe-area-inset-bottom)"}}>
      {items.map(item=>{
        const active = page===item.id;
        return (
          <button key={item.id} onClick={()=>setPage(item.id)} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",gap:4,flex:1,paddingTop:0,border:"none",background:"none",cursor:"pointer",fontFamily:"inherit",color:active?T.primary:T.textMuted,transition:"color .15s"}}>
            <div style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
              <I name={item.icon} size={22} style={{strokeWidth: active ? 2.5 : 1.8}}/>
              {item.badge>0 && page!==item.id && <span style={{position:"absolute",top:-4,right:-6,background:T.danger,color:"#fff",borderRadius:8,fontSize:9,fontWeight:700,padding:"1px 4px",minWidth:14,textAlign:"center"}}>{item.badge>99?"99+":item.badge}</span>}
            </div>
            <span style={{fontSize:10,fontWeight:active?T.fw.bolder:T.fw.medium,letterSpacing:-0.2}}>{item.label}</span>
          </button>
        );
      })}
    </nav>
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
