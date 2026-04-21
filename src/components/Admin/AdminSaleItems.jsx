import React, { useState, useEffect, useRef, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId, toDb } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AToggle, ABadge, AIBtn, useTouchDragSort } from './AdminUI'

const uid = genId;

function AdminSaleItems({ data, setData, couponMode=false }) {
  const [services,setServices]=useState([...(data?.services||[])].sort((a,b)=>a.sort-b.sort));
  const [cats,setCats]=useState(()=>[...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));
  useEffect(()=>{setCats([...(data?.categories||[])].sort((a,b)=>(a.sort||0)-(b.sort||0)));},[data?.categories?.length]);
  const syncCats=u=>{setCats(u);if(setData)setData(p=>p?{...p,categories:u}:p);};
  // 쿠폰 모드: 쿠폰 카테고리만 관리. 일반 모드: 쿠폰 카테고리 숨김.
  const isCatAllowed = (catId) => {
    const c = cats.find(x => x.id === catId);
    if (!c) return !couponMode;
    return couponMode ? c.name === '쿠폰' : c.name !== '쿠폰';
  };
  const visibleCats = cats.filter(c => couponMode ? c.name === '쿠폰' : c.name !== '쿠폰');
  const visibleServices = services.filter(s => isCatAllowed(s.cat));
  const defaultCatId = visibleCats[0]?.id || "";
  const [filterCat,setFilterCat]=useState("all");

  const filtered=filterCat==="all"?[...visibleServices].sort((a,b)=>{const ai=visibleCats.findIndex(c=>c.id===a.cat);const bi=visibleCats.findIndex(c=>c.id===b.cat);if(ai!==bi)return (ai===-1?999:ai)-(bi===-1?999:bi);return (a.sort||0)-(b.sort||0);}):visibleServices.filter(s=>s.cat===filterCat);

  const {mouseHandlers:svcMH, touchHandlers:svcTH, overIdx:svcOver} = useTouchDragSort(filtered, (reordered) => {
    const others = filterCat==="all" ? [] : services.filter(s=>s.cat!==filterCat);
    const updated = [...reordered, ...others].map((s,j)=>({...s,sort:j}));
    setServices(updated); setData(p=>({...p,services:updated}));
    updated.forEach((s,j)=>sb.update("services",s.id,{sort:j}).catch(console.error));
  }, 'svc');
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

  // 훅엔 visibleCats를 전달 (JSX의 ci와 일치시킴) — 숨은 카테고리(쿠폰)는 뒤에 붙여 sort 재할당
  const {mouseHandlers:catMH, touchHandlers:catTH, overIdx:catOver} = useTouchDragSort(visibleCats, (reorderedVisible) => {
    const hiddenCats = cats.filter(c => !visibleCats.some(v => v.id === c.id));
    const merged = [...reorderedVisible, ...hiddenCats].map((c,i)=>({...c, sort:i}));
    syncCats(merged);
    merged.forEach((c,i)=>sb.update("service_categories", c.id, {sort:i}).catch(console.error));
  }, 'cat');

  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({cat:"",name:"",dur:20,priceF:0,priceM:0,memberPriceF:0,memberPriceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0,badgeText:"",badgeColor:"#ffffff",badgeBg:"#f97316",promoConfig:{},isActive:true});
  const [catSheet,setCatSheet]=useState(false);
  const [newCatName,setNewCatName]=useState("");
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  // 이벤트 일괄 적용 모달
  const [bulkSheet, setBulkSheet] = useState(false);
  const [bulkForm, setBulkForm] = useState({badgeText:"",badgeColor:"#ffffff",badgeBg:"#f97316",promoConfig:{},targetIds:new Set()});
  const bulkSet = (k,v) => setBulkForm(p=>({...p,[k]:v}));
  const bulkTogglePc = (k, v) => setBulkForm(p => ({...p, promoConfig:{...p.promoConfig, [k]:+v||0}}));
  const bulkToggleTarget = (id) => setBulkForm(p => { const n=new Set(p.targetIds); n.has(id)?n.delete(id):n.add(id); return {...p, targetIds:n}; });
  const bulkApply = async () => {
    const ids = Array.from(bulkForm.targetIds);
    if (ids.length === 0) { alert("적용할 상품을 선택하세요"); return; }
    const rawPc = bulkForm.promoConfig || {};
    const cleanPc = {};
    ["newCustDiscountPct","newCustDiscountFlat","memberDiscountPct","pointAwardFlat","pointAwardPct","minAmount"].forEach(k => {
      const v = Number(rawPc[k]||0); if (v > 0) cleanPc[k] = v;
    });
    if (rawPc.validFrom) cleanPc.validFrom = rawPc.validFrom;
    if (rawPc.validUntil) cleanPc.validUntil = rawPc.validUntil;
    const pcJson = Object.keys(cleanPc).length > 0 ? cleanPc : null;
    const updates = {
      badge_text: bulkForm.badgeText || null,
      badge_color: bulkForm.badgeColor || null,
      badge_bg: bulkForm.badgeBg || null,
      promo_config: pcJson,
    };
    try {
      await Promise.all(ids.map(id => sb.update("services", id, updates)));
      setServices(p => p.map(s => ids.includes(s.id) ? {...s, badgeText:updates.badge_text, badgeColor:updates.badge_color, badgeBg:updates.badge_bg, promoConfig:pcJson} : s));
      alert(`${ids.length}개 상품에 이벤트 적용 완료`);
      setBulkSheet(false);
      setBulkForm({badgeText:"",badgeColor:"#ffffff",badgeBg:"#f97316",promoConfig:{},targetIds:new Set()});
    } catch(e) { alert("일괄 적용 실패: " + e.message); }
  };
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({cat:defaultCatId,name:"",dur:20,priceF:0,priceM:0,memberPriceF:0,memberPriceM:0,note:"",isPackage:false,pkgCount:10,pkgPriceF:0,pkgPriceM:0,badgeText:"",badgeColor:"#ffffff",badgeBg:"#f97316",promoConfig:{},isActive:true});setSheet(true);};
  const openEdit=s=>{
    let pc = s.promoConfig || {};
    if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch(e) { pc = {}; } }
    setEdit(s);
    setForm({cat:s.cat||"",name:s.name||"",dur:s.dur||20,priceF:s.priceF||0,priceM:s.priceM||0,memberPriceF:s.memberPriceF||0,memberPriceM:s.memberPriceM||0,note:s.note||"",isPackage:!!s.isPackage,pkgCount:s.pkgCount||10,pkgPriceF:s.pkgPriceF||0,pkgPriceM:s.pkgPriceM||0,badgeText:s.badgeText||"",badgeColor:s.badgeColor||"#ffffff",badgeBg:s.badgeBg||"#f97316",promoConfig:pc||{},isActive:s.isActive!==false});
    setSheet(true);
  };
  // 판매중단 토글 — 리스트에서 직접 전환
  const toggleActive = async (s) => {
    const next = !(s.isActive !== false);
    try {
      await sb.update("services", s.id, { is_active: next });
      setServices(p => p.map(x => x.id === s.id ? { ...x, isActive: next } : x));
    } catch(e) { alert("상태 변경 실패: " + e.message); }
  };

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      // promoConfig 정리: 숫자 필드 정규화, 빈값 제거
      const rawPc = form.promoConfig || {};
      const cleanPc = {};
      ["newCustDiscountPct","newCustDiscountFlat","memberDiscountPct","pointAwardFlat","pointAwardPct","minAmount"].forEach(k => {
        const v = Number(rawPc[k]||0); if (v > 0) cleanPc[k] = v;
      });
      if (rawPc.validFrom) cleanPc.validFrom = rawPc.validFrom;
      if (rawPc.validUntil) cleanPc.validUntil = rawPc.validUntil;
      if (Array.isArray(rawPc.branchIds) && rawPc.branchIds.length > 0) cleanPc.branchIds = rawPc.branchIds;
      const pl={cat:form.cat,name:form.name,dur:+form.dur,priceF:+form.priceF,priceM:+form.priceM,memberPriceF:+form.memberPriceF||null,memberPriceM:+form.memberPriceM||null,note:form.note,isPackage:form.isPackage,pkgCount:+form.pkgCount,pkgPriceF:+form.pkgPriceF,pkgPriceM:+form.pkgPriceM,badgeText:form.badgeText||null,badgeColor:form.badgeColor||null,badgeBg:form.badgeBg||null,promoConfig:Object.keys(cleanPc).length>0?cleanPc:null,isActive:form.isActive!==false};
      if(edit){
        await sb.update("services",edit.id,toDb("services",pl));
        setServices(p=>p.map(s=>s.id===edit.id?{...s,...pl}:s));
      }else{
        const id="sv_"+uid();
        const res=await sb.insert("services",toDb("services",{id,business_id:_activeBizId,...pl,sort:services.length}));
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
    setNewCatName("");
  };
  const renameCat = async (id, newName) => {
    const trimmed = (newName||"").trim();
    if (!trimmed) return;
    const cur = cats.find(c => c.id === id);
    if (!cur || cur.name === trimmed) return;
    const updated = cats.map(c => c.id === id ? {...c, name: trimmed} : c);
    syncCats(updated);
    await sb.update("service_categories", id, {name: trimmed}).catch(console.error);
  };
  const deleteCat = async (id) => {
    const cur = cats.find(c => c.id === id);
    if (!cur) return;
    const n = services.filter(s => s.cat === id).length;
    if (n > 0) {
      alert(`이 카테고리에 시술 ${n}개가 있어 삭제할 수 없습니다.\n먼저 다른 카테고리로 이동하세요.`);
      return;
    }
    if (!confirm(`"${cur.name}" 카테고리를 삭제할까요?`)) return;
    const updated = cats.filter(c => c.id !== id);
    syncCats(updated);
    await sb.del("service_categories", id).catch(console.error);
    if (filterCat === id) setFilterCat("all");
  };

  const catName=id=>cats.find(c=>c.id===id)?.name||"미분류";
  const fmtSvc=n=>n?Number(n).toLocaleString()+"원":"-";
  const qtyOn=note=>(note||"").includes("[qty]");

  return <div>
    <APageHeader title={couponMode?"쿠폰 관리":"시술 상품 관리"} count={visibleServices.length} onAdd={openNew}/>
    {!couponMode && <MemberRulesCard data={data} setData={setData}/>}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <button onClick={()=>setFilterCat("all")}
  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:filterCat==="all"?700:500,
  background:filterCat==="all"?T.primary:T.gray100,color:filterCat==="all"?"#fff":T.gray600}}>전체</button>
{visibleCats.map((c,ci)=>(
  <div key={c.id} data-drag-idx={ci} {...catMH(ci)} {...catTH(ci)}
    onClick={()=>setFilterCat(c.id)}
    title="드래그해서 순서 변경"
    style={{padding:"5px 13px",borderRadius:20,cursor:"grab",fontSize:T.fs.xs,fontWeight:filterCat===c.id?700:500,
    background:catOver===ci?"#c5c5f0":filterCat===c.id?T.primary:T.gray100,
    color:catOver===ci?"#fff":filterCat===c.id?"#fff":T.gray600,
    transform:catOver===ci?"scale(1.05)":"none",transition:"all .15s",
    userSelect:"none",display:"inline-block",lineHeight:"1.4"}}>{c.name}</div>
))}
      <button onClick={()=>setCatSheet(true)} title="카테고리 추가·이름 편집·삭제"
        style={{padding:"5px 12px",borderRadius:20,border:"1px solid "+T.primary,background:T.primaryLt||"#EDE9FE",color:T.primary,fontSize:T.fs.xs,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
        <I name="edit" size={11}/> 카테고리 편집
      </button>
      <button onClick={()=>setBulkSheet(true)} style={{marginLeft:"auto",padding:"5px 13px",borderRadius:20,border:"1px solid "+T.primary,background:T.primaryLt||T.bgCard,color:T.primary,fontSize:T.fs.xs,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
        🎁 이벤트 일괄 적용
      </button>
    </div>
    {filtered.length===0?<AEmpty icon="scissors" message="등록된 시술이 없어요" onAdd={openNew} addLabel="시술 추가"/>
    :<div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map((s,sidx)=><div key={s.id} className="card" data-drag-idx={sidx} {...svcMH(sidx)} {...svcTH(sidx)} style={{padding:"14px 16px",cursor:"grab",opacity:s.isActive===false?0.55:1,background:s.isActive===false?T.gray100:""}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,textDecoration:s.isActive===false?"line-through":"none"}}>{s.name}</span>
              {s.isActive===false&&<ABadge color={T.danger} bg={T.dangerLt||"#fee2e2"}>판매중단</ABadge>}
              {s.isPackage&&<ABadge color={T.primary}>다회권</ABadge>}
              {qtyOn(s.note)&&<ABadge color={T.female} bg={T.femaleLt}>수량허용</ABadge>}
              {s.badgeText&&<span style={{display:"inline-block",padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,color:s.badgeColor||"#fff",background:s.badgeBg||T.primary}}>{s.badgeText}</span>}
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:6}}>
              <span style={{fontSize:T.fs.xxs,color:T.textMuted}}><I name="clock" size={10}/> {s.dur}분</span>
              <span style={{fontSize:T.fs.xxs,color:T.female}}>여 {fmtSvc(s.priceF)}{s.memberPriceF?<span style={{color:T.primary,marginLeft:3}}>→{fmtSvc(s.memberPriceF)}</span>:""}</span>
              <span style={{fontSize:T.fs.xxs,color:T.male}}>남 {fmtSvc(s.priceM)}{s.memberPriceM?<span style={{color:T.primary,marginLeft:3}}>→{fmtSvc(s.memberPriceM)}</span>:""}</span>
            </div>
            <ABadge color={T.gray500} bg={T.gray100}>{catName(s.cat)}</ABadge>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,-1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===0?T.gray100:"#fff",borderRadius:4,cursor:sidx===0?"not-allowed":"pointer",fontSize:9,opacity:sidx===0?.4:1}}>&#9650;</button>
            <button onClick={e=>{e.stopPropagation();moveSvc(sidx,1);}} style={{width:22,height:20,border:"1px solid "+T.border,background:sidx===filtered.length-1?T.gray100:"#fff",borderRadius:4,cursor:sidx===filtered.length-1?"not-allowed":"pointer",fontSize:9,opacity:sidx===filtered.length-1?.4:1}}>&#9660;</button>
            </div>
            <button onClick={()=>toggleActive(s)} title={s.isActive===false?"판매 재개":"판매중단"}
              style={{padding:"3px 8px",borderRadius:7,border:`1px solid ${s.isActive===false?"#fecaca":T.border}`,background:s.isActive===false?"#fff5f5":"#fff",color:s.isActive===false?T.danger:T.gray600,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>
              {s.isActive===false?"중단":"판매중"}
            </button>
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
          : <select style={{...AInp}} value={form.cat} onChange={e=>set("cat",e.target.value)} disabled={couponMode}>
              {visibleCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        }
      </AField>
      <AField label="시술명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 브라질리언" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <AField label="소요(분)"><input style={AInp} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="여성 정상가"><input style={AInp} type="number" value={form.priceF} onChange={e=>set("priceF",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="남성 정상가"><input style={AInp} type="number" value={form.priceM} onChange={e=>set("priceM",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <AField label="여성 회원가"><input style={{...AInp,borderColor:"#e0d4f5"}} type="number" value={form.memberPriceF} onChange={e=>set("memberPriceF",e.target.value)} placeholder="없으면 0" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e0d4f5"}/></AField>
        <AField label="남성 회원가"><input style={{...AInp,borderColor:"#e0d4f5"}} type="number" value={form.memberPriceM} onChange={e=>set("memberPriceM",e.target.value)} placeholder="없으면 0" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e0d4f5"}/></AField>
      </div>
      <div style={{display:"flex",gap:20,padding:"12px 0",borderTop:"1px solid "+T.gray100,borderBottom:"1px solid "+T.gray100,marginBottom:14,flexWrap:"wrap"}}>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
          <AToggle size="sm" on={form.isActive!==false} onChange={v=>set("isActive",v)}/>
          <span style={{fontSize:T.fs.sm,color:form.isActive===false?T.danger:T.text,fontWeight:form.isActive===false?700:400}}>{form.isActive===false?"판매중단":"판매중"}</span>
        </label>
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

      {/* ─── 배지 + 이벤트/쿠폰 설정 ─── */}
      <div style={{marginTop:4,paddingTop:12,borderTop:"1px dashed "+T.border}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.textSub,marginBottom:8}}>{couponMode?"🎫 배지":"🎁 이벤트 / 배지"}</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
          <AField label="배지 문구">
            <input style={AInp} value={form.badgeText} onChange={e=>set("badgeText",e.target.value)} placeholder={couponMode?"예: 제품3만원, 10%적립":"예: 신규10%, 5만P 적립"}/>
          </AField>
          <AField label="글자색">
            <input type="color" value={form.badgeColor} onChange={e=>set("badgeColor",e.target.value)} style={{width:"100%",height:36,border:"1px solid "+T.border,borderRadius:8,cursor:"pointer",padding:2}}/>
          </AField>
          <AField label="배경색">
            <input type="color" value={form.badgeBg} onChange={e=>set("badgeBg",e.target.value)} style={{width:"100%",height:36,border:"1px solid "+T.border,borderRadius:8,cursor:"pointer",padding:2}}/>
          </AField>
        </div>
        {form.badgeText && <div style={{marginBottom:10,display:"flex",alignItems:"center",gap:6,fontSize:T.fs.xxs,color:T.textMuted}}>
          <span>미리보기:</span>
          <span style={{display:"inline-block",padding:"3px 10px",borderRadius:10,fontSize:11,fontWeight:700,color:form.badgeColor,background:form.badgeBg}}>{form.badgeText}</span>
        </div>}
        {!couponMode && <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
            <AField label="신규고객 할인 %">
              <input style={AInp} type="number" value={form.promoConfig.newCustDiscountPct||""} onChange={e=>set("promoConfig",{...form.promoConfig,newCustDiscountPct:+e.target.value||0})} placeholder="예: 10"/>
            </AField>
            <AField label="신규고객 할인 금액">
              <input style={AInp} type="number" value={form.promoConfig.newCustDiscountFlat||""} onChange={e=>set("promoConfig",{...form.promoConfig,newCustDiscountFlat:+e.target.value||0})} placeholder="예: 5000"/>
            </AField>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
            <AField label="회원 추가 할인 %">
              <input style={AInp} type="number" value={form.promoConfig.memberDiscountPct||""} onChange={e=>set("promoConfig",{...form.promoConfig,memberDiscountPct:+e.target.value||0})} placeholder="회원가 외 추가할인"/>
            </AField>
            <AField label="최소 구매금액">
              <input style={AInp} type="number" value={form.promoConfig.minAmount||""} onChange={e=>set("promoConfig",{...form.promoConfig,minAmount:+e.target.value||0})} placeholder="조건 없으면 비움"/>
            </AField>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
            <AField label="포인트 적립 고정액">
              <input style={AInp} type="number" value={form.promoConfig.pointAwardFlat||""} onChange={e=>set("promoConfig",{...form.promoConfig,pointAwardFlat:+e.target.value||0})} placeholder="예: 50000"/>
            </AField>
            <AField label="포인트 적립 %">
              <input style={AInp} type="number" value={form.promoConfig.pointAwardPct||""} onChange={e=>set("promoConfig",{...form.promoConfig,pointAwardPct:+e.target.value||0})} placeholder="예: 5"/>
            </AField>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <AField label="이벤트 시작일"><input style={AInp} type="date" value={form.promoConfig.validFrom||""} onChange={e=>set("promoConfig",{...form.promoConfig,validFrom:e.target.value})}/></AField>
            <AField label="이벤트 종료일"><input style={AInp} type="date" value={form.promoConfig.validUntil||""} onChange={e=>set("promoConfig",{...form.promoConfig,validUntil:e.target.value})}/></AField>
          </div>
        </>}
        {(couponMode || cats.find(c=>c.id===form.cat)?.name==='쿠폰') && (()=>{
          const cType = form.promoConfig.couponType||"";
          const cTarget = form.promoConfig.couponTarget||"";
          const needsValue = cType && cType!=='free_service';
          const needsSvcPicker = cType==='free_service' || cTarget==='specific_service';
          const needsCatPicker = cTarget==='category';
          const valueLabel = cType==='flat' ? '할인 금액(원)' : cType==='percent' ? '할인 %' : cType==='point_bonus_pct' ? '추가 적립 %' : '값';
          const autoApply = form.promoConfig.autoApply !== false; // 기본 true
          const consumeOnUse = form.promoConfig.consumeOnUse !== false; // 기본 true
          const priority = form.promoConfig.priority ?? 100;
          const selCatIds = Array.isArray(form.promoConfig.couponTargetCategoryIds) ? form.promoConfig.couponTargetCategoryIds : [];
          const toggleCat = (cid) => {
            const next = selCatIds.includes(cid) ? selCatIds.filter(x=>x!==cid) : [...selCatIds, cid];
            set("promoConfig",{...form.promoConfig, couponTargetCategoryIds: next});
          };
          // 하위호환: 기존 단일 id → 배열로 변환해 표시
          const selIds = Array.isArray(form.promoConfig.couponTargetServiceIds)
            ? form.promoConfig.couponTargetServiceIds
            : (form.promoConfig.couponTargetServiceId ? [form.promoConfig.couponTargetServiceId] : []);
          const toggleSvc = (sid) => {
            const next = selIds.includes(sid) ? selIds.filter(x=>x!==sid) : [...selIds, sid];
            set("promoConfig",{...form.promoConfig, couponTargetServiceIds: next, couponTargetServiceId: undefined});
          };
          return (
            <div style={{marginTop:12,padding:10,borderRadius:8,background:'#fff8e1',border:'1px dashed #f59e0b'}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bold,color:T.textSub,marginBottom:8}}>🎫 쿠폰 효과 (매출등록 시 고객 보유 쿠폰으로 자동 적용)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
                <AField label="쿠폰 타입">
                  <select style={AInp} value={cType} onChange={e=>set("promoConfig",{...form.promoConfig,couponType:e.target.value})}>
                    <option value="">(선택)</option>
                    <option value="flat">정액 할인</option>
                    <option value="percent">% 할인</option>
                    <option value="point_bonus_pct">포인트 추가 적립 %</option>
                    <option value="free_service">무료 시술권</option>
                  </select>
                </AField>
                <AField label="적용 대상">
                  <select style={AInp} value={cTarget} onChange={e=>set("promoConfig",{...form.promoConfig,couponTarget:e.target.value})}>
                    <option value="all">전체 매출</option>
                    <option value="products">제품만</option>
                    <option value="services">시술만</option>
                    <option value="category">특정 카테고리 (복수)</option>
                    <option value="specific_service">특정 시술 (복수)</option>
                  </select>
                </AField>
              </div>
              {needsValue && (
                <AField label={valueLabel}>
                  <input style={AInp} type="number" value={form.promoConfig.couponValue||""} onChange={e=>set("promoConfig",{...form.promoConfig,couponValue:+e.target.value||0})}/>
                </AField>
              )}
              {needsCatPicker && (
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,marginBottom:4}}>대상 카테고리 (복수 선택) <span style={{color:T.primary,fontWeight:900}}>({selCatIds.length})</span></div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,padding:8,border:"1px solid "+T.border,borderRadius:8,background:"#fff"}}>
                    {cats.filter(c=>c.name!=='쿠폰').map(c => {
                      const on = selCatIds.includes(c.id);
                      return <label key={c.id} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",border:`1px solid ${on?T.primary:T.border}`,borderRadius:12,background:on?(T.primaryLt||"#ede9ff"):"#fff",cursor:"pointer",fontSize:11,color:on?T.primary:T.text,fontWeight:on?700:400}}>
                        <input type="checkbox" checked={on} onChange={()=>toggleCat(c.id)} style={{accentColor:T.primary}}/>
                        {c.name}
                      </label>;
                    })}
                  </div>
                </div>
              )}
              {needsSvcPicker && (
                <div>
                  <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:T.textSub,marginBottom:4}}>대상 시술/제품 (복수 선택) <span style={{color:T.primary,fontWeight:900}}>({selIds.length})</span></div>
                  <div style={{maxHeight:220,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,padding:8,background:"#fff"}}>
                    {cats.filter(c=>c.name!=='쿠폰').map(c => {
                      const catSvcs = services.filter(s=>s.cat===c.id && s.id!==edit?.id);
                      if (catSvcs.length === 0) return null;
                      return <div key={c.id} style={{marginBottom:10}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.textSub,marginBottom:4}}>{c.name}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {catSvcs.map(s => {
                            const on = selIds.includes(s.id);
                            return <label key={s.id} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",border:`1px solid ${on?T.primary:T.border}`,borderRadius:12,background:on?(T.primaryLt||"#ede9ff"):"#fff",cursor:"pointer",fontSize:11,color:on?T.primary:T.text,fontWeight:on?700:400}}>
                              <input type="checkbox" checked={on} onChange={()=>toggleSvc(s.id)} style={{accentColor:T.primary}}/>
                              {s.name}
                            </label>;
                          })}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              )}
              <div style={{marginTop:10,paddingTop:10,borderTop:"1px dashed #f59e0b"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,alignItems:"end"}}>
                  <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:T.fs.xs,color:T.textSub,fontWeight:T.fw.bold}}>
                    <input type="checkbox" checked={autoApply} onChange={e=>set("promoConfig",{...form.promoConfig,autoApply:e.target.checked})} style={{accentColor:T.primary}}/>
                    자동 우선 적용
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:T.fs.xs,color:T.textSub,fontWeight:T.fw.bold}}>
                    <input type="checkbox" checked={consumeOnUse} onChange={e=>set("promoConfig",{...form.promoConfig,consumeOnUse:e.target.checked})} style={{accentColor:T.primary}}/>
                    1회 사용 시 소진
                  </label>
                  <AField label="우선순위(낮을수록 먼저)">
                    <input style={AInp} type="number" value={priority} onChange={e=>set("promoConfig",{...form.promoConfig,priority:+e.target.value||0})} placeholder="100"/>
                  </AField>
                </div>
                <div style={{marginTop:6,fontSize:10,color:T.textMuted,lineHeight:1.4}}>
                  💡 자동 우선 적용이 켜지면 조건에 맞는 매출 등록 시 이 쿠폰이 자동으로 먼저 차감됩니다. 소진 시 고객 보유권에서 1회 감소.
                </div>
              </div>
            </div>
          );
        })()}
      </div>

    </ASheet>
    <ASheet open={bulkSheet} onClose={()=>setBulkSheet(false)} title="🎁 이벤트 일괄 적용" onSave={bulkApply} saving={false} saveLabel={`${bulkForm.targetIds.size}개 상품에 적용`} saveDisabled={bulkForm.targetIds.size===0}>
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:10,lineHeight:1.5}}>
        이벤트 내용을 설정하고 아래에서 적용할 상품을 체크하세요. 선택된 상품의 기존 배지·이벤트 설정이 덮어씌워집니다.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
        <AField label="배지 문구"><input style={AInp} value={bulkForm.badgeText} onChange={e=>bulkSet("badgeText",e.target.value)} placeholder="예: 신규10%"/></AField>
        <AField label="글자색"><input type="color" value={bulkForm.badgeColor} onChange={e=>bulkSet("badgeColor",e.target.value)} style={{width:"100%",height:36,border:"1px solid "+T.border,borderRadius:8,cursor:"pointer",padding:2}}/></AField>
        <AField label="배경색"><input type="color" value={bulkForm.badgeBg} onChange={e=>bulkSet("badgeBg",e.target.value)} style={{width:"100%",height:36,border:"1px solid "+T.border,borderRadius:8,cursor:"pointer",padding:2}}/></AField>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
        <AField label="신규고객 할인 %"><input style={AInp} type="number" value={bulkForm.promoConfig.newCustDiscountPct||""} onChange={e=>bulkTogglePc("newCustDiscountPct",e.target.value)}/></AField>
        <AField label="신규고객 할인 금액"><input style={AInp} type="number" value={bulkForm.promoConfig.newCustDiscountFlat||""} onChange={e=>bulkTogglePc("newCustDiscountFlat",e.target.value)}/></AField>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
        <AField label="회원 추가 할인 %"><input style={AInp} type="number" value={bulkForm.promoConfig.memberDiscountPct||""} onChange={e=>bulkTogglePc("memberDiscountPct",e.target.value)}/></AField>
        <AField label="최소 구매금액"><input style={AInp} type="number" value={bulkForm.promoConfig.minAmount||""} onChange={e=>bulkTogglePc("minAmount",e.target.value)}/></AField>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
        <AField label="포인트 고정액"><input style={AInp} type="number" value={bulkForm.promoConfig.pointAwardFlat||""} onChange={e=>bulkTogglePc("pointAwardFlat",e.target.value)}/></AField>
        <AField label="포인트 %"><input style={AInp} type="number" value={bulkForm.promoConfig.pointAwardPct||""} onChange={e=>bulkTogglePc("pointAwardPct",e.target.value)}/></AField>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <AField label="시작일"><input style={AInp} type="date" value={bulkForm.promoConfig.validFrom||""} onChange={e=>setBulkForm(p=>({...p,promoConfig:{...p.promoConfig,validFrom:e.target.value}}))}/></AField>
        <AField label="종료일"><input style={AInp} type="date" value={bulkForm.promoConfig.validUntil||""} onChange={e=>setBulkForm(p=>({...p,promoConfig:{...p.promoConfig,validUntil:e.target.value}}))}/></AField>
      </div>
      {bulkForm.badgeText && <div style={{marginBottom:12,padding:"6px 10px",background:T.gray100,borderRadius:8,display:"flex",alignItems:"center",gap:8,fontSize:T.fs.xxs,color:T.textMuted}}>
        미리보기:
        <span style={{display:"inline-block",padding:"2px 10px",borderRadius:10,fontSize:11,fontWeight:700,color:bulkForm.badgeColor,background:bulkForm.badgeBg}}>{bulkForm.badgeText}</span>
      </div>}
      <div style={{borderTop:"1px dashed "+T.border,paddingTop:10,marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.textSub}}>적용 대상 상품 <span style={{color:T.primary,fontWeight:900}}>({bulkForm.targetIds.size})</span></span>
          <div style={{display:"flex",gap:6}}>
            <button type="button" onClick={()=>setBulkForm(p=>({...p,targetIds:new Set(visibleServices.map(s=>s.id))}))} style={{padding:"3px 10px",fontSize:11,borderRadius:6,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>전체선택</button>
            <button type="button" onClick={()=>setBulkForm(p=>({...p,targetIds:new Set()}))} style={{padding:"3px 10px",fontSize:11,borderRadius:6,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>해제</button>
          </div>
        </div>
        <div style={{maxHeight:260,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,padding:8}}>
          {visibleCats.map(c => {
            const catSvcs = visibleServices.filter(s => s.cat === c.id);
            if (catSvcs.length === 0) return null;
            const allOn = catSvcs.every(s => bulkForm.targetIds.has(s.id));
            return <div key={c.id} style={{marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <button type="button" onClick={()=>setBulkForm(p=>{const n=new Set(p.targetIds); catSvcs.forEach(s => allOn?n.delete(s.id):n.add(s.id)); return {...p,targetIds:n};})} style={{padding:"2px 8px",fontSize:10,borderRadius:5,border:"1px solid "+T.border,background:allOn?T.primary:"#fff",color:allOn?"#fff":T.textSub,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>{c.name}</button>
                <span style={{fontSize:10,color:T.textMuted}}>({catSvcs.filter(s=>bulkForm.targetIds.has(s.id)).length}/{catSvcs.length})</span>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,paddingLeft:6}}>
                {catSvcs.map(s => {
                  const on = bulkForm.targetIds.has(s.id);
                  return <label key={s.id} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",border:`1px solid ${on?T.primary:T.border}`,borderRadius:12,background:on?T.primaryLt:"#fff",cursor:"pointer",fontSize:11,color:on?T.primary:T.text,fontWeight:on?700:400}}>
                    <input type="checkbox" checked={on} onChange={()=>bulkToggleTarget(s.id)} style={{accentColor:T.primary}}/>
                    {s.name}
                  </label>;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>
    </ASheet>
    <ASheet open={catSheet} onClose={()=>setCatSheet(false)} title="카테고리 관리">
      <AField label="새 카테고리 추가">
        <div style={{display:"flex",gap:6}}>
          <input style={{...AInp,flex:1}} value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="예: 왁싱, 스킨케어"
            onKeyDown={e=>{if(e.key==='Enter' && newCatName.trim()) addCat();}}
            onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/>
          <button onClick={addCat} disabled={!newCatName.trim()}
            style={{padding:"6px 16px",borderRadius:8,border:"none",background:newCatName.trim()?T.primary:T.gray300,color:"#fff",fontSize:12,fontWeight:700,cursor:newCatName.trim()?"pointer":"default",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            추가
          </button>
        </div>
      </AField>
      <div style={{marginTop:14}}>
        <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6}}>기존 카테고리 ({visibleCats.length})</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:360,overflowY:"auto",padding:"4px 2px"}}>
          {visibleCats.map(c => {
            const svcCount = services.filter(s => s.cat === c.id).length;
            const canDelete = svcCount === 0;
            return <CatRow key={c.id} cat={c} svcCount={svcCount} canDelete={canDelete}
              onRename={(name)=>renameCat(c.id, name)} onDelete={()=>deleteCat(c.id)}/>;
          })}
          {visibleCats.length === 0 && <div style={{fontSize:11,color:T.textMuted,padding:"20px 0",textAlign:"center"}}>카테고리 없음</div>}
        </div>
      </div>
    </ASheet>
    <AConfirm open={!!del} title="시술 삭제" onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

// 회원가 자격 조건 카드 — businesses.settings.member_price_rules
function MemberRulesCard({ data, setData }) {
  const biz = (data?.businesses||[])[0];
  const rules = biz?.settings?.member_price_rules || { annualEnabled: true, prepaidMin: 500000 };
  const [annualEnabled, setAnnualEnabled] = useState(!!rules.annualEnabled);
  const [prepaidMin, setPrepaidMin] = useState(Number(rules.prepaidMin) || 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!biz?.id) return;
    setSaving(true);
    const nextSettings = { ...(biz.settings||{}), member_price_rules: { annualEnabled, prepaidMin: Number(prepaidMin)||0 } };
    try {
      await sb.update("businesses", biz.id, { settings: nextSettings });
      if (setData) setData(p => p ? { ...p, businesses: (p.businesses||[]).map(b => b.id === biz.id ? { ...b, settings: nextSettings } : b) } : p);
      setDirty(false);
    } catch(e) { console.error("member_price_rules save failed", e); alert("저장 실패"); }
    setSaving(false);
  };
  return <div style={{marginBottom:12,padding:"10px 14px",background:"#F3E8FF",border:"1px solid #D8B4FE",borderRadius:8}}>
    <div style={{fontSize:12,fontWeight:700,color:"#6B21A8",marginBottom:6}}>⭐ 회원가 자동 적용 조건</div>
    <div style={{fontSize:11,color:"#6B21A8",marginBottom:8}}>아래 조건 중 하나라도 충족하는 고객은 매출등록 시 시술가가 <b>회원가</b>로 자동 표시됩니다.</div>
    <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:12,color:"#4B5563"}}>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
        <input type="checkbox" checked={annualEnabled} onChange={e=>{setAnnualEnabled(e.target.checked);setDirty(true);}}/>
        연간회원권 보유 (유효기간 내)
      </label>
      <label style={{display:"flex",alignItems:"center",gap:6}}>
        <span>다담권 원 충전액</span>
        <input type="number" value={prepaidMin} onChange={e=>{setPrepaidMin(e.target.value);setDirty(true);}}
          style={{width:100,padding:"3px 6px",fontSize:12,borderRadius:6,border:"1px solid "+T.border,textAlign:"right"}}/>
        <span>원 이상 (0 = 비활성화)</span>
      </label>
    </div>
    {dirty && <div style={{marginTop:8,display:"flex",gap:6}}>
      <button onClick={save} disabled={saving}
        style={{padding:"5px 12px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:"#7C3AED",color:"#fff",cursor:saving?"default":"pointer",fontFamily:"inherit"}}>
        {saving?"저장 중...":"저장"}
      </button>
    </div>}
  </div>;
}

// 카테고리 관리 모달 내 개별 행 — 이름 인라인 편집 + 삭제
function CatRow({ cat, svcCount, canDelete, onRename, onDelete }) {
  const [name, setName] = useState(cat.name || "");
  const [editing, setEditing] = useState(false);
  useEffect(() => { setName(cat.name || ""); }, [cat.name]);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== cat.name) onRename(name.trim());
    else setName(cat.name || "");
  };
  return <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",border:"1px solid "+T.border,borderRadius:8,background:"#fff"}}>
    {editing ? (
      <>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')commit(); if(e.key==='Escape'){setName(cat.name||"");setEditing(false);}}}
          style={{flex:1,padding:"4px 8px",fontSize:12,border:"1px solid "+T.primary,borderRadius:6,fontFamily:"inherit"}}/>
        <button onClick={commit} title="저장"
          style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:T.primary,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>저장</button>
        <button onClick={()=>{setName(cat.name||"");setEditing(false);}} title="취소"
          style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"1px solid "+T.border,background:"#fff",color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
      </>
    ) : (
      <>
        <span style={{flex:1,fontSize:12,fontWeight:600,color:T.text,padding:"4px 0"}}>{cat.name}</span>
        <span style={{fontSize:10,color:svcCount>0?T.textSub:T.textMuted,minWidth:48,textAlign:"right"}}>
          시술 {svcCount}개
        </span>
        <button onClick={()=>setEditing(true)} title="이름 수정"
          style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"1px solid "+T.primary,background:"#fff",color:T.primary,cursor:"pointer",fontFamily:"inherit"}}>수정</button>
        <button onClick={onDelete} disabled={!canDelete}
          title={canDelete?"삭제":"시술이 있어 삭제 불가 (먼저 이동)"}
          style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:6,
            border:"1px solid "+(canDelete?T.danger:T.border),
            background:canDelete?"#fff":T.gray100,
            color:canDelete?T.danger:T.textMuted,
            cursor:canDelete?"pointer":"not-allowed",fontFamily:"inherit"}}>
          삭제
        </button>
      </>
    )}
  </div>;
}

export default AdminSaleItems
