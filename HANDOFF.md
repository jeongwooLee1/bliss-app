# HANDOFF

## 현재 버전
- **라이브: v3.7.550** (https://blissme.ai/version.txt) — 2026-05-09 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md "v3.7.503 → v3.7.550"](./CLAUDE.md) 섹션 참고

## v3.7.550 변경 (2026-05-09)
- **자동태그 설정 가시성 향상** (AdminServiceTags):
  - 메인 태그 리스트의 각 행에 `⚡ 자동` 노란 배지 + 자연어 한 줄 설명 추가 (`describeTrigger`로 변환. 예: "마지막 방문이 90일 이상 지난 손님에게 ★기존상담가 자동으로 붙어요")
  - 자동태그 설정 ASheet의 태그 드롭다운 옵션에 `⚡` prefix + `(자동)` suffix — 어떤 태그가 트리거 설정됐는지 한눈에 식별

## v3.7.549 변경 (2026-05-09)
- **features 적재 race condition fix** (`features.js` + `useFeaturesVersion.js` 신규):
  - 증상: 직원근무표(SchedulePage)에서 `hasFeature('schedule_advanced')` 게이트에 묶인 자동배치·규칙 설정·배치확정·백업 메뉴 등이 안 보임. DB는 `schedule_advanced=true` 정상.
  - 원인: `_features`가 module-level 변수라 `setFeatures(...)` 호출이 SchedulePage 리렌더를 자동 트리거 안 함. 첫 렌더가 적재 전에 일어나면 false 그대로 남음.
  - fix: `subscribeFeatures(fn)` listener 패턴 추가 + `useFeaturesVersion` hook을 별도 파일(vite Fast Refresh 충돌 회피)로 분리. SchedulePage 함수 본문에 `useFeaturesVersion()` 한 줄 호출 → setFeatures 시 자동 리렌더 → hasFeature 정확히 평가.

## v3.7.548 변경 (2026-05-09)
- **네이버 확정 친절 처리** (ReservationModal onConfirm):
  - `409 ALREADY_CONFIRMED` 받으면 → 자동으로 `status='reserved'`로 DB sync + "이미 네이버에서 확정된 예약이라 블리스 상태만 동기화했어요" 안내. 알림바·[대기] 배지에서 즉시 빠짐.
  - `409 RT65 ITEM_NOT_SALE` 받으면 → raw JSON 노출 대신 "이 시간/시술이 네이버 예약관리에서 판매 중지(막기) 상태라 확정할 수 없어요" 친절 안내.
- **자동태그 설정 라벨 친화 + 미리보기** (`tagAutoTrigger.js` + AdminServiceTags ASheet):
  - 트리거 카탈로그 라벨 평어체로 ("📦 패키지 잔여 회수 ≤ N" → "📦 보유권 횟수가 거의 다 됐을 때" 등 5종 전체)
  - param 라벨도 친화화 ("회 이하" → "회 이하 남았을 때", "예약 시술과 같은 카테고리/시술만 평가" → "오늘 예약한 시술과 같은 종류만 따지기")
  - `describeTrigger(trigger, ctx)` 헬퍼 추가 — 트리거+params를 자연어 한 문장으로 변환
  - ASheet에 👀 미리보기 박스 — 입력값에 따라 "마지막 방문이 90일 이상 지난 손님에게 ★기존상담가 자동으로 붙어요" 같은 한 줄이 실시간 갱신
- **김기덕 #1231261029 DB 정상화**: `pkxavrdf0y`(네이버, pending) → `reserved` UPDATE + `id_atub9qxu8d`(수동 빈 row, 매출 연결 0건) DELETE. 알림바 확정대기에서 자연 제거.

---

## 새 세션 시작 시 읽을 순서
1. [CLAUDE.md](./CLAUDE.md) — 영속 컨텍스트 (아키텍처·서버·DB·룰·변경 이력)
2. 이 파일 — 현재 진행 중인 작업 + PENDING 항목
3. memory `MEMORY.md` — 유저 선호·피드백·외부 레퍼런스

---

## PENDING 작업 (우선순위 순)

### 1. 📧 Zoho Workplace 메일 — 사이트 교체만 남음
**상태**:
- ✅ Zoho 가입(테라포트, Free Plan), contact@blissme.ai 메일박스 생성
- ✅ Cloudflare DNS 5개 레코드 (MX 3개 + SPF + DKIM)
- ✅ 도메인 검증 통과

**남은 작업**:
1. 사용자: Zoho [모든 레코드 확인] 클릭 + contact@blissme.ai 첫 로그인 + 비번 변경 (1분)
2. 송수신 테스트
3. **Bliss 사이트 일괄 교체**: `cripiss@naver.com` → `contact@blissme.ai`
   - public/about.html / privacy.html / terms.html / refund.html / pricing.html
   - AppShell footer
   - 빌드 + 배포 + CF 퍼지

**자격증명**: memory `reference_zoho_workplace.md`

---

### 2. 💳 NHN KCP 카드사 심사 통과 후 → 포트원 V2 채널 등록
**현재 상태 (2026-05-08)**:
- ✅ NHN KCP 가맹점 + 카드사 심사 통과 (영세 수수료, 신용카드 건당 100만, 정산 월4회, 등록비/연회비 0)
- ✅ 포트원 가입 + 비즈니스 인증 완료 (테라포트 법인 / 632-81-02070 / 권신영)
- ✅ blissme.ai PG 심사용 정적 페이지 깔림 (about/terms/privacy/refund/pricing.html)
- ⏳ 계약서 제출 → 보증보험 200만원 가입 → 포트원 채널 등록 → Bliss 키 입력 → 테스트 결제

**다음 단계** (사용자 작업 + Bliss 키 입력):
1. KCP 계약 구비서류 제출 (파트너관리자 → 상점정보관리)
2. 서울보증보험 마포지점 1599-5209 — 보증보험 200만원 가입
3. 포트원 V2 대시보드 → KCP 채널 활성화 → Store ID + Channel Key + API Secret 복사
4. Bliss 관리설정 → 결제 설정 → 매장 키 입력 (테스트 모드)
5. ReservationModal [💳 예약금 청구] 테스트 결제 → 흐름 검증
6. 라이브 키로 교체

**참고**: KG이니시스 가맹점 검토 회신 대기 중 (병행)

**문서**: memory `reference_nhn_kcp.md`

---

### 3. 🔵 네이버 톡톡 상담완료 자동 연동 — 정식 챗봇 통합으로 전환 (1~2주 일정)
**현재 상태**: 비공식 우회 보류
- ✅ POST `/chatapi/ct/partner/{handle}/chat/{chatId}/end` (200 OK 확인) + 매장 핸들 8개 확보
  - 강남 w4jmdh, 마곡 w4lf15, 왕십리 w4h6dw, 용산 w4gsgn, 위례 w4l272, 잠실 w4ls78, 천호 w45f9j, 홍대 w5wyqh
- ❌ chat_id(4자) ↔ messages.user_id(22자) 매핑이 nchat socket 통신으로만 전달되어 HTTP 추출 불가

**전환 방향**: 정식 챗봇(handover_v1) 통합
- 네이버 톡톡 챗봇 API 정식 등록
- 메시지 수신/발송/상담완료 모두 공식 API
- 작업 양: 1~2주

---

### 4. 🟡 네이버 "전체 막기/풀기" 1건 누락 (2026-05-09)
- 증상: 슬롯 막기 팝업의 [전체 막기]·[전체 풀기] 누르면 3건 중 1건이 빠짐
- 후보 원인 (TimelinePage.jsx:5550 `toggleAll`):
  1. `is_active === false` (네이버 노출 X) skip
  2. `bit !== '0' && '1'` (운영 외 시간) skip
  3. `toggleOne` fetch 실패 → 옵티미스틱 롤백 + alert (가장 흔한 케이스 — 그 시간/시술에 이미 네이버 예약이 들어있어 막기 거부)
- 사용자 추가 정보 필요: 못 막힌 항목 이름 + alert 떴는지 + 그 슬롯에 이미 예약 있는지

### 5. 🟡 네이버 확정 시 dateTimes 03:30 (15:30 예약인데) — 시간 매핑 의심
- 증상: 김기덕 #1231261029 (15:30) 확정 시 네이버 응답 `dateTimes:["2026-05-09T03:30:00+09:00"]` (12시간 차이)
- 03:30은 **네이버 API 응답값**이지 클라이언트가 만든 게 아님 ([bliss_naver_tmp.py:1131](../naver-sync/bliss_naver.py:1131))
- 가능성: 서버 hour_bit slot_idx 계산 → 네이버에 보낼 때 12h 변환 발생, 또는 네이버 측 타임존 인식 버그
- 우선순위 낮음 — v3.7.548 친절 메시지로 운영 영향은 제거. root cause는 다음 세션에서 디버깅

---

### 6. 다음 세션에서 검토할 만한 기능 추가
- **PortOne webhook 처리** (현재는 success redirect로만 동작)
- **SaaS 정기결제** (매달 Bliss → 매장) — 기존 `billing_payments`/`billing_payment_methods` 활용
- **결제 청구 UI 개선** — prompt → 모달, 메시지 템플릿 사용자 정의
- **결제수단 선택 UI** — 현재 'CARD' 고정, 계좌이체/간편결제 옵션 추가
- **결제 내역 페이지** — 매장이 자기 매장 결제 이력 조회
- **체험단 콜라보 — 마케팅팀 텔레그램 알림** (콜라보 키워드 메시지 도착 시 즉시 알림)
- **이모티콘 → I 아이콘 Phase B** (BlissAI / Admin / SalesPage / CustomersPage 등 잔여 곳)

---

## 최근 사용자 요청 처리 상태 (bliss_requests_v1)

전체 done 상태. 마지막 처리 (id_b72koaxcft 현아 — 네이버 톡톡 자동완료)는 정식 챗봇 통합 예정으로 안내.

---

## 환경 정보 빠른 참조 (자세히는 CLAUDE.md)

- **서버**: bliss-server (Oracle Cloud, 158.179.174.30) — `/home/ubuntu/naver-sync/`
- **DB**: Supabase `dpftlrsuqxqqeouwbfjd` (biz_id: `biz_khvurgshb`)
- **CF**: blissme.ai (Cloudflare Proxy)
- **로컬 dev**: `npx vite --force` → http://localhost:5173
- **배포**: `rm -rf dist && npx vite build && scp dist/* bliss-server:/tmp/bliss-app/ && ssh bliss-server "sudo cp -r /tmp/bliss-app/* /var/www/html/bliss-app/"` + CF 퍼지

## 배포 룰 (memory)
- BLISS_V + version.txt **둘 다** 같은 값으로 bump (불일치 시 무한 reload 루프)
- 수동 배포 시도 마지막에 CF 캐시 퍼지 자동 실행
- 수정 누적 → "배포" 신호 시 한 번에 빌드·서버·퍼지·버전업
