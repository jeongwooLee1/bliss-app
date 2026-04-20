# HANDOFF

## 현재 버전
- **v3.3.105** 배포 중

## 이번 세션 요약 (2026-04-20) — v3.3.81 → v3.3.105 대규모 개선 + 긴급 대응

### 🎫 쿠폰/포인트/보유권 UX 개선
- **다담권 구매 + 오늘 차감 UI 통일** (v3.3.89~90)
  - 체크박스 수동 조작 제거 → **자동 차감**
  - 결제수단 그리드에 "다담권(신규)" 타일 추가 (선불잔액·카드·현금·입금과 나란히). 즉시차감액 자동 표시
  - 유저 설계 의도 반영: 1단계 패키지 구매 결제, 2단계 패키지를 결제수단에 포함한 계산
- **PKG 오늘 사용 UI 토글로 통일** (v3.3.88)
  - +/- 스테퍼 → 시술 행과 동일한 클릭 토글 (0 ↔ 1회)
  - 디폴트 체크 제거. 유저가 명시적으로 클릭해야 사용
  - `📦 오늘 구매한 패키지 — 1회 사용` 라벨
- **PKG 오늘 사용 박스 위치 이동** (v3.3.85~86) — 결제 영역 → 시술 영역 최상단. 다담권은 결제수단이라 결제영역 유지
- **보유 패키지 디폴트 체크 제거** (v3.3.87) — 첫 다회권 자동 선택 로직 삭제. 편집 UI도 시술 행과 동일 토글
- **회원가 자격 조건 설정 UI** (v3.3.94) — 관리설정 → 시술상품관리 상단 보라색 카드. `businesses.settings.member_price_rules`에 저장 (멀티테넌트 원칙 준수). 하드코딩 제거

### 📋 보유권 편집 UI 전면 개선 (v3.3.84)
- 다담권 잔액 `-214,999` 같은 음수 버그 수정 (`Math.max(0, total-used)`)
- 패키지 종류 변경 드롭다운 제거 (타입 swap 금지)
- `p.total_count` 대신 `charged`(실제 충전액) 프리필
- 편집 중 일반 액션 버튼 숨김 → 취소·저장만
- 연간회원권 편집: 카운트 입력 대신 "유효기간 내 회원가 자동 적용" 안내만 (v3.3.93)

### 📅 타임라인
- **🌐 전지점 공통 설정 DB 동기화 버그 수정** (v3.3.83, 102) — `_sk`(sharedKeys)가 localStorage에만 있어 타 PC에 반영 안 되던 문제. DB `tl_shared_settings_v1.value._sk`로 동기화. 권한도 대표/어드민만 변경 가능하게 제한
- **타임라인 블록 메모 hover 팝업** (v3.3.101~102) — 긴 메모(30자 이상) hover 시 노란 팝업으로 전체 내용 표시. JSON 원본 노출 버그 수정
- **타임라인 블록 클릭 개선** (v3.3.94) — 커서 `move` → `pointer`, 드래그 임계값 6→12px (예약 수정하려 클릭했을 때 실수로 드래그되던 문제 해결)
- **예약 수동 등록시간 표시** (v3.3.105) — 수동 예약 모달 상단에 `📅 수동 등록 · 2026-04-20 14:35` 회색 배너

### 💰 매출 관리/통계
- **매출통계 기간 필터를 매출관리와 통일** (v3.3.103) — 기존 7/14/30일 드롭다운 제거, SmartDatePicker로 교체. 매출관리와 `startDate/endDate/periodKey` 상태 공유
- **SmartDatePicker 뷰포트 오버플로 버그** (v3.3.104) — 캘린더가 화면 밖으로 나가던 문제. 자동 오른쪽 정렬 (`window.innerWidth - calW - 12`)
- **방문횟수 +1 정확도 개선** (v3.3.105) — localCust 캐시 대신 **서버 최신 visits 재조회 후 +1**. Oracle 임포트 값도 정확히 증가

### 🛒 매출등록 UX
- **"0" 렌더링 버그** (v3.3.85) — 회원가 없는 시술에 React falsy-zero로 `"0"`이 찍히던 문제 (`"산모관리0"`, `"궁테라피0"`). `isMember = regularPrice > 0 && ...`로 명시적 bool

### 🔍 예약 시스템
- **예약 누락 해결** (v3.3.93) — PostgREST `max-rows=1000` 서버 캡으로 2300+건 중 1000건만 로드되던 버그. `sb.getAll()` 헬퍼 추가 (Range 페이지네이션). 4/16 명수현 예약 등이 타임라인에 안 보이던 문제 해결

### 🛠 고객 관리
- **예약모달 고객검색에 회원번호 표시** (v3.3.91) — 드롭다운에 monospace 회색 배지로 `custNum` 렌더링. 수정요청 id_4cxfyg8skz 대응
- **고객 유효기간 설정 버튼** (v3.3.82) — 보유권 카드 유효기간 섹션을 항상 노출. 없으면 "미설정 + 설정 버튼", 있으면 "유효 ~날짜 + 연장 버튼"
- **다담권 첫 차감 시 자동 유효기간 1년** (v3.3.82) — 사용 전엔 유효기간 비움 (미사용 원칙), 구매+즉시차감 동시면 구매일+1년

### ⚠️ 긴급 장애 대응
- **Supabase Compute 업그레이드 Nano → Small** (memory project_supabase_compute.md) — 단순 쿼리가 15~30초 걸리던 심각한 성능 문제. Small 전환 후 200~300ms 정상화
- **긴급 크래시 핫픽스** (v3.3.92) — SaleForm `selSvcs.filter(id => id.startsWith("pkg__"))` 에서 비문자열 id 접근 시 `TypeError: ve.startsWith is not a function` → `typeof id === "string"` 가드 추가
- **송다희 매출 복구** — Supabase 느린 시간대에 customers insert가 `.catch(console.error)`로 조용히 실패하고 sales insert는 성공 → orphan. 수동 복구 + SaleForm.jsx:1200 `await 추가 TODO`

### 💼 bliss-consent 프로젝트 분리 (신규)
매장 태블릿 동의서 사인앱 — 직원 `housewaxingmarketing-spec` 담당. **블리스 외부 프로젝트**이지만 DB/Storage 공유:
- 위치: `C:\Users\TP005\bliss-consent\` + GitHub `jeongwooLee1/bliss-consent` (private)
- Supabase 테이블 3개 생성: `consent_templates`, `consent_tokens`, `customer_consents`
- Storage 버킷 `consents` + RLS 정책
- CLAUDE.md + HANDOFF.md + Skills 3개 준비 완료
- 자세한 건 memory `reference_bliss_consent.md`

### 💾 NAS 백업 세팅 (신규)
- `Z:\bliss\` 백업 폴더 + `sync.sh` 동기화 스크립트
- 대상: 문서(CLAUDE.md/HANDOFF.md/memory), 서버 스크립트(naver-sync), 루트 유틸(bliss_*.py, oracle_sync.py)
- 실행: `bash Z:/bliss/sync.sh`
- 자세한 건 memory `reference_nas_backup.md`

## 다음 세션 — 이어받을 내용

### 🔥 즉시 확인 필요
- **bliss-consent 직원 작업 진행 상황** — 직원이 clone하고 세팅 완료했는지. 막히면 도와줌
- **블리스 메인앱 ↔ bliss-consent 연동** (직원 작업 마무리 후)
  - 고객 편집 모달에 "📝 동의서 작성" 버튼 → consent_tokens 발급 + QR 모달
  - 고객 상세 패널에 "서명 이력" 탭 (customer_consents 조회)

### 📋 남은 수정요청 점검
- 새 세션 시작 시 `schedule_data.bliss_requests_v1`에서 pending 조회
- pending 1건: `id_afntr6jcle` 수연 "직원 라인 순서가 계속 바뀌면서 예약 등록해놓은게 사라진다" — 재현 조건 더 확인 필요 (보류 중)

### ⚠️ 주의사항
- **Supabase 장애 재발 주의** — Compute burst credit 소진 / statement_timeout / max_connections 근접 체크 (memory project_supabase_compute.md)
- **SaleForm customers insert 비동기 이슈** — line ~1200 `sb.insert("customers", ...).then().catch(console.error)` 가 fire-and-forget. 타임아웃 시 orphan 재발 가능. `await` + 실패 시 sales 중단으로 보강 필요 (송다희 복구 이후 TODO)
- **멀티테넌트 원칙 유지** — 매장 특화 하드코딩 금지. 회원가 규칙처럼 `businesses.settings`로 빼기

### 📊 수치 참고
| 항목 | 값 |
|---|---:|
| 예약 총건 | 2327 |
| 매출 90일 | 3169 |
| 고객 | ~7000+ |
| Supabase Compute | Small (2GB, 2-core ARM) |
