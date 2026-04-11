import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { fromDb, toDb, _activeBizId } from '../../lib/db'
import { todayStr, genId } from '../../lib/utils'
import I from '../common/I'

const uid = genId;

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

const SaleSvcRow = React.memo(function SaleSvcRow({ id, name, dur, checked, amount, defPrice, toggle, setAmt }) {
  const disabled = defPrice === 0;
  const [localAmt, setLocalAmt] = useState(amount || "");
  useEffect(() => { setLocalAmt(amount || ""); }, [checked]);
  return (
    <div className="sale-svc-row" onClick={() => !disabled && !checked && toggle(id, defPrice)}
      style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 4,
        background: checked ? "#7c7cc810" : "transparent", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, transition: "background .15s", lineHeight: 1.4 }}>
      <span onClick={e => { e.stopPropagation(); if(!disabled) toggle(id, defPrice); }}
        className="sale-svc-name" style={{ flex: 1, fontSize: 13, color: checked ? T.text : T.gray700, fontWeight: checked ? 700 : 400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
        {checked && <span style={{color:T.primary,marginRight:3}}>✓</span>}{name}
      </span>
      <span className="sale-dur" style={{ flexShrink: 0, width: 28, textAlign: "right", whiteSpace:"nowrap", fontSize: 10, color: T.gray400 }}>{dur}분</span>
      <input type="number" step="5000" value={checked ? localAmt : ""} placeholder={disabled ? "—" : (defPrice||0).toLocaleString()}
        onClick={e => e.stopPropagation()}
        onChange={e => setLocalAmt(e.target.value)} onBlur={e => setAmt(id, e.target.value)} disabled={!checked}
        style={{ width: 76, padding: "2px 5px", fontSize: 13, textAlign: "right", borderRadius: 5, flexShrink: 0, minHeight: 0, height: 24, boxSizing: "border-box", fontFamily: "inherit", outline: "none",
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
      <input className="inp" type="number" step="5000" value={checked ? localAmt : ""} placeholder="0"
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
      <input className="inp" type="number" step="5000" value={localAmt} placeholder="0"
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
    <input className="inp" type="number" step="5000" value={checked ? localAmt : ""} placeholder="0"
      onClick={e => e.stopPropagation()}
      onChange={e => { setLocalAmt(e.target.value); setAmt(id, e.target.value); }} disabled={!checked}
      style={{ width: 72, padding: "4px 6px", fontSize: 11, textAlign: "right", borderRadius: 6,
        background: checked ? T.bgCard : "transparent", border: `1px solid ${checked ? T.gray400 : T.border}`,
        color: checked ? T.danger : T.gray400, fontWeight: checked ? 700 : 400 }} />
  </div>;
});

// DETAILED SALE FORM (매출 입력 - 시술상품/제품 연동)
// ═══════════════════════════════════════════
export function DetailedSaleForm({ reservation, branchId, onSubmit, onClose, data, setData }) {
  const fmt = (v) => v==null?"":Number(v).toLocaleString();
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
    try {
      const svcs = (data?.services||[]).filter(s=>s.cat===catId);
      return svcs.some(s=>items?.[s.id]?.checked);
    } catch(e) { return false; }
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
    const timer = setTimeout(async () => {
      const q = custSearch.trim();
      try {
        const bizId = _activeBizId || "biz_khvurgshb";
        const enc = encodeURIComponent(q);
        // name/name2/phone/phone2/email/cust_num OR 검색 (부분 일치)
        const filter = `&business_id=eq.${bizId}&or=(name.ilike.*${enc}*,name2.ilike.*${enc}*,phone.ilike.*${q}*,phone2.ilike.*${q}*,email.ilike.*${enc}*,cust_num.ilike.*${enc}*)&limit=20`;
        const rows = await sb.get("customers", filter);
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
  // 고객 보유권 (다회권/다담권/연간할인권)
  const [custPkgs, setCustPkgs] = useState([]);
  const [pkgUse, setPkgUse] = useState({}); // {pkgId: true(다회권체크) 또는 금액(다담권)}
  // 초기 로드: 예약에서 넘어온 고객
  useEffect(() => {
    const cid = reservation?.custId || cust?.id;
    if (cid) {
      sb.get("customer_packages", `&customer_id=eq.${cid}`).then(rows => setCustPkgs(rows||[])).catch(()=>{});
    } else if (reservation?.custPhone) {
      // custId 없으면 전화번호로 고객 찾아서 보유권 조회
      const phone = reservation.custPhone;
      const bizId = data?.business?.id || _activeBizId;
      sb.get("customers", `&phone=eq.${phone}&business_id=eq.${bizId}&limit=1`).then(rows => {
        if (rows?.length) {
          setCust(prev => ({...prev, id: rows[0].id}));
          sb.get("customer_packages", `&customer_id=eq.${rows[0].id}`).then(pkgs => setCustPkgs(pkgs||[])).catch(()=>{});
        }
      }).catch(()=>{});
    }
  }, []);
  const _pkgType = (p) => {
    const n = (p.service_name||"").toLowerCase();
    if (n.includes("다담권") || n.includes("선불") || n.includes("10%추가적립")) return "prepaid";
    if (n.includes("연간") || n.includes("할인권") || n.includes("회원권")) return "annual";
    return "package";
  };
  const _pkgBalance = (p) => {
    const m = (p.note||"").match(/잔액:([0-9,]+)/);
    return m ? Number(m[1].replace(/,/g,"")) : 0;
  };
  const activePkgs = custPkgs.filter(p => {
    const t = _pkgType(p);
    if (t === "prepaid") return _pkgBalance(p) > 0;
    if (t === "annual") return true;
    return (p.total_count - p.used_count) > 0;
  });

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
  // 보유권 차감 합산 (다회권: 시술가격, 다담권: 입력 금액)
  const pkgDeduct = Object.entries(pkgUse).reduce((sum, [pkgId, val]) => {
    if (!val) return sum;
    const pkg = custPkgs.find(p => p.id === pkgId);
    if (!pkg) return sum;
    const t = _pkgType(pkg);
    if (t === "package" && val === true) return sum + svcTotal; // 다회권: 시술 전액
    if (t === "prepaid" && typeof val === "number") return sum + val;
    return sum;
  }, 0);
  const grandTotal = Math.max(0, svcTotal + prodTotal - discount - naverDeduct - pkgDeduct);
  // 실제 결제할 금액 (예약금·할인·보유권 차감)
  const svcPayTotal = Math.max(0, svcTotal - discount - naverDeduct - pkgDeduct);
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
    if (svcTotal + prodTotal <= 0) {
      alert("시술 또는 제품을 선택해주세요.");
      return;
    }
    // grandTotal=0 허용 (보유권 전액 차감 시에도 매출등록 + 패키지 차감 진행)
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
    // ── 보유권 차감 처리 ──
    Object.entries(pkgUse).forEach(([pkgId, val]) => {
      if (!val) return;
      const pkg = custPkgs.find(p => p.id === pkgId);
      if (!pkg) return;
      const t = _pkgType(pkg);
      if (t === "package" && val === true) {
        // 다회권: 1회 차감
        const newUsed = (pkg.used_count || 0) + 1;
        sb.update("customer_packages", pkgId, { used_count: newUsed }).catch(console.error);
      } else if (t === "prepaid" && typeof val === "number" && val > 0) {
        // 다담권: 금액 차감
        const bal = _pkgBalance(pkg);
        const newBal = Math.max(0, bal - val);
        const newSpent = (pkg.used_count || 0) + val;
        const newNote = (pkg.note || "").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
        sb.update("customer_packages", pkgId, { used_count: newSpent, note: newNote }).catch(console.error);
      }
    });

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
        width: _m?"100%":780, maxWidth: 780, margin: "0 auto",
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

        {/* Main Body - 2단 레이아웃 */}
        <div style={{display:_m?"block":"flex",flex:1,overflow:"hidden"}}>
        {/* 왼쪽: 시술/제품 */}
        <GridLayout className="sale-grid" cols={2} gap={12} style={{flex:1,overflow:"auto",padding:"10px 14px",alignContent:"start",maxHeight:_m?"none":"70vh",borderRight:_m?"none":"1px solid "+T.border}}>

          {/* Col 1+2: Services by category (span 2 columns) */}
          <div style={{gridColumn:"span 2"}}>
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
                {isOpen && <div style={{padding:"4px 0"}}>{svcs.map(svc => { const it=items[svc.id]||{}; const dp=gender?(gender==="M"?svc.priceM:svc.priceF):(svc.priceF===svc.priceM?svc.priceF:0); return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} toggle={toggle} setAmt={setAmt} />; })}</div>}
              </div>
              );
            })}
            {uncatSvcs.length>0 && <div style={{marginBottom:8}}>
              <div style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:T.textMuted,background:T.bg,borderRadius:T.radius.sm,padding:"2px 6px",marginBottom:2,display:"inline-block"}}>기타</div>
              {uncatSvcs.map(svc => { const it=items[svc.id]||{}; const dp=gender?(gender==="M"?svc.priceM:svc.priceF):(svc.priceF===svc.priceM?svc.priceF:0); return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} toggle={toggle} setAmt={setAmt} />; })}
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
            {isNaver && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",marginTop:2}}>
              <span style={{fontSize:T.fs.sm,color:T.orange}}><I name="naver" size={11}/> 네이버 예약금</span>
              <div style={{display:"flex",alignItems:"center",gap:T.sp.xs}}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>-</span>
                <input className="inp" type="number" step="5000" value={naverPrepaid||""} placeholder="0"
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
          {(svcTotal > 0 || prodTotal > 0) && <div className="sale-pay-row" style={{display:"flex",gap:T.sp.lg,flexWrap:"wrap"}}>
            {svcTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:6}}><I name="scissors" size={12}/> 시술 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(svcPayTotal)}원</span></div>
              <div style={{display:"flex",gap:T.sp.xs,flexWrap:"wrap"}}>
                {/* 보유권 버튼 - 같은 이름 합산 */}
                {(()=>{
                  const groups = {};
                  activePkgs.filter(p=>_pkgType(p)!=="annual").forEach(p=>{
                    const t=_pkgType(p); const name=(p.service_name?.split("(")[0]||"").replace(/\s*5회$/,"").trim();
                    const key=name+"_"+t;
                    if(!groups[key]) groups[key]={name,type:t,ids:[],totalRemain:0,totalBal:0};
                    groups[key].ids.push(p.id);
                    if(t==="prepaid") groups[key].totalBal+=_pkgBalance(p);
                    else groups[key].totalRemain+=(p.total_count-p.used_count);
                  });
                  return Object.values(groups).map(g=>{
                    const isActive=g.ids.some(id=>!!pkgUse[id]);
                    const label=g.type==="prepaid"?`🎫 ${g.name} +${g.totalBal.toLocaleString()}`:`🎟 ${g.name} +${g.totalRemain}`;
                    return <button key={g.ids[0]} onClick={()=>{
                      if(g.type==="package") {
                        // 유효기간 있는 것 1개만 토글 (1회 차감)
                        const sorted=[...g.ids].sort((a,b)=>{
                          const pa=activePkgs.find(p=>p.id===a), pb=activePkgs.find(p=>p.id===b);
                          const ea=((pa?.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
                          const eb=((pb?.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
                          return ea.localeCompare(eb);
                        });
                        setPkgUse(prev=>{
                          const anyActive=sorted.some(id=>!!prev[id]);
                          const next={...prev};
                          sorted.forEach(id=>{next[id]=false;}); // 전부 해제
                          if(!anyActive && sorted[0]) next[sorted[0]]=true; // 첫 번째만 활성
                          return next;
                        });
                      }
                      if(g.type==="prepaid") {
                        setPkgUse(prev=>{
                          const anyActive=g.ids.some(id=>!!prev[id]);
                          const next={...prev};
                          g.ids.forEach(id=>{next[id]=anyActive?0:Math.min(_pkgBalance(activePkgs.find(p=>p.id===id)),svcPayTotal);});
                          return next;
                        });
                      }
                    }}
                    style={{padding:"6px 14px",fontSize:13,fontWeight:T.fw.black,borderRadius:T.radius.xl,cursor:"pointer",fontFamily:"inherit",transition:"all .2s",
                      border:isActive?"2px solid #E65100":"2px solid #FFB74D",
                      background:isActive?"linear-gradient(135deg,#FF9800,#F57C00)":"linear-gradient(135deg,#FFF8E1,#FFE0B2)",
                      color:isActive?"#fff":"#E65100",
                      boxShadow:isActive?"0 2px 8px rgba(245,124,0,.35)":"none",
                      transform:isActive?"scale(1.05)":"scale(1)"}}>{label}</button>;
                  });
                })()}
                {/* 일반 결제수단 */}
                {[
                  {k:"svcCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"svcCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"svcTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=><div key={k} style={{display:"flex",alignItems:"center",gap:3}}>
                  <button onClick={()=>togglePayField(k,svcPayTotal,"svc")}
                    style={{padding:"5px 10px",fontSize:T.fs.xxs,fontWeight:T.fw.bolder,borderRadius:T.radius.md,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",
                      border:openPay[k]?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:openPay[k]?bg:T.gray100,color:openPay[k]?clr:T.gray500}}>{label}</button>
                  {openPay[k] && <input className="inp" type="number" step="5000" value={payMethod[k]||""} placeholder="0"
                    onChange={e=>editPay(k,e.target.value,svcPayTotal,"svc")}
                    readOnly={primaryPay.svc===k}
                    style={{width:75,padding:"4px 6px",fontSize:T.fs.sm,textAlign:"right",border:`1.5px solid ${clr}`,color:clr,fontWeight:T.fw.bolder,borderRadius:T.radius.md,
                      background:primaryPay.svc===k?T.bg:T.bgCard}}/>}
                </div>)}
              </div>
            </div>}
            {prodTotal > 0 && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
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
                  {openPay[k] && <input className="inp" type="number" step="5000" value={payMethod[k]||""} placeholder="0"
                    onChange={e=>editPay(k,e.target.value,prodPayTotal,"prod")}
                    readOnly={primaryPay.prod===k}
                    style={{width:75,padding:"4px 6px",fontSize:T.fs.sm,textAlign:"right",border:`1.5px solid ${clr}`,color:clr,fontWeight:T.fw.bolder,borderRadius:T.radius.md,
                      background:primaryPay.prod===k?T.bg:T.bgCard}}/>}
                </div>)}
              </div>
            </div>}
          </div>}
          {pkgDeduct > 0 && <div style={{marginTop:6,fontSize:13,fontWeight:T.fw.black,color:"#E65100",background:"#FFF3E0",borderRadius:T.radius.md,padding:"6px 12px"}}>🎫 보유권 차감: -{pkgDeduct.toLocaleString()}원</div>}
          {grandTotal > 0 && <div style={{fontSize:9,color:T.gray400,marginTop:6}}>결제수단 클릭 → 전액 / 추가 클릭 → 분배</div>}
          {/* 매출 메모 */}
          <div style={{marginTop:8}}>
            <textarea className="inp" rows={2} value={saleMemo} onChange={e=>setSaleMemo(e.target.value)}
              placeholder="매출 메모" style={{resize:"vertical",width:"100%",fontSize:T.fs.sm}}/>
          </div>
        </div>
        </div>{/* 2단 레이아웃 끝 */}

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
