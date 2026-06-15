import { createClient } from '@supabase/supabase-js'

export const SB_URL = 'https://dpftlrsuqxqqeouwbfjd.supabase.co'
export const SB_KEY = 'sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj'

export const supabase = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// Realtime 구독용 글로벌 참조
window._sbClient = supabase

// ─── Storage 업로드 헬퍼 ───
// dataUrl(base64) 또는 File/Blob → Supabase Storage 업로드 → 공개 URL 반환
// folder: 'requests' | 'notices' 등
// 실패 시 null 반환 (호출 측에서 base64 fallback 가능)
export async function uploadImageToStorage(dataOrFile, folder = 'misc') {
  try {
    let blob, ext = 'png'
    if (typeof dataOrFile === 'string' && dataOrFile.startsWith('data:')) {
      const m = dataOrFile.match(/^data:image\/([a-z]+);base64,(.+)$/i)
      if (!m) return null
      ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
      const bin = atob(m[2])
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      blob = new Blob([arr], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) })
    } else if (dataOrFile instanceof Blob || dataOrFile instanceof File) {
      blob = dataOrFile
      const t = dataOrFile.type || 'image/png'
      ext = t.split('/')[1] || 'png'
      if (ext === 'jpeg') ext = 'jpg'
    } else {
      return null
    }
    const fname = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2,10)}.${ext}`
    const ct = blob.type || ('image/' + (ext === 'jpg' ? 'jpeg' : ext))
    // supabase-js storage 클라이언트 대신 raw fetch — 신형 publishable 키를 일관되게 사용
    // (supabase-js storage가 sb_publishable_ 키를 못 다뤄 업로드 실패하던 문제 회피. REST와 동일 방식)
    const up = await fetch(`${SB_URL}/storage/v1/object/bliss-uploads/${fname}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': ct, 'x-upsert': 'false' },
      body: blob,
    })
    if (!up.ok) {
      console.warn('[uploadImageToStorage]', up.status, await up.text().catch(()=>''))
      return null
    }
    return `${SB_URL}/storage/v1/object/public/bliss-uploads/${fname}`
  } catch (e) {
    console.warn('[uploadImageToStorage] err', e)
    return null
  }
}
