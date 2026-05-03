import React, { useState, useMemo, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { ALL_FEATURES, PLANS, featuresForPlan, setFeatures, extractFeatures, POINT_PRICING } from '../../lib/features'
import I from '../common/I'

// 사업장 요금제 + 기능 토글 + 지점별 잔액·사용량
function AdminPlan({ data, setData, currentUser }) {
  const isOwner = currentUser?.role === 'owner' || currentUser?.role === 'super'
  const biz = data?.businesses?.[0] || {}
  const branches = data?.branches || []
  const [plan, setPlan] = useState(biz.plan || 'trial')
  const [industry, setIndustry] = useState(biz.industry || 'general')
  const [features, setFeaturesLocal] = useState(() => extractFeatures(biz.settings, biz.id, biz.plan))
  const [subs, setSubs] = useState([])      // billing_subscriptions
  const [balances, setBalances] = useState([]) // billing_balances
  const [usage, setUsage] = useState([])    // 이번 달 usage 집계
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setPlan(biz.plan || 'trial')
    setIndustry(biz.industry || 'general')
    setFeaturesLocal(extractFeatures(biz.settings, biz.id, biz.plan))
  }, [biz.id, biz.plan, biz.settings, biz.industry])

  // billing 데이터 로드
  const loadBilling = async () => {
    if (!biz.id) return
    const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const [s, b, u] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/billing_subscriptions?business_id=eq.${biz.id}&select=*`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/billing_balances?business_id=eq.${biz.id}&select=*`, { headers: H }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/billing_usage_logs?business_id=eq.${biz.id}&select=branch_id,kind,count,points_charged&created_at=gte.${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()}`, { headers: H }).then(r => r.json()),
    ])
    setSubs(Array.isArray(s) ? s : [])
    setBalances(Array.isArray(b) ? b : [])
    setUsage(Array.isArray(u) ? u : [])
  }
  useEffect(() => { loadBilling() }, [biz.id])

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
      byBr[u.branch_id].total += u.points_charged || 0
      byBr[u.branch_id].kinds[u.kind] = (byBr[u.branch_id].kinds[u.kind] || 0) + (u.count || 0)
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

  return <div>
    <h3 style={{margin:'0 0 16px',fontSize:T.fs.lg,fontWeight:T.fw.black}}>요금제 & 기능</h3>

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
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:8}}>지점별 잔액 + 이번 달 사용량</div>
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
                  <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>이번 달 사용 {u.total.toLocaleString()}P</div>
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
  </div>
}

export default AdminPlan
