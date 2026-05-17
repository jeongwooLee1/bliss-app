# HANDOFF

## 현재 버전
- **라이브: v3.7.739** (https://blissme.ai/version.txt) — 2026-05-17 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업
없음. (고객 상세 모달 모바일 디자인 정리 — 2026-05-17 v3.7.739 처리, CLAUDE.md 참고)

## 기타 미해결
- 카카오 예약 확정 알림톡: 실발송 테스트 미실시 — 카카오 테스트 예약 1건으로 검증 권장

## 미처리 — 현아 커플패키지 질문 (id_eih96ttwa0, pending)
"커플패키지 3회: 한 분 매출로 3회 등록 + 다른 분 고객관리에서 3회 등록? 아니면 6회로 쉐어 사용?" — 운영 방식 결정 필요. 답변 미작성.

## 참고 — 라이브 키 대기 (별도 트랙, 외부 의존)
토스 라이브 키 발급 시 Supabase Edge Functions ENV 3개 등록 필요:

| Key | Value | 비고 |
|---|---|---|
| `TOSS_BLISS_CLIENT_KEY` | `live_ck_*` | 공개 가능 (React 번들 OK) |
| `TOSS_BLISS_SECRET_KEY` | `live_sk_*` | 절대 프론트 노출 X |
| `TOSS_BLISS_IS_TEST` | `false` | 라이브 모드 |

등록: Supabase Dashboard → Project Settings → Edge Functions → Add new secret.
키 없는 상태에서 매장이 충전 시도하면 `503 TOSS_BLISS_* not configured`.
송정윤 매니저(010-4928-1242) 토스 심사 답변 메일 회신 대기 중.

## 인수인계 체계
3계층 분리. 자세한 내용은 CLAUDE.md 참고.
