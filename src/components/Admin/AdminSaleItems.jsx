import React, { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AToggle, ABadge, AIBtn, useTouchDragSort } from './AdminUI'

const uid = genId;

function AdminSaleItems({ data, setData }) {
  const [services,setServices]=useState([...(data?.services||[])].sort((a,b)=>a.sort-b.sort));
  const [filterCat,setFilterCat]=useState("all");
  const [cats,setCats]=useState(()=>[...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));
  useEffect(()=>{setCats([...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));},[data?.categories?.length]);
  const syncCats=u=>{setCats(u);if(setData)setData(p=>p?{...p,categories:u}:p);};

  const filtered=filterCat==="all"?[...services].sort((a,b)=>{const ai=cats.findIndex(c=>c.id===a.cat);const bi=cats.findIndex(c=>c.id===b.cat);if(ai!==bi)return (ai===-1?999:ai)-(bi===-1?999:bi);return (a.sort||0)-(b.sort||0);}):services.filter(s=>s.cat===filterCat);

  const {mouseHandlers:svcMH, touchHandlers:svcTH, overIdx:svcOver} = useTouchDragSort(filtered, (reordered) => {
    const others = filterCat==="all" ? [] : services.filter(s=>s.cat!==filterCat);
    const updated = [...reordered, ...others].map((s,j)=>({...s,sort:j}));
    setServices(updated); setData(p=>({...p,services:updated}));
    updated.forEach((s,j)=>sb.update("services",s.id,{sort:j}).catch(console.error));
  });
  const moveSvc=(idx2,dir)=>{
    const cur=filterCat==="all"?[...services]:services.filter(s=>s.cat===filterCat);
    const ni=idx2+dir;if(ni<0||ni>=cur.length)return;
    [cur[idx2],cur[ni]]=[cur[ni],cur[idx2]];
    const others=filterCat==="all"?[]:services.filter(s=>s.cat!==filterCat);
    const updated=[...cur,...others].map((s,j)=>({...s,sort:j}));
    setServices(updated);setData(p=>({...p,services:updated}));
    updated.forEach((s,j)=>sb.update("services",s.id,{sort:j}).catch(console.error));
  };
  useEffect(()=>{setData(p=>({...p,services}));},[services]);

  const {mouseHandlers:catMH, touchHandlers:catTH, overIdx:catOver} = useTouchDragSort(cats, (reordered) => {
    const updated = reordered.map((c,i)=>({...c,sort:i}));
    syncCats(updated);
    updated.forEach((c,i)=>sb.update("service_categories",c.id,{sort:i}).catch(console.error));
  });

  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({cat:"",name:"",dur:20,priceF:0,priceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0});
  const [catSheet,setCatSheet]=useState(false);
  const [newCatName,setNewCatName]=useState("");
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({cat:cats[0]?.id||"",name:"",dur:20,priceF:0,priceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0});setSheet(true);};
  const openEdit=s=>{setEdit(s);setForm({cat:s.cat||"",name:s.name||"",dur:s.dur||20,priceF:s.priceF||0,priceM:s.priceM||0,note:s.note||"",isPackage:!!s.isPackage,pkgCount:s.pkgCount||10,pkgPriceF:s.pkgPriceF||0,pkgPriceM:s.pkgPriceM||0});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const pl={cat:form.cat,name:form.name,dur:+form.dur,priceF:+form.priceF,priceM:+form.priceM,note:form.note,isPackage:form.isPackage,pkgCount:+form.pkgCount,pkgPriceF:+form.pkgPriceF,pkgPriceM:+form.pkgPriceM};
      if(edit){
        await sb.update("services",edit.id,pl);
        setServices(p=>p.map(s=>s.id===edit.id?{...s,...pl}:s));
      }else{
        const id="sv_"+uid();
        const res=await sb.insert("services",{id,business_id:_activeBizId,...pl,sort:services.length});
        if(!res)return;
        setServices(p=>[...p,{id,...pl,sort:services.length}]);
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("services",id).catch(console.error);
    setServices(p=>p.filter(s=>s.id!==id));
    setDel(null);
  };

  const addCat=async()=>{
    if(!newCatName.trim())return;
    const id="sc_"+uid();
    const nc={id,name:newCatName.trim(),sort:cats.length};
    await sb.insert("service_categories",{...nc,business_id:_activeBizId}).catch(console.error);
    syncCats([...cats,nc]);
    setNewCatName(""); setCatSheet(false);
  };

  const catName=id=>cats.find(c=>c.id===id)?.name||"미분류";
  const fmtSvc=n=>n?Number(n).toLocaleString()+"원":"-";
  const qtyOn=note=>(note||"").includes("[qty]");

  return <div>
    <APageHeader title="시술 상품 관리" count={services.length} onAdd={openNew}/>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <button onClick={()=>setFilterCat("all")}
  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:filterCat==="all"?700:500,
  background:filterCat==="all"?T.primary:T.gray100,color:filterCat==="all"?"#fff":T.gray600}}>전체</button>
{cats.map((c,ci)=><button key={c.id}
  data-drag-idx={ci}
  onClick={()=>setFilterCat(c.id)}
  {...catMH(ci)}
  {...catTH(ci)}
  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"grab",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:filterCat===c.id?700:500,
  background:catOver===ci?"#c5c5f0":filterCat===c.id?T.primary:T.gray100,
  color:catOver===ci?"#fff":filterCat===c.id?"#fff":T.gray600,
  transform:catOver===ci?"scale(1.05)":"none",transition:"all .15s"}}>{c.name}</button>)}
      <button onClick={()=>setCatSheet(true)} style={{padding:"5px 11px",borderRadius:20,border:"1px dashed #ccc",background:"none",color:T.textMuted,fontSize:T.fs.xs,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
        <I name="plus" size={11}/> 카테고리
      </button>
    </div>
    {filtered.length===0?<AEmpty icon="scissors" message="등록된 시술이 없어요" onAdd={openNew} addLabel="시술 추가"/>
    :<div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map((s,sidx)=><div key={s.id} className="card" data-drag-idx={sidx} {...svcMH(sidx)} {...svcTH(sidx)} style={{padding:"14px 16px",cursor:"grab"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text}}>{s.name}</span>
              {s.isPackage&&<ABadge color={T.primary}>다회권</ABadge>}
              {qtyOn(s.note)&&<ABadge color={T.female} bg={T.femaleLt}>수량허용</ABadge>}
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:6}}>
              <span style={{fontSize:T.fs.xxs,color:T.textMuted}}><I name="clock" size={10}/> {s.dur}분</span>
              <span style={{fontSize:T.fs.xxs,color:T.female}}>여 {fmtSvc(s.priceF)}</span>
              <span style={{fontSize:T.fs.xxs,color:T.male}}>남 {fmtSvc(s.priceM)}</span>
            </div>
            <ABadge color={T.gray500} bg={T.gray100}>{catName(s.cat)}</ABadge>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,-1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===0?T.gray100:"#fff",borderRadius:4,cursor:sidx===0?"not-allowed":"pointer",fontSize:9,opacity:sidx===0?.4:1}}>&#9650;</button>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===filtered.length-1?T.gray100:"#fff",borderRadius:4,cursor:sidx===filtered.length-1?"not-allowed":"pointer",fontSize:9,opacity:sidx===filtered.length-1?.4:1}}>&#9660;</button>
            </div>
            <button onClick={()=>openEdit(s)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
            <button onClick={()=>setDel(s.id)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>
          </div>
        </div>
      </div>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"시술 수정":"시술 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"시술 추가"}>
      <AField label="카테고리">
        {cats.length===0
          ? <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:T.fs.sm,color:T.textMuted}}>카테고리 없음</span>
              <button type="button" onClick={()=>{setSheet(false);setTimeout(()=>setCatSheet(true),200);}} style={{padding:"4px 10px",borderRadius:8,border:"1px dashed "+T.primary,background:"none",color:T.primary,fontSize:T.fs.xs,cursor:"pointer",fontFamily:"inherit"}}>+ 카테고리 추가</button>
            </div>
          : <select style={{...AInp}} value={form.cat} onChange={e=>set("cat",e.target.value)}>
              {cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        }
      </AField>
      <AField label="시술명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 브라질리언" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <AField label="소요(분)"><input style={AInp} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="여성가"><input style={AInp} type="number" value={form.priceF} onChange={e=>set("priceF",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="남성가"><input style={AInp} type="number" value={form.priceM} onChange={e=>set("priceM",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <div style={{display:"flex",gap:20,padding:"12px 0",borderTop:"1px solid "+T.gray100,borderBottom:"1px solid "+T.gray100,marginBottom:14}}>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
          <AToggle size="sm" on={qtyOn(form.note)} onChange={v=>{const n=(form.note||"").replace("[qty]","").trim();set("note",v?n+"[qty]":n);}}/>
          <span style={{fontSize:T.fs.sm}}>수량허용</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
          <AToggle size="sm" on={!!form.isPackage} onChange={v=>set("isPackage",v)}/>
          <span style={{fontSize:T.fs.sm}}>다회권</span>
        </label>
      </div>
      {form.isPackage&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        <AField label="회수"><input style={AInp} type="number" value={form.pkgCount} onChange={e=>set("pkgCount",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="다회권 여성가"><input style={AInp} type="number" value={form.pkgPriceF} onChange={e=>set("pkgPriceF",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="다회권 남성가"><input style={AInp} type="number" value={form.pkgPriceM} onChange={e=>set("pkgPriceM",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>}

    </ASheet>
    <ASheet open={catSheet} onClose={()=>setCatSheet(false)} title="카테고리 추가">
      <AField label="카테고리명" required><input style={AInp} value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="예: 왁싱, 스킨케어" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AIBtn onClick={addCat} disabled={!newCatName.trim()} label="추가"/>
    </ASheet>
    <AConfirm open={!!del} title="시술 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminSaleItems
