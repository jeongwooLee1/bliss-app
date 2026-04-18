import React, { useCallback, useEffect, useRef, useState } from 'react'
import { T } from '../../lib/constants'

// 하단 입력창: auto-grow textarea + send 버튼
// 엔터 전송 (한국어 IME 조합 중엔 무시), Shift+Enter 줄바꿈
function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [composing, setComposing] = useState(false)
  const taRef = useRef(null)

  // auto-grow (1~5줄)
  const grow = useCallback(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, 110) // 최대 5줄
    el.style.height = h + 'px'
  }, [])

  useEffect(grow, [value, grow])

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSend?.(text)
    setValue('')
  }, [value, disabled, onSend])

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
        background: T.bg,
        border:`1px solid ${T.border}`,
        borderRadius: 10,
        padding:'6px 6px 6px 10px',
        transition:'border-color .1s',
      }}>
        <textarea
          ref={taRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKey}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder="메시지를 입력하세요…"
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
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || disabled}
          aria-label="전송"
          style={{
            width:26, height:26, borderRadius:'50%',
            border:'none', cursor: value.trim() && !disabled ? 'pointer' : 'default',
            background: value.trim() && !disabled ? T.primary : T.gray200,
            color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexShrink:0, transition:'background .1s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13"/>
            <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
      <div style={{fontSize:9, color:T.textMuted, marginTop:3, textAlign:'right', letterSpacing:.2}}>
        Enter 전송 · Shift+Enter 줄바꿈
      </div>
    </div>
  )
}

export default ChatInput
