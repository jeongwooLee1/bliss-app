import { useState } from 'react'
import { T, BUSINESS_ID } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import Icon from '../common/Icon'

export default function BranchSettings({ data, setData, onBack }) {
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const branches = data?.branches || []

  const openEdit = (br=null) => {
    setEditing(br?.id || 'new')
    setForm(br ? { ...br } : { name:'', short:'', phone:'', address:'', color:'#7c7cc8', use_yn:true, naver_col_count:1, staff_col_count:0 })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const isNew = editing === 'new'
      const payload = { ...form, business_id: BUSINESS_ID }
      if (isNew) {
        const { data: saved } = await supabase.from('branches').insert(payload).select().single()
        if (saved) setData(p=>({...p, branches:[...p.branches, saved]}))
      } else {
        const { data: saved } = await supabase.from('branches').update(payload).eq('id',editing).select().single()
        if (saved) setData(p=>({...p, branches:p.branches.map(b=>b.id===editing?saved:b)}))
      }
      setEditing(null)
    } finally { setSaving(false) }
  }

  if (editing) return (
    <div style={{ padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
        <button onClick={()=>setEditing(null)} style={{ background:'none', border:'none', cursor:'pointer' }}>
          <Icon name="chevLeft" size={20}/>
        </button>
        <h3 style={{ margin:0, fontSize:T.fs.lg, fontWeight:T.fw.bolder }}>{editing==='new'?'지점 추가':'지점 수정'}</h3>
      </div>
      {[
        {key:'name', label:'지점명*', placeholder:'강남점'},
        {key:'short', label:'약칭', placeholder:'강남'},
        {key:'phone', label:'전화번호', placeholder:'02-0000-0000'},
        {key:'address', label:'주소', placeholder:'서울시...'},
      ].map(f=>(
        <div key={f.key} style={{ marginBottom:14 }}>
          <label style={{ fontSize:T.fs.xxs, fontWeight:T.fw.bold, color:T.textSub, display:'block', marginBottom:4 }}>{f.label}</label>
          <input value={form[f.key]||''} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
            style={{ width:'100%', height:40, border:`1px solid ${T.border}`, borderRadius:T.radius.md, padding:'0 10px', fontSize:T.fs.sm, outline:'none' }}/>
        </div>
      ))}
      <div style={{ marginBottom:14 }}>
        <label style={{ fontSize:T.fs.xxs, fontWeight:T.fw.bold, color:T.textSub, display:'block', marginBottom:4 }}>색상</label>
        <input type="color" value={form.color||'#7c7cc8'} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
          style={{ height:40, width:80, border:`1px solid ${T.border}`, borderRadius:T.radius.md, cursor:'pointer' }}/>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:20 }}>
        <button onClick={()=>setEditing(null)} style={{ flex:1, height:44, borderRadius:T.radius.md, border:`1px solid ${T.border}`, background:'none', cursor:'pointer' }}>취소</button>
        <button onClick={handleSave} disabled={saving} style={{ flex:2, height:44, borderRadius:T.radius.md, background:T.primary, color:'#fff', border:'none', cursor:'pointer', fontWeight:T.fw.bold }}>
          {saving?'저장중...':'저장'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
        <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer' }}><Icon name="chevLeft" size={20}/></button>
        <h3 style={{ margin:0, fontSize:T.fs.lg, fontWeight:T.fw.bolder }}>예약장소 관리</h3>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {branches.map(br=>(
          <div key={br.id} onClick={()=>openEdit(br)} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:T.radius.lg, cursor:'pointer' }}>
            <div style={{ width:12, height:12, borderRadius:'50%', background:br.color, flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:T.fs.sm, fontWeight:T.fw.bold }}>{br.name}</div>
              {br.address && <div style={{ fontSize:T.fs.xxs, color:T.textMuted }}>{br.address}</div>}
            </div>
            <Icon name="chevRight" size={16} color={T.textMuted}/>
          </div>
        ))}
        <button onClick={()=>openEdit()} style={{ height:48, borderRadius:T.radius.lg, border:`2px dashed ${T.border}`, background:'none', cursor:'pointer', fontSize:T.fs.sm, color:T.textMuted }}>
          + 지점 추가
        </button>
      </div>
    </div>
  )
}
