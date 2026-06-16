import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { _activeBizId } from '../../lib/db'
import { onRtPing, debounce } from '../../lib/rtPings'

// 사내 메신저 데이터 훅
// 유저: employees_v1(근무표 등록 직원) + maleRotation_v1
// 메시지: Supabase `team_chat_messages` 테이블 + Realtime

const LS_KEY = 'bliss_team_chat_user_id'
const LS_LAST_READ = 'bliss_team_chat_last_read_at'

// 근무표 branch key → 한글 지점 short
const BRANCH_LABEL = {
  gangnam:'강남', wangsimni:'왕십리', hongdae:'홍대', magok:'마곡',
  yongsan:'용산', jamsil:'잠실', wirye:'위례', cheonho:'천호',
}

export function useTeamChat() {
  const [users, setUsers] = useState([])
  const [messages, setMessages] = useState([])
  const [currentUserId, setCurrentUserIdState] = useState(null)
  const [lastReadAt, setLastReadAtState] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(LS_LAST_READ) : null
  )
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  // 직원 목록 로드
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!_activeBizId) return
      try {
        const [empRes, rotRes] = await Promise.all([
          supabase.from('schedule_data').select('value').eq('business_id', _activeBizId).eq('key', 'employees_v1').maybeSingle(),
          supabase.from('schedule_data').select('value').eq('business_id', _activeBizId).eq('key', 'maleRotation_v1').maybeSingle(),
        ])
        if (cancelled) return
        const parse = (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw
        const empList = Array.isArray(parse(empRes.data?.value)) ? parse(empRes.data?.value) : []
        const rotMap = parse(rotRes.data?.value) || {}
        const mapped = empList
          .filter(e => e?.active !== false)
          .map(e => ({
            id: e.id,
            name: (e.name || e.id || '').replace(/\(원장\)/g, '').trim(),
            branch: BRANCH_LABEL[e.branch] || e.branch || '',
            gender: e.gender || (rotMap[e.id]?.branches?.length ? 'M' : 'F'),
            online: false,
          }))
        setUsers(mapped)
        const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
        const validSaved = saved && mapped.some(u => u.id === saved) ? saved : (mapped[0]?.id || null)
        setCurrentUserIdState(validSaved)
      } catch (e) {
        console.error('[useTeamChat] employees load failed', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // 메시지 로드 + Realtime 구독
  useEffect(() => {
    if (!_activeBizId) { setLoading(false); return }
    const bizId = _activeBizId
    let cancelled = false
    const loadMsgs = async () => {
      try {
        const { data, error } = await supabase
          .from('team_chat_messages')
          .select('id,user_id,body,created_at,is_announce')
          .eq('business_id', bizId)
          .order('created_at', { ascending: true })
          .limit(500)
        if (cancelled) return
        if (error) {
          console.error('[useTeamChat] messages load failed', error)
        } else {
          setMessages(data || [])
        }
      } catch (e) {
        console.error('[useTeamChat] messages load err', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadMsgs()

    // 실시간(신호 테이블 rt_pings 경유): team_chat_messages 변경 신호 → 재조회(저용량 내부 채팅이라 전체 reload 안전, INSERT/DELETE 모두 반영).
    const debLoad = debounce(loadMsgs, 500)
    const off = onRtPing('team_chat_messages', debLoad)
    // 폴링 fallback (2분) — 신호 누락 대비
    const poll = setInterval(loadMsgs, 120_000)

    return () => {
      cancelled = true
      clearInterval(poll)
      try { off() } catch {}
    }
  }, [])

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

  // 메시지 전송 — 낙관적 업데이트 + DB insert
  // opts: { announce: boolean } — announce=true면 공지 메시지(전체 배너)
  const send = useCallback(async (body, opts = {}) => {
    const text = (body || '').trim()
    if (!text || !currentUserId) return
    if (!_activeBizId) return
    const isAnnounce = !!opts.announce
    setSending(true)
    const tempId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)
    const nowIso = new Date().toISOString()
    const optimistic = {
      id: tempId,
      user_id: currentUserId,
      body: text,
      created_at: nowIso,
      is_announce: isAnnounce,
      _pending: true,
    }
    setMessages(prev => [...prev, optimistic])
    try {
      const { data, error } = await supabase
        .from('team_chat_messages')
        .insert({ business_id: _activeBizId, user_id: currentUserId, body: text, is_announce: isAnnounce })
        .select('id,user_id,body,created_at,is_announce')
        .single()
      if (error) throw error
      // 서버 응답으로 낙관적 메시지 교체
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === tempId)
        if (idx < 0) {
          // 이미 Realtime으로 들어왔을 수 있음
          return prev.some(m => m.id === data.id) ? prev : [...prev, data]
        }
        const next = [...prev]
        next[idx] = { ...data, _pending: false }
        return next
      })
    } catch (e) {
      console.error('[useTeamChat] send failed', e)
      // 실패 표시
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, _failed: true, _pending: false } : m
      ))
    } finally {
      setSending(false)
    }
  }, [currentUserId])

  // 읽음 처리 (localStorage)
  const markAllRead = useCallback(() => {
    const iso = new Date().toISOString()
    setLastReadAtState(iso)
    if (typeof window !== 'undefined') localStorage.setItem(LS_LAST_READ, iso)
  }, [])

  // 온라인 사용자 수
  const onlineCount = useMemo(
    () => users.filter(u => u.online).length,
    [users]
  )

  // 미읽 수
  const unreadCount = useMemo(() => {
    if (!lastReadAt) return messages.filter(m => m.user_id !== currentUserId).length
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
