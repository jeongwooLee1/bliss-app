import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { APageHeader } from './AdminUI'
import AdminCoupons from './AdminCoupons'

// ═══════════════════════════════════════════════════════════════
// 이벤트 관리
//   탭1: 쿠폰 등록 (기존 AdminCoupons 재사용)
//   탭2: 이벤트 등록 (트리거 조건 + 보상)
// ═══════════════════════════════════════════════════════════════
function AdminEvents({ data, setData, bizId }) {
  const [mode, setMode] = useState('events') // 'coupon' | 'events'
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

// 기본 이벤트 템플릿 없음 — 매장별로 유저가 "+ 새 이벤트"로 직접 생성
// (하드코딩된 시드 금지 — 멀티테넌트 원칙)

const TRIGGER_LABEL = {
  new_first_sale: '👤 신규 첫매출',
  prepaid_recharge: '💳 선불권 추가 충전',
  pkg_repurchase: '📦 패키지 재구매',
}
const REWARD_LABEL = {
  point_earn: '💰 포인트 적립',
  discount_pct: '🔖 % 할인',
  discount_flat: '🔖 정액 할인',
  coupon_issue: '🎁 쿠폰 발행',
  prepaid_bonus: '💸 다담권 보너스',
  free_service: '🎀 무료 시술권',
  // 레거시 호환
  discount: '🔖 % 할인',
}
const REWARD_COLOR = {
  point_earn: '#2E7D32',
  discount_pct: '#C62828',
  discount_flat: '#C62828',
  coupon_issue: '#E65100',
  prepaid_bonus: '#6A1B9A',
  free_service: '#00838F',
  discount: '#C62828',
}
const REWARD_BG = {
  point_earn: '#E8F5E9',
  discount_pct: '#FFEBEE',
  discount_flat: '#FFEBEE',
  coupon_issue: '#FFF3E0',
  prepaid_bonus: '#F3E5F5',
  free_service: '#E0F7FA',
  discount: '#FFEBEE',
}

function EventList({ data, setData, bizId }) {
  const biz = (data?.businesses||[]).find(b=>b.id===bizId) || (data?.businesses||[])[0]
  const settings = useMemo(()=>{
    try { return typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{}); } catch { return {}; }
  }, [biz?.settings])
  const savedEvents = Array.isArray(settings.events) ? settings.events : []
  // 매장이 직접 생성한 이벤트만 표시 — 하드코딩 템플릿 없음
  const events = savedEvents

  const [editing, setEditing] = useState(null) // event id
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [creating, setCreating] = useState(false)

  const persist = async (nextEvents) => {
    setSaving(true); setMsg('')
    try {
      const cur = typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{})
      const next = { ...cur, events: nextEvents }
      await sb.update('businesses', bizId, { settings: next })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings:next}:b)}))
      setMsg('✓ 저장됨'); setTimeout(()=>setMsg(''), 2000)
    } catch(e) { setMsg('저장 실패: '+e.message) }
    finally { setSaving(false) }
  }

  const toggle = (id) => {
    const evt = events.find(e=>e.id===id)
    const updated = { ...evt, enabled: !evt.enabled }
    const nextList = [...savedEvents.filter(e=>e.id!==id), updated]
    persist(nextList)
  }

  const startEdit = (evt) => { setEditing(evt.id); setDraft({...evt}) }
  const cancelEdit = () => { setEditing(null); setDraft({}); setCreating(false) }
  const saveEdit = () => {
    if (!draft.name?.trim()) { alert('이벤트 이름을 입력하세요'); return }
    const toSave = {...draft}
    delete toSave.isTemplate
    const nextList = [...savedEvents.filter(e=>e.id!==toSave.id), toSave]
    persist(nextList)
    setEditing(null); setDraft({}); setCreating(false)
  }
  const removeEvent = (id) => {
    if (!confirm('이 커스텀 이벤트를 삭제하시겠어요?')) return
    persist(savedEvents.filter(e=>e.id!==id))
  }
  const startCreate = () => {
    const newId = 'evt_custom_' + Math.random().toString(36).slice(2,10)
    setDraft({
      id: newId, name:'', trigger:'new_first_sale', rewardType:'point_earn',
      base:'svc', rate:10, expiryMonths:3, enabled:false, // 안전: 기본 OFF → 유저가 확인 후 ON
      desc:'', couponName:'', qty:1,
    })
    setEditing(newId); setCreating(true)
  }

  // 현재 이벤트 엔진(lib/eventEngine.js)이 처리하는 trigger × rewardType 조합
  const SUPPORTED_TRIGGERS = ['new_first_sale','prepaid_recharge','pkg_repurchase']
  const SUPPORTED_REWARDS = ['point_earn','discount_pct','discount_flat','coupon_issue','prepaid_bonus']
  const isActiveNow = (evt) => SUPPORTED_TRIGGERS.includes(evt.trigger) && SUPPORTED_REWARDS.includes(evt.rewardType)

  const masterEnabled = settings.events_master_enabled !== false // 기본 true, 명시적 false만 OFF
  const toggleMaster = async () => {
    setSaving(true); setMsg('')
    try {
      const cur = typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{})
      const next = { ...cur, events_master_enabled: !masterEnabled }
      await sb.update('businesses', bizId, { settings: next })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings:next}:b)}))
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
          📌 <strong>마스터 스위치 + 개별 토글 모두 ON</strong>이어야 반영. 신규 이벤트는 OFF 상태로 생성.<br/>
          <span style={{color:'#2E7D32', fontWeight:700}}>🟢 반영중</span> 배지: 엔진 지원 조합 · <span style={{color:T.gray500,fontWeight:700}}>⚪ 미구현</span>: 지원 외 (아직 반영 안 됨).
        </div>
        <button onClick={startCreate} disabled={saving||creating}
          style={{padding:'8px 14px', fontSize:12, fontWeight:800, borderRadius:8, border:'none', background:T.primary, color:'#fff', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap'}}>
          + 새 이벤트
        </button>
      </div>
      {msg && <div style={{padding:'6px 10px', background:'#E8F5E9', color:'#2E7D32', borderRadius:6, fontSize:12, fontWeight:700, marginBottom:10}}>{msg}</div>}
      {/* 신규 생성 인라인 폼 */}
      {creating && (
        <div style={{border:`2px dashed ${T.primary}`, background:T.primaryLt, borderRadius:10, padding:14, marginBottom:12}}>
          <div style={{fontSize:13, fontWeight:800, color:T.primaryDk, marginBottom:10}}>💥 새 이벤트 생성</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:8}}>
            <Field label="이벤트 이름" value={draft.name} onChange={v=>setDraft(p=>({...p,name:v}))}/>
            <Field label="트리거" value={draft.trigger} onChange={v=>setDraft(p=>({...p,trigger:v}))} type="select"
              options={[['new_first_sale','신규 첫매출'],['prepaid_recharge','선불권 추가 충전'],['pkg_repurchase','패키지 재구매']]}/>
            <Field label="보상 타입" value={draft.rewardType} onChange={v=>setDraft(p=>({...p,rewardType:v}))} type="select"
              options={[['point_earn','포인트 적립'],['discount_pct','% 할인'],['discount_flat','정액 할인'],['coupon_issue','쿠폰 발행'],['prepaid_bonus','다담권 보너스'],['free_service','무료 시술권']]}/>
            {(draft.rewardType==='point_earn') && <>
              <Field label="적립 기준" value={draft.base} onChange={v=>setDraft(p=>({...p,base:v}))} type="select" options={[['svc','시술 전체'],['svc_prod','시술+제품'],['prepaid_amount','충전금액'],['category','특정 카테고리 (복수)'],['services','특정 시술 (복수)']]}/>
              <Field label="적립률 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
              <Field label="유효기간 (개월)" value={draft.expiryMonths} onChange={v=>setDraft(p=>({...p,expiryMonths:Math.max(1,+v||1)}))} type="number"/>
              {draft.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} value={draft.baseCategoryIds||[]} onChange={v=>setDraft(p=>({...p,baseCategoryIds:v}))}/></div>}
              {draft.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} value={draft.baseServiceIds||[]} onChange={v=>setDraft(p=>({...p,baseServiceIds:v}))}/></div>}
            </>}
            {draft.rewardType==='discount_pct' && <>
              <Field label="할인 기준" value={draft.base} onChange={v=>setDraft(p=>({...p,base:v}))} type="select" options={[['svc','시술 전체'],['svc_prod','시술+제품'],['category','특정 카테고리 (복수)'],['services','특정 시술 (복수)']]}/>
              <Field label="할인율 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
              {draft.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} value={draft.baseCategoryIds||[]} onChange={v=>setDraft(p=>({...p,baseCategoryIds:v}))}/></div>}
              {draft.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} value={draft.baseServiceIds||[]} onChange={v=>setDraft(p=>({...p,baseServiceIds:v}))}/></div>}
            </>}
            {draft.rewardType==='discount_flat' && <>
              <Field label="할인 금액 (원)" value={draft.value} onChange={v=>setDraft(p=>({...p,value:+v||0}))} type="number"/>
            </>}
            {draft.rewardType==='coupon_issue' && <>
              <Field label="발행 쿠폰" value={draft.couponName} onChange={v=>setDraft(p=>({...p,couponName:v}))} type="select"
                options={[['','쿠폰 선택'],...(data?.services||[]).filter(s=>{const c=(data?.categories||[]).find(cc=>cc.id===s.cat);return c?.name==='쿠폰'}).map(s=>[s.name,s.name])]}/>
              <Field label="수량" value={draft.qty} onChange={v=>setDraft(p=>({...p,qty:Math.max(1,+v||1)}))} type="number"/>
              <Field label="유효기간 (개월)" value={draft.expiryMonths} onChange={v=>setDraft(p=>({...p,expiryMonths:Math.max(1,+v||1)}))} type="number"/>
            </>}
            {draft.rewardType==='prepaid_bonus' && <>
              <Field label="보너스율 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
            </>}
            {draft.rewardType==='free_service' && <>
              <div style={{gridColumn:'1 / -1', fontSize:10, color:T.textSub, padding:'6px 8px', background:T.gray100, borderRadius:6}}>
                💡 무료 시술권은 <strong>쿠폰 등록</strong> 탭에서 대상 시술(복수 선택)까지 설정한 쿠폰을 만든 뒤 <strong>쿠폰 발행</strong> 타입으로 이 이벤트를 구성하세요. 여기서는 발행만 자동화되고 실제 "무료 처리"는 쿠폰 자동적용 엔진이 담당합니다.
              </div>
            </>}
          </div>
          <Field label="설명 (선택)" value={draft.desc} onChange={v=>setDraft(p=>({...p,desc:v}))}/>
          <div style={{marginTop:10, display:'flex', gap:8, justifyContent:'flex-end'}}>
            <button onClick={cancelEdit} style={{padding:'6px 14px', fontSize:12, fontWeight:700, borderRadius:6, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>취소</button>
            <button onClick={saveEdit} disabled={saving} style={{padding:'6px 16px', fontSize:12, fontWeight:800, borderRadius:6, border:'none', background:saving?T.gray300:T.primary, color:'#fff', cursor:saving?'default':'pointer', fontFamily:'inherit'}}>생성</button>
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
          const color = REWARD_COLOR[evt.rewardType] || T.text
          const bg = REWARD_BG[evt.rewardType] || '#fff'
          const isEdit = editing === evt.id
          return (
            <div key={evt.id} style={{border:`1.5px solid ${evt.enabled?color:T.border}`, background:evt.enabled?bg:'#fff', borderRadius:10, padding:14}}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap'}}>
                {/* 스위치 스타일 ON/OFF */}
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
                <span style={{fontSize:14, fontWeight:800, color:evt.enabled?color:T.text, flex:1, minWidth:120}}>{evt.name||'(이름 없음)'}</span>
                <span style={{fontSize:10, padding:'2px 8px', borderRadius:4, background:T.gray100, color:T.textSub, fontWeight:700}}>{TRIGGER_LABEL[evt.trigger]||evt.trigger}</span>
                <span style={{fontSize:10, padding:'2px 8px', borderRadius:4, background:bg, color, fontWeight:700, border:`1px solid ${color}55`}}>{REWARD_LABEL[evt.rewardType]||evt.rewardType}</span>
                {isActiveNow(evt)
                  ? <span style={{fontSize:9, padding:'2px 6px', borderRadius:4, background:'#E8F5E9', color:'#2E7D32', fontWeight:800, border:'1px solid #A5D6A7'}}>🟢 반영중</span>
                  : <span style={{fontSize:9, padding:'2px 6px', borderRadius:4, background:T.gray100, color:T.gray500, fontWeight:800}}>⚪ 미구현</span>
                }
                {!isEdit && <button onClick={()=>startEdit(evt)} style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>수정</button>}
                {!isEdit && <button onClick={()=>removeEvent(evt.id)} title="삭제"
                  style={{padding:'4px 10px', fontSize:11, fontWeight:700, borderRadius:6, border:`1px solid ${T.danger}`, background:'#fff', color:T.danger, cursor:'pointer', fontFamily:'inherit'}}>삭제</button>}
              </div>
              {evt.desc && <div style={{fontSize:11, color:T.textSub, lineHeight:1.5}}>{evt.desc}</div>}
              {isEdit && (
                <div style={{marginTop:10, padding:12, background:'#fff', borderRadius:8, border:`1px solid ${T.border}`}}>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10}}>
                    {evt.rewardType === 'point_earn' && <>
                      <Field label="적립 기준" value={draft.base} onChange={v=>setDraft(p=>({...p,base:v}))} type="select" options={[['svc','시술 전체'],['svc_prod','시술+제품'],['prepaid_amount','충전금액'],['category','특정 카테고리 (복수)'],['services','특정 시술 (복수)']]}/>
                      <Field label="적립률 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
                      <Field label="유효기간 (개월)" value={draft.expiryMonths} onChange={v=>setDraft(p=>({...p,expiryMonths:Math.max(1,+v||1)}))} type="number"/>
                      {draft.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} value={draft.baseCategoryIds||[]} onChange={v=>setDraft(p=>({...p,baseCategoryIds:v}))}/></div>}
                      {draft.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} value={draft.baseServiceIds||[]} onChange={v=>setDraft(p=>({...p,baseServiceIds:v}))}/></div>}
                    </>}
                    {(evt.rewardType === 'discount' || evt.rewardType === 'discount_pct') && <>
                      <Field label="할인 기준" value={draft.base} onChange={v=>setDraft(p=>({...p,base:v}))} type="select" options={[['svc','시술 전체'],['svc_prod','시술+제품'],['category','특정 카테고리 (복수)'],['services','특정 시술 (복수)']]}/>
                      <Field label="할인율 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
                      {draft.base==='category' && <div style={{gridColumn:'1 / -1'}}><CatPicker data={data} value={draft.baseCategoryIds||[]} onChange={v=>setDraft(p=>({...p,baseCategoryIds:v}))}/></div>}
                      {draft.base==='services' && <div style={{gridColumn:'1 / -1'}}><SvcPicker data={data} value={draft.baseServiceIds||[]} onChange={v=>setDraft(p=>({...p,baseServiceIds:v}))}/></div>}
                    </>}
                    {evt.rewardType === 'discount_flat' && <>
                      <Field label="할인 금액 (원)" value={draft.value} onChange={v=>setDraft(p=>({...p,value:+v||0}))} type="number"/>
                    </>}
                    {evt.rewardType === 'coupon_issue' && <>
                      <Field label="발행 쿠폰" value={draft.couponName} onChange={v=>setDraft(p=>({...p,couponName:v}))} type="select"
                        options={(data?.services||[]).filter(s=>{const c=(data?.categories||[]).find(cc=>cc.id===s.cat);return c?.name==='쿠폰'}).map(s=>[s.name,s.name])}/>
                      <Field label="수량" value={draft.qty} onChange={v=>setDraft(p=>({...p,qty:Math.max(1,+v||1)}))} type="number"/>
                      <Field label="유효기간 (개월)" value={draft.expiryMonths} onChange={v=>setDraft(p=>({...p,expiryMonths:Math.max(1,+v||1)}))} type="number"/>
                    </>}
                    {evt.rewardType === 'prepaid_bonus' && <>
                      <Field label="보너스율 (%)" value={draft.rate} onChange={v=>setDraft(p=>({...p,rate:+v||0}))} type="number"/>
                    </>}
                  </div>
                  <div style={{marginTop:10, display:'flex', gap:8, justifyContent:'flex-end'}}>
                    <button onClick={cancelEdit} style={{padding:'6px 14px', fontSize:12, fontWeight:700, borderRadius:6, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit'}}>취소</button>
                    <button onClick={saveEdit} disabled={saving} style={{padding:'6px 14px', fontSize:12, fontWeight:800, borderRadius:6, border:'none', background:saving?T.gray300:T.primary, color:'#fff', cursor:saving?'default':'pointer', fontFamily:'inherit'}}>저장</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CatPicker({ data, value, onChange }) {
  const cats = (data?.categories||[]).filter(c => c.name !== '쿠폰' && c.name !== '포인트')
  const toggle = (cid) => { onChange(value.includes(cid) ? value.filter(x=>x!==cid) : [...value, cid]) }
  return (
    <div style={{marginTop:6}}>
      <div style={{fontSize:10, fontWeight:700, color:T.textSub, marginBottom:4}}>대상 카테고리 (복수) <span style={{color:T.primary,fontWeight:900}}>({value.length})</span></div>
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

function SvcPicker({ data, value, onChange }) {
  const cats = (data?.categories||[]).filter(c => c.name !== '쿠폰' && c.name !== '포인트')
  const toggle = (sid) => { onChange(value.includes(sid) ? value.filter(x=>x!==sid) : [...value, sid]) }
  return (
    <div style={{marginTop:6}}>
      <div style={{fontSize:10, fontWeight:700, color:T.textSub, marginBottom:4}}>대상 시술 (복수) <span style={{color:T.primary,fontWeight:900}}>({value.length})</span></div>
      <div style={{maxHeight:240, overflowY:'auto', border:`1px solid ${T.border}`, borderRadius:8, padding:8, background:'#fff'}}>
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
