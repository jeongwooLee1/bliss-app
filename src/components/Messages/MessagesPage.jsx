import { T } from '../../lib/constants'

export default function MessagesPage() {
  return (
    <div style={{ padding:40, textAlign:'center', color:T.textMuted }}>
      <div style={{ fontSize:32, marginBottom:12 }}>💬</div>
      <div style={{ fontSize:T.fs.md, fontWeight:T.fw.bold, color:T.text }}>메시지함</div>
      <div style={{ fontSize:T.fs.sm, marginTop:8 }}>네이버톡톡 메시지를 여기서 관리합니다</div>
    </div>
  )
}
