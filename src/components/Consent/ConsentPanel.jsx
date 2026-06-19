import React, { useState, useEffect, useCallback, useRef } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { uploadImageToStorage } from '../../lib/supabase'
import ConsentDocsViewer from './ConsentDocsViewer'

/**
 * 고객 상세 '동의서' 탭 내용 — 서명 이력(신규차트·동의서) 리스트 + 신규 요청 버튼
 * 행 클릭 시 앱 안에서 바로 차트 이미지로 보기(ConsentDocsViewer). Realtime 구독으로 서명 완료 시 자동 갱신.
 */
export default function ConsentPanel({ cust, onRequestNew, onRequestRefund, bizId }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewId, setViewId] = useState(null)  // 인앱 뷰어로 볼 consent id
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!cust?.id) return
    const SEL = 'id,template_id,template_name,signature_url,document_url,signer_name,signed_at,ip'
    try {
      // 1) customer_id로 매칭
      const byCust = await fetch(
        `${SB_URL}/rest/v1/customer_consents?customer_id=eq.${cust.id}&select=${SEL}&order=signed_at.desc&limit=100`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => [])
      // 2) 이 고객의 예약(reservation_id)에 달린 차트도 매칭
      //    — consent.customer_id가 삭제된/다른(중복) 레코드여도 잡아 예약 모달과 동일하게 표시
      let byRsv = []
      try {
        const rsvs = await fetch(
          `${SB_URL}/rest/v1/reservations?cust_id=eq.${cust.id}&select=reservation_id&limit=300`,
          { headers: sbHeaders }
        ).then(r => r.json())
        const rids = Array.isArray(rsvs) ? [...new Set(rsvs.map(x => x.reservation_id).filter(Boolean))] : []
        if (rids.length) {
          byRsv = await fetch(
            `${SB_URL}/rest/v1/customer_consents?form_data->>reservation_id=in.(${rids.join(',')})&select=${SEL}&order=signed_at.desc&limit=100`,
            { headers: sbHeaders }
          ).then(r => r.json()).catch(() => [])
        }
      } catch { /* 예약 조회 실패해도 byCust만으로 표시 */ }
      // 병합 (id 기준 dedup) + 서명시각 내림차순
      const map = new Map()
      ;[...(Array.isArray(byCust) ? byCust : []), ...(Array.isArray(byRsv) ? byRsv : [])]
        .forEach(h => { if (h?.id) map.set(h.id, h) })
      const merged = [...map.values()].sort((a, b) => String(b.signed_at || '').localeCompare(String(a.signed_at || '')))
      setHistory(merged)
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

  // 종이(오프라인) 동의서 사진 등록 → customer_consents에 1건 추가 → 이력에 "종이 동의서"로 표시
  const handlePaperUpload = async (file) => {
    if (!file || !cust?.id) return
    setUploading(true)
    try {
      const url = await uploadImageToStorage(file, 'consent')
      if (!url) { alert('사진 업로드 실패. 다시 시도해주세요.'); return }
      const ok = await sb.insert('customer_consents', {
        id: 'cc_paper_' + Math.random().toString(36).slice(2, 12),
        business_id: bizId || cust?.businessId || '',
        customer_id: cust.id,
        template_id: 'paper_consent',
        template_name: '종이 동의서',
        document_url: url,
        signer_name: cust.name || '',
        signed_at: new Date().toISOString(),
        form_data: { source: 'paper_upload' },
      }).then(() => true).catch((e) => { console.error('[consent panel] paper insert', e); return false })
      if (!ok) { alert('등록 실패. 다시 시도해주세요.'); return }
      await load()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={onRequestNew}
          style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1.5px dashed ' + T.primary, background: T.primaryLt, color: T.primary, cursor: 'pointer', fontFamily: 'inherit' }}>
          새 동의서 요청
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1.5px dashed ' + T.border, background: '#fff', color: T.textSub, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? '등록 중…' : '종이 동의서 사진 등록'}
        </button>
        {onRequestRefund && <button onClick={onRequestRefund}
          style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1.5px dashed #fb923c', background: '#fff7ed', color: '#c2410c', cursor: 'pointer', fontFamily: 'inherit' }}>
          환불 요청서 보내기
        </button>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => handlePaperUpload(e.target.files?.[0])} />
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
      {viewId && <ConsentDocsViewer customerId={cust.id} customerName={cust.name} consentIds={history.map(h => h.id)} focusConsentId={viewId} onClose={() => setViewId(null)} />}
    </div>
  )
}
