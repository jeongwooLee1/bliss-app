import { useState, useCallback } from 'react'
import { supabase } from './supabase'
import { BUSINESS_ID } from './constants'
import { genId, todayStr } from './utils'

export function useReservations(data, setData) {
  const [saving, setSaving] = useState(false)

  const upsert = useCallback(async (item) => {
    setSaving(true)
    try {
      const isNew = !item.id
      const payload = {
        ...item,
        id: item.id || genId('res'),
        business_id: BUSINESS_ID,
        updated_at: new Date().toISOString(),
      }
      if (isNew) payload.created_at = new Date().toISOString()

      const { data: saved, error } = await supabase
        .from('reservations')
        .upsert(payload)
        .select()
        .single()

      if (error) throw error

      setData(prev => {
        const list = prev.reservations || []
        const idx = list.findIndex(r => r.id === saved.id)
        const next = idx >= 0
          ? list.map(r => r.id === saved.id ? saved : r)
          : [...list, saved]
        return { ...prev, reservations: next }
      })
      return saved
    } finally {
      setSaving(false)
    }
  }, [setData])

  const remove = useCallback(async (id) => {
    await supabase.from('reservations').delete().eq('id', id)
    setData(prev => ({
      ...prev,
      reservations: (prev.reservations || []).filter(r => r.id !== id)
    }))
  }, [setData])

  const updateField = useCallback(async (id, fields) => {
    const { data: updated } = await supabase
      .from('reservations')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (updated) {
      setData(prev => ({
        ...prev,
        reservations: (prev.reservations || []).map(r => r.id === id ? { ...r, ...updated } : r)
      }))
    }
    return updated
  }, [setData])

  return { upsert, remove, updateField, saving }
}
