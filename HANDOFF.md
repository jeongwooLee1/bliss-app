# HANDOFF

## 현재 버전
- **v3.6.11** 배포 중 (라이브 확인: https://blissme.ai/version.txt)
- 전 세션에서 v3.3.105 → v3.6.11 까지 진행

## 이번 세션 마지막 작업 (2026-04-21) — v3.6.10 / v3.6.11

### 🎁 체험단 (무료 제공) 기능 (v3.6.10 → v3.6.11)
- **DB**: `sales` 테이블에 `svc_comped`, `prod_comped` integer 컬럼 추가 (마이그레이션 완료)
- **db.js**: DBMAP/DB_COLS에 `svc_comped:"svcComped"`, `prod_comped:"prodComped"` 매핑
- **SaleForm**:
  - `hasCompedTag` — 예약태그에 "체험" 포함(`/체험/` regex) 시 활성화
  - SaleSvcRow / SaleProdRow에 `comped`, `toggleComped` props 추가 → 🎁 버튼 (체크된 행에만)
  - `svcCompedTotal` / `prodCompedTotal` 집계 → `svcPayTotal` / `prodPayTotal` / `grandTotal`에서 차감
  - 금액 브레이크다운에 `🎁 체험단 제공 -XXX원` 행
  - 결제 그리드 상단에 주황 배너 `🎁 체험단 제공 (무료)` (svcCompedTotal/prodCompedTotal>0일 때)
  - **시술 헤더 위 주황 안내 배너** (hasCompedTag=true일 때 항상 노출) — v3.6.11 추가
  - `sale_details.service_name`에 `[체험단] ` 프리픽스로 기록 → editMode 재진입 시 토글 상태 복원
  - 신규 save + editMode 업데이트 양쪽에 svc_comped/prod_comped 값 포함
  - 금액변동 경고창의 labelMap에 `svcComped/prodComped` 추가
- **SalesPage**: 매출 확장 행 PaySummary에 `🎁 체험단` 배지 (svcComped+prodComped > 0 일 때)

### 📌 미확인
- **v3.6.11에서 유저가 "체험 토글 안나와" 테스트 대기 중** — 시술 체크 후 🎁 버튼이 실제로 보이는지, 안내 배너가 뜨는지 확인 필요
- 배너 보이면 → 감지 성공, 시술 체크만 하면 🎁 노출됨
- 배너도 안 보이면 → `reservation.selectedTags` 또는 `data.serviceTags` 매칭 실패 → 데이터 구조 추가 확인 필요

## 다음 세션 진입 시
1. `/pull` 로 main 최신 상태 확인 (이 세션에서 commit+push 했음)
2. 유저에게 v3.6.11 체험단 배너 표시 여부 확인
3. 필요 시 추가 디버그 (`console.log('[comped]', reservation?.selectedTags, data?.serviceTags)` 추가해 배포)

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

## 주의사항 (CLAUDE.md와 중복 금지 — 현재 진행과 관련된 것만)
- **배포는 모아서 한 번에** — 유저가 "배포" 신호 주면 BLISS_V + version.txt 둘 다 bump + 빌드 + 서버 + CF 퍼지
- **배포 묻지 않고 바로** — 메모리 feedback_bliss_deploy_auto 준수
- 이번 체험단 작업은 SaleForm 3건(초기화/편집 프리필/UI) + SalesPage PaySummary 1건만 영향
