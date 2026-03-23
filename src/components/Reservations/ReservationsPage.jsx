import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, STATUS_LABEL, STATUS_CLR } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { fromDb, toDb } from '../../lib/db'
import { todayStr, pad, fmtDate, getDow, genId } from '../../lib/utils'
import I from '../common/I'
import useTouchDragSort from '../../hooks/useTouchDragSort'

function ReservationList({ data, setData, userBranches, isMaster, setPage, setPendingOpenRes, naverColShow={}, setNaverColShow }) {
  const today = todayStr();
  const dateAnchorRef = React.useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [listModalData, setListModalData] = useState(null);
  const [isMobile, setIsMobile] = useState(()=>window.innerWidth<768);
  React.useEffect(()=>{
    const fn=()=>setIsMobile(window.innerWidth<768);
    window.addEventListener("resize",fn);
    return ()=>window.removeEventListener("resize",fn);
  },[]);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const bizId = data?.business?.id;
      if (bizId) {
        const rows = await sb.getByBiz("reservations", bizId);
        const parsed = fromDb("reservations", rows);
        setData(prev => prev ? {...prev, reservations: parsed} : prev);
      }
    } catch(e) {}
    setRefreshing(false);
  };

  // ── 필터 상태 (localStorage 유지) ──────────────────
  const _ls = () => { try { return JSON.parse(sessionStorage.getItem("bliss_res_filter")||"null")||{}; } catch(e){return{};} };
  const _save = (patch) => { try { sessionStorage.setItem("bliss_res_filter", JSON.stringify({..._ls(),...patch})); } catch(e){} };
  const [startDate, setStartDateRaw] = useState(()=>_ls().startDate||today);
  const [endDate,   setEndDateRaw]   = useState(()=>{ const f=_ls(); if(f.endDate)return f.endDate; const d=new Date(); d.setDate(d.getDate()+6); return fmtLocal(d); });
  const [periodKey, setPeriodKeyRaw] = useState(()=>_ls().periodKey||"7days");
  const [vb,        setVbRaw]        = useState(()=>_ls().vb||"all");
  const [statusFilter, setStatusFilterRaw] = useState(()=>_ls().statusFilter||"all");
  const setStartDate = v => { setStartDateRaw(v); _save({startDate:v}); };
  const setEndDate   = v => { setEndDateRaw(v);   _save({endDate:v});   };
  const setPeriodKey = v => { setPeriodKeyRaw(v); _save({periodKey:v}); };
  const setVb        = v => { setVbRaw(v);        _save({vb:v});        };
  const setStatusFilter = v => { setStatusFilterRaw(v); _save({statusFilter:v}); };
  const [showSheet, setShowSheet] = useState(false);
  const [q, setQ] = useState("");

  // ── 밀도 설정 (localStorage 유지) ─────────────────
  const DENSITY = {
    compact:     { label:"좁게",   cardPad:"8px 12px",  gap:T.sp.xs,  nameSize:T.fs.sm, metaSize:T.fs.xs, showNaver:false },
    comfortable: { label:"보통",   cardPad:"12px 16px", gap:6,  nameSize:T.fs.md, metaSize:T.fs.sm, showNaver:true  },
    spacious:    { label:"넓게",   cardPad:"16px 20px", gap:10, nameSize:T.fs.lg, metaSize:T.fs.sm, showNaver:true  },
  };
  const [density, setDensityRaw] = useState(()=>{ try{return localStorage.getItem("bliss_res_density")||"comfortable";}catch(e){return"comfortable";} });
  const setDensity = v => { setDensityRaw(v); try{localStorage.setItem("bliss_res_density",v);}catch(e){} };
  const D = DENSITY[density] || DENSITY.comfortable;

  // ── 표시 컬럼 설정 ────────────────────────────────
  const [showCols, setShowColsRaw] = useState(()=>{ try{return JSON.parse(localStorage.getItem("bliss_res_cols")||"null")||{phone:true,staff:true,service:true,naver_id:true,prepaid:true,memo:false,naver_info:true};}catch(e){return{phone:true,staff:true,service:true,naver_id:true,prepaid:true,memo:false,naver_info:true};} });
  const setShowCols = v => { setShowColsRaw(v); try{localStorage.setItem("bliss_res_cols",JSON.stringify(v));}catch(e){} };
  const [showColPanel, setShowColPanel] = useState(false);

  // ── 필터 로직 ─────────────────────────────────────
  const inRange = date => {
    if (periodKey==="all"||(!startDate&&!endDate)) return true;
    if (startDate&&endDate) return date>=startDate&&date<=endDate;
    return true;
  };
  // prevReservationId → 다음 예약 맵 (역방향) — res 필터보다 먼저 정의
  const resByPrev = React.useMemo(()=>{
    const m = {};
    (data?.reservations||[]).forEach(r=>{ if(r.prevReservationId) m[r.prevReservationId] = r; });
    return m;
  }, [data?.reservations]);

  // 체인의 head(가장 최신) 찾기
  const getHead = (r) => {
    let cur = r;
    while(resByPrev[cur.reservationId]) cur = resByPrev[cur.reservationId];
    return cur;
  };

  const res = (data?.reservations||[]).filter(r => {
    if (r.type!=="reservation") return false;
    if (!(vb==="all"?userBranches.includes(r.bid):r.bid===vb)) return false;
    const isNaver = r.source==="naver"||r.source==="네이버";
    if (isNaver&&!r.isScrapingDone) return false;
    if (statusFilter!=="all") {
      const cancelGroup = statusFilter==="cancelled"&&(r.status==="cancelled"||r.status==="naver_cancelled");
      if (!cancelGroup&&r.status!==statusFilter) return false;
    }
    if (q) {
      const sq = q.toLowerCase();
      const svc = (data.services||[]).find(s=>s.id===r.serviceId);
      const staff = (data.staff||[]).find(s=>s.id===r.staffId);
      return (r.custName||"").toLowerCase().includes(sq)||(r.custPhone||"").includes(sq)||(svc?.name||"").toLowerCase().includes(sq)||(staff?.dn||"").toLowerCase().includes(sq);
    }
    return inRange(r.date);
  }).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));

  // 체인 멤버인 naver_changed 숨김: 자신을 prevReservationId로 참조하는 더 최신 예약이 있으면 제외
  const resNextSet = new Set((data?.reservations||[]).filter(r=>r.prevReservationId).map(r=>r.prevReservationId));
  const resFinal = res.filter(r => !(r.status==="naver_changed" && resNextSet.has(r.reservationId)));

  // ── 변경 히스토리 체인 구성 ─────────────────────────────────────
  // prev_reservation_id로 체인 연결: 최신 예약(naver_changed 아닌 것)이 대표, 이전 것들이 히스토리
  const [expandedChains, setExpandedChains] = useState({});
  const toggleChain = (id, e) => { e.stopPropagation(); setExpandedChains(p=>({...p,[id]:!p[id]})); };

  // reservation_id → 예약 객체 맵
  const resById = React.useMemo(()=>{
    const m = {};
    (data?.reservations||[]).forEach(r=>{ m[r.reservationId] = r; });
    return m;
  }, [data?.reservations]);

  // 각 예약의 히스토리(이전 체인) 가져오기
  const getChain = (r) => {
    const chain = [];
    let cur = r;
    while(cur?.prevReservationId && resById[cur.prevReservationId]) {
      cur = resById[cur.prevReservationId];
      chain.unshift(cur); // 오래된 것이 앞
    }
    return chain;
  };

  const deleteRes = id => setData(prev=>({...prev,reservations:(prev?.reservations||[]).filter(r=>r.id!==id)}));

  // ── 날짜 라벨 ─────────────────────────────────────
  const fmtShort = ds => {
    if (!ds) return "";
    const d = new Date(ds);
    const dow = ["일","월","화","수","목","금","토"][d.getDay()];
    return `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}.${d.getDate()}(${dow})`;
  };
  const dateLabel = periodKey==="all"?"전체": periodKey==="1day"||startDate===endDate?fmtShort(startDate):`${fmtShort(startDate)} ~ ${fmtShort(endDate)}`;

  // ── 카운트 ─────────────────────────────────────────
  const allRes = (data?.reservations||[]).filter(r=>r.type==="reservation"&&(vb==="all"?userBranches.includes(r.bid):r.bid===vb)&&inRange(r.date));
  const activeRes = allRes.filter(r=>!(r.source==="naver"||r.source==="네이버")||r.isScrapingDone);
  const counts = {all:activeRes.length,confirmed:0,pending:0,completed:0,cancelled:0,no_show:0,naver_changed:0};
  activeRes.forEach(r=>{ if(r.status==="naver_cancelled")counts.cancelled++; else if(counts[r.status]!==undefined)counts[r.status]++; });

  // ── 상태 색상 ─────────────────────────────────────
  const ST = {
    confirmed:      {bg:T.primaryLt,    color:T.primary,    label:"확정"},
    completed:      {bg:T.successLt,    color:T.success,    label:"완료"},
    cancelled:      {bg:T.dangerLt,     color:T.danger,     label:"취소"},
    no_show:        {bg:T.dangerLt,     color:T.danger,     label:"노쇼"},
    pending:        {bg:T.warningLt,    color:T.warning,    label:"대기"},
    naver_cancelled:{bg:T.dangerLt,     color:T.danger,     label:"취소"},
    naver_changed:  {bg:T.maleLt,      color:T.male,    label:"변경"},
  };
  const ROW_BG = {
    naver_cancelled:T.warningLt, naver_changed:T.maleLt,
    cancelled:T.dangerLt, no_show:T.dangerLt,
  };

  const SS = {height:36,borderRadius:T.radius.md,border:"1px solid "+T.border,background:T.bgCard,fontSize:T.fs.sm,padding:"0 12px",cursor:"pointer",fontFamily:"inherit",color:T.text,display:"flex",alignItems:"center",gap:6,outline:"none",boxSizing:"border-box"};

  const STATUS_TABS = [
    {k:"all",      label:"전체"},
    {k:"confirmed",label:"확정"},
    {k:"pending",  label:"대기"},
    {k:"cancelled",label:"취소"},
    {k:"no_show",  label:"노쇼"},
    {k:"naver_changed",label:"변경"},
  ];

  return <div className="page-reservations">
    {/* ── 헤더 ── */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <h2 className="page-title" style={{margin:0}}>예약 목록</h2>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        {/* 밀도 조절 - 모바일 숨김 */}
        {!isMobile && <div style={{display:"flex",borderRadius:T.radius.md,border:"1px solid "+T.border,overflow:"hidden"}}>
          {Object.entries(DENSITY).map(([k,v])=>(
            <button key={k} onClick={()=>setDensity(k)} style={{
              padding:"5px 10px",border:"none",cursor:"pointer",fontFamily:"inherit",
              fontSize:T.fs.xs,fontWeight:density===k?T.fw.bolder:T.fw.normal,
              background:density===k?T.primary:T.bgCard,
              color:density===k?T.bgCard:T.textSub,transition:"all .15s"
            }}>{v.label}</button>
          ))}
        </div>}
        {/* 컬럼 설정 - 모바일 숨김 */}
        {!isMobile && <div style={{position:"relative"}}>
          <Btn variant="ghost" size="sm" onClick={()=>setShowColPanel(p=>!p)} style={{gap:T.sp.xs}}>
            <I name="settings" size={13}/> 컬럼
          </Btn>
          {showColPanel && <div style={{position:"absolute",right:0,top:34,zIndex:200,background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.lg,padding:"14px 16px",boxShadow:T.shadow.md,minWidth:180}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,display:"flex",alignItems:"center",gap:T.sp.xs}}>
                <I name="clock" size={11}/> 타임라인 블록
              </span>
              <button onClick={()=>setShowColPanel(false)} style={{width:18,height:18,borderRadius:"50%",border:"none",background:T.gray100,color:T.gray500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                <I name="x" size={10}/>
              </button>
            </div>
            {[
              ...NAVER_COLS.map(c=>({k:c.key,label:c.label})),
              {k:"직원메모", label:"직원메모"},
            ].map(({k,label})=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:T.sp.sm,padding:"3px 0",cursor:"pointer",fontSize:T.fs.sm,color:T.text}}>
                <input type="checkbox" checked={naverColShow[k]!==false} onChange={()=>setNaverColShow({...naverColShow,[k]:naverColShow[k]===false})}
                  style={{accentColor:T.primary,width:14,height:14}}/>
                {label}
              </label>
            ))}
            <div style={{borderTop:"1px solid "+T.border,margin:"10px 0"}}/>
            <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:6,display:"flex",alignItems:"center",gap:T.sp.xs}}>
              <I name="list" size={11}/> 목록 카드
            </div>
            {[
              {k:"phone",label:"연락처"},{k:"staff",label:"시술자"},{k:"service",label:"시술"},
              {k:"prepaid",label:"예약금"},{k:"naver_id",label:"예약번호"},{k:"naver_info",label:"네이버 정보"},{k:"memo",label:"직원메모"},
            ].map(({k,label})=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:T.sp.sm,padding:"3px 0",cursor:"pointer",fontSize:T.fs.sm,color:T.text}}>
                <input type="checkbox" checked={!!showCols[k]} onChange={()=>setShowCols({...showCols,[k]:!showCols[k]})}
                  style={{accentColor:T.primary,width:14,height:14}}/>
                {label}
              </label>
            ))}
          </div>}
        </div>}
        <Btn variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} style={{gap:T.sp.xs}}>
          <I name="refresh-cw" size={13} style={{animation:refreshing?"spin 1s linear infinite":undefined}}/>{refreshing?"...":"새로고침"}
        </Btn>
      </div>
    </div>

    {/* ── 필터 바 ── */}
    {isMobile ? (
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
        <div style={{display:"flex",gap:6}}>
          <button ref={dateAnchorRef} onClick={()=>setShowSheet(true)} style={{...SS,flex:1,background:T.primaryLt,borderColor:T.primary+"44",color:T.primaryDk,fontWeight:T.fw.bold}}>
            <I name="calendar" size={14} color={T.primary}/>
            <span style={{flex:1,textAlign:"left"}}>{dateLabel}</span>
            <span style={{fontSize:T.fs.xs,opacity:.6}}>▼</span>
          </button>
          <select style={{...SS,flex:1,appearance:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
            <option value="all">전체 매장</option>
            {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:T.gray400}}><I name="search" size={14}/></span>
          <input style={{width:"100%",height:36,borderRadius:T.radius.md,border:"1px solid "+T.border,paddingLeft:36,paddingRight:32,fontSize:T.fs.sm,outline:"none",boxSizing:"border-box",fontFamily:"inherit",color:T.text}} placeholder="고객명, 연락처, 시술, 시술자" value={q} onChange={e=>setQ(e.target.value)}/>
          {q&&<button onClick={()=>setQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:T.gray400,fontSize:T.fs.lg,lineHeight:1}}>×</button>}
        </div>
      </div>
    ) : (
      <div style={{display:"flex",gap:T.sp.sm,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
        <button ref={dateAnchorRef} onClick={()=>setShowSheet(true)} style={{...SS,background:T.primaryLt,borderColor:T.primary+"44",color:T.primaryDk,fontWeight:T.fw.bold,minWidth:140}}>
          <I name="calendar" size={14} color={T.primary}/>
          <span>{dateLabel}</span>
          <span style={{fontSize:T.fs.xs,marginLeft:"auto",opacity:.6}}>▼</span>
        </button>
        <select style={{...SS,flex:1,minWidth:100,appearance:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div style={{position:"relative",flex:2,minWidth:160}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:T.gray400}}><I name="search" size={14}/></span>
          <input style={{width:"100%",height:36,borderRadius:T.radius.md,border:"1px solid "+T.border,paddingLeft:36,paddingRight:32,fontSize:T.fs.sm,outline:"none",boxSizing:"border-box",fontFamily:"inherit",color:T.text}} placeholder="고객명, 연락처, 시술, 시술자" value={q} onChange={e=>setQ(e.target.value)}/>
          {q&&<button onClick={()=>setQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:T.gray400,fontSize:T.fs.lg,lineHeight:1}}>×</button>}
        </div>
      </div>
    )}

    {/* ── 상태 탭 ── */}
    <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
      {STATUS_TABS.map(({k,label})=>{
        const active = statusFilter===k;
        const st = ST[k]||{color:T.gray500};
        const cnt = counts[k]||0;
        return <button key={k} onClick={()=>setStatusFilter(k)} style={{
          height:30,padding:"0 12px",borderRadius:T.radius.full,border:"1.5px solid",
          fontSize:T.fs.sm,fontWeight:active?T.fw.bolder:T.fw.medium,cursor:"pointer",fontFamily:"inherit",
          display:"flex",alignItems:"center",gap:5,transition:"all .15s",
          background:active?st.color:T.bgCard,
          borderColor:active?st.color:T.border,
          color:active?T.bgCard:st.color||T.gray700,
          boxShadow:active?T.shadow.sm:"none",
        }}>
          <span>{label}</span>
          <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,background:active?"rgba(255,255,255,.25)":T.gray200,color:active?T.bgCard:T.textSub,borderRadius:T.radius.full,padding:"1px 6px",lineHeight:"16px"}}>{cnt}</span>
        </button>;
      })}
    </div>

    {/* ── 카드 그리드 ── */}
    {resFinal.length===0 ? <Empty msg="예약이 없습니다" icon="calendar"/> :
    <div style={{display:"flex",flexDirection:"column",gap:D.gap}}>
      {/* 그리드 헤더 - 데스크톱만 */}
      {!isMobile && <div style={{display:"grid",gridTemplateColumns:resGridCols(showCols,density),gap:T.sp.xs,padding:"4px 16px",borderRadius:T.radius.md,background:T.gray200}}>
        <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>날짜·시간</span>
        <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>매장</span>
        <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>고객</span>
        {showCols.service && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>시술</span>}
        {showCols.staff   && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>시술자</span>}
        {showCols.phone   && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>연락처</span>}
        {showCols.prepaid && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>예약금</span>}
        {showCols.naver_id && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>예약번호</span>}
        {showCols.naver_info && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>네이버 정보</span>}
        {showCols.memo    && <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub}}>메모</span>}
        <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.textSub,textAlign:"center"}}>상태</span>
        <span></span>
      </div>}

      {/* 카드 행 */}
      {resFinal.map(r => {
        const svcNames = groupSvcNames(r.selectedServices, data.services||[]);
        const svc = (data.services||[]).find(s=>s.id===r.serviceId);
        const svcDisplay = svcNames.length>0 ? svcNames.join(", ") : (svc?.name||"-");
        const staff = (data.staff||[]).find(s=>s.id===r.staffId);
        const br = (data.branches||[]).find(b=>b.id===r.bid);
        const g = r.custGender||"";
        const st = ST[r.status]||{bg:T.gray100,color:T.gray500,label:r.status};
        const rowBg = ROW_BG[r.status]||T.bgCard;
        const isNaver = r.source==="naver"||r.source==="네이버";
        const naverInfoItems = isNaver ? NAVER_COLS.filter(col=>getNaverVal(r.requestMsg,col.kws)).map(col=>({label:col.label,value:getNaverVal(r.requestMsg,col.kws)})) : [];

        const HIDDEN_STATUSES = ["naver_cancelled","cancelled","naver_changed","no_show"];
        const isHidden = HIDDEN_STATUSES.includes(r.status);
        const handleClick = ()=>{
          if (isHidden) {
            setListModalData(r);
          } else {
            if(setPendingOpenRes) setPendingOpenRes(r);
            if(setPage) setPage("timeline");
          }
        };

        /* ── 모바일 카드 ── */
        const head = getHead(r);
        const isChainMember = head.id !== r.id;
        const chain = isChainMember ? [...getChain(head), head] : getChain(r);
        const hasChain = chain.length > 0;
        const isExpanded = expandedChains[r.id];

        if (isMobile) return <div key={r.id}>
          <div style={{
            background:rowBg, borderRadius:T.radius.lg,
            border:"1px solid "+(r.status==="cancelled"||r.status==="no_show"||r.status==="naver_cancelled"?T.danger+"33":T.border),
            padding:"12px 14px", cursor:"pointer", position:"relative",
            display:"flex", alignItems:"flex-start", gap:8,
          }} onClick={handleClick}>
            {hasChain && <div onClick={e=>toggleChain(r.id,e)} style={{
              flexShrink:0, width:22, height:22, borderRadius:"50%",
              background:isExpanded?T.primary:T.gray200,
              color:isExpanded?T.bgCard:T.gray600,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:14, fontWeight:"bold", marginTop:2, cursor:"pointer",
            }}>{isExpanded?"−":"+"}</div>}
            <div style={{flex:1,minWidth:0,position:"relative"}}>
          {/* 상태 뱃지 - 우상단 */}
          <div style={{position:"absolute",top:0,right:0}}>
            <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
          </div>
          {/* Row1: 날짜+매장 */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
            <span style={{fontSize:T.fs.xs,color:T.textSub,fontWeight:T.fw.medium}}>{r.date}</span>
            <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.primary}}>{r.time}</span>
            <span style={{fontSize:T.fs.xs,color:T.textSub,background:T.gray100,borderRadius:T.radius.sm,padding:"1px 6px"}}>{br?.short||"-"}</span>
          </div>
          {/* Row2: 고객 + 연락처 */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            {g && <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,borderRadius:T.radius.sm,padding:"1px 4px",background:g==="M"?T.maleLt:T.femaleLt,color:g==="M"?T.male:T.female,flexShrink:0}}>{g==="M"?"남":"여"}</span>}
            <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>{r.custName||"-"}</span>
            {isNaver && <I name="naver" size={11} color={T.naver}/>}
            {r.custPhone && <span style={{fontSize:T.fs.xs,color:T.primary,marginLeft:4}} onClick={e=>{e.stopPropagation();}}>{r.custPhone}</span>}
          </div>
          {/* Row3: 시술 + 시술자 + 예약금 */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:naverInfoItems.length?4:0}}>
            <span style={{fontSize:T.fs.sm,color:T.gray700,fontWeight:T.fw.medium}}>{svcDisplay}</span>
            {staff && <span style={{fontSize:T.fs.xs,color:T.textSub}}>· {staff.dn}</span>}
            {r.isPrepaid && r.totalPrice ? <Badge color={T.success} bg={T.successLt} style={{marginLeft:"auto"}}>✓{r.totalPrice.toLocaleString()}원</Badge> : null}
          </div>
          {/* Row4: 네이버 정보 태그 */}
          {naverInfoItems.length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:2}}>
            {naverInfoItems.map(item=>(
              <span key={item.label} style={{fontSize:T.fs.nano,padding:"1px 6px",borderRadius:T.radius.full,background:T.primaryLt,color:T.primaryDk,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>{item.label}: {item.value}</span>
            ))}
          </div>}
            </div>
          </div>
          {/* ── 히스토리 펼침 ── */}
          {hasChain && isExpanded && <div style={{marginLeft:30,marginTop:3,display:"flex",flexDirection:"column",gap:3}}>
            {chain.map(h=>{
              const hst = ST[h.status]||{bg:T.gray100,color:T.gray500,label:h.status};
              return <div key={h.id} onClick={()=>setListModalData(h)} style={{
                background:T.gray100, borderRadius:T.radius.md,
                border:"1px solid "+T.border, padding:"8px 12px",
                cursor:"pointer", display:"flex", alignItems:"center", gap:8,
              }}>
                <div style={{width:2,alignSelf:"stretch",background:T.border,borderRadius:2,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                    <span style={{fontSize:T.fs.xs,color:T.textSub}}>{h.date} {h.time}</span>
                    <Badge color={hst.color} bg={hst.bg} style={{marginLeft:"auto"}}>{hst.label}</Badge>
                  </div>
                  <div style={{fontSize:T.fs.nano,color:T.textMuted}}>#{h.reservationId}</div>
                </div>
              </div>;
            })}
          </div>}
        </div>;

        /* ── 데스크톱 행 ── */
        return <div key={r.id} style={{
          display:"grid", gridTemplateColumns:resGridCols(showCols,density),
          gap:T.sp.xs, alignItems:"center",
          padding:D.cardPad,
          borderRadius:T.radius.md,
          background:rowBg,
          border:"1px solid "+(r.status==="cancelled"||r.status==="no_show"||r.status==="naver_cancelled"?T.danger+"22":T.border),
          transition:"box-shadow .15s",
          cursor:"pointer",
        }}
          onClick={handleClick}
          onMouseEnter={e=>e.currentTarget.style.boxShadow=T.shadow.md}
          onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}
        >
          <div>
            <div style={{fontSize:T.fs.xs,color:T.textSub}}>{r.date}</div>
            <div style={{fontSize:D.nameSize,fontWeight:T.fw.bolder,color:T.primary}}>{r.time}</div>
          </div>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.medium,color:T.text}}>{br?.short||"-"}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {g && <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,borderRadius:T.radius.sm,padding:"1px 4px",background:g==="M"?T.maleLt:T.femaleLt,color:g==="M"?T.male:T.female,flexShrink:0}}>{g==="M"?"남":"여"}</span>}
            <span style={{fontSize:D.nameSize,fontWeight:T.fw.bolder,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.custName||"-"}</span>
            {isNaver && <I name="naver" size={10} color={T.naver} style={{flexShrink:0}}/>}
          </div>
          {showCols.service && <div style={{fontSize:T.fs.xs,color:T.gray700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{svcDisplay}</div>}
          {showCols.staff && <div style={{fontSize:T.fs.xs,color:T.textSub}}>{staff?.dn||"-"}</div>}
          {showCols.phone && <div style={{fontSize:T.fs.xs,color:T.primary,whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>{r.custPhone||"-"}</div>}
          {showCols.prepaid && <div>
            {r.isPrepaid && r.totalPrice ? <Badge color={T.success} bg={T.successLt}>✓{r.totalPrice.toLocaleString()}원</Badge> : <span style={{color:T.gray300,fontSize:T.fs.xs}}>-</span>}
          </div>}
          {showCols.naver_id && <div style={{fontSize:T.fs.xs}} onClick={e=>e.stopPropagation()}>
            {r.reservationId
              ? <a href={`https://partner.booking.naver.com/bizes/1523676/booking-list-view/bookings/${r.reservationId}`} target="_blank" rel="noreferrer" style={{color:T.naver,textDecoration:"none",fontWeight:T.fw.medium}}>{r.reservationId}</a>
              : <span style={{color:T.gray300}}>-</span>}
          </div>}
          {showCols.naver_info && <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            {naverInfoItems.length>0
              ? naverInfoItems.map(item=>(
                  <span key={item.label} style={{fontSize:T.fs.nano,padding:"1px 6px",borderRadius:T.radius.full,background:T.primaryLt,color:T.primaryDk,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>{item.label}: {item.value}</span>
                ))
              : <span style={{color:T.gray300,fontSize:T.fs.xs}}>-</span>}
          </div>}
          {showCols.memo && <div style={{fontSize:T.fs.xs,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.ownerComment||"-"}</div>}
          <div style={{textAlign:"center"}}>
            <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
          </div>
          <div style={{display:"flex",gap:T.sp.xs,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
            <Btn variant="ghost" size="sm" title="타임라인에서 열기"
              onClick={handleClick}
              style={{width:26,height:26,padding:0,borderRadius:T.radius.sm}}>
              <I name="calendar" size={11}/>
            </Btn>
            <Btn variant="ghost" size="sm" onClick={()=>deleteRes(r.id)}
              style={{width:26,height:26,padding:0,borderRadius:T.radius.sm,border:"1px solid "+T.danger+"22",color:T.danger}}>
              <I name="trash" size={11}/>
            </Btn>
          </div>
        </div>;
      })}
    </div>}

    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current} startDate={startDate} endDate={endDate} mode="res"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>

    {listModalData && <TimelineModal
      item={listModalData}
      onClose={()=>setListModalData(null)}
      onSave={(updated)=>{
        setData(prev=>({...prev, reservations:(prev?.reservations||[]).map(r=>r.id===updated.id?{...r,...updated}:r)}));
        setListModalData(null);
      }}
      onDelete={(id)=>{
        setData(prev=>({...prev, reservations:(prev?.reservations||[]).filter(r=>r.id!==id)}));
        setListModalData(null);
      }}
      onDeleteRequest={()=>setListModalData(null)}
      naverColShow={naverColShow}
      selBranch={userBranches[0]}
      userBranches={userBranches}
      data={data}
      setData={setData}
      setPage={setPage}
    />}
  </div>;
}


// ═══════════════════════════════════════════
// SALES PAGE (시술/제품 분리, 결제수단 세분화)
// ═══════════════════════════════════════════
function SalesPage({ data, setData, userBranches, isMaster, setPage }) {
  const dateAnchorRef = React.useRef(null);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [periodKey, setPeriodKey] = useState("1day");
  const [showSheet, setShowSheet] = useState(false);
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const inRange = (date) => {
    if (periodKey==="all" || (!startDate && !endDate)) return true;
    if (startDate && endDate) return date >= startDate && date <= endDate;
    return true;
  };

  const sales = (data?.sales||[]).filter(s => {
    if (!(vb==="all" ? userBranches.includes(s.bid) : s.bid===vb)) return false;
    if (q) {
      const sq = q.toLowerCase();
      return (s.custName||"").toLowerCase().includes(sq) ||
             (s.custPhone||"").includes(sq) ||
             (s.staffName||"").toLowerCase().includes(sq) ||
             (s.custNum||"").includes(sq) ||
             (s.memo||"").toLowerCase().includes(sq);
    }
    return inRange(s.date);
  });

  const totals = sales.reduce((a,s) => {
    const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
    return {
      svc:  a.svc+sv,  svcCash:a.svcCash+s.svcCash, svcTransfer:a.svcTransfer+s.svcTransfer,
      svcCard:a.svcCard+s.svcCard, svcPoint:a.svcPoint+s.svcPoint,
      prod: a.prod+pr, prodCash:a.prodCash+s.prodCash, prodTransfer:a.prodTransfer+s.prodTransfer,
      prodCard:a.prodCard+s.prodCard, prodPoint:a.prodPoint+s.prodPoint,
      gift: a.gift+(s.gift||0), total: a.total+sv+pr+(s.gift||0),
    };
  }, {svc:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prod:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0,gift:0,total:0});

  const handleDelete = (id) => { setData(prev=>({...prev,sales:(prev?.sales||[]).filter(s=>s.id!==id)})); sb.del("sales",id).catch(console.error); };
  const handleSave   = (item) => { setData(prev=>({...prev,sales:[...prev.sales,item]})); sb.insert("sales",toDb("sales",item)).catch(console.error); setShowModal(false); };
  const handleEditSave = (item) => {
    const fi = {...item, id:editSale.id};
    setData(prev=>({...prev, sales:(prev?.sales||[]).map(s=>s.id===editSale.id?fi:s)}));
    sb.update("sales",editSale.id,toDb("sales",fi)).catch(console.error);
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

  return <div>
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
        {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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

    {/* 요약 합계 바 */}
    {sales.length > 0 && (
      <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.md,flexWrap:"wrap"}}>
        {[
          {lbl:"총 매출",  v:totals.total, c:T.info,    bold:true},
          {lbl:"시술",     v:totals.svc,   c:T.primary},
          {lbl:"제품",     v:totals.prod,  c:T.infoLt2},
          {lbl:"상품권",   v:totals.gift,  c:T.orange},
        ].map(({lbl,v,c,bold})=>(
          <div key={lbl} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,
            padding:"6px 14px",display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{lbl}</span>
            <span style={{fontSize:T.fs.sm,fontWeight:bold?T.fw.black:T.fw.bolder,color:c}}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    )}

    {/* 테이블 */}
    <DataTable card>
      <thead><tr>
        <th style={{width:36}}>#</th>
        <th>날짜</th>
        <th>지점</th>
        <th>이름</th>
        <th>담당자</th>
        <th>시술합계</th>
        <th>제품합계</th>
        <th>총합계</th>
        <th>메모</th>
        <th style={{width:60}}></th>
      </tr></thead>
      <tbody>
        {sales.length===0
          ? <tr><td colSpan={10}><Empty msg="매출 기록 없음" icon="wallet"/></td></tr>
          : sales.map((s,i) => {
              const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
              const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
              const total = sv+pr+(s.gift||0);
              const isExp = expandedId===s.id;
              const br = (data.branches||[]).find(b=>b.id===s.bid);
              return <React.Fragment key={s.id}>
                <tr style={{cursor:"pointer",background:isExp?T.primaryHover:"transparent"}}
                  onClick={()=>setExpandedId(isExp?null:s.id)}>
                  <td style={{color:T.textMuted}}>{i+1}</td>
                  <td style={{whiteSpace:"nowrap",color:T.textSub,fontSize:T.fs.xxs}}>{s.date}</td>
                  <td><span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span></td>
                  <td style={{fontWeight:T.fw.bold}}>
                    {s.custGender && <span style={{...sx.genderBadge(s.custGender),marginRight:4}}>{s.custGender==="M"?"남":"여"}</span>}
                    {s.custName||"-"}
                    {s.custNum && <span style={{fontSize:T.fs.nano,color:T.textMuted,marginLeft:4}}>#{s.custNum}</span>}
                  </td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{s.staffName||"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.primary}}>{sv>0?fmt(sv):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.infoLt2}}>{pr>0?fmt(pr):<Z/>}</td>
                  <td style={{fontWeight:T.fw.black,color:T.info}}>{fmt(total)}</td>
                  <td style={{...sx.ellipsis,maxWidth:100,fontSize:T.fs.xxs,color:T.textSub}}>{s.memo||""}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:3}}>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>setEditSale(s)}><I name="edit" size={12}/></Btn>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>handleDelete(s.id)}><I name="trash" size={12}/></Btn>
                    </div>
                  </td>
                </tr>
                {isExp && <tr><td colSpan={10} style={{padding:0,background:T.gray100}}>
                  <div style={{padding:"10px 16px",display:"flex",gap:T.sp.lg,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>결제 수단</div>
                      <PayChips {...s}/>
                    </div>
                    {s.custPhone && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>연락처</div>
                      <span style={{fontSize:T.fs.sm,color:T.primary}}>{s.custPhone}</span>
                    </div>}
                    {s.memo && <div style={{flex:1}}>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>메모</div>
                      <span style={{fontSize:T.fs.sm,color:T.text}}>{s.memo}</span>
                    </div>}
                    {s.createdAt && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>등록시간</div>
                      <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{new Date(s.createdAt).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
                    </div>}
                  </div>
                </td></tr>}
              </React.Fragment>;
            })
        }
        {/* 합계 행 */}
        {sales.length>0 && <tr style={{background:T.gray200,fontWeight:T.fw.bolder}}>
          <td colSpan={5} style={{textAlign:"right",color:T.textSub,fontSize:T.fs.xxs}}>합 계</td>
          <td style={{color:T.primary}}>{fmt(totals.svc)}</td>
          <td style={{color:T.infoLt2}}>{fmt(totals.prod)}</td>
          <td style={{color:T.info}}>{fmt(totals.total)}</td>
          <td colSpan={2}/>
        </tr>}
      </tbody>
    </DataTable>

    {showModal && <DetailedSaleForm
      reservation={{id:uid(),bid:userBranches[0],custId:null,custName:"",custPhone:"",custGender:"",
        staffId:(data.staff||[]).find(s=>s.bid===(userBranches[0]))?.id||"",serviceId:null,date:todayStr()}}
      branchId={userBranches[0]}
      onSubmit={handleSave}
      onClose={()=>_mc(()=>setShowModal(false))} data={data} setData={setData}/>}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo:editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))} data={data} setData={setData}/>}
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
  </div>;
}

function Z() { return <span style={{color:T.gray400}}>0</span>; }

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
    total:a.total+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift),
    count:a.count+1,
    svcCash:a.svcCash+s.svcCash,svcTransfer:a.svcTransfer+s.svcTransfer,svcCard:a.svcCard+s.svcCard,svcPoint:a.svcPoint+s.svcPoint,
    prodCash:a.prodCash+s.prodCash,prodTransfer:a.prodTransfer+s.prodTransfer,prodCard:a.prodCard+s.prodCard,prodPoint:a.prodPoint+s.prodPoint,
  }),{svcTotal:0,prodTotal:0,gift:0,total:0,count:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0});

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
        {<select className="inp" style={{maxWidth:130,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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

// SC → StatCard alias (기존 호환)
const SC = ({label, val, sub, clr}) => <StatCard label={label} value={val} sub={sub} color={clr}/>;

// ═══════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════
function CustomersPage({ data, setData, userBranches, isMaster }) {
  const [q, setQ] = useState("");
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailCust, setDetailCust] = useState(null);
  const [detailTab, setDetailTab] = useState("pkg"); // "pkg" | "sales"

  const custs = (data?.customers||[]).filter(c => {
    const bm = vb==="all" ? userBranches.includes(c.bid) : c.bid===vb;
    const sm = !q || c.name.includes(q) || c.phone.includes(q) || (c.memo||"").includes(q);
    return bm && sm;
  }).sort((a,b) => b.visits - a.visits);

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

  const custSales = detailCust ? (data.sales||[]).filter(s=>s.custId===detailCust.id).sort((a,b)=>b.date.localeCompare(a.date)) : [];
  const custPkgs  = detailCust ? (data.custPackages||[]).filter(p=>p.customer_id===detailCust.id && (p.total_count-p.used_count)>0) : [];
  const pkgSvcs   = (data.services||[]).filter(s=>s.isPackage);

  // 다회권 카드
  const PkgCard = ({p}) => {
    const remain = p.total_count - p.used_count;
    const pct = (remain/p.total_count)*100;
    return <div style={{border:"1px solid "+T.border,borderRadius:T.radius.md,padding:"10px 12px",background:T.bgCard,minWidth:150,flex:"0 0 auto"}}>
      <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.text,marginBottom:6}}>{p.service_name}</div>
      <div style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:6}}>
        <div style={{flex:1,height:5,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
          <div style={{width:pct+"%",height:"100%",background:pct>30?"linear-gradient(90deg,"+T.male+","+T.purple+")":T.female,borderRadius:T.radius.sm,transition:"width .3s"}}/>
        </div>
        <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:pct>30?T.primary:T.female,whiteSpace:"nowrap"}}>
          {remain}<span style={{fontSize:T.fs.nano,color:T.textMuted}}>/{p.total_count}</span>
        </span>
      </div>
      <div style={{display:"flex",gap:T.sp.xs}}>
        <Btn variant="primary" size="sm" style={{flex:1,justifyContent:"center",fontSize:T.fs.nano}} onClick={()=>{
          if(remain<=0) return alert("잔여 횟수가 없습니다");
          const up = {...p, used_count:p.used_count+1};
          sb.update("customer_packages",p.id,{used_count:up.used_count}).catch(console.error);
          setData(prev=>({...prev, custPackages:(prev.custPackages||[]).map(x=>x.id===p.id?up:x)}));
        }}>1회 사용</Btn>
        <Btn variant="danger" size="sm" style={{padding:"3px 8px",fontSize:T.fs.nano}} onClick={()=>{
          if(!confirm("다회권을 삭제하시겠습니까?")) return;
          sb.del("customer_packages",p.id).catch(console.error);
          setData(prev=>({...prev, custPackages:(prev.custPackages||[]).map(x=>x.id===p.id?null:x).filter(Boolean)}));
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

    {/* Filters */}
    <div style={{display:"flex",gap:T.sp.sm,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{position:"relative",flex:1,minWidth:180}}>
        <I name="search" size={14} color={T.gray400} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:32}} placeholder="이름, 전화번호, 메모 검색..." value={q} onChange={e=>setQ(e.target.value)}/>
      </div>
      <select className="inp" style={{maxWidth:140,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <span style={{fontSize:T.fs.sm,color:T.textSub,flexShrink:0}}>{custs.length}명</span>
    </div>

    {/* 테이블 */}
    <DataTable card>
      <thead><tr>
        <th>매장</th><th>이름</th><th>연락처</th><th>성별</th><th>방문수</th><th>최근방문</th><th>메모</th><th style={{width:48}}></th>
      </tr></thead>
      <tbody>
        {custs.length===0
          ? <tr><td colSpan={8}><Empty msg="고객 없음" icon="users"/></td></tr>
          : custs.map(c => {
              const br = (data.branches||[]).find(b=>b.id===c.bid);
              const isOpen = detailCust?.id===c.id;
              return <React.Fragment key={c.id}>
                <tr style={{cursor:"pointer",background:isOpen?T.primaryHover:"transparent"}}
                  onClick={()=>{ setDetailCust(isOpen?null:c); setDetailTab("pkg"); }}>
                  <td>
                    <span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span>
                  </td>
                  <td>
                    <span style={{fontWeight:T.fw.bold}}>{c.name}</span>
                    {c.custNum && <span style={{fontSize:T.fs.nano,color:T.textMuted,marginLeft:4}}>#{c.custNum}</span>}
                  </td>
                  <td style={{color:T.primary,fontSize:T.fs.xxs}}>{c.phone}</td>
                  <td>
                    {c.gender
                      ? <span style={sx.genderBadge(c.gender)}>{c.gender==="F"?"여":"남"}</span>
                      : <span style={{color:T.textMuted}}>-</span>}
                  </td>
                  <td>
                    <span style={{fontWeight:T.fw.bolder,color:c.visits>=5?T.info:T.textSub}}>{c.visits}회</span>
                  </td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{c.lastVisit||"-"}</td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs,maxWidth:160,...sx.ellipsis}}>{c.memo||"-"}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <Btn variant="secondary" size="sm" onClick={()=>{setEditItem(c);setShowModal(true)}}><I name="edit" size={12}/></Btn>
                  </td>
                </tr>

                {/* 상세 패널 */}
                {isOpen && <tr><td colSpan={8} style={{padding:0,background:T.gray100}}>
                  <div style={{borderTop:"2px solid "+T.primaryLt}}>
                    {/* 탭 */}
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                      {[["pkg","다회권 ("+custPkgs.length+")"],["sales","매출 내역 ("+custSales.length+")"]].map(([tab,lbl])=>(
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
                              const pkg = {id:uid(),business_id:_activeBizId,customer_id:c.id,service_id:svc.id,
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
                      {detailTab==="sales" && <div>
                        {custSales.length===0
                          ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>매출 기록 없음</div>
                          : <DataTable card={false}>
                              <thead><tr>
                                <th>날짜</th><th>매장</th><th>담당자</th><th>시술</th><th>제품</th><th>합계</th><th>메모</th>
                              </tr></thead>
                              <tbody>
                                {custSales.map(s=>{
                                  const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
                                  const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
                                  return <tr key={s.id}>
                                    <td style={{whiteSpace:"nowrap",fontSize:T.fs.xxs,color:T.textSub}}>{s.date}</td>
                                    <td><span style={{fontSize:T.fs.nano,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 4px"}}>{(data.branches||[]).find(b=>b.id===s.bid)?.short}</span></td>
                                    <td style={{fontSize:T.fs.xxs,color:T.textSub}}>{s.staffName}</td>
                                    <td style={{fontWeight:T.fw.bold,color:T.primary}}>{sv>0?fmt(sv):<Z/>}</td>
                                    <td style={{fontWeight:T.fw.bold,color:T.infoLt2}}>{pr>0?fmt(pr):<Z/>}</td>
                                    <td style={{fontWeight:T.fw.bolder,color:T.info}}>{fmt(sv+pr+(s.gift||0))}</td>
                                    <td style={{...sx.ellipsis,maxWidth:100,fontSize:T.fs.xxs,color:T.textSub}}>{s.memo||"-"}</td>
                                  </tr>;
                                })}
                              </tbody>
                            </DataTable>
                        }
                      </div>}
                    </div>
                  </div>
                </td></tr>}
              </React.Fragment>;
            })
        }
      </tbody>
    </DataTable>

    {showModal && <CustModal item={editItem} onSave={handleSave}
      onClose={()=>_mc(()=>{setShowModal(false);setEditItem(null)})}
      defBranch={userBranches[0]} userBranches={userBranches} branches={data.branches||[]}/>}
  </div>;
}

function CustModal({ item, onSave, onClose, defBranch, userBranches, branches }) {
  const [f, setF] = useState(item || { id:uid(), bid:defBranch, name:"", phone:"", gender:"", visits:0, lastVisit:null, memo:"", custNum:String(50000+Math.floor(Math.random()*10000)) });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const _cm = window.innerWidth<=768;
  return <div onClick={_cm?undefined:onClose} style={_cm?{position:"fixed",inset:0,zIndex:500,background:T.bgCard,overflowY:"auto",WebkitOverflowScrolling:"touch"}:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.35)",backdropFilter:"blur(2px)",WebkitBackdropFilter:"blur(2px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"ovFadeIn .25s"}}>
    {_cm&&<div style={{display:"flex",alignItems:"center",padding:"10px 14px 8px",borderBottom:`1px solid ${T.border}`,background:T.bgCard,position:"sticky",top:0,zIndex:10}}>
      <button onClick={onClose} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",color:T.primary,fontWeight:700,fontSize:15,padding:"4px 2px",fontFamily:"inherit"}}>
        <I name="chevronLeft" size={20}/> 뒤로
      </button>
    </div>}
    <div className="modal" onClick={e=>e.stopPropagation()} style={_cm?{borderRadius:0,boxShadow:"none",border:"none",width:"100%",maxWidth:"none"}:{}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{item?"고객 수정":"새 고객"}</h3>
        <button onClick={onClose} className="close-btn"><I name="x" size={16}/></button>
      </div>
      <div className="form-col">
        <FLD label="매장"><select className="inp" value={f.bid} onChange={e=>set("bid",e.target.value)}>{(branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></FLD>
        <GridLayout cols={2} gap={12} className="grid2">
          <FLD label="이름"><input className="inp" value={f.name} onChange={e=>set("name",e.target.value)}/></FLD>
          <FLD label="연락처"><input className="inp" value={f.phone} onChange={e=>set("phone",e.target.value)} placeholder="010-0000-0000"/></FLD>
        </GridLayout>
        <FLD label="성별"><select className="inp" value={f.gender} onChange={e=>set("gender",e.target.value)}><option value="">선택</option><option value="F">여성</option><option value="M">남성</option></select></FLD>
        <FLD label="메모"><textarea className="inp" rows={2} value={f.memo} onChange={e=>set("memo",e.target.value)}/></FLD>
        <Btn variant="primary" style={{width:"100%",justifyContent:"center",padding:12}} onClick={()=>{onSave(f)}}>{item?"수정":"등록"}</Btn>
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════
// USERS MANAGEMENT (마스터 전용)
// ═══════════════════════════════════════════
function UsersPage({ data, setData, bizId }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const users = data.users || [];
  const regBranches = (data.branchSettings || data.branches || []).filter(b => b.useYn !== false);

  const startAdd = () => { setEditId("new"); setForm({ name:"", loginId:"", pw:"", role:"staff", branches:[], viewBranches:[] }); };
  const startEdit = (u) => { setEditId(u.id); setForm({ ...u, viewBranches: u.viewBranches||[] }); };
  const save = (finalForm) => {
    const f = finalForm || form;
    if (!f.name || !f.loginId || !f.pw) { alert("이름, 아이디, 비밀번호를 모두 입력하세요."); return; }
    if (f.role === "staff" && (!f.branches || f.branches.length === 0)) { alert("직원은 담당 지점을 1개 이상 선택하세요."); return; }
    const userData = { ...f, viewBranches: f.viewBranches||[], businessId: bizId };
    setData(prev => {
      const us = [...(prev.users || [])];
      if (editId === "new") {
        const newUser = { ...userData, id: "acc_" + uid() };
        us.push(newUser);
        sb.insert("app_users", toDb("app_users", newUser)).catch(console.error);
      } else {
        const idx = us.findIndex(u => u.id === editId);
        if (idx >= 0) { us[idx] = { ...userData }; sb.update("app_users", editId, toDb("app_users", userData)).catch(console.error); }
      }
      return { ...prev, users: us };
    });
    setEditId(null); setForm(null);
  };
  const remove = (id) => {
    setData(prev => ({ ...prev, users: (prev.users || []).filter(u => u.id !== id) }));
    sb.del("app_users", id).catch(console.error);
  };

  return <div>
    <h2 className="page-title">사용자 관리</h2>
    <div style={{display:"flex",gap:T.sp.sm,marginBottom:12}}>
      <Btn variant="primary" onClick={startAdd}><I name="plus" size={12}/> 사용자 추가</Btn>
      <span style={{fontSize:T.fs.sm,color:T.textSub,display:"flex",alignItems:"center"}}>{users.length}개 계정</span>
    </div>
    <DataTable card><thead><tr>
        <th>이름</th><th>아이디</th><th>비밀번호</th><th>유형</th><th>담당 지점</th><th>열람 지점</th><th>관리</th>
      </tr></thead><tbody>
        {users.map(u => {
          if (editId === u.id && form) return <UserEditRow key={u.id} init={form} regBranches={regBranches} allBranches={data.branches||[]} onSave={save} onCancel={()=>{setEditId(null);setForm(null)}} isNew={false}/>;
          const roleLabel = u.role==="owner" ? "대표" : "직원";
          const roleBg = u.role==="owner" ? "#7c7cc815" : T.bg;
          const roleClr = u.role==="owner" ? T.primary : T.gray600;
          return <tr key={u.id}>
            <td style={{fontWeight:T.fw.bold}}>{u.name}</td>
            <td style={{color:T.primary}}>{u.loginId||u.login_id}</td>
            <td style={{color:T.textMuted}}>{"•".repeat((u.pw||u.password||"").length)}</td>
            <td><span style={{fontSize:T.fs.xs,padding:"2px 8px",borderRadius:T.radius.lg,background:roleBg,color:roleClr,fontWeight:T.fw.bold}}>{roleLabel}</span></td>
            <td style={{fontSize:T.fs.xxs,color:T.gray700}}>{u.role==="owner"?"전체 지점":(u.branches||[]).map(bid=>(data.branches||[]).find(b=>b.id===bid)?.short).filter(Boolean).join(", ")}</td>
            <td style={{fontSize:T.fs.xxs,color:T.info}}>{u.role==="owner"?"-":(u.viewBranches||[]).map(bid=>(data.branches||[]).find(b=>b.id===bid)?.short).filter(Boolean).join(", ")||"-"}</td>
            <td style={{display:"flex",gap:T.sp.xs}}>
              <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>startEdit(u)}>수정</Btn>
              <Btn variant="danger" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>remove(u.id)}>삭제</Btn>
            </td>
          </tr>;
        })}
        {editId === "new" && form && <UserEditRow key="new" init={form} regBranches={regBranches} allBranches={data.branches||[]} onSave={save} onCancel={()=>{setEditId(null);setForm(null)}} isNew={true}/>}
      </tbody></DataTable>
    <div style={{marginTop:16,padding:12,background:T.bg,borderRadius:T.radius.md,fontSize:T.fs.xxs,color:T.textSub,lineHeight:1.8}}>
      <b>권한 안내</b><br/>
      · 대표: 전 지점 예약/매출 조회·편집, 사용자·관리설정 접근<br/>
      · 직원: 담당 지점 예약/매출 조회·편집, 열람 지점 타임라인 읽기 전용
    </div>
  </div>;
}

// Separate top-level component — won't re-create on parent re-render
function UserEditRow({ init, regBranches, allBranches, onSave, onCancel, isNew }) {
  const [f, setF] = useState({...init});
  const set = (k, v) => setF(p => ({...p, [k]: v}));

  const MultiSelect = ({selected, onChange, color=T.primary}) => {
    const [open, setOpen] = useState(false);
    const toggle = (bid) => { onChange(selected.includes(bid) ? selected.filter(x=>x!==bid) : [...selected, bid]); };
    const label = selected.length === 0 ? "선택" : regBranches.filter(b=>selected.includes(b.id)).map(b=>b.short||b.name).join(", ");
    return <div style={{position:"relative"}}>
      <div onClick={()=>setOpen(!open)} className="inp" style={{width:140,cursor:"pointer",fontSize:T.fs.xxs,display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:30}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:selected.length?T.text:T.gray500}}>{label}</span>
        <span style={{fontSize:T.fs.nano,color:T.gray500}}>{open?<I name="chevU" size={12}/>:<I name="chevD" size={12}/>}</span>
      </div>
      {open && <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,border:"1px solid #d0d0d0",borderRadius:T.radius.sm,zIndex:50,maxHeight:160,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,.1)"}}>
        {regBranches.map(b => {
          const on = selected.includes(b.id);
          return <div key={b.id} onClick={()=>toggle(b.id)} style={{padding:"6px 10px",fontSize:T.fs.xxs,cursor:"pointer",display:"flex",alignItems:"center",gap:6,background:on?color+"10":"transparent"}}>
            <div style={{width:14,height:14,borderRadius:T.radius.sm,border:`1.5px solid ${on?color:T.gray400}`,background:on?color:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {on && <span style={{color:T.bgCard,fontSize:T.fs.nano,fontWeight:T.fw.bolder}}><I name="check" size={10}/></span>}
            </div>
            <span style={{color:on?color:T.gray700}}>{b.short||b.name}</span>
          </div>;
        })}
      </div>}
    </div>;
  };

  return <tr style={{background:T.primaryHover}}>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"이름":""} value={f.name} onChange={e=>set("name",e.target.value)}/></td>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"아이디":""} value={f.loginId} onChange={e=>set("loginId",e.target.value)}/></td>
    <td><input className="inp" style={{width:80}} placeholder={isNew?"비밀번호":""} value={f.pw} onChange={e=>set("pw",e.target.value)}/></td>
    <td><select className="inp" style={{width:80}} value={f.role} onChange={e=>set("role",e.target.value)}>
      <option value="owner">대표</option><option value="staff">직원</option>
    </select></td>
    <td>{f.role==="owner" ? <span style={{fontSize:T.fs.xxs,color:T.primary}}>전체 지점</span> :
      <MultiSelect selected={f.branches||[]} onChange={v=>set("branches",v)} color={T.primary}/>}</td>
    <td>{f.role==="owner" ? <span style={{fontSize:T.fs.xxs,color:T.gray500}}>-</span> :
      <MultiSelect selected={f.viewBranches||[]} onChange={v=>set("viewBranches",v)} color={T.info}/>}</td>
    <td style={{display:"flex",gap:T.sp.xs}}>
      <Btn variant="primary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={()=>onSave(f.role==="owner"?{...f,branches:allBranches.map(b=>b.id)}:f)}>{isNew?"추가":"저장"}</Btn>
      <Btn variant="secondary" style={{padding:"4px 10px",fontSize:T.fs.xxs}} onClick={onCancel}>취소</Btn>
    </td>
  </tr>;
}

// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// ADMIN DESIGN SYSTEM
// ═══════════════════════════════════════════

function AConfirm({ open, title, desc, onOk, onCancel, okLabel="삭제", danger=true }) {
  if (!open) return null;
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
    <div style={{background:"#fff",borderRadius:16,padding:"28px 24px",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
      <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:T.text,marginBottom:6}}>{title}</div>
      {desc&&<div style={{fontSize:T.fs.sm,color:T.textSub,marginBottom:24,lineHeight:1.6}}>{desc}</div>}
      <div style={{display:"flex",gap:10,marginTop:desc?0:20}}>
        <button onClick={onCancel} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid "+T.border,background:"none",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
        <button onClick={onOk} style={{flex:1,padding:"11px",borderRadius:10,border:"none",background:danger?T.danger:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{okLabel}</button>
      </div>
    </div>
  </div>;
}

function ASheet({ open, onClose, title, children, onSave, saveLabel, saving, saveDisabled }) {
  if (!open) return null;
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:540,maxHeight:"88vh",display:"flex",flexDirection:"column",WebkitOverflowScrolling:"touch"}}>
      <div style={{padding:"20px 20px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,borderBottom:"1px solid "+T.gray100}}>
        <div style={{fontSize:T.fs.md,fontWeight:T.fw.black,color:T.text}}>{title}</div>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:"50%",border:"none",background:T.gray100,color:T.gray500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="x" size={14}/></button>
      </div>
      <div style={{padding:"20px",overflowY:"auto",flex:1}}>{children}</div>
      {onSave && <div style={{padding:"12px 20px",borderTop:"1px solid "+T.gray100,flexShrink:0,paddingBottom:"calc(90px + env(safe-area-inset-bottom))"}}><AIBtn onClick={onSave} saving={saving} disabled={saving||saveDisabled} label={saveLabel||"저장"} style={{width:"100%"}}/></div>}
    </div>
  </div>;
}

function AField({ label, required, error, children, hint }) {
  return <div style={{marginBottom:14}}>
    <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:error?T.danger:T.gray500,marginBottom:5,display:"flex",gap:3}}>
      {label}{required&&<span style={{color:T.danger}}>*</span>}
    </div>
    {children}
    {hint&&!error&&<div style={{fontSize:T.fs.nano,color:T.textMuted,marginTop:3}}>{hint}</div>}
    {error&&<div style={{fontSize:T.fs.nano,color:T.danger,marginTop:3}}>{error}</div>}
  </div>;
}

const AInp = {width:"100%",padding:"10px 12px",border:"1.5px solid #e8e8f0",borderRadius:10,fontSize:14,fontFamily:"inherit",color:"#1a1a2e",outline:"none",background:"#fff",boxSizing:"border-box"};

function AEmpty({ icon="plus", message, onAdd, addLabel }) {
  return <div style={{textAlign:"center",padding:"52px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
    <div style={{width:52,height:52,borderRadius:"50%",background:T.gray100,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <I name={icon} size={22} style={{color:T.gray300}}/>
    </div>
    <div style={{fontSize:T.fs.sm,color:T.textMuted}}>{message}</div>
    {onAdd&&<button onClick={onAdd} style={{marginTop:4,padding:"9px 20px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
      <I name="plus" size={14}/>{addLabel||"추가"}
    </button>}
  </div>;
}

function APageHeader({ title, count, onAdd, addLabel="추가", desc }) {
  return <div style={{marginBottom:20}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,display:"flex",alignItems:"baseline",gap:8}}>
        <h2 style={{margin:0,fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.text,letterSpacing:"-.5px"}}>{title}</h2>
        {count!=null&&count>0&&<span style={{fontSize:T.fs.sm,color:T.textMuted,fontWeight:T.fw.medium}}>{count}개</span>}
      </div>
      {onAdd&&<button onClick={onAdd} style={{height:34,padding:"0 14px",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <I name="plus" size={14}/>{addLabel}
      </button>}
    </div>
    {desc&&<div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:4}}>{desc}</div>}
  </div>;
}

function AListItem({ left, title, sub, right, onClick, borderBottom=true }) {
  const [hov,setHov]=React.useState(false);
  return <div onClick={onClick} onMouseOver={()=>onClick&&setHov(true)} onMouseOut={()=>setHov(false)}
    style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",cursor:onClick?"pointer":"default",
      background:hov&&onClick?T.primaryHover:"transparent",transition:"background .1s",
      borderBottom:borderBottom?"1px solid "+T.gray100:"none"}}>
    {left&&<div style={{flexShrink:0}}>{left}</div>}
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
      {sub&&<div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>{sub}</div>}
    </div>
    {right&&<div style={{flexShrink:0}}>{right}</div>}
  </div>;
}

function AToggle({ on, onChange, size="md" }) {
  const w=size==="sm"?36:44,h=size==="sm"?20:24,d=size==="sm"?14:18;
  return <div onClick={()=>onChange&&onChange(!on)} style={{width:w,height:h,borderRadius:h/2,background:on?T.primary:"#d1d5db",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
    <div style={{position:"absolute",top:(h-d)/2,left:on?w-d-(h-d)/2:(h-d)/2,width:d,height:d,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
  </div>;
}

function AColorDot({ color, size=20 }) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:color||"#e8e8f0",border:"2px solid rgba(0,0,0,.06)",flexShrink:0}}/>;
}

function ABadge({ children, color=T.primary, bg, style={} }) {
  return <div style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:20,fontSize:T.fs.nano,fontWeight:T.fw.bolder,color,background:bg||(color+"1a"),...style}}>{children}</div>;
}

const PALETTE=["#7c7cc8","#e17055","#00b894","#f39c12","#0984e3","#fd79a8","#6c5ce7","#00cec9","#636e72","#2d3436"];

function APalette({ value, onChange }) {
  return <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    {PALETTE.map(c=><div key={c} onClick={()=>onChange(c)}
      style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",
        outline:value===c?"3px solid "+T.text:"3px solid transparent",outlineOffset:2,transition:"outline .1s"}}/>)}
  </div>;
}

function AIBtn({ onClick, disabled, saving, label, style={} }) {
  return <button onClick={onClick} disabled={disabled}
    style={{width:"100%",padding:"12px",borderRadius:10,border:"none",
      background:disabled?"#e8e8f0":T.primary,color:disabled?T.gray400:"#fff",
      fontSize:T.fs.sm,fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",
      display:"flex",alignItems:"center",justifyContent:"center",gap:8,...style}}>
    {saving&&<div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.4)",borderTopColor:"#fff",animation:"spin 1s linear infinite"}}/>}
    {label}
  </button>;
}

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
    try{await sb.update("app_users",currentUser.id,{password:pw.nw});setMsg("✓ 비밀번호가 변경됐어요");setPw({cur:"",nw:"",nw2:""});}
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
      {msg&&<div style={{fontSize:T.fs.xs,color:msg.startsWith("✓")?T.success:T.danger,marginBottom:12,padding:"8px 12px",borderRadius:8,background:msg.startsWith("✓")?"#f0faf4":"#fff5f5"}}>{msg}</div>}
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
// ADMIN — 메뉴 홈 + 라우터
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// ADMIN — 직원 근무표
// ═══════════════════════════════════════════
function AdminSchedule({ currentUser, isMaster }) {
  const iframeRef = React.useRef(null);

  const onLoad = React.useCallback(function() {
    var frame = iframeRef.current;
    if (!frame) return;
    frame.contentWindow.postMessage({
      type: "BLISS_AUTH",
      role: currentUser ? currentUser.role : "staff",
      userId: currentUser ? currentUser.id : "",
      branchId: currentUser ? (currentUser.branch_id || currentUser.bid || "") : "",
      isMaster: !!isMaster,
      canWrite: !!isMaster,
      canRead: true
    }, "https://jeongwoolee1.github.io");
  }, [currentUser, isMaster]);

  return (
    <div style={{width:"100%",height:"calc(100vh - 120px)",borderRadius:12,overflow:"hidden",
      border:"1px solid "+T.border,background:"#fff"}}>
      <iframe
        ref={iframeRef}
        src="https://jeongwoolee1.github.io/bliss/schedule.html"
        onLoad={onLoad}
        style={{width:"100%",height:"100%",border:"none"}}
        title="직원 근무표"
      />
    </div>
  );
}

function AdminPage({ data, setData, bizId, serverV, onLogout, currentUser }) {
  const [tab,setTabRaw]=useState(null);
  const setTab=t=>{setTabRaw(t);try{sessionStorage.setItem("bliss_adminTab",t||"");}catch(e){}};
  const back=()=>setTab(null);

  // 브랜드 가입 요청 대기 수 계산
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
      <div style={{fontSize:32,marginBottom:12}}>🔒</div>
      <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text,marginBottom:8}}>접근 권한이 없어요</div>
      <div style={{fontSize:T.fs.sm}}>브랜드 어드민에게 문의해주세요</div>
    </div>}
  </div>;
}

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
    if(!confirm(`${req.requesterName}님의 ${req.branchName} 가입 요청을 승인하시겠습니까?`)) return;
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
    } catch(e) { alert("승인 실패: "+e.message); }
    setSaving(false);
  };

  const reject = async (req) => {
    if(!confirm(`${req.requesterName}님의 요청을 거절하시겠습니까?`)) return;
    setSaving(true);
    try {
      const newReqs = requests.map(r=>r.id===req.id ? {...r, status:"rejected"} : r);
      await updateSettings(newReqs);
    } catch(e) { alert("거절 실패: "+e.message); }
    setSaving(false);
  };

  // 권한 매트릭스
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
    } catch(e) { alert("저장 실패: "+e.message); }
    setSavingPerm(false);
  };

  const thStyle = {padding:"10px 6px",fontSize:10,fontWeight:700,color:T.textMuted,textAlign:"center",whiteSpace:"nowrap",background:T.bg,borderBottom:`1px solid ${T.border}`};
  const tdStyle = {padding:"8px 6px",textAlign:"center",borderBottom:`1px solid ${T.gray100}`,verticalAlign:"middle"};

  return <div>
    <h3 style={{margin:"0 0 20px",fontSize:T.fs.lg,fontWeight:T.fw.black}}>브랜드 멤버 관리</h3>

    {/* 권한 매트릭스 */}
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
        <span style={{display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked readOnly style={{accentColor:T.primary,width:12,height:12}}/> 쓰기 — 예약·매출 등록·수정</span>
        <span style={{display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked readOnly style={{accentColor:T.gray400,width:12,height:12}}/> 읽기 — 조회만</span>
      </div>
    </>}

    {/* 가입 요청 */}
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
          <div style={{fontSize:T.fs.sm,color:T.textSub,marginBottom:4}}>📍 요청 지점: <b>{req.branchName}</b></div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12}}>{new Date(req.requestedAt).toLocaleDateString("ko-KR")} 요청</div>
          <div style={{display:"flex",gap:8}}>
            <button disabled={saving} onClick={()=>approve(req,"write")} style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>✅ 읽기+쓰기 승인</button>
            <button disabled={saving} onClick={()=>approve(req,"read")} style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${T.primary}`,background:"#fff",color:T.primary,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:"pointer",fontFamily:"inherit"}}>👁 읽기전용 승인</button>
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
// ADMIN — 브랜드 가입 요청 (사업장 오너용)
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
      // 브랜드 코드로 브랜드 찾기
      const r = await fetch(`${SUPA_URL}/rest/v1/businesses?code=eq.${encodeURIComponent(brandCode.trim())}&select=id,name,settings`,
        {headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});
      const brands = await r.json();
      if(!brands.length) { setErr("존재하지 않는 브랜드 코드예요"); setLoading(false); return; }
      const brand = brands[0];

      // 이미 요청했는지 확인
      let settings = {};
      try { settings = JSON.parse(brand.settings||"{}"); } catch {}
      const pending = settings.pending_requests || [];
      const already = pending.find(p=>p.loginId===currentUser?.loginId && p.status==="pending");
      if(already) { setErr("이미 가입 요청이 진행 중이에요"); setLoading(false); return; }

      // 지점 ID 찾기 (브랜드 내 지점 중 이름 매칭)
      const brRes = await fetch(`${SUPA_URL}/rest/v1/branches?business_id=eq.${brand.id}&select=id,name,short`,
        {headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}});
      const branchList = await brRes.json();
      const matchedBr = branchList.find(b=>(b.name||"").includes(branchName.trim()) || (b.short||"").includes(branchName.trim()));

      // 가입 요청 추가
      const newReq = {
        id: "req_"+Math.random().toString(36).slice(2,10),
        loginId: currentUser?.loginId || currentUser?.login_id || "",
        requesterName: currentUser?.name || "",
        branchName: branchName.trim(),
        branchId: matchedBr?.id || "",
        status: "pending",
        requestedAt: new Date().toISOString()
      };
      const newSettings = {...settings, pending_requests:[...pending, newReq]};
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
    <div style={{fontSize:48,marginBottom:16}}>✅</div>
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
// ADMIN — 예약장소 관리
// ═══════════════════════════════════════════
