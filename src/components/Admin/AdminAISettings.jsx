import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { AField, AInp, AEmpty, APageHeader, ABadge, AIBtn } from './AdminUI'
import AdminAIDocs from './AdminAIDocs'

// AI 설정 — 단일 페이지 4섹션 (아코디언)
// 1) 🔑 API 키   2) 📘 FAQ (블리스AI + 메시지함 공용)
// 3) 💬 메시지함 자동 응대 프롬프트   4) 🔍 네이버 예약 AI 분석 프롬프트
// 모델: Gemini 2.5 Flash 하나로 모든 AI 기능 작동
function AdminAISettings({ data, sb: sbProp, bizId }) {
  const hasSystemKey = !!window.__systemGeminiKey

  // ── 섹션 펼침 상태 ─────────────────────────────────
  const [openKey, setOpenKey]   = useState(!hasSystemKey)  // 시스템키 없으면 기본 펼침
  const [openFaq, setOpenFaq]   = useState(true)
  const [openChat, setOpenChat] = useState(false)
  const [openAnal, setOpenAnal] = useState(false)
  const [openDocs, setOpenDocs] = useState(false)

  // ── API 키 ─────────────────────────────────────────
  const [apiKey, setApiKey] = useState(() => window.__systemGeminiKey || window.__geminiKey || localStorage.getItem("bliss_gemini_key") || "")
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // ── 프롬프트 ───────────────────────────────────────
  const [chatPrompt, setChatPrompt] = useState(() => localStorage.getItem("bliss_ai_chat_prompt") || "")
  const [chatSaved, setChatSaved] = useState(false)
  const [analyzePrompt, setAnalyzePrompt] = useState(() => localStorage.getItem("bliss_ai_analyze_prompt") || "")
  const [analyzeSaved, setAnalyzeSaved] = useState(false)

  // ── FAQ ────────────────────────────────────────────
  const [faqItems, setFaqItems] = useState([])
  const [faqNewQ, setFaqNewQ] = useState("")
  const [faqNewA, setFaqNewA] = useState("")
  const [faqNewCat, setFaqNewCat] = useState("")
  const [faqEditIdx, setFaqEditIdx] = useState(null)
  const [faqEditQ, setFaqEditQ] = useState("")
  const [faqEditA, setFaqEditA] = useState("")
  const [faqEditCat, setFaqEditCat] = useState("")
  const [faqSaved, setFaqSaved] = useState(false)
  const [faqSearch, setFaqSearch] = useState("")
  const [faqCatFilter, setFaqCatFilter] = useState("all")
  const [faqActiveFilter, setFaqActiveFilter] = useState("all") // all | active | inactive

  // ── DB 로드 + ai_rules 레거시 마이그레이션 ──────────────
  useEffect(() => {
    if (!bizId) return
    fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
      .then(r => r.json())
      .then(async rows => {
        try {
          const memo = JSON.parse(rows[0]?.settings || "{}")
          if (memo.gemini_key) { setApiKey(memo.gemini_key); localStorage.setItem("bliss_gemini_key", memo.gemini_key) }
          if (memo.ai_chat_prompt != null) { setChatPrompt(memo.ai_chat_prompt); localStorage.setItem("bliss_ai_chat_prompt", memo.ai_chat_prompt); window.__aiChatPrompt = memo.ai_chat_prompt }
          if (Array.isArray(memo.ai_faq)) setFaqItems(memo.ai_faq)

          // ── ai_rules → ai_analyze_prompt 마이그레이션 ──
          // 기존 rules 리스트가 있고 analyze_prompt에 {custom_rules} 변수가 있으면 그대로 → 변수는 서버가 주입
          // rules 리스트는 이제 UI에서 제거. 저장된 rules 유지하되 표시 안 함.
          let analyze = memo.ai_analyze_prompt
          if (analyze == null || analyze === "") {
            // 프롬프트 비어있으면 — rules를 합친 기본 템플릿 자동 생성 (최초 1회)
            if (Array.isArray(memo.ai_rules) && memo.ai_rules.length) {
              const rulesTxt = memo.ai_rules.map((r, i) => `- ${r}`).join('\n')
              analyze = [
                '당신은 왁싱샵 예약 정보를 분석하는 AI입니다.',
                '[태그 목록] {tags}',
                '[시술상품 목록] {services}',
                '',
                '[규칙]',
                "- 태그 목록에 있는 태그만 선택",
                "- '신규','예약금완료' 제외",
                "- 음모왁싱/음부왁싱/브라질리언왁싱 = 브라질리언",
                rulesTxt,
                '',
                '[예약 정보]',
                '고객명: {cust_name}',
                '방문횟수: {visit_count}',
                '',
                '[고객 요청]',
                '{naver_text}',
              ].join('\n')
              // 즉시 저장
              try {
                const r2 = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
                const rows2 = await r2.json()
                let memo2 = {}; try { memo2 = JSON.parse(rows2[0]?.settings || "{}") } catch {}
                memo2.ai_analyze_prompt = analyze
                await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`, {
                  method: "PATCH",
                  headers: { ...sbHeaders, Prefer: "return=minimal" },
                  body: JSON.stringify({ settings: JSON.stringify(memo2) }),
                })
              } catch {}
            }
          }
          if (analyze != null) { setAnalyzePrompt(analyze); localStorage.setItem("bliss_ai_analyze_prompt", analyze) }
        } catch (e) {}
      })
      .catch(() => {})
  }, [bizId])

  // ── 저장 헬퍼 ─────────────────────────────────────
  const patchSettings = async (updater) => {
    if (!bizId) return
    const r = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
    const rows = await r.json()
    let memo = {}; try { memo = JSON.parse(rows[0]?.settings || "{}") } catch {}
    updater(memo)
    await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ settings: JSON.stringify(memo) }),
    })
  }

  const saveKey = async () => {
    const t = apiKey.trim()
    localStorage.setItem("bliss_gemini_key", t)
    window.__geminiKey = t
    try { await patchSettings(memo => { memo.gemini_key = t }) } catch {}
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const testKey = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey.trim(),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "안녕" }] }] }) })
      setTestResult(r.ok ? "✓ 연결 성공" : "✕ 연결 실패 (" + r.status + ")")
    } catch (e) { setTestResult("✕ " + e.message) }
    finally { setTesting(false) }
  }

  const saveAnalyzePrompt = async () => {
    const t = analyzePrompt
    localStorage.setItem("bliss_ai_analyze_prompt", t)
    try { await patchSettings(memo => { memo.ai_analyze_prompt = t }) } catch {}
    setAnalyzeSaved(true); setTimeout(() => setAnalyzeSaved(false), 2000)
  }

  const saveChatPrompt = async () => {
    const t = chatPrompt
    localStorage.setItem("bliss_ai_chat_prompt", t)
    window.__aiChatPrompt = t
    try { await patchSettings(memo => { memo.ai_chat_prompt = t }) } catch {}
    setChatSaved(true); setTimeout(() => setChatSaved(false), 2000)
  }

  // ── FAQ 액션 ─────────────────────────────────────
  const saveFAQ = async updated => {
    setFaqItems(updated)
    try {
      await patchSettings(memo => { memo.ai_faq = updated })
      setFaqSaved(true); setTimeout(() => setFaqSaved(false), 1800)
    } catch (e) {}
  }
  const addFAQ = () => {
    const q = faqNewQ.trim(), a = faqNewA.trim()
    if (!q || !a) return
    saveFAQ([...faqItems, { q, a, active: true, category: faqNewCat || "기타" }])
    setFaqNewQ(""); setFaqNewA("")
  }
  const delFAQ = i => saveFAQ(faqItems.filter((_, idx) => idx !== i))
  const toggleFAQ = i => saveFAQ(faqItems.map((f, idx) => idx === i ? { ...f, active: !f.active } : f))
  const startEditFAQ = i => { setFaqEditIdx(i); setFaqEditQ(faqItems[i].q); setFaqEditA(faqItems[i].a); setFaqEditCat(faqItems[i].category || "") }
  const saveEditFAQ = () => {
    const q = faqEditQ.trim(), a = faqEditA.trim()
    if (!q || !a) return
    saveFAQ(faqItems.map((f, i) => i === faqEditIdx ? { ...f, q, a, category: faqEditCat || "기타" } : f))
    setFaqEditIdx(null)
  }
  // 필터된 FAQ 목록
  const { filteredFAQs, faqCategories } = useMemo(() => {
    const cats = [...new Set(faqItems.map(f => f.category).filter(Boolean))].sort()
    const kw = faqSearch.trim().toLowerCase()
    const filtered = faqItems
      .map((f, i) => ({ ...f, _idx: i }))
      .filter(f => {
        if (faqCatFilter !== "all" && (f.category || "기타") !== faqCatFilter) return false
        if (faqActiveFilter === "active" && f.active === false) return false
        if (faqActiveFilter === "inactive" && f.active !== false) return false
        if (!kw) return true
        return (f.q + ' ' + f.a).toLowerCase().includes(kw)
      })
    return { filteredFAQs: filtered, faqCategories: cats }
  }, [faqItems, faqSearch, faqCatFilter, faqActiveFilter])
  // 카테고리별 활성/비활성 일괄 토글
  const bulkToggleByCat = (cat, on) => {
    if (!confirm(`${cat === 'all' ? '전체' : cat} FAQ를 ${on ? '활성' : '비활성'}으로 변경할까요?`)) return
    const next = faqItems.map(f => {
      if (cat === 'all' || (f.category || '기타') === cat) return { ...f, active: on }
      return f
    })
    saveFAQ(next)
  }

  // ── 섹션 헤더 ─────────────────────────────────────
  const SectionHeader = ({ icon, title, desc, open, onToggle, right }) => (
    <div onClick={onToggle}
      style={{
        padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
        borderBottom: open ? `1px solid ${T.border}` : "none", userSelect: "none"
      }}>
      <I name={icon} size={16} style={{ color: T.primary, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text }}>{title}</div>
        {desc && <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      {right}
      <I name={open ? "chevU" : "chevD"} size={14} style={{ color: T.gray500, flexShrink: 0 }} />
    </div>
  )

  return <div>
    <APageHeader title="AI 설정" desc="Gemini 2.5 Flash — 모든 AI 기능(블리스AI·메시지함·AI Book·예약분석)이 이 설정을 공유합니다" />

    {/* ── 1) API 키 ───────────────────────────────── */}
    <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="sparkles" title="🔑 API 키" desc="Gemini 키 하나로 앱 전체 AI가 작동합니다"
        open={openKey} onToggle={() => setOpenKey(v => !v)}
        right={hasSystemKey && <ABadge color={T.success}>시스템 키 사용 중</ABadge>} />
      {openKey && <div style={{ padding: "16px 18px" }}>
        {hasSystemKey && <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 12, padding: "8px 12px", background: "#f0faf4", borderRadius: 8, lineHeight: 1.5 }}>
          시스템에 전역 키가 이미 설정되어 있어요. 개인 키를 따로 등록하면 이 키가 우선 사용됩니다.
        </div>}
        <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: T.primary, fontWeight: 700 }}>Google AI Studio</a>에서 무료로 발급받을 수 있어요.
        </div>
        <AField label="Gemini API 키">
          <input style={AInp} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy…"
            onFocus={e => e.target.style.borderColor = T.primary} onBlur={e => e.target.style.borderColor = "#e8e8f0"} />
        </AField>
        {testResult && <div style={{ fontSize: T.fs.xs, padding: "8px 12px", borderRadius: 8, marginBottom: 12, background: testResult.startsWith("✓") ? "#f0faf4" : "#fff5f5", color: testResult.startsWith("✓") ? T.success : T.danger }}>{testResult}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={testKey} disabled={testing || !apiKey.trim()} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1.5px solid " + T.border, background: "#fff", fontSize: T.fs.sm, fontWeight: 600, color: T.textSub, cursor: "pointer", fontFamily: "inherit" }}>
            {testing ? "테스트 중…" : "연결 테스트"}
          </button>
          <AIBtn onClick={saveKey} disabled={!apiKey.trim()} label={saved ? "✓ 저장됨" : "저장"} style={{ flex: 1, background: saved ? T.success : T.primary }} />
        </div>
      </div>}
    </div>

    {/* ── 2) FAQ ───────────────────────────────── */}
    <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="msgSq"
        title="📘 FAQ"
        desc="블리스AI 채팅 + 받은메시지함 자동응답이 공용으로 사용합니다"
        open={openFaq} onToggle={() => setOpenFaq(v => !v)}
        right={<ABadge color={T.primary}>{faqItems.filter(f => f.active !== false).length}/{faqItems.length}</ABadge>} />
      {openFaq && <div style={{ padding: "16px 18px" }}>
        {faqSaved && <div style={{ fontSize: T.fs.xxs, color: T.success, fontWeight: 700, marginBottom: 8 }}>✓ 저장됨</div>}

        {/* 필터 바 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input value={faqSearch} onChange={e => setFaqSearch(e.target.value)} placeholder="🔍 질문/답변 검색"
            style={{ flex: "1 1 180px", minWidth: 0, padding: "8px 10px", fontSize: T.fs.xs, border: "1.5px solid " + T.border, borderRadius: 8, fontFamily: "inherit", outline: "none" }} />
          <select value={faqCatFilter} onChange={e => setFaqCatFilter(e.target.value)} style={{ padding: "8px 10px", fontSize: T.fs.xs, border: "1.5px solid " + T.border, borderRadius: 8, fontFamily: "inherit" }}>
            <option value="all">전체 카테고리</option>
            {faqCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={faqActiveFilter} onChange={e => setFaqActiveFilter(e.target.value)} style={{ padding: "8px 10px", fontSize: T.fs.xs, border: "1.5px solid " + T.border, borderRadius: 8, fontFamily: "inherit" }}>
            <option value="all">상태 전체</option>
            <option value="active">활성만</option>
            <option value="inactive">비활성만</option>
          </select>
        </div>

        {/* 일괄 토글 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, fontSize: T.fs.xxs, color: T.textMuted, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: T.gray600, fontWeight: 600 }}>일괄:</span>
          <button onClick={() => bulkToggleByCat(faqCatFilter, true)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "1px solid " + T.success, background: "#f0faf4", color: T.success, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>
            {faqCatFilter === "all" ? "전체" : faqCatFilter} ON
          </button>
          <button onClick={() => bulkToggleByCat(faqCatFilter, false)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "1px solid " + T.gray400, background: "#f7f7f7", color: T.gray600, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>
            {faqCatFilter === "all" ? "전체" : faqCatFilter} OFF
          </button>
          <span style={{ color: T.gray400 }}>·</span>
          <span>{filteredFAQs.length}개 표시</span>
        </div>

        {/* 목록 */}
        {filteredFAQs.length === 0
          ? <AEmpty icon="msgSq" message={faqItems.length === 0 ? "등록된 FAQ가 없어요. 아래에서 추가해보세요" : "필터 결과 없음"} />
          : <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, maxHeight: 560, overflowY: "auto", paddingRight: 4 }}>
            {filteredFAQs.map(f => {
              const i = f._idx
              return <div key={i} style={{
                border: "1.5px solid " + (f.active === false ? T.gray300 : T.border),
                borderRadius: 10, padding: "12px 14px",
                background: f.active === false ? "#fafafa" : "#fff",
                opacity: f.active === false ? 0.55 : 1,
              }}>
                {faqEditIdx === i
                  ? <div>
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>질문</div>
                    <input style={{ ...AInp, marginBottom: 8 }} value={faqEditQ} onChange={e => setFaqEditQ(e.target.value)} placeholder="고객 질문" />
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>답변</div>
                    <textarea style={{ ...AInp, minHeight: 80, resize: "vertical", marginBottom: 8, lineHeight: 1.6 }} value={faqEditA} onChange={e => setFaqEditA(e.target.value)} placeholder="답변 내용" />
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>카테고리</div>
                    <input style={{ ...AInp, marginBottom: 10 }} value={faqEditCat} onChange={e => setFaqEditCat(e.target.value)} placeholder="예: 사후관리&트러블" list="faq-cat-list-edit" />
                    <datalist id="faq-cat-list-edit">{faqCategories.map(c => <option key={c} value={c} />)}</datalist>
                    <div style={{ display: "flex", gap: 8 }}>
                      <AIBtn onClick={saveEditFAQ} disabled={!faqEditQ.trim() || !faqEditA.trim()} label="저장" style={{ flex: 1 }} />
                      <button onClick={() => setFaqEditIdx(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid " + T.border, background: "none", fontSize: T.fs.sm, fontWeight: 600, color: T.textSub, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
                    </div>
                  </div>
                  : <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        {f.category && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: T.primaryLt, color: T.primaryDk }}>{f.category}</span>}
                      </div>
                      <div style={{ fontSize: T.fs.sm, color: T.text, fontWeight: 700, lineHeight: 1.5, marginBottom: 6 }}>
                        <span style={{ color: T.primary, marginRight: 6 }}>Q.</span>{f.q}
                      </div>
                      <div style={{ fontSize: T.fs.xs, color: T.gray700, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: T.success, marginRight: 6, fontWeight: 700 }}>A.</span>{f.a}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => toggleFAQ(i)} title={f.active === false ? "활성화" : "비활성화"} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.border, background: f.active === false ? "#fff" : "#f0faf4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: f.active === false ? T.gray500 : T.success }}>{f.active === false ? "OFF" : "ON"}</button>
                      <button onClick={() => startEditFAQ(i)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.border, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I name="edit" size={12} style={{ color: T.gray500 }} /></button>
                      <button onClick={() => { if (confirm("이 FAQ를 삭제하시겠어요?")) delFAQ(i) }} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #fecaca", background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I name="trash" size={12} style={{ color: T.danger }} /></button>
                    </div>
                  </div>}
              </div>
            })}
          </div>
        }

        {/* 신규 추가 */}
        <div style={{ borderTop: "1px solid " + T.border, paddingTop: 16 }}>
          <div style={{ fontSize: T.fs.xs, fontWeight: T.fw.bolder, color: T.text, marginBottom: 10 }}>+ 새 FAQ 추가</div>
          <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>질문</div>
          <input style={{ ...AInp, marginBottom: 8 }} value={faqNewQ} onChange={e => setFaqNewQ(e.target.value)} placeholder="예: 처음인데 많이 아픈가요?" />
          <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>답변</div>
          <textarea style={{ ...AInp, minHeight: 90, resize: "vertical", marginBottom: 8, lineHeight: 1.6 }} value={faqNewA} onChange={e => setFaqNewA(e.target.value)} placeholder={"예: 처음엔 살짝 따끔하실 수 있어요. 2회차부터 훨씬 편해집니다 :)"} />
          <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>카테고리</div>
          <input style={{ ...AInp, marginBottom: 10 }} value={faqNewCat} onChange={e => setFaqNewCat(e.target.value)} placeholder="예: 사후관리&트러블 (기존 카테고리 선택 or 새로 입력)" list="faq-cat-list-new" />
          <datalist id="faq-cat-list-new">{faqCategories.map(c => <option key={c} value={c} />)}</datalist>
          <AIBtn onClick={addFAQ} disabled={!faqNewQ.trim() || !faqNewA.trim()} label="FAQ 추가" />
        </div>
      </div>}
    </div>

    {/* ── 3) 메시지함 자동 응대 프롬프트 ─────────────── */}
    <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="msgSq" title="💬 메시지함 자동 응대 프롬프트"
        desc="네이버톡톡·인스타·WhatsApp 등 고객 메시지에 AI가 답변할 때의 지침"
        open={openChat} onToggle={() => setOpenChat(v => !v)} />
      {openChat && <div style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
          영업시간·정책·금지 사항 등을 간결하게 작성하세요. 시술 가격표와 FAQ는 <strong>자동으로 포함</strong>됩니다.
        </div>
        <AField label="응대 지침">
          <textarea style={{ ...AInp, minHeight: 160, resize: "vertical", lineHeight: 1.7 }} value={chatPrompt} onChange={e => setChatPrompt(e.target.value)}
            placeholder={"예:\n- 영업시간: 오전 11시 ~ 오후 10시 (연중무휴)\n- 가격 문의 → 가격표 기준 정확히 안내\n- 할인/이벤트는 안내 금지\n- 예약은 네이버 링크로 유도"} />
        </AField>
        <AIBtn onClick={saveChatPrompt} label={chatSaved ? "✓ 저장됨" : "저장"} style={{ background: chatSaved ? T.success : T.primary }} />
      </div>}
    </div>

    {/* ── 4) 네이버 예약 AI 분석 프롬프트 ─────────────── */}
    <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="sparkles" title="🔍 네이버 예약 AI 분석 프롬프트"
        desc="네이버 예약 원문에서 태그·시술을 추출하는 프롬프트 (고급)"
        open={openAnal} onToggle={() => setOpenAnal(v => !v)} />
      {openAnal && <div style={{ padding: "16px 18px" }}>
        <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
          비워두면 시스템 기본 프롬프트를 사용합니다.<br />
          사용 가능 변수: <code>{"{tags}"}</code> <code>{"{services}"}</code> <code>{"{cust_name}"}</code> <code>{"{visit_count}"}</code> <code>{"{naver_text}"}</code>
        </div>
        <AField label="분석 프롬프트">
          <textarea style={{ ...AInp, minHeight: 240, resize: "vertical", lineHeight: 1.6, fontFamily: "monospace", fontSize: T.fs.xs }} value={analyzePrompt} onChange={e => setAnalyzePrompt(e.target.value)}
            placeholder={"비워두면 시스템 기본 프롬프트 사용\n\n예시:\n당신은 왁싱샵 예약 정보를 분석하는 AI입니다.\n[태그 목록] {tags}\n[시술상품 목록] {services}\n\n[규칙]\n- 태그 목록에 있는 태그만 선택\n- '신규','예약금완료' 제외\n- 음모왁싱/음부왁싱 = 브라질리언\n\n[예약 정보]\n고객명: {cust_name}\n방문횟수: {visit_count}\n\n[고객 요청]\n{naver_text}"} />
        </AField>
        <AIBtn onClick={saveAnalyzePrompt} label={analyzeSaved ? "✓ 저장됨" : "저장"} style={{ background: analyzeSaved ? T.success : T.primary }} />
      </div>}
    </div>

    {/* ── 5) 📚 학습 문서 (RAG) ─────────────────── */}
    <div style={{ marginBottom: 16, border: "1px solid " + T.border, borderRadius: 12, overflow: "hidden", background: T.bgCard }}>
      <SectionHeader icon="book" title="📚 학습 문서 (RAG)"
        desc="매장 매뉴얼/가격표/노하우 문서 업로드 → BlissAI가 검색해 답변에 활용"
        open={openDocs} onToggle={() => setOpenDocs(v => !v)} />
      {openDocs && <div style={{ padding: "16px 18px" }}>
        <AdminAIDocs bizId={bizId} geminiKey={apiKey} />
      </div>}
    </div>
  </div>
}

export default AdminAISettings
