import { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { todayStr, fmtPhone, addMinutes } from '../../lib/utils'
import Modal from '../common/Modal'

export default function ReservationModal({ open, onClose, item, data, onSave, currentUser, isMaster }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const branches = data?.branches || []
  const services = data?.services || []
  const tags = data?.serviceTags || []

  useEffect(() => {
    if (open && item) {
      setForm({
        date: todayStr(), time:'10:00', dur:60, status:'confirmed',
        cust_name:'', cust_phone:'', cust_gender:'',
        selected_tags:[], selected_services:[],
        memo:'', staff_id:'', bid:'', source:'',
        ...item,
      })
    }
  }, [open, item])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.cust_name?.trim()) { alert('고객명을 입력해주세요'); return }
    setSaving(true)
    try { await onSave(form) }
    finally { setSaving(false) }
  }

  const toggleTag = (id) => {
    const cur = form.selected_tags || []
    set('selected_tags', cur.includes(id) ? cur.filter(t=>t!==id) : [...cur, id])
  }

  const toggleSvc = (id) => {
    const cur = form.selected_services || []
    const next = cur.includes(id) ? cur.filter(s=>s!==id) : [...cur, id]
    set('selected_services', next)
    // 시간 자동 계산
    const total = next.reduce((sum, sid) => {
      const svc = services.find(s=>s.id===sid)
      return sum + (svc?.dur || 0)
    }, 0)
    if (total > 0) set('dur', total)
  }

  const userBranch = isMaster ? null : currentUser?.branch_id
  const visibleBranches = isMaster ? branches : branches.filter(b => b.id === userBranch)

  return (
    <Modal open={open} onClose={onClose} title={form.id ? '예약 수정' : '새 예약'}>
      <div style={{ padding:'0 16px 24px', display:'flex', flexDirection:'column', gap:14 }}>
        {/* 날짜/시간 */}
        <div style={{ display:'flex', gap:8 }}>
          <Field label="날짜" style={{ flex:1 }}>
            <Input type="date" value={form.date||''} onChange={e=>set('date',e.target.value)}/>
          </Field>
          <Field label="시간" style={{ flex:1 }}>
            <Input type="time" value={form.time||''} onChange={e=>set('time',e.target.value)}/>
          </Field>
          <Field label="시간(분)" style={{ flex:1 }}>
            <Input type="number" value={form.dur||60} onChange={e=>set('dur',+e.target.value)} min={10} step={10}/>
          </Field>
        </div>

        {/* 지점 */}
        <Field label="지점">
          <select value={form.bid||''} onChange={e=>set('bid',e.target.value)} style={selectStyle}>
            <option value="">선택</option>
            {visibleBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>

        {/* 고객 정보 */}
        <div style={{ display:'flex', gap:8 }}>
          <Field label="고객명*" style={{ flex:1 }}>
            <Input value={form.cust_name||''} onChange={e=>set('cust_name',e.target.value)} placeholder="고객명"/>
          </Field>
          <Field label="성별" style={{ flex:'0 0 70px' }}>
            <select value={form.cust_gender||''} onChange={e=>set('cust_gender',e.target.value)} style={selectStyle}>
              <option value="">-</option>
              <option value="F">여</option>
              <option value="M">남</option>
            </select>
          </Field>
        </div>
        <Field label="연락처">
          <Input value={form.cust_phone||''} onChange={e=>set('cust_phone',e.target.value)} placeholder="010-0000-0000" type="tel"/>
        </Field>

        {/* 태그 */}
        {tags.length > 0 && (
          <Field label="예약태그">
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {tags.map(tag => {
                const on = (form.selected_tags||[]).includes(tag.id)
                return (
                  <button key={tag.id} onClick={()=>toggleTag(tag.id)} style={{
                    padding:'3px 10px', borderRadius:T.radius.full, border:`1px solid ${on?tag.color||T.primary:T.border}`,
                    background:on?(tag.color||T.primary)+'22':T.bgCard, color:on?(tag.color||T.primary):T.textSub,
                    fontSize:T.fs.xxs, fontWeight:T.fw.bold, cursor:'pointer',
                  }}>{tag.name}</button>
                )
              })}
            </div>
          </Field>
        )}

        {/* 서비스 */}
        {services.length > 0 && (
          <Field label="시술">
            <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:160, overflowY:'auto' }}>
              {services.map(svc => {
                const on = (form.selected_services||[]).includes(svc.id)
                return (
                  <label key={svc.id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'4px 0' }}>
                    <input type="checkbox" checked={on} onChange={()=>toggleSvc(svc.id)}/>
                    <span style={{ fontSize:T.fs.xs, color:T.text }}>{svc.name}</span>
                    {svc.dur && <span style={{ fontSize:T.fs.xxs, color:T.textMuted }}>{svc.dur}분</span>}
                    {svc.price && <span style={{ fontSize:T.fs.xxs, color:T.textMuted, marginLeft:'auto' }}>{svc.price?.toLocaleString()}원</span>}
                  </label>
                )
              })}
            </div>
          </Field>
        )}

        {/* 메모 */}
        <Field label="메모">
          <textarea value={form.memo||''} onChange={e=>set('memo',e.target.value)}
            rows={2} placeholder="직원 메모"
            style={{ ...inputStyle, resize:'vertical', height:'auto', padding:'8px 12px' }}/>
        </Field>

        {/* 상태 */}
        <Field label="상태">
          <select value={form.status||'confirmed'} onChange={e=>set('status',e.target.value)} style={selectStyle}>
            <option value="pending">확정대기</option>
            <option value="confirmed">진행</option>
            <option value="completed">완료</option>
            <option value="cancelled">취소</option>
            <option value="no_show">노쇼</option>
          </select>
        </Field>

        {/* 버튼 */}
        <div style={{ display:'flex', gap:8, marginTop:4 }}>
          <button onClick={onClose} style={{ flex:1, height:44, borderRadius:T.radius.md, border:`1px solid ${T.border}`, background:'none', cursor:'pointer', fontSize:T.fs.sm, color:T.textSub }}>
            취소
          </button>
          <button onClick={handleSave} disabled={saving} style={{ flex:2, height:44, borderRadius:T.radius.md, border:'none', background:T.primary, color:'#fff', cursor:'pointer', fontSize:T.fs.sm, fontWeight:T.fw.bold, opacity:saving?0.7:1 }}>
            {saving ? '저장중...' : '저장'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const inputStyle = {
  width:'100%', height:40, border:`1px solid ${T.border}`,
  borderRadius:T.radius.md, padding:'0 10px',
  fontSize:T.fs.sm, outline:'none', background:T.bgCard,
}
const selectStyle = { ...inputStyle, cursor:'pointer' }

function Field({ label, children, style={} }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, ...style }}>
      <label style={{ fontSize:T.fs.xxs, fontWeight:T.fw.bold, color:T.textSub }}>{label}</label>
      {children}
    </div>
  )
}
function Input(props) {
  return <input {...props} style={{ ...inputStyle, ...props.style }}/>
}
