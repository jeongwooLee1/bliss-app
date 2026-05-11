import React, { useState, useMemo } from 'react'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import I from '../common/I'
import { APageHeader, AInp, AIBtn } from './AdminUI'

// 패키지 카테고리 시술의 회수(pkgCount)를 일괄 입력/수정하는 페이지
// 시술상품관리에서 카테고리=패키지인 시술만 노출, 회수 inline 편집
export default function AdminPkgCount({ data, setData }) {
  const [edits, setEdits] = useState({}); // { svcId: pkgCount }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // 패키지 카테고리에 속하는 시술만
  const pkgCat = useMemo(() => (data?.categories || []).find(c => c.name === '패키지'), [data?.categories]);
  const pkgServices = useMemo(() => {
    if (!pkgCat) return [];
    return (data?.services || [])
      .filter(s => s.cat === pkgCat.id)
      .filter(s => s.isActive !== false && s.is_active !== false)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [data?.services, pkgCat]);

  const onChange = (svcId, value) => {
    const v = value.replace(/[^\d]/g, "");
    setEdits(prev => ({ ...prev, [svcId]: v }));
  };

  const dirtySvcs = useMemo(() => pkgServices.filter(s => {
    const ed = edits[s.id];
    if (ed === undefined) return false;
    return Number(ed) !== Number(s.pkgCount || 0);
  }), [pkgServices, edits]);

  const saveAll = async () => {
    if (dirtySvcs.length === 0) { setMsg("변경된 항목이 없습니다"); return; }
    setSaving(true);
    setMsg("");
    try {
      // 병렬 업데이트
      await Promise.all(dirtySvcs.map(s => {
        const newCount = Number(edits[s.id]) || 0;
        return sb.update("services", s.id, { pkg_count: newCount, is_package: true });
      }));
      // 로컬 state 동기화
      setData(prev => ({
        ...prev,
        services: (prev.services || []).map(s => {
          if (edits[s.id] === undefined) return s;
          const newCount = Number(edits[s.id]) || 0;
          return { ...s, pkgCount: newCount, isPackage: true };
        })
      }));
      setEdits({});
      setMsg(`✓ ${dirtySvcs.length}건 저장 완료`);
    } catch (e) {
      setMsg("저장 실패: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!pkgCat) {
    return <div>
      <APageHeader title="패키지 회수 일괄 입력" />
      <div className="card" style={{ padding: 24, textAlign: "center", color: T.textMuted }}>
        <I name="archive" size={32} style={{ color: T.gray400, marginBottom: 8 }} />
        <div style={{ fontSize: T.fs.sm, marginBottom: 4 }}>'패키지' 카테고리를 찾을 수 없습니다</div>
        <div style={{ fontSize: T.fs.xxs }}>관리설정 → 시술 상품 관리 → 카테고리 편집에서 '패키지' 카테고리를 먼저 만들어주세요</div>
      </div>
    </div>;
  }

  return <div>
    <APageHeader title="패키지 회수 일괄 입력" />

    <div className="card" style={{ padding: 16, marginBottom: 14, background: "#FEF3C7", border: "1px solid #FDE68A" }}>
      <div style={{ fontSize: T.fs.xs, color: "#92400E", lineHeight: 1.6 }}>
        <b><I name="alert" size={11} style={{ marginRight: 4 }} />중요</b> — 여기서 입력한 회수는 <b>이후 발급되는 신규 패키지부터 적용</b>됩니다.
        이미 고객에게 발급된 패키지의 잔여회차는 <b>변경되지 않습니다</b>.
      </div>
    </div>

    {pkgServices.length === 0 ? (
      <div className="card" style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: T.fs.sm }}>
        '패키지' 카테고리에 등록된 시술이 없습니다
      </div>
    ) : (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px", gap: 0, padding: "10px 16px", background: T.gray100, fontSize: T.fs.xxs, fontWeight: T.fw.bolder, color: T.textSub, letterSpacing: 0.3, textTransform: "uppercase" }}>
          <div>시술명</div>
          <div style={{ textAlign: "right" }}>현재 회수</div>
          <div style={{ textAlign: "right" }}>새 회수</div>
        </div>
        {pkgServices.map(s => {
          const cur = Number(s.pkgCount || 0);
          const ed = edits[s.id];
          const newVal = ed === undefined ? cur : Number(ed) || 0;
          const isDirty = ed !== undefined && newVal !== cur;
          const isUnset = cur === 0;
          return <div key={s.id}
            style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px", gap: 0, padding: "10px 16px", borderTop: "1px solid " + T.gray100, alignItems: "center", background: isDirty ? "#FFFBEB" : "transparent" }}>
            <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bold, color: T.text }}>
              {s.name}
              {isUnset && <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", borderRadius: 6, background: T.danger + "22", color: T.danger, fontWeight: T.fw.bolder }}>미설정</span>}
            </div>
            <div style={{ textAlign: "right", fontSize: T.fs.sm, color: isUnset ? T.danger : T.gray700, fontWeight: T.fw.bold, fontFamily: "monospace" }}>
              {isUnset ? "-" : `${cur}회`}
            </div>
            <div style={{ textAlign: "right" }}>
              <input
                type="text"
                inputMode="numeric"
                value={ed !== undefined ? ed : (cur || "")}
                onChange={e => onChange(s.id, e.target.value)}
                placeholder={isUnset ? "회수" : ""}
                style={{ ...AInp, width: 80, textAlign: "right", padding: "6px 8px", borderColor: isDirty ? T.primary : "#e8e8f0" }}
                onFocus={e => e.target.style.borderColor = T.primary}
                onBlur={e => e.target.style.borderColor = isDirty ? T.primary : "#e8e8f0"}
              />
            </div>
          </div>;
        })}
      </div>
    )}

    {pkgServices.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, padding: "12px 16px", background: "#fff", borderRadius: 10, border: "1px solid " + T.border }}>
      <div style={{ flex: 1, fontSize: T.fs.xs, color: T.textSub }}>
        {dirtySvcs.length > 0
          ? <span><b style={{ color: T.primary }}>{dirtySvcs.length}건</b> 변경됨 — 저장 누르면 적용</span>
          : <span style={{ color: T.textMuted }}>변경 없음</span>}
      </div>
      {msg && <span style={{ fontSize: T.fs.xs, color: msg.startsWith("✓") ? T.success : T.danger, fontWeight: T.fw.bold }}>{msg}</span>}
      <AIBtn onClick={saveAll} saving={saving} disabled={saving || dirtySvcs.length === 0} label={`저장 (${dirtySvcs.length})`} />
    </div>}
  </div>;
}
