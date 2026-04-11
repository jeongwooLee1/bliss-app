import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, NAVER_COLS, getNaverVal, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, BRANCH_DEFAULT_COLORS, branchColor, STATUS_CLR_DEFAULT, STATUS_KEYS, SCH_BRANCH_MAP, MALE_EMPLOYEES } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, queueAlimtalk } from '../../lib/sb'
import { useMaleRotation } from '../../lib/useData'
import { fromDb, toDb, resolveSystemIds, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone } from '../../lib/utils'
import I from '../common/I'
import TimelineModal from './ReservationModal'
import QuickBookModal from './QuickBookModal'
import TimelineSettings from './TimelineSettings'
import useTouchDragSort from '../../hooks/useTouchDragSort'

const _mc = (fn) => { if(fn) fn(); };
const uid = genId;
const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={}, ...p }) => {
  const bg = variant==="primary"?T.primary:variant==="danger"?T.danger:variant==="ghost"?"transparent":T.gray100;
  const color = variant==="ghost"?T.primary:variant==="secondary"?T.text:"#fff";
  const border = variant==="ghost"?"1px solid "+T.border:"none";
  const pd = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={disabled?undefined:onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:T.radius.md,padding:pd,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",...style}} {...p}>{children}</button>;
};

function Timeline({ data, setData, userBranches, viewBranches=[], isMaster, currentUser, setPage, bizId, onMenuClick, bizName, pendingOpenRes, setPendingOpenRes, naverColShow={}, scraperStatus=null, setPendingChat, setPendingOpenCust }) {
  // 타임라인 블록 표시 항목 — App에서 prop으로 받음
  const effectiveNaverColShow = naverColShow;
  const SVC_LIST = (data?.services || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []);
  const [selDate, setSelDate] = useState(todayStr());
  const [schHistory, setSchHistory] = useState(null);
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

  // 직원 목록: employees_v1 (schedule_data 테이블)에서 동적 로드 + Realtime + 폴링
  const [empList, setEmpList] = useState([]);
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const mergeEmps = (empVal, customVal) => {
      const base = typeof empVal === 'string' ? JSON.parse(empVal) : (Array.isArray(empVal) ? empVal : []);
      const custom = typeof customVal === 'string' ? JSON.parse(customVal) : (Array.isArray(customVal) ? customVal : []);
      const ids = new Set(base.map(e => e.id));
      const merged = [...base];
      custom.forEach(e => { if (!ids.has(e.id)) { merged.push(e); ids.add(e.id); } });
      MALE_EMPLOYEES.forEach(e => { if (!ids.has(e.id)) { merged.push(e); ids.add(e.id); } });
      return merged;
    };
    // employees_v1 + customEmployees_v1 동시 로드
    Promise.all([
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.customEmployees_v1&select=value`, { headers: H }).then(r => r.json()),
    ]).then(([empRows, custRows]) => {
      const empVal = empRows?.[0]?.value || [];
      const custVal = custRows?.[0]?.value || [];
      setEmpList(mergeEmps(empVal, custVal));
    }).catch(() => {});
    // Realtime 구독 (employees_v1 + customEmployees_v1)
    let empCh = null;
    let empLastRt = 0;
    const reload = () => {
      Promise.all([
        fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }).then(r => r.json()),
        fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.customEmployees_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }).then(r => r.json()),
      ]).then(([empRows, custRows]) => {
        empLastRt = Date.now();
        setEmpList(mergeEmps(empRows?.[0]?.value || [], custRows?.[0]?.value || []));
      }).catch(() => {});
    };
    if (window._sbClient) {
      empCh = window._sbClient.channel("employees_all_rt")
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.employees_v1" }, reload)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.employees_v1" }, reload)
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"schedule_data", filter:"key=eq.customEmployees_v1" }, reload)
        .on("postgres_changes", { event:"INSERT", schema:"public", table:"schedule_data", filter:"key=eq.customEmployees_v1" }, reload)
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
  const BASE_EMP_LIST = React.useMemo(() => {
    return empList.map(e => {
      if (e.isMale) {
        const rotBranch = getRotationBranch(e.id, selDate);
        if (rotBranch && SCH_BRANCH_MAP[rotBranch]) {
          return { id: e.id, branch_id: SCH_BRANCH_MAP[rotBranch] };
        }
      }
      return { id: e.id, branch_id: SCH_BRANCH_MAP[e.branch] || e.branch };
    });
  }, [empList, maleRotation, selDate]);

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

  // 직원이 특정 지점에 있는지 (오버라이드 기준)
  const empInBranch = (empId, date, branchId) => {
    const ov = getEmpOverride(empId, date);
    if (!ov) {
      const emp = BASE_EMP_LIST.find(e => e.id === empId);
      return emp && emp.branch_id === branchId;
    }
    // exclusive(이동): segments에 있는 지점만 표시, 원래 지점 제거
    if (ov.exclusive) return ov.segments.some(s => s.branchId === branchId);
    // 지원: segments에 있거나 원래 지점이면 표시
    const inSegs = ov.segments.some(s => s.branchId === branchId);
    if (inSegs) return true;
    const emp = BASE_EMP_LIST.find(e => e.id === empId);
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

    // 모든 직원 중 이 지점에 해당하는 직원 찾기
    const working = [];
    BASE_EMP_LIST.forEach(e => {
      const dayStatus = schHistory[e.id]?.[date];
      if (dayStatus === "휴무" || dayStatus === "휴무(꼭)") return;

      // "지원(강남)" → 해당 지점에 표시
      const supportBid = parseSupportBranch(dayStatus);
      if (supportBid === branchId) {
        working.push(e);
        return;
      }

      // 지원 중인 직원은 원래 지점에서 제외
      if (supportBid) return;

      // 원래 소속 지점이면 표시
      if (empInBranch(e.id, date, branchId)) {
        working.push(e);
      }
    });

    return working; // 빈 배열도 반환 (전원 휴무 시 rooms fallback 방지)
  };

  // 직원이 특정 지점에서 활성인 시간 범위 반환 (null=종일)
  const getEmpActiveRange = (empId, date, branchId) => {
    const segs = getEmpBranches(empId, date);
    // empWorkHours에서 근무시간 가져오기 (지점별)
    const wh = empWorkHours[empId+"_"+branchId+"_"+date] || empWorkHours[empId+"_"+branchId] || empWorkHours[empId+"_"+date] || empWorkHours[empId];
    if (!segs) return wh ? {from: wh.start, until: wh.end} : {from: null, until: null};
    const seg = segs.find(s => s.branchId === branchId);
    if (!seg) return null; // 이 지점에 없음
    // 지점이동 시간 + 근무시간 중 더 제한적인 것
    return {from: seg.from || (wh?.start || null), until: seg.until || (wh?.end || null)};
  };
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);

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

      // 4. 모달 오픈 (DB에서 fresh 데이터 fetch)
      const openWithFresh = async () => {
        let freshData = pendingOpenRes;
        try {
          const resId = pendingOpenRes.id;
          if (resId) {
            const rows = await sb.get("reservations", resId);
            if (rows && rows.id) {
              const parsed = fromDb("reservations", [rows])[0];
              freshData = {...pendingOpenRes, ...parsed};
              // data state도 업데이트
              setData(prev => prev ? {...prev, reservations: (prev.reservations||[]).map(r => r.id === parsed.id ? {...r, ...parsed} : r)} : prev);
            }
          }
        } catch(e) { console.warn("fresh fetch err:", e); }
        setModalData({...freshData, readOnly: false});
        setShowModal(true);
        setPendingOpenRes && setPendingOpenRes(null);
      };
      openWithFresh();
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
  const [viewBids, setViewBids] = useState(defaultViewBids);
  const [expanded, setExpanded] = useState(isMaster);

  // userBranches 변경 시 viewBids 동기화 (로그인 직후 타이밍 이슈 해결)
  useEffect(() => {
    if (isMaster) {
      setViewBids(allBranchList.map(b=>b.id));
    } else if (userBranches.length > 0) {
      setExpanded(false);
      setViewBids(userBranches);
    }
  }, [userBranches.join(",")]);

  // Sync viewBids when branches change (e.g. added/removed in admin)
  useEffect(() => {
    const newIds = allBranchList.map(b=>b.id);
    setViewBids(prev => {
      const added = newIds.filter(id => !prev.includes(id) && (isMaster || accessibleBids.includes(id)));
      const filtered = prev.filter(id => newIds.includes(id));
      return added.length > 0 ? [...filtered, ...added] : filtered.length !== prev.length ? filtered : prev;
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

  // ── Resize ──
  const [resizeBlock, setResizeBlock] = useState(null);
  const [resizeDur, setResizeDur] = useState(0);
  const isResizing = useRef(false);
  const resizeDurRef = useRef(0);
  const [pendingChange, setPendingChange] = useState(null);
  const [hoverCell, setHoverCell] = useState(null); // {roomId, rowIdx}
  const [empMovePopup, setEmpMovePopup] = useState(null); // {empId, date, x, y}
  const [addStaffPopup, setAddStaffPopup] = useState(null); // {branchId, x, y}
  // 지점별 고정 컬럼 수 - branches.staffColCount에서 읽음
  const branchColCount = React.useMemo(() => {
    const map = {};
    (data?.branches||[]).forEach(br => { if(br.staffColCount) map[br.id] = br.staffColCount; });
    return map;
  }, [data?.branches]);
  const cellLongPress = useRef(null);

  // 직원 컬럼 순서 커스텀 (DB: schedule_data.empColOrder_v1)
  const [empColOrder, _setEmpColOrder] = useState({});
  const empColOrderLoaded = React.useRef(false);
  React.useEffect(() => {
    if (empColOrderLoaded.current) return;
    empColOrderLoaded.current = true;
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.empColOrder_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.json()).then(rows => {
      if (rows?.[0]?.value) {
        const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
        _setEmpColOrder(v);
      }
    }).catch(console.error);
  }, []);
  const setEmpColOrder = React.useCallback((updater) => {
    _setEmpColOrder(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: "POST", headers: H,
        body: JSON.stringify({ id: "empColOrder_v1", key: "empColOrder_v1", value: JSON.stringify(next) })
      }).catch(console.error);
      return next;
    });
  }, []);
  const moveEmpCol = (branchId, empId, dir) => {
    setEmpColOrder(prev => {
      let order = [...(prev[branchId]||[])];
      // order가 비어있거나 empId가 없으면 현재 출근 직원으로 초기화
      if (order.length === 0 || !order.includes(empId)) {
        const ws = getWorkingStaff(branchId, selDate) || [];
        order = ws.map(e => e.id);
        if (!order.includes(empId)) return prev;
      }
      const idx = order.indexOf(empId);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= order.length) return prev;
      [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
      return {...prev, [branchId]: order};
    });
  };
  const sortStaffByOrder = (staffList, branchId) => {
    const order = empColOrder[branchId];
    if (!order || order.length === 0) {
      if (staffList.length > 0) {
        const ids = staffList.map(e => e.id);
        setEmpColOrder(prev => {
          if (prev[branchId]?.length >= staffList.length) return prev;
          return {...prev, [branchId]: ids};
        });
      }
      return staffList;
    }
    const sorted = [];
    for (const id of order) {
      const e = staffList.find(s => s.id === id);
      if (e) sorted.push(e);
    }
    for (const e of staffList) {
      if (!sorted.find(s => s.id === e.id)) sorted.push(e);
    }
    return sorted;
  };

  const allRooms = branchesToShow.flatMap(br => {
    const naverCount = br.naverEmail ? (br.naverColCount || 1) : 0;
    const naverRooms = Array.from({length: naverCount}, (_, i) => ({
      id: `nv_${br.id}_${i}`, name: naverCount > 1 ? `미배정${i+1}` : "미배정",
      branch_id: br.id, branchName: br.short||br.name||"", isNaver: true
    }));
    // 출근표 기반 직원 컬럼 (커스텀 순서 적용)
    const rawStaff = getWorkingStaff(br.id, selDate);
    const workingStaff = rawStaff ? sortStaffByOrder(rawStaff, br.id) : null;
    let staffRooms;
    if (workingStaff !== null) {
      // 근무표 기반 — 휴무 필터 + 원래소속/지원 분리 (지원은 맨 뒤)
      const filteredStaff = workingStaff.filter(e => {
        if (!schHistory) return true;
        const ds = schHistory[e.id]?.[selDate];
        return ds !== "휴무" && ds !== "휴무(꼭)";
      });
      const baseStaff = filteredStaff.filter(e => {
        const emp = BASE_EMP_LIST.find(b=>b.id===e.id);
        return emp && emp.branch_id === br.id;
      });
      const guestStaff = filteredStaff.filter(e => {
        const emp = BASE_EMP_LIST.find(b=>b.id===e.id);
        return !emp || emp.branch_id !== br.id;
      });
      staffRooms = [...baseStaff, ...guestStaff].map(e => {
        const range = getEmpActiveRange(e.id, selDate, br.id);
        return {
          id: `st_${br.id}_${e.id}`, name: e.id,
          branch_id: br.id, branchName: br.short||br.name||"",
          staffId: e.id, isStaffCol: true,
          activeFrom: range?.from || null,   // null=종일
          activeUntil: range?.until || null, // null=종일
        };
      });
    } else {
      // schHistory 미로드 시 직원 컬럼 표시 안 함 (로딩 후 리렌더링됨)
      staffRooms = [];
    }
    // 오른쪽 끝에 + 컬럼 추가
    staffRooms.push({
      id: `blank_${br.id}_add`, name: "+",
      branch_id: br.id, branchName: br.short||br.name||"",
      isBlank: true, isAddCol: true
    });
    return [...naverRooms, ...staffRooms];
  });
  const isNaverRes = (r) => !!r.reservationId || r.source === "ai_booking";
  const isPendingRes = (r) => r.status === "pending" || r.status === "request";
  const isUnassigned = (r) => !r.roomId && !r.staffId || r.roomId?.startsWith("nv_") || r.roomId?.startsWith("blank_");
  
  const allRoomIds = new Set(allRooms.map(r => r.id));

  const blocks = (data?.reservations||[]).filter(r => {
    if (r.date !== selDate) return false;
    if (!branchesToShow.some(b=>b.id===r.bid)) return false;
    if (r.status === "naver_changed" || r.status === "naver_cancelled" || r.status === "cancelled") return false;
    const isNaver = r.source === "naver" || r.source === "네이버";
    if (isNaver && !r.isScrapingDone) return false;
    return true;
  }).map(r => {
    // allRooms에 없는 room_id/staff_id → 무시하고 재배치 대상으로
    const roomExists = !r.roomId || allRoomIds.has(r.roomId);
    const staffExists = !r.staffId || allRoomIds.has(r.staffId) || allRooms.some(rm => rm.isStaffCol && rm.staffId === r.staffId);
    if (!roomExists && !staffExists) return {...r, roomId: "", staffId: ""};
    if (!roomExists) return {...r, roomId: ""};
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
      // Sort naver blocks by time, assign to leftmost available room
      [...brNaverBlocks].sort((a,b) => a.time.localeCompare(b.time)).forEach(block => {
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
  const [endHour, setEndHourRaw] = useState(() => tlDef("eh", 22));
  const [rowH, setRowHRaw] = useState(() => tlDef("rh", 14));
  const [colW, setColWRaw] = useState(() => tlDef("cw", 160));
  const [timeUnit, setTimeUnitRaw] = useState(() => tlDef("tu", 5));
  const [blockFs, setBlockFsRaw] = useState(() => tlDef("fs", 13));
  const [blockOp, setBlockOpRaw] = useState(() => tlDef("op", 50));
  const [statusClr, setStatusClrRaw] = useState(() => {
    const sc = dbTl.current.sc;
    return sc ? {...STATUS_CLR_DEFAULT,...sc} : {...STATUS_CLR_DEFAULT};
  });
  const makeTlSave = (k, rawSetter) => v => {
    rawSetter(prev => {
      const resolved = typeof v === "function" ? v(prev) : v;
      dbTl.current = {...dbTl.current, [k]: resolved};
      tlSaveLocal(dbTl.current);
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
  const setStatusClr = (k,v) => { setStatusClrRaw(p => { const n = {...p,[k]:v}; dbTl.current = {...dbTl.current, sc:n}; tlSaveLocal(dbTl.current); try{localStorage.setItem("tl_sc",JSON.stringify(n))}catch(e){} return n; }); };
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
    if (room.isNaver) return;
    // 모바일: 터치 직후 click 무시 (롱프레스로만 등록)
    if (Date.now() - lastTouchCell.current < 500) return;
    const time = yToTime(y);
    setModalData({ roomId: room.isStaffCol ? "" : room.id, bid: room.branch_id, time, date: selDate, staffId: room.isStaffCol ? room.staffId : undefined });
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

  const handleSave = (item) => {
    // 미배정 칼럼 roomId 정리
    if (item.roomId && item.roomId.startsWith("blank_")) item.roomId = "";
    // 필수값 검증
    if (!item.isSchedule && item.type === "reservation" && !item.custName?.trim()) {
      alert("고객 이름을 입력해 주세요."); return;
    }
    // 신규고객이면 DB에 고객 등록 (전화번호 중복 체크)
    if (item.isNewCust && item.custName && !item.custId) {
      const normPhone = (item.custPhone || "").replace(/[^0-9]/g, "");
      if (normPhone) {
        const dup = (data?.customers||[]).find(c => c.phone === normPhone);
        if (dup) {
          if (!confirm(`동일 번호(${normPhone})로 등록된 고객이 있습니다: ${dup.name}\n기존 고객으로 연결할까요?`)) return;
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
        const updateRow = toDb("reservations", item);
        if (!updateRow.reservation_id) updateRow.reservation_id = null;
        sb.update("reservations", item.id, updateRow).catch(console.error);
        return { ...prev, reservations: (prev?.reservations||[]).map(r => r.id === item.id ? item : r) };
      }
      const items = [item];
      if (item.isSchedule && item.repeat && item.repeat !== "none" && item.repeatUntil) {
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
            items.push({ ...item, id: uid(), date: ds, endDate: ds, repeat: item.repeat, repeatUntil: item.repeatUntil, repeatSourceId: item.id });
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      allItems.push(...items);
      return { ...prev, reservations: [...prev.reservations, ...items] };
    });
    // Async sync to Supabase
    setTimeout(()=>{
      if(allItems.length) sb.upsert("reservations", allItems.map(i=>{
        const row = toDb("reservations", i);
        if (!row.reservation_id) row.reservation_id = null;
        return row;
      })).catch(console.error);
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
      setAlimtalkConfirm(item);
    }
    setShowModal(false); setModalData(null);
  };

  // ── Delete with repeat options ──
  const [deletePopup, setDeletePopup] = useState(null);
  const [alimtalkConfirm, setAlimtalkConfirm] = useState(null); // {item} 저장 후 예약안내 발송 여부 팝업

  const handleDeleteRequest = (block) => {
    const sourceId = block.repeatSourceId || block.id;
    const hasRepeat = (data.reservations || []).some(r => r.repeatSourceId === sourceId || (r.id === sourceId && r.repeat && r.repeat !== "none"));
    if (hasRepeat) {
      setDeletePopup(block);
    } else {
      handleDelete(block.id);
    }
  };

  const handleDeleteConfirm = (mode) => {
    if (!deletePopup) return;
    const block = deletePopup;
    const sourceId = block.repeatSourceId || block.id;
    const toDelIds = [];
    setData(prev => {
      let res = prev.reservations;
      if (mode === "this") {
        toDelIds.push(block.id);
        res = res.filter(r => r.id !== block.id);
      } else if (mode === "future") {
        res = res.filter(r => {
          if (r.id === block.id) { toDelIds.push(r.id); return false; }
          const sameGroup = r.id === sourceId || r.repeatSourceId === sourceId;
          if (sameGroup && r.date >= block.date) { toDelIds.push(r.id); return false; }
          return true;
        });
      } else if (mode === "all") {
        res.forEach(r => { if(r.id===sourceId||r.repeatSourceId===sourceId) toDelIds.push(r.id); });
        res = res.filter(r => r.id !== sourceId && r.repeatSourceId !== sourceId);
      }
      return { ...prev, reservations: res || [] };
    });
    setTimeout(()=>{ toDelIds.forEach(id=>sb.del("reservations",id).catch(console.error)); }, 0);
    setDeletePopup(null); setShowModal(false); setModalData(null);
  };

  const handleDelete = (id) => {
    setData(prev => ({ ...prev, reservations: (prev?.reservations||[]).filter(r => r.id !== id) }));
    sb.del("reservations", id).catch(console.error);
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
    let clickOffsetY = 0;
    if (sr) {
      const rect = sr.getBoundingClientRect();
      const cursorGridY = (startPt.clientY - rect.top + sr.scrollTop);
      clickOffsetY = cursorGridY - blockTopY;
    }

    const getPoint = (ev) => isTouch ? ev.touches[0] : ev;

    const onDragMove = (ev) => {
      const pt = getPoint(ev);
      if (!pt) return;
      ev.preventDefault(); // 드래그 중에만 스크롤 차단
      if (!sr) return;
      const rect = sr.getBoundingClientRect();
      const x = pt.clientX - rect.left + sr.scrollLeft;
      const y = pt.clientY - rect.top + sr.scrollTop;
      setDragPos({ x: pt.clientX - rect.left, y: pt.clientY - rect.top });
      const colX = x - timeLabelsW;
      const roomIdx = Math.max(0, Math.min(allRooms.length - 1, Math.floor(colX / colW)));
      const targetRoom = allRooms[roomIdx];
      const gridY = y - clickOffsetY;
      const snappedTime = yToTime(Math.max(0, gridY));
      setDragSnap({ roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime });
      dragSnapRef.current = { roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime };
      const edgeZone = 40;
      if (pt.clientY - rect.top < edgeZone) sr.scrollTop -= 8;
      if (rect.bottom - pt.clientY < edgeZone) sr.scrollTop += 8;
    };

    const onDragUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onDragMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onDragUp);
      if (isDragging.current && dragSnapRef.current) {
        const snap = dragSnapRef.current;
        const orig = origBlockPos.current;
        if (snap.time !== orig.time || snap.roomId !== orig.roomId) {
          setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
            if (r.id !== block.id) return r;
            const [sh,sm] = snap.time.split(":").map(Number);
            const endMin = sh*60+sm+(r.dur||60);
            const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
            const toNaverCol = snap.roomId?.startsWith("nv_");
            const targetRoom = allRooms.find(rm => rm.id === snap.roomId);
            const staffUpdate = toNaverCol
              ? { staffId: "", roomId: "" }
              : targetRoom?.isStaffCol
                ? { staffId: targetRoom.staffId, roomId: snap.roomId }
                : snap.roomId ? { roomId: snap.roomId } : {};
            return {...r, time: snap.time, endTime, roomId: snap.roomId||r.roomId, bid: snap.bid||r.bid, ...staffUpdate};
          })}));
          // 이동된 값을 snap 기준으로 직접 계산 (setData는 비동기라 data가 아직 갱신 안 됨)
          const toNaverCol2 = snap.roomId?.startsWith("nv_");
          const targetRoom2 = allRooms.find(rm => rm.id === snap.roomId);
          const movedStaffId = toNaverCol2 ? "" : targetRoom2?.isStaffCol ? targetRoom2.staffId : "";
          const movedRoomId = toNaverCol2 ? "" : snap.roomId || "";
          const movedBid = snap.bid || block.bid;
          const [mh,mm] = snap.time.split(":").map(Number);
          const mEndMin = mh*60+mm+(block.dur||60);
          const movedEndTime = `${String(Math.floor(mEndMin/60)).padStart(2,"0")}:${String(mEndMin%60).padStart(2,"0")}`;

          const validPhone = block.custPhone && block.custPhone.startsWith("010");
          const branchChanged = movedBid && movedBid !== block.bid;
          const needsPopup = !block.isSchedule && (
            (validPhone && snap.time !== orig.time) || branchChanged
          );
          if (needsPopup) {
            setPendingChange({ type: "move", block, data: snap, orig, branchChanged });
          } else {
            // 바로 DB 저장 — snap 기준 계산값 사용
            sb.update("reservations", block.id, {
              room_id: movedRoomId, time: snap.time, end_time: movedEndTime,
              bid: movedBid, staff_id: movedStaffId || null
            }).catch(console.error);
          }
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

      longPressTimer.current = setTimeout(() => {
        document.removeEventListener("touchmove", cancelOnMove);
        document.removeEventListener("touchend", cancelOnEnd);
        longPressActive.current = true;
        isDragging.current = true;
        setDragBlock(block);
        try { navigator.vibrate && navigator.vibrate(30); } catch(ex){}
        // 이제 드래그 리스너 등록 (passive:false → 스크롤 차단)
        document.addEventListener("touchmove", onDragMove, {passive:false});
        document.addEventListener("touchend", onDragUp);
      }, 500);
    } else {
      // 마우스: 기존 방식
      const onMouseMove = (ev) => {
        const dx = ev.clientX - dragStartRef.current.x;
        const dy = ev.clientY - dragStartRef.current.y;
        if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < 6) return;
        if (!isDragging.current) { isDragging.current = true; setDragBlock(block); }
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
      const durDelta = Math.round(dy / rowH) * timeUnit;
      const newDur = Math.max(5, startDur + durDelta);
      setResizeDur(newDur);
      resizeDurRef.current = newDur;
    };

    const onResizeUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onResizeMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onResizeUp);
      const finalDur = resizeDurRef.current;
      if (isResizing.current && finalDur !== origDur) {
        setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => {
          if (r.id !== block.id) return r;
          const [sh,sm] = r.time.split(":").map(Number);
          const endMin = sh*60+sm+finalDur;
          const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
          return {...r, dur: finalDur, endTime};
        })}));
        setPendingChange({ type: "resize", block, data: { dur: finalDur }, orig: { dur: origDur } });
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
      if (r) sb.update("reservations", block.id, {
        room_id: r.roomId || d?.roomId || "", time: r.time || d?.time,
        bid: r.bid || d?.bid, staff_id: r.staffId || fallbackStaff || null
      }).catch(console.error);
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
        const rsvUrl = rsvUrlId ? "https://blissme.ai/bliss-app/r.html?"+encodeURIComponent(rsvUrlId) : "";
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
        const endMin = sh*60+sm+(r.dur||60);
        const endTime = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        return {...r, time: orig.time, endTime, roomId: orig.roomId || "", bid: orig.bid, staffId: orig.staffId || r.staffId};
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

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
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
    }
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
  // Auto-fix: memo에 "확정완료"가 있는데 status가 pending인 예약 자동 confirmed 처리
  useEffect(() => {
    if (!data?.reservations) return;
    const mismatched = (data?.reservations||[]).filter(r => r.status === "pending" && r.memo && r.memo.includes("확정완료"));
    if (mismatched.length === 0) return;
    mismatched.forEach(r => {
      sb.update("reservations", r.id, {status: "confirmed"}).then(() => console.log(`Auto-confirmed: ${r.id} (memo has 확정완료)`));
    });
    setData(prev => ({...prev, reservations: (prev?.reservations||[]).map(r => mismatched.some(m => m.id === r.id) ? {...r, status: "confirmed"} : r)}));
  }, [data?.reservations?.filter(r => r.status === "pending").length]);
  const now = new Date(nowTick);
  const nowY = (selDate === todayStr() && now.getHours() >= startHour && now.getHours() < effectiveEndHour) ? timeToY(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`) : -1;

  // Date helpers
  const DAYS_KR = ["일","월","화","수","목","금","토"];
  const sd = new Date(selDate);
  const dateLabel = `${String(sd.getMonth()+1).padStart(2,"0")}월 ${String(sd.getDate()).padStart(2,"0")}일 (${DAYS_KR[sd.getDay()]})`;

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
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
            const first = pendingList[0];
            const br = allBranchList.find(b=>b.id===first.bid);
            const bizId = br?.naverBizId;
            const resId = first?.reservationId;
            const naverUrl = bizId ? (resId ? `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view/bookings/${resId}` : `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view`) : null;
            return naverUrl ? <a href={naverUrl} target="_blank" rel="noopener noreferrer"
              onClick={e=>e.stopPropagation()}
              style={{fontSize:T.fs.xxs,color:T.bgCard,fontWeight:T.fw.bolder,background:T.naver,padding:"4px 10px",borderRadius:T.radius.md,textDecoration:"none",flexShrink:0,whiteSpace:"nowrap"}}>네이버 확정</a> : null;
          })()}
        </div>;
      })()}
      {/* Single scroll container */}
      <div ref={scrollRef} className="timeline-scroll" style={{flex:1,overflow:"auto",minHeight:0,overscrollBehavior:"none"}}>

        {/* Top Bar - sticky */}
        <div ref={topbarRef} className="tl-topbar" style={{position:"sticky",top:0,left:0,zIndex:30,borderBottom:"1px solid "+T.border,background:T.bgCard,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",minWidth:"100%",boxSizing:"border-box",overflow:"visible"}}>
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
      </div>



        {/* Timeline Grid */}
        <div style={{display:"flex",minWidth:"fit-content",position:"relative"}} onClick={handleTlClick}>
          {/* Time Labels */}
          <div className="tl-time-col" style={{width:timeLabelsW,flexShrink:0,position:"sticky",left:0,zIndex:20,background:T.bgCard,borderRight:"1px solid #eee"}}>
            <div style={{height:headerH,borderBottom:"1px solid #eee",position:"sticky",top:topbarH,zIndex:25,background:T.bgCard}}/>
            <div style={{position:"relative",height:totalRows*rowH,...gridBg}}>
              {hoverCell && hoverCell.rowIdx>=0 && <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.08)",zIndex:1,pointerEvents:"none"}}/>}
              {timeLabels.map(({i, isHour, m, text}) => {
                const isHighlighted = hoverCell && hoverCell.rowIdx === i;
                return <div key={i} className="tl-time-cell" style={{position:"absolute",top:i*rowH,left:0,right:0,height:rowH,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:window.innerWidth<=768?3:6}}>
                  <span style={{fontSize:isHour?(window.innerWidth<=768?10:11):(window.innerWidth<=768?8:9),fontWeight:isHighlighted?700:(isHour?600:400),color:isHighlighted?T.primary:(isHour?T.gray700:T.gray500),whiteSpace:"nowrap",lineHeight:1,transition:"color 0.1s"}}>{text}</span>
                </div>;
              })}
              {nowY > 0 && <div style={{position:"absolute",top:nowY-9,left:0,right:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:6,pointerEvents:"none"}}>
                <span style={{fontSize:T.fs.xs,fontWeight:T.fw.black,color:T.danger,background:T.bgCard,padding:"1px 3px",borderRadius:T.radius.sm,lineHeight:1}}>
                  {(now.getHours()>12?now.getHours()-12:now.getHours()||12)}:{String(now.getMinutes()).padStart(2,"0")}
                </span>
              </div>}
            </div>
          </div>

          {/* Room Columns */}
          {allRooms.map((room, ci) => {
            const roomBlocks = blocks.filter(b => {
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
            const isNewBranch = ci === 0 || room.branch_id !== allRooms[ci-1]?.branch_id;
            const branchColor = (data.branchSettings || []).find(bs => bs.id === room.branch_id)?.color || "";
            return (
              <div key={room.id} className="tl-room-col" data-branch-id={room.branch_id} style={{width:colW,flexShrink:0,borderLeft:room.isNaver?"2px solid #A5D6A7":(isNewBranch&&ci>0?"none":"1px solid #f0f0f0"),background:room.isNaver?T.successLt:(branchColor||T.bgCard),marginLeft:isNewBranch&&ci>0?4:0,boxShadow:isNewBranch&&ci>0?"-4px 0 8px rgba(0,0,0,.06)":room.isNaver?"inset 2px 0 4px rgba(76,175,80,.08)":"none"}}>
                {/* Room Header - sticky */}
                <div style={{height:headerH,borderBottom:"1px solid #eee",position:"sticky",top:topbarH,zIndex:10,background:room.isBlank?T.gray100:room.isNaver?T.successLt:(branchColor||T.bgCard),display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",lineHeight:1.2}}>
                  <span className="tl-room-name" style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:room.isNaver?T.successDk:T.text}}>{room.branchName}</span>
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
                            {addStaffPopup?.selectedEmp ? null : BASE_EMP_LIST.filter(e => {
                              // 이 지점에 아직 없는 직원만
                              const already = allRooms.some(r => r.isStaffCol && r.branch_id === room.branch_id && r.staffId === e.id);
                              if (already) return false;
                              // 휴무 직원 제외
                              if (schHistory) {
                                const ds = schHistory[e.id]?.[selDate];
                                if (ds === "휴무" || ds === "휴무(꼭)") return false;
                              }
                              return true;
                            }).map(e => {
                              const empBase = BASE_EMP_LIST.find(b=>b.id===e.id);
                              const baseBr = (data?.branches||[]).find(b=>b.id===empBase?.branch_id);
                              return <div key={e.id} onClick={()=>{
                                setAddStaffPopup(p=>({...p, selectedEmp:e.id, selectedBranch:room.branch_id}));
                              }} style={{padding:"6px 12px",cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #f5f5f5"}}
                                onMouseOver={e2=>e2.currentTarget.style.background=T.gray100}
                                onMouseOut={e2=>e2.currentTarget.style.background=""}>
                                <span style={{fontWeight:600}}>{e.id}</span>
                                <span style={{fontSize:10,color:T.textMuted}}>{baseBr?.short||""}</span>
                              </div>;
                            })}
                            {!addStaffPopup?.selectedEmp && BASE_EMP_LIST.filter(e => !allRooms.some(r => r.isStaffCol && r.branch_id === room.branch_id && r.staffId === e.id)).length === 0 &&
                              <div style={{padding:"8px 12px",fontSize:11,color:T.textMuted}}>추가 가능한 직원 없음</div>}
                            {/* 지원/이동 선택 */}
                            {addStaffPopup?.selectedEmp && addStaffPopup?.selectedBranch===room.branch_id && (()=>{
                              const empName = addStaffPopup.selectedEmp;
                              const targetBid = addStaffPopup.selectedBranch;
                              const empBase = BASE_EMP_LIST.find(e=>e.id===empName);
                              const baseBid = empBase?.branch_id;
                              const baseBr = (data?.branches||[]).find(b=>b.id===baseBid);
                              const supportFrom = addStaffPopup.supportFrom || "";
                              const hours = Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}:00`);
                              const doAdd = (exclusive) => {
                                const overrideKey = empName+"_"+selDate;
                                if(exclusive) {
                                  // 이동: 대상 지점에만
                                  setEmpBranchOverride(p=>({...p,[overrideKey]:{segments:[{branchId:targetBid,from:null,until:null}],exclusive:true}}));
                                } else {
                                  // 지원: 원래 지점(~시작시간) + 대상 지점(시작시간~)
                                  const from = supportFrom || "14:00";
                                  const segs = [];
                                  if(baseBid) segs.push({branchId:baseBid, from:null, until:from});
                                  segs.push({branchId:targetBid, from, until:null});
                                  setEmpBranchOverride(p=>({...p,[overrideKey]:{segments:segs}}));
                                }
                                setAddStaffPopup(null);
                              };
                              return <div style={{borderTop:"2px solid "+T.primary,padding:"8px 12px"}}>
                                <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>{empName} <span style={{fontWeight:400,color:T.textMuted}}>({baseBr?.short||""})</span></div>
                                <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:6}}>
                                  <span style={{fontSize:10,color:T.textMuted}}>시작</span>
                                  <select value={supportFrom} onChange={e=>setAddStaffPopup(p=>({...p,supportFrom:e.target.value}))}
                                    style={{flex:1,fontSize:11,padding:"3px 4px",borderRadius:6,border:"1px solid "+T.border}}>
                                    <option value="">시간 선택</option>
                                    {hours.map(h=><option key={h} value={h}>{h}</option>)}
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
                    ) : <span className="tl-room-sub" style={{fontSize:T.fs.xs,color:T.gray400,fontStyle:"italic"}}>미배정</span>
                  ) : room.isStaffCol ? (
                    <div style={{position:"relative"}}>
                      <span className="tl-room-sub" style={{fontSize:14,fontWeight:800,color:T.text,cursor:"pointer",borderBottom:"1px dashed "+T.gray400}}
                        onClick={e=>{e.stopPropagation();setEmpMovePopup(p=>p?.empId===room.staffId?null:{empId:room.staffId,date:selDate,x:e.clientX,y:e.clientY});}}>
                        {room.name}
                      </span>
                      {empMovePopup?.empId===room.staffId && empMovePopup?.date===selDate && (<>
                        <div style={{position:"fixed",inset:0,zIndex:9998}} onClick={e=>{e.stopPropagation();setEmpMovePopup(null);}}/>
                        <div onClick={e=>e.stopPropagation()} style={{position:"fixed",left:Math.min(empMovePopup.x,window.innerWidth-200),top:empMovePopup.y+8,background:T.bgCard,borderRadius:12,boxShadow:"0 4px 24px rgba(0,0,0,.22)",zIndex:9999,padding:"10px 0 6px",minWidth:200}}>
                          {/* 근무시간 설정 */}
                          <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border}}>
                            <div style={{fontSize:10,color:T.textMuted,marginBottom:4,fontWeight:700}}>근무시간</div>
                            {(()=>{
                              const whKey = room.staffId+"_"+room.branch_id+"_"+selDate;
                              const wh = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id] || {start:"10:00",end:"21:00"};
                              const hours = Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}:00`);
                              const selSt = {flex:1,fontSize:11,padding:"4px 3px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"};
                              return <div style={{display:"flex",gap:4,alignItems:"center"}}>
                                <select defaultValue={wh.start} style={selSt}
                                  onChange={e=>{const v=e.target.value; const sh=parseInt(v); const eh=Math.min(23,sh+10); const endStr=`${String(eh).padStart(2,"0")}:00`; _setEmpWorkHours(p=>({...p,[whKey]:{start:v,end:endStr}}));}}>
                                  {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                </select>
                                <span style={{fontSize:11}}>~</span>
                                <select defaultValue={wh.end} style={selSt}
                                  onChange={e=>{const v=e.target.value; _setEmpWorkHours(p=>({...p,[whKey]:{...(p[whKey]||p[room.staffId+"_"+room.branch_id]||{start:"10:00",end:"21:00"}),end:v}}));}}>
                                  {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                </select>
                                <button onClick={()=>{
                                  const cur = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id] || {start:"10:00",end:"21:00"};
                                  setEmpWorkHours(p=>({...p,[whKey]:cur}));
                                  setEmpMovePopup(null);
                                }} style={{padding:"4px 8px",fontSize:10,fontWeight:700,border:"none",borderRadius:6,background:T.primary,color:"#fff",cursor:"pointer"}}>저장</button>
                              </div>;
                            })()}
                          </div>
                          <div style={{fontSize:11,color:T.textMuted,padding:"0 12px 8px",fontWeight:700,borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <span>{room.name}</span>
                            <div style={{display:"flex",gap:2}}>
                              <button onClick={()=>{moveEmpCol(room.branch_id,room.staffId,-1);setEmpMovePopup(null);}}
                                style={{width:22,height:22,border:"1px solid "+T.border,borderRadius:4,background:T.bgCard,cursor:"pointer",fontSize:12,padding:0}}>←</button>
                              <button onClick={()=>{moveEmpCol(room.branch_id,room.staffId,1);setEmpMovePopup(null);}}
                                style={{width:22,height:22,border:"1px solid "+T.border,borderRadius:4,background:T.bgCard,cursor:"pointer",fontSize:12,padding:0}}>→</button>
                            </div>
                          </div>
                          {/* 현재 segments */}
                          {(()=>{
                            const overrideKey = room.staffId+"_"+selDate;
                            const ov = empBranchOverride[overrideKey];
                            const segs = ov ? (typeof ov==="string" ? [{branchId:ov,from:null,until:null}] : (ov.segments||[])) : [];
                            const empBase = BASE_EMP_LIST.find(e=>e.id===room.staffId);
                            const baseBranch = empBase ? empBase.branch_id : null;
                            const allBranches = (data.branches||[]).filter(b=>
                              branchesToShow.some(bs=>bs.id===b.id) || b.id===baseBranch
                            );
                            // 추가할 지점 + 시간 상태
                            const [addBranch,setAddBranch] = [empMovePopup.addBranch||"", v=>setEmpMovePopup(p=>({...p,addBranch:v}))];
                            const [addFrom,setAddFrom] = [empMovePopup.addFrom||"", v=>setEmpMovePopup(p=>({...p,addFrom:v}))];

                            const saveSeg = () => {
                              if(!addBranch) return;
                              const overrideKey2 = room.staffId+"_"+selDate;
                              const newSeg = {branchId:addBranch, from:addFrom||null, until:null};
                              // 기존 segs에서 같은 지점 제거 후 추가
                              const prev = segs.filter(s=>s.branchId!==addBranch);
                              let merged = [...prev, newSeg].sort((a,b)=>{
                                if(!a.from) return -1; if(!b.from) return 1;
                                return a.from.localeCompare(b.from);
                              }).map((s,i,arr)=>({...s, until: arr[i+1]?.from||null}));
                              // 원래 지점이 없으면 자동 추가 (첫 이동 전까지)
                              const empBase = BASE_EMP_LIST.find(e=>e.id===room.staffId);
                              const baseBranchId = empBase ? empBase.branch_id : null;
                              if(baseBranchId && !merged.find(s=>s.branchId===baseBranchId)) {
                                const firstFrom = merged[0]?.from || null;
                                merged = [{branchId:baseBranchId, from:null, until:firstFrom}, ...merged];
                              }
                              setEmpBranchOverride(p=>({...p,[overrideKey2]:{segments:merged}}));
                              setEmpMovePopup(null);
                            };

                            const removeSeg = (branchId) => {
                              const overrideKey2 = room.staffId+"_"+selDate;
                              const newSegs = segs.filter(s=>s.branchId!==branchId);
                              if(newSegs.length===0) {
                                setEmpBranchOverride(p=>{const n={...p};delete n[overrideKey2];return n;});
                              } else {
                                const reindexed = newSegs.sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s,until:arr[i+1]?.from||null}));
                                setEmpBranchOverride(p=>({...p,[overrideKey2]:{segments:reindexed}}));
                              }
                              setEmpMovePopup(null);
                            };

                            return <>
                              {/* 현재 구간 목록 */}
                              {segs.length>0 && <div style={{padding:"6px 12px"}}>
                                {segs.map(s=>{
                                  const br = allBranches.find(b=>b.id===s.branchId);
                                  return <div key={s.branchId} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,fontSize:12}}>
                                    <span style={{width:6,height:6,borderRadius:"50%",background:br?.color||T.primary,flexShrink:0}}/>
                                    <span style={{flex:1,fontWeight:600}}>{br?.short||br?.name}</span>
                                    <span style={{color:T.textMuted,fontSize:11}}>{s.from||"시작"}~{s.until||"종일"}</span>
                                    <button onClick={()=>removeSeg(s.branchId)} style={{width:18,height:18,border:"none",background:"none",cursor:"pointer",color:T.danger,fontSize:14,padding:0,lineHeight:1}}>×</button>
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
                                  <select value={addFrom} onChange={e=>setAddFrom(e.target.value)}
                                    style={{width:82,fontSize:11,padding:"4px 5px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                    <option value="">시간</option>
                                    {Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).map(t=><option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div style={{display:"flex",gap:4}}>
                                  <button onClick={saveSeg} disabled={!addBranch}
                                    style={{flex:1,padding:"5px 0",borderRadius:7,border:"none",background:addBranch?"#4CAF50":T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:addBranch?"pointer":"not-allowed",fontFamily:"inherit"}}
                                    title="원래 매장에도 남아있음">
                                    지원
                                  </button>
                                  <button onClick={()=>{
                                    if(!addBranch) return;
                                    const overrideKey2 = room.staffId+"_"+selDate;
                                    // 완전 이동: 원래 매장 제거, 대상 매장만
                                    const newSeg = {branchId:addBranch, from:addFrom||null, until:null};
                                    setEmpBranchOverride(p=>({...p,[overrideKey2]:{segments:[newSeg], exclusive:true}}));
                                    setEmpMovePopup(null);
                                  }} disabled={!addBranch}
                                    style={{flex:1,padding:"5px 0",borderRadius:7,border:"none",background:addBranch?T.primary:T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:addBranch?"pointer":"not-allowed",fontFamily:"inherit"}}
                                    title="원래 매장에서 제거됨">
                                    이동
                                  </button>
                                </div>
                              </div>
                            </>;
                          })()}
                        </div>
                      </>)}
                    </div>
                  ) : (
                    <span className="tl-room-sub" style={{fontSize:T.fs.nano,color:room.isNaver?T.successDk:T.gray500}}>{room.isNaver?<I name="naver" size={11}/>:""}{room.name}</span>
                  )}
                </div>
                {/* Grid Area */}
                <div style={{position:"relative",height:totalRows*rowH,cursor:room.isBlank?"default":room.isNaver?"default":(canEdit(room.branch_id)?"pointer":"default"),...(room.isBlank?{background:"repeating-linear-gradient(45deg,#f5f5f5,#f5f5f5 6px,#fafafa 6px,#fafafa 12px)"}:gridBg)}}
                  onClick={e=>{
                    // 비활성 시간대: 내부일정만 허용
                    if(room.isStaffCol && (room.activeFrom||room.activeUntil)) {
                      const rect2=e.currentTarget.getBoundingClientRect();
                      const clickMin = startHour*60 + Math.floor((e.clientY-rect2.top)/rowH)*5;
                      const fromMin = room.activeFrom ? parseInt(room.activeFrom.split(":")[0])*60+parseInt(room.activeFrom.split(":")[1]) : 0;
                      const untilMin = room.activeUntil ? parseInt(room.activeUntil.split(":")[0])*60+parseInt(room.activeUntil.split(":")[1]) : 24*60;
                      if(clickMin < fromMin || clickMin >= untilMin) {
                        // 근무 외 시간 → 내부일정 모드로 모달 열기
                        if(!canEdit(room.branch_id)) return;
                        const h=Math.floor(clickMin/60), m=clickMin%60;
                        const time=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                        setModalData({roomId:room.id,bid:room.branch_id,time,date:selDate,isSchedule:true,scheduleOnly:true});
                        setShowModal(true);
                        return;
                      }
                    }
                    const rect=e.currentTarget.getBoundingClientRect();handleCellClick(room,e.clientY-rect.top);
                  }}
                  onMouseMove={e=>{if(room.isNaver)return;const rect=e.currentTarget.getBoundingClientRect();const y=e.clientY-rect.top;const ri=Math.floor(y/rowH);setHoverCell({roomId:room.id,rowIdx:ri})}}
                  onMouseLeave={()=>setHoverCell(null)}
                  onTouchStart={e=>{
                    lastTouchCell.current=Date.now();
                    if(room.isNaver||!canEdit(room.branch_id))return;
                    const t=e.touches[0];const rect=e.currentTarget.getBoundingClientRect();
                    const y=t.clientY-rect.top;const ri=Math.floor(y/rowH);
                    setHoverCell({roomId:room.id,rowIdx:ri});
                    cellLongPress.current={moved:false,y,room};
                  }}
                  onTouchMove={e=>{
                    if(cellLongPress.current)cellLongPress.current.moved=true;
                    clearTimeout(cellLongPress.current?.timer);
                    if(room.isNaver)return;
                    const t=e.touches[0];const rect=e.currentTarget.getBoundingClientRect();
                    const y=t.clientY-rect.top;const ri=Math.floor(y/rowH);
                    setHoverCell({roomId:room.id,rowIdx:ri});
                  }}
                  onTouchEnd={()=>{
                    const lp=cellLongPress.current;cellLongPress.current=null;
                    if(lp&&!lp.moved){
                      const time=yToTime(lp.y);
                      setModalData({roomId:lp.room.id,bid:lp.room.branch_id,time,date:selDate});
                      setShowModal(true);
                    }
                    setTimeout(()=>setHoverCell(null),300);
                  }}
                >
                  {/* Hover/touch highlight */}
                  {/* 비활성 시간대 오버레이 */}
                  {room.isStaffCol && (room.activeFrom||room.activeUntil) && (()=>{
                    const startMin2 = startHour*60;
                    const fromMin2 = room.activeFrom ? parseInt(room.activeFrom.split(":")[0])*60+parseInt(room.activeFrom.split(":")[1]) : startMin2;
                    const untilMin2 = room.activeUntil ? parseInt(room.activeUntil.split(":")[0])*60+parseInt(room.activeUntil.split(":")[1]) : startMin2+totalRows*5;
                    const beforeH2 = Math.max(0,(fromMin2-startMin2)/5*rowH);
                    const afterTop2 = Math.min(totalRows*rowH,(untilMin2-startMin2)/5*rowH);
                    const afterH2 = Math.max(0,totalRows*rowH-afterTop2);
                    return <>
                      {beforeH2>0&&<div style={{position:"absolute",top:0,left:0,right:0,height:beforeH2,background:"rgba(0,0,0,.06)",zIndex:2,pointerEvents:"none",borderBottom:"2px dashed rgba(0,0,0,.12)"}}/>}
                      {afterH2>0&&<div style={{position:"absolute",top:afterTop2,left:0,right:0,height:afterH2,background:"rgba(0,0,0,.06)",zIndex:2,pointerEvents:"none",borderTop:"2px dashed rgba(0,0,0,.12)"}}/>}
                      {room.activeFrom&&fromMin2>startMin2&&<div style={{position:"absolute",top:(fromMin2-startMin2)/5*rowH,left:0,right:0,zIndex:3,pointerEvents:"none",display:"flex",alignItems:"center"}}>
                        <div style={{flex:1,height:2,background:T.primary,opacity:.5}}/>
                        <span style={{fontSize:9,color:T.primary,fontWeight:700,background:T.bgCard,padding:"0 3px",borderRadius:3,whiteSpace:"nowrap",flexShrink:0}}>{room.activeFrom}~</span>
                      </div>}
                      {room.activeUntil&&<div style={{position:"absolute",top:(untilMin2-startMin2)/5*rowH-1,left:0,right:0,zIndex:3,pointerEvents:"none",display:"flex",alignItems:"center"}}>
                        <div style={{flex:1,height:2,background:T.danger,opacity:.5}}/>
                        <span style={{fontSize:9,color:T.danger,fontWeight:700,background:T.bgCard,padding:"0 3px",borderRadius:3,whiteSpace:"nowrap",flexShrink:0}}>~{room.activeUntil}</span>
                      </div>}
                    </>;
                  })()}
                  {hoverCell?.roomId===room.id && hoverCell.rowIdx>=0 && <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.12)",borderTop:"1px solid rgba(124,124,200,0.3)",borderBottom:"1px solid rgba(124,124,200,0.3)",zIndex:1,pointerEvents:"none",transition:"top 0.05s ease"}}/>}
                  {/* Row crosshair highlight (other columns) */}
                  {hoverCell && hoverCell.roomId!==room.id && hoverCell.rowIdx>=0 && <div style={{position:"absolute",top:hoverCell.rowIdx*rowH,left:0,right:0,height:rowH,background:"rgba(124,124,200,0.04)",zIndex:1,pointerEvents:"none"}}/>}
                  {/* Current time */}
                  {nowY > 0 && <div style={{position:"absolute",top:nowY,left:0,right:0,borderTop:"2px solid #e57373",zIndex:5}}>
                    <div style={{position:"absolute",top:-4,left:-1,width:8,height:8,borderRadius:T.radius.sm,background:T.danger}}/>
                  </div>}
                  {/* Blocks */}
                  {(() => {
                    // ── 겹침 감지 + 좌우 분할 (Google Calendar 방식) ──
                    const layoutBlocks = (blocks) => {
                      if (blocks.length <= 1) return blocks.map(b => ({...b, _col:0, _totalCols:1}));
                      const sorted = [...blocks].sort((a,b) => timeToY(a.time) - timeToY(b.time));
                      // Group overlapping blocks
                      const groups = []; let cur = [sorted[0]];
                      for (let i=1; i<sorted.length; i++) {
                        const bk = sorted[i];
                        const bkY = timeToY(bk.time);
                        const grpMaxEnd = Math.max(...cur.map(g => timeToY(g.time) + Math.max((g.dur/timeUnit)*rowH, rowH*2)));
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
                          const bkEnd = bkStart + Math.max((bk.dur/timeUnit)*rowH, rowH*2);
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
                    const blockDur = isBeingResized ? resizeDur : block.dur;
                    const h = (blockDur / timeUnit) * rowH;
                    // 서비스태그 색상 우선 적용
                    const tags = data?.serviceTags || [];
                    const tagColor = block.type==="reservation" && block.selectedTags?.length
                      ? (block.selectedTags.map(tid=>tags.find(t=>t.id===tid)).find(t=>t?.color)?.color || "")
                      : "";
                    // 네이버 취소/대기 상태 처리
                    const isNaverCancelled = block.status === "naver_cancelled";
                    const isNaverPending = (block.status === "pending" || block.status === "request") && !(block.memo && block.memo.includes("확정완료"));
                    // 네이버 예약이고 아직 일반 칼럼에 미배정 (roomId 없거나 nv_ 접두)
                    const isNaverUnassigned = !!block.reservationId && (!block.roomId || block.roomId.startsWith("nv_"));
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
                        onClick={e=>handleBlockClick(block,e)}
                        onMouseDown={e=>{if(isEditable && !isResizing.current)handleDragStart(block,e)}}
                        onTouchStart={e=>{if(isEditable && !isResizing.current)handleDragStart(block,e)}}
                        style={{position:"absolute",top:y,
                          left: block._totalCols > 1 ? 3 + (block._col * ((colW - 6) / block._totalCols)) : 3,
                          width: block._totalCols > 1 ? ((colW - 6) / block._totalCols) - 2 : undefined,
                          right: block._totalCols > 1 ? undefined : 3,
                          height:Math.max(h,rowH*2),
                          background:isNaverCancelled?T.warningLt:isNaverUnassigned?T.warningLt:isNaverPending?`${color}15`:`${color}${bgAlpha}`,
                          border:isNaverCancelled?"1.5px dashed #E6A700":isNaverUnassigned?"1.5px dashed #FF9800":isNaverPending?`1.5px dashed ${color}`:"none",
                          borderLeft:`3.5px solid ${isNaverCancelled?T.warning:isNaverUnassigned?T.orange:color}`,
                          borderRadius:T.radius.md,padding:"4px 6px",overflow:"hidden",fontSize:blockFs,lineHeight:1.2,
                          boxShadow:isDrag?"none":"0 1px 4px rgba(0,0,0,.1)",
                          cursor:isEditable?"grab":"pointer",zIndex:isDrag?0:3,transition:(isDrag||isBeingResized)?"none":"all .15s, box-shadow .2s",
                          opacity:isDrag?0.15:1,userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none"}}
                        className="tl-block">
                        {block.type==="reservation" && !block.isSchedule && <>
                          <div style={{display:"flex",alignItems:"center",gap:2,flexWrap:"wrap"}}>
                            {/* 태그 - 이름 앞에 */}
                            {isNaverCancelled && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.warning,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>취소</span>}
                            {isNaverUnassigned && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.orange,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>미배정</span>}
                            {isNaverPending && !isNaverUnassigned && <span style={{fontSize:Math.max(6,blockFs-2),padding:"1px 3px",borderRadius:T.radius.sm,background:T.orange,color:T.bgCard,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0,animation:"pendingBlink 1.5s infinite"}}>대기</span>}
                            {block.selectedTags?.slice(0,3).map(tid=>{
                              const tg=tags.find(t=>t.id===tid);
                              if(!tg) return null;
                              const bg=tg.color||T.primary;
                              const h=bg.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
                              const txt=(0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard;
                              return <span key={tid} style={{fontSize:Math.max(6,blockFs-2),padding:"1px 4px",borderRadius:T.radius.sm,background:bg,color:txt,fontWeight:T.fw.bolder,lineHeight:1,flexShrink:0}}>{tg.name}</span>;
                            })}
                            {block.selectedTags?.length>3 && <span style={{fontSize:Math.max(6,blockFs-2),color:T.bgCard,background:T.gray500,borderRadius:T.radius.sm,padding:"1px 2px",flexShrink:0}}>+{block.selectedTags.length-3}</span>}
                            {/* 이름 */}
                            <span style={{fontWeight:T.fw.bold,color:isNaverCancelled?T.gray500:T.text,textDecoration:isNaverCancelled?"line-through":"none",flexShrink:1,minWidth:0}}>
                              {(() => {
                                const g = block.custGender || (block.custId && (data?.customers||[]).find(c=>c.id===block.custId)?.gender) || "";
                                return g ? <span style={{color:g==="M"?T.male:T.female}}>{g==="M"?"남":"여"}</span> : null;
                              })()} {block.custName}
                            </span>
                          </div>
                          {block.selectedServices?.length>0 && <div style={{fontSize:Math.max(6,blockFs-2),color:T.text,fontWeight:T.fw.bold,marginTop:1}}>
                            {groupSvcNames(block.selectedServices, SVC_LIST).slice(0,2).join(", ")}
                            {block.selectedServices.length>2 && ` +${block.selectedServices.length-2}`}
                          </div>}
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
                        {block.type==="reservation" && block.isSchedule && <div style={{fontWeight:T.fw.bolder,color:T.text,fontSize:blockFs+1}}>
                          {block.selectedTags?.map(tid=>{const tg=tags.find(t=>t.id===tid);return tg?.name}).filter(Boolean).join(", ")||"내부일정"}
                        </div>}
                        {block.type==="memo" && <div style={{color:T.danger,fontWeight:T.fw.bold}}><I name="fileText" size={10} color={T.danger}/> 메모</div>}
                        {block.type==="clockin" && <div style={{color:T.gray600,fontWeight:T.fw.bold}}><I name="clock" size={10} color={T.gray600}/> {staff?.dn||"출근"}</div>}
                        {block.type==="cleaning" && <div style={{color:T.info,fontWeight:T.fw.bold}}><I name="sparkles" size={10} color={T.info}/> 청소</div>}
                        {block.memo && (() => { const clean = block.memo.split("\n").filter(l => { const t=l.trim(); return !(/^\[등록:|^\[수정:/.test(t)) && !(/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)); }).join("\n").trim(); return clean ? <div style={{color:T.gray700,marginTop:1,whiteSpace:"pre-line",wordBreak:"break-word"}}><I name="msgSq" size={10} color={T.gray600}/> {clean}</div> : null; })()}
                        {/* Resize handle */}
                        {isEditable && <div className="resize-handle" onMouseDown={e=>handleResizeStart(block,e)} onTouchStart={e=>handleResizeStart(block,e)}
                          style={{position:"absolute",bottom:-8,left:0,right:0,height:24,cursor:"ns-resize",
                            display:"flex",alignItems:"flex-start",justifyContent:"center",opacity:0,transition:"opacity .15s",zIndex:3}}>
                          <div style={{width:24,height:4,borderRadius:T.radius.sm,background:color,marginTop:4}}/>
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
          {/* Snap indicator */}
          {dragBlock && dragSnap && (() => {
            const snapY = timeToY(dragSnap.time);
            const snapH = Math.max((dragBlock.dur / timeUnit) * rowH, rowH * 2);
            const roomIdx = allRooms.findIndex(r => r.id === dragSnap.roomId);
            if (roomIdx < 0) return null;
            const snapLeft = timeLabelsW + roomIdx * colW + 2;
            return <div style={{position:"absolute",top:headerH+snapY,left:snapLeft,width:colW-4,height:snapH,
              background:"#7c7cc815",border:"1.5px solid #7c7cc860",borderRadius:T.radius.md,pointerEvents:"none",zIndex:50,boxShadow:"0 2px 8px rgba(124,124,200,.2)"}}/>;
          })()}
        </div>
      </div>

      {/* Drag ghost - follows cursor */}
      {dragBlock && dragPos && <div style={{position:"fixed",
        left:scrollRef.current?.getBoundingClientRect().left+dragPos.x-50,
        top:scrollRef.current?.getBoundingClientRect().top+dragPos.y-15,
        width:colW-10,padding:"5px 8px",
        background:T.bgCard,color:T.text,borderRadius:T.radius.md,fontSize:T.fs.xs,fontWeight:T.fw.bold,
        borderLeft:`3px solid ${BLOCK_COLORS[dragBlock.type]||T.primary}`,
        boxShadow:"0 8px 24px rgba(0,0,0,.2)",pointerEvents:"none",zIndex:100,opacity:.95}}>
        <div style={{fontSize:T.fs.nano,color:T.primary,fontWeight:T.fw.bolder}}>{dragBlock.time} → {dragSnap?.time||"?"}</div>
        <div>{dragBlock.custGender && <span style={{color:dragBlock.custGender==="M"?T.male:T.female}}>{dragBlock.custGender==="M"?"남":"여"}</span>} {dragBlock.custName}</div>
        <div style={{fontSize:T.fs.nano,color:T.gray500}}>{allRooms.find(r=>r.id===dragSnap?.roomId)?.name||""}</div>
      </div>}

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
            const rsvUrl = rsvUrlId ? "https://blissme.ai/bliss-app/r.html?"+encodeURIComponent(rsvUrlId) : "";
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

      {showModal && <TimelineModal item={modalData} onSave={handleSave} onDelete={handleDelete} onDeleteRequest={handleDeleteRequest} naverColShow={naverColShow} onClose={()=>_mc(()=>{setShowModal(false);setModalData(null)})} selBranch={userBranches[0]} userBranches={userBranches} data={{...data, staff: BASE_EMP_LIST.map(e=>({id:e.id,bid:e.branch_id,dn:e.id,name:e.id,branch_id:e.branch_id})), workingStaffIds: (() => { const ws = getWorkingStaff(modalData?.bid, selDate); return ws ? ws.map(e=>e.id) : null; })() }} setData={setData} setPage={setPage} setPendingChat={setPendingChat} setPendingOpenCust={setPendingOpenCust}/>}

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
    </div>
  );
}


export default Timeline
