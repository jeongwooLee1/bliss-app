import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, NAVER_COLS, getNaverVal, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, BRANCH_DEFAULT_COLORS, branchColor, STATUS_CLR_DEFAULT, STATUS_KEYS, SCH_BRANCH_MAP } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, queueAlimtalk } from '../../lib/sb'
import { useMaleRotation } from '../../lib/useData'
import { fromDb, toDb, resolveSystemIds, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone } from '../../lib/utils'
import I from '../common/I'
import TimelineModal from './ReservationModal'
import QuickBookModal from './QuickBookModal'
import TimelineSettings from './TimelineSettings'
import { MiniCal } from '../../pages/AppShell'
import useTouchDragSort from '../../hooks/useTouchDragSort'

const _mc = (fn) => { if(fn) fn(); };
const uid = genId;

// 페이지 이동 후 돌아왔을 때 스크롤 위치 복원용 (모듈 레벨 - 컴포넌트 언마운트 후에도 유지)
let _savedScroll = null; // { top, left, date }
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
  useEffect(() => {
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
    const mergeEmps = (empVal, customVal) => {
      const base = typeof empVal === 'string' ? JSON.parse(empVal) : (Array.isArray(empVal) ? empVal : []);
      const custom = typeof customVal === 'string' ? JSON.parse(customVal) : (Array.isArray(customVal) ? customVal : []);
      const ids = new Set(base.map(e => e.id));
      const merged = [...base];
      custom.forEach(e => { if (!ids.has(e.id)) { merged.push(e); ids.add(e.id); } });
      // MALE_EMPLOYEES 하드코딩 제거 — 전 직원 employees_v1에 통합
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

    // 모든 직원 중 이 지점에 해당하는 직원 찾기
    const working = [];
    BASE_EMP_LIST.forEach(e => {
      const dayStatus = schHistory[e.id]?.[date];
      if (dayStatus === "휴무" || dayStatus === "휴무(꼭)") return;

      // empOverride 세그먼트 우선 (여러 지점 시간대별 이동/지원)
      const ov = getEmpOverride(e.id, date);
      if (ov && ov.segments?.length) {
        if (ov.segments.some(s => s.branchId === branchId)) {
          working.push(e);
        }
        // 이동/지원 관계없이 원래 지점도 포함 (이동 시에는 _movedOut 플래그로 비활성화 표시)
        const emp = BASE_EMP_LIST.find(b => b.id === e.id);
        if (emp && emp.branch_id === branchId && !working.some(w => w.id === e.id)) {
          working.push({...e, _movedOut: ov.exclusive === true});
        }
        return;
      }

      // "지원(강남)" → 해당 지점에 표시
      const supportBid = parseSupportBranch(dayStatus);
      if (supportBid === branchId) {
        working.push(e);
        return;
      }

      // 지원 중인 직원은 원래 지점에도 비활성화로 표시 (제거하지 않음)
      if (supportBid) {
        const emp = BASE_EMP_LIST.find(b => b.id === e.id);
        if (emp && emp.branch_id === branchId) {
          working.push({...e, _movedOut: true});
        }
        return;
      }

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
    // empWorkHours에서 근무시간 가져오기 (일별 > 지점 기본근무시간)
    const branchTs = (data?.branches||[]).find(b=>b.id===branchId)?.timelineSettings;
    const branchHours = branchTs?.defaultWorkStart ? {start:branchTs.defaultWorkStart, end:branchTs.defaultWorkEnd||"21:00"}
      : branchTs?.openTime ? {start:branchTs.openTime, end:branchTs.closeTime||"21:00"} : null;
    const wh = empWorkHours[empId+"_"+branchId+"_"+date] || empWorkHours[empId+"_"+branchId] || empWorkHours[empId+"_"+date] || empWorkHours[empId]
      || branchHours;
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
        // 유효기간 체크 (note "유효:YYYY-MM-DD")
        const expMatch = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
        if (expMatch && expMatch[1] < today) return; // 만료된 것 제외
        const isDadam = sn.includes("다담") || sn.includes("선불");
        if (isDadam) {
          const m = (p.note||"").match(/잔액:([0-9,]+)/);
          const bal = m ? Number(m[1].replace(/,/g,"")) : 0;
          if (bal > 0) map[p.customer_id].push({ name: sn.replace(/\(잔액:[^)]*\)/,"").trim(), remain: bal, isDadam: true });
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
      // 현재 화면에 실제로 보이는 컬럼 순서를 기준으로 작업
      const visibleIds = (allRoomsRef.current||[])
        .filter(r => r.branch_id === branchId && r.staffId && r.isStaffCol)
        .map(r => r.staffId);
      // 저장된 order에 있는데 현재 보이지 않는 직원도 보존 (다른 날짜에서 필요할 수 있음)
      const saved = [...(prev[branchId]||[])];
      // 새 order: visibleIds 순서대로 + 저장된 것 중 미노출 직원은 뒤에 보존
      let order = [...visibleIds];
      saved.forEach(id => { if (!order.includes(id)) order.push(id); });
      if (!order.includes(empId)) return prev;
      const idx = order.indexOf(empId);
      // 현재 화면에서 보이는 직원들 내에서만 이동 (보존된 직원은 건너뜀)
      const visIdx = visibleIds.indexOf(empId);
      const newVisIdx = visIdx + dir;
      if (visIdx < 0 || newVisIdx < 0 || newVisIdx >= visibleIds.length) return prev;
      const swapId = visibleIds[newVisIdx];
      const swapIdx = order.indexOf(swapId);
      [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
      return {...prev, [branchId]: order};
    });
  };
  const allRoomsRef = React.useRef([]);
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
      // 근무표 기반 — 휴무 필터
      const filteredStaff = workingStaff.filter(e => {
        if (!schHistory) return true;
        const ds = schHistory[e.id]?.[selDate];
        return ds !== "휴무" && ds !== "휴무(꼭)";
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
      staffRooms = orderedStaff.map(e => {
        const range = getEmpActiveRange(e.id, selDate, br.id);
        return {
          id: `st_${br.id}_${e.id}`, name: e.id,
          branch_id: br.id, branchName: br.short||br.name||"",
          staffId: e.id, isStaffCol: true,
          activeFrom: range?.from || null,   // null=종일
          activeUntil: range?.until || null, // null=종일
          isMovedOut: e._movedOut === true,   // 이동/지원으로 다른 지점으로 간 상태 → 비활성화 표시
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
  allRoomsRef.current = allRooms;
  const isNaverRes = (r) => !!r.reservationId || r.source === "ai_booking";
  const isPendingRes = (r) => r.status === "pending" || r.status === "request";
  const isUnassigned = (r) => !r.roomId && !r.staffId || r.roomId?.startsWith("nv_") || r.roomId?.startsWith("blank_");
  
  const allRoomIds = new Set(allRooms.map(r => r.id));

  const blocks = (data?.reservations||[]).filter(r => {
    if (r.date !== selDate) return false;
    if (!branchesToShow.some(b=>b.id===r.bid)) return false;
    if (r.status === "naver_changed" || r.status === "naver_cancelled" || r.status === "cancelled") return false;
    const isNaver = r.source === "naver" || r.source === "네이버";
    // 네이버 스크래퍼 예약만 스크래핑 완료 대기 (수동 예약/manual_ 접두사는 즉시 표시)
    const isManual = !r.reservationId || String(r.reservationId).startsWith("manual_") || String(r.reservationId).startsWith("ai_");
    if (isNaver && !r.isScrapingDone && !isManual) return false;
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
    // 수동 예약에 고유 reservation_id 생성 (NULLS NOT DISTINCT unique constraint 회피)
    if (!item.reservationId) item.reservationId = "manual_" + (item.id || uid());
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
        const updateRow = toDb("reservations", item);
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
    // + 칼럼 템플릿 삭제
    if (block._isColTemplate) {
      if (!confirm(`"${block.custName||"템플릿"}" 반복 일정을 삭제할까요?`)) return;
      const next = {...colTemplates};
      Object.keys(next).forEach(bid => { next[bid] = (next[bid]||[]).filter(t => t.id !== block.id); });
      saveColTemplates(next);
      return;
    }
    const sourceId = block.repeatSourceId || block.id;
    const hasRepeat = (data.reservations || []).some(r => r.repeatSourceId === sourceId || (r.id === sourceId && r.repeat && r.repeat !== "none"));
    if (hasRepeat) {
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

    const onDragMove = (ev) => {
      const pt = isTouch ? ev.touches[0] : ev;
      if (!pt) return;
      ev.preventDefault();
      const sr = scrollRef.current; if (!sr) return;
      const rect = sr.getBoundingClientRect();
      const x = pt.clientX - rect.left + sr.scrollLeft;
      const y = pt.clientY - rect.top + sr.scrollTop;
      setDragPos({ x: pt.clientX - rect.left, y: pt.clientY - rect.top });
      const colX = x - timeLabelsW;
      const roomIdx = Math.max(0, Math.min(allRooms.length - 1, Math.floor(colX / colW)));
      const targetRoom = allRooms[roomIdx];
      const snappedTime = yToTime(Math.max(0, y));
      setDragSnap({ roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime });
      dragSnapRef.current = { roomId: targetRoom?.id, bid: targetRoom?.branch_id, time: snappedTime };
    };
    const onDragUp = () => {
      document.removeEventListener(isTouch ? "touchmove" : "mousemove", onDragMove);
      document.removeEventListener(isTouch ? "touchend" : "mouseup", onDragUp);
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
            custName: "", custPhone: "", memo: tpl.memo || "",
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
        longPressActive.current = true; isDragging.current = true;
        setDragBlock(fakeBlock);
        try { navigator.vibrate && navigator.vibrate(30); } catch {}
        document.addEventListener("touchmove", onDragMove, {passive:false});
        document.addEventListener("touchend", onDragUp);
      }, 500);
    } else {
      const onMouseMove = (ev) => {
        const dx = ev.clientX - dragStartRef.current.x;
        const dy = ev.clientY - dragStartRef.current.y;
        if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < 6) return;
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
    const onScroll = () => {
      _savedScroll = { top: sr.scrollTop, left: sr.scrollLeft, date: selDate };
    };
    sr.addEventListener('scroll', onScroll, { passive: true });
    return () => sr.removeEventListener('scroll', onScroll);
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
            const roomBlocks = (() => {
              // + 칼럼: 매일 반복 템플릿 (schedule_data.colTemplates_v1)만 표시
              if (room.isBlank && room.isAddCol) {
                const tpls = colTemplates[room.branch_id] || [];
                return tpls.map(t => ({
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
            const branchColor = (data.branchSettings || []).find(bs => bs.id === room.branch_id)?.color || "";
            return (
              <div key={room.id} className="tl-room-col" data-branch-id={room.branch_id} style={{width:colW,flexShrink:0,borderLeft:room.isNaver?"2px solid #A5D6A7":(isNewBranch&&ci>0?"none":"1px solid #f0f0f0"),background:room.isNaver?T.successLt:(branchColor||T.bgCard),marginLeft:isNewBranch&&ci>0?4:0,boxShadow:isNewBranch&&ci>0?"-4px 0 8px rgba(0,0,0,.06)":room.isNaver?"inset 2px 0 4px rgba(76,175,80,.08)":"none",position:"relative"}}>
                {/* 이동/지원 직원: 휴무 스타일 오버레이 (배경만, 블록 클릭은 허용) */}
                {room.isMovedOut && <div style={{position:"absolute",top:headerH,left:0,right:0,bottom:0,background:"rgba(0,0,0,.06)",borderTop:"2px dashed rgba(0,0,0,.12)",zIndex:1,pointerEvents:"none"}}/>}
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
                            {/* 프리랜서 추가 */}
                            {!addStaffPopup?.selectedEmp && (()=>{
                              const [flName, setFlName] = [addStaffPopup?._flName||"", v=>setAddStaffPopup(p=>({...p,_flName:v}))];
                              const targetBid = room.branch_id;
                              const schKey = Object.entries(SCH_BRANCH_MAP).find(([k,v])=>v===targetBid)?.[0] || "";
                              const addFreelancer = async () => {
                                if(!flName.trim()) return;
                                // 시스템 예약어 보호
                                const RESERVED = ["메모","미배정","청소","출근","휴무","알람","이동","지원"];
                                if (RESERVED.includes(flName.trim())) { alert(`"${flName.trim()}"은(는) 시스템 예약어로 사용할 수 없습니다.`); return; }
                                const newEmp = {id: flName.trim(), branch: schKey, isMale: false, isFreelancer: true};
                                // customEmployees_v1에 추가
                                const H = {apikey:SB_KEY, Authorization:"Bearer "+SB_KEY, "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates"};
                                try {
                                  const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.customEmployees_v1&select=value`, {headers:{apikey:SB_KEY, Authorization:"Bearer "+SB_KEY}});
                                  const rows = await r.json();
                                  const existing = typeof rows?.[0]?.value === 'string' ? JSON.parse(rows[0].value) : (Array.isArray(rows?.[0]?.value) ? rows[0].value : []);
                                  if(existing.some(e=>e.id===newEmp.id)){alert("이미 존재하는 이름입니다.");return;}
                                  const updated = [...existing, newEmp];
                                  await fetch(`${SB_URL}/rest/v1/schedule_data`, {method:"POST", headers:H, body:JSON.stringify({id:"customEmployees_v1",key:"customEmployees_v1",value:JSON.stringify(updated)})});
                                  setEmpList(prev=>[...prev.filter(e=>e.id!==newEmp.id), newEmp]);
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
                                const overrideKey = empName+"_"+selDate;
                                let ovData;
                                if(exclusive) {
                                  // 이동: 대상 지점에만
                                  ovData = {segments:[{branchId:targetBid,from:null,until:null}],exclusive:true};
                                } else {
                                  // 지원: 원래 지점(~시작시간) + 대상 지점(시작시간~)
                                  const from = supportFrom || "14:00";
                                  const segs = [];
                                  if(baseBid) segs.push({branchId:baseBid, from:null, until:from});
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
                              const wh = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id] || (()=>{const bts=(data?.branches||[]).find(b=>b.id===room.branch_id)?.timelineSettings;return bts?.defaultWorkStart?{start:bts.defaultWorkStart,end:bts.defaultWorkEnd||"21:00"}:bts?.openTime?{start:bts.openTime,end:bts.closeTime||"21:00"}:null;})() || {start:"10:00",end:"21:00"};
                              const hours = Array.from({length:36},(_,i)=>{const h=Math.floor(i/2)+6,m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;});
                              const selSt = {flex:1,fontSize:11,padding:"4px 3px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"};
                              const startRef = React.createRef();
                              const endRef = React.createRef();
                              return <div style={{display:"flex",gap:4,alignItems:"center"}}>
                                <select ref={startRef} defaultValue={wh.start} style={selSt}
                                  onChange={e=>{const v=e.target.value; const [hh,mm]=v.split(":").map(Number); const totalMin=Math.min(23*60+30,(hh+10)*60+mm); const eh=Math.floor(totalMin/60),em=totalMin%60; if(endRef.current) endRef.current.value=`${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`;}}>
                                  {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                </select>
                                <span style={{fontSize:11}}>~</span>
                                <select ref={endRef} defaultValue={wh.end} style={selSt}>
                                  {hours.map(h=><option key={h} value={h}>{h}</option>)}
                                </select>
                                <button onClick={()=>{
                                  const s = startRef.current?.value || wh.start;
                                  const en = endRef.current?.value || wh.end;
                                  setEmpWorkHours(p=>({...p,[whKey]:{start:s,end:en}}));
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
                            const allBranches = (data.branches||[]).filter(b=>b.useYn!==false);
                            // 추가할 지점 + 시간 상태
                            const [addBranch,setAddBranch] = [empMovePopup.addBranch||"", v=>setEmpMovePopup(p=>({...p,addBranch:v}))];
                            const [addFrom,setAddFrom] = [empMovePopup.addFrom||"", v=>setEmpMovePopup(p=>({...p,addFrom:v}))];
                            const [addUntil,setAddUntil] = [empMovePopup.addUntil||"", v=>setEmpMovePopup(p=>({...p,addUntil:v}))];

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
                              const ovData = {segments:merged};
                              setEmpBranchOverride(p=>({...p,[overrideKey2]:ovData}));
                              syncOverrideToSch(room.staffId, selDate, ovData);
                              setEmpMovePopup(null);
                            };

                            const removeSeg = (branchId) => {
                              const overrideKey2 = room.staffId+"_"+selDate;
                              const newSegs = segs.filter(s=>s.branchId!==branchId);
                              if(newSegs.length===0) {
                                setEmpBranchOverride(p=>{const n={...p};delete n[overrideKey2];return n;});
                                syncOverrideToSch(room.staffId, selDate, null);
                              } else {
                                const reindexed = newSegs.sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s,until:arr[i+1]?.from||null}));
                                const ovData = {segments:reindexed};
                                setEmpBranchOverride(p=>({...p,[overrideKey2]:ovData}));
                                syncOverrideToSch(room.staffId, selDate, ovData);
                              }
                              setEmpMovePopup(null);
                            };

                            const TIME_OPTS = Array.from({length:48},(_,i)=>{const h=Math.floor(i/2),m=(i%2)*30;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;}).filter(t=>{const hh=parseInt(t);return hh>=startHour&&hh<=endHour;});
                            // segment 변경 → 시간순 정렬 후 다음 segment의 from을 until로 자동 chain
                            const updateSeg = (branchId, field, value) => {
                              const overrideKey2 = room.staffId+"_"+selDate;
                              const prevOv = empBranchOverride[overrideKey2];
                              let newSegs = (prevOv?.segments||[]).map(s => s.branchId === branchId ? {...s, [field]: value || null} : s);
                              // from 변경 시 자동 재정렬 + 연결
                              if (field === "from") {
                                newSegs = newSegs.sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from))).map((s,i,arr)=>({...s, until: arr[i+1]?.from || s.until || null}));
                              }
                              const ovData = {segments: newSegs};
                              setEmpBranchOverride(p=>({...p,[overrideKey2]:ovData}));
                              syncOverrideToSch(room.staffId, selDate, ovData);
                            };
                            // 직원 총 근무시간
                            const wh = empWorkHours[room.staffId+"_"+selDate] || empWorkHours[room.staffId] || (()=>{
                              const bts=(data?.branches||[]).find(b=>b.id===baseBranch)?.timelineSettings;
                              return bts?.defaultWorkStart?{start:bts.defaultWorkStart,end:bts.defaultWorkEnd||"21:00"}:bts?.openTime?{start:bts.openTime,end:bts.closeTime||"21:00"}:null;
                            })();
                            // 시간 → 분 변환
                            const toMn = (t) => { if(!t) return null; const [h,m]=t.split(":").map(Number); return h*60+m; };
                            const whStartMn = toMn(wh?.start) || startHour*60;
                            const whEndMn = toMn(wh?.end) || endHour*60;
                            const whDur = whEndMn - whStartMn;
                            // 시각적 타임라인 바 segments 계산 (원래 지점은 gap에만 채움)
                            const visualSegs = (() => {
                              const sorted = [...segs].sort((a,b)=>(!a.from?-1:!b.from?1:a.from.localeCompare(b.from)));
                              const out = [];
                              sorted.forEach((s, i) => {
                                const fromMn = toMn(s.from) || whStartMn;
                                const untilMn = toMn(s.until) || toMn(sorted[i+1]?.from) || whEndMn;
                                if (untilMn > fromMn) out.push({branchId: s.branchId, fromMn, untilMn});
                              });
                              // 출근시간부터 첫 segment까지가 빈 구간이면 출근지로 채움
                              if (baseBranch && out.length > 0 && out[0].fromMn > whStartMn) {
                                out.unshift({branchId: baseBranch, fromMn: whStartMn, untilMn: out[0].fromMn, isHome: true});
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
                                  const bar = e.currentTarget.parentElement.parentElement;
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
                                return <div style={{padding:"6px 12px 0"}}>
                                  <div style={{position:"relative",display:"flex",height:22,borderRadius:4,overflow:"hidden",border:"1px solid "+T.border,userSelect:"none"}}>
                                    {visualSegs.map((vs,i) => {
                                      const br = allBranches.find(b=>b.id===vs.branchId);
                                      const w = Math.max(0, (vs.untilMn - vs.fromMn) / whDur * 100);
                                      if (w <= 0) return null;
                                      const bg = colorOf(vs.branchId);
                                      const name = br?.short || br?.name || "";
                                      const isLast = i === visualSegs.length - 1;
                                      return <div key={i} style={{position:"relative",width:w+"%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",overflow:"hidden",whiteSpace:"nowrap",opacity:vs.isHome?0.7:1,borderRight:isLast?"none":"1px solid rgba(0,0,0,.2)"}} title={`${name} ${mnToTime(vs.fromMn)}~${mnToTime(vs.untilMn)}`}>
                                        <span style={{pointerEvents:"none",textShadow:"0 1px 2px rgba(0,0,0,.3)"}}>{w>8?name:""}</span>
                                        {/* 경계 드래그 핸들 (마지막 제외) */}
                                        {!isLast && <div onMouseDown={onHandleDown(i)} onTouchStart={onHandleDown(i)}
                                          style={{position:"absolute",top:0,right:-4,width:8,height:"100%",cursor:"col-resize",zIndex:2,background:"rgba(255,255,255,.0)"}}
                                          onMouseOver={e=>e.currentTarget.style.background="rgba(255,255,255,.3)"}
                                          onMouseOut={e=>e.currentTarget.style.background="rgba(255,255,255,0)"}/>}
                                      </div>;
                                    })}
                                  </div>
                                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:T.textMuted,marginTop:2}}>
                                    <span>{wh?.start||mnToTime(whStartMn)}</span>
                                    <span>{wh?.end||mnToTime(whEndMn)}</span>
                                  </div>
                                </div>;
                              })()}
                              {/* 현재 구간 목록 — 인라인 편집 가능 */}
                              {segs.length>0 && <div style={{padding:"6px 12px"}}>
                                {segs.map(s=>{
                                  const br = allBranches.find(b=>b.id===s.branchId);
                                  return <div key={s.branchId} style={{display:"flex",alignItems:"center",gap:3,marginBottom:4,fontSize:11}}>
                                    <span style={{width:6,height:6,borderRadius:"50%",background:br?.color||T.primary,flexShrink:0}}/>
                                    <span style={{fontWeight:600,minWidth:50}}>{br?.short||br?.name}</span>
                                    <select value={s.from||""} onChange={e=>updateSeg(s.branchId,"from",e.target.value)}
                                      style={{flex:1,fontSize:10,padding:"2px 3px",borderRadius:4,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                      <option value="">시작</option>
                                      {TIME_OPTS.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <span style={{color:T.textMuted}}>~</span>
                                    <select value={s.until||""} onChange={e=>updateSeg(s.branchId,"until",e.target.value)}
                                      style={{flex:1,fontSize:10,padding:"2px 3px",borderRadius:4,border:"1px solid "+T.border,fontFamily:"inherit"}}>
                                      <option value="">종일</option>
                                      {TIME_OPTS.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <button onClick={()=>removeSeg(s.branchId)} style={{width:16,height:16,border:"none",background:"none",cursor:"pointer",color:T.danger,fontSize:14,padding:0,lineHeight:1,flexShrink:0}}>×</button>
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
                                    const overrideKey2 = room.staffId+"_"+selDate;
                                    const newSeg = {branchId:addBranch, from:addFrom||null, until:addUntil||null};
                                    // 기존 segments에 추가 (중복 지점은 교체)
                                    const prevOv = empBranchOverride[overrideKey2];
                                    const prevSegs = (prevOv?.segments || []).filter(s => s.branchId !== addBranch);
                                    const segments = [...prevSegs, newSeg];
                                    // 전체 이동(시간 없음)인 세그먼트가 하나라도 있으면 exclusive
                                    const hasAllDay = segments.some(s => !s.from && !s.until);
                                    const hasTimed = segments.some(s => s.from || s.until);
                                    const ovData = {segments, exclusive: hasAllDay && !hasTimed};
                                    setEmpBranchOverride(p=>({...p,[overrideKey2]:ovData}));
                                    syncOverrideToSch(room.staffId, selDate, ovData);
                                    setEmpMovePopup(null);
                                  }} disabled={!addBranch}
                                    style={{flex:1,padding:"7px 0",borderRadius:7,border:"none",background:addBranch?T.primary:T.gray300,color:"#fff",fontSize:11,fontWeight:700,cursor:addBranch?"pointer":"not-allowed",fontFamily:"inherit"}}
                                    title="시작/종료 시간 미입력 시 전체 이동. 여러 지점 이동 가능.">
                                    이동
                                  </button>
                                </div>
                              </div>
                            </>;
                          })()}
                          {/* 오늘 휴무 / 프리랜서 컬럼 삭제 */}
                          <div style={{borderTop:"1px solid "+T.border,padding:"8px 12px",display:"flex",gap:6}}>
                            <button onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`${room.staffId} 오늘(${selDate}) 휴무 처리할까요?\n(컬럼이 사라집니다)`)) return;
                              try {
                                const newSch = {...(schHistory||{})};
                                if (!newSch[room.staffId]) newSch[room.staffId] = {};
                                newSch[room.staffId][selDate] = "휴무";
                                setSchHistory(newSch);
                                const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
                                await fetch(`${SB_URL}/rest/v1/schedule_data`, { method:"POST", headers:H, body: JSON.stringify({id:"schHistory_v1", key:"schHistory_v1", value: JSON.stringify(newSch)}) });
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
                                if (!confirm(`"${room.staffId}" 프리랜서 컬럼을 삭제할까요?\n(모든 지점/날짜에서 제거됩니다)`)) return;
                                const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
                                try {
                                  const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.customEmployees_v1&select=value`, { headers: H });
                                  const rows = await r.json();
                                  const existing = typeof rows?.[0]?.value === "string" ? JSON.parse(rows[0].value) : (Array.isArray(rows?.[0]?.value) ? rows[0].value : []);
                                  const filtered = existing.filter(x => x.id !== room.staffId);
                                  await fetch(`${SB_URL}/rest/v1/schedule_data`, {
                                    method: "POST", headers: H,
                                    body: JSON.stringify({ id: "customEmployees_v1", key: "customEmployees_v1", value: JSON.stringify(filtered) })
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
                    <span className="tl-room-sub" style={{fontSize:T.fs.nano,color:room.isNaver?T.successDk:T.gray500,display:"inline-flex",alignItems:"center",gap:3}}>
                      {room.isNaver?<I name="naver" size={11}/>:""}{room.name}
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
                              const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.customEmployees_v1&select=value`, { headers: H });
                              const rows = await r.json();
                              const existing = typeof rows?.[0]?.value === "string" ? JSON.parse(rows[0].value) : (Array.isArray(rows?.[0]?.value) ? rows[0].value : []);
                              const filtered = existing.filter(x => x.id !== room.staffId);
                              await fetch(`${SB_URL}/rest/v1/schedule_data`, {
                                method: "POST", headers: H,
                                body: JSON.stringify({ id: "customEmployees_v1", key: "customEmployees_v1", value: JSON.stringify(filtered) })
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
                </div>
                {/* Grid Area */}
                <div style={{position:"relative",height:totalRows*rowH,cursor:(room.isBlank&&room.isAddCol)?"pointer":room.isBlank?"default":room.isNaver?"default":(canEdit(room.branch_id)?"pointer":"default"),...(room.isBlank?{background:"repeating-linear-gradient(45deg,#f5f5f5,#f5f5f5 6px,#fafafa 6px,#fafafa 12px)"}:gridBg)}}
                  onClick={e=>{
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
                        setModalData({roomId:"",staffId:room.staffId,bid:room.branch_id,time,date:selDate,isSchedule:true});
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
                  {/* 비활성 시간대 오버레이 + 드래그 핸들 */}
                  {room.isStaffCol && (room.activeFrom||room.activeUntil) && (()=>{
                    const startMin2 = startHour*60;
                    const fromMin2 = room.activeFrom ? parseInt(room.activeFrom.split(":")[0])*60+parseInt(room.activeFrom.split(":")[1]) : startMin2;
                    const untilMin2 = room.activeUntil ? parseInt(room.activeUntil.split(":")[0])*60+parseInt(room.activeUntil.split(":")[1]) : startMin2+totalRows*5;
                    const beforeH2 = Math.max(0,(fromMin2-startMin2)/5*rowH);
                    const afterTop2 = Math.min(totalRows*rowH,(untilMin2-startMin2)/5*rowH);
                    const afterH2 = Math.max(0,totalRows*rowH-afterTop2);
                    const mnToTime = (mn) => `${String(Math.floor(mn/60)).padStart(2,"0")}:${String(mn%60).padStart(2,"0")}`;
                    // 드래그 핸들러 (시작/종료 시간 조절)
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
                        const t = mnToTime(Math.max(startMin2, Math.min(startMin2+totalRows*5, newMn)));
                        const whKey = room.staffId+"_"+room.branch_id+"_"+selDate;
                        const wh = empWorkHours[whKey] || empWorkHours[room.staffId+"_"+room.branch_id] || {start: room.activeFrom||mnToTime(startMin2), end: room.activeUntil||mnToTime(startMin2+totalRows*5)};
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
                    return <>
                      {beforeH2>0&&<div style={{position:"absolute",top:0,left:0,right:0,height:beforeH2,background:"rgba(0,0,0,.06)",zIndex:2,pointerEvents:"none",borderBottom:"2px dashed rgba(0,0,0,.12)"}}/>}
                      {afterH2>0&&<div style={{position:"absolute",top:afterTop2,left:0,right:0,height:afterH2,background:"rgba(0,0,0,.06)",zIndex:2,pointerEvents:"none",borderTop:"2px dashed rgba(0,0,0,.12)"}}/>}
                      {/* 출근 시간 드래그 핸들 (start boundary) */}
                      {beforeH2>0 && <div onMouseDown={onWhDragStart("start")} onTouchStart={onWhDragStart("start")}
                        style={{position:"absolute",top:beforeH2-6,left:0,right:0,height:12,cursor:"ns-resize",zIndex:4,display:"flex",alignItems:"center",justifyContent:"center"}}
                        title={`출근 ${room.activeFrom||""} (드래그)`}>
                        <div style={{height:3,width:30,borderRadius:2,background:T.primary,opacity:0.5}}/>
                      </div>}
                      {/* 퇴근 시간 드래그 핸들 (end boundary) */}
                      {afterH2>0 && <div onMouseDown={onWhDragStart("end")} onTouchStart={onWhDragStart("end")}
                        style={{position:"absolute",top:afterTop2-6,left:0,right:0,height:12,cursor:"ns-resize",zIndex:4,display:"flex",alignItems:"center",justifyContent:"center"}}
                        title={`퇴근 ${room.activeUntil||""} (드래그)`}>
                        <div style={{height:3,width:30,borderRadius:2,background:T.primary,opacity:0.5}}/>
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
                        onClick={e=>{
                          e.stopPropagation();
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
                          {block.custId && custPkgMap[block.custId]?.length > 0 && (() => {
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
                                background:pkg.isDadam?"#ffeaa7":"#dfe6e9",
                                color:pkg.isDadam?"#d35400":"#2d3436"
                              }}>
                                {pkg.isDadam ? `${pkg.name} ${pkg.totalRemain.toLocaleString()}원` : `${pkg.name} ${pkg.totalRemain}회`}
                                {pkg.count > 1 && <span style={{opacity:0.7,marginLeft:2}}>×{pkg.count}</span>}
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
                          return tagNames ? <div style={{fontWeight:T.fw.bolder,color:T.text,fontSize:blockFs+1}}>{tagNames}</div> : null;
                        })()}
                        {block.type==="memo" && <div style={{color:T.danger,fontWeight:T.fw.bold}}><I name="fileText" size={10} color={T.danger}/> 메모</div>}
                        {block.type==="clockin" && <div style={{color:T.gray600,fontWeight:T.fw.bold}}><I name="clock" size={10} color={T.gray600}/> {staff?.dn||"출근"}</div>}
                        {block.type==="cleaning" && <div style={{color:T.info,fontWeight:T.fw.bold}}><I name="sparkles" size={10} color={T.info}/> 청소</div>}
                        {block.memo && (() => { const clean = block.memo.split("\n").filter(l => { const t=l.trim(); return !(/^\[등록:|^\[수정:/.test(t)) && !(/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)); }).join("\n").trim(); return clean ? <div style={{color:T.gray700,marginTop:1,whiteSpace:"pre-line",wordBreak:"break-word"}}><I name="msgSq" size={10} color={T.gray600}/> {clean}</div> : null; })()}
                        {/* Resize handle */}
                        {isEditable && <div className="resize-handle" onMouseDown={e=>handleResizeStart(block,e)} onTouchStart={e=>handleResizeStart(block,e)}
                          style={{position:"absolute",bottom:-4,left:"25%",right:"25%",height:10,cursor:"ns-resize",
                            display:"flex",alignItems:"flex-start",justifyContent:"center",opacity:0,transition:"opacity .15s",zIndex:3}}>
                          <div style={{width:24,height:3,borderRadius:T.radius.sm,background:color,marginTop:2}}/>
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
