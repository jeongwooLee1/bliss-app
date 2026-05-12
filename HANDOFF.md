# HANDOFF

## 현재 버전
- **라이브: v3.7.710** (https://blissme.ai/version.txt) — 2026-05-13 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md "v3.7.643 → v3.7.710"](./CLAUDE.md) 섹션 참고

## 2026-05-12 ~ 13 작업 (v3.7.642 → v3.7.710)

### v3.7.643~645 (5/12) — 헤더 시계 + 로비 풀스크린
- `public/clock.html` 로비 디스플레이용 시계 (Orbitron, 좌우 반전 토글, 자동 풀스크린)
- TimelinePage 14일 탭 끝에 🕐 버튼 → iframe 풀스크린 오버레이

### v3.7.700 (5/12) — 🔵 토스페이먼츠 풀스택 + SEO + 파비콘
- **결제 시스템 풀세트**: AdminPaymentSettings 토스 직결 탭, ReservationModal 예약금 청구/환불 UI, PaymentApp 토스 V2 SDK 분기
- **Edge Functions 7개** (payment-info v3 + confirm v3 + webhook + cancel + billing-issue + billing-charge + payment-lookup) 라이브 배포
- **DB 테이블 3개 신규**: payment_webhook_log, billings, billing_charges
- **파비콘 하우스왁싱 → Bliss 보라 B** (svg/png/ico 5개 + manifest 일반화)
- **SEO 풀세트**: index.html + 정적 5개 페이지 title/description/keywords/OG/JSON-LD + robots.txt + sitemap.xml
- memory `reference_tosspayments.md` 신규, `reference_nhn_kcp.md` "보류/폐기 검토"로 변경

### v3.7.710 (5/13) — 보유권 유효기간 검토 메뉴
- `AdminLongValidityReview.jsx` 신규 (344줄) — 1년 초과 잔존 보유권 검토·수정·삭제 도구
- 관리설정 → 사업장 관리 → "보유권 유효기간 검토"

### 서버 ai_booking.py 5종 fix (5/13, React 변경 0)
1. `find_existing_booking`에 channel+user_id 1순위 매칭 추가 — 외국인·신규 고객 변경 처리 정확
2. `_enrich_service_name` 신규 — selected_services UUID → 시술명 변환
3. [기존 예약] 블록에 `_ex.bid` 기반 branch 이름 재조회 — WA 공통 채널 보강
4. 외국인 이메일 강제 요구 룰 제거 — WhatsApp/IG/카카오/LINE은 user_id로 식별
5. 변경 요청 가드 — [기존 예약] 없으면 새 예약 임의 생성 금지, "담당자 안내" 분기
- 라이브 검증: 미국 손님 Bebe(`19254081516`) 변경 요청 정확 처리 ✅

### Claude Sonnet → Haiku 전환 (5/13, 비용 70% 절감)
- 실제로는 `CLAUDE_MODEL=claude-sonnet-4-5`가 디폴트였음 (Haiku 메인이라던 메모리와 불일치)
- env.conf + ai_booking.py + bliss_naver.py 모두 `claude-haiku-4-5`로 변경
- 5/13 누적 $26.29 → 다음 달부터 ~$10 예상

---

## 새 세션 시작 시 읽을 순서
1. [CLAUDE.md](./CLAUDE.md) — 영속 컨텍스트 (아키텍처·서버·DB·룰·변경 이력)
2. 이 파일 — 현재 진행 중인 작업 + PENDING 항목
3. memory `MEMORY.md` — 유저 선호·피드백·외부 레퍼런스

---

## PENDING 작업 (우선순위 순)

### 1. 💳 토스페이먼츠 컨펌 받기 → 매장 키 입력 (사용자 작업)
- ✅ 코드·Edge Functions·DB 모두 라이브 깔림 (v3.7.700)
- ⏳ **토스페이먼츠 가맹 컨펌 대기** (송정윤 010-4928-1242, 2026-05-13 컨펌 예정)
- 다음 행동:
  1. 사용자: 토스 개발자센터 → API 키 (테스트 또는 라이브) 발급
  2. Bliss 로그인 → 관리설정 → 결제 설정 → 토스페이먼츠 직결 탭에 client_key + secret_key 입력
  3. 토스 개발자센터 → 웹훅 등록: `https://dpftlrsuqxqqeouwbfjd.supabase.co/functions/v1/payment-webhook` (이벤트: PAYMENT_STATUS_CHANGED, CANCEL_STATUS_CHANGED, DEPOSIT_CALLBACK, BILLING_DELETED 체크)
  4. ReservationModal [💳 결제 링크 발송] 테스트 → 흐름 검증
- 자격증명: memory `reference_tosspayments.md`

### 2. 🔍 Google Search Console + Naver Search Advisor 등록 (사용자 작업)
- ✅ SEO 풀세트 + robots.txt + sitemap.xml 라이브 (v3.7.700)
- ⏳ 사용자 액션:
  1. https://search.google.com/search-console → 속성 추가 (URL 접두어 `https://blissme.ai`) → HTML 태그 검증
  2. 검증 토큰(`<meta name="google-site-verification" content="...">`) 받아서 작업세션에 전달 → 코드에 박고 다음 배포에 반영 (index.html에 `google-site-verification` meta 자리 비워둠)
  3. (선택) https://searchadvisor.naver.com — 네이버 노출용 별도 등록
  4. sitemap 제출: `https://blissme.ai/sitemap.xml`
  5. URL 검사 → "색인 등록 요청" 클릭

### 3. 📧 Zoho Workplace 메일 — 사이트 교체만 남음
**상태**:
- ✅ Zoho 가입(테라포트, Free Plan), contact@blissme.ai 메일박스 생성
- ✅ Cloudflare DNS 5개 레코드 (MX 3개 + SPF + DKIM)
- ✅ 도메인 검증 통과

**남은 작업**:
1. 사용자: Zoho [모든 레코드 확인] 클릭 + contact@blissme.ai 첫 로그인 + 비번 변경
2. 송수신 테스트
3. **Bliss 사이트 일괄 교체**: `cripiss@naver.com` → `contact@blissme.ai` (about/privacy/terms/refund/pricing.html + AppShell footer)

**자격증명**: memory `reference_zoho_workplace.md`

### 4. 🌐 루트 정적 랜딩페이지 신규 작성 (SEO 큰 도약)
- 현재 `/`는 SPA 로그인 화면 → Googlebot이 키워드 풍부한 컨텐츠 못 봄
- 신규 정적 HTML 랜딩페이지 (`/` 또는 `/landing.html`) — Hero + 기능 6~8개 카드 + 비교표 + FAQ + 가격 + CTA
- 본문 1,500자+ 키워드 자연 포함, h1/h2/h3 구조, FAQ Schema JSON-LD
- 로그인은 `/login`으로 이동, SPA는 `/app/*`
- 색인 + 검색 노출에서 가장 큰 효과 예상

### 5. 🔵 네이버 톡톡 상담완료 자동 연동 — 정식 챗봇 통합 (1~2주)
- ✅ POST `/chatapi/ct/partner/{handle}/chat/{chatId}/end` (200 OK) + 매장 핸들 8개 확보
  - 강남 w4jmdh, 마곡 w4lf15, 왕십리 w4h6dw, 용산 w4gsgn, 위례 w4l272, 잠실 w4ls78, 천호 w45f9j, 홍대 w5wyqh
- ❌ chat_id(4자) ↔ messages.user_id(22자) 매핑이 nchat socket 통신으로만 → HTTP 추출 불가
- 전환 방향: 정식 챗봇(handover_v1) 통합. 메시지 수신/발송/상담완료 모두 공식 API. 작업 양 1~2주

### 6. 🟡 네이버 "전체 막기/풀기" 1건 누락 (2026-05-09)
- 증상: 슬롯 막기 팝업의 [전체 막기]·[전체 풀기] 누르면 3건 중 1건이 빠짐
- 후보 원인 (TimelinePage.jsx `toggleAll`): is_active false skip / bit 값 / toggleOne fetch 실패 옵티미스틱 롤백
- 추가 정보 필요: 못 막힌 항목 이름 + alert 떴는지 + 그 슬롯에 이미 예약 있는지

### 7. 🟡 네이버 확정 시 dateTimes 03:30 — 12h 변환 의심
- 김기덕 #1231261029 (15:30) 확정 시 네이버 응답 `dateTimes:["2026-05-09T03:30:00+09:00"]` (12시간 차이)
- 03:30은 네이버 API 응답값 (bliss_naver.py:1131)
- 우선순위 낮음. 친절 메시지(v3.7.548)로 운영 영향은 제거됨

### 8. 다음 세션 검토할 만한 기능 추가
- **결제 내역 페이지** (매장이 자기 매장 결제 이력 조회) — 토스 컨펌 후
- **충전형 자동결제 UI** (멤버십 자동충전 + SaaS 월구독) — Edge Functions billing-issue/charge는 깔림, UI만 필요
- **결제수단 다양화**: 현재 'CARD' 고정 → 계좌이체/간편결제 옵션
- **체험단 콜라보 마케팅팀 텔레그램 알림** (콜라보 키워드 즉시 알림)
- **이모티콘 → I 아이콘 Phase B** (BlissAI / Admin / SalesPage / CustomersPage 잔여)

### 9. ⛔ NHN KCP / 포트원 V2 — 사실상 폐기 검토
- KCP가 정기결제만 허가, 일반결제 미허가 (2026-05-12 확인)
- 토스페이먼츠가 일반+충전형+결제링크 모두 가능 + 수수료 더 저렴
- 단, 코드 차원 포트원 V2 fallback 분기는 유지 (매장이 원하면 사용 가능)
- memory `reference_nhn_kcp.md` → "보류/폐기 검토" 표시 완료

---

## 환경 정보 빠른 참조 (자세히는 CLAUDE.md)

- **서버**: bliss-server (Oracle Cloud, 158.179.174.30) — `/home/ubuntu/naver-sync/`
- **DB**: Supabase `dpftlrsuqxqqeouwbfjd` (biz_id: `biz_khvurgshb`)
- **CF**: blissme.ai (Cloudflare Proxy)
- **로컬 dev**: `npx vite --force` → http://localhost:5173
- **배포**: `rm -rf dist && npx vite build && scp dist/* bliss-server:/tmp/bliss-app/ && ssh bliss-server "sudo cp -r /tmp/bliss-app/* /var/www/html/bliss-app/"` + CF 퍼지
- **AI 모델**: `CLAUDE_MODEL=claude-haiku-4-5` (env.conf + 코드 디폴트) — 메인. fallback: gpt-4o-mini → gemini-2.5-flash
- **결제 PG**: 토스페이먼츠 직결 (메인). NHN KCP/포트원 V2 (보조, 폐기 검토)
- **MCP**: `tosspayments-integration-guide` 추가됨 — V2 SDK·결제승인·빌링·링크페이 docs 검색

## 배포 룰 (memory)
- BLISS_V + version.txt **둘 다** 같은 값으로 bump (불일치 시 무한 reload 루프)
- 수동 배포 시도 마지막에 CF 캐시 퍼지 자동 실행
- 수정 누적 → "배포" 신호 시 한 번에 빌드·서버·퍼지·버전업
- 작업세션(worktree) 배포 금지 — 배포세션(main 폴더)에서만. 단 사용자 명시 동의 시 우회 가능
