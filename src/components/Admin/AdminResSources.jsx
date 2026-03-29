import React, { useState } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AListItem, AToggle, AColorDot, ABadge, APalette } from './AdminUI'

const uid = genId;

function AdminResSources({ data, setData }) {
  const srcs=data.resSources||[];
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",color:"",useYn:true});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const BRAND=[{n:"네이버",c:"#03C75A"},{n:"카카오",c:"#FEE500"},{n:"인스타",c:"#E4405F"},{n:"직접",c:"#7c7cc8"},{n:"기타",c:"#636e72"}];

  const openNew=()=>{setEdit(null);setForm({name:"",color:"",useYn:true});setSheet(true);};
  const openEdit=s=>{setEdit(s);setForm({name:s.name||"",color:s.color||"",useYn:s.useYn!==false});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={name:form.name,color:form.color,use_yn:form.useYn};
      if(edit){
        await sb.update("reservation_sources",edit.id,pl);
        setData(p=>({...p,resSources:(p.resSources||[]).map(s=>s.id===edit.id?{...s,...form}:s)}));
      }else{
        const id="rs_"+uid();
        await sb.insert("reservation_sources",{id,business_id:_activeBizId,...pl});
        setData(p=>({...p,resSources:[...(p.resSources||[]),{id,...form}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("reservation_sources",id).catch(console.error);
    setData(p=>({...p,resSources:(p.resSources||[]).filter(s=>s.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="예약경로 관리" count={srcs.length} onAdd={openNew}/>
    {srcs.length===0?<AEmpty icon="zap" message="등록된 예약경로가 없어요" onAdd={openNew} addLabel="경로 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {srcs.map((s,i)=><AListItem key={s.id}
        left={<AColorDot color={s.color} size={22}/>} title={s.name}
        borderBottom={i<srcs.length-1}
        right={<div style={{display:"flex",alignItems:"center",gap:8}}>
          <ABadge color={s.useYn!==false?T.success:T.gray400}>{s.useYn!==false?"사용":"중지"}</ABadge>
          <button onClick={e=>{e.stopPropagation();openEdit(s);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(s.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"경로 수정":"경로 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"경로 추가"}>
      <AField label="경로명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 네이버, 인스타그램" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="색상">
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {BRAND.map(({n,c})=><button key={c} onClick={()=>set("color",c)}
            style={{padding:"5px 12px",borderRadius:20,border:form.color===c?"2px solid "+T.text:"2px solid transparent",background:c,color:c==="#FEE500"?"#333":"#fff",fontSize:T.fs.xs,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>)}
        </div>
        <APalette value={form.color} onChange={v=>set("color",v)}/>
      </AField>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16}}>
        <span style={{fontSize:T.fs.sm,fontWeight:500}}>사용 중</span>
        <AToggle on={form.useYn} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="경로 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminResSources
