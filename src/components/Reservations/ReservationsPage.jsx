import { useState } from 'react'
import { T, STATUS_LABEL } from '../../lib/constants'

export default function ReservationsPage({ data, currentUser, isMaster }) {
  const [search, setSearch] = useState('')
  const reservations = data?.reservations || []
  const branches = data?.branches || []

  const userBranches = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)

  const filtered = reservations
    .filter(r => userBranches.includes(r.bid))
    .filter(r => !search || r.cust_name?.includes(search) || r.cust_phone?.includes(search))
    .sort((a,b) => b.date.localeCompare(a.date) || b.time?.localeCompare(a.time||''))

  const getBranchName = (bid) => branches.find(b=>b.id===bid)?.short || ''
  const getStatusColor = (s) => {
    if (s==='confirmed') return T.success
    if (s==='completed') return T.textMuted
    if (s==='cancelled'||s==='naver_cancelled') return T.danger
    if (s==='pending') return T.orange
    return T.textSub
  }

  return (
    <div>
      <div style={{ padding:'12px 16px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, position:'sticky', top:0, zIndex:20 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름, 전화번호 검색"
          style={{ width:'100%', height:40, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'0 12px', fontSize:T.fs.sm, outline:'none', background:T.gray100 }} />
      </div>

      <div>
        {filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:T.textMuted, fontSize:T.fs.sm }}>예약이 없습니다</div>
        ) : filtered.map(r => {
          const br = branches.find(b=>b.id===r.bid)
          return (
            <div key={r.id} style={{ padding:'12px 16px', borderBottom:`1px solid ${T.border}`, background:T.bgCard, display:'flex', gap:12 }}>
              <div style={{ width:4, background:br?.color||T.border, borderRadius:2, flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:T.fs.sm, fontWeight:T.fw.bold }}>{r.cust_name}</span>
                    <span style={{ fontSize:T.fs.xs, color:T.textMuted }}>{getBranchName(r.bid)}</span>
                  </div>
                  <span style={{ fontSize:T.fs.xs, fontWeight:T.fw.bold, color:getStatusColor(r.status) }}>
                    {STATUS_LABEL[r.status]||r.status}
                  </span>
                </div>
                <div style={{ fontSize:T.fs.xs, color:T.textSub }}>
                  {r.date} {r.time} · {r.cust_phone}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
