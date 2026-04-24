import React from 'react'

// ───────── 공통 Mock ─────────
const BRANCHES = [
  { id: 'br_4bcauqvrb', name: '강남점', color: '#E0F7FA' },
  { id: 'br_wkqsxj6k1', name: '왕십리점', color: '#FFF3E0' },
  { id: 'br_l6yzs2pkq', name: '홍대점', color: '#F3E5F5' },
]
// 각 지점 컬럼(미배정 1 + 직원들)
const COLS_BY_BRANCH = {
  'br_4bcauqvrb': ['미배정', '현아', '지은', '권도윤', '수연', '+'],
  'br_wkqsxj6k1': ['미배정', '경아', '+'],
  'br_l6yzs2pkq': ['미배정', '재윤', '+'],
}
const COL_W = 110
const HEAD_H = 44
const GROUP_H = 28
const TIME_W = 56
const ROW_H = 18
const ROWS = 10

const buildCols = () => BRANCHES.flatMap(b =>
  COLS_BY_BRANCH[b.id].map(name => ({ bid: b.id, bname: b.name, bcolor: b.color, name }))
)

// ───────── 옵션 A — 그룹 헤더 바 (셀 병합 스타일) ─────────
const OptionA = () => {
  const cols = buildCols()
  // 지점별 컬럼 개수
  const groups = BRANCHES.map(b => ({ b, count: COLS_BY_BRANCH[b.id].length }))
  return (
    <div style={wrap}>
      <Label>A. 그룹 헤더 바 (셀 병합)</Label>
      <div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
        <div style={{ width: TIME_W }}/>
        {groups.map(({ b, count }) => (
          <div key={b.id} style={{
            width: COL_W * count,
            height: GROUP_H,
            background: b.color,
            borderRight: '1px solid rgba(0,0,0,.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#333',
            letterSpacing: 0.3
          }}>{b.name}</div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: TIME_W, height: HEAD_H }}/>
        {cols.map((c, i) => (
          <div key={i} style={{
            width: COL_W, height: HEAD_H, background: c.bcolor,
            borderRight: '1px solid rgba(0,0,0,.06)',
            borderBottom: '1px solid #ddd',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: c.name === '미배정' ? '#FF9800' : '#222'
          }}>{c.name}</div>
        ))}
      </div>
      <TimeGrid cols={cols}/>
    </div>
  )
}

// ───────── 옵션 B — 지점 좌측 컬러바 ─────────
const OptionB = () => {
  const cols = buildCols()
  const BAR = 6
  return (
    <div style={wrap}>
      <Label>B. 지점별 좌측 컬러바</Label>
      <div style={{ display: 'flex' }}>
        <div style={{ width: TIME_W }}/>
        {BRANCHES.map((b) => (
          <div key={b.id} style={{ display: 'flex' }}>
            {/* 좌측 컬러바 + 지점명 세로 */}
            <div style={{
              width: BAR, background: b.color,
              borderRight: '2px solid ' + b.color, marginRight: 4
            }}/>
            {COLS_BY_BRANCH[b.id].map((n, i) => (
              <div key={i} style={{
                width: COL_W - (i === 0 ? BAR + 4 : 0), height: HEAD_H,
                borderBottom: '1px solid #ddd',
                borderRight: '1px solid rgba(0,0,0,.06)',
                background: i === 0 ? b.color : '#fff',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: n === '미배정' ? '#FF9800' : '#222',
              }}>
                {i === 0 && <span style={{ fontSize: 9, color: '#555', fontWeight: 600 }}>{b.name}</span>}
                <span>{n}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <TimeGrid cols={cols}/>
    </div>
  )
}

// ───────── 옵션 C — 상단 지점 탭 ─────────
const OptionC = () => {
  const cols = buildCols()
  return (
    <div style={wrap}>
      <Label>C. 상단 지점 탭 (네비 스타일)</Label>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #ddd', display: 'flex', gap: 6 }}>
        {BRANCHES.map(b => {
          const cnt = COLS_BY_BRANCH[b.id].filter(n => n !== '미배정' && n !== '+').length
          return (
            <button key={b.id} style={{
              padding: '6px 14px', borderRadius: 20, border: '1.5px solid ' + b.color,
              background: b.color, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
            }}>{b.name} <span style={{ color: '#666', fontWeight: 500 }}>{cnt}명</span></button>
          )
        })}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: TIME_W }}/>
        {cols.map((c, i) => {
          const isFirstOfBranch = i === 0 || cols[i-1].bid !== c.bid
          return (
            <div key={i} style={{
              width: COL_W, height: HEAD_H,
              borderLeft: isFirstOfBranch ? '3px solid ' + c.bcolor : '1px solid rgba(0,0,0,.06)',
              borderBottom: '1px solid #ddd',
              background: '#fafafa',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: c.name === '미배정' ? '#FF9800' : '#222'
            }}>{c.name}</div>
          )
        })}
      </div>
      <TimeGrid cols={cols}/>
    </div>
  )
}

// ───────── 옵션 D — 교차 배경 + 앵커 텍스트 ─────────
const OptionD = () => {
  const cols = buildCols()
  return (
    <div style={wrap}>
      <Label>D. 교차 배경 + 앵커 텍스트</Label>
      <div style={{ display: 'flex', position: 'relative' }}>
        <div style={{ width: TIME_W, height: HEAD_H }}/>
        {cols.map((c, i) => {
          const isFirstOfBranch = i === 0 || cols[i-1].bid !== c.bid
          return (
            <div key={i} style={{
              width: COL_W, height: HEAD_H, position: 'relative',
              background: c.bcolor,
              borderBottom: '1px solid #ddd',
              borderRight: '1px solid rgba(0,0,0,.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: c.name === '미배정' ? '#FF9800' : '#222'
            }}>
              {isFirstOfBranch && (
                <span style={{
                  position: 'absolute', top: 2, left: 6,
                  fontSize: 9, fontWeight: 800, color: '#333',
                  background: 'rgba(255,255,255,.7)', padding: '1px 5px', borderRadius: 3
                }}>🏢 {c.bname}</span>
              )}
              {c.name}
            </div>
          )
        })}
      </div>
      <TimeGrid cols={cols} striped/>
    </div>
  )
}

// ───────── 공통 TimeGrid (간단) ─────────
const TimeGrid = ({ cols, striped }) => (
  <div style={{ display: 'flex', height: ROWS * ROW_H }}>
    <div style={{ width: TIME_W, background: '#fafafa', borderRight: '1px solid #eee' }}>
      {Array.from({ length: ROWS }).map((_, i) => (
        <div key={i} style={{
          height: ROW_H, fontSize: 9, color: '#999',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 4
        }}>{`10:${String(i * 5).padStart(2, '0')}`}</div>
      ))}
    </div>
    {cols.map((c, i) => (
      <div key={i} style={{
        width: COL_W, height: '100%',
        borderRight: '1px solid rgba(0,0,0,.04)',
        background: striped && (i % 2 === 0) ? 'rgba(0,0,0,.01)' : 'transparent',
      }}>
        {Array.from({ length: ROWS }).map((_, j) => (
          <div key={j} style={{
            height: ROW_H,
            borderBottom: j % 2 === 1 ? '1px solid rgba(0,0,0,.04)' : 'none',
          }}/>
        ))}
      </div>
    ))}
  </div>
)

const wrap = {
  background: '#fff', borderRadius: 10, marginBottom: 24,
  boxShadow: '0 2px 10px rgba(0,0,0,.06)', overflow: 'hidden',
  fontFamily: "'Pretendard', 'system-ui'"
}
const Label = ({ children }) => (
  <div style={{
    padding: '10px 14px', background: '#5cb5c5', color: '#fff',
    fontSize: 13, fontWeight: 800, letterSpacing: 0.3
  }}>{children}</div>
)

export default function TlHeaderPreview() {
  return (
    <div style={{
      minHeight: '100vh', background: '#eef2f7', padding: 24,
      fontFamily: "'Pretendard', 'system-ui'"
    }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>타임라인 헤더 디자인 프리뷰</h2>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: 13 }}>
          지점 셀 병합 / 중복 제거 / 미배정 N배지 제거 — 4가지 옵션. 원하는 옵션을 알려주세요.
        </p>
        <OptionA/>
        <OptionB/>
        <OptionC/>
        <OptionD/>
      </div>
    </div>
  )
}
