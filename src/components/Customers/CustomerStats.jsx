import React, { useState, useEffect } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'
import { _activeBizId } from '../../lib/db'

// 고객 통계 — 월별·지점별 신규/기존 방문 (내국인/외국인 분리) + 그래프 + 기간 버튼.
// 집계: RPC get_customer_visit_trend(월별, 1000행 캡 회피용 분리) + get_customer_visit_branch(선택 월 지점별).
// 방문=매출발생, 신규=생애 첫 방문 달, 외국인=이름에 한글 없음.
const NEW = '#7C3AED', OLD = '#C4B5FD', FNEW = '#0E7490'

const _rpc = (fn, body) => fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.ok ? r.json() : []).then(d => Array.isArray(d) ? d : []).catch(() => [])

export default function CustomerStats({ data }) {
  const [trendRows, setTrendRows] = useState(null) // [{ym,n,o,fn,fo}] DESC
  const [branchRows, setBranchRows] = useState([]) // [{bid,n,o,fn,fo}] for sel
  const [branchLoading, setBranchLoading] = useState(false)
  const [sel, setSel] = useState(null)
  const [period, setPeriod] = useState(12) // 12/24/36/9999(전체)

  useEffect(() => {
    let alive = true
    _rpc('get_customer_visit_trend', { p_biz_id: _activeBizId, p_months: 600 })
      .then(d => { if (alive) setTrendRows(d) })
    return () => { alive = false }
  }, [])

  const allMonths = React.useMemo(() => (trendRows || []).map(r => r.ym), [trendRows])
  const months = React.useMemo(() => period >= 9999 ? allMonths : allMonths.slice(0, period), [allMonths, period])
  useEffect(() => { if (allMonths.length && !sel) setSel(allMonths[0]) }, [allMonths, sel])

  // 선택 월 지점별 — sel 바뀔 때 fetch
  useEffect(() => {
    if (!sel) return
    let alive = true
    setBranchLoading(true)
    _rpc('get_customer_visit_branch', { p_biz_id: _activeBizId, p_ym: sel })
      .then(d => { if (alive) { setBranchRows(d); setBranchLoading(false) } })
    return () => { alive = false }
  }, [sel])

  const brName = id => { const b = (data?.branches || []).find(x => x.id === id); return b ? (b.short || b.name) : (id || '(미지정)') }
  const fmt = n => Number(n || 0).toLocaleString()

  const byMonth = React.useMemo(() => {
    const m = {}; (trendRows || []).forEach(r => { m[r.ym] = { n: +r.n || 0, o: +r.o || 0, fn: +r.fn || 0, fo: +r.fo || 0 } }); return m
  }, [trendRows])
  const trend = React.useMemo(() => months.map(ym => ({ ym, ...(byMonth[ym] || { n: 0, o: 0, fn: 0, fo: 0 }) })), [months, byMonth])

  const byBranch = React.useMemo(() => {
    const m = {}; (branchRows || []).forEach(r => { m[r.bid || '(미지정)'] = { n: +r.n || 0, o: +r.o || 0, fn: +r.fn || 0, fo: +r.fo || 0 } }); return m
  }, [branchRows])
  const branchIds = React.useMemo(() => {
    const present = new Set(Object.keys(byBranch))
    const ordered = (data?.branches || []).map(b => b.id).filter(id => present.has(id))
    return [...ordered, ...[...present].filter(id => !ordered.includes(id))]
  }, [byBranch, data])

  if (!trendRows) return <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>통계 집계 중…</div>
  if (trendRows.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: T.textMuted }}>통계 데이터가 없습니다.</div>

  const th = { padding: '6px 9px', background: T.gray100, borderBottom: '1px solid ' + T.border, textAlign: 'right', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }
  const thC = { ...th, textAlign: 'center' }
  const thL = { ...th, textAlign: 'left' }
  const td = { padding: '6px 9px', borderBottom: '1px solid ' + T.border, fontSize: 13, textAlign: 'right' }
  const tdL = { ...td, textAlign: 'left', fontWeight: 600 }
  const subTd = { ...td, background: '#FAFAFE' }
  const BD = '1px solid ' + T.border

  const tot = branchIds.reduce((a, id) => { const v = byBranch[id]; a.n += v.n; a.o += v.o; a.fn += v.fn; a.fo += v.fo; return a }, { n: 0, o: 0, fn: 0, fo: 0 })

  const chart = [...trend].reverse() // 오래된→최신
  const chartMax = Math.max(1, ...chart.map(d => d.n + d.o + d.fn + d.fo))

  const GroupHead = ({ firstLabel }) => (
    <thead>
      <tr>
        <th style={thL} rowSpan={2}>{firstLabel}</th>
        <th style={{ ...thC, color: NEW, borderLeft: BD }} colSpan={3}>내국인</th>
        <th style={{ ...thC, color: FNEW, borderLeft: BD }} colSpan={3}>외국인</th>
        <th style={{ ...th, borderLeft: BD }} rowSpan={2}>총합</th>
      </tr>
      <tr>
        <th style={{ ...th, borderLeft: BD, color: NEW }}>신규</th>
        <th style={th}>기존</th>
        <th style={{ ...th, background: '#F0EDFF' }}>소계</th>
        <th style={{ ...th, borderLeft: BD, color: FNEW }}>신규</th>
        <th style={th}>기존</th>
        <th style={{ ...th, background: '#ECFAFF' }}>소계</th>
      </tr>
    </thead>
  )
  const DataCells = ({ v, bold }) => (<>
    <td style={{ ...td, color: NEW, fontWeight: 700, borderLeft: BD, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.n)}</td>
    <td style={{ ...td, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.o)}</td>
    <td style={{ ...subTd, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.n + v.o)}</td>
    <td style={{ ...td, color: FNEW, fontWeight: 700, borderLeft: BD, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.fn)}</td>
    <td style={{ ...td, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.fo)}</td>
    <td style={{ ...subTd, ...(bold ? { fontWeight: 800 } : {}) }}>{fmt(v.fn + v.fo)}</td>
    <td style={{ ...td, fontWeight: 800, borderLeft: BD }}>{fmt(v.n + v.o + v.fn + v.fo)}</td>
  </>)

  return (
    <div style={{ padding: '4px 2px 40px' }}>
      {/* 기간 버튼 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginRight: 4 }}>월별 방문 추이</span>
        {[[12, '1년'], [24, '2년'], [36, '3년'], [9999, '전체']].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            style={{ padding: '4px 12px', fontSize: T.fs.xs, fontWeight: period === v ? T.fw.bolder : T.fw.normal, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (period === v ? T.primary : T.border), background: period === v ? T.primary : '#fff', color: period === v ? '#fff' : T.gray600 }}>{l}</button>
        ))}
        <span style={{ fontSize: T.fs.xxs, color: T.textMuted, marginLeft: 4 }}>방문=매출 발생 · 신규=생애 첫 방문 · 외국인=이름에 한글 없음</span>
      </div>

      {/* 그래프 */}
      <div style={{ border: BD, borderRadius: T.radius.md, padding: '14px 12px 8px', marginBottom: 18, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: chart.length > 18 ? 3 : 6, height: 178, minWidth: chart.length * 22 }}>
          {chart.map(d => {
            const total = d.n + d.o + d.fn + d.fo
            const barH = Math.round((total / chartMax) * 150)
            const newPart = d.n + d.fn
            const newH = total > 0 ? Math.round((newPart / total) * barH) : 0
            return (
              <div key={d.ym} onClick={() => setSel(d.ym)} style={{ flex: 1, minWidth: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }}
                title={`${d.ym}\n신규 ${fmt(newPart)} / 기존 ${fmt(d.o + d.fo)} / 총 ${fmt(total)}`}>
                <span style={{ fontSize: 9, color: NEW, fontWeight: 700 }}>{total >= 1 ? fmt(total) : ''}</span>
                <div style={{ width: '78%', maxWidth: 26, height: barH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: 3, overflow: 'hidden', background: T.gray100, outline: d.ym === sel ? '2px solid ' + NEW : 'none' }}>
                  <div style={{ height: newH, background: NEW }} />
                  <div style={{ height: barH - newH, background: OLD }} />
                </div>
                <span style={{ fontSize: 9, color: d.ym === sel ? NEW : T.textMuted, fontWeight: d.ym === sel ? 700 : 400, transform: chart.length > 14 ? 'rotate(-50deg)' : 'none', whiteSpace: 'nowrap', transformOrigin: 'center', height: chart.length > 14 ? 28 : 'auto' }}>{d.ym.slice(2)}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 6, fontSize: T.fs.xxs, color: T.textMuted }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: NEW, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />신규 (내국+외국)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: OLD, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />기존</span>
        </div>
      </div>

      {/* 월별 추이 표 */}
      <div style={{ overflowX: 'auto', border: BD, borderRadius: T.radius.md, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
          <GroupHead firstLabel="월" />
          <tbody>
            {trend.map(t => (
              <tr key={t.ym} onClick={() => setSel(t.ym)} style={{ cursor: 'pointer', background: t.ym === sel ? '#F5F3FF' : 'transparent' }}>
                <td style={tdL}>{t.ym}{t.ym === sel ? ' ◀' : ''}</td>
                <DataCells v={t} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 선택 월 지점별 */}
      <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.bolder, color: T.text, marginBottom: 8 }}>
        지점별 방문 — <span style={{ color: NEW }}>{sel}</span>
        <span style={{ fontSize: T.fs.xxs, color: T.textMuted, fontWeight: 400 }}> (위 표/그래프에서 월 클릭하면 변경)</span>
        {branchLoading && <span style={{ fontSize: T.fs.xxs, color: T.textMuted }}> · 불러오는 중…</span>}
      </div>
      <div style={{ overflowX: 'auto', border: BD, borderRadius: T.radius.md }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
          <GroupHead firstLabel="지점" />
          <tbody>
            {branchIds.map(id => (
              <tr key={id}><td style={tdL}>{brName(id)}</td><DataCells v={byBranch[id]} /></tr>
            ))}
            {branchIds.length > 0 && (
              <tr style={{ background: T.gray100 }}>
                <td style={{ ...tdL, fontWeight: 800 }}>합계</td>
                <DataCells v={tot} bold />
              </tr>
            )}
            {branchIds.length === 0 && !branchLoading && (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: T.textMuted }}>해당 월 방문 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
