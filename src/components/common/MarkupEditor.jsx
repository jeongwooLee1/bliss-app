/**
 * MarkupEditor — 이미지 위에 간단한 마킹 툴
 * 도구: 펜(자유선) / 사각형 / 화살표 / 텍스트
 * 색상: 빨강/노랑/초록/파랑/검정/흰색
 * 굵기: 2/4/8/12
 * 기능: Undo / Clear / Save(base64 PNG)
 *
 * 사용:
 *   <MarkupEditor open imageSrc={base64} onSave={(newB64)=>{}} onClose={()=>{}}/>
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { T } from '../../lib/constants'

const COLORS = ['#EF4444', '#FBBF24', '#22C55E', '#3B82F6', '#111827', '#FFFFFF']
const WIDTHS = [2, 4, 8, 12]
const TOOLS = [
  { id: 'pen', label: '펜', icon: '✏️' },
  { id: 'rect', label: '사각형', icon: '▭' },
  { id: 'arrow', label: '화살표', icon: '➡' },
  { id: 'text', label: '글자', icon: 'T' },
]

export default function MarkupEditor({ open, imageSrc, onSave, onClose }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const wrapRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#EF4444')
  const [width, setWidth] = useState(4)
  const [shapes, setShapes] = useState([]) // 완료된 도형들
  const [drawing, setDrawing] = useState(null) // 현재 그리는 중
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [pendingText, setPendingText] = useState(null) // {x, y} — 텍스트 입력 대기

  // ESC 닫기
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape' && !e.isComposing) onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  // 이미지 로드 → 캔버스 크기 결정 (뷰포트 맞게 축소)
  useEffect(() => {
    if (!open || !imageSrc) return
    setShapes([])
    setDrawing(null)
    setPendingText(null)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      setImgSize({ w: iw, h: ih })
      // 캔버스 표시 크기: 뷰포트 80% 이내
      const maxW = Math.min(window.innerWidth * 0.85, 1200)
      const maxH = window.innerHeight * 0.65
      const scale = Math.min(maxW / iw, maxH / ih, 1)
      setCanvasSize({ w: Math.round(iw * scale), h: Math.round(ih * scale) })
    }
    img.src = imageSrc
  }, [open, imageSrc])

  // 좌표 변환: 화면 (클릭) → 이미지 원본 좌표 (저장은 원본 해상도로)
  const toImageCoord = useCallback((ev) => {
    const cv = canvasRef.current
    if (!cv || !imgSize.w) return { x: 0, y: 0 }
    const rect = cv.getBoundingClientRect()
    const isTouch = ev.touches?.length
    const clientX = isTouch ? ev.touches[0].clientX : ev.clientX
    const clientY = isTouch ? ev.touches[0].clientY : ev.clientY
    const sx = imgSize.w / rect.width
    const sy = imgSize.h / rect.height
    return {
      x: Math.round((clientX - rect.left) * sx),
      y: Math.round((clientY - rect.top) * sy),
    }
  }, [imgSize])

  // ─── 캔버스 렌더링 ──────────────────────────────────────────────
  const redraw = useCallback(() => {
    const cv = canvasRef.current
    const img = imgRef.current
    if (!cv || !img) return
    const ctx = cv.getContext('2d')
    cv.width = imgSize.w
    cv.height = imgSize.h
    ctx.clearRect(0, 0, imgSize.w, imgSize.h)
    ctx.drawImage(img, 0, 0, imgSize.w, imgSize.h)
    const all = drawing ? [...shapes, drawing] : shapes
    all.forEach(s => drawShape(ctx, s))
  }, [imgSize, shapes, drawing])

  useEffect(() => { redraw() }, [redraw])

  const drawShape = (ctx, s) => {
    ctx.save()
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (s.type === 'path' && s.points?.length > 1) {
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
    } else if (s.type === 'rect') {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2)
      const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1)
      ctx.strokeRect(x, y, w, h)
    } else if (s.type === 'arrow') {
      drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.width)
    } else if (s.type === 'text') {
      const sz = Math.max(16, s.width * 6)
      ctx.font = `bold ${sz}px -apple-system, "Pretendard", "Malgun Gothic", sans-serif`
      // 외곽선: 가독성을 위해 대비색 스트로크
      ctx.lineWidth = Math.max(3, sz * 0.15)
      ctx.strokeStyle = getContrast(s.color)
      ctx.strokeText(s.text, s.x, s.y)
      ctx.fillStyle = s.color
      ctx.fillText(s.text, s.x, s.y)
    }
    ctx.restore()
  }

  const drawArrow = (ctx, x1, y1, x2, y2, w) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(12, w * 4)
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6))
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }

  const getContrast = (c) => {
    const h = c.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#000' : '#fff'
  }

  // ─── 포인터 이벤트 ──────────────────────────────────────────────
  const onDown = (ev) => {
    ev.preventDefault()
    const p = toImageCoord(ev)
    if (tool === 'pen') {
      setDrawing({ type: 'path', points: [p], color, width })
    } else if (tool === 'rect') {
      setDrawing({ type: 'rect', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width })
    } else if (tool === 'arrow') {
      setDrawing({ type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width })
    } else if (tool === 'text') {
      setPendingText({ x: p.x, y: p.y, color, width })
    }
  }
  const onMove = (ev) => {
    if (!drawing) return
    ev.preventDefault()
    const p = toImageCoord(ev)
    if (drawing.type === 'path') {
      setDrawing({ ...drawing, points: [...drawing.points, p] })
    } else if (drawing.type === 'rect' || drawing.type === 'arrow') {
      setDrawing({ ...drawing, x2: p.x, y2: p.y })
    }
  }
  const onUp = () => {
    if (!drawing) return
    // 너무 짧은 경우 버림
    if (drawing.type === 'rect' || drawing.type === 'arrow') {
      const d = Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1)
      if (d < 5) { setDrawing(null); return }
    }
    if (drawing.type === 'path' && drawing.points.length < 2) { setDrawing(null); return }
    setShapes(s => [...s, drawing])
    setDrawing(null)
  }

  // ─── 텍스트 입력 ────────────────────────────────────────────────
  const confirmText = (text) => {
    if (!pendingText) return
    const t = (text || '').trim()
    if (t) {
      const sz = Math.max(16, pendingText.width * 6)
      setShapes(s => [...s, {
        type: 'text', x: pendingText.x, y: pendingText.y + sz * 0.8,
        text: t, color: pendingText.color, width: pendingText.width,
      }])
    }
    setPendingText(null)
  }

  // ─── 액션 ──────────────────────────────────────────────────────
  const undo = () => setShapes(s => s.slice(0, -1))
  const clearAll = () => { if (confirm('전부 지울까요?')) setShapes([]) }

  const save = () => {
    const cv = canvasRef.current
    if (!cv) return
    try {
      const dataUrl = cv.toDataURL('image/png', 0.92)
      onSave?.(dataUrl)
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
  }

  if (!open) return null

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.75)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div style={{
        background: T.bgCard, borderRadius: T.radius.lg,
        maxWidth: '95vw', maxHeight: '95vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* 헤더 */}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid ' + T.border }}>
          <div style={{ fontSize: T.fs.md, fontWeight: T.fw.black, color: T.text, flex: 1 }}>✏️ 이미지 마킹</div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, padding: 0, width: 32, height: 32 }}>×</button>
        </div>

        {/* 툴바 */}
        <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', borderBottom: '1px solid ' + T.border, background: T.gray100 }}>
          {/* 도구 */}
          <div style={{ display: 'flex', gap: 4 }}>
            {TOOLS.map(t => (
              <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
                style={{
                  padding: '6px 10px', borderRadius: 6, border: 'none',
                  background: tool === t.id ? T.primary : T.bgCard,
                  color: tool === t.id ? '#fff' : T.text,
                  fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  minWidth: 40,
                }}>
                {t.icon}
              </button>
            ))}
          </div>

          {/* 색상 */}
          <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid ' + T.border, paddingLeft: 10 }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} title={c}
                style={{
                  width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                  background: c, border: color === c ? '3px solid ' + T.primary : '2px solid ' + T.border,
                  padding: 0, fontFamily: 'inherit',
                }}/>
            ))}
          </div>

          {/* 굵기 */}
          <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid ' + T.border, paddingLeft: 10 }}>
            {WIDTHS.map(w => (
              <button key={w} onClick={() => setWidth(w)} title={`굵기 ${w}`}
                style={{
                  width: 32, height: 28, borderRadius: 6, cursor: 'pointer',
                  background: width === w ? T.primary : T.bgCard,
                  border: '1px solid ' + T.border,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, fontFamily: 'inherit',
                }}>
                <div style={{ width: Math.min(24, w * 2), height: w, background: width === w ? '#fff' : T.text, borderRadius: w / 2 }}/>
              </button>
            ))}
          </div>

          {/* 액션 */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', borderLeft: '1px solid ' + T.border, paddingLeft: 10 }}>
            <button onClick={undo} disabled={!shapes.length}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bgCard, color: shapes.length ? T.text : T.textMuted, cursor: shapes.length ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>↶ Undo</button>
            <button onClick={clearAll} disabled={!shapes.length}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid ' + T.danger, background: '#fff', color: T.danger, cursor: shapes.length ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', opacity: shapes.length ? 1 : 0.5 }}>전부 지움</button>
          </div>
        </div>

        {/* 캔버스 */}
        <div ref={wrapRef} style={{ padding: 16, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', flex: 1, minHeight: 200, position: 'relative' }}>
          {canvasSize.w > 0 && (
            <canvas
              ref={canvasRef}
              width={imgSize.w}
              height={imgSize.h}
              style={{
                width: canvasSize.w, height: canvasSize.h,
                cursor: tool === 'text' ? 'text' : 'crosshair',
                background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                touchAction: 'none', userSelect: 'none',
              }}
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
              onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
            />
          )}
          {/* 텍스트 입력 프롬프트 */}
          {pendingText && (
            <TextPrompt onConfirm={confirmText} onCancel={() => setPendingText(null)}/>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid ' + T.border }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
          <button onClick={save}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: T.primary, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💾 저장</button>
        </div>
      </div>
    </div>
  )
}

// 텍스트 입력 inline prompt (캔버스 위에 작게 뜸)
function TextPrompt({ onConfirm, onCancel }) {
  const [text, setText] = useState('')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', background: T.bgCard, padding: 12, borderRadius: T.radius.md, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', border: '2px solid ' + T.primary, zIndex: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>텍스트 입력</div>
      <input ref={ref} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.isComposing) onConfirm(text); if (e.key === 'Escape') onCancel() }}
        placeholder="입력 후 Enter" autoFocus
        style={{ width: 240, padding: '6px 10px', fontSize: 14, border: '1px solid ' + T.border, borderRadius: 6, fontFamily: 'inherit', outline: 'none' }}/>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid ' + T.border, background: '#fff', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
        <button onClick={() => onConfirm(text)} disabled={!text.trim()}
          style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: text.trim() ? T.primary : T.gray300, color: '#fff', fontSize: 11, cursor: text.trim() ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 700 }}>추가</button>
      </div>
    </div>
  )
}
