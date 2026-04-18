import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOCK_MESSAGES, MOCK_LAST_READ_AT } from './mockData'
import { supabase } from '../../lib/supabase'

// 사내 메신저 데이터 훅
// 현재: 유저는 employees_v1(근무표 등록 직원)에서 로드, 메시지는 mock.
// 향후 Supabase `team_chat_messages` 테이블 + Realtime으로 메시지도 교체.

const LS_KEY = 'bliss_team_chat_user_id'

// 근무표 branch key → 한글 지점 short
const BRANCH_LABEL = {
  gangnam:'강남', wangsimni:'왕십리', hongdae:'홍대', magok:'마곡',
  yongsan:'용산', jamsil:'잠실', wirye:'위례', cheonho:'천호',
}

export function useTeamChat({ mock = true } = {}) {
  const [users, setUsers] = useState([])
  const [messages, setMessages] = useState([])
  const [currentUserId, setCurrentUserIdState] = useState(null)
  const [lastReadAt, setLastReadAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const idCounter = useRef(1000)

  // employees_v1 + maleRotation_v1 → chat users
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [empRes, rotRes] = await Promise.all([
          supabase.from('schedule_data').select('value').eq('key', 'employees_v1').single(),
          supabase.from('schedule_data').select('value').eq('key', 'maleRotation_v1').single(),
        ])
        if (cancelled) return
        const rawEmp = empRes.data?.value
        const rawRot = rotRes.data?.value
        const empList = typeof rawEmp === 'string' ? JSON.parse(rawEmp) : (Array.isArray(rawEmp) ? rawEmp : [])
        const rotMap = typeof rawRot === 'string' ? JSON.parse(rawRot) : (rawRot || {})
        const mapped = empList
          .filter(e => e?.active !== false)
          .map(e => ({
            id: e.id,
            name: (e.name || e.id || '').replace(/\(원장\)/g, '').trim(),
            branch: BRANCH_LABEL[e.branch] || e.branch || '',
            gender: rotMap[e.id]?.branches?.length ? 'M' : 'F',
            online: false,
          }))
        setUsers(mapped)
        const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
        const validSaved = saved && mapped.some(u => u.id === saved) ? saved : (mapped[0]?.id || null)
        setCurrentUserIdState(validSaved)
        if (mock) {
          setMessages(MOCK_MESSAGES)
          setLastReadAt(MOCK_LAST_READ_AT)
        }
      } catch (e) {
        console.error('[useTeamChat] employees load failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
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
