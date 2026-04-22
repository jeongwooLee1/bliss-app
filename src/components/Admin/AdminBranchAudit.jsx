import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { APageHeader, ABadge, AIBtn, AEmpty } from './AdminUI'

// AdminBranchAudit — customer_packages.branch_id NULL인 권을 매출 이력으로 조사·판정
// 원본 요청: id_ebgbebctt3 Phase 2 후속
// DB view: customer_pkgs_branch_audit
function AdminBranchAudit({ data }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null) // pkg_id 처리 중
  const [hideDone, setHideDone] = useState(true)
  const [filter, setFilter] = useState('all') // all | withSuggestion | withoutSuggestion

  const branchById = useMemo(() => {
    const m = {}
    ;(data?.branches || []).forEach(b => { m[b.id] = b.short || b.name || b.id })
    return m
  }, [data?.branches])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${SB_URL}/rest/v1/customer_pkgs_branch_audit?select=*&order=cust_name.asc.nullslast`, { headers: sbHeaders })
      const data = await r.json()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { console.error('[branchAudit] load:', e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const applyBranch = async (pkgId, bid) => {
    if (!bid) return
    setProcessing(pkgId)
    try {
      await sb.update('customer_packages', pkgId, { branch_id: bid })
      setRows(prev => prev.filter(r => r.pkg_id !== pkgId))
    } catch (e) { alert('저장 실패: ' + (e?.message || e)) }
    setProcessing(null)
  }

  const applyAllSuggestions = async () => {
    const targets = rows.filter(r => r.suggested_bid)
    if (!targets.length) { alert('추천 지점이 있는 권이 없습니다.'); return }
    if (!confirm(`추천 지점으로 ${targets.length}건 일괄 적용하시겠습니까?\n\n(적용 후 되돌릴 수 없습니다. 예외는 개별로 처리하세요.)`)) return
    setProcessing('bulk')
    let ok = 0, fail = 0
    for (const r of targets) {
      try {
        await sb.update('customer_packages', r.pkg_id, { branch_id: r.suggested_bid })
        ok++
      } catch { fail++ }
    }
    await load()
    setProcessing(null)
    alert(`일괄 적용 완료: 성공 ${ok}건${fail ? ` · 실패 ${fail}건` : ''}`)
  }

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === 'withSuggestion' && !r.suggested_bid) return false
      if (filter === 'withoutSuggestion' && r.suggested_bid) return false
      return true
    })
  }, [rows, filter])

  // 고객별 그룹
  const byCustomer = useMemo(() => {
    const m = new Map()
    filtered.forEach(r => {
      const k = r.customer_id || r.pkg_id
      if (!m.has(k)) m.set(k, { cust_name: r.cust_name, cust_num: r.cust_num, phone: r.phone, customer_id: r.customer_id, pkgs: [] })
      m.get(k).pkgs.push(r)
    })
    return [...m.values()]
  }, [filtered])

  const stats = useMemo(() => {
    const total = rows.length
    const withSug = rows.filter(r => r.suggested_bid).length
    return { total, withSug, withoutSug: total - withSug }
  }, [rows])

  const fmtBal = (r) => {
    const note = r.note || ''
    const m = note.match(/잔액:([0-9,]+)/)
    if (m) return `잔액 ${m[1]}원`
    const remain = (r.total_count || 0) - (r.used_count || 0)
    return `${remain}/${r.total_count || 0}회`
  }

  return <div>
    <APageHeader title="구매지점 조사" desc="branch_id가 비어있는 보유권을 고객 매출 이력 기반으로 판정합니다 (id_ebgbebctt3 Phase 2)" />

    {/* 통계 + 일괄 버튼 */}
    <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder }}>
        전체 <span style={{ color: T.primary }}>{stats.total}</span>건
        <span style={{ color: T.gray500, margin: '0 8px' }}>·</span>
        추천 있음 <span style={{ color: T.success }}>{stats.withSug}</span>건
        <span style={{ color: T.gray500, margin: '0 8px' }}>·</span>
        추천 없음 <span style={{ color: T.danger }}>{stats.withoutSug}</span>건
      </div>
      <button onClick={load} disabled={loading} style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: T.fs.xs, border: '1.5px solid ' + T.border, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
        🔄 새로고침
      </button>
      <AIBtn onClick={applyAllSuggestions} disabled={processing === 'bulk' || stats.withSug === 0} label={processing === 'bulk' ? '처리 중…' : `✓ 추천 ${stats.withSug}건 일괄 적용`} style={{ background: T.success }} />
    </div>

    {/* 필터 */}
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      {[
        { id: 'all', label: '전체' },
        { id: 'withSuggestion', label: '추천 있음' },
        { id: 'withoutSuggestion', label: '추천 없음 (수동 지정 필요)' },
      ].map(t => (
        <button key={t.id} onClick={() => setFilter(t.id)}
          style={{
            padding: '7px 14px', borderRadius: 18, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: T.fs.xs, fontWeight: filter === t.id ? 700 : 500,
            background: filter === t.id ? T.primary : T.gray100,
            color: filter === t.id ? '#fff' : T.gray600,
          }}>{t.label}</button>
      ))}
    </div>

    {loading ? <div style={{ padding: 30, textAlign: 'center', color: T.textMuted }}>로딩 중…</div>
      : byCustomer.length === 0 ? <AEmpty icon="check" message="모든 보유권의 구매지점이 판정되었습니다 🎉" />
      : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {byCustomer.map(group => (
          <div key={group.customer_id || group.pkgs[0].pkg_id} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{group.cust_name || '(고객명 없음)'}</span>
              {group.cust_num && <span style={{ fontSize: 10, color: T.gray500, fontFamily: 'monospace' }}>#{group.cust_num}</span>}
              {group.phone && <span style={{ fontSize: 11, color: T.textMuted }}>{group.phone}</span>}
              <ABadge color={T.primary}>{group.pkgs.length}건</ABadge>
            </div>

            {/* 매출 분포 */}
            {group.pkgs[0].sales_dist?.length > 0 && (
              <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 10, padding: '6px 10px', background: T.gray100, borderRadius: 6 }}>
                <span style={{ fontWeight: 600, marginRight: 6 }}>매출 분포:</span>
                {group.pkgs[0].sales_dist.map((d, i) => (
                  <span key={i} style={{ marginRight: 10 }}>
                    {branchById[d.bid] || d.bid.slice(0, 8)} <b style={{ color: T.text }}>{d.cnt}</b>건
                  </span>
                ))}
              </div>
            )}

            {/* 권 목록 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.pkgs.map(r => (
                <PkgRow key={r.pkg_id} r={r} branches={data?.branches || []} branchById={branchById} fmtBal={fmtBal} onApply={applyBranch} processing={processing === r.pkg_id} />
              ))}
            </div>
          </div>
        ))}
      </div>
    }
  </div>
}

// 권 하나 + 지점 선택 UI
function PkgRow({ r, branches, branchById, fmtBal, onApply, processing }) {
  const [selected, setSelected] = useState(r.suggested_bid || '')
  const isAnnual = /연간(회원|할인)?권/.test(r.service_name || '')
  return (
    <div style={{ border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: T.fs.xs, fontWeight: T.fw.bolder, color: T.text, marginBottom: 2 }}>
          {r.service_name || '(이름없음)'}
          {isAnnual && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: '#EFF6FF', color: '#1E40AF', marginLeft: 6 }}>🌐 연간권</span>}
        </div>
        <div style={{ fontSize: T.fs.xxs, color: T.textMuted }}>
          {r.purchased_at?.slice(0, 10) || '-'} · {fmtBal(r)}
        </div>
      </div>
      {r.suggested_bid && (
        <div style={{ fontSize: T.fs.xxs, color: T.success, fontWeight: 700, flexShrink: 0 }}>
          💡 추천: {branchById[r.suggested_bid] || r.suggested_bid} ({r.suggested_cnt}회)
        </div>
      )}
      <select value={selected} onChange={e => setSelected(e.target.value)}
        style={{ padding: '6px 10px', fontSize: T.fs.xs, border: '1.5px solid ' + T.border, borderRadius: 6, fontFamily: 'inherit', flexShrink: 0 }}>
        <option value="">지점 선택</option>
        {branches.filter(b => b.useYn !== false).map(b => (
          <option key={b.id} value={b.id}>{b.short || b.name}</option>
        ))}
      </select>
      <button onClick={() => onApply(r.pkg_id, selected)} disabled={!selected || processing}
        style={{ padding: '6px 12px', fontSize: T.fs.xs, fontWeight: 700, border: 'none', borderRadius: 6, background: selected ? T.primary : T.gray300, color: '#fff', cursor: selected ? 'pointer' : 'not-allowed', fontFamily: 'inherit', flexShrink: 0 }}>
        {processing ? '…' : '적용'}
      </button>
    </div>
  )
}

export default AdminBranchAudit
