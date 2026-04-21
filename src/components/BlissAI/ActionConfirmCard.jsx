/**
 * ActionConfirmCard — 블리스 AI가 제안하는 쓰기 액션의 확인 UI
 *
 * 표시:
 *   - 아이콘 + 액션 라벨 (예: ✏️ 지점 수정)
 *   - target 이름 (예: 강남본점)
 *   - 변경 내역 diff 테이블 (label: before → after)
 *   - dangerous면 빨간 톤
 *   - doubleConfirm이면 "정말 실행하시겠습니까?" 체크
 *   - [취소] [실행] 버튼
 */
import React, { useState } from 'react'
import { T } from '../../lib/constants'

export default function ActionConfirmCard({ preview, schema, onConfirm, onCancel, status }) {
  const [doubleConfirmed, setDoubleConfirmed] = useState(false)
  const dangerous = preview?.dangerous || schema?.dangerous
  const needDouble = schema?.doubleConfirm && dangerous

  if (preview?.error) {
    return (
      <div style={cardStyle(true)}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.danger }}>⚠️ 실행 불가</div>
        <div style={{ fontSize: 13, color: T.text, marginTop: 6 }}>{preview.error}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={onCancel} style={btnStyle('secondary')}>닫기</button>
        </div>
      </div>
    )
  }

  const disabled = status === 'running' || status === 'done' || (needDouble && !doubleConfirmed)

  return (
    <div style={cardStyle(dangerous)}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 18 }}>{preview.icon || '⚙️'}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: dangerous ? T.danger : T.primary }}>
          {preview.label}
        </div>
        {preview.targetName && (
          <div style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
            · {preview.targetName}
          </div>
        )}
      </div>

      {/* diff 테이블 */}
      {preview.rows?.length > 0 && (
        <div style={{ border: '1px solid ' + T.border, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          {preview.rows.map((row, i) => (
            <div key={i} style={{
              display: 'flex', padding: '8px 10px',
              borderBottom: i < preview.rows.length - 1 ? '1px solid ' + T.gray100 : 'none',
              fontSize: 12, alignItems: 'center', gap: 8,
            }}>
              <div style={{ flex: '0 0 110px', fontWeight: 600, color: T.textSub }}>{row.label}</div>
              {row.before != null && row.before !== '' && (
                <>
                  <div style={{ flex: 1, color: T.gray500, textDecoration: 'line-through', wordBreak: 'break-all' }}>
                    {row.before}
                  </div>
                  <div style={{ color: T.gray400, flexShrink: 0 }}>→</div>
                </>
              )}
              <div style={{ flex: 1, color: T.text, fontWeight: 700, wordBreak: 'break-all' }}>
                {row.after}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* doubleConfirm 체크 */}
      {needDouble && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: T.danger, fontWeight: 700 }}>
            <input type="checkbox" checked={doubleConfirmed} onChange={e => setDoubleConfirmed(e.target.checked)}
              style={{ accentColor: T.danger, cursor: 'pointer' }}/>
            이 변경을 실행함을 확인합니다 (삭제는 복구가 어려울 수 있어요)
          </label>
        </div>
      )}

      {/* 상태 */}
      {status === 'running' && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted }}>⏳ 실행 중...</div>
      )}
      {status === 'done' && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#059669', fontWeight: 700 }}>✅ 완료</div>
      )}
      {status === 'error' && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.danger, fontWeight: 700 }}>❌ 실패</div>
      )}

      {/* 버튼 */}
      {status !== 'done' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={status === 'running'} style={btnStyle('secondary')}>
            취소
          </button>
          <button onClick={onConfirm} disabled={disabled}
            style={btnStyle(dangerous ? 'danger' : 'primary', disabled)}>
            {status === 'running' ? '실행 중...' : dangerous ? '삭제/실행' : '실행'}
          </button>
        </div>
      )}
    </div>
  )
}

function cardStyle(danger) {
  return {
    padding: 14, borderRadius: 12,
    background: danger ? '#FEF2F2' : '#EFF6FF',
    border: '1.5px solid ' + (danger ? '#FCA5A5' : '#93C5FD'),
    margin: '4px 0',
  }
}
function btnStyle(kind, disabled) {
  const base = {
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
    border: 'none', opacity: disabled ? 0.5 : 1,
  }
  if (kind === 'primary') return { ...base, background: T.primary, color: '#fff' }
  if (kind === 'danger') return { ...base, background: T.danger, color: '#fff' }
  return { ...base, background: '#fff', color: T.textSub, border: '1px solid ' + T.border }
}
