import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { _activeBizId } from '../../lib/db'
import { sb, buildTokenSearch, matchAllTokens, SB_URL, sbHeaders } from '../../lib/sb'
import { toDb, fromDb } from '../../lib/db'
import { todayStr, pad, genId, fmtLocal, useSessionState, TTL, isMoneyPkg, fmtPhone } from '../../lib/utils'
import { Btn, StatCard, GridLayout, fmt, Empty, DataTable, FLD } from '../common'
import I from '../common/I'
import { SmartDatePicker } from '../Reservations/ReservationsPage'
import { DetailedSaleForm } from '../Timeline/ReservationModal'
import SalesGridPage from './SalesGridPage'

/* ── 포인트 총매출 제외 정책일 ── */
// 이 날짜부터(>=) 발생한 매출은 포인트(svc_point/prod_point)를 총매출에서 제외(현금 미수취).
// 이전 매출은 그대로 포함 → 과거 총매출 숫자 불변. 포인트는 '포인트' 열에 항상 표시.
const POINT_EXCL_FROM = '2026-05-26';
const exclPt = (sale, v) => ((sale?.date || '') >= POINT_EXCL_FROM ? (v || 0) : 0);

/* ── 동의서 필요 상품(charge service_name) → 템플릿 매핑 (SaleForm 동일 로직) ── */
//   컨디션체크리스트(ct_condition_v3)·방문동의(ct_consent_full_ko_v3)는 매 방문 차트라 여기 매핑 X
//   → 구매(금액권/패키지/연간권) 동의서 템플릿만 반환. 매칭 안 되면 null(동의서 불필요)
const _consentTplForName = (name, services) => {
  const svc = (services || []).find(x => x.name === name);
  const nm = svc?.name || name || '';
  const cat = svc?.cat;
  if (cat === '1s18w2l46') return 'ct_gift_ko';                          // 선불권/금액권
  if (/연간|회원권|할인권/.test(nm)) return 'ct_annual_member_ko';        // 연간권
  if (cat === 'c1fbbbff-' || /PKG|패키지/i.test(nm))                      // 패키지(다회권)
    return /에너지/.test(nm) ? 'ct_energy_package' : 'ct_package';
  return null;
};

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

// 매출관리 유지한 채 고객 상세를 읽기전용 팝업으로 표시
function CustDetailPopup({ custId, data, onClose, onOpenFull }) {
  const [cust, setCust] = useState(() => (data?.customers||[]).find(c=>c.id===custId) || null);
  const [pkgs, setPkgs] = useState([]);
  const [pointBal, setPointBal] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      let c = (data?.customers||[]).find(x=>x.id===custId);
      if (!c) {
        const rows = await sb.get("customers", `&id=eq.${custId}&limit=1`).catch(()=>[]);
        if (rows?.length) c = fromDb("customers", rows)[0];
      }
      const [pk, pt] = await Promise.all([
        sb.get("customer_packages", `&customer_id=eq.${custId}`).catch(()=>[]),
        sb.get("point_transactions", `&customer_id=eq.${custId}&select=type,amount`).catch(()=>[]),
      ]);
      if (!alive) return;
      setCust(c||null);
      setPkgs(Array.isArray(pk)?pk:[]);
      let bal=0; (Array.isArray(pt)?pt:[]).forEach(t=>{ if(t.type==='earn')bal+=+t.amount||0; else if(t.type==='deduct'||t.type==='expire')bal-=+t.amount||0; });
      setPointBal(Math.max(0,bal));
      setLoading(false);
    })();
    return ()=>{alive=false;};
  }, [custId]);
  useEffect(()=>{ const h=e=>{if(e.key==='Escape')onClose();}; window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h); }, [onClose]);

  const activePkgs = pkgs.filter(p=>{
    const ex=(p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/); if(ex&&ex[1]<todayStr())return false;
    if (isMoneyPkg(p)) { const v=((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"0").replace(/,/g,""); return +v>0; }
    return ((p.total_count||0)-(p.used_count||0))>0;
  });
  const Row = ({label, children}) => (children!=null && children!=="") ? (
    <div style={{display:"flex",gap:8,fontSize:T.fs.sm,lineHeight:1.5,padding:"3px 0"}}>
      <span style={{minWidth:64,flexShrink:0,color:T.textMuted,fontWeight:600}}>{label}</span>
      <span style={{color:T.text,wordBreak:"break-word"}}>{children}</span>
    </div>
  ) : null;

  const _summary = cust?.serviceSummary || "";
  const _phone = cust?.phone || "";
  const _phone2 = cust?.phone2 || "";
  const _visits = cust?.visits ?? cust?.visitCount;
  const _last = cust?.lastVisit || cust?.lastDate || "";

  return createPortal(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:4000,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:440,maxHeight:"88vh",overflowY:"auto",background:T.bgCard,borderRadius:14,boxShadow:"0 12px 40px rgba(0,0,0,.25)"}}>
        {/* 헤더 */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"14px 16px",borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,background:T.bgCard,borderRadius:"14px 14px 0 0"}}>
          {cust?.gender && <span style={{...sx.genderBadge(cust.gender)}}>{cust.gender==="M"?"남":"여"}</span>}
          <span style={{fontSize:16,fontWeight:800,color:T.text}}>{cust?.name || "고객"}</span>
          {cust?.custNum && <span style={{fontSize:13,fontWeight:700,color:T.text}}>#{cust.custNum}</span>}
          <button type="button" onClick={onClose} style={{marginLeft:"auto",border:"none",background:"transparent",fontSize:20,color:T.gray500,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>
        <div style={{padding:"12px 16px"}}>
          {loading ? <div style={{padding:24,textAlign:"center",color:T.textMuted,fontSize:13}}>불러오는 중…</div> : !cust ? <div style={{padding:24,textAlign:"center",color:T.textMuted,fontSize:13}}>고객 정보를 찾을 수 없습니다.</div> : (
            <>
              {/* AI 분석 */}
              {_summary && <div style={{marginBottom:10,padding:"8px 11px",background:"#EEF2FF",borderRadius:T.radius.md,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                <div style={{fontSize:10,fontWeight:800,color:"#4338ca",display:"flex",alignItems:"center",gap:4,marginBottom:3}}><I name="sparkles" size={11}/>AI 분석</div>
                <div style={{fontSize:12.5,color:"#3730a3",fontWeight:600,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{_summary}</div>
              </div>}
              {/* 기본 정보 */}
              <Row label="연락처">{[_phone&&fmtPhone(_phone), _phone2&&fmtPhone(_phone2)].filter(Boolean).join(" / ")}</Row>
              <Row label="이메일">{cust.email}</Row>
              <Row label="가입일">{(cust.joinDate||cust.createdAt||"").slice(0,10)}</Row>
              <Row label="방문수">{_visits!=null?`${_visits}회`:null}</Row>
              <Row label="최근방문">{(_last||"").slice(0,10)}</Row>
              {/* 보유권 */}
              {activePkgs.length>0 && <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${T.border}`}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textMuted,marginBottom:4}}>보유권</div>
                {activePkgs.map((p,i)=>{
                  const money=isMoneyPkg(p);
                  const bal=((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"").replace(/,/g,"");
                  const disp = money ? (bal?`${(+bal).toLocaleString()}원`:"-") : `${(p.total_count||0)-(p.used_count||0)}회 남음`;
                  return <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:T.fs.sm,padding:"2px 0"}}>
                    <span style={{color:T.text}}>{(p.service_name||"").split("(")[0].trim()}</span>
                    <span style={{fontWeight:700,color:T.primary}}>{disp}</span>
                  </div>;
                })}
              </div>}
              {/* 포인트 */}
              {pointBal>0 && <Row label="포인트">{pointBal.toLocaleString()}P</Row>}
              {/* 메모 */}
              {cust.memo && <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${T.border}`}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textMuted,marginBottom:4}}>고객 메모</div>
                <div style={{fontSize:T.fs.sm,color:T.text,whiteSpace:"pre-wrap",wordBreak:"break-word",lineHeight:1.5}}>{cust.memo}</div>
              </div>}
            </>
          )}
        </div>
        {/* 푸터 — 전체 고객관리로 열기 */}
        {cust && onOpenFull && <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,position:"sticky",bottom:0,background:T.bgCard}}>
          <button type="button" onClick={()=>onOpenFull(custId)} style={{width:"100%",padding:"10px",fontSize:13,fontWeight:700,border:`1px solid ${T.primary}`,borderRadius:8,background:T.primaryLt||"#EEF2FF",color:T.primary,cursor:"pointer",fontFamily:"inherit"}}>고객관리에서 전체 보기 ↗</button>
        </div>}
      </div>
    </div>, document.body);
}

// 🧾 마감정산 모드 — 한 지점·하루 단위, 제품/시술 × 현금·카드·입금·포인트·외부선결제·총매출
function SettlementModal({ data, userBranches, onClose, initBranch, initDate }) {
  const brs = (data?.branches||[]).filter(b=>!userBranches?.length || userBranches.includes(b.id));
  const [branch, setBranch] = useState(initBranch && initBranch!=="all" ? initBranch : (brs[0]?.id||""));
  const [date, setDate] = useState(initDate || todayStr());
  const [agg, setAgg] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!branch || !date) { setAgg(null); return; }
    let alive = true; setLoading(true);
    sb.getAll("sales", `&business_id=eq.${_activeBizId}&bid=eq.${branch}&date=eq.${date}&select=svc_cash,svc_card,svc_transfer,svc_point,prod_cash,prod_card,prod_transfer,prod_point,external_prepaid`)
      .then(rows => {
        if (!alive) return;
        const a = {count:(rows||[]).length, svcCash:0,svcCard:0,svcTransfer:0,svcPoint:0, prodCash:0,prodCard:0,prodTransfer:0,prodPoint:0, ext:0};
        (rows||[]).forEach(r => { a.svcCash+=r.svc_cash||0;a.svcCard+=r.svc_card||0;a.svcTransfer+=r.svc_transfer||0;a.svcPoint+=r.svc_point||0;a.prodCash+=r.prod_cash||0;a.prodCard+=r.prod_card||0;a.prodTransfer+=r.prod_transfer||0;a.prodPoint+=r.prod_point||0;a.ext+=r.external_prepaid||0; });
        setAgg(a); setLoading(false);
      }).catch(() => { if (alive) { setAgg(null); setLoading(false); } });
    return () => { alive = false; };
  }, [branch, date]);
  useEffect(() => { const h=e=>{if(e.key==='Escape')onClose();}; window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h); }, [onClose]);

  const _addDays = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const prod = agg ? {cash:agg.prodCash,card:agg.prodCard,transfer:agg.prodTransfer,point:agg.prodPoint,ext:0} : null;
  const svc  = agg ? {cash:agg.svcCash,card:agg.svcCard,transfer:agg.svcTransfer,point:agg.svcPoint,ext:agg.ext} : null;
  // 정책일 이후 날짜면 포인트 제외(현금 미수취). 포인트는 별도 열로 표시만.
  const rowTot = (r) => r ? r.cash+r.card+r.transfer+(date>=POINT_EXCL_FROM?0:r.point)+r.ext : 0;
  const sumK = (k) => (prod?prod[k]:0)+(svc?svc[k]:0);
  const cols = [["현금","cash","#16a34a"],["카드","card",T.primary],["입금","transfer",T.info],["포인트","point",T.orange],["외부선결제","ext","#8E24AA"]];
  const cell = (v) => v>0 ? fmt(v) : <span style={{color:T.gray300}}>-</span>;
  const cH = {padding:"7px 8px",fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.textSub,borderBottom:`2px solid ${T.border}`};
  const cD = {padding:"9px 8px",borderBottom:`1px solid ${T.border}`};
  const dBtn = (on) => ({height:34,padding:"0 12px",fontSize:T.fs.xs,fontWeight:T.fw.bold,borderRadius:T.radius.sm,cursor:"pointer",fontFamily:"inherit",border:`1px solid ${on?T.primary:T.border}`,background:on?T.primaryHover:T.bgCard,color:on?T.primaryDk:T.textSub});

  return createPortal(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:4000,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 16px",overflowY:"auto"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:680,background:T.bgCard,borderRadius:14,boxShadow:"0 12px 40px rgba(0,0,0,.25)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:16,fontWeight:800,color:T.text,display:"inline-flex",alignItems:"center",gap:6}}><I name="banknote" size={16}/>마감정산</span>
          <button onClick={onClose} style={{marginLeft:"auto",border:"none",background:"transparent",fontSize:22,color:T.gray500,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>
        <div style={{padding:"14px 16px"}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
            <select className="inp" style={{height:34,minWidth:130}} value={branch} onChange={e=>setBranch(e.target.value)}>
              {brs.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input type="date" className="inp" style={{height:34}} value={date} onChange={e=>setDate(e.target.value)}/>
            <button type="button" onClick={()=>setDate(todayStr())} style={dBtn(date===todayStr())}>당일</button>
            <button type="button" onClick={()=>setDate(_addDays(-1))} style={dBtn(date===_addDays(-1))}>전일</button>
            {agg && <span style={{marginLeft:"auto",fontSize:T.fs.xs,color:T.textSub,fontWeight:T.fw.bold}}>{agg.count}건</span>}
          </div>
          {loading ? <div style={{padding:28,textAlign:"center",color:T.textMuted,fontSize:13}}>불러오는 중…</div> : !agg ? null : (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:T.fs.sm,minWidth:560}}>
                <thead><tr>
                  <th style={{...cH,textAlign:"left"}}>구분</th>
                  {cols.map(([l,,c])=><th key={l} style={{...cH,textAlign:"right",color:c}}>{l}</th>)}
                  <th style={{...cH,textAlign:"right",color:T.text}}>총매출</th>
                </tr></thead>
                <tbody>
                  <tr>
                    <td style={{...cD,fontWeight:T.fw.bolder,color:T.info}}>제품</td>
                    {cols.map(([l,k])=><td key={l} style={{...cD,textAlign:"right"}}>{cell(prod[k])}</td>)}
                    <td style={{...cD,textAlign:"right",fontWeight:T.fw.black}}>{fmt(rowTot(prod))}</td>
                  </tr>
                  <tr>
                    <td style={{...cD,fontWeight:T.fw.bolder,color:T.primary}}>시술</td>
                    {cols.map(([l,k])=><td key={l} style={{...cD,textAlign:"right"}}>{cell(svc[k])}</td>)}
                    <td style={{...cD,textAlign:"right",fontWeight:T.fw.black}}>{fmt(rowTot(svc))}</td>
                  </tr>
                  <tr style={{background:T.gray200}}>
                    <td style={{...cD,fontWeight:T.fw.black}}>합계</td>
                    {cols.map(([l,k])=><td key={l} style={{...cD,textAlign:"right",fontWeight:T.fw.bolder}}>{cell(sumK(k))}</td>)}
                    <td style={{...cD,textAlign:"right",fontWeight:T.fw.black,color:T.info}}>{fmt(rowTot(prod)+rowTot(svc))}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{marginTop:10,fontSize:T.fs.xxs,color:T.textMuted,lineHeight:1.5}}>※ 외부선결제(예약금 등)는 시술로 집계됩니다. 보유권 차감은 현금성 결제가 아니라 제외.</div>
            </div>
          )}
        </div>
      </div>
    </div>, document.body);
}

function SalesPage({ data, setData, userBranches, isMaster, setPage, role, setPendingOpenCust }) {
  const [custPopupId, setCustPopupId] = useState(null);
  const [showSettlement, setShowSettlement] = useState(false);
  // 고객명 클릭 → 매출관리 유지한 채 팝업으로 상세 표시
  const goToCustomer = (custId) => { if (custId) setCustPopupId(custId); };
  // 팝업 내 '전체 보기' → 기존처럼 고객관리 페이지로 이동
  const openFullCustomer = (custId) => {
    setCustPopupId(null);
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
  const [salesTab, setSalesTab] = useSessionState("sales_tab", "sales", { ttlMs: TTL.TAB }); // "sales" | "stats"
  const dateAnchorRef = React.useRef(null);
  const [startDate, setStartDate] = useSessionState("sales_startDate", todayStr().slice(0,7)+"-01", { ttlMs: TTL.DATE_RANGE });
  const [endDate, setEndDate] = useSessionState("sales_endDate", todayStr(), { ttlMs: TTL.DATE_RANGE });
  const [periodKey, setPeriodKey] = useSessionState("sales_periodKey", "month", { ttlMs: TTL.DATE_RANGE });
  // 디폴트 기간 = 이번 달 1일~말일 ("이번 달 한 달", 정우님). periodKey=month인 기존 세션값(예: 오늘 단일)도 마운트 시 교정.
  useEffect(() => {
    if (periodKey !== "month") return;
    const d = new Date();
    const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const le = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const me = `${le.getFullYear()}-${String(le.getMonth()+1).padStart(2,'0')}-${String(le.getDate()).padStart(2,'0')}`;
    if (startDate !== ms) setStartDate(ms);
    if (endDate !== me) setEndDate(me);
  }, []);  // 마운트 1회
  const [showSheet, setShowSheet] = useState(false);
  const [vb, setVb] = useSessionState("sales_vb", "all", { ttlMs: TTL.TAB });
  const [showModal, setShowModal] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [editMemoId, setEditMemoId] = useState(null);
  const [editMemoText, setEditMemoText] = useState("");
  const [q, setQ] = useSessionState("sales_q", "", { ttlMs: TTL.SEARCH });
  const [expandedId, setExpandedId] = useSessionState("sales_expandedId", null, { ttlMs: TTL.TAB });
  const [detailMap, setDetailMap] = useState({});  // saleId → [detail rows]
  const [consentRowMap, setConsentRowMap] = useState({});  // saleId → {state:'done'|'sent'|'need', url?} (리스트 행 표시용)

  // sales 행의 svc_x/prod_x NET 결제값 직접 사용
  // v3.7.240 SaleForm에서 매출 저장 시 결제수단을 시술/제품으로 정확히 분리해 DB에 저장하므로
  // 이 값 자체가 신뢰할 수 있는 NET. 합계는 항상 결제액과 일치.
  // - 구버전 데이터 (모두 svc 컬럼에 들어간 케이스): 제품합계는 0으로 표시되지만, 총합계는 정확.
  // - 매출 편집 시 split-on-save 로직이 다시 적용되어 누락된 분리 교정 가능.
  const splitSvcProd = useCallback((sale) => {
    const svcRaw = (sale.svcCash||0) + (sale.svcTransfer||0) + (sale.svcCard||0) + (sale.svcPoint||0);
    const prodRaw = (sale.prodCash||0) + (sale.prodTransfer||0) + (sale.prodCard||0) + (sale.prodPoint||0);
    return { svc: svcRaw, prod: prodRaw, fromDetails: false };
  }, []);

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

  // ── 동의서 상태 batch 로드 (보이는 매출만, 필터/목록 변경 시 1회 — 펼침 무관) ──
  // 키: sales.reservation_id ↔ consent_tokens.prefill_data->>reservation_id(발송) / customer_consents.form_data->>reservation_id(작성)
  // 동의서 필요 여부: package_transactions(type=charge, sale_id) = 선불권/패키지/연간권 구매분
  const _consentBatchRef = React.useRef("");
  React.useEffect(() => {
    const visible = sales.filter(s => s.reservationId).slice(0, 400); // 부하 가드: 최대 400행
    if (visible.length === 0) { setConsentRowMap({}); return; }
    const svcCount = (data?.services || []).length;
    const key = svcCount + "|" + visible.map(s => s.id).join(",");
    if (_consentBatchRef.current === key) return;
    _consentBatchRef.current = key;
    let cancelled = false;
    (async () => {
      const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
      const saleIds = visible.map(s => s.id);
      const resIds = [...new Set(visible.map(s => s.reservationId))];
      // 1) 매출별 "필요 동의서 템플릿" — 선불권/패키지/연간권 구매(charge) service_name → 템플릿
      const needTplBySale = {}; // saleId → Set(tplId)
      for (const c of chunk(saleIds, 100)) {
        const rows = await sb.get("package_transactions", `&type=eq.charge&sale_id=in.(${c.join(",")})`).catch(() => []);
        (rows || []).forEach(r => {
          const tpl = _consentTplForName(r.service_name, data?.services);
          if (!tpl || !r.sale_id) return;
          if (!needTplBySale[r.sale_id]) needTplBySale[r.sale_id] = new Set();
          needTplBySale[r.sale_id].add(tpl);
        });
      }
      // 2) 예약별 발송(token)/작성(consent) 템플릿 집합 — reservation_id 기준
      const sentTplByRes = {};   // resid → Set(tplId)
      const signedTplByRes = {}; // resid → Map(tplId → 작성본 url)
      for (const c of chunk(resIds, 60)) {
        const enc = c.map(encodeURIComponent).join(",");
        const [tk, cs] = await Promise.all([
          sb.get("consent_tokens", `&prefill_data->>reservation_id=in.(${enc})`).catch(() => []),
          sb.get("customer_consents", `&form_data->>reservation_id=in.(${enc})`).catch(() => []),
        ]);
        (tk || []).forEach(t => {
          const r = t?.prefill_data?.reservation_id; if (!r) return;
          if (!sentTplByRes[r]) sentTplByRes[r] = new Set();
          if (t.template_id) sentTplByRes[r].add(t.template_id);
          if (Array.isArray(t.template_ids)) t.template_ids.forEach(x => sentTplByRes[r].add(x));
        });
        (cs || []).forEach(c2 => {
          const r = c2?.form_data?.reservation_id; if (!r) return;
          if (!signedTplByRes[r]) signedTplByRes[r] = new Map();
          if (c2.template_id) signedTplByRes[r].set(c2.template_id, c2.document_url || c2.signature_url || null);
        });
      }
      if (cancelled) return;
      const map = {};
      visible.forEach(s => {
        const needed = needTplBySale[s.id];
        if (!needed || needed.size === 0) return; // 구매 동의서 불필요 → 아이콘 없음
        const r = s.reservationId;
        const signedM = signedTplByRes[r] || new Map();
        const sentS = sentTplByRes[r] || new Set();
        let anySigned = false, anySent = false, url = null;
        // 필요 템플릿 중 작성된 게 있나? 발송된 게 있나? (컨디션체크리스트는 needed에 없으므로 매칭 안 됨)
        for (const tpl of needed) {
          if (signedM.has(tpl)) { anySigned = true; if (url === null) url = signedM.get(tpl); }
          if (sentS.has(tpl)) anySent = true;
        }
        if (anySigned) map[s.id] = { state: 'done', url };
        else if (anySent) map[s.id] = { state: 'sent' };
        else map[s.id] = { state: 'need' };
      });
      setConsentRowMap(map);
    })();
    return () => { cancelled = true; };
  }, [sales.map(s => s.id).join(","), (data?.services || []).length]);

  // ── 날짜 범위 lazy-load: PostgREST max-rows=1000 제한 때문에 AppShell 초기 로드도 일부 누락
  // → startDate 변경 시 항상 그 범위 서버 조회 (sb.getAll 페이지네이션). 중복은 _lazyLoadedRanges로 차단
  const _lazyLoadedRanges = React.useRef(new Set());
  React.useEffect(() => {
    if (!startDate || !endDate || periodKey === 'all') return;
    const bizId = data?.business?.id || data?.businesses?.[0]?.id;
    if (!bizId) return;
    const rangeKey = `${startDate}_${endDate}`;
    if (_lazyLoadedRanges.current.has(rangeKey)) return;
    _lazyLoadedRanges.current.add(rangeKey);
    (async () => {
      try {
        // sb.getAll: PostgREST max-rows 제한 우회 (페이지네이션으로 전체 fetch)
        const filter = `&business_id=eq.${bizId}&date=gte.${startDate}&date=lte.${endDate}&order=date.desc`;
        const rows = await sb.getAll('sales', filter);
        if (!rows?.length) return;
        const mapped = fromDb('sales', rows);
        setData(prev => {
          const list = prev?.sales || [];
          const ids = new Set(list.map(s => s.id));
          const additions = mapped.filter(s => !ids.has(s.id));
          if (!additions.length) return prev;
          return {...prev, sales: [...list, ...additions]};
        });
      } catch(e) { console.warn('[sales lazy-load]', e); }
    })();
  }, [startDate, endDate, periodKey]);

  // ── 일별 그룹화 (날짜별 헤더 + 매출 합계) ──
  const salesByDate = React.useMemo(() => {
    const map = new Map();
    sales.forEach(s => {
      const dk = s.date || "";
      if (!map.has(dk)) map.set(dk, {
        sales: [], svc: 0, prod: 0, ep: 0, gift: 0, total: 0, count: 0,
        cash: 0, card: 0, transfer: 0, point: 0,
      });
      const g = map.get(dk);
      g.sales.push(s);
      const svRaw = (s.svcCash||0)+(s.svcTransfer||0)+(s.svcCard||0)+(s.svcPoint||0);
      const pr = (s.prodCash||0)+(s.prodTransfer||0)+(s.prodCard||0)+(s.prodPoint||0);
      const ep = s.externalPrepaid || 0;
      const gift = s.gift || 0;
      const _split = splitSvcProd(s);
      // 정책일 이후 매출은 포인트 제외(현금 미수취) — g.point에 별도 집계해 표시만
      g.svc += _split.svc + ep - exclPt(s,s.svcPoint); // 외부선결제는 시술에 포함 (운영 규칙)
      g.prod += _split.prod - exclPt(s,s.prodPoint);
      g.ep += ep;
      g.gift += gift;
      g.total += (svRaw-exclPt(s,s.svcPoint)) + (pr-exclPt(s,s.prodPoint)) + gift + ep;
      g.count += 1;
      // 결제수단별 합계 (시술+제품)
      g.cash     += (s.svcCash||0)     + (s.prodCash||0);
      g.card     += (s.svcCard||0)     + (s.prodCard||0);
      g.transfer += (s.svcTransfer||0) + (s.prodTransfer||0);
      g.point    += (s.svcPoint||0)    + (s.prodPoint||0);
    });
    return Array.from(map.entries()).sort((a,b) => (b[0]||"").localeCompare(a[0]||""));
  }, [sales]);
  const [collapsedDates, setCollapsedDates] = useState(() => new Set());
  // 디폴트 접힘 — 새로 등장하는 날짜는 자동 접힘. 사용자가 펼친 날짜는 그대로 유지
  const _seenDatesRef = React.useRef(new Set());
  React.useEffect(() => {
    const newDates = salesByDate.map(([d]) => d).filter(d => d && !_seenDatesRef.current.has(d));
    if (newDates.length === 0) return;
    newDates.forEach(d => _seenDatesRef.current.add(d));
    setCollapsedDates(prev => {
      const next = new Set(prev);
      newDates.forEach(d => next.add(d));
      return next;
    });
  }, [salesByDate]);
  const toggleDate = (d) => setCollapsedDates(prev => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });
  const collapseAll = () => setCollapsedDates(new Set(salesByDate.map(([d]) => d)));
  const expandAll = () => setCollapsedDates(new Set());

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
            svcCash: r.svc_cash||0, svcTransfer: r.svc_transfer||0, svcCard: r.svc_card||0, svcPoint: r.svc_point||0, svcComped: r.svc_comped||0,
            prodCash: r.prod_cash||0, prodTransfer: r.prod_transfer||0, prodCard: r.prod_card||0, prodPoint: r.prod_point||0, prodComped: r.prod_comped||0,
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
    const svRaw = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
    // 외부선결제는 결제수단(시술용) — 항상 시술 합계에 포함 (운영 규칙: 외부선결제는 모두 시술)
    const extToSvc = (s.externalPrepaid||0);
    // 시술/제품 합계는 sale_details 기반 정확 분리 (구버전 데이터는 svc_*/prod_* fallback)
    const split = splitSvcProd(s);
    const svDisp = split.svc + extToSvc;
    const prDisp = split.prod;
    return {
      // 정책일 이후 매출은 포인트를 총매출/시술/제품에서 제외(현금 미수취). svcPoint/prodPoint는 '포인트' 열에 표시만.
      svc:  a.svc+svDisp-exclPt(s,s.svcPoint),  svcCash:a.svcCash+s.svcCash, svcTransfer:a.svcTransfer+s.svcTransfer,
      svcCard:a.svcCard+s.svcCard, svcPoint:a.svcPoint+s.svcPoint,
      prod: a.prod+prDisp-exclPt(s,s.prodPoint), prodCash:a.prodCash+s.prodCash, prodTransfer:a.prodTransfer+s.prodTransfer,
      prodCard:a.prodCard+s.prodCard, prodPoint:a.prodPoint+s.prodPoint,
      gift: a.gift+(s.gift||0),
      extPrepaid: a.extPrepaid+(s.externalPrepaid||0),
      total: a.total+(svRaw-exclPt(s,s.svcPoint))+(pr-exclPt(s,s.prodPoint))+(s.gift||0)+(s.externalPrepaid||0),
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

      // 5-b) 이 매출에 매칭된 입금문자 → 미매칭으로 되돌림 (FK 차단 방지 + 입금 재매칭 가능)
      const matchedDeps = await sb.get("bank_deposits", `&matched_sale_id=eq.${id}`) || [];
      for (const dp of matchedDeps) {
        await sb.update("bank_deposits", dp.id, { status: "pending", matched_sale_id: null, matched_at: null, matched_by: null }).catch(console.error);
      }

      // 6) sales 삭제 — 성공 확인 후에만 로컬 state 정리 (실패 시 화면만 지워지고 새로고침 시 부활하던 버그 방지)
      const _delOk = await sb.del("sales", id);
      if (!_delOk) { alert("매출 삭제에 실패했습니다(서버 거부). 새로고침 후 다시 시도하거나 관리자에게 문의하세요."); return; }
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
      // _newDetails: null이면 sale_details 재생성 안 함 (editMode = 결제수단 교정 only) → detailMap 그대로 유지
      if (item._newDetails != null) {
        setDetailMap(prev => ({...prev, [item.id]: item._newDetails}));
      }
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
      {lbl:"제품현금",  v:prodCash,    c:T.info},
      {lbl:"제품입금",  v:prodTransfer,c:T.info},
      {lbl:"제품카드",  v:prodCard,    c:T.info},
      {lbl:"제품포인트",v:prodPoint,   c:T.info},
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

  // 그리드 탭은 대표(super/owner)만 노출
  const _gridAllowed = role === 'super' || role === 'owner'
  const _tabs = [["sales","매출 관리"],["stats","매출 통계"], ..._gridAllowed ? [["grid",<span style={{display:"inline-flex",alignItems:"center",gap:4}}><I name="chart" size={13}/>그리드</span>]] : []]

  if (salesTab === "grid") {
    if (!_gridAllowed) { setSalesTab("sales"); return null }
    return <div>
      <div style={{display:"flex",gap:0,marginBottom:12}}>
        {_tabs.map(([k,l])=>(
          <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
            color:salesTab===k?T.primary:T.textMuted,
            background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      <SalesGridPage data={data} userBranches={userBranches} role={role}/>
    </div>
  }

  if (salesTab === "stats") return <div style={{overflowX:"hidden",maxWidth:"100%"}}>
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {_tabs.map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid transparent",
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    <StatsPage data={data} userBranches={userBranches} isMaster={isMaster} role={role}
      startDate={startDate} endDate={endDate} periodKey={periodKey}
      setStartDate={setStartDate} setEndDate={setEndDate} setPeriodKey={setPeriodKey}/>
  </div>;

  return <div>
    {/* Tab Segment */}
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {_tabs.map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 관리</h2>
      <div style={{display:"flex",gap:T.sp.sm,alignItems:"center"}}>
        <Btn variant="ghost" onClick={()=>setShowSettlement(true)}><I name="banknote" size={13} style={{marginRight:4,verticalAlign:"-2px"}}/>정산 모드</Btn>
        <Btn variant="primary" onClick={()=>setShowModal(true)}><I name="plus" size={12}/> 매출등록</Btn>
      </div>
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
      {salesByDate.length > 1 && (
        <div style={{display:"flex",gap:4,marginLeft:"auto",flexShrink:0}}>
          <button onClick={collapseAll} style={{height:28,padding:"0 10px",fontSize:T.fs.xxs,fontWeight:T.fw.bold,
            background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.sm,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>
            ▶ 모두 접기
          </button>
          <button onClick={expandAll} style={{height:28,padding:"0 10px",fontSize:T.fs.xxs,fontWeight:T.fw.bold,
            background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.sm,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>
            ▼ 모두 펼치기
          </button>
        </div>
      )}
    </div>

    {/* 테이블 — 합계 카드 제거, 합계 행을 헤더 바로 다음으로 이동 (유저 요청) */}
    <DataTable card>
      <thead><tr>
        <th style={{width:36}}>#</th>
        <th>날짜</th>
        <th>지점</th>
        <th style={{width:80}}>고객번호</th>
        <th>이름</th>
        <th>담당자</th>
        <th style={{textAlign:"right"}}>총합계</th>
        <th style={{textAlign:"right"}}>시술합계</th>
        <th style={{textAlign:"right"}}>제품합계</th>
        <th style={{color:"#16a34a",textAlign:"right"}}>현금</th>
        <th style={{color:T.primary,textAlign:"right"}}>카드</th>
        <th style={{color:T.info,textAlign:"right"}}>입금</th>
        <th style={{color:T.orange,textAlign:"right"}}>포인트</th>
        <th style={{color:"#8E24AA",textAlign:"right"}}>외부선결제</th>
        <th style={{width:60}}></th>
      </tr></thead>
      <tbody>
        {/* 합계 행 — 헤더 바로 다음 (유저 요청) */}
        {sales.length>0 && <tr style={{background:T.gray200,fontWeight:T.fw.bolder,position:"sticky",top:32,zIndex:1}}>
          <td colSpan={6} style={{textAlign:"right",color:T.textSub,fontSize:T.fs.xxs}}>합 계</td>
          <td style={{color:T.info,textAlign:"right",fontWeight:T.fw.black}}>{fmt(totals.total)}</td>
          <td style={{color:T.primary,textAlign:"right"}}>{fmt(totals.svc)}</td>
          <td style={{color:T.info,textAlign:"right"}}>{fmt(totals.prod)}</td>
          <td style={{color:"#16a34a",textAlign:"right"}}>{fmt(totals.svcCash+totals.prodCash)}</td>
          <td style={{color:T.primary,textAlign:"right"}}>{fmt(totals.svcCard+totals.prodCard)}</td>
          <td style={{color:T.info,textAlign:"right"}}>{fmt(totals.svcTransfer+totals.prodTransfer)}</td>
          <td style={{color:T.orange,textAlign:"right"}}>{fmt(totals.svcPoint+totals.prodPoint)}</td>
          <td style={{color:"#8E24AA",textAlign:"right"}}>{fmt(totals.extPrepaid)}</td>
          <td/>
        </tr>}
        {sales.length===0
          ? <tr><td colSpan={15}><Empty msg="매출 기록 없음" icon="wallet"/></td></tr>
          : (() => {
              const _DOW = ['일','월','화','수','목','금','토'];
              let _gIdx = 0;
              return salesByDate.map(([dateKey, g]) => {
                const isCollapsed = collapsedDates.has(dateKey);
                const startIdx = _gIdx;
                _gIdx += g.sales.length;
                const dow = (() => { try { return _DOW[new Date(dateKey).getDay()]; } catch { return ''; } })();
                return <React.Fragment key={`grp_${dateKey}`}>
                  {/* 날짜 그룹 헤더 */}
                  <tr onClick={()=>toggleDate(dateKey)}
                    style={{cursor:"pointer",background:"#F3F4F6",borderTop:"2px solid "+T.border,borderBottom:"1px solid "+T.border,fontWeight:T.fw.bold,fontSize:T.fs.xs}}>
                    <td colSpan={6} style={{padding:"7px 10px",color:T.textDk||T.text}}>
                      <span style={{marginRight:6,fontSize:9,color:T.textMuted}}>{isCollapsed?'▶':'▼'}</span>
                      <span style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm}}>{dateKey}</span>
                      <span style={{marginLeft:4,color:dow==='일'?'#dc2626':dow==='토'?'#2563eb':T.textMuted}}>({dow})</span>
                      <span style={{marginLeft:10,fontSize:T.fs.xxs,color:T.textMuted,fontWeight:T.fw.medium}}>{g.count}건</span>
                    </td>
                    <td style={{textAlign:"right",color:T.text,fontWeight:T.fw.black,fontSize:T.fs.sm}}>{fmt(g.total)}</td>
                    <td style={{textAlign:"right",color:T.primary,fontWeight:T.fw.bolder}}>{g.svc>0?fmt(g.svc):'-'}</td>
                    <td style={{textAlign:"right",color:T.info,fontWeight:T.fw.bolder}}>{g.prod>0?fmt(g.prod):'-'}</td>
                    <td style={{textAlign:"right",color:g.cash>0?"#16a34a":T.gray400,fontWeight:T.fw.bolder}}>{g.cash>0?fmt(g.cash):'-'}</td>
                    <td style={{textAlign:"right",color:g.card>0?T.primary:T.gray400,fontWeight:T.fw.bolder}}>{g.card>0?fmt(g.card):'-'}</td>
                    <td style={{textAlign:"right",color:g.transfer>0?T.info:T.gray400,fontWeight:T.fw.bolder}}>{g.transfer>0?fmt(g.transfer):'-'}</td>
                    <td style={{textAlign:"right",color:g.point>0?T.orange:T.gray400,fontWeight:T.fw.bolder}}>{g.point>0?fmt(g.point):'-'}</td>
                    <td style={{textAlign:"right",color:g.ep>0?"#8E24AA":T.gray400,fontWeight:T.fw.bolder}}>{g.ep>0?fmt(g.ep):'-'}</td>
                    <td></td>
                  </tr>
                  {/* 그날 거래 행 (접힘 X) */}
                  {!isCollapsed && g.sales.map((s, _localI) => {
                    const i = startIdx + _localI;
                    const svRaw = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
                    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
              // 외부선결제는 결제수단(시술용) — 항상 시술합계에 포함 (운영 규칙)
              const extToSvc = (s.externalPrepaid||0);
              // 시술/제품 분리 — sale_details 기반 (구버전 데이터는 svc_*/prod_* fallback)
              const _split = splitSvcProd(s);
              // 정책일 이후 매출은 포인트 제외(현금 미수취) — rowPoint는 '포인트' 열에 표시만
              const sv = _split.svc + extToSvc - exclPt(s,s.svcPoint);
              const prDisp = _split.prod - exclPt(s,s.prodPoint);
              const rowCash = (s.svcCash||0)+(s.prodCash||0);
              const rowCard = (s.svcCard||0)+(s.prodCard||0);
              const rowTransfer = (s.svcTransfer||0)+(s.prodTransfer||0);
              const rowPoint = (s.svcPoint||0)+(s.prodPoint||0);
              const total = (svRaw-exclPt(s,s.svcPoint))+(pr-exclPt(s,s.prodPoint))+(s.gift||0)+(s.externalPrepaid||0);
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
                  {(() => {
                    // 영문 이름이면 한글 음역(name_kor)만 hover title + 인라인. name2는 직원 별칭용이라 음역 fallback으로 쓰지 않음.
                    const _cust = s.custId ? (data?.customers||[]).find(c=>c.id===s.custId) : null;
                    const _nm = s.custName || "";
                    const _isEn = _nm && !/[가-힣]/.test(_nm);
                    const _kor = _cust?.nameKor || _cust?.name_kor || "";
                    const _korPure = _kor && /[가-힣]/.test(_kor) && !/[A-Za-z]/.test(_kor) ? _kor : "";
                    const _title = _isEn && _korPure ? _korPure : undefined;
                    return <td style={{fontWeight:T.fw.bold}}>
                      {s.custGender && <span style={{...sx.genderBadge(s.custGender),marginRight:4}}>{s.custGender==="M"?"남":"여"}</span>}
                      <span title={_title}
                        onClick={s.custId ? (e)=>{e.stopPropagation(); goToCustomer(s.custId);} : undefined}
                        style={s.custId ? {color:T.primary,textDecoration:"underline",textDecorationColor:T.primary+"55",cursor:"pointer"} : undefined}>{_nm||"-"}</span>
                      {_title && <span style={{marginLeft:4,fontSize:T.fs.xxs,color:T.textSub}}>({_title})</span>}
                      {(() => {
                        const cs = consentRowMap[s.id];
                        if (!cs) return null;
                        // 노트 아이콘 1개로 3상태: 미발송=회색+금지 / 발송됨=무색(기본) / 작성완료=푸른색
                        const cfg = cs.state==='done' ? {c:"#2563eb", t:"동의서 작성 완료 (클릭하여 보기)", ban:false}
                          : cs.state==='sent' ? {c:T.text, t:"동의서 발송됨 · 미작성", ban:false}
                          : {c:"#c7ccd1", t:"동의서 미발송 (링크 안 보냄)", ban:true};
                        return <span title={cfg.t}
                          onClick={cs.url ? (e)=>{e.stopPropagation(); window.open(cs.url,"_blank","noopener");} : undefined}
                          style={{position:"relative",display:"inline-flex",alignItems:"center",marginLeft:6,verticalAlign:"middle",cursor:cs.url?"pointer":"default"}}>
                          <I name="fileText" size={14} color={cfg.c}/>
                          {cfg.ban && <svg width="11" height="11" viewBox="0 0 24 24" style={{position:"absolute",right:-4,bottom:-3}}>
                            <circle cx="12" cy="12" r="9" fill="#fff" stroke="#c0392b" strokeWidth="2.6"/>
                            <line x1="6" y1="6" x2="18" y2="18" stroke="#c0392b" strokeWidth="2.6"/>
                          </svg>}
                        </span>;
                      })()}
                    </td>;
                  })()}
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{s.staffName||"-"}</td>
                  <td style={{fontWeight:T.fw.black,color:T.info,textAlign:"right"}}>{fmt(total)}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.primary,textAlign:"right"}}>{sv>0?fmt(sv):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.info,textAlign:"right"}}>{prDisp>0?fmt(prDisp):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowCash>0?"#16a34a":T.gray400,textAlign:"right"}}>{rowCash>0?fmt(rowCash):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowCard>0?T.primary:T.gray400,textAlign:"right"}}>{rowCard>0?fmt(rowCard):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowTransfer>0?T.info:T.gray400,textAlign:"right"}}>{rowTransfer>0?fmt(rowTransfer):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:rowPoint>0?T.orange:T.gray400,textAlign:"right"}}>{rowPoint>0?fmt(rowPoint):"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:(s.externalPrepaid||0)>0?"#8E24AA":T.gray400,textAlign:"right"}} title={s.externalPlatform||""}>
                    {(s.externalPrepaid||0)>0 ? fmt(s.externalPrepaid) : "-"}
                  </td>
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
                      {((s.svcComped||0)+(s.prodComped||0))>0 && <PaySummary label="🎁 체험단" val={(s.svcComped||0)+(s.prodComped||0)} color="#E65100"/>}
                      {(s.externalPrepaid||0)>0 && <PaySummary label={`${s.externalPlatform||"외부"} 선결제`} val={s.externalPrepaid} color={(s.externalPlatform==="네이버")?"#03C75A":"#8E24AA"}/>}
                      {(s.gift||0)>0 && (s.externalPrepaid||0)===0 && <PaySummary label="네이버예약금(legacy)" val={s.gift} color="#03C75A"/>}
                      {s.custPhone && <span style={{fontSize:T.fs.xxs,color:T.primary,marginLeft:"auto"}}>{s.custPhone}</span>}
                      {s.createdAt && <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>
                        {new Date(s.createdAt).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
                      </span>}
                    </div>
                    {/* 상세 2단: 왼쪽 관리내역+시술상세 / 오른쪽 메모 */}
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                    <div style={{flex:"1 1 380px",minWidth:300,display:"flex",flexDirection:"column",gap:8}}>
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
                          <tbody>{(()=>{
                            const RED = T.danger||"#dc2626";
                            // 할인/보유권/이벤트 등은 맨 아래로, 그 외엔 매출등록 입력순(service_no)
                            const TRAIL = new Set(['discount','event_discount','coupon_discount','event_earn','coupon_earn','pkg_use','pkg_deduct','share_surcharge']);
                            const isTrail = (d) => TRAIL.has(d.item_kind) || (!d.item_kind && /^\[/.test(d.service_name||''));
                            const isDiscount = (d) => ['discount','event_discount','coupon_discount'].includes(d.item_kind) || (!d.item_kind && /할인\]/.test(d.service_name||''));
                            const sorted = [...details].sort((a,b)=>{
                              const ta=isTrail(a)?1:0, tb=isTrail(b)?1:0;
                              if(ta!==tb) return ta-tb;
                              return (a.service_no||0)-(b.service_no||0);
                            });
                            const rows = sorted.map((d,di)=>{
                              const disc = isDiscount(d);
                              const amt = d.unit_price||0;
                              return <tr key={d.id||di} style={{borderTop:"1px solid "+T.border}}>
                                <td style={{padding:"4px 8px",color:disc?RED:T.text}}>
                                  {d.service_name||"-"}
                                  {d.sex_div && <span style={{fontSize:T.fs.nano,marginLeft:4,color:d.sex_div==="M"?T.male:d.sex_div==="F"?T.female:T.textMuted}}>
                                    ({d.sex_div==="M"?"남":d.sex_div==="F"?"여":d.sex_div})
                                  </span>}
                                </td>
                                <td style={{padding:"4px 8px",textAlign:"right",fontWeight:T.fw.bold,color:disc?RED:T.text}}>{amt>0?(disc?`-${fmt(amt)}`:fmt(amt)):"-"}</td>
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
                                    style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:RED,fontSize:T.fs.xs,lineHeight:1}}>
                                    🗑
                                  </button>
                                </td>
                              </tr>;
                            });
                            // 시술 합계 · 제품 합계 (매출 행과 동일 기준)
                            rows.push(
                              <tr key="_sumSvc" style={{borderTop:"2px solid "+T.border,background:T.gray100}}>
                                <td style={{padding:"5px 8px",fontWeight:T.fw.bolder,color:T.textSub}}>시술 합계</td>
                                <td style={{padding:"5px 8px",textAlign:"right",fontWeight:T.fw.black,color:T.primary}}>{fmt(sv)}</td>
                                <td/><td/>
                              </tr>,
                              <tr key="_sumProd" style={{background:T.gray100}}>
                                <td style={{padding:"5px 8px",fontWeight:T.fw.bolder,color:T.textSub}}>제품 합계</td>
                                <td style={{padding:"5px 8px",textAlign:"right",fontWeight:T.fw.black,color:T.info}}>{fmt(prDisp)}</td>
                                <td/><td/>
                              </tr>
                            );
                            return rows;
                          })()}
                          </tbody>
                        </table>
                      </div>;
                    })()}
                    </div>{/* /왼쪽 컬럼 */}
                    {/* 메모 — 상세 페이지 전용, 편집 가능 (오른쪽 컬럼) */}
                    <div style={{flex:"1 1 280px",minWidth:260,padding:"8px 12px",background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,alignSelf:"stretch"}}>
                      <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:4}}>📝 메모</div>
                      {editMemoId===s.id ? (
                        <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          <textarea value={editMemoText} onChange={e=>{
                              setEditMemoText(e.target.value);
                              const ta=e.target; ta.style.height="auto"; ta.style.height=Math.max(120, ta.scrollHeight+2)+"px";
                            }} autoFocus
                            ref={el=>{ if(el && el.style.height==="auto") return; if(el){ el.style.height="auto"; el.style.height=Math.max(120, el.scrollHeight+2)+"px"; } }}
                            style={{width:"100%",boxSizing:"border-box",fontSize:T.fs.xs,padding:"8px 10px",borderRadius:6,border:"1.5px solid "+T.primary,fontFamily:"inherit",lineHeight:1.5,resize:"vertical",overflow:"hidden"}}
                            onKeyDown={e=>{if(e.key==="Escape")setEditMemoId(null); if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveMemo(s.id);}}}/>
                          <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                            <Btn variant="secondary" size="sm" onClick={()=>setEditMemoId(null)}>취소</Btn>
                            <Btn size="sm" onClick={()=>saveMemo(s.id)}>💾 저장 (Ctrl+Enter)</Btn>
                          </div>
                        </div>
                      ) : (
                        <div onClick={()=>{setEditMemoId(s.id);setEditMemoText(s.memo||"");}}
                          style={{fontSize:T.fs.xs,color:s.memo?T.text:T.gray400,whiteSpace:"pre-wrap",lineHeight:1.5,cursor:"pointer",minHeight:20}}
                          title="클릭하여 편집">{s.memo||"메모 없음 (클릭하여 작성)"}</div>
                      )}
                    </div>{/* /오른쪽 컬럼(메모) */}
                    </div>{/* /상세 2단 */}
                  </div>
                </td></tr>}
              </React.Fragment>;
            })}
            </React.Fragment>;
          });
        })()
        }
      </tbody>
    </DataTable>

    {showModal && (() => {
      // 권한이 1개 지점만 있으면 자동 디폴트 (지점 manager 케이스)
      // 다수 지점(owner/admin)이면 공백 — 사용자가 직접 선택해야 함
      const _defaultBid = (userBranches?.length === 1) ? userBranches[0] : "";
      return <DetailedSaleForm
        key={`sale-form-${formKey}`}
        reservation={{id:genId(),bid:_defaultBid,custId:null,custName:"",custPhone:"",custGender:"",
          staffId:"",serviceId:null,date:todayStr()}}
        branchId={_defaultBid}
        userBranches={userBranches}
        onSubmit={handleSave}
        onClose={()=>_mc(()=>setShowModal(false))} data={data} setData={setData}/>;
    })()}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo:editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))} data={data} setData={setData}
      editMode={true} existingSaleId={editSale.id}
      onCancelSale={async () => {
        await handleDelete(editSale.id);
        _mc(()=>setEditSale(null));
      }}/>}
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
    {custPopupId && <CustDetailPopup custId={custPopupId} data={data} onClose={()=>setCustPopupId(null)} onOpenFull={openFullCustomer}/>}
    {showSettlement && <SettlementModal data={data} userBranches={userBranches} onClose={()=>setShowSettlement(false)} initBranch={vb} initDate={startDate}/>}
  </div>;
}

// ═══════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════
function StatsPage({ data, userBranches, isMaster, role, startDate, endDate, periodKey, setStartDate, setEndDate, setPeriodKey }) {
  const [vb, setVb] = useState("all");
  const dateAnchorRef = React.useRef(null);
  const [showSheet, setShowSheet] = useState(false);
  // 매출통계는 권한 무관 전 지점 표시 (userBranches 무시)
  const allBids = (data?.branches || []).map(b => b.id);
  // 전체 기간 매월/매년 — RPC로 DB에서 직접 집계 (메모리의 90일 한계 회피)
  const [allTimeStats, setAllTimeStats] = useState({ monthly: [], yearly: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setAllTimeStats(p => ({...p, loading: true}));
    const body = JSON.stringify({ p_biz_id: _activeBizId, p_bid: vb === "all" ? null : vb });
    const opt = { method:'POST', headers:{...sbHeaders, 'Content-Type':'application/json'}, body };
    Promise.all([
      fetch(`${SB_URL}/rest/v1/rpc/get_sales_monthly`, opt).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${SB_URL}/rest/v1/rpc/get_sales_yearly`, opt).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([mj, yj]) => {
      if (cancelled) return;
      setAllTimeStats({ monthly: Array.isArray(mj) ? mj : [], yearly: Array.isArray(yj) ? yj : [], loading: false });
    });
    return () => { cancelled = true; };
  }, [vb]);

  // 연도×월 매출 피벗 (연도별 월별 비교표) — 최근 3개 연도
  const yoyTable = useMemo(() => {
    const byYM = {}; const years = new Set();
    (allTimeStats.monthly || []).forEach(r => {
      const p = (r.ym || '').split('-'); const y = +p[0], m = +p[1];
      if (!y || !m) return;
      years.add(y); (byYM[y] = byYM[y] || {})[m] = Number(r.total || 0);
    });
    return { years: [...years].sort((a,b)=>b-a), byYM }; // 최신 연도 왼쪽 + 전체 연도(가로 스크롤)
  }, [allTimeStats.monthly]);

  // 월별 고객 추이 (기존 o / 신규 n / 외국인신규 fn) — get_customer_visit_trend
  const [custTrend, setCustTrend] = useState([]);
  useEffect(() => {
    let c = false;
    fetch(`${SB_URL}/rest/v1/rpc/get_customer_visit_trend`, {
      method:'POST', headers:{...sbHeaders, 'Content-Type':'application/json'},
      body: JSON.stringify({ p_biz_id: _activeBizId, p_months: 120 }),
    }).then(r => r.ok ? r.json() : []).catch(()=>[]).then(j => { if (!c) setCustTrend(Array.isArray(j) ? j : []); });
    return () => { c = true; };
  }, []);

  // 월별 고객수 연도별 비교 (신규 n / 기존 o / 외국인 fn+fo)
  const custYoy = useMemo(() => {
    const byYM = {}; const years = new Set();
    custTrend.forEach(r => {
      const [y,m] = (r.ym||'').split('-').map(Number);
      if (!y || !m) return;
      years.add(y);
      (byYM[y] = byYM[y] || {})[m] = { sin: r.n||0, gi: r.o||0, oi: (r.fn||0)+(r.fo||0) };
    });
    return { years: [...years].sort((a,b)=>b-a), byYM };
  }, [custTrend]);

  // 기간별 매장/매니저/결제수단 합계 — RPC (90일 메모리 한계 회피)
  const [periodSummary, setPeriodSummary] = useState({ totals: null, byBranch: [], byStaff: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setPeriodSummary(p => ({...p, loading: true}));
    const body = JSON.stringify({
      p_biz_id: _activeBizId,
      p_start: (periodKey==="all" || !startDate) ? null : startDate,
      p_end: (periodKey==="all" || !endDate) ? null : endDate,
      p_bid: vb === "all" ? null : vb,
    });
    fetch(`${SB_URL}/rest/v1/rpc/get_sales_stats_summary`, {
      method:'POST', headers:{...sbHeaders, 'Content-Type':'application/json'}, body
    }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
      if (cancelled) return;
      setPeriodSummary({
        totals: j?.totals || null,
        byBranch: j?.byBranch || [],
        byStaff: j?.byStaff || [],
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [vb, periodKey, startDate, endDate]);

  // 기간대비 — 직전 동기간 총매출 (공비서 대비, 증감% 표시용). 전체기간은 비교 대상 없어 null
  const [prevTotal, setPrevTotal] = useState(undefined);
  useEffect(() => {
    if (periodKey === "all" || !startDate || !endDate) { setPrevTotal(null); return; }
    let cancelled = false;
    const s = new Date(startDate), e = new Date(endDate);
    // 진행 중인 기간(이번달 등)은 미래 매출이 없으므로, 비교 대상도 "같은 경과일수"로 맞춤
    // (예: 오늘 6/2면 6/1~6/2 2일치를 5월 전체 30일과 비교하면 -95% 같은 왜곡 발생 → 직전 동일 경과일수와 비교)
    const _today = new Date(); _today.setHours(0,0,0,0);
    const eEff = e > _today ? _today : e;
    const D = Math.max(1, Math.round((eEff - s) / 86400000) + 1);
    const ps = new Date(s); ps.setDate(ps.getDate() - D);
    const pe = new Date(s); pe.setDate(pe.getDate() - 1);
    const fmtD = d => d.toISOString().slice(0,10);
    fetch(`${SB_URL}/rest/v1/rpc/get_sales_stats_summary`, {
      method:'POST', headers:{...sbHeaders,'Content-Type':'application/json'},
      body: JSON.stringify({ p_biz_id:_activeBizId, p_start:fmtD(ps), p_end:fmtD(pe), p_bid: vb==="all"?null:vb }),
    }).then(r => r.ok ? r.json() : null).catch(()=>null).then(j => {
      if (cancelled) return;
      const tt = j?.totals;
      setPrevTotal(tt ? Number(tt.svc_total||0)+Number(tt.prod_total||0)+Number(tt.gift_total||0) : null);
    });
    return () => { cancelled = true; };
  }, [vb, periodKey, startDate, endDate]);

  // 전년 동기간 매출 — 계절성 업종(여름 성수기/겨울 비수기)이라 방향 판단은 전월보다 전년 동월(동기간) 대비가 핵심
  // (진행 중 기간은 같은 경과일수로 작년 동일 구간과 비교)
  const [yoyTotal, setYoyTotal] = useState(undefined); // undefined=미로딩 / null=비교대상없음 / number
  useEffect(() => {
    if (periodKey === "all" || !startDate || !endDate) { setYoyTotal(null); return; }
    let cancelled = false;
    const _today = new Date(); _today.setHours(0,0,0,0);
    const s = new Date(startDate), e = new Date(endDate);
    const eEff = e > _today ? _today : e;
    const ys = new Date(s); ys.setFullYear(ys.getFullYear()-1);
    const ye = new Date(eEff); ye.setFullYear(ye.getFullYear()-1);
    const fmtD = d => d.toISOString().slice(0,10);
    fetch(`${SB_URL}/rest/v1/rpc/get_sales_stats_summary`, {
      method:'POST', headers:{...sbHeaders,'Content-Type':'application/json'},
      body: JSON.stringify({ p_biz_id:_activeBizId, p_start:fmtD(ys), p_end:fmtD(ye), p_bid: vb==="all"?null:vb }),
    }).then(r => r.ok ? r.json() : null).catch(()=>null).then(j => {
      if (cancelled) return;
      const tt = j?.totals;
      setYoyTotal(tt ? Number(tt.svc_total||0)+Number(tt.prod_total||0)+Number(tt.gift_total||0) : null);
    });
    return () => { cancelled = true; };
  }, [vb, periodKey, startDate, endDate]);

  // 월별 전년대비 매출 시리즈 (계절성 + YoY 방향 — AI 컨텍스트용)
  // ※ 진행 중인 당월은 풀먼스 합계가 1~2일치뿐이라 전년 동월 전체와 비교하면 -96% 같은 왜곡 → 완료된 과거 월만 포함
  const monthlyYoY = useMemo(() => {
    const _now = new Date();
    const _curYM = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}`;
    const map = {}; (allTimeStats.monthly||[]).forEach(r => { if (r.ym) map[r.ym] = Number(r.total||0); });
    const yms = Object.keys(map).filter(ym => ym < _curYM).sort();
    return yms.slice(-13).map(ym => {
      const [y,m] = ym.split('-').map(Number);
      const prevYm = `${y-1}-${String(m).padStart(2,'0')}`;
      const cur = map[ym], prev = map[prevYm];
      return { 월: ym, 매출: cur, 전년동월: (prev!=null?prev:null), 전년대비pct: (prev>0 ? Math.round((cur-prev)/prev*100) : null) };
    });
  }, [allTimeStats.monthly]);

  // ── AI 영업·마케팅 분석 (서버 /sales-insight, 수치 바뀔 때만 재생성·캐시) ──
  const [aiInsight, setAiInsight] = useState({ text: "", loading: false, err: false });
  useEffect(() => {
    const _ts = periodSummary.totals;
    if (periodSummary.loading || !_ts) return;
    if (yoyTotal === undefined || prevTotal === undefined) return; // 전년/직전 비교 로딩 완료까지 대기 (불완전 분석이 그날 캐시되는 것 방지)
    const total = Number(_ts.svc_total||0)+Number(_ts.prod_total||0)+Number(_ts.gift_total||0);
    if (total <= 0) { setAiInsight({ text: "", loading: false, err: false }); return; }
    const count = Number(_ts.cnt||0);
    const branchName = (bid) => (data?.branches||[]).find(b=>b.id===bid)?.short || (data?.branches||[]).find(b=>b.id===bid)?.name || bid;
    const branches = (periodSummary.byBranch||[]).map(r=>({지점:branchName(r.bid), 매출:Number(r.total||0), 건수:Number(r.cnt||0)})).sort((a,b)=>b.매출-a.매출).slice(0,8);
    const staff = (periodSummary.byStaff||[]).map(r=>({담당:r.staff_name, 매출:Number(r.total||0), 건수:Number(r.cnt||0)})).sort((a,b)=>b.매출-a.매출).slice(0,8);
    const growth = (prevTotal!=null && prevTotal>0) ? Math.round((total-prevTotal)/prevTotal*100) : null;
    // 기간 진행 상황 — 진행 중인 부분 기간(이번달 등)이면 AI가 월 전체로 오인해 "위기" 단정하지 않도록
    const _today = new Date(); _today.setHours(0,0,0,0);
    let 경과일수 = null, 전체일수 = null, 진행중 = false;
    if (startDate && endDate) {
      const _s = new Date(startDate), _e = new Date(endDate);
      전체일수 = Math.max(1, Math.round((_e-_s)/864e5)+1);
      const _eff = _e > _today ? _today : _e;
      경과일수 = Math.max(1, Math.round((_eff-_s)/864e5)+1);
      진행중 = _e > _today;
    }
    // 전년 동기간 대비 (계절성 업종이라 방향 판단의 핵심 지표)
    const yoyGrowth = (yoyTotal!=null && yoyTotal>0) ? Math.round((total-yoyTotal)/yoyTotal*100) : null;
    // 최근 6개월 고객 추이 (신규/기존/외국인)
    const custRecent = (custTrend||[]).slice(-6).map(r=>({월:r.ym, 신규:r.n||0, 기존:r.o||0, 외국인:(r.fn||0)+(r.fo||0)}));
    const stats = {
      업종특성: "왁싱샵 — 계절성 큼(여름 성수기·겨울 비수기). 방향 판단은 전월 대비보다 전년 동월/동기간 대비 우선.",
      기간진행: { 진행중, 경과일수, 전체일수 },
      총매출: total, 시술매출: Number(_ts.svc_total||0), 제품매출: Number(_ts.prod_total||0), 상품권: Number(_ts.gift_total||0),
      건수: count, 객단가: count>0?Math.round(total/count):0,
      전월대비_성장률_pct: growth,
      전년동기간_매출: (yoyTotal!=null?yoyTotal:null), 전년동기간_대비_성장률_pct: yoyGrowth,
      월별_전년대비: monthlyYoY,
      결제수단: { 현금: Number(_ts.svc_cash||0)+Number(_ts.prod_cash||0), 카드: Number(_ts.svc_card||0)+Number(_ts.prod_card||0), 이체: Number(_ts.svc_transfer||0)+Number(_ts.prod_transfer||0), 포인트: Number(_ts.svc_point||0)+Number(_ts.prod_point||0) },
      지점별: branches, 담당자별: staff, 최근6개월_고객추이: custRecent,
    };
    const scopeKey = `${vb}|${periodKey}|${startDate||""}|${endDate||""}`;
    const sj = JSON.stringify(stats);
    let h = 0; for (let i=0;i<sj.length;i++){ h=(h*31+sj.charCodeAt(i))|0; }
    const statsHash = String(h);
    let cancelled = false;
    setAiInsight(p => ({ ...p, loading: true, err: false }));
    fetch("https://blissme.ai/sales-insight", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: _activeBizId, scope_key: scopeKey, stats_hash: statsHash, label: dateLabel, stats }),
    }).then(r => r.json()).then(j => {
      if (cancelled) return;
      if (j && j.ok && j.insight) setAiInsight({ text: j.insight, loading: false, err: false });
      else setAiInsight({ text: "", loading: false, err: true });
    }).catch(() => { if (!cancelled) setAiInsight({ text: "", loading: false, err: true }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vb, periodKey, startDate, endDate, periodSummary.totals, periodSummary.loading, prevTotal, yoyTotal, monthlyYoY, custTrend]);

  // 지점별 신규고객 (외국인 구분) — 기간 내 첫 매출 기준
  const [newByBranch, setNewByBranch] = useState([]);
  useEffect(() => {
    if (!isMaster || periodKey === 'all' || !startDate || !endDate) { setNewByBranch([]); return; }
    let cancelled = false;
    fetch(`${SB_URL}/rest/v1/rpc/get_new_customers_by_branch`, {
      method: 'POST', headers: {...sbHeaders, 'Content-Type':'application/json'},
      body: JSON.stringify({ p_biz: _activeBizId, p_start: startDate, p_end: endDate }),
    }).then(r => r.ok ? r.json() : []).catch(()=>[]).then(j => {
      if (!cancelled) setNewByBranch(Array.isArray(j) ? j : []);
    });
    return () => { cancelled = true; };
  }, [vb, periodKey, startDate, endDate, isMaster]);

  // 외국인 통계 (예약등록일 기준 신규/기존)
  const [foreignStats, setForeignStats] = useState({ rows: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setForeignStats(p => ({...p, loading: true}));
    // 기간 fallback: periodKey='all' 또는 미설정이면 최근 90일
    const today = new Date();
    const _end = (periodKey==="all" || !endDate) ? today.toISOString().slice(0,10) : endDate;
    const _startBase = new Date(today); _startBase.setDate(_startBase.getDate()-90);
    const _start = (periodKey==="all" || !startDate) ? _startBase.toISOString().slice(0,10) : startDate;
    fetch(`${SB_URL}/rest/v1/rpc/get_foreign_stats`, {
      method:'POST', headers:{...sbHeaders,'Content-Type':'application/json'},
      body: JSON.stringify({ p_biz_id: _activeBizId, p_start: _start, p_end: _end }),
    }).then(r => r.ok ? r.json() : []).catch(() => []).then(j => {
      if (cancelled) return;
      let rows = Array.isArray(j) ? j : [];
      if (vb !== "all") rows = rows.filter(r => r.bid === vb);
      setForeignStats({ rows, loading: false });
    });
    return () => { cancelled = true; };
  }, [vb, periodKey, startDate, endDate]);

  // CSV 다운로드 (Excel 호환 — UTF-8 BOM 포함)
  const downloadForeignCSV = () => {
    const rows = foreignStats.rows || [];
    if (!rows.length) { alert('다운로드할 외국인 통계가 없습니다.'); return; }
    const months = [...new Set(rows.map(r => r.month))].sort();
    const branches = [...new Set(rows.map(r => r.branch_short))];
    const header = ['지점', ...months.flatMap(m => [`${m} 신규`, `${m} 기존`, `${m} 합계`])];
    const lines = [header.join(',')];
    branches.forEach(br => {
      const cells = [br];
      months.forEach(m => {
        const r = rows.find(x => x.branch_short === br && x.month === m) || { new_cnt:0, returning_cnt:0, total_cnt:0 };
        cells.push(r.new_cnt, r.returning_cnt, r.total_cnt);
      });
      lines.push(cells.join(','));
    });
    // 합계 row
    const totalCells = ['전체'];
    months.forEach(m => {
      const monthRows = rows.filter(x => x.month === m);
      totalCells.push(
        monthRows.reduce((s,r)=>s+(r.new_cnt||0),0),
        monthRows.reduce((s,r)=>s+(r.returning_cnt||0),0),
        monthRows.reduce((s,r)=>s+(r.total_cnt||0),0),
      );
    });
    lines.push(totalCells.join(','));
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `외국인통계_${months[0]||''}_${months[months.length-1]||''}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 만 단위 한국식 간략 표시 (예: 22억4천, 5천8백만, 748만)
  const fmtKMan = (n) => {
    n = Math.round(Number(n)||0);
    if (!n) return '0';
    const sign = n < 0 ? '-' : ''; n = Math.abs(n);
    const eok = Math.floor(n / 100000000);
    const man = Math.floor((n % 100000000) / 10000);
    if (eok > 0) {
      const cheon = Math.floor(man / 1000);
      if (cheon > 0) return `${sign}${eok}억${cheon}천`;
      return `${sign}${eok}억`;
    }
    if (man >= 1000) {
      const cheon = Math.floor(man / 1000);
      const baek = Math.floor((man % 1000) / 100);
      if (baek > 0) return `${sign}${cheon}천${baek}백만`;
      return `${sign}${cheon}천만`;
    }
    if (man > 0) return `${sign}${man}만`;
    return `${sign}${n.toLocaleString()}`;
  };

  // 매월/매년 차트 ref — mount/data 변경 시 끝(최신)으로 자동 스크롤
  const monthlyScrollRef = React.useRef(null);
  const yearlyScrollRef = React.useRef(null);
  useEffect(() => {
    if (monthlyScrollRef.current) monthlyScrollRef.current.scrollLeft = monthlyScrollRef.current.scrollWidth;
    if (yearlyScrollRef.current) yearlyScrollRef.current.scrollLeft = yearlyScrollRef.current.scrollWidth;
  }, [allTimeStats.monthly, allTimeStats.yearly]);
  // 기간 길이로 차트 단위 자동 결정 — 60일↓ 일별, 365일↓ 월별, 그 외 연도별
  // 전체(all) 선택 시 매출 데이터의 실제 범위(첫 매출 ~ 오늘)로 판단
  const statsPeriod = (() => {
    let totalDays;
    if (periodKey === "all" || !startDate || !endDate) {
      const allSales = (data?.sales || []).filter(s => (vb==="all" ? allBids.includes(s.bid) : s.bid===vb));
      const dates = allSales.map(s => s.date).filter(Boolean).sort();
      if (dates.length < 2) return "day";
      const first = new Date(dates[0]);
      const last = new Date(dates[dates.length-1]);
      totalDays = Math.round((last - first) / 86400000) + 1;
    } else {
      const ds = new Date(startDate); const de = new Date(endDate);
      totalDays = Math.round((de - ds) / 86400000) + 1;
    }
    if (totalDays > 365) return "year";
    if (totalDays > 60) return "month";
    return "day";
  })();

  // 기간 범위 계산 (매출관리와 동일한 로직)
  const inRange = (date) => {
    if (periodKey==="all" || (!startDate && !endDate)) return true;
    if (startDate && endDate) return date >= startDate && date <= endDate;
    return true;
  };

  const filtered = (data?.sales||[]).filter(s => {
    if (!((vb==="all"?allBids.includes(s.bid):s.bid===vb))) return false;
    return inRange(s.date);
  });

  // totals — RPC 기반 (전체 기간이라도 정확). RPC 응답 전엔 빈값.
  const _ts = periodSummary.totals || {};
  const t = {
    svcTotal: Number(_ts.svc_total||0),
    prodTotal: Number(_ts.prod_total||0),
    gift: Number(_ts.gift_total||0),
    extPrepaid: Number(_ts.ext_prepaid||0),
    total: Number(_ts.svc_total||0)+Number(_ts.prod_total||0)+Number(_ts.gift_total||0),
    count: Number(_ts.cnt||0),
    svcCash: Number(_ts.svc_cash||0),
    svcTransfer: Number(_ts.svc_transfer||0),
    svcCard: Number(_ts.svc_card||0),
    svcPoint: Number(_ts.svc_point||0),
    prodCash: Number(_ts.prod_cash||0),
    prodTransfer: Number(_ts.prod_transfer||0),
    prodCard: Number(_ts.prod_card||0),
    prodPoint: Number(_ts.prod_point||0),
  };

  // 일수 (일평균) — RPC days(매출 발생 일수) 우선, 없으면 기간 길이
  const days = (()=>{
    if (Number(_ts.days||0) > 0) return Math.max(1, Number(_ts.days));
    if (periodKey==="all" || !startDate || !endDate) return 1;
    const s = new Date(startDate); const e = new Date(endDate);
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
  })();

  // By staff — RPC 기반 (90일 메모리 한계 회피, 기간 정확)
  const staffRank = (periodSummary.byStaff || [])
    .map(r => [r.staff_name, { count: Number(r.cnt||0), total: Number(r.total||0) }])
    .sort((a,b) => b[1].total - a[1].total);

  // By branch — RPC 기반
  const branchRank = isMaster ? (periodSummary.byBranch || [])
    .map(r => {
      const bn = (data.branches||[]).find(b=>b.id===r.bid)?.short || r.bid;
      return [bn, { count: Number(r.cnt||0), total: Number(r.total||0) }];
    })
    .sort((a,b) => b[1].total - a[1].total) : [];

  // Chart data — statsPeriod에 따라 일별/월별/연도별 집계 (전체 매출 사용 — 기간 필터 무시)
  // 일별: 선택 기간 내 또는 최근 31일
  // 월별: 선택 기간 또는 전체 매출의 월별 (최대 24개월)
  // 연도별: 전체 매출의 연도별
  const chartDays = (() => {
    const allSales = (data?.sales || []).filter(s => (vb==="all" ? allBids.includes(s.bid) : s.bid===vb));
    const sumOf = (arr) => arr.reduce((a,s) => ({
      // 정책일 이후 매출은 포인트 제외
      svc: a.svc + s.svcCash+s.svcTransfer+s.svcCard+(s.svcPoint-exclPt(s,s.svcPoint))+(s.externalPrepaid||0),
      prod: a.prod + s.prodCash+s.prodTransfer+s.prodCard+(s.prodPoint-exclPt(s,s.prodPoint)),
    }), {svc:0, prod:0});

    if (statsPeriod === "day") {
      const out = [];
      let chartStart, chartEnd;
      if (periodKey==="all" || !startDate || !endDate) {
        chartEnd = new Date();
        chartStart = new Date(); chartStart.setDate(chartStart.getDate()-6);
      } else {
        chartStart = new Date(startDate);
        chartEnd = new Date(endDate);
        const totalDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
        if (totalDays > 31) chartStart = new Date(chartEnd.getTime() - 30*86400000);
      }
      const cur = new Date(chartStart);
      while (cur <= chartEnd) {
        const ds = fmtLocal(cur);
        const {svc, prod} = sumOf(allSales.filter(s => s.date === ds));
        out.push({ label:`${cur.getMonth()+1}/${cur.getDate()}`, svc, prod, total: svc+prod });
        cur.setDate(cur.getDate()+1);
      }
      return out;
    }

    if (statsPeriod === "month") {
      // 기간 지정 시 그 기간의 월들, 전체면 최근 12개월
      let from, to;
      if (periodKey==="all" || !startDate || !endDate) {
        to = new Date(); from = new Date(to.getFullYear(), to.getMonth()-11, 1);
      } else {
        from = new Date(startDate); to = new Date(endDate);
      }
      const out = [];
      const cur = new Date(from.getFullYear(), from.getMonth(), 1);
      const endY = to.getFullYear(), endM = to.getMonth();
      while (cur.getFullYear() < endY || (cur.getFullYear() === endY && cur.getMonth() <= endM)) {
        const y = cur.getFullYear(); const m = cur.getMonth();
        const ym = `${y}-${String(m+1).padStart(2,'0')}`;
        const {svc, prod} = sumOf(allSales.filter(s => (s.date||"").startsWith(ym)));
        out.push({ label: `${y%100}.${m+1}월`, svc, prod, total: svc+prod });
        cur.setMonth(cur.getMonth()+1);
      }
      // 최근 24개월로 제한
      return out.slice(-24);
    }

    // year
    const byYear = new Map();
    allSales.forEach(s => {
      const y = (s.date||"").slice(0,4);
      if (!y) return;
      if (!byYear.has(y)) byYear.set(y, {svc:0, prod:0});
      const r = byYear.get(y);
      r.svc += s.svcCash+s.svcTransfer+s.svcCard+(s.svcPoint-exclPt(s,s.svcPoint))+(s.externalPrepaid||0);  // 정책일 이후 포인트 제외
      r.prod += s.prodCash+s.prodTransfer+s.prodCard+(s.prodPoint-exclPt(s,s.prodPoint));
    });
    return Array.from(byYear.entries())
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([y, v]) => ({ label: `${y}년`, svc:v.svc, prod:v.prod, total:v.svc+v.prod }));
  })();
  const maxChart = Math.max(...chartDays.map(d=>d.total),1);

  // 전체 기간 매월/매년 차트 — RPC 응답 기반 (DB GROUP BY)
  const monthlyAll = (allTimeStats.monthly || []).map(r => ({
    label: `${String(r.ym).slice(2,4)}.${Number(String(r.ym).slice(5))}월`,
    svc: Number(r.svc_total||0),
    prod: Number(r.prod_total||0),
    total: Number(r.total||0),
  }));
  const yearlyAll = (allTimeStats.yearly || []).map(r => ({
    label: `${r.year}년`,
    svc: Number(r.svc_total||0),
    prod: Number(r.prod_total||0),
    total: Number(r.total||0),
  }));
  const maxMonthly = Math.max(...monthlyAll.map(d=>d.total),1);
  const maxYearly = Math.max(...yearlyAll.map(d=>d.total),1);

  const fmtShortDate = (ds) => { if(!ds) return ""; const [,m,d] = ds.split("-"); return `${Number(m)}.${Number(d)}`; };
  const dateLabel = periodKey==="all" ? "전체"
    : (periodKey==="1day"||startDate===endDate) ? fmtShortDate(startDate)
    : `${fmtShortDate(startDate)} ~ ${fmtShortDate(endDate)}`;

  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 통계</h2>
      <div style={{display:"flex",gap:T.sp.sm,alignItems:"center"}}>
        {<select className="inp" style={{maxWidth:150,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        <button ref={dateAnchorRef} onClick={()=>setShowSheet(true)}
          style={{height:36,borderRadius:T.radius.md,border:"1px solid "+T.primary+"44",background:T.primaryHover,
                  fontSize:T.fs.sm,padding:"0 14px",cursor:"pointer",fontFamily:"inherit",color:T.primaryDk,
                  fontWeight:T.fw.bold,display:"flex",alignItems:"center",gap:T.sp.xs,outline:"none",flexShrink:0}}>
          <I name="calendar" size={14} color={T.primary}/>
          <span>{dateLabel}</span>
          <I name="chevD" size={12} color={T.primary}/>
        </button>
      </div>
    </div>
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
    {/* 기간 대비 — 전년 동기간(계절성 업종 주지표) + 직전 동기간(보조) */}
    {((yoyTotal!=null && yoyTotal>0) || (prevTotal!=null && prevTotal>0)) && (
      <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        {yoyTotal!=null && yoyTotal>0 && (() => {
          const _d = Math.round((t.total - yoyTotal) / yoyTotal * 100);
          const _up = _d >= 0;
          return <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:999,background:_up?"#ECFDF5":"#FEF2F2",fontSize:T.fs.sm,fontWeight:T.fw.black,color:_up?"#059669":"#DC2626"}}>
            {_up?"▲":"▼"} 전년 동기간 대비 {Math.abs(_d)}%
            <span style={{color:T.textMuted,fontWeight:T.fw.medium,fontSize:T.fs.xs}}>(작년 {fmt(yoyTotal)}원)</span>
          </div>;
        })()}
        {prevTotal!=null && prevTotal>0 && (() => {
          const _d = Math.round((t.total - prevTotal) / prevTotal * 100);
          const _up = _d >= 0;
          return <div style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:999,background:T.gray100,fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:_up?"#059669":"#DC2626"}}>
            {_up?"▲":"▼"} 직전 동기간 {Math.abs(_d)}%
            <span style={{color:T.textMuted,fontWeight:T.fw.medium}}>(이전 {fmt(prevTotal)}원)</span>
          </div>;
        })()}
      </div>
    )}
    {/* Summary Cards */}
    <GridLayout className="stat-cards" cols="repeat(auto-fit,minmax(160px,1fr))" gap={12} style={{marginBottom:20}}>
      <SC label="총 매출" val={`${fmt(t.total)}원`} sub={`${t.count}건`} clr={T.info}/>
      <SC label="시술 매출" val={`${fmt(t.svcTotal)}원`} sub="시술 합계" clr={T.primary}/>
      <SC label="제품 매출" val={`${fmt(t.prodTotal)}원`} sub="제품 합계" clr={T.info}/>
      <SC label="상품권" val={`${fmt(t.gift)}원`} sub="상품권 합계" clr={T.danger}/>
      <SC label="일 평균" val={`${fmt(Math.round(t.total/days))}원`} sub={`${days}일 평균`} clr={T.info}/>
      <SC label="객단가" val={`${fmt(t.count>0?Math.round(t.total/t.count):0)}원`} sub="건당 평균" clr={T.gray400}/>
    </GridLayout>
    {/* AI 영업·마케팅 분석 */}
    {(aiInsight.loading || aiInsight.text) && (
      <div style={{marginBottom:20,padding:"14px 16px",borderRadius:T.radius.lg,background:"linear-gradient(135deg,#F5F3FF 0%,#EEF2FF 100%)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:aiInsight.text?10:0}}>
          <I name="sparkles" size={15} color={T.primary}/>
          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.primary}}>AI 영업·마케팅 분석</span>
          {aiInsight.loading && <span style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.medium}}>분석 중…</span>}
        </div>
        {aiInsight.text && <div style={{fontSize:13,lineHeight:1.7,color:T.text,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{aiInsight.text.replace(/\*\*/g,"")}</div>}
      </div>
    )}
    {/* 연도별 월별 매출 비교 */}
    {yoyTable.years.length >= 2 && <div className="card" style={{padding:16,marginBottom:16,overflowX:"auto"}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:12}}>월별 매출 비교 <span style={{fontWeight:T.fw.medium,color:T.textMuted,fontSize:T.fs.xs}}>(연도별)</span></div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:T.fs.xs}}>
        <thead><tr>
          <th style={{textAlign:"left",padding:"6px 8px",color:T.textSub,fontWeight:T.fw.bolder,position:"sticky",left:0,background:T.bgCard,zIndex:1,minWidth:44}}>월</th>
          {yoyTable.years.map(y=><th key={y} style={{textAlign:"right",padding:"6px 8px",color:T.textSub,fontWeight:T.fw.bolder,whiteSpace:"nowrap",minWidth:96}}>{String(y).slice(2)}년</th>)}
        </tr></thead>
        <tbody>
          {Array.from({length:12},(_,i)=>i+1).map(m=>{
            const vals = yoyTable.years.map(y=>yoyTable.byYM[y]?.[m]);
            if (vals.every(v=>v==null)) return null;
            return <tr key={m} style={{borderTop:`1px solid ${T.border}`}}>
              <td style={{padding:"6px 8px",fontWeight:T.fw.bold,color:T.textSub,position:"sticky",left:0,background:T.bgCard,zIndex:1}}>{m}월</td>
              {yoyTable.years.map((y,yi)=>{
                const v=vals[yi];
                const prevV=yoyTable.byYM[y-1]?.[m];   // 전년 동월
                const _gr=(cur)=>{
                  if (!cur || !prevV || prevV<=0) return null;
                  const g=Math.round((cur-prevV)/prevV*100);
                  return <span style={{fontSize:9,marginLeft:3,fontWeight:T.fw.medium,color:g>=0?"#e2231a":"#1565d8"}}>({g>=0?"+":""}{g}%)</span>;
                };
                const _now=new Date();
                const _isCur=(y===_now.getFullYear() && m===(_now.getMonth()+1));
                if (_isCur && v>0) {
                  const _el=_now.getDate(), _tot=new Date(y,m,0).getDate();
                  const _proj=Math.round(v/_el*_tot);
                  return <td key={y} title={`현재 ${fmt(v)}원 · 일평균×${_tot}일 예상`} style={{textAlign:"right",padding:"6px 8px",whiteSpace:"nowrap",fontWeight:T.fw.bolder,color:T.primary}}>{fmt(_proj)}<span style={{fontSize:9,color:T.primary,marginLeft:2,fontWeight:T.fw.medium}}>예상</span>{_gr(_proj)}</td>;
                }
                return <td key={y} style={{textAlign:"right",padding:"6px 8px",whiteSpace:"nowrap",fontWeight:v?T.fw.bolder:T.fw.medium,color:v?T.text:T.gray400}}>{v?fmt(v):"-"}{_gr(v)}</td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
    {/* 월별 고객수 비교 (신규/기존/외국인) */}
    {custYoy.years.length >= 1 && custTrend.length > 0 && <div className="card" style={{padding:16,marginBottom:16,overflowX:"auto"}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:4}}>월별 고객수 비교 <span style={{fontWeight:T.fw.medium,color:T.textMuted,fontSize:T.fs.xs}}>(연도별 · 매출발생 기준)</span></div>
      <div style={{display:"flex",gap:10,fontSize:T.fs.xxs,marginBottom:10}}>
        <span style={{color:T.textSub}}><span style={{display:"inline-block",width:8,height:8,background:T.primary,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>신규</span>
        <span style={{color:T.textSub}}><span style={{display:"inline-block",width:8,height:8,background:T.gray400,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>기존</span>
        <span style={{color:T.textSub}}><span style={{display:"inline-block",width:8,height:8,background:T.orange,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>외국인</span>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:T.fs.xs}}>
        <thead><tr>
          <th style={{textAlign:"left",padding:"6px 8px",color:T.textSub,fontWeight:T.fw.bolder,position:"sticky",left:0,background:T.bgCard,zIndex:1,minWidth:40}}>월</th>
          {custYoy.years.map(y=><th key={y} style={{textAlign:"right",padding:"6px 8px",color:T.textSub,fontWeight:T.fw.bolder,whiteSpace:"nowrap",minWidth:104}}>{String(y).slice(2)}년</th>)}
        </tr></thead>
        <tbody>
          {Array.from({length:12},(_,i)=>i+1).map(m=>{
            const vals = custYoy.years.map(y=>custYoy.byYM[y]?.[m]);
            if (vals.every(v=>v==null)) return null;
            return <tr key={m} style={{borderTop:`1px solid ${T.border}`}}>
              <td style={{padding:"6px 8px",fontWeight:T.fw.bold,color:T.textSub,position:"sticky",left:0,background:T.bgCard,zIndex:1,verticalAlign:"top"}}>{m}월</td>
              {custYoy.years.map((y,yi)=>{
                const v=vals[yi];
                if (!v) return <td key={y} style={{textAlign:"right",padding:"6px 8px",color:T.gray400,verticalAlign:"top"}}>-</td>;
                const prev=custYoy.byYM[y-1]?.[m];
                const _row=(cur,pv,clr)=>{
                  let pct=null;
                  if (pv>0){ const g=Math.round((cur-pv)/pv*100); pct=<span style={{fontSize:9,marginLeft:2,fontWeight:T.fw.medium,color:g>=0?"#e2231a":"#1565d8"}}>({g>=0?"+":""}{g}%)</span>; }
                  return <div style={{whiteSpace:"nowrap"}}><span style={{display:"inline-block",width:7,height:7,background:clr,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/><b style={{color:T.text}}>{cur}</b>{pct}</div>;
                };
                return <td key={y} style={{textAlign:"right",padding:"6px 8px",whiteSpace:"nowrap",verticalAlign:"top"}}>
                  {_row(v.sin, prev?.sin, T.primary)}
                  {_row(v.gi, prev?.gi, T.gray400)}
                  {_row(v.oi, prev?.oi, T.orange)}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
    {/* Chart */}
    <div className="card" style={{padding:20,marginBottom:16}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:16}}>
        {statsPeriod==="day"?`${chartDays.length}일`:statsPeriod==="month"?`${chartDays.length}개월`:`${chartDays.length}년`} 매출 (시술 + 제품)
        <span style={{marginLeft:8,fontSize:11,fontWeight:500,color:T.gray400}}>
          · 기간에 따라 자동 {statsPeriod==="day"?"일별":statsPeriod==="month"?"월별":"연도별"} 표시
        </span>
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:130}}>
        {chartDays.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:T.sp.xs}}>
            <span style={{fontSize:T.fs.nano,color:T.textSub}}>{d.total>0?`${fmt(Math.round(d.total/10000))}만`:""}</span>
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:1}}>
              <div style={{width:"100%",height:`${Math.max((d.prod/maxChart)*80,0)}px`,background:T.info,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
              <div style={{width:"100%",height:`${Math.max((d.svc/maxChart)*80,2)}px`,background:T.primary,borderRadius:"0 0 4px 4px",transition:"height .3s"}}/>
            </div>
            <span style={{fontSize:T.fs.xs,color:T.gray500}}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:T.sp.md,justifyContent:"center",marginTop:10}}>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.primary}}/>시술</span>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.info}}/>제품</span>
      </div>
    </div>
    {/* 전체 기간 매월 매출 — 단일 막대(총합), 우측이 최신, 자동 우측 스크롤 */}
    {monthlyAll.length > 0 && <div className="card" style={{padding:"18px 20px 14px",marginBottom:16,overflow:"hidden"}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>
        전체 기간 매월 매출 ({monthlyAll.length}개월)
        <span style={{marginLeft:8,fontSize:11,fontWeight:500,color:T.gray400}}>· 시작 매출월부터 현재까지 · 우측이 최신</span>
      </div>
      <div ref={monthlyScrollRef} style={{display:"flex",alignItems:"flex-end",gap:4,height:160,overflowX:"auto",overflowY:"hidden",paddingTop:18,paddingBottom:4}}>
        {monthlyAll.map((d,i)=>(
          <div key={i} style={{flex:"0 0 auto",minWidth:36,display:"flex",flexDirection:"column",alignItems:"center",gap:T.sp.xs}}>
            <span style={{fontSize:T.fs.nano,color:T.textSub,whiteSpace:"nowrap"}}>{d.total>0?fmtKMan(d.total):""}</span>
            <div style={{width:28,height:`${Math.max((d.total/maxMonthly)*100,2)}px`,background:T.primary,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
            <span style={{fontSize:T.fs.xs,color:T.gray500,whiteSpace:"nowrap"}}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>}
    {/* 전체 기간 매년 매출 — 단일 막대, 우측이 최신 */}
    {yearlyAll.length > 0 && <div className="card" style={{padding:"18px 20px 14px",marginBottom:16,overflow:"hidden"}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>
        전체 기간 매년 매출 ({yearlyAll.length}년)
        <span style={{marginLeft:8,fontSize:11,fontWeight:500,color:T.gray400}}>· 우측이 최신</span>
      </div>
      <div ref={yearlyScrollRef} style={{display:"flex",alignItems:"flex-end",gap:10,height:170,overflowX:"auto",overflowY:"hidden",paddingTop:22,paddingBottom:4}}>
        {yearlyAll.map((d,i)=>(
          <div key={i} style={{flex:"0 0 auto",minWidth:64,display:"flex",flexDirection:"column",alignItems:"center",gap:T.sp.xs}}>
            <span style={{fontSize:T.fs.xs,color:T.textSub,fontWeight:T.fw.bolder,whiteSpace:"nowrap"}}>{d.total>0?fmtKMan(d.total):""}</span>
            <div style={{width:50,height:`${Math.max((d.total/maxYearly)*110,2)}px`,background:T.primary,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
            <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>}
    <GridLayout className="stat-charts" cols="repeat(auto-fit,minmax(300px,1fr))" gap={16}>
      {/* Payment Breakdown */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>결제수단별 시술 매출</div>
        {[["현금",t.svcCash,T.info],["입금",t.svcTransfer,T.danger],["카드",t.svcCard,T.primary],["포인트",t.svcPoint,T.gray400],["외부선결제",t.extPrepaid,"#8E24AA"]].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:64,color:c,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>{l}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${t.svcTotal>0?(v/t.svcTotal)*100:0}%`,background:c,borderRadius:T.radius.sm}}/>
            </div>
            <span style={{width:80,textAlign:"right",fontWeight:T.fw.bold}}>{fmt(v)}원</span>
          </div>
        ))}
      </div>
      {/* Staff Rank — 막대 그래프 */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>매니저별 매출</div>
        {staffRank.slice(0,10).map(([n,v],i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.info:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{width:60,fontWeight:T.fw.bold,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n||"-"}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${staffRank[0][1].total>0?(v.total/staffRank[0][1].total)*100:0}%`,background:"linear-gradient(90deg,#5cb5c5,#3b82f6)",borderRadius:T.radius.sm}}/>
            </div>
            <span style={{color:T.textSub,fontSize:T.fs.xxs,width:32,textAlign:"right"}}>{v.count}건</span>
            <span style={{fontWeight:T.fw.bolder,color:T.info,width:92,textAlign:"right",whiteSpace:"nowrap",flexShrink:0}}>{fmt(v.total)}원</span>
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
            <span style={{fontWeight:T.fw.bolder,width:92,textAlign:"right",whiteSpace:"nowrap",flexShrink:0}}>{fmt(v.total)}원</span>
          </div>
        ))}
      </div>}
      {/* 지점별 신규고객 (외국인 구분) */}
      {isMaster && newByBranch.length > 0 && <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>지점별 신규고객 <span style={{fontWeight:T.fw.medium,color:T.textMuted,fontSize:T.fs.xs}}>( )=외국인</span></div>
        {newByBranch.map((r,i)=>{
          const bn = (data.branches||[]).find(b=>b.id===r.bid)?.short || r.bid;
          const mx = newByBranch[0]?.total || 1;
          return <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.primary:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{width:55,fontWeight:T.fw.bold}}>{bn}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${mx>0?(r.total/mx)*100:0}%`,background:"linear-gradient(90deg,#5cb5c5,#7c7cc8)",borderRadius:T.radius.sm}}/>
            </div>
            <span style={{fontWeight:T.fw.bolder,width:92,textAlign:"right",whiteSpace:"nowrap",flexShrink:0}}>{r.total}명 <span style={{color:T.info,fontWeight:T.fw.medium}}>({r.foreign_cnt})</span></span>
          </div>;
        })}
      </div>}
    </GridLayout>

    {/* 월별 고객 추이 (기존/신규/외국인신규 누적 막대) */}
    {custTrend.length > 0 && (() => {
      const rows = custTrend.slice(0, 13); // 최근 13개월만 (최신→오래된)
      const maxV = Math.max(...rows.map(r=>(r.o||0)+(r.fo||0)+(r.n||0)+(r.fn||0)), 1);
      const H = 120;
      return <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub}}>월별 고객 추이 <span style={{fontWeight:T.fw.medium,color:T.textMuted,fontSize:T.fs.xs}}>(최근 13개월)</span></div>
          <div style={{display:"flex",gap:12,fontSize:T.fs.xxs}}>
            <span style={{color:T.textSub}}><span style={{display:"inline-block",width:9,height:9,background:T.gray400,borderRadius:2,marginRight:4,verticalAlign:"middle"}}/>기존</span>
            <span style={{color:T.textSub}}><span style={{display:"inline-block",width:9,height:9,background:T.primary,borderRadius:2,marginRight:4,verticalAlign:"middle"}}/>신규</span>
            <span style={{color:T.textSub}}><span style={{display:"inline-block",width:9,height:9,background:T.orange,borderRadius:2,marginRight:4,verticalAlign:"middle"}}/>외국인신규</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:5,height:H+30,overflowX:"auto",paddingBottom:14}}>
          {rows.map((r,i)=>{
            const ex=(r.o||0)+(r.fo||0), nw=r.n||0, fnn=r.fn||0;
            return <div key={i} style={{flex:"1 0 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <span style={{fontSize:9,color:T.textSub,fontWeight:T.fw.bold}}>{ex+nw+fnn}</span>
              <div style={{width:"72%",maxWidth:26,display:"flex",flexDirection:"column",justifyContent:"flex-end",height:H}}>
                <div title={`외국인신규 ${fnn}`} style={{height:`${fnn/maxV*H}px`,background:T.orange,borderRadius:"2px 2px 0 0"}}/>
                <div title={`신규 ${nw}`} style={{height:`${nw/maxV*H}px`,background:T.primary}}/>
                <div title={`기존 ${ex}`} style={{height:`${ex/maxV*H}px`,background:T.gray400}}/>
              </div>
              <span style={{fontSize:9,color:T.textSub,whiteSpace:"nowrap"}}>{(r.ym||"").slice(2)}</span>
            </div>;
          })}
        </div>
      </div>;
    })()}

    {/* 🌍 외국인 예약 통계 — 제거(정우님 요청, 신규유입 통계로 대체 예정) */}
    {false && (() => {
      const rows = foreignStats.rows || [];
      const months = [...new Set(rows.map(r => r.month))].sort();
      const branches = [...new Set(rows.map(r => r.branch_short))];
      return <div className="card" style={{padding:16,marginTop:20}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>🌍 외국인 예약 통계</div>
            <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>예약등록일 기준 · 매출 이력 0건이면 "신규" · 영문자 이름 기준 (내부일정 자동 제외)</div>
          </div>
          <button onClick={downloadForeignCSV} disabled={foreignStats.loading || rows.length===0}
            style={{padding:'8px 14px',borderRadius:T.radius.md,border:`1px solid ${T.success}`,background:T.success+'18',
              color:T.success,fontWeight:T.fw.bolder,fontSize:T.fs.sm,cursor:rows.length?'pointer':'not-allowed',
              fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6,opacity:rows.length?1:.4}}>
            ⬇ Excel 다운로드 (CSV)
          </button>
        </div>
        {foreignStats.loading ? (
          <div style={{padding:20,textAlign:'center',color:T.textMuted,fontSize:T.fs.sm}}>로딩 중...</div>
        ) : rows.length === 0 ? (
          <div style={{padding:20,textAlign:'center',color:T.textMuted,fontSize:T.fs.sm}}>해당 기간 외국인 예약 없음</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:T.fs.xs}}>
              <thead>
                <tr style={{borderBottom:`2px solid ${T.border}`,background:T.gray100}}>
                  <th style={{padding:'8px 10px',textAlign:'left',fontWeight:T.fw.bolder}}>지점</th>
                  {months.map(m => (
                    <th key={m} colSpan={3} style={{padding:'8px 10px',textAlign:'center',fontWeight:T.fw.bolder,borderLeft:`1px solid ${T.border}`}}>{m}</th>
                  ))}
                </tr>
                <tr style={{borderBottom:`1px solid ${T.border}`,background:T.gray100,fontSize:T.fs.xxs}}>
                  <th></th>
                  {months.flatMap(m => [
                    <th key={m+'_n'} style={{padding:'4px 6px',color:T.success,fontWeight:T.fw.bolder,borderLeft:`1px solid ${T.border}`}}>신규</th>,
                    <th key={m+'_r'} style={{padding:'4px 6px',color:T.primary,fontWeight:T.fw.bolder}}>기존</th>,
                    <th key={m+'_t'} style={{padding:'4px 6px',color:T.text,fontWeight:T.fw.bolder}}>합계</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {branches.map(br => (
                  <tr key={br} style={{borderBottom:`1px solid ${T.border}40`}}>
                    <td style={{padding:'6px 10px',fontWeight:T.fw.bolder}}>{br}</td>
                    {months.flatMap(m => {
                      const r = rows.find(x => x.branch_short === br && x.month === m) || { new_cnt:0, returning_cnt:0, total_cnt:0 };
                      return [
                        <td key={m+'_n'} style={{padding:'6px 8px',textAlign:'right',color:r.new_cnt>0?T.success:T.gray400,fontWeight:r.new_cnt>0?T.fw.bolder:T.fw.normal,borderLeft:`1px solid ${T.border}`}}>{r.new_cnt}</td>,
                        <td key={m+'_r'} style={{padding:'6px 8px',textAlign:'right',color:r.returning_cnt>0?T.primary:T.gray400}}>{r.returning_cnt}</td>,
                        <td key={m+'_t'} style={{padding:'6px 8px',textAlign:'right',fontWeight:T.fw.bolder}}>{r.total_cnt}</td>,
                      ];
                    })}
                  </tr>
                ))}
                {/* 전체 합계 row */}
                <tr style={{borderTop:`2px solid ${T.border}`,background:T.gray100}}>
                  <td style={{padding:'8px 10px',fontWeight:T.fw.black}}>전체</td>
                  {months.flatMap(m => {
                    const monthRows = rows.filter(x => x.month === m);
                    const sumN = monthRows.reduce((s,r)=>s+(r.new_cnt||0),0);
                    const sumR = monthRows.reduce((s,r)=>s+(r.returning_cnt||0),0);
                    const sumT = monthRows.reduce((s,r)=>s+(r.total_cnt||0),0);
                    return [
                      <td key={m+'_n'} style={{padding:'8px',textAlign:'right',color:T.success,fontWeight:T.fw.black,borderLeft:`1px solid ${T.border}`}}>{sumN}</td>,
                      <td key={m+'_r'} style={{padding:'8px',textAlign:'right',color:T.primary,fontWeight:T.fw.black}}>{sumR}</td>,
                      <td key={m+'_t'} style={{padding:'8px',textAlign:'right',fontWeight:T.fw.black}}>{sumT}</td>,
                    ];
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>;
    })()}
  </div>;
}

export default SalesPage
