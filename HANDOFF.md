# HANDOFF

## 현재 버전
- **라이브: v3.7.736** (https://blissme.ai/version.txt) — 2026-05-16 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업
**새로고침 초기 로딩 느림 — 최적화 예정** (유저 "알아서 하고" 지시)
- 원인: v3.7.727에서 초기 reservations 로드를 `sb.get`→`sb.getAll`로 변경 → 30일+미래 8,320건(10MB, 9회 요청, ~3.3초)을 첫 렌더 전에 다 받음
- 방향: 예약 전체 로딩을 첫 렌더에서 분리(백그라운드화). 타임라인은 자체 on-demand fetch라 첫 화면엔 불필요. `loadAllFromDb`의 reservations getAll을 Promise.all에서 빼고 비동기 보충
- `AppShell.jsx:40 loadAllFromDb`, `AppShell.jsx:55` reservations getAll

## 기타 미해결
- 카카오 예약 확정 알림톡: 실발송 테스트 미실시 — 카카오 테스트 예약 1건으로 검증 권장
- 고객 상세에서 동의서(ConsentModal z1000)·매출편집(SaleForm z200/500)은 고객 모달(z3000)에 가려짐 (v3.7.733 이전부터 있던 z-index 이슈, portal+z 조정 필요)

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
