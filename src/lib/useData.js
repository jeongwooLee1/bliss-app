import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { BUSINESS_ID } from './constants'

// ── 직원 목록 (Supabase employees_v1) ──────────────────────
export function useEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data } = await supabase
      .from('schedule_data').select('value').eq('key', 'employees_v1').single()
    if (data?.value) {
      const list = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      setEmployees(list)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const save = async (list) => {
    await supabase.from('schedule_data').upsert({
      id: 'employees_v1', key: 'employees_v1',
      value: JSON.stringify(list)
    })
    setEmployees(list)
  }

  return { employees, setEmployees, save, loading, reload: load }
}

// ── 지점 목록 (Supabase branches 테이블) ───────────────────
export function useBranches() {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('branches').select('*')
      .eq('business_id', BUSINESS_ID).order('sort', { ascending: true })
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
    supabase.from('schedule_data').select('value').eq('key', 'schHistory_v1').single()
      .then(({ data }) => {
        if (data?.value) setSchHistory(parse(data.value))
        setLoading(false)
      })

    const ch = supabase.channel('sch_realtime')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'schedule_data', filter: 'key=eq.schHistory_v1'
      }, ({ new: n }) => {
        if (n?.value) setSchHistory(parse(n.value))
      }).subscribe()

    return () => ch.unsubscribe()
  }, [])

  const save = async (history) => {
    await supabase.from('schedule_data').upsert({
      id: 'schHistory_v1', key: 'schHistory_v1',
      value: JSON.stringify(history)
    })
  }

  return { schHistory, setSchHistory, save, loading }
}

// ── 남자직원 로테이션 ──────────────────────────────────────
export function useMaleRotation() {
  const [maleRotation, setMaleRotation] = useState({})

  useEffect(() => {
    supabase.from('schedule_data').select('value').eq('key', 'maleRotation_v1').single()
      .then(({ data }) => {
        if (data?.value) {
          const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          setMaleRotation(val)
        }
      })

    const ch = supabase.channel('male_rot_realtime')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'schedule_data', filter: 'key=eq.maleRotation_v1'
      }, ({ new: n }) => {
        if (n?.value) {
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
    let cancelled = false
    // 초기 로드
    supabase.from('schedule_data').select('value').eq('key', key).single()
      .then(({ data: row }) => {
        if (cancelled) return
        if (row?.value) {
          const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
          setData(val)
        }
        setLoaded(true)
      })

    // Realtime 구독 — 다른 PC에서 변경 시 자동 반영
    const ch = supabase.channel(`sch_data_${key}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'schedule_data', filter: `key=eq.${key}`
      }, ({ new: n }) => {
        if (cancelled) return
        if (n?.value !== undefined && n?.value !== null) {
          try {
            const val = typeof n.value === 'string' ? JSON.parse(n.value) : n.value
            setData(val)
          } catch {}
        }
      }).subscribe()

    return () => { cancelled = true; ch.unsubscribe() }
  }, [key])

  const save = async (val) => {
    setData(val)
    await supabase.from('schedule_data').upsert({
      id: key, key,
      value: JSON.stringify(val),
      updated_at: new Date().toISOString()
    })
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

      const [branches, services, tags, cats, sources, reservations, rooms, businesses] = await Promise.all([
        supabase.from('branches').select('*').eq('business_id', BUSINESS_ID).order('sort'),
        supabase.from('services').select('*').eq('business_id', BUSINESS_ID).order('sort'),
        supabase.from('service_tags').select('*').eq('business_id', BUSINESS_ID).order('sort'),
        supabase.from('service_categories').select('*').eq('business_id', BUSINESS_ID).order('sort'),
        supabase.from('reservation_sources').select('*').eq('business_id', BUSINESS_ID).order('sort'),
        supabase.from('reservations').select('*').eq('business_id', BUSINESS_ID)
          .gte('date', from).lte('date', to).order('date'),
        supabase.from('rooms').select('*').eq('business_id', BUSINESS_ID),
        supabase.from('businesses').select('*').eq('id', BUSINESS_ID),
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
