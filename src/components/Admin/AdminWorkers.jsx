import React, { useState } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AListItem, AColorDot, APalette } from './AdminUI'

const uid = genId;

function AdminWorkers({ data, setData }) {
  const rooms=data.rooms||[];
  const regBranches=[...(data.branchSettings||data.branches||[])].filter(b=>b.useYn!==false).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",branchId:"",color:""});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",branchId:regBranches[0]?.id||"",color:""});setSheet(true);};
  const openEdit=r=>{setEdit(r);setForm({name:r.name||"",branchId:r.branch_id||"",color:r.color||""});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim()||!form.branchId)return;
    setSaving(true);
    try{
      if(edit){
        await sb.update("rooms",edit.id,{name:form.name,branch_id:form.branchId,color:form.color});
        setData(p=>({...p,rooms:p.rooms.map(r=>r.id===edit.id?{...r,name:form.name,branch_id:form.branchId,color:form.color}:r)}));
      }else{
        const id="rm_"+uid();
        await sb.insert("rooms",{id,business_id:_activeBizId,branch_id:form.branchId,name:form.name,color:form.color,sort_order:rooms.length});
        setData(p=>({...p,rooms:[...(p.rooms||[]),{id,branch_id:form.branchId,name:form.name,color:form.color}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("rooms",id).catch(console.error);
    setData(p=>({...p,rooms:(p.rooms||[]).filter(r=>r.id!==id)}));
    setDel(null);
  };

  const branchName=id=>regBranches.find(b=>b.id===id)?.short||regBranches.find(b=>b.id===id)?.name||id;

  return <div>
    <APageHeader title="담당자 관리" count={rooms.length} onAdd={openNew}/>
    {rooms.length===0?<AEmpty icon="users" message="등록된 담당자가 없어요" onAdd={openNew} addLabel="담당자 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {[...(rooms)].sort((a,b)=>{
        const ai=regBranches.findIndex(b=>b.id===a.branch_id);
        const bi=regBranches.findIndex(b=>b.id===b.branch_id);
        return ai-bi;
      }).map((r,i)=><AListItem key={r.id}
        left={<AColorDot color={r.color} size={22}/>} title={r.name} sub={branchName(r.branch_id)}
        borderBottom={i<rooms.length-1}
        right={<div style={{display:"flex",gap:8}}>
          <button onClick={e=>{e.stopPropagation();openEdit(r);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(r.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"담당자 수정":"담당자 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()||!form.branchId} saveLabel={edit?"저장":"담당자 추가"}>
      <AField label="이름" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 김민지" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="소속 지점" required>
        <select style={{...AInp}} value={form.branchId} onChange={e=>set("branchId",e.target.value)}>
          <option value="">지점 선택</option>
          {regBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
    </ASheet>
    <AConfirm open={!!del} title="담당자 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminWorkers
