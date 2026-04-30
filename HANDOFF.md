# HANDOFF

## 현재 버전
- **라이브: v3.7.284** (https://blissme.ai/version.txt) — 2026-05-01 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수

---

## 현재 작업
**없음** — 2026-05-01 야간 자동화 세션 완료. 블리스 AI 예약/취소 액션 + 추측 금지 + 부분 매칭 + 검증 테스트 완료.

---

## 최근 작업 (2026-05-01 야간 자동화)

### 블리스 AI 예약/취소 액션 + UX 개선 (v3.7.272 → v3.7.284)

#### 신규 액션
- `create_reservation` (예약 생성) + `cancel_reservation` (예약 취소)
- 권한: 마스터 + 일반 직원 모두 사용 가능 (그 외 설정변경은 마스터 전용)
- 사이드바 BlissAI + 우하단 FloatingAI 둘 다 지원

#### 핵심 로직
- **추측 금지** — 지점/날짜/시간/고객 정보 누락 시 묻기 (ambiguous)
- **부분 정보 매칭** — "정우 8008" → 이정우 #6005 자동 매칭
- **rawInput 숫자 토큰** — AI 파서가 4자리 phone 무시해도 rawInput에서 직접 추출해 검색 (동명이인 식별 결정적)
- **이미지 첨부** — "예약" 키워드 있으면 파싱, 없으면 의도 묻기
- **고객 매칭 enrichment** — phone/email 정확 일치 → 부분 일치 → 신규 등록 순. phone 비면 phone2 fallback
- **시스템 프롬프트** — "매장 내부 직원 전용" 명시, 고객 응대형 인사 금지

#### 핵심 파일
- `src/lib/aiBookParse.js` — `parseBookingWithAI`, `findCustomerForBooking(ps, bizId, rawInput)`, `findReservationsToCancel`
- `src/components/BlissAI/actionSchemas.js` — RESERVATION 액션 스키마, intent 프롬프트
- `src/components/BlissAI/actionRunner.js` — `runCreateReservation`, cancel_reservation 처리
- `src/components/BlissAI/BlissAI.jsx`, `FloatingAI.jsx` — handleSend에서 위 흐름 통합
- `src/components/BlissAI/contextBuilder.js` — SYSTEM_PROMPT (직원 내부 도구 톤)

#### 검증 결과 (10명 + 정보누락 3건 자동 테스트)
- **A1~A3 (3/3 PASS)** — 추측 없이 정확히 부족한 정보만 묻기
- **B1~B5** — 4/5 정확, B1·B5 동명이인 부분 매칭 fix 후 검증 OK
- **C1~C5 (5/5 PASS)** — 신규 고객 자동 생성 + 예약 등록 정상
- DB 검증: 12건 예약 + 5명 신규 고객 정상 INSERT 확인 후 정리 완료

#### 데이터 정리
- AI Book 테스트 예약 12건 삭제 (`reservation_id LIKE 'aibook_*'`)
- 테스트 고객 5명 (`name LIKE '테스트*'`) 삭제
- orphan 고객 12명 (cust_num 없고 매출/예약 없음) 삭제

### ReservationModal 변경 버튼 통합 검색 UI
- 변경 버튼 클릭 시: 분리된 두 input(이름·전화) → 통합 검색 필드 (🔍 + placeholder "이름·전화 (예: 정우 8008)")
- selectCust 호출 시 `phone || phone2` fallback로 풀 번호 채움
- 검색 모드 종료 시 자동으로 editingCust=false

### 타임라인 시각 개선
- 종료시간(grid 끝) 200px 하단 여백 추가
- topbar 아래·grid 끝 아래에 그림자 (`0 4px 8px -2px rgba(0,0,0,0.12)`)
- 직원이름 셀 위 1px 가로선
- 근무외 시간 점선 제거
- 지점 사이 14px 간격 + 우측 그림자

### 필터 상태 TTL (`useSessionState`)
- `TTL.SEARCH` 1h (검색어), `TTL.DATE_RANGE` 6h (날짜), `TTL.TAB` 24h (탭)
- 적용 페이지: 고객관리/예약관리/매출관리/메시지함

---

## 알려진 한계
- 동명이인이 많을 때(박성진 9명) 부분 정보 식별 어려움 → confirm 카드의 매칭 표시를 보고 사용자가 취소 후 재입력 (safety net)
- AI Book 파서가 부분 전화(4자리) 무시해도 rawInput 추출로 우회됨

## 다음 단계 (선택)
- 예약 변경 액션 (시간/지점/시술 변경) — 현재는 생성·취소만
- WhatsApp/Naver 채널 자동화 (보류 중)
- 동명이인 식별 UX — 매칭 후보 여러 명 있을 때 사용자에게 선택지 제공
