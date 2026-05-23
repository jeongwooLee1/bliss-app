import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import { APageHeader } from './AdminUI'
import { ShareCustModal } from '../Customers/ShareCustModal'

// 커플 패키지 보유자 관리 + 기존 구매자 소급 적용
// — services.is_couple=true 상품의 customer_packages 보유 건을 전부 보여줌.
//   note에 "커플:<gid>" 없으면 미적용 → 상대방 지정 시 상대방 N회 보유권 + customer_shares + 양쪽 note "커플:<gid>" 생성.
const gidOf = (note) => (note || '').match(/커플:([A-Za-z0-9]+)/)?.[1] || null

function AdminCouplePkgMigrate({ data, userBranches = [] }) {
  const coupleServiceIds = useMemo(
    () => [...new Set((data?.services || []).filter(s => s.isCouple || s.is_couple).map(s => s.id))],
    [data?.services]
  )
  const branches = useMemo(
    () => (data?.branches || []).filter(b => b.useYn !== false && (userBranches.length === 0 || userBranches.includes(b.id))),
    [data?.branches, userBranches]
  )

  const [pkgs, setPkgs] = useState([])     // 커플 패키지 보유 건 전체
  const [custs, setCusts] = useState({})   // {id: customer}
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [branchSel, setBranchSel] = useState('all')
  const [partnerFor, setPartnerFor] = useState(null)  // 상대방 지정 중인 보유권 행
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    if (coupleServiceIds.length === 0) { setPkgs([]); setCusts({}); return }
    setLoading(true); setErr('')
    try {
      const url = `${SB_URL}/rest/v1/customer_packages?service_id=in.(${coupleServiceIds.join(',')})&select=id,customer_id,service_id,service_name,total_count,used_count,note,branch_id,purchased_at,created_at&order=created_at.desc&limit=10000`
      const r = await fetch(url, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const list = await r.json()
      setPkgs(Array.isArray(list) ? list : [])
      const ids = [...new Set((list || []).map(p => p.customer_id).filter(Boolean))]
      const map = {}
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200)
        const cr = await fetch(`${SB_URL}/rest/v1/customers?id=in.(${batch.join(',')})&select=id,name,name2,phone,cust_num`, { headers: sbHeaders })
        const cs = await cr.json()
        ;(cs || []).forEach(c => { map[c.id] = c })
      }
      setCusts(map)
    } catch (e) {
      setErr(e?.message || String(e))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [coupleServiceIds.join(',')])

  const branchShort = (bid) => {
    const b = (data?.branches || []).find(x => x.id === bid)
    return b ? (b.short || b.name) : ''
  }

  // gid → 같은 커플로 묶인 행들 (상대방 찾기용)
  const gidGroups = useMemo(() => {
    const m = {}
    for (const p of pkgs) {
      const g = gidOf(p.note)
      if (g) (m[g] = m[g] || []).push(p)
    }
    return m
  }, [pkgs])
  const partnerName = (p) => {
    const g = gidOf(p.note)
    if (!g) return ''
    const sib = (gidGroups[g] || []).find(x => x.customer_id !== p.customer_id)
    if (!sib) return ''
    return custs[sib.customer_id]?.name || '(상대방)'
  }

  const filtered = useMemo(() => {
    return pkgs.filter(p => {
      if (branchSel === 'unassigned') { if (p.branch_id) return false }
      else if (branchSel !== 'all') { if (p.branch_id !== branchSel) return false }
      else if (userBranches.length && p.branch_id && !userBranches.includes(p.branch_id)) return false
      if (search.trim()) {
        const c = custs[p.customer_id]
        const hay = [c?.name, c?.name2, c?.phone, c?.cust_num, p.service_name].filter(Boolean).join(' ').toLowerCase()
        if (!search.trim().toLowerCase().split(/\s+/).every(t => hay.includes(t))) return false
      }
      return true
    })
  }, [pkgs, custs, search, branchSel, userBranches])

  const pendingCount = useMemo(() => filtered.filter(p => !gidOf(p.note)).length, [filtered])

  // 상대방 지정 → 소급 분리 발급
  const applyPartner = async (newPartner) => {
    if (!partnerFor || !newPartner?.id) return
    const pkg = partnerFor
    if (newPartner.id === pkg.customer_id) { alert('구매자 본인은 상대방이 될 수 없습니다.'); return }
    setBusyId(pkg.id)
    try {
      const gid = 'cg' + Math.random().toString(36).slice(2, 9)
      const total = pkg.total_count || 0
      const buyerNote = (pkg.note || '').trim()
      const newBuyerNote = buyerNote ? `${buyerNote} | 커플:${gid}` : `커플:${gid}`
      await sb.update('customer_packages', pkg.id, { note: newBuyerNote })
      const mjMatch = buyerNote.match(/매장:[^|]+/)
      const bShort = branchShort(pkg.branch_id)
      const partnerNote = mjMatch
        ? `${mjMatch[0].trim()} | 커플:${gid}`
        : (bShort ? `매장:${bShort.replace(/점$|본점$/, '')} | 커플:${gid}` : `커플:${gid}`)
      const partnerRow = {
        id: genId('pkg'), business_id: _activeBizId, customer_id: newPartner.id,
        service_id: pkg.service_id, service_name: pkg.service_name,
        total_count: total, used_count: 0,
        purchased_at: pkg.purchased_at || new Date().toISOString(),
        note: partnerNote, branch_id: pkg.branch_id || null,
        created_at: new Date().toISOString(),
      }
      await sb.insert('customer_packages', partnerRow)
      const a = pkg.customer_id, b = newPartner.id
      const ex = await sb.get('customer_shares', `&or=(and(cust_id_a.eq.${a},cust_id_b.eq.${b}),and(cust_id_a.eq.${b},cust_id_b.eq.${a}))`)
      if (!ex || ex.length === 0) {
        await sb.insert('customer_shares', { id: 'share_' + Math.random().toString(36).slice(2, 10), business_id: _activeBizId, cust_id_a: a, cust_id_b: b })
      }
      // 로컬 state 갱신 — 제거하지 않고 상태만 업데이트 + 상대방 행 추가
      setCusts(prev => ({ ...prev, [newPartner.id]: { id: newPartner.id, name: newPartner.name, phone: newPartner.phone, cust_num: newPartner.cust_num } }))
      setPkgs(prev => [partnerRow, ...prev.map(x => x.id === pkg.id ? { ...x, note: newBuyerNote } : x)])
      setPartnerFor(null)
      alert(`'${newPartner.name}'님에게 ${total}회 보유권을 발급하고 커플로 연결했습니다.`)
    } catch (e) {
      alert('적용 실패: ' + (e?.message || e))
    }
    setBusyId(null)
  }

  const th = { padding: '10px 8px', fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.gray500, textAlign: 'left', background: T.bg, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '10px 8px', borderBottom: `1px solid ${T.gray100}`, fontSize: T.fs.xs, color: T.text, verticalAlign: 'middle' }
  const fmtDate = (s) => (s ? String(s).slice(0, 10) : '-')

  return <div>
    <APageHeader title="커플 패키지 보유 현황 · 소급 적용" desc="커플 패키지 보유 건 전체 — 미적용 건은 상대방을 지정하면 상대방에게도 같은 회수가 발급되고 커플로 연결됩니다" />

    {coupleServiceIds.length === 0 ? (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: T.fs.sm, lineHeight: 1.7 }}>
        커플 패키지로 지정된 상품이 없습니다.<br />
        먼저 <b>시술 상품 관리</b>에서 패키지 상품의 "커플 패키지" 토글을 켜주세요.
      </div>
    ) : <>
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
          <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, color: T.gray500 }}>고객/보유권 검색</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·연락처·고객번호·시술명"
            style={{ padding: '7px 10px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.xs, fontFamily: 'inherit' }} />
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.text, fontSize: T.fs.xs, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: T.fw.bolder }}>
          {loading ? '...' : '새로고침'}
        </button>
      </div>

      <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginBottom: 8 }}>
        {loading ? '불러오는 중...' : err ? <span style={{ color: T.danger }}>오류: {err}</span>
          : <>커플 패키지 보유 <b style={{ color: T.text }}>{filtered.length}</b>건{pendingCount > 0 && <> · 미적용 <b style={{ color: '#E65100' }}>{pendingCount}</b>건</>}</>}
      </div>

      {filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>고객</th>
                <th style={th}>연락처</th>
                <th style={th}>지점</th>
                <th style={th}>커플 패키지</th>
                <th style={{ ...th, textAlign: 'right' }}>회차</th>
                <th style={th}>구매일</th>
                <th style={{ ...th, textAlign: 'center' }}>상태 / 상대방</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const c = custs[p.customer_id]
                const remain = (p.total_count || 0) - (p.used_count || 0)
                const linked = !!gidOf(p.note)
                return <tr key={p.id} style={linked ? {} : { background: '#FFF8F0' }}>
                  <td style={td}>
                    <div style={{ fontWeight: T.fw.bolder }}>{c?.name || '-'}{c?.name2 ? ` (${c.name2})` : ''}</div>
                    {c?.cust_num && <div style={{ fontSize: T.fs.nano, color: T.textMuted }}>{c.cust_num}</div>}
                  </td>
                  <td style={td}>{c?.phone || '-'}</td>
                  <td style={td}>{branchShort(p.branch_id) || '미판정'}</td>
                  <td style={td}>{p.service_name}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: T.fw.bolder }}>{remain}/{p.total_count || 0}회</td>
                  <td style={td}>{fmtDate(p.purchased_at || p.created_at)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {linked ? (
                      <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 12, background: '#E8F5E9', color: '#2E7D32', fontSize: T.fs.nano, fontWeight: T.fw.bolder }}>
                        커플 연결 완료{partnerName(p) ? ` · ↔ ${partnerName(p)}` : ''}
                      </span>
                    ) : (
                      <button onClick={() => setPartnerFor(p)} disabled={busyId === p.id}
                        style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #8B5CF6', background: '#fff', color: '#7C3AED', fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: busyId === p.id ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        {busyId === p.id ? '...' : '상대방 지정'}
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
          커플 패키지 보유 건이 없습니다.
        </div>
      )}
    </>}

    {partnerFor && createPortal(
      <ShareCustModal
        baseCust={custs[partnerFor.customer_id] || { id: partnerFor.customer_id, name: '구매자' }}
        existingShareIds={[]}
        titleLabel="커플 상대방 지정"
        onPick={applyPartner}
        onClose={() => setPartnerFor(null)}
      />, document.body)}
  </div>
}

export default AdminCouplePkgMigrate
