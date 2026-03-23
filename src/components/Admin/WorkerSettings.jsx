import { useState } from 'react'
import { T } from '../../lib/constants'
import { useEmployees } from '../../lib/useData'
import Icon from '../common/Icon'

const BRANCHES_LIST = [
  {id:'gangnam',name:'강남'},{id:'wangsimni',name:'왕십리'},
  {id:'hongdae',name:'홍대'},{id:'magok',name:'마곡'},
  {id:'yongsan',name:'용산'},{id:'jamsil',name:'잠실'},
  {id:'wirye',name:'위례'},{id:'cheonho',name:'천호'},
]

export default function WorkerSettings({ onBack }) {
  const { employees, save, loading } = useEmployees()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const nonMale = employees.filter(e=>!e.isMale)

  const openEdit = (emp=null) => {
    setEditing(emp?.id||'new')
    setForm(emp?{...emp}:{id:'',name:'',branch:'gangnam',branches:['gangnam'],isOwner:false,weeklyOff:2,altPattern:false,mustStay:false})
  }

  const handleSave = async () => {
    if (!form.name.trim()) return alert('이름을 입력해주세요')
    setSaving(true)
    try {
      const isNew = editing==='new'
      let next
      if (isNew) {
        next = [...nonMale, {...form, id:form.name}]
      } else {
        next = nonMale.map(e=>e.id===editing?{...e,...form}:e)
      }
      await save(next)
      setEditing(null)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('삭제하시겠습니까?')) return
    const next = nonMale.filter(e=>e.id!==id)
    await save(next)
  }

  if (editing) return (
    <div style={{padding:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20}}>
        <button onClick={()=>setEditing(null)} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="chevLeft" size={20}/></button>
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{editing==='new'?'직원 추가':'직원 수정'}</h3>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>이름*</label>
        <input value={form.name||''} onChange={e=>setForm(p=>({...p,name:e.target.value,id:e.target.value}))} disabled={editing!=='new'}
          style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 10px',fontSize:T.fs.sm,outline:'none'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>소속 지점 (대표)</label>
        <select value={form.branch||'gangnam'} onChange={e=>setForm(p=>({...p,branch:e.target.value,branches:[e.target.value]}))}
          style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 10px',fontSize:T.fs.sm,outline:'none'}}>
          {BRANCHES_LIST.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,display:'block',marginBottom:4}}>주간 휴무일</label>
        <select value={form.weeklyOff||2} onChange={e=>setForm(p=>({...p,weeklyOff:+e.target.value}))}
          style={{width:'100%',height:40,border:`1px solid ${T.border}`,borderRadius:T.radius.md,padding:'0 10px',fontSize:T.fs.sm,outline:'none'}}>
          <option value={1}>1일 (원장)</option>
          <option value={2}>2일 (일반)</option>
        </select>
      </div>
      <div style={{display:'flex',gap:12,marginBottom:14}}>
        {[{key:'isOwner',label:'원장'},{key:'mustStay',label:'고정근무'},{key:'altPattern',label:'격주패턴'}].map(f=>(
          <label key={f.key} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:T.fs.xs}}>
            <input type="checkbox" checked={!!form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.checked}))}/>
            {f.label}
          </label>
        ))}
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
        <h3 style={{margin:0,fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>직원 설정</h3>
      </div>
      {loading ? <div style={{textAlign:'center',color:T.textMuted}}>로딩중...</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {nonMale.map(emp=>(
            <div key={emp.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radius.lg}}>
              <div style={{flex:1,cursor:'pointer'}} onClick={()=>openEdit(emp)}>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>{emp.name} {emp.isOwner?'(원장)':''}</div>
                <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{BRANCHES_LIST.find(b=>b.id===emp.branch)?.name} · 주{7-emp.weeklyOff}일</div>
              </div>
              <button onClick={()=>handleDelete(emp.id)} style={{background:'none',border:'none',cursor:'pointer',color:T.danger,padding:4}}>
                <Icon name="trash" size={16} color={T.danger}/>
              </button>
            </div>
          ))}
          <button onClick={()=>openEdit()} style={{height:48,borderRadius:T.radius.lg,border:`2px dashed ${T.border}`,background:'none',cursor:'pointer',fontSize:T.fs.sm,color:T.textMuted}}>+ 직원 추가</button>
        </div>
      )}
    </div>
  )
}
