# HANDOFF

## 현재 버전
- **v3.5.37** 배포 중 (라이브 확인: https://blissme.ai/version.txt)
- 커밋: `38cb25a feat: v3.4.0~v3.5.37 — 이벤트 엔진 v2, 쉐어, 공지, 마킹, 복구 시스템`

## 이번 세션 요약 (2026-04-21) — v3.3.105 → v3.5.37

### 🎯 이벤트 엔진 v2 (v3.4.x)
- 트리거 5종: `new_first_sale` / `prepaid_purchase` / `pkg_purchase` / `annual_purchase` / `any_sale`
- 조건 빌더: 시술 any/all/none · 카테고리 · 금액 범위 · 고객 상태 플래그
- 보상 최대 3개: `point_earn` / `discount_pct` / `discount_flat` / `coupon_issue` / `prepaid_bonus` / `free_service`
- 2-pass 평가 (할인 → 포인트, net_pay 반영)
- 할인 풀별 cap: svc/pkg/prepaid/annual 각각 독립
- 레거시 호환: `rewardType` 단일 보상 + `prepaid_recharge`/`pkg_repurchase` 트리거 자동 변환
- UI: 매출등록 우측에 **"🎉 적용된 이벤트"** 보라 박스 표시 (이벤트명 + 보상 요약)

### 🤝 쉐어 기능
- **고객관리 쉐어 탭** (ShareCustModal) — 쉐어 고객 검색/추가, 다토큰 검색 (이름+번호)
- **보유권별 `🤝 쉐어 공유` 토글** — `customer_packages.note`에 `| 쉐어:Y` 플래그. 기본 OFF
- **매출등록 시 본인 vs 쉐어 분리 표시** (v3.5.37) — 동명 패키지라도 소유자별로 별도 행 (성별 가격차 구분). 본인 🔵 / 쉐어 🟣 배지
- **쉐어 남녀 보정금** — 여자 소유 다회권을 남자 사용 시 회당 **+33,000원** 자동 가산. 시술합계 반영 + sale_details 기록

### 📢 공지 & 요청 (기존 "수정 요청" 페이지 재편)
- 사이드바 `수정 요청` → `📢 공지 & 요청`
- **공지사항 탭** (마스터만 쓰기) — 제목·버전·내용·이미지 다중 첨부 (Ctrl+V 지원)
- **등록 후에도 이미지 편집/삭제 가능** — 각 이미지 우상단에 `✏️ 편집` / `🗑 삭제`
- 과거 `imageData`(단일) → `images`(배열) 자동 마이그레이션 호환

### ✏️ MarkupEditor (이미지 마킹 툴)
- `src/components/common/MarkupEditor.jsx` 신규
- 도구: 펜 / 사각형 / 화살표 / 텍스트
- 색상 6종 + 굵기 4단계 + Undo / Clear / Save
- 원본 해상도 PNG 저장, 터치/마우스 모두 지원
- 공지·수정요청 양쪽에서 사용

### 🎨 UX 개선
- **모든 모달 ESC 키로 닫기** — ReservationModal, DetailedSaleForm, ASheet, QuickBookModal, Reservations Modal, SmartDatePicker
- **AI 자동답변 메시지 시각화** — 🤖 보라 아바타 + "🤖 AI 자동응답" 배지 (MessagesPage 2곳)
- **유효 패키지 최초 구매지점 이니셜** (N/W/H/M/J/R/Y/C) — 고객명 앞 배지. 타임라인·예약모달·고객리스트 3곳
- **고객 당일취소/당일변경 카운트** — 고객관리 상세 통계에 분리 표시 (`updated_at.date === reservation.date` 기준)
- **케어 카테고리 행 클릭 토글** + **+/- 수량 버튼** 분리 (`stopPropagation` 적용)
- **매출 확인 모드 (viewOnly)** — 예약모달에서 기존 매출 확인 시 읽기전용. 수정 시 alert "매출관리에서만 가능"

### 🏢 구매지점 제한 (v3.5.31 → v3.5.32 롤백)
- **시도:** 다담권·다회권·연간권을 구매지점에서만 사용 가능하게
- **롤백 이유:** `매장:XX` 데이터가 불완전 (`매장:마곡/홍대` 같은 복수 값, 잘못 등록된 지점)
- **현재:** 제한 해제, 전 지점 사용 가능. `canUsePkgAtBranch()` 항상 `true` 반환
- **보류:** 전수조사 필요 (id_ebgbebctt3). 규칙은 명확: "구매지점만 사용 / 회원가는 전 지점"

### 🔧 서버 통합
- **세션 복구 시스템 Phase 1 완료** (Phase 2-4 보류)
  - `/home/ubuntu/naver-sync/session_recovery.py` 신규 모듈
  - Supabase `schedule_data` 기반: `session_status_v1`, `captcha_request_v1`, `captcha_answer_v1`
  - 텔레그램 알림 스케줄러: 주간(09:00~23:55) 5분마다 / 야간(00:00~08:59) 1회만
  - Flask 엔드포인트: `GET/POST /session-status`, `POST /captcha-request`, `GET /captcha-answer`, `POST /captcha-clear`
  - 기존 TG bot에 캡차 답변 인터셉트
- **env.conf 포맷 수정** — systemd `Environment=` 프리픽스 추가 → 텔레그램 봇 정상 동작
- **Keepalive 주기 24h → 2h** (bliss_naver.py 세션 유지 스레드)
- **204 응답도 auto_relogin 트리거** (기존 401/403만 → 204 추가)
- **로컬 watchdog.py 생성** (`C:\Users\TP005\naver-sync\watchdog.py`) — 미실행 상태. Phase 2 구현 중단

### 🎯 AI FAQ 250개 등록
- `businesses.settings.ai_faq` 배열
- 카테고리별: 사후관리&트러블 40 / 남성고객 41 / 매장편의 40 / 위생안전 40 / 임산부 40 / 주기효과 40 / 기타 9
- 구조: `[{q, a, active, category}]`
- 관리설정 → AI 설정 → FAQ 탭에서 관리

### 🐛 주요 버그 수정
- **React #300 Rules of Hooks** — `ReservationModal._overlayDownRef`가 early return 뒤에 있어 `showSaleForm` 토글 시 훅 개수 변동. 앞으로 이동 (v3.5.27)
- **SaleForm prepaid 잔액 파싱 fallback** — `잔액:` 없으면 `total_count - used_count` 사용 (구버전 데이터)
- **다회권 `setPkgQty` 본인+쉐어 분리** (v3.5.37) — 동명 패키지가 소유자 섞이는 문제 해결. groupKey = `이름∷self` 또는 `이름∷shared_{ownerId}`

### 📋 수정요청 처리 (8건)
**완료 (3):**
- `id_l2b9zgaeol` (민정) 쉐어 고객 개인권 숨김 → v3.5.33 쉐어 토글
- `id_dh0tp9v5ue` (지은) ESC 팝업 닫기 → v3.5.30
- `id_nfv71exl14` (정우) 쉐어 여→남 +33,000원 → v3.5.30

**부분완료 (1):**
- `id_imgr471swt` (유라) 6건 중 3건 완료 — AI 라벨 / 지점 이니셜 / 당일카운트 ✅ / AI 배너 + 구매지점 제한 + 당일차감 로직 ⏸

**대기 (4):**
- `id_ebgbebctt3` (정우) 구매지점 전수조사 후 재활성화
- `id_7um1c7bp3o` (정우) 네이버 자동예약 상태 디폴트 수정 + AI 취소 시 타임라인 표시
- `id_825fnuel64` (권신영) 직원 지점 전환 시 기존 예약 자동 미배정 이동
- `id_triao6fesy` (정우) AI 설정 UI 개선 (구체화 대기)

## 다음 세션 — 이어받을 내용

### 🔥 우선순위 높음 (백로그)
1. **🤖 블리스 AI 프로젝트** (Phase 1 시작 예정 — worktree `feature/bliss-ai`)
   - 설정 마법사 → "블리스 AI" 페이지로 개편
   - FAQ 250개 기반 챗봇 + DB 데이터 조회 + 자연어 설정 (단계적)
   - Tier 1-2 먼저 (읽기 전용) → Tier 3-4 (고객/매출 조회) → Tier 5-6 (쓰기)
2. **네이버 자동예약 상태 디폴트 수정** — id_7um1c7bp3o
3. **직원 지점 전환 시 예약 미배정 이동** — id_825fnuel64

### 📐 정책 확정 필요
- **당일취소 예약금/패키지 차감** (id_imgr471swt-6)
- **구매지점 제한 재활성화** — 데이터 전수조사 선행 (id_ebgbebctt3)
  - 규칙 확정: "구매지점에서만 사용 / 회원가는 전 지점"
- **AI 설정 UI 구체 요청** (id_triao6fesy)

### ⏸ 보류
- **세션 복구 Phase 2-4** — 로컬 watchdog.py + login_local.py 캡차 자동화 + Task Scheduler 설정. Phase 1 서버는 완료
- **bliss-consent 연동** — 직원 작업 진행 상황 확인

### ⚠️ 주의사항
- **배포 모드: 모아서 한 번에** — 유저 요청 (2026-04-21). 수정만 누적 → "배포" 신호 시 한 번에 빌드·서버·퍼지
- **배포 전 반드시 확인** — "지금 배포할까요?" 물어보기
- **멀티테넌트 원칙 유지** — `businesses.settings`로 빼기
- **Supabase 장애 주의** — Compute Small 상태 (memory project_supabase_compute.md)

### 📊 수치 참고
| 항목 | 값 |
|---|---:|
| 버전 | v3.5.37 |
| 예약 총건 | 2300+ |
| 매출 90일 | 3100+ |
| 고객 | ~7000 |
| AI FAQ | 250개 |
| 수정요청 | 75건 (done 65 / in_progress 1 / pending 4) |
| Supabase Compute | Small (2GB, 2-core ARM) |

### 🗂 워크트리 구조
- `C:/Users/TP005/bliss-app` (main, 38cb25a) — 메인 개발
- `.claude/worktrees/bliss-ai/` — **블리스 AI 신규** (이 세션에서 생성 예정)
- `.claude/worktrees/ai-faq-settings/` — AI FAQ 관련 (사용 중)
- `.claude/worktrees/chat-sidebar/`, `pkg-audit-rewrite/`, `saleform-mobile-fix/`, `timeline-scroll-memory/`, `user-requests-only/`, `visitor-sale-target/` (기타)

### 📝 타 세션 병렬 작업 안내
이 세션에서는 **블리스 AI Phase 1**을 worktree `feature/bliss-ai`에서 진행 중.
타 세션은 main 브랜치에서 급한 작업 가능. 머지 시점에 정리.
