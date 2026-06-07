import React, { useState, useEffect, useCallback } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import ConsentDocsViewer from './ConsentDocsViewer'

/**
 * 고객 상세 '동의서' 탭 내용 — 서명 이력(신규차트·동의서) 리스트 + 신규 요청 버튼
 * 행 클릭 시 앱 안에서 바로 차트 이미지로 보기(ConsentDocsViewer). Realtime 구독으로 서명 완료 시 자동 갱신.
 */
export default function ConsentPanel({ cust, onRequestNew }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewId, setViewId] = useState(null)  // 인앱 뷰어로 볼 consent id

  const load = useCallback(async () => {
    if (!cust?.id) return
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/customer_consents?customer_id=eq.${cust.id}&select=id,template_id,template_name,signature_url,document_url,signer_name,signed_at,ip&order=signed_at.desc&limit=100`,
        { headers: sbHeaders }
      ).then(r => r.json())
      if (Array.isArray(r)) setHistory(r)
    } catch (e) { console.error('[consent panel] load', e) }
    finally { setLoading(false) }
  }, [cust?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!cust?.id) return
    const ch = window._sbClient?.channel(`consent_panel_${cust.id}_${Date.now()}`)
      ?.on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'customer_consents',
        filter: `customer_id=eq.${cust.id}`,
      }, () => load())
      ?.subscribe()
    return () => { try { ch?.unsubscribe(); window._sbClient?.removeChannel(ch) } catch {} }
  }, [cust?.id, load])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={onRequestNew}
          style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1.5px dashed ' + T.primary, background: T.primaryLt, color: T.primary, cursor: 'pointer', fontFamily: 'inherit' }}>
          ➕ 새 동의서 요청
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: T.textMuted }}>
          서명 이력 {history.length}건
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>불러오는 중…</div>
      ) : history.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.gray100, borderRadius: 8 }}>
          아직 서명한 동의서가 없습니다
        </div>
      ) : (
        <div style={{ border: '1px solid ' + T.border, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          {history.map((h, i) => (
            <div key={h.id} onClick={() => setViewId(h.id)} title="눌러서 차트/동의서 보기"
              style={{ padding: '10px 14px', borderBottom: i === history.length - 1 ? 'none' : '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{h.template_name || h.template_id}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>
                  {(h.signed_at || '').replace('T', ' ').slice(0, 16)}
                  {h.signer_name ? ' · ' + h.signer_name : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                <span style={{ padding: '5px 12px', background: T.primary, color: '#fff', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>보기</span>
                {h.document_url && <a href={h.document_url} onClick={e=>e.stopPropagation()} target="_blank" rel="noopener noreferrer" style={{ padding: '5px 10px', background: T.gray200, color: T.text, borderRadius: 5, fontSize: 11, textDecoration: 'none', fontWeight: 600 }}>PDF</a>}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewId && <ConsentDocsViewer customerId={cust.id} customerName={cust.name} focusConsentId={viewId} onClose={() => setViewId(null)} />}
    </div>
  )
}
