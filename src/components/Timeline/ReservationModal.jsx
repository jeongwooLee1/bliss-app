import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T, STATUS_LABEL, STATUS_CLR, BLOCK_COLORS, SYSTEM_TAG_NAME_NEW_CUST, SYSTEM_TAG_NAME_PREPAID, SYSTEM_SRC_NAME_NAVER } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders, queueAlimtalk, buildTokenSearch } from '../../lib/sb'
import { fromDb, toDb, NEW_CUST_TAG_ID_GLOBAL, PREPAID_TAG_ID, NAVER_SRC_ID, SYSTEM_TAG_IDS, _activeBizId } from '../../lib/db'
import { todayStr, pad, fmtDate, fmtDt, fmtTime, addMinutes, getDow, genId, fmtLocal, groupSvcNames, getStatusLabel, getStatusColor, fmtPhone, getCustPkgBranchInitial, naverConfirmBooking, judgePenaltyType, customerGrade, isMoneyPkg } from '../../lib/utils'
import { createPortal } from 'react-dom'
import I from '../common/I'
import SendSmsModal from '../common/SendSmsModal'
import ConsentModal from '../Consent/ConsentModal'
import { DetailedSaleForm } from './SaleForm'
import { evaluateTagTriggers } from '../../lib/tagAutoTrigger'
import { transliterateName, getCachedTransliteration } from '../../lib/nameTransliterate'

const uid = genId;

// 📋 차트(동의서) form_data 표시용 — 키 라벨 + 값 포매터
const CHART_LABELS = {
  name:"이름", phone:"연락처", email:"이메일", gender:"성별", pregnant:"임신 여부",
  first_waxing:"첫 왁싱", skin_type:"피부 타입", service_areas:"시술 부위", concern:"피부 고민",
  referral:"방문 경로", motivation:"방문 동기", choose_reason:"선택 이유", agree:"동의",
  privacy_consent:"개인정보 동의", sms_consent:"문자 수신 동의", care_type:"케어 종류",
  condition:"컨디션", soothing:"진정 케어", towel:"수건", sound:"사운드", free_service:"무료 서비스",
  extras:"추가 선택", picked:"선택 항목", voucher_amount:"금액권", curl:"컬", eye_condition:"눈 상태",
  prev_perm:"이전 펌 경험", sensitive:"민감 여부", contraindication:"금기 사항",
};
function _fmtChartVal(v) {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return v.filter(x=>x!=null&&x!=="").map(_fmtChartVal).join(", ");
  if (typeof v === "object") {
    if ("values" in v) return [...(v.values||[]), v.other].filter(Boolean).join(", ");
    if ("value" in v) return _fmtChartVal(v.value);
    const parts = Object.values(v).map(_fmtChartVal).filter(Boolean);
    return parts.join(", ");
  }
  return String(v);
}

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
      style={{position:"absolute",inset:0,opacity:0,width:"100%",height:"100%",fontSize:T.fs.lg,cursor:"pointer"}}/>
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

// ─── 차감 결정 모달 — 모든 취소 흐름(naver_cancelled / cancelled / no_show)에서 공용 ───
function CancelDecisionModal({ open, onResolve, onClose, custId, custName, branchName, dateStr, timeStr, prepaid, reasonLabel }) {
  const [pointBal, setPointBal] = React.useState(0);
  const [prepaidPkgs, setPrepaidPkgs] = React.useState([]);
  const [multiPkgs, setMultiPkgs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!open || !custId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ptxs = await sb.get("point_transactions", `&customer_id=eq.${custId}&select=type,amount`) || [];
        let pBal = 0;
        ptxs.forEach(t => {
          if (t.type === 'earn') pBal += +t.amount || 0;
          else if (t.type === 'deduct' || t.type === 'expire') pBal -= +t.amount || 0;
        });
        const myPkgs = await sb.get("customer_packages", `&customer_id=eq.${custId}`) || [];
        const today = todayStr();
        const isExpired = (p) => {
          const exp = ((p.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
          return exp && exp < today;
        };
        const _prepaid = myPkgs.filter(p => {
          if (!isMoneyPkg(p)) return false;
          if (isExpired(p)) return false;
          const m = (p.note||'').match(/잔액:([0-9,]+)/);
          return m && +m[1].replace(/,/g,'') > 0;
        });
        const _multi = myPkgs.filter(p => {
          const n = (p.service_name||'').toLowerCase();
          if (isMoneyPkg(p) || n.includes('연간') || n.includes('할인권') || n.includes('회원권')) return false;
          if (isExpired(p)) return false;
          return (p.total_count||0) - (p.used_count||0) > 0;
        }).sort((a,b) => {
          const ea = ((a.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[0,''])[1] || '9999-12-31';
          const eb = ((b.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[0,''])[1] || '9999-12-31';
          return ea.localeCompare(eb);
        });
        if (cancelled) return;
        setPointBal(pBal);
        setPrepaidPkgs(_prepaid);
        setMultiPkgs(_multi);
      } catch(e) { console.error('[CancelDecisionModal load]', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, custId]);

  if (!open) return null;
  const PENALTY = 33000;
  const userPrepaid = Math.max(0, Number(prepaid)||0);
  const prepaidBal = prepaidPkgs.reduce((s,p) => {
    const m = (p.note||'').match(/잔액:([0-9,]+)/);
    return s + (m ? +m[1].replace(/,/g,'') : 0);
  }, 0);
  const total = pointBal + prepaidBal;
  let simulationLine = null;
  if (userPrepaid > 0) {
    simulationLine = `취소금 입금 ${userPrepaid.toLocaleString()}원으로 페널티 처리 (보유권 차감 없음)`;
  } else if (total >= PENALTY) {
    simulationLine = `포인트 → 선불권 순으로 ${PENALTY.toLocaleString()}원 차감`;
  } else if (multiPkgs.length > 0) {
    simulationLine = `포인트·선불권 부족 (${total.toLocaleString()}원) → 다회권 "${multiPkgs[0].service_name}" 1회 차감`;
  } else {
    simulationLine = `차감 가능 항목 없음`;
  }
  const canDeduct = userPrepaid > 0 || total >= PENALTY || multiPkgs.length > 0;

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:4000,
      display:'flex', alignItems:'center', justifyContent:'center',
      animation:'fadeIn .15s ease-out'
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bgCard, borderRadius:T.radius.lg, padding:24,
        width:'min(94vw, 460px)', maxHeight:'90vh', overflowY:'auto',
        boxShadow:'0 16px 48px rgba(0,0,0,.3)',
        animation:'slideUp .2s ease-out'
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <h2 style={{fontSize:T.fs.lg,fontWeight:T.fw.bolder,margin:0,color:T.text}}>🚫 {reasonLabel || '예약 취소'} 처리</h2>
          <button onClick={onClose} aria-label="닫기" style={{background:'none',border:'none',fontSize:24,cursor:'pointer',color:T.gray400,lineHeight:1,padding:0}}>×</button>
        </div>

        <div style={{padding:'10px 12px',background:T.gray100,borderRadius:T.radius.md,marginBottom:14,fontSize:T.fs.sm,color:T.textSub,lineHeight:1.6}}>
          <div style={{fontWeight:T.fw.bolder,color:T.text,marginBottom:2}}>{custName||'고객'}</div>
          <div>{dateStr||''} {timeStr||''}{branchName?` · ${branchName}`:''}</div>
        </div>

        {loading ? (
          <div style={{padding:'30px 0',textAlign:'center',color:T.gray500,fontSize:T.fs.sm}}>잔액 조회 중...</div>
        ) : (
          <>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,marginBottom:6,color:T.text}}>💰 차감 가능 항목</div>
              <div style={{padding:'10px 12px',background:'#f8fafc',borderRadius:T.radius.md,fontSize:T.fs.sm,lineHeight:1.7,border:'1px solid '+T.border}}>
                {userPrepaid > 0 && <div>• 선결제(취소금): <strong style={{color:T.text}}>{userPrepaid.toLocaleString()}원</strong></div>}
                <div>• 포인트: <strong style={{color:T.text}}>{pointBal.toLocaleString()}P</strong></div>
                <div>• 선불권 합계: <strong style={{color:T.text}}>{prepaidBal.toLocaleString()}원</strong>{prepaidPkgs.length>0 && <span style={{color:T.gray500}}> ({prepaidPkgs.length}건)</span>}</div>
                {multiPkgs.length > 0 && <div>• 다회권: <strong style={{color:T.text}}>{multiPkgs.length}건</strong> <span style={{color:T.gray500}}>(예: {multiPkgs[0].service_name})</span></div>}
                {!canDeduct && <div style={{color:T.danger,marginTop:4,fontWeight:T.fw.bolder}}>차감 가능 항목 없음</div>}
              </div>
            </div>

            <div style={{marginBottom:18,padding:'10px 12px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:T.radius.md,fontSize:T.fs.sm,color:'#9a3412',lineHeight:1.55}}>
              <div style={{fontWeight:T.fw.bolder,marginBottom:4}}>💸 차감 시 처리</div>
              {simulationLine}
            </div>
          </>
        )}

        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button onClick={()=>onResolve('skip')} disabled={loading} style={{
            flex:1, padding:'12px', fontSize:T.fs.sm, fontWeight:T.fw.bolder,
            background:'#fff', color:T.text, border:'1.5px solid '+T.border, borderRadius:T.radius.md,
            cursor:loading?'wait':'pointer', fontFamily:'inherit'
          }}>↪ 차감없이 취소</button>
          <button onClick={()=>onResolve('deduct')} disabled={loading || !canDeduct} style={{
            flex:1, padding:'12px', fontSize:T.fs.sm, fontWeight:T.fw.bolder,
            background:canDeduct?T.danger:T.gray200, color:'#fff', border:'none', borderRadius:T.radius.md,
            cursor:(loading||!canDeduct)?'not-allowed':'pointer',
            opacity:(loading||!canDeduct)?0.55:1, fontFamily:'inherit'
          }}>💸 차감하고 취소</button>
        </div>
        <button onClick={onClose} style={{
          width:'100%', padding:'10px', marginTop:8, fontSize:T.fs.xs,
          background:'transparent', color:T.gray500, border:'none', cursor:'pointer', fontFamily:'inherit'
        }}>← 돌아가기 (취소 액션 자체 취소)</button>
      </div>
    </div>
  );
}

function TimelineModal({ item, onSave, onDelete, onDeleteRequest, onClose, selBranch, userBranches, data, setData, setPage, naverColShow={}, setPendingChat, setPendingOpenCust, betaGroupMode=false }) {
  // 카테고리 순서 → 카테고리 내 시술 순서 (시술상품관리와 동일)
  // 쿠폰·포인트 카테고리는 시술 선택 대상이 아니므로 제외 (증정/사용 대상)
  const _excludedCatIds = (data?.categories || []).filter(c => c.name === '쿠폰' || c.name === '포인트').map(c => c.id);
  const _catSort = {};
  (data?.categories || []).forEach(c => { _catSort[c.id] = c.sort ?? 9999; });
  const SVC_LIST = (data?.services || []).filter(s => !_excludedCatIds.includes(s.cat)).slice().sort((a,b) => {
    const ca = _catSort[a.cat] ?? 9999, cb = _catSort[b.cat] ?? 9999;
    return ca !== cb ? ca - cb : (a.sort??9999) - (b.sort??9999);
  });
  const PROD_LIST = (data?.products || []);
  const CATS = (data?.categories || []).slice().filter(c => c.name !== '쿠폰' && c.name !== '포인트').sort((a,b)=>(a.sort||0)-(b.sort||0));
  const isNew = !item?.id || item?.roomId;
  const isReadOnly = item?.readOnly || false;
  const branchId = item?.bid || selBranch;
  const branchRooms = (data.rooms||[]).filter(r=>r.branch_id===branchId);
  // 이 지점 base 소속 직원 (fallback 용)
  const allBranchStaff = (data.staff||[]).filter(s=>s.bid===branchId);
  // workingStaffIds는 TimelinePage가 getWorkingStaff로 넘긴 "오늘 이 지점 타임라인 컬럼에 보이는 직원 전체"
  // base 지점 필터링 없이 그대로 사용해야 지원·이동 직원도 포함됨
  const branchStaff = (() => {
    let list = data.workingStaffIds
      ? (data.staff||[]).filter(s => data.workingStaffIds.includes(s.id))
      : allBranchStaff;
    // item.staffId가 있는데 목록에 없으면 추가 (근무외 지원 등)
    if (item?.staffId && !list.some(s => s.id === item.staffId)) {
      const extra = (data.staff||[]).find(s => s.id === item.staffId)
        || { id: item.staffId, bid: branchId, dn: item.staffId, name: item.staffId, branch_id: branchId };
      list = [extra, ...list];
    }
    // 중복 제거 (id 기준)
    const seen = new Set();
    return list.filter(s => !seen.has(s.id) && seen.add(s.id));
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
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [existingSaleDetails, setExistingSaleDetails] = useState(null);
  // 변경 이력 chain — prev_reservation_id를 따라 거슬러 올라간 옛 예약 목록
  const [changeChain, setChangeChain] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const startPrev = item?.prevReservationId || item?.prev_reservation_id || "";
        if (!startPrev) { setChangeChain([]); return; }
        const acc = []; let cur = startPrev; let safety = 0;
        while (cur && safety < 10) {
          safety++;
          const rows = await sb.get("reservations", `&reservation_id=eq.${cur}&limit=1`);
          if (!rows?.length) break;
          const rec = (rows[0]?.id) ? rows[0] : null;
          if (!rec) break;
          acc.push(rec);
          cur = rec.prev_reservation_id || "";
        }
        if (!cancelled) setChangeChain(acc);
      } catch (e) { if (!cancelled) setChangeChain([]); }
    })();
    return () => { cancelled = true; };
  }, [item?.id, item?.prevReservationId, item?.prev_reservation_id]);
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
  // 매출 히스토리: PC에서 디폴트 열림 (cust 정보 있을 때만, 모바일은 X)
  const [historyOpen, setHistoryOpen] = useState(() => {
    const isMob = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMob) return false;
    // 고객 정보 있을 때만 자동 펼침 (item.custId/custName 또는 신규 입력)
    return !!(item?.custId || item?.custName);
  });
  const [custPopupOpen, setCustPopupOpen] = useState(false);
  const [salesHistory, setSalesHistory] = useState([]);
  // sale_id → sale_details[] 매핑 (실제 결제·차감 항목 기반으로 매출 카드 시술명 표시)
  const [salesDetailsMap, setSalesDetailsMap] = useState({});
  const [custMemo, setCustMemo] = useState("");
  const [editingCustMemo, setEditingCustMemo] = useState(false);
  const [custMemoDraft, setCustMemoDraft] = useState("");
  const [savingCustMemo, setSavingCustMemo] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [depositCharging, setDepositCharging] = useState(false);
  const [refunding, setRefunding] = useState(false);

  // 💸 예약금 환불 — payment-cancel Edge Function 호출
  const refundDeposit = async () => {
    if (!item?.depositPaymentId) {
      // depositPaymentId 컬럼이 없으면 reservation_payments에서 역조회
      const fallback = await sb.get('reservation_payments', { reservation_id: 'eq.' + item.id, status: 'eq.paid', limit: 1 });
      const rp = Array.isArray(fallback) ? fallback[0] : null;
      if (!rp) { alert('환불할 결제 기록을 찾을 수 없습니다.'); return; }
      item.depositPaymentId = rp.id;
    }
    const reason = window.prompt('환불 사유를 입력하세요', '고객 요청');
    if (!reason) return;
    if (!confirm(`예약금 ${Number(item.depositAmount||0).toLocaleString()}원을 전액 환불할까요?`)) return;
    setRefunding(true);
    try {
      const r = await fetch(SB_URL + '/functions/v1/payment-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window._sbAnonKey || '') },
        body: JSON.stringify({ orderId: item.depositPaymentId, cancelReason: reason }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        alert('환불 실패: ' + (j.error || r.status));
      } else {
        alert(`✓ 환불 완료 (${Number(j.cancelledAmount||0).toLocaleString()}원)`);
        // reservation 메모리 갱신
        if (j.status === 'cancelled') {
          item.depositPaidAt = null;
        }
      }
    } catch (e) {
      alert('환불 요청 실패: ' + (e?.message || e));
    } finally {
      setRefunding(false);
    }
  };

  // 💳 예약금 청구 — 매장이 고객한테 결제 링크 발송 (토스페이먼츠)
  const chargeDeposit = async () => {
    if (!item?.id) { alert('예약 저장 후 청구 가능합니다.'); return; }
    if (!f.bid) { alert('지점이 지정되지 않았습니다.'); return; }
    const branch = (data?.branches||[]).find(b => b.id === f.bid);
    const ps = (() => { try { const v = branch?.payment_settings; return typeof v === 'string' ? JSON.parse(v||'{}') : (v||{}); } catch { return {}; } })();
    if (!ps?.tosspayments?.client_key || !ps?.tosspayments?.secret_key) {
      alert('이 매장의 토스페이먼츠 키가 등록되지 않았습니다.\n관리설정 → 결제 설정에서 등록해 주세요.');
      return;
    }
    const amtStr = window.prompt('예약금 금액 (원)을 입력하세요', '20000');
    if (!amtStr) return;
    const amount = parseInt(String(amtStr).replace(/[^0-9]/g, ''), 10);
    if (!amount || amount < 100) { alert('100원 이상 입력하세요.'); return; }
    setDepositCharging(true);
    try {
      const orderId = 'ord_' + genId();
      const expires = new Date(Date.now() + 7*24*60*60*1000).toISOString();
      const _bizId = (data?.businesses||[])[0]?.id || _activeBizId || 'biz_khvurgshb';
      await sb.insert('reservation_payments', {
        id: orderId,
        business_id: _bizId,
        branch_id: f.bid,
        reservation_id: item.id,
        cust_id: f.custId || null,
        cust_name: f.custName || '',
        cust_phone: f.custPhone || '',
        cust_email: f.custEmail || '',
        amount,
        purpose: 'deposit',
        status: 'pending',
        payment_provider: 'tosspayments',
        expires_at: expires,
      });
      const link = `https://blissme.ai/pay/${orderId}`;
      let sent = false;
      if (item.chatChannel && item.chatAccountId && item.chatUserId) {
        try {
          const text = `예약금 ${amount.toLocaleString()}원 결제 링크입니다 💳\n${link}\n\n토스페이먼츠로 안전하게 결제됩니다.`;
          const r = await fetch(SB_URL + '/rest/v1/send_queue', {
            method: 'POST',
            headers: { ...sbHeaders, Prefer: 'return=representation' },
            body: JSON.stringify({
              account_id: item.chatAccountId,
              user_id: item.chatUserId,
              message_text: text,
              channel: item.chatChannel,
              status: 'pending',
            }),
          });
          if (r.ok) sent = true;
        } catch {}
      }
      try { await navigator.clipboard.writeText(link); } catch {}
      alert(`✓ 결제 링크 생성 완료\n\n${link}\n\n${sent ? '메시지함으로 자동 발송되었습니다.' : '클립보드에 복사되었습니다.'}`);
    } catch (e) {
      alert('결제 링크 생성 실패: ' + (e?.message || e));
    } finally {
      setDepositCharging(false);
    }
  };
  const modalRef = useRef(null);
  const tags = (data?.serviceTags || []).slice().sort((a,b)=>a.sort-b.sort);
  const visibleTags = tags.filter(tag => tag.useYn !== false && (isSchedule ? tag.scheduleYn === "Y" : tag.scheduleYn !== "Y"));

  const BASE_DUR = 5; // 기본 예약시간 5분
  // 네이버 예약 판정: reservationId 있음 + ai_/manual_/외부플랫폼 접두사 아님 + source != 외부플랫폼
  const _resIdStr = String(item?.reservationId || "");
  const _srcStr = String(item?.source || "").toLowerCase();
  const _EXT_PREFIXES = ["ai_","manual_","trazy_","creatrip_","seoulbeauty_","cusmetic_","kakao_"];
  const _EXT_SOURCES = ["trazy","creatrip","seoulbeauty","cusmetic","서울뷰티","크리에이트립","kakao","카톡","카카오"];
  const isNaverItem = !!(item?.reservationId)
    && !_EXT_PREFIXES.some(p => _resIdStr.startsWith(p))
    && !_EXT_SOURCES.some(p => _srcStr.includes(p));
  const itemDur = item?.dur || (isNaverItem ? 60 : BASE_DUR);
  const defaultEnd = () => { const t = item?.time||"10:00"; const [h,m] = t.split(":").map(Number); const em = m + itemDur; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const addMin = (t, mins) => { const [h,m] = t.split(":").map(Number); const em = m + mins; return `${String(h+Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`; };
  const initRoomId = (item?.roomId && item.roomId.startsWith("blank_")) ? "" : (item?.roomId || branchRooms[0]?.id);
  const [f, setF] = useState(isNew && !item?.id ? {
    id: uid(), bid: branchId, roomId: initRoomId,
    custId: item?._prefill?.custId || null,
    custName: item?._prefill?.custName || "",
    custPhone: item?._prefill?.custPhone || "",
    custGender: (() => {
      // customers DB의 최신 gender 우선 (prefill custId 있을 때)
      const _cid = item?._prefill?.custId;
      if (_cid) {
        const _live = (data?.customers||[]).find(c => c.id === _cid);
        if (_live?.gender) return _live.gender;
      }
      return item?._prefill?.custGender || "";
    })(),
    staffId: item?.staffId || branchStaff[0]?.id, serviceId: (data.services||[])[0]?.id,
    visitorName: item?.visitorName||"", visitorPhone: item?.visitorPhone||"",
    visitorCustId: item?.visitorCustId||"",
    // primarySubject: 'visitor'(디폴트, 방문자 main) | 'reserver'(예약자 main)
    // visitor 정보 있고 reserver와 다를 때만 의미 있음
    primarySubject: item?.primarySubject || (item?.visitorName && item.visitorName !== item.custName ? 'visitor' : 'reserver'),
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
    type: item?.isSchedule ? "schedule" : (item?.type || "reservation"),
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
      // 방문자(예약자와 다른 사람)가 있으면 디폴트로 방문자(visitor) 선택. DB primary_subject 있으면 그것 우선
      primarySubject: item?.primarySubject || (item?.visitorName && item.visitorName !== item.custName ? 'visitor' : 'reserver'),
      // 합성 roomId(st_, nv_, blank_)는 무시, staffId만 있으면 해당 지점 첫 방 할당
      roomId: (() => {
        const rid = item?.roomId;
        const isSynthetic = rid && (rid.startsWith("st_") || rid.startsWith("nv_") || rid.startsWith("blank_"));
        if (rid && !isSynthetic) return rid;
        if (item?.staffId) return branchRooms[0]?.id || "";
        return "";
      })(),
      memo: cleanMemo, custGender: (() => {
        // customers DB의 최신 gender를 우선 사용 (예약시점 스냅샷보다 우선)
        // 직원이 고객관리에서 성별 수정 시 즉시 반영되도록
        if (item?.custId) {
          const _live = (data?.customers||[]).find(c => c.id === item.custId);
          if (_live?.gender) return _live.gender;
        }
        return item?.custGender || "";
      })(), endDate: item?.date||todayStr(), endTime: defaultEnd(),
      selectedTags: (() => {
      let baseTags = item?.selectedTags || [];
      // '신규' 태그는 service_tags.auto_trigger 시스템(is_new_customer 트리거)이 처리 — 하드코딩 제거됨
      // 선결제(네이버 예약금 포함)면 "예약금완료" 태그 자동 포함 (이건 매출 등록 후 발생하는 시스템 상태이므로 유지)
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
    const bizId = _activeBizId;
    if (!bizId) return;

    // Case A: custId 있음 → 고객 레코드에서 빈 필드(성별/이메일/이름2) 백필 + 이름 변경시 최신 이름으로 동기화
    if (f.custId) {
      const local = (data?.customers||[]).find(c => c.id === f.custId);
      if (local) {
        // phone 비어있으면 phone2 사용 (보조번호에만 정확한 번호 있는 케이스)
        const fullPhone = local.phone || local.phone2 || "";
        setF(p => ({
          ...p,
          custName: local.name || p.custName,
          custName2: p.custName2 || local.name2 || "",
          custGender: p.custGender || local.gender || "",
          custEmail: p.custEmail || local.email || "",
          custPhone: fullPhone || p.custPhone,
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
        const fullPhone = c.phone || c.phone2 || "";
        setF(p => ({
          ...p,
          custName: c.name || p.custName,
          custName2: p.custName2 || c.name2 || "",
          custGender: p.custGender || c.gender || "",
          custEmail: p.custEmail || c.email || "",
          custPhone: fullPhone || p.custPhone,
          isNewCust: false,
        }));
        if (c.custNum) setCustNum(c.custNum);
        // 데이터 캐시에도 머지 — 다른 컴포넌트(타임라인 인라인 표시 등)에서 즉시 쓸 수 있도록
        if (setData) setData(prev => {
          if (!prev) return prev;
          const list = prev.customers || [];
          const idx = list.findIndex(x => x.id === c.id);
          if (idx >= 0) {
            return { ...prev, customers: list.map(x => x.id === c.id ? { ...x, ...c } : x) };
          }
          return { ...prev, customers: [...list, c] };
        });
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
  const [custSnapshot, setCustSnapshot] = useState(null);
  const commitBtnRef = React.useRef(null);
  // editing 모드 진입 직전의 cust 필드 6종 저장 → 취소 시 복원용
  const _captureCustSnapshot = () => setCustSnapshot({
    custId: f.custId||"", custName: f.custName||"", custName2: f.custName2||"",
    custPhone: f.custPhone||"", custEmail: f.custEmail||"", custGender: f.custGender||"",
    isNewCust: !!f.isNewCust, custNum: custNum||""
  });
  const _restoreCustSnapshot = () => {
    if (!custSnapshot) return;
    setF(p=>({...p,
      custId: custSnapshot.custId, custName: custSnapshot.custName, custName2: custSnapshot.custName2,
      custPhone: custSnapshot.custPhone, custEmail: custSnapshot.custEmail, custGender: custSnapshot.custGender,
      isNewCust: custSnapshot.isNewCust,
    }));
    setCustNum(custSnapshot.custNum);
    setCustSnapshot(null);
  };
  // 편집 모드 "저장" 시 — 기존 고객(custId)의 이름/전화/이메일/성별/이름2가 바뀌면 customers 테이블에도 반영.
  // (이게 없으면 예약 cust_name만 바뀌고 customers.name은 그대로 → 모달 재진입 시 custId로 옛 이름을 다시 불러와
  //  "변경했는데 반영 안 됨" 버그. id_g2n7orbp8p 강남점 소민구→구소민)
  const _persistCustEdits = () => {
    if (!custSnapshot || custSnapshot.isNewCust || f.isNewCust) return;
    const cid = f.custId;
    if (!cid || cid !== custSnapshot.custId) return; // 다른 고객으로 교체한 경우는 예약만 갱신(여긴 미적용)
    const upd = {};
    if ((f.custName||"").trim()  !== (custSnapshot.custName||"").trim())  upd.name   = (f.custName||"").trim();
    if ((f.custName2||"").trim() !== (custSnapshot.custName2||"").trim()) upd.name2  = (f.custName2||"").trim();
    if ((f.custPhone||"").trim() !== (custSnapshot.custPhone||"").trim()) upd.phone  = (f.custPhone||"").trim();
    if ((f.custEmail||"").trim() !== (custSnapshot.custEmail||"").trim()) upd.email  = (f.custEmail||"").trim();
    if ((f.custGender||"")       !== (custSnapshot.custGender||""))       upd.gender = f.custGender||"";
    if (!Object.keys(upd).length) return;
    sb.update("customers", cid, upd).catch(console.error);
    // 로컬 data.customers 동기화 → 재진입 시 옛 값으로 안 덮어쓰게
    if (setData) setData(d => ({...d, customers: (d.customers||[]).map(c => c.id===cid ? {...c, ...upd} : c)}));
  };
  // 🆕 reserver/visitor 별 raw state — primarySubject 토글 시 깜빡임 방지 (다시 fetch X)
  // 각 cust_id 변경 시만 fetch. 카드 표시 등은 이 raw state 직접 사용
  const [reserverPkgsRaw, setReserverPkgsRaw] = useState([]);
  const [reserverPointRaw, setReserverPointRaw] = useState(0);
  const [visitorPkgsRaw, setVisitorPkgsRaw] = useState([]);
  const [visitorPointRaw, setVisitorPointRaw] = useState(0);
  const [custPkgsInfo, setCustPkgsInfo] = useState([]); // 보유권 요약 표시용 (deprecated, derived 권장)
  const [custPointBal, setCustPointBal] = useState(0);  // 보유 포인트 잔액 (deprecated, derived 권장)
  // 📋 차트 작성 링크 연동 — 이 예약에 차트 작성 링크가 발송됐는지 + 작성 내용
  // sign.blissme.ai 동의서/차트는 consent_tokens(발송 토큰, prefill_data.reservation_id) +
  // customer_consents(작성 결과)로 저장. 예약별 차트를 직원이 확인할 수 있게 연결.
  const [chartInfo, setChartInfo] = useState(null); // {status, consent, signedAt, tokenSent}
  const [consentOpen, setConsentOpen] = useState(false); // 📋 동의서 보내기 모달
  const [chartReloadKey, setChartReloadKey] = useState(0); // 동의서 발송 후 차트 상태 새로고침
  const [chartExpand, setChartExpand] = useState(false);
  // 외국 이름 음역 fallback — 네이버/AI 예약 신규 고객은 customers.name_kor 비어있어서
  // _cust?.nameKor 조건만으론 화면에 안 뜸. 캐시 → Gemini 호출 → 결과 state + DB 백필
  const [autoNameKor, setAutoNameKor] = useState('');
  useEffect(() => {
    setAutoNameKor('');
    const _name = (f.custName || '').trim();
    if (!_name) return;
    if (/[가-힣]/.test(_name)) return; // 한글 이름은 음역 X
    // 1) 메모리 캐시
    const _cached = getCachedTransliteration(_name);
    if (_cached) { setAutoNameKor(_cached); return; }
    // 2) Gemini 호출 — settings 최신 키 우선 (5/17 토큰 교체 후 localStorage 옛 키 만료 이슈 회피)
    let cancelled = false;
    (async () => {
      let _key = "";
      try {
        const _r = await fetch(`${SB_URL}/rest/v1/businesses?select=settings&limit=1`, {headers: sbHeaders});
        const _rows = await _r.json();
        const _memo = JSON.parse(_rows[0]?.settings || "{}");
        _key = _memo.gemini_key || "";
        if (_key) { window.__geminiKey = _key; if (typeof localStorage !== 'undefined') localStorage.setItem('bliss_gemini_key', _key); }
      } catch(_){}
      if (!_key) _key = window.__systemGeminiKey || window.__geminiKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('bliss_gemini_key') : '') || '';
      if (!_key) return;
      transliterateName(_name, _key).then(k => {
        if (cancelled || !k) return;
        setAutoNameKor(k);
        // 3) DB 백필 — custId 있고 nameKor 비어있을 때만
        if (f.custId) {
          const _cust = (data?.customers || []).find(c => c.id === f.custId);
          if (_cust && !_cust.nameKor) {
            sb.update('customers', f.custId, { name_kor: k }).catch(() => {});
          }
        }
      });
    })();
    return () => { cancelled = true; };
  }, [f.custName, f.custId]);
  // 🆕 방문자/예약자 main(primary) cust_id 계산
  // primarySubject='visitor'면 visitorCustId가 main, 'reserver'면 custId가 main
  // visitor 정보 없으면 항상 reserver
  const _hasVisitor = !!(f.visitorName && f.visitorName !== f.custName);
  const _primaryCustId = (_hasVisitor && f.primarySubject === 'visitor') ? (f.visitorCustId || '') : (f.custId || '');
  const _secondaryCustId = (_hasVisitor && f.primarySubject === 'visitor') ? (f.custId || '') : (f.visitorCustId || '');
  const _custSummary = (data?.customers||[]).find(c => c.id === f.custId)?.serviceSummary || "";
  const _primaryName = (_hasVisitor && f.primarySubject === 'visitor') ? f.visitorName : f.custName;
  const _primaryPhone = (_hasVisitor && f.primarySubject === 'visitor') ? f.visitorPhone : f.custPhone;
  const _secondaryName = (_hasVisitor && f.primarySubject === 'visitor') ? f.custName : f.visitorName;
  const _secondaryPhone = (_hasVisitor && f.primarySubject === 'visitor') ? f.custPhone : f.visitorPhone;
  // 🆕 reserver(예약자) 보유권 + 포인트 — f.custId 변경 시만 fetch (primarySubject 토글에 영향 X)
  useEffect(() => {
    if (!f.custId) { setReserverPkgsRaw([]); setReserverPointRaw(0); return; }
    Promise.all([
      sb.get("customer_packages", `&customer_id=eq.${f.custId}`).catch(()=>[]),
      sb.get("point_transactions", `&customer_id=eq.${f.custId}&select=type,amount`).catch(()=>[]),
    ]).then(([pkgs, ptxs]) => {
      setReserverPkgsRaw(Array.isArray(pkgs) ? pkgs : []);
      let bal = 0;
      (Array.isArray(ptxs) ? ptxs : []).forEach(t => {
        if (t.type === 'earn') bal += +t.amount || 0;
        else if (t.type === 'deduct' || t.type === 'expire') bal -= +t.amount || 0;
      });
      setReserverPointRaw(Math.max(0, bal));
    }).catch(() => { setReserverPkgsRaw([]); setReserverPointRaw(0); });
  }, [f.custId]);
  // 📋 차트 작성 링크 상태 — 이 예약(item.id)에 차트 작성 링크가 발송됐는지 + 작성 내용
  useEffect(() => {
    const rid = item?.id;
    if (!rid) { setChartInfo(null); return; }
    let alive = true;
    setChartExpand(false);
    (async () => {
      // 토큰: 이 예약으로 발송된 차트 작성 링크 (prefill_data.reservation_id)
      const tokens = await sb.get("consent_tokens", `&prefill_data->>reservation_id=eq.${rid}&order=created_at.desc`).catch(()=>[]);
      // 작성 결과: form_data.reservation_id 직접 매칭 (최근 작성분)
      let consents = await sb.get("customer_consents", `&form_data->>reservation_id=eq.${rid}&order=signed_at.desc`).catch(()=>[]);
      // form_data에 reservation_id 없는 구버전 차트 → 토큰 used_at ≈ 서명시각으로 매칭
      if ((!Array.isArray(consents) || consents.length === 0) && Array.isArray(tokens)) {
        const usedTok = tokens.find(t => t.used_at && t.customer_id);
        if (usedTok) {
          const byCust = await sb.get("customer_consents", `&customer_id=eq.${usedTok.customer_id}&order=signed_at.desc&limit=30`).catch(()=>[]);
          const u = new Date(usedTok.used_at).getTime();
          const matched = (byCust||[]).find(c => c.signed_at && Math.abs(new Date(c.signed_at).getTime() - u) < 10000);
          if (matched) consents = [matched];
        }
      }
      if (!alive) return;
      const tokenSent = Array.isArray(tokens) && tokens.length > 0;
      const consent = (Array.isArray(consents) && consents.length) ? consents[0] : null;
      let status = "none";
      if (consent) status = "signed";
      else if (tokenSent) status = "sent";
      setChartInfo({ status, consent, tokenSent, signedAt: consent?.signed_at || null });
    })();
    return () => { alive = false; };
  }, [item?.id, chartReloadKey]);
  // 🆕 visitor(방문자) 보유권 + 포인트 — f.visitorCustId 변경 시만 fetch
  useEffect(() => {
    if (!f.visitorCustId) { setVisitorPkgsRaw([]); setVisitorPointRaw(0); return; }
    Promise.all([
      sb.get("customer_packages", `&customer_id=eq.${f.visitorCustId}`).catch(()=>[]),
      sb.get("point_transactions", `&customer_id=eq.${f.visitorCustId}&select=type,amount`).catch(()=>[]),
    ]).then(([pkgs, ptxs]) => {
      setVisitorPkgsRaw(Array.isArray(pkgs) ? pkgs : []);
      let bal = 0;
      (Array.isArray(ptxs) ? ptxs : []).forEach(t => {
        if (t.type === 'earn') bal += +t.amount || 0;
        else if (t.type === 'deduct' || t.type === 'expire') bal -= +t.amount || 0;
      });
      setVisitorPointRaw(Math.max(0, bal));
    }).catch(() => { setVisitorPkgsRaw([]); setVisitorPointRaw(0); });
  }, [f.visitorCustId]);
  // 🆕 visitor customer 정보 별도 fetch — data.customers는 100명만 로드되어 있어 못 찾는 케이스 대응
  const [visitorCustInfo, setVisitorCustInfo] = useState(null);
  useEffect(() => {
    if (!f.visitorCustId) { setVisitorCustInfo(null); return; }
    const _local = (data?.customers||[]).find(c => c.id === f.visitorCustId);
    if (_local) { setVisitorCustInfo(_local); return; }
    sb.get('customers', `&id=eq.${f.visitorCustId}&limit=1`).then(rows => {
      if (Array.isArray(rows) && rows.length) {
        const mapped = fromDb('customers', rows);
        setVisitorCustInfo(Array.isArray(mapped) ? mapped[0] : rows[0]);
      }
    }).catch(() => {});
  }, [f.visitorCustId, data?.customers]);
  // 🆕 호환용 derived: primary/secondary는 raw state에서 primarySubject 따라 선택
  // (기존 custPkgsInfo / secondaryPkgsInfo 의존 코드 호환)
  useEffect(() => {
    if (f.primarySubject === 'visitor' && _hasVisitor) {
      setCustPkgsInfo(visitorPkgsRaw);
      setCustPointBal(visitorPointRaw);
    } else {
      setCustPkgsInfo(reserverPkgsRaw);
      setCustPointBal(reserverPointRaw);
    }
  }, [f.primarySubject, _hasVisitor, reserverPkgsRaw, reserverPointRaw, visitorPkgsRaw, visitorPointRaw]);

  // 자동 부여 트리거 평가 — service_tags.auto_trigger에 설정된 트리거 조건 만족 시 태그 자동 부여
  // 트리거 종류(코드: src/lib/tagAutoTrigger.js): 신규고객 / 패키지 잔여 N회 이하 / 패키지 만료 /
  //   쿠폰 N일 내 만료 / N일 이상 미방문(기존상담)
  // 내부일정·기존 예약(네이버 포함)은 자동 평가 안 함 (사용자 토글 보존)
  useEffect(() => {
    if (item?.id) return;
    if (isSchedule) return;
    const tagsCfg = data?.serviceTags || [];
    if (!tagsCfg.some(t => t?.autoTrigger?.type)) return;
    // 매칭되는 고객 찾기 (custId 우선, 없으면 phone 매칭). data.customers는 100건만 초기 로드되므로
    // 못 찾으면 sb.get으로 직접 조회 — Supabase max-rows=1000 cap 영향 회피.
    const phoneNorm = (f.custPhone||"").replace(/[^0-9]/g,"");
    let matchedCust = f.custId
      ? (data?.customers||[]).find(c => c.id === f.custId)
      : (phoneNorm.length >= 10 ? (data?.customers||[]).find(c => (c.phone||"").replace(/[^0-9]/g,"") === phoneNorm) : null);
    // 매칭 고객의 customer_packages 비동기 조회 후 트리거 평가 (race-condition 방지용 cancel ref)
    let cancelled = false;
    (async () => {
      // 캐시에 없으면 직접 조회 — visits 정확도 보장
      if (!matchedCust && f.custId) {
        try {
          const rows = await sb.get("customers", `&id=eq.${f.custId}&select=id,name,phone,visits,last_visit&limit=1`);
          if (rows?.[0]) { matchedCust = rows[0]; matchedCust.lastDate = matchedCust.last_visit; }
        } catch (_) {}
      }
      if (!matchedCust && phoneNorm.length >= 10) {
        try {
          const rows = await sb.get("customers", `&phone=eq.${phoneNorm}&select=id,name,phone,visits,last_visit&limit=1`);
          if (rows?.[0]) { rows[0].lastDate = rows[0].last_visit; }
          if (rows?.[0]) matchedCust = rows[0];
        } catch (_) {}
      }
      if (cancelled) return;
      let custPkgs = [];
      let hasPaidSale = false; // 매출 > 0 건 1건이라도 있는지 (체험단 등 0원 매출은 신규로 간주)
      if (matchedCust?.id) {
        try { custPkgs = await sb.get("customer_packages", `&customer_id=eq.${matchedCust.id}`) || []; }
        catch (_) { custPkgs = []; }
        // 유료 매출 1건이라도 있는지 — 결제수단 합 > 0 (sales 테이블엔 'total' 컬럼이 없음 → OR 필터)
        try {
          const _paid = await sb.get("sales", `&cust_id=eq.${matchedCust.id}&or=(svc_cash.gt.0,svc_transfer.gt.0,svc_card.gt.0,svc_point.gt.0,prod_cash.gt.0,prod_transfer.gt.0,prod_card.gt.0,prod_point.gt.0,external_prepaid.gt.0)&select=id&limit=1`);
          hasPaidSale = Array.isArray(_paid) && _paid.length > 0;
        } catch (_) { hasPaidSale = false; }
      }
      if (cancelled) return;
      const matchedTagIds = evaluateTagTriggers({
        tags: tagsCfg,
        customer: matchedCust || null,
        custPkgs,
        services: data?.services || [],
        serviceCategories: data?.cats || data?.serviceCategories || [],
        hasPaidSale,
      });
      setF(p => {
        const tags = Array.isArray(p.selectedTags) ? p.selectedTags : [];
        // 이번 평가에서 부여될 태그(matchedTagIds)는 추가, 부여되지 않을 자동 트리거 태그는 제거
        const autoIds = new Set(tagsCfg.filter(t => t?.autoTrigger?.type).map(t => t.id));
        const next = tags.filter(id => !autoIds.has(id) || matchedTagIds.includes(id));
        matchedTagIds.forEach(id => { if (!next.includes(id)) next.push(id); });
        // 변경 없으면 prev 그대로
        if (next.length === tags.length && next.every((id, i) => id === tags[i])) return p;
        return { ...p, selectedTags: next };
      });
    })();
    return () => { cancelled = true; };
  }, [f.custId, f.custPhone, isSchedule, data?.customers, data?.serviceTags, item?.id]);
  // 잔액을 한국식 짧은 단위로 포맷 (380000 → "38만", 381000 → "38.1만", 5000 → "5천")
  const _fmtKor = (n) => {
    if (!n || n <= 0) return "";
    if (n < 10000) return Math.round(n/1000) + "천";
    const v = n / 10000;
    return (v % 1 === 0 ? v : Math.round(v*10)/10) + "만";
  };
  // 보유권 요약 빌더 (유효권만)
  const _buildPkgSummary = (pkgs) => {
    const out = [];
    const today = new Date().toISOString().slice(0,10);
    (pkgs||[]).forEach(p => {
      const n = (p.service_name||"");
      const nl = n.toLowerCase();
      const isPrepaid = isMoneyPkg(p);
      const isAnnual  = n.includes("연간") || n.includes("할인권") || n.includes("회원권");
      const expM = (p.note||"").match(/유효:(\d{4}-\d{2}-\d{2})/);
      const isExp = expM && expM[1] < today;
      const cleanName = (n.split("(")[0]||"").trim();
      if (isPrepaid) {
        const m = (p.note||"").match(/잔액:([0-9,]+)/);
        const bal = m ? Number(m[1].replace(/,/g,"")) : 0;
        // 라벨에서 trailing 충전금액 제거: "다담권 100만"·"바프권 30만"·"다담권 1,000,000원" → "다담권"/"바프권"
        const prepaidLabel = cleanName.replace(/\s+[\d][\d,]*(\.\d+)?\s*(만원?|천|원)?\s*$/, "").trim();
        out.push({type:"prepaid", active: bal>0 && !isExp, label: prepaidLabel || cleanName || "다담권", value: _fmtKor(bal)});
      } else if (isAnnual) {
        out.push({type:"annual", active:!isExp, label: cleanName || "연간권", value: ""});
      } else {
        const remain = (p.total_count||0) - (p.used_count||0);
        const shortName = cleanName.replace(/\s*5회$/,"").trim();
        out.push({type:"package", active: remain>0 && !isExp, label: shortName || "다회권", value: remain>0 ? `${remain}회` : ""});
      }
    });
    return out.filter(p => p.active);
  };
  // 🆕 reserver/visitor 별 보유권/포인트 — raw state 직접 (primarySubject 토글에 영향 X, 깜빡임 없음)
  const _reserverPkgs = reserverPkgsRaw;
  const _visitorPkgs = visitorPkgsRaw;
  const _reserverPoint = reserverPointRaw;
  const _visitorPoint = visitorPointRaw;
  const reserverPkgSummary = _buildPkgSummary(_reserverPkgs);
  const visitorPkgSummary = _buildPkgSummary(_visitorPkgs);
  // 기존 호환 — 다른 곳에서 사용 (예: AI 프롬프트, 자동 트리거 평가)
  const activePkgSummary = reserverPkgSummary;
  // 디바운스 검색 (300ms, 2글자 이상) — DB 직접 검색
  // 다단어 AND: 모든 토큰이 어느 필드에든 포함되면 매칭 (서버 필터)
  useEffect(() => {
    if (custSearch.trim().length < 2) { setCustResults([]); return; }
    const timer = setTimeout(async () => {
      const raw = custSearch.trim();
      try {
        const bizId = _activeBizId;
        if (!bizId) return;
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
  const selectCust = (c) => {
    const fullPhone = c.phone || c.phone2 || "";
    setF(p=>({...p, custId:c.id, custName:c.name, custName2:c.name2||"", custPhone:fullPhone, custGender:c.gender, custEmail:c.email||"", isNewCust:false}));
    setCustNum(c.custNum||"");
    setCustSearch("");
    setShowCustDropdown(false);
    // editingCust는 호출자에서 결정 (변경 모드는 유지, 인라인 검색결과/신규등록 후 액션바 유지)
  };

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
      const list = Array.isArray(rows) ? rows : [];
      setSalesHistory(list);
      // sale_details 한 번에 IN 쿼리로 fetch (sales.service_name 단일 캐시는 부정확 — 실제 결제·차감 항목으로 표시)
      try {
        const ids = list.map(s => s.id).filter(Boolean);
        if (ids.length) {
          const inList = ids.join(",");
          const dts = await sb.get("sale_details",
            `&sale_id=in.(${inList})&select=sale_id,service_name,qty,unit_price,item_kind&order=service_no.asc`);
          const map = {};
          (dts || []).forEach(d => {
            const sid = d.sale_id; if (!sid) return;
            (map[sid] = map[sid] || []).push(d);
          });
          setSalesDetailsMap(map);
        } else { setSalesDetailsMap({}); }
      } catch(e) { console.error("sale_details err", e); setSalesDetailsMap({}); }
    } catch(e) { console.error("sales history err", e); setSalesHistory([]); setSalesDetailsMap({}); }
    setHistoryLoading(false);
  }, []);

  // 확장 패널 열 때 히스토리 로드 — primary cust_id 기준 (visitor/reserver 스왑 반영)
  useEffect(() => {
    if (!historyOpen) return;
    const cid = _primaryCustId || f.custId || item?.custId;
    const cphone = _primaryPhone || f.custPhone || item?.custPhone;
    const cname = _primaryName || f.custName || item?.custName;
    loadSalesHistory(cid, cphone, cname);
  }, [historyOpen, _primaryCustId, _primaryName, _primaryPhone, loadSalesHistory]);

  // 시간으로 dur 자동 계산
  const calcDur = (startT, endT) => {
    const [sh,sm] = startT.split(":").map(Number);
    const [eh,em] = endT.split(":").map(Number);
    return (eh*60+em) - (sh*60+sm);
  };

  // ── AI 자동분석: 네이버 request_msg → 시술상품 + 예약태그 자동 선택 ──
  const handleAiAnalyze = async () => {
    // settings에서 항상 최신 키 fetch (localStorage 캐시 옛 키 문제 회피 — 5/17 토큰 교체 후 만료 이슈)
    let apiKey = "";
    try {
      const r = await fetch(`${SB_URL}/rest/v1/businesses?select=settings&limit=1`, {headers: sbHeaders});
      const rows = await r.json();
      const memo = JSON.parse(rows[0]?.settings || "{}");
      apiKey = memo.gemini_key || "";
      if (apiKey) { window.__geminiKey = apiKey; localStorage.setItem("bliss_gemini_key", apiKey); }
    } catch(e) {}
    if (!apiKey) apiKey = window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "";
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
      // billing 차감 — 예약 모달 AI 분석 (예약의 bid에 귀속)
      try {
        const _bizId = data?.businesses?.[0]?.id;
        if (_bizId && f.bid) {
          const { deductBilling } = await import('../../lib/billing');
          deductBilling({ bizId:_bizId, branchId:f.bid, kind:'ai_call', refTable:'rsv_ai_analyze', refId:f.id });
        }
      } catch {}
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
      // AI 결과에서 시스템 태그 제거 (시스템 태그는 service_tags.auto_trigger 시스템이 자동 처리)
      let newTags = fuzzyFix(parsed.matchedTagIds || [], validTagSet).filter(id => !SYSTEM_TAG_IDS.includes(id) && validTagSet.has(id));
      // '신규' 태그는 evaluateTagTriggers useEffect(is_new_customer 트리거)가 자동 처리 — 하드코딩 제거
      // 예약금완료 자동 처리: 선결제(네이버 또는 외부플랫폼)면 태그 추가 (시스템 상태이므로 유지)
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
        const multiPkgs = (custPkgsInfo||[]).filter(p=>{const n=(p.service_name||"").toLowerCase();const exp=((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];if(exp&&exp<new Date().toISOString().slice(0,10))return false;return !isMoneyPkg(p)&&!n.includes("연간")&&!n.includes("할인권")&&!n.includes("회원권")&&(p.total_count||0)-(p.used_count||0)>0;});
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
    // 매출 등록 후 예약 모달 그대로 유지 (매출 정보 확인 가능). 매출관리 페이지로 강제 이동 X
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

  // 매출확인(viewOnly) 모드용 sale_details 로드 — SaleForm 이 실제 저장값으로 프리필되도록
  React.useEffect(() => {
    if (!existingSale?.id) { setExistingSaleDetails(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await sb.get("sale_details", `&sale_id=eq.${existingSale.id}&order=id.asc`);
        if (!cancelled) setExistingSaleDetails(Array.isArray(rows) ? rows : []);
      } catch(e) { if (!cancelled) setExistingSaleDetails([]); }
    })();
    return () => { cancelled = true; };
  }, [existingSale?.id]);

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

  // ─── 페널티 차감 헬퍼 — 수동 취소·노쇼·네이버 취소 모두 사용 ───
  // 페널티 매출 이미 존재 여부 (sales.service_name 에 "페널티" 포함)
  const penaltyAlreadyDone = useMemo(() => {
    return !!(existingSale && /페널티/.test(existingSale.serviceName || existingSale.service_name || ''));
  }, [existingSale]);

  // 차감 진행 중 (중복 호출 방지)
  const _penaltyRunningRef = React.useRef(false);
  const runPenaltyDeduction = async (reasonLabel) => {
    if (_penaltyRunningRef.current) return;
    if (penaltyAlreadyDone) { alert('이미 페널티 차감이 처리된 예약입니다.'); return; }
    if (!f.custId || isSchedule) { alert('고객 연결이 없거나 내부일정 — 차감 불가'); return; }
    _penaltyRunningRef.current = true;
    try {
      const PENALTY = 33000;
      const today = todayStr();
      const _bizId = (data?.businesses||[])[0]?.id;
      const _userPrepaid = Math.max(0, Number(f.externalPrepaid)||0);
      const _resolveCustNum = async () => {
        let custNumFinal = f.custNum || '';
        if (!custNumFinal && f.custId) {
          try {
            const _rows = await sb.get("customers", `&id=eq.${f.custId}&select=cust_num&limit=1`);
            custNumFinal = (_rows && _rows[0]?.cust_num) || '';
          } catch {}
        }
        return custNumFinal;
      };
      if (_userPrepaid > 0) {
        // confirm 제거 (v3.7.210) — CancelDecisionModal이 결정 책임. 여기 도달했으면 사용자가 차감 결정한 상태.
        const penaltySaleId = 'sale_' + genId();
        const custNumFinal = await _resolveCustNum();
        const svcName = `${reasonLabel} 페널티 (선결제 ${_userPrepaid.toLocaleString()}원)`;
        const _saleRow = {
          id: penaltySaleId, business_id: _bizId, bid: f.bid,
          reservation_id: f.id,
          cust_id: f.custId, cust_name: f.custName, cust_phone: f.custPhone||'',
          cust_num: custNumFinal, cust_gender: f.custGender||'',
          date: f.date || today, service_name: svcName,
          svc_cash: 0, svc_card: 0, svc_transfer: 0, svc_point: 0,
          external_prepaid: _userPrepaid,
          memo: `${reasonLabel} 페널티 — 선결제 ${_userPrepaid.toLocaleString()}원 차감 (예약 ${f.id})`,
        };
        await sb.insert("sales", _saleRow).catch(e => console.error('[penalty sales insert]', e));
        await sb.insert("sale_details", {
          id: 'sd_' + genId(), business_id: _bizId, sale_id: penaltySaleId,
          service_name: svcName, unit_price: _userPrepaid, qty: 1,
          cash: 0, card: 0, bank: 0, point: 0,
        }).catch(e => console.error('[penalty sd insert]', e));
        if (setData) setData(prev => ({...prev, sales: [...(prev?.sales||[]), {..._saleRow, reservationId: f.id, custId: f.custId, serviceName: svcName}]}));
        alert(`${reasonLabel} 페널티 ${_userPrepaid.toLocaleString()}원 처리 완료 (선결제)`);
        return;
      }
      // 선결제 없음 — 포인트→선불권→다회권 차감
      const ptxs = await sb.get("point_transactions", `&customer_id=eq.${f.custId}&select=type,amount`) || [];
      let pointBal = 0;
      for (const t of ptxs) {
        if (t.type === 'earn') pointBal += Number(t.amount)||0;
        else if (t.type === 'deduct' || t.type === 'expire') pointBal -= Number(t.amount)||0;
      }
      const myPkgs = await sb.get("customer_packages", `&customer_id=eq.${f.custId}`) || [];
      const isExpired = (p) => {
        const exp = ((p.note||'').match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
        return exp && exp < today;
      };
      const prepaidPkgs = myPkgs.filter(p => {
        if (!isMoneyPkg(p)) return false;
        if (isExpired(p)) return false;
        const m = (p.note||'').match(/잔액:([0-9,]+)/);
        return m ? Number(m[1].replace(/,/g,'')) > 0 : false;
      });
      const prepaidBal = prepaidPkgs.reduce((s,p) => {
        const m = (p.note||'').match(/잔액:([0-9,]+)/);
        return s + (m ? Number(m[1].replace(/,/g,'')) : 0);
      }, 0);
      const total = pointBal + prepaidBal;
      // confirm 제거 (v3.7.210) — CancelDecisionModal이 결정 책임. 여기 도달했으면 사용자가 차감 결정한 상태.
      let pointDed = 0, prepaidDed = 0, pkgUsedName = '';
      if (total >= PENALTY) {
        let remain = PENALTY;
        if (pointBal > 0) {
          const ded = Math.min(pointBal, remain);
          await sb.insert("point_transactions", {
            id: 'ptx_'+genId(), business_id: _bizId,
            bid: f.bid, customer_id: f.custId,
            type: 'deduct', amount: ded,
            balance_after: pointBal - ded,
            note: `${reasonLabel} 페널티 (예약 ${f.id})`,
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
        alert(`${reasonLabel} 페널티 ${PENALTY.toLocaleString()}원 차감 완료`);
      } else {
        const multi = myPkgs.filter(p => {
          const n = (p.service_name||'').toLowerCase();
          if (isMoneyPkg(p) || n.includes('연간') || n.includes('할인권') || n.includes('회원권')) return false;
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
      if (pointDed > 0 || prepaidDed > 0 || pkgUsedName) {
        try {
          const penaltySaleId = 'sale_' + genId();
          const svcParts = [];
          if (pointDed > 0) svcParts.push(`포인트 ${pointDed.toLocaleString()}P`);
          if (prepaidDed > 0) svcParts.push(`선불권 ${prepaidDed.toLocaleString()}원`);
          if (pkgUsedName) svcParts.push(`다회권 ${pkgUsedName} 1회`);
          const svcName = svcParts.length ? `${reasonLabel} 페널티 (${svcParts.join(', ')})` : `${reasonLabel} 페널티`;
          const memoParts = svcParts.slice();
          const custNumFinal = await _resolveCustNum();
          const _saleRow = {
            id: penaltySaleId, business_id: _bizId, bid: f.bid,
            reservation_id: f.id,
            cust_id: f.custId, cust_name: f.custName, cust_phone: f.custPhone||'',
            cust_num: custNumFinal, cust_gender: f.custGender||'',
            date: f.date || today, service_name: svcName,
            svc_cash: 0, svc_card: 0, svc_transfer: 0, svc_point: pointDed,
            external_prepaid: 0,
            memo: `${reasonLabel} 페널티 — ${memoParts.join(' + ')} (예약 ${f.id})`,
          };
          await sb.insert("sales", _saleRow).catch(e => console.error('[penalty sales insert]', e));
          await sb.insert("sale_details", {
            id: 'sd_' + genId(), business_id: _bizId, sale_id: penaltySaleId,
            service_name: svcName, unit_price: PENALTY, qty: 1,
            cash: 0, card: 0, bank: 0, point: pointDed,
          }).catch(e => console.error('[penalty sd insert]', e));
          if (setData) setData(prev => ({...prev, sales: [...(prev?.sales||[]), {..._saleRow, reservationId: f.id, custId: f.custId, serviceName: svcName}]}));
        } catch(e) { console.error('[penaltySale]', e); }
      }
    } catch (e) {
      console.error('[runPenaltyDeduction]', e);
      alert('페널티 처리 중 오류: ' + (e?.message || e));
    } finally {
      _penaltyRunningRef.current = false;
    }
  };

  // 네이버 자동 취소 자동 트리거 제거 (v3.7.210) — 직원이 "취소확정" 버튼 명시적 클릭할 때만 모달 띄움.
  // 차감 결정 모달 state — 모든 취소 흐름(naver_cancelled / cancelled / no_show)에서 공용.
  // resolve는 'deduct'(차감하고 취소) | 'skip'(차감없이 취소) | 'close'(취소 행위 자체 중단)
  const [cancelDecision, setCancelDecision] = useState(null);
  // { reason: '취소확정'|'당일취소'|'노쇼'|'네이버 취소', onResolve: (decision)=>void }
  const openCancelDecision = (reasonLabel) => new Promise(resolve => {
    setCancelDecision({
      reason: reasonLabel,
      onResolve: (decision) => { setCancelDecision(null); resolve(decision); }
    });
  });

  // ⚠️ 모든 hook은 조건부 early return 이전에 호출되어야 함 (React Rules of Hooks)
  const _overlayDownRef = React.useRef(false);

  if (showSaleForm) {
    // 빈 값(null/empty)은 f의 값을 보존 — 페널티 sale은 cust_num 등이 비어있어 spread하면 reservation의 값을 지움 (id_6uosrdj14g)
    const _existingSaleClean = existingSale ? Object.fromEntries(Object.entries(existingSale).filter(([_,v]) => v !== '' && v !== null && v !== undefined)) : {};
    // 🆕 방문자/예약자 main 기준으로 cust 정보 override
    // primarySubject='visitor'면 visitor 정보로 매출 등록 (cust_id=visitorCustId, cust_name=visitorName 등)
    const _fForSale = (_hasVisitor && f.primarySubject === 'visitor')
      ? { ...f, custId: f.visitorCustId || '', custName: f.visitorName || '', custPhone: f.visitorPhone || '', _subjectType: 'visitor' }
      : { ...f, _subjectType: 'reserver' };
    const saleReservation = existingSale
      ? {..._fForSale, ..._existingSaleClean, saleMemo:existingSale.memo||"",
         _prefill: { existingDetails: existingSaleDetails || [], existingSaleId: existingSale.id },
         _existingSale:existingSale}
      : _fForSale;
    // 기존 매출 있으면 읽기전용 모드 — 중복 INSERT 방지 + 수정 차단 (수정은 매출관리에서만)
    return <DetailedSaleForm reservation={saleReservation} branchId={branchId} onSubmit={handleSaleSubmit} onClose={() => setShowSaleForm(false)} data={data} setData={setData}
      viewOnly={!!existingSale} existingSaleId={existingSale?.id}/>;
  }

  const _isMob = window.innerWidth <= 768;
  return (
    <div
      className="rsv-modal-wrap"
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
          <button className="res-tab-btn" onClick={()=>{setIsSchedule(true);setF(p=>({...p,isSchedule:true,selectedTags:[],type:"schedule"}));if(modalRef.current)modalRef.current.scrollTop=0}}
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
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.warning}}>네이버 고객 취소</span>
            {f.reservationId && <span style={{fontSize:T.fs.xs,color:T.gray500}}>#{f.reservationId}</span>}
            {!penaltyAlreadyDone && f.custId && !isSchedule && (
              <button
                onClick={async ()=>{
                  const decision = await openCancelDecision('취소확정');
                  if (decision === 'deduct') {
                    await runPenaltyDeduction('네이버 취소');
                  }
                  // skip / close 시 별도 처리 없음 (status는 이미 naver_cancelled)
                }}
                style={{marginLeft:'auto',padding:'5px 12px',fontSize:T.fs.xs,fontWeight:T.fw.bolder,background:T.warning,color:'#fff',border:'none',borderRadius:T.radius.sm,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                ✅ 취소확정
              </button>
            )}
            {penaltyAlreadyDone && <span style={{marginLeft:'auto',fontSize:T.fs.xs,color:T.gray500,fontStyle:'italic'}}>처리완료</span>}
          </div>}
          {f.status === "pending" && !(f.memo && f.memo.includes("확정완료")) && <div style={{background:T.orangeLt,borderRadius:T.radius.md,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:T.sp.sm,flexWrap:"wrap",animation:"naverBlink 1.5s infinite",boxShadow:"0 2px 8px rgba(255,152,0,.15)"}}>
            <span style={{fontSize:T.fs.lg}}><I name="bell" size={16} color={T.orange}/></span>
            <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.orange}}>확정대기</span>
            <div style={{marginLeft:"auto",display:"flex",gap:6}}>
              {(() => {
              const br = (data.branchSettings||data.branches||[]).find(b=>b.id===branchId);
              const bizId = br?.naverBizId;
              const resId = f?.reservationId || item?.reservationId;
              // 네이버 예약일 때만 "네이버 확정" 버튼. 외부 플랫폼은 수동 확정만.
              if (!isNaverItem) {
                const onManualConfirm = (e) => {
                  e.stopPropagation();
                  setF(prev => ({...prev, status:'reserved'}));
                  if (setData) setData(prev => ({...prev, reservations:(prev.reservations||[]).map(x => x.id === f.id ? {...x, status:'reserved'} : x)}));
                };
                return <button onClick={onManualConfirm}
                  style={{fontSize:T.fs.sm,color:T.bgCard,fontWeight:T.fw.bolder,background:T.primary,padding:"5px 12px",borderRadius:T.radius.md,border:'none',cursor:'pointer',display:"inline-flex",alignItems:"center",gap:3,fontFamily:'inherit'}}>✓ 확정</button>;
              }
              if (!bizId || !resId) return null;
              const onConfirm = async (e) => {
                e.stopPropagation();
                const btn = e.currentTarget; const orig = btn.textContent;
                btn.textContent = '확정 중…'; btn.disabled = true;
                const r = await naverConfirmBooking(bizId, resId);
                const errMsg = String(r?.msg || r?.error || '');
                const isAlreadyConfirmed = !r?.ok && /ALREADY_CONFIRMED/i.test(errMsg);
                if (r?.ok || isAlreadyConfirmed) {
                  btn.textContent = '✓ 완료';
                  setF(prev => ({...prev, status:'reserved'}));
                  if (setData) setData(prev => ({...prev, reservations:(prev.reservations||[]).map(x => x.id === f.id ? {...x, status:'reserved'} : x)}));
                  try { await sb.update('reservations', f.id, { status: 'reserved' }); } catch {}
                  if (isAlreadyConfirmed) alert('이미 네이버에서 확정된 예약이라 블리스 상태만 동기화했어요.');
                } else {
                  btn.textContent = orig; btn.disabled = false;
                  if (/ITEM_NOT_SALE/i.test(errMsg)) {
                    alert('이 시간/시술이 네이버 예약관리에서 판매 중지(막기) 상태라 확정할 수 없어요.\n네이버 예약관리에서 슬롯 막기를 해제한 뒤 다시 시도해 주세요.');
                  } else {
                    alert('네이버 확정 실패: ' + errMsg);
                  }
                }
              };
              return <button onClick={onConfirm}
                style={{fontSize:T.fs.sm,color:T.bgCard,fontWeight:T.fw.bolder,background:T.naver,padding:"5px 12px",borderRadius:T.radius.md,border:'none',cursor:'pointer',display:"inline-flex",alignItems:"center",gap:3,fontFamily:'inherit'}}>✓ 네이버 확정</button>;
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
                  {branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const stName = st.dn ? st.dn.replace(brName,"").trim() : (st.name || st.id);
                    const label = stName ? `${brName}-${stName}` : brName;
                    const defRoom = branchRooms[0]?.id || "";
                    return <option key={st.id} value={`${defRoom}|${st.id}`}>{label}</option>;
                  })}
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
            {/* 고객 정보 — 컴팩트 인라인.
                🆕 _hasVisitor일 때만: 외곽 단일 보더 박스로 예약자/방문자/액션바를 묶음.
                    단일 케이스(_hasVisitor=false)는 v3.7.619 원본 그대로. */}
            <div style={{
                position:"relative",
                // 🆕 visitor 케이스 — 연한 외곽 통합 박스 (단일 카드 톤)
                ...(_hasVisitor ? {
                  background: "linear-gradient(135deg,#f8f9fb,#f0f2f5)",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: 12,
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,.08)",
                  transition: "all .15s",
                  cursor: "pointer",
                } : {})
              }}
              onClick={()=>{ if(_hasVisitor) set('primarySubject','reserver'); }}>
              {/* 고객 선택됨: D안 — 정보 영역 + 분리된 액션바 */}
              {f.custName ? (
                <div style={!_hasVisitor ? {
                    // 🛡️ 단일 케이스 — v3.7.619 원본 그대로 (절대 손대지 않음)
                    background: "linear-gradient(135deg,#f8f9fb,#f0f2f5)",
                    borderRadius: 10,
                    border: "1px solid #e2e5ea",
                    overflow:"hidden",
                    boxShadow: "none",
                    transition:"all .15s",
                  } : {
                    // 🆕 visitor 케이스 — 외곽 wrapper 내부의 첫 섹션. 보더 없음 + 디바이더만 + 비활성은 opacity로 흐리게
                    background: f.primarySubject === 'reserver' ? "linear-gradient(135deg,#F3F0FF,#E9E2FE)" : "transparent",
                    borderRadius: 0,
                    border: "none",
                    borderBottom: "1px solid #e2e5ea", // 예약자 ↔ 방문자 디바이더
                    overflow:"hidden",
                    boxShadow: f.primarySubject === 'reserver' ? "inset 4px 0 0 0 #5B21B6" : "none",
                    transition:"background .15s, box-shadow .15s, opacity .15s",
                    cursor: "pointer",
                    position: "relative",
                    opacity: f.primarySubject === 'reserver' ? 1 : 0.55,
                  }}>
                  {/* 🆕 예약자 라벨 — visitor 있을 때만 표시 (UX 통일) */}
                  {_hasVisitor && (
                    <div style={{padding:"6px 12px 0",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:10,fontWeight:800,color:f.primarySubject==='reserver'?"#5B21B6":"#999",letterSpacing:0.3,whiteSpace:"nowrap"}}>📌 예약자</span>
                      {f.primarySubject === 'reserver' && (
                        <span style={{fontSize:9,padding:"1px 6px",background:"#5B21B6",color:"#fff",borderRadius:3,fontWeight:800}}>🎯 매출 기준</span>
                      )}
                    </div>
                  )}
                  {/* ── 정보 영역 ── */}
                  <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 12px"}}>
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
                      {/* 1줄: 이름 #번호 + 배지 (모두 클릭 복사 / 신규는 input) */}
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        {(f.isNewCust || editingCust) ? (
                          <input value={f.custName||""} onChange={e=>set("custName",e.target.value)}
                            placeholder="고객 이름"
                            style={{fontSize:14,fontWeight:700,color:"#1a1a2e",padding:"3px 8px",border:"1px solid #e0e0e0",borderRadius:6,fontFamily:"inherit",outline:"none",background:"#fff",minWidth:120}}/>
                        ) : (
                          <CopySpan text={f.custName} style={{fontSize:14,fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap"}}>{f.custName}</CopySpan>
                        )}
                        {(() => {
                          // 영문 이름이면 한글 음역 인라인 표시.
                          // 1순위: customers.name_kor (DB 저장값) — 직원/관리 페이지에서 음역 처리한 결과
                          // 2순위: autoNameKor (이 모달 useEffect에서 즉석 음역) — 네이버/AI 예약 신규 고객 fallback
                          const _cust = (data?.customers||[]).find(c => c.id === f.custId);
                          const _isEn = f.custName && !/[가-힣]/.test(f.custName);
                          let _kor = '';
                          if (_isEn) {
                            if (_cust?.nameKor && /[가-힣]/.test(_cust.nameKor)) _kor = _cust.nameKor;
                            else if (autoNameKor && /[가-힣]/.test(autoNameKor)) _kor = autoNameKor;
                          }
                          return _kor ? <span style={{fontSize:13,color:T.primaryDk||"#5B21B6",fontWeight:700,whiteSpace:"nowrap"}}>{_kor}</span> : null;
                        })()}
                        {f.custName2 && <span style={{fontSize:12,color:"#888",fontWeight:500,whiteSpace:"nowrap"}}>({f.custName2})</span>}
                        {custNum && <CopySpan text={custNum} style={{fontSize:13,color:T.text,fontWeight:700,whiteSpace:"nowrap"}}>#{custNum}</CopySpan>}
                        {shareCusts.length > 0 && <span title={`쉐어: ${shareCusts.map(s=>s.name).join(", ")}`}
                          style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#F5F3FF",color:"#5B21B6",border:"1px solid #C4B5FD",fontWeight:700,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
                          <I name="users" size={10}/>쉐어 {shareCusts.length}명
                        </span>}
                        {/* 주의 배지 */}
                        {(() => {
                          const _cust = (data?.customers||[]).find(c => c.id === f.custId);
                          if (!_cust) return null;
                          const _grade = customerGrade(_cust);
                          if (_grade !== 'caution') return null;
                          const _cp = Number(_cust.cancelPenaltyCount || 0);
                          const _ns = Number(_cust.noShowCount || 0);
                          return <span title={`페널티 취소 ${_cp}회 / 노쇼 ${_ns}회`}
                            style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#FFF3E0",color:"#E65100",border:"1px solid #FFB74D",fontWeight:800,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
                            <I name="alert" size={10}/>주의 (취소{_cp}/노쇼{_ns})
                          </span>;
                        })()}
                        {/* 📋 차트 작성 상태 — 우측. 작성완료면 클릭해서 내용 보기 */}
                        {chartInfo?.status === "signed" && <button type="button" onClick={(e)=>{e.stopPropagation(); setChartExpand(v=>!v);}}
                          title="클릭해서 작성 내용 보기"
                          style={{marginLeft:"auto",fontSize:10,padding:"2px 9px",borderRadius:10,background:chartExpand?"#047857":"#059669",color:"#fff",border:"none",fontWeight:800,whiteSpace:"nowrap",cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}>
                          <I name="fileText" size={10}/>차트 작성완료</button>}
                        {chartInfo?.status !== "signed" && f.custId && !String(f.custId).startsWith("new_") && !f.isNewCust && (
                          <button type="button" onClick={(e)=>{e.stopPropagation(); setConsentOpen(true);}}
                            title="동의서/차트 작성 링크를 고객에게 보내기 (문자·QR·태블릿)"
                            style={{marginLeft:"auto",fontSize:10,padding:"2px 9px",borderRadius:10,
                              background: chartInfo?.status==="sent" ? "#FFF7ED" : "#EDE7F6",
                              color: chartInfo?.status==="sent" ? "#c2410c" : "#5B21B6",
                              border:"none",fontWeight:800,whiteSpace:"nowrap",cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}>
                            <I name="fileText" size={10}/>{chartInfo?.status==="sent" ? "동의서 재전송" : "동의서 보내기"}</button>
                        )}
                      </div>
                      {/* 2줄: 전화 + 이메일 한 줄 (신규/변경 모드는 input) */}
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:3,flexWrap:"wrap",minWidth:0}}>
                        <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:f.isNewCust?1:0,flex:f.isNewCust?1:"0 0 auto",minWidth:0}}>
                          <span style={{fontSize:11,color:"#aaa"}}>📞</span>
                          {(f.isNewCust || editingCust) ? (
                            <input type="tel" value={f.custPhone||""} onChange={e=>set("custPhone",e.target.value.replace(/[^0-9-]/g,""))}
                              placeholder="연락처 (010-1234-5678)"
                              style={{flex:1,fontSize:13,padding:"3px 8px",border:"1px solid #e0e0e0",borderRadius:6,fontFamily:"inherit",outline:"none",background:"#fff",color:T.primary,fontWeight:500,minWidth:120}}/>
                          ) : (
                            <CopySpan text={f.custPhone} style={{fontSize:13,color:T.primary,fontWeight:500,whiteSpace:"nowrap"}}>{f.custPhone||"연락처 없음"}</CopySpan>
                          )}
                        </span>
                        {(editingCust || f.isNewCust || f.custEmail) && (
                          <span style={{display:"flex",alignItems:"center",gap:6,flex:(editingCust||f.isNewCust)?1:"0 1 auto",minWidth:0}}>
                            <span style={{fontSize:11,color:"#aaa"}}>✉</span>
                            {(editingCust || f.isNewCust) ? (
                              <input type="email" value={f.custEmail||""} onChange={e=>set("custEmail",e.target.value)}
                                placeholder="이메일 (외국인 고객 등)"
                                style={{flex:1,fontSize:12,padding:"3px 8px",border:"1px solid #e0e0e0",borderRadius:6,fontFamily:"inherit",outline:"none",background:"#fff",color:"#444",minWidth:120}}/>
                            ) : (
                              <CopySpan text={f.custEmail} style={{fontSize:12,color:"#666",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.custEmail}</CopySpan>
                            )}
                          </span>
                        )}
                      </div>
                      {/* 변경 모드 — 한 줄 검색 input + inline 검색결과/신규등록 */}
                      {editingCust && (
                        <>
                          <div style={{marginTop:8,position:"relative",display:"flex",alignItems:"center"}}>
                            <span style={{position:"absolute",left:10,color:T.gray500,display:"flex",alignItems:"center",pointerEvents:"none",zIndex:1}}><I name="search" size={14}/></span>
                            <input style={{flex:1,minHeight:36,borderRadius:T.radius.md,paddingLeft:32,paddingRight:10,fontSize:13,background:"#fff",border:`1.5px solid ${T.border}`,outline:"none",fontFamily:"inherit",color:T.text}}
                              value={custSearch}
                              onChange={e=>{ setCustSearch(e.target.value); setShowCustDropdown(true); }}
                              onFocus={()=>setShowCustDropdown(true)}
                              placeholder="고객명, 전화번호 (2글자 이상)"/>
                          </div>
                          {/* 인라인 검색결과 + 신규등록 — 변경 모드에서만 input 바로 아래에 */}
                          {custSearch.length >= 2 && (
                            <div style={{marginTop:6,background:"#fff",borderRadius:T.radius.md,border:`1px solid ${T.border}`,overflow:"hidden",maxHeight:240,overflowY:"auto"}}>
                              {custResults.map(c => (
                                <div key={c.id} onClick={()=>{selectCust(c);setF(p=>({...p,isNewCust:false}))}}
                                  style={{padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid #e0e0e020",display:"flex",gap:6,alignItems:"center",fontSize:12}}
                                  onMouseOver={e=>e.currentTarget.style.background=T.gray200} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                                  <span className="badge" style={{background:c.gender==="M"?T.infoLt:c.gender==="F"?T.femaleLt:T.gray200,color:c.gender==="M"?T.primary:c.gender==="F"?T.female:T.gray500,fontSize:10}}>{c.gender==="M"?"남":c.gender==="F"?"여":"-"}</span>
                                  {c.custNum && <span style={{fontSize:11,color:T.text,background:T.gray100,padding:"1px 5px",borderRadius:3,fontWeight:700}}>{c.custNum}</span>}
                                  <span style={{fontWeight:600}}>{c.name}</span>
                                  <span style={{color:T.textSub}}>{c.phone}</span>
                                </div>
                              ))}
                              {custResults.length===0 && <div style={{padding:"8px 12px",fontSize:12,color:T.gray500,textAlign:"center"}}>검색결과 없음</div>}
                              <div onClick={()=>{const q=custSearch.trim();const isEmail=q.includes("@");setF(p=>({...p,isNewCust:true,custId:null,custName:isEmail?"":q.replace(/[0-9\-@.]/g,"").trim(),custPhone:q.replace(/[^0-9]/g,""),custEmail:isEmail?q:""}));setCustSearch("");setShowCustDropdown(false)}}
                                style={{padding:"8px 12px",cursor:"pointer",display:"flex",gap:6,alignItems:"center",fontSize:12,background:"#d0d0d020",borderTop:"1px solid "+T.border,color:T.danger,fontWeight:700}}
                                onMouseOver={e=>e.currentTarget.style.background="#d0d0d040"} onMouseOut={e=>e.currentTarget.style.background="#d0d0d020"}>
                                <I name="plus" size={13}/> 신규등록 {custSearch && <span style={{fontWeight:400,color:T.textSub}}>"{custSearch}"</span>}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {/* 성별 선택 — 신규 고객 또는 미지정 고객만 */}
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
                      {/* PKG 칩 + 포인트 잔액 — 예약자 데이터만 (reserverPkgSummary / _reserverPoint) */}
                      {(reserverPkgSummary.length > 0 || _reserverPoint > 0) && <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                        {_reserverPoint > 0 && (
                          <span style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:10,fontWeight:700,border:"1px solid #B2EBF2",whiteSpace:"nowrap"}}>
                            <span style={{padding:"2px 6px",background:"#fff",color:T.gray700}}>포인트</span>
                            <span style={{padding:"2px 6px",background:"#E0F7FA",color:"#006064",fontWeight:800}}>{_reserverPoint.toLocaleString()}P</span>
                          </span>
                        )}
                        {reserverPkgSummary.map((pkg,i) => {
                          const c = pkg.type==="prepaid"
                            ? { val:"#fffde7", txt:"#7a5a00", bdr:"#f3d77a" }
                            : pkg.type==="annual"
                            ? { val:"#f3e8f7", txt:"#6a1b9a", bdr:"#d8b6e0" }
                            : { val:T.primaryLt, txt:T.primaryDk, bdr:"#d6cefa" };
                          return (
                            <span key={i} style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:10,fontWeight:700,border:`1px solid ${c.bdr}`,whiteSpace:"nowrap"}}>
                              <span style={{padding:"2px 6px",background:"#fff",color:T.gray700}}>{pkg.label}</span>
                              {pkg.value && <span style={{padding:"2px 6px",background:c.val,color:c.txt,fontWeight:800}}>{pkg.value}</span>}
                            </span>
                          );
                        })}
                      </div>}
                    </div>
                  </div>
                  {/* ── 액션바 — 카드 아래 분리. _hasVisitor일 때는 방문자 카드 다음으로 이동 (통합 액션바) ── */}
                  {!_hasVisitor && <div style={{display:"flex",borderTop:"1px solid #e2e5ea",background:"rgba(255,255,255,.5)"}}>
                    {editingCust ? (
                      <>
                        <button onClick={()=>{
                            _restoreCustSnapshot();
                            setEditingCust(false); setCustSearch(""); setShowCustDropdown(false);
                          }}
                          style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:"#666",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          취소
                        </button>
                        <button onClick={()=>{
                            setCustSnapshot(null);
                            setEditingCust(false); setCustSearch(""); setShowCustDropdown(false);
                            setTimeout(()=>commitBtnRef.current?.click(), 0);
                          }}
                          style={{flex:1,padding:"8px 0",border:"none",background:"transparent",color:T.primary,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                          <I name="check" size={11} style={{marginRight:3}}/>저장
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={()=>{
                            _captureCustSnapshot();
                            setEditingCust(true);
                            setCustSearch("");
                            setShowCustDropdown(false);
                          }}
                          style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:"#666",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                          변경
                        </button>
                        {!f.custId && f.custPhone && <button onClick={()=>{
                            const phone = (f.custPhone||"").replace(/[^0-9]/g,"");
                            const name = (f.custName||"").trim();
                            if (!phone && !name) return;
                            let cand = (data?.customers||[]).find(c => (c.phone||"").replace(/-/g,"") === phone);
                            if (!cand && phone.length>=4) {
                              const last4 = phone.slice(-4);
                              cand = (data?.customers||[]).find(c => name && c.name===name && (c.phone||"").endsWith(last4));
                            }
                            if (cand) {
                              if (confirm(`기존 고객 매칭됨:\n\n${cand.name}${cand.custNum?` #${cand.custNum}`:''}  ${cand.phone}\n\n이 고객으로 연결할까요?`)) {
                                selectCust(cand); setEditingCust(false);
                                return;
                              }
                            }
                            setEditingCust(true);
                            const q = phone || name;
                            if (q.length >= 2) { setCustSearch(q); setShowCustDropdown(true); }
                          }}
                          title="이 전화번호로 기존 고객 찾기"
                          style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:T.success,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          <I name="search" size={11} style={{marginRight:3}}/>기존고객
                        </button>}
                        {(f.custId || (_hasVisitor && f.visitorCustId)) && <button onClick={()=>{
                            // 활성 카드(예약자/방문자) 기준으로 고객정보 보기
                            const _activeId = (_hasVisitor && f.primarySubject==='visitor' && f.visitorCustId) ? f.visitorCustId : f.custId;
                            if (!_activeId) return;
                            if (_activeId === f.custId) {
                              setCustPopupOpen(true);  // 예약자: 빠른 보기 팝업
                            } else if (setPage && setPendingOpenCust) {
                              setPendingOpenCust(_activeId);  // 방문자: customers 페이지 이동 (팝업 정보 없음)
                              setPage("customers");
                              onClose();
                            }
                          }}
                          title={(_hasVisitor && f.primarySubject==='visitor') ? `방문자 ${f.visitorName} 고객정보` : "예약자 고객정보 빠른 보기"}
                          style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:T.primary,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                          고객정보 ↗ {_hasVisitor && (<span style={{fontSize:9,opacity:0.7,marginLeft:2}}>({f.primarySubject==='visitor'?'방문자':'예약자'})</span>)}
                        </button>}
                        {(f.custPhone || (_hasVisitor && f.visitorPhone)) && <button onClick={()=>setShowSmsModal(true)}
                          title={(_hasVisitor && f.primarySubject==='visitor') ? `방문자 ${f.visitorName}에게 문자` : "예약자에게 문자 발송"}
                          style={{flex:1,padding:"8px 0",border:"none",background:"transparent",color:"#7C3AED",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          <I name="msgSq" size={11} style={{marginRight:3}}/>메시지 {_hasVisitor && (<span style={{fontSize:9,opacity:0.7,marginLeft:2}}>({f.primarySubject==='visitor'?'방문자':'예약자'})</span>)}
                        </button>}
                      </>
                    )}
                  </div>}
                </div>
              ) : (
                /* 고객 미선택: 검색바 */
                <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                  <span style={{position:"absolute",left:10,color:T.gray500,display:"flex",alignItems:"center",pointerEvents:"none"}}><I name="search" size={14}/></span>
                  <input className="inp inp-search" style={{flex:1,minHeight:36,borderRadius:T.radius.md,paddingLeft:32,fontSize:13}} value={custSearch} onChange={e=>{setCustSearch(e.target.value);setShowCustDropdown(true)}}
                    placeholder="고객명, 전화번호 (2글자 이상)" onFocus={()=>setShowCustDropdown(true)}/>
                </div>
              )}
              {/* 검색 드롭다운 — 새 예약 모드에서만 (변경 모드는 인라인) */}
              {!editingCust && showCustDropdown && custSearch.length >= 2 && <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.bgCard,borderRadius:T.radius.md,maxHeight:200,overflow:"auto",zIndex:10,marginTop:2,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>
                {custResults.map(c=><div key={c.id} onClick={()=>{selectCust(c);setF(p=>({...p,isNewCust:false}))}}
                  style={{padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid #e0e0e020",display:"flex",gap:6,alignItems:"center",fontSize:12}}
                  onMouseOver={e=>e.currentTarget.style.background=T.gray200} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                  <span className="badge" style={{background:c.gender==="M"?T.infoLt:c.gender==="F"?T.femaleLt:T.gray200,color:c.gender==="M"?T.primary:c.gender==="F"?T.female:T.gray500,fontSize:10}}>{c.gender==="M"?"남":c.gender==="F"?"여":"-"}</span>
                  {c.custNum && <span style={{fontSize:11,color:T.text,background:T.gray100,padding:"1px 5px",borderRadius:3,fontWeight:700}}>{c.custNum}</span>}
                  <span style={{fontWeight:600}}>{c.name}</span>
                  <span style={{color:T.textSub}}>{c.phone}</span>
                </div>)}
                {custResults.length===0 && <div style={{padding:"8px 12px",fontSize:12,color:T.gray500,textAlign:"center"}}>검색결과 없음</div>}
                <div onClick={()=>{_captureCustSnapshot();const q=custSearch.trim();const isEmail=q.includes("@");setF(p=>({...p,isNewCust:true,custId:null,custName:isEmail?"":q.replace(/[0-9\-@.]/g,"").trim(),custPhone:q.replace(/[^0-9]/g,""),custEmail:isEmail?q:""}));setCustSearch("");setShowCustDropdown(false);setEditingCust(true)}}
                  style={{padding:"8px 12px",cursor:"pointer",display:"flex",gap:6,alignItems:"center",fontSize:12,background:"#d0d0d020",borderTop:"1px solid "+T.border,color:T.danger,fontWeight:700}}
                  onMouseOver={e=>e.currentTarget.style.background="#d0d0d040"} onMouseOut={e=>e.currentTarget.style.background="#d0d0d020"}>
                  <I name="plus" size={13}/> 신규등록 {custSearch && <span style={{fontWeight:400,color:T.textSub}}>"{custSearch}"</span>}
                </div>
              </div>}
            {/* 🆕 방문자 카드 — 예약자 카드와 동일 형태 (아바타·이름·#번호·전화·음역·포인트·보유권). 클릭 시 main 활성화 */}
            {_hasVisitor && f.visitorName && (() => {
              const _vIsActive = f.primarySubject === 'visitor';
              // visitor customer info — visitorCustInfo state (fetch 결과) 우선, fallback으로 data.customers
              const _vCust = visitorCustInfo || (data?.customers||[]).find(c => c.id === f.visitorCustId);
              const _vGender = _vCust?.gender || '';
              const _vNum = _vCust?.custNum || _vCust?.cust_num || '';
              const _vKor = (_vCust?.nameKor && /[가-힣]/.test(_vCust.nameKor)) ? _vCust.nameKor : '';
              return (
                <div onClick={(e)=>{ if(!_vIsActive){ e.stopPropagation(); set('primarySubject','visitor'); } }}
                  style={{
                    background: _vIsActive ? "linear-gradient(135deg,#FFF3E0,#FFE0B2)" : "transparent",
                    // 🆕 외곽 wrapper 내부 — 평평 + 좌측 컬러바. 비활성은 opacity로 흐리게
                    borderRadius: 0,
                    border: "none",
                    overflow:"hidden",
                    cursor:"pointer",
                    transition:"background .15s, box-shadow .15s, opacity .15s",
                    boxShadow: _vIsActive ? "inset 4px 0 0 0 #E65100" : "none",
                    position: "relative",
                    opacity: _vIsActive ? 1 : 0.55,
                  }}>
                  {/* 방문자 라벨 */}
                  <div style={{padding:"6px 12px 0",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:10,fontWeight:800,color:_vIsActive?"#E65100":"#999",letterSpacing:0.3,whiteSpace:"nowrap"}}>👤 방문자</span>
                    {_vIsActive && (
                      <span style={{fontSize:9,padding:"1px 6px",background:"#E65100",color:"#fff",borderRadius:3,fontWeight:800}}>🎯 매출 기준</span>
                    )}
                    {!f.visitorCustId && <span style={{fontSize:9,padding:"1px 5px",background:"#fff3e0",color:"#E65100",border:"1px solid #FFB74D",borderRadius:3,fontWeight:700}}>미등록</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 12px"}}>
                    {/* 아바타 */}
                    <div style={{width:24,height:24,borderRadius:"50%",border:"1.5px solid "+(_vGender==="F"?"#e91e6320":_vGender==="M"?"#3f51b520":"#0000"),fontFamily:"inherit",fontSize:11,fontWeight:800,flexShrink:0,marginTop:2,
                      background:_vGender==="F"?"linear-gradient(135deg,#fce4ec,#f8bbd0)":_vGender==="M"?"linear-gradient(135deg,#e8eaf6,#c5cae9)":"linear-gradient(135deg,#f5f5f5,#e0e0e0)",
                      color:_vGender==="F"?"#c2185b":_vGender==="M"?"#283593":"#999",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>
                      {_vGender==="F"?"여":_vGender==="M"?"남":"?"}
                    </div>
                    {/* 정보 */}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        {editingCust ? (
                          <input value={f.visitorName||""} onChange={e=>set("visitorName",e.target.value)} placeholder="방문자명"
                            onClick={e=>e.stopPropagation()}
                            style={{fontSize:14,fontWeight:700,color:"#1a1a2e",padding:"3px 8px",border:"1px solid #e0e0e0",borderRadius:6,fontFamily:"inherit",outline:"none",background:"#fff",minWidth:120}}/>
                        ) : (
                          <CopySpan text={f.visitorName} style={{fontSize:14,fontWeight:700,color:"#1a1a2e",whiteSpace:"nowrap"}}>{f.visitorName}</CopySpan>
                        )}
                        {_vKor && <span style={{fontSize:13,color:T.primaryDk||"#5B21B6",fontWeight:700,whiteSpace:"nowrap"}}>{_vKor}</span>}
                        {_vNum && <CopySpan text={_vNum} style={{fontSize:13,color:"#999",fontFamily:"monospace",whiteSpace:"nowrap"}}>#{_vNum}</CopySpan>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:3,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,color:"#aaa"}}>📞</span>
                        {editingCust ? (
                          <input type="tel" value={f.visitorPhone||""} onChange={e=>set("visitorPhone",e.target.value.replace(/[^0-9-]/g,""))} placeholder="연락처"
                            onClick={e=>e.stopPropagation()}
                            style={{fontSize:13,padding:"3px 8px",border:"1px solid #e0e0e0",borderRadius:6,fontFamily:"inherit",outline:"none",background:"#fff",color:T.primary,fontWeight:500,minWidth:120}}/>
                        ) : (
                          <CopySpan text={f.visitorPhone} style={{fontSize:13,color:T.primary,fontWeight:500,whiteSpace:"nowrap"}}>{f.visitorPhone||"연락처 없음"}</CopySpan>
                        )}
                      </div>
                      {/* 방문자 PKG 칩 + 포인트 — visitor 데이터만 */}
                      {(visitorPkgSummary.length > 0 || _visitorPoint > 0) && <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                        {_visitorPoint > 0 && (
                          <span style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:10,fontWeight:700,border:"1px solid #B2EBF2",whiteSpace:"nowrap"}}>
                            <span style={{padding:"2px 6px",background:"#fff",color:T.gray700}}>포인트</span>
                            <span style={{padding:"2px 6px",background:"#E0F7FA",color:"#006064",fontWeight:800}}>{_visitorPoint.toLocaleString()}P</span>
                          </span>
                        )}
                        {visitorPkgSummary.map((pkg,i) => {
                          const c = pkg.type==="prepaid"
                            ? { val:"#fffde7", txt:"#7a5a00", bdr:"#f3d77a" }
                            : pkg.type==="annual"
                            ? { val:"#f3e8f7", txt:"#6a1b9a", bdr:"#d8b6e0" }
                            : { val:T.primaryLt, txt:T.primaryDk, bdr:"#d6cefa" };
                          return (
                            <span key={i} style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:10,fontWeight:700,border:`1px solid ${c.bdr}`,whiteSpace:"nowrap"}}>
                              <span style={{padding:"2px 6px",background:"#fff",color:T.gray700}}>{pkg.label}</span>
                              {pkg.value && <span style={{padding:"2px 6px",background:c.val,color:c.txt,fontWeight:800}}>{pkg.value}</span>}
                            </span>
                          );
                        })}
                      </div>}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* 🆕 통합 액션바 — wrapper 내부 마지막 섹션. 단일 카드 액션바와 동일한 borderTop + background */}
            {_hasVisitor && f.custName && (
              <div style={{display:"flex",borderTop:"1px solid #e2e5ea",background:"rgba(255,255,255,.5)"}}>
                {editingCust ? (
                  <>
                    <button onClick={()=>{
                        _restoreCustSnapshot();
                        setEditingCust(false); setCustSearch(""); setShowCustDropdown(false);
                      }}
                      style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:"#666",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      취소
                    </button>
                    <button onClick={()=>{
                        _persistCustEdits();
                        setCustSnapshot(null);
                        setEditingCust(false); setCustSearch(""); setShowCustDropdown(false);
                        setTimeout(()=>commitBtnRef.current?.click(), 0);
                      }}
                      style={{flex:1,padding:"8px 0",border:"none",background:"transparent",color:T.primary,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                      <I name="check" size={11} style={{marginRight:3}}/>저장
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={()=>{
                        _captureCustSnapshot();
                        setEditingCust(true);
                        setCustSearch("");
                        setShowCustDropdown(false);
                      }}
                      style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:"#666",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      변경
                    </button>
                    {(f.custId || f.visitorCustId) && <button onClick={()=>{
                        const _activeId = (f.primarySubject==='visitor' && f.visitorCustId) ? f.visitorCustId : f.custId;
                        if (!_activeId) return;
                        if (_activeId === f.custId) {
                          setCustPopupOpen(true);
                        } else if (setPage && setPendingOpenCust) {
                          setPendingOpenCust(_activeId);
                          setPage("customers");
                          onClose();
                        }
                      }}
                      title={(f.primarySubject==='visitor') ? `방문자 ${f.visitorName} 고객정보` : "예약자 고객정보 빠른 보기"}
                      style={{flex:1,padding:"8px 0",border:"none",borderRight:"1px solid #e2e5ea",background:"transparent",color:T.primary,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      고객정보 ↗ <span style={{fontSize:9,opacity:0.7,marginLeft:2}}>({f.primarySubject==='visitor'?'방문자':'예약자'})</span>
                    </button>}
                    {(f.custPhone || f.visitorPhone) && <button onClick={()=>setShowSmsModal(true)}
                      title={(f.primarySubject==='visitor') ? `방문자 ${f.visitorName}에게 문자` : "예약자에게 문자 발송"}
                      style={{flex:1,padding:"8px 0",border:"none",background:"transparent",color:"#7C3AED",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      <I name="msgSq" size={11} style={{marginRight:3}}/>메시지 <span style={{fontSize:9,opacity:0.7,marginLeft:2}}>({f.primarySubject==='visitor'?'방문자':'예약자'})</span>
                    </button>}
                  </>
                )}
              </div>
            )}
            </div>
            {/* AI 분석 — 시술/특이/성격 요약 (고객정보 바로 아래). 서버가 정제 생성 */}
            {_custSummary && <div style={{marginTop:6,marginBottom:8,padding:"8px 11px",background:"#EEF2FF",borderRadius:T.radius.md,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <div style={{fontSize:10,fontWeight:800,color:"#4338ca",display:"flex",alignItems:"center",gap:4,marginBottom:3}}><I name="sparkles" size={11}/>AI 분석</div>
              <div style={{fontSize:12.5,color:"#3730a3",fontWeight:600,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{_custSummary}</div>
            </div>}
            {/* 📋 작성 차트 내용 — "차트 작성완료" 버튼 클릭 시 펼침 (PDF 없음) */}
            {chartExpand && chartInfo?.status === "signed" && chartInfo.consent && (() => {
              const c = chartInfo.consent;
              const survey = c?.form_data?.survey || null;
              const rows = survey ? Object.entries(survey)
                .map(([k,v]) => [CHART_LABELS[k]||k, _fmtChartVal(v)])
                .filter(([,val]) => val !== "") : [];
              return (
                <div style={{marginTop:6,marginBottom:8,padding:"10px 12px",background:"#ECFDF5",borderRadius:T.radius.md,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:rows.length?6:0,flexWrap:"wrap"}}>
                    <I name="fileText" size={12} style={{color:"#059669"}}/>
                    <span style={{fontSize:11,fontWeight:800,color:"#047857"}}>{c.template_name||"작성 차트"}</span>
                    {c.signed_at && <span style={{fontSize:10,color:"#047857",marginLeft:"auto"}}>{(c.signed_at||"").replace("T"," ").slice(0,16)}{c.signer_name?" · "+c.signer_name:""}</span>}
                  </div>
                  {rows.length > 0 ? (
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {rows.map(([label,val],i)=>(
                        <div key={i} style={{display:"flex",gap:8,fontSize:12,lineHeight:1.5}}>
                          <span style={{minWidth:84,flexShrink:0,color:"#047857",fontWeight:700}}>{label}</span>
                          <span style={{color:T.text,wordBreak:"break-word"}}>{val}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{fontSize:12,color:T.textMuted}}>작성 항목이 없습니다.</div>}
                </div>
              );
            })()}
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
                  {branchStaff.map(st => {
                    const br = (data.branches||[]).find(b=>b.id===branchId);
                    const brName = br?.short||br?.name||"";
                    const stName = st.dn ? st.dn.replace(brName,"").trim() : (st.name || st.id);
                    const label = stName ? `${brName}-${stName}` : brName;
                    const defRoom = branchRooms[0]?.id || "";
                    return <option key={st.id} value={`${defRoom}|${st.id}`}>{label}</option>;
                  })}
                </select>
              </div>
            </div>
            {/* 시술 상품 선택 */}
            {(() => {
              const hasGender = !!f.custGender;
              // 회원가 자격: 바프권 등 제외 상품 제외 + 연간권 무조건 자격 + 선불권(다담권 등)은 잔액 ≥ 시술 회원가
              const _isEnergyOrProd = p => { const n=(p.service_name||"").toLowerCase(); return n.includes("에너지")||n.includes("제품")||n.includes("구매권"); };
              const _memExcludedNames = (() => {
                try {
                  const raw = (data?.businesses||[])[0]?.settings;
                  const st = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                  const ids = st.member_price_rules?.excludeServiceIds || [];
                  return new Set((data?.services||[]).filter(s => ids.includes(s.id)).map(s => s.name));
                } catch { return new Set(); }
              })();
              const _isAnnualPkg = p => (p.service_name||"").match(/연간|할인권|회원권/i);
              const _pkgBal = p => {
                const m = (p.note||"").match(/잔액:([0-9,]+)/);
                if (m) return Number(m[1].replace(/,/g,'')) || 0;
                return Math.max(0, (p.total_count||0) - (p.used_count||0));
              };
              // 유효기간 체크 (note의 "유효:YYYY-MM-DD" 패턴) — 만료된 보유권은 회원가 자격 없음
              const _pkgStillValid = (p) => {
                const exp = ((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
                if (!exp) return true; // 유효기간 미설정 = 사용 전 = 유효
                return exp >= new Date().toISOString().slice(0,10);
              };
              const _grantsMember = (p) => {
                if (!_pkgStillValid(p)) return false; // 만료 보유권은 회원가 자격 없음 (id_g0d2q6d4p8 fix)
                if (_isEnergyOrProd(p)) return false;
                if (_memExcludedNames.has(p.service_name)) return false;
                if (_isAnnualPkg(p)) return true;
                return _pkgBal(p) > 0;
              };
              const isMember = (custPkgsInfo||[]).some(_grantsMember);
              const _memberPrice = (svc, g) => {
                if (!g) return svc.priceF;
                const ok = (custPkgsInfo||[]).some(p => {
                  if (!_grantsMember(p)) return false;
                  if (_isAnnualPkg(p)) return true;
                  const mp = g==="M" ? svc.memberPriceM : svc.memberPriceF;
                  if (!mp) return false;
                  return _pkgBal(p) >= mp;
                });
                if (!ok) return g==="M"?svc.priceM:svc.priceF;
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
                    if(isMoneyPkg(p)) return false;
                    if(n.includes("연간")||n.includes("할인권")||n.includes("회원권")) return false;
                    const exp=((p.note||"").match(/유효:\s*(\d{4}-\d{2}-\d{2})/)||[])[1];
                    if(exp && exp < new Date().toISOString().slice(0,10)) return false; // 만료 보유권 제외 (id_zl2g6fglfv)
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
                    <div style={{padding:"4px 10px",fontSize:11,fontWeight:700,color:T.textMuted,display:"flex",alignItems:"center",gap:5}}><I name="pkg" size={12}/>보유 패키지</div>
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

            {/* 🆕 태그 아코디언 — 예약경로 + 예약태그 통합. 펼치면 두 섹션 구분 박스로 표시 */}
            {!isSchedule && <div className="tags-acc acc-tag">
              <div className={"tags-acc-hdr"+(tagsOpen?" open":"")} onClick={()=>setTagsOpen(p=>!p)}>
                <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.gray700,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  태그
                  {/* 예약경로 칩 */}
                  {f.source && (() => {
                    const srcItem = (data?.resSources||[]).find(s=>s.name===f.source);
                    const bg = srcItem?.color || T.primary;
                    const hex = bg.replace("#",""); const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
                    const txt = (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard;
                    return <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:txt,background:bg,borderRadius:T.radius.sm,padding:"1px 7px"}}>{f.source}</span>;
                  })()}
                  {/* 예약태그 칩들 */}
                  {(f.selectedTags||[]).map(tid => {
                    const tag = (data?.serviceTags||[]).find(t=>t.id===tid);
                    if (!tag) return null;
                    const bg = tag.color || T.primary;
                    const txt = (() => { const h=bg.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)/255>0.55?T.text:T.bgCard; })();
                    return <span key={tid} style={{fontSize:T.fs.xxs,fontWeight:T.fw.bold,background:bg,color:txt,borderRadius:0,padding:"1px 8px"}}>{tag.name}</span>;
                  })}
                  {/* 대화보기 버튼 */}
                  {(() => {
                    let ch=f.chatChannel||item?.chatChannel, acc=f.chatAccountId||item?.chatAccountId, uid=f.chatUserId||item?.chatUserId;
                    if(!ch || !uid){
                      const _cust=(data?.customers||[]).find(c=>c.id===f.custId);
                      let sns=_cust?.snsAccounts||_cust?.sns_accounts||[];
                      if(typeof sns==="string"){try{sns=JSON.parse(sns);}catch{sns=[];}}
                      const first=Array.isArray(sns)&&sns[0];
                      if(first){ch=first.channel; acc=first.account_id; uid=first.user_id;}
                    }
                    if(!ch || !uid || !setPendingChat) return null;
                    return <button onClick={async(e)=>{
                      e.stopPropagation();
                      if(!f.chatChannel && !item?.chatChannel && item?.id){
                        try {
                          const rows=await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${item.id}&select=chat_channel,chat_account_id,chat_user_id`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY},cache:"no-store"}).then(r=>r.json());
                          if(rows?.[0]?.chat_channel){ch=rows[0].chat_channel;acc=rows[0].chat_account_id;uid=rows[0].chat_user_id;}
                        } catch {}
                      }
                      setPendingChat({user_id:uid,channel:ch,account_id:acc});
                      setPage("messages"); onClose();
                    }} style={{fontSize:11,fontWeight:700,color:"#5B63B5",background:"#5B63B510",border:"1px solid #5B63B530",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}>
                      <I name="msgSq" size={11}/>대화보기
                    </button>;
                  })()}
                </span>
                <span className={"tags-acc-chev"+(tagsOpen?" open":"")}>▾</span>
              </div>
              <div className={"tags-acc-body"+(tagsOpen?" open":"")}>
                {/* ┌─ 예약경로 구분 박스 ─┐ */}
                <div style={{padding:"8px 12px",margin:"8px 12px 6px",background:"#fafbfd",border:"1px solid #eceff3",borderRadius:8}}>
                  <div style={{fontSize:11,color:T.gray500,fontWeight:700,marginBottom:6,letterSpacing:0.3}}>예약경로</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
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
                {/* ┌─ 예약태그 구분 박스 ─┐ */}
                <div style={{padding:"8px 12px",margin:"0 12px 10px",background:"#fafbfd",border:"1px solid #eceff3",borderRadius:8}}>
                  <div style={{fontSize:11,color:T.gray500,fontWeight:700,marginBottom:6,letterSpacing:0.3}}>예약태그</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
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
                  {(f.selectedTags||[]).length > 0 && tagDurTotal>0 && <div style={{marginTop:6,fontSize:T.fs.sm,color:T.primary,fontWeight:T.fw.bold,textAlign:"right"}}>소요 합산 {tagDurTotal}분</div>}
                </div>
              </div>
            </div>}

            {/* 외부 선결제(예약금/선결제) — 블리스 톤으로 통일 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",marginTop:4,flexWrap:"wrap",gap:6,background:"linear-gradient(135deg,#f8f9fb,#f0f2f5)",borderRadius:8,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <span style={{fontSize:T.fs.sm,color:T.gray700,display:"inline-flex",alignItems:"center",gap:4,whiteSpace:"nowrap",fontWeight:700}}>
                <I name="wallet" size={12}/>선결제
              </span>
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
                  const _needPlatform = (f.externalPrepaid || 0) > 0 && !(f.externalPlatform || "").trim();
                  return <select value={f.externalPlatform||""} onChange={e=>set("externalPlatform", e.target.value)}
                    style={{padding:"4px 6px",fontSize:T.fs.sm,border:`${_needPlatform?"2px":"1px"} solid ${_needPlatform?"#dc2626":"#d1d5db"}`,borderRadius:6,background:_needPlatform?"#fee2e2":"#fff",color:_needPlatform?"#dc2626":T.text,fontFamily:"inherit",fontWeight:_needPlatform?800:500}}>
                    <option value="">{_needPlatform?"⚠ 플랫폼 선택!":"플랫폼"}</option>
                    {platforms.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>;
                })()}
                <input type="text" inputMode="numeric" value={f.externalPrepaid ? Number(f.externalPrepaid).toLocaleString() : ""} placeholder="0"
                  onChange={e=>{const v=Number(String(e.target.value).replace(/[^0-9]/g,""))||0; set("externalPrepaid", Math.max(0, v));}}
                  style={{width:110,padding:"4px 8px",fontSize:T.fs.sm,textAlign:"right",fontWeight:700,color:T.primary,border:"1px solid #d1d5db",borderRadius:6,background:"#fff",fontFamily:"inherit"}}/>
                <span style={{fontSize:T.fs.sm,color:T.gray700,fontWeight:700}}>원</span>
                {/* 💳 결제 링크 발송 / 환불 — 매장 → 고객 (토스페이먼츠) */}
                {item?.id && !isReadOnly && !isSchedule && (item.depositPaidAt ? (
                  <button type="button" onClick={refundDeposit} disabled={refunding} title={`예약금 결제완료 ${Number(item.depositAmount||0).toLocaleString()}원`}
                    style={{padding:"5px 11px",fontSize:11,fontWeight:700,background:refunding?"#fca5a5":"#dc2626",color:"#fff",border:"none",borderRadius:6,cursor:refunding?"wait":"pointer",fontFamily:"inherit"}}>
                    {refunding?"환불 중…":"결제완료 · 환불"}
                  </button>
                ) : (
                  <button type="button" onClick={chargeDeposit} disabled={depositCharging}
                    style={{padding:"5px 11px",fontSize:11,fontWeight:700,background:depositCharging?"#a78bfa":"#7C3AED",color:"#fff",border:"none",borderRadius:6,cursor:depositCharging?"wait":"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}>
                    <I name="wallet" size={12}/>{depositCharging?"생성 중...":"결제 링크 발송"}
                  </button>
                ))}
              </div>
            </div>

            {/* 예약태그 아코디언 — 위쪽 통합 태그 아코디언으로 이동됨 */}


          </>}

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
                      // value="N/a" 또는 빈값 필터 제외
                      const valid = items.filter(it => {
                        const v = String(it.value||'').trim();
                        if (!v) return false;
                        if (/^n\/?a$/i.test(v)) return false; // "N/a" "NA"
                        return true;
                      });
                      return valid.map((it,idx)=>{
                        if (it.label==="시술메뉴") return <NRow key={idx} label="시술메뉴" value={it.value} />;
                        // 라벨이 너무 길면 (12자 초과) 별도 단락으로: label 위·value 아래 (안내문구형 라벨)
                        const labelLen = String(it.label||'').length;
                        if (labelLen > 12) {
                          return <div key={idx} style={{padding:"4px 0",borderBottom:"1px solid #E8F5E9"}}>
                            <div style={{fontSize:11,color:T.textMuted,fontWeight:500,lineHeight:1.5,wordBreak:"break-word",marginBottom:3}}>{it.label}</div>
                            <div style={{fontSize:T.fs.sm,fontWeight:T.fw.medium,color:T.successDk,lineHeight:1.45,wordBreak:"break-word",paddingLeft:8}}>↳ {it.value}</div>
                          </div>;
                        }
                        return <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 0",borderBottom:"1px solid #E8F5E9",minWidth:0}}>
                          <span style={{fontSize:11,color:T.textMuted,fontWeight:500,minWidth:48,flexShrink:0,paddingTop:2}}>{it.label}</span>
                          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.medium,color:T.successDk,lineHeight:1.45,wordBreak:"break-word",flex:1,minWidth:0}}>{it.value}</span>
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
            {/* 변경 이력 — prev_reservation_id 체인 (네이버에서 변경한 이력) */}
            {changeChain.length > 0 && (
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #C8E6C9"}}>
                <div style={{fontSize:T.fs.xs,fontWeight:T.fw.bolder,color:T.successDk,marginBottom:5,display:"flex",alignItems:"center",gap:5}}>
                  <I name="clock" size={11}/>네이버 변경 이력 ({changeChain.length}건)
                </div>
                {changeChain.map((rec, i) => {
                  const stMap = { naver_changed:"변경됨", cancelled:"취소", naver_cancelled:"취소", reserved:"예약", confirmed:"확정", completed:"완료", no_show:"노쇼" };
                  const stLabel = stMap[rec.status] || rec.status;
                  return (
                    <div key={rec.id || i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderTop:i>0?"1px dashed #C8E6C9":"none",fontSize:11,color:"#33691E"}}>
                      <span style={{fontWeight:700,minWidth:90}}>{rec.date||""} {rec.time||""}</span>
                      <span style={{padding:"1px 6px",borderRadius:8,background:"#C8E6C9",color:T.successDk,fontSize:10,fontWeight:700}}>{stLabel}</span>
                      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:10,color:"#558B2F"}}>
                        {(rec.memo || "").split("\n")[0].slice(0, 50)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>}

          {/* ═══ 수동 예약 등록정보 + 일정변경 로그 (변경 내역) — 직원 메모 바로 위 ═══
             네이버 예약도 schedule_log는 표시 (등록 시각만 네이버 예약정보 박스와 중복되니 비-네이버에서만) */}
          {item?.id && !isSchedule && (()=>{
            const c = (!isNaverItem && item?.createdAt) ? new Date(item.createdAt) : null;
            const regFmt = c && !isNaN(c)
              ? `${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")} ${String(c.getHours()).padStart(2,"0")}:${String(c.getMinutes()).padStart(2,"0")}`
              : "";
            const _schLogRaw = item?.scheduleLog;
            const schLog = (Array.isArray(_schLogRaw) ? _schLogRaw.join("\n") : (_schLogRaw || "")).trim();
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
                <I name="sparkles" size={12} style={{marginRight:4}}/>{aiAnalyzing?"분석중":"AI"}
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
                        style={{padding:"10px 14px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"none",color:T.danger,background:T.dangerLt}}
                        title="당일 등록분만 취소 가능">
                        <I name="x" size={12}/> 매출취소
                      </button>
                    ) : (
                      <span style={{padding:"10px 10px",fontSize:11,color:T.textMuted,fontWeight:600,whiteSpace:"nowrap"}}>수정은 매출관리에서</span>
                    )}
                  </>
                ) : (
                  <button onClick={()=>{ if (betaGroupMode) { alert("베타 모드: 매출 등록은 라이브 타임라인에서만 가능합니다."); return; } setShowSaleForm(true); }}
                    disabled={betaGroupMode}
                    style={{padding:"10px 18px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:betaGroupMode?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"none",color:"#fff",background:betaGroupMode?"#d1d5db":`linear-gradient(135deg, ${T.primary}, ${T.primaryDk||T.primary})`,boxShadow:betaGroupMode?"none":"0 2px 6px rgba(91,33,182,.18)",opacity:betaGroupMode?.55:1}}>
                    <I name="wallet" size={12}/> 매출등록{betaGroupMode?" (베타 비활성)":""}
                  </button>
                )
              )}
              {/* 삭제 — 네이버 예약은 버튼 숨김. 단, 네이버 취소건(naver_cancelled)은 정리 목적으로 삭제 허용. 내부일정/수동/AI는 확인창 없이 바로 삭제 */}
              {(() => {
                if (!item?.id) return null;
                const resId = String(item?.reservationId || '');
                const srcStr = String(item?.source || '').toLowerCase();
                // 네이버 예약 판정: reservationId 있음 + ai_/manual_/외부플랫폼 접두사 아님 + chatChannel 없음 + source 외부플랫폼 아님
                const isNaverRes = !!item?.reservationId
                  && !/^(manual_|ai_|trazy_|creatrip_|seoulbeauty_|cusmetic_)/.test(resId)
                  && !item?.chatChannel
                  && !["trazy","creatrip","seoulbeauty","cusmetic","서울뷰티","크리에이트립"].some(p => srcStr.includes(p));
                // 네이버 활성 예약은 삭제 차단. 단, 네이버에서 이미 취소된 건은 삭제 허용 (직원이 정리 가능)
                if (isNaverRes && f.status !== "naver_cancelled") return null;
                return <button onClick={()=>onDeleteRequest?.(item)}
                  style={{padding:"10px 16px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+T.danger,color:T.danger,background:T.dangerLt}}>
                  <I name="trash" size={12}/> 삭제
                </button>;
              })()}
              <button
                ref={commitBtnRef}
                disabled={!isSchedule && f.type==="reservation" && !f.custName?.trim()}
                style={{marginLeft:"auto",padding:"10px 22px",borderRadius:T.radius.md,fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,lineHeight:1,transition:"all .15s",border:"2px solid "+(isSchedule?T.orange:T.primary),color:"#fff",background:isSchedule?T.orange:T.primary,boxShadow:isSchedule?"0 4px 14px rgba(225,112,85,.35)":"0 4px 14px rgba(124,124,200,.35)"}}
                onClick={async ()=>{
                // 외부선결제 금액 입력 시 플랫폼 필수
                if ((f.externalPrepaid || 0) > 0 && !(f.externalPlatform || "").trim()) {
                  alert("선결제 금액을 입력하셨는데 플랫폼이 선택되지 않았습니다.\n\n네이버/트레이지/서울뷰티/크리에이트립/입금 중에서 선택해주세요.");
                  return;
                }
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
                // 3단 분기 (UI_0370~0391 당일취소 알림톡 승인 후, v3.7.806):
                //   ① 사전취소 (예약일 ≠ 오늘) → rsv_cancel
                //   ② 당일취소 + 당일예약 + 생성 후 1시간 이내 (grace) → rsv_cancel (실수 보호)
                //   ③ 그 외 당일취소 → rsv_cancel_today ★ (당일취소 안내 본문)
                if(f.status==="cancelled" && item?.status!=="cancelled" && f.custPhone && !isSchedule){
                  const branch = (data?.branches||[]).find(b=>b.id===f.bid);
                  const _today = todayStr();
                  const _isSameDay = f.date === _today;
                  const _isGrace = _isSameDay && judgePenaltyType(f.date, f.time, item?.createdAt || item?.created_at, new Date()) === 'grace';
                  const _cancelKey = (_isSameDay && !_isGrace) ? "rsv_cancel_today" : "rsv_cancel";
                  if (!betaGroupMode) queueAlimtalk(f.bid, _cancelKey, f.custPhone, {
                    "#{사용자명}":branch?.name||"", "#{날짜}":f.date||"", "#{시간}":f.time||"",
                    "#{대표전화번호}":branch?.phone||""
                  });
                }
                // 카카오 채널 예약 — 직원이 확정(request → reserved/confirmed) 시 rsv_confirm 알림톡
                // 카카오 예약은 서버가 status='request'로 INSERT만 함 → 직원 확정 시점에 큐 적재
                {
                  const _rid = String(f.reservationId || item?.reservationId || "");
                  if(_rid.startsWith("kakao_") && item?.status==="request"
                     && (f.status==="reserved" || f.status==="confirmed")
                     && f.custPhone && !isSchedule && !betaGroupMode){
                    const branch = (data?.branches||[]).find(b=>b.id===f.bid);
                    const _rsvUrlId = f.reservationId || f.id || item?.id || "";
                    queueAlimtalk(f.bid, "rsv_confirm", f.custPhone, {
                      "#{사용자명}":branch?.name||"", "#{날짜}":f.date||"", "#{시간}":f.time||"",
                      "#{작업자}":"", "#{작업장소}":branch?.name||"",
                      "#{대표전화번호}":branch?.phone||"",
                      "#{예약URL}":_rsvUrlId?"https://blissme.ai/r.html?"+encodeURIComponent(_rsvUrlId):""
                    });
                  }
                }
                // 취소·노쇼 페널티 결정 — 모달이 결정 책임 (v3.7.210 리팩토링)
                // 페널티 정의 (v3.7.289): 예약일 전일 21:00 ~ 예약시각 사이 취소만 페널티
                // 예외: 당일 예약 + 생성 후 1시간 이내 취소·변경 = grace (실수 보호)
                // (네이버 고객 직접 취소는 status='naver_cancelled'로 들어와 배너의 "취소확정" 버튼으로 별도 처리)
                const _isNewCancel = f.status==="cancelled" && item?.status!=="cancelled";
                const _isNewNoShow = f.status==="no_show" && item?.status!=="no_show";
                const _penaltyType = _isNewCancel ? judgePenaltyType(f.date, f.time, item?.createdAt || item?.created_at, new Date()) : 'normal';
                const _shouldShowPenaltyDialog = (_isNewCancel && _penaltyType === 'penalty') || _isNewNoShow;
                const _penaltyTrigger = _shouldShowPenaltyDialog && f.custId && !isSchedule && !penaltyAlreadyDone;
                if(_penaltyTrigger){
                  const _reason = _isNewNoShow ? '노쇼' : '페널티 취소';
                  const _decision = await openCancelDecision(_reason);
                  if (_decision === 'close') {
                    // 취소 행위 자체 중단 — status 원복 + 저장 X
                    setF(prev => ({...prev, status: item?.status || 'reserved'}));
                    return;
                  }
                  if (_decision === 'deduct') {
                    await runPenaltyDeduction(_reason);
                  }
                  // 'skip' → 차감 없이 진행
                }
                // ── 행동 이력 기록 (customer_behavior_log) — 비동기, 실패해도 저장 진행 ──
                if (f.custId && !isSchedule) {
                  const _bizIdForLog = (data?.businesses||[])[0]?.id;
                  const _logBase = {
                    id: 'cbl_' + uid(),
                    business_id: _bizIdForLog,
                    cust_id: f.custId,
                    reservation_id: item?.id || null,
                  };
                  const _meta = { date: f.date, time: f.time, bid: f.bid, prev_status: item?.status, new_status: f.status };
                  let _logEntries = [];
                  // 신규 예약 (item?.id 없음 = 등록)
                  if (!item?.id) {
                    _logEntries.push({ ..._logBase, type: 'book', meta: _meta });
                  }
                  // 취소
                  else if (_isNewCancel) {
                    if (_penaltyType === 'penalty') {
                      _logEntries.push({ ..._logBase, type: 'cancel_penalty', meta: _meta });
                      // customers.cancel_penalty_count++
                      try {
                        const _cur = (data?.customers||[]).find(c => c.id === f.custId)?.cancelPenaltyCount || 0;
                        await sb.update('customers', f.custId, { cancel_penalty_count: _cur + 1 }).catch(()=>{});
                      } catch {}
                    } else {
                      _logEntries.push({ ..._logBase, type: 'cancel_normal', meta: { ..._meta, grace: _penaltyType === 'grace' } });
                    }
                  }
                  // 노쇼
                  else if (_isNewNoShow) {
                    _logEntries.push({ ..._logBase, type: 'no_show', meta: _meta });
                    try {
                      const _cur = (data?.customers||[]).find(c => c.id === f.custId)?.noShowCount || 0;
                      await sb.update('customers', f.custId, { no_show_count: _cur + 1 }).catch(()=>{});
                    } catch {}
                  }
                  // 시간/지점 변경 (날짜 또는 시간 변경 감지)
                  else if (item?.id && (item.date !== f.date || item.time !== f.time || item.bid !== f.bid)) {
                    _logEntries.push({ ..._logBase, type: 'change', meta: { ..._meta, prev_date: item.date, prev_time: item.time, prev_bid: item.bid } });
                  }
                  // INSERT
                  for (const _entry of _logEntries) {
                    sb.insert('customer_behavior_log', _entry).catch(e => console.warn('[behavior_log] insert err:', e?.message));
                  }
                }
                onSave({...f, memo: memoToSave, scheduleLog: scheduleLogToSave, tsLog: newLog, selectedTags: autoTags, isSchedule, _isColTemplate: item?._isColTemplate, _templateId: item?._templateId, _initialServerSnap: initialServerSnap,
                  chatChannel: f.chatChannel||item?.chatChannel||"", chatAccountId: f.chatAccountId||item?.chatAccountId||"", chatUserId: f.chatUserId||item?.chatUserId||""});
              }}>{item?.id?"저장":"등록"}</button>
              {/* AI 예약 확정 버튼 */}
              {f.status==="request" && <Btn style={{padding:"10px 26px",background:"#9C27B0",boxShadow:"0 4px 14px rgba(156,39,176,.35)"}}
                onClick={async ()=>{
                  // data.branches에서 동적으로 계정 매핑
                  const branchAccMap={};
                  (data?.branches||[]).forEach(b=>{ if(b.naverAccountId) branchAccMap[b.id]=b.naverAccountId; });
                  let sent=false;
                  try{
                    // DB에서 chat_channel/chat_account_id/chat_user_id 직접 조회
                    const dbRows=await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${f.id||item?.id}&select=chat_channel,chat_account_id,chat_user_id,memo`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY},cache:"no-store"}).then(r=>r.json());
                    const dbRes=dbRows?.[0]||{};
                    // 대화 언어 감지 — 고객 IN 메시지 최대 5건 샘플로 영/한 판단
                    let useEnglish=false;
                    if(dbRes.chat_channel && dbRes.chat_user_id){
                      try{
                        const sampleMsgs=await fetch(`${SB_URL}/rest/v1/messages?business_id=eq.${_activeBizId}&channel=eq.${dbRes.chat_channel}&user_id=eq.${dbRes.chat_user_id}&direction=eq.in&order=created_at.asc&limit=5&select=message_text`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY},cache:"no-store"}).then(r=>r.json());
                        const text=(sampleMsgs||[]).map(m=>m.message_text||"").join(" ");
                        const ko=[...text].filter(c=>c>="\uAC00"&&c<="\uD7A3").length;
                        const en=[...text].filter(c=>/[a-zA-Z]/.test(c)).length;
                        useEnglish = en > ko*2;
                      }catch{}
                    }
                    const confirmMsg = useEnglish
                      ? `Hi ${f.custName}! Your booking on ${f.date} at ${f.time} is confirmed. Thank you! 😊`
                      : `${f.custName}님, ${f.date} ${f.time} 예약이 확정되었습니다. 감사합니다!`;
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
                            const rows=await fetch(`${SB_URL}/rest/v1/messages?business_id=eq.${_activeBizId}&channel=eq.instagram&user_name=eq.${encodeURIComponent(uname)}&select=user_id,account_id&order=created_at.desc&limit=1`,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY}}).then(r=>r.json());
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
                    // 알리고 rsv_confirm 알림톡 큐 (010 휴대폰만) — 카톡/네이버톡 직발송과 별도로 항상 발송
                    if(f.custPhone && f.custPhone.replace(/[^0-9]/g,"").startsWith("010")){
                      const branch=(data?.branches||[]).find(b=>b.id===f.bid);
                      const rsvUrlId=f.reservationId||f.id||item?.id||"";
                      queueAlimtalk(f.bid,"rsv_confirm",f.custPhone,{
                        "#{사용자명}":branch?.name||"",
                        "#{날짜}":f.date||"",
                        "#{시간}":f.time||"",
                        "#{작업자}":"",
                        "#{작업장소}":branch?.name||"",
                        "#{대표전화번호}":branch?.phone||"",
                        "#{예약URL}":rsvUrlId?"https://blissme.ai/r.html?"+encodeURIComponent(rsvUrlId):""
                      });
                    }
                  }catch(e){console.error("확정 메시지 발송 실패",e);}
                  onSave({...f,status:"reserved"});
                }}>예약 확정</Btn>}
            </>}
            {isReadOnly && <span style={{fontSize:T.fs.sm,color:T.textSub,display:"flex",alignItems:"center",gap:T.sp.xs}}><I name="eye" size={12}/> 열람 전용 (타 지점)</span>}
          </div>
        </div>

      </div>
      {/* ── 매출 히스토리 패널 토글 (닫혀있을 때 다시 열기) ── */}
      {!isSchedule && (f.custId || item?.custId || f.custName || item?.custName) && !historyOpen && (
        <div style={_isMob
          ? {display:"flex",alignItems:"center",justifyContent:"center",margin:"8px 12px"}
          : {display:"flex",alignItems:"flex-start",alignSelf:"flex-start",flexShrink:0,marginLeft:8,marginTop:12}}>
          <button onClick={e=>{e.stopPropagation();setHistoryOpen(true)}} title="매출 히스토리 열기"
            style={_isMob
              ? {display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px 14px",borderRadius:T.radius.md,background:T.bgCard,border:`1px solid ${T.border}`,cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,.05)",fontSize:13,fontWeight:700,color:T.primary,width:"100%"}
              : {display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 8px",borderRadius:T.radius.md,background:T.bgCard,border:`1px solid ${T.border}`,cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}
            onMouseOver={e=>{e.currentTarget.style.background=T.primaryLt||"#EEF2FF"}}
            onMouseOut={e=>{e.currentTarget.style.background=T.bgCard}}>
            <I name="clock" size={16} color={T.primary}/>
            <span style={_isMob
              ? {fontSize:13,color:T.primary,fontWeight:700}
              : {fontSize:10,color:T.textSub,fontWeight:700,writingMode:"vertical-rl",letterSpacing:1}}>매출 히스토리 · 고객 메모</span>
          </button>
        </div>
      )}

      {/* ── 매출 히스토리 확장 패널 ── */}
      {historyOpen && (
        <div className="modal-res" onClick={e=>e.stopPropagation()} style={{background:T.bgCard,
          borderRadius:T.radius.xl,
          border:`1px solid ${T.border}`,
          boxShadow:T.shadow.lg,
          width: _isMob ? "auto" : "100%",
          maxWidth: _isMob ? "none" : 680,
          marginLeft: _isMob ? 12 : 12,
          marginRight: _isMob ? 12 : 0,
          marginTop: _isMob ? 8 : 0,
          marginBottom: _isMob ? 12 : 0,
          display:"flex",flexDirection:"column",
          overflow:"hidden",
          maxHeight: _isMob ? "70vh" : (modalRef.current ? modalRef.current.offsetHeight : "80vh"),
          animation: _isMob ? "slideUp .3s cubic-bezier(.22,1,.36,1)" : "slideRight .3s cubic-bezier(.22,1,.36,1)",
          position:"relative"}}>
          {/* 매출 히스토리 헤더 — 예약모달 X와 동일 스타일 */}
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
            <I name="clock" size={16} color={T.primary}/>
            <span style={{fontSize:T.fs.md,fontWeight:T.fw.bolder,color:T.text}}>매출 히스토리</span>
            {(() => {
              const _cust = (data?.customers||[]).find(c => c.id === f.custId);
              if (!_cust) return null;
              if (customerGrade(_cust) !== 'caution') return null;
              const _cp = Number(_cust.cancelPenaltyCount || 0);
              const _ns = Number(_cust.noShowCount || 0);
              return <span title={`페널티 취소 ${_cp}회 / 노쇼 ${_ns}회`}
                style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#FFF3E0",color:"#E65100",border:"1px solid #FFB74D",fontWeight:800,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3}}>
                <I name="alert" size={10}/>주의
              </span>;
            })()}
            <span style={{fontSize:T.fs.xs,color:T.textSub,marginLeft:"auto",marginRight:8}}>{_primaryName||f.custName||item?.custName} ({salesHistory.length}건)</span>
            {/* 닫기 X 버튼 — 예약모달 X 와 동일 디자인 */}
            <button onClick={e=>{e.stopPropagation();setHistoryOpen(false)}} aria-label="매출 히스토리 닫기"
              style={{width:30,height:30,borderRadius:"50%",
                background:T.gray200,border:"none",color:T.gray500,cursor:"pointer",
                fontSize:T.fs.md,display:"flex",alignItems:"center",justifyContent:"center",
                transition:"background .15s,color .15s",flexShrink:0}}
              onMouseOver={e=>{e.currentTarget.style.background=T.dangerLt;e.currentTarget.style.color=T.danger}}
              onMouseOut={e=>{e.currentTarget.style.background=T.gray200;e.currentTarget.style.color=T.gray500}}>✕</button>
          </div>
          <div style={{padding:"12px 16px",overflowY:"auto",flex:1}}>
            {/* 고객 메모 — 클릭 시 수정 모드 */}
            {(custMemo || f.custId) && (
              <div style={{padding:"12px 14px",marginBottom:10,background:"#FFFDE7",
                borderRadius:T.radius.md}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:T.fs.xxs,fontWeight:T.fw.bolder,color:"#F57F17",display:"inline-flex",alignItems:"center",gap:4}}><I name="clipboard" size={11}/>고객 메모</span>
                  {!editingCustMemo && f.custId && (
                    <button onClick={()=>{ setCustMemoDraft(custMemo||""); setEditingCustMemo(true); }}
                      style={{fontSize:10,color:"#F57F17",background:"#fff",border:"1px solid #FFD54F",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>
                      <I name="edit" size={10} style={{marginRight:3}}/>{custMemo ? "수정" : "메모 추가"}
                    </button>
                  )}
                </div>
                {editingCustMemo ? (
                  <>
                    <textarea value={custMemoDraft} onChange={e=>setCustMemoDraft(e.target.value)}
                      placeholder="고객 메모 입력 (특이사항·선호·주의)"
                      style={{width:"100%",minHeight:120,padding:"8px 10px",fontSize:T.fs.xs,
                        border:"1px solid #FFD54F",borderRadius:6,fontFamily:"inherit",
                        lineHeight:1.6,resize:"vertical",boxSizing:"border-box",background:"#fff"}}/>
                    <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                      <button onClick={()=>{ setEditingCustMemo(false); setCustMemoDraft(""); }} disabled={savingCustMemo}
                        style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:"1px solid "+T.border,background:"#fff",color:T.textSub,cursor:savingCustMemo?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:600}}>
                        취소
                      </button>
                      <button disabled={savingCustMemo} onClick={async()=>{
                        if (!f.custId) { alert("고객 정보가 연결되지 않아 메모 저장 불가"); return; }
                        setSavingCustMemo(true);
                        try {
                          await sb.update('customers', f.custId, { memo: custMemoDraft });
                          setCustMemo(custMemoDraft);
                          setEditingCustMemo(false);
                          setCustMemoDraft("");
                        } catch(e) {
                          alert("메모 저장 실패: " + (e?.message || e));
                        } finally {
                          setSavingCustMemo(false);
                        }
                      }} style={{fontSize:11,padding:"4px 12px",borderRadius:6,border:"none",background:"#F57F17",color:"#fff",cursor:savingCustMemo?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:700,opacity:savingCustMemo?0.6:1}}>
                        {savingCustMemo ? "저장 중..." : <span style={{display:"inline-flex",alignItems:"center",gap:3}}><I name="check" size={11}/>저장</span>}
                      </button>
                    </div>
                  </>
                ) : custMemo ? (
                  <div onClick={()=>{ if (f.custId) { setCustMemoDraft(custMemo||""); setEditingCustMemo(true); } }}
                    title={f.custId ? "클릭해서 수정" : ""}
                    style={{fontSize:T.fs.xs,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word",cursor:f.custId?"pointer":"default",borderRadius:4,padding:"2px 4px",margin:"-2px -4px",transition:"background .15s"}}
                    onMouseOver={e=>{ if (f.custId) e.currentTarget.style.background="#FFF59D40"; }}
                    onMouseOut={e=>{ e.currentTarget.style.background="transparent"; }}>
                    {custMemo}
                  </div>
                ) : (
                  <div style={{fontSize:T.fs.xs,color:T.gray500,fontStyle:"italic"}}>메모 없음 — 위 "메모 추가" 버튼으로 작성</div>
                )}
              </div>
            )}
            {historyLoading ? (
              <div style={{textAlign:"center",padding:40,color:T.textSub}}>로딩중...</div>
            ) : salesHistory.length === 0 && !custMemo ? (
              <div style={{textAlign:"center",padding:40,color:T.textSub,fontSize:T.fs.sm}}>매출 내역 없음</div>
            ) : (
              <>
                {salesHistory.map((s,i) => {
                  const cash = (s.svc_cash||0) + (s.prod_cash||0);
                  const card = (s.svc_card||0) + (s.prod_card||0);
                  const tr = (s.svc_transfer||0) + (s.prod_transfer||0);
                  const pt = (s.svc_point||0) + (s.prod_point||0);
                  const ext = s.external_prepaid||0;
                  const total = cash + card + tr + pt + ext;
                  // sale_details 기반 실제 항목 (sales.service_name 단일 캐시는 reservation.service_id 단일 필드를 그대로 박는 부정확값이라 사용 안 함)
                  const _details = salesDetailsMap[s.id] || [];
                  // 보유권 사용/차감: pkg_use(회수 차감 — 다회권), pkg_deduct(금액 차감 — 다담권/선불권)
                  const _pkgUses = _details.filter(d => d && (d.item_kind === "pkg_use" || d.item_kind === "pkg_deduct"));
                  const _items = _details.filter(d => d && (d.item_kind === "svc" || d.item_kind === "prod" || !d.item_kind));
                  const _itemLines = _items.map(d => {
                    const nm = (d.service_name||"").trim(); if (!nm) return null;
                    const q = Number(d.qty)||1;
                    return q>1 ? `${nm} × ${q}` : nm;
                  }).filter(Boolean);
                  // 매출 발생 지점
                  const _br = (data?.branches||[]).find(b => b.id === s.bid);
                  const _brName = _br?.short || _br?.name || "";
                  // 보유권 차감 라인 (0원 매출이어도 차감 내역은 명확히 노출)
                  const _pkgUseLines = _pkgUses.map(d => {
                    let nm = (d.service_name||"").trim();
                    nm = nm.replace(/^\[보유권\s*(사용|차감)\]\s*/, "");
                    if (!nm) return null;
                    const q = Number(d.qty)||1;
                    const amt = Number(d.unit_price)||0;
                    if (d.item_kind === "pkg_deduct") {
                      // 다담권/선불권: 금액 차감
                      const total = amt * q;
                      return total > 0 ? `${nm} ${total.toLocaleString()}원 사용` : `${nm} 사용`;
                    }
                    // 다회권/패키지: 회수 차감
                    return q>1 ? `${nm} ${q}회 차감` : `${nm} 1회 차감`;
                  }).filter(Boolean);
                  // 포인트 사용 (결제수단 합계가 0원이어도 포인트만 사용한 경우 노출 — 결제수단 배지는 total>0 조건이라 안 보임)
                  const _pointUsed = (s.svc_point||0) + (s.prod_point||0);
                  return (
                    <div key={s.id||i} style={{padding:"12px 14px",marginBottom:8,background:i===0?"#f0f0ff":"#fafafa",
                      borderRadius:T.radius.md,
                      transition:"background .15s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,gap:6,flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.primary}}>{s.date}</span>
                          {_brName && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#ECEFF1",color:"#37474F",fontWeight:700}}>{_brName}</span>}
                        </div>
                        {total>0 && <span style={{fontSize:T.fs.xs,color:T.text,fontWeight:700}}>{total.toLocaleString()}원</span>}
                      </div>
                      {total>0 && (cash+card+tr+pt+ext > 0) && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:6}}>
                        {cash>0 && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#FFF3E0",color:"#E65100",fontWeight:700}}>💵 현금 {cash.toLocaleString()}</span>}
                        {tr>0 && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#E8F5E9",color:"#2E7D32",fontWeight:700}}>🏦 입금 {tr.toLocaleString()}</span>}
                        {card>0 && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#E3F2FD",color:"#1565C0",fontWeight:700}}>💳 카드 {card.toLocaleString()}</span>}
                        {pt>0 && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#F3E5F5",color:"#6A1B9A",fontWeight:700}}>⭐ 포인트 {pt.toLocaleString()}</span>}
                        {ext>0 && <span style={{fontSize:9,padding:"1px 6px",borderRadius:T.radius.sm,background:"#FFEBEE",color:"#C62828",fontWeight:700}}>📦 외부선결제 {ext.toLocaleString()}</span>}
                      </div>}
                      {_itemLines.length > 0 && <div style={{fontSize:T.fs.xs,color:T.gray700,marginBottom:4,lineHeight:1.5}}>{_itemLines.join(" · ")}</div>}
                      {(_pkgUseLines.length > 0 || (total === 0 && _pointUsed > 0)) && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:6}}>
                        {_pkgUseLines.map((ln,k) => (
                          <span key={k} style={{fontSize:10,padding:"2px 7px",borderRadius:T.radius.sm,background:"#FFF8E1",color:"#8D6E00",fontWeight:700}}>🎫 {ln}</span>
                        ))}
                        {total === 0 && _pointUsed > 0 && (
                          <span style={{fontSize:10,padding:"2px 7px",borderRadius:T.radius.sm,background:"#F3E5F5",color:"#6A1B9A",fontWeight:700}}>⭐ 포인트 {_pointUsed.toLocaleString()} 사용</span>
                        )}
                      </div>}
                      {s.staff_name && <div style={{fontSize:T.fs.nano,color:T.textSub,marginBottom:4}}>담당: {s.staff_name}</div>}
                      {s.memo && <div
                        onMouseDown={e=>e.stopPropagation()}
                        style={{fontSize:T.fs.xs,color:T.text,lineHeight:1.6,
                          whiteSpace:"pre-wrap",wordBreak:"break-word",
                          userSelect:"text",WebkitUserSelect:"text",cursor:"text",
                          padding:"8px 10px",background:"#fff",borderRadius:6,
                          maxHeight:200,overflowY:"auto",
                          border:`1px solid ${T.border}`}}>{s.memo}</div>}
                    </div>
                  );
                })}
              </>
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
                  <div style={{fontSize:14,fontWeight:800,color:"#1a1a2e",marginBottom:2}}>{f.custName || "-"}{custNum && <span style={{marginLeft:6,fontSize:11,color:T.text,fontWeight:700}}>#{custNum}</span>}</div>
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

              {/* 보유 패키지 + 포인트 */}
              {(((custPkgsInfo||[]).length > 0 && activePkgSummary.length > 0) || custPointBal > 0) && <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6,display:"flex",alignItems:"center",gap:4}}><I name="wallet" size={12}/>보유 현황</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {custPointBal > 0 && (
                    <span style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:11,fontWeight:700,border:"1px solid #B2EBF2",whiteSpace:"nowrap"}}>
                      <span style={{padding:"3px 8px",background:"#fff",color:T.gray700}}>포인트</span>
                      <span style={{padding:"3px 8px",background:"#E0F7FA",color:"#006064",fontWeight:800}}>{custPointBal.toLocaleString()}P</span>
                    </span>
                  )}
                  {activePkgSummary.map((pkg,i) => {
                    const c = pkg.type==="prepaid"
                      ? { val:"#fffde7", txt:"#7a5a00", bdr:"#f3d77a" }
                      : pkg.type==="annual"
                      ? { val:"#f3e8f7", txt:"#6a1b9a", bdr:"#d8b6e0" }
                      : { val:T.primaryLt, txt:T.primaryDk, bdr:"#d6cefa" };
                    return (
                      <span key={i} style={{display:"inline-flex",alignItems:"stretch",borderRadius:8,overflow:"hidden",fontSize:11,fontWeight:700,border:`1px solid ${c.bdr}`,whiteSpace:"nowrap"}}>
                        <span style={{padding:"3px 8px",background:"#fff",color:T.gray700}}>{pkg.label}</span>
                        {pkg.value && <span style={{padding:"3px 8px",background:c.val,color:c.txt,fontWeight:800}}>{pkg.value}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>}

              {/* 고객 메모 */}
              {custMemo && <div style={{padding:"10px 12px",marginBottom:12,background:"#FFFDE7",borderRadius:8,border:"1px solid #FFF176"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#F57F17",marginBottom:4,display:"flex",alignItems:"center",gap:4}}><I name="clipboard" size={11}/>고객 메모</div>
                <div style={{fontSize:12,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{custMemo}</div>
              </div>}

              {/* 최근 매출 이력 (최대 5건) */}
              {salesHistory.length > 0 && <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginBottom:6,display:"flex",alignItems:"center",gap:5}}><I name="chart" size={12}/>최근 매출 ({salesHistory.length}건)</div>
                {salesHistory.slice(0,5).map((s,i) => {
                  const total = (s.svc_card||0)+(s.svc_cash||0)+(s.svc_transfer||0)+(s.svc_point||0);
                  const _details = salesDetailsMap[s.id] || [];
                  const _items = _details.filter(d => d && (d.item_kind === "svc" || d.item_kind === "prod" || d.item_kind === "pkg_use" || !d.item_kind));
                  const _itemLines = _items.map(d => {
                    const nm = (d.service_name||"").trim(); if (!nm) return null;
                    const q = Number(d.qty)||1;
                    return q>1 ? `${nm} × ${q}` : nm;
                  }).filter(Boolean);
                  const _br = (data?.branches||[]).find(b => b.id === s.bid);
                  const _brName = _br?.short || _br?.name || "";
                  return <div key={s.id||i} style={{padding:"8px 10px",marginBottom:4,background:i===0?"#f0f0ff":"#fafafa",borderRadius:6,border:"1px solid "+(i===0?T.primary+"30":T.border),fontSize:11}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <span style={{fontWeight:700,color:T.primary}}>{s.date}</span>
                        {_brName && <span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#ECEFF1",color:"#37474F",fontWeight:700}}>{_brName}</span>}
                      </div>
                      {total>0 && <span style={{fontWeight:700,color:T.text}}>{total.toLocaleString()}원</span>}
                    </div>
                    {_itemLines.length > 0 && <div style={{color:T.gray700,marginTop:2}}>{_itemLines.join(" · ")}</div>}
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
      {/* 차감 결정 모달 — 모든 취소 흐름(naver_cancelled / cancelled / no_show)에서 공용 */}
      <CancelDecisionModal
        open={!!cancelDecision}
        reasonLabel={cancelDecision?.reason}
        onResolve={(d)=>cancelDecision?.onResolve(d)}
        onClose={()=>cancelDecision?.onResolve('close')}
        custId={f.custId}
        custName={f.custName}
        branchName={(data?.branches||[]).find(b=>b.id===f.bid)?.name||''}
        dateStr={f.date}
        timeStr={f.time}
        prepaid={f.externalPrepaid}
      />
      {/* 📱 문자 발송 모달 — 현재 예약 고객 자동 입력 */}
      {showSmsModal && (() => {
        const _localCust = (data?.customers||[]).find(c => c.id === f.custId);
        const _smsCust = {
          id: f.custId || ('res_' + (item?.id || 'tmp')),
          name: f.custName || '',
          phone: f.custPhone || '',
          smsConsent: _localCust ? _localCust.smsConsent : true,
          bid: f.bid,
        };
        return <SendSmsModal
          open={showSmsModal}
          onClose={() => setShowSmsModal(false)}
          customers={[_smsCust]}
          branches={data?.branches || []}
          userBranches={userBranches}
          defaultBranchId={f.bid}/>;
      })()}
      {/* 📋 동의서 보내기 모달 — 예약 고객 자동 입력. 예약과 연동(reservationId) → 차트 상태 갱신 */}
      {consentOpen && f.custId && createPortal(
        <ConsentModal
          cust={{ id: f.custId, name: f.custName, phone: f.custPhone, bid: f.bid }}
          bizId={_activeBizId}
          data={data}
          reservationId={item?.id}
          onClose={() => { setConsentOpen(false); setChartReloadKey(k => k + 1); }}/>,
        document.body)}
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
    : [["today","오늘"],["prev","전일"],["thismonth","이번달"],["lastmonth","지난달"],["thisyear","올해"],["lastyear","작년"],["all","전체"],["custom","직접"]];

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
    else if (key==="thisyear") { s=`${y}-01-01`; e=today; }
    else if (key==="lastyear") { s=`${y-1}-01-01`; e=`${y-1}-12-31`; }
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
