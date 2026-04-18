# HANDOFF

현재 진행 중인 작업의 인수인계 상태.

## 작성 규칙
- 자격증명·환경정보·아키텍처는 여기 넣지 않는다 (→ CLAUDE.md)
- "무엇을 / 왜 / 다음 행동"만 기록한다

---

## 현재 버전: **v3.1.9**

## 진행 중 작업: 없음

2026-04-17 세션 3 종료 — 매출 편집 대형 리팩토링 + 고객번호 누락 버그 수정 + 중복 방지 로직 완료. 상세 내역은 CLAUDE.md "매출 편집/상세 대형 리팩토링" 섹션 참고.

---

## 새 세션 시작 시 할 일
- `bliss_requests_v1` 새 요청 확인 → 분석/제안 → 사장님과 함께 처리
- Chrome MCP 연결 상태 확인 (유저가 Claude 확장 로그인 후에도 이전 세션에서 연결 안 됨) → 연결되면 배포 검증 자동화에 활용

---

## 대기 중 작업

### 1. 오라클 전체 백업 → Supabase 이동
- 오라클 모든 테이블을 Supabase `oracle_*` 테이블로 마이그레이션 (읽기 전용 백업)

### 2. 시술후 케어 알림톡 (5/10/21/35/53일)
- UG_8978~8982 5개 카카오 "검수중" 상태 (2026-04-11 재신청, 정보성 문구)
- 다음 행동: 승인 확인 → DB noti_config msgTpl 업데이트 → 알림톡 ON

### 3. schedule_data 비즈니스 격리 (critical)
- `schedule_data` 테이블 쿼리가 `business_id` 필터 없이 key만으로 조회되어 모든 사업장 데이터 공유 중
- 영향 파일: `useData.js`, `SchedulePage.jsx`, `TimelinePage.jsx`, `SetupWizard.jsx`
- 모든 read/write에 `.eq('business_id', bizId)` 추가 + id를 `${bizId}_${key}` 형식으로 변경 + 기존 행 UPDATE로 backfill

### 4. 근무표 엑셀 파싱 개선
- 소속 지점이 아닌 라인에 나오는 직원을 자동 `지원(지점)` 처리 안 됨
- 워크샵 등 특수 케이스 (출+무급반차) 파싱 미지원

### 5. 고객관리 권한 + 노쇼 카운트
- 브랜드 묶인 지점은 고객정보 공유 (읽기), 수정은 각 지점/어드민만
- 예약횟수, 노쇼, 당일취소 카운트 표시 (reservations 테이블 집계는 이미 상세 패널에 구현됨 — 리스트에도 표시 필요)

### 6. 패키지 명칭 통일
- customer_packages.service_name이 제각각 (예: "여)왁싱PKG 5회" vs "왁싱패키지")
- 표준 명칭 정의 + 일괄 UPDATE 필요

### 7. 매출관리 상세내역 UI 개선 여지
- v3.1.0~v3.1.9에 sale_details 편집·삭제·프리필 전부 구현됨
- 추가 개선 필요하면 유저 요청 시 진행

---

## 환경/인프라 메모

- 서버 `bliss-naver.service`: 5분마다 네이버 스크래핑. `pending_rescrape_thread` v2.7.4 이후 안정
- Cloudflare 퍼지: `.env`의 `CF_ZONE`/`CF_TOKEN` 사용 (curl)
- oracle_sync.py: Windows Task Scheduler 매일 새벽 3시 (JOINDATE·NAME2 동기화 포함)
- tg_daemon.py: 로컬 PC 상시 실행, 네이버 세션 자동 갱신
