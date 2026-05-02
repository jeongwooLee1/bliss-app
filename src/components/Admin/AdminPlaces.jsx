import React, { useState } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'
import { AConfirm, ASheet, AField, AInp, AEmpty, APageHeader, AListItem, AToggle, AColorDot, ABadge, APalette, AIBtn } from './AdminUI'
import AdminBranchGroups from './AdminBranchGroups'

const uid = genId;

function AdminPlaces({ data, setData, bizId, userBranches=[], isMaster=false }) {
  const allBranches=data.branchSettings||(data.branches||[]).map(b=>({...b,color:"",useYn:true}));
  // sort 기준 정렬 (sort 없으면 끝으로). 화살표로 변경 시 즉시 반영되게 명시적 정렬
  const branches=(isMaster ? allBranches : allBranches.filter(b=>userBranches.includes(b.id)))
    .slice()
    .sort((a,b)=>{
      const sa=(a.sort??999), sb=(b.sort??999);
      if (sa!==sb) return sa-sb;
      return (a.name||"").localeCompare(b.name||"");
    });

  // 지점 순서 변경 (화살표 ▲▼) — 인접 swap + 전체 reindex
  const moveBranch = async (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= branches.length) return;
    const reordered = [...branches];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    // 전체 0~n-1로 reindex (옛 데이터의 null/중복 sort 정리)
    const updates = reordered.map((b, i) => ({ id: b.id, sort: i }));
    // DB 업데이트 (병렬)
    await Promise.all(updates.map(u => sb.update("branches", u.id, { sort: u.sort }).catch(console.error)));
    // local state 즉시 반영
    const sortMap = new Map(updates.map(u => [u.id, u.sort]));
    setData(p => ({
      ...p,
      branches: (p.branches||[]).map(b => sortMap.has(b.id) ? {...b, sort: sortMap.get(b.id)} : b),
      branchSettings: (p.branchSettings||[]).map(b => sortMap.has(b.id) ? {...b, sort: sortMap.get(b.id)} : b),
    }));
  };
  const [sheet,setSheet]=useState(false);
  const [edit,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",short:"",phone:"",address:"",color:"",useYn:true});
  const [saving,setSaving]=useState(false);
  const [del,setDel]=useState(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  const openNew=()=>{setEdit(null);setForm({name:"",short:"",phone:"",address:"",color:"",useYn:true,staffColCount:0,naverAccountId:"",instagramAccountId:"",whatsappAccountId:"",bookingNotice:"",altPhone:"",openTime:"11:00",closeTime:"21:00",defaultWorkStart:"11:00",defaultWorkEnd:"21:00"});setSheet(true);};
  const openEdit=b=>{const ts=b.timelineSettings||{};setEdit(b);setForm({name:b.name||"",short:b.short||"",phone:b.phone||"",address:b.address||"",color:b.color||"",useYn:b.useYn!==false,staffColCount:b.staffColCount||0,naverAccountId:b.naverAccountId||"",instagramAccountId:b.instagramAccountId||"",whatsappAccountId:b.whatsappAccountId||"",bookingNotice:b.bookingNotice||"",altPhone:b.altPhone||"",openTime:ts.openTime||"11:00",closeTime:ts.closeTime||"21:00",defaultWorkStart:ts.defaultWorkStart||ts.openTime||"11:00",defaultWorkEnd:ts.defaultWorkEnd||ts.closeTime||"21:00"});setSheet(true);};

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);
    try{
      if(edit){
        await sb.update("branches",edit.id,{name:form.name,short:form.short||form.name.slice(0,5),phone:form.phone,address:form.address,color:form.color,use_yn:form.useYn,staff_col_count:form.staffColCount||0,naver_account_id:form.naverAccountId||null,instagram_account_id:form.instagramAccountId||null,whatsapp_account_id:form.whatsappAccountId||null,booking_notice:form.bookingNotice||null,alt_phone:form.altPhone||null,timeline_settings:{openTime:form.openTime||"11:00",closeTime:form.closeTime||"21:00",defaultWorkStart:form.defaultWorkStart||form.openTime||"11:00",defaultWorkEnd:form.defaultWorkEnd||form.closeTime||"21:00"}});
        setData(p=>({...p,branches:(p.branches||[]).map(b=>b.id===edit.id?{...b,...form}:b),branchSettings:(p.branchSettings||[]).map(b=>b.id===edit.id?{...b,...form}:b)}));
      }else{
        const id="br_"+uid();
        await sb.insert("branches",{id,business_id:bizId,name:form.name,short:form.short||form.name.slice(0,5),phone:form.phone,address:form.address,color:form.color,use_yn:form.useYn,sort:branches.length});
        setData(p=>({...p,branches:[...(p.branches||[]),{id,...form}],branchSettings:[...(p.branchSettings||[]),{id,...form}]}));
      }
      setSheet(false);
    }catch(e){alert("저장 실패: "+e.message);}
    finally{setSaving(false);}
  };

  const doDelete=async id=>{
    await sb.del("branches",id).catch(console.error);
    setData(p=>({...p,branches:(p.branches||[]).filter(b=>b.id!==id),branchSettings:(p.branchSettings||[]).filter(b=>b.id!==id)}));
    setDel(null);
  };

  return <div>
    <APageHeader title="예약장소 관리" count={branches.length} onAdd={isMaster?openNew:undefined}/>
    {branches.length===0?<AEmpty icon="building" message="등록된 지점이 없어요" onAdd={openNew} addLabel="지점 추가"/>
    :<div className="card" style={{padding:0,overflow:"hidden"}}>
      {branches.map((b,i)=><AListItem key={b.id}
        left={<AColorDot color={b.color} size={22}/>} title={b.name}
        sub={[b.short&&("약칭: "+b.short),(b.timelineSettings?.openTime||"11:00")+"~"+(b.timelineSettings?.closeTime||"21:00"),b.phone,b.address].filter(Boolean).join(" · ")||"정보 없음"}
        borderBottom={i<branches.length-1}
        right={<div style={{display:"flex",alignItems:"center",gap:8}}>
          {isMaster && <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <button title="위로" disabled={i===0} onClick={e=>{e.stopPropagation();moveBranch(i,-1);}}
              style={{width:24,height:14,padding:0,borderRadius:4,border:"1px solid "+T.border,background:i===0?T.gray100:"#fff",cursor:i===0?"default":"pointer",fontSize:9,lineHeight:1,color:i===0?T.gray400:T.gray700,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>▲</button>
            <button title="아래로" disabled={i===branches.length-1} onClick={e=>{e.stopPropagation();moveBranch(i,1);}}
              style={{width:24,height:14,padding:0,borderRadius:4,border:"1px solid "+T.border,background:i===branches.length-1?T.gray100:"#fff",cursor:i===branches.length-1?"default":"pointer",fontSize:9,lineHeight:1,color:i===branches.length-1?T.gray400:T.gray700,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>▼</button>
          </div>}
          <ABadge color={b.useYn!==false?T.success:T.gray400}>{b.useYn!==false?"운영":"중지"}</ABadge>
          <button onClick={e=>{e.stopPropagation();openEdit(b);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={13} style={{color:T.gray500}}/></button>
          {isMaster && <button onClick={e=>{e.stopPropagation();setDel(b.id);}} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={13} style={{color:T.danger}}/></button>}
        </div>}/>)}
    </div>}

    {/* 지점 연계 — 같은 원장 관리 지점을 연결해 보유권·쿠폰 공유 사용 */}
    {isMaster && <div style={{marginTop:32,paddingTop:20,borderTop:"1px solid "+T.border}}>
      <AdminBranchGroups data={data} setData={setData} bizId={bizId}/>
    </div>}
    <ASheet open={sheet} onClose={()=>setSheet(false)} title={edit?"지점 수정":"지점 추가"} onSave={save} saving={saving} saveDisabled={saving||!form.name.trim()} saveLabel={edit?"저장":"지점 추가"}>
      <AField label="지점명" required><input style={AInp} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="예: 강남점" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="약칭" hint="타임라인 등 좁은 공간에 표시"><input style={AInp} value={form.short} onChange={e=>set("short",e.target.value)} placeholder="예: 강남" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="전화번호"><input style={AInp} value={form.phone} onChange={e=>set("phone",e.target.value)} placeholder="02-0000-0000" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="주소"><input style={AInp} value={form.address} onChange={e=>set("address",e.target.value)} placeholder="서울특별시 강남구…" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      <AField label="영업시간">
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select style={{...AInp,flex:1}} value={form.openTime} onChange={e=>{const v=e.target.value;set("openTime",v);const sh=parseInt(v);const eh=Math.min(23,sh+10);set("closeTime",`${String(eh).padStart(2,"0")}:00`);}}>
            {Array.from({length:36},(_,i)=>{const h=Math.floor(i/2)+6,m=(i%2)*30;const t=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;return <option key={t} value={t}>{t}</option>;})}</select>
          <span style={{fontSize:T.fs.sm}}>~</span>
          <select style={{...AInp,flex:1}} value={form.closeTime} onChange={e=>set("closeTime",e.target.value)}>
            {Array.from({length:36},(_,i)=>{const h=Math.floor(i/2)+6,m=(i%2)*30;const t=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;return <option key={t} value={t}>{t}</option>;})}</select>
        </div>
      </AField>
      <AField label="기본 근무시간" hint="직원 디폴트 출퇴근 (개별 설정 가능)">
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select style={{...AInp,flex:1}} value={form.defaultWorkStart} onChange={e=>{const v=e.target.value;set("defaultWorkStart",v);const sh=parseInt(v);const eh=Math.min(23,sh+10);set("defaultWorkEnd",`${String(eh).padStart(2,"0")}:00`);}}>
            {Array.from({length:36},(_,i)=>{const h=Math.floor(i/2)+6,m=(i%2)*30;const t=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;return <option key={t} value={t}>{t}</option>;})}</select>
          <span style={{fontSize:T.fs.sm}}>~</span>
          <select style={{...AInp,flex:1}} value={form.defaultWorkEnd} onChange={e=>set("defaultWorkEnd",e.target.value)}>
            {Array.from({length:36},(_,i)=>{const h=Math.floor(i/2)+6,m=(i%2)*30;const t=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;return <option key={t} value={t}>{t}</option>;})}</select>
        </div>
      </AField>
      <AField label="색상"><APalette value={form.color} onChange={v=>set("color",v)}/></AField>
      <AField label="타임라인 컬럼 수" hint="0=자동(출근 직원 수), 숫자 설정 시 빈 컬럼 포함">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>set("staffColCount",Math.max(0,(form.staffColCount||0)-1))} style={{width:34,height:34,border:"1px solid #ddd",borderRadius:T.radius.md,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="minus" size={14} color={T.gray700}/></button>
          <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:(form.staffColCount||0)>0?T.primary:T.gray400,width:40,textAlign:"center"}}>{(form.staffColCount||0)===0?"자동":form.staffColCount}</span>
          <button onClick={()=>set("staffColCount",(form.staffColCount||0)+1)} style={{width:34,height:34,border:"1px solid #ddd",borderRadius:T.radius.md,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="plus" size={14} color={T.gray700}/></button>
        </div>
      </AField>
      <div style={{borderTop:"1px solid "+T.gray100,marginTop:8,paddingTop:12}}>
        <div style={{fontSize:T.fs.xs,fontWeight:700,color:T.primary,marginBottom:8}}>예약 안내 페이지</div>
        <AField label="대체 연락처" hint="전화 연결 안 될 때 안내할 번호"><input style={AInp} value={form.altPhone} onChange={e=>set("altPhone",e.target.value)} placeholder="예: 01080086547" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="안내문구" hint="예약 확인 페이지에 표시될 안내사항 (줄바꿈 가능)"><textarea style={{...AInp,minHeight:80,resize:"vertical"}} value={form.bookingNotice} onChange={e=>set("bookingNotice",e.target.value)} placeholder="노쇼, 당일 예약취소시 이용 패키지 or 예약금 자동 차감됩니다." onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <div style={{borderTop:"1px solid "+T.gray100,marginTop:8,paddingTop:12}}>
        <div style={{fontSize:T.fs.xs,fontWeight:700,color:T.primary,marginBottom:8}}>외부 서비스 연동</div>
        <AField label="네이버톡톡 계정 ID" hint="네이버톡톡 파트너센터 > 설정 > 계정정보에서 확인"><input style={AInp} value={form.naverAccountId} onChange={e=>set("naverAccountId",e.target.value)} placeholder="예: 101171979" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="인스타그램 페이지 ID" hint="Meta Business Suite > 설정 > 비즈니스 자산 > Instagram 계정에서 확인"><input style={AInp} value={form.instagramAccountId} onChange={e=>set("instagramAccountId",e.target.value)} placeholder="예: 17841400218759830" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <AField label="왓츠앱 전화번호 ID" hint="Meta Business Suite > WhatsApp > 설정 > 전화번호에서 확인"><input style={AInp} value={form.whatsappAccountId} onChange={e=>set("whatsappAccountId",e.target.value)} placeholder="예: +821012345678" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderTop:"1px solid "+T.gray100,marginBottom:16,marginTop:4}}>
        <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:500}}>운영 중</span>
        <AToggle on={form.useYn} onChange={v=>set("useYn",v)}/>
      </div>

    </ASheet>
    <AConfirm open={!!del} title="지점 삭제" desc="삭제 후에도 기존 예약 데이터는 유지됩니다." onOk={()=>doDelete(del)} onCancel={()=>setDel(null)}/>
  </div>;
}

export default AdminPlaces
