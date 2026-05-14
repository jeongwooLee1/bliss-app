# HANDOFF

## 현재 버전
- **라이브: v3.7.718** (https://blissme.ai/version.txt) — 2026-05-14 배포
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

## 📋 다음 세션 작업 (별도 큰 작업) — KB 입금문자 자동 파싱

**컨텍스트**:
- 매장 (하우스왁싱 강남점) 입금 받는 계좌: **KB 809101-04-203812** (404계좌에서 완전 전환 예정)
- 매장 사장(이정우) 폰에 `#국민은행`발 SMS 옴 (`[Web발신] [KB]MM/DD HH:MM / 거래자명 / 입금|출금 / 금액 / 잔액`)
- 매장 사장 폰 → iCloud Messages sync → Mac `~/Library/Messages/chat.db`에 저장됨
- 이걸 파싱해서 Bliss에 입금 내역 + 매출 매칭으로 자동 표시

**UI 디자인 (확정)**:
- ✅ A. **상단 배너막대** (확정대기 패턴) — 새 입금 즉시 알림 + 클릭하면 매칭 모달
- ✅ B. **별도 페이지 "은행 입금"** (사이드바 신규 메뉴) — 전체 입금 내역 관리·검색
- ❌ C. 메시지함 입금 탭 — 사용자 결정: 비추 (메시지함은 손님 대화만 유지, 분리 명확)

**구현 단계** (예상 2~3시간):
1. DB 테이블 `bank_deposits` 신규 — `id, business_id, branch_id, account_last4, transferer_name, kind('deposit'|'withdraw'), amount, balance, sms_sent_at, parsed_at, matched_sale_id?, raw_text`
2. **Mac 백그라운드 데몬**: Node 또는 Python — `~/Library/Messages/chat.db` SQLite 5분 폴링 → `#국민은행` + `[KB]` + `809101-04-203812` 관련 메시지 추출 → 정규식 파싱 → Supabase REST INSERT (Full Disk Access 권한 필요)
3. **launchd plist**: `~/Library/LaunchAgents/com.bliss.kb-sync.plist` — 부팅 시 자동 시작 + 5분 간격
4. **상단 배너**: `BannerHost` 또는 AppShell에 신규 입금 알림 (Realtime 구독으로 새 row 감지)
5. **별도 페이지**: `BankDeposits.jsx` 신규 컴포넌트 + 라우트 `/deposits` + 사이드바 메뉴 (강남점만 노출하다가 다른 매장 추가 시 확장)
6. **매출 매칭**: SaleForm에 "입금(계좌이체)" 결제수단 선택 시 최근 미매칭 입금 후보 추천 (이름·금액 fuzzy match)
7. v3.7.719 빌드·배포

**새 세션 시작 시 사용자가 챙길 것**:
1. KB 809101-04-203812 계좌 활성화 + 매장 사장 폰에 SMS 도착 확인
2. **샘플 SMS 1~2건 캡처** (입금 패턴 + 다른 패턴 비교)
3. Mac에 KB 메시지 sync 환경 확인 (현재 OK)
4. 다른 매장 (왕십리·마곡 등)은 Phase 2로 별도 작업 (각 매장 사장 폰·계좌별 셋업 필요)

## 인수인계 체계
3계층 분리. 자세한 내용은 CLAUDE.md 참고.
