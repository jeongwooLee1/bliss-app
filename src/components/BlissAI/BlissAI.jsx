/**
 * BlissAI.jsx — 클로드 AI 메인 페이지
 *
 * 기능:
 *   - 다중 세션 (ChatGPT 스타일 좌측 리스트)
 *   - 세션별 대화 히스토리 유지
 *   - LLM 기반 Intent 분류 (Gemini에게 "질문 유형 뭐야?" 물어봄)
 *   - FAQ 250개 + 정적 데이터(지점/시술/가격) 컨텍스트 주입
 *   - Intent 기반 실시간 DB 조회 → LLM 주입 (고객/매출/예약)
 *
 * 저장: localStorage 'bliss_claude_sessions_v1' = [{id, title, messages, createdAt, updatedAt}]
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { buildFullPrompt, searchFAQ } from './contextBuilder'
import { classifyIntentLLM, queryCustomer, querySales, queryReservations, formatIntentResult } from './dataQuery'
import { buildWriteIntentPrompt, ACTION_SCHEMAS } from './actionSchemas'
import { validateAction, buildPreview, executeAction } from './actionRunner'
import ActionConfirmCard from './ActionConfirmCard'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const SESSIONS_KEY = 'bliss_claude_sessions_v1'
const ACTIVE_SESSION_KEY = 'bliss_claude_active_session'

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

// ─── 세션 유틸 ──────────────────────────────────────────────────────────────
const genSessionId = () => 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const loadSessions = () => {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch { return [] }
}
const saveSessions = (sessions) => {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)) } catch {}
}
const welcomeMessage = (userName) => ({
  role: 'assistant',
  text: `안녕하세요 ${userName ? userName + '님' : '직원님'} :) 클로드 AI예요.\nFAQ·가격·매장 정보는 물론, 오늘 예약 / 이번 달 매출 / 특정 고객 정보도 알려드려요.\n아래 제안을 클릭하거나 질문을 입력해보세요.`,
  suggestions: true,
  at: Date.now(),
})

export default function BlissAI({ data, currentUser, userBranches, isMaster, bizId }) {
  // ── 세션 관리 ─────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState(() => {
    const loaded = loadSessions()
    if (loaded.length) return loaded
    const init = [{
      id: genSessionId(),
      title: '새 대화',
      messages: [welcomeMessage(currentUser?.name)],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]
    saveSessions(init)
    return init
  })
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_SESSION_KEY)
    const sess = loadSessions()
    if (saved && sess.find(s => s.id === saved)) return saved
    return sess[0]?.id || null
  })

  const activeSession = useMemo(() => sessions.find(s => s.id === activeId) || sessions[0], [sessions, activeId])
  const messages = activeSession?.messages || []

  // 세션 저장 자동화
  useEffect(() => { saveSessions(sessions) }, [sessions])
  useEffect(() => {
    if (activeId) try { localStorage.setItem(ACTIVE_SESSION_KEY, activeId) } catch {}
  }, [activeId])

  // ── UI 상태 ───────────────────────────────────────────────────────────────
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth > 768
  })
  const listRef = useRef(null)
  const textareaRef = useRef(null)

  // ── FAQ 로드 ──────────────────────────────────────────────────────────────
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

  // ── 스크롤 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  // ── 세션 조작 ─────────────────────────────────────────────────────────────
  const newSession = () => {
    const s = {
      id: genSessionId(), title: '새 대화',
      messages: [welcomeMessage(currentUser?.name)],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    setSessions(prev => [s, ...prev])
    setActiveId(s.id)
    setInput('')
  }
  const deleteSession = (id) => {
    if (!confirm('이 대화를 삭제할까요?')) return
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (next.length === 0) {
        const init = {
          id: genSessionId(), title: '새 대화',
          messages: [welcomeMessage(currentUser?.name)],
          createdAt: Date.now(), updatedAt: Date.now(),
        }
        setActiveId(init.id)
        return [init]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
  }
  const renameSession = (id) => {
    const cur = sessions.find(s => s.id === id)
    const next = prompt('대화 제목:', cur?.title || '')
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed) return
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed } : s))
  }
  const clearCurrent = () => {
    if (!activeSession) return
    if (!confirm('이 대화의 메시지를 전부 지울까요? (세션은 유지)')) return
    setSessions(prev => prev.map(s => s.id === activeId
      ? { ...s, messages: [welcomeMessage(currentUser?.name)], updatedAt: Date.now() }
      : s
    ))
  }

  // ── 메시지 추가 헬퍼 ──────────────────────────────────────────────────────
  const appendMessage = (msg) => {
    setSessions(prev => prev.map(s => s.id === activeId
      ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() }
      : s
    ))
  }
  // 첫 유저 메시지로 세션 제목 자동 설정
  const maybeSetTitle = (firstUserText) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s
      if (s.title !== '새 대화') return s
      const t = firstUserText.slice(0, 30).replace(/\n/g, ' ')
      return { ...s, title: t }
    }))
  }

  // ── Gemini 호출 (히스토리 + 컨텍스트 포함) ─────────────────────────────
  const callGemini = async (prompt, { useHistory = true } = {}) => {
    const key = geminiKey
    if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 관리설정 → AI 설정에서 키를 입력하세요.')
    // 히스토리를 multi-turn contents로 전달
    const contents = []
    if (useHistory && activeSession) {
      const hist = activeSession.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20) // 최근 20개만 (토큰 절약)
      // Gemini 포맷: [{role:'user'|'model', parts:[{text}]}]
      hist.forEach(m => {
        contents.push({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.text || '' }],
        })
      })
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] })
    const r = await fetch(GEMINI_URL + '?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`Gemini ${r.status}: ${txt.slice(0, 200)}`)
    }
    const dd = await r.json()
    return dd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '(답변 없음)'
  }

  // ── 감사 로그 ────────────────────────────────────────────────────────────
  const logQuery = async (question, intent, answer) => {
    try {
      const entry = {
        at: new Date().toISOString(),
        user: currentUser?.name || currentUser?.id || 'unknown',
        role,
        session: activeId,
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
    } catch { /* ignore */ }
  }

  // ── 질문 처리 ─────────────────────────────────────────────────────────────
  const handleSend = async (text) => {
    const q = (text || '').trim()
    if (!q || sending || !activeSession) return
    if (!geminiKey) { setError('Gemini API 키가 설정되지 않았습니다. 관리설정 → AI 설정에서 키를 입력하세요.'); return }
    setError('')
    setInput('')
    const userMsg = { role: 'user', text: q, at: Date.now() }
    appendMessage(userMsg)
    // 첫 유저 메시지면 세션 제목 설정
    const prevUserMsgs = activeSession.messages.filter(m => m.role === 'user').length
    if (prevUserMsgs === 0) maybeSetTitle(q)
    setSending(true)

    try {
      // 1단계: 쓰기/세팅 요청인지 먼저 판별 (LLM)
      const writeCheck = await tryParseWriteIntent(q, data, callGemini)
      if (writeCheck?.intent === 'write' && writeCheck.action) {
        // 권한 체크: 쓰기는 브랜드 대표(isMaster)만
        if (!isMaster) {
          appendMessage({
            role: 'assistant',
            text: '⛔ 설정 변경은 브랜드 대표(마스터) 계정에서만 가능합니다.\n조회 기능(예약/매출/고객/FAQ)은 자유롭게 이용하실 수 있어요.',
            at: Date.now(),
          })
          return
        }
        // 쓰기 요청 — confirm 카드 메시지로 추가
        const validateErr = validateAction(writeCheck.action, writeCheck.changes)
        const preview = buildPreview(writeCheck, data)
        if (validateErr) {
          preview.error = validateErr
        }
        appendMessage({
          role: 'assistant',
          text: '요청을 확인해주세요:',
          action: { ...writeCheck, preview, schema: ACTION_SCHEMAS[writeCheck.action] },
          at: Date.now(),
        })
        return
      }
      if (writeCheck?.intent === 'ambiguous') {
        appendMessage({ role: 'assistant', text: writeCheck.need_info || '요청이 모호합니다. 조금 더 자세히 말씀해주세요.', at: Date.now() })
        return
      }

      // 2단계: 조회/FAQ 플로우
      const intent = await classifyIntentLLM(q, callGemini)
      let extraContext = ''
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

      const prompt = buildFullPrompt({ question: q, data, faqItems, role, extraContext })
      const answer = await callGemini(prompt, { useHistory: true })
      appendMessage({ role: 'assistant', text: answer, intent: intent.type, at: Date.now() })
      logQuery(q, intent, answer)
    } catch (e) {
      console.error('[ClaudeAI]', e)
      appendMessage({ role: 'assistant', text: '❌ 답변 생성 실패: ' + (e?.message || e), error: true, at: Date.now() })
    } finally {
      setSending(false)
    }
  }

  // ── 쓰기 intent 판별: LLM으로 action JSON 추출 시도 ─────────────────────
  const tryParseWriteIntent = async (question, data, callLLM) => {
    try {
      // 간략한 state snapshot 주입 (LLM이 target 매칭에 참고)
      const snap = [
        `지점: ${(data?.branches||[]).map(b=>b.short||b.name).filter(Boolean).join(', ')}`,
        `카테고리: ${(data?.categories||data?.serviceCategories||[]).map(c=>c.name).filter(Boolean).slice(0,20).join(', ')}`,
      ].join('\n')
      const prompt = buildWriteIntentPrompt(question, snap)
      const raw = await callLLM(prompt, { useHistory: false })
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return null
      const obj = JSON.parse(m[0])
      return obj
    } catch (e) {
      console.warn('[ClaudeAI] write intent parse failed:', e?.message)
      return null
    }
  }

  // ── 액션 실행 핸들러 ────────────────────────────────────────────────────
  const runAction = async (msgIdx, actionPayload) => {
    // 권한 2중 방어
    if (!isMaster) {
      updateActionStatus(msgIdx, 'error', '권한 없음')
      appendMessage({ role: 'assistant', text: '⛔ 설정 변경은 브랜드 대표만 가능합니다.', error: true, at: Date.now() })
      return
    }
    // 메시지 상태 업데이트: running
    updateActionStatus(msgIdx, 'running')
    try {
      const res = await executeAction(actionPayload, data, { bizId, currentUser })
      updateActionStatus(msgIdx, 'done')
      appendMessage({
        role: 'assistant',
        text: `✅ "${actionPayload.preview?.label || actionPayload.action}" 실행 완료.${res.result ? `\n${typeof res.result === 'object' ? JSON.stringify(res.result).slice(0,200) : res.result}` : ''}`,
        at: Date.now(),
      })
    } catch (e) {
      updateActionStatus(msgIdx, 'error', e.message)
      appendMessage({
        role: 'assistant',
        text: '❌ 실행 실패: ' + (e?.message || e),
        error: true,
        at: Date.now(),
      })
    }
  }
  const cancelAction = (msgIdx) => {
    updateActionStatus(msgIdx, 'cancelled')
    appendMessage({ role: 'assistant', text: '취소됐어요. 다시 말씀해주세요.', at: Date.now() })
  }
  const updateActionStatus = (msgIdx, status, errMsg) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s
      const msgs = [...s.messages]
      if (msgs[msgIdx]?.action) {
        msgs[msgIdx] = { ...msgs[msgIdx], action: { ...msgs[msgIdx].action, status, errMsg } }
      }
      return { ...s, messages: msgs, updatedAt: Date.now() }
    }))
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 좌측 세션 사이드바 */}
      {sidebarOpen && (
        <div style={{
          width: 240, flexShrink: 0, borderRight: '1px solid ' + T.border,
          display: 'flex', flexDirection: 'column', background: T.gray100,
        }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid ' + T.border }}>
            <button onClick={newSession}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none',
                background: T.primary, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              ＋ 새 대화
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
            {sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(s => {
              const active = s.id === activeId
              const msgCount = s.messages.filter(m => m.role === 'user').length
              return (
                <div key={s.id}
                  onClick={() => setActiveId(s.id)}
                  style={{
                    padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                    background: active ? '#fff' : 'transparent',
                    border: active ? '1px solid ' + T.primary : '1px solid transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title || '새 대화'}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                      {msgCount}회 대화
                    </div>
                  </div>
                  {active && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); renameSession(s.id) }}
                        title="제목 변경"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.textMuted, padding: 2, fontSize: 11 }}>✏️</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                        title="삭제"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.danger, padding: 2, fontSize: 11 }}>🗑</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ padding: '8px 12px', borderTop: '1px solid ' + T.border, fontSize: 10, color: T.textMuted }}>
            세션은 이 기기에만 저장됩니다.
          </div>
        </div>
      )}

      {/* 우측 메인 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: sidebarOpen ? 'none' : 900, margin: sidebarOpen ? 0 : '0 auto', padding: '12px 16px 0', minWidth: 0 }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px 12px', borderBottom: '1px solid ' + T.border }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            title="세션 목록"
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
            ☰
          </button>
          <div style={{
            width: 38, height: 38, borderRadius: 19,
            background: 'linear-gradient(135deg,#F97316,#7C3AED)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>🤖</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: T.fw.black, color: T.text }}>클로드 AI</div>
            <div style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              FAQ {faqItems.length}개 · 지점 {(data?.branches || []).length}개 ·{' '}
              <span style={{ color: isMaster ? '#059669' : '#6B7280', fontWeight: 700 }}>
                {isMaster ? '🛠 쓰기 권한' : '👁 읽기 전용'}
              </span>
            </div>
          </div>
          <button onClick={clearCurrent}
            title="현재 대화 초기화"
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↻ 초기화
          </button>
        </div>

        {/* 메시지 리스트 */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <ChatBubble key={i} msg={m} onSuggestion={handleSend}
              onConfirmAction={() => runAction(i, m.action)}
              onCancelAction={() => cancelAction(i)}
            />
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
          borderTop: '1px solid ' + T.border, padding: '12px 4px 16px',
          background: '#fff', position: 'sticky', bottom: 0, zIndex: 5,
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
    </div>
  )
}

// ─── 메시지 버블 ──────────────────────────────────────────────────────────────
function ChatBubble({ msg, onSuggestion, onConfirmAction, onCancelAction }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', gap: 8, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: 16, flexShrink: 0,
          background: 'linear-gradient(135deg,#F97316,#7C3AED)',
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
        {/* 액션 confirm 카드 */}
        {msg.action && (
          <ActionConfirmCard
            preview={msg.action.preview}
            schema={msg.action.schema}
            status={msg.action.status}
            onConfirm={onConfirmAction}
            onCancel={onCancelAction}
          />
        )}
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
if (typeof document !== 'undefined' && !document.getElementById('bliss-ai-keyframes')) {
  const s = document.createElement('style')
  s.id = 'bliss-ai-keyframes'
  s.textContent = `@keyframes bliss-dot { 0%,80%,100%{transform:scale(0.6);opacity:0.5} 40%{transform:scale(1);opacity:1} }`
  document.head.appendChild(s)
}
