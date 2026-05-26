import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { APageHeader } from './AdminUI'

// KST 날짜 (YYYY-MM-DD)
function kstDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) } catch { return '' }
}
function kstDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
function parseBalance(note) {
  const m = (note || '').match(/잔액:\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) || 0 : null
}

// 패키지 구매 당일 미사용 검토
// 앱에 기록된 패키지 구매(package_transactions.type='charge') 중,
// 같은 패키지를 구매 당일(KST) 차감(deduct/use)한 기록이 없는 건을 모음.
function AdminPkgUnusedReview({ data, bizId, userBranches = [], setPage, setPendingOpenCust }) {
  const branches = useMemo(
    () => (data?.branches || []).filter(b => b.useYn !== false && (userBranches.length === 0 || userBranches.includes(b.id))),
    [data?.branches, userBranches]
  )

  const [branchSel, setBranchSel] = useState('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])       // 당일 미사용 charge 목록
  const [custs, setCusts] = useState({})
  const [pkgMap, setPkgMap] = useState({})   // package_id -> 현재 customer_packages 상태
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [reviewed, setReviewed] = useState(() => new Set()) // 확인완료한 package_id
  const [showDone, setShowDone] = useState(false)           // 확인완료 포함 표시

  const REVIEW_KEY = 'pkg_unused_reviewed_v1'
  const saveReviewed = async (set) => {
    if (!bizId) return
    try {
      await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ business_id: bizId, id: REVIEW_KEY, key: REVIEW_KEY, value: JSON.stringify([...set]) })
      })
    } catch (e) { console.error('saveReviewed failed', e) }
  }
  const toggleReviewed = (pkgId) => {
    setReviewed(prev => {
      const next = new Set(prev)
      if (next.has(pkgId)) next.delete(pkgId); else next.add(pkgId)
      saveReviewed(next)
      return next
    })
  }

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const bizFilter = bizId ? `&business_id=eq.${bizId}` : ''
      // 0) 확인완료 목록 로드
      try {
        const rv = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${bizId}&key=eq.${REVIEW_KEY}&select=value`, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
        const rvr = await rv.json()
        const v = rvr?.[0]?.value
        const arr = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : [])
        setReviewed(new Set(Array.isArray(arr) ? arr : []))
      } catch (e) { /* 무시 */ }
      // 1) 구매(charge) 기록 — getAll로 1000행 캡 회피
      const charges = await sb.getAll('package_transactions', `&type=eq.charge${bizFilter}`)

      // 2) 차감(deduct/use) 기록 → ① 패키지+구매당일 ② 같은 매출(sale_id) set
      //    ※ getAll(Range 페이지네이션)로 전량 — PostgREST db-max-rows(1000) 캡 회피
      const deducts = await sb.getAll('package_transactions', `&type=in.(deduct,use)${bizFilter}`)
      const usedDateSet = new Set((deducts || []).map(d => `${d.package_id}|${kstDate(d.created_at)}`))
      const usedSaleSet = new Set((deducts || []).map(d => d.sale_id).filter(Boolean))

      // 3) 구매 당일 차감 없는 건만 (연간권 제외)
      //    당일 사용 = 같은 패키지를 구매 당일 차감했거나, 같은 매출(sale_id)에서 동시 차감한 경우
      const unused0 = (charges || []).filter(c =>
        !/연간/.test(c.service_name || '') &&
        !usedDateSet.has(`${c.package_id}|${kstDate(c.created_at)}`) &&
        !(c.sale_id && usedSaleSet.has(c.sale_id))
      )

      // 3-2) 구매 매출에 "실제 시술"이 같이 있으면 제외 (당일 시술 받음 — 패키지 차감 대신 별도 결제)
      //      매출의 svc 라인 중 패키지/할인/조정 라인이 아닌 진짜 시술명이 있으면 그 매출은 당일 시술건으로 봄
      const saleToPkg = {}
      unused0.forEach(c => { if (c.sale_id) saleToPkg[c.sale_id] = c.service_name || '' })
      const saleIds = [...new Set(unused0.map(c => c.sale_id).filter(Boolean))]
      const isTreatmentName = (name, pkgName) => {
        const n = (name || '').trim()
        if (!n || n === (pkgName || '').trim()) return false
        if (n.startsWith('[')) return false                       // [할인]·[보유권 사용] 등
        if (/할인|PKG|패키지|다담|연간|쿠폰|선불|프리패스|바프/i.test(n)) return false // 패키지/조정 라인
        return true                                               // 브라질리언·기기진정관리·재생관리 등 실제 시술
      }
      const treatmentSaleSet = new Set()
      for (let i = 0; i < saleIds.length; i += 100) {
        const batch = saleIds.slice(i, i + 100)
        const r = await fetch(`${SB_URL}/rest/v1/sale_details?sale_id=in.(${batch.join(',')})&item_kind=eq.svc&select=sale_id,service_name`, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
        const ds = await r.json()
        ;(ds || []).forEach(d => {
          if (isTreatmentName(d.service_name, saleToPkg[d.sale_id])) treatmentSaleSet.add(d.sale_id)
        })
      }

      // 4) 해당 고객들의 전체 보유권 → 잔여 표시 + "같은 패키지 2개 이상 보유" 판정
      const custIds = [...new Set(unused0.map(c => c.customer_id).filter(Boolean))]
      const pmap = {}                 // package_id -> 현재 상태
      const sameNameCnt = {}          // `${customer_id}|${service_name}` -> 보유 개수
      for (let i = 0; i < custIds.length; i += 100) {
        const batch = custIds.slice(i, i + 100)
        const r = await fetch(`${SB_URL}/rest/v1/customer_packages?customer_id=in.(${batch.join(',')})&select=id,customer_id,service_name,total_count,used_count,note`, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
        const ps = await r.json()
        ;(ps || []).forEach(p => {
          pmap[p.id] = p
          const k = `${p.customer_id}|${p.service_name || ''}`
          sameNameCnt[k] = (sameNameCnt[k] || 0) + 1
        })
      }
      setPkgMap(pmap)

      // 최종 필터:
      //  ① 현재 존재하는 패키지만 (삭제된 패키지의 orphan 거래기록 제외)
      //  ② 같은 패키지 2개 이상 보유 고객 제외 (재구매·비축)
      //  ③ 구매 당일 실제 시술 받은 매출 제외
      const unused = unused0.filter(c =>
        pmap[c.package_id] &&
        (sameNameCnt[`${c.customer_id}|${c.service_name || ''}`] || 0) < 2 &&
        !(c.sale_id && treatmentSaleSet.has(c.sale_id))
      )
      setRows(unused)

      // 5) 고객 정보
      const finalCustIds = [...new Set(unused.map(c => c.customer_id).filter(Boolean))]
      const cmap = {}
      for (let i = 0; i < finalCustIds.length; i += 200) {
        const batch = finalCustIds.slice(i, i + 200)
        const r = await fetch(`${SB_URL}/rest/v1/customers?id=in.(${batch.join(',')})&select=id,name,name2,phone,phone2,bid,cust_num`, { headers: sbHeaders })
        const cs = await r.json()
        ;(cs || []).forEach(c => { cmap[c.id] = c })
      }
      setCusts(cmap)
    } catch (e) {
      setErr(e?.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    return rows.filter(c => {
      // 확인완료 숨김 (showDone=false일 때)
      if (!showDone && reviewed.has(c.package_id)) return false
      // 지점 필터
      if (branchSel === 'unassigned') {
        if (c.bid) return false
      } else if (branchSel !== 'all') {
        if (c.bid !== branchSel) return false
      } else if (userBranches.length && c.bid && !userBranches.includes(c.bid)) {
        return false
      }
      // 검색
      if (search.trim()) {
        const cu = custs[c.customer_id]
        const hay = [cu?.name, cu?.name2, cu?.phone, cu?.phone2, cu?.cust_num, c.service_name].filter(Boolean).join(' ').toLowerCase()
        const tokens = search.trim().toLowerCase().split(/\s+/)
        if (!tokens.every(t => hay.includes(t))) return false
      }
      return true
    })
  }, [rows, custs, branchSel, search, userBranches, reviewed, showDone])

  const doneCount = useMemo(() => rows.filter(c => reviewed.has(c.package_id)).length, [rows, reviewed])

  const branchName = bid => {
    const b = (data?.branches || []).find(x => x.id === bid)
    return b ? (b.short || b.name) : (bid ? bid : '미판정')
  }

  const fmtBuy = c => {
    if (c.unit === 'won') return (Number(c.amount) || 0).toLocaleString() + '원'
    return (Number(c.amount) || 0) + '회'
  }
  const fmtNowRemain = c => {
    const p = pkgMap[c.package_id]
    if (!p) return '-'
    const bal = parseBalance(p.note)
    if (bal != null) return bal.toLocaleString() + '원'
    return `${Math.max(0, (p.total_count || 0) - (p.used_count || 0))}/${p.total_count || 0}회`
  }
  // 현재까지도 한 번도 안 쓴 건 강조
  const stillUnused = c => {
    const p = pkgMap[c.package_id]
    return p && (p.used_count || 0) === 0
  }

  const th = { padding: '10px 8px', fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.gray500, textAlign: 'left', background: T.bg, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '10px 8px', borderBottom: `1px solid ${T.gray100}`, fontSize: T.fs.xs, color: T.text, verticalAlign: 'middle' }

  return <div>
    <APageHeader title="패키지 구매 당일 미사용 검토" desc="패키지를 구매했는데 구매 당일 1회도 차감(시술)하지 않은 건 — 당일 첫 시술 누락 점검용 (앱에 차감 기록이 남는 구매분 대상)" />

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
        <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, color: T.gray500 }}>고객/패키지 검색</span>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·연락처·고객번호·패키지명"
          style={{ padding: '7px 10px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.xs, fontFamily: 'inherit' }} />
      </div>
      <button onClick={() => setShowDone(v => !v)}
        style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (showDone ? T.primary : T.border), background: showDone ? T.primaryHover : '#fff', color: showDone ? T.primary : T.textSub, fontSize: T.fs.xs, cursor: 'pointer', fontFamily: 'inherit', fontWeight: T.fw.bolder }}>
        {showDone ? '확인완료 포함 ✓' : '확인완료 포함'}
      </button>
      <button onClick={load} disabled={loading}
        style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.text, fontSize: T.fs.xs, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: T.fw.bolder }}>
        {loading ? '...' : '새로고침'}
      </button>
    </div>

    <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginBottom: 8 }}>
      {loading ? '불러오는 중...' : err ? <span style={{ color: T.danger }}>오류: {err}</span>
        : `검토 대상 ${filtered.length}건${doneCount > 0 && !showDone ? ` · 확인완료 ${doneCount}건 숨김` : ''}`}
    </div>

    {filtered.length > 0 && (
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>고객</th>
              <th style={th}>연락처</th>
              <th style={th}>지점</th>
              <th style={th}>패키지</th>
              <th style={{ ...th, textAlign: 'right' }}>구매</th>
              <th style={th}>구매일시</th>
              <th style={{ ...th, textAlign: 'right' }}>현재 잔여</th>
              <th style={{ ...th, textAlign: 'center' }}>상태</th>
              <th style={{ ...th, textAlign: 'center' }}>고객</th>
              <th style={{ ...th, textAlign: 'center' }}>검토</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const cu = custs[c.customer_id]
              const isDone = reviewed.has(c.package_id)
              return <tr key={c.id} style={isDone ? { background: '#f0fdf4' } : undefined}>
                <td style={td}>
                  <div style={{ fontWeight: T.fw.bolder }}>{cu?.name || '-'}{cu?.name2 ? ` (${cu.name2})` : ''}</div>
                  {cu?.cust_num && <div style={{ fontSize: T.fs.nano, color: T.textMuted }}>{cu.cust_num}</div>}
                </td>
                <td style={td}>
                  <div>{cu?.phone || '-'}</div>
                  {cu?.phone2 && <div style={{ fontSize: T.fs.nano, color: T.textMuted }}>{cu.phone2}</div>}
                </td>
                <td style={td}>{branchName(c.bid)}</td>
                <td style={td}>{c.service_name || '-'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: T.fw.bolder }}>{fmtBuy(c)}</td>
                <td style={{ ...td, color: T.textSub, whiteSpace: 'nowrap' }}>{kstDateTime(c.created_at)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: T.fw.bolder }}>{fmtNowRemain(c)}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {stillUnused(c)
                    ? <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, padding: '2px 8px', borderRadius: 10, background: T.warningLt, color: T.warning }}>여전히 미사용</span>
                    : <span style={{ fontSize: T.fs.nano, color: T.textMuted }}>이후 사용됨</span>}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {c.customer_id && setPage && setPendingOpenCust
                    ? <button onClick={() => { setPendingOpenCust(c.customer_id); setPage('customers') }}
                        style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid ' + T.border, background: '#fff', color: T.primary, fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        고객 정보 ↗
                      </button>
                    : <span style={{ color: T.gray300 }}>-</span>}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {isDone
                    ? <button onClick={() => toggleReviewed(c.package_id)}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        ✓ 확인완료 · 취소
                      </button>
                    : <button onClick={() => toggleReviewed(c.package_id)}
                        style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: T.success || '#16a34a', color: '#fff', fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        확인완료
                      </button>}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {!loading && !err && filtered.length === 0 && (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: T.fs.sm }}>
        검토 대상 없음 — 구매 당일 미사용 건이 없습니다.
      </div>
    )}
  </div>
}

export default AdminPkgUnusedReview
