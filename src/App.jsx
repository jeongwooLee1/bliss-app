import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import { useAppData } from './lib/useData'
import LoginPage from './pages/LoginPage'
import AppShell from './pages/AppShell'

export default function App() {
  const { phase } = useAuth()

  if (phase === 'loading') return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh' }}>
      <div style={{ color:'#7c7cc8', fontSize:14 }}>로딩중...</div>
    </div>
  )

  if (phase === 'login') return <LoginPage />

  return <AppShell />
}
