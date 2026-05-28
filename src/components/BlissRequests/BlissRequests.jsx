import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, SB_KEY } from '../../lib/sb'
import { uploadImageToStorage } from '../../lib/supabase'
import { _activeBizId } from '../../lib/db'
import { genId } from '../../lib/utils'
import I from '../common/I'

const STATUS = {
  pending:  { label: "검토 대기", color: "#F59E0B", bg: "#FEF3C7" },
  reviewing:{ label: "검토 중",   color: "#3B82F6", bg: "#DBEAFE" },
  done:     { label: "처리 완료", color: "#10B981", bg: "#D1FAE5" },
  rejected: { label: "보류",      color: "#6B7280", bg: "#F3F4F6" },
};

import MarkupEditor from '../common/MarkupEditor'
import OffRequestCard from './OffRequestCard'

function BlissRequests({ data, currentUser, userBranches, isMaster }) {
  const [tab, setTab] = useState("notices"); // notices | requests
  const [requests, setRequests] = useState([]);
  const [notices, setNotices] = useState([]);
  const [employees, setEmployees] = useState([]); // employees_v1 (확인 명단용)
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showNoticeForm, setShowNoticeForm] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState(null); // null = 신규, 그 외 = 편집 중인 공지 id
  const [openId, setOpenId] = useState(null);
  const [openNoticeId, setOpenNoticeId] = useState(null);
  // Form state
  const [form, setForm] = useState({ name: "", branchId: userBranches?.[0] || "", description: "", images: [] });
  const [noticeForm, setNoticeForm] = useState({ title: "", version: "", content: "", images: [] });
  const [showOffForm, setShowOffForm] = useState(false);
  const [offForm, setOffForm] = useState({ title: "", start: "", end: "", maxPicks: 2, exclude: [], excludeInput: "" });
  const [submitting, setSubmitting] = useState(false);
  // Reply form (master only)
  const [replyText, setReplyText] = useState("");
  // 요청 본문(description) 인라인 편집
  const [editingDescId, setEditingDescId] = useState(null);
  const [editingDescText, setEditingDescText] = useState("");

  const loadData = async () => {
    try {
      if (!_activeBizId) { setLoading(false); return; }
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=in.(bliss_requests_v1,bliss_notices_v1,employees_v1)&select=key,value`, {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      });
      const rows = await r.json();
      const reqRow = rows.find(x=>x.key==='bliss_requests_v1');
      const ntcRow = rows.find(x=>x.key==='bliss_notices_v1');
      const empRow = rows.find(x=>x.key==='employees_v1');
      const reqList = (() => { const v=reqRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
      const ntcList = (() => { const v=ntcRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
      const empList = (() => { const v=empRow?.value; return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:[]); })();
      setRequests(Array.isArray(reqList) ? reqList.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")) : []);
      setNotices(Array.isArray(ntcList) ? ntcList.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")) : []);
      // 확인 명단 — 정규 출근 직원만 (프리랜서·근무표 제외 직원 필터)
      const filteredEmps = (Array.isArray(empList) ? empList : []).filter(e => {
        if (!e) return false;
        if (e.isFreelancer) return false;
        if (e.excludeFromSchedule) return false;
        if (typeof e.id === 'string' && e.id.startsWith('fl_')) return false;
        return true;
      });
      setEmployees(filteredEmps);
    } catch (e) { console.error("Load failed:", e); }
    setLoading(false);
  };
  useEffect(() => { loadData(); }, []);

  const saveAll = async (next) => {
    if (!_activeBizId) throw new Error('activeBizId not set');
    setRequests(next.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
      method: "POST", headers: H,
      body: JSON.stringify({ business_id: _activeBizId, id: "bliss_requests_v1", key: "bliss_requests_v1", value: JSON.stringify(next) })
    });
  };
  const saveNotices = async (next) => {
    if (!_activeBizId) throw new Error('activeBizId not set');
    setNotices(next.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
    const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
    await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
      method: "POST", headers: H,
      body: JSON.stringify({ business_id: _activeBizId, id: "bliss_notices_v1", key: "bliss_notices_v1", value: JSON.stringify(next) })
    });
  };
  const submitNotice = async () => {
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) { alert("제목과 내용을 입력하세요"); return; }
    if (editingNoticeId) {
      // 편집 모드 — 기존 공지 업데이트 (acks/createdAt 등 보존)
      const next = notices.map(n => n.id !== editingNoticeId ? n : ({
        ...n,
        title: noticeForm.title.trim(),
        version: noticeForm.version.trim(),
        content: noticeForm.content.trim(),
        images: Array.isArray(noticeForm.images) ? noticeForm.images : [],
        editedAt: new Date().toISOString(),
        editedBy: currentUser?.name || "관리자",
      }));
      await saveNotices(next);
    } else {
      // 신규 등록
      const row = {
        id: genId(), title: noticeForm.title.trim(), version: noticeForm.version.trim(),
        content: noticeForm.content.trim(),
        images: Array.isArray(noticeForm.images) ? noticeForm.images : [],
        createdAt: new Date().toISOString(),
        author: currentUser?.name || "관리자",
      };
      await saveNotices([row, ...notices]);
    }
    setNoticeForm({ title:"", version:"", content:"", images:[] });
    setShowNoticeForm(false);
    setEditingNoticeId(null);
  };
  const startEditNotice = (n) => {
    setNoticeForm({
      title: n.title || "",
      version: n.version || "",
      content: n.content || "",
      images: Array.isArray(n.images) ? [...n.images] : (n.imageData ? [n.imageData] : []),
    });
    setEditingNoticeId(n.id);
    setShowNoticeForm(true);
    // 폼 위치로 스크롤
    setTimeout(() => window.scrollTo({ top:0, behavior:'smooth' }), 50);
  };
  const removeNotice = async (id) => {
    if (!confirm("이 공지를 삭제할까요?")) return;
    await saveNotices(notices.filter(n => n.id !== id));
    if (openNoticeId === id) setOpenNoticeId(null);
  };
  // ── 휴무 신청 (공지에 얹는 특수 글) ──
  const submitOffRequest = async () => {
    if (!offForm.start || !offForm.end) { alert("기간(시작일·종료일)을 입력하세요"); return; }
    if (offForm.end < offForm.start) { alert("종료일이 시작일보다 빠릅니다"); return; }
    const row = {
      id: genId(), kind: "off_request",
      title: offForm.title.trim() || `휴무 신청 (${offForm.start}~${offForm.end})`,
      createdAt: new Date().toISOString(), author: currentUser?.name || "관리자",
      offReq: { start: offForm.start, end: offForm.end, exclude: offForm.exclude || [], maxPicks: Number(offForm.maxPicks) || 2, picks: {}, status: "open" },
    };
    await saveNotices([row, ...notices]);
    setOffForm({ title: "", start: "", end: "", maxPicks: 2, exclude: [], excludeInput: "" });
    setShowOffForm(false);
    setOpenNoticeId(row.id);
  };
  const updateOffNotice = async (updated) => {
    await saveNotices(notices.map(n => n.id === updated.id ? updated : n));
  };
  const confirmOffRequest = async (notice) => {
    const oq = notice.offReq || {};
    try {
      const r = await fetch(`${SB_URL}/rest/v1/schedule_data?business_id=eq.${_activeBizId}&key=eq.schHistory_v1&select=value`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } });
      const rows = await r.json();
      const raw = rows?.[0]?.value;
      const sch = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      Object.entries(oq.picks || {}).forEach(([empId, p]) => {
        if (!p || p.none) return;
        (p.dates || []).forEach(date => {
          const mk = date.slice(0, 7);
          if (!sch[mk]) sch[mk] = {};
          if (!sch[mk][empId]) sch[mk][empId] = {};
          sch[mk][empId][date] = "휴무(꼭)";
        });
      });
      const H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
      await fetch(`${SB_URL}/rest/v1/schedule_data?on_conflict=business_id,key`, {
        method: "POST", headers: H,
        body: JSON.stringify({ business_id: _activeBizId, id: "schHistory_v1", key: "schHistory_v1", value: JSON.stringify(sch), updated_at: new Date().toISOString() })
      });
      const updated = { ...notice, offReq: { ...oq, status: "confirmed", confirmedAt: new Date().toISOString(), confirmedBy: currentUser?.name || "관리자" } };
      await saveNotices(notices.map(n => n.id === notice.id ? updated : n));
      alert("근무표에 휴무(꼭)로 반영했어요. 직원 근무표에서 확인하세요.");
    } catch (e) {
      console.error("[off confirm]", e);
      alert("근무표 반영 실패: " + (e?.message || e));
    }
  };
  // 공지 확인 토글 — 클릭 시 ack 추가/해제 (확인 안 한 상태면 ISO 저장, 이미 확인한 상태면 제거)
  const ackNotice = async (noticeId, empName) => {
    const nowIso = new Date().toISOString();
    const next = notices.map(n => {
      if (n.id !== noticeId) return n;
      const acks = { ...(n.acks||{}) };
      if (acks[empName]) {
        delete acks[empName]; // 이미 확인 → 해제
      } else {
        acks[empName] = nowIso; // 미확인 → 확인 처리
      }
      return { ...n, acks };
    });
    await saveNotices(next);
  };

  // 공지 댓글 — 추가/삭제 (작성자 본인 또는 마스터만 삭제)
  const [commentDrafts, setCommentDrafts] = useState({});
  const addComment = async (noticeId) => {
    const txt = (commentDrafts[noticeId] || "").trim();
    if (!txt) return;
    const cm = { id: "cm_" + Math.random().toString(36).slice(2, 10), name: currentUser?.name || "직원", text: txt, createdAt: new Date().toISOString() };
    const next = notices.map(n => n.id === noticeId ? { ...n, comments: [...(n.comments || []), cm] } : n);
    setCommentDrafts(p => ({ ...p, [noticeId]: "" }));
    await saveNotices(next);
  };
  const removeComment = async (noticeId, cmId) => {
    if (!window.confirm("이 댓글을 삭제할까요?")) return;
    const next = notices.map(n => n.id === noticeId ? { ...n, comments: (n.comments || []).filter(c => c.id !== cmId) } : n);
    await saveNotices(next);
  };

  // 공지용 이미지 — 여러 장 첨부 가능 (각 2MB 이하, 총 6장까지 권장)
  // v3.7.215: base64 → Supabase Storage URL로 전환 (DB row 폭증 방지)
  const onNoticeImagePick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
    if (!files.length) return;
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) { alert(`"${file.name}" 5MB 초과 — 건너뜀`); continue; }
      const url = await uploadImageToStorage(file, 'notices');
      if (url) setNoticeForm(p => ({ ...p, images: [...(p.images||[]), url] }));
      else alert(`"${file.name}" 업로드 실패`);
    }
  };
  const onNoticePasteImage = async (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type?.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 5 * 1024 * 1024) { alert("붙여넣은 이미지가 5MB를 초과합니다"); continue; }
        const url = await uploadImageToStorage(file, 'notices');
        if (url) setNoticeForm(p => ({ ...p, images: [...(p.images||[]), url] }));
        else alert("이미지 업로드 실패");
      }
    }
  };
  const removeNoticeImage = (idx) => {
    setNoticeForm(p => ({ ...p, images: (p.images||[]).filter((_, i) => i !== idx) }));
  };
  // 마킹 에디터 상태 — 공지 폼: {idx} / 수정요청 폼: boolean / 등록된 공지 수정: {noticeId, idx}
  const [markupIdx, setMarkupIdx] = useState(null);
  const [reqMarkupIdx, setReqMarkupIdx] = useState(null);
  const [existingMarkup, setExistingMarkup] = useState(null); // {noticeId, idx}

  // 등록된 공지 이미지 마킹 저장 — MarkupEditor가 base64 반환하므로 storage 업로드 후 URL 저장
  const saveExistingNoticeImage = async (noticeId, imgIdx, newB64) => {
    const url = await uploadImageToStorage(newB64, 'notices');
    if (!url) { alert('이미지 저장 실패'); return; }
    const next = notices.map(n => {
      if (n.id !== noticeId) return n;
      const imgs = Array.isArray(n.images) ? [...n.images] : (n.imageData ? [n.imageData] : []);
      imgs[imgIdx] = url;
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
  const replaceNoticeImage = async (idx, newB64) => {
    const url = await uploadImageToStorage(newB64, 'notices');
    if (!url) { alert('이미지 저장 실패'); return; }
    setNoticeForm(p => ({ ...p, images: (p.images||[]).map((img, i) => i === idx ? url : img) }));
    setMarkupIdx(null);
  };

  // 이미지 → Supabase Storage 업로드 후 URL 저장 (다중 첨부, v3.7.481)
  const onImagePick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) { alert("이미지 크기 5MB 이하로 업로드해주세요"); continue; }
      const url = await uploadImageToStorage(file, 'requests');
      if (url) setForm(p => ({ ...p, images: [...(p.images||[]), url] }));
      else alert("이미지 업로드 실패");
    }
  };

  // 클립보드 이미지 붙여넣기 — Ctrl+V / Cmd+V (다중)
  const onPasteImage = async (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        const file = it.getAsFile();
        if (!file) continue;
        if (file.size > 5 * 1024 * 1024) { alert("이미지 크기 5MB 이하만 붙여넣기 가능합니다"); continue; }
        const url = await uploadImageToStorage(file, 'requests');
        if (url) setForm(p => ({ ...p, images: [...(p.images||[]), url] }));
        else alert("이미지 업로드 실패");
      }
    }
  };
  const removeReqImage = (idx) => {
    setForm(p => ({ ...p, images: (p.images||[]).filter((_, i) => i !== idx) }));
  };
  const replaceReqImage = async (idx, newB64) => {
    const url = await uploadImageToStorage(newB64, 'requests');
    if (!url) { alert('이미지 저장 실패'); return; }
    setForm(p => ({ ...p, images: (p.images||[]).map((img, i) => i === idx ? url : img) }));
  };

  const submit = async () => {
    if (!form.name.trim()) { alert("요청자 이름을 입력해주세요"); return; }
    if (!form.description.trim()) { alert("내용을 입력해주세요"); return; }
    setSubmitting(true);
    const newReq = {
      id: genId(), name: form.name.trim(), branchId: form.branchId || "",
      description: form.description.trim(),
      images: Array.isArray(form.images) ? form.images : [],
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
    setForm({ name: "", branchId: userBranches?.[0] || "", description: "", images: [] });
    setShowForm(false);
    setSubmitting(false);
  };

  const updateStatus = async (id, status) => {
    const next = requests.map(r => r.id === id ? { ...r, status } : r);
    await saveAll(next);
  };

  const saveReply = async (id) => {
    // 답변 텍스트 비어있어도 등록 가능 — 상태만 pending → reviewing으로 진행
    const txt = replyText.trim();
    const next = requests.map(r => {
      if (r.id !== id) return r;
      const u = { ...r };
      if (txt) u.reply = txt;
      // pending → reviewing 자동 전환 (답변 유무 무관)
      if (u.status === "pending") u.status = "reviewing";
      return u;
    });
    await saveAll(next);
    setReplyText("");
  };

  // 답변 수정 시작 — 기존 reply를 input에 미리 채움
  const startEditReply = (r) => {
    setReplyText(r.reply || "");
    setOpenId(r.id);
    // 다음 paint 후 input에 포커스
    setTimeout(() => {
      const el = document.getElementById(`reply-input-${r.id}`);
      if (el) { el.focus(); el.select?.(); }
    }, 80);
  };

  // 답변 삭제
  const deleteReply = async (id) => {
    if (!confirm("이 답변을 삭제할까요?")) return;
    const next = requests.map(r => {
      if (r.id !== id) return r;
      const u = { ...r }; delete u.reply; return u;
    });
    await saveAll(next);
  };

  // 요청 본문(description) 수정
  const startEditDesc = (r) => {
    setEditingDescId(r.id);
    setEditingDescText(r.description || "");
  };
  const cancelEditDesc = () => {
    setEditingDescId(null);
    setEditingDescText("");
  };
  const saveEditDesc = async (id) => {
    const txt = editingDescText.trim();
    if (!txt) { alert("내용을 입력해주세요."); return; }
    const next = requests.map(r => r.id === id ? { ...r, description: txt } : r);
    await saveAll(next);
    cancelEditDesc();
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
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:38,height:38,borderRadius:10,background:T.primary,color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(124,58,237,.25)"}}>
          <I name="bell" size={19} color="#fff"/>
        </div>
        <div>
          <h2 style={{margin:0,fontSize:22,fontWeight:T.fw.black,color:T.text,lineHeight:1.2}}>공지 & 요청</h2>
          <div style={{fontSize:T.fs.xs,color:T.textMuted,marginTop:2}}>업데이트 안내 · 직원 게시판 · 개선 요청</div>
        </div>
      </div>
      {tab === "requests" && <button onClick={()=>setShowForm(true)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="plus" size={14}/> 새 요청
      </button>}
      {/* 휴무 신청 버튼 — 보류(설계 재검토). 진입점만 숨김, 코드는 보존 */}
      {tab === "notices" && isMaster && <button onClick={()=>setShowNoticeForm(true)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:T.primary,color:"#fff",fontSize:T.fs.sm,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
        <I name="plus" size={14}/> 새 공지
      </button>}
    </div>
    {/* 탭 */}
    <div style={{display:"flex",gap:0,borderBottom:`2px solid ${T.border}`,marginBottom:18}}>
      {[
        ["notices", "공지사항", notices.length, "bell"],
        ["requests", "수정 요청", requests.length, "edit"]
      ].map(([k, label, n, ic])=>(
        <button key={k} onClick={()=>setTab(k)}
          style={{padding:"10px 18px",fontSize:13,fontWeight:700,border:"none",background:"transparent",
            color: tab===k ? T.primary : T.textSub,
            borderBottom: tab===k ? `3px solid ${T.primary}` : "3px solid transparent",
            marginBottom:-2, cursor:"pointer", fontFamily:"inherit",
            display:"inline-flex", alignItems:"center", gap:6}}>
          <I name={ic} size={14}/> {label}
          <span style={{fontSize:11,padding:"1px 7px",borderRadius:10,background:tab===k?T.primaryLt:T.gray100,color:tab===k?T.primary:T.gray500,fontWeight:700}}>{n}</span>
        </button>
      ))}
    </div>
    {/* 공지사항 */}
    {tab==="notices" && <>
      {showOffForm && <div style={{background:"#F5F3FF",border:"1.5px solid #C4B5FD",borderRadius:12,padding:18,marginBottom:18}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#5B21B6",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
          <I name="calendar" size={14} color="#5B21B6"/> 휴무 신청 만들기
        </div>
        <input value={offForm.title} onChange={e=>setOffForm(p=>({...p,title:e.target.value}))} placeholder="제목 (비우면 자동 — 예: 휴무 신청 6/1~7/5)"
          style={{width:"100%",padding:"9px 12px",fontSize:13,border:"1.5px solid "+T.border,borderRadius:8,fontFamily:"inherit",marginBottom:8,boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
          <label style={{fontSize:12,color:T.textSub,fontWeight:600}}>기간</label>
          <input type="date" value={offForm.start} onChange={e=>setOffForm(p=>({...p,start:e.target.value}))} style={{padding:"7px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
          <span style={{color:T.textMuted}}>~</span>
          <input type="date" value={offForm.end} onChange={e=>setOffForm(p=>({...p,end:e.target.value}))} style={{padding:"7px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
          <label style={{fontSize:12,color:T.textSub,fontWeight:600,marginLeft:8}}>인당 최대</label>
          <input type="number" min={1} max={5} value={offForm.maxPicks} onChange={e=>setOffForm(p=>({...p,maxPicks:e.target.value}))} style={{width:60,padding:"7px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
          <span style={{fontSize:12,color:T.textSub}}>개</span>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
          <label style={{fontSize:12,color:T.textSub,fontWeight:600}}>신청 제외일</label>
          <input type="date" value={offForm.excludeInput} onChange={e=>setOffForm(p=>({...p,excludeInput:e.target.value}))} style={{padding:"7px 10px",fontSize:13,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
          <button onClick={()=>{const d=offForm.excludeInput;if(d&&!offForm.exclude.includes(d))setOffForm(p=>({...p,exclude:[...p.exclude,d].sort(),excludeInput:""}));}}
            style={{padding:"6px 12px",fontSize:12,fontWeight:700,borderRadius:7,border:"1px solid "+T.primary,background:"#fff",color:T.primary,cursor:"pointer",fontFamily:"inherit"}}>추가</button>
          {offForm.exclude.map(d=>(
            <span key={d} style={{fontSize:11,fontWeight:700,color:T.textSub,background:T.gray100,borderRadius:6,padding:"3px 8px",display:"inline-flex",alignItems:"center",gap:4}}>
              {d} <span onClick={()=>setOffForm(p=>({...p,exclude:p.exclude.filter(x=>x!==d)}))} style={{cursor:"pointer",color:T.danger,fontWeight:800}}>×</span>
            </span>
          ))}
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>{setShowOffForm(false);setOffForm({title:"",start:"",end:"",maxPicks:2,exclude:[],excludeInput:""});}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
          <button onClick={submitOffRequest} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#7C3AED",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>만들기</button>
        </div>
      </div>}
      {showNoticeForm && <div style={{background:"#F5F3FF",border:"1.5px solid #C4B5FD",borderRadius:12,padding:18,marginBottom:18}}>
        <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#5B21B6",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
          <I name={editingNoticeId?"edit":"bell"} size={14} color="#5B21B6"/> {editingNoticeId?"공지 수정":"새 공지 작성"}
        </div>
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
          <label style={{padding:"6px 12px",fontSize:12,fontWeight:700,borderRadius:6,border:"1px dashed #8B5CF6",background:"#fff",color:"#5B21B6",cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
            <I name="upload" size={12} color="#5B21B6"/> 이미지 첨부
            <input type="file" accept="image/*" multiple onChange={onNoticeImagePick} style={{display:"none"}}/>
          </label>
          <span style={{fontSize:10,color:T.textMuted}}>여러 장 가능 · 각 2MB 이하 · Ctrl+V로 붙여넣기 OK</span>
        </div>
        {(noticeForm.images||[]).length > 0 && <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {noticeForm.images.map((img, i) => (
            <div key={i} style={{position:"relative",border:"1px solid "+T.border,borderRadius:6,overflow:"hidden",background:"#fff"}}>
              <img src={img} alt={`첨부${i+1}`} style={{display:"block",height:80,maxWidth:140,objectFit:"cover"}}/>
              <button onClick={()=>setMarkupIdx(i)} title="마킹 편집"
                style={{position:"absolute",top:2,left:2,padding:"2px 6px",borderRadius:4,border:"none",background:"rgba(124,58,237,.9)",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",lineHeight:1,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}><I name="edit" size={9} color="#fff"/> 편집</button>
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
          <button onClick={()=>{setShowNoticeForm(false); setEditingNoticeId(null); setNoticeForm({title:"",version:"",content:"",images:[]});}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+T.border,background:"#fff",color:T.textSub,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
          <button onClick={submitNotice} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#7C3AED",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{editingNoticeId?"저장":"등록"}</button>
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
            // 작성자 이니셜
            const author = n.author || "관리자";
            const initial = author.slice(0, 1);
            return <div key={n.id} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:12,overflow:"hidden",boxShadow:isOpen?"0 4px 12px rgba(124,58,237,0.08)":"0 1px 2px rgba(0,0,0,0.03)",transition:"box-shadow .15s"}}>
              <div onClick={()=>setOpenNoticeId(isOpen?null:n.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                {/* 작성자 아바타 */}
                <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#7C3AED,#5B21B6)",color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:T.fw.black,flexShrink:0}}>
                  {initial}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  {/* 라벨 + 버전 + 첨부 카운트 */}
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,fontWeight:T.fw.bolder,padding:"2px 7px",borderRadius:4,background:"#F5F3FF",color:"#5B21B6",letterSpacing:0.3,display:"inline-flex",alignItems:"center",gap:3}}>
                      <I name={n.kind==="off_request"?"calendar":"bell"} size={9} color="#5B21B6"/> {n.kind==="off_request"?"휴무 신청":"공지"}
                    </span>
                    {n.version && <span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:T.gray100,color:T.textSub,fontFamily:"monospace",fontWeight:700}}>{n.version}</span>}
                    {imgs.length > 0 && <span style={{fontSize:10,color:T.gray500,fontWeight:600,display:"inline-flex",alignItems:"center",gap:3}}>
                      <I name="upload" size={10} color={T.gray500}/> {imgs.length}
                    </span>}
                  </div>
                  <div style={{fontSize:14,fontWeight:T.fw.bolder,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>
                    {n.title}
                  </div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:3,display:"flex",alignItems:"center",gap:5}}>
                    <I name="user" size={10} color={T.textMuted}/> {author}
                    <span style={{color:T.gray300}}>·</span>
                    <I name="clock" size={10} color={T.textMuted}/> {fmtDate(n.createdAt)}
                  </div>
                </div>
                <I name={isOpen?"chevD":"chevR"} size={14} color={T.gray400}/>
              </div>
              {isOpen && n.kind==="off_request" && <div style={{padding:"4px 16px 16px",borderTop:"1px solid "+T.gray100}}>
                <OffRequestCard notice={n} employees={employees} isMaster={isMaster}
                  onUpdate={updateOffNotice} onConfirm={confirmOffRequest}/>
                {isMaster && <div style={{marginTop:10,display:"flex",justifyContent:"flex-end"}}>
                  <button onClick={()=>removeNotice(n.id)}
                    style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.danger+"66",background:"#fff5f5",color:T.danger,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4}}>
                    <I name="trash" size={11} color={T.danger}/> 휴무 신청 삭제
                  </button>
                </div>}
              </div>}
              {isOpen && n.kind!=="off_request" && <div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
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
                          style={{padding:"4px 10px",borderRadius:6,border:"none",background:"rgba(124,58,237,0.95)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 6px rgba(0,0,0,0.3)",display:"inline-flex",alignItems:"center",gap:4}}>
                          <I name="edit" size={11} color="#fff"/> 편집
                        </button>
                        <button onClick={(e)=>{e.stopPropagation(); removeExistingNoticeImage(n.id, i);}}
                          title="이미지 삭제"
                          style={{padding:"4px 10px",borderRadius:6,border:"none",background:"rgba(220,38,38,0.95)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 6px rgba(0,0,0,0.3)",display:"inline-flex",alignItems:"center",gap:4}}>
                          <I name="trash" size={11} color="#fff"/> 삭제
                        </button>
                      </div>}
                    </div>
                  ))}
                </div>}
                {/* 직원 확인 명단 */}
                {employees.length > 0 && <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+T.gray200}}>
                  {(() => {
                    const acks = n.acks || {};
                    const ackedCount = employees.filter(e => acks[e.id]).length;
                    const pct = employees.length > 0 ? Math.round((ackedCount / employees.length) * 100) : 0;
                    return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:10}}>
                      <div style={{fontSize:12,fontWeight:T.fw.bolder,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                        <I name="clipboard" size={13} color={T.primary}/> 확인 명단
                        <span style={{fontSize:11,color:T.textMuted,fontWeight:600}}>({ackedCount}/{employees.length})</span>
                      </div>
                      {/* 진행률 바 */}
                      <div style={{flex:1,maxWidth:180,height:6,background:T.gray100,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${pct}%`,height:"100%",background:pct===100?"#10B981":T.primary,borderRadius:3,transition:"width .3s"}}/>
                      </div>
                      <div style={{fontSize:10,color:T.textMuted,fontWeight:600,minWidth:30,textAlign:"right"}}>{pct}%</div>
                    </div>;
                  })()}
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {employees.map(e => {
                      const acks = n.acks || {};
                      const acked = acks[e.id];
                      return <button key={e.id}
                        onClick={()=>ackNotice(n.id, e.id)}
                        title={acked ? `확인 ${fmtDate(acked)} — 클릭하면 해제` : "클릭해서 확인 처리"}
                        style={{
                          padding:"5px 10px",borderRadius:16,fontSize:11,fontWeight:700,
                          border: acked ? `1px solid #10B98166` : `1.5px dashed ${T.primary}66`,
                          background: acked ? "#D1FAE5" : "#fff",
                          color: acked ? "#065F46" : T.primary,
                          cursor: "pointer",
                          fontFamily:"inherit", display:"inline-flex", alignItems:"center", gap:5
                        }}>
                        <I name={acked?"check":"clock"} size={10} color={acked?"#065F46":T.primary}/>
                        {e.id}
                        {acked && <span style={{fontSize:9,color:"#065F46",opacity:.8,fontWeight:500}}>{fmtDate(acked)}</span>}
                      </button>;
                    })}
                  </div>
                </div>}
                {/* 댓글 */}
                <div style={{marginTop:12,paddingTop:12,borderTop:"1px dashed "+T.gray200}}>
                  <div style={{fontSize:12,fontWeight:T.fw.bolder,color:T.text,display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                    <I name="msgSq" size={13} color={T.primary}/> 댓글 <span style={{fontSize:11,color:T.textMuted,fontWeight:600}}>({(n.comments||[]).length})</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
                    {(n.comments||[]).map(c=>(
                      <div key={c.id} style={{display:"flex",gap:7,alignItems:"baseline",fontSize:12,background:T.gray100,borderRadius:8,padding:"6px 9px"}}>
                        <span style={{fontWeight:700,color:T.text,flex:"0 0 auto"}}>{c.name}</span>
                        <span style={{color:T.text,flex:1,minWidth:0,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{c.text}</span>
                        <span style={{fontSize:9,color:T.textMuted,flex:"0 0 auto"}}>{fmtDate(c.createdAt)}</span>
                        {(isMaster || c.name === (currentUser?.name)) && <button onClick={()=>removeComment(n.id,c.id)} title="삭제"
                          style={{border:"none",background:"none",cursor:"pointer",padding:0,flex:"0 0 auto",display:"inline-flex",alignItems:"center"}}>
                          <I name="x" size={11} color={T.textMuted}/>
                        </button>}
                      </div>
                    ))}
                    {(n.comments||[]).length===0 && <span style={{fontSize:11,color:T.textMuted}}>첫 댓글을 남겨보세요.</span>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <input value={commentDrafts[n.id]||""} onChange={e=>setCommentDrafts(p=>({...p,[n.id]:e.target.value}))}
                      onKeyDown={e=>{ if(e.key==='Enter' && !e.nativeEvent.isComposing){ e.preventDefault(); addComment(n.id); } }}
                      placeholder="댓글 입력…"
                      style={{flex:1,padding:"7px 10px",fontSize:12,border:"1px solid "+T.border,borderRadius:8,fontFamily:"inherit"}}/>
                    <button onClick={()=>addComment(n.id)}
                      style={{padding:"7px 14px",borderRadius:8,border:"none",background:T.primary,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>등록</button>
                  </div>
                </div>
                {isMaster && <div style={{marginTop:12,display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>startEditNotice(n)}
                    style={{padding:"4px 10px",borderRadius:6,border:"1px solid #C4B5FD",background:"#F5F3FF",color:"#5B21B6",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4}}>
                    <I name="edit" size={11} color="#5B21B6"/> 공지 수정
                  </button>
                  <button onClick={()=>removeNotice(n.id)}
                    style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.danger+"66",background:"#fff5f5",color:T.danger,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:4}}>
                    <I name="trash" size={11} color={T.danger}/> 공지 전체 삭제
                  </button>
                </div>}
              </div>}
            </div>;
          })}
        </div>
      )}
    </>}
    {tab==="requests" && <>


    {/* 작성 폼 */}
    {showForm && <div style={{background:"#FFFBEB",border:"1.5px solid #FCD34D",borderRadius:12,padding:18,marginBottom:18}}>
      <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bolder,color:"#B45309",marginBottom:12}}>새 요청 작성</div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="요청자 이름 *"
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
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <label style={{padding:"7px 14px",borderRadius:8,border:"1px dashed "+T.gray400,background:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,color:T.gray600,display:"inline-flex",alignItems:"center",gap:5}}>
          <I name="image" size={12}/> 사진 첨부 (여러 장 가능)
          <input type="file" accept="image/*" multiple onChange={onImagePick} style={{display:"none"}}/>
        </label>
      </div>
      {(form.images||[]).length > 0 && <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {form.images.map((img, i) => (
          <div key={i} style={{position:"relative",display:"flex",alignItems:"center",gap:4,padding:"4px 6px",border:"1px solid "+T.border,borderRadius:8,background:"#fff"}}>
            <img src={img} alt={"preview-"+i} style={{height:40,borderRadius:6}}/>
            <button onClick={()=>setReqMarkupIdx(i)} title="마킹 편집"
              style={{padding:"4px 10px",borderRadius:6,border:"none",background:"#7C3AED",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:3}}><I name="edit" size={11} color="#fff"/></button>
            <button onClick={()=>removeReqImage(i)} style={{border:"none",background:"none",color:T.danger,cursor:"pointer",fontSize:14}}>×</button>
          </div>
        ))}
      </div>}
      {reqMarkupIdx !== null && form.images?.[reqMarkupIdx] && <MarkupEditor
        open={true}
        imageSrc={form.images[reqMarkupIdx]}
        onSave={async (newB64)=>{
          await replaceReqImage(reqMarkupIdx, newB64);
          setReqMarkupIdx(null);
        }}
        onClose={()=>setReqMarkupIdx(null)}
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
          const reqInitial = (r.name || "?").slice(0, 1);
          const imgCount = Array.isArray(r.images) ? r.images.length : (r.imageData ? 1 : 0);
          return <div key={r.id} style={{background:T.bgCard,border:"1px solid "+T.border,borderRadius:12,overflow:"hidden",boxShadow:isOpen?"0 4px 12px rgba(124,58,237,0.08)":"0 1px 2px rgba(0,0,0,0.03)",transition:"box-shadow .15s"}}>
            <div onClick={()=>setOpenId(isOpen?null:r.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
              {/* 작성자 아바타 */}
              <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg, ${T.gray400}, ${T.gray700})`,color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:T.fw.black,flexShrink:0}}>
                {reqInitial}
              </div>
              <div style={{flex:1,minWidth:0}}>
                {/* 상태 배지 + 첨부 + 답변 표시 */}
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,fontWeight:T.fw.bolder,padding:"2px 7px",borderRadius:4,background:st.bg,color:st.color,letterSpacing:0.3}}>{st.label}</span>
                  {imgCount > 0 && <span style={{fontSize:10,color:T.gray500,fontWeight:600,display:"inline-flex",alignItems:"center",gap:3}}><I name="upload" size={10} color={T.gray500}/> {imgCount}</span>}
                  {r.reply && <span style={{fontSize:10,color:T.primary,fontWeight:600,display:"inline-flex",alignItems:"center",gap:3}}><I name="msgSq" size={10} color={T.primary}/> 답변</span>}
                </div>
                <div style={{fontSize:14,fontWeight:T.fw.bolder,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>
                  {(r.description||"").split("\n")[0].slice(0, 70)}
                </div>
                <div style={{fontSize:11,color:T.textMuted,marginTop:3,display:"flex",alignItems:"center",gap:5}}>
                  <I name="user" size={10} color={T.textMuted}/> {r.name}
                  {r.branchId && <><span style={{color:T.gray300}}>·</span><I name="building" size={10} color={T.textMuted}/> {branchName(r.branchId)}</>}
                  <span style={{color:T.gray300}}>·</span>
                  <I name="clock" size={10} color={T.textMuted}/> {fmtDate(r.createdAt)}
                </div>
              </div>
              <I name={isOpen?"chevD":"chevR"} size={14} color={T.gray400}/>
            </div>
            {isOpen && <div style={{padding:"0 16px 16px",borderTop:"1px solid "+T.gray100}}>
              {editingDescId === r.id ? (
                <div style={{padding:"12px 0"}}>
                  <textarea value={editingDescText} onChange={e=>setEditingDescText(e.target.value)}
                    style={{width:"100%",minHeight:90,padding:"8px 10px",fontSize:13,border:"1.5px solid "+T.primary,borderRadius:8,fontFamily:"inherit",resize:"vertical",lineHeight:1.5}}/>
                  <div style={{display:"flex",gap:6,marginTop:6}}>
                    <button onClick={()=>saveEditDesc(r.id)} style={{padding:"5px 14px",fontSize:11,fontWeight:700,background:T.primary,color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"inherit"}}>저장</button>
                    <button onClick={cancelEditDesc} style={{padding:"5px 12px",fontSize:11,background:"#fff",color:T.textSub,border:"1px solid "+T.border,borderRadius:6,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"12px 0"}}>
                  <div style={{flex:1,fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{r.description}</div>
                  {(isMaster || r.name === currentUser?.name) && (
                    <button onClick={()=>startEditDesc(r)} title="요청 본문 수정"
                      style={{padding:"3px 8px",fontSize:10,fontWeight:600,background:"#fff",color:T.textSub,border:"1px solid "+T.border,borderRadius:6,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>✏️ 수정</button>
                  )}
                </div>
              )}
              {(() => {
                const imgs = Array.isArray(r.images) ? r.images : (r.imageData ? [r.imageData] : []);
                if (imgs.length === 0) return null;
                return <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  {imgs.map((img, i) => <img key={i} src={img} alt={"첨부-"+(i+1)} style={{maxWidth:"100%",maxHeight:400,borderRadius:8,border:"1px solid "+T.border}}/>)}
                </div>;
              })()}
              {r.reply && <div style={{marginTop:12,padding:"10px 14px",background:T.primaryLt||"#EEF2FF",borderRadius:8,borderLeft:"3px solid "+T.primary}}>
                <div style={{fontSize:11,fontWeight:T.fw.bolder,color:T.primary,marginBottom:4,display:"flex",alignItems:"center",gap:5}}>
                  <I name="msgSq" size={11} color={T.primary}/> 답변
                  {isMaster && <span style={{marginLeft:"auto",display:"inline-flex",gap:4}}>
                    <button onClick={()=>startEditReply(r)} title="답변 수정"
                      style={{padding:"2px 7px",fontSize:10,fontWeight:600,background:"#fff",color:T.primary,border:"1px solid "+T.primary+"55",borderRadius:5,cursor:"pointer",fontFamily:"inherit"}}>✏️ 수정</button>
                    <button onClick={()=>deleteReply(r.id)} title="답변 삭제"
                      style={{padding:"2px 7px",fontSize:10,fontWeight:600,background:"#fff",color:T.danger,border:"1px solid "+T.danger+"55",borderRadius:5,cursor:"pointer",fontFamily:"inherit"}}>🗑</button>
                  </span>}
                </div>
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
                  <input id={`reply-input-${r.id}`} value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder={r.reply?"답변 수정 — ✏️ 버튼으로 기존 답변 불러오기":"답변 작성..."}
                    style={{flex:1,padding:"7px 10px",fontSize:12,border:"1px solid "+T.border,borderRadius:6,fontFamily:"inherit"}}/>
                  <button onClick={()=>saveReply(r.id)} title={replyText.trim()?"답변 등록":"답변 없이 검토중으로 전환"} style={{padding:"7px 14px",borderRadius:6,border:"none",background:T.primary,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>등록</button>
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
