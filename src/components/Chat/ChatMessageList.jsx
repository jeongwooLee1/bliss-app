import React, { useEffect, useMemo, useRef } from 'react'
import { T } from '../../lib/constants'
import ChatMessage, { fmtDateHeader } from './ChatMessage'

// 같은 날인지 비교 (YYYY-MM-DD)
function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

// 연속 발화 그룹핑 기준: 같은 사람 + 3분 이내
const GROUP_GAP_MS = 3 * 60 * 1000

// 날짜 구분선
function DateDivider({ iso }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:8, padding:`10px ${T.sp.md}px 4px`}}>
      <div style={{flex:1, height:1, background:T.border}}/>
      <span style={{fontSize:9, color:T.textMuted, fontWeight:T.fw.bold, letterSpacing:.3}}>
        {fmtDateHeader(iso)}
      </span>
      <div style={{flex:1, height:1, background:T.border}}/>
    </div>
  )
}

// 미읽 구분선
function UnreadDivider({ count }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:8, padding:`6px ${T.sp.md}px`}}>
      <div style={{flex:1, height:1, background:T.danger, opacity:.4}}/>
      <span style={{
        fontSize:9, color:T.danger, fontWeight:T.fw.bolder, letterSpacing:.3,
        textTransform:'uppercase',
      }}>
        새 메시지 {count}
      </span>
      <div style={{flex:1, height:1, background:T.danger, opacity:.4}}/>
    </div>
  )
}

// 빈 상태
function EmptyState() {
  return (
    <div style={{
      flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      padding:20, textAlign:'center', color:T.textMuted,
    }}>
      <div style={{fontSize:24, marginBottom:8}}>💬</div>
      <div style={{fontSize:T.fs.xs, color:T.textSub, fontWeight:T.fw.medium}}>아직 메시지가 없어요</div>
      <div style={{fontSize:T.fs.xxs, color:T.textMuted, marginTop:4}}>첫 메시지를 남겨보세요</div>
    </div>
  )
}

function ChatMessageList({ messages, userMap, currentUserId, lastReadAt, loading, scrollTrigger }) {
  const scrollRef = useRef(null)

  // 메시지 + 구분선 렌더 리스트 계산
  const items = useMemo(() => {
    const result = []
    let prevMsg = null
    let unreadInserted = false
    let unreadTotal = 0

    if (lastReadAt) {
      unreadTotal = messages.filter(m =>
        m.user_id !== currentUserId && m.created_at > lastReadAt
      ).length
    }

    messages.forEach((msg, i) => {
      // 날짜 구분선
      if (!prevMsg || !sameDay(prevMsg.created_at, msg.created_at)) {
        result.push({ type:'date', key:`d_${msg.id}`, iso: msg.created_at })
      }

      // 미읽 구분선 (본인 메시지 제외, lastReadAt 이후 첫 타인 메시지 위)
      if (
        !unreadInserted && lastReadAt &&
        msg.user_id !== currentUserId &&
        msg.created_at > lastReadAt &&
        unreadTotal > 0
      ) {
        result.push({ type:'unread', key:`u_${msg.id}`, count: unreadTotal })
        unreadInserted = true
      }

      // 그룹 헤더 표시 여부
      const sameSender = prevMsg && prevMsg.user_id === msg.user_id
      const within = prevMsg && (new Date(msg.created_at) - new Date(prevMsg.created_at) < GROUP_GAP_MS)
      const unreadBarJustInserted = unreadInserted && result[result.length-2]?.type === 'unread'
      const showHeader = !sameSender || !within || unreadBarJustInserted

      result.push({
        type:'msg', key: msg.id, msg, showHeader,
      })
      prevMsg = msg
    })
    return result
  }, [messages, userMap, currentUserId, lastReadAt])

  // 자동 스크롤 (하단) — 메시지 변경 시·초기 로드 시·펼치기 토글 시 항상 최신으로
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 펼치기 시 CSS transition(0.18s)으로 높이가 늘어나므로 여러 프레임 후에도 한 번 더 스크롤
    const r1 = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    const t1 = setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, 220)
    return () => { cancelAnimationFrame(r1); clearTimeout(t1) }
  }, [messages, loading, scrollTrigger])

  if (loading) {
    return (
      <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:T.textMuted, fontSize:T.fs.xs}}>
        불러오는 중…
      </div>
    )
  }

  if (!messages.length) return <EmptyState/>

  return (
    <div ref={scrollRef} style={{
      flex:1, overflowY:'auto', overflowX:'hidden',
      paddingTop:4, paddingBottom:4,
      scrollbarWidth:'thin',
    }}>
      {items.map(it => {
        if (it.type === 'date')   return <DateDivider   key={it.key} iso={it.iso}/>
        if (it.type === 'unread') return <UnreadDivider key={it.key} count={it.count}/>
        const user = userMap[it.msg.user_id]
        const isOwn = it.msg.user_id === currentUserId
        return (
          <ChatMessage
            key={it.key}
            msg={it.msg}
            user={user}
            isOwn={isOwn}
            showHeader={it.showHeader}
            pending={it.msg._pending}
          />
        )
      })}
    </div>
  )
}

export default ChatMessageList
