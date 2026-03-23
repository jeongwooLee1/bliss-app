import { useState, useEffect } from 'react'
import { T, STATUS_LABEL } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { BUSINESS_ID } from '../../lib/constants'

function genId() { return Math.random().toString(36).slice(2,12) }
function pad(n) { return String(n).padStart(2,'0') }

export default function ReservationModal({ data, allData, employees, onSave, onDelete, onClose }) {
  const { res, branch, staffId, date, time } = data
  const isNew = !res

  const [form, setForm] = useState({
    cust_name: res?.cust_name || '',
    cust_phone: res?.cust_phone || '',
    cust_gender: res?.cust_gender || '',
    date: res?.date || date || '',
    time: res?.time || time || '',
    dur: res?.dur || 60,
    status: res?.status || 'confirmed',
    staff_id: res?.staff_id || staffId || '',
    service_id: res?.service_id || '',
    memo: res?.memo || '',
    bid: res?.bid || branch?.id || '',
    selected_tags: res?.selected_tags || [],
    selected_services: res?.selected_services || [],
    source: res?.source || '',
  })
  const [saving, setSaving] = useState(false)

  const services = allData?.services || []
  const branches = allData?.branches || []
  const serviceTags = allData?.serviceTags || []
  const branchEmps = employees.filter(e => e.branch === Object.entries({
    'br_4bcauqvrb':'gangnam','br_wkqsxj6k1':'wangsimni','br_l6yzs2pkq':'hongdae',
    'br_k57zpkbx1':'magok','br_ybo3rmulv':'yongsan','br_lfv2wgdf1':'jamsil',
    'br_g768xdu4w':'wirye','br_xu60omgdf':'cheonho'
  }).find(([id])=>id===form.bid)?.[1])

  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const handleSave = async () => {
    if (!form.cust_name || !form.date || !form.time) return
    setSaving(true)
    try {
      if (isNew) {
        const newRes = {
          id: genId(),
          business_id: BUSINESS_ID,
          type: 'reservation',
          is_schedule: false,
          is_new_cust: true,
          repeat: 'none',
          ...form,
        }
        const { data: saved, error } = await supabase.from('reservations').insert(newRes).select().single()
        if (error) throw error
        onSave(saved || newRes)
      } else {
        const { data: saved, error } = await supabase.from('reservations').update(form).eq('id', res.id).select().single()
        if (error) throw error
        onSave(saved || {...res, ...form})
      }
    } catch(e) {
      alert('저장 실패: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('예약을 삭제하시겠어요?')) return
    await supabase.from('reservations').delete().eq('id', res.id)
    onDelete(res.id)
  }

  const handleStatusChange = async (newStatus) => {
    set('status', newStatus)
    if (!isNew) {
      await supabase.from('reservations').update({status: newStatus}).eq('id', res.id)
    }
  }

  const statusColors = {
    confirmed: T.success, completed: T.textMuted,
    cancelled: T.danger, no_show: T.danger, pending: T.orange
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:T.bgCard,borderRadius:`${T.radius.xl}px ${T.radius.xl}px 0 0`,maxHeight:'90dvh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 -4px 24px rgba(0,0,0,.15)'}}>

        {/* 드래그 핸들 */}
        <div style={{padding:'12px 0 0',display:'flex',justifyContent:'center'}}>
          <div style={{width:36,height:4,borderRadius:2,background:T.gray300}}/>
        </div>

        {/* 헤더 */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px 8px'}}>
          <div style={{fontSize:T.fs.md,fontWeight:T.fw.bolder}}>{isNew ? '새 예약' : '예약 상세'}</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {!isNew && (
              <button onClick={handleDelete} style={{padding:'4px 10px',borderRadius:T.radius.md,border:`1px solid ${T.danger}`,background:'none',color:T.danger,fontSize:T.fs.xs,cursor:'pointer'}}>삭제</button>
            )}
            <button onClick={onClose} style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${T.border}`,background:'none',cursor:'pointer',fontSize:16}}>×</button>
          </div>
        </div>

        {/* 상태 버튼 */}
        {!isNew && (
          <div style={{display:'flex',gap:6,padding:'0 16px 8px',overflowX:'auto'}}>
            {['confirmed','completed','cancelled','no_show','pending'].map(s=>(
              <button key={s} onClick={()=>handleStatusChange(s)}
                style={{flexShrink:0,padding:'4px 10px',borderRadius:T.radius.full,border:`1px solid ${form.status===s?statusColors[s]:T.border}`,background:form.status===s?statusColors[s]+'22':'none',color:form.status===s?statusColors[s]:T.textSub,fontSize:T.fs.xs,fontWeight:form.status===s?T.fw.bold:T.fw.normal,cursor:'pointer'}}>
                {STATUS_LABEL[s]||s}
              </button>
            ))}
          </div>
        )}

        {/* 폼 */}
        <div style={{flex:1,overflowY:'auto',padding:'0 16px 16px'}}>
          {/* 지점 */}
          <Row label="지점">
            <select value={form.bid} onChange={e=>set('bid',e.target.value)} style={inputStyle}>
              {branches.map(b=><option key={b.id} value={b.id}>{b.short||b.name}</option>)}
            </select>
          </Row>

          {/* 날짜/시간 */}
          <Row label="일시">
            <div style={{display:'flex',gap:8}}>
              <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} style={{...inputStyle,flex:1}}/>
              <input type="time" value={form.time} onChange={e=>set('time',e.target.value)} style={{...inputStyle,width:90}}/>
            </div>
          </Row>

          {/* 시술 시간 */}
          <Row label="시술시간">
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {[30,45,60,90,120].map(d=>(
                <button key={d} onClick={()=>set('dur',d)}
                  style={{padding:'4px 8px',borderRadius:T.radius.md,border:`1px solid ${form.dur===d?T.primary:T.border}`,background:form.dur===d?T.primaryLt:'none',color:form.dur===d?T.primary:T.textSub,fontSize:T.fs.xs,cursor:'pointer'}}>
                  {d}분
                </button>
              ))}
            </div>
          </Row>

          {/* 담당자 */}
          <Row label="담당자">
            <select value={form.staff_id} onChange={e=>set('staff_id',e.target.value)} style={inputStyle}>
              <option value="">미배정</option>
              {employees.filter(e=>!e.isMale).map(e=><option key={e.id} value={e.id}>{e.name||e.id}</option>)}
            </select>
          </Row>

          {/* 고객 이름 */}
          <Row label="고객명">
            <input value={form.cust_name} onChange={e=>set('cust_name',e.target.value)} placeholder="고객 이름" style={inputStyle}/>
          </Row>

          {/* 전화번호 */}
          <Row label="전화번호">
            <input value={form.cust_phone} onChange={e=>set('cust_phone',e.target.value)} placeholder="010-0000-0000" style={inputStyle}/>
          </Row>

          {/* 성별 */}
          <Row label="성별">
            <div style={{display:'flex',gap:8}}>
              {[['F','여'], ['M','남'], ['','미정']].map(([v,l])=>(
                <button key={v} onClick={()=>set('cust_gender',v)}
                  style={{padding:'4px 12px',borderRadius:T.radius.md,border:`1px solid ${form.cust_gender===v?T.primary:T.border}`,background:form.cust_gender===v?T.primaryLt:'none',color:form.cust_gender===v?T.primary:T.textSub,fontSize:T.fs.xs,cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
          </Row>

          {/* 메모 */}
          <Row label="메모">
            <textarea value={form.memo} onChange={e=>set('memo',e.target.value)} placeholder="직원 메모"
              style={{...inputStyle,height:64,resize:'none',paddingTop:8}}/>
          </Row>

          {/* 네이버 예약 정보 */}
          {res?.reservation_id && (
            <div style={{background:T.gray100,borderRadius:T.radius.md,padding:12,marginTop:8,fontSize:T.fs.xs,color:T.textSub}}>
              <div style={{fontWeight:T.fw.bold,color:T.text,marginBottom:6}}>네이버 예약 #{res.reservation_id}</div>
              {res.naver_reg_dt && <div>신청: {res.naver_reg_dt.slice(0,16).replace('T',' ')}</div>}
              {res.naver_confirmed_dt && <div>확정: {res.naver_confirmed_dt.slice(0,16).replace('T',' ')}</div>}
              {res.is_prepaid && <div style={{color:T.success}}>✓ 예약금 완료</div>}
            </div>
          )}
        </div>

        {/* 저장 버튼 */}
        <div style={{padding:'12px 16px',borderTop:`1px solid ${T.border}`}}>
          <button onClick={handleSave} disabled={saving}
            style={{width:'100%',height:48,background:T.primary,color:'#fff',border:'none',borderRadius:T.radius.md,fontSize:T.fs.md,fontWeight:T.fw.bold,cursor:'pointer',opacity:saving?0.7:1}}>
            {saving ? '저장 중...' : isNew ? '예약 등록' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{marginBottom:12}}>
      <label style={{fontSize:T.fs.xs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  width:'100%', height:40, border:`1px solid ${T.border}`,
  borderRadius:T.radius.md, padding:'0 10px',
  fontSize:T.fs.sm, outline:'none', background:T.bgCard,
  boxSizing:'border-box'
}
