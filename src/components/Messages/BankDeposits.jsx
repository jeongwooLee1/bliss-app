import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import { fromDb, _activeBizId } from '../../lib/db'
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

const STATUS_LABEL = { pending:'미매칭', matched:'매칭됨', ignored:'무시' };
const STATUS_BG    = { pending:'#FFF3E0', matched:'#E8F5E9', ignored:'#F5F5F5' };
const STATUS_FG    = { pending:'#E65100', matched:'#2E7D32', ignored:'#9E9E9E' };

// ---------- 매칭 모달 ----------
function MatchModal({ deposit, branches, onClose, onMatched, currentUser }) {
  const [candidates, setCandidates] = useState([]);
  const [reservations, setReservations] = useState([]);
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

      // reservations: 일반예약만 + 취소/노쇼 제외
      const rsv = fromDb('reservations', rsvRows || [])
        .filter(r => !r.isSchedule)
        .filter(r => !['cancelled','no_show','naver_cancelled'].includes(r.status));
      setReservations(rsv);
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
    const ok = window.confirm(`이 입금을 다음 예약에 매칭할까요?\n\n${rsv.date} ${rsv.time||''} ${rsv.custName||''}`);
    if (!ok) return;
    const url = `${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`;
    const r = await fetch(url, {
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
            매출: 최근 7일 · 금액일치 우선  /  예약: {search.trim() ? '이름검색 ±30일' : `입금시점(${timeWindow.depTime}) ±3시간`}
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
              {filtered.length === 0 && <div style={{padding:14,textAlign:'center',color:T.textMuted,fontSize:T.fs.xs}}>후보 매출 없음</div>}
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
        </div>
      </div>
    </div>
  );
}

// ---------- 메인 ----------
export default function BankDeposits({ data, branches=[], userBranches=[], currentUser=null }) {
  const [deposits, setDeposits] = useState([]);
  const [filter, setFilter] = useState('all'); // all|pending|matched|ignored
  const [matchTarget, setMatchTarget] = useState(null);
  const [loading, setLoading] = useState(true);

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
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      setLoading(false);
    }
  }, [bidFilter]);

  // 초기 로드 + 30초 폴링 + Realtime (Realtime이 메인, 폴링은 백업)
  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 30000);

    let ch = null;
    if (window._sbClient) {
      ch = window._sbClient
        .channel('bank_deposits_rt')
        .on('postgres_changes', { event:'*', schema:'public', table:'bank_deposits' }, () => load(true))
        .subscribe();
    }
    return () => {
      clearInterval(interval);
      if (ch && window._sbClient) window._sbClient.removeChannel(ch);
    };
  }, [load]);

  const list = useMemo(() => {
    if (filter === 'all') return deposits;
    return deposits.filter(d => d.status === filter);
  }, [deposits, filter]);

  const counts = useMemo(() => ({
    all: deposits.length,
    pending: deposits.filter(d=>d.status==='pending').length,
    matched: deposits.filter(d=>d.status==='matched').length,
    ignored: deposits.filter(d=>d.status==='ignored').length,
  }), [deposits]);

  const setStatus = async (deposit, newStatus) => {
    const url = `${SB_URL}/rest/v1/bank_deposits?id=eq.${deposit.id}`;
    const body = { status: newStatus };
    if (newStatus === 'pending') {
      body.matched_sale_id = null;
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
    if (!window.confirm('이 입금을 무시 처리할까요?')) return;
    setStatus(d, 'ignored');
  };

  const reopenDeposit = (d) => {
    if (!window.confirm('미매칭 상태로 되돌릴까요?')) return;
    setStatus(d, 'pending');
  };

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,background:T.bgCard}}>
      {/* 필터 탭 */}
      <div style={{display:'flex',gap:6,padding:'8px 12px',borderBottom:`1px solid ${T.border}`,flexShrink:0,overflowX:'auto'}}>
        {['all','pending','matched','ignored'].map(k => {
          const labels = { all:'전체', pending:'미매칭', matched:'매칭됨', ignored:'무시' };
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
              padding:'10px 12px',
              marginBottom:6,
              borderRadius:8,
              background: status==='pending' ? '#FFFBF0' : '#fff',
              border: `1px solid ${T.border}`,
              display:'flex',flexDirection:'column',gap:6,
            }}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0}}>
                  <span style={{fontSize:T.fs.xs,padding:'2px 7px',borderRadius:4,background:STATUS_BG[status],color:STATUS_FG[status],fontWeight:T.fw.bold,whiteSpace:'nowrap'}}>
                    {STATUS_LABEL[status]}
                  </span>
                  {brName && <span style={{fontSize:T.fs.nano,padding:'2px 6px',borderRadius:4,background:T.gray100,color:T.textSub,fontWeight:T.fw.bold,whiteSpace:'nowrap'}}>{brName}</span>}
                  <span style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {d.transfererName || '(이름없음)'}
                  </span>
                </div>
                <div style={{fontSize:T.fs.xs,color:T.textSub,whiteSpace:'nowrap'}}>{fmtSmsTime(d.smsSentAt)}</div>
              </div>
              <div style={{fontSize:T.fs.md,fontWeight:T.fw.bold,color:T.primaryDk}}>
                +{fmt(d.amount)}원
              </div>
              <div style={{display:'flex',gap:6,marginTop:2}}>
                {status === 'pending' && (
                  <>
                    <button onClick={()=>setMatchTarget(d)} style={{flex:1,padding:'6px 0',border:'none',background:T.primary,color:'#fff',borderRadius:6,fontSize:T.fs.xs,fontWeight:T.fw.bold,cursor:'pointer'}}>
                      매출 매칭
                    </button>
                    <button onClick={()=>ignoreDeposit(d)} style={{padding:'6px 12px',border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,borderRadius:6,fontSize:T.fs.xs,cursor:'pointer'}}>
                      무시
                    </button>
                  </>
                )}
                {status !== 'pending' && (
                  <button onClick={()=>reopenDeposit(d)} style={{flex:1,padding:'6px 0',border:`1px solid ${T.border}`,background:'#fff',color:T.textSub,borderRadius:6,fontSize:T.fs.xs,cursor:'pointer'}}>
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
