import React, { useState, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, buildTokenSearch, matchAllTokens } from '../../lib/sb'
import { toDb } from '../../lib/db'
import { todayStr, genId, fmtLocal, useSessionState } from '../../lib/utils'
import { Btn, StatCard, GridLayout, fmt, Empty, DataTable, FLD } from '../common'
import I from '../common/I'
import { SmartDatePicker } from '../Reservations/ReservationsPage'
import { DetailedSaleForm } from '../Timeline/ReservationModal'

/* ── sale_details 캐시 ── */
const _detailCache = {};  // { saleId: [rows...] | "loading" }

const _mc = (fn) => { if(fn) fn(); };

function Z() { return <span style={{color:T.gray400}}>0</span>; }

function PaySummary({label, val, color}) {
  if (!val || val <= 0) return null;
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:T.fs.xxs}}>
    <span style={{fontWeight:T.fw.bold,color}}>{label}</span>
    <span style={{fontWeight:T.fw.bolder,color}}>{fmt(val)}</span>
  </span>;
}

const SC = ({label, val, sub, clr}) => <StatCard label={label} value={val} sub={sub} color={clr}/>;

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

function SalesPage({ data, setData, userBranches, isMaster, setPage, role, setPendingOpenCust }) {
  const goToCustomer = (custId) => {
    if (!custId || !setPendingOpenCust || !setPage) return;
    setPendingOpenCust(custId);
    setPage("customers");
  };

  // 매출 전체 편집 — SaleForm 재사용 (할인, 보유권, 포인트 포함)
  const openFullEdit = async (s) => {
    try {
      // sale_details 로드
      let details = detailMap[s.id];
      if (!details) {
        const rows = await sb.get("sale_details", `&sale_id=eq.${s.id}&order=id.asc`);
        details = rows || [];
        setDetailMap(prev => ({...prev, [s.id]: details}));
      }
      // service_name으로 services 테이블에서 ID 매칭
      const matchedServiceIds = [];
      details.forEach(d => {
        const svc = (data?.services||[]).find(x => x.name === d.service_name);
        if (svc) matchedServiceIds.push(svc.id);
      });
      setEditSale({
        ...s,
        saleMemo: s.memo || "",
        _prefill: {
          matchedServiceIds,
          matchedTagIds: [],
          _isNewCust: false,
          existingSaleId: s.id,
          existingDetails: details,
        }
      });
    } catch (e) { alert("편집 진입 실패: " + (e?.message || e)); }
  };
  const [salesTab, setSalesTab] = useSessionState("sales_tab", "sales"); // "sales" | "stats"
  const dateAnchorRef = React.useRef(null);
  const [startDate, setStartDate] = useSessionState("sales_startDate", todayStr());
  const [endDate, setEndDate] = useSessionState("sales_endDate", todayStr());
  const [periodKey, setPeriodKey] = useSessionState("sales_periodKey", "1day");
  const [showSheet, setShowSheet] = useState(false);
  const [vb, setVb] = useSessionState("sales_vb", "all");
  const [showModal, setShowModal] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [editMemoId, setEditMemoId] = useState(null);
  const [editMemoText, setEditMemoText] = useState("");
  const [q, setQ] = useSessionState("sales_q", "");
  const [expandedId, setExpandedId] = useSessionState("sales_expandedId", null);
  const [detailMap, setDetailMap] = useState({});  // saleId → [detail rows]

  /* ── sale_details lazy 로드 ── */
  const loadDetails = useCallback(async (saleId) => {
    // detailMap에 이미 있으면 재조회 안 함 (null/undefined는 재조회 허용)
    if (detailMap[saleId] !== undefined) return;
    // _detailCache는 loading 마커로만 사용 — 실패 시 리셋해서 재시도 가능하게
    if (_detailCache[saleId] === "loading") return;
    _detailCache[saleId] = "loading";
    try {
      const rows = await sb.get("sale_details", `&sale_id=eq.${saleId}&order=id.asc`);
      _detailCache[saleId] = rows || [];
      setDetailMap(prev => ({...prev, [saleId]: rows || []}));
    } catch(e) {
      console.error("sale_details load fail:", e);
      // 로딩 실패 → detailMap에 빈 배열 설정해 "로딩중" 해소 + 캐시 리셋으로 재시도 가능
      setDetailMap(prev => ({...prev, [saleId]: []}));
      delete _detailCache[saleId];
    }
  }, [detailMap]);

  const inRange = (date) => {
    if (periodKey==="all" || (!startDate && !endDate)) return true;
    if (startDate && endDate) return date >= startDate && date <= endDate;
    return true;
  };

  const sales = (data?.sales||[]).filter(s => {
    if (!(vb==="all" ? userBranches.includes(s.bid) : s.bid===vb)) return false;
    if (q) {
      const hay = [s.custName, s.custPhone, s.staffName, s.custNum, s.memo, s.custEmail].filter(Boolean).join(" ");
      return matchAllTokens(hay, q);
    }
    return inRange(s.date);
  }).sort((a,b) => {
    // 최근 날짜 먼저. 날짜 동일하면 createdAt(있으면) 또는 id 내림차순으로 안정 정렬
    const da = a.date||"", db = b.date||"";
    if (da !== db) return db.localeCompare(da);
    const ca = a.createdAt||"", cb = b.createdAt||"";
    if (ca !== cb) return cb.localeCompare(ca);
    return (b.id||"").localeCompare(a.id||"");
  });

  // ── 검색어 입력 시 DB 전체 검색 (날짜 범위·숫자 제한 없이) ──
  const [serverSalesSearching, setServerSalesSearching] = useState(false);
  React.useEffect(() => {
    if (!q || q.length < 2) { setServerSalesSearching(false); return; }
    const t = setTimeout(async () => {
      setServerSalesSearching(true);
      try {
        const bizId = data?.business?.id || data?.businesses?.[0]?.id;
        if (!bizId) { setServerSalesSearching(false); return; }
        // 서버에서 다토큰 AND+OR 중첩 (pgroonga 인덱스로 고속)
        const cond = buildTokenSearch(q, ["cust_name","cust_phone","staff_name","cust_num","memo"]);
        const filter = `&business_id=eq.${bizId}${cond}&limit=500`;
        const rows = await sb.get("sales", filter);
        const parsed = (rows||[]).map(r => {
          // sales는 이미 camelCase에 가까운 형태, 간단 변환
          return {
            id: r.id, bid: r.bid, custId: r.cust_id, custName: r.cust_name, custPhone: r.cust_phone,
            custGender: r.cust_gender, custNum: r.cust_num, staffId: r.staff_id, staffName: r.staff_name,
            date: r.date, serviceId: r.service_id, serviceName: r.service_name,
            productId: r.product_id, productName: r.product_name,
            svcCash: r.svc_cash||0, svcTransfer: r.svc_transfer||0, svcCard: r.svc_card||0, svcPoint: r.svc_point||0,
            prodCash: r.prod_cash||0, prodTransfer: r.prod_transfer||0, prodCard: r.prod_card||0, prodPoint: r.prod_point||0,
            gift: r.gift||0, orderNum: r.order_num, memo: r.memo,
            externalPrepaid: r.external_prepaid||0, externalPlatform: r.external_platform,
            reservationId: r.reservation_id, createdAt: r.created_at,
          };
        });
        setData(prev => {
          if (!prev) return prev;
          const existing = new Set((prev.sales||[]).map(s=>s.id));
          const newRows = parsed.filter(s => !existing.has(s.id));
          return newRows.length > 0 ? {...prev, sales: [...(prev.sales||[]), ...newRows]} : prev;
        });
      } catch(e) { console.error("sales-search err:", e); }
      setServerSalesSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const totals = sales.reduce((a,s) => {
    const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
    return {
      svc:  a.svc+sv,  svcCash:a.svcCash+s.svcCash, svcTransfer:a.svcTransfer+s.svcTransfer,
      svcCard:a.svcCard+s.svcCard, svcPoint:a.svcPoint+s.svcPoint,
      prod: a.prod+pr, prodCash:a.prodCash+s.prodCash, prodTransfer:a.prodTransfer+s.prodTransfer,
      prodCard:a.prodCard+s.prodCard, prodPoint:a.prodPoint+s.prodPoint,
      gift: a.gift+(s.gift||0),
      extPrepaid: a.extPrepaid+(s.externalPrepaid||0),
      total: a.total+sv+pr+(s.gift||0)+(s.externalPrepaid||0),
    };
  }, {svc:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prod:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0,gift:0,extPrepaid:0,total:0});
  // 외부 플랫폼별 선결제 합계
  const extByPlatform = sales.reduce((m,s)=>{
    if(!s.externalPrepaid || s.externalPrepaid<=0) return m;
    const k = s.externalPlatform || "미지정";
    m[k] = (m[k]||0) + s.externalPrepaid;
    return m;
  }, {});

  // ── 매출 삭제: 연관 차감·포인트·visits·sale_details 모두 롤백 ──
  const handleDelete = async (id) => {
    const sale = (data?.sales||[]).find(s => s.id === id);
    if (!sale) return;
    if (!confirm(`매출을 삭제하시겠습니까?\n\n• 다담권/다회권 차감 자동 복구\n• 이 매출로 신규 구매한 보유권 제거\n• 포인트 사용/적립 자동 복구\n• 방문 횟수 -1\n\n되돌릴 수 없습니다.`)) return;

    try {
      // 1) 이 매출과 연결된 package_transactions 모두 조회
      const pkgTxs = await sb.get("package_transactions", `&sale_id=eq.${id}`) || [];

      // 2) charge(신규 구매)된 보유권 ID 수집 — 이건 통째로 삭제
      const chargedPkgIds = new Set();
      pkgTxs.forEach(tx => { if (tx.type === "charge") chargedPkgIds.add(tx.package_id); });

      // 2-a) charge된 보유권 자체 + 연관 거래 모두 삭제
      for (const pkgId of chargedPkgIds) {
        await sb.del("customer_packages", pkgId).catch(console.error);
        await sb.delWhere("package_transactions", "package_id", pkgId).catch(console.error);
      }

      // 2-b) charge 안 된 deduct만 롤백 (used_count -, 잔액 +)
      for (const tx of pkgTxs) {
        if (chargedPkgIds.has(tx.package_id)) continue; // 이미 위에서 처리됨
        if (tx.type === "deduct") {
          const rows = await sb.get("customer_packages", tx.package_id);
          const pkg = rows?.[0];
          if (pkg) {
            const newUsed = Math.max(0, (pkg.used_count || 0) - (tx.amount || 0));
            const upd = { used_count: newUsed };
            if (tx.unit === "won") {
              const curBal = Number(((pkg.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
              const newBal = curBal + (tx.amount || 0);
              if (/잔액:[0-9,]+/.test(pkg.note||"")) {
                upd.note = (pkg.note || "").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
              } else {
                upd.note = (pkg.note ? pkg.note + " | " : "") + `잔액:${newBal.toLocaleString()}`;
              }
            }
            await sb.update("customer_packages", tx.package_id, upd).catch(console.error);
          }
          await sb.del("package_transactions", tx.id).catch(console.error);
        } else {
          // adjust 등 기타 타입도 일단 기록만 삭제
          await sb.del("package_transactions", tx.id).catch(console.error);
        }
      }

      // 3) 포인트 거래 삭제 — point_transactions는 balance_after 누적 테이블이라 거래 삭제 시 자연 복구
      const ptxs = await sb.get("point_transactions", `&sale_id=eq.${id}`) || [];
      for (const tx of ptxs) {
        await sb.del("point_transactions", tx.id).catch(console.error);
      }

      // 4) sale_details 삭제
      await sb.delWhere("sale_details", "sale_id", id).catch(console.error);

      // 5) customers.visits -1
      if (sale.custId) {
        const cust = (data?.customers||[]).find(c => c.id === sale.custId);
        if (cust) {
          const newVisits = Math.max(0, (cust.visits || 0) - 1);
          await sb.update("customers", sale.custId, { visits: newVisits }).catch(console.error);
          setData(prev => ({ ...prev, customers: (prev?.customers||[]).map(c => c.id === sale.custId ? { ...c, visits: newVisits } : c) }));
        }
      }

      // 6) sales 삭제 + 로컬 state 정리
      await sb.del("sales", id).catch(console.error);
      setData(prev => ({
        ...prev,
        sales: (prev?.sales||[]).filter(s => s.id !== id),
        custPackages: (prev?.custPackages||[]).filter(p => !chargedPkgIds.has(p.id)),
      }));

      alert("매출 삭제 + 차감/포인트 복구 완료");
    } catch (e) {
      console.error("[handleDelete rollback]", e);
      alert("삭제 중 오류 발생: " + (e?.message || e));
    }
  };

  const saveMemo = (id) => { setData(prev=>({...prev,sales:(prev?.sales||[]).map(s=>s.id===id?{...s,memo:editMemoText}:s)})); sb.update("sales",id,{memo:editMemoText}).catch(console.error); setEditMemoId(null); };

  // 모달 리마운트 키 — "저장 후 계속" 시 SaleForm을 새로 그리기 위해 증가
  const [formKey, setFormKey] = useState(0);

  // ── 매출 신규 저장: SaleForm이 이미 sales INSERT 완료 → 여기선 로컬 state 갱신만 ──
  const handleSave = async (item) => {
    const continueAfter = !!item?._continueAfter;
    const alreadySaved = !!item?._alreadySaved;
    const saleForState = {...item};
    delete saleForState._continueAfter;
    delete saleForState._alreadySaved;

    setData(prev => ({...prev, sales: [...(prev?.sales||[]), saleForState]}));

    if (continueAfter) {
      setFormKey(k => k + 1);
    } else {
      setShowModal(false);
    }

    // SaleForm이 인서트 안했으면 (레거시 경로) 여기서 책임지고 저장
    if (!alreadySaved) {
      try {
        const res = await sb.insert("sales", toDb("sales", saleForState));
        if (!res) setData(prev => ({...prev, sales: (prev?.sales||[]).filter(s => s.id !== saleForState.id)}));
      } catch (e) {
        setData(prev => ({...prev, sales: (prev?.sales||[]).filter(s => s.id !== saleForState.id)}));
        alert("매출 저장 실패: " + (e?.message || e));
      }
    }
  };

  // ── 매출 수정 진입: 차감/포인트 변경 불가 경고 ──
  const openEditSale = (s) => {
    if (confirm(
      "⚠️ 매출 수정 안내\n\n" +
      "결제수단·차감 금액·포인트 등 '계산 결과'는 수정 모드에서 재반영되지 않습니다.\n" +
      "• 차감/포인트를 바꾸려면 '삭제 후 재등록'을 이용하세요 (자동 복구).\n" +
      "• 메모·담당자·날짜 등 기본 정보는 그대로 수정 가능합니다.\n\n" +
      "계속 진행하시겠습니까?"
    )) {
      setEditSale(s);
    }
  };

  const handleEditSave = (item) => {
    // 편집 모드: SaleForm이 sale_details + sales 본체(결제수단 금액·외부선결제·메모)만 업데이트
    // (보유권 / 포인트 잔액 / package_transactions 는 변경 없음 — 순수 기록 보정 용도)
    if (item?._editOnly && item?.id) {
      setDetailMap(prev => ({...prev, [item.id]: item._newDetails || []}));
      if (item._updatedSale) {
        const u = item._updatedSale;
        setData(prev => ({
          ...prev,
          sales: (prev?.sales||[]).map(s => s.id === item.id ? {
            ...s,
            svcCash: u.svcCash ?? s.svcCash, svcTransfer: u.svcTransfer ?? s.svcTransfer,
            svcCard: u.svcCard ?? s.svcCard, svcPoint: u.svcPoint ?? s.svcPoint,
            prodCash: u.prodCash ?? s.prodCash, prodTransfer: u.prodTransfer ?? s.prodTransfer,
            prodCard: u.prodCard ?? s.prodCard, prodPoint: u.prodPoint ?? s.prodPoint,
            externalPrepaid: u.externalPrepaid ?? s.externalPrepaid,
            externalPlatform: u.externalPlatform ?? s.externalPlatform,
            memo: u.memo ?? s.memo,
            staffId: u.staffId ?? s.staffId,
            staffName: u.staffName ?? s.staffName,
          } : s)
        }));
      }
      alert("매출 편집 저장 완료 (보유권·포인트 잔액은 변동 없음)");
    }
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

  if (salesTab === "stats") return <div>
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {[["sales","매출 관리"],["stats","매출 통계"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid transparent",
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    <StatsPage data={data} userBranches={userBranches} isMaster={isMaster} role={role}/>
  </div>;

  return <div>
    {/* Tab Segment */}
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {[["sales","매출 관리"],["stats","매출 통계"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
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
        {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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

    {/* 요약 합계 바 — 결제수단 분리 표시 (마감 시 편의) */}
    {sales.length > 0 && (() => {
      const cash = totals.svcCash + totals.prodCash;
      const card = totals.svcCard + totals.prodCard;
      const transfer = totals.svcTransfer + totals.prodTransfer;
      const point = totals.svcPoint + totals.prodPoint;
      return <>
        <div style={{display:"flex",gap:T.sp.sm,marginBottom:6,flexWrap:"wrap"}}>
          {[
            {lbl:"총 매출",  v:totals.total, c:T.info,    bold:true},
            {lbl:"시술",     v:totals.svc,   c:T.primary},
            {lbl:"제품",     v:totals.prod,  c:T.infoLt2},
          ].map(({lbl,v,c,bold})=>(
            <div key={lbl} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,
              padding:"6px 14px",display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{lbl}</span>
              <span style={{fontSize:T.fs.sm,fontWeight:bold?T.fw.black:T.fw.bolder,color:c}}>{fmt(v)}</span>
            </div>
          ))}
          {/* 외부 플랫폼 선결제 — 플랫폼별 세분화 */}
          {totals.extPrepaid > 0 && (
            <div style={{background:"#F3E5F5",border:"1px solid #CE93D8",borderRadius:T.radius.md,padding:"6px 14px",display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:T.fs.xxs,color:"#6A1B9A",fontWeight:T.fw.bolder}}>🏷 외부 선결제</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:"#6A1B9A"}}>{fmt(totals.extPrepaid)}</span>
              {Object.entries(extByPlatform).map(([k,v])=>(
                <span key={k} style={{fontSize:T.fs.xxs,color:"#8E24AA"}}>{k} <strong>{fmt(v)}</strong></span>
              ))}
            </div>
          )}
        </div>
        {/* 결제수단별 합계 (마감 정산용) */}
        <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.md,flexWrap:"wrap"}}>
          {[
            {lbl:"현금",  v:cash,     c:"#16a34a"},
            {lbl:"카드",  v:card,     c:T.primary},
            {lbl:"입금",  v:transfer, c:T.info},
            {lbl:"포인트",v:point,    c:T.orange},
            {lbl:"외부선결제",v:totals.extPrepaid, c:"#8E24AA"},
          ].map(({lbl,v,c})=>(
            <div key={lbl} style={{background:c+"15",border:"1px solid "+c+"55",borderRadius:T.radius.md,
              padding:"6px 14px",display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:T.fs.xxs,color:c,fontWeight:T.fw.bolder}}>{lbl}</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:c}}>{fmt(v)}</span>
            </div>
          ))}
        </div>
      </>;
    })()}

    {/* 테이블 */}
    <DataTable card>
      <thead><tr>
        <th style={{width:36}}>#</th>
        <th>날짜</th>
        <th>지점</th>
        <th style={{width:80}}>고객번호</th>
        <th>이름</th>
        <th>담당자</th>
        <th>시술합계</th>
        <th>제품합계</th>
        <th style={{color:"#16a34a"}}>현금</th>
        <th style={{color:T.primary}}>카드</th>
        <th style={{color:T.info}}>입금</th>
        <th style={{color:T.orange}}>포인트</th>
        <th style={{color:"#8E24AA"}}>외부선결제</th>
        <th>총합계</th>
        <th style={{width:60}}></th>
      </tr></thead>
      <tbody>
        {sales.length===0
          ? <tr><td colSpan={15}><Empty msg="매출 기록 없음" icon="wallet"/></td></tr>
          : sales.map((s,i) => {
              const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
              const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
              const rowCash = (s.svcCash||0)+(s.prodCash||0);
              const rowCard = (s.svcCard||0)+(s.prodCard||0);
              const rowTransfer = (s.svcTransfer||0)+(s.prodTransfer||0);
              const rowPoint = (s.svcPoint||0)+(s.prodPoint||0);
              const total = sv+pr+(s.gift||0)+(s.externalPrepaid||0);
              const isExp = expandedId===s.id;
              const br = (data.branches||[]).find(b=>b.id===s.bid);
              return <React.Fragment key={s.id}>
                <tr style={{cursor:"pointer",background:isExp?T.primaryHover:"transparent"}}
                  onClick={()=>{setExpandedId(isExp?null:s.id); if(!isExp) loadDetails(s.id);}}>
                  <td style={{color:T.textMuted}}>{i+1}</td>
                  <td style={{whiteSpace:"nowrap",color:T.textSub,fontSize:T.fs.xxs}}>{s.date}</td>
                  <td><span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span></td>
                  {(() => {
                    // customers 테이블의 cust_num 우선 (s.custNum은 구버전 스냅샷이라 불일치 가능)
                    const cust = s.custId ? (data?.customers||[]).find(c=>c.id===s.custId) : null;
                    const num = cust?.custNum || s.custNum;
                    return <td style={{whiteSpace:"nowrap",fontSize:T.fs.sm,fontFamily:"monospace",color:num?T.text:"#dc2626",fontWeight:900,letterSpacing:"0.3px"}}>
                      {num ? `#${num}` : "없음"}
                    </td>;
                  })()}
                  <td style={{fontWeight:T.fw.bold}}>
                    {s.custGender && <span style={{...sx.genderBadge(s.custGender),marginRight:4}}>{s.custGender==="M"?"남":"여"}</span>}
                    <span onClick={s.custId ? (e)=>{e.stopPropagation(); goToCustomer(s.custId);} : undefined}
                      style={s.custId ? {color:T.primary,textDecoration:"underline",textDecorationColor:T.primary+"55",cursor:"pointer"} : undefined}>{s.custName||"-"}</span>
                  </td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{s.staffName||"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.primary}}>{sv>0?fmt(sv):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.infoLt2}}>{pr>0?fmt(pr):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowCash>0?"#16a34a":T.gray400,textAlign:"right"}}>{rowCash>0?fmt(rowCash):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowCard>0?T.primary:T.gray400,textAlign:"right"}}>{rowCard>0?fmt(rowCard):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowTransfer>0?T.info:T.gray400,textAlign:"right"}}>{rowTransfer>0?fmt(rowTransfer):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowPoint>0?T.orange:T.gray400,textAlign:"right"}}>{rowPoint>0?fmt(rowPoint):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:(s.externalPrepaid||0)>0?"#8E24AA":T.gray400,textAlign:"right"}} title={s.externalPlatform||""}>
                    {(s.externalPrepaid||0)>0 ? fmt(s.externalPrepaid) : "-"}
                  </td>
                  <td style={{fontWeight:T.fw.black,color:T.info}}>{fmt(total)}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:3}}>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>openFullEdit(s)}><I name="edit" size={12}/></Btn>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>handleDelete(s.id)}><I name="trash" size={12}/></Btn>
                    </div>
                  </td>
                </tr>
                {isExp && <tr><td colSpan={15} style={{padding:0,background:T.gray100}}>
                  <div style={{padding:"10px 16px"}}>
                    {/* 결제수단 요약 - 한줄 표시 */}
                    <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                      <PaySummary label="현금" val={(s.svcCash||0)+(s.prodCash||0)} color="#16a34a"/>
                      <PaySummary label="카드" val={(s.svcCard||0)+(s.prodCard||0)} color={T.primary}/>
                      <PaySummary label="입금" val={(s.svcTransfer||0)+(s.prodTransfer||0)} color={T.info}/>
                      <PaySummary label="포인트" val={(s.svcPoint||0)+(s.prodPoint||0)} color={T.orange}/>
                      {(s.externalPrepaid||0)>0 && <PaySummary label={`${s.externalPlatform||"외부"} 선결제`} val={s.externalPrepaid} color={(s.externalPlatform==="네이버")?"#03C75A":"#8E24AA"}/>}
                      {(s.gift||0)>0 && (s.externalPrepaid||0)===0 && <PaySummary label="네이버예약금(legacy)" val={s.gift} color="#03C75A"/>}
                      {s.custPhone && <span style={{fontSize:T.fs.xxs,color:T.primary,marginLeft:"auto"}}>{s.custPhone}</span>}
                      {s.createdAt && <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>
                        {new Date(s.createdAt).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
                      </span>}
                    </div>
                    {/* 관리내역 — 연결된 예약의 서비스태그 표시 */}
                    {(()=>{
                      const rsv = s.reservationId
                        ? (data?.reservations||[]).find(r => r.reservationId===s.reservationId || r.id===s.reservationId)
                        : null;
                      const tagIds = rsv?.selectedTags || [];
                      if (!tagIds.length) return null;
                      const tagList = tagIds.map(tid => (data?.serviceTags||[]).find(t=>t.id===tid)).filter(Boolean);
                      if (!tagList.length) return null;
                      return <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:8,padding:"6px 10px",background:T.gray100,borderRadius:T.radius.md}}>
                        <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.bold}}>🏷 관리내역</span>
                        {tagList.map(tg => (
                          <span key={tg.id} style={{fontSize:T.fs.xxs,fontWeight:700,padding:"2px 8px",borderRadius:10,color:"#fff",background:tg.color||T.primary}}>{tg.name}</span>
                        ))}
                      </div>;
                    })()}
                    {/* 시술 상세 내역 (sale_details) */}
                    {(()=>{
                      const details = detailMap[s.id];
                      if (!details) return <div style={{fontSize:T.fs.xxs,color:T.textMuted,padding:"4px 0"}}>상세 로딩중...</div>;
                      return <div style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,overflow:"hidden"}}>
                        {details.length === 0 && <div style={{fontSize:T.fs.xxs,color:T.textMuted,padding:"8px 10px",background:T.gray100,borderBottom:"1px solid "+T.border}}>
                          ⚠️ 상세내역이 저장돼있지 않습니다. 아래 "+ 항목 추가" 버튼으로 직접 입력하실 수 있습니다.
                        </div>}
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:T.fs.xxs}}>
                          <thead><tr style={{background:T.gray200}}>
                            <th style={{padding:"4px 8px",textAlign:"left",fontWeight:T.fw.bold,color:T.textSub}}>시술/제품명</th>
                            <th style={{padding:"4px 8px",textAlign:"right",fontWeight:T.fw.bold,color:T.textSub,width:80}}>금액</th>
                            <th style={{padding:"4px 8px",textAlign:"right",fontWeight:T.fw.bold,color:T.textSub,width:50}}>수량</th>
                            <th style={{padding:"4px 8px",textAlign:"center",fontWeight:T.fw.bold,color:T.textMuted,width:40}}></th>
                          </tr></thead>
                          <tbody>{details.map((d,di)=>{
                            return <tr key={d.id||di} style={{borderTop:"1px solid "+T.border}}>
                              <td style={{padding:"4px 8px",color:T.text}}>
                                {d.service_name||"-"}
                                {d.sex_div && <span style={{fontSize:T.fs.nano,marginLeft:4,color:d.sex_div==="M"?T.male:d.sex_div==="F"?T.female:T.textMuted}}>
                                  ({d.sex_div==="M"?"남":d.sex_div==="F"?"여":d.sex_div})
                                </span>}
                              </td>
                              <td style={{padding:"4px 8px",textAlign:"right",color:T.text,fontWeight:T.fw.bold}}>{(d.unit_price||0)>0?fmt(d.unit_price):"-"}</td>
                              <td style={{padding:"4px 8px",textAlign:"right",color:T.textSub}}>{d.qty||1}</td>
                              <td style={{padding:"4px 8px",textAlign:"center"}}>
                                <button
                                  onClick={async (e)=>{
                                    e.stopPropagation();
                                    if(!d.id) return;
                                    if(!confirm(`"${d.service_name||"항목"}" 항목을 삭제하시겠습니까?\n\n(매출 금액·결제수단 합계는 변경되지 않습니다. 상세내역만 제거됩니다.)`)) return;
                                    try {
                                      await sb.del("sale_details", d.id);
                                      setDetailMap(prev => ({
                                        ...prev,
                                        [s.id]: (prev[s.id]||[]).filter(x => x.id !== d.id),
                                      }));
                                    } catch(err) {
                                      alert("항목 삭제 실패: " + (err?.message || err));
                                    }
                                  }}
                                  title="이 항목 삭제"
                                  style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:T.danger||"#dc2626",fontSize:T.fs.xs,lineHeight:1}}>
                                  🗑
                                </button>
                              </td>
                            </tr>;
                          })}
                          </tbody>
                        </table>
                        {/* 매출 전체 편집 버튼 — SaleForm 재사용 */}
                        <div style={{padding:"8px 10px",borderTop:"1px solid "+T.border,background:T.gray100,display:"flex",justifyContent:"flex-end",gap:6}} onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>openFullEdit(s)}
                            style={{padding:"6px 14px",fontSize:T.fs.xs,fontWeight:T.fw.bold,borderRadius:6,border:"1.5px solid "+T.primary,background:T.primaryLt||T.bgCard,color:T.primary,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4}}>
                            ✏️ 매출 전체 편집 (할인·보유권·포인트 포함)
                          </button>
                        </div>
                      </div>;
                    })()}
                    {/* 메모 — 상세 페이지 전용, 편집 가능 */}
                    <div style={{marginTop:10,padding:"8px 12px",background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md}}>
                      <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:4}}>📝 메모</div>
                      {editMemoId===s.id ? (
                        <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                          <textarea value={editMemoText} onChange={e=>setEditMemoText(e.target.value)} autoFocus
                            style={{flex:1,fontSize:12,padding:"6px 8px",borderRadius:6,border:"1px solid "+T.primary,fontFamily:"inherit",minHeight:70,resize:"vertical"}}
                            onKeyDown={e=>{if(e.key==="Escape")setEditMemoId(null);}}/>
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <Btn size="sm" onClick={()=>saveMemo(s.id)}>저장</Btn>
                            <Btn variant="secondary" size="sm" onClick={()=>setEditMemoId(null)}>취소</Btn>
                          </div>
                        </div>
                      ) : (
                        <div onClick={()=>{setEditMemoId(s.id);setEditMemoText(s.memo||"");}}
                          style={{fontSize:T.fs.xs,color:s.memo?T.text:T.gray400,whiteSpace:"pre-wrap",lineHeight:1.5,cursor:"pointer",minHeight:20}}
                          title="클릭하여 편집">{s.memo||"메모 없음 (클릭하여 작성)"}</div>
                      )}
                    </div>
                  </div>
                </td></tr>}
              </React.Fragment>;
            })
        }
        {/* 합계 행 */}
        {sales.length>0 && <tr style={{background:T.gray200,fontWeight:T.fw.bolder}}>
          <td colSpan={6} style={{textAlign:"right",color:T.textSub,fontSize:T.fs.xxs}}>합 계</td>
          <td style={{color:T.primary}}>{fmt(totals.svc)}</td>
          <td style={{color:T.infoLt2}}>{fmt(totals.prod)}</td>
          <td style={{color:"#16a34a",textAlign:"right"}}>{fmt(totals.svcCash+totals.prodCash)}</td>
          <td style={{color:T.primary,textAlign:"right"}}>{fmt(totals.svcCard+totals.prodCard)}</td>
          <td style={{color:T.info,textAlign:"right"}}>{fmt(totals.svcTransfer+totals.prodTransfer)}</td>
          <td style={{color:T.orange,textAlign:"right"}}>{fmt(totals.svcPoint+totals.prodPoint)}</td>
          <td style={{color:"#8E24AA",textAlign:"right"}}>{fmt(totals.extPrepaid)}</td>
          <td style={{color:T.info}}>{fmt(totals.total)}</td>
          <td/>
        </tr>}
      </tbody>
    </DataTable>

    {showModal && <DetailedSaleForm
      key={`sale-form-${formKey}`}
      reservation={{id:genId(),bid:userBranches[0],custId:null,custName:"",custPhone:"",custGender:"",
        staffId:"",serviceId:null,date:todayStr()}}
      branchId={userBranches[0]}
      onSubmit={handleSave}
      onClose={()=>_mc(()=>setShowModal(false))} data={data} setData={setData}/>}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo:editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))} data={data} setData={setData}
      editMode={true} existingSaleId={editSale.id}/>}
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
  </div>;
}

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
    extPrepaid:a.extPrepaid+(s.externalPrepaid||0),
    total:a.total+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift+(s.externalPrepaid||0)),
    count:a.count+1,
    svcCash:a.svcCash+s.svcCash,svcTransfer:a.svcTransfer+s.svcTransfer,svcCard:a.svcCard+s.svcCard,svcPoint:a.svcPoint+s.svcPoint,
    prodCash:a.prodCash+s.prodCash,prodTransfer:a.prodTransfer+s.prodTransfer,prodCard:a.prodCard+s.prodCard,prodPoint:a.prodPoint+s.prodPoint,
  }),{svcTotal:0,prodTotal:0,gift:0,extPrepaid:0,total:0,count:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0});

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
        {<select className="inp" style={{maxWidth:150,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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

export default SalesPage
