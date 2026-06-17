import { T } from '../../lib/constants'

// 받은메시지함 4개 탭(받은메시지·팀채팅·입금·리뷰)의 상단 서브헤더를 통일하기 위한 공유 스타일.
// - 모든 탭 헤더가 같은 높이/패딩/배경/구분선 → 일관된 컴팩트 한 줄 헤더.
// - 필터 칩(pill)도 한 가지 스타일로 통일 (받은메시지 내지점/전체, 입금 미매칭/매칭됨…, 리뷰 답글대기/답변완료…).
export const INBOX_HDR = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 10px', borderBottom: `1px solid ${T.border}`,
  background: T.bgCard, flexShrink: 0, flexWrap: 'wrap', minHeight: 30,
};

// 칩(pill) 스타일 — active면 보라 연배경, 아니면 흰 배경. 전 탭 공통.
export const inboxChip = (active) => ({
  padding: '4px 11px', borderRadius: 14,
  border: `1px solid ${active ? T.primary : T.border}`,
  background: active ? T.primaryLt : '#fff',
  color: active ? T.primaryDk : T.gray600,
  fontWeight: active ? 800 : 600,
  fontSize: 11.5, lineHeight: 1.3,
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
});
