import React, { useState, useEffect, useCallback } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import I from '../common/I'

const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };

// ── 패키지 타입 라벨/색상 ──
const TYPE_LABEL = { package:"패키지", prepaid:"선불금", dadam:"다담권", annual_discount:"연간할인", energy:"에너지", point:"포인트", annual:"연간회원", dadam_purchase:"다담충전", dadam_usage:"다담사용", pkg_cancel:"패키지취소", discount:"할인", coupon:"쿠폰" };
const TYPE_COLOR = { package:T.primary, prepaid:"#e67e22", dadam:"#e67e22", annual_discount:"#8e44ad", energy:"#27ae60", point:"#3498db", coupon:"#e91e63" };

// ── 소스별 섹션 컴포넌트 ──
function SourceSection({ title, color, items, empty }) {
  if (!items || items.length === 0) return <div style={{padding:"6px 8px",fontSize:11,color:T.gray400,background:"#fafafa",borderRadius:6,marginBottom:4}}>{title}: {empty||"없음"}</div>;
  // 활성 위, 비활성 아래 정렬
  const _today = new Date().toISOString().slice(0,10);
  const _isActive = (it) => {
    const t = it.type || "";
    const isPp = t==="prepaid" || t==="dadam" || t==="dadam_purchase";
    const rem = it.remaining ?? it.remain ?? 0;
    if (rem <= 0) return false;
    const expRaw = it.expiry || "";
    const buyRaw = it.buy_date || it.last_buy || "";
    const exp = expRaw || (buyRaw ? (() => { try { const d=new Date(buyRaw); d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10); } catch { return ""; } })() : "");
    if (exp && exp < _today) return false;
    return true;
  };
  const sortedItems = [...items].sort((a,b) => (_isActive(b)?1:0) - (_isActive(a)?1:0));
  return <div style={{marginBottom:6}}>
    <div style={{fontSize:12,fontWeight:700,color,marginBottom:3}}>{title} ({items.length})</div>
    <div style={{display:"flex",flexDirection:"column",gap:2}}>
      {sortedItems.map((item, i) => {
        const name = item.name || item.pkg_type || item.svc_name || "";
        const remain = item.remaining ?? item.remain ?? 0;
        const used = item.used ?? 0;
        const type = item.type || "";
        const isPrepaid = type === "prepaid" || type === "dadam" || type === "dadam_purchase";
        // 만료일 계산: expiry 필드 우선, 없으면 buy_date/last_buy +1년
        const expiryRaw = item.expiry || "";
        const buyDateRaw = item.buy_date || item.last_buy || "";
        const expiry = expiryRaw || (buyDateRaw ? (() => { try { const d = new Date(buyDateRaw); d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10); } catch { return ""; } })() : "");
        const todayS = new Date().toISOString().slice(0,10);
        const isExpired = expiry && expiry < todayS;
        const isDadamDone = isPrepaid && (remain||0) <= 0;
        const isPkgDone = !isPrepaid && (remain||0) <= 0;
        const inactive = isExpired || isDadamDone || isPkgDone;
        return <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",background:inactive?"#f5f5f5":"#f8f9fa",borderRadius:4,fontSize:13,opacity:inactive?0.4:1}}>
          <span style={{fontSize:10,padding:"1px 5px",borderRadius:3,background:inactive?T.gray400:(TYPE_COLOR[type]||T.gray300),color:"#fff",fontWeight:700,flexShrink:0}}>{TYPE_LABEL[type]||type||"기타"}</span>
          <span style={{flex:1,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:inactive?"line-through":"none",color:inactive?T.gray400:T.text}}>{name}</span>
          {isPrepaid
            ? <span style={{fontWeight:700,color:"#e67e22",flexShrink:0}}>{(remain||0).toLocaleString()}원</span>
            : <>
                {item.bought ? <span style={{fontSize:11,color:T.gray400,flexShrink:0}}>구매{item.bought}</span> : null}
                <span style={{fontSize:11,color:T.gray400,flexShrink:0}}>사용{used}</span>
                <span style={{fontWeight:700,color:remain>0?T.primary:T.gray400,flexShrink:0}}>잔여{remain}</span>
              </>
          }
          {expiry && <span style={{fontSize:10,padding:"1px 4px",borderRadius:3,flexShrink:0,fontWeight:600,
            background:isExpired?"#e74c3c":"#27ae60",color:"#fff"}}>{isExpired?"만료":"~"}{expiry.slice(2)}</span>}
          {!expiry && buyDateRaw && <span style={{fontSize:10,color:T.gray400,flexShrink:0}}>구매{buyDateRaw.slice(5)}</span>}
        </div>;
      })}
    </div>
  </div>;
}

// ── 매출메모 파싱 ──
function parseMemoPackages(memo) {
  if (!memo) return { pkgRemains: [], dadamBalance: null };
  const text = memo.replace(/\r\n/g, "\n");
  // 패키지 잔여: ② 줄에서 "N회남음" 또는 "N 회남음" 패턴
  const pkgRemains = [];
  const pkgMatch = text.match(/패키지[^0-9]*(\d+)\s*회[차\s]*[\/\\]\s*(\d+)\s*회\s*남/i);
  if (pkgMatch) {
    pkgRemains.push({ total: parseInt(pkgMatch[1]), remain: parseInt(pkgMatch[2]) });
  }
  // "N회남음" 단독
  const remainMatch = text.match(/(\d+)\s*회\s*남[음]?/);
  if (!pkgMatch && remainMatch) {
    pkgRemains.push({ remain: parseInt(remainMatch[1]) });
  }
  // 다담권 잔액: "잔여금:XXX" 또는 "잔여금액:XXX"
  let dadamBalance = null;
  const dadamMatch = text.match(/잔여[금액:\s]*([0-9,]+)/);
  if (dadamMatch) {
    dadamBalance = parseInt(dadamMatch[1].replace(/,/g, ""));
  }
  return { pkgRemains, dadamBalance };
}

// ── 매출 이력 + 메모 기반 요약 ──
function SalesHistory({ custId, custNum, onParsed }) {
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null);

  const load = async () => {
    if (sales !== null) { setSales(null); setParsed(null); return; }
    setLoading(true);
    try {
      let rows = [];
      const cols = "id,date,memo,svc_cash,svc_transfer,svc_card,svc_point,prod_cash,prod_transfer,prod_card,cust_name";
      if (custId) {
        const r = await fetch(`${SB_URL}/rest/v1/sales?cust_id=eq.${custId}&select=${cols}&order=date.desc&limit=50`, {headers: H});
        const d = await r.json();
        rows = Array.isArray(d) ? d : [];
      }
      if (rows.length === 0 && custNum) {
        const r2 = await fetch(`${SB_URL}/rest/v1/sales?cust_num=eq.${custNum}&select=${cols}&order=date.desc&limit=50`, {headers: H});
        const d2 = await r2.json();
        rows = Array.isArray(d2) ? d2 : [];
      }
      const withTotal = rows.map(s => ({
        ...s,
        total: (s.svc_cash||0)+(s.svc_transfer||0)+(s.svc_card||0)+(s.svc_point||0)+(s.prod_cash||0)+(s.prod_transfer||0)+(s.prod_card||0)
      }));
      setSales(withTotal);

      // 매출메모에서 패키지/다담 파싱 — 최신 매출 기준
      let lastPkgRemain = null;
      let lastDadamBalance = null;
      let lastPkgDate = null;
      let lastDadamDate = null;
      // 마지막 구매일 (PKG/패키지 구매 매출)
      let lastPurchaseDate = null;

      for (const s of withTotal) {
        const p = parseMemoPackages(s.memo);
        if (p.pkgRemains.length > 0 && !lastPkgRemain) {
          lastPkgRemain = p.pkgRemains[0];
          lastPkgDate = s.date;
        }
        if (p.dadamBalance !== null && lastDadamBalance === null) {
          lastDadamBalance = p.dadamBalance;
          lastDadamDate = s.date;
        }
        // 패키지 구매 매출 감지 (메모에 "패키지" + 금액이 큰 매출)
        const memoLower = (s.memo||"").toLowerCase();
        if (!lastPurchaseDate && (memoLower.includes("pkg") || memoLower.includes("패키지")) && s.total >= 100000) {
          lastPurchaseDate = s.date;
        }
      }
      const result = { lastPkgRemain, lastPkgDate, lastDadamBalance, lastDadamDate, lastPurchaseDate };
      setParsed(result);
      if (onParsed) onParsed(result);
    } catch(e) { console.error(e); setSales([]); }
    setLoading(false);
  };

  return <div style={{marginTop:6}}>
    <button onClick={load} style={{fontSize:10,color:T.primary,background:"none",border:"none",cursor:"pointer",fontWeight:700,padding:0}}>
      {loading ? "로딩..." : sales !== null ? "▲ 매출 닫기" : "▼ 매출 이력 보기"}
    </button>

    {/* 파싱 결과 요약 */}
    {parsed && (parsed.lastPkgRemain || parsed.lastDadamBalance !== null) && <div style={{
      marginTop:4, padding:"6px 10px", background:"#fffde7", borderRadius:6, border:"1px solid #ffeeba",
      display:"flex", gap:12, flexWrap:"wrap", fontSize:11
    }}>
      {parsed.lastPkgRemain && <div>
        <span style={{fontWeight:700,color:T.primary}}>패키지 {parsed.lastPkgRemain.remain}회 남음</span>
        <span style={{color:T.gray400,marginLeft:4}}>({parsed.lastPkgDate})</span>
        {parsed.lastPurchaseDate && <span style={{color:T.gray400,marginLeft:4}}>
          만료: {(() => { const d = new Date(parsed.lastPurchaseDate); d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10); })()}
        </span>}
      </div>}
      {parsed.lastDadamBalance !== null && parsed.lastDadamBalance > 0 && <div>
        <span style={{fontWeight:700,color:"#e67e22"}}>다담 잔액 {parsed.lastDadamBalance.toLocaleString()}원</span>
        <span style={{color:T.gray400,marginLeft:4}}>({parsed.lastDadamDate})</span>
      </div>}
    </div>}

    {sales !== null && sales.length === 0 && <div style={{fontSize:10,color:T.gray400,padding:"4px 0"}}>매출 이력 없음</div>}
    {sales !== null && sales.length > 0 && <div style={{marginTop:4,maxHeight:300,overflow:"auto",display:"flex",flexDirection:"column",gap:4,fontSize:12}}>
      {sales.map((s,i) => {
        const memoText = (s.memo||"").trim();
        const hasPkg = /PKG|패키지|다담|잔여|선불|연간/i.test(memoText);
        return <div key={i} style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+(hasPkg?"#ffeeba":T.border),background:hasPkg?"#fffde7":"#fafafa"}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:memoText?3:0}}>
            <span style={{color:T.gray400,whiteSpace:"nowrap",fontSize:11}}>{(s.date||"").slice(2,10)}</span>
            {s.total>0 && <span style={{fontWeight:700,whiteSpace:"nowrap"}}>{s.total.toLocaleString()}원</span>}
          </div>
          {memoText && <div style={{color:T.gray600,whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.5}}>{memoText}</div>}
        </div>;
      })}
    </div>}
  </div>;
}

function AuditCard({ row, onStatusChange, onNoteChange, onBlissSave }) {
  const memo = JSON.parse(row.memo_packages || "[]");
  const oracle = JSON.parse(row.oracle_packages || "[]");
  const bliss = JSON.parse(row.bliss_packages || "[]");
  const [note, setNote] = useState(row.action_note || "");
  const [editing, setEditing] = useState(false);
  const [blissEdit, setBlissEdit] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [newItem, setNewItem] = useState({svc_name:"",total:0,used:0,expiry:""});
  const startBlissEdit = () => {
    setEditItems(bliss.map(b=>({...b,_changed:false,_delete:false,_expiry:parseExpiry(b.note||""),_origNote:b.note||""})));
    setNewItem({svc_name:"",total:0,used:0,expiry:""});
    setBlissEdit(true);
  };
  const saveBlissEdit = () => {
    const changes = {updated:[],deleted:[],added:[]};
    editItems.forEach(it=>{
      if(it._delete&&it.id) changes.deleted.push(it.id);
      else if(it._changed&&it.id) {
        const cn = (it.svc_name||"").replace(/\(잔액:[^)]*\)/,"").replace(/\(소진\)/,"").replace(/\(전액:[^)]*\)/,"").trim();
        const isDd = cn.includes("다담")||cn.includes("선불");
        let note = buildNote(it._origNote, it._expiry);
        if (isDd && it._dadamBal !== undefined) {
          if (/잔액:[0-9,]+/.test(note)) note = note.replace(/잔액:[0-9,]+/, `잔액:${it._dadamBal}`);
          else note = note ? `${note} | 잔액:${it._dadamBal}` : `잔액:${it._dadamBal}`;
        }
        changes.updated.push({id:it.id, service_name:cn, total_count:it.total, used_count:it.used, note});
      }
    });
    if(newItem.svc_name.trim()) {
      const isNewDadam = newItem.svc_name.includes("다담")||newItem.svc_name.includes("선불");
      const noteStr = [isNewDadam?`잔액:${newItem.total}`:null, newItem.expiry?`유효:${newItem.expiry}`:null].filter(Boolean).join(" | ");
      changes.added.push({service_name:newItem.svc_name,total_count:isNewDadam?0:newItem.total,used_count:isNewDadam?0:newItem.used,note:noteStr,customer_id:row.cust_id,business_id:"biz_khvurgshb"});
    }
    onBlissSave(row,changes);
    setBlissEdit(false);
  };
  const updateEditItem = (idx,field,val) => setEditItems(prev=>prev.map((it,i)=>i===idx?{...it,[field]:val,_changed:true}:it));
  const eipt = {fontSize:11,padding:"3px 5px",borderRadius:4,border:"1px solid "+T.border,textAlign:"center",fontFamily:"inherit"};

  // 불일치 감지
  const memoRemains = memo.filter(m => m.type === "package" && (m.remaining||0) > 0);
  const blissRemains = bliss.filter(b => (b.remain||0) > 0);
  const hasMismatch = memoRemains.length > 0 && blissRemains.length > 0 &&
    (memoRemains.length !== blissRemains.length ||
     memoRemains.some(m => !blissRemains.find(b => (b.svc_name||"").includes(m.name?.replace("패키지","")))));

  const isDone = row.status === "done";

  return <div style={{
    border:`1px solid ${isDone ? T.gray200 : hasMismatch ? "#f0ad4e" : T.border}`,
    borderRadius:10, padding:12, marginBottom:8,
    background: isDone ? "#fafafa" : "#fff",
    opacity: isDone ? 0.7 : 1
  }}>
    {/* 헤더 */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <div>
        <span style={{fontWeight:800,fontSize:14,color:T.text}}>{row.cust_name}</span>
        <span style={{fontSize:11,color:T.gray400,marginLeft:6}}>#{row.cust_num}</span>
        {row.cust_phone && <span style={{fontSize:11,color:T.gray400,marginLeft:6}}>{row.cust_phone}</span>}
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {row.branch && <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:T.gray100,color:T.gray600,fontWeight:600}}>{row.branch}</span>}
        {row.reviewed_at && !isDone && <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"#d4edda",color:"#155724",fontWeight:700}}>수정됨</span>}
        {hasMismatch && !isDone && <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"#fff3cd",color:"#856404",fontWeight:700}}>불일치</span>}
        {row.cust_id && !blissEdit && <button onClick={startBlissEdit}
          style={{padding:"3px 10px",borderRadius:6,border:"none",background:"#3498db",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer"}}>
          블리스 수정
        </button>}
        <button onClick={() => onStatusChange(row.id, isDone ? "pending" : "done")}
          style={{padding:"3px 10px",borderRadius:6,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",
            background:isDone?T.gray200:T.primary,color:isDone?T.gray600:"#fff"}}>
          {isDone ? "되돌리기" : "확인완료"}
        </button>
      </div>
    </div>

    {/* 매출메모 vs 블리스 비교 */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
      <SourceSection title="매출메모" color="#e74c3c" items={Object.values(memo.reduce((acc,m)=>{const k=(m.name||m.pkg_type||"").replace(/패키지/g,"PKG").replace(/왁패/g,"왁싱").replace(/\s+/g,"").trim().toLowerCase();acc[k]=m;return acc;},{}))} empty="메모 없음"/>
      {/* 블리스: 수정 모드 / 보기 모드 */}
      {blissEdit ? <div style={{marginBottom:6}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
          <span style={{fontSize:12,fontWeight:700,color:"#3498db"}}>블리스 수정중</span>
          <div style={{display:"flex",gap:3}}>
            <button onClick={saveBlissEdit} style={{padding:"3px 10px",borderRadius:4,border:"none",background:T.primary,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>저장</button>
            <button onClick={()=>setBlissEdit(false)} style={{padding:"3px 10px",borderRadius:4,border:"1px solid "+T.border,background:"#fff",fontSize:11,cursor:"pointer"}}>취소</button>
          </div>
        </div>
        {editItems.map((it,idx)=>{
          const isExp = it._expiry && new Date(it._expiry)<new Date();
          const cleanName = (it.svc_name||"").replace(/\(잔액:[^)]*\)/,"").replace(/\(소진\)/,"").replace(/\(전액:[^)]*\)/,"").trim();
          const isDadam = cleanName.includes("다담")||cleanName.includes("선불");
          const dadamBal = isDadam ? (it._dadamBal ?? (() => { const m=(it.note||it._origNote||"").match(/잔액:([0-9,]+)/); return m?Number(m[1].replace(/,/g,"")):0; })()) : 0;
          const isDadamDone = isDadam && dadamBal <= 0;
          const isInactive = (isExp || isDadamDone) && !it._delete;
          const disabled = it._delete || isInactive;
          return <div key={idx} style={{display:"flex",gap:4,alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f5f5f5",opacity:disabled?0.35:1,fontSize:12}}>
            <span style={{flex:1,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:isInactive?"line-through":"none",color:isInactive?T.gray400:T.text}} title={cleanName}>{cleanName}{isDadamDone?" (소진)":isInactive?" (만료)":""}</span>
            {isDadam
              ? <input type="number" value={dadamBal} onChange={e=>{const v=parseInt(e.target.value)||0;updateEditItem(idx,"_dadamBal",v);}} style={{...eipt,width:120}} disabled={disabled} placeholder="잔액(원)"/>
              : <><input type="number" value={it.total} onChange={e=>updateEditItem(idx,"total",parseInt(e.target.value)||0)} style={{...eipt,width:38}} disabled={disabled} title="총"/>
                <input type="number" value={it.used} onChange={e=>updateEditItem(idx,"used",parseInt(e.target.value)||0)} style={{...eipt,width:38}} disabled={disabled} title="사용"/>
                <span style={{fontSize:10,fontWeight:700,color:isInactive?T.gray400:T.primary,width:20,textAlign:"center"}}>{it.total-it.used}</span></>
            }
            <input type="text" value={it._expiry} placeholder="만료일" onChange={e=>{let v=e.target.value.replace(/[^0-9-]/g,"");if(/^\d{8}$/.test(v))v=v.slice(0,4)+"-"+v.slice(4,6)+"-"+v.slice(6,8);updateEditItem(idx,"_expiry",v);}} style={{...eipt,width:95,textAlign:"center",fontSize:11,color:isExp?"#e74c3c":T.text}} disabled={it._delete}/>
            {!isInactive && <button onClick={()=>updateEditItem(idx,"_delete",!it._delete)} style={{padding:"1px 4px",borderRadius:3,border:"none",background:it._delete?"#27ae60":"#e74c3c",color:"#fff",fontSize:8,cursor:"pointer"}}>{it._delete?"복":"삭"}</button>}
            {isInactive && <span style={{width:18}}/>}
          </div>;
        })}
        <div style={{display:"flex",gap:4,alignItems:"center",padding:"4px 0",borderTop:"1px dashed "+T.primary,marginTop:3,fontSize:12}}>
          {(()=>{const isNewDadam=(newItem.svc_name||"").includes("다담")||(newItem.svc_name||"").includes("선불"); return <>
          <select value={newItem.svc_name} onChange={e=>setNewItem(p=>({...p,svc_name:e.target.value}))} style={{...eipt,flex:1,textAlign:"left"}}>
            <option value="">-- 선택 --</option>
            {["토탈PKG 5회","왁싱PKG 5회","힐링PKG 5회","케어PKG 8회","비키니PKG 5회","항문PKG 5회","재생PKG 5회","재생힐링PKG 5회","소급PKG 1회권","커플프리패스 3회","다담권","연간할인권","60에너지 10회권","60에너지 5회권","60에너지 1회권","20에너지 5회권","20에너지 1회권","10%추가적립쿠폰","제품전용8만원쿠폰","제품전용3만원쿠폰","기기스크럽1회"].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          {isNewDadam
            ? <input type="number" value={newItem.total||""} onChange={e=>setNewItem(p=>({...p,total:parseInt(e.target.value)||0,used:0}))} style={{...eipt,width:120}} placeholder="잔액(원)"/>
            : <><input type="number" value={newItem.total||""} onChange={e=>setNewItem(p=>({...p,total:parseInt(e.target.value)||0}))} style={{...eipt,width:38}} placeholder="총"/>
              <input type="number" value={newItem.used||""} onChange={e=>setNewItem(p=>({...p,used:parseInt(e.target.value)||0}))} style={{...eipt,width:38}} placeholder="사용"/></>
          }
          <span style={{width:20}}/></>;})()}
          <input type="text" value={newItem.expiry} placeholder="만료일" onChange={e=>{let v=e.target.value.replace(/[^0-9-]/g,"");if(/^\d{8}$/.test(v))v=v.slice(0,4)+"-"+v.slice(4,6)+"-"+v.slice(6,8);setNewItem(p=>({...p,expiry:v}));}} style={{...eipt,width:95,textAlign:"center",fontSize:11}}/>
          <span style={{width:18}}/>
        </div>
      </div>
      : <SourceSection title="블리스" color="#3498db" items={bliss.map(b=>{
        const noteExpiry = parseExpiry(b.note||"");
        const cleanName = (b.svc_name||"").replace(/\(잔액:[^)]*\)/,"").replace(/\(소진\)/,"").replace(/\(전액:[^)]*\)/,"").trim();
        const isDd = cleanName.includes("다담")||cleanName.includes("선불");
        const bal = isDd ? (()=>{const m=(b.note||"").match(/잔액:([0-9,]+)/);return m?Number(m[1].replace(/,/g,"")):0;})() : 0;
        return {...b, svc_name: cleanName,
          remain: isDd ? bal : b.remain,
          type: cleanName.includes("다담")?"prepaid":
                cleanName.includes("연간")?"annual_discount":
                cleanName.includes("에너지")?"energy":
                cleanName.includes("쿠폰")||cleanName.includes("스크럽")?"coupon":"package",
          expiry: noteExpiry
        };
      })} empty="블리스 없음"/>}
    </div>

    {/* 액션 */}
    <div style={{display:"flex",gap:6,marginTop:8,alignItems:"center"}}>
      {editing ? <>
        <input value={note} onChange={e=>setNote(e.target.value)} placeholder="메모 입력"
          style={{flex:1,fontSize:11,padding:"4px 8px",borderRadius:6,border:"1px solid "+T.border,fontFamily:"inherit"}}
          onKeyUp={e=>{if(e.key==="Enter"){onNoteChange(row.id,note);setEditing(false);}}}/>
        <button onClick={()=>{onNoteChange(row.id,note);setEditing(false);}}
          style={{padding:"4px 10px",borderRadius:6,border:"none",background:T.primary,color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer"}}>저장</button>
        <button onClick={()=>setEditing(false)}
          style={{padding:"4px 8px",borderRadius:6,border:"1px solid "+T.border,background:"#fff",fontSize:10,cursor:"pointer"}}>취소</button>
      </> : <>
        {note && <span style={{fontSize:10,color:T.textMuted,flex:1}}>메모: {note}</span>}
        <button onClick={()=>setEditing(true)}
          style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.border,background:"#fff",fontSize:10,cursor:"pointer"}}>
          <I name="edit2" size={10}/> 메모
        </button>
      </>}
    </div>

    {/* 매출 이력 */}
    {(row.cust_id || row.cust_num) && <SalesHistory custId={row.cust_id} custNum={row.cust_num}/>}
  </div>;
}

// ── note에서 만료일 파싱 ──
function parseExpiry(note) {
  if (!note) return "";
  const m = (note||"").match(/유효[:\s]*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}
function buildNote(origNote, newExpiry) {
  if (!origNote) return newExpiry ? `유효:${newExpiry}` : "";
  // 기존 유효 날짜 교체
  if (/유효[:\s]*\d{4}-\d{2}-\d{2}/.test(origNote)) {
    return origNote.replace(/유효[:\s]*\d{4}-\d{2}-\d{2}/, `유효:${newExpiry||""}`);
  }
  return newExpiry ? `${origNote} | 유효:${newExpiry}` : origNote;
}

// ── 블리스 수정 모달 ──
function BlissEditModal({ row, onClose, onSave }) {
  const bliss = JSON.parse(row.bliss_packages || "[]");
  const [items, setItems] = useState(bliss.map(b => ({
    ...b, _changed: false, _delete: false,
    _expiry: parseExpiry(b.note || ""),
    _origNote: b.note || ""
  })));
  const [newItem, setNewItem] = useState({svc_name:"", total:0, used:0, expiry:""});

  const updateItem = (idx, field, val) => {
    setItems(prev => prev.map((it, i) => i === idx ? {...it, [field]: val, _changed: true} : it));
  };
  const ipt = {fontSize:11, padding:"4px 6px", borderRadius:4, border:"1px solid "+T.border, textAlign:"center", fontFamily:"inherit"};

  const handleSave = () => {
    const changes = {updated:[], deleted:[], added:[]};
    items.forEach(it => {
      if (it._delete && it.id) changes.deleted.push(it.id);
      else if (it._changed && it.id) {
        changes.updated.push({
          id: it.id, total_count: it.total, used_count: it.used,
          note: buildNote(it._origNote, it._expiry)
        });
      }
    });
    if (newItem.svc_name.trim()) {
      changes.added.push({
        service_name: newItem.svc_name, total_count: newItem.total, used_count: newItem.used,
        note: newItem.expiry ? `유효:${newItem.expiry}` : "",
        customer_id: row.cust_id, business_id: "biz_khvurgshb"
      });
    }
    onSave(row, changes);
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:16,width:560,maxHeight:"80vh",overflow:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
        <span style={{fontWeight:800,fontSize:14}}>{row.cust_name} 블리스 패키지 수정</span>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:16}}>×</button>
      </div>

      {/* 헤더 */}
      <div style={{display:"flex",gap:6,alignItems:"center",padding:"4px 0",borderBottom:"2px solid "+T.border,fontSize:10,fontWeight:700,color:T.gray400}}>
        <span style={{flex:1}}>패키지명</span>
        <span style={{width:55,textAlign:"center"}}>총횟수</span>
        <span style={{width:55,textAlign:"center"}}>사용</span>
        <span style={{width:35,textAlign:"center"}}>잔여</span>
        <span style={{width:95,textAlign:"center"}}>만료일</span>
        <span style={{width:32}}></span>
      </div>

      {items.map((it, idx) => {
        const isExpired = it._expiry && new Date(it._expiry) < new Date();
        return <div key={idx} style={{display:"flex",gap:6,alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f0f0f0",opacity:it._delete?0.3:1}}>
          <span style={{flex:1,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.svc_name}</span>
          <input type="number" value={it.total} onChange={e=>updateItem(idx,"total",parseInt(e.target.value)||0)}
            style={{...ipt,width:55}} disabled={it._delete}/>
          <input type="number" value={it.used} onChange={e=>updateItem(idx,"used",parseInt(e.target.value)||0)}
            style={{...ipt,width:55}} disabled={it._delete}/>
          <span style={{fontSize:11,fontWeight:700,color:T.primary,width:35,textAlign:"center"}}>{it.total-it.used}</span>
          <input type="date" value={it._expiry} onChange={e=>updateItem(idx,"_expiry",e.target.value)}
            style={{...ipt,width:95,textAlign:"left",color:isExpired?"#e74c3c":T.text}} disabled={it._delete}/>
          <button onClick={()=>updateItem(idx,"_delete",!it._delete)}
            style={{padding:"2px 6px",borderRadius:4,border:"none",background:it._delete?"#27ae60":"#e74c3c",color:"#fff",fontSize:9,cursor:"pointer",width:32}}>
            {it._delete?"복구":"삭제"}
          </button>
        </div>;
      })}

      {/* 추가 */}
      <div style={{borderTop:"2px solid "+T.primary,marginTop:8,paddingTop:8}}>
        <div style={{fontSize:10,fontWeight:700,color:T.primary,marginBottom:4}}>새 패키지 추가</div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input value={newItem.svc_name} onChange={e=>setNewItem(p=>({...p,svc_name:e.target.value}))} placeholder="패키지명"
            style={{...ipt,flex:1,textAlign:"left"}}/>
          <input type="number" value={newItem.total} onChange={e=>setNewItem(p=>({...p,total:parseInt(e.target.value)||0}))} placeholder="총"
            style={{...ipt,width:55}} title="총횟수"/>
          <input type="number" value={newItem.used} onChange={e=>setNewItem(p=>({...p,used:parseInt(e.target.value)||0}))} placeholder="사용"
            style={{...ipt,width:55}} title="사용횟수"/>
          <span style={{fontSize:11,fontWeight:700,color:T.primary,width:35,textAlign:"center"}}>{newItem.total-newItem.used}</span>
          <input type="date" value={newItem.expiry} onChange={e=>setNewItem(p=>({...p,expiry:e.target.value}))}
            style={{...ipt,width:95,textAlign:"left"}} title="만료일"/>
          <span style={{width:32}}/>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
        <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",fontSize:12,cursor:"pointer"}}>취소</button>
        <button onClick={handleSave} style={{padding:"8px 16px",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>저장</button>
      </div>
    </div>
  </div>;
}

// ── 메인 페이지 ──
export default function AdminPkgAudit({ data, setData, userBranches }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [searchQ, setSearchQ] = useState("");
  // editRow 제거 — 인라인 수정으로 전환
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const filter = `&business_id=eq.biz_khvurgshb&order=cust_num.asc`;
      // 페이징으로 전체 로드 (Supabase max-rows=1000 우회)
      const all = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const r = await fetch(`${SB_URL}/rest/v1/pkg_audit?select=*${filter}`, {
          headers: { ...H, "Range-Unit": "items", "Range": `${offset}-${offset+PAGE-1}` }
        });
        const d = await r.json();
        if (!Array.isArray(d) || d.length === 0) break;
        all.push(...d);
        offset += PAGE;
        if (d.length < PAGE) break;
      }
      setRows(all);
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // 필터링
  const branches = [...new Set(rows.map(r => r.branch).filter(Boolean))].sort();
  const filtered = rows.filter(r => {
    if (branchFilter !== "all" && r.branch !== branchFilter) return false;
    if (statusFilter === "edited") { if (!r.reviewed_at || r.status === "done") return false; }
    else if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      if (!(r.cust_name||"").toLowerCase().includes(q) &&
          !(r.cust_num||"").includes(q) &&
          !(r.cust_phone||"").includes(q)) return false;
    }
    // 매출메모 vs 블리스 비교 — 차이 있는 것만 유효
    const now = new Date();
    const memoPkgs = JSON.parse(r.memo_packages||"[]");
    const blissPkgs = JSON.parse(r.bliss_packages||"[]");
    const todayStr = now.toISOString().slice(0,10);
    const isPrepaidType = (item) => {
      const t = item.type||"";
      const sn = (item.name||item.svc_name||item.pkg_type||"").toLowerCase();
      return t==="prepaid"||t==="dadam"||sn.includes("다담")||sn.includes("선불");
    };
    const normPkgName = (n) => (n||"").replace(/패키지/g,"PKG").replace(/왁패/g,"왁싱").replace(/\s+/g,"").trim().toLowerCase();
    // 매출메모 (최신만)
    const memoLatest = Object.values(memoPkgs.reduce((acc, m) => { acc[normPkgName(m.name||m.pkg_type||"")] = m; return acc; }, {}));
    const memoPkg = memoLatest.filter(m => !isPrepaidType(m));
    const memoDadamArr = memoLatest.filter(isPrepaidType);
    // 블리스
    const isBlissActive = (b) => {
      const remain = (b.total||0)-(b.used||0);
      if (remain <= 0) return false;
      const exp = parseExpiry(b.note||"");
      if (exp && exp < todayStr) return false;
      return true;
    };
    const blissPkg = blissPkgs.filter(b => !isPrepaidType(b) && isBlissActive(b));
    const blissDadamBal = blissPkgs.filter(isPrepaidType).reduce((s,b)=>{
      const m=(b.note||"").match(/잔액:([0-9,]+)/); return s+(m?Number(m[1].replace(/,/g,"")):0);
    },0);
    const memoDadamBal = memoDadamArr.reduce((s,m)=>s+(m.remaining??m.remain??0),0);
    // 패키지 매칭 비교 (이름+잔여)
    const memoMap = {}, blissMap = {};
    memoPkg.forEach(m => { const k=normPkgName(m.name||""); memoMap[k]=(memoMap[k]||0)+(m.remaining??m.remain??0); });
    blissPkg.forEach(b => { const k=normPkgName(b.svc_name||""); blissMap[k]=(blissMap[k]||0)+((b.total||0)-(b.used||0)); });
    const allKeys = new Set([...Object.keys(memoMap), ...Object.keys(blissMap)]);
    let pkgMismatch = false;
    for (const k of allKeys) { if ((memoMap[k]||0) !== (blissMap[k]||0)) { pkgMismatch = true; break; } }
    const dadamMismatch = memoDadamBal !== blissDadamBal;
    if (!pkgMismatch && !dadamMismatch && r.status !== "done") return false;
    return true;
  });

  // 활성 보유권 우선 정렬 (블리스에 활성 패키지 또는 다담 잔액>0 있는 카드가 위로)
  const todayStr2 = new Date().toISOString().slice(0,10);
  const activityScore = (r) => {
    try {
      const bliss = JSON.parse(r.bliss_packages||"[]");
      let active = 0;
      for (const b of bliss) {
        const sn = (b.svc_name||"").toLowerCase();
        const isPp = sn.includes("다담") || sn.includes("선불");
        if (isPp) {
          const m = (b.note||"").match(/잔액:([0-9,]+)/);
          if (m && Number(m[1].replace(/,/g,"")) > 0) active++;
        } else {
          const remain = (b.total||0)-(b.used||0);
          if (remain <= 0) continue;
          const em = (b.note||"").match(/유효[:\s]*(\d{4}-\d{2}-\d{2})/);
          if (em && em[1] < todayStr2) continue;
          active++;
        }
      }
      return active;
    } catch { return 0; }
  };
  const sorted = [...filtered].sort((a,b) => activityScore(b) - activityScore(a));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // 통계
  const stats = {
    total: filtered.length,
    pending: filtered.filter(r => r.status !== "done").length,
    edited: filtered.filter(r => r.reviewed_at && r.status !== "done").length,
    done: filtered.filter(r => r.status === "done").length,
    mismatch: rows.filter(r => {
      const memo = JSON.parse(r.memo_packages || "[]").filter(m => m.type === "package" && (m.remaining||0) > 0);
      const bliss = JSON.parse(r.bliss_packages || "[]").filter(b => (b.remain||0) > 0);
      return memo.length > 0 && bliss.length > 0 && memo.length !== bliss.length;
    }).length
  };

  // 상태 변경
  const handleStatusChange = async (id, status) => {
    await fetch(`${SB_URL}/rest/v1/pkg_audit?id=eq.${id}`, {
      method: "PATCH", headers: {...H, "Prefer": "return=minimal"},
      body: JSON.stringify({status, reviewed_at: new Date().toISOString()})
    });
    setRows(prev => prev.map(r => r.id === id ? {...r, status} : r));
  };

  // 메모 저장
  const handleNoteChange = async (id, note) => {
    await fetch(`${SB_URL}/rest/v1/pkg_audit?id=eq.${id}`, {
      method: "PATCH", headers: {...H, "Prefer": "return=minimal"},
      body: JSON.stringify({action_note: note})
    });
    setRows(prev => prev.map(r => r.id === id ? {...r, action_note: note} : r));
  };

  // 블리스 수정 저장
  const handleBlissSave = async (row, changes) => {
    try {
      // 삭제
      for (const id of changes.deleted) {
        await sb.del("customer_packages", id);
      }
      // 수정
      for (const upd of changes.updated) {
        const updateData = {total_count: upd.total_count, used_count: upd.used_count, service_name: upd.service_name};
        if (upd.note !== undefined) updateData.note = upd.note;
        await sb.update("customer_packages", upd.id, updateData);
      }
      // 추가
      for (const add of changes.added) {
        const newId = "cpn_" + Math.random().toString(36).slice(2, 15);
        await sb.insert("customer_packages", {...add, id: newId});
      }

      // pkg_audit의 bliss_packages 갱신
      const r = await fetch(`${SB_URL}/rest/v1/customer_packages?customer_id=eq.${row.cust_id}&select=id,service_name,total_count,used_count,note`, {headers: H});
      const fresh = await r.json();
      const newBliss = (fresh || []).map(p => ({
        id: p.id, svc_name: p.service_name, total: p.total_count || 0, used: p.used_count || 0,
        remain: (p.total_count || 0) - (p.used_count || 0), note: (p.note || "").slice(0, 100)
      }));
      const patchR = await fetch(`${SB_URL}/rest/v1/pkg_audit?id=eq.${row.id}`, {
        method: "PATCH", headers: {...H, "Prefer": "return=minimal"},
        body: JSON.stringify({bliss_packages: JSON.stringify(newBliss), reviewed_at: new Date().toISOString()})
      });
      if (!patchR.ok) console.error("pkg_audit PATCH failed:", patchR.status, await patchR.text());
      setRows(prev => prev.map(r => r.id === row.id ? {...r, bliss_packages: JSON.stringify(newBliss), reviewed_at: new Date().toISOString()} : r));
      // 저장 완료 — alert 없이 조용히
    } catch(e) {
      console.error(e);
      alert("저장 실패: " + e.message);
    }
  };

  return <div>
    {/* 헤더 */}
    <div style={{padding:"12px 0",borderBottom:"1px solid "+T.border,marginBottom:12}}>
      <div style={{fontSize:16,fontWeight:800,color:T.text,marginBottom:8}}>패키지 정리</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        {/* 지점 필터 */}
        <select value={branchFilter} onChange={e=>{setBranchFilter(e.target.value);setPage(0);}}
          style={{fontSize:11,padding:"5px 8px",borderRadius:6,border:"1px solid "+T.border}}>
          <option value="all">전체 지점</option>
          {branches.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
        {/* 상태 필터 */}
        <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(0);}}
          style={{fontSize:11,padding:"5px 8px",borderRadius:6,border:"1px solid "+T.border}}>
          <option value="all">전체 상태</option>
          <option value="pending">미확인</option>
          <option value="edited">수정됨</option>
          <option value="done">확인완료</option>
        </select>
        {/* 검색 */}
        <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setPage(0);}} placeholder="이름/번호 검색"
          style={{fontSize:11,padding:"5px 8px",borderRadius:6,border:"1px solid "+T.border,width:150}}/>
        {/* 통계 */}
        <div style={{marginLeft:"auto",fontSize:11,color:T.textMuted}}>
          전체 <b>{stats.total}</b> · 미확인 <b style={{color:"#e74c3c"}}>{stats.pending}</b> · 수정됨 <b style={{color:"#3498db"}}>{stats.edited}</b> · 완료 <b style={{color:"#27ae60"}}>{stats.done}</b>
        </div>
      </div>
    </div>

    {/* 결과 */}
    {loading ? <div style={{textAlign:"center",padding:40,color:T.gray400}}>로딩 중...</div> :
      filtered.length === 0 ? <div style={{textAlign:"center",padding:40,color:T.gray400}}>결과 없음</div> :
      <>
        <div style={{fontSize:11,color:T.textMuted,marginBottom:8}}>
          {filtered.length}명 중 {page*PAGE_SIZE+1}~{Math.min((page+1)*PAGE_SIZE, filtered.length)}
        </div>
        {paged.map(row => <AuditCard key={row.id} row={row} onStatusChange={handleStatusChange}
          onNoteChange={handleNoteChange} onBlissSave={handleBlissSave}/>)}
        {/* 페이징 */}
        {totalPages > 1 && <div style={{display:"flex",justifyContent:"center",gap:4,padding:"12px 0"}}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid "+T.border,background:"#fff",fontSize:11,cursor:page===0?"not-allowed":"pointer"}}>이전</button>
          <span style={{padding:"4px 12px",fontSize:11,color:T.textMuted}}>{page+1} / {totalPages}</span>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid "+T.border,background:"#fff",fontSize:11,cursor:page>=totalPages-1?"not-allowed":"pointer"}}>다음</button>
        </div>}
      </>
    }

    {/* 블리스 수정 모달 */}
    {/* 모달 제거 — 인라인 수정 */}
  </div>;
}
