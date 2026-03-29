import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import I from '../common/I'
import { AField, AInp, APageHeader, AToggle, AIBtn } from './AdminUI'

function AdminNoti({ data, setData, sb, bizId, branches }) {
  const [selBranch,setSelBranch]=useState(branches?.[0]?.id||null);
  const branch=branches?.find(b=>b.id===selBranch);
  const [cfg,setCfg]=useState({});
  const [saved,setSaved]=useState(false);
  const [detail,setDetail]=useState(null);
  const [apiOpen,setApiOpen]=useState(false);

  useEffect(()=>{
    if(!selBranch)return;
    const raw=branch?.notiConfig; setCfg(typeof raw==="string"?JSON.parse(raw)||{}:raw||{}); setDetail(null);
  },[selBranch]);

  const up=(k,v)=>{setCfg(p=>({...p,[k]:v}));setSaved(false);};
  const save=async()=>{
    if(!selBranch)return;
    const cfgStr=JSON.stringify(cfg);
    await sb.update("branches",selBranch,{noti_config:cfgStr}).catch(console.error);
    setData(prev=>prev?{...prev,branches:(prev.branches||[]).map(b=>b.id===selBranch?{...b,notiConfig:cfg}:b)}:prev);
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const GROUPS=[
    {label:"예약 알림",items:[
      {key:"rsv_confirm",label:"예약 확정",   desc:"예약 확정 시 발송"},
      {key:"rsv_change", label:"예약 변경",   desc:"예약 변경 시 발송"},
      {key:"rsv_1day",   label:"1일 전 알림", desc:"전날 지정 시각에 발송",hasTime:true},
      {key:"rsv_today",  label:"당일 알림",   desc:"당일 아침 지정 시각에 발송",hasTime:true},
      {key:"rsv_cancel", label:"예약 취소",   desc:"예약 취소 시 발송"},
      {key:"rsv_naver",  label:"네이버 대기", desc:"네이버 예약 대기 상태 시 발송"},
    ]},
    {label:"정액권 알림",items:[
      {key:"pkg_pay",   label:"결제 완료",  desc:"정액권 결제 완료 시 발송"},
      {key:"pkg_charge",label:"충전 완료",  desc:"정액권 충전 시 발송"},
      {key:"pkg_exp_1m",label:"만기 1달 전",desc:"만료 30일 전 발송"},
      {key:"pkg_exp_1w",label:"만기 1주 전",desc:"만료 7일 전 발송"},
    ]},
    {label:"티켓 알림",items:[
      {key:"tkt_pay",   label:"결제 완료",  desc:"티켓 결제 완료 시 발송"},
      {key:"tkt_charge",label:"충전 완료",  desc:"티켓 충전 시 발송"},
      {key:"tkt_exp_1m",label:"만기 1달 전",desc:"만료 30일 전 발송"},
      {key:"tkt_exp_1w",label:"만기 1주 전",desc:"만료 7일 전 발송"},
    ]},
    {label:"포인트 알림",items:[
      {key:"pt_earn",label:"포인트 적립",desc:"포인트 적립 시 발송"},
      {key:"pt_use", label:"포인트 사용",desc:"포인트 사용 시 발송"},
    ]},
  ];

  const notiOn=key=>!!(cfg[key]?.on);
  const toggleOn=key=>up(key,{...(cfg[key]||{}),on:!notiOn(key)});

  if(detail){
    const item=GROUPS.flatMap(g=>g.items).find(it=>it.key===detail);
    const c=cfg[detail]||{};
    const upC=(k,v)=>up(detail,{...c,[k]:v});
    return <div>
      <button onClick={()=>setDetail(null)} style={{display:"inline-flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bolder,fontFamily:"inherit",marginBottom:20,padding:0}}>
        <I name="arrowL" size={14}/> 알림톡 설정
      </button>
      <APageHeader title={item?.label||detail}/>
      <div className="card" style={{padding:20,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:T.fs.sm,fontWeight:500}}>알림 발송</span>
          <AToggle on={!!c.on} onChange={v=>upC("on",v)}/>
        </div>
        <AField label="템플릿 코드"><input style={AInp} value={c.tplCode||""} onChange={e=>upC("tplCode",e.target.value)} placeholder="예: UG_2264" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        {item?.hasTime&&<AField label="발송 시각"><input style={{...AInp,width:"auto"}} type="time" value={c.sendTime||"09:00"} onChange={e=>upC("sendTime",e.target.value)}/></AField>}
        <AField label="메시지 템플릿"><textarea style={{...AInp,height:100,resize:"vertical",lineHeight:1.5}} value={c.msgTpl||""} onChange={e=>upC("msgTpl",e.target.value)} placeholder={"예: 안녕하세요 #{고객명}님,\n#{날짜} #{시간} 예약이 확정되었습니다.\n지점: #{지점명}"} onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/></AField>
        <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:-8,marginBottom:4}}>예약알림 변수: #{"{사용자명}"} #{"{날짜}"} #{"{시간}"} #{"{작업자}"} #{"{작업장소}"} #{"{대표전화번호}"} #{"{예약URL}"}</div>
      </div>
      <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"저장"} style={{background:saved?T.success:T.primary}}/>
    </div>;
  }

  return <div>
    <APageHeader title="알림톡 설정" desc="카카오 알림톡 자동 발송을 설정하세요"/>
    {branches.length>1&&<div style={{marginBottom:16,display:"flex",gap:6,flexWrap:"wrap"}}>
      {branches.map(b=><button key={b.id} onClick={()=>setSelBranch(b.id)}
        style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:T.fs.xs,fontWeight:selBranch===b.id?700:500,
          background:selBranch===b.id?T.primary:T.gray100,color:selBranch===b.id?"#fff":T.gray600}}>{b.name}</button>)}
    </div>}
    <div className="card" style={{padding:0,overflow:"hidden",marginBottom:16}}>
      <div onClick={()=>setApiOpen(!apiOpen)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"#FEE500",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"#3A1D1D"}}>K</div>
          <div>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>카카오 채널 API 설정</div>
            <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>알리고 알림톡 연동 정보</div>
          </div>
        </div>
        <I name={apiOpen?"chevU":"chevD"} size={16} style={{color:T.gray400}}/>
      </div>
      {apiOpen&&<div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
        {[["API Key","aligoKey","aeymilcraepgb3i2lgmyk2iez23iefh9"],["사용자 ID","aligoId","cripiss"],["발신 채널 키(SenderKey)","senderKey","카카오 채널 발신 키"],["발신 번호","senderPhone","010-xxxx-xxxx"]].map(([lv,k,ph])=>
          <AField key={k} label={lv}><input style={AInp} value={cfg[k]||""} onChange={e=>up(k,e.target.value)} placeholder={ph} onFocus={el=>el.target.style.borderColor=T.primary} onBlur={el=>el.target.style.borderColor="#e8e8f0"}/></AField>)}
        <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"API 저장"} style={{background:saved?T.success:T.primary}}/>
      </div>}
    </div>
    {GROUPS.map(g=><div key={g.label} style={{marginBottom:16}}>
      <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:8,paddingLeft:2}}>{g.label}</div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        {g.items.map((item,idx)=><div key={item.key} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",borderBottom:idx<g.items.length-1?"1px solid "+T.gray100:"none"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>{item.label}</div>
            <div style={{fontSize:T.fs.xxs,color:T.textMuted}}>{item.desc}</div>
          </div>
          <AToggle size="sm" on={notiOn(item.key)} onChange={()=>toggleOn(item.key)}/>
          <button onClick={()=>setDetail(item.key)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="chevR" size={13} style={{color:T.gray400}}/></button>
        </div>)}
      </div>
    </div>)}
    <AIBtn onClick={save} disabled={false} label={saved?"✓ 저장됨":"저장"} style={{background:saved?T.success:T.primary}}/>
  </div>;
}

export default AdminNoti
