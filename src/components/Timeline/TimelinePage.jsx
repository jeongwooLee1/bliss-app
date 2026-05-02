import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, NAVER_COLS, getNaverVal, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, BRANCH_DEFAULT_COLORS, branchColor, STATUS_CLR_DEFAULT, STATUS_KEYS, SCH_BRANCH_MAP } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, queueAlimtalk } from '../../lib/sb'
import { useMaleRotation, useScheduleData } from '../../lib/useData'
import { DEFAULT_CELL_TAGS } from '../Schedule/scheduleConstants'
import { fromDb, toDb, resolveSystemIds, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, useSessionState, getCustPkgBranchInitial, naverConfirmBooking } from '../../lib/utils'
import I from '../common/I'
import TimelineModal from './ReservationModal'
import QuickBookModal from './QuickBookModal'
import TimelineSettings from './TimelineSettings'
import { MiniCal } from '../../pages/AppShell'
import useTouchDragSort from '../../hooks/useTouchDragSort'

const _mc = (fn) => { if(fn) fn(); };
const uid = genId;

// 블록의 실 소요시간(분) — end_time이 있으면 그 차이를 진실로 본다.
// dur 컬럼이 잘못 저장된 케이스(네이버 스크래퍼 매핑 오류 등)에서도 화면이 정상 길이로 표시되고
// 이동 시에도 길이가 보존됨.
const blockDurMin = (b) => {
  if (!b) return 30;
  const t = b.time;
  const et = b.endTime || b.end_time;
  if (t && et) {
    const [sh, sm] = t.split(":").map(Number);
    const [eh, em] = et.split(":").map(Number);
    const d = (eh*60+em) - (sh*60+sm);
    if (d > 0) return d;
  }
  return b.dur || 30;
};

// 타임라인 컬럼 바탕색 — 전 지점 공통 단일 톤(기본 흰색), 지점 구분은 세로선으로만
const SOFT_BG = '#ffffff';

// 페이지 이동 후 돌아왔을 때 스크롤 위치 복원용 (모듈 레벨 - 컴포넌트 언마운트 후에도 유지)
// 스크롤 위치 저장/복원 — sessionStorage 연동 (새로고침 시에도 유지)
const _scrollLoad = () => {
  try {
    // 새로고침(F5 등)이면 저장된 스크롤 무시 → 현재시각으로 초기화되도록 (유저 피드백)
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (navType === 'reload') { sessionStorage.removeItem('tl_scroll'); return null; }
    const v = sessionStorage.getItem('tl_scroll'); return v ? JSON.parse(v) : null;
  } catch(e) { return null; }
};
const _scrollSave = (obj) => {
  try { sessionStorage.setItem('tl_scroll', JSON.stringify(obj)); } catch(e) {}
};
let _savedScroll = _scrollLoad(); // { top, left, date }
const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={}, ...p }) => {
  const bg = variant==="primary"?T.primary:variant==="danger"?T.danger:variant==="ghost"?"transparent":T.gray100;
  const color = variant==="ghost"?T.primary:variant==="secondary"?T.text:"#fff";
  const border = variant==="ghost"?"1px solid "+T.border:"none";
  const pd = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={disabled?undefined:onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:T.radius.md,padding:pd,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",...style}} {...p}>{children}</button>;
};

// 일정변경 로그 생성 헬퍼 — 날짜/시작시간 변경만 기록 (종료시간만은 제외)
// 반환: 한 줄 string (ex: "[📅 04-21 10:56] 04.20 11:00 → 04.20 11:30") 또는 null
function buildScheduleChangeLog(origDate, origTime, newDate, newTime) {
  if (origDate === newDate && origTime === newTime) return null;
  const now = new Date();
  const ts = `${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const fmtDate = (d) => { if(!d) return ""; const p=d.split("-"); return `${p[1]}.${p[2]}`; };
  const dateChanged = origDate !== newDate;
  const timeChanged = origTime !== newTime;
  let from = "", to = "";
  if (dateChanged && timeChanged) {
    from = `${fmtDate(origDate)} ${origTime||""}`.trim();
    to = `${fmtDate(newDate)} ${newTime||""}`.trim();
  } else if (dateChanged) {
    from = fmtDate(origDate); to = fmtDate(newDate);
  } else {
    from = origTime||""; to = newTime||"";
  }
  return `[📅 ${ts}] ${from} → ${to}`;
}
// schedule_log 컬럼에 새 로그 누적 (최근 것을 위에). memo는 건드리지 않음
function prependScheduleLog(log, existing) {
  if (!log) return existing || "";
  return existing ? `${log}\n${existing}` : log;
}

// ═══════════════════════════════════════════
// 알람 설정 모달
// ═══════════════════════════════════════════
function AlarmModal({ initial, brName, onSave, onDelete, onClose }) {
  const [f, setF] = React.useState(initial);
  const set = (k, v) => setF(p => ({...p, [k]: v}));
  const toggleDay = (d) => {
    const days = f.repeatDays || [];
    set("repeatDays", days.includes(d) ? days.filter(x=>x!==d) : [...days, d].sort());
  };
  const WDS = ["일","월","화","수","목","금","토"];
  React.useEffect(()=>{
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return ()=>window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:20,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{fontSize:16,fontWeight:800,color:T.text}}>🔔 {onDelete?"알람 수정":"알람 생성"}</div>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:T.gray400}}>×</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <label style={{fontSize:12,fontWeight:700,color:T.gray600,width:60}}>지점</label>
          <div style={{fontSize:13,color:T.text,fontWeight:600}}>{brName}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <label style={{fontSize:12,fontWeight:700,color:T.gray600,width:60}}>시간</label>
          <input type="time" value={f.time} onChange={e=>set("time",e.target.value)}
            style={{padding:"6px 10px",fontSize:14,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:T.gray600,marginBottom:4}}>제목</label>
          <input type="text" value={f.title||""} onChange={e=>set("title",e.target.value)} placeholder="예: 마감 체크"
            style={{width:"100%",padding:"8px 12px",fontSize:14,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:T.gray600,marginBottom:4}}>메모 (선택)</label>
          <textarea value={f.note||""} onChange={e=>set("note",e.target.value)} rows={2}
            style={{width:"100%",padding:"8px 12px",fontSize:13,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:T.gray600,marginBottom:6}}>반복</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {[["once","일회성"],["daily","매일"],["weekdays","평일"],["weekly","요일 선택"]].map(([k,lbl])=>(
              <button key={k} onClick={()=>set("repeat",k)}
                style={{padding:"5px 10px",fontSize:12,fontWeight:f.repeat===k?700:500,border:"1.5px solid "+(f.repeat===k?T.primary:T.border),borderRadius:14,background:f.repeat===k?T.primaryLt:"#fff",color:f.repeat===k?T.primaryDk:T.gray600,cursor:"pointer",fontFamily:"inherit"}}>{lbl}</button>
            ))}
          </div>
        </div>
        {f.repeat === "weekly" && (
          <div style={{display:"flex",gap:4,marginLeft:64}}>
            {WDS.map((w,i)=>(
              <button key={i} onClick={()=>toggleDay(i)}
                style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid "+((f.repeatDays||[]).includes(i)?T.primary:T.border),background:(f.repeatDays||[]).includes(i)?T.primary:"#fff",color:(f.repeatDays||[]).includes(i)?"#fff":T.gray600,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>{w}</button>
            ))}
          </div>
        )}
        {f.repeat === "once" && (
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <label style={{fontSize:12,fontWeight:700,color:T.gray600,width:60}}>날짜</label>
            <input type="date" value={f.date||""} onChange={e=>set("date",e.target.value)}
              style={{padding:"6px 10px",fontSize:14,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit"}}/>
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:8,marginTop:20,justifyContent:"flex-end"}}>
        {onDelete && <button onClick={onDelete}
          style={{padding:"8px 14px",fontSize:13,fontWeight:700,border:"1.5px solid "+T.danger+"66",background:"#fff5f5",color:T.danger,borderRadius:6,cursor:"pointer",fontFamily:"inherit",marginRight:"auto"}}>🗑 삭제</button>}
        <button onClick={onClose}
          style={{padding:"8px 14px",fontSize:13,fontWeight:600,border:"1px solid "+T.border,background:"#fff",color:T.gray600,borderRadius:6,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
        <button onClick={()=>{ if(!f.title?.trim()){alert("제목을 입력해주세요");return;} onSave({...f, title:f.title.trim(), note:(f.note||"").trim()}); }}
          style={{padding:"8px 18px",fontSize:13,fontWeight:700,border:"none",background:T.primary,color:"#fff",borderRadius:6,cursor:"pointer",fontFamily:"inherit"}}>저장</button>
      </div>
    </div>
  </div>;
}

// ── Topbar 공지 말풍선 위젯 — 팀채팅 is_announce=true 최신 1개 ──
function TopAnnounceBubble() {
  const [announce, setAnnounce] = useState(null); // {id, user_id, body, created_at}
  const DISMISS_KEY = 'bliss_dismissed_announces';
  const AUTO_MS = 60 * 60 * 1000;
  const getDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); } };
  const addDismissed = (id) => { const s = getDismissed(); s.add(id); try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200))); } catch {} };
  const loadLatest = async () => {
    try {
      const supa = window._sbClient;
      if (!supa) return;
      const since = new Date(Date.now() - AUTO_MS).toISOString();
      const { data: rows } = await supa.from('team_chat_messages')
        .select('id,user_id,body,created_at,is_announce')
        .eq('is_announce', true).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(10);
      const dis = getDismissed();
      const latest = (rows || []).find(r => !dis.has(r.id));
      setAnnounce(latest || null);
    } catch {}
  };
  useEffect(() => {
    loadLatest();
    const supa = window._sbClient;
    if (!supa) return;
    const ch = supa.channel('rt_topbar_announce_' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_chat_messages' },
        (payload) => { if (payload?.new?.is_announce) loadLatest(); })
      .subscribe();
    return () => { try { supa.removeChannel(ch); } catch {} };
  }, []);
  if (!announce) return null;
  const dismiss = (e) => { e?.stopPropagation?.(); addDismissed(announce.id); setAnnounce(null); };
  return (
    <div title={`${announce.user_id} 공지 · ${new Date(announce.created_at).toLocaleString()}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'linear-gradient(135deg,#FFF8E1,#FFECB3)',
        border: '1.5px solid #FFB74D',
        borderRadius: 14,
        padding: '4px 10px 4px 12px',
        fontSize: 12, fontWeight: 700, color: '#E65100',
        position: 'relative',
        animation: 'announcePulse 2.4s ease-in-out infinite',
        boxShadow: '0 1px 4px rgba(230,81,0,.18)',
        flexShrink: 1, minWidth: 0, maxWidth: 380,
        cursor: 'default',
      }}>
      <span style={{flexShrink: 0}}>📣</span>
      <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#5D4037', minWidth: 0}}>
        <b style={{color:'#E65100',marginRight:4}}>{String(announce.user_id || '').slice(0, 6)}:</b>
        {String(announce.body || '').replace(/\s+/g, ' ').slice(0, 80)}
      </span>
      <button onClick={dismiss} aria-label="공지 닫기"
        style={{
          flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
          border: 'none', background: 'rgba(230,81,0,.15)', color: '#E65100',
          fontSize: 12, fontWeight: 900, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
        onMouseOver={e=>{e.currentTarget.style.background='rgba(230,81,0,.3)'}}
        onMouseOut={e=>{e.currentTarget.style.background='rgba(230,81,0,.15)'}}>
        ×
      </button>
    </div>
  );
}

function Timeline({ data, setData, userBranches, viewBranches=[], isMaster, currentUser, setPage, bizId, onMenuClick, bizName, pendingOpenRes, setPendingOpenRes, naverColShow={}, scraperStatus=null, setPendingChat, setPendingOpenCust, unreadMsgCount=0, unreadSample=[], previewBlockStyle=false }) {
  // 타임라인 블록 표시 항목 — App에서 prop으로 받음
  const effectiveNaverColShow = naverColShow;
  const SVC_LIST = (data?.services || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []);
  // 새로고침·재진입 시 항상 오늘 날짜로 복귀 (유저 요청: 타임라인 refresh → today)
  const [selDate, setSelDate] = useState(todayStr());
  const [schHistory, setSchHistory] = useState(null);
  // ── 네이버 막기 상태: { [bizId]: { [date]: { [itemId]: {name, hour_bit(48자)} } } } ──
  const [naverBlockState, setNaverBlockState] = useState({});
  const [blockSlotPopup, setBlockSlotPopup] = useState(null); // {bizId, branchId, date, slotIdx, time, x, y}
  // ── 셀 태그 (쉐어/일출 등) — 직원 컬럼 헤더에 날짜별 배지 표시용 ──
  const { data:cellTagDefsRaw } = useScheduleData('cellTagDefs_v1', null);
  const cellTagDefs = Array.isArray(cellTagDefsRaw) && cellTagDefsRaw.length > 0 ? cellTagDefsRaw : DEFAULT_CELL_TAGS;
  const { data:schTagsHistory } = useScheduleData('schTagsHistory_v1', {});
  const getTagsForEmp = (empId, ds) => {
    if (!ds || !empId) return [];
    const mk = ds.slice(0,7); const dd = ds.slice(8);
    const ids = schTagsHistory?.[mk]?.[empId]?.[dd] || [];
    return ids.map(id => cellTagDefs.find(t => t.id === id)).filter(Boolean);
  };
  // 직원 당일 지점 오버라이드: {empId_date: {segments:[{branchId,from,until}]}}
  const [empBranchOverride, _setEmpBranchOverride] = useState({});
  const empOverrideLoaded = React.useRef(false);
  const setEmpBranchOverride = React.useCallback((updater) => {
    _setEmpBranchOverride(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // DB 저장 (upsert)
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: "POST", headers: H,
        body: JSON.stringify({ id: "empOverride_v1", key: "empOverride_v1", value: JSON.stringify(next) })
      }).catch(console.error);
      return next;
    });
  }, []);
  // 초기 로드
  React.useEffect(() => {
    if (empOverrideLoaded.current) return;
    empOverrideLoaded.current = true;
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empOverride_v1&select=value`, { headers: H })
      .then(r => r.json())
      .then(rows => {
        if (rows?.[0]?.value) {
          const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
          _setEmpBranchOverride(v);
        }
      }).catch(console.error);
  }, []);

  // 직원 근무시간: {empId: {start,end}, empId_date: {start,end}}
  const [empWorkHours, _setEmpWorkHours] = useState({});
  const empWorkHoursLoaded = React.useRef(false);
  React.useEffect(() => {
    if (empWorkHoursLoaded.current) return;
    empWorkHoursLoaded.current = true;
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empWorkHours_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.json()).then(rows => {
      if (rows?.[0]?.value) {
        const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
        _setEmpWorkHours(v);
      }
    }).catch(console.error);
  }, []);
  const setEmpWorkHours = React.useCallback((updater) => {
    _setEmpWorkHours(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: "POST", headers: H,
        body: JSON.stringify({ id: "empWorkHours_v1", key: "empWorkHours_v1", value: JSON.stringify(next) })
      }).catch(console.error);
      return next;
    });
  }, []);

  // ── + 칼럼 템플릿: 매일 반복되는 내부일정 ──
  const [colTemplates, setColTemplates] = useState({}); // {branchId: [{id, name, tagIds, time, dur}, ...]}
  const colTplLoaded = useRef(false);
  useEffect(() => {
    if (colTplLoaded.current) return;
    colTplLoaded.current = true;
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.colTemplates_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.json()).then(rows => {
      if (rows?.[0]?.value) {
        const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
        setColTemplates(v && typeof v === "object" ? v : {});
      }
    }).catch(console.error);
  }, []);
  const saveColTemplates = useCallback((next) => {
    setColTemplates(next);
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "colTemplates_v1", key: "colTemplates_v1", value: JSON.stringify(next) })
    }).catch(console.error);
  }, []);

  // 직원 목록: employees_v1 (schedule_data 테이블)에서 동적 로드 + Realtime + 폴링
  const [empList, setEmpList] = useState([]);
  const [empSettings, setEmpSettings] = useState({});
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const parseEmps = (empVal) => {
      const base = typeof empVal === 'string' ? JSON.parse(empVal) : (Array.isArray(empVal) ? empVal : []);
      return base;
    };
    const parseSettings = (val) => {
      if (!val) return {};
      const v = typeof val === 'string' ? JSON.parse(val) : val;
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    };
    // employees_v1 + empSettings_v1 동시 로드 (customEmployees_v1 폐기됨, 2026-05-01)
    Promise.all([
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empSettings_v1&select=value`, { headers: H }).then(r => r.json()),
    ]).then(([empRows, setRows]) => {
      setEmpList(parseEmps(empRows?.[0]?.value || []));
      setEmpSettings(parseSettings(setRows?.[0]?.value));
    }).catch(() => {});
    // Realtime 구독 (employees_v1 + empSettings_v1)
    let empCh = null;
    let empLastRt = 0;
    const reload = () => {
      Promise.all([
        fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }).then(r => r.json()),
        fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empSettings_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }).then(r => r.json()),
      ]).then(([empRows, setRows]) => {
        empLastRt = Date.now();
        setEmpList(parseEmps(empRows?.[0]?.value || []));
        setEmpSettings(parseSettings(setRows?.[0]?.value));
      }).catch(() => {});
    };
    if (window._sbClient) {
      empCh = window._sbClient.channel("employees_all_rt")
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.employees_v1" }, reload)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.employees_v1" }, reload)
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.empSettings_v1" }, reload)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.empSettings_v1" }, reload)
        .subscribe();
    }
    return () => {
      try { empCh?.unsubscribe(); } catch(e) {}
    };
  }, []);

  // 남자직원 로테이션
  const { maleRotation, getRotationBranch } = useMaleRotation();

  // employees_v1의 branch("gangnam")를 실제 branch_id("br_4bcauqvrb")로 매핑
  // 남자직원은 오늘의 로테이션 지점으로 동적 배치
  // empSettings.excludeFromSchedule=true 직원은 타임라인 칼럼에서 제외 (근무표 제외와 동일)
  const BASE_EMP_LIST = React.useMemo(() => {
    return empList
      .filter(e => !empSettings[e.id]?.excludeFromSchedule)
      .map(e => {
        if (e.isMale) {
          const rotBranch = getRotationBranch(e.id, selDate);
          if (rotBranch && SCH_BRANCH_MAP[rotBranch]) {
            return { id: e.id, branch_id: SCH_BRANCH_MAP[rotBranch] };
          }
        }
        return { id: e.id, branch_id: SCH_BRANCH_MAP[e.branch] || e.branch };
      });
  }, [empList, empSettings, maleRotation, selDate]);

  // schHistory 파싱 함수
  const parseSchHistory = (rawVal) => {
    const val = typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal;
    const merged = {};
    if (!val || typeof val !== "object") return merged;
    Object.values(val).forEach(monthData => {
      if (typeof monthData !== "object") return;
      Object.entries(monthData).forEach(([emp, days]) => {
        if (emp.startsWith("__")) return;
        if (!merged[emp]) merged[emp] = {};
        Object.assign(merged[emp], days);
      });
    });
    return merged;
  };

  // 내일 날짜 스냅샷 (10시 이후 lock용)
  const [frozenTomorrow, setFrozenTomorrow] = useState(null); // {empId:{date:status}} - 내일 데이터 고정본

  // 10시 이후 내일 날짜가 lock되는지 체크
  const isTomorrowLocked = () => new Date().getHours() >= 22;
  const getTomorrowStr = () => {
    const d = new Date(); d.setDate(d.getDate()+1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  // schHistory에서 내일 데이터만 추출
  const extractTomorrowData = (sch) => {
    const tom = getTomorrowStr();
    const snap = {};
    Object.entries(sch).forEach(([emp, days]) => {
      if (days[tom] !== undefined) { if (!snap[emp]) snap[emp] = {}; snap[emp][tom] = days[tom]; }
    });
    return snap;
  };

  // Realtime 업데이트 시 lock 날짜 보존하며 merge
  const mergeWithLock = (newSch) => {
    if (!isTomorrowLocked() || !frozenTomorrow) return newSch;
    const tom = getTomorrowStr();
    const merged = { ...newSch };
    // 내일 날짜는 frozenTomorrow 값으로 복원
    Object.entries(frozenTomorrow).forEach(([emp, days]) => {
      if (!merged[emp]) merged[emp] = {};
      if (days[tom] !== undefined) merged[emp][tom] = days[tom];
    });
    return merged;
  };

  // schHistory_v1 초기 로드 + Realtime 구독
  const SB_URL_SCH = "https://dpftlrsuqxqqeouwbfjd.supabase.co";
  const SB_KEY_SCH = "sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj";

  useEffect(() => {
    const H = { apikey: SB_KEY_SCH, Authorization: "Bearer " + SB_KEY_SCH };

    fetch(`${SB_URL_SCH}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, { headers: H })
      .then(r=>r.json()).then(rows=>{
        if (!rows?.length) return;
        const parsed = parseSchHistory(rows[0].value);
        setSchHistory(parsed);
        // 10시 이후 로드 시 내일 데이터 바로 고정
        if (isTomorrowLocked()) setFrozenTomorrow(extractTomorrowData(parsed));
      }).catch(()=>{});

    // 매 시간 체크 - 10시 되는 순간 frozenTomorrow 설정
    const timer = setInterval(() => {
      if (isTomorrowLocked()) {
        setSchHistory(prev => {
          if (prev && !frozenTomorrow) setFrozenTomorrow(extractTomorrowData(prev));
          return prev;
        });
      }
    }, 60000); // 1분마다 체크

    // Realtime 구독 (INSERT/UPDATE 모두 감지) + 폴링 fallback
    let channel = null;
    let pollTimer = null;
    let lastRtUpdate = 0;
    const onSchChange = (payload) => {
      if (payload?.new?.value) {
        lastRtUpdate = Date.now();
        const newSch = parseSchHistory(payload.new.value);
        setSchHistory(p => mergeWithLock(newSch));
      }
    };
    if (window._sbClient) {
      channel = window._sbClient.channel("schedule_data_rt")
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.schHistory_v1" }, onSchChange)
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.schHistory_v1" }, onSchChange)
        .subscribe();
    }
    // 폴링 fallback (30초마다 - Realtime 불안정 시)
    pollTimer = setInterval(() => {
      if (Date.now() - lastRtUpdate < 25000) return; // Realtime 작동 중이면 스킵
      fetch(`${SB_URL_SCH}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, { headers: H })
        .then(r=>r.json()).then(rows=>{
          if (!rows?.length) return;
          const newSch = parseSchHistory(rows[0].value);
          setSchHistory(p => mergeWithLock(newSch));
        }).catch(()=>{});
    }, 30000);

    return () => {
      clearInterval(timer);
      clearInterval(pollTimer);
      try { channel?.unsubscribe(); } catch(e) {}
    };
  }, []);

  // ── 네이버 막기 상태 자동 로드 ──
  // 권한 있는 지점만, 선택 날짜만 fetch.
  // 첫 로드 + 날짜 변경 시 즉시 호출 + 10분 주기 폴링.
  // 안전장치: tab hidden 시 스킵 / 401·403 발생 시 폴링 중단(세션 만료).
  const naverBlockFailRef = React.useRef(false);
  const fetchNaverBlockStateRef = React.useRef(null);
  useEffect(() => {
    if (!selDate) return;
    // 권한 있는 지점만
    const allowedBids = new Set(accessibleBids);
    const targets = (data?.branches || []).filter(b => b.naverBizId && allowedBids.has(b.id));
    if (!targets.length) return;

    let cancel = false;
    const runFetch = async () => {
      if (cancel) return;
      // 안전장치 1: tab hidden이면 스킵
      if (typeof document !== 'undefined' && document.hidden) return;
      // 안전장치 4: 이전에 401/403 등 실패 → 세션 만료 의심, 폴링 중단
      if (naverBlockFailRef.current) return;
      const results = await Promise.all(targets.map(async (br) => {
        try {
          const r = await fetch(`https://blissme.ai/naver-block-state?biz_id=${encodeURIComponent(br.naverBizId)}&date=${encodeURIComponent(selDate)}`, { cache: 'no-store' });
          if (r.status === 401 || r.status === 403) {
            naverBlockFailRef.current = true;
            console.warn('[naver-block-state] 세션 만료 추정 → 폴링 중단 (status='+r.status+')');
            return null;
          }
          if (!r.ok) return null;
          const j = await r.json();
          return j.ok ? { bizId: br.naverBizId, items: j.items || {} } : null;
        } catch { return null; }
      }));
      if (cancel) return;
      setNaverBlockState(prev => {
        const next = { ...prev };
        results.forEach(r => {
          if (!r) return;
          if (!next[r.bizId]) next[r.bizId] = {};
          next[r.bizId][selDate] = r.items;
        });
        return next;
      });
    };
    fetchNaverBlockStateRef.current = runFetch;
    // 첫 로드 1회만 (자동 폴링·visibility refetch 비활성 — 막기 팝업 열 때 강제 refetch는 그대로)
    runFetch();
    return () => { cancel = true; };
  }, [selDate, data?.branches]);

  // AI 키 로드 (DB에서)
  useEffect(()=>{
    fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",{headers:sbHeaders})
      .then(r=>r.json())
      .then(d=>{
        try {
          const cfg = JSON.parse(d[0]?.settings||"{}");
          if(cfg.gemini_key) window.__geminiKey = cfg.gemini_key;
        } catch(e){}
      }).catch(()=>{});
  }, []);
  useEffect(() => {
    const load = () => fetch(SB_URL+"/rest/v1/messages?select=id,is_read,direction&limit=500&order=created_at.desc",
        {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY}})
      .then(r=>r.json())
      .then(arr=>{ if(Array.isArray(arr)) setUnreadMsgCount(arr.filter(m=>m.direction==="in"&&!m.is_read).length); })
      .catch(()=>{});
    load();
    const t = setInterval(load, 10000);
    return ()=>clearInterval(t);
  }, []);

  // 선택 날짜의 지점별 출근자 계산
  // 직원 override 헬퍼: 해당 날짜에 어느 지점에 있는지
  const getEmpOverride = (empId, date) => {
    const overrideKey = empId + "_" + date;
    const ov = empBranchOverride[overrideKey];
    if (!ov) return null;
    if (typeof ov === "string") return { segments: [{branchId: ov, from: null, until: null}], exclusive: false };
    return { segments: ov.segments || [], exclusive: !!ov.exclusive };
  };
  const getEmpBranches = (empId, date) => {
    const ov = getEmpOverride(empId, date);
    return ov ? ov.segments : null;
  };

  // 직원 오늘 기본 근무시간 (일별 > 지점 기본)
  const getEmpBaseHours = (empId, date, baseBranchId) => {
    const bts = (data?.branches||[]).find(b=>b.id===baseBranchId)?.timelineSettings;
    const branchHours = bts?.defaultWorkStart ? {start:bts.defaultWorkStart, end:bts.defaultWorkEnd||"21:00"}
      : bts?.openTime ? {start:bts.openTime, end:bts.closeTime||"21:00"} : {start:"11:00",end:"21:00"};
    return empWorkHours[empId+"_"+baseBranchId+"_"+date] || empWorkHours[empId+"_"+baseBranchId]
      || empWorkHours[empId+"_"+date] || empWorkHours[empId] || branchHours;
  };

  // 세그먼트 정규화: from/until 빈 값 자동 채움 (이전 seg의 until = 다음 seg의 from)
  const normalizeSegments = (empId, date, segments) => {
    if (!segments || !segments.length) return [];
    const emp = BASE_EMP_LIST.find(e=>e.id===empId);
    const baseBid = emp?.branch_id;
    const baseHours = getEmpBaseHours(empId, date, baseBid);
    // 각 segment의 지점별 근무시간 (없으면 base)
    const segHoursOf = (bid) => {
      const bts = (data?.branches||[]).find(b=>b.id===bid)?.timelineSettings;
      const branchDefault = bts?.defaultWorkStart ? {start:bts.defaultWorkStart, end:bts.defaultWorkEnd||"21:00"}
        : bts?.openTime ? {start:bts.openTime, end:bts.closeTime||"21:00"} : baseHours;
      return empWorkHours[empId+"_"+bid+"_"+date] || empWorkHours[empId+"_"+bid] || branchDefault;
    };
    // from 기준 정렬 (빈 값은 해당 지점 근무 시작으로 간주)
    const sorted = [...segments].sort((a,b) => (a.from||segHoursOf(a.branchId).start).localeCompare(b.from||segHoursOf(b.branchId).start));
    return sorted.map((s, i) => {
      const wh = segHoursOf(s.branchId);
      const from = s.from || (i === 0 ? wh.start : sorted[i-1].until || wh.start);
      const nextFrom = sorted[i+1]?.from;
      let until = s.until || nextFrom || wh.end;
      // 역전 방어: 저장된 empWorkHours.end 가 from 보다 이전 (예: 잘못 찍힌 30분 근무)
      // → baseHours.end 시도 → 여전히 이전이면 "21:00"으로 fallback
      if (from && until && until <= from) {
        if (baseHours?.end && baseHours.end > from) until = baseHours.end;
        else until = "21:00";
      }
      return {...s, from, until};
    });
  };

  // 세그먼트가 원래 소속지점의 기본 근무시간 전체를 커버하는지
  const isBaseBranchCovered = (empId, date) => {
    const ov = getEmpOverride(empId, date);
    if (!ov || !ov.segments.length) return false;
    const emp = BASE_EMP_LIST.find(e=>e.id===empId);
    const baseBid = emp?.branch_id;
    // ★ 종일 이동(from/until 모두 null) segment가 base가 아닌 지점에 있으면 home 전체 cover로 간주
    // (segment의 normalize 시 wh가 그 지점 운영시간 기준이라 home 잔업시간과 안 맞을 수 있음 — 방어)
    const hasFullDayMove = ov.segments.some(s =>
      s.branchId !== baseBid && (s.from == null || s.from === '') && (s.until == null || s.until === '')
    );
    if (hasFullDayMove) return true;
    const baseHours = getEmpBaseHours(empId, date, baseBid);
    const segs = normalizeSegments(empId, date, ov.segments);
    // segs 중 baseBid에 해당하는 건 제외하고 나머지가 baseHours를 전부 커버?
    const other = segs.filter(s => s.branchId !== baseBid);
    if (!other.length) return false;
    // 시간대 정렬 후 빈틈 체크
    const sorted = [...other].sort((a,b)=>a.from.localeCompare(b.from));
    let cursor = baseHours.start;
    for (const s of sorted) {
      if (s.from > cursor) return false; // 빈 구간 존재 → 원래 지점에 잔여 근무
      if (s.until > cursor) cursor = s.until;
    }
    return cursor >= baseHours.end;
  };

  // 직원이 특정 지점에 있는지 (오버라이드 기준)
  const empInBranch = (empId, date, branchId) => {
    const ov = getEmpOverride(empId, date);
    if (!ov) {
      const emp = BASE_EMP_LIST.find(e => e.id === empId);
      return emp && emp.branch_id === branchId;
    }
    // exclusive(이동) 또는 자동 판정: segments가 기본 근무시간 전체 커버 → 원래 지점 제거
    const emp = BASE_EMP_LIST.find(e => e.id === empId);
    if (ov.exclusive || isBaseBranchCovered(empId, date)) {
      return ov.segments.some(s => s.branchId === branchId);
    }
    // 지원: segments에 있거나 원래 지점이면 표시
    const inSegs = ov.segments.some(s => s.branchId === branchId);
    if (inSegs) return true;
    return emp && emp.branch_id === branchId;
  };

  // "지원(강남)" → 강남 branch_id로 매핑하는 헬퍼
  const branchNameToId = React.useMemo(() => {
    const map = {};
    (data?.branches || []).forEach(b => {
      if (b.short) map[b.short] = b.id;                          // "강남점"
      if (b.name) map[b.name] = b.id;
      // "강남점" → "강남", "왕십리점" → "왕십리" 매칭
      if (b.short && b.short.endsWith("점")) map[b.short.slice(0, -1)] = b.id;
      if (b.name && b.name.endsWith("점")) map[b.name.slice(0, -1)] = b.id;
      // "브랜드명 강남본점" → "강남본점", "강남본" 매칭 (브랜드명 prefix 동적 제거)
      if (b.name && bizName && b.name.startsWith(bizName + " ")) {
        const n = b.name.replace(bizName + " ", "");
        map[n] = b.id;
        if (n.endsWith("점")) map[n.slice(0, -1)] = b.id;
      }
      // "강남본점" → "강남" (본점 제거)
      if (b.short) {
        const base = b.short.replace(/본?점$/, "");
        if (base) map[base] = b.id;
      }
    });
    return map;
  }, [data?.branches]);

  const parseSupportBranch = (status) => {
    if (!status || !status.startsWith("지원(")) return null;
    const match = status.match(/^지원\((.+)\)$/);
    if (!match) return null;
    return branchNameToId[match[1]] || null;
  };

  // branchId → 근무표 지점명 역변환 (타임라인→근무표 동기화용)
  const branchIdToSchName = React.useMemo(() => {
    const map = {};
    // SCH_BRANCH_MAP: gangnam→br_4bcauqvrb, BRANCHES_SCH 대신 data.branches 사용
    Object.entries(SCH_BRANCH_MAP).forEach(([key, bid]) => {
      const br = (data?.branches || []).find(b => b.id === bid);
      if (br) {
        const name = (br.short || br.name || "").replace(/본?점$/, "");
        if (name) map[bid] = name;
      }
    });
    return map;
  }, [data?.branches]);

  // 타임라인 override 변경 → schHistory_v1 DB 동기화
  const syncOverrideToSch = (empId, date, overrideData) => {
    const monthKey = date.slice(0, 7);
    let newStatus = "근무";
    if (overrideData && overrideData.segments?.length) {
      const emp = BASE_EMP_LIST.find(e => e.id === empId);
      const baseBid = emp?.branch_id;
      const targetSeg = overrideData.segments.find(s => s.branchId !== baseBid)
                     || overrideData.segments[overrideData.segments.length - 1];
      const brName = branchIdToSchName[targetSeg?.branchId];
      if (brName) newStatus = `지원(${brName})`;
    }
    // schHistory_v1 raw fetch → patch → upsert
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } })
      .then(r => r.json())
      .then(rows => {
        const raw = rows?.[0]?.value ? (typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value) : {};
        if (!raw[monthKey]) raw[monthKey] = {};
        if (!raw[monthKey][empId]) raw[monthKey][empId] = {};
        raw[monthKey][empId][date] = newStatus;
        return fetch(`${SB_URL}/rest/v1/schedule_data`, {
          method: "POST", headers: H,
          body: JSON.stringify({ id: "schHistory_v1", key: "schHistory_v1", value: JSON.stringify(raw), updated_at: new Date().toISOString() })
        });
      }).catch(console.error);
  };

  const schHistoryLoaded = React.useRef(false);
  const getWorkingStaff = (branchId, date) => {
    if (!schHistory) {
      if (schHistoryLoaded.current) {
        // 근무표 로드 완료인데 비어있음 → 원래 소속 직원만
        const branchEmps = BASE_EMP_LIST.filter(e => empInBranch(e.id, date, branchId));
        return branchEmps.length > 0 ? branchEmps : null;
      }
      return null; // 아직 로딩 중 → 컬럼 안 보여줌
    }
    schHistoryLoaded.current = true;

    // 근무표 미작성 날짜 fallback: 전 직원 중 아무도 dayStatus/오버라이드 없으면
    // → 지점 배정 인원 전체를 빈 칼럼으로 표시 (선예약·네이버 자동 예약 대비)
    // 오버라이드(이동/지원)가 있는 날짜는 fallback 타지 않고 정상 경로로 진입해야 오버라이드가 반영됨
    const branchBaseEmps = BASE_EMP_LIST.filter(e => e.branch_id === branchId);
    const scheduleExistsForDate = BASE_EMP_LIST.some(e => {
      const s = schHistory[e.id]?.[date];
      if (s && s !== "") return true;
      const ov = getEmpOverride(e.id, date);
      return !!(ov && ov.segments?.length);
    });
    if (!scheduleExistsForDate && branchBaseEmps.length > 0) {
      return branchBaseEmps;
    }

    // 해당 (직원, 지점, 날짜)에 예약/메모/내부일정이 있는지 확인
    const hasContent = (empId) => (data?.reservations||[]).some(r => {
      if (r.date !== date) return false;
      if (r.bid !== branchId) return false;
      if (r.staffId !== empId) return false;
      // 변경건(naver_changed)은 제외, 취소는 포함 (컬럼 유지 근거)
      if (r.status === "naver_changed") return false;
      return true;
    });

    // 모든 직원 중 이 지점에 해당하는 직원 찾기
    const working = [];
    BASE_EMP_LIST.forEach(e => {
      const dayStatus = schHistory[e.id]?.[date];
      // 근무표에 아예 등록 안 된 직원은 타임라인에서 제외 (단, 이동/지원 오버라이드 있으면 포함)
      const ovPre = getEmpOverride(e.id, date);
      if (!dayStatus && !(ovPre && ovPre.segments?.length)) return;
      if (dayStatus === "휴무" || dayStatus === "휴무(꼭)" || dayStatus === "무급") return;

      // empOverride 세그먼트 우선 (여러 지점 시간대별 이동/지원)
      const ov = getEmpOverride(e.id, date);
      if (ov && ov.segments?.length) {
        // 세그먼트 정규화 후 실제 근무 구간이 있는지 확인 (0분 세그먼트는 무시)
        const normalized = normalizeSegments(e.id, date, ov.segments);
        const mySeg = normalized.find(s => s.branchId === branchId);
        const hasActiveSeg = mySeg && mySeg.from !== mySeg.until;
        if (hasActiveSeg) {
          working.push(e);
        }
        // 원래 지점 처리: 세그먼트에 원래 지점이 없는 경우
        const emp = BASE_EMP_LIST.find(b => b.id === e.id);
        if (emp && emp.branch_id === branchId && !working.some(w => w.id === e.id)) {
          const exclusive = ov.exclusive === true;
          if (exclusive) {
            // 전체 이동: 컬럼 제거 (예약은 아래 재배치 로직에서 자동으로 미배정 컬럼으로 이동)
          } else {
            // 지원(부분 이동): 원래 지점에 남은 근무 구간 있으면 활성 칼럼으로 표시
            const range = getEmpActiveRange(e.id, date, branchId);
            const hasActiveRange = range && (range.from || range.until) && range.from !== range.until;
            if (hasActiveRange) {
              working.push({...e, _movedOut: false});
            }
            // 남은 구간 없으면 컬럼 제거 — 예약은 미배정으로
          }
        }
        return;
      }

      // "지원(강남)" → 해당 지점에 표시
      const supportBid = parseSupportBranch(dayStatus);
      if (supportBid === branchId) {
        working.push(e);
        return;
      }

      // 타지점으로 지원 중: 컬럼 제거 (예약은 미배정으로 자동 재배치)
      if (supportBid) {
        return;
      }

      // 원래 소속 지점이면 표시
      // 자동이동(추측 기반) 로직 제거 — user 의도는 명시적 이동(지원(X) / empOverride exclusive)만 처리
      // 단순히 다른 지점에 예약/메모 1건 있다고 home 칼럼 자동 제거하지 않음
      if (empInBranch(e.id, date, branchId)) {
        working.push(e);
      }
    });

    // 부분 미작성 병합: 이 지점 base emp 중 dayStatus도 오버라이드도 없는 직원은 빈 칼럼으로 표시
    // (오버라이드 있는 날 fallback이 스킵되면서 나머지 base emp가 사라지던 문제 보완)
    // ★ 프리랜서/일회성 직원(isFreelancer=true)은 제외 — 명시적 schHistory entry 있을 때만 표시
    branchBaseEmps.forEach(e => {
      if (e.isFreelancer) return; // 프리랜서는 그 날짜 schHistory entry 있을 때만
      const empInfo = empList.find(x => x.id === e.id);
      if (empInfo?.isFreelancer) return; // employees_v1 lookup도 체크
      const s = schHistory[e.id]?.[date];
      const ov = getEmpOverride(e.id, date);
      const hasSchedule = (s && s !== "") || (ov && ov.segments?.length);
      if (!hasSchedule && !working.some(w => w.id === e.id)) {
        working.push(e);
      }
    });

    return working; // 빈 배열도 반환 (전원 휴무 시 rooms fallback 방지)
  };

  // 직원이 특정 지점에서 활성인 시간 구간들 반환 (복수 세그먼트 지원)
  // 반환: [{from, until}, ...] — 없으면 null, 종일은 [{from:null, until:null}] 또는 빈 배열 가능
  const getEmpActiveSegments = (empId, date, branchId) => {
    const segs = getEmpBranches(empId, date);
    const emp = BASE_EMP_LIST.find(e=>e.id===empId);
    const baseBid = emp?.branch_id;
    const branchTs = (data?.branches||[]).find(b=>b.id===branchId)?.timelineSettings;
    const branchHours = branchTs?.defaultWorkStart ? {start:branchTs.defaultWorkStart, end:branchTs.defaultWorkEnd||"21:00"}
      : branchTs?.openTime ? {start:branchTs.openTime, end:branchTs.closeTime||"21:00"} : null;
    const empWh = empWorkHours[empId+"_"+branchId+"_"+date] || empWorkHours[empId+"_"+branchId] || empWorkHours[empId+"_"+date] || empWorkHours[empId];
    // 직원 근무시간 × 해당 지점 운영시간 교집합 (다른 지점에 컬럼 생긴 경우 그 지점 시간 우선)
    let wh = empWh || branchHours;
    if (empWh && branchHours && branchId !== baseBid) {
      // 비-base 지점: 지점 운영시간으로 클립 (예: 다해 base=위례 06~21 → 잠실 컬럼은 11~21)
      const start = empWh.start > branchHours.start ? empWh.start : branchHours.start;
      const end   = empWh.end   < branchHours.end   ? empWh.end   : branchHours.end;
      if (start < end) wh = { start, end };
      else wh = branchHours; // 교집합 비면 지점 운영시간 사용
    }

    if (!segs || !segs.length) return wh ? [{from: wh.start, until: wh.end}] : [{from: null, until: null}];

    const normalized = normalizeSegments(empId, date, segs);
    const mine = normalized
      .filter(s => s.branchId === branchId && s.from !== s.until)
      .map(s => ({from: s.from, until: s.until}))
      .sort((a,b)=>(a.from||"").localeCompare(b.from||""));

    // 원래 소속 지점: base 근무시간에서 타 지점 segments를 제외한 전체 구간을 활성으로 반환
    // (mine이 있든 없든, "타지점 안 가 있는 시간"이 전부 원래 지점 근무)
    if (branchId === baseBid && !isBaseBranchCovered(empId, date)) {
      const baseHours = getEmpBaseHours(empId, date, baseBid);
      const others = normalized
        .filter(s => s.branchId !== baseBid && s.from !== s.until)
        .sort((a,b) => a.from.localeCompare(b.from));
      const free = [];
      let cursor = baseHours.start;
      for (const o of others) {
        if (o.from > cursor) free.push({from: cursor, until: o.from});
        if (o.until > cursor) cursor = o.until;
      }
      if (cursor < baseHours.end) free.push({from: cursor, until: baseHours.end});
      if (free.length > 0) return free;
    }

    if (mine.length > 0) return mine;
    return null;
  };

  // 하위 호환 — 첫 세그먼트만 반환 (hasActiveRange 체크 등 단일 range 소비처용)
  const getEmpActiveRange = (empId, date, branchId) => {
    const segs = getEmpActiveSegments(empId, date, branchId);
    if (!segs || segs.length === 0) return null;
    return segs[0];
  };
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  // 🔴 빨강 테두리 깜빡임 하이라이트 (메시지함 예약버튼/확정대기 배너 클릭 시)
  const [highlightedBlockId, setHighlightedBlockId] = useState(null);

  // ReservationList에서 넘어온 예약 자동 오픈 + 스크롤 중앙 정렬
  useEffect(()=>{
    if (!pendingOpenRes) return;

    // 1. 날짜 이동
    setSelDate(pendingOpenRes.date || todayStr());

    const timer = setTimeout(()=>{
      try {
        const sr = scrollRef.current;
        if (sr) {
          // 2. 세로 스크롤 - 예약 시간 위치 중앙 (실제 설정값 사용)
          const timeStr = pendingOpenRes.time || "10:00";
          const yPos = timeToY(timeStr);
          const srH = sr.clientHeight;
          sr.scrollTop = Math.max(0, yPos - srH / 3);

          // 3. 가로 스크롤 - 해당 지점 컬럼 중앙
          const rid = pendingOpenRes.reservationId || pendingOpenRes.id;
          const el = rid ? sr.querySelector(`[data-rid="${rid}"]`) : null;
          if (el) {
            const elRect = el.getBoundingClientRect();
            const srRect = sr.getBoundingClientRect();
            const elLeft = elRect.left - srRect.left + sr.scrollLeft;
            const elW = elRect.width || 160;
            sr.scrollLeft = Math.max(0, elLeft - sr.clientWidth / 2 + elW / 2);
          } else {
            // rid로 못 찾으면 bid 기준으로 컬럼 인덱스 계산
            const bid = pendingOpenRes.bid;
            if (bid) {
              const tlW = window.innerWidth <= 768 ? 52 : 88;
              const colEls = sr.querySelectorAll(".tl-room-col");
              let colLeft = tlW;
              for (const col of colEls) {
                const brId = col.getAttribute("data-branch-id");
                if (brId === bid) {
                  const colW = col.offsetWidth || 160;
                  sr.scrollLeft = Math.max(0, colLeft - sr.clientWidth / 2 + colW / 2);
                  break;
                }
                colLeft += col.offsetWidth || 160;
              }
            }
          }
        }
      } catch(e) { console.warn("scroll err:", e); }

      // 4. 모달 오픈 (DB에서 fresh 데이터 fetch) — 단, _highlightOnly=true면 모달 안 열고 빨강 테두리만
      if (pendingOpenRes._highlightOnly) {
        const rid = pendingOpenRes.reservationId || pendingOpenRes.id;
        if (rid) setHighlightedBlockId(rid);
        setPendingOpenRes && setPendingOpenRes(null);
      } else {
        const openWithFresh = async () => {
          let freshData = pendingOpenRes;
          try {
            const resId = pendingOpenRes.id;
            if (resId) {
              const rows = await sb.get("reservations", resId);
              if (rows && rows.id) {
                const parsed = fromDb("reservations", [rows])[0];
                freshData = {...pendingOpenRes, ...parsed};
                setData(prev => prev ? {...prev, reservations: (prev.reservations||[]).map(r => r.id === parsed.id ? {...r, ...parsed} : r)} : prev);
              }
            }
          } catch(e) { console.warn("fresh fetch err:", e); }
          setModalData({...freshData, readOnly: false});
          setShowModal(true);
          setPendingOpenRes && setPendingOpenRes(null);
        };
        openWithFresh();
      }
    }, 120);
    return ()=>clearTimeout(timer);
  },[pendingOpenRes]);
  // ── RT 보류 큐 flush: 모달 닫힐 때 일괄 적용 ──
  React.useEffect(() => {
    isModalOpenRef.current = showModal;
    if (!showModal && pendingRTQueueRef.current.length > 0) {
      const queue = pendingRTQueueRef.current;
      pendingRTQueueRef.current = [];
      setRtPendingCount(0);
      setData(prev => {
        if (!prev) return prev;
        let reservations = [...(prev.reservations || [])];
        for (const item of queue) {
          if (item.ev === "UPDATE") {
            reservations = reservations.map(r => r.id === item.data.id ? {...r, ...item.data} : r);
          } else if (item.ev === "INSERT") {
            if (!reservations.some(r => r.id === item.data.id)) reservations = [...reservations, item.data];
          } else if (item.ev === "DELETE") {
            reservations = reservations.filter(r => r.id !== item.data.id);
          }
        }
        return {...prev, reservations};
      });
    }
  }, [showModal]);

  const [showQuickBook, setShowQuickBook] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const scrollRef = useRef(null);
  const topbarRef = useRef(null);
  const pendingClickIdx = useRef(0);
  const didRestoreScrollRef = useRef(false);
  // ── 모달 열린 동안 RT 업데이트 보류 ──
  const isModalOpenRef = useRef(false);
  const pendingRTQueueRef = useRef([]);
  const [rtPendingCount, setRtPendingCount] = React.useState(0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [topbarH, setTopbarH] = useState(80);

  // Branch view: 편집가능(userBranches) + 열람가능(viewBranches)
  const allBranchList = [...(data.branchSettings || data.branches || [])].filter(b => b.useYn !== false).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const accessibleBids = [...new Set([...userBranches, ...(viewBranches||[])])];
  // 기본: 본인 지점(쓰기권한)만 표시, isMaster는 전지점
  const defaultViewBids = isMaster ? allBranchList.map(b=>b.id) : (userBranches.length > 0 ? userBranches : accessibleBids);
  // localStorage에서 저장된 viewBids 복원
  const VIEW_BIDS_KEY = "bliss_timeline_viewBids_v1";
  const [viewBids, setViewBidsRaw] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_BIDS_KEY) || "null");
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return defaultViewBids;
  });
  const setViewBids = React.useCallback((v) => {
    setViewBidsRaw(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      try { localStorage.setItem(VIEW_BIDS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const [expanded, setExpanded] = useState(isMaster);

  // userBranches 변경 시 viewBids 동기화 — 단, 저장된 값이 유효하면 존중
  useEffect(() => {
    const savedRaw = (()=>{ try { return JSON.parse(localStorage.getItem(VIEW_BIDS_KEY) || "null"); } catch { return null; } })();
    const hasValidSaved = Array.isArray(savedRaw) && savedRaw.length > 0
      && savedRaw.every(id => isMaster || accessibleBids.includes(id));
    if (hasValidSaved) return; // 저장된 유저 선택 유지
    if (isMaster) {
      setViewBids(allBranchList.map(b=>b.id));
    } else if (userBranches.length > 0) {
      setExpanded(false);
      setViewBids(userBranches);
    }
  }, [userBranches.join(",")]);

  // Sync viewBids when branches change (e.g. added/removed in admin) — 기존 선택 유지하며 새 지점만 추가
  useEffect(() => {
    const newIds = allBranchList.map(b=>b.id);
    setViewBids(prev => {
      const filtered = prev.filter(id => newIds.includes(id));
      return filtered.length !== prev.length ? filtered : prev;
    });
  }, [allBranchList.length]);

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if(next) {
      setViewBids(accessibleBids);
    } else {
      setViewBids(userBranches.length > 0 ? userBranches : accessibleBids);
    }
  };

  const toggleView = (bid) => setViewBids(prev => (prev||[]).includes(bid) ? (prev||[]).filter(x=>x!==bid) : [...(prev||[]), bid]);
  const canEdit = (bid) => isMaster || userBranches.includes(bid);

  // ── 타임라인에 표시되는 예약의 고객 최신 정보 보강 (data.customers는 100건만 로드) ──
  const [custInfoMap, setCustInfoMap] = useState({});  // {custId: {name, phone, gender}}
  useEffect(() => {
    const todayCustIds = [...new Set((data?.reservations||[]).filter(r => r.date === selDate && r.custId && !r.isSchedule).map(r => r.custId))];
    const loaded = new Set((data?.customers||[]).map(c => c.id));
    const missing = todayCustIds.filter(id => !loaded.has(id) && !custInfoMap[id]);
    if (missing.length === 0) return;
    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < missing.length; i += batchSize) batches.push(missing.slice(i, i + batchSize));
    Promise.all(batches.map(batch =>
      fetch(`${SB_URL}/rest/v1/customers?id=in.(${batch.join(",")})&select=id,name,phone,gender,cust_num`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      }).then(r => r.json()).catch(() => [])
    )).then(results => {
      const next = {};
      results.flat().forEach(c => { if (c?.id) next[c.id] = { name: c.name, phone: c.phone, gender: c.gender, custNum: c.cust_num }; });
      if (Object.keys(next).length) setCustInfoMap(prev => ({...prev, ...next}));
    });
  }, [selDate, data?.reservations?.length, data?.customers?.length]);

  // ── 고객 보유 패키지 로드 (현재 날짜 예약 기준) ──
  const [custPkgMap, setCustPkgMap] = useState({});  // {custId: [{svc_name, remain}]}
  useEffect(() => {
    const custIds = [...new Set((data?.reservations||[]).filter(r => r.date === selDate && r.custId && !r.isSchedule).map(r => r.custId))];
    if (custIds.length === 0) { setCustPkgMap({}); return; }
    const batchSize = 30;
    const batches = [];
    for (let i = 0; i < custIds.length; i += batchSize) batches.push(custIds.slice(i, i + batchSize));
    Promise.all(batches.map(batch =>
      fetch(`${SB_URL}/rest/v1/customer_packages?customer_id=in.(${batch.join(",")})&select=customer_id,service_name,total_count,used_count,note`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      }).then(r => r.json()).catch(() => [])
    )).then(results => {
      const map = {};
      const today = new Date().toISOString().slice(0,10);
      results.flat().forEach(p => {
        if (!Array.isArray(map[p.customer_id])) map[p.customer_id] = [];
        const sn = p.service_name||"";
        const expMatch = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
        if (expMatch && expMatch[1] < today) return;
        const isDadam = sn.includes("다담") || sn.includes("선불");
        const isBarf = sn.includes("바프");
        // 연간회원권·연간할인권·멤버십은 구독형 — 잔여횟수(+N) 표시 무의미
        const isMembership = /연간|멤버[십쉽]/.test(sn);
        if (isDadam || isBarf) {
          const m = (p.note||"").match(/잔액:([0-9,]+)/);
          const bal = m ? Number(m[1].replace(/,/g,"")) : 0;
          if (bal > 0) map[p.customer_id].push({ name: sn.replace(/\(잔액:[^)]*\)/,"").trim(), remain: bal, isDadam: true });
        } else if (isMembership) {
          map[p.customer_id].push({ name: sn.replace(/[여남]\)/,"").trim(), remain: 0, isDadam: false, isMembership: true });
        } else {
          const remain = (p.total_count||0) - (p.used_count||0);
          if (remain > 0) map[p.customer_id].push({
            name: sn.replace(/[여남]\)/,"").trim(),
            remain, isDadam: false
          });
        }
      });
      setCustPkgMap(map);
    });
  }, [selDate, data?.reservations?.length]);

  const branchesToShow = allBranchList.filter(b => viewBids.includes(b.id) && (isMaster || accessibleBids.includes(b.id)));

  // ── Alarm system ──
  const ALARM_TAG_ID = (data?.serviceTags||[]).find(t=>t.name&&t.name.includes("알람"))?.id;
  const [alarmPopup, setAlarmPopup] = useState(null);
  const firedAlarmsRef = useRef(new Set());
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const nowH = now.getHours();
      const nowM = now.getMinutes();
      const today = fmtLocal(now);
      const allRes = data.reservations || [];
      allRes.forEach(r => {
        if (!r.isSchedule || r.date !== today) return;
        if (!(r.selectedTags || []).includes(ALARM_TAG_ID)) return;
        if (firedAlarmsRef.current.has(r.id)) return;
        const [rh, rm] = (r.time || "10:00").split(":").map(Number);
        if (nowH === rh && nowM === rm) {
          firedAlarmsRef.current.add(r.id);
          const tags = (data?.serviceTags || []);
          const tagNames = (r.selectedTags || []).filter(tid => tid !== ALARM_TAG_ID).map(tid => tags.find(t => t.id === tid)?.name).filter(Boolean);
          setAlarmPopup({ time: r.time, memo: r.memo || "", tags: tagNames, room: r.roomId, id: r.id });
        }
      });
    };
    const timer = setInterval(check, 10000); // 10초마다 체크
    check();
    return () => clearInterval(timer);
  }, [data.reservations]);

  // 메모 호버 팝업 (블록 hover 시 전체 메모 표시)
  const [memoPopup, setMemoPopup] = useState(null);

  // ── Drag & Drop ──
  const [dragBlock, setDragBlock] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const [dragSnap, setDragSnap] = useState(null);
  const dragStartRef = useRef(null);
  const isDragging = useRef(false);
  const dragSnapRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);
  const origBlockPos = useRef(null);
  // 드래그 시작 시 커서와 블록 좌상단의 차이 — 구글 캘린더식 floating preview 위치 계산에 사용
  const clickOffsetRef = useRef({x:0, y:0});

  // ── Resize ──
  const [resizeBlock, setResizeBlock] = useState(null);
  const [resizeDur, setResizeDur] = useState(0);
  const isResizing = useRef(false);
  const resizeDurRef = useRef(0);
  const [pendingChange, setPendingChange] = useState(null);
  const [hoverCell, setHoverCell] = useState(null); // {roomId, rowIdx}
  const [empMovePopup, setEmpMovePopup] = useState(null); // {empId, date, x, y}
  const [addStaffPopup, setAddStaffPopup] = useState(null); // {branchId, x, y}
  // ESC 키로 팝업 닫기
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (addStaffPopup) { setAddStaffPopup(null); e.stopPropagation(); return; }
      if (empMovePopup)  { setEmpMovePopup(null);  e.stopPropagation(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addStaffPopup, empMovePopup]);
  // 빈 미배정 칼럼 (날짜·지점별 추가) — schedule_data.extraCols_v1 { "bid__date": count }
  const [extraCols, setExtraCols] = useState({});
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const loadExtra = () => {
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.extraCols_v1&select=value`, { headers: H })
        .then(r => r.json()).then(rows => {
          if (rows?.[0]?.value != null) {
            const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
            setExtraCols(v || {});
          }
        }).catch(() => {});
    };
    loadExtra();
    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient.channel("extra_cols_rt")
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.extraCols_v1" }, loadExtra)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.extraCols_v1" }, loadExtra)
        .subscribe();
    }
    const poll = setInterval(loadExtra, 30000);
    return () => { try { ch?.unsubscribe(); } catch(e) {} clearInterval(poll); };
  }, []);
  const _saveExtraCols = (next) => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "extraCols_v1", key: "extraCols_v1", value: JSON.stringify(next) })
    }).catch(console.error);
  };
  const addExtraCol = (branchId) => {
    const key = `${branchId}__${selDate}`;
    setExtraCols(prev => {
      const next = { ...prev, [key]: (prev[key] || 0) + 1 };
      _saveExtraCols(next);
      return next;
    });
  };
  const removeExtraCol = (branchId) => {
    const key = `${branchId}__${selDate}`;
    setExtraCols(prev => {
      const cur = prev[key] || 0;
      if (cur <= 0) return prev;
      const next = { ...prev };
      if (cur === 1) delete next[key]; else next[key] = cur - 1;
      _saveExtraCols(next);
      return next;
    });
  };

  // ── 미배정 칼럼 위치 (날짜·지점별) — { "bid__date": { naverIdx: shift } }
  // shift = 직원칼럼 N개 뒤에 위치 (0=최좌측, staffCount=최우측 + 칼럼 직전)
  // 디폴트: base naver(naverEmail에서 자동) → 0(좌측), 추가 naver → staffCount(우측)
  const [naverColShifts, setNaverColShifts] = useState({});
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const load = () => {
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.naverColShifts_v1&select=value`, { headers: H })
        .then(r => r.json()).then(rows => {
          if (rows?.[0]?.value != null) {
            const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
            setNaverColShifts(v || {});
          }
        }).catch(() => {});
    };
    load();
    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient.channel("naver_col_shifts_rt")
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.naverColShifts_v1" }, load)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.naverColShifts_v1" }, load)
        .subscribe();
    }
    const poll = setInterval(load, 30000);
    return () => { try { ch?.unsubscribe(); } catch(e) {} clearInterval(poll); };
  }, []);
  const _saveNaverColShifts = (next) => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "naverColShifts_v1", key: "naverColShifts_v1", value: JSON.stringify(next) })
    }).catch(console.error);
  };
  const moveNaverCol = (branchId, naverIdx, dir) => {
    const key = `${branchId}__${selDate}`;
    // 현재 지점의 staff 칼럼 수 + base naver 수 계산
    const br = (data?.branches||[]).find(b=>b.id===branchId);
    const baseNaver = br?.naverEmail ? (br.naverColCount || 1) : 0;
    const staffCount = (allRoomsRef.current||[]).filter(r => r.branch_id === branchId && r.isStaffCol).length;
    setNaverColShifts(prev => {
      const cur = prev[key] || {};
      const defaultShift = naverIdx < baseNaver ? 0 : staffCount;
      const curShift = cur[naverIdx] ?? defaultShift;
      const newShift = Math.max(0, Math.min(staffCount, curShift + dir));
      if (newShift === curShift) return prev;
      const next = { ...prev, [key]: { ...cur, [naverIdx]: newShift } };
      _saveNaverColShifts(next);
      return next;
    });
  };
  // 지점별 고정 컬럼 수 - branches.staffColCount에서 읽음
  const branchColCount = React.useMemo(() => {
    const map = {};
    (data?.branches||[]).forEach(br => { if(br.staffColCount) map[br.id] = br.staffColCount; });
    return map;
  }, [data?.branches]);
  const cellLongPress = useRef(null);

  // ─── 알람 (DB: schedule_data.alarms_v1) — 지점별 {branchId: [alarm]}
  const [alarms, _setAlarms] = useState({});
  const alarmsLoaded = useRef(false);
  const [alarmModal, setAlarmModal] = useState(null); // {time, branchId, editing?}
  const [alarmFired, setAlarmFired] = useState(null); // {alarm, firedAt}
  const firedKeysRef = useRef(new Set()); // 중복 발화 방지 (key: alarmId+date+time)
  const [alarmDrag, setAlarmDrag] = useState(null); // {id, startY}
  React.useEffect(() => {
    if (alarmsLoaded.current) return;
    alarmsLoaded.current = true;
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.alarms_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.json()).then(rows => {
      if (rows?.[0]?.value) {
        const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
        _setAlarms(v);
      }
    }).catch(console.error);
  }, []);
  const saveAlarms = React.useCallback((updater) => {
    _setAlarms(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: "POST", headers: H,
        body: JSON.stringify({ id: "alarms_v1", key: "alarms_v1", value: JSON.stringify(next) })
      }).catch(console.error);
      return next;
    });
  }, []);
  // 현재 날짜/지점에 해당하는 알람만 필터 (반복 규칙 평가)
  const getActiveAlarmsForBranch = (branchId, date) => {
    const list = alarms[branchId] || [];
    const d = new Date(date);
    const dow = d.getDay(); // 0=Sun
    return list.filter(a => {
      if (a.disabled) return false;
      if (a.repeat === "once") return a.date === date;
      if (a.repeat === "daily") return true;
      if (a.repeat === "weekdays") return dow >= 1 && dow <= 5;
      if (a.repeat === "weekly") return (a.repeatDays || []).includes(dow);
      return false;
    });
  };
  // 알람 발화 체커 — 매 30초 점검
  React.useEffect(() => {
    const tick = () => {
      const now = new Date();
      const nowDate = now.toISOString().slice(0,10);
      const nowMin = now.getHours()*60 + now.getMinutes();
      Object.entries(alarms).forEach(([branchId, list]) => {
        // 사용자가 보는 지점만 발화 (여러 지점 보면 그 중 하나만 울려도 OK)
        if (userBranches.length > 0 && !userBranches.includes(branchId)) return;
        (list||[]).forEach(a => {
          if (a.disabled) return;
          const [hh, mm] = (a.time||"0:0").split(":").map(Number);
          const alarmMin = hh*60+mm;
          const dowNow = now.getDay();
          let shouldFire = false;
          if (a.repeat === "once") shouldFire = a.date === nowDate;
          else if (a.repeat === "daily") shouldFire = true;
          else if (a.repeat === "weekdays") shouldFire = dowNow>=1 && dowNow<=5;
          else if (a.repeat === "weekly") shouldFire = (a.repeatDays||[]).includes(dowNow);
          if (!shouldFire) return;
          if (Math.abs(nowMin - alarmMin) > 1) return; // 1분 window
          const key = `${a.id}_${nowDate}_${a.time}`;
          if (firedKeysRef.current.has(key)) return;
          firedKeysRef.current.add(key);
          setAlarmFired({ alarm: a, firedAt: new Date() });
          // 브라우저 알림 (권한 있으면)
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(`🔔 ${a.title || "알람"}`, { body: `${a.time} · ${a.note || ""}`, tag: key });
            }
          } catch {}
        });
      });
    };
    const id = setInterval(tick, 30000);
    tick();
    return () => clearInterval(id);
  }, [alarms, userBranches]);

  // 알람 드래그/클릭 전역 핸들러 — mousedown부터 시작, 5px 이상 이동 시 drag mode, 아니면 click(edit)
  const _alarmDragCtxRef = React.useRef({});
  const _alarmPressRef = React.useRef(null); // { alarm, branchId, startY, startX, dragStarted }
  React.useEffect(() => {
    const DRAG_THRESHOLD = 5;
    const compTime = (y) => {
      const ctx = _alarmDragCtxRef.current || {};
      const sr = ctx.scrollRef?.current;
      if (!sr) return null;
      const rect = sr.getBoundingClientRect();
      const scrollTop = sr.scrollTop;
      const tbH = ctx.topbarH || 80;
      const hdH = ctx.headerH || 40;
      const rH = ctx.rowH || 18;
      const tr = ctx.totalRows || 156;
      const sh = ctx.startHour || 10;
      const relY = y - rect.top + scrollTop - (tbH + hdH);
      const rowIdx = Math.max(0, Math.min(tr-1, Math.floor(relY / rH)));
      const slotMin = sh*60 + rowIdx*5;
      return `${String(Math.floor(slotMin/60)).padStart(2,"0")}:${String(slotMin%60).padStart(2,"0")}`;
    };
    const onMove = (e) => {
      const pr = _alarmPressRef.current;
      if (!pr) return;
      const y = e.touches ? e.touches[0]?.clientY : e.clientY;
      const x = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (y == null) return;
      if (!pr.dragStarted) {
        if (Math.abs(y - pr.startY) < DRAG_THRESHOLD && Math.abs(x - pr.startX) < DRAG_THRESHOLD) return;
        pr.dragStarted = true;
        setAlarmDrag({alarm: pr.alarm, branchId: pr.branchId, origTime: pr.alarm.time, targetTime: pr.alarm.time});
      }
      const tt = compTime(y);
      if (tt) setAlarmDrag(prev => prev ? {...prev, targetTime: tt} : prev);
      if (e.cancelable && e.type==="touchmove") e.preventDefault();
    };
    const onUp = () => {
      const pr = _alarmPressRef.current;
      if (!pr) return;
      _alarmPressRef.current = null;
      if (pr.dragStarted) {
        // drag: save if moved
        setAlarmDrag(curr => {
          if (curr && curr.targetTime && curr.targetTime !== curr.origTime) {
            saveAlarms(prev => ({
              ...prev,
              [curr.branchId]: (prev[curr.branchId] || []).map(a =>
                a.id === curr.alarm.id ? {...a, time: curr.targetTime} : a
              )
            }));
          }
          return null;
        });
      } else {
        // click: open edit modal
        setAlarmModal({ branchId: pr.branchId, time: pr.alarm.time, editing: pr.alarm });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, {passive:false});
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
  }, [saveAlarms]);

  // 직원 컬럼 순서 커스텀 (DB: schedule_data.empColOrder_v1)
  const [empColOrder, _setEmpColOrder] = useState({});
  const empColOrderLoaded = React.useRef(false);
  React.useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const loadOrder = () => {
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empColOrder_v1&select=value`, { headers: H })
        .then(r => r.json()).then(rows => {
          if (rows?.[0]?.value) {
            const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
            // 방어: DB가 축소되어 들어왔으면 현재 state의 누락 id를 뒤에 복구
            _setEmpColOrder(cur => {
              const merged = {};
              const bids = new Set([...Object.keys(cur||{}), ...Object.keys(v||{})]);
              let recovered = false;
              bids.forEach(bid => {
                const newList = Array.isArray(v[bid]) ? v[bid] : [];
                const oldList = Array.isArray(cur[bid]) ? cur[bid] : [];
                const newSet = new Set(newList);
                const missing = oldList.filter(id => !newSet.has(id));
                if (missing.length) recovered = true;
                merged[bid] = [...newList, ...missing];
              });
              // 자동 복구 DB 재저장 제거 — empColOrder는 user 수동 변경만 (룰 변경)
              return merged;
            });
            empColOrderLoaded.current = true;
          }
        }).catch(console.error);
    };
    loadOrder();
    // Realtime 구독 — 다른 세션/탭이 order를 바꿨을 때 즉시 반영
    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient.channel("emp_col_order_rt")
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.empColOrder_v1" }, loadOrder)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.empColOrder_v1" }, loadOrder)
        .subscribe();
    }
    // 폴링 — Realtime 실패 대비 (30초)
    const poll = setInterval(loadOrder, 30000);
    return () => {
      try { ch?.unsubscribe(); } catch(e) {}
      clearInterval(poll);
    };
  }, []);
  const setEmpColOrder = React.useCallback((updater) => {
    _setEmpColOrder(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // 방어: next가 prev보다 길이 짧아진 경우(의도적 삭제 X) prev의 누락 id를 뒤에 복구
      const merged = {};
      const bids = new Set([...Object.keys(prev||{}), ...Object.keys(next||{})]);
      bids.forEach(bid => {
        const nList = Array.isArray(next[bid]) ? next[bid] : [];
        const pList = Array.isArray(prev[bid]) ? prev[bid] : [];
        const nSet = new Set(nList);
        const missing = pList.filter(id => !nSet.has(id));
        merged[bid] = [...nList, ...missing];
      });
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: "POST", headers: H,
        body: JSON.stringify({ id: "empColOrder_v1", key: "empColOrder_v1", value: JSON.stringify(merged) })
      }).catch(console.error);
      return merged;
    });
  }, []);
  // sessionStorage 기반 임시 순서 override 트리거용 (남직원 이동 시 사용)
  const [dailyOrderTick, setDailyOrderTick] = useState(0);
  const moveEmpCol = (branchId, empId, dir) => {
    // 현재 보이는 칼럼 (렌더 기반)
    const visibleIds = (allRoomsRef.current||[])
      .filter(r => r.branch_id === branchId && r.staffId && r.isStaffCol)
      .map(r => r.staffId);
    const visIdx = visibleIds.indexOf(empId);
    if (visIdx < 0) return;
    const newIdx = visIdx + dir;
    if (newIdx < 0 || newIdx >= visibleIds.length) return;
    // 남직원 여부 — 본인 또는 swap 대상 중 한 명이라도 남직원이면 "그 날만" sessionStorage로 처리 (DB 변경 금지)
    const swapEmpId = visibleIds[newIdx];
    const isMaleEmp = (id) => {
      const raw = empList.find(x => x.id === id);
      return !!(raw?.isMale || raw?.gender === "M");
    };
    const sessionOnly = isMaleEmp(empId) || isMaleEmp(swapEmpId);
    if (sessionOnly) {
      const dayKey = `bliss_day_order_${selDate}_${branchId}`;
      const newOrder = [...visibleIds];
      [newOrder[visIdx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[visIdx]];
      try { sessionStorage.setItem(dayKey, JSON.stringify(newOrder)); } catch(e) {}
      // 강제 리렌더 — state 자체는 변경 없음. 임시 버전 counter 사용
      setDailyOrderTick(t => t + 1);
      return;
    }
    // 일반 직원: 기존대로 DB 저장 order
    setEmpColOrder(prev => {
      let order = [...(prev[branchId] || [])];
      if (!order.includes(empId)) order.unshift(empId);
      const idx = order.indexOf(empId);
      const visibleSet = new Set(visibleIds);
      let swapIdx = -1;
      if (dir > 0) {
        for (let i = idx + 1; i < order.length; i++) {
          if (visibleSet.has(order[i])) { swapIdx = i; break; }
        }
      } else {
        for (let i = idx - 1; i >= 0; i--) {
          if (visibleSet.has(order[i])) { swapIdx = i; break; }
        }
      }
      if (swapIdx < 0) return prev;
      [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
      return {...prev, [branchId]: order};
    });
  };
  const allRoomsRef = React.useRef([]);
  // render 중 setState 금지 → 미시딩 대상은 모아뒀다가 effect에서 일괄 반영
  const pendingSeedRef = React.useRef({});
  const sortStaffByOrder = (staffList, branchId) => {
    // empColOrder 자동 추가 제거 — user 수동 변경만 (룰: 코드는 순서 안 건드림)
    // empColOrder에 없는 직원은 끝에 임시 표시 (그 일자만, DB는 변경 안 함)
    const order = empColOrder[branchId];
    if (!order || order.length === 0) return staffList;
    const sorted = [];
    for (const id of order) {
      const e = staffList.find(s => s.id === id);
      if (e) sorted.push(e);
    }
    // empColOrder에 없는 직원 (예: 신규 타지점이동) — 끝에 추가
    for (const e of staffList) {
      if (!sorted.find(s => s.id === e.id)) sorted.push(e);
    }
    return sorted;
  };
  // pendingSeedRef effect 제거 — empColOrder 자동 갱신 X (룰)

  const allRooms = branchesToShow.flatMap((br, brIdx) => {
    const baseNaver = br.naverEmail ? (br.naverColCount || 1) : 0;
    const extraCount = extraCols[`${br.id}__${selDate}`] || 0;
    const naverCount = baseNaver + extraCount;
    const naverRooms = Array.from({length: naverCount}, (_, i) => ({
      id: i < baseNaver ? `nv_${br.id}_${i}` : `nv_${br.id}_extra_${i - baseNaver}`,
      name: i === 0 ? "미배정" : `미배정 ${i+1}`,
      branch_id: br.id, branchName: br.short||br.name||"",
      isNaver: true,
      isExtraCol: i >= baseNaver,
      _brIdx: brIdx,
      _isFirstOfBranch: i === 0,
    }));
    // 🚨 네이버 예약 막기 컬럼 — 긴급 차단됨 (시술 비활성 의혹 조사 중)
    const blockCol = [];
    // 출근표 기반 직원 컬럼 (커스텀 순서 적용)
    const rawStaff = getWorkingStaff(br.id, selDate);
    const workingStaff = rawStaff ? sortStaffByOrder(rawStaff, br.id) : null;
    let staffRooms;
    if (workingStaff !== null) {
      // 근무표 기반 — 휴무 필터만 (자동이동 추측 로직 제거 — 명시적 이동만 처리)
      const filteredStaff = workingStaff.filter(e => {
        const ds = schHistory ? schHistory[e.id]?.[selDate] : null;
        if (ds === "휴무" || ds === "휴무(꼭)" || ds === "무급") return false;
        return true;
      });
      // 커스텀 순서가 있으면 그대로, 없으면 base→guest 순서
      const hasCustomOrder = empColOrder[br.id]?.length > 0;
      let orderedStaff;
      if (hasCustomOrder) {
        orderedStaff = sortStaffByOrder(filteredStaff, br.id);
      } else {
        const baseStaff = filteredStaff.filter(e => {
          const emp = BASE_EMP_LIST.find(b=>b.id===e.id);
          return emp && emp.branch_id === br.id;
        });
        const guestStaff = filteredStaff.filter(e => {
          const emp = BASE_EMP_LIST.find(b=>b.id===e.id);
          return !emp || emp.branch_id !== br.id;
        });
        orderedStaff = [...baseStaff, ...guestStaff];
      }
      // 일자별 override (sessionStorage) — user가 그 날짜만 순서 변경한 경우 우선 적용
      // 남직원 자동 정렬 제거 (룰: 타임라인 순서는 코드가 자동 변경 안 함)
      try {
        const dayKey = `bliss_day_order_${selDate}_${br.id}`;
        const raw = sessionStorage.getItem(dayKey);
        const dayOrder = raw ? JSON.parse(raw) : null;
        if (Array.isArray(dayOrder) && dayOrder.length > 0) {
          const byId = new Map(orderedStaff.map(e => [e.id, e]));
          const pinned = dayOrder.map(id => byId.get(id)).filter(Boolean);
          const rest = orderedStaff.filter(e => !dayOrder.includes(e.id));
          orderedStaff = [...pinned, ...rest];
        }
      } catch(e) {}
      staffRooms = orderedStaff.map(e => {
        const segments = getEmpActiveSegments(e.id, selDate, br.id);
        const firstSeg = segments && segments[0];
        const lastSeg = segments && segments[segments.length-1];
        return {
          id: `st_${br.id}_${e.id}`, name: e.name || e.id,
          branch_id: br.id, branchName: br.short||br.name||"",
          staffId: e.id, isStaffCol: true,
          // 복수 세그먼트 (같은 지점 여러 구간) — null=종일
          activeSegments: e._movedOut ? null : (segments || null),
          // 하위 호환: 드래그 핸들·클릭 판정용 전체 경계 (첫 from ~ 마지막 until)
          activeFrom: e._movedOut ? null : (firstSeg?.from || null),
          activeUntil: e._movedOut ? null : (lastSeg?.until || null),
          isMovedOut: e._movedOut === true,
          hideName: e._hideName === true,
        };
      });
    } else {
      // schHistory 미로드 시 직원 컬럼 표시 안 함 (로딩 후 리렌더링됨)
      staffRooms = [];
    }
    const addCol = {
      id: `blank_${br.id}_add`, name: "+",
      branch_id: br.id, branchName: br.short||br.name||"",
      isBlank: true, isAddCol: true
    };
    // 미배정 칼럼 위치 적용 (디폴트: base→0, extra→staffRooms.length)
    const shifts = naverColShifts[`${br.id}__${selDate}`] || {};
    const buckets = Array.from({length: staffRooms.length + 1}, () => []);
    naverRooms.forEach((nv, i) => {
      const def = i < baseNaver ? 0 : staffRooms.length;
      const s = Math.max(0, Math.min(staffRooms.length, shifts[i] ?? def));
      // 메타데이터 첨부 — 헤더 화살표·boundary 판정에 사용
      nv._naverIdx = i;
      nv._shift = s;
      nv._maxShift = staffRooms.length;
      buckets[s].push(nv);
    });
    const ordered = [];
    for (let i = 0; i < staffRooms.length; i++) {
      ordered.push(...buckets[i]);
      ordered.push(staffRooms[i]);
    }
    ordered.push(...buckets[staffRooms.length]);
    // 막기 칼럼: 첫 번째 미배정(slot 0) 직후에 삽입 — 미배정 옆에 좁게
    if (blockCol.length) {
      // 첫 슬롯의 마지막 미배정 칼럼 다음 위치 찾기
      const firstNaverIdx = ordered.findIndex(r => r.isNaver && r._naverIdx === 0);
      if (firstNaverIdx >= 0) ordered.splice(firstNaverIdx + 1, 0, ...blockCol);
      else ordered.unshift(...blockCol);
    }
    ordered.push(addCol);
    return ordered;
  });
  allRoomsRef.current = allRooms;
  const isNaverRes = (r) => !!r.reservationId || r.source === "ai_booking";
  const isPendingRes = (r) => r.status === "pending" || r.status === "request";
  const isUnassigned = (r) => !r.roomId && !r.staffId || r.roomId?.startsWith("nv_") || r.roomId?.startsWith("blank_");
  
  const allRoomIds = new Set(allRooms.map(r => r.id));

  const blocks = (data?.reservations||[]).filter(r => {
    if (r.date !== selDate) return false;
    if (!branchesToShow.some(b=>b.id===r.bid)) return false;
    // 변경으로 인한 구예약(naver_changed)은 숨김, 일반 취소는 "취소됨" 표시로 남김
    if (r.status === "naver_changed") return false;
    const isNaver = r.source === "naver" || r.source === "네이버";
    // 네이버 스크래퍼 예약만 스크래핑 완료 대기 (수동 예약/manual_ 접두사는 즉시 표시)
    const isManual = !r.reservationId || String(r.reservationId).startsWith("manual_") || String(r.reservationId).startsWith("ai_");
    if (isNaver && !r.isScrapingDone && !isManual) return false;
    return true;
  }).map(r => {
    // allRooms에 없는 room_id/staff_id → 무시하고 재배치 대상으로 (미배정 컬럼으로 이동)
    // staffExists는 예약의 bid(지점)에 그 직원의 칼럼이 있는지로 판단
    // (직원이 다른 지점에 가 있어도 예약 지점에 칼럼 없으면 미배정으로 보내야 함)
    const roomExists = !r.roomId || allRoomIds.has(r.roomId);
    const staffExists = !r.staffId
      || allRoomIds.has(r.staffId)
      || allRooms.some(rm => rm.isStaffCol && rm.branch_id === r.bid && rm.staffId === r.staffId);
    if (!roomExists && !staffExists) return {...r, roomId: "", staffId: ""};
    if (!roomExists) return {...r, roomId: ""};
    // 직원이 예약 지점에 칼럼 없음 → staffId 제거해서 미배정으로 표시
    if (!staffExists) return {...r, staffId: ""};
    return r;
  });

  // ── 네이버 예약 자동배치: 빈 담당자(왼쪽부터) 배분 ──
  const toMin = (t) => { const [h,m] = (t||"10:00").split(":").map(Number); return h*60+m; };
  const naverAssignments = (() => {
    const asgn = {};
    branchesToShow.forEach(br => {
      const brBlocks = blocks.filter(b => b.bid === br.id);
      const brNaverBlocks = brBlocks.filter(b => isUnassigned(b));
      if (brNaverBlocks.length === 0) return;
      const naverRooms = allRooms.filter(r => r.isNaver && r.branch_id === br.id);
      const regularRooms = allRooms.filter(r => !r.isNaver && !r.isBlank && r.branch_id === br.id);
      const targetRooms = naverRooms.length > 0 ? naverRooms : regularRooms;
      if (targetRooms.length === 0) return;
      const naverIds = new Set(naverRooms.map(r => r.id));
      // Track occupied times per room
      const roomOcc = new Map();
      targetRooms.forEach(r => roomOcc.set(r.id, []));
      // Pre-fill regular rooms with existing non-naver, non-schedule blocks (기타일정 무시)
      if (naverRooms.length === 0) {
        brBlocks.filter(b => !isUnassigned(b) && !b.isSchedule).forEach(b => {
          const effectiveRoomId = b.roomId || (b.staffId ? allRooms.find(r=>r.isStaffCol && r.staffId===b.staffId)?.id : null);
          if (effectiveRoomId && roomOcc.has(effectiveRoomId)) roomOcc.get(effectiveRoomId).push({ s: toMin(b.time), e: toMin(b.time) + (b.dur||30) });
          else if (roomOcc.has(b.roomId)) roomOcc.get(b.roomId).push({ s: toMin(b.time), e: toMin(b.time) + (b.dur||30) });
        });
      }
      // Phase 1: 명시적 미배정 칼럼 지정 블록 (사용자가 특정 미배정 칼럼에 드롭) — 그대로 배치
      const explicit = new Set();
      brNaverBlocks.forEach(block => {
        if (block.roomId && naverIds.has(block.roomId)) {
          asgn[block.id] = block.roomId;
          explicit.add(block.id);
          const bS = toMin(block.time), bE = bS + (block.dur||30);
          roomOcc.get(block.roomId)?.push({ s: bS, e: bE });
        }
      });
      // Phase 2: 자동 배치 — 시간순 leftmost available
      [...brNaverBlocks].filter(b => !explicit.has(b.id)).sort((a,b) => a.time.localeCompare(b.time)).forEach(block => {
        const bS = toMin(block.time), bE = bS + (block.dur||30);
        let best = targetRooms[0].id;
        for (const rm of targetRooms) {
          const occ = roomOcc.get(rm.id) || [];
          if (!occ.some(o => bS < o.e && o.s < bE)) { best = rm.id; break; }
        }
        asgn[block.id] = best;
        roomOcc.get(best)?.push({ s: bS, e: bE });
      });
    });
    return asgn;
  })();

  // Time config - per-browser via localStorage
  const getTlSettings = () => {
    try {
      const raw = localStorage.getItem("tl_settings");
      return raw ? JSON.parse(raw) : {};
    } catch(e) {}
    return {};
  };
  const dbTl = useRef(getTlSettings());
  const tlDef = (k, def) => dbTl.current[k] !== undefined ? Number(dbTl.current[k]) : def;
  const tlSaveLocal = useCallback((allSettings) => {
    try { localStorage.setItem("tl_settings", JSON.stringify(allSettings)); } catch(e) {}
  }, []);
  const [startHour, setStartHourRaw] = useState(() => tlDef("sh", 8));
  const [endHour, setEndHourRaw] = useState(() => tlDef("eh", 23));
  const [rowH, setRowHRaw] = useState(() => tlDef("rh", 14));
  const [colW, setColWRaw] = useState(() => tlDef("cw", 160));
  const [timeUnit, setTimeUnitRaw] = useState(() => tlDef("tu", 5));
  const [blockFs, setBlockFsRaw] = useState(() => tlDef("fs", 13));
  const [blockOp, setBlockOpRaw] = useState(() => tlDef("op", 50));
  const [statusClr, setStatusClrRaw] = useState(() => {
    const sc = dbTl.current.sc;
    return sc ? {...STATUS_CLR_DEFAULT,...sc} : {...STATUS_CLR_DEFAULT};
  });
  // 매출 강조 — 매출 총합이 min 이상이면 블록 테두리/그림자에 color 적용. min=0 이면 비활성
  const [salesHighlight, setSalesHighlightRaw] = useState(() => {
    const hl = dbTl.current.hl;
    return (hl && typeof hl === "object")
      ? { min: Number(hl.min)||0, color: hl.color || "#FFD700", mode: hl.mode || "border" }
      : { min: 0, color: "#FFD700", mode: "border" };
  });
  // 항목별 전 지점 공통 적용 — 각 설정 키를 개별 토글
  // sharedKeys: {sh: true, eh: false, rh: true, cw:true, tu:true, fs:false, op:false, sc:false}
  // DB의 tl_shared_settings_v1.value._sk 에 저장되어 전 PC 동기화 (값도 같은 row에 병합 저장)
  const tlSharedKeysRef = useRef(dbTl.current.sharedKeys || {});
  const [tlSharedKeys, setTlSharedKeysRaw] = useState(tlSharedKeysRef.current);
  // DB row에 여러 키를 한 번에 merge upsert (race 방지)
  const pushToDb = useCallback((updates) => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.tl_shared_settings_v1&select=value`, { headers: H })
      .then(r => r.json()).then(rows => {
        let cur = {};
        const v = rows?.[0]?.value;
        if (v) { try { cur = typeof v === "string" ? JSON.parse(v) : v; } catch(e) {} }
        const next = {...cur, ...updates};
        fetch(`${SB_URL}/rest/v1/schedule_data`, {
          method: "POST",
          headers: {...H, Prefer: "resolution=merge-duplicates"},
          body: JSON.stringify({ id: "tl_shared_settings_v1", key: "tl_shared_settings_v1", value: JSON.stringify(next) })
        }).catch(console.error);
      }).catch(console.error);
  }, []);
  // 초기 로드: DB에서 _sk(공유키 목록) + 각 공유값 가져와서 적용
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.tl_shared_settings_v1&select=value`, { headers: H })
      .then(r => r.json()).then(rows => {
        const v = rows?.[0]?.value;
        if (!v) return;
        const s = typeof v === "string" ? JSON.parse(v) : v;
        // DB에 저장된 sharedKeys 가 진실 — 로컬에 반영 (전 PC 동기화)
        const dbSk = s._sk && typeof s._sk === "object" ? s._sk : null;
        const sharedKeys = dbSk || tlSharedKeysRef.current;
        if (dbSk) {
          tlSharedKeysRef.current = dbSk;
          setTlSharedKeysRaw(dbSk);
          dbTl.current = {...dbTl.current, sharedKeys: dbSk};
        }
        // 마킹된 키는 DB값으로 override
        if (sharedKeys.sh && s.sh !== undefined) { setStartHourRaw(Number(s.sh)); dbTl.current.sh = Number(s.sh); }
        if (sharedKeys.eh && s.eh !== undefined) { setEndHourRaw(Number(s.eh)); dbTl.current.eh = Number(s.eh); }
        if (sharedKeys.rh && s.rh !== undefined) { setRowHRaw(Number(s.rh)); dbTl.current.rh = Number(s.rh); }
        if (sharedKeys.cw && s.cw !== undefined) { setColWRaw(Number(s.cw)); dbTl.current.cw = Number(s.cw); }
        if (sharedKeys.tu && s.tu !== undefined) { setTimeUnitRaw(Number(s.tu)); dbTl.current.tu = Number(s.tu); }
        if (sharedKeys.fs && s.fs !== undefined) { setBlockFsRaw(Number(s.fs)); dbTl.current.fs = Number(s.fs); }
        if (sharedKeys.op && s.op !== undefined) { setBlockOpRaw(Number(s.op)); dbTl.current.op = Number(s.op); }
        if (sharedKeys.sc && s.sc) { setStatusClrRaw({...STATUS_CLR_DEFAULT, ...s.sc}); dbTl.current.sc = s.sc; }
        if (sharedKeys.hl && s.hl && typeof s.hl === "object") { setSalesHighlightRaw({ min: Number(s.hl.min)||0, color: s.hl.color || "#FFD700", mode: s.hl.mode || "border" }); dbTl.current.hl = s.hl; }
        tlSaveLocal(dbTl.current);
      }).catch(console.error);
  }, []);
  const setTlSharedKey = (k, v) => {
    const next = {...tlSharedKeysRef.current, [k]: v};
    tlSharedKeysRef.current = next;
    setTlSharedKeysRaw(next);
    dbTl.current = {...dbTl.current, sharedKeys: next};
    tlSaveLocal(dbTl.current);
    // sharedKeys 자체 + 체크 ON 시 현재 값까지 한 번에 DB에 push (다른 기기 동기화)
    const updates = { _sk: next };
    if (v) updates[k] = k === "sc" ? statusClr : dbTl.current[k];
    pushToDb(updates);
  };
  const makeTlSave = (k, rawSetter) => v => {
    rawSetter(prev => {
      const resolved = typeof v === "function" ? v(prev) : v;
      dbTl.current = {...dbTl.current, [k]: resolved};
      tlSaveLocal(dbTl.current);
      if (tlSharedKeysRef.current[k]) pushToDb({[k]: resolved});
      return resolved;
    });
  };
  const setStartHour = makeTlSave("sh", setStartHourRaw);
  const setEndHour = makeTlSave("eh", setEndHourRaw);
  const setRowH = makeTlSave("rh", setRowHRaw);
  const setColW = makeTlSave("cw", setColWRaw);
  const setTimeUnit = makeTlSave("tu", setTimeUnitRaw);
  const setBlockFs = makeTlSave("fs", setBlockFsRaw);
  const setBlockOp = makeTlSave("op", setBlockOpRaw);
  const setStatusClr = (k,v) => { setStatusClrRaw(p => { const n = {...p,[k]:v}; dbTl.current = {...dbTl.current, sc:n}; tlSaveLocal(dbTl.current); try{localStorage.setItem("tl_sc",JSON.stringify(n))}catch(e){} if (tlSharedKeysRef.current.sc) pushToDb({sc: n}); return n; }); };
  const setSalesHighlight = (patch) => { setSalesHighlightRaw(p => { const n = {...p, ...patch}; dbTl.current = {...dbTl.current, hl:n}; tlSaveLocal(dbTl.current); if (tlSharedKeysRef.current.hl) pushToDb({hl: n}); return n; }); };
  // 매출 총합 매핑: reservationId → total amount (결제수단 합계)
  const salesByResId = useMemo(() => {
    const m = new Map();
    (data?.sales||[]).forEach(s => {
      const rid = s.reservationId;
      if (!rid) return;
      const t = (s.svcCash||0)+(s.svcTransfer||0)+(s.svcCard||0)+(s.svcPoint||0)
              + (s.prodCash||0)+(s.prodTransfer||0)+(s.prodCard||0)+(s.prodPoint||0)
              + (s.externalPrepaid||0);
      m.set(rid, (m.get(rid)||0) + t);
    });
    return m;
  }, [data?.sales]);
  // Sync status colors to localStorage for other components using getStatusClr()
  useEffect(() => { try{localStorage.setItem("tl_sc",JSON.stringify(statusClr))}catch(e){} }, [statusClr]);
  // 예약 endTime이 설정된 종료시간을 초과하면 자동 확장
  const effectiveEndHour = useMemo(() => {
    let maxH = endHour;
    (data?.reservations||[]).forEach(r => {
      if (r.date !== selDate) return;
      // endTime은 DB에 없으므로 time+dur로 계산
      let et = r.endTime || r.end_time;
      if (!et && r.time && r.dur) {
        const [hh, mm] = r.time.split(":").map(Number);
        const endMin = hh * 60 + mm + Number(r.dur);
        et = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
      }
      if (!et) return;
      const h = parseInt(et.split(":")[0]);
      const m = parseInt(et.split(":")[1]);
      const needed = m > 0 ? h + 1 : h;
      if (needed > maxH) maxH = Math.min(24, needed);
    });
    return maxH;
  }, [data?.reservations, selDate, endHour]);
  const slotsPerHour = 60 / timeUnit;
  const totalRows = (effectiveEndHour - startHour) * slotsPerHour;
  // 알람 드래그 ctx 동기화 (hook 위쪽 useEffect에서 읽어감)
  React.useEffect(() => {
    _alarmDragCtxRef.current = { scrollRef, topbarH, headerH, rowH, totalRows, startHour };
  });
  const headerH = 40;

  // CSS grid background
  const hourH = rowH * slotsPerHour;
  const halfH = rowH * (slotsPerHour / 2);
  const gridBg = useMemo(() => ({
    backgroundImage: [
      `repeating-linear-gradient(to bottom, #e8e8e8 0px, #e8e8e8 1px, transparent 1px, transparent ${hourH}px)`,
      ...(slotsPerHour >= 2 ? [`repeating-linear-gradient(to bottom, #f0f0f0 0px, #f0f0f0 1px, transparent 1px, transparent ${halfH}px)`] : []),
      ...(slotsPerHour > 2 ? [`repeating-linear-gradient(to bottom, #f5f5f5 0px, #f5f5f5 1px, transparent 1px, transparent ${rowH}px)`] : []),
    ].join(","),
    backgroundSize: "100% 100%",
  }), [rowH, hourH, halfH, slotsPerHour]);

  // Time label positions
  const timeLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < totalRows; i++) {
      const totalMin = i * timeUnit;
      const h = startHour + Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const isHour = m === 0;
      const ampm = h < 12 ? "오전" : "오후";
      const h12 = h <= 12 ? h : h - 12;
      const isMob = window.innerWidth <= 768;
      labels.push({ i, isHour, m, text: isHour ? (isMob ? `${h12}:00` : `${ampm} ${String(h12).padStart(2,"0")}:00`) : `${String(m).padStart(2,"0")}` });
    }
    return labels;
  }, [startHour, effectiveEndHour, timeUnit, totalRows]);

  const timeToY = (timeStr) => {
    const [h, m] = timeStr.split(":").map(Number);
    return ((h - startHour) * 60 + m) / timeUnit * rowH;
  };

  const yToTime = (y) => {
    const totalMin = Math.floor(y / rowH) * timeUnit;
    const h = startHour + Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  };

  const lastTouchCell = useRef(0);
  const handleCellClick = (room, y) => {
    if (isDragging.current || isResizing.current) return;
    if (!canEdit(room.branch_id)) return;
    // 모바일: 터치 직후 click 무시 (롱프레스로만 등록)
    if (Date.now() - lastTouchCell.current < 500) return;
    const time = yToTime(y);
    // 미배정/직원 칼럼 클릭: 미배정은 roomId/staffId 모두 비움 → 진짜 미배정 상태
    setModalData({
      roomId: (room.isStaffCol || room.isNaver) ? "" : room.id,
      bid: room.branch_id,
      time, date: selDate,
      staffId: room.isStaffCol ? room.staffId : undefined,
    });
    setShowModal(true);
  };

  const handleBlockClick = async (block, e) => {
    e.stopPropagation();
    if (isDragging.current || isResizing.current) return;
    const readOnly = !canEdit(block.bid);
    let freshBlock = block;
    try {
      if (block.id) {
        const rows = await sb.get("reservations", block.id);
        if (rows && rows.id) {
          const parsed = fromDb("reservations", [rows])[0];
          freshBlock = {...block, ...parsed};
          setData(prev => prev ? {...prev, reservations: (prev.reservations||[]).map(r => r.id === parsed.id ? {...r, ...parsed} : r)} : prev);
        }
      }
    } catch(e) { console.warn("fresh fetch err:", e); }
    setModalData({ ...freshBlock, readOnly });
    setShowModal(true);
  };

  const handleSave = async (item) => {
    // 🔒 race-condition 방어: 네이버 서버가 비동기로 갱신하는 필드(status, naver_*_dt)는
    // 모달이 열린 동안 stale 값으로 덮어쓰기 방지.
    const _snap = item._initialServerSnap;
    const stripStaleNaverFields = (row) => {
      if (!_snap || !row) return row;
      const out = {...row};
      if ((item.status || "") === (_snap.status || "")) delete out.status;
      delete out.naver_confirmed_dt;
      delete out.naver_cancelled_dt;
      delete out.naver_reg_dt;
      return out;
    };
    // + 칼럼 템플릿 저장: schedule_data.colTemplates_v1에 저장 (예약 테이블 X)
    if (item._isColTemplate) {
      const bid = item.bid;
      if (!bid) return;
      const tpl = {
        id: item._templateId || ("tpl_" + uid()),
        name: (item.selectedTags||[]).map(tid=>(data?.serviceTags||[]).find(t=>t.id===tid)?.name).filter(Boolean).join("+") || "내부일정",
        tagIds: [...(item.selectedTags||[])],
        time: item.time,
        dur: item.dur || 30,
        memo: item.memo || ""
      };
      const next = {...colTemplates};
      const list = [...(next[bid]||[])];
      const existIdx = list.findIndex(t => t.id === tpl.id);
      if (existIdx >= 0) list[existIdx] = tpl;
      else list.push(tpl);
      next[bid] = list;
      saveColTemplates(next);
      setShowModal(false); setModalData(null);
      return;
    }
    // 미배정 칼럼 roomId 정리 + 직원컬럼 합성 ID(st_) 정리 (DB에는 실제 room id만 저장)
    if (item.roomId && (item.roomId.startsWith("blank_") || item.roomId.startsWith("st_") || item.roomId.startsWith("nv_"))) item.roomId = "";
    // 필수값 검증
    if (!item.isSchedule && item.type === "reservation" && !item.custName?.trim()) {
      alert("고객 이름을 입력해 주세요."); return;
    }
    // ── 비활성 직원 컬럼 예약 등록 차단 (내부일정은 허용) ──
    // 예약(고객 시술): 직원이 그 시간대에 활성이 아니면 저장 차단
    // 내부일정(청소·메모 등 isSchedule): 비활성 시간대에도 등록 허용
    if (!item.isSchedule && item.type === "reservation" && item.staffId && item.bid && item.date && item.time) {
      const tToMin = (t) => { if(!t) return 0; const [h,m] = String(t).split(":").map(Number); return (h||0)*60 + (m||0); };
      const segs = getEmpActiveSegments(item.staffId, item.date, item.bid);
      const startMin = tToMin(item.time);
      const endMin = startMin + (Number(item.dur) || 30);
      const inAny = Array.isArray(segs) && segs.length > 0 && segs.some(s => {
        const sStart = s.from ? tToMin(s.from) : 0;
        const sEnd = s.until ? tToMin(s.until) : 24*60;
        return startMin >= sStart && endMin <= sEnd;
      });
      if (!inAny) {
        const _br = (data?.branches||[]).find(b => b.id === item.bid);
        const _brName = _br?.name || _br?.short || item.bid;
        alert(`해당 직원이 ${_brName}에서 ${item.time} 시간대에 근무하지 않습니다.\n\n예약은 직원이 활성인 시간대에만 등록 가능합니다.\n(내부일정/청소는 비활성 시간대에도 등록 가능 — 일정 종류를 "내부일정"으로 변경해주세요)`);
        return;
      }
    }
    // 수동 예약에 고유 reservation_id 생성 (NULLS NOT DISTINCT unique constraint 회피)
    if (!item.reservationId) item.reservationId = "manual_" + (item.id || uid());
    // 고객 미연결 + 이름 있으면 자동 신규 등록 (직원이 "신규" 체크 잊어도 누락 방지)
    // — 같은 전화번호 중복은 기존 고객 연결 confirm으로 별도 보호 (아래 dup 체크)
    if (!item.custId && item.custName) {
      const normPhone = (item.custPhone || "").replace(/[^0-9]/g, "");
      // 1) 로컬 캐시 검사
      let dup = normPhone ? (data?.customers||[]).find(c => (c.phone||"").replace(/[^0-9]/g,'') === normPhone) : null;
      // 2) 로컬 없으면 서버 조회 (data.customers가 100건 제한이라 반드시 필요)
      if (!dup && normPhone && normPhone.length >= 8) {
        try {
          const rows = await sb.get("customers", `&business_id=eq.${_activeBizId}&or=(phone.eq.${encodeURIComponent(normPhone)},phone2.eq.${encodeURIComponent(normPhone)})&limit=3`);
          if (Array.isArray(rows) && rows.length > 0) {
            const r0 = rows[0];
            dup = { id: r0.id, name: r0.name, phone: r0.phone, custNum: r0.cust_num };
          }
        } catch(e) { console.warn("[res save] dup phone server check", e); }
      }
      if (dup) {
        const label = `${dup.name}${dup.custNum?` (#${dup.custNum})`:""}`;
        if (!confirm(`동일 번호(${normPhone})로 등록된 고객이 있습니다:\n\n  ${label}\n\n[확인] 기존 고객에 예약 연결\n[취소] 신규 고객으로 새로 등록`)) {
          // 취소 → 신규 고객 생성 허용 (현행 UX 유지)
        } else {
          item.custId = dup.id; item.custName = dup.name; item.isNewCust = false;
        }
      }
      if (!item.custId) {
        const newCustId = "cust_" + uid();
        item.custId = newCustId;
        const newCust = {
          id: newCustId, bid: item.bid, name: item.custName, phone: normPhone,
          gender: item.custGender || "", visits: 0, lastVisit: null, memo: "",
          custNum: ""
        };
        setData(prev => ({ ...prev, customers: [...prev.customers, newCust] }));
        sb.insert("customers", toDb("customers", newCust)).catch(console.error);
      }
    }
    // 숨김 고객 자동 활성화
    if (item.custId) {
      const cust = (data?.customers||[]).find(c=>c.id===item.custId);
      if (cust?.isHidden) {
        sb.update("customers",cust.id,{is_hidden:false}).catch(console.error);
        setData(prev=>({...prev,customers:(prev?.customers||[]).map(c=>c.id===cust.id?{...c,isHidden:false}:c)}));
      }
    }
    const allItems = [];
    const isNewItem = !data?.reservations?.find(r => r.id === item.id);
    const isExistItem = !isNewItem;
    setData(prev => {
      const exists = (prev?.reservations||[]).find(r => r.id === item.id);
      if (exists) {
        // 담당자 변경 시 bid만 연동 (room_id는 실제 방 id만 저장, staff column 합성 ID 사용 안 함)
        if (item.staffId && item.staffId !== exists.staffId) {
          const targetRoom = allRooms.find(r => r.isStaffCol && r.staffId === item.staffId);
          if (targetRoom) {
            item.bid = targetRoom.branch_id;
            // roomId를 빈 값으로 유지 → staffId로만 위치 결정
            if (item.roomId && (item.roomId.startsWith("st_") || item.roomId.startsWith("nv_") || item.roomId.startsWith("blank_"))) {
              item.roomId = "";
            }
          }
        }
        const updateRow = stripStaleNaverFields(toDb("reservations", item));
        sb.update("reservations", item.id, updateRow).catch(console.error);
        return { ...prev, reservations: (prev?.reservations||[]).map(r => r.id === item.id ? item : r) };
      }
      const items = [item];
      if (item.repeat && item.repeat !== "none" && item.repeatUntil) {
        const fmtD = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const start = new Date(item.date + "T12:00:00");
        const end = new Date(item.repeatUntil + "T12:00:00");
        const dayOfWeek = start.getDay();
        const dayOfMonth = start.getDate();
        let cur = new Date(start);
        cur.setDate(cur.getDate() + 1);
        while (cur <= end) {
          let match = false;
          if (item.repeat === "daily") match = true;
          else if (item.repeat === "weekly") match = cur.getDay() === dayOfWeek;
          else if (item.repeat === "monthly") match = cur.getDate() === dayOfMonth;
          if (match) {
            const ds = fmtD(cur);
            const newId = uid();
            // 반복 항목마다 고유 reservation_id 필수 (NULLS NOT DISTINCT unique 회피)
            items.push({ ...item, id: newId, reservationId: "manual_" + newId, date: ds, endDate: ds, repeat: item.repeat, repeatUntil: item.repeatUntil, repeatSourceId: item.id });
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      allItems.push(...items);
      return { ...prev, reservations: [...prev.reservations, ...items] };
    });
    // Async sync to Supabase
    setTimeout(()=>{
      if(allItems.length) sb.upsert("reservations", allItems.map(i=>toDb("reservations", i))).then(() => {
        // 저장 성공 — 개별 항목 재시도 불필요
      }).catch(async err => {
        console.error("예약 저장 실패 (batch):", err, allItems);
        // batch 실패 시 개별 재시도 (reservation_id 충돌 등 한 건만 실패한 경우 대응)
        let successCount = 0;
        const failedItems = [];
        for (const i of allItems) {
          try {
            // reservation_id 재생성 (기존 것과 충돌 회피)
            const newResId = "manual_" + (i.id || uid()) + "_" + Date.now().toString(36);
            const retryRow = toDb("reservations", {...i, reservationId: newResId});
            await sb.upsert("reservations", [retryRow]);
            // 로컬 state에도 새 reservationId 반영
            setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => r.id === i.id ? {...r, reservationId: newResId} : r)}));
            successCount++;
          } catch (e2) {
            console.error("개별 저장 실패:", e2, i);
            failedItems.push(i);
          }
        }
        if (failedItems.length > 0) {
          alert("예약 저장 실패 " + failedItems.length + "건:\n" + (err?.message || "DB 오류").slice(0, 200));
        }
      });
    }, 0);
    // AI 시술 분석 (수동예약 + 시술 미선택 시)
    if (isNewItem && !item.isSchedule && (!item.selectedServices || item.selectedServices.length === 0)) {
      const apiKey = window.__geminiKey || window.__systemGeminiKey;
      if (apiKey && item.custName) {
        const svcList = (data?.services||[]).map(s => s.name).join(", ");
        const prompt = `고객: ${item.custName}\n메모: ${item.memo||""}\n요청사항: ${item.requestMsg||""}\n\n시술 목록: ${svcList}\n\n위 정보로 고객이 받을 시술을 JSON 배열로 반환하세요. 형식: ["시술명1","시술명2"]\n매칭 안 되면 빈 배열 []`;
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1}})
        }).then(r=>r.json()).then(d=>{
          try {
            const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text||"";
            const match = txt.match(/\[.*\]/s);
            if(match) {
              const names = JSON.parse(match[0]);
              if(names.length > 0) {
                const matched = names.map(n => (data?.services||[]).find(s => s.name === n)).filter(Boolean);
                if(matched.length > 0) {
                  const selSvcs = matched.map(s => ({id:s.id, name:s.name, price:s.price_f||s.price_m||0}));
                  sb.update("reservations", item.id, {selected_services: JSON.stringify(selSvcs)}).catch(console.error);
                  setData(prev=>({...prev,reservations:(prev?.reservations||[]).map(r=>r.id===item.id?{...r,selectedServices:selSvcs}:r)}));
                }
              }
            }
          } catch(e) { console.warn("AI 분석:", e); }
        }).catch(console.error);
      }
    }
    // 예약안내 팝업 (내부일정 제외, 010 시작 전화번호만)
    const validPhone = item.custPhone && item.custPhone.startsWith("010");
    if(!item.isSchedule && validPhone && isNewItem) {
      setAlimtalkConfirm({...item, _alimtalkType: "confirm"});
    }
    if(!item.isSchedule && validPhone && isExistItem) {
      // 시간 변경 시에만 알림톡 팝업 (메모/담당자 등 변경은 제외)
      const orig = data?.reservations?.find(r => r.id === item.id);
      if(orig && (orig.date !== item.date || orig.time !== item.time)) {
        setAlimtalkConfirm(item);
      }
    }
    setShowModal(false); setModalData(null);
  };

  // ── Delete with repeat options ──
  const [deletePopup, setDeletePopup] = useState(null);
  const [alimtalkConfirm, setAlimtalkConfirm] = useState(null); // {item} 저장 후 예약안내 발송 여부 팝업

  const handleDeleteRequest = (block) => {
    // + 칼럼 반복 템플릿: 묻지 않고 바로 삭제 (내부일정 템플릿)
    if (block._isColTemplate) {
      // _templateId가 있으면 그것 우선, 없으면 block.id 사용 (기존 데이터 호환)
      const tplId = block._templateId || block.id;
      const next = {...colTemplates};
      Object.keys(next).forEach(bid => { next[bid] = (next[bid]||[]).filter(t => t.id !== tplId); });
      saveColTemplates(next);
      // 모달이 열려 있으면 닫음 (저장 버튼 재클릭 시 재INSERT 방지)
      setShowModal(false);
      setModalData(null);
      return;
    }
    const sourceId = block.repeatSourceId || block.id;
    const hasRepeat = (data.reservations || []).some(r => r.repeatSourceId === sourceId || (r.id === sourceId && r.repeat && r.repeat !== "none"));
    // 내부일정(isSchedule)은 반복이어도 묻지 않고 바로 삭제
    if (hasRepeat && !block.isSchedule) {
      setDeletePopup(block);
    } else {
      handleDelete(block.id);
    }
  };

  // ── 템플릿 드래그 → 직원 컬럼에 일회성 내부일정 생성 ──
  const handleTplDragStart = (tpl, e) => {
    e.stopPropagation();
    const isTouch = e.type === "touchstart";
    if (!isTouch) e.preventDefault();
    const startPt = isTouch ? e.touches[0] : e;
    dragStartRef.current = { x: startPt.clientX, y: startPt.clientY };
    isDragging.current = false;
    longPressActive.current = false;
    const fakeBlock = { id: "__tpl_" + tpl.id, time: tpl.time, dur: tpl.dur||30, isSchedule: true, selectedTags: tpl.selectedTags||[], type: "reservation", custName: tpl.custName };

    // 커서와 블록 상단의 차이를 저장 → 드래그 중 블록이 커서 밑으로 튀지 않게 보정
    const sr0 = scrollRef.current;
    const blockTopY = timeToY(tpl.time);
    let clickOffsetY = 0;
    if (sr0) {
      const rect = sr0.getBoundingClientRect();
      const cursorGridY = (startPt.clientY - rect.top + sr0.scrollTop);
      clickOffsetY = cursorGridY - blockTopY;
    }

    const onDragMove = (ev) => {
      const pt = isTouch ? ev.touches[0] : ev;
      if (!pt) return;
      ev.preventDefault();
      const sr = scrollRef.current; if (!sr) return;
      const rect = sr.getBoundingClientRect();
      const x = pt.clientX - rect.left + sr.scrollLeft;
      const y = pt.clientY - rect.top + sr.scrollTop;
      const colX = x - timeLabelsW;
      // 가변 칼럼 폭 + 지점 간 14px 갭 누적
      const _colWidthOf = (rm) => rm?.isBlockCol ? 36 : colW;
      const _gapBefore = (idx) => (idx > 0 && allRooms[idx-1]?.branch_id !== allRooms[idx]?.branch_id) ? 14 : 0;
      let _cumLeft = 0, roomIdx = -1;
      for (let i = 0; i < allRooms.length; i++) {
        _cumLeft += _gapBefore(i);
        const w = _colWidthOf(allRooms[i]);
        if (colX < _cumLeft + w) { roomIdx = i; break; }
        _cumLeft += w;
      }
      if (roomIdx < 0) {
        roomIdx = allRooms.length - 1;
        _cumLeft = 0;
        for (let i = 0; i < roomIdx; i++) { _cumLeft += _gapBefore(i); _cumLeft += _colWidthOf(allRooms[i]); }
        _cumLeft += _gapBefore(roomIdx);
      }
      const targetRoom = allRooms[roomIdx];
      const gridY = y - clickOffsetY;
      const snappedTime = yToTime(Math.max(0, gridY));
      // 일반 블록 드래그와 동일 공식: 미리보기 viewport 좌표 = 스냅된 그리드 위치
      const blockTopV = (rect.top || 0) + topbarH + headerH + timeToY(snappedTime) - sr.scrollTop;
      const colLeftInScroll = timeLabelsW + _cumLeft;
      const newLeftV = rect.left + colLeftInScroll - sr.scrollLeft + 3;
      setDragPos({
        x: colLeftInScroll - sr.scrollLeft, y: blockTopV - rect.top,
        clientX: newLeftV, clientY: blockTopV,
      });
      setDragSnap({ roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime });
      dragSnapRef.current = { roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime };
    };
    const onDragUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onDragMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onDragUp);
      document.body.style.cursor = "";
      if (isDragging.current && dragSnapRef.current) {
        const snap = dragSnapRef.current;
        const targetRoom = allRooms.find(rm => rm.id === snap.roomId);
        // 유효한 대상이면 (직원 컬럼 / 일반 룸) 일회성 내부일정 생성
        if (targetRoom && !targetRoom.isBlank && !targetRoom.isNaver) {
          const newId = uid();
          const [sh, sm] = snap.time.split(":").map(Number);
          const endMin = sh * 60 + sm + (tpl.dur || 30);
          const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
          const staffId = targetRoom.isStaffCol ? targetRoom.staffId : "";
          const item = {
            id: newId, reservationId: "manual_" + newId,
            type: "reservation", isSchedule: true,
            date: selDate, endDate: selDate,
            time: snap.time, endTime, dur: tpl.dur || 30,
            roomId: targetRoom.isStaffCol ? "" : snap.roomId,
            bid: snap.bid || targetRoom.branch_id,
            staffId, status: "confirmed",
            selectedTags: tpl.selectedTags || [],
            // 소스 템플릿 id 마킹 → 퀵패널에서 그날 숨김
            selectedServices: [`tpl__${tpl.id}`],
            custName: tpl.custName || "", custPhone: "", memo: tpl.memo || "",
            repeat: "none", repeatUntil: null
          };
          setData(prev => ({ ...prev, reservations: [...(prev?.reservations || []), item] }));
          const row = toDb("reservations", item);
          sb.upsert("reservations", [row]).catch(console.error);
        }
      }
      setDragBlock(null); setDragPos(null); setDragSnap(null); dragSnapRef.current = null;
      setTimeout(() => { isDragging.current = false; longPressActive.current = false; }, 300);
    };

    if (isTouch) {
      const cancelMove = ev => { const pt = ev.touches[0]; if (!pt) return; if (Math.abs(pt.clientX - startPt.clientX) + Math.abs(pt.clientY - startPt.clientY) > 8) { clearTimeout(longPressTimer.current); document.removeEventListener("touchmove", cancelMove); document.removeEventListener("touchend", cancelEnd); } };
      const cancelEnd = () => { clearTimeout(longPressTimer.current); document.removeEventListener("touchmove", cancelMove); document.removeEventListener("touchend", cancelEnd); };
      document.addEventListener("touchmove", cancelMove);
      document.addEventListener("touchend", cancelEnd);
      longPressTimer.current = setTimeout(() => {
        document.removeEventListener("touchmove", cancelMove);
        document.removeEventListener("touchend", cancelEnd);
        longPressActive.current = true; isDragging.current = true; document.body.style.cursor="move";
        setDragBlock(fakeBlock);
        try { navigator.vibrate && navigator.vibrate(30); } catch {}
        document.addEventListener("touchmove", onDragMove, {passive:false});
        document.addEventListener("touchend", onDragUp);
      }, 500);
    } else {
      const onMouseMove = (ev) => {
        const dx = ev.clientX - dragStartRef.current.x;
        const dy = ev.clientY - dragStartRef.current.y;
        if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < 12) return;
        if (!isDragging.current) { isDragging.current = true; setDragBlock(fakeBlock); }
        onDragMove(ev);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        onDragUp();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }
  };

  const handleDeleteConfirm = (mode) => {
    if (!deletePopup) return;
    const block = deletePopup;
    const sourceId = block.repeatSourceId || block.id;
    const toDelIds = [];
    const custIdsToCheck = new Set();
    setData(prev => {
      let res = prev.reservations;
      if (mode === "this") {
        toDelIds.push(block.id);
        if (block.custId) custIdsToCheck.add(block.custId);
        res = res.filter(r => r.id !== block.id);
      } else if (mode === "future") {
        res = res.filter(r => {
          if (r.id === block.id) { toDelIds.push(r.id); if (r.custId) custIdsToCheck.add(r.custId); return false; }
          const sameGroup = r.id === sourceId || r.repeatSourceId === sourceId;
          if (sameGroup && r.date >= block.date) { toDelIds.push(r.id); if (r.custId) custIdsToCheck.add(r.custId); return false; }
          return true;
        });
      } else if (mode === "all") {
        res.forEach(r => { if(r.id===sourceId||r.repeatSourceId===sourceId) { toDelIds.push(r.id); if (r.custId) custIdsToCheck.add(r.custId); } });
        res = res.filter(r => r.id !== sourceId && r.repeatSourceId !== sourceId);
      }
      return { ...prev, reservations: res || [] };
    });
    setTimeout(async ()=>{
      await Promise.all(toDelIds.map(id => sb.del("reservations",id).catch(console.error)));
      // 해당 고객들이 더 이상 참조되지 않으면 orphan 고객도 같이 제거
      custIdsToCheck.forEach(cid => cleanupOrphanCust(cid, null));
    }, 0);
    setDeletePopup(null); setShowModal(false); setModalData(null);
  };

  // 예약 삭제 + 해당 고객이 다른 곳에서 참조되지 않으면 고객도 같이 제거 (고스트 고객 방지)
  const cleanupOrphanCust = async (custId, excludeResId) => {
    if (!custId) return;
    try {
      const [sales, pkgs, points, otherRes] = await Promise.all([
        sb.get("sales", `&cust_id=eq.${custId}&limit=1`).catch(()=>[]),
        sb.get("customer_packages", `&customer_id=eq.${custId}&limit=1`).catch(()=>[]),
        sb.get("point_transactions", `&customer_id=eq.${custId}&limit=1`).catch(()=>[]),
        sb.get("reservations", `&cust_id=eq.${custId}&id=neq.${excludeResId||""}&select=id&limit=1`).catch(()=>[]),
      ]);
      if ((sales||[]).length || (pkgs||[]).length || (points||[]).length || (otherRes||[]).length) return;
      await sb.del("customers", custId);
      setData(prev => prev ? {...prev, customers: (prev.customers||[]).filter(c => c.id !== custId)} : prev);
    } catch(e) { console.warn("cleanupOrphanCust failed:", e); }
  };

  const handleDelete = (id) => {
    const res = (data?.reservations||[]).find(r => r.id === id);
    setData(prev => ({ ...prev, reservations: (prev?.reservations||[]).filter(r => r.id !== id) }));
    sb.del("reservations", id).catch(console.error);
    if (res?.custId) cleanupOrphanCust(res.custId, id);
    setShowModal(false); setModalData(null);
  };

  // ── Drag handlers ──
  const timeLabelsW = window.innerWidth <= 768 ? 52 : 88;
  // 타임라인 클릭 시 이동팝업 닫기
  const handleTlClick = () => { if(empMovePopup) setEmpMovePopup(null); };
  const handleDragStart = (block, e) => {
    e.stopPropagation();
    const isTouch = e.type === "touchstart";
    if (!isTouch) e.preventDefault();
    const startPt = isTouch ? e.touches[0] : e;
    dragStartRef.current = { x: startPt.clientX, y: startPt.clientY };
    isDragging.current = false;
    longPressActive.current = false;

    origBlockPos.current = { time: block.time, roomId: block.roomId || naverAssignments[block.id] || null, bid: block.bid, staffId: block.staffId };

    const sr = scrollRef.current;
    const blockTopY = timeToY(block.time);
    let clickOffsetY = 0, clickOffsetX = 0, clickOffsetYView = 0;
    if (sr) {
      const rect = sr.getBoundingClientRect();
      const cursorGridY = (startPt.clientY - rect.top + sr.scrollTop);
      clickOffsetY = cursorGridY - blockTopY;
      // 블록 좌상단의 viewport 좌표 (커서 - 블록좌상단 차이) — floating preview 위치용
      const blockRect = e.currentTarget.getBoundingClientRect?.();
      if (blockRect) {
        clickOffsetX = startPt.clientX - blockRect.left;
        clickOffsetYView = startPt.clientY - blockRect.top;
      }
    }
    // viewport 기준 offset 저장 — floating preview 위치 계산용
    // 스냅 드래그: 블록의 viewport top을 formula로 계산 (DOM 측정 비신뢰 → known sticky 영역 명시)
    const _scrRect = sr ? sr.getBoundingClientRect() : { top: 0 };
    const blockTopV = (_scrRect.top || 0) + topbarH + headerH + timeToY(block.time) - (sr?.scrollTop || 0);
    clickOffsetRef.current = {
      x: clickOffsetX, y: clickOffsetYView, yGrid: clickOffsetY,
      startClientY: startPt.clientY,
      startScrollTop: sr ? sr.scrollTop : 0,
      startScrollLeft: sr ? sr.scrollLeft : 0,
      blockTopV,
      origTimeMin: (() => { const [h,m] = (block.time||"10:00").split(":").map(Number); return h*60+m; })(),
    };

    const getPoint = (ev) => isTouch ? ev.touches[0] : ev;

    const onDragMove = (ev) => {
      const pt = getPoint(ev);
      if (!pt) return;
      ev.preventDefault(); // 드래그 중에만 스크롤 차단
      if (!sr) return;
      const rect = sr.getBoundingClientRect();
      const x = pt.clientX - rect.left + sr.scrollLeft;
      const colX = x - timeLabelsW;
      // 칼럼별 실제 너비 + 지점 간 14px 갭 반영해 누적 left 계산
      const _colWidthOf = (rm) => rm?.isBlockCol ? 36 : colW;
      const _gapBefore = (idx) => (idx > 0 && allRooms[idx-1]?.branch_id !== allRooms[idx]?.branch_id) ? 14 : 0;
      let _cumLeft = 0, roomIdx = -1;
      for (let i = 0; i < allRooms.length; i++) {
        _cumLeft += _gapBefore(i);
        const w = _colWidthOf(allRooms[i]);
        if (colX < _cumLeft + w) { roomIdx = i; break; }
        _cumLeft += w;
      }
      if (roomIdx < 0) {
        roomIdx = allRooms.length - 1;
        _cumLeft = 0;
        for (let i = 0; i < roomIdx; i++) { _cumLeft += _gapBefore(i); _cumLeft += _colWidthOf(allRooms[i]); }
        _cumLeft += _gapBefore(roomIdx);
      }
      // 막기 칼럼 위에 드롭 시도 → 인접 직원/미배정 칼럼으로 보정
      if (allRooms[roomIdx]?.isBlockCol) {
        const next = allRooms[roomIdx + 1];
        const prev = allRooms[roomIdx - 1];
        if (next && !next.isBlockCol) { _cumLeft += _colWidthOf(allRooms[roomIdx]); roomIdx += 1; }
        else if (prev && !prev.isBlockCol) { _cumLeft -= _colWidthOf(prev); roomIdx -= 1; }
      }
      const targetRoom = allRooms[roomIdx];
      // Google Calendar 스타일 — viewport delta 기반 row 단위 스냅
      // ⚠️ 자동 스크롤 시 viewport delta만으론 부족 → 스크롤 델타도 보정
      const cor = clickOffsetRef.current;
      const scrollDeltaY = sr.scrollTop - (cor.startScrollTop ?? sr.scrollTop);
      const dy = (pt.clientY - (cor.startClientY ?? pt.clientY)) + scrollDeltaY;
      const slotsMoved = Math.round(dy / rowH);
      const snappedDy = slotsMoved * rowH;
      // 시간: origTimeMin + 슬롯×timeUnit
      const newTimeMin = (cor.origTimeMin ?? 0) + slotsMoved * timeUnit;
      const clamped = Math.max(startHour * 60, newTimeMin);
      const sh = Math.floor(clamped / 60), sm = Math.max(0, clamped % 60);
      const snappedTime = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
      setDragSnap({ roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime });
      dragSnapRef.current = { roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime };
      // 미리보기 viewport top: blockTopV(드래그 시작) + 스냅Δy - 현재 스크롤 델타
      // (페이지가 스크롤된 만큼 viewport top도 같이 올라감)
      const newTopV = (cor.blockTopV ?? 0) + snappedDy - scrollDeltaY;
      // 누적 left (가변 칼럼 폭 반영)
      const colLeftInScroll = timeLabelsW + _cumLeft;
      const newLeftV = rect.left + colLeftInScroll - sr.scrollLeft + 3;
      setDragPos({
        x: colLeftInScroll - sr.scrollLeft, y: newTopV - rect.top,
        clientX: newLeftV, clientY: newTopV,
      });
      // 자동 스크롤: 모바일은 edgeZone 줄이고 스텝 작게 (위아래 핑퐁 완화)
      const isMobile = window.innerWidth <= 768;
      const edgeZone = isMobile ? 20 : 40;
      const stepY = isMobile ? 4 : 8;
      const stepX = isMobile ? 6 : 12;
      if (pt.clientY - rect.top < edgeZone) sr.scrollTop -= stepY;
      if (rect.bottom - pt.clientY < edgeZone) sr.scrollTop += stepY;
      if (pt.clientX - rect.left < edgeZone) sr.scrollLeft -= stepX;
      if (rect.right - pt.clientX < edgeZone) sr.scrollLeft += stepX;
    };

    const onDragUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onDragMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onDragUp);
      document.body.style.cursor = "";
      if (isDragging.current && dragSnapRef.current) {
        let snap = dragSnapRef.current;
        const orig = origBlockPos.current;
        // + (add) 컬럼에 드롭한 경우 → 같은 지점의 마지막 직원 컬럼으로 스냅 (미배정 방지)
        const snapRoom = allRooms.find(rm => rm.id === snap.roomId);
        if (snapRoom?.isBlank || snapRoom?.isAddCol) {
          const branchStaffCols = allRooms.filter(r => r.branch_id === snap.bid && r.isStaffCol);
          const lastStaff = branchStaffCols[branchStaffCols.length - 1];
          if (lastStaff) {
            snap = { ...snap, roomId: lastStaff.id, bid: lastStaff.branch_id };
            dragSnapRef.current = snap;
          } else {
            // 직원 컬럼이 없으면 이동 취소
            setDragBlock(null); setDragPos(null); setDragSnap(null); dragSnapRef.current = null;
            setTimeout(() => { isDragging.current = false; longPressActive.current = false; }, 300);
            return;
          }
        }
        if (snap.time !== orig.time || snap.roomId !== orig.roomId) {
          // ✨ end_time 우선으로 길이 계산. dur 컬럼이 잘못 저장된 케이스에서도 길이 보존됨.
          const trueDur = blockDurMin(block);
          setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
            if (r.id !== block.id) return r;
            const [sh,sm] = snap.time.split(":").map(Number);
            const endMin = sh*60+sm+trueDur;
            const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
            const toNaverCol = snap.roomId?.startsWith("nv_");
            const targetRoom = allRooms.find(rm => rm.id === snap.roomId);
            const staffUpdate = toNaverCol
              ? { staffId: "", roomId: snap.roomId }
              : targetRoom?.isStaffCol
                ? { staffId: targetRoom.staffId, roomId: snap.roomId }
                : snap.roomId ? { roomId: snap.roomId } : {};
            return {...r, time: snap.time, endTime, dur: trueDur, roomId: snap.roomId||r.roomId, bid: snap.bid||r.bid, ...staffUpdate};
          })}));
          // 이동된 값을 snap 기준으로 직접 계산 (setData는 비동기라 data가 아직 갱신 안 됨)
          const toNaverCol2 = snap.roomId?.startsWith("nv_");
          const targetRoom2 = allRooms.find(rm => rm.id === snap.roomId);
          const movedStaffId = toNaverCol2 ? "" : targetRoom2?.isStaffCol ? targetRoom2.staffId : "";
          const movedRoomId = snap.roomId || "";
          const movedBid = snap.bid || block.bid;
          const [mh,mm] = snap.time.split(":").map(Number);
          const mEndMin = mh*60+mm+trueDur;
          const movedEndTime = `${String(Math.floor(mEndMin/60)).padStart(2,"0")}:${String(mEndMin%60).padStart(2,"0")}`;

          const validPhone = block.custPhone && block.custPhone.startsWith("010");
          const branchChanged = movedBid && movedBid !== block.bid;
          const needsPopup = !block.isSchedule && (
            (validPhone && snap.time !== orig.time) || branchChanged
          );
          if (needsPopup) {
            setPendingChange({ type: "move", block, data: snap, orig, branchChanged });
          } else {
            // dur도 함께 동기화 → DB의 dur과 end_time 정합 유지
            sb.update("reservations", block.id, {
              room_id: movedRoomId, time: snap.time, end_time: movedEndTime, dur: trueDur,
              bid: movedBid, staff_id: movedStaffId || null
            }).catch(console.error);
          }
          // 🆕 자동 네이버 확정: 네이버 pending 예약을 직원 칼럼으로 이동 시 → API로 확정
          (() => {
            // 미배정 → 직원칸 이동 시 자동 reserved 처리
            // - 네이버 예약 (status=pending/request, reservationId 일반): naverConfirmBooking + status=reserved
            // - AI 예약 (status=request, reservationId가 ai*로 시작): API 호출 없이 status=reserved
            const isPending = (block.status === "pending" || block.status === "request") && !(block.memo && block.memo.includes("확정완료"));
            const ridStr = String(block.reservationId || "");
            const isNaverRes = !!block.reservationId && !ridStr.startsWith("ai") && !ridStr.startsWith("manual_");
            const isAiRes = ridStr.startsWith("ai_") || ridStr.startsWith("aibook_") || ridStr.startsWith("ai");
            const movedToStaff = !toNaverCol2 && !!movedStaffId;
            if (!isPending || !movedToStaff) return;
            if (isNaverRes) {
              const targetBranch = (data?.branches||[]).find(b => b.id === movedBid);
              const bizId = targetBranch?.naverBizId;
              if (!bizId) return;
              naverConfirmBooking(bizId, block.reservationId).then(rr => {
                if (rr.ok) {
                  setData(prev => ({...prev, reservations:(prev?.reservations||[]).map(x => x.id === block.id ? {...x, status:'reserved'} : x)}));
                  sb.update("reservations", block.id, {status:'reserved'}).catch(console.error);
                } else {
                  console.warn('[auto naver-confirm] fail:', rr.msg || rr.error);
                }
              });
            } else if (isAiRes) {
              // AI 예약: 외부 API 호출 없이 바로 reserved 변경
              setData(prev => ({...prev, reservations:(prev?.reservations||[]).map(x => x.id === block.id ? {...x, status:'reserved'} : x)}));
              sb.update("reservations", block.id, {status:'reserved'}).catch(console.error);
            }
          })();
        }
      }
      setDragBlock(null); setDragPos(null); setDragSnap(null); dragSnapRef.current = null;
      setTimeout(() => { isDragging.current = false; longPressActive.current = false; }, 300);
    };

    if (isTouch) {
      // 터치: 롱프레스 성공 후에만 document 리스너 등록
      const cancelOnMove = (ev) => {
        const pt = ev.touches[0]; if (!pt) return;
        if (Math.abs(pt.clientX - startPt.clientX) + Math.abs(pt.clientY - startPt.clientY) > 8) {
          clearTimeout(longPressTimer.current);
          document.removeEventListener("touchmove", cancelOnMove);
          document.removeEventListener("touchend", cancelOnEnd);
        }
      };
      const cancelOnEnd = () => {
        clearTimeout(longPressTimer.current);
        document.removeEventListener("touchmove", cancelOnMove);
        document.removeEventListener("touchend", cancelOnEnd);
      };
      document.addEventListener("touchmove", cancelOnMove); // passive(기본) → 스크롤 안 막음
      document.addEventListener("touchend", cancelOnEnd);

      const touchCancel = () => onDragUp();
      longPressTimer.current = setTimeout(() => {
        document.removeEventListener("touchmove", cancelOnMove);
        document.removeEventListener("touchend", cancelOnEnd);
        longPressActive.current = true;
        isDragging.current = true;
        setDragBlock(block);
        // floating preview는 첫 touchmove에서 정확한 위치로 계산되어 표시됨
        // (long-press 시점에 손가락 위치로 초기화하면 블록이 손가락 아래로 점프하는 시각 버그)
        document.body.style.cursor="move";
        try { navigator.vibrate && navigator.vibrate([20, 30, 40]); } catch(ex){}
        // 이제 드래그 리스너 등록 (passive:false → 스크롤 차단)
        document.addEventListener("touchmove", onDragMove, {passive:false});
        document.addEventListener("touchend", onDragUp);
        document.addEventListener("touchcancel", touchCancel);
        window.addEventListener("blur", touchCancel);
      }, 500);
    } else {
      // 마우스: window 사용 + blur 시 강제 종료 (창 밖에서 마우스 놓아도 감지)
      const onMouseMove = (ev) => {
        const dx = ev.clientX - dragStartRef.current.x;
        const dy = ev.clientY - dragStartRef.current.y;
        if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < 12) return;
        if (!isDragging.current) { isDragging.current = true; setDragBlock(block); document.body.style.cursor="move"; }
        onDragMove(ev);
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("blur", onMouseUp);
        onDragUp();
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("blur", onMouseUp);
    }
  };

  // ── Resize handler ──
  const handleResizeStart = (block, e) => {
    e.stopPropagation();
    const isTouch = e.type === "touchstart";
    if (!isTouch) e.preventDefault();
    const startY = isTouch ? e.touches[0].clientY : e.clientY;
    const startDur = block.dur;
    const origDur = block.dur;

    const onResizeMove = (ev) => {
      const pt = isTouch ? ev.touches[0] : ev;
      if (!pt) return;
      if (isTouch) ev.preventDefault();
      const dy = pt.clientY - startY;
      // 5분 단위로 리사이즈 — timeUnit 설정과 무관하게 5분까지 축소 가능
      const dyMin = dy * timeUnit / rowH;
      const durDelta = Math.round(dyMin / 5) * 5;
      const newDur = Math.max(5, startDur + durDelta);
      setResizeDur(newDur);
      resizeDurRef.current = newDur;
    };

    const onResizeUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onResizeMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onResizeUp);
      const finalDur = resizeDurRef.current;
      if (isResizing.current && finalDur !== origDur) {
        const [sh,sm] = block.time.split(":").map(Number);
        const endMin = sh*60+sm+finalDur;
        const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
          if (r.id !== block.id) return r;
          return {...r, dur: finalDur, endTime};
        })}));
        // 내부일정은 팝업 없이 바로 DB 저장
        if (block.isSchedule) {
          sb.update("reservations", block.id, { dur: finalDur, end_time: endTime }).catch(console.error);
        } else {
          setPendingChange({ type: "resize", block, data: { dur: finalDur }, orig: { dur: origDur } });
        }
      }
      setResizeBlock(null); setResizeDur(0);
      setTimeout(() => { isResizing.current = false; longPressActive.current = false; }, 300);
    };

    const beginResize = () => {
      longPressActive.current = true;
      isResizing.current = true;
      setResizeBlock(block);
      setResizeDur(block.dur);
      resizeDurRef.current = block.dur;
      try { navigator.vibrate && navigator.vibrate(30); } catch(ex){}
      document.addEventListener(isTouch ? "touchmove" : "mousemove", onResizeMove, isTouch ? {passive:false} : undefined);
      document.addEventListener(isTouch ? "touchend" : "mouseup", onResizeUp);
    };

    if (isTouch) {
      const cancelOnMove = (ev) => {
        const pt = ev.touches[0]; if (!pt) return;
        if (Math.abs(pt.clientY - startY) > 8) {
          clearTimeout(longPressTimer.current);
          document.removeEventListener("touchmove", cancelOnMove);
          document.removeEventListener("touchend", cancelOnEnd);
        }
      };
      const cancelOnEnd = () => {
        clearTimeout(longPressTimer.current);
        document.removeEventListener("touchmove", cancelOnMove);
        document.removeEventListener("touchend", cancelOnEnd);
      };
      document.addEventListener("touchmove", cancelOnMove);
      document.addEventListener("touchend", cancelOnEnd);
      longPressTimer.current = setTimeout(() => {
        document.removeEventListener("touchmove", cancelOnMove);
        document.removeEventListener("touchend", cancelOnEnd);
        beginResize();
      }, 500);
    } else {
      beginResize();
    }
  };

  // ── 이동/리사이즈 확인/취소 ──
  // empMovePopup 닫기 핸들러는 전체 클릭으로 처리
  const confirmChange = (sendAlimtalkFlag) => {
    if (!pendingChange) return;
    const { type, block, data: d } = pendingChange;
    // 이미 미리보기로 state에 반영됨 → DB만 저장
    if (type === "move") {
      // data state에서 최신 값 읽기 (팝업 후이므로 갱신되어 있음)
      const r = (data?.reservations||[]).find(r => r.id === block.id);
      // d(=snap)에서 직접 계산한 값도 fallback으로 사용
      const targetRoom = allRooms.find(rm => rm.id === d?.roomId);
      const fallbackStaff = targetRoom?.isStaffCol ? targetRoom.staffId : "";
      if (r) {
        const _newTime = r.time || d?.time;
        const _log = block.isSchedule ? null : buildScheduleChangeLog(block.date, block.time, block.date, _newTime);
        // end_time/dur도 함께 저장 (state엔 미리보기로 반영됐지만 DB엔 보내야 함)
        const _trueDur = blockDurMin(r);
        const [_sh,_sm] = _newTime.split(":").map(Number);
        const _eMin = _sh*60+_sm+_trueDur;
        const _endTime = `${String(Math.floor(_eMin/60)).padStart(2,"0")}:${String(_eMin%60).padStart(2,"0")}`;
        const _upd = {
          room_id: r.roomId || d?.roomId || "", time: _newTime, end_time: _endTime, dur: _trueDur,
          bid: r.bid || d?.bid, staff_id: r.staffId || fallbackStaff || null
        };
        // 일정변경 로그는 schedule_log 컬럼에 누적 (memo는 건드리지 않음)
        if (_log) _upd.schedule_log = prependScheduleLog(_log, r.scheduleLog || "");
        sb.update("reservations", block.id, _upd).catch(console.error);
        if (_log) setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(x => x.id===block.id ? {...x, scheduleLog: _upd.schedule_log} : x)}));
      }
    }
    if (type === "resize") {
      const r = (data?.reservations||[]).find(r => r.id === block.id);
      if (r) sb.update("reservations", block.id, {
        dur: r.dur
      }).catch(console.error);
    }
    // 예약안내 발송
    if (sendAlimtalkFlag && block.custPhone && !block.isSchedule) {
      try {
        const r = (data?.reservations||[]).find(rv => rv.id === block.id);
        const branch = (data?.branches||[]).find(b => b.id === (r?.bid || block.bid));
        const rsvUrlId = (r?.reservationId) || block.id || "";
        const rsvUrl = rsvUrlId ? "https://blissme.ai/r.html?"+encodeURIComponent(rsvUrlId) : "";
        queueAlimtalk(branch?.id, "rsv_change", block.custPhone, {
          "#{사용자명}":branch?.name||"", "#{날짜}":r?.date||block.date||"", "#{시간}":r?.time||block.time||"",
          "#{작업자}":r?.worker||"", "#{작업장소}":branch?.name||"",
          "#{대표전화번호}":branch?.phone||"", "#{예약URL}":rsvUrl
        });
      } catch(e) { console.warn("예약안내 변경:", e); }
    }
    setPendingChange(null);
  };
  const cancelChange = () => {
    if (!pendingChange) return;
    const { type, block, orig } = pendingChange;
    // 원래 위치로 복원
    if (type === "move") {
      setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
        if (r.id !== block.id) return r;
        const [sh,sm] = orig.time.split(":").map(Number);
        const trueDur = blockDurMin(block);
        const endMin = sh*60+sm+trueDur;
        const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        return {...r, time: orig.time, endTime, dur: trueDur, roomId: orig.roomId || "", bid: orig.bid, staffId: orig.staffId || r.staffId};
      })}));
    }
    if (type === "resize") {
      setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
        if (r.id !== block.id) return r;
        const [sh,sm] = r.time.split(":").map(Number);
        const endMin = sh*60+sm+orig.dur;
        const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        return {...r, dur: orig.dur, endTime};
      })}));
    }
    setPendingChange(null);
  };

  const changeDate = (off) => { const d = new Date(selDate); d.setDate(d.getDate()+off); setSelDate(fmtLocal(d)); };

  // Scroll to current time on mount (or restore saved scroll if returning from another page)
  useEffect(() => {
    if (!scrollRef.current) return;
    // 첫 마운트 시 저장된 스크롤 위치가 있고 같은 날짜면 복원
    if (!didRestoreScrollRef.current) {
      didRestoreScrollRef.current = true;
      if (_savedScroll && _savedScroll.date === selDate) {
        const top = _savedScroll.top, left = _savedScroll.left;
        // 레이아웃 계산이 끝난 다음 프레임에 복원 (DOM 측정 안정화 후)
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = top;
            scrollRef.current.scrollLeft = left;
          }
        });
        return;
      }
    }
    if (selDate === todayStr()) {
      // 당일: 현재 시간 위치로 스크롤
      const now = new Date();
      const y = timeToY(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`);
      const gridTop = (window.innerWidth<=768?42:0) + topbarH + headerH;
      scrollRef.current.scrollTop = Math.max(0, gridTop + y - 200);
    } else {
      // 다른 날: 맨 위
      scrollRef.current.scrollTop = 0;
    }
  }, [selDate]);

  // 스크롤 위치 저장 (페이지 이동 후 돌아왔을 때 복원용)
  // 주의: 리스너에서 동기적으로 저장. 언마운트 시점엔 sr.scrollTop이 0으로 리셋될 수 있어
  // cleanup에서 저장하면 안 됨.
  useEffect(() => {
    const sr = scrollRef.current;
    if (!sr) return;
    let tm = null;
    const onScroll = () => {
      _savedScroll = { top: sr.scrollTop, left: sr.scrollLeft, date: selDate };
      if (tm) clearTimeout(tm);
      tm = setTimeout(() => _scrollSave(_savedScroll), 200);
    };
    sr.addEventListener('scroll', onScroll, { passive: true });
    return () => { sr.removeEventListener('scroll', onScroll); if (tm) clearTimeout(tm); };
  }, [selDate]);

  // Prevent iOS viewport bounce
  useEffect(() => {
    document.body.style.position = 'fixed';
    document.body.style.inset = '0';
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.position = ''; document.body.style.inset = ''; document.body.style.overflow = ''; };
  }, []);

  // Measure topbar height for sticky offset
  useEffect(() => {
    if (!topbarRef.current) return;
    const measure = () => { if(topbarRef.current) setTopbarH(topbarRef.current.offsetHeight); };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(topbarRef.current);
    return () => ro.disconnect();
  }, []);

  // Current time line (updates every minute)
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60000); return () => clearInterval(t); }, []);
  // Auto-fix: memo에 "확정완료"가 있는데 status가 pending인 예약 자동 reserved 처리
  // (confirmed=진행은 유저가 수동 변경, 여기선 예약중 상태까지만 승급)
  useEffect(() => {
    if (!data?.reservations) return;
    const mismatched = (data?.reservations||[]).filter(r => r.status === "pending" && r.memo && r.memo.includes("확정완료"));
    if (mismatched.length === 0) return;
    mismatched.forEach(r => {
      sb.update("reservations", r.id, {status: "reserved"}).then(() => console.log(`Auto-reserved: ${r.id} (memo has 확정완료)`));
    });
    setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => mismatched.some(m => m.id === r.id) ? {...r, status: "reserved"} : r)}));
  }, [data?.reservations?.filter(r => r.status === "pending").length]);
  const now = new Date(nowTick);
  const nowY = (selDate === todayStr() && now.getHours() >= startHour && now.getHours() < effectiveEndHour) ? timeToY(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`) : -1;

  // Date helpers
  const DAYS_KR = ["일","월","화","수","목","금","토"];
  const sd = new Date(selDate);
  const dateLabel = `${String(sd.getMonth()+1).padStart(2,"0")}월 ${String(sd.getDate()).padStart(2,"0")}일 (${DAYS_KR[sd.getDay()]})`;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
      {/* 모바일 롱프레스 시 텍스트 선택/콜아웃 메뉴 차단 (드래그 UX 보호) */}
      <style>{`
        .tl-block, .tl-block *, .tl-room-col, .tl-room-col * {
          -webkit-touch-callout: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
          user-select: none !important;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
      {/* 스크래퍼 상태 경고 배너 */}
      {scraperStatus?.isWarning && isMaster && (() => {
        const fmtAgo = (diffH) => {
          const h = Math.floor(diffH);
          const m = Math.floor((diffH - h) * 60);
          return h > 0 ? `${h}시간 ${m}분 전` : `${m}분 전`;
        };
        const lastScrapedStr = scraperStatus.lastScraped
          ? fmtAgo(scraperStatus.scrapedDiffH)
          : "기록 없음";
        const msg = scraperStatus.isSessionDead
          ? "네이버 세션 만료 — 새 예약이 앱에 반영되지 않아요"
          : `마지막 스크래핑: ${lastScrapedStr} — 12시간 이상 동기화 안 됨`;
        return <div style={{background:"#fff3e0",borderBottom:"2px solid #FF6D00",padding:"8px 14px",display:"flex",alignItems:"center",gap:8,flexShrink:0,width:"100%",boxSizing:"border-box"}}>
          <span style={{fontSize:18}}>⚠️</span>
          <div style={{flex:1,minWidth:0}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#E65100"}}>네이버 스크래핑 경고</span>
            <span style={{fontSize:T.fs.xxs,color:"#BF360C",marginLeft:8}}>{msg}</span>
          </div>
          <span style={{fontSize:T.fs.xxs,color:"#E65100",fontWeight:T.fw.bolder,flexShrink:0,whiteSpace:"nowrap"}}>login_local.py 실행 필요</span>
        </div>;
      })()}
      {/* Unanswered Messages Alert — 확정대기 배너 스타일 통일 */}
      {unreadMsgCount > 0 && (()=>{
        const CH_NAME = {naver:"네이버",kakao:"카톡",instagram:"인스타",whatsapp:"왓츠앱",telegram:"텔레"};
        // account_id → 지점명 매핑 (네이버는 naverAccountId, 인스타는 instagramAccountId)
        const acc2branch = {};
        (data?.branches||[]).forEach(b=>{
          if(b.naverAccountId) acc2branch[String(b.naverAccountId)] = b.short||b.name;
          if(b.instagramAccountId) acc2branch[String(b.instagramAccountId)] = b.short||b.name;
        });
        // IG override 매핑 반영
        try {
          const s = typeof data?.businesses?.[0]?.settings==='string'?JSON.parse(data.businesses[0].settings):(data?.businesses?.[0]?.settings||{});
          const ig_override = s?.ig_branch_override||{};
          Object.entries(ig_override).forEach(([igId,bid])=>{
            const br=(data?.branches||[]).find(b=>b.id===bid);
            if(br) acc2branch[String(igId)] = br.short||br.name;
          });
        } catch {}
        const preview = (unreadSample||[]).slice(0,3).map(m => {
          const who = m.user_name || (m.user_id ? m.user_id.slice(0,10) : "고객");
          const txt = (m.message_text || "").replace(/\s+/g," ").slice(0,18);
          // 왓츠앱은 전지점 공통이라 지점명 생략
          const br = m.channel==="whatsapp" ? "" : (acc2branch[String(m.account_id)] || "");
          const brPart = br ? ` ${br} · ` : " ";
          return `[${CH_NAME[m.channel]||m.channel||"?"}]${brPart}${who}: ${txt}`;
        }).join(" / ");
        return <div style={{background:"#E0F2FE",borderBottom:"1px solid #7DD3FC",padding:"6px 12px",display:"flex",alignItems:"center",gap:T.sp.sm,flexShrink:0,cursor:"pointer",width:"100%",boxSizing:"border-box"}}
          onClick={()=>setPage&&setPage("messages")}>
          <span style={{fontSize:T.fs.xl}}>💬</span>
          <div style={{flex:1,minWidth:0}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#0369A1"}}>답변 안 한 메시지 {unreadMsgCount}건</span>
            <span style={{fontSize:T.fs.xxs,color:"#0369A1",marginLeft:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{preview}{unreadMsgCount>3?` 외 ${unreadMsgCount-3}건`:""}</span>
          </div>
          <span style={{fontSize:T.fs.xxs,color:"#0369A1",fontWeight:T.fw.bold,flexShrink:0}}>확인 <I name="chevR" size={11} color="#0369A1"/></span>
        </div>;
      })()}
      {/* Pending Reservations Alert - OUTSIDE scroll, always visible */}
      {(() => {
        const pendingList = (data?.reservations||[]).filter(r => (r.status === "pending" || r.status === "request") && (isMaster ? branchesToShow : allBranchList.filter(b => userBranches.includes(b.id))).some(b => b.id === r.bid) && !(r.memo && r.memo.includes("확정완료")));
        if (pendingList.length === 0) return null;
        return <div style={{background:T.orangeLt,borderBottom:"1px solid #FFB74D",padding:"6px 12px",display:"flex",alignItems:"center",gap:T.sp.sm,flexShrink:0,cursor:"pointer",animation:"pendingBlink 2s infinite",width:"100%",boxSizing:"border-box"}}
          onClick={()=>{
            if (pendingList.length === 0) return;
            const idx = pendingClickIdx.current % pendingList.length;
            const target = pendingList[idx];
            pendingClickIdx.current = idx + 1;
            setSelDate(target.date);
            // 🔴 클릭한 예약 빨강 테두리 깜빡임 (모달 안 열고 하이라이트만)
            const _rid = target.reservationId || target.id;
            if (_rid) setHighlightedBlockId(_rid);
            setTimeout(()=>{
              if(!scrollRef.current) return;
              const rid = target.reservationId || target.id;
              const el = scrollRef.current.querySelector(`[data-rid="${rid}"]`);
              if (el) {
                const rect = el.getBoundingClientRect();
                const sr = scrollRef.current;
                const srRect = sr.getBoundingClientRect();
                const elTop = rect.top - srRect.top + sr.scrollTop;
                const elLeft = rect.left - srRect.left + sr.scrollLeft;
                const stickyH = topbarH + headerH;
                const stickyW = window.innerWidth <= 768 ? 52 : 88;
                const visibleH = sr.clientHeight - stickyH;
                const visibleW = sr.clientWidth - stickyW;
                sr.scrollTo({
                  top: Math.max(0, elTop - stickyH - visibleH / 2 + rect.height / 2),
                  left: Math.max(0, elLeft - stickyW - visibleW / 2 + rect.width / 2),
                  behavior: "smooth"
                });
              }
            }, 300);
          }}>
          <span style={{fontSize:T.fs.xl}}><I name="bell" size={18} color={T.orange}/></span>
          <div style={{flex:1,minWidth:0}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>{pendingList.some(r=>r.status==="request")?"AI 예약신청":"확정대기"} {pendingList.length}건</span>
            <span style={{fontSize:T.fs.xxs,color:T.orange,marginLeft:8}}>
              {pendingList.slice(0,3).map(r => {
                const br = allBranchList.find(b=>b.id===r.bid);
                return `${br?.short||br?.name||""} ${r.custName||"네이버"} ${r.date.slice(5)}`;
              }).join(" · ")}
              {pendingList.length > 3 ? ` 외 ${pendingList.length-3}건` : ""}
            </span>
          </div>
          <span style={{fontSize:T.fs.xxs,color:T.orange,fontWeight:T.fw.bold,flexShrink:0}}>확인 <I name="chevR" size={11} color={T.orange}/></span>
          {(() => {
            // 네이버 예약(source=naver + pending)인 경우만 "✓ 네이버 확정" 버튼 노출 (API 호출)
            const naverPending = pendingList.find(r => (r.source==="naver"||r.source==="네이버") && r.status==="pending");
            if (!naverPending) return null;
            const br = allBranchList.find(b=>b.id===naverPending.bid);
            const bizId = br?.naverBizId;
            const resId = naverPending?.reservationId;
            if (!bizId || !resId) return null;
            const onConfirm = async (e) => {
              e.stopPropagation();
              const btn = e.currentTarget; const orig = btn.textContent;
              btn.textContent = '확정 중…'; btn.disabled = true;
              const r = await naverConfirmBooking(bizId, resId);
              if (r.ok) {
                btn.textContent = '✓ 완료';
                // 로컬 상태 reserved로 즉시 반영
                setData(p => ({...p, reservations: (p.reservations||[]).map(x => x.id === naverPending.id ? {...x, status:'reserved'} : x)}));
              } else {
                btn.textContent = orig; btn.disabled = false;
                alert('네이버 확정 실패: ' + (r.msg || r.error || ''));
              }
            };
            return <button onClick={onConfirm}
              style={{fontSize:T.fs.xxs,color:T.bgCard,fontWeight:T.fw.bolder,background:T.naver,padding:"4px 10px",borderRadius:T.radius.md,border:'none',cursor:'pointer',flexShrink:0,whiteSpace:"nowrap",fontFamily:'inherit'}}>✓ 네이버 확정</button>;
          })()}
        </div>;
      })()}
      {/* Single scroll container */}
      <div ref={scrollRef} className="timeline-scroll" style={{flex:1,overflow:"auto",minHeight:0,overscrollBehavior:"none",paddingBottom:200}}>

        {/* Top Bar - sticky */}
        <div ref={topbarRef} className="tl-topbar" style={{position:"sticky",top:0,left:0,zIndex:30,borderBottom:"none",boxShadow:"0 4px 8px -2px rgba(0,0,0,0.12)",background:T.bgCard,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",minWidth:"100%",boxSizing:"border-box",overflow:"visible"}}>
        {/* Row 1: Date nav + settings + branch */}
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,flexWrap:"wrap",maxWidth:"100%"}}>
          <button onClick={()=>changeDate(-1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:T.fs.sm,color:T.gray600,padding:"2px 4px",flexShrink:0}}><I name="chevL" size={14}/></button>
          <span className="tl-date-label" onClick={()=>setShowCal(!showCal)} style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,flexShrink:0,whiteSpace:"nowrap",cursor:"pointer"}}>{dateLabel}</span>
          <div style={{position:"relative",flexShrink:0}}>
            
            {showCal && <MiniCal selDate={selDate} onSelect={d=>{setSelDate(d);setShowCal(false);}} onClose={()=>setShowCal(false)}/>}
          </div>
          <button onClick={()=>changeDate(1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:T.fs.sm,color:T.gray600,padding:"2px 4px",flexShrink:0}}><I name="chevR" size={14}/></button>
          <button onClick={()=>setSelDate(todayStr())} style={{padding:"0 10px",height:32,fontSize:T.fs.sm,border:"1px solid #d0d0d0",borderRadius:T.radius.md,background:T.bgCard,color:T.gray600,cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}} className="hide-mobile">오늘</button>
          <button onClick={()=>setShowQuickBook(true)} style={{padding:"0 12px",height:32,fontSize:T.fs.sm,border:"none",borderRadius:T.radius.xl,background:"linear-gradient(135deg,#4285f4,#9b72cb,#d96570)",color:T.bgCard,cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center",gap:5,fontWeight:T.fw.bolder,boxShadow:"0 2px 8px rgba(66,133,244,.25)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={T.bgCard} style={{flexShrink:0}}><path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z"/></svg> AI Book
          </button>
          <div style={{marginLeft:"auto",position:"relative",flexShrink:0}} ref={el => { if(el) el._settingsBtn = el; }}>
            <button onClick={(e)=>{const next=!showSettings;setShowSettings(next);if(next&&scrollRef.current)scrollRef.current.scrollLeft=0;}} id="settings-btn"
              style={{height:32,padding:"0 12px",border:"none",borderRadius:T.radius.md,background:"transparent",
                cursor:"pointer",background:showSettings?T.primaryLt:"none",border:showSettings?"1px solid "+T.primary:"1px solid transparent",borderRadius:T.radius.md,padding:"4px 6px",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="settings" size={17} color={showSettings?T.primary:T.gray500}/></button>
          </div>
          
        </div>
        {/* Row 2 (mobile) / inline (desktop): 7-day buttons */}
        <div className="tl-days" style={{display:"flex",gap:2,alignItems:"center"}}>
          {Array.from({length:7},(_,i)=>{
            const dt = new Date(); dt.setDate(dt.getDate()+i);
            const ds = fmtLocal(dt);
            const dow = dt.getDay();
            const isSel = ds === selDate;
            const dayColor = dow===0?T.female:dow===6?T.male:T.gray700;
            return <button key={i} onClick={()=>setSelDate(ds)}
              style={{minWidth:42,height:32,borderRadius:T.radius.md,border:isSel?"none":"1px solid #e8e8e8",
                background:isSel?T.primary:T.bgCard,color:isSel?T.bgCard:dayColor,
                fontSize:T.fs.sm,fontWeight:isSel?700:500,cursor:"pointer",fontFamily:"inherit",padding:"2px 4px",flexShrink:0,
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",lineHeight:1.1}}>
              <span style={{fontSize:T.fs.sm}}>{DAYS_KR[dow]}</span>
              <span>{dt.getDate()}</span>
            </button>;
          })}
        </div>
        {/* 📣 팀채팅 공지 말풍선 — 7-day 버튼 오른쪽 빈 공간에 배치 */}
        <TopAnnounceBubble/>
      </div>



        {/* Timeline Grid */}
        <div style={{display:"flex",minWidth:"fit-content",position:"relative"}} onClick={handleTlClick}>
          {/* Time Labels */}
          <div className="tl-time-col" style={{width:timeLabelsW,flexShrink:0,position:"sticky",left:0,zIndex:20,background:T.bgCard,borderRight:"1px solid #eee"}}>
            <div style={{height:headerH,borderBottom:"1px solid #eee",position:"sticky",top:topbarH,zIndex:25,background:T.bgCard}}/>
            <div style={{position:"relative",height:totalRows*rowH,boxShadow:"0 4px 8px -2px rgba(0,0,0,0.12)",...gridBg}}>
              {!dragBlock && hoverCell && hoverCell.rowIdx>=0 && <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.08)",zIndex:1,pointerEvents:"none"}}/>}
              {timeLabels.map(({i, isHour, m, text}) => {
                const isHighlighted = hoverCell && hoverCell.rowIdx === i;
                const slotMin = startHour*60 + i*5;
                const slotTime = `${String(Math.floor(slotMin/60)).padStart(2,"0")}:${String(slotMin%60).padStart(2,"0")}`;
                // 이 슬롯에 해당하는 알람 (사용자가 보는 첫 지점 기준)
                const targetBid = userBranches?.[0] || branchesToShow?.[0]?.id;
                const slotAlarms = targetBid ? getActiveAlarmsForBranch(targetBid, selDate).filter(a => a.time === slotTime) : [];
                return <div key={i} className="tl-time-cell"
                  onClick={()=>{
                    if (!targetBid) return;
                    if (slotAlarms.length > 0) {
                      // 기존 알람 편집
                      setAlarmModal({ branchId: targetBid, time: slotTime, editing: slotAlarms[0] });
                    } else {
                      // 새 알람 생성
                      setAlarmModal({ branchId: targetBid, time: slotTime });
                    }
                  }}
                  style={{position:"absolute",top:i*rowH,left:0,right:0,height:rowH,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:window.innerWidth<=768?3:6,cursor:"pointer"}}>
                  {slotAlarms.length > 0 && <span
                    onClick={(e)=>e.stopPropagation()}
                    onMouseDown={(e)=>{
                      e.stopPropagation();
                      _alarmPressRef.current = {alarm:slotAlarms[0], branchId:targetBid, startY:e.clientY, startX:e.clientX, dragStarted:false};
                    }}
                    onTouchStart={(e)=>{
                      e.stopPropagation();
                      const t = e.touches[0];
                      _alarmPressRef.current = {alarm:slotAlarms[0], branchId:targetBid, startY:t.clientY, startX:t.clientX, dragStarted:false};
                    }}
                    style={{position:"absolute",left:2,top:0,bottom:0,display:"flex",alignItems:"center",gap:2,fontSize:9,background:alarmDrag?.alarm?.id===slotAlarms[0].id?"#FDE68A":"#FEF3C7",color:"#92400E",padding:"0 4px",borderRadius:3,border:"1px solid #FBBF24",maxWidth:timeLabelsW-24,overflow:"hidden",whiteSpace:"nowrap",zIndex:2,cursor:"grab",userSelect:"none"}} title={`${slotAlarms[0].title} (클릭 편집 / 드래그 이동)`}>🔔{slotAlarms[0].title?.slice(0,4)||""}</span>}
                  <span style={{fontSize:isHour?(window.innerWidth<=768?10:11):(window.innerWidth<=768?8:9),fontWeight:isHighlighted?700:(isHour?600:400),color:isHighlighted?T.primary:(isHour?T.gray700:T.gray500),whiteSpace:"nowrap",lineHeight:1,transition:"color 0.1s"}}>{text}</span>
                </div>;
              })}
              {/* 알람 드래그 중: 타겟 슬롯 ghost */}
              {alarmDrag && alarmDrag.targetTime && (()=>{
                const [h,m] = alarmDrag.targetTime.split(":").map(Number);
                const rowIdx = (h*60+m - startHour*60)/5;
                if (rowIdx < 0 || rowIdx >= totalRows) return null;
                return <div style={{position:"absolute",top:rowIdx*rowH,left:0,right:0,height:rowH,background:"#FBBF2440",border:"1.5px dashed #F59E0B",zIndex:4,pointerEvents:"none"}}/>;
              })()}
              {nowY > 0 && <div style={{position:"absolute",top:nowY-9,left:0,right:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:6,pointerEvents:"none"}}>
                <span style={{fontSize:T.fs.xs,fontWeight:T.fw.black,color:T.danger,background:T.bgCard,padding:"1px 3px",borderRadius:T.radius.sm,lineHeight:1}}>
                  {(now.getHours()>12?now.getHours()-12:now.getHours()||12)}:{String(now.getMinutes()).padStart(2,"0")}
                </span>
              </div>}
            </div>
          </div>

          {/* Room Columns */}
          {allRooms.map((room, ci) => {
            const roomBlocks = (() => {
              // + 칼럼: 매일 반복 템플릿 (schedule_data.colTemplates_v1)만 표시
              // 오늘 이 템플릿을 직원 칼럼으로 드래그해 처리한 경우 해당 템플릿은 숨김
              if (room.isBlank && room.isAddCol) {
                const tpls = colTemplates[room.branch_id] || [];
                const doneTplIds = new Set(
                  (data?.reservations || [])
                    .filter(r => r.date === selDate && r.bid === room.branch_id && Array.isArray(r.selectedServices))
                    .flatMap(r => r.selectedServices.filter(s => typeof s === 'string' && s.startsWith('tpl__')).map(s => s.slice(5)))
                );
                return tpls.filter(t => !doneTplIds.has(t.id)).map(t => ({
                  id: t.id,
                  _isColTemplate: true,
                  time: t.time,
                  dur: t.dur,
                  bid: room.branch_id,
                  roomId: room.id,
                  type: "reservation",
                  isSchedule: true,
                  selectedTags: t.tagIds || [],
                  memo: t.memo || "",
                  custName: t.name,
                  status: "confirmed"
                }));
              }
              return blocks.filter(b => {
                // 막기 칼럼은 어떤 예약/내부일정도 표시 X (네이버 막기 전용 칼럼)
                if (room.isBlockCol) return false;
                if (room.isNaver) {
                  // 미배정 칼럼: roomId/staffId 없는 예약
                  if (!isUnassigned(b) || b.bid !== room.branch_id) return false;
                  return naverAssignments[b.id] === room.id;
                }
                if (room.isStaffCol) {
                  // 직원 컬럼: staffId 일치 또는 roomId가 해당 staff col id
                  if (b.bid !== room.branch_id) return false;
                  // 미배정 예약은 미배정 칼럼에 표시 (미배정 칼럼이 있으면)
                  if (isUnassigned(b) && allRooms.some(r => r.isNaver && r.branch_id === b.bid)) return false;
                  if (b.staffId && b.staffId === room.staffId) return true;
                  if (b.roomId === room.id) return true;
                  return false;
                }
                // 일반 룸 칼럼: roomId 기준
                return b.roomId === room.id;
              });
            })();
            const isNewBranch = ci === 0 || room.branch_id !== allRooms[ci-1]?.branch_id;
            // 첫 컬럼에만 지점 앵커 텍스트 (구분선은 제거 — 지점명 배지로 충분)
            const isFirstOfBranch = room._isFirstOfBranch || (ci === 0 || allRooms[ci-1]?.branch_id !== room.branch_id);
            // 각 지점 첫 미배정 칼럼은 연두색 배경 (구분 강조)
            const isFirstNaverOfBranch = room.isNaver && room._naverIdx === 0;
            const colBg = room.isBlockCol ? '#E8F5E9' : (isFirstNaverOfBranch ? '#E8F5E9' : SOFT_BG);
            const _colWidth = room.isBlockCol ? 36 : colW;
            return (
              <div key={room.id} className="tl-room-col" data-branch-id={room.branch_id} style={(()=>{
                const isLastOfBranch = ci === allRooms.length-1 || allRooms[ci+1]?.branch_id !== room.branch_id;
                // 지점 박스: 좌·상은 굵은 보더 (지점 시작 컬럼만 좌측 테두리). 같은 지점 내부는 얇은 회색 보더로 컬럼 구분
                return {
                  width:_colWidth,flexShrink:0,
                  // 지점 사이 세로선 제거 — 그림자(우측) + marginLeft(좌측) 갭으로만 구분
                  borderLeft: isFirstOfBranch ? "none" : "1px solid #f0f0f0",
                  borderRight: "none",
                  // 컬럼 자체 borderTop 제거 — sticky 헤더의 1.5px 라인만 사용 (스크롤·상단 동일 굵기)
                  borderTop: "none",
                  borderBottom: "none",
                  background:colBg,
                  marginLeft: isFirstOfBranch && ci>0 ? 14 : 0,
                  // 지점 박스 마지막 칼럼 우측에 그림자 — 지점 구분 입체감
                  boxShadow: isLastOfBranch ? "4px 0 8px -2px rgba(0,0,0,0.18)" : "none",
                  position:"relative"
                };
              })()}>
                {/* 이동/지원 직원: 휴무 스타일 오버레이 (배경만, 블록 클릭은 허용) */}
                {room.isMovedOut && <div style={{position:"absolute",top:headerH,left:0,right:0,bottom:0,background:"rgba(0,0,0,.06)",borderTop:"2px dashed rgba(0,0,0,.12)",zIndex:1,pointerEvents:"none"}}/>}
                {/* Room Header - sticky. 지점명은 첫 컬럼에만 앵커로 (D안) */}
                <div style={{height:headerH,borderTop:"1px solid "+T.border,borderBottom:"1px solid #eee",position:"sticky",top:topbarH,zIndex:10,background:colBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:4,lineHeight:1.2}}>
                  {isFirstOfBranch && (
                    <span style={{position:"absolute",top:2,left:0,right:0,textAlign:"center",fontSize:14,fontWeight:800,color:T.text,letterSpacing:0,pointerEvents:"none",zIndex:2}}>
                      {room.branchName}
                    </span>
                  )}
                  {room.isBlank ? (
                    room.isAddCol ? (
                      <div style={{position:"relative"}}>
                        <span className="tl-room-sub" style={{fontSize:18,color:T.primary,cursor:"pointer",fontWeight:900,userSelect:"none"}}
                          onClick={e=>{e.stopPropagation();setAddStaffPopup(p=>p?.branchId===room.branch_id?null:{branchId:room.branch_id,x:e.clientX,y:e.clientY});}}>
                          +
                        </span>
                        {addStaffPopup?.branchId===room.branch_id && (<>
                          <div style={{position:"fixed",inset:0,zIndex:9998}} onClick={e=>{e.stopPropagation();setAddStaffPopup(null);}}/>
                          <div onClick={e=>e.stopPropagation()} style={{position:"fixed",left:Math.min(addStaffPopup.x,window.innerWidth-220),top:addStaffPopup.y+8,background:T.bgCard,borderRadius:12,boxShadow:"0 4px 24px rgba(0,0,0,.22)",zIndex:9999,padding:"8px 0",minWidth:200,maxHeight:300,overflowY:"auto"}}>
                            <div style={{fontSize:11,color:T.textMuted,padding:"0 12px 6px",fontWeight:700,borderBottom:"1px solid "+T.border}}>직원 추가 (당일)</div>
                            {!addStaffPopup?.selectedEmp && <div style={{padding:"6px 12px",borderBottom:"1px solid "+T.border,background:T.infoLt}}>
                              <button onClick={(e)=>{e.stopPropagation();addExtraCol(room.branch_id);setAddStaffPopup(null);}}
                                style={{width:"100%",padding:"7px 8px",fontSize:11,fontWeight:700,border:`1px solid ${T.info}`,borderRadius:7,background:T.bgCard,color:T.info,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                                🆕 빈 미배정 칼럼 추가
                              </button>
                              <div style={{fontSize:9,color:T.textMuted,marginTop:4,lineHeight:1.4}}>
                                선예약 등 담당자 미정 예약을 달아둘 용도. 이 날짜에만 추가되며, 직원 없이 예약만 받을 수 있어요.
                              </div>
                            </div>}
                            {addStaffPopup?.selectedEmp ? null : BASE_EMP_LIST.filter(e => {
                              // 이 지점에 아직 없는 직원만 — 휴무자도 표시 (배지로 구분)
                              const already = allRooms.some(r => r.isStaffCol && r.branch_id === room.branch_id && r.staffId === e.id);
                              return !already;
                            }).map(e => {
                              const empBase = BASE_EMP_LIST.find(b=>b.id===e.id);
                              const baseBr = (data?.branches||[]).find(b=>b.id===empBase?.branch_id);
                              const daySt = schHistory?.[e.id]?.[selDate] || "";
                              const isOff = daySt === "휴무" || daySt === "휴무(꼭)" || daySt === "무급";
                              return <div key={e.id} onClick={()=>{
                                setAddStaffPopup(p=>({...p, selectedEmp:e.id, selectedBranch:room.branch_id, wasOff: isOff}));
                              }} style={{padding:"6px 12px",cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #f5f5f5",opacity:isOff?0.6:1}}
                                onMouseOver={e2=>e2.currentTarget.style.background=T.gray100}
                                onMouseOut={e2=>e2.currentTarget.style.background=""}>
                                <span style={{display:"flex",alignItems:"center",gap:4}}>
                                  <span style={{fontWeight:600,color:isOff?T.textMuted:T.text}}>{e.id}</span>
                                  {isOff && <span style={{fontSize:9,background:T.gray200,color:T.danger,borderRadius:3,padding:"1px 5px",fontWeight:700}}>휴무</span>}
                                </span>
                                <span style={{fontSize:10,color:T.textMuted}}>{baseBr?.short||""}</span>
                              </div>;
                            })}
                            {!addStaffPopup?.selectedEmp && BASE_EMP_LIST.filter(e => !allRooms.some(r => r.isStaffCol && r.branch_id === room.branch_id && r.staffId === e.id)).length === 0 &&
                              <div style={{padding:"8px 12px",fontSize:11,color:T.textMuted}}>추가 가능한 직원 없음</div>}
                            {/* 프리랜서 추가 */}
                            {!addStaffPopup?.selectedEmp && (()=>{
                              const [flName, setFlName] = [addStaffPopup?._flName||"", v=>setAddStaffPopup(p=>({...p,_flName:v}))];
                              const targetBid = room.branch_id;
                              const schKey = Object.entries(SCH_BRANCH_MAP).find(([k,v])=>v===targetBid)?.[0] || "";
                              const addFreelancer = async () => {
                                const nm = flName.trim();
                                if(!nm) return;
                                // 시스템 예약어 보호
                                const RESERVED = ["메모","미배정","청소","출근","휴무","알람","이동","지원"];
                                if (RESERVED.includes(nm)) { alert(`"${nm}"은(는) 시스템 예약어로 사용할 수 없습니다.`); return; }
                                // 항상 고유 id 생성 — 직원과 이름이 같아도 충돌 없게 (직원근무표/empSettings 격리)
                                const newId = `fl_${nm}_${Date.now().toString(36)}`;
                                const newEmp = {id: newId, name: nm, branch: schKey, isMale: false, isFreelancer: true};
                                // employees_v1에 추가 (customEmployees_v1 폐기됨)
                                const H = {apikey:SB_KEY, Authorization:"Bearer "+SB_KEY, "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates"};
                                try {
                                  const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY}});
                                  const rows = await r.json();
                                  const raw = rows?.[0]?.value;
                                  const existing = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
                                  // 같은 이름의 프리랜서가 이미 같은 지점에 있으면 차단 (UI 혼란 방지)
                                  if (existing.some(e => e.isFreelancer && (e.name||e.id) === nm && e.branch === schKey)) { alert("같은 지점에 같은 이름의 프리랜서가 이미 있습니다."); return; }
                                  const updated = [...existing, newEmp];
                                  await fetch(`${SB_URL}/rest/v1/schedule_data`, {method:"POST", headers:H, body:JSON.stringify({id:"employees_v1",key:"employees_v1",value:JSON.stringify(updated)})});
                                  setEmpList(prev=>[...prev.filter(e=>e.id!==newEmp.id), newEmp]);
                                  // ★ 그 날짜만 출근으로 schHistory에 등록 (다른 날짜는 표시 안 됨)
                                  setSchHistory(prev => {
                                    const next = {...(prev||{})};
                                    if (!next[newId]) next[newId] = {};
                                    next[newId] = {...next[newId], [selDate]: "근무"};
                                    return next;
                                  });
                                  // schHistory_v1 DB 동기화 (월별 키 구조 유지)
                                  try {
                                    const monthKey = selDate.slice(0,7);
                                    const schR = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY}});
                                    const schRows = await schR.json();
                                    const schRaw = schRows?.[0]?.value;
                                    const schObj = typeof schRaw === 'string' ? JSON.parse(schRaw) : (schRaw || {});
                                    if (!schObj[monthKey]) schObj[monthKey] = {};
                                    if (!schObj[monthKey][newId]) schObj[monthKey][newId] = {};
                                    schObj[monthKey][newId][selDate] = "근무";
                                    await fetch(`${SB_URL}/rest/v1/schedule_data`, {method:"POST", headers:H, body:JSON.stringify({id:"schHistory_v1",key:"schHistory_v1",value:JSON.stringify(schObj)})});
                                  } catch(_e) { console.warn("schHistory 등록 실패:", _e); }
                                  setAddStaffPopup(null);
                                } catch(e){console.error("프리랜서 추가 실패:",e);}
                              };
                              return <div style={{borderTop:"1px solid "+T.border,padding:"8px 12px",display:"flex",gap:4,alignItems:"center"}}>
                                <input value={flName} onChange={e=>setFlName(e.target.value)} placeholder="프리랜서 이름"
                                  onKeyUp={e=>{if(e.key==="Enter")addFreelancer();}}
                                  style={{flex:1,fontSize:11,padding:"5px 8px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}/>
                                <button onClick={addFreelancer} disabled={!flName.trim()}
                                  style={{padding:"5px 10px",borderRadius:6,border:"none",background:flName.trim()?T.primary:T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:flName.trim()?"pointer":"not-allowed",whiteSpace:"nowrap"}}>추가</button>
                              </div>;
                            })()}
                            {/* 지원/이동 선택 */}
                            {addStaffPopup?.selectedEmp && addStaffPopup?.selectedBranch===room.branch_id && (()=>{
                              const empName = addStaffPopup.selectedEmp;
                              const targetBid = addStaffPopup.selectedBranch;
                              const empBase = BASE_EMP_LIST.find(e=>e.id===empName);
                              const baseBid = empBase?.branch_id;
                              const baseBr = (data?.branches||[]).find(b=>b.id===baseBid);
                              const supportFrom = addStaffPopup.supportFrom || "";
                              const hours = Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).filter(t=>{const hh=parseInt(t);return hh>=startHour&&hh<endHour;});
                              const doAdd = (exclusive) => {
                                // 휴무자 추가 시 schHistory 즉시 근무로 전환 (UI 반영)
                                if (addStaffPopup.wasOff) {
                                  setSchHistory(prev => {
                                    const next = {...(prev||{})};
                                    if (!next[empName]) next[empName] = {};
                                    next[empName] = {...next[empName], [selDate]: "근무"};
                                    return next;
                                  });
                                }
                                const overrideKey = empName+"_"+selDate;
                                let ovData;
                                // 원래 지점 근무시간 (base segment 생성 전에 0분 여부 판단용)
                                const baseWh = baseBid ? (empWorkHours[empName+"_"+baseBid+"_"+selDate] || empWorkHours[empName+"_"+baseBid]) : null;
                                const baseStartTime = baseWh?.start || ((data?.branches||[]).find(b=>b.id===baseBid)?.timelineSettings?.defaultWorkStart || "11:00");
                                if(exclusive) {
                                  // 이동: 시간 지정되면 분할 이동 (원래 지점 ~시간 활성, 대상 지점 시간~ 활성)
                                  if(supportFrom && baseBid && supportFrom > baseStartTime) {
                                    const segs = [
                                      {branchId:baseBid, from:null, until:supportFrom},
                                      {branchId:targetBid, from:supportFrom, until:null}
                                    ];
                                    ovData = {segments:segs};
                                  } else {
                                    // 시간 없거나 원래 지점 근무 시작 전 이동 = 종일 이동
                                    ovData = {segments:[{branchId:targetBid,from:supportFrom||null,until:null}],exclusive:true};
                                  }
                                } else {
                                  // 지원: 원래 지점(~시작시간) + 대상 지점(시작시간~) 둘 다 유지
                                  const from = supportFrom || "14:00";
                                  const segs = [];
                                  // 원래 지점 근무 시작 >= 이동 시작이면 base 세그먼트 생략 (0분 세그먼트 방지)
                                  if(baseBid && from > baseStartTime) segs.push({branchId:baseBid, from:null, until:from});
                                  segs.push({branchId:targetBid, from, until:null});
                                  ovData = {segments:segs};
                                }
                                setEmpBranchOverride(p=>({...p,[overrideKey]:ovData}));
                                syncOverrideToSch(empName, selDate, ovData);
                                setAddStaffPopup(null);
                              };
                              return <div style={{borderTop:"2px solid "+T.primary,padding:"8px 12px"}}>
                                <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>{empName} <span style={{fontWeight:400,color:T.textMuted}}>({baseBr?.short||""})</span></div>
                                <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:6}}>
                                  <span style={{fontSize:10,color:T.textMuted}}>시작</span>
                                  <select value={supportFrom} onChange={e=>setAddStaffPopup(p=>({...p,supportFrom:e.target.value}))}
                                    style={{flex:1,fontSize:11,padding:"3px 4px",borderRadius:6,border:"1px solid "+T.border}}>
                                    <option value="">시간 선택</option>
                                    {hours.filter(h=>{const hh=parseInt(h);return hh>=startHour&&hh<endHour;}).map(h=><option key={h} value={h}>{h}</option>)}
                                  </select>
                                </div>
                                <div style={{display:"flex",gap:6}}>
                                  <button onClick={()=>doAdd(false)} disabled={!supportFrom}
                                    style={{flex:1,padding:"6px 0",borderRadius:7,border:"none",background:supportFrom?"#4CAF50":T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:supportFrom?"pointer":"not-allowed"}}
                                    title="원래 매장은 시작시간까지, 이후 이 매장">지원</button>
                                  <button onClick={()=>doAdd(true)}
                                    style={{flex:1,padding:"6px 0",borderRadius:7,border:"none",background:T.primary,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}
                                    title="원래 매장에서 제거, 종일 이 매장">이동</button>
                                  <button onClick={()=>setAddStaffPopup(p=>({...p,selectedEmp:null}))}
                                    style={{padding:"6px 8px",borderRadius:7,border:"1px solid "+T.border,background:T.bgCard,fontSize:11,cursor:"pointer"}}>취소</button>
                                </div>
                              </div>;
                            })()}
                          </div>
                        </>)}
                      </div>
                    ) : <span className="tl-room-sub" style={{fontSize:14,fontWeight:800,color:T.gray500}}>미배정</span>
                  ) : room.isStaffCol ? (
                    <div style={{position:"relative",display:"flex",alignItems:"center",gap:2,justifyContent:"center",flexWrap:"wrap"}}>
                      {!room.hideName && <button title="왼쪽으로" onClick={e=>{e.stopPropagation();moveEmpCol(room.branch_id,room.staffId,-1);}}
                        style={{width:16,height:16,padding:0,border:"none",background:"transparent",color:T.gray500,cursor:"pointer",fontSize:11,lineHeight:1,fontWeight:700,opacity:.55}}
                        onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color=T.primary;}}
                        onMouseLeave={e=>{e.currentTarget.style.opacity=".55";e.currentTarget.style.color=T.gray500;}}>◀</button>}
                      {(() => {
                        const _isFreelancer = !!empList.find(e => e.id === room.staffId)?.isFreelancer;
                        const _nameColor = room.hideName ? T.gray400 : (_isFreelancer ? "#4CAF50" : T.text);
                        return <span className="tl-room-sub" style={{fontSize:14,fontWeight:800,color:_nameColor,fontStyle:room.hideName?"italic":"normal",cursor:"pointer"}}
                          onClick={e=>{e.stopPropagation();setEmpMovePopup(p=>(p?.empId===room.staffId && p?.branchId===room.branch_id)?null:{empId:room.staffId,branchId:room.branch_id,date:selDate,x:e.clientX,y:e.clientY});}}>
                          {room.hideName ? "(이동)" : room.name}
                        </span>;
                      })()}
                      {!room.hideName && <button title="오른쪽으로" onClick={e=>{e.stopPropagation();moveEmpCol(room.branch_id,room.staffId,1);}}
                        style={{width:16,height:16,padding:0,border:"none",background:"transparent",color:T.gray500,cursor:"pointer",fontSize:11,lineHeight:1,fontWeight:700,opacity:.55}}
                        onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color=T.primary;}}
                        onMouseLeave={e=>{e.currentTarget.style.opacity=".55";e.currentTarget.style.color=T.gray500;}}>▶</button>}
                      {getTagsForEmp(room.staffId, selDate).map(t => (
                        <span key={t.id} title={t.name} style={{fontSize:9,color:t.color,background:t.color+'22',border:`1px solid ${t.color}66`,borderRadius:3,padding:'0 4px',fontWeight:700,lineHeight:1.3,whiteSpace:'nowrap'}}>{t.name}</span>
                      ))}
                      {empMovePopup?.empId===room.staffId && empMovePopup?.date===selDate && empMovePopup?.branchId===room.branch_id && (<>
                        <div style={{position:"fixed",inset:0,zIndex:9998}} onClick={e=>{e.stopPropagation();setEmpMovePopup(null);}}/>
                        <div onClick={e=>e.stopPropagation()} style={{position:"fixed",left:Math.min(empMovePopup.x,window.innerWidth-200),top:empMovePopup.y+8,background:T.bgCard,borderRadius:12,boxShadow:"0 4px 24px rgba(0,0,0,.22)",zIndex:9999,padding:"10px 0 6px",minWidth:200}}>
                          {/* 근무시간 설정 + 종일 근무지 변경 — 하단 저장 버튼으로 통합 */}
                          <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border}}>
                            <div style={{fontSize:10,color:T.textMuted,marginBottom:4,fontWeight:700}}>근무시간</div>
                            {(()=>{
                              const whKey = room.staffId+"_"+room.branch_id+"_"+selDate;
                              // 현재 컬럼 지점의 운영시간 (fallback용)
                              const _bts = (data?.branches||[]).find(b=>b.id===room.branch_id)?.timelineSettings;
                              const branchHours = _bts?.defaultWorkStart ? {start:_bts.defaultWorkStart, end:_bts.defaultWorkEnd||"21:00"}
                                : _bts?.openTime ? {start:_bts.openTime, end:_bts.closeTime||"21:00"} : null;
                              const _baseBid = BASE_EMP_LIST.find(e=>e.id===room.staffId)?.branch_id;
                              // 1순위: 해당 직원+해당 지점에 직접 저장된 값 (그대로 사용)
                              const explicitWh = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id];
                              // 2순위: 직원 base hours (날짜별 → 직원 default)
                              const empBaseWh = empWorkHours[room.staffId+"_"+selDate] || empWorkHours[room.staffId];
                              let savedWh;
                              if (explicitWh) {
                                savedWh = explicitWh;
                              } else if (empBaseWh && branchHours && room.branch_id !== _baseBid) {
                                // 비-base 지점이면 base hours를 지점 운영시간으로 클립
                                const start = empBaseWh.start > branchHours.start ? empBaseWh.start : branchHours.start;
                                const end   = empBaseWh.end   < branchHours.end   ? empBaseWh.end   : branchHours.end;
                                savedWh = (start < end) ? { start, end } : branchHours;
                              } else {
                                savedWh = empBaseWh || branchHours || {start:"10:00",end:"21:00"};
                              }
                              const wh = empMovePopup.draftWh || savedWh;
                              // 드롭다운 범위: 영업시간(openTime/closeTime) 기준 — defaultWorkEnd가 아닌 closeTime을 상한선으로 (직원 잔업 가능)
                              const _opTimes = (data?.branches||[]).find(b=>b.id===room.branch_id)?.timelineSettings;
                              const _opStart = _opTimes?.openTime || branchHours?.start || "06:00";
                              const _opEnd   = _opTimes?.closeTime || branchHours?.end || "23:00";
                              const _openH = parseInt(_opStart.split(":")[0]);
                              const _closeH = parseInt(_opEnd.split(":")[0]);
                              const _spanH = Math.max(1, _closeH - _openH + 1); // closeH 정시까지 포함
                              const hours = Array.from({length:_spanH*12},(_,i)=>{const h=Math.floor(i/12)+_openH,m=(i%12)*5;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;});
                              const selSt = {flex:1,fontSize:11,padding:"4px 3px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"};

                              // 종일 근무지 변경 — 체크박스 + 지점 select
                              // 현재 segs가 exclusive=true 하나짜리면 "다른 지점 종일 근무" 상태
                              const _ovKey = room.staffId+"_"+selDate;
                              const _ovCur = empBranchOverride[_ovKey];
                              const curSegs = empMovePopup.draftSegs !== undefined ? empMovePopup.draftSegs : (_ovCur?.segments || []);
                              const isDayMove = curSegs.length === 1 && curSegs[0]?.from == null && curSegs[0]?.until == null && curSegs[0]?.branchId !== room.branch_id;
                              const dayMoveBid = isDayMove ? curSegs[0].branchId : "";
                              const onDayMoveToggle = (checked) => {
                                if (!checked) {
                                  setEmpMovePopup(p=>({...p, draftSegs: []}));
                                  return;
                                }
                                // 타 지점 첫 번째로 자동 선택 (유저가 드롭다운에서 교체 가능)
                                const firstOther = (data?.branches||[]).find(b=>b.id!==room.branch_id && b.useYn!==false);
                                if (!firstOther) return;
                                setEmpMovePopup(p=>({...p, draftSegs: [{branchId: firstOther.id, from: null, until: null}]}));
                              };
                              const onDayMoveBranchChange = (bid) => {
                                setEmpMovePopup(p=>({...p, draftSegs: [{branchId: bid, from: null, until: null}]}));
                              };

                              return <>
                                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                                  <select value={wh.start} style={selSt}
                                    onChange={e=>{
                                      const v=e.target.value;
                                      const [hh,mm]=v.split(":").map(Number);
                                      const totalMin=Math.min(23*60+50,(hh+10)*60+mm);
                                      const eh=Math.floor(totalMin/60),em=totalMin%60;
                                      const autoEnd = `${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`;
                                      setEmpMovePopup(p=>({...p, draftWh:{start:v, end:autoEnd}}));
                                    }}>
                                    {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                  </select>
                                  <span style={{fontSize:11}}>~</span>
                                  <select value={wh.end} style={selSt}
                                    onChange={e=>setEmpMovePopup(p=>({...p, draftWh:{start:wh.start, end:e.target.value}}))}>
                                    {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                  </select>
                                </div>
                                <label style={{display:"flex",alignItems:"center",gap:5,marginTop:8,fontSize:11,cursor:"pointer",color:isDayMove?T.primary:T.textSub,fontWeight:isDayMove?700:500}}>
                                  <input type="checkbox" checked={isDayMove} onChange={e=>onDayMoveToggle(e.target.checked)} style={{cursor:"pointer",accentColor:T.primary}}/>
                                  🧳 타지점 종일 근무
                                </label>
                                {isDayMove && <select value={dayMoveBid} onChange={e=>onDayMoveBranchChange(e.target.value)}
                                  style={{width:"100%",marginTop:4,fontSize:11,padding:"4px 6px",borderRadius:6,border:"1px solid "+T.primary,background:T.primaryLt,color:T.primary,fontWeight:700,fontFamily:"inherit"}}>
                                  {(data?.branches||[]).filter(b=>b.id!==room.branch_id && b.useYn!==false).map(b=><option key={b.id} value={b.id}>{b.short||b.name}</option>)}
                                </select>}
                              </>;
                            })()}
                          </div>
                          {/* 담당자 교체 — 이 컬럼의 예약을 다른 직원에게 넘기기 */}
                          {(()=>{
                            const rsvList = (data?.reservations||[]).filter(r=>r.date===selDate && r.staffId===room.staffId && r.bid===room.branch_id);
                            if (rsvList.length === 0) return null;
                            // 현재 컬럼의 직원 제외, 이 지점에 오늘 있는(또는 올) 직원만
                            const currentStaffIds = new Set([room.staffId]);
                            const candidates = BASE_EMP_LIST.filter(e => !currentStaffIds.has(e.id));
                            return <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border,background:"#FFF8E1"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#F57F17",marginBottom:4}}>📋 담당자 교체 <span style={{color:T.textMuted,fontWeight:500}}>(예약 {rsvList.length}건)</span></div>
                              <div style={{display:"flex",gap:4}}>
                                <select value={empMovePopup.replaceWith||""} onChange={e=>setEmpMovePopup(p=>({...p,replaceWith:e.target.value}))}
                                  style={{flex:1,fontSize:11,padding:"4px 6px",borderRadius:6,border:"1px solid #ffb74d",fontFamily:"inherit"}}>
                                  <option value="">새 담당자 선택</option>
                                  {candidates.map(e=><option key={e.id} value={e.id}>{e.name||e.id}</option>)}
                                </select>
                                <button disabled={!empMovePopup.replaceWith}
                                  onClick={()=>{
                                    const newStaffId = empMovePopup.replaceWith;
                                    if(!newStaffId) return;
                                    const aStaffId = room.staffId;
                                    // 스왑: A의 오늘 예약 ↔ B의 오늘 예약 서로 교환
                                    const aRsvs = (data?.reservations||[]).filter(r => r.date===selDate && r.staffId===aStaffId);
                                    const bRsvs = (data?.reservations||[]).filter(r => r.date===selDate && r.staffId===newStaffId);
                                    const aName = (BASE_EMP_LIST.find(e=>e.id===aStaffId)?.name) || aStaffId;
                                    const bName = (BASE_EMP_LIST.find(e=>e.id===newStaffId)?.name) || newStaffId;
                                    if(!confirm(`담당자 스왑\n\n${aName}의 예약 ${aRsvs.length}건 → ${bName}\n${bName}의 예약 ${bRsvs.length}건 → ${aName}\n\n두 직원의 예약을 서로 맞바꿉니다. 진행할까요?`)) return;
                                    aRsvs.forEach(r=>{ sb.update("reservations", r.id, { staff_id: newStaffId }).catch(console.error); });
                                    bRsvs.forEach(r=>{ sb.update("reservations", r.id, { staff_id: aStaffId }).catch(console.error); });
                                    setData(prev=>({...prev, reservations:(prev?.reservations||[]).map(r => {
                                      if (r.date !== selDate) return r;
                                      if (r.staffId === aStaffId) return {...r, staffId: newStaffId};
                                      if (r.staffId === newStaffId) return {...r, staffId: aStaffId};
                                      return r;
                                    })}));
                                    setEmpMovePopup(null);
                                  }}
                                  style={{padding:"4px 10px",fontSize:11,fontWeight:700,border:"none",borderRadius:6,background:empMovePopup.replaceWith?"#ff9800":T.gray300,color:"#fff",cursor:empMovePopup.replaceWith?"pointer":"not-allowed",fontFamily:"inherit"}}>스왑</button>
                              </div>
                            </div>;
                          })()}
                          {/* 현재 segments */}
                          {(()=>{
                            const overrideKey = room.staffId+"_"+selDate;
                            const ov = empBranchOverride[overrideKey];
                            const dbSegs = ov ? (typeof ov==="string" ? [{branchId:ov,from:null,until:null}] : (ov.segments||[])) : [];
                            // 드래프트(저장 전) 편집 상태 — 버튼 눌러야 DB 반영
                            const segs = empMovePopup.draftSegs !== undefined ? empMovePopup.draftSegs : dbSegs;
                            const isDirty = (empMovePopup.draftSegs !== undefined && JSON.stringify(empMovePopup.draftSegs) !== JSON.stringify(dbSegs))
                              || (empMovePopup.draftWh !== undefined);
                            const setDraft = (newSegs) => setEmpMovePopup(p=>({...p, draftSegs: newSegs}));
                            const empBase = BASE_EMP_LIST.find(e=>e.id===room.staffId);
                            // base는 원소속 우선 — 지원 직원(타 지점 컬럼에서 열림)도 visualSegs가 원소속 구간을 자동 채우도록
                            const baseBranch = empBase?.branch_id || room.branch_id;
                            const allBranches = (data.branches||[]).filter(b=>b.useYn!==false);
                            // 추가할 지점 + 시간 상태
                            const [addBranch,setAddBranch] = [empMovePopup.addBranch||"", v=>setEmpMovePopup(p=>({...p,addBranch:v}))];
                            const [addFrom,setAddFrom] = [empMovePopup.addFrom||"", v=>setEmpMovePopup(p=>({...p,addFrom:v}))];
                            const [addUntil,setAddUntil] = [empMovePopup.addUntil||"", v=>setEmpMovePopup(p=>({...p,addUntil:v}))];

                            const saveSeg = () => {
                              if(!addBranch) return;
                              const newSeg = {branchId:addBranch, from:addFrom||null, until:null};
                              // 기존 segs에서 같은 지점 제거 후 추가 (드래프트 기준)
                              const prev = segs.filter(s=>s.branchId!==addBranch);
                              let merged = [...prev, newSeg].sort((a,b)=>{
                                if(!a.from) return -1; if(!b.from) return 1;
                                return a.from.localeCompare(b.from);
                              }).map((s,i,arr)=>({...s, until: arr[i+1]?.from||null}));
                              // 원래 지점이 없으면 자동 추가 (첫 이동 전까지) — 지원 근무 대응으로 현재 컬럼 지점 사용
                              const baseBranchId = room.branch_id;
                              if(baseBranchId && !merged.find(s=>s.branchId===baseBranchId)) {
                                const firstFrom = merged[0]?.from || null;
                                merged = [{branchId:baseBranchId, from:null, until:firstFrom}, ...merged];
                              }
                              // 드래프트로만 반영 (저장 버튼 누를 때 DB에 기록)
                              setEmpMovePopup(p=>({...p, draftSegs: merged, addBranch:"", addFrom:"", addUntil:""}));
                            };

                            const removeSeg = (branchId) => {
                              const newSegs = segs.filter(s=>s.branchId!==branchId);
                              const reindexed = newSegs.sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s,until:arr[i+1]?.from||null}));
                              setDraft(reindexed);
                            };

                            // 직원 이동 시간 단위: 10분
                            const TIME_OPTS = Array.from({length:24*12},(_,i)=>{const h=Math.floor(i/12),m=(i%12)*5;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).filter(t=>{const hh=parseInt(t);return hh>=startHour&&hh<=endHour;});
                            // segment 변경 → 시간순 정렬 후 다음 segment의 from을 until로 자동 chain (드래프트만)
                            const updateSeg = (branchId, field, value) => {
                              let newSegs = segs.map(s => s.branchId === branchId ? {...s, [field]: value || null} : s);
                              if (field === "from") {
                                newSegs = newSegs.sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s, until: arr[i+1]?.from || s.until || null}));
                              }
                              setDraft(newSegs);
                            };

                            // 저장/취소
                            const commitDraft = () => {
                              const overrideKey2 = room.staffId+"_"+selDate;
                              if (!segs.length) {
                                setEmpBranchOverride(p=>{const n={...p};delete n[overrideKey2];return n;});
                                syncOverrideToSch(room.staffId, selDate, null);
                              } else {
                                const ovData = {segments: segs};
                                setEmpBranchOverride(p=>({...p,[overrideKey2]:ovData}));
                                syncOverrideToSch(room.staffId, selDate, ovData);
                              }
                              // 근무시간 변경도 함께 반영 (상단 저장 버튼 통합)
                              if (empMovePopup.draftWh) {
                                const whKey2 = room.staffId+"_"+room.branch_id+"_"+selDate;
                                setEmpWorkHours(p=>({...p, [whKey2]: empMovePopup.draftWh}));
                              }
                              setEmpMovePopup(null);
                            };
                            const cancelDraft = () => setEmpMovePopup(null);
                            // 직원 총 근무시간 (저장 키: staffId_branchId_date)
                            const wh = empWorkHours[room.staffId+"_"+room.branch_id+"_"+selDate]
                                    || empWorkHours[room.staffId+"_"+room.branch_id]
                                    || empWorkHours[room.staffId+"_"+selDate]
                                    || empWorkHours[room.staffId]
                                    || (()=>{
                              const bts=(data?.branches||[]).find(b=>b.id===baseBranch)?.timelineSettings;
                              return bts?.defaultWorkStart?{start:bts.defaultWorkStart,end:bts.defaultWorkEnd||"21:00"}:bts?.openTime?{start:bts.openTime,end:bts.closeTime||"21:00"}:null;
                            })();
                            // 시간 → 분 변환
                            const toMn = (t) => { if(!t) return null; const [h,m]=t.split(":").map(Number); return h*60+m; };
                            const whStartMn = toMn(wh?.start) || startHour*60;
                            const whEndMn = toMn(wh?.end) || endHour*60;
                            const whDur = whEndMn - whStartMn;
                            // 시각적 타임라인 바 segments 계산 (원래 지점은 gap·끝에도 자동 채움)
                            const visualSegs = (() => {
                              const sorted = [...segs].sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from)));
                              const raw = [];
                              sorted.forEach((s, i) => {
                                const fromMn = toMn(s.from) || whStartMn;
                                const untilMn = toMn(s.until) || toMn(sorted[i+1]?.from) || whEndMn;
                                if (untilMn > fromMn) raw.push({branchId: s.branchId, fromMn, untilMn});
                              });
                              // base 지점 자동 보완 — 앞·사이·뒤의 빈 구간을 baseBranch로 채움
                              const out = [];
                              let cursor = whStartMn;
                              for (const r of raw) {
                                if (baseBranch && r.fromMn > cursor) {
                                  out.push({branchId: baseBranch, fromMn: cursor, untilMn: r.fromMn, isHome: true});
                                }
                                out.push(r);
                                if (r.untilMn > cursor) cursor = r.untilMn;
                              }
                              if (baseBranch && cursor < whEndMn) {
                                out.push({branchId: baseBranch, fromMn: cursor, untilMn: whEndMn, isHome: true});
                              }
                              // segments가 전혀 없으면 전체 출근지
                              if (baseBranch && out.length === 0) {
                                out.push({branchId: baseBranch, fromMn: whStartMn, untilMn: whEndMn, isHome: true});
                              }
                              return out;
                            })();

                            return <>
                              {/* 시각적 타임라인 바 — 드래그로 구간 조절 가능 */}
                              {visualSegs.length>0 && whDur>0 && (() => {
                                // 각 지점에 구분되는 색상 (branch.color 우선, 없으면 index 기반)
                                const PALETTE = ["#4A90E2","#F5A623","#7ED321","#BD10E0","#50E3C2","#D0021B","#F8A0C0","#9013FE","#417505","#8B572A"];
                                // 밝은 색(흰색 계열) 여부
                                const isLight = (hex) => {
                                  if (!hex) return true;
                                  const h = hex.replace("#",""); if (h.length<6) return true;
                                  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
                                  return (r+g+b)/3 > 220;
                                };
                                const colorOf = (bid) => {
                                  const br = allBranches.find(b=>b.id===bid);
                                  if (br?.color && !isLight(br.color)) return br.color;
                                  // 브랜치 색이 없거나 너무 밝으면 해시 팔레트
                                  const idx = Math.abs([...bid].reduce((a,c)=>a+c.charCodeAt(0),0)) % PALETTE.length;
                                  return PALETTE[idx];
                                };
                                const mnToTime = (mn) => `${String(Math.floor(mn/60)).padStart(2,"0")}:${String(mn%60).padStart(2,"0")}`;
                                const barRef = React.createRef();
                                // 경계 드래그 핸들러
                                const onHandleDown = (boundaryIdx) => (e) => {
                                  e.preventDefault(); e.stopPropagation();
                                  const isTouch = e.type === "touchstart";
                                  // bar 요소 찾기 — 아래 fader 핸들(바 외부)에서도 작동해야 함
                                  let bar = e.currentTarget.parentElement;
                                  while (bar && !bar.classList.contains("bliss-seg-hover")) bar = bar.parentElement;
                                  if (!bar) bar = e.currentTarget.parentElement;
                                  const rect = bar.getBoundingClientRect();
                                  const onMove = (ev) => {
                                    const pt = isTouch ? ev.touches[0] : ev;
                                    if (!pt) return;
                                    const x = Math.max(0, Math.min(rect.width, pt.clientX - rect.left));
                                    const mn = whStartMn + Math.round((x / rect.width) * whDur / 10) * 10; // 10분 단위 snap
                                    const newTime = mnToTime(Math.max(whStartMn, Math.min(whEndMn, mn)));
                                    // 경계 = visualSegs[boundaryIdx].untilMn = visualSegs[boundaryIdx+1].fromMn
                                    const targetSeg = visualSegs[boundaryIdx+1];
                                    if (!targetSeg) return;
                                    // home(자동) 지점이 경계를 움직이면 다음 실제 segment의 from 업데이트
                                    if (targetSeg.isHome) return;
                                    // 실제 segments에서 from 업데이트
                                    updateSeg(targetSeg.branchId, "from", newTime);
                                  };
                                  const onUp = () => {
                                    document.removeEventListener(isTouch?"touchmove":"mousemove", onMove);
                                    document.removeEventListener(isTouch?"touchend":"mouseup", onUp);
                                  };
                                  document.addEventListener(isTouch?"touchmove":"mousemove", onMove, {passive:false});
                                  document.addEventListener(isTouch?"touchend":"mouseup", onUp);
                                };
                                // 드래그 기반 삽입: mousedown → move → up (크롭 방식)
                                const insertAt = empMovePopup.insertAt;
                                const insertPct = insertAt ? ((toMn(insertAt.time) - whStartMn) / whDur * 100) : 0;
                                const pickInsertBranch = (branchId) => {
                                  if (!insertAt) return;
                                  const newSeg = {branchId, from: insertAt.time, until: null};
                                  const prevSegs = segs.filter(s => s.branchId !== branchId);
                                  const merged = [...prevSegs, newSeg].sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s, until: arr[i+1]?.from || null}));
                                  setEmpMovePopup(p=>({...p, draftSegs: merged, insertAt: null}));
                                };
                                const onBarPointerDown = (e) => {
                                  if (e.button !== 0) return;
                                  e.preventDefault(); e.stopPropagation();
                                  const bar = e.currentTarget;
                                  const rect = bar.getBoundingClientRect();
                                  // Pointer capture — 마우스가 바 밖으로 나가도 이벤트 계속 받음
                                  try { bar.setPointerCapture(e.pointerId); } catch {}
                                  const calcTime = (clientX) => {
                                    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
                                    const mn = whStartMn + Math.round((x / rect.width) * whDur / 10) * 10; // 10분 단위 snap
                                    const clamped = Math.max(whStartMn+10, Math.min(whEndMn-10, mn));
                                    return mnToTime(clamped);
                                  };
                                  let lastTime = calcTime(e.clientX);
                                  setEmpMovePopup(p=>({...p, insertAt: {time: lastTime, dragging: true}}));
                                  const onMove = (ev) => {
                                    ev.preventDefault();
                                    lastTime = calcTime(ev.clientX);
                                    setEmpMovePopup(p=>({...p, insertAt: {time: lastTime, dragging: true}}));
                                  };
                                  const finish = () => {
                                    bar.removeEventListener("pointermove", onMove);
                                    bar.removeEventListener("pointerup", finish);
                                    bar.removeEventListener("pointercancel", finish);
                                    window.removeEventListener("blur", finish);
                                    document.removeEventListener("mouseup", finish);
                                    try { bar.releasePointerCapture(e.pointerId); } catch {}
                                    setEmpMovePopup(p=>({...p, insertAt: p.insertAt ? {...p.insertAt, time: lastTime, dragging: false} : null}));
                                  };
                                  bar.addEventListener("pointermove", onMove);
                                  bar.addEventListener("pointerup", finish);
                                  bar.addEventListener("pointercancel", finish);
                                  // 백업: 포인터 이벤트 놓쳐도 확실히 종료
                                  window.addEventListener("blur", finish);
                                  document.addEventListener("mouseup", finish);
                                };
                                // Razor 커서 — DaVinci 스타일 (면도칼)
                                const cropCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M10 1 L10 16' stroke='${encodeURIComponent(T.primary)}' stroke-width='2.5' stroke-linecap='round'/><circle cx='10' cy='18' r='2' fill='${encodeURIComponent(T.primary)}'/></svg>") 10 10, col-resize`;
                                return <>
                                  <style>{`
                                    @keyframes blissSplitPulse { 0%,100%{opacity:1;transform:scaleY(1)} 50%{opacity:0.75;transform:scaleY(1.04)} }
                                    @keyframes blissPopupUp { from{opacity:0;transform:translateY(8px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
                                    @keyframes blissTimeFloat { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
                                    .bliss-seg-hover:hover { box-shadow:0 2px 8px rgba(0,0,0,.08),0 0 0 1px ${T.primary}33 }
                                    .bliss-branch-pick:hover { transform:translateY(-1px); box-shadow:0 4px 10px rgba(0,0,0,.1) }
                                    .bliss-branch-pick:active { transform:translateY(0) }
                                  `}</style>
                                  <div style={{padding:"10px 12px 22px",position:"relative"}}>
                                  <div className="bliss-seg-hover" draggable={false} onDragStart={e=>e.preventDefault()}
                                    style={{position:"relative",display:"flex",height:26,borderRadius:6,overflow:"visible",border:"1px solid "+T.border,userSelect:"none",WebkitUserDrag:"none",touchAction:"none",cursor:cropCursor,background:T.gray100,transition:"box-shadow .15s"}}
                                    onPointerDown={onBarPointerDown}>
                                    {visualSegs.map((vs,i) => {
                                      const br = allBranches.find(b=>b.id===vs.branchId);
                                      const w = Math.max(0, (vs.untilMn - vs.fromMn) / whDur * 100);
                                      if (w <= 0) return null;
                                      const bg = colorOf(vs.branchId);
                                      const name = br?.short || br?.name || "";
                                      const isLast = i === visualSegs.length - 1;
                                      // 톤다운 파스텔: 20~28% opacity, glass 느낌
                                      const softBg = `linear-gradient(180deg, ${bg}28, ${bg}18)`;
                                      return <div key={i} style={{position:"relative",width:w+"%",background:softBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:bg,overflow:"hidden",whiteSpace:"nowrap",borderRight:isLast?"none":"1px solid "+bg+"55",letterSpacing:0.2}} title={`${name} ${mnToTime(vs.fromMn)}~${mnToTime(vs.untilMn)}`}>
                                        <span style={{pointerEvents:"none",opacity:vs.isHome?0.5:0.95,textShadow:"0 1px 0 rgba(255,255,255,.5)"}}>{w>8?name:""}</span>
                                      </div>;
                                    })}
                                    {/* DJ 페이더 스타일 경계 핸들 — 바 아래로 튀어나온 그립 */}
                                    {visualSegs.slice(0, -1).map((vs, i) => {
                                      const leftPct = (vs.untilMn - whStartMn) / whDur * 100;
                                      const nextSeg = visualSegs[i+1];
                                      const handleColor = colorOf(nextSeg?.branchId || vs.branchId);
                                      return <React.Fragment key={`fader-${i}`}>
                                        {/* 가이드 라인 — 바 위에서 fader까지 컬러 수직선 */}
                                        <div style={{position:"absolute",left:`calc(${leftPct}% - 1px)`,top:0,bottom:-4,width:2,background:handleColor,pointerEvents:"none",zIndex:3,opacity:.7}}/>
                                        {/* 시간 툴팁 — 바 위쪽 */}
                                        <div style={{position:"absolute",top:-14,left:`calc(${leftPct}% - 16px)`,fontSize:9,fontWeight:700,color:T.textSub,background:T.bgCard,padding:"1px 4px",borderRadius:3,whiteSpace:"nowrap",pointerEvents:"none",border:"1px solid "+T.border,zIndex:4,lineHeight:"11px",boxShadow:"0 1px 2px rgba(0,0,0,.04)"}}>{mnToTime(vs.untilMn)}</div>
                                        {/* 페이더 손잡이 — 바 아래 */}
                                        <div
                                          onPointerDown={e=>e.stopPropagation()}
                                          onMouseDown={e=>{e.stopPropagation();onHandleDown(i)(e);}}
                                          onTouchStart={e=>{e.stopPropagation();onHandleDown(i)(e);}}
                                          onClick={e=>e.stopPropagation()}
                                          onMouseEnter={e=>{e.currentTarget.style.transform="translate(-50%, 0) scale(1.1)";e.currentTarget.style.boxShadow=`0 3px 8px ${handleColor}88, 0 1px 2px rgba(0,0,0,.15)`;}}
                                          onMouseLeave={e=>{e.currentTarget.style.transform="translate(-50%, 0)";e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,.15)";}}
                                          style={{
                                            position:"absolute",
                                            left:`${leftPct}%`,
                                            top:"100%",
                                            transform:"translate(-50%, 0)",
                                            marginTop:2,
                                            width:22, height:16,
                                            background:`linear-gradient(180deg, ${T.bgCard} 0%, ${handleColor}15 100%)`,
                                            border:`1.5px solid ${handleColor}`,
                                            borderRadius:4,
                                            cursor:"ew-resize",
                                            boxShadow:"0 2px 4px rgba(0,0,0,.15)",
                                            display:"flex",alignItems:"center",justifyContent:"center",gap:2,
                                            zIndex:6,
                                            touchAction:"none",
                                            transition:"transform .1s, box-shadow .1s"
                                          }}
                                        >
                                          <span style={{width:1.5,height:8,background:handleColor,opacity:.7,borderRadius:1}}/>
                                          <span style={{width:1.5,height:8,background:handleColor,opacity:.7,borderRadius:1}}/>
                                          <span style={{width:1.5,height:8,background:handleColor,opacity:.7,borderRadius:1}}/>
                                        </div>
                                      </React.Fragment>;
                                    })}
                                    {/* 드래그 시 분할 효과 */}
                                    {insertAt && <>
                                      {/* 오른쪽 "새 지점 pending" 영역 — 사선 줄무늬 */}
                                      <div style={{position:"absolute",top:0,bottom:0,left:`${insertPct}%`,right:0,zIndex:3,pointerEvents:"none",
                                        background:`repeating-linear-gradient(45deg, ${T.primary}22 0, ${T.primary}22 5px, ${T.primary}11 5px, ${T.primary}11 10px)`,
                                        borderLeft:`0px`}}/>
                                      {/* 분할 세로선 (pulse 애니메이션) */}
                                      <div style={{position:"absolute",top:-3,bottom:-3,left:`calc(${insertPct}% - 1.5px)`,width:3,zIndex:5,pointerEvents:"none",
                                        background:T.primary,borderRadius:2,boxShadow:`0 0 6px ${T.primary}99, 0 0 2px ${T.primary}`,
                                        animation:"blissSplitPulse 1s ease-in-out infinite"}}/>
                                    </>}
                                  </div>
                                  {/* 양 끝 시간 + 드래그 중 시간 bubble (바 아래) */}
                                  <div style={{position:"relative",display:"flex",justifyContent:"space-between",fontSize:9,color:T.textMuted,marginTop:6,height:18}}>
                                    <span style={{lineHeight:"18px"}}>{wh?.start||mnToTime(whStartMn)}</span>
                                    {insertAt && <div style={{position:"absolute",left:`calc(${insertPct}% - 25px)`,top:-2,animation:"blissTimeFloat .12s ease-out"}}>
                                      <div style={{fontSize:11,fontWeight:800,color:"#fff",background:T.primary,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap",zIndex:5,lineHeight:"14px",boxShadow:`0 2px 6px ${T.primary}66`,position:"relative"}}>
                                        {insertAt.time}
                                        <div style={{position:"absolute",top:-4,left:"50%",transform:"translateX(-50%)",width:0,height:0,borderLeft:"4px solid transparent",borderRight:"4px solid transparent",borderBottom:`4px solid ${T.primary}`}}/>
                                      </div>
                                    </div>}
                                    <span style={{lineHeight:"18px"}}>{wh?.end||mnToTime(whEndMn)}</span>
                                  </div>
                                  {/* 지점 선택 팝업 — 드래그 끝난 후 slide-up */}
                                  {insertAt && !insertAt.dragging && <div style={{position:"absolute",top:42,left:12,right:12,background:T.bgCard,border:"1px solid "+T.border,borderTop:`3px solid ${T.primary}`,borderRadius:10,padding:"12px 14px",boxShadow:"0 8px 24px rgba(0,0,0,.1), 0 2px 6px rgba(0,0,0,.06)",zIndex:10,animation:"blissPopupUp .16s ease-out"}}>
                                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                                      <span style={{fontSize:11,fontWeight:700,color:T.textSub,letterSpacing:0.1}}>
                                        <span style={{display:"inline-block",padding:"2px 7px",background:T.primary,color:"#fff",borderRadius:4,marginRight:6,fontWeight:800,fontSize:11,boxShadow:`0 1px 3px ${T.primary}55`}}>{insertAt.time}</span>
                                        부터 이동할 지점
                                      </span>
                                      <button onClick={()=>setEmpMovePopup(p=>({...p, insertAt: null}))}
                                        style={{border:"none",background:"none",cursor:"pointer",color:T.gray400,fontSize:15,padding:"0 4px",lineHeight:1}}>×</button>
                                    </div>
                                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                      {allBranches.map(b=>{
                                        const c = colorOf(b.id);
                                        return <button key={b.id} className="bliss-branch-pick" onClick={()=>pickInsertBranch(b.id)}
                                          style={{padding:"7px 13px",fontSize:11,fontWeight:700,borderRadius:7,border:`1.5px solid ${c}44`,background:`linear-gradient(180deg,${c}1a,${c}10)`,color:T.text,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                                          <span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block",boxShadow:`0 0 0 2px ${c}33`}}/>
                                          {b.short||b.name}
                                        </button>;
                                      })}
                                    </div>
                                    <div style={{display:"flex",gap:6,alignItems:"center",marginTop:9,paddingTop:8,borderTop:"1px dashed "+T.border}}>
                                      <span style={{fontSize:10,color:T.textMuted,fontWeight:600}}>시간 미세조정</span>
                                      <select value={insertAt.time} onChange={e=>setEmpMovePopup(p=>({...p, insertAt: {...p.insertAt, time: e.target.value}}))}
                                        style={{flex:1,fontSize:11,padding:"4px 6px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit",background:T.bgCard,fontWeight:700,color:T.textSub}}>
                                        {TIME_OPTS.filter(t=>{const m=toMn(t);return m>whStartMn&&m<whEndMn;}).map(t=><option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </div>
                                  </div>}
                                </div>
                                </>;
                              })()}
                              {/* 현재 구간 목록 — visualSegs 기반 (base 자동 구간 포함, 편집 구간과 동일 UI) */}
                              {visualSegs.length>0 && <div style={{padding:"6px 12px"}}>
                                {visualSegs.map((vs, idx) => {
                                  const br = allBranches.find(b=>b.id===vs.branchId);
                                  const mnToTime = (mn) => `${String(Math.floor(mn/60)).padStart(2,"0")}:${String(mn%60).padStart(2,"0")}`;
                                  const fromT = mnToTime(vs.fromMn);
                                  const untilT = mnToTime(vs.untilMn);
                                  const selSt = {flex:1,fontSize:10,padding:"2px 3px",borderRadius:4,border:"1px solid "+T.border,fontFamily:"inherit"};
                                  // 자동 구간(base 보완) — 같은 UI, select disabled
                                  if (vs.isHome) {
                                    return <div key={idx} style={{display:"flex",alignItems:"center",gap:3,marginBottom:4,fontSize:11}}>
                                      <span style={{width:6,height:6,borderRadius:"50%",background:br?.color||T.primary,flexShrink:0}}/>
                                      <span style={{fontWeight:600,minWidth:50}}>{br?.short||br?.name}</span>
                                      <select value={fromT} disabled style={{...selSt, background:T.bgCard, color:T.text, cursor:"default"}}>
                                        <option value={fromT}>{fromT}</option>
                                      </select>
                                      <span style={{color:T.textMuted}}>~</span>
                                      <select value={untilT} disabled style={{...selSt, background:T.bgCard, color:T.text, cursor:"default"}}>
                                        <option value={untilT}>{untilT}</option>
                                      </select>
                                      <span style={{width:16,flexShrink:0}}/>
                                    </div>;
                                  }
                                  // 타 지점 이동 구간 — 편집 가능
                                  const s = segs.find(x=>x.branchId===vs.branchId && (toMn(x.from)===vs.fromMn || (!x.from && vs.fromMn===whStartMn)));
                                  return <div key={idx} style={{display:"flex",alignItems:"center",gap:3,marginBottom:4,fontSize:11}}>
                                    <span style={{width:6,height:6,borderRadius:"50%",background:br?.color||T.primary,flexShrink:0}}/>
                                    <span style={{fontWeight:600,minWidth:50}}>{br?.short||br?.name}</span>
                                    <select value={s?.from||fromT} onChange={e=>updateSeg(vs.branchId,"from",e.target.value)} style={selSt}>
                                      {TIME_OPTS.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <span style={{color:T.textMuted}}>~</span>
                                    <select value={s?.until||untilT} onChange={e=>updateSeg(vs.branchId,"until",e.target.value)} style={selSt}>
                                      {TIME_OPTS.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <button onClick={()=>removeSeg(vs.branchId)} style={{width:16,height:16,border:"none",background:"none",cursor:"pointer",color:T.danger,fontSize:14,padding:0,lineHeight:1,flexShrink:0}}>×</button>
                                  </div>;
                                })}
                              </div>}
                              {/* 이동 추가 */}
                              <div style={{padding:"6px 12px",borderTop:"1px solid "+T.border}}>
                                <div style={{fontSize:10,color:T.textMuted,marginBottom:5,fontWeight:700}}>이동 추가</div>
                                <div style={{display:"flex",gap:4,marginBottom:5}}>
                                  <select value={addBranch} onChange={e=>setAddBranch(e.target.value)}
                                    style={{flex:1,fontSize:11,padding:"4px 5px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                    <option value="">지점 선택</option>
                                    {allBranches.map(b=><option key={b.id} value={b.id}>{b.short||b.name}</option>)}
                                  </select>
                                </div>
                                <div style={{display:"flex",gap:4,marginBottom:5,alignItems:"center"}}>
                                  <select value={addFrom} onChange={e=>setAddFrom(e.target.value)}
                                    style={{flex:1,fontSize:11,padding:"4px 5px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                    <option value="">시작(선택)</option>
                                    {Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).filter(t=>{const hh=parseInt(t);return hh>=startHour&&hh<endHour;}).map(t=><option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <span style={{fontSize:11,color:T.textMuted}}>~</span>
                                  <select value={addUntil} onChange={e=>setAddUntil(e.target.value)}
                                    style={{flex:1,fontSize:11,padding:"4px 5px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                    <option value="">종료(선택)</option>
                                    {Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).filter(t=>{const hh=parseInt(t);return hh>=startHour&&hh<=endHour;}).map(t=><option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div style={{display:"flex",gap:4}}>
                                  <button onClick={()=>{
                                    if(!addBranch) return;
                                    // 종료 미입력 시 근무 끝 시각으로 기본 (지원 근무 가시성 ↑)
                                    const newSeg = {branchId:addBranch, from:addFrom||null, until:addUntil||wh?.end||null};
                                    // 드래프트에 추가 (중복 지점은 교체)
                                    const prevSegs = segs.filter(s => s.branchId !== addBranch);
                                    const segments = [...prevSegs, newSeg];
                                    setEmpMovePopup(p=>({...p, draftSegs: segments, addBranch:"", addFrom:"", addUntil:""}));
                                  }} disabled={!addBranch}
                                    style={{flex:1,padding:"7px 0",borderRadius:7,border:"none",background:addBranch?T.primary:T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:addBranch?"pointer":"not-allowed",fontFamily:"inherit"}}
                                    title="시작/종료 시간 미입력 시 전체 이동. 여러 지점 이동 가능.">
                                    추가
                                  </button>
                                </div>
                              </div>
                              {/* 저장 / 취소 버튼 — 변경 사항이 있을 때만 적용 */}
                              <div style={{padding:"8px 12px",borderTop:"2px solid "+T.border,display:"flex",gap:6,background:isDirty?"#FFF8E1":"transparent"}}>
                                <button onClick={cancelDraft}
                                  style={{flex:1,padding:"8px 0",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                                  취소
                                </button>
                                <button onClick={commitDraft} disabled={!isDirty}
                                  style={{flex:2,padding:"8px 0",borderRadius:8,border:"none",background:isDirty?T.primary:T.gray300,color:"#fff",fontSize:12,fontWeight:800,cursor:isDirty?"pointer":"not-allowed",fontFamily:"inherit"}}>
                                  {isDirty ? "💾 저장" : "변경 없음"}
                                </button>
                              </div>
                            </>;
                          })()}
                          {/* 오늘 휴무 / 프리랜서 컬럼 삭제 */}
                          <div style={{borderTop:"1px solid "+T.border,padding:"8px 12px",display:"flex",gap:6}}>
                            <button onClick={async (e) => {
                              e.stopPropagation();
                              // 예약/일정 보호: 이 컬럼에 블록 있으면 차단
                              const colBlocks = (data?.reservations||[]).filter(r =>
                                r.date === selDate && r.staffId === room.staffId && r.bid === room.branch_id &&
                                !["cancelled","naver_cancelled","naver_changed"].includes(r.status)
                              );
                              if (colBlocks.length > 0) {
                                alert(`이 컬럼에 예약/일정 ${colBlocks.length}건이 있어 휴무 처리할 수 없습니다.\n먼저 "담당자 교체"로 다른 직원에게 이전하거나 개별 이동해주세요.`);
                                return;
                              }
                              if (!confirm(`${room.staffId} 오늘(${selDate}) 휴무 처리할까요?\n(컬럼이 사라집니다)`)) return;
                              try {
                                // 로컬 flat state 업데이트 (UI 반영)
                                const newSch = {...(schHistory||{})};
                                if (!newSch[room.staffId]) newSch[room.staffId] = {};
                                newSch[room.staffId][selDate] = "휴무";
                                setSchHistory(newSch);
                                // DB는 월별 구조 유지: raw를 읽어와서 monthKey 하위에 patch
                                const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
                                const rows = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, { headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY} }).then(r=>r.json());
                                const raw = rows?.[0]?.value ? (typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value) : {};
                                const monthKey = selDate.slice(0,7);
                                if (!raw[monthKey]) raw[monthKey] = {};
                                if (!raw[monthKey][room.staffId]) raw[monthKey][room.staffId] = {};
                                raw[monthKey][room.staffId][selDate] = "휴무";
                                await fetch(`${SB_URL}/rest/v1/schedule_data`, { method:"POST", headers:H, body: JSON.stringify({id:"schHistory_v1", key:"schHistory_v1", value: JSON.stringify(raw), updated_at: new Date().toISOString()}) });
                                setEmpMovePopup(null);
                              } catch (err) { console.error("휴무 처리 실패:", err); alert("실패: " + err.message); }
                            }} style={{flex:1,padding:"7px 0",borderRadius:7,border:"1px solid "+T.gray400,background:T.gray100,color:T.text,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                              오늘 휴무
                            </button>
                          </div>
                          {/* 프리랜서 컬럼 삭제 */}
                          {(() => {
                            const emp = empList.find(e => e.id === room.staffId);
                            if (!emp?.isFreelancer) return null;
                            return <div style={{borderTop:"1px solid "+T.border,padding:"8px 12px"}}>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                // 예약/일정 보호: 이 직원에 블록 있으면 차단
                                const anyBlocks = (data?.reservations||[]).filter(r =>
                                  r.staffId === room.staffId &&
                                  !["cancelled","naver_cancelled","naver_changed"].includes(r.status)
                                );
                                if (anyBlocks.length > 0) {
                                  alert(`"${room.staffId}" 직원에 예약/일정 ${anyBlocks.length}건이 있어 컬럼을 삭제할 수 없습니다.\n먼저 "담당자 교체"로 다른 직원에게 이전해주세요.`);
                                  return;
                                }
                                if (!confirm(`"${room.staffId}" 프리랜서 컬럼을 삭제할까요?\n(모든 지점/날짜에서 제거됩니다)`)) return;
                                const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
                                try {
                                  const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: H });
                                  const rows = await r.json();
                                  const raw = rows?.[0]?.value;
                                  const existing = typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
                                  const filtered = existing.filter(x => x.id !== room.staffId);
                                  await fetch(`${SB_URL}/rest/v1/schedule_data`, {
                                    method: "POST", headers: H,
                                    body: JSON.stringify({ id: "employees_v1", key: "employees_v1", value: JSON.stringify(filtered) })
                                  });
                                  setEmpList(prev => prev.filter(x => x.id !== room.staffId));
                                  setEmpMovePopup(null);
                                } catch (err) { console.error("삭제 실패:", err); alert("삭제 실패: " + err.message); }
                              }} style={{width:"100%",padding:"7px 0",borderRadius:7,border:"1px solid "+T.danger+"44",background:"#fff5f5",color:T.danger,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                                <I name="trash" size={12} color={T.danger}/> 프리랜서 컬럼 삭제
                              </button>
                            </div>;
                          })()}
                        </div>
                      </>)}
                    </div>
                  ) : (
                    <span className="tl-room-sub" style={{fontSize:14,color:room.isNaver?"#FF9800":T.gray500,display:"inline-flex",alignItems:"center",gap:6,fontWeight:800}}>
                      {/* 미배정 칼럼 좌우 이동 화살표 — 첫 미배정(_naverIdx===0)은 고정, 추가분만 이동 */}
                      {room.isNaver && typeof room._naverIdx === "number" && room._naverIdx > 0 && (
                        <button title="왼쪽으로" disabled={!(room._shift > 0)} onClick={e=>{e.stopPropagation();moveNaverCol(room.branch_id, room._naverIdx, -1);}}
                          style={{width:18,height:18,padding:0,border:"none",background:"transparent",color:room._shift>0?T.gray500:T.gray300,cursor:room._shift>0?"pointer":"default",fontSize:12,lineHeight:1,fontWeight:700,opacity:room._shift>0?.7:.3}}
                          onMouseEnter={e=>{if(room._shift>0){e.currentTarget.style.opacity="1";e.currentTarget.style.color="#FF9800";}}}
                          onMouseLeave={e=>{if(room._shift>0){e.currentTarget.style.opacity=".7";e.currentTarget.style.color=T.gray500;}}}>◀</button>
                      )}
                      {room.isBlockCol ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.4" strokeLinecap="round" style={{display:"block"}}>
                          <circle cx="12" cy="12" r="9"/>
                          <line x1="6" y1="12" x2="18" y2="12"/>
                        </svg>
                      ) : room.name}
                      {room.isNaver && typeof room._naverIdx === "number" && room._naverIdx > 0 && (
                        <button title="오른쪽으로" disabled={!(room._shift < (room._maxShift||0))} onClick={e=>{e.stopPropagation();moveNaverCol(room.branch_id, room._naverIdx, 1);}}
                          style={{width:18,height:18,padding:0,border:"none",background:"transparent",color:room._shift<(room._maxShift||0)?T.gray500:T.gray300,cursor:room._shift<(room._maxShift||0)?"pointer":"default",fontSize:12,lineHeight:1,fontWeight:700,opacity:room._shift<(room._maxShift||0)?.7:.3}}
                          onMouseEnter={e=>{if(room._shift<(room._maxShift||0)){e.currentTarget.style.opacity="1";e.currentTarget.style.color="#FF9800";}}}
                          onMouseLeave={e=>{if(room._shift<(room._maxShift||0)){e.currentTarget.style.opacity=".7";e.currentTarget.style.color=T.gray500;}}}>▶</button>
                      )}
                      {/* 프리랜서 삭제 버튼 */}
                      {room.isStaffCol && room.staffId && (() => {
                        const emp = empList.find(e => e.id === room.staffId);
                        if (!emp?.isFreelancer) return null;
                        return <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`"${room.staffId}" 컬럼을 삭제할까요?\n(이 지점의 모든 날짜에서 제거됩니다)`)) return;
                            const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
                            try {
                              const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: H });
                              const rows = await r.json();
                              const raw = rows?.[0]?.value;
                              const existing = typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
                              const filtered = existing.filter(x => x.id !== room.staffId);
                              await fetch(`${SB_URL}/rest/v1/schedule_data`, {
                                method: "POST", headers: H,
                                body: JSON.stringify({ id: "employees_v1", key: "employees_v1", value: JSON.stringify(filtered) })
                              });
                              setEmpList(prev => prev.filter(x => x.id !== room.staffId));
                            } catch (err) { console.error("삭제 실패:", err); alert("삭제 실패: " + err.message); }
                          }}
                          title="프리랜서 컬럼 삭제"
                          style={{width:14,height:14,borderRadius:"50%",border:"none",background:T.gray200,color:T.gray500,cursor:"pointer",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1}}
                          onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger;}}
                          onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500;}}
                        >×</button>;
                      })()}
                    </span>
                  )}
                  {/* 빈 미배정 칼럼 삭제 버튼 — 우상단 절대위치 */}
                  {room.isExtraCol && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canEdit(room.branch_id)) return;
                        if (!confirm(`이 빈 미배정 칼럼을 삭제할까요?\n(달려있던 예약은 남은 미배정 칼럼으로 자동 이관됩니다)`)) return;
                        removeExtraCol(room.branch_id);
                      }}
                      title="미배정 칼럼 삭제"
                      style={{position:"absolute",top:3,right:3,width:16,height:16,borderRadius:"50%",border:"none",background:T.gray200,color:T.gray500,cursor:"pointer",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1,zIndex:11}}
                      onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger;}}
                      onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500;}}
                    >×</button>
                  )}
                </div>
                {/* Grid Area */}
                <div style={{position:"relative",height:totalRows*rowH,cursor:(room.isBlank&&room.isAddCol)?"pointer":room.isBlank?"default":(canEdit(room.branch_id)?"pointer":"default"),boxShadow:"0 4px 8px -2px rgba(0,0,0,0.12)",...gridBg}}
                  onClick={e=>{
                    // 막기 칼럼: 시간 슬롯 클릭 → 4개 시술 토글 팝업 (30분 단위 스냅)
                    if (room.isBlockCol) {
                      const rectB = e.currentTarget.getBoundingClientRect();
                      const tm = yToTime(e.clientY - rectB.top);
                      const [_h, _m] = tm.split(':').map(Number);
                      const totalMin = _h * 60 + _m;
                      const snappedMin = Math.floor(totalMin / 30) * 30;
                      const sh = Math.floor(snappedMin / 60), sm = snappedMin % 60;
                      const snappedTm = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
                      const slotIdx = snappedMin / 30;
                      setBlockSlotPopup({
                        bizId: room._naverBizId,
                        branchId: room.branch_id,
                        date: selDate,
                        slotIdx,
                        time: snappedTm,
                        x: e.clientX,
                        y: e.clientY,
                      });
                      // 안전장치 5: 팝업 열 때 강제 refetch (사용자가 막기 누르기 직전 최신화)
                      try { fetchNaverBlockStateRef.current?.(); } catch {}
                      return;
                    }
                    // + 칼럼: 매일 반복 내부일정 템플릿 생성
                    if(room.isBlank && room.isAddCol) {
                      if(!canEdit(room.branch_id)) return;
                      const rect3=e.currentTarget.getBoundingClientRect();
                      const time=yToTime(e.clientY-rect3.top);
                      setModalData({bid:room.branch_id, time, date:selDate, isSchedule:true, _isColTemplate:true, dur:30});
                      setShowModal(true);
                      return;
                    }
                    // 비활성 시간대: 내부일정만 허용
                    if(room.isStaffCol && room.activeSegments) {
                      const rect2=e.currentTarget.getBoundingClientRect();
                      const clickMin = startHour*60 + Math.floor((e.clientY-rect2.top)/rowH)*5;
                      const inActive = room.activeSegments.some(s => {
                        const f = s.from ? parseInt(s.from.split(":")[0])*60+parseInt(s.from.split(":")[1]) : 0;
                        const u = s.until ? parseInt(s.until.split(":")[0])*60+parseInt(s.until.split(":")[1]) : 24*60;
                        return clickMin >= f && clickMin < u;
                      });
                      if(!inActive) {
                        // 근무 외 시간 → 내부일정 모드로 모달 열기
                        // ⚠️ 드래그 직후 mouseup이 onClick으로 올라오는 케이스 차단 (유저 피드백: 블록 위로 드래그 시 새 모달 뜸)
                        if (isDragging.current || isResizing.current) return;
                        if(!canEdit(room.branch_id)) return;
                        const h=Math.floor(clickMin/60), m=clickMin%60;
                        const time=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                        setModalData({roomId:"",staffId:room.staffId,bid:room.branch_id,time,date:selDate,isSchedule:true});
                        setShowModal(true);
                        return;
                      }
                    }
                    const rect=e.currentTarget.getBoundingClientRect();handleCellClick(room,e.clientY-rect.top);
                  }}
                  onMouseMove={e=>{if(room.isBlank)return;const rect=e.currentTarget.getBoundingClientRect();const y=e.clientY-rect.top;const ri=Math.floor(y/rowH);setHoverCell({roomId:room.id,rowIdx:ri})}}
                  onMouseLeave={()=>setHoverCell(null)}
                  onTouchStart={e=>{
                    lastTouchCell.current=Date.now();
                    if(room.isBlank||!canEdit(room.branch_id))return;
                    const t=e.touches[0];const rect=e.currentTarget.getBoundingClientRect();
                    const y=t.clientY-rect.top;const ri=Math.floor(y/rowH);
                    setHoverCell({roomId:room.id,rowIdx:ri});
                    cellLongPress.current={moved:false,y,room};
                  }}
                  onTouchMove={e=>{
                    if(cellLongPress.current)cellLongPress.current.moved=true;
                    clearTimeout(cellLongPress.current?.timer);
                    if(room.isBlank)return;
                    const t=e.touches[0];const rect=e.currentTarget.getBoundingClientRect();
                    const y=t.clientY-rect.top;const ri=Math.floor(y/rowH);
                    setHoverCell({roomId:room.id,rowIdx:ri});
                  }}
                  onTouchEnd={(e)=>{
                    const lp=cellLongPress.current;cellLongPress.current=null;
                    if(lp&&!lp.moved){
                      // 막기 칼럼: 예약막기 팝업 (예약 등록 모달 X)
                      if (lp.room.isBlockCol) {
                        const tm = yToTime(lp.y);
                        const [_h, _m] = tm.split(':').map(Number);
                        const totalMin = _h * 60 + _m;
                        const snappedMin = Math.floor(totalMin / 30) * 30;
                        const sh = Math.floor(snappedMin / 60), sm = snappedMin % 60;
                        const snappedTm = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
                        const slotIdx = snappedMin / 30;
                        const t = e.changedTouches?.[0];
                        setBlockSlotPopup({
                          bizId: lp.room._naverBizId,
                          branchId: lp.room.branch_id,
                          date: selDate,
                          slotIdx,
                          time: snappedTm,
                          x: t?.clientX || 0,
                          y: t?.clientY || 0,
                        });
                        try { fetchNaverBlockStateRef.current?.(); } catch {}
                        setTimeout(()=>setHoverCell(null),300);
                        return;
                      }
                      const time=yToTime(lp.y);
                      // 직원/미배정 컬럼 처리 (데스크탑 handleCellClick과 동일 동작)
                      setModalData({
                        roomId: (lp.room.isStaffCol || lp.room.isNaver) ? "" : lp.room.id,
                        bid: lp.room.branch_id,
                        time, date: selDate,
                        staffId: lp.room.isStaffCol ? lp.room.staffId : undefined,
                      });
                      setShowModal(true);
                    }
                    setTimeout(()=>setHoverCell(null),300);
                  }}
                >
                  {/* Hover/touch highlight */}
                  {/* 비활성 시간대 오버레이 (복수 세그먼트) + 출/퇴근 드래그 핸들 */}
                  {room.isStaffCol && room.activeSegments && (()=>{
                    const startMin2 = startHour*60;
                    const endMin2 = startMin2 + totalRows*5;
                    const parsed = room.activeSegments.map(s => ({
                      from: s.from ? parseInt(s.from.split(":")[0])*60+parseInt(s.from.split(":")[1]) : startMin2,
                      until: s.until ? parseInt(s.until.split(":")[0])*60+parseInt(s.until.split(":")[1]) : endMin2,
                    })).sort((a,b)=>a.from-b.from);
                    // segments 바깥의 빈 구간들 = 비활성
                    const inactive = [];
                    let cursor = startMin2;
                    for (const p of parsed) {
                      if (p.from > cursor) inactive.push({from: cursor, until: p.from});
                      cursor = Math.max(cursor, p.until);
                    }
                    if (cursor < endMin2) inactive.push({from: cursor, until: endMin2});
                    if (inactive.length === 0) return null;

                    const mnToTime = (mn) => `${String(Math.floor(mn/60)).padStart(2,"0")}:${String(mn%60).padStart(2,"0")}`;
                    const onWhDragStart = (boundary) => (ev) => {
                      ev.stopPropagation(); ev.preventDefault();
                      const isTouch = ev.type === "touchstart";
                      const grid = ev.currentTarget.parentElement;
                      const rect = grid.getBoundingClientRect();
                      const onMv = (e2) => {
                        const pt = isTouch ? e2.touches[0] : e2;
                        if (!pt) return;
                        const y = Math.max(0, Math.min(grid.clientHeight, pt.clientY - rect.top));
                        const slot = Math.round(y / rowH);
                        const newMn = startMin2 + slot * 5;
                        const t = mnToTime(Math.max(startMin2, Math.min(endMin2, newMn)));
                        const whKey = room.staffId+"_"+room.branch_id+"_"+selDate;
                        const wh = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id] || {start: room.activeFrom||mnToTime(startMin2), end: room.activeUntil||mnToTime(endMin2)};
                        const newWh = boundary === "start" ? {...wh, start: t} : {...wh, end: t};
                        setEmpWorkHours(p=>({...p, [whKey]: newWh}));
                      };
                      const onUp = () => {
                        document.removeEventListener(isTouch?"touchmove":"mousemove", onMv);
                        document.removeEventListener(isTouch?"touchend":"mouseup", onUp);
                      };
                      document.addEventListener(isTouch?"touchmove":"mousemove", onMv, {passive:false});
                      document.addEventListener(isTouch?"touchend":"mouseup", onUp);
                    };
                    const firstSeg = parsed[0];
                    const lastSeg = parsed[parsed.length-1];
                    return <>
                      {inactive.map((iv, idx) => {
                        const top = (iv.from - startMin2) / 5 * rowH;
                        const height = (iv.until - iv.from) / 5 * rowH;
                        const isBefore = iv.from === startMin2 && iv.until === firstSeg.from;
                        const isAfter = iv.from === lastSeg.until && iv.until === endMin2;
                        return <div key={idx} style={{
                          position:"absolute", top, left:0, right:0, height,
                          background:"rgba(0,0,0,.06)", zIndex:2, pointerEvents:"none",
                        }}/>;
                      })}
                      {/* 출근 드래그 핸들 (첫 세그먼트 시작) */}
                      {firstSeg.from > startMin2 && <div onMouseDown={onWhDragStart("start")} onTouchStart={onWhDragStart("start")}
                        style={{position:"absolute",top:(firstSeg.from-startMin2)/5*rowH-6,left:0,right:0,height:12,cursor:"ns-resize",zIndex:4}}
                        title={`출근 ${room.activeFrom||""} (드래그)`}/>}
                      {/* 퇴근 드래그 핸들 (마지막 세그먼트 종료) */}
                      {lastSeg.until < endMin2 && <div onMouseDown={onWhDragStart("end")} onTouchStart={onWhDragStart("end")}
                        style={{position:"absolute",top:(lastSeg.until-startMin2)/5*rowH-6,left:0,right:0,height:12,cursor:"ns-resize",zIndex:4}}
                        title={`퇴근 ${room.activeUntil||""} (드래그)`}/>}
                    </>;
                  })()}
                  {!dragBlock && hoverCell?.roomId===room.id && hoverCell.rowIdx>=0 && (()=>{
                    if (room.isBlockCol) {
                      // 막기 칼럼: 30분 슬롯 전체 하이라이트 (네이버 예약 단위)
                      const startMinB = startHour * 60;
                      const absMin = startMinB + hoverCell.rowIdx * timeUnit;
                      const slotStartAbs = Math.floor(absMin / 30) * 30;
                      const snappedTop = ((slotStartAbs - startMinB) / timeUnit) * rowH;
                      const slotH = (30 / timeUnit) * rowH;
                      // 입체 슬롯이 진해지는 hover (빨간 박스 X)
                      return <div style={{position:"absolute",top:snappedTop,left:1,right:1,height:slotH,borderRadius:6,background:"linear-gradient(180deg, rgba(0,0,0,.04) 0%, rgba(0,0,0,.14) 100%)",boxShadow:"inset 0 1px 2px rgba(255,255,255,.5), inset 0 -3px 6px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.08)",zIndex:3,pointerEvents:"none",transition:"top 0.05s ease"}}/>;
                    }
                    return <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.12)",borderTop:"1px solid rgba(124,124,200,0.3)",borderBottom:"1px solid rgba(124,124,200,0.3)",zIndex:1,pointerEvents:"none",transition:"top 0.05s ease"}}/>;
                  })()}
                  {/* Row crosshair highlight (other columns) — 드래그 중 숨김 */}
                  {!dragBlock && hoverCell && hoverCell.roomId!==room.id && hoverCell.rowIdx>=0 && <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.04)",zIndex:1,pointerEvents:"none"}}/>}
                  {/* Current time */}
                  {nowY > 0 && <div style={{position:"absolute",top:nowY,left:0,right:0,borderTop:"2px solid #e57373",zIndex:5}}>
                    <div style={{position:"absolute",top:-4,left:-1,width:8,height:8,borderRadius:T.radius.sm,background:T.danger}}/>
                  </div>}
                  {/* 막기 칼럼: 30분 슬롯 가이드 + 시술별 막힘 인디케이터 (그 슬롯에 노출되는 시술만 카운트) */}
                  {room.isBlockCol && (()=>{
                    const slotPx = (30 / timeUnit) * rowH;
                    const startMinB = startHour * 60;
                    const itemsStateAll = naverBlockState[room._naverBizId]?.[selDate] || {};
                    const itemsState = Object.fromEntries(Object.entries(itemsStateAll).filter(([_, v]) => v.is_active !== false));
                    const itemIds = Object.keys(itemsState);
                    const out = [];
                    // 슬롯 인디케이터 — 슬롯별로 노출(-)·막힘(0)·가능(1) 분리 카운트
                    for (let slotIdx = 0; slotIdx < 48; slotIdx++) {
                      const slotMin = slotIdx * 30;
                      const offsetFromStart = slotMin - startMinB;
                      if (offsetFromStart < 0 || offsetFromStart >= totalRows * timeUnit) continue;
                      const top = (offsetFromStart / timeUnit) * rowH;
                      // 그 슬롯에 노출되는 시술만 (bit이 '0' 또는 '1')
                      const visibleIds = itemIds.filter(iid => {
                        const bit = itemsState[iid].hour_bit?.[slotIdx];
                        return bit === '0' || bit === '1';
                      });
                      const slotTotal = visibleIds.length;
                      const blockedCount = visibleIds.filter(iid => itemsState[iid].hour_bit[slotIdx] === '0').length;
                      if (slotTotal > 0 && blockedCount > 0) {
                        const NAVER_GREEN = '#03C75A';
                        const BLOCK_GRAY = '#9CA3AF';
                        const fullyBlocked = blockedCount === slotTotal;
                        const dots = visibleIds.map((iid, i) => {
                          const isBlocked = itemsState[iid].hour_bit[slotIdx] === '0';
                          return <span key={i} style={{
                            display:'block', width:7, height:7, borderRadius:'50%',
                            background: isBlocked ? BLOCK_GRAY : NAVER_GREEN,
                          }}/>;
                        });
                        const cellBg = fullyBlocked ? "rgba(0,0,0,.06)" : "rgba(156,163,175,.10)";
                        const cellBorder = fullyBlocked ? "2px dashed rgba(0,0,0,.12)" : "1px solid rgba(0,0,0,.06)";
                        out.push(
                          <div key={`s${slotIdx}`} style={{position:"absolute",top,left:0,right:0,height:slotPx,background:cellBg,borderTop:cellBorder,pointerEvents:"none",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}>
                            {dots}
                          </div>
                        );
                      }
                    }
                    // 30분 가이드 — 미배정 칼럼과 동일 배경색 + 그림자 유지, 라운드 축소
                    const firstOffsetMin = (30 - (startMinB % 30)) % 30;
                    for (let mn = firstOffsetMin; mn < totalRows * timeUnit; mn += 30) {
                      const top = (mn / timeUnit) * rowH;
                      const slotH = (30 / timeUnit) * rowH;
                      out.push(
                        <div key={`sl${mn}`} style={{position:"absolute",top,left:1,right:1,height:slotH,borderRadius:3,background:"#E8F5E9",boxShadow:"inset 0 1px 2px rgba(255,255,255,.7), inset 0 -2px 4px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.04)",pointerEvents:"none",zIndex:2}}/>
                      );
                    }
                    return <>{out}</>;
                  })()}
                  {/* Blocks */}
                  {(() => {
                    // ── 겹침 감지 + 좌우 분할 (Google Calendar 방식) ──
                    const layoutBlocks = (blocks) => {
                      if (blocks.length <= 1) return blocks.map(b => ({...b, _col:0, _totalCols:1}));
                      const sorted = [...blocks].sort((a,b) => timeToY(a.time) - timeToY(b.time));
                      // 실제 duration 기준 종료 시각 — 짧은 블록에 가짜 버퍼 주면 인접 블록과 겹침 오판됨
                      const blockEnd = (b) => timeToY(b.time) + (b.dur/timeUnit)*rowH;
                      // Group overlapping blocks
                      const groups = []; let cur = [sorted[0]];
                      for (let i=1; i<sorted.length; i++) {
                        const bk = sorted[i];
                        const bkY = timeToY(bk.time);
                        const grpMaxEnd = Math.max(...cur.map(blockEnd));
                        if (bkY < grpMaxEnd - 1) { cur.push(bk); }
                        else { groups.push(cur); cur = [bk]; }
                      }
                      groups.push(cur);
                      const result = [];
                      for (const grp of groups) {
                        // Assign columns: greedy left-first
                        const cols = [];
                        for (const bk of grp) {
                          const bkStart = timeToY(bk.time);
                          const bkEnd = blockEnd(bk);
                          let placed = false;
                          for (let c=0; c<cols.length; c++) {
                            if (bkStart >= cols[c]) { cols[c] = bkEnd; result.push({...bk, _col:c, _totalCols:0}); placed=true; break; }
                          }
                          if (!placed) { cols.push(bkEnd); result.push({...bk, _col:cols.length-1, _totalCols:0}); }
                        }
                        const totalCols = cols.length;
                        for (let r = result.length - grp.length; r < result.length; r++) result[r]._totalCols = totalCols;
                      }
                      return result;
                    };
                    return layoutBlocks(roomBlocks).map(block => {
                    const y = timeToY(block.time);
                    const isBeingResized = resizeBlock?.id === block.id;
                    const blockDur = isBeingResized ? resizeDur : blockDurMin(block);
                    const h = (blockDur / timeUnit) * rowH;
                    // 서비스태그 색상 우선 적용
                    const tags = data?.serviceTags || [];
                    const tagColor = block.type==="reservation" && block.selectedTags?.length
                      ? (block.selectedTags.map(tid=>tags.find(t=>t.id===tid)).find(t=>t?.color)?.color || "")
                      : "";
                    // 취소/대기 상태 처리 — naver_cancelled와 일반 cancelled 모두 취소 스타일 적용
                    const isNaverCancelled = block.status === "naver_cancelled" || block.status === "cancelled";
                    const isNaverPending = (block.status === "pending" || block.status === "request") && !(block.memo && block.memo.includes("확정완료"));
                    // 네이버 예약이고 아직 일반 칼럼에 미배정 (roomId 없거나 nv_ 접두)
                    const isNaverUnassigned = !!block.reservationId && !block.staffId && (!block.roomId || block.roomId.startsWith("nv_"));
                    const stClr = block.type==="reservation" && !block.isSchedule && statusClr[block.status];
                    const color = isNaverCancelled ? T.warning : (stClr || tagColor || BLOCK_COLORS[block.type] || T.primary);
                    const staff = (data.staff||[]).find(s=>s.id===block.staffId);
                    const isDrag = dragBlock?.id === block.id;
                    const isSch = block.isSchedule;
                    const isEditable = canEdit(block.bid);
                    const opHex = (pct) => Math.round(pct * 2.55).toString(16).padStart(2,"0");
                    const bgAlpha = isSch ? opHex(Math.min(blockOp, 80)) : opHex(blockOp);
                    return (
                      <div key={block.id} data-rid={block.reservationId||block.id}
                        onMouseEnter={e=>{
                          // 모바일에선 mouseenter가 터치 후 발생 → 모달 뒤에 남는 문제. 팝업 자체 비활성
                          if (window.innerWidth <= 768 || ('ontouchstart' in window)) return;
                          const memo = (block.memo||"").split("\n").filter(l => { const t=l.trim(); return !(/^\[등록:|^\[수정:/.test(t)) && !(/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)); }).join("\n").trim();
                          // 메모가 블록 높이(rowH*3 = 전체 보임) 안에 다 들어가면 팝업 불필요
                          if (!memo || memo.length < 30) return;
                          const r = e.currentTarget.getBoundingClientRect();
                          setMemoPopup({ id: block.id, memo, x: r.left, y: r.top - 6 });
                        }}
                        onMouseLeave={()=>setMemoPopup(p => p?.id === block.id ? null : p)}
                        onClick={e=>{
                          e.stopPropagation();
                          // 🔴 빨강 깜빡임 하이라이트 클릭 시 사라짐 — 모달 안 열고 하이라이트만 해제
                          const _rid = block.reservationId || block.id;
                          if (highlightedBlockId && (highlightedBlockId === _rid || highlightedBlockId === block.id)) {
                            setHighlightedBlockId(null);
                            return;
                          }
                          if (block._isColTemplate) {
                            // 템플릿 편집: 모달 열기
                            setModalData({
                              id: block.id, _isColTemplate: true, _templateId: block.id,
                              bid: block.bid, time: block.time, dur: block.dur, date: selDate,
                              isSchedule: true, selectedTags: [...(block.selectedTags||[])], memo: block.memo||""
                            });
                            setShowModal(true);
                            return;
                          }
                          handleBlockClick(block,e);
                        }}
                        onMouseDown={e=>{
                          if (block._isColTemplate) {
                            if (isEditable) handleTplDragStart(block, e);
                            return;
                          }
                          if(isEditable && !isResizing.current)handleDragStart(block,e);
                        }}
                        onTouchStart={e=>{
                          if (block._isColTemplate) {
                            if (isEditable) handleTplDragStart(block, e);
                            return;
                          }
                          if(isEditable && !isResizing.current)handleDragStart(block,e);
                        }}
                        onContextMenu={e=>e.preventDefault()}
                        style={(()=>{
                          const _saleAmt = salesByResId.get(block.id) || 0;
                          const _hlOn = salesHighlight.min > 0 && _saleAmt >= salesHighlight.min && !isNaverCancelled;
                          const _hlC = salesHighlight.color || "#FFD700";
                          const _hlMode = salesHighlight.mode || "border";
                          // 🔴 외부 하이라이트 (메시지함/확정대기 클릭) — 빨강 테두리 깜빡임
                          const _isHL = highlightedBlockId && (highlightedBlockId === (block.reservationId||block.id) || highlightedBlockId === block.id);
                          // 상태별 색상이 정해진 예약(취소/노쇼/완료)은 미배정으로 가도 상태 색상 유지
                          const _hasStatusColor = block.status === "no_show" || block.status === "completed";
                          const _baseBg = isNaverCancelled?T.warningLt:_hasStatusColor?`${color}${bgAlpha}`:isNaverUnassigned?T.infoLt:isNaverPending?`${color}15`:`${color}${bgAlpha}`;
                          return {position:"absolute",top:y,
                          left: block._totalCols > 1 ? 1 + (block._col * ((colW - 2) / block._totalCols)) : 1,
                          width: block._totalCols > 1 ? ((colW - 2) / block._totalCols) - 1 : undefined,
                          right: block._totalCols > 1 ? undefined : 1,
                          height:Math.max(h-1,10),
                          background: _hlOn && _hlMode === "fill" ? _hlC : _baseBg,
                          border: _isHL ? "3px solid #ef4444" : (_hlOn && _hlMode === "border" ? `2px solid ${_hlC}` : "none"),
                          borderRadius:4,padding:"4px 6px",overflow:"hidden",fontSize:blockFs,lineHeight:1.2,
                          boxShadow: isDrag ? "none" : (_isHL ? "0 0 0 2px #fff, 0 0 12px #ef4444" : (_hlOn && _hlMode === "border" ? `0 0 0 1px ${_hlC}, 0 2px 10px ${_hlC}99` : "0 1px 4px rgba(0,0,0,.1)")),
                          cursor:"pointer",zIndex:isDrag?0:(_isHL?6:(_hlOn?4:3)),transition:(isDrag||isBeingResized)?"none":"all .15s, box-shadow .2s",
                          animation: _isHL ? "blissHlBlink 1s ease-in-out infinite" : undefined,
                          opacity:isDrag?0.35:1,userSelect:"none",WebkitUserSelect:"none",MozUserSelect:"none",msUserSelect:"none",WebkitTouchCallout:"none",touchAction:"pan-x pan-y"};
                        })()}
                        className="tl-block">
                        {block.type==="reservation" && !block.isSchedule && <>
                          <div style={{display:"flex",alignItems:"center",gap:2,flexWrap:"wrap"}}>
                            {/* 태그 - 이름 앞에 */}
                            {isNaverCancelled && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.warning,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>취소</span>}
                            {isNaverUnassigned && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.info,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>미배정</span>}
                            {isNaverPending && !isNaverUnassigned && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.orange,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0,animation:"pendingBlink 1.5s infinite"}}>대기</span>}
                            {effectiveNaverColShow["태그"] !== false && block.selectedTags?.slice(0,3).map(tid=>{
                              const tg=tags.find(t=>t.id===tid);
                              if(!tg) return null;
                              const bg=tg.color||T.primary;
                              const h=bg.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
                              const txt=(0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard;
                              return <span key={tid} style={{fontSize:Math.max(6,blockFs-2),padding:"1px 4px",borderRadius:T.radius.sm,background:bg,color:txt,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>{tg.name}</span>;
                            })}
                            {effectiveNaverColShow["태그"] !== false && block.selectedTags?.length>3 && <span style={{fontSize:Math.max(6,blockFs-2),color:T.bgCard,background:T.gray500,borderRadius:T.radius.sm,padding:"1px 2px",flexShrink:0}}>+{block.selectedTags.length-3}</span>}
                            {/* 이름 */}
                            <span style={{fontWeight:T.fw.bold,color:isNaverCancelled?T.gray500:T.text,textDecoration:isNaverCancelled?"line-through":"none",flexShrink:1,minWidth:0}}>
                              {(() => {
                                const liveCust = block.custId ? ((data?.customers||[]).find(c=>c.id===block.custId) || custInfoMap[block.custId]) : null;
                                const g = block.custGender || liveCust?.gender || "";
                                const displayName = liveCust?.name || block.custName;
                                const custNum = liveCust?.custNum || liveCust?.cust_num || "";
                                const _cp = Number(liveCust?.cancelPenaltyCount || 0);
                                const _ns = Number(liveCust?.noShowCount || 0);
                                const isCaution = _cp >= 3 || _ns >= 1;
                                return <>
                                  {g ? <span style={{color:g==="M"?T.male:T.female}}>{g==="M"?"남":"여"}</span> : null} {displayName}
                                  {custNum && <span style={{marginLeft:3,fontSize:Math.max(7,blockFs-2),color:T.text,fontWeight:T.fw.bold,fontFamily:"monospace"}}>#{custNum}</span>}
                                  {isCaution && <span title={`페널티 취소 ${_cp}회 / 노쇼 ${_ns}회`} style={{marginLeft:3,fontSize:Math.max(8,blockFs-1)}}>⚠️</span>}
                                </>;
                              })()}
                            </span>
                          </div>
                          {effectiveNaverColShow["시술"] !== false && block.selectedServices?.length>0 && <div style={{fontSize:Math.max(6,blockFs-2),color:T.text,fontWeight:T.fw.bold,marginTop:1}}>
                            {groupSvcNames(block.selectedServices, SVC_LIST).slice(0,2).join(", ")}
                            {block.selectedServices.length>2 && ` +${block.selectedServices.length-2}`}
                          </div>}
                          {effectiveNaverColShow["보유권"] !== false && block.custId && custPkgMap[block.custId]?.length > 0 && (() => {
                            // 같은 이름 패키지 그룹화 + 우선순위 정렬
                            const grouped = {};
                            (custPkgMap[block.custId] || []).forEach(pkg => {
                              const key = pkg.name + "_" + (pkg.isDadam ? "dadam" : "pkg");
                              if (!grouped[key]) grouped[key] = {...pkg, count: 0, totalRemain: 0};
                              grouped[key].count += 1;
                              grouped[key].totalRemain += pkg.remain;
                            });
                            // 우선순위: 다담권(prepaid) > 재생 > 토탈 > 기타 > 소급
                            const PRIORITY = ["다담", "선불", "재생", "토탈", "풀페이스", "왁싱", "케어"];
                            const priOf = (name) => {
                              if (/소급/.test(name)) return 999;
                              const idx = PRIORITY.findIndex(k => name.includes(k));
                              return idx < 0 ? 500 : idx;
                            };
                            const sorted = Object.values(grouped).sort((a, b) => {
                              if (a.isDadam !== b.isDadam) return a.isDadam ? -1 : 1;
                              return priOf(a.name) - priOf(b.name);
                            });
                            return <div style={{display:"flex",gap:2,flexWrap:"wrap",marginTop:1}}>
                              {sorted.slice(0,4).map((pkg,pi) => <span key={pi} style={{
                                fontSize:Math.max(6,blockFs-3),padding:"0px 3px",borderRadius:3,lineHeight:"14px",fontWeight:700,
                                background:pkg.isMembership?"#d4edda":pkg.isDadam?"#ffeaa7":"#dfe6e9",
                                color:pkg.isMembership?"#1f6b3a":pkg.isDadam?"#d35400":"#2d3436"
                              }}>
                                {pkg.isMembership
                                  ? pkg.name.replace(/\s*\d+회\s*$/, "").trim()
                                  : pkg.isDadam
                                    ? `${pkg.name} ${(()=>{const n=pkg.totalRemain;if(!n)return "0";const m=n/10000;return (m===Math.floor(m)?Math.floor(m):Math.round(m*10)/10)+"만";})()}`
                                    : `${pkg.name.replace(/\s*\d+회\s*$/, "").trim()} +${pkg.totalRemain}`}
                              </span>)}
                              {sorted.length>4 && <span style={{fontSize:Math.max(6,blockFs-3),color:T.gray400}}>+{sorted.length-4}</span>}
                            </div>;
                          })()}
                          {h >= rowH * 3 && (()=>{
                            // 체크된 네이버 필드만 표시
                            const checkedCols = NAVER_COLS.filter(col => effectiveNaverColShow[col.key] !== false);
                            const naverParts = checkedCols
                              .map(col => getNaverVal(block.requestMsg, col.kws))
                              .filter(Boolean);
                            const memo = block.ownerComment || "";
                            if (!naverParts.length && !memo) return null;
                            return <div style={{marginTop:2,fontSize:Math.max(6,blockFs-2),color:T.gray700,whiteSpace:"pre-line",wordBreak:"break-word"}}>
                              {naverParts.join("\n")}
                              {naverParts.length>0 && memo && effectiveNaverColShow["직원메모"] !== false && "\n"}
                              {memo && effectiveNaverColShow["직원메모"] !== false && <span style={{color:T.male}}>{memo}</span>}
                            </div>;
                          })()}
                        </>}
                        {block.type==="reservation" && block.isSchedule && (() => {
                          const tagNames = (block.selectedTags||[]).map(tid=>{const tg=tags.find(t=>t.id===tid);return tg?.name}).filter(Boolean).join(", ");
                          return tagNames ? <div style={{fontWeight:T.fw.normal,color:T.text,fontSize:blockFs}}>{tagNames}</div> : null;
                        })()}
                        {block.type==="memo" && <div style={{color:T.danger,fontWeight:T.fw.black}}><I name="fileText" size={10} color={T.danger}/> 메모</div>}
                        {block.type==="clockin" && <div style={{color:T.gray600,fontWeight:T.fw.bold}}><I name="clock" size={10} color={T.gray600}/> {staff?.dn||"출근"}</div>}
                        {block.type==="cleaning" && <div style={{color:T.info,fontWeight:T.fw.bold}}><I name="sparkles" size={10} color={T.info}/> 청소</div>}
                        {effectiveNaverColShow["블록메모"] !== false && block.memo && (() => { const clean = block.memo.split("\n").filter(l => { const t=l.trim(); return !(/^\[등록:|^\[수정:/.test(t)) && !(/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)); }).join("\n").trim(); return clean ? <div style={{color:block.isSchedule?T.text:T.gray700,fontWeight:T.fw.normal,fontSize:Math.max(6,blockFs-1),marginTop:1,whiteSpace:"pre-line",wordBreak:"break-word"}}><I name="msgSq" size={10} color={T.gray600}/> {clean}</div> : null; })()}
                        {/* Resize handle — 넓은 히트 영역 */}
                        {isEditable && <div className="resize-handle" onMouseDown={e=>handleResizeStart(block,e)} onTouchStart={e=>handleResizeStart(block,e)}
                          style={{position:"absolute",bottom:-10,left:"10%",right:"10%",height:20,cursor:"ns-resize",
                            display:"flex",alignItems:"center",justifyContent:"center",opacity:0.5,transition:"opacity .15s",zIndex:3,touchAction:"none"}}>
                          <div style={{width:32,height:4,borderRadius:T.radius.sm,background:color,opacity:0.8}}/>
                        </div>}
                        {isBeingResized && <div style={{position:"absolute",bottom:2,right:4,fontSize:Math.max(6,blockFs-2),fontWeight:T.fw.bolder,color,background:T.bgCard,padding:"0 3px",borderRadius:T.radius.sm}}>
                          {blockDur}분
                        </div>}
                      </div>
                    );
                  })})()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 메모 호버 팝업 — 긴 블록메모만 전체 표시 (블록 위로, 반투명) */}
      {memoPopup && (() => {
        const px = Math.max(8, Math.min(memoPopup.x, window.innerWidth - 240));
        const py = Math.max(40, memoPopup.y);
        return <div style={{position:"fixed",left:px,top:py,zIndex:9998,pointerEvents:"none",
          background:"rgba(255,248,225,.92)",border:"1px solid rgba(245,158,11,.7)",borderRadius:8,padding:"7px 10px",
          boxShadow:"0 4px 16px rgba(0,0,0,.18)",fontSize:11,color:"#4B3200",backdropFilter:"blur(2px)",
          maxWidth:230,whiteSpace:"pre-wrap",wordBreak:"break-word",lineHeight:1.45,
          transform:"translateY(-100%)"}}>
          {memoPopup.memo}
        </div>;
      })()}
      {/* 구글 캘린더식 Floating Drag Preview — 커서 따라 이동, scale 1.03, 강한 그림자 */}
      {dragBlock && dragPos && dragPos.clientX != null && (() => {
        const tags = data?.serviceTags || [];
        const tagColor = dragBlock.type==="reservation" && dragBlock.selectedTags?.length
          ? (dragBlock.selectedTags.map(tid=>tags.find(t=>t.id===tid)).find(t=>t?.color)?.color || "")
          : "";
        const stClr = dragBlock.type==="reservation" && !dragBlock.isSchedule && statusClr[dragBlock.status];
        const color = stClr || tagColor || BLOCK_COLORS[dragBlock.type] || T.primary;
        const opHex = (pct) => Math.round(pct * 2.55).toString(16).padStart(2,"0");
        const bgAlpha = dragBlock.isSchedule ? opHex(Math.min(blockOp, 80)) : opHex(blockOp);
        const w = colW - 6;
        const h = Math.max((dragBlock.dur / timeUnit) * rowH, 10);
        // dragPos.clientX/Y 는 이미 스냅된 셀 좌상단 — 그대로 사용 (transform/scale 제거 → viewport 정확)
        const top2 = dragPos.clientY;
        const left2 = dragPos.clientX;
        return (
          <div style={{position:"fixed",top:top2,left:left2,width:w,height:h,
            background:`${color}${bgAlpha}`,border:`1px solid ${color}`,borderLeft:`3px solid ${color}`,borderRadius:T.radius.md,
            padding:"4px 6px",overflow:"hidden",fontSize:blockFs,lineHeight:1.2,fontWeight:T.fw.bold,color:T.text,
            boxShadow:`0 8px 20px rgba(0,0,0,.25)`,
            pointerEvents:"none",zIndex:9999,cursor:"grabbing",opacity:.92}}>
            {dragBlock.custName || (dragBlock.memo||"").slice(0,30) || ""}
          </div>
        );
      })()}

      {/* 이동/리사이즈 확인 팝업 */}
      {alimtalkConfirm && (() => {
        const item = alimtalkConfirm;
        const isChange = !item._alimtalkType || item._alimtalkType === "change";
        const label = isChange ? "예약 변경" : "예약 확정";
        const notiKey = isChange ? "rsv_change" : "rsv_confirm";
        const sendIt = () => {
          try {
            const branch = (data?.branches||[]).find(b=>b.id===item.bid);
            const rsvUrlId = item.reservationId || item.id || "";
            const rsvUrl = rsvUrlId ? "https://blissme.ai/r.html?"+encodeURIComponent(rsvUrlId) : "";
            queueAlimtalk(branch?.id, notiKey, item.custPhone, {
              "#{사용자명}":branch?.name||"", "#{날짜}":item.date||"", "#{시간}":item.time||"",
              "#{작업자}":item.worker||"", "#{작업장소}":branch?.name||"",
              "#{대표전화번호}":branch?.phone||"", "#{예약URL}":rsvUrl
            });
          } catch(e) { console.warn("예약안내:", e); }
          setAlimtalkConfirm(null);
        };
        const vw = window.innerWidth; const vh = window.innerHeight;
        const popW = Math.min(300, vw - 32);
        return <>
          <div style={{position:'fixed',inset:0,zIndex:9997,background:'rgba(0,0,0,.15)'}} onClick={()=>setAlimtalkConfirm(null)}/>
          <div onClick={e=>e.stopPropagation()} style={{
            position:'fixed', left:(vw-popW)/2, top:'40%',
            width:popW, background:T.bgCard, borderRadius:14,
            boxShadow:'0 8px 32px rgba(0,0,0,.22)', fontFamily:'inherit', zIndex:9998, overflow:'hidden'}}>
            <div style={{padding:'16px 16px 10px', textAlign:'center'}}>
              <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4}}>{label} 예약안내</div>
              <div style={{fontSize:T.fs.xs,color:T.gray600}}>{item.custName} 고객님께 예약안내을 발송하시겠습니까?</div>
            </div>
            <div style={{display:'flex',borderTop:'1px solid '+T.gray100}}>
              <button onClick={()=>setAlimtalkConfirm(null)} style={{flex:1,padding:'12px 0',fontSize:T.fs.sm,fontWeight:600,border:'none',borderRight:'1px solid '+T.gray100,background:'none',color:T.textSub,cursor:'pointer',fontFamily:'inherit'}}>발송 안함</button>
              <button onClick={sendIt} style={{flex:1,padding:'12px 0',fontSize:T.fs.sm,fontWeight:700,border:'none',background:'none',color:T.primary,cursor:'pointer',fontFamily:'inherit'}}>발송</button>
            </div>
          </div>
        </>;
      })()}

      {pendingChange && (() => {
        const { type, block, data: d, orig, branchChanged } = pendingChange;
        const name = block.custName || "일정";
        const fromBr = (data?.branches||[]).find(b=>b.id===block.bid);
        const toBr = branchChanged ? (data?.branches||[]).find(b=>b.id===d.bid) : null;
        const desc = type === "move"
          ? branchChanged
            ? `${name}: ${fromBr?.short||fromBr?.name||""} → ${toBr?.short||toBr?.name||""} (${orig.time}→${d.time})`
            : `${name}: ${orig.time} → ${d.time}`
          : `${name}: ${orig.dur}분 → ${d.dur}분`;
        const popW = Math.min(320, Math.max(260, Math.round(window.innerWidth * 0.8)));
        const vw = window.innerWidth; const vh = window.innerHeight;
        const px = pendingChange.px; const py = pendingChange.py;
        const popH = 112;
        const safeB = 110;
        const popLeft = px != null ? Math.min(Math.max(8, px - popW/2), vw - popW - 8) : (vw - popW)/2;
        const belowY = py != null ? py + 18 : (vh - popH) / 2;
        const aboveY = py != null ? py - popH - 10 : (vh - popH) / 2;
        const rawTop = (belowY + popH + safeB > vh) ? aboveY : belowY;
        const popTop = Math.min(Math.max(8, rawTop), vh - popH - safeB);
        return <>
          <div style={{position:'fixed',inset:0,zIndex:9997}} onClick={()=>_mc(cancelChange)}/>
          <div onClick={e=>e.stopPropagation()} style={{
            position:'fixed', left:popLeft, top:popTop, width:popW,
            background:T.bgCard, borderRadius:14, boxShadow:'0 8px 32px rgba(0,0,0,.22)',
            fontFamily:'inherit', zIndex:9998, overflow:'hidden', animation:'fadeIn .18s ease'}}>
            <div style={{padding:'13px 16px 10px'}}>
              <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:3}}>{type==="move"?"예약 이동":"시간 변경"}</div>
              <div style={{fontSize:T.fs.xs,color:T.gray600}}>{desc}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',borderTop:'1px solid '+T.gray100}}>
              {(()=>{
                const validPhone = block.custPhone && block.custPhone.startsWith("010");
                const isFromUnassigned = !orig.roomId || orig.roomId.startsWith("nv_") || orig.roomId.startsWith("blank_");
                const isAssigning = type==="move" && isFromUnassigned;
                const showAlimtalk = !block.isSchedule && validPhone && !isAssigning;
                return <>
                  {showAlimtalk && <button onClick={()=>_mc(()=>confirmChange(true))} style={{padding:'11px 0',fontSize:T.fs.sm,fontWeight:700,border:'none',borderBottom:'1px solid '+T.gray100,background:'none',color:T.primary,cursor:'pointer',fontFamily:'inherit'}}>확인 + 예약안내 발송</button>}
                  <div style={{display:'flex'}}>
                    <button onClick={()=>_mc(cancelChange)} style={{flex:1,padding:'11px 0',fontSize:T.fs.sm,fontWeight:600,border:'none',borderRight:'1px solid '+T.gray100,background:'none',color:T.textSub,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                    <button onClick={()=>_mc(()=>confirmChange(false))} style={{flex:1,padding:'11px 0',fontSize:T.fs.sm,fontWeight:600,border:'none',background:'none',color:T.text,cursor:'pointer',fontFamily:'inherit'}}>{showAlimtalk?"예약안내 없이 확인":"확인"}</button>
                  </div>
                </>;
              })()}
            </div>
          </div>
        </>;
      })()}

      {/* 알람 설정 모달 */}
      {alarmModal && (()=>{
        const ed = alarmModal.editing || null;
        const initial = ed || {id:"al_"+Math.random().toString(36).slice(2,10), time:alarmModal.time, title:"", note:"", repeat:"once", repeatDays:[1,2,3,4,5], date:selDate, disabled:false, branchId:alarmModal.branchId, createdAt:new Date().toISOString()};
        const brName = (data?.branches||[]).find(b=>b.id===alarmModal.branchId)?.short||"";
        return <AlarmModal initial={initial} brName={brName} onClose={()=>setAlarmModal(null)}
          onSave={(alarm)=>{
            saveAlarms(prev=>{
              const list = prev[alarmModal.branchId]||[];
              const idx = list.findIndex(a=>a.id===alarm.id);
              const newList = idx>=0 ? list.map((a,i)=>i===idx?alarm:a) : [...list, alarm];
              return {...prev, [alarmModal.branchId]: newList};
            });
            setAlarmModal(null);
          }}
          onDelete={ed ? ()=>{
            saveAlarms(prev=>({...prev, [alarmModal.branchId]: (prev[alarmModal.branchId]||[]).filter(a=>a.id!==ed.id)}));
            setAlarmModal(null);
          } : null}
        />;
      })()}
      {/* 알람 발화 토스트 */}
      {alarmFired && <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:"#FEF3C7",border:"2px solid #FBBF24",color:"#92400E",padding:"16px 20px",borderRadius:12,zIndex:9999,boxShadow:"0 8px 32px rgba(0,0,0,0.2)",minWidth:280,maxWidth:400,animation:"pendingBlink 1.5s infinite"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:24}}>🔔</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:15}}>{alarmFired.alarm.title||"알람"}</div>
            <div style={{fontSize:12,color:"#78350F"}}>{alarmFired.alarm.time}</div>
          </div>
        </div>
        {alarmFired.alarm.note && <div style={{fontSize:13,color:"#78350F",marginBottom:10,lineHeight:1.5}}>{alarmFired.alarm.note}</div>}
        <button onClick={()=>setAlarmFired(null)} style={{width:"100%",padding:"8px 0",background:"#F59E0B",color:"#fff",border:"none",borderRadius:6,fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>확인</button>
      </div>}

      {showModal && <TimelineModal item={modalData} onSave={handleSave} onDelete={handleDelete} onDeleteRequest={handleDeleteRequest} naverColShow={naverColShow} onClose={()=>_mc(()=>{setShowModal(false);setModalData(null)})} selBranch={userBranches[0]} userBranches={userBranches} data={{...data, staff: BASE_EMP_LIST.map(e=>({id:e.id,bid:e.branch_id,dn:e.id,name:e.id,branch_id:e.branch_id})), workingStaffIds: (() => { const ws = getWorkingStaff(modalData?.bid || userBranches[0], selDate); return ws ? ws.map(e=>e.id) : null; })() }} setData={setData} setPage={setPage} setPendingChat={setPendingChat} setPendingOpenCust={setPendingOpenCust}/>}

      {showQuickBook && <QuickBookModal
        onClose={()=>setShowQuickBook(false)}
        onParsed={(parsed)=>{
          setShowQuickBook(false);
          // branch 필드로 지점 매칭
          let bid = userBranches[0] || (data.branches||[])[0]?.id;
          if(parsed.branch) {
            const matched = (data.branches||[]).find(b =>
              (b.short||b.name||"").includes(parsed.branch) || parsed.branch.includes(b.short||b.name||"")
            );
            if(matched) bid = matched.id;
          }
          // 전화번호로 기존 고객 검색
          const phone = (parsed.custPhone||"").replace(/[-\s]/g,"");
          const existingCust = phone
            ? (data.customers||[]).find(c => (c.phone||"").replace(/[-\s]/g,"") === phone)
            : null;
          if(existingCust) {
            parsed.custId = existingCust.id;
            parsed.custName = parsed.custName || existingCust.name;
            parsed.custPhone = parsed.custPhone || existingCust.phone;
            parsed.custGender = parsed.custGender || existingCust.gender;
            parsed._isNewCust = false;
          } else {
            parsed._isNewCust = true;
          }
          const room = (data.rooms||[]).find(r=>r.branch_id===bid);
          setModalData({
            roomId: room?.id, bid,
            date: parsed.date || selDate,
            time: parsed.time || "10:00",
            _prefill: parsed
          });
          setShowModal(true);
        }}
        data={data}
      />}

      {/* Settings dropdown — Portal to body to avoid overflow clipping */}
      <TimelineSettings
        showSettings={showSettings} setShowSettings={setShowSettings}
        isMaster={isMaster} accessibleBids={accessibleBids} userBranches={userBranches}
        expanded={expanded} toggleExpand={toggleExpand}
        viewBids={viewBids} toggleView={toggleView} allBranchList={allBranchList}
        rowH={rowH} setRowH={setRowH} colW={colW} setColW={setColW}
        blockFs={blockFs} setBlockFs={setBlockFs} blockOp={blockOp} setBlockOp={setBlockOp}
        startHour={startHour} setStartHour={setStartHour} endHour={endHour} setEndHour={setEndHour}
        timeUnit={timeUnit} setTimeUnit={setTimeUnit}
        statusClr={statusClr} setStatusClr={setStatusClr}
        salesHighlight={salesHighlight} setSalesHighlight={setSalesHighlight}
        tlSharedKeys={tlSharedKeys} setTlSharedKey={setTlSharedKey}
      />

      {/* 알람 팝업 */}
      {alarmPopup && <div className="ov" onClick={()=>_mc(()=>setAlarmPopup(null))} style={{zIndex:9999}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,borderRadius:T.radius.lg,padding:0,width:"90%",maxWidth:400,
          boxShadow:"0 16px 48px rgba(0,0,0,.25)",animation:"slideUp .6s cubic-bezier(.22,1,.36,1)",overflow:"hidden"}}>
          <div style={{background:"linear-gradient(135deg,#FF6B00,#FF9800)",padding:"20px 24px",color:T.bgCard,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:8}}><I name="bell" size={16} color={T.orange}/></div>
            <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black}}>알람</div>
            <div style={{fontSize:T.fs.md,marginTop:4,opacity:.9}}>{alarmPopup.time}</div>
          </div>
          <div style={{padding:"20px 24px"}}>
            {alarmPopup.tags.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:T.sp.xs,marginBottom:12}}>
              {alarmPopup.tags.map((t,i)=><span key={i} style={{fontSize:T.fs.xxs,padding:"3px 10px",borderRadius:T.radius.lg,background:"#FF6B0015",color:T.orange,fontWeight:T.fw.bold}}>{t}</span>)}
            </div>}
            {alarmPopup.memo ? <div style={{fontSize:T.fs.md,color:T.text,lineHeight:1.8,whiteSpace:"pre-wrap",
              background:"#FFF8F0",border:"1px solid #FFE0B2",borderRadius:T.radius.md,padding:16}}>{alarmPopup.memo}</div>
              : <div style={{fontSize:T.fs.sm,color:T.gray500,textAlign:"center",padding:12}}>메모 내용 없음</div>}
          </div>
          <div style={{padding:"0 24px 20px",textAlign:"center"}}>
            <Btn variant="primary" onClick={()=>_mc(()=>setAlarmPopup(null))}
              style={{width:"100%",padding:12,fontSize:T.fs.md,background:T.orange,borderRadius:T.radius.md}}>확인</Btn>
          </div>
        </div>
      </div>}

      {/* 반복일정 삭제 옵션 팝업 */}
      {deletePopup && <div className="ov" onClick={()=>_mc(()=>setDeletePopup(null))} style={{zIndex:9998}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,borderRadius:T.radius.lg,width:"90%",maxWidth:340,
          boxShadow:"0 16px 48px rgba(0,0,0,.25)",animation:"slideUp .6s cubic-bezier(.22,1,.36,1)",overflow:"hidden"}}>
          <div style={{padding:"20px 24px 12px",borderBottom:"1px solid #eee"}}>
            <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>반복 일정 삭제</div>
            <div style={{fontSize:T.fs.sm,color:T.textSub,marginTop:4}}>이 일정은 반복 등록된 일정입니다.</div>
          </div>
          <div style={{padding:"8px 0"}}>
            {[
              {mode:"this", label:"이 일정만 삭제", desc:"선택한 날짜의 일정만 삭제합니다"},
              {mode:"future", label:"이후 모든 일정을 삭제", desc:`${deletePopup.date} 이후 반복 일정을 삭제합니다`},
              {mode:"all", label:"모든 일정을 삭제", desc:"이 반복 일정을 모두 삭제합니다"},
            ].map(opt => (
              <button key={opt.mode} onClick={()=>handleDeleteConfirm(opt.mode)}
                style={{width:"100%",padding:"12px 24px",border:"none",background:"transparent",cursor:"pointer",
                  textAlign:"left",fontFamily:"inherit",transition:"background .1s",display:"block"}}
                onMouseOver={e=>e.currentTarget.style.background=T.bg}
                onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:opt.mode==="all"?T.female:T.text}}>{opt.label}</div>
                <div style={{fontSize:T.fs.xs,color:T.gray500,marginTop:2}}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <div style={{padding:"8px 24px 16px"}}>
            <button onClick={()=>_mc(()=>setDeletePopup(null))}
              style={{width:"100%",padding:"10px",fontSize:T.fs.sm,border:"1px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,
                color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
          </div>
        </div>
      </div>}

      {/* 네이버 막기 슬롯 토글 팝업 */}
      {blockSlotPopup && (()=>{
        const itemsState = naverBlockState[blockSlotPopup.bizId]?.[blockSlotPopup.date] || {};
        // 노출중(활성) 시술 먼저, 비활성은 뒤로 정렬해서 모두 표시
        const itemIds = Object.keys(itemsState).sort((a,b) => {
          const aActive = itemsState[a].is_active !== false ? 0 : 1;
          const bActive = itemsState[b].is_active !== false ? 0 : 1;
          return aActive - bActive;
        });
        const popX = Math.max(8, Math.min(blockSlotPopup.x + 12, window.innerWidth - 320));
        const popY = Math.max(8, Math.min(blockSlotPopup.y + 12, window.innerHeight - 280));
        // 슬롯 상태 헬퍼: '1'=가능, '0'=막힘, '-'=운영 외(노출 안 함)
        const slotBitOf = (iid) => itemsState[iid].hour_bit?.[blockSlotPopup.slotIdx];
        const visibleIds = itemIds.filter(iid => {
          const b = slotBitOf(iid);
          return b === '0' || b === '1';
        });
        const allBlocked = visibleIds.length > 0 && visibleIds.every(iid => slotBitOf(iid) === '0');
        const anyOpen = visibleIds.some(iid => slotBitOf(iid) === '1');
        const toggleOne = async (itemId, currentlyBlocked) => {
          const newBit = currentlyBlocked ? '1' : '0';
          // 옵티미스틱
          setNaverBlockState(prev => {
            const next = {...prev};
            const items = {...(next[blockSlotPopup.bizId]?.[blockSlotPopup.date] || {})};
            const cur = items[itemId];
            if (!cur) return prev;
            const bits = cur.hour_bit.split('');
            bits[blockSlotPopup.slotIdx] = newBit;
            items[itemId] = { ...cur, hour_bit: bits.join('') };
            next[blockSlotPopup.bizId] = { ...(next[blockSlotPopup.bizId]||{}), [blockSlotPopup.date]: items };
            return next;
          });
          try {
            const r = await fetch('https://blissme.ai/naver-toggle-slot', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ biz_id: blockSlotPopup.bizId, item_id: itemId, date: blockSlotPopup.date, time: blockSlotPopup.time, block: !currentlyBlocked })
            });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error || j.msg || 'fail');
          } catch(e) {
            // 롤백
            setNaverBlockState(prev => {
              const next = {...prev};
              const items = {...(next[blockSlotPopup.bizId]?.[blockSlotPopup.date] || {})};
              const cur = items[itemId];
              if (!cur) return prev;
              const bits = cur.hour_bit.split('');
              bits[blockSlotPopup.slotIdx] = currentlyBlocked ? '0' : '1';
              items[itemId] = { ...cur, hour_bit: bits.join('') };
              next[blockSlotPopup.bizId] = { ...(next[blockSlotPopup.bizId]||{}), [blockSlotPopup.date]: items };
              return next;
            });
            alert('네이버 적용 실패: ' + e.message);
          }
        };
        const toggleAll = async (block) => {
          for (const iid of itemIds) {
            if (itemsState[iid].is_active === false) continue; // 비활성 시술은 건너뜀
            const bit = slotBitOf(iid);
            if (bit !== '0' && bit !== '1') continue; // 운영 외 슬롯('-') 건너뜀
            const isBlocked = bit === '0';
            if (block && !isBlocked) await toggleOne(iid, false);
            if (!block && isBlocked) await toggleOne(iid, true);
          }
        };
        return (
          <>
            <div onClick={()=>setBlockSlotPopup(null)} style={{position:"fixed",inset:0,zIndex:9998,background:"transparent"}}/>
            <div onClick={e=>e.stopPropagation()} style={{position:"fixed",left:popX,top:popY,zIndex:9999,background:"#fff",borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,.18)",padding:14,minWidth:280,maxWidth:320,fontSize:13}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:8}}>
                <div style={{fontWeight:800,fontSize:14,flex:1}}>🚫 네이버 예약 막기 · {blockSlotPopup.time}</div>
                <a href={`https://partner.booking.naver.com/bizes/${blockSlotPopup.bizId}/simple-management`}
                   target="_blank" rel="noopener noreferrer" title="네이버 예약관리 열기"
                   onClick={e=>e.stopPropagation()}
                   style={{background:"#03C75A",color:"#fff",fontSize:11,fontWeight:800,padding:"4px 10px",borderRadius:6,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:3,letterSpacing:-0.3}}>
                  N↗
                </a>
                <button onClick={()=>setBlockSlotPopup(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#999",padding:0,lineHeight:1}}>×</button>
              </div>
              {itemIds.length === 0 ? (
                <div style={{color:"#999",padding:"12px 0",textAlign:"center"}}>로딩 중…</div>
              ) : (
                <>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                    {itemIds.map(iid => {
                      const cur = itemsState[iid];
                      const bit = slotBitOf(iid);
                      const isBlocked = bit === '0';
                      const isInactive = cur.is_active === false;
                      const isOutOfHours = bit === '-' || bit === undefined; // 그 슬롯에 노출 안 됨
                      const disabled = isInactive || isOutOfHours;
                      const bg = isInactive ? "#F3F4F6" : (isOutOfHours ? "#F9FAFB" : (isBlocked ? "#FEE2E2" : "#ECFDF5"));
                      return (
                        <div key={iid} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 8px",background:bg,borderRadius:6,gap:8,opacity:disabled?0.55:1}}>
                          <span style={{fontSize:12,fontWeight:600,color:"#333",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                            {cur.name || iid}
                            {isInactive && <span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"1px 5px",background:"#6B7280",color:"#fff",borderRadius:3}}>노출X</span>}
                            {!isInactive && isOutOfHours && <span style={{marginLeft:6,fontSize:9,fontWeight:700,padding:"1px 5px",background:"#9CA3AF",color:"#fff",borderRadius:3}}>운영외</span>}
                          </span>
                          <button onClick={()=>!disabled && toggleOne(iid, isBlocked)} disabled={disabled} style={{
                            position:"relative",width:38,height:22,borderRadius:11,border:"none",cursor:disabled?"not-allowed":"pointer",
                            background: disabled ? "#D1D5DB" : (isBlocked ? "#9CA3AF" : "#03C75A"), transition:"background .15s", padding:0, flexShrink:0
                          }}>
                            <div style={{position:"absolute",top:2,left:isBlocked||disabled?2:18,width:18,height:18,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 3px rgba(0,0,0,.2)",transition:"left .15s"}}/>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:"flex",gap:6,paddingTop:8,borderTop:"1px solid #eee"}}>
                    <button onClick={()=>toggleAll(true)} disabled={allBlocked} style={{flex:1,padding:"7px 10px",fontSize:11,fontWeight:700,border:"1px solid #EF4444",borderRadius:6,background:allBlocked?"#FEE2E2":"#fff",color:"#EF4444",cursor:allBlocked?"default":"pointer",opacity:allBlocked?0.5:1}}>전체 막기</button>
                    <button onClick={()=>toggleAll(false)} disabled={visibleIds.length>0 && visibleIds.every(iid => slotBitOf(iid) === '1')} style={{flex:1,padding:"7px 10px",fontSize:11,fontWeight:700,border:"1px solid #10B981",borderRadius:6,background:"#fff",color:"#10B981",cursor:"pointer"}}>전체 풀기</button>
                  </div>
                </>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}


export default Timeline
