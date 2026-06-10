import React, { useState, useEffect, useMemo } from 'react'
import { sb } from '../../lib/sb'
import { fromDb } from '../../lib/db'
import { T } from '../../lib/constants'
import I from '../common/I'
import { todayStr, fmtTime, getStatusColor, getStatusLabel } from '../../lib/utils'

// 가벼운 읽기전용 캘린더 — 월/주/리스트 뷰. 날짜 클릭 → 일(타임라인) 뷰로 이동.
// 핵심 타임라인(드래그/배정) 로직과 분리. data.reservations 미완전성에 의존하지 않고 가시 범위를 직접 fetch.
const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"]
const pad2 = (n) => String(n).padStart(2, "0")
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const parseISO = (s) => { const [y, m, d] = (s || "").split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1) }

export default function CalendarViews({ view, selDate, onDayView, bizId, branches, userBranches, isMaster, calView, setCalView }) {
  // 어느 뷰에서나 보기 전환 — 캘린더 헤더 좌측에도 동일 드롭다운 (일 뷰는 타임라인 헤더에 있음)
  const viewSelect = setCalView ? (
    <select value={calView || view} onChange={(e) => setCalView(e.target.value)} title="보기 전환 (일/주/월)"
      style={{ position: "absolute", left: 12, height: 30, border: "1px solid #d0d0d0", borderRadius: 8, background: T.bgCard, color: T.text, fontSize: 13, fontWeight: 800, padding: "0 6px", cursor: "pointer" }}>
      <option value="day">일</option>
      <option value="week">주</option>
      <option value="month">월</option>
    </select>
  ) : null
  const accBids = useMemo(
    () => (isMaster ? (branches || []) : (branches || []).filter(b => (userBranches || []).includes(b.id))).map(b => b.id),
    [branches, userBranches, isMaster]
  )
  const branchShort = useMemo(() => {
    const m = {}; (branches || []).forEach(b => { m[b.id] = b.short || b.name || "" }); return m
  }, [branches])

  // 상태 라벨·색 (reserved 등 타임라인 기본 상태 포함)
  const STATUS_KO = { reserved: "예약", confirmed: "진행", completed: "완료", pending: "확정대기", request: "AI신청", no_show: "노쇼", cancelled: "취소", naver_cancelled: "네이버취소", naver_changed: "변경됨" }
  const STATUS_DOT = { reserved: "#a9b0e0", confirmed: "#4a7cc8", completed: "#6ab56a", pending: T.orange, request: "#9C27B0", no_show: T.danger }
  const sLabel = (s) => STATUS_KO[s] || getStatusLabel(s)
  const sColor = (s) => STATUS_DOT[s] || getStatusColor(s, T) || "#bbb"

  // 내부 anchor — 월/주 네비게이션은 anchor만 변경(타임라인 selDate effect churn 방지). 날짜 클릭 시에만 selDate 변경.
  const [anchor, setAnchor] = useState(() => parseISO(selDate || todayStr()))
  useEffect(() => { setAnchor(parseISO(selDate || todayStr())) }, [view]) // 뷰 전환 시 selDate 기준으로 리셋

  // 가시 범위 계산
  const range = useMemo(() => {
    const a = new Date(anchor)
    if (view === "week") {
      const s = new Date(a); s.setDate(a.getDate() - a.getDay())
      const e = new Date(s); e.setDate(s.getDate() + 6)
      return { start: iso(s), end: iso(e), days: Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d }) }
    }
    // month + list: 그 달 (month 그리드는 앞뒤 주 채움)
    const first = new Date(a.getFullYear(), a.getMonth(), 1)
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0)
    const gridStart = new Date(first); gridStart.setDate(1 - first.getDay())
    const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (6 - last.getDay()))
    return { start: iso(gridStart), end: iso(gridEnd), monthStart: iso(first), monthEnd: iso(last), days: Array.from({ length: Math.round((gridEnd - gridStart) / 86400000) + 1 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d }) }
  }, [anchor, view])

  const [resv, setResv] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!bizId || !accBids.length) { setResv([]); return }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const rows = await sb.getAll("reservations",
          `&business_id=eq.${bizId}&is_beta=eq.false&is_schedule=eq.false`
          + `&date=gte.${range.start}&date=lte.${range.end}`
          + `&status=not.in.(cancelled,naver_cancelled,naver_changed)`
          + `&bid=in.(${accBids.join(",")})`
          + `&select=id,reservation_id,date,time,status,bid,cust_name,staff_name&order=date.asc,time.asc`)
        if (!alive) return
        setResv(fromDb("reservations", Array.isArray(rows) ? rows : []))
      } catch (e) { if (alive) setResv([]) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [bizId, accBids, range.start, range.end])

  const byDate = useMemo(() => {
    const m = {}
    for (const r of resv) { (m[r.date] = m[r.date] || []).push(r) }
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.time || "").localeCompare(b.time || "")))
    return m
  }, [resv])

  const today = todayStr()
  const stepMonth = (d) => setAnchor(a => new Date(a.getFullYear(), a.getMonth() + d, 1))
  const stepWeek = (d) => setAnchor(a => { const n = new Date(a); n.setDate(a.getDate() + d * 7); return n })

  const navBtn = { background: "none", border: "none", cursor: "pointer", padding: "4px 8px", color: T.gray600 }
  const todayBtn = { background: "#f1f1f4", border: "none", borderRadius: 8, cursor: "pointer", padding: "4px 10px", fontSize: 12, color: T.gray600, fontWeight: 600 }

  const resvChip = (r, compact) => (
    <div key={r.id} onClick={(e) => { e.stopPropagation(); onDayView(r.date) }}
      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: compact ? 11 : 12, lineHeight: 1.35, cursor: "pointer", padding: compact ? "0 2px" : "2px 4px", borderRadius: 4, background: compact ? undefined : "#f7f7fa", marginBottom: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: sColor(r.status), flexShrink: 0 }} />
      <span style={{ color: T.gray600, flexShrink: 0 }}>{fmtTime(r.time)}</span>
      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{r.custName || "예약"}</span>
    </div>
  )

  // ── 월 뷰 ──
  if (view === "month") {
    const ttl = `${anchor.getFullYear()}.${anchor.getMonth() + 1}`
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", background: T.bgCard }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "10px 12px", position: "relative" }}>
          {viewSelect}
          <button style={navBtn} onClick={() => stepMonth(-1)}><I name="chevL" size={16} /></button>
          <span style={{ fontSize: 16, fontWeight: 800, minWidth: 88, textAlign: "center" }}>{ttl}</span>
          <button style={navBtn} onClick={() => stepMonth(1)}><I name="chevR" size={16} /></button>
          <button style={{ ...todayBtn, position: "absolute", right: 12 }} onClick={() => setAnchor(parseISO(today))}>오늘</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderTop: "1px solid #eee" }}>
          {DOW_KR.map((d, i) => <div key={d} style={{ textAlign: "center", padding: "6px 0", fontSize: 12, fontWeight: 700, color: i === 0 ? "#e2231a" : i === 6 ? "#1565d8" : T.gray600 }}>{d}</div>)}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "minmax(86px,1fr)" }}>
          {range.days.map((d) => {
            const ds = iso(d), inMonth = d.getMonth() === anchor.getMonth(), isToday = ds === today
            const list = byDate[ds] || []
            return (
              <div key={ds} onClick={() => onDayView(ds)}
                style={{ borderRight: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", padding: 4, cursor: "pointer", background: isToday ? "#f3e8ff" : (inMonth ? "#fff" : "#fafafa"), overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: !inMonth ? "#bbb" : (d.getDay() === 0 ? "#e2231a" : d.getDay() === 6 ? "#1565d8" : T.text), marginBottom: 2 }}>{d.getDate()}</div>
                {list.slice(0, 3).map(r => resvChip(r, true))}
                {list.length > 3 && <div style={{ fontSize: 10, color: T.primary, fontWeight: 700, marginTop: 1 }}>+{list.length - 3}건</div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── 주 뷰 ──
  if (view === "week") {
    const s = range.days[0], e = range.days[6]
    const ttl = `${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: T.bgCard }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "10px 12px", position: "relative" }}>
          {viewSelect}
          <button style={navBtn} onClick={() => stepWeek(-1)}><I name="chevL" size={16} /></button>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{ttl}</span>
          <button style={navBtn} onClick={() => stepWeek(1)}><I name="chevR" size={16} /></button>
          <button style={{ ...todayBtn, position: "absolute", right: 12 }} onClick={() => setAnchor(parseISO(today))}>오늘</button>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", minHeight: 0, borderTop: "1px solid #eee" }}>
          {range.days.map((d, i) => {
            const ds = iso(d), isToday = ds === today, list = byDate[ds] || []
            return (
              <div key={ds} style={{ borderRight: i < 6 ? "1px solid #f0f0f0" : "none", display: "flex", flexDirection: "column", minHeight: 0, background: isToday ? "#f3e8ff" : "#fff" }}>
                <div onClick={() => onDayView(ds)} style={{ textAlign: "center", padding: "6px 0", cursor: "pointer", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: i === 0 ? "#e2231a" : i === 6 ? "#1565d8" : T.gray600 }}>{DOW_KR[i]}</div>
                  <div style={{ fontSize: 15, fontWeight: isToday ? 800 : 600, color: isToday ? T.primary : T.text }}>{d.getDate()}</div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 3 }}>
                  {list.length === 0 ? <div style={{ fontSize: 10, color: "#ccc", textAlign: "center", marginTop: 6 }}>—</div> : list.map(r => resvChip(r, false))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── 리스트 뷰 (그 달, 날짜별 그룹) ──
  const ttl = `${anchor.getFullYear()}.${anchor.getMonth() + 1}`
  const dates = Object.keys(byDate).filter(d => d >= (range.monthStart || range.start) && d <= (range.monthEnd || range.end)).sort()
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", background: T.bgCard }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "10px 12px", position: "relative", flexShrink: 0 }}>
        {viewSelect}
        <button style={navBtn} onClick={() => stepMonth(-1)}><I name="chevL" size={16} /></button>
        <span style={{ fontSize: 16, fontWeight: 800, minWidth: 88, textAlign: "center" }}>{ttl}</span>
        <button style={navBtn} onClick={() => stepMonth(1)}><I name="chevR" size={16} /></button>
        <button style={{ ...todayBtn, position: "absolute", right: 12 }} onClick={() => setAnchor(parseISO(today))}>오늘</button>
      </div>
      <div style={{ flex: 1, padding: "0 12px 40px" }}>
        {loading && !dates.length ? <div style={{ textAlign: "center", color: "#aaa", padding: 30, fontSize: 13 }}>불러오는 중…</div>
          : dates.length === 0 ? <div style={{ textAlign: "center", color: "#aaa", padding: 30, fontSize: 13 }}>이 달 예약이 없습니다.</div>
            : dates.map(ds => {
              const d = parseISO(ds), list = byDate[ds]
              return (
                <div key={ds} style={{ marginBottom: 10 }}>
                  <div onClick={() => onDayView(ds)} style={{ position: "sticky", top: 0, background: T.bgCard, padding: "6px 0", fontSize: 13, fontWeight: 800, color: ds === today ? T.primary : T.text, cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}>
                    {`${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW_KR[d.getDay()]})`} <span style={{ fontSize: 11, color: T.gray600, fontWeight: 500 }}>{list.length}건</span>
                  </div>
                  {list.map(r => (
                    <div key={r.id} onClick={() => onDayView(r.date)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", borderBottom: "1px solid #f7f7fa", cursor: "pointer", fontSize: 13 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: sColor(r.status), flexShrink: 0 }} />
                      <span style={{ color: T.gray600, width: 64, flexShrink: 0 }}>{fmtTime(r.time)}</span>
                      <span style={{ fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.custName || "예약"}</span>
                      <span style={{ fontSize: 11, color: T.gray600, flexShrink: 0 }}>{branchShort[r.bid] || ""}</span>
                      <span style={{ fontSize: 11, color: sColor(r.status), flexShrink: 0 }}>{sLabel(r.status)}</span>
                    </div>
                  ))}
                </div>
              )
            })}
      </div>
    </div>
  )
}
