import { useEffect } from 'react'
import { T } from '../../lib/constants'

export default function Modal({ open, onClose, title, children, width=480 }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(0,0,0,.45)', display:'flex',
      alignItems:'flex-end', justifyContent:'center',
    }} onClick={onClose}>
      <div style={{
        width:'100%', maxWidth:width,
        background:T.bgCard, borderRadius:`${T.radius.xl}px ${T.radius.xl}px 0 0`,
        maxHeight:'90dvh', overflow:'auto',
        paddingBottom:'env(safe-area-inset-bottom)',
      }} onClick={e => e.stopPropagation()}>
        {/* 핸들 */}
        <div style={{ display:'flex', justifyContent:'center', padding:'12px 0 4px' }}>
          <div style={{ width:40, height:4, borderRadius:2, background:T.gray300 }}/>
        </div>
        {/* 헤더 */}
        {title && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px 12px' }}>
            <span style={{ fontSize:T.fs.md, fontWeight:T.fw.bolder, color:T.text }}>{title}</span>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:T.textMuted, fontSize:20, lineHeight:1, padding:4 }}>×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
