import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, queueAlimtalk } from '../../lib/sb'
import { toDb, fromDb, _activeBizId } from '../../lib/db'
import { genId, todayStr } from '../../lib/utils'
import { Btn, FLD, Empty, fmt, Spinner, DataTable } from '../common'
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

function CustModal({ item, isEdit, onSave, onClose, defBranch, userBranches, branches, memoTemplate }) {
  const isNew = !isEdit;
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
        <FLD label="이름"><input className="inp" value={form.name} onChange={e=>f('name',e.target.value)} placeholder="회원명"/></FLD>
        <FLD label="이름 2 (선택)"><input className="inp" value={form.name2||''} onChange={e=>f('name2',e.target.value)} placeholder="회원명2 (오라클 NAME2)"/></FLD>
        <FLD label="연락처"><input className="inp" value={form.phone} onChange={e=>f('phone',e.target.value)} placeholder="01012345678"/></FLD>
        <FLD label="연락처 2 (선택)"><input className="inp" value={form.phone2||''} onChange={e=>f('phone2',e.target.value)} placeholder="두 번째 연락처 (동일 고객 병합용)"/></FLD>
        <FLD label="이메일"><input className="inp" type="email" value={form.email||''} onChange={e=>f('email',e.target.value)} placeholder="example@email.com"/></FLD>
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
        <FLD label="메모"><textarea className="inp" rows={3} value={form.memo||''} onChange={e=>f('memo',e.target.value)} placeholder="메모"
          ref={el=>{if(el){el.style.height="auto";el.style.height=Math.max(60,el.scrollHeight)+"px";}}}
          style={{resize:"vertical",minHeight:60,lineHeight:1.6}}/></FLD>
      </div>
      <div style={{display:'flex',gap:10,marginTop:20}}>
        <Btn variant="secondary" style={{flex:1}} onClick={onClose}>취소</Btn>
        <Btn variant="primary" style={{flex:2}} onClick={()=>{ if(!form.name.trim()) return alert('이름을 입력하세요'); onSave(form, isEdit); }}>저장</Btn>
      </div>
    </div>
  </div>;
}

function CustomersPage({ data, setData, userBranches, isMaster, pendingOpenCust, setPendingOpenCust }) {
  const [q, setQ] = useState("");
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailCust, setDetailCust] = useState(null);
  const [detailTab, setDetailTab] = useState("pkg"); // "pkg" | "sales"
  // showHidden 제거 — 숨김 기능 미사용

  // ── 서버 페이지네이션 (무한 스크롤) ──
  const PAGE_SIZE = 50;
  const [pagedCusts, setPagedCusts] = useState([]); // 누적
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searching, setSearching] = useState(false); // 검색중 표시
  const [pkgByCust, setPkgByCust] = useState({}); // {cust_id: [pkg,...]} 페이지 단위 lazy 로드
  const totalCountRef = useRef(0);
  const scrollRef = useRef(null);
  // pendingOpenCust가 있으면 단일 고객 모드 — 리스트 로드 완전 차단
  const lockSingleRef = useRef(!!pendingOpenCust);
  const [singleMode, setSingleMode] = useState(!!pendingOpenCust);

  // 필터(검색/매장/숨김)가 바뀌면 처음부터 다시 로드
  const buildFilter = (offset, limit) => {
    const bizId = _activeBizId;
    let parts = [`business_id=eq.${bizId}`];
    // 매장 필터
    if (vb !== "all") parts.push(`bid=eq.${vb}`);
    else if (userBranches.length > 0) parts.push(`bid=in.(${userBranches.join(",")})`);
    // 숨김 필터 제거 — 전부 표시
    // 검색: 첫 토큰만 서버에서 OR ilike
    const tokens = (q||"").trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const enc = encodeURIComponent(tokens[0]);
      parts.push(`or=(name.ilike.*${enc}*,name2.ilike.*${enc}*,phone.ilike.*${enc}*,phone2.ilike.*${enc}*,email.ilike.*${enc}*,memo.ilike.*${enc}*,cust_num.ilike.*${enc}*)`);
    }
    // 정렬: 오라클 등록일(join_date = 실제 가입 일시) 최신순 → 없으면 createdAt
    // cust_num은 text라 문자열 정렬되므로 사용 불가. JOINDATE가 오라클 등록 타임스탬프와 동일.
    parts.push(`order=join_date.desc.nullslast,created_at.desc.nullslast`);
    parts.push(`offset=${offset}`);
    parts.push(`limit=${limit}`);
    return "&" + parts.join("&");
  };

  // 다단어 부분검색 매처 (서버 첫 토큰 이후 클라이언트 AND 필터용)
  const matchesQuery = (c, query) => {
    if (!query) return true;
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return true; // 첫 토큰은 서버에서 이미 필터됨
    const haystack = [c.name, c.name2, c.phone, c.phone2, c.email, c.memo, c.custNum, c.custNum2].filter(Boolean).join(" ").toLowerCase();
    return tokens.slice(1).every(t => haystack.includes(t.toLowerCase()));
  };

  const fetchPage = async (offset, reset=false) => {
    if (loading) return;
    setLoading(true);
    if (reset) setSearching(true);
    try {
      const filter = buildFilter(offset, PAGE_SIZE);
      const rows = await sb.get("customers", filter);
      const mapped = fromDb("customers", rows).filter(c => matchesQuery(c, q));
      setPagedCusts(prev => reset ? mapped : [...prev, ...mapped]);
      setHasMore(rows.length === PAGE_SIZE);
      if (reset && scrollRef.current) scrollRef.current.scrollTop = 0;
      // 이 페이지 고객들의 보유권 batch 로드
      const ids = mapped.map(c => c.id).filter(Boolean);
      if (ids.length > 0) {
        try {
          const pkgRows = await sb.get("customer_packages", `&customer_id=in.(${ids.join(",")})`);
          const map = {};
          (pkgRows||[]).forEach(p => {
            (map[p.customer_id] = map[p.customer_id] || []).push(p);
          });
          setPkgByCust(prev => reset ? map : {...prev, ...map});
        } catch(e) { console.error("pkg batch load failed:", e); }
      } else if (reset) {
        setPkgByCust({});
      }
    } catch(e) {
      console.error("Customer page fetch failed:", e);
      if (reset) setPagedCusts([]);
      setHasMore(false);
    }
    setLoading(false);
    setSearching(false);
  };

  // q/vb/showHidden 변경 시 디바운스 리로드 — pendingOpenCust 처리 중이거나 단일 고객 락 상태면 스킵
  useEffect(() => {
    if (pendingOpenCust) return;
    if (lockSingleRef.current) return;
    const timer = setTimeout(() => { fetchPage(0, true); }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, vb, pendingOpenCust]);

  // 스크롤 핸들러: 하단 근접 시 다음 페이지 로드
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasMore && !loading) {
      fetchPage(pagedCusts.length, false);
    }
  };

  const custs = pagedCusts;

  // 보유권 요약: 유효 다회권(남은회차>0) + 다담권(잔액>0), 만료 여부 표시
  const pkgSummaryForCust = (cid) => {
    const arr = pkgByCust[cid] || [];
    const out = [];
    const today = todayStr();
    arr.forEach(p => {
      const n = (p.service_name||"");
      const nl = n.toLowerCase();
      const isPrepaid = n.includes("다담권") || n.includes("선불") || nl.includes("10%추가적립");
      const isAnnual  = n.includes("연간") || n.includes("할인권") || n.includes("회원권");
      // 유효기간 체크
      const expiryMatch = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
      const expiry = expiryMatch ? expiryMatch[1] : null;
      const isExpired = expiry && expiry < today;
      if (isAnnual) {
        if (!isExpired) out.push({type:"annual", label:`📋 연간`, expired: false});
        return;
      }
      if (isPrepaid) {
        const m = (p.note||"").match(/잔액:([0-9,]+)/);
        const bal = m ? Number(m[1].replace(/,/g,"")) : 0;
        if (bal > 0 && !isExpired) out.push({type:"prepaid", label:`🎫 ${bal.toLocaleString()}`, expired: false});
      } else {
        const remain = (p.total_count||0) - (p.used_count||0);
        if (remain > 0 && !isExpired) {
          const shortName = (n.split("(")[0]||"다회").replace(/\s*5회$/,"").trim();
          out.push({type:"package", label:`🎟 ${shortName} +${remain}`, expired: false});
        }
      }
    });
    return out;
  };

  const handleSave = (item, isEdit) => {
    const normalized = {...item, phone: (item.phone || "").replace(/[^0-9]/g, "")};
    if (isEdit) {
      // id 제외한 필드만 PATCH
      const {id, ...rest} = toDb("customers", normalized);
      sb.update("customers", normalized.id, rest).catch(console.error);
    } else {
      sb.insert("customers", toDb("customers", normalized)).catch(console.error);
    }
    setData(prev => {
      const inLocal = (prev?.customers||[]).some(c=>c.id===normalized.id);
      if (inLocal) return {...prev, customers: prev.customers.map(c=>c.id===normalized.id?normalized:c)};
      return {...prev, customers: [...(prev?.customers||[]), normalized]};
    });
    // pagedCusts(실제 리스트)도 즉시 반영
    setPagedCusts(prev => {
      const inList = prev.some(c=>c.id===normalized.id);
      if (inList) return prev.map(c=>c.id===normalized.id?normalized:c);
      return [normalized, ...prev];
    });
    setShowModal(false); setEditItem(null);
  };

  const [custSales, setCustSales] = useState([]);
  const [custPkgsServer, setCustPkgsServer] = useState([]);
  const [pkgEditId, setPkgEditId] = useState(null);
  const [custResStats, setCustResStats] = useState({total:0,noshow:0,sameday:0});
  const [custPointTx, setCustPointTx] = useState([]);
  const [pkgHistoryMap, setPkgHistoryMap] = useState({}); // {pkgId: txArray}
  const [pkgHistoryOpen, setPkgHistoryOpen] = useState(null); // opened pkg id
  const loadPkgHistory = (pkgId) => {
    if (pkgHistoryMap[pkgId]) return;
    sb.get("package_transactions", `&package_id=eq.${pkgId}&order=created_at.desc&limit=200`)
      .then(rows => setPkgHistoryMap(prev => ({...prev, [pkgId]: rows||[]})))
      .catch(() => setPkgHistoryMap(prev => ({...prev, [pkgId]: []})));
  };
  const recordPkgTx = (pkg, txType, amount, unit, balBefore, balAfter, note) => {
    const tx = {
      id: "pkgtx_"+genId(),
      business_id: _activeBizId,
      bid: detailCust?.bid,
      package_id: pkg.id,
      customer_id: pkg.customer_id,
      service_name: pkg.service_name || "",
      type: txType, unit, amount,
      balance_before: balBefore, balance_after: balAfter,
      note: note || null,
      created_at: new Date().toISOString()
    };
    sb.insert("package_transactions", tx).catch(console.error);
    setPkgHistoryMap(prev => ({...prev, [pkg.id]: [tx, ...(prev[pkg.id]||[])]}));
  };
  const [loadingDetail, setLoadingDetail] = useState(false);
  const custPointBalance = custPointTx.reduce((sum, t) => {
    if (t.type === "earn" || t.type === "adjust_add") return sum + (t.amount||0);
    if (t.type === "deduct" || t.type === "adjust_sub") return sum - (t.amount||0);
    return sum;
  }, 0);
  const loadCustPoints = (cid) => {
    if (!cid) { setCustPointTx([]); return Promise.resolve(); }
    return sb.get("point_transactions", `&customer_id=eq.${cid}&order=created_at.desc&limit=200`)
      .then(rows => setCustPointTx(rows||[]))
      .catch(() => setCustPointTx([]));
  };
  useEffect(() => {
    if (!detailCust) { setCustSales([]); setCustPkgsServer([]); setCustResStats({total:0,noshow:0,sameday:0}); setCustPointTx([]); setLoadingDetail(false); return; }
    setLoadingDetail(true);
    Promise.all([
      sb.get("sales", `&cust_id=eq.${detailCust.id}&order=date.desc&limit=500`)
        .then(rows => setCustSales(fromDb("sales", rows)))
        .catch(() => setCustSales([])),
      sb.get("customer_packages", `&customer_id=eq.${detailCust.id}`)
        .then(rows => setCustPkgsServer(rows))
        .catch(() => setCustPkgsServer([])),
      sb.get("reservations", `&cust_id=eq.${detailCust.id}&select=status,date&limit=2000`)
        .then(rows => {
          const today = new Date().toISOString().slice(0,10);
          setCustResStats({
            total: rows.filter(r=>["confirmed","completed","no_show"].includes(r.status)).length,
            noshow: rows.filter(r=>r.status==="no_show").length,
            sameday: rows.filter(r=>["cancelled","naver_cancelled"].includes(r.status)&&r.date===today).length
          });
        })
        .catch(() => setCustResStats({total:0,noshow:0,sameday:0})),
      loadCustPoints(detailCust.id)
    ]).finally(() => setLoadingDetail(false));
  }, [detailCust?.id]);

  // 외부(예약모달)에서 특정 고객 자동 오픈 요청 — id로 서버 직접 조회 → 단일 고객 모드
  useEffect(() => {
    if (!pendingOpenCust) return;
    lockSingleRef.current = true;
    setSingleMode(true);
    (async () => {
      try {
        const rows = await sb.get("customers", `&id=eq.${pendingOpenCust}&limit=1`);
        const found = fromDb("customers", rows)[0];
        if (!found) {
          alert("고객 정보를 찾을 수 없습니다");
          lockSingleRef.current = false;
          setSingleMode(false);
          if (setPendingOpenCust) setPendingOpenCust(null);
          return;
        }
        setPagedCusts([found]);
        setHasMore(false);
        setDetailCust(found);
        setDetailTab("sales");
        try {
          const pkgRows = await sb.get("customer_packages", `&customer_id=eq.${found.id}`);
          setPkgByCust(prev => ({...prev, [found.id]: pkgRows||[]}));
        } catch(_) {}
      } catch(e) {
        console.error("pendingOpenCust fetch failed:", e);
        lockSingleRef.current = false;
        setSingleMode(false);
      } finally {
        if (setPendingOpenCust) setPendingOpenCust(null);
      }
    })();
  }, [pendingOpenCust]);

  // 단일 고객 모드 해제: 전체 목록 버튼 / 검색어 입력 / 매장 변경 시
  const unlockSingleAndReload = () => {
    if (lockSingleRef.current) {
      lockSingleRef.current = false;
      setSingleMode(false);
      setDetailCust(null);
      fetchPage(0, true);
    }
  };
  const custPkgs = custPkgsServer;
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
    const isDone = isPrepaid ? (balance <= 0 || isExpired) : isAnnual ? isExpired : (remain <= 0 || isExpired);

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

      {/* 편집 모드 */}
      {pkgEditId === p.id && <div style={{borderTop:"1px solid "+T.border,paddingTop:8,marginBottom:6}}>
        <div style={{fontSize:10,color:T.textMuted,marginBottom:2}}>패키지 종류</div>
        <select defaultValue={p.service_name} id={`pkg-edit-name-${p.id}`}
          style={{width:"100%",fontSize:11,padding:"5px 6px",borderRadius:6,border:"1px solid "+T.border,marginBottom:6,boxSizing:"border-box"}}>
          {(data?.services||[]).filter(s=>s.name?.includes("PKG")||s.name?.includes("다담")||s.name?.includes("연간")||s.name?.includes("패키지")||s.name?.includes("산모")||s.name?.includes("회원권")).map(s=>
            <option key={s.id} value={s.name}>{s.name} ({s.price_f?.toLocaleString()}원)</option>
          )}
          {!(data?.services||[]).some(s=>s.name===p.service_name) && <option value={p.service_name}>{p.service_name} (현재)</option>}
        </select>
        <div style={{display:"flex",gap:8,marginBottom:6}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:T.textMuted,marginBottom:2}}>{isPrepaid?"충전액":"총 횟수"}</div>
            <input type="number" defaultValue={p.total_count} id={`pkg-edit-total-${p.id}`}
              style={{width:"100%",fontSize:12,padding:"5px 6px",borderRadius:6,border:"1px solid "+T.border,boxSizing:"border-box"}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:T.textMuted,marginBottom:2}}>{isPrepaid?"사용액":"사용 횟수"}</div>
            <input type="number" defaultValue={p.used_count} id={`pkg-edit-used-${p.id}`}
              style={{width:"100%",fontSize:12,padding:"5px 6px",borderRadius:6,border:"1px solid "+T.border,boxSizing:"border-box"}}/>
          </div>
        </div>
        <div style={{display:"flex",gap:4}}>
          <Btn variant="primary" size="sm" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>{
            const newName = document.getElementById(`pkg-edit-name-${p.id}`)?.value || p.service_name;
            const newTotal = Number(document.getElementById(`pkg-edit-total-${p.id}`)?.value || p.total_count);
            const newUsed = Number(document.getElementById(`pkg-edit-used-${p.id}`)?.value || p.used_count);
            const updates = {service_name: newName, total_count: newTotal, used_count: newUsed};
            if(isPrepaid) {
              const newBal = newTotal - newUsed;
              updates.note = (p.note||"").includes("잔액:")
                ? (p.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
                : `잔액:${newBal.toLocaleString()}`;
            }
            sb.update("customer_packages",p.id,updates).catch(console.error);
            setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x,...updates}:x));
            setPkgEditId(null);
          }}>저장</Btn>
          <Btn variant="outline" size="sm" style={{fontSize:11}} onClick={()=>setPkgEditId(null)}>취소</Btn>
        </div>
      </div>}

      {/* 액션 버튼 */}
      <div style={{display:"flex",gap:T.sp.xs}}>
        {/* 다회권: 1회 사용 */}
        {!isPrepaid && !isAnnual && <Btn variant="primary" size="sm" style={{flex:1,justifyContent:"center",fontSize:T.fs.nano}} onClick={()=>{
          // 같은 이름 PKG 중 유효기간 있는 것부터 차감
          const sameName = custPkgsServer.filter(x => x.service_name === p.service_name && (x.total_count-x.used_count) > 0);
          const withExpiry = sameName.filter(x => (x.note||"").match(/유효:\d{4}-\d{2}-\d{2}/)).sort((a,b) => {
            const ea = ((a.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
            const eb = ((b.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
            return ea.localeCompare(eb); // 유효기간 빠른 것부터
          });
          const withoutExpiry = sameName.filter(x => !(x.note||"").match(/유효:\d{4}-\d{2}-\d{2}/));
          const target = withExpiry[0] || withoutExpiry[0] || p;
          const tRemain = (target.total_count||0) - (target.used_count||0);
          if(tRemain <= 0) return alert("잔여 횟수가 없습니다");
          const up = {...target, used_count:target.used_count+1};
          const dbUpdate = {used_count:up.used_count};
          // 첫 사용 시 유효기간 자동 설정 (1년)
          const tExpiry = ((target.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1];
          if(!tExpiry && target.used_count===0) {
            const d=new Date(); d.setFullYear(d.getFullYear()+1);
            const exp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            const newNote = (target.note||"") ? (target.note+" | 유효:"+exp) : "유효:"+exp;
            dbUpdate.note = newNote;
            up.note = newNote;
          }
          sb.update("customer_packages",target.id,dbUpdate).catch(console.error);
          setCustPkgsServer(prev=>prev.map(x=>x.id===target.id?up:x));
          // 히스토리 기록 — 1회 수동 차감
          recordPkgTx(target, "deduct", 1, "count",
            (target.total_count||0) - (target.used_count||0),
            (target.total_count||0) - up.used_count,
            "수동 1회 사용");
          if(detailCust?.phone && detailCust?.bid){
            const br=(data.branches||[]).find(b=>b.id===detailCust.bid);
            queueAlimtalk(detailCust.bid,"tkt_charge",detailCust.phone,{"#{고객명}":detailCust.name||"","#{총횟수}":String(p.total_count),"#{사용횟수}":String(up.used_count),"#{잔여횟수}":String(p.total_count-up.used_count),"#{시작일}":"","#{종료일}":"","#{매장명}":br?.name||"","#{대표전화번호}":br?.phone||""});
          }
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
          // 히스토리 기록 — 수동 금액 차감
          recordPkgTx(p, "deduct", deduct, "won", balance, newBal, "수동 금액 차감");
          if(detailCust?.phone && detailCust?.bid){
            const br=(data.branches||[]).find(b=>b.id===detailCust.bid);
            queueAlimtalk(detailCust.bid,"pkg_charge",detailCust.phone,{"#{고객명}":detailCust.name||"","#{충전금액}":String(charged),"#{사용금액}":String(newSpent),"#{잔액}":String(newBal),"#{매장명}":br?.name||"","#{대표전화번호}":br?.phone||""});
          }
        }}>금액 차감</Btn>}

        <Btn variant="outline" size="sm" style={{padding:"3px 8px",fontSize:T.fs.nano}} onClick={()=>{
          setPkgEditId(prev => prev === p.id ? null : p.id);
        }}>편집</Btn>
        <Btn variant="outline" size="sm" style={{padding:"3px 8px",fontSize:T.fs.nano}}
          onClick={()=>{
            const willOpen = pkgHistoryOpen !== p.id;
            setPkgHistoryOpen(willOpen ? p.id : null);
            if (willOpen) loadPkgHistory(p.id);
          }}>📜</Btn>
        <Btn variant="danger" size="sm" style={{padding:"3px 8px",fontSize:T.fs.nano}} onClick={()=>{
          if(!confirm("삭제하시겠습니까?")) return;
          sb.del("customer_packages",p.id).catch(console.error);
          setCustPkgsServer(prev=>prev.filter(x=>x.id!==p.id));
        }}><I name="trash" size={11}/></Btn>
      </div>
      {/* 히스토리 뷰 */}
      {pkgHistoryOpen === p.id && <div style={{marginTop:8,borderTop:"1px dashed "+T.border,paddingTop:6,maxHeight:220,overflowY:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:T.textSub,marginBottom:4}}>📜 이력</div>
        {!pkgHistoryMap[p.id] ? (
          <div style={{fontSize:10,color:T.textMuted,padding:"4px 0"}}>로딩중...</div>
        ) : pkgHistoryMap[p.id].length === 0 ? (
          <div style={{fontSize:10,color:T.textMuted,padding:"4px 0"}}>내역 없음</div>
        ) : pkgHistoryMap[p.id].map(tx => {
          const isPlus = tx.type === "charge" || tx.type === "adjust_add";
          const lbl = ({charge:"충전",deduct:"차감",adjust_add:"+조정",adjust_sub:"-조정",cancel:"취소"})[tx.type]||tx.type;
          const unitS = tx.unit === "count" ? "회" : "원";
          return <div key={tx.id} style={{display:"flex",gap:4,alignItems:"center",padding:"3px 0",borderBottom:"1px dotted "+T.gray200,fontSize:10}}>
            <span style={{color:T.textMuted,fontSize:9,minWidth:55}}>{new Date(tx.created_at).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
            <span style={{padding:"1px 4px",borderRadius:3,background:isPlus?"#E8F5E9":"#FFEBEE",color:isPlus?"#2E7D32":"#C62828",fontWeight:700,fontSize:9}}>{lbl}</span>
            <span style={{fontWeight:700,color:isPlus?"#2E7D32":"#C62828",minWidth:50,textAlign:"right"}}>{isPlus?"+":"-"}{(tx.amount||0).toLocaleString()}{unitS}</span>
            {tx.balance_after != null && <span style={{color:"#888"}}>잔 {tx.balance_after.toLocaleString()}{unitS}</span>}
            {tx.sale_id && <span style={{fontSize:9,color:T.primary}} title={tx.sale_id}>💰</span>}
            {tx.staff_name && <span style={{color:T.textSub,fontSize:9,flex:1,textAlign:"right"}}>{tx.staff_name}</span>}
            {tx.note && !tx.staff_name && <span style={{color:T.textSub,fontSize:9,flex:1,textAlign:"right"}}>{tx.note}</span>}
          </div>;
        })}
      </div>}
    </div>;
  };

  return <div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {singleMode && <button onClick={unlockSingleAndReload}
          style={{padding:"6px 12px",borderRadius:T.radius.md,border:"1px solid "+T.primary,background:T.bgCard,color:T.primary,
            fontSize:T.fs.xs,fontWeight:T.fw.bold,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
          ← 전체 목록
        </button>}
        <h2 className="page-title" style={{marginBottom:0}}>고객 관리</h2>
      </div>
      <Btn variant="primary" onClick={()=>{setEditItem(null);setShowModal(true)}}><I name="plus" size={12}/> 고객 등록</Btn>
    </div>

    {/* 검색 & 필터 */}
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{position:"relative",flex:1,minWidth:200,maxWidth:360}}>
        <I name="search" size={14} color={T.gray400} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:34,height:38,borderRadius:T.radius.md,fontSize:T.fs.xs}} placeholder="이름·전화·메모 (공백 구분 다단어 예: 정우 8008)" value={q} onChange={e=>{unlockSingleAndReload();setQ(e.target.value);}}/>
      </div>
      <select className="inp" style={{maxWidth:130,width:"auto",height:38,borderRadius:T.radius.md,fontSize:T.fs.xs}} value={vb} onChange={e=>{unlockSingleAndReload();setVb(e.target.value);}}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>{custs.length}명{hasMore?"+":""}</span>
      {searching && <span style={{fontSize:T.fs.xxs,color:T.orange}}>검색중...</span>}
    </div>

    {/* 무한 스크롤 고객 리스트 */}
    <div ref={scrollRef} onScroll={onScroll} style={{maxHeight:"calc(100vh - 220px)",overflowY:"auto",border:"1px solid "+T.border,borderRadius:T.radius.md}}>
    {(()=>{
      const paged = custs;
      return <>
      {paged.length===0 && !loading
        ? <div style={{textAlign:"center",padding:"40px 0",color:T.textMuted}}><I name="users" size={24}/><div style={{marginTop:8,fontSize:T.fs.xs}}>고객 없음</div></div>
        : <DataTable card>
            <thead><tr>
              <th style={{width:70}}>고객번호</th>
              <th style={{width:100}}>등록일</th>
              <th>이름</th>
              <th style={{width:140}}>연락처</th>
              <th style={{width:160}}>이메일</th>
              <th style={{width:90}}>매장</th>
              <th style={{width:60,textAlign:"right"}}>방문수</th>
              <th style={{width:100}}>최근방문</th>
              <th style={{width:160}}>보유권</th>
              <th style={{width:70}}></th>
            </tr></thead>
            <tbody>
            {paged.map(c => {
              const br = (data.branches||[]).find(b=>b.id===c.bid);
              const isOpen = detailCust?.id===c.id;
              return <React.Fragment key={c.id}>
                <tr style={{cursor:"pointer",background:isOpen?T.primaryHover:"transparent"}}
                  onClick={()=>{ setDetailCust(isOpen?null:c); setDetailTab("sales"); }}>
                  <td style={{fontSize:T.fs.xxs,color:T.textMuted,fontFamily:"monospace"}}>{c.custNum||"-"}</td>
                  <td style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"nowrap"}}>{c.joinDate||(c.createdAt||"").slice(0,10)||"-"}</td>
                  <td style={{fontWeight:T.fw.bold}}>
                    {c.gender && <span style={{...sx.genderBadge(c.gender),marginRight:4}}>{c.gender==="F"?"여":"남"}</span>}
                    {c.name}
                    {c.name2 && <span style={{color:T.textSub,fontWeight:T.fw.normal,marginLeft:4,fontSize:T.fs.xxs}}>({c.name2})</span>}
                    {c.smsConsent===false && <span style={{fontSize:9,color:T.danger,fontWeight:T.fw.bold,marginLeft:4}}>수신거부</span>}
                  </td>
                  <td style={{fontSize:T.fs.xxs,color:T.primary,whiteSpace:"nowrap"}}>
                    {c.phone||"-"}
                    {c.phone2 && <div style={{color:T.textSub,fontSize:9}}>{c.phone2}</div>}
                  </td>
                  <td style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160}}>{c.email||"-"}</td>
                  <td><span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span></td>
                  <td style={{textAlign:"right",fontWeight:T.fw.bold,color:T.textSub}}>{c.visits||0}</td>
                  <td style={{fontSize:T.fs.xxs,color:T.textMuted,whiteSpace:"nowrap"}}>{c.lastVisit||"-"}</td>
                  <td>
                    {(() => {
                      const pkgs = pkgSummaryForCust(c.id);
                      if (pkgs.length === 0) return <span style={{color:T.textMuted,fontSize:T.fs.nano}}>-</span>;
                      return <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                        {pkgs.map((pkg,i) => (
                          <span key={i}
                            style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,
                              background:pkg.expired?"linear-gradient(135deg,#eee,#ddd)":pkg.type==="prepaid"?"linear-gradient(135deg,#FFE0B2,#FFCC80)":"linear-gradient(135deg,#FFF3E0,#FFE0B2)",
                              color:pkg.expired?"#999":"#E65100",border:pkg.expired?"1px solid #ccc":"1px solid #FFB74D",whiteSpace:"nowrap",
                              textDecoration:pkg.expired?"line-through":"none"}}>{pkg.label}</span>
                        ))}
                      </div>;
                    })()}
                  </td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:3}}>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>{setEditItem(c);setShowModal(true)}}><I name="edit" size={11}/></Btn>
                      <Btn variant="danger" size="sm" style={{padding:"2px 5px"}} onClick={()=>{
                        if(!confirm(`"${c.name}" 삭제?`)) return;
                        sb.del("customers",c.id).catch(console.error);
                        sb.delWhere("customer_packages","customer_id",c.id).catch(console.error);
                        setData(prev=>({...prev,customers:(prev.customers||[]).filter(x=>x.id!==c.id),custPackages:(prev.custPackages||[]).filter(x=>x.customer_id!==c.id)}));
                        if(detailCust?.id===c.id) setDetailCust(null);
                      }}><I name="trash" size={11}/></Btn>
                    </div>
                  </td>
                </tr>

                {/* 상세 패널 */}
                {isOpen && <tr><td colSpan={10} style={{padding:0,background:T.gray100,borderTop:"2px solid "+T.primaryLt}}><div>
                    {/* 고객 메모 */}
                    {c.memo && <div style={{padding:"10px 14px",background:"#e8f4fd",borderBottom:"1px solid "+T.border,fontSize:T.fs.xs,color:"#155a8a",whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.5}}>
                      <span style={{fontWeight:T.fw.bolder,marginRight:6}}>👤 메모</span>{c.memo}
                    </div>}
                    {/* 예약 통계 */}
                    <div style={{display:"flex",gap:8,padding:"8px 12px",background:T.bgCard,borderBottom:"1px solid "+T.border}}>
                      {[
                        {label:"예약",val:custResStats.total,color:T.primary},
                        {label:"노쇼",val:custResStats.noshow,color:custResStats.noshow>0?"#e53e3e":T.gray500},
                        {label:"당일취소",val:custResStats.sameday,color:custResStats.sameday>0?"#dd6b20":T.gray500}
                      ].map(s=><div key={s.label} style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:T.fs.xs,color:T.textMuted}}>{s.label}</span>
                        <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:s.color}}>{s.val}</span>
                      </div>)}
                    </div>
                    {/* 탭 */}
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                      {[["sales","매출 내역 ("+custSales.length+")"],["pkg","보유권 ("+custPkgs.filter(p=>{const t=pkgType(p);const ex=(p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);const isExp=ex&&ex[1]<todayStr();if(isExp)return false;return t==="prepaid"?((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"0").replace(/,/g,"")>0:(p.total_count-p.used_count)>0;}).length+")"],["point","포인트 ("+custPointBalance.toLocaleString()+"P)"]].map(([tab,lbl])=>(
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
                          {<select className="inp" style={{width:"auto",fontSize:T.fs.xs,height:30}}
                            value="" onChange={e=>{
                              if(!e.target.value) return;
                              const svc = (data?.services||[]).find(s=>s.id===e.target.value);
                              if(!svc) return;
                              const isAnn = svc.name?.includes("연간")||svc.name?.includes("회원권");
                              const isPre = svc.name?.includes("다담");
                              const tc = isAnn ? 99 : isPre ? 1 : 5;
                              const pkg = {id:genId(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
                                service_name:svc.name,total_count:tc,used_count:0,
                                purchased_at:new Date().toISOString(),note:""};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setCustPkgsServer(prev=>[...prev, pkg]);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">+ 패키지 추가</option>
                            {(data?.services||[]).filter(s=>s.name?.includes("PKG")||s.name?.includes("다담")||s.name?.includes("연간")||s.name?.includes("패키지")||s.name?.includes("산모")||s.name?.includes("회원권")).map(s=>
                              <option key={s.id} value={s.id}>{s.name} ({(s.price_f||0).toLocaleString()}원)</option>
                            )}
                          </select>}
                        </div>
                        {custPkgs.length===0
                          ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>보유 다회권 없음</div>
                          : <div style={{display:"flex",gap:T.sp.sm,flexWrap:"wrap"}}>
                              {[...custPkgs].sort((a,b)=>{
                                const remA=(a.total_count||0)-(a.used_count||0), remB=(b.total_count||0)-(b.used_count||0);
                                const expA=((a.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"";
                                const expB=((b.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"";
                                const today=todayStr();
                                const expiredA=expA&&expA<today, expiredB=expB&&expB<today;
                                const activeA=remA>0&&!expiredA, activeB=remB>0&&!expiredB;
                                const freshA=remA>0&&!expA, freshB=remB>0&&!expB;
                                // 1.유효(잔여+미만료) 2.미사용(유효기간없음) 3.만료/소진
                                if(activeA!==activeB) return activeA?-1:1;
                                if(freshA!==freshB) return freshA?-1:1;
                                return 0;
                              }).map(p=><PkgCard key={p.id} p={p}/>)}
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
                      {/* 포인트 탭 */}
                      {detailTab==="point" && <PointPanel cust={c} txList={custPointTx} balance={custPointBalance} onReload={()=>loadCustPoints(c.id)}/>}
                    </div>
                </div></td></tr>}
              </React.Fragment>;
            })}
            </tbody>
          </DataTable>}

      {loading && <div style={{textAlign:"center",padding:"12px 0",fontSize:T.fs.xxs,color:T.textMuted}}>불러오는 중...</div>}
      {!hasMore && custs.length > 0 && <div style={{textAlign:"center",padding:"12px 0",fontSize:T.fs.xxs,color:T.textMuted}}>— 끝 —</div>}
      </>;
    })()}
    </div>

    {showModal && <CustModal item={editItem} isEdit={!!editItem?.id} onSave={handleSave}
      onClose={()=>_mc(()=>{setShowModal(false);setEditItem(null)})}
      defBranch={userBranches[0]} userBranches={userBranches} branches={data.branches||[]}
      memoTemplate={(()=>{try{const s=typeof (data?.businesses||[])[0]?.settings==='string'?JSON.parse((data.businesses||[])[0].settings):(data?.businesses||[])[0]?.settings||{};return s?.memo_templates?.customer||"";}catch{return "";}})()}/>}
  </div>;
}

// ═══════════════════════════════════════════
// 포인트 패널 (고객 상세 탭)
// ═══════════════════════════════════════════
function PointPanel({ cust, txList, balance, onReload }) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState("earn"); // earn | deduct
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(String(amt).replace(/,/g,""))||0;
    if (n <= 0) { alert("금액을 입력하세요"); return; }
    if (mode === "deduct" && n > balance) { alert(`잔액(${balance.toLocaleString()}P) 부족`); return; }
    setSaving(true);
    try {
      const newBalance = mode === "earn" ? balance + n : balance - n;
      const tx = {
        id: "ptx_" + Math.random().toString(36).slice(2,11),
        business_id: _activeBizId,
        bid: cust.bid,
        customer_id: cust.id,
        type: mode,
        amount: n,
        balance_after: newBalance,
        note: note || null,
      };
      await sb.insert("point_transactions", tx);
      setAmt(""); setNote("");
      onReload();
    } catch (e) { alert("저장 실패: " + e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm("이 포인트 내역을 삭제하시겠어요?")) return;
    try { await sb.del("point_transactions", id); onReload(); }
    catch (e) { alert("삭제 실패: " + e.message); }
  };

  return <div>
    {/* 현재 잔액 + 입력 */}
    <div style={{background:"linear-gradient(135deg,#FFF3E0,#FFE0B2)",border:"1px solid #FFB74D",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12,fontWeight:700,color:"#E65100"}}>🪙 현재 포인트</span>
        <span style={{fontSize:20,fontWeight:900,color:"#E65100"}}>{balance.toLocaleString()}<span style={{fontSize:12,marginLeft:3}}>P</span></span>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:6}}>
        {[["earn","+ 적립","#4CAF50"],["deduct","− 차감","#F44336"]].map(([m,l,c])=>(
          <button key={m} onClick={()=>setMode(m)}
            style={{flex:1,padding:"6px 0",fontSize:11,fontWeight:700,borderRadius:6,border:"1px solid "+(mode===m?c:"#ddd"),background:mode===m?c:"#fff",color:mode===m?"#fff":"#999",cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <input type="text" inputMode="numeric" value={amt} placeholder="금액"
          onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,""); setAmt(v?Number(v).toLocaleString():"");}}
          style={{flex:"0 0 100px",padding:"6px 8px",fontSize:12,borderRadius:6,border:"1px solid #ddd",textAlign:"right",fontFamily:"inherit"}}/>
        <span style={{fontSize:11,color:"#888"}}>P</span>
        <input type="text" value={note} placeholder="메모 (선택)"
          onChange={e=>setNote(e.target.value)}
          style={{flex:1,padding:"6px 8px",fontSize:12,borderRadius:6,border:"1px solid #ddd",fontFamily:"inherit"}}/>
        <button onClick={submit} disabled={saving||!amt}
          style={{padding:"6px 12px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:saving||!amt?"#ccc":"#E65100",color:"#fff",cursor:saving||!amt?"default":"pointer",fontFamily:"inherit"}}>저장</button>
      </div>
    </div>
    {/* 히스토리 */}
    <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6}}>📜 포인트 내역 ({txList.length}건)</div>
    <div style={{maxHeight:360,overflowY:"auto"}}>
      {txList.length === 0
        ? <div style={{fontSize:11,color:T.textMuted,padding:"8px 0",textAlign:"center"}}>내역 없음</div>
        : txList.map(tx => {
            const isPlus = tx.type === "earn" || tx.type === "adjust_add";
            const label = ({earn:"적립",deduct:"차감",adjust_add:"조정+",adjust_sub:"조정-"})[tx.type]||tx.type;
            return <div key={tx.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderBottom:"1px solid "+T.border,fontSize:11}}>
              <span style={{minWidth:64,color:T.textSub,fontSize:10}}>{new Date(tx.created_at).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"})} {new Date(tx.created_at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</span>
              <span style={{padding:"2px 6px",borderRadius:4,background:isPlus?"#E8F5E9":"#FFEBEE",color:isPlus?"#2E7D32":"#C62828",fontWeight:700,fontSize:10}}>{label}</span>
              <span style={{fontWeight:800,color:isPlus?"#2E7D32":"#C62828",minWidth:70,textAlign:"right"}}>{isPlus?"+":"−"}{(tx.amount||0).toLocaleString()}P</span>
              <span style={{flex:1,color:T.text,fontSize:10}}>{tx.note||(tx.sale_id?"매출 연동":"")}</span>
              {tx.balance_after != null && <span style={{color:"#888",fontSize:10}}>잔 {tx.balance_after.toLocaleString()}P</span>}
              <button onClick={()=>remove(tx.id)} title="삭제"
                style={{padding:"2px 5px",border:"none",background:"transparent",color:T.danger,cursor:"pointer",fontSize:12}}>🗑</button>
            </div>;
          })
      }
    </div>
  </div>;
}

export default CustomersPage
