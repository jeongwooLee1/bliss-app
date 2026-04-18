import React, { useState } from 'react'
import { T } from '../lib/constants'
import { TeamChat } from '../components/Chat'

// 사내 메신저 모듈 독립 프리뷰
// URL에 ?chat=1 넣으면 라이브 앱 대신 이 페이지만 렌더됨
// 실제 사이드바에 박힌 모습을 시뮬레이션하기 위해 좌측에 220px 더미 사이드바를 깔고
// 하단에 채팅 영역을 배치.

const WIDTHS = [200, 220, 260, 300]

export default function ChatPreview() {
  const [width, setWidth] = useState(260)
  const [chatHeight, setChatHeight] = useState(360)
  const [variant, setVariant] = useState('embedded') // 'embedded' | 'standalone'

  return (
    <div style={{
      display:'flex', width:'100vw', height:'100dvh',
      background: T.bg, color: T.text, fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      {/* 좌측: 더미 사이드바 + 채팅 */}
      <aside style={{
        width, height:'100%', background: T.bgCard,
        borderRight:`1px solid ${T.border}`,
        display:'flex', flexDirection:'column', flexShrink:0,
      }}>
        {/* 브랜드 */}
        <div style={{padding:`${T.sp.lg}px ${T.sp.lg}px ${T.sp.md}px`, borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontSize:T.fs.xl, fontWeight:T.fw.black, color:T.primary, letterSpacing:-.5}}>하우스왁싱</div>
          <div style={{fontSize:T.fs.sm, color:T.textSub, marginTop:4}}>대표 관리자</div>
        </div>

        {/* 더미 메뉴 (상단) */}
        <div style={{flex: variant === 'embedded' ? 'none' : 1, padding:'8px 0', overflowY:'auto'}}>
          {[
            {cat:'예약 관리', items:['타임라인','예약 목록']},
            {cat:'고객 관리', items:['고객']},
            {cat:'매출 관리', items:['매출','통계']},
            {cat:'시스템', items:['사용자','메시지']},
          ].map((c, i) => (
            <div key={i}>
              <div style={{fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.gray500, padding:`10px ${T.sp.lg}px 4px`}}>{c.cat}</div>
              {c.items.map((it, j) => (
                <div key={j} style={{padding:`8px ${T.sp.lg}px`, fontSize:T.fs.sm, color:T.gray700, cursor:'default'}}>
                  · {it}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 채팅 영역 (embedded 모드: 하단 고정 높이 / standalone: flex:1) */}
        {variant === 'embedded' ? (
          <div style={{
            borderTop:`2px solid ${T.primary}`,
            height: chatHeight,
            flexShrink:0,
            display:'flex', flexDirection:'column',
          }}>
            <TeamChat mock />
          </div>
        ) : (
          <div style={{flex:1, display:'flex', flexDirection:'column', borderTop:`2px solid ${T.primary}`}}>
            <TeamChat mock />
          </div>
        )}
      </aside>

      {/* 우측: 개발자용 컨트롤 패널 */}
      <main style={{flex:1, overflow:'auto', padding:32, background: T.bg}}>
        <div style={{maxWidth:520}}>
          <h1 style={{fontSize:22, fontWeight:T.fw.black, marginBottom:4, color:T.text}}>사내 메신저 프리뷰</h1>
          <p style={{color:T.textSub, fontSize:T.fs.sm, marginBottom:24, lineHeight:1.6}}>
            좌측 사이드바에 임베드된 상태를 시뮬레이션합니다.<br/>
            Mock 데이터로 동작하며, 라이브 앱과 완전히 분리되어 있습니다.
          </p>

          <Section title="사이드바 폭">
            <ButtonGroup
              options={WIDTHS.map(w => ({value:w, label:`${w}px`}))}
              value={width}
              onChange={setWidth}
            />
          </Section>

          <Section title="레이아웃">
            <ButtonGroup
              options={[
                {value:'embedded',   label:'메뉴 + 채팅 (실제)'},
                {value:'standalone', label:'채팅 단독 (풀)'},
              ]}
              value={variant}
              onChange={setVariant}
            />
          </Section>

          {variant === 'embedded' && (
            <Section title={`채팅 영역 높이 — ${chatHeight}px`}>
              <input
                type="range"
                min={220} max={600} step={20}
                value={chatHeight}
                onChange={e => setChatHeight(+e.target.value)}
                style={{width:'100%'}}
              />
            </Section>
          )}

          <Section title="체크리스트">
            <ul style={{margin:0, paddingLeft:18, fontSize:T.fs.sm, color:T.textSub, lineHeight:1.9}}>
              <li>메시지 그룹핑 (같은 사람 연속 → 아바타 1회)</li>
              <li>미읽 구분선 (빨간 라인 + 카운트)</li>
              <li>날짜 구분선</li>
              <li>시간 표시 — hover 시 노출</li>
              <li>아바타 — 성별 색 (남 파랑 / 여 분홍)</li>
              <li>지점 pill</li>
              <li>자기 메시지 이름 강조색</li>
              <li>입력창 — 엔터 전송, Shift+Enter 줄바꿈, 한글 IME 안전</li>
              <li>auto-grow textarea (최대 5줄)</li>
              <li>자동 스크롤 (새 메시지 시)</li>
              <li>온라인 인디케이터 (상단 N/M)</li>
            </ul>
          </Section>

          <Section title="시도해보기">
            <ol style={{margin:0, paddingLeft:18, fontSize:T.fs.sm, color:T.textSub, lineHeight:1.9}}>
              <li>메시지 입력 후 Enter → 하단에 본인 메시지 추가</li>
              <li>한글 IME: 조합 중 Enter → 전송 안 됨 (정상)</li>
              <li>Shift+Enter → 줄바꿈</li>
              <li>긴 문장 → 말풍선 내 줄바꿈 + auto-grow</li>
              <li>폭을 200px로 줄여보기 → 타이트하지만 읽히는지 확인</li>
            </ol>
          </Section>

          <Section title="다음 단계">
            <p style={{margin:0, fontSize:T.fs.sm, color:T.textSub, lineHeight:1.7}}>
              UI 확정 후 → Supabase 테이블 2개 생성 → useTeamChat 훅 내부에서 mock → 실 데이터로 전환 → Sidebar.jsx 합류 → 빌드 → 라이브 배포.
            </p>
          </Section>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:T.fs.xs, fontWeight:T.fw.bolder, color:T.textSub, marginBottom:8, letterSpacing:.3, textTransform:'uppercase'}}>{title}</div>
      {children}
    </div>
  )
}

function ButtonGroup({ options, value, onChange }) {
  return (
    <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding:'8px 14px',
            fontSize:T.fs.sm, fontWeight:T.fw.medium,
            border:`1px solid ${value===o.value ? T.primary : T.border}`,
            background: value===o.value ? T.primaryLt : T.bgCard,
            color: value===o.value ? T.primaryDk : T.text,
            borderRadius:8, cursor:'pointer',
            transition:'all .1s',
          }}
        >{o.label}</button>
      ))}
    </div>
  )
}
