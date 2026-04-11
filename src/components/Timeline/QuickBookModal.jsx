import React, { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'

function QuickBookModal({ onClose, onParsed, data }) {
  // 브라우저 뒤로가기 지원
  useEffect(() => {
    history.pushState({modal:'quickbook'}, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onClose]);

  const [input, setInput] = useState("");
  const [imgData, setImgData] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const [audioData, setAudioData] = useState(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const inputRef = useRef(null);
  const apiKey = window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";
  const C = T.primary;
  const G1 = T.google, G2 = T.purple, G3 = T.female;

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/mp4";
      const rec = new MediaRecorder(stream, {mimeType: mime});
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if(e.data.size>0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(chunksRef.current, {type: mime});
        const reader = new FileReader();
        reader.onload = () => setAudioData({base64:reader.result.split(",")[1], mimeType:mime.split(";")[0]});
        reader.readAsDataURL(blob);
      };
      rec.start(1000); mediaRecRef.current = rec;
      setIsListening(true); setRecordSec(0); setAudioData(null); setResult(null); setError(null);
      timerRef.current = setInterval(()=>setRecordSec(s=>s+1), 1000);
    } catch(e) {
      if (location.protocol === "http:") {
        alert("음성 입력은 HTTPS 환경에서만 사용 가능합니다.\n텍스트로 입력해 주세요.");
      } else {
        alert("마이크 권한이 필요합니다.\n브라우저 설정에서 마이크 접근을 허용해 주세요.");
      }
    }
  };
  const stopVoice = () => { mediaRecRef.current?.stop(); setIsListening(false); clearInterval(timerRef.current); };
  useEffect(() => { if (audioData) doParse(null, audioData); }, [audioData]);
  useEffect(() => { if (imgData) doParse(null, null); }, [imgData]);

  const handleImage = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImgData({base64:ev.target.result.split(",")[1], mimeType:file.type}); setImgPreview(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if(!items) return;
    for(let i=0;i<items.length;i++){
      if(items[i].type.startsWith("image/")){
        e.preventDefault();
        const file = items[i].getAsFile();
        if(!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const imgObj = {base64:ev.target.result.split(",")[1], mimeType:file.type};
          setImgData(imgObj);
          setImgPreview(ev.target.result);
          // 즉시 분석 (imgData state 업데이트 전이라 직접 전달)
          setTimeout(() => doParse(null, null), 100);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  const buildPrompt = () => {
    const today = new Date(), dow = ["일","월","화","수","목","금","토"];
    const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")} (${dow[today.getDay()]})`;
    const tags = (data?.serviceTags || []).filter(t=>t.useYn!==false && t.scheduleYn!=="Y");
    const svcs = (data?.services || []).filter(s=>s.useYn!==false);
    const tagList = tags.map(t=>`"${t.id}":"${t.name}"${t.dur?`(${t.dur}분)`:""}`).join(", ");
    const svcList = svcs.map(s=>`"${s.id}":"${s.name}"${s.dur?`(${s.dur}분)`:""}`).join(", ");
    const srcList = (data?.resSources||[]).filter(s=>s.useYn!==false).map(s=>s.name);
    // AI 커스텀 규칙
    const aiRules = JSON.parse(localStorage.getItem("bliss_ai_rules")||"[]");
    const rulesBlock = aiRules.length > 0 ? "\n[추가 판단 규칙]\n" + aiRules.map((r,i)=>`${i+1}. ${r}`).join("\n") : "";
    return `당신은 미용실/왁싱샵 예약 정보를 추출하는 AI입니다.\n오늘 날짜: ${ds}\n\n아래 텍스트/이미지/음성에서 예약 정보를 추출해 JSON으로만 응답하세요.\n마크다운 백틱이나 설명 없이 순수 JSON만 출력하세요.\n\n[이미지] 채팅 앱 스크린샷 분석 시 반드시 다음 순서로 처리:\n1단계: 화면 최상단 헤더 영역에서 전화번호/이름을 먼저 추출\n2단계: 대화 내용에서 날짜, 시간, 시술 정보 추출\n3단계: 앱 종류 판별\n※ 헤더의 전화번호가 고객 전화번호입니다.\n\n[이미지 - 크림POS/예약관리 시스템 스크린샷인 경우]\n- 시스템의 체크박스/라벨(인스타, 선예약, 체험/인플, 바디, 기존, 신규, 음모, 왁싱PKG, 토탈PKG, 기)종료 등)은 태그로 선택하지 마세요. 이것은 시스템 내부 분류일 뿐입니다.\n- 반드시 예약메모(텍스트 입력 영역)만 읽어서 분석하세요.\n- 메모에 "X" 또는 "×" 표시가 붙은 항목은 해당 시술을 하지 않는다는 의미입니다. (예: "에너지테라피 ×" → 에너지테라피 선택하지 마세요)\n\n[음성] 오디오 첨부 시 음성을 듣고 추출. 공=0,일=1,이=2,삼=3,사=4,오=5,육=6,칠=7,팔=8,구=9. 공일공=010.\n\n[등록된 서비스태그] {${tagList || "없음"}}\n[등록된 시술상품] {${svcList || "없음"}}\n[등록된 예약경로] [${srcList.length ? srcList.map(s=>`"${s}"`).join(",") : "없음"}]\n\n[태그 선택 규칙 - 매우 중요]\n- 태그는 최소한만 선택하세요. 0~2개가 적절합니다.\n- 메모에 직원이 직접 작성한 태그 관련 지시가 있을 때만 선택하세요.\n- 시스템 체크박스에 체크되어 있다고 태그를 선택하지 마세요.\n- "신규", "예약금완료" 태그는 절대 선택 금지 (시스템 자동 처리)\n- "주차" 태그는 고객이 "주차 필요"라고 직접 요청한 경우에만\n- "기)종료★", "★★초보X", "선예약", "지정관리" 등은 메모에 명시적 지시가 없으면 선택하지 마세요\n- 확실하지 않으면 선택하지 마세요. 잘못된 태그 1개보다 빈 배열이 낫습니다\n\n[시술상품 선택 규칙]\n- 메모에서 실제 시술 부위/시술명을 찾아 매칭\n[왁싱 용어 매핑] 음모왁싱=브라질리언, eyebrows=눈썹, underarm=겨드랑이, leg=다리, arm=팔, bikini=비키니, full body=전신\n- '재방문', '신규', '이벤트' 단독은 시술이 아닙니다\n${rulesBlock}\n\n추출 항목:\n- custName: 고객 이름 (없으면 "")\n- custPhone: 전화번호 (010-XXXX-XXXX. 해외번호 원본유지)\n- date: YYYY-MM-DD\n- time: HH:MM 24시간\n- dur: 소요시간(분) (없으면 0)\n- memo: 직원이 반드시 알아야 할 특이사항/주의사항 (예: "인플루언서 동의서 작성", "영어 응대 필요", "털양 많음 - 도움 필요", "알레르기 있음"). 시술명/지점명/날짜/연락처/시간은 넣지 마세요. 특이사항이 없으면 ""\n- branch: 지점명 (강남점/홍대점 등 언급된 경우. 없으면 "")\n- source: 예약경로 (등록된 목록에서만 선택. 명시적 언급만. WhatsApp→와츠앱, 카카오톡→카톡. 없으면 "")\n- custGender: "M" or "F" or ""\n- matchedTagIds: 매칭된 서비스태그 ID 배열. 없으면 []\n- matchedServiceIds: 매칭된 시술상품 ID 배열. 없으면 []`;
  };

  const doParse = async (evt, overrideAudio) => {
    const ad = overrideAudio || audioData;
    if (!apiKey) { setError("관리설정 → AI설정에서 API 키를 등록하세요"); return; }
    if (!input.trim() && !imgData && !ad) { setError("텍스트, 이미지, 또는 음성을 입력하세요"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const parts = [{text: buildPrompt()}];
      if (input.trim()) parts.push({text: "입력:\n" + input.trim()});
      if (imgData) parts.push({inlineData:{mimeType:imgData.mimeType, data:imgData.base64}});
      if (ad) parts.push({inlineData:{mimeType:ad.mimeType, data:ad.base64}});
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts}], generationConfig:{temperature:0}})
      });
      if (!r.ok) throw new Error("API: "+(await r.text()).slice(0,120));
      const d = await r.json();
      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = JSON.parse(txt.replace(/```json|```/g,"").trim());
      onParsed(parsed);
    } catch(e) { setError("분석 실패: "+e.message); }
    setLoading(false);
  };

  const editResult = (k,v) => setResult(p=>({...p,[k]:v}));
  const reset = () => { setResult(null);setError(null);setAudioData(null);setRecordSec(0);setImgData(null);setImgPreview(null);setInput(""); };
  const handleSubmit = () => { if (input.trim() || imgData) doParse(); };

  const sparkle = <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" fill="url(#gsp)"/><defs><linearGradient id="gsp" x1="3" y1="2" x2="21" y2="22"><stop stopColor={T.google}/><stop offset="0.5" stopColor={T.purple}/><stop offset="1" stopColor={T.female}/></linearGradient></defs></svg>;

  return <div style={{position:"fixed",inset:0,zIndex:500,background:T.bgCard,display:"flex",flexDirection:"column"}}>
    <style>{`@keyframes qb-spin{to{transform:rotate(360deg)}}@keyframes qb-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.15);opacity:1}}@keyframes qb-mic-idle{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}@keyframes qb-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes qb-breathe{0%{transform:scale(1) rotate(0deg);opacity:.85}15%{transform:scale(1.18) rotate(8deg);opacity:1}30%{transform:scale(.95) rotate(-5deg);opacity:.75}45%{transform:scale(1.22) rotate(12deg);opacity:.95}60%{transform:scale(1.05) rotate(-3deg);opacity:.8}75%{transform:scale(1.3) rotate(6deg);opacity:1}90%{transform:scale(.98) rotate(-8deg);opacity:.7}100%{transform:scale(1) rotate(0deg);opacity:.85}}@keyframes qb-glow{0%{box-shadow:0 0 15px #4285f420,0 0 30px #9b72cb10}33%{box-shadow:0 0 25px #9b72cb30,0 0 45px #d9657015}66%{box-shadow:0 0 20px #d9657025,0 0 40px #4285f410}100%{box-shadow:0 0 15px #4285f420,0 0 30px #9b72cb10}}.qb-field:focus{border-color:#7c7cc850!important;background:#fff!important}`}</style>

    {/* Top bar */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",flexShrink:0}}>
      <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",padding:6,display:"flex",color:T.gray600}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div style={{display:"flex",alignItems:"center",gap:6}}>{sparkle}<span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>AI Book</span></div>
      <div style={{width:32}}/>
    </div>

    {/* Content */}
    <div style={{flex:1,overflow:"auto",padding:"0 20px",display:"flex",flexDirection:"column"}}>

      {/* Empty — voice-first */}
      {!result && !loading && !error && !imgPreview && !isListening && <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:28,padding:"0 28px"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:18}}>
          <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{position:"absolute",width:144,height:144,borderRadius:"50%",background:"rgba(217,101,112,.06)",animation:"qb-mic-idle 3s ease-in-out infinite"}}/>
            <div style={{position:"absolute",width:116,height:116,borderRadius:"50%",background:"rgba(217,101,112,.1)"}}/>
            <button onClick={startVoice} style={{position:"relative",zIndex:1,width:92,height:92,borderRadius:"50%",background:"linear-gradient(145deg,#d96570,#c0506b)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 8px 32px rgba(217,101,112,.45)",transition:"transform .12s"}}
              onTouchStart={e=>e.currentTarget.style.transform="scale(.93)"}
              onTouchEnd={e=>e.currentTarget.style.transform="scale(1)"}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93H2c0 4.92 3.66 9 8.44 9.44V21h3.11v-3.56C18.34 16.99 22 12.91 22 7.99h-2c0 4.08-3.05 7.44-7 7.93V15h-2v.93z"/></svg>
            </button>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:6}}>말씀해 주세요</div>
            <div style={{fontSize:T.fs.sm,color:T.gray500,lineHeight:1.8}}>마이크를 누르면 잘 듣고 있을게요<br/>카톡 메시지·이미지도 분석해드려요</div>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{display:"none"}}/>
          <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handleImage} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current?.click()} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:7,padding:"16px 0",borderRadius:16,border:"1.5px solid "+T.border,background:T.bgCard,cursor:"pointer",color:T.textSub,fontSize:T.fs.xs,fontWeight:500}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>이미지
          </button>
          <button onClick={()=>camRef.current?.click()} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:7,padding:"16px 0",borderRadius:16,border:"1.5px solid "+T.border,background:T.bgCard,cursor:"pointer",color:T.textSub,fontSize:T.fs.xs,fontWeight:500}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>카메라
          </button>
        </div>
        <div style={{width:"100%",background:T.gray100,borderRadius:16,padding:"4px 4px 4px 16px",display:"flex",alignItems:"center",gap:8}}>
          <textarea ref={inputRef} value={input} onChange={e=>{setInput(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSubmit();}}}
            onPaste={handlePaste} placeholder="카톡 메시지 텍스트 붙여넣기..." rows={1}
            style={{flex:1,border:"none",background:"transparent",fontSize:T.fs.sm,fontFamily:"inherit",color:T.text,outline:"none",resize:"none",padding:"10px 0",lineHeight:1.5}}/>
          {input.trim() && <button onClick={handleSubmit} style={{width:36,height:36,borderRadius:12,background:"linear-gradient(135deg,#4285f4,#9b72cb)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>}
        </div>
        {imgPreview && <div style={{fontSize:T.fs.xxs,color:T.gray500}}>📎 이미지 첨부됨</div>}
      </div>}
      {/* Image preview */}
      {imgPreview && !result && !loading && <div style={{animation:"qb-fade .3s ease",marginTop:16}}>
        <div style={{position:"relative",borderRadius:T.radius.md,overflow:"hidden",border:"1px solid #eee",display:"inline-block"}}>
          <img src={imgPreview} style={{maxWidth:"100%",maxHeight:240,display:"block",objectFit:"contain"}} alt=""/>
          <button onClick={()=>{setImgData(null);setImgPreview(null);}} style={{position:"absolute",top:8,right:8,width:28,height:28,borderRadius:T.radius.md,background:"rgba(0,0,0,.5)",color:T.bgCard,border:"none",cursor:"pointer",fontSize:T.fs.md,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>}

      {/* Loading */}
      {loading && <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:T.sp.lg,animation:"qb-fade .3s ease"}}>
        <div style={{display:"flex",gap:6}}>{[T.google,T.purple,T.female].map((c,i)=><div key={i} style={{width:10,height:10,borderRadius:T.radius.sm,background:c,animation:`qb-pulse .8s ease ${i*.15}s infinite`}}/>)}</div>
        <div style={{fontSize:T.fs.md,fontWeight:T.fw.bold,color:T.gray700}}>{audioData?"음성을 분석하고 있어요":imgData?"이미지를 읽고 있어요":"분석 중이에요"}</div>
      </div>}

      {/* Recording — 대화형 */}
      {isListening && <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:24,animation:"qb-fade .3s ease"}}>
        <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{position:"absolute",width:170,height:170,borderRadius:"50%",background:"rgba(217,101,112,.06)",animation:"qb-mic-idle 1.4s ease-in-out infinite"}}/>
          <div style={{position:"absolute",width:136,height:136,borderRadius:"50%",background:"rgba(217,101,112,.1)",animation:"qb-mic-idle 1.4s ease-in-out infinite .3s"}}/>
          <div style={{position:"relative",zIndex:1,width:108,height:108,borderRadius:"50%",background:"linear-gradient(145deg,#d96570,#c0506b)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 8px 40px rgba(217,101,112,.5)"}}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93H2c0 4.92 3.66 9 8.44 9.44V21h3.11v-3.56C18.34 16.99 22 12.91 22 7.99h-2c0 4.08-3.05 7.44-7 7.93V15h-2v.93z"/></svg>
          </div>
        </div>
        <div style={{textAlign:"center",display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:20,fontWeight:700,color:T.text}}>잘 듣고 있을게요 🎙️</div>
          <div style={{fontSize:36,fontWeight:700,color:"#d96570",fontFamily:"monospace",letterSpacing:2}}>{Math.floor(recordSec/60)}:{String(recordSec%60).padStart(2,"0")}</div>
          <div style={{fontSize:T.fs.xs,color:T.gray400}}>말씀이 끝나면 완료를 눌러주세요</div>
        </div>
        <button onClick={stopVoice} style={{padding:"13px 48px",fontSize:T.fs.md,fontWeight:700,background:T.gray200,color:T.gray700,border:"none",borderRadius:40,cursor:"pointer"}}>완료</button>
      </div>}
      {/* Error */}
      {error && <div style={{marginTop:20,padding:"14px 16px",background:T.dangerLt,borderRadius:T.radius.lg,fontSize:T.fs.sm,color:T.danger,lineHeight:1.5,animation:"qb-fade .3s ease"}}>{error}<button onClick={reset} style={{display:"block",marginTop:8,fontSize:T.fs.sm,color:T.google,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:T.fw.bold}}>다시 시도</button></div>}

      {/* Results */}
      {result && <div style={{paddingTop:12,paddingBottom:100,animation:"qb-fade .3s ease"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>{sparkle}<span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>분석 완료</span><span style={{fontSize:T.fs.xxs,color:T.gray400,marginLeft:4}}>수정 가능</span></div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[["custName","고객명"],["custPhone","전화번호"],["date","날짜"],["time","시간"],["memo","시술/메모"],["source","예약경로"]].map(([key,label])=>
            <div key={key}><div style={{fontSize:T.fs.xxs,color:T.gray500,marginBottom:4,fontWeight:T.fw.medium}}>{label}</div>
            <input value={result[key]||""} onChange={e=>editResult(key,e.target.value)} className="qb-field"
              style={{width:"100%",padding:"11px 14px",fontSize:T.fs.md,border:"1.5px solid #e8e8e8",borderRadius:T.radius.lg,fontFamily:"inherit",color:T.text,outline:"none",background:T.bg,transition:"all .15s"}}/></div>
          )}
          <div><div style={{fontSize:T.fs.xxs,color:T.gray500,marginBottom:4,fontWeight:T.fw.medium}}>성별</div>
            <div style={{display:"flex",gap:6}}>{[["","미정"],["M","남"],["F","여"]].map(([v,l])=>
              <button key={v} onClick={()=>editResult("custGender",v)} style={{padding:"8px 20px",fontSize:T.fs.sm,fontWeight:result.custGender===v?600:400,background:result.custGender===v?"#7c7cc812":T.bg,color:result.custGender===v?T.primary:T.gray500,border:result.custGender===v?"1.5px solid #7c7cc840":"1.5px solid #eee",borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
            )}</div>
          </div>
          {(()=>{
            const tags = (data?.serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y");
            const svcs = (data?.services||[]).filter(s=>s.useYn!==false);
            const mTags = result.matchedTagIds || [], mSvcs = result.matchedServiceIds || [];
            const toggleTag = (id) => editResult("matchedTagIds", mTags.includes(id)?mTags.filter(x=>x!==id):[...mTags,id]);
            const toggleSvc = (id) => editResult("matchedServiceIds", mSvcs.includes(id)?mSvcs.filter(x=>x!==id):[...mSvcs,id]);
            if (!tags.length && !svcs.length) return null;
            return <>{tags.length>0 && <div><div style={{fontSize:T.fs.xxs,color:T.gray500,marginBottom:6,fontWeight:T.fw.medium}}>서비스</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {tags.map(t=><button key={t.id} onClick={()=>toggleTag(t.id)} style={{padding:"7px 14px",fontSize:T.fs.sm,fontWeight:mTags.includes(t.id)?600:400,background:mTags.includes(t.id)?(t.color||T.primary)+"15":T.bg,color:mTags.includes(t.id)?t.color||T.primary:T.gray400,border:mTags.includes(t.id)?`1.5px solid ${(t.color||T.primary)}40`:"1.5px solid #eee",borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit"}}>{t.name}</button>)}
            </div></div>}
            {svcs.length>0 && <div><div style={{fontSize:T.fs.xxs,color:T.gray500,marginBottom:6,fontWeight:T.fw.medium}}>시술</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {svcs.map(s=><button key={s.id} onClick={()=>toggleSvc(s.id)} style={{padding:"7px 14px",fontSize:T.fs.sm,fontWeight:mSvcs.includes(s.id)?600:400,background:mSvcs.includes(s.id)?"#7c7cc815":T.bg,color:mSvcs.includes(s.id)?T.primary:T.gray400,border:mSvcs.includes(s.id)?"1.5px solid #7c7cc840":"1.5px solid #eee",borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit"}}>{s.name}</button>)}
            </div></div>}</>;
          })()}
        </div>
        <div style={{display:"flex",gap:10,marginTop:20}}>
          <button onClick={reset} style={{flex:1,padding:"13px 0",fontSize:T.fs.sm,fontWeight:T.fw.medium,background:T.bg,color:T.textSub,border:"none",borderRadius:T.radius.lg,cursor:"pointer",fontFamily:"inherit"}}>다시</button>
          <button onClick={()=>onParsed(result)} style={{flex:2,padding:"13px 0",fontSize:T.fs.md,fontWeight:T.fw.bold,background:"linear-gradient(135deg,#4285f4,#9b72cb)",color:T.bgCard,border:"none",borderRadius:T.radius.lg,cursor:"pointer",fontFamily:"inherit"}}>예약폼에 적용</button>
        </div>
      </div>}
    </div>

  </div>;
}

export default QuickBookModal
