import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { T } from '../lib/constants'

export default function LoginPage() {
  const { login, loginWithProvider } = useAuth()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [showIdPw, setShowIdPw] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault(); setErr(''); setLoading(true)
    try { await login(id, pw) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const handleSocial = async (provider) => {
    setErr(''); setLoading(true)
    try { await loginWithProvider(provider) }
    catch (e) { setErr(e.message || '소셜 로그인 실패'); setLoading(false) }
  }

  const socialBtn = (provider, label, bg, color, icon) => (
    <button onClick={() => handleSocial(provider)} disabled={loading} style={{
      width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      background: bg, color, border: provider === 'kakao' ? '1px solid #e5d800' : 'none',
      borderRadius: T.radius.md, fontSize: T.fs.md, fontWeight: T.fw.bold,
      cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
      transition: 'opacity .2s'
    }}>
      <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  )

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, fontWeight: T.fw.black, color: T.primary, letterSpacing: -1 }}>Bliss</div>
          <div style={{ fontSize: T.fs.sm, color: T.textMuted, marginTop: 4 }}>뷰티샵 예약관리</div>
        </div>

        <div style={{ background: T.bgCard, borderRadius: T.radius.xl, padding: 24, boxShadow: T.shadow.md }}>
          {/* 소셜 로그인 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {socialBtn('kakao', '카카오로 시작하기', '#FEE500', '#3C1E1E', '💬')}
            {socialBtn('google', 'Google로 시작하기', '#fff', '#333', '🔍')}
          </div>

          {/* 구분선 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
            <div style={{ flex: 1, height: 1, background: T.border }} />
            <span style={{ fontSize: T.fs.xs, color: T.textMuted }}>또는</span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </div>

          {/* ID/PW 토글 */}
          {!showIdPw ? (
            <button onClick={() => setShowIdPw(true)} style={{
              width: '100%', height: 44, background: 'none', border: `1px solid ${T.border}`,
              borderRadius: T.radius.md, fontSize: T.fs.sm, color: T.textSub, cursor: 'pointer', fontFamily: 'inherit'
            }}>
              아이디/비밀번호로 로그인
            </button>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <input value={id} onChange={e => setId(e.target.value)} placeholder="아이디"
                  style={{ width: '100%', height: 44, border: `1px solid ${T.border}`, borderRadius: T.radius.md, padding: '0 12px', fontSize: T.fs.md, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="비밀번호"
                  style={{ width: '100%', height: 44, border: `1px solid ${T.border}`, borderRadius: T.radius.md, padding: '0 12px', fontSize: T.fs.md, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <button type="submit" disabled={loading} style={{
                width: '100%', height: 44, background: T.primary, color: '#fff', border: 'none',
                borderRadius: T.radius.md, fontSize: T.fs.md, fontWeight: T.fw.bold,
                cursor: 'pointer', opacity: loading ? 0.7 : 1, fontFamily: 'inherit'
              }}>
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>
          )}

          {err && <div style={{ fontSize: T.fs.xs, color: T.danger, marginTop: 12, textAlign: 'center' }}>{err}</div>}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: T.fs.xs, color: T.textMuted }}>
          계정이 없으신가요? 소셜 로그인으로 바로 시작할 수 있어요.
        </div>
      </div>
    </div>
  )
}
