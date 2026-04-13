import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import { APageHeader } from './AdminUI'

const TABS = [
  { id: "sale", label: "매출 메모" },
  { id: "reservation", label: "예약 메모" },
  { id: "customer", label: "고객 메모" },
];

export default function AdminMemoTemplates({ bizId }) {
  const [tab, setTab] = useState("sale");
  const [templates, setTemplates] = useState({ sale: "", reservation: "", customer: "" });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bizId) return;
    fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
      .then(r => r.json()).then(rows => {
        try {
          const s = JSON.parse(rows[0]?.settings || "{}");
          if (s.memo_templates) setTemplates(prev => ({ ...prev, ...s.memo_templates }));
        } catch {}
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [bizId]);

  const save = async () => {
    if (!bizId) return;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders });
      const rows = await r.json();
      let s = {}; try { s = JSON.parse(rows[0]?.settings || "{}"); } catch {}
      s.memo_templates = templates;
      await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`, {
        method: "PATCH", headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ settings: JSON.stringify(s) })
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert("저장 실패: " + e.message); }
  };

  if (loading) return <div style={{ padding: 20, color: T.gray400 }}>로딩...</div>;

  return <div>
    <APageHeader title="메모 템플릿" desc="각 메모 영역에서 📋 버튼을 누르면 템플릿이 자동으로 채워집니다" />

    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)}
        style={{ padding: "8px 16px", fontSize: 13, fontWeight: tab === t.id ? 800 : 500, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
          border: tab === t.id ? "2px solid " + T.primary : "1px solid " + T.border,
          background: tab === t.id ? T.primaryHover : T.bgCard,
          color: tab === t.id ? T.primary : T.gray500 }}>{t.label}</button>)}
    </div>

    {TABS.map(t => t.id === tab && <div key={t.id} className="card" style={{ padding: 16, border: "1px solid " + T.border, borderRadius: 10, background: T.bgCard }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: T.text }}>{t.label} 템플릿</div>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12 }}>
        매출등록, 예약모달, 고객관리에서 📋 버튼 클릭 시 이 내용이 메모에 채워집니다.
      </div>
      <textarea
        value={templates[t.id] || ""}
        onChange={e => setTemplates(prev => ({ ...prev, [t.id]: e.target.value }))}
        placeholder={t.id === "sale"
          ? "예) 1)메뉴+금액까지 상세히쓰세요\n  ① 시술내역 \n  ② 패키지  회차/   회남음\n\n2)관리페이지 패키지 차감처리 :\n3)모바일카드 차감 :\n..."
          : t.id === "reservation"
          ? "예) 특이사항:\n요청사항:\n주의사항:\n"
          : "예) 성격타입:\n선호시술:\n주의사항:\n"}
        style={{ width: "100%", minHeight: 250, padding: 12, fontSize: 13, lineHeight: 1.6, borderRadius: 8,
          border: "1px solid " + T.border, fontFamily: "inherit", resize: "vertical", background: T.bg }} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button onClick={save}
          style={{ padding: "8px 20px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none",
            background: T.primary, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>저장</button>
        {saved && <span style={{ fontSize: 12, color: T.successDk, fontWeight: 600 }}>✓ 저장됨</span>}
      </div>
    </div>)}
  </div>;
}
