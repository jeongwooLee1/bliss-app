import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { BUSINESS_ID, MALE_EMPLOYEES } from './constants'

// ── 직원 목록 (Supabase employees_v1) ──────────────────────
export function useEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data } = await supabase
      .from('schedule_data').select('value').eq('key', 'employees_v1').single()
    if (data?.value) {
      const list = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      setEmployees([...list, ...MALE_EMPLOYEES])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const save = async (list) => {
    const withoutMale = list.filter(e => !e.isMale)
    await supabase.from('schedule_data').upsert({
      id: 'employees_v1', key: 'employees_v1',
      value: JSON.stringify(withoutMale)
    })
    setEmployees([...withoutMale, ...MALE_EMPLOYEES])
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
