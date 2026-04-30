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

export default function SnapshotModal({ snapshots, allEmployees, curKey, onRollback, onSettingsRollback, onClose }) {
  // _settings는 설정 백업 전용 키 — 월 탭에서 제외
  const months = Object.keys(snapshots || {}).filter(k => !k.startsWith('_')).sort().reverse()
  const settingsBackups = (snapshots?._settings || []).slice().reverse()
  const [selMonth, setSelMonth] = useState(months[0] || '__settings')
  const [selIdx, setSelIdx] = useState(null)
  const [confirmRollback, setConfirmRollback] = useState(false)

  const isSettingsTab = selMonth === '__settings'
  const monthSnapshots = isSettingsTab ? settingsBackups : (snapshots[selMonth] || []).slice().reverse()
  const selected = selIdx !== null ? monthSnapshots[selIdx] : null

  const handleRollback = () => {
    if (!selected) return
    if (isSettingsTab) {
      if (onSettingsRollback) onSettingsRollback(selected)
    } else {
      onRollback(selMonth, selected.data)
    }
    setConfirmRollback(false)
    onClose()
  }

  return <>
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:200 }} onClick={onClose}/>
    <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#fff', borderRadius:14, padding:24, zIndex:201, width:'min(96vw,960px)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 10px 40px rgba(0,0,0,.25)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexShrink:0 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'#4a2c14' }}>💾 백업</div>
        <button onClick={onClose} style={{ fontSize:16, lineHeight:1, padding:'2px 8px', borderRadius:6, border:'1px solid #ddd', background:'#f5f0ea', color:T.textSub, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
      </div>

      {(months.length === 0 && settingsBackups.length === 0) ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:T.textMuted, fontSize:14 }}>백업 이력이 없습니다.</div>
      ) : (
        <div style={{ display:'flex', gap:16, flex:1, minHeight:0, overflow:'hidden' }}>
          {/* 왼쪽: 월 + 설정 + 스냅샷 목록 */}
          <div style={{ width:200, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {/* 설정 탭 */}
              <button onClick={() => { setSelMonth('__settings'); setSelIdx(null); setConfirmRollback(false) }}
                style={{ padding:'5px 12px', borderRadius:6, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                  border:`1.5px solid ${isSettingsTab ? '#7a4a18' : T.border}`,
                  background:isSettingsTab ? '#fff3e0' : T.bgCard,
                  color:isSettingsTab ? '#7a4a18' : T.textSub,
                  fontWeight:isSettingsTab ? 700 : 400 }}>
                ⚙️ 설정 ({settingsBackups.length})
              </button>
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
                const empCount = isSettingsTab
                  ? Object.keys(snap.empSettings || {}).length
                  : Object.keys(snap.data || {}).length
                return (
                  <button key={i} onClick={() => { setSelIdx(i); setConfirmRollback(false) }}
                    style={{ padding:'8px 10px', borderRadius:8, fontSize:12, fontFamily:'inherit', cursor:'pointer', textAlign:'left',
                      border:`1.5px solid ${selIdx===i ? T.primary : T.border}`,
                      background:selIdx===i ? T.primaryLt : T.bgCard,
                      color:T.text }}>
                    <div style={{ fontWeight:700, fontSize:13 }}>{dateStr} {timeStr}</div>
                    <div style={{ fontSize:10, color:T.textMuted, marginTop:2 }}>{isSettingsTab ? `설정 (${empCount}명)` : `직원 ${empCount}명`}</div>
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
                      {isSettingsTab ? '설정값 전체를 이 시점으로 되돌립니다' : `${selMonth} 근무표를 이 시점으로 되돌립니다`}
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

          {/* 오른쪽: 스냅샷 테이블 / 설정 요약 */}
          <div style={{ flex:1, overflow:'auto', minWidth:0, border:'1px solid '+T.border, borderRadius:8 }}>
            {selected ? (
              isSettingsTab
                ? <SettingsSnapshotView snap={selected}/>
                : <SnapshotTable data={selected.data} month={selMonth} allEmployees={allEmployees}/>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:T.textMuted, fontSize:13 }}>
                왼쪽에서 백업을 선택하세요.
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
      arr.push({ d, ds, dow:getDow0Mon(year, mon, d), isNext:false })
    }
    // 마지막 주가 다음달로 이월되는 경우 그 날짜까지 포함 (배치 단위는 주)
    const lastDow = getDow0Mon(year, mon, dim)
    if (lastDow !== 6) {
      const daysToAdd = 6 - lastDow
      const nextYear = mon === 11 ? year+1 : year
      const nextMonth = mon === 11 ? 0 : mon+1
      for (let i = 1; i <= daysToAdd; i++) {
        const ds = fmtDs(nextYear, nextMonth, i)
        arr.push({ d:i, ds, dow:getDow0Mon(nextYear, nextMonth, i), isNext:true })
      }
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
            return <th key={day.ds} style={{ minWidth:32, padding:'3px 1px', textAlign:'center', borderBottom:'2px solid '+T.border, fontSize:10, color:day.isNext ? T.textMuted : isSun ? T.danger : isSat ? T.purple : T.textSub, opacity:day.isNext ? 0.55 : 1 }}>
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
                  return <td key={day.ds} style={{ padding:1, textAlign:'center', borderBottom:'1px solid '+T.border, opacity:day.isNext ? 0.55 : 1 }}>
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
                return <td key={day.ds} style={{ padding:1, textAlign:'center', borderBottom:'1px solid '+T.border, opacity:day.isNext ? 0.55 : 1 }}>
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

function SettingsSnapshotView({ snap }) {
  const rc = snap.ruleConfig || {}
  const empSettings = snap.empSettings || {}
  const ownerRepeat = snap.ownerRepeat || {}
  const employees = snap.employees || []
  const customEmps = snap.customEmployees || []
  return (
    <div style={{ padding:14, fontSize:12, color:T.text }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, color:T.primaryDk, marginBottom:6, fontSize:13 }}>📋 규칙 설정</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:6, fontSize:11, color:T.textSub }}>
          <div>일 최소 근무: <b style={{ color:T.text }}>{rc.minWork || '-'}</b></div>
          <div>일 최대 근무: <b style={{ color:T.text }}>{rc.maxWork || '-'}</b></div>
          <div>하루 최대 휴무: <b style={{ color:T.text }}>{rc.maxDailyOff || '-'}</b></div>
          <div>최대 연속 근무: <b style={{ color:T.text }}>{rc.maxConsecWork || '-'}</b></div>
        </div>
        <div style={{ marginTop:8, fontSize:11, color:T.textSub }}>
          지점별 최소: {Object.entries(rc.branchMinStaff || {}).map(([k,v]) => `${k}:${v}`).join(', ') || '-'}
        </div>
        <div style={{ marginTop:6, fontSize:11, color:T.textSub }}>
          동시휴무금지 그룹 <b style={{ color:T.text }}>{(rc.noSimultaneousOff || []).length}개</b>:
          <ul style={{ marginTop:4, paddingLeft:18 }}>
            {(rc.noSimultaneousOff || []).map((g, i) => (
              <li key={i} style={{ fontSize:10 }}>[{(g.ids || []).join(', ')}] · 최대 {g.max}명</li>
            ))}
          </ul>
        </div>
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, color:T.primaryDk, marginBottom:6, fontSize:13 }}>👥 직원 ({employees.length}명)</div>
        <div style={{ fontSize:10, color:T.textMuted, lineHeight:1.6 }}>
          {employees.map(e => `${e.name || e.id}(${e.rank || '-'}/${e.branch || '-'})`).join(', ')}
        </div>
        {customEmps.length > 0 && (
          <div style={{ fontSize:10, color:T.textMuted, marginTop:6 }}>
            프리랜서: {customEmps.map(e => e.name || e.id).join(', ')}
          </div>
        )}
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontWeight:700, color:T.primaryDk, marginBottom:6, fontSize:13 }}>⚙️ 직원별 설정</div>
        <div style={{ fontSize:10, color:T.textMuted, lineHeight:1.6 }}>
          {Object.entries(empSettings).map(([id, cfg]) => {
            const flags = []
            if (cfg.weeklyWork) flags.push(`주${cfg.weeklyWork}일`)
            if (cfg.altPattern) flags.push('격주')
            if (cfg.fixedOffEnabled) flags.push('휴무고정')
            if (cfg.excludeFromSchedule) flags.push('제외')
            const rep = ownerRepeat[id]
            if (rep?.enabled) flags.push(`반복:${(rep.dows || []).join(',')}`)
            return <div key={id}>{id}: {flags.join(' · ') || '-'}</div>
          })}
        </div>
      </div>
    </div>
  )
}
