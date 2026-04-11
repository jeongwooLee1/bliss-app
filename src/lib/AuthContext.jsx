import { createContext, useContext, useState, useEffect } from 'react'
import { SB_URL, SB_KEY } from './supabase'
import { supabase } from './supabase'

const AuthContext = createContext(null)
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
const uid = () => Math.random().toString(36).slice(2, 13);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [phase, setPhase] = useState('loading')

  useEffect(() => {
    // 1. 기존 세션 복원
    try {
      const saved = sessionStorage.getItem('bliss_user')
      if (saved) { setCurrentUser(JSON.parse(saved)); setPhase('app'); return; }
    } catch {}

    // 2. Supabase Auth 세션 확인 (OAuth 리다이렉트 후)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const appUser = await handleOAuthUser(session.user)
        if (appUser) {
          sessionStorage.setItem('bliss_user', JSON.stringify(appUser))
          setCurrentUser(appUser)
          setPhase('app')
        } else {
          setPhase('login')
        }
      } else {
        setPhase('login')
      }
    })

    // 3. Auth 상태 변화 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const appUser = await handleOAuthUser(session.user)
        if (appUser) {
          sessionStorage.setItem('bliss_user', JSON.stringify(appUser))
          setCurrentUser(appUser)
          setPhase('app')
        }
      }
    })

    return () => subscription?.unsubscribe()
  }, [])

  // OAuth 유저 → app_users 매핑 (없으면 자동 생성)
  const handleOAuthUser = async (authUser) => {
    const email = authUser.email
    if (!email) return null
    try {
      // 1. 기존 app_users에서 이메일로 검색
      const res = await fetch(
        `${SB_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
        { headers: H }
      )
      const users = await res.json()
      if (users?.length) return users[0]

      // 2. 없으면 자동으로 비즈니스 + 지점 + 계정 생성
      const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || email.split('@')[0]
      const provider = authUser.app_metadata?.provider || 'oauth'
      const bizId = 'biz_' + uid()
      const brId = 'br_' + uid()
      const accId = 'acc_' + uid()
      const loginId = provider + '_' + uid()
      const bizName = name + '님의 사업장'
      const exp = new Date(); exp.setDate(exp.getDate() + 14);

      // businesses 생성
      await fetch(`${SB_URL}/rest/v1/businesses`, {
        method: 'POST', headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          id: bizId, name: bizName, code: loginId, phone: '',
          settings: JSON.stringify({ plan: 'trial', planExpiry: exp.toISOString().slice(0, 10) }),
          use_yn: true
        })
      })

      // branches 생성
      await fetch(`${SB_URL}/rest/v1/branches`, {
        method: 'POST', headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          id: brId, business_id: bizId, name: bizName, short: name.slice(0, 5),
          phone: '', sort: 0, use_yn: true
        })
      })

      // app_users 생성
      const newUser = {
        id: accId, business_id: bizId, login_id: loginId, password: uid(),
        name, role: 'owner', email,
        branch_ids: JSON.stringify([brId]), view_branch_ids: JSON.stringify([brId])
      }
      await fetch(`${SB_URL}/rest/v1/app_users`, {
        method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
        body: JSON.stringify(newUser)
      })

      // 생성된 유저 조회
      const res2 = await fetch(
        `${SB_URL}/rest/v1/app_users?id=eq.${accId}&select=*&limit=1`,
        { headers: H }
      )
      const created = await res2.json()
      if (created?.length) {
        // 새 유저 표시 (설정 마법사 트리거용)
        sessionStorage.setItem('bliss_new_oauth_user', 'true')
        return created[0]
      }
      return null
    } catch (e) {
      console.error('[auth] OAuth user handling error:', e)
      return null
    }
  }

  // ID/PW 로그인
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

  // 소셜 로그인 (OAuth)
  const loginWithProvider = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/bliss-app/` }
    })
    if (error) throw error
  }

  const logout = () => {
    sessionStorage.removeItem('bliss_user')
    sessionStorage.removeItem('bliss_new_oauth_user')
    supabase.auth.signOut().catch(() => {})
    setCurrentUser(null)
    setPhase('login')
  }

  return (
    <AuthContext.Provider value={{ currentUser, phase, login, loginWithProvider, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
