import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { APageHeader } from './AdminUI'

// 오늘
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
}
function parseExpiry(note) {
  const m = (note || '').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}
function parseBalance(note) {
  const m = (note || '').match(/잔액:\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) || 0 : null
}

// 보유권 유효기간 검토 — note의 "유효:YYYY-MM-DD"가 cutoff 이후이고 잔액≥1인 활성 보유권을 모아서 편집
function AdminLongValidityReview({ data, userBranches = [] }) {
  const branches = useMemo(
    () => (data?.branches || []).filter(b => b.useYn !== false && (userBranches.length === 0 || userBranches.includes(b.id))),
    [data?.branches, userBranches]
  )

  // 기본 cutoff: 오늘 기준 1년 후 (그 이후 만료가 검토 대상)
  const [cutoff, setCutoff] = useState(addDays(todayStr(), 364))
  const [branchSel, setBranchSel] = useState('all')
  const [search, setSearch] = useState('')

  const [pkgs, setPkgs] = useState([])
  const [custs, setCusts] = useState({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [editPkg, setEditPkg] = useState(null)

  const load = async () => {
    setLoading(true); setErr('')
    try {
      // note에 "유효:" 포함된 보유권만 (서버 측 1차 필터)
      const url = `${SB_URL}/rest/v1/customer_packages?note=ilike.${encodeURIComponent('*유효:*')}&select=id,customer_id,service_name,total_count,used_count,note,branch_id,allowed_branch_ids,created_at&order=id.desc&limit=20000`
      const r = await fetch(url, { headers: { ...sbHeaders, 'Cache-Control': 'no-cache' }, cache: 'no-store' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const list = await r.json()
      setPkgs(Array.isArray(list) ? list : [])

      const ids = [...new Set((list || []).map(p => p.customer_id).filter(Boolean))]
      const map = {}
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200)
        const cr = await fetch(`${SB_URL}/rest/v1/customers?id=in.(${batch.join(',')})&select=id,name,name2,phone,phone2,bid,cust_num`, { headers: sbHeaders })
        const cs = await cr.json()
        ;(cs || []).forEach(c => { map[c.id] = c })
      }
      setCusts(map)
    } catch (e) {
      setErr(e?.message || String(e))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    return pkgs
      .filter(p => {
        const exp = parseExpiry(p.note)
        if (!exp) return false
        if (exp <= cutoff) return false
        const remain = (p.total_count || 0) - (p.used_count || 0)
        if (remain < 1) return false
        // 지점 필터
        if (branchSel === 'unassigned') {
          if (p.branch_id) return false
        } else if (branchSel !== 'all') {
          if (p.branch_id !== branchSel) return false
        } else if (userBranches.length && p.branch_id && !userBranches.includes(p.branch_id)) {
          return false
        }
        // 검색
        if (search.trim()) {
          const c = custs[p.customer_id]
          const hay = [c?.name, c?.name2, c?.phone, c?.phone2, c?.cust_num, p.service_name].filter(Boolean).join(' ').toLowerCase()
          const tokens = search.trim().toLowerCase().split(/\s+/)
          if (!tokens.every(t => hay.includes(t))) return false
        }
        return true
      })
      .sort((a, b) => parseExpiry(b.note).localeCompare(parseExpiry(a.note)))
  }, [pkgs, custs, cutoff, branchSel, search, userBranches])

  const branchName = bid => {
    const b = (data?.branches || []).find(x => x.id === bid)
    return b ? (b.short || b.name) : (bid ? bid : '미판정')
  }

  const fmtRemain = p => {
    const bal = parseBalance(p.note)
    if (bal != null) return bal.toLocaleString() + '원'
    const remain = (p.total_count || 0) - (p.used_count || 0)
    return `${remain}/${p.total_count || 0}회`
  }

  const daysLeft = exp => {
    const today = new Date(todayStr())
    const e = new Date(exp)
    return Math.round((e - today) / 86400000)
  }

  const onSaveEdit = async (id, patch) => {
    const orig = pkgs.find(p => p.id === id)
    if (!orig) return
    const upd = {}
    if (patch.total_count != null) upd.total_count = Number(patch.total_count) || 0
    if (patch.used_count != null) upd.used_count = Number(patch.used_count) || 0
    let newNote = orig.note || ''
    if (patch.validUntil) {
      newNote = /유효:\s*\d{4}-\d{2}-\d{2}/.test(newNote)
        ? newNote.replace(/유효:\s*\d{4}-\d{2}-\d{2}/, `유효:${patch.validUntil}`)
        : (newNote ? `${newNote} | 유효:${patch.validUntil}` : `유효:${patch.validUntil}`)
    }
    if (patch.balance != null) {
      const balStr = `잔액:${Number(patch.balance).toLocaleString('ko-KR')}`
      newNote = /잔액:\s*[\d,]+/.test(newNote)
        ? newNote.replace(/잔액:\s*[\d,]+/, balStr)
        : (newNote ? `${newNote} | ${balStr}` : balStr)
    }
    if (newNote !== (orig.note || '')) upd.note = newNote
    if (Object.keys(upd).length === 0) { setEditPkg(null); return }
    await sb.update('customer_packages', id, upd)
    setPkgs(prev => prev.map(p => p.id === id ? { ...p, ...upd } : p))
    setEditPkg(null)
  }

  const onDelete = async id => {
    if (!confirm('이 보유권을 삭제할까요? 되돌릴 수 없어요.')) return
    await sb.del('customer_packages', id)
    setPkgs(prev => prev.filter(p => p.id !== id))
    setEditPkg(null)
  }

  const th = { padding: '10px 8px', fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.gray500, textAlign: 'left', background: T.bg, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { padding: '10px 8px', borderBottom: `1px solid ${T.gray100}`, fontSize: T.fs.xs, color: T.text, verticalAlign: 'middle' }

  return <div>
    <APageHeader title="보유권 유효기간 검토" desc={`만료일이 ${cutoff} 이후이며 잔여가 남은 보유권 — 비정상 장기 유효기간 검토용`} />

    {/* 필터 */}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: T.fs.nano, fontWeight: T.fw.bolder, color: T.gray500 }}>만료일 기준 (이후만 표시)</span>
        <input type="date" value={cutoff} onChange={e => setCutoff(e.target.value)}
          style={{ padding: '7px 10px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.xs, fontFamily: 'inherit' }} />
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
      {loading ? '불러오는 중...' : err ? <span style={{ color: T.danger }}>오류: {err}</span> : `검토 대상 ${filtered.length}건`}
    </div>

    {filtered.length > 0 && (
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>고객</th>
              <th style={th}>연락처</th>
              <th style={th}>지점</th>
              <th style={th}>보유권</th>
              <th style={{ ...th, textAlign: 'right' }}>잔여</th>
              <th style={th}>유효기간</th>
              <th style={{ ...th, textAlign: 'right' }}>남은일수</th>
              <th style={{ ...th, textAlign: 'center' }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const c = custs[p.customer_id]
              const exp = parseExpiry(p.note)
              const dleft = daysLeft(exp)
              return <tr key={p.id}>
                <td style={td}>
                  <div style={{ fontWeight: T.fw.bolder }}>{c?.name || '-'}{c?.name2 ? ` (${c.name2})` : ''}</div>
                  {c?.cust_num && <div style={{ fontSize: T.fs.nano, color: T.textMuted, fontFamily: 'monospace' }}>{c.cust_num}</div>}
                </td>
                <td style={td}>
                  <div>{c?.phone || '-'}</div>
                  {c?.phone2 && <div style={{ fontSize: T.fs.nano, color: T.textMuted }}>{c.phone2}</div>}
                </td>
                <td style={td}>{branchName(p.branch_id)}</td>
                <td style={td}>{p.service_name}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: T.fw.bolder }}>{fmtRemain(p)}</td>
                <td style={{ ...td, color: T.danger, fontWeight: T.fw.bolder }}>{exp}</td>
                <td style={{ ...td, textAlign: 'right', color: T.danger }}>{dleft}일</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={() => setEditPkg(p)}
                    style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid ' + T.border, background: '#fff', color: T.primary, fontSize: T.fs.nano, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit' }}>
                    편집
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
        검토 대상 없음 — 모든 보유권 유효기간이 정상 범위입니다.
      </div>
    )}

    {editPkg && <EditPkgModal pkg={editPkg} cust={custs[editPkg.customer_id]} branchLabel={branchName(editPkg.branch_id)}
      onClose={() => setEditPkg(null)} onSave={onSaveEdit} onDelete={onDelete} />}
  </div>
}

function EditPkgModal({ pkg, cust, branchLabel, onClose, onSave, onDelete }) {
  const expM = (pkg.note || '').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)
  const balM = (pkg.note || '').match(/잔액:\s*([\d,]+)/)
  const isPrepaid = !!balM

  const [validUntil, setValidUntil] = useState(expM ? expM[1] : '')
  const [totalCount, setTotalCount] = useState(pkg.total_count || 0)
  const [usedCount, setUsedCount] = useState(pkg.used_count || 0)
  const [balance, setBalance] = useState(balM ? Number(balM[1].replace(/,/g, '')) || 0 : 0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape' && !e.isComposing) onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const submit = async () => {
    if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) { alert('유효기간 형식 오류 (YYYY-MM-DD)'); return }
    setSaving(true)
    try {
      const patch = { validUntil: validUntil || undefined }
      if (isPrepaid) {
        patch.balance = balance
      } else {
        patch.total_count = totalCount
        patch.used_count = usedCount
      }
      await onSave(pkg.id, patch)
    } catch (e) { alert('저장 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const handleDel = async () => {
    setSaving(true)
    try { await onDelete(pkg.id) } catch (e) { alert('삭제 실패: ' + (e?.message || e)) }
    setSaving(false)
  }

  const inpStyle = { width: '100%', padding: '10px 12px', border: '1.5px solid ' + T.border, borderRadius: 8, fontSize: T.fs.sm, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl = { fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.gray500, marginBottom: 5, display: 'block' }

  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}
    onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto' }}>
      <div style={{ fontSize: T.fs.lg, fontWeight: T.fw.black, marginBottom: 6 }}>보유권 편집</div>
      <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginBottom: 16 }}>
        {cust?.name || '-'} · {branchLabel} · {pkg.service_name}
        {isPrepaid && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: T.primaryHover, color: T.primary, fontSize: T.fs.nano, fontWeight: T.fw.bolder }}>선불권</span>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>유효기간 (YYYY-MM-DD)</label>
        <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={inpStyle} />
      </div>

      {isPrepaid ? (
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>잔액 (원)</label>
          <input type="number" min="0" value={balance} onChange={e => setBalance(Number(e.target.value) || 0)} style={inpStyle} />
          <div style={{ fontSize: T.fs.nano, color: T.textMuted, marginTop: 4 }}>현재 note 잔액 값을 직접 덮어씁니다 — 신중히 변경하세요.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>총 회차</label>
              <input type="number" min="0" value={totalCount} onChange={e => setTotalCount(Number(e.target.value) || 0)} style={inpStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>사용 회차</label>
              <input type="number" min="0" value={usedCount} onChange={e => setUsedCount(Number(e.target.value) || 0)} style={inpStyle} />
            </div>
          </div>
          <div style={{ padding: '6px 10px', background: T.primaryHover, borderRadius: 6, fontSize: T.fs.xxs, color: T.primary, marginBottom: 14 }}>
            잔여 = {Math.max(0, totalCount - usedCount)}회
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={handleDel} disabled={saving}
          style={{ padding: '10px 14px', borderRadius: 8, border: '1.5px solid ' + T.danger, background: '#fff', color: T.danger, fontSize: T.fs.sm, fontWeight: T.fw.bolder, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          삭제
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={saving}
          style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px solid ' + T.border, background: '#fff', color: T.textSub, fontSize: T.fs.sm, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit' }}>
          취소
        </button>
        <button onClick={submit} disabled={saving}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: T.primary, color: '#fff', fontSize: T.fs.sm, fontWeight: T.fw.bolder, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  </div>
}

export default AdminLongValidityReview
