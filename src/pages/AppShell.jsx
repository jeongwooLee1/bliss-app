import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useAppData, useEmployees, useSchHistory } from '../lib/useData'
import { T } from '../lib/constants'
import BottomNav from '../components/common/BottomNav'
import TimelinePage from '../components/Timeline/TimelinePage'
import ReservationsPage from '../components/Reservations/ReservationsPage'
import MessagesPage from '../components/Messages/MessagesPage'
import SchedulePage from '../components/Schedule/SchedulePage'
import AdminPage from '../components/Admin/AdminPage'

export default function AppShell() {
  const { currentUser, logout } = useAuth()
  const { data, setData, loading } = useAppData()
  const { employees } = useEmployees()
  const { schHistory } = useSchHistory()
  const [page, setPage] = useState('timeline')

  const isMaster = ['owner','super','manager'].includes(currentUser?.role)

  if (loading || !data) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', color:T.primary, fontSize:T.fs.sm }}>
      로딩중...
    </div>
  )

  const sharedProps = { data, setData, currentUser, isMaster, employees, schHistory }

  return (
    <div style={{ maxWidth:480, margin:'0 auto', minHeight:'100dvh', background:T.bg, position:'relative' }}>
      <div style={{ paddingBottom:72 }}>
        {page === 'timeline'     && <TimelinePage {...sharedProps} />}
        {page === 'reservations' && <ReservationsPage {...sharedProps} />}
        {page === 'messages'     && <MessagesPage {...sharedProps} />}
        {page === 'schedule'     && isMaster && <SchedulePage {...sharedProps} />}
        {page === 'admin'        && isMaster && <AdminPage {...sharedProps} onLogout={logout} />}
      </div>
      <BottomNav page={page} setPage={setPage} isMaster={isMaster} />
    </div>
  )
}
