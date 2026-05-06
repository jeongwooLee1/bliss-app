# HANDOFF

## 현재 버전
- **라이브: v3.7.502** (https://blissme.ai/version.txt) — 2026-05-06 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수

## 현재 작업
**없음** — 새 세션에서 이어받기

---

## 이번 세션(2026-05-06) 변경 요약 (v3.7.493 → v3.7.502)

### 타임라인 / 직원 칼럼
- **moveEmpCol fix**: hidden(휴무·타지점) 직원이 새 visible 끝에 붙어 절대순서 망가뜨리던 버그 → swap된 두 ID만 위치 교환, hidden은 원래 위치 유지 (TimelinePage.jsx)
- **외국 영문 ALL-CAPS 이름** → 타이틀케이스 자동 정규화 (네이버 "ATWOOD LAUREN ELIZABETH" → "Atwood Lauren Elizabeth"). 한글 섞이면 그대로.

### 예약 모달 / 모바일
- **삭제 확인 모달** 커스텀화 (모바일에서 native `confirm()` 미표시 이슈)
- **외부 플랫폼 예약(Trazy/Creatrip/SeoulBeauty)** 정상 인식 — 네이버로 잘못 분류 X, 삭제 가능, "✓ 확정" 버튼 (네이버 확정과 분리)

### 매출관리 페이지
- 검색 하단 카드 2줄 제거
- "합 계" 행을 헤더 바로 다음(2번째 행)으로 이동, sticky 처리

### 메시지함
- **번역 토글 3-state**: 자동 / 강제 영어 / OFF (3-state cycle, localStorage)
- **번역 진행 중 ON-AIR 표시**: 빨간 점 1초 깜빡 + "번역 중…" 라벨
- **사이드바 받은메시지함 클릭 시 첫 화면 리셋** (inboxResetKey 카운터)
- **발신 직원 디폴트 = 지점명** + 수동 선택 시 localStorage 저장
- **버튼 디자인 통일** (Bliss SVG 아이콘): ✨ AI 답변 추천 / 🌐 번역 / 📅 AI 예약등록 / ✍️ 발신 직원
- **`/ai-suggest` 엔드포인트** 신설 — ✨ AI 버튼이 state 기반 플로우 사용 (suggest_only=True)

### 매출 등록 / 체험단
- **체험단(0원 매출) 고객 → 신규로 판단** (`SaleForm.jsx`의 custHasSale에 `total>0` 필터)
- 체험단 예약 매출 모달:
  - 시술 클릭 → 자동 comped + 0원 (체험 기본)
  - 🎁 클릭 → 유료 결제로 전환 (정상가 복원)
  - prefill 항목도 자동 comped 처리
- **체크박스 추가** + 🎁/분/금액 컬럼 정렬 표준화 (이름·🎁·분·금액 4컬럼)
- 페어 행(절반/전체)도 동일 정렬 + 체크박스 + 🎁
- 🎁 이모지 → Lucide gift SVG 아이콘 (Bliss 톤)

### AI 자동 응대 (서버 ai_booking.py)
- **모델 우선순위**: claude-haiku-4-5 → gpt-4o-mini → gemini-2.5-flash (3-tier hybrid, 2026-05-06 6모델 비교 결과 기반)
- **멀티턴 messages 배열 호출** — 단일 prompt에서 messages array로 (LLM이 진짜 대화로 인식)
- **chat_booking_state 시스템 메모리**: 대화별 누적 정보(branch/service/date/time/custName/custPhone/custEmail/lang) — AI가 추출 못한 정보를 시스템이 누적
- **언어 룰**: 첫 대화 언어로 끝까지 (이중 모드 제거)
- **시간 처리**: 명시 숫자(영업시간 기준 PM/AM 자동) OK, 모호 표현(evening/morning) → ask_info
- **history 무시 방지** 강조 프롬프트 추가
- **상담 후 시술 매칭 차단**: request_msg에 "페이스 상담"/"바디 상담"/"브라질리언 상담" 발견 시 selected_services에서 해당 카테고리 시술 강제 제거 (AI 룰 무시 보강)

### AI 분석 비용 절감
- **rescrape 시 ai_analyze 재호출 차단** — `selected_services` 있으면 절대 재분석 X (5분 주기 ai_call 90% 감소 예상)
- `reservations.ai_input_hash` 컬럼 추가 (변경 감지용, 현재 미사용)

### Edge Functions / cron
- **alert-stale Edge Function 신설**: 5분 경과 확정대기/미읽 메시지 → 텔레그램 알림 (1회만)
- pg_cron 4개 fix: `net.http_post` 3번째 인자가 headers가 아니라 URL params였음 → named param `headers :=`로 재등록 (alert-stale, check-pending, daily-report, weekly-report 모두 401 인증 실패였던 것 정정)
- `reservations.tg_alerted_at` / `messages.tg_alerted_at` 컬럼 추가

### 자동 태그 트리거 (`tagAutoTrigger.js`)
- **★마지막회차 = 패키지 카테고리 보유권만 평가** (에너지테라피·바디 등 다른 카테고리 잔여로 잘못 부착 방지)
- **★기존상담 / customer_inactive_days**: 유료 매출 0원 고객은 신규로 간주 → OFF
- `is_new_customer`: visits=0 OR `hasPaidSale=false` (체험단 0원 매출 고객 신규 처리)

### 외부 플랫폼 메일 처리 (서버 bliss_naver.py)
- **Trazy/Creatrip/SeoulBeauty 모두 INSERT 실패하던 버그 fix**: `service_name` 컬럼 reservations 테이블에 없음 → `request_msg`로 변경
- **Creatrip HTML 파싱 버그 fix**: `_strip_creatrip_html()` 추가 (HTML 태그 제거 후 정규식 매칭)
- 누락된 Rachel Cannon Trazy 2건 (5/30 5:00/15:30 강남) 수동 INSERT

### 네이버 고객 매칭 안정화 (서버 bliss_naver.py)
- **Lauren Atwood orphan 케이스 정정** (cust_id 잘못된 ID 참조)
- find_cust_by_phone 실패 → 새 고객 INSERT 실패 → orphan cust_id 저장되던 흐름 fix:
  - 신규 생성 직전 재시도 매칭
  - INSERT 응답 status_code 확인 후 cust_id 부여
  - INSERT 실패(duplicate 등) → race recover 매칭 시도
  - 최종 실패 시 cust_id="" (orphan 방지)

### 메시지 자동 알림 (서버 bliss_naver.py)
- **알림톡 billing 0건 버그 fix**: `noti` 변수가 process_item 내부 scope에서 외부 참조되어 NameError → `get_branch_cfg(item["branch_id"])` 재조회로 fix

### 공지 이미지 중복
- BlissRequests의 부모 div + 자식 textarea 양쪽에 onPaste 핸들러 → 1장 paste = 2번 업로드 → 부모 div 핸들러 제거

### 사용자 요청 처리 (전부 done)
- id_spkcqnh58u 정우 — 텔레그램 알림 안 옴 → cron headers fix
- id_wxp2ive8gv 정우 — (a) 공지 이미지 중복 (b) 위례점 ai_call 과다 → 양쪽 fix
- id_6z8kuwq6du 정우 — 페이스상담후 풀페이스 매칭 → AI 후처리 차단 + 9건 backfill (직원 수동 손본 5건은 sale_details 기반 복원, 매출 없는 7건 무처리)
- id_wclrq3dibs 덩우 — 번역 토글 강제 영어 모드 추가
- id_imgr471swt-6 당일취소 페널티 (이전 세션, 현재 세션 미처리)

---

## 주의사항 (다음 세션 참고)

### 작업 룰 (반복 위반 사례 있어 주의)
- **로컬 컨펌 후 라이브 배포** — `localhost:5173` dev server에서 사용자 확인 후 배포
- **사용자가 명시적 "배포해" 신호 줄 때만 배포** (자기 마음대로 배포 금지)
- **묶음 배포** — 수정 누적 → "배포" 신호 시 한 번에
- **과거 데이터 함부로 건드리지 말 것** — 직원이 수동 매칭한 selected_services 등은 보존 (이번 세션에 12건 잘못 backfill했다가 5건 복원 사고)
- **요청 원문 인용 + 내 이해 → 유저 확인 → 코드 수정** (consult-first 룰)

### 인프라 / 비용
- **Anthropic Claude 크레딧**: $55.01 잔액, $5 미만 시 자동 충전 $30
- **AI 모델 우선순위**: claude-haiku-4-5(메인) → gpt-4o-mini(폴백) → gemini-2.5-flash(무료 안전망)
- **OpenAI 키, Gemini 키, DeepL 키 등 모두 `businesses.settings`에 저장**
- **메모리 시스템**: `chat_booking_state` 테이블 — 대화별 누적 정보 저장

### Meta HUMAN_AGENT 권한 신청 대기
- Instagram 24h 메시지 창 → 7일 연장하려면 Meta `human_agent` 권한 신청
- 사장님이 직접 신청해야 함 (Meta for Developers → App Review → Permissions)
- 사용 사례: "직원이 직접 작성한 메시지 발송, 예약 리마인더·변경 안내"
- 스크린캐스트 + 테스트 계정 필요

### 의논 대기 — 결제시스템 도입 (이전 세션 인계 항목)
- 충전(돈 받기) 흐름 미완 — 토스페이먼츠 / 아임포트 / 무통장 / 카카오페이 옵션 검토 필요
- 사업자 정보 / 결제 정책 / 무료/유료 매장 분리 등 결정 필요

### 위험 / 알려진 이슈
- 외부 플랫폼 메일 자동 INSERT는 5/6 fix 후부터만 작동 (이전 메일은 직원이 수동 등록했던 것)
- ai_input_hash 컬럼 활성화 안 함 (selected_services 있으면 skip 룰로 충분)
- 일부 고객(체험단/0원 매출) 데이터에서 신규/기존 판정 로직 변경됨 → 이벤트·태그 룰에 영향
