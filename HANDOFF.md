# HANDOFF

## 현재 버전
- **v3.3.81** 배포 중

## 이번 세션 요약 (2026-04-19~20) — 포인트/이벤트 시스템 전면 개편

### 🎯 핵심 설계 결정
- **멀티테넌트 원칙** 메모리 저장 — 매장별 커스텀 하드코딩 금지, 설정 기반 범용 엔진만
- `DEFAULT_EVENTS` 하드코딩 전부 제거 → 매장마다 유저가 UI로 직접 이벤트 생성
- 이벤트/쿠폰은 `businesses.settings` 기반 범용 엔진으로 통합

### 🧩 신규 이벤트 엔진 (`src/lib/eventEngine.js`)
범용 모듈, SaleForm에서 호출.
- **트리거 3종**: `new_first_sale` / `prepaid_recharge` / `pkg_repurchase`
- **보상 6종**: `point_earn` / `discount_pct` / `discount_flat` / `coupon_issue` / `prepaid_bonus` / `free_service`
- **기준(base) 5종**: `svc` / `svc_prod` / `prepaid_amount` / `category`(복수) / `services`(복수)
- **마스터 스위치** `businesses.settings.events_master_enabled` (현재 전 매장 **false** 저장)
- **2중 잠금**: 마스터 ON + 개별 이벤트 ON + 조건 충족 모두 만족해야 반영

### 🎨 AdminEvents UI (관리설정 → 이벤트 관리)
- "쿠폰 관리" → **"이벤트 관리"** 리네임. 탭 2개(💥 이벤트 등록 / 🎫 쿠폰 등록)
- 스위치 스타일 토글(42×22) 카드 내부 배치
- 카드 배지: 🟢 반영중 / ⚪ 미구현 / 🟠 커스텀
- `+ 새 이벤트`: 이름/트리거/보상 + 타입별 필드 + CatPicker/SvcPicker
- **빈 상태** 안내: "+ 새 이벤트로 이 매장에 맞는 이벤트를 만들어 주세요"

### 💰 포인트 시스템 업그레이드
- DB: `point_transactions.expires_at/source/expired_tx_id` 컬럼 추가
- pg_cron `record_expired_points()` 매일 00:05 KST — 만료된 earn을 `type='expire'` row로 히스토리 기록
- 잔액 계산: 만료 earn 제외
- 고객관리 PointPanel: 적립 시 유효기간 선택(없음/1/3/6/12개월), 히스토리에 "만료 MM-DD" 배지
- SaleForm 포인트 사용 UI 2줄 레이아웃, 전액 버튼, 콤마 포맷

### 🎫 쿠폰 소급 전환 (임시 마이그레이션 — 관리설정 → 데이터 관리 → 포인트 설정)
- 매출메모 소급 + 유효 쿠폰 보유자 2개 탭
- materialized view `point_migration_candidates` + 함수 `refresh_point_migration_candidates()`
- view `point_coupon_holders` (유효 쿠폰 대상자)
- **누적 전환 결과**: 280명 / 2,842,452P (메모 1차 199 + 2차 39 + 유효쿠폰 42)
  - 시술만 × 10% 기준 (제품 제외)
  - 첫방문 패키지 구매자 1명(김용현) 제외
- 기존 1,308장 `10%추가적립쿠폰` 중 유효는 전부 전환·삭제, 만료 1,092장만 기록용 보관

### 📝 수정요청 처리 완료 (모두 done + reply 등록)
- `id_mj1wxf0q69` **서현** — 예약금완료 태그 저장 버그 (ReservationModal.jsx:1400 자동 제거 로직 삭제, 정유진 id_muezogjytr DB 수동 태그 추가)
- `id_ubcyc5lojp` **민아** — 고객 70079 Elaine 검색 불가 (예약엔 cust_id 있고 customers엔 없던 "유령 고객" 복구 + 서버 스크래퍼에 신규 고객 자동 생성 로직 추가)
- `id_tgvgfsjvoz` **수연** — 매출 등록이 예약시간 늘리는 버그 (SaleForm.jsx 조정 방향 축소만 허용)
- `id_c8cj6n04hl` **정우** 10% 쿠폰 → 포인트 시스템화 (전체 280명 전환 완료)
- `id_xe85iyyvcj/puhjs8t4lv/821i3dfsdq` — DB 상태 done 처리

### 🔧 서버 스크래퍼 수정 (`/home/ubuntu/naver-sync/bliss_naver.py`)
- 신규 고객 자동 생성 로직 추가 (`bak_cust_autocreate` 백업)
- 전화번호로 기존 고객 조회 실패 시 → customers에 INSERT (cust_num=""), 예약의 cust_id에 연결
- **원칙**: 네이버 예약 들어오면 고객 레코드 항상 생성, **cust_num은 매출 발생 시 앱에서 부여** (원칙 준수)

### 🎨 UX 개선 다수
- **빈 지원 칼럼 제거** (TimelinePage getWorkingStaff 로직 수정, v3.3.51)
- **타임라인 막대바 직원 근무시간 반영** (v3.3.51, empWorkHours 다층 키 lookup)
- **근무표 미등록 직원은 타임라인 제외** (v3.3.51)
- **모바일 롱프레스 잡힘 피드백**: 즉시 floating preview + pop-in 애니 + 진동 패턴 (v3.3.52~53)
- **지원 구간 partial 축소**: 수연 왕십리(11:00~18:30) + 강남(18:30~)처럼 원래 지점에 남은 근무 있으면 활성 (v3.3.54)
- **팀채팅 서버 저장**: `team_chat_messages` 테이블 + Realtime + 확성기(📣) 공지 배너 (v3.3.55~57)
- **예약모달 데스크탑 X 버튼** 추가 (v3.3.64)
- **고객관리 다토큰 검색**: `이정 8008` 처럼 부분+부분 AND 서버 필터 (v3.3.74)
- **매출합계 외부선결제 포함** (제품 없는 매출에 한해, v3.3.66)
- **쿠폰/포인트 카테고리 SVC_LIST 제외** (v3.3.68~69)
- **포인트 사용 UI 2줄 + 전액 버튼 + 콤마 포맷** (v3.3.69~71)
- **외부 플랫폼에 "입금" 추가** — biz_khvurgshb.settings.external_platforms=[서울뷰티,크리에이트립,입금]
- **콤마 포맷 통일**: SaleForm 외부선결제·포인트적립·ReservationModal 예약금 (v3.3.72)

## 다음 세션 — 이어받을 내용

### 🔥 즉시 확인 필요
- **이벤트 엔진 마스터 스위치 현재 OFF**. 유저가 직접 ON하고 이벤트 생성해서 테스트할 예정
- 관리설정 → 이벤트 관리 → 💥 이벤트 등록 → `+ 새 이벤트`로 매장 룰 생성
- 등록된 이벤트 0건 상태 (DB 확인 완료, 전 매장)

### 📋 남은 수정요청 점검
- 새 세션 시작 시 `schedule_data.bliss_requests_v1`에서 pending 조회

### ⚠️ 주의사항
- **하드코딩 절대 금지** — 매장별 특수 로직은 설정으로 해결 (멀티테넌트 원칙, memory 기록됨)
- 이벤트 엔진 `free_service` 타입: 쿠폰 등록 탭에서 대상 시술 지정한 쿠폰으로 `coupon_issue` 이벤트 구성 권장 (실제 "무료" 처리는 쿠폰 엔진이 담당)
- `prepaid_bonus` rewardType: 현재 엔진이 `bonus 금액만 계산`. 다담권 실제 잔액에 bonus 가산하려면 SaleForm의 다담권 insert 로직 수정 필요 (다음 단계)
- 네이버 스크래퍼 수정 후 신규 고객 자동 생성 확인 필요 (실제 새 예약 들어올 때 customers 테이블에 row 생성되는지)

### 📊 수치 참고
| 항목 | 값 |
|---|---:|
| 전환된 포인트 | 2,842,452P (280명) |
| 남은 유효 10%쿠폰 | 0장 |
| 만료 10%쿠폰 (기록 보관) | 1,092장 |
| 삭제된 쿠폰 | 172장 |
| customers 유령 고객 복구 | 3명 (Elaine, 홍유진, Amy Lin) |

## 참고 — 서비스·엔진 매핑
- `businesses.settings.events` (array) — 이 매장의 이벤트 정의
- `businesses.settings.events_master_enabled` (bool) — 엔진 전체 ON/OFF
- `businesses.settings.point_events.newcust_10pct` — 레거시 호환 (엔진이 events[] 쪽으로 자동 흡수)
- `businesses.settings.external_platforms` — 외부 선결제 플랫폼 목록
