import React, { useState } from 'react'
import { T } from '../../lib/constants'

// 시간 포맷 — HH:MM
function fmtTime(iso) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// 날짜 구분선용 포맷 — "4월 18일 (금)"
export function fmtDateHeader(iso) {
  const d = new Date(iso)
  const days = ['일','월','화','수','목','금','토']
  return `${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

// 개별 메시지 row
function ChatMessage({ msg, user, isOwn, showHeader, pending }) {
  const [hover, setHover] = useState(false)
  const time = fmtTime(msg.created_at)

  return (
    <div
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        position:'relative',
        padding: showHeader ? `4px ${T.sp.md}px 2px` : `1px ${T.sp.md}px 1px 42px`,
        background: hover ? '#f7f7fa' : 'transparent',
        transition:'background .1s',
      }}
    >
      {showHeader && (
        <div style={{display:'flex', alignItems:'baseline', gap:6, marginBottom:1, flexWrap:'nowrap'}}>
          <span style={{
            fontSize:T.fs.xs, fontWeight:T.fw.bolder,
            color: isOwn ? T.primaryDk : T.text,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'70%',
          }}>{user?.name || '?'}</span>
          {user?.branch && (
            <span style={{
              fontSize:9, color:T.textMuted, fontWeight:T.fw.medium,
              padding:'1px 4px', background:T.gray100, borderRadius:3,
              whiteSpace:'nowrap',
            }}>{user.branch}</span>
          )}
          <span style={{fontSize:9, color:T.textMuted, marginLeft:'auto', fontVariantNumeric:'tabular-nums', flexShrink:0}}>
            {time}
          </span>
        </div>
      )}
      <div style={{
        fontSize:T.fs.xs, color: pending ? T.textMuted : T.text,
        lineHeight:1.5, wordBreak:'break-word', whiteSpace:'pre-wrap',
      }}>{msg.body}</div>
      {!showHeader && (
        <span style={{
          position:'absolute', left:8, top:2,
          fontSize:9, color:T.textMuted, opacity: hover ? 1 : 0, transition:'opacity .1s',
          fontVariantNumeric:'tabular-nums', userSelect:'none',
        }}>{time}</span>
      )}
    </div>
  )
}

export default ChatMessage
