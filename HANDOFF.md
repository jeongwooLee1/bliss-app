# HANDOFF

## 현재 버전
- **라이브: v3.7.728** (https://blissme.ai/version.txt) — 2026-05-15 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업
없음.

> 직전 HANDOFF의 "on-demand 데이터 로딩 전환 대규모 리팩토링"은 폐기됨.
> 조사 결과 on-demand 메커니즘(TimelinePage selDate fetch / SalesPage 기간 fetch)이 이미 구현돼 있었고,
> 실제 버그 3건(A: 타임라인 on-demand fetch 1000건 잘림 / B: 포그라운드 복귀 시 전체 reload / C: 죽은 코드)만
> v3.7.728로 핀포인트 수정 완료. 전역 `data.reservations`는 세션 캐시로 유지. 자세한 내용 CLAUDE.md v3.7.728 참고.

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
