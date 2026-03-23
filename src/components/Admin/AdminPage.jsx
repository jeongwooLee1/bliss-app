import { T } from '../../lib/constants'

export default function AdminPage({ onLogout }) {
  return (
    <div style={{ padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <h2 style={{ margin:0, fontSize:T.fs.xl, fontWeight:T.fw.black }}>메뉴</h2>
        <button onClick={onLogout} style={{ padding:'6px 12px', borderRadius:T.radius.md, border:`1px solid ${T.border}`, background:'none', cursor:'pointer', fontSize:T.fs.xs, color:T.textSub }}>
          로그아웃
        </button>
      </div>
      <div style={{ color:T.textMuted, fontSize:T.fs.sm }}>관리 메뉴를 준비 중입니다</div>
    </div>
  )
}
