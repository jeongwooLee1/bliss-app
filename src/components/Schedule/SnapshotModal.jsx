import { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { BRANCHES_SCH, STATUS, DNAMES, getSColor, isSupport, getDim, fmtDs, getDow0Mon } from './scheduleConstants'

function toKST(isoStr) {
  const d = new Date(isoStr)
  // UTC+9
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const mm = kst.getUTCMonth() + 1
  const dd = kst.getUTCDate()
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mi = String(kst.getUTCMinutes()).padStart(2, '0')
  return { dateStr: `${mm}/${dd}`, timeStr: `${hh}:${mi}` }
}

export default function SnapshotModal({ snapshots, allEmployees, curKey, onRollback, onClose }) {
  const months = Object.keys(snapshots || {}).sort().reverse()
  const [selMonth, setSelMonth] = useState(months[0] || '')
  const [selIdx, setSelIdx] = useState(null)
  const [confirmRollback, setConfirmRollback] = useState(false)

  const monthSnapshots = (snapshots[selMonth] || []).slice().reverse()
  const selected = selIdx !== null ? monthSnapshots[selIdx] : null

  const handleRollback = () => {
    if (!selected) return
    onRollback(selMonth, selected.data)
    setConfirmRollback(false)
    onClose()
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,960px)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexShrink:0 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'#4a2c14' }}>📋 확정 이력</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>

      {months.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:T.textMuted, fontSize:14 }}>확정된 이력이 없습니다.</div>
      ) : (
        <div style={{ display:'flex', gap:16, flex:1, minHeight:0, overflow:'hidden' }}>
          {/* 왼쪽: 월 + 스냅샷 목록 */}
          <div style={{ width:200, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {months.map(m => (
                <button key={m} onClick={() => { setSelMonth(m); setSelIdx(null); setConfirmRollback(false) }}
                  style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                    border:`1.5px solid ${selMonth===m ? T.primary : T.border}`,
                    background:selMonth===m ? T.primaryLt : T.bgCard,
                    color:selMonth===m ? T.primaryDk : T.textSub,
                    fontWeight:selMonth===m ? 700 : 400 }}>
                  {m}
                </button>
              ))}
            </div>
            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
              {monthSnapshots.map((snap, i) => {
                const { dateStr, timeStr } = toKST(snap.ts)
                const empCount = Object.keys(snap.data || {}).length
                return (
                  <button key={i} onClick={() => { setSelIdx(i); setConfirmRollback(false) }}
                    style={{ padding:'8px 10px', borderRadius:8, fontSize:12, fontFamily:'inherit', cursor:'pointer', textAlign:'left',
                      border:`1.5px solid ${selIdx===i ? T.primary : T.border}`,
                      background:selIdx===i ? T.primaryLt : T.bgCard,
                      color:T.text }}>
                    <div style={{ fontWeight:700, fontSize:13 }}>{dateStr} {timeStr}</div>
                    <div style={{ fontSize:10, color:T.textMuted, marginTop:2 }}>직원 {empCount}명</div>
                  </button>
                )
              })}
              {monthSnapshots.length === 0 && (
                <div style={{ fontSize:12, color:T.textMuted, padding:8 }}>이 달의 확정 이력이 없습니다.</div>
              )}
            </div>
            {/* 롤백 버튼 */}
            {selected && (
              <div style={{ flexShrink:0, borderTop:'1px solid '+T.border, paddingTop:8 }}>
                {!confirmRollback ? (
                  <button onClick={() => setConfirmRollback(true)}
                    style={{ width:'100%', padding:'9px 0', borderRadius:8, border:'1.5px solid '+T.warning, background:T.warningLt, color:'#7a5a00', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    🔄 이 이력으로 되돌리기
                  </button>
                ) : (
                  <div style={{ background:'#fff8e0', border:'1.5px solid '+T.warning, borderRadius:8, padding:10, textAlign:'center' }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#7a4a00', marginBottom:6 }}>
                      {selMonth} 근무표를 이 시점으로 되돌립니다
                    </div>
                    <div style={{ fontSize:11, color:T.textMuted, marginBottom:10 }}>현재 데이터가 덮어씌워집니다.</div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => setConfirmRollback(false)}
                        style={{ flex:1, padding:'7px 0', borderRadius:6, border:'1px solid #ddd', background:'#f5f5f5', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>취소</button>
                      <button onClick={handleRollback}
                        style={{ flex:1, padding:'7px 0', borderRadius:6, border:'none', background:T.warning, color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:700 }}>확인</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 오른쪽: 스냅샷 테이블 */}
          <div style={{ flex:1, overflow:'auto', minWidth:0, border:'1px solid '+T.border, borderRadius:8 }}>
            {selected ? (
              <SnapshotTable data={selected.data} month={selMonth} allEmployees={allEmployees}/>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:T.textMuted, fontSize:13 }}>
                왼쪽에서 확정 이력을 선택하세요.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  </>
}

function SnapshotTable({ data, month, allEmployees }) {
  const [y, m] = month.split('-').map(Number)
  const year = y, mon = m - 1
  const dim = getDim(year, mon)

  const days = useMemo(() => {
    const arr = []
    for (let d = 1; d <= dim; d++) {
      const ds = fmtDs(year, mon, d)
      arr.push({ d, ds, dow:getDow0Mon(year, mon, d) })
    }
    return arr
  }, [year, mon, dim])

  const empsInData = allEmployees.filter(e => data[e.id])
  const grouped = BRANCHES_SCH.map(br => ({
    ...br, emps: empsInData.filter(e => e.branch === br.id)
  })).filter(br => br.emps.length > 0)

  const maleEmps = empsInData.filter(e => e.isMale)

  return (
    <table style={{ borderCollapse:'collapse', fontSize:10, minWidth:'max-content' }}>
      <thead style={{ position:'sticky', top:0, zIndex:5, background:T.gray100 }}>
        <tr>
          <th style={{ padding:'4px 8px', textAlign:'left', borderBottom:'2px solid '+T.border, fontSize:11, color:T.textSub, position:'sticky', left:0, background:T.gray100, zIndex:6, minWidth:80 }}>직원</th>
          {days.map(day => {
            const isSun = day.dow === 6, isSat = day.dow === 5
            return <th key={day.ds} style={{ minWidth:32, padding:'3px 1px', textAlign:'center', borderBottom:'2px solid '+T.border, fontSize:10, color:isSun ? T.danger : isSat ? T.purple : T.textSub }}>
              <div>{day.d}</div>
              <div style={{ fontSize:8 }}>{DNAMES[day.dow]}</div>
            </th>
          })}
        </tr>
      </thead>
      <tbody>
        {grouped.map(br => (
          <>
            <tr key={'h-'+br.id}>
              <td colSpan={days.length+1} style={{ padding:'3px 8px', background:br.color+'20', borderLeft:'3px solid '+br.color, fontSize:10, fontWeight:700, color:br.color, borderBottom:'1px solid '+T.border }}>
                {br.name}
              </td>
            </tr>
            {br.emps.map(emp => (
              <tr key={emp.id}>
                <td style={{ padding:'3px 6px', fontSize:10, fontWeight:500, borderBottom:'1px solid '+T.border, position:'sticky', left:0, background:T.bgCard, borderLeft:'3px solid '+br.color }}>
                  {emp.name}
                </td>
                {days.map(day => {
                  const s = data[emp.id]?.[day.ds] || ''
                  const sc = getSColor(s)
                  const label = s === STATUS.WORK ? '근' : s === STATUS.OFF ? '휴' : s === STATUS.MUST_OFF ? '꼭' : s === STATUS.UNPAID ? '무급' : isSupport(s) ? '지원' : s === STATUS.SHARE ? '쉐어' : '—'
                  return <td key={day.ds} style={{ padding:1, textAlign:'center', borderBottom:'1px solid '+T.border }}>
                    <div style={{ background:s ? sc.bg : 'transparent', color:s ? sc.text : '#ddd', border:s ? `1px solid ${sc.border}` : '1px dashed #eee', borderRadius:3, padding:'2px 0', fontSize:9, fontWeight:s ? 600 : 400 }}>
                      {label}
                    </div>
                  </td>
                })}
              </tr>
            ))}
          </>
        ))}
        {maleEmps.length > 0 && <>
          <tr>
            <td colSpan={days.length+1} style={{ padding:'3px 8px', background:T.primary+'20', borderLeft:'3px solid '+T.primary, fontSize:10, fontWeight:700, color:T.primary, borderBottom:'1px solid '+T.border }}>남자직원</td>
          </tr>
          {maleEmps.map(emp => (
            <tr key={emp.id}>
              <td style={{ padding:'3px 6px', fontSize:10, fontWeight:500, borderBottom:'1px solid '+T.border, position:'sticky', left:0, background:T.bgCard, borderLeft:'3px solid '+T.primary }}>{emp.name}</td>
              {days.map(day => {
                const s = data[emp.id]?.[day.ds] || ''
                const sc = getSColor(s)
                const label = s === STATUS.WORK ? '근' : s === STATUS.OFF ? '휴' : s === STATUS.MUST_OFF ? '꼭' : s === STATUS.UNPAID ? '무급' : '—'
                return <td key={day.ds} style={{ padding:1, textAlign:'center', borderBottom:'1px solid '+T.border }}>
                  <div style={{ background:s ? sc.bg : 'transparent', color:s ? sc.text : '#ddd', border:s ? `1px solid ${sc.border}` : '1px dashed #eee', borderRadius:3, padding:'2px 0', fontSize:9, fontWeight:s ? 600 : 400 }}>{label}</div>
                </td>
              })}
            </tr>
          ))}
        </>}
      </tbody>
    </table>
  )
}
