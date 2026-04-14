# HANDOFF

현재 진행 중인 작업의 인수인계 상태.

## 작성 규칙
- 자격증명·환경정보·아키텍처는 여기 넣지 않는다 (→ CLAUDE.md)
- "무엇을 / 왜 / 다음 행동"만 기록한다

---

## 완료: pkg_audit bliss_packages 캐시 갱신 (2026-04-14)
- customer_packages 명칭 변경(13건) DB 완료
- pkg_audit bliss_packages JSON 캐시 819건 PATCH 완료 (8,344건 전수 갱신)

---

## 2026-04-14 세션 2 작업

### 서버: 세션 에러 시 fail_count 미증가
- scrape_reservation: 세션 만료 시 SESSION_ERROR 반환 → fail_count 안 올림
- 서비스 재시작/keepalive 성공 시 fail_counts 자동 리셋
- 박민아 #1207530167 예약 수동 confirmed + 시간 20:30 수정

### 알림톡 팝업: 시간 변경 시에만
- 메모/담당자 변경 시 알림톡 팝업 안 뜨도록 수정

### MiniCal 에러 수정
- AppShell.jsx에서 MiniCal export, TimelinePage에서 import 추가

### 매출등록 시술 선택 연동 수정
- SaleForm: 다회권 자동선택 시 예약에서 넘어온 시술 선택 유지
- SaleForm: 패키지 수량 변경 시 시술 선택 해제 안 함

### 설정마법사 항상 표시
- AppShell: wizard_progress 완료 여부 무관하게 메뉴 항상 표시

### 고객검색 개선
- ReservationModal: cust_num 정확매칭 우선 조회 (숫자 검색 시)
- ReservationsPage: cust_num, name2 검색 대상 추가

### 타임라인 프리랜서 추가
- "+" 팝업 하단에 프리랜서 이름 입력 → customEmployees_v1에 저장
- 즉시 해당 지점 컬럼에 표시

### 예약모달 담당자 변경 → 컬럼 이동
- handleSave에서 staffId 변경 감지 → room_id + bid 자동 업데이트

### 브랜드 권한: 같은 사업장 전 지점 편집 가능
- AppShell: 모든 역할에서 userBranches = 전 지점

### 타임라인 예약블록에 보유패키지 표시
- 해당 날짜 예약 고객의 customer_packages 일괄 로드
- 패키지(회색)/다담(노란) pill 표시

### 패키지 정리 페이지 (AdminPkgAudit)
- Supabase pkg_audit 테이블 생성 (3소스 병합 데이터)
- scripts/upload_pkg_audit.py: 매출메모(pkg_analysis.xlsx) + 오라클 + 블리스 → 8,344명 업로드
- AdminPkgAudit.jsx: 3소스 비교 카드, 지점/상태 필터, 검색
- 매출 이력 보기: 인라인 매출 테이블 + 패키지/다담 자동 파싱
- 블리스 수정: 인라인 편집 (모달 제거), 만료된 항목 비활성화
- 만료일 표시/수정 가능
- 유효 항목 없는 고객 자동 필터링
- 다담권 소진(0원) 3소스 일치 시 제외

### 패키지 명칭 정형화
- 남)/여) 접두사 제거, 패키지→PKG 통일
- 13개 명칭 일괄 변경 (customer_packages DB)
- 쿠폰 카테고리: 10%적립쿠폰, 제품전용쿠폰, 기기스크럽

---

## 2026-04-14 세션 작업

### 네이버 스크래핑 세션 복구
- login_local.py 쿠키 캡처 방식 변경: CDP request interception → `Network.getAllCookies` (NID_AUT httpOnly 캡처 불가 문제 해결)
- 로그인 타임아웃 180s → 300s (CAPTCHA 대응)
- 서버 세션 전송 + 서비스 재시작 + last_processed 갱신 완료

### 누락 예약 15건 복구
- 스크래핑 중단 기간(4/14 01:09~07:39) 누락 15건 식별
- 2건 취소, 13건 수동 DB insert
- 13건 request_msg(네이버 예약폼 JSON) 별도 스크립트로 보정
- 13건 AI 분석(Gemini) 수동 실행 → selected_services/selected_tags 채움

### 타임라인 직원근무시간 자동계산 수정
- `parseInt("11:30")` → 11로만 파싱, 종료시간 항상 `:00`이던 버그
- 분까지 파싱하여 +10시간 정확 계산 (11:30 → 21:30)

### 설정마법사 버그 4건 수정 (배포 완료)
1. **텍스트 무응답**: photo_upload 스텝에서 parsedData=null일 때 Gemini 대화 fallback 추가
2. **한국어 IME Enter**: `onKeyDown` → `onKeyUp` 변경 (isComposing 문제)
3. **수동모드 대화 안 됨**: `parsedData._manual` 체크 추가 → 수동 진입 시 Gemini 대화 정상 작동
4. **employees_v1 duplicate key (23505)**: `insert` → `upsert` 변경
5. **complete 스텝**: 정적 "감사합니다!" → callGemini() 대화형으로 변경
- wizardSteps.js: photo_upload/complete 스텝에 systemPrompt 추가

### 서버: AI 메모 쓰기 비활성화
- bliss_naver.py: `if ai_special_notes:` → `if False and ai_special_notes:` (owner_comment에 [AI] 꼼꼼 등 안 씀)

### 배포 상태
- 위 모든 수정 빌드 + 서버 배포 + CF 캐시 퍼지 완료 (2026-04-14)

---

## 2026-04-13 회원가 시스템

### 회원가(Member Pricing) 구현
- DB: services 테이블에 `member_price_f`, `member_price_m` 컬럼 추가 (Supabase SQL Editor)
- 10개 시술에 회원가 설정: 브라질리언+케어, 브라질리언, 비키니, 항문, 산모관리, 재생관리, 기기진정관리, 진정팩, 풀페이스, 속눈썹펌
- db.js: DBMAP/DB_COLS에 memberPriceF/memberPriceM 추가
- **SaleForm**: `_defPrice()` 함수로 회원가 자동 적용, `isMemberPrice` 플래그 (에너지/제품 제외)
  - 보유권(다담권/다회권/연간회원권/연간할인권) 보유 고객 → 회원가 자동 적용
  - 에너지이용권/제품구매권은 회원가 자격 미해당
  - SaleSvcRow에 "회원" 태그 + 정상가 취소선 표시
  - 성별 변경 시 체크된 시술 가격 재계산
- **AdminSaleItems**: 시술 카드에 회원가 화살표(→) 표시, 편집 폼에 회원가 입력 필드 추가
- **ReservationModal**: 시술 선택 시 회원가 반영된 가격 표시

### 이전 세션 완료 (매출 리스트 개선 + AI 디버그 정리)
- SalesPage: sale_details 레이지 로딩 + 결제수단 표시 (PaySummary 컴포넌트)
- ReservationModal/MessagesPage/AppShell/db.js: debug alert()/console.log() 제거
- oracle_sync.py: 이름 없는 매출 수정 (Oracle MEMBER 직접 조회 fallback)
- sale_details 중복 237K건 삭제, sales 중복 60K건 삭제

### 매출 메모 패키지 분석
- pkg_analysis.tsv/json: 1,201명 고객, 1,394건 패키지 엔트리
- 유저 확인 후 customer_packages 업데이트 예정

## 2026-04-13 완료

### 타임라인 ↔ 근무표 양방향 연동
- TimelinePage: `syncOverrideToSch()` 함수로 empBranchOverride → schHistory에 `지원(지점)` 반영
- SchedulePage: `syncSchToOverride()` 함수로 schHistory 변경 → empBranchOverride 반영
- `branchIdToSchName` / `schNameToBranchId` 매핑 memo

### 패키지 고객 매출등록 워크플로우
- 패키지 보유 고객: 시술 선택 영역 상단에 보유 패키지 표시 + qty 스테퍼 (증감 버튼)
- `pkgItems` state: `{id: {qty: N}}`, 그룹 기반 분배 (같은 그룹 내 균등 배분)
- 선불잔액(다담권) 결제수단 버튼, 다회권은 수량 기반 차감 (금액 차감 아님)
- `getSvcDur()`: pkg__ ID에서 PKG 카테고리 서비스 매칭하여 시술시간 반환

### SaleForm UI 전면 개편
- 모든 금액 필드 comma formatting (`fmtAmt`/`parseAmt`)
- 시술/제품/추가/할인 행 통일 디자인 (width 95px)
- 결제수단 세로 배치 (flexDirection: column)
- 메모 자동 높이 + 템플릿 자동 채움 (businesses.settings.memo_templates.sale)

### 예약모달 개선
- 고객번호 표시 (서버 조회 + 로컬 캐시)
- CopySpan: 이름/연락처/고객번호/이메일 클릭 복사 + "복사 ❤️" 토스트
- AI 분석: 코드 레벨 패키지 자동 감지 (regex)
- 보유 패키지 서비스 picker에 표시 + pkg__ 선택 → SaleForm 자동 전달

### 메모 템플릿 기능
- AdminMemoTemplates.jsx: 매출/예약/고객 메모 템플릿 관리 (3탭)
- businesses.settings.memo_templates에 저장/로드
- SaleForm: 메모 비어있으면 템플릿 자동 채움

### Oracle ORDERDETAIL 전체 마이그레이션
- Phase 1: 누락 ORDERS 60,151건 → sales 추가 (migrate_all_orders.py)
- Phase 2: ORDERDETAIL 287,943건 → sale_details 추가 (migrate_orderdetail2.py)
- ROW_NUMBER() OVER (PARTITION BY ORDERNO) 사용하여 고유 ID 생성
- 임시 스크립트 삭제 완료

---

## 2026-04-10~11 완료

### 네이버 세션 자동 갱신
- tg_daemon.py: 텔레그램 봇 폴링 데몬 (로컬 PC 상시 실행, Windows 시작 시 자동)
  - 10분마다 서버 scraper 상태 체크 → dead면 login_auto.py 자동 실행
  - /login 명령 → 즉시 재로그인
  - /status 명령 → 서버 상태 체크
  - /stop 명령 → 데몬 종료
- login_auto.py / login_local.py: CDP Network 모니터링으로 NID_AUT 캡처 (핵심!)
  - Playwright storage_state()는 NID_AUT를 못 잡음 → fetch 실행 후 Request Cookie 헤더에서 추출
  - CAPTCHA 시 텔레그램 이미지 → 유저 답변 → 입력 (login_auto.py)
- 서버 keepalive 6시간마다 (04/10/16/22시)
- Task Scheduler: BlissNaverSession, BlissSessionCheck 비활성화

### 서버 복구 (bliss_naver.py)
- Supabase 키: 레거시→publishable (4/8 비활성화 대응)
- server_id 고정 (oracle IP 분기 제거)
- Gmail 앱 비밀번호 갱신: `yhnz ibej giha sgnr` (.env에 저장)
- /gmail-push 엔드포인트 복원 (Google Apps Script push 수신)
- /instagram, /whatsapp, /naver-talk 엔드포인트 복원
- 주의: 서버 코드 수정 시 원본(a96156a^ 커밋)을 기반으로 할 것. 중간 커밋들에 코드 손실 있음

### AI 통합
- 모델 통일: gpt-4o-mini→gemini-2.5-flash (서버+프론트 전체)
- AI hallucination fuzzy ID 보정 (1-2글자 차이 자동 보정)
- Gemini 키 시스템 제공 (__systemGeminiKey 우선, 개별 설정 불필요)
- AI 설정 메뉴 owner/super만 접근, 시스템 키 있으면 API 탭 숨김

### 회원가입 / 온보딩
- 회원가입 일반화: 하우스왁싱 특화 제거, 지점 없이 가입 허용
- 설정 마법사: AI 대화형 온보딩 (사진/엑셀/텍스트 드래그드롭 + Gemini Vision)
- Google 소셜 로그인: OAuth 연동 완료 (자동 계정 생성 + 설정 마법사 자동 시작)
- 소셜 로그인 로직: AppShell 초기화 시 supabase.auth.getSession() → app_users 매핑/자동 생성
- app_users 테이블에 email 컬럼 추가 (Supabase SQL Editor)

### 버그 수정
- reservation_sources insert→upsert (중복키 에러)
- SchedulePage React.useCallback 미import (React not defined 에러)
- service_categories에 use_yn 컬럼 없는 문제 (설정 마법사)

---

## 작업: 오라클 DB 전체 Supabase 마이그레이션
**상태**: 주요 데이터 완료, 나머지 펜딩.

### 완료
- MEMBER → customers: 42,849명 (visits 갱신 완료)
- ORDERS → sales: 176,400건 (116,249 기존 + 60,151 추가 마이그레이션)
- ORDERDETAIL → sale_details: ~600,000건 (312,022 기존 + 287,943 추가)
- daily_sync.py에 cust_num fallback 매칭 추가

### 펜딩 (다음 세션)
- 패키지 추가구매 고객 분석: 마지막 매출 분석 → PKG 추가구매 건 자동 탐지
- MESSAGE (491,899건) — 문자 발송 이력
- SMSRESULT (642,702건) — 문자 발송 결과
- POINT (13,867건) — 포인트/마일리지
- BOOKING (2,498건) — 예약
- BANKACCOUNT (15,741건) — 입금 내역
- SERVICE (544건) — 시술 메뉴
- GIFTCERT (1,000건) — 상품권
- BAK/TMP 테이블은 불필요

### 주의
- 오라클 접속: googlea.withbiz.co.kr:5063/ORA11GHW (housewaxing/oracle)
- 로컬 PC IP만 허용됨 (Oracle Instant Client: instantclient_23_7)
- Supabase Pro 플랜 업그레이드 완료 ($25/월)
- Egress 대량 사용 주의 (한 번에 너무 많이 하지 말 것)

---

## 2026-04-11~12 완료

### 카카오 소셜 로그인 완료
- 비즈 앱 전환 완료 (주식회사 테라포트, 632-81-02070)
- 동의항목 account_email "선택 동의" 설정 완료 (동의 목적: 회원 식별 및 로그인 계정 연동)
- Supabase Client Secret 수정: 카카오 "플랫폼 키 > REST API 키 수정 > 클라이언트 시크릿" 값 사용
  - 기존: REST API Key 중복 입력 (cef0d988...) → code exchange 실패
  - 수정: 실제 클라이언트 시크릿 코드 (5owAOa1G67WdwRhH7VKikS0cRFbPpsAJ) 입력
- 카카오 로그인 테스트 성공: cripiss@kakao.com → "이정우님의 사업장" 자동 생성 + 설정 마법사 시작
- 참고: 카카오 앱 아이콘(bliss_logo.png) 등록은 이전 세션에서 완료됨

### 타임라인 지점 표시 설정
- TimelineSettings에 지점별 토글 버튼 UI 추가
- allBranchList, viewBids, toggleView props 전달
- isMaster: 전 지점 토글 가능, 일반: accessibleBids 내 토글

### alimtalk_thread watchdog 추가
- watchdog에 t7(alimtalk) 생존 체크 + 자동 재시작 추가
- 상태 로그에 alimtalk 상태 포함
- 폴링 디버그 로그 (처음 3회 + 매 1시간)
- naver-sync repo push 완료 → crontab 자동 동기화

### 고객관리 예약통계 표시
- 상세 패널에 예약횟수/노쇼/당일취소 카운트 표시
- reservations 테이블에서 cust_id 기준 조회 (status 기반 집계)

### 참고: Google OAuth 설정
- Google Cloud 프로젝트: bliss-492906
- Client ID: 483655734800-mbus7qgbdhsr5hdjprub7vmfhekeecdj.apps.googleusercontent.com
- Redirect URI: https://dpftlrsuqxqqeouwbfjd.supabase.co/auth/v1/callback
- Supabase Site URL: https://blissme.ai/bliss-app/
- Supabase Redirect URL: https://blissme.ai/bliss-app/**

### 서버 코드 주의사항
- bliss_naver.py 수정 시 반드시 원본 기반(git show a96156a^:bliss_naver.py)으로 작업
- crontab이 매분 git fetch → bliss_naver.py 변경 감지 시 자동 restart
- .env 파일에 GMAIL_APP_PASSWORD 등 환경변수 저장 (코드에 하드코딩 X)
- 서버 패치 후 반드시 git push → crontab이 동기화될 때까지 대기

---

## 2026-04-09 완료 (CLAUDE.md 승격 대기)

- 예약목록 필터 실시간 반영 버그 수정 (resPage 리셋)
- 고객관리: 이메일 칼럼, 성별 수정 에러(23505), 수정 즉시 반영, 숨김 제거, 보유권 만료 구분
- 검색 통일: 전 검색창 ilike 부분일치 + email/cust_num 추가
- 예약목록 성별 백필 (genderMap + 469건 cust_id 링크 + 86건 cust_gender)
- 권한 체계: isMaster=owner|super만, manager 관리메뉴 접근 가능(브랜드멤버/사용자관리 제외)
- AdminPlaces userBranches 필터, 알림톡/메시지 userBranches 필터
- 담당자관리 페이지 삭제
- 하드코딩→DB: naver_account_id, instagram_account_id, whatsapp_account_id
- _BR_ACC/_ACC_NAME/branchAccMap 3곳 제거 → data.branches 동적
- AdminPlaces에 외부 서비스 연동 UI + booking_notice + alt_phone
- 알림톡 전체 구현: queueAlimtalk, 9개 트리거(rsv_confirm/change/cancel/1day/today/aftercare, pkg/tkt/annual)
- 전 지점 알림톡 설정 (지점별 senderKey, 공통 aligoKey)
- 시술후 케어 알림 5개 등록 (UG_8978~8982, 카카오 심사중)
- r.html 예약확인 페이지: 네이버 지도(ncpKeyId=20e46c5nm6) + 안내문구 DB + 지도 링크
- URL: jeongwoolee1.github.io → blissme.ai/bliss-app/r.html
- 시술상품 정렬: 카테고리sort→시술sort 2단계 + 줄바꿈 방지
- 제품관리 빈 화면 수정 (productItems→products 키 통일)
- 직원출근표 잠금 풀림 수정 (월 이동 시 DB 재로드)
- 관리설정 받은메시지함 중복 제거
- 강남점 안내문구/대체연락처 설정
- 전 지점 알림톡 OFF (테스트 완료 후 대기)

---

## 작업: 시술후 케어 알림톡 (5/10/21/35/53일)
**상태**: 정보성 문구로 수정 → 재검수 중 (영업일 3~5일).

### 상황
- UG_8978~8982 5개 모두 첫 심사 반려 (광고성 메시지로 판단됨)
- 정보성 문구로 수정 완료 (시술 완료 액션 기반 + 관리 안내)
- 5개 모두 "검수중" 상태 (2026-04-11 재신청)

### 다음 행동
1. 카카오 검수 승인 확인
2. 승인 후 DB noti_config의 msgTpl을 새 문구로 업데이트
3. 알림톡 ON으로 전환

---

## 작업: schedule_data 비즈니스 격리 (critical)
**상태**: 미착수. 우선순위 높음.

### 문제
- `schedule_data` 테이블 쿼리가 **business_id 필터 없이** key만으로 조회
- 모든 사업장이 동일한 employees_v1, schHistory_v1, maleRotation_v1 데이터를 공유
- 새 사업장 가입 시 기존 하우스왁싱 근무표 데이터가 그대로 노출됨

### 영향 범위 (수정 필요한 파일)
- `src/lib/useData.js`: useEmployees, useSchHistory, useMaleRotation, useScheduleData 훅 — 전부 `.eq('business_id', bizId)` 추가
- `src/components/Schedule/SchedulePage.jsx`: 직접 조회 (line 45, 56, 160, 274)
- `src/components/Timeline/TimelinePage.jsx`: REST fetch (line 48-49)
- `src/components/SetupWizard/SetupWizard.jsx`: employees_v1 upsert (line 289-294, 320-325)
- 기존 DB 행에 business_id 컬럼 값 채워야 함 (마이그레이션)

### 수정 방안
1. 모든 schedule_data 읽기에 `.eq('business_id', bizId)` 추가
2. 모든 schedule_data 쓰기에 `business_id: bizId` 포함
3. id를 `${bizId}_${key}` 형식으로 변경 (PK 충돌 방지)
4. 기존 데이터: `UPDATE schedule_data SET business_id='biz_khvurgshb' WHERE business_id IS NULL`
5. hooks에 bizId 파라미터 추가 → SchedulePage, TimelinePage에서 전달

### 주의
- SchedulePage는 현재 props 없이 렌더링됨 → bizId prop 추가 필요
- TimelinePage는 이미 bizId prop 있음
- 알림톡 세션 작업 끝난 후 진행 (파일 충돌 방지)

---

## 작업: 시술상품/제품관리 버그 수정 (2026-04-11 완료)

### 수정 내용
- **시술 카테고리 입력 불가**: 카테고리 없을 때 빈 select → "카테고리 없음 + 추가 버튼" 표시
- **DB 저장실패 메시지**: sb.insert 실패 시 alert만 띄우고 throw 안 함 → 로컬 상태 업데이트 차단 (`if(!res)return;`)
- **제품 모달 버튼 2개**: ASheet onSave + 내부 AIBtn 중복 → AIBtn 제거

---

## 2026-04-12 완료

### 보유권 유효한 것만 표시
- 고객 리스트 보유권 셀: 만료/소진 제외, 유효만 pill
- 보유권 탭 카운트: `2/4` → `2` (유효만)
- 예약모달 보유권 pill: 유효만

### 네이버 세션 갱신 자동화
- tg_daemon.py: 텔레그램 봇 폴링 데몬 (10분마다 서버 체크 + /login /status /stop 명령)
- login_auto.py/login_local.py: CDP Network 모니터링으로 NID_AUT 캡처
- Windows 시작프로그램 바로가기 등록 (BlissTGDaemon.lnk)
- subprocess 창 숨김 (startupinfo=_SW_HIDE)

### 직원 통합 관리
- MALE_EMPLOYEES 하드코딩 제거 → 전 직원 employees_v1에 통합 (21명)
- 재윤/주용/한솔/령은 employees_v1 추가
- 직급 시스템: 원장/마스터/시니어/인턴 (rank 필드)
- 직원 설정 모달에 직급 선택 UI + 휴무 설정 탭 (원장설정 통합)
- 원장설정 메뉴 제거

### 지점 영업시간 / 직원 근무시간
- branches.timeline_settings에 openTime/closeTime/defaultWorkStart/defaultWorkEnd 저장
- 예약장소 관리(AdminPlaces)에 영업시간 + 기본 근무시간 UI
- 직원 디폴트 근무시간 = 지점 기본 근무시간 (empWorkHoursDefault_v1 대체)
- 헤더 팝업 근무시간: 저장 버튼 전까지 state 변경 안 함, +10시간 자동계산 수정
- 출퇴근 시간 텍스트 제거 (회색 영역만 표시)

### 4월 근무표 엑셀 파싱 → schHistory 반영
- 26년 휴무11111.xlsx 4월 시트 파싱 (openpyxl rich_text)
- 빨간 글자 = 휴무, (논) = 강남이동, (홍용쉐) = 홍대+용산지원
- schHistory_v1 월별 구조 (`{"2026-04": {"직원": {"날짜": "상태"}}}`)
- 파싱 버그 수정: 날짜행→데이터행 매핑 (date_row+1), RED 우선 휴무 확정

### 서버 rescrape 버그 수정
- NameError: `row.get(cust_name,)` → `row.get('cust_name', '')`
- pending 강제 설정: rescrape action="new" → "rescrape" (confirmed 유지)

### AI 가격 안내 개선
- svcPriceText 카테고리별 대표 시술만 (priorityCats)
- data.serviceCategories → data.cats 매핑 수정
- 프롬프트: 대표 가격 즉시 안내, 시술 종류 되묻지 않기
- 스킨케어 = 얼굴관리, 애프터케어(케어/재생관리/진정팩) 가격에서 제외

### 기타
- 복사/드래그: 타임라인만 차단, 모달/목록 복사 허용
- 예약번호 검색: 이미 동작 중 확인
- 시술항목: 산모1회 삭제, 케어 카테고리 생성 (케어/재생관리/진정팩/기기진정관리)
- 카테고리 순서: 브라질리언→케어→바디→페이셜→패키지→에너지테라피→나머지
- supportOrder 배열 방어코드 추가
- 메시지 textarea 자동 높이 조정 (useEffect + 고정 height 제거)
- db.js DBMAP: timeline_settings 매핑 추가

---

## 작업: 타임라인 이동 ↔ 근무표 양방향 연동
**상태**: 완료 (2026-04-13).

### 구현
- TimelinePage: `syncOverrideToSch()` — 4곳(doAdd, saveSeg, removeSeg, 이동 버튼)에서 호출
- SchedulePage: `syncSchToOverride()` — setS() 콜백에서 호출
- branchId ↔ 근무표 키 양방향 매핑

---

## 작업: 근무표 엑셀 파싱 개선
**상태**: 미착수.

### 문제
- 소속 지점이 아닌 라인에 나오는 직원을 자동으로 해당 지점 지원 처리 안 됨
- 워크샵 등 특수 케이스 (출+무급반차) 파싱 미지원

### 요구사항
- 직원 소속 지점 기준으로 다른 지점 라인에 나오면 자동 `지원(지점)` 처리
- 괄호 내 특수 표기 (출+휴무반, 전쉐 등) 파싱 규칙 추가

---

## 작업: 고객관리 권한 + 노쇼 카운트
**상태**: 미착수.

### 요구사항
- 브랜드 묶인 지점은 고객정보 공유 (읽기), 수정은 각 지점/어드민만
- 예약횟수, 노쇼, 당일취소 카운트 표시

---

## 작업: 매출관리 상세내역
**상태**: 데이터 준비 완료, UI 미착수.

### 현황
- sale_details 테이블에 ~600,000건 마이그레이션 완료 (Oracle ORDERDETAIL)
- 구조: id, sale_id, order_num, service_no, service_name, unit_price, qty, cash, card, bank, point, sex_div

### 요구사항
- 매출 리스트에서 상세내역 펼치기 (시술별 금액)
- 현금/입금/카드 결제수단별 합계 표시
- oracle_sync.py에 sale_details 증분 동기화 추가

---

## 작업: 패키지 명칭 통일
**상태**: 미착수.

### 문제
- 오라클에서 마이그레이션된 패키지 명칭이 불일치
- 예: "여)왁싱PKG 5회" vs "여)왁싱PKG" vs "왁싱패키지", "재생 PKG 5회" vs "재생트탈패키지" 등
- customer_packages.service_name이 제각각이라 집계/표시 시 혼란

### 요구사항
- 패키지 명칭 표준 정의 (유저 확인 필요)
- customer_packages 기존 데이터 일괄 UPDATE
- 신규 추가 시에도 통일된 명칭 사용

---

## 기존 작업

### Gemini 403 재발 방지
**상태**: 일시적 복구. Google Cloud Console 확인 필요.

---

## 참고: 네이버 지도 API
- Client ID: 20e46c5nm6
- 파라미터: ncpKeyId (ncpClientId 아님 — 변경됨)
- API: Dynamic Map + Geocoding
- Web URL: https://blissme.ai
