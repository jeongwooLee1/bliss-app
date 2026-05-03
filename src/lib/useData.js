import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { _activeBizId } from './db'

// 현재 활성 사업장 ID — _activeBizId(live binding)에서 읽음. AppShell에서 setActiveBiz로 세팅됨.
// 미설정이면 null 반환 → 호출부에서 fetch 스킵

// ── 직원 목록 (Supabase employees_v1) ──────────────────────
export function useEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!_activeBizId) { setLoading(false); return }
    const { data } = await supabase
      .from('schedule_data').select('value')
      .eq('business_id', _activeBizId).eq('key', 'employees_v1').maybeSingle()
    if (data?.value) {
      const list = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      setEmployees(list)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const save = async (list) => {
    if (!_activeBizId) throw new Error('activeBizId not set')
    await supabase.from('schedule_data').upsert({
      business_id: _activeBizId,
      id: 'employees_v1', key: 'employees_v1',
      value: JSON.stringify(list)
    }, { onConflict: 'business_id,key' })
    setEmployees(list)
  }

  return { employees, setEmployees, save, loading, reload: load }
}

// ── 지점 목록 (Supabase branches 테이블) ───────────────────
export function useBranches() {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!_activeBizId) { setLoading(false); return }
    supabase.from('branches').select('*')
      .eq('business_id', _activeBizId).order('sort', { ascending: true })
      .then(({ data }) => { if (data) setBranches(data); setLoading(false) })
  }, [])

  return { branches, loading }
}

// ── 근무표 (schHistory_v1 + Realtime) ──────────────────────
export function useSchHistory() {
  const [schHistory, setSchHistory] = useState({})
  const [loading, setLoading] = useState(true)

  const parse = (val) => {
    const merged = {}
    const obj = typeof val === 'string' ? JSON.parse(val) : val
    Object.values(obj).forEach(monthData => {
      if (typeof monthData !== 'object') return
      Object.entries(monthData).forEach(([emp, days]) => {
        if (emp.startsWith('__')) return
        if (!merged[emp]) merged[emp] = {}
        Object.assign(merged[emp], days)
      })
    })
    return merged
  }

  useEffect(() => {
    if (!_activeBizId) { setLoading(false); return }
    const bizId = _activeBizId
    supabase.from('schedule_data').select('value')
      .eq('business_id', bizId).eq('key', 'schHistory_v1').maybeSingle()
      .then(({ data }) => {
        if (data?.value) setSchHistory(parse(data.value))
        setLoading(false)
      })

    const ch = supabase.channel(`sch_realtime_${bizId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'schedule_data', filter: `business_id=eq.${bizId}`
      }, ({ new: n }) => {
        if (n?.key === 'schHistory_v1' && n?.value) setSchHistory(parse(n.value))
      }).subscribe()

    return () => ch.unsubscribe()
  }, [])

  const save = async (history) => {
    if (!_activeBizId) throw new Error('activeBizId not set')
    await supabase.from('schedule_data').upsert({
      business_id: _activeBizId,
      id: 'schHistory_v1', key: 'schHistory_v1',
      value: JSON.stringify(history)
    }, { onConflict: 'business_id,key' })
  }

  return { schHistory, setSchHistory, save, loading }
}

// ── 남자직원 로테이션 ──────────────────────────────────────
export function useMaleRotation() {
  const [maleRotation, setMaleRotation] = useState({})

  useEffect(() => {
    if (!_activeBizId) return
    const bizId = _activeBizId
    supabase.from('schedule_data').select('value')
      .eq('business_id', bizId).eq('key', 'maleRotation_v1').maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          setMaleRotation(val)
        }
      })

    const ch = supabase.channel(`male_rot_realtime_${bizId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'schedule_data', filter: `business_id=eq.${bizId}`
      }, ({ new: n }) => {
        if (n?.key === 'maleRotation_v1' && n?.value) {
          const val = typeof n.value === 'string' ? JSON.parse(n.value) : n.value
          setMaleRotation(val)
        }
      }).subscribe()

    return () => ch.unsubscribe()
  }, [])

  const getRotationBranch = (empId, dateStr) => {
    const rot = maleRotation[empId]
    if (!rot?.branches?.length || !rot.startDate) return null
    const start = new Date(rot.startDate)
    const target = new Date(dateStr)
    const diffDays = Math.floor((target - start) / (1000*60*60*24))
    const weekIdx = Math.floor(diffDays / 7)
    const idx = ((weekIdx % rot.branches.length) + rot.branches.length) % rot.branches.length
    return rot.branches[idx]
  }

  return { maleRotation, getRotationBranch }
}

// ── 범용 schedule_data 훅 (Realtime 동기화 포함) ─────────────
export function useScheduleData(key, defaultValue = null) {
  const [data, setData] = useState(defaultValue)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!_activeBizId) { setLoaded(true); return }
    const bizId = _activeBizId
    let cancelled = false
    // 초기 로드
    supabase.from('schedule_data').select('value')
      .eq('business_id', bizId).eq('key', key).maybeSingle()
      .then(({ data: row }) => {
        if (cancelled) return
        if (row?.value) {
          const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
          setData(val)
        }
        setLoaded(true)
      })

    // Realtime 구독 — 같은 사업장 안에서만 (filter는 단일 조건만 지원 → key+business_id 합성 필터 사용)
    const ch = supabase.channel(`sch_data_${bizId}_${key}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'schedule_data', filter: `business_id=eq.${bizId}`
      }, ({ new: n }) => {
        if (cancelled) return
        if (n?.key !== key) return
        if (n?.value !== undefined && n?.value !== null) {
          try {
            const val = typeof n.value === 'string' ? JSON.parse(n.value) : n.value
            setData(val)
          } catch {}
        }
      }).subscribe()

    return () => { cancelled = true; ch.unsubscribe() }
  }, [key])

  // val이 함수면 항상 fresh state 기반 (stale closure 방지). 객체면 기존 동작 유지.
  const save = async (valOrFn) => {
    if (!_activeBizId) throw new Error('activeBizId not set')
    const isFn = typeof valOrFn === 'function'
    let next
    if (isFn) {
      setData(prev => { next = valOrFn(prev); return next })
    } else {
      next = valOrFn
      setData(next)
    }
    await supabase.from('schedule_data').upsert({
      business_id: _activeBizId,
      id: key, key,
      value: JSON.stringify(next),
      updated_at: new Date().toISOString()
    }, { onConflict: 'business_id,key' })
  }

  return { data, setData, save, loaded }
}

// ── 앱 전체 데이터 ─────────────────────────────────────────
export function useAppData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const today = new Date()
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)
      const to = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().slice(0, 10)

      if (!_activeBizId) { setLoading(false); return }
      const bizId = _activeBizId
      const [branches, services, tags, cats, sources, reservations, rooms, businesses] = await Promise.all([
        supabase.from('branches').select('*').eq('business_id', bizId).order('sort'),
        supabase.from('services').select('*').eq('business_id', bizId).order('sort'),
        supabase.from('service_tags').select('*').eq('business_id', bizId).order('sort'),
        supabase.from('service_categories').select('*').eq('business_id', bizId).order('sort'),
        supabase.from('reservation_sources').select('*').eq('business_id', bizId).order('sort'),
        supabase.from('reservations').select('*').eq('business_id', bizId)
          .gte('date', from).lte('date', to).order('date'),
        supabase.from('rooms').select('*').eq('business_id', bizId),
        supabase.from('businesses').select('*').eq('id', bizId),
      ])

      setData({
        branches: branches.data || [],
        services: services.data || [],
        serviceTags: tags.data || [],
        serviceCategories: cats.data || [],
        reservationSources: sources.data || [],
        reservations: reservations.data || [],
        rooms: rooms.data || [],
        businesses: businesses.data || [],
      })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return { data, setData, loading, reload: load }
}
