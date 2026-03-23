import { useState, useMemo, useRef, useCallback } from 'react'
import { T, SCH_BRANCH_MAP, branchColor } from '../../lib/constants'
import { todayStr, pad, fmtDate, getDow, timeToY, durationToH, addMinutes } from '../../lib/utils'
import { useReservations } from '../../lib/useReservations'
import ReservationModal from './ReservationModal'

const START_HOUR = 10
const END_HOUR = 22
const PX_PER_HOUR = 60
const COL_W = 76

export default function TimelinePage({ data, setData, employees, schHistory, currentUser, isMaster }) {
  const [selDate, setSelDate] = useState(todayStr())
  const [modalItem, setModalItem] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const { upsert, updateField } = useReservations(data, setData)

  const branches = data?.branches || []
  const reservations = data?.reservations || []
  const services = data?.services || []
  const tags = data?.serviceTags || []

  const userBranches = isMaster
    ? branches.map(b => b.id)
    : [currentUser?.branch_id].filter(Boolean)

  const visibleBranches = branches.filter(b => userBranches.includes(b.id))

  // 근무표 기반 직원 컬럼 (지원 근무 포함)
  const staffByBranch = useMemo(() => {
    const map = {}
    visibleBranches.forEach(br => { map[br.id] = [] })

    employees.forEach(emp => {
      if (emp.isMale) return
      const status = schHistory[emp.id]?.[selDate]
      if (status === '휴무' || status === '휴무(꼭)') return

      if (status?.startsWith('지원(')) {
        const brName = status.replace('지원(','').replace(')','')
        const targetBr = branches.find(b =>
          b.short === brName || b.name?.includes(brName)
        )
        if (targetBr && map[targetBr.id] !== undefined) {
          map[targetBr.id].push({ ...emp, isSupport: true, supportFrom: emp.branch })
          return
        }
      }

      const brId = SCH_BRANCH_MAP[emp.branch]
      if (brId && map[brId] !== undefined) map[brId].push(emp)
    })
    return map
  }, [employees, schHistory, selDate, branches, visibleBranches])

  const changeDate = (d) => {
    const dt = new Date(selDate)
    dt.setDate(dt.getDate() + d)
    setSelDate(dt.toISOString().slice(0,10))
  }

  const openNew = (time='10:00', staffId='', branchId='') => {
    setModalItem({
      date: selDate, time, dur: 60, status: 'confirmed',
      bid: branchId, staff_id: staffId,
      cust_name:'', cust_phone:'', selected_tags:[], selected_services:[],
    })
    setModalOpen(true)
  }

  const openEdit = (r) => {
    setModalItem(r)
    setModalOpen(true)
  }

  const handleSave = async (item) => {
    await upsert(item)
    setModalOpen(false)
  }

  const dateObj = new Date(selDate)
  const isToday = selDate === todayStr()

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh' }}>
      {/* 날짜 헤더 */}
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding:'10px 12px', background:T.bgCard,
        borderBottom:`1px solid ${T.border}`, flexShrink:0,
      }}>
        <button onClick={() => changeDate(-1)} style={navBtnStyle}>‹</button>
        <div style={{ flex:1, textAlign:'center' }}>
          <span style={{ fontSize:T.fs.md, fontWeight:T.fw.bolder, color: isToday ? T.primary : T.text }}>
            {dateObj.getMonth()+1}.{pad(dateObj.getDate())} ({getDow(selDate)})
          </span>
          {isToday && <span style={{ marginLeft:6, fontSize:T.fs.xxs, color:T.primary, background:T.primaryLt, padding:'1px 6px', borderRadius:T.radius.full }}>오늘</span>}
        </div>
        <button onClick={() => changeDate(1)} style={navBtnStyle}>›</button>
        <button onClick={() => setSelDate(todayStr())} style={{ ...navBtnStyle, fontSize:T.fs.xxs, width:'auto', padding:'0 8px', color:T.textSub }}>오늘</button>
      </div>

      {/* 타임라인 본체 */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'auto' }}>
        {visibleBranches.map(br => {
          const staff = staffByBranch[br.id] || []
          const brRes = reservations.filter(r =>
            r.bid === br.id && r.date === selDate &&
            r.status !== 'naver_cancelled' && r.status !== 'naver_changed'
          )

          return (
            <BranchTimeline
              key={br.id}
              branch={br}
              staff={staff}
              reservations={brRes}
              services={services}
              tags={tags}
              onClickCell={(time, staffId) => openNew(time, staffId, br.id)}
              onClickRes={openEdit}
              onUpdateField={updateField}
            />
          )
        })}
      </div>

      {/* 예약 추가 버튼 */}
      <button onClick={() => openNew()} style={{
        position:'fixed', bottom:82, right:16,
        width:52, height:52, borderRadius:'50%',
        background:T.primary, color:'#fff',
        border:'none', fontSize:24, cursor:'pointer',
        boxShadow:T.shadow.md, zIndex:50,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>+</button>

      <ReservationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        item={modalItem}
        data={data}
        onSave={handleSave}
        currentUser={currentUser}
        isMaster={isMaster}
      />
    </div>
  )
}

function BranchTimeline({ branch, staff, reservations, services, tags, onClickCell, onClickRes, onUpdateField }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR)
  const totalH = (END_HOUR - START_HOUR) * PX_PER_HOUR

  const color = branchColor(branch.id, branch.color)
  if (staff.length === 0) {
    return (
      <div style={{ marginBottom:1 }}>
        <div style={branchHeaderStyle(color)}>
          {branch.short || branch.name} · 오늘 근무자 없음
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom:1 }}>
      <div style={branchHeaderStyle(color)}>
        {branch.short || branch.name}
        <span style={{ marginLeft:8, fontSize:T.fs.xxs, opacity:0.8 }}>
          {staff.map(e => e.isSupport ? `${e.id}↓` : e.id).join(' · ')}
        </span>
      </div>

      <div style={{ display:'flex', overflowX:'auto' }}>
        {/* 시간축 */}
        <div style={{ width:34, flexShrink:0, borderRight:`1px solid ${T.border}`, position:'sticky', left:0, background:T.bgCard, zIndex:5 }}>
          <div style={{ height:28 }}/>
          {hours.map(h => (
            <div key={h} style={{ height:PX_PER_HOUR, borderTop:`1px solid ${T.gray200}`, padding:'2px 3px 0', fontSize:9, color:T.textMuted }}>
              {h}
            </div>
          ))}
        </div>

        {/* 직원 컬럼 */}
        {staff.map(emp => {
          const empRes = reservations.filter(r =>
            r.staff_id === emp.id ||
            (!r.staff_id && staff.length === 1)
          )
          return (
            <StaffColumn
              key={emp.id}
              emp={emp}
              branch={branch}
              reservations={empRes}
              services={services}
              tags={tags}
              totalH={totalH}
              hours={hours}
              onClickCell={(time) => onClickCell(time, emp.id)}
              onClickRes={onClickRes}
            />
          )
        })}

        {/* 네이버 예약 컬럼 (staff 없는 예약) */}
        {(() => {
          const naverRes = reservations.filter(r => !r.staff_id && staff.length > 1)
          if (!naverRes.length) return null
          return (
            <StaffColumn
              emp={{ id:'미배정', name:'미배정' }}
              branch={branch}
              reservations={naverRes}
              services={services}
              tags={tags}
              totalH={totalH}
              hours={hours}
              onClickCell={() => {}}
              onClickRes={onClickRes}
            />
          )
        })()}
      </div>
    </div>
  )
}

function StaffColumn({ emp, branch, reservations, services, tags, totalH, hours, onClickCell, onClickRes }) {
  return (
    <div style={{ width:COL_W, flexShrink:0, borderRight:`1px solid ${T.border}` }}>
      {/* 직원 헤더 */}
      <div style={{
        height:28, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:T.fs.xxs, fontWeight:T.fw.bold, borderBottom:`1px solid ${T.border}`,
        color: emp.isSupport ? T.orange : branchColor(branch.id, branch.color),
        background: emp.isSupport ? T.orangeLt : T.bgCard,
      }}>
        {emp.id}{emp.isSupport ? '↓' : ''}
      </div>

      {/* 시간 셀 */}
      <div style={{ position:'relative', height:totalH }}>
        {hours.map(h => (
          <div
            key={h}
            style={{ height:PX_PER_HOUR, borderTop:`1px solid ${T.gray200}`, cursor:'pointer' }}
            onClick={() => onClickCell(`${pad(h)}:00`)}
          >
            <div
              style={{ height:'50%', borderBottom:`1px dashed ${T.gray200}` }}
              onClick={e => { e.stopPropagation(); onClickCell(`${pad(h)}:30`) }}
            />
          </div>
        ))}

        {/* 예약 블록 */}
        {reservations.map(r => (
          <ResBlock
            key={r.id}
            res={r}
            branch={branch}
            services={services}
            onClick={() => onClickRes(r)}
          />
        ))}
      </div>
    </div>
  )
}

function ResBlock({ res, branch, services, onClick }) {
  const [h, m] = res.time.split(':').map(Number)
  const top = (h - START_HOUR) * PX_PER_HOUR + (m/60) * PX_PER_HOUR
  const height = Math.max(((res.dur||60)/60) * PX_PER_HOUR, 22)

  const svcName = res.selected_services?.length
    ? services.find(s => s.id === res.selected_services[0])?.name || ''
    : ''

  const isPending = res.status === 'pending'
  const isNaver = res.source === 'naver' || res.source === '네이버'
  const color = isPending ? T.orange : branchColor(branch.id, branch.color)

  return (
    <div
      onClick={onClick}
      style={{
        position:'absolute', top, left:2, right:2, height,
        background: isPending ? T.orangeLt : branch.color + '28',
        border:`1.5px solid ${color}`,
        borderRadius:4, padding:'2px 4px',
        overflow:'hidden', cursor:'pointer',
        display:'flex', flexDirection:'column', gap:1,
      }}
    >
      <div style={{ fontSize:9, fontWeight:T.fw.bolder, color, lineHeight:1.2 }}>
        {res.time.slice(0,5)} {isNaver ? '🟢' : ''}
      </div>
      <div style={{ fontSize:9, color:T.text, lineHeight:1.2, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
        {res.cust_name}
      </div>
      {height > 36 && svcName && (
        <div style={{ fontSize:8, color:T.textSub, lineHeight:1.2, overflow:'hidden' }}>
          {svcName}
        </div>
      )}
    </div>
  )
}

const navBtnStyle = {
  width:30, height:30, borderRadius:'50%',
  border:`1px solid ${T.border}`, background:'none',
  cursor:'pointer', fontSize:16, display:'flex',
  alignItems:'center', justifyContent:'center',
}

const branchHeaderStyle = (color) => ({
  padding:'5px 12px', fontSize:T.fs.xs, fontWeight:T.fw.bold,
  color: color, background: color + '18',
  borderLeft:`3px solid ${color}`,
  display:'flex', alignItems:'center',
})
