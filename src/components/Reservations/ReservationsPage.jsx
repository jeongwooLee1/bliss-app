import { useState, useMemo } from 'react'
import { T, STATUS_LABEL } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import ReservationModal from '../Timeline/ReservationModal'

function todayStr() { return new Date().toISOString().slice(0,10) }

const STATUS_COLOR = {
  confirmed: T.success, completed: T.textMuted,
  cancelled: T.danger, naver_cancelled: T.danger,
  no_show: T.danger, pending: T.orange, naver_changed: T.textMuted
}

export default function ReservationsPage({ data, setData, currentUser, isMaster, employees }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [dateFilter, setDateFilter] = useState('upcoming')
  const [modal, setModal] = useState(null)

  const branches = data?.branches || []
  const reservations = data?.reservations || []
  const userBranchIds = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const today = todayStr()

  const filtered = useMemo(() => {
    let list = reservations.filter(r => userBranchIds.includes(r.bid))
    if (statusFilter === 'active') list = list.filter(r => ['confirmed','pending'].includes(r.status))
    else if (statusFilter === 'completed') list = list.filter(r => ['completed','no_show'].includes(r.status))
    else if (statusFilter === 'cancelled') list = list.filter(r => ['cancelled','naver_cancelled','naver_changed'].includes(r.status))

    if (dateFilter === 'today') list = list.filter(r => r.date === today)
    else if (dateFilter === 'upcoming') list = list.filter(r => r.date >= today)
    else if (dateFilter === 'past') list = list.filter(r => r.date < today)

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.cust_name?.includes(q) || r.cust_phone?.includes(q))
    }
    return list.sort((a,b) => a.date===b.date ? (a.time||'').localeCompare(b.time||'') : a.date.localeCompare(b.date))
  }, [reservations, statusFilter, dateFilter, search, userBranchIds, today])

  const getBranch = (bid) => branches.find(b=>b.id===bid)

  const handleSave = (saved) => {
    if (saved.id && reservations.find(r=>r.id===saved.id)) {
      setData(p=>({...p, reservations: p.reservations.map(r=>r.id===saved.id?saved:r)}))
    } else {
      setData(p=>({...p, reservations:[...(p.reservations||[]),saved]}))
    }
    setModal(null)
  }

  const handleDelete = (id) => {
    setData(p=>({...p, reservations: p.reservations.filter(r=>r.id!==id)}))
    setModal(null)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>
      {/* 검색 */}
      <div style={{flexShrink:0,background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:12}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름, 전화번호 검색"
          style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 12px',fontSize:T.fs.sm,outline:'none',background:T.gray100,boxSizing:'border-box'}}/>
        {/* 날짜 필터 */}
        <div style={{display:'flex',gap:6,marginTop:8}}>
          {[['today','오늘'],['upcoming','예정'],['past','지난'],['all','전체']].map(([v,l])=>(
            <button key={v} onClick={()=>setDateFilter(v)}
              style={{flex:1,padding:'5px 0',borderRadius:T.radius.md,border:`1px solid ${dateFilter===v?T.primary:T.border}`,background:dateFilter===v?T.primaryLt:'none',color:dateFilter===v?T.primary:T.textSub,fontSize:T.fs.xs,fontWeight:dateFilter===v?T.fw.bold:T.fw.normal,cursor:'pointer'}}>
              {l}
            </button>
          ))}
        </div>
        {/* 상태 필터 */}
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {[['active','진행중'],['completed','완료'],['cancelled','취소'],['all','전체']].map(([v,l])=>(
            <button key={v} onClick={()=>setStatusFilter(v)}
              style={{flex:1,padding:'5px 0',borderRadius:T.radius.md,border:`1px solid ${statusFilter===v?T.primary:T.border}`,background:statusFilter===v?T.primaryLt:'none',color:statusFilter===v?T.primary:T.textSub,fontSize:T.fs.xs,fontWeight:statusFilter===v?T.fw.bold:T.fw.normal,cursor:'pointer'}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      <div style={{flex:1,overflowY:'auto'}}>
        {/* 새 예약 버튼 */}
        <div style={{padding:'8px 12px'}}>
          <button onClick={()=>setModal({res:null,branch:branches[0],staffId:null,date:today,time:'10:00'})}
            style={{width:'100%',height:40,background:T.primary,color:'#fff',border:'none',borderRadius:T.radius.md,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:'pointer'}}>
            + 새 예약 등록
          </button>
        </div>

        <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:'4px 12px',marginBottom:4}}>
          {filtered.length}건
        </div>

        {filtered.length === 0 ? (
          <div style={{padding:40,textAlign:'center',color:T.textMuted,fontSize:T.fs.sm}}>예약이 없습니다</div>
        ) : filtered.map(r => {
          const br = getBranch(r.bid)
          const statusColor = STATUS_COLOR[r.status] || T.textSub
          const isPast = r.date < today
          return (
            <div key={r.id} onClick={()=>setModal({res:r,branch:br,staffId:r.staff_id,date:r.date,time:r.time})}
              style={{padding:'10px 12px',borderBottom:`1px solid ${T.border}`,background:T.bgCard,display:'flex',gap:10,cursor:'pointer',opacity:isPast&&r.status==='confirmed'?0.6:1}}>
              <div style={{width:3,background:br?.color||T.border,borderRadius:2,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.text}}>{r.cust_name}</span>
                    {r.cust_gender==='F'&&<span style={{fontSize:9,color:'#e91e8c',fontWeight:700}}>여</span>}
                    {r.cust_gender==='M'&&<span style={{fontSize:9,color:'#1565c0',fontWeight:700}}>남</span>}
                    <span style={{fontSize:T.fs.xs,color:T.textMuted}}>{br?.short||''}</span>
                  </div>
                  <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bold,color:statusColor,flexShrink:0}}>
                    {STATUS_LABEL[r.status]||r.status}
                  </span>
                </div>
                <div style={{fontSize:T.fs.xs,color:T.textSub,display:'flex',gap:8,flexWrap:'wrap'}}>
                  <span>{r.date} {r.time}</span>
                  {r.dur && <span>{r.dur}분</span>}
                  {r.staff_id && <span>담당: {r.staff_id}</span>}
                </div>
                {r.cust_phone && <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>{r.cust_phone}</div>}
                {r.source==='naver'||r.source==='네이버' ? (
                  <span style={{display:'inline-block',marginTop:3,fontSize:9,padding:'1px 5px',borderRadius:3,background:'#03c75a22',color:'#03c75a',fontWeight:700}}>네이버</span>
                ) : null}
                {r.is_prepaid && <span style={{display:'inline-block',marginTop:3,marginLeft:4,fontSize:9,padding:'1px 5px',borderRadius:3,background:T.orangeLt,color:T.orange,fontWeight:700}}>예약금</span>}
              </div>
            </div>
          )
        })}
      </div>

      {modal && (
        <ReservationModal data={modal} allData={data} employees={employees}
          onSave={handleSave} onDelete={handleDelete} onClose={()=>setModal(null)}/>
      )}
    </div>
  )
}
