import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useAppData, useEmployees, useSchHistory } from '../lib/useData'
import { supabase } from '../lib/supabase'
import { T } from '../lib/constants'
import BottomNav from '../components/common/BottomNav'
import TimelinePage from '../components/Timeline/TimelinePage'
import ReservationsPage from '../components/Reservations/ReservationsPage'
import MessagesPage from '../components/Messages/MessagesPage'
import SchedulePage from '../components/Schedule/SchedulePage'
import AdminPage from '../components/Admin/AdminPage'

const BR_ACC = {
  'br_4bcauqvrb':'101171979','br_wkqsxj6k1':'102071377',
  'br_l6yzs2pkq':'102507795','br_k57zpkbx1':'101521969',
  'br_lfv2wgdf1':'101522539','br_g768xdu4w':'101517367',
  'br_ybo3rmulv':'101476019','br_xu60omgdf':'101988152',
}

export default function AppShell() {
  const { currentUser, logout } = useAuth()
  const { data, setData, loading } = useAppData()
  const { employees } = useEmployees()
  const { schHistory } = useSchHistory()
  const [page, setPage] = useState('timeline')
  const [unreadCount, setUnreadCount] = useState(0)

  const isMaster = ['owner','super','manager'].includes(currentUser?.role)
  const branches = data?.branches || []
  const userBranches = isMaster ? branches.map(b=>b.id) : [currentUser?.branch_id].filter(Boolean)
  const accIds = userBranches.map(b=>BR_ACC[b]).filter(Boolean)

  // 미읽 메시지 카운트
  useEffect(() => {
    if (!branches.length) return
    const load = async () => {
      let q = supabase.from('naver_messages').select('id', {count:'exact', head:true})
        .eq('is_read', false).eq('direction', 'in')
      if (accIds.length > 0) q = q.in('account_id', accIds)
      const { count } = await q
      setUnreadCount(count || 0)
    }
    load()

    const ch = supabase.channel('unread_count')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'naver_messages'},
        p => { if (p.new?.direction==='in'&&!p.new?.is_read&&(accIds.length===0||accIds.includes(p.new.account_id))) setUnreadCount(n=>n+1) }
      )
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'naver_messages'},
        () => load()
      ).subscribe()
    return () => ch.unsubscribe()
  }, [branches.length, accIds.join(',')])

  // App Badge API
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    const pending = (data?.reservations||[]).filter(r=>r.status==='pending'&&(isMaster||userBranches.includes(r.bid))).length
    const total = unreadCount + pending
    if (total > 0) navigator.setAppBadge(total).catch(()=>{})
    else navigator.clearAppBadge().catch(()=>{})
  }, [unreadCount, data, userBranches.join(','), isMaster])

  if (loading || !data) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', color:T.primary, fontSize:T.fs.sm }}>
      로딩중...
    </div>
  )

  const sharedProps = { data, setData, currentUser, isMaster, employees, schHistory }

  return (
    <div style={{ maxWidth:480, margin:'0 auto', minHeight:'100dvh', background:T.bg, position:'relative' }}>
      <div style={{ paddingBottom:72 }}>
        {page === 'timeline'     && <TimelinePage {...sharedProps}/>}
        {page === 'reservations' && <ReservationsPage {...sharedProps}/>}
        {page === 'messages'     && <MessagesPage {...sharedProps}/>}
        {page === 'schedule'     && isMaster && <SchedulePage employees={employees}/>}
        {page === 'admin'        && <AdminPage {...sharedProps} onLogout={logout}/>}
      </div>
      <BottomNav page={page} setPage={setPage} isMaster={isMaster} unreadCount={unreadCount}/>
    </div>
  )
}
