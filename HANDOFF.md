# HANDOFF

## 현재 버전
- **v3.6.24** 배포 중 (라이브: https://blissme.ai/version.txt)

## 이번 세션 누적 완료
- 매출취소(id_jre7s0tma6) / AI 설정 재설계(id_triao6fesy)
- 구매지점 Phase 1-2 + 조사 페이지 + 단일지점·패키지 사용지점 RPC (361→27건 판정)
- AI Book 이메일/외부선결제 추출
- Supabase legacy JWT → 서버 TG 봇 복구
- 지점원장 로그인 지점 표시 + 패키지 추가 시 로그인지점 우선
- **지점 묶음(branch_groups) 테이블 + 관리 UI + canUsePkgAtBranch 그룹 기반 전환**
- **customer_packages.allowed_branch_ids 컬럼 + 고객관리 카드 "추가 허용 지점" UI**

## 대기 중 pending (Phase 2-3 지점묶음 확장)
### Phase 2 — 메시지함 지점 필터
- 현재 전지점 공통 표시 → 유저 userBranches + 묶음 그룹 기준으로 필터링
- MessagesPage.jsx 한 파일 수정

### Phase 3 — 브랜드 멤버 권한 세분화
- `users.permissions` jsonb 컬럼 추가
- 기능별 허용 지점: `{timeline, reservations, customers, sales, messages}`
- 브랜드 멤버 관리 UI에 권한 매트릭스 편집

## 다음 세션 진입 시
1. `/pull` 로 main 최신 확인
2. 유저 지시 대기

## 대기 중 작업 (라이브 전 or 유저 승인 필요)

### (보류) 세션 복구 Phase 2-4
- 로컬 `watchdog.py` (5분 간격 세션 상태 폴링)
- `login_local.py` 캡차 자동화 (텔레그램 답변 수신 → 브라우저 입력)
- Windows Task Scheduler 자동 시작
- 현재: Phase 1 (서버측 알림만) 완료. 세션 만료 시 수동 `login_local.py` 실행 필요

### (보류) Naver 자동예약 기본 상태 수정 (id_7um1c7bp3o)
- 네이버에서 자동 확정된 예약이 '대기' 상태로 저장되는 케이스 조사

### (보류) 구매지점 제한 재활성화 (id_ebgbebctt3 + id_imgr471swt-4)
- `customer_packages.note` `매장:XX` 데이터 전수조사 → 정리 후 `canUsePkgAtBranch()` 활성화

### (보류) 당일 취소 결제수단/보유권 차감 정책 (id_imgr471swt-6)

### (보류) 직원 지점 이동 시 예약 자동 이동 (id_825fnuel64)

### (보류) AI 설정 UI 개선 (id_triao6fesy)

## 주의사항 (CLAUDE.md와 중복 금지)
- **배포는 모아서 한 번에** — 유저가 "배포" 신호 주면 BLISS_V + version.txt 둘 다 bump + 빌드 + 서버 + CF 퍼지
- **배포 묻지 않고 바로** — 메모리 feedback_bliss_deploy_auto 준수
