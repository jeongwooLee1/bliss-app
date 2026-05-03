import React, { useState, useMemo, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { ALL_FEATURES, PLANS, featuresForPlan, setFeatures, extractFeatures } from '../../lib/features'
import I from '../common/I'

// 사업장 요금제 + 기능 토글 조회·변경 (대표 관리자만 plan 변경 가능)
function AdminPlan({ data, setData, currentUser }) {
  const isOwner = currentUser?.role === 'owner' || currentUser?.role === 'super'
  const biz = data?.businesses?.[0] || {}
  const [plan, setPlan] = useState(biz.plan || 'trial')
  const [industry, setIndustry] = useState(biz.industry || 'general')
  const [features, setFeaturesLocal] = useState(() => extractFeatures(biz.settings, biz.id))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setPlan(biz.plan || 'trial')
    setIndustry(biz.industry || 'general')
    setFeaturesLocal(extractFeatures(biz.settings, biz.id))
  }, [biz.id, biz.plan, biz.settings, biz.industry])

  const groupedFeatures = useMemo(() => {
    // 화면 표시용 그룹화
    return [
      { title: '운영', keys: ['schedule_advanced','branch_support','male_rotation','branch_groups'] },
      { title: '멤버십·패키지', keys: ['customer_packages','package_share','member_pricing'] },
      { title: '마케팅', keys: ['event_engine','coupons','points'] },
      { title: '커뮤니케이션', keys: ['kakao_alimtalk','aligo_sms','naver_scrape','naver_block','whatsapp','instagram_dm','line_chat','ai_auto_reply','ai_book'] },
      { title: '업종 특화', keys: ['care_sms','external_prepaid'] },
      { title: 'AI', keys: ['bliss_ai'] },
      { title: '엔터프라이즈', keys: ['oracle_sync'] },
    ]
  }, [])

  const applyPlan = async (nextPlan) => {
    if (!isOwner) { alert('대표 관리자만 변경 가능합니다.'); return }
    if (!confirm(`요금제를 "${PLANS[nextPlan]?.label}"로 변경할까요?\n해당 plan의 기능 묶음이 즉시 적용됩니다.`)) return
    setSaving(true)
    setMsg('')
    try {
      const newFeatures = featuresForPlan(nextPlan)
      // settings.features 갱신 (settings는 text JSON)
      let s = biz.settings
      if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
      s = s || {}
      s.features = newFeatures
      await sb.update('businesses', biz.id, {
        plan: nextPlan,
        settings: JSON.stringify(s),
      })
      // 로컬 반영
      setPlan(nextPlan)
      setFeaturesLocal(newFeatures)
      setFeatures(newFeatures)  // runtime 즉시 적용
      setData(prev => prev ? {
        ...prev,
        businesses: (prev.businesses || []).map(b => b.id === biz.id ? { ...b, plan: nextPlan, settings: JSON.stringify(s) } : b)
      } : prev)
      setMsg(`✅ ${PLANS[nextPlan]?.label}로 변경됨. 화면 새로고침하면 메뉴가 갱신됩니다.`)
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
          <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bolder,marginBottom:8}}>요금제 변경 (대표 관리자만)</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {Object.entries(PLANS).map(([k,p]) => (
              <button key={k} disabled={saving || k === plan}
                onClick={() => applyPlan(k)}
                style={{
                  padding:'8px 14px',borderRadius:T.radius.md,
                  border:`1px solid ${k === plan ? T.primary : T.border}`,
                  background:k === plan ? T.primaryLt : '#fff',
                  color:k === plan ? T.primary : T.text,
                  fontSize:T.fs.sm,fontWeight:T.fw.bolder,
                  cursor:k === plan || saving ? 'default' : 'pointer',
                  fontFamily:'inherit'
                }}>
                {p.label}
              </button>
            ))}
          </div>
          {msg && <div style={{marginTop:10,fontSize:T.fs.sm,color:msg.startsWith('✅') ? T.success : T.danger}}>{msg}</div>}
        </div>
      )}
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
