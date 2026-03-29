import React, { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AListItem, AIBtn } from './AdminUI'

const uid = genId;

function AdminProductItems({ data, setData }) {
const [items,setItems]=useState(()=>[...(data?.productItems||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));
useEffect(()=>{setItems([...(data?.productItems||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));},[data?.productItems?.length]);
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",price:0,stock:0,note:""});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
const dragIdx=useRef(null),dragOver=useRef(null);
const onDragStart_p=i=>{dragIdx.current=i;};
const onDragEnter_p=i=>{dragOver.current=i;};
const onDragEnd_p=()=>{
  const di=dragIdx.current,oi=dragOver.current;
  dragIdx.current=null;dragOver.current=null;
  if(di===null||oi===null||di===oi)return;
  const r=[...items];const [m]=r.splice(di,1);r.splice(oi,0,m);
  const updated=r.map((it,idx2)=>({...it,sort:idx2}));
  setItems(updated);setData(p=>({...p,productItems:updated}));
  updated.forEach((it,idx2)=>sb.update("product_items",it.id,{sort:idx2}).catch(console.error));
};
const moveItem_p=(i,dir)=>{
  const ni=i+dir;if(ni<0||ni>=items.length)return;
  const r=[...items];[r[i],r[ni]]=[r[ni],r[i]];
  const updated=r.map((it,idx2)=>({...it,sort:idx2}));
  setItems(updated);setData(p=>({...p,productItems:updated}));
  updated.forEach((it,idx2)=>sb.update("product_items",it.id,{sort:idx2}).catch(console.error));
};
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",price:0,stock:0,note:""});setSheet(true);};
  const openEdit=it=>{setEdit(it);setForm({name:it.name||"",price:it.price||0,stock:it.stock||0,note:it.note||""});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={name:form.name,price:+form.price,stock:+form.stock,note:form.note};
      if(edit){
        await sb.update("product_items",edit.id,pl);
        setData(p=>({...p,productItems:(p.productItems||[]).map(it=>it.id===edit.id?{...it,...pl}:it)}));
      }else{
        const id="pi_"+uid();
        await sb.insert("product_items",{id,business_id:_activeBizId,...pl});
        setData(p=>({...p,productItems:[...(p.productItems||[]),{id,...pl}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("product_items",id).catch(console.error);
    setData(p=>({...p,productItems:(p.productItems||[]).filter(it=>it.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="제품 관리" count={items.length} onAdd={openNew}/>
    {items.length===0?<AEmpty icon="clipboard" message="등록된 제품이 없어요" onAdd={openNew} addLabel="제품 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {items.map((it,i)=><AListItem key={it.id} draggable onDragStart={()=>onDragStart_p(i)} onDragEnter={()=>onDragEnter_p(i)} onDragEnd={onDragEnd_p} onDragOver={e=>e.preventDefault()}
        left={<div style={{width:34,height:34,borderRadius:9,background:T.gray100,display:"flex",alignItems:"center",justifyContent:"center"}}><I name="clipboard" size={15} style={{color:T.gray400}}/></div>}
        title={it.name}
        sub={[it.price&&(Number(it.price).toLocaleString()+"원"),it.stock!=null&&("재고 "+it.stock+"개")].filter(Boolean).join(" · ")}
        borderBottom={i<items.length-1}
        right={<div style={{display:"flex",gap:4,alignItems:"center"}}>
<div style={{display:"flex",flexDirection:"column",gap:2}}>
<button onClick={e=>{e.stopPropagation();moveItem_p(i,-1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",borderRadius:4,cursor:i===0?"not-allowed":"pointer",fontSize:9,opacity:i===0?.4:1}}>&#9650;</button>
<button onClick={e=>{e.stopPropagation();moveItem_p(i,1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:i===items.length-1?T.gray100:"#fff",borderRadius:4,cursor:i===items.length-1?"not-allowed":"pointer",fontSize:9,opacity:i===items.length-1?.4:1}}>&#9660;</button>
</div>
          <button onClick={e=>{e.stopPropagation();openEdit(it);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          <button onClick={e=>{e.stopPropagation();setDel(it.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
        </div>}/>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"제품 수정":"제품 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"제품 추가"}>
      <AField label="제품명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 진정 크림" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <AField label="가격(원)"><input style={AInp} type="number" value={form.price} onChange={e=>set("price",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="재고"><input style={AInp} type="number" value={form.stock} onChange={e=>set("stock",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <AField label="비고"><input style={AInp} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="메모" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AIBtn onClick={save} saving={saving} disabled={saving||!form.name.trim()} label={edit?"저장":"제품 추가"} style={{marginTop:4}}/>
    </ASheet>
    <AConfirm open={!!del} title="제품 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminProductItems
