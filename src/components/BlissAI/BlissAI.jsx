/**
 * BlissAI.jsx — 블리스 AI 메인 페이지
 *
 * 기능:
 *   - 챗 UI (신입직원 교육 / 데이터 조회)
 *   - FAQ 250개 + 정적 데이터(지점/시술/가격) 컨텍스트 주입
 *   - Intent 분류 → 고객/매출/예약 실시간 조회 → LLM에 주입
 *   - Gemini 2.5 Flash 사용
 */
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { buildFullPrompt, searchFAQ } from './contextBuilder'
import { classifyIntent, queryCustomer, querySales, queryReservations, formatIntentResult } from './dataQuery'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// 제안 질문 샘플 (클릭하면 바로 전송)
const SUGGESTIONS = [
  '처음 오신 고객은 어떻게 준비하라고 안내하나요?',
  '임산부도 브라질리언 가능한가요?',
  '오늘 예약 몇 건인가요?',
  '이번 달 강남점 매출 얼마인가요?',
  '인그로운 생겼다는 고객에게 뭐라고 답해요?',
  '왁싱 주기는 어떻게 안내하나요?',
  '남자 고객인데 민망해해요. 뭐라고 해야 하나요?',
  '매장 운영시간은요?',
]

export default function BlissAI({ data, currentUser, userBranches, isMaster, bizId }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `안녕하세요 ${currentUser?.name ? currentUser.name + '님' : '직원님'} :) 블리스 AI예요.\nFAQ·가격·매장 정보는 물론, 오늘 예약 / 이번 달 매출 / 특정 고객 정보도 알려드려요.\n아래 제안을 클릭하거나 질문을 입력해보세요.`,
      suggestions: true,
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const textareaRef = useRef(null)

  // FAQ items (businesses.settings.ai_faq)
  const faqItems = useMemo(() => {
    try {
      const biz = (data?.businesses || [])[0]
      const s = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : (biz?.settings || {})
      return Array.isArray(s?.ai_faq) ? s.ai_faq : []
    } catch { return [] }
  }, [data?.businesses])

  const geminiKey = useMemo(() => {
    return window.__systemGeminiKey
      || window.__geminiKey
      || (() => { try { return JSON.parse((data?.businesses?.[0]?.settings) || '{}').gemini_key || '' } catch { return '' } })()
      || localStorage.getItem('bliss_gemini_key')
      || ''
  }, [data?.businesses])

  const role = isMaster ? 'master' : 'staff'

  useEffect(() => {
    // 스크롤을 맨 아래로
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  // ── 감사 로그 기록 (schedule_data.bliss_ai_logs_v1에 누적, 최근 500개) ──
  const logQuery = async (question, intent, answer) => {
    try {
      const entry = {
        at: new Date().toISOString(),
        user: currentUser?.name || currentUser?.id || 'unknown',
        role,
        question: question.slice(0, 500),
        intent: intent?.type || 'general',
        answer_preview: (answer || '').slice(0, 300),
      }
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.bliss_ai_logs_v1&select=value`, {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
      })
      const rows = await r.json()
      let list = []
      if (rows?.[0]?.value) {
        const v = rows[0].value
        list = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : [])
      }
      list.unshift(entry)
      if (list.length > 500) list = list.slice(0, 500)
      await fetch(`${SB_URL}/rest/v1/schedule_data`, {
        method: 'POST',
        headers: {
          apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ id: 'bliss_ai_logs_v1', key: 'bliss_ai_logs_v1', value: JSON.stringify(list) }),
      })
    } catch (e) { /* 로그 실패는 무시 */ }
  }

  // ── 질문 처리 ─────────────────────────────────────────────────────────────
  const handleSend = async (text) => {
    const q = (text || '').trim()
    if (!q || sending) return
    if (!geminiKey) { setError('Gemini API 키가 설정되지 않았습니다. 관리설정 → AI 설정에서 키를 입력하세요.'); return }
    setError('')
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setSending(true)

    try {
      // Intent 분류
      const intent = classifyIntent(q)
      let extraContext = ''

      // Tier 3: 필요 시 실시간 조회
      if (intent.type === 'customer') {
        const res = await queryCustomer(intent.params.searchTerm, { role, userBranches, bizId })
        extraContext = formatIntentResult(intent, res, data?.branches)
      } else if (intent.type === 'sales') {
        const res = await querySales({ ...intent.params, role, userBranches, bizId })
        extraContext = formatIntentResult(intent, res, data?.branches)
      } else if (intent.type === 'reservation') {
        const res = await queryReservations({ ...intent.params, role, userBranches, bizId })
        extraContext = formatIntentResult(intent, res, data?.branches)
      }

      // 프롬프트 조립
      const prompt = buildFullPrompt({ question: q, data, faqItems, role, extraContext })

      // Gemini 호출
      const r = await fetch(GEMINI_URL + '?key=' + geminiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`Gemini ${r.status}: ${txt.slice(0, 200)}`)
      }
      const dd = await r.json()
      const answer = dd?.candidates?.[0]?.content?.parts?.[0]?.text || '(답변 없음)'

      setMessages(prev => [...prev, { role: 'assistant', text: answer.trim(), intent: intent.type }])
      logQuery(q, intent, answer)
    } catch (e) {
      console.error('[BlissAI]', e)
      setMessages(prev => [...prev, { role: 'assistant', text: '❌ 답변 생성 실패: ' + (e?.message || e), error: true }])
    } finally {
      setSending(false)
    }
  }

  const clearChat = () => {
    if (!confirm('대화를 초기화할까요?')) return
    setMessages([{
      role: 'assistant',
      text: `대화가 초기화됐어요. 무엇을 도와드릴까요?`,
      suggestions: true,
    }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 900, margin: '0 auto', padding: '12px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px 12px', borderBottom: '1px solid ' + T.border }}>
        <div style={{
          width: 38, height: 38, borderRadius: 19,
          background: 'linear-gradient(135deg,#7C3AED,#3B82F6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>🤖</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: T.fw.black, color: T.text }}>블리스 AI</div>
          <div style={{ fontSize: 11, color: T.textMuted }}>
            FAQ {faqItems.length}개 · 지점 {(data?.branches || []).length}개 · 시술 {(data?.services || []).length}종 ·{' '}
            <span style={{ color: role === 'master' ? '#059669' : '#D97706', fontWeight: 700 }}>
              {role === 'master' ? '관리자 모드' : '직원 모드 (민감정보 마스킹)'}
            </span>
          </div>
        </div>
        <button onClick={clearChat}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          ↻ 초기화
        </button>
      </div>

      {/* 메시지 리스트 */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <ChatBubble key={i} msg={m} onSuggestion={handleSend} />
        ))}
        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMuted, fontSize: 13, paddingLeft: 12 }}>
            <Thinking/> 생각 중...
          </div>
        )}
        {error && (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13, border: '1px solid #FCA5A5' }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* 입력 */}
      <div style={{
        borderTop: '1px solid ' + T.border,
        padding: '12px 4px 16px',
        background: '#fff',
        position: 'sticky', bottom: 0, zIndex: 5,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault()
                handleSend(input)
              }
            }}
            placeholder="무엇을 도와드릴까요? (Enter 전송 · Shift+Enter 줄바꿈)"
            rows={1}
            disabled={sending}
            style={{
              flex: 1, resize: 'none', padding: '10px 14px',
              fontSize: 14, borderRadius: 12, border: '1.5px solid ' + T.border,
              fontFamily: 'inherit', outline: 'none',
              lineHeight: 1.5, minHeight: 44, maxHeight: 200,
              background: sending ? T.gray100 : '#fff',
            }}
          />
          <button
            onClick={() => handleSend(input)}
            disabled={sending || !input.trim()}
            style={{
              padding: '10px 20px', borderRadius: 12, border: 'none',
              background: sending || !input.trim() ? T.gray300 : T.primary,
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap', height: 44,
            }}>
            {sending ? '...' : '전송'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 메시지 버블 ──────────────────────────────────────────────────────────────
function ChatBubble({ msg, onSuggestion }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', gap: 8, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: 16, flexShrink: 0,
          background: 'linear-gradient(135deg,#7C3AED,#3B82F6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>🤖</div>
      )}
      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msg.intent && msg.intent !== 'faq' && msg.intent !== 'general' && (
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase' }}>
            🔍 {msg.intent === 'customer' ? '고객 조회' : msg.intent === 'sales' ? '매출 조회' : msg.intent === 'reservation' ? '예약 조회' : msg.intent}
          </div>
        )}
        <div style={{
          padding: '10px 14px', borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? T.primary : msg.error ? '#FEE2E2' : T.gray100,
          color: isUser ? '#fff' : msg.error ? '#991B1B' : T.text,
          fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          border: msg.error ? '1px solid #FCA5A5' : 'none',
        }}>
          {msg.text}
        </div>
        {msg.suggestions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
            <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600 }}>💡 제안</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => onSuggestion(s)}
                  style={{
                    padding: '6px 12px', borderRadius: 16,
                    border: '1px solid ' + T.border, background: '#fff',
                    color: T.textSub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      <Dot d={0}/><Dot d={150}/><Dot d={300}/>
    </span>
  )
}
function Dot({ d }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: 3, background: T.primary,
      display: 'inline-block',
      animation: `bliss-dot 1.2s ${d}ms infinite ease-in-out`,
    }}/>
  )
}
// keyframes 주입 (한 번만)
if (typeof document !== 'undefined' && !document.getElementById('bliss-ai-keyframes')) {
  const s = document.createElement('style')
  s.id = 'bliss-ai-keyframes'
  s.textContent = `@keyframes bliss-dot { 0%,80%,100%{transform:scale(0.6);opacity:0.5} 40%{transform:scale(1);opacity:1} }`
  document.head.appendChild(s)
}
