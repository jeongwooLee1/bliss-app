import React, { useEffect, useRef, useState } from 'react'
import { T } from '../../lib/constants'

// 이름 선택 드롭다운
// 컴퓨터마다 localStorage로 저장. 공용 PC에서 직원별 전환 가능.
function UserPicker({ users, currentUser, onSelect }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const color = currentUser?.gender === 'M' ? T.male : currentUser?.gender === 'F' ? T.female : T.textSub
  const bg    = currentUser?.gender === 'M' ? T.maleLt : currentUser?.gender === 'F' ? T.femaleLt : T.gray100

  return (
    <div ref={wrapRef} style={{position:'relative', minWidth:0, flex:1}}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display:'flex', alignItems:'center', gap:5,
          background: bg, color,
          border:'none', cursor:'pointer',
          padding:'3px 7px 3px 4px',
          borderRadius: 999,
          fontFamily:'inherit', fontSize:T.fs.xs, fontWeight:T.fw.bolder,
          maxWidth:'100%',
          transition:'background .1s',
        }}
      >
        {/* 아바타 */}
        <span style={{
          width:18, height:18, borderRadius:'50%',
          background: '#fff',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:10, color, fontWeight:T.fw.black, flexShrink:0,
        }}>
          {(currentUser?.name || '?').slice(0,1)}
        </span>
        <span style={{
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          maxWidth:'100%',
        }}>
          {currentUser?.name || '이름 선택'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0, opacity:.7}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0,
          minWidth: 170, maxHeight: 260, overflowY:'auto',
          background: T.bgCard,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius.md,
          boxShadow: T.shadow.md,
          zIndex: 100,
          padding: 4,
        }}>
          <div style={{
            fontSize: 9, color: T.textMuted, fontWeight: T.fw.bolder,
            padding:'6px 8px 4px', letterSpacing:.3, textTransform:'uppercase',
          }}>내 이름 선택</div>
          {users.map(u => {
            const active = u.id === currentUser?.id
            const uc = u.gender === 'M' ? T.male : u.gender === 'F' ? T.female : T.textSub
            const ub = u.gender === 'M' ? T.maleLt : u.gender === 'F' ? T.femaleLt : T.gray100
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => { onSelect(u.id); setOpen(false) }}
                style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%',
                  padding:'7px 8px',
                  border:'none', cursor:'pointer',
                  background: active ? T.primaryLt : 'transparent',
                  fontFamily:'inherit', fontSize:T.fs.xs,
                  color: active ? T.primaryDk : T.text,
                  fontWeight: active ? T.fw.bolder : T.fw.medium,
                  borderRadius: 6,
                  textAlign:'left',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.gray100 }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{
                  width:22, height:22, borderRadius:'50%',
                  background: ub, color: uc,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:10, fontWeight:T.fw.black, flexShrink:0,
                }}>{u.name.slice(0,1)}</span>
                <span style={{flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {u.name}
                </span>
                {u.branch && (
                  <span style={{
                    fontSize:9, color:T.textMuted, fontWeight:T.fw.medium,
                    padding:'1px 5px', background: active ? '#fff' : T.gray100, borderRadius:3,
                    flexShrink:0,
                  }}>{u.branch}</span>
                )}
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 상단 헤더: 채팅방 타이틀 + 이름 선택 + 접속자 수
function ChatHeader({ users = [], currentUser, onSelectUser, onlineCount = 0 }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8,
      padding:`8px ${T.sp.md}px`, borderBottom:`1px solid ${T.border}`,
      background: T.bgCard, flexShrink:0,
    }}>
      <span style={{color:T.textSub, fontSize:T.fs.md, fontWeight:T.fw.bolder, flexShrink:0, lineHeight:1}}>#</span>
      <UserPicker users={users} currentUser={currentUser} onSelect={onSelectUser} />
      <div style={{display:'flex', alignItems:'center', gap:3, flexShrink:0}}>
        <span style={{
          width:6, height:6, borderRadius:'50%',
          background:'#22c55e',
          boxShadow:'0 0 0 2px rgba(34,197,94,0.15)',
        }}/>
        <span style={{fontSize:T.fs.xxs, color:T.textSub, fontWeight:T.fw.medium, fontVariantNumeric:'tabular-nums'}}>
          {onlineCount}
        </span>
      </div>
    </div>
  )
}

export default ChatHeader
