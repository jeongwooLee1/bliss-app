import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { APageHeader } from './AdminUI'
import { ShareCustModal } from '../Customers/ShareCustModal'

// 메모에 커플 키워드가 있는 고객 검수 — 짝꿍 지정 시 customer_shares 정식 연결
// (보유권 마킹 "커플:<gid>"는 별도 트랙 — AdminCouplePkgMigrate 사용)
const KEYWORDS = ['커플패키지', '커플 패키지', '커플프리패스', '커플 프리패스', '커패']
const MEMO_OR = `or=(${KEYWORDS.map(k => `memo.ilike.*${encodeURIComponent(k)}*`).join(',')})`

function AdminCoupleMemoReview({ data, userBranches = [], setPendingOpenCust, setPage }) {
  const branches = useMemo(
    () => (data?.branches || []).filter(b => b.useYn !== false && (userBranches.length === 0 || userBranches.includes(b.id))),
    [data?.branches, userBranches]
  )

  const [custs, setCusts] = useState([])           // 매칭 고객
  const [sharesByCust, setSharesByCust] = useState({})  // {custId: [{id, partnerId}]}
  const [partnerNames, setPartnerNames] = useState({})  // {custId: 'name'} — 짝꿍 이름
  const [pkgsByCust, setPkgsByCust] = useState({})      // {custId: [{service_name, total, used, ...}]}
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [branchSel, setBranchSel] = useState('all')
  const [partnerFor, setPartnerFor] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [memoOpen, setMemoOpen] = useState({})     // {custId: true} — 메모 전체 보기 토글

  const load = async () => {
    if (!_activeBizId) return
    setLoading(true); setErr('')
    try {
      const url = `${SB_URL}/rest/v1/customers?business_id=eq.${_activeBizId}&${MEMO_OR}&select=id,name,name2,phone,cust_num,memo,bid&order=name.asc&limit=2000`
      const r = await fetch(url, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const list = await r.json()
      const cl = Array.isArray(list) ? list : []
      setCusts(cl)

      const ids = cl.map(c => c.id)
      if (ids.length === 0) { setSharesByCust({}); setPartnerNames({}); setPkgsByCust({}); setLoading(false); return }

      // customer_shares — 양쪽 방향 lookup
      const shareMap = {}
      const partnerIds = new Set()
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100)
        const inList = batch.join(',')
        const sr = await fetch(`${SB_URL}/rest/v1/customer_shares?or=(cust_id_a.in.(${inList}),cust_id_b.in.(${inList}))&select=id,cust_id_a,cust_id_b`, { headers: sbHeaders })
        const ss = await sr.json()
        ;(ss || []).forEach(s => {
          const a = s.cust_id_a, b = s.cust_id_b
          if (batch.includes(a)) { (shareMap[a] = shareMap[a] || []).push({ id: s.id, partnerId: b }); partnerIds.add(b) }
          if (batch.includes(b)) { (shareMap[b] = shareMap[b] || []).push({ id: s.id, partnerId: a }); partnerIds.add(a) }
        })
      }
      setSharesByCust(shareMap)

      // 짝꿍 이름 lookup (매칭 고객 외부 ID 포함)
      const pidList = [...partnerIds].filter(pid => !ids.includes(pid))
      const nameMap = {}
      for (let i = 0; i < pidList.length; i += 200) {
        const batch = pidList.slice(i, i + 200)
        const pr = await fetch(`${SB_URL}/rest/v1/customers?id=in.(${batch.join(',')})&select=id,name`, { headers: sbHeaders })
        const ps = await pr.json()
        ;(ps || []).forEach(p => { nameMap[p.id] = p.name || '(이름 없음)' })
      }
      // 매칭 고객끼리도 매핑
      cl.forEach(c => { nameMap[c.id] = c.name || '(이름 없음)' })
      setPartnerNames(nameMap)

      // 활성 보유권 (참고용)
      const pkgMap = {}
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100)
        const pr = await fetch(`${SB_URL}/rest/v1/customer_packages?customer_id=in.(${batch.join(',')})&select=id,customer_id,service_name,total_count,used_count,note&order=created_at.desc`, { headers: sbHeaders })
        const ps = await pr.json()
        ;(ps || []).forEach(p => {
          const remain = (p.total_count || 0) - (p.used_count || 0)
          if (remain <= 0) return // 소진된 건 제외
          ;(pkgMap[p.customer_id] = pkgMap[p.customer_id] || []).push({ name: p.service_name, remain, total: p.total_count || 0, hasCpl: /커플:/.test(p.note || '') })
        })
      }
      setPkgsByCust(pkgMap)
    } catch (e) {
      setErr(e?.message || String(e))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const branchShort = (bid) => {
    const b = (data?.branches || []).find(x => x.id === bid)
    return b ? (b.short || b.name) : ''
  }

  const filtered = useMemo(() => {
    return custs.filter(c => {
      if (branchSel === 'unassigned') { if (c.bid) return false }
      else if (branchSel !== 'all') { if (c.bid !== branchSel) return false }
      else if (userBranches.length && c.bid && !userBranches.includes(c.bid)) return false
      if (search.trim()) {
        const hay = [c.name, c.name2, c.phone, c.cust_num, c.memo].filter(Boolean).join(' ').toLowerCase()
        if (!search.trim().toLowerCase().split(/\s+/).every(t => hay.includes(t))) return false
      }
      return true
    })
  }, [custs, search, branchSel, userBranches])

  const pendingCount = useMemo(() => filtered.filter(c => !(sharesByCust[c.id] || []).length).length, [filtered, sharesByCust])

  const applyPartner = async (partner) => {
    if (!partnerFor || !partner?.id) return
    const a = partnerFor.id, b = partner.id
    if (a === b) { alert('본인은 짝꿍이 될 수 없습니다.'); return }
    setBusyId(a)
    try {
      const ex = await sb.get('customer_shares', `&or=(and(cust_id_a.eq.${a},cust_id_b.eq.${b}),and(cust_id_a.eq.${b},cust_id_b.eq.${a}))`)
      let shareId
      if (!ex || ex.length === 0) {
        shareId = 'share_' + Math.random().toString(36).slice(2, 10)
        await sb.insert('customer_shares', { id: shareId, business_id: _activeBizId, cust_id_a: a, cust_id_b: b })
      } else {
        shareId = ex[0].id
      }
      setSharesByCust(prev => ({ ...prev, [a]: [...(prev[a] || []).filter(s => s.partnerId !== b), { id: shareId, partnerId: b }] }))
      setPartnerNames(prev => ({ ...prev, [b]: partner.name || '(이름 없음)' }))
      setPartnerFor(null)
      alert(`'${partner.name}'님을 짝꿍으로 연결했습니다.`)
    } catch (e) {
      alert('연결 실패: ' + (e?.message || e))
    }
    setBusyId(null)
  }

  // 메모 발췌 — 키워드 위치 ±40자, 키워드 노란 형광펜
  const memoExcerpt = (memo) => {
    if (!memo) return null
    const lo = memo.toLowerCase()
    for (const kw of KEYWORDS) {
      const idx = lo.indexOf(kw.toLowerCase())
      if (idx >= 0) {
        const start = Math.max(0, idx - 40)
        const end = Math.min(memo.length, idx + kw.length + 40)
        const before = (start > 0 ? '…' : '') + memo.slice(start, idx)
        const hit = memo.slice(idx, idx + kw.length)
        const after = memo.slice(idx + kw.length, end) + (end < memo.length ? '…' : '')
        return <>{before}<mark style={{ background: '#FFF59D', padding: '0 2px', borderRadius: 2 }}>{hit}</mark>{after}</>
      }
    }
    return memo.slice(0, 100) + (memo.length > 100 ? '…' : '')
  }

  const th = { padding: '10px 8px', fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.gray500, textAlign: 'left', background: T.bg, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '10px 8px', borderBottom: `1px solid ${T.gray100}`, fontSize: T.fs.xs, color: T.text, verticalAlign: 'top' }

  return <div>
    <APageHeader title="커플 메모 검수" desc={`고객 메모에 [${KEYWORDS.join(' / ')}] 키워드가 들어간 고객 검수 — 짝꿍 지정 시 customer_shares 정식 연결 (보유권 마킹은 [커플 패키지 소급 적용] 페이지에서)`} />

    <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, color: T.gray500 }}>지점</span>
        <select value={branchSel} onChange={e => setBranchSel(e.target.value)}
          style={{ padding: '7px 10px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.xs, fontFamily: 'inherit', background: '#fff', minWidth: 130 }}>
          <option value="all">전체</option>
          <option value="unassigned">미판정</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.short || b.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, color: T.gray500 }}>고객 검색</span>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·연락처·고객번호·메모 내용"
          style={{ padding: '7px 10px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.xs, fontFamily: 'inherit' }} />
      </div>
      <button onClick={load} disabled={loading}
        style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.text, fontSize: T.fs.xs, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: T.fw.bolder }}>
        {loading ? '...' : '새로고침'}
      </button>
    </div>

    <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginBottom: 8 }}>
      {loading ? '불러오는 중...' : err ? <span style={{ color: T.danger }}>오류: {err}</span>
        : <>매칭 고객 <b style={{ color: T.text }}>{filtered.length}</b>명{pendingCount > 0 && <> · 짝꿍 미연결 <b style={{ color: '#E65100' }}>{pendingCount}</b>명</>}</>}
    </div>

    {filtered.length > 0 && (
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>고객</th>
              <th style={th}>연락처</th>
              <th style={th}>매장</th>
              <th style={th}>메모 발췌</th>
              <th style={th}>활성 보유권</th>
              <th style={{ ...th, textAlign: 'center' }}>짝꿍 연결</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const shares = sharesByCust[c.id] || []
              const pkgs = pkgsByCust[c.id] || []
              const opened = !!memoOpen[c.id]
              return <tr key={c.id} style={shares.length ? {} : { background: '#FFF8F0' }}>
                <td style={td}>
                  <div style={{ fontWeight: T.fw.bolder }}>{c.name || '-'}{c.name2 ? ` (${c.name2})` : ''}</div>
                  {c.cust_num && <div style={{ fontSize: T.fs.nano, color: T.textMuted }}>{c.cust_num}</div>}
                  <button onClick={() => { if (setPendingOpenCust) setPendingOpenCust(c.id); if (setPage) setPage('customers'); }}
                    title="고객관리에서 이 고객 정보 열기"
                    style={{ marginTop: 4, padding: '2px 8px', borderRadius: 4, border: '1px solid ' + T.primary, background: T.primaryLt || '#ede9fe', color: T.primaryDk, fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    👤 고객정보
                  </button>
                </td>
                <td style={td}>{c.phone || '-'}</td>
                <td style={td}>{branchShort(c.bid) || '미판정'}</td>
                <td style={{ ...td, maxWidth: 380, lineHeight: 1.55 }}>
                  <div style={{ fontSize: T.fs.xs, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {opened ? c.memo : memoExcerpt(c.memo)}
                  </div>
                  {c.memo && c.memo.length > 100 && (
                    <button onClick={() => setMemoOpen(prev => ({ ...prev, [c.id]: !opened }))}
                      style={{ marginTop: 4, padding: '2px 8px', borderRadius: 4, border: '1px solid ' + T.border, background: '#fff', color: T.textMuted, fontSize: T.fs.nano, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {opened ? '발췌만 보기' : '메모 전체 보기'}
                    </button>
                  )}
                </td>
                <td style={td}>
                  {pkgs.length === 0 ? <span style={{ color: T.textMuted, fontSize: T.fs.nano }}>없음</span>
                    : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {pkgs.map((p, i) => <li key={i} style={{ fontSize: T.fs.nano, color: T.text }}>
                        {p.hasCpl && <span title="이미 커플:gid 마킹됨" style={{ color: '#2E7D32', fontWeight: T.fw.bolder, marginRight: 3 }}>💑</span>}
                        {p.name} <span style={{ color: T.textMuted }}>{p.remain}/{p.total}회</span>
                      </li>)}
                    </ul>}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {shares.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      {shares.map(s => <span key={s.id} style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 12, background: '#E8F5E9', color: '#2E7D32', fontSize: T.fs.nano, fontWeight: T.fw.bolder }}>
                        ↔ {partnerNames[s.partnerId] || '(이름)'}
                      </span>)}
                      <button onClick={() => setPartnerFor(c)} disabled={busyId === c.id}
                        style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid ' + T.border, background: '#fff', color: T.textMuted, fontSize: T.fs.nano, cursor: 'pointer', fontFamily: 'inherit' }}>
                        + 추가
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setPartnerFor(c)} disabled={busyId === c.id}
                      style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #8B5CF6', background: '#fff', color: '#7C3AED', fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: busyId === c.id ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                      {busyId === c.id ? '...' : '짝꿍 지정'}
                    </button>
                  )}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {!loading && !err && filtered.length === 0 && (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: T.fs.sm }}>
        매칭 고객이 없습니다.
      </div>
    )}

    {partnerFor && createPortal(
      <ShareCustModal
        baseCust={partnerFor}
        existingShareIds={(sharesByCust[partnerFor.id] || []).map(s => s.partnerId)}
        titleLabel="커플 짝꿍 지정"
        onPick={applyPartner}
        onClose={() => setPartnerFor(null)}
      />, document.body)}
  </div>
}

export default AdminCoupleMemoReview
