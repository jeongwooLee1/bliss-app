// 익명 결제 페이지 — AuthProvider/AppShell 우회 (토스페이먼츠 직결 + 포트원 V2 분기)
// 라우트: /pay/:orderId / /pay/success / /pay/fail
import React, { useState, useEffect } from 'react'
import { Routes, Route, useParams, useSearchParams, useNavigate } from 'react-router-dom'

const SB_URL = 'https://dpftlrsuqxqqeouwbfjd.supabase.co'
const SB_KEY = 'sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj'
const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js'
const TOSS_SDK = 'https://js.tosspayments.com/v2/standard'

function loadPortOneSDK() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.PortOne) return resolve(window.PortOne)
    const s = document.createElement('script')
    s.src = PORTONE_SDK
    s.onload = () => resolve(window.PortOne)
    s.onerror = () => reject(new Error('PortOne SDK 로드 실패'))
    document.head.appendChild(s)
  })
}

function loadTossSDK() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.TossPayments) return resolve(window.TossPayments)
    const s = document.createElement('script')
    s.src = TOSS_SDK
    s.onload = () => resolve(window.TossPayments)
    s.onerror = () => reject(new Error('토스페이먼츠 SDK 로드 실패'))
    document.head.appendChild(s)
  })
}

function Page({ children }) {
  return <div style={{ minHeight: '100vh', background: '#fafafe', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif' }}>
    <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', marginTop: 40 }}>
      {children}
      <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #f0f0f5', textAlign: 'center', fontSize: 11, color: '#bbb' }}>
        Powered by Bliss
      </div>
    </div>
  </div>
}

function PaymentLanding() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${SB_URL}/functions/v1/payment-info?orderId=${encodeURIComponent(orderId)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.error) setError(d.error)
        else setInfo(d)
      })
      .catch(e => !cancelled && setError(e?.message || '정보 조회 실패'))
    return () => { cancelled = true }
  }, [orderId])

  const payToss = async () => {
    if (!info?.client_key) { setError('토스 키 없음'); return }
    setLoading(true)
    try {
      const TossPayments = await loadTossSDK()
      const tp = TossPayments(info.client_key)
      // 비회원 결제(ANONYMOUS) — 빌링은 별도 customerKey 발급 필요
      const payment = tp.payment({ customerKey: 'ANONYMOUS' })
      const orderName = info.purpose === 'deposit' ? `${info.branch_name} 예약금`
                      : info.purpose === 'topup' ? `${info.branch_name}`
                      : (info.purpose || '결제')
      const successUrl = `${window.location.origin}/pay/success?orderId=${encodeURIComponent(info.orderId)}`
      const failUrl = `${window.location.origin}/pay/fail?orderId=${encodeURIComponent(info.orderId)}`
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: Number(info.amount) },
        orderId: info.orderId,
        orderName,
        successUrl,
        failUrl,
        customerName: info.cust_name || undefined,
        customerEmail: info.cust_email || undefined,
        customerMobilePhone: (info.cust_phone || '').replace(/[^0-9]/g, '') || undefined,
        card: { useEscrow: false, flowMode: 'DEFAULT', useCardPoint: false, useAppCardOnly: false },
      })
      // requestPayment는 successUrl로 redirect되므로 여기 이후 코드는 실패 시에만 실행
    } catch (e) {
      const msg = e?.message || e?.code || '결제창 호출 실패'
      // 사용자가 결제창 닫은 경우는 무시
      if (!/PAY_PROCESS_CANCELED|USER_CANCEL/i.test(String(e?.code || ''))) setError(msg)
      setLoading(false)
    }
  }

  const payPortOne = async (payMethod = 'CARD') => {
    if (!info?.store_id || !info?.channel_key) { setError('포트원 키 없음'); return }
    setLoading(true)
    try {
      const PortOne = await loadPortOneSDK()
      const customer = {}
      if (info.cust_name) customer.fullName = info.cust_name
      if (info.cust_phone) customer.phoneNumber = info.cust_phone.replace(/[^0-9]/g, '')
      if (info.cust_email) customer.email = info.cust_email

      const orderName = info.purpose === 'deposit' ? `${info.branch_name} 예약금`
                      : info.purpose === 'topup' ? `${info.branch_name}`
                      : (info.purpose || '결제')

      const res = await PortOne.requestPayment({
        storeId: info.store_id,
        channelKey: info.channel_key,
        paymentId: info.orderId,
        orderName,
        totalAmount: Number(info.amount),
        currency: 'KRW',
        payMethod,
        customer: Object.keys(customer).length ? customer : undefined,
        redirectUrl: `${window.location.origin}/pay/success?orderId=${encodeURIComponent(info.orderId)}`,
      })

      if (res?.code) {
        navigate(`/pay/fail?code=${encodeURIComponent(res.code)}&message=${encodeURIComponent(res.message || '')}`)
        return
      }
      navigate(`/pay/success?orderId=${encodeURIComponent(info.orderId)}&paymentId=${encodeURIComponent(res?.paymentId || info.orderId)}`)
    } catch (e) {
      setError(e?.message || '결제창 호출 실패')
      setLoading(false)
    }
  }

  const pay = () => info?.provider === 'tosspayments' ? payToss() : payPortOne('CARD')

  if (error) return <Page>
    <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
    <h2 style={{ textAlign: 'center', fontSize: 18, margin: '0 0 8px' }}>오류</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>{error}</p>
  </Page>
  if (!info) return <Page><p style={{ textAlign: 'center', color: '#888' }}>결제 정보 불러오는 중...</p></Page>
  if (info.status === 'already_paid') return <Page>
    <div style={{ fontSize: 50, textAlign: 'center', marginBottom: 12, color: '#10b981' }}>✓</div>
    <h2 style={{ textAlign: 'center', fontSize: 20, margin: '0 0 8px' }}>이미 결제완료</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>주문번호: {orderId}</p>
    {info.amount && <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>결제금액: {Number(info.amount).toLocaleString()}원</p>}
  </Page>
  if (info.status === 'cancelled') return <Page>
    <h2 style={{ textAlign: 'center' }}>결제 취소된 주문입니다</h2>
  </Page>
  if (info.status === 'expired') return <Page>
    <h2 style={{ textAlign: 'center', fontSize: 18 }}>결제 링크 만료</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13, marginTop: 8 }}>매장에 새 결제 링크를 요청해 주세요.</p>
  </Page>
  if (info.status === 'failed') return <Page>
    <h2 style={{ textAlign: 'center' }}>결제 실패한 주문입니다</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>매장에 문의해 주세요.</p>
  </Page>

  return <Page>
    <div style={{ textAlign: 'center', marginBottom: 4 }}>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>{info.branch_name}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#222' }}>
        {info.purpose === 'deposit' ? '예약금 결제'
          : info.purpose === 'topup' ? '포인트 충전'
          : '결제'}
      </div>
    </div>
    <div style={{ background: '#f5f3ff', borderRadius: 12, padding: 22, margin: '20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#7C3AED', marginBottom: 6, fontWeight: 600 }}>결제 금액</div>
      <div style={{ fontSize: 36, fontWeight: 800, color: '#5b21b6', letterSpacing: '-1px' }}>
        {Number(info.amount).toLocaleString()}<span style={{ fontSize: 18, marginLeft: 4 }}>원</span>
      </div>
    </div>
    {(info.cust_name || info.cust_phone) && <div style={{ background: '#fafafa', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: '#555' }}>
      {info.cust_name && <div>예약자: <b>{info.cust_name}</b></div>}
      {info.cust_phone && <div style={{ marginTop: 4 }}>연락처: {info.cust_phone}</div>}
    </div>}
    {info.is_test && <div style={{ background: '#fef9c3', color: '#854d0e', padding: '10px 12px', borderRadius: 8, fontSize: 12, marginBottom: 14, textAlign: 'center', fontWeight: 600 }}>
      ⚠️ 테스트 모드 — 실제 결제되지 않습니다
    </div>}
    <button onClick={pay} disabled={loading} style={{
      width: '100%', padding: 16, borderRadius: 12, border: 'none',
      background: loading ? '#a78bfa' : '#7C3AED', color: '#fff',
      fontSize: 16, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
      fontFamily: 'inherit', marginBottom: 8
    }}>
      {loading ? '결제창 여는 중...' : '카드로 결제하기'}
    </button>
    <p style={{ fontSize: 11, color: '#aaa', marginTop: 12, textAlign: 'center' }}>
      {info.provider === 'tosspayments' ? '토스페이먼츠로 안전하게 결제됩니다' : '포트원(PortOne)으로 안전하게 결제됩니다'}
    </p>
  </Page>
}

function PaymentSuccess() {
  const [params] = useSearchParams()
  const orderId = params.get('orderId') || params.get('paymentId')
  const paymentId = params.get('paymentId') || params.get('orderId')
  // 토스 successUrl 표준 파라미터: paymentKey, orderId, amount
  const paymentKey = params.get('paymentKey')
  const amount = params.get('amount')
  const code = params.get('code')
  const message = params.get('message')

  const [status, setStatus] = useState('confirming')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (code) { setError(message || code); setStatus('error'); return }
    if (!orderId && !paymentId) { setError('주문번호 누락'); setStatus('error'); return }
    const body = paymentKey
      ? { provider: 'tosspayments', paymentKey, orderId: orderId || paymentId, amount: amount ? Number(amount) : undefined }
      : { paymentId: paymentId || orderId, orderId: orderId || paymentId }
    fetch(`${SB_URL}/functions/v1/payment-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(r => r.json())
      .then(d => {
        if (d?.error) { setError(d.error); setStatus('error') }
        else { setResult(d); setStatus('paid') }
      })
      .catch(e => { setError(e?.message || '승인 실패'); setStatus('error') })
  }, [orderId, paymentId, paymentKey, amount, code, message])

  if (status === 'confirming') return <Page>
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: 16, color: '#666' }}>결제 승인 중...</div>
    </div>
  </Page>
  if (status === 'error') return <Page>
    <div style={{ fontSize: 50, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
    <h2 style={{ textAlign: 'center', fontSize: 20 }}>결제 처리 실패</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13, marginTop: 8 }}>{error}</p>
    <p style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 16 }}>매장에 문의해 주세요.</p>
  </Page>

  return <Page>
    <div style={{ fontSize: 60, textAlign: 'center', marginBottom: 12, color: '#10b981' }}>✓</div>
    <h2 style={{ textAlign: 'center', fontSize: 24, margin: '0 0 8px', color: '#222' }}>결제 완료</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 14, marginTop: 12 }}>
      <b>{Number(result?.amount || 0).toLocaleString()}원</b> 결제가 완료되었습니다
    </p>
    <p style={{ textAlign: 'center', color: '#aaa', fontSize: 11, marginTop: 12 }}>주문번호: {orderId}</p>
  </Page>
}

function PaymentFail() {
  const [params] = useSearchParams()
  const code = params.get('code')
  const message = params.get('message')
  return <Page>
    <div style={{ fontSize: 50, textAlign: 'center', marginBottom: 12 }}>✕</div>
    <h2 style={{ textAlign: 'center', fontSize: 20 }}>결제 실패</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13, marginTop: 8 }}>{message || '결제가 진행되지 않았습니다.'}</p>
    {code && <p style={{ textAlign: 'center', color: '#aaa', fontSize: 11, marginTop: 8 }}>코드: {code}</p>}
  </Page>
}

// ─── 월 이용료(구독) 카드 등록 — 매장 → Bliss 본사. 포트원 V2 + KCP 빌링키 발급 ───
function postBillingIssue({ billingKey, customerKey, branchId }) {
  return fetch(`${SB_URL}/functions/v1/billing-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY },
    body: JSON.stringify({ billingKey, customerKey, branchId, purpose: 'subscription' }),
  }).then(r => r.json())
}

function BillingResultView({ result }) {
  const fc = result?.firstCharge
  const chargeOk = fc?.ok && !fc?.skipped
  return <Page>
    <div style={{ fontSize: 60, textAlign: 'center', marginBottom: 12, color: '#10b981' }}>✓</div>
    <h2 style={{ textAlign: 'center', fontSize: 22, margin: '0 0 8px', color: '#222' }}>카드 등록 완료</h2>
    {result?.card_company && <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>{result.card_company} {result.card_number_masked || ''}</p>}
    <div style={{ background: '#f5f3ff', borderRadius: 12, padding: 16, margin: '18px 0', fontSize: 13, color: '#555', lineHeight: 1.7, textAlign: 'center' }}>
      {chargeOk
        ? <>첫 달 이용료가 결제되었습니다.<br/>이후 매월 같은 날 자동 결제됩니다.</>
        : <>월 이용료는 매월 자동 결제됩니다.<br/>{fc?.error
            ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{`첫 결제 보류: ${typeof fc.error === 'string' ? fc.error : '카드사 확인 필요'}`}</span>
            : <span style={{ color: '#999', fontSize: 12 }}>다음 결제일에 자동 청구됩니다.</span>}</>}
    </div>
    <p style={{ textAlign: 'center', color: '#aaa', fontSize: 11 }}>이 창은 닫으셔도 됩니다.</p>
  </Page>
}

function BillingRegister() {
  const { branchId } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${SB_URL}/functions/v1/payment-info?billing=1&branchId=${encodeURIComponent(branchId)}`)
      .then(r => r.json())
      .then(d => { if (cancelled) return; if (d?.error) setError(d.error); else setInfo(d) })
      .catch(e => !cancelled && setError(e?.message || '정보 조회 실패'))
    return () => { cancelled = true }
  }, [branchId])

  const register = async () => {
    if (!info?.store_id || !info?.channel_key) { setError('포트원 키 없음'); return }
    setLoading(true)
    try {
      const PortOne = await loadPortOneSDK()
      const issueId = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const redirectUrl = `${window.location.origin}/pay/billing-success?branchId=${encodeURIComponent(branchId)}&customerKey=${encodeURIComponent(info.customer_key)}`
      const res = await PortOne.requestIssueBillingKey({
        storeId: info.store_id,
        channelKey: info.channel_key,
        billingKeyMethod: 'CARD',
        issueId,
        issueName: info.branch_name || '월 이용료',
        customer: { customerId: info.customer_key },
        redirectUrl,
      })
      // PC: res 반환 / 모바일: redirectUrl로 redirect되어 BillingSuccess가 처리(아래 미실행)
      if (res?.code) {
        if (!/CANCEL/i.test(String(res.code))) setError(res.message || '카드 등록 실패')
        setLoading(false); return
      }
      const billingKey = res?.billingKey
      if (!billingKey) { setError('빌링키 발급 실패'); setLoading(false); return }
      const ir = await postBillingIssue({ billingKey, customerKey: info.customer_key, branchId })
      if (ir?.error) { setError(ir.error); setLoading(false); return }
      setResult(ir)
    } catch (e) {
      setError(e?.message || '카드 등록창 호출 실패'); setLoading(false)
    }
  }

  if (error) return <Page>
    <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
    <h2 style={{ textAlign: 'center', fontSize: 18, margin: '0 0 8px' }}>오류</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>{error}</p>
  </Page>
  if (!info) return <Page><p style={{ textAlign: 'center', color: '#888', padding: '30px 0' }}>불러오는 중...</p></Page>
  if (result) return <BillingResultView result={result} />

  return <Page>
    <div style={{ textAlign: 'center', marginBottom: 4 }}>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>{info.branch_name}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#222' }}>월 이용료 자동결제 카드 등록</div>
    </div>
    {info.price_monthly > 0 && <div style={{ background: '#f5f3ff', borderRadius: 12, padding: 22, margin: '20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#7C3AED', marginBottom: 6, fontWeight: 600 }}>월 이용료</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: '#5b21b6', letterSpacing: '-1px' }}>
        {Number(info.price_monthly).toLocaleString()}<span style={{ fontSize: 18, marginLeft: 4 }}>원</span>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>매월 자동 결제</div>
    </div>}
    <div style={{ background: '#fafafa', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 12, color: '#666', lineHeight: 1.7 }}>
      • 카드 등록 시 첫 달 이용료가 결제되고, 이후 매월 같은 날 자동 결제됩니다.<br/>
      • 등록한 카드는 안전하게 보관됩니다(카드번호는 저장되지 않음).<br/>
      • 해지는 매장 관리자에게 문의해 주세요.
    </div>
    <button onClick={register} disabled={loading} style={{
      width: '100%', padding: 16, borderRadius: 12, border: 'none',
      background: loading ? '#a78bfa' : '#7C3AED', color: '#fff',
      fontSize: 16, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit'
    }}>
      {loading ? '카드 등록창 여는 중...' : '카드 등록하기'}
    </button>
    <p style={{ fontSize: 11, color: '#aaa', marginTop: 12, textAlign: 'center' }}>포트원(KCP)으로 안전하게 등록됩니다</p>
  </Page>
}

function BillingSuccess() {
  const [params] = useSearchParams()
  const customerKey = params.get('customerKey')
  const billingKey = params.get('billingKey')
  const branchId = params.get('branchId')
  const code = params.get('code')
  const [status, setStatus] = useState('issuing')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (code) { setError(params.get('message') || '카드 등록이 취소되었습니다'); setStatus('error'); return }
    if (!billingKey || !customerKey || !branchId) { setError('인증 정보 누락'); setStatus('error'); return }
    postBillingIssue({ billingKey, customerKey, branchId })
      .then(d => { if (d?.error) { setError(d.error); setStatus('error') } else { setResult(d); setStatus('done') } })
      .catch(e => { setError(e?.message || '카드 등록 실패'); setStatus('error') })
  }, [billingKey, customerKey, branchId, code])

  if (status === 'issuing') return <Page><p style={{ textAlign: 'center', color: '#888', padding: '30px 0' }}>카드 등록 중...</p></Page>
  if (status === 'error') return <Page>
    <div style={{ fontSize: 50, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
    <h2 style={{ textAlign: 'center', fontSize: 20 }}>카드 등록 실패</h2>
    <p style={{ textAlign: 'center', color: '#666', fontSize: 13, marginTop: 8 }}>{error}</p>
    <p style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 16 }}>매장 관리자에게 문의해 주세요.</p>
  </Page>
  return <BillingResultView result={result} />
}

export default function PaymentApp() {
  return <Routes>
    <Route path="/pay/success" element={<PaymentSuccess />} />
    <Route path="/pay/fail" element={<PaymentFail />} />
    <Route path="/pay/billing-success" element={<BillingSuccess />} />
    <Route path="/pay/billing/:branchId" element={<BillingRegister />} />
    <Route path="/pay/:orderId" element={<PaymentLanding />} />
  </Routes>
}
