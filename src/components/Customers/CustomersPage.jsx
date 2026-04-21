import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, queueAlimtalk, buildTokenSearch } from '../../lib/sb'
import { toDb, fromDb, _activeBizId } from '../../lib/db'
import { genId, todayStr, useScrollRestore, useSessionState, getCustPkgBranchInitial } from '../../lib/utils'
import { Btn, FLD, Empty, fmt, Spinner, DataTable } from '../common'
import I from '../common/I'
import { DetailedSaleForm } from '../Timeline/SaleForm'

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
  const [q, setQ] = useSessionState("cust_q", "");
  const [vb, setVb] = useSessionState("cust_vb", "all");
  // 가입일 범위 필터 (신규 고객 날짜별 보기)
  const [joinFrom, setJoinFrom] = useSessionState("cust_joinFrom", "");
  const [joinTo, setJoinTo] = useSessionState("cust_joinTo", "");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailCust, setDetailCust] = useState(null);
  const [detailTab, setDetailTab] = useSessionState("cust_tab", "pkg"); // "pkg" | "sales"
  // 쉐어 — 보유권/패키지를 공유하는 고객 페어
  const [shareCusts, setShareCusts] = useState([]); // [{id, name, phone, cust_num, shareRowId}]
  const [showShareModal, setShowShareModal] = useState(false);
  const [editingMemo, setEditingMemo] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);
  // 매출 전체 편집 (할인·보유권·포인트·결제수단 금액 재조정)
  const [editSale, setEditSale] = useState(null);
  const [saleDetailMap, setSaleDetailMap] = useState({}); // saleId → [sale_details rows]

  // 매출 전체 편집 열기 — sale_details 선로드 후 DetailedSaleForm(editMode) 오픈
  const openSaleFullEdit = async (s) => {
    try {
      let details = saleDetailMap[s.id];
      if (!details) {
        const rows = await sb.get("sale_details", `&sale_id=eq.${s.id}&order=id.asc`);
        details = rows || [];
        setSaleDetailMap(prev => ({...prev, [s.id]: details}));
      }
      const matchedServiceIds = [];
      details.forEach(d => {
        const svc = (data?.services||[]).find(x => x.name === d.service_name);
        if (svc) matchedServiceIds.push(svc.id);
      });
      setEditSale({
        ...s,
        saleMemo: s.memo || "",
        _prefill: { matchedServiceIds, matchedTagIds: [], _isNewCust: false, existingSaleId: s.id, existingDetails: details }
      });
    } catch (e) { alert("편집 진입 실패: " + (e?.message || e)); }
  };

  // 편집 저장 콜백
  const handleSaleEditSave = (item) => {
    if (item?._editOnly && item?.id) {
      setSaleDetailMap(prev => ({...prev, [item.id]: item._newDetails || []}));
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
      alert("매출 편집 저장 완료");
    }
    setEditSale(null);
  };
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
  useScrollRestore('cust_list', scrollRef);
  // pendingOpenCust가 있으면 단일 고객 모드 — 리스트 로드 완전 차단
  const lockSingleRef = useRef(!!pendingOpenCust);
  const [singleMode, setSingleMode] = useState(!!pendingOpenCust);

  // 필터(검색/매장/숨김)가 바뀌면 처음부터 다시 로드
  const buildFilter = (offset, limit) => {
    const bizId = _activeBizId;
    let parts = [`business_id=eq.${bizId}`];
    // 매장 필터: 특정 지점 선택 시에만 필터, "전체"는 userBranches 무시하고 전 지점 표시
    // (고객 DB는 공유 자산 — 어느 지점에서든 고객 조회 가능)
    if (vb !== "all") parts.push(`bid=eq.${vb}`);
    // 가입일 범위 필터 (신규 고객 날짜별 조회)
    if (joinFrom) parts.push(`join_date=gte.${joinFrom}`);
    if (joinTo) parts.push(`join_date=lte.${joinTo}`);
    // 숨김 필터 제거 — 전부 표시
    // 검색: 공백 구분 다토큰 전부 서버에서 AND — 각 토큰이 아무 필드에든 부분매칭되어야 함
    const tokens = (q||"").trim().split(/\s+/).filter(Boolean);
    const fields = ['name','name2','phone','phone2','email','memo','cust_num'];
    if (tokens.length === 1) {
      const enc = encodeURIComponent(tokens[0]);
      parts.push(`or=(${fields.map(f=>`${f}.ilike.*${enc}*`).join(',')})`);
    } else if (tokens.length > 1) {
      const ands = tokens.map(t => {
        const enc = encodeURIComponent(t);
        return `or(${fields.map(f=>`${f}.ilike.*${enc}*`).join(',')})`;
      });
      parts.push(`and=(${ands.join(',')})`);
    }
    // 정렬: 생성일 내림차순 우선 → 고객번호 내림차순 (보조)
    // 예약으로만 등록된 cust_num 없는 신규 고객도 최상단 노출
    // Oracle bulk import처럼 created_at이 같은 구간은 cust_num_int로 세분 정렬
    parts.push(`order=created_at.desc.nullslast,cust_num_int.desc.nullslast`);
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

  const reqIdRef = useRef(0);
  const fetchPage = async (offset, reset=false) => {
    // reset(새 검색)은 무조건 진행 — 이전 in-flight 요청은 reqId로 무효화.
    // 페이지 추가 로드(reset=false)는 기존 요청 중이면 중복 방지.
    if (!reset && loading) return;
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    if (reset) setSearching(true);
    try {
      const filter = buildFilter(offset, PAGE_SIZE);
      const rows = await sb.get("customers", filter);
      if (myReqId !== reqIdRef.current) return; // 이미 구식 응답 — 무시
      const mapped = fromDb("customers", rows).filter(c => matchesQuery(c, q));
      setPagedCusts(prev => reset ? mapped : [...prev, ...mapped]);
      setHasMore(rows.length === PAGE_SIZE);
      if (reset && scrollRef.current) scrollRef.current.scrollTop = 0;
      const ids = mapped.map(c => c.id).filter(Boolean);
      if (ids.length > 0) {
        try {
          const pkgRows = await sb.get("customer_packages", `&customer_id=in.(${ids.join(",")})`);
          if (myReqId !== reqIdRef.current) return;
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
      if (myReqId !== reqIdRef.current) return;
      console.error("Customer page fetch failed:", e);
      if (reset) setPagedCusts([]);
      setHasMore(false);
    }
    if (myReqId === reqIdRef.current) {
      setLoading(false);
      setSearching(false);
    }
  };

  // q/vb/showHidden 변경 시 디바운스 리로드 — pendingOpenCust 처리 중이거나 단일 고객 락 상태면 스킵
  useEffect(() => {
    if (pendingOpenCust) return;
    if (lockSingleRef.current) return;
    const timer = setTimeout(() => { fetchPage(0, true); }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, vb, joinFrom, joinTo, pendingOpenCust]);

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

  const handleSave = async (item, isEdit) => {
    const normalized = {...item, phone: (item.phone || "").replace(/[^0-9]/g, "")};

    // 연락처 중복 체크 — 다른 고객이 같은 번호 사용 중이면 확인
    if (normalized.phone) {
      try {
        const rows = await sb.get("customers", `&phone=eq.${normalized.phone}&id=neq.${normalized.id}&limit=1`);
        const other = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (other) {
          const msg = `⚠️ 이 연락처 (${normalized.phone})를 이미 사용 중인 고객이 있습니다:\n\n  ${other.name}${other.cust_num?` (#${other.cust_num})`:""}\n\n같은 분이시라면 [취소] 후 기존 고객을 선택해서 수정하시는 걸 권장합니다.\n다른 분이라면 연락처 번호 한자리를 다르게 해주세요.\n\n그래도 이대로 저장할까요?`;
          if (!confirm(msg)) return;
        }
      } catch (e) { console.error("phone check err:", e); }
    }

    try {
      if (isEdit) {
        const {id, ...rest} = toDb("customers", normalized);
        await sb.update("customers", normalized.id, rest);
      } else {
        const res = await sb.insert("customers", toDb("customers", normalized));
        if (!res) return; // insert 실패 시 중단 (sb.insert가 이미 alert 띄움)
      }
    } catch (e) {
      console.error("[handleSave]", e);
      alert("저장 실패: " + (e?.message || e));
      return;
    }

    setData(prev => {
      const inLocal = (prev?.customers||[]).some(c=>c.id===normalized.id);
      if (inLocal) return {...prev, customers: prev.customers.map(c=>c.id===normalized.id?normalized:c)};
      return {...prev, customers: [...(prev?.customers||[]), normalized]};
    });
    setPagedCusts(prev => {
      const inList = prev.some(c=>c.id===normalized.id);
      if (inList) return prev.map(c=>c.id===normalized.id?normalized:c);
      return [normalized, ...prev];
    });
    setShowModal(false); setEditItem(null);
    if (detailCust?.id === normalized.id) setDetailCust(normalized);
  };

  // 상세 패널 메모 인라인 저장
  const saveMemoInline = async () => {
    if (!detailCust) { setEditingMemo(false); return; }
    const newMemo = memoDraft;
    if (newMemo === (detailCust.memo || "")) { setEditingMemo(false); return; }
    setMemoSaving(true);
    try {
      await sb.update("customers", detailCust.id, { memo: newMemo });
      const updated = { ...detailCust, memo: newMemo };
      setDetailCust(updated);
      setPagedCusts(prev => prev.map(x => x.id === detailCust.id ? updated : x));
      setData(prev => ({ ...prev, customers: (prev?.customers || []).map(x => x.id === detailCust.id ? updated : x) }));
    } catch (e) { console.error(e); alert("메모 저장 실패"); }
    setMemoSaving(false);
    setEditingMemo(false);
  };

  // 상세 패널 바뀌면 편집 모드 해제
  useEffect(() => { setEditingMemo(false); setMemoDraft(""); }, [detailCust?.id]);

  const [custSales, setCustSales] = useState([]);
  const [custPkgsServer, setCustPkgsServer] = useState([]);
  const [pkgEditId, setPkgEditId] = useState(null);
  const [custResStats, setCustResStats] = useState({total:0,noshow:0,samedayCancel:0,samedayChange:0});
  const [custPointTx, setCustPointTx] = useState([]);
  const [pkgHistoryMap, setPkgHistoryMap] = useState({}); // {pkgId: txArray}
  const [pkgHistoryOpen, setPkgHistoryOpen] = useState(null); // opened pkg id
  const loadPkgHistory = (pkgId) => {
    // 캐시 체크 제거 — 펼칠 때마다 최신 이력 재조회 (tx 추가·매출 발생 후 새로고침 없이 최신값 확보)
    sb.get("package_transactions", `&package_id=eq.${pkgId}&order=created_at.desc&limit=200`)
      .then(rows => setPkgHistoryMap(prev => ({...prev, [pkgId]: rows||[]})))
      .catch(() => setPkgHistoryMap(prev => ({...prev, [pkgId]: prev[pkgId]||[]})));
  };
  // ── 이력 1건만 삭제 + 잔액 복구 (매출은 유지) ──
  const rollbackPkgTxOnly = async (tx, pkg) => {
    await sb.del("package_transactions", tx.id);
    let upd = {};
    if (tx.type === "deduct") {
      upd.used_count = Math.max(0, (pkg.used_count||0) - (tx.amount||0));
      if (tx.unit === "won") {
        const curBal = Number(((pkg.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
        const newBal = curBal + (tx.amount||0);
        upd.note = /잔액:[0-9,]+/.test(pkg.note||"")
          ? (pkg.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
          : (pkg.note ? pkg.note + " | " : "") + `잔액:${newBal.toLocaleString()}`;
      }
    } else if (tx.type === "charge") {
      if (tx.unit === "won") {
        const curBal = Number(((pkg.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
        const newBal = Math.max(0, curBal - (tx.amount||0));
        upd.note = /잔액:[0-9,]+/.test(pkg.note||"")
          ? (pkg.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
          : (pkg.note || "");
      }
    } else if (tx.type === "adjust_add") {
      if (tx.unit === "won") {
        const curBal = Number(((pkg.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
        upd.note = (pkg.note||"").replace(/잔액:[0-9,]+/, `잔액:${Math.max(0,curBal-(tx.amount||0)).toLocaleString()}`);
      } else {
        upd.used_count = (pkg.used_count||0) + (tx.amount||0);
      }
    } else if (tx.type === "adjust_sub") {
      if (tx.unit === "won") {
        const curBal = Number(((pkg.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
        upd.note = (pkg.note||"").replace(/잔액:[0-9,]+/, `잔액:${(curBal+(tx.amount||0)).toLocaleString()}`);
      } else {
        upd.used_count = Math.max(0, (pkg.used_count||0) - (tx.amount||0));
      }
    }
    if (Object.keys(upd).length > 0) {
      await sb.update("customer_packages", pkg.id, upd);
      setCustPkgsServer(prev => prev.map(p => p.id === pkg.id ? {...p, ...upd} : p));
    }
    setPkgHistoryMap(prev => ({...prev, [pkg.id]: (prev[pkg.id]||[]).filter(t => t.id !== tx.id)}));
  };

  // ── 매출 전체 삭제 + 모든 차감·포인트 롤백 ──
  const deleteSaleWithFullRollback = async (saleId) => {
    const pkgTxs = await sb.get("package_transactions", `&sale_id=eq.${saleId}`) || [];
    const chargedPkgIds = new Set();
    pkgTxs.forEach(tx => { if (tx.type === "charge") chargedPkgIds.add(tx.package_id); });

    // charge된 패키지 통째 삭제
    for (const pkgId of chargedPkgIds) {
      await sb.del("customer_packages", pkgId).catch(console.error);
      await sb.delWhere("package_transactions", "package_id", pkgId).catch(console.error);
    }
    // deduct 롤백
    for (const tx of pkgTxs) {
      if (chargedPkgIds.has(tx.package_id)) continue;
      if (tx.type === "deduct") {
        const rows = await sb.get("customer_packages", tx.package_id);
        const p = rows?.[0];
        if (p) {
          const newUsed = Math.max(0, (p.used_count||0) - (tx.amount||0));
          const upd = { used_count: newUsed };
          if (tx.unit === "won") {
            const curBal = Number(((p.note||"").match(/잔액:([0-9,]+)/)?.[1] || "0").replace(/,/g,""));
            const newBal = curBal + (tx.amount||0);
            upd.note = /잔액:[0-9,]+/.test(p.note||"")
              ? (p.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
              : (p.note ? p.note + " | " : "") + `잔액:${newBal.toLocaleString()}`;
          }
          await sb.update("customer_packages", tx.package_id, upd).catch(console.error);
        }
      }
      await sb.del("package_transactions", tx.id).catch(console.error);
    }
    // point_transactions 삭제
    const ptxs = await sb.get("point_transactions", `&sale_id=eq.${saleId}`) || [];
    for (const tx of ptxs) {
      await sb.del("point_transactions", tx.id).catch(console.error);
    }
    // sale_details 삭제
    await sb.delWhere("sale_details", "sale_id", saleId).catch(console.error);
    // customers.visits -1
    const sale = (data?.sales||[]).find(s => s.id === saleId);
    if (sale?.custId) {
      const cust = (data?.customers||[]).find(c => c.id === sale.custId);
      if (cust) {
        const newVisits = Math.max(0, (cust.visits||0) - 1);
        await sb.update("customers", sale.custId, { visits: newVisits }).catch(console.error);
        setData(prev => ({ ...prev, customers: (prev?.customers||[]).map(c => c.id === sale.custId ? { ...c, visits: newVisits } : c) }));
      }
    }
    // sales 삭제
    await sb.del("sales", saleId).catch(console.error);
    setData(prev => ({
      ...prev,
      sales: (prev?.sales||[]).filter(s => s.id !== saleId),
      custPackages: (prev?.custPackages||[]).filter(p => !chargedPkgIds.has(p.id)),
    }));
  };

  // ── 이력 🗑 클릭 핸들러: sale_id 분기 ──
  const deletePkgTx = async (tx, pkg) => {
    if (!tx || !pkg) return;
    const label = ({charge:"충전",deduct:"차감",adjust_add:"+조정",adjust_sub:"-조정",cancel:"취소"})[tx.type]||tx.type;
    const unitS = tx.unit === "count" ? "회" : "원";
    const txLabel = `${label} ${(tx.amount||0).toLocaleString()}${unitS}`;

    try {
      // Case 1: sale_id 있음 → 매출 존재 여부 확인 후 3지선다
      if (tx.sale_id) {
        const saleRows = await sb.get("sales", tx.sale_id);
        const sale = saleRows?.[0];

        if (sale) {
          // 매출 있음 → [확인]매출 전체 삭제 / [취소]이 차감만
          const br = (data?.branches||[]).find(b=>b.id===sale.bid);
          const info = `${sale.date||""}${br?.short?" · "+br.short:""}${sale.staff_name?" · "+sale.staff_name:""}`;
          if (confirm(
            `🔗 이 이력은 매출에 연결돼 있습니다\n\n📌 매출: ${info}\n📋 이력: ${txLabel}\n\n[확인] 매출 전체 삭제 + 모든 차감·포인트 자동 복구 (권장)\n[취소] 이 차감만 삭제 (매출·다른 차감 유지)`
          )) {
            // → 매출 전체 삭제
            if (!confirm(`정말 매출 전체를 삭제하시겠습니까?\n\n• 이 매출에 연결된 모든 차감/포인트 복구\n• sale_details 삭제\n• 방문 횟수 -1\n\n되돌릴 수 없습니다.`)) return;
            await deleteSaleWithFullRollback(sale.id);
            // 이력 + 패키지 state 새로 로드
            const rows = await sb.get("package_transactions", `&package_id=eq.${pkg.id}&order=created_at.desc&limit=200`);
            setPkgHistoryMap(prev => ({...prev, [pkg.id]: rows||[]}));
            const pkgRows = await sb.get("customer_packages", pkg.id);
            if (pkgRows?.[0]) setCustPkgsServer(prev => prev.map(p => p.id === pkg.id ? pkgRows[0] : p));
            alert("매출 전체 삭제 + 차감/포인트 자동 복구 완료");
            return;
          } else {
            // → 이 차감만 삭제
            if (!confirm(`이 차감 이력 1건만 삭제\n\n${txLabel}\n\n매출과 다른 차감은 그대로 유지됩니다.\n계속하시겠습니까?`)) return;
            await rollbackPkgTxOnly(tx, pkg);
            return;
          }
        } else {
          // sale_id 있는데 sales에 없음 (유령 이력)
          if (!confirm(`⚠️ 연결된 매출이 이미 삭제됐거나 저장 실패한 상태입니다.\n\n${txLabel}\n\n이 이력만 삭제하고 잔액을 복구할까요?`)) return;
          await rollbackPkgTxOnly(tx, pkg);
          return;
        }
      }

      // Case 2: sale_id 없음 (수동 차감·조정 등)
      if (!confirm(`이력 1건 삭제\n\n${txLabel}\n${tx.note||""}\n\n삭제 시 이 패키지의 잔액이 자동 복구됩니다. 계속하시겠습니까?`)) return;
      await rollbackPkgTxOnly(tx, pkg);

    } catch (e) {
      console.error("[deletePkgTx]", e);
      alert("삭제 실패: " + (e?.message || e));
    }
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
  // 잔액 계산: 만료된 earn은 제외 (expires_at < now). expire 트랜잭션은 히스토리용이라 계산에서 무시
  const custPointBalance = custPointTx.reduce((sum, t) => {
    if (t.type === "earn" || t.type === "adjust_add") {
      if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return sum; // 만료
      return sum + (t.amount||0);
    }
    if (t.type === "deduct" || t.type === "adjust_sub") return sum - (t.amount||0);
    return sum; // expire 타입은 계산 제외 (히스토리용)
  }, 0);
  const loadCustPoints = (cid) => {
    if (!cid) { setCustPointTx([]); return Promise.resolve(); }
    return sb.get("point_transactions", `&customer_id=eq.${cid}&order=created_at.desc&limit=200`)
      .then(rows => setCustPointTx(rows||[]))
      .catch(() => setCustPointTx([]));
  };
  // 쉐어 고객 로드
  const loadShares = async (custId) => {
    if (!custId) { setShareCusts([]); return; }
    try {
      const [asA, asB] = await Promise.all([
        sb.get("customer_shares", `&cust_id_a=eq.${custId}`),
        sb.get("customer_shares", `&cust_id_b=eq.${custId}`),
      ]);
      const pairs = [
        ...(asA||[]).map(r => ({ otherId: r.cust_id_b, shareRowId: r.id })),
        ...(asB||[]).map(r => ({ otherId: r.cust_id_a, shareRowId: r.id })),
      ];
      if (pairs.length === 0) { setShareCusts([]); return; }
      const ids = pairs.map(p => p.otherId);
      const rows = await sb.get("customers", `&id=in.(${ids.join(",")})`);
      const parsed = fromDb("customers", rows||[]);
      const byId = new Map(parsed.map(c => [c.id, c]));
      setShareCusts(pairs.map(p => {
        const c = byId.get(p.otherId);
        return c ? { ...c, shareRowId: p.shareRowId } : null;
      }).filter(Boolean));
    } catch(e) { console.warn("loadShares failed", e); setShareCusts([]); }
  };
  const addShare = async (otherCust) => {
    if (!detailCust?.id || !otherCust?.id || otherCust.id === detailCust.id) return;
    // 중복 체크
    if (shareCusts.some(s => s.id === otherCust.id)) { alert("이미 쉐어된 고객입니다."); return; }
    try {
      const row = {
        id: "share_" + Math.random().toString(36).slice(2,10),
        business_id: _activeBizId,
        cust_id_a: detailCust.id,
        cust_id_b: otherCust.id,
      };
      await sb.insert("customer_shares", row);
      setShareCusts(prev => [...prev, { ...otherCust, shareRowId: row.id }]);
      setShowShareModal(false);
    } catch(e) { alert("쉐어 등록 실패: "+e.message); }
  };
  const removeShare = async (shareRowId, name) => {
    if (!confirm(`${name||'이 고객'}과의 쉐어를 해제할까요?`)) return;
    try {
      await sb.del("customer_shares", shareRowId);
      setShareCusts(prev => prev.filter(s => s.shareRowId !== shareRowId));
    } catch(e) { alert("해제 실패: "+e.message); }
  };

  useEffect(() => {
    if (!detailCust) { setCustSales([]); setCustPkgsServer([]); setCustResStats({total:0,noshow:0,samedayCancel:0,samedayChange:0}); setCustPointTx([]); setShareCusts([]); setLoadingDetail(false); return; }
    loadShares(detailCust.id);
    setLoadingDetail(true);
    Promise.all([
      sb.get("sales", `&cust_id=eq.${detailCust.id}&order=date.desc&limit=500`)
        .then(async rows => {
          const parsed = fromDb("sales", rows);
          setCustSales(parsed);
          // sale_details 일괄 로드 (매출 상세 테이블 자동 표시용)
          if (parsed.length > 0) {
            try {
              const ids = parsed.map(s => s.id);
              const CHUNK = 100;
              const allDetails = {};
              for (let i=0; i<ids.length; i+=CHUNK) {
                const chunk = ids.slice(i, i+CHUNK);
                const dRows = await sb.get("sale_details", `&sale_id=in.(${chunk.join(",")})&order=service_no.asc`);
                (dRows||[]).forEach(d => {
                  if (!allDetails[d.sale_id]) allDetails[d.sale_id] = [];
                  allDetails[d.sale_id].push(d);
                });
              }
              setSaleDetailMap(prev => ({...prev, ...allDetails}));
            } catch(e) { console.warn("sale_details batch load fail:", e); }
          }
        })
        .catch(() => setCustSales([])),
      sb.get("customer_packages", `&customer_id=eq.${detailCust.id}`)
        .then(rows => setCustPkgsServer(rows))
        .catch(() => setCustPkgsServer([])),
      sb.get("reservations", `&cust_id=eq.${detailCust.id}&select=status,date,updated_at,prev_reservation_id&limit=2000`)
        .then(rows => {
          // 당일취소: 취소 상태 + updated_at 날짜 == 예약일 (id_imgr471swt-5 수정요청)
          // 당일변경: naver_changed 상태 또는 prev_reservation_id 있는 것 중 updated_at 날짜 == 예약일
          const dateOf = (ts) => ts ? String(ts).slice(0,10) : "";
          setCustResStats({
            total: rows.filter(r=>["confirmed","completed","no_show"].includes(r.status)).length,
            noshow: rows.filter(r=>r.status==="no_show").length,
            samedayCancel: rows.filter(r=>["cancelled","naver_cancelled"].includes(r.status) && r.updated_at && dateOf(r.updated_at) === r.date).length,
            samedayChange: rows.filter(r=>{
              const isChange = r.status === "naver_changed" || (r.prev_reservation_id && r.prev_reservation_id !== "");
              return isChange && r.updated_at && dateOf(r.updated_at) === r.date;
            }).length,
          });
        })
        .catch(() => setCustResStats({total:0,noshow:0,samedayCancel:0,samedayChange:0})),
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
    // 유효기간 미설정 = 아직 사용 시작 전 (첫 사용 시 자동 1년 설정됨) → 활성 상태로 간주
    const notStarted = !expiry;
    const isDone = notStarted ? false : (isPrepaid ? (balance <= 0 || isExpired) : isAnnual ? isExpired : (remain <= 0 || isExpired));

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

      {/* 연간할인권: 유효기간 표시 (카운트 없음, 회원가 자동 적용) */}
      {isAnnual && <div>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:isExpired?T.danger:T.info,marginBottom:4}}>
          {isExpired ? "만료" : "이용중"} {expiry ? `(~${expiry})` : ""}
        </div>
        <div style={{fontSize:T.fs.nano,color:T.textMuted,marginBottom:6}}>유효기간 내 회원가 자동 적용 (시술상품관리에서 회원가 설정)</div>
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

      {/* 유효기간 (모든 타입 공통, 항상 노출) */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,padding:"4px 8px",borderRadius:T.radius.sm,
        background:isExpired?T.dangerLt:T.gray100}}>
        <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:isExpired?T.danger:expiry?T.textSub:T.textMuted,flex:1}}>
          {expiry ? `유효 ~${expiry} ${isExpired?"(만료)":""}` : "유효기간 미설정"}
        </span>
        <button onClick={(e)=>{
          e.stopPropagation();
          const def = expiry || (()=>{const d=new Date();d.setFullYear(d.getFullYear()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;})();
          const newExp = prompt(expiry?"새 유효기간 (YYYY-MM-DD):":"유효기간 설정 (YYYY-MM-DD):", def);
          if(!newExp) return;
          if(!/^\d{4}-\d{2}-\d{2}$/.test(newExp)){ alert("YYYY-MM-DD 형식으로 입력해주세요"); return; }
          const curNote = p.note || "";
          const newNote = expiry
            ? curNote.replace(/유효:\d{4}-\d{2}-\d{2}/, `유효:${newExp}`)
            : (curNote ? `${curNote} | 유효:${newExp}` : `유효:${newExp}`);
          sb.update("customer_packages",p.id,{note:newNote}).catch(console.error);
          setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x,note:newNote}:x));
        }} style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,border:"1px solid "+T.border,
          background:T.bgCard,color:T.primary,cursor:"pointer",fontFamily:"inherit",fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>
          {expiry ? "연장" : "설정"}
        </button>
      </div>

      {/* 🤝 쉐어 공유 토글 — 쉐어 관계 고객이 이 보유권을 사용 가능하게 */}
      {(() => {
        const isShared = /\|\s*쉐어:Y/.test(p.note||"");
        const toggleShare = (e) => {
          e.stopPropagation();
          const curNote = p.note || "";
          const newNote = isShared
            ? curNote.replace(/\s*\|\s*쉐어:Y/g, "")
            : (curNote ? `${curNote} | 쉐어:Y` : `쉐어:Y`);
          sb.update("customer_packages", p.id, {note: newNote}).catch(console.error);
          setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, note: newNote} : x));
        };
        return <div onClick={toggleShare}
          title={isShared ? "쉐어 공유 중 — 클릭하면 해제" : "클릭하면 쉐어 고객도 이 보유권 사용 가능"}
          style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,padding:"4px 8px",borderRadius:T.radius.sm,
            background: isShared ? "#F5F3FF" : T.gray100,
            border: isShared ? "1px solid #C4B5FD" : "1px solid "+T.border,
            cursor:"pointer",userSelect:"none"}}>
          <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color: isShared ? "#5B21B6" : T.textMuted,flex:1}}>
            {isShared ? "🤝 쉐어 공유 중" : "🤝 쉐어 공유"}
          </span>
          <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,
            background: isShared ? "#7C3AED" : T.bgCard,
            color: isShared ? "#fff" : T.gray500,
            border: isShared ? "none" : "1px solid "+T.border,
            fontWeight:T.fw.bolder}}>
            {isShared ? "ON" : "OFF"}
          </span>
        </div>;
      })()}

      {/* 편집 모드 */}
      {pkgEditId === p.id && <div style={{borderTop:"1px solid "+T.border,paddingTop:8,marginBottom:6}}>
        {isAnnual ? (
          <div style={{fontSize:11,color:T.textSub,padding:"4px 0 8px",lineHeight:1.5}}>
            연간회원권은 카운트 없이 유효기간 내 회원가가 자동 적용됩니다.<br/>
            유효기간 변경은 위 <b>연장</b> 버튼을, 회원가 설정은 <b>관리설정 → 시술상품관리</b>에서 하세요.
          </div>
        ) : (
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:T.textMuted,marginBottom:3}}>{isPrepaid?"충전액 (원)":"총 횟수"}</div>
            <input type="number" defaultValue={isPrepaid ? charged : p.total_count} id={`pkg-edit-total-${p.id}`}
              style={{width:"100%",fontSize:12,padding:"6px 8px",borderRadius:6,border:"1px solid "+T.border,boxSizing:"border-box"}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:T.textMuted,marginBottom:3}}>{isPrepaid?"사용액 (원)":"사용 횟수"}</div>
            <input type="number" defaultValue={p.used_count} id={`pkg-edit-used-${p.id}`}
              style={{width:"100%",fontSize:12,padding:"6px 8px",borderRadius:6,border:"1px solid "+T.border,boxSizing:"border-box"}}/>
          </div>
        </div>
        )}
        <div style={{display:"flex",gap:6}}>
          <Btn variant="outline" size="sm" style={{flex:1,justifyContent:"center",fontSize:11}} onClick={()=>setPkgEditId(null)}>취소</Btn>
          <Btn variant="primary" size="sm" style={{flex:2,justifyContent:"center",fontSize:11}} onClick={()=>{
            const newTotal = Number(document.getElementById(`pkg-edit-total-${p.id}`)?.value || p.total_count);
            const newUsed = Number(document.getElementById(`pkg-edit-used-${p.id}`)?.value || p.used_count);
            if (isNaN(newTotal) || isNaN(newUsed) || newTotal < 0 || newUsed < 0) return alert("0 이상 숫자만 입력 가능합니다");
            if (newUsed > newTotal) return alert(isPrepaid ? "사용액이 충전액보다 클 수 없습니다" : "사용횟수가 총횟수보다 클 수 없습니다");
            const updates = {total_count: newTotal, used_count: newUsed};
            if(isPrepaid) {
              const newBal = Math.max(0, newTotal - newUsed);
              updates.note = (p.note||"").includes("잔액:")
                ? (p.note||"").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
                : ((p.note||"") ? `잔액:${newBal.toLocaleString()} | ${p.note}` : `잔액:${newBal.toLocaleString()}`);
            }
            sb.update("customer_packages",p.id,updates).catch(console.error);
            setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x,...updates}:x));
            setPkgEditId(null);
          }}>저장</Btn>
        </div>
      </div>}

      {/* 액션 버튼 (편집 중에는 숨김) */}
      {pkgEditId !== p.id && <div style={{display:"flex",gap:T.sp.xs}}>
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
      </div>}
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
            <button onClick={()=>deletePkgTx(tx, p)} title="이력 삭제 + 잔액 자동 복구"
              style={{border:"none",background:"none",cursor:"pointer",color:T.gray400,fontSize:12,padding:"0 2px",marginLeft:"auto"}}
              onMouseOver={e=>e.currentTarget.style.color=T.danger}
              onMouseOut={e=>e.currentTarget.style.color=T.gray400}>🗑</button>
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
      {/* 가입일 범위 */}
      <div style={{display:"flex",alignItems:"center",gap:4,fontSize:T.fs.xxs,color:T.textSub}}>
        <span>가입일</span>
        <input type="date" className="inp" style={{height:38,fontSize:T.fs.xxs,padding:"4px 6px",borderRadius:T.radius.md,width:130}} value={joinFrom} onChange={e=>{unlockSingleAndReload();setJoinFrom(e.target.value);}}/>
        <span>~</span>
        <input type="date" className="inp" style={{height:38,fontSize:T.fs.xxs,padding:"4px 6px",borderRadius:T.radius.md,width:130}} value={joinTo} onChange={e=>{unlockSingleAndReload();setJoinTo(e.target.value);}}/>
        {(joinFrom||joinTo) && <button type="button" onClick={()=>{unlockSingleAndReload();setJoinFrom("");setJoinTo("");}} style={{padding:"4px 8px",fontSize:10,borderRadius:6,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>초기화</button>}
      </div>
      {/* 빠른 프리셋 */}
      <div style={{display:"flex",gap:3}}>
        {[{label:"오늘",days:0},{label:"7일",days:7},{label:"30일",days:30}].map(p=>(
          <button key={p.label} type="button" onClick={()=>{
            const today = new Date().toISOString().slice(0,10);
            const from = new Date(); from.setDate(from.getDate()-p.days);
            unlockSingleAndReload();
            setJoinFrom(from.toISOString().slice(0,10)); setJoinTo(today);
          }} style={{padding:"4px 8px",fontSize:10,borderRadius:6,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",fontFamily:"inherit",color:T.textSub}}>{p.label}</button>
        ))}
      </div>
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
                  <td style={{fontSize:T.fs.xs,color:T.text,fontFamily:"monospace",fontWeight:800}}>{c.custNum||"-"}</td>
                  <td style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"nowrap"}}>{c.joinDate||(c.createdAt||"").slice(0,10)||"-"}</td>
                  <td style={{fontWeight:T.fw.bold}}>
                    {c.gender && <span style={{...sx.genderBadge(c.gender),marginRight:4}}>{c.gender==="F"?"여":"남"}</span>}
                    {c.name}
                    {c.name2 && <span style={{color:T.textSub,fontWeight:T.fw.normal,marginLeft:4,fontSize:T.fs.xxs}}>({c.name2})</span>}
                    {c.smsConsent===false && <span style={{fontSize:9,color:T.danger,fontWeight:T.fw.bold,marginLeft:4}}>수신거부</span>}
                  </td>
                  <td style={{fontSize:T.fs.xxs,color:T.primary,whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>
                    {c.phone ? <span style={{cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}
                      title="클릭하면 번호 복사"
                      onClick={async ()=>{ try{ await navigator.clipboard.writeText(c.phone); alert(`복사됨: ${c.phone}`);}catch(e){ alert("복사 실패");}}}>{c.phone}</span> : "-"}
                    {c.phone2 && <div style={{color:T.textSub,fontSize:9}}>
                      <span style={{cursor:"pointer"}} title="클릭하면 번호 복사"
                        onClick={async ()=>{ try{ await navigator.clipboard.writeText(c.phone2); alert(`복사됨: ${c.phone2}`);}catch(e){}}}>{c.phone2}</span>
                    </div>}
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
                    {/* 고객 메모 — 항상 표시, 클릭 시 인라인 편집 */}
                    <div
                      style={{padding:"10px 14px",background:"#e8f4fd",borderBottom:"1px solid "+T.border,fontSize:T.fs.xs,color:"#155a8a",whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.5,cursor:editingMemo?"text":"pointer"}}
                      onClick={e=>{ e.stopPropagation(); if(!editingMemo){ setMemoDraft(c.memo||""); setEditingMemo(true); } }}>
                      <span style={{fontWeight:T.fw.bolder,marginRight:6}}>👤 메모</span>
                      {editingMemo ? (
                        <textarea
                          autoFocus
                          value={memoDraft}
                          onChange={e=>setMemoDraft(e.target.value)}
                          onBlur={saveMemoInline}
                          onKeyDown={e=>{ if(e.key==='Escape'){ setEditingMemo(false); setMemoDraft(""); } }}
                          onClick={e=>e.stopPropagation()}
                          ref={el=>{if(el){el.style.height='auto';el.style.height=Math.max(40,el.scrollHeight)+'px';}}}
                          placeholder="메모 추가..."
                          style={{width:"calc(100% - 60px)",border:"1px solid "+T.primaryLt,borderRadius:T.radius.sm,padding:"4px 6px",fontSize:T.fs.xs,fontFamily:"inherit",background:T.bgCard,color:"#155a8a",lineHeight:1.5,resize:"vertical",minHeight:40,outline:"none"}} />
                      ) : (
                        <span style={{color:c.memo?"#155a8a":T.gray500,fontStyle:c.memo?"normal":"italic"}}>{c.memo || "메모 추가... (클릭)"}</span>
                      )}
                      {memoSaving && <span style={{marginLeft:8,fontSize:T.fs.xxs,color:T.textMuted}}>저장중...</span>}
                    </div>
                    {/* 예약 통계 (id_imgr471swt-5 수정요청: 당일취소/당일변경 분리) */}
                    <div style={{display:"flex",gap:8,padding:"8px 12px",background:T.bgCard,borderBottom:"1px solid "+T.border}}>
                      {[
                        {label:"예약",val:custResStats.total,color:T.primary},
                        {label:"노쇼",val:custResStats.noshow,color:custResStats.noshow>0?"#e53e3e":T.gray500},
                        {label:"당일취소",val:custResStats.samedayCancel,color:custResStats.samedayCancel>0?"#dd6b20":T.gray500},
                        {label:"당일변경",val:custResStats.samedayChange,color:custResStats.samedayChange>0?"#d97706":T.gray500}
                      ].map(s=><div key={s.label} style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:T.fs.xs,color:T.textMuted}}>{s.label}</span>
                        <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:s.color}}>{s.val}</span>
                      </div>)}
                    </div>
                    {/* 탭 */}
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                      {[["sales","매출 내역 ("+custSales.length+")"],["pkg","보유권 ("+custPkgs.filter(p=>{const t=pkgType(p);const ex=(p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);const isExp=ex&&ex[1]<todayStr();if(isExp)return false;return t==="prepaid"?((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"0").replace(/,/g,"")>0:(p.total_count-p.used_count)>0;}).length+")"],["point","포인트 ("+custPointBalance.toLocaleString()+"P)"],["share","🤝 쉐어 ("+shareCusts.length+")"]].map(([tab,lbl])=>(
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
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <select className="inp" style={{width:"auto",fontSize:T.fs.xs,height:30}}
                            value="" onChange={e=>{
                              if(!e.target.value) return;
                              const svc = (data?.services||[]).find(s=>s.id===e.target.value);
                              if(!svc) return;
                              const isAnn = svc.name?.includes("연간")||svc.name?.includes("회원권");
                              const isPre = svc.name?.includes("다담")||svc.name?.includes("선불")||svc.name?.includes("바프");
                              // 다담권/선불권: total_count=액면가(원), note에 "잔액:X" 기록
                              // 연간권: 99, 패키지: 5회
                              const price = Math.max(0, Number(svc.priceF)||0, Number(svc.priceM)||0, Number(svc.price_f)||0, Number(svc.price_m)||0);
                              const tc = isAnn ? 99 : isPre ? price : 5;
                              const note = isPre && price > 0 ? `잔액:${price.toLocaleString()} | 충전:${price.toLocaleString()} | 사용:0` : "";
                              const pkg = {id:genId(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
                                service_name:svc.name,total_count:tc,used_count:0,
                                purchased_at:new Date().toISOString(),note};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setCustPkgsServer(prev=>[...prev, pkg]);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">+ 패키지 추가</option>
                            {(data?.services||[]).filter(s=>(s.isActive!==false && s.is_active!==false) && (s.name?.includes("PKG")||s.name?.includes("다담")||s.name?.includes("연간")||s.name?.includes("패키지")||s.name?.includes("산모")||s.name?.includes("회원권")||s.name?.includes("바프")||s.name?.includes("선불"))).map(s=>{
                              const p = Math.max(Number(s.priceF)||0, Number(s.priceM)||0, Number(s.price_f)||0, Number(s.price_m)||0);
                              return <option key={s.id} value={s.id}>{s.name} ({p.toLocaleString()}원)</option>;
                            })}
                          </select>
                          {/* + 쿠폰 발행 (수동) */}
                          <select className="inp" style={{width:"auto",fontSize:T.fs.xs,height:30,borderColor:"#ff9800",color:"#E65100"}}
                            value="" onChange={e=>{
                              if(!e.target.value) return;
                              const svc = (data?.services||[]).find(s=>s.id===e.target.value);
                              if(!svc) return;
                              const today = new Date();
                              const exp = new Date(today); exp.setMonth(exp.getMonth()+3);
                              const fmtD = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                              const note = `발행:${fmtD(today)} | 유효:${fmtD(exp)} | 수동발행`;
                              const pkg = {id:'cpn_'+genId(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
                                service_name:svc.name,total_count:1,used_count:0,
                                purchased_at:today.toISOString(),note};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setCustPkgsServer(prev=>[...prev, pkg]);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">🎫 쿠폰 발행 (3개월)</option>
                            {(data?.services||[]).filter(s=>{
                              const cat = (data?.categories||[]).find(cc=>cc.id===s.cat);
                              // '쿠폰' 카테고리 + 10%추가적립쿠폰 제외
                              return cat?.name === '쿠폰' && s.name !== '10%추가적립쿠폰';
                            }).map(s=>
                              <option key={s.id} value={s.id}>{s.name}</option>
                            )}
                          </select>
                          </div>
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
                              const details = saleDetailMap[s.id];
                              return <div key={s.id} style={{borderBottom:"1px solid "+T.border,padding:"10px 0"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.text}}>{s.date}</span>
                                  <span style={{fontSize:T.fs.nano,background:T.gray200,borderRadius:T.radius.sm,padding:"2px 6px"}}>{brName}</span>
                                  <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.bold}}>{s.staffName}</span>
                                  <button onClick={()=>openSaleFullEdit(s)}
                                    style={{marginLeft:"auto",padding:"3px 10px",fontSize:T.fs.nano,fontWeight:T.fw.bold,borderRadius:6,border:"1px solid "+T.primary,background:T.primaryLt||T.bgCard,color:T.primary,cursor:"pointer",fontFamily:"inherit"}}>
                                    ✏️ 매출 상세
                                  </button>
                                </div>
                                <div style={{display:"flex",gap:12,marginBottom:6,padding:"6px 10px",background:"linear-gradient(90deg,"+T.primaryHover+",transparent)",borderRadius:T.radius.sm}}>
                                  <span style={{fontSize:T.fs.xs}}>시술 <b style={{color:T.primary}}>{fmt(sv)}</b></span>
                                  <span style={{fontSize:T.fs.xs}}>제품 <b style={{color:T.infoLt2}}>{fmt(pr)}</b></span>
                                  <span style={{fontSize:T.fs.xs,marginLeft:"auto"}}>합계 <b style={{color:T.info,fontSize:T.fs.sm}}>{fmt(total)}</b></span>
                                </div>
                                {/* sale_details 테이블 (로드됐을 때만) */}
                                {details && details.length > 0 && <div style={{marginBottom:6,background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.sm,overflow:"hidden"}}>
                                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:T.fs.nano}}>
                                    <thead><tr style={{background:T.gray200}}>
                                      <th style={{padding:"3px 8px",textAlign:"left",fontWeight:T.fw.bold,color:T.textSub}}>시술/제품명</th>
                                      <th style={{padding:"3px 8px",textAlign:"right",fontWeight:T.fw.bold,color:T.textSub,width:70}}>금액</th>
                                    </tr></thead>
                                    <tbody>{details.map((d,di)=>(
                                      <tr key={d.id||di} style={{borderTop:"1px solid "+T.border}}>
                                        <td style={{padding:"3px 8px",color:T.text}}>{d.service_name||"-"}</td>
                                        <td style={{padding:"3px 8px",textAlign:"right",color:T.text,fontWeight:T.fw.bold}}>{(d.unit_price||0)>0?fmt(d.unit_price):"-"}</td>
                                      </tr>
                                    ))}</tbody>
                                  </table>
                                </div>}
                                {s.memo && <div style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"pre-wrap",lineHeight:1.6,background:T.bgCard,borderRadius:T.radius.sm,padding:"6px 8px"}}>{s.memo}</div>}
                              </div>;
                            })
                        }
                      </div>}
                      {/* 포인트 탭 */}
                      {detailTab==="point" && <PointPanel cust={c} txList={custPointTx} balance={custPointBalance} onReload={()=>loadCustPoints(c.id)}/>}
                      {/* 쉐어 탭 — 보유권·패키지 공유 고객 */}
                      {detailTab==="share" && <div>
                        <div style={{fontSize:11,color:"#5B21B6",marginBottom:10,padding:"8px 10px",background:"#F5F3FF",borderRadius:8,border:"1px solid #DDD6FE"}}>
                          🤝 <b>쉐어</b> 고객으로 등록하면 <b>보유권·패키지·다담권</b>을 서로 공유해서 쓸 수 있습니다. 예약·매출등록 시 쉐어 보유권이 "🤝 쉐어" 배지와 함께 표시됩니다.
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                          {shareCusts.length === 0 && <div style={{fontSize:12,color:T.textMuted,padding:"20px",flex:1,textAlign:"center"}}>등록된 쉐어 고객 없음</div>}
                          {shareCusts.map(sc => (
                            <span key={sc.id} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:14,background:"#fff",border:"1px solid #C4B5FD",fontSize:12,color:"#5B21B6",fontWeight:600}}>
                              👤 {sc.name}{sc.name2?` (${sc.name2})`:""}
                              {sc.phone && !sc.phone.startsWith("no_phone") && <span style={{color:T.textMuted,fontWeight:400}}>· {sc.phone}</span>}
                              {sc.cust_num && <span style={{fontFamily:"monospace",fontSize:10,color:T.textMuted}}>#{sc.cust_num}</span>}
                              <button onClick={()=>removeShare(sc.shareRowId, sc.name)} title="쉐어 해제"
                                style={{border:"none",background:"none",color:T.danger,fontSize:14,cursor:"pointer",padding:0,lineHeight:1,fontFamily:"inherit",marginLeft:2}}>×</button>
                            </span>
                          ))}
                        </div>
                        <button onClick={()=>setShowShareModal(true)}
                          style={{padding:"8px 14px",fontSize:12,fontWeight:700,borderRadius:8,border:"1.5px dashed #8B5CF6",background:"#F5F3FF",color:"#5B21B6",cursor:"pointer",fontFamily:"inherit"}}>
                          + 쉐어 고객 추가
                        </button>
                      </div>}
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
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo: editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleSaleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))}
      data={data} setData={setData}
      editMode={true} existingSaleId={editSale.id}/>}
    {showShareModal && detailCust && <ShareCustModal
      baseCust={detailCust}
      existingShareIds={shareCusts.map(s=>s.id)}
      onPick={addShare}
      onClose={()=>setShowShareModal(false)}
      setData={setData}/>}
  </div>;
}

// ═══════════════════════════════════════════
// 쉐어 고객 검색·추가 모달
// ═══════════════════════════════════════════
function ShareCustModal({ baseCust, existingShareIds, onPick, onClose, setData }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newGender, setNewGender] = useState("");
  const [creating, setCreating] = useState(false);
  const downOnOverlayRef = React.useRef(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const cond = buildTokenSearch(q.trim(), ["name","name2","phone","phone2","email","cust_num"]);
        const rows = await sb.get("customers", `&business_id=eq.${_activeBizId}${cond}&limit=20`);
        setResults(fromDb("customers", rows||[]));
      } catch(e) { console.warn("share search fail", e); setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const filteredResults = results.filter(c => c.id !== baseCust.id && !existingShareIds.includes(c.id));
  const showNewForm = q.trim().length >= 2 && filteredResults.length === 0;

  // 검색어에서 이름(한글)/전화(숫자) 자동 파싱 → 신규등록 폼 프리필
  useEffect(() => {
    if (!showNewForm) return;
    const tokens = q.trim().split(/\s+/);
    const nameTok = tokens.find(t => /[가-힣]/.test(t));
    const phoneTok = tokens.find(t => /^[\d-]{3,}$/.test(t));
    if (nameTok && !newName) setNewName(nameTok);
    if (phoneTok && !newPhone) setNewPhone(phoneTok);
  }, [showNewForm, q]);

  const createNew = async () => {
    if (!newName.trim()) { alert("이름을 입력하세요"); return; }
    setCreating(true);
    try {
      const id = "cust_" + genId();
      const phoneVal = newPhone.trim() || ("no_phone_"+id.slice(-6));
      const row = {
        id, business_id: _activeBizId,
        name: newName.trim(), phone: phoneVal, gender: newGender||null,
        sms_consent: true, is_hidden: false,
      };
      await sb.insert("customers", row);
      const parsed = fromDb("customers", [row])[0];
      if (setData) setData(p => p ? {...p, customers: [parsed, ...(p.customers||[])]} : p);
      onPick(parsed);
    } catch(e) { alert("신규 등록 실패: "+e.message); }
    setCreating(false);
  };

  return <div
    onMouseDown={e=>{downOnOverlayRef.current=(e.target===e.currentTarget);}}
    onClick={e=>{if(downOnOverlayRef.current && e.target===e.currentTarget)onClose(); downOnOverlayRef.current=false;}}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,width:"100%",maxWidth:460,boxShadow:"0 12px 40px rgba(0,0,0,.25)",overflow:"hidden"}}>
      <div style={{padding:"14px 16px",borderBottom:"1px solid "+T.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <strong style={{fontSize:14,color:"#5B21B6"}}>🤝 쉐어 추가 — {baseCust?.name}</strong>
        <button onClick={onClose} style={{border:"none",background:"none",fontSize:20,cursor:"pointer",color:T.textMuted}}>×</button>
      </div>
      <div style={{padding:14}}>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·전화·고객번호 (공백으로 여러 조건)"
          style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
        <div style={{marginTop:10,maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {q.trim().length < 2 && <div style={{fontSize:11,color:T.textMuted,textAlign:"center",padding:20}}>검색어 2자 이상 입력 (예: "권신영 8008")</div>}
          {filteredResults.map(c => (
            <button key={c.id} onClick={()=>onPick(c)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",border:"1px solid "+T.border,borderRadius:8,background:"#fff",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
              <span style={{fontSize:12,fontWeight:700,color:T.text,flex:1}}>{c.name}{c.name2?` (${c.name2})`:""}</span>
              {c.cust_num && <span style={{fontSize:10,color:T.textMuted,fontFamily:"monospace"}}>#{c.cust_num}</span>}
              {c.phone && !c.phone.startsWith("no_phone") && <span style={{fontSize:11,color:T.textSub}}>{c.phone}</span>}
            </button>
          ))}
        </div>
        {showNewForm && (
          <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+T.border}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5B21B6",marginBottom:8}}>🔎 검색 결과 없음 — 바로 신규 등록</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="이름 *"
                style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
              <input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="연락처 (선택)"
                style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
              <div style={{display:"flex",gap:6}}>
                {[["","?"],["F","여"],["M","남"]].map(([v,l])=>(
                  <button key={v} type="button" onClick={()=>setNewGender(v)}
                    style={{flex:1,padding:"6px",fontSize:12,fontWeight:700,borderRadius:6,border:"1px solid "+(newGender===v?"#8B5CF6":T.border),background:newGender===v?"#F5F3FF":"#fff",color:newGender===v?"#5B21B6":T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
                ))}
              </div>
              <button onClick={createNew} disabled={creating||!newName.trim()}
                style={{padding:"10px",fontSize:13,fontWeight:700,borderRadius:8,border:"none",background:(creating||!newName.trim())?T.gray300:"#8B5CF6",color:"#fff",cursor:(creating||!newName.trim())?"default":"pointer",fontFamily:"inherit",marginTop:4}}>
                {creating?"등록 중...":"신규 등록 후 쉐어"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════
// 포인트 패널 (고객 상세 탭)
// ═══════════════════════════════════════════
function PointPanel({ cust, txList, balance, onReload }) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState("earn"); // earn | deduct
  const [note, setNote] = useState("");
  const [expiryMonths, setExpiryMonths] = useState(0); // 0=없음, 1/3/6/12 개월
  const [saving, setSaving] = useState(false);

  const calcExpiresAt = (months) => {
    if (!months) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + Number(months));
    return d.toISOString();
  };

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
      if (mode === "earn" && expiryMonths > 0) {
        tx.expires_at = calcExpiresAt(expiryMonths);
        tx.source = "manual_" + expiryMonths + "m";
      }
      await sb.insert("point_transactions", tx);
      setAmt(""); setNote(""); setExpiryMonths(0);
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
      {mode === "earn" && <div style={{display:"flex",gap:4,alignItems:"center",marginTop:6}}>
        <span style={{fontSize:10,color:"#8D6E00",fontWeight:700}}>유효기간</span>
        {[[0,"없음"],[1,"1개월"],[3,"3개월"],[6,"6개월"],[12,"12개월"]].map(([m,l])=>(
          <button key={m} onClick={()=>setExpiryMonths(m)} type="button"
            style={{padding:"3px 8px",fontSize:10,fontWeight:600,borderRadius:5,border:"1px solid "+(expiryMonths===m?"#E65100":"#E0B47A"),background:expiryMonths===m?"#E65100":"#fff",color:expiryMonths===m?"#fff":"#8D6E00",cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
        {expiryMonths > 0 && <span style={{fontSize:10,color:"#8D6E00",marginLeft:4}}>~ {new Date(calcExpiresAt(expiryMonths)).toLocaleDateString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit"})}</span>}
      </div>}
    </div>
    {/* 히스토리 */}
    <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6}}>📜 포인트 내역 ({txList.length}건)</div>
    <div style={{maxHeight:360,overflowY:"auto"}}>
      {txList.length === 0
        ? <div style={{fontSize:11,color:T.textMuted,padding:"8px 0",textAlign:"center"}}>내역 없음</div>
        : txList.map(tx => {
            const isPlus = tx.type === "earn" || tx.type === "adjust_add";
            const isExpire = tx.type === "expire";
            const label = ({earn:"적립",deduct:"차감",adjust_add:"조정+",adjust_sub:"조정-",expire:"만료"})[tx.type]||tx.type;
            const expired = isPlus && tx.expires_at && new Date(tx.expires_at).getTime() <= Date.now();
            const bg = isExpire ? "#F5F5F5" : expired ? "#FAFAFA" : isPlus ? "#E8F5E9" : "#FFEBEE";
            const color = isExpire ? "#616161" : expired ? "#9E9E9E" : isPlus ? "#2E7D32" : "#C62828";
            return <div key={tx.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderBottom:"1px solid "+T.border,fontSize:11,opacity:expired?0.7:1}}>
              <span style={{minWidth:64,color:T.textSub,fontSize:10}}>{new Date(tx.created_at).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"})} {new Date(tx.created_at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</span>
              <span style={{padding:"2px 6px",borderRadius:4,background:bg,color,fontWeight:700,fontSize:10}}>{label}</span>
              <span style={{fontWeight:800,color,minWidth:70,textAlign:"right",textDecoration:isExpire?"line-through":"none"}}>{isPlus?"+":"−"}{(tx.amount||0).toLocaleString()}P</span>
              <span style={{flex:1,color:T.text,fontSize:10,display:"flex",alignItems:"center",gap:6}}>
                <span>{tx.note||(tx.sale_id?"매출 연동":"")}</span>
                {isPlus && tx.expires_at && !isExpire && <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:expired?"#EEE":"#FFF3E0",color:expired?"#9E9E9E":"#E65100",fontWeight:700,whiteSpace:"nowrap"}}>
                  {expired?"만료됨":`만료 ${new Date(tx.expires_at).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"})}`}
                </span>}
              </span>
              {tx.balance_after != null && !isExpire && <span style={{color:"#888",fontSize:10}}>잔 {tx.balance_after.toLocaleString()}P</span>}
              <button onClick={()=>remove(tx.id)} title="삭제"
                style={{padding:"2px 5px",border:"none",background:"transparent",color:T.danger,cursor:"pointer",fontSize:12}}>🗑</button>
            </div>;
          })
      }
    </div>
  </div>;
}

export default CustomersPage
