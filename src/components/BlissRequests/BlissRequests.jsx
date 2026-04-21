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

import MarkupEditor from '../common/MarkupEditor'

function BlissRequests({ data, currentUser, userBranches, isMaster }) {
  const [tab, setTab] = useState("notices"); // notices | requests
  const [requests, setRequests] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showNoticeForm, setShowNoticeForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openNoticeId, setOpenNoticeId] = useState(null);
  // Form state
  const [form, setForm] = useState({ name: "", branchId: userBranches?.[0] || "", description: "", imageData: "" });
  const [noticeForm, setNoticeForm] = useState({ title: "", version: "", content: "", images: [] });
  const [submitting, setSubmitting] = useState(false);
  // Reply form (master only)
  const [replyText, setReplyText] = useState("");

  const loadData = async () => {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?key=in.(bliss_requests_v1,bliss_notices_v1)&select=key,value`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      });
      const rows = await r.json();
      const reqRow = rows.find(x=>x.key==='bliss_requests_v1');
      const ntcRow = rows.find(x=>x.key==='bliss_notices_v1');
      const reqList = (() => { const v=reqRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
      const ntcList = (() => { const v=ntcRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
      setRequests(Array.isArray(reqList) ? reqList.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")) : []);
      setNotices(Array.isArray(ntcList) ? ntcList.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")) : []);
    } catch (e) { console.error("Load failed:", e); }
    setLoading(false);
  };
  useEffect(() => { loadData(); }, []);

  const saveAll = async (next) => {
    setRequests(next.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "bliss_requests_v1", key: "bliss_requests_v1", value: JSON.stringify(next) })
    });
  };
  const saveNotices = async (next) => {
    setNotices(next.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    await fetch(`${SB_URL}/rest/v1/schedule_data`, {
      method: "POST", headers: H,
      body: JSON.stringify({ id: "bliss_notices_v1", key: "bliss_notices_v1", value: JSON.stringify(next) })
    });
  };
  const submitNotice = async () => {
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) { alert("제목과 내용을 입력하세요"); return; }
    const row = {
      id: genId(), title: noticeForm.title.trim(), version: noticeForm.version.trim(),
      content: noticeForm.content.trim(),
      images: Array.isArray(noticeForm.images) ? noticeForm.images : [],
      createdAt: new Date().toISOString(),
      author: currentUser?.name || "관리자",
    };
    await saveNotices([row, ...notices]);
    setNoticeForm({ title:"", version:"", content:"", images:[] });
    setShowNoticeForm(false);
  };
  const removeNotice = async (id) => {
    if (!confirm("이 공지를 삭제할까요?")) return;
    await saveNotices(notices.filter(n => n.id !== id));
    if (openNoticeId === id) setOpenNoticeId(null);
  };

  // 공지용 이미지 — 여러 장 첨부 가능 (각 2MB 이하, 총 6장까지 권장)
  const onNoticeImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      if (file.size > 2 * 1024 * 1024) { alert(`"${file.name}" 2MB 초과 — 건너뜀`); return; }
      const reader = new FileReader();
      reader.onload = (ev) => setNoticeForm(p => ({ ...p, images: [...(p.images||[]), ev.target.result] }));
      reader.readAsDataURL(file);
    });
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
  };
  const onNoticePasteImage = (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type?.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 2 * 1024 * 1024) { alert("붙여넣은 이미지가 2MB를 초과합니다"); continue; }
        const reader = new FileReader();
        reader.onload = (ev) => setNoticeForm(p => ({ ...p, images: [...(p.images||[]), ev.target.result] }));
        reader.readAsDataURL(file);
      }
    }
  };
  const removeNoticeImage = (idx) => {
    setNoticeForm(p => ({ ...p, images: (p.images||[]).filter((_, i) => i !== idx) }));
  };
  // 마킹 에디터 상태 — 공지 폼: {idx} / 수정요청 폼: boolean / 등록된 공지 수정: {noticeId, idx}
  const [markupIdx, setMarkupIdx] = useState(null);
  const [reqMarkupOpen, setReqMarkupOpen] = useState(false);
  const [existingMarkup, setExistingMarkup] = useState(null); // {noticeId, idx}

  // 등록된 공지 이미지 마킹 저장
  const saveExistingNoticeImage = async (noticeId, imgIdx, newB64) => {
    const next = notices.map(n => {
      if (n.id !== noticeId) return n;
      const imgs = Array.isArray(n.images) ? [...n.images] : (n.imageData ? [n.imageData] : []);
      imgs[imgIdx] = newB64;
      return { ...n, images: imgs };
    });
    await saveNotices(next);
    setExistingMarkup(null);
  };
  // 등록된 공지 이미지 삭제
  const removeExistingNoticeImage = async (noticeId, imgIdx) => {
    if (!confirm("이 이미지를 삭제할까요?")) return;
    const next = notices.map(n => {
      if (n.id !== noticeId) return n;
      const imgs = Array.isArray(n.images) ? [...n.images] : (n.imageData ? [n.imageData] : []);
      imgs.splice(imgIdx, 1);
      return { ...n, images: imgs };
    });
    await saveNotices(next);
  };
  const replaceNoticeImage = (idx, newB64) => {
    setNoticeForm(p => ({ ...p, images: (p.images||[]).map((img, i) => i === idx ? newB64 : img) }));
    setMarkupIdx(null);
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
    // 텔레그램 알림 (Edge Function 호출, 실패해도 UX 영향 없음)
    try {
      const brName = form.branchId ? branchName(form.branchId) : "";
      fetch(`${SB_URL}/functions/v1/notify-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
        body: JSON.stringify({ name: newReq.name, description: newReq.description, branch: brName }),
      }).catch(() => {});
    } catch (e) {}
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
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <div>
        <h2 style={{margin:0,fontSize:22,fontWeight:T.fw.black,color:T.text}}>📢 공지 & 요청</h2>
        <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:3}}>새 기능·업데이트 안내 및 개선 요청</div>
      </div>
      {tab === "requests" && <button onClick={()=>setShowForm(true)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="plus" size={14}/> 새 요청
      </button>}
      {tab === "notices" && isMaster && <button onClick={()=>setShowNoticeForm(true)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:"#7C3AED",color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="plus" size={14}/> 새 공지
      </button>}
    </div>
    {/* 탭 */}
    <div style={{display:"flex",gap:0,borderBottom:`2px solid ${T.border}`,marginBottom:18}}>
      {[["notices",`📢 공지사항 (${notices.length})`],["requests",`📝 수정 요청 (${requests.length})`]].map(([k,l])=>(
        <button key={k} onClick={()=>setTab(k)}
          style={{padding:"10px 18px",fontSize:13,fontWeight:700,border:"none",background:"transparent",
            color: tab===k ? T.primary : T.textSub,
            borderBottom: tab===k ? `3px solid ${T.primary}` : "3px solid transparent",
            marginBottom:-2, cursor:"pointer", fontFamily:"inherit"}}>{l}</button>
      ))}
    </div>
    {/* 공지사항 */}
    {tab==="notices" && <>
      {showNoticeForm && <div onPaste={onNoticePasteImage} style={{background:"#F5F3FF",border:"1.5px solid #C4B5FD",borderRadius:12,padding:18,marginBottom:18}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#5B21B6",marginBottom:12}}>📢 새 공지 작성</div>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <input value={noticeForm.title} onChange={e=>setNoticeForm(p=>({...p,title:e.target.value}))} placeholder="제목 *"
            style={{flex:1,padding:"9px 12px",fontSize:13,border:"1.5px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
          <input value={noticeForm.version} onChange={e=>setNoticeForm(p=>({...p,version:e.target.value}))} placeholder="버전 (예: v3.5.20)"
            style={{width:160,padding:"9px 12px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
        </div>
        <textarea value={noticeForm.content} onChange={e=>setNoticeForm(p=>({...p,content:e.target.value}))}
          onPaste={onNoticePasteImage}
          placeholder="내용 * (줄바꿈·- 리스트 등 자유 · 캡쳐 이미지는 Ctrl+V로 바로 붙여넣기 가능)"
          style={{width:"100%",padding:"9px 12px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit",resize:"vertical",minHeight:140,boxSizing:"border-box",marginBottom:8}}/>
        {/* 이미지 첨부 영역 */}
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <label style={{padding:"6px 12px",fontSize:12,fontWeight:700,borderRadius:6,border:"1px dashed #8B5CF6",background:"#fff",color:"#5B21B6",cursor:"pointer",fontFamily:"inherit"}}>
            📷 이미지 첨부
            <input type="file" accept="image/*" multiple onChange={onNoticeImagePick} style={{display:"none"}}/>
          </label>
          <span style={{fontSize:10,color:T.textMuted}}>여러 장 가능 · 각 2MB 이하 · Ctrl+V로 붙여넣기 OK</span>
        </div>
        {(noticeForm.images||[]).length > 0 && <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {noticeForm.images.map((img, i) => (
            <div key={i} style={{position:"relative",border:"1px solid "+T.border,borderRadius:6,overflow:"hidden",background:"#fff"}}>
              <img src={img} alt={`첨부${i+1}`} style={{display:"block",height:80,maxWidth:140,objectFit:"cover"}}/>
              <button onClick={()=>setMarkupIdx(i)} title="마킹 편집"
                style={{position:"absolute",top:2,left:2,padding:"2px 6px",borderRadius:4,border:"none",background:"rgba(124,58,237,.9)",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",lineHeight:1,fontFamily:"inherit"}}>✏️ 편집</button>
              <button onClick={()=>removeNoticeImage(i)} title="제거"
                style={{position:"absolute",top:2,right:2,width:20,height:20,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.7)",color:"#fff",fontSize:12,cursor:"pointer",lineHeight:1,padding:0,fontFamily:"inherit"}}>×</button>
            </div>
          ))}
        </div>}
        {markupIdx !== null && <MarkupEditor
          open={true}
          imageSrc={noticeForm.images[markupIdx]}
          onSave={(newB64)=>replaceNoticeImage(markupIdx, newB64)}
          onClose={()=>setMarkupIdx(null)}
        />}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>{setShowNoticeForm(false); setNoticeForm({title:"",version:"",content:"",images:[]});}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
          <button onClick={submitNotice} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#7C3AED",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>등록</button>
        </div>
      </div>}
      {/* 등록된 공지 이미지 마킹 편집 모달 */}
      {existingMarkup && (() => {
        const n = notices.find(x => x.id === existingMarkup.noticeId);
        const imgs = n ? (Array.isArray(n.images) ? n.images : (n.imageData ? [n.imageData] : [])) : [];
        const img = imgs[existingMarkup.idx];
        if (!img) { setExistingMarkup(null); return null; }
        return <MarkupEditor
          open={true}
          imageSrc={img}
          onSave={(newB64) => saveExistingNoticeImage(existingMarkup.noticeId, existingMarkup.idx, newB64)}
          onClose={() => setExistingMarkup(null)}
        />;
      })()}
      {notices.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:T.textMuted,fontSize:14,background:T.bgCard,borderRadius:12,border:"1px solid "+T.border}}>
          공지사항이 없습니다.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {notices.map(n => {
            const isOpen = openNoticeId === n.id;
            // 과거 데이터 호환 — imageData(단일) 또는 images(배열) 모두 지원
            const imgs = Array.isArray(n.images) ? n.images : (n.imageData ? [n.imageData] : []);
            return <div key={n.id} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:12,overflow:"hidden"}}>
              <div onClick={()=>setOpenNoticeId(isOpen?null:n.id)} style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:10,background:"#F5F3FF",color:"#5B21B6",whiteSpace:"nowrap"}}>📢 공지</span>
                {n.version && <span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:T.gray100,color:T.textSub,fontFamily:"monospace",fontWeight:700}}>{n.version}</span>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:T.fw.bolder,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {n.title}{imgs.length > 0 && <span style={{marginLeft:6,fontSize:11,color:"#5B21B6"}}>📷 {imgs.length}</span>}
                  </div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{n.author||"관리자"} · {fmtDate(n.createdAt)}</div>
                </div>
                <I name={isOpen?"chevD":"chevR"} size={14} color={T.gray400}/>
              </div>
              {isOpen && <div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
                <div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:"pre-wrap",padding:"12px 0"}}>{n.content}</div>
                {imgs.length > 0 && <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
                  {imgs.map((img, i) => (
                    <div key={i} style={{position:"relative",display:"inline-block"}}>
                      <img src={img} alt={`공지${i+1}`}
                        onClick={()=>window.open(img,'_blank')}
                        style={{maxWidth:"100%",maxHeight:600,borderRadius:8,border:"1px solid "+T.border,cursor:"zoom-in",display:"block"}}/>
                      {isMaster && <div style={{position:"absolute",top:8,right:8,display:"flex",gap:4}}>
                        <button onClick={(e)=>{e.stopPropagation(); setExistingMarkup({noticeId: n.id, idx: i});}}
                          title="이미지 마킹 편집"
                          style={{padding:"4px 10px",borderRadius:6,border:"none",background:"rgba(124,58,237,0.95)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 6px rgba(0,0,0,0.3)"}}>
                          ✏️ 편집
                        </button>
                        <button onClick={(e)=>{e.stopPropagation(); removeExistingNoticeImage(n.id, i);}}
                          title="이미지 삭제"
                          style={{padding:"4px 10px",borderRadius:6,border:"none",background:"rgba(220,38,38,0.95)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 6px rgba(0,0,0,0.3)"}}>
                          🗑 삭제
                        </button>
                      </div>}
                    </div>
                  ))}
                </div>}
                {isMaster && <button onClick={()=>removeNotice(n.id)}
                  style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.danger+"66",background:"#fff5f5",color:T.danger,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  공지 전체 삭제
                </button>}
              </div>}
            </div>;
          })}
        </div>
      )}
    </>}
    {tab==="requests" && <>


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
          <button onClick={()=>setReqMarkupOpen(true)} title="마킹 편집"
            style={{padding:"4px 10px",borderRadius:6,border:"none",background:"#7C3AED",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✏️ 편집</button>
          <button onClick={()=>setForm(p=>({...p,imageData:""}))} style={{border:"none",background:"none",color:T.danger,cursor:"pointer",fontSize:14}}>×</button>
        </div>}
      </div>
      {reqMarkupOpen && form.imageData && <MarkupEditor
        open={true}
        imageSrc={form.imageData}
        onSave={(newB64)=>{ setForm(p=>({...p,imageData:newB64})); setReqMarkupOpen(false); }}
        onClose={()=>setReqMarkupOpen(false)}
      />}
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
    </>}
  </div>;
}

export default BlissRequests
