import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId, SYSTEM_TAG_IDS } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AToggle, ABadge, APalette, useTouchDragSort } from './AdminUI'

const uid = genId;

function AdminServiceTags({ data, setData }) {
  const [tags,setTags]=useState(()=>[...(data?.serviceTags||[])].sort((a,b)=>a.sort-b.sort));
  useEffect(()=>{setData(p=>p?{...p,serviceTags:tags}:p);},[tags]);

  const [activeTab,setActiveTab]=useState("reservation");
  const [sheet,setSheet]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState({name:"",dur:0,color:"",useYn:true});
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const isSchedule=activeTab==="schedule";
  const tabTags=(tags||[]).filter(t=>isSchedule?t.scheduleYn==="Y":t.scheduleYn!=="Y");

  const getContrast=hex=>{
    if(!hex||hex.length<4)return T.text;
    const h=hex.replace("#","");
    const r=parseInt(h.length===3?h[0]+h[0]:h.slice(0,2),16);
    const g=parseInt(h.length===3?h[1]+h[1]:h.slice(2,4),16);
    const b=parseInt(h.length===3?h[2]+h[2]:h.slice(4,6),16);
    return(0.299*r+0.587*g+0.114*b)/255>0.55?T.text:"#fff";
  };

  const syncTags=updated=>{setTags(updated);if(setData)setData(p=>p?{...p,serviceTags:updated}:p);};
  const tagToDb=t=>({id:t.id,business_id:_activeBizId,name:t.name,dur:t.dur||0,schedule_yn:t.scheduleYn==="Y"?"Y":"N",color:t.color||"",use_yn:t.useYn!==false,sort:t.sort||0});

  const openNew=()=>{setEditItem(null);setForm({name:"",dur:0,color:"",useYn:true});setSheet(true);};
  const openEdit=t=>{setEditItem(t);setForm({name:t.name||"",dur:t.dur||0,color:t.color||"",useYn:t.useYn!==false});setSheet(true);};

  const save=()=>{
    if(!form.name.trim())return;
    if(editItem){
      syncTags(tags.map(t=>t.id===editItem.id?{...t,...form}:t));
      sb.update("service_tags",editItem.id,{name:form.name,dur:form.dur||0,color:form.color,use_yn:form.useYn!==false,sort:editItem.sort||0}).catch(console.error);
    }else{
      const t={id:uid(),name:form.name.trim(),dur:Number(form.dur)||0,scheduleYn:isSchedule?"Y":"N",color:form.color,useYn:true,sort:tags.length};
      syncTags([...tags,t]);
      sb.upsert("service_tags",[tagToDb(t)]);
    }
    setSheet(false);
  };

  const doDelete=id=>{
    if(SYSTEM_TAG_IDS.includes(id)){alert("시스템 태그는 삭제할 수 없습니다.");setDel(null);return;}
    syncTags((tags||[]).filter(t=>t.id!==id).map((t,i)=>({...t,sort:i})));
    sb.del("service_tags",id).catch(console.error);
    setDel(null);
  };

  const toggleUse=id=>{
    const tag=tags.find(t=>t.id===id);
    const newUse=tag?.useYn===false;
    syncTags(tags.map(t=>t.id===id?{...t,useYn:newUse}:t));
    sb.update("service_tags",id,{use_yn:newUse}).catch(console.error);
  };

  const {mouseHandlers:tagMH, touchHandlers:tagTH, overIdx:tagOver} = useTouchDragSort(tabTags, (reordered) => {
    const other=(tags||[]).filter(t=>isSchedule?t.scheduleYn!=="Y":t.scheduleYn==="Y");
    const all=[...reordered,...other].map((t,j)=>({...t,sort:j}));
    syncTags(all);
    reordered.forEach((t,j)=>sb.update("service_tags",t.id,{sort:j}).catch(console.error));
  });

  return <div>
    <APageHeader title="태그 관리" count={tabTags.length} onAdd={openNew}/>
    <div style={{display:"flex",gap:6,marginBottom:16}}>
      {[["reservation","예약"],["schedule","내부일정"]].map(([k,lv])=>
        <button key={k} onClick={()=>setActiveTab(k)}
          style={{padding:"7px 18px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:activeTab===k?700:500,
            background:activeTab===k?T.primary:T.gray100,color:activeTab===k?"#fff":T.gray600}}>{lv}</button>)}
    </div>
    {tabTags.filter(t=>t.useYn!==false).length>0&&<div style={{marginBottom:16,padding:"12px 14px",background:T.gray100,borderRadius:12}}>
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:8,fontWeight:T.fw.bold}}>미리보기 (드래그로 순서 변경)</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {tabTags.filter(t=>t.useYn!==false).map((t,i)=><div key={t.id}
          data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
          style={{padding:"4px 12px",borderRadius:20,background:tagOver===i?(t.color||T.primary)+"cc":(t.color||T.primary),color:getContrast(t.color||T.primary),fontSize:T.fs.xs,fontWeight:700,cursor:"grab",opacity:tagOver===i?0.5:1}}>{t.name}</div>)}
      </div>
    </div>}
    {tabTags.length===0?<AEmpty icon="tag" message="등록된 태그가 없어요" onAdd={openNew} addLabel="태그 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {tabTags.map((t,i)=><div key={t.id} draggable
  data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
  style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:i<tabTags.length-1?"1px solid "+T.gray100:"none",cursor:"grab",
  background:tagOver===i?T.primaryHover:"transparent",transition:"background .1s"}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:t.color||T.primary,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:t.useYn!==false?T.text:T.gray400}}>{t.name}</div>
          {t.dur>0&&<div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{t.dur}분</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
  <button onClick={e=>{e.stopPropagation();if(i===0)return;const r=[...tabTags];const [m]=r.splice(i,1);r.splice(i-1,0,m);const other=(tags||[]).filter(t2=>isSchedule?t2.scheduleYn!=="Y":t2.scheduleYn==="Y");const all=[...r,...other].map((t2,j)=>({...t2,sort:j}));syncTags(all);r.forEach((t2,j)=>sb.update("service_tags",t2.id,{sort:j}).catch(console.error));}} style={{width:22,height:22,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",borderRadius:4,cursor:i===0?"not-allowed":"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===0?.4:1}}>&#9650;</button>
  <button onClick={e=>{e.stopPropagation();if(i===tabTags.length-1)return;const r=[...tabTags];const [m]=r.splice(i,1);r.splice(i+1,0,m);const other=(tags||[]).filter(t2=>isSchedule?t2.scheduleYn!=="Y":t2.scheduleYn==="Y");const all=[...r,...other].map((t2,j)=>({...t2,sort:j}));syncTags(all);r.forEach((t2,j)=>sb.update("service_tags",t2.id,{sort:j}).catch(console.error));}} style={{width:22,height:22,border:"1px solid "+T.border,background:i===tabTags.length-1?T.gray100:"#fff",borderRadius:4,cursor:i===tabTags.length-1?"not-allowed":"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===tabTags.length-1?.4:1}}>&#9660;</button>
</div>
{SYSTEM_TAG_IDS.includes(t.id)&&<ABadge color="#f39c12" bg="#fff3e0">시스템</ABadge>}
        <AToggle size="sm" on={t.useYn!==false} onChange={()=>toggleUse(t.id)}/>
        <button onClick={()=>openEdit(t)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
        {!SYSTEM_TAG_IDS.includes(t.id)&&<button onClick={()=>setDel(t.id)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>}
      </div>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={editItem?"태그 수정":"태그 추가"} onSave={save} saveDisabled={!form.name.trim()} saveLabel={editItem?"저장":"태그 추가"}>
      <AField label="태그명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 신규, VIP" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="소요 시간(분)" hint="0이면 기본 시술 시간 사용"><input style={{...AInp,width:120}} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
      {form.color&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"10px 14px",borderRadius:10,background:form.color,marginBottom:14}}>
        <div style={{fontSize:T.fs.sm,fontWeight:700,color:getContrast(form.color)}}>{form.name||"미리보기"}</div>
      </div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16}}>
        <span style={{fontSize:T.fs.sm,fontWeight:500}}>사용 중</span>
        <AToggle on={form.useYn!==false} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="태그 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminServiceTags
