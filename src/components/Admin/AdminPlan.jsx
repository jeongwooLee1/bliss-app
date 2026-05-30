import React, { useState, useMemo, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { ALL_FEATURES, PLANS, featuresForPlan, setFeatures, extractFeatures, POINT_PRICING } from '../../lib/features'
import I from '../common/I'
import AdminAlimtalkLog from './AdminAlimtalkLog'
import AdminSmsLog from './AdminSmsLog'

// 사업장 요금제 + 기능 토글 + 지점별 잔액·사용량 + 발송내역 통합
function AdminPlan({ data, setData, currentUser, userBranches = [], initialSubTab = 'plan' }) {
  const isOwner = currentUser?.role === 'owner' || currentUser?.role === 'super'
  const isMaster = isOwner || currentUser?.role === 'manager'  // 지점 원장도 자기 지점 충전·환불 가능
  const [subTab, setSubTab] = useState(initialSubTab)
  const biz = data?.businesses?.[0] || {}
  const branches = (data?.branches || []).filter(b => userBranches.length ? userBranches.includes(b.id) : true)  // 계정별 자기 지점만 (manager=자기 지점, owner=전 지점)
  const [plan, setPlan] = useState(biz.plan || 'trial')
  const [industry, setIndustry] = useState(biz.industry || 'general')
  const [features, setFeaturesLocal] = useState(() => extractFeatures(biz.settings, biz.id, biz.plan))
  const [subs, setSubs] = useState([])      // billing_subscriptions
  const [balances, setBalances] = useState([]) // billing_balances
  const [usage, setUsage] = useState([])    // 선택 월 usage 집계
  const [history, setHistory] = useState([])  // 최근 사용 히스토리 (시간순 50건)
  const [monthSel, setMonthSel] = useState('this')  // 'this' | 'last' — 지점별 사용량 조회 월
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  // 포인트 충전·환불 모달 (2026-05-14 v3.7.718)
  const [topupModal, setTopupModal] = useState(null)  // { branchId, branchName, amount }
  const [refundModal, setRefundModal] = useState(null)  // { branchId, branchName, balance, amount, reason }
  const [topupBusy, setTopupBusy] = useState(false)
  const [refundBusy, setRefundBusy] = useState(false)

  useEffect(() => {
    setPlan(biz.plan || 'trial')
    setIndustry(biz.industry || 'general')
    setFeaturesLocal(extractFeatures(biz.settings, biz.id, biz.plan))
  }, [biz.id, biz.plan, biz.settings, biz.industry])

  // billing 데이터 로드 (월 무관: 구독·잔액·차감 히스토리)
  const loadBilling = async () => {
    if (!biz.id) return
    const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const [s, b, h] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/billing_subscriptions?business_id=eq.${biz.id}&select=*`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/billing_balances?business_id=eq.${biz.id}&select=*`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/billing_usage_logs?business_id=eq.${biz.id}&select=branch_id,kind,count,points_charged,ref_table,created_at&order=created_at.desc&limit=100`, { headers: H }).then(r => r.json()),
    ])
    setSubs(Array.isArray(s) ? s : [])
    setBalances(Array.isArray(b) ? b : [])
    setHistory(Array.isArray(h) ? h : [])
  }
  useEffect(() => { loadBilling() }, [biz.id])

  // 지점별 사용량 — 선택 월(이번 달/지난달) 기준 재집계
  const loadUsage = async () => {
    if (!biz.id) { setUsage([]); return }
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth()
    const since = (monthSel === 'last' ? new Date(y, m - 1, 1) : new Date(y, m, 1)).toISOString()
    const until = monthSel === 'last' ? new Date(y, m, 1).toISOString() : null
    const body = { p_business_id: biz.id, p_since: since }
    if (until) body.p_until = until
    const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
    const u = await fetch(`${SB_URL}/rest/v1/rpc/get_billing_usage_summary`, {
      method: 'POST', headers: H, body: JSON.stringify(body),
    }).then(r => r.json()).catch(() => [])
    setUsage(Array.isArray(u) ? u : [])
  }
  useEffect(() => { loadUsage() }, [biz.id, monthSel])

  const groupedFeatures = useMemo(() => {
    return [
      { title: '운영', keys: ['schedule_advanced'] },
      { title: '멤버십·패키지', keys: ['customer_packages','package_share','member_pricing'] },
      { title: '마케팅', keys: ['event_engine','coupons','points'] },
      { title: '메시지 발송', keys: ['kakao_alimtalk','aligo_sms'] },
      { title: '메시지함 (Pro)', keys: ['messages_inbox','naver_scrape','naver_block','whatsapp','instagram_dm','line_chat'] },
      { title: 'AI (Pro)', keys: ['ai_auto_reply','ai_book','bliss_ai'] },
      { title: '동의서·업종 특화', keys: ['consent','care_sms','external_prepaid'] },
    ]
  }, [])

  // 지점별 사용량 집계
  const usageByBranch = useMemo(() => {
    const byBr = {}
    for (const u of usage) {
      if (!byBr[u.branch_id]) byBr[u.branch_id] = { total: 0, kinds: {} }
      byBr[u.branch_id].total += u.points || 0
      byBr[u.branch_id].kinds[u.kind] = (byBr[u.branch_id].kinds[u.kind] || 0) + (u.cnt || 0)
    }
    return byBr
  }, [usage])

  const applyPlan = async (nextPlan) => {
    if (!isOwner) { alert('대표 관리자만 변경 가능합니다.'); return }
    const branchCount = branches.length
    const totalMonthly = (PLANS[nextPlan]?.price || 0) * branchCount
    if (!confirm(`요금제를 "${PLANS[nextPlan]?.label}"로 변경할까요?\n\n지점 ${branchCount}개 × ${(PLANS[nextPlan]?.price||0).toLocaleString()}원 = ${totalMonthly.toLocaleString()}원/월\n\n모든 지점에 일괄 적용됩니다.`)) return
    setSaving(true)
    setMsg('')
    try {
      const newFeatures = featuresForPlan(nextPlan)
      const newPrice = PLANS[nextPlan]?.price || 0
      const newCredit = PLANS[nextPlan]?.monthly_credit || 0
      // 1. settings.features + plan 갱신 (businesses)
      let s = biz.settings
      if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
      s = s || {}
      s.features = newFeatures
      await sb.update('businesses', biz.id, {
        plan: nextPlan,
        settings: JSON.stringify(s),
      })
      // 2. billing_subscriptions: 사업장 내 모든 branch 일괄 변경
      const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
      await fetch(`${SB_URL}/rest/v1/billing_subscriptions?business_id=eq.${biz.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          plan_key: nextPlan,
          price_monthly: newPrice,
          status: nextPlan === 'trial' ? 'trialing' : 'active',
          updated_at: new Date().toISOString(),
        })
      })
      // 3. billing_balances: monthly_credit 동기화 (잔액은 건드리지 않음)
      await fetch(`${SB_URL}/rest/v1/billing_balances?business_id=eq.${biz.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ monthly_credit: newCredit, updated_at: new Date().toISOString() })
      })
      // 로컬 반영
      setPlan(nextPlan)
      setFeaturesLocal(newFeatures)
      setFeatures(newFeatures)
      setData(prev => prev ? {
        ...prev,
        businesses: (prev.businesses || []).map(b => b.id === biz.id ? { ...b, plan: nextPlan, settings: JSON.stringify(s) } : b)
      } : prev)
      await loadBilling()
      setMsg(`✅ ${PLANS[nextPlan]?.label}로 변경됨 (지점 ${branchCount}개 일괄). 새로고침 시 메뉴 반영.`)
    } catch (e) {
      setMsg('변경 실패: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // ─── 포인트 충전: reservation_payments에 purpose='topup' row INSERT 후 새 탭 결제 ───
  const handleTopup = async () => {
    if (!topupModal || topupBusy) return
    const { branchId, amount } = topupModal
    if (!amount || amount < 1000) { alert('충전 금액을 선택해주세요'); return }
    setTopupBusy(true)
    try {
      const orderId = 'topup_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
      const r = await fetch(`${SB_URL}/rest/v1/reservation_payments`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          id: orderId,
          business_id: biz.id,
          branch_id: branchId,
          amount,
          purpose: 'topup',
          status: 'pending',
          payment_provider: 'tosspayments',
          notes: `${PLANS[plan]?.label || plan} 매장 포인트 충전`,
        })
      })
      if (!r.ok) { const t = await r.text().catch(()=>''); throw new Error(t || '주문 생성 실패') }
      // 새 탭으로 결제 페이지 열기 (PaymentApp.jsx 재사용)
      window.open(`/pay/${orderId}`, '_blank', 'noopener,noreferrer')
      setTopupModal(null)
      alert('새 탭에서 결제를 완료해주세요. 결제 후 이 페이지를 새로고침하면 잔액에 반영됩니다.')
    } catch (e) {
      alert('충전 시작 실패: ' + (e?.message || e))
    } finally {
      setTopupBusy(false)
    }
  }

  // ─── 포인트 환불: 잔액 한도내만 (사용분 제외). point-refund Edge Function 호출 ───
  const handleRefund = async () => {
    if (!refundModal || refundBusy) return
    const { branchId, balance, amount, reason } = refundModal
    const refundAmount = Number(amount)
    if (!refundAmount || refundAmount < 1) { alert('환불 금액을 입력해주세요'); return }
    if (refundAmount > balance) { alert(`환불 금액이 잔액(${balance.toLocaleString()}P)을 초과합니다`); return }
    if (!reason || !reason.trim()) { alert('환불 사유를 입력해주세요'); return }
    if (!confirm(`${refundAmount.toLocaleString()}원 환불 신청합니다.\n\n사용한 포인트는 환불되지 않습니다.\n토스 결제 취소로 영업일 1~3일 내 카드 환불됩니다.\n진행하시겠습니까?`)) return
    setRefundBusy(true)
    try {
      const r = await fetch(`${SB_URL}/functions/v1/point-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ business_id: biz.id, branch_id: branchId, amount: refundAmount, reason: reason.trim() })
      })
      const d = await r.json().catch(()=>({}))
      if (!r.ok) throw new Error(d?.error || `환불 실패 (${r.status})`)
      alert(`환불 완료: ${(d.refunded_amount||refundAmount).toLocaleString()}원\n토스 결제 ${d.cancelled_count||1}건 취소됨`)
      setRefundModal(null)
      await loadBilling()
    } catch (e) {
      alert('환불 실패: ' + (e?.message || e))
    } finally {
      setRefundBusy(false)
    }
  }

  const TABS = [
    { k: 'plan',     label: '💳 요금제·잔액' },
    { k: 'alimtalk', label: '📨 알림톡·SMS 발송' },
    { k: 'sms',      label: '📤 직원 SMS 발송' },
    { k: 'history',  label: '📊 포인트 차감 히스토리' },
  ]

  return <div>
    <h3 style={{margin:'0 0 16px',fontSize:T.fs.lg,fontWeight:T.fw.black}}>요금제 & 사용내역</h3>

    {/* 탭 네비게이션 */}
    <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap',borderBottom:`2px solid ${T.border}`}}>
      {TABS.map(t => (
        <button key={t.k} onClick={()=>setSubTab(t.k)}
          style={{
            padding:'8px 14px',
            border:'none',
            background:'transparent',
            color: subTab===t.k ? T.primary : T.textSub,
            fontWeight: subTab===t.k ? T.fw.black : T.fw.medium,
            fontSize: T.fs.sm,
            cursor:'pointer', fontFamily:'inherit',
            borderBottom: subTab===t.k ? `2px solid ${T.primary}` : '2px solid transparent',
            marginBottom: -2,
          }}>{t.label}</button>
      ))}
    </div>

    {/* 알림톡/SMS 로그 탭 */}
    {subTab === 'alimtalk' && <AdminAlimtalkLog data={data} userBranches={userBranches}/>}
    {subTab === 'sms' && <AdminSmsLog data={data} userBranches={userBranches}/>}

    {/* 포인트 히스토리 단독 탭 (요금제 페이지에서 분리) */}
    {subTab === 'history' && (
      <div className="card" style={{overflow:'auto',maxHeight:'70vh'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:T.fs.xxs}}>
          <thead style={{position:'sticky',top:0,background:T.bgCard}}>
            <tr style={{borderBottom:`1px solid ${T.border}`}}>
              <th style={{padding:'8px',textAlign:'left',color:T.textSub,fontWeight:T.fw.bolder}}>일시</th>
              <th style={{padding:'8px',textAlign:'left',color:T.textSub,fontWeight:T.fw.bolder}}>지점</th>
              <th style={{padding:'8px',textAlign:'left',color:T.textSub,fontWeight:T.fw.bolder}}>종류</th>
              <th style={{padding:'8px',textAlign:'right',color:T.textSub,fontWeight:T.fw.bolder}}>건수</th>
              <th style={{padding:'8px',textAlign:'right',color:T.textSub,fontWeight:T.fw.bolder}}>차감</th>
              <th style={{padding:'8px',textAlign:'left',color:T.textSub,fontWeight:T.fw.bolder}}>출처</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => {
              const br = branches.find(b => b.id === h.branch_id)
              const dt = h.created_at ? new Date(h.created_at) : null
              const ts = dt ? `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}` : ''
              return <tr key={i} style={{borderBottom:`1px solid ${T.border}40`}}>
                <td style={{padding:'5px 8px',color:T.textSub,fontFamily:'monospace'}}>{ts}</td>
                <td style={{padding:'5px 8px'}}>{br?.short || br?.name || h.branch_id?.slice(0,8) || '-'}</td>
                <td style={{padding:'5px 8px',fontWeight:T.fw.bolder}}>{h.kind}</td>
                <td style={{padding:'5px 8px',textAlign:'right'}}>{h.count}</td>
                <td style={{padding:'5px 8px',textAlign:'right',color:T.danger,fontWeight:T.fw.bolder}}>-{(h.points_charged||0).toLocaleString()}P</td>
                <td style={{padding:'5px 8px',color:T.textMuted,fontSize:10}}>{h.ref_table || '-'}</td>
              </tr>
            })}
            {history.length === 0 && <tr><td colSpan={6} style={{padding:24,textAlign:'center',color:T.textMuted}}>차감 내역 없음</td></tr>}
          </tbody>
        </table>
      </div>
    )}

    {/* 요금제·잔액 탭 (기존 콘텐츠) */}
    {subTab === 'plan' && <>
    {/* 현재 상태 */}
    <div className="card" style={{padding:16,marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bolder}}>현재 요금제</div>
          <div style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.primary}}>{PLANS[plan]?.label || plan}</div>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:4}}>{PLANS[plan]?.desc}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bolder}}>업종</div>
          <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>{industry || '-'}</div>
        </div>
      </div>

      {isOwner && (
        <div style={{borderTop:`1px solid ${T.border}`,paddingTop:12}}>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bolder,marginBottom:8}}>요금제 변경 (지점 {branches.length}개 일괄)</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {Object.entries(PLANS).map(([k,p]) => (
              <button key={k} disabled={saving || k === plan}
                onClick={() => applyPlan(k)}
                style={{
                  padding:'10px 14px',borderRadius:T.radius.md,
                  border:`1px solid ${k === plan ? T.primary : T.border}`,
                  background:k === plan ? T.primaryLt : '#fff',
                  color:k === plan ? T.primary : T.text,
                  fontSize:T.fs.sm,fontWeight:T.fw.bolder,
                  cursor:k === plan || saving ? 'default' : 'pointer',
                  fontFamily:'inherit',textAlign:'left',minWidth:120
                }}>
                <div>{p.label}</div>
                <div style={{fontSize:T.fs.xxs,color:T.textMuted,fontWeight:T.fw.medium,marginTop:2}}>
                  {p.price === 0 ? '무료' : `월 ${p.price.toLocaleString()}원`}
                </div>
                <div style={{fontSize:T.fs.xxs,color:T.textMuted,fontWeight:T.fw.medium}}>
                  무료 {p.monthly_credit.toLocaleString()}P
                </div>
              </button>
            ))}
          </div>
          {msg && <div style={{marginTop:10,fontSize:T.fs.sm,color:msg.startsWith('✅') ? T.success : T.danger}}>{msg}</div>}
        </div>
      )}
    </div>

    {/* 지점별 잔액 + 이번 달 사용량 */}
    {balances.length > 0 && (
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:8}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>지점별 잔액 + 사용량</div>
          <div style={{display:'flex',gap:4}}>
            {[['this','이번 달'],['last','지난달']].map(([k,lbl]) => (
              <button key={k} onClick={()=>setMonthSel(k)}
                style={{
                  padding:'4px 12px',borderRadius:6,
                  border:`1px solid ${monthSel===k?T.primary:T.border}`,
                  background:monthSel===k?T.primaryLt:'#fff',
                  color:monthSel===k?T.primary:T.textSub,
                  fontSize:T.fs.xxs,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit',
                }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="card" style={{overflow:'hidden'}}>
          {branches.map((br, i) => {
            const sub = subs.find(s => s.branch_id === br.id)
            const bal = balances.find(b => b.branch_id === br.id)
            const u = usageByBranch[br.id] || { total: 0, kinds: {} }
            return <div key={br.id} style={{padding:'12px 14px',borderBottom:i<branches.length-1?`1px solid ${T.border}`:'none'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div>
                  <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>{br.short || br.name}</div>
                  <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{PLANS[sub?.plan_key]?.label || '미가입'} · {sub?.price_monthly ? `월 ${sub.price_monthly.toLocaleString()}원` : '무료'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,color:T.primary}}>{(bal?.balance||0).toLocaleString()}P</div>
                  <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{monthSel==='last'?'지난달':'이번 달'} 사용 {u.total.toLocaleString()}P</div>
                  {isMaster && (
                    <div style={{display:'flex',gap:6,marginTop:6,justifyContent:'flex-end'}}>
                      <button onClick={()=>setTopupModal({branchId:br.id,branchName:br.short||br.name,amount:30000})}
                        style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${T.primary}`,background:T.primary,color:'#fff',fontSize:T.fs.xxs,fontWeight:T.fw.bolder,cursor:'pointer',fontFamily:'inherit'}}>
                        + 충전
                      </button>
                      {(bal?.balance||0) > 0 && (
                        <button onClick={()=>setRefundModal({branchId:br.id,branchName:br.short||br.name,balance:bal.balance,amount:'',reason:''})}
                          style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,fontSize:T.fs.xxs,fontWeight:T.fw.medium,cursor:'pointer',fontFamily:'inherit'}}>
                          환불 신청
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {Object.keys(u.kinds).length > 0 && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {Object.entries(u.kinds).map(([k, c]) => (
                    <span key={k} style={{fontSize:T.fs.xxs,color:T.textSub,background:T.gray100,padding:'2px 6px',borderRadius:4}}>
                      {k} {c}건
                    </span>
                  ))}
                </div>
              )}
            </div>
          })}
        </div>
      </div>
    )}

    {/* 단가 안내 */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:6}}>단가</div>
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,padding:'8px 12px',background:T.gray100,borderRadius:T.radius.md,lineHeight:1.6}}>
        알림톡 {POINT_PRICING.alimtalk}P · SMS(단문) {POINT_PRICING.sms}P · LMS(장문) {POINT_PRICING.lms}P · WhatsApp {POINT_PRICING.whatsapp}P · AI 호출 {POINT_PRICING.ai_call}P~
        <br/>1P = 1원. 잔액 부족 시 발송 차단.
      </div>
    </div>

    </>}

    {/* 기능 토글 (read-only) */}
    <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:8}}>활성 기능</div>
    {groupedFeatures.map(grp => (
      <div key={grp.title} style={{marginBottom:14}}>
        <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.textMuted,marginBottom:4,paddingLeft:2}}>{grp.title}</div>
        <div className="card" style={{overflow:'hidden'}}>
          {grp.keys.map((k, i, arr) => {
            const meta = ALL_FEATURES[k]
            if (!meta) return null
            const on = !!features[k]
            return <div key={k} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none'}}>
              <div style={{width:24,height:24,borderRadius:6,background:on?T.successLt:T.gray100,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <I name={on?'check':'x'} size={13} color={on?T.success:T.gray400}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:on?T.text:T.textMuted}}>{meta.label}</div>
                <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{meta.desc}</div>
              </div>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:on?T.success:T.gray400}}>
                {on ? 'ON' : 'OFF'}
              </div>
            </div>
          })}
        </div>
      </div>
    ))}

    <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:12,padding:'8px 12px',background:T.gray100,borderRadius:T.radius.md}}>
      💡 기능별 개별 토글은 추후 추가됩니다. 현재는 plan 단위로 일괄 적용됩니다.
    </div>

    {/* ─── 포인트 충전 모달 ─── */}
    {topupModal && (
      <div onClick={()=>!topupBusy && setTopupModal(null)}
        style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20}}>
        <div onClick={e=>e.stopPropagation()}
          style={{background:'#fff',borderRadius:T.radius.lg,padding:24,maxWidth:420,width:'100%',boxShadow:'0 10px 40px rgba(0,0,0,0.15)'}}>
          <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,marginBottom:4}}>포인트 충전</div>
          <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:16}}>{topupModal.branchName}</div>
          <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:8,fontWeight:T.fw.bolder}}>충전 금액 (1원 = 1P)</div>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[10000,30000,50000].map(amt => (
              <button key={amt} onClick={()=>setTopupModal({...topupModal,amount:amt})}
                style={{flex:1,padding:'14px 8px',borderRadius:T.radius.md,
                  border:`1px solid ${topupModal.amount===amt?T.primary:T.border}`,
                  background:topupModal.amount===amt?T.primaryLt:'#fff',
                  color:topupModal.amount===amt?T.primary:T.text,
                  fontSize:T.fs.md,fontWeight:T.fw.black,cursor:'pointer',fontFamily:'inherit'}}>
                {(amt/10000)}만원
              </button>
            ))}
          </div>
          <div style={{fontSize:T.fs.xxs,color:T.textMuted,padding:'8px 12px',background:T.gray100,borderRadius:T.radius.md,marginBottom:16,lineHeight:1.6}}>
            • 결제 완료 시 즉시 충전됩니다.<br/>
            • 환불은 잔액 한도내만 가능 (사용한 포인트는 환불 불가).<br/>
            • 토스페이먼츠로 결제되며, 카드 영수증이 발급됩니다.
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setTopupModal(null)} disabled={topupBusy}
              style={{flex:1,padding:'12px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,background:'#fff',color:T.text,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:topupBusy?'not-allowed':'pointer',fontFamily:'inherit'}}>
              취소
            </button>
            <button onClick={handleTopup} disabled={topupBusy}
              style={{flex:2,padding:'12px',borderRadius:T.radius.md,border:'none',background:T.primary,color:'#fff',fontSize:T.fs.sm,fontWeight:T.fw.black,cursor:topupBusy?'not-allowed':'pointer',fontFamily:'inherit',opacity:topupBusy?0.6:1}}>
              {topupBusy ? '진행 중...' : `${topupModal.amount?.toLocaleString()}원 결제하기`}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ─── 환불 신청 모달 ─── */}
    {refundModal && (
      <div onClick={()=>!refundBusy && setRefundModal(null)}
        style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20}}>
        <div onClick={e=>e.stopPropagation()}
          style={{background:'#fff',borderRadius:T.radius.lg,padding:24,maxWidth:420,width:'100%',boxShadow:'0 10px 40px rgba(0,0,0,0.15)'}}>
          <div style={{fontSize:T.fs.lg,fontWeight:T.fw.black,marginBottom:4}}>포인트 환불 신청</div>
          <div style={{fontSize:T.fs.sm,color:T.textMuted,marginBottom:16}}>{refundModal.branchName} · 잔액 {refundModal.balance.toLocaleString()}P</div>
          <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:6,fontWeight:T.fw.bolder}}>환불 금액 (P · 잔액 한도 내)</div>
          <input type="number" value={refundModal.amount} onChange={e=>setRefundModal({...refundModal,amount:e.target.value})}
            placeholder={`최대 ${refundModal.balance.toLocaleString()}`}
            style={{width:'100%',padding:'10px 12px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,fontSize:T.fs.md,fontFamily:'inherit',marginBottom:12,boxSizing:'border-box'}}/>
          <div style={{fontSize:T.fs.xs,color:T.textSub,marginBottom:6,fontWeight:T.fw.bolder}}>환불 사유</div>
          <textarea value={refundModal.reason} onChange={e=>setRefundModal({...refundModal,reason:e.target.value})}
            placeholder="예: 사용하지 않는 잔액 환불 요청"
            rows={3}
            style={{width:'100%',padding:'10px 12px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,fontSize:T.fs.sm,fontFamily:'inherit',marginBottom:16,boxSizing:'border-box',resize:'vertical'}}/>
          <div style={{fontSize:T.fs.xxs,color:T.textMuted,padding:'8px 12px',background:T.gray100,borderRadius:T.radius.md,marginBottom:16,lineHeight:1.6}}>
            • 사용한 포인트는 환불 대상에서 제외됩니다.<br/>
            • 토스 결제 취소로 처리되며, 영업일 1~3일 내 카드사로 환불됩니다.<br/>
            • 가장 최근 충전 건부터 역순으로 취소됩니다.
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setRefundModal(null)} disabled={refundBusy}
              style={{flex:1,padding:'12px',borderRadius:T.radius.md,border:`1px solid ${T.border}`,background:'#fff',color:T.text,fontSize:T.fs.sm,fontWeight:T.fw.bolder,cursor:refundBusy?'not-allowed':'pointer',fontFamily:'inherit'}}>
              취소
            </button>
            <button onClick={handleRefund} disabled={refundBusy}
              style={{flex:2,padding:'12px',borderRadius:T.radius.md,border:'none',background:T.danger,color:'#fff',fontSize:T.fs.sm,fontWeight:T.fw.black,cursor:refundBusy?'not-allowed':'pointer',fontFamily:'inherit',opacity:refundBusy?0.6:1}}>
              {refundBusy ? '처리 중...' : '환불 신청'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
}

export default AdminPlan
