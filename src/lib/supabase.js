import { createClient } from '@supabase/supabase-js'

export const SB_URL = 'https://dpftlrsuqxqqeouwbfjd.supabase.co'
export const SB_KEY = 'sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj'

export const supabase = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// Realtime 구독용 글로벌 참조
window._sbClient = supabase
