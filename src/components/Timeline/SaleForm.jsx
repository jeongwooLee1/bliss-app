import React, { useState, useEffect, useRef, useCallback } from 'react'
import { T, SCH_BRANCH_MAP } from '../../lib/constants'
import { sb, buildTokenSearch, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { fromDb, toDb, _activeBizId } from '../../lib/db'
import { todayStr, genId, getPkgPurchaseBranchShort, canUsePkgAtBranch } from '../../lib/utils'
import { applyEvents } from '../../lib/eventEngine'
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

const SaleSvcRow = React.memo(function SaleSvcRow({ id, name, dur, checked, amount, defPrice, regularPrice, toggle, setAmt, badgeText, badgeColor, badgeBg, comped, toggleComped, needsGender, onAlert, hasCoupon }) {
  const disabled = defPrice === 0;
  const isMember = regularPrice > 0 && regularPrice > defPrice;
  const handleClick = () => {
    if (needsGender) { (onAlert || alert)("성별을 먼저 선택해주세요\n(시술 가격이 남녀 다릅니다)"); return; }
    if (disabled) return;
    toggle(id, defPrice);
  };
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if(!editing) setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  // 한 박스에 셀 분리: [이름 | 분 | 금액]
  const rowBg = comped ? "#FFF3E0" : (checked ? (T.primaryLt || "#EEF2FF") : "#F3F4F6");
  const rowBorder = comped ? "#E65100" : (checked ? T.primary : "#E5E7EB");
  const cellDiv = "1px solid rgba(0,0,0,.05)";
  return (
    <div className="sale-svc-row" onClick={handleClick}
      style={{display:"flex",alignItems:"stretch",margin:"2px 0",borderRadius:5,overflow:"hidden",
        background:rowBg,border:`1px solid ${rowBorder}`,opacity:disabled?0.55:1,
        cursor:(disabled && !needsGender)?"not-allowed":"pointer",transition:"all .15s",lineHeight:1.4}}>
      {/* 이름 셀 */}
      <div style={{flex:1,padding:"3px 8px",fontSize:13,color:checked?T.text:T.gray700,fontWeight:checked?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:4,minWidth:0}}>
        {checked && <span style={{color:T.primary}}>✓</span>}
        <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
        {isMember && <span style={{fontSize:9,color:T.primary,fontWeight:700,flexShrink:0}}>회원</span>}
        {hasCoupon && <span title="고객 보유 쿠폰 적용 가능" style={{fontSize:9,color:"#b45309",background:"#fff8e1",border:"1px solid #f59e0b",padding:"1px 5px",borderRadius:8,fontWeight:700,flexShrink:0}}>🎫 쿠폰</span>}
        {badgeText && <span style={{fontSize:9,color:badgeColor||"#fff",background:badgeBg||T.primary,padding:"1px 5px",borderRadius:8,fontWeight:700,flexShrink:0}}>{badgeText}</span>}
        {checked && toggleComped && (
          <button type="button" onClick={e => { e.stopPropagation(); toggleComped(id); }}
            title={comped ? "체험단 제공 (클릭 해제)" : "체험단으로 제공 (무료)"}
            style={{flexShrink:0,padding:"1px 5px",fontSize:10,border:`1px solid ${comped?"#E65100":T.border}`,
              background:comped?"#fff":"transparent",color:comped?"#E65100":T.gray400,
              borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontWeight:comped?700:400,lineHeight:1,marginLeft:4}}>
            🎁{comped?" 체험":""}
          </button>
        )}
      </div>
      {/* 분 셀 */}
      <div style={{width:42,padding:"3px 6px",borderLeft:cellDiv,fontSize:10,color:checked?T.text:T.gray500,fontWeight:checked?600:400,display:"flex",alignItems:"center",justifyContent:"flex-end",flexShrink:0}}>
        {dur}분
      </div>
      {/* 금액 셀 (입력 가능) */}
      <div style={{width:110,padding:"2px 4px",borderLeft:cellDiv,display:"flex",alignItems:"center",flexShrink:0}}>
        {isMember && <span style={{fontSize:9,color:T.gray400,textDecoration:"line-through",marginRight:2}}>{(regularPrice||0).toLocaleString()}</span>}
        <input type="text" inputMode="numeric" value={checked ? localAmt : ""} placeholder={disabled?"—":(defPrice||0).toLocaleString()}
          onClick={e => e.stopPropagation()} onFocus={()=>setEditing(true)}
          onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); setLocalAmt(raw?Number(raw).toLocaleString():""); }}
          onBlur={e => { setEditing(false); setAmt(id, parseAmt(e.target.value)); }} disabled={!checked}
          style={{width:"100%",padding:"2px 4px",fontSize:13,textAlign:"right",border:"none",outline:"none",background:"transparent",
            color:comped?"#E65100":(checked?T.danger:T.gray400),fontWeight:checked?700:400,
            textDecoration:comped?"line-through":"none",fontFamily:"inherit",minWidth:0}}/>
      </div>
    </div>
  );
});

// 수량 구간 가격 DP 계산 — 옵션 B (다음 묶음이 더 싸면 자동 업그레이드)
function calcTieredPrice(qty, tiers, fallbackPrice) {
  const list = Array.isArray(tiers) ? tiers.filter(t => t && t.qty > 0 && t.price >= 0) : [];
  if (!list.length || qty <= 0) return (fallbackPrice||0) * qty;
  const bundle = {};
  list.forEach(t => { bundle[t.qty] = t.price; });
  const sizes = Object.keys(bundle).map(Number).sort((a,b)=>a-b);
  // DP for exact qty (구성 가능한 최저가)
  const dp = new Array(qty + 1).fill(Infinity);
  dp[0] = 0;
  for (let i = 1; i <= qty; i++) {
    for (const s of sizes) {
      if (s <= i && dp[i-s] !== Infinity) dp[i] = Math.min(dp[i], dp[i-s] + bundle[s]);
    }
  }
  let best = dp[qty];
  // 옵션 B: 큰 묶음이 더 싸면 자동 업그레이드 (1장 보너스 등)
  for (const s of sizes) {
    if (s > qty && bundle[s] < best) best = bundle[s];
  }
  return best === Infinity ? (fallbackPrice||0) * qty : best;
}

const SaleProdRow = React.memo(function SaleProdRow({ id, name, price, priceTiers, checked, amount, qty, toggle, setAmt, setQty, comped, toggleComped }) {
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if(!editing) setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  const _qty = qty || (checked ? 1 : 0);
  const _calcAmt = (q) => calcTieredPrice(q, priceTiers, price);
  const dec = (e) => { e.stopPropagation(); if (!checked || _qty <= 1) return; const nq = _qty - 1; setQty(id, nq); setAmt(id, _calcAmt(nq)); };
  const inc = (e) => { e.stopPropagation(); if (!checked) { toggle(id, _calcAmt(1)); return; } const nq = _qty + 1; setQty(id, nq); setAmt(id, _calcAmt(nq)); };
  const _hasTiers = Array.isArray(priceTiers) && priceTiers.length > 1;
  const _baseAmt = (price||0) * _qty;
  const _bundleApplied = _hasTiers && checked && amount > 0 && amount < _baseAmt;
  // 박스 셀 분리 (시술과 통일): [이름 | 수량 | 금액]
  const rowBg = comped ? "#FFF3E0" : (checked ? (T.primaryLt || "#EEF2FF") : "#F3F4F6");
  const rowBorder = comped ? "#E65100" : (checked ? T.primary : "#E5E7EB");
  const cellDiv = "1px solid rgba(0,0,0,.05)";
  return (
    <div className="sale-svc-row" onClick={() => toggle(id, _calcAmt(1))}
      style={{display:"flex",alignItems:"stretch",margin:"2px 0",borderRadius:5,overflow:"hidden",
        background:rowBg,border:`1px solid ${rowBorder}`,cursor:"pointer",transition:"all .15s",lineHeight:1.4}}>
      {/* 이름 셀 */}
      <div style={{flex:1,padding:"3px 8px",fontSize:13,color:checked?T.text:T.gray700,fontWeight:checked?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:4,minWidth:0}}>
        {checked && <span style={{color:T.primary}}>✓</span>}
        <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
        {_bundleApplied && <span style={{fontSize:9,fontWeight:800,padding:"1px 5px",background:"#10B981",color:"#fff",borderRadius:3,flexShrink:0}} title={`낱개 ${_baseAmt.toLocaleString()}원 → 묶음 ${amount.toLocaleString()}원`}>묶음</span>}
        {checked && toggleComped && (
          <button type="button" onClick={e => { e.stopPropagation(); toggleComped(id); }}
            title={comped ? "체험단 제공 (클릭 해제)" : "체험단으로 제공 (무료)"}
            style={{flexShrink:0,padding:"1px 5px",fontSize:10,border:`1px solid ${comped?"#E65100":T.border}`,
              background:comped?"#fff":"transparent",color:comped?"#E65100":T.gray400,
              borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontWeight:comped?700:400,lineHeight:1,marginLeft:4}}>
            🎁{comped?" 체험":""}
          </button>
        )}
      </div>
      {/* 수량 셀 (체크 시만) */}
      {checked ? (
        <div style={{display:"flex",alignItems:"center",gap:0,flexShrink:0,borderLeft:cellDiv,background:T.bgCard}} onClick={e=>e.stopPropagation()}>
          <button type="button" onClick={dec} disabled={_qty<=1} title="수량 -"
            style={{width:22,height:"100%",padding:0,border:"none",background:"transparent",color:_qty<=1?T.gray300:T.text,cursor:_qty<=1?"default":"pointer",fontSize:14,fontWeight:700,lineHeight:1,fontFamily:"inherit"}}>−</button>
          <span style={{minWidth:18,textAlign:"center",fontSize:12,fontWeight:700,color:T.text,padding:"0 2px"}}>{_qty}</span>
          <button type="button" onClick={inc} title="수량 +"
            style={{width:22,height:"100%",padding:0,border:"none",background:"transparent",color:T.text,cursor:"pointer",fontSize:14,fontWeight:700,lineHeight:1,fontFamily:"inherit"}}>+</button>
        </div>
      ) : (
        <div style={{width:42,padding:"3px 6px",borderLeft:cellDiv,fontSize:10,color:T.gray500,display:"flex",alignItems:"center",justifyContent:"flex-end",flexShrink:0}}>x{_qty||1}</div>
      )}
      {/* 금액 셀 */}
      <div style={{width:95,padding:"2px 4px",borderLeft:cellDiv,display:"flex",alignItems:"center",flexShrink:0}}>
        <input type="text" inputMode="numeric" value={checked ? localAmt : ""} placeholder={price ? price.toLocaleString() : "0"}
          onClick={e => e.stopPropagation()} onFocus={()=>setEditing(true)}
          onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); setLocalAmt(raw?Number(raw).toLocaleString():""); }}
          onBlur={e => { setEditing(false); setAmt(id, parseAmt(e.target.value)); }} disabled={!checked}
          style={{width:"100%",padding:"2px 4px",fontSize:13,textAlign:"right",border:"none",outline:"none",background:"transparent",
            color:comped?"#E65100":(checked?T.danger:T.gray400),fontWeight:checked?700:400,
            textDecoration:comped?"line-through":"none",fontFamily:"inherit",minWidth:0}}/>
      </div>
    </div>
  );
});

const SaleExtraRow = React.memo(function SaleExtraRow({ id, color, placeholder, checked, amount, label, toggle, setAmt, setLabel }) {
  const [localLabel, setLocalLabel] = useState(label || "");
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  useEffect(() => { setLocalAmt(fmtAmt(amount)); }, [checked]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 4px", flex:1 }}>
      <span onClick={() => toggle(id, 0)}
        style={{ fontSize: 12, color: checked ? T.danger : T.gray500, fontWeight: 700, flexShrink: 0, cursor: "pointer", width:42 }}>
        {checked ? "✓ 추가" : "+ 추가"}
      </span>
      <input value={localLabel} onChange={e => setLocalLabel(e.target.value)}
        onBlur={e => setLabel(id, e.target.value)}
        placeholder={placeholder} style={{ flex: 1, padding: "0 6px", fontSize: 12, height:24, boxSizing:"border-box", background: T.bgCard, border:"1px solid "+T.border, borderRadius: 5, fontFamily:"inherit", outline:"none" }} />
      <input type="text" inputMode="numeric" value={localAmt} placeholder="0"
        onChange={e => { const raw=e.target.value.replace(/[^0-9]/g,""); const v=raw?Number(raw).toLocaleString():""; setLocalAmt(v); setAmt(id, parseAmt(raw)); if(!checked && parseAmt(raw)>0) toggle(id, 0); }}
        style={{ width: 95, padding: "0 6px", fontSize: 12, height:24, boxSizing:"border-box", textAlign: "right", borderRadius: 5,
          border: `1px solid ${checked ? T.gray400 : T.border}`, fontFamily:"inherit", outline:"none",
          color: checked ? T.danger : T.gray500, fontWeight: checked ? 700 : 400 }} />
    </div>
  );
});

const SaleDiscountRow = React.memo(function SaleDiscountRow({ id, checked, amount, toggle, setAmt }) {
  const [localAmt, setLocalAmt] = useState(fmtAmt(amount));
  useEffect(() => { setLocalAmt(fmtAmt(amount)); }, [amount, checked]);
  // SaleExtraRow와 동일한 폭/사이즈 — 시각 일관성 (이름 자리에 비활성 안내 input)
  return <div
    style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 4px", flex:1, minWidth: 0,
      background: checked ? "#e8a0a010" : "transparent", transition: "background .15s", borderRadius: 5 }}>
    <span onClick={() => toggle(id, 0)}
      style={{ fontSize: 12, color: checked ? T.female : T.gray500, fontWeight: 700, flexShrink: 0, cursor: "pointer", width:42 }}>
      {checked ? "✓ 할인" : "− 할인"}
    </span>
    <input value="" disabled placeholder="(할인 사유 — 메모에 기록)"
      style={{ flex: 1, padding: "0 6px", fontSize: 12, height:24, boxSizing:"border-box",
        background:"#f5f5f5", border:"1px solid "+T.border, borderRadius: 5, fontFamily:"inherit", outline:"none",
        color: T.gray400 }} />
    <input type="text" inputMode="numeric" value={localAmt} placeholder="0"
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, "");
        const v = raw ? Number(raw).toLocaleString() : "";
        setLocalAmt(v);
        const n = parseAmt(raw);
        setAmt(id, n);
        if (n > 0 && !checked) toggle(id, n);
        else if (n === 0 && checked) toggle(id, 0);
      }}
      style={{ width: 95, padding: "0 6px", fontSize: 12, height:24, boxSizing:"border-box", textAlign: "right", borderRadius: 5, flexShrink: 0,
        border: `1px solid ${checked ? T.female : T.border}`, fontFamily:"inherit", outline:"none",
        color: checked ? T.danger : T.gray500, fontWeight: checked ? 700 : 400 }} />
  </div>;
});

// DETAILED SALE FORM (매출 입력 - 시술상품/제품 연동)
// ═══════════════════════════════════════════
export function DetailedSaleForm({ reservation, branchId, userBranches, onSubmit, onClose, data, setData, editMode, existingSaleId, viewOnly }) {
  const fmt = (v) => v==null?"":Number(v).toLocaleString();
  // 더블클릭/중복 저장 방지 락 (신규 매출 저장 경로에서 사용)
  const _submitLock = useRef(false);
  // 커스텀 alert (브라우저 alert 대체) — Bliss UI 통일
  const [alertMsg, setAlertMsg] = useState(null);
  const showAlert = (msg) => setAlertMsg(msg);
  // 통합 추가/할인 타입 토글 (시술 or 제품)
  const [extraType, setExtraType] = useState("svc");
  const [discountType, setDiscountType] = useState("svc");
  // 판매중단(isActive=false) 상품은 숨김, 단 편집모드에서 기존 등록된 항목은 유지
  // 쿠폰·포인트 카테고리 ID 목록 (매출등록 구매대상에서 제외 — 증정/사용 대상이지 구매 대상이 아님)
  const _excludedCatIds = (data?.categories || []).filter(c => c.name === '쿠폰' || c.name === '포인트').map(c => c.id);
  const SVC_LIST = (data?.services || []).filter(s => s.isActive !== false && !_excludedCatIds.includes(s.cat)).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const PROD_LIST = (data?.products || []).filter(p => p.isActive !== false);
  const CATS = (data?.categories || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
  const branchStaff = (data.staff||[]).filter(s => s.bid === branchId);
  const [manager, setManager] = useState(reservation?.staffId || "");
  // ── 직원의 매출 날짜 실제 근무지점 (schHistory의 "지원(X)" 상태 반영) ──
  const saleDate = reservation?.date || todayStr();
  const [schHistory, setSchHistory] = useState(null);
  const [empOverride, setEmpOverride] = useState({});
  const [employeesV1, setEmployeesV1] = useState({});  // {empName: {branch, isMale, ...}}
  const [maleRotation, setMaleRotation] = useState({}); // {empId: {branches:[], startDate}}
  // ESC 키로 닫기 (id_dh0tp9v5ue 수정요청)
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !e.isComposing) onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  useEffect(() => {
    // schedule_data는 created_at 컬럼이 없어 sb.get 기본 정렬이 400 에러 → 직접 fetch
    fetch(`${SB_URL}/rest/v1/schedule_data?key=in.(schHistory_v1,empOverride_v1,employees_v1,maleRotation_v1)&select=key,value`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    }).then(r => r.ok ? r.json() : []).then(rows => {
      try {
        const parseVal = (raw) => typeof raw === "string" ? JSON.parse(raw) : raw;
        const schRow = rows.find(r => r.key === 'schHistory_v1');
        const ovRow = rows.find(r => r.key === 'empOverride_v1');
        const empRow = rows.find(r => r.key === 'employees_v1');
        const rotRow = rows.find(r => r.key === 'maleRotation_v1');
        if (schRow) {
          const obj = parseVal(schRow.value);
          if (obj) {
            const merged = {};
            Object.values(obj).forEach(month => {
              if (typeof month !== "object" || !month) return;
              Object.entries(month).forEach(([emp, days]) => {
                if (!merged[emp]) merged[emp] = {};
                Object.assign(merged[emp], days);
              });
            });
            setSchHistory(merged);
          }
        }
        if (ovRow) {
          const obj = parseVal(ovRow.value);
          if (obj && typeof obj === 'object') setEmpOverride(obj);
        }
        if (empRow) {
          const obj = parseVal(empRow.value);
          // employees_v1 은 array 형태: [{id, name, branch, isMale, ...}, ...]
          // 이름 → 정보 dict로 변환해 lookup 편하게
          const dict = {};
          if (Array.isArray(obj)) {
            obj.forEach(e => { if (e?.name || e?.id) dict[e.name || e.id] = e; });
          } else if (obj && typeof obj === 'object') {
            Object.assign(dict, obj);
          }
          setEmployeesV1(dict);
        }
        if (rotRow) {
          const obj = parseVal(rotRow.value);
          if (obj && typeof obj === 'object') setMaleRotation(obj);
        }
      } catch(e) {}
    }).catch(() => {});
  }, []);

  // 남자직원 주간 로테이션: 이번 주 어느 지점인지 계산
  const getRotationBranchId = (empName, dateStr) => {
    const rot = maleRotation[empName];
    if (!rot?.branches?.length || !rot.startDate) return null;
    const start = new Date(rot.startDate);
    const target = new Date(dateStr);
    const diffDays = Math.floor((target - start) / (1000*60*60*24));
    const weekIdx = Math.floor(diffDays / 7);
    const idx = ((weekIdx % rot.branches.length) + rot.branches.length) % rot.branches.length;
    const brKey = rot.branches[idx];
    return SCH_BRANCH_MAP[brKey] || null;
  };
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
  // augmentedStaff: data.staff(=db.rooms 기반)에 employees_v1의 남자 로테이션 직원 합치기
  // db.rooms에 없는 재윤/주용 같은 케이스를 시술자 드롭다운/저장 lookup에서 사용 가능하게 함
  const augmentedStaff = React.useMemo(() => {
    const base = data.staff || [];
    const existingNames = new Set(base.map(s => s.dn).filter(Boolean));
    const extras = [];
    Object.entries(employeesV1 || {}).forEach(([empName, info]) => {
      if (!info?.isMale) return;
      if (existingNames.has(empName)) return;
      const rotBid = getRotationBranchId(empName, saleDate);
      const fallbackBid = info.branch ? (SCH_BRANCH_MAP[info.branch] || info.branch) : "";
      extras.push({ id: empName, dn: empName, bid: rotBid || fallbackBid || "" });
    });
    return [...base, ...extras];
  }, [data.staff, employeesV1, maleRotation, saleDate]);
  const allStaff = augmentedStaff.filter(s => s.bid); // 전체 직원
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
  const _isEditOrView = editMode || viewOnly;
  // 결제수단 통합: 편집 모드 로드 시 prod_* 값을 svc_*로 합쳐서 단일 결제박스에 표시
  const [payMethod, setPayMethod] = useState(() => _isEditOrView && reservation ? {
    svcCash: (reservation.svcCash||0) + (reservation.prodCash||0),
    svcCard: (reservation.svcCard||0) + (reservation.prodCard||0),
    svcTransfer: (reservation.svcTransfer||0) + (reservation.prodTransfer||0),
    svcPoint: (reservation.svcPoint||0) + (reservation.prodPoint||0),
    prodCash: 0, prodCard: 0, prodTransfer: 0, prodPoint: 0,
  } : { svcCash:0, svcCard:0, svcTransfer:0, svcPoint:0, prodCash:0, prodCard:0, prodTransfer:0, prodPoint:0 });
  const [openPay, setOpenPay] = useState(() => _isEditOrView && reservation ? {
    svcCard: ((reservation.svcCard||0) + (reservation.prodCard||0)) > 0,
    svcCash: ((reservation.svcCash||0) + (reservation.prodCash||0)) > 0,
    svcTransfer: ((reservation.svcTransfer||0) + (reservation.prodTransfer||0)) > 0,
    prodCard: false, prodCash: false, prodTransfer: false,
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
  // 체험단 태그 감지 — 예약태그에 "체험" 또는 "체험단" 포함 시 🎁 체험 토글 노출
  const hasCompedTag = !!(
    (reservation?.selectedTags||[]).some(tid => {
      const tag = (data?.serviceTags||[]).find(t=>t.id===tid);
      return tag && /체험/.test(tag.name);
    })
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
  // 보유권 + 쉐어 고객 보유권 함께 로드
  const _loadPkgsWithShares = async (custId) => {
    if (!custId) return;
    try {
      // 쉐어 관계
      const [asA, asB] = await Promise.all([
        sb.get("customer_shares", `&cust_id_a=eq.${custId}`).catch(()=>[]),
        sb.get("customer_shares", `&cust_id_b=eq.${custId}`).catch(()=>[]),
      ]);
      const sharedIds = [
        ...(asA||[]).map(r => r.cust_id_b),
        ...(asB||[]).map(r => r.cust_id_a),
      ];
      const allIds = [custId, ...sharedIds];
      const pkgs = await sb.get("customer_packages", `&customer_id=in.(${allIds.join(",")})`);
      // 쉐어 보유권 표시용 메타 추가 (이름 + 성별 — id_nfv71exl14: 남녀 요금차 계산용)
      let sharedMeta = {};
      if (sharedIds.length) {
        try {
          const custRows = await sb.get("customers", `&id=in.(${sharedIds.join(",")})&select=id,name,gender`);
          (custRows||[]).forEach(c => { sharedMeta[c.id] = { name: c.name, gender: c.gender||"" }; });
        } catch {}
      }
      // 쉐어 패키지: 본인 소유 패키지는 전부 포함, 타인 소유는 note에 "쉐어:Y" 플래그 있는 것만
      // ⚠️ 구매지점 필터는 여기서 하지 않음 — 타지점에서도 회원가 자격 판정용으로 보유권은 전부 로드.
      //    사용/차감 시점(activePkgs)에서 canUsePkgAtBranch로 필터링.
      const marked = (pkgs||[])
        .filter(p => {
          if (p.customer_id === custId) return true; // 본인 것은 전부 포함
          return /\|\s*쉐어:Y|^쉐어:Y/.test(p.note||""); // 타인 소유는 쉐어 플래그 필수
        })
        .map(p => ({
          ...p,
          _shared_from: p.customer_id !== custId ? (sharedMeta[p.customer_id]?.name || "쉐어") : null,
          _owner_gender: p.customer_id !== custId ? (sharedMeta[p.customer_id]?.gender || "") : null,
        }));
      setCustPkgs(marked);
    } catch(e) {
      // fallback: 본인만
      sb.get("customer_packages", `&customer_id=eq.${custId}`)
        .then(rows => setCustPkgs(rows||[]))
        .catch(()=>setCustPkgs([]));
    }
  };

  const selectCust = (c) => {
    setCust({ id: c.id, name: c.name, phone: c.phone, gender: c.gender || "" });
    setGender(c.gender || "");
    setCustSearch(""); setShowCustDrop(false);
    if (c.id) _loadPkgsWithShares(c.id);
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

  // ── 신규 다담권 자동 우선차감 ref (실제 useEffect는 items 선언 이후 — TDZ 방지) ──
  const _autoPrepaidActivatedRef = React.useRef(false);

  // ── 포인트 잔액 + 적립/사용 입력 ──
  const [pointBalance, setPointBalance] = useState(0);
  const [pointEarn, setPointEarn] = useState(0);
  const [pointUse, setPointUse] = useState(0);
  const [issueCouponIds, setIssueCouponIds] = useState({}); // 매출과 함께 수동 발행할 쿠폰 {svcId: count}
  const [couponsOpen, setCouponsOpen] = useState(false); // 쿠폰 발행 아코디언 — 기본 접힘
  const pointEarnManualRef = React.useRef(false); // 사용자가 수동 수정했는지
  // 📸 viewOnly 매출확인: 매출 등록 시점 스냅샷이 있으면 그걸 그대로 사용 (현재 잔액 조회 차단)
  const _snapshotData = viewOnly ? (reservation?._existingSale?.snapshotData || reservation?._existingSale?.snapshot_data) : null;
  useEffect(() => {
    if (_snapshotData) {
      setCustPkgs(_snapshotData.custPkgs || []);
      setPointBalance(typeof _snapshotData.pointBalance === 'number' ? _snapshotData.pointBalance : 0);
    }
  }, [viewOnly, _snapshotData]);

  useEffect(() => {
    if (_snapshotData) return; // 스냅샷 우선
    if (!cust?.id) { setPointBalance(0); return; }
    sb.get("point_transactions", `&customer_id=eq.${cust.id}&limit=500`)
      .then(rows => {
        const now = Date.now();
        const bal = (rows||[]).reduce((s,t) => {
          if (t.type==="earn"||t.type==="adjust_add") {
            if (t.expires_at && new Date(t.expires_at).getTime() <= now) return s; // 만료 제외
            return s+(t.amount||0);
          }
          if (t.type==="deduct"||t.type==="adjust_sub") return s-(t.amount||0);
          return s; // expire 타입은 히스토리용이라 계산 제외
        }, 0);
        setPointBalance(bal);
      }).catch(()=>setPointBalance(0));
  }, [cust?.id, _snapshotData]);
  // cust가 바뀌면(예약자↔방문자 토글 등) 다시 로드 — 단 viewOnly + snapshot 있으면 스킵
  useEffect(() => {
    if (_snapshotData) return; // 스냅샷 우선
    if (cust?.id) {
      _loadPkgsWithShares(cust.id);
    } else if (cust?.phone) {
      const phone = cust.phone;
      const bizId = data?.business?.id || _activeBizId;
      sb.get("customers", `&phone=eq.${phone}&business_id=eq.${bizId}&limit=1`).then(rows => {
        if (rows?.length) {
          setCust(prev => ({...prev, id: rows[0].id}));
          _loadPkgsWithShares(rows[0].id);
        } else {
          setCustPkgs([]);
        }
      }).catch(()=>{});
    } else {
      setCustPkgs([]);
    }
  }, [cust?.id, cust?.phone, _snapshotData]);
  const _pkgType = (p) => {
    const svc = (data?.services||[]).find(s => s.name === p.service_name);
    if (svc) {
      const catName = (data?.categories||[]).find(c => c.id === svc.cat)?.name;
      if (catName === '쿠폰') return "coupon";
      if (catName === '선불권') return "prepaid";
      if (catName === '회원권') return "annual";
      if (catName === '패키지') return "package";
    }
    // fallback: services 매칭 실패한 구버전 데이터 대응
    const n = (p.service_name||"").toLowerCase();
    if (n.includes("다담권") || n.includes("선불")) return "prepaid";
    if (n.includes("연간") || n.includes("할인권") || n.includes("회원권")) return "annual";
    return "package";
  };
  const _pkgBalance = (p) => {
    const m = (p.note||"").match(/잔액:([0-9,]+)/);
    if (m) return Number(m[1].replace(/,/g,"")) || 0;
    // note 잔액 정보 없으면 total_count - used_count (원 단위)로 fallback — 구버전 데이터 대응
    return Math.max(0, (p.total_count||0) - (p.used_count||0));
  };
  // 유효기간 지난 패키지는 차감 대상에서 제외
  const _pkgNotExpired = (p) => {
    const exp = ((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
    if (!exp) return true;
    const today = new Date().toISOString().slice(0,10);
    return exp >= today;
  };
  // 유효한 보유권 (잔여/잔액 + 유효기간 체크). 지점 필터는 없음 — 회원가 자격 판정용.
  // id_ebgbebctt3: 타지점에서도 회원가는 적용받을 수 있어야 함.
  const validPkgs = custPkgs.filter(p => {
    const t = _pkgType(p);
    if (t === "prepaid") return _pkgBalance(p) > 0 && _pkgNotExpired(p);
    if (t === "annual") return _pkgNotExpired(p);
    return (p.total_count - p.used_count) > 0 && _pkgNotExpired(p);
  });
  // 현재 지점에서 사용 가능한 보유권 (차감/사용용). 구매지점 외에선 차단됨.
  const activePkgs = validPkgs.filter(p => canUsePkgAtBranch(p, branchId, data?.branches, data?.branchGroups));
  // 활성 다회권 목록 (패키지 사용 자동 차감용)
  const activeMultiPkgs = activePkgs.filter(p => _pkgType(p) === "package");
  // 활성 보유 쿠폰 (관리설정 → 혜택관리 → 쿠폰등록의 쿠폰 카테고리, 잔여≥1, 유효기간 내)
  // v3.7.216: 매출등록·예약모달에 보유 쿠폰 패널 표시 → 클릭 시 적용 시술 자동 추가
  const activeCustCoupons = activePkgs.filter(p => _pkgType(p) === "coupon");
  // 쿠폰 적용 가능 시술 ID Set (시술 카드에 🎫 뱃지 달기 위함) + svcId → 쿠폰 매핑
  const couponEligibleMap = React.useMemo(() => {
    // 쿠폰 카테고리 시술만 (이름 충돌 방지: 정상 카테고리에 같은 이름 있으면 promoConfig=null 떨어짐)
    const _couponCatId = (data?.categories||[]).find(c => c.name === '쿠폰')?.id;
    const _couponSvcs = (data?.services||[]).filter(s => s.cat === _couponCatId);
    const map = {}; // svcId → [pkgId,...]
    activeCustCoupons.forEach(pkg => {
      const svc = _couponSvcs.find(s => s.name === pkg.service_name);
      let pc = svc?.promoConfig;
      if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch { return; } }
      if (!pc || typeof pc !== "object") return;
      const sids = pc.couponTargetServiceIds || (pc.couponTargetServiceId ? [pc.couponTargetServiceId] : []);
      sids.forEach(sid => {
        if (!map[sid]) map[sid] = [];
        map[sid].push(pkg.id);
      });
    });
    return map;
  }, [activeCustCoupons, data?.services, data?.categories]);
  const couponEligibleSvcIds = React.useMemo(() => new Set(Object.keys(couponEligibleMap)), [couponEligibleMap]);

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
  // 회원가 자격 규칙 — businesses.settings.member_price_rules (settings는 JSON 문자열이므로 파싱 필요)
  // 새 구조: { qualifyingServiceIds: [...], excludeServiceIds: [...] }
  // 레거시 fallback: qualifyingServiceIds 없으면 annual+prepaid 자동 인정
  const _memberRules = React.useMemo(() => {
    try {
      const raw = (data?.businesses||[])[0]?.settings;
      const s = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      return s.member_price_rules || {};
    } catch {
      return {};
    }
  }, [data?.businesses]);
  // 자격 부여 시술 이름 set (customer_packages.service_name 매칭용)
  const _qualifyingSvcNames = React.useMemo(() => {
    const ids = Array.isArray(_memberRules.qualifyingServiceIds) ? _memberRules.qualifyingServiceIds : null;
    if (!ids) return null; // 레거시 모드 (null이면 fallback)
    const names = new Set();
    (data?.services || []).forEach(s => { if (ids.includes(s.id) && s.name) names.add(s.name); });
    return names;
  }, [_memberRules.qualifyingServiceIds, data?.services]);
  // 자격 부여 시술 ID set (카트 체크용)
  const _qualifyingSvcIds = React.useMemo(() => {
    const ids = Array.isArray(_memberRules.qualifyingServiceIds) ? _memberRules.qualifyingServiceIds : null;
    return ids ? new Set(ids) : null;
  }, [_memberRules.qualifyingServiceIds]);
  // 회원가 제외 상품 이름 매핑
  const _excludedSvcNames = React.useMemo(() => {
    const ids = Array.isArray(_memberRules.excludeServiceIds) ? _memberRules.excludeServiceIds : [];
    const names = new Set();
    (data?.services || []).forEach(s => { if (ids.includes(s.id) && s.name) names.add(s.name); });
    return names;
  }, [_memberRules.excludeServiceIds, data?.services]);
  // 레거시 fallback (qualifyingServiceIds 없을 때만 사용)
  const _PREPAID_CAT_MP = "1s18w2l46";
  const _isAnnualSvcMP = (s) => {
    const n = (s?.name||"").toLowerCase();
    if (s?.cat === _PREPAID_CAT_MP) return false;
    return n.includes("연간") || n.includes("회원권") || n.includes("할인권");
  };
  // 보유권이 회원가 자격을 부여하는지
  const _pkgGrantsMember = (p) => {
    if (!_pkgStillValid(p)) return false;
    if (_excludedSvcNames.has(p.service_name)) return false;
    if (_qualifyingSvcNames) {
      // 새 구조: 자격 시술 명단에 있는지
      return _qualifyingSvcNames.has(p.service_name);
    }
    // 레거시 fallback: annual + prepaid
    const t = _pkgType(p);
    if (t === "annual") return true;
    if (t === "prepaid") return true;
    return false;
  };

  // 이번 매출에서 신규 구매하는 보유권으로도 회원가 자격 부여
  // 주의: `items`는 아래 useState로 선언 → 함수 호출 시점에 lazy 접근
  const _hasQualifyingInCart = () => {
    try {
      if (_qualifyingSvcIds) {
        return (data?.services || []).some(s => _qualifyingSvcIds.has(s.id) && items[s.id]?.checked && !_excludedSvcNames.has(s.name));
      }
      // 레거시 fallback
      return (data?.services || []).some(s => (
        (s.cat === _PREPAID_CAT_MP || _isAnnualSvcMP(s)) &&
        items[s.id]?.checked &&
        !_excludedSvcNames.has(s.name)
      ));
    } catch { return false; }
  };

  // 회원 고객 여부 (쿠폰 회원할인·UI 배지 등 전역 판정용)
  const _computeIsMemberCustomer = () => {
    if (validPkgs.some(_pkgGrantsMember)) return true;
    return _hasQualifyingInCart();
  };

  // 시술별 회원가 적용 가능 여부 (가격 결정용)
  const isMemberPriceFor = (svc, g) => {
    if (validPkgs.some(p => {
      if (!_pkgGrantsMember(p)) return false;
      if (_pkgType(p) === "annual") return true;
      const memPrice = g === "M" ? svc.memberPriceM : svc.memberPriceF;
      if (!memPrice) return false;
      return _pkgBalance(p) >= memPrice;
    })) return true;
    // 카트에 자격 보유권이 있을 때 — 잔액(items.amount) 충분하면 적용
    const memPrice = g === "M" ? svc.memberPriceM : svc.memberPriceF;
    if (!memPrice) return _hasQualifyingInCart() && _qualifyingSvcNames === null; // 레거시 fallback에선 잔액 없는 annual도 인정
    try {
      if (_qualifyingSvcIds) {
        return (data?.services || []).some(s => (
          _qualifyingSvcIds.has(s.id) &&
          items[s.id]?.checked &&
          !_excludedSvcNames.has(s.name) &&
          ((items[s.id]?.amount || 0) >= memPrice || _isAnnualSvcMP(s))
        ));
      }
      // 레거시: 다담권(잔액 ≥ memPrice) 또는 연간권(잔액 무관)
      return (data?.services || []).some(s => {
        if (!items[s.id]?.checked) return false;
        if (_excludedSvcNames.has(s.name)) return false;
        if (_isAnnualSvcMP(s)) return true; // 연간권은 잔액 무관
        if (s.cat === _PREPAID_CAT_MP) return (items[s.id]?.amount || 0) >= memPrice;
        return false;
      });
    } catch { return false; }
  };

  // 성별+회원가에 따른 기본 가격 계산
  const _defPrice = (svc, g) => {
    if (!g) {
      // 성별 미선택 — F/M 동일가격 시술만 지원
      if (svc.priceF !== svc.priceM) return 0;
      // 회원가 F/M도 동일하면 회원가 가능 (케어 등 성별 공통 시술)
      if (svc.memberPriceF && svc.memberPriceF === svc.memberPriceM && isMemberPriceFor(svc, "F")) return svc.memberPriceF;
      return svc.priceF;
    }
    const regular = g === "M" ? svc.priceM : svc.priceF;
    if (!isMemberPriceFor(svc, g)) return regular;
    const member = g === "M" ? svc.memberPriceM : svc.memberPriceF;
    return member || regular; // 회원가 없으면 정상가
  };

  // State: { [id]: { checked, amount } }
  const [items, setItems] = useState(() => {
    const init = {};
    // selectedServices(신) 우선. 배열이 아예 없는(레거시 예약) 경우에만 serviceId fallback.
    // 빈 배열 []은 "아무것도 선택 안 함"이므로 fallback 금지.
    let selSvcs;
    if (Array.isArray(reservation?.selectedServices)) {
      selSvcs = reservation.selectedServices;
    } else {
      selSvcs = reservation?.serviceId ? [reservation.serviceId] : [];
    }
    SVC_LIST.forEach(svc => {
      const preSelected = selSvcs.includes(svc.id);
      const defPrice = _defPrice(svc, gender);
      init[svc.id] = { checked: preSelected, amount: preSelected ? defPrice : 0, comped: false };
    });
    PROD_LIST.forEach(p => { init[p.id] = { checked: false, amount: 0, comped: false }; });
    init["discount"] = { checked: false, amount: 0 };
    init["extra_svc"] = { checked: false, amount: 0, label: "" };
    init["extra_prod"] = { checked: false, amount: 0, label: "" };
    return init;
  });

  // ── 신규 다담권 구매 시 기존 다담권 자동 우선 차감 (FIFO) ──
  // 직원이 깜빡해도 기존 다담권 잔액부터 소진. 사용자가 명시적으로 0으로 끄면 재활성화 X.
  // pkgUse[id] 가 undefined인 prepaid pkg만 자동 세팅 (이미 0이거나 값 있으면 사용자 의도 존중)
  // ※ items 선언 이후에 위치 — TDZ 방지
  useEffect(() => {
    if (_isEditOrView) return;
    const PCAT = "1s18w2l46"; // PREPAID_CAT_ID 동일값
    const hasNewPrepaid = (data?.services || []).some(s => s.cat === PCAT && items[s.id]?.checked);
    if (!hasNewPrepaid) {
      _autoPrepaidActivatedRef.current = false;
      return;
    }
    if (_autoPrepaidActivatedRef.current) return;
    const _cKey = (p) => p.purchased_at || p.purchasedAt || p.created_at || p.createdAt || "9999-12-31";
    const _isPrepaidPkg = (p) => {
      const n = (p?.service_name || "").toLowerCase();
      return n.includes("다담권") || n.includes("선불") || n.includes("10%추가적립");
    };
    const _pkgBal = (p) => {
      const m = (p?.note||"").match(/잔액[:：]\s*([\d,]+)/);
      if (m) return Number(m[1].replace(/,/g,""))||0;
      return Math.max(0, (p?.total_count||0) - (p?.used_count||0));
    };
    const _notExpired = (p) => {
      const m = (p?.note||"").match(/유효[:：]\s*(\d{4}-\d{2}-\d{2})/);
      if (!m) return true;
      const today = new Date().toISOString().slice(0,10);
      return m[1] >= today;
    };
    const existing = (custPkgs||[])
      .filter(p => _isPrepaidPkg(p) && _pkgBal(p) > 0 && _notExpired(p))
      .sort((a,b) => String(_cKey(a)).localeCompare(String(_cKey(b))));
    if (existing.length === 0) return;
    const updates = {};
    existing.forEach(p => {
      if (pkgUse[p.id] === undefined) updates[p.id] = _pkgBal(p);
    });
    if (Object.keys(updates).length > 0) {
      setPkgUse(prev => ({...prev, ...updates}));
      _autoPrepaidActivatedRef.current = true;
    }
  }, [JSON.stringify(Object.entries(items).filter(([k,v]) => v?.checked).map(([k]) => k)), custPkgs.length]);

  // items 선언 이후에만 isMemberCustomer 계산 가능 (items가 내부에서 참조되기 때문)
  const isMemberCustomer = _computeIsMemberCustomer();

  // 회원가 자격 비동기 로드 반영 — isMemberCustomer가 나중에 true로 바뀌면
  // 초기 정상가로 세팅된 체크된 시술들을 회원가로 재계산
  // 사용자가 수동으로 금액 수정한 경우는 건드리지 않음 (amount가 regular/member 중 하나와 정확히 일치할 때만 교체)
  const _prevMemberRef = React.useRef(isMemberCustomer);
  useEffect(() => {
    if (_prevMemberRef.current === isMemberCustomer) return;
    _prevMemberRef.current = isMemberCustomer;
    setItems(prev => {
      const next = { ...prev };
      let changed = false;
      SVC_LIST.forEach(svc => {
        const cur = next[svc.id];
        if (!cur?.checked) return;
        const newAmt = _defPrice(svc, gender);
        if (newAmt === cur.amount) return;
        // 현 amount가 '정상가' 또는 '회원가' 중 하나와 일치할 때만 교체 (수동 수정은 보존)
        const regF = svc.priceF || 0, regM = svc.priceM || 0;
        const memF = svc.memberPriceF || 0, memM = svc.memberPriceM || 0;
        const known = [regF, regM, memF, memM].filter(Boolean);
        if (known.includes(cur.amount)) {
          next[svc.id] = { ...cur, amount: newAmt };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [isMemberCustomer, gender]);

  // 편집 모드: existingDetails에서 items 프리필 (시술/제품/추가/할인)
  const _prefilledFromDetails = useRef(false);
  useEffect(() => {
    if (_prefilledFromDetails.current) return;
    if (!_isEditOrView) return;
    const existingDetails = reservation?._prefill?.existingDetails;
    if (!Array.isArray(existingDetails) || existingDetails.length === 0) return;
    _prefilledFromDetails.current = true;

    const extraSvcRows = [];
    const extraProdRows = [];
    let discountAmt = 0;
    const matchedSvcIds = {};  // id → amount
    const matchedProdIds = {};

    const compedSvcIds = new Set();
    const compedProdIds = new Set();
    existingDetails.forEach(d => {
      const nmRaw = (d.service_name||"").trim();
      if (!nmRaw) return;
      // 보유권 사용 기록 행은 items 프리필에서 제외 (pkgUse 별도 관리)
      if (/^\[보유권/.test(nmRaw)) return;
      // 쿠폰·이벤트 자동적용 행은 items 프리필에서 제외 (쿠폰 엔진 자동 재계산)
      if (/^\[쿠폰 (할인|적립)\]/.test(nmRaw)) return;
      if (/^\[이벤트 (할인|적립)\]/.test(nmRaw)) return;
      // 체험단 프리픽스 제거 후 매칭
      const isComped = /^\[체험단\]\s*/.test(nmRaw);
      const nm = isComped ? nmRaw.replace(/^\[체험단\]\s*/, "") : nmRaw;
      // 할인
      if (nm === "할인" || nm === "[할인]" || /^\[할인\]/.test(nm)) {
        discountAmt += (d.unit_price || 0);
        return;
      }
      // 정규 시술 매칭
      const svc = SVC_LIST.find(x => x.name === nm);
      if (svc) { matchedSvcIds[svc.id] = (d.unit_price || 0); if (isComped) compedSvcIds.add(svc.id); return; }
      // 정규 제품 매칭
      const prod = PROD_LIST.find(x => x.name === nm);
      if (prod) { matchedProdIds[prod.id] = (d.unit_price || 0); if (isComped) compedProdIds.add(prod.id); return; }
      // ★ item_kind 우선 — DB 저장값으로 정확 분류 (라벨 추측 fallback 제거)
      const ik = d.item_kind;
      if (ik === 'prod') { extraProdRows.push({name:nm, amount: d.unit_price||0}); return; }
      if (ik === 'svc')  { extraSvcRows.push({name:nm, amount: d.unit_price||0}); return; }
      // 레거시 fallback (item_kind null인 옛 데이터): 이름 키워드 추측
      if (nm === "추가 시술" || /시술/.test(nm)) { extraSvcRows.push({name:nm, amount: d.unit_price||0}); return; }
      if (nm === "추가 제품" || /제품/.test(nm)) { extraProdRows.push({name:nm, amount: d.unit_price||0}); return; }
      extraSvcRows.push({name:nm, amount: d.unit_price||0});
    });

    setItems(prev => {
      const next = {...prev};
      Object.entries(matchedSvcIds).forEach(([id, amt]) => {
        next[id] = { ...next[id], checked: true, amount: amt, comped: compedSvcIds.has(id) };
      });
      Object.entries(matchedProdIds).forEach(([id, amt]) => {
        next[id] = { ...next[id], checked: true, amount: amt, comped: compedProdIds.has(id) };
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
    const pkgFromRes = selSvcs.filter(id => typeof id === "string" && id.startsWith("pkg__"));
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
    // 디폴트 선택 없음 — 유저가 명시적으로 체크해야 사용
  }, [activeMultiPkgs]);

  // 패키지 수량 변경 (같은 이름+같은 소유자 그룹 내에서 유효기간 빠른 순으로 배분)
  // groupKey = "이름∷self" (본인) 또는 "이름∷shared_{ownerId}" (쉐어)
  // 구형 호출 하위호환: groupKey에 '∷' 없으면 이름만으로 필터 (본인+쉐어 전체)
  const setPkgQty = (groupKey, newQty) => {
    const [groupName, ownerKey] = String(groupKey).includes('∷')
      ? String(groupKey).split('∷')
      : [String(groupKey), null];
    const pkgs = activeMultiPkgs.filter(p => {
      const name = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
      if (name !== groupName) return false;
      if (ownerKey === null) return true; // 하위호환
      const pkgOwnerKey = p._shared_from ? `shared_${p.customer_id}` : 'self';
      return pkgOwnerKey === ownerKey;
    });
    const sorted = [...pkgs].sort((a,b) => {
      const ea = ((a.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      const eb = ((b.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/)||[])[1]||"9999";
      return ea.localeCompare(eb);
    });
    let remain = newQty;
    const newPkgItems = { ...pkgItems };
    const newPkgUse = { ...pkgUse };
    // 이 그룹 패키지만 초기화 (다른 그룹은 유지)
    pkgs.forEach(p => { newPkgItems["pkg__" + p.id] = { qty: 0 }; newPkgUse[p.id] = 0; });
    sorted.forEach(p => {
      const avail = (p.total_count||0) - (p.used_count||0);
      const use = Math.min(remain, avail);
      newPkgItems["pkg__" + p.id] = { qty: use };
      newPkgUse[p.id] = use;
      remain -= use;
    });
    setPkgItems(newPkgItems);
    setPkgUse(newPkgUse);
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
  const setQty = useCallback((id, q) => setItems(prev => ({ ...prev, [id]: { ...prev[id], qty: Math.max(1, Number(q) || 1) } })), []);
  const setLabel = useCallback((id, v) => setItems(prev => ({ ...prev, [id]: { ...prev[id], label: v } })), []);
  // 🎁 체험단 토글 — 체크된 항목에만 적용. 체험이면 결제대상에서 제외하고 svcComped/prodComped로 집계
  const toggleComped = useCallback((id) => setItems(prev => {
    const cur = prev[id]; if (!cur?.checked) return prev;
    return { ...prev, [id]: { ...cur, comped: !cur.comped } };
  }), []);

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

  // 신규 다담권/패키지/연간회원권 구매 항목 식별
  const PREPAID_CAT_ID = "1s18w2l46"; // 선불권 카테고리
  const PKG_CAT_ID = "c1fbbbff-"; // PKG (패키지) 카테고리
  const _isAnnualSvc = (s) => {
    const n = (s?.name||"").toLowerCase();
    if (s?.cat === PREPAID_CAT_ID) return false;
    return n.includes("연간") || n.includes("회원권") || n.includes("할인권");
  };
  const newPrepaidPurchases = SVC_LIST.filter(s => s.cat === PREPAID_CAT_ID && items[s.id]?.checked);
  // PKG 패키지 (왁싱PKG, 토탈PKG 등 — name에서 회수 파싱), 연간회원권 제외
  const newPkgPurchases = SVC_LIST.filter(s => (s.cat === PKG_CAT_ID || /PKG|패키지/i.test(s.name||"")) && s.cat !== PREPAID_CAT_ID && !_isAnnualSvc(s) && items[s.id]?.checked);
  const newAnnualPurchases = SVC_LIST.filter(s => _isAnnualSvc(s) && items[s.id]?.checked);
  // 패키지 회수 파싱: "왁싱 PKG 5회" → 5
  const parsePkgCount = (name) => { const m = (name||"").match(/(\d+)\s*회/); return m ? parseInt(m[1]) : 5; };
  // 신규 구매 다담권/패키지/연간권 총 액면가
  const newPrepaidActiveTotal = newPrepaidPurchases.reduce((sum, s) => sum + (items[s.id]?.amount || 0), 0);
  const newPkgPurchaseTotal = newPkgPurchases.reduce((sum, s) => sum + (items[s.id]?.amount || 0), 0);
  const newAnnualPurchaseTotal = newAnnualPurchases.reduce((sum, s) => sum + (items[s.id]?.amount || 0), 0);
  // 다담권으로 차감할 일반 시술/제품 합계 (다담권 본인은 제외) — 참고용
  const todayUseSvcTotal = SVC_LIST.reduce((sum, svc) => {
    if (svc.cat === PREPAID_CAT_ID) return sum; // 다담권 자체는 제외
    return sum + (items[svc.id]?.checked ? items[svc.id].amount : 0);
  }, 0) + (items.extra_svc?.checked ? items.extra_svc.amount : 0);
  // 새 다담권 즉시 차감액 — "할인·보유권 차감 후 시술잔액" 한도로 아래에서 재계산됨 (placeholder)
  let newPkgInstantDeduct = newPrepaidActiveTotal > 0 ? Math.min(todayUseSvcTotal, newPrepaidActiveTotal) : 0;

  // 쉐어 패키지 남녀 요금차 보정금 — 여자 소유 패키지를 남자가 사용하면 +33,000원/회 (id_nfv71exl14 수정요청)
  const SHARE_MF_SURCHARGE = 33000;
  const shareSurchargeTotal = React.useMemo(() => {
    if (gender !== 'M') return 0;
    let surcharge = 0;
    // 다회권 (count 기반) — pkgItems
    Object.entries(pkgItems || {}).forEach(([key, v]) => {
      const qty = v?.qty || 0;
      if (qty <= 0) return;
      const pkgId = key.replace(/^pkg__/, '');
      const pkg = custPkgs.find(p => p.id === pkgId);
      if (pkg && pkg._shared_from && pkg._owner_gender === 'F') {
        surcharge += qty * SHARE_MF_SURCHARGE;
      }
    });
    return surcharge;
  }, [gender, pkgItems, custPkgs]);

  // Totals
  const svcTotal = SVC_LIST.reduce((sum, svc) => sum + (items[svc.id]?.checked ? items[svc.id].amount : 0), 0)
    + (items.extra_svc?.checked ? items.extra_svc.amount : 0)
    + shareSurchargeTotal;
  const prodTotal = PROD_LIST.reduce((sum, p) => sum + (items[p.id]?.checked ? items[p.id].amount : 0), 0)
    + (items.extra_prod?.checked ? items.extra_prod.amount : 0);
  // 🎁 체험단 제공분 — 결제대상에서 제외
  const svcCompedTotal = SVC_LIST.reduce((sum, svc) => {
    const it = items[svc.id]; return sum + (it?.checked && it.comped ? (it.amount||0) : 0);
  }, 0);
  const prodCompedTotal = PROD_LIST.reduce((sum, p) => {
    const it = items[p.id]; return sum + (it?.checked && it.comped ? (it.amount||0) : 0);
  }, 0);
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
      if (isMemberCustomer && pc.memberDiscountPct > 0) { const d = Math.round(it.amount * pc.memberDiscountPct / 100); discount += d; reasons.push(`회원 ${pc.memberDiscountPct}%`); }
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
    // 쿠폰 카테고리 시술만 매핑 (같은 이름이 정상 카테고리에도 있으면 정상 시술이 잡혀 promoConfig=null로 떨어짐)
    const _couponCatId = (data?.categories||[]).find(c => c.name === '쿠폰')?.id;
    const svcByName = new Map(
      (data?.services||[]).filter(s => s.cat === _couponCatId).map(s => [s.name, s])
    );
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
  // ─── 범용 이벤트 엔진 평가 (관리설정 > 이벤트 관리 > 이벤트 등록) ───
  const eventResult = React.useMemo(() => {
    try {
      const biz = (data?.businesses||[])[0];
      const s = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : (biz?.settings||{});
      // 마스터 스위치: 이벤트 전체 OFF 상태면 엔진 skip
      if (s?.events_master_enabled === false) {
        return { pointEarn:0, pointExpiresAt:null, discountFlat:0, discountFlatPkg:0, discountFlatPrepaid:0, discountFlatAnnual:0, discountPct:0, prepaidBonus:0, issueCoupons:[], virtualCoupons:[], appliedEvents:[] };
      }
      let events = Array.isArray(s?.events) ? s.events : [];
      // 레거시 point_events.newcust_10pct → 이벤트 배열에 합류
      const legacy = s?.point_events?.newcust_10pct;
      if (legacy?.enabled && !events.find(e => e.id === 'evt_new_first_point')) {
        events = [...events, { id:'evt_new_first_point', enabled:true, trigger:'new_first_sale', rewardType:'point_earn',
          base: legacy.base||'svc', rate: legacy.rate||10, expiryMonths: legacy.expiryMonths||3 }];
      }
      const isNew = !cust.id || !custHasSale;
      // 유효기간 파싱: customer_packages.note의 "유효:YYYY-MM-DD" 패턴
      // (expires_at 컬럼은 존재하지 않으므로 note에서 추출 필요)
      const todayStr = new Date().toISOString().slice(0,10);
      const _pkgExpired = (p) => {
        const m = (p.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/);
        if (!m) return false; // 유효기간 미설정 = 아직 유효 (미사용 원칙)
        return m[1] < todayStr;
      };
      // 이벤트 조건 판정용 — 본인 소유만 (쉐어받은 것 제외). _shared_from이 null이면 본인 소유.
      const ownPkgs = (custPkgs||[]).filter(p => !p._shared_from);
      // 다담권 보유 — name에 "다담" 포함
      const hasExistingPrepaid = ownPkgs.some(p => {
        const n = (p.service_name||'').toLowerCase();
        if (!n.includes('다담')) return false;
        if (_pkgExpired(p)) return false;
        const balM = (p.note||'').match(/잔액:([0-9,]+)/);
        const bal = balM ? Number(balM[1].replace(/,/g,'')) : ((p.total_count||0) - (p.used_count||0));
        return bal > 0;
      });
      // 바프권 보유 — name에 "바프" 포함
      const hasExistingBarf = ownPkgs.some(p => {
        const n = (p.service_name||'').toLowerCase();
        if (!n.includes('바프')) return false;
        if (_pkgExpired(p)) return false;
        const balM = (p.note||'').match(/잔액:([0-9,]+)/);
        const bal = balM ? Number(balM[1].replace(/,/g,'')) : ((p.total_count||0) - (p.used_count||0));
        return bal > 0;
      });
      // 활성 선불권 통계 (이름 키워드로 분리: 다담 / 바프)
      const _prepaidLikeStats = (matchKw) => {
        let maxPct = 0, maxBal = 0;
        ownPkgs.forEach(p => {
          const n = (p.service_name||'').toLowerCase();
          if (!n.includes(matchKw)) return;
          if (_pkgExpired(p)) return;
          const balM = (p.note||'').match(/잔액:([0-9,]+)/);
          const chgM = (p.note||'').match(/충전:([0-9,]+)/);
          const bal = balM ? Number(balM[1].replace(/,/g,'')) : 0;
          const chg = chgM ? Number(chgM[1].replace(/,/g,'')) : 0;
          if (bal > maxBal) maxBal = bal;
          if (chg > 0 && bal >= 0) {
            const pct = (bal / chg) * 100;
            if (pct > maxPct) maxPct = pct;
          }
        });
        return { maxPct, maxBal };
      };
      const _ps = _prepaidLikeStats('다담');
      const prepaidBalanceRatioPct = _ps.maxPct;
      const prepaidMaxBalance = _ps.maxBal;
      const _bs = _prepaidLikeStats('바프');
      const barfBalanceRatioPct = _bs.maxPct;
      const barfMaxBalance = _bs.maxBal;
      // 기존 패키지 보유 여부 — 잔여 > 0 + 미만료 (본인 소유만)
      const hasExistingPkg = ownPkgs.some(p => {
        const n = (p.service_name||'').toLowerCase();
        const isPkg = n.includes('pkg') || n.includes('패키지');
        if (!isPkg) return false;
        if (_pkgExpired(p)) return false;
        const remain = (p.total_count||0) - (p.used_count||0);
        return remain > 0;
      });
      // 기존 연간회원권 보유 여부 — 미만료 + 이름에 연간/회원권/할인권 (본인 소유만)
      const hasExistingAnnual = ownPkgs.some(p => {
        const n = (p.service_name||'').toLowerCase();
        const isAnn = n.includes('연간') || n.includes('회원권') || n.includes('할인권');
        if (!isAnn) return false;
        if (_pkgExpired(p)) return false;
        return true;
      });
      const prepaidPurchaseAmount = newPrepaidPurchases.reduce((sum, s) => sum + (items[s.id]?.amount||0), 0);
      const pkgPurchaseAmount = newPkgPurchases.reduce((sum, s) => sum + (items[s.id]?.amount||0), 0);
      const annualPurchaseAmount = newAnnualPurchases.reduce((sum, s) => sum + (items[s.id]?.amount||0), 0);
      const ctx = {
        isNewCustomer: isNew,
        // 신규 트리거 컨텍스트
        hasAnyPrepaidPurchase: newPrepaidPurchases.length > 0,
        hasAnyPkgPurchase: newPkgPurchases.length > 0,
        hasAnyAnnualPurchase: newAnnualPurchases.length > 0,
        // 고객 현재 상태
        hasActivePrepaid: hasExistingPrepaid,
        hasActiveBarf: hasExistingBarf,
        hasActivePkg: hasExistingPkg,
        hasActiveAnnual: hasExistingAnnual,
        prepaidBalanceRatioPct,
        prepaidMaxBalance,
        barfBalanceRatioPct,
        barfMaxBalance,
        // 레거시 호환 (prepaid_recharge/pkg_repurchase 트리거용)
        hasPrepaidRecharge: hasExistingPrepaid && newPrepaidPurchases.length > 0,
        hasPkgRepurchase: hasExistingPkg && newPkgPurchases.length > 0,
        // 결제 방식 (현금/카드) — 이번 매출 payMethod 기반
        paymentUsesCash: (payMethod.svcCash||0) + (payMethod.prodCash||0) > 0,
        paymentUsesCard: (payMethod.svcCard||0) + (payMethod.prodCard||0) > 0,
        // 고객 성별 (M/F)
        customerGender: gender || null,
        // 금액
        svcTotal, prodTotal,
        prepaidPurchaseAmount, pkgPurchaseAmount, annualPurchaseAmount,
        // 구매 아이템 배열 (조건 정확 매칭용)
        newPrepaidItems: newPrepaidPurchases.map(s => ({ id: s.id, name: s.name, amount: items[s.id]?.amount||0 })),
        newPkgItems: newPkgPurchases.map(s => ({ id: s.id, name: s.name, amount: items[s.id]?.amount||0 })),
        newAnnualItems: newAnnualPurchases.map(s => ({ id: s.id, name: s.name, amount: items[s.id]?.amount||0 })),
        items, svcList: SVC_LIST, prodList: PROD_LIST,
        // 고객 보유권 (servicesNone 평가 시 보유권 이름 매칭에 사용)
        customerPkgs: ownPkgs,
        // 엔진 외부 할인·체험단 (netAmount 계산에 차감)
        externalDiscount: (items.discount?.checked ? (items.discount.amount||0) : 0)
          + couponDiscountTotal + promoDiscountTotal + svcCompedTotal + prodCompedTotal,
        // 시술 단독 적립 계산용: 시술에만 적용된 할인 (수동·promo·svc쿠폰·체험단)
        externalSvcDiscount: (items.discount?.checked ? (items.discount.amount||0) : 0)
          + (couponDiscountOnSvc||0) + (promoDiscountTotal||0) + (svcCompedTotal||0),
      };
      return applyEvents(events, ctx);
    } catch (e) { console.warn('[eventEngine]', e); return { pointEarn:0, pointExpiresAt:null, discountFlat:0, discountFlatPkg:0, discountFlatPrepaid:0, discountFlatAnnual:0, discountPct:0, prepaidBonus:0, issueCoupons:[], virtualCoupons:[], appliedEvents:[] }; }
  }, [data?.businesses, cust.id, custHasSale, custPkgs, newPrepaidPurchases, newPkgPurchases, newAnnualPurchases, svcTotal, prodTotal, items, payMethod.svcCash, payMethod.svcCard, payMethod.prodCash, payMethod.prodCard, gender]);

  // 레거시 호환: 기존 UI/로직에서 참조하던 newCustEventEarn 형태 유지
  // 신규 스키마(rewards[])와 레거시(rewardType) 모두 지원
  const newCustEventEarn = React.useMemo(() => {
    const evt = (eventResult.appliedEvents||[]).find(e => {
      if (e.trigger !== 'new_first_sale') return false;
      if (Array.isArray(e.rewards)) return e.rewards.some(r => r.type === 'point_earn');
      return e.rewardType === 'point_earn';
    });
    let rate = 0, expiryMonths = 0;
    if (evt) {
      if (Array.isArray(evt.rewards)) {
        const r = evt.rewards.find(x => x.type === 'point_earn');
        rate = Number(r?.rate) || 0;
        expiryMonths = Number(r?.expiryMonths) || 0;
      } else {
        rate = Number(evt.rate) || 0;
        expiryMonths = Number(evt.expiryMonths) || 0;
      }
    }
    return { earn: eventResult.pointEarn || 0, evt: evt || null, rate, expiryMonths };
  }, [eventResult]);

  useEffect(() => {
    if (_promoAppliedRef.current.userOverride) return;
    const totalAuto = (promoEarnTotal||0) + (couponEarnTotal||0) + (newCustEventEarn.earn||0);
    if (_promoAppliedRef.current.total === totalAuto) return;
    _promoAppliedRef.current.total = totalAuto;
    setPointEarn(totalAuto);
  }, [promoEarnTotal, couponEarnTotal, newCustEventEarn.earn]);

  // 이벤트 자동 할인 (정액 + 시술 % → 정액 환산)
  // 순수 시술·제품액 (다담권/패키지/연간권 구매 금액 제외) — 시술 할인은 이 범위에만
  const pureSvcTotal = Math.max(0, svcTotal - newPrepaidActiveTotal - newPkgPurchaseTotal - newAnnualPurchaseTotal);
  // 이벤트 할인 풀별 cap — 각 풀 내에서만 차감
  const eventDiscountSvc = Math.max(0, Math.min(
    pureSvcTotal + prodTotal,
    (eventResult?.discountFlat||0) + Math.round(pureSvcTotal * (eventResult?.discountPct||0) / 100)
  ));
  const eventDiscountPkg = Math.max(0, Math.min(newPkgPurchaseTotal, eventResult?.discountFlatPkg||0));
  const eventDiscountPrepaid = Math.max(0, Math.min(newPrepaidActiveTotal, eventResult?.discountFlatPrepaid||0));
  const eventDiscountAnnual = Math.max(0, Math.min(newAnnualPurchaseTotal, eventResult?.discountFlatAnnual||0));
  // 전체 이벤트 할인 합 (UI 표시 및 grandTotal 차감용)
  const eventDiscountTotal = eventDiscountSvc + eventDiscountPkg + eventDiscountPrepaid + eventDiscountAnnual;
  // 선결제(외부)는 신규 선불권 구매에 우선 적용 — "선결제로 선불권을 사고, 그 선불권으로 시술비 차감"
  // (예: 선결제 33,000 + 바프권 30만 구매 + 다리 11만 → 바프권 26.7만 결제 + 바프권 잔액에서 다리 11만 차감)
  const externalToNewPrepaid = Math.min(externalDeduct, Math.max(0, newPrepaidActiveTotal - eventDiscountPrepaid));
  const externalToSvc = externalDeduct - externalToNewPrepaid;
  // 할인·보유권 차감 후 순수 시술·제품 잔액 (= 다담권 즉시차감 가능 상한)
  const svcAfterAllDiscounts = Math.max(0, pureSvcTotal + prodTotal - discount - promoDiscountTotal - couponDiscountTotal - eventDiscountSvc - naverDeduct - externalToSvc - pkgDeduct);
  // 새 다담권 즉시차감: 할인 후 시술잔액과 (선결제 적용 후) 다담권 잔액 중 작은 값
  newPkgInstantDeduct = newPrepaidActiveTotal > 0 ? Math.min(svcAfterAllDiscounts, Math.max(0, newPrepaidActiveTotal - eventDiscountPrepaid)) : 0;
  const grandTotal = Math.max(0, svcTotal + prodTotal - discount - promoDiscountTotal - couponDiscountTotal - eventDiscountTotal - naverDeduct - externalDeduct - pkgDeduct - newPkgInstantDeduct - pointDeduct - svcCompedTotal - prodCompedTotal);
  // 실제 결제할 금액 (예약금·할인·이벤트·쿠폰·보유권·신규다담권즉시차감·체험단제공 차감)
  const svcPayTotal = Math.max(0, svcTotal - discount - promoDiscountTotal - couponDiscountOnSvc - eventDiscountTotal - naverDeduct - externalDeduct - pkgDeduct - newPkgInstantDeduct - pointDeduct - svcCompedTotal);
  const prodPayTotal = Math.max(0, prodTotal - couponDiscountOnProd - prodCompedTotal);

  // Count checked
  const checkedSvc = SVC_LIST.filter(s => items[s.id]?.checked).length + (items.extra_svc?.checked ? 1 : 0);
  const checkedProd = PROD_LIST.filter(p => items[p.id]?.checked).length + (items.extra_prod?.checked ? 1 : 0);

  // Auto-calc remaining for default payment
  const svcRemain = Math.max(0, svcTotal - payMethod.svcCard - payMethod.svcTransfer - payMethod.svcCash - payMethod.svcPoint);
  const prodRemain = Math.max(0, prodTotal - payMethod.prodCard - payMethod.prodTransfer - payMethod.prodCash - payMethod.prodPoint);
  // Reset payment when total changes
  const prevSvcPay = useRef(0);
  // 시술+제품 결제 통합: 합산 기준으로 svc 결제수단 필드에 자동 분배
  const totalPayCombined = svcPayTotal + prodPayTotal;
  useEffect(() => {
    if (totalPayCombined !== prevSvcPay.current) {
      prevSvcPay.current = totalPayCombined;
      const pri = primaryPay.svc;
      if (pri && openPay[pri]) {
        const fields = ["svcCard","svcCash","svcTransfer"];
        setPayMethod(p => { const n={...p}; const others=fields.filter(f=>f!==pri&&openPay[f]).reduce((s,f)=>s+(n[f]||0),0); n[pri]=Math.max(0,totalPayCombined-others); return n; });
      }
    }
  }, [totalPayCombined]);

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
    // ── 읽기전용: 예약모달에서 진입한 매출확인은 수정 차단 (매출관리에서만 수정 가능) ──
    if (viewOnly) {
      showAlert("매출 내역 수정은 매출관리 페이지에서 가능합니다.");
      return;
    }
    // ── 외부선결제 입력했는데 플랫폼 미선택 차단 (id_bx34ug1iaq 케이스 방어) ──
    if (externalPrepaid > 0 && !(externalPlatform || "").trim()) {
      showAlert("외부선결제 금액을 입력하셨는데 플랫폼이 선택되지 않았습니다.\n\n네이버/트레이지/서울뷰티 등 플랫폼을 선택해주세요.");
      return;
    }
    // ── 예약금 환불 처리: 시술액 < 예약금일 때 환불 안내 (id_bwevrmvqft) ──
    // 시술합계만 기준 (제품/보유권 무관)
    if (externalPrepaid > 0 && svcTotal > 0 && svcTotal < externalPrepaid) {
      const refundedAmt = externalPrepaid;
      const ok = confirm(
        `예약금 ${refundedAmt.toLocaleString()}원이 시술액 ${svcTotal.toLocaleString()}원보다 큽니다.\n\n` +
        `예약금을 환불 처리할까요?\n\n` +
        `확인 시: 예약금 0원으로 변경 + 메모에 환불 기록 추가\n` +
        `→ 고객은 시술액 ${svcTotal.toLocaleString()}원만 결제`
      );
      if (!ok) return;
      setExternalPrepaid(0);
      setSaleMemo(prev => `[예약금 환불 ${refundedAmt.toLocaleString()}원]\n` + (prev || ""));
      _submitLock.current = false;
      showAlert(`예약금 ${refundedAmt.toLocaleString()}원 환불 처리됨.\n결제수단을 다시 확인 후 매출등록 버튼을 눌러주세요.`);
      return;
    }
    // ── 편집 모드: sale_details 교체 + sales 본체 결제금액·외부선결제·메모 업데이트 ──
    // 보유권 차감, 포인트 거래는 건드리지 않음 (순수 내역 교정 용도)
    if (editMode && existingSaleId) {
      // ─ KST 기준 등록일 ≠ 오늘이면 수정 사유 입력 강제 ─
      let _editReasonPrefix = ""; // memo 앞에 누적할 prefix
      let _editReason = "", _editAuthor = "";
      try {
        const _kstNow = new Date(Date.now() + 9*3600*1000);
        const _todayKst = _kstNow.toISOString().slice(0,10);
        const _saleCreatedAt = reservation?.createdAt || reservation?.created_at;
        if (_saleCreatedAt) {
          const _createdKst = new Date(new Date(_saleCreatedAt).getTime() + 9*3600*1000).toISOString().slice(0,10);
          if (_createdKst < _todayKst) {
            _editReason = (prompt("매출 수정 사유를 입력하세요 (취소 시 수정 안됨):") || "").trim();
            if (!_editReason) { showAlert("수정 사유가 입력되지 않아 취소됩니다."); return; }
            _editAuthor = (prompt("수정한 사람 이름을 입력하세요:") || "").trim();
            if (!_editAuthor) { showAlert("수정자 이름이 입력되지 않아 취소됩니다."); return; }
            const _ts = `${_kstNow.getUTCFullYear()}-${String(_kstNow.getUTCMonth()+1).padStart(2,"0")}-${String(_kstNow.getUTCDate()).padStart(2,"0")} ${String(_kstNow.getUTCHours()).padStart(2,"0")}:${String(_kstNow.getUTCMinutes()).padStart(2,"0")}`;
            _editReasonPrefix = `[수정 ${_ts} ${_editAuthor}: ${_editReason}]\n`;
          }
        }
      } catch(_e){ console.warn("[edit reason]", _e); }
      // ─ 금액 변동 경고: 원래 값과 편집 값이 다르면 확인 받음 ─
      const origPay = {
        svcCash: reservation?.svcCash||0, svcTransfer: reservation?.svcTransfer||0,
        svcCard: reservation?.svcCard||0, svcPoint: reservation?.svcPoint||0, svcComped: reservation?.svcComped||0,
        prodCash: reservation?.prodCash||0, prodTransfer: reservation?.prodTransfer||0,
        prodCard: reservation?.prodCard||0, prodPoint: reservation?.prodPoint||0, prodComped: reservation?.prodComped||0,
        externalPrepaid: reservation?.externalPrepaid||0,
      };
      const newPay = {
        svcCash: payMethod.svcCash||0, svcTransfer: payMethod.svcTransfer||0,
        svcCard: payMethod.svcCard||0, svcPoint: payMethod.svcPoint||0, svcComped: svcCompedTotal||0,
        prodCash: payMethod.prodCash||0, prodTransfer: payMethod.prodTransfer||0,
        prodCard: payMethod.prodCard||0, prodPoint: payMethod.prodPoint||0, prodComped: prodCompedTotal||0,
        externalPrepaid: externalPrepaid||0,
      };
      const labelMap = {
        svcCash:"시술현금", svcTransfer:"시술입금", svcCard:"시술카드", svcPoint:"시술포인트", svcComped:"시술체험단",
        prodCash:"제품현금", prodTransfer:"제품입금", prodCard:"제품카드", prodPoint:"제품포인트", prodComped:"제품체험단",
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
        // 수정 사유 prefix를 memo 맨 앞에 붙임 (당일건은 _editReasonPrefix=""라 영향 없음)
        const newMemo = _editReasonPrefix + (externalPrepaid > 0 && externalPlatform ? `[${externalPlatform} 선결제 ${externalPrepaid.toLocaleString()}원] ` : "") + (saleMemo || "");
        const editStaff = (data.staff||[]).find(s => s.id === manager);
        // 결제수단 svc/prod 분할 — 신규 저장과 동일 로직 (시술액 우선 충당)
        let _editSvcRem = svcPayTotal;
        const _editSplit = (totalAmt) => {
          const toSvc = Math.min(_editSvcRem, totalAmt || 0);
          _editSvcRem -= toSvc;
          return { svc: toSvc, prod: (totalAmt || 0) - toSvc };
        };
        const _eCash = _editSplit(payMethod.svcCash);
        const _eCard = _editSplit(payMethod.svcCard);
        const _eXfer = _editSplit(payMethod.svcTransfer);
        const _ePoint = _editSplit(payMethod.svcPoint);
        const salesUpdate = {
          svc_cash: _eCash.svc, svc_transfer: _eXfer.svc,
          svc_card: _eCard.svc, svc_point: _ePoint.svc,
          svc_comped: svcCompedTotal || 0,
          prod_cash: _eCash.prod, prod_transfer: _eXfer.prod,
          prod_card: _eCard.prod, prod_point: _ePoint.prod,
          prod_comped: prodCompedTotal || 0,
          external_prepaid: externalPrepaid > 0 ? externalPrepaid : 0,
          external_platform: externalPrepaid > 0 ? (externalPlatform || "") : null,
          memo: newMemo,
          staff_id: manager || "",
          staff_name: editStaff?.dn || manager || "",
        };
        await sb.update("sales", existingSaleId, salesUpdate);
        // 등록일 ≠ 오늘 KST 수정 → 텔레그램 알림 (대표자만, 발송 실패해도 저장은 진행)
        if (_editReasonPrefix) {
          try {
            const _br = (data?.branches||[]).find(b => b.id === reservation?.bid);
            const _diffSummary = diffs.length > 0 ? diffs.slice(0, 5).join("\n") : "(결제수단 변경 없음)";
            const _tgMsg =
              `<b>📝 매출 수정 알림</b>\n` +
              `매장: ${_br?.name || reservation?.bid || "-"}\n` +
              `고객: ${reservation?.custName || "-"} (${reservation?.custPhone || "-"})\n` +
              `매출일: ${reservation?.date || "-"}\n` +
              `등록일(KST): ${reservation?.createdAt ? new Date(new Date(reservation.createdAt).getTime() + 9*3600*1000).toISOString().slice(0,16).replace('T',' ') : "-"}\n` +
              `수정자: ${_editAuthor}\n` +
              `사유: ${_editReason}\n` +
              `변경:\n${_diffSummary}` +
              (origTotal !== newTotal ? `\n총합: ${origTotal.toLocaleString()} → ${newTotal.toLocaleString()}원` : "");
            fetch(`${SB_URL}/functions/v1/send-telegram`, {
              method: "POST",
              headers: { ...sbHeaders, "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ text: _tgMsg }),
            }).catch(e => console.warn("[edit TG]", e));
          } catch(e) { console.warn("[edit TG build]", e); }
        }
        onSubmit({
          id: existingSaleId, _editOnly: true, _newDetails: newDetails,
          _updatedSale: {
            svcCash: salesUpdate.svc_cash, svcTransfer: salesUpdate.svc_transfer,
            svcCard: salesUpdate.svc_card, svcPoint: salesUpdate.svc_point, svcComped: salesUpdate.svc_comped,
            prodCash: salesUpdate.prod_cash, prodTransfer: salesUpdate.prod_transfer,
            prodCard: salesUpdate.prod_card, prodPoint: salesUpdate.prod_point, prodComped: salesUpdate.prod_comped,
            externalPrepaid: salesUpdate.external_prepaid, externalPlatform: salesUpdate.external_platform, memo: salesUpdate.memo,
            staffId: salesUpdate.staff_id, staffName: salesUpdate.staff_name,
          }
        });
        return;
        // (편집 모드는 반복저장 비지원 — 단일 매출 상세 수정 용도)
      } catch (e) {
        showAlert("상세내역 저장 실패: " + (e?.message || e));
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
      showAlert("시술 또는 제품을 선택해주세요.");
      _submitLock.current = false;
      return;
    }
    // grandTotal=0 허용 (보유권 전액 차감 시에도 매출등록 + 패키지 차감 진행)
    if (!selBranch) {
      showAlert("지점을 선택해주세요.");
      _submitLock.current = false;
      return;
    }
    if (!manager) {
      showAlert("시술자를 선택해주세요.");
      _submitLock.current = false;
      return;
    }
    // 성별 미선택 차단 (남녀 가격 다른 시술이거나 회원가 적용 등 정확한 계산 위해 필수)
    if (!gender || (gender !== 'M' && gender !== 'F')) {
      showAlert("성별을 선택해주세요 (남자/여자)");
      _submitLock.current = false;
      return;
    }
    // 결제수단 미선택 차단 — 실결제금액이 남아있으면 카드/현금/입금 중 하나 이상 필수
    const _svcMethodSum = (payMethod.svcCard||0) + (payMethod.svcCash||0) + (payMethod.svcTransfer||0) + (payMethod.svcPoint||0);
    // 결제 통합: 시술+제품 합산 기준으로 svc 결제수단에 입력
    const _totalPayCombined = svcPayTotal + prodPayTotal;
    if (_totalPayCombined > 0 && _svcMethodSum <= 0) {
      showAlert("결제수단을 선택해주세요.\n(카드/현금/입금 중 하나 이상 금액 입력 필요)");
      _submitLock.current = false;
      return;
    }
    // 고객 이름/연락처 - 마스킹 체크만
    const custName = (cust.name||"").trim();
    const custPhone = (cust.phone||"").trim();
    if (/\*/.test(custName) || /\*/.test(custPhone)) {
      showAlert("고객 이름이나 연락처에 '*'가 포함되어 있습니다.\n네이버 마스킹 데이터가 아닌 실제 정보를 입력해주세요.");
      _submitLock.current = false;
      return;
    }
    const staff = augmentedStaff.find(s => s.id === manager);

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
    // cust.id가 있고 "new_" 접두사가 아니면 기존 고객 ID로 취급 — data.customers 100건 제한으로
    // 로컬 캐시에 없어도 서버에는 있을 수 있으므로 local check만으로 신규 판정하지 않음
    const existsInLocal = cust.id && (data?.customers||[]).some(c => c.id === cust.id);
    let existsInDb = existsInLocal;
    if (cust.id && !cust.id.startsWith("new_") && !existsInLocal) {
      try {
        const rows = await sb.get("customers", cust.id);
        if (Array.isArray(rows) && rows.length > 0) existsInDb = true;
      } catch(e) {}
    }
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
              showAlert("매출 등록이 취소됐습니다. 기존 고객을 검색해서 다시 시도해주세요.");
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

        // visits 증가: 서버 최신값(Oracle 임포트값 포함) 기준으로 +1 → race 방지
        let curVisits = Number(localCust?.visits) || 0;
        try {
          const freshRows = await sb.get("customers", cust.id);
          const srv = Number(freshRows?.[0]?.visits);
          if (Number.isFinite(srv)) curVisits = srv;
        } catch(e) {}
        const newVisits = curVisits + 1;
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
    // 첫 사용 pkg 추적 — 연결된 대기 쿠폰 활성화 용 (used_count 0→positive)
    const _firstUsePkgIds = []; // [{pkgId, firstUseDate (YYYY-MM-DD)}]
    const _todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    Object.entries(pkgUse).forEach(([pkgId, val]) => {
      if (!val) return;
      const pkg = custPkgs.find(p => p.id === pkgId);
      if (!pkg) return;
      const t = _pkgType(pkg);
      if (t === "package" && typeof val === "number" && val > 0) {
        // 다회권: N회 차감
        const prevUsed = pkg.used_count || 0;
        const newUsed = prevUsed + val;
        if (prevUsed === 0 && newUsed > 0) _firstUsePkgIds.push({pkgId, firstUseDate: _todayStr});
        const totalCnt = pkg.total_count || 0;
        const upd = { used_count: newUsed };
        if (prevUsed === 0 && !(/유효:\d{4}-\d{2}-\d{2}/.test(pkg.note||""))) {
          const exp = new Date(); exp.setFullYear(exp.getFullYear()+1); exp.setDate(exp.getDate()-1);
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
        const prevSpent = (pkg.used_count || 0);
        const newSpent = prevSpent + val;
        if (prevSpent === 0 && newSpent > 0) _firstUsePkgIds.push({pkgId, firstUseDate: _todayStr});
        let newNote = (pkg.note || "").replace(/잔액:[0-9,]+/, `잔액:${newBal.toLocaleString()}`);
        // 유효기간 없으면 첫 사용 시점부터 1년 자동 설정
        if (!/유효:\s*\d{4}-\d{2}-\d{2}/.test(newNote)) {
          const d = new Date(); d.setFullYear(d.getFullYear()+1); d.setDate(d.getDate()-1);
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

    // 신규 보유권 id 추적 (이벤트 쿠폰 연결용 — 보유권별 첫 사용일 기준 쿠폰 유효기간 시작)
    const _newTriggerPkgIds = { prepaid_purchase: [], pkg_purchase: [], annual_purchase: [] };

    // ── 신규 다담권 구매 + 오늘 차감 처리 ──
    // 1. 활성화된 다담권 구매 항목별로 customer_packages 생성
    //    - 액면가 = price, 즉시 차감액 = 분배된 today svc deduct
    if (cust.id && newPrepaidPurchases.length > 0) {
      // 자동 즉시 차감 — 신규 다담권 전체에 오늘 시술액을 면가 비례로 분배
      const activeTotal = newPrepaidActiveTotal;
      const totalBonus = Math.max(0, Number(eventResult?.prepaidBonus)||0); // 이벤트 prepaid_bonus 총 금액
      newPrepaidPurchases.forEach(svc => {
        const faceVal = items[svc.id]?.amount || 0;
        const deduct = activeTotal > 0 ? Math.round(newPkgInstantDeduct * (faceVal / activeTotal)) : 0;
        // 보너스 잔액 가산 — 이벤트 prepaid_bonus를 면가 비례로 각 다담권에 분배
        const bonus = activeTotal > 0 ? Math.round(totalBonus * (faceVal / activeTotal)) : 0;
        const balance = Math.max(0, faceVal + bonus - deduct);
        const newPkgId = uid();
        // 구매지점 기록 (id_imgr471swt-3 수정요청: 고객명 앞 이니셜 표시용)
        const _branchShort = (data?.branches||[]).find(b=>b.id===branchId)?.short || "";
        let _note = `잔액:${balance.toLocaleString()}`;
        if (bonus > 0) _note += ` | 보너스:+${bonus.toLocaleString()}`;
        if (deduct > 0) {
          const _expD = new Date(); _expD.setFullYear(_expD.getFullYear()+1); _expD.setDate(_expD.getDate()-1);
          const _expStr = `${_expD.getFullYear()}-${String(_expD.getMonth()+1).padStart(2,"0")}-${String(_expD.getDate()).padStart(2,"0")}`;
          _note += ` | 유효:${_expStr}`;
        }
        if (_branchShort) _note += ` | 매장:${_branchShort.replace(/점$|본점$/,'')}`;
        const newPkg = {
          id: newPkgId, business_id: _activeBizId, customer_id: cust.id,
          service_id: svc.id, service_name: svc.name,
          total_count: faceVal + bonus, used_count: deduct,
          purchased_at: new Date().toISOString(),
          note: _note,
          branch_id: branchId || null,
        };
        sb.insert("customer_packages", newPkg).catch(console.error);
        _newTriggerPkgIds.prepaid_purchase.push(newPkgId);
        // 즉시 차감 시 첫 사용일 = 오늘
        if (deduct > 0) _firstUsePkgIds.push({pkgId: newPkgId, firstUseDate: _todayStr});
        // 신규 충전 (보너스 포함)
        _pkgTxRecords.push({
          package_id: newPkgId, service_name: svc.name,
          type: "charge", unit: "won", amount: faceVal + bonus,
          balance_before: 0, balance_after: faceVal + bonus,
          note: bonus > 0 ? `신규 구매 (액면 ${faceVal.toLocaleString()} + 이벤트보너스 ${bonus.toLocaleString()})` : "신규 구매"
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
        // 구매지점 기록 (id_imgr471swt-3 수정요청)
        const _pkgBranchShort = (data?.branches||[]).find(b=>b.id===branchId)?.short || "";
        const newPkg = {
          id: newPkgId, business_id: _activeBizId, customer_id: cust.id,
          service_id: svc.id, service_name: svc.name,
          total_count: total, used_count: used,
          purchased_at: new Date().toISOString(),
          note: _pkgBranchShort ? `매장:${_pkgBranchShort.replace(/점$|본점$/,'')}` : "",
          branch_id: branchId || null,
        };
        sb.insert("customer_packages", newPkg).catch(console.error);
        _newTriggerPkgIds.pkg_purchase.push(newPkgId);
        if (used > 0) _firstUsePkgIds.push({pkgId: newPkgId, firstUseDate: _todayStr});
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

    // ── 신규 연간회원권/연간할인권 구매 처리 ──
    // 보유권으로 발급해서 회원가 자격 부여.
    // 유효기간 규칙:
    //   - 유효한 기존 연간권 보유 시 → 기존 만료일 다음날부터 1년 (선구매 갱신 누적)
    //   - 없으면 → 오늘 + 1년 - 1일 (당일부터 1년)
    if (cust.id && newAnnualPurchases.length > 0) {
      // 기존 활성 연간권의 가장 늦은 만료일 추출
      const _today = new Date(); _today.setHours(0,0,0,0);
      const _activeAnnualExp = (custPkgs||[]).reduce((latest, p) => {
        const isAnnual = _isAnnualSvc({name: p.service_name, cat: ""});
        if (!isAnnual) return latest;
        const m = (p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/);
        if (!m) return latest;
        const expD = new Date(m[1]);
        if (isNaN(expD.getTime()) || expD < _today) return latest; // 만료된 건 무시
        return (!latest || expD > latest) ? expD : latest;
      }, null);

      newAnnualPurchases.forEach(svc => {
        const newPkgId = uid();
        const _annBranchShort = (data?.branches||[]).find(b=>b.id===branchId)?.short || "";
        let _expD;
        if (_activeAnnualExp) {
          // 기보유 만료일 다음날부터 1년
          _expD = new Date(_activeAnnualExp);
          _expD.setDate(_expD.getDate() + 1);          // 다음날 (시작일)
          _expD.setFullYear(_expD.getFullYear() + 1);  // +1년
          _expD.setDate(_expD.getDate() - 1);          // -1일 = 만료일
        } else {
          // 신규: 당일 + 1년 - 1일
          _expD = new Date(); _expD.setFullYear(_expD.getFullYear()+1); _expD.setDate(_expD.getDate()-1);
        }
        const _expStr = `${_expD.getFullYear()}-${String(_expD.getMonth()+1).padStart(2,"0")}-${String(_expD.getDate()).padStart(2,"0")}`;
        let _note = `유효:${_expStr}`;
        if (_annBranchShort) _note += ` | 매장:${_annBranchShort.replace(/점$|본점$/,'')}`;
        const newPkg = {
          id: newPkgId, business_id: _activeBizId, customer_id: cust.id,
          service_id: svc.id, service_name: svc.name,
          total_count: 1, used_count: 0,
          purchased_at: new Date().toISOString(),
          note: _note,
          branch_id: branchId || null,
        };
        sb.insert("customer_packages", newPkg).catch(console.error);
        _newTriggerPkgIds.annual_purchase.push(newPkgId);
        const _txNote = _activeAnnualExp
          ? `선구매 갱신 (기존 만료 ${_activeAnnualExp.toISOString().slice(0,10)} 다음날 ~ ${_expStr})`
          : `신규 구매 (연간 ~ ${_expStr})`;
        _pkgTxRecords.push({
          package_id: newPkgId, service_name: svc.name,
          type: "charge", unit: "count", amount: 1,
          balance_before: 0, balance_after: 1,
          note: _txNote,
        });
      });
    }
    // ── 결제수단 svc/prod 분할 — 통합 입력 박스에서 받은 금액을 시술액 우선 충당, 잔액은 제품으로
    //    items 분류(SVC_LIST/PROD_LIST) 기반의 svcPayTotal/prodPayTotal에 정확히 일치
    let _svcRem = svcPayTotal;
    const _splitMethod = (totalAmt) => {
      const toSvc = Math.min(_svcRem, totalAmt || 0);
      _svcRem -= toSvc;
      return { svc: toSvc, prod: (totalAmt || 0) - toSvc };
    };
    const _cashSplit = _splitMethod(payMethod.svcCash);
    const _cardSplit = _splitMethod(payMethod.svcCard);
    const _xferSplit = _splitMethod(payMethod.svcTransfer);
    const _pointSplit = _splitMethod(payMethod.svcPoint);

    const sale = {
      id: uid(), bid: selBranch,
      custId: cust.id || null, custName: custName,
      custPhone: custPhone, custGender: gender,
      custNum: cust.custNum || cust.cust_num || "",
      staffId: manager, staffName: staff?.dn || "",
      date: reservation?.date || todayStr(),
      serviceId: reservation?.serviceId || null, serviceName: SVC_LIST.find(s => s.id === reservation?.serviceId)?.name || "",
      productId: null, productName: null,
      svcCash: _cashSplit.svc, svcTransfer: _xferSplit.svc, svcCard: _cardSplit.svc, svcPoint: _pointSplit.svc, svcComped: svcCompedTotal || 0,
      prodCash: _cashSplit.prod, prodTransfer: _xferSplit.prod, prodCard: _cardSplit.prod, prodPoint: _pointSplit.prod, prodComped: prodCompedTotal || 0,
      gift: 0, orderNum: String(252000 + Math.floor(Math.random() * 200)),
      reservationId: reservation?.id || null,
      externalPrepaid: externalPrepaid > 0 ? externalPrepaid : 0,
      externalPlatform: externalPrepaid > 0 ? (externalPlatform || "") : null,
      memo: (isPkgUseSubmit ? "[패키지 사용] " : "") + (externalPrepaid > 0 && externalPlatform ? `[${externalPlatform} 선결제 ${externalPrepaid.toLocaleString()}원] ` : "") + (saleMemo || ""),
      createdAt: new Date().toISOString(),
      // 📸 매출 등록 시점 스냅샷 — 매출확인 모달이 그 시점 잔액·보유권을 그대로 보여주기 위함
      // (customer_packages·point는 매출 후 차감되어 잔액이 변하므로 시점값 보존 필요)
      snapshotData: {
        custPkgs: (custPkgs || []).map(p => ({
          id: p.id, customer_id: p.customer_id, service_name: p.service_name,
          total_count: p.total_count, used_count: p.used_count, note: p.note,
          purchase_date: p.purchase_date, _shared_from: p._shared_from || null,
          _owner_gender: p._owner_gender || null,
        })),
        pointBalance: pointBalance,
        ts: new Date().toISOString(),
      },
    };

    // ── sale_details 생성: 수동 등록 툴과 동일한 포맷 (cash/card/bank/point 분배 없음, 결제수단 합계는 sales 테이블에만) ──
    const _saleDetails = [];
    let _detailNo = 0;
    const nowIso = new Date().toISOString();
    // pushDetail(name, price, qty, item_kind) — item_kind 명시 저장 (svc/prod/discount/event_*/coupon_*/pkg_*/share_surcharge)
    const pushDetail = (name, price, qty, item_kind) => _saleDetails.push({
      id: "sd_" + uid(), business_id: _activeBizId, sale_id: sale.id, order_num: sale.orderNum,
      service_no: ++_detailNo, service_name: name, unit_price: price, qty: Math.max(1, Number(qty) || 1),
      cash: 0, card: 0, bank: 0, point: 0,
      sex_div: gender || "", item_kind: item_kind || null, created_at: nowIso,
    });
    // 시술
    SVC_LIST.forEach(svc => {
      const it = items[svc.id];
      if (it?.checked && (it.amount || 0) > 0) {
        // 체험단으로 제공된 시술은 [체험단] 프리픽스로 기록 (매출 상세에서 구분)
        pushDetail(it.comped ? `[체험단] ${svc.name}` : svc.name, it.amount, 1, 'svc');
      }
    });
    // 추가 시술
    if (items.extra_svc?.checked && (items.extra_svc.amount || 0) > 0) {
      pushDetail(items.extra_svc.label || items.extra_svc.name || "추가 시술", items.extra_svc.amount, 1, 'svc');
    }
    // 제품 (수량 반영)
    PROD_LIST.forEach(p => {
      const it = items[p.id];
      if (it?.checked && (it.amount || 0) > 0) {
        pushDetail(it.comped ? `[체험단] ${p.name}` : p.name, it.amount, it.qty || 1, 'prod');
      }
    });
    // 추가 제품
    if (items.extra_prod?.checked && (items.extra_prod.amount || 0) > 0) {
      pushDetail(items.extra_prod.label || items.extra_prod.name || "추가 제품", items.extra_prod.amount, 1, 'prod');
    }
    // 할인
    if (items.discount?.checked && (items.discount.amount || 0) > 0) {
      pushDetail("[할인]", items.discount.amount, 1, 'discount');
    }
    // 이벤트 할인·적립 기록 (promoResults 기반)
    promoResults.forEach(r => {
      if (r.discount > 0) pushDetail(`[이벤트 할인] ${r.name}${r.reason?` (${r.reason})`:""}`, r.discount, 1, 'event_discount');
      if (r.earn > 0) pushDetail(`[이벤트 적립] ${r.name}${r.reason?` (${r.reason})`:""}`, r.earn, 1, 'event_earn');
    });
    // 쿠폰 자동적용 기록 (activeCoupons 기반)
    activeCoupons.forEach(c => {
      if (c.discount > 0) pushDetail(`[쿠폰 할인] ${c.name}`, c.discount, 1, 'coupon_discount');
      if (c.earn > 0) pushDetail(`[쿠폰 적립] ${c.name}`, c.earn, 1, 'coupon_earn');
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
        pushDetail(`[보유권 사용] ${baseName}`, 0, 1, 'pkg_use');
      });
      // 다담권 (잔액 차감)
      Object.entries(pkgUse||{}).forEach(([pkgId, v]) => {
        if (typeof v !== "number" || v <= 0) return;
        const pkg = custPkgs.find(p => p.id === pkgId);
        if (!pkg) return;
        const t = _pkgType(pkg);
        if (t !== "prepaid") return; // 다회권은 위에서 처리됨
        const baseName = (pkg?.service_name||"").split("(")[0].trim() || "다담권";
        pushDetail(`[보유권 차감] ${baseName}`, v, 1, 'pkg_deduct');
      });
    } catch(e) { console.warn("[sale_details pkgUse]", e); }
    // 쉐어 남녀 보정금 기록 (id_nfv71exl14 수정요청)
    if (shareSurchargeTotal > 0) {
      pushDetail("[쉐어 보정금] 여→남 추가금", shareSurchargeTotal, 1, 'share_surcharge');
    }
    // ── sales → sale_details 순차 insert (FK 의존) ──
    // 부모(ReservationModal/SalesPage)가 중복 insert 하지 않도록 sale 객체에 _alreadySaved 플래그
    try {
      const inserted = await sb.insert("sales", toDb("sales", sale));
      if (!inserted) {
        // sb.insert가 이미 alert 띄움
        return;
      }
    } catch (e) {
      showAlert("매출 저장 실패: " + (e?.message || e));
      return;
    }
    if (_saleDetails.length > 0) {
      await sb.upsert("sale_details", _saleDetails);
    }

    // ── 예약 시술시간 자동 조정 (수연 수정요청 id_tgvgfsjvoz) ──
    // 원칙: 매출등록 시각이 예약 종료보다 "늦으면" 예약 건들지 않음 (늘이기 금지).
    //       매출등록 시각이 예약 종료보다 "짧으면(일찍 끝남)" 예약 종료를 매출 등록 시각으로 축소.
    try {
      if (!editMode && reservation?.id && reservation?.time && reservation?.dur) {
        const now = new Date();
        const nowMin = now.getHours()*60 + now.getMinutes();
        const [rh, rm] = String(reservation.time).split(":").map(Number);
        const resStartMin = (rh||0)*60 + (rm||0);
        const newDur = nowMin - resStartMin;
        const origDur = Number(reservation.dur) || 0;
        // newDur < origDur: 예약보다 일찍 끝남 → 축소만
        if (newDur > 0 && origDur > 0 && newDur < origDur) {
          const minDur = Math.max(5, origDur - 60); // 안전 하한 (원본 기준 -60분)
          const clampedDur = Math.max(minDur, newDur);
          if (clampedDur !== origDur) {
            await sb.update("reservations", reservation.id, { dur: clampedDur });
            if (setData) {
              setData(prev => ({
                ...prev,
                reservations: (prev?.reservations||[]).map(r => r.id === reservation.id ? {...r, dur: clampedDur} : r)
              }));
            }
          }
        }
      }
    } catch(e) { console.warn("[reservation dur auto-adjust]", e); }

    // 재생케어 체험 할인 쿠폰 자동 발행 — 첫 매출 고객에게만 1회 (재발행 금지)
    (async () => {
      if (!cust.id) return;
      try {
        const couponSvc = (data?.services||[]).find(s => s.name === '재생케어 체험 할인');
        if (!couponSvc) return;
        const existing = await sb.get("customer_packages", `&customer_id=eq.${cust.id}&service_id=eq.${couponSvc.id}&limit=1`);
        if (existing?.length) return;
        // 첫 매출 여부 — 방금 insert한 매출 포함 sales 1건이면 첫 매출
        const salesList = await sb.get("sales", `&cust_id=eq.${cust.id}&select=id&limit=2`);
        if (!salesList || salesList.length !== 1) return;
        await sb.insert("customer_packages", {
          id: "cpn_regen30k_" + uid(),
          business_id: _activeBizId,
          customer_id: cust.id,
          service_id: couponSvc.id,
          service_name: couponSvc.name,
          total_count: 1, used_count: 0,
          purchased_at: new Date().toISOString(),
          note: '재생케어 체험 할인 자동 발행 (첫 매출)',
          branch_id: branchId || null,
        });
      } catch (e) { console.warn("[regen30k coupon auto-issue]", e); }
    })();

    // 이벤트 자동 쿠폰 발행 (trigger 충족 시)
    // 트리거가 prepaid/pkg/annual_purchase면 → 발행된 보유권에 연결, 첫 사용일에 유효기간 시작
    if (cust.id && eventResult?.issueCoupons?.length) {
      eventResult.issueCoupons.forEach(c => {
        const svc = (data?.services||[]).find(s => s.name === c.name);
        if (!svc) return;
        const trigger = c.trigger;
        const isPurchaseTrigger = trigger === 'prepaid_purchase' || trigger === 'pkg_purchase' || trigger === 'annual_purchase';
        const linkPkgId = isPurchaseTrigger ? (_newTriggerPkgIds[trigger] || [])[0] : null;
        // 보유권 연결 발행: 유효대기 + 연결 + 만료개월 메타. 첫 사용일에 활성화
        // 일반 발행: 발행 시점 + N개월 만료 (기존 동작)
        let noteCore;
        if (linkPkgId) {
          const expM = Number(c.expiryMonths) > 0 ? Number(c.expiryMonths) : 3;
          noteCore = `유효대기 | 연결:${linkPkgId} | 만료개월:${expM}`;
        } else {
          const expNote = c.expiresAt ? ` | 유효:${c.expiresAt.slice(0,10)}` : '';
          noteCore = `이벤트 자동 발행(${c.evtName})${expNote}`;
        }
        for (let i = 0; i < (c.qty||1); i++) {
          sb.insert("customer_packages", {
            id: "cpn_evt_" + uid(),
            business_id: _activeBizId, customer_id: cust.id,
            service_id: svc.id, service_name: svc.name,
            total_count: 1, used_count: 0,
            purchased_at: new Date().toISOString(),
            note: linkPkgId
              ? `이벤트 자동 발행(${c.evtName}) | ${noteCore} | 매출${sale.id}`
              : `${noteCore} | 매출${sale.id}`,
            branch_id: branchId || null,
          }).catch(console.error);
        }
      });
    }
    // 보유권 첫 사용 → 연결된 대기 쿠폰 활성화 (구매 즉시 차감 케이스 + 기존 보유권 첫 사용)
    if (cust.id && _firstUsePkgIds.length > 0) {
      (async () => {
        try {
          for (const {pkgId, firstUseDate} of _firstUsePkgIds) {
            // 이 pkgId에 연결된 대기 쿠폰 검색
            const linked = await sb.get("customer_packages",
              `&customer_id=eq.${cust.id}&note=ilike.*연결:${pkgId}*&note=ilike.*유효대기*`);
            if (!Array.isArray(linked) || linked.length === 0) continue;
            for (const cpn of linked) {
              const noteStr = cpn.note || "";
              const m = noteStr.match(/만료개월:(\d+)/);
              const expM = m ? Number(m[1]) : 3;
              const start = new Date(firstUseDate);
              start.setMonth(start.getMonth() + expM);
              const expStr = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
              const newNote = noteStr
                .replace(/유효대기/, `유효:${expStr}`)
                .replace(/\s*\|\s*만료개월:\d+/, "");
              sb.update("customer_packages", cpn.id, {note: newNote}).catch(console.error);
            }
          }
        } catch (e) { console.warn("[coupon activate]", e); }
      })();
    }
    // 쿠폰 수동 발행 (쿠폰별 유효기간 — promoConfig.expiryMonths, 미설정 시 3개월 기본)
    if (cust.id && Object.keys(issueCouponIds).length > 0) {
      const today = new Date();
      const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      Object.entries(issueCouponIds).forEach(([svcId, count]) => {
        const svc = (data?.services||[]).find(s => s.id === svcId);
        if (!svc || !count || count <= 0) return;
        let pc = svc.promoConfig;
        if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch { pc = {}; } }
        const expM = Number(pc?.expiryMonths) > 0 ? Number(pc.expiryMonths) : 3;
        const exp = new Date(today); exp.setMonth(exp.getMonth() + expM);
        const note = `발행:${fmtD(today)} | 유효:${fmtD(exp)} | 매출${sale.id} 동시발행`;
        for (let i = 0; i < count; i++) {
          sb.insert("customer_packages", {
            id: "cpn_" + uid(),
            business_id: _activeBizId,
            customer_id: cust.id,
            service_id: svc.id,
            service_name: svc.name,
            total_count: 1, used_count: 0,
            purchased_at: today.toISOString(),
            note,
            branch_id: branchId || null,
          }).catch(console.error);
        }
      });
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
      // 🆕 보유권 사용 알림톡 — type=deduct + 010~ phone일 때 alimtalk_queue 적재
      // 다회권(unit=count) → noti_key='tkt_pay' (보유/사용/잔여 회수)
      // 다담권(unit=won) → noti_key='pkg_pay' (충전/사용/잔액)
      try {
        const cleanPhone = (cust.phone||"").replace(/-/g,"").trim();
        const isMobile = /^01[0-9]{8,9}$/.test(cleanPhone);
        if (isMobile) {
          const today = new Date();
          const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          // package_id별로 같은 권에서 다회 deduct 합산 (이번 매출 한정)
          const grouped = {};
          _pkgTxRecords.filter(r => r.type === 'deduct').forEach(r => {
            const k = r.package_id;
            if (!grouped[k]) grouped[k] = { ...r, amount: 0 };
            grouped[k].amount += (r.amount || 0);
            grouped[k].balance_after = r.balance_after; // 마지막 값
          });
          Object.values(grouped).forEach(r => {
            const pkg = (custPkgs||[]).find(p => p.id === r.package_id) || {};
            const note = pkg.note || "";
            const expM = note.match(/유효:\s*(\d{4}-\d{2}-\d{2})/);
            const startStr = pkg.purchased_at ? fmtD(new Date(pkg.purchased_at)) : "";
            const endStr = expM ? expM[1] : "";
            let notiKey, params;
            if (r.unit === 'count') {
              const total = pkg.total_count || 0;
              const usedTotal = (pkg.used_count || 0) + r.amount;
              const remain = Math.max(0, total - usedTotal);
              notiKey = 'tkt_pay';
              params = {
                "#{고객명}": cust.name || "",
                "#{총횟수}": total,
                "#{사용횟수}": r.amount, // 이번 매출 사용 회수
                "#{잔여횟수}": remain,
                "#{시작일}": "시작일", // 마이그레이션 데이터로 정확한 시작일 부재 → 라벨로 대체
                "#{종료일}": endStr,
                "#{매장명}": (data?.branches||[]).find(b=>b.id===branchId)?.name || "",
                "#{대표전화번호}": (data?.branches||[]).find(b=>b.id===branchId)?.phone || "",
              };
            } else if (r.unit === 'won') {
              notiKey = 'pkg_pay';
              params = {
                "#{고객명}": cust.name || "",
                "#{충전금액}": (r.balance_before + (pkg.used_count || 0)).toLocaleString(),
                "#{사용금액}": r.amount.toLocaleString(),
                "#{잔액}": r.balance_after.toLocaleString(),
                "#{매장명}": (data?.branches||[]).find(b=>b.id===branchId)?.name || "",
                "#{대표전화번호}": (data?.branches||[]).find(b=>b.id===branchId)?.phone || "",
              };
            }
            if (notiKey) {
              sb.insert("alimtalk_queue", {
                branch_id: branchId, noti_key: notiKey, phone: cleanPhone,
                params, status: "pending", channel: "alimtalk"
              }).catch(e => console.warn("[tkt_pay queue]", e));
            }
          });
        }
      } catch(e) { console.warn("[tkt_pay trigger]", e); }
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
        // 이벤트로 자동 적립된 경우 만료일 부여
        const _evt = newCustEventEarn.evt;
        const _evtApplied = _evt && newCustEventEarn.earn > 0 && pointEarn === newCustEventEarn.earn;
        let _expires = null, _source = null, _note = "매출 적립";
        if (_evtApplied) {
          const d = new Date(); d.setMonth(d.getMonth() + (Number(_evt.expiryMonths)||3));
          _expires = d.toISOString();
          _source = "event_newcust_10pct";
          _note = `신규 고객 ${_evt.rate}% 이벤트 적립`;
        }
        sb.insert("point_transactions", {
          id: "ptx_"+uid(), business_id: _activeBizId, bid: sale.bid,
          customer_id: cust.id, type: "earn", amount: pointEarn,
          balance_after: balAfter, sale_id: sale.id, staff_id: sale.staffId,
          staff_name: sale.staffName, note: _note,
          ...(("expires_at" in {})?{}:{}),
          ...(_expires ? { expires_at: _expires } : {}),
          ...(_source ? { source: _source } : {}),
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
  // 카테고리별 그룹 — '쿠폰' 카테고리는 증정/발행 대상이지 구매 대상이 아니므로 제외
  const catGroups = CATS.filter(cat => cat.name !== '쿠폰').map(cat => ({
    cat,
    svcs: SVC_LIST.filter(s => s.cat === cat.id)
  })).filter(g => g.svcs.length > 0);
  const COUPON_CAT_IDS = CATS.filter(c => c.name === '쿠폰').map(c => c.id);
  const uncatSvcs = SVC_LIST.filter(s => !CATS.find(c=>c.id===s.cat) && !COUPON_CAT_IDS.includes(s.cat));
  const halfProd = Math.ceil(PROD_LIST.length / 2);

  // 모바일 감지: 700px 이하면 1단 세로 레이아웃 (좌·우 패널을 위아래로 쌓음)
  const [_m, _setM] = useState(() => typeof window !== "undefined" && window.innerWidth <= 700);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => _setM(window.innerWidth <= 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const _overlayDownRef = React.useRef(false);
  return (
    <div
      onMouseDown={_m?undefined:e=>{_overlayDownRef.current=(e.target===e.currentTarget);}}
      onClick={_m?undefined:e=>{if(_overlayDownRef.current && e.target===e.currentTarget)onClose(); _overlayDownRef.current=false;}}
      style={_m?{
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
        {/* Header — 1줄: 제목 + 닫기 */}
        <div style={{padding:"7px 14px",borderBottom:"1px solid #e0e0e0",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.gray100,borderRadius:"12px 12px 0 0"}}>
          <h3 style={{margin:0,fontSize:15,fontWeight:800,color:viewOnly?T.primary:T.danger}}><I name={viewOnly?"wallet":"diamond"} size={14}/> {viewOnly ? "매출 확인" : (editMode ? "매출 수정" : "매출 입력")}</h3>
          <button onClick={onClose} className="close-btn" style={{fontSize:18}}><I name="x" size={16}/></button>
        </div>
        {/* 고객정보 + 남녀 — 강조 (큰 영역) */}
        <div style={{padding:"10px 14px",borderBottom:"1px solid #e0e0e0",background:T.dangerLt,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{color:T.textSub,fontWeight:700,fontSize:12,flexShrink:0}}>고객명</span>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",flex:1}}>
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
                <strong style={{ color: T.gray700, fontSize: 14 }}>{cust.name}</strong>
                {cust.custNum && <span style={{ fontSize: 11, color: T.gray500, fontFamily: "monospace", fontWeight: 600 }}>#{cust.custNum}</span>}
                <span style={{ fontSize: 12, color: T.textSub, fontWeight: 500 }}>{cust.phone}</span>
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
          {/* 시술자 — 고객 정보 행으로 이동 */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, flexShrink:0 }}>
            <span style={{ color:T.textSub, fontWeight: 700, fontSize:11 }}>시술자 <span style={{color:T.danger}}>*</span></span>
            <select style={{ width:100, height:22, padding:"0 4px", fontSize:11, lineHeight:"1", border:`1px solid ${manager ? T.gray400 : T.danger}`, background: manager ? T.bgCard : T.dangerLt, borderRadius:4, fontFamily:"inherit", outline:"none", boxSizing:"border-box", minHeight:0 }} value={manager} onChange={e => setManager(e.target.value)}>
              <option value="">시술자 선택</option>
              {(() => {
                // 타임라인과 동일한 로직: schHistory + empOverride + 자동이동(예약 기반) 반영
                // 실제로 오늘 타임라인에 노출되는 직원만 표시
                const isActiveRes = (r) => r && r.status !== 'naver_changed' && r.status !== 'cancelled' && r.status !== 'naver_cancelled';
                const reservations = data?.reservations || [];

                const getEffBranch = (staff) => {
                  if (!staff?.dn) return null;
                  const st = schHistory?.[staff.dn]?.[saleDate];
                  // 휴무/무급 → 표시 안 함
                  if (st === "휴무" || st === "휴무(꼭)" || st === "무급") return null;
                  // 지원(X) → 그 지점
                  if (typeof st === "string" && st.startsWith("지원(")) {
                    const brName = st.slice(3, -1).trim();
                    const br = (data?.branches||[]).find(b =>
                      (b.short||"").replace("점","") === brName || (b.name||"").includes(brName)
                    );
                    if (br) return br.id;
                  }
                  // empOverride exclusive → override 지점
                  const ov = empOverride?.[`${staff.dn}_${saleDate}`];
                  if (ov?.exclusive && ov.segments?.[0]?.branchId) return ov.segments[0].branchId;
                  // home branch 결정: 남자직원이면 주간 로테이션, 아니면 staff.bid
                  const empInfo = employeesV1?.[staff.dn];
                  let homeBid = staff.bid;
                  if (empInfo?.isMale) {
                    const rotBid = getRotationBranchId(staff.dn, saleDate);
                    if (rotBid) homeBid = rotBid;
                  }
                  // 자동이동: 다른 지점에 활성 예약 있고 home에 없으면 → 그 지점
                  const otherRes = reservations.find(r => r.date === saleDate && r.staffId === staff.dn && r.bid && r.bid !== homeBid && isActiveRes(r));
                  const homeRes = reservations.find(r => r.date === saleDate && r.staffId === staff.dn && r.bid === homeBid && isActiveRes(r));
                  if (otherRes && !homeRes) return otherRes.bid;
                  // schHistory에 등록된 직원 (근무, 지원 등 비휴무 entry)
                  if (typeof st === "string" && st.length > 0) return homeBid;
                  // schHistory 미등록이지만 남자직원이면 로테이션 지점에 노출 (타임라인과 동일)
                  if (empInfo?.isMale) return homeBid;
                  return null;
                };

                const staffByBranch = {};
                augmentedStaff.forEach(s => {
                  if (!s.dn) return;
                  const eff = getEffBranch(s);
                  if (!eff) return; // 휴무/미등록 → 표시 안 함
                  if (!staffByBranch[eff]) staffByBranch[eff] = [];
                  staffByBranch[eff].push(s);
                });

                const renderStaff = (s) => <option key={s.id} value={s.id}>{s.dn}</option>;
                const currentGroup = staffByBranch[selBranch] || [];
                const otherBranches = (data.branches||[]).filter(b => b.id !== selBranch && staffByBranch[b.id]?.length);
                return <>
                  {currentGroup.length > 0 && <optgroup label={`현재 지점 근무`}>
                    {currentGroup.map(s => renderStaff(s))}
                  </optgroup>}
                  {otherBranches.map(br => (
                    <optgroup key={br.id} label={`${br.short||br.name} (타지점)`}>
                      {staffByBranch[br.id].map(s => renderStaff(s))}
                    </optgroup>
                  ))}
                </>;
              })()}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <span style={{ color:T.textSub, fontSize:11 }}>지점 <span style={{color:T.danger}}>*</span></span>
            <select style={{ flex:1, minWidth:80, maxWidth:130, height:22, padding:"0 4px", fontSize:11, lineHeight:"1", border:`1px solid ${selBranch ? T.gray400 : T.danger}`, background:selBranch ? T.bgCard : T.dangerLt, borderRadius:4, fontFamily:"inherit", outline:"none", boxSizing:"border-box", minHeight:0 }} value={selBranch} onChange={e => setSelBranch(e.target.value)}>
              <option value="">지점 선택</option>
              {(data.branches||[])
                .filter(b => !userBranches || userBranches.length === 0 || userBranches.includes(b.id))
                .map(b => <option key={b.id} value={b.id}>{b.short || b.name}</option>)}
            </select>
          </div>
          {/* (Totals 제거 — 우측 패널에 중복 표시되어 있음) */}
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
                // 이름 + 소유자로 그룹핑
                // 이유: 동명 패키지라도 소유자 성별에 따라 가격 다름 → 본인/쉐어(소유자별) 분리 표시
                // groupKey = "이름∷self" (본인) 또는 "이름∷shared_{owner_id}" (쉐어)
                const groups = {};
                activeMultiPkgs.forEach(p => {
                  const name = (p.service_name?.split("(")[0]||"").replace(/\s*\d+회$/,"").trim();
                  const ownerKey = p._shared_from ? `shared_${p.customer_id}` : 'self';
                  const key = name + '∷' + ownerKey;
                  if (!groups[key]) groups[key] = {
                    name, ownerKey, pkgs: [], totalRemain: 0,
                    sharedFrom: p._shared_from || null,
                    ownerGender: p._owner_gender || null,
                  };
                  groups[key].pkgs.push(p);
                  groups[key].totalRemain += (p.total_count - p.used_count);
                });
                return Object.values(groups).map(g => {
                  const useQty = g.pkgs.reduce((s,p) => s + (pkgItems["pkg__"+p.id]?.qty||0), 0);
                  const isActive = useQty > 0;
                  const groupKey = g.name + '∷' + g.ownerKey;
                  // 쉐어 보정금 힌트: 여자 소유 + 남자 사용
                  const surchargeHint = (g.sharedFrom && g.ownerGender === 'F' && gender === 'M');
                  return <div key={groupKey} className="sale-svc-row"
                    onClick={() => setPkgQty(groupKey, isActive ? 0 : 1)}
                    style={{display:"flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:4,
                      background:isActive?"#7c7cc810":"transparent",cursor:"pointer",lineHeight:1.4}}>
                    <span style={{flex:1,fontSize:13,color:isActive?T.text:T.gray700,fontWeight:isActive?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {isActive&&<span style={{color:T.primary,marginRight:3}}>✓</span>}{g.name}
                      {g.sharedFrom
                        ? <span style={{marginLeft:6,fontSize:9,padding:"1px 6px",borderRadius:8,background:"#F5F3FF",color:"#5B21B6",border:"1px solid #C4B5FD",fontWeight:700}}>🤝 쉐어 · {g.sharedFrom}{g.ownerGender ? (g.ownerGender === 'F' ? ' (여)' : ' (남)') : ''}</span>
                        : <span style={{marginLeft:6,fontSize:9,padding:"1px 6px",borderRadius:8,background:"#E0E7FF",color:"#3730A3",border:"1px solid #C7D2FE",fontWeight:700}}>본인</span>
                      }
                      {surchargeHint && <span title="여자 패키지를 남자가 사용 → +33,000원 보정" style={{marginLeft:4,fontSize:9,padding:"1px 5px",borderRadius:6,background:"#FEF3C7",color:"#92400E",fontWeight:700}}>+33,000원</span>}
                    </span>
                    <span style={{flexShrink:0,fontSize:11,color:T.gray700,fontWeight:700}}>잔여 {g.totalRemain}회</span>
                    <span style={{flexShrink:0,width:95,textAlign:"right",padding:"0 6px",fontSize:13,fontWeight:isActive?700:400,color:isActive?T.danger:T.gray400}}>
                      {isActive ? "1회 사용" : "0원"}
                    </span>
                  </div>;
                });
              })()}
              </div>
            </div>}
            {/* 보유 쿠폰 (관리설정 → 혜택관리 → 쿠폰등록) v3.7.216 */}
            {activeCustCoupons.length > 0 && <div style={{marginBottom:6,border:"1px solid #f59e0b",borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",padding:"7px 10px",background:"#fff8e1"}}>
                <span style={{fontSize:13,fontWeight:700,color:"#b45309"}}>🎫 보유 쿠폰 ({activeCustCoupons.length})</span>
                <span style={{marginLeft:"auto",fontSize:10,color:"#92400e",fontWeight:600}}>적용 시술 {Object.keys(couponEligibleMap).length}건 사용 가능</span>
              </div>
              <div style={{padding:"4px 0"}}>
                {(()=>{
                  // 쿠폰 카테고리 시술만 매칭 (이름 충돌 방지)
                  const _couponCatId = (data?.categories||[]).find(c => c.name === '쿠폰')?.id;
                  const _couponSvcs = (data?.services||[]).filter(s => s.cat === _couponCatId);
                  return activeCustCoupons.map(pkg => {
                  const svc = _couponSvcs.find(s => s.name === pkg.service_name);
                  let pc = svc?.promoConfig;
                  if (typeof pc === "string") { try { pc = JSON.parse(pc); } catch { pc = null; } }
                  const sids = (pc && (pc.couponTargetServiceIds || (pc.couponTargetServiceId ? [pc.couponTargetServiceId] : []))) || [];
                  const targetSvcs = sids.map(sid => (data?.services||[]).find(s => s.id === sid)).filter(Boolean);
                  const remain = (pkg.total_count||0) - (pkg.used_count||0);
                  const exp = ((pkg.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1] || "";
                  const typeLabel = pc?.couponType === 'free_service' ? '무료'
                    : pc?.couponType === 'flat' ? `${(pc.couponValue||0).toLocaleString()}원 할인`
                    : pc?.couponType === 'percent' ? `${pc.couponValue||0}% 할인`
                    : pc?.couponType === 'point_bonus_pct' ? `${pc.couponValue||0}% 추가적립`
                    : '쿠폰';
                  const allChecked = targetSvcs.length > 0 && targetSvcs.every(s => items[s.id]?.checked);
                  const onClickCoupon = () => {
                    // 적용 시술 1개 → 자동 카트 체크. 여러 개면 → 안내만 (직원이 시술 직접 클릭)
                    if (targetSvcs.length === 1) {
                      const s = targetSvcs[0];
                      if (items[s.id]?.checked) return; // 이미 체크됨
                      const dp = _defPrice(s, gender);
                      toggle(s.id, dp);
                    }
                  };
                  return <div key={pkg.id} className="sale-svc-row"
                    onClick={onClickCoupon}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:4,
                      background:allChecked?"#fff8e1":"transparent",cursor:targetSvcs.length===1?"pointer":"default",lineHeight:1.4}}>
                    <span style={{fontSize:13,color:"#78350f",fontWeight:allChecked?700:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1,minWidth:0}}>
                      {allChecked && <span style={{color:"#b45309",marginRight:3}}>✓</span>}
                      🎫 {pkg.service_name}
                      <span style={{marginLeft:6,fontSize:9,padding:"1px 5px",borderRadius:6,background:"#fef3c7",color:"#92400e",fontWeight:700}}>{typeLabel}</span>
                      {targetSvcs.length > 1 && <span style={{marginLeft:6,fontSize:9,color:"#92400e"}}>· 적용 시술 {targetSvcs.length}개 (시술 카드 🎫 클릭)</span>}
                      {targetSvcs.length === 1 && !allChecked && <span style={{marginLeft:6,fontSize:9,color:"#b45309",fontWeight:700}}>→ 클릭하면 시술 자동 추가</span>}
                    </span>
                    <span style={{flexShrink:0,fontSize:11,color:"#92400e",fontWeight:700}}>잔여 {remain}회</span>
                    {exp && <span style={{flexShrink:0,fontSize:10,color:"#92400e"}}>{exp.replace(/^20(\d\d)/, '$1')}까지</span>}
                  </div>;
                  });
                })()}
              </div>
            </div>}
            {/* 신규 PKG 패키지 구매 + 오늘 1회 사용 (체크 즉시 시술 상단 노출) */}
            {newPkgPurchases.length > 0 && <div style={{marginBottom:8,padding:"8px 12px",background:"#EEF2FF",border:"1.5px dashed #6366F1",borderRadius:T.radius.md}}>
              <div style={{fontSize:11,fontWeight:T.fw.bolder,color:"#4338CA",marginBottom:6}}>📦 오늘 구매한 패키지 — 1회 사용</div>
              {newPkgPurchases.map(svc => {
                const used = Number(usePkgToday[svc.id] || 0);
                const total = parsePkgCount(svc.name);
                const isActive = used > 0;
                return <div key={svc.id} className="sale-svc-row"
                  onClick={()=>setUsePkgToday(p=>({...p, [svc.id]: isActive ? 0 : 1}))}
                  style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:4,
                    background:isActive?"#7c7cc810":"transparent",cursor:"pointer",lineHeight:1.4}}>
                  <span style={{flex:1,fontSize:13,color:isActive?T.text:T.gray700,fontWeight:isActive?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {isActive&&<span style={{color:T.primary,marginRight:3}}>✓</span>}{svc.name}
                  </span>
                  <span style={{flexShrink:0,fontSize:11,color:T.gray700,fontWeight:700}}>총 {total}회</span>
                  <span style={{flexShrink:0,width:95,textAlign:"right",padding:"0 6px",fontSize:13,fontWeight:isActive?700:400,color:isActive?T.danger:T.gray400}}>
                    {isActive ? "1회 사용" : "0원"}
                  </span>
                </div>;
              })}
            </div>}
            <div style={{ color:T.primary, padding: "6px 0 4px", marginBottom: 6, fontSize:14, fontWeight:800 }}>시술 ({SVC_LIST.length})</div>
            {hasCompedTag && <div style={{marginBottom:8,padding:"7px 10px",background:"#FFF3E0",border:"1.5px solid #E65100",borderRadius:8,fontSize:11,color:"#E65100",fontWeight:700,lineHeight:1.5}}>
              🎁 체험단 예약 — 체크한 시술·제품 행 오른쪽 <span style={{background:"#fff",padding:"1px 6px",borderRadius:4,border:"1px solid #E65100",fontWeight:800}}>🎁</span> 버튼을 눌러 무료 제공으로 전환하세요
            </div>}
            {catGroups.map(({cat, svcs}) => {
              const isOpen = isCatOpen(cat.id);
              const hasChecked = svcs.some(s=>items[s.id]?.checked);
              return (
              <div key={cat.id} style={{marginBottom:6,border:"1px solid "+T.border,borderRadius:8,overflow:"hidden"}}>
                <div onClick={()=>toggleCat(cat.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",cursor:"pointer",background:hasChecked?T.primaryHover:T.gray100}}>
                  <span style={{fontSize:13,fontWeight:700,color:hasChecked?T.primary:T.text}}>{cat.name}{hasChecked&&<span style={{marginLeft:6,fontSize:11,color:T.primary}}>✓ {svcs.filter(s=>items[s.id]?.checked).length}개 선택</span>}</span>
                  <I name={isOpen?"chevU":"chevD"} size={12} style={{color:T.gray400}}/>
                </div>
                {isOpen && <div style={{padding:"4px 0"}}>{(()=>{
                  // ── 옵션 페어 그룹화: note의 [pair:XX] 플래그 일치하는 두 record만 페어
                  const groups = [];
                  const usedIdx = new Set();
                  const _getPairId = (note) => {
                    const m = (note||"").match(/\[pair:([a-z0-9]+)\]/i);
                    return m ? m[1] : null;
                  };
                  const _getBaseAndOpt = (name) => {
                    const trimmed = (name||"").trim();
                    const parts = trimmed.split(/\s+/);
                    if (parts.length < 2) return null;
                    return { base: parts.slice(0,-1).join(' '), opt: parts[parts.length-1] };
                  };
                  for (let i = 0; i < svcs.length; i++) {
                    if (usedIdx.has(i)) continue;
                    const sv = svcs[i];
                    const pid = _getPairId(sv.note);
                    if (pid) {
                      const otherIdx = svcs.findIndex((s, j) => j !== i && !usedIdx.has(j) && _getPairId(s.note) === pid);
                      if (otherIdx >= 0) {
                        usedIdx.add(i); usedIdx.add(otherIdx);
                        const otherSvc = svcs[otherIdx];
                        const bo = _getBaseAndOpt(sv.name) || { base: sv.name, opt: '' };
                        const otherBo = _getBaseAndOpt(otherSvc.name) || { base: otherSvc.name, opt: '' };
                        const isHalfA = /절반|반/.test(bo.opt);
                        const isHalfB = /절반|반/.test(otherBo.opt);
                        let halfSvc, fullSvc, halfOpt, fullOpt;
                        if (isHalfA && !isHalfB) { halfSvc=sv; fullSvc=otherSvc; halfOpt=bo.opt; fullOpt=otherBo.opt; }
                        else if (!isHalfA && isHalfB) { halfSvc=otherSvc; fullSvc=sv; halfOpt=otherBo.opt; fullOpt=bo.opt; }
                        else { halfSvc=sv; fullSvc=otherSvc; halfOpt=bo.opt; fullOpt=otherBo.opt; }
                        groups.push({type:'pair', base: bo.base, full: fullSvc, half: halfSvc, halfOpt, fullOpt});
                        continue;
                      }
                    }
                    groups.push({type:'single', svc: sv});
                  }
                  return groups.map(g => {
                    // ── 페어 토글 행 (전체/절반 상호배타) ──
                    if (g.type === 'pair') {
                      const fullChecked = !!items[g.full.id]?.checked;
                      const halfChecked = !!items[g.half.id]?.checked;
                      const active = fullChecked || halfChecked;
                      const dpFull = _defPrice(g.full, gender);
                      const dpHalf = _defPrice(g.half, gender);
                      const activeSvc = fullChecked ? g.full : halfChecked ? g.half : null;
                      const activeAmt = items[activeSvc?.id]?.amount || (fullChecked ? dpFull : halfChecked ? dpHalf : 0);
                      const togglePair = (target) => {
                        const targetSvc = target === 'full' ? g.full : g.half;
                        const otherSvc = target === 'full' ? g.half : g.full;
                        const _needsG = !gender && (targetSvc.priceF||0) !== (targetSvc.priceM||0) && ((targetSvc.priceF||0) > 0 || (targetSvc.priceM||0) > 0);
                        if (_needsG) { showAlert("성별을 먼저 선택해주세요\n(시술 가격이 남녀 다릅니다)"); return; }
                        const wasChecked = !!items[targetSvc.id]?.checked;
                        const tdp = _defPrice(targetSvc, gender);
                        setItems(prev => ({
                          ...prev,
                          [targetSvc.id]: { ...prev[targetSvc.id], checked: !wasChecked, amount: !wasChecked ? tdp : 0 },
                          [otherSvc.id]: { ...prev[otherSvc.id], checked: false, amount: 0 },
                        }));
                      };
                      // 셀 분리: [이름+절반 | 이름+전체 | 분 | 금액]
                      const rowBg = active ? (T.primaryLt||"#EEF2FF") : "#F3F4F6";
                      const rowBd = active ? T.primary : "#E5E7EB";
                      const cellDiv = "1px solid rgba(0,0,0,.05)";
                      return <div key={`pair_${g.full.id}_${g.half.id}`} className="sale-svc-row"
                        style={{display:"flex",alignItems:"stretch",margin:"2px 0",borderRadius:5,overflow:"hidden",
                          background:rowBg,border:`1px solid ${rowBd}`,transition:"all .15s",lineHeight:1.4}}>
                        <div onClick={()=>togglePair('half')} title={`${dpHalf.toLocaleString()}원 · ${g.half.dur}분`}
                          style={{flex:1,padding:"3px 10px",display:"flex",alignItems:"center",gap:4,fontSize:13,fontWeight:halfChecked?700:400,color:halfChecked?T.text:T.gray700,background:halfChecked?"rgba(124,124,200,.18)":"transparent",cursor:"pointer",minWidth:0,opacity:fullChecked?0.4:1,transition:"opacity .15s"}}>
                          {halfChecked && <span style={{color:T.primary}}>✓</span>}
                          <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.base}{g.halfOpt}</span>
                        </div>
                        <div onClick={()=>togglePair('full')} title={`${dpFull.toLocaleString()}원 · ${g.full.dur}분`}
                          style={{flex:1,padding:"3px 10px",borderLeft:cellDiv,display:"flex",alignItems:"center",gap:4,fontSize:13,fontWeight:fullChecked?700:400,color:fullChecked?T.text:T.gray700,background:fullChecked?"rgba(124,124,200,.18)":"transparent",cursor:"pointer",minWidth:0,opacity:halfChecked?0.4:1,transition:"opacity .15s"}}>
                          {fullChecked && <span style={{color:T.primary}}>✓</span>}
                          <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.base}{g.fullOpt}</span>
                        </div>
                        <div style={{width:42,padding:"3px 6px",borderLeft:cellDiv,fontSize:10,color:active?T.text:T.gray500,fontWeight:active?600:400,display:"flex",alignItems:"center",justifyContent:"flex-end",flexShrink:0}}>
                          {activeSvc ? `${activeSvc.dur}분` : ""}
                        </div>
                        <div style={{width:95,padding:"3px 8px",borderLeft:cellDiv,fontSize:13,fontWeight:active?700:400,color:active?T.danger:T.gray400,display:"flex",alignItems:"center",justifyContent:"flex-end",flexShrink:0}}>
                          {active ? fmt(activeAmt) : ""}
                        </div>
                      </div>;
                    }
                    // ── 단일 시술 (기존 로직) ──
                    const svc = g.svc;
                    const it=items[svc.id]||{}; const dp=_defPrice(svc,gender);
                  // 케어 카테고리: 행 클릭 토글 + 수량 증감 버튼
                  if (cat.id === "cat_care_001" && dp > 0) {
                    const qty = it.qty || (it.checked ? 1 : 0);
                    const toggleRow = () => {
                      // 체크 안 되어있으면 1로, 체크되어 있으면 0으로 토글
                      const nq = qty > 0 ? 0 : 1;
                      setItems(prev=>({...prev,[svc.id]:{checked:nq>0,amount:dp*nq,qty:nq}}));
                    };
                    return <div key={svc.id} className="sale-svc-row" onClick={toggleRow}
                      style={{display:"flex",alignItems:"center",gap:4,padding:"1px 8px",borderRadius:4,
                      background:qty>0?"#7c7cc810":"transparent",cursor:"pointer",lineHeight:1.4}}>
                      <span style={{flex:1,fontSize:13,color:qty>0?T.text:T.gray700,fontWeight:qty>0?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {qty>0&&<span style={{color:T.primary,marginRight:3}}>✓</span>}{svc.name}
                      </span>
                      <span style={{flexShrink:0,width:28,textAlign:"right",fontSize:10,color:T.gray400}}>{svc.dur}분</span>
                      <div style={{display:"flex",alignItems:"center",gap:0,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                        <button onClick={(e)=>{e.stopPropagation();
                          const nq=Math.max(0,qty-1);
                          setItems(prev=>({...prev,[svc.id]:{checked:nq>0,amount:dp*nq,qty:nq}}));
                        }} style={{width:24,height:22,borderRadius:"5px 0 0 5px",border:"1px solid "+T.border,borderRight:"none",
                          background:T.bgCard,color:T.primary,fontSize:14,fontWeight:900,cursor:qty>0?"pointer":"not-allowed",opacity:qty>0?1:.4,padding:0,fontFamily:"inherit"}}>−</button>
                        <div style={{width:24,height:22,display:"flex",alignItems:"center",justifyContent:"center",
                          border:"1px solid "+T.border,borderLeft:"none",borderRight:"none",background:T.bgCard,
                          fontSize:13,fontWeight:800,color:qty>0?T.danger:T.gray400}}>{qty}</div>
                        <button onClick={(e)=>{e.stopPropagation();
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
                  const _needsG = !gender && (svc.priceF||0) !== (svc.priceM||0) && ((svc.priceF||0) > 0 || (svc.priceM||0) > 0);
                  return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} regularPrice={rp} toggle={toggle} setAmt={setAmt} badgeText={svc.badgeText} badgeColor={svc.badgeColor} badgeBg={svc.badgeBg} comped={!!it.comped} toggleComped={hasCompedTag ? toggleComped : undefined} needsGender={_needsG} onAlert={showAlert} hasCoupon={couponEligibleSvcIds.has(svc.id)} />;
                  });
                })()}</div>}
              </div>
              );
            })}
            {uncatSvcs.length>0 && <div style={{marginBottom:8}}>
              <div style={{fontSize:T.fs.nano,fontWeight:T.fw.bolder,color:T.textMuted,background:T.bg,borderRadius:T.radius.sm,padding:"2px 6px",marginBottom:2,display:"inline-block"}}>기타</div>
              {uncatSvcs.map(svc => { const it=items[svc.id]||{}; const dp=_defPrice(svc,gender); const rp=gender?(gender==="M"?svc.priceM:svc.priceF):0; const _needsG = !gender && (svc.priceF||0) !== (svc.priceM||0) && ((svc.priceF||0) > 0 || (svc.priceM||0) > 0); return <SaleSvcRow key={svc.id} id={svc.id} name={svc.name} dur={svc.dur} checked={!!it.checked} amount={it.amount||0} defPrice={dp} regularPrice={rp} toggle={toggle} setAmt={setAmt} badgeText={svc.badgeText} badgeColor={svc.badgeColor} badgeBg={svc.badgeBg} comped={!!it.comped} toggleComped={hasCompedTag ? toggleComped : undefined} needsGender={_needsG} onAlert={showAlert} hasCoupon={couponEligibleSvcIds.has(svc.id)} />; })}
            </div>}
            {/* (추가·할인은 제품 영역 아래로 이동 — 시술/제품 토글 포함) */}
          </div>

          {/* Col 3+4: Products - 아코디언 */}
          <div style={{gridColumn:"span 2"}}>
            <div style={{ color: T.info||"#1976D2", padding: "6px 0 4px", marginBottom: 6, fontSize:14, fontWeight:800 }}>제품 ({PROD_LIST.length})</div>
            <div style={{border:"1px solid "+T.border,borderRadius:8,overflow:"hidden",marginBottom:6}}>
              <div onClick={()=>setOpenCats(p=>({...p,__prod:!isCatOpen("__prod",{...p,__prod:p.__prod},"prod")}))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",cursor:"pointer",background:PROD_LIST.some(p=>items[p.id]?.checked)?T.successLt:T.gray100}}>
                <span style={{fontSize:13,fontWeight:700,color:PROD_LIST.some(p=>items[p.id]?.checked)?T.successDk:T.text}}>
                  제품 전체{PROD_LIST.some(p=>items[p.id]?.checked)&&<span style={{marginLeft:6,fontSize:11,color:T.successDk}}>✓ {PROD_LIST.filter(p=>items[p.id]?.checked).length}개 선택</span>}
                </span>
                <I name={openCats.__prod===true||(openCats.__prod===undefined&&PROD_LIST.some(p=>items[p.id]?.checked))?"chevU":"chevD"} size={12} style={{color:T.gray400}}/>
              </div>
              {(openCats.__prod===true||(openCats.__prod===undefined&&PROD_LIST.some(p=>items[p.id]?.checked)))&&
                <div style={{padding:"4px 0"}}>
                  {PROD_LIST.map(p => { const it=items[p.id]||{}; return <SaleProdRow key={p.id} id={p.id} name={p.name} price={p.price||0} priceTiers={p.priceTiers} checked={!!it.checked} amount={it.amount||0} qty={it.qty||0} toggle={toggle} setAmt={setAmt} setQty={setQty} comped={!!it.comped} toggleComped={hasCompedTag ? toggleComped : undefined} />; })}
                </div>
              }
            </div>
            {/* 통합 추가/할인 — 시술/제품 토글 + 입력 */}
            {(()=>{
              const TypeToggle = ({type, setType}) => (
                <div style={{display:"flex",border:`1px solid ${T.gray400}`,borderRadius:4,overflow:"hidden",flexShrink:0,height:24}}>
                  {[{v:"svc",l:"시술",c:T.primary},{v:"prod",l:"제품",c:T.info||"#1976D2"}].map(o=>(
                    <button key={o.v} type="button" onClick={()=>setType(o.v)}
                      style={{padding:"0 9px",fontSize:11,fontWeight:type===o.v?800:500,background:type===o.v?o.c:"transparent",color:type===o.v?"#fff":T.gray500,border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                      {o.l}
                    </button>
                  ))}
                </div>
              );
              return <>
                {/* 추가 */}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",marginTop:4}}>
                  <TypeToggle type={extraType} setType={setExtraType}/>
                  <SaleExtraRow id={extraType==="svc"?"extra_svc":"extra_prod"} color={extraType==="svc"?T.primary:(T.infoLt2)} placeholder={extraType==="svc"?"추가 시술명 입력":"추가 제품명 입력"} checked={!!(items[extraType==="svc"?"extra_svc":"extra_prod"]||{}).checked} amount={(items[extraType==="svc"?"extra_svc":"extra_prod"]||{}).amount||0} label={(items[extraType==="svc"?"extra_svc":"extra_prod"]||{}).label||""} toggle={toggle} setAmt={setAmt} setLabel={setLabel} />
                </div>
                {/* 할인 */}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0"}}>
                  <TypeToggle type={discountType} setType={setDiscountType}/>
                  <SaleDiscountRow id="discount" checked={items.discount?.checked} amount={items.discount?.amount||0} toggle={toggle} setAmt={setAmt} />
                </div>
              </>;
            })()}
          </div>
        </GridLayout>

        {/* 오른쪽: 보유권 + 결제 */}
        <div style={{width:_m?"100%":290,flexShrink:0,overflow:"auto",maxHeight:_m?"none":"70vh",padding:"10px 12px",background:T.bg}}>

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
              <span style={{fontSize:T.fs.xs,color:T.text,fontWeight:600}}><I name="scissors" size={12}/> 시술 합계</span>
              <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary}}>{fmt(svcTotal)}원</span>
            </div>
            {/* 쉐어 남녀 보정금 안내 (id_nfv71exl14 수정요청) */}
            {shareSurchargeTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:11,color:"#5B21B6"}}>
              <span><I name="share" size={10}/> 쉐어 보정금 (여→남)</span>
              <span style={{fontWeight:700}}>+{fmt(shareSurchargeTotal)}원</span>
            </div>}
            {prodTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.text,fontWeight:600}}><I name="pkg" size={12}/> 제품 합계</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.info||"#1976D2"}}>{fmt(prodTotal)}원</span>
            </div>}
            {(svcCompedTotal + prodCompedTotal) > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:"#E65100",fontWeight:600}}>🎁 체험단 제공</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#E65100"}}>-{fmt(svcCompedTotal + prodCompedTotal)}원</span>
            </div>}
            {discount > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:T.female}}><I name="tag" size={11}/> 할인</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.female}}>-{fmt(discount)}원</span>
            </div>}
            {eventDiscountTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",gap:8}}>
              <span style={{fontSize:T.fs.xs,color:"#E65100",flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={(()=>{const n=(eventResult?.appliedEvents||[]).filter(e=>(e.rewards||[]).some(r=>r.type==='discount_flat')).map(e=>e.name).filter(Boolean);return n.join(", ");})()}>🎉 이벤트 할인{(() => {
                const names = (eventResult?.appliedEvents||[])
                  .filter(e => (e.rewards||[]).some(r => r.type === 'discount_flat'))
                  .map(e => e.name).filter(Boolean);
                return names.length ? ` · ${names.join(", ")}` : "";
              })()}</span>
              <span style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:"#E65100",flexShrink:0,whiteSpace:"nowrap"}}>-{fmt(eventDiscountTotal)}원</span>
            </div>}
            {couponDiscountTotal > 0 && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
              <span style={{fontSize:T.fs.sm,color:"#b45309"}}>🎫 쿠폰 할인</span>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#b45309"}}>-{fmt(couponDiscountTotal)}원</span>
            </div>}
            {/* 외부 선결제 — 좁은 패널에서 자동 줄바꿈 허용 */}
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 0",marginTop:0}}>
              <span style={{fontSize:T.fs.xs,color:"#6A1B9A",fontWeight:700,flexShrink:0}}>🏷 선결제</span>
              <select value={externalPlatform} onChange={e=>setExternalPlatform(e.target.value)}
                style={{flex:"0 1 90px",minWidth:70,padding:"3px 4px",fontSize:T.fs.xs,border:"1px solid #CE93D8",borderRadius:6,background:"#fff",color:"#6A1B9A",fontFamily:"inherit"}}>
                <option value="">플랫폼</option>
                {externalPlatforms.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <input type="text" inputMode="numeric" value={externalPrepaid ? externalPrepaid.toLocaleString() : ""} placeholder="0"
                onChange={e=>{const v=Number(String(e.target.value).replace(/[^0-9]/g,""))||0; setExternalPrepaid(Math.max(0,v));}}
                style={{flex:"1 1 70px",minWidth:60,padding:"3px 6px",fontSize:T.fs.xs,textAlign:"right",fontWeight:700,color:"#6A1B9A",border:"1px solid #CE93D8",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
              <span style={{fontSize:T.fs.xs,color:"#6A1B9A",fontWeight:700,flexShrink:0}}>원</span>
            </div>
            <div style={{borderTop:"2px solid #333",marginTop:6,paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:T.fs.sm,fontWeight:T.fw.black,color:T.text}}>{isNaver ? "현장 결제금액" : "총 결제금액"}</span>
              <span style={{fontSize:T.fs.xl,fontWeight:T.fw.black,color:T.danger}}>{fmt(grandTotal)}원</span>
            </div>
          </div>

          {/* 결제수단 분배 — 시술/제품 통합 */}
          {(svcTotal > 0 || prodTotal > 0 || hasPkgChecked()) && <div className="sale-pay-row" style={{display:"flex",flexDirection:"column",gap:8}}>
            {(svcTotal > 0 || prodTotal > 0) && <div style={{flex:1,minWidth:0,padding:"8px 12px",background:T.bgCard,borderRadius:T.radius.md,border:"1px solid "+T.border}}>
              <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.primary,marginBottom:6}}><I name="scissors" size={12}/> 결제 <span style={{color:T.danger,fontWeight:T.fw.black}}>{fmt(svcPayTotal + prodPayTotal)}원</span></div>
              {(svcCompedTotal + prodCompedTotal) > 0 && (
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:5,background:"#FFF3E0",border:"1px solid #E65100",borderRadius:6,fontSize:11,color:"#E65100"}}>
                  <span style={{fontWeight:700}}>🎁 체험단 제공 (무료)</span>
                  <span style={{marginLeft:"auto",fontWeight:800}}>-{fmt(svcCompedTotal + prodCompedTotal)}원</span>
                </div>
              )}
              {activeCoupons.filter(c=>(c.applyTo==='services' || c.applyTo==='all' || c.applyTo==='category' || c.applyTo==='specific_service' || c.applyTo==='products') && c.discount>0).map(c => (
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
                {/* 포인트 — 결제수단 타일 (맨 앞, 잔액 있는 고객만) */}
                {cust?.id && pointBalance > 0 && (()=>{
                  const clr = "#C62828", bg = "#FFEBEE";
                  const active = pointUse > 0;
                  const toggle = () => {
                    if (active) { setPointUse(0); return; }
                    const avail = svcPayTotal + prodPayTotal + pointUse;
                    if (avail > 0) {
                      setPointUse(Math.min(pointBalance, avail));
                    } else if (pkgDeduct > 0) {
                      // svcPayTotal=0 (선불잔액이 이미 전액 덮음) → 선불잔액에서 포인트로 재분배
                      const desired = Math.min(pointBalance, pkgDeduct);
                      setPointUse(desired);
                      setPkgUse(prev => {
                        const next = {...prev};
                        let remaining = desired;
                        Object.keys(next).forEach(pid => {
                          if (remaining <= 0) return;
                          const cur = Number(next[pid]) || 0;
                          if (cur <= 0) return;
                          const cut = Math.min(cur, remaining);
                          next[pid] = cur - cut;
                          remaining -= cut;
                        });
                        return next;
                      });
                    }
                  };
                  const editAmount = (raw) => {
                    const n = parseInt(String(raw).replace(/[^0-9]/g,""))||0;
                    setPointUse(Math.max(0, Math.min(pointBalance, n)));
                  };
                  return <div onClick={!active?toggle:undefined}
                    style={{gridColumn:"1 / -1",display:"flex",flexDirection:"row",alignItems:"center",gap:8,padding:"4px 8px",borderRadius:T.radius.md,
                      border:active?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:active?bg:T.gray100,transition:"all .15s",cursor:active?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();toggle();}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",flex:1,
                        fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:active?clr:T.gray500,textAlign:"left"}}>
                      {active?"☑":"☐"} 포인트 <span style={{fontWeight:T.fw.normal,opacity:.7}}>/{fmt(pointBalance)}P</span>
                    </button>
                    <input type="text" inputMode="numeric"
                      value={active && pointUse?fmtAmt(pointUse):""}
                      placeholder="0"
                      onChange={e=>editAmount(e.target.value)}
                      onClick={(e)=>{e.stopPropagation(); if(!active) toggle();}}
                      onFocus={()=>{ if(!active) toggle(); }}
                      readOnly={!active}
                      style={{width:120,minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${active?clr:"transparent"}`,
                        color:active?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:active?T.bgCard:"transparent",
                        opacity:active?1:.5}}/>
                  </div>;
                })()}
                {/* 다담권(신규) — 오늘 구매한 다담권에서 자동 차감 (2단계 계산: 시술액 ▶ 새 다담권) */}
                {newPkgInstantDeduct > 0 && (()=>{
                  const clr = "#E65100", bg = "#FFF3E0";
                  return <div style={{display:"flex",flexDirection:"column",gap:4,padding:"6px 8px",borderRadius:T.radius.md,
                    border:`2px solid ${clr}`, background:bg}}>
                    <div style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:clr,textAlign:"left"}}>
                      ☑ 다담권(신규)
                    </div>
                    <div style={{padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",color:clr,fontWeight:T.fw.bolder,
                      borderRadius:4,background:T.bgCard,border:`1px solid ${clr}`}}>
                      -{fmt(newPkgInstantDeduct)}
                    </div>
                  </div>;
                })()}
                {/* 선불잔액 — 다담권/선불권 (카드형, 금액 입력 가능). 신규 다담권 구매 중에도 표시 — 기존 우선 차감 정책 */}
                {(()=>{
                  // 지점 제한 롤백: 전체 prepaid 사용 가능
                  // 차감 순서: 구매일 ASC (FIFO) — 기존 다담권을 먼저 소진, 신규 충전분은 나중에
                  const _cKey = (p) => p.purchased_at || p.purchasedAt || p.created_at || p.createdAt || "9999-12-31";
                  const prepaidPkgs = activePkgs.filter(p=>_pkgType(p)==="prepaid")
                    .sort((a,b)=>String(_cKey(a)).localeCompare(String(_cKey(b))));
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
                      distributeAmount(Math.min(prepaidBal, svcPayTotal + prodPayTotal));
                    }
                  };
                  const editAmount = (raw) => {
                    const n = parseInt(String(raw).replace(/[^0-9]/g,""))||0;
                    distributeAmount(n);
                  };
                  return <div onClick={!isActive?toggle:undefined}
                    style={{gridColumn:"1 / -1",display:"flex",flexDirection:"row",alignItems:"center",gap:8,padding:"4px 8px",borderRadius:T.radius.md,
                      border:isActive?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:isActive?bg:T.gray100,transition:"all .15s",cursor:isActive?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();toggle();}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",flex:1,
                        fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:isActive?clr:T.gray500,textAlign:"left"}}>
                      {isActive?"☑":"☐"} 선불잔액 <span style={{fontWeight:T.fw.normal,opacity:.7}}>/{fmt(prepaidBal)}</span>
                      {prepaidPkgs.some(p=>p._shared_from) && <span style={{marginLeft:4,fontSize:8,padding:"0 4px",borderRadius:6,background:"#F5F3FF",color:"#5B21B6",border:"1px solid #C4B5FD",fontWeight:700}}>🤝 쉐어</span>}
                    </button>
                    <input type="text" inputMode="numeric"
                      value={isActive && usedAmt?fmtAmt(usedAmt):""}
                      placeholder="0"
                      onChange={e=>editAmount(e.target.value)}
                      onClick={(e)=>{e.stopPropagation(); if(!isActive) toggle();}}
                      onFocus={()=>{ if(!isActive) toggle(); }}
                      readOnly={!isActive}
                      style={{width:120,minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${isActive?clr:"transparent"}`,
                        color:isActive?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:isActive?T.bgCard:"transparent",
                        opacity:isActive?1:.5}}/>
                  </div>;
                })()}
                {/* 일반 결제수단 — 한 줄씩 컴팩트 (가로: 라벨 | 입력) */}
                {[
                  {k:"svcCard",label:"카드",clr:T.male,bg:T.maleLt},
                  {k:"svcCash",label:"현금",clr:T.orange,bg:T.orangeLt},
                  {k:"svcTransfer",label:"입금",clr:T.successDk,bg:T.successLt},
                ].map(({k,label,clr,bg})=>{
                  const active = !!openPay[k];
                  return <div key={k} onClick={!active?()=>togglePayField(k,svcPayTotal+prodPayTotal,"svc"):undefined}
                    style={{gridColumn:"1 / -1",display:"flex",flexDirection:"row",alignItems:"center",gap:8,padding:"4px 8px",borderRadius:T.radius.md,
                      border:active?`2px solid ${clr}`:"1px solid #d0d0d0",
                      background:active?bg:T.gray100,transition:"all .15s",cursor:active?"default":"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();togglePayField(k,svcPayTotal+prodPayTotal,"svc");}}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",flex:1,
                        fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:active?clr:T.gray500,textAlign:"left"}}>
                      {active?"☑":"☐"} {label}
                    </button>
                    <input type="text" inputMode="numeric"
                      value={active && payMethod[k]?fmtAmt(payMethod[k]):""}
                      placeholder="0"
                      onChange={e=>editPay(k,e.target.value,svcPayTotal+prodPayTotal,"svc")}
                      onClick={(e)=>{e.stopPropagation(); if(!active) togglePayField(k,svcPayTotal+prodPayTotal,"svc");}}
                      onFocus={()=>{ if(!active) togglePayField(k,svcPayTotal+prodPayTotal,"svc"); }}
                      readOnly={!active || primaryPay.svc===k}
                      style={{width:120,minWidth:0,padding:"3px 6px",fontSize:T.fs.sm,textAlign:"right",
                        border:`1px solid ${active?clr:"transparent"}`,
                        color:active?clr:T.gray400,fontWeight:T.fw.bolder,borderRadius:4,
                        background:active?(primaryPay.svc===k?T.bg:T.bgCard):"transparent",
                        opacity:active?1:.5}}/>
                  </div>;
                })}
              </div>
              {/* 인라인 경고: 시술액 < 예약금 (id_bwevrmvqft) */}
              {externalPrepaid > 0 && svcTotal > 0 && svcTotal < externalPrepaid && (
                <div style={{marginTop:8,padding:"8px 10px",background:"#FFF8E1",border:"1px solid #F59E0B",borderRadius:6,fontSize:11,color:"#78350F",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:160}}>
                    <div style={{fontWeight:800}}>⚠️ 예약금 {externalPrepaid.toLocaleString()}원 &gt; 시술액 {svcTotal.toLocaleString()}원</div>
                    <div style={{opacity:.85,fontWeight:700}}>환불처리 후 진행하세요</div>
                  </div>
                  <button onClick={()=>{
                    const refundedAmt = externalPrepaid;
                    if (!confirm(`예약금 ${refundedAmt.toLocaleString()}원 환불 처리할까요?\n\n메모에 환불 기록 자동 추가됩니다.`)) return;
                    setExternalPrepaid(0);
                    setSaleMemo(prev => `[예약금 환불 ${refundedAmt.toLocaleString()}원]\n` + (prev || ""));
                  }} style={{padding:"6px 14px",fontSize:12,fontWeight:900,background:"#F59E0B",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",whiteSpace:"nowrap",animation:"pendingBlink 1s infinite",boxShadow:"0 2px 8px rgba(245,158,11,.4)"}}>
                    💰 환불
                  </button>
                </div>
              )}
            </div>}
          </div>}
          {pkgDeduct > 0 && <div style={{marginTop:6,fontSize:13,fontWeight:T.fw.black,color:"#E65100",background:"#FFF3E0",borderRadius:T.radius.md,padding:"6px 12px"}}>선불잔액 차감: -{pkgDeduct.toLocaleString()}원</div>}
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
          {/* 적용된 이벤트 — 트리거/조건 만족해서 발동된 이벤트 요약 (모든 트리거 공통) */}
          {(eventResult?.appliedEvents||[]).length > 0 && <div style={{marginTop:8,padding:"7px 10px",background:"#F3E8FF",border:"1.5px solid #A855F7",borderRadius:8}}>
            <div style={{fontSize:10,color:"#6B21A8",fontWeight:800,marginBottom:5,display:"flex",alignItems:"center",gap:4}}>🎉 적용된 이벤트 ({eventResult.appliedEvents.length})</div>
            {eventResult.appliedEvents.map((evt, i) => {
              const rewards = Array.isArray(evt.rewards) ? evt.rewards : [];
              const lines = rewards.map(r => {
                if (r.type === 'point_earn') {
                  if (r.base === 'fixed') return `💰 ${Number(r.value||0).toLocaleString()}P 적립`;
                  return `💰 ${r.rate||0}% 포인트 적립${r.expiryMonths?` (${r.expiryMonths}개월 유효)`:""}`;
                }
                if (r.type === 'discount_pct' || r.type === 'discount') return `🔖 ${r.rate||0}% 할인`;
                if (r.type === 'discount_flat') return `🔖 -${Number(r.value||0).toLocaleString()}원 할인`;
                if (r.type === 'coupon_issue') return `🎁 ${r.couponName||"쿠폰"} × ${r.qty||1}장 발행${r.expiryMonths?` (${r.expiryMonths}개월 유효)`:""}`;
                if (r.type === 'prepaid_bonus') return `💸 다담권 보너스 +${r.rate||0}%`;
                if (r.type === 'free_service') return `🎀 무료 시술권`;
                return null;
              }).filter(Boolean);
              // 포인트 적립 라인은 별도 입력 박스에 표시되므로 이벤트 박스에서는 숨김 (중복 제거)
              const linesNoPoint = lines.filter(l => !l.includes('포인트 적립') && !l.includes('적립'));
              return <div key={evt.id||i} style={{fontSize:11,color:"#581C87",lineHeight:1.5,marginBottom:i===eventResult.appliedEvents.length-1?0:4}}>
                <span style={{fontWeight:800}}>· {evt.name||"이벤트"}</span>
                {linesNoPoint.length>0 && <div style={{paddingLeft:10,fontSize:10,color:"#6B21A8",fontWeight:600}}>{linesNoPoint.map((l,j)=><div key={j}>{l}</div>)}</div>}
              </div>;
            })}
          </div>}
          {/* 포인트 적립 — 이번 매출로 고객에게 적립할 포인트 (결제와 무관) */}
          {(cust?.id || pointEarn > 0 || eventResult.pointEarn > 0) && <div style={{marginTop:8}}>
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"7px 10px",background:"#E8F5E9",borderRadius:8,border:"1px solid #A5D6A7",whiteSpace:"nowrap"}}>
              <span style={{fontSize:11,color:"#2E7D32",fontWeight:700,flexShrink:0}}>⭐ 포인트 적립</span>
              <input type="text" inputMode="numeric" value={pointEarn ? pointEarn.toLocaleString() : ""} placeholder="0"
                onChange={e=>{const v=Number(String(e.target.value).replace(/[^0-9]/g,""))||0; setPointEarn(Math.max(0,v)); _promoAppliedRef.current.userOverride=true;}}
                style={{flex:1,minWidth:60,padding:"4px 6px",fontSize:11,textAlign:"right",fontWeight:700,color:"#2E7D32",border:"1px solid #A5D6A7",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
              <span style={{fontSize:11,color:"#2E7D32",fontWeight:700,flexShrink:0}}>P</span>
            </div>
            {/* 신규 고객 10% 안내 — 고객 미선택 상태에서만 표시 (선택 후엔 위 이벤트 박스에 노출) */}
            {newCustEventEarn.earn > 0 && newCustEventEarn.evt && !cust?.id && <div style={{fontSize:10,color:"#E65100",marginTop:4,paddingLeft:4,fontWeight:700}}>
              💡 신규 고객 {newCustEventEarn.rate}% 이벤트 자동 적립 (고객 선택 후 저장 가능)
            </div>}
            {/* 이벤트 자동 쿠폰 발행 미리보기 (상세) */}
            {eventResult?.issueCoupons?.length > 0 && <div style={{marginTop:6,padding:"7px 10px",background:"#FFF3E0",border:"1px solid #FFB74D",borderRadius:8}}>
              <div style={{fontSize:10,color:"#E65100",fontWeight:700,marginBottom:4}}>🎁 자동 쿠폰 발행 (매출 등록 시)</div>
              {eventResult.issueCoupons.map((c, i) => (
                <div key={i} style={{fontSize:11,color:"#78350F",fontWeight:600,lineHeight:1.5}}>
                  · {c.name} × {c.qty}장{c.expiresAt ? ` · 유효 ~${String(c.expiresAt).slice(0,10)}` : ""}{c.evtName ? ` (${c.evtName})` : ""}
                </div>
              ))}
            </div>}
          </div>}
          {/* 쿠폰 발행 — 이 매출과 함께 고객에게 발행 (3개월 유효, 수동, 복수 발행 가능). 아코디언으로 기본 접힘 */}
          {cust?.id && !editMode && (() => {
            const coupons = (data?.services||[]).filter(s => {
              const cat = (data?.categories||[]).find(c => c.id === s.cat);
              // '쿠폰' 카테고리 + 10%추가적립쿠폰 제외 (자동 발행 전용 쿠폰)
              return cat?.name === '쿠폰' && s.name !== '10%추가적립쿠폰';
            });
            if (!coupons.length) return null;
            const totalIssued = Object.values(issueCouponIds).reduce((s,n)=>s+(n||0),0);
            return <div style={{padding:"0",marginTop:6,background:"#FFF3E0",borderRadius:8,border:"1px solid #FFB74D",overflow:"hidden"}}>
              <button type="button" onClick={()=>setCouponsOpen(o=>!o)}
                style={{width:"100%",padding:"7px 10px",background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
                <span style={{fontSize:11,color:"#E65100",fontWeight:700,flex:1,textAlign:"left",display:"flex",alignItems:"center",gap:5}}>
                  🎫 쿠폰 발행
                  {totalIssued > 0 && <span style={{fontSize:10,padding:"1px 6px",background:"#E65100",color:"#fff",borderRadius:8,fontWeight:800}}>{totalIssued}장 선택됨</span>}
                  {!couponsOpen && totalIssued===0 && <span style={{fontSize:9,fontWeight:500,color:"#8D6E00"}}>(눌러서 펼치기)</span>}
                </span>
                <span style={{fontSize:12,color:"#E65100",transform:couponsOpen?"rotate(180deg)":"rotate(0)",transition:"transform .2s"}}>▾</span>
              </button>
              {couponsOpen && <div style={{padding:"0 10px 10px",display:"flex",flexDirection:"column",gap:4}}>
                <div style={{fontSize:9,fontWeight:500,color:"#8D6E00",marginBottom:2}}>+/− 눌러 장수 지정 · 3개월 유효</div>
                {coupons.map(c => {
                  const cnt = issueCouponIds[c.id] || 0;
                  return <div key={c.id} style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{flex:1,fontSize:11,fontWeight:700,color: cnt>0 ? '#E65100':'#8D6E00'}}>{cnt>0?'✓ ':''}{c.name}</span>
                    <button type="button" onClick={()=>setIssueCouponIds(p=>{const n={...p};if(n[c.id])n[c.id]--;if(!n[c.id])delete n[c.id];return n;})}
                      disabled={cnt<=0}
                      style={{width:24,height:24,borderRadius:6,border:'1px solid '+(cnt>0?'#E65100':'#FFCC80'),background:'#fff',color:cnt>0?'#E65100':'#FFCC80',fontSize:13,fontWeight:800,cursor:cnt>0?'pointer':'default',fontFamily:'inherit',padding:0,lineHeight:1}}>−</button>
                    <span style={{minWidth:28,textAlign:'center',fontSize:12,fontWeight:800,color:cnt>0?'#E65100':'#BDB8B0'}}>{cnt}장</span>
                    <button type="button" onClick={()=>setIssueCouponIds(p=>({...p,[c.id]:(p[c.id]||0)+1}))}
                      style={{width:24,height:24,borderRadius:6,border:'1px solid #E65100',background:cnt>0?'#E65100':'#fff',color:cnt>0?'#fff':'#E65100',fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:'inherit',padding:0,lineHeight:1}}>＋</button>
                  </div>;
                })}
              </div>}
            </div>;
          })()}
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
          <div style={{ fontSize: 10, color: viewOnly ? "#C62828" : T.gray400, flex: "1 1 200px", fontWeight: viewOnly ? 700 : 400 }}>
            {viewOnly
              ? "👁 매출확인 모드 — 수정은 매출관리 페이지에서만 가능합니다"
              : ((gender ? (gender === "F" ? "여성" : "남성") + " 가격 적용" : "성별 미선택") + " · 체크한 항목만 매출 반영")}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <Btn variant="secondary" onClick={onClose}>{viewOnly ? "닫기" : "취소"}</Btn>
            {!editMode && !viewOnly && (
              <Btn variant="ghost" style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700 }} onClick={()=>handleSubmit(true)} title="저장한 뒤 입력폼이 초기화되어 연속으로 매출을 등록할 수 있습니다">
                <I name="plus" size={12}/> 저장 후 계속
              </Btn>
            )}
            {!viewOnly && (
              <Btn variant="primary" style={{ padding: "10px 20px", fontSize: 13, fontWeight: 800 }} onClick={()=>handleSubmit(false)}>
                <I name="wallet" size={12}/> 매출 등록 ({fmt(grandTotal)}원){hasPkgChecked() && ` +📦${totalPkgQty()}회`}
              </Btn>
            )}
          </div>
        </div>
      </div>
      {/* 커스텀 alert 모달 — 브라우저 alert 대체 (Bliss UI 통일) */}
      {alertMsg && (() => {
        const isGenderAlert = /성별/.test(alertMsg);
        const pickGender = (g) => {
          setGender(g);
          setCust(p=>({...p, gender:g}));
          setItems(prev => { const next = {...prev}; SVC_LIST.forEach(svc => { if(next[svc.id]?.checked){ next[svc.id] = {...next[svc.id], amount: _defPrice(svc, g)}; } }); return next; });
          setAlertMsg(null);
        };
        return (
        <div onClick={()=>setAlertMsg(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(2px)"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,padding:"22px 24px 18px",minWidth:280,maxWidth:380,boxShadow:"0 12px 40px rgba(0,0,0,.25)",animation:"slideUp .25s cubic-bezier(.22,1,.36,1)"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:16}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:T.primaryLt||"#EEF2FF",color:T.primary,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:800,flexShrink:0}}>!</div>
              <div style={{fontSize:14,color:T.text,lineHeight:1.55,whiteSpace:"pre-wrap",flex:1,paddingTop:4}}>{alertMsg}</div>
            </div>
            {isGenderAlert ? (
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button onClick={()=>pickGender('F')} autoFocus style={{flex:1,padding:"10px 0",fontSize:14,fontWeight:800,border:`2px solid ${T.female}`,borderRadius:8,background:"#FCE4EC",color:T.female,cursor:"pointer",fontFamily:"inherit"}}>여성</button>
                <button onClick={()=>pickGender('M')} style={{flex:1,padding:"10px 0",fontSize:14,fontWeight:800,border:`2px solid ${T.info||"#1976D2"}`,borderRadius:8,background:"#E3F2FD",color:T.info||"#1976D2",cursor:"pointer",fontFamily:"inherit"}}>남성</button>
              </div>
            ) : (
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>setAlertMsg(null)} autoFocus style={{padding:"8px 22px",fontSize:13,fontWeight:700,border:"none",borderRadius:8,background:T.primary,color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>확인</button>
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
