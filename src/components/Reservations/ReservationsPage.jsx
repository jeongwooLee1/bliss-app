import React, { useState } from 'react'
import { T, NAVER_COLS, getNaverVal } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { fromDb } from '../../lib/db'
import { todayStr, genId, fmtLocal, groupSvcNames } from '../../lib/utils'
import I from '../common/I'
import TimelineModal from '../Timeline/ReservationModal'

const fmt = (n) => n == null ? "0" : Number(n).toLocaleString("ko-KR");
const _mc = (fn) => { if(fn) fn(); };
const Empty = ({ msg='데이터 없음', icon='inbox' }) => (
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 0',gap:8,color:T.textMuted||T.gray400}}>
    <I name={icon} size={28} color={T.gray400}/>
    <span style={{fontSize:T.fs.sm}}>{msg}</span>
  </div>
);
const uid = genId;

const GridLayout = ({ cols=2, gap=12, children, style={}, ...p }) => {
  const gc = typeof cols === "number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:gc,gap,...style}} {...p}>{children}</div>;
};

const StatCard = ({ label, value, sub, color }) => (
  <div style={{background:T.bgCard,borderRadius:T.radius.md,padding:"14px 16px",boxShadow:T.shadow.sm,borderLeft:`3px solid ${color||T.primary}`}}>
    <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:4}}>{label}</div>
    <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:color||T.text}}>{value}</div>
    {sub && <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>{sub}</div>}
  </div>
);

const resGridCols = () => "82px 52px 96px 1fr 108px 90px 1fr 60px 52px";
const DEFAULT_SOURCES = ["네이버","전화","방문","소개","인스타","카카오","기타"];
const STATUS_KEYS = ["confirmed","completed","cancelled","no_show"];

// ─── 공통 컴포넌트 (원본 전역 → 로컬 선언) ─────────────────────
const Badge = ({ children, color=T.primary, bg, style={} }) => (
  <span style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,color,background:bg||color+"22",...style}}>{children}</span>
);
const Tag = ({ children, color=T.primary, style={} }) => (
  <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 6px",borderRadius:4,fontSize:11,fontWeight:600,color,background:color+"22",...style}}>{children}</span>
);
const Chip = ({ label, color, bg, onRemove, style={} }) => (
  <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:500,color:color||T.text,background:bg||T.gray100,...style}}>
    {label}{onRemove && <button onClick={onRemove} style={{background:"none",border:"none",cursor:"pointer",padding:0,lineHeight:1,color:"inherit",opacity:0.6}}>×</button>}
  </span>
);
const Modal = ({ open, onClose, children, title, width=480 }) => {
  if (!open) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.4)"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:T.bgCard,borderRadius:T.radius.lg,width:"min(90vw,"+width+"px)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 8px 40px rgba(0,0,0,.2)"}}>
        {title && <div style={{padding:"16px 20px",borderBottom:"1px solid "+T.border,fontWeight:700,fontSize:T.fs.lg,display:"flex",justifyContent:"space-between",alignItems:"center"}}>{title}<button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.textMuted}}>×</button></div>}
        {children}
      </div>
    </div>
  );
};
const Spinner = ({size=20}) => <div style={{width:size,height:size,border:"2px solid #eee",borderTop:"2px solid "+T.primary,borderRadius:"50%",animation:"spin 1s linear infinite"}}></div>;

export function SmartDatePicker({ open, onClose, anchorEl, startDate, endDate, onApply, mode }) {
  const [selStart, setSelStart] = useState(startDate || todayStr());
  const [selEnd,   setSelEnd]   = useState(endDate   || todayStr());
  const [period,   setPeriod]   = useState("today");
  const [months,   setMonths]   = useState(() => {
    const d = new Date(startDate || todayStr());
    const d2 = new Date(d.getFullYear(), d.getMonth()+1, 1);
    return [{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}];
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pos, setPos] = useState({top:0,left:0});

  useEffect(()=>{
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  useEffect(()=>{
    if (!isMobile && anchorEl && open) {
      const r = anchorEl.getBoundingClientRect();
      setPos({top: r.bottom + 6, left: r.left});
    }
  },[open, isMobile, anchorEl]);

  const presets = mode==="res"
    ? [["today","오늘"],["7days","7일"],["month","한달"],["all","전체"],["custom","직접"]]
    : [["today","오늘"],["prev","전일"],["thismonth","이번달"],["lastmonth","지난달"],["custom","직접"]];

  const applyPreset = (key) => {
    const today = todayStr();
    const d = new Date(); const y=d.getFullYear(); const m=d.getMonth();
    let s=today, e=today;
    if (key==="today") { s=e=today; }
    else if (key==="prev") { const p=new Date(); p.setDate(p.getDate()-1); s=e=fmtLocal(p); }
    else if (key==="7days") {
      if (mode==="res") { const en=new Date(); en.setDate(en.getDate()+6); e=fmtLocal(en); }
      else { const st=new Date(); st.setDate(st.getDate()-6); s=fmtLocal(st); }
    }
    else if (key==="month") {
      if (mode==="res") { const en=new Date(); en.setDate(en.getDate()+29); e=fmtLocal(en); }
      else { const st=new Date(); st.setDate(st.getDate()-29); s=fmtLocal(st); }
    }
    else if (key==="thismonth") { s=`${y}-${String(m+1).padStart(2,"0")}-01`; e=today; }
    else if (key==="lastmonth") {
      const lm=m===0?11:m-1; const ly=m===0?y-1:y;
      s=`${ly}-${String(lm+1).padStart(2,"0")}-01`;
      e=fmtLocal(new Date(y,m,0));
    }
    else if (key==="all") { s=""; e=""; }
    setPeriod(key); setSelStart(s); setSelEnd(e);
    if (s) { const sd=new Date(s); const sd2=new Date(sd.getFullYear(),sd.getMonth()+1,1); setMonths([{y:sd.getFullYear(),m:sd.getMonth()},{y:sd2.getFullYear(),m:sd2.getMonth()}]); }
  };

  const buildCal = (y,m) => {
    const first=new Date(y,m,1).getDay(); const days=new Date(y,m+1,0).getDate();
    const cells=[];
    for(let i=0;i<first;i++) cells.push(null);
    for(let i=1;i<=days;i++) cells.push(`${y}-${String(m+1).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    return cells;
  };

  const prevM = () => { const d=new Date(months[0].y,months[0].m-1,1); const d2=new Date(months[1].y,months[1].m-1,1); setMonths([{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}]); };
  const nextM = () => { const d=new Date(months[0].y,months[0].m+1,1); const d2=new Date(months[1].y,months[1].m+1,1); setMonths([{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}]); };

  const [pickingEnd, setPickingEnd] = useState(false);

  const handleDayClick = (ds) => {
    setPeriod("custom");
    if (!pickingEnd) {
      setSelStart(ds); setSelEnd(ds);
      setPickingEnd(true);
    } else {
      if (ds < selStart) { setSelStart(ds); setSelEnd(selStart); }
      else { setSelEnd(ds); }
      setPickingEnd(false);
    }
  };

  const DAYS = ["일","월","화","수","목","금","토"];

  const CalGrid = ({y,m}) => {
    const cells = buildCal(y,m);
    return <div style={{minWidth:220}}>
      <div style={{textAlign:"center",fontWeight:T.fw.bolder,fontSize:T.fs.md,color:T.text,marginBottom:8}}>{y}.{String(m+1).padStart(2,"0")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px 0",marginBottom:4}}>
        {DAYS.map((d,i)=><div key={d} style={{textAlign:"center",fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:i===0?T.danger:i===6?T.male:T.gray500,padding:"4px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px 0"}}>
        {cells.map((ds,i)=>{
          if(!ds) return <div key={i}/>;
          const today=todayStr();
          const isToday=ds===today;
          const isSt=ds===selStart&&selStart;
          const isEn=ds===selEnd&&selEnd&&selEnd!==selStart;
          const inR=selStart&&selEnd&&ds>selStart&&ds<selEnd;
          const dow=new Date(ds).getDay();
          let tc=dow===0?T.danger:dow===6?T.male:T.text;
          if(isSt||isEn) tc=T.bgCard;
          return <div key={ds} style={{display:"flex",justifyContent:"center",position:"relative",
            background:inR?T.primaryHover:"transparent",
            borderRadius:isSt?"50% 0 0 50%":isEn?"0 50% 50% 0":"0"}}>
            <button onClick={()=>handleDayClick(ds)} style={{
              width:30,height:30,borderRadius:"50%",border:"none",cursor:"pointer",fontSize:T.fs.sm,fontFamily:"inherit",
              fontWeight:isToday||isSt||isEn?700:400,
              background:isSt||isEn?T.primary:isToday?T.gray200:"transparent",
              color:tc,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {parseInt(ds.slice(8))}
              {isToday&&!(isSt||isEn)&&<span style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:T.primary}}/>}
            </button>
          </div>;
        })}
      </div>
    </div>;
  };

  const doApply = () => { onApply(selStart,selEnd,period); onClose(); };

  if (!open) return null;

  // ── 데스크탑 드롭다운 ──
  if (!isMobile) {
    return <div style={{position:"fixed",inset:0,zIndex:3000}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onMouseDown={e=>e.stopPropagation()} style={{
        position:"fixed",top:pos.top,left:pos.left,
        background:T.bgCard,borderRadius:T.radius.lg,boxShadow:"0 8px 32px rgba(0,0,0,.18)",
        padding:"16px 20px 14px",zIndex:3001,minWidth:500}}>
        {/* 프리셋 버튼 */}
        <div style={{display:"flex",gap:T.sp.xs,marginBottom:14,flexWrap:"wrap"}}>
          {presets.map(([k,v])=><button key={k} onClick={()=>applyPreset(k)} style={{
            height:28,padding:"0 12px",borderRadius:T.radius.md,border:"1px solid",fontSize:T.fs.sm,cursor:"pointer",fontFamily:"inherit",
            background:period===k?T.primary:T.gray100,
            color:period===k?T.bgCard:T.gray700,
            borderColor:period===k?T.primary:T.gray300,
            fontWeight:period===k?700:400}}>{v}</button>)}
          <span style={{marginLeft:"auto",fontSize:T.fs.sm,color:T.textMuted,alignSelf:"center"}}>
            {selStart&&selEnd&&selStart!==selEnd?`${selStart} ~ ${selEnd}`:selStart||"전체"}
          </span>
        </div>
        {/* 월 네비 + 2달 캘린더 */}
        <div style={{display:"flex",alignItems:"center",gap:T.sp.sm}}>
          <button onClick={prevM} style={{width:28,height:28,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",fontSize:T.fs.lg,color:T.gray600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>‹</button>
          <div style={{display:"flex",gap:T.sp.xxl,flex:1}}>
            <CalGrid y={months[0].y} m={months[0].m}/>
            <div style={{width:1,background:T.gray200,alignSelf:"stretch"}}/>
            <CalGrid y={months[1].y} m={months[1].m}/>
          </div>
          <button onClick={nextM} style={{width:28,height:28,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",fontSize:T.fs.lg,color:T.gray600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>›</button>
        </div>
        {/* 하단 버튼 */}
        <div style={{display:"flex",gap:T.sp.sm,marginTop:14,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{height:32,padding:"0 16px",borderRadius:T.radius.md,border:"1px solid "+T.border,background:T.bgCard,fontSize:T.fs.sm,cursor:"pointer",color:T.gray600,fontFamily:"inherit"}}>취소</button>
          <button onClick={doApply} style={{height:32,padding:"0 20px",borderRadius:T.radius.md,border:"none",background:T.primary,fontSize:T.fs.sm,cursor:"pointer",color:T.bgCard,fontFamily:"inherit",fontWeight:T.fw.bolder}}>적용</button>
        </div>
      </div>
    </div>;
  }

  // ── 모바일 바텀시트 ──
  return <div style={{position:"fixed",inset:0,zIndex:3000,display:"flex",flexDirection:"column",justifyContent:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.45)"}} onClick={onClose}/>
    <div style={{position:"relative",background:T.bgCard,borderRadius:"16px 16px 0 0",padding:"0 0 calc(32px + 56px + env(safe-area-inset-bottom))",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}><div style={{width:36,height:4,borderRadius:T.radius.sm,background:T.gray300}}/></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 20px 14px"}}>
        <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:T.text}}>날짜 선택</span>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {presets.map(([k,v])=><button key={k} onClick={()=>applyPreset(k)} style={{
            height:30,padding:"0 10px",borderRadius:T.radius.md,border:"1px solid",fontSize:T.fs.sm,cursor:"pointer",fontFamily:"inherit",
            background:period===k?T.primary:T.gray100,color:period===k?T.bgCard:T.gray700,borderColor:period===k?T.primary:T.gray300}}>{v}</button>)}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",marginBottom:10}}>
        <button onClick={prevM} style={{width:32,height:32,border:"none",background:"none",cursor:"pointer",fontSize:T.fs.xxl,color:T.gray700}}>‹</button>
        <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{months[0].y}.{String(months[0].m+1).padStart(2,"0")}</span>
        <button onClick={nextM} style={{width:32,height:32,border:"none",background:"none",cursor:"pointer",fontSize:T.fs.xxl,color:T.gray700}}>›</button>
      </div>
      <div style={{padding:"0 16px"}}><CalGrid y={months[0].y} m={months[0].m}/></div>
      {selStart&&<div style={{padding:"14px 20px 0",textAlign:"center",color:T.textSub,fontSize:T.fs.sm}}>{selStart}{selEnd&&selEnd!==selStart?` ~ ${selEnd}`:""}</div>}
      <div style={{display:"flex",gap:10,padding:"16px 20px 0"}}>
        <button onClick={onClose} style={{flex:1,height:46,border:"1.5px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,fontSize:T.fs.md,cursor:"pointer",color:T.gray700,fontFamily:"inherit"}}>취소</button>
        <button onClick={doApply} style={{flex:2,height:46,border:"none",borderRadius:T.radius.md,background:T.primary,fontSize:T.fs.md,cursor:"pointer",color:T.bgCard,fontFamily:"inherit",fontWeight:T.fw.bolder}}>적용</button>
      </div>
    </div>
  </div>;
}
const DataTable = ({ children, maxH, card=true, style={}, className="" }) => (
  <div
    className={`${card ? "card " : ""}tw${className ? " "+className : ""}`}
    style={{
      overflowX: "auto",
      overflowY: maxH ? "auto" : "visible",
      maxHeight: maxH,
      ...style,
    }}
  >
    <table>{children}</table>
  </div>
);
const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={} }) => {
  const { T: _T } = { T: window.__T || {} };
  const bg = variant==="primary"?"#7c7cc8":variant==="danger"?"#e05555":variant==="ghost"?"transparent":"#f0f0f0";
  const color = variant==="ghost"?"#7c7cc8":variant==="secondary"?"#333":"#fff";
  const border = variant==="ghost"?"1px solid #ddd":"none";
  const pad = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:8,padding:pad,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,...style}}>{children}</button>;
};
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
  const [resPage, setResPage] = useState(0);
  const RES_PER_PAGE = 50;

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
    request:        {bg:"#F3E5F5",      color:"#9C27B0",    label:"AI신청"},
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
    {k:"request",  label:"AI신청"},
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
    {resFinal.length===0 && <Empty msg="예약이 없습니다" icon="calendar"/>}
    {resFinal.length>0 && <div style={{display:"flex",flexDirection:"column",gap:D.gap}}>
      {/* 페이지 정보 */}
      {resFinal.length > RES_PER_PAGE && <div style={{display:"flex",justifyContent:"flex-end",fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>{resPage*RES_PER_PAGE+1}~{Math.min((resPage+1)*RES_PER_PAGE, resFinal.length)} / {resFinal.length}건</div>}
      {/* 그리드 헤더 - 데스크톱만 */}
      {!isMobile && <div style={{display:"grid",gridTemplateColumns:resGridCols(),gap:8,padding:"6px 14px",borderRadius:T.radius.md,background:T.gray200}}>
        {["날짜·시간","매장","고객","시술 / 네이버정보","연락처","예약번호","메모","상태",""].map(h=>
          <span key={h} style={{fontSize:12,fontWeight:700,color:T.textSub}}>{h}</span>
        )}
      </div>}

      {/* 카드 행 */}
      {resFinal.slice(resPage * RES_PER_PAGE, (resPage + 1) * RES_PER_PAGE).map(r => {
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
          display:"grid", gridTemplateColumns:resGridCols(),
          gap:8, alignItems:"center",
          padding:"10px 14px",
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
          {/* 날짜·시간 */}
          <div>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.3}}>{r.date.slice(5)}</div>
            <div style={{fontSize:15,fontWeight:700,color:T.primary,lineHeight:1.3}}>{r.time}</div>
          </div>
          {/* 매장 */}
          <div style={{fontSize:13,fontWeight:600,color:T.text}}>{br?.short||"-"}</div>
          {/* 고객 */}
          <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
            {g && <span style={{fontSize:10,fontWeight:700,borderRadius:3,padding:"1px 4px",background:g==="M"?T.maleLt:T.femaleLt,color:g==="M"?T.male:T.female,flexShrink:0}}>{g==="M"?"남":"여"}</span>}
            <span style={{fontSize:14,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.custName||"-"}</span>
            {isNaver && <I name="naver" size={11} color={T.naver} style={{flexShrink:0}}/>}
          </div>
          {/* 시술 + 네이버정보 (합쳐서) */}
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,color:T.gray700,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{svcDisplay}</div>
            {naverInfoItems.length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
              {naverInfoItems.slice(0,3).map(item=>
                <span key={item.label} style={{fontSize:10,padding:"1px 5px",borderRadius:10,background:T.primaryLt,color:T.primaryDk,fontWeight:600,whiteSpace:"nowrap"}}>{item.label}: {item.value}</span>
              )}
            </div>}
          </div>
          {/* 연락처 */}
          <div style={{fontSize:13,color:T.primary,whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>{r.custPhone||"-"}</div>
          {/* 예약번호 */}
          <div style={{fontSize:11}} onClick={e=>e.stopPropagation()}>
            {r.reservationId
              ? <a href={`https://partner.booking.naver.com/bizes/${br?.naverBizId||"449920"}/booking-list-view/bookings/${r.reservationId}`} target="_blank" rel="noreferrer" style={{color:T.naver,textDecoration:"none",fontWeight:600}}>{r.reservationId}</a>
              : <span style={{color:T.gray300}}>-</span>}
          </div>
          {/* 메모 */}
          <div style={{fontSize:12,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.ownerComment||r.memo||"-"}</div>
          {/* 상태 */}
          <div style={{textAlign:"center"}}>
            <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
          </div>
          {/* 액션 */}
          <div style={{display:"flex",gap:4,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
            <Btn variant="ghost" size="sm" onClick={()=>deleteRes(r.id)}
              style={{width:24,height:24,padding:0,borderRadius:T.radius.sm,border:"1px solid "+T.danger+"22",color:T.danger}}>
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

// Re-export Admin components for backward compatibility
import AdminPage from '../Admin/AdminPage'
import { UsersPage } from '../Admin/AdminPage'
export { AdminPage, UsersPage }
export default ReservationList
