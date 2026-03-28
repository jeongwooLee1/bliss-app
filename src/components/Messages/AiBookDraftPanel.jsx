import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { genId } from '../../lib/utils'
import { sb } from '../../lib/sb'
import { toDb } from '../../lib/db'

export default function AiBookDraftPanel({ draft: initDraft, data, onSend, onCancel }) {
  const [form, setForm] = useState({
    date: initDraft.date || "",
    time: initDraft.time || "",
    serviceId: initDraft.serviceId || "",
    branchId: initDraft.branchId || "",
    custName: initDraft.customerName || "",
    custPhone: initDraft.customerPhone || "",
    reply: initDraft.replyDraft || "",
  });
  const [saving, setSaving] = useState(false);
  const up = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const services = data?.services || [];
  const branches = (data?.branches || []).filter(b => b.useYn !== false);
  const reservations = data?.reservations || [];
  const selectedSvc = services.find(s => s.id === form.serviceId);
  const dur = selectedSvc?.dur || 60;

  // 예약 가능 여부 체크 (날짜+시간+지점 기준)
  const { isAvailable, conflicts } = useMemo(() => {
    if (!form.date || !form.time) return { isAvailable: null, conflicts: [] };
    const [rh, rm] = form.time.split(":").map(Number);
    const rStart = rh * 60 + rm;
    const rEnd = rStart + dur;
    const cs = reservations.filter(r => {
      if (r.date !== form.date) return false;
      if (form.branchId && r.bid !== form.branchId) return false;
      if (["cancelled", "naver_cancelled"].includes(r.status)) return false;
      const [eh, em] = (r.time || "00:00").split(":").map(Number);
      const eStart = eh * 60 + em;
      const eEnd = eStart + (r.dur || 60);
      return rStart < eEnd && rEnd > eStart;
    });
    return { isAvailable: cs.length === 0, conflicts: cs };
  }, [form.date, form.time, form.branchId, dur, reservations]);

  const fmtEndTime = (t, d) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const end = h * 60 + m + d;
    return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  };

  const inp = {
    width: "100%", padding: "6px 10px",
    border: "1px solid " + T.border, borderRadius: 6,
    fontSize: 13, fontFamily: "inherit", outline: "none",
    background: "#fff", boxSizing: "border-box", color: T.text,
  };
  const lbl = { fontSize: 11, color: T.textSub, marginBottom: 3, display: "block", fontWeight: 600 };

  const handleSend = async (withBook) => {
    if (!form.reply.trim()) { alert("전송할 메시지를 입력하세요."); return; }
    if (withBook) {
      if (!form.custName.trim()) { alert("고객 이름을 입력해주세요."); return; }
      if (!form.date) { alert("예약 날짜를 선택해주세요."); return; }
      if (!form.time) { alert("예약 시간을 선택해주세요."); return; }
    }
    setSaving(true);
    try {
      if (withBook) {
        const customers = data?.customers || [];
        const normPhone = (form.custPhone || "").replace(/[^0-9]/g, "");
        const existCust = customers.find(
          c => (normPhone && c.phone === normPhone) || c.name === form.custName.trim()
        );
        let custId = existCust?.id;
        if (!custId) {
          custId = genId("cust");
          await sb.insert("customers", {
            id: custId,
            bid: form.branchId || null,
            name: form.custName.trim(),
            phone: normPhone || null,
            gender: "",
            visits: 0,
          });
        }
        const resId = genId("res");
        await sb.insert("reservations", toDb("reservations", {
          id: resId,
          bid: form.branchId || null,
          custId,
          custName: form.custName.trim(),
          custPhone: normPhone || null,
          date: form.date,
          time: form.time,
          dur,
          status: "confirmed",
          type: "reservation",
          serviceId: form.serviceId || null,
          selectedServices: form.serviceId ? [form.serviceId] : [],
          memo: "[AI예약메시지]",
          isNewCust: !existCust,
        }));
      }
      await onSend(form.reply.trim());
    } catch (e) {
      alert("오류 발생: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: T.bgCard, borderTop: "2px solid " + T.primary, flexShrink: 0 }}>
      {/* 헤더 */}
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid " + T.border }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>📅</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>AI 예약 분석</span>
          {isAvailable === true && (
            <span style={{ background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>
              ✓ 예약 가능
            </span>
          )}
          {isAvailable === false && (
            <span style={{ background: "#fef2f2", color: T.danger, fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>
              ⚠ {conflicts.length}건 중복
            </span>
          )}
          {isAvailable === null && form.date && form.time && (
            <span style={{ background: "#f3f4f6", color: T.textMuted, fontSize: 11, padding: "1px 8px", borderRadius: 10 }}>
              지점 미선택
            </span>
          )}
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 18, lineHeight: 1, padding: "2px 4px" }}>✕</button>
      </div>

      {/* 폼 */}
      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 8 }}>
          <div>
            <label style={lbl}>고객명 *</label>
            <input style={inp} value={form.custName} onChange={e => up("custName", e.target.value)} placeholder="이름" />
          </div>
          <div>
            <label style={lbl}>전화번호</label>
            <input style={inp} value={form.custPhone} onChange={e => up("custPhone", e.target.value)} placeholder="010-XXXX-XXXX" />
          </div>
          <div>
            <label style={lbl}>예약 날짜 *</label>
            <input type="date" style={inp} value={form.date} onChange={e => up("date", e.target.value)} />
          </div>
          <div>
            <label style={lbl}>예약 시간 *</label>
            <input type="time" style={inp} value={form.time} onChange={e => up("time", e.target.value)} />
          </div>
          <div>
            <label style={lbl}>지점</label>
            <select style={inp} value={form.branchId} onChange={e => up("branchId", e.target.value)}>
              <option value="">지점 선택</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>시술{selectedSvc ? ` (${dur}분)` : ""}</label>
            <select style={inp} value={form.serviceId} onChange={e => up("serviceId", e.target.value)}>
              <option value="">시술 선택</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.dur ? ` (${s.dur}분)` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 중복 예약 경고 */}
        {conflicts.length > 0 && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 10px", marginBottom: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: T.danger, marginBottom: 3 }}>⚠ 해당 시간대 기존 예약</div>
            {conflicts.slice(0, 4).map((r, i) => (
              <div key={i} style={{ color: T.text }}>
                • {r.custName} {r.time}~{fmtEndTime(r.time, r.dur || 60)} ({r.status})
              </div>
            ))}
          </div>
        )}

        {/* AI 응답 초안 */}
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>AI 응답 초안 (직접 편집 후 전송)</label>
          <textarea
            value={form.reply}
            onChange={e => up("reply", e.target.value)}
            style={{ ...inp, height: 64, resize: "vertical", lineHeight: 1.6 }}
            placeholder="고객에게 보낼 메시지..."
          />
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={saving} style={{ padding: "7px 14px", background: "#f3f4f6", color: T.text, border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            취소
          </button>
          <button
            onClick={() => handleSend(false)}
            disabled={saving || !form.reply.trim()}
            style={{ padding: "7px 14px", background: "#e0e7ff", color: "#3730a3", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, opacity: (saving || !form.reply.trim()) ? 0.5 : 1 }}
          >
            전송만
          </button>
          <button
            onClick={() => handleSend(true)}
            disabled={saving || !form.reply.trim() || !form.custName || !form.date || !form.time}
            style={{ padding: "7px 14px", background: T.primary, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700, opacity: (saving || !form.reply.trim() || !form.custName || !form.date || !form.time) ? 0.5 : 1 }}
          >
            {saving ? "처리 중..." : "📅 전송 + 예약등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
