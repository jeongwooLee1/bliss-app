import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { APageHeader } from './AdminUI'
import AdminCoupons from './AdminCoupons'

// ═══════════════════════════════════════════════════════════════
// 이벤트 관리 v2
//   - 트리거 5종: new_first_sale / prepaid_purchase / pkg_purchase / annual_purchase / any_sale
//   - 조건 빌더: 시술 any/all/none, 카테고리, 다담권/패키지/연간 정확 매칭, 금액 범위, 고객 플래그
//   - 보상 최대 3개
// ═══════════════════════════════════════════════════════════════

const PREPAID_CAT_ID = "1s18w2l46"
const PKG_CAT_ID = "c1fbbbff-"

function AdminEvents({ data, setData, bizId }) {
  const [mode, setMode] = useState('events')
  return (
    <div>
      <APageHeader title="이벤트 관리" desc="쿠폰·적립·할인·쿠폰 발행 이벤트 통합 관리" />
      <div style={{display:'flex', gap:6, marginBottom:12, borderBottom:`2px solid ${T.border}`}}>
        {[
          ['events','💥 이벤트 등록'],
          ['coupon','🎫 쿠폰 등록'],
        ].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{
            padding:'10px 16px', fontSize:13, fontWeight:700,
            border:'none', background:'transparent',
            color: mode===k ? T.primary : T.textSub,
            borderBottom: mode===k ? `3px solid ${T.primary}` : '3px solid transparent',
            marginBottom:-2, cursor:'pointer', fontFamily:'inherit',
          }}>{l}</button>
        ))}
      </div>
      {mode==='coupon' ? <AdminCoupons data={data} setData={setData}/> : <EventList data={data} setData={setData} bizId={bizId}/>}
    </div>
  )
}

const TRIGGER_LABEL = {
  new_first_sale: '👤 신규 첫매출',
  prepaid_purchase: '💳 다담권 구매',
  pkg_purchase: '📦 패키지 구매',
  annual_purchase: '📘 연간회원권 구매',
  any_sale: '🧾 모든 매출',
  // 레거시
  prepaid_recharge: '💳 선불권 추가 충전 (레거시)',
  pkg_repurchase: '📦 패키지 재구매 (레거시)',
}
const TRIGGER_OPTIONS = [
  ['new_first_sale','👤 신규 첫매출'],
  ['prepaid_purchase','💳 다담권 구매'],
  ['pkg_purchase','📦 패키지 구매'],
  ['annual_purchase','📘 연간회원권 구매'],
  ['any_sale','🧾 모든 매출'],
]

const REWARD_LABEL = {
  point_earn: '💰 포인트 적립',
  discount_pct: '🔖 % 할인',
  discount_flat: '🔖 정액 할인',
  coupon_issue: '🎁 쿠폰 발행',
  prepaid_bonus: '💸 다담권 보너스',
  free_service: '🎀 무료 시술권',
  discount: '🔖 % 할인',
}
const REWARD_OPTIONS = [
  ['point_earn','💰 포인트 적립'],
  ['discount_pct','🔖 % 할인'],
  ['discount_flat','🔖 정액 할인'],
  ['coupon_issue','🎁 쿠폰 발행'],
  ['prepaid_bonus','💸 다담권 보너스 (충전금액 %)'],
  ['free_service','🎀 무료 시술권'],
]

// 보상 1개를 가장 짧은 라벨로 요약
function rewardSummary(r) {
  if (!r) return ''
  if (r.type === 'point_earn') {
    if (r.base === 'fixed') return `💰 ${Number(r.value||0).toLocaleString()}P`
    return `💰 ${r.rate||0}% 적립`
  }
  if (r.type === 'discount_pct' || r.type === 'discount') return `🔖 ${r.rate||0}% 할인`
  if (r.type === 'discount_flat') return `🔖 -${Number(r.value||0).toLocaleString()}원`
  if (r.type === 'coupon_issue') return `🎁 ${r.couponName||''} ×${r.qty||1}`
  if (r.type === 'prepaid_bonus') return `💸 +${r.rate||0}%`
  if (r.type === 'free_service') return '🎀 무료시술'
  return r.type
}

function EventList({ data, setData, bizId }) {
  const biz = (data?.businesses||[]).find(b=>b.id===bizId) || (data?.businesses||[])[0]
  const settings = useMemo(()=>{
    try { return typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{}); } catch { return {}; }
  }, [biz?.settings])
  const savedEvents = Array.isArray(settings.events) ? settings.events : []
  const events = savedEvents

  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [creating, setCreating] = useState(false)

  const persist = async (nextEvents) => {
    setSaving(true); setMsg('')
    try {
      const cur = typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{})
      const next = { ...cur, events: nextEvents }
      const nextStr = JSON.stringify(next)
      await sb.update('businesses', bizId, { settings: nextStr })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings:nextStr}:b)}))
      setMsg('✓ 저장됨'); setTimeout(()=>setMsg(''), 2000)
    } catch(e) { setMsg('저장 실패: '+e.message) }
    finally { setSaving(false) }
  }

  const toggle = (id) => {
    const evt = events.find(e=>e.id===id)
    const updated = { ...evt, enabled: !evt.enabled }
    const nextList = savedEvents.map(e=>e.id===id?updated:e)
    persist(nextList)
  }

  const startEdit = (evt) => {
    // 레거시 호환: 단일 rewardType 이벤트를 rewards[]로 변환하여 편집
    const d = { ...evt, conditions: { ...(evt.conditions||{}) } }
    if (!Array.isArray(d.rewards) || d.rewards.length === 0) {
      if (d.rewardType) {
        const r = { type: d.rewardType === 'discount' ? 'discount_pct' : d.rewardType }
        ;['base','rate','value','couponName','qty','expiryMonths','baseCategoryIds','baseServiceIds','serviceIds'].forEach(k => {
          if (d[k] !== undefined) r[k] = d[k]
        })
        d.rewards = [r]
      } else {
        d.rewards = []
      }
    }
    // 레거시 트리거 자동 마이그레이션
    if (d.trigger === 'prepaid_recharge') {
      d.trigger = 'prepaid_purchase'
      if (d.conditions.customerHasActivePrepaid == null) d.conditions.customerHasActivePrepaid = true
    } else if (d.trigger === 'pkg_repurchase') {
      d.trigger = 'pkg_purchase'
      if (d.conditions.customerHasActivePkg == null) d.conditions.customerHasActivePkg = true
    }
    setEditing(evt.id); setDraft(d)
  }
  const cancelEdit = () => { setEditing(null); setDraft({}); setCreating(false) }
  const saveEdit = () => {
    if (!draft.name?.trim()) { alert('이벤트 이름을 입력하세요'); return }
    if (!Array.isArray(draft.rewards) || draft.rewards.length === 0) {
      if (!confirm('보상이 없는 이벤트를 저장할까요? (트리거만 작동, 실효 없음)')) return
    }
    const toSave = { ...draft }
    // 레거시 단일 보상 필드 제거 — rewards[] 기준으로 일원화
    delete toSave.rewardType; delete toSave.base; delete toSave.rate; delete toSave.value
    delete toSave.couponName; delete toSave.qty; delete toSave.expiryMonths
    delete toSave.baseCategoryIds; delete toSave.baseServiceIds; delete toSave.serviceIds
    delete toSave.isTemplate
    const exists = savedEvents.find(e => e.id === toSave.id)
    const nextList = exists
      ? savedEvents.map(e => e.id === toSave.id ? toSave : e)
      : [...savedEvents, toSave]
    persist(nextList)
    setEditing(null); setDraft({}); setCreating(false)
  }
  const removeEvent = (id) => {
    if (!confirm('이 이벤트를 삭제하시겠어요?')) return
    persist(savedEvents.filter(e=>e.id!==id))
  }
  const duplicateEvent = (evt) => {
    // 깊은 복사 후 id/name 교체, 비활성 상태로 생성 → 편집 모드로 오픈
    const copy = JSON.parse(JSON.stringify(evt))
    copy.id = 'evt_custom_' + Math.random().toString(36).slice(2,10)
    copy.name = (evt.name || '이벤트') + ' (복사)'
    copy.enabled = false
    setDraft(copy)
    setEditing(copy.id)
    setCreating(true)
  }
  const startCreate = () => {
    const newId = 'evt_custom_' + Math.random().toString(36).slice(2,10)
    setDraft({
      id: newId, name:'', trigger:'new_first_sale', enabled:false,
      conditions: {},
      rewards: [{ type:'point_earn', base:'svc', rate:10, expiryMonths:3 }],
      desc:'',
    })
    setEditing(newId); setCreating(true)
  }

  const masterEnabled = settings.events_master_enabled !== false
  const toggleMaster = async () => {
    setSaving(true); setMsg('')
    try {
      const cur = typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{})
      const next = { ...cur, events_master_enabled: !masterEnabled }
      const nextStr = JSON.stringify(next)
      await sb.update('businesses', bizId, { settings: nextStr })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings:nextStr}:b)}))
      setMsg(next.events_master_enabled ? '✓ 이벤트 엔진 전체 ON' : '✓ 이벤트 엔진 전체 OFF — 매출등록 반영 중단됨')
      setTimeout(()=>setMsg(''), 3000)
    } catch(e) { setMsg('저장 실패: '+e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      {/* 마스터 스위치 */}
      <div style={{display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background: masterEnabled?'#E8F5E9':'#FFEBEE', border:`2px solid ${masterEnabled?'#4CAF50':'#EF5350'}`, borderRadius:10, marginBottom:12}}>
        <span style={{fontSize:22}}>{masterEnabled ? '🟢' : '🔴'}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:14, fontWeight:900, color: masterEnabled?'#2E7D32':'#C62828'}}>
            이벤트 엔진 전체 {masterEnabled ? 'ON' : 'OFF'}
          </div>
          <div style={{fontSize:11, color:T.textSub, marginTop:2}}>
            {masterEnabled
              ? '개별 이벤트의 토글 ON + 조건 충족 시 매출등록에 자동 반영됩니다.'
              : '엔진 전체 중단. 개별 이벤트 토글 상태와 관계없이 매출등록에 아무 영향 없음.'
            }
          </div>
        </div>
        <button onClick={toggleMaster} disabled={saving}
          style={{padding:'10px 20px', fontSize:13, fontWeight:800, borderRadius:8, border:'none',
            background: masterEnabled ? '#C62828' : '#2E7D32',
            color:'#fff', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>
          {masterEnabled ? '🔴 전체 OFF' : '🟢 전체 ON'}
        </button>
      </div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:8}}>
        <div style={{fontSize:11, color:T.textMuted, padding:'8px 12px', background:'#FFF8E1', borderRadius:6, border:'1px solid #FFECB3', flex:1, lineHeight:1.6}}>
          📌 <strong>마스터 + 개별 토글 모두 ON + 트리거·조건 충족</strong>이어야 반영. 신규 이벤트는 OFF 상태로 생성.<br/>
          보상은 <strong>최대 3개</strong>까지 추가 가능 — 포인트·할인·쿠폰 조합 예: "50만원권 → 5만P 적립 + 제품쿠폰 3만 발행"
        </div>
        <button onClick={startCreate} disabled={saving||creating}
          style={{padding:'8px 14px', fontSize:12, fontWeight:800, borderRadius:8, border:'none', background:T.primary, color:'#fff', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>
          + 새 이벤트
        </button>
      </div>
      {msg && <div style={{padding:'6px 10px', background:'#E8F5E9', color:'#2E7D32', borderRadius:6, fontSize:12, fontWeight:700, marginBottom:10}}>{msg}</div>}

      {/* 편집/생성 폼 */}
      {(creating || editing) && (
        <div style={{border:`2px dashed ${T.primary}`, background:T.primaryLt, borderRadius:10, padding:14, marginBottom:12}}>
          <div style={{fontSize:13, fontWeight:800, color:T.primaryDk, marginBottom:10}}>
            {creating ? '💥 새 이벤트 생성' : '✏️ 이벤트 수정'}
          </div>

          {/* 기본 정보 */}
          <div style={{display:'grid', gridTemplateColumns:'2fr 1.2fr', gap:10, marginBottom:10}}>
            <Field label="이벤트 이름" value={draft.name} onChange={v=>setDraft(p=>({...p,name:v}))}/>
            <Field label="트리거" value={draft.trigger} onChange={v=>setDraft(p=>({...p,trigger:v}))} type="select" options={TRIGGER_OPTIONS}/>
          </div>
          <Field label="설명 (선택)" value={draft.desc} onChange={v=>setDraft(p=>({...p,desc:v}))}/>

          {/* 조건 빌더 */}
          <ConditionsSection data={data} draft={draft} setDraft={setDraft}/>

          {/* 보상 섹션 */}
          <RewardsSection data={data} draft={draft} setDraft={setDraft}/>

          <div style={{marginTop:12, display:'flex', gap:8, justifyContent:'flex-end'}}>
            <button onClick={cancelEdit} style={{padding:'6px 14px', fontSize:12, fontWeight:700, borderRadius:6, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>취소</button>
            <button onClick={saveEdit} disabled={saving} style={{padding:'6px 16px', fontSize:12, fontWeight:800, borderRadius:6, border:'none', background:saving?T.gray300:T.primary, color:'#fff', cursor:saving?'default':'pointer', fontFamily:'inherit'}}>{creating?'생성':'저장'}</button>
          </div>
        </div>
      )}

      {events.length === 0 && !creating && (
        <div style={{padding:'40px 20px', textAlign:'center', background:T.gray100, borderRadius:10, color:T.textMuted}}>
          <div style={{fontSize:32, marginBottom:8}}>💥</div>
          <div style={{fontSize:13, fontWeight:700, marginBottom:4, color:T.textSub}}>등록된 이벤트 없음</div>
          <div style={{fontSize:11}}>우측 상단 <strong>+ 새 이벤트</strong> 버튼으로 이 매장에 맞는 이벤트를 만들어 주세요.</div>
        </div>
      )}

      <div style={{display:'grid', gap:10}}>
        {events.map(evt => {
          const rewards = Array.isArray(evt.rewards) && evt.rewards.length
            ? evt.rewards
            : (evt.rewardType ? [{ type: evt.rewardType==='discount'?'discount_pct':evt.rewardType,
                base: evt.base, rate: evt.rate, value: evt.value,
                couponName: evt.couponName, qty: evt.qty, expiryMonths: evt.expiryMonths }] : [])
          const borderColor = evt.enabled ? T.primary : T.border
          const isEdit = editing === evt.id
          if (isEdit) return null // 편집 중인 이벤트는 상단 폼에서 렌더
          return (
            <div key={evt.id} style={{border:`1.5px solid ${borderColor}`, background:evt.enabled?'#FFF8F5':'#fff', borderRadius:10, padding:14}}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap'}}>
                <button onClick={()=>toggle(evt.id)} disabled={saving}
                  aria-label={evt.enabled ? 'OFF' : 'ON'}
                  style={{
                    width:42, height:22, borderRadius:11, border:'none', cursor:'pointer', padding:0,
                    background: evt.enabled ? '#4CAF50' : T.gray300,
                    position:'relative', flexShrink:0, transition:'background .15s',
                  }}>
                  <span style={{
                    position:'absolute', top:2, left: evt.enabled ? 22 : 2,
                    width:18, height:18, borderRadius:'50%', background:'#fff',
                    boxShadow:'0 1px 3px rgba(0,0,0,.2)', transition:'left .15s',
                  }}/>
                </button>
                <span style={{fontSize:14, fontWeight:800, color:T.text, flex:1, minWidth:120}}>{evt.name||'(이름 없음)'}</span>
                <span style={{fontSize:10, padding:'2px 8px', borderRadius:4, background:T.gray100, color:T.textSub, fontWeight:700}}>{TRIGGER_LABEL[evt.trigger]||evt.trigger}</span>
                <button onClick={()=>startEdit(evt)} style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>수정</button>
                <button onClick={()=>duplicateEvent(evt)} title="이 이벤트를 복사해서 새로 만들기"
                  style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.primary}`, background:T.primaryLt, color:T.primary, cursor:'pointer', fontFamily:'inherit'}}>📋 복사</button>
                <button onClick={()=>removeEvent(evt.id)} title="삭제"
                  style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.danger}`, background:'#fff', color:T.danger, cursor:'pointer', fontFamily:'inherit'}}>삭제</button>
              </div>
              {evt.desc && <div style={{fontSize:11, color:T.textSub, lineHeight:1.5, marginBottom:6}}>{evt.desc}</div>}
              <ConditionSummary evt={evt} data={data}/>
              <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:6}}>
                {rewards.map((r, i) => (
                  <span key={i} style={{fontSize:11, padding:'3px 10px', borderRadius:12, background:'#fff', border:`1px solid ${T.border}`, color:T.text, fontWeight:700}}>
                    {rewardSummary(r)}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 조건 빌더 섹션 ───
function ConditionsSection({ data, draft, setDraft }) {
  const c = draft.conditions || {}
  const setC = (patch) => setDraft(p => ({...p, conditions: {...(p.conditions||{}), ...patch}}))

  const trigger = draft.trigger
  const showPrepaidPicker = trigger === 'prepaid_purchase'
  const showPkgPicker = trigger === 'pkg_purchase'
  const showAnnualPicker = trigger === 'annual_purchase'

  const [open, setOpen] = useState({
    svc: !!(c.servicesAny?.length || c.servicesAll?.length || c.servicesNone?.length || c.categoriesAny?.length),
    amt: !!(c.amountMin || c.amountMax),
    flags: (c.customerHasActivePrepaid!=null || c.customerHasActivePkg!=null || c.customerHasActiveAnnual!=null),
  })

  return (
    <div style={{marginTop:10, padding:10, background:'#fff', border:`1px solid ${T.border}`, borderRadius:8}}>
      <div style={{fontSize:12, fontWeight:800, color:T.textSub, marginBottom:8}}>🎯 조건 (AND — 모두 충족해야 반영)</div>

      {/* 상품 정확 매칭 (트리거별) */}
      {showPrepaidPicker && (
        <ProductPicker label="💳 다담권 상품 (정확 매칭)"
          data={data}
          filter={(s) => s.cat === PREPAID_CAT_ID}
          value={c.prepaidServiceIds||[]}
          onChange={v => setC({prepaidServiceIds: v})}
          emptyHint="선택 시 해당 다담권 구매만 트리거됩니다. 비우면 모든 다담권."
        />
      )}
      {showPkgPicker && (
        <ProductPicker label="📦 패키지 상품 (정확 매칭)"
          data={data}
          filter={(s) => (s.cat === PKG_CAT_ID || /PKG|패키지/i.test(s.name||'')) && s.cat !== PREPAID_CAT_ID && !/연간|회원권|할인권/.test(s.name||'')}
          value={c.pkgServiceIds||[]}
          onChange={v => setC({pkgServiceIds: v})}
          emptyHint="선택 시 해당 패키지만. 비우면 모든 패키지."
        />
      )}
      {showAnnualPicker && (
        <ProductPicker label="📘 연간회원권 상품 (정확 매칭)"
          data={data}
          filter={(s) => /연간|회원권|할인권/.test(s.name||'') && s.cat !== PREPAID_CAT_ID}
          value={c.annualServiceIds||[]}
          onChange={v => setC({annualServiceIds: v})}
          emptyHint="선택 시 해당 연간권만. 비우면 모든 연간회원권."
        />
      )}

      {/* 시술/카테고리 조건 */}
      <Collapsible title="🧴 시술/카테고리 조건" open={open.svc} setOpen={v=>setOpen(o=>({...o,svc:v}))}>
        <SvcPicker data={data} label="하나 이상 포함 (any)" value={c.servicesAny||[]} onChange={v=>setC({servicesAny:v})}/>
        <SvcPicker data={data} label="모두 포함 (AND — 예: 브라질리언 + 케어)" value={c.servicesAll||[]} onChange={v=>setC({servicesAll:v})}/>
        <SvcPicker data={data} label="제외 (이게 있으면 미반영)" value={c.servicesNone||[]} onChange={v=>setC({servicesNone:v})}/>
        <CatPicker data={data} label="카테고리 any" value={c.categoriesAny||[]} onChange={v=>setC({categoriesAny:v})}/>
      </Collapsible>

      {/* 금액 범위 */}
      <Collapsible title="💵 금액 범위" open={open.amt} setOpen={v=>setOpen(o=>({...o,amt:v}))}>
        <div style={{fontSize:10, color:T.textMuted, marginBottom:6}}>
          다담권/패키지/연간 트리거일 때는 해당 구매 금액, 그 외엔 시술+제품 합계 기준.
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          <Field label="최소 금액 (원)" value={c.amountMin} onChange={v=>setC({amountMin:+v||0})} type="number"/>
          <Field label="최대 금액 (원, 0=무한)" value={c.amountMax} onChange={v=>setC({amountMax:+v||0})} type="number"/>
        </div>
      </Collapsible>

      {/* 고객 상태 플래그 */}
      <Collapsible title="👤 고객 상태" open={open.flags} setOpen={v=>setOpen(o=>({...o,flags:v}))}>
        <TriFlag label="유효한 다담권 보유" value={c.customerHasActivePrepaid} onChange={v=>setC({customerHasActivePrepaid:v})}/>
        <TriFlag label="유효한 패키지 보유" value={c.customerHasActivePkg} onChange={v=>setC({customerHasActivePkg:v})}/>
        <TriFlag label="유효한 연간회원권 보유" value={c.customerHasActiveAnnual} onChange={v=>setC({customerHasActiveAnnual:v})}/>
      </Collapsible>
    </div>
  )
}

// ─── 보상 섹션 (최대 3개) ───
function RewardsSection({ data, draft, setDraft }) {
  const rewards = Array.isArray(draft.rewards) ? draft.rewards : []
  const updateReward = (idx, patch) => {
    const next = rewards.map((r,i) => i===idx ? {...r, ...patch} : r)
    setDraft(p => ({...p, rewards: next}))
  }
  const removeReward = (idx) => setDraft(p => ({...p, rewards: rewards.filter((_,i)=>i!==idx)}))
  const addReward = () => {
    if (rewards.length >= 3) return
    setDraft(p => ({...p, rewards: [...rewards, { type:'point_earn', base:'svc', rate:10, expiryMonths:3 }]}))
  }

  return (
    <div style={{marginTop:10, padding:10, background:'#fff', border:`1px solid ${T.border}`, borderRadius:8}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
        <div style={{fontSize:12, fontWeight:800, color:T.textSub}}>🎁 보상 ({rewards.length}/3)</div>
        <button onClick={addReward} disabled={rewards.length>=3}
          style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${rewards.length>=3?T.border:T.primary}`, background:rewards.length>=3?T.gray100:T.primaryLt, color:rewards.length>=3?T.textMuted:T.primary, cursor:rewards.length>=3?'default':'pointer', fontFamily:'inherit'}}>
          + 보상 추가
        </button>
      </div>
      {rewards.length === 0 && (
        <div style={{fontSize:11, color:T.textMuted, padding:'10px 8px', textAlign:'center', background:T.gray100, borderRadius:6}}>
          보상이 없습니다. "+ 보상 추가"로 1~3개의 보상을 조합하세요.
        </div>
      )}
      <div style={{display:'grid', gap:8}}>
        {rewards.map((r, idx) => (
          <RewardRow key={idx} idx={idx} reward={r} data={data}
            onChange={patch => updateReward(idx, patch)} onRemove={() => removeReward(idx)}/>
        ))}
      </div>
    </div>
  )
}

function RewardRow({ idx, reward, data, onChange, onRemove }) {
  const r = reward
  return (
    <div style={{border:`1px dashed ${T.border}`, borderRadius:8, padding:10, background:'#FAFAFA'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
        <span style={{fontSize:11, fontWeight:700, color:T.textSub, minWidth:30}}>#{idx+1}</span>
        <select className="inp" value={r.type||'point_earn'} onChange={e=>onChange({type:e.target.value})} style={{flex:1}}>
          {REWARD_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={onRemove} style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.danger}`, background:'#fff', color:T.danger, cursor:'pointer', fontFamily:'inherit'}}>삭제</button>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8}}>
        {(r.type==='point_earn') && <>
          <Field label="적립 기준" value={r.base||'svc'} onChange={v=>onChange({base:v})} type="select" options={[
            ['net_pay','할인 후 실결제액 (추천)'],
            ['svc','시술 전체 (할인 전)'],['svc_prod','시술+제품 (할인 전)'],
            ['prepaid_amount','충전금액(다담권)'],['pkg_amount','패키지금액'],['annual_amount','연간권금액'],
            ['category','특정 카테고리'],['services','특정 시술'],
            ['fixed','고정 금액(P)']
          ]}/>
          {r.base === 'fixed'
            ? <Field label="적립 포인트 (원)" value={r.value} onChange={v=>onChange({value:+v||0})} type="number"/>
            : <Field label="적립률 (%)" value={r.rate} onChange={v=>onChange({rate:+v||0})} type="number"/>
          }
          <Field label="유효기간 (개월)" value={r.expiryMonths} onChange={v=>onChange({expiryMonths:Math.max(1,+v||1)})} type="number"/>
          {r.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} label="대상 카테고리" value={r.baseCategoryIds||[]} onChange={v=>onChange({baseCategoryIds:v})}/></div>}
          {r.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} label="대상 시술" value={r.baseServiceIds||[]} onChange={v=>onChange({baseServiceIds:v})}/></div>}
        </>}
        {(r.type==='discount_pct') && <>
          <Field label="할인 기준" value={r.base||'svc'} onChange={v=>onChange({base:v})} type="select" options={[['svc','시술 전체'],['svc_prod','시술+제품'],['category','특정 카테고리'],['services','특정 시술']]}/>
          <Field label="할인율 (%)" value={r.rate} onChange={v=>onChange({rate:+v||0})} type="number"/>
          {r.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} label="대상 카테고리" value={r.baseCategoryIds||[]} onChange={v=>onChange({baseCategoryIds:v})}/></div>}
          {r.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} label="대상 시술" value={r.baseServiceIds||[]} onChange={v=>onChange({baseServiceIds:v})}/></div>}
        </>}
        {(r.type==='discount_flat') && <>
          <Field label="할인 금액 (원)" value={r.value} onChange={v=>onChange({value:+v||0})} type="number"/>
        </>}
        {(r.type==='coupon_issue') && <>
          <Field label="발행 쿠폰" value={r.couponName} onChange={v=>onChange({couponName:v})} type="select"
            options={[['','쿠폰 선택'],...(data?.services||[]).filter(s=>{const c=(data?.categories||[]).find(cc=>cc.id===s.cat);return c?.name==='쿠폰'}).map(s=>[s.name,s.name])]}/>
          <Field label="수량" value={r.qty} onChange={v=>onChange({qty:Math.max(1,+v||1)})} type="number"/>
          <Field label="유효기간 (개월)" value={r.expiryMonths} onChange={v=>onChange({expiryMonths:Math.max(1,+v||1)})} type="number"/>
        </>}
        {(r.type==='prepaid_bonus') && <>
          <Field label="보너스율 (%)" value={r.rate} onChange={v=>onChange({rate:+v||0})} type="number"/>
          <div style={{gridColumn:'2 / -1', fontSize:10, color:T.textMuted, alignSelf:'center'}}>
            충전금액 × 보너스율만큼 다담권 잔액 가산 (엔진에서 계산만, 실제 가산 로직은 v3.3.81 기준 미구현)
          </div>
        </>}
        {(r.type==='free_service') && <>
          <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} label="무료 시술 대상" value={r.serviceIds||[]} onChange={v=>onChange({serviceIds:v})}/></div>
        </>}
      </div>
    </div>
  )
}

// ─── 조건 요약 (카드 뷰) ───
function ConditionSummary({ evt, data }) {
  const c = evt.conditions || {}
  const chips = []
  const svcName = (id) => (data?.services||[]).find(s=>s.id===id)?.name || id
  const catName = (id) => (data?.categories||[]).find(x=>x.id===id)?.name || id
  if (c.servicesAny?.length) chips.push(`시술any: ${c.servicesAny.map(svcName).join(',')}`)
  if (c.servicesAll?.length) chips.push(`시술ALL: ${c.servicesAll.map(svcName).join('+')}`)
  if (c.servicesNone?.length) chips.push(`제외: ${c.servicesNone.map(svcName).join(',')}`)
  if (c.categoriesAny?.length) chips.push(`카테any: ${c.categoriesAny.map(catName).join(',')}`)
  if (c.prepaidServiceIds?.length) chips.push(`다담권: ${c.prepaidServiceIds.map(svcName).join(',')}`)
  if (c.pkgServiceIds?.length) chips.push(`패키지: ${c.pkgServiceIds.map(svcName).join(',')}`)
  if (c.annualServiceIds?.length) chips.push(`연간권: ${c.annualServiceIds.map(svcName).join(',')}`)
  if (c.amountMin) chips.push(`≥ ${Number(c.amountMin).toLocaleString()}`)
  if (c.amountMax) chips.push(`≤ ${Number(c.amountMax).toLocaleString()}`)
  if (c.customerHasActivePrepaid===true) chips.push('다담권 보유')
  if (c.customerHasActivePrepaid===false) chips.push('다담권 無')
  if (c.customerHasActivePkg===true) chips.push('패키지 보유')
  if (c.customerHasActivePkg===false) chips.push('패키지 無')
  if (c.customerHasActiveAnnual===true) chips.push('연간권 보유')
  if (c.customerHasActiveAnnual===false) chips.push('연간권 無')
  if (chips.length === 0) return null
  return (
    <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:4}}>
      {chips.map((c,i) => (
        <span key={i} style={{fontSize:10, padding:'2px 8px', borderRadius:4, background:T.gray100, color:T.textSub, fontWeight:600}}>{c}</span>
      ))}
    </div>
  )
}

// ─── 소형 컴포넌트 ───
function Collapsible({ title, open, setOpen, children }) {
  return (
    <div style={{marginTop:6, borderTop:`1px dashed ${T.border}`, paddingTop:6}}>
      <button onClick={()=>setOpen(!open)} style={{background:'none', border:'none', fontSize:11, fontWeight:700, color:T.textSub, cursor:'pointer', padding:'4px 0', fontFamily:'inherit'}}>
        {open?'▾':'▸'} {title}
      </button>
      {open && <div style={{paddingLeft:6}}>{children}</div>}
    </div>
  )
}

function TriFlag({ label, value, onChange }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11, marginBottom:4}}>
      <span style={{flex:1, color:T.textSub}}>{label}</span>
      {[['무관',null],['보유',true],['미보유',false]].map(([l,v])=>(
        <button key={l} onClick={()=>onChange(v)}
          style={{padding:'3px 10px', fontSize:10, fontWeight:700, borderRadius:10, border:`1px solid ${value===v?T.primary:T.border}`, background:value===v?T.primaryLt:'#fff', color:value===v?T.primary:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>
          {l}
        </button>
      ))}
    </div>
  )
}

function ProductPicker({ label, data, filter, value, onChange, emptyHint }) {
  const svcs = (data?.services||[]).filter(s => s.isActive !== false).filter(filter)
  const toggle = (id) => onChange(value.includes(id) ? value.filter(x=>x!==id) : [...value, id])
  return (
    <div style={{marginBottom:8}}>
      <div style={{fontSize:10, fontWeight:700, color:T.textSub, marginBottom:4}}>{label} <span style={{color:T.primary,fontWeight:900}}>({value.length})</span></div>
      <div style={{display:'flex', flexWrap:'wrap', gap:4, padding:8, border:`1px solid ${T.border}`, borderRadius:8, background:'#fff'}}>
        {svcs.length === 0 && <div style={{fontSize:10, color:T.textMuted}}>해당 상품 없음 (시술상품관리에서 먼저 등록)</div>}
        {svcs.map(s => {
          const on = value.includes(s.id)
          return <label key={s.id} style={{display:'inline-flex', alignItems:'center', gap:3, padding:'3px 10px', border:`1px solid ${on?T.primary:T.border}`, borderRadius:12, background:on?T.primaryLt:'#fff', cursor:'pointer', fontSize:11, color:on?T.primary:T.text, fontWeight:on?700:400}}>
            <input type="checkbox" checked={on} onChange={()=>toggle(s.id)} style={{accentColor:T.primary}}/>
            {s.name}
          </label>
        })}
      </div>
      {emptyHint && <div style={{fontSize:10, color:T.textMuted, marginTop:3}}>{emptyHint}</div>}
    </div>
  )
}

function CatPicker({ data, label='카테고리', value, onChange }) {
  const cats = (data?.categories||[]).filter(c => c.name !== '쿠폰' && c.name !== '포인트')
  const toggle = (cid) => { onChange(value.includes(cid) ? value.filter(x=>x!==cid) : [...value, cid]) }
  return (
    <div style={{marginTop:6}}>
      <div style={{fontSize:10, fontWeight:700, color:T.textSub, marginBottom:4}}>{label} <span style={{color:T.primary,fontWeight:900}}>({value.length})</span></div>
      <div style={{display:'flex', flexWrap:'wrap', gap:4, padding:8, border:`1px solid ${T.border}`, borderRadius:8, background:'#fff'}}>
        {cats.map(c => {
          const on = value.includes(c.id)
          return <label key={c.id} style={{display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', border:`1px solid ${on?T.primary:T.border}`, borderRadius:12, background:on?T.primaryLt:'#fff', cursor:'pointer', fontSize:11, color:on?T.primary:T.text, fontWeight:on?700:400}}>
            <input type="checkbox" checked={on} onChange={()=>toggle(c.id)} style={{accentColor:T.primary}}/>
            {c.name}
          </label>
        })}
      </div>
    </div>
  )
}

function SvcPicker({ data, label='시술', value, onChange }) {
  const cats = (data?.categories||[]).filter(c => c.name !== '쿠폰' && c.name !== '포인트')
  const toggle = (sid) => { onChange(value.includes(sid) ? value.filter(x=>x!==sid) : [...value, sid]) }
  return (
    <div style={{marginTop:6}}>
      <div style={{fontSize:10, fontWeight:700, color:T.textSub, marginBottom:4}}>{label} <span style={{color:T.primary,fontWeight:900}}>({value.length})</span></div>
      <div style={{maxHeight:200, overflowY:'auto', border:`1px solid ${T.border}`, borderRadius:8, padding:8, background:'#fff'}}>
        {cats.map(c => {
          const svcs = (data?.services||[]).filter(s => s.cat === c.id && s.isActive !== false)
          if (!svcs.length) return null
          return (
            <div key={c.id} style={{marginBottom:6}}>
              <div style={{fontSize:10, fontWeight:800, color:T.textSub, marginBottom:3}}>{c.name}</div>
              <div style={{display:'flex', flexWrap:'wrap', gap:3}}>
                {svcs.map(s => {
                  const on = value.includes(s.id)
                  return <label key={s.id} style={{display:'inline-flex', alignItems:'center', gap:3, padding:'2px 8px', border:`1px solid ${on?T.primary:T.border}`, borderRadius:10, background:on?T.primaryLt:'#fff', cursor:'pointer', fontSize:10, color:on?T.primary:T.text, fontWeight:on?700:400}}>
                    <input type="checkbox" checked={on} onChange={()=>toggle(s.id)} style={{accentColor:T.primary,width:10,height:10}}/>
                    {s.name}
                  </label>
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type='text', options }) {
  return (
    <div>
      <label style={{fontSize:10, fontWeight:700, color:T.textSub, display:'block', marginBottom:4}}>{label}</label>
      {type === 'select'
        ? <select className="inp" value={value||''} onChange={e=>onChange(e.target.value)}>
            {(options||[]).map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        : <input className="inp" type={type} value={value??''} onChange={e=>onChange(e.target.value)}/>
      }
    </div>
  )
}

export default AdminEvents
