import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, buildTokenSearch, SB_URL, SB_KEY } from '../../lib/sb'
import { fromDb, toDb, _activeBizId } from '../../lib/db'
import { todayStr, genId } from '../../lib/utils'
import I from '../common/I'

const uid = genId;
// 금액 콤마 포맷 유틸
const fmtAmt = (v) => { const n = Number(String(v).replace(/,/g,"")); return n ? n.toLocaleString() : ""; };
const parseAmt = (v) => Number(String(v).replace(/,/g,"")) || 0;

const Btn = ({ children, variant="primary", size="md", disabled, onClick, style={} }) => {
  const bg = variant==="primary"?T.primary:variant==="danger"?T.danger:variant==="ghost"?"transparent":T.gray100;
  const color = variant==="ghost"?T.primary:variant==="secondary"?T.text:"#fff";
  const border = variant==="ghost"?"1px solid "+T.border:"none";
  const pad = size==="sm"?"4px 10px":size==="lg"?"10px 20px":"7px 14px";
  return <button onClick={disabled?undefined:onClick} disabled={disabled} style={{background:bg,color,border,borderRadius:T.radius.md,padding:pad,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit",...style}}>{children}</button>;
};
const GridLayout = ({ cols=2, gap=12, children, style={} }) => {
  const tpl = typeof cols==="number" ? `repeat(${cols},1fr)` : cols;
  return <div style={{display:"grid",gridTemplateColumns:tpl,gap,...style}}>{children}</div>;
};

const SaleSvcRow = React.memo(function SaleSvcRow({ id, name, dur, checked, amount, defPrice, regularPrice, toggle, setAmt, badgeText, badgeColor, badgeBg }) {
  const disabled = defPrice === 0;
  const isMember = regularPrice && regularPrice > defPrice;
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if(!editing) setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  return (
    <div className="sale-svc-row" onClick={() => !disabled && !checked && toggle(id, defPrice)}
      style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 4,
        background: checked ? "#7c7cc810" : "transparent", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, transition: "background .15s", lineHeight: 1.4 }}>
      <span onClick={e => { e.stopPropagation(); if(!disabled) toggle(id, defPrice); }}
        className="sale-svc-name" style={{ flex: 1, fontSize: 13, color: checked ? T.text : T.gray700, fontWeight: checked ? 700 : 400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {checked && <span style={{color:T.primary,marginRight:3}}>✓</span>}{name}
        {isMember && <span style={{fontSize:9,color:T.primary,marginLeft:3,fontWeight:700}}>회원</span>}
        {badgeText && <span style={{fontSize:9,color:badgeColor||"#fff",background:badgeBg||T.primary,marginLeft:4,padding:"1px 5px",borderRadius:8,fontWeight:700}}>{badgeText}</span>}
      </span>
      <span className="sale-dur" style={{ flexShrink: 0, width: 28, textAlign: "right", whiteSpace:"nowrap", fontSize: 10, color: T.gray400 }}>{dur}분</span>
      {isMember && <span style={{flexShrink:0,fontSize:10,color:T.gray400,textDecoration:"line-through"}}>{(regularPrice||0).toLocaleString()}</span>}
      <input type="text" inputMode="numeric" value={checked ? localAmt : ""} placeholder={disabled ? "—" : (defPrice||0).toLocaleString()}
        onClick={e => e.stopPropagation()} onFocus={()=>setEditing(true)}
        onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); setLocalAmt(raw?Number(raw).toLocaleString():""); }}
        onBlur={e => { setEditing(false); setAmt(id, parseAmt(e.target.value)); }} disabled={!checked}
        style={{ width: 95, padding: "2px 5px", fontSize: 13, textAlign: "right", borderRadius: 5, flexShrink: 0, minHeight: 0, height: 24, boxSizing: "border-box", fontFamily: "inherit", outline: "none",
          background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleProdRow = React.memo(function SaleProdRow({ id, name, price, checked, amount, toggle, setAmt }) {
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if(!editing) setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  return (
    <div className="sale-svc-row" onClick={() => !checked && toggle(id, price)}
      style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 4,
        background: checked ? "#7c7cc810" : "transparent", cursor: "pointer", transition: "background .15s", lineHeight: 1.4 }}>
      <span onClick={e => { e.stopPropagation(); toggle(id, price); }}
        style={{ flex: 1, fontSize: 13, color: checked ? T.text : T.gray700, fontWeight: checked ? 700 : 400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {checked && <span style={{color:T.primary,marginRight:3}}>✓</span>}{name}
      </span>
      <input type="text" inputMode="numeric" value={checked ? localAmt : ""} placeholder={price ? price.toLocaleString() : "0"}
        onClick={e => e.stopPropagation()} onFocus={()=>setEditing(true)}
        onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); setLocalAmt(raw?Number(raw).toLocaleString():""); }}
        onBlur={e => { setEditing(false); setAmt(id, parseAmt(e.target.value)); }} disabled={!checked}
        style={{ width: 95, padding: "2px 5px", fontSize: 13, textAlign: "right", borderRadius: 5, flexShrink: 0, minHeight: 0, height: 24, boxSizing: "border-box", fontFamily: "inherit", outline: "none",
          background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleExtraRow = React.memo(function SaleExtraRow({ id, color, placeholder, checked, amount, label, toggle, setAmt, setLabel }) {
  const [localLabel, setLocalLabel] = useState(label || "");
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  useEffect(() => { setLocalAmt(fmtAmt(amount)); }, [checked]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", borderTop: "1px solid #e0e0e0", marginTop: 4 }}>
      <span onClick={() => toggle(id, 0)}
        style={{ fontSize: 13, color: checked ? T.danger : T.gray500, fontWeight: 700, flexShrink: 0, cursor: "pointer" }}>
        {checked ? "✓ 추가" : "+ 추가"}
      </span>
      <input className="inp" value={localLabel} onChange={e => setLocalLabel(e.target.value)}
        onBlur={e => setLabel(id, e.target.value)}
        placeholder={placeholder} style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "transparent", border:"1px solid "+T.border, borderRadius: 6 }} />
      <input type="text" inputMode="numeric" value={localAmt} placeholder="0"
        onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); const v=raw?Number(raw).toLocaleString():""; setLocalAmt(v); setAmt(id, parseAmt(raw)); if(!checked && parseAmt(raw)>0) toggle(id, 0); }}
        style={{ width: 95, padding: "4px 6px", fontSize: 13, textAlign: "right", borderRadius: 6,
          border: `1px solid ${checked ? T.gray400 : T.border}`,
          color: checked ? T.danger : T.gray500, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleDiscountRow = React.memo(function SaleDiscountRow({ id, checked, amount, toggle, setAmt }) {
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  useEffect(() => { setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  // 입력란은 항상 활성 — 금액 입력 시 자동 체크, 비우면 자동 해제
  return <div
    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6,
      background: checked ? "#e8a0a010" : "transparent", transition: "background .15s" }}>
    <span onClick={() => toggle(id, 0)}
      style={{ flex: 1, fontSize: 11, color: checked ? T.female : T.gray600, fontWeight: 600, cursor: "pointer" }}>
      {checked ? <span style={{color:T.female}}>✓ </span> : ""}할인
    </span>
    <input type="text" inputMode="numeric" value={localAmt} placeholder="0"
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, "");
        const v = raw ? Number(raw).toLocaleString() : "";
        setLocalAmt(v);
        const n = parseAmt(raw);
        setAmt(id, n);
        // 자동 토글: 입력이 0 초과면 체크, 비면 해제
        if (n > 0 && !checked) toggle(id, n);
        else if (n === 0 && checked) toggle(id, 0);
      }}
      style={{ width: 95, padding: "4px 6px", fontSize: 13, textAlign: "right", borderRadius: 6,
        background: T.bgCard, border: `1px solid ${checked ? T.female : T.gray400}`,
        color: checked ? T.danger : T.text, fontWeight: checked ? 700 : 500 }} />
  </div>;
});

// DETAILED SALE FORM (매출 입력 - 시술상품/제품 연동)
// ═══════════════════════════════════════════
export function DetailedSaleForm({ reservation, branchId, onSubmit, onClose, data, setData, editMode, existingSaleId }) {
  const fmt = (v) => v==null?"":Number(v).toLocaleString();
  // 더블클릭/중복 저장 방지 락 (신규 매출 저장 경로에서 사용)
  const _submitLock = useRef(false);
  // 판매중단(isActive=false) 상품은 숨김, 단 편집모드에서 기존 등록된 항목은 유지
  const SVC_LIST = (data?.services || []).filter(s => s.isActive !== false).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []).filter(p => p.isActive !== false);
  const CATS = (data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const branchStaff = (data.staff||[]).filter(s => s.bid === branchId);
  const [manager, setManager] = useState(reservation?.staffId || "");
  // ── 직원의 매출 날짜 실제 근무지점 (schHistory의 "지원(X)" 상태 반영) ──
  const saleDate = reservation?.date || todayStr();
  const [schHistory, setSchHistory] = useState(null);
  useEffect(() => {
    // schedule_data는 created_at 컬럼이 없어 sb.get 기본 정렬이 400 에러 → 직접 fetch
    fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.schHistory_v1&select=value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.ok ? r.json() : []).then(rows => {
      try {
        const raw = rows?.[0]?.value;
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!obj) return;
        const merged = {};
        Object.values(obj).forEach(month => {
          if (typeof month !== "object" || !month) return;
          Object.entries(month).forEach(([emp, days]) => {
            if (!merged[emp]) merged[emp] = {};
            Object.assign(merged[emp], days);
          });
        });
        setSchHistory(merged);
      } catch(e) {}
    }).catch(() => {});
  }, []);
  // 직원의 해당 날짜 실제 근무지점 (지원갔으면 그 지점 id, 아니면 홈 지점)
  const getEffectiveBranch = (staff) => {
    if (!staff?.dn) return staff?.bid;
    const st = schHistory?.[staff.dn]?.[saleDate];
    if (typeof st === "string" && st.startsWith("지원(")) {
      const brName = st.slice(3, -1).trim();
      const br = (data?.branches||[]).find(b =>
        (b.short||"").replace("점","") === brName ||
        (b.name||"").includes(brName)
      );
      if (br) return br.id;
    }
    return staff.bid;
  };
  const allStaff = (data.staff||[]).filter(s => s.bid); // 전체 직원
  const [selBranch, setSelBranch] = useState(branchId);
  const [gender, setGender] = useState(reservation?.custGender || "");
  const [openCats, setOpenCats] = useState({}); // catId → true/false (null=auto)
  const toggleCat = (catId) => setOpenCats(p => ({...p, [catId]: !isCatOpen(catId, p)}));
  const isCatOpen = (catId, cats=openCats) => {
    if(cats[catId] !== undefined) return cats[catId];
    // 선택된 시술이 있는 카테고리는 자동 열림
    try {
      const svcs = (data?.services||[]).filter(s=>s.cat===catId);
      return svcs.some(s=>items?.[s.id]?.checked);
    } catch(e) { return false; }
  };
  const [saleMemo, setSaleMemo] = useState(() => {
    if (reservation?.saleMemo) return reservation.saleMemo;
    try {
      const s = typeof (data?.businesses||[])[0]?.settings === 'string' ? JSON.parse((data.businesses||[])[0].settings) : (data?.businesses||[])[0]?.settings || {};
      return s?.memo_templates?.sale || "";
    } catch { return ""; }
  });

  // 결제수단 분배 — 편집 모드면 기존 매출의 값으로 프리필
  const [payMethod, setPayMethod] = useState(() => editMode && reservation ? {
    svcCash: reservation.svcCash || 0, svcCard: reservation.svcCard || 0,
    svcTransfer: reservation.svcTransfer || 0, svcPoint: reservation.svcPoint || 0,
    prodCash: reservation.prodCash || 0, prodCard: reservation.prodCard || 0,
    prodTransfer: reservation.prodTransfer || 0, prodPoint: reservation.prodPoint || 0,
  } : { svcCash:0, svcCard:0, svcTransfer:0, svcPoint:0, prodCash:0, prodCard:0, prodTransfer:0, prodPoint:0 });
  const [openPay, setOpenPay] = useState(() => editMode && reservation ? {
    svcCard: (reservation.svcCard||0) > 0, svcCash: (reservation.svcCash||0) > 0, svcTransfer: (reservation.svcTransfer||0) > 0,
    prodCard: (reservation.prodCard||0) > 0, prodCash: (reservation.prodCash||0) > 0, prodTransfer: (reservation.prodTransfer||0) > 0,
  } : { svcCard:false, svcCash:false, svcTransfer:false, prodCard:false, prodCash:false, prodTransfer:false });
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
    const val = parseAmt(v);
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
  // 외부 플랫폼 선결제 (네이버/서울뷰티/크리에이트립 등) — 네이버는 시스템 기본
  const externalPlatforms = (()=>{
    try {
      const s = typeof (data?.businesses||[])[0]?.settings === 'string' ? JSON.parse((data.businesses||[])[0].settings) : (data?.businesses||[])[0]?.settings || {};
      const list = s?.external_platforms;
      const userList = Array.isArray(list) && list.length>0 ? list : ["서울뷰티","크리에이트립"];
      // "네이버"는 항상 맨 앞 (시스템 기본)
      return ["네이버", ...userList.filter(p => p !== "네이버")];
    } catch { return ["네이버","서울뷰티","크리에이트립"]; }
  })();
  // 네이버 예약이면 자동 선결제 금액/플랫폼 감지
  const _naverAutoAmt = (() => {
    if (!isNaver) return 0;
    if (reservation?.isPrepaid && (reservation?.totalPrice || 0) > 0) return reservation.totalPrice;
    if (reservation?.memo) {
      const m = reservation.memo.match(/예약금\s*:?\s*([0-9,]+)\s*원?/);
      if (m) return Number(m[1].replace(/,/g, "")) || 0;
    }
    return 0;
  })();
  const [externalPrepaid, setExternalPrepaid] = useState(reservation?.externalPrepaid || _naverAutoAmt || 0);
  const [externalPlatform, setExternalPlatform] = useState(reservation?.externalPlatform || (isNaver ? "네이버" : ""));

  // 고객 상태 (예약에서 넘어오면 자동 기입, 매출관리에서 열면 검색)
  // 방문자(대리예약) 있으면 기본은 방문자로 매출 등록 — 유저가 토글로 예약자/방문자 선택 가능
  const _hasVisitor = !!(reservation?.visitorName || reservation?.visitorPhone);
  const _hasReserver = !!(reservation?.custName || reservation?.custPhone);
  const _visitorDiffers = _hasVisitor && _hasReserver &&
    ((reservation?.visitorName || "") !== (reservation?.custName || "") ||
     (reservation?.visitorPhone || "") !== (reservation?.custPhone || ""));
  const [saleTargetType, setSaleTargetType] = useState(_hasVisitor ? "visitor" : "reserver");
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
  const hasReservationCust = !!(reservation?.custName) || _hasVisitor;

  // 예약자/방문자 토글
  const switchSaleTarget = (type) => {
    if (type === saleTargetType) return;
    setSaleTargetType(type);
    if (type === "visitor") {
      setCust({
        id: null,
        name: reservation?.visitorName || "",
        phone: reservation?.visitorPhone || "",
        gender: reservation?.custGender || ""
      });
    } else {
      setCust({
        id: reservation?.custId || null,
        name: reservation?.custName || "",
        phone: reservation?.custPhone || "",
        gender: reservation?.custGender || ""
      });
    }
    // 보유권은 cust 변경 감지 useEffect에서 자동 재조회되지 않으므로 여기서 clear
    setCustPkgs([]);
    setPkgUse({});
  };

  // 고객 검색 (디바운스)
  const [custSearch, setCustSearch] = useState("");
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [custResults, setCustResults] = useState([]);
  useEffect(() => {
    if (custSearch.trim().length < 2) { setCustResults([]); return; }
    const timer = setTimeout(async () => {
      const raw = custSearch.trim();
      try {
        const bizId = _activeBizId || "biz_khvurgshb";
        const cond = buildTokenSearch(raw, ["name","name2","phone","phone2","email","cust_num"]);
        const rows = await sb.get("customers", `&business_id=eq.${bizId}${cond}&limit=20`);
        setCustResults(Array.isArray(rows) ? fromDb("customers", rows) : []);
      } catch(e) { console.error("custSearch err:", e); setCustResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch]);
  const selectCust = (c) => {
    setCust({ id: c.id, name: c.name, phone: c.phone, gender: c.gender || "" });
    setGender(c.gender || "");
    setCustSearch(""); setShowCustDrop(false);
    // 보유권 조회
    if (c.id) {
      sb.get("customer_packages", `&customer_id=eq.${c.id}`).then(rows => setCustPkgs(rows||[])).catch(()=>{});
    }
  };
  // 고객 보유권 (다회권/다담권/연간할인권) — 현재 선택된 cust 기준으로 로드
  const [custPkgs, setCustPkgs] = useState([]);
  const [pkgUse, setPkgUse] = useState({}); // {pkgId: true(다회권체크) 또는 금액(다담권)}
  // 신규 다담권/패키지 구매 + 오늘 즉시 차감 토글: {svcId: true|false}
  const [usePkgToday, setUsePkgToday] = useState({});
  // usePkgToday 변경 시 체크된 시술 가격을 회원가/정상가로 재계산
  useEffect(() => {
    setItems(prev => {
      const next = {...prev};
      SVC_LIST.forEach(svc => {
        if (next[svc.id]?.checked && svc.cat !== "1s18w2l46") { // 다담권 자체는 제외
          next[svc.id] = {...next[svc.id], amount: _defPrice(svc, gender)};
        }
      });
      return next;
    });
  }, [JSON.stringify(usePkgToday)]);
  // ── 신규 판정: 매출 이력 0건 여부 (DB 조회) ──
  const [custHasSale, setCustHasSale] = useState(false);
  useEffect(() => {
    if (!cust.id) { setCustHasSale(false); return; }
    sb.get("sales", `&cust_id=eq.${cust.id}&limit=1`)
      .then(rows => setCustHasSale((rows||[]).length > 0))
      .catch(() => setCustHasSale(false));
  }, [cust.id]);

  // ── 포인트 잔액 + 적립/사용 입력 ──
  const [pointBalance, setPointBalance] = useState(0);
  const [pointEarn, setPointEarn] = useState(0);
  const [pointUse, setPointUse] = useState(0);
  useEffect(() => {
    if (!cust?.id) { setPointBalance(0); return; }
    sb.get("point_transactions", `&customer_id=eq.${cust.id}&limit=500`)
      .then(rows => {
        const bal = (rows||[]).reduce((s,t) => {
          if (t.type==="earn"||t.type==="adjust_add") return s+(t.amount||0);
          if (t.type==="deduct"||t.type==="adjust_sub") return s-(t.amount||0);
          return s;
        }, 0);
        setPointBalance(bal);
      }).catch(()=>setPointBalance(0));
  }, [cust?.id]);
  // cust가 바뀌면(예약자↔방문자 토글 등) 다시 로드
  useEffect(() => {
    if (cust?.id) {
      sb.get("customer_packages", `&customer_id=eq.${cust.id}`).then(rows => setCustPkgs(rows||[])).catch(()=>{});
    } else if (cust?.phone) {
      // custId 없으면 현재 cust의 전화번호로 고객 찾아서 보유권 조회
      const phone = cust.phone;
      const bizId = data?.business?.id || _activeBizId;
      sb.get("customers", `&phone=eq.${phone}&business_id=eq.${bizId}&limit=1`).then(rows => {
        if (rows?.length) {
          setCust(prev => ({...prev, id: rows[0].id}));
          sb.get("customer_packages", `&customer_id=eq.${rows[0].id}`).then(pkgs => setCustPkgs(pkgs||[])).catch(()=>{});
        } else {
          setCustPkgs([]);
        }
      }).catch(()=>{});
    } else {
      setCustPkgs([]);
    }
  }, [cust?.id, cust?.phone]);
  const _pkgType = (p) => {
    const n = (p.service_name||"").toLowerCase();
    // 쿠폰 카테고리 서비스와 매칭 → coupon (자동 적용, 수동 체크 UI 제외)
    const svc = (data?.services||[]).find(s => s.name === p.service_name);
    if (svc) {
      const cat = (data?.categories||[]).find(c => c.id === svc.cat);
      if (cat?.name === '쿠폰') return "coupon";
    }
    if (n.includes("다담권") || n.includes("선불")) return "prepaid";
    if (n.includes("연간") || n.includes("할인권") || n.includes("회원권")) return "annual";
    return "package";
  };
  const _pkgBalance = (p) => {
    const m = (p.note||"").match(/잔액:([0-9,]+)/);
    return m ? Number(m[1].replace(/,/g,"")) : 0;
  };
  // 유효기간 지난 패키지는 차감 대상에서 제외
  const _pkgNotExpired = (p) => {
    const exp = ((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
    if (!exp) return true;
    const today = new Date().toISOString().slice(0,10);
    return exp >= today;
  };
  const activePkgs = custPkgs.filter(p => {
    const t = _pkgType(p);
    if (t === "prepaid") return _pkgBalance(p) > 0 && _pkgNotExpired(p);
    if (t === "annual") return _pkgNotExpired(p);
    return (p.total_count - p.used_count) > 0 && _pkgNotExpired(p);
  });
  // 활성 다회권 목록 (패키지 사용 자동 차감용)
  const activeMultiPkgs = activePkgs.filter(p => _pkgType(p) === "package");

  // 회원가 자격: 선불권(다담권) 중 원 충전금액 50만원 이상을 보유한 경우 (잔액 아님)
  // note 예: "카드:... | 잔액:... | 충전:500,000 | 사용:... | 유효:..."
  const _pkgOriginalCharge = (p) => {
    const m = (p.note||"").match(/충전:([0-9,]+)/);
    if (m) return Number(m[1].replace(/,/g,""));
    // fallback: total_count(다담권은 원 단위) 또는 사용+잔액
    if ((p.total_count||0) > 0) return p.total_count;
    return (p.used_count||0) + _pkgBalance(p);
  };
  const PREPAID_CAT_ID_INNER = "1s18w2l46"; // 선불권 카테고리
  // 회원가 자격: 선불권 충전 ≥ 50만원 OR 연간회원권, 만료된 건 제외
  // 유효기간 없음 = 아직 사용 전 상태 = 유효 (사용 시점에 유효기간 자동 시작)
  const _pkgStillValid = (p) => {
    const exp = ((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
    if (!exp) return true; // 유효기간 미설정 = 사용 전 = 유효
    return exp >= new Date().toISOString().slice(0,10);
  };
  const isMemberPrice = activePkgs.some(p => {
    if (!_pkgStillValid(p)) return false;
    const t = _pkgType(p);
    if (t === "annual") return true;
    if (t === "prepaid") return _pkgOriginalCharge(p) >= 500000;
    return false;
  });

  // 성별+회원가에 따른 기본 가격 계산
  const _defPrice = (svc, g) => {
    if (!g) return (svc.priceF === svc.priceM ? svc.priceF : 0);
    const regular = g === "M" ? svc.priceM : svc.priceF;
    if (!isMemberPrice) return regular;
    const member = g === "M" ? svc.memberPriceM : svc.memberPriceF;
    return member || regular; // 회원가 없으면 정상가
  };

  // State: { [id]: { checked, amount } }
  const [items, setItems] = useState(() => {
    const init = {};
    // selectedServices(신) 우선, 비었으면 serviceId(레거시) fallback
    let selSvcs = reservation?.selectedServices || [];
    if (selSvcs.length === 0 && reservation?.serviceId) selSvcs = [reservation.serviceId];
    SVC_LIST.forEach(svc => {
      const preSelected = selSvcs.includes(svc.id);
      const defPrice = _defPrice(svc, gender);
      init[svc.id] = { checked: preSelected, amount: preSelected ? defPrice : 0 };
    });
    PROD_LIST.forEach(p => { init[p.id] = { checked: false, amount: 0 }; });
    init["discount"] = { checked: false, amount: 0 };
    init["extra_svc"] = { checked: false, amount: 0, label: "" };
    init["extra_prod"] = { checked: false, amount: 0, label: "" };
    return init;
  });

  // 편집 모드: existingDetails에서 items 프리필 (시술/제품/추가/할인)
  const _prefilledFromDetails = useRef(false);
  useEffect(() => {
    if (_prefilledFromDetails.current) return;
    if (!editMode) return;
    const existingDetails = reservation?._prefill?.existingDetails;
    if (!Array.isArray(existingDetails) || existingDetails.length === 0) return;
    _prefilledFromDetails.current = true;

    const extraSvcRows = [];
    const extraProdRows = [];
    let discountAmt = 0;
    const matchedSvcIds = {};  // id → amount
    const matchedProdIds = {};

    existingDetails.forEach(d => {
      const nm = (d.service_name||"").trim();
      if (!nm) return;
      // 보유권 사용 기록 행은 items 프리필에서 제외 (pkgUse 별도 관리)
      if (/^\[보유권/.test(nm)) return;
      // 쿠폰·이벤트 자동적용 행은 items 프리필에서 제외 (쿠폰 엔진 자동 재계산)
      if (/^\[쿠폰 (할인|적립)\]/.test(nm)) return;
      if (/^\[이벤트 (할인|적립)\]/.test(nm)) return;
      // 할인
      if (nm === "할인" || nm === "[할인]" || /^\[할인\]/.test(nm)) {
        discountAmt += (d.unit_price || 0);
        return;
      }
      // 정규 시술 매칭
      const svc = SVC_LIST.find(x => x.name === nm);
      if (svc) { matchedSvcIds[svc.id] = (d.unit_price || 0); return; }
      // 정규 제품 매칭
      const prod = PROD_LIST.find(x => x.name === nm);
      if (prod) { matchedProdIds[prod.id] = (d.unit_price || 0); return; }
      // 추가 시술 (이름에 "시술" 들어가거나 기타)
      if (nm === "추가 시술" || /시술/.test(nm)) { extraSvcRows.push({name:nm, amount: d.unit_price||0}); return; }
      if (nm === "추가 제품" || /제품/.test(nm)) { extraProdRows.push({name:nm, amount: d.unit_price||0}); return; }
      // 기본 fallback: 시술로 간주
      extraSvcRows.push({name:nm, amount: d.unit_price||0});
    });

    setItems(prev => {
      const next = {...prev};
      Object.entries(matchedSvcIds).forEach(([id, amt]) => {
        next[id] = { ...next[id], checked: true, amount: amt };
      });
      Object.entries(matchedProdIds).forEach(([id, amt]) => {
        next[id] = { ...next[id], checked: true, amount: amt };
      });
      if (extraSvcRows.length > 0) {
        const joined = extraSvcRows.map(r=>r.name).join(" + ");
        const sum = extraSvcRows.reduce((s,r)=>s+(r.amount||0),0);
        next.extra_svc = { checked: true, amount: sum, label: joined };
      }
      if (extraProdRows.length > 0) {
        const joined = extraProdRows.map(r=>r.name).join(" + ");
        const sum = extraProdRows.reduce((s,r)=>s+(r.amount||0),0);
        next.extra_prod = { checked: true, amount: sum, label: joined };
      }
      if (discountAmt > 0) next.discount = { checked: true, amount: discountAmt };
      return next;
    });
  }, [editMode, reservation, SVC_LIST.length, PROD_LIST.length]);

  // 다회권 → 시술 목록 최상단에 증감 버튼으로 표시
  // pkgItems: { "pkg__{pkgId}": { qty: 0~N } }
  const [pkgItems, setPkgItems] = useState({});
  // 예약에서 넘어온 pkg__ 항목 또는 다회권 자동 선택
  const pkgAutoSelected = useRef(false);
  useEffect(() => {
    if (pkgAutoSelected.current || activeMultiPkgs.length === 0) return;
    pkgAutoSelected.current = true;
    // 예약에서 넘어온 selectedServices에 pkg__ 항목이 있으면 그걸 사용
    const selSvcs = reservation?.selectedServices || [];
    const pkgFromRes = selSvcs.filter(id => id.startsWith("pkg__"));
    if (pkgFromRes.length > 0) {
      // 예약에서 선택된 패키지를 매칭
      const newPkgItems = {};
      const newPkgUse = {};
      pkgFromRes.forEach(pkgId => {
        const pkgName = pkgId.replace("pkg__","");
        // 이름으로 activeMultiPkgs에서 매칭
        const matched = activeMultiPkgs.find(p => {
          const nm = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
          return nm === pkgName;
        });
        if (matched) {
          newPkgItems["pkg__" + matched.id] = { qty: 1 };
          newPkgUse[matched.id] = 1;
        }
      });
      if (Object.keys(newPkgItems).length > 0) {
        setPkgItems(newPkgItems);
        setPkgUse(prev => ({ ...prev, ...newPkgUse }));
        // 일반 시술은 예약에서 넘어온 것 유지 (pkg__ 제외한 시술)
        return;
      }
    }
    // 예약에 pkg__가 없으면 첫 번째 다회권 자동 선택
    const sorted = [...activeMultiPkgs].sort((a,b) => {
      const ea = ((a.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      const eb = ((b.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      return ea.localeCompare(eb);
    });
    const first = sorted[0];
    if (first) {
      setPkgItems({ ["pkg__" + first.id]: { qty: 1 } });
      setPkgUse(prev => ({ ...prev, [first.id]: 1 }));
      // 예약에서 넘어온 시술 선택은 유지
      const resSvcs = new Set((reservation?.selectedServices || []).filter(id => !id.startsWith("pkg__")));
      if (resSvcs.size === 0) {
        setItems(prev => {
          const next = { ...prev };
          SVC_LIST.forEach(s => { next[s.id] = { checked: false, amount: 0 }; });
          next.extra_svc = { checked: false, amount: 0, label: "" };
          next.discount = { checked: false, amount: 0 };
          return next;
        });
      }
    }
  }, [activeMultiPkgs]);

  // 패키지 수량 변경 (그룹 내 유효기간 빠른 순으로 배분)
  const setPkgQty = (groupName, newQty) => {
    // 해당 그룹의 패키지들
    const groups = {};
    activeMultiPkgs.forEach(p => {
      const name = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
      if (!groups[name]) groups[name] = [];
      groups[name].push(p);
    });
    const pkgs = groups[groupName] || [];
    const sorted = [...pkgs].sort((a,b) => {
      const ea = ((a.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      const eb = ((b.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      return ea.localeCompare(eb);
    });
    // 수량을 유효기간 빠른 패키지부터 배분
    let remain = newQty;
    const newPkgItems = { ...pkgItems };
    const newPkgUse = { ...pkgUse };
    sorted.forEach(p => {
      const avail = (p.total_count||0) - (p.used_count||0);
      const use = Math.min(remain, avail);
      newPkgItems["pkg__" + p.id] = { qty: use };
      newPkgUse[p.id] = use;
      remain -= use;
    });
    setPkgItems(newPkgItems);
    setPkgUse(newPkgUse);
    // 패키지 수량 변경 시 시술 선택은 유지 (독립적)
  };

  const hasPkgChecked = () => Object.values(pkgItems).some(v => (v?.qty||0) > 0);
  const totalPkgQty = () => Object.values(pkgItems).reduce((s,v) => s + (v?.qty||0), 0);

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

  // 신규 다담권/패키지 구매 항목 식별
  const PREPAID_CAT_ID = "1s18w2l46"; // 선불권 카테고리
  const PKG_CAT_ID = "c1fbbbff-"; // PKG (패키지) 카테고리
  const newPrepaidPurchases = SVC_LIST.filter(s => s.cat === PREPAID_CAT_ID && items[s.id]?.checked);
  // PKG 패키지 (왁싱PKG, 토탈PKG 등 — name에서 회수 파싱)
  const newPkgPurchases = SVC_LIST.filter(s => (s.cat === PKG_CAT_ID || /PKG|패키지/i.test(s.name||"")) && s.cat !== PREPAID_CAT_ID && items[s.id]?.checked);
  // 패키지 회수 파싱: "왁싱 PKG 5회" → 5
  const parsePkgCount = (name) => { const m = (name||"").match(/(\d+)\s*회/); return m ? parseInt(m[1]) : 5; };
  // "오늘 차감" 활성화된 다담권의 총 액면가
  const newPrepaidActiveTotal = newPrepaidPurchases.reduce((sum, s) => usePkgToday[s.id] ? sum + (items[s.id]?.amount || 0) : sum, 0);
  // 다담권으로 차감할 일반 시술/제품 합계 (다담권 본인은 제외)
  const todayUseSvcTotal = SVC_LIST.reduce((sum, svc) => {
    if (svc.cat === PREPAID_CAT_ID) return sum; // 다담권 자체는 제외
    return sum + (items[svc.id]?.checked ? items[svc.id].amount : 0);
  }, 0) + (items.extra_svc?.checked ? items.extra_svc.amount : 0);
  // 새 다담권 즉시 차감액 (활성화된 다담권 잔액 한도 내에서만)
  const newPkgInstantDeduct = newPrepaidActiveTotal > 0 ? Math.min(todayUseSvcTotal, newPrepaidActiveTotal) : 0;

  // Totals
  const svcTotal = SVC_LIST.reduce((sum, svc) => sum + (items[svc.id]?.checked ? items[svc.id].amount : 0), 0)
    + (items.extra_svc?.checked ? items.extra_svc.amount : 0);
  const prodTotal = PROD_LIST.reduce((sum, p) => sum + (items[p.id]?.checked ? items[p.id].amount : 0), 0)
    + (items.extra_prod?.checked ? items.extra_prod.amount : 0);
  const discount = items.discount?.checked ? items.discount.amount : 0;
  const naverDeduct = 0; // 통합됨 → externalDeduct에서 처리
  const externalDeduct = externalPrepaid > 0 ? externalPrepaid : 0;
  // 보유권 차감 합산 (다담권만 금액 차감, 다회권은 횟수만 차감 — 금액 영향 없음)
  const pkgDeduct = Object.entries(pkgUse).reduce((sum, [pkgId, val]) => {
    if (!val) return sum;
    const pkg = custPkgs.find(p => p.id === pkgId);
    if (!pkg) return sum;
    const t = _pkgType(pkg);
    if (t === "prepaid" && typeof val === "number" && val > 0) return sum + val;
    return sum;
  }, 0);
  const pointDeduct = Math.min(pointUse||0, pointBalance);

  // ─── 이벤트·프로모 엔진: 체크된 시술의 promoConfig 기반 자동 할인·포인트 적립 ───
  const promoResults = (() => {
    const today = new Date().toISOString().slice(0,10);
    // 신규고객 판정: 매출 이력 0건 (custHasSale useEffect로 DB에서 확인)
    // - custId 없음 → 신규 (아직 미등록 고객)
    // - custId 있어도 매출 한 건도 없으면 → 신규
    const isNewCustomer = !cust.id || !custHasSale;
    const results = [];
    SVC_LIST.forEach(svc => {
      const it = items[svc.id];
      if (!it?.checked || !(it.amount > 0)) return;
      let pc = svc.promoConfig;
      if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch(e) { return; } }
      if (!pc || typeof pc !== "object") return;
      if (pc.validFrom && today < pc.validFrom) return;
      if (pc.validUntil && today > pc.validUntil) return;
      if (pc.minAmount && it.amount < pc.minAmount) return;
      if (Array.isArray(pc.branchIds) && pc.branchIds.length > 0 && !pc.branchIds.includes(selBranch)) return;
      let discount = 0, earn = 0;
      const reasons = [];
      if (isNewCustomer) {
        if (pc.newCustDiscountPct > 0) { const d = Math.round(it.amount * pc.newCustDiscountPct / 100); discount += d; reasons.push(`신규 ${pc.newCustDiscountPct}%`); }
        if (pc.newCustDiscountFlat > 0) { discount += pc.newCustDiscountFlat; reasons.push(`신규 -${pc.newCustDiscountFlat.toLocaleString()}원`); }
      }
      if (isMemberPrice && pc.memberDiscountPct > 0) { const d = Math.round(it.amount * pc.memberDiscountPct / 100); discount += d; reasons.push(`회원 ${pc.memberDiscountPct}%`); }
      if (pc.pointAwardFlat > 0) { earn += pc.pointAwardFlat; reasons.push(`${pc.pointAwardFlat.toLocaleString()}P`); }
      if (pc.pointAwardPct > 0) { const e = Math.round(it.amount * pc.pointAwardPct / 100); earn += e; reasons.push(`${pc.pointAwardPct}%P`); }
      if (discount > 0 || earn > 0) {
        results.push({ svcId: svc.id, name: svc.name, discount, earn, reason: reasons.join(" + "), badgeText: svc.badgeText, badgeColor: svc.badgeColor, badgeBg: svc.badgeBg });
      }
    });
    return results;
  })();
  const promoDiscountTotal = promoResults.reduce((s, r) => s + (r.discount||0), 0);
  const promoEarnTotal = promoResults.reduce((s, r) => s + (r.earn||0), 0);

  // ─── 쿠폰 자동 적용 엔진: 고객 보유 쿠폰 중 autoApply 조건 매칭 → 제품/시술/카테고리/특정시술 합계에서 차감 ───
  const [couponOff, setCouponOff] = useState({}); // {pkgId:true} = 사용자가 체크 해제
  const couponResults = React.useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    const svcByName = new Map((data?.services||[]).map(s => [s.name, s]));
    const list = [];
    const extraSvcAmt = (items.extra_svc?.checked) ? (items.extra_svc.amount||0) : 0;
    const extraProdAmt = (items.extra_prod?.checked) ? (items.extra_prod.amount||0) : 0;
    (custPkgs||[]).forEach(pkg => {
      if (pkg.total_count && pkg.used_count >= pkg.total_count) return;
      const svc = svcByName.get(pkg.service_name);
      if (!svc) return;
      let pc = svc.promoConfig;
      if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch(e) { return; } }
      if (!pc || typeof pc !== "object" || !pc.couponType) return;
      if (pc.autoApply === false) return;
      if (pc.validFrom && today < pc.validFrom) return;
      if (pc.validUntil && today > pc.validUntil) return;
      // 대상 금액
      let baseAmt = 0;
      if (!pc.couponTarget || pc.couponTarget === 'all') {
        SVC_LIST.forEach(s => { const it=items[s.id]; if (it?.checked) baseAmt += it.amount||0; });
        PROD_LIST.forEach(p => { const it=items[p.id]; if (it?.checked) baseAmt += it.amount||0; });
        baseAmt += extraSvcAmt + extraProdAmt;
      } else if (pc.couponTarget === 'products') {
        PROD_LIST.forEach(p => { const it=items[p.id]; if (it?.checked) baseAmt += it.amount||0; });
        baseAmt += extraProdAmt;
      } else if (pc.couponTarget === 'services') {
        SVC_LIST.forEach(s => { const it=items[s.id]; if (it?.checked) baseAmt += it.amount||0; });
        baseAmt += extraSvcAmt;
      } else if (pc.couponTarget === 'category') {
        const catIds = pc.couponTargetCategoryIds || [];
        SVC_LIST.forEach(s => { if (catIds.includes(s.cat)) { const it=items[s.id]; if (it?.checked) baseAmt += it.amount||0; } });
      } else if (pc.couponTarget === 'specific_service') {
        const sids = pc.couponTargetServiceIds || (pc.couponTargetServiceId ? [pc.couponTargetServiceId] : []);
        sids.forEach(sid => { const it=items[sid]; if (it?.checked) baseAmt += it.amount||0; });
      }
      if (baseAmt <= 0) return;
      let discount = 0, earn = 0;
      if (pc.couponType === 'flat') discount = Math.min(pc.couponValue||0, baseAmt);
      else if (pc.couponType === 'percent') discount = Math.round(baseAmt * (pc.couponValue||0) / 100);
      else if (pc.couponType === 'point_bonus_pct') earn = Math.round(baseAmt * (pc.couponValue||0) / 100);
      else if (pc.couponType === 'free_service') {
        const sids = pc.couponTargetServiceIds || (pc.couponTargetServiceId ? [pc.couponTargetServiceId] : []);
        let amt = 0;
        sids.forEach(sid => { const it=items[sid]; if (it?.checked) amt += it.amount||0; });
        discount = amt;
      }
      if (discount <= 0 && earn <= 0) return;
      list.push({
        pkgId: pkg.id, svcId: svc.id, name: svc.name,
        discount, earn, priority: pc.priority ?? 100,
        consumeOnUse: pc.consumeOnUse !== false,
        applyTo: pc.couponTarget || 'all', // products|services|all|category|specific_service
        badgeText: svc.badgeText, badgeColor: svc.badgeColor, badgeBg: svc.badgeBg,
      });
    });
    list.sort((a,b) => (a.priority||100) - (b.priority||100));
    return list;
  }, [custPkgs, data?.services, items]);
  const activeCoupons = couponResults.filter(c => !couponOff[c.pkgId]);
  // 쿠폰 할인을 대상별로 분리 (제품/시술 결제수단 각각 차감용)
  const couponDiscountOnProd = activeCoupons
    .filter(c => c.applyTo === 'products')
    .reduce((s,c)=>s+(c.discount||0), 0);
  const couponDiscountOnSvc = activeCoupons
    .filter(c => c.applyTo === 'services' || c.applyTo === 'category' || c.applyTo === 'specific_service' || c.applyTo === 'all')
    .reduce((s,c)=>s+(c.discount||0), 0);
  const couponDiscountTotal = couponDiscountOnProd + couponDiscountOnSvc;
  const couponEarnTotal = activeCoupons.reduce((s,c)=>s+(c.earn||0), 0);
  // promo + 쿠폰 포인트 적립을 pointEarn에 자동 반영 (유저가 직접 적은 값이 있으면 건드리지 않음)
  const _promoAppliedRef = React.useRef({total:0, userOverride:false});
  useEffect(() => {
    if (_promoAppliedRef.current.userOverride) return;
    const totalAuto = (promoEarnTotal||0) + (couponEarnTotal||0);
    if (_promoAppliedRef.current.total === totalAuto) return;
    _promoAppliedRef.current.total = totalAuto;
    setPointEarn(totalAuto);
  }, [promoEarnTotal, couponEarnTotal]);

  const grandTotal = Math.max(0, svcTotal + prodTotal - discount - promoDiscountTotal - couponDiscountTotal - naverDeduct - externalDeduct - pkgDeduct - newPkgInstantDeduct - pointDeduct);
  // 실제 결제할 금액 (예약금·할인·이벤트·쿠폰·보유권·신규다담권즉시차감 차감)
  const svcPayTotal = Math.max(0, svcTotal - discount - promoDiscountTotal - couponDiscountOnSvc - naverDeduct - externalDeduct - pkgDeduct - newPkgInstantDeduct);
  const prodPayTotal = Math.max(0, prodTotal - couponDiscountOnProd);

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

  const buildSaleDetails = (saleId, orderNum) => {
    // 편집 모드 전용 — 금액은 그대로 기록, 결제수단별 분배는 하지 않음(비율 분배 ❌)
    // 기존 고객의 보유권 수량/종류는 절대 변경하지 않고, 이 매출에 포함된 항목만 기록.
    const list = [];
    let no = 0;
    const nowIso = new Date().toISOString();
    const push = (name, amount, qty) => {
      list.push({
        id: "sd_" + uid(), business_id: _activeBizId,
        sale_id: saleId, order_num: orderNum, service_no: ++no,
        service_name: name, unit_price: amount || 0, qty: qty || 1,
        cash: 0, card: 0, bank: 0, point: 0,
        sex_div: gender || "", created_at: nowIso,
      });
    };
    // 1) 체크한 시술
    SVC_LIST.forEach(svc => {
      const it = items[svc.id];
      if (it?.checked && (it.amount || 0) > 0) push(svc.name, it.amount);
    });
    if (items.extra_svc?.checked && (items.extra_svc.amount || 0) > 0) {
      push(items.extra_svc.label || items.extra_svc.name || "추가 시술", items.extra_svc.amount);
    }
    // 2) 체크한 제품
    PROD_LIST.forEach(p => {
      const it = items[p.id];
      if (it?.checked && (it.amount || 0) > 0) push(p.name, it.amount);
    });
    if (items.extra_prod?.checked && (items.extra_prod.amount || 0) > 0) {
      push(items.extra_prod.label || items.extra_prod.name || "추가 제품", items.extra_prod.amount);
    }
    // 2.5) 할인 — 기록만 (별도 행), 금액은 양수로 저장하고 이름에 [할인] 프리픽스
    if (items.discount?.checked && (items.discount.amount || 0) > 0) {
      push("[할인]", items.discount.amount);
    }
    // 3) 보유 패키지 사용 이력 — 기록만 (고객 보유권은 변경 안 함)
    try {
      Object.entries(pkgUse || {}).forEach(([pkgId, val]) => {
        if (!val) return;
        const pkg = (custPkgs || []).find(p => p.id === pkgId);
        if (!pkg) return;
        const t = _pkgType(pkg);
        const baseName = pkg.service_name || "패키지";
        if (t === "package" && typeof val === "number" && val > 0) {
          // 다회권: 회차 차감 기록 (단가 0원, qty=사용회수)
          push(`[보유권 사용] ${baseName}`, 0, val);
        } else if (t === "prepaid" && typeof val === "number" && val > 0) {
          // 다담권: 잔액 차감 기록 (unit_price = 차감금액, qty=1)
          push(`[보유권 차감] ${baseName}`, val, 1);
        }
      });
    } catch(e) { console.warn("[buildSaleDetails pkgUse]", e); }
    return list;
  };

  const handleSubmit = async (continueAfter = false) => {
    // ── 편집 모드: sale_details 교체 + sales 본체 결제금액·외부선결제·메모 업데이트 ──
    // 보유권 차감, 포인트 거래는 건드리지 않음 (순수 내역 교정 용도)
    if (editMode && existingSaleId) {
      // ─ 금액 변동 경고: 원래 값과 편집 값이 다르면 확인 받음 ─
      const origPay = {
        svcCash: reservation?.svcCash||0, svcTransfer: reservation?.svcTransfer||0,
        svcCard: reservation?.svcCard||0, svcPoint: reservation?.svcPoint||0,
        prodCash: reservation?.prodCash||0, prodTransfer: reservation?.prodTransfer||0,
        prodCard: reservation?.prodCard||0, prodPoint: reservation?.prodPoint||0,
        externalPrepaid: reservation?.externalPrepaid||0,
      };
      const newPay = {
        svcCash: payMethod.svcCash||0, svcTransfer: payMethod.svcTransfer||0,
        svcCard: payMethod.svcCard||0, svcPoint: payMethod.svcPoint||0,
        prodCash: payMethod.prodCash||0, prodTransfer: payMethod.prodTransfer||0,
        prodCard: payMethod.prodCard||0, prodPoint: payMethod.prodPoint||0,
        externalPrepaid: externalPrepaid||0,
      };
      const labelMap = {
        svcCash:"시술현금", svcTransfer:"시술입금", svcCard:"시술카드", svcPoint:"시술포인트",
        prodCash:"제품현금", prodTransfer:"제품입금", prodCard:"제품카드", prodPoint:"제품포인트",
        externalPrepaid:"외부선결제",
      };
      const diffs = [];
      Object.keys(newPay).forEach(k => {
        if ((origPay[k]||0) !== (newPay[k]||0)) {
          diffs.push(`  • ${labelMap[k]}: ${(origPay[k]||0).toLocaleString()} → ${(newPay[k]||0).toLocaleString()}원`);
        }
      });
      const origTotal = Object.entries(origPay).reduce((s,[,v])=>s+(v||0),0);
      const newTotal = Object.entries(newPay).reduce((s,[,v])=>s+(v||0),0);
      if (diffs.length > 0) {
        const totalLine = origTotal !== newTotal
          ? `\n\n💰 총합 변동: ${origTotal.toLocaleString()} → ${newTotal.toLocaleString()}원 (${(newTotal-origTotal>=0?"+":"")}${(newTotal-origTotal).toLocaleString()}원)`
          : `\n\n💰 총합 동일: ${origTotal.toLocaleString()}원 (결제수단만 변동)`;
        if (!confirm(`⚠️ 매출 금액이 원래 등록된 값과 다릅니다.\n\n변경사항:\n${diffs.join("\n")}${totalLine}\n\n이대로 저장하시겠습니까?`)) {
          return; // 유저 취소
        }
      }

      try {
        // 1) 기존 sale_details 삭제 + 새로 생성
        await sb.delWhere("sale_details", "sale_id", existingSaleId);
        const newDetails = buildSaleDetails(existingSaleId, reservation?.orderNum || "");
        if (newDetails.length > 0) {
          await sb.upsert("sale_details", newDetails);
        }
        // 2) sales 본체 업데이트 — 편집 모드:
        //    - 결제수단 금액(svc_cash/card/transfer/point, prod_*) 유저 입력대로 갱신 (원래 누락/오류 교정용)
        //    - 외부선결제, 메모 갱신
        //    - 담당자(staff_id/staff_name) 갱신
        //    - 보유권·포인트 잔액은 건드리지 않음 (기존 거래 유지)
        const newMemo = (externalPrepaid > 0 && externalPlatform ? `[${externalPlatform} 선결제 ${externalPrepaid.toLocaleString()}원] ` : "") + (saleMemo || "");
        const editStaff = (data.staff||[]).find(s => s.id === manager);
        const salesUpdate = {
          svc_cash: payMethod.svcCash || 0, svc_transfer: payMethod.svcTransfer || 0,
          svc_card: payMethod.svcCard || 0, svc_point: payMethod.svcPoint || 0,
          prod_cash: payMethod.prodCash || 0, prod_transfer: payMethod.prodTransfer || 0,
          prod_card: payMethod.prodCard || 0, prod_point: payMethod.prodPoint || 0,
          external_prepaid: externalPrepaid > 0 ? externalPrepaid : 0,
          external_platform: externalPrepaid > 0 ? (externalPlatform || "") : null,
          memo: newMemo,
          staff_id: manager || "",
          staff_name: editStaff?.dn || manager || "",
        };
        await sb.update("sales", existingSaleId, salesUpdate);
        onSubmit({
          id: existingSaleId, _editOnly: true, _newDetails: newDetails,
          _updatedSale: {
            svcCash: salesUpdate.svc_cash, svcTransfer: salesUpdate.svc_transfer,
            svcCard: salesUpdate.svc_card, svcPoint: salesUpdate.svc_point,
            prodCash: salesUpdate.prod_cash, prodTransfer: salesUpdate.prod_transfer,
            prodCard: salesUpdate.prod_card, prodPoint: salesUpdate.prod_point,
            externalPrepaid: salesUpdate.external_prepaid, externalPlatform: salesUpdate.external_platform, memo: salesUpdate.memo,
            staffId: salesUpdate.staff_id, staffName: salesUpdate.staff_name,
          }
        });
        return;
        // (편집 모드는 반복저장 비지원 — 단일 매출 상세 수정 용도)
      } catch (e) {
        alert("상세내역 저장 실패: " + (e?.message || e));
        return;
      }
    }

    // ── 아래부터 신규 매출 저장 (기존 로직) ──
    // 더블클릭/중복 저장 방지 락
    if (_submitLock.current) return;
    _submitLock.current = true;
    // 실패 시 락 해제 (타이밍 여유 있게 3초)
    setTimeout(() => { _submitLock.current = false; }, 3000);

    const isPkgUseSubmit = hasPkgChecked();
    if (svcTotal + prodTotal <= 0 && !isPkgUseSubmit) {
      alert("시술 또는 제품을 선택해주세요.");
      _submitLock.current = false;
      return;
    }
    // grandTotal=0 허용 (보유권 전액 차감 시에도 매출등록 + 패키지 차감 진행)
    if (!manager) {
      alert("시술자를 선택해주세요.");
      _submitLock.current = false;
      return;
    }
    // 고객 이름/연락처 - 마스킹 체크만
    const custName = (cust.name||"").trim();
    const custPhone = (cust.phone||"").trim();
    if (/\*/.test(custName) || /\*/.test(custPhone)) {
      alert("고객 이름이나 연락처에 '*'가 포함되어 있습니다.\n네이버 마스킹 데이터가 아닌 실제 정보를 입력해주세요.");
      _submitLock.current = false;
      return;
    }
    const staff = (data.staff||[]).find(s => s.id === manager);

    // (참고: 동일 금액 기반 중복 판정은 다른 고객이 우연히 같은 금액일 때 오검지 위험이 커서 쓰지 않음.
    //  실제 원인인 "처리 중 두 번 클릭"은 위의 _submitLock + 아래 버튼 disable로 차단.)

    // ── 고객 매칭 자동 보정 ──
    // cust.id 없거나 new_ 접두사일 때, phone으로 기존 고객 찾아 연결 (동명이인 중복 생성 방지)
    if ((!cust.id || cust.id?.startsWith("new_")) && custPhone) {
      const cleanPhone = custPhone.replace(/[^0-9]/g, "");
      if (cleanPhone.length >= 8) {
        const existing = (data?.customers || []).find(c => {
          const p1 = (c.phone || "").replace(/[^0-9]/g, "");
          const p2 = (c.phone2 || "").replace(/[^0-9]/g, "");
          return p1 === cleanPhone || p2 === cleanPhone;
        });
        if (existing) {
          const label = `${existing.name}${existing.custNum ? ` (#${existing.custNum})` : ""}${existing.bid ? ` · ${(data?.branches||[]).find(b=>b.id===existing.bid)?.short || ""}` : ""}`;
          if (confirm(`동일 연락처의 기존 고객이 있습니다:\n\n  ${label}\n\n이 고객으로 연결하시겠습니까?\n\n[확인] 기존 고객에 매출 연결\n[취소] 신규 고객으로 등록`)) {
            cust.id = existing.id;
          }
        }
      }
    }

    // 매출 등록 시 cust_num 할당 (예약 단계에선 할당 안 됨) — next_cust_num RPC 호출
    const fetchNextCustNum = async () => {
      try {
        const { SB_URL, SB_KEY } = await import("../../lib/sb");
        const r = await fetch(`${SB_URL}/rest/v1/rpc/next_cust_num`, {
          method: "POST",
          headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
          body: "{}"
        });
        if (r.ok) {
          const n = await r.json();
          return typeof n === "string" ? n : String(n);
        }
      } catch (e) { console.error("[next_cust_num]", e); }
      return "";
    };

    // 고객 정보 저장 (신규 등록 또는 기존 업데이트)
    // cust.id가 있어도 customers 테이블에 실제로 없으면 신규로 취급 (네이버 예약 등에서 발생)
    const existsInDb = cust.id && (data?.customers||[]).some(c => c.id === cust.id);
    const isNewCust = cust.id?.startsWith("new_") || (!cust.id && custName) || (cust.id && !existsInDb && custName);

    // ── setData 유무와 상관없이 cust.custNum은 반드시 채워야 함 (매출 저장 시 sale.custNum에 들어감) ──
    // 이 로직을 if(setData) 밖으로 빼서, setData 없어도 서버에서 cust_num 확보
    if (cust.id && !cust.custNum) {
      try {
        const rows = await sb.get("customers", cust.id);
        const serverCustNum = rows?.[0]?.cust_num || "";
        if (serverCustNum) cust.custNum = serverCustNum;
      } catch(e) { console.warn("[custNum prefetch]", e); }
    }

    if (setData) {
      if (isNewCust) {
        // new_xxx 접두사(임시 ID)는 새 cust_xxx로 치환 — PK 중복 방지
        let custId = (cust.id && !cust.id.startsWith("new_")) ? cust.id : ("cust_" + uid());

        let serverExists = false;
        let existingCustNum = "";
        try {
          const existRows = await sb.get("customers", custId);
          if (Array.isArray(existRows) && existRows.length > 0) {
            serverExists = true;
            existingCustNum = existRows[0]?.cust_num || "";
          }
        } catch {}

        // 매출 등록 시 cust_num 할당 (없으면 RPC로 새 번호 받아옴)
        const assignedCustNum = existingCustNum || (await fetchNextCustNum());

        const newCustObj = {
          id: custId, bid: selBranch, name: custName, phone: custPhone,
          gender: gender, visits: 1, lastVisit: todayStr(), memo: "",
          custNum: assignedCustNum,
          joinDate: todayStr(),
        };

        if (serverExists) {
          // 기존 DB row → UPDATE (custNum 비어있으면 채워넣기)
          const updates = { name: custName, phone: custPhone, gender: gender, lastVisit: todayStr() };
          if (!existingCustNum && assignedCustNum) updates.custNum = assignedCustNum;
          sb.update("customers", custId, toDb("customers", updates)).catch(console.error);
          setData(prev => ({ ...prev, customers: (prev?.customers||[]).filter(c => c.id !== custId).concat({...newCustObj, ...updates}) }));
        } else {
          // 진짜 신규 insert (cust_num 포함)
          const alreadyExists = (data?.customers||[]).some(c => c.id === custId);
          if (!alreadyExists) {
            // 동일 연락처 중복 체크 → 있으면 사용자에게 confirm
            let proceed = true;
            if (custPhone && custPhone.replace(/[^0-9]/g,'').length >= 8) {
              try {
                const dup = await sb.get("customers", `&business_id=eq.${_activeBizId}&phone=eq.${encodeURIComponent(custPhone)}&limit=3`);
                if (Array.isArray(dup) && dup.length > 0) {
                  const names = dup.map(d => `  ${d.name}${d.cust_num?` (#${d.cust_num})`:""}`).join("\n");
                  const msg = `⚠️ 이 연락처(${custPhone})를 이미 사용 중인 고객이 있습니다:\n\n${names}\n\n같은 분이면 기존 고객을 선택해서 매출 등록하는 걸 권장합니다.\n그래도 신규로 등록할까요?`;
                  proceed = confirm(msg);
                }
              } catch(e) { console.warn("[dup phone check]", e); }
            }
            if (proceed) {
              sb.insert("customers", toDb("customers", newCustObj)).then(() => {
                setData(prev => ({ ...prev, customers: [...(prev?.customers||[]), newCustObj] }));
              }).catch(console.error);
            } else {
              // 사용자가 취소 → 매출 저장 중단
              alert("매출 등록이 취소됐습니다. 기존 고객을 검색해서 다시 시도해주세요.");
              return;
            }
          }
        }
        cust.id = custId;
        cust.custNum = assignedCustNum;
      } else if (cust.id) {
        // 기존 고객 — cust_num 없으면 이번 매출 등록 시 부여
        const localCust = (data?.customers||[]).find(c => c.id === cust.id);
        let assignedCustNum = localCust?.custNum || "";
        if (!assignedCustNum) {
          // 서버에서 재확인 (로컬 없을 수도)
          try {
            const rows = await sb.get("customers", cust.id);
            assignedCustNum = rows?.[0]?.cust_num || "";
          } catch {}
          if (!assignedCustNum) assignedCustNum = await fetchNextCustNum();
        }

        // visits 증가: 로컬값(+Oracle 임포트 값 포함)을 기준으로 +1 → DB에도 반영
        const newVisits = (localCust?.visits || 0) + 1;
        const updates = { name: custName, phone: custPhone, gender: gender, lastVisit: todayStr(), visits: newVisits };
        if (assignedCustNum && !localCust?.custNum) updates.custNum = assignedCustNum;
        // 소속지점 변경 제안: 매출 지점이 고객 현재 소속과 다르면 유저에게 확인
        const curBid = localCust?.bid;
        if (curBid && selBranch && curBid !== selBranch) {
          const curBr = (data?.branches||[]).find(b => b.id === curBid);
          const newBr = (data?.branches||[]).find(b => b.id === selBranch);
          const msg = `📍 ${custName}님 소속 지점이 기존 "${curBr?.short||curBr?.name||curBid}"인데 이번 매출은 "${newBr?.short||newBr?.name||selBranch}"에서 등록됩니다.\n\n소속 지점을 "${newBr?.short||newBr?.name||selBranch}"(으)로 변경하시겠습니까?`;
          if (confirm(msg)) updates.bid = selBranch;
        }
        setData(prev => ({ ...prev, customers: (prev?.customers||[]).map(c => c.id === cust.id ? {...c, ...updates, custNum: assignedCustNum || c.custNum} : c) }));
        sb.update("customers", cust.id, toDb("customers", updates)).catch(console.error);
        cust.custNum = assignedCustNum;
      }
    }
    // ── 보유권 차감 처리 + 히스토리 기록 ──
    const _pkgTxRecords = []; // sale.id를 알아야 하므로 나중에 flush
    Object.entries(pkgUse).forEach(([pkgId, val]) => {
      if (!val) return;
      const pkg = custPkgs.find(p => p.id === pkgId);
      if (!pkg) return;
      const t = _pkgType(pkg);
      if (t === "package" && typeof val === "number" && val > 0) {
        // 다회권: N회 차감
        const prevUsed = pkg.used_count || 0;
        const newUsed = prevUsed + val;
        const totalCnt = pkg.total_count || 0;
        const upd = { used_count: newUsed };
        if (prevUsed === 0 && !(/유효:\d{4}-\d{2}-\d{2}/.test(pkg.note||""))) {
          const exp = new Date(); exp.setFullYear(exp.getFullYear()+1);
          const expStr = exp.toISOString().slice(0,10);
          const n = pkg.note||"";
          upd.note = n.includes("유효:") ? n.replace(/유효:\s*(?!\d)/, `유효:${expStr} `) : (n ? `${n} | 유효:${expStr}` : `유효:${expStr}`);
        }
        sb.update("customer_packages", pkgId, upd).catch(console.error);
        _pkgTxRecords.push({
          package_id: pkgId, service_name: pkg.service_name || "",
          type: "deduct", unit: "count", amount: val,
          balance_before: totalCnt - prevUsed, balance_after: totalCnt - newUsed,
          note: "매출 사용"
        });
      } else if (t === "prepaid" && typeof val === "number" && val > 0) {
        // 다담권: 금액 차감
        const bal = _pkgBalance(pkg);
        const newBal = Math.max(0, bal - val);
        const newSpent = (pkg.used_count || 0) + val;
        let newNote = (pkg.note || "").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
        // 유효기간 없으면 첫 사용 시점부터 1년 자동 설정
        if (!/유효:\s*\d{4}-\d{2}-\d{2}/.test(newNote)) {
          const d = new Date(); d.setFullYear(d.getFullYear()+1);
          const expStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          newNote = newNote ? `${newNote} | 유효:${expStr}` : `유효:${expStr}`;
        }
        sb.update("customer_packages", pkgId, { used_count: newSpent, note: newNote }).catch(console.error);
        _pkgTxRecords.push({
          package_id: pkgId, service_name: pkg.service_name || "",
          type: "deduct", unit: "won", amount: val,
          balance_before: bal, balance_after: newBal,
          note: "매출 차감"
        });
      }
    });

    // 쿠폰 자동 소진: activeCoupons 중 consumeOnUse=true 이면 customer_packages.used_count +1
    activeCoupons.forEach(c => {
      if (!c.consumeOnUse) return;
      const pkg = (custPkgs||[]).find(p => p.id === c.pkgId);
      if (!pkg) return;
      const totalCnt = pkg.total_count || 1;
      const prevUsed = pkg.used_count || 0;
      const newUsed = Math.min(totalCnt, prevUsed + 1);
      sb.update("customer_packages", c.pkgId, { used_count: newUsed }).catch(console.error);
      _pkgTxRecords.push({
        package_id: c.pkgId, service_name: pkg.service_name || "",
        type: "deduct", unit: "count", amount: 1,
        balance_before: totalCnt - prevUsed, balance_after: totalCnt - newUsed,
        note: `쿠폰 자동적용${c.discount>0?` -${c.discount.toLocaleString()}원`:""}${c.earn>0?` +${c.earn.toLocaleString()}P`:""}`
      });
    });

    // 네이버예약금 레거시 호환 (새 매출은 external_prepaid로만 저장)
    const naverPrepaidAmt = 0;

    // ── 신규 다담권 구매 + 오늘 차감 처리 ──
    // 1. 활성화된 다담권 구매 항목별로 customer_packages 생성
    //    - 액면가 = price, 즉시 차감액 = 분배된 today svc deduct
    if (cust.id && newPrepaidPurchases.length > 0) {
      const activePkgs = newPrepaidPurchases.filter(s => usePkgToday[s.id]);
      const activeTotal = activePkgs.reduce((sum, s) => sum + (items[s.id]?.amount || 0), 0);
      newPrepaidPurchases.forEach(svc => {
        const faceVal = items[svc.id]?.amount || 0;
        const isActive = !!usePkgToday[svc.id];
        const deduct = isActive && activeTotal > 0 ? Math.round(newPkgInstantDeduct * (faceVal / activeTotal)) : 0;
        const balance = Math.max(0, faceVal - deduct);
        const newPkgId = uid();
        const newPkg = {
          id: newPkgId, business_id: _activeBizId, customer_id: cust.id,
          service_id: svc.id, service_name: svc.name,
          total_count: 1, used_count: deduct,
          purchased_at: new Date().toISOString(),
          note: `잔액:${balance.toLocaleString()}`,
        };
        sb.insert("customer_packages", newPkg).catch(console.error);
        // 신규 충전
        _pkgTxRecords.push({
          package_id: newPkgId, service_name: svc.name,
          type: "charge", unit: "won", amount: faceVal,
          balance_before: 0, balance_after: faceVal, note: "신규 구매"
        });
        // 즉시 차감
        if (deduct > 0) {
          _pkgTxRecords.push({
            package_id: newPkgId, service_name: svc.name,
            type: "deduct", unit: "won", amount: deduct,
            balance_before: faceVal, balance_after: balance, note: "구매 즉시 차감"
          });
        }
      });
    }

    // ── 신규 PKG 패키지 구매 + 오늘 N회 사용 처리 ──
    if (cust.id && newPkgPurchases.length > 0) {
      newPkgPurchases.forEach(svc => {
        const total = parsePkgCount(svc.name);
        const used = Math.max(0, Math.min(total, Number(usePkgToday[svc.id] || 0)));
        const newPkgId = uid();
        const newPkg = {
          id: newPkgId, business_id: _activeBizId, customer_id: cust.id,
          service_id: svc.id, service_name: svc.name,
          total_count: total, used_count: used,
          purchased_at: new Date().toISOString(),
          note: "",
        };
        sb.insert("customer_packages", newPkg).catch(console.error);
        _pkgTxRecords.push({
          package_id: newPkgId, service_name: svc.name,
          type: "charge", unit: "count", amount: total,
          balance_before: 0, balance_after: total, note: "신규 구매"
        });
        if (used > 0) {
          _pkgTxRecords.push({
            package_id: newPkgId, service_name: svc.name,
            type: "deduct", unit: "count", amount: used,
            balance_before: total, balance_after: total - used, note: "구매 즉시 사용"
          });
        }
      });
    }
    const sale = {
      id: uid(), bid: selBranch,
      custId: cust.id || null, custName: custName,
      custPhone: custPhone, custGender: gender,
      custNum: cust.custNum || cust.cust_num || "",
      staffId: manager, staffName: staff?.dn || "",
      date: reservation?.date || todayStr(),
      serviceId: reservation?.serviceId || null, serviceName: SVC_LIST.find(s => s.id === reservation?.serviceId)?.name || "",
      productId: null, productName: null,
      svcCash: payMethod.svcCash, svcTransfer: payMethod.svcTransfer, svcCard: payMethod.svcCard, svcPoint: payMethod.svcPoint,
      prodCash: payMethod.prodCash, prodTransfer: payMethod.prodTransfer, prodCard: payMethod.prodCard, prodPoint: payMethod.prodPoint,
      gift: 0, orderNum: String(252000 + Math.floor(Math.random() * 200)),
      externalPrepaid: externalPrepaid > 0 ? externalPrepaid : 0,
      externalPlatform: externalPrepaid > 0 ? (externalPlatform || "") : null,
      memo: (isPkgUseSubmit ? "[패키지 사용] " : "") + (externalPrepaid > 0 && externalPlatform ? `[${externalPlatform} 선결제 ${externalPrepaid.toLocaleString()}원] ` : "") + (saleMemo || ""),
      createdAt: new Date().toISOString(),
    };

    // ── sale_details 생성: 수동 등록 툴과 동일한 포맷 (cash/card/bank/point 분배 없음, 결제수단 합계는 sales 테이블에만) ──
    const _saleDetails = [];
    let _detailNo = 0;
    const nowIso = new Date().toISOString();
    const pushDetail = (name, price) => _saleDetails.push({
      id: "sd_" + uid(), business_id: _activeBizId, sale_id: sale.id, order_num: sale.orderNum,
      service_no: ++_detailNo, service_name: name, unit_price: price, qty: 1,
      cash: 0, card: 0, bank: 0, point: 0,
      sex_div: gender || "", created_at: nowIso,
    });
    // 시술
    SVC_LIST.forEach(svc => {
      const it = items[svc.id];
      if (it?.checked && (it.amount || 0) > 0) pushDetail(svc.name, it.amount);
    });
    // 추가 시술
    if (items.extra_svc?.checked && (items.extra_svc.amount || 0) > 0) {
      pushDetail(items.extra_svc.label || items.extra_svc.name || "추가 시술", items.extra_svc.amount);
    }
    // 제품
    PROD_LIST.forEach(p => {
      const it = items[p.id];
      if (it?.checked && (it.amount || 0) > 0) pushDetail(p.name, it.amount);
    });
    // 추가 제품
    if (items.extra_prod?.checked && (items.extra_prod.amount || 0) > 0) {
      pushDetail(items.extra_prod.label || items.extra_prod.name || "추가 제품", items.extra_prod.amount);
    }
    // 할인
    if (items.discount?.checked && (items.discount.amount || 0) > 0) {
      pushDetail("[할인]", items.discount.amount);
    }
    // 이벤트 할인·적립 기록 (promoResults 기반)
    promoResults.forEach(r => {
      if (r.discount > 0) pushDetail(`[이벤트 할인] ${r.name}${r.reason?` (${r.reason})`:""}`, r.discount);
      if (r.earn > 0) pushDetail(`[이벤트 적립] ${r.name}${r.reason?` (${r.reason})`:""}`, r.earn);
    });
    // 쿠폰 자동적용 기록 (activeCoupons 기반)
    activeCoupons.forEach(c => {
      if (c.discount > 0) pushDetail(`[쿠폰 할인] ${c.name}`, c.discount);
      if (c.earn > 0) pushDetail(`[쿠폰 적립] ${c.name}`, c.earn);
    });
    // 보유권 사용 (다회권 차감 횟수 및 다담권 차감 금액) — 수동 등록 툴 포맷과 통일
    // pkgItems: { "pkg__{pkgId}": {qty} }, pkgUse: {pkgId: number|true}
    try {
      // 다회권
      Object.entries(pkgItems||{}).forEach(([pkgKey, v]) => {
        if (!(v?.qty > 0)) return;
        const pkgId = pkgKey.replace(/^pkg__/, "");
        const pkg = custPkgs.find(p => p.id === pkgId);
        const baseName = (pkg?.service_name||"").split("(")[0].replace(/\s*\d+회$/,"").trim() || "다회권";
        pushDetail(`[보유권 사용] ${baseName}`, 0);
      });
      // 다담권 (잔액 차감)
      Object.entries(pkgUse||{}).forEach(([pkgId, v]) => {
        if (typeof v !== "number" || v <= 0) return;
        const pkg = custPkgs.find(p => p.id === pkgId);
        if (!pkg) return;
        const t = _pkgType(pkg);
        if (t !== "prepaid") return; // 다회권은 위에서 처리됨
        const baseName = (pkg?.service_name||"").split("(")[0].trim() || "다담권";
        pushDetail(`[보유권 차감] ${baseName}`, v);
      });
    } catch(e) { console.warn("[sale_details pkgUse]", e); }
    // ── sales → sale_details 순차 insert (FK 의존) ──
    // 부모(ReservationModal/SalesPage)가 중복 insert 하지 않도록 sale 객체에 _alreadySaved 플래그
    try {
      const inserted = await sb.insert("sales", toDb("sales", sale));
      if (!inserted) {
        // sb.insert가 이미 alert 띄움
        return;
      }
    } catch (e) {
      alert("매출 저장 실패: " + (e?.message || e));
      return;
    }
    if (_saleDetails.length > 0) {
      await sb.upsert("sale_details", _saleDetails);
    }

    // 보유권 거래 기록 flush (sale.id 연결)
    if (cust.id && _pkgTxRecords.length > 0) {
      _pkgTxRecords.forEach(r => {
        sb.insert("package_transactions", {
          id: "pkgtx_"+uid(),
          business_id: _activeBizId,
          bid: sale.bid,
          customer_id: cust.id,
          sale_id: sale.id,
          staff_id: sale.staffId,
          staff_name: sale.staffName,
          created_at: new Date().toISOString(),
          ...r
        }).catch(console.error);
      });
    }
    // 포인트 거래 기록 (매출 id를 sale_id로 연결)
    if (cust.id) {
      let balAfter = pointBalance;
      if (pointUse > 0) {
        const usedAmt = Math.min(pointUse, pointBalance);
        balAfter -= usedAmt;
        sb.insert("point_transactions", {
          id: "ptx_"+uid(), business_id: _activeBizId, bid: sale.bid,
          customer_id: cust.id, type: "deduct", amount: usedAmt,
          balance_after: balAfter, sale_id: sale.id, staff_id: sale.staffId,
          staff_name: sale.staffName, note: "매출 결제"
        }).catch(console.error);
      }
      if (pointEarn > 0) {
        balAfter += pointEarn;
        sb.insert("point_transactions", {
          id: "ptx_"+uid(), business_id: _activeBizId, bid: sale.bid,
          customer_id: cust.id, type: "earn", amount: pointEarn,
          balance_after: balAfter, sale_id: sale.id, staff_id: sale.staffId,
          staff_name: sale.staffName, note: "매출 적립"
        }).catch(console.error);
      }
    }
    // _continueAfter: true면 저장 후 모달 유지 + 새 매출 입력 가능하도록 부모에서 리셋
    // _alreadySaved: SaleForm이 이미 sales INSERT 완료 → 부모는 state만 갱신, 중복 insert 금지
    onSubmit({ ...sale, _continueAfter: !!continueAfter, _alreadySaved: true });
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
        width: _m?"100%":780, maxWidth: 780, margin: "0 auto",
        animation: _m?"none":"slideUp .6s cubic-bezier(.22,1,.36,1)", boxShadow: _m?"none":"0 12px 40px rgba(0,0,0,.18)"
      }}>
        {/* Header */}
        <div style={{ padding: "7px 14px", borderBottom: "1px solid #e0e0e0", display: "flex", alignItems: "center", justifyContent: "space-between", background: T.gray100, gap: 8, borderRadius: "12px 12px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: T.danger, flexShrink: 0 }}><I name="diamond" size={14}/> 매출 입력</h3>
            {_visitorDiffers && (
              <div style={{ display: "flex", gap: 0, border: "1px solid " + T.gray400, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                {[
                  { t: "reserver", label: "예약자", name: reservation?.custName, phone: reservation?.custPhone },
                  { t: "visitor", label: "방문자", name: reservation?.visitorName, phone: reservation?.visitorPhone }
                ].map(o => (
                  <button key={o.t} onClick={() => switchSaleTarget(o.t)} title={`${o.name||"-"} ${o.phone||""}`}
                    style={{
                      padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      border: "none", borderRight: o.t === "reserver" ? "1px solid " + T.gray400 : "none",
                      background: saleTargetType === o.t ? T.primary : T.bgCard,
                      color: saleTargetType === o.t ? T.bgCard : T.gray700
                    }}>{o.label}</button>
                ))}
              </div>
            )}
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
              {(() => {
                // 타임라인 기준 그룹핑: 오늘 해당 지점 근무자 상단, 타지점 직원 아래 지점별로
                const staffByBranch = {}; // effBid → [staff,...]
                const offStaff = [];
                (data.staff||[]).forEach(s => {
                  if (!s.dn) return;
                  const st = schHistory?.[s.dn]?.[saleDate];
                  if (st === "휴무" || st === "휴무(꼭)" || st === "무급") { offStaff.push(s); return; }
                  const effBid = getEffectiveBranch(s);
                  if (!staffByBranch[effBid]) staffByBranch[effBid] = [];
                  staffByBranch[effBid].push(s);
                });
                const renderStaff = (s, showBr) => {
                  const br = showBr ? (data.branches||[]).find(b=>b.id===getEffectiveBranch(s)) : null;
                  return <option key={s.id} value={s.id}>{s.dn}{br?` (${br.short||br.name||''})`:''}</option>;
                };
                const currentGroup = staffByBranch[selBranch] || [];
                const otherBranches = (data.branches||[]).filter(b => b.id !== selBranch && staffByBranch[b.id]);
                return <>
                  {currentGroup.length > 0 && <optgroup label={`현재 지점 근무`}>
                    {currentGroup.map(s => renderStaff(s, false))}
                  </optgroup>}
                  {otherBranches.map(br => (
                    <optgroup key={br.id} label={`${br.short||br.name} (타지점)`}>
                      {staffByBranch[br.id].map(s => renderStaff(s, true))}
                    </optgroup>
                  ))}
                  {offStaff.length > 0 && <optgroup label="휴무">
                    {offStaff.map(s => {
                      const br = (data.branches||[]).find(b=>b.id===s.bid);
                      return <option key={s.id} value={s.id}>{s.dn} (휴무{br?`·${br.short||br.name}`:''})</option>;
                    })}
                  </optgroup>}
                </>;
              })()}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <span style={{ color:T.textSub }}>지점</span>
            <select className="inp" style={{ flex:1, minWidth:140, maxWidth:220 }} value={selBranch} onChange={e => setSelBranch(e.target.value)}>
              {(data.branches||[]).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {/* Gender - changeable buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {["F","M"].map(g => <button key={g} onClick={() => { setGender(g); setCust(p=>({...p,gender:g}));
              // 성별 변경 시 체크된 시술 가격 재계산
              setItems(prev => { const next = {...prev}; SVC_LIST.forEach(svc => { if(next[svc.id]?.checked){ next[svc.id] = {...next[svc.id], amount: _defPrice(svc, g)}; } }); return next; });
            }}
              style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: g==="F"?"6px 0 0 6px":"0 6px 6px 0", cursor: "pointer", fontFamily: "inherit", border: "none",
                background: gender === g ? (g==="F" ? "#e5737340" : "#7c7cc840") : T.gray200,
                color: gender === g ? (g==="F" ? T.female : T.info) : T.gray400 }}>{g === "F" ? "여" : "남"}</button>)}
            <span style={{ fontSize: 9, color: isMemberPrice ? T.primary : T.gray400, marginLeft: 2 }}>{gender ? (gender==="F"?"여성":"남성")+(isMemberPrice?" 회원가":" 가격") : "성별 미선택"}{isMemberPrice && " ★"}</span>
          </div>
          {/* Totals */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color:T.textSub }}>시술 <strong style={{ color:T.primary }}>{fmt(svcTotal)}</strong> ({checkedSvc})</span>
            <span style={{ fontSize: 11, color:T.textSub }}>제품 <strong style={{ color: T.info||"#1976D2" }}>{fmt(prodTotal)}</strong> ({checkedProd})</span>
            {discount > 0 && <span style={{ fontSize: 11, color:T.textSub }}>할인 <strong style={{ color: T.female }}>-{fmt(discount)}</strong></span>}
            {externalPrepaid > 0 && <span style={{ fontSize: 11, color:T.textSub }}>{externalPlatform||"외부"} <strong style={{ color: "#8E24AA" }}>-{fmt(externalPrepaid)}</strong></span>}
            <span style={{ fontSize: 17, fontWeight: 900, color: T.danger }}>{fmt(grandTotal)}원</span>
          </div>
        </div>

        {/* Main Body - 2단 레이아웃 */}
        <div style={{display:_m?"block":"flex",flex:1,overflow:"hidden"}}>
        {/* 왼쪽: 시술/제품 */}
        <GridLayout className="sale-grid" cols={2} gap={12} style={{flex:1,overflow:"auto",padding:"10px 14px",alignContent:"start",maxHeight:_m?"none":"70vh",borderRight:_m?"none":"1px solid "+T.border}}>

          {/* Col 1+2: Services by category (span 2 columns) */}
          <div style={{gridColumn:"span 2"}}>
            {/* 다회권 패키지 — 시술과 동일한 UI */}
            {activeMultiPkgs.length > 0 && <div style={{marginBottom:6,border:"1px solid "+T.border,borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:hasPkgChecked()?T.primaryHover:T.gray100}}>
                <span style={{fontSize:13,fontWeight:700,color:hasPkgChecked()?T.primary:T.text}}>📦 보유 패키지{hasPkgChecked()&&<span style={{marginLeft:6,fontSize:11,color:T.primary}}>✓ {totalPkgQty()}회 사용</span>}</span>
              </div>
              <div style={{padding:"4px 0"}}>
              {(()=>{
                const groups = {};
                activeMultiPkgs.forEach(p => {
                  const name = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
                  if (!groups[name]) groups[name] = { name, pkgs: [], totalRemain: 0 };
                  groups[name].pkgs.push(p);
                  groups[name].totalRemain += (p.total_count - p.used_count);
                });
                return Object.values(groups).map(g => {
                  const useQty = g.pkgs.reduce((s,p) => s + (pkgItems["pkg__"+p.id]?.qty||0), 0);
                  const isActive = useQty > 0;
                  return <div key={g.name} className="sale-svc-row"
                    onClick={() => { if (useQty === 0) setPkgQty(g.name, 1); }}
                    style={{display:"flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:4,
                      background:isActive?"#7c7cc810":"transparent",cursor:"pointer",lineHeight:1.4}}>
                    <span style={{flex:1,fontSize:13,color:isActive?T.text:T.gray700,fontWeight:isActive?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                      onClick={e=>{e.stopPropagation(); if(useQty===0) setPkgQty(g.name,1); else setPkgQty(g.name,0);}}>
                      {isActive&&<span style={{color:T.primary,marginRight:3}}>✓</span>}{g.name}
                    </span>
                    <span style={{flexShrink:0,fontSize:10,color:T.gray400}}>{g.totalRemain}회</span>
                    {/* 증감 스테퍼 — 가격 입력 자리 */}
                    <div style={{display:"flex",alignItems:"center",gap:0,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>setPkgQty(g.name, Math.max(0, useQty-1))}
                        style={{width:24,height:24,borderRadius:"5px 0 0 5px",border:"1px solid "+(isActive?T.gray400:T.border),borderRight:"none",
                          background:isActive?T.bgCard:"transparent",color:T.primary,fontSize:14,fontWeight:900,
                          cursor:useQty>0?"pointer":"not-allowed",opacity:useQty>0?1:.4,fontFamily:"inherit",padding:0}}>−</button>
                      <div style={{width:28,height:24,display:"flex",alignItems:"center",justifyContent:"center",
                        border:"1px solid "+(isActive?T.gray400:T.border),borderLeft:"none",borderRight:"none",
                        background:isActive?T.bgCard:"transparent",
                        fontSize:13,fontWeight:isActive?700:400,color:isActive?T.danger:T.gray400}}>{useQty}</div>
                      <button onClick={()=>setPkgQty(g.name, Math.min(g.totalRemain, useQty+1))}
                        style={{width:24,height:24,borderRadius:"0 5px 5px 0",border:"1px solid "+(isActive?T.gray400:T.border),borderLeft:"none",
                          background:isActive?T.bgCard:"transparent",color:T.primary,fontSize:14,fontWeight:900,
                          cursor:useQty<g.totalRemain?"pointer":"not-allowed",opacity:useQty<g.totalRemain?1:.4,fontFamily:"inherit",padding:0}}>+</button>
                    </div>
                  </div>;
                });
              })()}
              </div>
            </div>}
            <div style={{ color:T.primary, padding: "6px 0 4px", marginBottom: 6, fontSize:14, fontWeight:800 }}>시술 ({SVC_LIST.length})</div>
            {catGroups.map(({cat, svcs}) => {
              const isOpen = isCatOpen(cat.id);
              const hasChecked = svcs.some(s=>items[s.id]?.checked);
              return (
              <div key={cat.id} style={{marginBottom:6,border:"1px solid "+T.border,borderRadius:8,overflow:"hidden"}}>
                <div onClick={()=>toggleCat(cat.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",cursor:"pointer",background:hasChecked?T.primaryHover:T.gray100}}>
                  <span style={{fontSize:13,fontWeight:700,color:hasChecked?T.primary:T.text}}>{cat.name}{hasChecked&&<span style={{marginLeft:6,fontSize:11,color:T.primary}}>✓ {svcs.filter(s=>items[s.id]?.checked).length}개 선택</span>}</span>
                  <I name={isOpen?"chevU":"chevD"} size={12} style={{color:T.gray400}}/>
                </div>
                {isOpen && <div style={{padding:"4px 0"}}>{svcs.map(svc => {
                  const it=items[svc.id]||{}; const dp=_defPrice(svc,gender);
                  // 케어 카테고리: 수량 증감 버튼
                  if (cat.id === "cat_care_001" && dp > 0) {
                    const qty = it.qty || (it.checked ? 1 : 0);
                    return <div key={svc.id} style={{display:"flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:4,
                      background:qty>0?"#7c7cc810":"transparent",lineHeight:1.4}}>
                      <span style={{flex:1,fontSize:13,color:qty>0?T.text:T.gray700,fontWeight:qty>0?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {qty>0&&<span style={{color:T.primary,marginRight:3}}>✓</span>}{svc.name}
                      </span>
                      <span style={{flexShrink:0,width:28,textAlign:"right",fontSize:10,color:T.gray400}}>{svc.dur}분</span>
                      <div style={{display:"flex",alignItems:"center",gap:0,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>{
                          const nq=Math.max(0,qty-1);
                          setItems(prev=>({...prev,[svc.id]:{checked:nq>0,amount:dp*nq,qty:nq}}));
                        }} style={{width:24,height:22,borderRadius:"5px 0 0 5px",border:"1px solid "+T.border,borderRight:"none",
                          background:T.bgCard,color:T.primary,fontSize:14,fontWeight:900,cursor:qty>0?"pointer":"not-allowed",opacity:qty>0?1:.4,padding:0,fontFamily:"inherit"}}>−</button>
                        <div style={{width:24,height:22,display:"flex",alignItems:"center",justifyContent:"center",
                          border:"1px solid "+T.border,borderLeft:"none",borderRight:"none",background:T.bgCard,
                          fontSize:13,fontWeight:800,color:qty>0?T.danger:T.gray400}}>{qty}</div>
                        <button onClick={()=>{
                          const nq=qty+1;
                          setItems(prev=>({...prev,[svc.id]:{checked:true,amount:dp*nq,qty:nq}}));
                        }} style={{width:24,height:22,borderRadius:"0 5px 5px 0",border:"1px solid "+T.border,borderLeft:"none",
                          background:T.bgCard,color:T.primary,fontSize:14,fontWeight:900,cursor:"pointer",padding:0,fontFamily:"inherit"}}>+</button>
                      </div>
                      <span style={{width:55,textAlign:"right",fontSize:13,fontWeight:qty>0?700:400,color:qty>0?T.danger:T.gray400,flexShrink:0}}>
                        {qty>0?fmt(dp*qty):(dp||0).toLocaleString()}
                      </span>
                    </div>;
                  }
                  const rp = gender ? (gender==="M" ? svc.priceM : svc.priceF) : 0;
                  return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} regularPrice={rp} toggle={toggle} setAmt={setAmt} badgeText={svc.badgeText} badgeColor={svc.badgeColor} badgeBg={svc.badgeBg} />;
                })}</div>}
              </div>
              );
            })}
            {uncatSvcs.length>0 && <div style={{marginBottom:8}}>
              <div style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:T.textMuted,background:T.bg,borderRadius:T.radius.sm,padding:"2px 6px",marginBottom:2,display:"inline-block"}}>기타</div>
              {uncatSvcs.map(svc => { const it=items[svc.id]||{}; const dp=_defPrice(svc,gender); const rp=gender?(gender==="M"?svc.priceM:svc.priceF):0; return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} regularPrice={rp} toggle={toggle} setAmt={setAmt} badgeText={svc.badgeText} badgeColor={svc.badgeColor} badgeBg={svc.badgeBg} />; })}
            </div>}
            <SaleExtraRow id="extra_svc" color={T.primary} placeholder="추가 시술명 입력" checked={!!(items.extra_svc||{}).checked} amount={(items.extra_svc||{}).amount||0} label={(items.extra_svc||{}).label||""} toggle={toggle} setAmt={setAmt} setLabel={setLabel} />
            <div style={{ marginTop: 4 }}>
              <SaleDiscountRow id="discount" checked={items.discount?.checked} amount={items.discount?.amount||0} toggle={toggle} setAmt={setAmt} />
            </div>
          </div>

          {/* Col 3+4: Products - 아코디언 */}
          <div style={{gridColumn:"span 2"}}>
            <div style={{ color: T.infoLt2, padding: "6px 0 4px", marginBottom: 6, fontSize:14, fontWeight:800 }}>제품 ({PROD_LIST.length})</div>
            <div style={{border:"1px solid "+T.border,borderRadius:8,overflow:"hidden",marginBottom:6}}>
              <div onClick={()=>setOpenCats(p=>({...p,__prod:!isCatOpen("__prod",{...p,__prod:p.__prod},"prod")}))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",cursor:"pointer",background:PROD_LIST.some(p=>items[p.id]?.checked)?T.successLt:T.gray100}}>
                <span style={{fontSize:13,fontWeight:700,color:PROD_LIST.some(p=>items[p.id]?.checked)?T.successDk:T.text}}>
                  제품 전체{PROD_LIST.some(p=>items[p.id]?.checked)&&<span style={{marginLeft:6,fontSize:11,color:T.successDk}}>✓ {PROD_LIST.filter(p=>items[p.id]?.checked).length}개 선택</span>}
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

        {/* 오른쪽: 보유권 + 결제 */}
        <div style={{width:_m?"100%":280,flexShrink:0,overflow:"auto",maxHeight:_m?"none":"70vh",padding:"10px 12px",background:T.bg}}>

          {/* 보유권 잔액 */}
          {cust.id && activePkgs.filter(p=>_pkgType(p)!=="annual").length > 0 && <div style={{background:"#FFF8E1",border:"1px solid #FFD54F",borderRadius:T.radius.md,padding:"10px 12px",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:800,color:"#F57F17",marginBottom:6}}>🎫 보유권</div>
            {(()=>{
              const groups={};
              activePkgs.filter(p=>_pkgType(p)!=="annual").forEach(p=>{
                const t=_pkgType(p); const name=(p.service_name?.split("(")[0]||"").replace(/\s*5회$/,"").trim();
                const key=name+"_"+t;
                if(!groups[key]) groups[key]={name,type:t,totalRemain:0,totalBal:0};
                if(t==="prepaid") groups[key].totalBal+=_pkgBalance(p);
                else groups[key].totalRemain+=(p.total_count-p.used_count);
              });
              return Object.values(groups).map(g=>
                <div key={g.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0"}}>
                  <span style={{fontSize:12,fontWeight:600,color:g.type==="prepaid"?"#E65100":"#3949AB"}}>{g.name}</span>
                  <span style={{fontSize:14,fontWeight:800,color:g.type==="prepaid"?"#E65100":"#3949AB"}}>{g.type==="prepaid"?`+${g.totalBal.toLocaleString()}원`:`+${g.totalRemain}회`}</span>
                </div>
              );
            })()}
          </div>}
          {/* 이벤트·프로모 요약 */}
          {promoResults.length > 0 && <div style={{marginBottom:8,padding:"8px 10px",background:"#fff7ed",borderRadius:T.radius.md,border:"1px solid #fdba74"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:800,color:"#c2410c"}}>🎁 이벤트 자동적용</span>
              {promoDiscountTotal > 0 && <span style={{fontSize:11,fontWeight:700,color:"#c2410c"}}>할인 -{fmt(promoDiscountTotal)}원</span>}
              {promoEarnTotal > 0 && <span style={{fontSize:11,fontWeight:700,color:"#c2410c"}}>적립 +{fmt(promoEarnTotal)}P</span>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {promoResults.map(r => (
                <div key={r.svcId} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#7c2d12"}}>
                  {r.badgeText && <span style={{padding:"1px 6px",borderRadius:8,fontSize:9,fontWeight:700,color:r.badgeColor||"#fff",background:r.badgeBg||T.primary}}>{r.badgeText}</span>}
                  <span style={{fontWeight:600}}>{r.name}</span>
                  <span style={{color:"#9a3412"}}>{r.reason}</span>
                  {r.discount > 0 && <span style={{marginLeft:"auto",fontWeight:700}}>-{fmt(r.discount)}원</span>}
                  {r.earn > 0 && r.discount === 0 && <span style={{marginLeft:"auto",fontWeight:700}}>+{fmt(r.earn)}P</span>}
                </div>
              ))}
            </div>
          </div>}
          {/* 금액 브레이크다운 */}
          <div style={{marginBottom:8,padding:"7px 10px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid #e8e8e8"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:600}}><I name="scissors" size={12}/> 시술 합계</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary}}>{fmt(svcTotal)}원</span>
            </div>
            {prodTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:600}}><I name="pkg" size={12}/> 제품 합계</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.infoLt2}}>{fmt(prodTotal)}원</span>
            </div>}
            {discount > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.female}}><I name="tag" size={11}/> 할인</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.female}}>-{fmt(discount)}원</span>
            </div>}
            {/* 외부 선결제 — 좁은 패널에서 자동 줄바꿈 허용 */}
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"7px 10px",marginTop:4,background:"#F3E5F5",borderRadius:8,border:"1px solid #CE93D8",flexWrap:"wrap",rowGap:6}}>
              <span style={{fontSize:11,color:"#6A1B9A",fontWeight:700,flexShrink:0}}>🏷 선결제</span>
              <select value={externalPlatform} onChange={e=>setExternalPlatform(e.target.value)}
                style={{flex:"1 1 80px",minWidth:70,padding:"4px 4px",fontSize:11,border:"1px solid #CE93D8",borderRadius:6,background:"#fff",color:"#6A1B9A",fontFamily:"inherit"}}>
                <option value="">플랫폼</option>
                {externalPlatforms.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <input type="number" step="5000" value={externalPrepaid||""} placeholder="0" min="0"
                onChange={e=>setExternalPrepaid(Number(e.target.value)||0)}
                style={{flex:"1 1 90px",minWidth:80,padding:"4px 6px",fontSize:11,textAlign:"right",fontWeight:700,color:"#6A1B9A",border:"1px solid #CE93D8",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
              <span style={{fontSize:11,color:"#6A1B9A",fontWeight:700,flexShrink:0}}>원</span>
            </div>
            {/* 포인트 사용 — 결제수단 (적립은 별도 영역) */}
            {cust?.id && <div style={{display:"flex",alignItems:"center",gap:5,padding:"7px 10px",marginTop:4,background:"#FFF3E0",borderRadius:8,border:"1px solid #FFB74D",whiteSpace:"nowrap"}}>
              <span style={{fontSize:11,color:"#E65100",fontWeight:700,flexShrink:0}}>🪙 포인트 <span style={{color:"#999",fontWeight:500,fontSize:10}}>잔{pointBalance.toLocaleString()}</span></span>
              <span style={{fontSize:11,color:"#C62828",fontWeight:700,flexShrink:0,marginLeft:"auto"}}>사용−</span>
              <input type="number" step="100" value={pointUse||""} placeholder="0" min="0" max={pointBalance}
                onChange={e=>setPointUse(Math.max(0,Math.min(pointBalance,Number(e.target.value)||0)))}
                style={{flex:"0 0 80px",padding:"4px 6px",fontSize:11,textAlign:"right",fontWeight:700,color:"#C62828",border:"1px solid #EF9A9A",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
              <span style={{fontSize:11,color:"#E65100",fontWeight:700,flexShrink:0}}>P</span>
            </div>}
            <div style={{borderTop:"2px solid #333",marginTop:6,paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.text}}>{isNaver ? "현장 결제금액" : "총 결제금액"}</span>
              <span style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.danger}}>{fmt(grandTotal)}원</span>
            </div>
          </div>

          {/* 결제수단 분배 */}
          {(svcTotal > 0 || prodTotal > 0 || hasPkgChecked()) && <div className="sale-pay-row" style={{display:"flex",flexDirection:"column",gap:8}}>
            {svcTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:6}}><I name="scissors" size={12}/> 시술 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(svcPayTotal)}원</span></div>
              {activeCoupons.filter(c=>(c.applyTo==='services' || c.applyTo==='all' || c.applyTo==='category' || c.applyTo==='specific_service') && c.discount>0).map(c => (
                <label key={c.pkgId} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 6px",marginBottom:4,background:"#fff8e1",border:"1px solid #f59e0b",borderRadius:6,fontSize:10,color:"#78350f",cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden"}} title={`${c.name}${c.consumeOnUse?" (1회 소진)":""} -${fmt(c.discount)}원`}>
                  <input type="checkbox" checked={!couponOff[c.pkgId]} onChange={e=>setCouponOff(p=>({...p,[c.pkgId]:!e.target.checked}))} style={{accentColor:"#b45309",flexShrink:0}}/>
                  <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flex:"1 1 auto"}}>🎫 {c.name}</span>
                  <span style={{marginLeft:"auto",fontWeight:800,color:"#b45309",flexShrink:0}}>-{fmt(c.discount)}</span>
                </label>
              ))}
              {activeCoupons.filter(c=>c.earn>0).map(c => (
                <div key={`earn-${c.pkgId}`} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:5,background:"#fff8e1",border:"1px solid #f59e0b",borderRadius:6,fontSize:11,color:"#78350f"}}>
                  <span style={{fontWeight:700}}>🎫 {c.name}</span>
                  <span style={{marginLeft:"auto",fontWeight:800,color:"#b45309"}}>+{fmt(c.earn)}P</span>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(110px, 1fr))",gap:6,alignItems:"start"}}>
                {/* 선불잔액 — 다담권/선불권 (카드형, 금액 입력 가능) */}
                {(()=>{
                  const prepaidPkgs = activePkgs.filter(p=>_pkgType(p)==="prepaid").sort((a,b)=>_pkgBalance(b)-_pkgBalance(a));
                  const prepaidBal = prepaidPkgs.reduce((s,p)=>s+_pkgBalance(p),0);
                  if (prepaidBal <= 0) return null;
                  const isActive = prepaidPkgs.some(p=>!!pkgUse[p.id]);
                  const usedAmt = prepaidPkgs.reduce((s,p)=>(pkgUse[p.id]||0)+s,0);
                  const clr = "#E65100", bg = "#FFF3E0";
                  const distributeAmount = (n) => {
                    setPkgUse(prev=>{
                      const next={...prev};
                      let remaining = Math.max(0, Math.min(prepaidBal, n));
                      prepaidPkgs.forEach(p=>{
                        const useAmt = Math.min(_pkgBalance(p), remaining);
                        next[p.id] = useAmt;
                        remaining -= useAmt;
                      });
                      return next;
                    });
                  };
                  const toggle = () => {
                    if (isActive) {
                      // 비활성화 — 모두 0으로
                      setPkgUse(prev=>{const next={...prev};prepaidPkgs.forEach(p=>{next[p.id]=0;});return next;});
                    } else {
                      // 기본 차감: 결제금액과 잔액 중 작은 값
                      distributeAmount(Math.min(prepaidBal, svcPayTotal));
                    }
                  };
                  const editAmount = (raw) => {
                    const n = parseInt(String(raw).replace(/[^0-9]/g,""))||0;
                    distributeAmount(n);
                  };
                  return <div onClick={!isActive?toggle:undefined}
                    style={{display:"flex",flexDirection:"column",gap:4,padding:"6px 8px",borderRadius:T.radius.md,
                      border:isActive?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:isActive?bg:T.gray100,transition:"all .15s",cursor:isActive?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();toggle();}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",
                        fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:isActive?clr:T.gray500,textAlign:"left"}}>
                      {isActive?"☑":"☐"} 선불잔액 <span style={{fontWeight:T.fw.normal,opacity:.7}}>/{fmt(prepaidBal)}</span>
                    </button>
                    <input type="text" inputMode="numeric"
                      value={isActive && usedAmt?fmtAmt(usedAmt):""}
                      placeholder="0"
                      onChange={e=>editAmount(e.target.value)}
                      onClick={(e)=>{e.stopPropagation(); if(!isActive) toggle();}}
                      onFocus={()=>{ if(!isActive) toggle(); }}
                      readOnly={!isActive}
                      style={{width:"100%",minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${isActive?clr:"transparent"}`,
                        color:isActive?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:isActive?T.bgCard:"transparent",
                        opacity:isActive?1:.5}}/>
                  </div>;
                })()}
                {/* 일반 결제수단 카드 */}
                {[
                  {k:"svcCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"svcCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"svcTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=>{
                  const active = !!openPay[k];
                  return <div key={k} onClick={!active?()=>togglePayField(k,svcPayTotal,"svc"):undefined}
                    style={{display:"flex",flexDirection:"column",gap:4,padding:"6px 8px",borderRadius:T.radius.md,
                      border:active?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:active?bg:T.gray100,transition:"all .15s",cursor:active?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();togglePayField(k,svcPayTotal,"svc");}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",
                        fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:active?clr:T.gray500,textAlign:"left"}}>
                      {active?"☑":"☐"} {label}
                    </button>
                    <input type="text" inputMode="numeric"
                      value={active && payMethod[k]?fmtAmt(payMethod[k]):""}
                      placeholder="0"
                      onChange={e=>editPay(k,e.target.value,svcPayTotal,"svc")}
                      onClick={(e)=>{e.stopPropagation(); if(!active) togglePayField(k,svcPayTotal,"svc");}}
                      onFocus={()=>{ if(!active) togglePayField(k,svcPayTotal,"svc"); }}
                      readOnly={!active || primaryPay.svc===k}
                      style={{width:"100%",minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${active?clr:"transparent"}`,
                        color:active?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:active?(primaryPay.svc===k?T.bg:T.bgCard):"transparent",
                        opacity:active?1:.5}}/>
                  </div>;
                })}
              </div>
            </div>}
            {prodTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.infoLt2,marginBottom:6}}><I name="pkg" size={12}/> 제품 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(prodPayTotal)}원</span></div>
              {activeCoupons.filter(c=>c.applyTo==='products' && c.discount>0).map(c => (
                <label key={c.pkgId} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 6px",marginBottom:4,background:"#fff8e1",border:"1px solid #f59e0b",borderRadius:6,fontSize:10,color:"#78350f",cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden"}} title={`${c.name}${c.consumeOnUse?" (1회 소진)":""} -${fmt(c.discount)}원`}>
                  <input type="checkbox" checked={!couponOff[c.pkgId]} onChange={e=>setCouponOff(p=>({...p,[c.pkgId]:!e.target.checked}))} style={{accentColor:"#b45309",flexShrink:0}}/>
                  <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flex:"1 1 auto"}}>🎫 {c.name}</span>
                  <span style={{marginLeft:"auto",fontWeight:800,color:"#b45309",flexShrink:0}}>-{fmt(c.discount)}</span>
                </label>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(110px, 1fr))",gap:6,alignItems:"start"}}>
                {[
                  {k:"prodCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"prodCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"prodTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=>{
                  const active = !!openPay[k];
                  return <div key={k} onClick={!active?()=>togglePayField(k,prodPayTotal,"prod"):undefined}
                    style={{display:"flex",flexDirection:"column",gap:4,padding:"6px 8px",borderRadius:T.radius.md,
                      border:active?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:active?bg:T.gray100,transition:"all .15s",cursor:active?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();togglePayField(k,prodPayTotal,"prod");}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",
                        fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:active?clr:T.gray500,textAlign:"left"}}>
                      {active?"☑":"☐"} {label}
                    </button>
                    <input type="text" inputMode="numeric"
                      value={active && payMethod[k]?fmtAmt(payMethod[k]):""}
                      placeholder="0"
                      onChange={e=>editPay(k,e.target.value,prodPayTotal,"prod")}
                      onClick={(e)=>{e.stopPropagation(); if(!active) togglePayField(k,prodPayTotal,"prod");}}
                      onFocus={()=>{ if(!active) togglePayField(k,prodPayTotal,"prod"); }}
                      readOnly={!active || primaryPay.prod===k}
                      style={{width:"100%",minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${active?clr:"transparent"}`,
                        color:active?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:active?(primaryPay.prod===k?T.bg:T.bgCard):"transparent",
                        opacity:active?1:.5}}/>
                  </div>;
                })}
              </div>
            </div>}
          </div>}
          {pkgDeduct > 0 && <div style={{marginTop:6,fontSize:13,fontWeight:T.fw.black,color:"#E65100",background:"#FFF3E0",borderRadius:T.radius.md,padding:"6px 12px"}}>선불잔액 차감: -{pkgDeduct.toLocaleString()}원</div>}
          {/* 신규 다담권 구매 + 오늘 차감 토글 */}
          {newPrepaidPurchases.length > 0 && todayUseSvcTotal > 0 && <div style={{marginTop:6,padding:"8px 12px",background:"#FFFBEB",border:"1.5px dashed #F59E0B",borderRadius:T.radius.md}}>
            <div style={{fontSize:11,fontWeight:T.fw.bolder,color:"#B45309",marginBottom:6}}>💡 다담권 구매 + 오늘 시술 즉시 차감</div>
            {newPrepaidPurchases.map(svc => {
              const on = !!usePkgToday[svc.id];
              const faceVal = items[svc.id]?.amount || 0;
              return <div key={svc.id} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:12}}>
                <input type="checkbox" checked={on} onChange={e=>setUsePkgToday(p=>({...p, [svc.id]: e.target.checked}))} style={{cursor:"pointer"}}/>
                <span style={{flex:1,fontWeight:on?700:500}}>{svc.name}</span>
                <span style={{color:"#B45309",fontWeight:700}}>{faceVal.toLocaleString()}원</span>
              </div>;
            })}
            {newPkgInstantDeduct > 0 && <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid #FCD34D",fontSize:12,fontWeight:700,color:"#B45309"}}>
              오늘 시술 차감: -{newPkgInstantDeduct.toLocaleString()}원 → 다담권 잔액으로 적립됩니다
            </div>}
          </div>}
          {/* 신규 PKG 패키지 구매 + 오늘 N회 사용 (증감) */}
          {newPkgPurchases.length > 0 && <div style={{marginTop:6,padding:"8px 12px",background:"#EEF2FF",border:"1.5px dashed #6366F1",borderRadius:T.radius.md}}>
            <div style={{fontSize:11,fontWeight:T.fw.bolder,color:"#4338CA",marginBottom:6}}>📦 패키지 구매 + 오늘 사용 (− / + 로 증감)</div>
            {newPkgPurchases.map(svc => {
              const used = Number(usePkgToday[svc.id] || 0);
              const total = parsePkgCount(svc.name);
              const remain = total - used;
              const setUsed = (n) => setUsePkgToday(p => ({...p, [svc.id]: Math.max(0, Math.min(total, n))}));
              return <div key={svc.id} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:12}}>
                <span style={{flex:1,fontWeight:used>0?700:500}}>{svc.name}</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <button onClick={()=>setUsed(used-1)} disabled={used<=0}
                    style={{width:22,height:22,border:"1px solid "+T.border,background:used<=0?T.gray100:"#fff",borderRadius:4,fontSize:13,fontWeight:700,cursor:used<=0?"not-allowed":"pointer",fontFamily:"inherit"}}>−</button>
                  <span style={{minWidth:32,textAlign:"center",fontWeight:700,color:"#4338CA"}}>{used}회</span>
                  <button onClick={()=>setUsed(used+1)} disabled={used>=total}
                    style={{width:22,height:22,border:"1px solid "+T.border,background:used>=total?T.gray100:"#fff",borderRadius:4,fontSize:13,fontWeight:700,cursor:used>=total?"not-allowed":"pointer",fontFamily:"inherit"}}>+</button>
                </div>
                <span style={{color:"#4338CA",fontWeight:700,minWidth:60,textAlign:"right"}}>잔여 {remain}/{total}회</span>
              </div>;
            })}
          </div>}
          {hasPkgChecked() && <div style={{marginTop:6,fontSize:13,fontWeight:800,color:T.primary,background:T.primaryHover,borderRadius:T.radius.md,padding:"8px 12px",border:"1px solid "+T.border}}>
            📦 패키지 {totalPkgQty()}회 차감
            {(()=>{
              const groups = {};
              activeMultiPkgs.forEach(p => {
                const name = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
                if (!groups[name]) groups[name] = { name, totalRemain: 0, useQty: 0 };
                groups[name].totalRemain += (p.total_count||0) - (p.used_count||0);
                groups[name].useQty += (pkgItems["pkg__"+p.id]?.qty||0);
              });
              return Object.values(groups).filter(g=>g.useQty>0).map(g=>
                <div key={g.name} style={{fontSize:11,fontWeight:600,color:T.textSub,marginTop:2}}>
                  {g.name} — {g.useQty}회 차감 ({g.totalRemain}→{g.totalRemain-g.useQty}회)
                </div>
              );
            })()}
          </div>}
          {grandTotal > 0 && <div style={{fontSize:9,color:T.gray400,marginTop:6}}>결제수단 클릭 → 전액 / 추가 클릭 → 분배</div>}
          {/* 포인트 적립 — 이번 매출로 고객에게 적립할 포인트 (결제와 무관) */}
          {cust?.id && <div style={{display:"flex",alignItems:"center",gap:5,padding:"7px 10px",marginTop:8,background:"#E8F5E9",borderRadius:8,border:"1px solid #A5D6A7",whiteSpace:"nowrap"}}>
            <span style={{fontSize:11,color:"#2E7D32",fontWeight:700,flexShrink:0}}>⭐ 포인트 적립</span>
            <input type="number" step="100" value={pointEarn||""} placeholder="0" min="0"
              onChange={e=>setPointEarn(Math.max(0,Number(e.target.value)||0))}
              style={{flex:1,minWidth:60,padding:"4px 6px",fontSize:11,textAlign:"right",fontWeight:700,color:"#2E7D32",border:"1px solid #A5D6A7",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
            <span style={{fontSize:11,color:"#2E7D32",fontWeight:700,flexShrink:0}}>P</span>
          </div>}
          {/* 매출 메모 */}
          <div style={{marginTop:8}}>
            <span style={{fontSize:11,color:T.textMuted,fontWeight:600}}>매출 메모</span>
            <textarea className="inp" ref={el=>{if(el){el.style.height="auto";el.style.height=Math.max(120,el.scrollHeight)+"px";}}}
              value={saleMemo} onChange={e=>{setSaleMemo(e.target.value);const t=e.target;t.style.height="auto";t.style.height=Math.max(120,t.scrollHeight)+"px";}}
              placeholder="매출 메모" style={{resize:"vertical",width:"100%",fontSize:T.fs.sm,minHeight:120,marginTop:4,lineHeight:1.6}}/>
          </div>
        </div>
        </div>{/* 2단 레이아웃 끝 */}

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid #e0e0e0", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", background: T.gray100, flexWrap: "wrap", borderRadius: "0 0 12px 12px" }}>
          <div style={{ fontSize: 10, color: T.gray400, flex: "1 1 200px" }}>
            {gender ? (gender === "F" ? "여성" : "남성") + " 가격 적용" : "성별 미선택"} · 체크한 항목만 매출 반영
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <Btn variant="secondary" onClick={onClose}>취소</Btn>
            {!editMode && (
              <Btn variant="ghost" style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700 }} onClick={()=>handleSubmit(true)} title="저장한 뒤 입력폼이 초기화되어 연속으로 매출을 등록할 수 있습니다">
                <I name="plus" size={12}/> 저장 후 계속
              </Btn>
            )}
            <Btn variant="primary" style={{ padding: "10px 20px", fontSize: 13, fontWeight: 800 }} onClick={()=>handleSubmit(false)}>
              <I name="wallet" size={12}/> 매출 등록 ({fmt(grandTotal)}원){hasPkgChecked() && ` +📦${totalPkgQty()}회`}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
