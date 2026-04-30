import { T } from '../../lib/constants'
import { BRANCHES_SCH } from './scheduleConstants'

export default function SupportSettingsModal({ supportOrder, onSave, onClose }) {
  // 호환: 배열이면 객체로 변환 (legacy)
  const cur = (supportOrder && typeof supportOrder === 'object' && !Array.isArray(supportOrder))
    ? supportOrder
    : {}
  const branches = BRANCHES_SCH.filter(b => b.id !== 'male')

  const toggle = (fromBId, toBId) => {
    if (fromBId === toBId) return
    const list = Array.isArray(cur[fromBId]) ? cur[fromBId] : []
    const has = list.includes(toBId)
    const nextList = has ? list.filter(id => id !== toBId) : [...list, toBId]
    onSave({ ...cur, [fromBId]: nextList })
  }

  const setMutual = (fromBId, toBId, on) => {
    if (fromBId === toBId) return
    const next = { ...cur }
    const ensure = (k) => Array.isArray(next[k]) ? [...next[k]] : []
    let aList = ensure(fromBId)
    let bList = ensure(toBId)
    if (on) {
      if (!aList.includes(toBId)) aList.push(toBId)
      if (!bList.includes(fromBId)) bList.push(fromBId)
    } else {
      aList = aList.filter(id => id !== toBId)
      bList = bList.filter(id => id !== fromBId)
    }
    next[fromBId] = aList
    next[toBId] = bList
    onSave(next)
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:20, zIndex:201, width:'min(98vw,820px)', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#4a2c14' }}>🏢 지점지원 설정 (양방향 매트릭스)</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>
      <div style={{ fontSize:11, color:T.textMuted, marginBottom:12, padding:'8px 10px', background:'#fff8f0', borderRadius:6, border:'1px solid #f0ddc4' }}>
        가로축 = 출발 지점, 세로축 = 지원 가는 지점. 클릭하면 <b>양방향</b> 동시 토글 (A→B 켜면 B→A도 켜짐).
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', minWidth:'100%' }}>
          <thead>
            <tr>
              <th style={{ padding:'8px 6px', fontSize:11, color:T.textSub, fontWeight:700, position:'sticky', left:0, background:'#fff', zIndex:1 }}>출발↓ / 갈곳→</th>
              {branches.map(b => (
                <th key={b.id} style={{ padding:'8px 4px', fontSize:11, fontWeight:700, color:b.color, textAlign:'center', minWidth:70, borderBottom:`2px solid ${b.color}33` }}>
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {branches.map(from => (
              <tr key={from.id}>
                <td style={{ padding:'8px 6px', fontSize:11, fontWeight:700, color:from.color, position:'sticky', left:0, background:'#fff', borderRight:`2px solid ${from.color}33` }}>
                  {from.name}
                </td>
                {branches.map(to => {
                  if (from.id === to.id) {
                    return <td key={to.id} style={{ padding:6, textAlign:'center', background:'#f8f8f8' }}>
                      <span style={{ fontSize:10, color:T.gray400 }}>—</span>
                    </td>
                  }
                  const isOn = (cur[from.id] || []).includes(to.id)
                  const reverse = (cur[to.id] || []).includes(from.id)
                  const mutual = isOn && reverse
                  return <td key={to.id} style={{ padding:4, textAlign:'center' }}>
                    <button onClick={() => setMutual(from.id, to.id, !isOn)}
                      title={mutual ? '양방향 활성' : isOn ? '한쪽만 활성' : '비활성'}
                      style={{
                        width:38, height:28, borderRadius:6, fontSize:11, fontFamily:'inherit', cursor:'pointer', fontWeight:700,
                        border: mutual ? `2px solid ${from.color}` : isOn ? `1.5px solid ${from.color}99` : '1px solid #e0e0e0',
                        background: mutual ? from.color+'30' : isOn ? from.color+'15' : '#fafafa',
                        color: isOn ? from.color : T.gray400
                      }}>
                      {mutual ? '⇄' : isOn ? '→' : ''}
                    </button>
                  </td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:14, display:'flex', gap:8, flexWrap:'wrap' }}>
        <button onClick={() => {
          onSave({
            yongsan: ['hongdae', 'gangnam', 'wangsimni'],
            hongdae: ['yongsan', 'magok'],
            magok: ['hongdae'],
            gangnam: ['yongsan', 'wangsimni'],
            wangsimni: ['yongsan', 'gangnam'],
            jamsil: ['cheonho'],
            cheonho: ['jamsil', 'wirye'],
            wirye: ['cheonho'],
          })
        }} style={{ padding:'7px 14px', borderRadius:6, border:'1px solid '+T.border, background:'#fff8f0', color:'#7a4a18', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          📋 표준 프리셋 적용
        </button>
        <button onClick={() => onSave({})} style={{ padding:'7px 14px', borderRadius:6, border:'1px solid '+T.border, background:'#fff', color:T.textSub, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
          전체 해제
        </button>
      </div>
      <div style={{ marginTop:10, fontSize:10, color:'#bbb' }}>
        ⇄ = 양방향 / → = 한쪽 / 빈칸 = 비활성. 셀 클릭은 양방향 동시 토글.
      </div>

      {/* 지원 우선순위 (도착 지점 기준) */}
      <div style={{ marginTop:24, padding:'14px 16px', background:'#fdf8f0', borderRadius:10, border:'1px solid #e4ddc4' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#4a2c14', marginBottom:6 }}>📊 지원 우선순위 (도착 지점 기준)</div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:12 }}>각 지점에 지원이 필요할 때, 어느 지점에서 먼저 가져올지 순서를 정합니다. ▲▼ 으로 변경.</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10 }}>
          {branches.map(dest => {
            const sources = Array.isArray(cur[dest.id]) ? cur[dest.id] : []
            if (sources.length === 0) return null
            const move = (idx, dir) => {
              const newIdx = idx + dir
              if (newIdx < 0 || newIdx >= sources.length) return
              const next = [...sources]
              ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
              onSave({ ...cur, [dest.id]: next })
            }
            return (
              <div key={dest.id} style={{ background:'#fff', borderRadius:8, padding:'10px 12px', border:`1.5px solid ${dest.color}33` }}>
                <div style={{ fontSize:11, fontWeight:700, color:dest.color, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:dest.color }}/>
                  {dest.name} ← 부족 시
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {sources.map((srcId, i) => {
                    const src = branches.find(b => b.id === srcId)
                    if (!src) return null
                    return (
                      <div key={srcId} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px', background:src.color+'11', border:`1px solid ${src.color}33`, borderRadius:5 }}>
                        <span style={{ fontSize:10, fontWeight:700, color:src.color, minWidth:18, background:src.color+'22', borderRadius:3, padding:'1px 5px', textAlign:'center' }}>
                          {i+1}
                        </span>
                        <span style={{ fontSize:11, fontWeight:600, color:src.color, flex:1 }}>{src.name}</span>
                        <button onClick={()=>move(i,-1)} disabled={i===0}
                          style={{ width:22, height:22, borderRadius:4, border:'1px solid #ddd', background:i===0?'#f5f5f5':'#fff', cursor:i===0?'default':'pointer', fontSize:10, fontFamily:'inherit', color:'#7a4a18' }}>▲</button>
                        <button onClick={()=>move(i,1)} disabled={i===sources.length-1}
                          style={{ width:22, height:22, borderRadius:4, border:'1px solid #ddd', background:i===sources.length-1?'#f5f5f5':'#fff', cursor:i===sources.length-1?'default':'pointer', fontSize:10, fontFamily:'inherit', color:'#7a4a18' }}>▼</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop:10, fontSize:10, color:'#bbb' }}>※ 위 매트릭스에서 활성화된 지점만 표시됩니다. 빈 카드는 활성화된 지원 지점이 없는 곳.</div>
      </div>
    </div>
  </>
}
