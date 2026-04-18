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

// 아바타: 이름 첫 글자, 성별 색
function Avatar({ user, size = 26 }) {
  const bg = user?.gender === 'M' ? T.maleLt : user?.gender === 'F' ? T.femaleLt : '#e5e8eb'
  const fg = user?.gender === 'M' ? T.male   : user?.gender === 'F' ? T.female   : T.textSub
  const initial = (user?.name || '?').slice(0,1)
  return (
    <div style={{
      width:size, height:size, borderRadius:'50%',
      background:bg, color:fg,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize: size>=22 ? 11 : 10, fontWeight:T.fw.bolder,
      flexShrink:0, userSelect:'none',
    }}>{initial}</div>
  )
}

// 개별 메시지 row
function ChatMessage({ msg, user, isOwn, showHeader, showAvatar, pending }) {
  const [hover, setHover] = useState(false)
  const time = fmtTime(msg.created_at)

  return (
    <div
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        display:'flex', gap:8,
        padding: showHeader ? `4px ${T.sp.md}px 2px` : `1px ${T.sp.md}px`,
        alignItems:'flex-start',
        background: hover ? '#f7f7fa' : 'transparent',
        transition:'background .1s',
      }}
    >
      {/* 아바타 영역 (32px 고정) */}
      <div style={{width:26, flexShrink:0, display:'flex', justifyContent:'center', paddingTop: showHeader ? 2 : 0}}>
        {showAvatar ? <Avatar user={user} /> : (
          <span style={{
            fontSize:9, color:T.textMuted, opacity: hover ? 1 : 0, transition:'opacity .1s',
            fontVariantNumeric:'tabular-nums', paddingTop:4, userSelect:'none',
          }}>{time}</span>
        )}
      </div>

      {/* 본문 영역 */}
      <div style={{flex:1, minWidth:0}}>
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
      </div>
    </div>
  )
}

export default ChatMessage
