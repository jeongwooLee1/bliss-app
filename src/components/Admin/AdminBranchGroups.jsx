import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { APageHeader, AIBtn, AEmpty, ABadge } from './AdminUI'

// 지점 연계 — 마스터/오너 전용
// 같은 원장이 관리하는 지점들을 연계해 보유권 공유 등 정책 공용 적용
// 향후 확장: 메시지함 필터, 매출 공유, 직원 권한 세분화
function AdminBranchGroups({ data, setData, bizId }) {
  const branches = data?.branches || []
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // group id or 'new'
  const [editName, setEditName] = useState('')
  const [editBids, setEditBids] = useState([])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${SB_URL}/rest/v1/branch_groups?business_id=eq.${bizId}&select=*&order=name.asc`, { headers: sbHeaders })
      const rows = await r.json()
      const list = Array.isArray(rows) ? rows : []
      setGroups(list)
      if (setData) setData(prev => prev ? { ...prev, branchGroups: list } : prev)
    } catch (e) { console.error('[branchGroups] load:', e) }
    setLoading(false)
  }
  useEffect(() => { if (bizId) load() }, [bizId])

  const branchById = useMemo(() => {
    const m = {}
    branches.forEach(b => { m[b.id] = b.short || b.name || b.id })
    return m
  }, [branches])

  const startNew = () => {
    setEditing('new')
    setEditName('')
    setEditBids([])
  }
  const startEdit = g => {
    setEditing(g.id)
    setEditName(g.name || '')
    setEditBids(g.branch_ids || [])
  }
  const cancelEdit = () => { setEditing(null); setEditName(''); setEditBids([]) }

  const saveEdit = async () => {
    const name = editName.trim()
    if (!name) { alert('연계 이름을 입력하세요'); return }
    if (editBids.length < 2) { alert('최소 2개 지점을 선택하세요'); return }
    try {
      if (editing === 'new') {
        const newId = 'bg_' + Math.random().toString(36).slice(2, 10)
        await sb.insert('branch_groups', { id: newId, business_id: bizId, name, branch_ids: editBids })
      } else {
        await sb.update('branch_groups', editing, { name, branch_ids: editBids, updated_at: new Date().toISOString() })
      }
      await load()
      cancelEdit()
    } catch (e) { alert('저장 실패: ' + (e?.message || e)) }
  }

  const delGroup = async g => {
    if (!confirm(`"${g.name}" 연계를 삭제할까요?\n(이 연계로 공유되던 보유권은 개별 예외 등록이 없으면 구매지점에서만 사용 가능해집니다)`)) return
    try {
      await sb.del('branch_groups', g.id)
      await load()
    } catch (e) { alert('삭제 실패: ' + (e?.message || e)) }
  }

  const toggleBid = bid => {
    setEditBids(prev => prev.includes(bid) ? prev.filter(x => x !== bid) : [...prev, bid])
  }

  // 각 지점이 소속된 그룹(중복 방지 용)
  const bidGroupMap = useMemo(() => {
    const m = {}
    groups.forEach(g => (g.branch_ids || []).forEach(b => { (m[b] = m[b] || []).push(g) }))
    return m
  }, [groups])

  return <div>
    <div style={{marginBottom:14}}>
      <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
        <I name="link" size={15} style={{color:T.primary}}/> 지점 연계
      </div>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,lineHeight:1.5}}>
        같은 원장이 관리하는 지점들을 연계합니다. 연계된 지점끼리는 보유권·쿠폰을 자유롭게 공유 사용합니다.
      </div>
    </div>

    {loading ? <div style={{ padding: 30, textAlign: 'center', color: T.textMuted }}>로딩 중…</div>
      : <>
        {/* 목록 */}
        {groups.length === 0 ? <AEmpty icon="building" message="등록된 연계가 없어요" />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {groups.map(g => (
              <div key={g.id} className="card" style={{ padding: 14 }}>
                {editing === g.id
                  ? <EditForm name={editName} setName={setEditName} bids={editBids} toggleBid={toggleBid} branches={branches} bidGroupMap={bidGroupMap} editingId={g.id} onSave={saveEdit} onCancel={cancelEdit} />
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: T.fs.md, fontWeight: T.fw.bolder, color: T.text }}>{g.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                      {(g.branch_ids || []).map(bid => (
                        <span key={bid} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: T.primaryLt, color: T.primaryDk, fontWeight: 700 }}>
                          {branchById[bid] || bid}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => startEdit(g)} style={{ width: 32, height: 32, borderRadius: 7, border: '1px solid ' + T.border, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I name="edit" size={14} style={{ color: T.gray500 }} /></button>
                    <button onClick={() => delGroup(g)} style={{ width: 32, height: 32, borderRadius: 7, border: '1px solid #fecaca', background: '#fff5f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I name="trash" size={14} style={{ color: T.danger }} /></button>
                  </div>}
              </div>
            ))}
          </div>}

        {/* 신규 추가 */}
        {editing === 'new'
          ? <div className="card" style={{ padding: 14, border: '2px dashed ' + T.primary }}>
            <EditForm name={editName} setName={setEditName} bids={editBids} toggleBid={toggleBid} branches={branches} bidGroupMap={bidGroupMap} editingId={null} onSave={saveEdit} onCancel={cancelEdit} />
          </div>
          : <button onClick={startNew} style={{ width: '100%', padding: '14px', fontSize: T.fs.sm, fontWeight: 700, border: '1.5px dashed ' + T.border, borderRadius: 10, background: '#fafafa', color: T.gray600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + 새 연계 추가
          </button>}

        {/* 안내 */}
        <div className="card" style={{ padding: 14, marginTop: 16, background: '#f8f9ff', border: '1px solid #e0e7ff' }}>
          <div style={{ fontSize: T.fs.xs, color: T.gray700, lineHeight: 1.7 }}>
            💡 <strong>지점 연계 규칙</strong><br />
            <span style={{ color: T.textMuted }}>
              • 한 지점이 두 연계에 속하면 양쪽 모두에서 공유됩니다<br />
              • 연간회원권은 연계과 무관하게 전 지점 공통<br />
              • 개별 권/쿠폰만 추가 지점 허용은 고객관리 → 보유권 카드의 "추가 허용 지점"에서 설정<br />
              • Phase 2 예정: 연계 권한이 메시지함·타임라인·매출 등에도 확장 적용
            </span>
          </div>
        </div>
      </>}
  </div>
}

function EditForm({ name, setName, bids, toggleBid, branches, bidGroupMap, editingId, onSave, onCancel }) {
  return <div>
    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>연계 이름</div>
    <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 강남·왕십리"
      style={{ width: '100%', padding: '10px 12px', fontSize: T.fs.sm, border: '1.5px solid ' + T.border, borderRadius: 8, fontFamily: 'inherit', marginBottom: 12, boxSizing: 'border-box' }} />
    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 6, fontWeight: 700 }}>연계할 지점 (2개 이상)</div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {branches.filter(b => b.useYn !== false).map(b => {
        const checked = bids.includes(b.id)
        const otherGroups = (bidGroupMap[b.id] || []).filter(g => g.id !== editingId)
        return <label key={b.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
          fontSize: T.fs.xs, fontWeight: checked ? 700 : 500,
          border: '1.5px solid ' + (checked ? T.primary : T.border),
          background: checked ? T.primaryLt : '#fff',
          color: checked ? T.primaryDk : T.text,
          borderRadius: 16, cursor: 'pointer'
        }}>
          <input type="checkbox" checked={checked} onChange={() => toggleBid(b.id)} style={{ margin: 0 }} />
          <span>{b.short || b.name}</span>
          {otherGroups.length > 0 && <span style={{ fontSize: 9, color: T.textMuted }}>({otherGroups.map(g => g.name).join(',')} 소속)</span>}
        </label>
      })}
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <AIBtn onClick={onSave} label="저장" style={{ flex: 1 }} />
      <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1.5px solid ' + T.border, background: 'none', fontSize: T.fs.sm, fontWeight: 600, color: T.textSub, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
    </div>
  </div>
}

export default AdminBranchGroups
