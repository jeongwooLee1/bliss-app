import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { genId } from '../../lib/utils'
import I from '../common/I'

const STATUS = {
  pending:  { label: "검토 대기", color: "#F59E0B", bg: "#FEF3C7" },
  reviewing:{ label: "검토 중",   color: "#3B82F6", bg: "#DBEAFE" },
  done:     { label: "처리 완료", color: "#10B981", bg: "#D1FAE5" },
  rejected: { label: "보류",      color: "#6B7280", bg: "#F3F4F6" },
};

function BlissRequests({ data, currentUser, userBranches, isMaster }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  // Form state
  const [form, setForm] = useState({ name: "", branchId: userBranches?.[0] || "", description: "", imageData: "" });
  const [submitting, setSubmitting] = useState(false);
  // Reply form (master only)
  const [replyText, setReplyText] = useState("");

  // 데이터 로드 (schedule_data 활용)
  const loadRequests = async () => {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=eq.bliss_requests_v1&select=value`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      });
      const rows = await r.json();
      const v = rows?.[0]?.value;
      const list = typeof v === "string" ? JSON.parse(v) : (Array.isArray(v) ? v : []);
      setRequests(Array.isArray(list) ? list.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")) : []);
    } catch (e) { console.error("Load failed:", e); }
    setLoading(false);
  };
  useEffect(() => { loadRequests(); }, []);

  const saveAll = async (next) => {
    setRequests(next.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "bliss_requests_v1", key: "bliss_requests_v1", value: JSON.stringify(next) })
    });
  };

  // 이미지 → base64 (간단한 미리보기/저장용, 1MB 이하 권장)
  const onImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("이미지 크기 2MB 이하로 업로드해주세요"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setForm(p => ({ ...p, imageData: ev.target.result }));
    reader.readAsDataURL(file);
  };

  // 클립보드 이미지 붙여넣기 — Ctrl+V / Cmd+V
  const onPasteImage = (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        const file = it.getAsFile();
        if (!file) continue;
        if (file.size > 2 * 1024 * 1024) { alert("이미지 크기 2MB 이하만 붙여넣기 가능합니다"); return; }
        const reader = new FileReader();
        reader.onload = (ev) => setForm(p => ({ ...p, imageData: ev.target.result }));
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const submit = async () => {
    if (!form.name.trim()) { alert("요청자 이름을 입력해주세요"); return; }
    if (!form.description.trim()) { alert("내용을 입력해주세요"); return; }
    setSubmitting(true);
    const newReq = {
      id: genId(), name: form.name.trim(), branchId: form.branchId || "",
      description: form.description.trim(),
      imageData: form.imageData || "",
      status: "pending", reply: "",
      createdAt: new Date().toISOString(),
    };
    const next = [newReq, ...requests];
    await saveAll(next);
    setForm({ name: "", branchId: userBranches?.[0] || "", description: "", imageData: "" });
    setShowForm(false);
    setSubmitting(false);
  };

  const updateStatus = async (id, status) => {
    const next = requests.map(r => r.id === id ? { ...r, status } : r);
    await saveAll(next);
  };

  const saveReply = async (id) => {
    if (!replyText.trim()) return;
    const next = requests.map(r => r.id === id ? { ...r, reply: replyText.trim(), status: r.status === "pending" ? "reviewing" : r.status } : r);
    await saveAll(next);
    setReplyText("");
  };

  const removeReq = async (id) => {
    if (!confirm("이 요청을 삭제할까요?")) return;
    await saveAll(requests.filter(r => r.id !== id));
    if (openId === id) setOpenId(null);
  };

  const branchName = (bid) => (data?.branches || []).find(b => b.id === bid)?.short || (data?.branches || []).find(b => b.id === bid)?.name || "";
  const fmtDate = (iso) => { try { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch { return ""; } };

  if (loading) return <div style={{padding:40,textAlign:"center",color:T.textMuted}}>로딩 중...</div>;

  return <div style={{padding:"16px 20px",maxWidth:900,margin:"0 auto"}}>
    {/* 헤더 */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
      <div>
        <h2 style={{margin:0,fontSize:22,fontWeight:T.fw.black,color:T.text}}>📝 블리스 수정 요청</h2>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:3}}>개선 사항·버그·새 기능 제안을 자유롭게 작성하세요</div>
      </div>
      <button onClick={()=>setShowForm(true)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="plus" size={14}/> 새 요청
      </button>
    </div>

    {/* 작성 폼 */}
    {showForm && <div onPaste={onPasteImage} style={{background:"#FFFBEB",border:"1.5px solid #FCD34D",borderRadius:12,padding:18,marginBottom:18}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#B45309",marginBottom:12}}>새 요청 작성</div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="✏️ 요청자 이름을 입력하세요 *"
          style={{flex:1,padding:"9px 12px",fontSize:13,border:"1.5px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
        {(data?.branches||[]).filter(b=>userBranches.includes(b.id)).length > 0 &&
          <select value={form.branchId} onChange={e=>setForm(p=>({...p,branchId:e.target.value}))}
            style={{width:140,padding:"9px 12px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}>
            <option value="">지점 선택</option>
            {(data?.branches||[]).filter(b=>userBranches.includes(b.id)).map(b=><option key={b.id} value={b.id}>{b.short||b.name}</option>)}
          </select>}
      </div>
      <textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} onPaste={onPasteImage} placeholder="요청 내용 — 어떤 부분이 불편하거나 어떤 기능을 원하시는지 자유롭게 작성해주세요 * (캡쳐 이미지는 Ctrl+V로 바로 붙여넣기 가능)"
        style={{width:"100%",padding:"9px 12px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",resize:"vertical",minHeight:120,boxSizing:"border-box",marginBottom:8}}/>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
        <label style={{padding:"7px 14px",borderRadius:8,border:"1px dashed "+T.gray400,background:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,color:T.gray600,display:"inline-flex",alignItems:"center",gap:5}}>
          <I name="image" size={12}/> 사진 첨부 (선택)
          <input type="file" accept="image/*" onChange={onImagePick} style={{display:"none"}}/>
        </label>
        {form.imageData && <div style={{display:"flex",alignItems:"center",gap:6}}>
          <img src={form.imageData} alt="preview" style={{height:40,borderRadius:6,border:"1px solid "+T.border}}/>
          <button onClick={()=>setForm(p=>({...p,imageData:""}))} style={{border:"none",background:"none",color:T.danger,cursor:"pointer",fontSize:14}}>×</button>
        </div>}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setShowForm(false)} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
        <button onClick={submit} disabled={submitting} style={{padding:"8px 18px",borderRadius:8,border:"none",background:submitting?T.gray400:T.primary,color:"#fff",fontSize:13,fontWeight:700,cursor:submitting?"wait":"pointer",fontFamily:"inherit"}}>{submitting?"저장 중...":"등록"}</button>
      </div>
    </div>}

    {/* 요청 목록 */}
    {requests.length === 0 ? (
      <div style={{textAlign:"center",padding:60,color:T.textMuted,fontSize:14,background:T.bgCard,borderRadius:12,border:"1px solid "+T.border}}>
        아직 등록된 요청이 없습니다. 첫 번째 요청을 작성해주세요!
      </div>
    ) : (
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {requests.map(r => {
          const st = STATUS[r.status] || STATUS.pending;
          const isOpen = openId === r.id;
          return <div key={r.id} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:12,overflow:"hidden"}}>
            <div onClick={()=>setOpenId(isOpen?null:r.id)} style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:10,background:st.bg,color:st.color,whiteSpace:"nowrap"}}>{st.label}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:T.fw.bolder,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  <span style={{color:T.primary,marginRight:6}}>{r.name}</span>
                  {(r.description||"").split("\n")[0].slice(0,60)}
                </div>
                <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>
                  {r.branchId ? branchName(r.branchId) + " · " : ""}{fmtDate(r.createdAt)}
                  {r.imageData && " · 📷"}
                  {r.reply && " · 💬 답변있음"}
                </div>
              </div>
              <I name={isOpen?"chevD":"chevR"} size={14} color={T.gray400}/>
            </div>
            {isOpen && <div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
              <div style={{fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",padding:"12px 0"}}>{r.description}</div>
              {r.imageData && <img src={r.imageData} alt="첨부" style={{maxWidth:"100%",maxHeight:400,borderRadius:8,border:"1px solid "+T.border,marginTop:6}}/>}
              {r.reply && <div style={{marginTop:12,padding:"10px 14px",background:T.primaryLt||"#EEF2FF",borderRadius:8,borderLeft:"3px solid "+T.primary}}>
                <div style={{fontSize:11,fontWeight:T.fw.bolder,color:T.primary,marginBottom:4}}>💬 답변</div>
                <div style={{fontSize:13,color:T.text,whiteSpace:"pre-wrap"}}>{r.reply}</div>
              </div>}
              {/* 관리자 전용: 상태 변경 + 답변 */}
              {isMaster && <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+T.gray100}}>
                <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                  {Object.entries(STATUS).map(([key, info]) => (
                    <button key={key} onClick={()=>updateStatus(r.id, key)}
                      style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+(r.status===key?info.color:T.border),background:r.status===key?info.bg:"#fff",color:r.status===key?info.color:T.textSub,fontSize:11,fontWeight:r.status===key?700:500,cursor:"pointer",fontFamily:"inherit"}}>{info.label}</button>
                  ))}
                  <button onClick={()=>removeReq(r.id)} style={{marginLeft:"auto",padding:"4px 10px",borderRadius:6,border:"1px solid "+T.danger+"66",background:"#fff5f5",color:T.danger,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>삭제</button>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <input value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder={r.reply?"답변 수정...":"답변 작성..."}
                    style={{flex:1,padding:"7px 10px",fontSize:12,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit"}}/>
                  <button onClick={()=>saveReply(r.id)} disabled={!replyText.trim()} style={{padding:"7px 14px",borderRadius:6,border:"none",background:replyText.trim()?T.primary:T.gray300,color:"#fff",fontSize:12,fontWeight:700,cursor:replyText.trim()?"pointer":"not-allowed",fontFamily:"inherit"}}>등록</button>
                </div>
              </div>}
            </div>}
          </div>;
        })}
      </div>
    )}
  </div>;
}

export default BlissRequests
