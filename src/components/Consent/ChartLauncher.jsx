import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ConsentModal from './ConsentModal'
import ConsentDocsViewer from './ConsentDocsViewer'
import { loadChartInfo } from '../../lib/chartInfo'

// 📋 공통 차트·동의서 런처 — 어느 화면(예약목록·매출관리·타임라인 등)에서든 점/버튼 클릭에 연결.
//   target.reservation 있으면 → ConsentModal(상태별: 미발송/발송대기=보내기, 작성완료=보기 버튼).
//   target.custId만(고객 단위) 있으면 → 작성내용 뷰어 바로.
//   부모는 setTarget(...)로 열고 onClose로 null 처리. target=null이면 아무것도 안 띄움.
export default function ChartLauncher({ target, data, onClose }) {
  const [chartInfo, setChartInfo] = useState(null)
  const [view, setView] = useState(null) // 'consent' | 'docs' | null
  const [docFocus, setDocFocus] = useState(null)

  const r = target?.reservation || null
  const custId = target?.custId || r?.custId || null
  const custName = target?.custName || r?.custName || ''
  const bizId = target?.bizId || r?.businessId || r?.business_id || (data?.businesses?.[0]?.id) || ''

  useEffect(() => {
    if (!target) { setView(null); setChartInfo(null); setDocFocus(null); return }
    // 예약 컨텍스트 없음(고객 단위) → 작성내용 뷰어 바로
    if (!r) { setChartInfo(null); setDocFocus(null); setView('docs'); return }
    let alive = true
    setView(null); setDocFocus(null)
    loadChartInfo(r.id, bizId).then(info => {
      if (!alive) return
      setChartInfo(info)
      setView('consent')
    }).catch(() => { if (alive) setView('consent') })
    return () => { alive = false }
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null
  return <>
    {view === 'consent' && r && custId && createPortal(
      <ConsentModal
        cust={{ id: custId, name: custName, phone: r.custPhone, bid: r.bid }}
        bizId={bizId}
        data={data}
        reservationId={r.id}
        sendKind="both"
        initialSelectedIds={chartInfo?.chart?.status === 'signed' ? [] : (chartInfo?.chartPresetIds || [])}
        chartIds={chartInfo?.chartPresetIds || []}
        chartStatus={chartInfo?.chart}
        docStatus={chartInfo?.doc}
        onViewDoc={(consent) => { setDocFocus(consent || null); setView('docs') }}
        onClose={() => { onClose && onClose() }}/>,
      document.body)}
    {view === 'docs' && custId && createPortal(
      <ConsentDocsViewer
        customerId={docFocus?.customer_id || chartInfo?.chart?.consent?.customer_id || chartInfo?.doc?.consent?.customer_id || custId}
        customerName={custName}
        focusConsentId={docFocus?.id || null}
        onClose={() => { onClose && onClose() }}/>,
      document.body)}
  </>
}
