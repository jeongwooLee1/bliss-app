import React, { useState, useEffect, useMemo } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, SB_KEY, sbHeaders } from '../../lib/sb'
import I from '../common/I'
import { AField, AInp, AEmpty, APageHeader, ABadge, AIBtn } from './AdminUI'
import AdminAIDocs from './AdminAIDocs'
import { loadFaqItems, saveFaqItem, deleteFaqItem, updateFaqMeta, bulkImportFaq } from '../../lib/faqStore'

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
  const [faqNewCore, setFaqNewCore] = useState(false)
  const [faqEditCore, setFaqEditCore] = useState(false)
  const [faqBusy, setFaqBusy] = useState(false)
  const [faqMsg, setFaqMsg] = useState("")
  const [migrating, setMigrating] = useState("")  // 마이그레이션 진행 텍스트

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
          // FAQ는 RAG 청크(document_chunks)에서 로드 (확장형). ai_faq(레거시/핵심)는 core 동기화 참조용.
          loadFaqItems(bizId).then(items => {
            if (items.length === 0 && Array.isArray(memo.ai_faq) && memo.ai_faq.length) {
              // 아직 청크로 이관 전 — 레거시 ai_faq를 보여주되 chunkId 없음(이관 버튼 안내)
              setFaqItems(memo.ai_faq.map(f => ({ ...f, chunkId: null, core: true })))
            } else setFaqItems(items)
          }).catch(() => {})

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

  // ── FAQ 액션 (RAG 청크 기반 · 항목별 임베딩) ─────────────────
  const _faqKey = () => apiKey.trim() || (typeof window !== "undefined" && (window.__systemGeminiKey || window.__geminiKey)) || localStorage.getItem("bliss_gemini_key") || ""
  const reloadFaq = async () => { try { setFaqItems(await loadFaqItems(bizId)) } catch {} }
  // 핵심(core) 항목을 settings.ai_faq에 동기화 → 서버가 항상 직접 주입 (RAG가 놓쳐도 보장)
  const syncCore = async (items) => {
    const core = (items || []).filter(f => f.core && f.active !== false).map(f => ({ q: f.q, a: f.a, active: true, category: f.category || "기타" }))
    try { await patchSettings(memo => { memo.ai_faq = core }) } catch {}
  }
  const _afterFaqChange = async () => {
    const items = await loadFaqItems(bizId).catch(() => [])
    setFaqItems(items); await syncCore(items)
    setFaqSaved(true); setTimeout(() => setFaqSaved(false), 1800)
  }
  const addFAQ = async () => {
    const q = faqNewQ.trim(), a = faqNewA.trim()
    if (!q || !a) return
    if (!_faqKey()) { setFaqMsg("Gemini 키가 없어 FAQ 임베딩 불가 (운영자 문의)"); return }
    setFaqBusy(true); setFaqMsg("")
    try {
      await saveFaqItem(bizId, { q, a, category: faqNewCat || "기타", core: faqNewCore }, _faqKey())
      setFaqNewQ(""); setFaqNewA(""); setFaqNewCore(false)
      await _afterFaqChange()
    } catch (e) { setFaqMsg("저장 실패: " + (e?.message || e)) }
    finally { setFaqBusy(false) }
  }
  const delFAQ = async (item) => {
    if (!item.chunkId) { setFaqMsg("레거시 항목 — 먼저 '기존 FAQ 이관'을 실행하세요"); return }
    setFaqBusy(true)
    try { await deleteFaqItem(item.chunkId); await _afterFaqChange() }
    finally { setFaqBusy(false) }
  }
  const toggleFAQ = async (item) => {
    if (!item.chunkId) return
    await updateFaqMeta(item.chunkId, { ...item, active: item.active === false })
    await _afterFaqChange()
  }
  const toggleCore = async (item) => {
    if (!item.chunkId) return
    await updateFaqMeta(item.chunkId, { ...item, core: !item.core })
    await _afterFaqChange()
  }
  const startEditFAQ = item => { setFaqEditIdx(item.chunkId); setFaqEditQ(item.q); setFaqEditA(item.a); setFaqEditCat(item.category || ""); setFaqEditCore(!!item.core) }
  const saveEditFAQ = async (item) => {
    const q = faqEditQ.trim(), a = faqEditA.trim()
    if (!q || !a) return
    if (!_faqKey()) { setFaqMsg("Gemini 키 없음"); return }
    setFaqBusy(true); setFaqMsg("")
    try {
      await saveFaqItem(bizId, { chunkId: item.chunkId, q, a, category: faqEditCat || "기타", core: faqEditCore, active: item.active }, _faqKey())
      setFaqEditIdx(null)
      await _afterFaqChange()
    } catch (e) { setFaqMsg("저장 실패: " + (e?.message || e)) }
    finally { setFaqBusy(false) }
  }
  // 기존 FAQ 이관 — 레거시 ai_faq + 학습문서 housewaxing_faq.md 의 Q&A를 항목별 RAG 청크로 변환
  const migrateLegacyFaq = async () => {
    if (!_faqKey()) { setFaqMsg("Gemini 키 없음"); return }
    if (!confirm("기존 FAQ(설정 ai_faq + 학습문서 housewaxing_faq.md)를 항목별로 이관하고, 원본 학습문서는 정리합니다. 진행할까요?")) return
    setMigrating("준비 중…")
    try {
      // 1) 현재 청크 FAQ 질문 set (중복 방지)
      const existing = await loadFaqItems(bizId).catch(() => [])
      const seen = new Set(existing.map(f => (f.q || "").trim()))
      const toImport = []
      // 2) 레거시 ai_faq (settings)
      const sr = await fetch(`${SB_URL}/rest/v1/businesses?id=eq.${bizId}&select=settings`, { headers: sbHeaders })
      let memo = {}; try { memo = JSON.parse((await sr.json())[0]?.settings || "{}") } catch {}
      for (const f of (memo.ai_faq || [])) { if (f.q && !seen.has(f.q.trim())) { seen.add(f.q.trim()); toImport.push({ q: f.q, a: f.a, category: f.category || "기타", core: true }) } }
      // 3) 학습문서 housewaxing_faq.md 청크 파싱
      const dr = await fetch(`${SB_URL}/rest/v1/documents?business_id=eq.${bizId}&name=eq.housewaxing_faq.md&select=id`, { headers: sbHeaders })
      const docs = await dr.json(); const faqDocId = docs?.[0]?.id
      if (faqDocId) {
        const cr = await fetch(`${SB_URL}/rest/v1/document_chunks?document_id=eq.${faqDocId}&select=content&order=chunk_index`, { headers: sbHeaders })
        const chunks = await cr.json()
        const full = (Array.isArray(chunks) ? chunks : []).map(c => c.content || "").join("\n")
        let cat = "기타"
        const re = /(?:\[섹션[:：]\s*(.+?)\])|(?:\*\*Q[.\s]*(.+?)\*\*\s*\n+A[.\s]*([\s\S]*?)(?=\n\*\*Q|\n\[섹션|\n---|\n##|$))/g
        let m
        while ((m = re.exec(full))) {
          if (m[1]) { cat = m[1].replace(/^\d+\.\s*/, "").trim() || "기타"; continue }
          const q = (m[2] || "").trim(), a = (m[3] || "").trim().replace(/\n{2,}/g, "\n")
          if (q && a && !seen.has(q)) { seen.add(q); toImport.push({ q, a, category: cat, core: false }) }
        }
      }
      if (toImport.length === 0) { setMigrating(""); setFaqMsg("이관할 새 FAQ가 없습니다 (이미 이관됨)"); return }
      setMigrating(`임베딩·저장 중 0/${toImport.length}`)
      await bulkImportFaq(bizId, toImport, _faqKey(), (d, t) => setMigrating(`임베딩·저장 중 ${d}/${t}`))
      // 4) 원본 학습문서 삭제 (중복 검색 방지)
      if (faqDocId) {
        await fetch(`${SB_URL}/rest/v1/document_chunks?document_id=eq.${faqDocId}`, { method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" } }).catch(() => {})
        await fetch(`${SB_URL}/rest/v1/documents?id=eq.${faqDocId}`, { method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" } }).catch(() => {})
      }
      setMigrating("")
      setFaqMsg(`✓ ${toImport.length}개 이관 완료`)
      await _afterFaqChange()
    } catch (e) { setMigrating(""); setFaqMsg("이관 실패: " + (e?.message || e)) }
  }
  // 필터된 FAQ 목록
  const { filteredFAQs, faqCategories } = useMemo(() => {
    const cats = [...new Set(faqItems.map(f => f.category).filter(Boolean))].sort()
    const kw = faqSearch.trim().toLowerCase()
    const filtered = faqItems
      .filter(f => {
        if (faqCatFilter !== "all" && (f.category || "기타") !== faqCatFilter) return false
        if (faqActiveFilter === "active" && f.active === false) return false
        if (faqActiveFilter === "inactive" && f.active !== false) return false
        if (!kw) return true
        return (f.q + ' ' + f.a).toLowerCase().includes(kw)
      })
    return { filteredFAQs: filtered, faqCategories: cats }
  }, [faqItems, faqSearch, faqCatFilter, faqActiveFilter])
  // 카테고리별 활성/비활성 일괄 토글 (메타만 — 재임베딩 없음)
  const bulkToggleByCat = async (cat, on) => {
    if (!confirm(`${cat === 'all' ? '전체' : cat} FAQ를 ${on ? '활성' : '비활성'}으로 변경할까요?`)) return
    setFaqBusy(true)
    try {
      for (const f of faqItems) {
        if (!f.chunkId) continue
        if (cat === 'all' || (f.category || '기타') === cat) await updateFaqMeta(f.chunkId, { ...f, active: on })
      }
      await _afterFaqChange()
    } finally { setFaqBusy(false) }
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

    {/* 1) API 키 — 운영자(테라포트)가 시스템 전역 키로 관리. 매장 사용자는 쓸 일 없어 화면에서 숨김 */}
    {false && <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="sparkles" title="🔑 API 키" desc="Gemini 키 하나로 앱 전체 AI가 작동합니다"
        open={openKey} onToggle={() => setOpenKey(v => !v)}
        right={hasSystemKey && <ABadge color={T.success}>시스템 키 사용 중</ABadge>} />
      {openKey && <div style={{ padding: "16px 18px" }}>
        {hasSystemKey ? <div style={{ fontSize: T.fs.xs, color: T.textSub, padding: "10px 12px", background: "#f0faf4", borderRadius: 8, lineHeight: 1.6 }}>
          ✓ 시스템 전역 키로 작동 중입니다. 매장에서 따로 키를 입력하실 필요 없어요.
        </div> : <>
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
        </>}
      </div>}
    </div>}

    {/* ── 2) FAQ ───────────────────────────────── */}
    <div className="card" style={{ padding: 0, marginBottom: 10 }}>
      <SectionHeader icon="msgSq"
        title="📘 FAQ"
        desc="블리스AI 채팅 + 받은메시지함 자동응답이 공용으로 사용합니다"
        open={openFaq} onToggle={() => setOpenFaq(v => !v)}
        right={<ABadge color={T.primary}>{faqItems.filter(f => f.active !== false).length}/{faqItems.length}</ABadge>} />
      {openFaq && <div style={{ padding: "16px 18px" }}>
        {faqSaved && <div style={{ fontSize: T.fs.xxs, color: T.success, fontWeight: 700, marginBottom: 8 }}>✓ 저장됨</div>}
        {faqMsg && <div style={{ fontSize: T.fs.xs, color: faqMsg.startsWith("✓") ? T.success : T.danger, fontWeight: 700, marginBottom: 8 }}>{faqMsg}</div>}
        <div style={{ fontSize: T.fs.xxs, color: T.textMuted, background: "#F5F3FF", borderRadius: 8, padding: "8px 12px", marginBottom: 10, lineHeight: 1.6 }}>
          FAQ는 <strong>RAG 검색형</strong>이라 수백 개도 비용 걱정 없어요 (질문과 관련된 것만 AI가 찾아 답). <strong>★ 핵심</strong> 표시한 항목만 항상 직접 주입됩니다.
          {migrating
            ? <div style={{ marginTop: 6, color: T.primary, fontWeight: 700 }}>이관 중… {migrating}</div>
            : <div style={{ marginTop: 6 }}><button onClick={migrateLegacyFaq} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, border: "1px solid " + T.primary, background: "#fff", color: T.primary, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>기존 FAQ 이관 (설정 6개 + 학습문서 250개 → 항목별)</button></div>}
        </div>

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
              const editing = !!f.chunkId && faqEditIdx === f.chunkId
              return <div key={f.chunkId || f.q} style={{
                border: "1.5px solid " + (f.active === false ? T.gray300 : (f.core ? "#C4B5FD" : T.border)),
                borderRadius: 10, padding: "12px 14px",
                background: f.active === false ? "#fafafa" : (f.core ? "#FAF8FF" : "#fff"),
                opacity: f.active === false ? 0.55 : 1,
              }}>
                {editing
                  ? <div>
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>질문</div>
                    <input style={{ ...AInp, marginBottom: 8 }} value={faqEditQ} onChange={e => setFaqEditQ(e.target.value)} placeholder="고객 질문" />
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>답변</div>
                    <textarea style={{ ...AInp, minHeight: 80, resize: "vertical", marginBottom: 8, lineHeight: 1.6 }} value={faqEditA} onChange={e => setFaqEditA(e.target.value)} placeholder="답변 내용" />
                    <div style={{ fontSize: T.fs.xxs, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>카테고리</div>
                    <input style={{ ...AInp, marginBottom: 8 }} value={faqEditCat} onChange={e => setFaqEditCat(e.target.value)} placeholder="예: 사후관리&트러블" list="faq-cat-list-edit" />
                    <datalist id="faq-cat-list-edit">{faqCategories.map(c => <option key={c} value={c} />)}</datalist>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: T.fs.xs, color: T.textSub, marginBottom: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={faqEditCore} onChange={e => setFaqEditCore(e.target.checked)} /> ★ 핵심 (항상 직접 주입 — 절대 틀리면 안 되는 단답)
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <AIBtn onClick={() => saveEditFAQ(f)} disabled={faqBusy || !faqEditQ.trim() || !faqEditA.trim()} label={faqBusy ? "저장중…" : "저장"} style={{ flex: 1 }} />
                      <button onClick={() => setFaqEditIdx(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid " + T.border, background: "none", fontSize: T.fs.sm, fontWeight: 600, color: T.textSub, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
                    </div>
                  </div>
                  : <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                        {f.core && <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 10, background: "#EDE7F6", color: "#5B21B6" }}>★ 핵심</span>}
                        {f.category && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: T.primaryLt, color: T.primaryDk }}>{f.category}</span>}
                        {!f.chunkId && <span style={{ fontSize: 10, fontWeight: 700, color: T.danger }}>미이관(이관 버튼 실행 필요)</span>}
                      </div>
                      <div style={{ fontSize: T.fs.sm, color: T.text, fontWeight: 700, lineHeight: 1.5, marginBottom: 6 }}>
                        <span style={{ color: T.primary, marginRight: 6 }}>Q.</span>{f.q}
                      </div>
                      <div style={{ fontSize: T.fs.xs, color: T.gray700, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: T.success, marginRight: 6, fontWeight: 700 }}>A.</span>{f.a}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => toggleCore(f)} disabled={!f.chunkId || faqBusy} title={f.core ? "핵심 해제" : "핵심 지정(항상 직접 주입)"} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + (f.core ? "#C4B5FD" : T.border), background: f.core ? "#EDE7F6" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: f.core ? "#5B21B6" : T.gray400 }}>{f.core ? "★" : "☆"}</button>
                      <button onClick={() => toggleFAQ(f)} disabled={!f.chunkId || faqBusy} title={f.active === false ? "활성화" : "비활성화"} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.border, background: f.active === false ? "#fff" : "#f0faf4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: f.active === false ? T.gray500 : T.success }}>{f.active === false ? "OFF" : "ON"}</button>
                      <button onClick={() => startEditFAQ(f)} disabled={!f.chunkId} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.border, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I name="edit" size={12} style={{ color: T.gray500 }} /></button>
                      <button onClick={() => { if (confirm("이 FAQ를 삭제하시겠어요?")) delFAQ(f) }} disabled={faqBusy} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #fecaca", background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><I name="trash" size={12} style={{ color: T.danger }} /></button>
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
          <input style={{ ...AInp, marginBottom: 8 }} value={faqNewCat} onChange={e => setFaqNewCat(e.target.value)} placeholder="예: 사후관리&트러블 (기존 카테고리 선택 or 새로 입력)" list="faq-cat-list-new" />
          <datalist id="faq-cat-list-new">{faqCategories.map(c => <option key={c} value={c} />)}</datalist>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: T.fs.xs, color: T.textSub, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={faqNewCore} onChange={e => setFaqNewCore(e.target.checked)} /> ★ 핵심 (항상 직접 주입 — 절대 틀리면 안 되는 단답만)
          </label>
          <AIBtn onClick={addFAQ} disabled={faqBusy || !faqNewQ.trim() || !faqNewA.trim()} label={faqBusy ? "추가중…" : "FAQ 추가"} />
        </div>
      </div>}
    </div>

    {/* 3) 메시지함 자동응대 프롬프트 · 4) 네이버 예약 AI 분석 프롬프트 — 현재 서버 코드 프롬프트로 동작(설정값 미사용)이라 화면에서 숨김.
        자동응답 지식은 FAQ + 학습문서(RAG)로 관리. (관련 state/save 함수는 호환 위해 보존) */}

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
