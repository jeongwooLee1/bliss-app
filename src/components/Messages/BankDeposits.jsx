import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { fromDb, _activeBizId, PREPAID_TAG_ID } from '../../lib/db'
import { onRtPing } from '../../lib/rtPings'
import { todayStr, fmtDate, fmtTime, genId, fmtLocal } from '../../lib/utils'
import I from '../common/I'

// ---------- 유틸 ----------
const fmt = n => (n==null?'':Number(n).toLocaleString());

// 한국시간 ISO → "MM/DD HH:mm"
const fmtSmsTime = iso => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch { return iso; }
};

const STATUS_LABEL = { pending:'미매칭', matched:'매칭됨', ignored:'무시', card:'카드정산', awaiting_sale:'고객 대기' };
const STATUS_BG    = { pending:'#FFF3E0', matched:'#E8F5E9', ignored:'#F5F5F5', card:'#E8EAF6', awaiting_sale:'#FFF8E1' };
const STATUS_FG    = { pending:'#E65100', matched:'#2E7D32', ignored:'#9E9E9E', card:'#3949AB', awaiting_sale:'#B45309' };

// ---------- 매칭 모달 ----------
function MatchModal({ deposit, branches, onClose, onMatched, currentUser }) {
  const [candidates, setCandidates] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [custCandidates, setCustCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(deposit.transfererName || '');

  const fromDate = useMemo(() => {
    const d = new Date(deposit.smsSentAt || Date.now());
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0,10);
  }, [deposit.smsSentAt]);
  const toDate = useMemo(() => {
    const d = new Date(deposit.smsSentAt || Date.now());
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0,10);
  }, [deposit.smsSentAt]);

  // 입금시각 기준 ±3시간 윈도우 (HH:mm 문자열)
  const timeWindow = useMemo(() => {
    const d = new Date(deposit.smsSentAt || Date.now());
    const dateStr = d.toISOString().slice(0,10); // local로 환산해도 거의 같음 — KST 기준 sms_sent_at 가정
    // KST로 환산해서 date/time 추출
    const kst = new Date(d.getTime());
    const dateKst = `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
    const lo = new Date(kst.getTime() - 3*3600*1000);
    const hi = new Date(kst.getTime() + 3*3600*1000);
    const fmtT = x => `${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`;
    return { date: dateKst, loTime: fmtT(lo), hiTime: fmtT(hi), depTime: fmtT(kst) };
  }, [deposit.smsSentAt]);

  // 매출 + 예약 로드 (검색어 변하면 예약 검색 범위 확장)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const bidFilter = deposit.bid ? `&bid=eq.${deposit.bid}` : '';
      const term = (search||'').trim();

      // 1) sales 후보 (최근 7일, 강남점)
      const salesFilter = `&date=gte.${fromDate}&date=lte.${toDate}${bidFilter}&order=date.desc,created_at.desc&limit=200`;
      const salesRows = await sb.get('sales', salesFilter);

      // 2) reservations:
      //    - 검색 없으면 → 입금시각 ±3h 같은 날짜만
      //    - 검색 있으면 → 입금일 기준 ±30일 + 이름 부분일치 (서버 ilike)
      let rsvFilter;
      if (term) {
        const rsvFromDate = (() => { const d=new Date(deposit.smsSentAt||Date.now()); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
        const rsvToDate = (() => { const d=new Date(deposit.smsSentAt||Date.now()); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10); })();
        rsvFilter = `&date=gte.${rsvFromDate}&date=lte.${rsvToDate}${bidFilter}&cust_name=ilike.*${encodeURIComponent(term)}*&order=date.desc,time.desc&limit=100`;
      } else {
        rsvFilter = `&date=eq.${timeWindow.date}&time=gte.${timeWindow.loTime}&time=lte.${timeWindow.hiTime}${bidFilter}&order=time.asc&limit=100`;
      }
      const rsvRows = await sb.get('reservations', rsvFilter);

      // 3) customers — 직접 고객 매칭 후보 (이름·전화·고객번호 부분일치)
      let custRows = [];
      if (term.length >= 1) {
        const orFilter = `or=(name.ilike.*${encodeURIComponent(term)}*,name2.ilike.*${encodeURIComponent(term)}*,phone.ilike.*${encodeURIComponent(term)}*,phone2.ilike.*${encodeURIComponent(term)}*,cust_num.ilike.*${encodeURIComponent(term)}*)`;
        // 동명이인 많을 때(예: "유민" 54명) 무정렬 limit이면 정작 당사자가 잘림 → 넉넉히 받아 관련도순 정렬 후 상위만
        const _raw = await sb.get('customers', `&business_id=eq.${_activeBizId}&${orFilter}&select=id,name,name2,phone,phone2,cust_num&limit=80`);
        const _t = term.trim();
        const _score = (c) => {
          const nm = (c.name||'').trim();
          if (nm === _t) return 5;                                  // 이름 정확 일치
          if ((c.phone||'') === _t || (c.cust_num||'') === _t) return 4; // 전화/고객번호 정확
          if (nm.startsWith(_t)) return 3;                          // 이름 시작
          if (nm.includes(_t) || (c.name2||'').includes(_t)) return 2;  // 이름 부분
          return 1;                                                 // 전화/번호 부분
        };
        custRows = (_raw || []).sort((a,b) => _score(b) - _score(a)).slice(0, 25);
      }

      if (!alive) return;

      // sales 점수 + 정렬
      const list = fromDb('sales', salesRows || []);
      const amount = Number(deposit.amount) || 0;
      list.forEach(r => {
        const transfer = Number(r.svcTransfer||0) + Number(r.prodTransfer||0);
        const totalPay = transfer || (Number(r.svcCash||0)+Number(r.svcCard||0)+Number(r.prodCash||0)+Number(r.prodCard||0));
        r._amountScore = (transfer === amount ? 3 : (totalPay === amount ? 2 : 0));
        r._nameScore = term && (r.custName||'').includes(term) ? 1 : 0;
        r._totalPay = totalPay;
        r._transfer = transfer;
      });
      list.sort((a,b) => (b._amountScore + b._nameScore) - (a._amountScore + a._nameScore));
      setCandidates(list);

      // reservations: 일반예약만 + 취소/노쇼 제외 + 과거 날짜 예약만 제외
      // (같은 날 예약은 시술 후 계좌이체 결제가 흔하므로 시각 무관 표시 — 입금 12:38, 예약 12:10 케이스 노출)
      const depDate = timeWindow.date;
      const isPastDay = (r) => r.date && r.date < depDate;
      const rsv = fromDb('reservations', rsvRows || [])
        .filter(r => !r.isSchedule)
        .filter(r => !['cancelled','no_show','naver_cancelled'].includes(r.status))
        .filter(r => !isPastDay(r));
      setReservations(rsv);
      setCustCandidates(custRows || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [fromDate, toDate, deposit.bid, deposit.amount, deposit.smsSentAt, timeWindow.date, timeWindow.loTime, timeWindow.hiTime, search]);

  const filtered = useMemo(() => {
    const t = (search||'').trim();
    if (!t) return candidates;
    return candidates.filter(r =>
      (r.custName||'').includes(t) ||
      (r.custPhone||'').includes(t) ||
      (r.serviceName||'').includes(t)
    );
  }, [candidates, search]);

  // kind: 'payment'=결제 입금(매출 시 입금 결제수단) | 'deposit'=예약금(매출 시 선결제)
  const doMatchCustomer = async (cust, kind='payment') => {
    const kindLabel = kind === 'deposit' ? '예약금(선결제)' : '결제 입금';
    const applyHint = kind === 'deposit'
      ? `→ 그 고객 매출 등록 시 ${fmt(deposit.amount)}원이 '선결제(예약금)'로 들어가 시술비에서 차감됩니다.`
      : `→ 그 고객 매출 등록 시 ${fmt(deposit.amount)}원이 결제수단 '입금'으로 들어갑니다.`;
    const ok = window.confirm(`이 입금을 다음 고객 앞으로 [${kindLabel}]로 매칭하고 매출등록 대기로 둘까요?\n\n${cust.name||'(이름없음)'} ${cust.phone||''}\n\n${applyHint}`);
    if (!ok) return;
    const url = `${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Cache-Control':'no-cache' },
      body: JSON.stringify({
        status: 'awaiting_sale',
        matched_cust_id: cust.id,
        matched_sale_id: null,
        matched_reservation_id: null,
        deposit_kind: kind,
        matched_at: new Date().toISOString(),
        matched_by: currentUser?.id || null,
      }),
    });
    if (!r.ok) { alert('고객 매칭 실패: ' + await r.text()); return; }
    onMatched?.();
    onClose?.();
  };

  const doMatchSale = async (sale) => {
    const ok = window.confirm(`이 입금을 다음 매출에 매칭할까요?\n\n${sale.date} ${sale.custName} ${fmt(sale._totalPay)}원`);
    if (!ok) return;
    const url = `${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Cache-Control':'no-cache' },
      body: JSON.stringify({
        status: 'matched',
        matched_sale_id: sale.id,
        matched_reservation_id: null,
        matched_at: new Date().toISOString(),
        matched_by: currentUser?.id || null,
      }),
    });
    if (!r.ok) { alert('매칭 실패: ' + await r.text()); return; }
    onMatched?.();
    onClose?.();
  };

  const doMatchReservation = async (rsv) => {
    const amt = Number(deposit.amount) || 0;
    const ok = window.confirm(
      `이 입금을 다음 예약에 매칭할까요?\n\n${rsv.date} ${rsv.time||''} ${rsv.custName||''}\n\n→ 예약 선결제로 ${fmt(amt)}원이 자동 등록됩니다.`
    );
    if (!ok) return;

    // 1) 예약: 선결제(external_prepaid) + 변경이력 로그 + 예약금완료 태그
    const curPrepaid = Number(rsv.externalPrepaid) || 0;
    const logLine = `[예약금] ${deposit.transfererName || '(이름없음)'} ${fmt(amt)}원 입금 · ${fmtSmsTime(deposit.smsSentAt)}`;
    const curLog = (Array.isArray(rsv.scheduleLog) ? rsv.scheduleLog.join('\n') : (rsv.scheduleLog||'')).trim();
    const curTags = Array.isArray(rsv.selectedTags) ? rsv.selectedTags : [];
    const rsvBody = {
      external_prepaid: curPrepaid + amt,
      schedule_log: curLog ? `${curLog}\n${logLine}` : logLine,
    };
    if (!(rsv.externalPlatform||'').trim()) rsvBody.external_platform = '계좌이체';
    if (PREPAID_TAG_ID && !curTags.includes(PREPAID_TAG_ID)) rsvBody.selected_tags = [...curTags, PREPAID_TAG_ID];
    const rUp = await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${rsv.id}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Cache-Control':'no-cache' },
      body: JSON.stringify(rsvBody),
    });
    if (!rUp.ok) { alert('예약 선결제 등록 실패: ' + await rUp.text()); return; }

    // 2) bank_deposits 매칭 기록
    const r = await fetch(`${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Cache-Control':'no-cache' },
      body: JSON.stringify({
        status: 'matched',
        matched_sale_id: null,
        matched_reservation_id: rsv.id,
        matched_at: new Date().toISOString(),
        matched_by: currentUser?.id || null,
      }),
    });
    if (!r.ok) { alert('매칭 실패: ' + await r.text()); return; }
    onMatched?.();
    onClose?.();
  };

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:12}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:560,width:'100%',maxHeight:'85vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:T.fs.md,fontWeight:T.fw.bold}}>매출 매칭</div>
          <button onClick={onClose} style={{border:'none',background:'transparent',cursor:'pointer',fontSize:18}}>×</button>
        </div>
        <div style={{padding:'12px 16px',background:T.primaryLt,fontSize:T.fs.sm}}>
          <div><b>{deposit.transfererName || '(이름없음)'}</b> · {fmtSmsTime(deposit.smsSentAt)}</div>
          <div style={{marginTop:4}}>입금 <b>{fmt(deposit.amount)}원</b></div>
        </div>
        <div style={{padding:'10px 16px',borderBottom:`1px solid ${T.border}`}}>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="고객 이름 검색 (예약·매출 동시 검색)"
            style={{width:'100%',padding:'8px 10px',border:`1px solid ${T.border}`,borderRadius:6,fontSize:T.fs.sm,fontFamily:'inherit'}}
          />
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:6}}>
            매출: 최근 7일 · 금액일치 우선  /  예약: {search.trim() ? '이름검색 ±30일' : `입금시점(${timeWindow.depTime}) ±3시간`} · 시작 후 예약 제외
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'8px 16px'}}>
          {loading && <div style={{padding:20,textAlign:'center',color:T.textMuted}}>로딩 중…</div>}

          {/* 예약 후보 */}
          {!loading && reservations.length > 0 && (
            <div style={{marginBottom:10}}>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bold,padding:'4px 2px 6px',display:'flex',alignItems:'center',gap:5}}>
                <I name="calendar" size={12}/> 예약 {reservations.length}건
              </div>
              {reservations.map(r => {
                const isCloseToDeposit = !search.trim() && r.time && (() => {
                  const [h,m] = r.time.split(':').map(Number);
                  const [dh,dm] = timeWindow.depTime.split(':').map(Number);
                  return Math.abs((h*60+m) - (dh*60+dm)) <= 60;
                })();
                return (
                  <div key={r.id} style={{
                    padding:'10px 12px',
                    marginBottom:6,
                    border:`1px solid ${isCloseToDeposit?T.primary:T.border}`,
                    borderRadius:8,
                    background: isCloseToDeposit ? T.primaryLt : '#fff',
                    display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,
                  }}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>
                        {r.custName || '(이름없음)'} {isCloseToDeposit && <span style={{fontSize:T.fs.xs,color:T.primary,marginLeft:4}}>· 입금시각 ±1h</span>}
                      </div>
                      <div style={{fontSize:T.fs.xs,color:T.textSub,marginTop:2}}>
                        {r.date} {r.time || ''} {r.staffId ? '· ' + (r.staffId) : ''} {r.custPhone ? '· ' + r.custPhone : ''}
                      </div>
                    </div>
                    <button onClick={()=>doMatchReservation(r)} style={{padding:'6px 12px',border:`1px solid ${T.primary}`,background:'#fff',color:T.primary,borderRadius:6,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:'pointer',whiteSpace:'nowrap'}}>
                      예약 매칭
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 매출 후보 */}
          {!loading && (
            <div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bold,padding:'4px 2px 6px',display:'flex',alignItems:'center',gap:5}}>
                <I name="banknote" size={12}/> 매출 {filtered.length}건
              </div>
              {filtered.length === 0 && <div style={{padding:'8px 10px',color:T.textMuted,fontSize:T.fs.xs,background:'#FAFAFA',borderRadius:6,marginBottom:8}}>매출 후보 없음 — 아래에서 고객 직접 매칭 가능</div>}
              {filtered.map(s => {
                const isAmountMatch = s._amountScore > 0;
                return (
                  <div key={s.id} style={{
                    padding:'10px 12px',
                    marginBottom:6,
                    border:`1px solid ${isAmountMatch?T.primary:T.border}`,
                    borderRadius:8,
                    background: isAmountMatch ? T.primaryLt : '#fff',
                    display:'flex',alignItems:'center',justifyContent:'space-between',gap:10
                  }}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>
                        {s.custName || '(이름없음)'} {isAmountMatch && <span style={{fontSize:T.fs.xs,color:T.primary,marginLeft:4}}>· 금액일치</span>}
                      </div>
                      <div style={{fontSize:T.fs.xs,color:T.textSub,marginTop:2}}>
                        {s.date} {s.serviceName || ''} {s.custPhone ? '· ' + s.custPhone : ''}
                      </div>
                      <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>
                        합계 {fmt(s._totalPay)}원 (계좌이체 {fmt(s._transfer)}원)
                      </div>
                    </div>
                    <button onClick={()=>doMatchSale(s)} style={{padding:'6px 12px',border:'none',background:T.primary,color:'#fff',borderRadius:6,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:'pointer',whiteSpace:'nowrap'}}>
                      매출 매칭
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 고객 직접 매칭 (매출 대기) */}
          {!loading && custCandidates.length > 0 && (
            <div style={{marginTop:14}}>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,fontWeight:T.fw.bold,padding:'4px 2px 6px',display:'flex',alignItems:'center',gap:5}}>
                <I name="users" size={12}/> 고객 직접 매칭 (매출 등록 대기) {custCandidates.length}명
              </div>
              <div style={{fontSize:T.fs.xs,color:T.textMuted,padding:'2px 2px 6px'}}>
                해당 고객 매출 등록 시 입금액이 결제수단 "계좌이체"로 자동 입력됩니다.
              </div>
              {custCandidates.map(c => (
                <div key={c.id} style={{
                  padding:'10px 12px',
                  marginBottom:6,
                  border:`1px solid ${T.border}`,
                  borderRadius:8,
                  background:'#fff',
                  display:'flex',alignItems:'center',justifyContent:'space-between',gap:10
                }}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold}}>
                      {c.name || '(이름없음)'} {c.name2 && <span style={{color:T.textMuted,fontWeight:T.fw.normal}}>({c.name2})</span>}
                    </div>
                    <div style={{fontSize:T.fs.xs,color:T.textSub,marginTop:2}}>
                      {c.phone || '연락처 없음'} {c.cust_num ? ' · #' + c.cust_num : ''}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:5,flexShrink:0}}>
                    <button onClick={()=>doMatchCustomer(c,'payment')} title="매출 시 결제수단 '입금'으로 들어감" style={{padding:'6px 10px',border:'1px solid #2E7D32',background:'#E8F5E9',color:'#2E7D32',borderRadius:6,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:'pointer',whiteSpace:'nowrap'}}>
                      결제입금
                    </button>
                    <button onClick={()=>doMatchCustomer(c,'deposit')} title="매출 시 '선결제(예약금)'로 들어가 시술비 차감" style={{padding:'6px 10px',border:`1px solid ${T.warning||'#F59E0B'}`,background:'#FFF8E1',color:'#B45309',borderRadius:6,fontSize:T.fs.sm,fontWeight:T.fw.bold,cursor:'pointer',whiteSpace:'nowrap'}}>
                      예약금
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 메인 ----------
export default function BankDeposits({ data, branches=[], userBranches=[], currentUser=null, onDepositChange, setPendingOpenRes, setPage }) {
  const [deposits, setDeposits] = useState([]);
  const [filter, setFilter] = useState('all'); // all|pending|matched|ignored
  const [matchTarget, setMatchTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [matchedInfo, setMatchedInfo] = useState({}); // depositId -> 연결된 예약/매출 라벨

  const bidFilter = userBranches.length
    ? `&bid=in.(${userBranches.map(b=>`"${b}"`).join(',')})`
    : '';

  const initialLoadRef = useRef(false);
  const load = useCallback(async (silent = false) => {
    if (!silent && !initialLoadRef.current) setLoading(true);
    const filterStr = `${bidFilter}&order=sms_sent_at.desc&limit=200`;
    const rows = await sb.get('bank_deposits', filterStr);
    const next = fromDb('bank_deposits', rows || []);
    // 동일 데이터면 setState 스킵 (불필요한 리렌더 = 깜빡임 방지)
    setDeposits(prev => {
      if (prev.length === next.length && prev.every((p,i) => p.id === next[i].id && p.status === next[i].status && p.matchedSaleId === next[i].matchedSaleId && p.matchedReservationId === next[i].matchedReservationId)) {
        return prev;
      }
      return next;
    });
    // 부모 뱃지 즉시 갱신 (매칭/되돌리기 직후 pending 수 반영 — 120초 폴링 기다리지 않음)
    try { onDepositChange?.(next.filter(d=>d.status==='pending').length); } catch {}
    // 매칭된 예약/매출 라벨 로드 → 입금 카드에 "→ 예약/매출 ..." 연결 정보 표시
    try {
      const rsvIds  = [...new Set(next.filter(d=>d.matchedReservationId).map(d=>d.matchedReservationId))];
      const saleIds = [...new Set(next.filter(d=>d.matchedSaleId).map(d=>d.matchedSaleId))];
      const custIds = [...new Set(next.filter(d=>d.status==='awaiting_sale' && d.matchedCustId).map(d=>d.matchedCustId))];
      const info = {};
      if (rsvIds.length) {
        const rr = await sb.get('reservations', `&id=in.(${rsvIds.map(x=>`"${x}"`).join(',')})&select=id,date,time,cust_name,reservation_id`);
        const rmap = {}; (rr||[]).forEach(x=>{ rmap[x.id] = { type:'rsv', date:x.date, time:x.time, name:x.cust_name, rid:x.reservation_id }; });
        next.forEach(d=>{ if (d.matchedReservationId && rmap[d.matchedReservationId]) info[d.id] = rmap[d.matchedReservationId]; });
      }
      if (saleIds.length) {
        const sr = await sb.get('sales', `&id=in.(${saleIds.map(x=>`"${x}"`).join(',')})&select=id,date,cust_name,service_name,reservation_id`);
        const smap = {}; (sr||[]).forEach(x=>{ smap[x.id] = { type:'sale', date:x.date, name:x.cust_name, resvFk:x.reservation_id }; });
        next.forEach(d=>{ if (d.matchedSaleId && smap[d.matchedSaleId]) info[d.id] = smap[d.matchedSaleId]; });
      }
      if (custIds.length) {
        const cr = await sb.get('customers', `&id=in.(${custIds.map(x=>`"${x}"`).join(',')})&select=id,name,phone,cust_num`);
        const cmap = {}; (cr||[]).forEach(x=>{ cmap[x.id] = { type:'cust', name:x.name, phone:x.phone, custNum:x.cust_num }; });
        next.forEach(d=>{ if (d.status==='awaiting_sale' && d.matchedCustId && cmap[d.matchedCustId]) info[d.id] = cmap[d.matchedCustId]; });
      }
      setMatchedInfo(info);
    } catch (e) { /* 연결 라벨 로드 실패는 무시 */ }
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      setLoading(false);
    }
  }, [bidFilter]);

  // 초기 로드 + 30초 폴링 + Realtime (Realtime이 메인, 폴링은 백업)
  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 120000);
    const off = onRtPing('bank_deposits', () => load(true));
    return () => {
      clearInterval(interval);
      try { off(); } catch {}
    };
  }, [load]);

  const list = useMemo(() => {
    if (filter === 'all') return deposits.filter(d => d.status !== 'card' && d.status !== 'ignored');
    return deposits.filter(d => d.status === filter);
  }, [deposits, filter]);

  const counts = useMemo(() => ({
    all: deposits.filter(d=>d.status!=='card' && d.status!=='ignored').length,
    pending: deposits.filter(d=>d.status==='pending').length,
    awaiting_sale: deposits.filter(d=>d.status==='awaiting_sale').length,
    matched: deposits.filter(d=>d.status==='matched').length,
    ignored: deposits.filter(d=>d.status==='ignored').length,
    card: deposits.filter(d=>d.status==='card').length,
  }), [deposits]);

  const setStatus = async (deposit, newStatus) => {
    const url = `${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`;
    const body = { status: newStatus };
    if (newStatus === 'pending') {
      body.matched_sale_id = null;
      body.matched_reservation_id = null;
      body.matched_at = null;
      body.matched_by = null;
    }
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Cache-Control':'no-cache' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { alert('상태 변경 실패: ' + await r.text()); return; }
    load();
  };

  const ignoreDeposit = (d) => {
    setStatus(d, 'ignored');
  };

  // 입금→예약 매칭으로 넣었던 선결제·변경이력·예약금완료 태그를 원복
  const rollbackReservation = async (deposit) => {
    try {
      const rid = deposit.matchedReservationId;
      if (!rid) return;
      const rows = await sb.get('reservations', `&id=eq.${rid}&select=external_prepaid,external_platform,schedule_log,selected_tags&limit=1`);
      if (!rows || !rows.length) return;
      const r0 = rows[0];
      const amt = Number(deposit.amount) || 0;
      const newPrepaid = Math.max(0, (Number(r0.external_prepaid)||0) - amt);
      const logLine = `[예약금] ${deposit.transfererName || '(이름없음)'} ${fmt(amt)}원 입금 · ${fmtSmsTime(deposit.smsSentAt)}`;
      const curLog = (Array.isArray(r0.schedule_log) ? r0.schedule_log.join('\n') : (r0.schedule_log||'')).trim();
      const body = {
        external_prepaid: newPrepaid,
        schedule_log: curLog.split('\n').filter(l => l.trim() !== logLine).join('\n'),
      };
      if (newPrepaid === 0) {
        let curTags = r0.selected_tags;
        if (typeof curTags === 'string') { try { curTags = JSON.parse(curTags||'[]'); } catch { curTags = []; } }
        if (!Array.isArray(curTags)) curTags = [];
        if (PREPAID_TAG_ID && curTags.includes(PREPAID_TAG_ID)) body.selected_tags = curTags.filter(t => t !== PREPAID_TAG_ID);
        if ((r0.external_platform||'') === '계좌이체') body.external_platform = null;
      }
      await fetch(`${SB_URL}/rest/v1/reservations?id=eq.${rid}`, {
        method: 'PATCH', headers: { ...sbHeaders, 'Cache-Control':'no-cache' }, body: JSON.stringify(body),
      });
    } catch (e) { console.error('[bank] 예약 원복 실패:', e); }
  };

  const reopenDeposit = async (d) => {
    const hadRsv = d.status === 'matched' && d.matchedReservationId;
    const wasAwait = d.status === 'awaiting_sale';
    if (!window.confirm('미매칭 상태로 되돌릴까요?' + (hadRsv ? '\n\n예약에 등록했던 선결제·예약금 기록도 함께 취소됩니다.' : ''))) return;
    if (hadRsv) await rollbackReservation(d);
    if (wasAwait) {
      await fetch(`${SB_URL}/rest/v1/bank_deposits?id=eq.${d.id}`, {
        method:'PATCH', headers:{...sbHeaders,'Cache-Control':'no-cache'},
        body: JSON.stringify({ matched_cust_id:null, status:'pending', matched_at:null, matched_by:null })
      });
      load();
      return;
    }
    setStatus(d, 'pending');
  };

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,background:T.bgCard}}>
      {/* 필터 탭 */}
      <div style={{display:'flex',gap:6,padding:'8px 12px',borderBottom:`1px solid ${T.border}`,flexShrink:0,overflowX:'auto'}}>
        {['all','pending','awaiting_sale','matched','ignored','card'].map(k => {
          const labels = { all:'전체', pending:'미매칭', awaiting_sale:'고객 대기', matched:'매칭됨', ignored:'무시', card:'카드정산' };
          const active = filter === k;
          return (
            <button key={k} onClick={()=>setFilter(k)} style={{
              padding:'6px 12px',
              border:`1px solid ${active?T.primary:T.border}`,
              borderRadius:16,
              background: active ? T.primaryLt : '#fff',
              color: active ? T.primaryDk : T.textSub,
              fontWeight: active ? 700 : 500,
              fontSize:T.fs.xs,
              fontFamily:'inherit',
              cursor:'pointer',
              whiteSpace:'nowrap',
            }}>
              {labels[k]} {counts[k]>0 && <span style={{marginLeft:3,fontSize:T.fs.nano}}>({counts[k]})</span>}
            </button>
          );
        })}
      </div>

      {/* 리스트 */}
      <div style={{flex:1,overflowY:'auto',padding:'8px 10px'}}>
        {loading && <div style={{padding:20,textAlign:'center',color:T.textMuted}}>로딩 중…</div>}
        {!loading && list.length===0 && <div style={{padding:30,textAlign:'center',color:T.textMuted,fontSize:T.fs.sm}}>입금 내역이 없습니다.</div>}
        {!loading && list.map(d => {
          const status = d.status || 'pending';
          const _br = branches.find(b => b.id === d.bid);
          const brName = _br ? (_br.short || _br.name || '') : '';
          return (
            <div key={d.id} style={{
              padding:'7px 10px',
              marginBottom:5,
              borderRadius:8,
              background: status==='pending' ? '#FFFBF0' : '#fff',
              border: `1px solid ${T.border}`,
              display:'flex',flexDirection:'column',gap:5,
            }}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:5,flex:1,minWidth:0}}>
                  <span style={{fontSize:T.fs.nano,padding:'2px 6px',borderRadius:4,background:STATUS_BG[status],color:STATUS_FG[status],fontWeight:T.fw.bold,whiteSpace:'nowrap'}}>
                    {STATUS_LABEL[status]}
                  </span>
                  {brName && <span style={{fontSize:T.fs.nano,padding:'2px 5px',borderRadius:4,background:T.gray100,color:T.textSub,fontWeight:T.fw.bold,whiteSpace:'nowrap'}}>{brName}</span>}
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {d.transfererName || '(이름없음)'}
                  </span>
                </div>
                <div style={{display:'flex',alignItems:'baseline',gap:7,flexShrink:0}}>
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.primaryDk,whiteSpace:'nowrap'}}>+{fmt(d.amount)}원</span>
                  <span style={{fontSize:T.fs.nano,color:T.textSub,whiteSpace:'nowrap'}}>{fmtSmsTime(d.smsSentAt)}</span>
                </div>
              </div>
              {matchedInfo[d.id] && (()=>{ const mi=matchedInfo[d.id];
                const navTarget = (mi.type==='rsv' && d.matchedReservationId) ? { id:d.matchedReservationId, reservationId:mi.rid, date:mi.date, time:mi.time }
                  : (mi.type==='sale' && mi.resvFk) ? { id:mi.resvFk, date:mi.date }
                  : null;
                const isLink = navTarget && setPendingOpenRes && setPage;
                const label = mi.type==='rsv'
                  ? `예약 · ${mi.date} ${mi.time||''} ${mi.name||'(이름없음)'}`
                  : mi.type==='cust'
                    ? `매출등록 대기 · ${mi.name||'(이름없음)'}${mi.phone? ' · '+mi.phone : ''}`
                    : `매출 · ${mi.date} ${mi.name||'(이름없음)'}`;
                return <div onClick={isLink ? ()=>{ setPendingOpenRes({ ...navTarget, _highlightOnly:true }); setPage('timeline'); } : undefined}
                  title={isLink ? '타임라인에서 예약 보기' : undefined}
                  style={{display:'flex',alignItems:'center',gap:4,fontSize:T.fs.xs,color: mi.type==='cust' ? '#B45309' : T.primaryDk,fontWeight:T.fw.bold,cursor:isLink?'pointer':'default',textDecoration:isLink?'underline':'none'}}>
                  <I name={mi.type==='rsv'?'calendar':mi.type==='cust'?'users':'banknote'} size={11}/>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}{isLink?' →':''}</span>
                </div>;
              })()}
              <div style={{display:'flex',gap:6}}>
                {status === 'pending' && (
                  <>
                    <button onClick={()=>setMatchTarget(d)} style={{flex:1,padding:'5px 0',border:'none',background:T.primary,color:'#fff',borderRadius:6,fontSize:T.fs.xs,fontWeight:T.fw.bold,cursor:'pointer'}}>
                      매출 매칭
                    </button>
                    <button onClick={()=>ignoreDeposit(d)} style={{padding:'5px 14px',border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,borderRadius:6,fontSize:T.fs.xs,cursor:'pointer'}}>
                      무시
                    </button>
                  </>
                )}
                {status !== 'pending' && (
                  <button onClick={()=>reopenDeposit(d)} style={{flex:1,padding:'5px 0',border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,borderRadius:6,fontSize:T.fs.xs,cursor:'pointer'}}>
                    미매칭으로 되돌리기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {matchTarget && (
        <MatchModal
          deposit={matchTarget}
          branches={branches}
          currentUser={currentUser}
          onClose={()=>setMatchTarget(null)}
          onMatched={load}
        />
      )}
    </div>
  );
}
