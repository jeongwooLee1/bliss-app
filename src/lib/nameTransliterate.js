// 영문 이름 → 한글 음역
// Gemini Flash 호출 + 메모리 캐시. apiKey는 호출자(컴포넌트)가 전달.
// 한글이 이미 섞인 이름은 음역 X (빈 문자열 반환).

const _cache = new Map() // 키: name(소문자 trim), 값: 한글 음역 또는 ''

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// 동기 캐시 조회 — 이미 변환된 이름이면 즉시 반환, 없으면 ''
export function getCachedTransliteration(name) {
  if (!name) return ''
  if (/[가-힣]/.test(name)) return ''
  return _cache.get(String(name).trim().toLowerCase()) || ''
}

// 한글 음역 호출 (캐시 없으면 Gemini 호출). 결과는 캐시에 저장.
export async function transliterateName(name, geminiKey) {
  if (!name) return ''
  if (/[가-힣]/.test(name)) return ''
  if (!geminiKey) return ''
  const key = String(name).trim().toLowerCase()
  if (_cache.has(key)) return _cache.get(key)
  try {
    const r = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `다음 영문 이름을 한국에서 일반적으로 사용하는 한글 음역으로만 답변하세요. 설명·따옴표·이모지 없이 한글 음역만. 단어 사이는 한 칸 띄어쓰기.\n\n이름: ${name}\n\n한글 음역:` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 50 }
      })
    })
    if (!r.ok) return ''
    const j = await r.json()
    const raw = (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
    // 첫 줄만 + 한글이 들어있는지 확인 + 따옴표/괄호 제거
    const cleaned = raw.split('\n')[0].replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/[「」『』""'']/g, '').trim()
    if (!/[가-힣]/.test(cleaned)) return ''
    _cache.set(key, cleaned)
    return cleaned
  } catch (e) {
    console.warn('[nameTransliterate] fail:', name, e)
    return ''
  }
}

// 배치 음역 — 동시 N개 (concurrency=3 기본)
export async function transliterateBatch(names, geminiKey, opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 3)
  const out = new Map()
  const queue = [...new Set((names || []).filter(n => n && !/[가-힣]/.test(n)).map(n => String(n).trim()))]
  let idx = 0
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null
  async function worker() {
    while (idx < queue.length) {
      const i = idx++
      const n = queue[i]
      const r = await transliterateName(n, geminiKey)
      if (r) out.set(n, r)
      if (onProgress) onProgress(i + 1, queue.length, n, r)
    }
  }
  await Promise.all(Array(Math.min(concurrency, queue.length)).fill(0).map(() => worker()))
  return out
}
