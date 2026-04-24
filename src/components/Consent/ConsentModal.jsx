import React, { useState, useEffect, useMemo } from 'react'
import QRCode from 'qrcode/lib/browser'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'

const SIGN_HOST = 'https://sign.blissme.ai'

function genToken() {
  const s = () => Math.random().toString(36).slice(2)
  return 'bc_' + (s() + s()).slice(0, 18)
}

/**
 * 동의서 요청 모달 — 작성 전용.
 * 프로세스:
 *  1) 템플릿 선택 (번들 가능)
 *  2) prefill (선택)
 *  3) 대상 태블릿(kiosk) 선택 → 전송 → 태블릿이 realtime으로 즉시 서명 UI 띄움
 *  4) 키오스크 없는 매장: "링크 복사/QR 보기"로 폴백 (고객 폰으로 QR 스캔)
 */
export default function ConsentModal({ cust, bizId, data, onClose }) {
  const [tpls, setTpls] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [prefill, setPrefill] = useState({})
  const [kioskId, setKioskId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // {token, url, qr, via:'kiosk'|'qr'}

  // 매장 등록 kiosks 목록 (businesses.settings.kiosks)
  const kiosks = useMemo(() => {
    try {
      const raw = (data?.businesses || [])[0]?.settings
      const st = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
      return Array.isArray(st.kiosks) ? st.kiosks : []
    } catch { return [] }
  }, [data?.businesses])

  // 모달 열릴 때 기본 kiosk: 현재 지점 매칭 or 첫 번째
  useEffect(() => {
    if (kiosks.length > 0 && !kioskId) setKioskId(kiosks[0].id)
  }, [kiosks])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    (async () => {
      try {
        const [t, f] = await Promise.all([
          fetch(`${SB_URL}/rest/v1/consent_templates?business_id=eq.${bizId}&is_active=eq.true&select=id,name,folder_id,orientation,sort&order=sort`, { headers: sbHeaders }).then(r => r.json()),
          fetch(`${SB_URL}/rest/v1/template_folders?business_id=eq.${bizId}&select=id,name,sort&order=sort`, { headers: sbHeaders }).then(r => r.json()),
        ])
        if (Array.isArray(t)) setTpls(t)
        if (Array.isArray(f)) setFolders(f)
      } catch (e) { console.error('[consent] templates load', e) }
    })()
  }, [bizId])

  const toggleTpl = id => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const send = async (via) => {
    if (selectedIds.length === 0) return alert('템플릿을 1개 이상 선택하세요.')
    if (via === 'kiosk' && !kioskId) return alert('대상 태블릿을 선택하세요.')
    setLoading(true)
    try {
      const token = genToken()
      const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const cleanPrefill = Object.fromEntries(Object.entries(prefill).filter(([_, v]) => v && String(v).trim() !== ''))
      await sb.insert('consent_tokens', {
        token,
        business_id: bizId,
        customer_id: cust.id,
        template_id: selectedIds[0],
        template_ids: selectedIds.length > 1 ? selectedIds : null,
        prefill_data: Object.keys(cleanPrefill).length ? cleanPrefill : null,
        expires_at,
        kiosk_id: via === 'kiosk' ? kioskId : null,
      })
      const url = `${SIGN_HOST}/?t=${token}`
      if (via === 'kiosk') {
        setResult({ token, url, via: 'kiosk' })
      } else {
        const qr = await QRCode.toDataURL(url, { width: 256, margin: 2 })
        setResult({ token, url, qr, via: 'qr' })
      }
    } catch (e) {
      console.error('[consent] send err', e)
      alert('전송 실패: ' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(result.url).then(() => alert('링크 복사됨')).catch(() => {})
  }

  const grouped = { _uncat: { name: '미분류', items: [] } }
  folders.forEach(f => { grouped[f.id] = { name: f.name, items: [] } })
  tpls.forEach(t => {
    const key = grouped[t.folder_id] ? t.folder_id : '_uncat'
    grouped[key].items.push(t)
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ width: 'min(540px, 95vw)', maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>📝 동의서 요청 · {cust?.name || ''}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: T.textMuted }}>×</button>
        </div>

        {/* 전송 결과 화면 */}
        {result && result.via === 'kiosk' && <div style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 14 }}>📲</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>태블릿으로 전송 완료</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>
            <b>{kiosks.find(k => k.id === kioskId)?.name || kioskId}</b> 태블릿에 서명 화면이 열렸습니다.<br />
            고객님께 태블릿을 전달해주세요.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>확인</button>
        </div>}

        {result && result.via === 'qr' && <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 12 }}>✅ 링크 생성</div>
          {result.qr && <img src={result.qr} alt="QR" style={{ width: 220, height: 220, border: '1px solid ' + T.border, borderRadius: 8, marginBottom: 12 }} />}
          <div style={{ fontSize: 11, color: T.textMuted, wordBreak: 'break-all', padding: '6px 10px', background: T.gray100, borderRadius: 6, marginBottom: 10 }}>{result.url}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={copyLink} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.gray200, color: T.text, border: 'none', borderRadius: 6, cursor: 'pointer' }}>📋 복사</button>
            <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.primary, color: '#fff', borderRadius: 6, textDecoration: 'none' }}>🖥 열기</a>
            <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: '#fff', color: T.textSub, border: '1px solid ' + T.border, borderRadius: 6, cursor: 'pointer' }}>닫기</button>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 10 }}>💡 24시간 이내 서명 안 하면 만료</div>
        </div>}

        {/* 작성 폼 */}
        {!result && <div style={{ padding: 16 }}>
          {tpls.length === 0 && <div style={{ textAlign: 'center', color: T.textMuted, padding: 30, fontSize: 13 }}>
            등록된 템플릿 없음.<br />
            <a href={`${SIGN_HOST}/?admin=1`} target="_blank" rel="noopener noreferrer" style={{ color: T.primary }}>관리자 편집기</a>에서 추가하세요.
          </div>}
          {Object.entries(grouped).map(([gid, g]) => g.items.length > 0 && (
            <div key={gid} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.textSub, marginBottom: 6 }}>📁 {g.name}</div>
              {g.items.map(t => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                  <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleTpl(t.id)} />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          ))}

          {tpls.length > 0 && <details style={{ marginTop: 10, marginBottom: 10, borderTop: '1px solid ' + T.border, paddingTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: T.textSub, fontWeight: 700 }}>▼ 거래 정보 (선택, prefill)</summary>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {[['points', '금액/포인트'], ['valid_from', '시작일'], ['valid_until', '종료일'], ['memo', '메모']].map(([k, lbl]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ width: 90, color: T.textSub }}>{lbl}</span>
                  <input value={prefill[k] || ''} onChange={e => setPrefill(p => ({ ...p, [k]: e.target.value }))}
                    style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 4 }} />
                </label>
              ))}
            </div>
          </details>}

          {/* 전송 방식 */}
          {tpls.length > 0 && <div style={{ marginTop: 14, padding: 12, background: T.gray100, borderRadius: 8 }}>
            {kiosks.length > 0 ? <>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>📲 대상 태블릿</div>
              <select value={kioskId} onChange={e => setKioskId(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 6, background: '#fff' }}>
                {kiosks.map(k => <option key={k.id} value={k.id}>{k.name || k.id}</option>)}
              </select>
              <button onClick={() => send('kiosk')} disabled={loading || selectedIds.length === 0}
                style={{ width: '100%', padding: '10px', marginTop: 10, fontSize: 14, fontWeight: 800, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: (selectedIds.length && !loading) ? 'pointer' : 'not-allowed', opacity: (selectedIds.length && !loading) ? 1 : .5 }}>
                {loading ? '전송중…' : `📲 태블릿으로 전송 (${selectedIds.length}건)`}
              </button>
              <button onClick={() => send('qr')} disabled={loading || selectedIds.length === 0}
                style={{ width: '100%', padding: '8px', marginTop: 6, fontSize: 12, fontWeight: 600, background: 'transparent', color: T.textSub, border: '1px dashed ' + T.border, borderRadius: 6, cursor: (selectedIds.length && !loading) ? 'pointer' : 'not-allowed', opacity: (selectedIds.length && !loading) ? 1 : .5 }}>
                QR/링크로 대신 받기 (폴백)
              </button>
            </> : <>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                등록된 태블릿(키오스크)이 없습니다.<br />
                관리설정에서 태블릿을 등록하거나, QR/링크로 고객 폰에 전송하세요.
              </div>
              <button onClick={() => send('qr')} disabled={loading || selectedIds.length === 0}
                style={{ width: '100%', padding: '10px', fontSize: 14, fontWeight: 800, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: (selectedIds.length && !loading) ? 'pointer' : 'not-allowed', opacity: (selectedIds.length && !loading) ? 1 : .5 }}>
                {loading ? '생성중…' : `🔗 QR 링크 생성 (${selectedIds.length}건)`}
              </button>
            </>}
          </div>}
        </div>}
      </div>
    </div>
  )
}
