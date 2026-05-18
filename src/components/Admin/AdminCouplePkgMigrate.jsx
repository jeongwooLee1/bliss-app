import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import { APageHeader } from './AdminUI'
import { ShareCustModal } from '../Customers/ShareCustModal'

// 커플 패키지 기존 구매자 소급 적용
// — services.is_couple=true 인 상품을 구버전 방식(보유권 1행)으로 구매한 케이스를 찾아,
//   행별로 상대방을 지정하면 상대방 N회 보유권 + customer_shares + 양쪽 note "커플:<gid>" 를 소급 생성.
function AdminCouplePkgMigrate({ data, userBranches = [] }) {
  const coupleServiceIds = useMemo(
    () => [...new Set((data?.services || []).filter(s => s.isCouple || s.is_couple).map(s => s.id))],
    [data?.services]
  )

  const [pkgs, setPkgs] = useState([])     // 아직 분리 안 된 커플 패키지 보유권
  const [custs, setCusts] = useState({})   // {id: customer}
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
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
      // 이미 커플 분리된 행(note에 "커플:")은 제외
      const pending = (Array.isArray(list) ? list : []).filter(p => !/커플:/.test(p.note || ''))
      setPkgs(pending)
      const ids = [...new Set(pending.map(p => p.customer_id).filter(Boolean))]
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

  const filtered = useMemo(() => {
    if (!search.trim()) return pkgs
    const toks = search.trim().toLowerCase().split(/\s+/)
    return pkgs.filter(p => {
      const c = custs[p.customer_id]
      const hay = [c?.name, c?.name2, c?.phone, c?.cust_num, p.service_name].filter(Boolean).join(' ').toLowerCase()
      return toks.every(t => hay.includes(t))
    })
  }, [pkgs, custs, search])

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
      // 1. 기존(구매자) 행 — note에 커플:gid 추가
      const newBuyerNote = buyerNote ? `${buyerNote} | 커플:${gid}` : `커플:${gid}`
      await sb.update('customer_packages', pkg.id, { note: newBuyerNote })
      // 2. 상대방 행 INSERT (각자 독립 N회, 사용 0회)
      const mjMatch = buyerNote.match(/매장:[^|]+/)
      const bShort = branchShort(pkg.branch_id)
      const partnerNote = mjMatch
        ? `${mjMatch[0].trim()} | 커플:${gid}`
        : (bShort ? `매장:${bShort.replace(/점$|본점$/, '')} | 커플:${gid}` : `커플:${gid}`)
      await sb.insert('customer_packages', {
        id: genId('pkg'), business_id: _activeBizId, customer_id: newPartner.id,
        service_id: pkg.service_id, service_name: pkg.service_name,
        total_count: total, used_count: 0,
        purchased_at: pkg.purchased_at || new Date().toISOString(),
        note: partnerNote, branch_id: pkg.branch_id || null,
      })
      // 3. customer_shares 연결 (중복이면 생략)
      const a = pkg.customer_id, b = newPartner.id
      const ex = await sb.get('customer_shares', `&or=(and(cust_id_a.eq.${a},cust_id_b.eq.${b}),and(cust_id_a.eq.${b},cust_id_b.eq.${a}))`)
      if (!ex || ex.length === 0) {
        await sb.insert('customer_shares', { id: 'share_' + Math.random().toString(36).slice(2, 10), business_id: _activeBizId, cust_id_a: a, cust_id_b: b })
      }
      setPkgs(prev => prev.filter(x => x.id !== pkg.id))
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
    <APageHeader title="커플 패키지 소급 적용" desc="기존 커플 패키지 구매자 — 상대방을 지정하면 상대방에게도 같은 회수의 보유권이 발급되고 커플로 연결됩니다" />

    {coupleServiceIds.length === 0 ? (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: T.fs.sm, lineHeight: 1.7 }}>
        커플 패키지로 지정된 상품이 없습니다.<br />
        먼저 <b>시술 상품 관리</b>에서 패키지 상품의 "커플 패키지" 토글을 켜주세요.
      </div>
    ) : <>
      <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
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
        {loading ? '불러오는 중...' : err ? <span style={{ color: T.danger }}>오류: {err}</span> : `소급 적용 대상 ${filtered.length}건`}
      </div>

      {filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>구매자</th>
                <th style={th}>연락처</th>
                <th style={th}>지점</th>
                <th style={th}>커플 패키지</th>
                <th style={{ ...th, textAlign: 'right' }}>회차</th>
                <th style={th}>구매일</th>
                <th style={{ ...th, textAlign: 'center' }}>상대방</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const c = custs[p.customer_id]
                const remain = (p.total_count || 0) - (p.used_count || 0)
                return <tr key={p.id}>
                  <td style={td}>
                    <div style={{ fontWeight: T.fw.bolder }}>{c?.name || '-'}{c?.name2 ? ` (${c.name2})` : ''}</div>
                    {c?.cust_num && <div style={{ fontSize: T.fs.nano, color: T.textMuted, fontFamily: 'monospace' }}>{c.cust_num}</div>}
                  </td>
                  <td style={td}>{c?.phone || '-'}</td>
                  <td style={td}>{branchShort(p.branch_id) || '미판정'}</td>
                  <td style={td}>{p.service_name}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: T.fw.bolder }}>{remain}/{p.total_count || 0}회</td>
                  <td style={td}>{fmtDate(p.purchased_at || p.created_at)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button onClick={() => setPartnerFor(p)} disabled={busyId === p.id}
                      style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #8B5CF6', background: '#fff', color: '#7C3AED', fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: busyId === p.id ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                      {busyId === p.id ? '...' : '상대방 지정'}
                    </button>
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && filtered.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: T.fs.sm }}>
          소급 적용 대상 없음 — 모든 커플 패키지 구매 건이 이미 상대방까지 발급되어 있습니다.
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
