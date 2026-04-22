import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, queueAlimtalk, buildTokenSearch } from '../../lib/sb'
import { fromDb, toDb, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS, _activeBizId } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, getDow, genId, fmtLocal, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, getCustPkgBranchInitial } from '../../lib/utils'
import I from '../common/I'
import { DetailedSaleForm } from './SaleForm'

const uid = genId;

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
  const inputRef = React.useRef(null);

  const fmt = (v) => {
    if (!v) return "--";
    const p = v.split("-");
    const d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
    const dow = d.getDay();
    const clr = dow===0?T.danger:dow===6?T.male:T.gray600;
    return <>{p[1]}.{p[2]}<span style={{color:clr,fontWeight:T.fw.medium,marginLeft:2}}>({DAYS[dow]})</span></>;
  };
  const openPicker = (e) => {
    e.preventDefault();
    const inp = inputRef.current;
    if (!inp) return;
    if (typeof inp.showPicker === 'function') {
      try { inp.showPicker(); return; } catch (err) { /* fallback */ }
    }
    inp.focus();
    inp.click();
  };
  return <label onClick={openPicker} style={{position:"relative",display:"inline-flex",alignItems:"center",gap:T.sp.xs,cursor:"pointer",...style}}>
    <I name="calPick" size={12} color={T.gray500}/>
    <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,whiteSpace:"nowrap",color:T.gray700,fontFamily:"inherit"}}>{fmt(value)}</span>
    <input ref={inputRef} type="date" value={value} onChange={e=>onChange(e.target.value)} min={min}
      style={{position:"absolute",inset:0,opacity:0,width:"100%",height:"100%",pointerEvents:"none",fontSize:T.fs.lg}}/>
  </label>;
}
const STATUS_KEYS = ["reserved","confirmed","completed","cancelled","no_show"];
const DEFAULT_SOURCES = ["네이버","전화","방문","소개","인스타","카카오","기타"];

// 클릭 → 전화번호면 tel: 링크로 바로 전화걸기, 그 외는 클립보드 복사
function CopySpan({ text, children, style={} }) {
  const [copied, setCopied] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  // 전화번호 패턴: 010/0xx 로 시작하는 숫자/하이픈 조합
  const isPhone = text && /^[\d\-+()\s]{8,}$/.test(text) && /\d{3,}/.test(text);
  const copy = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!text) return;
    // 전화번호든 일반 텍스트든 클립보드 복사 (tel: 링크는 PC에서 앱 선택창 뜨는 문제로 비활성화)
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    } catch {
      fallbackCopy(text, done);
    }
  };
  const fallbackCopy = (val, cb) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = val; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      cb && cb();
    } catch {}
  };
  return <span onClick={copy} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
    style={{...style, cursor:"pointer", position:"relative", transition:"all .15s", userSelect:"none",
      filter: hover ? "brightness(0.7)" : "none",
      fontWeight: hover ? 800 : (style.fontWeight || 400),
      opacity: copied ? 0.6 : 1, transform: copied ? "scale(0.95)" : "scale(1)"}}>
    {children}
    {copied && <span style={{position:"absolute",top:-20,left:"50%",transform:"translateX(-50%)",
      fontSize:9,fontWeight:700,color:"#fff",background:"#333",borderRadius:4,padding:"2px 6px",
      whiteSpace:"nowrap",animation:"fadeInUp .3s",zIndex:10,pointerEvents:"none"}}>복사 ❤️</span>}
  </span>;
}

function TimelineModal({ item, onSave, onDelete, onDeleteRequest, onClose, selBranch, userBranches, data, setData, setPage, naverColShow={}, setPendingChat, setPendingOpenCust }) {
  // 카테고리 순서 → 카테고리 내 시술 순서 (시술상품관리와 동일)
  const _catSort = {};
  (data?.categories || []).forEach(c => { _catSort[c.id] = c.sort ?? 9999; });
  const SVC_LIST = (data?.services || []).slice().sort((a,b) => {
    const ca = _catSort[a.cat] ?? 9999, cb = _catSort[b.cat] ?? 9999;
    return ca !== cb ? ca - cb : (a.sort??9999) - (b.sort??9999);
  });
  const PROD_LIST = (data?.products || []);
  const CATS = (data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const isNew = !item?.id || item?.roomId;
  const isReadOnly = item?.readOnly || false;
  const branchId = item?.bid || selBranch;
  const branchRooms = (data.rooms||[]).filter(r=>r.branch_id===branchId);
  const allBranchStaff = (data.staff||[]).filter(s=>s.bid===branchId);
  const branchStaff = (() => {
    let list = data.workingStaffIds
      ? allBranchStaff.filter(s => data.workingStaffIds.includes(s.id))
      : allBranchStaff;
    // 전달된 item.staffId는 지원/근무외라도 항상 포함
    if (item?.staffId && !list.some(s => s.id === item.staffId)) {
      const extra = (data.staff||[]).find(s => s.id === item.staffId)
        || { id: item.staffId, bid: branchId, dn: item.staffId, name: item.staffId, branch_id: branchId };
      list = [extra, ...list];
    }
    return list;
  })();
  const fmt = (v) => v==null?"":Number(v).toLocaleString();

  const svcAllowQty = (svcId) => {
    const s = (data?.services||[]).find(x=>x.id===svcId);
    return s?.allow_qty ?? false;
  };
  // pkg__ ID의 dur를 PKG 카테고리 시술에서 매칭
  const getSvcDur = (sid) => {
    if (typeof sid !== "string") return 0;
    if (sid.startsWith("pkg__")) {
      const pkgName = sid.replace("pkg__","").toLowerCase();
      // PKG 카테고리 시술에서 이름 유사 매칭
      const pkgSvc = SVC_LIST.find(s => {
        const sn = s.name.toLowerCase();
        return sn.includes("pkg") && pkgName.split(/\s+/).some(w => w.length > 1 && sn.includes(w));
      });
      return pkgSvc?.dur || 50; // 못 찾으면 기본 50분
    }
    return SVC_LIST.find(s=>s.id===sid)?.dur || 0;
  };
  const getStatusClr = () => {
    try { const v = localStorage.getItem("tl_sc"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  };

  const [showSaleForm, setShowSaleForm] = useState(false);
  const [isSchedule, setIsSchedule] = useState(item?.isSchedule || false);
  // 🔒 race-condition 방어: 모달 오픈 시점의 네이버 관리 필드 스냅샷.
  //   네이버 확정 이메일 처리로 서버가 status='reserved' 저장한 뒤,
  //   모달의 stale form state가 저장으로 덮어쓰는 race 방어.
  const [initialServerSnap] = useState({
    status: item?.status || "",
    naverConfirmedDt: item?.naverConfirmedDt || "",
    naverCancelledDt: item?.naverCancelledDt || "",
    naverRegDt: item?.naverRegDt || "",
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [custPopupOpen, setCustPopupOpen] = useState(false);
  const [salesHistory, setSalesHistory] = useState([]);
  const [custMemo, setCustMemo] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const modalRef = useRef(null);
  const tags = (data?.serviceTags || []).slice().sort((a,b)=>a.sort-b.sort);
  const visibleTags = tags.filter(tag => tag.useYn !== false && (isSchedule ? tag.scheduleYn === "Y" : tag.scheduleYn !== "Y"));

  const BASE_DUR = 5; // 기본 예약시간 5분
  const isNaverItem = !!(item?.reservationId) && !String(item.reservationId).startsWith("ai_") && !String(item.reservationId).startsWith("manual_");
  const itemDur = item?.dur || (isNaverItem ? 60 : BASE_DUR);
  const defaultEnd = () => { const t = item?.time||"10:00"; const [h,m] = t.split(":").map(Number); const em = m + itemDur; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const addMin = (t, mins) => { const [h,m] = t.split(":").map(Number); const em = m + mins; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const initRoomId = (item?.roomId && item.roomId.startsWith("blank_")) ? "" : (item?.roomId || branchRooms[0]?.id);
  const [f, setF] = useState(isNew && !item?.id ? {
    id: uid(), bid: branchId, roomId: initRoomId,
    custId: item?._prefill?.custId || null,
    custName: item?._prefill?.custName || "",
    custPhone: item?._prefill?.custPhone || "",
    custGender: item?._prefill?.custGender || "",
    staffId: item?.staffId || branchStaff[0]?.id, serviceId: (data.services||[])[0]?.id,
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
    })(), status:"reserved",
    memo: item?._prefill?.memo || "",
    custEmail: item?._prefill?.custEmail || "",
    externalPlatform: item?._prefill?.externalPlatform || "",
    externalPrepaid: Math.max(0, Number(item?._prefill?.externalPrepaid) || 0),
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
    return {...item,
      // 합성 roomId(st_, nv_, blank_)는 무시, staffId만 있으면 해당 지점 첫 방 할당
      roomId: (() => {
        const rid = item?.roomId;
        const isSynthetic = rid && (rid.startsWith("st_") || rid.startsWith("nv_") || rid.startsWith("blank_"));
        if (rid && !isSynthetic) return rid;
        if (item?.staffId) return branchRooms[0]?.id || "";
        return "";
      })(),
      memo: cleanMemo, custGender: item?.custGender || "", endDate: item?.date||todayStr(), endTime: defaultEnd(),
      selectedTags: (() => {
      let baseTags = item?.selectedTags || [];
      // 신규 예약이면 "신규" 태그 자동 포함
      if (!item?.id && !isSchedule && NEW_CUST_TAG_ID_GLOBAL && !baseTags.includes(NEW_CUST_TAG_ID_GLOBAL))
        baseTags = [...baseTags, NEW_CUST_TAG_ID_GLOBAL];
      // 선결제(네이버 예약금 포함)면 "예약금완료" 태그 자동 포함
      const hasPrepaid = item?.isPrepaid || (item?.externalPrepaid || 0) > 0;
      if (hasPrepaid && PREPAID_TAG_ID && !baseTags.includes(PREPAID_TAG_ID))
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

  // 외부(네이버 스크래퍼 등)가 DB status를 바꾸면 모달에도 반영
  // 사용자가 "네이버 확정" 후 네이버에서 확정 처리 → 서버가 status=confirmed로 업데이트 → 여기서 감지
  const extStatusRef = React.useRef(item?.status);
  useEffect(() => {
    if (!item?.id) return;
    const latest = (data?.reservations || []).find(r => r.id === item.id);
    if (!latest) return;
    if (latest.status !== extStatusRef.current) {
      extStatusRef.current = latest.status;
      setF(prev => prev.status === latest.status ? prev : { ...prev, status: latest.status });
    }
  }, [data?.reservations, item?.id]);

  // 모달 초기화 시 고객 DB 자동 매칭/백필 (성별·이메일이 예약 row에 없을 때 고객 레코드에서 가져옴)
  useEffect(() => {
    const bizId = _activeBizId || "biz_khvurgshb";

    // Case A: custId 있음 → 고객 레코드에서 빈 필드(성별/이메일/이름2) 백필
    if (f.custId) {
      if (f.custGender && f.custEmail && f.custName2) return; // 이미 다 채워짐
      const local = (data?.customers||[]).find(c => c.id === f.custId);
      if (local) {
        setF(p => ({
          ...p,
          custName2: p.custName2 || local.name2 || "",
          custGender: p.custGender || local.gender || "",
          custEmail: p.custEmail || local.email || "",
          isNewCust: false,
        }));
        if (local.custNum) setCustNum(local.custNum);
        return;
      }
      // 목록에 없으면 서버 조회
      sb.get("customers", `&id=eq.${f.custId}&limit=1`).then(rows => {
        if (!rows?.length) return;
        const c = fromDb("customers", rows)[0];
        if (!c) return;
        setF(p => ({
          ...p,
          custName2: p.custName2 || c.name2 || "",
          custGender: p.custGender || c.gender || "",
          custEmail: p.custEmail || c.email || "",
          isNewCust: false,
        }));
        if (c.custNum) setCustNum(c.custNum);
      }).catch(() => {});
      return;
    }

    // Case B: custId 없음 + 전화번호로 자동 매칭 시도
    if (!f.custPhone) return;
    const phone = f.custPhone.replace(/-/g, "");
    if (phone.length < 8) return;
    sb.get("customers", `&business_id=eq.${bizId}&phone=eq.${phone}&limit=1`).then(rows => {
      if (!rows?.length) return;
      const c = fromDb("customers", rows)[0];
      if (!c) return;
      setF(p => ({
        ...p,
        custId: c.id,
        custName2: p.custName2 || c.name2 || "",
        custGender: p.custGender || c.gender || "",
        custEmail: p.custEmail || c.email || "",
        isNewCust: false,
      }));
      if (c.custNum) setCustNum(c.custNum);
    }).catch(() => {});
  }, []); // 모달 최초 열릴 때 1회

  // 고객 검색
  const [custSearch, setCustSearch] = useState("");
  const [custNum, setCustNum] = useState("");
  // 쉐어 고객 로드 — 고객 정보에 🤝 배지 표시
  const [shareCusts, setShareCusts] = useState([]);
  React.useEffect(() => {
    if (!f.custId || f.custId.startsWith("new_")) { setShareCusts([]); return; }
    (async () => {
      try {
        const [asA, asB] = await Promise.all([
          sb.get("customer_shares", `&cust_id_a=eq.${f.custId}`).catch(()=>[]),
          sb.get("customer_shares", `&cust_id_b=eq.${f.custId}`).catch(()=>[]),
        ]);
        const ids = [...(asA||[]).map(r=>r.cust_id_b), ...(asB||[]).map(r=>r.cust_id_a)];
        if (!ids.length) { setShareCusts([]); return; }
        const rows = await sb.get("customers", `&id=in.(${ids.join(",")})&select=id,name,phone`);
        setShareCusts(rows||[]);
      } catch { setShareCusts([]); }
    })();
  }, [f.custId]);
  // ESC 키로 닫기 (id_dh0tp9v5ue 수정요청)
  React.useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      // input/textarea에서 IME 조합 중이면 무시
      if (e.isComposing) return;
      // 하위 모달(showSaleForm, 고객정보 뷰어 등)이 열려있으면 해당 모달이 처리하게 양보
      if (showSaleForm) return;
      onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, showSaleForm]);
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  const [custResults, setCustResults] = useState([]);
  const [editingCust, setEditingCust] = useState(false);
  const [custPkgsInfo, setCustPkgsInfo] = useState([]); // 보유권 요약 표시용
  // 고객의 보유권(다담권/다회권) 로드 — 고객이 변경되거나 custId 백필될 때마다
  useEffect(() => {
    if (!f.custId) { setCustPkgsInfo([]); return; }
    sb.get("customer_packages", `&customer_id=eq.${f.custId}`).then(rows => {
      setCustPkgsInfo(Array.isArray(rows) ? rows : []);
    }).catch(() => setCustPkgsInfo([]));
  }, [f.custId]);
  // 보유권 요약: 유효권(잔액>0/회차>0) + 소진권 모두 표시 (소진은 흐리게)
  const activePkgSummary = (() => {
    const out = [];
    const today = new Date().toISOString().slice(0,10);
    (custPkgsInfo||[]).forEach(p => {
      const n = (p.service_name||"");
      const nl = n.toLowerCase();
      const isPrepaid = n.includes("다담권") || n.includes("선불") || nl.includes("10%추가적립");
      const isAnnual  = n.includes("연간") || n.includes("할인권") || n.includes("회원권");
      // 유효기간 체크 공통
      const expM = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
      const isExp = expM && expM[1] < today;
      if (isPrepaid) {
        const m = (p.note||"").match(/잔액:([0-9,]+)/);
        const bal = m ? Number(m[1].replace(/,/g,"")) : 0;
        const label = bal > 0
          ? `🎫 ${n.split("(")[0]||"다담권"} +${bal.toLocaleString()}원`
          : `🎫 ${n.split("(")[0]||"다담권"} 소진`;
        out.push({type:"prepaid", active: bal>0 && !isExp, label});
      } else if (isAnnual) {
        out.push({type:"annual", active:!isExp, label: isExp ? `🏷 ${n.split("(")[0]||"연간권"} 만료` : `🏷 ${n.split("(")[0]||"연간권"}`});
      } else {
        const remain = (p.total_count||0) - (p.used_count||0);
        const shortName = (n.split("(")[0]||"다회권").replace(/\s*5회$/,"").trim();
        const label = remain > 0
          ? `🎟 ${shortName} +${remain}`
          : `🎟 ${shortName} 소진`;
        out.push({type:"package", active: remain>0 && !isExp, label});
      }
    });
    // 유효권만 표시
    return out.filter(p => p.active);
  })();
  // 디바운스 검색 (300ms, 2글자 이상) — DB 직접 검색
  // 다단어 AND: 모든 토큰이 어느 필드에든 포함되면 매칭 (서버 필터)
  useEffect(() => {
    if (custSearch.trim().length < 2) { setCustResults([]); return; }
    const timer = setTimeout(async () => {
      const raw = custSearch.trim();
      try {
        const bizId = _activeBizId || "biz_khvurgshb";
        // cust_num 정확매칭 우선 (전체가 숫자일 때만)
        let exactRows = [];
        if (/^\d+$/.test(raw)) {
          const ex = await sb.get("customers", `&business_id=eq.${bizId}&cust_num=eq.${raw}&limit=1`);
          exactRows = Array.isArray(ex) ? ex : [];
        }
        const cond = buildTokenSearch(raw, ["name","name2","phone","phone2","email","cust_num"]);
        const rows = await sb.get("customers", `&business_id=eq.${bizId}${cond}&limit=20`);
        const allRows = Array.isArray(rows) ? rows : [];
        const exactIds = new Set(exactRows.map(r => r.id));
        const merged = [...exactRows, ...allRows.filter(r => !exactIds.has(r.id))].slice(0, 20);
        setCustResults(fromDb("customers", merged));
      } catch(e) { console.error("custSearch err:", e); setCustResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch]);
  const selectCust = (c) => { setF(p=>({...p, custId:c.id, custName:c.name, custName2:c.name2||"", custPhone:c.phone, custGender:c.gender, custEmail:c.email||"", isNewCust:false})); setCustNum(c.custNum||""); setCustSearch(""); setShowCustDropdown(false); };

  // 태그 선택 → 기본 5분 + 태그 소요시간 합산 → 종료시간 자동 계산
  const toggleTag = (tagId) => {
    setF(p => {
      const newTags = (p.selectedTags||[]).includes(tagId) ? (p.selectedTags||[]).filter(t=>t!==tagId) : [...(p.selectedTags||[]), tagId];
      const tagSum = newTags.reduce((sum, tid) => {
        const tag = tags.find(t => t.id === tid);
        return sum + (tag?.dur || 0);
      }, 0);
      const svcSum = (p.selectedServices||[]).reduce((sum, sid) => sum + getSvcDur(sid), 0);
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
  const svcDurTotal = (f.selectedServices||[]).reduce((sum, sid) => sum + getSvcDur(sid), 0);

  // 시술 선택 토글
  const toggleService = (svcId, delta=1) => {
    setF(p => {
      const svcObj = SVC_LIST.find(s=>s.id===svcId);
      const allowQty = svcObj ? svcAllowQty(svcId) : false;
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
      const svcSum = newSvcs.reduce((sum, sid) => sum + getSvcDur(sid), 0);
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
  const [tagsOpen, setTagsOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(!isNaverItem);
  // AI 자동분석 상태
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // ── 고객 매출 히스토리 로드 ──
  const loadSalesHistory = useCallback(async (custId, custPhone, custName) => {
    setHistoryLoading(true);
    try {
      let cid = (custId && custId.length > 3) ? custId : null;
      // custId 없으면 customers 테이블에서 먼저 찾기
      if (!cid && custPhone && custPhone.length > 5) {
        try {
          const rows = await sb.get("customers", `&phone=eq.${custPhone}&limit=1`);
          if (rows?.length) cid = rows[0].id;
        } catch(e) {}
      }
      // 이름만으로 검색하면 동명이인 매칭 위험 → 제거
      if (!cid) { setSalesHistory([]); setCustMemo(""); setHistoryLoading(false); return; }
      // 고객 메모 로드
      try {
        const crows = await sb.get("customers", `&id=eq.${cid}&limit=1`);
        setCustMemo(crows?.[0]?.memo || "");
      } catch(e) { setCustMemo(""); }
      const rows = await sb.get("sales", `&cust_id=eq.${cid}&order=date.desc&limit=50`);
      setSalesHistory(Array.isArray(rows) ? rows : []);
    } catch(e) { console.error("sales history err", e); setSalesHistory([]); }
    setHistoryLoading(false);
  }, []);

  // 확장 패널 열 때 히스토리 로드
  useEffect(() => {
    if (!historyOpen) return;
    const cid = f.custId || item?.custId;
    const cphone = f.custPhone || item?.custPhone;
    const cname = f.custName || item?.custName;
    loadSalesHistory(cid, cphone, cname);
  }, [historyOpen, f.custId, item?.custId, f.custPhone, f.custName, loadSalesHistory]);

  // 시간으로 dur 자동 계산
  const calcDur = (startT, endT) => {
    const [sh,sm] = startT.split(":").map(Number);
    const [eh,em] = endT.split(":").map(Number);
    return (eh*60+em) - (sh*60+sm);
  };

  // ── AI 자동분석: 네이버 request_msg → 시술상품 + 예약태그 자동 선택 ──
  const handleAiAnalyze = async () => {
    let apiKey = window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";
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
    const naverText = [reqText, f.ownerComment, f.memo].filter(Boolean).join("\n");
    if (!naverText.trim()) { alert("분석할 예약정보/메모가 없습니다"); return; }
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
      const linkedCust = (data?.customers||[]).find(c=> (f.custId && c.id===f.custId) || (c.phone||"").replace(/-/g,"") === (f.custPhone||"").replace(/-/g,""));
      const custGender = linkedCust?.gender || "";
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
- 브라질리언왁싱에는 항문왁싱이 이미 포함됨. 브라질리언왁싱 선택 시 항문왁싱을 별도로 선택하지 마세요. 브라질리언왁싱 하나만 선택하세요.
- 수량 허용 시술(이름 뒤에 [qty] 표시)은 2개 이상이면 같은 id를 반복해서 넣으세요. 예: 케어가 2개면 ["케어id","케어id"]
- "예약금완료" 태그는 선택하지 마세요. 이 태그는 시스템이 자동 처리합니다.${customRulesBlock}

[예약 기본 정보]
- 고객명: ${f.custName||"미상"}
- 연락처: ${f.custPhone||"미상"}
- 방문횟수: ${f.visitCount||0}회
- 예약일시: ${f.date||""} ${f.time||""}
- 시술상품 목록(수량허용=[qty]): ${(data?.services||[]).map(s=>svcAllowQty(s.id)?`${s.name}[qty](id:${s.id})`:s.name+`(id:${s.id})`).join(', ')}
- "패키지/PKG/연간할인권/이용중" 키워드가 있어도 실제 시술(브라질리언 등)을 선택하세요. 패키지는 시스템이 자동 처리합니다.
- 시술메뉴(네이버): ${(f.selectedServices||[]).length > 0 ? (f.selectedServices||[]).map(id=>{const s=(data?.services||[]).find(x=>x.id===id);return s?s.name:id;}).join(", ") : "미선택"}
- customers DB 등록 여부: ${custLinked ? "등록된 고객" : "미등록"}
- 고객 성별(DB): ${custGender==="M"?"남성":custGender==="F"?"여성":"미등록 (대화내용에서 판단하세요)"}

[고객 요청 / 업체 메모]
${naverText}

응답 형식:
{"matchedTagIds":["태그id1","태그id2"],"matchedServiceIds":["시술id1"],"gender":"F 또는 M 또는 빈문자열","specialNotes":"직원이 알아야 할 특이사항 (영어요청, 알레르기 등) 또는 빈문자열","reason":"선택 이유 한줄"}`;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0}})
      });
      if (!r.ok) throw new Error("API: "+(await r.text()).slice(0,120));
      const d2 = await r.json();
      const txt = d2.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse((jsonMatch ? jsonMatch[0] : txt).replace(/```json|```/g,"").trim());
      // fuzzy fix: AI가 1-2글자 틀린 ID 반환 시 가장 유사한 valid ID로 보정
      const fuzzyFix = (ids, validSet) => ids.map(id => {
        if (validSet.has(id)) return id;
        let best = null, bestDist = 999;
        for (const vid of validSet) {
          if (vid.length !== id.length) continue;
          let dist = 0;
          for (let i = 0; i < id.length; i++) if (id[i] !== vid[i]) dist++;
          if (dist < bestDist) { best = vid; bestDist = dist; }
        }
        if (best && bestDist <= 2) { return best; }
        return id;
      });
      const validSvcSet = new Set((data?.services||[]).map(s=>s.id));
      const validTagSet = new Set((data?.serviceTags||[]).map(t=>t.id));
      // AI 결과에서 신규 태그 제거 후 코드가 직접 판단
      let newTags = fuzzyFix(parsed.matchedTagIds || [], validTagSet).filter(id => !SYSTEM_TAG_IDS.includes(id) && validTagSet.has(id));
      if (effectiveIsNew) newTags = [...newTags, NEW_CUST_TAG_ID];
      // 예약금완료 자동 처리: 선결제(네이버 또는 외부플랫폼)면 태그 추가
      const _hasPrepaid = f.isPrepaid || (f.externalPrepaid || 0) > 0;
      if (_hasPrepaid && !newTags.includes(PREPAID_TAG_ID)) newTags = [...newTags, PREPAID_TAG_ID];
      let newSvcs = fuzzyFix(parsed.matchedServiceIds || [], validSvcSet).filter(id => validSvcSet.has(id));
      // 후처리: 브라질리언왁싱 선택 시 항문왁싱 자동 제거 (브라질리언에 포함됨)
      const svcNames = newSvcs.map(sid => (data?.services||[]).find(s=>s.id===sid)?.name||"");
      const hasBrazilian = svcNames.some(n => n.includes("브라질리언"));
      if (hasBrazilian) {
        newSvcs = newSvcs.filter((sid,i) => !svcNames[i].includes("항문"));
      }
      // 패키지 고객 자동 감지: 시술옵션에 패키지 키워드 + 다회권 보유 → pkg__ 자동 추가
      const pkgKeywords = /패키지|PKG|연간할인권|이용중|패키지이용/i;
      const allText = [f.requestMsg, f.ownerComment, f.memo].join(" ");
      if (pkgKeywords.test(allText) && custPkgsInfo?.length) {
        const multiPkgs = (custPkgsInfo||[]).filter(p=>{const n=(p.service_name||"").toLowerCase();return !n.includes("다담권")&&!n.includes("선불")&&!n.includes("10%추가적립")&&!n.includes("연간")&&!n.includes("할인권")&&!n.includes("회원권")&&(p.total_count||0)-(p.used_count||0)>0;});
        if (multiPkgs.length > 0) {
          const groups={};multiPkgs.forEach(p=>{const nm=(p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();if(!groups[nm])groups[nm]=true;});
          const firstPkgName = Object.keys(groups)[0];
          if (firstPkgName && !newSvcs.some(id=>typeof id==="string" && id.startsWith("pkg__"))) {
            newSvcs.unshift("pkg__"+firstPkgName);
          }
        }
      }
      const aiGender = parsed.gender || "";
      const specialNotes = parsed.specialNotes || "";
      setF(p => {
        const tagSum = newTags.reduce((s,tid)=>{const t=(data?.serviceTags||[]).find(x=>x.id===tid);return s+(t?.dur||0);},0);
        const svcSum = newSvcs.reduce((s,sid)=>s+getSvcDur(sid),0);
        const dur = (tagSum+svcSum) || p.dur || itemDur;
        const [sh,sm] = p.time.split(":").map(Number);
        const endMin = sh*60+sm+dur;
        const endTime = `${String(Math.min(22,Math.floor(endMin/60))).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
        // 기존 고객(custId 있음)이면 DB 성별 유지, AI 판단 무시
        const updates = {selectedTags:newTags, selectedServices:newSvcs, dur, endTime, custGender: p.custId ? (p.custGender || aiGender) : (aiGender || p.custGender)};
        if (specialNotes) {
          const cur = p.memo || "";
          if (!cur.includes(specialNotes)) updates.memo = cur ? cur+"\n[AI] "+specialNotes : "[AI] "+specialNotes;
        }
        return {...p, ...updates};
      });
    } catch(e) { alert("AI 분석 실패: " + e.message); }
    setAiAnalyzing(false);
  };

  const handleSaleSubmit = (saleData) => {
    const existingSale = (data.sales||[]).find(s => s.reservationId === f.id);
    // 편집 모드면 SaleForm이 이미 DB 업데이트 완료 (_editOnly). 신규 모드에서 _alreadySaved면 SaleForm이 이미 sales INSERT 완료.
    const alreadySaved = saleData?._alreadySaved || saleData?._editOnly;
    // 내부 플래그 제거
    const clean = {...saleData}; delete clean._alreadySaved; delete clean._editOnly; delete clean._continueAfter; delete clean._updatedSale; delete clean._newDetails;
    if (existingSale) {
      const updated = {...clean, id:existingSale.id, reservationId:f.id};
      setData(prev => ({ ...prev, sales: (prev?.sales||[]).map(s=>s.id===existingSale.id ? updated : s) }));
      if (!alreadySaved) sb.update("sales", existingSale.id, toDb("sales", updated)).catch(console.error);
    } else {
      const newSale = {...clean, reservationId: f.id};
      if (setData) setData(prev => ({ ...prev, sales: [...prev.sales, newSale] }));
      if (!alreadySaved) sb.insert("sales", toDb("sales", newSale)).catch(console.error);
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

  // 매출 등록이 "오늘" 되었는지 판정 (created_at 기반)
  const saleIsTodayReg = useMemo(() => {
    if (!existingSale) return false;
    const ca = existingSale.created_at || existingSale.createdAt;
    if (!ca) return false;
    try {
      const d = new Date(ca);
      const kst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60 * 1000);
      return kst.toISOString().slice(0, 10) === todayStr();
    } catch { return false; }
  }, [existingSale]);

  // 매출 취소 — 당일 등록분만 가능. 연관 트랜잭션 전부 롤백.
  const handleCancelSale = async () => {
    if (!existingSale?.id) return;
    if (!saleIsTodayReg) { alert("매출 등록 후 하루가 지나 취소할 수 없습니다. 매출관리에서 수정하세요."); return; }
    const ok = confirm(
      "매출을 취소하시겠습니까?\n\n" +
      "⚠️ 다음 항목이 자동 롤백됩니다:\n" +
      "• 패키지/다담권 차감 복구\n" +
      "• 포인트 적립/사용 해제\n" +
      "• 발행된 쿠폰 삭제\n" +
      "• 예약 상태: 완료 → 확정"
    );
    if (!ok) return;
    const saleId = existingSale.id;
    try {
      // 1. package_transactions 롤백: customer_packages.used_count 복구 + tx 삭제
      const pkgTxs = await sb.get("package_transactions", `&sale_id=eq.${saleId}`);
      for (const tx of (pkgTxs || [])) {
        if (tx.package_id && tx.type === 'deduct' && tx.amount > 0) {
          // customer_packages 현재 값 읽어서 정확히 복구
          const pkgRows = await sb.get("customer_packages", tx.package_id);
          const pkg = Array.isArray(pkgRows) ? pkgRows[0] : pkgRows;
          if (pkg && pkg.id) {
            const newUsed = Math.max(0, (pkg.used_count || 0) - tx.amount);
            const upd = { used_count: newUsed };
            // 다담권 잔액 note 업데이트
            if (tx.unit === 'won' && pkg.note) {
              const totalFace = pkg.total_count || 0;
              const newBal = totalFace - newUsed;
              upd.note = pkg.note.replace(/잔액:[0-9,]+/, `잔액:${Math.max(0, newBal).toLocaleString()}`);
            }
            await sb.update("customer_packages", pkg.id, upd);
          }
        }
        await sb.del("package_transactions", tx.id);
      }
      // 2. point_transactions 삭제
      await sb.delWhere("point_transactions", "sale_id", saleId);
      // 3. 발행된 쿠폰(customer_packages note에 '매출{saleId}' 포함) 삭제
      const coupons = await sb.get("customer_packages", `&note=ilike.*${encodeURIComponent('매출'+saleId)}*`);
      for (const c of (coupons || [])) { await sb.del("customer_packages", c.id); }
      // 4. sale_details 삭제
      await sb.delWhere("sale_details", "sale_id", saleId);
      // 5. sales 삭제
      await sb.del("sales", saleId);
      // 6. 예약 status 복구
      if (f.id) {
        await sb.update("reservations", f.id, { status: "confirmed" });
      }
      // local state 업데이트
      setData(prev => ({
        ...prev,
        sales: (prev?.sales || []).filter(s => s.id !== saleId),
        reservations: (prev?.reservations || []).map(r => r.id === f.id ? { ...r, status: "confirmed" } : r),
      }));
      alert("매출 취소 완료");
      onClose();
    } catch (e) {
      console.error("[cancelSale]", e);
      alert("매출 취소 실패: " + (e?.message || e));
    }
  };

  // ⚠️ 모든 hook은 조건부 early return 이전에 호출되어야 함 (React Rules of Hooks)
  const _overlayDownRef = React.useRef(false);

  if (showSaleForm) {
    const saleReservation = existingSale
      ? {...f, ...existingSale, saleMemo:existingSale.memo||"", _existingSale:existingSale}
      : f;
    // 기존 매출 있으면 읽기전용 모드 — 중복 INSERT 방지 + 수정 차단 (수정은 매출관리에서만)
    return <DetailedSaleForm reservation={saleReservation} branchId={branchId} onSubmit={handleSaleSubmit} onClose={() => setShowSaleForm(false)} data={data} setData={setData}
      viewOnly={!!existingSale} existingSaleId={existingSale?.id}/>;
  }

  const _isMob = window.innerWidth <= 768;
  return (
    <div
      onMouseDown={_isMob ? undefined : e=>{_overlayDownRef.current=(e.target===e.currentTarget);}}
      onClick={_isMob ? undefined : e=>{if(_overlayDownRef.current && e.target===e.currentTarget)onClose(); _overlayDownRef.current=false;}}
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
{/* 모달 + 확장 패널 래퍼 */}
      <div style={_isMob ? {} : {display:"flex",gap:0,alignItems:"flex-start",justifyContent:"center",width:"95%",maxWidth:historyOpen?1200:680,margin:"0 auto",transition:"max-width .35s cubic-bezier(.22,1,.36,1)"}}>
      <div ref={modalRef} className="modal-res" onClick={e=>e.stopPropagation()} style={{background:T.bgCard,
        borderRadius:_isMob ? 0 : T.radius.xl,
        border:_isMob ? "none" : `1px solid ${T.border}`,
        margin:0,
        animation:_isMob ? "none" : "slideUp .4s cubic-bezier(.22,1,.36,1)",
        boxShadow:_isMob ? "none" : T.shadow.lg,
        width:_isMob ? "100%" : "100%", maxWidth:680, overflowX:"hidden",
        flex:_isMob ? undefined : "0 0 auto",
        position:"relative"}}>
        {/* 모바일 닫기 X 버튼 (우측 상단 플로팅) */}
        {_isMob && <button onClick={onClose} aria-label="닫기"
          style={{position:"absolute",top:8,right:8,zIndex:20,width:32,height:32,borderRadius:"50%",
            border:"none",background:"rgba(255,255,255,.92)",boxShadow:"0 2px 8px rgba(0,0,0,.15)",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            color:T.gray600,fontSize:18,fontWeight:700,fontFamily:"inherit",padding:0}}>✕</button>}
        {/* ═══ Chrome-style Tabs ═══ */}
        {!item?.id && !item?.scheduleOnly && <div style={{display:"flex",alignItems:"stretch",borderBottom:`1.5px solid ${T.gray200}`,background:T.bgCard,borderRadius:`${T.radius.xl}px ${T.radius.xl}px 0 0`,position:"relative"}}>
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

        {/* scheduleOnly 모드: 닫기 버튼만 */}
        {!item?.id && item?.scheduleOnly && <button onClick={onClose}
          style={{position:"absolute",top:10,right:12,width:30,height:30,borderRadius:"50%",
            background:T.gray200,border:"none",color:T.gray500,cursor:"pointer",zIndex:2,
            fontSize:T.fs.md,display:"flex",alignItems:"center",justifyContent:"center",
            transition:"background .15s,color .15s"}}
          onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger}}
          onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500}}>✕</button>}

        {/* 기존 예약 편집 모드 (데스크탑): 상단 우측 닫기 버튼 */}
        {!_isMob && item?.id && <button onClick={onClose} aria-label="닫기"
          style={{position:"absolute",top:10,right:12,width:30,height:30,borderRadius:"50%",
            background:T.gray200,border:"none",color:T.gray500,cursor:"pointer",zIndex:20,
            fontSize:T.fs.md,display:"flex",alignItems:"center",justifyContent:"center",
            transition:"background .15s,color .15s"}}
          onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger}}
          onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500}}>✕</button>}

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
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>확정대기</span>
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
                  <option value="|">미배정</option>
                  {branchRooms.map(rm => branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const stName = st.dn ? st.dn.replace(brName,"").trim() : "";
                    const label = stName ? `${brName}-${stName}` : brName;
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
                    style={{background:sel?bgClr:bgClr+"33",
                      color:sel?txtClr:T.text,
                      border:"none",
                      fontWeight:sel?700:500}}>
                    {tag.name}
                    {tag.dur > 0 && <span style={{fontSize:T.fs.sm,opacity:0.75}}>({tag.dur}분)</span>}
                  </button>;
                }) : <span style={{fontSize:T.fs.sm,color:T.gray500,padding:8}}>태그관리에서 내부일정태그를 등록하세요</span>}
              </div>
              {(f.selectedTags||[]).length > 0 && tagDurTotal>0 && <div style={{marginTop:4,fontSize:T.fs.sm,color:T.orange,fontWeight:T.fw.bolder,textAlign:"right"}}>합산 {tagDurTotal}분</div>}
            </FLD>
          </>}

          {/* ═══ 예약 모드 ═══ */}
          {!isSchedule && <>
            {/* 고객 정보 — 컴팩트 인라인 */}
            <div style={{position:"relative"}}>
              {/* 고객 선택됨: Contact Chip 카드 */}
              {f.custName ? (
                <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 12px",background:"linear-gradient(135deg,#f8f9fb,#f0f2f5)",borderRadius:10,border:"1px solid #e2e5ea"}}>
                  {/* 아바타 — 성별 표시 (클릭: 남↔여↔미지정 순환) */}
                  <button onClick={()=>set("custGender",f.custGender==="F"?"M":f.custGender==="M"?"":"F")}
                    title="클릭해서 성별 변경"
                    style={{width:24,height:24,borderRadius:"50%",border:"1.5px solid "+(f.custGender==="F"?"#e91e6320":f.custGender==="M"?"#3f51b520":"#0000"),cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:800,flexShrink:0,marginTop:2,padding:0,
                      background:f.custGender==="F"?"linear-gradient(135deg,#fce4ec,#f8bbd0)":f.custGender==="M"?"linear-gradient(135deg,#e8eaf6,#c5cae9)":"linear-gradient(135deg,#f5f5f5,#e0e0e0)",
                      color:f.custGender==="F"?"#c2185b":f.custGender==="M"?"#283593":"#999",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>
                    {f.custGender==="F"?"여":f.custGender==="M"?"남":"?"}
                  </button>
                  {/* 정보 */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      {editingCust ? (
                        <>
                          <input value={f.custName||""} onChange={e=>{set("custName",e.target.value);if(f.custId)set("custId",null)}} placeholder="이름"
                            style={{flex:"0 1 80px",minWidth:50,fontSize:14,fontWeight:700,color:"#1a1a2e",border:"1px solid #ccc",borderRadius:6,padding:"4px 8px",background:"#fff",fontFamily:"inherit",outline:"none"}}/>
                          <input value={f.custPhone||""} onChange={e=>{set("custPhone",e.target.value.replace(/[^0-9]/g,""));if(f.custId)set("custId",null)}} placeholder="연락처"
                            style={{flex:"1 1 110px",minWidth:90,fontSize:13,color:T.primary,fontWeight:500,border:"1px solid #ccc",borderRadius:6,padding:"4px 8px",background:"#fff",fontFamily:"inherit",outline:"none"}}/>
                        </>
                      ) : (
                        <>
                          <CopySpan text={f.custName} style={{fontSize:14,fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap"}}>{f.custName}</CopySpan>
                          {f.custName2 && <span style={{fontSize:12,color:"#888",fontWeight:500,whiteSpace:"nowrap"}}>({f.custName2})</span>}
                          <span style={{fontSize:11,color:"#888"}}>·</span>
                          <CopySpan text={f.custPhone} style={{fontSize:13,color:T.primary,fontWeight:500,whiteSpace:"nowrap"}}>{f.custPhone||"연락처 없음"}</CopySpan>
                          {custNum && <CopySpan text={custNum} style={{fontSize:13,color:"#999",fontFamily:"monospace",whiteSpace:"nowrap"}}>{custNum}</CopySpan>}
                          {shareCusts.length > 0 && <span title={`쉐어: ${shareCusts.map(s=>s.name).join(", ")}`}
                            style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#F5F3FF",color:"#5B21B6",border:"1px solid #C4B5FD",fontWeight:700,whiteSpace:"nowrap"}}>
                            🤝 쉐어 {shareCusts.length}명 · {shareCusts.map(s=>s.name).join(", ")}
                          </span>}
                        </>
                      )}
                    </div>
                    {(editingCust || f.custEmail) && (
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:editingCust?6:3}}>
                        <span style={{fontSize:11,color:"#aaa"}}>✉</span>
                        {editingCust ? (
                          <input type="email" value={f.custEmail||""} onChange={e=>set("custEmail",e.target.value)} placeholder="이메일"
                            style={{flex:1,minWidth:90,fontSize:13,color:"#777",fontWeight:500,border:"1px solid #ccc",borderRadius:6,padding:"4px 8px",background:"#fff",fontFamily:"inherit",outline:"none"}}/>
                        ) : (
                          <CopySpan text={f.custEmail} style={{fontSize:12,color:"#777"}}>{f.custEmail}</CopySpan>
                        )}
                      </div>
                    )}
                    {/* 성별 선택 — 편집 모드 또는 신규 고객 또는 미지정 고객 */}
                    {(editingCust || f.isNewCust || !f.custGender) && (
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                        <span style={{fontSize:11,color:"#aaa"}}>성별</span>
                        {[["F","여","#e91e63","#fce4ec"],["M","남","#283593","#e8eaf6"],["","미지정","#999","#f5f5f5"]].map(([v,lv,clr,bg])=>(
                          <button key={v||"none"} onClick={()=>set("custGender",v)}
                            style={{padding:"2px 10px",borderRadius:12,border:f.custGender===v?`1px solid ${clr}`:"1px solid #ddd",
                              background:f.custGender===v?bg:"#fff",
                              color:f.custGender===v?clr:"#999",
                              fontSize:11,fontWeight:f.custGender===v?700:500,cursor:"pointer",fontFamily:"inherit"}}>{lv}</button>
                        ))}
                      </div>
                    )}
                    {activePkgSummary.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
                      {activePkgSummary.map((pkg,i) => {
                        const activeBg = pkg.type==="prepaid"?"linear-gradient(135deg,#FFE0B2,#FFCC80)":pkg.type==="annual"?"linear-gradient(135deg,#E1BEE7,#CE93D8)":"linear-gradient(135deg,#FFF3E0,#FFE0B2)";
                        const activeClr = pkg.type==="annual"?"#6A1B9A":"#E65100";
                        const activeBdr = pkg.type==="annual"?"1px solid #BA68C8":"1px solid #FFB74D";
                        return (
                          <span key={i} title={pkg.active?"유효":"소진/만료"}
                            style={{fontSize:10,fontWeight:800,padding:"2px 6px",borderRadius:10,
                              background:pkg.active?activeBg:"#EEEEEE",
                              color:pkg.active?activeClr:"#9E9E9E",
                              border:pkg.active?activeBdr:"1px solid #E0E0E0",
                              textDecoration:pkg.active?"none":"line-through",
                              whiteSpace:"nowrap"}}>{pkg.label}</span>
                        );
                      })}
                    </div>}
                  </div>
                  {/* 변경/완료 + 고객관리 */}
                  {editingCust ? (
                    <div style={{display:"flex",flexDirection:"column",gap:3,alignSelf:"flex-start",flexShrink:0}}>
                      <button onClick={()=>setEditingCust(false)}
                        style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+T.primary,background:T.primary,color:"#fff",fontSize:10,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>완료</button>
                    </div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:3,alignSelf:"flex-start",flexShrink:0}}>
                      <button onClick={()=>setEditingCust(true)}
                        style={{padding:"3px 8px",borderRadius:5,border:"1px solid #ddd",background:"#fff",color:"#999",fontSize:10,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>변경</button>
                      {f.custId && <button onClick={()=>setCustPopupOpen(true)}
                        title="고객정보 빠른 보기"
                        style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+T.primary,background:T.primaryLt||"#fff0ec",color:T.primary,fontSize:10,cursor:"pointer",fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>고객정보 ↗</button>}
                    </div>
                  )}
                </div>
              ) : (
                /* 고객 미선택: 검색바 */
                <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                  <span style={{position:"absolute",left:10,color:T.gray500,display:"flex",alignItems:"center",pointerEvents:"none"}}><I name="search" size={14}/></span>
                  <input className="inp inp-search" style={{flex:1,minHeight:36,borderRadius:T.radius.md,paddingLeft:32,fontSize:13}} value={custSearch} onChange={e=>{setCustSearch(e.target.value);setShowCustDropdown(true)}}
                    placeholder="고객명, 전화번호 (2글자 이상)" onFocus={()=>setShowCustDropdown(true)}/>
                </div>
              )}
              {/* 검색 드롭다운 */}
              {showCustDropdown && custSearch.length >= 2 && <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,borderRadius:T.radius.md,maxHeight:200,overflow:"auto",zIndex:10,marginTop:2,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>
                {custResults.map(c=><div key={c.id} onClick={()=>{selectCust(c);setF(p=>({...p,isNewCust:false}))}}
                  style={{padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid #e0e0e020",display:"flex",gap:6,alignItems:"center",fontSize:12}}
                  onMouseOver={e=>e.currentTarget.style.background=T.gray200} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                  <span className="badge" style={{background:c.gender==="M"?T.infoLt:c.gender==="F"?T.femaleLt:T.gray200,color:c.gender==="M"?T.primary:c.gender==="F"?T.female:T.gray500,fontSize:10}}>{c.gender==="M"?"남":c.gender==="F"?"여":"-"}</span>
                  {c.custNum && <span style={{fontFamily:"monospace",fontSize:11,color:T.textSub,background:T.gray100,padding:"1px 5px",borderRadius:3,fontWeight:600}}>{c.custNum}</span>}
                  <span style={{fontWeight:600}}>{c.name}</span>
                  <span style={{color:T.textSub}}>{c.phone}</span>
                </div>)}
                {custResults.length===0 && <div style={{padding:"8px 12px",fontSize:12,color:T.gray500,textAlign:"center"}}>검색결과 없음</div>}
                <div onClick={()=>{const q=custSearch.trim();const isEmail=q.includes("@");setF(p=>({...p,isNewCust:true,custId:null,custName:isEmail?"":q.replace(/[0-9\-@.]/g,"").trim(),custPhone:q.replace(/[^0-9]/g,""),custEmail:isEmail?q:""}));setCustSearch("");setShowCustDropdown(false)}}
                  style={{padding:"8px 12px",cursor:"pointer",display:"flex",gap:6,alignItems:"center",fontSize:12,background:"#d0d0d020",borderTop:"1px solid "+T.border,color:T.danger,fontWeight:700}}
                  onMouseOver={e=>e.currentTarget.style.background="#d0d0d040"} onMouseOut={e=>e.currentTarget.style.background="#d0d0d020"}>
                  <I name="plus" size={13}/> 신규등록 {custSearch && <span style={{fontWeight:400,color:T.textSub}}>"{custSearch}"</span>}
                </div>
              </div>}
            </div>
            {/* 방문자(대리예약) */}
            {(f.visitorName||f.visitorPhone||f.isProxy) && <div style={{display:"flex",gap:6,alignItems:"center",padding:"4px 8px",background:"#fff8f0",borderRadius:T.radius.md,border:"1px solid #ffd0a0"}}>
              <span style={{fontSize:T.fs.nano,color:"#c07020",fontWeight:700,flexShrink:0}}>방문자</span>
              <input className="inp" value={f.visitorName||""} onChange={e=>set("visitorName",e.target.value)} placeholder="방문자명" style={{flex:1,fontSize:T.fs.xs,padding:"3px 6px"}}/>
              <input className="inp" value={f.visitorPhone||""} onChange={e=>set("visitorPhone",e.target.value)} placeholder="방문자 연락처" style={{flex:1,fontSize:T.fs.xs,padding:"3px 6px"}}/>
            </div>}

            {/* 예약기간 + 장소/담당자 */}
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
                  <option value="|">미배정</option>
                  {branchRooms.map(rm => branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const stName = st.dn ? st.dn.replace(brName,"").trim() : "";
                    const label = stName ? `${brName}-${stName}` : brName;
                    return <option key={rm.id+st.id} value={`${rm.id}|${st.id}`}>{label}</option>;
                  }))}
                </select>
              </div>
            </div>
            {/* 시술 상품 선택 */}
            {(() => {
              const hasGender = !!f.custGender;
              // 회원가 자격: 에너지/제품 제외한 활성 보유권이 있으면 회원가 적용
              const _isEnergyOrProd = p => { const n=(p.service_name||"").toLowerCase(); return n.includes("에너지")||n.includes("제품")||n.includes("구매권"); };
              const isMember = (custPkgsInfo||[]).some(p => !_isEnergyOrProd(p) && ((p.total_count||0)-(p.used_count||0)>0 || (p.note||"").match(/잔액:[1-9]/) || (p.service_name||"").match(/연간|할인권|회원권/i)));
              const _memberPrice = (svc, g) => {
                if (!isMember || !g) return g ? (g==="M"?svc.priceM:svc.priceF) : svc.priceF;
                const mp = g==="M" ? svc.memberPriceM : svc.memberPriceF;
                return mp || (g==="M"?svc.priceM:svc.priceF);
              };
              const svcPriceTotal = (f.selectedServices||[]).reduce((sum, sid) => {
                const svc = SVC_LIST.find(s=>s.id===sid);
                if (!svc) return sum;
                if (!hasGender && svc.priceF !== svc.priceM) return sum;
                return sum + _memberPrice(svc, hasGender ? f.custGender : null);
              }, 0);
              const hasGenderDep = (f.selectedServices||[]).some(sid => {const s=SVC_LIST.find(x=>x.id===sid); return s && s.priceF!==s.priceM;});
              return <div>
              <div className={"tags-acc acc-svc"}>
              <div className={"tags-acc-hdr"+(showSvcPicker?" open":"")} onClick={()=>setShowSvcPicker(!showSvcPicker)}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  시술상품
                  {(f.selectedServices||[]).length > 0
                    ? <span style={{color:T.primary,fontWeight:T.fw.bolder}}>{[
                        ...(f.selectedServices||[]).filter(id=>typeof id==="string" && id.startsWith("pkg__")).map(id=>"📦"+id.replace("pkg__","")),
                        ...groupSvcNames((f.selectedServices||[]).filter(id=>typeof id==="string" && !id.startsWith("pkg__")), SVC_LIST)
                      ].join(", ")} <span style={{background:"rgba(140,80,220,.12)",borderRadius:T.radius.sm,padding:"1px 6px",fontSize:T.fs.sm}}>{svcDurTotal}분{!hasGender&&hasGenderDep?"":" / "+fmt(svcPriceTotal)+"원"}</span></span>
                    : <span style={{color:T.textMuted,fontWeight:T.fw.normal}}>선택하세요</span>}
                </span>
                <span className={"tags-acc-chev"+(showSvcPicker?" open":"")}>▾</span>
              </div>
              <div className={"tags-acc-body"+(showSvcPicker?" open":"")}>
              <div style={{maxHeight:280,overflow:"auto"}}>
                {/* 보유 패키지 — 시술 목록 최상단 */}
                {(()=>{
                  const multiPkgs = (custPkgsInfo||[]).filter(p => {
                    const n=(p.service_name||"").toLowerCase();
                    if(n.includes("다담권")||n.includes("선불")||n.includes("10%추가적립")) return false;
                    if(n.includes("연간")||n.includes("할인권")||n.includes("회원권")) return false;
                    return (p.total_count||0)-(p.used_count||0)>0;
                  });
                  if(!multiPkgs.length) return null;
                  const groups={};
                  multiPkgs.forEach(p=>{
                    const name=(p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
                    if(!groups[name]) groups[name]={name,totalRemain:0};
                    groups[name].totalRemain+=(p.total_count||0)-(p.used_count||0);
                  });
                  return <div style={{borderBottom:"1px solid "+T.border,paddingBottom:4,marginBottom:4}}>
                    <div style={{padding:"4px 10px",fontSize:11,fontWeight:700,color:T.textMuted}}>📦 보유 패키지</div>
                    {Object.values(groups).map(g=>{
                      const pkgId="pkg__"+g.name;
                      const sel=(f.selectedServices||[]).includes(pkgId);
                      const isEnergy = g.name.includes("에너지");
                      const catLabel = isEnergy ? "에너지" : "패키지";
                      const catClr = isEnergy ? "#E65100" : "#7C4DFF";
                      const catBg = isEnergy ? "#FFF3E0" : "#EDE7F6";
                      return <div key={g.name} onClick={(e)=>{e.stopPropagation();toggleService(pkgId,1);}}
                        style={{padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,
                          background:sel?"#7c7cc810":"transparent",borderRadius:T.radius.sm,transition:"background .1s"}}>
                        {sel && <span style={{color:T.primary,fontWeight:700,fontSize:T.fs.sm,flexShrink:0}}>✓</span>}
                        <span style={{fontSize:T.fs.sm,color:catClr,background:catBg,borderRadius:T.radius.sm,padding:"1px 5px"}}>{catLabel}</span>
                        <span style={{flex:1,fontSize:T.fs.sm,fontWeight:sel?600:400,color:sel?T.text:T.gray600}}>{g.name}</span>
                        <span style={{fontSize:T.fs.sm,color:"#999"}}>{g.totalRemain}회</span>
                        <span style={{fontSize:T.fs.sm,color:T.gray400,fontWeight:700,minWidth:55,textAlign:"right"}}>0원</span>
                      </div>;
                    })}
                  </div>;
                })()}
                {SVC_LIST.length===0 && <div style={{padding:12,fontSize:T.fs.sm,color:T.gray500,textAlign:"center"}}>시술 상품이 없습니다 (관리설정 → 시술상품관리에서 등록)</div>}
                {SVC_LIST.length>0 && SVC_LIST.map(svc=>{
                      const sel = (f.selectedServices||[]).includes(svc.id);
        const qty = (f.selectedServices||[]).filter(id=>id===svc.id).length;
        const aqty = svcAllowQty(svc);
        const genderDep = svc.priceF !== svc.priceM;
        const price = hasGender ? _memberPrice(svc, f.custGender) : (genderDep ? null : svc.priceF);
        const disabled = hasGender && price===0;
        const catName = CATS.find(c=>c.id===svc.cat)?.name||"";
        return <div key={svc.id} onClick={()=>!disabled&&toggleService(svc.id,1)}
        style={{padding:"6px 10px",cursor:disabled?"default":"pointer",display:"flex",alignItems:"center",gap:6,
        borderBottom:"none",opacity:disabled?0.3:1,background:sel?"#7c7cc810":"transparent",borderRadius:T.radius.sm,transition:"background .1s"}}>
        {sel && !aqty && <span style={{color:T.primary,fontWeight:T.fw.bolder,fontSize:T.fs.sm,flexShrink:0}}>✓</span>}
        {catName && <span style={{fontSize:T.fs.sm,color:T.primary,background:T.primaryHover,borderRadius:T.radius.sm,padding:"1px 5px"}}>{catName}</span>}
        <span style={{flex:1,fontSize:T.fs.sm,fontWeight:sel?600:400,color:sel?T.text:T.gray600,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{svc.name}</span>
        <span style={{fontSize:T.fs.sm,color:T.gray500,flexShrink:0,whiteSpace:"nowrap"}}>{svc.dur}분</span>
        <span style={{fontSize:T.fs.sm,color:price===null?T.gray400:T.danger,fontWeight:T.fw.bold,minWidth:55,textAlign:"right",flexShrink:0,whiteSpace:"nowrap"}}>{price===null?"성별 필요":price===0?"무료":price?.toLocaleString()+"원"}</span>
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
                  {(f.chatChannel || item?.chatChannel) && setPendingChat && <button onClick={async(e)=>{
                    e.stopPropagation();
                    let ch=f.chatChannel, acc=f.chatAccountId, uid=f.chatUserId;
                    if(!ch && item?.id){
                      const rows=await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${item.id}&select=chat_channel,chat_account_id,chat_user_id`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY},cache:"no-store"}).then(r=>r.json());
                      if(rows?.[0]){ch=rows[0].chat_channel;acc=rows[0].chat_account_id;uid=rows[0].chat_user_id;}
                    }
                    if(ch&&uid){setPendingChat({user_id:uid,channel:ch,account_id:acc});setPage("messages");onClose();}
                  }} style={{fontSize:11,fontWeight:700,color:"#5B63B5",background:"#5B63B510",border:"1px solid #5B63B530",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}>
                    💬 대화보기
                  </button>}
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

            {/* 외부 선결제(예약금/선결제) — 수동 입력 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",marginTop:4,flexWrap:"wrap",gap:6,background:"#FFF3E0",borderRadius:8,border:"1px solid #FFCC80"}}>
              <span style={{fontSize:T.fs.sm,color:"#E65100",display:"inline-flex",alignItems:"center",gap:4,whiteSpace:"nowrap",fontWeight:700}}>🏷 선결제</span>
              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                {(()=>{
                  const platforms = (()=>{
                    try {
                      const s = typeof (data?.businesses||[])[0]?.settings === 'string' ? JSON.parse((data.businesses||[])[0].settings) : (data?.businesses||[])[0]?.settings || {};
                      const list = s?.external_platforms;
                      const userList = Array.isArray(list) && list.length>0 ? list : ["서울뷰티","크리에이트립"];
                      return ["네이버", ...userList.filter(p => p !== "네이버")];
                    } catch { return ["네이버","서울뷰티","크리에이트립"]; }
                  })();
                  return <select value={f.externalPlatform||""} onChange={e=>set("externalPlatform", e.target.value)}
                    style={{padding:"4px 6px",fontSize:T.fs.sm,border:"1px solid #FFB74D",borderRadius:6,background:"#fff",color:"#E65100",fontFamily:"inherit"}}>
                    <option value="">플랫폼</option>
                    {platforms.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>;
                })()}
                <input type="text" inputMode="numeric" value={f.externalPrepaid ? Number(f.externalPrepaid).toLocaleString() : ""} placeholder="0"
                  onChange={e=>{const v=Number(String(e.target.value).replace(/[^0-9]/g,""))||0; set("externalPrepaid", Math.max(0, v));}}
                  style={{width:110,padding:"4px 8px",fontSize:T.fs.sm,textAlign:"right",fontWeight:700,color:"#E65100",border:"1px solid #FFB74D",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
                <span style={{fontSize:T.fs.sm,color:"#E65100",fontWeight:700}}>원</span>
              </div>
            </div>

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

          {/* ═══ 수동 예약 등록정보 + 일정변경 로그 (기존 예약만) ═══ */}
          {!isNaverItem && item?.id && !isSchedule && (()=>{
            const c = item?.createdAt ? new Date(item.createdAt) : null;
            const regFmt = c && !isNaN(c)
              ? `${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")} ${String(c.getHours()).padStart(2,"0")}:${String(c.getMinutes()).padStart(2,"0")}`
              : "";
            const schLog = (item?.scheduleLog || "").trim();
            if (!regFmt && !schLog) return null;
            const schLines = schLog ? schLog.split("\n").filter(Boolean) : [];
            return <div style={{padding:"6px 10px",marginBottom:8,background:T.gray100,borderRadius:T.radius.md,fontSize:11,color:T.textSub}}>
              {regFmt && <div style={{display:"flex",alignItems:"center",gap:6}}>
                <I name="calendar" size={11} color={T.gray500}/>
                <span style={{fontWeight:600}}>등록</span>
                <span style={{marginLeft:"auto",fontFamily:"monospace"}}>{regFmt}</span>
              </div>}
              {schLines.length > 0 && <div style={{marginTop:regFmt?6:0,paddingTop:regFmt?6:0,borderTop:regFmt?"1px dashed "+T.border:"none",display:"flex",flexDirection:"column",gap:3}}>
                {schLines.slice(0, 10).map((l, i) => (
                  <div key={i} style={{fontSize:10.5,color:T.textMuted,fontFamily:"monospace",lineHeight:1.4}}>{l}</div>
                ))}
                {schLines.length > 10 && <div style={{fontSize:10,color:T.gray400}}>... 외 {schLines.length - 10}건</div>}
              </div>}
            </div>;
          })()}

          {/* ═══ 네이버 예약정보 (읽기전용) ═══ */}
          {isNaverItem && <div style={{background:T.successLt,borderRadius:T.radius.md,padding:"12px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
            {/* 헤더 */}
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <I name="naver" size={14}/>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.successDk}}>네이버 예약정보</span>
              {f.reservationId && <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:T.successDk,background:T.successLt,borderRadius:T.radius.sm,padding:"1px 6px",letterSpacing:0.5}}>#{f.reservationId}</span>}
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
                  if (f.requestMsg.trim().startsWith("[")) {
                    try {
                      const items = JSON.parse(f.requestMsg);
                      return items.filter(it=>it.value).map((it,idx)=>{
                        if (it.label==="시술메뉴") return <NRow key={idx} label="시술메뉴" value={it.value} />;
                        return <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                          <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>{it.label}</span>
                          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.medium,color:T.successDk,lineHeight:1.45,wordBreak:"break-word",flex:1}}>{it.value}</span>
                        </div>;
                      });
                    } catch(e) {}
                  }
                  return f.requestMsg.split("\n").filter(l=>l.trim()).map((line,idx)=>{
                    const ci = line.lastIndexOf(": ");
                    const key = ci > -1 ? line.slice(0,ci).trim() : null;
                    const val = ci > -1 ? line.slice(ci+2).trim() : line.trim();
                    if (!val) return null;
                    if (key==="시술메뉴") return <NRow key={idx} label="시술메뉴" value={val} />;
                    if (key) return <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                      <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>{key}</span>
                      <span style={{fontSize:T.fs.sm,fontWeight:T.fw.normal,color:T.text,lineHeight:1.45,wordBreak:"break-word",flex:1}}>{val}</span>
                    </div>;
                    return <NRow key={idx} label="요청" value={val}/>;
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
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:T.textMuted,fontWeight:600}}>직원 메모</span>
              {!isReadOnly && !isSchedule && <button type="button" onClick={handleAiAnalyze} disabled={aiAnalyzing}
                title={aiAnalyzing?"분석중...":"AI 분석"}
                style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 8px",fontSize:11,fontWeight:700,
                  border:"1px solid #ff9800",borderRadius:10,cursor:aiAnalyzing?"default":"pointer",
                  background:aiAnalyzing?"#f5f5f5":"#fff3e0",color:"#e65100",
                  opacity:aiAnalyzing?.6:1,fontFamily:"inherit",lineHeight:1}}>
                ✨ {aiAnalyzing?"분석중":"AI"}
              </button>}
            </div>
            <textarea className="inp inp-memo" ref={el=>{if(el){el.style.height="auto";el.style.height=Math.max(90,el.scrollHeight)+"px";}}}
              value={f.memo} onChange={e=>{set("memo",e.target.value);const t=e.target;t.style.height="auto";t.style.height=Math.max(90,t.scrollHeight)+"px";}}
              style={{resize:"vertical",minHeight:90,lineHeight:1.6,marginTop:4}} placeholder="직원 메모를 입력하세요"/>
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
            {!isReadOnly && <>
              {(() => {
                const baseBtn = {padding:"10px 16px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s"};
                return null;
              })()}
              {/* 매출등록 / 확인 / 취소 */}
              {!isSchedule && f.type === "reservation" && (
                existingSale ? (
                  <>
                    <button onClick={()=>setShowSaleForm(true)}
                      style={{padding:"10px 14px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+T.success,color:"#fff",background:T.success}}
                      title={saleIsTodayReg ? "매출 확인" : "매출 확인 (수정은 매출관리)"}>
                      <I name="check" size={12}/> 매출완료
                    </button>
                    {saleIsTodayReg ? (
                      <button onClick={handleCancelSale}
                        style={{padding:"10px 14px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+T.danger,color:T.danger,background:T.dangerLt}}
                        title="당일 등록분만 취소 가능">
                        <I name="x" size={12}/> 매출취소
                      </button>
                    ) : (
                      <span style={{padding:"10px 10px",fontSize:11,color:T.textMuted,fontWeight:600,whiteSpace:"nowrap"}}>수정은 매출관리에서</span>
                    )}
                  </>
                ) : (
                  <button onClick={()=>setShowSaleForm(true)}
                    style={{padding:"10px 16px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+T.orange,color:T.orange,background:T.warningLt}}>
                    <I name="wallet" size={12}/> 매출등록
                  </button>
                )
              )}
              {/* 삭제 — 네이버 예약은 버튼 자체를 숨김. 내부일정/수동예약은 확인창 없이 바로 삭제 */}
              {(() => {
                if (!item?.id) return null;
                const isNaverRes = !!item?.reservationId && !String(item.reservationId).startsWith('manual_');
                if (isNaverRes) return null;
                return <button onClick={()=>onDeleteRequest?.(item)}
                  style={{padding:"10px 16px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+T.danger,color:T.danger,background:T.dangerLt}}>
                  <I name="trash" size={12}/> 삭제
                </button>;
              })()}
              <button
                disabled={!isSchedule && f.type==="reservation" && !f.custName?.trim()}
                style={{marginLeft:"auto",padding:"10px 22px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+(isSchedule?T.orange:T.primary),color:"#fff",background:isSchedule?T.orange:T.primary,boxShadow:isSchedule?"0 4px 14px rgba(225,112,85,.35)":"0 4px 14px rgba(124,124,200,.35)"}}
                onClick={async ()=>{
                const now = new Date();
                const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
                const prevLog = f.tsLog || [];
                const newLog = !item?.id && !isSchedule
                  ? [...prevLog, `[등록: ${ts}]`]
                  : item?.id
                    ? [...prevLog, `[수정: ${ts}]`]
                    : prevLog;
                let autoTags = [...(f.selectedTags || [])];
                const _hasPrepaidSave = f.isPrepaid || (f.externalPrepaid || 0) > 0;
                if (_hasPrepaidSave && !autoTags.includes(PREPAID_TAG_ID)) autoTags = [...autoTags, PREPAID_TAG_ID];
                // 자동 제거 삭제 — 수동 추가 존중 (서현 요청 건, 수정요청 id_mj1wxf0q69)
                // 플랫폼 선택 시 방문경로 자동 매칭 (empty일 때만)
                let autoSource = f.source;
                if (f.externalPlatform && !autoSource) {
                  const match = (data?.resSources||[]).find(s => s.name === f.externalPlatform);
                  if (match) autoSource = match.name;
                }
                // 날짜·시작시간 변경 로그 (기존 예약만, 내부일정 제외). 종료시간만 변경은 로그 생략
                const _tsShort = `${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
                const _fmtDate = (d) => { if(!d) return ""; const p=d.split("-"); return `${p[1]}.${p[2]}`; };
                const _dateChanged = item?.id && !isSchedule && item?.date !== f.date;
                const _startTimeChanged = item?.id && !isSchedule && item?.time !== f.time;
                // 시술 메뉴 변경 감지 (내부일정 제외)
                const _prevSvc = Array.isArray(item?.selectedServices) ? item.selectedServices : [];
                const _newSvc = Array.isArray(f.selectedServices) ? f.selectedServices : [];
                const _svcChanged = item?.id && !isSchedule && (
                  _prevSvc.length !== _newSvc.length ||
                  _prevSvc.some(id => !_newSvc.includes(id)) ||
                  _newSvc.some(id => !_prevSvc.includes(id))
                );
                // 날짜·시작시간 로그 (한 줄 포맷)
                let _dtLog = "";
                if (_dateChanged && _startTimeChanged) {
                  _dtLog = `[📅 ${_tsShort}] ${_fmtDate(item.date)} ${item.time||""} → ${_fmtDate(f.date)} ${f.time||""}`;
                } else if (_dateChanged) {
                  _dtLog = `[📅 ${_tsShort}] ${_fmtDate(item.date)} → ${_fmtDate(f.date)}`;
                } else if (_startTimeChanged) {
                  _dtLog = `[📅 ${_tsShort}] ${item.time||""} → ${f.time||""}`;
                }
                // 시술 메뉴 변경 로그 (한 줄)
                let _svcLog = "";
                if (_svcChanged) {
                  const _svcName = (id) => (data?.services||[]).find(s => s.id === id)?.name || id;
                  const _prevNames = _prevSvc.map(_svcName).join(", ") || "-";
                  const _newNames = _newSvc.map(_svcName).join(", ") || "-";
                  _svcLog = `[🧴 ${_tsShort}] ${_prevNames} → ${_newNames}`;
                }
                // 새 일정변경 로그를 schedule_log 컬럼에 누적 (memo는 건드리지 않음)
                const _newSchLines = [_dtLog, _svcLog].filter(Boolean).join("\n");
                const _prevSchLog = item?.scheduleLog || "";
                const scheduleLogToSave = _newSchLines
                  ? (_prevSchLog ? `${_newSchLines}\n${_prevSchLog}` : _newSchLines)
                  : _prevSchLog;
                // memo: 기존 memo 유지 (일정변경/시술변경 로그 블록은 이미 예전에 섞여있으면 청소)
                const memoToSave = (f.memo||"")
                  .split("\n")
                  .filter(l => {
                    const t = l.trim();
                    if (/^\[등록:|^\[수정:/.test(t)) return false;
                    if (/^\d+\.\d+\s+\d+:\d+\s*(예약)?(접수|변경|확정|취소|신청|확정완료)/.test(t)) return false;
                    if (/^\[📅\s*일정변경/.test(t) || /^\[📅\s*\d{2}-\d{2}/.test(t)) return false;
                    if (/^\[🧴\s*시술변경/.test(t) || /^\[🧴\s*\d{2}-\d{2}/.test(t)) return false;
                    return true;
                  })
                  .join("\n").trim();
                // 고객 DB에 이메일/성별 자동 업데이트
                if(f.custId && !f.custId.startsWith("new_")){
                  const custUpdate={};
                  if(f.custEmail) custUpdate.email=f.custEmail;
                  if(f.custGender) custUpdate.gender=f.custGender;
                  if(Object.keys(custUpdate).length>0) sb.update("customers",f.custId,custUpdate).catch(()=>{});
                }
                // 상태가 cancelled로 변경되었고 이전 상태가 cancelled가 아니면 취소 알림톡
                if(f.status==="cancelled" && item?.status!=="cancelled" && f.custPhone && !isSchedule){
                  const branch = (data?.branches||[]).find(b=>b.id===f.bid);
                  queueAlimtalk(f.bid, "rsv_cancel", f.custPhone, {
                    "#{사용자명}":branch?.name||"", "#{날짜}":f.date||"", "#{시간}":f.time||"",
                    "#{대표전화번호}":branch?.phone||""
                  });
                }
                // 당일 취소 페널티 (id_imgr471swt-6): 예약일 = 오늘 + 신규 cancelled 전환 시
                // 포인트 → 선불권 순으로 33,000원 차감. 합계 부족 시 다회권 1회 차감.
                if(f.status==="cancelled" && item?.status!=="cancelled"
                   && f.date === todayStr() && f.custId && !isSchedule){
                  try {
                    const PENALTY = 33000;
                    const today = todayStr();
                    // 포인트 잔액
                    const ptxs = await sb.get("point_transactions", `&customer_id=eq.${f.custId}&select=type,amount`) || [];
                    let pointBal = 0;
                    for (const t of ptxs) {
                      if (t.type === 'earn') pointBal += Number(t.amount)||0;
                      else if (t.type === 'deduct' || t.type === 'expire') pointBal -= Number(t.amount)||0;
                    }
                    // 본인 보유권 (활성)
                    const myPkgs = await sb.get("customer_packages", `&customer_id=eq.${f.custId}`) || [];
                    const isExpired = (p) => {
                      const exp = ((p.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
                      return exp && exp < today;
                    };
                    const prepaidPkgs = myPkgs.filter(p => {
                      const n = (p.service_name||'').toLowerCase();
                      if (!(n.includes('다담') || n.includes('선불'))) return false;
                      if (isExpired(p)) return false;
                      const m = (p.note||'').match(/잔액:([0-9,]+)/);
                      return m ? Number(m[1].replace(/,/g,'')) > 0 : false;
                    });
                    const prepaidBal = prepaidPkgs.reduce((s,p) => {
                      const m = (p.note||'').match(/잔액:([0-9,]+)/);
                      return s + (m ? Number(m[1].replace(/,/g,'')) : 0);
                    }, 0);
                    const total = pointBal + prepaidBal;
                    const doDeduct = confirm(
                      `당일 취소입니다. 페널티 ${PENALTY.toLocaleString()}원 차감 진행할까요?\n\n` +
                      `• 포인트 잔액: ${pointBal.toLocaleString()}P\n` +
                      `• 선불권 잔액 합계: ${prepaidBal.toLocaleString()}원\n` +
                      `${total >= PENALTY ? `→ 포인트 → 선불권 순으로 ${PENALTY.toLocaleString()}원 차감` : `→ 부족 (${total.toLocaleString()}원). 다회권 1회 차감`}`
                    );
                    if (doDeduct) {
                      let pointDed = 0, prepaidDed = 0, pkgUsedName = '';
                      if (total >= PENALTY) {
                        let remain = PENALTY;
                        if (pointBal > 0) {
                          const ded = Math.min(pointBal, remain);
                          await sb.insert("point_transactions", {
                            id: 'ptx_'+genId(), business_id: (data?.businesses||[])[0]?.id,
                            bid: f.bid, customer_id: f.custId,
                            type: 'deduct', amount: ded,
                            balance_after: pointBal - ded,
                            note: `당일취소 페널티 (예약 ${f.id})`,
                          }).catch(()=>{});
                          remain -= ded;
                          pointDed = ded;
                        }
                        if (remain > 0) {
                          prepaidPkgs.sort((a,b) => {
                            const ba = Number(((a.note||'').match(/잔액:([0-9,]+)/)||[0,'0'])[1].replace(/,/g,''));
                            const bb = Number(((b.note||'').match(/잔액:([0-9,]+)/)||[0,'0'])[1].replace(/,/g,''));
                            return bb - ba;
                          });
                          for (const p of prepaidPkgs) {
                            if (remain <= 0) break;
                            const m = (p.note||'').match(/잔액:([0-9,]+)/);
                            const bal = m ? Number(m[1].replace(/,/g,'')) : 0;
                            const ded = Math.min(bal, remain);
                            const newBal = bal - ded;
                            const newUsed = (p.used_count||0) + ded;
                            const newNote = (p.note||'').replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
                            await sb.update("customer_packages", p.id, { used_count: newUsed, note: newNote }).catch(()=>{});
                            remain -= ded;
                            prepaidDed += ded;
                          }
                        }
                        alert(`페널티 ${PENALTY.toLocaleString()}원 차감 완료`);
                      } else {
                        // 다회권 1회 차감 — 유효기간 빠른 것 우선
                        const multi = myPkgs.filter(p => {
                          const n = (p.service_name||'').toLowerCase();
                          if (n.includes('다담') || n.includes('선불') || n.includes('연간') || n.includes('할인권') || n.includes('회원권')) return false;
                          if (isExpired(p)) return false;
                          return (p.total_count||0) - (p.used_count||0) > 0;
                        }).sort((a,b) => {
                          const ea = ((a.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[0,''])[1] || '9999-12-31';
                          const eb = ((b.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[0,''])[1] || '9999-12-31';
                          return ea.localeCompare(eb);
                        });
                        if (multi.length) {
                          const p = multi[0];
                          await sb.update("customer_packages", p.id, { used_count: (p.used_count||0) + 1 }).catch(()=>{});
                          pkgUsedName = p.service_name || '';
                          alert(`다회권 "${p.service_name}" 1회 차감 완료`);
                        } else {
                          alert("차감할 포인트·선불권·다회권이 없어 페널티 미적용");
                        }
                      }
                      // 페널티 매출 자동 기록 (유저 피드백): 차감이 실제로 이루어진 경우에만
                      if (pointDed > 0 || prepaidDed > 0 || pkgUsedName) {
                        try {
                          const penaltySaleId = 'sale_' + genId();
                          const _bizId = (data?.businesses||[])[0]?.id;
                          const svcName = pkgUsedName
                            ? `당일취소 페널티 (다회권: ${pkgUsedName} 1회)`
                            : '당일취소 페널티';
                          const amt = pkgUsedName ? 0 : PENALTY;
                          const memoParts = [];
                          if (pointDed > 0) memoParts.push(`포인트 ${pointDed.toLocaleString()}P`);
                          if (prepaidDed > 0) memoParts.push(`선불권 ${prepaidDed.toLocaleString()}원`);
                          if (pkgUsedName) memoParts.push(`다회권 ${pkgUsedName} 1회`);
                          await sb.insert("sales", {
                            id: penaltySaleId,
                            business_id: _bizId,
                            bid: f.bid,
                            cust_id: f.custId,
                            cust_name: f.custName,
                            cust_phone: f.custPhone || '',
                            cust_num: f.custNum || '',
                            cust_gender: f.custGender || '',
                            date: todayStr(),
                            service_name: svcName,
                            svc_cash: 0, svc_card: 0, svc_transfer: 0,
                            svc_point: pointDed,
                            external_prepaid: prepaidDed,
                            memo: `당일취소 페널티 — ${memoParts.join(' + ')} (예약 ${f.id})`,
                          }).catch(e => console.error('[penalty sales insert]', e));
                          await sb.insert("sale_details", {
                            id: 'sd_' + genId(),
                            business_id: _bizId,
                            sale_id: penaltySaleId,
                            service_name: svcName,
                            unit_price: amt,
                            qty: 1,
                            cash: 0, card: 0, bank: 0, point: pointDed,
                          }).catch(e => console.error('[penalty sd insert]', e));
                        } catch(e) { console.error('[penaltySale]', e); }
                      }
                    }
                  } catch (e) { console.error('[cancelPenalty]', e); }
                }
                onSave({...f, memo: memoToSave, scheduleLog: scheduleLogToSave, tsLog: newLog, selectedTags: autoTags, isSchedule, _isColTemplate: item?._isColTemplate, _templateId: item?._templateId, _initialServerSnap: initialServerSnap});
              }}>{item?.id?"저장":"등록"}</button>
              {/* AI 예약 확정 버튼 */}
              {f.status==="request" && <Btn style={{padding:"10px 26px",background:"#9C27B0",boxShadow:"0 4px 14px rgba(156,39,176,.35)"}}
                onClick={async ()=>{
                  const confirmMsg=`${f.custName}님, ${f.date} ${f.time} 예약이 확정되었습니다. 감사합니다!`;
                  // data.branches에서 동적으로 계정 매핑
                  const branchAccMap={};
                  (data?.branches||[]).forEach(b=>{ if(b.naverAccountId) branchAccMap[b.id]=b.naverAccountId; });
                  let sent=false;
                  try{
                    // DB에서 chat_channel/chat_account_id/chat_user_id 직접 조회
                    const dbRows=await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${f.id||item?.id}&select=chat_channel,chat_account_id,chat_user_id,memo`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY},cache:"no-store"}).then(r=>r.json());
                    const dbRes=dbRows?.[0]||{};
                    // 1순위: chat 필드가 있으면 바로 사용
                    if(dbRes.chat_channel && dbRes.chat_account_id && dbRes.chat_user_id){
                      await sb.insert("send_queue",{account_id:dbRes.chat_account_id,user_id:dbRes.chat_user_id,message_text:confirmMsg,status:"pending",channel:dbRes.chat_channel});
                      sent=true;
                    }
                    // 2순위: chat 필드 없으면 memo에서 파싱 (기존 데이터 호환)
                    if(!sent){
                      const dbMemo=dbRes.memo||f.memo||"";
                      const uidMatch=dbMemo.match(/\[AI예약(?:변경)?\](?:\[(\w+)\])?\s*(\S+)/);
                      if(uidMatch){
                        const aiChannel=uidMatch[1]||"naver";
                        const userId=uidMatch[2];
                        if(aiChannel==="instagram"){
                          let igPageId="",igUserId=userId;
                          const atIdx=userId.indexOf("@");
                          if(atIdx>=0){
                            const uname=userId.slice(atIdx+1);
                            const rows=await fetch(`${SB_URL}/rest/v1/messages?channel=eq.instagram&user_name=eq.${encodeURIComponent(uname)}&select=user_id,account_id&order=created_at.desc&limit=1`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY}}).then(r=>r.json());
                            if(rows?.length){igUserId=rows[0].user_id;igPageId=rows[0].account_id;}
                          }
                          if(!igPageId) igPageId=(data?.branches||[]).find(b=>b.id===f.bid)?.instagramAccountId || (data?.branches||[]).find(b=>b.instagramAccountId)?.instagramAccountId || "";
                          await sb.insert("send_queue",{account_id:igPageId,user_id:igUserId,message_text:confirmMsg,status:"pending",channel:"instagram"});
                          sent=true;
                        } else {
                          const accId=branchAccMap[f.bid]||"";
                          if(accId){await sb.insert("send_queue",{account_id:accId,user_id:userId,message_text:confirmMsg,status:"pending",channel:"naver"});sent=true;}
                        }
                      }
                    }
                    // 3순위: 네이버 기본
                    if(!sent){
                      const accId=branchAccMap[f.bid]||"";
                      if(accId && f.reservationId){
                        await sb.insert("send_queue",{account_id:accId,user_id:f.reservationId,message_text:confirmMsg,status:"pending",channel:"naver"});
                        sent=true;
                      }
                    }
                  }catch(e){console.error("확정 메시지 발송 실패",e);}
                  onSave({...f,status:"reserved"});
                }}>예약 확정</Btn>}
            </>}
            {isReadOnly && <span style={{fontSize:T.fs.sm,color:T.textSub,display:"flex",alignItems:"center",gap:T.sp.xs}}><I name="eye" size={12}/> 열람 전용 (타 지점)</span>}
          </div>
        </div>

      </div>
      {/* ── 확장 버튼 (모달과 패널 사이) ── */}
      {!_isMob && !isSchedule && (f.custId || item?.custId || f.custName || item?.custName) && (
        <div style={{display:"flex",alignItems:"center",alignSelf:"center",flexShrink:0}}>
          <button onClick={e=>{e.stopPropagation();setHistoryOpen(p=>!p)}} title={historyOpen?"닫기":"매출 히스토리"}
            style={{width:28,height:28,borderRadius:"50%",
              background:historyOpen?T.primary:"#fff",
              color:historyOpen?"#fff":T.gray500,
              border:`1px solid ${historyOpen?T.primary:T.border}`,
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:12,
              boxShadow:"0 1px 4px rgba(0,0,0,.1)"}}>
            {historyOpen ? "✕" : "≡"}
          </button>
        </div>
      )}

      {/* ── 매출 히스토리 확장 패널 ── */}
      {!_isMob && historyOpen && (
        <div className="modal-res" onClick={e=>e.stopPropagation()} style={{background:T.bgCard,
          borderRadius:T.radius.xl,
          border:`1px solid ${T.border}`,
          boxShadow:T.shadow.lg,
          width:"100%",maxWidth:680,
          marginLeft:12,
          display:"flex",flexDirection:"column",
          overflow:"hidden",
          maxHeight: modalRef.current ? modalRef.current.offsetHeight : "80vh",
          animation:"slideRight .3s cubic-bezier(.22,1,.36,1)"}}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <I name="clock" size={16} color={T.primary}/>
            <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>매출 히스토리</span>
            <span style={{fontSize:T.fs.xs,color:T.textSub,marginLeft:"auto"}}>{f.custName||item?.custName} ({salesHistory.length}건)</span>
          </div>
          <div style={{padding:"12px 16px",overflowY:"auto",flex:1}}>
            {/* 고객 메모 */}
            {custMemo && <div style={{padding:"12px 14px",marginBottom:10,background:"#FFFDE7",
              borderRadius:T.radius.md,border:`1px solid #FFF176`}}>
              <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:"#F57F17",marginBottom:6}}>📋 고객 메모</div>
              <div style={{fontSize:T.fs.xs,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{custMemo}</div>
            </div>}
            {historyLoading ? (
              <div style={{textAlign:"center",padding:40,color:T.textSub}}>로딩중...</div>
            ) : salesHistory.length === 0 && !custMemo ? (
              <div style={{textAlign:"center",padding:40,color:T.textSub,fontSize:T.fs.sm}}>매출 내역 없음</div>
            ) : (
              salesHistory.map((s,i) => {
                const total = (s.svc_card||0)+(s.svc_cash||0)+(s.svc_transfer||0)+(s.svc_point||0);
                return (
                  <div key={s.id||i} style={{padding:"12px 14px",marginBottom:8,background:i===0?"#f0f0ff":"#fafafa",
                    borderRadius:T.radius.md,border:`1px solid ${i===0?T.primary+"30":T.border}`,
                    transition:"background .15s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary}}>{s.date}</span>
                      {total>0 && <span style={{fontSize:T.fs.xs,color:T.text,fontWeight:700}}>{total.toLocaleString()}원</span>}
                    </div>
                    {s.service_name && <div style={{fontSize:T.fs.xs,color:T.gray600,marginBottom:4}}>{s.service_name}</div>}
                    {s.staff_name && <div style={{fontSize:T.fs.nano,color:T.textSub,marginBottom:4}}>담당: {s.staff_name}</div>}
                    {s.memo && <div style={{fontSize:T.fs.xs,color:T.text,lineHeight:1.6,
                      whiteSpace:"pre-wrap",wordBreak:"break-word",
                      padding:"8px 10px",background:"#fff",borderRadius:6,
                      maxHeight:200,overflowY:"auto",
                      border:`1px solid ${T.border}`}}>{s.memo}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      </div>{/* 래퍼 닫기 */}

      {/* 고객정보 빠른 보기 팝업 */}
      {custPopupOpen && f.custId && (
        <div onClick={()=>setCustPopupOpen(false)}
          style={{position:"fixed",inset:0,zIndex:10001,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,animation:"ovFadeIn .2s"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,borderRadius:14,boxShadow:"0 10px 40px rgba(0,0,0,.25)",width:"100%",maxWidth:420,maxHeight:"85vh",overflow:"auto",animation:"slideUp .3s cubic-bezier(.22,1,.36,1)"}}>
            {/* 헤더 */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",borderBottom:"1px solid "+T.border,position:"sticky",top:0,background:T.bgCard,zIndex:1}}>
              <I name="user" size={16} color={T.primary}/>
              <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>고객 정보</span>
              <button onClick={()=>setCustPopupOpen(false)}
                style={{marginLeft:"auto",width:28,height:28,borderRadius:"50%",border:"none",background:"transparent",color:T.gray500,cursor:"pointer",fontSize:18,lineHeight:1}}>✕</button>
            </div>
            {/* 본문 */}
            <div style={{padding:16}}>
              {/* 프로필 카드 */}
              <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:10,background:"linear-gradient(135deg,#f8f9fb,#f0f2f5)",borderRadius:10,marginBottom:12}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:f.custGender==="F"?"linear-gradient(135deg,#fce4ec,#f8bbd0)":f.custGender==="M"?"linear-gradient(135deg,#e8eaf6,#c5cae9)":"linear-gradient(135deg,#f5f5f5,#e0e0e0)",color:f.custGender==="F"?"#c2185b":f.custGender==="M"?"#283593":"#999",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {f.custGender==="F"?"여":f.custGender==="M"?"남":"?"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:800,color:"#1a1a2e",marginBottom:2}}>{f.custName || "-"}{custNum && <span style={{marginLeft:6,fontSize:11,color:"#999",fontWeight:600,fontFamily:"monospace"}}>#{custNum}</span>}</div>
                  <div style={{fontSize:12,color:T.primary,marginBottom:1}}>{f.custPhone || "-"}</div>
                  {f.custEmail && <div style={{fontSize:11,color:"#777"}}>✉ {f.custEmail}</div>}
                </div>
              </div>

              {/* 통계 */}
              {(()=>{
                const dbCust = (data?.customers||[]).find(c=>c.id===f.custId);
                if (!dbCust) return null;
                return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:12}}>
                  <StatBox label="방문" val={dbCust.visits||0} color={T.primary}/>
                  <StatBox label="최근방문" val={dbCust.lastVisit||"-"} color={T.info} small/>
                  <StatBox label="가입" val={dbCust.joinDate?dbCust.joinDate.slice(0,10):"-"} color={T.textSub} small/>
                </div>;
              })()}

              {/* 보유 패키지 */}
              {(custPkgsInfo||[]).length > 0 && <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6}}>🎫 보유권</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {activePkgSummary.map((pkg,i) => {
                    const activeBg = pkg.type==="prepaid"?"linear-gradient(135deg,#FFE0B2,#FFCC80)":pkg.type==="annual"?"linear-gradient(135deg,#E1BEE7,#CE93D8)":"linear-gradient(135deg,#FFF3E0,#FFE0B2)";
                    const activeClr = pkg.type==="annual"?"#6A1B9A":"#E65100";
                    return <span key={i} style={{fontSize:11,fontWeight:800,padding:"3px 8px",borderRadius:10,background:pkg.active?activeBg:"#EEEEEE",color:pkg.active?activeClr:"#9E9E9E",border:"1px solid "+(pkg.active?"#FFB74D":"#E0E0E0"),textDecoration:pkg.active?"none":"line-through"}}>{pkg.label}</span>;
                  })}
                </div>
              </div>}

              {/* 고객 메모 */}
              {custMemo && <div style={{padding:"10px 12px",marginBottom:12,background:"#FFFDE7",borderRadius:8,border:"1px solid #FFF176"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#F57F17",marginBottom:4}}>📋 고객 메모</div>
                <div style={{fontSize:12,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{custMemo}</div>
              </div>}

              {/* 최근 매출 이력 (최대 5건) */}
              {salesHistory.length > 0 && <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6}}>📊 최근 매출 ({salesHistory.length}건)</div>
                {salesHistory.slice(0,5).map((s,i) => {
                  const total = (s.svc_card||0)+(s.svc_cash||0)+(s.svc_transfer||0)+(s.svc_point||0);
                  return <div key={s.id||i} style={{padding:"8px 10px",marginBottom:4,background:i===0?"#f0f0ff":"#fafafa",borderRadius:6,border:"1px solid "+(i===0?T.primary+"30":T.border),fontSize:11}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:700,color:T.primary}}>{s.date}</span>
                      {total>0 && <span style={{fontWeight:700,color:T.text}}>{total.toLocaleString()}원</span>}
                    </div>
                    {s.service_name && <div style={{color:T.gray600,marginTop:2}}>{s.service_name}</div>}
                  </div>;
                })}
              </div>}

              {/* 전체보기 링크 */}
              {setPage && <button onClick={()=>{if(setPendingOpenCust)setPendingOpenCust(f.custId);setPage("customers");setCustPopupOpen(false);onClose();}}
                style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid "+T.primary,background:"#fff",color:T.primary,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                고객관리에서 전체 보기 ↗
              </button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 작은 통계 박스
function StatBox({ label, val, color, small }) {
  return <div style={{padding:"6px 8px",background:"#fafafa",borderRadius:8,border:"1px solid #eee",textAlign:"center"}}>
    <div style={{fontSize:9,color:"#999",marginBottom:2}}>{label}</div>
    <div style={{fontSize:small?11:14,fontWeight:800,color}}>{val}</div>
  </div>;
}

// ═══════════════════════════════════════════
// SaleSvcRow, SaleProdRow, SaleExtraRow, SaleDiscountRow, DetailedSaleForm
// → Extracted to ./SaleForm.jsx
// ═══════════════════════════════════════════

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


export { DetailedSaleForm }
export default TimelineModal
