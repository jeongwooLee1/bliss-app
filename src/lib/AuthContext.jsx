import { createContext, useContext, useState, useEffect } from 'react'
import { SB_URL, SB_KEY } from './supabase'

const AuthContext = createContext(null)
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [phase, setPhase] = useState('loading')

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('bliss_user')
      if (saved) { setCurrentUser(JSON.parse(saved)); setPhase('app') }
      else setPhase('login')
    } catch { setPhase('login') }
  }, [])

  const login = async (loginId, password) => {
    const res = await fetch(
      `${SB_URL}/rest/v1/app_users?login_id=eq.${encodeURIComponent(loginId)}&select=*&limit=1`,
      { headers: H }
    )
    const users = await res.json()
    if (!users?.length) throw new Error('아이디를 찾을 수 없습니다')
    const user = users[0]
    if (user.password !== password) throw new Error('비밀번호가 틀렸습니다')
    sessionStorage.setItem('bliss_user', JSON.stringify(user))
    setCurrentUser(user)
    setPhase('app')
    return user
  }

  const logout = () => {
    sessionStorage.removeItem('bliss_user')
    setCurrentUser(null)
    setPhase('login')
  }

  return (
    <AuthContext.Provider value={{ currentUser, phase, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
