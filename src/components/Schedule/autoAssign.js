export default function autoAssign(year, month, ownerReqs, prevSchData, empSettings={}, supportConfig={}, ruleConfig={}, ownerRepeat={}, employees=employees, empReqs={}, seed=null, empReqsTs={}) {
  const dim = getDim(year, month);
  const rc = {
    minWork:         Number(ruleConfig.minWork)         || 11,
    maxWork:         Number(ruleConfig.maxWork)         || 15,
    maxDailyOff:     Number(ruleConfig.maxDailyOff)     || 5,
    maxConsecWork:   Number(ruleConfig.maxConsecWork)   || 6,
    branchMinStaff:  (ruleConfig.branchMinStaff && typeof ruleConfig.branchMinStaff === "object") ? ruleConfig.branchMinStaff : {},
    // noSimultaneousOff: [{ids:[...], max:N}, ...] 배열 구조
    noSimultaneousOff: Array.isArray(ruleConfig.noSimultaneousOff) ? ruleConfig.noSimultaneousOff : [],
    biweeklyConsecOff: ruleConfig.biweeklyConsecOff ?? true,
  };
  const sch = {};
  employees.forEach(e => { sch[e.id] = {}; });

  // 랜덤 시드 기반 셔플 (자동배치마다 다른 결과)
  const _seed = seed ?? Date.now();
  let _rng = _seed;
  const rng = () => { _rng = (_rng * 1664525 + 1013904223) & 0xffffffff; return (_rng >>> 0) / 0xffffffff; };
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 0) 전달 근무표에서 이번달 날짜 이월 데이터 시드
  //    (예: 3월 마지막 주에 배정된 4월 1~5일 데이터를 4월 autoAssign 시작점으로 사용)
  if (prevSchData) {
    employees.forEach(emp => {
      Object.entries(prevSchData[emp.id] || {}).forEach(([ds, s]) => {
        // 이번달에 속하는 날짜만 (다음달 이월로 포함됐던 날짜)
        const d = new Date(ds);
        if (d.getFullYear() === year && d.getMonth() === month && s && s !== "") {
          sch[emp.id][ds] = s;
        }
      });
    });
  }

  // ownerRepeat 이월(isNext) 날짜 처리 — weeks 정의 전이므로 pending으로 등록, weeks 이후 처리
  let ownerRepeat_pending = null;

  // step0에서 시드된 날짜 = 전달 이월로 이미 결정된 날 → 이후 단계에서 건드리지 않음
  const seededDates = new Set();
  if (prevSchData) {
    employees.forEach(emp => {
      Object.entries(prevSchData[emp.id] || {}).forEach(([ds, s]) => {
        const d = new Date(ds);
        if (d.getFullYear() === year && d.getMonth() === month && s && s !== "") {
          seededDates.add(ds);
        }
      });
    });
  }

  // 1) 원장 요청 휴무 우선 적용 — 해당 월 + 다음달 이월 날짜 포함
  const monthStr = `${year}-${String(month+1).padStart(2,"0")}`;
  const nextYear3b = month === 11 ? year + 1 : year;
  const nextMonthStr = `${nextYear3b}-${String((month+2 > 12 ? 1 : month+2)).padStart(2,"0")}`;
  Object.entries(ownerReqs||{}).forEach(([key, status]) => {
    const [eid, ds] = key.split("__");
    if (sch[eid] && (ds.startsWith(monthStr) || ds.startsWith(nextMonthStr))) {
      sch[eid][ds] = status;
      // seededDates에 추가하지 않음 — 원장 휴무 날짜에 다른 직원 휴무 배정 허용
    }
  });
  // 1-a-2) 일반직원 휴무(꼭) 우선 적용 — 선착순(타임스탬프 기준) maxDailyOff 제한
  // 날짜별로 신청자를 타임스탬프 순 정렬 후 maxDailyOff명까지만 적용
  const empReqsByDay = {}; // { ds: [{eid, ts}] }
  Object.entries(empReqs||{}).forEach(([key, status]) => {
    const parts = key.split("__");
    const eid = parts[0], ds = parts[1];
    if (!ds) return;
    if (!(ds.startsWith(monthStr) || ds.startsWith(nextMonthStr))) return;
    if (!empReqsByDay[ds]) empReqsByDay[ds] = [];
    const ts = (empReqsTs||{})[key] || 0;
    empReqsByDay[ds].push({ eid, ts, status });
  });
  // 날짜별 타임스탬프 정렬 후 maxDailyOff 이내만 적용, 나머지는 WORK 유지
  Object.entries(empReqsByDay).forEach(([ds, reqs]) => {
    reqs.sort((a, b) => a.ts - b.ts); // 빠른 순
    let offCount = 0;
    reqs.forEach(({ eid, ts, status }) => {
      if (!sch[eid]) return;
      if (offCount < rc.maxDailyOff) {
        sch[eid][ds] = status;
        offCount++;
      }
      // maxDailyOff 초과 신청자는 WORK 유지 (선착순 탈락)
    });
  });

  // 1-b) 반복 설정: ownerRepeat dows → 이번달 + 이월(isNext) 날짜 자동 적용 (ownerReqs 우선)
  employees.filter(e=>e.isOwner).forEach(emp => {
    const rep = (ownerRepeat||{})[emp.id];
    if (!rep?.enabled || !rep.dows?.length) return;
    // 이번달 날짜
    for (let d=1; d<=dim; d++) {
      const dow = getDow0Mon(year, month, d);
      if (rep.dows.includes(dow)) {
        const ds = fmtDs(year, month, d);
        if (!sch[emp.id][ds]) sch[emp.id][ds] = STATUS.MUST_OFF;
      }
    }
    // 이월(isNext) 날짜 — 마지막 주에 포함된 다음달 날짜도 적용
    const nextYear_ = month === 11 ? year + 1 : year;
    const nextMonth_ = month === 11 ? 0 : month + 1;
    // isNext 이월 날짜는 weeks 생성 후 별도 처리 (ownerRepeat_pending에 등록)
    // → weeks 정의 이후 step1-b-post에서 처리
    if (!ownerRepeat_pending) ownerRepeat_pending = [];
    ownerRepeat_pending.push({ emp, rep });
  });

  // ── 연속근무 계산 공통 헬퍼 ──────────────────────────────────────────────────
  // ds 직전까지의 연속 근무일수 (sch + prevSchData 참조)
  const getCarry = (empId, ds) => {
    let len = 0;
    for (let i = 1; i <= rc.maxConsecWork + 2; i++) {
      const d2 = new Date(ds); d2.setDate(d2.getDate() - i);
      const ds2 = fmtDs(d2.getFullYear(), d2.getMonth(), d2.getDate());
      const s = sch[empId]?.[ds2] ?? prevSchData?.[empId]?.[ds2] ?? "";
      if (!s || s === "휴무" || s === "휴무(꼭)" || s === "무급") break;
      len++;
    }
    return len;
  };

  // 강제 휴무 배정 가능 여부 (3일연속 + minStaff + maxDailyOff만 체크, 퐁당퐁당 무시)
  const canAssignOffHard = (emp, day, branchEmps, branch) => {
    const ds = day.ds;
    const getS = (id, dStr) => sch[id]?.[dStr] ?? prevSchData?.[id]?.[dStr] ?? "";
    const isOff2 = (id, dStr) => ["휴무","휴무(꼭)","무급"].includes(getS(id, dStr));
    const p1h = addDays(ds,-1), p2h = addDays(ds,-2), n1h = addDays(ds,1);
    // 3일 연속 휴무 절대 금지
    if (isOff2(emp.id,p1h) && isOff2(emp.id,p2h)) return false;
    if (isOff2(emp.id,p1h) && isOff2(emp.id,n1h)) return false;
    // 전체 하루 최대 휴무 — 강제 배정도 maxDailyOff 엄격 준수
    if (!emp.isMale) {
      const totalOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[ds]||"")).length;
      if (totalOff >= rc.maxDailyOff) return false;
    }
    // 대표 지점(branch) 소속 직원 최소 1명 상주 체크
    if (!emp.isOwner && !emp.isMale) {
      const repBranch = emp.branch;
      const repBr = BRANCHES.find(b => b.id === repBranch);
      if (repBr) {
        const repEmps = employees.filter(e => e.branch === repBranch && e.id !== emp.id && !e.isMale && !e.isOwner);
        const repWorking = repEmps.filter(be => {
          const s = sch[be.id]?.[ds] || "";
          if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
          if (isSupport(s) && !s.includes(repBr.name)) return false;
          return true;
        }).length;
        if (repEmps.length >= 1 && repWorking < 1) return false;
      }
    }

    // 지점 최소 인원 — 직원의 모든 소속 지점(branches) 각각 체크
    const empBranchesH = emp.branches || [emp.branch];
    for (const bId of empBranchesH) {
      const br_ = BRANCHES.find(b => b.id === bId);
      if (!br_) continue;
      const brEmps_ = employees.filter(e => (e.branches||[e.branch]).includes(bId) && !e.isMale);
      const working = brEmps_.filter(be => {
        if (be.id === emp.id) return false;
        const s = sch[be.id]?.[ds] || "";
        if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
        if (isSupport(s) && !s.includes(br_.name)) return false;
        return true;
      }).length;
      const supportIn = employees.filter(e =>
        !(e.branches||[e.branch]).includes(bId) && sch[e.id]?.[ds] === `지원(${br_.name})`
      ).length;
      const minRequired = rc.branchMinStaff[bId] ?? br_.minStaff ?? 1;
      if (working + supportIn < minRequired) return false;
    }
    return true;
  };

  // 2) 주 단위 처리 — 이번달 1일이 속한 주에 전달 날짜 포함 (이월 처리)
  const firstDow = getDow0Mon(year, month, 1); // 0=월요일
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevDim = getDim(prevYear, prevMonth);

  // 첫 주에 포함될 전달 날짜들 (전달 마지막 firstDow일)
  const prevDays = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const pd = prevDim - i;
    const ds = fmtDs(prevYear, prevMonth, pd);
    prevDays.push({ d: pd, ds, dow: getDow0Mon(prevYear, prevMonth, pd), isPrev: true });
  }

  const weeks = [];
  let wk = [...prevDays]; // 첫 주에 전달 날짜 포함
  for (let d=1; d<=dim; d++) {
    const ds = fmtDs(year,month,d);
    const dow = getDow0Mon(year,month,d);
    wk.push({d, ds, dow, isPrev: false});
    if (dow===6) { weeks.push(wk); wk=[]; }
    else if (d===dim) {
      // 마지막 날이 일요일이 아니면 다음달 이월 날짜를 이 주에 포함해서 push
      const lastDow2 = dow;
      const nextYear3 = month===11 ? year+1 : year;
      const nextMonth3 = month===11 ? 0 : month+1;
      const toAdd = 6 - lastDow2;
      for (let nd=1; nd<=toAdd; nd++) {
        const nds = fmtDs(nextYear3,nextMonth3,nd);
        const ndow = getDow0Mon(nextYear3,nextMonth3,nd);
        wk.push({d:nd, ds:nds, dow:ndow, isPrev:false, isNext:true});
      }
      weeks.push(wk); wk=[];
    }
  }

  // 1-b-post) ownerRepeat 이월(isNext) 날짜 처리 — weeks 완성 후
  if (ownerRepeat_pending) {
    const lastWeek = weeks[weeks.length - 1] || [];
    ownerRepeat_pending.forEach(({ emp, rep }) => {
      lastWeek.filter(d => d.isNext).forEach(day => {
        if (rep.dows.includes(day.dow)) {
          if (!sch[emp.id][day.ds]) sch[emp.id][day.ds] = STATUS.MUST_OFF;
        }
      });
    });
  }

  // 1일짜리 단독 주: 첫 주에만 적용 (예: 3월 1일이 일요일인 경우)
  // 마지막 주는 제외 — 8/31처럼 혼자 남은 마지막 날도 배정 필요
  const ignoredDates = new Set(
    weeks
      .filter((w, wi) => wi < weeks.length - 1 && w.filter(d => !d.isPrev && !d.isNext).length <= 1)
      .flatMap(w => w.filter(d => !d.isPrev && !d.isNext && !seededDates.has(d.ds)).map(d => d.ds))
  );

  // 이번달 + 이월 날짜 전체 (isPrev 제외, ignoredDates 제외) — step3~7 루프 공통 사용
  const allDates = weeks.flatMap(w => w.filter(d => !d.isPrev && !ignoredDates.has(d.ds)));

  // 한 주에서 이미 쉰 일수 (전달 이월 날짜 제외 — 이번달 날짜만)
  // 이월 날짜를 포함하면 첫 주에 toAssign=0이 되어 배정이 안됨
  const alreadyOffCount = (empId, week) =>
    week.filter(day => {
      if (day.isNext) return false; // 다음달 날짜만 제외 (이전달 isPrev는 포함 - 격주패턴 연속성)
      const s = day.isPrev ? (prevSchData?.[empId]?.[day.ds] || "") : (sch[empId]?.[day.ds] || "");
      return ["휴무","휴무(꼭)","무급"].includes(s);
    }).length;

  // 주의 실제 월~일 인덱스 계산 (주 경계 판별용)
  const getWeekIdx = (ds) => {
    const d = new Date(ds);
    const dow = (d.getDay()+6)%7; // 0=월
    const monday = new Date(d); monday.setDate(d.getDate()-dow);
    return fmtDs(monday.getFullYear(),monday.getMonth(),monday.getDate());
  };

  // 직원별 설정 헬퍼
  const getWeeklyOff = (emp) => {
    const ws = empSettings[emp.id];
    if (ws) return 7 - ws.weeklyWork; // weeklyWork→weeklyOff 변환
    return emp.weeklyOff; // 기본값
  };
  const isAltPattern = (emp) => empSettings[emp.id]?.altPattern ?? false;
  const isFreelancerEmp = (emp) => emp.isFreelancer || empSettings[emp.id]?.isFreelancer || false;

  // 격주패턴 phaseShift: 이전 달 마지막 실제 주의 휴무 수로 결정
  // 이전 달 마지막 주가 lo(1일)로 끝났으면 이번 달 첫 주는 hi(2일)부터 시작 → phaseShift=1
  // 이전 달 마지막 주가 hi(2일)로 끝났으면 이번 달 첫 주는 lo(1일)부터 시작 → phaseShift=0

  // 이번달에 걸친 주 수 (이번달 날짜가 1일 이상 있는 주만)
  const activeWeeks = weeks.filter(w => w.some(d => !d.isPrev));
  // 주 수: 이번달 실제 날짜(!isPrev && !isNext)가 2일 이상인 주만 카운트
  // — 이월된 날짜만 있는 첫 주(예: 5/1~3)는 4월 소속이므로 제외
  const weekCount = Math.max(4, activeWeeks.filter(w => w.filter(d => !d.isPrev && !d.isNext).length >= 2).length);

  // 공통 헬퍼: 날짜 ds에 휴무 배정 시 제약 통과 여부
  const canAssignOff = (emp, day, branchEmps, branch, debug=false, skipAltCheck=false, skipSimultaneous=false) => {
    const ds = day.ds;
    const d = new Date(ds); // 실제 날짜 기반 계산 (isNext 포함 정확히 처리)
    const prev1 = new Date(d); prev1.setDate(d.getDate()-1);
    const prev2 = new Date(d); prev2.setDate(d.getDate()-2);
    const next1 = new Date(d); next1.setDate(d.getDate()+1);
    const next2 = new Date(d); next2.setDate(d.getDate()+2);
    const p1ds = fmtDs(prev1.getFullYear(),prev1.getMonth(),prev1.getDate());
    const p2ds = fmtDs(prev2.getFullYear(),prev2.getMonth(),prev2.getDate());
    const n1ds = fmtDs(next1.getFullYear(),next1.getMonth(),next1.getDate());
    const n2ds = fmtDs(next2.getFullYear(),next2.getMonth(),next2.getDate());
    // 날짜가 현재 sch에 없으면 prevSchData(전달)에서 조회
    const getStatus = (empId, dateStr) => {
      if (sch[empId]?.[dateStr] !== undefined) return sch[empId][dateStr];
      return prevSchData?.[empId]?.[dateStr] || "";
    };
    const p1o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, p1ds));
    const p2o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, p2ds));
    const n1o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, n1ds));
    const n2o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, n2ds));

    const R = (r) => { if(debug) console.log(`[canOff BLOCK] ${emp.id} ${ds}: ${r}`); return false; };
    // 3일 연속 방지
    if (p1o && p2o) return R("3일연속(p2+p1 휴무)");
    if (p1o && n1o) return R("3일연속(p1+n1 휴무)");

    // 퐁당퐁당 방지 — 격주 직원 예외
    if (!skipAltCheck) {
      const n1Assigned = getStatus(emp.id, n1ds) !== "";
      const n2Assigned = getStatus(emp.id, n2ds) !== "";
      const n3ds = fmtDs(...(() => { const d=new Date(ds); d.setDate(d.getDate()+3); return [d.getFullYear(),d.getMonth(),d.getDate()]; })());
      const p3ds = fmtDs(...(() => { const d=new Date(ds); d.setDate(d.getDate()-3); return [d.getFullYear(),d.getMonth(),d.getDate()]; })());
      const p3o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, p3ds));
      const n3o = ["휴무","휴무(꼭)","무급"].includes(getStatus(emp.id, n3ds));

      // 휴-근-휴 차단: p2=휴,p1=근 or n1=근,n2=휴
      if (p2o && !p1o) return R(`퐁당퐁당(p2휴,p1근,[ds=휴])`);
      if (n1Assigned && !n1o && n2o) return R(`퐁당퐁당([ds=휴],n1근,n2휴)`);

      // 근-휴-근-휴 차단: p1=근,ds=휴,n1=근,n2=휴 → [ds=휴] 배정 시 뒤가 근-휴
      if (!p1o && n1Assigned && !n1o && n2Assigned && n2o) return R(`근휴근휴([ds=휴],n1근,n2휴)`);
      // p2=근,p1=휴,ds=근... 앞에서 오는 패턴: 이미 휴-근-휴로 막힘

      // 근-휴-근-휴-근 차단: p2=근,p1=휴,ds=근 → ds는 근무이므로 해당 없음
      // 하지만 [ds=휴] 배정 시 → p2=휴,p1=근,[ds=휴],n1=근,n2=휴 패턴
      // → 이미 위 case1(p2=휴,p1=근)에서 차단됨

      // 근-휴-근-휴: [ds=휴] 앞이 근이고 뒤가 근-휴인 경우 추가 확인
      // p3=휴,p2=근,p1=근,ds=휴,n1=근,n2=휴 → 근휴근휴 연속 패턴
      if (!p1o && !p2o && n1Assigned && !n1o && n2Assigned && n2o) return R(`근근휴근휴패턴`);
    }


    // 전체 하루 최대 휴무 5명 제한 (남자직원 제외 - 별도 집계)
    if (!emp.isMale) {
      const totalOffToday = employees.filter(e => !e.isMale && !(e.isFreelancer || empSettings[e.id]?.isFreelancer) && ["휴무","휴무(꼭)","무급"].includes(sch[e.id][ds])).length;
      if (totalOffToday >= rc.maxDailyOff) return R(`전체휴무${totalOffToday}명 초과`);
    }

    // 지점 최소 근무인원 보호: 직원의 모든 소속 지점(branches) 각각 체크
    const empBranches_ = emp.branches || [emp.branch];
    for (const bId of empBranches_) {
      const br_ = BRANCHES.find(b => b.id === bId);
      if (!br_) continue;
      const brEmps_ = employees.filter(e => (e.branches || [e.branch]).includes(bId) && !e.isMale);
      // 실제로 이 지점에 있는 인원: 근무 또는 지원(이 지점으로 온 경우)
      // 타지점 지원 나간 직원(지원(타지점명))은 이 지점 근무 인원에서 제외
      const ownWorking = brEmps_.filter(be => {
        if (be.id === emp.id) return false; // 본인 제외
        const s = sch[be.id]?.[ds] || "";
        if (["휴무","휴무(꼭)","무급"].includes(s)) return false; // 휴무 제외
        if (isSupport(s) && !s.includes(br_.name)) return false; // 타지점 지원 나간 경우 제외
        return true;
      }).length;
      const supportIn = employees.filter(e =>
        !(e.branches || [e.branch]).includes(bId) && sch[e.id]?.[ds] === `지원(${br_.name})`
      ).length;
      const minS = rc.branchMinStaff[bId] ?? br_.minStaff ?? 1;
      if (ownWorking + supportIn < minS) return false;
    }

    // 대표 지점(branch) 소속 직원 최소 1명 상주 체크
    // 경아/서현은 branch=gangnam → 이 중 최소 1명은 강남에 있어야 함
    // 소연/수연은 branch=wangsimni → 이 중 최소 1명은 왕십리에 있어야 함
    if (!emp.isOwner && !emp.isMale) {
      const repBranch = emp.branch;
      const repBr = BRANCHES.find(b => b.id === repBranch);
      if (repBr) {
        // 같은 대표 지점 소속 직원 중 본인 제외하고 근무 중인 인원
        const repEmps = employees.filter(e => e.branch === repBranch && e.id !== emp.id && !e.isMale && !e.isOwner);
        const repWorking = repEmps.filter(be => {
          const s = sch[be.id]?.[ds] || "";
          if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
          if (isSupport(s) && !s.includes(repBr.name)) return false; // 타지점 지원 나간 경우 제외
          return true;
        }).length;
        // 대표 지점 직원이 본인뿐이면 체크 의미 없음 → 스킵
        if (repEmps.length >= 1 && repWorking < 1) return false;
      }
    }

    // 동시 휴무 금지 그룹 체크 — noSimultaneousOff: [{ids:[...], max:N}, ...]
    if (!skipSimultaneous) {
      for (const group of rc.noSimultaneousOff) {
        if (!group.ids.includes(emp.id)) continue;
        const others = group.ids.filter(id => id !== emp.id);
        const currentOff = others.filter(id => ["휴무","휴무(꼭)","무급"].includes(sch[id]?.[ds])).length;
        const maxAllowed = group.max ?? 1; // 동시에 max명까지 허용 → max명 이상 쉬면 차단
        if (currentOff >= maxAllowed) return false;
      }
    }

    // 남자직원 전원 휴무 금지 (1명은 반드시 근무)
    if (emp.isMale) {
      const otherMales = employees.filter(e => e.isMale && e.id !== emp.id);
      const allOthersOff = otherMales.length > 0 && otherMales.every(e =>
        ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[ds] || "")
      );
      if (allOthersOff) return R("남직원 전원휴무 금지");
    }

    return true;
  };

  // 남자직원 전용 OFF 가능 여부 (퐁당퐁당 제외, 3일연속·전원휴무·지점인원만 체크)
  const canMaleOff = (emp, day, branchEmps, branch) => {
    const ds = day.ds;
    const d = new Date(ds);
    const p1ds = fmtDs(...[new Date(d)].map(x=>{x.setDate(d.getDate()-1);return[x.getFullYear(),x.getMonth(),x.getDate()]})[0]);
    const p2ds = fmtDs(...[new Date(d)].map(x=>{x.setDate(d.getDate()-2);return[x.getFullYear(),x.getMonth(),x.getDate()]})[0]);
    const n1ds = fmtDs(...[new Date(d)].map(x=>{x.setDate(d.getDate()+1);return[x.getFullYear(),x.getMonth(),x.getDate()]})[0]);
    const isOff = (eId, dateStr) => {
      const s = sch[eId]?.[dateStr] ?? prevSchData?.[eId]?.[dateStr] ?? "";
      return ["휴무","휴무(꼭)","무급"].includes(s);
    };
    // 3일 연속 휴무 방지 (평일 기준)
    if (isOff(emp.id, p1ds) && isOff(emp.id, p2ds)) return false;
    if (isOff(emp.id, p1ds) && isOff(emp.id, n1ds)) return false;
    // 남자직원 전원 휴무 금지
    const otherMales = employees.filter(e => e.isMale && e.id !== emp.id);
    if (otherMales.length > 0 && otherMales.every(e => isOff(e.id, ds))) return false;
    // 지점 최소 인원 보호 — branches 기반
    const empBranchesM = emp.branches || [emp.branch];
    for (const bId of empBranchesM) {
      const br_ = BRANCHES.find(b => b.id === bId);
      if (!br_) continue;
      const brEmps_ = employees.filter(e => (e.branches||[e.branch]).includes(bId) && !e.isMale);
      const working = brEmps_.filter(be => {
        if (be.id === emp.id) return false;
        const s = sch[be.id]?.[ds] || "";
        if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
        if (isSupport(s) && !s.includes(br_.name)) return false;
        return true;
      }).length;
      const supportIn = employees.filter(e =>
        !(e.branches||[e.branch]).includes(bId) && sch[e.id]?.[ds] === `지원(${br_.name})`
      ).length;
      const minS = rc.branchMinStaff[bId] ?? br_.minStaff ?? 1;
      if (working + supportIn < minS) return false;
    }
    return true;
  };

  // ══════════════════════════════════════════════════════
  // 남자직원 전용 배정 로직
  // 규칙:
  //   1) 일요일은 1명만 근무 (나머지 휴무)
  //   2) 퐁당퐁당 금지 (휴무-근무-휴무) — 일요일 강제휴무는 기준 제외
  //   3) 남직원 전원 휴무인 날 금지
  //   4) 주 5일 근무 / 2일 휴무
  //   5) 일 근무인원 카운팅 제외 (별도 처리)
  //   6) 3일 연속 휴무 금지
  // ══════════════════════════════════════════════════════
  const maleEmps = employees.filter(e => e.isMale);


  // ── STEP A: 남자직원 일요일 배정 (greedy 누적 카운트 기반 균등 배분) ──
  // step 2 이전에 확정 → 이후 모든 step이 일요일 상태를 정확히 인식
  if (maleEmps.length > 0) {
    const prevTotal_A = {};
    maleEmps.forEach(e => {
      if (!prevSchData?.[e.id]) { prevTotal_A[e.id] = 0; return; }
      prevTotal_A[e.id] = Object.entries(prevSchData[e.id])
        .filter(([ds, s]) => new Date(ds).getDay() === 0 && s === STATUS.WORK).length;
    });

    const sundays_A = weeks.flatMap(w => w.filter(d => !d.isPrev && d.dow === 6))
      .filter(d => !maleEmps.some(e =>
        sch[e.id][d.ds] === STATUS.MUST_OFF || sch[e.id][d.ds] === STATUS.UNPAID ||
        (seededDates.has(d.ds) && sch[e.id][d.ds] && sch[e.id][d.ds] !== "")
      ));

    const thisCnt_A = {};
    maleEmps.forEach(e => { thisCnt_A[e.id] = 0; });

    sundays_A.forEach(day => {
      const sorted = [...maleEmps].sort((a, b) => {
        const ta = prevTotal_A[a.id] + thisCnt_A[a.id];
        const tb = prevTotal_A[b.id] + thisCnt_A[b.id];
        if (ta !== tb) return ta - tb;
        const prev7ds = addDays(day.ds, -7);
        const aLast = (sch[a.id][prev7ds] || prevSchData?.[a.id]?.[prev7ds]) === STATUS.WORK;
        const bLast = (sch[b.id][prev7ds] || prevSchData?.[b.id]?.[prev7ds]) === STATUS.WORK;
        if (aLast !== bLast) return aLast ? 1 : -1;
        return 0;
      });
      const worker = sorted[0];
      maleEmps.forEach(e => {
        sch[e.id][day.ds] = e === worker ? STATUS.WORK : STATUS.OFF;
      });
      thisCnt_A[worker.id]++;
    });
  }



  // 현아 처리: 격주 1일/2일, 기준요일 수(dow=2) 고정 — 2일주는 반드시 수+목
  // 1일주: 수요일만 / 2일주: 수요일 + 목요일 (같은 요일 고정 패턴)
  // 격주 패턴 직원 처리 (현아 포함 altPattern=true인 전 직원)
  employees.filter(e => isAltPattern(e)).forEach(emp => {
    const weeklyOff = getWeeklyOff(emp);
    const lo = Math.max(1, weeklyOff - 1); // 적은 주 휴무
    const hi = weeklyOff;                   // 많은 주 휴무

    // 전달 마지막 주(브릿징 주) = isPrev 날짜가 있는 첫 주
    // 이 주는 전달 배치에서 이미 확정된 값 → 배정 스킵, already만 읽어서 다음 주 target 결정
    // 이후 주는 브릿징 주의 already 기반으로 lo/hi 교대
    let prevActualOff = null; // 브릿징 주 실제 휴무 수

    weeks.forEach((week, wi) => {
      const thisMonthDays = week.filter(d => !d.isPrev);
      if (thisMonthDays.length === 0) return;
      if (thisMonthDays.filter(d => !d.isNext).length <= 1) return;

      const hasPrev = week.some(d => d.isPrev);

      // 브릿징 주: 배정 스킵, 전달 마지막 주(월~일) 전체 휴무 수 기록
      // weeks의 isPrev는 firstDow일 수만큼만 포함 → 나머지 전달 날짜도 prevSchData에서 직접 읽음
      if (hasPrev) {
        const prevYear_ = month === 0 ? year-1 : year;
        const prevMonth_ = month === 0 ? 11 : month-1;
        const prevLastDay_ = new Date(year, month, 0).getDate();
        // 브릿징 주의 월요일 찾기 (weeks 첫 날 = firstDow일 전부터)
        const bridgeMon = week[0]; // isPrev 첫 날 (항상 월요일 or 그 이후)
        // 브릿징 주 전체(월~weeks의 마지막 날)에서 휴무 수 계산
        let bridgeOff = 0;
        // 1) weeks에 포함된 날짜
        week.forEach(d => {
          const s = d.isPrev
            ? (prevSchData?.[emp.id]?.[d.ds] || "")
            : (sch[emp.id]?.[d.ds] || "");
          if (["휴무","휴무(꼭)","무급"].includes(s)) bridgeOff++;
        });
        // 2) weeks에 없는 전달 날짜 (브릿징 주 월요일 이전 부분)
        // bridgeMon.ds 이전으로 같은 주의 월요일까지 스캔
        const bridgeMonDow = bridgeMon.dow; // 브릿징 주 첫 isPrev날의 요일
        for (let back = 1; back <= bridgeMonDow; back++) {
          const scanDate = new Date(bridgeMon.ds);
          scanDate.setDate(scanDate.getDate() - back);
          const scanDs = fmtDs(scanDate.getFullYear(), scanDate.getMonth(), scanDate.getDate());
          const s = prevSchData?.[emp.id]?.[scanDs] || "";
          if (["휴무","휴무(꼭)","무급"].includes(s)) bridgeOff++;
        }
        prevActualOff = bridgeOff;
        return; // 배정 없이 종료
      }

      // 일반 주: 브릿징 주 기반으로 target 결정
      let target;
      if (prevActualOff === null) {
        // 브릿징 주 없음(1일이 월요일): lo부터 시작
        target = (wi % 2 === 0) ? lo : hi;
      } else {
        // 브릿징 주가 lo면 → 이번 주 hi, hi면 → 이번 주 lo / 이후는 교대
        const bridgeWasLo = prevActualOff <= lo;
        const stepsFromBridge = weeks.filter((w, i) => i < wi && !w.some(d => d.isPrev)).length;
        target = (stepsFromBridge % 2 === 0)
          ? (bridgeWasLo ? hi : lo)
          : (bridgeWasLo ? lo : hi);
      }

      const already = alreadyOffCount(emp.id, week);
      let needed = Math.max(0, target - already);
      if (needed <= 0) return;

      // 격주 직원 배정: prefDows 설정 시 해당 요일 우선, 막히면 전체 요일 fallback
      const altCanPlace = (d) => !sch[emp.id][d.ds] && !seededDates.has(d.ds);
      const prefDows_ = empSettings[emp.id]?.prefDows || [];
      const branchEmps = employees.filter(e=>(e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));
      const branch = BRANCHES.find(b=>b.id===emp.branch);

      // 1차 시도: prefDows 요일만
      const prefCands = prefDows_.length > 0
        ? [...prefDows_.flatMap(dow => thisMonthDays.filter(d => d.dow === dow && altCanPlace(d)))]
        : thisMonthDays.filter(d => altCanPlace(d));
      for (const d of prefCands) {
        if (needed <= 0) break;
        if (!canAssignOff(emp, d, branchEmps, branch, false, true)) continue;
        sch[emp.id][d.ds] = STATUS.OFF;
        needed--;
      }
      // 2차 시도: prefDows로 부족하면 전체 요일 fallback
      if (needed > 0 && prefDows_.length > 0) {
        const fallbackCands = thisMonthDays.filter(d => !prefDows_.includes(d.dow) && altCanPlace(d));
        for (const d of fallbackCands) {
          if (needed <= 0) break;
          if (!canAssignOff(emp, d, branchEmps, branch, false, true)) continue;
          sch[emp.id][d.ds] = STATUS.OFF;
          needed--;
        }
      }
    });
  });



  // 2.5) 미배정 날 전부 WORK로 pre-fill
  //      → getCarry가 정확히 동작하게 됨
  employees.forEach(emp => {
    allDates.forEach(day => {
      if (emp.isMale && day.dow === 6) return;
      if (!sch[emp.id][day.ds]) sch[emp.id][day.ds] = STATUS.WORK;
    });
  });

  // 나머지 직원: 새 carry-aware 알고리즘
  // ────────────────────────────────────────────────────────────────────────────
  // [Phase A] 전체 직원의 강제 휴무 후보를 동시에 계산 (WORK run 분해)
  //           maxConsecWork 초과 블록을 끊는 최소 휴무 위치 목록 생성
  // [Phase B] 충돌(같은 날 너무 많이 쉼) 해소 → ±1~2일 이동
  // [Phase C] 강제 휴무 실제 배정
  // [Phase D] 주간 쿼터 채우기 (streak 높은 날 우선)
  // ────────────────────────────────────────────────────────────────────────────

  const allDsOrdered = allDates
    .filter(d => !d.isPrev && !d.isNext)
    .map(d => d.ds)
    .sort();

  // [Phase A] 직원별 강제 휴무 위치 계산
  const forcedOff = {}; // { empId: Set<ds> }

  // 직원 처리 순서를 랜덤화 → 같은 날 충돌 시 매번 다른 직원이 양보
  const shuffledEmps = shuffle(employees.filter(e => !isAltPattern(e) && !e.isMale && !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)));
  shuffledEmps.forEach(emp => {
    forcedOff[emp.id] = new Set();
    let streak = getCarry(emp.id, allDsOrdered[0]);

    for (const ds of allDsOrdered) {
      if (seededDates.has(ds)) {
        const s = sch[emp.id]?.[ds] ?? "";
        streak = (s === "휴무" || s === "휴무(꼭)" || s === "무급") ? 0 : streak + 1;
        continue;
      }
      const s = sch[emp.id]?.[ds] ?? STATUS.WORK;
      if (s === "휴무" || s === "휴무(꼭)" || s === "무급") { streak = 0; continue; }
      streak++;
      if (streak >= rc.maxConsecWork) {
        // maxConsecWork 도달 시 ±1일 범위에서 랜덤으로 강제 휴무 날 선택
        // ±1일 후보 중 forcedOff 예정이 적은 날 우선 선택 (maxDailyOff 초과 방지)
        const candidates = [];
        for (const cds of [addDays(ds,-1), ds, addDays(ds,1)]) {
          if (!allDsOrdered.includes(cds)) continue;
          if (seededDates.has(cds)) continue;
          if (forcedOff[emp.id]?.has(cds)) continue;
          candidates.push(cds);
        }
        if (candidates.length === 0) { streak = 0; continue; }
        // forcedOff 수가 적은 날 + 랜덤으로 선택
        candidates.sort((a, b) => {
          const fa = Object.values(forcedOff).filter(s => s.has(a)).length;
          const fb = Object.values(forcedOff).filter(s => s.has(b)).length;
          if (fa !== fb) return fa - fb;
          return rng() - 0.5;
        });
        // maxDailyOff 미만인 후보만 허용
        const validCands = candidates.filter(cds => {
          const alreadyOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[cds]||"")).length;
          const plannedOff = Object.values(forcedOff).filter(s => s.has(cds)).length;
          return alreadyOff + plannedOff < rc.maxDailyOff;
        });
        const picked = validCands.length > 0 ? validCands[0] : candidates[0];
        forcedOff[emp.id].add(picked);
        streak = 0;
      }
    }
  });

  // [Phase B] 충돌 해소: 같은 날 너무 많은 강제 휴무 → 일부를 ±1~3일 이동
  // 각 날짜의 예정 강제 휴무 수 집계
  const dayForcedCount = {};
  employees.filter(e => !isAltPattern(e) && !e.isMale && !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)).forEach(emp => {
    (forcedOff[emp.id]||new Set()).forEach(ds => {
      dayForcedCount[ds] = (dayForcedCount[ds] || 0) + 1;
    });
  });

  // maxDailyOff 초과 날 → 일부 이동
  const maxAllowed = rc.maxDailyOff; // 강제 배정도 maxDailyOff 준수
  Object.entries(dayForcedCount).sort().forEach(([ds, cnt]) => {
    if (cnt <= maxAllowed) return;
    // 이 날 강제 휴무 예정 직원들 중 일부를 ±1~3일 이동
    const empsList = employees.filter(e =>
      !isAltPattern(e) && !e.isMale && forcedOff[e.id]?.has(ds)
    );
    let overCount = cnt - maxAllowed;
    // 원장 제외 + streak 짧은 직원부터 이동
    const sorted = [...empsList]
      .filter(e => !e.isOwner)  // 원장은 절대 밀어내지 않음
      .sort((a, b) => getCarry(a.id, ds) - getCarry(b.id, ds));
    for (const emp of sorted) {
      if (overCount <= 0) break;
      let moved = false;
      for (let delta = 1; delta <= 4 && !moved; delta++) {
        for (const sign of [1, -1]) {
          const d2 = new Date(ds); d2.setDate(d2.getDate() + delta * sign);
          const ds2 = fmtDs(d2.getFullYear(), d2.getMonth(), d2.getDate());
          if (!allDsOrdered.includes(ds2)) continue;
          if (seededDates.has(ds2)) continue;
          if (forcedOff[emp.id]?.has(ds2)) continue;
          if ((dayForcedCount[ds2] || 0) + 1 > maxAllowed) continue;
          // 이동 후 ds2 날 minWork 체크 (기존 off + 예정 forcedOff 모두 반영)
          const alreadyOffOnDs2 = employees.filter(e =>
            !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[ds2] ?? "")
          ).length;
          const forcedOnDs2 = (dayForcedCount[ds2] || 0) + 1; // +1 = 이 직원도 이동
          const totalFemale = employees.filter(e => !e.isMale).length;
          const wkAfterMove = totalFemale - alreadyOffOnDs2 - forcedOnDs2;
          if (wkAfterMove < rc.minWork) continue;
          forcedOff[emp.id].delete(ds);
          forcedOff[emp.id].add(ds2);
          dayForcedCount[ds]--;
          dayForcedCount[ds2] = (dayForcedCount[ds2] || 0) + 1;
          overCount--;
          moved = true;
          break;
        }
      }
    }
  });

  // [Phase C] 강제 휴무 실제 배정
  (employees||[]).filter(e => !isAltPattern(e) && !e.isMale && !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)).forEach(emp => {
    const branch = BRANCHES.find(b => b.id === emp.branch);
    const branchEmps = employees.filter(e => (e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));
    (forcedOff[emp.id] || new Set()).forEach(ds => {
      if (seededDates.has(ds)) return;
      const day = allDates.find(d => d.ds === ds);
      if (!day) return;
      // 이미 off인 경우 스킵
      if (sch[emp.id]?.[ds] === STATUS.OFF || sch[emp.id]?.[ds] === "휴무(꼭)" || sch[emp.id]?.[ds] === "무급") return;
      // 실제 배정 가능 여부 (minStaff + maxDailyOff + 3일연속 체크)
      if (canAssignOffHard(emp, day, branchEmps, branch)) {
        sch[emp.id][ds] = STATUS.OFF;
      } else {
        // fallback: ±1~5일 탐색
        let fixed = false;
        for (let delta = 1; delta <= 5 && !fixed; delta++) {
          for (const sign of [1, -1]) {
            const d2 = new Date(ds); d2.setDate(d2.getDate() + delta * sign);
            const ds2 = fmtDs(d2.getFullYear(), d2.getMonth(), d2.getDate());
            const day2 = allDates.find(d => d.ds === ds2);
            if (!day2 || seededDates.has(ds2)) continue;
            if (sch[emp.id][ds2] !== STATUS.WORK) continue;
            if (canAssignOffHard(emp, day2, branchEmps, branch)) {
              sch[emp.id][ds2] = STATUS.OFF;
              fixed = true;
              break;
            }
          }
        }
      }
    });
  });

  // [Phase D] 주간 쿼터 채우기 — 순수 주 단위, 월간 총량 개념 없음 (원장 제외)
  shuffle(employees.filter(e => !isAltPattern(e) && !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer))).forEach(emp => {
    const branch = BRANCHES.find(b => b.id === emp.branch);
    const branchEmps = employees.filter(e => (e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));

    activeWeeks.forEach((week, wi) => {
      const thisWeekDays = week.filter(d => !d.isPrev);
      const realDays = thisWeekDays.filter(d => !d.isNext);
      if (realDays.length <= 1 && wi < activeWeeks.length - 1) return;

      const weekOffNow = thisWeekDays.filter(d =>
        (emp.isMale || !d.isNext) && ["휴무","휴무(꼭)","무급"].includes(sch[emp.id]?.[d.ds])
      ).length;
      const weekTarget = getWeeklyOff(emp);
      let toAssign = Math.max(0, weekTarget - weekOffNow);
      if (toAssign <= 0) return;

      const empOffset = emp.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const rotBase = (wi * 3 + empOffset) % 7;

      const quotaCands = thisWeekDays
        .filter(d => !ignoredDates.has(d.ds) && !seededDates.has(d.ds)
          && sch[emp.id][d.ds] === STATUS.WORK
          && !(emp.isMale && d.dow === 6))
        .sort((a, b) => {
          // 1) 동료 휴무 적은 날 우선 (동시휴무 분산)
          const aOff = branchEmps.filter(be => be.id !== emp.id && ["휴무","휴무(꼭)","무급"].includes(sch[be.id]?.[a.ds]||"")).length;
          const bOff = branchEmps.filter(be => be.id !== emp.id && ["휴무","휴무(꼭)","무급"].includes(sch[be.id]?.[b.ds]||"")).length;
          if (aOff !== bOff) return aOff - bOff;

          // 2) rotBase 요일 로테이션 (직원별 다양성)
          const dowA = ((a.dow - rotBase + 7) % 7);
          const dowB = ((b.dow - rotBase + 7) % 7);
          if (dowA !== dowB) return dowA - dowB;

          // 3) streak가 maxConsecWork-1 이상인 날만 우선
          const aRun = getCarry(emp.id, a.ds);
          const bRun = getCarry(emp.id, b.ds);
          const aUrgent = aRun >= rc.maxConsecWork - 1 ? 0 : 1;
          const bUrgent = bRun >= rc.maxConsecWork - 1 ? 0 : 1;
          if (aUrgent !== bUrgent) return aUrgent - bUrgent;

          // 4) 랜덤
          return rng() - 0.5;
        });

      const prevPatterns = activeWeeks.slice(0, wi).map(pw =>
        pw.filter(d => !d.isPrev && ["휴무","휴무(꼭)","무급"].includes(sch[emp.id][d.ds])).map(d => d.dow).sort().join(",")
      ).filter(p => p.length > 0);

      for (const day of quotaCands) {
        if (toAssign <= 0) break;
        if (emp.isMale ? !canMaleOff(emp, day, branchEmps, branch) : !canAssignOff(emp, day, branchEmps, branch)) continue;
        if (prevPatterns.length >= 2 && toAssign === 1) {
          const alreadyDows = thisWeekDays.filter(d => d.ds !== day.ds && ["휴무","휴무(꼭)","무급"].includes(sch[emp.id][d.ds])).map(d => d.dow);
          const proj = [...alreadyDows, day.dow].sort().join(",");
          const last2 = prevPatterns.slice(-2);
          if (last2[0] === proj && last2[1] === proj) continue;
        }
        sch[emp.id][day.ds] = STATUS.OFF;
        toAssign--;
      }

      // Phase D 보완: canAssignOff 통과 못해서 부족한 쿼터는 canAssignOffHard로 강제 채움
      if (toAssign > 0) {
        const hardCands = thisWeekDays
          .filter(d => !ignoredDates.has(d.ds) && !seededDates.has(d.ds)
            && sch[emp.id]?.[d.ds] === STATUS.WORK
            && !(emp.isMale && d.dow === 6))
          .sort((a, b) => getCarry(emp.id, b.ds) - getCarry(emp.id, a.ds));
        for (const day of hardCands) {
          if (toAssign <= 0) break;
          if (!canAssignOffHard(emp, day, branchEmps, branch)) continue;
          sch[emp.id][day.ds] = STATUS.OFF;
          toAssign--;
        }
      }
    });
  });

  // ignoredDates는 어떤 단계에서도 값이 없어야 함 (step1에서 ownerReqs가 먼저 들어갈 수 있으므로 클리어)
  employees.forEach(emp => {
    ignoredDates.forEach(ds => { delete sch[emp.id][ds]; });
  });

  // 3) 미배정 → 근무 (pre-fill 이후엔 사실상 불필요, 안전을 위해 유지)
  employees.forEach(emp => {
    allDates.forEach(day => {
      if (emp.isMale && day.dow === 6) return;
      if (!sch[emp.id][day.ds]) sch[emp.id][day.ds] = STATUS.WORK;
    });
  });

  // 4) 지원 배정: 모든 지점 순회하여 minStaff 미달 시 지원 배정
  // 우선순위: ① 같은 branches 그룹 내 다른 지점 직원 (내부 로테이션)
  //           ② supportOrder 지정 외부 지점 직원
  //           ③ 나머지 지점 직원
  const supportOrderRaw = supportConfig.order || {};

  for (const _day4 of allDates) {
    const ds = _day4.ds;
    const dayIdx = allDates.indexOf(_day4);

    for (const targetBranch of BRANCHES) {
      if (targetBranch.id === "male") continue;
      const supportLabel = `지원(${targetBranch.name})`;
      const minS = rc.branchMinStaff[targetBranch.id] ?? targetBranch.minStaff ?? 1;
      // 지점별 supportOrder: 객체면 해당 지점 배열, 배열이면 공통 적용
      const supportOrder = Array.isArray(supportOrderRaw)
        ? supportOrderRaw
        : (Array.isArray(supportOrderRaw[targetBranch.id]) ? supportOrderRaw[targetBranch.id] : []);

      // 현재 이 지점 근무 인원 계산
      // 대표지점(branch)이 targetBranch인 직원: 근무/전체쉐어면 포함 (타지점 지원 나간 경우 제외)
      // 대표지점이 다른 내부 그룹 직원: 지원(targetBranch.name) 상태일 때만 포함
      // 외부 지점 직원: 지원(targetBranch.name) 상태일 때만 포함
      const targetEmps_ = employees.filter(e => (e.branches||[e.branch]).includes(targetBranch.id));
      const baseWorking = targetEmps_.filter(e => {
        const s = sch[e.id][ds];
        if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
        // 대표지점이 targetBranch인 직원만 근무로 카운트
        if (e.branch === targetBranch.id) {
          if (isSupport(s) && !s.includes(targetBranch.name)) return false; // 타지점 지원 나간 경우 제외
          return s === STATUS.WORK || s === supportLabel || s === STATUS.SHARE;
        }
        // 대표지점이 다른 내부 그룹 직원은 지원 상태일 때만 카운트
        return s === supportLabel;
      }).length;
      const supportersIn = employees.filter(e =>
        !(e.branches||[e.branch]).includes(targetBranch.id) && sch[e.id][ds] === supportLabel
      ).length;
      const totalWorking = baseWorking + supportersIn;
      if (totalWorking >= minS) continue;

      const needed = minS - totalWorking;
      const candidates = [];

      // ① 같은 branches 그룹 내 다른 지점 소속 직원 (내부 로테이션 우선)
      const internalCands = employees.filter(e =>
        !e.mustStay &&
        (e.branches||[e.branch]).includes(targetBranch.id) &&
        e.branch !== targetBranch.id && // 대표 지점이 다른 직원
        sch[e.id][ds] === STATUS.WORK
      );
      internalCands.sort((a, b) => {
        const ca = Object.values(sch[a.id]).filter(s => s === supportLabel).length;
        const cb = Object.values(sch[b.id]).filter(s => s === supportLabel).length;
        return ca !== cb ? ca - cb : (dayIdx % 2 === 0 ? 0 : -1);
      });
      candidates.push(...internalCands.map(e => e.id));

      // ② supportOrder 지정 외부 지점 직원
      for (const bId of supportOrder) {
        const extCands = employees.filter(e =>
          e.branch === bId && !e.mustStay &&
          !(e.branches||[e.branch]).includes(targetBranch.id) &&
          sch[e.id][ds] === STATUS.WORK
        );
        extCands.sort((a, b) => {
          const ca = Object.values(sch[a.id]).filter(s => s === supportLabel).length;
          const cb = Object.values(sch[b.id]).filter(s => s === supportLabel).length;
          return ca !== cb ? ca - cb : (dayIdx % 2 === 0 ? 0 : -1);
        });
        candidates.push(...extCands.map(e => e.id));
      }

      // ③ 나머지 지점 직원
      const prioritySet = new Set(supportOrder);
      const otherCands = employees.filter(e =>
        !(e.branches||[e.branch]).includes(targetBranch.id) &&
        !prioritySet.has(e.branch) && !e.mustStay &&
        sch[e.id][ds] === STATUS.WORK
      ).map(e => e.id);
      candidates.push(...otherCands);

      let assigned = 0;
      for (const eid of candidates) {
        if (assigned >= needed) break;
        if (sch[eid][ds] !== STATUS.WORK) continue;
        const sender = employees.find(e => e.id === eid);
        if (!sender) continue;
        // 지원자 본인 소속 지점들의 minStaff 보호
        let senderBranchOk = true;
        for (const senderBId of (sender.branches || [sender.branch])) {
          if (senderBId === "male") continue;
          if (senderBId === targetBranch.id) continue; // 지원 가는 지점은 체크 불필요
          const senderBr = BRANCHES.find(b => b.id === senderBId);
          if (!senderBr) continue;
          const senderMinS = rc.branchMinStaff[senderBId] ?? senderBr.minStaff ?? 1;
          const senderBrEmps = employees.filter(e => (e.branches||[e.branch]).includes(senderBId));
          const senderBrName = senderBr.name;
          const senderWorking = senderBrEmps.filter(e => {
            if (e.id === eid) return false; // 본인 빠진 후 계산
            const s = sch[e.id][ds];
            if (["휴무","휴무(꼭)","무급"].includes(s)) return false;
            // 대표지점이 senderBId인 직원만 기본 근무로 카운트
            if (e.branch === senderBId) {
              if (isSupport(s) && !s.includes(senderBrName)) return false;
              return s === STATUS.WORK || s === `지원(${senderBrName})` || s === STATUS.SHARE;
            }
            // 내부 그룹 직원은 지원(senderBrName) 상태일 때만
            return s === `지원(${senderBrName})`;
          }).length;
          const senderSupportIn = employees.filter(e =>
            !(e.branches||[e.branch]).includes(senderBId) &&
            sch[e.id][ds] === `지원(${senderBrName})`
          ).length;
          if (senderWorking + senderSupportIn < senderMinS) {
            senderBranchOk = false;
            break;
          }
        }
        if (!senderBranchOk) continue;
        sch[eid][ds] = supportLabel;
        assigned++;
      }
    }
  }

  // 5) 최소 10명 미달 날짜 보정: "휴무(꼭)" 아닌 휴무를 근무로 전환
  //    단, 해당 직원의 주 weeklyOff 보장을 침해하지 않음 (실제 주 경계 기준)
  for (let pass = 0; pass < 10; pass++) {
    let fixed = false;
    for (const _day5 of allDates) {
      const ds = _day5.ds;
      const workCount = employees.filter(e => {
        if (e.isMale) return false;
        if (e.isFreelancer) return false;
        const s = sch[e.id][ds];
        return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE;
      }).length;
      if (workCount >= rc.minWork) continue;

      const needed = rc.minWork - workCount;
      const wkIdx = getWeekIdx(ds);

      // 이 날 일반휴무인 직원만 대상 (휴무(꼭) 제외, 남자직원 제외, 원장 제외, seeded 보호)
      const candidates = employees.filter(e => !e.isOwner && !e.isMale && !(e.isFreelancer || empSettings[e.id]?.isFreelancer) && sch[e.id][ds] === STATUS.OFF && !seededDates.has(ds))
        .sort((a, b) => {
          // 같은 주에 더 많이 쉰 직원 우선 (여유분 있음)
          const count = (emp) => Object.entries(sch[emp.id])
            .filter(([s_ds, s]) => getWeekIdx(s_ds) === wkIdx && (s===STATUS.OFF||s==="휴무(꼭)"||s==="무급")).length;
          return count(b) - count(a);
        });

      let converted = 0;
      for (const emp of candidates) {
        if (converted >= needed) break;
        // 이 주에 weeklyOff 보다 많이 쉬고 있을 때만 한 개 빼는 것 허용
        const weekOffNow = Object.entries(sch[emp.id])
          .filter(([s_ds, s]) => getWeekIdx(s_ds) === wkIdx && (s===STATUS.OFF||s==="휴무(꼭)"||s==="무급")).length;
        if (weekOffNow <= getWeeklyOff(emp)) continue; // 딱 맞거나 부족하면 절대 건드리지 않음

        sch[emp.id][ds] = STATUS.WORK;
        converted++;
        fixed = true;
      }
    }
    if (!fixed) break;
  }

  // 6) 주간 휴무 미달 보정 + 퐁당퐁당(휴무-근무-휴무-근무) 패턴 방지
  employees.filter(e => !isAltPattern(e) && !e.isOwner && !e.isMale && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)).forEach(emp => {
    const branch = BRANCHES.find(b => b.id === emp.branch);
    const branchEmps = employees.filter(e => (e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));

    // 퐁당퐁당 감지: canAssignOff와 동일 로직 (p2=휴/p1=근 or n1=근/n2=휴)
    const wouldMakeAltPattern = (ds) => {
      const isOff_ = (s) => ["휴무","휴무(꼭)","무급"].includes(s);
      const getS_ = (d) => sch[emp.id]?.[d] ?? prevSchData?.[emp.id]?.[d] ?? "";
      const p1ds = addDays(ds, -1), p2ds_ = addDays(ds, -2);
      const n1ds = addDays(ds, 1), n2ds = addDays(ds, 2);
      const p1o = isOff_(getS_(p1ds));
      const p2o = isOff_(getS_(p2ds_));
      const n1o = isOff_(getS_(n1ds));
      const n2o = isOff_(getS_(n2ds));
      const n1Assigned = getS_(n1ds) !== "";
      const n2Assigned = getS_(n2ds) !== "";
      if (p2o && !p1o) return true;                                          // 휴-근-[휴]
      if (n1Assigned && !n1o && n2o) return true;                            // [휴]-근-휴
      if (!p1o && n1Assigned && !n1o && n2Assigned && n2o) return true;      // 근-[휴]-근-휴
      if (!p1o && !p2o && n1Assigned && !n1o && n2Assigned && n2o) return true; // 근근-[휴]-근-휴
      return false;
    };

    activeWeeks.forEach(week => {
      const thisMonthDays = week.filter(d => !d.isPrev);
      if (thisMonthDays.length === 0) return;

      const weekOffNow = () => thisMonthDays.filter(d => ["휴무","휴무(꼭)","무급"].includes(sch[emp.id][d.ds])).length;
      const deficit = () => getWeeklyOff(emp) - weekOffNow();
      if (deficit() <= 0) return;

      const cands = thisMonthDays
        .filter(d => sch[emp.id][d.ds] === STATUS.WORK && !seededDates.has(d.ds)
          && !(emp.isMale && d.dow === 6))
        .sort((a, b) => {
          if (!!a.isNext !== !!b.isNext) return (a.isNext ? 1 : 0) - (b.isNext ? 1 : 0);
          const aOff = branchEmps.filter(be=>be.id!==emp.id&&["휴무","휴무(꼭)","무급"].includes(sch[be.id][a.ds])).length;
          const bOff = branchEmps.filter(be=>be.id!==emp.id&&["휴무","휴무(꼭)","무급"].includes(sch[be.id][b.ds])).length;
          return aOff - bOff;
        });

      for (const day of cands) {
        if (deficit() <= 0) break;
        if (!canAssignOff(emp, day, branchEmps, branch)) continue;
        if (wouldMakeAltPattern(day.ds)) continue; // 퐁당퐁당 패턴 방지
        const totalWorking = employees.filter(e => {
          const s = sch[e.id][day.ds];
          return s===STATUS.WORK||isSupport(s)||s===STATUS.SHARE;
        }).length;
        if (totalWorking <= rc.minWork) continue;
        // branches 기반 지점 최소인원 체크
        let branchOk = true;
        for (const bId of (emp.branches||[emp.branch])) {
          const br_ = BRANCHES.find(b=>b.id===bId); if (!br_) continue;
          const brW = employees.filter(e=>(e.branches||[e.branch]).includes(bId)&&!e.isMale).filter(be=>{
            if (be.id===emp.id) return false;
            const s=sch[be.id]?.[day.ds]||"";
            if(["휴무","휴무(꼭)","무급"].includes(s)) return false;
            if(isSupport(s)&&!s.includes(br_.name)) return false;
            return true;
          }).length;
          const supIn=employees.filter(e=>!(e.branches||[e.branch]).includes(bId)&&sch[e.id]?.[day.ds]===`지원(${br_.name})`).length;
          if(brW+supIn < (rc.branchMinStaff[bId]??br_.minStaff??1)){branchOk=false;break;}
        }
        if (!branchOk) continue;
        sch[emp.id][day.ds] = STATUS.OFF;
      }
    });
  });


  // 7) 하루 최대 휴무 5명 초과 보정: 초과분 직원의 휴무를 근무로 전환
  for (let pass = 0; pass < 10; pass++) {
    let fixed = false;
    for (const _day7 of allDates) {
      const ds = _day7.ds;
      const offEmps = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id][ds])); // 남자직원 별도
      if (offEmps.length <= rc.maxDailyOff) continue;

      // 초과분만 근무 전환 — 휴무(꼭)/seededDates/원장 제외, 주간 weeklyOff 초과분 우선 취소
      const cancelCands = offEmps
        .filter(e => sch[e.id][ds] === STATUS.OFF && !seededDates.has(ds) && !e.isOwner) // 휴무(꼭)/보호날짜/원장 제외
        .sort((a, b) => {
          // 이 주에 weeklyOff 초과로 쉬는 직원 우선 (여유 있음)
          const wkIdx = getWeekIdx(ds);
          const aWk = Object.entries(sch[a.id]).filter(([s,v])=>getWeekIdx(s)===wkIdx&&["휴무","휴무(꼭)","무급"].includes(v)).length;
          const bWk = Object.entries(sch[b.id]).filter(([s,v])=>getWeekIdx(s)===wkIdx&&["휴무","휴무(꼭)","무급"].includes(v)).length;
          return bWk - aWk;
        });

      const excess = offEmps.length - rc.maxDailyOff;
      let converted = 0;
      for (const emp of cancelCands) {
        if (converted >= excess) break;
        // 주간 최소 weeklyOff 보호
        const wkIdx = getWeekIdx(ds);
        const wkOff = Object.entries(sch[emp.id]).filter(([s,v])=>getWeekIdx(s)===wkIdx&&["휴무","휴무(꼭)","무급"].includes(v)).length;
        if (wkOff <= getWeeklyOff(emp)) continue;
        sch[emp.id][ds] = STATUS.WORK;
        converted++;
        fixed = true;
      }
    }
    if (!fixed) break;
  }

  // 8+9 공통 헬퍼: 블록 밖에 선언 (step 9에서도 사용)
  const isWork_ = (empId, ds) => {
    const s = sch[empId]?.[ds];
    if (!s || s === "") return false;
    return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE;
  };
  const streakLen = (empId, ds) => {
    if (!isWork_(empId, ds)) return 0;
    let start = ds;
    for (let i = 1; i <= 40; i++) {
      const pd = addDays(ds, -i);
      if (isWork_(empId, pd)) start = pd; else break;
    }
    let len = 0;
    for (let i = 0; i <= 40; i++) {
      if (isWork_(empId, addDays(start, i))) len++; else break;
    }
    return len;
  };

  // 8) 연속 근무 초과 해소 swap: 초과 직원 ↔ 같은 지점 우선, 없으면 타지점까지 확대
  {

    // 직원의 현재 스케줄에 초과 블록이 하나라도 있는지
    const hasExceed = (empId) =>
      allDates.filter(d => !d.isPrev && !d.isNext)
        .some(d => streakLen(empId, d.ds) > rc.maxConsecWork);

    // swap 전용 완화 검증: 3일 연속 휴무만 차단 (퐁당퐁당 허용)
    const canSwapOff = (empId, ds) => {
      const isO = (s) => s === "휴무" || s === "휴무(꼭)" || s === "무급";
      const p1 = sch[empId]?.[addDays(ds,-1)] || "";
      const p2 = sch[empId]?.[addDays(ds,-2)] || "";
      const n1 = sch[empId]?.[addDays(ds, 1)] || "";
      if (isO(p1) && isO(p2)) return false;
      if (isO(p1) && isO(n1)) return false;
      return true;
    };

    // 남자직원 일요일 규칙 검증: 일요일엔 정확히 1명만 근무해야 함
    const isSunday_ = (dateStr) => (new Date(dateStr).getDay()) === 0; // 0=일요일
    const maleSundayOk = (dateStr) => {
      if (!isSunday_(dateStr)) return true; // 일요일 아닌 날은 무관
      const working = employees.filter(e => e.isMale && isWork_(e.id, dateStr)).length;
      return working === 1;
    };

    const scanDates = allDates.filter(d => !d.isPrev && !d.isNext);

    for (let round = 0; round < 30; round++) {
      let swapped = false;

      for (const emp of employees) {
        if (!hasExceed(emp.id)) continue;

        for (const day of scanDates) {
          const ds = day.ds;
          if (!isWork_(emp.id, ds)) continue;
          if (seededDates.has(ds)) continue;
          if (streakLen(emp.id, ds) <= rc.maxConsecWork) continue;

          // swap 후보: 같은 지점 우선, 없으면 타지점까지 확대 (날짜만 교환, 지점 이동 없음)
          const sameBranchColleagues = employees.filter(c =>
            c.id !== emp.id && !c.mustStay && sch[c.id]?.[ds] === STATUS.OFF
          ).filter(c => c.branch === emp.branch);
          const otherBranchColleagues = employees.filter(c =>
            c.id !== emp.id && !c.mustStay && sch[c.id]?.[ds] === STATUS.OFF
          ).filter(c => c.branch !== emp.branch);
          // 같은 지점 먼저, 타지점은 후순위
          const colleagues = [...sameBranchColleagues, ...otherBranchColleagues];

          // 지점 최소인원 검증: 해당 날짜에 지점 근무인원이 minStaff 이상인지
          const branchMinOk = (empId, dateStr, newStatus) => {
            const emp_ = employees.find(e => e.id === empId);
            if (!emp_) return true;
            const br = BRANCHES.find(b => b.id === emp_.branch);
            if (!br) return true;
            const minS = rc.branchMinStaff[br.id] ?? br.minStaff ?? 1;
            // 해당 날 지점 근무 인원 (임시 변경 반영)
            const working = employees.filter(e => e.branch === br.id).filter(e => {
              const s = e.id === empId ? newStatus : (sch[e.id]?.[dateStr] || '');
              return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE;
            }).length;
            return working >= minS;
          };

          // emp의 교환 가능 휴무날 목록
          const empOffDays = scanDates.filter(od =>
            sch[emp.id]?.[od.ds] === STATUS.OFF && !seededDates.has(od.ds)
            && !(emp.isMale && od.dow === 6)
          );

          let didSwap = false;
          for (const col of colleagues) {
            const sortedOff = [...empOffDays].sort((a, b) =>
              streakLen(col.id, b.ds) - streakLen(col.id, a.ds)
            );

            for (const offDay of sortedOff) {
              if (!isWork_(col.id, offDay.ds)) continue;
              if (seededDates.has(offDay.ds)) continue;
              if (sch[col.id]?.[offDay.ds] === STATUS.MUST_OFF || sch[col.id]?.[offDay.ds] === STATUS.UNPAID) continue;

              // 4개 셀 저장 후 임시 교환
              const sv = [sch[emp.id][ds], sch[emp.id][offDay.ds], sch[col.id][ds], sch[col.id][offDay.ds]];
              sch[emp.id][ds]        = STATUS.OFF;
              sch[emp.id][offDay.ds] = STATUS.WORK;
              sch[col.id][ds]        = STATUS.WORK;
              sch[col.id][offDay.ds] = STATUS.OFF;

              // 검증: 연속근무 해소 + 3일연속휴무 없음 + 지점최소인원 + mustStay + 일요일남자 + noSimultaneousOff
              const empOk   = canSwapOff(emp.id, ds);
              const colOk   = canSwapOff(col.id, offDay.ds);
              const empFix  = streakLen(emp.id, ds) <= rc.maxConsecWork;
              const colSafe = streakLen(col.id, ds) <= rc.maxConsecWork;
              const empBrOk = branchMinOk(emp.id, ds, STATUS.OFF);
              const colBrOk = branchMinOk(col.id, offDay.ds, STATUS.OFF);
              // noSimultaneousOff: 스왑 후 상태에서 그룹 위반 여부 체크
              const simulOk = rc.noSimultaneousOff.every(group => {
                // emp가 ds에 OFF 되는 경우
                if (group.ids.includes(emp.id)) {
                  const othersOff = group.ids.filter(id => id !== emp.id)
                    .filter(id => ["휴무","휴무(꼭)","무급"].includes(sch[id]?.[ds])).length;
                  if (othersOff >= group.max) return false;
                }
                // col이 offDay에 OFF 되는 경우
                if (group.ids.includes(col.id)) {
                  const othersOff = group.ids.filter(id => id !== col.id)
                    .filter(id => ["휴무","휴무(꼭)","무급"].includes(sch[id]?.[offDay.ds])).length;
                  if (othersOff >= group.max) return false;
                }
                return true;
              });

              // 격주 직원(altPattern) 주간 weeklyOff 초과 체크
              const altWeekOk = (() => {
                // emp가 offDay에 WORK로 바뀌어도 그 주 off가 min 이상인지는 step2에서 보장됨
                // col이 offDay에 OFF → 그 주 off 수 초과 여부만 체크
                if (isAltPattern(col)) {
                  const colWk = weeks.find(w => w.some(d => d.ds === offDay.ds));
                  if (colWk) {
                    const colWkOff = colWk.filter(d => !d.isPrev &&
                      ["휴무","휴무(꼭)","무급"].includes(sch[col.id]?.[d.ds])
                    ).length;
                    if (colWkOff > getWeeklyOff(col)) return false;
                  }
                }
                // emp가 ds에 OFF → 격주 직원이면 주간 초과 체크
                if (isAltPattern(emp)) {
                  const empWk = weeks.find(w => w.some(d => d.ds === ds));
                  if (empWk) {
                    const empWkOff = empWk.filter(d => !d.isPrev &&
                      ["휴무","휴무(꼭)","무급"].includes(sch[emp.id]?.[d.ds])
                    ).length;
                    if (empWkOff > getWeeklyOff(emp)) return false;
                  }
                }
                return true;
              })();

              if (empOk && colOk && empFix && colSafe && empBrOk && colBrOk && simulOk && altWeekOk &&
                  maleSundayOk(ds) && maleSundayOk(offDay.ds)) {
                swapped = true;
                didSwap = true;
                break;
              } else {
                // 롤백
                sch[emp.id][ds]        = sv[0];
                sch[emp.id][offDay.ds] = sv[1];
                sch[col.id][ds]        = sv[2];
                sch[col.id][offDay.ds] = sv[3];
              }
            }
            if (didSwap) break;
          }
          if (didSwap) break;
        }
      }
      if (!swapped) break;
    }
  }

  // 9) 주간 off 수 최종 정규화: step 5/7/8 이후 weeklyOff와 어긋난 주를 강제 교정
  //    2회 패스: 1패스(초과 줄이기) → 2패스(부족 채우기)
  //    대상: altPattern·원장 제외 전 직원 (원장은 weeklyOff:1이므로 별도 처리 없음)
  {
    const targetEmps = employees.filter(e => !isAltPattern(e) && !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer));

    // ── 패스 1: 초과 주 줄이기 (off > weeklyOff) ──
    // 휴무(꼭) 제외, 주간 초과분만 off→work (canAssignOff 무시, 단순 전환)
    targetEmps.forEach(emp => {
      const wo = getWeeklyOff(emp);
      activeWeeks.forEach(week => {
        const wkDays = week.filter(d => !d.isPrev);
        const offDaysInWk = wkDays.filter(d =>
          ["휴무","휴무(꼭)","무급"].includes(sch[emp.id]?.[d.ds])
        );
        const excess = offDaysInWk.length - wo;
        if (excess <= 0) return;

        // 일반 휴무만 취소 (휴무(꼭) 보호), seededDates 보호, 남자직원 일요일 보호
        // ⚠️ 취소 시 연속근무 초과(maxConsecWork)가 생기는 날은 취소 불가
        const wouldExceedConsec = (empId, ds) => {
          // ds를 근무로 바꿨을 때 연속근무가 maxConsecWork 초과하는지 체크
          const orig = sch[empId][ds];
          sch[empId][ds] = STATUS.WORK;
          const streak = streakLen(empId, ds);
          sch[empId][ds] = orig;
          return streak > rc.maxConsecWork;
        };
        const cancelCands = offDaysInWk
          .filter(d => sch[emp.id][d.ds] === STATUS.OFF && !seededDates.has(d.ds)
            && !(emp.isMale && d.dow === 6) // 남자직원 일요일은 STEP A 배정 보호
            && !wouldExceedConsec(emp.id, d.ds)) // 연속근무 초과 유발 시 취소 불가
          .sort((a, b) => {
            // isNext 이월 날짜 우선 취소 (이번달 보호)
            if (!!a.isNext !== !!b.isNext) return (a.isNext ? -1 : 1);
            // 전체 off 많은 날 우선 취소
            const aOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[a.ds])).length;
            const bOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[b.ds])).length;
            return bOff - aOff;
          });
        let removed = 0;
        for (const d of cancelCands) {
          if (removed >= excess) break;
          sch[emp.id][d.ds] = STATUS.WORK;
          removed++;
        }
      });
    });

    // ── 패스 2: 부족 주 채우기 (off < weeklyOff) ──
    // canAssignOff + minWork 검증 통과하는 날에만 off 추가
    targetEmps.forEach(emp => {
      const branch = BRANCHES.find(b => b.id === emp.branch);
      const branchEmps = employees.filter(e => (e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));
      const wo = getWeeklyOff(emp);
      const isAlt = isAltPattern(emp);
      const prefDows9 = isAlt ? (empSettings[emp.id]?.prefDows || []) : [];

      activeWeeks.forEach(week => {
        const wkDays = week.filter(d => !d.isPrev);
        const offNow = wkDays.filter(d =>
          ["휴무","휴무(꼭)","무급"].includes(sch[emp.id]?.[d.ds])
        ).length;
        const needed = wo - offNow;
        if (needed <= 0) return;

        const baseCands = wkDays
          .filter(d => sch[emp.id]?.[d.ds] === STATUS.WORK && !seededDates.has(d.ds)
            && !(emp.isMale && d.dow === 6))
          .sort((a, b) => {
            if (!!a.isNext !== !!b.isNext) return (a.isNext ? 1 : -1);
            const aOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[a.ds])).length;
            const bOff = employees.filter(e => !e.isMale && ["휴무","휴무(꼭)","무급"].includes(sch[e.id]?.[b.ds])).length;
            return aOff - bOff;
          });

        // 격주 직원: prefDows 우선 정렬
        const addCands = isAlt && prefDows9.length > 0
          ? [...baseCands.filter(d => prefDows9.includes(d.dow)),
             ...baseCands.filter(d => !prefDows9.includes(d.dow))]
          : baseCands;

        let added = 0;
        for (const day of addCands) {
          if (added >= needed) break;
          const skipAlt = isAlt;
          if (emp.isMale ? !canMaleOff(emp, day, branchEmps, branch) : !canAssignOff(emp, day, branchEmps, branch, false, skipAlt)) continue;
          const totalWorking = employees.filter(e => {
            if (e.isMale) return false;
            const s = sch[e.id][day.ds];
            return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE;
          }).length;
          if (totalWorking <= rc.minWork) continue;
          sch[emp.id][day.ds] = STATUS.OFF;
          added++;
        }
      });
    });
  }


  // 디버그: window.__debugDate 설정 시 해당 날짜 canAssignOff 원인 로깅
  if (typeof window !== 'undefined' && window.__debugDate) {
    const dd = window.__debugDate;
    console.log(`=== 디버그: ${dd} canAssignOff 차단 원인 ===`);
    employees.forEach(emp => {
      const be2 = employees.filter(e=>(e.branches||[e.branch]).some(b=>(emp.branches||[emp.branch]).includes(b)));
      const br2 = BRANCHES.find(b=>b.id===emp.branch);
      const fday = {ds:dd, dow:0, d:0};
      const ok = canAssignOff(emp, fday, be2, br2, true);
      if(ok) console.log(`[canOff OK] ${emp.id} ${dd}: 가능`);
    });
  }
  return sch;
}