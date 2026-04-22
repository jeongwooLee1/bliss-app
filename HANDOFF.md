# HANDOFF

## 현재 버전
- **라이브: v3.7.4** (https://blissme.ai/version.txt) — 2026-04-22 배포 완료
- v3.7.4 변경:
  - 구매지점 조사(AdminBranchAudit) 각 고객 카드에 "고객정보 ↗" 버튼 추가 → CustomersPage 단일 모드로 이동 (매출상세 포함)
  - AdminPage → AdminBranchAudit로 `setPage` + `setPendingOpenCust` prop drilling

## 오늘 세션 누적 완료 (2026-04-22)

### v3.7.0 → v3.7.1 → v3.7.2 배포
- 타임라인 `selDate` 새로고침 시 오늘로 리셋 (useState(todayStr()))
- 타임라인 새로고침 시 **스크롤도 현재시각으로** (`performance.navigation.type === 'reload'` 감지 → sessionStorage 초기화)
- 좌상단 이름 클릭 → `/timeline` 이동 + 새로고침
- 근무시간 편집 드롭다운 **30분 → 10분 단위** (6:00~23:50)
- Auto-fix `pending → reserved` (기존 `pending → confirmed` 교정)
- AI 예약 확정 버튼 `reserved`로 저장
- `reservations` 초기 로드 3000 → **180일 + 20,000건** (단기 해결, 장기는 Lazy-load 리팩토링 pending)
- 타지점 이용 시 회원가 인정: `SaleForm`에서 `validPkgs` (전지점, 회원가 판정용) / `activePkgs` (구매지점 필터, 차감용) 분리
- **회원가 적용 규칙 관리 페이지 신규** (`AdminMemberPriceRules.jsx`) — 관리설정 → 사업장 관리. `businesses.settings.member_price_rules = { annualEnabled, prepaidMin, excludeServiceIds }`. 바프권 30만 같은 상품을 제외 가능.
- 당일 취소 페널티 **33,000원** 차감: 포인트 → 선불권 우선, 부족 시 다회권 1회 차감. **confirm 팝업으로 확인 후 실행 + 매출 자동 기록**(sales + sale_details insert, memo에 차감 상세)
- 근무외 시간 내부일정 모달 버그 수정 — `isDragging.current` 체크 추가 (블록을 위로 드래그 시 새 모달 뜨던 증상)
- 매출등록 플로 (id_jre7s0tma6) — 이미 구현되어 있음 확인: viewOnly + 당일만 취소 + 하루 지나면 "수정은 매출관리에서"

### 서버 (bliss_naver.py)
- STATUS_MAP 전체 `confirmed → reserved` (AB00, RC02/03/04/RC08 + default)
- 보호 로직 `reserved`와 `confirmed` 둘 다 허용 (기존 데이터 호환)
- 재시작 완료. 백업: `bak_status_reserved`

### DB
- **보유권 구매지점 교정 2,178건**
  - 단일지점 방문 고객 교정 2,058건 (sales.bid 기반)
  - 강남점 디폴트 fallback 교정 118건 (매출 있는 다수 지점 케이스)
  - 김도윤(48996) 2건 왕십리점 개별 교정
  - 남은 12건은 매출 기록 없는 직원/테스트 계정 (보류)
- **구매지점 조사 view 확장** (`customer_pkgs_branch_audit`)
  - 기존: `branch_id IS NULL`만 조회
  - 변경: `reason` 컬럼 추가 (`null` / `mismatch` / `no_sales`) + 유효기간 만료 제외 + `current_bid` 추가
  - 앱 조사 페이지(AdminBranchAudit)에 reason 탭 3개 + 배지 표시
- **RPC 생성 (PENDING)**: `auto_assign_pkg_by_sale_event(p_biz_id, p_dry_run)` — 유효기간 역산(-12개월) + service_name 첫 단어 LIKE 매칭으로 구매일 추정. Dry-run 결과: 11건 매칭 / 58건 no_match. 실제 적용 **대기 중** (유저 결정 필요).

### 수정요청 6건 status=done 일괄 처리 (DB)
- id_uqokfx24ki (Alison 이메일) · id_o3vgbpcf7l (좌상단 이름) · id_2t1n4mbjbe (근무표 10분)
- id_jre7s0tma6 (매출등록 플로) · id_ebgbebctt3 (구매지점 + 타지점 회원가) · id_imgr471swt (3건 마무리)

### v3.7.3 배포 (2026-04-22 늦밤, `channel-deeplink` worktree → main 병합)
다른 세션이 v3.7.2 uncommitted 작업 중일 때 이 세션 앱 수정(`channel-deeplink` 브랜치) 덮어쓴 사고 있었음. 다른 세션이 v3.7.2로 재배포 후 이 세션 MessagesPage.jsx 만 병합해서 **v3.7.3 배포 완료**.

**앱 변경 (MessagesPage.jsx 단일 파일 병합)**:
- **채널별 원본 플랫폼 바로가기** 버튼 (대화 헤더 우측):
  - 네이버톡톡 → `https://partner.talk.naver.com/web/accounts/{naver_account_id}/chat`
  - 인스타 → user_name이 핸들이면 `instagram.com/{handle}/`, 아니면 Meta Business Inbox
  - 왓츠앱 → `https://wa.me/{user_id}` / 카톡 → `center-pf.kakao.com/`
- **`ig_branch_override` 매핑** — `businesses.settings.ig_branch_override = {ig_account_id: branch_id}` 로 branches.instagram_account_id 단일 컬럼 한계 극복
  - 현재: `{"17841455170480955":"br_4bcauqvrb"}` (공용 "하우스왁싱 서울" IG → 강남본점, jaya.krish721 외국 고객용)
- **번역 텍스트 가독성**: opacity 0.55/0.7 → **0.78/0.95**, fontWeight **500**, fontSize 12
- **메시지 echo 중복 표시 방지**: realtime INSERT 핸들러에서 로컬 optimistic entry(id 없음)를 서버 row로 치환
- **모달 stale status race 방어**: `initialServerSnap` 스냅샷 + `stripStaleNaverFields(row)` 헬퍼 (네이버 확정 이메일 처리 중 모달 save가 stale pending 덮어쓰는 버그 차단)

**서버 `bliss_naver.py` 수정 (별도 배포 완료, 백업 `bak_preOutTr` / `bak_preconfirmfix` / `bak_preechoDedup`)**:
- **AI 프롬프트 대대적 강화**: "하우스왁싱 AI 상담사" 정체성, 가격 3단계 자동 생성(정상/신규첫방문/연간회원), 남성 왁서 안내, 볼드 마크다운 금지, 지점 주소 자동 주입
- **Claude Sonnet 전환** (`claude_ask` / `ai_ask` dispatcher, Gemini 폴백 유지) — `ai_booking_agent` + `translate_to_korean`
- **AI 취소 액션** — 기존 예약 있을 때 `action=cancel` 로 실제 DB 취소 + 텔레그램 알림
- **네이버 echo 중복 INSERT 방지** — `send_queue_thread` messages INSERT + echo webhook INSERT 이중 저장 버그. dedup 60초 window 체크
- **out 메시지 한국어 번역 자동 저장** — `_augment_out_translation(text)` 헬퍼. 외국어 out 발송 시 `translated_text` 필드에 한국어 자동 저장 (사장님 대화 히스토리 가독성). 3채널(naver/IG/WA) 모두 적용
- **`create_booking_from_ai` 등 dur int() TypeError 수정**

**DB 변경**:
- `branches.whatsapp_account_id` 홍대점 → `1088922337632781` (16자리, Meta webhook 실젝값)
- `businesses.settings.wa_phone_number_id` → `1088922337632781`
- 기존 WA 메시지 27건 `account_id` 15→16자리 통일
- `businesses.settings.ig_branch_override` 신설
- `businesses.settings.claude_key` 저장 (Sonnet 호출용 API 키)
- `businesses.settings.ai_faq` 신설 (사장님 작성 FAQ)

**AdminAISettings (v3.3.106 배포 완료)** — AI 설정 > FAQ 탭 추가. 사장님이 직접 Q&A 등록/편집/토글/삭제.

---

## Pending (다음 세션 이어갈 것)

### 1. **Lazy-load 풀 리팩토링** (유저 B안 선택, 현재 PENDING)
- 현재 단기 해결: AppShell 초기 `reservations` 180일 + 20,000건
- **Phase 1**: 타임라인 초기 오늘 ±14일, selDate 변경 시 range 부족하면 추가 fetch. `loadedDateRange` state로 중복 방지
- **Phase 2**: ReservationsPage는 날짜 range 쿼리, 통계는 RPC, 고객관리 매출 히스토리는 `cust_id` 쿼리
- 각 페이지가 `data.reservations` 전체 가정하고 filter하는 패턴 전면 교체

### 2. **auto_assign_pkg_by_sale_event RPC 실제 적용** (PENDING)
- Dry-run 11건 확인됨
- `SELECT auto_assign_pkg_by_sale_event('biz_khvurgshb', false);` 실행하면 반영
- 유저가 "일단 대기" 요청 → 실행 안 함

### 3. **WhatsApp Cloud API 마무리**
- ✅ 강남점 등록 완료: 821080086547 (ID `1088922337632781`)
- ⏳ **홍대마곡점** 등록됨 (ID `1022503714290354`), OTP 인증 **rate-limited** — 24h 대기 후 재시도
- ⏳ **잠실위례점** 등록됨 (ID `1140758199115714`), OTP 인증 **rate-limited** — 동일
- ⏳ **천호점** 821026504735 — 지점 핸드폰 WhatsApp 계정 삭제 필요
- ⏳ **용산점** 821023308088 — 지점 핸드폰 WhatsApp 계정 삭제 필요
- OTP 인증 완료 후 DB 업데이트 필요:
  - `branches.whatsapp_account_id` 각 지점별 세팅
  - `businesses.settings`의 WhatsApp 설정 브랜치별 매핑

### 4. (보류) 세션 복구 Phase 2-4 — 로컬 watchdog / 캡차 자동화 / Task Scheduler
### 5. (보류) Naver 자동예약 기본 상태 (id_7um1c7bp3o) — 서버 STATUS_MAP은 이미 reserved로 고침. 추가 이슈 있으면 재검토
### 6. (보류) 직원 지점 이동 시 예약 자동 이동 (id_825fnuel64)
### 7. (보류) AI 설정 UI 개선 (id_triao6fesy)

---

## 다음 세션 진입 시 체크
1. `git fetch origin main` 후 `git log HEAD..origin/main` 으로 다른 세션 push 유무 확인
2. **main worktree uncommitted 상태** — v3.7.3 작업 포함 10개 파일 + 신규 `AdminMemberPriceRules.jsx`. 커밋 안 된 상태. 정리 필요 시 `git add -p` + `git commit`
3. 주요 worktree 목록:
   - `channel-deeplink` (feat/channel-deeplink) — v3.6.33~36 로컬 커밋 4개. **MessagesPage.jsx 수정은 이미 v3.7.3에 병합 배포됨**. 브랜치 삭제 가능 (보류 시 참고용)
   - `ai-prompts-v3629` (feat/ai-prompts-v3629) — v3.6.30~31. 이미 origin/main 04542d6 에 merge됨. 삭제 가능
   - `ai-faq-settings` (feat/ai-faq-settings) — AdminAISettings FAQ 탭. 이미 v3.3.106~배포됨
   - `bliss-ai`, `chat-sidebar`, `pkg-audit-rewrite`, `saleform-mobile-fix`, `timeline-scroll-memory`, `user-requests-only`, `visitor-sale-target` — 이전 세션 잔여
4. `naver-sync` 쪽 worktrees:
   - `naver-sync-ai-review` (ai-review) — Claude Sonnet + FAQ + cancel action + 3단계 가격. 서버 배포 완료
   - `naver-sync-echo-dedup` (fix/naver-echo-dedup) — echo dedup + out translation. 서버 배포 완료. origin/master 에 push 안 됨
5. 유저 지시 대기

## 🚨 관리 세션 간 경쟁 방지 (이 세션 실제 사고 기반)
- **배포 직전** 반드시 `git fetch origin main && git log HEAD..origin/main` 확인
- `curl https://blissme.ai/version.txt` 로 서버 현재 버전 재확인 (다른 세션 직전 배포 있는지)
- **main worktree uncommitted 변경**이 다른 세션 작업일 수 있음. `git status` 보고 낯선 변경이면 **건드리지 말고** 유저에게 물음

## 주의사항 (CLAUDE.md와 중복 금지)
- **배포는 모아서 한 번에** — 유저가 "배포" 신호 주면 BLISS_V + version.txt 둘 다 bump + 빌드 + 서버 + CF 퍼지
- **배포 묻지 않고 바로** — 메모리 feedback_bliss_deploy_auto 준수
- **회원가 규칙 `member_price_rules`** — `businesses.settings` JSON 문자열 내부에 저장. 수정 시 반드시 JSON 전체 parse → 수정 → stringify (기존 settings 덮어쓰기 금지, 이전 v3.6.2 사고 참고)
- **보유권 구매지점 제한(`canUsePkgAtBranch`) 이미 작동 중** — NULL 허용, 동일지점/그룹/예외만 통과. 기존 HANDOFF "제한 해제" 기록은 폐기.
- **서버 status reserved 전환됨** — 앞으로 네이버 동기화 예약은 `reserved`로 저장. 기존 `confirmed` 데이터도 보호 로직에 포함되어 호환.
