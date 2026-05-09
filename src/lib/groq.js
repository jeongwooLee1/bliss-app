// Groq Llama helper — OpenAI 호환 API (영구 무료 일 14K RPD)
// businesses.settings.groq_key 사용
// 모델: llama-3.3-70b-versatile (한국어 OK, 매우 빠름)

let _key = null
let _model = 'llama-3.3-70b-versatile'

export function setGroqConfig({ key, model } = {}) {
  _key = key || null
  if (model) _model = model
}

export function getGroqConfig() { return { key: _key, model: _model } }

/**
 * Groq Chat completion 호출 (OpenAI 호환).
 * @param {string} prompt 사용자 프롬프트
 * @param {Object} [opts] {systemPrompt, temperature, maxTokens, jsonMode}
 * @returns {Promise<string|null>} 응답 텍스트 또는 null
 */
export async function groqChat(prompt, opts = {}) {
  if (!_key) return null
  if (!prompt) return null
  const { systemPrompt = '', temperature = 0.3, maxTokens = 2048, jsonMode = false } = opts
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })
  try {
    const body = {
      model: _model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }
    if (jsonMode) body.response_format = { type: 'json_object' }
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      console.warn('[groqChat]', r.status, await r.text().catch(()=>'??'))
      return null
    }
    const j = await r.json()
    return j?.choices?.[0]?.message?.content || null
  } catch (e) {
    console.warn('[groqChat] err', e)
    return null
  }
}
