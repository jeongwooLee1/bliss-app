import React, { useState, useRef } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { toDb } from '../../lib/db'
import { todayStr, genId, fmtLocal } from '../../lib/utils'
import { Btn, StatCard, GridLayout, fmt, Empty, DataTable, FLD } from '../common'
import I from '../common/I'
import { SmartDatePicker } from '../Reservations/ReservationsPage'
import { DetailedSaleForm } from '../Timeline/ReservationModal'

const _mc = (fn) => { if(fn) fn(); };

function Z() { return <span style={{color:T.gray400}}>0</span>; }

const SC = ({label, val, sub, clr}) => <StatCard label={label} value={val} sub={sub} color={clr}/>;

const sx = {
  // 레이아웃
  flex:        (gap=0) => ({ display:"flex", alignItems:"center", gap }),
  flexBetween: (gap=0) => ({ display:"flex", alignItems:"center", justifyContent:"space-between", gap }),
  flexCenter:  { display:"flex", alignItems:"center", justifyContent:"center" },
  flexCol:     (gap=0) => ({ display:"flex", flexDirection:"column", gap }),
  // 텍스트 자르기
  ellipsis:    { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  // 텍스트 스타일
  label:       { fontSize:T.fs.xxs, fontWeight:T.fw.bolder, color:T.textSub, letterSpacing:.3 },
  caption:     { fontSize:T.fs.nano, color:T.textMuted },
  title:       { fontSize:T.fs.md,  fontWeight:T.fw.bolder, color:T.text },
  // 성별
  genderBadge: (g) => ({
    fontSize:T.fs.nano, fontWeight:T.fw.bolder, borderRadius:T.radius.sm, padding:"1px 4px",
    background: g==="M" ? T.maleLt : T.femaleLt,
    color:      g==="M" ? T.male   : T.female,
  }),
  // 입력
  inputBase:   {
    width:"100%", height:36, borderRadius:T.radius.md, border:"1px solid "+T.border,
    padding:"0 12px", fontSize:T.fs.sm, outline:"none", boxSizing:"border-box",
    fontFamily:"inherit", color:T.text, background:T.bgCard,
  },
};

function SalesPage({ data, setData, userBranches, isMaster, setPage, role }) {
  const [salesTab, setSalesTab] = useState("sales"); // "sales" | "stats"
  const dateAnchorRef = React.useRef(null);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [periodKey, setPeriodKey] = useState("1day");
  const [showSheet, setShowSheet] = useState(false);
  const [vb, setVb] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const inRange = (date) => {
    if (periodKey==="all" || (!startDate && !endDate)) return true;
    if (startDate && endDate) return date >= startDate && date <= endDate;
    return true;
  };

  const sales = (data?.sales||[]).filter(s => {
    if (!(vb==="all" ? userBranches.includes(s.bid) : s.bid===vb)) return false;
    if (q) {
      const sq = q.toLowerCase();
      return (s.custName||"").toLowerCase().includes(sq) ||
             (s.custPhone||"").includes(sq) ||
             (s.staffName||"").toLowerCase().includes(sq) ||
             (s.custNum||"").includes(sq) ||
             (s.memo||"").toLowerCase().includes(sq);
    }
    return inRange(s.date);
  });

  const totals = sales.reduce((a,s) => {
    const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
    const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
    return {
      svc:  a.svc+sv,  svcCash:a.svcCash+s.svcCash, svcTransfer:a.svcTransfer+s.svcTransfer,
      svcCard:a.svcCard+s.svcCard, svcPoint:a.svcPoint+s.svcPoint,
      prod: a.prod+pr, prodCash:a.prodCash+s.prodCash, prodTransfer:a.prodTransfer+s.prodTransfer,
      prodCard:a.prodCard+s.prodCard, prodPoint:a.prodPoint+s.prodPoint,
      gift: a.gift+(s.gift||0), total: a.total+sv+pr+(s.gift||0),
    };
  }, {svc:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prod:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0,gift:0,total:0});

  const handleDelete = (id) => { setData(prev=>({...prev,sales:(prev?.sales||[]).filter(s=>s.id!==id)})); sb.del("sales",id).catch(console.error); };
  const handleSave   = (item) => { setData(prev=>({...prev,sales:[...prev.sales,item]})); sb.insert("sales",toDb("sales",item)).catch(console.error); setShowModal(false); };
  const handleEditSave = (item) => {
    const fi = {...item, id:editSale.id};
    setData(prev=>({...prev, sales:(prev?.sales||[]).map(s=>s.id===editSale.id?fi:s)}));
    sb.update("sales",editSale.id,toDb("sales",fi)).catch(console.error);
    setEditSale(null);
  };

  // 날짜 표시 포맷
  const fmtShort = (ds) => {
    if (!ds) return "";
    const d = new Date(ds);
    const dow = ["일","월","화","수","목","금","토"][d.getDay()];
    return `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}.${d.getDate()}(${dow})`;
  };
  const dateLabel = periodKey==="all" ? "전체"
    : (periodKey==="1day"||startDate===endDate) ? fmtShort(startDate)
    : `${fmtShort(startDate)} ~ ${fmtShort(endDate)}`;

  // 결제수단 칩
  const PayChips = ({svcCash,svcTransfer,svcCard,svcPoint,prodCash,prodTransfer,prodCard,prodPoint,gift}) => {
    const chips = [
      {lbl:"시술현금",  v:svcCash,     c:T.primary},
      {lbl:"시술입금",  v:svcTransfer, c:T.primary},
      {lbl:"시술카드",  v:svcCard,     c:T.primary},
      {lbl:"시술포인트",v:svcPoint,    c:T.primary},
      {lbl:"제품현금",  v:prodCash,    c:T.infoLt2},
      {lbl:"제품입금",  v:prodTransfer,c:T.infoLt2},
      {lbl:"제품카드",  v:prodCard,    c:T.infoLt2},
      {lbl:"제품포인트",v:prodPoint,   c:T.infoLt2},
      {lbl:"상품권",    v:gift,        c:T.orange},
    ].filter(x=>x.v>0);
    if (!chips.length) return <span style={{color:T.textMuted,fontSize:T.fs.xxs}}>-</span>;
    return <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
      {chips.map(({lbl,v,c})=>(
        <span key={lbl} style={{fontSize:T.fs.nano,padding:"2px 6px",borderRadius:T.radius.sm,background:c+"18",color:c,fontWeight:T.fw.bold,whiteSpace:"nowrap"}}>
          {lbl} {fmt(v)}
        </span>
      ))}
    </div>;
  };

  if (salesTab === "stats") return <div>
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {[["sales","매출 관리"],["stats","매출 통계"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid transparent",
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    <StatsPage data={data} userBranches={userBranches} isMaster={isMaster} role={role}/>
  </div>;

  return <div>
    {/* Tab Segment */}
    <div style={{display:"flex",gap:0,marginBottom:12}}>
      {[["sales","매출 관리"],["stats","매출 통계"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSalesTab(k)} style={{flex:1,padding:"10px 0",fontSize:T.fs.sm,fontWeight:salesTab===k?T.fw.bolder:T.fw.medium,
          color:salesTab===k?T.primary:T.textMuted,
          background:"none",border:"none",borderBottom:salesTab===k?`2px solid ${T.primary}`:"2px solid "+T.border,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:T.sp.sm}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 관리</h2>
      <Btn variant="primary" onClick={()=>setShowModal(true)}><I name="plus" size={12}/> 매출등록</Btn>
    </div>

    {/* Filters */}
    <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.sm,flexWrap:"wrap",alignItems:"center"}}>
      <button ref={dateAnchorRef} onClick={()=>setShowSheet(true)}
        style={{height:36,borderRadius:T.radius.md,border:"1px solid "+T.primary+"44",background:T.primaryHover,
                fontSize:T.fs.sm,padding:"0 14px",cursor:"pointer",fontFamily:"inherit",color:T.primaryDk,
                fontWeight:T.fw.bold,display:"flex",alignItems:"center",gap:T.sp.xs,outline:"none",flexShrink:0}}>
        <I name="calendar" size={14} color={T.primary}/>
        <span>{dateLabel}</span>
        <I name="chevD" size={12} color={T.primary}/>
      </button>
      <select className="inp" style={{flex:1,minWidth:100,height:36}} value={vb} onChange={e=>setVb(e.target.value)}>
        <option value="all">전체 매장</option>
        {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div style={{position:"relative",flex:2,minWidth:160}}>
        <I name="search" size={14} color={T.gray400} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        <input className="inp" style={{paddingLeft:32,paddingRight:q?30:12,height:36}}
          placeholder="고객명, 연락처, 담당자, 메모" value={q} onChange={e=>setQ(e.target.value)}/>
        {q && <button onClick={()=>setQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
          background:"none",border:"none",cursor:"pointer",color:T.gray400,fontSize:T.fs.lg,lineHeight:1,padding:0}}>×</button>}
      </div>
      <span style={{fontSize:T.fs.sm,color:T.textSub,whiteSpace:"nowrap",flexShrink:0}}>{sales.length}건</span>
    </div>

    {/* 요약 합계 바 */}
    {sales.length > 0 && (
      <div style={{display:"flex",gap:T.sp.sm,marginBottom:T.sp.md,flexWrap:"wrap"}}>
        {[
          {lbl:"총 매출",  v:totals.total, c:T.info,    bold:true},
          {lbl:"시술",     v:totals.svc,   c:T.primary},
          {lbl:"제품",     v:totals.prod,  c:T.infoLt2},
          {lbl:"상품권",   v:totals.gift,  c:T.orange},
        ].map(({lbl,v,c,bold})=>(
          <div key={lbl} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:T.radius.md,
            padding:"6px 14px",display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{lbl}</span>
            <span style={{fontSize:T.fs.sm,fontWeight:bold?T.fw.black:T.fw.bolder,color:c}}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    )}

    {/* 테이블 */}
    <DataTable card>
      <thead><tr>
        <th style={{width:36}}>#</th>
        <th>날짜</th>
        <th>지점</th>
        <th>이름</th>
        <th>담당자</th>
        <th>시술합계</th>
        <th>제품합계</th>
        <th>총합계</th>
        <th>메모</th>
        <th style={{width:60}}></th>
      </tr></thead>
      <tbody>
        {sales.length===0
          ? <tr><td colSpan={10}><Empty msg="매출 기록 없음" icon="wallet"/></td></tr>
          : sales.map((s,i) => {
              const sv = s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint;
              const pr = s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint;
              const total = sv+pr+(s.gift||0);
              const isExp = expandedId===s.id;
              const br = (data.branches||[]).find(b=>b.id===s.bid);
              return <React.Fragment key={s.id}>
                <tr style={{cursor:"pointer",background:isExp?T.primaryHover:"transparent"}}
                  onClick={()=>setExpandedId(isExp?null:s.id)}>
                  <td style={{color:T.textMuted}}>{i+1}</td>
                  <td style={{whiteSpace:"nowrap",color:T.textSub,fontSize:T.fs.xxs}}>{s.date}</td>
                  <td><span style={{fontSize:T.fs.xxs,background:T.gray200,borderRadius:T.radius.sm,padding:"1px 5px"}}>{br?.short||"-"}</span></td>
                  <td style={{fontWeight:T.fw.bold}}>
                    {s.custGender && <span style={{...sx.genderBadge(s.custGender),marginRight:4}}>{s.custGender==="M"?"남":"여"}</span>}
                    {s.custName||"-"}
                    {s.custNum && <span style={{fontSize:T.fs.nano,color:T.textMuted,marginLeft:4}}>#{s.custNum}</span>}
                  </td>
                  <td style={{color:T.textSub,fontSize:T.fs.xxs}}>{s.staffName||"-"}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.primary}}>{sv>0?fmt(sv):<Z/>}</td>
                  <td style={{fontWeight:T.fw.bold,color:T.infoLt2}}>{pr>0?fmt(pr):<Z/>}</td>
                  <td style={{fontWeight:T.fw.black,color:T.info}}>{fmt(total)}</td>
                  <td style={{...sx.ellipsis,maxWidth:100,fontSize:T.fs.xxs,color:T.textSub}}>{s.memo||""}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:"flex",gap:3}}>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>setEditSale(s)}><I name="edit" size={12}/></Btn>
                      <Btn variant="secondary" size="sm" style={{padding:"2px 5px"}} onClick={()=>handleDelete(s.id)}><I name="trash" size={12}/></Btn>
                    </div>
                  </td>
                </tr>
                {isExp && <tr><td colSpan={10} style={{padding:0,background:T.gray100}}>
                  <div style={{padding:"10px 16px",display:"flex",gap:T.sp.lg,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>결제 수단</div>
                      <PayChips {...s}/>
                    </div>
                    {s.custPhone && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>연락처</div>
                      <span style={{fontSize:T.fs.sm,color:T.primary}}>{s.custPhone}</span>
                    </div>}
                    {s.memo && <div style={{flex:1}}>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>메모</div>
                      <span style={{fontSize:T.fs.sm,color:T.text}}>{s.memo}</span>
                    </div>}
                    {s.createdAt && <div>
                      <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginBottom:4}}>등록시간</div>
                      <span style={{fontSize:T.fs.xxs,color:T.textSub}}>{new Date(s.createdAt).toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
                    </div>}
                  </div>
                </td></tr>}
              </React.Fragment>;
            })
        }
        {/* 합계 행 */}
        {sales.length>0 && <tr style={{background:T.gray200,fontWeight:T.fw.bolder}}>
          <td colSpan={5} style={{textAlign:"right",color:T.textSub,fontSize:T.fs.xxs}}>합 계</td>
          <td style={{color:T.primary}}>{fmt(totals.svc)}</td>
          <td style={{color:T.infoLt2}}>{fmt(totals.prod)}</td>
          <td style={{color:T.info}}>{fmt(totals.total)}</td>
          <td colSpan={2}/>
        </tr>}
      </tbody>
    </DataTable>

    {showModal && <DetailedSaleForm
      reservation={{id:genId(),bid:userBranches[0],custId:null,custName:"",custPhone:"",custGender:"",
        staffId:(data.staff||[]).find(s=>s.bid===(userBranches[0]))?.id||"",serviceId:null,date:todayStr()}}
      branchId={userBranches[0]}
      onSubmit={handleSave}
      onClose={()=>_mc(()=>setShowModal(false))} data={data} setData={setData}/>}
    {editSale && <DetailedSaleForm
      reservation={{...editSale, saleMemo:editSale.memo||""}}
      branchId={editSale.bid}
      onSubmit={handleEditSave}
      onClose={()=>_mc(()=>setEditSale(null))} data={data} setData={setData}/>}
    <SmartDatePicker open={showSheet} onClose={()=>setShowSheet(false)} anchorEl={dateAnchorRef.current}
      startDate={startDate} endDate={endDate} mode="sales"
      onApply={(s,e,p)=>{ setStartDate(s); setEndDate(e); setPeriodKey(p); setShowSheet(false); }}/>
  </div>;
}

// ═══════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════
function StatsPage({ data, userBranches, isMaster, role }) {
  const [period, setPeriod] = useState("7");
  const [vb, setVb] = useState("all");
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - parseInt(period));

  const filtered = (data?.sales||[]).filter(s => {
    const d = new Date(s.date);
    return d >= start && d <= end && ((vb==="all"?userBranches.includes(s.bid):s.bid===vb));
  });

  const t = filtered.reduce((a,s)=>({
    svcTotal:a.svcTotal+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint),
    prodTotal:a.prodTotal+(s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint),
    gift:a.gift+s.gift,
    total:a.total+(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift),
    count:a.count+1,
    svcCash:a.svcCash+s.svcCash,svcTransfer:a.svcTransfer+s.svcTransfer,svcCard:a.svcCard+s.svcCard,svcPoint:a.svcPoint+s.svcPoint,
    prodCash:a.prodCash+s.prodCash,prodTransfer:a.prodTransfer+s.prodTransfer,prodCard:a.prodCard+s.prodCard,prodPoint:a.prodPoint+s.prodPoint,
  }),{svcTotal:0,prodTotal:0,gift:0,total:0,count:0,svcCash:0,svcTransfer:0,svcCard:0,svcPoint:0,prodCash:0,prodTransfer:0,prodCard:0,prodPoint:0});

  const days = parseInt(period);

  // By staff
  const byStaff = {};
  filtered.forEach(s => {
    if(!byStaff[s.staffName]) byStaff[s.staffName]={count:0,total:0};
    byStaff[s.staffName].count++;
    byStaff[s.staffName].total+=(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift);
  });
  const staffRank = Object.entries(byStaff).sort((a,b)=>b[1].total-a[1].total);

  // By branch
  const byBranch = {};
  if (isMaster) {
    filtered.forEach(s => {
      const bn = (data.branches||[]).find(b=>b.id===s.bid)?.short||"";
      if(!byBranch[bn]) byBranch[bn]={count:0,total:0};
      byBranch[bn].count++;
      byBranch[bn].total+=(s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint+s.gift);
    });
  }
  const branchRank = Object.entries(byBranch).sort((a,b)=>b[1].total-a[1].total);

  // Chart data (7 days)
  const chartDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = fmtLocal(d);
    const dayData = (data?.sales||[]).filter(s=>s.date===ds && ((vb==="all"?userBranches.includes(s.bid):s.bid===vb)));
    const svc = dayData.reduce((a,s)=>a+s.svcCash+s.svcTransfer+s.svcCard+s.svcPoint,0);
    const prod = dayData.reduce((a,s)=>a+s.prodCash+s.prodTransfer+s.prodCard+s.prodPoint,0);
    chartDays.push({label:`${d.getMonth()+1}/${d.getDate()}`,svc,prod,total:svc+prod});
  }
  const maxChart = Math.max(...chartDays.map(d=>d.total),1);

  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
      <h2 className="page-title" style={{marginBottom:0}}>매출 통계</h2>
      <div style={{display:"flex",gap:T.sp.sm}}>
        {<select className="inp" style={{maxWidth:130,width:"auto"}} value={vb} onChange={e=>setVb(e.target.value)}>
          <option value="all">전체 매장</option>
          {(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        <select className="inp" style={{maxWidth:110,width:"auto"}} value={period} onChange={e=>setPeriod(e.target.value)}>
          <option value="7">7일</option><option value="14">14일</option><option value="30">30일</option>
        </select>
      </div>
    </div>
    {/* Summary Cards */}
    <GridLayout className="stat-cards" cols="repeat(auto-fit,minmax(160px,1fr))" gap={12} style={{marginBottom:20}}>
      <SC label="총 매출" val={`${fmt(t.total)}원`} sub={`${t.count}건`} clr={T.info}/>
      <SC label="시술 매출" val={`${fmt(t.svcTotal)}원`} sub="시술 합계" clr={T.primary}/>
      <SC label="제품 매출" val={`${fmt(t.prodTotal)}원`} sub="제품 합계" clr={T.infoLt2}/>
      <SC label="상품권" val={`${fmt(t.gift)}원`} sub="상품권 합계" clr={T.danger}/>
      <SC label="일 평균" val={`${fmt(Math.round(t.total/days))}원`} sub={`${days}일 평균`} clr={T.info}/>
      <SC label="객단가" val={`${fmt(t.count>0?Math.round(t.total/t.count):0)}원`} sub="건당 평균" clr={T.gray400}/>
    </GridLayout>
    {/* Chart */}
    <div className="card" style={{padding:20,marginBottom:16}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:16}}>최근 7일 매출 (시술 + 제품)</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:130}}>
        {chartDays.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:T.sp.xs}}>
            <span style={{fontSize:T.fs.nano,color:T.textSub}}>{d.total>0?`${fmt(Math.round(d.total/10000))}만`:""}</span>
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:1}}>
              <div style={{width:"100%",height:`${Math.max((d.prod/maxChart)*80,0)}px`,background:T.infoLt2,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
              <div style={{width:"100%",height:`${Math.max((d.svc/maxChart)*80,2)}px`,background:T.primary,borderRadius:"0 0 4px 4px",transition:"height .3s"}}/>
            </div>
            <span style={{fontSize:T.fs.xs,color:T.gray500}}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:T.sp.md,justifyContent:"center",marginTop:10}}>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.primary}}/>시술</span>
        <span style={{fontSize:T.fs.xs,display:"flex",alignItems:"center",gap:T.sp.xs}}><span style={{width:8,height:8,borderRadius:T.radius.sm,background:T.infoLt2}}/>제품</span>
      </div>
    </div>
    <GridLayout className="stat-charts" cols="repeat(auto-fit,minmax(300px,1fr))" gap={16}>
      {/* Payment Breakdown */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>결제수단별 시술 매출</div>
        {[["현금",t.svcCash,T.infoLt2],["입금",t.svcTransfer,T.danger],["카드",t.svcCard,T.primary],["포인트",t.svcPoint,T.gray400]].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:45,color:c,fontWeight:T.fw.bold}}>{l}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${t.svcTotal>0?(v/t.svcTotal)*100:0}%`,background:c,borderRadius:T.radius.sm}}/>
            </div>
            <span style={{width:80,textAlign:"right",fontWeight:T.fw.bold}}>{fmt(v)}원</span>
          </div>
        ))}
      </div>
      {/* Staff Rank */}
      <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>매니저별 매출</div>
        {staffRank.slice(0,8).map(([n,v],i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.info:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{flex:1,fontWeight:T.fw.medium}}>{n}</span>
            <span style={{color:T.textSub,fontSize:T.fs.xxs}}>{v.count}건</span>
            <span style={{fontWeight:T.fw.bolder,color:T.info,width:80,textAlign:"right"}}>{fmt(v.total)}원</span>
          </div>
        ))}
      </div>
      {/* Branch Rank (master) */}
      {isMaster && <div className="card" style={{padding:20}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:T.textSub,marginBottom:14}}>매장별 매출</div>
        {branchRank.map(([n,v],i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:T.sp.sm,marginBottom:8,fontSize:T.fs.sm}}>
            <span style={{width:18,color:i<3?T.primary:T.gray400,fontWeight:T.fw.bolder}}>{i+1}</span>
            <span style={{width:55,fontWeight:T.fw.bold}}>{n}</span>
            <div style={{flex:1,height:6,background:T.gray300,borderRadius:T.radius.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${branchRank[0][1].total>0?(v.total/branchRank[0][1].total)*100:0}%`,background:"linear-gradient(90deg,#5cb5c5,#7c7cc8)",borderRadius:T.radius.sm}}/>
            </div>
            <span style={{fontWeight:T.fw.bolder,width:85,textAlign:"right"}}>{fmt(v.total)}원</span>
          </div>
        ))}
      </div>}
    </GridLayout>
  </div>;
}

export default SalesPage
