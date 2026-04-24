# HANDOFF

## 현재 버전
- **라이브: v3.7.76** (https://blissme.ai/version.txt) — 2026-04-24 배포 완료

## Gmail Pub/Sub Push 복구 (2026-04-24 23:58 KST)
- **증상**: Apr 22 이후 gmail-push 로그 0건 → watch 자연 만료 (TTL 7일)
- **근본 원인**: watch 자동 갱신 로직 부재 (서버 코드에 없음)
- **복구 조치**:
  - GCP `bliss-492906`: Gmail API + Pub/Sub API 활성화
  - OAuth 클라이언트 "Bliss Gmail Push" (Desktop) 생성 → 데스크톱 OAuth 2.0
  - OAuth 동의 화면 테스트 유저: housewaxing@gmail.com, cripiss@naver.com 추가
  - Pub/Sub topic `gmail-push` + `gmail-api-push@system.gserviceaccount.com` Publisher 권한
  - Push subscription `gmail-push-sub` → `https://blissme.ai/gmail-push`
  - `users.watch()` 호출 (server 쪽도 재등록 확인)
- **자동 갱신 cron**: `0 4 */6 * * /home/ubuntu/naver-sync/gmail_push/renew_watch.sh` (6일마다 새벽 4시). 실패 시 텔레그램 알림
- **배포 경로**: `/home/ubuntu/naver-sync/gmail_push/{setup_watch.py,renew_watch.sh,client_secret.json,token.json}`
- **검증**: 서버 로그 `[gmail-push] msgId=...` + `POST /gmail-push 204` 정상 수신
- **주의**: `client_secret.json` + `token.json` 보안 중요 — 서버에만 저장, 외부 유출 금지

## v3.7.76 (2026-04-24)
- **회원가 동시구매 로직 **실제로** 작동하도록 수정** — `const` 바인딩 TDZ는 매 렌더마다 적용되므로, 상단에서 `items`를 즉시 참조하는 `_safeItemsSome(...)` 호출은 매 렌더에서 catch되어 항상 false 반환하는 치명적 버그였음.
- **수정**: items 접근을 lazy 함수(`_hasAnnualInCart()`/`_hasPrepaidInCart()`)로 감싸서, 함수가 호출되는 시점(JSX 렌더·effect 내부)엔 이미 `items`가 선언된 후라 정상 접근. `isMemberCustomer`는 `_computeIsMemberCustomer()`로 계산하되 호출을 `useState(items)` 이후로 이동.

## v3.7.75 (2026-04-24)
- **TDZ 핫픽스(불완전)** — `_safeItemsSome` try/catch 래퍼 도입. 크래시는 막았지만 매 렌더 TDZ로 false 반환하는 부작용이 남아있었음 → v3.7.76에서 근본 수정.

## v3.7.74 (2026-04-24)
- **연간회원권·선불권 동시 구매 시 즉시 회원가 적용** — SaleForm `isMemberCustomer`/`isMemberPriceFor`에 신규 구매 감지 추가
  - `items`에 `_isAnnualSvcMP` 매칭 시술 체크되면 `_newSaleAnnualGrants=true` → 모든 시술 회원가
  - 선불권 신규 구매: 구매금액 ≥ 시술 회원가일 때 그 시술만 회원가
  - `_excludedSvcNames`(바프권 등) 신규 구매는 자격 부여 안 함
  - 기존 `useEffect([isMemberCustomer, gender])`가 체크된 시술 가격 자동 재계산

## 🚧 PENDING (다음 세션 이어받을 것)

### 매출등록 시 알림톡 자동발송 구현 (미구현)
**현재 상태**: 관리설정의 on/off + 템플릿은 설정돼 있지만 **SaleForm에 `queueAlimtalk` 호출이 없음** → 큐에 안 쌓여 발송 안 됨.

작동 중 ✓: `rsv_confirm`, `rsv_change`, `rsv_cancel` (TimelinePage/ReservationModal에서 트리거)

구현 누락:
- **`tkt_pay`** — 바프권/선불권 사용 시 (템플릿은 현재 횟수 기반 UG_6292인데 바프권은 금액 기반 → 템플릿 내용 재검토 필요)
- **`pt_use`** — 포인트 사용 시 (msgTpl/tplCode **비어있음** — 먼저 템플릿 등록 필요)
- **`pt_earn`** — 포인트 적립 시 (msgTpl/tplCode 비어있음)
- `pkg_pay` — 패키지 잔여 차감 시 (템플릿은 UG_6288, 금액형 다담권 충전용 문구)
- `tkt_charge` / `pkg_charge` — 신규 바프권/패키지 구매
- `annual_reg` — 연간권 등록

**작업 순서 (다음 세션)**:
1. 유저와 템플릿 네이밍/내용 정리 (tkt vs pkg 의미 구분)
2. 비어있는 pt_use/pt_earn 템플릿 알리고 대시보드에 등록 + DB 저장
3. SaleForm submit 후 조건별 `queueAlimtalk` 호출 추가:
   - prepaid 사용 금액 > 0 → tkt_pay
   - 포인트 사용 > 0 → pt_use
   - 포인트 적립 > 0 → pt_earn
   - 신규 선불권/패키지/연간권 구매 → tkt_charge/pkg_charge/annual_reg
4. 각 noti_key에 맞는 params 매핑

### ✅ 타지점 알림톡 배송 실패 — 근본 원인 수정 (2026-04-24 v3.7.76 이후)
- **근본 원인**: 전 지점이 강남의 tplCode(UG_2264 등)만 공유 사용 → 타지점 senderKey로 발송하면 Kakao가 tplCode 불일치로 drop (Aligo는 code:0 정상)
- **Aligo 템플릿 조회 확인**: 8개 지점 **모두 각 senderKey에 9개 템플릿이 이미 APR 상태**로 등록됨 (강남도 동일 체계). 단 용산/천호 왁싱패키지는 UG_7454/UG_7456, 나머지는 UG_6xxx 대역.
- **DB 수정 완료**: `branches.noti_config`의 tplCode를 지점별 올바른 코드로 일괄 교체 (jsonb merge). 강남은 유지.
- **수정 후 테스트 (01057028008)**: 강남 4건(rsv/tkt/pkg/annual) + 왕십리 rsv + 잠실 pkg 모두 Aligo code:0 성공. 유저 폰 Kakao 도착 여부 확인 대기.

### 지점별 tplCode 매핑 (2026-04-24 수정 반영)
| 지점 | senderKey 뒷4자리 | rsv_confirm | rsv_change | rsv_cancel | rsv_1day | rsv_aftercare | tkt_* (왁싱PKG) | pkg_* (다담권) | annual_reg | *_exp_* |
|---|---|---|---|---|---|---|---|---|---|---|
| 강남 | ...0888 | UG_2264 | UG_2266 | UG_2270 | UG_2271 | UG_2272 | UG_6292 | UG_6288 | UG_6294 | UG_6297 |
| 마곡 | ...f68e | UG_6132 | UG_6133 | UG_6134 | UG_6135 | UG_6136 | UG_6314 | UG_6313 | UG_6328 | UG_6316 |
| 왕십리 | ...0bac | UG_6115 | UG_6116 | UG_6118 | UG_6119 | UG_6120 | UG_6302 | UG_6301 | UG_6324 | UG_6317 |
| 용산 | ...8799 | UG_6168 | UG_6169 | UG_6170 | UG_6173 | UG_6174 | UG_7454 | UG_6338 | UG_6340 | UG_6341 |
| 위례 | ...b839 | UG_6147 | UG_6148 | UG_6149 | UG_6150 | UG_6151 | UG_6332 | UG_6331 | UG_6333 | UG_6335 |
| 잠실 | ...6d1a | UG_6137 | UG_6138 | UG_6140 | UG_6141 | UG_6142 | UG_6321 | UG_6319 | UG_6322 | UG_6330 |
| 천호 | ...ef53 | UG_6185 | UG_6186 | UG_6187 | UG_6191 | UG_6194 | UG_7456 | UG_6342 | UG_6345 | UG_6346 |
| 홍대 | ...f18d | UG_6122 | UG_6123 | UG_6124 | UG_6129 | UG_6130 | UG_6310 | UG_6309 | UG_6325 | UG_6318 |

### pt_use / pt_earn 템플릿 미등록 (전 8지점)
- 모든 senderKey에 포인트 사용/적립 템플릿 자체가 없음 → 새로 작성 + Kakao 검수 신청 필요
- 검수 승인 후 DB noti_config.pt_use / pt_earn에 tplCode + msgTpl 세팅해야 발송 가능

## 🚧 배포 대기 (다음 배포 시 처리)
- **`feat/consent-integration` → main merge**: 동의서 통합 브랜치 병합 후 함께 배포 반영 (**이미 v3.7.61에서 merge됐을 수 있음 — 확인**)
- **사전 준비 필수**: `sign.blissme.ai` Cloudflare Pages 배포 먼저 완료돼야 실사용 가능 (QR 스캔 → 태블릿/폰 서명 페이지). Pages 배포 없이 bliss-app만 올리면 링크 열어도 404

## 📝 2026-04-24 세션 주요 작업

### 서버 (bliss-naver) 패치
- **Claude Sonnet/Haiku 번역 분리**: `CLAUDE_TRANSLATE_MODEL=claude-haiku-4-5`로 번역 전용 모델. Sonnet 대비 토큰 ~3배 저렴. 분석/AI답변은 Sonnet 유지
- **_load_ai_settings()에 claude_key 누락 버그 수정**: 캐시에 `claude_key` 필드 추가. 이전엔 매번 Gemini 폴백 발동하던 문제
- **번역에 대화 맥락 주입 (`_thread_context`)**: Naver/IG/WA 웹훅에서 최근 8건 스레드 맥락을 `prev_context`로 전달. IG/WA는 변수 스코프(acc/uid) 문제 수정
- **`/translate-outgoing` Flask 엔드포인트 신설** (port 5055, nginx proxy): 한국어→외국어 번역. Haiku 사용. 클라이언트 `sendTranslated`가 호출
- **알림톡 `get_branch_cfg` 버그 수정**: jsonb dict를 `json.loads()`로 파싱 시도해 TypeError → 빈 config → "noti off" 오판정. dict/str 양쪽 핸들링
- **알림톡 `failover_1=N` 추가**: 알림톡 실패 시 SMS 폴백 비활성화 (유저 요청)
- **IG 에코 dedup 강화**: 60초 내 동일 text 체크로 변경 (기존: 마지막 1건 비교). 중복 23건 DB 삭제

### DB 작업
- **매출 `reservation_id` 백필 207건** (4월 이후 app 매출, cust_id+bid+date+time 매칭)
- **매출등록 중복 23건 삭제** (IG 에코 dedup 강화 전 누적분)
- **8개 지점 `senderPhone` → `01057028008` 통일** (임시, 알리고 발신번호 미등록 이슈). 원본은 `senderPhoneOriginal`에 백업
- **전 지점 noti_config on 플래그 동기화** (강남 → 타지점 7개)

### 앱 (v3.7.61 → v3.7.73)
- **이벤트 엔진 대개편**:
  - `customerQualify: {any, M, F}` 3컬럼 그리드 (성별별 자격 OR)
  - 쉐어 패키지는 조건 평가에서 제외 (본인 소유만)
  - `prepaidMinRatioPct` / `prepaidMinBalance` 컬럼별 객체
  - **바프권 qualifier 추가** (`barf`, 별도 임계값)
  - 결제방식 단순화: cash/card 3-seg
  - 레거시 필드 자동 마이그레이션
- **v3.7.62~64**: 매출확인 viewOnly sale_details prefill, 강조 mode 저장, 매출 전체편집 버튼 제거, 타임라인 설정 ESC/X 닫기
- **v3.7.65~66**: 매출 강조 구간 (테두리/채우기), 연간회원권 +99 제거
- **v3.7.67**: Haiku 번역 엔드포인트 연동, 대화보기 버튼 sel 강제 교체
- **v3.7.68~71**: 고객 자격 OR 그룹 + 성별 + 3컬럼 그리드 + 임계값 컬럼별
- **v3.7.72~73**: 이벤트 조건 쉐어 제외, 바프권 qualifier, 바프권 "30만" 만 단위 표시

### Supabase 장애 (KST 16:47 복구)
- REST API timeout → 유저가 프로젝트 Restart 버튼으로 복구
- 원인 추정: Small compute + `work_mem=5MB` + 대량 요청 동시성 (내 207건 백필 스크립트가 트리거)
- Postgres 로그 17분 공백 (07:31~07:47 UTC) → CPU/IO 포화

### 주의사항 (새 세션)
- **senderPhone 01057028008 통일 상태**: 각 지점 실제 번호로 환원하려면 알리고에 통신서비스 이용증명원 서류 인증 필요 (smartsms.aligo.in). 승인되는 지점부터 `senderPhoneOriginal` 값으로 복원 가능
- **알림톡 SMS 폴백 OFF** (`failover_1=N`): 카카오 배송 실패 시 SMS 안 나감. 의도적 설정
- **번역 토큰 비용 주의**: Haiku 써도 메시지 많으면 누적됨. Anthropic usage 체크

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
