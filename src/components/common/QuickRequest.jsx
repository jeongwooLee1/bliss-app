import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import { uploadImageToStorage } from '../../lib/supabase'

// 우클릭 → "수정 요청" → 현재 화면 캡처 + 내용 입력 → bliss_requests_v1 바로 등록.
// 캡처는 html2canvas(트리거 시 동적 로드). 입력칸/textarea 위에선 기본 우클릭(붙여넣기 등) 유지.
export default function QuickRequest({ currentUser, userBranches }) {
  const [menu, setMenu] = useState(null)   // {x,y}
  const [stage, setStage] = useState(null) // 'capturing' | 'form' | 'done'
  const [img, setImg] = useState(null)
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const onCtx = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return // 입력칸은 기본 메뉴 유지
      if (e.target?.closest?.('[data-quickreq="1"]')) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('contextmenu', onCtx)
    const onEsc = (e) => { if (e.key === 'Escape') { setMenu(null); if (stage === 'form' || stage === 'capturing') setStage(null) } }
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('contextmenu', onCtx); window.removeEventListener('keydown', onEsc) }
  }, [stage])

  const startCapture = useCallback(async () => {
    setMenu(null); setStage('capturing'); setMsg(''); setDesc(''); setImg(null)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(document.body, {
        backgroundColor: '#ffffff',
        scale: Math.min(1.5, window.devicePixelRatio || 1),
        useCORS: true, logging: false,
        x: window.scrollX, y: window.scrollY,
        width: window.innerWidth, height: window.innerHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        ignoreElements: (el) => el?.getAttribute && el.getAttribute('data-quickreq') === '1',
      })
      setImg(canvas.toDataURL('image/jpeg', 0.82))
      setStage('form')
    } catch (e) {
      console.warn('[quickreq capture]', e)
      setStage('form'); setMsg('화면 캡처는 실패했지만, 내용만으로 등록할 수 있어요.')
    }
  }, [])

  const submit = async () => {
    if (!desc.trim()) { setMsg('내용을 입력하세요'); return }
    setBusy(true); setMsg('')
    try {
      let imgUrl = ''
      if (img) { try { imgUrl = await uploadImageToStorage(img, 'requests') } catch { imgUrl = '' } }
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.bliss_requests_v1&select=value`, { headers: sbHeaders })
      const rows = await r.json()
      let list = []
      try { const v = rows?.[0]?.value; list = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : []) } catch {}
      const row = {
        id: genId(), name: currentUser?.name || '직원',
        branchId: userBranches?.[0] || '', description: desc.trim(),
        images: imgUrl ? [imgUrl] : [], status: 'pending', reply: '',
        createdAt: new Date().toISOString(), page: location.pathname,
      }
      await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ business_id: _activeBizId, id: 'bliss_requests_v1', key: 'bliss_requests_v1', value: JSON.stringify([row, ...list]) }),
      })
      setStage('done'); setImg(null); setDesc('')
      setTimeout(() => setStage(s => s === 'done' ? null : s), 2000)
    } catch (e) { setMsg('등록 실패: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }

  return <>
    {menu && createPortal(
      <div data-quickreq="1">
        <div onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} style={{ position: 'fixed', inset: 0, zIndex: 99998 }} />
        <div style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 56), zIndex: 99999, background: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.22)', padding: 5, minWidth: 170 }}>
        <button onClick={startCapture} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: 'none', background: 'transparent', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#5B21B6', fontFamily: 'inherit' }}
          onMouseOver={e => e.currentTarget.style.background = '#F5F3FF'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
          📝 수정 요청 (화면 캡처)
        </button>
        </div>
      </div>, document.body)}

    {stage === 'capturing' && createPortal(
      <div data-quickreq="1" style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.15)', color: '#fff', fontWeight: 700, fontSize: 14 }}>
        <span style={{ background: 'rgba(0,0,0,.6)', padding: '8px 16px', borderRadius: 20 }}>화면 캡처 중…</span>
      </div>, document.body)}

    {stage === 'form' && createPortal(
      <div data-quickreq="1" style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => !busy && setStage(null)}>
        <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px,96vw)', maxHeight: '92vh', overflow: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,.3)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>📝 수정 요청</span>
            <button onClick={() => setStage(null)} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: T.textMuted }}>×</button>
          </div>
          <div style={{ padding: 16 }}>
            {img && <img src={img} alt="현재 화면" style={{ width: '100%', borderRadius: 8, border: '1px solid ' + T.border, marginBottom: 10, maxHeight: 280, objectFit: 'contain', background: '#fafafa' }} />}
            <textarea autoFocus value={desc} onChange={e => setDesc(e.target.value)} placeholder="무엇을 수정/개선하면 좋을지 적어주세요 (이 화면이 같이 첨부돼요)"
              style={{ width: '100%', minHeight: 110, padding: '10px 12px', fontSize: 14, border: '1.5px solid ' + T.border, borderRadius: 8, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, outline: 'none' }} />
            {msg && <div style={{ fontSize: 12, color: T.danger, marginTop: 6, fontWeight: 600 }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setStage(null)} disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
              <button onClick={submit} disabled={busy || !desc.trim()} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#7C3AED', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: (busy || !desc.trim()) ? .6 : 1 }}>{busy ? '등록 중…' : '수정요청 등록'}</button>
            </div>
          </div>
        </div>
      </div>, document.body)}

    {stage === 'done' && createPortal(
      <div data-quickreq="1" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 99999, background: '#10b981', color: '#fff', padding: '10px 20px', borderRadius: 24, fontSize: 13, fontWeight: 700, boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>✓ 수정요청이 등록됐어요</div>, document.body)}
  </>
}
