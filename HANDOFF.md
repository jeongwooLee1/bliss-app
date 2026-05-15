# HANDOFF

## 현재 버전
- **라이브: v3.7.727** (https://blissme.ai/version.txt) — 2026-05-15 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 2026-05-13 ~ 14 작업 (v3.7.717 → v3.7.718)

### v3.7.717 (5/13 늦은밤) — TimelinePage empWorkHours race fix (지은 요청 id_4dd4t9na07)
- `setEmpWorkHours`의 race fix가 `{...serverLatest, ...localPrev}` spread 순서로 의도와 반대 작동 — stale localPrev가 serverLatest 통째로 덮어 다른 사용자 변경 사라짐
- 증상: "서현, 수연 출근시간이 계속 체인지됩니다. 오늘만 3번째 바꿨는데 계속 둘이 바껴염"
- 수정: diff-based merge — `localPrev → next` 차집합에서 사용자가 실제 변경한 key만 추출해 `serverLatest` 위에 overlay
- POST body도 `finalToSave` (전체 next 아님), return도 finalToSave → 다른 사용자 변경 즉시 UI 반영
- 지은 요청 reply 박고 status=done 처리

### v3.7.718 (5/14) — 🔵 포인트 충전·환불 시스템 (토스 가맹 심사 대응)

**토스 심사관 피드백 2건 대응**:
1. "기본 제공 포인트 환불 모호" → `trial.monthly_credit: 1000 → 0` (무료 체험 P 미제공)
   - Starter(3000P)/Pro(7000P)는 월 구독료 결제 대가라 유지
2. "포인트 구매 로직 없음" → 충전·환불 시스템 신규 구현

**구현**:
- `AdminPlan.jsx` 지점별 잔액 카드에 `+충전` / `환불 신청` 버튼
- 충전 모달: 1만 / 3만 / 5만 칩 → `reservation_payments` INSERT (purpose='topup') → `/pay/{orderId}` 새탭 결제
- 환불 모달: 잔액 한도내 금액 + 사유 입력 → `point-refund` Edge Function 호출 → 최근 결제부터 역순 토스 cancel
- `PaymentApp.jsx`에 purpose='topup' UI 분기 — "포인트 충전" 제목·orderName

**Edge Functions** (Dashboard 직접 배포):
- `payment-info` **v4**: purpose='topup'이면 `TOSS_BLISS_CLIENT_KEY` ENV 사용 (매장 자체 키 아님)
- `payment-confirm` **v5**: topup 분기 — 토스 confirm + `billing_payments` INSERT (`pg_tx_id` UNIQUE 멱등) + `billing_balances` 가산
- `point-refund` **v1 신규** (verify_jwt=true): 잔액 한도내 금액·사유 → 최근 충전 건부터 역순 토스 cancel API + billing_payments refund row(-amount) + billing_balances 차감
  - `Idempotency-Key: refund-{paymentId}-{cancelAmt}` 멱등성

**DB**:
- `billing_payments.pg_tx_id UNIQUE` 제약 추가
- `idx_reservation_payments_purpose_topup` partial 인덱스 (`WHERE purpose='topup'`)

**약관**:
- `refund.html` 2번 "포인트 충전 환불" — 충전일 1년 이내 미사용분만 환불, 사용분 제외, 영업일 1~3일 (기존에 이미 적합한 내용 들어있음)

**토스 심사관 답변 메일 발송 완료** (5/14, 사용자가 송정윤 매니저한테 직접):
- 위 2건 조치 안내 + 라이브 키 발급 요청
- 송정윤 010-4928-1242 / iy.song@toss... 메일 답변 대기 중

## 🔴 활성화 대기 — 토스 라이브 키 ENV 입력

심사 통과 후 토스 개발자센터(`developers.tosspayments.com` → 내 개발정보 → API 키 → 라이브 탭)에서 발급되면 **Supabase Edge Functions 환경변수 3개** 등록:

| Key | Value | 비고 |
|---|---|---|
| `TOSS_BLISS_CLIENT_KEY` | `live_ck_XXXXXXXXXX` | 공개 가능 (React 번들 OK) |
| `TOSS_BLISS_SECRET_KEY` | `live_sk_XXXXXXXXXX` | 절대 프론트 노출 X |
| `TOSS_BLISS_IS_TEST` | `false` | 라이브 모드 표시 |

등록 위치: Supabase Dashboard → Project Settings → Edge Functions → Add new secret (또는 Supabase MCP 활용)

키 없는 상태에서 매장이 충전 시도하면 `503 TOSS_BLISS_* not configured` 표시.

## 📋 다음 세션 작업 — on-demand 데이터 로딩 전환 (대규모 리팩토링)

### 배경 / 왜
- 현재 AppShell이 앱 시작 시 reservations/sales를 **전역 `data` 객체에 통째 로드** → 데이터 늘면 범위를 잘라야 함 (현재 reservations 30일 / sales 14일)
- 자른 범위 밖은 빵꾸 → 지은 요청(id_oqxnamev8r): "5/2 이전 기록 전부 안 보임" 버그
- 추가로 Supabase `db-max-rows=1000` 제약 — `sb.get`은 1000건에서 잘림 (v3.7.727에서 초기 로드를 `sb.getAll` 페이지네이션으로 우선 fix, 30일은 정상화)
- 사용자 결정(2026-05-15): 근본 해결 = **화면이 필요한 범위만 그때그때 fetch (on-demand)**

### 목표 구조
- 앱 시작 → 최소만 로드 (오늘 ±7일 정도)
- 타임라인: `selDate` 바뀌면 그 주변 ±N일 fetch + 날짜별 캐시
- 매출관리: 조회 기간 선택 시 그 기간 fetch
- 고객관리: 이미 on-demand (서버 페이지네이션) — 그대로

### 단계 (각 단계 로컬 dev server 검증 → 배포)
1. **타임라인 on-demand** — TimelinePage가 `selDate` 기준 fetch. AppShell 전역 `data.reservations` 의존 제거. 예약 모달·블록 이동·Realtime 갱신이 전역 data에 묶여있어 연쇄 수정 필요. 규모 중간.
2. **매출관리 on-demand** — SalesPage 조회 기간 기준 fetch. 규모 중간.
3. **정리** — 전역 `data.reservations/sales` 통째 로드 제거. 규모 작음.

### 주의
- 라이브 데이터 흐름 변경이라 단계마다 로컬 검증 필수 (memory feedback_bliss_local_first)
- worktree 작업세션에서 집중 작업 권장 (memory reference_bliss_workflow)
- 지은 요청(id_oqxnamev8r)은 1단계 완료 시 status=done 전환

## 현재 라이브: v3.7.727

## 인수인계 체계
3계층 분리. 자세한 내용은 CLAUDE.md 참고.
