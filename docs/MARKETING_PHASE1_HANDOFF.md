# 마케팅 단체발송 Phase 1 — 작업세션 → 배포세션 인계

브랜치: `feat/marketing-broadcast` (worktree `.claude/worktrees/marketing-broadcast`, main 기준)
작업: 마케팅 → 단체 문자 발송 Phase 1 (문자). 경쟁사(공비서) 6/24 출시 대응.

## 완료 (코드 + 로컬 검증)
신규 "마케팅" 메뉴(사이드바 고객관리 그룹, `/marketing`, isMaster). 세그먼트 골라 사업체 전체 고객에게 단체 문자.

### 신규 파일
- `src/components/Marketing/MarketingBroadcast.jsx` — 발송 화면 (세그먼트→카운트→메시지→즉시/예약→미리보기/테스트/차감→발송)
- `src/lib/smsSend.js` — send-sms 발송 공통 헬퍼 (SendSmsModal 인라인 로직 추출: byteLen/callSendSms/isAck/deductSmsBilling/applyAdFormat/isNightBlocked)
- `supabase/migrations/20260609_marketing_broadcast.sql` — DB 테이블 2개 (⚠️ **미적용**)
- `docs/marketing_scheduler_snippet.py` — 예약 발송 서버 스케줄러 (⚠️ **미적용**)

### 수정 파일
- `src/pages/AppShell.jsx` — import + PAGE_ROUTES.marketing + nav item(`marketing`) + `/marketing` Route
- `src/components/Navigation/Sidebar.jsx` — "고객 관리" 카테고리에 marketing 추가

### 재사용 (변경 없음)
- 세그먼트 프리셋 기준 = CustomersPage 와 동일 (전체/신규/재방문/단골/이탈/노쇼/보유권, `get_customers_with_active_pkg` RPC)
- send-sms Edge Function (UMS NPRO), `deduct_billing` RPC, `branches.sms_callback` 발신번호
- 080 수신거부 번호 저장 = `businesses.settings.ad_optout_080` (광고 토글 시 페이지에서 인라인 등록)

### 법규 강제 (구현됨)
1. `sms_consent !== false` 만 — 세그먼트 쿼리 `or=(sms_consent.is.null,sms_consent.eq.true)` + fetch 후 재검증
2. 광고성 ON → 본문 앞 `(광고)` + 끝 `무료수신거부 {080}` 자동 부착. **080 미등록 시 광고 발송 차단**
3. 야간 21:00~08:00 발송 차단 (즉시=현재시각 / 예약=지정시각, 둘 다 검증)
4. 발송 전 커스텀 confirm 모달 (native alert/confirm 미사용 — 전부 디자인 모달 + "저장됨✓" 토스트)

### 즉시 발송 (앱이 직접 처리 — 동작 완성)
앱이 `fetchRecipients()`(페이지네이션, 수신동의+유효휴대폰 dedup) → send-sms 배치(100/건, 변수 시 1:1) → `marketing_sends` 로그 + `marketing_campaigns` status=done + billing 차감.

## ⛔ 배포세션이 적용할 것 (작업세션 라이브 반영 금지로 미적용)

### 1. DB 마이그레이션 적용 (필수 — 없으면 발송/이력 INSERT 404)
`supabase/migrations/20260609_marketing_broadcast.sql` 실행:
- `marketing_campaigns` (캠페인) + `marketing_sends` (발송 로그)
- RLS ENABLE + `anon_all_marketing_*` 정책 (reference_supabase_rls 패턴)
- 적용 후 로컬/라이브 즉시 발송 INSERT 정상 (현재는 graceful 404 → 이력만 안 보임)

### 2. 예약 발송 서버 스케줄러 (즉시발송은 앱 처리라 무관, 예약만 서버 필요)
`docs/marketing_scheduler_snippet.py` 의 함수 + `marketing_campaign_thread` 를 `bliss_naver.py` 에 추가 + 스레드 시작 + `systemctl restart bliss-naver`.
- 60초 폴링, `status='scheduled' & scheduled_at<=now` 선점 → 발송 시점 세그먼트 재평가 → send-sms 배치 → 로그 + status=done. 야간 재검증 포함.
- `_kr_mobile`/`SB_HEADERS`/`BLISS_PUBLISHABLE_KEY` 기존 정의 재사용.
- 미적용 상태에선 앱이 예약 INSERT 후 "서버 스케줄러 적용 후 동작" 안내만 (즉시발송은 정상).

### 3. 앱 배포 (배포세션 표준 절차)
- `BLISS_V`(AppShell.jsx) + `public/version.txt` 둘 다 bump
- 빌드·서버복사·CF퍼지·git commit+push (배포 묶음)

## 로컬 검증 완료 (dev server, 데모 계정, **실제 발송 미트리거**)
- 페이지 렌더, JS/렌더 에러 0 (콘솔 에러는 marketing_campaigns 404 예상치만)
- 세그먼트 카운트 = count=exact + 수신동의 필터 (전체 40 / 신규 2, 데모)
- byte/LMS 라이브, 예상 차감(건수×20/60P)
- 광고 ON + 080 미등록 → 발송 차단 alert (커스텀)
- 광고 OFF 즉시발송 → 실수신자 fetch(40명) → 커스텀 확인모달(취소/발송)
- 야간 22:30 예약 → 야간 차단 alert
- ⚠️ 실제 발송/테스트발송은 라이브 Supabase·실 SMS 트리거 우려로 미실행 — 배포 후 테스트발송(본인폰)으로 1회 확인 권장

## 다음 단계 (Phase 2/3 — 미착수)
- Phase 2: 카카오 친구톡 + 이미지 (친구톡키 매장별 설정·검수 선행, 친구톡 이미지 + MMS). `channel`/`image_url` 컬럼 이미 마련.
- Phase 3: `marketing_sends.sent_at` + customer_id 로 발송 후 N일 내 예약(reservations)·매출(sales) 전환 집계 RPC + 화면. `idx_mkt_sends_conv` 인덱스 마련.
