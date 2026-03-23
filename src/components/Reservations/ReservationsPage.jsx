import { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { fmtDate, getDow, getStatusLabel, getStatusColor, getSvcNames, getTagNames } from '../../lib/utils'
import { useReservations } from '../../lib/useReservations'
import ReservationModal from '../Timeline/ReservationModal'
import Icon from '../common/Icon'

export default function ReservationsPage({ data, setData, currentUser, isMaster }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterBranch, setFilterBranch] = useState('all')
  const [modalItem, setModalItem] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const { upsert } = useReservations(data, setData)

  const branches = data?.branches || []
  const reservations = data?.reservations || []
  const services = data?.services || []
  const tags = data?.serviceTags || []

  const userBranches = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)

  const filtered = useMemo(() => {
    return reservations
      .filter(r => userBranches.includes(r.bid))
      .filter(r => filterBranch === 'all' || r.bid === filterBranch)
      .filter(r => filterStatus === 'all' || r.status === filterStatus)
      .filter(r => !search ||
        r.cust_name?.includes(search) ||
        r.cust_phone?.includes(search) ||
        r.reservation_id?.includes(search)
      )
      .sort((a,b) => b.date.localeCompare(a.date) || (b.time||'').localeCompare(a.time||''))
  }, [reservations, userBranches, filterBranch, filterStatus, search])

  const getBranch = (bid) => branches.find(b=>b.id===bid)

  const openEdit = (r) => { setModalItem(r); setModalOpen(true) }
  const openNew = () => { setModalItem({ status:'confirmed', selected_tags:[], selected_services:[] }); setModalOpen(true) }

  const handleSave = async (item) => {
    await upsert(item)
    setModalOpen(false)
  }

  const STATUSES = [
    { v:'all', label:'전체' },
    { v:'pending', label:'대기' },
    { v:'confirmed', label:'진행' },
    { v:'completed', label:'완료' },
    { v:'cancelled', label:'취소' },
    { v:'no_show', label:'노쇼' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh' }}>
      {/* 검색 헤더 */}
      <div style={{ padding:'10px 12px', background:T.bgCard, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ position:'relative', marginBottom:8 }}>
          <Icon name="search" size={15} color={T.textMuted} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)' }}/>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="이름, 전화번호, 예약번호"
            style={{ width:'100%', height:38, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'0 10px 0 32px', fontSize:T.fs.sm, outline:'none', background:T.gray100 }}
          />
        </div>

        {/* 상태 필터 */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
          {STATUSES.map(s => (
            <button key={s.v} onClick={()=>setFilterStatus(s.v)} style={{
              padding:'3px 10px', borderRadius:T.radius.full, flexShrink:0,
              border:`1px solid ${filterStatus===s.v?T.primary:T.border}`,
              background: filterStatus===s.v ? T.primaryLt : T.bgCard,
              color: filterStatus===s.v ? T.primary : T.textSub,
              fontSize:T.fs.xxs, fontWeight:T.fw.bold, cursor:'pointer',
            }}>{s.label}</button>
          ))}
        </div>

        {/* 지점 필터 (isMaster만) */}
        {isMaster && (
          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingTop:6 }}>
            <button onClick={()=>setFilterBranch('all')} style={filterBtnStyle(filterBranch==='all')}>전체</button>
            {branches.map(b=>(
              <button key={b.id} onClick={()=>setFilterBranch(b.id)} style={{
                ...filterBtnStyle(filterBranch===b.id),
                borderColor: filterBranch===b.id ? b.color : T.border,
                background: filterBranch===b.id ? b.color+'22' : T.bgCard,
                color: filterBranch===b.id ? b.color : T.textSub,
              }}>{b.short||b.name}</button>
            ))}
          </div>
        )}
      </div>

      {/* 목록 */}
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:'4px 0', fontSize:T.fs.xxs, color:T.textMuted, textAlign:'right', paddingRight:12 }}>
          {filtered.length}건
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:T.textMuted, fontSize:T.fs.sm }}>예약이 없습니다</div>
        ) : filtered.map(r => {
          const br = getBranch(r.bid)
          const rtags = getTagNames(r.selected_tags, tags)
          return (
            <div key={r.id} onClick={()=>openEdit(r)} style={{
              padding:'10px 12px', borderBottom:`1px solid ${T.border}`,
              background:T.bgCard, display:'flex', gap:10, cursor:'pointer',
              '&:hover':{ background:T.gray100 }
            }}>
              <div style={{ width:3, background:br?.color||T.border, borderRadius:2, flexShrink:0 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:T.fs.sm, fontWeight:T.fw.bold }}>{r.cust_name}</span>
                    <span style={{ fontSize:T.fs.xxs, color:T.textMuted }}>{br?.short||''}</span>
                    {r.is_new_cust && <span style={{ fontSize:T.fs.nano, background:'#fde8e8', color:'#c0392b', padding:'1px 5px', borderRadius:T.radius.full, fontWeight:T.fw.bold }}>신규</span>}
                  </div>
                  <span style={{ fontSize:T.fs.xxs, fontWeight:T.fw.bold, color:getStatusColor(r.status, T) }}>
                    {getStatusLabel(r.status)}
                  </span>
                </div>
                <div style={{ fontSize:T.fs.xs, color:T.textSub, marginBottom:3 }}>
                  {fmtDate(r.date)} ({getDow(r.date)}) {r.time?.slice(0,5)}
                  {r.dur ? ` · ${r.dur}분` : ''}
                  {r.cust_phone ? ` · ${r.cust_phone}` : ''}
                </div>
                {(r.selected_services?.length > 0 || rtags.length > 0) && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:3 }}>
                    {r.selected_services?.slice(0,2).map(sid => {
                      const svc = services.find(s=>s.id===sid)
                      return svc ? (
                        <span key={sid} style={{ fontSize:T.fs.nano, background:T.gray100, color:T.textSub, padding:'1px 6px', borderRadius:T.radius.full }}>
                          {svc.name}
                        </span>
                      ) : null
                    })}
                    {rtags.map(tag => (
                      <span key={tag.id} style={{ fontSize:T.fs.nano, background:(tag.color||T.primary)+'22', color:tag.color||T.primary, padding:'1px 6px', borderRadius:T.radius.full, fontWeight:T.fw.bold }}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
                {r.source === 'naver' && (
                  <span style={{ fontSize:T.fs.nano, background:'#e8f5e9', color:'#2e7d32', padding:'1px 5px', borderRadius:T.radius.full, marginTop:3, display:'inline-block' }}>
                    네이버
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 새 예약 버튼 */}
      <button onClick={openNew} style={{
        position:'fixed', bottom:82, right:16,
        width:52, height:52, borderRadius:'50%',
        background:T.primary, color:'#fff', border:'none',
        fontSize:24, cursor:'pointer', boxShadow:T.shadow.md, zIndex:50,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>+</button>

      <ReservationModal
        open={modalOpen} onClose={()=>setModalOpen(false)}
        item={modalItem} data={data} onSave={handleSave}
        currentUser={currentUser} isMaster={isMaster}
      />
    </div>
  )
}

const filterBtnStyle = (active) => ({
  padding:'3px 10px', borderRadius:T.radius.full, flexShrink:0,
  border:`1px solid ${active?T.primary:T.border}`,
  background: active ? T.primaryLt : T.bgCard,
  color: active ? T.primary : T.textSub,
  fontSize:T.fs.xxs, fontWeight:T.fw.bold, cursor:'pointer',
})
