import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { genId } from '../../lib/utils'
import { APageHeader } from './AdminUI'

// ═══════════════════════════════════════════════════════════════
// 10% 쿠폰 → 포인트 소급 전환
//   탭1: 매출메모 소급 (point_migration_candidates)
//   탭2: 유효 쿠폰 보유자 (point_coupon_holders) — 메모에 금액 없어 소급 누락된 분
// ═══════════════════════════════════════════════════════════════
function AdminPointMigration({ data, setData, bizId }) {
  const [mode, setMode] = useState('memo') // 'memo' | 'coupon'

  return (
    <div>
      <APageHeader title="쿠폰 → 포인트 소급 전환" desc="임시 마이그레이션 작업 — 데이터 안정화 후 메뉴 삭제 예정" />
      <div style={{display:'flex', gap:6, marginBottom:12, borderBottom:`2px solid ${T.border}`}}>
        {[
          ['memo','📝 매출메모 소급'],
          ['coupon','🎫 유효 쿠폰 보유자'],
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
      {mode==='memo' && <MemoSection/>}
      {mode==='coupon' && <CouponSection/>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 탭0: 적립 이벤트 규칙 설정
// ═══════════════════════════════════════════════════════════════
function EventsSection({ data, setData, bizId }) {
  const biz = (data?.businesses||[]).find(b=>b.id===bizId) || (data?.businesses||[])[0]
  const settings = (()=>{ try { return typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{}); } catch { return {}; } })()
  const defaultEvent = { enabled: false, rate: 10, expiryMonths: 3, base: 'svc' }
  const current = settings.point_events?.newcust_10pct || defaultEvent
  const [form, setForm] = useState(current)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const cur = typeof biz?.settings==='string' ? JSON.parse(biz.settings) : (biz?.settings||{})
      const next = {
        ...cur,
        point_events: {
          ...(cur.point_events||{}),
          newcust_10pct: form,
        }
      }
      await sb.update('businesses', bizId, { settings: next })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings: next}:b)}))
      setMsg('✓ 저장됨')
      setTimeout(()=>setMsg(''), 2000)
    } catch (e) { setMsg('저장 실패: '+e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="card" style={{padding:16, marginBottom:12, border:`1px solid ${T.border}`, borderRadius:8}}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:12}}>
          <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
            <input type="checkbox" checked={!!form.enabled} onChange={e=>setForm(p=>({...p, enabled:e.target.checked}))}/>
            <span style={{fontSize:14, fontWeight:800, color:T.text}}>🎉 신규 고객 {form.rate}% 포인트 이벤트</span>
          </label>
          <span style={{fontSize:11, color:T.textMuted}}>매출 등록 시 자동 감지 · 포인트 적립 칸 자동 채움</span>
        </div>
        <div style={{fontSize:12, color:T.textSub, background:T.gray100, padding:'10px 12px', borderRadius:6, marginBottom:12, lineHeight:1.6}}>
          <strong>조건 (전부 만족 시 자동 적용)</strong><br/>
          • 고객이 <strong>신규</strong> (방문 0회 또는 처음 매출 등록)<br/>
          • 이번 매출에 <strong>선불권(다담권) 구매 없음</strong><br/>
          • 이번 매출에 <strong>패키지 구매 없음</strong>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12}}>
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.textSub, display:'block', marginBottom:4}}>적립 기준</label>
            <select className="inp" value={form.base} onChange={e=>setForm(p=>({...p, base:e.target.value}))}>
              <option value="svc">시술 금액만 (제품 제외)</option>
              <option value="svc_prod">시술 + 제품</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.textSub, display:'block', marginBottom:4}}>적립률 (%)</label>
            <input className="inp" type="number" min="0" max="100" value={form.rate}
              onChange={e=>setForm(p=>({...p, rate:Math.max(0, Number(e.target.value)||0)}))}/>
          </div>
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.textSub, display:'block', marginBottom:4}}>유효기간 (개월)</label>
            <input className="inp" type="number" min="1" max="36" value={form.expiryMonths}
              onChange={e=>setForm(p=>({...p, expiryMonths:Math.max(1, Number(e.target.value)||1)}))}/>
          </div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:10, marginTop:16}}>
          <button onClick={save} disabled={saving}
            style={{padding:'8px 20px', fontSize:13, fontWeight:800, borderRadius:8, border:'none', background:saving?T.gray300:T.primary, color:'#fff', cursor:saving?'default':'pointer', fontFamily:'inherit'}}>
            {saving?'저장 중…':'💾 저장'}
          </button>
          {msg && <span style={{fontSize:12, color:msg.startsWith('✓')?'#2E7D32':T.danger, fontWeight:700}}>{msg}</span>}
        </div>
      </div>
      <div style={{fontSize:11, color:T.textMuted, padding:'8px 12px', background:'#FFF8E1', borderRadius:6, border:'1px solid #FFECB3'}}>
        📌 저장 후 매출 등록 화면에서 조건 만족 시 <strong>포인트 적립 칸이 자동으로 채워집니다</strong>. 수동 수정 가능하며 체크 해제하면 적립 안 됨.
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 탭1: 매출메모 소급
// ═══════════════════════════════════════════════════════════════
function MemoSection() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState({})
  const [edits, setEdits] = useState({})
  const [filter, setFilter] = useState('pending')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')

  const load = async (refresh=false) => {
    setLoading(true); setMsg('')
    try {
      if (refresh) {
        try {
          await fetch(`${SB_URL}/rest/v1/rpc/refresh_point_migration_candidates`, {
            method:'POST', headers:{...sbHeaders, 'Content-Type':'application/json'}, body:'{}'
          })
        } catch {}
      }
      const r = await fetch(`${SB_URL}/rest/v1/point_migration_candidates?select=*&order=suggested_points.desc&limit=2000`,
        {headers:{...sbHeaders,'Cache-Control':'no-cache'},cache:'no-store'})
      const data = r.ok ? await r.json() : []
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setMsg('스캔 실패: '+(e.message||e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'coupon' && !r.has_coupon) return false
      if (filter === 'pending' && r.already_migrated) return false
      if (q) {
        const hay = `${r.cust_name||''} ${r.cust_num||''} ${r.memo_preview||''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filter, search])

  const selectedRows = filtered.filter(r => selected[r.sale_id] && !r.already_migrated)
  const selectedTotal = selectedRows.reduce((s,r) => s + (edits[r.sale_id] ?? r.suggested_points ?? 0), 0)
  const pendingTotal = filtered.filter(r=>!r.already_migrated).reduce((s,r)=>s+(edits[r.sale_id]??r.suggested_points??0),0)

  const toggleAll = (on) => {
    const next = {...selected}
    filtered.forEach(r => {
      if (r.already_migrated || (edits[r.sale_id] ?? r.suggested_points) <= 0) return
      next[r.sale_id] = !!on
    })
    setSelected(next)
  }

  const runMigration = async () => {
    if (!selectedRows.length) { setMsg('선택된 항목이 없습니다'); return }
    if (!confirm(`${selectedRows.length}건에 총 ${selectedTotal.toLocaleString()}P 적립 + 해당 고객의 '10%추가적립쿠폰' 삭제.\n진행?`)) return
    setSaving(true); setMsg('')
    let ok=0, fail=0
    const deletedCoupons = new Set()
    for (const r of selectedRows) {
      try {
        const pts = edits[r.sale_id] ?? r.suggested_points
        if (!pts || pts <= 0) continue
        await sb.insert('point_transactions', {
          id: 'ptx_mig_' + genId(),
          business_id: r.business_id, bid: r.bid, customer_id: r.cust_id,
          type: 'earn', amount: pts, sale_id: r.sale_id,
          staff_id: r.staff_id, staff_name: r.staff_name,
          source: 'migrate_10pct',
          note: `쿠폰→포인트 소급 (매출 ${r.sale_total.toLocaleString()}원 → ${pts.toLocaleString()}P)`,
          expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        })
        if (r.coupon_id && !deletedCoupons.has(r.coupon_id)) {
          try { await sb.del('customer_packages', r.coupon_id); deletedCoupons.add(r.coupon_id) } catch {}
        }
        ok++
      } catch(e) { console.error(e); fail++ }
    }
    setSaving(false)
    setMsg(`완료: 성공 ${ok} / 실패 ${fail} / 쿠폰삭제 ${deletedCoupons.size}`)
    setSelected({}); setEdits({}); load(true)
  }

  return <>
    <div className="card" style={{padding:16, marginBottom:12, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12}}>
      <Stat label="후보 총" value={rows.length} />
      <Stat label="처리 대기" value={rows.filter(r=>!r.already_migrated).length} />
      <Stat label="이미 처리" value={rows.filter(r=>r.already_migrated).length} />
      <Stat label="대기 포인트" value={pendingTotal.toLocaleString()+'P'} />
    </div>
    <FilterBar filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} loading={loading} onReload={()=>load(true)}
      options={[['pending','미처리'],['all','전체'],['coupon','쿠폰 보유만']]}/>
    <ActionBar selectedRows={selectedRows} selectedTotal={selectedTotal} saving={saving}
      onSelectAll={()=>toggleAll(true)} onClear={()=>toggleAll(false)} onRun={runMigration} label="선택 등록"/>
    {msg && <MsgBox msg={msg}/>}
    <MemoTable filtered={filtered} selected={selected} setSelected={setSelected} edits={edits} setEdits={setEdits}/>
  </>
}

function MemoTable({ filtered, selected, setSelected, edits, setEdits }) {
  return (
    <div style={{border:'1px solid '+T.border, borderRadius:8, overflow:'hidden', background:T.bgCard}}>
      <div style={hdStyle(9)}>
        <div></div><div>매출일</div><div>고객번호</div><div>이름</div>
        <div style={{textAlign:'right'}}>매출</div><div style={{textAlign:'right'}}>포인트</div>
        <div style={{textAlign:'center'}}>쿠폰</div><div>만료</div><div>메모</div>
      </div>
      <div style={{maxHeight:600, overflowY:'auto'}}>
        {filtered.length===0 && <div style={emptyStyle}>대상 없음</div>}
        {filtered.map(r => {
          const done = r.already_migrated
          const pts = edits[r.sale_id] ?? r.suggested_points ?? 0
          const checked = !!selected[r.sale_id]
          return (
            <div key={r.sale_id} style={{...rowStyle(9), opacity:done?0.5:1, background:done?'#FAFAFA':'#fff'}}>
              <input type="checkbox" checked={checked} disabled={done || pts<=0}
                onChange={e=>setSelected(p=>({...p,[r.sale_id]:e.target.checked}))}/>
              <div style={cellMono}>{r.sale_date}</div>
              <div style={cellMono}>{r.cust_num||'-'}</div>
              <div style={cellBold}>{r.cust_name||'-'}</div>
              <div style={cellRight}>{(r.sale_total||0).toLocaleString()}</div>
              <div style={{textAlign:'right'}}>
                <input type="number" value={pts} disabled={done}
                  onChange={e=>setEdits(p=>({...p,[r.sale_id]:Math.max(0,parseInt(e.target.value)||0)}))}
                  style={ptsInput}/>
              </div>
              <div style={{textAlign:'center', fontSize:14}}>{r.has_coupon ? <span style={{color:'#2E7D32'}}>✓</span> : <span style={{color:T.gray400}}>✗</span>}</div>
              <div style={cellMono}>{r.expires_at}</div>
              <div style={cellEllipsis} title={r.memo_preview}>{r.memo_preview}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 탭2: 유효 쿠폰 보유자
// ═══════════════════════════════════════════════════════════════
function CouponSection() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState({})
  const [edits, setEdits] = useState({})
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    setLoading(true); setMsg('')
    try {
      const r = await fetch(`${SB_URL}/rest/v1/point_coupon_holders?select=*&order=suggested_points.desc.nullslast&limit=2000`,
        {headers:{...sbHeaders,'Cache-Control':'no-cache'},cache:'no-store'})
      const data = r.ok ? await r.json() : []
      setRows(Array.isArray(data) ? data : [])
    } catch(e) { setMsg('스캔 실패: '+(e.message||e)) }
    finally { setLoading(false) }
  }
  useEffect(()=>{ load() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (!q) return true
      const hay = `${r.cust_name||''} ${r.cust_num||''} ${r.phone||''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  const selectedRows = filtered.filter(r => selected[r.coupon_id] && !r.already_migrated)
  const selectedTotal = selectedRows.reduce((s,r)=>s+(edits[r.coupon_id]??r.suggested_points??0),0)
  const pendingTotal = filtered.filter(r=>!r.already_migrated).reduce((s,r)=>s+(edits[r.coupon_id]??r.suggested_points??0),0)

  const toggleAll = (on) => {
    const next = {...selected}
    filtered.forEach(r => {
      if (r.already_migrated || (edits[r.coupon_id]??r.suggested_points) <= 0) return
      next[r.coupon_id] = !!on
    })
    setSelected(next)
  }

  const runMigration = async () => {
    if (!selectedRows.length) { setMsg('선택된 항목이 없습니다'); return }
    if (!confirm(`${selectedRows.length}명에 총 ${selectedTotal.toLocaleString()}P 적립 + 쿠폰 ${selectedRows.length}장 삭제.\n진행?`)) return
    setSaving(true); setMsg('')
    let ok=0, fail=0, delOk=0
    for (const r of selectedRows) {
      try {
        const pts = edits[r.coupon_id] ?? r.suggested_points
        if (!pts || pts <= 0) continue
        await sb.insert('point_transactions', {
          id: 'ptx_cpn_' + genId(),
          business_id: r.business_id, bid: r.bid, customer_id: r.customer_id,
          type: 'earn', amount: pts, sale_id: r.sale_id || null,
          staff_id: r.staff_id || null, staff_name: r.staff_name || null,
          source: 'migrate_10pct_coupon',
          note: `유효쿠폰 소급 (직전매출 ${(r.sale_total||0).toLocaleString()}원 → ${pts.toLocaleString()}P) · 쿠폰 만료 ${r.coupon_expires}`,
          expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        })
        ok++
        if (r.coupon_id) {
          try { await sb.del('customer_packages', r.coupon_id); delOk++ } catch {}
        }
      } catch(e) { console.error(e); fail++ }
    }
    setSaving(false)
    setMsg(`완료: 적립 성공 ${ok} / 실패 ${fail} / 쿠폰삭제 ${delOk}`)
    setSelected({}); setEdits({}); load()
  }

  return <>
    <div className="card" style={{padding:16, marginBottom:12, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12}}>
      <Stat label="유효 쿠폰 보유" value={rows.length+'명'} />
      <Stat label="처리 대기" value={rows.filter(r=>!r.already_migrated).length+'명'} />
      <Stat label="이미 처리" value={rows.filter(r=>r.already_migrated).length+'명'} />
      <Stat label="대기 포인트" value={pendingTotal.toLocaleString()+'P'} />
    </div>
    <div style={{display:'flex', gap:8, marginBottom:10}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름/고객번호/전화 검색"
        style={{flex:1, padding:'6px 10px', fontSize:12, borderRadius:7, border:'1px solid '+T.border, fontFamily:'inherit'}} />
      <button onClick={load} disabled={loading} style={btnSec}>{loading?'로딩…':'🔄 다시 스캔'}</button>
    </div>
    <ActionBar selectedRows={selectedRows} selectedTotal={selectedTotal} saving={saving}
      onSelectAll={()=>toggleAll(true)} onClear={()=>toggleAll(false)} onRun={runMigration} label="선택 적립"/>
    {msg && <MsgBox msg={msg}/>}
    <div style={{border:'1px solid '+T.border, borderRadius:8, overflow:'hidden', background:T.bgCard}}>
      <div style={hdStyle(8)}>
        <div></div><div>고객번호</div><div>이름</div><div>전화</div>
        <div style={{textAlign:'right'}}>직전매출</div><div style={{textAlign:'right'}}>포인트</div>
        <div>쿠폰만료</div><div>포인트만료</div>
      </div>
      <div style={{maxHeight:600, overflowY:'auto'}}>
        {filtered.length===0 && <div style={emptyStyle}>대상 없음</div>}
        {filtered.map(r => {
          const done = r.already_migrated
          const pts = edits[r.coupon_id] ?? r.suggested_points ?? 0
          const checked = !!selected[r.coupon_id]
          return (
            <div key={r.coupon_id} style={{...rowStyle(8), opacity:done?0.5:1, background:done?'#FAFAFA':'#fff'}}>
              <input type="checkbox" checked={checked} disabled={done || pts<=0}
                onChange={e=>setSelected(p=>({...p,[r.coupon_id]:e.target.checked}))}/>
              <div style={cellMono}>{r.cust_num||'-'}</div>
              <div style={cellBold}>{r.cust_name||'-'}</div>
              <div style={cellMono}>{r.phone||'-'}</div>
              <div style={cellRight}>{(r.sale_total||0).toLocaleString()}</div>
              <div style={{textAlign:'right'}}>
                <input type="number" value={pts} disabled={done}
                  onChange={e=>setEdits(p=>({...p,[r.coupon_id]:Math.max(0,parseInt(e.target.value)||0)}))}
                  style={ptsInput}/>
              </div>
              <div style={cellMono}>{r.coupon_expires}</div>
              <div style={cellMono}>{r.coupon_expires}</div>
            </div>
          )
        })}
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════════
// 공통 컴포넌트
// ═══════════════════════════════════════════════════════════════
function Stat({ label, value }) {
  return <div style={{textAlign:'center'}}>
    <div style={{fontSize:10,color:T.textMuted,fontWeight:700,marginBottom:2}}>{label}</div>
    <div style={{fontSize:18,fontWeight:900,color:T.primaryDk}}>{value}</div>
  </div>
}

function FilterBar({ filter, setFilter, search, setSearch, loading, onReload, options }) {
  return <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap'}}>
    {options.map(([k,l])=>(
      <button key={k} onClick={()=>setFilter(k)} style={{
        padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:7,
        border:'1px solid '+(filter===k?T.primary:T.border),
        background: filter===k?T.primary:T.bgCard, color: filter===k?'#fff':T.textSub,
        cursor:'pointer', fontFamily:'inherit'}}>{l}</button>
    ))}
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름/번호/메모 검색"
      style={{flex:1, minWidth:150, padding:'6px 10px', fontSize:12, borderRadius:7, border:'1px solid '+T.border, fontFamily:'inherit'}} />
    <button onClick={onReload} disabled={loading} style={btnSec}>{loading?'스캔 중…':'🔄 다시 스캔'}</button>
  </div>
}

function ActionBar({ selectedRows, selectedTotal, saving, onSelectAll, onClear, onRun, label }) {
  return <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, padding:'8px 12px', background:T.primaryLt, borderRadius:8}}>
    <button onClick={onSelectAll} style={btnSec}>✓ 현재 필터 전체 선택</button>
    <button onClick={onClear} style={btnSec}>□ 선택 해제</button>
    <div style={{flex:1, fontSize:12, color:T.text, fontWeight:700}}>
      선택 <span style={{color:T.primaryDk}}>{selectedRows.length}</span>건 / <span style={{color:T.primaryDk}}>{selectedTotal.toLocaleString()}P</span> 적립
    </div>
    <button onClick={onRun} disabled={saving || !selectedRows.length}
      style={{...btnSec, background: selectedRows.length&&!saving?T.primary:T.gray300, color:'#fff', fontWeight:800, border:'none'}}>
      {saving ? '등록 중…' : '💰 '+label}
    </button>
  </div>
}

function MsgBox({ msg }) {
  return <div style={{padding:'8px 12px', background:'#E8F5E9', color:'#2E7D32', borderRadius:7, fontSize:12, fontWeight:700, marginBottom:10}}>{msg}</div>
}

// 스타일
const btnSec = { padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:7, border:'1px solid '+T.border, background:T.bgCard, color:T.textSub, cursor:'pointer', fontFamily:'inherit' }
const hdStyle = (cols) => ({
  display:'grid',
  gridTemplateColumns: cols===9 ? '30px 90px 60px 120px 80px 100px 50px 80px 1fr' : '30px 60px 100px 100px 90px 100px 90px 90px',
  gap:8, padding:'8px 12px', background:T.gray100, fontSize:11, fontWeight:700, color:T.textSub, borderBottom:'1px solid '+T.border
})
const rowStyle = (cols) => ({
  display:'grid',
  gridTemplateColumns: cols===9 ? '30px 90px 60px 120px 80px 100px 50px 80px 1fr' : '30px 60px 100px 100px 90px 100px 90px 90px',
  gap:8, padding:'8px 12px', fontSize:11, borderBottom:'1px solid '+T.border, alignItems:'center'
})
const cellMono = { color:T.textSub, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
const cellBold = { fontWeight:700, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
const cellRight = { textAlign:'right', color:T.textSub, fontFamily:'monospace' }
const cellEllipsis = { color:T.textSub, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
const emptyStyle = { padding:24, textAlign:'center', color:T.textMuted, fontSize:12 }
const ptsInput = { width:80, padding:'2px 4px', textAlign:'right', fontSize:11, borderRadius:4, border:'1px solid '+T.border, fontFamily:'monospace', fontWeight:700, color:T.primary }

export default AdminPointMigration
