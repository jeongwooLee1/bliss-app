import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, matchAllTokens } from '../../lib/sb'
import { searchDocs, buildDocsContext } from '../../lib/aiDocs'
import { fromDb } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, diffMins, getDow, genId, fmtLocal, dateFromStr, isoDate, getMonthDays, timeToY, durationToH, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, useSessionState, TTL } from '../../lib/utils'
import I from '../common/I'
import { ChannelLogo } from './channelIcons'


// 지점 매핑은 data.branches에서 동적 생성 (하드코딩 제거)


function AdminInbox({ sb, branches, data, setData, onRead, onChatOpen, userBranches=[], isMaster=false, currentUser=null, pendingChat=null, onPendingChatDone, setPendingOpenRes, setPage, forceCompact=false }) {
  // forceCompact: 사이드 패널 모드 — 좁은 폭에서 모바일 UI(리스트↔개별 토글) 사용
  const isMobile = forceCompact || (typeof window !== "undefined" && window.innerWidth < 768);
  const CH_ICON = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T",line:"L"};
  const CH_NAME = {naver:"네이버톡톡",kakao:"카카오",instagram:"인스타",whatsapp:"왓츠앱",telegram:"텔레그램",line:"LINE"};
  const CH_COLOR = {naver:"#03C75A",kakao:"#F9E000",instagram:"#E1306C",whatsapp:"#128C7E",telegram:"#2AABEE",line:"#06C755"};
  const CH_LABEL = {naver:"N",kakao:"K",instagram:"I",whatsapp:"W",telegram:"T",line:"L"};
  const getGeminiKey = () => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";

  const [msgs, setMsgs] = useState([]);
  // 선택된 대화방 {channel,user_id} — 새로고침 시 유지 (24h TTL)
  const [sel, setSel] = useSessionState("msg_sel", null, { ttlMs: TTL.TAB });
  const [reply, setReply] = useState("");
  // AI로 생성된 답변인지 추적 (is_ai 플래그용)
  const [replyIsAi, setReplyIsAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBookLoading, setAiBookLoading] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(true);
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
        SB_URL+`/rest/v1/messages?created_at=gte.${sinceEnc}&order=created_at.desc&limit=1000&offset=${offset}&select=*`,
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
  const _chMeta = [["naver","N 네이버","#03C75A"],["instagram","I 인스타","#E1306C"],["whatsapp","W 왓츠앱","#128C7E"],["line","L LINE","#06C755"]];
  const _nowInWindow = (sc) => {
    if (!sc?.enabled) return true;
    const now=new Date(); const cur=now.getHours()*60+now.getMinutes();
    const toMin=s=>{const [h,m]=(s||"0:0").split(":").map(Number);return h*60+(m||0);};
    const st=toMin(sc.start||"00:00"), en=toMin(sc.end||"23:59");
    return st<=en ? (cur>=st&&cur<=en) : (cur>=st||cur<=en);
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
        const rows = await sb.get('customers', `&business_id=eq.${data?.business?.id||'biz_khvurgshb'}&sns_accounts=cs.${filter}&limit=1`);
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
      if(!isWhatsApp && !isLine && !isAitest && allowedIds.length>0 && m.account_id && m.account_id!=="unknown" && !allowedIds.includes(String(m.account_id))) return;
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
    return list;
  },[msgs, allowedIds.length, msgSearch, chatCustMapFull]);

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
    let url = SB_URL+"/rest/v1/messages?user_id=eq."+uid+"&is_read=eq.false";
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
  const [selStaff, setSelStaff] = useState(currentUser?.name || "");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.employees_v1&select=value&limit=1`, {
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
  // currentUser.name 변경 시 selStaff 기본값도 업데이트 (한 번만)
  useEffect(() => { if (!selStaff && currentUser?.name) setSelStaff(currentUser.name); }, [currentUser?.name]);

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
        setReply(""); setReplyIsAi(false); setAiKoDraft("");
        // 답변 송신 시점에 들어와있는 미읽음 메시지 일괄 처리 (열어놓고 답변 작성 중 도착한 신규 포함)
        markRead(sel.user_id, sel.channel||"naver");
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
      // 첫 고객 메시지 언어 기준 고정 — 대화 도중 한국어 단어 섞여도 첫 메시지 언어 유지
      const inMsgs = convo.filter(m=>m.direction==="in"&&m.message_text&&!String(m.message_text).startsWith("[미디어]"));
      const firstIn = inMsgs[0];
      const sampleText = (firstIn?.message_text || "").slice(0, 200);
      const koChars = (sampleText.match(/[가-힣]/g)||[]).length;
      const enChars = (sampleText.match(/[a-zA-Z]/g)||[]).length;
      const langName = koChars >= enChars ? "한국어" : "영어";
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
        const bizId = data?.business?.id || data?.businesses?.[0]?.id || "biz_khvurgshb";
        if (lastInMsg && bizId) {
          const hits = await searchDocs({ question: lastInMsg, businessId: bizId, geminiKey: key, threshold: 0.5, count: 5 });
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
★ 연간회원권 보유 고객(이 고객의 다회권 블록 참고)이면 회원가로 안내

[왁서 성별 안내 정책]
★ "남자 왁서 계세요?" / "남자 직원 있나요?" 같은 질문엔:
  • 한국어: "네! 남성 왁서도 있어요 😊 예약 시 '남자 왁서 요청'이라고 말씀해주시면 해당 지점·시간에 가능한지 확인해서 배정해드릴게요~"
  • English: "Yes, we have male waxers! Please request a male waxer when booking and we'll arrange one based on availability at your branch/time."
★ "지점마다 다르다 / 상황에 따라 달라진다" 같은 애매한 표현 금지. 남성 왁서 있음을 명확히 알리고 예약 유도.
★ 여자 왁서 선호 고객도 동일 — 예약 요청사항 기재 시 배정 도와드린다고 안내
★ 특정 관리사 이름은 언급 금지`;

      const prompt=`${chatPrompt}${salesPolicyCtx}${priceCtx}${branchCtx}${pkgCtx}${docsCtx}\n\n[대화]\n${lastMsgs}\n\n고객 마지막 메시지에 답변하세요. 답변은 위 [학습 문서] 내용을 최우선으로 참고하세요. JSON만 출력:\n{"reply":"${langName}로 작성한 답변","ko":"한국어 번역"}`;
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
  // v3.7.218: confirm() 제거 — iOS PWA·일부 모바일 브라우저에서 차단되어 동작 불가하던 문제 해결
  const aiBook = async()=>{
    if(!sel||aiBookLoading) return;
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
        // AI가 ask_info로 반환 — AI가 어떤 정보를 더 필요하다고 판단했는지 그대로 노출
        const aiReply = (dd.reply||"").trim();
        const hint = aiReply ? `\n\nAI 응답:\n${aiReply.slice(0,200)}` : "";
        alert("ℹ️ AI가 정보 부족으로 예약을 보류했어요.\n\n고객에게 필요한 정보를 확인 후 재시도하거나 타임라인에서 직접 등록해주세요."+hint);
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
          text = String(translated || reply).replace(/^["'`]+|["'`]+$/g, "").trim();
          // 외국어 발송 시 사용자가 친 한국어 원문을 translated_text로 동반 → echo 처리 시 메시지함에 그대로 표시
          await sendMsg(text, reply.trim());
          return;
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
                {uc>0&&<div style={{width:forceCompact?16:20,height:forceCompact?16:20,borderRadius:"50%",background:T.primary,color:"#fff",fontSize:forceCompact?9:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:4}}>{uc}</div>}
              </div>
              {(()=>{const res=chatResMap[key];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"확정대기":res.status==="completed"?"완료":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":"#9E9E9E";return<div style={{display:"flex",alignItems:"center",gap:4,marginTop:3}}><span style={{fontSize:10,fontWeight:700,color:clr,background:clr+"18",borderRadius:3,padding:"1px 6px"}}>📅 {st} {res.date?.slice(5)} {res.time}</span></div>;})()}
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
            {(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(cust) return <span style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:forceCompact?9:11,fontWeight:700,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary+"40",borderRadius:6,padding:"1px 5px",whiteSpace:"nowrap",flexShrink:0}}>👤 {cust.name}{cust.custNum?` #${cust.custNum}`:""}<button onClick={unlinkCustomer} title="고객 연결 해제" style={{marginLeft:2,background:"none",border:"none",padding:"0 2px",fontSize:11,fontWeight:900,color:T.textMuted,cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>×</button></span>; return <button onClick={()=>setLinkPickerOpen(v=>!v)} style={{fontSize:forceCompact?9:10,fontWeight:800,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary,borderRadius:6,padding:"2px 7px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>🔗 연결</button>; })()}
          </div>
          <div style={{fontSize:forceCompact?10:12,color:T.textSub,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{CH_NAME[sel.channel]||sel.channel}{(()=>{ const ph=convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone||(sel.channel==="whatsapp"&&sel.user_id?(sel.user_id.startsWith("82")?"0"+sel.user_id.slice(2):sel.user_id):""); return ph?" · "+ph:""; })()}{(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(!cust?.phone) return null; return " · "+cust.phone; })()}</div>
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
        {(()=>{const res=chatLatestRes[sel.channel+"_"+sel.user_id];if(!res)return null;const st=res.status==="confirmed"?"확정":res.status==="request"?"대기":res.status==="completed"?"완료":res.status==="reserved"?"예약":res.status==="no_show"?"노쇼":null;if(!st)return null;const clr=res.status==="confirmed"?"#4CAF50":res.status==="request"?"#FF9800":res.status==="completed"?"#9E9E9E":res.status==="no_show"?"#EF5350":T.primary;return<button onClick={()=>{if(setPendingOpenRes&&setPage){setPendingOpenRes({...res, _highlightOnly:true});setPage("timeline");setSel(null);}}} title={`${st} ${res.date?.slice(5)} ${res.time} — 예약 바로가기`} style={{fontSize:forceCompact?10:11,fontWeight:700,color:clr,background:clr+"15",border:"1px solid "+clr+"40",borderRadius:6,padding:forceCompact?"3px 6px":"4px 8px",cursor:"pointer",fontFamily:"inherit",flexShrink:0,whiteSpace:"nowrap"}}>📅{forceCompact?"":st}</button>;})()}
        {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={_extLink.label} style={{fontSize:forceCompact?10:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:forceCompact?"3px 6px":"4px 8px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>{forceCompact?"↗":_extLink.short+" ↗"}</a>}
      </div>
      {/* 메시지 */}
      <div style={{flex:1,overflowY:"auto",padding:forceCompact?"10px 10px 4px":"16px 16px 4px",display:"flex",flexDirection:"column",gap:forceCompact?6:10,WebkitOverflowScrolling:"touch",background:"#f5f5f7"}}>
        {convo.map((m,i)=>{
          if(m.direction==="system") return null;
          const isOut=m.direction==="out";
          return <div key={i} style={{display:"flex",flexDirection:isOut?"row-reverse":"row",alignItems:"flex-end",gap:forceCompact?5:8}}>
            {/* AI 발송 메시지는 보라색 아바타 🤖 (id_imgr471swt-2 요청) */}
            {isOut&&m.is_ai&&<div style={{width:forceCompact?22:28,height:forceCompact?22:28,borderRadius:14,background:"#7C3AED",display:"flex",alignItems:"center",justifyContent:"center",fontSize:forceCompact?11:14,flexShrink:0,color:"#fff"}}>🤖</div>}
            <div style={{maxWidth:"82%"}}>
              {/* AI 발송 메시지에 선명한 AI 배지 */}
              {m.is_ai&&<div style={{display:"flex",justifyContent:isOut?"flex-end":"flex-start",marginBottom:3}}>
                <span style={{background:"#7C3AED",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:forceCompact?9:10,fontWeight:800,letterSpacing:0.3}}>🤖 AI 자동응답</span>
              </div>}
              {/* 직원 답장 말머리 — 고객엔 노출 안 됨, 직원만 봄 */}
              {isOut && !m.is_ai && m.sent_by_staff_name && <div style={{display:"flex",justifyContent:isOut?"flex-end":"flex-start",marginBottom:3}}>
                <span style={{background:"#6D28D9",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:forceCompact?9:10,fontWeight:800,letterSpacing:0.3}}>👤 {m.sent_by_staff_name}</span>
              </div>}
              <div style={{padding:forceCompact?"7px 10px":"10px 14px",borderRadius:isOut?"14px 14px 4px 14px":"14px 14px 14px 4px",background:isOut?(m.is_ai?"#7C3AED":T.primary):"#fff",color:isOut?"#fff":T.text,fontSize:forceCompact?12:16,lineHeight:1.45,boxShadow:"0 1px 2px rgba(0,0,0,.08)",border:isOut?"none":"1px solid "+T.border,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                {m.message_text}
                {m.translated_text&&<div style={{marginTop:5,paddingTop:5,borderTop:isOut?"1px solid rgba(255,255,255,0.45)":"1px solid rgba(0,0,0,0.18)",fontSize:forceCompact?11:12,color:isOut?"rgba(255,255,255,0.95)":"rgba(0,0,0,0.78)",fontWeight:500}}>🔤 {m.translated_text}</div>}
              </div>
              <div style={{fontSize:forceCompact?9:10,color:T.textMuted,marginTop:2,textAlign:isOut?"right":"left"}}>
                {fmtTime(m.created_at)}
              </div>
            </div>
          </div>;
        })}
        <div ref={convoEndRef}/>
      </div>
      {/* 입력창 */}
      <div style={{background:"transparent",padding:"8px 12px 12px",flexShrink:0}}>
        <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={genAI} disabled={aiLoading} title="AI 답변 생성" style={{padding:forceCompact?"3px 8px":"4px 10px",background:"#f0f4ff",color:"#4338ca",border:"1px solid #c7d2fe",borderRadius:6,fontSize:forceCompact?10:12,cursor:"pointer",fontWeight:600}}>{aiLoading?"⏳":"✨ AI"}</button>
          <button onClick={()=>setAutoTranslate(v=>!v)} style={{padding:forceCompact?"3px 8px":"4px 10px",background:autoTranslate?"#166534":"#f0fdf4",color:autoTranslate?"#fff":"#166534",border:"1px solid #bbf7d0",borderRadius:6,fontSize:forceCompact?10:12,cursor:"pointer",fontWeight:600}}>🌐 {autoTranslate?"ON":"OFF"}</button>
          <button onClick={aiBook} disabled={aiBookLoading} title="대화 분석하여 AI 예약 생성" style={{padding:forceCompact?"3px 8px":"4px 10px",background:aiBookLoading?"#9CA3AF":"#7C3AED",color:"#fff",border:"1px solid "+(aiBookLoading?"#9CA3AF":"#6D28D9"),borderRadius:6,fontSize:forceCompact?10:12,cursor:aiBookLoading?"wait":"pointer",fontWeight:700}}>{aiBookLoading?"⏳":"🤖 예약"}</button>
          {/* 직원 말머리 선택 — 답장 보낼 때 누가 보내는지 */}
          <select value={selStaff} onChange={e=>setSelStaff(e.target.value)}
            title="답장 보낼 직원 (말머리에 표시)"
            style={{padding:forceCompact?"3px 6px":"4px 8px",background:"#EDE9FE",color:"#6D28D9",border:"1px solid #C4B5FD",borderRadius:6,fontSize:forceCompact?10:12,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="">👤 직원 선택</option>
            {empList.map(e=><option key={e.id||e.name} value={e.id||e.name}>👤 {e.id||e.name}</option>)}
          </select>
        </div>
        {aiKoDraft&&<div style={{fontSize:forceCompact?11:12,color:"#4338ca",padding:"4px 8px",background:"#eff6ff",borderRadius:6,marginBottom:6,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
        <div style={{position:"relative"}}>
          <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); setAiKoDraft(""); }}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();autoTranslate?sendTranslated():sendMsg(reply.trim(), aiKoDraft);}}}
            placeholder="메시지 입력..."
            style={{width:"100%",padding:forceCompact?"8px 44px 8px 12px":"10px 52px 10px 14px",border:"1px solid "+T.border,borderRadius:12,fontSize:forceCompact?12:15,resize:"none",minHeight:forceCompact?36:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"20px",overflowY:"auto",boxSizing:"border-box",WebkitAppearance:"none",appearance:"none"}}
          />
          {(reply.trim()||sending)&&<button onClick={()=>autoTranslate?sendTranslated():sendMsg(reply.trim(), aiKoDraft)} disabled={sending||!reply.trim()}
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
            <div style={{flex:1,minWidth:0,position:"relative"}}>
              <div style={{fontWeight:T.fw.bolder,fontSize:T.fs.sm,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span>{(sel?.channel!=="whatsapp"&&branchName(convo[0]))?branchName(convo[0])+" · ":""}{getDisplayName(convo[0]||{user_id:sel.user_id})}</span>
                {(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(cust) return <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,fontWeight:700,color:T.primary,background:T.primaryLt||"#EEF2FF",border:"1px solid "+T.primary+"40",borderRadius:6,padding:"2px 6px",whiteSpace:"nowrap"}} title={cust.phone||""}>👤 {cust.name}{cust.custNum?` #${cust.custNum}`:""}<button onClick={unlinkCustomer} title="고객 연결 해제" style={{marginLeft:2,background:"none",border:"none",padding:"0 2px",fontSize:12,fontWeight:900,color:T.textMuted,cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>×</button></span>; return <button onClick={()=>setLinkPickerOpen(v=>!v)} style={{fontSize:10,fontWeight:700,color:T.textMuted,background:"#fff",border:"1px dashed "+T.gray400,borderRadius:6,padding:"2px 6px",cursor:"pointer",fontFamily:"inherit"}}>🔗 고객 연결</button>; })()}
              </div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted}}>{CH_NAME[sel.channel]||sel.channel}{(()=>{ const ph=convo.find(m=>m.cust_phone)?.cust_phone||sel.cust_phone||(sel.channel==="whatsapp"&&sel.user_id?(sel.user_id.startsWith("82")?"0"+sel.user_id.slice(2):sel.user_id):""); return ph?" · "+ph:""; })()}{(()=>{ const cust = chatCustMapFull[sel.channel+"_"+sel.user_id]; if(!cust?.phone) return null; return " · "+cust.phone; })()}</div>
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
            {_extLink && <a href={_extLink.url} target="_blank" rel="noopener noreferrer" title={_extLink.label} style={{fontSize:11,fontWeight:700,color:_extLink.color,background:_extLink.color+"18",border:"1px solid "+_extLink.color+"44",borderRadius:6,padding:"4px 10px",textDecoration:"none",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>{_extLink.label} ↗</a>}
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
                  <div style={{fontSize:10,color:T.textMuted,marginTop:3,textAlign:isOut?"right":"left"}}>
                    {m.is_ai&&<span style={{background:"#7C3AED",color:"#fff",borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:700,marginRight:4}}>AI</span>}
                    {fmtTime(m.created_at)}
                  </div>
                </div>
              </div>;
            })}
            <div ref={convoEndRef}/>
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid "+T.border,background:T.bgCard}}>
            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={genAI} disabled={aiLoading} title="AI 답변 생성" style={{padding:"4px 10px",background:"#f0f4ff",color:"#4338ca",border:"1px solid #c7d2fe",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>{aiLoading?"⏳":"✨ AI"}</button>
              <button onClick={()=>setAutoTranslate(v=>!v)} style={{padding:"4px 10px",background:autoTranslate?"#166534":"#f0fdf4",color:autoTranslate?"#fff":"#166534",border:"1px solid #bbf7d0",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>🌐 자동번역 {autoTranslate?"ON":"OFF"}</button>
              <button onClick={aiBook} disabled={aiBookLoading} title="대화 분석하여 AI 예약 생성" style={{padding:"4px 10px",background:aiBookLoading?"#9CA3AF":"#7C3AED",color:"#fff",border:"1px solid "+(aiBookLoading?"#9CA3AF":"#6D28D9"),borderRadius:6,fontSize:11,cursor:aiBookLoading?"wait":"pointer",fontWeight:700}}>{aiBookLoading?"⏳ 분석 중…":"🤖 AI 예약생성"}</button>
              {/* 직원 말머리 선택 */}
              <select value={selStaff} onChange={e=>setSelStaff(e.target.value)}
                title="답장 보낼 직원 (말머리에 표시)"
                style={{padding:"4px 10px",background:"#EDE9FE",color:"#6D28D9",border:"1px solid #C4B5FD",borderRadius:6,fontSize:11,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>
                <option value="">👤 직원 선택</option>
                {empList.map(e=><option key={e.id||e.name} value={e.id||e.name}>👤 {e.id||e.name}</option>)}
              </select>
            </div>
            {aiKoDraft&&<div style={{fontSize:11,color:"#4338ca",padding:"3px 8px",background:"#eff6ff",borderRadius:6,marginBottom:4,borderLeft:"3px solid #818cf8"}}>🇰🇷 {aiKoDraft}</div>}
            <div style={{display:"flex",gap:8}}>
              <textarea id="bliss-reply-ta" value={reply} onChange={e=>{ setReply(e.target.value); }}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();autoTranslate?sendTranslated():sendMsg(reply.trim(), aiKoDraft);}}}
                placeholder="메시지 입력..."
                style={{flex:1,padding:"10px 14px",border:"1px solid "+T.border,borderRadius:8,fontSize:15,resize:"none",minHeight:42,maxHeight:200,fontFamily:"inherit",outline:"none",background:"#fff",color:"#1f2937",lineHeight:"22px",overflowY:"auto"}}
              />
              <button onClick={()=>autoTranslate?sendTranslated():sendMsg(reply.trim(), aiKoDraft)} disabled={sending||!reply.trim()}
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
        <TeamChat scrollTrigger={tab==='team'} />
      </div>
    </div>
  );
}

export default MessagesWithTeamTab
