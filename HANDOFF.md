# HANDOFF

## 현재 버전
- **라이브: v3.7.60** (https://blissme.ai/version.txt) — 2026-04-24 배포 완료

## 🚧 배포 대기 (다음 배포 시 처리)
- **`feat/consent-integration` → main merge**: 동의서 통합 브랜치 병합 후 함께 배포 반영
- **사전 준비 필수**: `sign.blissme.ai` Cloudflare Pages 배포 먼저 완료돼야 실사용 가능 (QR 스캔 → 태블릿/폰 서명 페이지). Pages 배포 없이 bliss-app만 올리면 링크 열어도 404

### v3.7.60 (2026-04-24)
- 예약블록 사용자 메모 폰트 -1 (제목행보다 1 작게)
- **SaleForm `reservationId` 필드 누락 버그 수정** — 매출등록 시 `sale.reservationId` 저장되지 않아 예약모달 매출완료 전환이 안 되던 문제. `sale` 객체에 `reservationId: reservation?.id || null` 추가
- DB 백필: 4월 이후 app 등록 매출 **207건** `reservation_id` 복구 (cust_id+bid+date+time 매칭)

### v3.7.59 (2026-04-24)
- 미배정 칼럼 ✕ 삭제 버튼 (추가된 extra column만, 남은 미배정으로 자동 이관)
- 다담권 FIFO 정렬 (purchased_at ASC)
- 다담권 유효기간 1년 -1일 (SaleForm 3곳)
- 받은메시지함 배너: 1분 이상 미답변부터 표시
- 예약모달 변경모드 고객검색 연결

### 케어 SMS 지점별 템플릿 확인 및 준비 완료 (2026-04-24 밤)
- 알리고 알림톡 템플릿 전수 조회 — `UG_8978~UG_8982` 코드로 시술후 5/10/21/35/53일 메시지가 이미 브랜드 톤으로 작성되어 있음. `fetch_templates.py` 응답엔 안 뜨는데 실제 `noti_config.after_Nd.msgTpl`에는 저장돼 있음 (senderkey 구버전 조회 결과일 가능성).
- 기존 msgTpl 5개 (8개 지점 동일):
  - 5일: `[하우스왁싱] 보들보들 행복! 이제 스크럽으로 피부리셋시작!`
  - 10일: `[하우스왁싱] 간지러움? 샵에서 기기스크럽으로 간지러움 OUT.`
  - 21일: `[하우스왁싱] 왁싱3주차. 오늘부터 3일이내! 왁싱 주기로 완벽한 때 입니다.`
  - 35일: `[하우스왁싱] 왁싱5주차.지금은 돌아갈 수 있는 때 입니다. 다시 왁싱의 신세계로.`
  - 53일: `[하우스왁싱] 왁싱2달째. 이제는 그만 털을 보내주어야 할 때 입니다ㅠㅠ`
- **8개 지점 모두 `sendTime = "10:00"` 추가 완료** (강남/마곡/왕십리/용산/위례/잠실/천호/홍대). `on`은 **false 유지** — 복귀 후 직접 토글.

### 지점별 senderPhone 8개 등록 완료 (2026-04-24 밤)
- 강남 02-515-5141 / 왕십리 02-2298-9888 / 홍대 02-322-8002 / 마곡 02-2664-6123
- 천호 02-473-4735 / 용산 010-2330-8088 / 위례 010-5763-8078 / 잠실 010-9698-2553
- ⚠️ **알리고 사전 등록 필수** — `smartsms.aligo.in` 발신번호 관리에서 8개 모두 인증 상태인지 체크. 미등록이면 통신사 서류 인증 필요
- 우회: `01057028008`(이미 검증)로 통일 후 점진 교체 가능

⚠️ **주의 — 토글 ON 할 때 과거 대상 일괄 발송 위험**
- 오늘(4/24) 기준 5/10/21/35/53일 전(4/19, 4/14, 4/3, 3/20, 3/2)에 completed였던 예약 전체에 **한 번에** 발송됩니다 (care_sms_log에 기록 없으면).
- 추천 절차:
  1. **위례점만 on=true + 5일 항목만 on=true**로 소량 테스트 (위례 4/19 시술자 몇 명)
  2. 알리고 과금·수신 확인
  3. 다른 지점·항목 점진 on
- 테스트 전 폭주 방지가 필요하면: `INSERT INTO care_sms_log (reservation_id, days_after, status) SELECT reservation_id, 5, 'skip' FROM reservations WHERE ...`로 과거분을 미리 skip 처리

### v3.7.39 (2026-04-24, 밤 자율 세션 — 회원가 자격 UI 준비)
- DB: `services.grants_member_price boolean` 컬럼 추가 (null 허용)
- db.js DBMAP/DB_COLS에 `grantsMemberPrice` 매핑
- AdminSaleItems 편집 모달에 "⭐ 회원가 자격 부여" 토글 추가 (다회권 토글 옆)
- **기존 로직은 건드리지 않음** — 컬럼 null 상태에선 `member_price_rules` + `_pkgType()` substring 매칭 그대로 동작. 유저 복귀 후 각 상품별 체크 → 추후 `isMemberCustomer` 로직을 `services.grants_member_price` 기반으로 마이그레이션
- 기존 하드코딩 substring 대상 확인:
  - `_pkgType()`에서 "연간" / "다담" / "다회" / "왁싱 PKG" 등 substring 매칭 → 유저가 "⭐ 회원가 자격" 체크해야 할 상품
  - 추천: 연간회원권 / 연간할인권 / 다담권 50만 / 다회권 전체 / 풀페이스 PKG / 왁싱 PKG / 토탈 PKG

### v3.7.38 (2026-04-24, 밤 자율 세션)
**시술후 케어 SMS 자동 발송 시스템 신설** (알림톡 → SMS 전환)

유저 요청: `알림톡은 해당 데이터를 못 받아서` → 알리고 **SMS(/send/)** API로 시술 후 N일 경과 고객에게 자동 안내 문자.

**DB 변경** (Supabase 완료)
- `alimtalk_queue.channel text NOT NULL DEFAULT 'alimtalk'` — 채널 구분 ('alimtalk' / 'sms')
- `care_sms_log` 테이블 신설 — `(reservation_id, days_after)` UNIQUE 제약으로 중복 발송 방지

**서버 `bliss_naver.py`** (백업: `bak_before_sms_YYYYMMDD_HHMMSS`)
- `alimtalk_thread` 확장 — `channel='sms'` 항목은 `https://apis.aligo.in/send/` 로 전송 (key/user_id/sender/receiver/msg). 알림톡(senderkey+tpl_code) 경로와 분리. 성공 판정: 알림톡 `code=0`, SMS `result_code=1`.
- **`care_sms_scheduler_thread` 신설** — 5분 주기로 실행
  - 각 지점 `noti_config`에서 `after_5d/10d/21d/35d/53d` 설정 읽음
  - 각 항목 `on=true` + `sendTime`±2분 창에서만 처리 (과발송 방지)
  - reservations에서 `date === today - Nd` AND `status IN (completed,confirmed)` 매칭
  - 필터: 국내 휴대폰(010~019) + 010/7자리 길이 / `care_sms_log` 중복 제외 / `customers.sms_consent !== false`
  - `care_sms_log` INSERT → race 방지 후 `alimtalk_queue` 에 `channel='sms'` 삽입
  - 워커가 성공 처리하면 `care_sms_log.status='sent'` 업데이트

**템플릿 변수** (SMS msgTpl 치환):
- `#{고객명}`, `#{지점명}`, `#{매장명}`, `#{시술일}`, `#{일수}`

**앱 UI `AdminNoti.jsx`**
- "시술후 케어 알림" 섹션 → **"시술후 케어 알림 (SMS 발송)"** 레이블
- 상세 편집 화면:
  - 📱 SMS 안내 배너 (최대 2,000byte / 90byte 초과 시 자동 LMS)
  - 템플릿 코드 입력 필드 **숨김** (SMS 불필요)
  - 바이트 카운터 + SMS/LMS 실시간 배지
  - SMS 전용 변수 힌트
  - **"테스트 전송" 버튼** — 아무 번호 입력하면 즉시 큐에 삽입, 10초 내 실제 SMS 발송 (검증용)

**알리고 SMS API 연동 검증 완료**
- `testmode_yn=Y` 호출 → `{result_code:"1", success_cnt:1, msg_type:"SMS"}` ✓
- 기존 알림톡 credentials (`aeymilcraepgb3i2lgmyk2iez23iefh9` / `cripiss` / `01057028008`) 재사용
- 발신번호는 `noti_config.senderPhone` 그대로

**운영 시 체크**
1. 각 지점 관리설정 → 알림톡 설정 → "시술후 케어 알림" 섹션에서 항목별 on/sendTime/msgTpl 설정
2. 지점이 `noti_config`에 aligoKey/aligoId/senderPhone 없으면 skip (위례/홍대만 현재 설정됨)
3. 고객 `sms_consent=false` 면 제외
4. 같은 예약에 같은 일수 2번 발송 안 됨 (care_sms_log UNIQUE)

### v3.7.37 (2026-04-24)
- AdminNoti 케어 알림 그룹 SMS 구분 준비 (UI 메타 + 안내 배너)

### v3.7.36 (2026-04-24)
- `empColOrder_v1` **Realtime 구독 + 30초 폴링 추가** — DB 변경이 모든 탭 즉시 반영. 이전엔 stale state 때문에 DB 수정 → 브라우저 상태로 재덮어쓰기 루프 발생
- DB 강남 order 재조정: `[현아, 지은, 재윤, 경아, 서현, 희서, 민정, 권도윤]`

### v3.7.35 (2026-04-24)
- 페이더 핸들 pointerdown 이벤트 stopPropagation — 드래그 시 지점선택 팝업 안 뜨게 차단

### v3.7.34 (2026-04-24)
- 근무지 편집 모달 바 snap 단위 **30분 → 10분**
- **DJ 페이더 스타일 경계 핸들** — 바 아래로 튀어나온 22×16px 그립 + 컬러 가이드선 + 호버 확대 + `ew-resize` 커서

### v3.7.33 (2026-04-24)
- 모달 상단 "근무시간 저장" 버튼 제거 → 하단 💾 저장으로 통합 (`draftWh` draft 상태). isDirty 판정에 `draftWh` 포함

### v3.7.32 (2026-04-24)
- 모달 자동 구간 UI 통일 — 편집/자동 구간 동일 select 드롭다운 사용(자동은 disabled). "자동" 배지·이탤릭 제거
- "종일 (~21:00)" 텍스트 없앰

### v3.7.31 (2026-04-24)
- 모달 `visualSegs` 로직 — 앞/사이/뒤 빈 구간을 모두 base 지점으로 자동 보완
- 목록도 visualSegs 기반으로 렌더 (자동 base 구간 표시)

### v3.7.30 (2026-04-24)
- `getEmpActiveSegments` base 지점 분기 개선 — `base 근무시간 - 타지점 segments = 전체 활성 구간`으로 계산 (여러 구간이어도 정확히 표현)
- DB 강남 order 재조정
- DB 경아_2026-07-01 오버라이드 복구

### v3.7.29 (2026-04-24)
- 복수 segment 비활성 오버레이 — `activeSegments:[{from,until}, ...]` 배열 도입 → 강남 11-16 / 왕십리 16-19 / 강남 19-21 같은 분할 근무도 정확 표시

### v3.7.28 (2026-04-24)
- `scheduleExistsForDate` 판정에 오버라이드 존재 여부 포함 — 근무표 백지인 날에도 이동/지원 오버라이드가 있으면 정상 경로 진입
- DB `서현_2026-07-01` 잘못 저장분 삭제 후 복구 검증

### v3.7.26 (2026-04-23)
- 예약목록: 시술 누락 수정(`groupSvcNames` pkg__ fallback), 고객번호 자동 로드, manual/ai 예약번호 숨김, 네이버번호를 `📋 #ID` 배지로 통합
- 타임라인: `empSettings.excludeFromSchedule=true` 직원 제외 (오세기/이정우/이주현)
- 타임라인 헤더 `◀ ▶` 직원 순서 이동 버튼 + 팝업 화살표 행 삭제
- `moveEmpCol` prev 기반으로 재설계 — stale allRoomsRef로 같은 swap 반복되던 버그 차단

---

## Pending (다음 세션 이어갈 것)

### 0. **케어 SMS 실제 발송 검증** (v3.7.38 배포 후 유저 복귀 시)
- AdminNoti → 시술후 케어 알림 → 항목 클릭 → 메시지 템플릿 입력 + 저장 → **테스트 전송** 버튼으로 실발송 확인
- 실제 타깃 케이스(5/10/21/35/53일 전 예약)가 오늘 DB에 있는지 확인 후 sendTime 지금 시각 설정 → 5분 내 자동 발송 관찰
- 알리고 잔여 건수 모니터링 (실발송 시 과금)

### 1. Lazy-load 풀 리팩토링 (전 HANDOFF 유지)
### 2. 회원가 자격 상품별 등록 UI화 (전 HANDOFF 유지)
### 3. 세션 복구 Phase 2-4 (전 HANDOFF 유지)
### 4. 직원 지점 이동 시 예약 자동 이동 (id_825fnuel64)
### 5. AI 설정 UI 개선 (id_triao6fesy)
### 6. `empColOrder_v1` 길이 축소 버그 재현 조건 확인 — 8~13명 리스트가 6명으로 축소된 사례. 원인 미확인. 재현 시 어떤 UI 액션/경로인지 확인 필요

---

## 주의사항
- **배포는 모아서 한 번에** — 유저가 "배포" 신호 주면 BLISS_V + version.txt 둘 다 bump + 빌드 + 서버 + CF 퍼지
- **배포 묻지 않고 바로** — memory feedback_bliss_deploy_auto 준수
- **`empColOrder_v1` Realtime 구독 있음 (v3.7.36~)** — DB 수정이 모든 탭에 즉시 반영됨. 이전 stale state 문제 해소.
- **알리고 SMS — testmode 아닌 실 발송 주의** — `test_alimtalk.py`/`aligo_test.py` 참고, `testmode_yn=Y` 파라미터로 무료 테스트 가능
- **케어 SMS `send_time` ±2분 창** — 스케줄러는 5분 주기라 여유 있음. `sendTime=10:00`이면 10:00~10:02 사이 실행
- **care_sms_log UNIQUE** — 같은 예약에 같은 일수는 두 번 안 보냄. 테스트 후 재발송하려면 해당 row DELETE 필요
