import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import I from '../common/I'
import { APageHeader } from './AdminUI'

export default function AdminExtPlatforms({ data, setData, bizId }) {
  const [platforms, setPlatforms] = useState([])
  const [newName, setNewName] = useState("")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    try {
      const biz = (data?.businesses||[]).find(b=>b.id===bizId) || (data?.businesses||[])[0]
      const s = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : biz?.settings || {}
      const list = Array.isArray(s?.external_platforms) ? s.external_platforms : ["서울뷰티","크리에이트립"]
      setPlatforms(list)
    } catch { setPlatforms(["서울뷰티","크리에이트립"]) }
  }, [data, bizId])

  const persist = async (next) => {
    setSaving(true); setMsg("")
    try {
      const biz = (data?.businesses||[]).find(b=>b.id===bizId) || (data?.businesses||[])[0]
      const cur = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : biz?.settings || {}
      const newSettings = { ...cur, external_platforms: next }
      await sb.update("businesses", bizId, { settings: newSettings })
      setData(prev => ({...prev, businesses: (prev.businesses||[]).map(b=>b.id===bizId?{...b, settings:newSettings}:b)}))
      setPlatforms(next)
      setMsg("✓ 저장됨")
      setTimeout(()=>setMsg(""), 2000)
    } catch (e) {
      setMsg("저장 실패: "+e.message)
    } finally { setSaving(false) }
  }

  const add = () => {
    const name = newName.trim()
    if (!name) return
    if (platforms.includes(name)) { setMsg("이미 있는 플랫폼"); return }
    persist([...platforms, name]); setNewName("")
  }
  const remove = (name) => {
    if (name === "네이버") { alert("네이버는 시스템 기본 플랫폼이라 삭제할 수 없습니다"); return }
    if (!confirm(`"${name}" 삭제?`)) return
    persist(platforms.filter(p=>p!==name))
  }
  const rename = (oldName, newN) => {
    const n = newN.trim()
    if (!n || n === oldName) return
    persist(platforms.map(p => p===oldName ? n : p))
  }

  return <div>
    <APageHeader title="외부 플랫폼 관리" desc="서울뷰티·크리에이트립 등 외부 선결제 플랫폼 목록. 매출 등록 시 드롭다운에 노출됩니다."/>
    <div className="card" style={{padding:16,marginBottom:12}}>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <input value={newName} onChange={e=>setNewName(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")add()}}
          placeholder="플랫폼 이름 (예: 오늘의집)"
          style={{flex:1,padding:"9px 12px",fontSize:T.fs.sm,borderRadius:8,border:"1px solid "+T.border,fontFamily:"inherit",outline:"none"}}/>
        <button onClick={add} disabled={saving||!newName.trim()}
          style={{padding:"9px 18px",fontSize:T.fs.sm,fontWeight:700,borderRadius:8,border:"none",background:T.primary,color:"#fff",cursor:"pointer",fontFamily:"inherit",opacity:saving||!newName.trim()?0.5:1}}>추가</button>
      </div>
      {msg && <div style={{marginTop:10,fontSize:T.fs.xs,color:msg.startsWith("✓")?T.success:T.danger}}>{msg}</div>}
    </div>
    <div className="card" style={{padding:0,overflow:"hidden"}}>
      {(()=>{
        const list = ["네이버", ...platforms.filter(p=>p!=="네이버")]
        return list.map((p,i) => <PlatformRow key={p} name={p} isSystem={p==="네이버"} isLast={i===list.length-1} onRemove={()=>remove(p)} onRename={(n)=>rename(p,n)}/>)
      })()}
    </div>
  </div>
}

function PlatformRow({ name, isSystem, isLast, onRemove, onRename }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  useEffect(()=>setV(name), [name])
  return <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderBottom:isLast?"none":"1px solid "+T.border,background:isSystem?"#F0F9F1":"transparent"}}>
    <I name="tag" size={14} style={{color:isSystem?"#03C75A":"#8E24AA"}}/>
    {editing && !isSystem
      ? <input value={v} autoFocus onChange={e=>setV(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"){onRename(v);setEditing(false)} else if(e.key==="Escape"){setV(name);setEditing(false)}}}
          onBlur={()=>{onRename(v);setEditing(false)}}
          style={{flex:1,padding:"4px 8px",fontSize:T.fs.sm,borderRadius:6,border:"1px solid "+T.primary,fontFamily:"inherit",outline:"none"}}/>
      : <span onClick={()=>!isSystem&&setEditing(true)} style={{flex:1,fontSize:T.fs.sm,fontWeight:600,color:T.text,cursor:isSystem?"default":"pointer"}}>{name}{isSystem && <span style={{marginLeft:8,fontSize:10,color:"#03C75A",fontWeight:700,padding:"1px 6px",background:"#fff",border:"1px solid #03C75A",borderRadius:4}}>시스템</span>}</span>
    }
    {!isSystem && <button onClick={onRemove} title="삭제" style={{padding:"4px 8px",borderRadius:6,border:"none",background:"transparent",color:T.danger,cursor:"pointer"}}>
      <I name="trash" size={14}/>
    </button>}
  </div>
}
