// DeepL Translator helper — 한↔영 번역 (Free tier 50만자/월)
// businesses.settings.deepl_key 사용 (key가 ':fx'로 끝나면 Free, 아니면 Pro)

let _key = null

export function setTranslatorConfig({ key } = {}) {
  _key = key || null
}

export function getTranslatorConfig() { return { key: _key } }

// Free tier는 api-free.deepl.com, Pro는 api.deepl.com
function _baseUrl() {
  if (!_key) return null
  return _key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2'
    : 'https://api.deepl.com/v2'
}

// 언어 코드 매핑 (DeepL은 대문자 사용: EN, KO, JA, ZH 등)
function _normLang(code) {
  if (!code) return null
  const c = String(code).toUpperCase()
  if (c.startsWith('EN')) return 'EN'
  if (c.startsWith('KO')) return 'KO'
  if (c.startsWith('JA')) return 'JA'
  if (c.startsWith('ZH')) return 'ZH'
  return c
}

/**
 * DeepL 번역 호출.
 * @param {string} text 번역할 텍스트
 * @param {string} to   대상 언어 (예: 'EN', 'KO')
 * @param {string} [from] 원본 언어 (생략 시 자동 감지)
 * @returns {Promise<string|null>} 번역 결과 또는 null
 */
export async function translate(text, to, from) {
  const base = _baseUrl()
  if (!base || !text || !to) return null
  try {
    const body = new URLSearchParams()
    body.set('text', text)
    body.set('target_lang', _normLang(to))
    if (from) body.set('source_lang', _normLang(from))
    const r = await fetch(`${base}/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${_key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!r.ok) {
      console.warn('[deepl translate]', r.status, await r.text().catch(()=>'??'))
      return null
    }
    const j = await r.json()
    return j?.translations?.[0]?.text || null
  } catch (e) {
    console.warn('[deepl translate] err', e)
    return null
  }
}

// 사용량 조회 (Free tier 한도 확인용)
export async function getUsage() {
  const base = _baseUrl()
  if (!base) return null
  try {
    const r = await fetch(`${base}/usage`, {
      headers: { 'Authorization': `DeepL-Auth-Key ${_key}` },
    })
    if (!r.ok) return null
    return await r.json()  // {character_count, character_limit}
  } catch { return null }
}

// alias for backward compat (azureTranslate -> translate)
export const azureTranslate = translate
