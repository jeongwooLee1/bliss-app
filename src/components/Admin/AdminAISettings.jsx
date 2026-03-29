import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { AField, AInp, AEmpty, APageHeader, ABadge, AIBtn } from './AdminUI'

const AI_RULES_KEY = "bliss_ai_rules";

function AdminAISettings({ data, sb: sbProp, bizId }) {
  const [activeAiTab,setActiveAiTab]=useState("api"); // "api" | "rules" | "chat"
  const [apiKey,setApiKey]=useState(()=>window.__geminiKey||localStorage.getItem("bliss_gemini_key")||"");
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const [rules,setRules]=useState(()=>{try{return JSON.parse(localStorage.getItem(AI_RULES_KEY)||"[]");}catch{return [];}});
  const [chatPrompt,setChatPrompt]=useState(()=>localStorage.getItem("bliss_ai_chat_prompt")||"");
  const [chatSaved,setChatSaved]=useState(false);

  useEffect(()=>{
    if(!bizId)return;
    fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders})
    .then(r=>r.json()).then(rows=>{
      try{
        const memo=JSON.parse(rows[0]?.settings||"{}");
        if(memo.gemini_key){setApiKey(memo.gemini_key);localStorage.setItem("bliss_gemini_key",memo.gemini_key);}
        if(memo.ai_rules?.length){setRules(memo.ai_rules);localStorage.setItem(AI_RULES_KEY,JSON.stringify(memo.ai_rules));}
        if(memo.ai_chat_prompt!=null){setChatPrompt(memo.ai_chat_prompt);localStorage.setItem("bliss_ai_chat_prompt",memo.ai_chat_prompt);window.__aiChatPrompt=memo.ai_chat_prompt;}
      }catch(e){}
    }).catch(()=>{});
  },[bizId]);

  const [newRule,setNewRule]=useState("");
  const [editIdx,setEditIdx]=useState(null);
  const [editVal,setEditVal]=useState("");

  const saveKey=async()=>{
    const t=apiKey.trim();
    localStorage.setItem("bliss_gemini_key",t);
    window.__geminiKey=t;
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.gemini_key=t;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const testKey=async()=>{
    setTesting(true); setTestResult(null);
    try{
      const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+apiKey.trim(),
        {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"안녕"}]}]})});
      setTestResult(r.ok?"✓ 연결 성공":"✕ 연결 실패 ("+r.status+")");
    }catch(e){setTestResult("✕ "+e.message);}
    finally{setTesting(false);}
  };

  const saveRules=async updated=>{
    setRules(updated);
    localStorage.setItem(AI_RULES_KEY,JSON.stringify(updated));
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.ai_rules=updated;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
  };

  const addRule=()=>{if(newRule.trim()){saveRules([...rules,newRule.trim()]);setNewRule("");}};
  const delRule=i=>saveRules(rules.filter((_,idx)=>idx!==i));
  const startEdit=i=>{setEditIdx(i);setEditVal(rules[i]);};
  const saveEdit=()=>{if(editVal.trim()){saveRules(rules.map((r,i)=>i===editIdx?editVal.trim():r));setEditIdx(null);}};

  const saveChatPrompt=async()=>{
    const t=chatPrompt;
    localStorage.setItem("bliss_ai_chat_prompt",t);
    window.__aiChatPrompt=t;
    if(bizId){
      try{
        const r=await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`,{headers:sbHeaders});
        const rows=await r.json();
        let memo={};try{memo=JSON.parse(rows[0]?.settings||"{}");}catch{}
        memo.ai_chat_prompt=t;
        await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(memo)})});
      }catch(e){}
    }
    setChatSaved(true); setTimeout(()=>setChatSaved(false),2000);
  };

  // 시술 가격표 텍스트 생성 (자동응대 프롬프트 미리보기용)
  const svcPriceText = useMemo(()=>{
    const svcs=(data?.services||[]).filter(s=>s.name);
    if(!svcs.length) return "(등록된 시술 없음)";
    return svcs.map(s=>{
      const parts=[s.name];
      if(s.dur) parts.push(s.dur+"분");
      if(s.priceF) parts.push("여 "+Number(s.priceF).toLocaleString()+"원");
      if(s.priceM) parts.push("남 "+Number(s.priceM).toLocaleString()+"원");
      if(s.price) parts.push(Number(s.price).toLocaleString()+"원");
      return parts.join(" / ");
    }).join("\n");
  },[data?.services]);

  const AI_TABS=[
    {id:"api",label:"API 키"},
    {id:"rules",label:"분석 규칙"},
    {id:"chat",label:"자동 응대"},
  ];

  return <div>
    <APageHeader title="AI 설정" desc="AI 분석 및 자동 응대 기능을 설정하세요"/>
    <div style={{display:"flex",gap:6,marginBottom:20}}>
      {AI_TABS.map(t=><button key={t.id} onClick={()=>setActiveAiTab(t.id)} style={{
        padding:"7px 16px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"inherit",
        fontSize:T.fs.xs,fontWeight:activeAiTab===t.id?700:500,
        background:activeAiTab===t.id?T.primary:T.gray100,
        color:activeAiTab===t.id?"#fff":T.gray600,transition:"all .15s"
      }}>{t.label}</button>)}
    </div>
    {/* API 키 탭 */}
    {activeAiTab==="api" && <div className="card" style={{padding:20}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
        <I name="sparkles" size={14} style={{color:T.primary}}/> Gemini API 키
      </div>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:14,lineHeight:1.6}}>
        AI Book 기능에 사용됩니다.{" "}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" style={{color:T.primary,fontWeight:700}}>Google AI Studio</a>에서 무료로 발급받을 수 있어요.
      </div>
      <AField label="API 키">
        <input style={AInp} type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="AIzaSy…" onFocus={e=>e.target.style.borderColor=T.primary} onBlur={e=>e.target.style.borderColor="#e8e8f0"}/>
      </AField>
      {testResult&&<div style={{fontSize:T.fs.xs,padding:"8px 12px",borderRadius:8,marginBottom:12,background:testResult.startsWith("✓")?"#f0faf4":"#fff5f5",color:testResult.startsWith("✓")?T.success:T.danger}}>{testResult}</div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={testKey} disabled={testing||!apiKey.trim()} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid "+T.border,background:"#fff",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>
          {testing?"테스트 중…":"연결 테스트"}
        </button>
        <AIBtn onClick={saveKey} disabled={!apiKey.trim()} label={saved?"✓ 저장됨":"저장"} style={{flex:1,background:saved?T.success:T.primary}}/>
      </div>
    </div>}

    {/* 분석 규칙 탭 */}
    {activeAiTab==="rules" && <div className="card" style={{padding:20}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
        <I name="fileText" size={14} style={{color:T.primary}}/> AI 분석 커스텀 규칙
        <ABadge color={T.primary}>{rules.length}개</ABadge>
      </div>
      <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:16,lineHeight:1.6}}>네이버 예약정보 AI 분석 시 이 규칙들이 프롬프트에 추가됩니다.</div>
      {rules.length===0?<AEmpty icon="fileText" message="등록된 규칙이 없어요"/>
      :<div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {rules.map((r,i)=><div key={i} style={{border:"1.5px solid "+T.border,borderRadius:10,padding:"12px 14px",background:"#fafafa"}}>
          {editIdx===i
            ?<div>
              <textarea style={{...AInp,minHeight:72,resize:"vertical",marginBottom:10,lineHeight:1.6}} value={editVal} onChange={e=>setEditVal(e.target.value)}/>
              <div style={{display:"flex",gap:8}}>
                <AIBtn onClick={saveEdit} disabled={!editVal.trim()} label="저장" style={{flex:1}}/>
                <button onClick={()=>setEditIdx(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+T.border,background:"none",fontSize:T.fs.sm,fontWeight:600,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
              </div>
            </div>
            :<div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1,fontSize:T.fs.xs,color:T.text,lineHeight:1.6}}>{r}</div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>startEdit(i)} style={{width:28,height:28,borderRadius:7,border:"1px solid "+T.border,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="edit" size={12} style={{color:T.gray500}}/></button>
                <button onClick={()=>delRule(i)} style={{width:28,height:28,borderRadius:7,border:"1px solid #fecaca",background:"#fff5f5",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I name="trash" size={12} style={{color:T.danger}}/></button>
              </div>
            </div>}
        </div>)}
      </div>}
      <AField label="새 규칙 추가">
        <textarea style={{...AInp,minHeight:80,resize:"vertical",marginBottom:10,lineHeight:1.6}} value={newRule} onChange={e=>setNewRule(e.target.value)} placeholder="예: 다리안쪽은 다리 절반 시술이다"/>
      </AField>
      <AIBtn onClick={addRule} disabled={!newRule.trim()} label="규칙 추가"/>
    </div>}

    {/* 자동 응대 탭 */}
    {activeAiTab==="chat" && <div>
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
          <I name="chat" size={14} style={{color:T.primary}}/> 자동 응대 프롬프트
        </div>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:16,lineHeight:1.6}}>
          고객 메시지에 AI가 자동 답변할 때 사용할 지침입니다.<br/>
          영업시간, 주의사항, 안내 문구 등을 자유롭게 작성하세요.
        </div>
        <AField label="응대 지침">
          <textarea style={{...AInp,minHeight:160,resize:"vertical",lineHeight:1.7}} value={chatPrompt} onChange={e=>setChatPrompt(e.target.value)}
            placeholder={"예:\n- 영업시간: 오전 11시 ~ 오후 10시 (연중무휴)\n- 가격 문의 시 아래 가격표를 참고하여 정확히 안내\n- 할인/이벤트는 안내하지 말 것\n- 예약은 네이버 예약 링크로 안내"}/>
        </AField>
        <AIBtn onClick={saveChatPrompt} label={chatSaved?"✓ 저장됨":"저장"} style={{background:chatSaved?T.success:T.primary}}/>
      </div>

      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.text,marginBottom:4,display:"flex",alignItems:"center",gap:7}}>
          <I name="clipboard" size={14} style={{color:T.gray500}}/> 자동 포함되는 정보
        </div>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginBottom:12,lineHeight:1.6}}>
          아래 정보는 AI 응대 시 자동으로 프롬프트에 포함됩니다. (관리설정에서 수정)
        </div>
        <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.text,marginBottom:6}}>시술 가격표</div>
        <pre style={{fontSize:T.fs.xxs,color:T.gray600,background:T.gray100,padding:12,borderRadius:8,whiteSpace:"pre-wrap",lineHeight:1.6,marginBottom:16,maxHeight:200,overflowY:"auto"}}>{svcPriceText}</pre>
        <div style={{fontSize:T.fs.xxs,color:T.textMuted,lineHeight:1.5}}>
          시술 상품 관리에서 등록한 시술 항목과 가격이 자동 반영됩니다.
        </div>
      </div>
    </div>}
  </div>;
}

export default AdminAISettings
