import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import I from '../common/I'

// 공지 안에 들어가는 "휴무 신청" — 담당자가 직원별로 휴무꼭 날짜를 대신 입력.
// [마감/확정] 누르면 부모(onConfirm)가 근무표(schHistory)에 "휴무(꼭)"로 일괄 기록.
const DOW = ["일","월","화","수","목","금","토"];

function buildDates(start, end, exclude) {
  const out = [];
  if (!start || !end) return out;
  const ex = new Set(exclude || []);
  let d = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  let guard = 0;
  while (d <= last && guard < 400) {
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (!ex.has(iso)) out.push(iso);
    d.setDate(d.getDate()+1); guard++;
  }
  return out;
}
const mdLabel = iso => { const [,m,da] = iso.split("-"); const dt = new Date(iso+"T00:00:00"); return `${+m}/${+da}(${DOW[dt.getDay()]})`; };

export default function OffRequestCard({ notice, employees, isMaster, onUpdate, onConfirm }) {
  const oq = notice.offReq || {};
  const confirmed = oq.status === "confirmed";
  const readonly = confirmed || !isMaster; // 직원(비마스터)은 보기 전용 — 입력은 담당자만
  const maxPicks = oq.maxPicks || 2;
  const dates = useMemo(() => buildDates(oq.start, oq.end, oq.exclude), [oq.start, oq.end, oq.exclude]);
  const [picks, setPicks] = useState(() => oq.picks || {});
  const [editEmp, setEditEmp] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // 날짜별 겹침 수
  const overlap = useMemo(() => {
    const o = {};
    Object.values(picks).forEach(p => { if (p?.none) return; (p?.dates||[]).forEach(d => { o[d] = (o[d]||0)+1; }); });
    return o;
  }, [picks]);

  const empState = id => picks[id] || { dates: [], none: false };
  const togglePick = (empId, date) => {
    if (readonly) return;
    setPicks(prev => {
      const e = { ...(prev[empId] || { dates: [], none: false }) };
      let ds = [...(e.dates || [])];
      if (ds.includes(date)) ds = ds.filter(x => x !== date);
      else {
        if (ds.length >= maxPicks) { alert(`인당 최대 ${maxPicks}개까지만 선택할 수 있어요`); return prev; }
        ds = [...ds, date].sort();
      }
      return { ...prev, [empId]: { dates: ds, none: false } };
    });
    setDirty(true);
  };
  const toggleNone = (empId) => {
    if (readonly) return;
    setPicks(prev => {
      const e = { ...(prev[empId] || { dates: [], none: false }) };
      const none = !e.none;
      return { ...prev, [empId]: { dates: none ? [] : e.dates, none } };
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try { await onUpdate({ ...notice, offReq: { ...oq, picks } }); setDirty(false); }
    finally { setSaving(false); }
  };
  const doConfirm = async () => {
    const filled = employees.filter(e => { const s = picks[e.id]; return s && (s.none || (s.dates||[]).length > 0); }).length;
    const miss = employees.length - filled;
    const dupDays = Object.entries(overlap).filter(([,c]) => c >= 2);
    let msg = `근무표에 휴무(꼭)로 일괄 반영할까요?\n\n• 입력 완료: ${filled}명 / 미입력: ${miss}명`;
    if (dupDays.length) msg += `\n• ⚠️ 겹친 날: ${dupDays.map(([d,c])=>`${mdLabel(d)} ${c}명`).join(", ")}\n  (사다리 등으로 먼저 정리하셨나요?)`;
    msg += `\n\n확정하면 신청 날짜가 근무표에 휴무(꼭)로 기록됩니다.`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try { await onConfirm({ ...notice, offReq: { ...oq, picks } }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: "4px 0 2px" }}>
      {/* 헤더 — 기간/상태 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#5B21B6", background: "#F5F3FF", borderRadius: 6, padding: "3px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I name="calendar" size={12} color="#5B21B6" /> 휴무 신청
        </span>
        <span style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{oq.start} ~ {oq.end} · 인당 최대 {maxPicks}개</span>
        {confirmed
          ? <span style={{ fontSize: 11, fontWeight: 800, color: "#047857", background: "#D1FAE5", borderRadius: 10, padding: "2px 9px" }}>✓ 근무표 반영됨</span>
          : <span style={{ fontSize: 11, fontWeight: 800, color: "#c2410c", background: "#FFF7ED", borderRadius: 10, padding: "2px 9px" }}>접수중</span>}
      </div>

      {/* 겹침 요약 */}
      {Object.values(overlap).some(c => c >= 2) && (
        <div style={{ fontSize: 11, color: "#b45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
          ⚠️ 겹친 날: {Object.entries(overlap).filter(([,c]) => c >= 2).map(([d,c]) => `${mdLabel(d)} ${c}명`).join(" · ")}
        </div>
      )}

      {/* 직원별 입력 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {employees.map(emp => {
          const s = empState(emp.id);
          const open = editEmp === emp.id;
          const done = s.none || (s.dates || []).length > 0;
          return (
            <div key={emp.id} style={{ border: "1px solid " + (done ? "#C4B5FD" : T.border), borderRadius: 9, overflow: "hidden", background: done ? "#FAF8FF" : "#fff" }}>
              <div onClick={() => !readonly && setEditEmp(open ? null : emp.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: readonly ? "default" : "pointer" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text, minWidth: 56 }}>{emp.name || emp.id}</span>
                <div style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {s.none && <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, background: T.gray100, borderRadius: 6, padding: "2px 8px" }}>없음</span>}
                  {(s.dates || []).map(d => (
                    <span key={d} style={{ fontSize: 11, fontWeight: 700, color: "#5B21B6", background: "#EDE7F6", borderRadius: 6, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {mdLabel(d)}{overlap[d] >= 2 && <span style={{ color: "#dc2626" }} title="겹침">●</span>}
                    </span>
                  ))}
                  {!done && <span style={{ fontSize: 11, color: T.gray400 }}>미입력</span>}
                </div>
                {!readonly && <I name={open ? "chevD" : "chevR"} size={13} color={T.gray400} />}
              </div>
              {open && !readonly && (
                <div style={{ padding: "8px 10px", borderTop: "1px dashed " + T.gray200, background: "#fff" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                    {dates.map(d => {
                      const sel = (s.dates || []).includes(d);
                      const cnt = overlap[d] || 0;
                      return (
                        <button key={d} onClick={() => togglePick(emp.id, d)} disabled={s.none}
                          style={{ fontSize: 11, fontWeight: 700, padding: "4px 7px", borderRadius: 6, cursor: s.none ? "not-allowed" : "pointer", fontFamily: "inherit",
                            border: sel ? "1.5px solid #7C3AED" : "1px solid " + T.border,
                            background: sel ? "#7C3AED" : (cnt >= 1 ? "#FFF7ED" : "#fff"),
                            color: sel ? "#fff" : (cnt >= 1 ? "#c2410c" : T.textSub), opacity: s.none ? 0.4 : 1 }}>
                          {mdLabel(d)}{!sel && cnt >= 1 ? ` ${cnt}` : ""}
                        </button>
                      );
                    })}
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.textSub, cursor: "pointer", fontWeight: 600 }}>
                    <input type="checkbox" checked={!!s.none} onChange={() => toggleNone(emp.id)} /> 이번엔 휴무 없음
                  </label>
                </div>
              )}
            </div>
          );
        })}
        {employees.length === 0 && <div style={{ fontSize: 12, color: T.textMuted, padding: 10 }}>직원 명단이 없습니다 (근무표에 직원을 먼저 등록하세요).</div>}
      </div>

      {/* 액션 */}
      {isMaster && !confirmed && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={save} disabled={saving || !dirty}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + T.border, background: "#fff", color: dirty ? T.primary : T.gray400, fontSize: 13, fontWeight: 700, cursor: dirty && !saving ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
            {saving ? "저장중…" : "임시 저장"}
          </button>
          <button onClick={doConfirm} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff", fontSize: 13, fontWeight: 800, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
            마감 · 근무표 반영
          </button>
        </div>
      )}
      {confirmed && (
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 10, textAlign: "right" }}>
          {oq.confirmedBy ? `${oq.confirmedBy} · ` : ""}{oq.confirmedAt ? new Date(oq.confirmedAt).toLocaleString("ko-KR") : ""} 마감
        </div>
      )}
    </div>
  );
}
