# HANDOFF

## 현재 버전
- **라이브: v3.7.730** (https://blissme.ai/version.txt) — 2026-05-16 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업
**[별도 트랙] 네이버 확정 API 409 RT47 조사** — 변경예약(`1237756370` 유정민 등)을 블리스가 네이버 확정 API로 확정하려 할 때 `409 MANDATORY_VALIDATOR_ERRORS / RT47`로 거부당하는 케이스 발견. `source=네이버` 버그는 v2026-05-16 fix 완료(CLAUDE.md 참고)했으나, RT47 확정 실패는 미해결. 변경예약 확정 흐름 추가 조사 필요.

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
