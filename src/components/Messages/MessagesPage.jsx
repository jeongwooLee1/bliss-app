import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, matchAllTokens } from '../../lib/sb'
import { fromDb } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, useSessionState } from '../../lib/utils'
import I from '../common/I'
import { ChannelLogo } from './channelIcons'


// 지점 매핑은 data.branches에서 동적 생성 (하드코딩 제거)


function AdminInbox({ sb, branches, data, onRead, onChatOpen, userBranches=[], isMaster=false, pendingChat=null, onPendingChatDone, setPendingOpenRes, setPage }) {
  const isMobile = window.innerWidth < 768;
  const CH_ICON = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T"};
  const CH_NAME = {naver:"네이버톡톡",kakao:"카카오",instagram:"인스타",whatsapp:"왓츠앱",telegram:"텔레그램"};
  const CH_COLOR = {naver:"#03C75A",kakao:"#F9E000",instagram:"#E1306C",whatsapp:"#128C7E",telegram:"#2AABEE"};
  const CH_LABEL = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T"};
  const getGeminiKey = () => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";

  const [msgs, setMsgs] = useState([]);
  // 선택된 대화방 {channel,user_id} — 새로고침 시 유지
  const [sel, setSel] = useSessionState("msg_sel", null);
  const [reply, setReply] = useState("");
  // AI로 생성된 답변인지 추적 (is_ai 플래그용)
  const [replyIsAi, setReplyIsAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBookLoading, setAiBookLoading] = useState(false);
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
  const [aiSchedule, setAiSchedule] = useState({enabled:false,start:"10:00",end:"22:00"}); // 전채널 공통
  // IG 계정이 brancheas 테이블에 등록 안 된 경우를 위한 override 매핑: {igAccountId: branchId}
  // 예: 공용 "하우스왁싱 서울" IG 계정을 강남본점에 매핑
  const [igBranchOverride, setIgBranchOverride] = useState({});
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [names, setNames] = useState({});
  const convoEndRef = useRef(null);
  const inputAreaRef = useRef(null);
  const chatWrapRef = useRef(null);

  // 담당 지점 메시지만 표시 (owner/super는 userBranches에 전체 지점 포함)
  // data.branches에서 동적으로 계정 ID 매핑 생성
  const branchList = data?.branches || [];
  const _BR_ACC = {};          // branchId → naver account id
  const _BR_IG  = {};          // branchId → instagram account id
  const _BR_WA  = {};          // branchId → whatsapp phone_number_id
  const _ACC_NAME = {};
  const _ACC_BID = {};         // account id → branchId (필터 역추적용)
  branchList.forEach(b => {
    if (b.naverAccountId)     { _BR_ACC[b.id] = b.naverAccountId;     _ACC_NAME[b.naverAccountId]     = b.short || b.name; _ACC_BID[b.naverAccountId]     = b.id; }
    if (b.instagramAccountId) { _BR_IG[b.id]  = b.instagramAccountId; _ACC_NAME[b.instagramAccountId] = b.short || b.name; _ACC_BID[b.instagramAccountId] = b.id; }
    if (b.whatsappAccountId)  { _BR_WA[b.id]  = b.whatsappAccountId;  _ACC_NAME[b.whatsappAccountId]  = b.short || b.name; _ACC_BID[b.whatsappAccountId]  = b.id; }
  });
  // IG branch override: branches.instagram_account_id 로 못 잡는 추가 IG 계정을 특정 지점에 매핑
  // (예: 공용 "하우스왁싱 서울" IG 계정을 강남본점에 매핑)
  const _IG_EXTRA_BY_BID = {};  // bid → [extra ig account_id, ...]
  Object.entries(igBranchOverride || {}).forEach(([igId, bid]) => {
    if (!igId || !bid) return;
    const br = branchList.find(b => b.id === bid);
    const brName = br ? (br.short || br.name) : "";
    if (!_ACC_NAME[igId]) _ACC_NAME[igId] = brName || _ACC_NAME[igId] || "";
    if (!_ACC_BID[igId]) _ACC_BID[igId] = bid;
    (_IG_EXTRA_BY_BID[bid] ||= []).push(String(igId));
  });

  // userBranches + 연계된 지점들까지 확장 (id_ebgbebctt3 Phase 2)
  const linkedBranchIds = useMemo(() => {
    const set = new Set(userBranches || []);
    (data?.branchGroups || []).forEach(g => {
      const gb = g.branch_ids || [];
      if (gb.some(b => set.has(b))) gb.forEach(b => set.add(b));
    });
    return [...set];
  }, [userBranches, data?.branchGroups]);

  // 필터 모드: 'mine'(내 지점 + 연계, 디폴트) | 'all'(전지점)
  const [branchFilter, setBranchFilter] = useSessionState("msg_branch_filter", "mine");

  // 선택된 필터에 따른 branch id 집합
  const activeBids = useMemo(() => {
    if (branchFilter === 'all') return branchList.map(b => b.id);
    // 'mine' = userBranches + 연계 지점
    return linkedBranchIds;
  }, [branchFilter, linkedBranchIds, branchList]);

  const allowedIds = activeBids
    .flatMap(bid => [_BR_ACC[bid], _BR_IG[bid], _BR_WA[bid], ...(_IG_EXTRA_BY_BID[bid] || [])])
    .filter(Boolean)
    .map(String);

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
        p=>{ if(p?.new) {
          lastMsgRt = Date.now();
          setMsgs(prev=>{
            // 1) 같은 id 이미 있으면 skip (id로 dedup)
            if (prev.some(m=>m.id===p.new.id)) return prev;
            // 2) 로컬 optimistic echo (id 없음)와 매칭되면 실제 row로 교체 — 중복 말풍선 방지
            //    (sendMsg 함수가 id 없이 direction='out' 메시지를 prev에 즉시 추가함)
            if (p.new.direction === 'out') {
              const idx = prev.findIndex(m => !m.id && m.direction==='out'
                && m.user_id===p.new.user_id
                && m.channel===p.new.channel
                && (m.message_text||'').slice(0,40) === (p.new.message_text||'').slice(0,40));
              if (idx >= 0) {
                const next = [...prev]; next[idx] = p.new; return next;
              }
            }
            return [...prev, p.new];
          });
          if(p.new.user_name) setNames(prev=>({...prev,[p.new.user_id]:p.new.user_name}));
        }}
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
        // 구 per-channel 스케줄 → 단일 스케줄 마이그레이션
        const _sc = s.ai_auto_reply_schedule || {};
        if (_sc && typeof _sc === 'object' && (_sc.naver || _sc.instagram || _sc.whatsapp)) {
          const _first = _sc.naver || _sc.instagram || _sc.whatsapp || {};
          setAiSchedule({enabled:!!_first.enabled,start:_first.start||"10:00",end:_first.end||"22:00"});
        } else {
          setAiSchedule({enabled:!!_sc.enabled,start:_sc.start||"10:00",end:_sc.end||"22:00"});
        }
        // IG account_id → branch_id 오버라이드 매핑 (branches 미등록 IG 계정용)
        setIgBranchOverride(s.ig_branch_override || {});
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

  // AI 스케줄 저장 (전채널 공통 단일 스케줄)
  const saveAiSchedule = async (patch) => {
    const prev = {...aiSchedule};
    const updated = {...prev, ...patch};
    setAiSchedule(updated);
    try {
      const r = await fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb&select=settings",{headers:sbHeaders});
      const rows = await r.json();
      const settings = _parseSettings(rows?.[0]?.settings);
      settings.ai_auto_reply_schedule = updated;
      await fetch(SB_URL+"/rest/v1/businesses?id=eq.biz_khvurgshb",{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(settings)})});
    } catch(e){ setAiSchedule(prev); }
  };

  // AI 자동대답 채널 메타 (카카오 제외)
  const _chMeta = [["naver","N 네이버","#03C75A"],["instagram","I 인스타","#E1306C"],["whatsapp","W 왓츠앱","#128C7E"]];
  const _nowInWindow = (sc) => {
    if (!sc?.enabled) return true;
    const now=new Date(); const cur=now.getHours()*60+now.getMinutes();
    const toMin=s=>{const [h,m]=(s||"0:0").split(":").map(Number);return h*60+(m||0);};
    const st=toMin(sc.start||"00:00"), en=toMin(sc.end||"23:59");
    return st<=en ? (cur>=st&&cur<=en) : (cur>=st||cur<=en);
  };
  const scheduleInWindow = _nowInWindow(aiSchedule);

  useEffect(()=>{ convoEndRef.current?.scrollIntoView({behavior:"smooth"}); },[sel, msgs.length]);

  const [msgSearch, setMsgSearch] = useSessionState("msg_search", "");

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
      // 지점 필터: account_id가 있고 허용 목록에 없으면 제외 (네이버·인스타만)
      // 예외: account_id 없음/'unknown' → 지점 미지정 메시지라 그대로 노출
      // 왓츠앱은 전지점 공통이라 필터 우회
      const isWhatsApp = (m.channel||"") === "whatsapp";
      if(!isWhatsApp && allowedIds.length>0 && m.account_id && m.account_id!=="unknown" && !allowedIds.includes(String(m.account_id))) return;
      const key=(m.channel||"naver")+"_"+m.user_id;
      if(!map[key]||new Date(m.created_at)>new Date(map[key].created_at)) map[key]=m;
    });
    let list = Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(msgSearch.trim()){
      // 다토큰 AND: 각 토큰이 이름/메시지/전화 중 어느 필드에든 포함되면 매칭
      const matchUids=new Set();
      msgs.forEach(m=>{
        const hay = [m.user_name, m.message_text, m.cust_phone].filter(Boolean).join(" ");
        if (matchAllTokens(hay, msgSearch)) matchUids.add((m.channel||"naver")+"_"+m.user_id);
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

  // 🔗 채널별 "원본 플랫폼 바로가기" URL 계산
  //   네이버톡톡은 특정 대화 딥링크가 공개되지 않아 파트너센터 홈으로
  //   인스타는 비즈니스 DM 인박스, 왓츠앱은 메타 비즈니스 관리페이지
  const getChannelExternalLink = (selObj, convoMsgs) => {
    if (!selObj) return null;
    const ch = selObj.channel;
    if (ch === "naver") {
      // 네이버 파트너센터는 account_id(naver biz 계정) 기반 딥링크 지원
      const accId = selObj.account_id;
      const url = accId
        ? `https://partner.talk.naver.com/web/accounts/${accId}/chat`
        : "https://partner.talk.naver.com/";
      return { url, label: "네이버톡 열기", short: "네이버톡", color: "#03C75A" };
    }
    if (ch === "instagram") {
      // user_name이 IG 핸들이면 해당 프로필, 아니면 Meta 비즈니스 인박스
      const nm = (convoMsgs || []).map(m=>m.user_name).find(Boolean) || "";
      const handle = nm.startsWith("@") ? nm.slice(1) : (nm && !nm.includes(" ") ? nm : "");
      const url = handle ? `https://www.instagram.com/${handle}/` : "https://business.facebook.com/latest/inbox";
      return { url, label: "인스타 DM", short: "인스타", color: "#E1306C" };
    }
    if (ch === "whatsapp") {
      // user_id가 국제번호(예: 821079076106). wa.me 는 +없이 국제번호 그대로 받음
      const uid = (selObj.user_id || "").replace(/[^0-9]/g, "");
      if (uid && uid.length >= 10) {
        return { url: `https://wa.me/${uid}`, label: "왓츠앱 열기", short: "왓츠앱", color: "#25D366" };
      }
      return { url: "https://business.facebook.com/wa/manage/", label: "왓츠앱 비즈니스", short: "왓츠앱", color: "#25D366" };
    }
    if (ch === "kakao") {
      return { url: "https://center-pf.kakao.com/", label: "카톡채널 관리", short: "카톡", color: "#FAE100" };
    }
    return null;
  };
  const _extLink = getChannelExternalLink(sel, convo);

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
      // AI 생성 답변이면 서버 큐와 로컬 echo 모두에 is_ai=true 표시
      const body = {account_id:accId,user_id:sel.user_id,message_text:text,status:"pending",channel:sel.channel||"naver"};
      if (replyIsAi) body.is_ai = true;
      const r = await fetch(SB_URL+"/rest/v1/send_queue",{
        method:"POST",headers:{...sbHeaders,Prefer:"return=representation"},
        body:JSON.stringify(body)
      });
      if(r.ok){
        setMsgs(prev=>[...prev,{user_id:sel.user_id,channel:sel.channel,direction:"out",account_id:accId,message_text:text,is_read:true,is_ai:!!replyIsAi,created_at:new Date().toISOString()}]);
        setReply(""); setReplyIsAi(false);
      }
    }finally{setSending(false);}
  };

  // 시술 가격표 텍스트 생성 (DB의 services 전체 자동 반영, 카테고리 정렬)
  const svcPriceText = React.useMemo(()=>{
    const svcs=(data?.services||[]).filter(s=>s.name&&(s.priceF||s.priceM));
    if(!svcs.length) return "";
    const cats=(data?.cats||[]).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
    const catMap={};
    svcs.forEach(s=>{
      const cat=cats.find(c=>c.id===s.cat);
      const catName=cat?.name||"기타";
      if(!catMap[catName]) catMap[catName]=[];
      catMap[catName].push(s);
    });
    const lines=[];
    const fmt=s=>{const p=[];if(s.priceF)p.push("여"+Number(s.priceF).toLocaleString());if(s.priceM)p.push("남"+Number(s.priceM).toLocaleString());return `${s.name}: ${p.join("/")}`;};
    // 카테고리 순서대로 전부 포함
    const catOrder=[...cats.map(c=>c.name),"기타"];
    catOrder.forEach(catName=>{
      const items=catMap[catName];
      if(!items||!items.length) return;
      lines.push(`[${catName}]`);
      items.slice().sort((a,b)=>(a.sort||0)-(b.sort||0)).forEach(s=>lines.push("  "+fmt(s)));
    });
    return lines.join("\n");
  },[data?.services,data?.cats]);

  // 지점 정보 텍스트
  const branchText = React.useMemo(()=>{
    const brs=(data?.branches||[]).filter(b=>b.name);
    if(!brs.length) return "";
    return brs.map(b=>`- ${b.name}${b.address?` (${b.address})`:""}${b.phone?` ☎${b.phone}`:""}`).join("\n");
  },[data?.branches]);

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

      // 사용자가 AI 설정에 등록한 프롬프트
      const chatPrompt = window.__aiChatPrompt || localStorage.getItem("bliss_ai_chat_prompt") || "";
      // DB 기반 자동 컨텍스트 (가격표/지점/고객 다회권)
      const priceCtx = svcPriceText ? `\n\n[시술 가격표 — DB 실시간]\n${svcPriceText}` : "";
      const branchCtx = branchText ? `\n\n[지점 정보]\n${branchText}` : "";
      const pkgInfo = findCustPkgInfo(sel.user_id);
      const pkgCtx = pkgInfo ? `\n\n[이 고객의 다회권]\n${pkgInfo}` : "";
      // 매출 유도 + 왁서 성별 응대 정책 (고정 주입)
      const salesPolicyCtx = `

[출력 형식 — 매우 중요]
★ 네이버톡톡·인스타 DM·카톡·왓츠앱 등 채팅 플랫폼은 마크다운을 지원하지 않음.
★ ⛔ 볼드 표기 금지: 별표 두 개로 감싸는 표기(예: 별 별 단어 별 별) 사용하지 마. 일반 텍스트로만 출력.
★ ⛔ 이탤릭 표기 금지(별 1개 또는 _ 1개로 감싸는 것).
★ ⛔ 코드블록(백틱 3개) 금지. 링크 표기 [text](url) 금지.
★ 강조가 필요하면 따옴표("…"), 물결(~), 이모지만 사용.

[정체성 — 당신은 하우스왁싱 AI 상담사입니다]
★ 첫 대화이거나 고객이 "누구세요?" / "사람인가요?" / "AI인가요?" 같은 질문 시 반드시 밝히기:
  • 한국어: "안녕하세요! 하우스왁싱 AI 상담사예요 😊 궁금하신 점 편하게 물어봐주세요~"
  • English: "Hi! I'm House Waxing's AI assistant 😊 Feel free to ask me anything!"
★ 매번 반복하진 말고, 첫 접촉/신원 질문 시에만. 사람 상담원인 척 금지.

[가격 안내 정책 — 매우 중요]
★ 고객이 가격을 물으면 반드시 "신규 첫방문 할인가"를 메인으로 강조. 대부분 고객이 처음이라 이 가격을 낸다.
★ 정상가(154,000/176,000원 등)만 단독 안내 금지! 첫방문가를 앞에 내세워서 예약 유도할 것.
★ 브라질리언 예시:
  • 한국어: "브라질리언 왁싱 신규 첫방문 이벤트 진행 중이에요! 여성 104,000원 / 남성 126,000원에 받아보실 수 있어요 💕 (정상가 154,000/176,000에서 5만원 할인!) 예약 도와드릴까요? 😊"
  • English: "We have a first-visit special! Brazilian wax is 104,000 KRW (women) / 126,000 KRW (men) for first-time customers — normally 154,000/176,000. Would you like to book? 💕"
★ 반드시 마지막에 "예약 도와드릴까요? / Would you like to book?" 로 예약 유도
★ 연간회원권 보유 고객(이 고객의 다회권 블록 참고)이면 회원가로 안내

[왁서 성별 안내 정책]
★ "남자 왁서 계세요?" / "남자 직원 있나요?" 같은 질문엔:
  • 한국어: "네! 남성 왁서도 있어요 😊 예약 시 '남자 왁서 요청'이라고 말씀해주시면 해당 지점·시간에 가능한지 확인해서 배정해드릴게요~"
  • English: "Yes, we have male waxers! Please request a male waxer when booking and we'll arrange one based on availability at your branch/time."
★ "지점마다 다르다 / 상황에 따라 달라진다" 같은 애매한 표현 금지. 남성 왁서 있음을 명확히 알리고 예약 유도.
★ 여자 왁서 선호 고객도 동일 — 예약 요청사항 기재 시 배정 도와드린다고 안내
★ 특정 관리사 이름은 언급 금지`;

      const prompt=`${chatPrompt}${salesPolicyCtx}${priceCtx}${branchCtx}${pkgCtx}\n\n[대화]\n${lastMsgs}\n\n고객 마지막 메시지에 답변하세요. JSON만 출력:\n{"reply":"${langName}로 작성한 답변","ko":"한국어 번역"}`;
      const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+key,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
      if(res.status===429){alert("AI 요청 한도 초과. 잠시 후 시도해주세요.");return;}
      if(!res.ok){const err=await res.text();alert("AI API 오류: "+res.status);console.error("[genAI] API error:",err);return;}
      const dd=await res.json();
      let raw=(dd.candidates?.[0]?.content?.parts?.[0]?.text||"").replace(/```json|```/g,"").trim();
      if(!raw){alert("AI 응답이 비어있습니다.");return;}
      try{const p=JSON.parse(raw);if(p.reply){setReply(p.reply);setReplyIsAi(true);setAiKoDraft(p.ko||"");}else{setReply(raw);setReplyIsAi(true);}}
      catch{setReply(raw);setReplyIsAi(true);}
    }catch(e){console.error("[genAI]",e);alert("AI 오류: "+e.message);}finally{setAiLoading(false);}
  };

  // 🤖 대화 맥락 분석 → AI 자동 예약 생성 (서버 /ai-book 호출)
  const aiBook = async()=>{
    if(!sel||aiBookLoading) return;
    const custName=(convo.find(m=>m.cust_name)?.cust_name)||getDisplayName(convo[0]||{user_id:sel.user_id})||"";
    if(!confirm(`${custName||"고객"}님의 대화를 분석해서 AI가 예약을 생성합니다.\n(미배정으로 저장되며, 타임라인에서 배정하세요)\n\n계속할까요?`)) return;
    setAiBookLoading(true);
    try{
      const res=await fetch("https://blissme.ai/ai-book",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({channel:sel.channel,account_id:sel.account_id,user_id:sel.user_id}),
      });
      const dd=await res.json().catch(()=>({}));
      if(!res.ok||!dd?.ok){
        alert("AI 예약 실패: "+(dd?.error||res.status));
        return;
      }
      if(dd.booked){
        alert("✅ 예약이 미배정으로 생성됐습니다.\n\n대화 헤더의 📅 버튼으로 확인/배정하세요.");
      }else{
        // AI 응대 문구에는 "완료했습니다" 같은 확정형 표현이 섞여있어 시스템 실패 메시지와 모순. 노출하지 않음.
        alert("ℹ️ 예약 생성 조건 미충족\n\n(날짜·시간·시술 중 하나 이상이 명확하지 않음)\n고객에게 필요한 정보를 확인 후 직접 등록해주세요.");
      }
    }catch(e){console.error("[aiBook]",e);alert("AI 예약 오류: "+e.message);}
    finally{setAiBookLoading(false);}
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
      {showAiSettings&&(()=>{ const stLabel=aiSchedule.enabled?(scheduleInWindow?"응대 시간":"OFF 시간"):"항상 응대"; const stColor=aiSchedule.enabled?(scheduleInWindow?"#059669":"#9ca3af"):"#7C3AED"; return <div style={{padding:"12px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#7C3AED"}}>🤖 AI 자동대답</span>
          <span style={{fontSize:10,fontWeight:700,color:"#fff",background:stColor,padding:"2px 8px",borderRadius:10,whiteSpace:"nowrap"}}>● {stLabel}</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
          {_chMeta.map(([ch,label,clr])=>(
            <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"5px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr:"#fff",color:aiAutoChannels[ch]?"#fff":T.gray500,whiteSpace:"nowrap",fontFamily:"inherit"}}>{label}</button>
          ))}
        </div>
        <div style={{fontSize:10,fontWeight:700,color:"#6B21A8",marginBottom:5,whiteSpace:"nowrap"}}>⏰ 응대 시간 (전채널 공통)</div>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#fff",border:"1px solid "+T.border,borderRadius:8}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
            <input type="checkbox" checked={!!aiSchedule.enabled} onChange={e=>saveAiSchedule({enabled:e.target.checked})} style={{cursor:"pointer",width:14,height:14,accentColor:"#7C3AED"}}/>
            <span style={{fontSize:11,fontWeight:700,color:aiSchedule.enabled?"#7C3AED":T.gray500}}>스케줄</span>
          </label>
          <input type="time" value={aiSchedule.start||"10:00"} onChange={e=>saveAiSchedule({start:e.target.value})} disabled={!aiSchedule.enabled}
            style={{fontSize:12,padding:"4px 6px",border:"1px solid "+T.border,borderRadius:5,fontFamily:"inherit",minWidth:0,flex:1,opacity:aiSchedule.enabled?1:0.45,background:aiSchedule.enabled?"#fff":"#f9fafb"}}/>
          <span style={{color:T.gray400,fontSize:11,flexShrink:0}}>~</span>
          <input type="time" value={aiSchedule.end||"22:00"} onChange={e=>saveAiSchedule({end:e.target.value})} disabled={!aiSchedule.enabled}
            style={{fontSize:12,padding:"4px 6px",border:"1px solid "+T.border,borderRadius:5,fontFamily:"inherit",minWidth:0,flex:1,opacity:aiSchedule.enabled?1:0.45,background:aiSchedule.enabled?"#fff":"#f9fafb"}}/>
        </div>
      </div>})()}
      {/* 지점 필터 (id_ebgbebctt3 Phase 2): 내 지점(연계 포함) 디폴트 / 전체 */}
      <div style={{padding:"6px 10px",borderBottom:"1px solid "+T.border,display:"flex",gap:6,alignItems:"center",background:"#fafafa"}}>
        <span style={{fontSize:10,color:T.textMuted,fontWeight:700,marginRight:2}}>🏪</span>
        {[{id:'mine', label:'내 지점'}, {id:'all', label:'전체'}].map(c => (
          <button key={c.id} onClick={()=>setBranchFilter(c.id)}
            style={{padding:"3px 12px",fontSize:11,fontWeight:branchFilter===c.id?700:500,border:"1px solid "+(branchFilter===c.id?T.primary:T.border),borderRadius:12,background:branchFilter===c.id?T.primaryLt:"#fff",color:branchFilter===c.id?T.primaryDk:T.gray600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {c.label}
          </button>
        ))}
      </div>
      <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border}}>
        <input value={msgSearch} onChange={e=>setMsgSearch(e.target.value)} placeholder="이름, 메시지 검색..." style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+T.border,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
      </div>
      <div style={{overflowY:"auto"}}>
        {loading?<div style={{padding:40,textAlign:"center",color:T.textMuted}}>로딩 중...</div>
        :threads.length===0?<div style={{padding:40,textAlign:"center",color:T.textMuted}}>{msgSearch?"검색 결과 없음":"메시지 없음"}</div>
        :threads.map(m=>{
          const ch=m.channel||"naver"; const key=ch+"_"+m.user_id;
          const uc=unread(m.user_id,ch);
          const name=getDisplayName(m);
          // 왓츠앱은 전지점 공통이라 지점명 숨김
          const branch=ch==="whatsapp"?"":branchName(m);
          const initials=name.slice(0,2);
          const isOut=m.direction==="out";
          return <div key={key} onClick={()=>selectThread(m)}
            style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:14,borderBottom:"1px solid #f0f0f0",background:"#fff",cursor:"pointer"}}>
            {/* 아바타 — 브랜드 색상 배경 + 공식 로고 */}
            <div style={{position:"relative",flexShrink:0}}>
              <div style={{width:48,height:48,borderRadius:"50%",
                background:CH_COLOR[ch]||"#888",
                display:"flex",alignItems:"center",justifyContent:"center",
                border:uc>0?"2.5px solid "+T.primary:"2.5px solid transparent",
                boxSizing:"border-box",
                boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}}>
                <ChannelLogo channel={ch} size={26}/>
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
        <div style={{width:28,height:28,borderRadius:14,background:CH_COLOR[sel.channel]||T.primary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title={CH_NAME[sel.channel]||sel.channel}><ChannelLogo channel={sel.channel} size={16}/></div>
        <div style={{flex:1}}>
          <div style={{fontWeight:T.fw.bolder,fontSize:16}}>{(sel?.channel!=="whatsapp"&&branchName(convo[0]))?branchName(convo[0])+" · ":""}{getDisplayName(convo[0]||{user_id:sel.user_id})}</div>
          <div style={{fontSize:12,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}{(convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone)?" · "+(convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone):""}</div>
        </div>
        {(()=>{const res=chatResMap[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes(res);setPage("timeline");setSel(null);}}} style={{fontSize:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>📅{st}</button>;})()}
        {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={_extLink.label} style={{fontSize:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:"4px 8px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>{_extLink.short} ↗</a>}
        <button onClick={aiBook} disabled={aiBookLoading} title="AI 예약생성" style={{padding:"5px 10px",background:aiBookLoading?"#9CA3AF":"#7C3AED",color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:aiBookLoading?"wait":"pointer",fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>{aiBookLoading?"⏳":"🤖 예약"}</button>
        <button onClick={genAI} disabled={aiLoading} style={{padding:"5px 12px",background:T.primary,color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600}}>{aiLoading?"...":"✨ AI"}</button>
      </div>
      {/* 메시지 */}
      <div style={{flex:1,overflowY:"auto",padding:"16px 16px 4px",display:"flex",flexDirection:"column",gap:10,WebkitOverflowScrolling:"touch",background:"#f5f5f7"}}>
        {convo.map((m,i)=>{
          if(m.direction==="system") return null;
          const isOut=m.direction==="out";
          return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:8}}>
            {/* AI 발송 메시지는 보라색 아바타 🤖 (id_imgr471swt-2 요청) */}
            {isOut&&m.is_ai&&<div style={{width:28,height:28,borderRadius:14,background:"#7C3AED",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:"#fff"}}>🤖</div>}
            <div style={{maxWidth:"75%"}}>
              {/* AI 발송 메시지에 선명한 AI 배지 */}
              {m.is_ai&&<div style={{display:"flex",justifyContent:isOut?"flex-end":"flex-start",marginBottom:3}}>
                <span style={{background:"#7C3AED",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:10,fontWeight:800,letterSpacing:0.3}}>🤖 AI 자동응답</span>
              </div>}
              <div style={{padding:"10px 14px",borderRadius:isOut?"16px 16px 4px 16px":"16px 16px 16px 4px",background:isOut?(m.is_ai?"#7C3AED":T.primary):"#fff",color:isOut?"#fff":T.text,fontSize:16,lineHeight:1.5,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                {m.message_text}
                {m.translated_text&&<div style={{marginTop:6,paddingTop:6,borderTop:isOut?"1px solid rgba(255,255,255,0.45)":"1px solid rgba(0,0,0,0.18)",fontSize:12,color:isOut?"rgba(255,255,255,0.95)":"rgba(0,0,0,0.78)",fontWeight:500}}>🔤 {m.translated_text}</div>}
              </div>
              <div style={{fontSize:10,color:T.textMuted,marginTop:3,textAlign:isOut?"right":"left"}}>{fmtTime(m.created_at)}</div>
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
        {showAiSettings&&(()=>{ const stLabel=aiSchedule.enabled?(scheduleInWindow?"응대 시간":"OFF 시간"):"항상 응대"; const stColor=aiSchedule.enabled?(scheduleInWindow?"#059669":"#9ca3af"):"#7C3AED"; return <div style={{padding:"12px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:"#7C3AED"}}>🤖 AI 자동대답</span>
            <span style={{fontSize:10,fontWeight:700,color:"#fff",background:stColor,padding:"2px 8px",borderRadius:10,whiteSpace:"nowrap"}}>● {stLabel}</span>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
            {_chMeta.map(([ch,label,clr])=>(
              <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"5px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr:"#fff",color:aiAutoChannels[ch]?"#fff":T.gray500,whiteSpace:"nowrap",fontFamily:"inherit"}}>{label}</button>
            ))}
          </div>
          <div style={{fontSize:10,fontWeight:700,color:"#6B21A8",marginBottom:5,whiteSpace:"nowrap"}}>⏰ 응대 시간 (전채널 공통)</div>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#fff",border:"1px solid "+T.border,borderRadius:8}}>
            <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
              <input type="checkbox" checked={!!aiSchedule.enabled} onChange={e=>saveAiSchedule({enabled:e.target.checked})} style={{cursor:"pointer",width:14,height:14,accentColor:"#7C3AED"}}/>
              <span style={{fontSize:11,fontWeight:700,color:aiSchedule.enabled?"#7C3AED":T.gray500}}>스케줄</span>
            </label>
            <input type="time" value={aiSchedule.start||"10:00"} onChange={e=>saveAiSchedule({start:e.target.value})} disabled={!aiSchedule.enabled}
              style={{fontSize:12,padding:"4px 6px",border:"1px solid "+T.border,borderRadius:5,fontFamily:"inherit",minWidth:0,flex:1,opacity:aiSchedule.enabled?1:0.45,background:aiSchedule.enabled?"#fff":"#f9fafb"}}/>
            <span style={{color:T.gray400,fontSize:11,flexShrink:0}}>~</span>
            <input type="time" value={aiSchedule.end||"22:00"} onChange={e=>saveAiSchedule({end:e.target.value})} disabled={!aiSchedule.enabled}
              style={{fontSize:12,padding:"4px 6px",border:"1px solid "+T.border,borderRadius:5,fontFamily:"inherit",minWidth:0,flex:1,opacity:aiSchedule.enabled?1:0.45,background:aiSchedule.enabled?"#fff":"#f9fafb"}}/>
          </div>
        </div>})()}
        {/* 지점 필터 (id_ebgbebctt3 Phase 2) — 데스크탑 */}
        <div style={{padding:"5px 10px",borderBottom:"1px solid "+T.border,display:"flex",gap:6,alignItems:"center",background:"#fafafa"}}>
          <span style={{fontSize:10,color:T.textMuted,fontWeight:700,marginRight:2}}>🏪</span>
          {[{id:'mine', label:'내 지점'}, {id:'all', label:'전체'}].map(c => (
            <button key={c.id} onClick={()=>setBranchFilter(c.id)}
              style={{padding:"2px 10px",fontSize:10,fontWeight:branchFilter===c.id?700:500,border:"1px solid "+(branchFilter===c.id?T.primary:T.border),borderRadius:10,background:branchFilter===c.id?T.primaryLt:"#fff",color:branchFilter===c.id?T.primaryDk:T.gray600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {c.label}
            </button>
          ))}
        </div>
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
            const name=getDisplayName(m);
            // 왓츠앱은 전지점 공통이라 지점명 숨김
            const branch=ch==="whatsapp"?"":branchName(m);
            const initials=name.slice(0,1);
            return <div key={key} onClick={()=>selectThread(m)}
              style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,
                background:isS?"rgba(124,58,237,0.06)":"transparent",
                borderBottom:"1px solid "+T.border}}>
              {/* 아바타 — 브랜드 색상 배경 + 공식 로고 */}
              <div style={{position:"relative",flexShrink:0}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:CH_COLOR[ch]||"#888",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  border:uc>0?"2px solid "+T.primary:"2px solid transparent",boxSizing:"border-box",
                  boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}}>
                  <ChannelLogo channel={ch} size={22}/>
                </div>
              </div>
              {/* 텍스트 */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <span style={{fontWeight:uc>0?800:600,fontSize:14,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>
                    {branch?<span style={{color:T.primary,fontWeight:700}}>{branch}</span>:null}{branch?" · ":""}{name}
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
            <div style={{width:28,height:28,borderRadius:14,background:CH_COLOR[sel.channel]||T.primary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title={CH_NAME[sel.channel]||sel.channel}><ChannelLogo channel={sel.channel} size={16}/></div>
            <div style={{flex:1}}>
              <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm}}>{(sel?.channel!=="whatsapp"&&branchName(convo[0]))?branchName(convo[0])+" · ":""}{getDisplayName(convo[0]||{user_id:sel.user_id})}</div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}</div>
            </div>
            {(()=>{const res=chatResMap[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes(res);setPage("timeline");}}} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>📅 {st} {res.date?.slice(5)} {res.time} →</button>;})()}
            {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={_extLink.label} style={{fontSize:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:"4px 10px",textDecoration:"none",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>{_extLink.label} ↗</a>}
            <button onClick={aiBook} disabled={aiBookLoading} title="대화 맥락 분석하여 AI가 미배정으로 예약 생성"
              style={{fontSize:11,fontWeight:700,color:"#fff",background:aiBookLoading?"#9CA3AF":"#7C3AED",border:"1px solid "+(aiBookLoading?"#9CA3AF":"#6D28D9"),borderRadius:6,padding:"4px 10px",cursor:aiBookLoading?"wait":"pointer",fontFamily:"inherit",flexShrink:0,whiteSpace:"nowrap"}}>
              {aiBookLoading?"⏳ 분석 중…":"🤖 AI 예약생성"}
            </button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
            {convo.map((m,i)=>{
              if(m.direction==="system") return null;
              const isOut=m.direction==="out";
              return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:8}}>
                <div style={{maxWidth:"70%"}}>
                  <div style={{padding:"10px 14px",borderRadius:isOut?"16px 16px 4px 16px":"16px 16px 16px 4px",background:isOut?T.primary:"#fff",color:isOut?"#fff":T.text,fontSize:16,lineHeight:1.5,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                    {m.message_text}
                    {m.translated_text&&<div style={{marginTop:6,paddingTop:6,borderTop:isOut?"1px solid rgba(255,255,255,0.45)":"1px solid rgba(0,0,0,0.18)",fontSize:12,color:isOut?"rgba(255,255,255,0.95)":"rgba(0,0,0,0.78)",fontWeight:500}}>🔤 {m.translated_text}</div>}
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

// 모바일 전용 탭 래퍼: 받은메시지 / 팀 채팅
import { TeamChat, useTeamChat } from '../Chat'
function MessagesWithTeamTab(props) {
  const [tab, setTab] = useState('inbox');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const teamChat = useTeamChat();
  // 데스크탑은 기존 AdminInbox만
  if (!isMobile) return <AdminInbox {...props} />;
  const teamUnread = teamChat.unreadCount || 0;
  const tabBtn = (key, label, badge) => (
    <button onClick={()=>{ setTab(key); if (key==='team' && teamUnread>0) teamChat.markAllRead(); }} style={{
      flex:1, padding:'10px 0', border:'none', background: tab===key ? T.primaryLt : T.bgCard,
      color: tab===key ? T.primaryDk : T.textSub, fontWeight: tab===key ? 800 : 600,
      fontFamily:'inherit', fontSize:13, cursor:'pointer',
      borderBottom: tab===key ? `2px solid ${T.primary}` : '2px solid transparent',
      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
    }}>
      {label}
      {badge > 0 && <span style={{background:T.danger,color:'#fff',borderRadius:10,fontSize:10,fontWeight:700,padding:'1px 6px',minWidth:16,textAlign:'center'}}>{badge>99?'99+':badge}</span>}
    </button>
  );
  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', minHeight:0}}>
      <div style={{display:'flex', borderBottom:`1px solid ${T.border}`, background: T.bgCard, flexShrink:0}}>
        {tabBtn('inbox', '📥 받은메시지')}
        {tabBtn('team', '💬 팀 채팅', teamUnread)}
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='inbox' ? 'flex' : 'none', flexDirection:'column'}}>
        <AdminInbox {...props} />
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='team' ? 'flex' : 'none', flexDirection:'column'}}>
        <TeamChat />
      </div>
    </div>
  );
}

export default MessagesWithTeamTab
