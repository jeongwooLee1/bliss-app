import React, { useState, useEffect } from 'react'
import QRCode from 'qrcode/lib/browser'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'

const SIGN_HOST = 'https://sign.blissme.ai'

function genToken() {
  const s = () => Math.random().toString(36).slice(2)
  return 'bc_' + (s() + s()).slice(0, 18)
}

export default function ConsentModal({ cust, bizId, onClose }) {
  const [tab, setTab] = useState('create')
  const [tpls, setTpls] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [prefill, setPrefill] = useState({})
  const [loading, setLoading] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [qrDataUri, setQrDataUri] = useState('')
  const [history, setHistory] = useState([])

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

  useEffect(() => {
    if (tab !== 'history' || !cust?.id) return
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/customer_consents?customer_id=eq.${cust.id}&select=id,template_id,template_name,signature_url,document_url,signer_name,signed_at,ip&order=signed_at.desc&limit=50`, { headers: sbHeaders }).then(r => r.json())
        if (!cancelled && Array.isArray(r)) setHistory(r)
      } catch (e) { console.error('[consent] history load', e) }
    }
    load()
    const ch = window._sbClient?.channel(`consent_${cust.id}_${Date.now()}`)
      ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_consents', filter: `customer_id=eq.${cust.id}` }, () => load())
      ?.subscribe()
    return () => { cancelled = true; try { ch?.unsubscribe(); window._sbClient?.removeChannel(ch) } catch {} }
  }, [tab, cust?.id])

  const toggleTpl = id => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const createLink = async () => {
    if (selectedIds.length === 0) return alert('템플릿을 1개 이상 선택하세요.')
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
      })
      const url = `${SIGN_HOST}/?t=${token}`
      setLinkUrl(url)
      const dataUri = await QRCode.toDataURL(url, { width: 256, margin: 2 })
      setQrDataUri(dataUri)
    } catch (e) {
      console.error('[consent] create err', e)
      alert('링크 생성 실패: ' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(linkUrl).then(() => alert('링크 복사됨')).catch(() => {})
  }

  const reset = () => { setLinkUrl(''); setQrDataUri(''); setSelectedIds([]); setPrefill({}) }

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
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>📝 동의서 · {cust?.name || ''}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: T.textMuted }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid ' + T.border }}>
          {[['create', '작성'], ['history', '이력']].map(([k, lbl]) => (
            <button key={k} onClick={() => { setTab(k); if (k === 'create') reset() }}
              style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: tab === k ? 800 : 500, border: 'none', background: 'none', color: tab === k ? T.primary : T.textSub, borderBottom: tab === k ? '2px solid ' + T.primary : '2px solid transparent', cursor: 'pointer' }}>
              {lbl}
            </button>
          ))}
        </div>

        {tab === 'create' && !linkUrl && <div style={{ padding: 16 }}>
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

          <button onClick={createLink} disabled={loading || selectedIds.length === 0}
            style={{ width: '100%', padding: '10px', marginTop: 10, fontSize: 14, fontWeight: 800, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: selectedIds.length && !loading ? 'pointer' : 'not-allowed', opacity: selectedIds.length && !loading ? 1 : .5 }}>
            {loading ? '생성중…' : `✅ 링크 생성 (${selectedIds.length}건)`}
          </button>
        </div>}

        {tab === 'create' && linkUrl && <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 12 }}>✅ 링크 생성 완료</div>
          {qrDataUri && <img src={qrDataUri} alt="QR" style={{ width: 256, height: 256, border: '1px solid ' + T.border, borderRadius: 8, marginBottom: 12 }} />}
          <div style={{ fontSize: 11, color: T.textMuted, wordBreak: 'break-all', padding: '6px 10px', background: T.gray100, borderRadius: 6, marginBottom: 10 }}>{linkUrl}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={copyLink} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.gray200, color: T.text, border: 'none', borderRadius: 6, cursor: 'pointer' }}>📋 복사</button>
            <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.primary, color: '#fff', borderRadius: 6, textDecoration: 'none' }}>🖥 열기</a>
            <button onClick={reset} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: '#fff', color: T.primary, border: '1px solid ' + T.primary, borderRadius: 6, cursor: 'pointer' }}>↻ 새로</button>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 10 }}>💡 24시간 이내 서명 안 하면 만료</div>
        </div>}

        {tab === 'history' && <div style={{ padding: 12, maxHeight: 420, overflow: 'auto' }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', color: T.textMuted, padding: 30, fontSize: 13 }}>서명 이력 없음</div>
          ) : history.map(h => (
            <div key={h.id} style={{ padding: '10px 12px', borderBottom: '1px solid ' + T.border, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{h.template_name || h.template_id}</div>
              <div style={{ color: T.textMuted, marginBottom: 6 }}>{(h.signed_at || '').replace('T', ' ').slice(0, 16)}{h.signer_name ? ' · ' + h.signer_name : ''}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {h.document_url && <a href={h.document_url} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', background: T.primary, color: '#fff', borderRadius: 4, fontSize: 11, textDecoration: 'none' }}>📄 PDF</a>}
                {h.signature_url && <a href={h.signature_url} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', background: T.gray200, color: T.text, borderRadius: 4, fontSize: 11, textDecoration: 'none' }}>🖼 서명</a>}
              </div>
            </div>
          ))}
        </div>}
      </div>
    </div>
  )
}
