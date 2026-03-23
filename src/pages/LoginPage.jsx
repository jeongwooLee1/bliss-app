import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { T } from '../lib/constants'

export default function LoginPage() {
  const { login } = useAuth()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault(); setErr(''); setLoading(true)
    try { await login(id, pw) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:T.bg, padding:20 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:32, fontWeight:T.fw.black, color:T.primary, letterSpacing:-1 }}>Bliss</div>
          <div style={{ fontSize:T.fs.sm, color:T.textMuted, marginTop:4 }}>하우스왁싱 예약관리</div>
        </div>
        <form onSubmit={handleSubmit} style={{ background:T.bgCard, borderRadius:T.radius.xl, padding:24, boxShadow:T.shadow.md }}>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:T.fs.xs, fontWeight:T.fw.bold, color:T.textSub, display:'block', marginBottom:6 }}>아이디</label>
            <input value={id} onChange={e=>setId(e.target.value)} placeholder="로그인 아이디"
              style={{ width:'100%', height:44, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'0 12px', fontSize:T.fs.md, outline:'none' }} />
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:T.fs.xs, fontWeight:T.fw.bold, color:T.textSub, display:'block', marginBottom:6 }}>비밀번호</label>
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="비밀번호"
              style={{ width:'100%', height:44, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'0 12px', fontSize:T.fs.md, outline:'none' }} />
          </div>
          {err && <div style={{ fontSize:T.fs.xs, color:T.danger, marginBottom:12 }}>{err}</div>}
          <button type="submit" disabled={loading}
            style={{ width:'100%', height:48, background:T.primary, color:'#fff', border:'none', borderRadius:T.radius.md, fontSize:T.fs.md, fontWeight:T.fw.bold, cursor:'pointer', opacity:loading?0.7:1 }}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
