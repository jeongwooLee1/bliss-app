import { T } from '../../lib/constants'

export default function Badge({ label, color, bg, style={} }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center',
      padding:'2px 7px', borderRadius:T.radius.full,
      fontSize:T.fs.xxs, fontWeight:T.fw.bold,
      color: color || T.primary,
      background: bg || T.primaryLt,
      ...style
    }}>
      {label}
    </span>
  )
}
