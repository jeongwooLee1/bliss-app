import React, { useEffect, useState } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'

// 한 고객의 동의서·차트를 이미지로 보여주는 뷰어 (키오스크와 동일 UX).
// - customer_consents를 customer_id로 조회 → PDF를 pdfjs로 렌더해 <img>로 표시
// - 문서가 여러 개면 탭으로 한 건씩 (활성 문서만 lazy 렌더 → 처음 로딩 빠름)
// - 에러 시 PDF 링크 fallback

let _pdfjs = null
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs
  const lib = await import('pdfjs-dist')
  // Vite: bare 스펙은 new URL()로 해석 안 됨 → ?url import로 워커 경로 확보 (aiDocs.js와 동일)
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  lib.GlobalWorkerOptions.workerSrc = workerUrl
  _pdfjs = lib
  return lib
}
// 목표 렌더 폭(px) — 폭 기준 적응형 scale로 글자 가독성 확보(페이지 크기 무관 일정).
const TARGET_W = 1400
// 한 캔버스(밴드)의 최대 높이 — 신규차트처럼 초장신(5000pt+) 단일 페이지를 세로로 잘라
// 정상 작동하는 일반 페이지와 같은 크기 등급으로 렌더(거대 단일 캔버스 렌더 실패 방지).
const BAND_H = 2200
const RENDER_TIMEOUT = 15000 // 페이지 렌더가 멈추면 PDF 링크 fallback (무한 로딩 방지)
const withTimeout = (promise, ms, task) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => { try { task?.cancel() } catch {} rej(new Error('render timeout')) }, ms)),
])
async function renderPdfToImages(url) {
  const pdfjsLib = await loadPdfjs()
  const buf = await (await fetch(url)).arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const imgs = []
  const pages = Math.min(pdf.numPages, 4)
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p)
    // 폭 기준 적응형 scale (글자 가독성). 높이는 밴드로 분할하므로 줄이지 않음.
    const base = page.getViewport({ scale: 1 })
    const scale = Math.max(0.8, Math.min(TARGET_W / base.width, 2.2))
    const vp = page.getViewport({ scale })
    const W = Math.ceil(vp.width)
    const H = Math.ceil(vp.height)
    // 세로 BAND_H 단위로 분할 렌더. 각 밴드는 W×bandH(작은 캔버스) → 초장신 페이지도 안정.
    // pdfjs 밴딩 레시피: transform [1,0,0,1,0,-top] 으로 해당 밴드만 캔버스에 그림.
    for (let top = 0; top < H; top += BAND_H) {
      const bandH = Math.min(BAND_H, H - top)
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = bandH
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, bandH)
      // 키오스크(검증됨)와 동일 — pdfjs 5.7은 canvasContext로 줘야 렌더 완료됨.
      const task = page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, 0, -top] })
      await withTimeout(task.promise, RENDER_TIMEOUT, task)
      imgs.push(canvas.toDataURL('image/jpeg', 0.74))
    }
  }
  return imgs
}

// 탭에 쓸 짧은 이름
const shortName = (n) => {
  const s = String(n || '').replace('체크리스트', '').replace('동의서', '').replace('사전상담지', ' 상담').trim()
  return s || (n || '문서')
}
const fmtDate = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

export default function ConsentDocsViewer({ customerId, customerName, focusConsentId, onClose }) {
  const [docs, setDocs] = useState(null)
  const [active, setActive] = useState(0)
  const [cache, setCache] = useState({}) // docId -> images[] | 'loading' | 'error'
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!customerId) { setDocs([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(
          `${SB_URL}/rest/v1/customer_consents?customer_id=eq.${customerId}&select=id,template_name,signer_name,signed_at,document_url&order=signed_at.desc&limit=8`,
          { headers: sbHeaders }
        ).then(r => r.json())
        if (cancelled) return
        const list = Array.isArray(r) ? r : []
        setDocs(list)
        // 이 예약의 차트(focusConsentId)를 기본 선택
        const idx = focusConsentId ? list.findIndex(d => d.id === focusConsentId) : -1
        setActive(idx >= 0 ? idx : 0)
      } catch (e) {
        if (!cancelled) setErr(e?.message || '불러오기 실패')
      }
    })()
    return () => { cancelled = true }
  }, [customerId, focusConsentId])

  // 활성 문서만 렌더 (lazy)
  useEffect(() => {
    if (!docs || !docs[active]) return
    const d = docs[active]
    if (cache[d.id]) return
    let cancelled = false
    setCache((p) => ({ ...p, [d.id]: 'loading' }))
    ;(async () => {
      let imgs
      try { imgs = d.document_url ? await renderPdfToImages(d.document_url) : 'error' }
      catch { imgs = 'error' }
      if (!cancelled) setCache((p) => ({ ...p, [d.id]: imgs }))
    })()
    return () => { cancelled = true }
  }, [docs, active])

  const cur = docs && docs[active]
  const curImgs = cur ? cache[cur.id] : null

  return (
    <div onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: '100dvh', zIndex: 9500,
      background: 'rgba(20,18,40,.55)', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 'min(940px, 96vw)', height: '92dvh', maxHeight: '92dvh', background: '#fff', borderRadius: 18,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,.3)',
      }}>
        {/* 헤더 */}
        <div style={{ padding: '15px 16px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: T.textSub, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                <I name="fileText" size={12} color={T.primary} />동의서 · 차트
              </div>
              <div style={{ fontSize: 19, fontWeight: 800, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {customerName || ''}
              </div>
            </div>
            <button type="button" onClick={onClose} style={{
              flexShrink: 0, padding: '9px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              background: T.gray200, color: T.textSub, border: 'none', borderRadius: 10, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}><I name="x" size={14} />닫기</button>
          </div>
          {docs && docs.length > 1 && (
            <div style={{ display: 'flex', gap: 6, margin: '13px 0 0', overflowX: 'auto', paddingBottom: 12, borderBottom: '1px solid ' + T.border }}>
              {docs.map((d, i) => (
                <button key={d.id} type="button" onClick={() => setActive(i)} style={{
                  flexShrink: 0, padding: '8px 15px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', borderRadius: 999,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  background: i === active ? T.primary : '#fff',
                  color: i === active ? '#fff' : T.textSub,
                  border: '1px solid ' + (i === active ? T.primary : T.border),
                }}>{shortName(d.template_name)}</button>
              ))}
            </div>
          )}
        </div>

        {/* 문서 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#edecf3', padding: '14px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
          {err && <div style={{ color: T.danger, fontSize: 14, padding: 16, textAlign: 'center' }}>불러오기 오류: {err}</div>}
          {!docs && !err && <div style={{ color: T.textSub, fontSize: 14, textAlign: 'center', padding: 30 }}>불러오는 중…</div>}
          {docs && docs.length === 0 && <div style={{ color: T.textSub, fontSize: 14, textAlign: 'center', padding: 30 }}>작성된 동의서·차트가 없습니다.</div>}
          {cur && (
            <div style={{ maxWidth: 860, margin: '0 auto' }}>
              <div style={{ fontSize: 12, color: T.textSub, fontWeight: 600, margin: '0 2px 8px' }}>
                {cur.template_name}{cur.signer_name ? ' · ' + cur.signer_name : ''} · {fmtDate(cur.signed_at)}
              </div>
              {(curImgs === 'loading' || curImgs == null) && (
                <div style={{ color: T.textSub, fontSize: 13, textAlign: 'center', padding: '44px 0', background: '#fff', borderRadius: 12, border: '1px solid ' + T.border }}>
                  문서 불러오는 중…
                </div>
              )}
              {curImgs === 'error' && (
                cur.document_url
                  ? <a href={cur.document_url} target="_blank" rel="noreferrer" style={{
                      display: 'block', textAlign: 'center', padding: 16, background: '#fff', borderRadius: 12,
                      border: '1px solid ' + T.border, color: T.primary, fontWeight: 700, textDecoration: 'none',
                    }}>📄 PDF 새 창에서 열기</a>
                  : <div style={{ color: T.textSub, fontSize: 13, textAlign: 'center', padding: 20 }}>이미지로 표시할 문서가 없습니다.</div>
              )}
              {Array.isArray(curImgs) && curImgs.map((src, i) => (
                <img key={i} src={src} alt="" style={{
                  width: '100%', display: 'block', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,.1)',
                  marginBottom: 10, background: '#fff',
                }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
