import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, matchAllTokens } from '../../lib/sb'
import { searchDocs, buildDocsContext } from '../../lib/aiDocs'
import { fromDb, _activeBizId } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, useSessionState, TTL } from '../../lib/utils'
import I from '../common/I'
import { ChannelLogo } from './channelIcons'
import { uploadImageToStorage } from '../../lib/supabase'


// 지점 매핑은 data.branches에서 동적 생성 (하드코딩 제거)


function AdminInbox({ sb, branches, data, setData, onRead, onChatOpen, userBranches=[], isMaster=false, currentUser=null, pendingChat=null, onPendingChatDone, setPendingOpenRes, setPage, forceCompact=false, inboxResetKey=0, onClosePanel }) {
  // forceCompact: 사이드 패널 모드 — 좁은 폭에서 모바일 UI(리스트↔개별 토글) 사용
  const isMobile = forceCompact || (typeof window !== "undefined" && window.innerWidth < 768);
  const CH_ICON = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T",line:"L"};
  const CH_NAME = {naver:"네이버톡톡",kakao:"카카오",instagram:"인스타",whatsapp:"왓츠앱",telegram:"텔레그램",line:"LINE",sms:"문자"};
  const CH_COLOR = {naver:"#03C75A",kakao:"#F9E000",instagram:"#E1306C",whatsapp:"#128C7E",telegram:"#2AABEE",line:"#06C755",sms:"#5A8DEE"};
  const CH_LABEL = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T",line:"L"};
  const getGeminiKey = () => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";

  const [msgs, setMsgs] = useState([]);
  // 선택된 대화방 {channel,user_id} — 새로고침 시 유지 (24h TTL)
  const [sel, setSel] = useSessionState("msg_sel", null, { ttlMs: TTL.TAB });
  // 사이드바 받은메시지함 클릭 시 inboxResetKey 변경 → sel 리셋해서 첫 화면(리스트)
  React.useEffect(() => {
    if (inboxResetKey > 0) {
      setSel(null);
      setReply("");
      setReplyIsAi(false);
      setAiBooked(null);
    }
  }, [inboxResetKey]);
  const [reply, setReply] = useState("");
  // AI로 생성된 답변인지 추적 (is_ai 플래그용)
  const [replyIsAi, setReplyIsAi] = useState(false);
  const [aiBooked, setAiBooked] = useState(null); // 답변추천이 자동등록한 예약 정보(인박스 피드백 + 타임라인 포커스용)
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false); // 동기 더블서밋 가드 (setSending 비동기 race 방지)
  // 실제 번역 API 호출 중인지 표시 (번역 토글 버튼에 ON-AIR 표시용)
  const [translating, setTranslating] = useState(false);
  // IN 메시지 자동 번역 진행 중 표시 — 새 in 메시지 도착 후 translated_text 채워질 때까지 잠시 ON-AIR
  const [inTranslating, setInTranslating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBookLoading, setAiBookLoading] = useState(false);
  const [aiErrBusy, setAiErrBusy] = useState(false);
  const [endCounselLoading, setEndCounselLoading] = useState(false);
  // 📋 자주 쓰는 답변(클립보드) — 매장 공유(schedule_data quick_replies_v1). 클릭 시 입력창에 삽입
  const [quickReplies, setQuickReplies] = useState([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrManage, setQrManage] = useState(false);
  const [qrBranchFilter, setQrBranchFilter] = useState("");  // 지점 전용 섹션 드롭다운 선택
  const [qrSvc, setQrSvc] = useState(null);  // 가격표 토큰용 시술/카테고리 (패널 열 때 직접 fetch — data prop 비어있어도 보장)
  useEffect(()=>{
    if(!qrOpen) return;
    let alive=true;
    (async()=>{
      try{
        const [sv,ct]=await Promise.all([sb.getByBiz("services",_activeBizId), sb.getByBiz("service_categories",_activeBizId)]);
        if(alive) setQrSvc({ services: fromDb("services", sv||[]), cats: fromDb("service_categories", ct||[]) });
      }catch(_){}
    })();
    return ()=>{ alive=false; };
  },[qrOpen]);
  const [qrDraft, setQrDraft] = useState(null); // {id?, label, text}
  // 번역 모드: "auto" (기본, 고객 언어 감지) / "force_en" (강제 영어) / "off" (번역 안 함)
  const [autoTranslate, setAutoTranslate] = useState(true);  // 기존 호환
  const [translateMode, setTranslateMode] = useState("auto");
  const cycleTranslateMode = () => {
    setTranslateMode(m => m === "auto" ? "force_en" : m === "force_en" ? "off" : "auto");
  };
  // pendingChat: 예약 모달에서 넘어온 대화방 자동 선택 — 이미 열린 sel이 있어도 강제 교체
  useEffect(() => {
    if (!pendingChat) return;
    // msgs가 아직 비었으면 스레드에 없는 것처럼 보일 수 있으니 강제로 먼저 세팅
    setSel({ user_id: pendingChat.user_id, channel: pendingChat.channel, account_id: pendingChat.account_id });
    if (msgs.length > 0 && onPendingChatDone) onPendingChatDone();
  }, [pendingChat, msgs.length]);
  const [aiKoDraft, setAiKoDraft] = useState("");
  const [aiAutoChannels, setAiAutoChannels] = useState({});
  const [aiSchedule, setAiSchedule] = useState({enabled:false,start:"10:00",end:"22:00"}); // 전채널 공통
  const [aiDelay, setAiDelay] = useState({enabled:false,minutes:5}); // 미응답 N분 후 자동 답변
  const [aiBadgeMap, setAiBadgeMap] = useState({}); // key=ch+'_'+user_id → {status:'pending'|'sent', schedAt, processedAt}
  const [followupMap, setFollowupMap] = useState({}); // key=ch+'_'+user_id → {reason, question, cust_name} (AI가 미룬 문의 → 직원 확인 필요)
  const [followupOnly, setFollowupOnly] = useState(false); // "확인 필요" 대화만 필터
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
  const [branchFilter, setBranchFilter] = useSessionState("msg_branch_filter", "mine", { ttlMs: TTL.TAB });

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

  // 메시지 로드 — Supabase max-rows=1000 cap 우회용 페이지네이션.
  // 첫 1000건은 즉시 표시하고 나머지는 백그라운드로 append (검색·user_name 매칭용).
  const loadingRef = useRef(false);
  const loadMsgs = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const _since = new Date(Date.now() - 60 * 86400000).toISOString();
      const sinceEnc = encodeURIComponent(_since);
      const fetchPage = (offset) => fetch(
        SB_URL+`/rest/v1/messages?business_id=eq.${_activeBizId}&created_at=gte.${sinceEnc}&order=created_at.desc&limit=1000&offset=${offset}&select=*`,
        { headers: { ...sbHeaders, "Cache-Control": "no-cache" }, cache: "no-store" }
      ).then(r => r.json());

      // 1) 첫 페이지 즉시 반영
      const first = await fetchPage(0);
      if (!Array.isArray(first)) return;
      setMsgs(first);
      const nm = {};
      first.forEach(m => { if (m.user_name && !nm[m.user_id]) nm[m.user_id] = m.user_name; });
      if (Object.keys(nm).length > 0) setNames(prev => ({...prev,...nm}));

      // 2) 백그라운드로 추가 페이지 append (60일치 max ~6000건 안전망)
      if (first.length === 1000) {
        (async () => {
          let offset = 1000;
          for (let p = 0; p < 5; p++) {
            try {
              const batch = await fetchPage(offset);
              if (!Array.isArray(batch) || batch.length === 0) break;
              setMsgs(prev => [...prev, ...batch]);
              const more = {};
              batch.forEach(m => { if (m.user_name && !more[m.user_id]) more[m.user_id] = m.user_name; });
              if (Object.keys(more).length > 0) setNames(prev => ({...prev,...more}));
              if (batch.length < 1000) break;
              offset += 1000;
            } catch (e) { break; }
          }
        })();
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
    fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}&select=settings`,{headers:sbHeaders})
      .then(r=>r.json()).then(rows=>{
        const s = _parseSettings(rows?.[0]?.settings);
        setAiAutoChannels(s.ai_auto_reply_channels || {});
        // 구 per-channel 스케줄 → 단일 스케줄 마이그레이션
        const _sc = s.ai_auto_reply_schedule || {};
        if (_sc && typeof _sc === 'object' && (_sc.naver || _sc.instagram || _sc.whatsapp)) {
          const _first = _sc.naver || _sc.instagram || _sc.whatsapp || {};
          setAiSchedule({enabled:!!_first.enabled,start:_first.start||"10:00",end:_first.end||"22:00",byDay:_mkByDay(_first)});
        } else {
          setAiSchedule({enabled:!!_sc.enabled,start:_sc.start||"10:00",end:_sc.end||"22:00",byDay:_mkByDay(_sc)});
        }
        // IG account_id → branch_id 오버라이드 매핑 (branches 미등록 IG 계정용)
        setIgBranchOverride(s.ig_branch_override || {});
        // 미응답 N분 후 자동 답변
        const _dl = s.ai_auto_reply_delay || {};
        setAiDelay({enabled:!!_dl.enabled, minutes:Number(_dl.minutes)||5});
      }).catch(()=>{});
  },[]);
  const toggleAiChannel = async (ch) => {
    const prev = {...aiAutoChannels};
    const updated = {...prev, [ch]: !prev[ch]};
    setAiAutoChannels(updated);
    try {
      const r = await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}&select=settings`,{headers:sbHeaders});
      const rows = await r.json();
      const settings = _parseSettings(rows?.[0]?.settings);
      settings.ai_auto_reply_channels = updated;
      settings.ai_auto_reply_enabled = Object.values(updated).some(v=>v);
      await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(settings)})});
    } catch(e){ setAiAutoChannels(prev); }
  };

  // AI 스케줄 저장 (전채널 공통 단일 스케줄)
  const saveAiSchedule = async (patch) => {
    const prev = {...aiSchedule};
    const updated = {...prev, ...patch};
    setAiSchedule(updated);
    try {
      const r = await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}&select=settings`,{headers:sbHeaders});
      const rows = await r.json();
      const settings = _parseSettings(rows?.[0]?.settings);
      settings.ai_auto_reply_schedule = updated;
      await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(settings)})});
    } catch(e){ setAiSchedule(prev); }
  };

  // 요일별 시간 저장 (dow: 0=일~6=토)
  const saveAiScheduleDay = (dow, patch) => {
    const cur = (aiSchedule.byDay && aiSchedule.byDay[dow]) || {on:true,start:"10:00",end:"22:00"};
    const nextByDay = {...(aiSchedule.byDay||{}), [dow]: {...cur, ...patch}};
    saveAiSchedule({ byDay: nextByDay });
  };
  const _DOW = ["일","월","화","수","목","금","토"];
  const renderAiScheduleRows = () => (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {_DOW.map((lbl,i)=>{
        const d = (aiSchedule.byDay && aiSchedule.byDay[i]) || {on:true,start:"10:00",end:"22:00"};
        const act = !!aiSchedule.enabled;
        const dayOn = act && !!d.on;
        return <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 8px",background:"#fff",border:"none",borderRadius:8,boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:act?"pointer":"default",width:40,flexShrink:0}}>
            <input type="checkbox" checked={!!d.on} disabled={!act} onChange={e=>saveAiScheduleDay(i,{on:e.target.checked})} style={{cursor:act?"pointer":"default",width:13,height:13,accentColor:"#7C3AED"}}/>
            <span style={{fontSize:11,fontWeight:700,color:dayOn?"#7C3AED":T.gray500}}>{lbl}</span>
          </label>
          <input type="text" inputMode="numeric" placeholder="HH:MM" value={d.start||""} disabled={!dayOn} onChange={e=>saveAiScheduleDay(i,{start:e.target.value})}
            style={{fontSize:12,padding:"4px 6px",border:"none",borderRadius:6,fontFamily:"inherit",minWidth:0,flex:1,textAlign:"center",opacity:dayOn?1:0.4,background:"transparent",outline:"none"}}/>
          <span style={{color:T.gray400,fontSize:11,flexShrink:0}}>~</span>
          <input type="text" inputMode="numeric" placeholder="HH:MM" value={d.end||""} disabled={!dayOn} onChange={e=>saveAiScheduleDay(i,{end:e.target.value})}
            style={{fontSize:12,padding:"4px 6px",border:"none",borderRadius:6,fontFamily:"inherit",minWidth:0,flex:1,textAlign:"center",opacity:dayOn?1:0.4,background:"transparent",outline:"none"}}/>
        </div>;
      })}
    </div>
  );

  // 미응답 N분 후 자동 답변 저장
  const saveAiDelay = async (patch) => {
    const prev = {...aiDelay};
    const updated = {...prev, ...patch};
    setAiDelay(updated);
    try {
      const r = await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}&select=settings`,{headers:sbHeaders});
      const rows = await r.json();
      const settings = _parseSettings(rows?.[0]?.settings);
      settings.ai_auto_reply_delay = updated;
      await fetch(SB_URL+`/rest/v1/businesses?id=eq.${_activeBizId}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=minimal"},body:JSON.stringify({settings:JSON.stringify(settings)})});
    } catch(e){ setAiDelay(prev); }
  };

  // AI 자동응대 배지 — pending_ai_replies 5초 폴링, thread별 latest 1건
  useEffect(() => {
    if (!_activeBizId) return;
    let alive = true;
    const fetchBadges = async () => {
      try {
        const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString();
        const url = `${SB_URL}/rest/v1/pending_ai_replies?business_id=eq.${_activeBizId}&or=(status.eq.pending,and(status.eq.sent,processed_at.gte.${cutoff.replace('+','%2B')}))&order=created_at.desc&limit=500&select=channel,user_id,status,scheduled_at,processed_at`;
        const r = await fetch(url, { headers: {...sbHeaders, 'Cache-Control':'no-cache'}, cache:'no-store' });
        if (!alive || !r.ok) return;
        const rows = await r.json();
        const map = {};
        for (const row of (rows||[])) {
          const k = (row.channel||'') + '_' + (row.user_id||'');
          if (!map[k]) map[k] = { status: row.status, schedAt: row.scheduled_at, processedAt: row.processed_at };
        }
        setAiBadgeMap(map);
      } catch {}
    };
    fetchBadges();
    const t = setInterval(fetchBadges, 30000);
    return () => { alive=false; clearInterval(t); };
  }, []);

  // 확인 필요(inbox_followup) — AI가 영업시간 종료 등으로 미룬 문의 → 직원이 다음날 확인
  useEffect(() => {
    if (!_activeBizId) return;
    let alive = true;
    const fetchFollowups = async () => {
      try {
        const url = `${SB_URL}/rest/v1/inbox_followup?business_id=eq.${_activeBizId}&resolved_at=is.null&select=channel,user_id,reason,question,cust_name`;
        const r = await fetch(url, { headers: {...sbHeaders, 'Cache-Control':'no-cache'}, cache:'no-store' });
        if (!alive || !r.ok) return;
        const rows = await r.json();
        const map = {};
        for (const row of (rows||[])) {
          const k = (row.channel||'') + '_' + (row.user_id||'');
          if (!map[k]) map[k] = { reason: row.reason, question: row.question, cust_name: row.cust_name };
        }
        setFollowupMap(map);
      } catch {}
    };
    fetchFollowups();
    const t = setInterval(fetchFollowups, 30000);
    return () => { alive=false; clearInterval(t); };
  }, []);

  // AI 자동응대 배지 렌더 helper
  const _renderAiBadge = (key) => {
    const b = aiBadgeMap[key];
    if (!b) return null;
    if (b.status === 'pending') {
      const secs = Math.max(0, Math.round((new Date(b.schedAt).getTime() - Date.now())/1000));
      const label = secs > 0 ? `${secs}초 후 자동응답` : `응답 발송 중...`;
      return <span style={{fontSize:10,fontWeight:700,color:'#92400E',background:'#FEF3C7',padding:'2px 6px',borderRadius:8,whiteSpace:'nowrap',marginLeft:6,flexShrink:0,display:'inline-flex',alignItems:'center',gap:3}}><I name="bot" size={11} color="#92400E"/>{label}</span>;
    }
    if (b.status === 'sent') {
      // sent 이후 직원 outbound 있으면 → AI 모드 해제, 배지 X
      const [ch, ...uidParts] = key.split('_');
      const uid = uidParts.join('_');
      const sentAtMs = b.processedAt ? new Date(b.processedAt).getTime() : 0;
      // 10분 경과 시 자동 사라짐 (대화 자연 종료로 간주)
      if (sentAtMs > 0 && Date.now() - sentAtMs > 10 * 60 * 1000) return null;
      const hasStaffAfter = sentAtMs > 0 && msgs.some(m => m.channel === ch && m.user_id === uid && m.direction === 'out' && !m.is_ai && new Date(m.created_at).getTime() > sentAtMs);
      if (hasStaffAfter) return null;
      return <span style={{fontSize:10,fontWeight:700,color:'#065F46',background:'#D1FAE5',padding:'2px 6px',borderRadius:8,whiteSpace:'nowrap',marginLeft:6,flexShrink:0,display:'inline-flex',alignItems:'center',gap:3}}><I name="bot" size={11} color="#065F46"/>AI 응대중</span>;
    }
    return null;
  };

  // 확인 필요 배지 렌더 helper (AI가 미룬 문의 → 직원 확인)
  const _renderFollowupBadge = (key) => {
    if (!followupMap[key]) return null;
    return <span title={followupMap[key].question||"고객 문의 — 직원 확인 필요"} style={{fontSize:10,fontWeight:700,color:'#3730A3',background:'#E0E7FF',padding:'2px 6px',borderRadius:8,whiteSpace:'nowrap',marginLeft:6,flexShrink:0,display:'inline-flex',alignItems:'center',gap:3}}><I name="bell" size={11} color="#3730A3"/>확인 필요</span>;
  };

  // 매 초 카운트다운 트리거 (pending) + 30초 sent 만료 체크
  const [_aiTick, _setAiTick] = useState(0);
  useEffect(() => {
    const hasPending = Object.values(aiBadgeMap).some(b => b.status === 'pending');
    const hasSent = Object.values(aiBadgeMap).some(b => b.status === 'sent');
    if (!hasPending && !hasSent) return;
    const interval = hasPending ? 1000 : 30000;
    const t = setInterval(() => _setAiTick(x=>x+1), interval);
    return () => clearInterval(t);
  }, [aiBadgeMap]);

  // AI 자동대답 채널 메타 (카카오 제외)
  const _chMeta = [["naver","N 네이버","#03C75A"],["instagram","I 인스타","#E1306C"],["whatsapp","W 왓츠앱","#128C7E"],["line","L LINE","#06C755"],["sms","문자","#5A8DEE"]];
  const _nowInWindow = (sc) => {
    if (!sc?.enabled) return true;
    const now=new Date(); const cur=now.getHours()*60+now.getMinutes();
    const toMin=s=>{const [h,m]=(s||"0:0").split(":").map(Number);return h*60+(m||0);};
    // 요일별(byDay) 우선 — 오늘 요일(0=일~6=토) 설정 적용
    const bd = sc.byDay && sc.byDay[String(now.getDay())];
    if (bd) {
      if (!bd.on) return false;            // 그 요일 자동응대 끔
      const st=toMin(bd.start||"00:00"), en=toMin(bd.end||"23:59");
      return st<=en ? (cur>=st&&cur<=en) : (cur>=st||cur<=en);
    }
    const st=toMin(sc.start||"00:00"), en=toMin(sc.end||"23:59");
    return st<=en ? (cur>=st&&cur<=en) : (cur>=st||cur<=en);
  };
  // 구버전 {start,end} → byDay(요일7개) 마이그레이션
  const _mkByDay = (sc) => {
    if (sc?.byDay && typeof sc.byDay==='object') return sc.byDay;
    const d={}; for(let i=0;i<7;i++) d[i]={on:true, start:sc?.start||"10:00", end:sc?.end||"22:00"};
    return d;
  };
  const scheduleInWindow = _nowInWindow(aiSchedule);

  useEffect(()=>{ convoEndRef.current?.scrollIntoView({behavior:"smooth"}); },[sel, msgs.length]);

  const [msgSearch, setMsgSearch] = useSessionState("msg_search", "", { ttlMs: TTL.SEARCH });

  // 채팅 user_id → 예약 매핑 (active 예약 우선)
  const chatResMap = useMemo(()=>{
    const m={};
    const SKIP=["cancelled","naver_cancelled","naver_changed"];
    (data?.reservations||[]).forEach(r=>{
      if(!r.chatUserId||!r.chatChannel) return;
      if(r.source==='creatrip') return; // 크리에이트립은 손님이 적은 메신저 ID라 능동 발송 불가 → 받은메시지함 제외 (소통은 크리에이트립 플랫폼)
      if(SKIP.includes(r.status)) return;
      const key=r.chatChannel+"_"+r.chatUserId;
      if(!m[key]||r.date>m[key].date) m[key]=r;
    });
    return m;
  },[data?.reservations]);

  // 채팅 user_id → 고객 매핑
  // 1순위: customer.sns_accounts에 직접 링크된 경우 (가장 신뢰)
  // 2순위: 예약 cust_id 통해 매칭 (chatResMap 경유)
  const chatCustMap = useMemo(()=>{
    const m={};
    const cMap = new Map((data?.customers||[]).map(c=>[c.id, c]));
    // 1순위: sns_accounts 기반
    (data?.customers||[]).forEach(c => {
      const sns = Array.isArray(c.snsAccounts) ? c.snsAccounts : (Array.isArray(c.sns_accounts) ? c.sns_accounts : []);
      sns.forEach(s => {
        if (s?.channel && s?.user_id) m[`${s.channel}_${s.user_id}`] = c;
      });
    });
    // 2순위: 예약을 통한 매칭 (sns_accounts에 없을 때만)
    Object.entries(chatResMap).forEach(([key, res])=>{
      if (m[key]) return;
      if(!res.custId) return;
      const cust = cMap.get(res.custId);
      if(cust) m[key] = cust;
    });
    return m;
  },[chatResMap, data?.customers]);

  // 채팅방 열렸을 때 lazy fetch — chatCustMap에 없는 (channel,user_id)는 서버에서 sns_accounts 기준 직접 조회
  // 페이지네이션 limit=100에 안 걸린 신규 고객도 자동 연결됨
  const [lazyCustMap, setLazyCustMap] = useState({}); // {`${channel}_${user_id}`: customer}
  useEffect(() => {
    if (!sel) return;
    const key = `${sel.channel}_${sel.user_id}`;
    if (chatCustMap[key]) return; // 이미 매칭됨
    if (lazyCustMap[key]) return; // 이미 lazy fetch 시도됨
    let cancelled = false;
    (async () => {
      try {
        // sns_accounts에 channel + user_id 들어있는 고객 검색 (jsonb @> 연산자)
        const filter = encodeURIComponent(`[{"channel":"${sel.channel}","user_id":"${sel.user_id}"}]`);
        const rows = await sb.get('customers', `&business_id=eq.${data?.business?.id||_activeBizId}&sns_accounts=cs.${filter}&limit=1`);
        if (cancelled) return;
        if (Array.isArray(rows) && rows.length > 0) {
          const c = fromDb('customers', rows)[0];
          if (c) {
            setLazyCustMap(prev => ({ ...prev, [key]: c }));
            // data.customers에도 추가 (모달·예약 매칭에서 활용)
            if (typeof setData === 'function') {
              setData(prev => {
                if (!prev) return prev;
                const list = prev.customers || [];
                if (list.find(x => x.id === c.id)) return prev;
                return { ...prev, customers: [...list, c] };
              });
            }
          }
        }
      } catch (e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sel?.channel, sel?.user_id]);
  // chatCustMap에 lazy 매칭 결과 합치기
  const chatCustMapFull = useMemo(() => ({ ...chatCustMap, ...lazyCustMap }), [chatCustMap, lazyCustMap]);

  // 연결 고객 예약 횟수 (기존/신규 판단 보조) — 대화 열릴 때 1회 count 조회
  const [custResCount, setCustResCount] = useState({}); // {`${ch}_${uid}`: number}
  useEffect(() => {
    if (!sel) return;
    const key = `${sel.channel}_${sel.user_id}`;
    const cust = chatCustMapFull[key];
    if (!cust?.id || custResCount[key] != null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/reservations?cust_id=eq.${cust.id}&is_schedule=eq.false&select=id`,
          { headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' } });
        const cr = r.headers.get('content-range') || '';
        const total = parseInt((cr.split('/')[1] || '0'), 10);
        if (!cancelled) setCustResCount(prev => ({ ...prev, [key]: isNaN(total) ? 0 : total }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sel?.channel, sel?.user_id, chatCustMapFull]);

  // 대화 헤더용 고객 요약 배지 (방문·예약·노쇼 + 기존/신규) — 직원이 즉시 판단
  const renderCustSummary = (cust, key) => {
    if (!cust) return null;
    const visits = Number(cust.visits || 0);
    const noShow = Number(cust.noShowCount || 0);
    const resCnt = custResCount[key];
    const lastV = cust.lastVisit ? String(cust.lastVisit).slice(5, 10) : "";
    // 기존/신규 = 실제 방문(매출) 기준 — 예약만 1회(첫 방문 전)면 신규 (정우님 id_iociwubs2j, 시스템 신규 판정과 일치)
    const isExisting = visits > 0;
    const chip = (txt, clr, bg) => (
      <span style={{ fontSize: forceCompact ? 9 : 10.5, fontWeight: 700, color: clr, background: bg, borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3 }}>{txt}</span>
    );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
        {isExisting
          ? chip("기존 고객", "#059669", "#ECFDF5")
          : chip("신규 고객", "#D97706", "#FFF7ED")}
        {chip(`방문 ${visits}회`, "#374151", "#F3F4F6")}
        {resCnt != null && chip(`예약 ${resCnt}회`, "#374151", "#F3F4F6")}
        {noShow > 0 && chip(`노쇼 ${noShow}회`, "#DC2626", "#FEF2F2")}
        {lastV && chip(`최근 ${lastV}`, "#6B7280", "#F3F4F6")}
      </div>
    );
  };

  // 채팅 → 가장 최근 예약 (chatResMap 우선 → 없으면 고객 cust_id로 최근 active 예약)
  const chatLatestRes = useMemo(()=>{
    const m={};
    const SKIP=["cancelled","naver_cancelled","naver_changed"];
    // 1순위: chatResMap (chat 정보가 직접 박힌 예약)
    Object.entries(chatResMap).forEach(([k, r]) => { m[k] = r; });
    // 2순위: 고객 매칭으로 최근 예약 찾기
    Object.entries(chatCustMapFull).forEach(([k, cust])=>{
      if (m[k]) return;
      const list = (data?.reservations||[]).filter(r => r.custId === cust.id && !SKIP.includes(r.status))
        .sort((a,b) => ((b.date||"")+(b.time||"")).localeCompare((a.date||"")+(a.time||"")));
      if (list[0]) m[k] = list[0];
    });
    return m;
  },[chatResMap, chatCustMapFull, data?.reservations]);

  const threads = useMemo(()=>{
    const map = {};
    msgs.forEach(m=>{
      // 지점 필터: account_id가 있고 허용 목록에 없으면 제외 (네이버·인스타만)
      // 예외: account_id 없음/'unknown' → 지점 미지정 메시지라 그대로 노출
      // 왓츠앱·ai_test는 전지점 공통/전체이라 필터 우회
      const isWhatsApp = (m.channel||"") === "whatsapp";
      const isLine = (m.channel||"") === "line";
      const isAitest = (m.channel||"") === "ai_test";
      const isSms = (m.channel||"") === "sms";
      if(isSms){
        // SMS account_id = 지점 bid → 접근 가능 지점만 노출
        if(activeBids.length>0 && m.account_id && !activeBids.includes(String(m.account_id))) return;
      } else if(!isWhatsApp && !isLine && !isAitest && allowedIds.length>0 && m.account_id && m.account_id!=="unknown" && !allowedIds.includes(String(m.account_id))) return;
      const key=(m.channel||"naver")+"_"+m.user_id;
      if(!map[key]||new Date(m.created_at)>new Date(map[key].created_at)) map[key]=m;
    });
    let list = Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(msgSearch.trim()){
      // 다토큰 AND: user_name/메시지/전화/매칭된 Bliss 고객 실명·전화 중 어디든 포함되면 매칭
      const matchUids=new Set();
      msgs.forEach(m=>{
        const ch = m.channel || "naver";
        const cust = chatCustMapFull[`${ch}_${m.user_id}`];
        const hay = [
          m.user_name,
          m.message_text,
          m.cust_phone,
          cust?.name,
          cust?.name2,
          cust?.phone,
          cust?.phone2,
        ].filter(Boolean).join(" ");
        if (matchAllTokens(hay, msgSearch)) matchUids.add(ch+"_"+m.user_id);
      });
      list=list.filter(m=>matchUids.has((m.channel||"naver")+"_"+m.user_id));
    }
    // ai_test 채널 노출 제거 (요청)
    list = list.filter(m => (m.channel||"") !== "ai_test");
    // 확인 필요 필터: AI가 미룬 문의가 있는 대화만
    if (followupOnly) list = list.filter(m => followupMap[(m.channel||"naver")+"_"+m.user_id]);
    return list;
  },[msgs, allowedIds.length, activeBids, msgSearch, chatCustMapFull, followupOnly, followupMap]);

  const convo = useMemo(()=>{
    if(!sel) return [];
    return msgs.filter(m=>m.user_id===sel.user_id&&(m.channel||"naver")===sel.channel)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  },[msgs, sel?.user_id, sel?.channel]);

  // IN 메시지 자동 번역 ON-AIR — 새로 도착한 in 메시지가 translated_text 비어있고 8초 이내면 "번역 중…" 표시
  useEffect(() => {
    if (translateMode === "off" || !convo || convo.length === 0) { setInTranslating(false); return; }
    const lastIn = [...convo].reverse().find(m => m.direction === "in");
    if (!lastIn) { setInTranslating(false); return; }
    if (lastIn.translated_text) { setInTranslating(false); return; }
    const ts = new Date(lastIn.created_at).getTime();
    const age = Date.now() - ts;
    const WINDOW = 8000;
    if (!isFinite(ts) || age >= WINDOW) { setInTranslating(false); return; }
    setInTranslating(true);
    const t = setTimeout(() => setInTranslating(false), WINDOW - age);
    return () => clearTimeout(t);
  }, [convo, translateMode]);

  const unread = (uid,ch)=>msgs.filter(m=>m.user_id===uid&&(m.channel||"naver")===ch&&!m.is_read&&m.direction==="in").length;
  const totalUnread = threads.reduce((acc,m)=>acc+unread(m.user_id,m.channel||"naver"),0);

  // 발송 윈도우(채널별) — 마지막 손님(수신) 메시지 이후 이 시간 안에만 자유 발송 가능.
  // whatsapp 24h / instagram 7일(서버가 24h 밖이면 HUMAN_AGENT 태그 자동 적용) / naver·line 등 = 무제한
  const CH_SEND_WINDOW_H = { whatsapp:24, instagram:168 };
  const lastInboundMap = useMemo(()=>{
    const map={};
    msgs.forEach(m=>{
      if(m.direction!=="in") return;
      const key=(m.channel||"naver")+"_"+m.user_id;
      const t=new Date(m.created_at).getTime();
      if(!isFinite(t)) return;
      if(!map[key]||t>map[key]) map[key]=t;
    });
    return map;
  },[msgs]);
  const sendWindowActive = (uid,ch)=>{
    const win=CH_SEND_WINDOW_H[ch];
    if(!win) return true; // 무제한 채널 (naver/line 등)
    const li=lastInboundMap[ch+"_"+uid]||0;
    if(!li) return false; // 손님 수신 메시지 없음 → 윈도우 미시작
    return (Date.now()-li) <= win*3600*1000;
  };

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
    const ch = m.channel || "naver";
    // 1순위: Bliss 고객 매칭 (customer 실명)
    const matchedCust = chatCustMapFull[`${ch}_${uid}`];
    if (matchedCust?.name) return matchedCust.name;
    // 2순위: names dict (메시지에서 캐시된 user_name)
    if(names[uid]) return names[uid];
    // 3순위: msgs에서 user_name 채워진 메시지 찾기
    const withName = msgs.find(x=>x.user_id===uid&&x.user_name&&x.user_name.trim());
    if(withName) return withName.user_name;
    // 4순위: fallback "고객N"
    const uids=[...new Set(threads.map(t=>t.user_id))];
    return "고객"+(uids.indexOf(uid)+1||"");
  };

  const markRead = async(uid, ch)=>{
    // ch가 있으면 해당 채널만, 없으면 user_id 전체 (구버전 호환)
    const matches = (m) => m.user_id===uid && (!ch || (m.channel||"naver")===ch);
    const unreadCount = msgs.filter(m => matches(m) && !m.is_read && m.direction==="in").length;
    let url = SB_URL+`/rest/v1/messages?business_id=eq.${_activeBizId}&user_id=eq.`+uid+"&is_read=eq.false";
    if (ch) url += "&channel=eq."+encodeURIComponent(ch);
    try {
      await fetch(url, {method:"PATCH",headers:{...sbHeaders,Prefer:"return=minimal"},body:JSON.stringify({is_read:true})});
    } catch(e) { /* fail-safe — 로컬 상태는 갱신 */ }
    setMsgs(prev=>prev.map(m=>matches(m)?{...m,is_read:true}:m));
    if(onRead && unreadCount > 0) onRead(unreadCount);
  };

  const selectThread = (m)=>{
    const ch=m.channel||"naver";
    setSel({user_id:m.user_id,channel:ch,account_id:m.account_id});
    setReply("");
    setAiBooked(null);
    markRead(m.user_id, ch);
    setLinkPickerOpen(false); setLinkSearch("");
    if(onChatOpen) onChatOpen(true);
  };

  // 수동 고객 연결 — sns_accounts에 채널/user_id 추가
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkRemoteResults, setLinkRemoteResults] = useState([]);
  // 서버 검색 — 로컬에 없는 고객도 찾을 수 있게
  useEffect(()=>{
    const q = linkSearch.trim();
    if (!q || q.length < 2) { setLinkRemoteResults([]); return; }
    const t = setTimeout(async ()=>{
      try {
        const _bizId = data?.businesses?.[0]?.id || (data?.customers?.[0]?.businessId);
        if (!_bizId) return;
        // 다토큰 AND 검색 — "신영 8008" → name 어딘가 "신영" + phone 어딘가 "8008"
        // 숫자 토큰은 하이픈·공백 제거 후 매칭 (예: "010-3260-0787" → "01032600787")
        const _normNumeric = (t) => /[-\s+0-9]/.test(t) && /\d/.test(t) ? t.replace(/[-\s+]/g, '') : t;
        const tokens = q.split(/\s+/).filter(Boolean).map(_normNumeric);
        const fields = ['name','name2','phone','phone2','email','cust_num','cust_num2'];
        let filter;
        if (tokens.length === 1) {
          const enc = encodeURIComponent(tokens[0]);
          filter = `or=(${fields.map(f=>`${f}.ilike.*${enc}*`).join(',')})`;
        } else {
          const ands = tokens.map(tok => {
            const enc = encodeURIComponent(tok);
            return `or(${fields.map(f=>`${f}.ilike.*${enc}*`).join(',')})`;
          });
          filter = `and=(${ands.join(',')})`;
        }
        const rows = await sb.get("customers", `&business_id=eq.${_bizId}&is_hidden=eq.false&${filter}&limit=10`);
        // snake → camel 정규화 (로컬과 일관)
        const norm = (Array.isArray(rows) ? rows : []).map(r => ({
          ...r,
          custNum: r.custNum || r.cust_num || "",
          phone2: r.phone2 || "",
          name2: r.name2 || "",
        }));
        setLinkRemoteResults(norm);
      } catch { setLinkRemoteResults([]); }
    }, 250);
    return () => clearTimeout(t);
  },[linkSearch, data?.businesses, data?.customers]);
  const linkCandidates = useMemo(()=>{
    const q = linkSearch.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    // 다토큰 AND 검색 — 각 토큰이 어떤 필드에든 부분매칭되어야 함
    const tokens = q.split(/\s+/).filter(Boolean);
    const local = (data?.customers||[]).filter(c => {
      const fields = [c.name||"", c.name2||"", c.phone||"", c.phone2||"", c.custNum||"", c.email||""].map(s=>String(s).toLowerCase());
      return tokens.every(tok => fields.some(f => f.includes(tok)));
    });
    // 로컬 + 서버 결과 합치고 중복 제거
    const seen = new Set(local.map(c=>c.id));
    const remote = (linkRemoteResults||[]).filter(c => !seen.has(c.id));
    return [...local, ...remote].slice(0, 12);
  },[linkSearch, data?.customers, linkRemoteResults]);
  const linkCustomer = async (cust) => {
    if (!sel || !cust?.id) return;
    const ch = sel.channel || "naver";
    const accId = sel.account_id || (convo[0]?.account_id) || ch;
    const uid = sel.user_id;
    // 현재 sns_accounts 가져오기
    let cur = [];
    try {
      const rows = await sb.get("customers", `&id=eq.${cust.id}&select=sns_accounts&limit=1`);
      cur = rows?.[0]?.sns_accounts || [];
      if (typeof cur === "string") cur = JSON.parse(cur);
      if (!Array.isArray(cur)) cur = [];
    } catch {}
    const exists = cur.some(s => s?.channel === ch && s?.user_id === uid);
    if (!exists) {
      cur.push({ channel: ch, account_id: accId, user_id: uid, linked_at: new Date().toISOString() });
      try {
        const resp = await fetch(SB_URL+"/rest/v1/customers?id=eq."+cust.id, {
          method:"PATCH",
          headers:{...sbHeaders, "Content-Type":"application/json", Prefer:"return=minimal"},
          body: JSON.stringify({ sns_accounts: cur })
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>"");
          alert(`연결 저장 실패 (status=${resp.status}): ${txt.slice(0,200)}`);
          return;
        }
      } catch(e) { alert("연결 실패: "+e.message); return; }
    }
    // 로컬 data.customers 즉시 반영 — 기존이면 update, 없으면 insert (서버 검색 결과 포함)
    if (setData) setData(prev => {
      const list = prev?.customers || [];
      const existing = list.find(c => c.id === cust.id);
      const merged = { ...cust, snsAccounts: cur };
      const next = existing ? list.map(c => c.id === cust.id ? {...c, ...merged} : c) : [merged, ...list];
      return { ...prev, customers: next };
    });
    setLinkPickerOpen(false); setLinkSearch("");
  };

  // 직원 목록 (말머리 드롭다운용) + 선택된 직원
  const [empList, setEmpList] = useState([]);
  // 발신 직원 디폴트:
  //   1) 사용자가 수동 선택한 값(localStorage) 우선
  //   2) 없으면 로그인한 사용자 소속 지점명 (예: "강남점")
  //   3) fallback: 빈값
  const _userBranchName = (() => {
    const bid = (userBranches || [])[0];
    if (!bid) return "";
    const br = (data?.branches || []).find(b => b.id === bid);
    return br?.short || br?.name || "";
  })();
  const [selStaff, setSelStaff] = useState(() => {
    try {
      const saved = localStorage.getItem("bliss_inbox_sel_staff");
      if (saved !== null) return saved;
    } catch {}
    return _userBranchName || currentUser?.name || "";
  });
  // localStorage 동기화 — 수동 변경 시 저장
  const updateSelStaff = (v) => {
    setSelStaff(v);
    try {
      if (v) localStorage.setItem("bliss_inbox_sel_staff", v);
      else localStorage.removeItem("bliss_inbox_sel_staff");
    } catch {}
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.employees_v1&select=value&limit=1`, {
          headers: { ...sbHeaders, "Cache-Control": "no-cache" }, cache: "no-store"
        });
        const rows = await r.json();
        const v = rows?.[0]?.value;
        const arr = typeof v === "string" ? JSON.parse(v) : (Array.isArray(v) ? v : []);
        if (!cancelled) setEmpList(Array.isArray(arr) ? arr : []);
      } catch(e) { console.warn("[empList load]", e); }
    })();
    return () => { cancelled = true; };
  }, []);
  // 사용자 지점 정보 도착 시 디폴트 갱신 (localStorage 저장값 없을 때만)
  useEffect(() => {
    if (selStaff) return; // 이미 값 있음
    try { if (localStorage.getItem("bliss_inbox_sel_staff") !== null) return; } catch {}
    const fallback = _userBranchName || currentUser?.name || "";
    if (fallback) setSelStaff(fallback);
  }, [_userBranchName, currentUser?.name]);

  // 고객 연결 해제 — sns_accounts에서 현재 채팅방의 (channel, user_id) 항목 제거
  const unlinkCustomer = async () => {
    if (!sel) return;
    const cust = chatCustMapFull[sel.channel + "_" + sel.user_id];
    if (!cust?.id) return;
    if (!confirm(`이 대화방에서 [${cust.name}] 고객 연결을 해제할까요?\n\n해제 후 다른 고객으로 다시 연결할 수 있습니다.`)) return;
    const ch = sel.channel || "naver";
    const uid = sel.user_id;
    let cur = [];
    try {
      const rows = await sb.get("customers", `&id=eq.${cust.id}&select=sns_accounts&limit=1`);
      cur = rows?.[0]?.sns_accounts || [];
      if (typeof cur === "string") cur = JSON.parse(cur);
      if (!Array.isArray(cur)) cur = [];
    } catch {}
    const next = cur.filter(s => !(s?.channel === ch && s?.user_id === uid));
    try {
      const resp = await fetch(SB_URL+"/rest/v1/customers?id=eq."+cust.id, {
        method:"PATCH",
        headers:{...sbHeaders, "Content-Type":"application/json", Prefer:"return=minimal"},
        body: JSON.stringify({ sns_accounts: next })
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(()=>"");
        alert(`해제 실패 (status=${resp.status}): ${txt.slice(0,200)}`);
        return;
      }
    } catch(e) { alert("해제 실패: "+e.message); return; }
    if (setData) setData(prev => ({...prev, customers: (prev?.customers||[]).map(c => c.id === cust.id ? {...c, snsAccounts: next} : c)}));
  };

  const sendMsg = async(text, translated)=>{
    if(!sel||!text.trim()) return;
    setSending(true);
    try{
      const accId = sel.account_id && sel.account_id!=="unknown" ? sel.account_id : (allowedIds[0]||Object.keys(_ACC_AUTH)[0]);
      // AI 생성 답변이면 서버 큐와 로컬 echo 모두에 is_ai=true 표시
      const body = {account_id:accId,user_id:sel.user_id,message_text:text,status:"pending",channel:sel.channel||"naver"};
      if (replyIsAi) body.is_ai = true;
      // 답장 직원 정보 — 메시지 본문엔 영향 없고 messages 테이블 메타데이터에만 저장 (관리화면 표시용)
      // selStaff(드롭다운에서 선택한 직원) 우선, 없으면 로그인 currentUser
      const _staffName = (selStaff || currentUser?.name || "").trim();
      const _staffId = _staffName; // employee id = 이름 (employees_v1 구조)
      if (_staffName) {
        body.sent_by_staff_id = _staffId;
        body.sent_by_staff_name = _staffName;
      }
      // 응답 모델이 만든 한국어(또는 사용자 원문 한국어) 동반 → echo 처리 시 messages.translated_text에 사용
      if (translated && translated.trim()) body.translated_text = translated.trim();
      const r = await fetch(SB_URL+"/rest/v1/send_queue",{
        method:"POST",headers:{...sbHeaders,Prefer:"return=representation"},
        body:JSON.stringify(body)
      });
      if(r.ok){
        const localEcho = {user_id:sel.user_id,channel:sel.channel,direction:"out",account_id:accId,message_text:text,is_read:true,is_ai:!!replyIsAi,created_at:new Date().toISOString()};
        if (_staffName) { localEcho.sent_by_staff_id = _staffId; localEcho.sent_by_staff_name = _staffName; }
        if (translated && translated.trim()) localEcho.translated_text = translated.trim();
        setMsgs(prev=>[...prev,localEcho]);
        setReply(""); setReplyIsAi(false); setAiKoDraft(""); setAiBooked(null);
        // 답변 송신 시점에 들어와있는 미읽음 메시지 일괄 처리 (열어놓고 답변 작성 중 도착한 신규 포함)
        markRead(sel.user_id, sel.channel||"naver");
        // 확인 필요(inbox_followup) 있으면 직원이 답장했으니 해제
        const _fk = (sel.channel||"naver")+"_"+sel.user_id;
        if (followupMap[_fk]) {
          fetch(`${SB_URL}/rest/v1/inbox_followup?business_id=eq.${_activeBizId}&channel=eq.${encodeURIComponent(sel.channel||"naver")}&user_id=eq.${encodeURIComponent(sel.user_id)}&resolved_at=is.null`,
            {method:"PATCH",headers:{...sbHeaders,Prefer:"return=minimal"},body:JSON.stringify({resolved_at:new Date().toISOString()})})
            .then(()=>setFollowupMap(prev=>{const n={...prev};delete n[_fk];return n;})).catch(()=>{});
        }
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
    const fmt=s=>{
      const p=[];
      if(s.priceF){
        let t = "여"+Number(s.priceF).toLocaleString();
        if(s.memberPriceF) t += `(회원가 ${Number(s.memberPriceF).toLocaleString()})`;
        p.push(t);
      }
      if(s.priceM){
        let t = "남"+Number(s.priceM).toLocaleString();
        if(s.memberPriceM) t += `(회원가 ${Number(s.memberPriceM).toLocaleString()})`;
        p.push(t);
      }
      return `${s.name}: ${p.join(" / ")}`;
    };
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
    setAiLoading(true); setAiKoDraft("");
    // ✨ AI 버튼 — 새 state 기반 플로우 사용 (claude-haiku 메인)
    // 서버 /ai-suggest 호출 → ai_booking_agent (suggest_only=true) → booking INSERT 안 하고 답변만
    try {
      const res = await fetch("https://blissme.ai/ai-suggest", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          channel: sel.channel,
          account_id: sel.account_id,
          user_id: sel.user_id,
          business_id: _activeBizId,
          instruction: (reply||"").trim() || undefined,  // 입력칸에 직원이 쓴 지시가 있으면 → 그 내용을 고객 언어로 작성
        }),
      });
      const dd = await res.json().catch(()=>({}));
      if (res.ok && dd.ok && dd.reply) {
        setReply(dd.reply);
        setReplyIsAi(true);
        setAiKoDraft("");
        // 답변추천이 예약을 자동 등록했으면 → 인박스 피드백 + 타임라인 포커스 정보 저장
        setAiBooked(dd.booking && dd.booking.id ? dd.booking : null);
        // billing 차감
        try {
          const _bizId = data?.businesses?.[0]?.id;
          const _accBranch = (data?.branches||[]).find(b => String(b.naverAccountId||'')===String(sel?.account_id||'') || String(b.instagramAccountId||'')===String(sel?.account_id||''));
          const _bid = _accBranch?.id || userBranches[0];
          if (_bizId && _bid) {
            const { deductBilling } = await import('../../lib/billing');
            deductBilling({ bizId:_bizId, branchId:_bid, kind:'ai_call', refTable:'genAI_suggest' });
          }
        } catch {}
        setAiLoading(false);
        return;
      }
      // /ai-suggest 실패 시 → 구 Gemini 직접 호출 fallback
      console.warn("[genAI] /ai-suggest failed, fallback to Gemini direct:", dd);
    } catch (e) {
      console.warn("[genAI] /ai-suggest err, fallback:", e);
    }
    // ── Fallback: 기존 Gemini 직접 호출 (서버 통신 실패 시) ──
    const key=getGeminiKey();
    if(!key){alert("AI API 키가 설정되지 않았습니다. 관리설정에서 Gemini 키를 입력하세요.");setAiLoading(false);return;}
    try{
      // 한+영 혼용 시 영어 우선 — 마지막 in 메시지 기준. 영어 5자 이상이면 영어로 답변.
      const inMsgs = convo.filter(m=>m.direction==="in"&&m.message_text&&!String(m.message_text).startsWith("[미디어]"));
      const _lastInTxt = String(inMsgs[inMsgs.length-1]?.message_text || "");
      const _ko = (_lastInTxt.match(/[가-힣ᄀ-ᇿ]/g)||[]).length;
      const _en = (_lastInTxt.match(/[a-zA-Z]/g)||[]).length;
      const _enPriority = _en >= 5 || (_en > 0 && _ko === 0);
      const langName = _enPriority ? "영어" : "한국어";
      // [미디어]·reaction 제외하고 최근 6개
      const lastMsgs=convo.filter(m=>m.message_text&&!String(m.message_text).startsWith("[미디어]")&&!String(m.message_text).startsWith("[reaction]"))
        .slice(-6).map(m=>(m.direction==="in"?"고객":"직원")+": "+m.message_text).join("\n");

      // 사용자가 AI 설정에 등록한 프롬프트
      const chatPrompt = window.__aiChatPrompt || localStorage.getItem("bliss_ai_chat_prompt") || "";
      // DB 기반 자동 컨텍스트 (가격표/지점/고객 다회권)
      const priceCtx = svcPriceText ? `\n\n[시술 가격표 — DB 실시간]\n${svcPriceText}` : "";
      const branchCtx = branchText ? `\n\n[지점 정보]\n${branchText}` : "";
      const pkgInfo = findCustPkgInfo(sel.user_id);
      const pkgCtx = pkgInfo ? `\n\n[이 고객의 다회권]\n${pkgInfo}` : "";
      // 📚 RAG: 학습 문서에서 마지막 고객 메시지 관련 청크 검색
      let docsCtx = "";
      try {
        const lastInMsg = convo.filter(m=>m.direction==="in"&&m.message_text&&!String(m.message_text).startsWith("[")).slice(-1)[0]?.message_text || "";
        const bizId = data?.business?.id || data?.businesses?.[0]?.id || _activeBizId;
        if (lastInMsg && bizId) {
          const hits = await searchDocs({ question: lastInMsg, businessId: bizId, geminiKey: key, threshold: 0.0, count: 8 });
          const ctx = buildDocsContext(hits);
          if (ctx) docsCtx = `\n\n${ctx}`;
        }
      } catch (_) { /* RAG 실패해도 답변은 진행 */ }
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

[콜라보·체험단 정책 — 최우선 적용 ⛔]
★ 고객 메시지에 다음 키워드 있으면 즉시 콜라보 분기 (아래 정책들보다 우선):
  - 한국어: 콜라보, 콜라보레이션, 협업, 체험단, 광고, PR, 인플루언서, 협찬, 콜라보레이트
  - 영어: collaboration, collab, partnership, influencer, sponsored, brand deal, PR
  - 일본어: コラボ, コラボレーション, インフルエンサー, 体験
  - 직전 대화 맥락에 위 키워드가 한 번이라도 있었으면 동일하게 콜라보 분기 유지
★ ⛔ 가격 안내·예약 진행·시술명 안내·시간 안내 절대 금지
★ 답변은 아래 문구만 출력 (다른 내용·이모지·인사 추가 금지):
  • 한국어: "콜라보 문의 감사합니다 😊 마케팅 담당자가 업무시간(평일 10~18시)에 직접 연락드릴게요!"
  • English: "Thank you for your collaboration inquiry! 😊 Our marketing team will reach out to you directly during business hours (Mon-Fri, 10am-6pm KST)."
  • 日本語: "コラボのお問い合わせありがとうございます 😊 マーケティング担当者が営業時間(平日10時〜18時)に直接ご連絡いたします!"
★ 콜라보 = 체험단(무료 시술 + SNS 후기) 마케팅. 별도 마케팅 담당자가 직접 처리하므로 AI는 인계만.

[가격 안내 정책 — 매우 중요]
★ 고객이 가격을 물으면 반드시 "신규 첫방문 할인가"를 메인으로 강조. 대부분 고객이 처음이라 이 가격을 낸다.
★ 정상가(154,000/176,000원 등)만 단독 안내 금지! 첫방문가를 앞에 내세워서 예약 유도할 것.
★ 브라질리언 예시:
  • 한국어: "브라질리언 왁싱 신규 첫방문 이벤트 진행 중이에요! 여성 104,000원 / 남성 126,000원에 받아보실 수 있어요 💕 (정상가 154,000/176,000에서 5만원 할인!) 예약 도와드릴까요? 😊"
  • English: "We have a first-visit special! Brazilian wax is 104,000 KRW (women) / 126,000 KRW (men) for first-time customers — normally 154,000/176,000. Would you like to book? 💕"
★ 반드시 마지막에 "예약 도와드릴까요? / Would you like to book?" 로 예약 유도
★ 회원가 정책 — 매우 중요:
  • 회원가 자격 = 다담권 / 다회권 / 연간회원권 중 하나라도 보유한 고객
  • 회원가는 시술마다 다름. [시술 가격표]의 "(회원가 N)" 형식 참고. 회원가 표기 없는 시술은 회원가 적용 X.
  • [이 고객의 다회권] 블록에 보유권이 있으면 → 정상가가 아닌 회원가로 안내. "○○ 시술 회원가 N원에 받으실 수 있어요"
  • 보유권 없는 신규/일반 고객 → 첫방문가(있으면) 또는 정상가 안내. 회원가 언급 시엔 "다담권/다회권/연간회원권 구매하시면 회원가 적용돼요" 정도로 옵션 안내
  • ⛔ "연간회원권 가격은 OOO원" 같은 패키지 가격 안내로 회원가를 대체하지 말 것. 회원가는 보유 시 시술가, 패키지 가격과 별개

[왁서 성별 안내 정책]
★ "남자 왁서 계세요?" / "남자 직원 있나요?" 같은 질문엔:
  • 한국어: "네! 남성 왁서도 있어요 😊 예약 시 '남자 왁서 요청'이라고 말씀해주시면 해당 지점·시간에 가능한지 확인해서 배정해드릴게요~"
  • English: "Yes, we have male waxers! Please request a male waxer when booking and we'll arrange one based on availability at your branch/time."
★ "지점마다 다르다 / 상황에 따라 달라진다" 같은 애매한 표현 금지. 남성 왁서 있음을 명확히 알리고 예약 유도.
★ 여자 왁서 선호 고객도 동일 — 예약 요청사항 기재 시 배정 도와드린다고 안내
★ 특정 관리사 이름은 언급 금지

[시간 추론 정책 — 매우 중요]
★ 고객이 시각만 말하고 오전/오후 명시 안 하면, [지점 정보]의 영업시간 내로 자동 해석. ⛔ 절대 "오전인가요 오후인가요?" 같은 되묻기 금지.
  • 영업 11~21시인 매장에서 "3시" / "3시 예약" → 오후 3시(15:00)로 즉시 해석하고 예약 진행
  • 영업 11~21시인 매장에서 "10시" → 오전 10시는 영업 외 → 영업 시작 시각(11시)부터 가능 안내
  • 영업시간 외 시각 명시(예: 영업 11~21시인데 새벽 3시) → 영업 외임을 알리고 영업시간(11~21시) 내로 재조정 안내
★ "오전 3시" / "오후 3시" / "AM 3" / "PM 3" / "15시" 처럼 명시·24시간제는 그대로 사용
★ 모호한 시각 → 영업시간으로 단일 해석 → 그 시각으로 예약 진행 ("오후 3시로 예약 도와드릴까요?")`;

      const prompt=`${chatPrompt}${salesPolicyCtx}${priceCtx}${branchCtx}${pkgCtx}${docsCtx}\n\n[대화]\n${lastMsgs}\n\n고객 마지막 메시지에 답변하세요. 답변은 위 [학습 문서] 내용을 최우선으로 참고하세요.\n\n[형식 규칙]\n- 단락 구분이 필요한 곳에 줄바꿈(\\n) 사용 (소개·인사·정보·예약요청 등 각 단락마다)\n- 글머리 항목은 줄바꿈 + "•" 또는 "-" 사용\n- 한 줄로 다 붙이지 말고 시각적으로 읽기 쉽게 구성\n\nJSON만 출력 (reply의 줄바꿈은 \\n으로 escape):\n{"reply":"${langName}로 작성한 답변","ko":"한국어 번역"}`;
      const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+key,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
      if(res.status===429){alert("AI 요청 한도 초과. 잠시 후 시도해주세요.");return;}
      if(!res.ok){const err=await res.text();alert("AI API 오류: "+res.status);console.error("[genAI] API error:",err);return;}
      // billing 차감 — sel.account_id로 매장 매핑, 못 찾으면 첫 userBranch
      try {
        const _bizId = data?.businesses?.[0]?.id;
        const _accBranch = (data?.branches||[]).find(b => String(b.naverAccountId||'')===String(sel?.account_id||'') || String(b.instagramAccountId||'')===String(sel?.account_id||''));
        const _bid = _accBranch?.id || userBranches[0];
        if (_bizId && _bid) {
          const { deductBilling } = await import('../../lib/billing');
          deductBilling({ bizId:_bizId, branchId:_bid, kind:'ai_call', refTable:'genAI_messages' });
        }
      } catch {}
      const dd=await res.json();
      let raw=(dd.candidates?.[0]?.content?.parts?.[0]?.text||"").replace(/```json|```/g,"").trim();
      if(!raw){alert("AI 응답이 비어있습니다.");return;}
      try{const p=JSON.parse(raw);if(p.reply){setReply(p.reply);setReplyIsAi(true);setAiKoDraft(p.ko||"");}else{setReply(raw);setReplyIsAi(true);}}
      catch{setReply(raw);setReplyIsAi(true);}
    }catch(e){console.error("[genAI]",e);alert("AI 오류: "+e.message);}finally{setAiLoading(false);}
  };

  // 🤖 대화 맥락 분석 → AI 자동 예약 생성 (서버 /ai-book 호출)
  // v3.7.218: confirm() 제거 — iOS PWA·일부 모바일 브라우저에서 차단되어 동작 불가하던 문제 해결
  const aiBook = async()=>{
    if(!sel||aiBookLoading) return;
    setAiBookLoading(true);
    try{
      const res=await fetch("https://blissme.ai/ai-book",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({channel:sel.channel,account_id:sel.account_id,user_id:sel.user_id,business_id:_activeBizId}),
      });
      const dd=await res.json().catch(()=>({}));
      if(!res.ok||!dd?.ok){
        alert("AI 예약 실패: "+(dd?.error||res.status));
        return;
      }
      if(dd.booked){
        // 신규 고객 즉시 캐시 반영 — 새로고침 없이 👤 배지가 바로 뜨도록
        // (직원 수동 [🤖 예약]은 status=reserved로 저장됨, AI 자동응대는 status=request 유지)
        if (dd.cust_id && setData) {
          try {
            const newCust = await sb.get('customers', dd.cust_id);
            if (newCust && newCust.id) {
              setData(prev => {
                const list = prev?.customers || [];
                const exists = list.some(c => c.id === newCust.id);
                return {
                  ...prev,
                  customers: exists
                    ? list.map(c => c.id === newCust.id ? newCust : c)
                    : [...list, newCust]
                };
              });
            }
          } catch(e) { console.warn("[aiBook] cust refresh err", e); }
        }
        alert("✅ 예약이 미배정으로 생성됐습니다.\n\n대화 헤더의 📅 버튼으로 확인/배정하세요.");
      }else{
        // 정보 부족 → 타임라인 예약 모달 열어서 직원이 부족한 부분 채우게 함
        const aiReply = (dd.reply||"").trim();
        const cust = chatCustMapFull?.[sel.channel+"_"+sel.user_id] || {};
        const today = new Date().toISOString().slice(0,10);
        const parsed = dd.parsed || {};
        // 마지막 IN 메시지 본문에서 정규식으로 추출 (서버 parsed 없을 때 fallback)
        const lastInTxt = [...(convo||[])].reverse().find(m=>m.direction==='in'&&m.message_text)?.message_text || '';
        // 전화: 010-XXXX-XXXX 또는 11자리 숫자
        const _phMatch = lastInTxt.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/);
        const _ph = _phMatch ? _phMatch[0].replace(/[^0-9]/g,'') : '';
        // 한글 이름 (2~4자) — 첫 한글 단어
        const _nmMatch = lastInTxt.match(/(?<![가-힣])[가-힣]{2,4}(?![가-힣])/);
        const _nm = _nmMatch ? _nmMatch[0] : '';
        // 지점명
        const _branches = (data?.branches||[]);
        const _bid = (() => {
          for (const b of _branches) {
            const sn = (b.short||'').replace(/점$/,'');
            if (sn && lastInTxt.includes(sn)) return b.id;
          }
          return cust.bid || '';
        })();
        // 날짜 키워드
        const _dateGuess = (() => {
          const d = new Date();
          if (lastInTxt.includes('내일')) { d.setDate(d.getDate()+1); }
          else if (lastInTxt.includes('모레')) { d.setDate(d.getDate()+2); }
          else return parsed.date || today;
          return d.toISOString().slice(0,10);
        })();
        // 시간 — 대화 전체에서 가장 최근 언급된 시각 추출 (마지막 메시지엔 시간이 없을 수 있음)
        const _parseTime = s => {
          if (!s) return '';
          let m = s.match(/([01]?\d|2[0-3])\s*:\s*([0-5]\d)/);
          if (m) return String(+m[1]).padStart(2,'0') + ':' + m[2];
          m = s.match(/(오전|오후|아침|저녁|밤|낮)?\s*([01]?\d|2[0-3])\s*시\s*(반|[0-5]?\d\s*분)?/);
          if (m) {
            let h = +m[2]; const ap = m[1];
            if ((ap === '오후' || ap === '저녁' || ap === '밤' || ap === '낮') && h < 12) h += 12;
            else if (!ap && h >= 1 && h <= 9) h += 12; // 영업시간 11~21시 — 오전/오후 표기 없는 1~9시는 오후로 추정
            let mm = 0;
            if (m[3]) { if (m[3].includes('반')) mm = 30; else { const dd2 = m[3].match(/\d+/); if (dd2) mm = +dd2[0]; } }
            return String(h).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
          }
          return '';
        };
        // 타임라인 "시간단위"(tl_settings.tu, 기본 5분)에 맞춰 시각 스냅 — 30분 단위면 :00/:30으로
        const _timeUnit = (() => { try { return Number(JSON.parse(localStorage.getItem('tl_settings')||'{}').tu) || 5; } catch { return 5; } })();
        const _snapTime = t => {
          if (!t) return '';
          const [h,mm] = t.split(':').map(Number);
          if (isNaN(h) || isNaN(mm)) return t;
          let tot = Math.round((h*60+mm)/_timeUnit) * _timeUnit;
          tot = Math.max(0, Math.min(tot, 23*60+55));
          return String(Math.floor(tot/60)).padStart(2,'0') + ':' + String(tot%60).padStart(2,'0');
        };
        const _timeGuess = _snapTime([...(convo||[])].reverse().map(m=>_parseTime(m.message_text||'')).find(Boolean) || '');
        // 예약경로 — 대화 채널명 (네이버톡톡/인스타/왓츠앱/카톡/LINE…)
        const _SRC_BY_CH = {naver:'네이버톡톡',instagram:'인스타',whatsapp:'WhatsApp',kakao:'카톡',kakaotalk:'카톡',line:'LINE',telegram:'텔레그램'};
        const _srcGuess = _SRC_BY_CH[sel.channel] || '';
        if (setPendingOpenRes && setPage) {
          setPendingOpenRes({
            _isNew: true,
            _aiBookFallback: true,
            _prefill: {
              custId: cust.id || null,
              custName: parsed.cust_name || cust.name || _nm || '',
              custPhone: parsed.cust_phone || cust.phone || _ph || '',
              custEmail: parsed.cust_email || cust.email || '',
              custGender: parsed.cust_gender || cust.gender || '',
              date: parsed.date || _dateGuess,
              time: _snapTime(parsed.time) || _timeGuess || '',
              dur: parsed.dur || 60,
              matchedServiceIds: parsed.selected_services || [],
              matchedTagIds: parsed.selected_tags || [],
              _isNewCust: !cust.id,
              source: _srcGuess,
            },
            bid: parsed.bid || _bid || '',
            chatChannel: sel.channel,
            chatAccountId: sel.account_id,
            chatUserId: sel.user_id,
          });
          setPage('timeline');
          if (typeof setSel === 'function') setSel(null);
          if (typeof onClosePanel === 'function') onClosePanel();
        } else {
          const hint = aiReply ? `\n\nAI 응답:\n${aiReply.slice(0,200)}` : "";
          alert("ℹ️ AI 정보 부족 — 타임라인에서 직접 등록해주세요."+hint);
        }
      }
    }catch(e){console.error("[aiBook]",e);alert("AI 예약 오류: "+e.message);}
    finally{setAiBookLoading(false);}
  };

  // 🚨 오류신고 — AI 고객응대오류 원클릭 접수 (id_l47143d65l 신영 임시안)
  // 버튼 클릭 → 현재 화면 자동 캡처 → bliss_requests_v1에 "AI 고객응대오류"로 수정요청 등록.
  // QuickRequest(우클릭 수정요청)와 동일 인프라(html2canvas + uploadImageToStorage + bliss_requests_v1) 재사용.
  const reportAiError = async()=>{
    if(!sel||aiErrBusy) return;
    setAiErrBusy(true);
    try{
      let imgUrl="";
      try{
        const html2canvas=(await import("html2canvas")).default;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const canvas=await html2canvas(document.body,{
          backgroundColor:"#ffffff", scale:Math.min(1.5,window.devicePixelRatio||1),
          useCORS:true, logging:false, x:window.scrollX, y:window.scrollY,
          width:window.innerWidth, height:window.innerHeight,
          windowWidth:document.documentElement.scrollWidth, windowHeight:document.documentElement.scrollHeight,
        });
        const dataUrl=canvas.toDataURL("image/jpeg",0.82);
        try{ imgUrl=await uploadImageToStorage(dataUrl,"requests"); }catch{ imgUrl=""; }
      }catch(e){ console.warn("[reportAiError capture]",e); }
      // 대화 맥락 (최근 4건) + 채널/고객 식별
      const ctx=(convo||[]).slice(-4).map(m=>`${m.direction==="out"?(m.is_ai?"AI":"매장"):"고객"}: ${String(m.message_text||"").replace(/\s+/g," ").slice(0,140)}`).join("\n");
      const chLabel=_ACC_NAME[sel.account_id]||sel.channel||"";
      const desc=`[AI 고객응대오류] ${chLabel} · ${sel.user_id||""}\n\nAI 자동응대가 잘못 답변한 건으로 직원이 접수했습니다. (화면 캡처 첨부)\n\n[최근 대화]\n${ctx}`;
      const r=await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.bliss_requests_v1&select=value`,{headers:sbHeaders});
      const rows=await r.json();
      let list=[]; try{ const v=rows?.[0]?.value; list=typeof v==="string"?JSON.parse(v):(Array.isArray(v)?v:[]); }catch{}
      const row={ id:genId(), name:currentUser?.name||"직원", branchId:userBranches?.[0]||"", description:desc,
        images:imgUrl?[imgUrl]:[], status:"pending", reply:"", createdAt:new Date().toISOString(), page:location.pathname, kind:"ai_error" };
      await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`,{
        method:"POST", headers:{...sbHeaders, Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify({ business_id:_activeBizId, id:"bliss_requests_v1", key:"bliss_requests_v1", value:JSON.stringify([row,...list]) }),
      });
      alert("✓ AI 고객응대오류로 접수됐어요. (화면 캡처 첨부)\n공지&요청에서 확인할 수 있어요.");
    }catch(e){ console.error("[reportAiError]",e); alert("오류 접수 실패: "+(e?.message||e)); }
    finally{ setAiErrBusy(false); }
  };

  // 🚫 대화 차단/삭제 (스팸 대응 — id_lqxe16rw71). 차단=서버가 인입 저장·번역·AI 전부 skip.
  const [blockedKeys, setBlockedKeys] = useState(()=>new Set());
  useEffect(()=>{ (async()=>{ try{
    const r=await fetch(`${SB_URL}/rest/v1/blocked_chats?business_id=eq.${_activeBizId}&select=channel,user_id&limit=2000`,{headers:sbHeaders});
    const rows=await r.json(); setBlockedKeys(new Set((rows||[]).map(b=>(b.channel||"")+"_"+b.user_id)));
  }catch{} })(); },[]);
  const [chatAction, setChatAction] = useState(null); // {type:'block'|'unblock'|'delete'} 커스텀 확인 모달
  const _selKey = sel ? (sel.channel||"naver")+"_"+sel.user_id : "";
  const selBlocked = !!_selKey && blockedKeys.has(_selKey);
  const doBlockToggle = async()=>{
    if(!sel) return;
    const ch=sel.channel||"naver", uid=sel.user_id, key=ch+"_"+uid;
    try{
      if(selBlocked){
        await fetch(`${SB_URL}/rest/v1/blocked_chats?business_id=eq.${_activeBizId}&channel=eq.${encodeURIComponent(ch)}&user_id=eq.${encodeURIComponent(uid)}`,{method:"DELETE",headers:sbHeaders});
        setBlockedKeys(prev=>{const n=new Set(prev);n.delete(key);return n;});
      }else{
        await fetch(`${SB_URL}/rest/v1/blocked_chats?on_conflict=business_id,channel,user_id`,{method:"POST",headers:{...sbHeaders,Prefer:"resolution=merge-duplicates,return=minimal"},
          body:JSON.stringify({business_id:_activeBizId,channel:ch,user_id:uid,created_by:currentUser?.name||""})});
        setBlockedKeys(prev=>new Set(prev).add(key));
        try{ markRead(uid, ch); }catch{}
      }
    }catch(e){ console.warn("[block]",e); }
    setChatAction(null);
  };
  const doDeleteChat = async()=>{
    if(!sel) return;
    const ch=sel.channel||"naver", uid=sel.user_id;
    try{
      await fetch(`${SB_URL}/rest/v1/messages?business_id=eq.${_activeBizId}&channel=eq.${encodeURIComponent(ch)}&user_id=eq.${encodeURIComponent(uid)}`,{method:"DELETE",headers:sbHeaders});
      setMsgs(prev=>prev.filter(m=>!(m.user_id===uid&&(m.channel||"naver")===ch)));
      setSel(null);
    }catch(e){ console.warn("[deleteChat]",e); }
    setChatAction(null);
  };

  // 📋 자주 쓰는 답변(클립보드) — 매장 공유 로드/저장/삽입
  const loadQuickReplies = useCallback(async()=>{
    try{
      const r=await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.quick_replies_v1&select=value`,{headers:{...sbHeaders,"Cache-Control":"no-cache"},cache:"no-store"});
      const rows=await r.json(); const v=rows?.[0]?.value;
      const list=typeof v==="string"?JSON.parse(v):(Array.isArray(v)?v:[]);
      setQuickReplies(Array.isArray(list)?list:[]);
    }catch(e){ console.warn("[quickReplies load]",e); }
  },[]);
  useEffect(()=>{ loadQuickReplies(); },[loadQuickReplies]);
  const persistQuickReplies = async(list)=>{
    setQuickReplies(list);
    try{
      await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`,{
        method:"POST", headers:{...sbHeaders, Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify({ business_id:_activeBizId, id:"quick_replies_v1", key:"quick_replies_v1", value:JSON.stringify(list) }),
      });
    }catch(e){ console.warn("[quickReplies save]",e); alert("자주답변 저장 실패: "+(e?.message||e)); }
  };
  // 동적 가격표 토큰 {{가격표:왁싱}} {{가격표:스킨케어}} (+:en) → data.services 실시간 생성 (단일 소스)
  const _PRICE_CAT_GROUPS = { "왁싱":["브라질리언","바디"], "스킨케어":["스킨케어","에너지테라피"] };
  const _EN_CAT = { "브라질리언":"Brazilian Waxing","바디":"Body Waxing","스킨케어":"Skin Care","에너지테라피":"Energy Therapy","케어":"After Care" };
  const _EN_SVC = { "브라질리언":"Brazilian","브라질리언 + 케어":"Brazilian + Care","안아픈왁싱":"Painless Waxing","브라질리언 + 궁테라피":"Brazilian + Gung Therapy","깨끗":"Clean-up","간단":"Basic","항문 왁싱":"Anal","비키니":"Bikini","지정관리":"Custom Area","산모관리":"Maternity","브라질리언 + 풀바디":"Brazilian + Full Body","풀바디":"Full Body","다리 전체":"Full Legs","다리 절반":"Half Legs","팔 전체":"Full Arms","팔 절반":"Half Arms","등 전체":"Full Back","등 절반":"Half Back","가슴":"Chest","뒷목":"Nape","겨드랑이":"Underarm","손 전체":"Full Hands","손 절반":"Half Hands","엉덩이":"Buttocks","유륜":"Areola","발가락":"Toes","배":"Stomach","앞목":"Front Neck","발등":"Top of Feet","브라질리언 + 머슬랜더":"Brazilian + MuscleLander","하이드라 스킨케어":"Hydra Skin Care","하이드라 스킨케어 플러스":"Hydra Skin Care Plus","리버스 하이드라 케어":"Reverse Hydra Care","리얼 애프터 케어":"Real After Care","리버스 필링 케어":"Reverse Peeling Care","리버스 에이징 케어(+글로우 필)":"Reverse Aging Care (+Glow Peel)","천방케어 100":"Premium Care 100","천방케어 200":"Premium Care 200","천방케어 300":"Premium Care 300","클래식 플러스 천방케어 500":"Premium Care 500","프리미엄 천방케어 700":"Premium Care 700","시그니처 천방케어 1000":"Signature Care 1000","에너지 20분":"Energy 20min","에너지 부분 30분":"Energy Partial 30min","에너지 60분":"Energy 60min","근육증강 머슬랜더 30분":"MuscleLander 30min","케어":"Care","진정팩":"Soothing Pack","기기진정관리":"Device Soothing","기기스크럽":"Device Scrub","재생관리":"Regeneration Care" };
  const buildPriceTable = (groupKey, lang)=>{
    const catNames=_PRICE_CAT_GROUPS[groupKey]||[];
    const _cats=(qrSvc?.cats?.length?qrSvc.cats:(data?.cats||[]));
    const _svcs=(qrSvc?.services?.length?qrSvc.services:(data?.services||[]));
    const cats=_cats.filter(c=>catNames.includes(c.name)).sort((a,b)=>(a.sort||0)-(b.sort||0));
    const svcs=_svcs.filter(s=>s.name&&(s.priceF||s.priceM)&&s.showInGuide&&!/[0-9]+\s*회/.test(s.name));
    const lines=[];
    cats.forEach(c=>{
      const items=svcs.filter(s=>s.cat===c.id).sort((a,b)=>(Number(b.priceF)||Number(b.priceM)||0)-(Number(a.priceF)||Number(a.priceM)||0));
      if(!items.length) return;
      lines.push(lang==="en" ? `[${_EN_CAT[c.name]||c.name}]` : `[${c.name}]`);
      items.forEach(s=>{
        const nm=lang==="en" ? (_EN_SVC[s.name]||s.name) : s.name;
        const f=s.priceF?Number(s.priceF).toLocaleString():null, m=s.priceM?Number(s.priceM).toLocaleString():null;
        let price;
        if(f&&m&&Number(s.priceF)===Number(s.priceM)) price=lang==="en"?`${f} KRW`:`${f}원`;
        else if(f&&m) price=lang==="en"?`Women ${f} / Men ${m} KRW`:`여 ${f} / 남 ${m}`;
        else price=lang==="en"?`${f||m} KRW`:`${f||m}원`;
        lines.push(`· ${nm} ${price}`);
      });
    });
    return lines.join("\n");
  };
  const expandPriceTokens = (text)=>{
    if(!text || text.indexOf("{{가격표")<0) return text;
    return text.replace(/\{\{가격표:(왁싱|스킨케어)(:en)?\}\}/g,(_m,g,en)=> buildPriceTable(g, en?"en":"ko") || (en?"(price unavailable)":"(가격 정보 없음)"));
  };

  const insertQuickReply = (rawText)=>{
    const text = expandPriceTokens(rawText);
    if(!text) return;
    const ta=document.getElementById("bliss-reply-ta");
    if(ta && typeof ta.selectionStart==="number"){
      const s=ta.selectionStart, e=ta.selectionEnd, cur=reply||"";
      const next=cur.slice(0,s)+text+cur.slice(e);
      setReply(next); setReplyIsAi(false); setAiKoDraft("");
      requestAnimationFrame(()=>{ try{ ta.focus(); const p=s+text.length; ta.setSelectionRange(p,p);}catch(_){} });
    } else {
      setReply(r=> r ? (r.replace(/\s*$/,"")+"\n"+text) : text); setReplyIsAi(false);
    }
    setQrOpen(false);
  };
  const saveQrDraft = ()=>{
    const label=(qrDraft?.label||"").trim(), text=(qrDraft?.text||"").trim();
    if(!text){ alert("내용을 입력하세요."); return; }
    const _bid = qrDraft?.branchId || undefined; // 지점별 자주답변 (없으면 전체 공용)
    const list = qrDraft?.id
      ? quickReplies.map(q=>q.id===qrDraft.id?{...q,label,text,branchId:_bid}:q)
      : [...quickReplies,{id:genId(),label,text,branchId:_bid}];
    persistQuickReplies(list); setQrDraft(null);
  };
  const delQr = (id)=>{ if(!window.confirm("이 답변을 삭제할까요?"))return; persistQuickReplies(quickReplies.filter(q=>q.id!==id)); if(qrDraft?.id===id) setQrDraft(null); };

  // 자주답변 버튼 (입력창 위 버튼 행) — 모바일/데스크탑 공용
  const renderQrButton = ()=> (
    <button onClick={()=>setQrOpen(o=>!o)} title="자주 쓰는 답변 — 클릭해서 입력창에 넣기"
      style={{padding:forceCompact?"5px 10px":"6px 12px",background:qrOpen?"#EEF2FF":"#F8FAFC",color:"#4338CA",border:"1px solid "+(qrOpen?"#A5B4FC":T.border),borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:"pointer",fontWeight:T.fw.bold,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
      <I name="clipboard" size={13}/> 자주답변
    </button>
  );
  // 자주답변 패널 — 받은메시지함 오른쪽 별도 카드 패널(createPortal). 공통/지점별 그룹.
  const renderQrPanel = ()=> {
    if(!qrOpen) return null;
    const visibleQr = quickReplies.filter(q=>!q.branchId || !userBranches || userBranches.length===0 || userBranches.includes(q.branchId));
    const commonQr = visibleQr.filter(q=>!q.branchId);
    const branchGroups = {};
    visibleQr.filter(q=>q.branchId).forEach(q=>{ (branchGroups[q.branchId]=branchGroups[q.branchId]||[]).push(q); });
    const brName = (bid)=>{ const b=(data?.branches||[]).find(x=>x.id===bid); return b?.short||b?.name||bid; };
    const renderCard = (q)=> qrManage ? (
      <button key={q.id} onClick={()=>setQrDraft({...q})} title="클릭해서 수정"
        style={{display:"block",width:"100%",minWidth:0,textAlign:"left",padding:"9px 11px",border:"1px solid "+(qrDraft?.id===q.id?"#4338CA":T.border),borderRadius:11,background:qrDraft?.id===q.id?"#EEF2FF":"#fff",cursor:"pointer",fontFamily:"inherit",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
        <div style={{fontSize:12.5,fontWeight:800,color:T.text,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.label||"(제목 없음)"}</div>
        <div style={{fontSize:11,color:T.textMuted,lineHeight:1.4,maxHeight:30,overflow:"hidden"}}>{q.text}</div>
      </button>
    ) : (
      <button key={q.id} onClick={()=>insertQuickReply(q.text)} title="클릭해서 입력창에 넣기"
        style={{display:"block",width:"100%",minWidth:0,textAlign:"left",padding:"9px 11px",border:"1px solid "+T.border,borderRadius:11,background:"#fff",cursor:"pointer",fontFamily:"inherit",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
        <div style={{fontSize:12.5,fontWeight:800,color:"#4338CA",marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.label||"(제목 없음)"}</div>
        <div style={{fontSize:11,color:T.textMuted,lineHeight:1.4,maxHeight:30,overflow:"hidden"}}>{q.text}</div>
      </button>
    );
    const grid = (items)=>(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>{items.map(renderCard)}</div>);
    const branchOpts = Object.keys(branchGroups);
    const curBranch = (qrBranchFilter && branchGroups[qrBranchFilter]) ? qrBranchFilter : (branchOpts[0]||"");
    const addBtn = (scopeBranchId)=>(<button onClick={()=>setQrDraft({label:"",text:"",branchId:scopeBranchId||undefined})} title="새 답변 추가" style={{padding:"1px 9px",fontSize:16,fontWeight:800,lineHeight:1.25,borderRadius:7,border:"1px solid #C7D2FE",background:"#EEF2FF",color:"#4338CA",cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>+</button>);
    // 받은메시지함(.msg-panel) 오른쪽 끝에 붙이기 — 공간 부족(모바일 등)하면 우측 플로팅 폴백
    let pos = { right:8, top:88, maxHeight:"calc(100vh - 116px)", width:380, maxWidth:"94vw" };
    try { const mp=document.querySelector(".msg-panel"); const r=mp&&mp.getBoundingClientRect();
      if(r && (window.innerWidth - r.right) > 300) pos = { left:Math.round(r.right), top:Math.round(r.top), height:Math.round(r.height), width:Math.min(460, window.innerWidth - r.right - 8) };
    } catch(_){}
    const isDocked = pos.left!==undefined;
    return createPortal(
      <div data-qr style={{position:"fixed",...pos,display:"flex",flexDirection:"column",background:"#F8FAFC",border:"1px solid "+T.border,borderRadius:isDocked?"0 14px 14px 0":14,boxShadow:isDocked?"8px 0 30px rgba(0,0,0,0.14)":"0 18px 55px rgba(0,0,0,0.25)",zIndex:9600}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:"1px solid "+T.border,flexShrink:0,background:"#fff",borderRadius:isDocked?"0 14px 0 0":"14px 14px 0 0"}}>
          <span style={{fontSize:13,fontWeight:800,color:"#4338CA",display:"inline-flex",alignItems:"center",gap:6}}><I name="clipboard" size={14} color="#4338CA"/>자주 쓰는 답변</span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{ setQrManage(m=>!m); setQrDraft(null); }} style={{padding:"4px 11px",fontSize:11.5,fontWeight:700,borderRadius:7,border:"1px solid "+T.border,background:qrManage?"#4338CA":"#fff",color:qrManage?"#fff":T.text,cursor:"pointer",fontFamily:"inherit"}}>{qrManage?"완료":"관리"}</button>
            <button onClick={()=>{ setQrOpen(false); setQrManage(false); setQrDraft(null); }} style={{padding:"4px 10px",fontSize:12,fontWeight:700,borderRadius:7,border:"1px solid "+T.border,background:"#fff",color:T.textMuted,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"4px 14px 14px"}}>
          {/* 상단 editor — 추가/수정 공통, 저장/취소/삭제 상단 */}
          {qrManage && qrDraft && (
            <div style={{margin:"2px 0 12px",padding:11,border:"1px solid #C7D2FE",borderRadius:11,background:"#fff",display:"flex",flexDirection:"column",gap:7,boxShadow:"0 2px 12px rgba(67,56,202,0.14)"}}>
              <div style={{display:"flex",gap:6}}>
                <button onClick={saveQrDraft} style={{flex:1,padding:"8px 0",fontSize:12.5,fontWeight:800,borderRadius:9,border:"none",background:"#4338CA",color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>{qrDraft?.id?"저장":"추가"}</button>
                <button onClick={()=>setQrDraft(null)} style={{padding:"8px 14px",fontSize:12.5,fontWeight:700,borderRadius:9,border:"1px solid "+T.border,background:"#fff",color:T.text,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
                {qrDraft?.id && <button onClick={()=>delQr(qrDraft.id)} title="삭제" style={{padding:"8px 11px",fontSize:12.5,fontWeight:700,borderRadius:9,border:"1px solid #FCA5A5",background:"#FEF2F2",color:"#DC2626",cursor:"pointer",fontFamily:"inherit"}}>삭제</button>}
              </div>
              <input value={qrDraft?.label||""} onChange={e=>setQrDraft(d=>({...(d||{}),label:e.target.value}))}
                placeholder="제목 (예: 강남 예약금 계좌)" style={{padding:"8px 11px",border:"1px solid "+T.border,borderRadius:9,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              <select value={qrDraft?.branchId||""} onChange={e=>setQrDraft(d=>({...(d||{}),branchId:e.target.value||undefined}))}
                style={{padding:"8px 11px",border:"1px solid "+T.border,borderRadius:9,fontSize:13,fontFamily:"inherit",outline:"none",background:"#fff"}}>
                <option value="">전체 지점 공용</option>
                {(data?.branches||[]).filter(b=>!userBranches||userBranches.length===0||userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.short||b.name}</option>)}
              </select>
              <textarea value={qrDraft?.text||""} onChange={e=>setQrDraft(d=>({...(d||{}),text:e.target.value}))}
                placeholder="내용 (가격표는 {{가격표:왁싱}} / {{가격표:스킨케어}} 토큰 사용 가능)" rows={4} style={{padding:"8px 11px",border:"1px solid "+T.border,borderRadius:9,fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical",lineHeight:1.5}}/>
            </div>
          )}
          {visibleQr.length===0 && !qrManage &&
            <div style={{fontSize:12,color:T.textMuted,padding:"12px 4px",lineHeight:1.5}}>저장된 답변이 없어요.<br/>[관리]에서 자주 쓰는 답변을 추가하세요.</div>}
          {(commonQr.length>0 || qrManage) && (<>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",margin:"13px 2px 7px"}}>
              <span style={{fontSize:11,fontWeight:800,color:"#4338CA",letterSpacing:0.3,display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:5,height:5,borderRadius:3,background:"#4338CA"}}/>전지점 공용</span>
              {qrManage && addBtn(undefined)}
            </div>
            {commonQr.length>0 ? grid(commonQr) : (qrManage && <div style={{fontSize:11.5,color:T.textMuted,padding:"2px 4px"}}>+ 로 공용 답변 추가</div>)}
          </>)}
          {(branchOpts.length>0 || qrManage) && (<>
            <div style={{display:"flex",alignItems:"center",gap:7,margin:"15px 2px 8px"}}>
              <span style={{fontSize:11,fontWeight:800,color:"#0EA5E9",display:"inline-flex",alignItems:"center",gap:5,flexShrink:0}}><span style={{width:5,height:5,borderRadius:3,background:"#0EA5E9"}}/>지점 전용</span>
              {branchOpts.length>0 && <select value={curBranch} onChange={e=>setQrBranchFilter(e.target.value)} style={{flex:1,minWidth:0,padding:"5px 9px",border:"1px solid "+T.border,borderRadius:8,fontSize:12,fontFamily:"inherit",background:"#fff",outline:"none",fontWeight:700,color:T.text}}>
                {branchOpts.map(bid=><option key={bid} value={bid}>{brName(bid)} ({branchGroups[bid].length})</option>)}
              </select>}
              {qrManage && addBtn(curBranch || (userBranches&&userBranches[0]) || "")}
            </div>
            {curBranch && branchGroups[curBranch]?.length>0 ? grid(branchGroups[curBranch]) : (qrManage && <div style={{fontSize:11.5,color:T.textMuted,padding:"2px 4px"}}>+ 로 지점 전용 답변 추가 (저장 시 지점 선택)</div>)}
          </>)}
        </div>
      </div>, document.body);
  };

  // 🟢 상담완료 — 네이버 톡톡 파트너센터 [상담완료] 자동 호출
  // 우리 메시지함 내부에서도 모두 읽음 처리. 네이버 채널에서만 노출.
  // confirm() 제거 — iOS PWA·모바일 일부 환경에서 차단되어 동작 불가하던 문제 해결 (aiBook과 동일 패턴)
  const endCounsel = async()=>{
    if(!sel||endCounselLoading) return;
    if((sel.channel||"naver") !== "naver") return;
    setEndCounselLoading(true);
    try{
      // 우리 메시지함의 user_name + 마지막 out/in 메시지 추출 (매칭 힌트)
      // last_msg_text는 우리가 보낸 마지막 OUT 메시지 (naver chat list의 text와 동일)
      const lastIn = [...convo].reverse().find(m=>m.direction==="in");
      const lastOut = [...convo].reverse().find(m=>m.direction==="out" && m.message_text);
      const lastAny = [...convo].reverse().find(m=>m.message_text);
      const hintName = (sel.user_name || lastIn?.user_name || "").trim();
      const refMsg = lastOut || lastAny;
      const hintTs = refMsg?.created_at ? Math.floor(new Date(refMsg.created_at).getTime()/1000) : null;
      const hintText = (refMsg?.message_text || "").trim();
      const res = await fetch("https://blissme.ai/naver-talk/end-counsel",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          account_id: sel.account_id,
          user_id: sel.user_id,
          user_name: hintName,
          last_msg_ts: hintTs,
          last_msg_text: hintText
        }),
      });
      const dd = await res.json().catch(()=>({}));
      if(!dd?.ok){
        const err = dd?.error||"unknown";
        if(err==="no_match"){
          // 디버그 정보 포함 — 어떻게 매칭 시도했는지 + 네이버 chat list 미리보기
          let dbg = `\n\n[검색]\n- 이름: ${dd.user_name||"(없음)"}\n- 마지막 메시지: ${(dd.last_text||"").slice(0,30)}`;
          if (Array.isArray(dd.debug_chats) && dd.debug_chats.length > 0) {
            dbg += `\n\n[네이버 파트너센터 최근 대화]\n` + dd.debug_chats.map(c=>`• ${c.name||"(이름없음)"}: ${(c.text||"").slice(0,25)}`).join("\n");
          }
          alert("⚠️ 네이버 파트너센터에서 일치하는 대화방을 찾지 못했습니다."+dbg+"\n\n파트너센터에서 직접 [상담완료] 눌러주세요.");
        } else if(err==="no_naver_session"){
          alert("⚠️ 네이버 세션이 만료됐습니다.\n관리자에게 세션 갱신 요청 필요.");
        } else {
          alert("상담완료 실패: "+err);
        }
        return;
      }
      // 우리 쪽도 모두 읽음 처리
      try{ markRead(sel.user_id, sel.channel||"naver"); }catch(e){}
      if (dd.skipped) {
        alert(`✅ 메시지함 읽음 처리됨\n${dd.note||""}`);
      } else {
        alert(`✅ 상담완료 처리됨\n매칭: ${dd.matchedName||"?"} (${dd.chatUrl})`);
      }
    }catch(e){
      console.error("[endCounsel]",e);
      alert("상담완료 오류: "+e.message);
    }finally{
      setEndCounselLoading(false);
    }
  };

  const sendTranslated = async()=>{
    if(!reply.trim()||!sel) return;
    setSending(true);
    try{
      const lastIn = [...convo].reverse().find(m=>m.direction==="in");
      let text = reply.trim();
      if(lastIn){
        // 한+영 혼용 시 영어 우선 — 영어 5자 이상이면 영어로 번역 (한글 일부 있어도)
        // \uACE0\uAC1D \uC5B8\uC5B4 \uD310\uC815 \u2014 \uB9C8\uC9C0\uB9C9 \uC778\uBC14\uC6B4\uB4DC 1\uAC74\uB9CC \uBCF4\uBA74 "12?","ok","\uD83D\uDC4D" \uAC19\uC740 \uC9E7\uC740 \uB2F5\uC5D0 \uC790\uB3D9\uBC88\uC5ED\uC774 \uAEBC\uC9C0\uB294 \uBC84\uADF8
        // (id_3xihixs9v6). \uCD5C\uADFC \uC778\uBC14\uC6B4\uB4DC 5\uAC74\uC744 \uD569\uCCD0 \uC601\uC5B4\uAD8C \uACE0\uAC1D\uC778\uC9C0 \uD310\uC815.
        const _lastInTxt = [...convo].filter(m=>m.direction==="in").slice(-5).map(m=>String(m.message_text||"")).join(" ");
        const _ko = (_lastInTxt.match(/[\uAC00-\uD7A3\u1100-\u11FF]/g)||[]).length;
        const _en = (_lastInTxt.match(/[a-zA-Z]/g)||[]).length;
        const _enPriority = _en >= 5 || (_en > 0 && _ko === 0);
        // ★ 고객이 최근 대화에서 영어를 한 글자도 안 쓴 명백한 한국 고객이면 영어 번역 금지 (강제영어 토글이 켜져 있어도).
        //   강제영어 토글이 대화 간 전역 유지되는 함정 → 한국 고객에게 영어가 나가는 사고 방지.
        const _pureKoreanCust = _ko >= 5 && _en === 0;
        // 번역 결정: force_en=강제영어 / auto=영어 우선 케이스 / off=안함. 단 명백한 한국 고객은 제외.
        const _shouldTranslate = !_pureKoreanCust && (translateMode === "force_en" || (translateMode === "auto" && _enPriority));
        const lang = "en";
        if(_shouldTranslate){
          // 최근 6건의 대화 맥락 (시각·발화자 구분) — 번역 품질 + stale fact 방지용
          // 타임스탬프 포함: LLM이 "내일/오늘" 같은 상대 날짜를 KST 기준으로 재해석하도록.
          const _fmtKst = (iso) => {
            try {
              const d = new Date(iso);
              return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0,16) + " KST";
            } catch { return ""; }
          };
          const contextLines = (convo||[]).slice(-6).map(m => {
            const who = m.direction === "out" ? "Staff" : "Customer";
            const ts = _fmtKst(m.created_at);
            const txt = (m.translated_text || m.message_text || "").toString().replace(/\s+/g," ").slice(0,180);
            return txt ? `[${ts}] ${who}: ${txt}` : "";
          }).filter(Boolean).join("\n");
          // 서버 GPT-4o-mini 엔드포인트 호출 — 실패 시 원문 그대로 발송
          let translated = "";
          setTranslating(true);
          try {
            const sRes = await fetch("https://blissme.ai/translate-outgoing", {
              method: "POST",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ text: reply, target_lang: lang, context: contextLines })
            });
            if (sRes.ok) {
              const sd = await sRes.json();
              translated = (sd?.translated || "").trim();
            }
          } catch(e) { /* 서버 실패 시 원문 발송 */ }
          finally { setTranslating(false); }
          text = String(translated || reply).replace(/^["'`]+|["'`]+$/g, "").trim();
          // 외국어 발송 시 사용자가 친 한국어 원문을 translated_text로 동반 → echo 처리 시 메시지함에 그대로 표시
          await sendMsg(text, reply.trim());
          return;
        }
      }
      await sendMsg(text);
    }finally{setSending(false);}
  };

  // 모든 발송 진입점(버튼·Enter ×각2)이 거치는 단일 가드 — 동기 ref로 14ms급 더블발화 차단
  const doSend = async()=>{
    if(sendingRef.current) return;
    sendingRef.current = true;
    try{
      if(translateMode!=="off") await sendTranslated();
      else await sendMsg(reply.trim(), aiKoDraft);
    } finally { sendingRef.current = false; }
  };

  const fmtTime=(ts)=>{
    const d=new Date(ts),now=new Date(),diff=now-d;
    if(diff<60000) return "방금";
    if(diff<3600000) return Math.floor(diff/60000)+"분 전";
    const h=d.getHours(), ap=h<12?"오전":"오후", h12=(h%12)||12;
    const tt=ap+" "+h12+":"+String(d.getMinutes()).padStart(2,"0");
    const isToday=d.toDateString()===now.toDateString();
    if(isToday) return tt;
    const sameYear=d.getFullYear()===now.getFullYear();
    const ds=(sameYear?"":d.getFullYear()+". ")+(d.getMonth()+1)+"/"+d.getDate();
    return ds+" "+tt;
  };
  // 지점명: 네이버/IG는 외부 계정ID(_ACC_NAME), SMS·기타는 account_id가 bid → data.branches에서 직접 조회.
  // (여러 지점 담당자가 문자가 어느 지점 건지 알 수 있게 — id_sz... 류 요청)
  const branchName=(m)=>{
    const acc=m?.account_id; if(!acc) return "";
    if(_ACC_NAME[acc]) return _ACC_NAME[acc];
    const b=(data?.branches||[]).find(x=>String(x.id)===String(acc));
    return b ? (b.short||b.name||"") : "";
  };

  // 모바일 목록 렌더 (인스타 스타일)
  // 번역 진행 중 ON-AIR 깜빡 애니메이션 (한 번만 inject)
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("bliss-pulse-keyframes")) return;
    const s = document.createElement("style");
    s.id = "bliss-pulse-keyframes";
    s.textContent = `@keyframes blissPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}`;
    document.head.appendChild(s);
  }, []);

  if(isMobile && !sel) return (
    <div style={{display:"flex",flexDirection:"column",background:"#fff",minHeight:"60vh"}}>
      <div style={{padding:"16px 16px 8px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontWeight:800,fontSize:18,color:T.text}}>메시지</span>
          {totalUnread>0&&<span style={{background:T.danger,color:"#fff",borderRadius:10,fontSize:11,fontWeight:700,padding:"2px 8px"}}>{totalUnread}</span>}
        </div>
        <button onClick={()=>setShowAiSettings(v=>!v)} style={{background:Object.values(aiAutoChannels).some(v=>v)?"#A78BFA":"none",color:Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted,border:"1px solid "+(Object.values(aiAutoChannels).some(v=>v)?"#A78BFA":T.border),borderRadius:6,cursor:"pointer",padding:"3px 8px",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}><I name="bot" size={11} color={Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted}/>AI</button>
      </div>
      {showAiSettings&&(()=>{ const stLabel=aiSchedule.enabled?(scheduleInWindow?"응대 시간":"OFF 시간"):"항상 응대"; const stColor=aiSchedule.enabled?(scheduleInWindow?"#059669":"#9ca3af"):"#7C3AED"; return <div style={{padding:"12px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#8B5CF6",display:"inline-flex",alignItems:"center",gap:5}}><I name="bot" size={13} color="#8B5CF6"/>AI 자동대답</span>
          <span style={{fontSize:10,fontWeight:700,color:"#fff",background:stColor,padding:"2px 8px",borderRadius:10,whiteSpace:"nowrap"}}>● {stLabel}</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
          {_chMeta.map(([ch,label,clr])=>(
            <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"5px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr:"#fff",color:aiAutoChannels[ch]?"#fff":T.gray500,whiteSpace:"nowrap",fontFamily:"inherit"}}>{label}</button>
          ))}
        </div>
                <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",marginBottom:7}}>
          <input type="checkbox" checked={!!aiSchedule.enabled} onChange={e=>saveAiSchedule({enabled:e.target.checked})} style={{cursor:"pointer",width:14,height:14,accentColor:"#7C3AED"}}/>
          <span style={{fontSize:11,fontWeight:700,color:aiSchedule.enabled?"#7C3AED":T.gray500,display:"inline-flex",alignItems:"center",gap:3}}><I name="clock" size={11} color={aiSchedule.enabled?"#7C3AED":T.gray500}/>요일별 응대 시간{aiSchedule.enabled?"":" · 꺼짐(항상 응대)"}</span>
        </label>
        {renderAiScheduleRows()}
        <div style={{fontSize:10,fontWeight:700,color:"#8B5CF6",marginTop:8,marginBottom:5,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4}}><I name="clock" size={11} color="#8B5CF6"/>미응답 N분 후 자동 답변</div>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#fff",border:"none",borderRadius:8,boxShadow:"0 1px 3px rgba(0,0,0,0.12)"}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
            <input type="checkbox" checked={!!aiDelay.enabled} onChange={e=>saveAiDelay({enabled:e.target.checked})} style={{cursor:"pointer",width:14,height:14,accentColor:"#7C3AED"}}/>
            <span style={{fontSize:11,fontWeight:700,color:aiDelay.enabled?"#7C3AED":T.gray500}}>지연</span>
          </label>
          <input type="number" min={1} max={60} value={aiDelay.minutes === '' ? '' : (aiDelay.minutes || 1)}
            onChange={e=>{
              const v = e.target.value;
              if (v === '') { setAiDelay(p=>({...p, minutes:''})); return; }
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              saveAiDelay({minutes: Math.max(1, Math.min(60, Math.floor(n)))});
            }}
            onBlur={()=>{ if (aiDelay.minutes === '' || !aiDelay.minutes) saveAiDelay({minutes:1}); }}
            disabled={!aiDelay.enabled}
            style={{fontSize:12,padding:"4px 6px",border:"none",borderRadius:6,fontFamily:"inherit",width:54,textAlign:"center",opacity:aiDelay.enabled?1:0.45,background:"transparent",outline:"none"}}/>
          <span style={{fontSize:11,color:T.gray500,whiteSpace:"nowrap"}}>분 후 직원 미응답 시 AI 답변</span>
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
        {Object.keys(followupMap).length>0 && <button onClick={()=>setFollowupOnly(v=>!v)}
          style={{marginLeft:"auto",padding:"3px 12px",fontSize:11,fontWeight:followupOnly?700:600,border:"1px solid "+(followupOnly?"#6366F1":T.border),borderRadius:12,background:followupOnly?"#E0E7FF":"#fff",color:followupOnly?"#3730A3":T.gray600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
          <I name="bell" size={11}/>확인 필요 {Object.keys(followupMap).length}
        </button>}
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
          const sendActive=sendWindowActive(m.user_id,ch);
          return <div key={key} onClick={()=>selectThread(m)}
            style={{padding:forceCompact?"8px 12px":"12px 16px",display:"flex",alignItems:"center",gap:forceCompact?10:14,borderBottom:"1px solid #f0f0f0",background:"#fff",cursor:"pointer"}}>
            {/* 아바타 — 브랜드 색상 배경 + 공식 로고 */}
            <div style={{position:"relative",flexShrink:0}}>
              <div style={{width:forceCompact?36:48,height:forceCompact?36:48,borderRadius:"50%",
                background:CH_COLOR[ch]||"#888",
                display:"flex",alignItems:"center",justifyContent:"center",
                border:uc>0?"2px solid "+T.primary:"2px solid transparent",
                boxSizing:"border-box",
                boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}}>
                <ChannelLogo channel={ch} size={forceCompact?20:26}/>
              </div>
              <span title={sendActive?"지금 메시지 발송 가능":"발송 시간 지남 — 손님이 다시 답하면 발송 가능"} style={{position:"absolute",right:-1,bottom:-1,width:forceCompact?11:13,height:forceCompact?11:13,borderRadius:"50%",background:sendActive?"#22c55e":"#cbd5e1",border:"2px solid #fff",boxSizing:"border-box"}}/>
            </div>
            {/* 텍스트 */}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                <span style={{fontWeight:uc>0?700:600,fontSize:forceCompact?12:16,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:forceCompact?180:200}}>
                  {name}{branch?" · "+branch:""}
                </span>
                <span style={{fontSize:forceCompact?10:12,color:uc>0?T.primary:"#999",fontWeight:uc>0?600:400,flexShrink:0,marginLeft:6}}>{fmtTime(m.created_at)}</span>
              </div>
              {!forceCompact && <div style={{fontSize:12,color:"#aaa",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {(()=>{const ph=msgs.filter(x=>x.user_id===m.user_id&&x.cust_phone).map(x=>x.cust_phone)[0];return ph||""})()}
              </div>}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:forceCompact?11:14,color:uc>0?"#111":"#555",fontWeight:uc>0?500:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                  {isOut?"나: ":""}{m.message_text}
                </span>
                {_renderFollowupBadge(key)}{_renderAiBadge(key)}
                {uc>0&&<div style={{width:forceCompact?16:20,height:forceCompact?16:20,borderRadius:"50%",background:T.primary,color:"#fff",fontSize:forceCompact?9:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:4}}>{uc}</div>}
              </div>
              {(()=>{const res=chatLatestRes[key]||chatResMap[key];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="reserved"?"예약":res.status==="completed"?"완료":res.status==="no_show"?"노쇼":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":res.status==="reserved"?T.primary:res.status==="no_show"?"#EF5350":"#9E9E9E";return<div style={{display:"flex",alignItems:"center",gap:4,marginTop:3}}><span style={{fontSize:10,fontWeight:700,color:clr,background:clr+"18",borderRadius:3,padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:3}}><I name="calendar" size={10}/>{st} {res.date?.slice(5)} {res.time}</span></div>;})()}
            </div>
          </div>;
        })}
      </div>
    </div>
  );

  // 모바일/사이드패널 채팅창 렌더 — forceCompact일 때는 부모 컨테이너 안에 절대위치 (사이드 패널 안)
  if(isMobile && sel) return (
    <div style={forceCompact ? {position:"absolute",inset:0,zIndex:5,display:"flex",flexDirection:"column",background:"#f5f5f7"} : {position:"fixed",inset:0,zIndex:600,display:"flex",flexDirection:"column",background:"#f5f5f7"}}>
      {/* 헤더 — compact 모드에선 padding/font/buttons 모두 축소 */}
      <div style={{padding:forceCompact?"6px 8px":"12px 16px",borderBottom:"1px solid "+T.border,background:T.bgCard,display:"flex",alignItems:"center",gap:forceCompact?6:10,flexShrink:0}}>
        <button onClick={()=>{ setSel(null); if(onChatOpen) onChatOpen(false); }} style={{background:"none",border:"none",cursor:"pointer",color:T.primary,padding:"4px 6px 4px 0",flexShrink:0}}><I name="arrowL" size={forceCompact?16:20}/></button>
        <div style={{width:forceCompact?22:28,height:forceCompact?22:28,borderRadius:14,background:CH_COLOR[sel.channel]||T.primary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title={CH_NAME[sel.channel]||sel.channel}><ChannelLogo channel={sel.channel} size={forceCompact?13:16}/></div>
        <div style={{flex:1,minWidth:0,position:"relative"}}>
          <div style={{fontWeight:T.fw.bolder,fontSize:forceCompact?12:16,display:"flex",alignItems:"center",gap:4,flexWrap:"nowrap",overflow:"hidden"}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{(sel?.channel!=="whatsapp"&&branchName(convo[0]))?branchName(convo[0])+" · ":""}{getDisplayName(convo[0]||{user_id:sel.user_id})}</span>
            {(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(cust) return <span style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:forceCompact?9:11,fontWeight:700,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary+"40",borderRadius:6,padding:"1px 5px",whiteSpace:"nowrap",flexShrink:0}}><I name="user" size={10}/> {cust.name}{cust.custNum?` #${cust.custNum}`:""}<button onClick={unlinkCustomer} title="고객 연결 해제" style={{marginLeft:2,background:"none",border:"none",padding:"0 2px",fontSize:11,fontWeight:900,color:T.textMuted,cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>×</button></span>; return <button onClick={()=>setLinkPickerOpen(v=>!v)} style={{fontSize:forceCompact?9:10,fontWeight:800,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary,borderRadius:6,padding:"2px 7px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,display:"inline-flex",alignItems:"center",gap:3}}><I name="globe" size={10}/>연결</button>; })()}
          </div>
          <div style={{fontSize:forceCompact?10:12,color:T.textSub,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{CH_NAME[sel.channel]||sel.channel}{(()=>{const _bn=sel.channel!=="whatsapp"?branchName(sel):"";return _bn?" · "+_bn:"";})()}{(()=>{ const ph=convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone||(sel.channel==="sms"?sel.user_id:"")||(sel.channel==="whatsapp"&&sel.user_id?(sel.user_id.startsWith("82")?"0"+sel.user_id.slice(2):sel.user_id):""); return ph?" · "+ph:""; })()}{(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(!cust?.phone) return null; return " · "+cust.phone; })()}</div>
          {renderCustSummary(chatCustMapFull[sel.channel+"_"+sel.user_id], sel.channel+"_"+sel.user_id)}
          {linkPickerOpen && !chatCustMapFull[sel.channel+"_"+sel.user_id] && (
            <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:50,background:"#fff",border:"1px solid "+T.border,borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,.15)",padding:8,width:280}}>
              <input autoFocus value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="이름·전화·이메일·번호 검색"
                style={{width:"100%",padding:"6px 10px",fontSize:12,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit",boxSizing:"border-box"}}/>
              {linkCandidates.length > 0 && <div style={{marginTop:6,maxHeight:240,overflowY:"auto"}}>
                {linkCandidates.map(c => (
                  <div key={c.id} onClick={()=>linkCustomer(c)} style={{padding:"6px 8px",cursor:"pointer",borderRadius:4,fontSize:12,display:"flex",justifyContent:"space-between",gap:6}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.gray100} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <span style={{fontWeight:600}}>{c.name}{c.name2?` (${c.name2})`:""}</span>
                    <span style={{color:T.textMuted}}>{c.phone}{c.custNum?` · #${c.custNum}`:""}</span>
                  </div>
                ))}
              </div>}
              {linkSearch.trim() && linkCandidates.length === 0 && <div style={{padding:"8px 4px",fontSize:11,color:T.textMuted,textAlign:"center"}}>일치하는 고객 없음</div>}
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:6}}>
                <button onClick={()=>{setLinkPickerOpen(false);setLinkSearch("");}} style={{padding:"3px 10px",fontSize:11,border:"1px solid "+T.border,background:"#fff",borderRadius:6,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>취소</button>
              </div>
            </div>
          )}
        </div>
        {(()=>{const res=chatLatestRes[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"대기":res.status==="completed"?"완료":res.status==="reserved"?"예약":res.status==="no_show"?"노쇼":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":res.status==="completed"?"#9E9E9E":res.status==="no_show"?"#EF5350":T.primary;return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes({...res, _highlightOnly:true});setPage("timeline");}}} title={`${st} ${res.date?.slice(5)} ${res.time} — 타임라인 바로가기 (예약 강조)`} style={{fontSize:forceCompact?10:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:forceCompact?"3px 6px":"4px 8px",cursor:"pointer",fontFamily:"inherit",flexShrink:0,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}><I name="calendar" size={11}/>{forceCompact?"":st}</button>;})()}
        {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={"↗ " + _extLink.short + " 앱에서 이 고객 대화 열기 (원래 메신저로 이동)"} style={{fontSize:forceCompact?10:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:forceCompact?"3px 6px":"4px 8px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>{forceCompact?"↗":_extLink.short+" ↗"}</a>}
      </div>
      {/* 메시지 */}
      <div style={{flex:1,overflowY:"auto",padding:forceCompact?"10px 10px 4px":"16px 16px 4px",display:"flex",flexDirection:"column",gap:forceCompact?6:10,WebkitOverflowScrolling:"touch",background:"#f5f5f7"}}>
        {convo.map((m,i)=>{
          if(m.direction==="system") return null;
          const isOut=m.direction==="out";
          return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:forceCompact?5:8}}>
            {/* AI 발송 메시지는 연보라 아바타 + SVG bot 아이콘 (id_imgr471swt-2 요청) */}
            {isOut&&m.is_ai&&<div style={{width:forceCompact?22:28,height:forceCompact?22:28,borderRadius:14,background:"#A78BFA",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff"}}><I name="bot" size={forceCompact?12:15} color="#fff"/></div>}
            <div style={{maxWidth:"82%"}}>
              {/* AI 발송 메시지에 연보라 AI 배지 */}
              {m.is_ai&&<div style={{display:"flex",justifyContent:isOut?"flex-end":"flex-start",marginBottom:3}}>
                <span style={{background:"#A78BFA",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:forceCompact?9:10,fontWeight:800,letterSpacing:0.3,display:"inline-flex",alignItems:"center",gap:3}}><I name="bot" size={forceCompact?9:10} color="#fff"/>AI 자동응답</span>
              </div>}
              {/* 발신 말머리 — 발신 드롭다운에서 선택된 직원/지점(sent_by_staff_name). 기록 없으면 내 지점명(드롭다운 디폴트). 고객엔 노출 안 됨 */}
              {isOut && !m.is_ai && <div style={{display:"flex",justifyContent:isOut?"flex-end":"flex-start",marginBottom:3}}>
                <span style={{background:"#6D28D9",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:forceCompact?9:10,fontWeight:800,letterSpacing:0.3,display:"inline-flex",alignItems:"center",gap:3}}><I name="user" size={forceCompact?9:10} color="#fff"/>{m.sent_by_staff_name || _userBranchName || "직원"}</span>
              </div>}
              <div data-allow-select="true" style={{padding:forceCompact?"7px 10px":"10px 14px",borderRadius:isOut?"14px 14px 4px 14px":"14px 14px 14px 4px",background:isOut?(m.is_ai?"#A78BFA":T.primary):"#fff",color:isOut?"#fff":T.text,fontSize:forceCompact?12:16,lineHeight:1.45,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                {m.message_text}
                {m.translated_text&&<div style={{marginTop:5,paddingTop:5,borderTop:isOut?"1px solid rgba(255,255,255,0.45)":"1px solid rgba(0,0,0,0.18)",fontSize:forceCompact?11:12,color:isOut?"rgba(255,255,255,0.95)":"rgba(0,0,0,0.78)",fontWeight:500}}>🔤 {m.translated_text}</div>}
              </div>
              <div style={{fontSize:forceCompact?9:10,color:T.textMuted,marginTop:2,textAlign:isOut?"right":"left",display:"flex",justifyContent:isOut?"flex-end":"flex-start",alignItems:"center",gap:6}}>
                {isOut && m.status === 'failed' && (
                  <span title={m.error_reason || '24시간 응답 윈도우 만료 등'} style={{color:"#D32F2F",fontWeight:700,background:"#FFEBEE",border:"1px solid #FFCDD2",borderRadius:4,padding:"1px 5px",fontSize:forceCompact?9:10,display:"inline-flex",alignItems:"center",gap:3}}>
                    <I name="alert" size={forceCompact?9:10}/>발송실패
                  </span>
                )}
                <span>{fmtTime(m.created_at)}</span>
              </div>
            </div>
          </div>;
        })}
        <div ref={convoEndRef}/>
      </div>
      {/* 입력창 */}
      <div style={{background:"transparent",padding:"8px 12px 12px",flexShrink:0}}>
        <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center",flexWrap:"wrap"}}>
          {/* AI 답변 추천 */}
          <button onClick={genAI} disabled={aiLoading}
            title="AI가 대화 맥락 보고 답변 추천 (직원 검토 후 발송)"
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:T.primaryLt,color:T.primaryDk,border:"1px solid "+T.primary+"55",borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:"pointer",fontWeight:T.fw.bold,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name={aiLoading?"loader":"sparkles"} size={13}/> {aiLoading?"생성 중…":"AI 답변 추천"}
          </button>
          {/* 번역 토글 (번역 진행 중에는 빨간 ON-AIR 점 깜빡) */}
          <button onClick={cycleTranslateMode}
            title={(translating||inTranslating)?"번역 중...":translateMode==="auto"?"자동: 고객 언어에 맞춰 번역":translateMode==="force_en"?"강제 영어: 한국 고객도 영어로":"끄기: 원문 그대로"}
            style={{padding:forceCompact?"5px 10px":"6px 12px",
              background:translateMode==="auto"?T.successLt:translateMode==="force_en"?T.infoLt:T.gray100,
              color:translateMode==="auto"?T.successDk:translateMode==="force_en"?"#0e7490":T.gray600,
              border:"1px solid "+(translateMode==="auto"?T.success+"55":translateMode==="force_en"?T.info+"55":T.border),
              borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:"pointer",fontWeight:T.fw.bold,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5,position:"relative"}}>
            {(translating||inTranslating) && <span style={{width:7,height:7,borderRadius:"50%",background:T.danger,animation:"blissPulse 1s infinite",display:"inline-block"}}/>}
            <I name="languages" size={13}/>
            {(translating||inTranslating) ? "번역 중…" : (translateMode==="auto"?"번역 자동":translateMode==="force_en"?"번역 영어":"번역 OFF")}
          </button>
          {/* AI 예약 등록 */}
          <button onClick={aiBook} disabled={aiBookLoading}
            title="AI가 대화 분석해서 예약 자동 등록 (담당자 확인 후 확정)"
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:aiBookLoading?T.gray400:T.primary,color:"#fff",border:"1px solid "+(aiBookLoading?T.gray400:T.primaryDk),borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:aiBookLoading?"wait":"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name={aiBookLoading?"loader":"calendar"} size={13} color="#fff"/> {aiBookLoading?"분석 중…":"AI 예약등록"}
          </button>
          {/* 🚫 차단/삭제 — 스팸 대응 (오류신고 버튼 대체, id_lqxe16rw71). 차단=인입 저장·번역·AI 전부 중단 */}
          <button onClick={()=>setChatAction({type:selBlocked?"unblock":"block"})}
            title={selBlocked?"차단 해제 — 이 번호의 메시지를 다시 받습니다":"차단 — 이 대화의 새 메시지를 받지 않아요 (번역·AI 응답도 중단)"}
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:selBlocked?"#FEF2F2":"#fff",color:selBlocked?"#DC2626":T.gray600,border:"1px solid "+(selBlocked?"#FCA5A5":T.border),borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name="alert" size={13}/> {selBlocked?"차단됨":"차단"}
          </button>
          <button onClick={()=>setChatAction({type:"delete"})}
            title="대화 삭제 — 이 대화의 메시지를 모두 지웁니다 (되돌릴 수 없음)"
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:"#fff",color:T.gray600,border:"1px solid "+T.border,borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name="trash" size={13}/> 삭제
          </button>
          {chatAction && createPortal(
            <div onClick={()=>setChatAction(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:100000,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,padding:"20px 22px",width:"min(340px,90vw)",boxShadow:"0 12px 40px rgba(0,0,0,.25)"}}>
                <div style={{fontSize:15,fontWeight:800,marginBottom:8}}>
                  {chatAction.type==="delete2"?"정말 삭제할까요? (최종 확인)":chatAction.type==="delete"?"대화를 삭제할까요?":chatAction.type==="block"?"이 대화를 차단할까요?":"차단을 해제할까요?"}
                </div>
                <div style={{fontSize:12.5,color:chatAction.type==="delete2"?"#DC2626":T.gray600,lineHeight:1.55,marginBottom:16,fontWeight:chatAction.type==="delete2"?700:400}}>
                  {chatAction.type==="delete2"
                    ? "마지막 확인이에요. 이 대화의 메시지가 전부 영구 삭제되고 절대 되돌릴 수 없습니다."
                    : chatAction.type==="delete"
                    ? "이 대화의 메시지가 모두 지워지고 되돌릴 수 없어요. (차단은 별도 — 새 메시지를 막으려면 차단도 켜주세요)"
                    : chatAction.type==="block"
                    ? "이 번호의 새 메시지를 받지 않고, 번역·AI 자동응답도 모두 중단돼요. 언제든 해제할 수 있어요."
                    : "이 번호의 메시지를 다시 받습니다."}
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button onClick={()=>setChatAction(null)} style={{padding:"8px 14px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.gray600,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
                  <button onClick={chatAction.type==="delete2"?doDeleteChat:chatAction.type==="delete"?()=>setChatAction({type:"delete2"}):doBlockToggle}
                    style={{padding:"8px 14px",borderRadius:8,border:"none",background:(chatAction.type==="delete"||chatAction.type==="delete2")?"#DC2626":T.primary,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                    {chatAction.type==="delete2"?"영구 삭제":chatAction.type==="delete"?"삭제":chatAction.type==="block"?"차단":"해제"}
                  </button>
                </div>
              </div>
            </div>, document.body)}
          {renderQrButton()}
          {/* 상담완료 — 네이버 톡톡 파트너센터 [상담완료] 자동 호출 (네이버 채널만) */}
          {(sel.channel||"naver") === "naver" && <button onClick={endCounsel} disabled={endCounselLoading}
            title="네이버 톡톡 파트너센터에 [상담완료] 자동 적용 + 메시지함 모두 읽음 처리"
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:endCounselLoading?T.gray400:"#10B981",color:"#fff",border:"1px solid "+(endCounselLoading?T.gray400:"#059669"),borderRadius:T.radius.md,fontSize:forceCompact?11:12,cursor:endCounselLoading?"wait":"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name={endCounselLoading?"loader":"check"} size={13} color="#fff"/> {endCounselLoading?"처리 중…":"상담완료"}
          </button>}
          {/* 발신 직원 선택 — 디폴트: 지점명, 수동 선택 시 localStorage 저장 */}
          <select value={selStaff} onChange={e=>updateSelStaff(e.target.value)}
            title="답장 발신자 — 메시지 머리에 표시됩니다 (디폴트: 지점명, 변경 시 자동 저장)"
            style={{padding:forceCompact?"5px 10px":"6px 12px",background:"#fff",color:T.text,border:"1px solid "+T.border,borderRadius:T.radius.md,fontSize:forceCompact?11:12,fontWeight:T.fw.bold,fontFamily:"inherit",cursor:"pointer"}}>
            {_userBranchName && <option value={_userBranchName}>{_userBranchName} (지점)</option>}
            {empList.map(e=>{ const v=e.id||e.name; if (v===_userBranchName) return null; return <option key={v} value={v}>{v}</option>; })}
            <option value="">— 말머리 없음 —</option>
          </select>
        </div>
        {aiKoDraft&&<div style={{fontSize:forceCompact?11:12,color:"#4338ca",padding:"4px 8px",background:"#eff6ff",borderRadius:6,marginBottom:6,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
        {aiBooked&&<div style={{fontSize:forceCompact?11:12,padding:"6px 10px",background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:8,marginBottom:6,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{color:"#065F46",fontWeight:700}}>✅ {aiBooked.changed?"예약 변경됨":"예약 등록됨"} — {(aiBooked.date||"").slice(5)} {aiBooked.time} {aiBooked.branch_name||""}{aiBooked.is_new?" · 신규":""}</span>
          <button type="button" onClick={()=>{ if(setPendingOpenRes&&setPage){ setPendingOpenRes({id:aiBooked.id,reservation_id:aiBooked.id,date:aiBooked.date,time:aiBooked.time,bid:aiBooked.bid,status:aiBooked.status||"request",_highlightOnly:true}); setPage("timeline"); } }}
            style={{marginLeft:"auto",padding:"3px 10px",fontSize:forceCompact?10:11,fontWeight:800,background:"#10B981",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>타임라인에서 보기 →</button>
        </div>}
        {renderQrPanel()}
        <div style={{position:"relative"}}>
          <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); setAiKoDraft(""); setReplyIsAi(false); }}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doSend();}}}
            placeholder="메시지 입력..."
            style={{width:"100%",padding:forceCompact?"8px 44px 8px 12px":"10px 52px 10px 14px",border:"1px solid "+T.border,borderRadius:12,fontSize:forceCompact?12:15,resize:"none",minHeight:forceCompact?36:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"20px",overflowY:"auto",boxSizing:"border-box",WebkitAppearance:"none",appearance:"none"}}
          />
          {(reply.trim()||sending)&&<button onClick={()=>doSend()} disabled={sending||!reply.trim()}
            style={{position:"absolute",right:6,bottom:5,width:forceCompact?26:32,height:forceCompact?26:32,background:"#7C3AED",color:"#fff",border:"none",borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {sending?<span style={{fontSize:11}}>⏳</span>:<svg width={forceCompact?13:16} height={forceCompact?13:16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
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
          <button onClick={()=>setShowAiSettings(v=>!v)} style={{background:Object.values(aiAutoChannels).some(v=>v)?"#A78BFA":"none",color:Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted,border:"1px solid "+(Object.values(aiAutoChannels).some(v=>v)?"#A78BFA":T.border),borderRadius:6,cursor:"pointer",padding:"3px 8px",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}><I name="bot" size={11} color={Object.values(aiAutoChannels).some(v=>v)?"#fff":T.textMuted}/>AI</button>
        </div>
        {showAiSettings&&(()=>{ const stLabel=aiSchedule.enabled?(scheduleInWindow?"응대 시간":"OFF 시간"):"항상 응대"; const stColor=aiSchedule.enabled?(scheduleInWindow?"#059669":"#9ca3af"):"#7C3AED"; return <div style={{padding:"12px 14px",borderBottom:"1px solid "+T.border,background:"#faf5ff"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:"#8B5CF6",display:"inline-flex",alignItems:"center",gap:5}}><I name="bot" size={13} color="#8B5CF6"/>AI 자동대답</span>
            <span style={{fontSize:10,fontWeight:700,color:"#fff",background:stColor,padding:"2px 8px",borderRadius:10,whiteSpace:"nowrap"}}>● {stLabel}</span>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
            {_chMeta.map(([ch,label,clr])=>(
              <button key={ch} onClick={()=>toggleAiChannel(ch)} style={{padding:"5px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:"1.5px solid",borderColor:aiAutoChannels[ch]?clr:T.border,background:aiAutoChannels[ch]?clr:"#fff",color:aiAutoChannels[ch]?"#fff":T.gray500,whiteSpace:"nowrap",fontFamily:"inherit"}}>{label}</button>
            ))}
          </div>
                    <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",marginBottom:7}}>
            <input type="checkbox" checked={!!aiSchedule.enabled} onChange={e=>saveAiSchedule({enabled:e.target.checked})} style={{cursor:"pointer",width:14,height:14,accentColor:"#7C3AED"}}/>
            <span style={{fontSize:11,fontWeight:700,color:aiSchedule.enabled?"#7C3AED":T.gray500,display:"inline-flex",alignItems:"center",gap:3}}><I name="clock" size={11} color={aiSchedule.enabled?"#7C3AED":T.gray500}/>요일별 응대 시간{aiSchedule.enabled?"":" · 꺼짐(항상 응대)"}</span>
          </label>
          {renderAiScheduleRows()}
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
          {Object.keys(followupMap).length>0 && <button onClick={()=>setFollowupOnly(v=>!v)}
            style={{marginLeft:"auto",padding:"2px 10px",fontSize:10,fontWeight:followupOnly?700:600,border:"1px solid "+(followupOnly?"#6366F1":T.border),borderRadius:10,background:followupOnly?"#E0E7FF":"#fff",color:followupOnly?"#3730A3":T.gray600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
            <I name="bell" size={10}/>확인 필요 {Object.keys(followupMap).length}
          </button>}
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
            const sendActive=sendWindowActive(m.user_id,ch);
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
                <span title={sendActive?"지금 메시지 발송 가능":"발송 시간 지남 — 손님이 다시 답하면 발송 가능"} style={{position:"absolute",right:-1,bottom:-1,width:11,height:11,borderRadius:"50%",background:sendActive?"#22c55e":"#cbd5e1",border:"2px solid #fff",boxSizing:"border-box"}}/>
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
                  {_renderFollowupBadge(key)}{_renderAiBadge(key)}
                  {uc>0&&<div style={{width:20,height:20,borderRadius:"50%",background:T.primary,color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:4}}>{uc>9?"9+":uc}</div>}
                </div>
                {(()=>{const res=chatLatestRes[key]||chatResMap[key];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="reserved"?"예약":res.status==="request"?"확정대기":res.status==="completed"?"완료":res.status==="no_show"?"노쇼":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="reserved"?T.primary:res.status==="request"?"#FF9800":res.status==="no_show"?"#EF5350":"#9E9E9E";return<div style={{marginTop:3}}><span style={{fontSize:10,fontWeight:700,color:clr,background:clr+"18",borderRadius:3,padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:3}}><I name="calendar" size={10}/>{st} {res.date?.slice(5)} {res.time}</span></div>;})()}
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
            <div style={{flex:1,minWidth:0,position:"relative"}}>
              <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span>{(sel?.channel!=="whatsapp"&&branchName(convo[0]))?branchName(convo[0])+" · ":""}{getDisplayName(convo[0]||{user_id:sel.user_id})}</span>
                {(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(cust) return <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,fontWeight:700,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary+"40",borderRadius:6,padding:"2px 6px",whiteSpace:"nowrap"}} title={cust.phone||""}><I name="user" size={10}/> {cust.name}{cust.custNum?` #${cust.custNum}`:""}<button onClick={unlinkCustomer} title="고객 연결 해제" style={{marginLeft:2,background:"none",border:"none",padding:"0 2px",fontSize:12,fontWeight:900,color:T.textMuted,cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>×</button></span>; return <button onClick={()=>setLinkPickerOpen(v=>!v)} style={{fontSize:10,fontWeight:700,color:T.textMuted,background:"#fff",border:"1px dashed "+T.gray400,borderRadius:6,padding:"2px 6px",cursor:"pointer",fontFamily:"inherit"}}>🔗 고객 연결</button>; })()}
              </div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}{(()=>{const _bn=sel.channel!=="whatsapp"?branchName(sel):"";return _bn?" · "+_bn:"";})()}{(()=>{ const ph=convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone||(sel.channel==="sms"?sel.user_id:"")||(sel.channel==="whatsapp"&&sel.user_id?(sel.user_id.startsWith("82")?"0"+sel.user_id.slice(2):sel.user_id):""); return ph?" · "+ph:""; })()}{(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(!cust?.phone) return null; return " · "+cust.phone; })()}</div>
              {renderCustSummary(chatCustMapFull[sel.channel+"_"+sel.user_id], sel.channel+"_"+sel.user_id)}
              {linkPickerOpen && !chatCustMapFull[sel.channel+"_"+sel.user_id] && (
                <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:50,background:"#fff",border:"1px solid "+T.border,borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,.15)",padding:8,width:300}}>
                  <input autoFocus value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="이름·전화·이메일·번호 검색"
                    style={{width:"100%",padding:"6px 10px",fontSize:12,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit",boxSizing:"border-box"}}/>
                  {linkCandidates.length > 0 && <div style={{marginTop:6,maxHeight:240,overflowY:"auto"}}>
                    {linkCandidates.map(c => (
                      <div key={c.id} onClick={()=>linkCustomer(c)} style={{padding:"6px 8px",cursor:"pointer",borderRadius:4,fontSize:12,display:"flex",justifyContent:"space-between",gap:6}}
                        onMouseEnter={e=>e.currentTarget.style.background=T.gray100} onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <span style={{fontWeight:600}}>{c.name}{c.name2?` (${c.name2})`:""}</span>
                        <span style={{color:T.textMuted}}>{c.phone}{c.custNum?` · #${c.custNum}`:""}</span>
                      </div>
                    ))}
                  </div>}
                  {linkSearch.trim() && linkCandidates.length === 0 && <div style={{padding:"8px 4px",fontSize:11,color:T.textMuted,textAlign:"center"}}>일치하는 고객 없음 (목록에 없으면 고객관리에서 검색 후 다시 시도)</div>}
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:6}}>
                    <button onClick={()=>{setLinkPickerOpen(false);setLinkSearch("");}} style={{padding:"3px 10px",fontSize:11,border:"1px solid "+T.border,background:"#fff",borderRadius:6,cursor:"pointer",color:T.textSub,fontFamily:"inherit"}}>취소</button>
                  </div>
                </div>
              )}
            </div>
            {(()=>{const res=chatLatestRes[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":res.status==="reserved"?"예약":res.status==="no_show"?"노쇼":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":res.status==="completed"?"#9E9E9E":res.status==="no_show"?"#EF5350":T.primary;return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes({...res, _highlightOnly:true});setPage("timeline");}}} title="예약 바로가기" style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>📅 {st} {res.date?.slice(5)} {res.time} →</button>;})()}
            {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={"↗ " + _extLink.short + " 앱에서 이 고객 대화 열기 (원래 메신저로 이동)"} style={{fontSize:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:"4px 10px",textDecoration:"none",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>{_extLink.label} ↗</a>}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
            {convo.map((m,i)=>{
              if(m.direction==="system") return null;
              const isOut=m.direction==="out";
              return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:8}}>
                <div style={{maxWidth:"70%"}}>
                  {/* 직원 답장 말머리 — 고객엔 노출 안 됨, 직원만 봄 */}
                  {isOut && !m.is_ai && m.sent_by_staff_name && <div style={{display:"flex",justifyContent:"flex-end",marginBottom:3}}>
                    <span style={{background:"#6D28D9",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:10,fontWeight:800,letterSpacing:0.3}}>👤 {m.sent_by_staff_name}</span>
                  </div>}
                  <div style={{padding:"10px 14px",borderRadius:isOut?"16px 16px 4px 16px":"16px 16px 16px 4px",background:isOut?T.primary:"#fff",color:isOut?"#fff":T.text,fontSize:16,lineHeight:1.5,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                    {m.message_text}
                    {m.translated_text&&<div style={{marginTop:6,paddingTop:6,borderTop:isOut?"1px solid rgba(255,255,255,0.45)":"1px solid rgba(0,0,0,0.18)",fontSize:12,color:isOut?"rgba(255,255,255,0.95)":"rgba(0,0,0,0.78)",fontWeight:500}}>🔤 {m.translated_text}</div>}
                  </div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:3,textAlign:isOut?"right":"left",display:"flex",justifyContent:isOut?"flex-end":"flex-start",alignItems:"center",gap:6}}>
                    {m.is_ai&&<span style={{background:"#7C3AED",color:"#fff",borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:700}}>AI</span>}
                    {isOut && m.status === 'failed' && (
                      <span title={m.error_reason || '24시간 응답 윈도우 만료 등'} style={{color:"#D32F2F",fontWeight:700,background:"#FFEBEE",border:"1px solid #FFCDD2",borderRadius:4,padding:"1px 5px",fontSize:10,display:"inline-flex",alignItems:"center",gap:3}}>
                        <I name="alert" size={10}/>발송실패
                      </span>
                    )}
                    <span>{fmtTime(m.created_at)}</span>
                  </div>
                </div>
              </div>;
            })}
            <div ref={convoEndRef}/>
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid "+T.border,background:T.bgCard}}>
            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={genAI} disabled={aiLoading}
                title="AI가 대화 맥락 보고 답변 추천 (직원 검토 후 발송)"
                style={{padding:"6px 12px",background:T.primaryLt,color:T.primaryDk,border:"1px solid "+T.primary+"55",borderRadius:T.radius.md,fontSize:12,cursor:"pointer",fontWeight:T.fw.bold,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                <I name={aiLoading?"loader":"sparkles"} size={13}/> {aiLoading?"생성 중…":"AI 답변 추천"}
              </button>
              <button onClick={cycleTranslateMode}
                title={(translating||inTranslating)?"번역 중...":translateMode==="auto"?"자동: 고객 언어에 맞춰 번역":translateMode==="force_en"?"강제 영어: 한국 고객도 영어로":"끄기: 원문 그대로"}
                style={{padding:"6px 12px",
                  background:translateMode==="auto"?T.successLt:translateMode==="force_en"?T.infoLt:T.gray100,
                  color:translateMode==="auto"?T.successDk:translateMode==="force_en"?"#0e7490":T.gray600,
                  border:"1px solid "+(translateMode==="auto"?T.success+"55":translateMode==="force_en"?T.info+"55":T.border),
                  borderRadius:T.radius.md,fontSize:12,cursor:"pointer",fontWeight:T.fw.bold,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5,position:"relative"}}>
                {(translating||inTranslating) && <span style={{width:7,height:7,borderRadius:"50%",background:T.danger,animation:"blissPulse 1s infinite",display:"inline-block"}}/>}
                <I name="languages" size={13}/>
                {(translating||inTranslating) ? "번역 중…" : (translateMode==="auto"?"번역 자동":translateMode==="force_en"?"번역 영어":"번역 OFF")}
              </button>
              <button onClick={aiBook} disabled={aiBookLoading}
                title="AI가 대화 분석해서 예약 자동 등록 (담당자 확인 후 확정)"
                style={{padding:"6px 12px",background:aiBookLoading?T.gray400:T.primary,color:"#fff",border:"1px solid "+(aiBookLoading?T.gray400:T.primaryDk),borderRadius:T.radius.md,fontSize:12,cursor:aiBookLoading?"wait":"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                <I name={aiBookLoading?"loader":"calendar"} size={13} color="#fff"/> {aiBookLoading?"분석 중…":"AI 예약등록"}
              </button>
              {/* 🚨 오류신고 — AI 고객응대오류 원클릭 접수 (자동 화면캡처) */}
              <button onClick={reportAiError} disabled={aiErrBusy}
                title="AI 자동응대 오류 신고 — 현재 화면을 캡처해서 'AI 고객응대오류'로 접수해요"
                style={{padding:"6px 12px",background:aiErrBusy?T.gray400:"#FEF2F2",color:aiErrBusy?"#fff":"#DC2626",border:"1px solid "+(aiErrBusy?T.gray400:"#FCA5A5"),borderRadius:T.radius.md,fontSize:12,cursor:aiErrBusy?"wait":"pointer",fontWeight:T.fw.bolder,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                <I name={aiErrBusy?"loader":"alert"} size={13}/> {aiErrBusy?"접수 중…":"오류신고"}
              </button>
              {renderQrButton()}
              <select value={selStaff} onChange={e=>updateSelStaff(e.target.value)}
                title="답장 발신자 — 메시지 머리에 표시 (디폴트: 지점명, 변경 시 자동 저장)"
                style={{padding:"6px 10px",background:"#fff",color:T.text,border:"1px solid "+T.border,borderRadius:T.radius.md,fontSize:12,fontWeight:T.fw.bold,fontFamily:"inherit",cursor:"pointer"}}>
                {_userBranchName && <option value={_userBranchName}>{_userBranchName} (지점)</option>}
                {empList.map(e=>{ const v=e.id||e.name; if (v===_userBranchName) return null; return <option key={v} value={v}>{v}</option>; })}
                <option value="">— 말머리 없음 —</option>
              </select>
            </div>
            {aiKoDraft&&<div style={{fontSize:11,color:"#4338ca",padding:"3px 8px",background:"#eff6ff",borderRadius:6,marginBottom:4,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
            {aiBooked&&<div style={{fontSize:11,padding:"6px 9px",background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:8,marginBottom:5,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{color:"#065F46",fontWeight:700}}>✅ {aiBooked.changed?"예약 변경됨":"예약 등록됨"} — {(aiBooked.date||"").slice(5)} {aiBooked.time} {aiBooked.branch_name||""}{aiBooked.is_new?" · 신규":""}</span>
              <button type="button" onClick={()=>{ if(setPendingOpenRes&&setPage){ setPendingOpenRes({id:aiBooked.id,reservation_id:aiBooked.id,date:aiBooked.date,time:aiBooked.time,bid:aiBooked.bid,status:aiBooked.status||"request",_highlightOnly:true}); setPage("timeline"); } }}
                style={{marginLeft:"auto",padding:"3px 9px",fontSize:10,fontWeight:800,background:"#10B981",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>타임라인에서 보기 →</button>
            </div>}
            {renderQrPanel()}
            <div style={{display:"flex",gap:8}}>
              <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); setReplyIsAi(false); }}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doSend();}}}
                placeholder="메시지 입력..."
                style={{flex:1,padding:"10px 14px",border:"1px solid "+T.border,borderRadius:8,fontSize:15,resize:"none",minHeight:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"22px",overflowY:"auto"}}
              />
              <button onClick={()=>doSend()} disabled={sending||!reply.trim()}
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

// 모바일/사이드패널 탭 래퍼: 받은메시지 / 팀 채팅 / 입금문자
import { TeamChat, useTeamChat } from '../Chat'
import BankDeposits from './BankDeposits'
import NaverReviews from './NaverReviews'
function MessagesWithTeamTab(props) {
  const [tab, setTab] = useState(() => {
    // 외부에서 입금문자 탭 강제 오픈 (배너 클릭 등)
    if (typeof window !== 'undefined' && window.__bliss_inbox_initial_tab === 'deposits') {
      window.__bliss_inbox_initial_tab = null;
      return 'deposits';
    }
    return 'inbox';
  });
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [depositPending, setDepositPending] = useState(props.depositPending || 0);
  const [reviewPending, setReviewPending] = useState(props.reviewPending || 0);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // 외부에서 강제 탭 전환 신호 듣기 (window 이벤트)
  useEffect(() => {
    const onSwitch = (e) => { if (e?.detail?.tab) setTab(e.detail.tab); };
    window.addEventListener('bliss:inbox_tab', onSwitch);
    return () => window.removeEventListener('bliss:inbox_tab', onSwitch);
  }, []);
  // 미매칭 입금 카운트 — AppShell 단일 소스에서 props로 받음(자체 폴링 제거). onDepositChange로 로컬 즉시 갱신.
  useEffect(() => { setDepositPending(props.depositPending || 0); }, [props.depositPending]);
  useEffect(() => { setReviewPending(props.reviewPending || 0); }, [props.reviewPending]);
  const teamChat = useTeamChat();
  // 사이드 패널 모드(forceCompact): 모바일 UI(좁은 폭, 리스트↔개별 토글) 강제
  const compact = !!props.forceCompact;
  // 데스크탑은 기존 AdminInbox만 (단, compact가 아닐 때)
  if (!isMobile && !compact) return <AdminInbox {...props} />;
  const teamUnread = teamChat.unreadCount || 0;
  const tabBtn = (key, label, badge) => (
    <button onClick={()=>{ setTab(key); if (key==='team' && teamUnread>0) teamChat.markAllRead(); }} style={{
      flex:1, padding:'10px 0', border:'none', background: tab===key ? T.primaryLt : T.bgCard,
      color: tab===key ? T.primaryDk : T.textSub, fontWeight: tab===key ? 800 : 600,
      fontFamily:'inherit', fontSize:13, cursor:'pointer',
      borderBottom: tab===key ? `2px solid ${T.primary}` : '2px solid transparent',
      display:'flex', alignItems:'center', justifyContent:'center', gap:6, whiteSpace:'nowrap',
    }}>
      {label}
      {badge > 0 && <span style={{background:T.danger,color:'#fff',borderRadius:10,fontSize:10,fontWeight:700,padding:'1px 6px',minWidth:16,textAlign:'center'}}>{badge>99?'99+':badge}</span>}
    </button>
  );
  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', minHeight:0}}>
      <div style={{display:'flex', borderBottom:`1px solid ${T.border}`, background: T.bgCard, flexShrink:0}}>
        {tabBtn('inbox', <span style={{display:'inline-flex',alignItems:'center',gap:5}}><I name="msgSq" size={14}/>받은메시지</span>)}
        {tabBtn('team', <span style={{display:'inline-flex',alignItems:'center',gap:5}}><I name="users" size={14}/>팀 채팅</span>, teamUnread)}
        {tabBtn('deposits', <span style={{display:'inline-flex',alignItems:'center',gap:5}}><I name="building" size={14}/>입금</span>, depositPending)}
        {tabBtn('reviews', <span style={{display:'inline-flex',alignItems:'center',gap:5}}><I name="naver" size={14}/>리뷰</span>, reviewPending)}
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='inbox' ? 'flex' : 'none', flexDirection:'column'}}>
        <AdminInbox {...props} />
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='team' ? 'flex' : 'none', flexDirection:'column'}}>
        <TeamChat scrollTrigger={tab==='team'} />
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='deposits' ? 'flex' : 'none', flexDirection:'column'}}>
        <BankDeposits
          data={props.data}
          branches={props.branches}
          userBranches={props.userBranches}
          currentUser={props.currentUser}
          onDepositChange={(n)=>setDepositPending(n)}
          setPendingOpenRes={props.setPendingOpenRes}
          setPage={props.setPage}
        />
      </div>
      <div style={{flex:1, minHeight:0, display: tab==='reviews' ? 'flex' : 'none', flexDirection:'column'}}>
        <NaverReviews
          data={props.data}
          branches={props.branches}
          userBranches={props.userBranches}
          currentUser={props.currentUser}
          setPage={props.setPage}
          setPendingOpenCust={props.setPendingOpenCust}
          setPendingOpenRes={props.setPendingOpenRes}
          onReplyDone={()=>{ setReviewPending(p=>Math.max(0,p-1)); props.onReviewReplied && props.onReviewReplied(); }}
          onReviewChange={(n)=>setReviewPending(n)}
        />
      </div>
    </div>
  );
}

export default MessagesWithTeamTab
