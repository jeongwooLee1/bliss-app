import { useState } from 'react'
import { T, BUSINESS_ID } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import Icon from '../common/Icon'

export default function TagSettings({ data, setData, onBack }) {
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const tags = data?.serviceTags || []

  const openEdit = (tag=null) => {
    setEditing(tag?.id||'new')
    setForm(tag?{...tag}:{name:'',color:T.primary})
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const isNew = editing==='new'
      const payload = {...form, business_id:BUSINESS_ID}
      if (isNew) {
        const {data:saved} = await supabase.from('service_tags').insert(payload).select().single()
        if (saved) setData(p=>({...p,serviceTags:[...p.serviceTags,saved]}))
      } else {
        const {data:saved} = await supabase.from('service_tags').update(payload).eq('id',editing).select().single()
        if (saved) setData(p=>({...p,serviceTags:p.serviceTags.map(t=>t.id===editing?saved:t)}))
      }
      setEditing(null)
    } finally { setSaving(false) }
  }

  if (editing) return (
    <div style={{padding:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20}}>
        <button onClick={()=>setEditing(null)} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="chevLeft" size={20}/></button>
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{editing==='new'?'태그 추가':'태그 수정'}</h3>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>태그명*</label>
        <input value={form.name||''} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
          style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 10px',fontSize:T.fs.sm,outline:'none'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>색상</label>
        <input type="color" value={form.color||T.primary} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
          style={{height:40,width:80,border:`1px solid ${T.border}`,borderRadius:T.radius.md,cursor:'pointer'}}/>
      </div>
      <div style={{display:'flex',gap:8,marginTop:20}}>
        <button onClick={()=>setEditing(null)} style={{flex:1,height:44,borderRadius:T.radius.md,border:`1px solid ${T.border}`,background:'none',cursor:'pointer'}}>취소</button>
        <button onClick={handleSave} disabled={saving} style={{flex:2,height:44,borderRadius:T.radius.md,background:T.primary,color:'#fff',border:'none',cursor:'pointer',fontWeight:T.fw.bold}}>
          {saving?'저장중...':'저장'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{padding:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20}}>
        <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="chevLeft" size={20}/></button>
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>태그 관리</h3>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
        {tags.map(tag=>(
          <div key={tag.id} onClick={()=>openEdit(tag)} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:T.radius.full,border:`1px solid ${tag.color||T.primary}`,background:(tag.color||T.primary)+'22',cursor:'pointer'}}>
            <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bold,color:tag.color||T.primary}}>{tag.name}</span>
          </div>
        ))}
      </div>
      <button onClick={()=>openEdit()} style={{height:44,width:'100%',borderRadius:T.radius.lg,border:`2px dashed ${T.border}`,background:'none',cursor:'pointer',fontSize:T.fs.sm,color:T.textMuted}}>+ 태그 추가</button>
    </div>
  )
}
