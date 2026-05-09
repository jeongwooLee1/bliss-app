import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId, SYSTEM_TAG_IDS } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AToggle, ABadge, APalette, useTouchDragSort } from './AdminUI'
import { TAG_TRIGGER_TYPES, describeTrigger } from '../../lib/tagAutoTrigger'

const uid = genId;

function AdminServiceTags({ data, setData }) {
  const [tags,setTags]=useState(()=>[...(data?.serviceTags||[])].sort((a,b)=>a.sort-b.sort));
  useEffect(()=>{setData(p=>p?{...p,serviceTags:tags}:p);},[tags]);

  const [activeTab,setActiveTab]=useState("reservation");
  const [sheet,setSheet]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState({name:"",dur:0,color:"",useYn:true,autoTrigger:null});
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const isSchedule=activeTab==="schedule";
  const isSource=activeTab==="source";
  const tabTags=(tags||[]).filter(t=>isSchedule?t.scheduleYn==="Y":t.scheduleYn!=="Y");
  const sources=[...(data?.resSources||[])].sort((a,b)=>(a.sort||0)-(b.sort||0));
  const items=isSource?sources:tabTags;

  const getContrast=hex=>{
    if(!hex||hex.length<4)return T.text;
    const h=hex.replace("#","");
    const r=parseInt(h.length===3?h[0]+h[0]:h.slice(0,2),16);
    const g=parseInt(h.length===3?h[1]+h[1]:h.slice(2,4),16);
    const b=parseInt(h.length===3?h[2]+h[2]:h.slice(4,6),16);
    return(0.299*r+0.587*g+0.114*b)/255>0.55?T.text:"#fff";
  };

  const syncTags=updated=>{setTags(updated);if(setData)setData(p=>p?{...p,serviceTags:updated}:p);};
  const syncSources=updated=>{if(setData)setData(p=>p?{...p,resSources:updated}:p);};
  const tagToDb=t=>({id:t.id,business_id:_activeBizId,name:t.name,dur:t.dur||0,schedule_yn:t.scheduleYn==="Y"?"Y":"N",color:t.color||"",use_yn:t.useYn!==false,sort:t.sort||0,auto_trigger:t.autoTrigger||null});

  const openNew=()=>{setEditItem(null);setForm({name:"",dur:0,color:"",useYn:true,autoTrigger:null});setSheet(true);};
  const openEdit=t=>{setEditItem(t);setForm({name:t.name||"",dur:t.dur||0,color:t.color||"",useYn:t.useYn!==false,autoTrigger:t.autoTrigger||null});setSheet(true);};

  const save=()=>{
    if(!form.name.trim())return;
    if(isSource){
      if(editItem){
        const updated=sources.map(s=>s.id===editItem.id?{...s,name:form.name.trim(),color:form.color,useYn:form.useYn!==false}:s);
        syncSources(updated);
        sb.update("reservation_sources",editItem.id,{name:form.name.trim(),color:form.color,use_yn:form.useYn!==false}).catch(console.error);
      }else{
        const id="rs_"+uid();
        const newSrc={id,name:form.name.trim(),color:form.color,useYn:true,sort:sources.length};
        syncSources([...sources,newSrc]);
        sb.insert("reservation_sources",{id,business_id:_activeBizId,name:form.name.trim(),color:form.color,sort:sources.length,use_yn:true}).catch(console.error);
      }
    }else if(editItem){
      syncTags(tags.map(t=>t.id===editItem.id?{...t,...form}:t));
      sb.update("service_tags",editItem.id,{name:form.name,dur:form.dur||0,color:form.color,use_yn:form.useYn!==false,sort:editItem.sort||0,auto_trigger:form.autoTrigger||null}).catch(console.error);
    }else{
      const t={id:uid(),name:form.name.trim(),dur:Number(form.dur)||0,scheduleYn:isSchedule?"Y":"N",color:form.color,useYn:true,sort:tags.length,autoTrigger:form.autoTrigger||null};
      syncTags([...tags,t]);
      sb.upsert("service_tags",[tagToDb(t)]);
    }
    setSheet(false);
  };

  const doDelete=id=>{
    if(isSource){
      syncSources(sources.filter(s=>s.id!==id));
      sb.del("reservation_sources",id).catch(console.error);
      setDel(null);return;
    }
    if(SYSTEM_TAG_IDS.includes(id)){alert("시스템 태그는 삭제할 수 없습니다.");setDel(null);return;}
    syncTags((tags||[]).filter(t=>t.id!==id).map((t,i)=>({...t,sort:i})));
    sb.del("service_tags",id).catch(console.error);
    setDel(null);
  };

  const toggleUse=id=>{
    if(isSource){
      const src=sources.find(s=>s.id===id);
      const newUse=src?.useYn===false;
      syncSources(sources.map(s=>s.id===id?{...s,useYn:newUse}:s));
      sb.update("reservation_sources",id,{use_yn:newUse}).catch(console.error);
      return;
    }
    const tag=tags.find(t=>t.id===id);
    const newUse=tag?.useYn===false;
    syncTags(tags.map(t=>t.id===id?{...t,useYn:newUse}:t));
    sb.update("service_tags",id,{use_yn:newUse}).catch(console.error);
  };

  // 화살표 순서 변경 (예약경로/태그 공통)
  const moveItem=(i,dir)=>{
    if(isSource){
      const r=[...sources];
      const j=i+dir;
      if(j<0||j>=r.length)return;
      const [m]=r.splice(i,1); r.splice(j,0,m);
      const updated=r.map((s,k)=>({...s,sort:k}));
      syncSources(updated);
      r.forEach((s,k)=>sb.update("reservation_sources",s.id,{sort:k}).catch(console.error));
      return;
    }
    const r=[...tabTags];
    const j=i+dir;
    if(j<0||j>=r.length)return;
    const [m]=r.splice(i,1); r.splice(j,0,m);
    const other=(tags||[]).filter(t=>isSchedule?t.scheduleYn!=="Y":t.scheduleYn==="Y");
    const all=[...r,...other].map((t,k)=>({...t,sort:k}));
    syncTags(all);
    r.forEach((t,k)=>sb.update("service_tags",t.id,{sort:k}).catch(console.error));
  };

  const dragSorter = isSource ? (reordered)=>{
    const updated=reordered.map((s,j)=>({...s,sort:j}));
    syncSources(updated);
    reordered.forEach((s,j)=>sb.update("reservation_sources",s.id,{sort:j}).catch(console.error));
  } : (reordered)=>{
    const other=(tags||[]).filter(t=>isSchedule?t.scheduleYn!=="Y":t.scheduleYn==="Y");
    const all=[...reordered,...other].map((t,j)=>({...t,sort:j}));
    syncTags(all);
    reordered.forEach((t,j)=>sb.update("service_tags",t.id,{sort:j}).catch(console.error));
  };
  const {mouseHandlers:tagMH, touchHandlers:tagTH, overIdx:tagOver} = useTouchDragSort(items, dragSorter);

  const TABS = [["reservation","예약"],["schedule","내부일정"],["source","예약경로"]];
  const addLabel = isSource ? "경로 추가" : "태그 추가";
  const titleLabel = isSource ? "예약경로 추가" : (isSchedule ? "내부일정 태그 추가" : "예약 태그 추가");
  const editLabel = isSource ? "예약경로 수정" : "태그 수정";

  // 자동태그 설정 — 태그 드롭다운 선택 → 조건 편집 → 저장 (한 번에 하나)
  const [autoSheet, setAutoSheet] = useState(false);
  const [autoTagId, setAutoTagId] = useState("");
  const [autoTrigger, setAutoTrigger] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const reservationTags = (tags||[]).filter(t => t.scheduleYn !== "Y").sort((a,b)=>(a.sort||0)-(b.sort||0));
  const openAutoSheet = () => {
    const first = reservationTags[0];
    setAutoTagId(first?.id || "");
    setAutoTrigger(first?.autoTrigger || null);
    setAutoSheet(true);
  };
  const switchAutoTag = (tagId) => {
    const t = reservationTags.find(x => x.id === tagId);
    setAutoTagId(tagId);
    setAutoTrigger(t?.autoTrigger || null);
  };
  const saveAutoSheet = async () => {
    if (!autoTagId) return;
    setAutoSaving(true);
    try {
      await sb.update("service_tags", autoTagId, { auto_trigger: autoTrigger || null }).catch(console.error);
      syncTags(tags.map(t => t.id === autoTagId ? { ...t, autoTrigger: autoTrigger || null } : t));
      setAutoSheet(false);
    } finally { setAutoSaving(false); }
  };

  return <div style={{maxWidth:720,margin:"0 auto"}}>
    <APageHeader title="태그·경로 관리" count={items.length} onAdd={openNew} addLabel={addLabel}/>
    {!isSource && <div style={{marginBottom:12,display:"flex",justifyContent:"flex-end"}}>
      <button onClick={openAutoSheet} title="모든 태그의 자동 부여 조건을 한 화면에서 편집"
        style={{padding:"7px 14px",fontSize:12,fontWeight:700,border:"1px solid "+T.primary,background:T.primaryLt||"#ede9fe",color:T.primaryDk,borderRadius:8,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
        <I name="zap" size={12}/> 자동태그 설정
      </button>
    </div>}
    <div style={{display:"flex",gap:6,marginBottom:16}}>
      {TABS.map(([k,lv])=>
        <button key={k} onClick={()=>setActiveTab(k)}
          style={{padding:"7px 18px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:activeTab===k?700:500,
            background:activeTab===k?T.primary:T.gray100,color:activeTab===k?"#fff":T.gray600}}>{lv}</button>)}
    </div>
    {items.filter(t=>t.useYn!==false).length>0 && <div style={{marginBottom:16,padding:"12px 14px",background:T.gray100,borderRadius:12}}>
      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:8,fontWeight:T.fw.bold}}>미리보기 (드래그로 순서 변경)</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {items.filter(t=>t.useYn!==false).map((t,i)=><div key={t.id}
          data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
          style={{padding:"4px 12px",borderRadius:20,background:tagOver===i?(t.color||T.primary)+"cc":(t.color||T.primary),color:getContrast(t.color||T.primary),fontSize:T.fs.xs,fontWeight:700,cursor:"grab",opacity:tagOver===i?0.5:1}}>{t.name}</div>)}
      </div>
    </div>}
    {items.length===0 ? <AEmpty icon={isSource?"zap":"tag"} message={isSource?"등록된 예약경로가 없어요":"등록된 태그가 없어요"} onAdd={openNew} addLabel={addLabel}/>
    : <div className="card" style={{padding:0,overflow:"hidden"}}>
      {items.map((t,i)=><div key={t.id} draggable
          data-drag-idx={i} {...tagMH(i)} {...tagTH(i)}
          style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:i<items.length-1?"1px solid "+T.gray100:"none",cursor:"grab",
          background:tagOver===i?T.primaryHover:"transparent",transition:"background .1s"}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:t.color||T.primary,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:t.useYn!==false?T.text:T.gray400}}>{t.name}</div>
          {!isSource && t.dur>0 && <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{t.dur}분</div>}
        </div>
        {/* 우측 액션 한 그룹 */}
        <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <button onClick={e=>{e.stopPropagation();moveItem(i,-1);}} style={{width:20,height:20,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",borderRadius:4,cursor:i===0?"not-allowed":"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===0?.4:1,padding:0}}>&#9650;</button>
            <button onClick={e=>{e.stopPropagation();moveItem(i,1);}} style={{width:20,height:20,border:"1px solid "+T.border,background:i===items.length-1?T.gray100:"#fff",borderRadius:4,cursor:i===items.length-1?"not-allowed":"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",opacity:i===items.length-1?.4:1,padding:0}}>&#9660;</button>
          </div>
          {!isSource && SYSTEM_TAG_IDS.includes(t.id) && <ABadge color="#f39c12" bg="#fff3e0">시스템</ABadge>}
          <AToggle size="sm" on={t.useYn!==false} onChange={()=>toggleUse(t.id)}/>
          <button onClick={()=>openEdit(t)} style={{width:26,height:26,borderRadius:6,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={12} style={{color:T.gray500}}/></button>
          {(isSource || !SYSTEM_TAG_IDS.includes(t.id)) && <button onClick={()=>setDel(t.id)} style={{width:26,height:26,borderRadius:6,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={12} style={{color:T.danger}}/></button>}
        </div>
      </div>)}
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={editItem?editLabel:titleLabel} onSave={save} saveDisabled={!form.name.trim()} saveLabel={editItem?"저장":addLabel}>
      <AField label={isSource?"경로명":"태그명"} required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder={isSource?"예: 라인, 카톡":"예: 신규, VIP"} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      {!isSource && <AField label="소요 시간(분)" hint="0이면 기본 시술 시간 사용"><input style={{...AInp,width:120}} type="number" value={form.dur} onChange={e=>set("dur",e.target.value)} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>}
      <AField label="색상">
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <APalette value={form.color} onChange={v=>set("color",v)}/>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:8,border:"1px dashed "+T.border,background:"#fafafa"}}>
            <span style={{fontSize:T.fs.xxs,color:T.textMuted,fontWeight:T.fw.bold}}>직접 선택</span>
            <input type="color" value={form.color||"#7c7cc8"} onChange={e=>set("color",e.target.value)}
              style={{width:40,height:30,border:"1px solid "+T.border,borderRadius:6,cursor:"pointer",padding:0,background:"#fff"}}/>
            <input type="text" value={form.color||""} onChange={e=>set("color",e.target.value)}
              placeholder="#RRGGBB" maxLength={7}
              style={{width:80,padding:"4px 6px",fontSize:T.fs.xxs,fontFamily:"monospace",border:"1px solid "+T.border,borderRadius:6}}/>
          </div>
        </div>
      </AField>
      {form.color&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"10px 14px",borderRadius:10,background:form.color,marginBottom:14}}>
        <div style={{fontSize:T.fs.sm,fontWeight:700,color:getContrast(form.color)}}>{form.name||"미리보기"}</div>
      </div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16}}>
        <span style={{fontSize:T.fs.sm,fontWeight:500}}>사용 중</span>
        <AToggle on={form.useYn!==false} onChange={v=>set("useYn",v)}/>
      </div>

      {/* 자동 부여 트리거는 [⚡ 자동태그 설정] 버튼에서 일괄 편집 */}
      {!isSchedule && !isSource && <div style={{padding:"10px 12px",background:T.primaryLt||"#ede9fe",borderRadius:8,fontSize:11,color:T.primaryDk,marginTop:6}}>
        💡 자동 부여 조건은 우상단 <b>[⚡ 자동태그 설정]</b> 버튼에서 한 번에 편집할 수 있어요.
      </div>}

    </ASheet>
    <AConfirm open={!!del} title={isSource?"예약경로 삭제":"태그 삭제"} onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>

    {/* ⚡ 자동태그 설정 — 태그 선택 → 조건 → 저장 (한 번에 하나) */}
    <ASheet open={autoSheet} onClose={()=>setAutoSheet(false)} title="⚡ 자동태그 설정" onSave={saveAutoSheet} saveDisabled={autoSaving || !autoTagId} saveLabel={autoSaving?"저장 중...":"저장"}>
      {(() => {
        const selTag = reservationTags.find(t => t.id === autoTagId);
        const def = autoTrigger ? TAG_TRIGGER_TYPES.find(x=>x.type===autoTrigger.type) : null;
        const cats = data?.categories || [];
        const svcs = data?.services || [];
        const setParam = (key, v) => setAutoTrigger({...autoTrigger, [key]: v});
        return <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <AField label="태그 선택">
            <select value={autoTagId} onChange={e=>switchAutoTag(e.target.value)} style={{...AInp,width:"100%"}}>
              {reservationTags.length === 0 && <option value="">등록된 태그가 없어요</option>}
              {reservationTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </AField>
          {selTag && <>
            <AField label="언제 이 태그를 자동으로 붙일까요?" hint="조건이 맞을 때만 시스템이 예약에 태그를 자동으로 달아줘요. 비우면 직원이 직접 켤 때만 붙어요.">
              <select value={autoTrigger?.type||""} onChange={e=>{
                const type=e.target.value;
                if(!type){setAutoTrigger(null);return;}
                const newDef=TAG_TRIGGER_TYPES.find(x=>x.type===type);
                const next={type};
                (newDef?.params||[]).forEach(p=>{next[p.key]=p.default;});
                setAutoTrigger(next);
              }} style={{...AInp,width:"100%"}}>
                <option value="">자동으로 붙이지 않음</option>
                {TAG_TRIGGER_TYPES.map(x=><option key={x.type} value={x.type}>{x.label}</option>)}
              </select>
            </AField>
            {autoTrigger?.type && (() => {
              const preview = describeTrigger(autoTrigger, { categories: cats, services: svcs, tagName: selTag.name });
              if (!preview) return null;
              return <div style={{padding:"10px 12px",background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:8,fontSize:12,color:"#075985",lineHeight:1.5,display:"flex",alignItems:"flex-start",gap:6}}>
                <span style={{flexShrink:0}}>👀</span>
                <span><b>미리보기:</b> {preview}</span>
              </div>;
            })()}
            {def?.params?.length > 0 && <div style={{display:"flex",flexDirection:"column",gap:12,padding:"12px 14px",background:"#fafafa",border:"1px solid "+T.border,borderRadius:10}}>
              {def.params.map(p => {
                const ptype = p.type || 'number';
                const cur = autoTrigger[p.key];
                if (ptype === 'number') {
                  return <div key={p.key} style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="number" value={cur ?? p.default} onChange={e=>setParam(p.key, Number(e.target.value)||0)} style={{...AInp,width:90}}/>
                    <span style={{fontSize:T.fs.xs,color:T.gray700,fontWeight:500}}>{p.label}</span>
                  </div>;
                }
                if (ptype === 'bool') {
                  return <div key={p.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:T.fs.xs,color:T.gray700,fontWeight:500}}>{p.label}</span>
                    <AToggle size="sm" on={!!cur} onChange={v=>setParam(p.key, v)}/>
                  </div>;
                }
                if (ptype === 'category_multi') {
                  const sel = Array.isArray(cur) ? cur : [];
                  return <div key={p.key}>
                    <div style={{fontSize:T.fs.xs,color:T.gray700,marginBottom:6,fontWeight:500,display:"flex",alignItems:"center",gap:6}}>
                      {p.label}
                      {sel.length>0 && <span style={{padding:"1px 7px",borderRadius:10,background:T.primary,color:"#fff",fontSize:10,fontWeight:700}}>{sel.length}개</span>}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {cats.map(c => {
                        const on = sel.includes(c.id);
                        return <button key={c.id} type="button" onClick={()=>setParam(p.key, on ? sel.filter(x=>x!==c.id) : [...sel, c.id])}
                          style={{padding:"4px 10px",fontSize:11,fontWeight:on?700:500,border:"1px solid "+(on?T.primary:T.border),borderRadius:14,background:on?T.primaryLt:"#fff",color:on?T.primaryDk:T.gray600,cursor:"pointer",fontFamily:"inherit"}}>{c.name}</button>;
                      })}
                    </div>
                  </div>;
                }
                if (ptype === 'service_multi') {
                  const sel = Array.isArray(cur) ? cur : [];
                  const byCategory = {};
                  svcs.forEach(s => {
                    const cat = cats.find(c => c.id === s.cat);
                    const catName = cat?.name || '기타';
                    if (!byCategory[catName]) byCategory[catName] = [];
                    byCategory[catName].push(s);
                  });
                  const catOrder = [...cats.map(c => c.name), '기타'];
                  return <div key={p.key}>
                    <div style={{fontSize:T.fs.xs,color:T.gray700,marginBottom:6,fontWeight:500,display:"flex",alignItems:"center",gap:6}}>
                      {p.label}
                      {sel.length>0 && <span style={{padding:"1px 7px",borderRadius:10,background:T.primary,color:"#fff",fontSize:10,fontWeight:700}}>{sel.length}개</span>}
                      {sel.length>0 && <button type="button" onClick={()=>setParam(p.key, [])} style={{marginLeft:"auto",fontSize:10,color:T.danger,background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>전체 해제</button>}
                    </div>
                    <div style={{maxHeight:280,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,padding:8,background:"#fff"}}>
                      {catOrder.map(catName => {
                        const items = byCategory[catName];
                        if (!items?.length) return null;
                        return <div key={catName} style={{marginBottom:8}}>
                          <div style={{fontSize:10,fontWeight:700,color:T.gray600,marginBottom:4}}>{catName} <span style={{color:T.gray400}}>({items.length})</span></div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                            {items.map(s => {
                              const on = sel.includes(s.id);
                              return <button key={s.id} type="button" onClick={()=>setParam(p.key, on ? sel.filter(x=>x!==s.id) : [...sel, s.id])}
                                style={{padding:"4px 9px",fontSize:10,fontWeight:on?700:500,border:"1px solid "+(on?T.primary:T.border),borderRadius:12,background:on?T.primaryLt:"#fff",color:on?T.primaryDk:T.gray700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{on && "✓ "}{s.name}</button>;
                            })}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>;
                }
                return null;
              })}
            </div>}
          </>}
        </div>;
      })()}
    </ASheet>
  </div>;
}

export default AdminServiceTags
