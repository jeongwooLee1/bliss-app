import React, { useState } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AField, AInp, APageHeader, AListItem, AIBtn } from './AdminUI'
import UsersPage from './UsersPage'
import AdminPlaces from './AdminPlaces'
import AdminWorkers from './AdminWorkers'
import AdminSaleItems from './AdminSaleItems'
import AdminProductItems from './AdminProductItems'
import AdminResSources from './AdminResSources'
import AdminNoti from './AdminNoti'
import AdminAISettings from './AdminAISettings'
import AdminServiceTags from './AdminServiceTags'
import SchedulePage from '../Schedule/SchedulePage'

const uid = genId;

// ═══════════════════════════════════════════
// ADMIN — 마이페이지
// ═══════════════════════════════════════════
function AdminMyPage({ currentUser, onLogout }) {
  const [pw,setPw]=useState({cur:"",nw:"",nw2:""});
  const [msg,setMsg]=useState("");
  const [saving,setSaving]=useState(false);

  const changePw=async()=>{
    if(!pw.cur){setMsg("현재 비밀번호를 입력해주세요");return;}
    if(pw.nw.length<4){setMsg("새 비밀번호는 4자 이상이어야 해요");return;}
    if(pw.nw!==pw.nw2){setMsg("새 비밀번호가 일치하지 않아요");return;}
    if(pw.cur!==(currentUser?.pw||currentUser?.password)){setMsg("현재 비밀번호가 틀렸어요");return;}
    setSaving(true);
    try{await sb.update("app_users",currentUser.id,{password:pw.nw});setMsg("\u2713 비밀번호가 변경됐어요");setPw({cur:"",nw:"",nw2:""});}
    catch(e){setMsg("변경 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const roleLabel={owner:"점주",super:"슈퍼관리자",staff:"스태프"};

  return <div>
    <APageHeader title="마이페이지"/>
    <div className="card" style={{padding:0,marginBottom:16,overflow:"hidden"}}>
      {[["이름",currentUser?.name||"-"],["아이디",currentUser?.loginId||currentUser?.login_id||"-"],["권한",roleLabel[currentUser?.role]||"-"]].map(([k,v],i,arr)=>
        <AListItem key={k} title={k} borderBottom={i<arr.length-1} right={<span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>{v}</span>}/>)}
    </div>
    <div className="card" style={{padding:20,marginBottom:16}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:16,display:"flex",alignItems:"center",gap:7}}>
        <I name="settings" size={14} style={{color:T.primary}}/> 비밀번호 변경
      </div>
      {[["cur","현재 비밀번호"],["nw","새 비밀번호"],["nw2","새 비밀번호 확인"]].map(([k,lv])=>
        <AField key={k} label={lv}>
          <input style={AInp} type="password" value={pw[k]} onChange={e=>setPw(p=>({...p,[k]:e.target.value}))} placeholder={lv}
            onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/>
        </AField>)}
      {msg&&<div style={{fontSize:T.fs.xs,color:msg.startsWith("\u2713")?T.success:T.danger,marginBottom:12,padding:"8px 12px",borderRadius:8,background:msg.startsWith("\u2713")?"#f0faf4":"#fff5f5"}}>{msg}</div>}
      <AIBtn onClick={changePw} saving={saving} disabled={saving} label="변경하기"/>
    </div>
    <div className="card" style={{padding:16}}>
      <button onClick={onLogout} style={{width:"100%",padding:"12px",borderRadius:10,border:"1.5px solid "+T.danger+"44",background:"#fff5f5",color:T.danger,fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <I name="arrowL" size={14}/> 로그아웃
      </button>
    </div>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 직원 근무표
// ═══════════════════════════════════════════
function AdminSchedule({ data, currentUser, isMaster, employees }) {
  return (
    <div style={{width:"100%",height:"calc(100vh - 120px)",borderRadius:12,overflow:"hidden",
      border:"1px solid "+T.border,background:"#fff"}}>
      <SchedulePage employees={employees}/>
    </div>
  );
}

// ═══════════════════════════════════════════
// ADMIN — 브랜드 멤버 관리
// ═══════════════════════════════════════════
function AdminBrandMembers({ data, setData, bizId, currentUser }) {
  const [saving, setSaving] = React.useState(false);
  const [savingPerm, setSavingPerm] = React.useState(false);

  const regBranches = [...(data.branchSettings||data.branches||[])].filter(b=>b.useYn!==false).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const users = (data.users||[]).filter(u=>u.role==="staff");

  const settings = React.useMemo(()=>{
    try { return JSON.parse(data?.businesses?.[0]?.settings || "{}"); } catch { return {}; }
  },[data]);

  const requests = settings.pending_requests || [];
  const pending = requests.filter(r=>r.status==="pending");
  const processed = requests.filter(r=>r.status!=="pending");

  const updateSettings = async (newRequests) => {
    const newSettings = {...settings, pending_requests: newRequests};
    await sb.update("businesses", bizId, {settings: JSON.stringify(newSettings)});
    setData(prev=>({...prev, businesses:(prev.businesses||[]).map(b=>b.id===bizId?{...b,settings:JSON.stringify(newSettings)}:b)}));
  };

  const approve = async (req, permission) => {
    if(!confirm(`${req.requesterName}\uB2D8\uC758 ${req.branchName} \uAC00\uC785 \uC694\uCCAD\uC744 \uC2B9\uC778\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`)) return;
    setSaving(true);
    try {
      const newUserId = "acc_"+uid();
      const allBranchIds = (data.branches||[]).map(b=>b.id);
      await sb.insert("app_users", {
        id: newUserId, business_id: bizId,
        login_id: req.loginId, password: req.password || "1234",
        name: req.requesterName, role: "staff",
        branch_ids: permission==="write" ? JSON.stringify([req.branchId]) : JSON.stringify([]),
        view_branch_ids: JSON.stringify(allBranchIds)
      });
      const newReqs = requests.map(r=>r.id===req.id ? {...r, status:"approved", permission, approvedAt:new Date().toISOString()} : r);
      await updateSettings(newReqs);
    } catch(e) { alert("\uC2B9\uC778 \uC2E4\uD328: "+e.message); }
    setSaving(false);
  };

  const reject = async (req) => {
    if(!confirm(`${req.requesterName}\uB2D8\uC758 \uC694\uCCAD\uC744 \uAC70\uC808\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`)) return;
    setSaving(true);
    try {
      const newReqs = requests.map(r=>r.id===req.id ? {...r, status:"rejected"} : r);
      await updateSettings(newReqs);
    } catch(e) { alert("\uAC70\uC808 \uC2E4\uD328: "+e.message); }
    setSaving(false);
  };

  const getWrite = (user, brId) => {
    try {
      const v = user.branches || user.branch_ids;
      const arr = Array.isArray(v) ? v : JSON.parse(v||"[]");
      return arr.includes(brId);
    } catch { return false; }
  };
  const getRead = (user, brId) => {
    try {
      const v = user.viewBranches || user.view_branch_ids;
      const arr = Array.isArray(v) ? v : JSON.parse(v||"[]");
      return arr.includes(brId);
    } catch { return false; }
  };
  const togglePerm = async (user, brId, type) => {
    setSavingPerm(true);
    try {
      let writeIds = []; let readIds = [];
      try { writeIds = JSON.parse(user.branch_ids||user.branches||"[]"); } catch {}
      try { readIds = JSON.parse(user.view_branch_ids||user.viewBranches||"[]"); } catch {}
      if(type==="write") {
        if(writeIds.includes(brId)) { writeIds=writeIds.filter(id=>id!==brId); }
        else { writeIds=[...writeIds,brId]; if(!readIds.includes(brId)) readIds=[...readIds,brId]; }
      } else {
        if(readIds.includes(brId)) { readIds=readIds.filter(id=>id!==brId); writeIds=writeIds.filter(id=>id!==brId); }
        else { readIds=[...readIds,brId]; }
      }
      await sb.update("app_users", user.id, {branch_ids:JSON.stringify(writeIds), view_branch_ids:JSON.stringify(readIds)});
      setData(prev=>({...prev, users:(prev.users||[]).map(u=>u.id===user.id
        ? {...u, branch_ids:JSON.stringify(writeIds), branches:writeIds, view_branch_ids:JSON.stringify(readIds), viewBranches:readIds}
        : u
      )}));
    } catch(e) { alert("\uC800\uC7A5 \uC2E4\uD328: "+e.message); }
    setSavingPerm(false);
  };

  const thStyle = {padding:"10px 6px",fontSize:10,fontWeight:700,color:T.textMuted,textAlign:"center",whiteSpace:"nowrap",background:T.bg,borderBottom:`1px solid ${T.border}`};
  const tdStyle = {padding:"8px 6px",textAlign:"center",borderBottom:`1px solid ${T.gray100}`,verticalAlign:"middle"};

  return <div>
    <h3 style={{margin:"0 0 20px",fontSize:T.fs.lg,fontWeight:T.fw.black}}>브랜드 멤버 관리</h3>

    {users.length > 0 && <>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:10}}>계정별 지점 접근 권한</div>
      <div style={{overflowX:"auto",marginBottom:8,borderRadius:T.radius.lg,border:`1px solid ${T.border}`,background:T.bgCard}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th style={{...thStyle,textAlign:"left",padding:"10px 12px",minWidth:80,position:"sticky",left:0,background:T.bg,zIndex:1}}>계정</th>
              {regBranches.map(b=>(
                <th key={b.id} style={{...thStyle,minWidth:64}}>
                  <div style={{marginBottom:4}}>{b.short||b.name}</div>
                  <div style={{display:"flex",justifyContent:"center",gap:10}}>
                    <span style={{fontSize:9,color:T.primary}}>쓰기</span>
                    <span style={{fontSize:9,color:T.gray400}}>읽기</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(user=>(
              <tr key={user.id}>
                <td style={{...tdStyle,textAlign:"left",padding:"8px 12px",position:"sticky",left:0,background:"#fff",zIndex:1}}>
                  <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm,color:T.text}}>{user.name||user.loginId}</div>
                  <div style={{fontSize:10,color:T.textMuted}}>{user.loginId||user.login_id}</div>
                </td>
                {regBranches.map(b=>(
                  <td key={b.id} style={tdStyle}>
                    <div style={{display:"flex",justifyContent:"center",gap:10}}>
                      <input type="checkbox" disabled={savingPerm}
                        checked={getWrite(user,b.id)} onChange={()=>togglePerm(user,b.id,"write")}
                        style={{width:15,height:15,accentColor:T.primary,cursor:"pointer"}}/>
                      <input type="checkbox" disabled={savingPerm}
                        checked={getRead(user,b.id)} onChange={()=>togglePerm(user,b.id,"read")}
                        style={{width:15,height:15,accentColor:T.gray400,cursor:"pointer"}}/>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:"flex",gap:16,fontSize:T.fs.xs,color:T.textMuted,marginBottom:28}}>
        <span style={{display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked readOnly style={{accentColor:T.primary,width:12,height:12}}/> 쓰기 \u2014 예약\xB7매출 등록\xB7수정</span>
        <span style={{display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked readOnly style={{accentColor:T.gray400,width:12,height:12}}/> 읽기 \u2014 조회만</span>
      </div>
    </>}

    {pending.length > 0 && <>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:10}}>가입 대기 요청</div>
      {pending.map(req=>(
        <div key={req.id} style={{background:T.bgCard,border:`1.5px solid ${T.orange}`,borderRadius:T.radius.lg,padding:16,marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.primaryHover,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <I name="user" size={18} style={{color:T.primary}}/>
            </div>
            <div>
              <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm}}>{req.requesterName}</div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>아이디: {req.loginId}</div>
            </div>
            <div style={{marginLeft:"auto",fontSize:T.fs.xs,color:T.orange,fontWeight:T.fw.bolder}}>대기중</div>
          </div>
          <div style={{fontSize:T.fs.sm,color:T.textSub,marginBottom:4}}>요청 지점: <b>{req.branchName}</b></div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12}}>{new Date(req.requestedAt).toLocaleDateString("ko-KR")} 요청</div>
          <div style={{display:"flex",gap:8}}>
            <button disabled={saving} onClick={()=>approve(req,"write")} style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>읽기+쓰기 승인</button>
            <button disabled={saving} onClick={()=>approve(req,"read")} style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${T.primary}`,background:"#fff",color:T.primary,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>읽기전용 승인</button>
            <button disabled={saving} onClick={()=>reject(req)} style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${T.danger}`,background:"#fff",color:T.danger,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>거절</button>
          </div>
        </div>
      ))}
    </>}
    {pending.length===0 && users.length===0 && <div style={{textAlign:"center",padding:"40px 0",color:T.textMuted,fontSize:T.fs.sm}}>등록된 멤버가 없어요</div>}

    {processed.length>0 && <>
      <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textMuted,marginTop:16,marginBottom:8}}>처리 완료</div>
      {processed.map(req=>(
        <div key={req.id} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:T.radius.lg,padding:12,marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1}}>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.medium}}>{req.requesterName} <span style={{fontSize:T.fs.xs,color:T.textMuted}}>({req.loginId})</span></div>
            <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{req.branchName}</div>
          </div>
          <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:req.status==="approved"?T.primary:T.danger}}>
            {req.status==="approved"?(req.permission==="write"?"읽기+쓰기":"읽기전용"):"거절됨"}
          </div>
        </div>
      ))}
    </>}
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 브랜드 가입 요청 (스태프용)
// ═══════════════════════════════════════════
function AdminJoinBrand({ currentUser, onBack }) {
  const [brandCode, setBrandCode] = React.useState("");
  const [branchName, setBranchName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState("");

  const SUPA_URL = "https://dpftlrsuqxqqeouwbfjd.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnRscnN1cXhxcWVvdXdiZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MDU4MjQsImV4cCI6MjA4NzQ4MTgyNH0.iydEkjtPjZ0jXpUUPJben4IWWneDqLomv-HDlcFayE4";

  const submit = async () => {
    if(!brandCode.trim()) { setErr("브랜드 코드를 입력해주세요"); return; }
    if(!branchName.trim()) { setErr("내 지점 이름을 입력해주세요"); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/businesses?code=eq.${encodeURIComponent(brandCode.trim())}&select=id,name,settings`,
        {headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});
      const brands = await r.json();
      if(!brands.length) { setErr("존재하지 않는 브랜드 코드예요"); setLoading(false); return; }
      const brand = brands[0];

      let settingsObj = {};
      try { settingsObj = JSON.parse(brand.settings||"{}"); } catch {}
      const pendingReqs = settingsObj.pending_requests || [];
      const already = pendingReqs.find(p=>p.loginId===currentUser?.loginId && p.status==="pending");
      if(already) { setErr("이미 가입 요청이 진행 중이에요"); setLoading(false); return; }

      const brRes = await fetch(`${SUPA_URL}/rest/v1/branches?business_id=eq.${brand.id}&select=id,name,short`,
        {headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});
      const branchList = await brRes.json();
      const matchedBr = branchList.find(b=>(b.name||"").includes(branchName.trim()) || (b.short||"").includes(branchName.trim()));

      const newReq = {
        id: "req_"+Math.random().toString(36).slice(2,10),
        loginId: currentUser?.loginId || currentUser?.login_id || "",
        requesterName: currentUser?.name || "",
        branchName: branchName.trim(),
        branchId: matchedBr?.id || "",
        status: "pending",
        requestedAt: new Date().toISOString()
      };
      const newSettings = {...settingsObj, pending_requests:[...pendingReqs, newReq]};
      await fetch(`${SUPA_URL}/rest/v1/businesses?id=eq.${brand.id}`,{
        method:"PATCH",
        headers:{apikey:ANON,Authorization:`Bearer ${ANON}`,"Content-Type":"application/json","Prefer":"return=minimal"},
        body: JSON.stringify({settings:JSON.stringify(newSettings)})
      });
      setDone(true);
    } catch(e) { setErr("요청 실패: "+e.message); }
    setLoading(false);
  };

  if(done) return <div style={{textAlign:"center",padding:"40px 20px"}}>
    <div style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:T.text,marginBottom:8}}>가입 요청 완료!</div>
    <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:24}}>브랜드 어드민이 승인하면 접근 권한이 부여돼요.</div>
    <button onClick={onBack} style={{padding:"10px 24px",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>확인</button>
  </div>;

  return <div>
    <h3 style={{margin:"0 0 8px",fontSize:T.fs.lg,fontWeight:T.fw.black}}>브랜드 가입 요청</h3>
    <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:24}}>브랜드 코드를 입력하면 해당 브랜드 어드민에게 가입 요청이 전달돼요.</div>
    <div style={{marginBottom:14}}>
      <label style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.gray600,display:"block",marginBottom:6}}>브랜드 코드</label>
      <input value={brandCode} onChange={e=>setBrandCode(e.target.value)} placeholder="예: housewaxing"
        style={{width:"100%",padding:"11px 13px",borderRadius:T.radius.lg,border:`1px solid ${T.border}`,fontSize:T.fs.md,fontFamily:"inherit",color:T.text,outline:"none",boxSizing:"border-box"}}/>
    </div>
    <div style={{marginBottom:20}}>
      <label style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.gray600,display:"block",marginBottom:6}}>내 지점 이름</label>
      <input value={branchName} onChange={e=>setBranchName(e.target.value)} placeholder="예: 강남점"
        style={{width:"100%",padding:"11px 13px",borderRadius:T.radius.lg,border:`1px solid ${T.border}`,fontSize:T.fs.md,fontFamily:"inherit",color:T.text,outline:"none",boxSizing:"border-box"}}/>
    </div>
    {err && <div style={{fontSize:T.fs.sm,color:T.danger,marginBottom:12}}>{err}</div>}
    <button disabled={loading} onClick={submit}
      style={{width:"100%",padding:13,borderRadius:T.radius.lg,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.md,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>
      {loading?"요청 중...":"가입 요청 보내기"}
    </button>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 메뉴 홈 + 라우터
// ═══════════════════════════════════════════
function AdminPage({ data, setData, bizId, serverV, onLogout, currentUser }) {
  const [tab,setTabRaw]=useState(()=>{try{return sessionStorage.getItem("bliss_adminTab")||null;}catch(e){return null;}});
  const setTab=t=>{setTabRaw(t);try{sessionStorage.setItem("bliss_adminTab",t||"");}catch(e){}};
  const back=()=>setTab(null);

  const settings = React.useMemo(()=>{
    try { return JSON.parse(data?.businesses?.[0]?.settings || data?.businessSettings?.[0]?.settings || "{}"); } catch { return {}; }
  },[data]);
  const pendingRequests = (settings.pending_requests || []).filter(r=>r.status==="pending");
  const pendingCount = pendingRequests.length;
  const isMaster = currentUser?.role === "owner" || currentUser?.role === "super" || currentUser?.role === "manager";

  const MENU=[
    ...(isMaster ? [{section:"사업장 관리",items:[
      {key:"places",      icon:"building", label:"예약장소 관리",  desc:"지점 추가·수정·삭제"},
      {key:"workers",     icon:"users",    label:"담당자 관리",    desc:"직원 계정 및 권한 설정"},
      {key:"saleitems",   icon:"scissors", label:"시술 상품 관리", desc:"시술 항목 및 가격 설정"},
      {key:"prodmgmt",    icon:"clipboard",label:"제품 관리",      desc:"판매 제품 관리"},
      {key:"brandmembers", icon:"userPlus", label:"브랜드 멤버 관리", desc:"지점 가입 요청 승인/거절", badge:pendingCount},
      {key:"schedule",     icon:"calendar", label:"직원 근무표",      desc:"직원 월별 근무 자동 배정"},
    ]}] : []),
    ...(isMaster ? [{section:"예약 설정",items:[
      {key:"svctags",     icon:"tag",      label:"태그 관리",      desc:"예약 태그 추가·편집"},
      {key:"ressrc",      icon:"zap",      label:"예약경로 관리",  desc:"예약 유입 경로 설정"},
    ]}] : []),
    ...(isMaster ? [{section:"알림 & AI",items:[
      {key:"notiSettings",icon:"bell",     label:"알림톡 설정",    desc:"카카오 알림톡 자동 발송 설정"},
      {key:"messages",    icon:"chat",    label:"받은메시지함",   desc:"네이버톡톡 고객 메시지 관리"},
      {key:"aisettings",  icon:"sparkles", label:"AI 설정",        desc:"AI 분석 키 및 규칙 관리"},
    ]}] : []),
    {section:"내 계정",items:[
      {key:"mypage",      icon:"user",     label:"마이페이지",     desc:"내 계정 정보 및 비밀번호 변경"},
      ...(!isMaster ? [{key:"joinbrand", icon:"link", label:"브랜드 가입 요청", desc:"브랜드 코드로 가입 요청"}] : []),
    ]},
  ];

  if(!tab) return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
      <h2 style={{margin:0,fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text,letterSpacing:"-.5px"}}>메뉴</h2>
      <button onClick={onLogout} style={{height:32,padding:"0 12px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:T.fs.sm,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="arrowL" size={13}/> 로그아웃
      </button>
    </div>
    {MENU.map(g=><div key={g.section} style={{marginBottom:24}}>
      <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:8,paddingLeft:2,letterSpacing:.3}}>{g.section}</div>
      <div style={{background:T.bgCard,borderRadius:T.radius.lg,overflow:"hidden",boxShadow:T.shadow.sm}}>
        {g.items.map((item,idx)=><AListItem key={item.key}
          left={<div style={{width:36,height:36,borderRadius:10,background:item.badge>0?"rgba(255,80,80,.1)":T.primaryHover,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
            <I name={item.icon} size={17} style={{color:item.badge>0?T.danger:T.primary}}/>
            {item.badge>0&&<span style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:T.danger,color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{item.badge}</span>}
          </div>}
          title={item.label} sub={item.desc}
          right={<I name="chevR" size={15} style={{color:T.gray300}}/>}
          onClick={()=>setTab(item.key)}
          borderBottom={idx<g.items.length-1}/>)}
      </div>
    </div>)}
  </div>;

  const BackBtn=()=><button onClick={back} style={{display:"inline-flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,fontFamily:"inherit",marginBottom:tab==="schedule"?0:20,padding:0}}>
    <I name="arrowL" size={14}/> 메뉴
  </button>;

  return <div>
    <BackBtn/>
    {tab==="places"       && isMaster &&<AdminPlaces       data={data} setData={setData} bizId={bizId}/>}
    {tab==="workers"      && isMaster &&<AdminWorkers      data={data} setData={setData}/>}
    {tab==="saleitems"    && isMaster &&<AdminSaleItems    data={data} setData={setData}/>}
    {tab==="prodmgmt"     && isMaster &&<AdminProductItems data={data} setData={setData}/>}
    {tab==="svctags"      && isMaster &&<AdminServiceTags  data={data} setData={setData}/>}
    {tab==="ressrc"       && isMaster &&<AdminResSources   data={data} setData={setData}/>}
    {tab==="notiSettings" && isMaster &&<AdminNoti         data={data} setData={setData} sb={sb} bizId={bizId} branches={data?.branches||[]}/>}
    {tab==="aisettings"   && isMaster &&<AdminAISettings   data={data} sb={sb} bizId={bizId}/>}
    {tab==="brandmembers" && isMaster &&<AdminBrandMembers data={data} setData={setData} bizId={bizId} currentUser={currentUser}/>}
    {tab==="mypage"       &&<AdminMyPage       currentUser={currentUser} onLogout={onLogout}/>}
    {tab==="schedule"    && isMaster &&<AdminSchedule currentUser={currentUser} isMaster={isMaster}/>}
    {tab==="joinbrand"    && !isMaster &&<AdminJoinBrand   currentUser={currentUser} onBack={back}/>}
    {tab && !["mypage","schedule"].includes(tab) && !isMaster && <div style={{textAlign:"center",padding:"60px 20px",color:T.textMuted}}>
      <div style={{fontSize:32,marginBottom:12}}>&#128274;</div>
      <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text,marginBottom:8}}>접근 권한이 없어요</div>
      <div style={{fontSize:T.fs.sm}}>브랜드 어드민에게 문의해주세요</div>
    </div>}
  </div>;
}

export { UsersPage }
export default AdminPage
