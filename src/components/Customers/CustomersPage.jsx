import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, queueAlimtalk, buildTokenSearch } from '../../lib/sb'
import { toDb, fromDb, _activeBizId } from '../../lib/db'
import { genId, todayStr, useScrollRestore, useSessionState, getCustPkgBranchInitial, isMoneyPkg, TTL } from '../../lib/utils'
import { Btn, FLD, Empty, fmt, Spinner, DataTable } from '../common'
import SendSmsModal from '../common/SendSmsModal'
import I from '../common/I'
import { DetailedSaleForm } from '../Timeline/SaleForm'
import { ShareCustModal } from './ShareCustModal'
import { ColHeader as ExcelColHeader } from '../Sales/SalesGridPage'
import ConsentModal from '../Consent/ConsentModal'
import ConsentPanel from '../Consent/ConsentPanel'
import { transliterateName, transliterateBatch, getCachedTransliteration } from '../../lib/nameTransliterate'

const uid = genId;
const _mc = (fn) => { if(fn) fn(); };

const sx = {
  genderBadge: (g) => ({
    fontSize:T.fs.nano, fontWeight:T.fw.bolder, borderRadius:T.radius.sm, padding:"1px 4px",
    background: g==="M" ? T.maleLt : T.femaleLt,
    color:      g==="M" ? T.male   : T.female,
  }),
};

function CustModal({ item, isEdit, onSave, onClose, defBranch, userBranches, branches, serviceTags, memoTemplate, geminiKey }) {
  const isNew = !isEdit;
  const [form, setForm] = React.useState(() => item ? {...item, smsConsent: item.smsConsent !== false, defaultTags: Array.isArray(item.defaultTags) ? item.defaultTags : []} : {id:'cust_'+uid(),name:'',phone:'',gender:'',bid:defBranch||'',memo:'',visits:0, joinDate: new Date().toISOString().slice(0,10), smsConsent: true, defaultTags: []});
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const [korBusy, setKorBusy] = React.useState(false);
  const _isEnName = form.name && !/[가-힣]/.test(form.name);
  const requestKor = async () => {
    if (!form.name || !geminiKey || !_isEnName) return;
    setKorBusy(true);
    try {
      const k = await transliterateName(form.name, geminiKey);
      if (k) f('nameKor', k);
    } finally { setKorBusy(false); }
  };
  return <div style={{position:'fixed',inset:0,zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.45)',padding:'4vh 12px'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:T.bgCard,borderRadius:T.radius.lg,padding:24,width:'100%',maxWidth:440,maxHeight:'92vh',overflowY:'auto',boxShadow:T.shadow.md}}>
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
        <FLD label="한글 음역 (외국인 이름용)">
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input className="inp" value={form.nameKor||''} onChange={e=>f('nameKor',e.target.value)} placeholder={_isEnName?"예: 존 스미스 (자동 음역 가능)":"영문 이름일 때만 사용"} style={{flex:1}}/>
            {_isEnName && <button type="button" onClick={requestKor} disabled={korBusy||!geminiKey} title={!geminiKey?"Gemini API 키가 필요해요":""}
              style={{padding:"6px 10px",fontSize:11,fontWeight:700,border:"1px solid "+T.primary,background:T.primaryLt||"#ede9fe",color:T.primaryDk,borderRadius:6,cursor:(korBusy||!geminiKey)?"wait":"pointer",fontFamily:"inherit",whiteSpace:"nowrap",opacity:(korBusy||!geminiKey)?0.6:1}}>
              {korBusy?"음역 중…":"⚡ 자동"}
            </button>}
          </div>
        </FLD>
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
        <FLD label="예약태그">
          <div style={{padding:"8px 10px",border:"1px solid "+T.border,borderRadius:T.radius.md,background:"#FAFAFC"}}>
            <div style={{fontSize:11,color:T.textSub,marginBottom:6,lineHeight:1.5}}>이 고객의 새 예약(수동·네이버·AI)에 자동으로 부착될 태그를 미리 선택하세요.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {(serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y").sort((a,b)=>(a.sort||0)-(b.sort||0)).map(t=>{
                const sel = (form.defaultTags||[]).includes(t.id);
                return <button key={t.id} type="button" onClick={()=>{
                  const cur = Array.isArray(form.defaultTags)?form.defaultTags:[];
                  f('defaultTags', sel ? cur.filter(x=>x!==t.id) : [...cur, t.id]);
                }} style={{padding:"3px 9px",fontSize:11,fontWeight:700,borderRadius:12,border:"1px solid "+(sel?(t.color||T.primary):T.border),background:sel?(t.color||T.primary):"#fff",color:sel?"#fff":T.gray700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{t.name}</button>;
              })}
              {(serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y").length === 0 && <span style={{fontSize:11,color:T.textMuted}}>등록된 예약태그가 없습니다 (관리설정 → 태그 관리)</span>}
            </div>
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

function CustomersPage({ data, setData, userBranches, isMaster, pendingOpenCust, setPendingOpenCust, setPage, setPendingOpenRes }) {
  const navigate = useNavigate();
  const [q, setQ] = useSessionState("cust_q", "", { ttlMs: TTL.SEARCH });
  const [vb, setVb] = useSessionState("cust_vb", "all", { ttlMs: TTL.TAB });
  // 가입일 범위 필터 (신규 고객 날짜별 보기)
  const [joinFrom, setJoinFrom] = useSessionState("cust_joinFrom", "", { ttlMs: TTL.DATE_RANGE });
  const [joinTo, setJoinTo] = useSessionState("cust_joinTo", "", { ttlMs: TTL.DATE_RANGE });
  // 매출 미발생 고객 숨김 토글 제거됨 (2026-05-05) — 모든 고객 항상 표시
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailCust, setDetailCust] = useState(null);
  const [expandedSaleId, setExpandedSaleId] = useState(null);
  // 풀스크린 상세 레이아웃 — '2col' (좌:380 / 우:매출) | '3col' (좌:260 / 중:360 / 우:매출)
  const [layoutMode, setLayoutMode] = useState(()=>{ try{return localStorage.getItem('cust_layoutMode')||'2col';}catch{return '2col';} });
  useEffect(()=>{ try{localStorage.setItem('cust_layoutMode', layoutMode);}catch{} }, [layoutMode]);
  // 우클릭 컨텍스트 메뉴 — {x, y, cust}
  const [ctxMenu, setCtxMenu] = useState(null);

  // 컬럼 헤더 ▼ 엑셀 스타일 필터 (sessionStorage 영속) — 클라이언트 필터, 페이지 한정
  // v2 (2026-05-05): v1에 빈 Set/잘못된 includeEmpty 등이 저장되어 0건 표시되는 사고 방지 위해 키 변경
  const _CUST_FILT_KEY = 'custList_filters_v2';
  const _defCustFilters = () => ({
    custNum:   { sort: null, min: '', max: '' },
    joinDate:  { sort: null, start: '', end: '', includeEmpty: true },
    custName:  { sort: null, selected: null, includeEmpty: true, enOnly: false },
    custPhone: { sort: null, selected: null, includeEmpty: true },
    custEmail: { sort: null, selected: null, includeEmpty: true },
    bid:       { sort: null, selected: null, includeEmpty: true },
    visitCount:{ sort: null, min: '', max: '' },
    lastVisit: { sort: null, start: '', end: '', includeEmpty: true },
  });
  const [excelFilters, setExcelFilters] = useState(() => {
    // v1 sessionStorage가 있으면 클리어 (구 데이터 무효화)
    try { sessionStorage.removeItem('custList_filters_v1'); } catch {}
    try {
      const raw = sessionStorage.getItem(_CUST_FILT_KEY);
      if (!raw) return _defCustFilters();
      const parsed = JSON.parse(raw);
      Object.keys(parsed).forEach(k => {
        if (parsed[k] && Array.isArray(parsed[k].selected)) {
          if (parsed[k].selected.length === 0) parsed[k].selected = null;
          else parsed[k].selected = new Set(parsed[k].selected);
        }
      });
      return { ..._defCustFilters(), ...parsed };
    } catch { return _defCustFilters(); }
  });
  useEffect(() => {
    try {
      const out = {};
      Object.keys(excelFilters).forEach(k => {
        const f = excelFilters[k];
        if (f?.selected instanceof Set) out[k] = { ...f, selected: [...f.selected] };
        else out[k] = f;
      });
      sessionStorage.setItem(_CUST_FILT_KEY, JSON.stringify(out));
    } catch {}
  }, [excelFilters]);
  const setExcelColFilter = (k, v) => setExcelFilters(prev => {
    const merged = { ...prev[k], ...v };
    let next = { ...prev, [k]: merged };
    if (v.sort) {
      Object.keys(next).forEach(otherK => {
        if (otherK !== k && next[otherK]?.sort) next[otherK] = { ...next[otherK], sort: null };
      });
    }
    return next;
  });
  const [detailTab, setDetailTab] = useSessionState("cust_tab", "pkg", { ttlMs: TTL.TAB }); // "pkg" | "sales"
  // 쉐어 — 보유권/패키지를 공유하는 고객 페어
  const [shareCusts, setShareCusts] = useState([]); // [{id, name, phone, cust_num, shareRowId}]
  const [showShareModal, setShowShareModal] = useState(false);
  // 커플 패키지 파트너 변경 — { pkg, gid, sibling } 또는 null
  const [coupleRepartner, setCoupleRepartner] = useState(null);
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
  const [smsSel, setSmsSel] = useState(()=>new Set()); // 다중 선택된 cust id
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsCusts, setSmsCusts] = useState([]); // 모달에 넘길 고객 배열
  // 🔍 1년+ 잔존 보유권 필터 (note 유효:YYYY-MM-DD > 오늘+364 + 잔여≥1)
  const [longValOnly, setLongValOnly] = useState(false);
  const [longValIds, setLongValIds] = useState(null); // null=미로드, []=결과없음, [..]=cust_id
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
    // 숨김 처리된 고객은 리스트에서 제외 (is_hidden=true 또는 NULL이 아닌 false만 통과)
    parts.push(`is_hidden=not.is.true`);
    // 매장 필터: 특정 지점 선택 시에만 필터, "전체"는 userBranches 무시하고 전 지점 표시
    // (고객 DB는 공유 자산 — 어느 지점에서든 고객 조회 가능)
    if (vb !== "all") parts.push(`bid=eq.${vb}`);
    // 가입일 범위 필터 (신규 고객 날짜별 조회)
    if (joinFrom) parts.push(`join_date=gte.${joinFrom}`);
    if (joinTo) parts.push(`join_date=lte.${joinTo}`);
    // 매출 미발생 고객(cust_num_int IS NULL)도 항상 포함 (예약중인 신규 고객 누락 방지)
    // 🔍 longValOnly 활성 시 fetchPage가 RPC 분기를 사용 — buildFilter는 호출 안 됨
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
    // 정렬: created_at(DB INSERT 시각) 내림차순 단일
    // join_date.desc는 빈 문자열("")이 NULL 아니라 정렬 맨 뒤로 밀려 신규 고객 첫 페이지 누락
    // (Julia aquilino, cust_id_wgcw2jj26g 누락 케이스, 2026-05-05 fix)
    parts.push(`order=created_at.desc.nullslast`);
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
    // 검색어 있을 때 limit 4배 확장 (200) — 검색 결과를 한 번에 더 많이 가져옴
    const _hasSearch = (q && q.trim().length > 0);
    const _limit = _hasSearch ? PAGE_SIZE * 4 : PAGE_SIZE;
    try {
      let rows;
      if (longValOnly) {
        // 🔍 1년+ 잔존 보유권 필터 — RPC로 서버측 처리 (URL 길이 한계 우회)
        const cutoffDt = new Date(); cutoffDt.setDate(cutoffDt.getDate() + 364);
        const cutoff = cutoffDt.getFullYear() + '-' + String(cutoffDt.getMonth() + 1).padStart(2, '0') + '-' + String(cutoffDt.getDate()).padStart(2, '0');
        const tokens = (q||"").trim().split(/\s+/).filter(Boolean);
        const r = await fetch(`${SB_URL}/rest/v1/rpc/get_long_validity_customers_paged`, {
          method: 'POST',
          headers: {...sbHeaders, 'Content-Type':'application/json'},
          body: JSON.stringify({
            p_biz_id: _activeBizId,
            p_cutoff: cutoff,
            p_bid: vb !== "all" ? vb : null,
            p_search: tokens[0] || null,
            p_include_no_num: true,
            p_offset: offset,
            p_limit: _limit,
          }),
        });
        rows = r.ok ? await r.json() : [];
      } else {
        const filter = buildFilter(offset, _limit);
        rows = await sb.get("customers", filter);
      }
      if (myReqId !== reqIdRef.current) return; // 이미 구식 응답 — 무시
      const mapped = fromDb("customers", rows).filter(c => matchesQuery(c, q));
      setPagedCusts(prev => reset ? mapped : [...prev, ...mapped]);
      setHasMore(rows.length === _limit);
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
  }, [q, vb, joinFrom, joinTo, pendingOpenCust, longValOnly]);

  // 스크롤 핸들러: 하단 근접 시 다음 페이지 로드
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasMore && !loading) {
      fetchPage(pagedCusts.length, false);
    }
  };

  // 컬럼별 unique values (현재 로드된 페이지 기준 — 무한 스크롤로 더 로드되면 자동 확장)
  const _excelUniqueByCol = React.useMemo(() => {
    const u = { custName: new Set(), custPhone: new Set(), custEmail: new Set(), bid: new Set() };
    pagedCusts.forEach(c => {
      if (c.name) u.custName.add(c.name);
      if (c.phone) u.custPhone.add(c.phone);
      if (c.email) u.custEmail.add(c.email);
      if (c.bid) u.bid.add(c.bid);
    });
    return Object.fromEntries(Object.entries(u).map(([k,v]) => {
      const arr = [...v];
      arr.sort((a,b)=>String(a).localeCompare(String(b),'ko'));
      return [k, arr];
    }));
  }, [pagedCusts]);

  const _excelBranchNameMap = React.useMemo(() => {
    const m = {};
    (data?.branches||[]).forEach(b => { m[b.id] = b.short || b.name || b.id; });
    return m;
  }, [data?.branches]);

  const _matchExcelSet = (val, f) => {
    if (!f) return true;
    const isEmpty = !val || (typeof val === 'string' && !val.trim());
    if (isEmpty) return f.includeEmpty !== false;
    if (f.selected instanceof Set) return f.selected.has(val);
    return true;
  };

  // 내부일정용으로 잘못 생성된 cust 제외 (이름이 청소/오픈/재고 등 키워드 + phone/cust_num 둘 다 비어있음)
  const _isInternalScheduleCust = (c) => {
    if ((c.phone||'').trim() || (c.phone2||'').trim() || (c.custNum||'').trim()) return false;
    const nm = (c.name||'').trim();
    return /^(청소|오픈|재고|전일|아침|휴게|이동|바디도움|메모|점심|식사)(\s|\(|$)/.test(nm);
  };

  // 클라이언트 엑셀 필터 + 정렬 적용
  const custs = React.useMemo(() => {
    let rows = pagedCusts.filter(c => !_isInternalScheduleCust(c)).filter(c => {
      const f = excelFilters;
      // 고객번호 (숫자 범위)
      const _num = parseInt(c.custNum) || 0;
      if (f.custNum.min !== '' && _num < Number(f.custNum.min)) return false;
      if (f.custNum.max !== '' && _num > Number(f.custNum.max)) return false;
      // 등록일 (날짜 범위)
      const _jd = c.joinDate || (c.createdAt||'').slice(0,10) || '';
      if (f.joinDate.start && (!_jd || _jd < f.joinDate.start)) return false;
      if (f.joinDate.end   && (!_jd || _jd > f.joinDate.end))   return false;
      if (f.joinDate.includeEmpty === false && !_jd) return false;
      // 이름 (set + enOnly)
      if (!_matchExcelSet(c.name, f.custName)) return false;
      if (f.custName.enOnly) {
        const nm = c.name || '';
        const ko = (nm.match(/[가-힣]/g)||[]).length;
        const en = (nm.match(/[A-Za-z]/g)||[]).length;
        if (ko > 0 || en < 2) return false;
      }
      // 연락처 / 이메일 / 매장 (set)
      if (!_matchExcelSet(c.phone, f.custPhone)) return false;
      if (!_matchExcelSet(c.email, f.custEmail)) return false;
      if (f.bid.selected instanceof Set) {
        if (!c.bid) { if (f.bid.includeEmpty === false) return false; }
        else if (!f.bid.selected.has(c.bid)) return false;
      } else if (f.bid.includeEmpty === false && !c.bid) return false;
      // 방문수 (숫자 범위)
      const _vc = Number(c.visitCount || c.visits || 0);
      if (f.visitCount.min !== '' && _vc < Number(f.visitCount.min)) return false;
      if (f.visitCount.max !== '' && _vc > Number(f.visitCount.max)) return false;
      // 최근방문 (날짜 범위)
      const _lv = (c.lastVisit || '').slice(0,10);
      if (f.lastVisit.start && (!_lv || _lv < f.lastVisit.start)) return false;
      if (f.lastVisit.end   && (!_lv || _lv > f.lastVisit.end))   return false;
      if (f.lastVisit.includeEmpty === false && !_lv) return false;
      return true;
    });
    // 정렬 — 단일 컬럼
    const sortCol = Object.keys(excelFilters).find(k => excelFilters[k]?.sort);
    if (sortCol) {
      const dir = excelFilters[sortCol].sort === 'asc' ? 1 : -1;
      const accessor = {
        custNum:    c => parseInt(c.custNum)||0,
        joinDate:   c => c.joinDate || (c.createdAt||'').slice(0,10) || '',
        custName:   c => c.name || '',
        custPhone:  c => c.phone || '',
        custEmail:  c => c.email || '',
        bid:        c => _excelBranchNameMap[c.bid] || '',
        visitCount: c => Number(c.visitCount||c.visits||0),
        lastVisit:  c => (c.lastVisit||'').slice(0,10),
      }[sortCol];
      if (accessor) {
        rows = [...rows].sort((a,b) => {
          const va = accessor(a), vb = accessor(b);
          if (typeof va === 'number' && typeof vb === 'number') return (va-vb)*dir;
          return String(va).localeCompare(String(vb), 'ko') * dir;
        });
      }
    }
    return rows;
  }, [pagedCusts, excelFilters, _excelBranchNameMap]);

  // 보유권 요약: 유효 다회권(남은회차>0) + 다담권(잔액>0) + 연간권. 쿠폰은 리스트에서 숨김 (상세 패널에서만 표시)
  const pkgSummaryForCust = (cid) => {
    const arr = pkgByCust[cid] || [];
    const out = [];
    const today = todayStr();
    arr.forEach(p => {
      // 쿠폰은 리스트 요약에서 제외 — id가 cpn_로 시작하거나 이름에 "쿠폰"/"할인" 키워드
      const pid = String(p.id||"");
      if (pid.startsWith("cpn_")) return;
      const n = (p.service_name||"");
      const nl = n.toLowerCase();
      // 쿠폰 이름 패턴: "체험 할인", "원할인쿠폰", "할인쿠폰" 등 — 다담권/연간 키워드와 충돌 안 하게 보수적으로
      if (/쿠폰/.test(n)) return;
      const isPrepaid = isMoneyPkg(p);
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

  // 활성 비즈의 Gemini 키 추출 (음역 등에 사용)
  const _geminiKey = (() => {
    try {
      const s = (data?.businesses || [])[0]?.settings;
      const parsed = typeof s === 'string' ? JSON.parse(s) : (s || {});
      return parsed?.gemini_key || '';
    } catch { return ''; }
  })();

  // ⚡ 외국 이름 일괄 음역
  const [bulkKor, setBulkKor] = useState(null);
  const runBulkKor = async () => {
    if (!_geminiKey) {
      setBulkKor({ error: 'Gemini API 키가 없어요. 관리설정 → AI 설정에서 등록해 주세요.' });
      return;
    }
    setBulkKor({ loading: true, progress: '대상 고객 조회 중…' });
    try {
      // name_kor IS NULL + business_id 필터로 가져온 뒤 클라이언트에서 영문 이름만 필터
      const rows = await sb.get('customers', `&business_id=eq.${_activeBizId}&name_kor=is.null&select=id,name,name_kor&limit=2000`);
      const targets = (rows || []).filter(c => c.name && !/[가-힣]/.test(c.name));
      if (targets.length === 0) {
        setBulkKor({ items: [], totalScanned: rows?.length || 0 });
        return;
      }
      setBulkKor({ loading: true, progress: `0/${targets.length} 음역 중…`, total: targets.length });
      const map = await transliterateBatch(
        targets.map(c => c.name),
        _geminiKey,
        { concurrency: 3, onProgress: (i, n) => setBulkKor({ loading: true, progress: `${i}/${n} 음역 중…`, total: n }) }
      );
      const items = targets
        .map(c => ({ id: c.id, name: c.name, kor: map.get(String(c.name).trim()) || '' }))
        .filter(x => x.kor);
      setBulkKor({ items, totalScanned: targets.length });
    } catch (e) {
      console.error('[bulkKor] fail', e);
      setBulkKor({ error: String(e?.message || e) });
    }
  };
  const applyBulkKor = async () => {
    if (!bulkKor?.items?.length) return;
    if (!confirm(`${bulkKor.items.length}명의 고객에 한글 음역을 채웁니다. 진행할까요?`)) return;
    setBulkKor(p => ({ ...p, applying: true }));
    let ok = 0, fail = 0;
    for (const it of bulkKor.items) {
      try {
        await sb.update('customers', it.id, { name_kor: it.kor });
        ok++;
      } catch (e) { fail++; console.error('update fail', it.id, e); }
    }
    if (setData) setData(prev => prev ? {
      ...prev,
      customers: (prev.customers||[]).map(c => {
        const it = bulkKor.items.find(x => x.id === c.id);
        if (!it) return c;
        return { ...c, nameKor: it.kor };
      })
    } : prev);
    setPagedCusts(prev => prev.map(c => {
      const it = bulkKor.items.find(x => x.id === c.id);
      if (!it) return c;
      return { ...c, nameKor: it.kor };
    }));
    alert(`자동 음역 적용 완료 — 성공 ${ok}명${fail?`, 실패 ${fail}명`:''}`);
    setBulkKor(null);
  };

  const handleSave = async (item, isEdit) => {
    const normalized = {...item, phone: (item.phone || "").replace(/[^0-9]/g, "")};
    // 외국인 이름 자동 음역 — name이 영문이고 nameKor 비어있으면 Gemini로 채움
    if (normalized.name && !/[가-힣]/.test(normalized.name) && !normalized.nameKor && _geminiKey) {
      try {
        const k = await transliterateName(normalized.name, _geminiKey);
        if (k) normalized.nameKor = k;
      } catch {}
    }

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

  // 상세 패널 인라인 필드 저장 — patch는 toDb 변환된 일부 키
  const saveCustField = async (patch, localPatch) => {
    if (!detailCust) return;
    try {
      await sb.update("customers", detailCust.id, patch);
      const merged = { ...detailCust, ...(localPatch || {}) };
      setDetailCust(merged);
      setPagedCusts(prev => prev.map(x => x.id === detailCust.id ? merged : x));
      setData(prev => ({ ...prev, customers: (prev?.customers || []).map(x => x.id === detailCust.id ? merged : x) }));
    } catch(e) { console.error('saveCustField', e); alert('필드 저장 실패: ' + (e?.message||'')); }
  };
  // 상세 패널 바뀌면 편집 모드 해제
  useEffect(() => { setEditingMemo(false); setMemoDraft(""); }, [detailCust?.id]);

  // 동의서(customer_consents.form_data.survey) 기반 빈 칸 자동 채움 (이메일·성별·전화)
  // 문진 표시는 customers.survey(detailCust.survey)에서 직접 읽음
  useEffect(() => {
    const cid = detailCust?.id;
    if (!cid) return;
    let cancelled = false;
    (async () => {
      const rows = await sb.get("customer_consents", `&customer_id=eq.${cid}&form_data=not.is.null&order=created_at.desc&limit=1`).catch(() => []);
      if (cancelled || !rows?.length) return;
      const fd = rows[0].form_data;
      if (!fd || typeof fd !== "object") return;
      const sv = (fd.survey && typeof fd.survey === "object") ? fd.survey : {};
      // 빈 칸만 자동 채움 (이메일·성별·전화) — 이미 값 있으면 안 건드림
      const _str = (x) => (typeof x === "string" ? x : (x && typeof x === "object" ? (x.value || "") : "")).toString().trim();
      const patch = {}, local = {};
      const email = _str(sv.email) || _str(fd.email);
      if (email && !detailCust.email) { patch.email = email; local.email = email; }
      const gRaw = _str(sv.gender);
      const gender = gRaw === "여" || gRaw === "F" ? "F" : (gRaw === "남" || gRaw === "M" ? "M" : "");
      if (gender && !detailCust.gender) { patch.gender = gender; local.gender = gender; }
      const phone = _str(sv.phone).replace(/[^0-9]/g, "");
      if (phone && !detailCust.phone) { patch.phone = phone; local.phone = phone; }
      if (Object.keys(patch).length) saveCustField(patch, local);
    })();
    return () => { cancelled = true; };
  }, [detailCust?.id]);
  // 풀스크린 상세 모달: ESC 닫기
  useEffect(() => {
    if (!detailCust) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetailCust(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailCust?.id]);

  const [custSales, setCustSales] = useState([]);
  const [custReservations, setCustReservations] = useState([]);
  const [bottomTab, setBottomTab] = useState("sales"); // 우하 카드 탭: "sales" | "res"
  const [custPkgsServer, setCustPkgsServer] = useState([]);
  // 동의서 모달 (선택된 고객 오브젝트 있으면 열림)
  const [consentCust, setConsentCust] = useState(null);
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
      // 🆕 쉐어 등록 시 — 현재 고객의 모든 보유권에 "쉐어:Y" 플래그 자동 ON (디폴트 공유)
      // (이미 쉐어:Y인 권은 그대로, 없는 권만 추가)
      try {
        const pkgs = (custPkgsServer||[]);
        const targets = pkgs.filter(p => !/\|\s*쉐어:Y/.test(p.note||""));
        if (targets.length > 0) {
          await Promise.all(targets.map(p => {
            const curNote = p.note || "";
            const newNote = curNote ? `${curNote} | 쉐어:Y` : `쉐어:Y`;
            return sb.update("customer_packages", p.id, { note: newNote }).catch(()=>{});
          }));
          // 로컬 state 즉시 갱신
          setCustPkgsServer(prev => prev.map(p => {
            if (/\|\s*쉐어:Y/.test(p.note||"")) return p;
            const curNote = p.note || "";
            return { ...p, note: curNote ? `${curNote} | 쉐어:Y` : `쉐어:Y` };
          }));
        }
      } catch(e) { console.warn("[addShare] auto-enable share flag failed", e); }
    } catch(e) { alert("쉐어 등록 실패: "+e.message); }
  };
  const removeShare = async (shareRowId, name) => {
    if (!confirm(`${name||'이 고객'}과의 쉐어를 해제할까요?`)) return;
    try {
      await sb.del("customer_shares", shareRowId);
      setShareCusts(prev => prev.filter(s => s.shareRowId !== shareRowId));
    } catch(e) { alert("해제 실패: "+e.message); }
  };

  // ── 커플 패키지 파트너 변경 ──
  // 커플 보유권 2행은 note의 "커플:<gid>"로 묶임. 짝(sibling) 행을 찾아 새 상대방으로 이전.
  const openCoupleRepartner = async (pkg) => {
    const gid = (pkg?.note||"").match(/커플:([A-Za-z0-9]+)/)?.[1];
    if (!gid) { alert("커플 패키지 정보를 찾을 수 없습니다."); return; }
    try {
      const rows = await sb.get("customer_packages", `&note=ilike.*${encodeURIComponent("커플:"+gid)}*`);
      const sibling = (rows||[]).find(r => r.id !== pkg.id && r.customer_id !== detailCust?.id)
        || (rows||[]).find(r => r.id !== pkg.id);
      if (!sibling) { alert("연결된 커플 상대방 보유권을 찾을 수 없습니다.\n(상대방 보유권이 삭제되었을 수 있습니다)"); return; }
      setCoupleRepartner({ pkg, gid, sibling });
    } catch(e) { alert("커플 정보 조회 실패: " + (e?.message||e)); }
  };
  const applyCoupleRepartner = async (newPartner) => {
    if (!coupleRepartner || !newPartner?.id) return;
    const { sibling } = coupleRepartner;
    if (newPartner.id === detailCust?.id) { alert("현재 고객 본인은 상대방이 될 수 없습니다."); return; }
    if (newPartner.id === sibling.customer_id) { setCoupleRepartner(null); return; }
    if ((sibling.used_count||0) > 0 && !confirm(`현재 상대방이 이미 ${sibling.used_count}회 사용했습니다.\n사용 이력을 포함해 새 상대방에게 그대로 이전됩니다. 계속할까요?`)) return;
    try {
      const oldOwner = sibling.customer_id;
      await sb.update("customer_packages", sibling.id, { customer_id: newPartner.id });
      // customer_shares 갱신 — detailCust ↔ oldOwner 연결을 newPartner로 재지정
      if (detailCust?.id) {
        const shares = await sb.get("customer_shares", `&or=(and(cust_id_a.eq.${detailCust.id},cust_id_b.eq.${oldOwner}),and(cust_id_a.eq.${oldOwner},cust_id_b.eq.${detailCust.id}))`);
        if (shares && shares[0]) {
          const sh = shares[0];
          await sb.update("customer_shares", sh.id, sh.cust_id_a === oldOwner ? { cust_id_a: newPartner.id } : { cust_id_b: newPartner.id });
        } else {
          await sb.insert("customer_shares", { id:"share_"+Math.random().toString(36).slice(2,10), business_id:_activeBizId, cust_id_a: detailCust.id, cust_id_b: newPartner.id });
        }
      }
      setCoupleRepartner(null);
      if (detailCust?.id) loadShares(detailCust.id);
      alert(`커플 상대방이 '${newPartner.name}'(으)로 변경되었습니다.`);
    } catch(e) { alert("파트너 변경 실패: " + (e?.message||e)); }
  };

  useEffect(() => {
    if (!detailCust) { setCustSales([]); setCustReservations([]); setCustPkgsServer([]); setCustResStats({total:0,noshow:0,samedayCancel:0,samedayChange:0}); setCustPointTx([]); setShareCusts([]); setLoadingDetail(false); return; }
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
      sb.get("reservations", `&cust_id=eq.${detailCust.id}&select=id,reservation_id,status,date,time,bid,staff_id,selected_services,is_schedule,updated_at,prev_reservation_id&order=date.desc&limit=2000`)
        .then(rows => {
          // 예약 내역 탭용 — 내부일정 제외
          setCustReservations((rows||[]).filter(r => !r.is_schedule));
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
        setDetailTab("pkg");
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

  // 패키지 타입 판별 — 카테고리 우선, fallback으로 이름 substring
  const pkgType = (p) => {
    const svc = (data?.services||[]).find(s => s.name === p.service_name);
    if (svc) {
      const catName = (data?.categories||[]).find(c => c.id === svc.cat)?.name;
      if (catName === '쿠폰') return "coupon";
      if (catName === '선불권') return "prepaid";
      if (catName === '회원권') return "annual";
      if (catName === '패키지') return "package";
    }
    const n = (p.service_name||"").toLowerCase();
    if (isMoneyPkg(p)) return "prepaid";
    if (n.includes("연간") || n.includes("할인권") || n.includes("회원권") || n.includes("구독")) return "annual";
    return "package";
  };

  // 인라인 편집용 input 스타일 — 디스플레이 텍스트와 같은 폰트, 밑줄만 표시 (레이아웃 흔들림 최소화)
  const INLINE_EDIT_INPUT_STYLE_NUM = (w) => ({
    display:"inline-block",
    width: w,
    fontSize:"inherit",
    fontWeight:"inherit",
    fontFamily:"inherit",
    color: T.primary,
    padding:"0 2px",
    margin:0,
    border:"none",
    borderBottom:"1.5px solid "+T.primary,
    borderRadius:0,
    background:"transparent",
    textAlign:"right",
    boxSizing:"border-box",
    outline:"none",
    MozAppearance:"textfield",
    WebkitAppearance:"none",
    lineHeight:"inherit",
    verticalAlign:"baseline"
  });

  // 다회권/다담권/연간할인권 카드
  const PkgCard = ({p}) => {
    const [branchDropOpen, setBranchDropOpen] = useState(false);
    const triggerBtnRef = React.useRef(null);
    const panelRef = React.useRef(null);
    const [panelPos, setPanelPos] = useState({top:0,left:0});
    useEffect(() => {
      if (!branchDropOpen) return;
      const r = triggerBtnRef.current?.getBoundingClientRect();
      if (r) setPanelPos({top: r.bottom + 4, left: r.left});
      const onDoc = (e) => {
        if (panelRef.current && !panelRef.current.contains(e.target) && !triggerBtnRef.current?.contains(e.target)) setBranchDropOpen(false);
      };
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [branchDropOpen]);
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
    const isCoupon = type === "coupon";
    const isDone = notStarted ? false : (isPrepaid ? (balance <= 0 || isExpired) : isAnnual ? isExpired : (remain <= 0 || isExpired));

    // 타입별 카드 바탕색 (활성 상태일 때만 — 만료/소진은 회색 통일)
    // 회원권=파랑 / 다담권=녹색(돈) / 패키지=보라 / 쿠폰=옅은노랑 — 색상 명확히 분리
    const typeBg = isDone ? T.gray100
      : isCoupon ? "#FEFCE8"
      : isPrepaid ? "#ECFDF5"
      : isAnnual ? "#EFF6FF"
      : "#F5F3FF"; // package
    // 만료 시에만 빨강 테두리 강조, 그 외엔 그림자만
    const cardShadow = isDone
      ? "none"
      : isExpired
        ? "0 0 0 1px "+T.danger+"55, 0 2px 6px rgba(0,0,0,0.06)"
        : "0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)";

    return <div style={{border:"none",borderRadius:T.radius.md,padding:"8px 10px",background:typeBg,boxShadow:cardShadow,width:"100%",minWidth:0,minHeight:145,height:"100%",opacity:isDone?0.55:1,display:"flex",flexDirection:"column",justifyContent:"flex-start",overflow:"hidden",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        <span style={{fontSize:9,padding:"1px 5px",borderRadius:T.radius.full,fontWeight:T.fw.bolder,
          background:isCoupon?"#FCD34D"+"33":isPrepaid?T.orange+"22":isAnnual?T.info+"22":T.primaryLt,
          color:isCoupon?"#92400E":isPrepaid?T.orange:isAnnual?T.info:T.primary}}>
          {isCoupon?"쿠폰":isPrepaid?"선불":isAnnual?"연간":"다회"}
        </span>
        <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.service_name}</span>
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
          return <button onClick={toggleShare}
            title={isShared ? "쉐어 공유 중 — 클릭하면 해제" : "클릭하면 쉐어 고객도 이 보유권 사용 가능"}
            style={{padding:"1px 6px",fontSize:9,fontWeight:T.fw.bolder,borderRadius:8,
              border:"1px solid "+(isShared?"#7C3AED":T.gray300),
              background:isShared?"#7C3AED":"#fff",
              color:isShared?"#fff":T.gray500,
              cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",letterSpacing:0.3}}>
            쉐어
          </button>;
        })()}
        {(() => {
          const _cgid = (p.note||"").match(/커플:([A-Za-z0-9]+)/)?.[1];
          if (!_cgid) return null;
          return <button onClick={(e)=>{e.stopPropagation(); openCoupleRepartner(p);}}
            title="커플 패키지 — 상대방 변경"
            style={{padding:"1px 6px",fontSize:9,fontWeight:T.fw.bolder,borderRadius:8,
              border:"1px solid #8B5CF6",background:"#fff",color:"#7C3AED",
              cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",letterSpacing:0.3}}>
            파트너변경
          </button>;
        })()}
      </div>

      {/* 다담권(선불): 잔액 표시 */}
      {isPrepaid && <div>
        <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:balance>0?T.primary:T.textMuted,marginBottom:4}}>
          {balance.toLocaleString()}<span style={{fontSize:T.fs.xxs,color:T.textMuted}}>원</span>
        </div>
        <div style={{fontSize:T.fs.xxs,color:T.gray700,marginBottom:6,fontWeight:T.fw.bold}}>
          {pkgEditId === p.id ? (
            <>충전 <input type="text" inputMode="numeric" defaultValue={charged.toLocaleString()} id={`pkg-edit-total-${p.id}`}
              onInput={(e)=>{ const raw=e.target.value.replace(/[^\d]/g,""); e.target.value = raw ? Number(raw).toLocaleString() : ""; }}
              style={INLINE_EDIT_INPUT_STYLE_NUM(70)}/>
            {" / 사용 "}<input type="text" inputMode="numeric" defaultValue={(p.used_count||0).toLocaleString()} id={`pkg-edit-used-${p.id}`}
              onInput={(e)=>{ const raw=e.target.value.replace(/[^\d]/g,""); e.target.value = raw ? Number(raw).toLocaleString() : ""; }}
              style={INLINE_EDIT_INPUT_STYLE_NUM(70)}/></>
          ) : (
            <>충전 {charged.toLocaleString()} / 사용 {spent.toLocaleString()}</>
          )}
        </div>
      </div>}

      {/* 연간할인권: 유효기간 표시 (카운트 없음, 회원가 자동 적용) */}
      {isAnnual && <div>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:isExpired?T.danger:T.info,marginBottom:4}}>
          {isExpired ? "만료" : "이용중"} {expiry ? `(~${expiry})` : ""}
        </div>
        <div style={{fontSize:T.fs.nano,color:T.textMuted,marginBottom:6}}>유효기간 내 회원가 자동 적용 (시술상품관리에서 회원가 설정)</div>
      </div>}

      {/* 쿠폰: 1회용 — 사용 가능 / 사용됨 상태만 표시 */}
      {isCoupon && <div style={{marginBottom:6}}>
        {(p.used_count||0) > 0 ? (
          <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:T.radius.sm,background:T.gray200,color:T.gray500,fontSize:T.fs.xxs,fontWeight:T.fw.bolder,textDecoration:"line-through"}}>
            <I name="check" size={10}/> 사용됨
          </span>
        ) : (
          <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:T.radius.sm,background:"#FCD34D33",color:"#92400E",fontSize:T.fs.xxs,fontWeight:T.fw.bolder}}>
            <I name="ticket" size={10}/> 사용 가능
          </span>
        )}
      </div>}

      {/* 일반 다회권: 5칸 박스 디자인 (1,2,3,...번호 + 사용분 사선 비활성화). 1회권/쿠폰은 표시 X */}
      {!isPrepaid && !isAnnual && !isCoupon && (p.total_count > 1 || pkgEditId === p.id) && <div style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:6,flexWrap:"wrap"}}>
        {pkgEditId === p.id ? (
          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary,display:"inline-flex",alignItems:"baseline",gap:2}}>
            사용 <input type="text" inputMode="numeric" defaultValue={(p.used_count||0).toLocaleString()} id={`pkg-edit-used-${p.id}`}
              onInput={(e)=>{ const raw=e.target.value.replace(/[^\d]/g,""); e.target.value = raw ? Number(raw).toLocaleString() : ""; }}
              style={INLINE_EDIT_INPUT_STYLE_NUM(40)}/>
            {" / 총 "}<input type="text" inputMode="numeric" defaultValue={(p.total_count||0).toLocaleString()} id={`pkg-edit-total-${p.id}`}
              onInput={(e)=>{ const raw=e.target.value.replace(/[^\d]/g,""); e.target.value = raw ? Number(raw).toLocaleString() : ""; }}
              style={INLINE_EDIT_INPUT_STYLE_NUM(40)}/>
            <span style={{fontSize:T.fs.nano,color:T.textMuted,fontWeight:T.fw.bold,marginLeft:2}}>회</span>
          </span>
        ) : p.total_count <= 12 ? (
          // 12회 이하: 박스 디자인
          <div style={{display:"inline-flex",gap:3,flexWrap:"wrap",alignItems:"center"}}>
            {Array.from({length:p.total_count}).map((_,i)=>{
              const used = i < (p.used_count||0);
              return <div key={i} title={used?`${i+1}회 사용됨`:`${i+1}회 (남음)`}
                style={{
                  width:22,height:22,borderRadius:4,
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  fontSize:10,fontWeight:T.fw.black,
                  border:"1px solid "+(used?T.gray300:T.primary),
                  background: used
                    ? "repeating-linear-gradient(45deg, "+T.gray200+" 0, "+T.gray200+" 2px, "+T.gray100+" 2px, "+T.gray100+" 4px)"
                    : "#fff",
                  color: used?T.gray400:T.primary,
                  textDecoration: used?"line-through":"none",
                  flexShrink:0
                }}>{i+1}</div>;
            })}
            <span style={{fontSize:T.fs.nano,color:T.textMuted,fontWeight:T.fw.bold,marginLeft:4}}>
              {remain}/{p.total_count}회
            </span>
          </div>
        ) : (
          // 12회 초과: 텍스트만 (박스가 너무 많아짐)
          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.primary,whiteSpace:"nowrap"}}>
            {remain}<span style={{fontSize:T.fs.nano,color:T.textMuted,fontWeight:T.fw.bold}}>/{p.total_count}회</span>
          </span>
        )}
      </div>}

      {/* 유효기간 (모든 타입 공통, 항상 노출) — 카드 바탕색과 동일. 편집 모드에서만 inline 날짜 + 삭제(×) */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,padding:"4px 8px",borderRadius:T.radius.sm,
        background: isExpired ? T.dangerLt : typeBg}}>
        <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:isExpired?T.danger:expiry?T.gray700:T.gray500,flex:1}}>
          {pkgEditId === p.id ? (
            <>유효 ~<input type="date" defaultValue={expiry || ""} id={`pkg-edit-expiry-${p.id}`}
              style={{...INLINE_EDIT_INPUT_STYLE_NUM(112), textAlign:"left", color:isExpired?T.danger:T.gray700}}/></>
          ) : (
            expiry ? `유효 ~${expiry} ${isExpired?"(만료)":""}` : "유효기간 미설정 (무제한)"
          )}
        </span>
        {/* 편집 모드 + 유효기간 있을 때만 × 버튼 (date input을 비우는 효과) */}
        {pkgEditId === p.id && expiry && <button onClick={(e)=>{
          e.stopPropagation();
          const inp = document.getElementById(`pkg-edit-expiry-${p.id}`);
          if (inp) inp.value = "";
        }} title="유효기간 삭제 (무제한으로 변경 — 저장 눌러야 적용)"
          style={{fontSize:11,padding:"1px 6px",borderRadius:T.radius.sm,border:"none",
            background:"transparent",color:T.danger,cursor:"pointer",fontFamily:"inherit",fontWeight:T.fw.bolder,whiteSpace:"nowrap",lineHeight:1}}>×</button>}
      </div>

      {/* 구매지점 + 추가 허용 지점 (한 줄 통합) */}
      {(() => {
        const isAnnualPkg = /연간(회원|할인)?권/.test(p.service_name || "");
        if (isAnnualPkg) {
          return <div style={{marginBottom:6,padding:"4px 8px",borderRadius:T.radius.sm,background:"#EFF6FF",border:"1px solid #BFDBFE",fontSize:T.fs.nano,color:"#1E40AF",fontWeight:T.fw.bolder,display:"inline-flex",alignItems:"center",gap:4}}>
            <I name="globe" size={10}/> 연간권 — 전 지점 공통
          </div>;
        }
        const curBid = p.branch_id || "";
        const allowed = Array.isArray(p.allowed_branch_ids) ? p.allowed_branch_ids : [];
        const sameGroupBids = (() => {
          const ids = new Set();
          (data?.branchGroups || []).forEach(g => {
            const gb = g.branch_ids || [];
            if (curBid && gb.includes(curBid)) gb.forEach(b => ids.add(b));
          });
          return ids;
        })();
        const candidateBranches = (data?.branches || []).filter(b => b.useYn !== false && b.id !== curBid && !sameGroupBids.has(b.id));
        const saveAllowed = async next => {
          await sb.update("customer_packages", p.id, { allowed_branch_ids: next });
          setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, allowed_branch_ids: next} : x));
        };
        const toggleBid = async bid => {
          const next = allowed.includes(bid) ? allowed.filter(x => x !== bid) : [...allowed, bid];
          await saveAllowed(next);
        };
        const branchById = (bid) => (data?.branches||[]).find(b => b.id === bid);
        const allBranches = (data?.branches || []).filter(b => b.useYn !== false);
        const curBr = allBranches.find(b => b.id === curBid);
        return <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6,flexWrap:"wrap"}}>
          {/* + 지점 추가 dropdown 트리거 (맨 앞) */}
          <button ref={triggerBtnRef} type="button" onClick={()=>setBranchDropOpen(v=>!v)}
            title="사용 가능 지점 선택 (구매지점은 자동 체크)"
            style={{width:22,height:22,padding:0,fontSize:14,fontWeight:T.fw.black,border:"1px dashed "+T.gray400,borderRadius:"50%",background:"#fff",color:T.gray600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,flexShrink:0}}>
            +
          </button>
          {/* 상단 chip — 구매지점(강조) + 추가 허용 */}
          {curBr && <span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:T.primaryLt||"#EDE9FE",color:T.primaryDk||T.primary,fontWeight:T.fw.bolder,display:"inline-flex",alignItems:"center",gap:3,border:"1px solid "+(T.primary||"#7C3AED")+"55"}} title="구매지점">
            <I name="building" size={9}/> {curBr.short || curBr.name}
          </span>}
          {!curBid && <span style={{fontSize:10,color:T.danger,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3}}>
            <I name="building" size={9}/> 미판정
          </span>}
          {allowed.map(bid => {
            const b = branchById(bid);
            if (!b) return null;
            return <span key={bid} style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"#FEF3C7",color:"#92400E",fontWeight:700,display:"inline-flex",alignItems:"center",gap:2,border:"1px solid #FDE68A"}}>
              {b.short || b.name}
              <button onClick={() => toggleBid(bid)} style={{border:"none",background:"none",color:"#92400E",cursor:"pointer",padding:0,fontSize:11,lineHeight:1}}>×</button>
            </span>;
          })}
          {branchDropOpen && (
            <div ref={panelRef}
              style={{position:"fixed",top:panelPos.top,left:panelPos.left,background:"#fff",border:"1px solid "+T.border,borderRadius:8,boxShadow:"0 6px 20px rgba(0,0,0,.12)",zIndex:9999,minWidth:170,padding:"4px 0",maxHeight:280,overflowY:"auto"}}>
              <div style={{padding:"6px 10px 4px",fontSize:9,color:T.textMuted,fontWeight:T.fw.bold,letterSpacing:0.3,textTransform:"uppercase",borderBottom:"1px solid "+T.gray100,marginBottom:2}}>사용 가능 지점</div>
              {allBranches.map(b => {
                const isPurchase = b.id === curBid;
                const isAllowed = allowed.includes(b.id);
                const isChecked = isPurchase || isAllowed;
                const onClick = async () => {
                  if (isPurchase) {
                    // 구매지점 해제 — 그 다음 첫 allowed가 새 구매지점이 되거나 null
                    const newPurchase = allowed[0] || null;
                    const newAllowed = allowed.slice(1);
                    await sb.update("customer_packages", p.id, { branch_id: newPurchase, allowed_branch_ids: newAllowed });
                    setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, branch_id: newPurchase, allowed_branch_ids: newAllowed} : x));
                  } else if (isAllowed) {
                    // 추가 허용 해제
                    const newAllowed = allowed.filter(x => x !== b.id);
                    await sb.update("customer_packages", p.id, { allowed_branch_ids: newAllowed });
                    setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, allowed_branch_ids: newAllowed} : x));
                  } else {
                    // 새로 체크 — 구매지점 없으면 여기로, 있으면 allowed에 추가
                    if (!curBid) {
                      await sb.update("customer_packages", p.id, { branch_id: b.id });
                      setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, branch_id: b.id} : x));
                    } else {
                      const newAllowed = [...allowed, b.id];
                      await sb.update("customer_packages", p.id, { allowed_branch_ids: newAllowed });
                      setCustPkgsServer(prev => prev.map(x => x.id === p.id ? {...x, allowed_branch_ids: newAllowed} : x));
                    }
                  }
                };
                return <div key={b.id} onClick={onClick}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",fontSize:11,cursor:"pointer",background:isChecked?(isPurchase?T.primary+"10":"#FFFBEB"):"transparent",color:isChecked?(isPurchase?T.primaryDk:"#92400E"):T.gray700,fontWeight:isChecked?700:500,whiteSpace:"nowrap"}}
                  onMouseEnter={e=>{ if (!isChecked) e.currentTarget.style.background=T.gray100; }}
                  onMouseLeave={e=>{ if (!isChecked) e.currentTarget.style.background="transparent"; }}>
                  <span style={{display:"inline-flex",width:14,height:14,border:"1.5px solid "+(isChecked?(isPurchase?T.primary:"#D97706"):T.gray400),borderRadius:3,alignItems:"center",justifyContent:"center",background:isChecked?(isPurchase?T.primary:"#D97706"):"#fff",flexShrink:0}}>
                    {isChecked && <I name="check" size={9} color="#fff"/>}
                  </span>
                  <span style={{flex:1}}>{b.short || b.name}</span>
                  {isPurchase && <span style={{fontSize:8,padding:"1px 5px",borderRadius:6,background:T.primary,color:"#fff",fontWeight:T.fw.bolder}}>구매</span>}
                </div>;
              })}
            </div>
          )}
        </div>;
      })()}

      {/* 쉐어 토글은 카드 우상단으로 이동 (헤더 inline) */}

      {/* 액션 버튼 — ghost 스타일 (카드 컬러를 가리지 않게 톤 다운) */}
      <div style={{display:"flex",gap:4,marginTop:"auto",paddingTop:6,alignItems:"center"}}>
        {/* 편집/저장 — 연간권은 유효기간만, 다른 타입은 카운트+유효기간 */}
        {(pkgEditId === p.id ? (
          <>
            <button onClick={(e)=>{
              const sc = e.currentTarget.closest('[data-pkg-scroll]');
              const sTop = sc ? sc.scrollTop : 0;
              setPkgEditId(null);
              if (sc) requestAnimationFrame(() => { sc.scrollTop = sTop; });
            }} style={{flex:1,padding:"4px 8px",fontSize:T.fs.nano,background:"transparent",border:"none",borderRadius:6,color:T.gray500,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,0.05)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>취소</button>
            <Btn variant="primary" size="sm" style={{flex:2,justifyContent:"center",fontSize:T.fs.nano}} onClick={(e)=>{
              const sc = e.currentTarget.closest('[data-pkg-scroll]');
              const sTop = sc ? sc.scrollTop : 0;
              const newTotal = Number((document.getElementById(`pkg-edit-total-${p.id}`)?.value || "").replace(/,/g,"") || p.total_count);
              const newUsed = Number((document.getElementById(`pkg-edit-used-${p.id}`)?.value || "").replace(/,/g,"") || p.used_count);
              const newExpiryRaw = (document.getElementById(`pkg-edit-expiry-${p.id}`)?.value || "").trim();
              if (isNaN(newTotal) || isNaN(newUsed) || newTotal < 0 || newUsed < 0) return alert("0 이상 숫자만 입력 가능합니다");
              if (newUsed > newTotal) return alert(isPrepaid ? "사용액이 충전액보다 클 수 없습니다" : "사용횟수가 총횟수보다 클 수 없습니다");
              if (newExpiryRaw && !/^\d{4}-\d{2}-\d{2}$/.test(newExpiryRaw)) return alert("유효기간은 YYYY-MM-DD 형식으로 입력해주세요");
              const updates = {total_count: newTotal, used_count: newUsed};
              // note 갱신 — 잔액 + 유효기간 통합 처리
              let curNote = p.note || "";
              if(isPrepaid) {
                const newBal = Math.max(0, newTotal - newUsed);
                curNote = curNote.includes("잔액:")
                  ? curNote.replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`)
                  : (curNote ? `잔액:${newBal.toLocaleString()} | ${curNote}` : `잔액:${newBal.toLocaleString()}`);
              }
              // 유효기간 변경 처리 (빈 값 = 무제한 = 유효: 토큰 제거)
              if (newExpiryRaw !== (expiry || "")) {
                if (newExpiryRaw) {
                  curNote = expiry
                    ? curNote.replace(/유효:\d{4}-\d{2}-\d{2}/, `유효:${newExpiryRaw}`)
                    : (curNote ? `${curNote} | 유효:${newExpiryRaw}` : `유효:${newExpiryRaw}`);
                } else {
                  // 유효기간 삭제
                  const parts = curNote.split(" | ").map(s=>s.trim()).filter(s=>s && !/^유효:/.test(s));
                  curNote = parts.length > 0 ? parts.join(" | ") : "";
                }
              }
              if (curNote !== (p.note || "")) updates.note = curNote || null;
              sb.update("customer_packages",p.id,updates).catch(console.error);
              setCustPkgsServer(prev=>prev.map(x=>x.id===p.id?{...x,...updates}:x));
              // 변경분 트랜잭션 기록 — 사용량 변동(usedDelta) + 충전·총회수 변동(totalDelta)
              const usedDelta = newUsed - (p.used_count||0);
              const totalDelta = newTotal - (p.total_count||0);
              const unit = isPrepaid ? "won" : "count";
              const balBefore = isPrepaid ? balance : ((p.total_count||0) - (p.used_count||0));
              const balAfter = isPrepaid ? Math.max(0, newTotal - newUsed) : (newTotal - newUsed);
              if (usedDelta !== 0) {
                recordPkgTx(p, usedDelta > 0 ? "deduct" : "charge", Math.abs(usedDelta), unit,
                  balBefore, balAfter, `편집: ${isPrepaid?"사용액":"사용횟수"} ${p.used_count||0}→${newUsed}`);
              }
              if (totalDelta !== 0) {
                recordPkgTx(p, totalDelta > 0 ? "charge" : "deduct", Math.abs(totalDelta), unit,
                  balBefore, balAfter, `편집: ${isPrepaid?"충전액":"총횟수"} ${p.total_count||0}→${newTotal}`);
              }
              setPkgEditId(null);
              if (sc) requestAnimationFrame(() => { sc.scrollTop = sTop; });
            }}>저장</Btn>
          </>
        ) : (
          <button onClick={(e)=>{
            const sc = e.currentTarget.closest('[data-pkg-scroll]');
            const sTop = sc ? sc.scrollTop : 0;
            setPkgEditId(p.id);
            if (sc) requestAnimationFrame(() => { sc.scrollTop = sTop; });
          }} style={{flex:1,padding:"4px 8px",fontSize:T.fs.nano,background:"rgba(255,255,255,0.7)",border:"none",borderRadius:6,color:T.primary,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,1)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.7)"}>편집</button>
        ))}
        <button onClick={(e)=>{
          const sc = e.currentTarget.closest('[data-pkg-scroll]');
          const sTop = sc ? sc.scrollTop : 0;
          const willOpen = pkgHistoryOpen !== p.id;
          setPkgHistoryOpen(willOpen ? p.id : null);
          if (willOpen) loadPkgHistory(p.id);
          if (sc) requestAnimationFrame(() => { sc.scrollTop = sTop; });
        }} title="이력 보기" style={{padding:"4px 6px",fontSize:T.fs.nano,background:"transparent",border:"none",borderRadius:6,color:T.gray700,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}
        onMouseEnter={e=>{e.currentTarget.style.background="rgba(0,0,0,0.06)"; e.currentTarget.style.color=T.text;}}
        onMouseLeave={e=>{e.currentTarget.style.background="transparent"; e.currentTarget.style.color=T.gray700;}}><I name="clock" size={13}/></button>
        <button onClick={()=>{
          if(!confirm("삭제하시겠습니까?")) return;
          sb.del("customer_packages",p.id).catch(console.error);
          setCustPkgsServer(prev=>prev.filter(x=>x.id!==p.id));
        }} title="삭제" style={{padding:"4px 6px",fontSize:T.fs.nano,background:"transparent",border:"none",borderRadius:6,color:T.gray600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}
        onMouseEnter={e=>{e.currentTarget.style.background=T.danger+"15"; e.currentTarget.style.color=T.danger;}}
        onMouseLeave={e=>{e.currentTarget.style.background="transparent"; e.currentTarget.style.color=T.gray600;}}><I name="trash" size={13}/></button>
      </div>
      {/* 히스토리 뷰 */}
      {pkgHistoryOpen === p.id && <div style={{marginTop:8,borderTop:"1px solid "+T.gray400,paddingTop:8,maxHeight:220,overflowY:"auto",overflowX:"hidden"}}>
        <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.text,marginBottom:6,display:"inline-flex",alignItems:"center",gap:4,letterSpacing:0.3,textTransform:"uppercase"}}><I name="clock" size={11}/> 이력</div>
        {!pkgHistoryMap[p.id] ? (
          <div style={{fontSize:11,color:T.gray700,padding:"4px 0"}}>로딩중...</div>
        ) : pkgHistoryMap[p.id].length === 0 ? (
          <div style={{fontSize:11,color:T.gray700,padding:"4px 0"}}>내역 없음</div>
        ) : pkgHistoryMap[p.id].map(tx => {
          const isPlus = tx.type === "charge" || tx.type === "adjust_add";
          const lbl = ({charge:"충전",deduct:"차감",adjust_add:"+조정",adjust_sub:"-조정",cancel:"취소"})[tx.type]||tx.type;
          const unitS = tx.unit === "count" ? "회" : "원";
          return <div key={tx.id} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 0",borderBottom:"1px dotted "+T.gray400,fontSize:11,minWidth:0,overflow:"hidden"}}>
            <span style={{color:T.text,fontSize:11,fontWeight:T.fw.bold,flexShrink:0,whiteSpace:"nowrap"}}>{new Date(tx.created_at).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"})}</span>
            <span style={{fontWeight:T.fw.black,color:isPlus?"#1B5E20":"#B71C1C",fontSize:11,flexShrink:0,whiteSpace:"nowrap"}}>{isPlus?"+":"-"}{(tx.amount||0).toLocaleString()}{unitS}</span>
            {tx.sale_id && <span style={{display:"inline-flex",alignItems:"center",color:T.primaryDk||T.primary,flexShrink:0}} title={tx.sale_id}><I name="wallet" size={11}/></span>}
            <span style={{color:T.text,fontSize:11,flex:1,textAlign:"right",fontWeight:T.fw.bold,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.staff_name || tx.note || ""}</span>
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
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <Btn variant="primary" onClick={()=>{setEditItem(null);setShowModal(true)}}><I name="plus" size={12}/> 고객 등록</Btn>
      </div>
    </div>
    {bulkKor && !bulkKor.loading && <div style={{marginBottom:14,padding:"12px 14px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10}}>
      {bulkKor.error ? <div style={{color:T.danger,fontSize:12}}>오류: {bulkKor.error} <button onClick={()=>setBulkKor(null)} style={{marginLeft:8,padding:"2px 8px",border:"1px solid "+T.border,borderRadius:6,background:"#fff",cursor:"pointer"}}>닫기</button></div>
      : <>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:800,color:"#92400E"}}>⚡ 일괄 음역 결과</span>
          <span style={{fontSize:11,color:T.gray700}}>대상 {bulkKor.totalScanned||0}명 중 <b style={{color:"#B45309"}}>{bulkKor.items.length}명</b>에 한글 음역 적용 예정</span>
          <button onClick={()=>setBulkKor(null)} style={{marginLeft:"auto",padding:"3px 8px",fontSize:11,border:"1px solid "+T.border,borderRadius:6,background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>닫기</button>
        </div>
        {bulkKor.items.length === 0 ? <div style={{fontSize:12,color:T.gray600,padding:"6px 0"}}>음역할 외국 이름 손님이 없어요. 모든 외국 이름이 이미 채워져 있거나 영문 이름이 없습니다.</div>
        : <>
          <div style={{maxHeight:340,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,background:"#fff"}}>
            <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,background:"#F9FAFB",borderBottom:"1px solid "+T.border}}>
                <tr style={{textAlign:"left"}}>
                  <th style={{padding:"6px 8px",fontWeight:700,color:T.gray700}}>영문 이름</th>
                  <th style={{padding:"6px 8px",fontWeight:700,color:T.gray700}}>→ 한글 음역</th>
                </tr>
              </thead>
              <tbody>
                {bulkKor.items.slice(0, 200).map(it => <tr key={it.id} style={{borderBottom:"1px solid "+T.gray100}}>
                  <td style={{padding:"4px 8px",fontWeight:600}}>{it.name}</td>
                  <td style={{padding:"4px 8px",color:"#B45309",fontWeight:600}}>{it.kor}</td>
                </tr>)}
              </tbody>
            </table>
            {bulkKor.items.length > 200 && <div style={{padding:"6px 8px",fontSize:11,color:T.gray500,textAlign:"center",borderTop:"1px solid "+T.gray100,background:"#F9FAFB"}}>외 {bulkKor.items.length - 200}명 (저장 시 모두 적용)</div>}
          </div>
          <div style={{display:"flex",gap:6,marginTop:10}}>
            <button onClick={applyBulkKor} disabled={bulkKor.applying}
              style={{padding:"8px 18px",fontSize:13,fontWeight:800,border:"none",borderRadius:8,background:bulkKor.applying?T.gray400:"#F59E0B",color:"#fff",cursor:bulkKor.applying?"wait":"pointer",fontFamily:"inherit"}}>
              {bulkKor.applying ? "적용 중…" : `✓ ${bulkKor.items.length}명 모두 적용`}
            </button>
            <button onClick={()=>setBulkKor(null)} disabled={bulkKor.applying}
              style={{padding:"8px 14px",fontSize:13,fontWeight:600,border:"1px solid "+T.border,borderRadius:8,background:"#fff",color:T.gray700,cursor:bulkKor.applying?"wait":"pointer",fontFamily:"inherit"}}>
              취소
            </button>
          </div>
        </>}
      </>}
    </div>}

    {/* 검색 & 필터 */}
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{position:"relative",flex:1,minWidth:200,maxWidth:360}}>
        <I name="search" size={13} color={T.gray400} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:30,height:30,borderRadius:T.radius.md,fontSize:T.fs.xs}} placeholder="이름·전화·메모 (공백 구분 다단어 예: 정우 8008)" value={q} onChange={e=>{unlockSingleAndReload();setQ(e.target.value);}}/>
      </div>
      <select className="inp" style={{maxWidth:130,width:"auto",height:30,borderRadius:T.radius.md,fontSize:T.fs.xs,padding:"4px 8px"}} value={vb} onChange={e=>{unlockSingleAndReload();setVb(e.target.value);}}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>{custs.length}명{hasMore?"+":""}</span>
      {searching && <span style={{fontSize:T.fs.xxs,color:T.orange}}>검색중...</span>}
      {/* 컬럼 ▼ 필터 전체 초기화 — sessionStorage도 클리어 */}
      <button type="button"
        onClick={()=>{
          setExcelFilters(_defCustFilters());
          try { sessionStorage.removeItem(_CUST_FILT_KEY); } catch {}
        }}
        title="컬럼 ▼ 필터 모두 해제"
        style={{padding:"4px 10px",fontSize:11,fontWeight:600,borderRadius:6,border:"1px solid "+T.border,background:"#fff",color:T.textSub,cursor:"pointer",fontFamily:"inherit",height:30}}>
        ↺ 필터 초기화
      </button>
      {/* 📱 선택 고객에게 문자 발송 */}
      <button type="button"
        onClick={()=>{
          const list = (custs||[]).filter(c => smsSel.has(c.id));
          setSmsCusts(list); setSmsOpen(true);
        }}
        title={smsSel.size===0 ? "직접 번호 입력해서 문자 발송" : `${smsSel.size}명에게 문자 발송`}
        style={{padding:"4px 12px",fontSize:14,fontWeight:800,borderRadius:T.radius.md,border:"1px solid "+T.primaryDk,background:T.primary,color:"#fff",cursor:"pointer",fontFamily:"inherit",height:30,boxShadow:"0 1px 3px rgba(124,58,237,.35)",display:"inline-flex",alignItems:"center",gap:4}}>
        ✉ {smsSel.size>0?`(${smsSel.size})`:""}
      </button>
    </div>

    {/* 무한 스크롤 고객 리스트 */}
    <div ref={scrollRef} onScroll={onScroll} style={{maxHeight:"calc(100vh - 220px)",overflowY:"auto",border:"1px solid "+T.border,borderRadius:T.radius.md}}>
    {(()=>{
      const paged = custs;
      return <>
      {paged.length===0 && !loading
        ? <div style={{textAlign:"center",padding:"40px 0",color:T.textMuted}}><I name="users" size={24}/><div style={{marginTop:8,fontSize:T.fs.xs}}>고객 없음</div></div>
        : <DataTable card maxHeight="calc(100vh - 220px)">
            <thead><tr>
              <th style={{width:30,textAlign:"center"}}>
                <input type="checkbox" title="현재 페이지 전체 선택"
                  checked={paged.length>0 && paged.every(c=>smsSel.has(c.id))}
                  onChange={e=>{
                    setSmsSel(prev=>{
                      const next = new Set(prev);
                      if (e.target.checked) paged.forEach(c=>next.add(c.id));
                      else paged.forEach(c=>next.delete(c.id));
                      return next;
                    });
                  }}/>
              </th>
              <ExcelColHeader label="고객번호" columnKey="custNum"   type="number" filter={excelFilters.custNum}   onChange={v=>setExcelColFilter('custNum',v)}   alignRight={true}/>
              <ExcelColHeader label="등록일"   columnKey="joinDate"  type="date"   filter={excelFilters.joinDate}  onChange={v=>setExcelColFilter('joinDate',v)}/>
              <ExcelColHeader label="이름"     columnKey="custName"  type="set"    uniqueValues={_excelUniqueByCol.custName}  filter={excelFilters.custName}  onChange={v=>setExcelColFilter('custName',v)}/>
              <ExcelColHeader label="연락처"   columnKey="custPhone" type="set"    uniqueValues={_excelUniqueByCol.custPhone} filter={excelFilters.custPhone} onChange={v=>setExcelColFilter('custPhone',v)}/>
              <ExcelColHeader label="이메일"   columnKey="custEmail" type="set"    uniqueValues={_excelUniqueByCol.custEmail} filter={excelFilters.custEmail} onChange={v=>setExcelColFilter('custEmail',v)}/>
              <ExcelColHeader label="매장"     columnKey="bid"       type="set"    uniqueValues={_excelUniqueByCol.bid}       filter={excelFilters.bid}       onChange={v=>setExcelColFilter('bid',v)}       branchNameMap={_excelBranchNameMap}/>
              <ExcelColHeader label="방문수"   columnKey="visitCount" type="number" filter={excelFilters.visitCount} onChange={v=>setExcelColFilter('visitCount',v)} alignRight={true}/>
              <ExcelColHeader label="최근방문" columnKey="lastVisit" type="date"   filter={excelFilters.lastVisit} onChange={v=>setExcelColFilter('lastVisit',v)}/>
              <th style={{width:160}}>보유권</th>
              <th style={{width:70}}></th>
            </tr></thead>
            <tbody>
            {paged.map(c => {
              const br = (data.branches||[]).find(b=>b.id===c.bid);
              const isOpen = detailCust?.id===c.id;
              // 정보 편집 helper — 좌상 카드 (컴팩트 3열)
              const renderInfoEdit = () => (
                <div key={"info_"+c.id} className="cust-fs-info-grid" style={{padding:"8px 10px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,fontSize:T.fs.xxs,overflowY:"auto",height:"100%",alignContent:"start",boxSizing:"border-box"}}>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>이름</span>
                    <input defaultValue={c.name||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.name||"")) saveCustField({name:v},{name:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>이름 2</span>
                    <input defaultValue={c.name2||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.name2||"")) saveCustField({name2:v||null},{name2:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>한글 음역</span>
                    <input defaultValue={c.nameKor||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.nameKor||"")) saveCustField({name_kor:v||null},{nameKor:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>고객번호</span>
                    <input defaultValue={c.custNum||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.custNum||"")) saveCustField({cust_num:v||null},{custNum:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"monospace",color:T.text,fontWeight:T.fw.bold,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>가입일</span>
                    <input type="date" defaultValue={c.joinDate||""}
                      onBlur={e=>{const v=e.target.value; if(v!==(c.joinDate||"")) saveCustField({join_date:v||null},{joinDate:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>이메일</span>
                    <input defaultValue={c.email||""} placeholder="" type="email"
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.email||"")) saveCustField({email:v||null},{email:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>연락처</span>
                    <input defaultValue={c.phone||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.phone||"")) saveCustField({phone:v},{phone:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <label style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>연락처 2</span>
                    <input defaultValue={c.phone2||""} placeholder=""
                      onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.phone2||"")) saveCustField({phone2:v||null},{phone2:v});}}
                      style={{padding:"4px 7px",border:"1px solid "+T.border,borderRadius:5,fontSize:T.fs.xs,fontFamily:"inherit",color:T.text,minWidth:0}}/>
                  </label>
                  <div/>
                  <div style={{display:"flex",flexDirection:"column",gap:1,gridColumn:"1 / -1"}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>성별 / 문자수신</span>
                    <div style={{display:"flex",gap:3}}>
                      {[["F","여"],["M","남"]].map(([v,l])=>(
                        <button key={v} type="button" onClick={()=>{ const cur=c.gender||""; if(v!==cur) saveCustField({gender:v||null},{gender:v}); }}
                          style={{flex:1,padding:"3px 0",fontSize:10,border:"1px solid "+((c.gender||"")===v?T.primary:T.border),background:(c.gender||"")===v?T.primary:"#fff",color:(c.gender||"")===v?"#fff":T.gray700,borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontWeight:(c.gender||"")===v?700:500}}>{l}</button>
                      ))}
                      <span style={{width:1,background:T.border,margin:"0 2px"}}/>
                      {[[true,"수신 동의"],[false,"수신 거부"]].map(([v,l])=>(
                        <button key={String(v)} type="button" onClick={()=>{ const cur=c.smsConsent!==false; if(v!==cur) saveCustField({sms_consent:v},{smsConsent:v}); }}
                          style={{flex:1,padding:"3px 0",fontSize:10,border:"1px solid "+(((c.smsConsent!==false)===v)?(v?T.success:T.danger):T.border),background:((c.smsConsent!==false)===v)?(v?T.success:T.danger):"#fff",color:((c.smsConsent!==false)===v)?"#fff":T.gray700,borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontWeight:((c.smsConsent!==false)===v)?700:500}}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{gridColumn:"1 / -1",display:"flex",flexDirection:"column",gap:4}}>
                    <span style={{color:T.textMuted,fontWeight:T.fw.bold,fontSize:9}}>예약태그 <span style={{fontWeight:500,fontSize:9}}>(새 예약에 자동 부착)</span></span>
                    <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                      {(data?.serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y").sort((a,b)=>(a.sort||0)-(b.sort||0)).map(t=>{
                        const sel = Array.isArray(c.defaultTags) && c.defaultTags.includes(t.id);
                        return <button key={t.id} type="button" onClick={()=>{
                          const cur = Array.isArray(c.defaultTags)?c.defaultTags:[];
                          const next = sel ? cur.filter(x=>x!==t.id) : [...cur, t.id];
                          saveCustField({default_tags:next},{defaultTags:next});
                        }} style={{padding:"3px 8px",fontSize:10,fontWeight:700,borderRadius:11,border:"1px solid "+(sel?(t.color||T.primary):T.border),background:sel?(t.color||T.primary):"#fff",color:sel?"#fff":T.gray700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{t.name}</button>;
                      })}
                      {(data?.serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y").length === 0 && <span style={{fontSize:10,color:T.textMuted}}>등록된 예약태그가 없습니다</span>}
                    </div>
                  </div>
                  {/* 신규차트 문진/설문 응답 — customers.survey (동의서앱이 저장) */}
                  {detailCust?.survey && typeof detailCust.survey === "object" && (()=>{
                    const _sv = (x) => {
                      if (x == null) return "";
                      if (typeof x === "boolean") return x ? "예" : "아니오";
                      if (typeof x === "string") return x;
                      if (Array.isArray(x)) return x.filter(Boolean).join(", ");
                      if (typeof x === "object") {
                        const base = x.value != null ? String(x.value) : (Array.isArray(x.values) ? x.values.filter(Boolean).join(", ") : "");
                        return base + (x.other ? (base ? ", " : "") + x.other : "");
                      }
                      return String(x);
                    };
                    // 알려진 키는 한글 라벨, 모르는 키는 키 그대로 (일반 렌더)
                    const LBL = {
                      skin_type:"피부 타입", concern:"피부 고민", referral:"방문 경로",
                      motivation:"방문 동기", first_waxing:"왁싱 경험", choose_reason:"선택 이유",
                      eumo_range:"음모왁싱 범위", pregnant:"임신 여부",
                      sms_consent:"문자 수신 동의", copy_delivery:"사본 전달", visit_purpose:"방문 목적",
                    };
                    // 상단에 이미 보이는 신원 필드 + 내부 동의 필드는 생략
                    const SKIP = new Set(["name","name2","phone","phone2","email","gender","cust_num","privacy_consent"]);
                    const rows = Object.keys(detailCust.survey)
                      .filter(k => !SKIP.has(k))
                      .map(k => [LBL[k] || k, _sv(detailCust.survey[k])])
                      .filter(([,v]) => v && String(v).trim());
                    if (rows.length === 0) return null;
                    return <div style={{gridColumn:"1 / -1",display:"flex",flexDirection:"column",gap:5,marginTop:2,padding:"9px 11px",background:"#F5F3FF",borderRadius:7}}>
                      <span style={{color:"#6D28D9",fontWeight:T.fw.bolder,fontSize:10,display:"flex",alignItems:"center",gap:4}}><I name="clipboard" size={11}/> 신규차트 문진</span>
                      <div style={{display:"flex",flexDirection:"column",gap:3}}>
                        {rows.map(([l,v])=>(
                          <div key={l} style={{display:"flex",gap:8,fontSize:12,alignItems:"baseline"}}>
                            <span style={{color:T.textMuted,flex:"0 0 84px"}}>{l}</span>
                            <span style={{color:T.text,fontWeight:600,flex:1,minWidth:0}}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>;
                  })()}
                </div>
              );
              // 메모 helper — 좌하 카드
              const renderMemo = () => (
                <div onClick={e=>{ e.stopPropagation(); if(!editingMemo){ setMemoDraft(c.memo||""); setEditingMemo(true); } }}
                  style={{padding:"14px 16px",fontSize:T.fs.xs,color:"#7C5A00",whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.55,cursor:editingMemo?"text":"pointer",overflowY:"auto",position:"relative",height:"100%",boxSizing:"border-box"}}>
                  <div style={{fontWeight:T.fw.bolder,marginBottom:8,display:"flex",alignItems:"center",gap:5,color:"#A16207",fontSize:T.fs.xxs,letterSpacing:0.3,textTransform:"uppercase"}}>
                    <I name="clipboard" size={11}/> 메모
                    {memoSaving && <span style={{marginLeft:6,fontSize:9,color:T.textMuted,fontWeight:500}}>저장중…</span>}
                  </div>
                  {c.serviceSummary && <div onClick={e=>e.stopPropagation()} style={{marginBottom:10,padding:"7px 9px",background:"#EEF2FF",borderRadius:6,fontSize:T.fs.xxs,color:"#4338ca",lineHeight:1.5,cursor:"default"}}>
                    <span style={{fontWeight:800,marginRight:4}}>🔁 단골 시술</span>{c.serviceSummary}
                  </div>}
                  {editingMemo ? (
                    <textarea autoFocus value={memoDraft}
                      onChange={e=>setMemoDraft(e.target.value)}
                      onBlur={saveMemoInline}
                      onKeyDown={e=>{ if(e.key==='Escape'){ setEditingMemo(false); setMemoDraft(""); } }}
                      onClick={e=>e.stopPropagation()}
                      placeholder=""
                      style={{width:"100%",border:"1px solid "+T.primaryLt,borderRadius:6,padding:"6px 8px",fontSize:T.fs.xs,fontFamily:"inherit",background:"#fff",color:"#155a8a",lineHeight:1.55,resize:"none",height:"calc(100% - 28px)",minHeight:80,outline:"none",boxSizing:"border-box"}}/>
                  ) : (
                    <span style={{color:c.memo?"#155a8a":T.gray500,fontStyle:c.memo?"normal":"italic"}}>{c.memo || "메모 추가… (클릭)"}</span>
                  )}
                </div>
              );
              // 매출 패널 helper — 우하단 셀
              const renderSalesPanel = () => (
                <div>
                  {loadingDetail
                    ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 12px"}}>로딩 중...</div>
                    : custSales.length===0
                    ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 12px"}}>매출 기록 없음</div>
                    : custSales.map(s=>{
                        const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
                        const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
                        const total = sv+pr+(s.gift||0);
                        const brName = (data.branches||[]).find(b=>b.id===s.bid)?.short||"";
                        const details = saleDetailMap[s.id];
                        const isOpenSale = expandedSaleId === s.id;
                        const cash = (s.svcCash||0)+(s.prodCash||0);
                        const tr = (s.svcTransfer||0)+(s.prodTransfer||0);
                        const card = (s.svcCard||0)+(s.prodCard||0);
                        const pt = (s.svcPoint||0)+(s.prodPoint||0);
                        const ext = s.externalPrepaid||0;
                        const _items = (details||[]).filter(d=>d && (d.item_kind==='svc'||d.item_kind==='prod'||d.item_kind==='pkg_use'||!d.item_kind));
                        const _names = _items.map(d=>(d.service_name||'').replace(/^\[보유권\s*(사용|차감)\]\s*/,'').trim()).filter(Boolean);
                        const _summary = _names.length>0 ? (_names.slice(0,2).join(' · ') + (_names.length>2?` 외 ${_names.length-2}`:'')) : '';
                        return <div key={s.id} style={{borderBottom:"1px solid "+T.border}}>
                          <div className="sale-row" onClick={()=>setExpandedSaleId(isOpenSale?null:s.id)}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",cursor:"pointer",background:isOpenSale?T.primaryLt||"#EDE9FE":"transparent",borderLeft:isOpenSale?`3px solid ${T.primary}`:"3px solid transparent"}}>
                            <span style={{display:"inline-flex",alignItems:"center",color:T.textMuted,width:12}}><I name={isOpenSale?'chevD':'chevR'} size={11}/></span>
                            <span style={{fontSize:T.fs.xs,fontWeight:T.fw.black,color:T.text,whiteSpace:"nowrap"}}>{s.date}</span>
                            <span style={{fontSize:T.fs.nano,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 6px",whiteSpace:"nowrap"}}>{brName}</span>
                            <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>{s.staffName}</span>
                            {_summary && <span style={{fontSize:T.fs.xxs,color:T.gray600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{_summary}</span>}
                            <span style={{marginLeft:"auto",fontSize:T.fs.xs,fontWeight:T.fw.black,color:T.info,whiteSpace:"nowrap"}}>{fmt(total)}</span>
                          </div>
                          {isOpenSale && <div style={{padding:"8px 14px 12px",background:T.gray100}}>
                            <div style={{display:"flex",gap:12,marginBottom:6,padding:"6px 10px",background:T.bgCard,borderRadius:T.radius.sm}}>
                              <span style={{fontSize:T.fs.xs}}>시술 <b style={{color:T.primary}}>{fmt(sv)}</b></span>
                              <span style={{fontSize:T.fs.xs}}>제품 <b style={{color:T.infoLt2}}>{fmt(pr)}</b></span>
                              <span style={{fontSize:T.fs.xs,marginLeft:"auto"}}>합계 <b style={{color:T.info,fontSize:T.fs.sm}}>{fmt(total)}</b></span>
                            </div>
                            {(cash+tr+card+pt+ext > 0) && <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                              {cash>0 && <span style={{fontSize:T.fs.nano,padding:"2px 7px",borderRadius:T.radius.sm,background:"#FFF3E0",color:"#E65100",fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center",gap:3}}><I name="banknote" size={10}/> 현금 {fmt(cash)}</span>}
                              {tr>0 && <span style={{fontSize:T.fs.nano,padding:"2px 7px",borderRadius:T.radius.sm,background:"#E8F5E9",color:"#2E7D32",fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center",gap:3}}><I name="building" size={10}/> 계좌 {fmt(tr)}</span>}
                              {card>0 && <span style={{fontSize:T.fs.nano,padding:"2px 7px",borderRadius:T.radius.sm,background:"#E3F2FD",color:"#1565C0",fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center",gap:3}}><I name="creditCard" size={10}/> 카드 {fmt(card)}</span>}
                              {pt>0 && <span style={{fontSize:T.fs.nano,padding:"2px 7px",borderRadius:T.radius.sm,background:"#F3E5F5",color:"#6A1B9A",fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center",gap:3}}><I name="star" size={10}/> 포인트 {fmt(pt)}</span>}
                              {ext>0 && <span style={{fontSize:T.fs.nano,padding:"2px 7px",borderRadius:T.radius.sm,background:"#FFEBEE",color:"#C62828",fontWeight:T.fw.bold,display:"inline-flex",alignItems:"center",gap:3}}><I name="pkg" size={10}/> 외부선결제 {fmt(ext)}</span>}
                            </div>}
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
                            {s.memo && <div onMouseDown={e=>e.stopPropagation()}
                              style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"pre-wrap",lineHeight:1.6,background:T.bgCard,borderRadius:T.radius.sm,padding:"6px 8px",userSelect:"text",WebkitUserSelect:"text",cursor:"text"}}>{s.memo}</div>}
                          </div>}
                        </div>;
                      })
                  }
                </div>
              );
              return <React.Fragment key={c.id}>
                <tr style={{cursor:"pointer",background:isOpen?T.primaryHover:"transparent"}}
                  onClick={()=>{ setDetailCust(isOpen?null:c); setDetailTab("pkg"); }}
                  onContextMenu={e=>{ e.preventDefault(); setCtxMenu({x:e.clientX,y:e.clientY,cust:c}); }}>
                  <td style={{textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                    <input type="checkbox" checked={smsSel.has(c.id)}
                      onChange={e=>setSmsSel(prev=>{const n=new Set(prev); if(e.target.checked) n.add(c.id); else n.delete(c.id); return n;})}/>
                  </td>
                  <td style={{fontSize:T.fs.xs,color:T.text,fontWeight:800}}>{c.custNum||"-"}</td>
                  <td style={{fontSize:T.fs.xxs,color:T.textSub,whiteSpace:"nowrap"}}>{c.joinDate||(c.createdAt||"").slice(0,10)||"-"}</td>
                  {(() => {
                    // 영문 이름이면 한글 음역(name_kor)만 인라인 표시. name2는 직원 별칭용이라 음역 fallback으로 쓰지 않음.
                    const _isEn = c.name && !/[가-힣]/.test(c.name);
                    const _kor = _isEn && c.nameKor && /[가-힣]/.test(c.nameKor) ? c.nameKor : '';
                    return <td style={{fontWeight:T.fw.bold}}>
                      {c.gender && <span style={{...sx.genderBadge(c.gender),marginRight:4}}>{c.gender==="F"?"여":"남"}</span>}
                      {c.name}
                      {_kor && <span style={{color:T.primaryDk||"#5B21B6",fontWeight:700,marginLeft:5}}>{_kor}</span>}
                      {c.name2 && <span style={{color:T.textSub,fontWeight:T.fw.normal,marginLeft:4,fontSize:T.fs.xxs}}>({c.name2})</span>}
                      {c.smsConsent===false && <span style={{fontSize:9,color:T.danger,fontWeight:T.fw.bold,marginLeft:4}}>수신거부</span>}
                      {Array.isArray(c.defaultTags) && c.defaultTags.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
                        {c.defaultTags.map(tid => {
                          const tag = (data?.serviceTags||[]).find(t => t.id === tid);
                          if (!tag) return null;
                          return <span key={tid} style={{fontSize:9,padding:"1px 6px",borderRadius:8,background:tag.color||T.primary,color:"#fff",fontWeight:700,whiteSpace:"nowrap"}}>{tag.name}</span>;
                        })}
                      </div>}
                    </td>;
                  })()}
                  <td style={{fontSize:T.fs.xxs,color:T.primary,whiteSpace:"nowrap"}}>
                    {c.phone ? <span style={{cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}
                      title="클릭하면 번호 복사"
                      onClick={async (e)=>{ e.stopPropagation(); try{ await navigator.clipboard.writeText(c.phone); alert(`복사됨: ${c.phone}`);}catch(e){ alert("복사 실패");}}}>{c.phone}</span> : "-"}
                    {c.phone2 && <div style={{color:T.textSub,fontSize:9}}>
                      <span style={{cursor:"pointer"}} title="클릭하면 번호 복사"
                        onClick={async (e)=>{ e.stopPropagation(); try{ await navigator.clipboard.writeText(c.phone2); alert(`복사됨: ${c.phone2}`);}catch(e){}}}>{c.phone2}</span>
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
                    </div>
                  </td>
                </tr>

                {/* 상세 패널 — 풀스크린 모달 (펼침 → 화면 전체 덮음, 한 페이지에서 매출내역까지 다 보이게) */}
                {isOpen && <tr><td colSpan={11} style={{padding:0}}>
                  {createPortal(
                  <div className="cust-fs-overlay" onClick={e=>{if(e.target===e.currentTarget) setDetailCust(null);}}
                    style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,.5)",display:"flex",padding:window.innerWidth<768?"0":"1.5vh 20px",alignItems:"flex-start",justifyContent:"center"}}>
                  <div onClick={e=>e.stopPropagation()} className="cust-fs-modal"
                    style={{background:"#F4F5F7",borderRadius:16,width:"100%",maxWidth:1280,height:"97vh",overflow:"hidden",border:"1px solid "+T.border,position:"relative",display:"flex",flexDirection:"column"}}>
                  <style>{`
                    .cust-fs-modal input,.cust-fs-modal textarea{transition:border-color .15s, background-color .15s;}
                    .cust-fs-modal input:focus,.cust-fs-modal textarea:focus{outline:none;border-color:${T.primary}!important;background:#fff!important;}
                    .cust-fs-modal input:hover:not(:focus),.cust-fs-modal textarea:hover:not(:focus){border-color:#C7CCD3;}
                    .cust-fs-modal .sale-row{transition:background-color .15s;}
                    .cust-fs-modal .sale-row:hover{background:#F8F7FE!important;}
                    .cust-fs-modal .tab-btn{transition:color .15s, border-color .15s, background-color .15s;}
                    .cust-fs-modal .tab-btn:hover{color:${T.primary}!important;background:${T.primary}08!important;}
                    .cust-fs-modal .chip-btn{transition:background-color .15s, border-color .15s;}
                    .cust-fs-modal details.exp-acc > summary{list-style:none;}
                    .cust-fs-modal details.exp-acc > summary::-webkit-details-marker{display:none;}
                    .cust-fs-modal details.exp-acc > summary .exp-chev{transition:transform .15s;}
                    .cust-fs-modal details.exp-acc[open] > summary .exp-chev{transform:rotate(90deg);}
                    /* 모바일: 단일 스크롤 — 오버레이 한 겹만 스크롤 (중첩 스크롤 = iOS 멈춤 버그 방지) */
                    @media (max-width: 767px) {
                      .cust-fs-overlay { display: block !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: touch !important; padding: 0 !important; }
                      .cust-fs-modal { height: auto !important; min-height: 100% !important; max-height: none !important; max-width: 100vw !important; width: 100vw !important; border-radius: 0 !important; overflow: visible !important; }
                      .cust-fs-modal * { max-width: 100% !important; box-sizing: border-box !important; }
                      .cust-fs-grid { display: block !important; grid-template-columns: 1fr !important; padding: 6px 8px 10px !important; gap: 0 !important; overflow: visible !important; }
                      /* 내부 div 중첩 스크롤 전부 해제 → 오버레이만 스크롤 */
                      .cust-fs-grid div { overflow: visible !important; max-height: none !important; }
                      .cust-fs-left, .cust-fs-right { display: flex !important; flex-direction: column !important; gap: 8px !important; min-height: 0 !important; height: auto !important; grid-template-rows: none !important; margin-bottom: 8px !important; }
                      .cust-fs-left > *, .cust-fs-right > * { min-height: 0 !important; height: auto !important; }
                      .cust-fs-pkg-card { min-height: 0 !important; }
                      .cust-fs-modal .cust-fs-header { padding: 10px 14px !important; flex-wrap: wrap !important; gap: 6px !important; }
                      .cust-fs-modal .cust-fs-stats { padding: 4px 8px !important; gap: 8px !important; flex-wrap: wrap !important; margin-left: 0 !important; width: 100% !important; }
                      /* 보유권 그리드 — 3열 → 2열 (모바일 좁아서) */
                      .cust-fs-modal .cust-fs-pkg-grid { grid-template-columns: 1fr 1fr !important; }
                      /* 정보 카드 입력 grid — 모바일은 1열 (필드 폭 확보) */
                      .cust-fs-modal .cust-fs-info-grid { grid-template-columns: 1fr !important; gap: 9px !important; }
                      /* 정보 카드 라벨·버튼 폰트 통일 (9·10px 제각각 → 12px) */
                      .cust-fs-modal .cust-fs-info-grid span { font-size: 12px !important; }
                      .cust-fs-modal .cust-fs-info-grid button { font-size: 12px !important; }
                      /* 포인트 입력줄 — 메모칸이 좁아서 줄바꿈: 1줄 금액·저장 / 2줄 메모 전체폭 */
                      .cust-fs-modal .pt-row { flex-wrap: wrap !important; }
                      .cust-fs-modal .pt-amt { flex: 1 1 auto !important; min-width: 0 !important; }
                      .cust-fs-modal .pt-note { order: 9 !important; flex: 1 1 100% !important; min-width: 0 !important; }
                      /* iOS 자동 zoom 방지 — select 제외 (네이티브 피커라 줌 안 됨, 16px 강제 불필요) */
                      .cust-fs-modal input, .cust-fs-modal textarea { font-size: 16px !important; }
                      /* 보유권 드롭다운 — index.html 전역 select.inp 14px 강제를 눌러 12px로 */
                      .cust-fs-modal select.inp { font-size: 12px !important; }
                    }
                  `}</style>
                  <div className="cust-fs-header" style={{position:"sticky",top:0,zIndex:2,background:"#fff",borderBottom:"1px solid "+T.border,padding:"14px 22px",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:T.text}}>
                      {c.gender && <span style={{...sx.genderBadge(c.gender),marginRight:6}}>{c.gender==="F"?"여":"남"}</span>}
                      {c.name}
                      {c.custNum && <span style={{marginLeft:8,fontSize:T.fs.sm,color:T.textSub,fontWeight:T.fw.normal}}>#{c.custNum}</span>}
                      {c.phone && <span style={{marginLeft:10,fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.normal}}>{c.phone}</span>}
                    </span>
                    {/* 문자 발송 — 이름·전화 바로 옆 */}
                    <button onClick={e=>{e.stopPropagation(); setSmsCusts([c]); setSmsOpen(true);}}
                      title={c.smsConsent===false?"수신거부 고객 — 발송 시 자동 차단":"이 고객에게 문자 발송"}
                      style={{padding:"6px 12px",fontSize:T.fs.xs,fontWeight:T.fw.bolder,border:"1px solid "+T.primary,background:T.primaryLt||"#EDE9FE",color:T.primaryDk||T.primary,borderRadius:8,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                      <I name="msgSq" size={12}/> 문자 발송
                    </button>
                    {/* 통계 — 헤더 가운데 inline */}
                    <div className="cust-fs-stats" style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14,padding:"4px 14px",background:"#F8F9FB",borderRadius:8,border:"1px solid "+T.border}}>
                      {(() => {
                        const _cp = Number(c.cancelPenaltyCount || 0);
                        const _ns = Number(c.noShowCount || 0);
                        if (_cp >= 3 || _ns >= 1) {
                          return <span title={`페널티 취소 ${_cp}회 / 노쇼 ${_ns}회`}
                            style={{fontSize:10,padding:"2px 7px",borderRadius:8,background:"#FFF3E0",color:"#E65100",border:"1px solid #FFB74D",fontWeight:800,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
                            <I name="alert" size={9}/> 주의
                          </span>;
                        }
                        return null;
                      })()}
                      {[
                        {label:"예약",val:custResStats.total,color:T.primary},
                        {label:"노쇼",val:Number(c.noShowCount||0)||custResStats.noshow,color:(Number(c.noShowCount||0)||custResStats.noshow)>0?"#e53e3e":T.gray500},
                        {label:"페널티",val:Number(c.cancelPenaltyCount||0),color:Number(c.cancelPenaltyCount||0)>=3?"#e53e3e":Number(c.cancelPenaltyCount||0)>0?"#dd6b20":T.gray500,title:"전일 21시 이후~예약시각 사이 취소"},
                        {label:"당취",val:custResStats.samedayCancel,color:custResStats.samedayCancel>0?"#dd6b20":T.gray500,title:"당일 취소"},
                        {label:"당변",val:custResStats.samedayChange,color:custResStats.samedayChange>0?"#d97706":T.gray500,title:"당일 변경"}
                      ].map(s=><div key={s.label} title={s.title||""} style={{display:"flex",alignItems:"baseline",gap:3}}>
                        <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>{s.label}</span>
                        <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:s.color}}>{s.val}</span>
                      </div>)}
                    </div>
                    <button onClick={()=>setDetailCust(null)} title="닫기 (ESC)"
                      style={{width:32,height:32,borderRadius:"50%",border:"none",background:"transparent",cursor:"pointer",lineHeight:1,fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",color:T.gray500}}>
                      <I name="x" size={18}/>
                    </button>
                  </div>
                  {/* 외부 2컬럼 grid — 카드형 디자인, gap으로 영역 분리 (모바일: 단일컬럼 + 세로 스크롤) */}
                  <div className="cust-fs-grid" style={{display:"grid",gridTemplateColumns:"480px 1fr",gap:10,padding:"8px 12px 12px",flex:1,minHeight:0,overflow:"hidden",boxSizing:"border-box"}}>
                  {/* 좌측 wrap — 정보(콘텐츠만) / 메모(1fr 큰) / 포인트(여유) */}
                  <div className="cust-fs-left" style={{display:"grid",gridTemplateRows:"auto 1fr 320px",gap:10,minWidth:0,minHeight:0,position:"relative"}}>
                  {/* 좌상 — 정보 편집 카드 */}
                  <div style={{background:"#fff",borderRadius:12,border:"1px solid "+T.border,minWidth:0,minHeight:0,overflow:"hidden"}}>
                    {renderInfoEdit()}
                  </div>
                  {/* 좌중 — 메모 카드 (포인트 위로) */}
                  <div style={{background:"#FFFCF0",borderRadius:12,border:"1px solid #F3D77A",minWidth:0,minHeight:0,overflow:"hidden"}}>
                    {renderMemo()}
                  </div>
                  {/* 좌하 — 포인트 카드 */}
                  <div style={{background:"#fff",borderRadius:12,border:"1px solid "+T.border,minWidth:0,minHeight:0,overflowY:"auto"}}>
                    <PointPanel cust={c} txList={custPointTx} balance={custPointBalance} onReload={()=>loadCustPoints(c.id)}/>
                  </div>
                  </div>
                  {/* 우측 wrap — 보유권 영역에 3열×2줄 들어갈 충분한 높이 보장 (탭 40 + padding 24 + 카드 180×2 + gap 8 ≈ 432) */}
                  <div className="cust-fs-right" style={{display:"grid",gridTemplateRows:"minmax(0, auto) minmax(180px, 1fr)",gap:14,minWidth:0,minHeight:0}}>
                  {/* 우상 — 보유권/포인트/쉐어/동의서 카드 */}
                  <div data-pkg-scroll="1" className="cust-fs-pkg-card" style={{background:"#fff",borderRadius:12,border:"1px solid "+T.border,minWidth:0,minHeight:0,overflowY:"auto",position:"relative"}}>
                    {/* 탭 */}
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                      {[["pkg","보유권 ("+custPkgs.filter(p=>{const t=pkgType(p);const ex=(p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);const isExp=ex&&ex[1]<todayStr();if(isExp)return false;return t==="prepaid"?((p.note||"").match(/잔액:([0-9,]+)/)?.[1]||"0").replace(/,/g,"")>0:(p.total_count-p.used_count)>0;}).length+")","ticket"],["share","쉐어 ("+shareCusts.length+")","users"],["consent","동의서","fileText"]].map(([tab,lbl,icon])=>(
                        <button key={tab} className="tab-btn" onClick={()=>setDetailTab(tab)}
                          style={{padding:"10px 16px",fontSize:T.fs.xs,fontWeight:detailTab===tab?T.fw.bolder:T.fw.medium,
                            color:detailTab===tab?T.primary:T.textSub,background:detailTab===tab?T.primary+"10":"none",border:"none",
                            borderBottom:detailTab===tab?"2px solid "+T.primary:"2px solid transparent",
                            cursor:"pointer",fontFamily:"inherit",marginBottom:-1,display:"inline-flex",alignItems:"center",gap:5,borderRadius:"6px 6px 0 0"}}>
                          <I name={icon} size={12}/> {lbl}
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
                              // 카테고리 기반 분류 (멀티테넌트 — 시술명 substring 매칭 X)
                              const catName = (data?.categories||[]).find(cc=>cc.id===svc.cat)?.name || "";
                              const isAnn = catName === '회원권';
                              const isPre = catName === '선불권';
                              // 선불권: total_count=액면가(원), note에 "잔액:X" 기록
                              // 회원권: 99, 패키지: services.pkgCount > 0 우선 → 이름 정규식 → 5회 fallback
                              const price = Math.max(0, Number(svc.priceF)||0, Number(svc.priceM)||0, Number(svc.price_f)||0, Number(svc.price_m)||0);
                              const dbPkgCount = Number(svc.pkgCount || svc.pkg_count || 0);
                              const nameMatch = (svc.name||"").match(/(\d+)\s*회/);
                              const pkgCountFromName = nameMatch ? parseInt(nameMatch[1]) : 0;
                              const tc = isAnn ? 99 : isPre ? price : (dbPkgCount > 0 ? dbPkgCount : (pkgCountFromName > 0 ? pkgCountFromName : 5));
                              const note = isPre && price > 0 ? `잔액:${price.toLocaleString()} | 충전:${price.toLocaleString()} | 사용:0` : "";
                              const pkg = {id:genId(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
                                service_name:svc.name,total_count:tc,used_count:0,
                                purchased_at:new Date().toISOString(),note,
                                branch_id: (userBranches?.length === 1 ? userBranches[0] : (c.bid || null))};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setCustPkgsServer(prev=>[...prev, pkg]);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">+ 패키지 추가</option>
                            {(() => {
                              const ALLOWED_CATS = new Set(['선불권', '회원권', '패키지']);
                              return (data?.services||[])
                                .filter(s => (s.isActive!==false && s.is_active!==false))
                                .filter(s => {
                                  const catName = (data?.categories||[]).find(cc=>cc.id===s.cat)?.name;
                                  return catName && ALLOWED_CATS.has(catName);
                                })
                                .map(s => {
                                  const p = Math.max(Number(s.priceF)||0, Number(s.priceM)||0, Number(s.price_f)||0, Number(s.price_m)||0);
                                  return <option key={s.id} value={s.id}>{s.name} ({p.toLocaleString()}원)</option>;
                                });
                            })()}
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
                                purchased_at:today.toISOString(),note,
                                branch_id: (userBranches?.length === 1 ? userBranches[0] : (c.bid || null))};
                              sb.insert("customer_packages",pkg).catch(console.error);
                              setCustPkgsServer(prev=>[...prev, pkg]);
                              setData(prev=>({...prev,custPackages:[...(prev.custPackages||[]),pkg]}));
                              e.target.value="";
                            }}>
                            <option value="">쿠폰 발행 (3개월)</option>
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
                          : (() => {
                              const today = todayStr();
                              const _isActive = (p) => {
                                const t = pkgType(p);
                                const expM = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
                                const exp = expM ? expM[1] : "";
                                const isExpired = exp && exp < today;
                                if (isExpired) return false;
                                if (t === "prepaid") {
                                  const balM = (p.note||"").match(/잔액:([0-9,]+)/);
                                  const bal = balM ? Number(balM[1].replace(/,/g,"")) : 0;
                                  return bal > 0;
                                }
                                if (t === "annual") return true;
                                return (p.total_count - p.used_count) > 0;
                              };
                              // 정렬: 활성 우선 → 타입 그룹 (연간/회원/구독 → 다담권 → 다회권 → 쿠폰) → 잔여 많은 순
                              const _typeRank = (t) => t==="annual"?0 : t==="prepaid"?1 : t==="coupon"?3 : 2;
                              const _remain = (p) => {
                                const t = pkgType(p);
                                if (t === "prepaid") {
                                  const balM = (p.note||"").match(/잔액:([0-9,]+)/);
                                  return balM ? Number(balM[1].replace(/,/g,"")) : 0;
                                }
                                if (t === "annual") return 0; // 연간권은 카운트 없음 — 동률 처리
                                return (p.total_count||0) - (p.used_count||0);
                              };
                              const _sorted = [...custPkgs].sort((a,b)=>{
                                const aA=_isActive(a), bA=_isActive(b);
                                if (aA !== bA) return aA?-1:1;
                                const tA = _typeRank(pkgType(a));
                                const tB = _typeRank(pkgType(b));
                                if (tA !== tB) return tA - tB;
                                return _remain(b) - _remain(a); // 잔여 많은 순 desc
                              });
                              const _active = _sorted.filter(_isActive);
                              const _inactive = _sorted.filter(p=>!_isActive(p));
                              return <>
                                <div className="cust-fs-pkg-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                                  {_active.map(p=><PkgCard key={p.id} p={p}/>)}
                                </div>
                                {_active.length === 0 && <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>보유 중인 권한 없음</div>}
                                {_inactive.length > 0 && <details className="exp-acc" style={{marginTop:10}}>
                                  <summary style={{cursor:"pointer",fontSize:T.fs.xxs,color:T.textSub,padding:"6px 8px",background:T.gray100,borderRadius:T.radius.sm,fontWeight:T.fw.bolder,userSelect:"none",display:"flex",alignItems:"center",gap:5}}>
                                    <span className="exp-chev" style={{display:"inline-flex"}}><I name="chevR" size={12}/></span>
                                    <I name="archive" size={12}/> 만료/소진된 권한 더보기 ({_inactive.length}건)
                                  </summary>
                                  <div className="cust-fs-pkg-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
                                    {_inactive.map(p=><PkgCard key={p.id} p={p}/>)}
                                  </div>
                                </details>}
                              </>;
                            })()
                        }
                      </div>}

                      {/* 매출 내역 탭 */}
                      {/* 매출은 layoutMode가 2col/3col일 때 우측 컬럼에 항상 표시 — 좌측 탭 분기는 더 이상 사용하지 않음 (sales 탭 버튼 제거됨) */}
                      {/* 포인트 탭 */}
                      {/* 포인트 탭은 좌측 컬럼으로 이동됨 */}
                      {/* 쉐어 탭 — 보유권·패키지 공유 고객 */}
                      {detailTab==="share" && <div>
                        <div style={{fontSize:11,color:"#5B21B6",marginBottom:10,padding:"8px 10px",background:"#F5F3FF",borderRadius:8,border:"1px solid #DDD6FE"}}>
                          <I name="users" size={13} style={{verticalAlign:"middle",marginRight:4}}/><b>쉐어</b> 고객으로 등록하면 <b>보유권·패키지·다담권</b>을 서로 공유해서 쓸 수 있습니다. 예약·매출등록 시 쉐어 보유권이 "쉐어" 배지와 함께 표시됩니다.
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                          {shareCusts.length === 0 && <div style={{fontSize:12,color:T.textMuted,padding:"20px",flex:1,textAlign:"center"}}>등록된 쉐어 고객 없음</div>}
                          {shareCusts.map(sc => (
                            <span key={sc.id} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:14,background:"#fff",border:"1px solid #C4B5FD",fontSize:12,color:"#5B21B6",fontWeight:600}}>
                              <I name="user" size={11}/> {sc.name}{sc.name2?` (${sc.name2})`:""}
                              {sc.phone && !sc.phone.startsWith("no_phone") && <span style={{color:T.textMuted,fontWeight:400}}>· {sc.phone}</span>}
                              {sc.cust_num && <span style={{fontSize:10,color:T.textMuted}}>#{sc.cust_num}</span>}
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
                      {detailTab==="consent" && <div style={{padding:"6px 2px"}}>
                        <ConsentPanel cust={c} onRequestNew={()=>setConsentCust(c)}/>
                      </div>}
                    </div>
                  </div>
                  {/* 우하 — 매출/예약 내역 카드 (탭) */}
                  <div style={{background:"#fff",borderRadius:12,border:"1px solid "+T.border,minWidth:0,minHeight:0,overflowY:"auto"}}>
                    <div style={{borderBottom:"1px solid "+T.border,background:T.bgCard,position:"sticky",top:0,zIndex:1,display:"flex",alignItems:"center"}}>
                      {[["sales","wallet","매출 내역",custSales.length],["res","calendar","예약 내역",custReservations.length]].map(([k,ic,lbl,cnt])=>(
                        <button key={k} type="button" onClick={()=>setBottomTab(k)}
                          style={{padding:"10px 14px",fontSize:T.fs.xs,fontWeight:bottomTab===k?T.fw.bolder:T.fw.medium,
                            color:bottomTab===k?T.primary:T.textSub,background:"none",border:"none",
                            borderBottom:bottomTab===k?"2px solid "+T.primary:"2px solid transparent",cursor:"pointer",fontFamily:"inherit",
                            display:"inline-flex",alignItems:"center",gap:5}}>
                          <I name={ic} size={13} color={bottomTab===k?T.primary:T.textSub}/>{lbl} ({cnt})
                        </button>
                      ))}
                      {bottomTab==="sales" && (() => {
                        const _t = custSales.reduce((acc,s)=>{const sv=s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;const pr=s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;return acc+sv+pr+(s.gift||0);},0);
                        return _t > 0 ? <span style={{marginLeft:"auto",marginRight:14,fontSize:T.fs.xxs,color:T.info,fontWeight:T.fw.black}}>총 {fmt(_t)}원</span> : null;
                      })()}
                    </div>
                    {bottomTab==="sales" ? renderSalesPanel() : (
                      <div style={{padding:"6px 0"}}>
                        {custReservations.length===0 ? <div style={{padding:24,textAlign:"center",color:T.textMuted,fontSize:T.fs.xs}}>예약 내역이 없습니다</div> :
                          custReservations.map(r => {
                            const br = (data.branches||[]).find(b=>b.id===r.bid);
                            const svcs = (r.selected_services||[]).map(id=>(data.services||[]).find(s=>s.id===id)?.name).filter(Boolean).join(", ");
                            const stMap = {reserved:["예약중","#6366f1"],confirmed:["진행","#2563eb"],completed:["완료","#16a34a"],cancelled:["취소","#9ca3af"],naver_cancelled:["취소","#9ca3af"],no_show:["노쇼","#dc2626"],naver_changed:["변경됨","#d97706"],request:["확정대기","#ea580c"],pending:["확정대기","#ea580c"]};
                            const [stL,stC] = stMap[r.status] || [r.status,"#6b7280"];
                            const _goRes = () => { if (setPendingOpenRes && setPage) { setDetailCust(null); setPendingOpenRes({ ...r, reservationId: r.reservation_id || r.id }); setPage("timeline"); } };
                            return <div key={r.id} onClick={_goRes}
                              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderBottom:"1px solid "+T.gray100,fontSize:T.fs.xs,cursor:(setPendingOpenRes&&setPage)?"pointer":"default"}}
                              onMouseOver={e=>e.currentTarget.style.background=T.primaryLt||"#f3f0ff"} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                              <span style={{fontWeight:T.fw.bolder,color:T.text,minWidth:108,flexShrink:0}}>{r.date} {r.time||""}</span>
                              <span style={{padding:"1px 7px",borderRadius:8,background:stC+"1a",color:stC,fontSize:T.fs.nano,fontWeight:T.fw.bolder,flexShrink:0}}>{stL}</span>
                              {br && <span style={{fontSize:T.fs.nano,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px",flexShrink:0}}>{br.short||br.name}</span>}
                              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.textSub}}>{svcs||"-"}</span>
                            </div>;
                          })}
                      </div>
                    )}
                  </div>
                  </div>
                  </div>
                  </div>
                  </div>
                  , document.body)}
                </td></tr>}
              </React.Fragment>;
            })}
            </tbody>
          </DataTable>}

      {loading && <div style={{textAlign:"center",padding:"12px 0",fontSize:T.fs.xxs,color:T.textMuted}}>불러오는 중...</div>}
      {!loading && hasMore && (
        <div style={{textAlign:"center",padding:"12px 0"}}>
          <button onClick={()=>fetchPage(pagedCusts.length, false)}
            style={{padding:"8px 18px",fontSize:T.fs.xs,fontWeight:T.fw.bolder,
                    border:`1px solid ${T.primary}`,background:T.primaryLt,color:T.primary,
                    borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit"}}>
            ▼ 더 보기 (현재 {pagedCusts.length}명 로드)
          </button>
        </div>
      )}
      {!hasMore && custs.length > 0 && <div style={{textAlign:"center",padding:"12px 0",fontSize:T.fs.xxs,color:T.textMuted}}>— 끝 ({pagedCusts.length}명) —</div>}
      </>;
    })()}
    </div>

    {showModal && <CustModal item={editItem} isEdit={!!editItem?.id} onSave={handleSave}
      onClose={()=>_mc(()=>{setShowModal(false);setEditItem(null)})}
      defBranch={userBranches[0]} userBranches={userBranches} branches={data.branches||[]}
      serviceTags={data?.serviceTags||[]}
      memoTemplate={(()=>{try{const s=typeof (data?.businesses||[])[0]?.settings==='string'?JSON.parse((data.businesses||[])[0].settings):(data?.businesses||[])[0]?.settings||{};return s?.memo_templates?.customer||"";}catch{return "";}})()}
      geminiKey={_geminiKey}/>}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo: editSale.memo||""}}
      branchId={editSale.bid}
      userBranches={userBranches}
      onSubmit={editSale._newMode ? (()=>{ setEditSale(null); }) : handleSaleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))}
      data={data} setData={setData}
      editMode={!editSale._newMode}
      existingSaleId={editSale._newMode ? null : editSale.id}/>}
    {showShareModal && detailCust && createPortal(<ShareCustModal
      baseCust={detailCust}
      existingShareIds={shareCusts.map(s=>s.id)}
      onPick={addShare}
      onClose={()=>setShowShareModal(false)}
      setData={setData}/>, document.body)}
    {coupleRepartner && detailCust && createPortal(<ShareCustModal
      baseCust={detailCust}
      existingShareIds={[]}
      titleLabel="커플 상대방 변경"
      onPick={applyCoupleRepartner}
      onClose={()=>setCoupleRepartner(null)}
      setData={setData}/>, document.body)}
    {consentCust && createPortal(<ConsentModal
      cust={consentCust}
      bizId={_activeBizId}
      data={data}
      onClose={()=>setConsentCust(null)}/>, document.body)}
    {smsOpen && createPortal(<SendSmsModal
      open={smsOpen}
      onClose={()=>{ setSmsOpen(false); setSmsCusts([]); }}
      customers={smsCusts}
      branches={data?.branches || []}
      userBranches={userBranches}
      defaultBranchId={(smsCusts[0]?.bid) || (vb!=='all'?vb:userBranches[0]) || ''}/>, document.body)}
    {ctxMenu && <CustCtxMenu menu={ctxMenu} onClose={()=>setCtxMenu(null)}
      onReserve={c=>{
        // 현재 시각을 5분 단위로 올림
        const _n = new Date();
        let _mn = _n.getHours()*60 + _n.getMinutes();
        _mn = Math.ceil(_mn/5)*5;
        if (_mn >= 24*60) _mn = 24*60-5;
        const _hh = String(Math.floor(_mn/60)).padStart(2,"0");
        const _mm = String(_mn%60).padStart(2,"0");
        const prefill = {
          custId: c.id||"", custName: c.name||"", custPhone: c.phone||"",
          custEmail: c.email||"", custGender: c.gender||"", custName2: c.name2||"",
          bid: c.bid||userBranches[0]||"",
          date: todayStr(), time: `${_hh}:${_mm}`, dur: 30,
        };
        try { sessionStorage.setItem('pendingNewRes', JSON.stringify(prefill)); } catch {}
        navigate('/timeline');
      }}
      onMessage={c=>{ setSmsCusts([c]); setSmsOpen(true); }}
      onSale={c=>{
        setEditSale({
          id: 'new_'+genId(), bid: c.bid||userBranches[0]||'',
          custId: c.id, custName: c.name||'', custPhone: c.phone||'',
          custGender: c.gender||'', custEmail: c.email||'',
          staffId: '', serviceId: null, date: todayStr(), memo: '',
          _newMode: true,
        });
      }}/>}
  </div>;
}

// ═══════════════════════════════════════════
// 고객 행 우클릭 컨텍스트 메뉴 (예약/메시지/매출)
// ═══════════════════════════════════════════
function CustCtxMenu({ menu, onClose, onReserve, onMessage, onSale }) {
  const ref = useRef();
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    const tid = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    document.addEventListener("keydown", onEsc);
    return () => { clearTimeout(tid); document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); };
  }, []);
  // 화면 밖 보정
  const W = 180, H = 130;
  const left = Math.min(menu.x, window.innerWidth - W - 8);
  const top  = Math.min(menu.y, window.innerHeight - H - 8);
  const items = [
    { iconName: "calendar", label: "예약 등록",   onClick: () => onReserve(menu.cust) },
    { iconName: "msgSq",    label: "메시지 보내기", onClick: () => onMessage(menu.cust) },
    { iconName: "wallet",   label: "매출 등록",   onClick: () => onSale(menu.cust) },
  ];
  return createPortal(
    <div ref={ref} onMouseDown={e=>e.stopPropagation()}
      style={{ position:"fixed", top, left, zIndex:10000, background:"#fff",
               border:`1px solid ${T.border}`, borderRadius:8,
               boxShadow:"0 8px 32px rgba(0,0,0,.15)", padding:"4px 0", minWidth:W,
               fontFamily:"inherit" }}>
      <div style={{padding:"6px 12px",borderBottom:`1px solid ${T.border}`,fontSize:11,color:T.textMuted}}>
        {menu.cust.name}{menu.cust.custNum?` · #${menu.cust.custNum}`:""}
      </div>
      {items.map((it, i) => (
        <div key={i} onClick={() => { it.onClick(); onClose(); }}
          style={{ padding:"9px 14px", cursor:"pointer", fontSize:13,
                   display:"flex", alignItems:"center", gap:10, color:T.text }}
          onMouseOver={e=>e.currentTarget.style.background=T.gray100}
          onMouseOut={e=>e.currentTarget.style.background="transparent"}>
          <I name={it.iconName} size={15} color={T.textSub}/>
          <span>{it.label}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════
// 포인트 패널 (고객 상세 탭)
// ═══════════════════════════════════════════
function PointPanel({ cust, txList, balance, onReload }) {
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState("earn"); // earn | deduct
  const [note, setNote] = useState("");
  const [expiryMonths, setExpiryMonths] = useState(3); // 디폴트 3개월 (적립일 기준 3개월 후 자동 만료)
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
      setAmt(""); setNote(""); setExpiryMonths(3); // 디폴트 3개월로 리셋
      onReload();
    } catch (e) { alert("저장 실패: " + e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm("이 포인트 내역을 삭제하시겠어요?")) return;
    try { await sb.del("point_transactions", id); onReload(); }
    catch (e) { alert("삭제 실패: " + e.message); }
  };

  const PRI = T.primary, PRI_DK = T.primaryDk||T.primary, PRI_LT = T.primaryLt||"#EDE9FE";
  return <div style={{padding:"12px 14px",height:"100%",display:"flex",flexDirection:"column",boxSizing:"border-box"}}>
    {/* 잔액 + 입력 */}
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:8,paddingBottom:8,borderBottom:"1px solid "+T.border}}>
      <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.gray700,letterSpacing:0.3,textTransform:"uppercase",display:"inline-flex",alignItems:"center",gap:5}}><I name="star" size={11} color={PRI}/> 포인트</span>
      <span style={{fontSize:18,fontWeight:T.fw.black,color:PRI_DK}}>{balance.toLocaleString()}<span style={{fontSize:11,marginLeft:3,color:T.textSub,fontWeight:T.fw.bold}}>P</span></span>
    </div>
    <div style={{display:"flex",gap:3,marginBottom:6}}>
      {[["earn","+ 적립"],["deduct","− 차감"]].map(([m,l])=>(
        <button key={m} onClick={()=>setMode(m)}
          style={{flex:1,padding:"5px 0",fontSize:11,fontWeight:700,borderRadius:6,border:"1px solid "+(mode===m?PRI:T.border),background:mode===m?PRI:"#fff",color:mode===m?"#fff":T.gray600,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>{l}</button>
      ))}
    </div>
    <div className="pt-row" style={{display:"flex",gap:4,alignItems:"center",marginBottom:6}}>
      <input type="text" inputMode="numeric" value={amt} placeholder="" className="pt-amt"
        onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,""); setAmt(v?Number(v).toLocaleString():"");}}
        style={{flex:"0 0 90px",padding:"5px 8px",fontSize:11,borderRadius:5,border:"1px solid "+T.border,textAlign:"right",fontFamily:"inherit"}}/>
      <span style={{fontSize:10,color:T.textSub}}>P</span>
      <input type="text" value={note} placeholder="" className="pt-note"
        onChange={e=>setNote(e.target.value)}
        style={{flex:1,padding:"5px 8px",fontSize:11,borderRadius:5,border:"1px solid "+T.border,fontFamily:"inherit",minWidth:0}}/>
      <button onClick={submit} disabled={saving||!amt}
        style={{padding:"5px 11px",fontSize:11,fontWeight:700,borderRadius:5,border:"none",background:saving||!amt?T.gray400:PRI,color:"#fff",cursor:saving||!amt?"default":"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>저장</button>
    </div>
    {mode === "earn" && <div style={{display:"flex",gap:3,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
      <span style={{fontSize:10,color:T.textMuted,fontWeight:700}}>유효</span>
      {[[3,"3개월"],[1,"1m"],[6,"6m"],[12,"12m"],[0,"없음"]].map(([m,l])=>(
        <button key={m} onClick={()=>setExpiryMonths(m)} type="button"
          title={m===3?"디폴트 — 적립일 기준 3개월 후 만료":""}
          style={{padding:"2px 7px",fontSize:10,fontWeight:600,borderRadius:4,border:"1px solid "+(expiryMonths===m?PRI:T.border),background:expiryMonths===m?PRI:"#fff",color:expiryMonths===m?"#fff":T.gray600,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>}
    {/* 히스토리 */}
    <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.textMuted,marginBottom:4,letterSpacing:0.3,textTransform:"uppercase",display:"inline-flex",alignItems:"center",gap:4}}>
      <I name="fileText" size={10}/> 내역 ({txList.length})
    </div>
    <div style={{flex:1,minHeight:0,overflowY:"auto",border:"1px solid "+T.border,borderRadius:6,background:"#FAFBFC"}}>
      {txList.length === 0
        ? <div style={{fontSize:11,color:T.textMuted,padding:"12px 0",textAlign:"center"}}>내역 없음</div>
        : txList.map(tx => {
            const isPlus = tx.type === "earn" || tx.type === "adjust_add";
            const isExpire = tx.type === "expire";
            const label = ({earn:"적립",deduct:"차감",adjust_add:"조정+",adjust_sub:"조정-",expire:"만료"})[tx.type]||tx.type;
            const expired = isPlus && tx.expires_at && new Date(tx.expires_at).getTime() <= Date.now();
            const bg = isExpire ? "#F5F5F5" : expired ? "#FAFAFA" : isPlus ? PRI_LT : "#FFEBEE";
            const color = isExpire ? T.gray500 : expired ? T.textMuted : isPlus ? PRI_DK : "#C62828";
            return <div key={tx.id} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderBottom:"1px solid "+T.border,fontSize:10,opacity:expired?0.65:1,background:"#fff"}}>
              <span style={{minWidth:60,color:T.textMuted,fontSize:9}}>{new Date(tx.created_at).toLocaleDateString("ko-KR",{month:"2-digit",day:"2-digit"})}</span>
              <span style={{padding:"1px 6px",borderRadius:4,background:bg,color,fontWeight:700,fontSize:9}}>{label}</span>
              <span style={{fontWeight:800,color,minWidth:60,textAlign:"right",textDecoration:isExpire?"line-through":"none"}}>{isPlus?"+":"−"}{(tx.amount||0).toLocaleString()}P</span>
              <span style={{flex:1,color:T.gray600,fontSize:10,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {tx.note||(tx.sale_id?"매출 연동":"")}
              </span>
              <button onClick={()=>remove(tx.id)} title="삭제"
                style={{padding:"2px 4px",border:"none",background:"transparent",color:T.gray400,cursor:"pointer",display:"inline-flex",alignItems:"center"}}><I name="trash" size={11}/></button>
            </div>;
          })
      }
    </div>
  </div>;
}

export default CustomersPage
