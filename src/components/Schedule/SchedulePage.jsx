import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { T, SCH_BRANCH_MAP } from '../../lib/constants'
import { I } from '../common/I'
import { useScheduleData, useEmployees } from '../../lib/useData'
import { supabase } from '../../lib/supabase'
import autoAssign from './autoAssign'
import { validateSch, exportCSV as doExportCSV } from './scheduleUtils'
import { BRANCHES_SCH, BRANCH_LABEL, STATUS, S_COLOR, DNAMES, isSupport, getSColor, getDim, fmtDs, getDow0Mon, DB_KEYS, DEFAULT_CELL_TAGS } from './scheduleConstants'
import EditCellModal from './EditCellModal'
import BulkEditModal from './BulkEditModal'
import RuleConfigModal from './RuleConfigModal'
import EmpSettingsModal from './EmpSettingsModal'
import OwnerSettingsModal from './OwnerSettingsModal'
import SupportSettingsModal from './SupportSettingsModal'
import SnapshotModal from './SnapshotModal'
import DailyView from './DailyView'

const mkKey = (y, m) => `${y}-${String(m+1).padStart(2,'0')}`

export default function SchedulePage({ employees: propEmps }) {
  const { employees: hookEmployees, save: saveEmployees } = useEmployees()
  const baseEmployees = propEmps?.length ? propEmps : hookEmployees

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  // DB state
  const [schHistory, setSchHistory] = useState({})
  const { data:ownerReqs, setData:setOwnerReqs, save:saveOwnerReqs } = useScheduleData(DB_KEYS.ownerReqs, {})
  const { data:empReqs, setData:setEmpReqs, save:saveEmpReqs } = useScheduleData(DB_KEYS.empReqs, {})
  const { data:empReqsTs, setData:setEmpReqsTs } = useScheduleData(DB_KEYS.empReqsTs, {})
  const { data:ownerRepeat, setData:setOwnerRepeat, save:saveOwnerRepeat } = useScheduleData(DB_KEYS.ownerRepeat, {})
  const { data:ruleConfigData, save:saveRuleConfig } = useScheduleData(DB_KEYS.ruleConfig, null)
  const { data:supportOrderRaw, setData:setSupportOrder, save:saveSupportOrder } = useScheduleData(DB_KEYS.supportOrder, {})
  // per-branch 객체({지점:[외부지점들]}) 또는 legacy flat array 모두 지원
  const supportOrder = (supportOrderRaw && !Array.isArray(supportOrderRaw) && typeof supportOrderRaw === 'object')
    ? supportOrderRaw
    : (Array.isArray(supportOrderRaw) ? supportOrderRaw : {})
  const { data:maleRotation, save:saveMaleRotation } = useScheduleData(DB_KEYS.maleRotation, {})
  // customEmployees_v1 폐기됨 (2026-05-01) — employees_v1로 통합
  const { data:deletedEmpIdsArr, setData:setDeletedEmpIdsArr, save:saveDeletedEmpIds } = useScheduleData(DB_KEYS.deletedEmpIds, [])

  const deletedEmpIds = useMemo(() => new Set(deletedEmpIdsArr || []), [deletedEmpIdsArr])

  // ── 셀 태그 (쉐어/일출 등) ──
  const { data:cellTagDefsRaw, save:saveCellTagDefs } = useScheduleData(DB_KEYS.cellTagDefs, null)
  const cellTagDefs = Array.isArray(cellTagDefsRaw) && cellTagDefsRaw.length > 0 ? cellTagDefsRaw : DEFAULT_CELL_TAGS
  const { data:schTagsHistory, save:saveSchTagsHistory } = useScheduleData(DB_KEYS.schTagsHistory, {})

  // 셀 태그 조회: monthKey → empId → dateStr → [tagId,...]
  const getCellTags = (empId, ds) => {
    const mk = ds.slice(0,7)
    return (schTagsHistory?.[mk]?.[empId]?.[ds.slice(8)]) || []
  }

  // 셀 태그 추가/제거 (반복 옵션 포함)
  const setCellTag = async (empId, startDs, tagId, turnOn, repeat='none', repeatUntil='') => {
    const next = JSON.parse(JSON.stringify(schTagsHistory || {}))
    const applyOne = (ds) => {
      const mk = ds.slice(0,7); const dd = ds.slice(8)
      next[mk] = next[mk] || {}
      next[mk][empId] = next[mk][empId] || {}
      const arr = new Set(next[mk][empId][dd] || [])
      if (turnOn) arr.add(tagId); else arr.delete(tagId)
      if (arr.size === 0) delete next[mk][empId][dd]
      else next[mk][empId][dd] = Array.from(arr)
    }
    // 기준 날짜
    applyOne(startDs)
    // 반복 처리
    if (repeat !== 'none' && repeatUntil && repeatUntil >= startDs) {
      const start = new Date(startDs), end = new Date(repeatUntil)
      const cur = new Date(start)
      const stepMap = { daily: () => cur.setDate(cur.getDate()+1), weekly: () => cur.setDate(cur.getDate()+7), monthly: () => cur.setMonth(cur.getMonth()+1) }
      const step = stepMap[repeat]
      if (step) {
        while (true) {
          step()
          if (cur > end) break
          applyOne(fmtDs(cur.getFullYear(), cur.getMonth(), cur.getDate()))
        }
      }
    }
    await saveSchTagsHistory(next)
  }

  // 태그 정의 저장 (추가/삭제/수정)
  const saveCellTagDefsWrapped = (defs) => saveCellTagDefs(defs)
  const deleteCellTagDef = async (tagId) => {
    const newDefs = cellTagDefs.filter(t => t.id !== tagId)
    await saveCellTagDefs(newDefs)
    // 해당 태그가 달린 모든 셀에서도 제거
    const next = JSON.parse(JSON.stringify(schTagsHistory || {}))
    let changed = false
    Object.keys(next).forEach(mk => Object.keys(next[mk] || {}).forEach(emp => Object.keys(next[mk][emp] || {}).forEach(dd => {
      const filtered = (next[mk][emp][dd] || []).filter(id => id !== tagId)
      if (filtered.length !== (next[mk][emp][dd] || []).length) { changed = true
        if (filtered.length === 0) delete next[mk][emp][dd]
        else next[mk][emp][dd] = filtered
      }
    })))
    if (changed) await saveSchTagsHistory(next)
  }

  const todayDs = fmtDs(today.getFullYear(), today.getMonth(), today.getDate())

  // schHistory: direct supabase load (needs month-based structure preserved) + Realtime
  const [dataLoaded, setDataLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    supabase.from('schedule_data').select('value').eq('key', DB_KEYS.schHistory).single()
      .then(({ data }) => {
        if (cancelled) return
        if (data?.value) {
          const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          setSchHistory(val)
        }
        setDataLoaded(true)
      })
    const ch = supabase.channel('sch_history_realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'schedule_data', filter: `key=eq.${DB_KEYS.schHistory}`
      }, ({ new: n }) => {
        if (cancelled || !n?.value) return
        try {
          const val = typeof n.value === 'string' ? JSON.parse(n.value) : n.value
          setSchHistory(val)
        } catch {}
      }).subscribe()
    return () => { cancelled = true; ch.unsubscribe() }
  }, [])

  // 동시편집 race 방지: DB 최신값을 가져와 우리 변경분(history)을 deep-merge 후 저장
  // history 구조: { "YYYY-MM-DD": { empId: status, ... }, ... } — 월/주별 키
  const saveSchHistory = async (history) => {
    try {
      const { data: row } = await supabase.from('schedule_data')
        .select('value').eq('key', DB_KEYS.schHistory).single();
      const latestRaw = row?.value
        ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value)
        : {};
      // deep merge: history의 키가 latestRaw를 덮어쓰되, history에 없는 latestRaw 키는 보존
      const merged = { ...latestRaw };
      Object.entries(history || {}).forEach(([monthKey, monthData]) => {
        if (typeof monthData !== 'object' || !monthData) return;
        merged[monthKey] = { ...(latestRaw[monthKey] || {}), ...monthData };
      });
      await supabase.from('schedule_data').upsert({
        id: DB_KEYS.schHistory, key: DB_KEYS.schHistory,
        value: JSON.stringify(merged), updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[saveSchHistory] merge fail, fallback to direct save:', e);
      await supabase.from('schedule_data').upsert({
        id: DB_KEYS.schHistory, key: DB_KEYS.schHistory,
        value: JSON.stringify(history), updated_at: new Date().toISOString()
      });
    }
  }

  // empSettings: 직원별 근무 설정 (employees_v1 기반)
  const [empSettings, setEmpSettings] = useState({})
  useEffect(() => {
    // 프리랜서는 타임라인 컬럼 전용이므로 empSettings에 포함하지 않음
    const base = {}
    ;(baseEmployees || []).forEach(e => {
      if (e.isFreelancer) return
      base[e.id] = { weeklyWork:7-(e.weeklyOff||2), altPattern:false, isFreelancer:false }
    })
    setEmpSettings(prev => ({ ...base, ...prev }))
  }, [baseEmployees])

  // Load empSettings from DB (empSettings_v1)
  // + Realtime 구독: 다른 PC에서 변경 시 자동 반영
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: d1 } = await supabase.from('schedule_data').select('value').eq('key', DB_KEYS.empSettings).single()
      if (cancelled) return
      if (d1?.value) {
        const val = typeof d1.value === 'string' ? JSON.parse(d1.value) : d1.value
        if (typeof val === 'object' && !Array.isArray(val)) {
          setEmpSettings(prev => ({ ...prev, ...val }))
        }
      }
    })()

    const ch = supabase.channel('emp_settings_realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'schedule_data', filter: `key=eq.${DB_KEYS.empSettings}`
      }, ({ new: n }) => {
        if (cancelled) return
        if (n?.value !== undefined && n?.value !== null) {
          try {
            const val = typeof n.value === 'string' ? JSON.parse(n.value) : n.value
            if (typeof val === 'object' && !Array.isArray(val)) {
              setEmpSettings(prev => ({ ...prev, ...val }))
            }
          } catch {}
        }
      }).subscribe()

    return () => { cancelled = true; ch.unsubscribe() }
  }, [])

  // Rule config
  const [ruleConfig, setRuleConfig] = useState({
    minWork:11, maxWork:15, maxDailyOff:5, maxConsecWork:6,
    biweeklyConsecOff:true,
    branchMinStaff:Object.fromEntries(BRANCHES_SCH.map(b => [b.id, b.minStaff])),
    noSimultaneousOff:[],
  })
  useEffect(() => {
    if (ruleConfigData) {
      setRuleConfig(prev => ({
        ...prev, ...ruleConfigData,
        branchMinStaff:{ ...prev.branchMinStaff, ...(ruleConfigData.branchMinStaff||{}) },
        noSimultaneousOff:Array.isArray(ruleConfigData.noSimultaneousOff) ? ruleConfigData.noSimultaneousOff : prev.noSimultaneousOff,
      }))
    }
  }, [ruleConfigData])

  const onSetRule = (key, val) => {
    setRuleConfig(prev => {
      const next = { ...prev, [key]:val }
      saveRuleConfig(next)
      return next
    })
  }

  // Lock status
  const lockStatusRef = useRef({})
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [lockedDates, setLockedDates] = useState(new Set())
  const loadLockStatus = useCallback(() => {
    supabase.from('schedule_data').select('value').eq('key', DB_KEYS.lockStatus).single()
      .then(({ data }) => {
        if (data?.value) {
          const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          lockStatusRef.current = val
        }
        const curKey = mkKey(year, month)
        const cur = lockStatusRef.current[curKey]
        const curMonthPrefix = `${year}-${String(month+1).padStart(2,'0')}`
        const prevY = month === 0 ? year-1 : year
        const prevM = month === 0 ? 11 : month-1
        const prevKey = mkKey(prevY, prevM)
        const prev = lockStatusRef.current[prevKey]
        const carryOverLocked = new Set()
        if (prev?.confirmed && prev.lockedDates) {
          prev.lockedDates.forEach(ds => { if (ds.startsWith(curMonthPrefix)) carryOverLocked.add(ds) })
        }
        if (cur?.confirmed) {
          setIsConfirmed(true)
          setLockedDates(new Set([...(cur.lockedDates||[]), ...carryOverLocked]))
        } else {
          setIsConfirmed(false)
          setLockedDates(carryOverLocked)
        }
      })
  }, [year, month])

  useEffect(() => { loadLockStatus() }, [year, month])

  // Realtime: 다른 PC에서 lockStatus 변경 시 자동 반영
  useEffect(() => {
    const ch = supabase.channel('lock_status_realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'schedule_data', filter: `key=eq.${DB_KEYS.lockStatus}`
      }, () => { loadLockStatus() })
      .subscribe()
    return () => ch.unsubscribe()
  }, [loadLockStatus])

  const saveLockStatus = (data) => {
    lockStatusRef.current = data
    const payload = {
      id:DB_KEYS.lockStatus, key:DB_KEYS.lockStatus,
      value:JSON.stringify(data), updated_at:new Date().toISOString()
    }
    supabase.from('schedule_data').upsert(payload)
      .then(({error}) => {
        if(error) {
          console.error('lockStatus 저장 실패:', error)
          // fallback: REST API로 직접 저장
          fetch(`https://dpftlrsuqxqqeouwbfjd.supabase.co/rest/v1/schedule_data`, {
            method:'POST',
            headers:{'apikey':'sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj',
              'Authorization':'Bearer sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj',
              'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
            body:JSON.stringify(payload)
          }).catch(e=>console.error('lockStatus fallback 실패:', e))
        }
      })
  }

  // UI state
  const [editCell, setEditCell] = useState(null)
  const [toast, setToast] = useState(null)
  const [filterBranch, setFilterBranch] = useState('all')
  const [showRuleConfig, setShowRuleConfig] = useState(false)
  const [showEmpSettings, setShowEmpSettings] = useState(false)
  const [showSupportSettings, setShowSupportSettings] = useState(false)
  const [showOwnerSettings, setShowOwnerSettings] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'daily'
  const [showSnapshots, setShowSnapshots] = useState(false)
  const { data:snapshots, save:saveSnapshots } = useScheduleData(DB_KEYS.schSnapshots, {})
  // 자동 백업 — 설정 변경 시 debounced로 settings 스냅샷 저장
  const settingsBackupTimerRef = useRef(null)
  const settingsBackupInitRef = useRef(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [selectedCells, setSelectedCells] = useState(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const gridDragRef = useRef({ active:false, startEmpIdx:-1, startDayIdx:-1, moved:false })
  const dragJustEndedRef = useRef(false)

  const toast_ = (msg, type='ok') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }

  // ALL employees — employees_v1 단일 소스 (customEmployees_v1 폐기됨)
  const ALL_EMPLOYEES = useMemo(() => baseEmployees || [], [baseEmployees])

  // 프리랜서는 직원근무표에서 아예 표시 제외 (autoAssign에서도 제외되므로 표에 둘 이유 없음)
  const ACTIVE_EMPLOYEES = useMemo(() => ALL_EMPLOYEES.filter(e =>
    !deletedEmpIds.has(e.id)
    && !empSettings[e.id]?.excludeFromSchedule
    && !e.isFreelancer
    && !empSettings[e.id]?.isFreelancer
  ), [ALL_EMPLOYEES, deletedEmpIds, empSettings])

  // Days
  const dim = getDim(year, month)
  const days = useMemo(() => {
    const arr = Array.from({ length:dim }, (_, i) => {
      const d = i+1, ds = fmtDs(year, month, d)
      return { d, ds, dow:getDow0Mon(year, month, d), isNext:false }
    })
    const lastDow = getDow0Mon(year, month, dim)
    if (lastDow !== 6) {
      const daysToAdd = 6 - lastDow
      const nextYear = month === 11 ? year+1 : year
      const nextMonth = month === 11 ? 0 : month+1
      for (let i = 1; i <= daysToAdd; i++) {
        const ds = fmtDs(nextYear, nextMonth, i)
        arr.push({ d:i, ds, dow:getDow0Mon(nextYear, nextMonth, i), isNext:true, nextMonth, nextYear })
      }
    }
    return arr
  }, [year, month, dim])

  const curKey = mkKey(year, month)
  const prevKey = month === 0 ? mkKey(year-1, 11) : mkKey(year, month-1)
  const curMonthStr = `${year}-${String(month+1).padStart(2,'0')}`
  const nextMonthStr = `${month===11 ? year+1 : year}-${String(month+2>12 ? 1 : month+2).padStart(2,'0')}`

  // Schedule data
  const sch = useMemo(() => {
    const base = {}
    ALL_EMPLOYEES.forEach(emp => { base[emp.id] = {} })
    const curMs = curMonthStr
    const prevData = schHistory[prevKey] || {}
    ALL_EMPLOYEES.forEach(emp => {
      Object.entries(prevData[emp.id] || {}).forEach(([ds, s]) => {
        if (ds.startsWith(curMs) && s && s !== '') base[emp.id][ds] = s
      })
    })
    const cur = schHistory[curKey] || {}
    ALL_EMPLOYEES.forEach(emp => {
      Object.entries(cur[emp.id] || {}).forEach(([ds, s]) => {
        if (s && s !== '') base[emp.id][ds] = s
      })
    })
    return base
  }, [schHistory, curKey, prevKey, curMonthStr, ALL_EMPLOYEES])

  const getS = (eid, ds) => sch[eid]?.[ds] || ''

  const setSch = useCallback((updater) => {
    setSchHistory(prev => {
      const cur = prev[curKey] || {}
      const next = typeof updater === 'function' ? updater(cur) : updater
      const newHistory = { ...prev, [curKey]:next }
      saveSchHistory(newHistory)
      return newHistory
    })
  }, [curKey])

  // 근무표→타임라인 동기화: "지원(강남)" ↔ empOverride_v1
  const schNameToBranchId = useMemo(() => {
    const map = {};
    BRANCHES_SCH.forEach(b => {
      if (SCH_BRANCH_MAP[b.id]) map[b.name] = SCH_BRANCH_MAP[b.id];
    });
    return map;
  }, []);

  const syncSchToOverride = useCallback((empId, date, status) => {
    const overrideKey = empId + "_" + date;
    supabase.from('schedule_data').select('value').eq('key', 'empOverride_v1').single()
      .then(({ data: row }) => {
        const raw = row?.value ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {};
        if (isSupport(status)) {
          // "지원(강남)" → branchId 찾기
          const match = status.match(/^지원\((.+)\)$/);
          const brName = match?.[1];
          const targetBid = brName ? schNameToBranchId[brName] : null;
          if (targetBid) {
            raw[overrideKey] = { segments: [{ branchId: targetBid, from: null, until: null }] };
          }
        } else {
          // 근무/휴무 등 → override 삭제
          delete raw[overrideKey];
        }
        return supabase.from('schedule_data').upsert({
          id: 'empOverride_v1', key: 'empOverride_v1',
          value: JSON.stringify(raw), updated_at: new Date().toISOString()
        });
      }).catch(console.error);
  }, [schNameToBranchId]);

  const setS = useCallback((eid, ds, s) => {
    setSch(p => ({ ...p, [eid]:{ ...(p[eid]||{}), [ds]:s } }))
    // empOverride_v1 동기화 (지원 상태 변경 시)
    syncSchToOverride(eid, ds, s)
    // empReqs sync
    const key = eid + '__' + ds
    const emp = ALL_EMPLOYEES.find(e => e.id === eid)
    if (emp && !emp.isOwner) {
      setEmpReqs(prev => {
        const next = { ...prev }
        if (s === '휴무(꼭)') next[key] = '휴무(꼭)'
        else delete next[key]
        saveEmpReqs(next)
        return next
      })
    }
  }, [setSch, ALL_EMPLOYEES, setEmpReqs, saveEmpReqs, syncSchToOverride])

  const onSetEmpSetting = (eid, key, val) => {
    setEmpSettings(p => {
      const next = { ...p, [eid]:{ ...p[eid], [key]:val } }
      supabase.from('schedule_data').upsert({ id:DB_KEYS.empSettings, key:DB_KEYS.empSettings, value:JSON.stringify(next), updated_at:new Date().toISOString() })
        .then(({error}) => { if (error) console.error('empSettings 저장 실패:', error) })
      return next
    })
  }

  // Validation
  const violations = useMemo(() => validateSch(sch, ALL_EMPLOYEES, days, ruleConfig, empSettings), [sch, days, ruleConfig, ALL_EMPLOYEES, empSettings])

  // 자동 설정 백업 — 설정값 변경 시 8초 디바운스 후 settings 스냅샷 저장
  useEffect(() => {
    // 초기 로드는 백업 안 함 (모든 데이터가 로드된 후 첫 변경부터)
    if (!settingsBackupInitRef.current) {
      if (baseEmployees && baseEmployees.length > 0) {
        settingsBackupInitRef.current = true
      }
      return
    }
    if (settingsBackupTimerRef.current) clearTimeout(settingsBackupTimerRef.current)
    settingsBackupTimerRef.current = setTimeout(() => {
      try {
        const settingsSnap = {
          ts: new Date().toISOString(),
          ruleConfig: ruleConfig,
          empSettings: empSettings,
          ownerReqs: ownerReqs,
          empReqs: empReqs,
          ownerRepeat: ownerRepeat,
          maleRotation: maleRotation,
          deletedEmpIds: Array.from(deletedEmpIds || []),
          employees: baseEmployees,
        }
        // functional updater — stale closure 방지 (항상 최신 snapshots 위에 누적)
        saveSnapshots(prev => {
          const base = prev || {}
          const history = (base._settings || []).slice(-19)  // 최신 20개 유지
          return { ...base, _settings: [...history, settingsSnap] }
        })
      } catch (e) { console.warn('settings backup error:', e) }
    }, 8000)
    return () => clearTimeout(settingsBackupTimerRef.current)
  }, [ruleConfig, empSettings, ownerReqs, empReqs, ownerRepeat, maleRotation, deletedEmpIds, baseEmployees])

  // Daily count — 인턴은 카운트 제외
  const dailyCount = (ds) => ALL_EMPLOYEES.filter(e => {
    if (e.isMale || e.isFreelancer) return false
    if (e.rank === '인턴') return false
    const s = getS(e.id, ds)
    return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE
  }).length

  // 지점별 근무 인원 카운트 — 인턴/남자 제외 (경고 표시용)
  const branchWorkerCount = (branchId, branchName, ds) => {
    let n = 0
    ACTIVE_EMPLOYEES.forEach(e => {
      if (e.isMale || e.rank === '인턴' || e.isFreelancer) return
      const s = getS(e.id, ds)
      if (['휴무','휴무(꼭)','무급'].includes(s)) return
      // 본 지점 직원 (타지점 지원 나감 제외)
      if (e.branch === branchId) {
        if (isSupport(s) && !s.includes(branchName)) return
        if (s === STATUS.WORK || s === `지원(${branchName})` || s === STATUS.SHARE) n++
      }
      // 외부 지원
      else if (s === `지원(${branchName})`) n++
    })
    return n
  }
  // (branchId, ds) → 부족 여부
  const branchShortMap = useMemo(() => {
    const map = new Map()
    BRANCHES_SCH.forEach(br => {
      const min = ruleConfig.branchMinStaff?.[br.id] ?? br.minStaff ?? 1
      days.forEach(day => {
        if (day.isNext) return
        const cnt = branchWorkerCount(br.id, br.name, day.ds)
        if (cnt < min) map.set(`${br.id}__${day.ds}`, { cnt, min })
      })
    })
    return map
  }, [sch, ruleConfig.branchMinStaff, days, ACTIVE_EMPLOYEES])

  // Male rotation helper
  const getMaleRotBranch = (empId, dateStr) => {
    const rot = (maleRotation || {})[empId]
    if (!rot?.branches?.length || !rot.startDate) return null
    const start = new Date(rot.startDate)
    const target = new Date(dateStr)
    const diffDays = Math.floor((target-start) / (1000*60*60*24))
    const weekIdx = Math.floor(diffDays / 7)
    const idx = ((weekIdx % rot.branches.length) + rot.branches.length) % rot.branches.length
    return rot.branches[idx]
  }

  const isWeekBoundary = (dayObj) => {
    if (!dayObj.isNext && dayObj.d <= 1) return false
    if (dayObj.isNext) return dayObj.dow === 0
    return getDow0Mon(year, month, dayObj.d) === 0
  }

  // Shown branches
  const shownBranches = filterBranch === 'all' ? BRANCHES_SCH : filterBranch === 'male' ? [] : BRANCHES_SCH.filter(b => b.id === filterBranch)
  const renderOrderEmps = useMemo(() => {
    const list = []
    shownBranches.forEach(branch => {
      ACTIVE_EMPLOYEES.filter(e => e.branch === branch.id).forEach(emp => list.push(emp))
    })
    if (filterBranch === 'all' || filterBranch === 'male') {
      ACTIVE_EMPLOYEES.filter(e => e.isMale).forEach(emp => list.push(emp))
    }
    return list
  }, [shownBranches, ACTIVE_EMPLOYEES, filterBranch])

  // Drag select mouseup
  useEffect(() => {
    const onMouseUp = () => {
      if (gridDragRef.current.active && gridDragRef.current.moved) {
        gridDragRef.current.active = false
        dragJustEndedRef.current = true
        setShowBulkModal(true)
        setTimeout(() => { dragJustEndedRef.current = false }, 200)
      } else if (gridDragRef.current.active) {
        gridDragRef.current.active = false
      }
    }
    const onClickOutside = (e) => {
      if (dragJustEndedRef.current) return
      if (!e.target.closest('.cc') && !e.target.closest('[data-bulk-modal]')) {
        setSelectedCells(new Set())
        setShowBulkModal(false)
      }
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('click', onClickOutside)
    return () => { document.removeEventListener('mouseup', onMouseUp); document.removeEventListener('click', onClickOutside) }
  }, [])

  // Auto assign
  const handleAutoAssign = async () => {
    if (isAssigning || isConfirmed) return
    // 🛡 자동 배치 직전 schHistory 백업 — 실수로 누른 경우 복구 가능
    try {
      const beforeSnap = { ts: new Date().toISOString(), data: { ...(schHistory[curKey]||{}) }, type: 'before_auto_assign' }
      // functional updater — stale closure 방지
      saveSnapshots(prev => {
        const base = prev || {}
        const monthSnaps = [...(base[curKey] || []), beforeSnap].slice(-20)  // 확정 + 자동배치 직전 합산 20개
        return { ...base, [curKey]: monthSnaps }
      })
    } catch(e) { console.warn('자동배치 백업 실패:', e) }
    setIsAssigning(true)

    // Refresh reqs from DB
    let freshEmpReqs = empReqs, freshOwnerReqs = ownerReqs, freshEmpReqsTs = empReqsTs
    try {
      const [r1, r2, r3] = await Promise.all([
        supabase.from('schedule_data').select('value').eq('key', DB_KEYS.empReqs).single(),
        supabase.from('schedule_data').select('value').eq('key', DB_KEYS.ownerReqs).single(),
        supabase.from('schedule_data').select('value').eq('key', DB_KEYS.empReqsTs).single(),
      ])
      if (r1.data?.value) { const v = typeof r1.data.value === 'string' ? JSON.parse(r1.data.value) : r1.data.value; freshEmpReqs = v; setEmpReqs(v) }
      if (r2.data?.value) { const v = typeof r2.data.value === 'string' ? JSON.parse(r2.data.value) : r2.data.value; freshOwnerReqs = v; setOwnerReqs(v) }
      if (r3.data?.value) { const v = typeof r3.data.value === 'string' ? JSON.parse(r3.data.value) : r3.data.value; freshEmpReqsTs = v; setEmpReqsTs(v) }
    } catch (e) {}

    const prevSch = schHistory[prevKey] || {}

    setTimeout(() => {
      try {
        const MAX_RETRY = 30
        let best = null, bestV = null
        for (let i = 0; i < MAX_RETRY; i++) {
          const r = autoAssign(year, month, freshOwnerReqs||{}, prevSch, empSettings||{}, { order:supportOrder||{} }, ruleConfig||{}, ownerRepeat||{}, ACTIVE_EMPLOYEES, freshEmpReqs||{}, Date.now()+i*997, freshEmpReqsTs||{}, maleRotation||{})
          const v = validateSch(r, ACTIVE_EMPLOYEES, days, ruleConfig, empSettings)
          if (v.length === 0) { best = r; bestV = []; break }
          if (!best || v.length < bestV.length) { best = r; bestV = v }
        }
        if (bestV.length > 0) toast_('⚠️ '+MAX_RETRY+'회 시도 후 최선 결과 (위반 '+bestV.length+'건)', 'err')
        else toast_('✅ 자동 배치 완료!')

        // biweekly next phase
        const biweeklyNextPhase = {}
        ACTIVE_EMPLOYEES.filter(e => empSettings[e.id]?.altPattern).forEach(emp => {
          const ws = empSettings[emp.id]
          const weeklyOff_ = ws ? (7 - ws.weeklyWork) : emp.weeklyOff
          const lo_ = Math.max(1, weeklyOff_ - 1)
          const allDs_ = Array.from({ length:dim }, (_, i) => fmtDs(year, month, i+1))
          let wks_ = [], wk_ = []
          allDs_.forEach(ds => {
            const dow_ = new Date(ds).getDay(); const dow2_ = dow_ === 0 ? 6 : dow_-1
            if (dow2_ === 0 && wk_.length) { wks_.push(wk_); wk_ = [] }
            wk_.push({ ds, dow:dow2_ })
          })
          if (wk_.length) wks_.push(wk_)
          let lastWi_ = -1
          wks_.forEach((w, wi) => { if (w.length > 1) lastWi_ = wi })
          if (lastWi_ >= 0) {
            const lastWkDays = wks_[lastWi_]
            const lastDow_ = lastWkDays[lastWkDays.length-1].dow
            const nextYear_ = month === 11 ? year+1 : year
            const nextMonth_ = month === 11 ? 0 : month+1
            const extendedDays = [...lastWkDays]
            for (let nd = 1; nd <= 6-lastDow_; nd++) extendedDays.push({ ds:fmtDs(nextYear_, nextMonth_, nd) })
            let cnt_ = 0
            extendedDays.forEach(({ ds }) => { const s = best[emp.id]?.[ds]; if (s === '휴무' || s === '휴무(꼭)' || s === '무급') cnt_++ })
            const lastRealWeekPhase = cnt_ === 0 ? (lastWi_ % 2 === 0 ? 'lo' : 'hi') : (cnt_ <= lo_ ? 'lo' : 'hi')
            biweeklyNextPhase[emp.id] = lastRealWeekPhase === 'lo' ? 'hi' : 'lo'
          }
        })

        // startDate 이전 날짜 제거
        const cleaned = { ...best }
        ACTIVE_EMPLOYEES.forEach(emp => {
          const sd = empSettings[emp.id]?.startDate
          if (!sd || !cleaned[emp.id]) return
          Object.keys(cleaned[emp.id]).forEach(ds => {
            if (ds < sd) delete cleaned[emp.id][ds]
          })
        })
        // 전달 락 이월 날짜는 이번달 bucket에 저장하지 않음 — 전달 데이터로 fallback되도록
        // (락된 spillover를 5월 bucket에 쓰면 4월 bucket과 분리되어 따로 놂)
        ACTIVE_EMPLOYEES.forEach(emp => {
          if (!cleaned[emp.id]) return
          lockedDates.forEach(ds => {
            delete cleaned[emp.id][ds]
          })
        })
        const toSave = { ...cleaned, __biweeklyNextPhase:biweeklyNextPhase }
        setSchHistory(prev => {
          const n = { ...prev, [curKey]:toSave }
          saveSchHistory(n)
          return n
        })
      } catch (e) {
        toast_('❌ 배치 오류: '+e.message, 'err')
      } finally {
        setIsAssigning(false)
      }
    }, 50)
  }

  // Reset month
  const resetMonth = () => {
    setSchHistory(prev => {
      const next = { ...prev }
      delete next[curKey]
      saveSchHistory(next)
      return next
    })
    setOwnerReqs(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => !k.includes('__'+curMonthStr)))
      saveOwnerReqs(next)
      return next
    })
    setEmpReqs(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => !k.includes('__'+curMonthStr)))
      saveEmpReqs(next)
      return next
    })
    setShowResetConfirm(false)
    toast_(`${year}년 ${month+1}월 근무표가 초기화되었습니다.`)
  }

  // Export
  const handleExportCSV = () => {
    doExportCSV(ALL_EMPLOYEES, days, getS, year, month, BRANCHES_SCH, DNAMES)
    toast_('CSV 다운로드 완료')
  }

  // Lock/Unlock
  const toggleLock = () => {
    if (isConfirmed) {
      setIsConfirmed(false); setLockedDates(new Set())
      lockStatusRef.current = { ...lockStatusRef.current, [curKey]:{ confirmed:false, lockedDates:[] } }
      saveLockStatus(lockStatusRef.current)
      toast_('배치 확정이 해제되었습니다')
    } else {
      const newLocked = days.filter(d => d.isNext).map(d => d.ds)
      setIsConfirmed(true); setLockedDates(new Set(newLocked))
      lockStatusRef.current = { ...lockStatusRef.current, [curKey]:{ confirmed:true, lockedDates:newLocked } }
      saveLockStatus(lockStatusRef.current)
      // 스냅샷 저장 — functional updater + 월별 최신 20개 유지 (확정 + 자동배치 직전 합산)
      const snapshot = { ts:new Date().toISOString(), data:{ ...sch }, type:'confirm' }
      saveSnapshots(prev => {
        const base = prev || {}
        const monthSnapshots = [...(base[curKey] || []), snapshot].slice(-20)
        return { ...base, [curKey]:monthSnapshots }
      })
      toast_('✅ 배치가 확정되었습니다')
    }
  }

  // Delete employee — soft delete via deletedEmpIds (ALL_EMPLOYEES filter에서 제외됨)
  const handleDeleteEmp = (empId) => {
    const next = [...(deletedEmpIdsArr||[]), empId]
    setDeletedEmpIdsArr(next)
    saveDeletedEmpIds(next)
  }

  // Add employee — employees_v1 (baseEmployees)에 직접 추가
  const handleAddEmp = (emp) => {
    const updated = [...(baseEmployees || []), emp]
    saveEmployees(updated)
    onSetEmpSetting(emp.id, 'weeklyWork', 7-emp.weeklyOff)
    onSetEmpSetting(emp.id, 'altPattern', false)
    onSetEmpSetting(emp.id, 'isFreelancer', emp.isFreelancer||false)
    if (emp.startDate) onSetEmpSetting(emp.id, 'startDate', emp.startDate)
  }

  if (!dataLoaded) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f4f2ef', flexDirection:'column', gap:12 }}>
      <div style={{ fontSize:24 }}>🌿</div>
      <div style={{ fontSize:14, color:T.textSub, fontWeight:600 }}>근무표 데이터 불러오는 중...</div>
    </div>
  )

  return (
    <div style={{ fontFamily:"'Noto Sans KR',sans-serif", height:'100%', overflow:'hidden', display:'flex', flexDirection:'column', background:T.bg, color:T.text }}>
      <style>{`
        *{-webkit-user-select:none;user-select:none}
        ::-webkit-scrollbar{height:5px;width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#b0b8c1;border-radius:3px}
        .cc{cursor:pointer}.cc:hover .sch-box{transform:scale(1.06);box-shadow:0 2px 8px rgba(0,0,0,.15)!important}
        @media print{.np{display:none!important}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      `}</style>

      {/* Toast */}
      {toast && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background:toast.type==='err' ? '#b03020' : '#1e6e3a', color:'#fff', padding:'9px 22px', borderRadius:8, fontSize:13, zIndex:999, boxShadow:'0 4px 14px rgba(0,0,0,.2)' }}>{toast.msg}</div>}

      {/* Reset confirm */}
      {showResetConfirm && <>
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:300 }} onClick={() => setShowResetConfirm(false)}/>
        <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:'24px 20px', zIndex:301, width:280, textAlign:'center', boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
          <div style={{ fontSize:20, marginBottom:8 }}>🗑</div>
          <div style={{ fontWeight:700, fontSize:15, color:'#221810', marginBottom:8 }}>{year}년 {month+1}월 초기화</div>
          <div style={{ fontSize:12, color:T.textSub, marginBottom:20, lineHeight:1.6 }}>이 달의 근무표와 지정 휴무가 모두 삭제됩니다.<br/>되돌릴 수 없습니다.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setShowResetConfirm(false)} style={{ flex:1, padding:'10px 0', borderRadius:8, border:'1px solid #ddd', background:'#f5f5f5', cursor:'pointer', fontSize:13, fontFamily:'inherit', fontWeight:600 }}>취소</button>
            <button onClick={resetMonth} style={{ flex:1, padding:'10px 0', borderRadius:8, border:'none', background:'#c04040', color:'#fff', cursor:'pointer', fontSize:13, fontFamily:'inherit', fontWeight:700 }}>초기화</button>
          </div>
        </div>
      </>}

      {/* Modals */}
      {editCell && <EditCellModal editCell={editCell} empSettings={empSettings} onSet={setS} onClose={() => setEditCell(null)}
        cellTagDefs={cellTagDefs} getCellTags={getCellTags} setCellTag={setCellTag}
        onAddTagDef={async (name, color) => {
          const id = 'tag_' + Math.random().toString(36).slice(2,10)
          await saveCellTagDefs([...(cellTagDefs||[]), { id, name, color: color || '#607D8B' }])
        }}
        onDeleteTagDef={deleteCellTagDef}/>}
      {showBulkModal && selectedCells.size > 0 && <BulkEditModal selectedCells={selectedCells} onSet={setS} onClose={(st) => { setShowBulkModal(false); setSelectedCells(new Set()); if (st) toast_(`✅ ${selectedCells.size}개 셀 → ${st}`) }}/>}
      {showRuleConfig && <RuleConfigModal ruleConfig={ruleConfig} allEmployees={ALL_EMPLOYEES} empSettings={empSettings} onSetRule={onSetRule} onClose={() => setShowRuleConfig(false)}/>}
      {showEmpSettings && <EmpSettingsModal allEmployees={ALL_EMPLOYEES} empSettings={empSettings} deletedEmpIds={deletedEmpIds} maleRotation={maleRotation||{}} onSetEmpSetting={onSetEmpSetting} onAddEmp={handleAddEmp} onDeleteEmp={handleDeleteEmp} onSaveMaleRotation={saveMaleRotation} onUpdateEmp={(empId, key, value) => {
        const updated = baseEmployees.map(e => {
          if (e.id !== empId) return e;
          // 여러 필드 동시 업데이트 (예: 성별 → gender + isMale)
          if (key === '__merge' && value && typeof value === 'object') return { ...e, ...value };
          return { ...e, [key]:value, isOwner: key==='rank' ? value==='원장' : e.isOwner };
        });
        saveEmployees(updated);
      }}
        ownerReqs={ownerReqs||{}} empReqs={empReqs||{}} ownerRepeat={ownerRepeat||{}} days={days} year={year} month={month}
        curMonthStr={curMonthStr} nextMonthStr={nextMonthStr}
        onSetOwnerReqs={setOwnerReqs} onSetEmpReqs={setEmpReqs} onSaveOwnerReqs={saveOwnerReqs} onSaveEmpReqs={saveEmpReqs}
        onSetOwnerRepeat={(rep)=>{setOwnerRepeat(rep);saveOwnerRepeat(rep)}}
        onClose={() => setShowEmpSettings(false)}/>}
      {showOwnerSettings && <OwnerSettingsModal allEmployees={ALL_EMPLOYEES} empSettings={empSettings} ownerReqs={ownerReqs||{}} empReqs={empReqs||{}} ownerRepeat={ownerRepeat||{}} days={days} year={year} month={month} curMonthStr={curMonthStr} nextMonthStr={nextMonthStr} onSetOwnerReqs={setOwnerReqs} onSetEmpReqs={setEmpReqs} onSaveOwnerReqs={saveOwnerReqs} onSetOwnerRepeat={(rep) => { setOwnerRepeat(rep); saveOwnerRepeat(rep) }} onClose={() => setShowOwnerSettings(false)}/>}
      {showSupportSettings && <SupportSettingsModal supportOrder={supportOrder||['yongsan']} onSave={(order) => { setSupportOrder(order); saveSupportOrder(order) }} onClose={() => setShowSupportSettings(false)}/>}
      {showSnapshots && <SnapshotModal snapshots={snapshots||{}} allEmployees={ALL_EMPLOYEES} curKey={curKey} onRollback={(monthKey, data) => {
        setSchHistory(prev => {
          const next = { ...prev, [monthKey]:data }
          saveSchHistory(next)
          return next
        })
        toast_(`✅ ${monthKey} 근무표가 이력으로 복원되었습니다`)
      }} onSettingsRollback={(snap) => {
        // 설정값 전체 복원: 자동 백업 임시 중지(중복 저장 방지)
        settingsBackupInitRef.current = false
        try {
          if (snap.ruleConfig) saveRuleConfig(snap.ruleConfig)
          if (snap.empSettings) {
            setEmpSettings(snap.empSettings)
            supabase.from('schedule_data').upsert({ id:DB_KEYS.empSettings, key:DB_KEYS.empSettings, value:JSON.stringify(snap.empSettings), updated_at:new Date().toISOString() })
              .then(({error}) => { if (error) console.error('empSettings 복원 실패:', error) })
          }
          if (snap.ownerReqs) { setOwnerReqs(snap.ownerReqs); saveOwnerReqs(snap.ownerReqs) }
          if (snap.empReqs) { setEmpReqs(snap.empReqs); saveEmpReqs(snap.empReqs) }
          if (snap.ownerRepeat) { setOwnerRepeat(snap.ownerRepeat); saveOwnerRepeat(snap.ownerRepeat) }
          if (snap.maleRotation) saveMaleRotation(snap.maleRotation)
          // 레거시 호환: 옛 스냅샷의 customEmployees는 employees_v1로 합쳐서 복원
          if (snap.customEmployees && Array.isArray(snap.customEmployees) && snap.customEmployees.length > 0) {
            const baseList = Array.isArray(snap.employees) ? snap.employees : (baseEmployees || [])
            const baseIds = new Set(baseList.map(e => e.id))
            const merged = [...baseList, ...snap.customEmployees.filter(e => !baseIds.has(e.id))]
            saveEmployees(merged)
          } else if (snap.employees) {
            saveEmployees(snap.employees)
          }
          if (snap.deletedEmpIds) { setDeletedEmpIdsArr(snap.deletedEmpIds); saveDeletedEmpIds(snap.deletedEmpIds) }
          toast_('✅ 설정값이 백업 시점으로 복원되었습니다')
        } catch (e) {
          console.error('설정 복원 오류:', e)
          toast_('❌ 설정 복원 중 오류: '+e.message, 'err')
        }
        // 5초 후 자동 백업 다시 활성화
        setTimeout(() => { settingsBackupInitRef.current = true }, 5000)
      }} onClose={() => setShowSnapshots(false)}/>}

      {/* Header */}
      <div className="np" style={{ background:T.bgCard, borderBottom:'1px solid '+T.border, padding:'8px 12px', flexShrink:0, boxShadow:T.shadow.sm, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:50, gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <button onClick={() => { if (month===0) { setMonth(11); setYear(y => y-1) } else setMonth(m => m-1) }}
            style={{ width:30, height:30, borderRadius:T.radius.md, border:'1px solid '+T.border, background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I name="arrowL" size={14} color={T.textSub}/>
          </button>
          <div style={{ fontSize:T.fs.md, fontWeight:T.fw.black, color:T.text, whiteSpace:'nowrap' }}>{String(year).slice(2)}년 {month+1}월</div>
          <button onClick={() => { if (month===11) { setMonth(0); setYear(y => y+1) } else setMonth(m => m+1) }}
            style={{ width:30, height:30, borderRadius:T.radius.md, border:'1px solid '+T.border, background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I name="arrowR" size={14} color={T.textSub}/>
          </button>
          {/* 뷰 전환 */}
          <div style={{ display:'flex', background:T.gray100, borderRadius:6, padding:2, marginLeft:8 }}>
            {[{k:'table',l:'표'},{k:'daily',l:'날짜별'}].map(({k,l})=>(
              <button key={k} onClick={()=>setViewMode(k)} style={{
                padding:'4px 10px', borderRadius:5, border:'none', fontSize:11, fontWeight:viewMode===k?700:400,
                background:viewMode===k?'#fff':'transparent', color:viewMode===k?T.text:T.textMuted,
                cursor:'pointer', fontFamily:'inherit', boxShadow:viewMode===k?'0 1px 3px rgba(0,0,0,.08)':'none'
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          {/* Auto assign */}
          <button onClick={handleAutoAssign} style={{
            display:'inline-flex', alignItems:'center', gap:6,
            background:isConfirmed ? '#aaa' : isAssigning ? T.gray400 : T.primary, color:'#fff', border:'none',
            borderRadius:T.radius.md, padding:'7px 14px', fontSize:T.fs.sm, fontWeight:T.fw.bolder,
            cursor:isConfirmed ? 'default' : 'pointer', fontFamily:'inherit',
            boxShadow:isConfirmed ? 'none' : '0 1px 4px rgba(124,124,200,.35)', opacity:isConfirmed ? 0.7 : 1
          }}>
            {isAssigning ? '배치중...' : isConfirmed ? '확정됨' : '⚡ 배치'}
          </button>
          <div style={{ width:1, height:24, background:T.border, margin:'0 2px' }}/>
          {/* Icon buttons */}
          {[
            { icon:'lock', tip:isConfirmed ? '잠금해제' : '배치확정', fn:toggleLock, confirmed:isConfirmed },
            { icon:'trash2', tip:'초기화', fn:() => { if (isConfirmed) { toast_('확정 해제 후 초기화할 수 있습니다', 'err'); return } setShowResetConfirm(true) }, danger:true },
            { icon:'download', tip:'CSV', fn:handleExportCSV },
            { icon:'printer', tip:'인쇄', fn:() => window.print() },
          ].map(({ icon, tip, fn, danger, confirmed }) => (
            <button key={tip} onClick={fn} title={tip} style={{
              width:32, height:32, borderRadius:T.radius.md,
              border:`1px solid ${confirmed ? '#2a9a5a55' : danger ? T.danger+'55' : T.border}`,
              background:confirmed ? '#e8f8ee' : danger ? T.dangerLt : 'transparent',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0
            }}>
              <I name={icon} size={15} color={confirmed ? '#2a9a5a' : danger ? T.danger : T.textSub}/>
            </button>
          ))}
          {/* Settings dropdown */}
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowSettings(s => !s)} title="설정" style={{
              width:32, height:32, borderRadius:T.radius.md,
              border:'1px solid '+(showSettings ? T.primary : T.border),
              background:showSettings ? T.primaryLt : 'transparent',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0
            }}>
              <I name="settings" size={15} color={showSettings ? T.primary : T.textSub}/>
            </button>
            {showSettings && <>
              <div style={{ position:'fixed', inset:0, zIndex:149 }} onClick={() => setShowSettings(false)}/>
              <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:T.bgCard, borderRadius:T.radius.lg, boxShadow:T.shadow.lg, zIndex:150, overflow:'hidden', minWidth:168, border:'1px solid '+T.border }}>
                {[
                  { label:'규칙 설정', icon:'settings', action:() => { setShowRuleConfig(true); setShowSettings(false) } },
                  // 원장 설정 → 직원 설정의 "휴무 설정" 탭으로 통합
                  { label:'직원 설정', icon:'users', action:() => { setShowEmpSettings(true); setShowSettings(false) } },
                  { label:'지점지원 설정', icon:'building', action:() => { setShowSupportSettings(true); setShowSettings(false) } },
                  { label:'백업', icon:'fileText', action:() => { setShowSnapshots(true); setShowSettings(false) } },
                ].map(({ label, icon, action }, idx, arr) => (
                  <button key={label} onClick={action} style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', border:'none',
                    borderBottom:idx < arr.length-1 ? '1px solid '+T.border : 'none',
                    background:'transparent', fontSize:T.fs.sm, cursor:'pointer', fontFamily:'inherit', color:T.text, fontWeight:T.fw.medium
                  }}>
                    <I name={icon} size={14} color={T.primary}/> {label}
                  </button>
                ))}
              </div>
            </>}
          </div>
        </div>
      </div>

      {/* Confirmed banner */}
      {isConfirmed && (
        <div style={{ background:'#e8f8ee', borderBottom:'2px solid #2a9a5a', padding:'8px 16px', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <I name="lock" size={14} color="#2a9a5a"/>
          <span style={{ fontSize:12, fontWeight:700, color:'#1a7a4a' }}>✅ 배치 확정됨 — 자동배치가 비활성화되어 있습니다.</span>
          <button onClick={toggleLock} style={{ marginLeft:'auto', fontSize:11, padding:'2px 10px', borderRadius:5, border:'1px solid #2a9a5a', background:'transparent', color:'#2a9a5a', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>확정 해제</button>
        </div>
      )}

      {/* Violations */}
      {violations.length > 0 && (
        <div className="np" style={{ background:T.dangerLt, borderBottom:'1px solid '+T.danger+'44', padding:'6px 14px', display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.danger }}>⚠ 규칙 위반 ({violations.length}건):</span>
          {violations.slice(0,6).map((v, i) => <span key={i} style={{ fontSize:T.fs.xxs, color:T.danger, background:T.bgCard, border:'1px solid '+T.danger+'55', borderRadius:T.radius.sm, padding:'1px 7px', fontWeight:T.fw.bold }}>{v}</span>)}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex:1, overflow:'auto', minHeight:0, overscrollBehavior:'none', background:T.bg, padding:'0 4px' }}>
      {viewMode === 'daily' ? (
        <DailyView days={days} sch={sch} allEmployees={ALL_EMPLOYEES} year={year} month={month} maleRotation={maleRotation}/>
      ) : (
        <table style={{ borderCollapse:'separate', borderSpacing:'2px 2px', minWidth:dim*46+160 }}>
          <thead style={{ position:'sticky', top:0, zIndex:20 }}>
            <tr>
              <th style={{ ...stickyCol, background:T.bg, fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.textSub, textAlign:'left', zIndex:30, top:0, position:'sticky', border:'none' }}>직원</th>
              {days.map(day => {
                const isToday = day.ds === fmtDs(today.getFullYear(), today.getMonth(), today.getDate())
                const isSun = day.dow === 6, isSat = day.dow === 5
                return <th key={day.ds} style={{ width:44, minWidth:44, padding:'6px 2px', textAlign:'center', position:'sticky', top:0, zIndex:15, background:isToday ? T.primary : T.bg, color:day.isNext ? T.textMuted : isToday ? '#fff' : isSun ? T.danger : isSat ? T.purple : T.textSub, borderRadius:isToday ? 8 : 0, opacity:day.isNext ? 0.5 : 1, border:'none' }}>
                  <div style={{ fontSize:14, fontWeight:800, lineHeight:1.3 }}>{day.d}</div>
                  <div style={{ fontSize:10, fontWeight:500, opacity:0.7 }}>{DNAMES[day.dow]}</div>
                </th>
              })}
            </tr>
          </thead>
          <tbody>
            {shownBranches.map(branch => {
              const emps = ACTIVE_EMPLOYEES.filter(e => e.branch === branch.id)
              const minS = ruleConfig.branchMinStaff?.[branch.id] ?? branch.minStaff ?? 1
              return [
                <tr key={'bh-'+branch.id}>
                  <td style={{ ...stickyCol, padding:'6px 10px 3px', border:'none' }}>
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:branch.color+'18', padding:'3px 12px 3px 8px', borderRadius:6, borderLeft:`4px solid ${branch.color}` }}>
                      <span style={{ fontSize:12, fontWeight:700, color:branch.color }}>{branch.name}</span>
                      <span style={{ fontSize:10, color:T.textMuted, fontWeight:600 }}>최소 {minS}명</span>
                    </div>
                  </td>
                  {days.map(day => {
                    if (day.isNext) return <td key={day.ds} style={{ padding:0, border:'none' }}/>
                    const cnt = branchWorkerCount(branch.id, branch.name, day.ds)
                    const short = cnt < minS
                    return <td key={day.ds} style={{ padding:'2px 1px', textAlign:'center', border:'none' }}>
                      {short && (
                        <div title={`${branch.name} 인원 부족: ${cnt}/${minS}명`}
                          style={{
                            background:'#FFE0E0',
                            color:'#C62828',
                            border:'1.5px solid #EF5350',
                            borderRadius:4,
                            padding:'1px 0',
                            fontSize:9,
                            fontWeight:800,
                            lineHeight:1
                          }}>⚠ {cnt}</div>
                      )}
                    </td>
                  })}
                </tr>,
                ...emps.map((emp, ei) => (
                <tr key={emp.id}>
                  <td style={{ ...stickyCol, padding:'6px 10px', borderLeft:`3px solid ${branch.color}`, background:T.bgCard, borderRadius:'8px 0 0 8px', border:'none' }}>
                    <EmpLabel emp={emp} branch={branch} sch={sch} year={year} month={month} curMonthStr={curMonthStr}/>
                  </td>
                  {days.map((day, dayIdx) => {
                    const empIdx = renderOrderEmps.findIndex(e => e.id === emp.id)
                    return <ScheduleCell key={day.ds} emp={emp} day={day} dayIdx={dayIdx} empIdx={empIdx}
                      getS={getS} isConfirmed={isConfirmed} lockedDates={lockedDates} selectedCells={selectedCells}
                      setSelectedCells={setSelectedCells} setEditCell={setEditCell} setShowBulkModal={setShowBulkModal}
                      gridDragRef={gridDragRef} dragJustEndedRef={dragJustEndedRef} renderOrderEmps={renderOrderEmps}
                      days={days} isWeekBoundary={isWeekBoundary} today={today} fmtDs={fmtDs}
                      empStartDate={empSettings[emp.id]?.startDate}
                      cellTagDefs={cellTagDefs} cellTagIds={getCellTags(emp.id, day.ds)}/>
                  })}
                </tr>
              ))]
            })}

            {/* 남자직원 별도 섹션 제거 — 각 지점 그룹에 이미 표시되므로 중복 방지 */}

            <tr><td colSpan={dim+1} style={{ height:6 }}/></tr>

            {/* Daily count */}
            <tr>
              <td style={{ ...stickyCol, padding:'6px 10px', fontSize:12, fontWeight:700, color:T.textSub, background:T.bg, border:'none' }}>일 근무</td>
              {days.map(day => {
                const c = dailyCount(day.ds)
                const ok = c >= 10 && c <= 15
                return <td key={day.ds} style={{ textAlign:'center', fontWeight:700, fontSize:14, padding:'5px 2px', color:c===0 ? T.gray300 : !ok ? '#fff' : T.textSub, background:c>0 && !ok ? T.danger : T.gray100, borderRadius:6, border:'none' }}>
                  {c>0 ? c : ''}
                </td>
              })}
            </tr>

            {/* Branch counts */}
            {shownBranches.map(branch => {
              const emps = ACTIVE_EMPLOYEES.filter(e => e.branch === branch.id)
              return <tr key={branch.id+'-cnt'}>
                <td style={{ ...stickyCol, padding:'4px 10px', fontSize:11, color:branch.color, fontWeight:700, background:T.bg, borderLeft:`3px solid ${branch.color}`, borderRadius:'6px 0 0 6px', border:'none' }}>{branch.name}</td>
                {days.map(day => {
                  const supportersIn = ALL_EMPLOYEES.filter(e => e.branch !== branch.id && isSupport(getS(e.id, day.ds)) && getS(e.id, day.ds).includes(branch.name)).length
                  const c = emps.filter(e => { const s = getS(e.id, day.ds); return !s || s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE }).length + supportersIn
                  const under = c < branch.minStaff && Object.keys(sch).length > 0
                  return <td key={day.ds} style={{ textAlign:'center', fontSize:11, fontWeight:600, padding:'3px 2px', color:under ? '#fff' : branch.color, background:under ? T.danger : 'transparent', borderRadius:4, border:'none' }}>
                    {c}
                  </td>
                })}
              </tr>
            })}
          </tbody>
        </table>
      )}
      </div>
    </div>
  )
}

// ── Sub components ──

function EmpLabel({ emp, branch, sch, year, month, curMonthStr }) {
  const supportMap = {}
  Object.values(sch[emp.id] || {}).forEach(s => {
    if (s?.startsWith('지원(')) { const bn = s.replace('지원(','').replace(')',''); supportMap[bn] = (supportMap[bn]||0)+1 }
  })
  const entries = Object.entries(supportMap)
  const workDays = Object.entries(sch[emp.id]||{}).filter(([ds,s]) => ds.startsWith(curMonthStr) && (s===STATUS.WORK || isSupport(s) || s===STATUS.SHARE || s==='')).length
  const offDays = Object.entries(sch[emp.id]||{}).filter(([ds,s]) => ds.startsWith(curMonthStr) && (s===STATUS.OFF || s===STATUS.MUST_OFF || s===STATUS.UNPAID)).length
  const violations_ = workDays > 0 && (workDays < 11 || workDays > 15)

  return (
    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:branch.color, flexShrink:0 }}/>
      <div>
        <div style={{ fontSize:13, fontWeight:emp.isOwner ? 700 : 600, lineHeight:1.3, display:'flex', alignItems:'center', gap:5, overflow:'hidden' }}>
          {emp.name}
          {entries.length > 0 && <span style={{ fontSize:9, color:'#c87020', background:'#fff4e0', borderRadius:4, padding:'1px 5px', fontWeight:600, whiteSpace:'nowrap' }}>{entries.map(([bn,cnt]) => `${bn}:${cnt}`).join(' ')}</span>}
        </div>
        <div style={{ fontSize:10, color:T.textMuted, display:'flex', gap:4, alignItems:'center', marginTop:1 }}>
          {branch.name}
          {(workDays > 0 || offDays > 0) && <span style={{ fontSize:10, fontWeight:700, color:violations_ ? T.danger : T.textSub, background:violations_ ? T.dangerLt : T.gray100, borderRadius:4, padding:'0 4px' }}>근{workDays}·휴{offDays}</span>}
        </div>
      </div>
    </div>
  )
}

function MaleEmpLabel({ emp, sch, year, month, curMonthStr }) {
  const workDays = Object.entries(sch[emp.id]||{}).filter(([ds,s]) => ds.startsWith(curMonthStr) && (s===STATUS.WORK || isSupport(s) || s===STATUS.SHARE || s==='')).length
  const offDays = Object.entries(sch[emp.id]||{}).filter(([ds,s]) => ds.startsWith(curMonthStr) && (s===STATUS.OFF || s===STATUS.MUST_OFF || s===STATUS.UNPAID)).length

  return (
    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:T.primary, flexShrink:0 }}/>
      <div>
        <div style={{ fontSize:13, fontWeight:600 }}>{emp.name}</div>
        <div style={{ fontSize:10, color:'#88a8c8', display:'flex', gap:4, alignItems:'center', marginTop:1 }}>
          남자직원
          {(workDays > 0 || offDays > 0) && <span style={{ fontSize:10, fontWeight:700, color:T.primary, background:T.primary+'15', borderRadius:4, padding:'0 4px' }}>근{workDays}·휴{offDays}</span>}
        </div>
      </div>
    </div>
  )
}

function ScheduleCell({ emp, day, dayIdx, empIdx, getS, isConfirmed, lockedDates, selectedCells, setSelectedCells, setEditCell, setShowBulkModal, gridDragRef, dragJustEndedRef, renderOrderEmps, days, isWeekBoundary, today, fmtDs: fmtDsFn, rotBranch, isMale, empStartDate, cellTagDefs=[], cellTagIds=[] }) {
  const cellTags = (cellTagIds || []).map(id => cellTagDefs.find(t => t.id === id)).filter(Boolean)
  const s = getS(emp.id, day.ds)
  const sc = getSColor(s)
  const wb = isWeekBoundary(day)
  const isToday = day.ds === fmtDsFn(today.getFullYear(), today.getMonth(), today.getDate())
  const supportLabel = isSupport(s) && s !== '지원' ? s.replace('지원(','').replace(')','') : null
  const cellKey = `${emp.id}__${day.ds}`
  const isSelected = selectedCells.has(cellKey)
  const beforeStart = empStartDate && day.ds < empStartDate
  const locked = lockedDates.has(day.ds) || isConfirmed || beforeStart

  const onClick = (e) => {
    if (dragJustEndedRef.current || locked) return
    if (e.ctrlKey || e.metaKey) {
      setSelectedCells(prev => { const next = new Set(prev); if (next.has(cellKey)) next.delete(cellKey); else next.add(cellKey); return next })
      return
    }
    if (selectedCells.size > 1 && selectedCells.has(cellKey)) { setShowBulkModal(true); return }
    setSelectedCells(new Set())
    setShowBulkModal(false)
    setEditCell({ emp, day, cur:s })
  }

  const onMouseDown = (e) => {
    if (locked || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    gridDragRef.current = { active:true, startEmpIdx:empIdx, startDayIdx:dayIdx, moved:false }
  }

  const onMouseEnter = (e) => {
    if (lockedDates.has(day.ds)) return
    if (!gridDragRef.current.active && e.buttons === 1 && !e.ctrlKey && !e.metaKey) {
      gridDragRef.current = { active:true, startEmpIdx:empIdx, startDayIdx:dayIdx, moved:false }
      setSelectedCells(new Set([cellKey]))
      return
    }
    if (!gridDragRef.current.active) return
    gridDragRef.current.moved = true
    const { startEmpIdx, startDayIdx } = gridDragRef.current
    const minE = Math.min(startEmpIdx, empIdx), maxE = Math.max(startEmpIdx, empIdx)
    const minD = Math.min(startDayIdx, dayIdx), maxD = Math.max(startDayIdx, dayIdx)
    const sel = new Set()
    for (let ei = minE; ei <= maxE; ei++) {
      const e2 = renderOrderEmps[ei]; if (!e2) continue
      for (let di = minD; di <= maxD; di++) {
        const d2 = days[di]; if (!d2 || lockedDates.has(d2.ds)) continue
        sel.add(`${e2.id}__${d2.ds}`)
      }
    }
    setSelectedCells(sel)
  }

  const cellBg = isSelected ? 'rgba(66,133,244,0.15)' : 'transparent'
  const boxBg = s ? sc.bg : (beforeStart ? T.gray200 : '#fafafa')
  const boxColor = s ? sc.text : (beforeStart ? T.gray400 : T.gray300)
  const boxShadow = s ? `0 1px 3px ${sc.border}44` : 'none'

  return (
    <td className="cc" onClick={onClick} onMouseDown={onMouseDown} onMouseEnter={onMouseEnter}
      style={{ padding:'2px', textAlign:'center', background:cellBg, border:'none', borderRadius:6, opacity:day.isNext ? 0.5 : beforeStart ? 0.35 : 1, cursor:locked ? 'not-allowed' : 'pointer', userSelect:'none', verticalAlign:'middle', position:'relative' }}>
      <div className="sch-box" style={{
        background:boxBg, color:boxColor, boxShadow,
        borderRadius:6, padding:'4px 2px', fontSize:11, fontWeight:s==='휴무'||s==='휴무(꼭)'||s==='무급' ? 700 : s ? 600 : 400,
        minWidth:40, minHeight:28, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column',
        position:'relative', border:'none', transition:'transform .1s, box-shadow .1s'
      }}>
        {locked && !beforeStart && <span style={{ position:'absolute', top:-3, left:1, fontSize:9, lineHeight:1, zIndex:2 }}>🔒</span>}
        {s==='휴무(꼭)' && !emp.isOwner && <span style={{ position:'absolute', top:-5, right:1, fontSize:8, color:'#9060d0', fontWeight:900 }}>★</span>}
        {isSupport(s) ? <><span style={{ fontSize:10, fontWeight:700, lineHeight:1 }}>지원</span>{supportLabel && <span style={{ fontSize:9, color:sc.text, fontWeight:600, lineHeight:1 }}>→{supportLabel}</span>}</> : <span>{s || '—'}</span>}
        {rotBranch && <span style={{ fontSize:8, color:'#2a6099', fontWeight:700, lineHeight:1 }}>{BRANCH_LABEL[rotBranch]}</span>}
        {cellTags.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:2, justifyContent:'center', marginTop:2 }}>
            {cellTags.map(t => (
              <span key={t.id} style={{ fontSize:8, color:t.color, background:t.color+'22', border:`1px solid ${t.color}66`, borderRadius:3, padding:'0 3px', fontWeight:700, lineHeight:1.2, whiteSpace:'nowrap' }}>{t.name}</span>
            ))}
          </div>
        )}
      </div>
    </td>
  )
}

const stickyCol = { position:'sticky', left:0, zIndex:10, width:150, minWidth:150, padding:'6px 10px', verticalAlign:'middle', background:T.bgCard, boxShadow:'4px 0 8px rgba(0,0,0,.06)', border:'none' }
