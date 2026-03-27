import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, STATUS_LABEL, STATUS_CLR, NAVER_COLS, getNaverVal, BRANCH_DEFAULT_COLORS, branchColor } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { fromDb, toDb, _activeBizId, SYSTEM_TAG_IDS } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone } from '../../lib/utils'
import I from '../common/I'
import TimelineModal from '../Timeline/ReservationModal'
import useTouchDragSort from '../../hooks/useTouchDragSort'

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

    {/* 페이지네이션 */}
    {(()=>{const tp=Math.ceil(resFinal.length/RES_PER_PAGE); return tp>1 && <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,margin:"12px 0"}}>
      <button disabled={resPage===0} onClick={()=>setResPage(0)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:resPage===0?"default":"pointer",opacity:resPage===0?.4:1}}>«</button>
      <button disabled={resPage===0} onClick={()=>setResPage(p=>p-1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:resPage===0?"default":"pointer",opacity:resPage===0?.4:1}}>‹</button>
      <span style={{fontSize:T.fs.xs,color:T.textSub,padding:"0 8px"}}>{resPage+1} / {tp}</span>
      <button disabled={resPage>=tp-1} onClick={()=>setResPage(p=>p+1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:resPage>=tp-1?"default":"pointer",opacity:resPage>=tp-1?.4:1}}>›</button>
      <button disabled={resPage>=tp-1} onClick={()=>setResPage(tp-1)} style={{padding:"4px 10px",fontSize:T.fs.xs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:resPage>=tp-1?"default":"pointer",opacity:resPage>=tp-1?.4:1}}>»</button>
    </div>;})()}

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
  const [custPage, setCustPage] = useState(0);
  const CUST_PER_PAGE = 50;

  const custs = (data?.customers||[]).filter(c => {
    // 검색어 없으면 숨김 제외, 검색어 있으면 숨김 포함
    if (!q && c.isHidden) return false;
    const bm = vb==="all" ? userBranches.includes(c.bid) : c.bid===vb;
    const sm = !q || c.name.includes(q) || c.phone.includes(q) || (c.memo||"").includes(q);
    return bm && sm;
  }).sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  const totalPages = Math.ceil(custs.length / CUST_PER_PAGE);
  const pagedCusts = custs.slice(custPage * CUST_PER_PAGE, (custPage + 1) * CUST_PER_PAGE);

  const handleSave = (item) => {
    const normalized = {...item, phone: (item.phone || "").replace(/[^0-9]/g, "")};
    const isEdit = !!editItem; // editItem이 있으면 수정 모드
    if (!isEdit && normalized.phone) {
      const dup = (data?.customers||[]).find(c=>c.phone===normalized.phone);
      if (dup) { alert(`동일 번호(${normalized.phone})로 등록된 고객이 있습니다: ${dup.name}`); return; }
    }
    if (isEdit) {
      const dbRow = toDb("customers", normalized); delete dbRow.id;
      sb.update("customers", normalized.id, dbRow).catch(console.error);
      setData(prev => ({...prev, customers: (prev?.customers||[]).map(c=>c.id===normalized.id?normalized:c)}));
    } else {
      sb.insert("customers", toDb("customers", normalized)).catch(console.error);
      setData(prev => ({...prev, customers: [...(prev?.customers||[]), normalized]}));
    }
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
      <span style={{fontSize:T.fs.xxs,color:T.textMuted}}>{custs.length}명</span>
    </div>

    {/* 카드형 고객 리스트 */}
    {pagedCusts.length===0
      ? <div style={{textAlign:"center",padding:"40px 0",color:T.textMuted}}><I name="users" size={24}/><div style={{marginTop:8,fontSize:T.fs.xs}}>고객 없음</div></div>
      : <div style={{display:"flex",flexDirection:"column",gap:1,background:T.border,borderRadius:T.radius.md,overflow:"hidden",border:"1px solid "+T.border}}>
          {pagedCusts.map(c => {
            const br = (data.branches||[]).find(b=>b.id===c.bid);
            const isOpen = detailCust?.id===c.id;
            return <div key={c.id}>
              {/* 고객 행 */}
              <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 14px",background:isOpen?T.primaryHover:T.bgCard,cursor:"pointer",transition:"background .15s"}}
                onClick={()=>{ setDetailCust(isOpen?null:c); setDetailTab("sales"); }}>
                {/* 왼쪽: 이름+정보 */}
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
                  </div>
                </div>
                {/* 오른쪽: 메모 전체 표시 */}
                <div style={{flex:1,fontSize:T.fs.xxs,color:T.textSub,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:isOpen?"none":60,overflow:"hidden"}}>
                  {c.memo||<span style={{color:T.textMuted}}>-</span>}
                </div>
                {/* 편집 버튼 */}
                <div style={{flex:"0 0 auto",display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
                  <Btn variant="secondary" size="sm" onClick={()=>{setEditItem(c);setShowModal(true)}} style={{padding:"4px 6px"}}><I name="edit" size={11}/></Btn>
                </div>
              </div>

              {/* 상세 패널 (클릭 시 펼침) */}
              {isOpen && <div style={{background:T.gray100,borderTop:"2px solid "+T.primaryLt}}>
                <div style={{display:"flex",gap:0,borderBottom:"1px solid "+T.border,background:T.bgCard}}>
                  {[["sales","매출 내역 ("+custSales.length+")"],["pkg","보유권 ("+custPkgs.length+")"]].map(([tab,lbl])=>(
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
                      ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>보유권 없음</div>
                      : <div style={{display:"flex",gap:T.sp.sm,flexWrap:"wrap"}}>{custPkgs.map(p=><PkgCard key={p.id} p={p}/>)}</div>}
                  </div>}
                  {detailTab==="sales" && <div>
                    {custSales.length===0
                      ? <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:"8px 0"}}>매출 기록 없음</div>
                      : <div style={{maxHeight:400,overflowY:"auto"}}>
                          {custSales.map(s=>{
                            const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
                            const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
                            const total = sv+pr+(s.gift||0);
                            const brS = (data.branches||[]).find(b=>b.id===s.bid);
                            return <div key={s.id} style={{padding:"8px 0",borderBottom:"1px solid "+T.border+"66"}}>
                              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                                <span style={{fontSize:T.fs.xxs,color:T.textMuted,fontWeight:T.fw.bold}}>{s.date}</span>
                                <span style={{fontSize:9,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 4px"}}>{brS?.short||""}</span>
                                {s.staffName && <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{s.staffName}</span>}
                                <span style={{marginLeft:"auto",fontWeight:T.fw.bolder,color:T.info,fontSize:T.fs.xs}}>{fmt(total)}</span>
                              </div>
                              {s.memo && <div style={{fontSize:T.fs.xxs,color:T.textSub,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{s.memo}</div>}
                            </div>;
                          })}
                        </div>}
                  </div>}
                </div>
              </div>}
            </div>;
          })}
        </div>}

    {/* 페이지네이션 */}
    {totalPages > 1 && <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:12,flexWrap:"wrap"}}>
      <button disabled={custPage===0} onClick={()=>setCustPage(0)} style={{padding:"4px 8px",fontSize:T.fs.xxs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage===0?"default":"pointer",opacity:custPage===0?.4:1}}>«</button>
      <button disabled={custPage===0} onClick={()=>setCustPage(p=>p-1)} style={{padding:"4px 8px",fontSize:T.fs.xxs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage===0?"default":"pointer",opacity:custPage===0?.4:1}}>‹</button>
      <span style={{fontSize:T.fs.xs,color:T.textSub,padding:"0 8px"}}>{custPage+1} / {totalPages} <span style={{color:T.textMuted,fontSize:T.fs.nano}}>({custs.length}명)</span></span>
      <button disabled={custPage>=totalPages-1} onClick={()=>setCustPage(p=>p+1)} style={{padding:"4px 8px",fontSize:T.fs.xxs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage>=totalPages-1?"default":"pointer",opacity:custPage>=totalPages-1?.4:1}}>›</button>
      <button disabled={custPage>=totalPages-1} onClick={()=>setCustPage(totalPages-1)} style={{padding:"4px 8px",fontSize:T.fs.xxs,border:"1px solid "+T.border,borderRadius:T.radius.sm,background:T.bgCard,cursor:custPage>=totalPages-1?"default":"pointer",opacity:custPage>=totalPages-1?.4:1}}>»</button>
    </div>}

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
function AdminPlaces({ data, setData, bizId }) {
  const branches=data.branchSettings||(data.branches||[]).map(b=>({...b,color:"",useYn:true}));
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",short:"",phone:"",address:"",color:"",useYn:true});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",short:"",phone:"",address:"",color:"",useYn:true,staffColCount:0});setSheet(true);};
  const openEdit=b=>{setEdit(b);setForm({name:b.name||"",short:b.short||"",phone:b.phone||"",address:b.address||"",color:b.color||"",useYn:b.useYn!==false,staffColCount:b.staffColCount||0});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      if(edit){
        await sb.update("branches",edit.id,{name:form.name,short:form.short||form.name.slice(0,5),phone:form.phone,address:form.address,color:form.color,use_yn:form.useYn,staff_col_count:form.staffColCount||0});
        setData(p=>({...p,branches:(p.branches||[]).map(b=>b.id===edit.id?{...b,...form,staffColCount:form.staffColCount||0}:b),branchSettings:(p.branchSettings||[]).map(b=>b.id===edit.id?{...b,...form}:b)}));
      }else{
        const id="br_"+uid();
        await sb.insert("branches",{id,business_id:bizId,name:form.name,short:form.short||form.name.slice(0,5),phone:form.phone,address:form.address,color:form.color,use_yn:form.useYn,sort:branches.length});
        setData(p=>({...p,branches:[...(p.branches||[]),{id,...form}],branchSettings:[...(p.branchSettings||[]),{id,...form}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("branches",id).catch(console.error);
    setData(p=>({...p,branches:(p.branches||[]).filter(b=>b.id!==id),branchSettings:(p.branchSettings||[]).filter(b=>b.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="예약장소 관리" count={branches.length} onAdd={openNew}/>
    {branches.length===0?<AEmpty icon="building" message="등록된 지점이 없어요" onAdd={openNew} addLabel="지점 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {branches.map((b,i)=><AListItem key={b.id}
        left={<AColorDot color={b.color} size={22}/>} title={b.name}
        sub={[b.short&&("약칭: "+b.short),b.phone,b.address].filter(Boolean).join(" · ")||"정보 없음"}
        borderBottom={i<branches.length-1}
        right={<div style={{display:"flex",alignItems:"center",gap:8}}>
          <ABadge color={b.useYn!==false?T.success:T.gray400}>{b.useYn!==false?"운영":"중지"}</ABadge>
          <button onClick={e=>{e.stopPropagation();openEdit(b);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(b.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"지점 수정":"지점 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"지점 추가"}>
      <AField label="지점명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 강남점" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="약칭" hint="타임라인 등 좁은 공간에 표시"><input style={AInp} value={form.short} onChange={e=>set("short",e.target.value)} placeholder="예: 강남" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="전화번호"><input style={AInp} value={form.phone} onChange={e=>set("phone",e.target.value)} placeholder="02-0000-0000" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="주소"><input style={AInp} value={form.address} onChange={e=>set("address",e.target.value)} placeholder="서울특별시 강남구…" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
      <AField label="타임라인 컬럼 수" hint="0=자동(출근 직원 수), 숫자 설정 시 빈 컬럼 포함">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>set("staffColCount",Math.max(0,(form.staffColCount||0)-1))} style={{width:34,height:34,border:"1px solid #ddd",borderRadius:T.radius.md,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="minus" size={14} color={T.gray700}/></button>
          <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:(form.staffColCount||0)>0?T.primary:T.gray400,width:40,textAlign:"center"}}>{(form.staffColCount||0)===0?"자동":form.staffColCount}</span>
          <button onClick={()=>set("staffColCount",(form.staffColCount||0)+1)} style={{width:34,height:34,border:"1px solid #ddd",borderRadius:T.radius.md,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="plus" size={14} color={T.gray700}/></button>
        </div>
      </AField>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16,marginTop:4}}>
        <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:500}}>운영 중</span>
        <AToggle on={form.useYn} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="지점 삭제" desc="삭제 후에도 기존 예약 데이터는 유지됩니다." onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 공통 헤더 (하위 호환)
// ═══════════════════════════════════════════
function AdminHeader({ title, count, onAdd, addLabel, desc }) {
  return <APageHeader title={title} count={count} onAdd={onAdd} addLabel={addLabel} desc={desc}/>;
}

// ═══════════════════════════════════════════
// ADMIN — 담당자 관리
// ═══════════════════════════════════════════
function AdminWorkers({ data, setData }) {
  const rooms=data.rooms||[];
  const regBranches=[...(data.branchSettings||data.branches||[])].filter(b=>b.useYn!==false).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",branchId:"",color:""});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",branchId:regBranches[0]?.id||"",color:""});setSheet(true);};
  const openEdit=r=>{setEdit(r);setForm({name:r.name||"",branchId:r.branch_id||"",color:r.color||""});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim()||!form.branchId)return;
    setSaving(true);
    try{
      if(edit){
        await sb.update("rooms",edit.id,{name:form.name,branch_id:form.branchId,color:form.color});
        setData(p=>({...p,rooms:p.rooms.map(r=>r.id===edit.id?{...r,name:form.name,branch_id:form.branchId,color:form.color}:r)}));
      }else{
        const id="rm_"+uid();
        await sb.insert("rooms",{id,business_id:_activeBizId,branch_id:form.branchId,name:form.name,color:form.color,sort_order:rooms.length});
        setData(p=>({...p,rooms:[...(p.rooms||[]),{id,branch_id:form.branchId,name:form.name,color:form.color}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("rooms",id).catch(console.error);
    setData(p=>({...p,rooms:(p.rooms||[]).filter(r=>r.id!==id)}));
    setDel(null);
  };

  const branchName=id=>regBranches.find(b=>b.id===id)?.short||regBranches.find(b=>b.id===id)?.name||id;

  return <div>
    <APageHeader title="담당자 관리" count={rooms.length} onAdd={openNew}/>
    {rooms.length===0?<AEmpty icon="users" message="등록된 담당자가 없어요" onAdd={openNew} addLabel="담당자 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {[...(rooms)].sort((a,b)=>{
        const ai=regBranches.findIndex(b=>b.id===a.branch_id);
        const bi=regBranches.findIndex(b=>b.id===b.branch_id);
        return ai-bi;
      }).map((r,i)=><AListItem key={r.id}
        left={<AColorDot color={r.color} size={22}/>} title={r.name} sub={branchName(r.branch_id)}
        borderBottom={i<rooms.length-1}
        right={<div style={{display:"flex",gap:8}}>
          <button onClick={e=>{e.stopPropagation();openEdit(r);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(r.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"담당자 수정":"담당자 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()||!form.branchId} saveLabel={edit?"저장":"담당자 추가"}>
      <AField label="이름" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 김민지" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="소속 지점" required>
        <select style={{...AInp}} value={form.branchId} onChange={e=>set("branchId",e.target.value)}>
          <option value="">지점 선택</option>
          {regBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
    </ASheet>
    <AConfirm open={!!del} title="담당자 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 시술 상품 관리
// ═══════════════════════════════════════════
function AdminSaleItems({ data, setData }) {
  const [services,setServices]=useState([...(data?.services||[])].sort((a,b)=>a.sort-b.sort));
  const [filterCat,setFilterCat]=useState("all");
  const [cats,setCats]=useState(()=>[...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));
  useEffect(()=>{setCats([...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));},[data?.categories?.length]);
  const syncCats=u=>{setCats(u);if(setData)setData(p=>p?{...p,categories:u}:p);};

  const filtered=filterCat==="all"?services:services.filter(s=>s.cat===filterCat);

  const {mouseHandlers:svcMH, touchHandlers:svcTH, overIdx:svcOver} = useTouchDragSort(filtered, (reordered) => {
    const others = filterCat==="all" ? [] : services.filter(s=>s.cat!==filterCat);
    const updated = [...reordered, ...others].map((s,j)=>({...s,sort:j}));
    setServices(updated); setData(p=>({...p,services:updated}));
    updated.forEach((s,j)=>sb.update("services",s.id,{sort:j}).catch(console.error));
  });
  const moveSvc=(idx2,dir)=>{
    const cur=filterCat==="all"?[...services]:services.filter(s=>s.cat===filterCat);
    const ni=idx2+dir;if(ni<0||ni>=cur.length)return;
    [cur[idx2],cur[ni]]=[cur[ni],cur[idx2]];
    const others=filterCat==="all"?[]:services.filter(s=>s.cat!==filterCat);
    const updated=[...cur,...others].map((s,j)=>({...s,sort:j}));
    setServices(updated);setData(p=>({...p,services:updated}));
    updated.forEach((s,j)=>sb.update("services",s.id,{sort:j}).catch(console.error));
  };
  useEffect(()=>{setData(p=>({...p,services}));},[services]);

  const {mouseHandlers:catMH, touchHandlers:catTH, overIdx:catOver} = useTouchDragSort(cats, (reordered) => {
    const updated = reordered.map((c,i)=>({...c,sort:i}));
    syncCats(updated);
    updated.forEach((c,i)=>sb.update("service_categories",c.id,{sort:i}).catch(console.error));
  });

  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({cat:"",name:"",dur:20,priceF:0,priceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0});
  const [catSheet,setCatSheet]=useState(false);
  const [newCatName,setNewCatName]=useState("");
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({cat:cats[0]?.id||"",name:"",dur:20,priceF:0,priceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0});setSheet(true);};
  const openEdit=s=>{setEdit(s);setForm({cat:s.cat||"",name:s.name||"",dur:s.dur||20,priceF:s.priceF||0,priceM:s.priceM||0,note:s.note||"",isPackage:!!s.isPackage,pkgCount:s.pkgCount||10,pkgPriceF:s.pkgPriceF||0,pkgPriceM:s.pkgPriceM||0});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={cat:form.cat,name:form.name,dur:+form.dur,priceF:+form.priceF,priceM:+form.priceM,note:form.note,isPackage:form.isPackage,pkgCount:+form.pkgCount,pkgPriceF:+form.pkgPriceF,pkgPriceM:+form.pkgPriceM};
      if(edit){
        await sb.update("services",edit.id,pl);
        setServices(p=>p.map(s=>s.id===edit.id?{...s,...pl}:s));
      }else{
        const id="sv_"+uid();
        await sb.insert("services",{id,business_id:_activeBizId,...pl,sort:services.length});
        setServices(p=>[...p,{id,...pl,sort:services.length}]);
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("services",id).catch(console.error);
    setServices(p=>p.filter(s=>s.id!==id));
    setDel(null);
  };

  const addCat=async()=>{
    if(!newCatName.trim())return;
    const id="sc_"+uid();
    const nc={id,name:newCatName.trim(),sort:cats.length};
    await sb.insert("service_categories",{...nc,business_id:_activeBizId}).catch(console.error);
    syncCats([...cats,nc]);
    setNewCatName(""); setCatSheet(false);
  };

  const catName=id=>cats.find(c=>c.id===id)?.name||"미분류";
  const fmtSvc=n=>n?Number(n).toLocaleString()+"원":"-";
  const qtyOn=note=>(note||"").includes("[qty]");

  return <div>
    <APageHeader title="시술 상품 관리" count={services.length} onAdd={openNew}/>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <button onClick={()=>setFilterCat("all")}
  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:filterCat==="all"?700:500,
  background:filterCat==="all"?T.primary:T.gray100,color:filterCat==="all"?"#fff":T.gray600}}>전체</button>
{cats.map((c,ci)=><button key={c.id}
  data-drag-idx={ci}
  onClick={()=>setFilterCat(c.id)}
  {...catMH(ci)}
  {...catTH(ci)}
  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"grab",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:filterCat===c.id?700:500,
  background:catOver===ci?"#c5c5f0":filterCat===c.id?T.primary:T.gray100,
  color:catOver===ci?"#fff":filterCat===c.id?"#fff":T.gray600,
  transform:catOver===ci?"scale(1.05)":"none",transition:"all .15s"}}>{c.name}</button>)}
      <button onClick={()=>setCatSheet(true)} style={{padding:"5px 11px",borderRadius:20,border:"1px dashed #ccc",background:"none",color:T.textMuted,fontSize:T.fs.xs,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
        <I name="plus" size={11}/> 카테고리
      </button>
    </div>
    {filtered.length===0?<AEmpty icon="scissors" message="등록된 시술이 없어요" onAdd={openNew} addLabel="시술 추가"/>
    :<div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map((s,sidx)=><div key={s.id} className="card" data-drag-idx={sidx} {...svcMH(sidx)} {...svcTH(sidx)} style={{padding:"14px 16px",cursor:"grab"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>{s.name}</span>
              {s.isPackage&&<ABadge color={T.primary}>다회권</ABadge>}
              {qtyOn(s.note)&&<ABadge color={T.female} bg={T.femaleLt}>수량허용</ABadge>}
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:6}}>
              <span style={{fontSize:T.fs.xxs,color:T.textMuted}}><I name="clock" size={10}/> {s.dur}분</span>
              <span style={{fontSize:T.fs.xxs,color:T.female}}>여 {fmtSvc(s.priceF)}</span>
              <span style={{fontSize:T.fs.xxs,color:T.male}}>남 {fmtSvc(s.priceM)}</span>
            </div>
            <ABadge color={T.gray500} bg={T.gray100}>{catName(s.cat)}</ABadge>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,-1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===0?T.gray100:"#fff",borderRadius:4,cursor:sidx===0?"not-allowed":"pointer",fontSize:9,opacity:sidx===0?.4:1}}>&#9650;</button>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===filtered.length-1?T.gray100:"#fff",borderRadius:4,cursor:sidx===filtered.length-1?"not-allowed":"pointer",fontSize:9,opacity:sidx===filtered.length-1?.4:1}}>&#9660;</button>
            </div>
            <button onClick={()=>openEdit(s)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
            <button onClick={()=>setDel(s.id)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
          </div>
        </div>
      </div>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"시술 수정":"시술 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"시술 추가"}>
      <AField label="카테고리">
        <select style={{...AInp}} value={form.cat} onChange={e=>set("cat",e.target.value)}>
          {cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </AField>
      <AField label="시술명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 브라질리언" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <AField label="소요(분)"><input style={AInp} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="여성가"><input style={AInp} type="number" value={form.priceF} onChange={e=>set("priceF",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="남성가"><input style={AInp} type="number" value={form.priceM} onChange={e=>set("priceM",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <div style={{display:"flex",gap:20,padding:"12px 0",borderTop:"1px solid "+T.gray100,borderBottom:"1px solid "+T.gray100,marginBottom:14}}>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
          <AToggle size="sm" on={qtyOn(form.note)} onChange={v=>{const n=(form.note||"").replace("[qty]","").trim();set("note",v?n+"[qty]":n);}}/>
          <span style={{fontSize:T.fs.sm}}>수량허용</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
          <AToggle size="sm" on={!!form.isPackage} onChange={v=>set("isPackage",v)}/>
          <span style={{fontSize:T.fs.sm}}>다회권</span>
        </label>
      </div>
      {form.isPackage&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        <AField label="회수"><input style={AInp} type="number" value={form.pkgCount} onChange={e=>set("pkgCount",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="다회권 여성가"><input style={AInp} type="number" value={form.pkgPriceF} onChange={e=>set("pkgPriceF",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="다회권 남성가"><input style={AInp} type="number" value={form.pkgPriceM} onChange={e=>set("pkgPriceM",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>}

    </ASheet>
    <ASheet open={catSheet} onClose={()=>setCatSheet(false)} title="카테고리 추가">
      <AField label="카테고리명" required><input style={AInp} value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="예: 왁싱, 스킨케어" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AIBtn onClick={addCat} disabled={!newCatName.trim()} label="추가"/>
    </ASheet>
    <AConfirm open={!!del} title="시술 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 제품 관리
// ═══════════════════════════════════════════
function AdminProductItems({ data, setData }) {
const [items,setItems]=useState(()=>[...(data?.productItems||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));
useEffect(()=>{setItems([...(data?.productItems||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));},[data?.productItems?.length]);
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",price:0,stock:0,note:""});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
const dragIdx=useRef(null),dragOver=useRef(null);
const onDragStart_p=i=>{dragIdx.current=i;};
const onDragEnter_p=i=>{dragOver.current=i;};
const onDragEnd_p=()=>{
  const di=dragIdx.current,oi=dragOver.current;
  dragIdx.current=null;dragOver.current=null;
  if(di===null||oi===null||di===oi)return;
  const r=[...items];const [m]=r.splice(di,1);r.splice(oi,0,m);
  const updated=r.map((it,idx2)=>({...it,sort:idx2}));
  setItems(updated);setData(p=>({...p,productItems:updated}));
  updated.forEach((it,idx2)=>sb.update("product_items",it.id,{sort:idx2}).catch(console.error));
};
const moveItem_p=(i,dir)=>{
  const ni=i+dir;if(ni<0||ni>=items.length)return;
  const r=[...items];[r[i],r[ni]]=[r[ni],r[i]];
  const updated=r.map((it,idx2)=>({...it,sort:idx2}));
  setItems(updated);setData(p=>({...p,productItems:updated}));
  updated.forEach((it,idx2)=>sb.update("product_items",it.id,{sort:idx2}).catch(console.error));
};
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",price:0,stock:0,note:""});setSheet(true);};
  const openEdit=it=>{setEdit(it);setForm({name:it.name||"",price:it.price||0,stock:it.stock||0,note:it.note||""});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={name:form.name,price:+form.price,stock:+form.stock,note:form.note};
      if(edit){
        await sb.update("product_items",edit.id,pl);
        setData(p=>({...p,productItems:(p.productItems||[]).map(it=>it.id===edit.id?{...it,...pl}:it)}));
      }else{
        const id="pi_"+uid();
        await sb.insert("product_items",{id,business_id:_activeBizId,...pl});
        setData(p=>({...p,productItems:[...(p.productItems||[]),{id,...pl}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("product_items",id).catch(console.error);
    setData(p=>({...p,productItems:(p.productItems||[]).filter(it=>it.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="제품 관리" count={items.length} onAdd={openNew}/>
    {items.length===0?<AEmpty icon="clipboard" message="등록된 제품이 없어요" onAdd={openNew} addLabel="제품 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {items.map((it,i)=><AListItem key={it.id} draggable onDragStart={()=>onDragStart_p(i)} onDragEnter={()=>onDragEnter_p(i)} onDragEnd={onDragEnd_p} onDragOver={e=>e.preventDefault()}
        left={<div style={{width:34,height:34,borderRadius:9,background:T.gray100,display:"flex",alignItems:"center",justifyContent:"center"}}><I name="clipboard" size={15} style={{color:T.gray400}}/></div>}
        title={it.name}
        sub={[it.price&&(Number(it.price).toLocaleString()+"원"),it.stock!=null&&("재고 "+it.stock+"개")].filter(Boolean).join(" · ")}
        borderBottom={i<items.length-1}
        right={<div style={{display:"flex",gap:4,alignItems:"center"}}>
<div style={{display:"flex",flexDirection:"column",gap:2}}>
<button onClick={e=>{e.stopPropagation();moveItem_p(i,-1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",borderRadius:4,cursor:i===0?"not-allowed":"pointer",fontSize:9,opacity:i===0?.4:1}}>&#9650;</button>
<button onClick={e=>{e.stopPropagation();moveItem_p(i,1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:i===items.length-1?T.gray100:"#fff",borderRadius:4,cursor:i===items.length-1?"not-allowed":"pointer",fontSize:9,opacity:i===items.length-1?.4:1}}>&#9660;</button>
</div>
          <button onClick={e=>{e.stopPropagation();openEdit(it);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(it.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"제품 수정":"제품 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"제품 추가"}>
      <AField label="제품명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 진정 크림" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <AField label="가격(원)"><input style={AInp} type="number" value={form.price} onChange={e=>set("price",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="재고"><input style={AInp} type="number" value={form.stock} onChange={e=>set("stock",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <AField label="비고"><input style={AInp} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="메모" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AIBtn onClick={save} saving={saving} disabled={saving||!form.name.trim()} label={edit?"저장":"제품 추가"} style={{marginTop:4}}/>
    </ASheet>
    <AConfirm open={!!del} title="제품 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 예약경로 관리
// ═══════════════════════════════════════════
function AdminResSources({ data, setData }) {
  const srcs=data.resSources||[];
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",color:"",useYn:true});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const BRAND=[{n:"네이버",c:"#03C75A"},{n:"카카오",c:"#FEE500"},{n:"인스타",c:"#E4405F"},{n:"직접",c:"#7c7cc8"},{n:"기타",c:"#636e72"}];

  const openNew=()=>{setEdit(null);setForm({name:"",color:"",useYn:true});setSheet(true);};
  const openEdit=s=>{setEdit(s);setForm({name:s.name||"",color:s.color||"",useYn:s.useYn!==false});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={name:form.name,color:form.color,use_yn:form.useYn};
      if(edit){
        await sb.update("reservation_sources",edit.id,pl);
        setData(p=>({...p,resSources:(p.resSources||[]).map(s=>s.id===edit.id?{...s,...form}:s)}));
      }else{
        const id="rs_"+uid();
        await sb.insert("reservation_sources",{id,business_id:_activeBizId,...pl});
        setData(p=>({...p,resSources:[...(p.resSources||[]),{id,...form}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("reservation_sources",id).catch(console.error);
    setData(p=>({...p,resSources:(p.resSources||[]).filter(s=>s.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="예약경로 관리" count={srcs.length} onAdd={openNew}/>
    {srcs.length===0?<AEmpty icon="zap" message="등록된 예약경로가 없어요" onAdd={openNew} addLabel="경로 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {srcs.map((s,i)=><AListItem key={s.id}
        left={<AColorDot color={s.color} size={22}/>} title={s.name}
        borderBottom={i<srcs.length-1}
        right={<div style={{display:"flex",alignItems:"center",gap:8}}>
          <ABadge color={s.useYn!==false?T.success:T.gray400}>{s.useYn!==false?"사용":"중지"}</ABadge>
          <button onClick={e=>{e.stopPropagation();openEdit(s);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(s.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"경로 수정":"경로 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"경로 추가"}>
      <AField label="경로명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 네이버, 인스타그램" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="색상">
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {BRAND.map(({n,c})=><button key={c} onClick={()=>set("color",c)}
            style={{padding:"5px 12px",borderRadius:20,border:form.color===c?"2px solid "+T.text:"2px solid transparent",background:c,color:c==="#FEE500"?"#333":"#fff",fontSize:T.fs.xs,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>)}
        </div>
        <APalette value={form.color} onChange={v=>set("color",v)}/>
      </AField>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16}}>
        <span style={{fontSize:T.fs.sm,fontWeight:500}}>사용 중</span>
        <AToggle on={form.useYn} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="경로 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 알림톡 설정
// ═══════════════════════════════════════════
function AdminNoti({ data, setData, sb, bizId, branches }) {
  const [selBranch,setSelBranch]=useState(branches?.[0]?.id||null);
  const branch=branches?.find(b=>b.id===selBranch);
  const [cfg,setCfg]=useState({});
  const [saved,setSaved]=useState(false);
  const [detail,setDetail]=useState(null);
  const [apiOpen,setApiOpen]=useState(false);

  useEffect(()=>{
    if(!selBranch)return;
    const raw=branch?.notiConfig; setCfg(typeof raw==="string"?JSON.parse(raw)||{}:raw||{}); setDetail(null);
  },[selBranch]);

  const up=(k,v)=>{setCfg(p=>({...p,[k]:v}));setSaved(false);};
  const save=async()=>{
    if(!selBranch)return;
    const cfgStr=JSON.stringify(cfg);
    await sb.update("branches",selBranch,{noti_config:cfgStr}).catch(console.error);
    setData(prev=>prev?{...prev,branches:(prev.branches||[]).map(b=>b.id===selBranch?{...b,notiConfig:cfg}:b)}:prev);
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const GROUPS=[
    {label:"예약 알림",items:[
      {key:"rsv_confirm",label:"예약 확정",   desc:"예약 확정 시 발송"},
      {key:"rsv_change", label:"예약 변경",   desc:"예약 변경 시 발송"},
      {key:"rsv_1day",   label:"1일 전 알림", desc:"전날 지정 시각에 발송",hasTime:true},
      {key:"rsv_today",  label:"당일 알림",   desc:"당일 아침 지정 시각에 발송",hasTime:true},
      {key:"rsv_cancel", label:"예약 취소",   desc:"예약 취소 시 발송"},
      {key:"rsv_naver",  label:"네이버 대기", desc:"네이버 예약 대기 상태 시 발송"},
    ]},
    {label:"정액권 알림",items:[
      {key:"pkg_pay",   label:"결제 완료",  desc:"정액권 결제 완료 시 발송"},
      {key:"pkg_charge",label:"충전 완료",  desc:"정액권 충전 시 발송"},
      {key:"pkg_exp_1m",label:"만기 1달 전",desc:"만료 30일 전 발송"},
      {key:"pkg_exp_1w",label:"만기 1주 전",desc:"만료 7일 전 발송"},
    ]},
    {label:"티켓 알림",items:[
      {key:"tkt_pay",   label:"결제 완료",  desc:"티켓 결제 완료 시 발송"},
      {key:"tkt_charge",label:"충전 완료",  desc:"티켓 충전 시 발송"},
      {key:"tkt_exp_1m",label:"만기 1달 전",desc:"만료 30일 전 발송"},
      {key:"tkt_exp_1w",label:"만기 1주 전",desc:"만료 7일 전 발송"},
    ]},
    {label:"포인트 알림",items:[
      {key:"pt_earn",label:"포인트 적립",desc:"포인트 적립 시 발송"},
      {key:"pt_use", label:"포인트 사용",desc:"포인트 사용 시 발송"},
    ]},
  ];

  const notiOn=key=>!!(cfg[key]?.on);
  const toggleOn=key=>up(key,{...(cfg[key]||{}),on:!notiOn(key)});

  if(detail){
    const item=GROUPS.flatMap(g=>g.items).find(it=>it.key===detail);
    const c=cfg[detail]||{};
    const upC=(k,v)=>up(detail,{...c,[k]:v});
    return <div>
      <button onClick={()=>setDetail(null)} style={{display:"inline-flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,fontFamily:"inherit",marginBottom:20,padding:0}}>
        <I name="arrowL" size={14}/> 알림톡 설정
      </button>
      <APageHeader title={item?.label||detail}/>
      <div className="card" style={{padding:20,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:T.fs.sm,fontWeight:500}}>알림 발송</span>
          <AToggle on={!!c.on} onChange={v=>upC("on",v)}/>
        </div>
        <AField label="템플릿 코드"><input style={AInp} value={c.tplCode||""} onChange={e=>upC("tplCode",e.target.value)} placeholder="예: UG_2264" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        {item?.hasTime&&<AField label="발송 시각"><input style={{...AInp,width:"auto"}} type="time" value={c.sendTime||"09:00"} onChange={e=>upC("sendTime",e.target.value)}/></AField>}
        <AField label="메시지 템플릿"><textarea style={{...AInp,height:100,resize:"vertical",lineHeight:1.5}} value={c.msgTpl||""} onChange={e=>upC("msgTpl",e.target.value)} placeholder={"예: 안녕하세요 #{고객명}님,\n#{날짜} #{시간} 예약이 확정되었습니다.\n지점: #{지점명}"} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:-8,marginBottom:4}}>예약알림 변수: #{"{사용자명}"} #{"{날짜}"} #{"{시간}"} #{"{작업자}"} #{"{작업장소}"} #{"{대표전화번호}"} #{"{예약URL}"}</div>
      </div>
      <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"저장"} style={{background:saved?T.success:T.primary}}/>
    </div>;
  }

  return <div>
    <APageHeader title="알림톡 설정" desc="카카오 알림톡 자동 발송을 설정하세요"/>
    {branches.length>1&&<div style={{marginBottom:16,display:"flex",gap:6,flexWrap:"wrap"}}>
      {branches.map(b=><button key={b.id} onClick={()=>setSelBranch(b.id)}
        style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:selBranch===b.id?700:500,
          background:selBranch===b.id?T.primary:T.gray100,color:selBranch===b.id?"#fff":T.gray600}}>{b.name}</button>)}
    </div>}
    <div className="card" style={{padding:0,overflow:"hidden",marginBottom:16}}>
      <div onClick={()=>setApiOpen(!apiOpen)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"#FEE500",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"#3A1D1D"}}>K</div>
          <div>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>카카오 채널 API 설정</div>
            <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>알리고 알림톡 연동 정보</div>
          </div>
        </div>
        <I name={apiOpen?"chevU":"chevD"} size={16} style={{color:T.gray400}}/>
      </div>
      {apiOpen&&<div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
        {[["API Key","aligoKey","aeymilcraepgb3i2lgmyk2iez23iefh9"],["사용자 ID","aligoId","cripiss"],["발신 채널 키(SenderKey)","senderKey","카카오 채널 발신 키"],["발신 번호","senderPhone","010-xxxx-xxxx"]].map(([lv,k,ph])=>
          <AField key={k} label={lv}><input style={AInp} value={cfg[k]||""} onChange={e=>up(k,e.target.value)} placeholder={ph} onFocus={el=>el.target.style.borderColor=T.primary} onBlur={el=>el.target.style.borderColor="#e8e8f0"}/></AField>)}
        <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"API 저장"} style={{background:saved?T.success:T.primary}}/>
      </div>}
    </div>
    {GROUPS.map(g=><div key={g.label} style={{marginBottom:16}}>
      <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:8,paddingLeft:2}}>{g.label}</div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        {g.items.map((item,idx)=><div key={item.key} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",borderBottom:idx<g.items.length-1?"1px solid "+T.gray100:"none"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>{item.label}</div>
            <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{item.desc}</div>
          </div>
          <AToggle size="sm" on={notiOn(item.key)} onChange={()=>toggleOn(item.key)}/>
          <button onClick={()=>setDetail(item.key)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="chevR" size={13} style={{color:T.gray400}}/></button>
        </div>)}
      </div>
    </div>)}
    <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"저장"} style={{background:saved?T.success:T.primary}}/>
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — AI 설정
// ═══════════════════════════════════════════
const AI_RULES_KEY = "bliss_ai_rules";

function AdminAISettings({ data, sb: sbProp, bizId }) {
  const [activeAiTab,setActiveAiTab]=useState("api"); // "api" | "rules" | "chat"
  const [apiKey,setApiKey]=useState(()=>window.__geminiKey||localStorage.getItem("bliss_gemini_key")||"");
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const [rules,setRules]=useState(()=>{try{return JSON.parse(localStorage.getItem(AI_RULES_KEY)||"[]");}catch{return [];}});
  const [chatPrompt,setChatPrompt]=useState(()=>localStorage.getItem("bliss_ai_chat_prompt")||"");
  const [chatSaved,setChatSaved]=useState(false);

  useEffect(()=>{
    if(!bizId)return;
    fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders})
    .then(r=>r.json()).then(rows=>{
      try{
        const memo=JSON.parse(rows[0]?.settings||"{}");
        if(memo.gemini_key){setApiKey(memo.gemini_key);localStorage.setItem("bliss_gemini_key",memo.gemini_key);}
        if(memo.ai_rules?.length){setRules(memo.ai_rules);localStorage.setItem(AI_RULES_KEY,JSON.stringify(memo.ai_rules));}
        if(memo.ai_chat_prompt!=null){setChatPrompt(memo.ai_chat_prompt);localStorage.setItem("bliss_ai_chat_prompt",memo.ai_chat_prompt);window.__aiChatPrompt=memo.ai_chat_prompt;}
      }catch(e){}
    }).catch(()=>{});
  },[bizId]);

  const [newRule,setNewRule]=useState("");
  const [editIdx,setEditIdx]=useState(null);
  const [editVal,setEditVal]=useState("");

  const saveKey=async()=>{
    const t=apiKey.trim();
    localStorage.setItem("bliss_gemini_key",t);
    window.__geminiKey=t;
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.gemini_key=t;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const testKey=async()=>{
    setTesting(true); setTestResult(null);
    try{
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+apiKey.trim(),
        {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"안녕"}]}]})});
      setTestResult(r.ok?"✓ 연결 성공":"✕ 연결 실패 ("+r.status+")");
    }catch(e){setTestResult("✕ "+e.message);}
    finally{setTesting(false);}
  };

  const saveRules=async updated=>{
    setRules(updated);
    localStorage.setItem(AI_RULES_KEY,JSON.stringify(updated));
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.ai_rules=updated;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
  };

  const addRule=()=>{if(newRule.trim()){saveRules([...rules,newRule.trim()]);setNewRule("");}};
  const delRule=i=>saveRules(rules.filter((_,idx)=>idx!==i));
  const startEdit=i=>{setEditIdx(i);setEditVal(rules[i]);};
  const saveEdit=()=>{if(editVal.trim()){saveRules(rules.map((r,i)=>i===editIdx?editVal.trim():r));setEditIdx(null);}};

  const saveChatPrompt=async()=>{
    const t=chatPrompt;
    localStorage.setItem("bliss_ai_chat_prompt",t);
    window.__aiChatPrompt=t;
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.ai_chat_prompt=t;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
    setChatSaved(true); setTimeout(()=>setChatSaved(false),2000);
  };

  // 시술 가격표 텍스트 생성 (자동응대 프롬프트 미리보기용)
  const svcPriceText = React.useMemo(()=>{
    const svcs=(data?.services||[]).filter(s=>s.name);
    if(!svcs.length) return "(등록된 시술 없음)";
    return svcs.map(s=>{
      const parts=[s.name];
      if(s.dur) parts.push(s.dur+"분");
      if(s.priceF) parts.push("여 "+Number(s.priceF).toLocaleString()+"원");
      if(s.priceM) parts.push("남 "+Number(s.priceM).toLocaleString()+"원");
      if(s.price) parts.push(Number(s.price).toLocaleString()+"원");
      return parts.join(" / ");
    }).join("\n");
  },[data?.services]);

  const AI_TABS=[
    {id:"api",label:"API 키"},
    {id:"rules",label:"분석 규칙"},
    {id:"chat",label:"자동 응대"},
  ];

  return <div>
    <APageHeader title="AI 설정" desc="AI 분석 및 자동 응대 기능을 설정하세요"/>
    <div style={{display:"flex",gap:6,marginBottom:20}}>
      {AI_TABS.map(t=><button key={t.id} onClick={()=>setActiveAiTab(t.id)} style={{
        padding:"7px 16px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",
        fontSize:T.fs.xs,fontWeight:activeAiTab===t.id?700:500,
        background:activeAiTab===t.id?T.primary:T.gray100,
        color:activeAiTab===t.id?"#fff":T.gray600,transition:"all .15s"
      }}>{t.label}</button>)}
    </div>
    {/* ── API 키 탭 ── */}
    {activeAiTab==="api" && <div className="card" style={{padding:20}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
        <I name="sparkles" size={14} style={{color:T.primary}}/> Gemini API 키
      </div>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:14,lineHeight:1.6}}>
        AI Book 기능에 사용됩니다.{" "}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" style={{color:T.primary,fontWeight:700}}>Google AI Studio</a>에서 무료로 발급받을 수 있어요.
      </div>
      <AField label="API 키">
        <input style={AInp} type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="AIzaSy…" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/>
      </AField>
      {testResult&&<div style={{fontSize:T.fs.xs,padding:"8px 12px",borderRadius:8,marginBottom:12,background:testResult.startsWith("✓")?"#f0faf4":"#fff5f5",color:testResult.startsWith("✓")?T.success:T.danger}}>{testResult}</div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={testKey} disabled={testing||!apiKey.trim()} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid "+T.border,background:"#fff",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>
          {testing?"테스트 중…":"연결 테스트"}
        </button>
        <AIBtn onClick={saveKey} disabled={!apiKey.trim()} label={saved?"✓ 저장됨":"저장"} style={{flex:1,background:saved?T.success:T.primary}}/>
      </div>
    </div>}

    {/* ── 분석 규칙 탭 ── */}
    {activeAiTab==="rules" && <div className="card" style={{padding:20}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
        <I name="fileText" size={14} style={{color:T.primary}}/> AI 분석 커스텀 규칙
        <ABadge color={T.primary}>{rules.length}개</ABadge>
      </div>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:16,lineHeight:1.6}}>네이버 예약정보 AI 분석 시 이 규칙들이 프롬프트에 추가됩니다.</div>
      {rules.length===0?<AEmpty icon="fileText" message="등록된 규칙이 없어요"/>
      :<div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {rules.map((r,i)=><div key={i} style={{border:"1.5px solid "+T.border,borderRadius:10,padding:"12px 14px",background:"#fafafa"}}>
          {editIdx===i
            ?<div>
              <textarea style={{...AInp,minHeight:72,resize:"vertical",marginBottom:10,lineHeight:1.6}} value={editVal} onChange={e=>setEditVal(e.target.value)}/>
              <div style={{display:"flex",gap:8}}>
                <AIBtn onClick={saveEdit} disabled={!editVal.trim()} label="저장" style={{flex:1}}/>
                <button onClick={()=>setEditIdx(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+T.border,background:"none",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
              </div>
            </div>
            :<div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1,fontSize:T.fs.xs,color:T.text,lineHeight:1.6}}>{r}</div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>startEdit(i)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={12} style={{color:T.gray500}}/></button>
                <button onClick={()=>delRule(i)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={12} style={{color:T.danger}}/></button>
              </div>
            </div>}
        </div>)}
      </div>}
      <AField label="새 규칙 추가">
        <textarea style={{...AInp,minHeight:80,resize:"vertical",marginBottom:10,lineHeight:1.6}} value={newRule} onChange={e=>setNewRule(e.target.value)} placeholder="예: 다리안쪽은 다리 절반 시술이다"/>
      </AField>
      <AIBtn onClick={addRule} disabled={!newRule.trim()} label="규칙 추가"/>
    </div>}

    {/* ── 자동 응대 탭 ── */}
    {activeAiTab==="chat" && <div>
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
          <I name="chat" size={14} style={{color:T.primary}}/> 자동 응대 프롬프트
        </div>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:16,lineHeight:1.6}}>
          고객 메시지에 AI가 자동 답변할 때 사용할 지침입니다.<br/>
          영업시간, 주의사항, 안내 문구 등을 자유롭게 작성하세요.
        </div>
        <AField label="응대 지침">
          <textarea style={{...AInp,minHeight:160,resize:"vertical",lineHeight:1.7}} value={chatPrompt} onChange={e=>setChatPrompt(e.target.value)}
            placeholder={"예:\n- 영업시간: 오전 11시 ~ 오후 10시 (연중무휴)\n- 가격 문의 시 아래 가격표를 참고하여 정확히 안내\n- 할인/이벤트는 안내하지 말 것\n- 예약은 네이버 예약 링크로 안내"}/>
        </AField>
        <AIBtn onClick={saveChatPrompt} label={chatSaved?"✓ 저장됨":"저장"} style={{background:chatSaved?T.success:T.primary}}/>
      </div>

      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
          <I name="clipboard" size={14} style={{color:T.gray500}}/> 자동 포함되는 정보
        </div>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12,lineHeight:1.6}}>
          아래 정보는 AI 응대 시 자동으로 프롬프트에 포함됩니다. (관리설정에서 수정)
        </div>
        <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.text,marginBottom:6}}>시술 가격표</div>
        <pre style={{fontSize:T.fs.xxs,color:T.gray600,background:T.gray100,padding:12,borderRadius:8,whiteSpace:"pre-wrap",lineHeight:1.6,marginBottom:16,maxHeight:200,overflowY:"auto"}}>{svcPriceText}</pre>
        <div style={{fontSize:T.fs.xxs,color:T.textMuted,lineHeight:1.5}}>
          시술 상품 관리에서 등록한 시술 항목과 가격이 자동 반영됩니다.
        </div>
      </div>
    </div>}
  </div>;
}

// ═══════════════════════════════════════════
// ADMIN — 태그 관리
// ═══════════════════════════════════════════
function AdminServiceTags({ data, setData }) {
  const [tags,setTags]=useState(()=>[...(data?.serviceTags||[])].sort((a,b)=>a.sort-b.sort));
  useEffect(()=>{setData(p=>p?{...p,serviceTags:tags}:p);},[tags]);

  const [activeTab,setActiveTab]=useState("reservation");
  const [sheet,setSheet]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState({name:"",dur:0,color:"",useYn:true});
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const isSchedule=activeTab==="schedule";
  const tabTags=(tags||[]).filter(t=>isSchedule?t.scheduleYn==="Y":t.scheduleYn!=="Y");

  const getContrast=hex=>{
    if(!hex||hex.length<4)return T.text;
    const h=hex.replace("#","");
    const r=parseInt(h.length===3?h[0]+h[0]:h.slice(0,2),16);
    const g=parseInt(h.length===3?h[1]+h[1]:h.slice(2,4),16);
    const b=parseInt(h.length===3?h[2]+h[2]:h.slice(4,6),16);
    return(0.299*r+0.587*g+0.114*b)/255>0.55?T.text:"#fff";
  };

  const syncTags=updated=>{setTags(updated);if(setData)setData(p=>p?{...p,serviceTags:updated}:p);};
  const tagToDb=t=>({id:t.id,business_id:_activeBizId,name:t.name,dur:t.dur||0,schedule_yn:t.scheduleYn==="Y"?"Y":"N",color:t.color||"",use_yn:t.useYn!==false,sort:t.sort||0});

  const openNew=()=>{setEditItem(null);setForm({name:"",dur:0,color:"",useYn:true});setSheet(true);};
  const openEdit=t=>{setEditItem(t);setForm({name:t.name||"",dur:t.dur||0,color:t.color||"",useYn:t.useYn!==false});setSheet(true);};

  const save=()=>{
    if(!form.name.trim())return;
    if(editItem){
      syncTags(tags.map(t=>t.id===editItem.id?{...t,...form}:t));
      sb.update("service_tags",editItem.id,{name:form.name,dur:form.dur||0,color:form.color,use_yn:form.useYn!==false,sort:editItem.sort||0}).catch(console.error);
    }else{
      const t={id:uid(),name:form.name.trim(),dur:Number(form.dur)||0,scheduleYn:isSchedule?"Y":"N",color:form.color,useYn:true,sort:tags.length};
      syncTags([...tags,t]);
      sb.upsert("service_tags",[tagToDb(t)]);
    }
    setSheet(false);
  };

  const doDelete=id=>{
    if(SYSTEM_TAG_IDS.includes(id)){alert("시스템 태그는 삭제할 수 없습니다.");setDel(null);return;}
    syncTags((tags||[]).filter(t=>t.id!==id).map((t,i)=>({...t,sort:i})));
    sb.del("service_tags",id).catch(console.error);
    setDel(null);
  };

  const toggleUse=id=>{
    const tag=tags.find(t=>t.id===id);
    const newUse=tag?.useYn===false;
    syncTags(tags.map(t=>t.id===id?{...t,useYn:newUse}:t));
    sb.update("service_tags",id,{use_yn:newUse}).catch(console.error);
  };

  const {mouseHandlers:tagMH, touchHandlers:tagTH, overIdx:tagOver} = useTouchDragSort(tabTags, (reordered) => {
    const other=(tags||[]).filter(t=>isSchedule?t.scheduleYn!=="Y":t.scheduleYn==="Y");
    const all=[...reordered,...other].map((t,j)=>({...t,sort:j}));
    syncTags(all);
    reordered.forEach((t,j)=>sb.update("service_tags",t.id,{sort:j}).catch(console.error));
  });

  return <div>
    <APageHeader title="태그 관리" count={tabTags.length} onAdd={openNew}/>
    <div style={{display:"flex",gap:6,marginBottom:16}}>
      {[["reservation","예약"],["schedule","내부일정"]].map(([k,lv])=>
        <button key={k} onClick={()=>setActiveTab(k)}
          style={{padding:"7px 18px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:activeTab===k?700:500,
            background:activeTab===k?T.primary:T.gray100,color:activeTab===k?"#fff":T.gray600}}>{lv}</button>)}
    </div>
    {tabTags.filter(t=>t.useYn!==false).length>0&&<div style={{marginBottom:16,padding:"12px 14px",background:T.gray100,borderRadius:12}}>
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:8,fontWeight:T.fw.bold}}>미리보기 (드래그로 순서 변경)</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {tabTags.filter(t=>t.useYn!==false).map((t,i)=><div key={t.id}
          data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
          style={{padding:"4px 12px",borderRadius:20,background:tagOver===i?(t.color||T.primary)+"cc":(t.color||T.primary),color:getContrast(t.color||T.primary),fontSize:T.fs.xs,fontWeight:700,cursor:"grab",opacity:tagOver===i?0.5:1}}>{t.name}</div>)}
      </div>
    </div>}
    {tabTags.length===0?<AEmpty icon="tag" message="등록된 태그가 없어요" onAdd={openNew} addLabel="태그 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {tabTags.map((t,i)=><div key={t.id} draggable
  data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
  style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:i<tabTags.length-1?"1px solid "+T.gray100:"none",cursor:"grab",
  background:tagOver===i?T.primaryHover:"transparent",transition:"background .1s"}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:t.color||T.primary,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:t.useYn!==false?T.text:T.gray400}}>{t.name}</div>
          {t.dur>0&&<div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{t.dur}분</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
  <button onClick={e=>{e.stopPropagation();if(i===0)return;const r=[...tabTags];const [m]=r.splice(i,1);r.splice(i-1,0,m);const other=(tags||[]).filter(t2=>isSchedule?t2.scheduleYn!=="Y":t2.scheduleYn==="Y");const all=[...r,...other].map((t2,j)=>({...t2,sort:j}));syncTags(all);r.forEach((t2,j)=>sb.update("service_tags",t2.id,{sort:j}).catch(console.error));}} style={{width:22,height:22,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",borderRadius:4,cursor:i===0?"not-allowed":"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===0?.4:1}}>&#9650;</button>
  <button onClick={e=>{e.stopPropagation();if(i===tabTags.length-1)return;const r=[...tabTags];const [m]=r.splice(i,1);r.splice(i+1,0,m);const other=(tags||[]).filter(t2=>isSchedule?t2.scheduleYn!=="Y":t2.scheduleYn==="Y");const all=[...r,...other].map((t2,j)=>({...t2,sort:j}));syncTags(all);r.forEach((t2,j)=>sb.update("service_tags",t2.id,{sort:j}).catch(console.error));}} style={{width:22,height:22,border:"1px solid "+T.border,background:i===tabTags.length-1?T.gray100:"#fff",borderRadius:4,cursor:i===tabTags.length-1?"not-allowed":"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===tabTags.length-1?.4:1}}>&#9660;</button>
</div>
{SYSTEM_TAG_IDS.includes(t.id)&&<ABadge color="#f39c12" bg="#fff3e0">시스템</ABadge>}
        <AToggle size="sm" on={t.useYn!==false} onChange={()=>toggleUse(t.id)}/>
        <button onClick={()=>openEdit(t)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
        {!SYSTEM_TAG_IDS.includes(t.id)&&<button onClick={()=>setDel(t.id)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>}
      </div>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={editItem?"태그 수정":"태그 추가"} onSave={save} saveDisabled={!form.name.trim()} saveLabel={editItem?"저장":"태그 추가"}>
      <AField label="태그명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 신규, VIP" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="소요 시간(분)" hint="0이면 기본 시술 시간 사용"><input style={{...AInp,width:120}} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
      {form.color&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"10px 14px",borderRadius:10,background:form.color,marginBottom:14}}>
        <div style={{fontSize:T.fs.sm,fontWeight:700,color:getContrast(form.color)}}>{form.name||"미리보기"}</div>
      </div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16}}>
        <span style={{fontSize:T.fs.sm,fontWeight:500}}>사용 중</span>
        <AToggle on={form.useYn!==false} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="태그 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export { AdminPage, UsersPage }
export default ReservationList
