import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { fromDb } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone } from '../../lib/utils'
import I from '../common/I'


// 지점 매핑은 data.branches에서 동적 생성 (하드코딩 제거)


function AdminInbox({ sb, branches, data, onRead, onChatOpen, userBranches=[], isMaster=false, pendingChat=null, onPendingChatDone, setPendingOpenRes, setPage }) {
  const isMobile = window.innerWidth < 768;
  const CH_ICON = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T"};
  const CH_NAME = {naver:"네이버톡톡",kakao:"카카오",instagram:"인스타",whatsapp:"왓츠앱",telegram:"텔레그램"};
  const CH_COLOR = {naver:"#03C75A",kakao:"#F9E000",instagram:"#E1306C",whatsapp:"#128C7E",telegram:"#2AABEE"};
  const CH_LABEL = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T"};
  const getGeminiKey = () => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";

  const [msgs, setMsgs] = useState([]);
  const [sel, setSel] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(true);
  // pendingChat: 예약 모달에서 넘어온 대화방 자동 선택
  useEffect(() => {
    if (pendingChat && msgs.length > 0 && !sel) {
      setSel({ user_id: pendingChat.user_id, channel: pendingChat.channel, account_id: pendingChat.account_id });
      if (onPendingChatDone) onPendingChatDone();
    }
  }, [pendingChat, msgs.length]);
  const [aiKoDraft, setAiKoDraft] = useState("");
  const [aiAutoChannels, setAiAutoChannels] = useState({});
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [names, setNames] = useState({});
  const convoEndRef = useRef(null);
  const inputAreaRef = useRef(null);
  const chatWrapRef = useRef(null);

  // 담당 지점 메시지만 표시 (owner/super는 userBranches에 전체 지점 포함)
  // data.branches에서 동적으로 계정 ID 매핑 생성
  const branchList = data?.branches || [];
  const _BR_ACC = {};
  const _ACC_NAME = {};
  branchList.forEach(b => {
    if (b.naverAccountId) { _BR_ACC[b.id] = b.naverAccountId; _ACC_NAME[b.naverAccountId] = b.short || b.name; }
    if (b.instagramAccountId) { _ACC_NAME[b.instagramAccountId] = b.short || b.name; }
  });
  const allowedIds = (userBranches||[]).map(b=>_BR_ACC[b]).filter(Boolean).map(String);

  // 메시지 로드 (캐시 방지용 _t 파라미터 추가)
  const loadingRef = useRef(false);
  const loadMsgs = useCallback(async () => {
    if (loadingRef.current) return; // 중복 호출 방지
    loadingRef.current = true;
    try {
      const r = await fetch(SB_URL+"/rest/v1/messages?order=created_at.desc&limit=300&select=*",{headers:{...sbHeaders,"Cache-Control":"no-cache"},cache:"no-store"});
      const d2 = await r.json();
      if (Array.isArray(d2)) {
        setMsgs(d2);
        const nm = {};
        d2.forEach(m => { if (m.user_name && !nm[m.user_id]) nm[m.user_id] = m.user_name; });
        if (Object.keys(nm).length > 0) setNames(prev => ({...prev,...nm}));
      }
    } catch(e){} finally{ loadingRef.current = false; setLoading(false); }
  }, []);

  useEffect(()=>{
    loadMsgs();
    // Realtime 구독
    let lastMsgRt = 0;
    const chName = "inbox_rt_"+Date.now();
    const ch = window._sbClient?.channel(chName)
      ?.on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},
        p=>{ if(p?.new) { lastMsgRt = Date.now(); setMsgs(prev=>prev.some(m=>m.id===p.new.id)?prev:[...prev,p.new]); if(p.new.user_name) setNames(prev=>({...prev,[p.new.user_id]:p.new.user_name})); }}
      )
      ?.on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},
        p=>{ if(p?.new?.id) { lastMsgRt = Date.now(); setMsgs(prev=>prev.map(m=>m.id===p.new.id?{...m,...p.new}:m)); }}
      )?.subscribe();
    const onVisible = () => { if(document.visibilityState==="visible") loadMsgs(); };
    document.addEventListener("visibilitychange", onVisible);
    return ()=>{
      document.removeEventListener("visibilitychange", onVisible);
      try{ch?.unsubscribe(); window._sbClient?.removeChannel(ch);}catch(e){}
    };
  }, []);

  // AI 자동답변 채널별 ON/OFF 로드
  const _parseSettings = (raw) => { try { return typeof raw==='string'?JSON.parse(raw):(raw||{}); } catch{ return {}; } };
  useEffect(()=>{
    fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",{headers:sbHeaders})
      .then(r=>r.json()).then(rows=>{
        const s = _parseSettings(rows?.[0]?.settings);
        setAiAutoChannels(s.ai_auto_reply_channels || {});
      }).catch(()=>{});
  },[]);
  const toggleAiChannel = async (ch) => {
    const prev = {...aiAutoChannels};
    const updated = {...prev, [ch]: !prev[ch]};
    setAiAutoChannels(updated);
    try {
      const r = await fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",{headers:sbHeaders});
      const rows = await r.json();
      const settings = _parseSettings(rows?.[0]?.settings);
      settings.ai_auto_reply_channels = updated;
      settings.ai_auto_reply_enabled = Object.values(updated).some(v=>v);
      await fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb",{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(settings)})});
    } catch(e){ setAiAutoChannels(prev); }
  };

  useEffect(()=>{ convoEndRef.current?.scrollIntoView({behavior:"smooth"}); },[sel, msgs.length]);

  const [msgSearch, setMsgSearch] = useState("");

  // 채팅 user_id → 예약 매핑 (active 예약 우선)
  const chatResMap = useMemo(()=>{
    const m={};
    const SKIP=["cancelled","naver_cancelled","naver_changed"];
    (data?.reservations||[]).forEach(r=>{
      if(!r.chatUserId||!r.chatChannel) return;
      if(SKIP.includes(r.status)) return;
      const key=r.chatChannel+"_"+r.chatUserId;
      if(!m[key]||r.date>m[key].date) m[key]=r;
    });
    return m;
  },[data?.reservations]);

  const threads = useMemo(()=>{
    const map = {};
    msgs.forEach(m=>{
      const _socialCh=["whatsapp","telegram","instagram","kakao"];
      if(allowedIds.length>0 && m.account_id && m.account_id!=="unknown" && !allowedIds.includes(String(m.account_id)) && !_socialCh.includes(m.channel)) return;
      const key=(m.channel||"naver")+"_"+m.user_id;
      if(!map[key]||new Date(m.created_at)>new Date(map[key].created_at)) map[key]=m;
    });
    let list = Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(msgSearch.trim()){
      const q=msgSearch.trim().toLowerCase();
      const matchUids=new Set();
      msgs.forEach(m=>{
        if((m.user_name||"").toLowerCase().includes(q)||(m.message_text||"").toLowerCase().includes(q))
          matchUids.add((m.channel||"naver")+"_"+m.user_id);
      });
      list=list.filter(m=>matchUids.has((m.channel||"naver")+"_"+m.user_id));
    }
    return list;
  },[msgs, allowedIds.length, msgSearch]);

  const convo = useMemo(()=>{
    if(!sel) return [];
    return msgs.filter(m=>m.user_id===sel.user_id&&(m.channel||"naver")===sel.channel)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  },[msgs, sel?.user_id, sel?.channel]);

  const unread = (uid,ch)=>msgs.filter(m=>m.user_id===uid&&(m.channel||"naver")===ch&&!m.is_read&&m.direction==="in").length;
  const totalUnread = threads.reduce((acc,m)=>acc+unread(m.user_id,m.channel||"naver"),0);

  const getDisplayName = (m) => {
    if(!m) return "고객";
    const uid = m.user_id;
    if(names[uid]) return names[uid];
    const withName = msgs.find(x=>x.user_id===uid&&x.user_name&&x.user_name.trim());
    if(withName) return withName.user_name;
    const uids=[...new Set(threads.map(t=>t.user_id))];
    return "고객"+(uids.indexOf(uid)+1||"");
  };

  const markRead = async(uid)=>{
    const unreadCount = msgs.filter(m=>m.user_id===uid&&!m.is_read&&m.direction==="in").length;
    await fetch(SB_URL+"/rest/v1/messages?user_id=eq."+uid+"&is_read=eq.false",
      {method:"PATCH",headers:{...sbHeaders,Prefer:"return=minimal"},body:JSON.stringify({is_read:true})});
    setMsgs(prev=>prev.map(m=>m.user_id===uid?{...m,is_read:true}:m));
    if(onRead && unreadCount > 0) onRead(unreadCount);
  };

  const selectThread = (m)=>{
    const ch=m.channel||"naver";
    setSel({user_id:m.user_id,channel:ch,account_id:m.account_id});
    setReply("");
    markRead(m.user_id);
    if(onChatOpen) onChatOpen(true);
  };

  const sendMsg = async(text)=>{
    if(!sel||!text.trim()) return;
    setSending(true);
    try{
      const accId = sel.account_id && sel.account_id!=="unknown" ? sel.account_id : (allowedIds[0]||Object.keys(_ACC_AUTH)[0]);
      const r = await fetch(SB_URL+"/rest/v1/send_queue",{
        method:"POST",headers:{...sbHeaders,Prefer:"return=representation"},
        body:JSON.stringify({account_id:accId,user_id:sel.user_id,message_text:text,status:"pending",channel:sel.channel||"naver"})
      });
      if(r.ok){
        setMsgs(prev=>[...prev,{user_id:sel.user_id,channel:sel.channel,direction:"out",account_id:accId,message_text:text,is_read:true,created_at:new Date().toISOString()}]);
        setReply("");
      }
    }finally{setSending(false);}
  };

  // 시술 가격표 텍스트 생성
  const svcPriceText = React.useMemo(()=>{
    const svcs=(data?.services||[]).filter(s=>s.name&&(s.priceF||s.priceM));
    if(!svcs.length) return "";
    const cats=data?.cats||[];
    const catMap={};
    svcs.forEach(s=>{
      const cat=cats.find(c=>c.id===s.cat);
      const catName=cat?.name||"기타";
      if(!catMap[catName]) catMap[catName]=[];
      catMap[catName].push(s);
    });
    // 대표 시술만 선별 (고객 문의 빈도 높은 카테고리 우선)
    const priorityCats=['브라질리언','케어','바디','페이셜','에너지테라피','PKG (패키지)'];
    const lines=[];
    const fmt=s=>{const p=[];if(s.priceF)p.push("여"+Number(s.priceF).toLocaleString());if(s.priceM)p.push("남"+Number(s.priceM).toLocaleString());return `${s.name}: ${p.join("/")}`;};
    priorityCats.forEach(catName=>{
      const items=catMap[catName];
      if(!items) return;
      lines.push(`[${catName}]`);
      items.slice(0,4).forEach(s=>lines.push("  "+fmt(s)));
      if(items.length>4) lines.push(`  ...외 ${items.length-4}개`);
    });
    return lines.join("\n");
  },[data?.services,data?.cats]);

  // 고객 패키지 잔여 조회 헬퍼
  const findCustPkgInfo = useCallback((userId)=>{
    const custName = getDisplayName({user_id:userId});
    if(!custName || custName.startsWith("고객")) return "";
    // 고객 이름으로 customers 매칭
    const customers = data?.customers || [];
    const matched = customers.filter(c => c.name && custName.includes(c.name));
    if(matched.length===0) return "";
    const pkgs = data?.custPackages || [];
    const lines = [];
    matched.forEach(c => {
      const cp = pkgs.filter(p => p.customer_id===c.id && (p.total_count-p.used_count)>0);
      if(cp.length>0){
        lines.push(`[${c.name}님 보유 다회권]`);
        cp.forEach(p => {
          const remain = p.total_count - p.used_count;
          lines.push(`- ${p.service_name||"시술"}: 총 ${p.total_count}회 중 ${remain}회 남음`);
        });
      }
    });
    return lines.length>0 ? lines.join("\n") : "";
  },[data?.customers, data?.custPackages, msgs, names]);

  // reply 변경 시 textarea 높이 자동 조정
  React.useEffect(()=>{
    const adjust=()=>{const ta=document.getElementById('bliss-reply-ta');if(ta){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,200)+'px';}};
    adjust();
    const t=setTimeout(adjust,50);
    return ()=>clearTimeout(t);
  },[reply]);

  const genAI = async()=>{
    if(!sel||convo.length===0){alert("대화가 선택되지 않았습니다.");return;}
    const key=getGeminiKey();
    if(!key){alert("AI API 키가 설정되지 않았습니다. 관리설정에서 Gemini 키를 입력하세요.");return;}
    setAiLoading(true); setAiKoDraft("");
    try{
      const lastIn=[...convo].reverse().find(m=>m.direction==="in");
      const hasKo=lastIn?/[가-힣]/.test(lastIn.message_text):true;
      const langName=hasKo?"한국어":"영어";
      const lastMsgs=convo.slice(-6).map(m=>(m.direction==="in"?"고객":"직원")+": "+m.message_text).join("\n");

      // 자동 응대 프롬프트 (AI 설정에서 관리)
      const chatPrompt = window.__aiChatPrompt || localStorage.getItem("bliss_ai_chat_prompt") || "";
      const chatCtx = chatPrompt ? `\n\n[응대 지침]\n${chatPrompt}` : "";

      // 시술 가격표
      const priceCtx = svcPriceText ? `\n\n[시술 가격표]\n${svcPriceText}` : "";

      // 고객 패키지 잔여 정보
      const pkgInfo = findCustPkgInfo(sel.user_id);
      const pkgCtx = pkgInfo ? `\n\n[이 고객의 다회권 정보]\n${pkgInfo}` : "";

      const prompt=`${chatPrompt || "당신은 뷰티샵 예약 접수 및 상담 직원입니다."}${priceCtx}${pkgCtx}\n\n[가격 안내 규칙]\n- 가격표에 "여X/남Y" 둘 다 있으면 반드시 둘 다 안내 (한쪽만 말하지 말 것)\n- 가격표에 한쪽만 있으면 그 한쪽만 안내\n- 가격표에 없는 숫자는 절대 만들어내지 말 것. 모르면 "확인 후 안내드리겠습니다"\n\n대화:\n${lastMsgs}\n\n고객 마지막 메시지에 친절하게 답변하세요. JSON만 출력:\n{"reply":"${langName}로 작성한 답변","ko":"한국어 번역"}`;
      const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+key,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
      if(res.status===429){alert("AI 요청 한도 초과. 잠시 후 시도해주세요.");return;}
      if(!res.ok){const err=await res.text();alert("AI API 오류: "+res.status);console.error("[genAI] API error:",err);return;}
      const dd=await res.json();
      let raw=(dd.candidates?.[0]?.content?.parts?.[0]?.text||"").replace(/```json|```/g,"").trim();
      if(!raw){alert("AI 응답이 비어있습니다.");return;}
      try{const p=JSON.parse(raw);if(p.reply){setReply(p.reply);setAiKoDraft(p.ko||"");}else{setReply(raw);}}
      catch{setReply(raw);}
    }catch(e){console.error("[genAI]",e);alert("AI 오류: "+e.message);}finally{setAiLoading(false);}
  };

  const sendTranslated = async()=>{
    if(!reply.trim()||!sel) return;
    setSending(true);
    try{
      const lastIn = [...convo].reverse().find(m=>m.direction==="in");
      let text = reply.trim();
      if(lastIn){
        // 로컬 언어 감지 (한글 유니코드 범위)
        const hasKorean = /[\uAC00-\uD7A3\u1100-\u11FF]/.test(lastIn.message_text);
        const lang = hasKorean ? "ko" : "en"; // 한글 없으면 영어로 간주
        if(lang!=="ko"){
          const tRes=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+getGeminiKey(),{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({contents:[{parts:[{text:"Translate the following Korean text to "+lang+" naturally. Output translation only: \""+reply+"\""}]}]})
          });
          if(tRes.status===429){ await sendMsg(reply.trim()); return; }
          const td=await tRes.json();
          text=td.candidates?.[0]?.content?.parts?.[0]?.text||reply;
        }
      }
      await sendMsg(text);
    }finally{setSending(false);}
  };

  const fmtTime=(ts)=>{
    const d=new Date(ts),now=new Date(),diff=now-d;
    const isToday=d.toDateString()===now.toDateString();
    if(diff<60000) return "방금";
    if(diff<3600000) return Math.floor(diff/60000)+"분 전";
    if(isToday) return d.getHours()+":"+String(d.getMinutes()).padStart(2,"0");
    return (d.getMonth()+1)+"."+(d.getDate());
  };
  const branchName=(m)=>_ACC_NAME[m?.account_id]||"";

  // 모바일 목록 렌더 (인스타 스타일)
  if(isMobile && !sel) return (
    <div style={{display:"flex",flexDirection:"column",background:"#fff",minHeight:"60vh"}}>
      <div style={{padding:"16px 16px 8px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontWeight:800,fontSize:18,color:T.text}}>메시지</span>
          {totalUnread>0&&<span style={{background:T.danger,color:"#fff",borderRadius:10,fontSize:11,fontWeight:700,padding:"2px 8px"}}>{totalUnread}</span>}
        </div>
        <button onClick={()=>setShowAiSettings(v=>!v)} style={{background:Object.values(aiAutoChannels).some(v=>v)?"#7C3AED":"none",color:Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted,border:"1px solid "+(Object.values(aiAutoChannels).some(v=>v)?"#7C3AED":T.border),borderRadius:6,cursor:"pointer",padding:"3px 8px",fontSize:11,fontWeight:600}}>🤖 AI</button>
      </div>
      {showAiSettings&&<div style={{padding:"10px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
        <div style={{fontSize:11,fontWeight:600,color:"#7C3AED",marginBottom:8}}>AI 자동대답 채널 설정</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {[["naver","N 네이버","#03C75A"],["instagram","I 인스타","#E1306C"],["whatsapp","W 왓츠앱","#128C7E"],["kakao","K 카카오","#F9E000"]].map(([ch,label,clr])=>(
            <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr+"18":"#fff",color:aiAutoChannels[ch]?clr:T.gray500}}>{label} {aiAutoChannels[ch]?"ON":"OFF"}</button>
          ))}
        </div>
      </div>}
      <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border}}>
        <input value={msgSearch} onChange={e=>setMsgSearch(e.target.value)} placeholder="이름, 메시지 검색..." style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+T.border,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
      </div>
      <div style={{overflowY:"auto"}}>
        {loading?<div style={{padding:40,textAlign:"center",color:T.textMuted}}>로딩 중...</div>
        :threads.length===0?<div style={{padding:40,textAlign:"center",color:T.textMuted}}>{msgSearch?"검색 결과 없음":"메시지 없음"}</div>
        :threads.map(m=>{
          const ch=m.channel||"naver"; const key=ch+"_"+m.user_id;
          const uc=unread(m.user_id,ch);
          const name=getDisplayName(m); const branch=branchName(m);
          const initials=name.slice(0,2);
          const isOut=m.direction==="out";
          return <div key={key} onClick={()=>selectThread(m)}
            style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid #f0f0f0",background:"#fff",cursor:"pointer"}}>
            {/* 아바타 */}
            <div style={{position:"relative",flexShrink:0}}>
              <div style={{width:56,height:56,borderRadius:"50%",
                background:"linear-gradient(135deg,"+CH_COLOR[ch]+"66,"+CH_COLOR[ch]+"33)",
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:20,fontWeight:700,color:CH_COLOR[ch],
                border:uc>0?"2.5px solid "+T.primary:"2.5px solid transparent",
                boxSizing:"border-box"}}>
                {ch==="naver"?initials:ch==="whatsapp"?"💬":ch==="telegram"?"✈":ch==="instagram"?"📷":initials}
              </div>
              <div style={{position:"absolute",bottom:1,right:1,width:18,height:18,borderRadius:"50%",
                background:CH_COLOR[ch],border:"2px solid #fff",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontWeight:800}}>
                {CH_LABEL[ch]}
              </div>
            </div>
            {/* 텍스트 */}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                <span style={{fontWeight:uc>0?700:600,fontSize:16,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>
                  {name}{branch?" · "+branch:""}
                </span>
                <span style={{fontSize:12,color:uc>0?T.primary:"#999",fontWeight:uc>0?600:400,flexShrink:0,marginLeft:6}}>{fmtTime(m.created_at)}</span>
              </div>
              <div style={{fontSize:12,color:"#aaa",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {(()=>{const ph=msgs.filter(x=>x.user_id===m.user_id&&x.cust_phone).map(x=>x.cust_phone)[0];return ph||""})()}
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:14,color:uc>0?"#111":"#555",fontWeight:uc>0?500:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                  {isOut?"나: ":""}{m.message_text}
                </span>
                {uc>0&&<div style={{width:20,height:20,borderRadius:"50%",background:T.primary,color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:4}}>{uc}</div>}
              </div>
              {(()=>{const res=chatResMap[key];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<div style={{display:"flex",alignItems:"center",gap:4,marginTop:3}}><span style={{fontSize:10,fontWeight:700,color:clr,background:clr+"18",borderRadius:3,padding:"1px 6px"}}>📅 {st} {res.date?.slice(5)} {res.time}</span></div>;})()}
            </div>
          </div>;
        })}
      </div>
    </div>
  );

  // 모바일 채팅창 렌더
  if(isMobile && sel) return (
    <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",flexDirection:"column",background:"#f5f5f7"}}>
      {/* 헤더 */}
      <div style={{padding:"12px 16px",borderBottom:"1px solid "+T.border,background:T.bgCard,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <button onClick={()=>{ setSel(null); if(onChatOpen) onChatOpen(false); }} style={{background:"none",border:"none",cursor:"pointer",color:T.primary,padding:"4px 8px 4px 0"}}><I name="arrowL" size={20}/></button>
        <span style={{fontSize:18}}>{CH_ICON[sel.channel]}</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:T.fw.bolder,fontSize:16}}>{getDisplayName(convo[0]||{user_id:sel.user_id})}{branchName(convo[0])?" · "+branchName(convo[0]):""}</div>
          <div style={{fontSize:12,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}{(convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone)?" · "+(convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone):""}</div>
        </div>
        {(()=>{const res=chatResMap[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes(res);setPage("timeline");setSel(null);}}} style={{fontSize:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>📅{st}</button>;})()}
        <button onClick={genAI} disabled={aiLoading} style={{padding:"5px 12px",background:T.primary,color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600}}>{aiLoading?"...":"✨ AI"}</button>
      </div>
      {/* 메시지 */}
      <div style={{flex:1,overflowY:"auto",padding:"16px 16px 4px",display:"flex",flexDirection:"column",gap:10,WebkitOverflowScrolling:"touch",background:"#f5f5f7"}}>
        {convo.map((m,i)=>{
          if(m.direction==="system") return null;
          const isOut=m.direction==="out";
          return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:8}}>
            {!isOut&&<div style={{width:28,height:28,borderRadius:14,background:T.primaryHover,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{CH_ICON[m.channel||"naver"]}</div>}
            <div style={{maxWidth:"75%"}}>
              <div style={{padding:"10px 14px",borderRadius:isOut?"16px 16px 4px 16px":"16px 16px 16px 4px",background:isOut?T.primary:"#fff",color:isOut?"#fff":T.text,fontSize:16,lineHeight:1.5,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                {m.message_text}
                {m.translated_text&&<div style={{marginTop:5,paddingTop:5,borderTop:isOut?"1px solid rgba(255,255,255,0.3)":"1px solid rgba(0,0,0,0.1)",fontSize:12,color:isOut?"rgba(255,255,255,0.7)":"rgba(0,0,0,0.5)"}}>🔤 {m.translated_text}</div>}
              </div>
              <div style={{fontSize:10,color:T.textMuted,marginTop:3,textAlign:isOut?"right":"left"}}>{m.is_ai&&<span style={{background:"#7C3AED",color:"#fff",borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:700,marginRight:4}}>AI</span>}{fmtTime(m.created_at)}</div>
            </div>
          </div>;
        })}
        <div ref={convoEndRef}/>
      </div>
      {/* 입력창 */}
      <div style={{background:"transparent",padding:"8px 12px 12px",flexShrink:0}}>
        <div style={{display:"flex",gap:6,marginBottom:6}}>
          <button onClick={genAI} disabled={aiLoading} style={{padding:"4px 10px",background:"#f0f4ff",color:"#4338ca",border:"1px solid #c7d2fe",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600}}>{aiLoading?"⏳":"✨ AI"}</button>
          <button onClick={()=>setAutoTranslate(v=>!v)} style={{padding:"4px 10px",background:autoTranslate?"#166534":"#f0fdf4",color:autoTranslate?"#fff":"#166534",border:"1px solid #bbf7d0",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600}}>🌐 자동번역 {autoTranslate?"ON":"OFF"}</button>
        </div>
        {aiKoDraft&&<div style={{fontSize:12,color:"#4338ca",padding:"4px 8px",background:"#eff6ff",borderRadius:6,marginBottom:6,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
        <div style={{position:"relative"}}>
          <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); setAiKoDraft(""); }}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();autoTranslate?sendTranslated():sendMsg(reply.trim());}}}
            placeholder="메시지 입력..."
            style={{width:"100%",padding:"10px 52px 10px 14px",border:"1px solid "+T.border,borderRadius:12,fontSize:15,resize:"none",minHeight:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"22px",overflowY:"auto",boxSizing:"border-box",WebkitAppearance:"none",appearance:"none"}}
          />
          {(reply.trim()||sending)&&<button onClick={()=>autoTranslate?sendTranslated():sendMsg(reply.trim())} disabled={sending||!reply.trim()}
            style={{position:"absolute",right:8,bottom:6,width:32,height:32,background:"#7C3AED",color:"#fff",border:"none",borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {sending?<span style={{fontSize:12}}>⏳</span>:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
          </button>}
        </div>
      </div>
    </div>
  );

  // 데스크탑 렌더
  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden",background:T.bg,borderRadius:12,border:"1px solid "+T.border}}>
      {/* 목록 */}
      <div style={{width:300,minWidth:300,borderRight:"1px solid "+T.border,display:"flex",flexDirection:"column",background:T.bgCard,overflow:"hidden",flexShrink:0}}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontWeight:T.fw.bolder,fontSize:T.fs.md}}>메시지함</span>
            {totalUnread>0&&<span style={{background:T.danger,color:"#fff",borderRadius:10,fontSize:11,fontWeight:700,padding:"2px 7px"}}>{totalUnread}</span>}
          </div>
          <button onClick={()=>setShowAiSettings(v=>!v)} style={{background:Object.values(aiAutoChannels).some(v=>v)?"#7C3AED":"none",color:Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted,border:"1px solid "+(Object.values(aiAutoChannels).some(v=>v)?"#7C3AED":T.border),borderRadius:6,cursor:"pointer",padding:"3px 8px",fontSize:11,fontWeight:600}}>🤖 AI</button>
        </div>
        {showAiSettings&&<div style={{padding:"10px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#7C3AED",marginBottom:8}}>AI 자동대답 채널 설정</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {[["naver","N 네이버","#03C75A"],["instagram","I 인스타","#E1306C"],["whatsapp","W 왓츠앱","#128C7E"],["kakao","K 카카오","#F9E000"]].map(([ch,label,clr])=>(
              <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr+"18":"#fff",color:aiAutoChannels[ch]?clr:T.gray500}}>{label} {aiAutoChannels[ch]?"ON":"OFF"}</button>
            ))}
          </div>
        </div>}
        <div style={{padding:"8px 10px",borderBottom:"1px solid "+T.border}}>
          <input value={msgSearch} onChange={e=>setMsgSearch(e.target.value)} placeholder="이름, 메시지 검색..." style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid "+T.border,fontSize:12,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {loading?<div style={{padding:20,textAlign:"center",color:T.textMuted}}>로딩 중...</div>
          :threads.length===0?<div style={{padding:20,textAlign:"center",color:T.textMuted}}>{msgSearch?"검색 결과 없음":"메시지 없음"}</div>
          :threads.map(m=>{
            const ch=m.channel||"naver"; const key=ch+"_"+m.user_id;
            const isS=sel?.user_id===m.user_id&&sel?.channel===ch;
            const uc=unread(m.user_id,ch);
            const name=getDisplayName(m); const branch=branchName(m);
            const initials=name.slice(0,1);
            return <div key={key} onClick={()=>selectThread(m)}
              style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,
                background:isS?"rgba(124,58,237,0.06)":"transparent",
                borderBottom:"1px solid "+T.border}}>
              {/* 아바타 */}
              <div style={{position:"relative",flexShrink:0}}>
                <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,"+CH_COLOR[ch]+"44,"+CH_COLOR[ch]+"22)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:CH_COLOR[ch],
                  border:uc>0?"2px solid "+T.primary:"2px solid transparent"}}>
                  {ch==="naver"?initials:ch==="whatsapp"?"💬":ch==="telegram"?"✈":ch==="instagram"?"📷":initials}
                </div>
                <div style={{position:"absolute",bottom:0,right:0,width:16,height:16,borderRadius:"50%",
                  background:CH_COLOR[ch],border:"2px solid #fff",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff",fontWeight:800}}>
                  {CH_LABEL[ch]}
                </div>
              </div>
              {/* 텍스트 */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <span style={{fontWeight:uc>0?800:600,fontSize:14,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>
                    {name}{branch?" · "+branch:""}
                  </span>
                  <span style={{fontSize:11,color:uc>0?T.primary:T.textMuted,fontWeight:uc>0?600:400,flexShrink:0,marginLeft:4}}>{fmtTime(m.created_at)}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,color:uc>0?T.text:T.textMuted,fontWeight:uc>0?500:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:190}}>
                    {m.direction==="out"?"나: ":""}{m.message_text}
                  </span>
                  {uc>0&&<div style={{width:20,height:20,borderRadius:"50%",background:T.primary,color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:4}}>{uc>9?"9+":uc}</div>}
                </div>
                {(()=>{const res=chatResMap[key];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<div style={{marginTop:3}}><span style={{fontSize:10,fontWeight:700,color:clr,background:clr+"18",borderRadius:3,padding:"1px 6px"}}>📅 {st} {res.date?.slice(5)} {res.time}</span></div>;})()}
              </div>
            </div>;
          })}
        </div>
      </div>
      {/* 채팅창 데스크탑 */}
      <div style={{flex:1,display:sel?"flex":"none",flexDirection:"column",background:"#f8f9fb"}}>
        {sel&&<>
          <div style={{padding:"12px 16px",borderBottom:"1px solid "+T.border,background:T.bgCard,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>{CH_ICON[sel.channel]}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm}}>{getDisplayName(convo[0]||{user_id:sel.user_id})}{branchName(convo[0])?" · "+branchName(convo[0]):""}</div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}</div>
            </div>
            {(()=>{const res=chatResMap[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes(res);setPage("timeline");}}} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>📅 {st} {res.date?.slice(5)} {res.time} →</button>;})()}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
            {convo.map((m,i)=>{
              if(m.direction==="system") return null;
              const isOut=m.direction==="out";
              return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:8}}>
                {!isOut&&<div style={{width:28,height:28,borderRadius:14,background:T.primaryHover,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{CH_ICON[m.channel||"naver"]}</div>}
                <div style={{maxWidth:"70%"}}>
                  <div style={{padding:"10px 14px",borderRadius:isOut?"16px 16px 4px 16px":"16px 16px 16px 4px",background:isOut?T.primary:"#fff",color:isOut?"#fff":T.text,fontSize:16,lineHeight:1.5,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                    {m.message_text}
                    {m.translated_text&&<div style={{marginTop:5,paddingTop:5,borderTop:isOut?"1px solid rgba(255,255,255,0.3)":"1px solid rgba(0,0,0,0.1)",fontSize:11,color:isOut?"rgba(255,255,255,0.7)":"rgba(0,0,0,0.55)"}}>🔤 {m.translated_text}</div>}
                  </div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:3,textAlign:isOut?"right":"left"}}>{m.is_ai&&<span style={{background:"#7C3AED",color:"#fff",borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:700,marginRight:4}}>AI</span>}{fmtTime(m.created_at)}</div>
                </div>
              </div>;
            })}
            <div ref={convoEndRef}/>
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid "+T.border,background:T.bgCard}}>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button onClick={genAI} disabled={aiLoading} style={{padding:"4px 10px",background:"#f0f4ff",color:"#4338ca",border:"1px solid #c7d2fe",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>{aiLoading?"⏳":"✨ AI"}</button>
              <button onClick={()=>setAutoTranslate(v=>!v)} style={{padding:"4px 10px",background:autoTranslate?"#166534":"#f0fdf4",color:autoTranslate?"#fff":"#166534",border:"1px solid #bbf7d0",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>🌐 자동번역 {autoTranslate?"ON":"OFF"}</button>
            </div>
            {aiKoDraft&&<div style={{fontSize:11,color:"#4338ca",padding:"3px 8px",background:"#eff6ff",borderRadius:6,marginBottom:4,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
            <div style={{display:"flex",gap:8}}>
              <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); }}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();autoTranslate?sendTranslated():sendMsg(reply.trim());}}}
                placeholder="메시지 입력..."
                style={{flex:1,padding:"10px 14px",border:"1px solid "+T.border,borderRadius:8,fontSize:15,resize:"none",minHeight:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"22px",overflowY:"auto"}}
              />
              <button onClick={()=>autoTranslate?sendTranslated():sendMsg(reply.trim())} disabled={sending||!reply.trim()}
                style={{width:44,height:44,alignSelf:"flex-end",flexShrink:0,background:reply.trim()?"#7C3AED":"#e5e7eb",color:reply.trim()?"#fff":"#9ca3af",border:"none",borderRadius:"50%",cursor:reply.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {sending?<span>⏳</span>:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
              </button>
            </div>
          </div>
        </>}
        {!sel&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:T.textMuted}}>
          <I name="msgSq" size={40}/><div style={{marginTop:12,fontSize:T.fs.sm}}>대화를 선택하세요</div>
        </div>}
      </div>
    </div>
  );
}

export default AdminInbox
