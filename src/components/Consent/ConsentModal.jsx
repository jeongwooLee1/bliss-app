import React, { useState, useEffect, useMemo } from 'react'
import QRCode from 'qrcode/lib/browser'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'

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
export default function ConsentModal({ cust, bizId, data, onClose, reservationId, initialSelectedIds, initialPrefill, sendKind, chartIds = [], chartStatus, docStatus, onViewDoc }) {
  const isChart = sendKind === 'chart'  // 차트 보내기 모드: 신규차트+오늘관리 묶음을 단일 카드로 (직원이 신규/기존 안 고름 — 동의서앱이 자동 분기)
  const isBoth = sendKind === 'both'    // 차트 & 동의서 한 화면: 차트 자동카드 + 동의서 체크박스 + 작성완료 보기
  const isRefund = sendKind === 'refund' // 환불 요청서(페이백) 단독 발송 — ct_refund만, 직원이 환불 금액 입력, SMS 우선. 기존 회원 대상(신규 생성 X)
  const linkWord = isRefund ? '환불 요청서' : isBoth ? '차트·동의서' : isChart ? '차트' : '동의서'  // 안내·발송 문구
  const [tpls, setTpls] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedIds, setSelectedIds] = useState(sendKind === 'refund' ? ['ct_refund'] : (initialSelectedIds || []))
  const [prefill, setPrefill] = useState(initialPrefill || {})
  const [kioskId, setKioskId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // {token, url, qr, via:'kiosk'|'qr'}
  const [chatChans, setChatChans] = useState([]) // 연결된 채팅 채널(WhatsApp/인스타/LINE) — 010 없는 외국 고객용 발송

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
    const onKey = e => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, result, selectedIds.length])

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

  // 연결된 채팅 채널 조회 (sns_accounts) — WhatsApp/인스타/LINE으로 동의서 링크 발송 (010 없는 외국 고객)
  useEffect(() => {
    if (!cust?.id) { setChatChans([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetch(`${SB_URL}/rest/v1/customers?id=eq.${cust.id}&select=sns_accounts`, { headers: sbHeaders }).then(r => r.json())
        let sns = rows?.[0]?.sns_accounts || []
        if (typeof sns === 'string') { try { sns = JSON.parse(sns) } catch { sns = [] } }
        const SENDABLE = ['whatsapp', 'instagram', 'line']
        const byCh = {}
        ;(Array.isArray(sns) ? sns : []).forEach(s => {
          if (s && SENDABLE.includes(s.channel) && s.user_id && !byCh[s.channel]) byCh[s.channel] = s
        })
        if (!cancelled) setChatChans(Object.values(byCh))
      } catch { if (!cancelled) setChatChans([]) }
    })()
    return () => { cancelled = true }
  }, [cust?.id])

  const CH_LABEL = { whatsapp: 'WhatsApp', instagram: '인스타 DM', line: 'LINE' }
  const CH_COLOR = { whatsapp: '#25D366', instagram: '#E1306C', line: '#06C755' }

  const toggleTpl = id => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const smsHasPhone = /^01[016789]\d{7,8}$/.test(String(cust?.phone || '').replace(/[^0-9]/g, ''))

  // 환불 금액 — 직원 입력 (숫자만). prefill_data.refund_amount로 저장 → 동의서앱 ct_refund 폼에 prefill
  const refundAmt = Number(String(prefill.refund_amount || '').replace(/[^0-9]/g, '')) || 0
  const _canSend = selectedIds.length > 0 && (!isRefund || refundAmt >= 1) // 환불은 금액 입력해야 발송 가능

  // 닫기 — 경고창 없이 바로 닫음 (정우님 요청)
  const handleClose = () => { onClose?.() }

  const send = async (via, chatChan) => {
    if (selectedIds.length === 0) return alert('템플릿을 1개 이상 선택하세요.')
    if (isRefund && refundAmt < 1) return alert('환불 금액을 입력하세요.')
    if (via === 'kiosk' && !kioskId) return alert('대상 태블릿을 선택하세요.')
    const smsPhone = String(cust?.phone || '').replace(/[^0-9]/g, '')
    if ((via === 'sms' || via === 'alimtalk') && !/^01[016789]\d{7,8}$/.test(smsPhone)) return alert('이 고객은 휴대폰 번호(010~)가 없어 발송이 안 됩니다.\nQR/링크로 전달해주세요.')
    setLoading(true)
    try {
      const token = genToken()
      const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      const cleanPrefill = Object.fromEntries(Object.entries(prefill).filter(([_, v]) => v && String(v).trim() !== ''))
      if (reservationId) cleanPrefill.reservation_id = reservationId  // 예약 모달에서 보낸 경우 — 예약별 차트 상태 연동
      if (isRefund) cleanPrefill.refund_amount = refundAmt  // 환불 금액 숫자로 저장 (동의서앱 ct_refund prefill)
      // 지점명 prefill — consent 앱이 "하우스왁싱 {branch}"로 렌더 (없으면 "하우스왁싱"만)
      if (!cleanPrefill.branch) {
        // 매출/예약 발생 지점(cust.bid)만 사용 — bid 없으면 빈칸("하우스왁싱"). 첫 지점(강남) 폴백 금지.
        const _bid = cust?.bid || ''
        const _br = _bid ? (data?.branches || []).find(b => b.id === _bid) : null
        const _brName = (_br?.short || _br?.name || '').replace(/^하우스왁싱\s*/, '').trim()
        if (_brName) cleanPrefill.branch = _brName
      }
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
      } else if (via === 'sms') {
        const targetBid = cust?.bid || (data?.branches || [])[0]?.id || ''
        const brName = (data?.branches || []).find(b => b.id === targetBid)?.short || ''
        const msg = `[${brName || '안내'}] ${linkWord} 작성 요청\n아래 링크에서 작성·서명 부탁드려요 (48시간 내 만료)\n${url}`
        const r = await fetch(`${SB_URL}/functions/v1/send-sms`, {
          method: 'POST',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch_id: targetBid, message: msg, receivers: [{ phone: smsPhone, userKey: cust?.id || smsPhone }] }),
        })
        let body = null; try { body = await r.json() } catch { body = {} }
        const ok = r.ok && (String(body.code || '') === '100' || String(body.code || '') === '200' || body.ok === true)
        if (ok) {
          const _bytes = (() => { let b = 0; for (const ch of msg) b += ch.charCodeAt(0) > 127 ? 2 : 1; return b })()
          fetch(`${SB_URL}/rest/v1/rpc/deduct_billing`, {
            method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_business_id: bizId, p_branch_id: targetBid, p_kind: _bytes > 90 ? 'lms' : 'sms', p_count: 1, p_points: _bytes > 90 ? 60 : 20, p_ref_table: 'consent_sms', p_ref_id: token }),
          }).catch(() => {})
        }
        setResult({ token, url, via: 'sms', sent: ok, phone: smsPhone })
        if (!ok) alert('문자 발송 실패: ' + JSON.stringify(body).slice(0, 200) + '\n(QR/링크로 대신 전달해주세요)')
      } else if (via === 'alimtalk') {
        // 카카오 알림톡 — 링크 차단 없음. alimtalk_queue 적재 → 서버가 아리고로 발송.
        // v3.8.62: 차트만 보내면 chart_doc(차트 안내 문구, UI_3916~), 동의서 포함이면 consent_doc(구매 동의서 문구) — 희서 id_6f3bsl54sx
        const _chartFolderIds = new Set(folders.filter(f => /차트|체크리스트/.test(f.name || '')).map(f => f.id))
        const _isChartTpl = (t) => !!t && (_chartFolderIds.has(t.folder_id) || /chart|condition|consent_full/i.test(t.id || ''))
        const _isChartSend = selectedIds.length > 0 && selectedIds.every(id => _isChartTpl(tpls.find(t => t.id === id)))
        const targetBid = cust?.bid || (data?.branches || [])[0]?.id || ''
        const brName = (data?.branches || []).find(b => b.id === targetBid)?.short || ''
        await sb.insert('alimtalk_queue', {
          branch_id: targetBid,
          noti_key: _isChartSend ? 'chart_doc' : 'consent_doc',
          phone: smsPhone,
          params: _isChartSend
            ? { '#{사용자명}': brName, '#{고객명}': cust?.name || '', '#{차트링크}': url }
            : { '#{사용자명}': brName, '#{고객명}': cust?.name || '', '#{동의서링크}': url },
          status: 'pending',
          channel: 'alimtalk',
        })
        setResult({ token, url, via: 'alimtalk', sent: true, phone: smsPhone })
      } else if (via === 'chat' && chatChan) {
        // 채팅 채널(WhatsApp/인스타/LINE)로 링크 발송 — send_queue 적재 → 서버가 실제 발송
        const targetBid = cust?.bid || (data?.branches || [])[0]?.id || ''
        const brName = (data?.branches || []).find(b => b.id === targetBid)?.short || ''
        const chMsg = `[${brName || '안내'}] ${linkWord} 작성 요청 / Please complete here:\n${url}`
        await sb.insert('send_queue', {
          account_id: chatChan.account_id || chatChan.channel,
          user_id: chatChan.user_id,
          channel: chatChan.channel,
          message_text: chMsg,
          status: 'pending',
        })
        setResult({ token, url, via: 'chat', sent: true, channelLabel: CH_LABEL[chatChan.channel] || chatChan.channel })
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

  // 거래 정보 prefill (동의서·차트&동의서 모드 공용)
  const prefillBlock = tpls.length > 0 ? (
    <details style={{ marginTop: 4, marginBottom: 10, borderTop: '1px solid ' + T.border, paddingTop: 10 }}>
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
    </details>
  ) : null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }} onClick={handleClose}>
      <div style={{ width: 'min(540px, 95vw)', maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>{isRefund ? '환불 요청서 보내기' : isBoth ? '차트 & 동의서' : isChart ? '차트 보내기' : '동의서 요청'} · {cust?.name || ''}</div>
          <button onClick={handleClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: T.textMuted }}>×</button>
        </div>

        {/* 전송 결과 화면 */}
        {result && result.via === 'chat' && <div style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 14 }}>💬</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>{result.channelLabel} 발송 완료</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>
            <b>{result.channelLabel}</b>(으)로 {linkWord} 링크를 보냈습니다.<br />고객님이 링크에서 작성·서명하시면 됩니다.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>확인</button>
        </div>}

        {result && result.via === 'kiosk' && <div style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 14 }}>📲</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>태블릿으로 전송 완료</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>
            <b>{kiosks.find(k => k.id === kioskId)?.name || kioskId}</b> 태블릿에 서명 화면이 열렸습니다.<br />
            고객님께 태블릿을 전달해주세요.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>확인</button>
        </div>}

        {result && result.via === 'alimtalk' && <div style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 14 }}>💬</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>카카오 알림톡 발송 완료</div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>
            <b>{result.phone}</b> 카카오톡으로 {linkWord} 링크를 보냈습니다.<br />고객님이 링크에서 작성·서명하시면 됩니다.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>확인</button>
        </div>}

        {result && result.via === 'sms' && <div style={{ padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 60, marginBottom: 14 }}>{result.sent ? '📨' : '⚠️'}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: result.sent ? '#10b981' : T.danger, marginBottom: 8 }}>
            {result.sent ? '문자 발송 완료' : '문자 발송 실패'}
          </div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>
            {result.sent ? <><b>{result.phone}</b> 으로 {linkWord} 링크를 보냈습니다.<br />고객님이 링크에서 작성·서명하시면 됩니다.</> : <>QR/링크로 대신 전달해주세요.</>}
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
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 10 }}>💡 48시간 이내 서명 안 하면 만료</div>
        </div>}

        {/* 작성 폼 */}
        {!result && <div style={{ padding: 16 }}>
          {tpls.length === 0 && !isRefund && <div style={{ textAlign: 'center', color: T.textMuted, padding: 30, fontSize: 13 }}>
            등록된 템플릿 없음.<br />
            <a href={`${SIGN_HOST}/?admin=1`} target="_blank" rel="noopener noreferrer" style={{ color: T.primary }}>관리자 편집기</a>에서 추가하세요.
          </div>}
          {/* 환불 요청서 단독 / 차트&동의서 한 화면 / 차트 단일카드 / 동의서 폴더 체크박스 */}
          {isRefund ? (
            <div style={{ marginBottom: 12, padding: 14, background: '#fff7ed', borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#c2410c', marginBottom: 4 }}>환불 요청서 (페이백)</div>
              <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.6, marginBottom: 12 }}>
                환불 요청서만 단독으로 보냅니다 (신규차트·체크리스트 제외).<br />
                고객님이 링크에서 환불 계좌·서명을 작성하면 매장으로 전달됩니다.
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>환불 금액</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input inputMode="numeric" autoFocus
                  value={refundAmt ? refundAmt.toLocaleString() : ''}
                  onChange={e => setPrefill(p => ({ ...p, refund_amount: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="예: 100,000"
                  style={{ flex: 1, padding: '10px 12px', fontSize: 16, fontWeight: 700, border: '1px solid ' + T.border, borderRadius: 8, textAlign: 'right' }} />
                <span style={{ fontSize: 15, color: T.textSub, fontWeight: 700 }}>원</span>
              </div>
              {refundAmt < 1 && <div style={{ fontSize: 11, color: T.danger, marginTop: 6 }}>환불 금액을 입력하세요.</div>}
            </div>
          ) : isBoth ? (<>
            {/* ── 차트 ── 신규=신규차트+오늘관리 / 기존=오늘관리만 (동의서앱 자동 분기) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.textSub, marginBottom: 6 }}>차트</div>
              {chartStatus?.status === 'signed' ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', background: '#ecfdf5', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>✓ 차트 작성완료</span>
                  {onViewDoc && chartStatus.consent && <button onClick={() => onViewDoc(chartStatus.consent)} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, background: '#fff', color: '#059669', border: '1px solid #a7f3d0', borderRadius: 6, cursor: 'pointer' }}>보기</button>}
                </div>
              ) : (
                <div style={{ padding: 14, background: '#eff6ff', borderRadius: 10 }}>
                  <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
                    {tpls.filter(t => chartIds.includes(t.id)).map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: T.text }}>
                        <span style={{ color: '#2563eb', fontWeight: 800 }}>·</span>{t.name}
                      </div>
                    ))}
                    {chartIds.length === 0 && <div style={{ fontSize: 12, color: T.danger }}>보낼 차트 템플릿이 없습니다.</div>}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7, background: '#fff', borderRadius: 8, padding: '8px 10px' }}>
                    고객 상태에 따라 자동으로 나뉘어 전송됩니다.<br />
                    · <b>신규 고객</b> → 신규차트 + 오늘 관리 체크리스트<br />
                    · <b>기존 고객</b> → 오늘 관리 체크리스트만 (신규차트 자동 생략)
                  </div>
                </div>
              )}
            </div>
            {/* ── 동의서 ── 구매 상품 동의서 (차트 폴더 제외, 필요한 것만 체크) ── */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.textSub, marginBottom: 6 }}>동의서 <span style={{ fontWeight: 500, color: T.textMuted }}>(구매 상품 — 필요한 것만 선택)</span></div>
              {docStatus?.status === 'signed' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: '#ecfdf5', borderRadius: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#059669' }}>✓ 동의서 작성완료</span>
                {onViewDoc && docStatus.consent && <button onClick={() => onViewDoc(docStatus.consent)} style={{ padding: '3px 10px', fontSize: 11.5, fontWeight: 700, background: '#fff', color: '#059669', border: '1px solid #a7f3d0', borderRadius: 6, cursor: 'pointer' }}>보기</button>}
              </div>}
              {(() => {
                const docFolders = Object.entries(grouped)
                  .map(([gid, g]) => [gid, { name: g.name, items: g.items.filter(t => !chartIds.includes(t.id)) }])
                  .filter(([, g]) => g.items.length > 0)
                if (docFolders.length === 0) return <div style={{ fontSize: 12, color: T.textMuted, padding: '4px 2px' }}>등록된 동의서 템플릿이 없습니다.</div>
                return docFolders.map(([gid, g]) => (
                  <div key={gid} style={{ marginBottom: 6 }}>
                    {g.name && g.name !== '미분류' && <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 3 }}>{g.name}</div>}
                    {g.items.map(t => (
                      <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                        <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleTpl(t.id)} />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                ))
              })()}
            </div>
            {prefillBlock}
          </>) : isChart ? (
            <div style={{ marginBottom: 12, padding: 14, background: '#eff6ff', borderRadius: 10 }}>
              <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
                {tpls.filter(t => selectedIds.includes(t.id)).map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: T.text }}>
                    <span style={{ color: '#2563eb', fontWeight: 800 }}>·</span>{t.name}
                  </div>
                ))}
                {selectedIds.length === 0 && <div style={{ fontSize: 12, color: T.danger }}>보낼 차트 템플릿이 없습니다. 관리자 편집기에서 확인하세요.</div>}
              </div>
              <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7, background: '#fff', borderRadius: 8, padding: '8px 10px' }}>
                고객 상태에 따라 자동으로 나뉘어 전송됩니다.<br />
                · <b>신규 고객</b> → 신규차트 + 오늘 관리 체크리스트<br />
                · <b>기존 고객</b> → 오늘 관리 체크리스트만 (신규차트 자동 생략)
              </div>
            </div>
          ) : (<>
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
            {prefillBlock}
          </>)}

          {/* 전송 방식 — 환불=SMS 우선(전용 알림톡 미승인) / 그외 카카오 알림톡·채팅채널·QR */}
          {(isRefund || tpls.length > 0) && <div style={{ marginTop: 14, padding: 12, background: T.gray100, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
              {isRefund
                ? (smsHasPhone
                    ? '환불 요청서 링크를 문자(SMS)로 보냅니다. 고객님이 작성·서명하시면 매장으로 계좌정보가 전달됩니다.'
                    : chatChans.length > 0
                      ? `이 고객은 ${chatChans.map(c => CH_LABEL[c.channel] || c.channel).join('·')}(으)로 환불 요청서 링크를 보낼 수 있어요. (휴대폰 010 번호 없음)`
                      : '이 고객은 휴대폰 번호(010~)가 없어 문자 발송이 안 됩니다. QR/링크로 전달하세요.')
                : (smsHasPhone
                    ? `고객 카카오톡으로 ${linkWord} 링크를 보냅니다. 카톡이 안 되면 QR/링크로 전달하세요.`
                    : chatChans.length > 0
                      ? `이 고객은 ${chatChans.map(c => CH_LABEL[c.channel] || c.channel).join('·')}(으)로 ${linkWord} 링크를 보낼 수 있어요. (휴대폰 010 번호 없음)`
                      : '이 고객은 휴대폰 번호(010~)가 없어 알림톡 발송이 안 됩니다. QR/링크로 전달하세요.')}
            </div>
            {/* 환불 모드: SMS 우선 (전용 알림톡 템플릿 승인 후 알림톡 추가 예정) */}
            {isRefund && smsHasPhone && <button onClick={() => send('sms')} disabled={loading || !_canSend}
              style={{ width: '100%', padding: '12px', marginBottom: 8, fontSize: 15, fontWeight: 800, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: (_canSend && !loading) ? 'pointer' : 'not-allowed', opacity: (_canSend && !loading) ? 1 : .5 }}>
              {loading ? '전송중…' : `📨 문자로 보내기 (${cust?.phone || ''})`}
            </button>}
            {/* 채팅 채널 발송 — 010 없는 외국 고객도 본인이 쓰는 채널로 링크 수신 */}
            {chatChans.map(ch => (
              <button key={ch.channel} onClick={() => send('chat', ch)} disabled={loading || !_canSend}
                style={{ width: '100%', padding: '12px', marginBottom: 8, fontSize: 15, fontWeight: 800, background: CH_COLOR[ch.channel] || T.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: (_canSend && !loading) ? 'pointer' : 'not-allowed', opacity: (_canSend && !loading) ? 1 : .5 }}>
                {loading ? '전송중…' : `💬 ${CH_LABEL[ch.channel] || ch.channel}으로 보내기`}
              </button>
            ))}
            {/* 알림톡 — 환불 모드 제외 (환불 전용 카카오 템플릿 미승인) */}
            {!isRefund && smsHasPhone && <button onClick={() => send('alimtalk')} disabled={loading || !_canSend}
              style={{ width: '100%', padding: '12px', fontSize: 15, fontWeight: 800, background: '#FEE500', color: '#3C1E1E', border: 'none', borderRadius: 8, cursor: (_canSend && !loading) ? 'pointer' : 'not-allowed', opacity: (_canSend && !loading) ? 1 : .5 }}>
              {loading ? '전송중…' : `💬 알림톡으로 보내기 (${cust?.phone || ''})`}
            </button>}
            {(() => { const _secondary = (isRefund && smsHasPhone) || smsHasPhone || chatChans.length > 0; return (
            <button onClick={() => send('qr')} disabled={loading || !_canSend}
              style={{ width: '100%', padding: _secondary ? '8px' : '12px', marginTop: _secondary ? 6 : 0, fontSize: _secondary ? 12 : 15, fontWeight: _secondary ? 600 : 800, background: _secondary ? 'transparent' : T.primary, color: _secondary ? T.textSub : '#fff', border: _secondary ? '1px dashed ' + T.border : 'none', borderRadius: 8, cursor: (_canSend && !loading) ? 'pointer' : 'not-allowed', opacity: (_canSend && !loading) ? 1 : .5 }}>
              {loading ? '생성중…' : `🔗 QR/링크로 대신 받기`}
            </button>); })()}
          </div>}
        </div>}
      </div>
    </div>
  )
}
