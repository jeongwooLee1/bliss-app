import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { toDb, fromDb, _activeBizId } from '../../lib/db'
import { genId, todayStr } from '../../lib/utils'
import { Btn, FLD, Empty, fmt, Spinner } from '../common'
import I from '../common/I'

const uid = genId;
const _mc = (fn) => { if(fn) fn(); };

const sx = {
  genderBadge: (g) => ({
    fontSize:T.fs.nano, fontWeight:T.fw.bolder, borderRadius:T.radius.sm, padding:"1px 4px",
    background: g==="M" ? T.maleLt : T.femaleLt,
    color:      g==="M" ? T.male   : T.female,
  }),
};

function CustModal({ item, onSave, onClose, defBranch, userBranches, branches }) {
  const isNew = !item?.id;
  const [form, setForm] = React.useState(() => item ? {...item, smsConsent: item.smsConsent !== false} : {id:'cust_'+uid(),name:'',phone:'',gender:'',bid:defBranch||'',memo:'',visits:0, joinDate: new Date().toISOString().slice(0,10), smsConsent: true});
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
        <FLD label="가입일">
          <input className="inp" type="date" value={form.joinDate||''} onChange={e=>f('joinDate',e.target.value)}/>
        </FLD>
        <FLD label="문자수신 동의">
          <div style={{display:'flex',gap:8}}>
            {[[true,'동의'],[false,'거부']].map(([v,l])=>(
              <button key={String(v)} onClick={()=>f('smsConsent',v)} style={{flex:1,padding:'6px',border:'1.5px solid',borderRadius:T.radius.md,cursor:'pointer',fontFamily:'inherit',fontSize:T.fs.sm,fontWeight:form.smsConsent===v?T.fw.bolder:T.fw.normal,background:form.smsConsent===v?(v?T.success:T.danger):T.bgCard,color:form.smsConsent===v?T.bgCard:T.gray700,borderColor:form.smsConsent===v?(v?T.success:T.danger):T.border}}>{l}</button>
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

export default CustomersPage
