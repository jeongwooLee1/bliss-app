import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { fromDb, toDb, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, getDow, genId, fmtLocal, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone } from '../../lib/utils'
import I from '../common/I'



const TIMES = (() => {
  const arr = [];
  for (let h = 9; h <= 23; h++) {
    for (let m = 0; m < 60; m += 5) {
      arr.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return arr;
})();
// ─── 공통 컴포넌트 ────────────────────────────────────────────
const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={} }) => {
  const bg = variant==="primary"?T.primary:variant==="danger"?T.danger:variant==="ghost"?"transparent":T.gray100;
  const color = variant==="ghost"?T.primary:variant==="secondary"?T.text:"#fff";
  const border = variant==="ghost"?"1px solid "+T.border:"none";
  const pad = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={disabled?undefined:onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:T.radius.md,padding:pad,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",...style}}>{children}</button>;
};
function FLD({ label, children, style={} }) {
  return <div style={style}><label style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray600,marginBottom:5,display:"block"}}>{label}</label>{children}</div>;
}
const GridLayout = ({ cols=2, gap=12, children, style={} }) => {
  const tpl = typeof cols==="number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:tpl,gap,...style}}>{children}</div>;
};
function TimeSelect({ value, onChange, times }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    // 선택 항목으로 스크롤
    setTimeout(() => {
      if (listRef.current) {
        const active = listRef.current.querySelector('.active');
        if (active) active.scrollIntoView({ block: 'center' });
      }
    }, 0);
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return <span className="time-sel-wrap" ref={ref}>
    <button className="time-sel-btn" onClick={() => setOpen(o => !o)} type="button">{value}</button>
    {open && <div className="time-sel-dropdown">
      <ul ref={listRef}>
        {times.map(t => <li key={t}
          className={"time-sel-item" + (t === value ? " active" : "")}
          onMouseDown={e => { e.preventDefault(); onChange(t); setOpen(false); }}>
          {t}
        </li>)}
      </ul>
    </div>}
  </span>;
}
function DatePick({ value, onChange, style, min }) {
  const DAYS = ["일","월","화","수","목","금","토"];

  const fmt = (v) => {
    if (!v) return "--";
    const p = v.split("-");
    const d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
    const dow = d.getDay();
    const clr = dow===0?T.danger:dow===6?T.male:T.gray600;
    return <>{p[1]}.{p[2]}<span style={{color:clr,fontWeight:T.fw.medium,marginLeft:2}}>({DAYS[dow]})</span></>;
  };
  return <label style={{position:"relative",display:"inline-flex",alignItems:"center",gap:T.sp.xs,cursor:"pointer",...style}}>
    <I name="calPick" size={12} color={T.gray500}/>
    <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,whiteSpace:"nowrap",pointerEvents:"none",color:T.gray700,fontFamily:"inherit"}}>{fmt(value)}</span>
    <input type="date" value={value} onChange={e=>onChange(e.target.value)} min={min}
      style={{position:"absolute",inset:0,opacity:0,width:"100%",height:"100%",cursor:"pointer",fontSize:T.fs.lg}}/>
  </label>;
}
const STATUS_KEYS = ["confirmed","completed","cancelled","no_show"];
const DEFAULT_SOURCES = ["네이버","전화","방문","소개","인스타","카카오","기타"];

function TimelineModal({ item, onSave, onDelete, onDeleteRequest, onClose, selBranch, userBranches, data, setData, setPage, naverColShow={} }) {
  const SVC_LIST = (data?.services || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []);
  const CATS = (data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const isNew = !item?.id || item?.roomId;
  const isReadOnly = item?.readOnly || false;
  const branchId = item?.bid || selBranch;
  const branchRooms = (data.rooms||[]).filter(r=>r.branch_id===branchId);
  const branchStaff = (data.staff||[]).filter(s=>s.bid===branchId);
  const fmt = (v) => v==null?"":Number(v).toLocaleString();

  const svcAllowQty = (svcId) => {
    const s = (data?.services||[]).find(x=>x.id===svcId);
    return s?.allow_qty ?? false;
  };
  const getStatusClr = () => {
    try { const v = localStorage.getItem("tl_sc"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  };

  const [showSaleForm, setShowSaleForm] = useState(false);
  const [isSchedule, setIsSchedule] = useState(item?.isSchedule || false);
  const modalRef = useRef(null);
  const tags = (data?.serviceTags || []).slice().sort((a,b)=>a.sort-b.sort);
  const visibleTags = tags.filter(tag => tag.useYn !== false && (isSchedule ? tag.scheduleYn === "Y" : tag.scheduleYn !== "Y"));

  const BASE_DUR = 5; // 기본 예약시간 5분
  const isNaverItem = !!(item?.reservationId);
  const itemDur = item?.dur || (isNaverItem ? 60 : BASE_DUR);
  const defaultEnd = () => { const t = item?.time||"10:00"; const [h,m] = t.split(":").map(Number); const em = m + itemDur; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const addMin = (t, mins) => { const [h,m] = t.split(":").map(Number); const em = m + mins; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const [f, setF] = useState(isNew && !item?.id ? {
    id: uid(), bid: branchId, roomId: item?.roomId||branchRooms[0]?.id,
    custId: item?._prefill?.custId || null,
    custName: item?._prefill?.custName || "",
    custPhone: item?._prefill?.custPhone || "",
    custGender: item?._prefill?.custGender || "",
    staffId: branchStaff[0]?.id, serviceId: (data.services||[])[0]?.id,
    visitorName: item?.visitorName||"", visitorPhone: item?.visitorPhone||"",
    date: item?._prefill?.date || item?.date||todayStr(),
    time: item?._prefill?.time || item?.time||"10:00",
    endDate: item?._prefill?.date || item?.date||todayStr(), endTime: (() => {
      const pf = item?._prefill;
      if (pf?.matchedTagIds?.length || pf?.matchedServiceIds?.length) {
        const tagDur = (pf.matchedTagIds||[]).reduce((s,tid)=>{const t=(data?.serviceTags||[]).find(x=>x.id===tid);return s+(t?.dur||0);},0);
        const svcDur = (pf.matchedServiceIds||[]).reduce((s,sid)=>{const sv=(data?.services||[]).find(x=>x.id===sid);return s+(sv?.dur||0);},0);
        const total = tagDur + svcDur;
        if (total > 0) {
          const t = pf.time || item?.time || "10:00";
          const [h,m] = t.split(":").map(Number);
          const em = h*60+m+total;
          return `${String(Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`;
        }
      }
      return defaultEnd();
    })(),
    dur: (() => {
      const pf = item?._prefill;
      if (pf?.matchedTagIds?.length || pf?.matchedServiceIds?.length) {
        const tagDur = (pf.matchedTagIds||[]).reduce((s,tid)=>{const t=(data?.serviceTags||[]).find(x=>x.id===tid);return s+(t?.dur||0);},0);
        const svcDur = (pf.matchedServiceIds||[]).reduce((s,sid)=>{const sv=(data?.services||[]).find(x=>x.id===sid);return s+(sv?.dur||0);},0);
        if (tagDur+svcDur > 0) return tagDur+svcDur;
      }
      return pf?.dur || itemDur;
    })(), status:"confirmed",
    memo: "",
    type:"reservation",
    selectedTags: item?._prefill?.matchedTagIds || [],
    isNewCust: item?._prefill?._isNewCust !== false, tsLog: [],
    selectedServices: item?._prefill?.matchedServiceIds || [], repeat: "none", repeatUntil: "",
    source: (() => {
      const raw = item?._prefill?.source || "";
      if (!raw) return "";
      const sources = (data?.resSources||[]).filter(s=>s.useYn!==false);
      const exact = sources.find(s=>s.name===raw);
      if (exact) return exact.name;
      const map = {"WhatsApp":"와츠앱","whatsapp":"와츠앱","카카오톡":"카톡","카카오":"카톡","KakaoTalk":"카톡","Instagram":"인스타","instagram":"인스타","인스타그램":"인스타","Naver":"네이버","naver":"네이버","Google":"구글","google":"구글","Phone":"전화","phone":"전화","Walk-in":"방문","walk-in":"방문","방문":"방문"};
      const mapped = map[raw];
      if (mapped) { const m = sources.find(s=>s.name===mapped); if (m) return m.name; }
      const lower = raw.toLowerCase();
      const fuzzy = sources.find(s=>s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()));
      return fuzzy ? fuzzy.name : raw;
    })()
  } : (() => {
    const existingTs = item?.tsLog || [];
    const memoLines = (item?.memo || "").split("\n");
    const isAutoTs = l => /^\[등록:|^\[수정:/.test(l.trim()) || /^\[네이버/.test(l.trim()) || /^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(l.trim());
    const extractedTs = memoLines.filter(isAutoTs);
    const cleanMemo = memoLines.filter(l => !isAutoTs(l)).join("\n").trim();
    const mergedTs = existingTs.length > 0 ? existingTs : extractedTs;
    return {...item, memo: cleanMemo, custGender: item?.custGender || "", endDate: item?.date||todayStr(), endTime: defaultEnd(),
      selectedTags: (() => {
      let baseTags = item?.selectedTags || [];
      // 신규 예약이면 "신규" 태그 자동 포함
      if (!item?.id && !isSchedule && NEW_CUST_TAG_ID_GLOBAL && !baseTags.includes(NEW_CUST_TAG_ID_GLOBAL))
        baseTags = [...baseTags, NEW_CUST_TAG_ID_GLOBAL];
      // isPrepaid면 "예약금완료" 태그 자동 포함
      if (item?.isPrepaid && PREPAID_TAG_ID && !baseTags.includes(PREPAID_TAG_ID))
        baseTags = [...baseTags, PREPAID_TAG_ID];
      return baseTags;
    })(), isNewCust: false, tsLog: mergedTs,
      selectedServices: item?.selectedServices || [],
      repeat: item?.repeat || "none", repeatUntil: item?.repeatUntil || "",
      source: (() => {
      const raw = item?.source || "";
      if (!raw && isNaverItem) return SYSTEM_SRC_NAME_NAVER;
      if (!raw) return "";
      // 이미 resSources에 있는 이름이면 그대로 사용
      const direct = (data?.resSources||[]).find(s => s.name === raw);
      if (direct) return direct.name;
      // "naver" 같은 영문 코드 → name 매핑
      const lower = raw.toLowerCase();
      const matched = (data?.resSources||[]).find(s =>
        s.name?.toLowerCase() === lower ||
        (lower === "naver" && s.name === SYSTEM_SRC_NAME_NAVER)
      );
      return matched?.name || raw;
    })()};
  })());
  const set = (k,v) => setF(p=>({...p,[k]:v}));

  // 고객 검색
  const [custSearch, setCustSearch] = useState("");
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  const [custResults, setCustResults] = useState([]);
  // 디바운스 검색 (300ms, 2글자 이상)
  useEffect(() => {
    if (custSearch.length < 2) { setCustResults([]); return; }
    const timer = setTimeout(() => {
      const q = custSearch.toLowerCase();
      const results = (data?.customers||[]).filter(c =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q)
      ).slice(0,50);
      setCustResults(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch]);
  const selectCust = (c) => { setF(p=>({...p, custId:c.id, custName:c.name, custPhone:c.phone, custGender:c.gender, isNewCust:false})); setCustSearch(""); setShowCustDropdown(false); };

  // 태그 선택 → 기본 5분 + 태그 소요시간 합산 → 종료시간 자동 계산
  const toggleTag = (tagId) => {
    setF(p => {
      const newTags = (p.selectedTags||[]).includes(tagId) ? (p.selectedTags||[]).filter(t=>t!==tagId) : [...(p.selectedTags||[]), tagId];
      const tagSum = newTags.reduce((sum, tid) => {
        const tag = tags.find(t => t.id === tid);
        return sum + (tag?.dur || 0);
      }, 0);
      const svcSum = (p.selectedServices||[]).reduce((sum, sid) => sum + (SVC_LIST.find(s=>s.id===sid)?.dur||0), 0);
      const dur = (tagSum + svcSum) || itemDur;
      const [sh, sm] = p.time.split(":").map(Number);
      const endMin = sh * 60 + sm + dur;
      const endTime = `${String(Math.min(22, Math.floor(endMin/60))).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
      return { ...p, selectedTags: newTags, dur, endTime };
    });
  };

  // 선택된 태그 소요시간 합계
  const tagDurTotal = (f.selectedTags||[]).reduce((sum, tid) => {
    const tag = tags.find(t => t.id === tid);
    return sum + (tag?.dur || 0);
  }, 0);

  // 선택된 시술 소요시간 합계
  const svcDurTotal = (f.selectedServices||[]).reduce((sum, sid) => {
    const svc = SVC_LIST.find(s => s.id === sid);
    return sum + (svc?.dur || 0);
  }, 0);

  // 시술 선택 토글
  const toggleService = (svcId, delta=1) => {
    setF(p => {
      const svcObj = SVC_LIST.find(s=>s.id===svcId);
      const allowQty = svcAllowQty(svcObj);
      let newSvcs;
      if (allowQty) {
        // 수량 허용: delta=+1이면 추가, delta=-1이면 하나 제거
        const cur = (p.selectedServices||[]);
        if (delta < 0) {
          const idx = cur.lastIndexOf(svcId);
          newSvcs = idx>=0 ? [...cur.slice(0,idx), ...cur.slice(idx+1)] : cur;
        } else {
          newSvcs = [...cur, svcId];
        }
      } else {
        newSvcs = p.selectedServices?.includes(svcId) ? (p.selectedServices||[]).filter(s=>s!==svcId) : [...(p.selectedServices||[]), svcId];
      }
      const svcSum = newSvcs.reduce((sum, sid) => sum + (SVC_LIST.find(s=>s.id===sid)?.dur||0), 0);
      const tagSum = (p.selectedTags||[]).reduce((sum, tid) => sum + (tags.find(t=>t.id===tid)?.dur||0), 0);
      const dur = (svcSum + tagSum) || itemDur;
      const [sh, sm] = p.time.split(":").map(Number);
      const endMin = sh * 60 + sm + dur;
      const endTime = `${String(Math.min(22, Math.floor(endMin/60))).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
      return { ...p, selectedServices: newSvcs, dur, endTime };
    });
  };

  // 시술 선택 패널 열기
  const [showSvcPicker, setShowSvcPicker] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(!isNaverItem);
  const [srcOpen, setSrcOpen] = useState(!isNaverItem);
  // AI 자동분석 상태
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // 시간으로 dur 자동 계산
  const calcDur = (startT, endT) => {
    const [sh,sm] = startT.split(":").map(Number);
    const [eh,em] = endT.split(":").map(Number);
    return (eh*60+em) - (sh*60+sm);
  };

  // ── AI 자동분석: 네이버 request_msg → 시술상품 + 예약태그 자동 선택 ──
  const handleAiAnalyze = async () => {
    let apiKey = window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";
    if (!apiKey) {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/businesses?select=settings&limit=1`, {headers: sbHeaders});
        const rows = await r.json();
        const memo = JSON.parse(rows[0]?.settings || "{}");
        apiKey = memo.gemini_key || "";
        if (apiKey) { window.__geminiKey = apiKey; localStorage.setItem("bliss_gemini_key", apiKey); }
      } catch(e) {}
    }
    if (!apiKey) { alert("관리설정 → AI설정에서 Gemini API 키를 등록하세요"); return; }
    const reqText = (() => {
      if (!f.requestMsg) return "";
      if (f.requestMsg.trim().startsWith("[")) {
        try {
          return JSON.parse(f.requestMsg).map(it => `${it.label}: ${it.value}`).join("\n");
        } catch(e) {}
      }
      return f.requestMsg;
    })();
    const naverText = [reqText, f.ownerComment].filter(Boolean).join("\n");
    if (!naverText.trim()) { alert("분석할 네이버 예약정보가 없습니다"); return; }
    if (/^[\s\-\(\)대화없음]+$/.test(naverText.trim())) { alert("대화 내용이 없어 분석할 정보가 없습니다"); return; }
    setAiAnalyzing(true);
    try {
      const tagList = (data?.serviceTags||[]).filter(t=>t.useYn!==false && t.scheduleYn!=="Y")
        .map(t=>`"${t.id}":"${t.name}"`).join(", ");
      const svcList = (data?.services||[]).filter(s=>s.useYn!==false)
        .map(s=>`"${s.id}":"${s.name}"`).join(", ");
      const customRules = (() => {
        try { return JSON.parse(localStorage.getItem("bliss_ai_rules")||"[]"); } catch{ return []; }
      })();
      const customRulesBlock = customRules.length > 0
        ? `\n[추가 판단 규칙 - 아래 규칙을 기본 기준보다 우선 적용하세요]\n${customRules.map((r,i)=>`${i+1}. ${r}`).join("\n")}`
        : "";
      const NEW_CUST_TAG_ID = NEW_CUST_TAG_ID_GLOBAL;
      const custLinked = !!(f.custId) || !!(data?.customers||[]).find(c=>(c.phone||"").replace(/-/g,"") === (f.custPhone||"").replace(/-/g,""));
      const effectiveIsNew = custLinked ? false : (f.visitCount === 0);
      const prompt = `당신은 왁싱샵/미용실 예약 정보를 분석하는 AI입니다.
아래 네이버 예약 고객 정보를 분석하여 적합한 태그와 시술상품을 선택하세요.
마크다운 없이 순수 JSON만 출력하세요.

[태그 목록] ${tagList}
[시술상품 목록] ${svcList}

[기본 판단 기준]
- 주차 언급 → "주차" 태그
- 임산부/산모 → "산모님" 태그
- 커플룸 요청 → "커플룸" 태그
- 남자 관리사 요청 → "남자선생님" 태그
- 시술메뉴 내용으로 적합한 시술상품 선택
- 수량 허용 시술(이름 뒤에 [qty] 표시)은 2개 이상이면 같은 id를 반복해서 넣으세요. 예: 케어가 2개면 ["케어id","케어id"]
- "예약금완료" 태그는 선택하지 마세요. 이 태그는 시스템이 자동 처리합니다.${customRulesBlock}

[예약 기본 정보]
- 고객명: ${f.custName||"미상"}
- 연락처: ${f.custPhone||"미상"}
- 방문횟수: ${f.visitCount||0}회
- 예약일시: ${f.date||""} ${f.time||""}
- 시술상품 목록(수량허용=[qty]): ${(data?.services||[]).map(s=>svcAllowQty(s)?`${s.name}[qty](id:${s.id})`:s.name+`(id:${s.id})`).join(', ')}
- 시술메뉴(네이버): ${(f.selectedServices||[]).length > 0 ? (f.selectedServices||[]).map(id=>{const s=(data?.services||[]).find(x=>x.id===id);return s?s.name:id;}).join(", ") : "미선택"}
- customers DB 등록 여부: ${custLinked ? "등록된 고객" : "미등록"}

[고객 요청 / 업체 메모]
${naverText}

응답 형식:
{"matchedTagIds":["태그id1","태그id2"],"matchedServiceIds":["시술id1"],"gender":"F 또는 M 또는 빈문자열","reason":"선택 이유 한줄"}`;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0}})
      });
      if (!r.ok) throw new Error("API: "+(await r.text()).slice(0,120));
      const d2 = await r.json();
      const txt = d2.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = JSON.parse(txt.replace(/```json|```/g,"").trim());
      // AI 결과에서 신규 태그 제거 후 코드가 직접 판단
      let newTags = (parsed.matchedTagIds || []).filter(id => !SYSTEM_TAG_IDS.includes(id));
      if (effectiveIsNew) newTags = [...newTags, NEW_CUST_TAG_ID];
      // 예약금완료 자동 처리: isPrepaid=true이면 태그 추가 (totalPrice 무관)
      if (f.isPrepaid && !newTags.includes(PREPAID_TAG_ID)) newTags = [...newTags, PREPAID_TAG_ID];
      const newSvcs = parsed.matchedServiceIds || [];
      const aiGender = parsed.gender || "";
      setF(p => {
        const tagSum = newTags.reduce((s,tid)=>{const t=(data?.serviceTags||[]).find(x=>x.id===tid);return s+(t?.dur||0);},0);
        const svcSum = newSvcs.reduce((s,sid)=>{const sv=(data?.services||[]).find(x=>x.id===sid);return s+(sv?.dur||0);},0);
        const dur = (tagSum+svcSum) || p.dur || itemDur;
        const [sh,sm] = p.time.split(":").map(Number);
        const endMin = sh*60+sm+dur;
        const endTime = `${String(Math.min(22,Math.floor(endMin/60))).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        return {...p, selectedTags:newTags, selectedServices:newSvcs, dur, endTime, custGender: aiGender || p.custGender};
      });
      if (parsed.reason) alert(`✅ AI 분석 완료\n${parsed.reason}`);
    } catch(e) { alert("AI 분석 실패: "+e.message); }
    setAiAnalyzing(false);
  };

  const handleSaleSubmit = (saleData) => {
    const existingSale = (data.sales||[]).find(s => s.reservationId === f.id);
    if (existingSale) {
      // 기존 매출 수정
      const updated = {...saleData, id:existingSale.id, reservationId:f.id};
      setData(prev => ({ ...prev, sales: (prev?.sales||[]).map(s=>s.id===existingSale.id ? updated : s) }));
      sb.update("sales", existingSale.id, toDb("sales", updated)).catch(console.error);
    } else {
      // 신규 매출 등록
      const newSale = {...saleData, reservationId: f.id};
      if (setData) setData(prev => ({ ...prev, sales: [...prev.sales, newSale] }));
      sb.insert("sales", toDb("sales", newSale)).catch(console.error);
    }
    // 매출 등록 시 예약 상태를 "완료"로 변경
    if (f.id) {
      setData(prev => ({ ...prev, reservations: (prev?.reservations||[]).map(r => r.id === f.id ? {...r, status:"completed"} : r) }));
      sb.update("reservations", f.id, {status:"completed"}).catch(console.error);
    }
    setShowSaleForm(false);
    if (setPage) { onClose(); setPage("sales"); }
  };

  // 기존 매출 확인
  const existingSale = (data.sales||[]).find(s => s.reservationId === f.id);

  if (showSaleForm) {
    const saleReservation = existingSale
      ? {...f, saleMemo:existingSale.memo||"", _existingSale:existingSale}
      : f;
    return <DetailedSaleForm reservation={saleReservation} branchId={branchId} onSubmit={handleSaleSubmit} onClose={() => setShowSaleForm(false)} data={data} setData={setData} />;
  }

  const _isMob = window.innerWidth <= 768;
  return (
    <div
      onClick={_isMob ? undefined : onClose}
      style={_isMob ? {
        position:"fixed",inset:0,zIndex:500,background:T.bgCard,
        overflowY:"auto",WebkitOverflowScrolling:"touch",
        paddingBottom:"calc(130px + env(safe-area-inset-bottom))"
      } : {
        position:"fixed",top:0,left:0,right:0,bottom:0,
        background:"rgba(0,0,0,.35)",backdropFilter:"blur(2px)",WebkitBackdropFilter:"blur(2px)",
        zIndex:200,display:"flex",alignItems:"flex-start",justifyContent:"center",
        padding:"8px 0",overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",
        animation:"ovFadeIn .25s"
      }}
    >
      {_isMob && (
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px 8px",
          borderBottom:`1px solid ${T.border}`,background:T.bgCard,
          position:"sticky",top:0,zIndex:10}}>

          <button onClick={onClose} style={{display:"flex",alignItems:"center",gap:4,
            background:"none",border:"none",cursor:"pointer",color:T.primary,
            fontWeight:700,fontSize:15,padding:"4px 2px",fontFamily:"inherit"}}>
            <I name="chevronLeft" size={20}/> 뒤로
          </button>
        </div>
      )}
      <div ref={modalRef} className="modal-res" onClick={e=>e.stopPropagation()} style={{background:T.bgCard,
        borderRadius:_isMob ? 0 : T.radius.xl,
        border:_isMob ? "none" : `1px solid ${T.border}`,
        margin:_isMob ? 0 : "0 auto",
        animation:_isMob ? "none" : "slideUp .4s cubic-bezier(.22,1,.36,1)",
        boxShadow:_isMob ? "none" : T.shadow.lg,
        width:_isMob ? "100%" : "92%", maxWidth:680}}>
        {/* ═══ Chrome-style Tabs ═══ */}
        {!item?.id && <div style={{display:"flex",alignItems:"stretch",borderBottom:`1.5px solid ${T.gray200}`,background:T.bgCard,borderRadius:`${T.radius.xl}px ${T.radius.xl}px 0 0`,position:"relative"}}>
          {/* 예약 탭 */}
          <button className="res-tab-btn" onClick={()=>{setIsSchedule(false);setF(p=>({...p,isSchedule:false,selectedTags:[],type:"reservation"}));if(modalRef.current)modalRef.current.scrollTop=0}}
            style={{flex:1,padding:"16px 20px",fontSize:T.fs.lg,fontWeight:isSchedule?T.fw.medium:T.fw.bolder,cursor:"pointer",fontFamily:"inherit",
              border:"none",borderBottom:isSchedule?"none":`2.5px solid ${T.primary}`,marginBottom:isSchedule?0:-1.5,
              background:"transparent",color:isSchedule?T.textMuted:T.primary,letterSpacing:"-.01em"}}>
            <I name="calendar" size={13}/> 예약
          </button>
          {/* 내부일정 탭 */}
          <button className="res-tab-btn" onClick={()=>{setIsSchedule(true);setF(p=>({...p,isSchedule:true,selectedTags:[],type:"reservation"}));if(modalRef.current)modalRef.current.scrollTop=0}}
            style={{flex:1,padding:"16px 20px",fontSize:T.fs.lg,fontWeight:isSchedule?T.fw.bolder:T.fw.medium,cursor:"pointer",fontFamily:"inherit",
              border:"none",borderBottom:isSchedule?"2.5px solid #e17055":"none",marginBottom:isSchedule?-1.5:0,
              background:"transparent",color:isSchedule?T.orange:T.textMuted,letterSpacing:"-.01em"}}>
            <I name="clipboard" size={13}/> 내부일정
          </button>
          {/* 닫기 버튼 */}
          <button onClick={onClose}
            style={{position:"absolute",top:10,right:12,width:30,height:30,borderRadius:"50%",
              background:T.gray200,border:"none",color:T.gray500,cursor:"pointer",
              fontSize:T.fs.md,display:"flex",alignItems:"center",justifyContent:"center",
              transition:"background .15s,color .15s"}}
            onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger}}
            onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500}}>✕</button>
        </div>}

        <div style={{padding:"20px 24px 8px"}} className="form-col">

          {/* ═══ 네이버 예약 상태 배너 ═══ */}
          {f.status === "naver_changed" && <div style={{background:T.maleLt,borderRadius:T.radius.md,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:T.sp.sm}}>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.male}}>변경</span>
            {f.reservationId && <span style={{fontSize:T.fs.sm,color:T.gray500,marginLeft:"auto"}}>#{f.reservationId}</span>}
          </div>}
          {f.status === "naver_cancelled" && <div style={{background:T.warningLt,borderRadius:T.radius.md,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:T.sp.sm,boxShadow:"0 2px 8px rgba(230,167,0,.15)"}}>
            <span style={{fontSize:T.fs.lg}}><I name="alert" size={16} color={T.orange}/></span>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.warning}}>취소</span>
            {f.reservationId && <span style={{fontSize:T.fs.sm,color:T.gray500,marginLeft:"auto"}}>#{f.reservationId}</span>}
          </div>}
          {f.status === "pending" && !(f.memo && f.memo.includes("확정완료")) && <div style={{background:T.orangeLt,borderRadius:T.radius.md,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:T.sp.sm,flexWrap:"wrap",animation:"naverBlink 1.5s infinite",boxShadow:"0 2px 8px rgba(255,152,0,.15)"}}>
            <span style={{fontSize:T.fs.lg}}><I name="bell" size={16} color={T.orange}/></span>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>네이버 확정대기</span>
            <div style={{marginLeft:"auto",display:"flex",gap:6}}>
              {(() => {
              const br = (data.branchSettings||data.branches||[]).find(b=>b.id===branchId);
              const bizId = br?.naverBizId;
              const resId = f?.reservationId || item?.reservationId;
              const naverUrl2 = bizId ? (resId ? `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view/bookings/${resId}` : `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view`) : null;
              return naverUrl2 ? <a href={naverUrl2} target="_blank" rel="noopener noreferrer"
                onClick={e=>e.stopPropagation()}
                style={{fontSize:T.fs.sm,color:T.bgCard,fontWeight:T.fw.bolder,background:T.naver,padding:"5px 12px",borderRadius:T.radius.md,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:3}}>네이버 확정 <I name="chevR" size={11} color={T.bgCard}/></a> : null;
              })()}
            </div>
          </div>}

          {/* ═══ 내부일정 모드 ═══ */}
          {isSchedule && <>
            <div>
              <div className="fld-datetime" style={{width:"100%",gap:6}}>
                {/* 날짜 */}
                <DatePick value={f.date} onChange={v=>set("date",v)}/>
                <span style={{color:T.gray300,fontSize:T.fs.sm,padding:"0 8px",userSelect:"none"}}>|</span>
                {/* 시간 */}
                <TimeSelect value={f.time} times={TIMES.filter(t=>{const h=parseInt(t);return h>=8&&h<=21;})} onChange={nt=>{set("time",nt);set("endTime",addMin(nt,f.dur));}}/>
                <span style={{color:T.gray400,fontSize:T.fs.sm,padding:"0 8px",userSelect:"none",fontWeight:T.fw.normal}}>–</span>
                <TimeSelect value={f.endTime} times={TIMES.filter(t=>{const h=parseInt(t);return h>=8&&h<=22;})} onChange={t=>{set("endTime",t);set("dur",calcDur(f.time,t));}}/>
                <span style={{color:T.gray300,fontSize:T.fs.sm,padding:"0 8px",userSelect:"none"}}>|</span>
                {/* 지점 */}
                <I name="mapPin" size={11} color={T.gray400}/>
                <select className="res-room-sel fld-sel" style={{flex:"1 1 auto",minWidth:100}} value={`${f.roomId}|${f.staffId}`} onChange={e=>{const [r,s]=e.target.value.split("|");set("roomId",r);set("staffId",s)}}>
                  {branchRooms.map(rm => branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const rmLabel = rm.name.startsWith(brName) ? rm.name.slice(brName.length).trim() : rm.name;
                    const stLabel = st.dn && st.dn !== rm.name ? (st.dn.startsWith(brName) ? st.dn.slice(brName.length).trim() : st.dn) : "";
                    const label = [brName, rmLabel, stLabel].filter(Boolean).join(" · ");
                    return <option key={rm.id+st.id} value={`${rm.id}|${st.id}`}>{label}</option>;
                  }))}
                </select>
              </div>
            </div>
            {/* 반복 설정 */}
            <div style={{marginTop:8}}>
              <label style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.textSub,marginBottom:5,display:"block"}}>반복 설정</label>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                {[{v:"none",l:"반복 안함"},{v:"daily",l:"매일 같은시간"},{v:"weekly",l:"매주 같은요일·시간"},{v:"monthly",l:"매월 같은일·시간"}].map(o => (
                  <button key={o.v} onClick={()=>set("repeat",o.v)}
                    style={{padding:"5px 12px",fontSize:T.fs.sm,fontWeight:f.repeat===o.v?700:400,borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",
                      border:`1px solid ${f.repeat===o.v?T.orange:T.gray400}`,
                      background:f.repeat===o.v?"#e1705520":"transparent",
                      color:f.repeat===o.v?T.orange:T.gray500,transition:"all .15s"}}>{o.l}</button>
                ))}
              </div>
              {f.repeat !== "none" && <div style={{display:"flex",gap:6,alignItems:"center",marginTop:6}}>
                <span style={{fontSize:T.fs.sm,color:T.textSub}}>반복 종료일:</span>
                <DatePick value={f.repeatUntil} onChange={v=>set("repeatUntil",v)} min={f.date} style={{flex:"1 1 100px",minWidth:90}}/>
                {f.repeat === "daily" && <span style={{fontSize:T.fs.sm,color:T.orange}}>매일 {f.time}에 반복</span>}
                {f.repeat === "weekly" && <span style={{fontSize:T.fs.sm,color:T.orange}}>매주 {["일","월","화","수","목","금","토"][new Date(f.date+"T00:00").getDay()]}요일 {f.time}에 반복</span>}
                {f.repeat === "monthly" && <span style={{fontSize:T.fs.sm,color:T.orange}}>매월 {new Date(f.date+"T00:00").getDate()}일 {f.time}에 반복</span>}
              </div>}
            </div>
            <FLD label={`내부일정 항목${tagDurTotal > 0 ? ` — 소요시간: ${tagDurTotal}분` : ""}`}>
              <div style={{display:"flex",flexWrap:"wrap",gap:T.sp.xs,padding:8,background:"#fff8f6",borderRadius:T.radius.md,border:"none"}}>
                {visibleTags.length > 0 ? visibleTags.map(tag => {
                  const sel = f.selectedTags?.includes(tag.id);
                  const hasColor = tag.color && tag.color !== "";
                  const bgClr = hasColor ? tag.color : T.primary;
                  const txtClr = (() => { const h=bgClr.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard; })();
                  return <button key={tag.id} onClick={()=>toggleTag(tag.id)}
                    className="tag-pill"
                    style={{background:sel?bgClr:bgClr+"22",
                      color:sel?txtClr:bgClr,
                      border:"none",
                      fontWeight:sel?700:500}}>
                    {tag.name}
                    {tag.dur > 0 && <span style={{fontSize:T.fs.sm,opacity:0.6}}>({tag.dur}분)</span>}
                  </button>;
                }) : <span style={{fontSize:T.fs.sm,color:T.gray500,padding:8}}>태그관리에서 내부일정태그를 등록하세요</span>}
              </div>
              {(f.selectedTags||[]).length > 0 && tagDurTotal>0 && <div style={{marginTop:4,fontSize:T.fs.sm,color:T.orange,fontWeight:T.fw.bolder,textAlign:"right"}}>합산 {tagDurTotal}분</div>}
            </FLD>
          </>}

          {/* ═══ 예약 모드 ═══ */}
          {!isSchedule && <>
            {/* 고객 검색 */}
            <div>
              <div style={{position:"relative"}}>
                <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                  <span style={{position:"absolute",left:12,color:T.gray500,display:"flex",alignItems:"center",pointerEvents:"none"}}><I name="search" size={15}/></span>
                  <input className="inp inp-search" style={{flex:1,minHeight:40,borderRadius:T.radius.lg,paddingLeft:36}} value={custSearch} onChange={e=>{setCustSearch(e.target.value);setShowCustDropdown(true)}}
                    placeholder="고객명, 전화번호, 차량번호 (2글자 이상)" onFocus={()=>setShowCustDropdown(true)}/>
                </div>
                {showCustDropdown && custSearch.length >= 2 && <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,borderRadius:T.radius.md,maxHeight:220,overflow:"auto",zIndex:10,marginTop:4,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>
                  {custResults.map(c=><div key={c.id} onClick={()=>{selectCust(c);setF(p=>({...p,isNewCust:false}))}}
                    style={{padding:"8px 12px",cursor:"pointer",borderBottom:"1px solid #e0e0e030",display:"flex",gap:T.sp.sm,alignItems:"center",fontSize:T.fs.sm}}
                    onMouseOver={e=>e.currentTarget.style.background=T.gray200} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                    <span className="badge" style={{background:c.gender==="M"?T.infoLt:c.gender==="F"?T.femaleLt:T.gray200,color:c.gender==="M"?T.primary:c.gender==="F"?T.female:T.gray500,fontSize:T.fs.sm}}>{c.gender==="M"?"남":c.gender==="F"?"여":"-"}</span>
                    <span style={{fontWeight:T.fw.bold}}>{c.name}</span>
                    <span style={{color:T.textSub}}>{c.phone}</span>
                  </div>)}
                  {custResults.length===0 && <div style={{padding:"10px 12px",fontSize:T.fs.sm,color:T.gray500,textAlign:"center"}}>검색결과 없음</div>}
                  <div onClick={()=>{setF(p=>({...p,isNewCust:true,custId:null,custName:custSearch.replace(/[0-9\-]/g,"").trim(),custPhone:custSearch.replace(/[^0-9]/g,"")}));setCustSearch("");setShowCustDropdown(false)}}
                    style={{padding:"10px 12px",cursor:"pointer",display:"flex",gap:T.sp.sm,alignItems:"center",fontSize:T.fs.sm,
                      background:"#d0d0d020",borderTop:"1px solid "+T.border,color:T.danger,fontWeight:T.fw.bolder}}
                    onMouseOver={e=>e.currentTarget.style.background="#d0d0d040"} onMouseOut={e=>e.currentTarget.style.background="#d0d0d020"}>
                    <I name="plus" size={14}/> 신규고객으로 등록 {custSearch && <span style={{fontWeight:T.fw.normal,color:T.textSub}}>"{custSearch}"</span>}
                  </div>
                </div>}
              </div>
            </div>

            {/* 고객 정보 */}
            <GridLayout className="cust-row" cols="1fr 1fr 60px" gap={8}>
              <div><input className={"inp inp-cust"} value={f.custName} onChange={e=>set("custName",e.target.value)} placeholder="고객명"
                style={f.isNewCust?{borderColor:T.danger,background:T.dangerLt}:{}}/></div>
              <div><input className={"inp inp-cust"} value={f.custPhone} onChange={e=>set("custPhone",e.target.value)} placeholder="010"
                style={f.isNewCust?{borderColor:T.danger,background:T.dangerLt}:{}}/></div>
              {/* 방문자(대리예약) */}
              {(f.visitorName||f.visitorPhone||f.isProxy) && <div style={{gridColumn:"span 2",display:"flex",gap:6,alignItems:"center",padding:"4px 8px",background:"#fff8f0",borderRadius:T.radius.md,border:"1px solid #ffd0a0"}}>
                <span style={{fontSize:T.fs.nano,color:"#c07020",fontWeight:700,flexShrink:0}}>방문자</span>
                <input className="inp" value={f.visitorName||""} onChange={e=>set("visitorName",e.target.value)} placeholder="방문자명" style={{flex:1,fontSize:T.fs.xs,padding:"3px 6px"}}/>
                <input className="inp" value={f.visitorPhone||""} onChange={e=>set("visitorPhone",e.target.value)} placeholder="방문자 연락처" style={{flex:1,fontSize:T.fs.xs,padding:"3px 6px"}}/>
              </div>}
              <div>
                <div style={{display:"flex",gap:2,height:40}}>
                  <button onClick={()=>set("custGender",f.custGender==="F"?"":"F")} style={{flex:1,fontSize:T.fs.sm,fontWeight:T.fw.bold,border:"none",borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",
                    background:f.custGender==="F"?"#ffb8cb":T.gray100,color:f.custGender==="F"?"#8a0030":T.gray400,transition:"background .15s"}}>여</button>
                  <button onClick={()=>set("custGender",f.custGender==="M"?"":"M")} style={{flex:1,fontSize:T.fs.sm,fontWeight:T.fw.bold,border:"none",borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",
                    background:f.custGender==="M"?"#bfc2f0":T.gray100,color:f.custGender==="M"?"#2a2a88":T.gray400,transition:"background .15s"}}>남</button>
                </div>
              </div>
            </GridLayout>

            {/* 예약기간 + 장소/담당자 */}
            <div>
              <div className="fld-datetime" style={{width:"100%",gap:6}}>
                {/* 날짜 */}
                <DatePick value={f.date} onChange={v=>set("date",v)}/>
                <span style={{color:T.gray300,fontSize:T.fs.sm,padding:"0 8px",userSelect:"none"}}>|</span>
                {/* 시간 */}
                <select className="fld-sel" value={f.time} onChange={e=>{const nt=e.target.value;set("time",nt);set("endTime",addMin(nt,f.dur))}}>
                  {TIMES.filter(t=>{const h=parseInt(t);return h>=8&&h<=21}).map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{color:T.gray400,fontSize:T.fs.sm,userSelect:"none"}}>~</span>
                <select className="fld-sel" value={f.endTime} onChange={e=>{set("endTime",e.target.value);set("dur",calcDur(f.time,e.target.value))}}>
                  {TIMES.filter(t=>{const h=parseInt(t);return h>=8&&h<=22}).map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{color:T.gray300,fontSize:T.fs.sm,padding:"0 8px",userSelect:"none"}}>|</span>
                {/* 지점 */}
                <I name="mapPin" size={11} color={T.gray400}/>
                <select className="res-room-sel fld-sel" style={{flex:"1 1 auto",minWidth:100}} value={`${f.roomId}|${f.staffId}`} onChange={e=>{const [r,s]=e.target.value.split("|");set("roomId",r);set("staffId",s)}}>
                  {branchRooms.map(rm => branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const label = `${brName}${rm.name}${st.dn && st.dn!==rm.name ? " · "+st.dn : ""}`;
                    return <option key={rm.id+st.id} value={`${rm.id}|${st.id}`}>{label}</option>;
                  }))}
                </select>
              </div>
            </div>

            {/* 시술 상품 선택 */}
            {(() => {
              const hasGender = !!f.custGender;
              const svcPriceTotal = (f.selectedServices||[]).reduce((sum, sid) => {
                const svc = SVC_LIST.find(s=>s.id===sid);
                if (!svc) return sum;
                if (!hasGender && svc.priceF !== svc.priceM) return sum;
                return sum + (hasGender ? (f.custGender==="M"?svc.priceM:svc.priceF) : svc.priceF);
              }, 0);
              const hasGenderDep = (f.selectedServices||[]).some(sid => {const s=SVC_LIST.find(x=>x.id===sid); return s && s.priceF!==s.priceM;});
              return <div>
              <div className={"tags-acc acc-svc"}>
              <div className={"tags-acc-hdr"+(showSvcPicker?" open":"")} onClick={()=>setShowSvcPicker(!showSvcPicker)}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  시술상품
                  {(f.selectedServices||[]).length > 0
                    ? <span style={{color:T.primary,fontWeight:T.fw.bolder}}>{groupSvcNames(f.selectedServices, SVC_LIST).join(", ")} <span style={{background:"rgba(140,80,220,.12)",borderRadius:T.radius.sm,padding:"1px 6px",fontSize:T.fs.sm}}>{svcDurTotal}분{!hasGender&&hasGenderDep?"":" / "+fmt(svcPriceTotal)+"원"}</span></span>
                    : <span style={{color:T.textMuted,fontWeight:T.fw.normal}}>선택하세요</span>}
                </span>
                <span className={"tags-acc-chev"+(showSvcPicker?" open":"")}>▾</span>
              </div>
              <div className={"tags-acc-body"+(showSvcPicker?" open":"")}>
              <div style={{maxHeight:280,overflow:"auto"}}>
                {SVC_LIST.length===0 && <div style={{padding:12,fontSize:T.fs.sm,color:T.gray500,textAlign:"center"}}>시술 상품이 없습니다 (관리설정 → 시술상품관리에서 등록)</div>}
                {SVC_LIST.length>0 && SVC_LIST.map(svc=>{
                      const sel = (f.selectedServices||[]).includes(svc.id);
        const qty = (f.selectedServices||[]).filter(id=>id===svc.id).length;
        const aqty = svcAllowQty(svc);
        const genderDep = svc.priceF !== svc.priceM;
        const price = hasGender ? (f.custGender==="M"?svc.priceM:svc.priceF) : (genderDep ? null : svc.priceF);
        const disabled = hasGender && price===0;
        const catName = CATS.find(c=>c.id===svc.cat)?.name||"";
        return <div key={svc.id} onClick={()=>!disabled&&toggleService(svc.id,1)}
        style={{padding:"6px 10px",cursor:disabled?"default":"pointer",display:"flex",alignItems:"center",gap:6,
        borderBottom:"none",opacity:disabled?0.3:1,background:sel?"#7c7cc810":"transparent",borderRadius:T.radius.sm,transition:"background .1s"}}>
        {sel && !aqty && <span style={{color:T.primary,fontWeight:T.fw.bolder,fontSize:T.fs.sm,flexShrink:0}}>✓</span>}
        {catName && <span style={{fontSize:T.fs.sm,color:T.primary,background:T.primaryHover,borderRadius:T.radius.sm,padding:"1px 5px"}}>{catName}</span>}
        <span style={{flex:1,fontSize:T.fs.sm,fontWeight:sel?600:400,color:sel?T.text:T.gray600}}>{svc.name}</span>
        <span style={{fontSize:T.fs.sm,color:T.gray500}}>{svc.dur}분</span>
        <span style={{fontSize:T.fs.sm,color:price===null?T.gray400:T.danger,fontWeight:T.fw.bold,width:55,textAlign:"right"}}>{price===null?"성별 필요":price===0?"무료":price?.toLocaleString()+"원"}</span>
        {aqty && <div style={{display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
          {qty>0 && <button onClick={()=>toggleService(svc.id,-1)} style={{width:22,height:22,borderRadius:"50%",border:"1px solid "+T.border,background:T.bgCard,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:T.danger}}>−</button>}
          {qty>0 && <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary,minWidth:16,textAlign:"center"}}>{qty}</span>}
          <button onClick={()=>toggleService(svc.id,1)} style={{width:22,height:22,borderRadius:"50%",border:"1px solid "+T.border,background:qty>0?T.primary:T.bgCard,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:qty>0?T.bgCard:T.gray600}}>+</button>
        </div>}
        </div>;
                    })}
              </div>{/* maxHeight scroll */}
              </div>{/* tags-acc-body */}
              </div>{/* tags-acc */}
            </div>;
            })()}

            {/* 예약경로 아코디언 */}
            {!isSchedule && <div className="tags-acc acc-src">
              <div className={"tags-acc-hdr"+(srcOpen?" open":"")} onClick={()=>setSrcOpen(p=>!p)}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  예약경로
                  {f.source && (() => {
                    const srcItem = (data?.resSources||[]).find(s=>s.name===f.source);
                    const bg = srcItem?.color || T.primary;
                    const hex = bg.replace("#",""); const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
                    const txt = (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard;
                    return <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:txt,background:bg,borderRadius:T.radius.sm,padding:"1px 7px"}}>{f.source}</span>;
                  })()}
                </span>
                <span className={"tags-acc-chev"+(srcOpen?" open":"")}>▾</span>
              </div>
              <div className={"tags-acc-body"+(srcOpen?" open":"")}>
                <div style={{padding:"8px 12px 10px",display:"flex",flexWrap:"wrap",gap:5}}>
                  {(data?.resSources||[]).filter(s=>s.useYn!==false).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(src => {
                    const sel = f.source === src.name;
                    const clr = src.color || T.primary;
                    const isNaverSrc = src.name === "네이버" || src.name === SYSTEM_SRC_NAME_NAVER;
                    const isNaverLocked = isNaverItem && isNaverSrc;
                    const txtClr = (() => { const h=(clr).replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard; })();
                    return <button key={src.id}
                      onClick={()=>{ if(isNaverLocked) return; set("source",sel?"":src.name); }}
                      className="tag-pill"
                      style={{background:sel?clr:clr+"22",color:sel?txtClr:clr,border:"none",fontWeight:sel?700:500,cursor:isNaverLocked?"default":"pointer"}}>
                      {src.name}
                    </button>;
                  })}
                </div>
              </div>
            </div>}

            {/* 예약태그 아코디언 */}
            <div className="tags-acc acc-tag">
              <div className={"tags-acc-hdr"+(tagsOpen?" open":"")} onClick={()=>setTagsOpen(p=>!p)}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  예약태그
                  {(f.selectedTags||[]).map(tid => {
                    const tag = (data?.serviceTags||[]).find(t=>t.id===tid);
                    if (!tag) return null;
                    const bg = tag.color || T.primary;
                    const txt = (() => { const h=bg.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard; })();
                    return <span key={tid} style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,background:bg,color:txt,borderRadius:0,padding:"1px 8px"}}>{tag.name}</span>;
                  })}
                </span>
                <span className={"tags-acc-chev"+(tagsOpen?" open":"")}>▾</span>
              </div>
              <div className={"tags-acc-body"+(tagsOpen?" open":"")}>
                <div style={{padding:"8px 12px 10px",display:"flex",flexWrap:"wrap",gap:5}}>
                  {visibleTags.map(tag => {
                    const sel = f.selectedTags?.includes(tag.id);
                    const hasColor = tag.color && tag.color !== "";
                    const bgClr = hasColor ? tag.color : T.primary;
                    const txtClr = (() => { const h=bgClr.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard; })();
                    return <button key={tag.id} onClick={()=>toggleTag(tag.id)}
                      className="tag-pill"
                      style={{background:sel?bgClr:bgClr+"22",
                        color:sel?txtClr:bgClr,
                        border:"none",
                        fontWeight:sel?700:500}}>
                      {tag.name}
                      {tag.dur > 0 && <span style={{fontSize:T.fs.sm,opacity:0.75}}>{tag.dur}′</span>}
                    </button>;
                  })}
                </div>
                {(f.selectedTags||[]).length > 0 && tagDurTotal>0 && <div style={{padding:"0 12px 8px",fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bold,textAlign:"right"}}>소요 합산 {tagDurTotal}분</div>}
              </div>
            </div>


          </>}

          {/* ═══ 네이버 예약정보 (읽기전용) ═══ */}
          {isNaverItem && <div style={{background:T.successLt,borderRadius:T.radius.md,padding:"12px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
            {/* 헤더 */}
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <I name="naver" size={14}/>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.successDk}}>네이버 예약정보</span>
              {f.reservationId && <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.successDk,background:T.successLt,borderRadius:T.radius.sm,padding:"1px 6px",letterSpacing:0.5}}>#{f.reservationId}</span>}
              {!isReadOnly && (f.requestMsg || f.ownerComment) && <button
                onClick={handleAiAnalyze} disabled={aiAnalyzing}
                style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:T.sp.xs,padding:"3px 10px",fontSize:T.fs.sm,fontWeight:T.fw.bolder,
                  border:"none",borderRadius:T.radius.lg,cursor:aiAnalyzing?"not-allowed":"pointer",
                  background:aiAnalyzing?T.gray300:"linear-gradient(135deg,#7c7cc8,#9b72cb)",
                  color:aiAnalyzing?T.gray500:T.bgCard,transition:"all .2s"}}>
                {aiAnalyzing ? <><span>⏳</span> 분석중...</> : <><span>✨</span> AI 분석</>}
              </button>}
            </div>
            {/* 항목 리스트 - 통일된 row 디자인 */}
            {(()=>{
              // label+value row 컴포넌트 (인라인)
              const NRow = ({label, value, valueColor, bold, rightEl}) => value ? <div style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:1}}>{label}</span>
                <span style={{fontSize:T.fs.sm,color:valueColor||T.text,fontWeight:T.fw.normal,lineHeight:1.45,wordBreak:"break-word",flex:1}}>{value}</span>
                {rightEl && <span style={{flexShrink:0}}>{rightEl}</span>}
              </div> : null;
              const fmtDt = (v) => { const d=new Date(v); return isNaN(d)?v:`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
              return <>
                {/* 신청/확정/취소 */}
                {(f.naverRegDt || f.naverConfirmedDt || f.naverCancelledDt) && <div style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                  <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:1}}>일시</span>
                  <span style={{fontSize:T.fs.sm,flex:1,display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                    {f.naverRegDt && <span style={{color:T.textSub}}><span style={{color:T.textMuted,marginRight:3}}>신청</span>{fmtDt(f.naverRegDt)}</span>}
                    {f.naverConfirmedDt && <span style={{color:T.successDk,fontWeight:T.fw.bolder}}><span style={{fontWeight:T.fw.medium,color:T.textMuted,marginRight:3}}>확정</span>{fmtDt(f.naverConfirmedDt)}</span>}
                    {f.naverCancelledDt && <span style={{color:T.danger,fontWeight:T.fw.bolder}}><span style={{fontWeight:T.fw.medium,color:T.textMuted,marginRight:3}}>취소</span>{fmtDt(f.naverCancelledDt)}</span>}
                  </span>
                </div>}
                {/* 결제 */}
                {f.isPrepaid && (f.totalPrice||0) > 0 && <NRow label="결제금액" value={`✓ ${(f.totalPrice||0).toLocaleString()}원${f.npayMethod?" ("+f.npayMethod+")":""}`} valueColor={T.successDk}/>}
                {/* 고객 요청사항 - JSON 배열이면 그대로, 아니면 기존 파싱 */}
                {f.requestMsg && (()=>{
                  // JSON 배열 형식(새 방식)
                  if (f.requestMsg.trim().startsWith("[")) {
                    try {
                      const items = JSON.parse(f.requestMsg);
                      const _ncShow = (lbl) => {
const col = NAVER_COLS.find(c=>c.kws.some(kw=>lbl.includes(kw)));
return col ? (naverColShow[col.key] !== false) : true;
};
return items.filter(it=>it.value && _ncShow(it.label||"")).map((it,i)=>{
                        if (it.label==="시술메뉴") return <NRow key={i} label="시술메뉴" value={it.value} />;
                        return <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                          <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>{it.label}</span>
                          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.medium,color:T.successDk,lineHeight:1.45,wordBreak:"break-word",flex:1}}>{it.value}</span>
                        </div>;
                      });
                    } catch(e) {}
                  }
                  // 기존 텍스트 형식 fallback
                  const _ncShow2 = (lbl) => {
const col = NAVER_COLS.find(c=>c.kws.some(kw=>(lbl||"").includes(kw)));
return col ? (naverColShow[col.key] !== false) : true;
};
return f.requestMsg.split("\n").filter(l=>l.trim()).map((line,i)=>{
                    const ci = line.lastIndexOf(": ");
                    const key = ci > -1 ? line.slice(0,ci).trim() : null;
                    const val = ci > -1 ? line.slice(ci+2).trim() : line.trim();
                    if (!val) return null;
                    if (key==="시술메뉴") return <NRow key={i} label="시술메뉴" value={val} />;
                    if (key) return <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                      <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>{key}</span>
                      <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,color:T.text,lineHeight:1.45,wordBreak:"break-word",flex:1}}>{val}</span>
                    </div>;
                    return <NRow key={i} label="요청" value={val}/>;
                  });
                })()}
                {/* 직원 메모 */}
                {f.ownerComment && naverColShow["직원메모"] !== false && <div style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                  <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>직원메모</span>
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,color:T.text,lineHeight:1.45,wordBreak:"break-word",whiteSpace:"pre-line",flex:1}}>{f.ownerComment}</span>
                </div>}
                {/* {/* 방문/노쇼 + 바로가기 */}
                {(()=>{
                  const br = (data.branchSettings||data.branches||[]).find(b=>b.id===branchId);
                  const bizId = br?.naverBizId;
                  const resId3 = f?.reservationId;
                  const naverUrl3 = bizId ? (resId3 ? `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view/bookings/${resId3}` : `https://partner.booking.naver.com/bizes/${bizId}/booking-list-view`) : null;
                  const linkEl = naverUrl3 ? <a href={naverUrl3} target="_blank" rel="noopener noreferrer"
                    style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:T.fs.xs,color:T.naver,fontWeight:T.fw.bold,textDecoration:"none",padding:"4px 12px",background:"#03C75A10",borderRadius:T.radius.sm,border:"1px solid #03C75A30",flexShrink:0}}>
                    <I name="naver" size={10}/> 예약관리 <I name="chevR" size={9} color={T.naver}/>
                  </a> : null;
                  if (f.visitCount > 0 || f.noShowCount > 0) return <div style={{display:"flex",gap:T.sp.md,padding:"3px 0",minHeight:26,alignItems:"center"}}>
                    {f.visitCount > 0 && <span style={{display:"flex",alignItems:"baseline",gap:T.sp.sm,flex:1}}>
                      <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.medium,minWidth:52,flexShrink:0}}>방문</span>
                      <strong style={{color:T.successDk,fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>{f.visitCount}회</strong>
                    </span>}
                    {f.noShowCount > 0 && <span style={{display:"flex",alignItems:"baseline",gap:T.sp.sm,flex:1}}>
                      <span style={{fontSize:T.fs.xxs,color:T.textSub,fontWeight:T.fw.medium,minWidth:52,flexShrink:0}}>노쇼</span>
                      <strong style={{color:T.danger,fontSize:T.fs.sm,fontWeight:T.fw.bolder}}>{f.noShowCount}회</strong>
                    </span>}
                    {linkEl && <span style={{marginLeft:"auto"}}>{linkEl}</span>}
                  </div>;
                  return linkEl ? <div style={{display:"flex",justifyContent:"flex-end",paddingTop:4}}>{linkEl}</div> : null;
                })()}
              </>;
            })()}
          </div>}

          {/* 예약메모 - 직원 메모 (네이버 포함 모두 수정 가능) */}
          <div>
            <textarea className="inp inp-memo" rows={4} value={f.memo} onChange={e=>set("memo",e.target.value)} style={{resize:"vertical",minHeight:90}} placeholder="직원 메모를 입력하세요"/>
            
          </div>

          {/* Action Buttons - 한 줄 (pinned bottom) */}
        </div>
        <div style={{padding:"12px 16px",paddingBottom:_isMob?"calc(12px + env(safe-area-inset-bottom))":"calc(12px + env(safe-area-inset-bottom))",background:T.bgCard,borderTop:`1px solid ${T.border}`,borderRadius:_isMob?"0":"0 0 14px 14px",position:_isMob?"fixed":"sticky",bottom:0,left:_isMob?0:undefined,right:_isMob?0:undefined,zIndex:10}}>
            {/* 예약상태 버튼 */}
            {item?.id && !isSchedule && <div style={{display:"flex",gap:4,marginBottom:10,justifyContent:"center"}}>
              <div style={{display:"flex",gap:3,background:T.gray100,borderRadius:T.radius.lg,padding:3,width:"100%"}}>
              {STATUS_KEYS.map(k=>{const sc=getStatusClr();const sel=f.status===k;return <button key={k} onClick={()=>set("status",k)}
                style={{flex:1,padding:"6px 0",borderRadius:T.radius.md,border:"none",
                  background:sel?sc[k]:"transparent",color:sel?"#fff":T.textMuted,
                  fontSize:12,fontWeight:sel?T.fw.bolder:T.fw.medium,cursor:"pointer",fontFamily:"inherit",
                  transition:"all .15s",whiteSpace:"nowrap",boxShadow:sel?"0 1px 4px rgba(0,0,0,.12)":"none"}}>
                {STATUS_LABEL[k]}</button>})}
              </div>
            </div>}
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!isReadOnly && <><Btn
                disabled={!isSchedule && f.type==="reservation" && !f.custName?.trim()}
                style={{padding:"10px 26px",background:isSchedule?T.orange:T.primary,boxShadow:isSchedule?"0 4px 14px rgba(225,112,85,.35)":`0 4px 14px rgba(124,124,200,.35)`}}
                onClick={()=>{
                const now = new Date();
                const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
                const prevLog = f.tsLog || [];
                const newLog = !item?.id && !isSchedule
                  ? [...prevLog, `[등록: ${ts}]`]
                  : item?.id
                    ? [...prevLog, `[수정: ${ts}]`]
                    : prevLog;
                let autoTags = [...(f.selectedTags || [])];
                if (f.isPrepaid && !autoTags.includes(PREPAID_TAG_ID)) autoTags = [...autoTags, PREPAID_TAG_ID];
                if (!f.isPrepaid && autoTags.includes(PREPAID_TAG_ID)) autoTags = autoTags.filter(id => id !== PREPAID_TAG_ID);
                const memoToSave = (f.memo||"").split("\n").filter(l => { const t=l.trim(); return !(/^\[등록:|^\[수정:/.test(t)) && !(/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)); }).join("\n").trim();
                onSave({...f, memo: memoToSave, tsLog: newLog, selectedTags: autoTags});
              }}>{item?.id?"저장":"등록"}</Btn>
            {!isSchedule && f.type === "reservation" && (
              <Btn variant="outline" onClick={()=>setShowSaleForm(true)} style={{padding:"10px 18px",whiteSpace:"nowrap"}}>
                {existingSale ? <><I name="wallet" size={12}/> 매출확인</> : <><I name="wallet" size={12}/> 매출등록</>}
              </Btn>
            )}
            {item?.id && (!item?.reservationId || String(item.reservationId).startsWith("ai_")) && <button onClick={()=>onDeleteRequest?.(item)} title="삭제" style={{marginLeft:"auto",padding:"8px 10px",borderRadius:T.radius.md,border:"none",background:"transparent",color:T.danger,cursor:"pointer",display:"flex",alignItems:"center",transition:"background .15s"}} onMouseEnter={e=>e.currentTarget.style.background=T.dangerLt} onMouseLeave={e=>e.currentTarget.style.background="transparent"}><I name="trash" size={17}/></button>}</>}
            {isReadOnly && <span style={{fontSize:T.fs.sm,color:T.textSub,display:"flex",alignItems:"center",gap:T.sp.xs}}><I name="eye" size={12}/> 열람 전용 (타 지점)</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Bliss v2.69.40 - 예약목록 새로고침 버튼 추가
const SaleSvcRow = React.memo(function SaleSvcRow({ id, name, dur, checked, amount, defPrice, toggle, setAmt }) {
  const disabled = defPrice === 0;
  const [localAmt, setLocalAmt] = useState(amount || "");
  useEffect(() => { setLocalAmt(amount || ""); }, [checked]);
  return (
    <div onClick={() => !disabled && !checked && toggle(id, defPrice)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, marginBottom: 2,
        background: checked ? "#7c7cc810" : "transparent", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, transition: "background .15s" }}>
      <span onClick={e => { e.stopPropagation(); if(!disabled) toggle(id, defPrice); }}
        className="sale-svc-name" style={{ flex: 1, color: checked ? T.text : T.gray700, fontWeight: checked ? 700 : 400 }}>
        {checked && <span style={{color:T.primary,marginRight:4}}>✓</span>}{name}
      </span>
      <span className="sale-dur" style={{ flexShrink: 0, width: 34, textAlign: "center", whiteSpace:"nowrap" }}>{dur}분</span>
      <input className="inp" type="number" value={checked ? localAmt : ""} placeholder={disabled ? "—" : (defPrice||0).toLocaleString()}
        onClick={e => e.stopPropagation()}
        onChange={e => setLocalAmt(e.target.value)} onBlur={e => setAmt(id, e.target.value)} disabled={!checked}
        style={{ width: 72, padding: "4px 6px", fontSize: 13, textAlign: "right", borderRadius: 6,
          background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleProdRow = React.memo(function SaleProdRow({ id, name, price, checked, amount, toggle, setAmt }) {
  const [localAmt, setLocalAmt] = useState(amount || "");
  useEffect(() => { setLocalAmt(amount || ""); }, [checked]);
  return (
    <div onClick={() => !checked && toggle(id, price)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, marginBottom: 2,
        background: checked ? "#6bab9e10" : "transparent", cursor: "pointer", transition: "background .15s" }}>
      <span onClick={e => { e.stopPropagation(); toggle(id, price); }}
        style={{ flex: 1, fontSize: 13, color: checked ? T.text : T.gray700, fontWeight: checked ? 700 : 400 }}>
        {checked && <span style={{color:T.infoLt2,marginRight:4}}>✓</span>}{name}
      </span>
      <input className="inp" type="number" value={checked ? localAmt : ""} placeholder="0"
        onClick={e => e.stopPropagation()}
        onChange={e => setLocalAmt(e.target.value)} onBlur={e => setAmt(id, e.target.value)} disabled={!checked}
        style={{ width: 72, padding: "4px 6px", fontSize: 13, textAlign: "right", borderRadius: 6,
          background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleExtraRow = React.memo(function SaleExtraRow({ id, color, placeholder, checked, amount, label, toggle, setAmt, setLabel }) {
  const [localLabel, setLocalLabel] = useState(label || "");
  const [localAmt, setLocalAmt] = useState(amount || "");
  useEffect(() => { setLocalAmt(amount || ""); }, [checked]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", borderTop: "1px solid #e0e0e0", marginTop: 4 }}>
      <span onClick={() => toggle(id, 0)}
        style={{ fontSize: 13, color: checked ? T.danger : T.gray500, fontWeight: 700, flexShrink: 0, cursor: "pointer" }}>
        {checked ? "✓ 추가" : "+ 추가"}
      </span>
      <input className="inp" value={localLabel} onChange={e => setLocalLabel(e.target.value)}
        onBlur={e => setLabel(id, e.target.value)}
        placeholder={placeholder} style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "transparent", border:"1px solid "+T.border, borderRadius: 6 }} />
      <input className="inp" type="number" value={localAmt} placeholder="0"
        onChange={e => { setLocalAmt(e.target.value); setAmt(id, e.target.value); if(!checked && Number(e.target.value)>0) toggle(id, 0); }}
        style={{ width: 72, padding: "4px 6px", fontSize: 11, textAlign: "right", borderRadius: 6,
          border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray500, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleDiscountRow = React.memo(function SaleDiscountRow({ id, checked, amount, toggle, setAmt }) {
  const [localAmt, setLocalAmt] = useState(amount || "");
  useEffect(() => { setLocalAmt(amount || ""); }, [checked]);
  return <div onClick={() => !checked && toggle(id, 0)}
    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", cursor: "pointer", borderRadius: 6,
      background: checked ? "#e8a0a010" : "transparent", transition: "background .15s" }}>
    <span onClick={e => { e.stopPropagation(); toggle(id, 0); }}
      style={{ flex: 1, fontSize: 11, color: checked ? T.female : T.gray600, fontWeight: 600, cursor: "pointer" }}>
      {checked ? <span style={{color:T.female}}>✓ </span> : ""}할인
    </span>
    <input className="inp" type="number" value={checked ? localAmt : ""} placeholder="0"
      onClick={e => e.stopPropagation()}
      onChange={e => { setLocalAmt(e.target.value); setAmt(id, e.target.value); }} disabled={!checked}
      style={{ width: 72, padding: "4px 6px", fontSize: 11, textAlign: "right", borderRadius: 6,
        background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
        color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
  </div>;
});

// DETAILED SALE FORM (매출 입력 - 시술상품/제품 연동)
// ═══════════════════════════════════════════
function DetailedSaleForm({ reservation, branchId, onSubmit, onClose, data, setData }) {
  const SVC_LIST = (data?.services || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []);
  const CATS = (data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const branchStaff = (data.staff||[]).filter(s => s.bid === branchId);
  const [manager, setManager] = useState(reservation?.staffId || "");
  const allStaff = (data.staff||[]).filter(s => s.bid); // 전체 직원
  const [selBranch, setSelBranch] = useState(branchId);
  const [gender, setGender] = useState(reservation?.custGender || "");
  const [openCats, setOpenCats] = useState({}); // catId → true/false (null=auto)
  const toggleCat = (catId) => setOpenCats(p => ({...p, [catId]: !isCatOpen(catId, p)}));
  const isCatOpen = (catId, cats=openCats) => {
    if(cats[catId] !== undefined) return cats[catId];
    // 선택된 시술이 있는 카테고리는 자동 열림
    const svcs = (data?.services||[]).filter(s=>s.cat===catId);
    return svcs.some(s=>items[s.id]?.checked);
  };
  const [saleMemo, setSaleMemo] = useState(reservation?.saleMemo || "");

  // 결제수단 분배
  const [payMethod, setPayMethod] = useState({ svcCash:0, svcCard:0, svcTransfer:0, svcPoint:0, prodCash:0, prodCard:0, prodTransfer:0, prodPoint:0 });
  const [openPay, setOpenPay] = useState({ svcCard:false, svcCash:false, svcTransfer:false, prodCard:false, prodCash:false, prodTransfer:false });
  const [primaryPay, setPrimaryPay] = useState({ svc:null, prod:null });
  const togglePayField = (k, total, prefix) => {
    const fields = prefix === "svc" ? ["svcCard","svcCash","svcTransfer"] : ["prodCard","prodCash","prodTransfer"];
    setOpenPay(prev => {
      const next = {...prev, [k]: !prev[k]};
      if (!prev[k]) {
        // Opening: set as primary if first, or fill remainder
        const openOthers = fields.filter(f => f !== k && next[f]);
        if (openOthers.length === 0) {
          setPrimaryPay(p => ({...p, [prefix]: k}));
          setPayMethod(pm => ({...pm, [k]: total}));
        } else {
          const used = openOthers.reduce((s, f) => s + (payMethod[f]||0), 0);
          setPayMethod(pm => ({...pm, [k]: Math.max(0, total - used)}));
        }
      } else {
        // Closing: zero out and redistribute to primary
        const pri = primaryPay[prefix];
        setPayMethod(pm => {
          const n = {...pm, [k]: 0};
          if (pri && pri !== k && next[pri]) {
            const others = fields.filter(f => f !== pri && next[f]).reduce((s, f) => s + (n[f]||0), 0);
            n[pri] = Math.max(0, total - others);
          }
          return n;
        });
        if (primaryPay[prefix] === k) {
          const remaining = fields.find(f => f !== k && next[f]);
          setPrimaryPay(p => ({...p, [prefix]: remaining || null}));
        }
      }
      return next;
    });
  };
  const editPay = (k, v, total, prefix) => {
    const val = Number(v) || 0;
    const fields = prefix === "svc" ? ["svcCard","svcCash","svcTransfer"] : ["prodCard","prodCash","prodTransfer"];
    const pri = primaryPay[prefix];
    setPayMethod(prev => {
      const next = {...prev, [k]: val};
      if (pri && pri !== k && openPay[pri]) {
        const others = fields.filter(f => f !== pri).reduce((s, f) => s + (f === k ? val : (prev[f]||0)), 0);
        next[pri] = Math.max(0, total - others);
      }
      return next;
    });
  };

  // 네이버 예약 감지 (태그, 예약번호, 메모 중 하나라도 해당)
  const isNaver = !!(
    (reservation?.selectedTags||[]).some(tid => {
      const tag = (data?.serviceTags||[]).find(t=>t.id===tid);
      return tag && tag.name.includes("네이버");
    }) ||
    reservation?.reservationId ||
    (reservation?.memo && /네이버/.test(reservation.memo))
  );
  const [naverPrepaid, setNaverPrepaid] = useState(() => {
    // is_prepaid=true이면 total_price가 예약금
    if (reservation?.isPrepaid && (reservation?.totalPrice || 0) > 0) {
      return reservation.totalPrice;
    }
    // fallback: memo에 예약금 텍스트가 있는 경우 (레거시)
    if (reservation?.memo) {
      const m = reservation.memo.match(/예약금\s*:?\s*([0-9,]+)\s*원?/);
      if (m) return Number(m[1].replace(/,/g, "")) || 0;
    }
    return 0;
  });

  // 고객 상태 (예약에서 넘어오면 자동 기입, 매출관리에서 열면 검색)
  // 방문자(대리예약) 있으면 방문자로 매출 등록
  const _hasVisitor = !!(reservation?.visitorName || reservation?.visitorPhone);
  const [cust, setCust] = useState(_hasVisitor ? {
    id: null,
    name: reservation?.visitorName || "",
    phone: reservation?.visitorPhone || "",
    gender: reservation?.custGender || ""
  } : {
    id: reservation?.custId || null,
    name: reservation?.custName || "",
    phone: reservation?.custPhone || "",
    gender: reservation?.custGender || ""
  });
  const hasReservationCust = !!(reservation?.custName);

  // 고객 검색 (디바운스)
  const [custSearch, setCustSearch] = useState("");
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [custResults, setCustResults] = useState([]);
  useEffect(() => {
    if (custSearch.length < 2) { setCustResults([]); return; }
    const timer = setTimeout(() => {
      const q = custSearch.toLowerCase();
      const results = (data?.customers||[]).filter(c =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q)
      ).slice(0, 30);
      setCustResults(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch]);
  const selectCust = (c) => {
    setCust({ id: c.id, name: c.name, phone: c.phone, gender: c.gender || "" });
    setGender(c.gender || "");
    setCustSearch(""); setShowCustDrop(false);
  };

  // State: { [id]: { checked, amount } }
  const [items, setItems] = useState(() => {
    const init = {};
    const selSvcs = reservation?.selectedServices || [];
    SVC_LIST.forEach(svc => {
      const preSelected = selSvcs.includes(svc.id);
      const defPrice = gender ? ((gender==="M") ? svc.priceM : svc.priceF) : (svc.priceF===svc.priceM ? svc.priceF : 0);
      init[svc.id] = { checked: preSelected, amount: preSelected ? defPrice : 0 };
    });
    PROD_LIST.forEach(p => { init[p.id] = { checked: false, amount: 0 }; });
    init["discount"] = { checked: false, amount: 0 };
    init["extra_svc"] = { checked: false, amount: 0, label: "" };
    init["extra_prod"] = { checked: false, amount: 0, label: "" };
    return init;
  });

  const toggle = useCallback((id, defPrice) => {
    setItems(prev => {
      const cur = prev[id] || { checked: false, amount: 0 };
      const newChecked = !cur.checked;
      return { ...prev, [id]: { ...cur, checked: newChecked, amount: newChecked ? (cur.amount || defPrice || 0) : 0 } };
    });
  }, []);
  const setAmt = useCallback((id, v) => setItems(prev => ({ ...prev, [id]: { ...prev[id], amount: Number(v) || 0 } })), []);
  const setLabel = useCallback((id, v) => setItems(prev => ({ ...prev, [id]: { ...prev[id], label: v } })), []);

  // 신규고객 등록 모드
  const [newCustMode, setNewCustMode] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustGender, setNewCustGender] = useState("");
  const registerNewCust = () => {
    if (!newCustName.trim()) return;
    setCust({ id: "new_" + uid(), name: newCustName.trim(), phone: newCustPhone.trim(), gender: newCustGender });
    setGender(newCustGender);
    setNewCustMode(false); setCustSearch(""); setShowCustDrop(false);
  };

  // Totals
  const svcTotal = SVC_LIST.reduce((sum, svc) => sum + (items[svc.id]?.checked ? items[svc.id].amount : 0), 0)
    + (items.extra_svc?.checked ? items.extra_svc.amount : 0);
  const prodTotal = PROD_LIST.reduce((sum, p) => sum + (items[p.id]?.checked ? items[p.id].amount : 0), 0)
    + (items.extra_prod?.checked ? items.extra_prod.amount : 0);
  const discount = items.discount?.checked ? items.discount.amount : 0;
  const naverDeduct = isNaver ? naverPrepaid : 0;
  const grandTotal = svcTotal + prodTotal - discount - naverDeduct;
  // 실제 결제할 금액 (예약금·할인 차감)
  const svcPayTotal = Math.max(0, svcTotal - discount - naverDeduct);
  const prodPayTotal = prodTotal;

  // Count checked
  const checkedSvc = SVC_LIST.filter(s => items[s.id]?.checked).length + (items.extra_svc?.checked ? 1 : 0);
  const checkedProd = PROD_LIST.filter(p => items[p.id]?.checked).length + (items.extra_prod?.checked ? 1 : 0);

  // Auto-calc remaining for default payment
  const svcRemain = Math.max(0, svcTotal - payMethod.svcCard - payMethod.svcTransfer - payMethod.svcCash - payMethod.svcPoint);
  const prodRemain = Math.max(0, prodTotal - payMethod.prodCard - payMethod.prodTransfer - payMethod.prodCash - payMethod.prodPoint);
  // Reset payment when total changes
  const prevSvcPay = useRef(0);
  const prevProdPay = useRef(0);
  useEffect(() => {
    if (svcPayTotal !== prevSvcPay.current) {
      prevSvcPay.current = svcPayTotal;
      const pri = primaryPay.svc;
      if (pri && openPay[pri]) {
        const fields = ["svcCard","svcCash","svcTransfer"];
        setPayMethod(p => { const n={...p}; const others=fields.filter(f=>f!==pri&&openPay[f]).reduce((s,f)=>s+(n[f]||0),0); n[pri]=Math.max(0,svcPayTotal-others); return n; });
      }
    }
  }, [svcPayTotal]);
  useEffect(() => {
    if (prodPayTotal !== prevProdPay.current) {
      prevProdPay.current = prodPayTotal;
      const pri = primaryPay.prod;
      if (pri && openPay[pri]) {
        const fields = ["prodCard","prodCash","prodTransfer"];
        setPayMethod(p => { const n={...p}; const others=fields.filter(f=>f!==pri&&openPay[f]).reduce((s,f)=>s+(n[f]||0),0); n[pri]=Math.max(0,prodPayTotal-others); return n; });
      }
    }
  }, [prodPayTotal]);

  const handleSubmit = () => {
    if (grandTotal <= 0) {
      alert("매출 금액이 0원입니다. 시술 또는 제품을 선택해주세요.");
      return;
    }
    if (!manager) {
      alert("시술자를 선택해주세요.");
      return;
    }
    // 고객 이름/연락처 - 마스킹 체크만
    const custName = (cust.name||"").trim();
    const custPhone = (cust.phone||"").trim();
    if (/\*/.test(custName) || /\*/.test(custPhone)) {
      alert("고객 이름이나 연락처에 '*'가 포함되어 있습니다.\n네이버 마스킹 데이터가 아닌 실제 정보를 입력해주세요.");
      return;
    }
    const staff = (data.staff||[]).find(s => s.id === manager);
    // 고객 정보 저장 (신규 등록 또는 기존 업데이트)
    const isNewCust = cust.id?.startsWith("new_") || (!cust.id && custName);
    if (setData) {
      if (isNewCust) {
        const custId = cust.id || ("cust_" + uid());
        const newCustObj = {
          id: custId, bid: selBranch, name: custName, phone: custPhone,
          gender: gender, visits: 1, lastVisit: todayStr(), memo: "",
          custNum: String(50000 + Math.floor(Math.random() * 10000))
        };
        const alreadyExists = (data?.customers||[]).some(c => c.id === custId);
        if (!alreadyExists) {
          setData(prev => ({ ...prev, customers: [...prev.customers, newCustObj] }));
          sb.insert("customers", toDb("customers", newCustObj)).catch(console.error);
        }
        cust.id = custId;
      } else if (cust.id) {
        // 기존 고객 정보 업데이트 (이름, 연락처, 성별, 최근방문)
        const updates = { name: custName, phone: custPhone, gender: gender, lastVisit: todayStr() };
        setData(prev => ({ ...prev, customers: (prev?.customers||[]).map(c => c.id === cust.id ? {...c, ...updates, visits: (c.visits||0)+1} : c) }));
        sb.update("customers", cust.id, toDb("customers", updates)).catch(console.error);
      }
    }
    const sale = {
      id: uid(), bid: selBranch,
      custId: cust.id || null, custName: custName,
      custPhone: custPhone, custGender: gender,
      custNum: String(50000 + Math.floor(Math.random() * 10000)),
      staffId: manager, staffName: staff?.dn || "",
      date: reservation?.date || todayStr(),
      serviceId: reservation?.serviceId || null, serviceName: SVC_LIST.find(s => s.id === reservation?.serviceId)?.name || "",
      productId: null, productName: null,
      svcCash: payMethod.svcCash, svcTransfer: payMethod.svcTransfer, svcCard: payMethod.svcCard, svcPoint: payMethod.svcPoint,
      prodCash: payMethod.prodCash, prodTransfer: payMethod.prodTransfer, prodCard: payMethod.prodCard, prodPoint: payMethod.prodPoint,
      gift: 0, orderNum: String(252000 + Math.floor(Math.random() * 200)),
      memo: (isNaver && naverPrepaid > 0 ? `[네이버예약금 ${naverPrepaid.toLocaleString()}원] ` : "") + (saleMemo || ""),
      createdAt: new Date().toISOString(),
    };
    onSubmit(sale);
  };

  // Split services into 2 columns by flat sort order
  const halfSvc = Math.ceil(SVC_LIST.length / 2);
  const leftSvcs = SVC_LIST.slice(0, halfSvc);
  const rightSvcs = SVC_LIST.slice(halfSvc);
  // 카테고리별 그룹
  const catGroups = CATS.map(cat => ({
    cat,
    svcs: SVC_LIST.filter(s => s.cat === cat.id)
  })).filter(g => g.svcs.length > 0);
  const uncatSvcs = SVC_LIST.filter(s => !CATS.find(c=>c.id===s.cat));
  const halfProd = Math.ceil(PROD_LIST.length / 2);

  const _m = false; // 항상 데스크탑 모달
  return (
    <div onClick={_m?undefined:onClose} style={_m?{
        position:"fixed",inset:0,zIndex:500,background:T.bgCard,overflowY:"auto",WebkitOverflowScrolling:"touch"
      }:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.35)",backdropFilter:"blur(2px)",WebkitBackdropFilter:"blur(2px)",zIndex:200,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 16px",overflow:"auto",WebkitOverflowScrolling:"touch",animation:"ovFadeIn .25s"}}>
      {_m&&<div style={{display:"flex",alignItems:"center",padding:"10px 14px 8px",borderBottom:`1px solid ${T.border}`,background:T.bgCard,position:"sticky",top:0,zIndex:10}}>
        <button onClick={onClose} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",color:T.primary,fontWeight:700,fontSize:15,padding:"4px 2px",fontFamily:"inherit"}}>
          <I name="chevronLeft" size={20}/> 뒤로
        </button>
      </div>}
      <div onClick={e => e.stopPropagation()} className="sale-modal-wrap" style={{
        background: T.bgCard, borderRadius: _m?0:12, border:_m?"none":"1px solid "+T.border, padding: 0,
        width: _m?"100%":"92%", maxWidth: 680, margin: "0 auto",
        animation: _m?"none":"slideUp .6s cubic-bezier(.22,1,.36,1)", boxShadow: _m?"none":"0 12px 40px rgba(0,0,0,.18)"
      }}>
        {/* Header */}
        <div style={{ padding: "7px 14px", borderBottom: "1px solid #e0e0e0", display: "flex", alignItems: "center", justifyContent: "space-between", background: T.gray100, gap: 8, borderRadius: "12px 12px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: T.danger, flexShrink: 0 }}><I name="diamond" size={14}/> 매출 입력</h3>
            {cust.name ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge" style={{ background: cust.gender === "M" ? T.infoLt : cust.gender === "F" ? T.femaleLt : T.gray200, color: cust.gender === "M" ? T.primary : cust.gender === "F" ? T.female : T.gray500, fontSize: 10 }}>{cust.gender === "M" ? "남" : cust.gender === "F" ? "여" : "-"}</span>
                <strong style={{ color: T.gray700, fontSize: 13 }}>{cust.name}</strong>
                <span style={{ fontSize: 11, color:T.textSub }}>{cust.phone}</span>
                {cust.id?.startsWith("new_") && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: T.female, color: T.bgCard, fontWeight: 700 }}>신규</span>}
                {!hasReservationCust && <button onClick={() => { setCust({ id: null, name: "", phone: "", gender: "" }); setGender(""); setCustSearch(""); setNewCustMode(false); }}
                  style={{ fontSize: 10, color: T.female, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>변경</button>}
              </div>
            ) : newCustMode ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {["F","M"].map(g => <button key={g} onClick={() => setNewCustGender(prev => prev===g ? "" : g)}
                    style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (newCustGender === g ? (g === "F" ? T.female : T.primary) : T.gray400),
                      background: newCustGender === g ? (g === "F" ? "#e5737320" : "#7c7cc820") : "transparent",
                      color: newCustGender === g ? (g === "F" ? T.female : T.primary) : T.gray500
                    }}>{g === "F" ? "여" : "남"}</button>)}
                </div>
                <input className="inp" style={{ width: 90, fontSize: 11, padding: "4px 8px" }} value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="고객명" autoFocus />
                <input className="inp" style={{ width: 110, fontSize: 11, padding: "4px 8px" }} value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} placeholder="전화번호" />
                <button onClick={registerNewCust} style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, borderRadius: 5, border: "none", background:T.primary, color: T.bgCard, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>확인</button>
                <button onClick={() => setNewCustMode(false)} style={{ padding: "4px 8px", fontSize: 10, border: "none", background: "transparent", color: T.gray500, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              </div>
            ) : (
              <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
                <input className="inp" style={{ fontSize: 11, width: "100%" }} value={custSearch}
                  onChange={e => { setCustSearch(e.target.value); setShowCustDrop(true); }}
                  onFocus={() => setShowCustDrop(true)}
                  placeholder="고객 검색 (2글자 이상)" />
                {showCustDrop && custSearch.length >= 2 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: T.bgCard, border: "1px solid #d0d0d0", borderRadius: 8,
                    maxHeight: 200, overflow: "auto", zIndex: 20, marginTop: 2, boxShadow: "0 8px 20px rgba(0,0,0,.12)" }}>
                    {custResults.map(c => (
                      <div key={c.id} onClick={() => selectCust(c)}
                        style={{ padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid #e0e0e020", display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}
                        onMouseOver={e => e.currentTarget.style.background = T.gray200} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                        <span className="badge" style={{ background: c.gender === "M" ? T.infoLt : T.femaleLt, color: c.gender === "M" ? T.primary : T.female, fontSize: 9 }}>{c.gender === "M" ? "남" : "여"}</span>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ color:T.textSub }}>{c.phone}</span>
                      </div>
                    ))}
                    {custResults.length === 0 && <div style={{ padding: "10px", fontSize: 11, color: T.gray500, textAlign: "center" }}>검색결과 없음</div>}
                    <div onClick={() => { setNewCustMode(true); setShowCustDrop(false); setNewCustName(custSearch.replace(/[0-9\-]/g,"").trim()); setNewCustPhone(custSearch.replace(/[^0-9]/g,"")); }}
                      style={{ padding: "8px 10px", cursor: "pointer", borderTop: "1px solid #e0e0e0", display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color:T.primary }}
                      onMouseOver={e => e.currentTarget.style.background = "#e0edf520"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                      <I name="plus" size={14}/> 신규고객으로 등록 {custSearch && <span style={{ fontWeight: 400, color:T.textSub }}>"{custSearch}"</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="close-btn" style={{ fontSize: 18 }}><I name="x" size={16}/></button>
        </div>

        {/* Controls: Manager, Branch, Gender, Live Totals */}
        <div style={{ padding: "6px 14px", borderBottom: "1px solid #e0e0e0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: T.dangerLt }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
            <span style={{ color:T.textSub, fontWeight: 700 }}>시술자 <span style={{color:T.danger}}>*</span></span>
            <select className="inp" style={{ flex:1, minWidth:80, maxWidth:130, borderColor: manager ? T.gray400 : T.danger, background: manager ? T.bgCard : T.dangerLt }} value={manager} onChange={e => setManager(e.target.value)}>
              <option value="">시술자 선택</option>
              {(data.staff||[]).map(s => {
                const br = (data.branches||[]).find(b=>b.id===s.bid);
                return <option key={s.id} value={s.id}>{s.dn}{br&&br.id!==selBranch?` (${br.short||br.name||''})`:''}</option>;
              })}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <span style={{ color:T.textSub }}>지점</span>
            <select className="inp" style={{ flex:1, minWidth:90, maxWidth:140 }} value={selBranch} onChange={e => setSelBranch(e.target.value)}>
              {(data.branches||[]).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {/* Gender - changeable buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {["F","M"].map(g => <button key={g} onClick={() => { setGender(g); setCust(p=>({...p,gender:g})); }}
              style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: g==="F"?"6px 0 0 6px":"0 6px 6px 0", cursor: "pointer", fontFamily: "inherit", border: "none",
                background: gender === g ? (g==="F" ? "#e5737340" : "#7c7cc840") : T.gray200,
                color: gender === g ? (g==="F" ? T.female : T.info) : T.gray400 }}>{g === "F" ? "여" : "남"}</button>)}
            <span style={{ fontSize: 9, color: T.gray400, marginLeft: 2 }}>{gender ? (gender==="F"?"여성":"남성")+" 가격" : "성별 미선택"}</span>
          </div>
          {/* Totals */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color:T.textSub }}>시술 <strong style={{ color:T.primary }}>{fmt(svcTotal)}</strong> ({checkedSvc})</span>
            <span style={{ fontSize: 11, color:T.textSub }}>제품 <strong style={{ color: T.infoLt2 }}>{fmt(prodTotal)}</strong> ({checkedProd})</span>
            {discount > 0 && <span style={{ fontSize: 11, color:T.textSub }}>할인 <strong style={{ color: T.female }}>-{fmt(discount)}</strong></span>}
            {isNaver && naverPrepaid > 0 && <span style={{ fontSize: 11, color:T.textSub }}>예약금 <strong style={{ color: T.orange }}>-{fmt(naverPrepaid)}</strong></span>}
            <span style={{ fontSize: 17, fontWeight: 900, color: T.danger }}>{fmt(grandTotal)}원</span>
          </div>
        </div>

        {/* Main Body - 4 columns: svc left, svc right, prod left, prod right */}
        <GridLayout className="sale-grid" cols={2} gap={12} style={{flex:1,overflow:"auto",padding:"10px 14px",alignContent:"start"}}>

          {/* Col 1+2: Services by category (span 2 columns) */}
          <div style={{gridColumn:"span 2"}}>
            <div className="sale-section-title" style={{ color:T.primary, padding: "4px 0 3px", borderBottom: "2px solid #7c7cc830", marginBottom: 5 }}>시술 ({SVC_LIST.length})</div>
            {catGroups.map(({cat, svcs}) => {
              const isOpen = isCatOpen(cat.id);
              const hasChecked = svcs.some(s=>items[s.id]?.checked);
              return (
              <div key={cat.id} style={{marginBottom:6,border:"1px solid "+T.border,borderRadius:8,overflow:"hidden"}}>
                <div onClick={()=>toggleCat(cat.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 8px",cursor:"pointer",background:hasChecked?T.primaryHover:T.gray100}}>
                  <span className="sale-cat-hdr" style={{color:hasChecked?T.primary:T.gray600}}>{cat.name}{hasChecked&&<span style={{marginLeft:6,fontSize:T.fs.nano,color:T.primary}}>✓ {svcs.filter(s=>items[s.id]?.checked).length}개 선택</span>}</span>
                  <I name={isOpen?"chevU":"chevD"} size={12} style={{color:T.gray400}}/>
                </div>
                {isOpen && <div style={{padding:"4px 0"}}>{svcs.map(svc => { const it=items[svc.id]||{}; const dp=gender?(gender==="M"?svc.priceM:svc.priceF):(svc.priceF===svc.priceM?svc.priceF:0); return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} toggle={toggle} setAmt={setAmt} />; })}</div>}
              </div>
              );
            })}
            {uncatSvcs.length>0 && <div style={{marginBottom:8}}>
              <div style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:T.textMuted,background:T.bg,borderRadius:T.radius.sm,padding:"2px 6px",marginBottom:2,display:"inline-block"}}>기타</div>
              {uncatSvcs.map(svc => { const it=items[svc.id]||{}; const dp=gender?(gender==="M"?svc.priceM:svc.priceF):(svc.priceF===svc.priceM?svc.priceF:0); return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} toggle={toggle} setAmt={setAmt} />; })}
            </div>}
            <SaleExtraRow id="extra_svc" color={T.primary} placeholder="추가 시술명 입력" checked={!!(items.extra_svc||{}).checked} amount={(items.extra_svc||{}).amount||0} label={(items.extra_svc||{}).label||""} toggle={toggle} setAmt={setAmt} setLabel={setLabel} />
            <div style={{ marginTop: 6, padding: "4px 0", borderTop: "1px solid #e8e8e8" }}>
              <SaleDiscountRow id="discount" checked={items.discount?.checked} amount={items.discount?.amount||0} toggle={toggle} setAmt={setAmt} />
            </div>
          </div>

          {/* Col 3+4: Products - 아코디언 */}
          <div style={{gridColumn:"span 2"}}>
            <div className="sale-section-title" style={{ color: T.infoLt2, padding: "4px 0 3px", borderBottom: "2px solid #6bab9e30", marginBottom: 5 }}>제품 ({PROD_LIST.length})</div>
            <div style={{border:"1px solid "+T.border,borderRadius:8,overflow:"hidden",marginBottom:6}}>
              <div onClick={()=>setOpenCats(p=>({...p,__prod:!isCatOpen("__prod",{...p,__prod:p.__prod},"prod")}))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",cursor:"pointer",background:PROD_LIST.some(p=>items[p.id]?.checked)?T.successLt:T.gray100}}>
                <span style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:PROD_LIST.some(p=>items[p.id]?.checked)?T.successDk:T.gray600}}>
                  제품 전체{PROD_LIST.some(p=>items[p.id]?.checked)&&<span style={{marginLeft:6,fontSize:T.fs.nano,color:T.successDk}}>✓ {PROD_LIST.filter(p=>items[p.id]?.checked).length}개 선택</span>}
                </span>
                <I name={openCats.__prod===true||(openCats.__prod===undefined&&PROD_LIST.some(p=>items[p.id]?.checked))?"chevU":"chevD"} size={12} style={{color:T.gray400}}/>
              </div>
              {(openCats.__prod===true||(openCats.__prod===undefined&&PROD_LIST.some(p=>items[p.id]?.checked)))&&
                <div style={{padding:"4px 0",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 4px"}}>
                  {PROD_LIST.map(p => { const it=items[p.id]||{}; return <SaleProdRow key={p.id} id={p.id} name={p.name} price={p.price||0} checked={!!it.checked} amount={it.amount||0} toggle={toggle} setAmt={setAmt} />; })}
                </div>
              }
            </div>
            <SaleExtraRow id="extra_prod" color={T.infoLt2} placeholder="추가 제품명 입력" checked={!!(items.extra_prod||{}).checked} amount={(items.extra_prod||{}).amount||0} label={(items.extra_prod||{}).label||""} toggle={toggle} setAmt={setAmt} setLabel={setLabel} />
          </div>
        </GridLayout>

        {/* 결제 정리 */}
        <div style={{padding:"10px 12px",borderTop:"1px solid #e0e0e0",background:T.bg}}>
          {/* 금액 브레이크다운 */}
          <div style={{marginBottom:8,padding:"7px 10px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid #e8e8e8"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.gray700}}><I name="scissors" size={12}/> 시술 합계</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary}}>{fmt(svcTotal)}원</span>
            </div>
            {prodTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.gray700}}><I name="pkg" size={12}/> 제품 합계</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.infoLt2}}>{fmt(prodTotal)}원</span>
            </div>}
            {discount > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.female}}><I name="tag" size={11}/> 할인</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.female}}>-{fmt(discount)}원</span>
            </div>}
            {isNaver && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",marginTop:2}}>
              <span style={{fontSize:T.fs.sm,color:T.orange}}><I name="naver" size={11}/> 네이버 예약금</span>
              <div style={{display:"flex",alignItems:"center",gap:T.sp.xs}}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>-</span>
                <input className="inp" type="number" value={naverPrepaid||""} placeholder="0"
                  onChange={e=>setNaverPrepaid(Number(e.target.value)||0)}
                  style={{width:85,padding:"4px 8px",fontSize:T.fs.sm,textAlign:"right",fontWeight:T.fw.bolder,color:T.orange,
                    border:"2px solid #ff9800",borderRadius:T.radius.md,background:T.warningLt}} />
                <span style={{fontSize:T.fs.sm,color:T.orange,fontWeight:T.fw.bold}}>원</span>
              </div>
            </div>}
            <div style={{borderTop:"2px solid #333",marginTop:6,paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.text}}>{isNaver ? "현장 결제금액" : "총 결제금액"}</span>
              <span style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.danger}}>{fmt(grandTotal)}원</span>
            </div>
          </div>

          {/* 결제수단 분배 */}
          {grandTotal > 0 && <div className="sale-pay-row" style={{display:"flex",gap:T.sp.lg,flexWrap:"wrap"}}>
            {svcPayTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:6}}><I name="scissors" size={12}/> 시술 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(svcPayTotal)}원</span></div>
              <div style={{display:"flex",gap:T.sp.xs,flexWrap:"wrap"}}>
                {[
                  {k:"svcCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"svcCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"svcTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=><div key={k} style={{display:"flex",alignItems:"center",gap:3}}>
                  <button onClick={()=>togglePayField(k,svcPayTotal,"svc")}
                    style={{padding:"5px 10px",fontSize:T.fs.xxs,fontWeight:T.fw.bolder,borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",
                      border:openPay[k]?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:openPay[k]?bg:T.gray100,color:openPay[k]?clr:T.gray500}}>{label}</button>
                  {openPay[k] && <input className="inp" type="number" value={payMethod[k]||""} placeholder="0"
                    onChange={e=>editPay(k,e.target.value,svcPayTotal,"svc")}
                    readOnly={primaryPay.svc===k}
                    style={{width:75,padding:"4px 6px",fontSize:T.fs.sm,textAlign:"right",border:`1.5px solid ${clr}`,color:clr,fontWeight:T.fw.bolder,borderRadius:T.radius.md,
                      background:primaryPay.svc===k?T.bg:T.bgCard}}/>}
                </div>)}
              </div>
            </div>}
            {prodPayTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.infoLt2,marginBottom:6}}><I name="pkg" size={12}/> 제품 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(prodPayTotal)}원</span></div>
              <div style={{display:"flex",gap:T.sp.xs,flexWrap:"wrap"}}>
                {[
                  {k:"prodCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"prodCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"prodTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=><div key={k} style={{display:"flex",alignItems:"center",gap:3}}>
                  <button onClick={()=>togglePayField(k,prodPayTotal,"prod")}
                    style={{padding:"5px 10px",fontSize:T.fs.xxs,fontWeight:T.fw.bolder,borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",
                      border:openPay[k]?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:openPay[k]?bg:T.gray100,color:openPay[k]?clr:T.gray500}}>{label}</button>
                  {openPay[k] && <input className="inp" type="number" value={payMethod[k]||""} placeholder="0"
                    onChange={e=>editPay(k,e.target.value,prodPayTotal,"prod")}
                    readOnly={primaryPay.prod===k}
                    style={{width:75,padding:"4px 6px",fontSize:T.fs.sm,textAlign:"right",border:`1.5px solid ${clr}`,color:clr,fontWeight:T.fw.bolder,borderRadius:T.radius.md,
                      background:primaryPay.prod===k?T.bg:T.bgCard}}/>}
                </div>)}
              </div>
            </div>}
          </div>}
          {grandTotal > 0 && <div style={{fontSize:T.fs.nano,color:T.gray400,marginTop:6}}>결제수단 버튼 클릭 → 전액 입력 / 추가 수단 클릭 → 금액 입력 시 첫 수단에서 차감</div>}
        </div>

        {/* 매출 메모 */}
        <div style={{padding:"8px 16px",borderTop:"1px solid #eee"}}>
          <textarea className="inp" rows={2} value={saleMemo} onChange={e=>setSaleMemo(e.target.value)}
            placeholder="매출 관련 메모를 입력하세요" style={{resize:"vertical",width:"100%",fontSize:T.fs.sm}}/>
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid #e0e0e0", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", background: T.gray100, flexWrap: "wrap", borderRadius: "0 0 12px 12px" }}>
          <div style={{ fontSize: 10, color: T.gray400, flex: "1 1 200px" }}>
            {gender ? (gender === "F" ? "여성" : "남성") + " 가격 적용" : "성별 미선택"} · 체크한 항목만 매출 반영
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn variant="secondary" onClick={onClose}>취소</Btn>
            <Btn variant="primary" style={{ padding: "10px 20px", fontSize: 13, fontWeight: 800 }} onClick={handleSubmit}>
              <I name="wallet" size={12}/> 매출 등록 ({fmt(grandTotal)}원)
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// RESERVATION LIST
// ═══════════════════════════════════════════
function SmartDatePicker({ open, onClose, anchorEl, startDate, endDate, onApply, mode }) {
  const [selStart, setSelStart] = useState(startDate || todayStr());
  const [selEnd,   setSelEnd]   = useState(endDate   || todayStr());
  const [period,   setPeriod]   = useState("today");
  const [months,   setMonths]   = useState(() => {
    const d = new Date(startDate || todayStr());
    const d2 = new Date(d.getFullYear(), d.getMonth()+1, 1);
    return [{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}];
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pos, setPos] = useState({top:0,left:0});

  useEffect(()=>{
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  useEffect(()=>{
    if (!isMobile && anchorEl && open) {
      const r = anchorEl.getBoundingClientRect();
      setPos({top: r.bottom + 6, left: r.left});
    }
  },[open, isMobile, anchorEl]);

  const presets = mode==="res"
    ? [["today","오늘"],["7days","7일"],["month","한달"],["all","전체"],["custom","직접"]]
    : [["today","오늘"],["prev","전일"],["thismonth","이번달"],["lastmonth","지난달"],["custom","직접"]];

  const applyPreset = (key) => {
    const today = todayStr();
    const d = new Date(); const y=d.getFullYear(); const m=d.getMonth();
    let s=today, e=today;
    if (key==="today") { s=e=today; }
    else if (key==="prev") { const p=new Date(); p.setDate(p.getDate()-1); s=e=fmtLocal(p); }
    else if (key==="7days") {
      if (mode==="res") { const en=new Date(); en.setDate(en.getDate()+6); e=fmtLocal(en); }
      else { const st=new Date(); st.setDate(st.getDate()-6); s=fmtLocal(st); }
    }
    else if (key==="month") {
      if (mode==="res") { const en=new Date(); en.setDate(en.getDate()+29); e=fmtLocal(en); }
      else { const st=new Date(); st.setDate(st.getDate()-29); s=fmtLocal(st); }
    }
    else if (key==="thismonth") { s=`${y}-${String(m+1).padStart(2,"0")}-01`; e=today; }
    else if (key==="lastmonth") {
      const lm=m===0?11:m-1; const ly=m===0?y-1:y;
      s=`${ly}-${String(lm+1).padStart(2,"0")}-01`;
      e=fmtLocal(new Date(y,m,0));
    }
    else if (key==="all") { s=""; e=""; }
    setPeriod(key); setSelStart(s); setSelEnd(e);
    if (s) { const sd=new Date(s); const sd2=new Date(sd.getFullYear(),sd.getMonth()+1,1); setMonths([{y:sd.getFullYear(),m:sd.getMonth()},{y:sd2.getFullYear(),m:sd2.getMonth()}]); }
  };

  const buildCal = (y,m) => {
    const first=new Date(y,m,1).getDay(); const days=new Date(y,m+1,0).getDate();
    const cells=[];
    for(let i=0;i<first;i++) cells.push(null);
    for(let i=1;i<=days;i++) cells.push(`${y}-${String(m+1).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    return cells;
  };

  const prevM = () => { const d=new Date(months[0].y,months[0].m-1,1); const d2=new Date(months[1].y,months[1].m-1,1); setMonths([{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}]); };
  const nextM = () => { const d=new Date(months[0].y,months[0].m+1,1); const d2=new Date(months[1].y,months[1].m+1,1); setMonths([{y:d.getFullYear(),m:d.getMonth()},{y:d2.getFullYear(),m:d2.getMonth()}]); };

  const [pickingEnd, setPickingEnd] = useState(false);

  const handleDayClick = (ds) => {
    setPeriod("custom");
    if (!pickingEnd) {
      setSelStart(ds); setSelEnd(ds);
      setPickingEnd(true);
    } else {
      if (ds < selStart) { setSelStart(ds); setSelEnd(selStart); }
      else { setSelEnd(ds); }
      setPickingEnd(false);
    }
  };

  const DAYS = ["일","월","화","수","목","금","토"];

  const CalGrid = ({y,m}) => {
    const cells = buildCal(y,m);
    return <div style={{minWidth:220}}>
      <div style={{textAlign:"center",fontWeight:T.fw.bolder,fontSize:T.fs.md,color:T.text,marginBottom:8}}>{y}.{String(m+1).padStart(2,"0")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px 0",marginBottom:4}}>
        {DAYS.map((d,i)=><div key={d} style={{textAlign:"center",fontSize:T.fs.xxs,fontWeight:T.fw.bold,color:i===0?T.danger:i===6?T.male:T.gray500,padding:"4px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px 0"}}>
        {cells.map((ds,i)=>{
          if(!ds) return <div key={i}/>;
          const today=todayStr();
          const isToday=ds===today;
          const isSt=ds===selStart&&selStart;
          const isEn=ds===selEnd&&selEnd&&selEnd!==selStart;
          const inR=selStart&&selEnd&&ds>selStart&&ds<selEnd;
          const dow=new Date(ds).getDay();
          let tc=dow===0?T.danger:dow===6?T.male:T.text;
          if(isSt||isEn) tc=T.bgCard;
          return <div key={ds} style={{display:"flex",justifyContent:"center",position:"relative",
            background:inR?T.primaryHover:"transparent",
            borderRadius:isSt?"50% 0 0 50%":isEn?"0 50% 50% 0":"0"}}>
            <button onClick={()=>handleDayClick(ds)} style={{
              width:30,height:30,borderRadius:"50%",border:"none",cursor:"pointer",fontSize:T.fs.sm,fontFamily:"inherit",
              fontWeight:isToday||isSt||isEn?700:400,
              background:isSt||isEn?T.primary:isToday?T.gray200:"transparent",
              color:tc,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {parseInt(ds.slice(8))}
              {isToday&&!(isSt||isEn)&&<span style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:T.primary}}/>}
            </button>
          </div>;
        })}
      </div>
    </div>;
  };

  const doApply = () => { onApply(selStart,selEnd,period); onClose(); };

  if (!open) return null;

  // ── 데스크탑 드롭다운 ──
  if (!isMobile) {
    return <div style={{position:"fixed",inset:0,zIndex:3000}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onMouseDown={e=>e.stopPropagation()} style={{
        position:"fixed",top:pos.top,left:pos.left,
        background:T.bgCard,borderRadius:T.radius.lg,boxShadow:"0 8px 32px rgba(0,0,0,.18)",
        padding:"16px 20px 14px",zIndex:3001,minWidth:500}}>
        {/* 프리셋 버튼 */}
        <div style={{display:"flex",gap:T.sp.xs,marginBottom:14,flexWrap:"wrap"}}>
          {presets.map(([k,v])=><button key={k} onClick={()=>applyPreset(k)} style={{
            height:28,padding:"0 12px",borderRadius:T.radius.md,border:"1px solid",fontSize:T.fs.sm,cursor:"pointer",fontFamily:"inherit",
            background:period===k?T.primary:T.gray100,
            color:period===k?T.bgCard:T.gray700,
            borderColor:period===k?T.primary:T.gray300,
            fontWeight:period===k?700:400}}>{v}</button>)}
          <span style={{marginLeft:"auto",fontSize:T.fs.sm,color:T.textMuted,alignSelf:"center"}}>
            {selStart&&selEnd&&selStart!==selEnd?`${selStart} ~ ${selEnd}`:selStart||"전체"}
          </span>
        </div>
        {/* 월 네비 + 2달 캘린더 */}
        <div style={{display:"flex",alignItems:"center",gap:T.sp.sm}}>
          <button onClick={prevM} style={{width:28,height:28,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",fontSize:T.fs.lg,color:T.gray600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>‹</button>
          <div style={{display:"flex",gap:T.sp.xxl,flex:1}}>
            <CalGrid y={months[0].y} m={months[0].m}/>
            <div style={{width:1,background:T.gray200,alignSelf:"stretch"}}/>
            <CalGrid y={months[1].y} m={months[1].m}/>
          </div>
          <button onClick={nextM} style={{width:28,height:28,border:"1px solid "+T.border,borderRadius:T.radius.md,background:T.bgCard,cursor:"pointer",fontSize:T.fs.lg,color:T.gray600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>›</button>
        </div>
        {/* 하단 버튼 */}
        <div style={{display:"flex",gap:T.sp.sm,marginTop:14,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{height:32,padding:"0 16px",borderRadius:T.radius.md,border:"1px solid "+T.border,background:T.bgCard,fontSize:T.fs.sm,cursor:"pointer",color:T.gray600,fontFamily:"inherit"}}>취소</button>
          <button onClick={doApply} style={{height:32,padding:"0 20px",borderRadius:T.radius.md,border:"none",background:T.primary,fontSize:T.fs.sm,cursor:"pointer",color:T.bgCard,fontFamily:"inherit",fontWeight:T.fw.bolder}}>적용</button>
        </div>
      </div>
    </div>;
  }

  // ── 모바일 바텀시트 ──
  return <div style={{position:"fixed",inset:0,zIndex:3000,display:"flex",flexDirection:"column",justifyContent:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.45)"}} onClick={onClose}/>
    <div style={{position:"relative",background:T.bgCard,borderRadius:"16px 16px 0 0",padding:"0 0 calc(32px + 56px + env(safe-area-inset-bottom))",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}><div style={{width:36,height:4,borderRadius:T.radius.sm,background:T.gray300}}/></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 20px 14px"}}>
        <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,color:T.text}}>날짜 선택</span>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {presets.map(([k,v])=><button key={k} onClick={()=>applyPreset(k)} style={{
            height:30,padding:"0 10px",borderRadius:T.radius.md,border:"1px solid",fontSize:T.fs.sm,cursor:"pointer",fontFamily:"inherit",
            background:period===k?T.primary:T.gray100,color:period===k?T.bgCard:T.gray700,borderColor:period===k?T.primary:T.gray300}}>{v}</button>)}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",marginBottom:10}}>
        <button onClick={prevM} style={{width:32,height:32,border:"none",background:"none",cursor:"pointer",fontSize:T.fs.xxl,color:T.gray700}}>‹</button>
        <span style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder}}>{months[0].y}.{String(months[0].m+1).padStart(2,"0")}</span>
        <button onClick={nextM} style={{width:32,height:32,border:"none",background:"none",cursor:"pointer",fontSize:T.fs.xxl,color:T.gray700}}>›</button>
      </div>
      <div style={{padding:"0 16px"}}><CalGrid y={months[0].y} m={months[0].m}/></div>
      {selStart&&<div style={{padding:"14px 20px 0",textAlign:"center",color:T.textSub,fontSize:T.fs.sm}}>{selStart}{selEnd&&selEnd!==selStart?` ~ ${selEnd}`:""}</div>}
      <div style={{display:"flex",gap:10,padding:"16px 20px 0"}}>
        <button onClick={onClose} style={{flex:1,height:46,border:"1.5px solid #ddd",borderRadius:T.radius.md,background:T.bgCard,fontSize:T.fs.md,cursor:"pointer",color:T.gray700,fontFamily:"inherit"}}>취소</button>
        <button onClick={doApply} style={{flex:2,height:46,border:"none",borderRadius:T.radius.md,background:T.primary,fontSize:T.fs.md,cursor:"pointer",color:T.bgCard,fontFamily:"inherit",fontWeight:T.fw.bolder}}>적용</button>
      </div>
    </div>
  </div>;
}


export default TimelineModal
