import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOCK_USERS, MOCK_MESSAGES, CURRENT_USER_ID, MOCK_LAST_READ_AT } from './mockData'

// 사내 메신저 데이터 훅
// 현재는 mock. 향후 Supabase `team_chat_messages` 테이블 + Realtime으로 교체.
// API는 교체해도 변하지 않도록 설계.

const LS_KEY = 'bliss_team_chat_user_id'

export function useTeamChat({ mock = true } = {}) {
  const [users, setUsers] = useState([])
  const [messages, setMessages] = useState([])
  const [currentUserId, setCurrentUserIdState] = useState(null)
  const [lastReadAt, setLastReadAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const idCounter = useRef(1000)

  // 초기 로드: localStorage에 저장된 선택 이름 우선
  useEffect(() => {
    if (mock) {
      setUsers(MOCK_USERS)
      setMessages(MOCK_MESSAGES)
      const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      const validSaved = saved && MOCK_USERS.some(u => u.id === saved) ? saved : CURRENT_USER_ID
      setCurrentUserIdState(validSaved)
      setLastReadAt(MOCK_LAST_READ_AT)
      setLoading(false)
    } else {
      // TODO: Supabase 연결 시 구현
      setLoading(false)
    }
  }, [mock])

  // 이름 변경 (localStorage 저장)
  const setCurrentUserId = useCallback((id) => {
    setCurrentUserIdState(id)
    if (typeof window !== 'undefined' && id) {
      localStorage.setItem(LS_KEY, id)
    }
  }, [])

  // 사용자 ID → user 객체
  const userMap = useMemo(() => {
    const m = {}
    users.forEach(u => { m[u.id] = u })
    return m
  }, [users])

  const currentUser = userMap[currentUserId] || null

  // 메시지 전송
  const send = useCallback((body) => {
    const text = (body || '').trim()
    if (!text || !currentUserId) return
    setSending(true)
    const newMsg = {
      id: 'local_' + (idCounter.current++),
      user_id: currentUserId,
      body: text,
      created_at: new Date().toISOString(),
      _pending: true,
    }
    setMessages(prev => [...prev, newMsg])
    // mock 서버 지연 시뮬레이션
    setTimeout(() => {
      setMessages(prev => prev.map(m =>
        m.id === newMsg.id ? { ...m, _pending: false } : m
      ))
      setSending(false)
    }, 200)
  }, [currentUserId])

  // 읽음 처리 (현재 시각으로)
  const markAllRead = useCallback(() => {
    setLastReadAt(new Date().toISOString())
  }, [])

  // 온라인 사용자 수
  const onlineCount = useMemo(
    () => users.filter(u => u.online).length,
    [users]
  )

  // 미읽 수
  const unreadCount = useMemo(() => {
    if (!lastReadAt) return 0
    return messages.filter(m =>
      m.user_id !== currentUserId && m.created_at > lastReadAt
    ).length
  }, [messages, lastReadAt, currentUserId])

  return {
    users,
    userMap,
    messages,
    currentUser,
    currentUserId,
    setCurrentUserId,
    lastReadAt,
    onlineCount,
    unreadCount,
    loading,
    sending,
    send,
    markAllRead,
  }
}
