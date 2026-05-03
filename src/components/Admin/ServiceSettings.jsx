import { useState } from 'react'
import { T } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { _activeBizId } from '../../lib/db'
import Icon from '../common/Icon'

export default function ServiceSettings({ data, setData, onBack }) {
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const services = data?.services || []

  const openEdit = (svc=null) => {
    setEditing(svc?.id||'new')
    setForm(svc?{...svc}:{name:'',dur:60,price:0,use_yn:true})
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const isNew = editing==='new'
      const payload = {...form, business_id:_activeBizId}
      if (isNew) {
        const {data:saved} = await supabase.from('services').insert(payload).select().single()
        if (saved) setData(p=>({...p,services:[...p.services,saved]}))
      } else {
        const {data:saved} = await supabase.from('services').update(payload).eq('id',editing).select().single()
        if (saved) setData(p=>({...p,services:p.services.map(s=>s.id===editing?saved:s)}))
      }
      setEditing(null)
    } finally { setSaving(false) }
  }

  if (editing) return (
    <div style={{padding:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20}}>
        <button onClick={()=>setEditing(null)} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="chevLeft" size={20}/></button>
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{editing==='new'?'시술 추가':'시술 수정'}</h3>
      </div>
      {[{key:'name',label:'시술명*'},{key:'dur',label:'소요시간(분)',type:'number'},{key:'price',label:'가격(원)',type:'number'}].map(f=>(
        <div key={f.key} style={{marginBottom:14}}>
          <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>{f.label}</label>
          <input type={f.type||'text'} value={form[f.key]||''} onChange={e=>setForm(p=>({...p,[f.key]:f.type==='number'?+e.target.value:e.target.value}))}
            style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 10px',fontSize:T.fs.sm,outline:'none'}}/>
        </div>
      ))}
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
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>시술 상품 관리</h3>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {services.map(svc=>(
          <div key={svc.id} onClick={()=>openEdit(svc)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius.lg,cursor:'pointer'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{svc.name}</div>
              <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{svc.dur}분 {svc.price?.toLocaleString()}원</div>
            </div>
            <Icon name="chevRight" size={16} color={T.textMuted}/>
          </div>
        ))}
        <button onClick={()=>openEdit()} style={{height:48,borderRadius:T.radius.lg,border:`2px dashed ${T.border}`,background:'none',cursor:'pointer',fontSize:T.fs.sm,color:T.textMuted}}>+ 시술 추가</button>
      </div>
    </div>
  )
}
