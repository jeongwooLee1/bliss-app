import React, { useCallback, useEffect, useRef, useState } from 'react'
import { T } from '../../lib/constants'

// 하단 입력창: auto-grow textarea + send 버튼 + 확성기(공지) 토글
// 엔터 전송 (한국어 IME 조합 중엔 무시), Shift+Enter 줄바꿈
function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [composing, setComposing] = useState(false)
  const [announce, setAnnounce] = useState(false)
  const taRef = useRef(null)

  const grow = useCallback(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, 110)
    el.style.height = h + 'px'
  }, [])

  useEffect(grow, [value, grow])

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSend?.(text, { announce })
    setValue('')
    setAnnounce(false)
  }, [value, disabled, onSend, announce])

  const onKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }, [submit, composing])

  return (
    <div style={{
      borderTop:`1px solid ${T.border}`,
      padding:`8px ${T.sp.md}px`,
      background: T.bgCard,
      flexShrink:0,
    }}>
      <div style={{
        display:'flex', alignItems:'flex-end', gap:6,
        background: announce ? '#fff8e1' : T.bg,
        border:`1px solid ${announce ? '#ff9800' : T.border}`,
        borderRadius: 10,
        padding:'6px 6px 6px 10px',
        transition:'all .15s',
      }}>
        <button
          type="button"
          onClick={() => setAnnounce(v => !v)}
          disabled={disabled}
          title={announce ? '공지 끄기' : '공지로 전송 (전체 화면 배너)'}
          aria-label="공지 토글"
          style={{
            width:26, height:26, borderRadius:'50%',
            border: announce ? '2px solid #ff9800' : `1px solid ${T.border}`,
            cursor: disabled ? 'default' : 'pointer',
            background: announce ? '#ff9800' : T.bgCard,
            color: announce ? '#fff' : T.textSub,
            display:'flex', alignItems:'center', justifyContent:'center',
            flexShrink:0, padding:0, alignSelf:'center',
            transition:'all .15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11v3a1 1 0 0 0 1 1h9l5 3V7l-5 3H4a1 1 0 0 0-1 1z"/>
            <path d="M11 7v10"/>
          </svg>
        </button>
        <textarea
          ref={taRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKey}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder=""
          rows={1}
          disabled={disabled}
          style={{
            flex:1, border:'none', outline:'none', resize:'none',
            background:'transparent',
            fontFamily:'inherit', fontSize:T.fs.xs, lineHeight:1.5,
            color:T.text,
            minHeight: 18, maxHeight: 110,
            padding: '3px 0',
          }}
        />
      </div>
      {announce && <div style={{fontSize:9, color: '#e65100', marginTop:3, textAlign:'right', letterSpacing:.2, fontWeight: 700}}>
        📣 공지 모드 — 전체 화면 배너로 발송됨
      </div>}
    </div>
  )
}

export default ChatInput
