import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb, buildTokenSearch } from '../../lib/sb'
import { fromDb, _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'

// 고객 검색·추가 모달 — 쉐어 고객 추가 / 커플 패키지 상대방 선택에 공용
export function ShareCustModal({ baseCust, existingShareIds = [], onPick, onClose, setData, titleLabel = "쉐어 추가" }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newGender, setNewGender] = useState("");
  const [creating, setCreating] = useState(false);
  const downOnOverlayRef = React.useRef(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const cond = buildTokenSearch(q.trim(), ["name","name2","phone","phone2","email","memo","cust_num"]);
        const rows = await sb.get("customers", `&business_id=eq.${_activeBizId}${cond}&limit=200`);
        setResults(fromDb("customers", rows||[]));
      } catch(e) { console.warn("share search fail", e); setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const filteredResults = results.filter(c => c.id !== baseCust.id && !existingShareIds.includes(c.id));
  const showNewForm = q.trim().length >= 2 && filteredResults.length === 0;

  // 검색어에서 이름(한글)/전화(숫자) 자동 파싱 → 신규등록 폼 프리필
  useEffect(() => {
    if (!showNewForm) return;
    const tokens = q.trim().split(/\s+/);
    const nameTok = tokens.find(t => /[가-힣]/.test(t));
    const phoneTok = tokens.find(t => /^[\d-]{3,}$/.test(t));
    if (nameTok && !newName) setNewName(nameTok);
    if (phoneTok && !newPhone) setNewPhone(phoneTok);
  }, [showNewForm, q]);

  const createNew = async () => {
    if (!newName.trim()) { alert("이름을 입력하세요"); return; }
    setCreating(true);
    try {
      const id = genId('cust');
      const phoneVal = newPhone.trim() || ("no_phone_"+id.slice(-6));
      const row = {
        id, business_id: _activeBizId,
        name: newName.trim(), phone: phoneVal, gender: newGender||null,
        sms_consent: true, is_hidden: false,
      };
      await sb.insert("customers", row);
      const parsed = fromDb("customers", [row])[0];
      if (setData) setData(p => p ? {...p, customers: [parsed, ...(p.customers||[])]} : p);
      onPick(parsed);
    } catch(e) { alert("신규 등록 실패: "+e.message); }
    setCreating(false);
  };

  return <div
    onMouseDown={e=>{downOnOverlayRef.current=(e.target===e.currentTarget);}}
    onClick={e=>{if(downOnOverlayRef.current && e.target===e.currentTarget)onClose(); downOnOverlayRef.current=false;}}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,width:"100%",maxWidth:460,boxShadow:"0 12px 40px rgba(0,0,0,.25)",overflow:"hidden"}}>
      <div style={{padding:"14px 16px",borderBottom:"1px solid "+T.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <strong style={{fontSize:14,color:"#5B21B6",display:"inline-flex",alignItems:"center",gap:5}}><I name="users" size={14}/> {titleLabel} — {baseCust?.name}</strong>
        <button onClick={onClose} style={{border:"none",background:"none",fontSize:20,cursor:"pointer",color:T.textMuted}}>×</button>
      </div>
      <div style={{padding:14}}>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·전화·고객번호 (공백으로 여러 조건)"
          style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
        <div style={{marginTop:10,maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {q.trim().length < 2 && <div style={{fontSize:11,color:T.textMuted,textAlign:"center",padding:20}}>검색어 2자 이상 입력 (예: "권신영 8008")</div>}
          {filteredResults.map(c => (
            <button key={c.id} onClick={()=>onPick(c)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",border:"1px solid "+T.border,borderRadius:8,background:"#fff",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
              {(() => {
                // 영문 이름이면 한글 음역(name_kor)만 인라인 표시. name2는 직원 별칭용이라 음역 fallback으로 쓰지 않음.
                const _isEn = c.name && !/[가-힣]/.test(c.name);
                const _kor = _isEn && c.name_kor && /[가-힣]/.test(c.name_kor) ? c.name_kor : '';
                return <span style={{fontSize:12,fontWeight:700,color:T.text,flex:1}}>
                  {c.name}
                  {_kor && <span style={{color:T.primaryDk||"#5B21B6",fontWeight:700,marginLeft:5}}>{_kor}</span>}
                  {c.name2 ? <span style={{color:T.textSub,fontWeight:500,marginLeft:4}}>({c.name2})</span> : null}
                </span>;
              })()}
              {c.cust_num && <span style={{fontSize:10,color:T.textMuted,fontFamily:"monospace"}}>#{c.cust_num}</span>}
              {c.phone && !c.phone.startsWith("no_phone") && <span style={{fontSize:11,color:T.textSub}}>{c.phone}</span>}
            </button>
          ))}
        </div>
        {showNewForm && (
          <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+T.border}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5B21B6",marginBottom:8}}>🔎 검색 결과 없음 — 바로 신규 등록</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="이름 *"
                style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
              <input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="연락처 (선택)"
                style={{width:"100%",padding:"8px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",boxSizing:"border-box"}}/>
              <div style={{display:"flex",gap:6}}>
                {[["","?"],["F","여"],["M","남"]].map(([v,l])=>(
                  <button key={v} type="button" onClick={()=>setNewGender(v)}
                    style={{flex:1,padding:"6px",fontSize:12,fontWeight:700,borderRadius:6,border:"1px solid "+(newGender===v?"#8B5CF6":T.border),background:newGender===v?"#F5F3FF":"#fff",color:newGender===v?"#5B21B6":T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
                ))}
              </div>
              <button onClick={createNew} disabled={creating||!newName.trim()}
                style={{padding:"10px",fontSize:13,fontWeight:700,borderRadius:8,border:"none",background:(creating||!newName.trim())?T.gray300:"#8B5CF6",color:"#fff",cursor:(creating||!newName.trim())?"default":"pointer",fontFamily:"inherit",marginTop:4}}>
                {creating?"등록 중...":"신규 등록 후 선택"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>;
}

export default ShareCustModal
