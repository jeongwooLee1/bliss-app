import React, { useEffect, useState, useMemo } from 'react'
import { sb } from '../../lib/sb'
import { T } from '../../lib/constants'

// 매출 메모 + 시술 내역 날짜별 AI 요약 페이지
// URL: /sale-summary?cust=<cust_num>  (디폴트 44700)
export default function SaleSummary() {
  const [state, setState] = useState({ loading: true, error: null, cust: null, sales: [], details: [] })
  const [ai, setAi] = useState({ loading: false, error: null, byDate: null })

  // 1. 데이터 로드
  useEffect(() => {
    const custNum = new URLSearchParams(window.location.search).get('cust') || '44700'
    let cancelled = false
    ;(async () => {
      try {
        const custs = await sb.get('customers', `&cust_num=eq.${custNum}&limit=1`)
        if (!custs?.length) {
          if (!cancelled) setState({ loading: false, error: `고객번호 ${custNum} 없음`, cust: null, sales: [], details: [] })
          return
        }
        const cust = custs[0]
        const sales = await sb.get('sales', `&cust_id=eq.${cust.id}&order=date.desc,created_at.desc`)
        let details = []
        const ids = (sales || []).map(s => s.id)
        if (ids.length) {
          details = await sb.get('sale_details', `&sale_id=in.(${ids.join(',')})&order=service_no.asc`)
        }
        if (!cancelled) setState({ loading: false, error: null, cust, sales: sales || [], details: details || [] })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: String(e?.message || e), cust: null, sales: [], details: [] })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 날짜별 raw 데이터 (AI 입력용)
  const grouped = useMemo(() => {
    const { sales, details } = state
    if (!sales?.length) return []
    const byDate = new Map()
    sales.forEach(s => {
      const dts = details
        .filter(d => d.sale_id === s.id && (d.unit_price || 0) > 0)
      const memo = (s.memo || '').trim()
      const arr = byDate.get(s.date) || []
      arr.push({ saleId: s.id, memo, items: dts.map(d => ({ name: d.service_name, qty: d.qty || 1, unit: d.unit_price || 0, kind: d.item_kind || null })), staffName: s.staffName || s.staff_name || '' })
      byDate.set(s.date, arr)
    })
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, list }))
  }, [state])

  // 2. Gemini AI 호출 — 데이터 로드 완료 후 1회
  useEffect(() => {
    if (state.loading || !grouped.length) return
    const geminiKey = window.__geminiKey || window.__systemGeminiKey
    if (!geminiKey) {
      setAi({ loading: false, error: 'Gemini 키 없음 (관리설정 → AI 설정에서 등록)', byDate: null })
      return
    }
    setAi({ loading: true, error: null, byDate: null })

    const input = grouped.map(g => ({
      date: g.date,
      sales: g.list.map(x => ({
        memo: x.memo,
        items: x.items.map(d => ({ name: d.name, amount: d.unit * d.qty })),
      })),
    }))

    const prompt = `미용실(왁싱샵) 고객의 매출 이력을 날짜별로 한 박스에 요약합니다.

각 날짜에 대해:
1. "specialNotes": 메모(memo)들에서 특이사항만 추출해서 1-2문장으로 짧게 요약.
   - 시술 후 트러블/통증, 고객 요청/취향, 부위 변경, 직원 코멘트, 인유두종/케어 메모 등
   - 결제 정보(금액·다담권 잔액·차감 등)는 제외
   - 시술 메뉴 나열·"메뉴+금액 상세히" 같은 양식 문구 제외
   - 없으면 빈 문자열 ""
2. "services": 실제 결제된 시술/제품만 [{name, amount}]. 다음은 제외:
   - [할인 ...] [보유권 ...] [이벤트 ...] [쿠폰 ...] [체험단] 같은 자동/특수 행
   - 같은 시술명이 여러 번이면 합산
   - 이름은 핵심만 짧게 (예: "브라질리언 + 인중" 그대로 OK)

응답은 반드시 JSON only, 다른 설명 금지:
{"byDate":[{"date":"YYYY-MM-DD","specialNotes":"...","services":[{"name":"...","amount":number}]}]}

날짜는 입력 순서(최신순) 그대로 유지.

데이터:
${JSON.stringify(input)}`

    let cancelled = false
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (!text) throw new Error('AI 응답 비어있음: ' + JSON.stringify(data?.error || data).slice(0, 200))
        const parsed = JSON.parse(text)
        setAi({ loading: false, error: null, byDate: parsed.byDate || [] })
      })
      .catch(e => {
        if (cancelled) return
        setAi({ loading: false, error: String(e?.message || e), byDate: null })
      })
    return () => { cancelled = true }
  }, [state.loading, grouped.length])

  const fmt = (n) => (Number(n || 0)).toLocaleString()
  const dayLabel = (ds) => {
    const d = new Date(ds)
    const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
    return `${ds} (${dow})`
  }

  if (state.loading) return <div style={{ padding: 24, fontSize: 14, color: T.textSub }}>매출 데이터 불러오는 중…</div>
  if (state.error) return <div style={{ padding: 24, fontSize: 14, color: T.danger }}>{state.error}</div>

  const { cust, sales } = state

  return <div style={{ padding: '20px 24px', maxWidth: 920, margin: '0 auto', fontFamily: 'inherit' }}>
    {/* 헤더 */}
    <div style={{ borderBottom: '2px solid ' + T.primary, paddingBottom: 12, marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>✨ AI 매출 요약 (TEST)</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: 0 }}>
        {cust?.name || '-'}
        <span style={{ fontSize: 13, color: T.textSub, fontWeight: 500, marginLeft: 6, fontFamily: 'monospace' }}>#{cust?.custNum || cust?.cust_num || '-'}</span>
      </h1>
      <div style={{ marginTop: 6, fontSize: 12, color: T.textSub }}>
        매출 {sales.length}건 · 날짜 {grouped.length}일
      </div>
      {cust?.memo && <div style={{ marginTop: 8, padding: '8px 12px', background: T.warningLt || '#FFF8E1', border: '1px solid ' + (T.warning || '#FFB74D'), borderRadius: 6, fontSize: 12, color: T.textSub, whiteSpace: 'pre-wrap' }}>
        <span style={{ fontWeight: 700, color: '#7a5a00' }}>📌 고객 메모: </span>{cust.memo}
      </div>}
    </div>

    {/* AI 상태 */}
    {ai.loading && <div style={{ padding: 16, marginBottom: 14, background: '#F0F9FF', border: '1px solid #7DD3FC', borderRadius: 8, fontSize: 13, color: '#0369A1', textAlign: 'center' }}>
      ✨ Gemini가 {grouped.length}일치 매출을 요약 중…
    </div>}
    {ai.error && <div style={{ padding: 12, marginBottom: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, color: T.danger }}>
      AI 호출 실패: {ai.error}
    </div>}

    {/* AI 결과 박스 — 날짜별 한 카드 */}
    {ai.byDate?.length > 0 && ai.byDate.map(d => {
      const total = (d.services || []).reduce((s, x) => s + (x.amount || 0), 0)
      return <div key={d.date} style={{
        marginBottom: 14,
        background: T.bgCard,
        border: '1px solid ' + T.border,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      }}>
        {/* 날짜 헤더 */}
        <div style={{
          padding: '10px 14px',
          background: 'linear-gradient(135deg,#f8f9fb,#f0f2f5)',
          borderBottom: '1px solid ' + T.border,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{dayLabel(d.date)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.primary }}>{fmt(total)}원</div>
        </div>
        <div style={{ padding: '10px 14px' }}>
          {/* AI 요약 특이사항 */}
          {d.specialNotes && <div style={{
            padding: '8px 10px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: '#78350F',
            marginBottom: (d.services?.length ? 10 : 0),
          }}>
            <span style={{ fontWeight: 700, marginRight: 6 }}>📝 특이사항</span>
            {d.specialNotes}
          </div>}
          {/* 시술 내역 — 금액 발생한 것만 */}
          {d.services?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {d.services.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 8px', fontSize: 12.5 }}>
                <span style={{ color: T.text, fontWeight: 500 }}>{s.name}</span>
                <span style={{ color: T.text, fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmt(s.amount)}원</span>
              </div>
            ))}
          </div>}
          {!d.specialNotes && !(d.services?.length) && <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>(특이사항·시술 없음)</div>}
        </div>
      </div>
    })}

    {/* AI 비활성/실패 시 fallback — 원본 메모 그대로 표시 */}
    {!ai.loading && !ai.byDate?.length && grouped.length > 0 && <div style={{ marginTop: 8, padding: 12, fontSize: 12, color: T.textMuted, background: T.gray100, borderRadius: 8 }}>
      AI 요약을 받지 못해 원본 메모를 보여줍니다.
      {grouped.map(g => (
        <div key={g.date} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid ' + T.border }}>
          <div style={{ fontWeight: 700, color: T.text }}>{dayLabel(g.date)}</div>
          {g.list.map(x => x.memo && <div key={x.saleId} style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.memo}</div>)}
        </div>
      ))}
    </div>}

    {grouped.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>매출 이력 없음</div>}

    <div style={{ marginTop: 24, padding: 12, fontSize: 11, color: T.textMuted, textAlign: 'center', borderTop: '1px solid ' + T.border }}>
      💡 다른 고객 보기: <code style={{ background: T.gray100, padding: '1px 6px', borderRadius: 3 }}>?cust=고객번호</code>
    </div>
  </div>
}
