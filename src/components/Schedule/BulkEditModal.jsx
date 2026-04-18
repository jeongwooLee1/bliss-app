import { T } from '../../lib/constants'
import { BRANCHES_SCH, getSColor } from './scheduleConstants'

export default function BulkEditModal({ selectedCells, onSet, onClose }) {
  if (!selectedCells || selectedCells.size === 0) return null

  const applyStatus = (st) => {
    selectedCells.forEach(key => {
      const [eid, ds] = key.split('__')
      onSet(eid, ds, st)
    })
    onClose(st)
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.3)', zIndex:200 }} onMouseDown={onClose}/>
    <div data-bulk-modal style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:22, zIndex:201, width:280, boxShadow:'0 10px 40px rgba(0,0,0,.2)' }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'#221810' }}>📋 {selectedCells.size}개 셀 선택됨</div>
        <div style={{ fontSize:11, color:T.textMuted, marginTop:4 }}>상태를 선택하면 일괄 적용됩니다</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
        <button onClick={() => applyStatus('')}
          style={{ padding:'9px 14px', borderRadius:8, border:'2px solid '+T.border, background:T.gray100, color:T.textMuted,
            fontFamily:'inherit', fontSize:13, fontWeight:400, cursor:'pointer', textAlign:'left' }}>
          — 삭제 (빈칸)
        </button>
        {['근무','휴무','휴무(꼭)','무급'].map(st => {
          const sc = getSColor(st)
          return <button key={st} onClick={() => applyStatus(st)}
            style={{ padding:'9px 14px', borderRadius:8, border:`2px solid ${sc.border}`, background:sc.bg, color:sc.text,
              fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', textAlign:'left', transition:'all .12s' }}>
            {st}
          </button>
        })}
        {BRANCHES_SCH.map(b => {
          const sv = `지원(${b.name})`
          const sc = getSColor(sv)
          return <button key={sv} onClick={() => applyStatus(sv)}
            style={{ padding:'9px 14px', borderRadius:8, border:'2px solid #e4ddd6', background:T.bgCard, color:'#c87020',
              fontFamily:'inherit', fontSize:13, fontWeight:400, cursor:'pointer', textAlign:'left', transition:'all .12s' }}>
            지원 → {b.name}
          </button>
        })}
      </div>
      <button onClick={() => onClose(null)} style={{ marginTop:12, width:'100%', padding:'8px', border:'1px solid #ddd', borderRadius:8, background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:12, color:'#999' }}>취소</button>
    </div>
  </>
}
