# HANDOFF

## 🟢 [진행중·전담세션] 모담왁싱&래쉬 신규 업체 온보딩 (처음~끝) (2026-06-05)
> **이 항목은 별도 세션에서 모담 온보딩 전체를 전담 진행하기 위한 인수인계.** 두 번째 업체(하우스왁싱 외) 첫 케이스라, 새 업체 추가 표준 절차의 레퍼런스도 됨. 자족적으로 작성 — 이 항목만 읽고 이어받을 것.

### 업체 식별 정보
- **business_id**: `biz_id_yq41r06fdp` (업체명 "모담왁싱&래쉬 송파본점")
- **branch**: id `br_id_x316ludvqq`, short "모담왁싱"
- **네이버 스마트플레이스**: `naver_biz_id=1605478` (place 11682173, `?bookingBusinessId=1605478`). 운영자 위임 = 중앙 네이버 아이디 **cripiss**(서버 세션 NAVER_ID) + teraport에도 위임(언급). 세션 1개가 위임받은 전 업체 커버 — 모담 추가 세션 불필요.
- **카카오채널**: 이름 "모담왁싱&래쉬", 검색용 아이디 **`모담왁싱앤래쉬`**, URL `pf.kakao.com/_jqmQn`, 채널 관리 계정 `modam251201@naver.com`, 고객센터 `01058571712`, 카테고리 뷰티>피부관리.
- **원장**: 최로운 (팀채팅 표기). 멤버십 계정은 별도(추후).

### ✅ 완료된 것
1. **네이버 멀티테넌트 연동 (라이브)** — `naver_biz_id` 설정 + cripiss 위임. 30분 폴링 자동수집(예약 4건+리뷰 19건 모담 업체로 정확 INSERT 검증). 서버(`bliss_naver.py`/`review_sync.py`) 멀티테넌트 패치 완료 — 상세는 CLAUDE.md "신규 업체 온보딩 — 모담왁싱&래쉬 네이버 멀티테넌트 연동" 항목. 예약·리뷰·막기·확정 다 모담 스코프로 동작.
2. **v3.8.1 미배정 컬럼 fix (라이브, 커밋 `15c686a`)** — `TimelinePage.jsx:1955` `baseNaver = (br.naverEmail || br.naverBizId) ? (naverColCount||1) : 0`. naver_email 없이 naver_biz_id만 있는 모담도 미배정 컬럼이 기본 맨 왼쪽 생성. 하우스왁싱(이메일 있음) 무영향. ⚠️ **CLAUDE.md 변경이력에 v3.8.1 항목 미기재 — 새 세션이 추가할 것**(또는 모담 묶음 완료 시 함께).
3. **시술상품 40개 + 카테고리 7개 등록 (DB, 2026-06-05)** — `services`/`service_categories` INSERT 완료. 기존 테스트 카테고리("121321") 삭제.
   - 카테고리(sort): `sc_md_brz`(브라질리언) `sc_md_face`(페이스) `sc_md_body`(바디) `sc_md_ing`(인그로운 케어) `sc_md_foot`(발각질 케어) `sc_md_pkg`(패키지) `sc_md_pre`(정액권)
   - 시술 id `svc_md_001`~`svc_md_082` (브라질리언 001~006 / 페이스 010~019 / 바디 030~043 / 인그로운 050~052 / 발각질 060~061 / 패키지 070~071 / 정액권 080~082)
   - 필드 규칙: `price_f`/`price_m`=정상가, `member_price_f`/`member_price_m`=회원가(디자인/발각질만), `dur`=소요시간(분, 네이버 블록 자동매칭용), 한쪽 성별만 있는 시술은 반대 성별 NULL, 패키지=`is_package=true`+`pkg_count`, 정액권=`is_package=false`(충전형 선불권). `show_in_guide`는 대표 시술만 true(누드핏·비키니·풀페이스·겨드랑이·다리전체·풀바디·패디플레닝·3회권·5회권).
   - **소스 = 유저 제공 가격표 이미지 + 패키지 혜택안내 PDF** (`/Users/cripiss/Downloads/패키지 혜택안내pdf.pdf`).
4. **이벤트 4종 등록 + master ON (DB, 2026-06-05)** — `businesses.settings`에 jsonb merge(`settings::jsonb || {...}`로 plan/planExpiry 보존) `events` 배열 + `events_master_enabled=true`. PDF 금액 재검증 완료. 등록:
   - `evt_md_first_brz` 첫방문 브라질리언 할인 — `new_first_sale` / `discount_flat 22000 base:svc` / `categoriesAny:["sc_md_brz"]` (여 88,000→66,000 / 남 110,000→88,000, 카드 첫방문가. 현금 추가할인은 직원 수동)
   - `evt_md_prepaid_15` 정액권 15만 적립 — `prepaid_purchase` / `point_earn fixed 15000` (expiry 6mo) / `prepaidServiceIds:["svc_md_080"]` (→사용가능 165,000)
   - `evt_md_prepaid_30` 정액권 30만 적립 — `point_earn fixed 60000` (expiry 12mo) / `["svc_md_081"]` (오픈 더블 20%, →360,000)
   - `evt_md_total50` 토탈50 현금 적립 — `point_earn fixed 50000` / `["svc_md_082"]` + **`paymentMethodType:"cash"`** (유저 결정: 결제수단 현금 선택 시 자동 적용. 엔진 `eventEngine.js:272` + `SaleForm.jsx:1840 paymentUsesCash` 지원 확인)
   - **이벤트 밖(수동/회원가)**: 재방문 6주내 할인(시간 트리거 없음), 3회권 케어 50%·5회권 발각질 무료(차감형=직원 수동), 포토리뷰 시트팩, 브라질리언+단품 10%. → 원장에게 "수동 처리" 안내 필요.
5. **Pro 요금제 활성 — 오프라인 결제 (2026-06-05 사용 시작)** — 77,000원/월 오프라인(계좌/현장) 결제 완료. `businesses.plan='pro'`(컬럼) + settings.plan/planExpiry=2026-07-05 동기화 + `billing_subscriptions` 1행(지점 br_id_x316ludvqq, pro 77000 active, **auto_renew=false, billing_id=null** = 하우스왁싱 오프라인 패턴). `settings.features` 키 없음 → plan='pro'로 PRO 전기능 자동 derive(extractFeatures). 다음 결제 2026-07-05 **수동**(토스 빌링 계약 활성화 + 모담 카드 등록 전까지 auto 청구 X). trial(~6/19)에서 전환.

### ⏳ 남은 일 (새 세션이 진행)
**B. 카카오 알림톡 (유저가 senderKey+발신번호 받아오면 시작)** — 발송 코드는 이미 멀티테넌트(`alimtalk_thread`가 `branch_id`로 noti_config 읽음). **모담 noti_config 현재 비어있음**(aligoKey/senderKey/tplCode 전무 → 발송 skip 상태).
   - 유저가 줄 것: 모담 **senderKey**(알리고 카카오 발신프로필 연동 후 발급, 카카오채널 비즈니스 인증 선행) + 모담 **발신번호**(SMS 발신용 등록번호). 알리고 계정은 cripiss 재사용(aligoKey/aligoId 동일).
   - 받으면 새 세션이: ① 하우스왁싱 템플릿들(rsv_confirm 예약확정 / rsv_1day 전날 / rsv_today 당일+차트링크 / 케어 / point_expiry 포인트소멸 / consent_doc 동의서 / chart_doc 차트)을 **모담 senderKey로 알리고 API 재등록+검수 제출** (알리고 API는 서버 IP에서만, Mac은 -99 / 스크립트 패턴 `/tmp/aligo_*.py` 서버에서 / 응답 code 문자열 "0"=성공 / 버튼은 까다로우니 본문 링크 방식) ② 검수 승인(3~5영업일) 후 모담 `branch` noti_config에 `aligoKey`(cripiss)/`aligoId`(cripiss)/`senderPhone`(모담)/`senderKey`(모담)/각 키별 `tplCode`+`msgTpl` 입력 → 멀티테넌트 코드라 바로 발송.
   - 알림톡 검수 대기 동안 SMS는 senderPhone만 있으면 즉시 가능(send-sms는 발신번호만 필요).

**C. 시술상품 검수/조정** — 원장이 시술상품관리에서 첫방문/재방문가·소요시간·회원가 확인·조정. (네이버 예약 시술 자동매칭은 services 등록됐으니 신규 예약부터 이미 동작.)

**D~H. 선택/후속**:
   - D. 건물정보 `branches.access_info` 입력(AI 길안내, 관리설정→예약장소). E. 결제 PG(토스 가맹 — 예약금/포인트, 필요시). F. 직원 근무표·멤버십 계정(원장 최로운 등). G. RAG 학습문서(모담 FAQ/스킨케어 별도 인제스트 — `gemini-embedding-2/768`, 하우스왁싱과 동일 공간). H. 카카오채널 챗봇 메뉴(가격안내/내보유권조회 mypage 등 — 하우스왁싱처럼 선택).

**I. 네이버톡 모담 연동 — 서버 완료, 파트너센터 마무리 대기 (2026-06-06)**: 톡톡은 챗봇 API webhook 방식(`/naver-talk/<account_id>`). 파트너센터 경로 = **계정관리 홈 → 연동 관리 → 챗봇 API 설정**(`/web/accounts/{acc}/devtools/chatbot-api`). 모담 값: **account_id `103364134` · handle `wlw2lme` · auth `/J4ld9K+QlqnNBCLL/bs`**. 서버 `bliss_naver.py NAVER_TALK_ACCOUNTS`에 모담 추가 완료(+`business_id`=biz_id_yq41r06fdp·`bid` 필드 신설, echo/수신 insert를 `_talk_biz`로 per-account 저장 → 하우스왁싱과 안 섞임). open 이벤트 테스트로 인식 확인. **⏳ 정우님 파트너센터 마무리**: ① 이벤트 받을 URL=`https://blissme.ai/naver-talk/103364134` 저장 ② 이벤트 send,open ③ 커스텀챗봇에디터(챗봇1) OFF. **권장 후속: NAVER_TALK_ACCOUNTS를 DB로 이전**(현재 하드코딩, 새 매장마다 서버 수정). 모담 `naver_place_id/seq/email` 비어있음(예약·리뷰는 동작).

**J. 직원 근무표 / 기존 데이터 이전 (온보딩 폼으로 수집 시작)**: `onboarding.html`이 직원(이름·직급·근무시간·휴무요일)·이전 프로그램 고객/매출/보유권(엑셀 업로드)을 받음 → 제출(`onboarding_submissions.payload.staff/legacy` + storage). 받으면 employees_v1·고객·매출 import 세팅.

### ✅ 입금문자 안드로이드 앱 (완료, 2026-06-05)
맥 chat.db 스크래핑 대체. 앱=입금SMS만 전달, 서버=중앙파싱. 상세 memory [[reference_bliss_deposit_app]].
- **APK 라이브**: https://blissme.ai/bliss-deposit.apk (debug-signed) / 설치안내 https://blissme.ai/deposit-app.html
- 서버 `/bank-deposit-sms`(KB·하나·수협·우리 파싱) + `bank_sms_tokens`(RLS잠금+`bank_sms_token_lookup` RPC). 앱 소스 `/Users/cripiss/TP005/bliss-deposit-app/`(Kotlin, `./gradlew assembleDebug`; JAVA_HOME=openjdk@17, ANDROID_HOME=/opt/homebrew/share/android-commandlinetools).
- 모담 토큰 `bsms_98ac341c04c2476c981bd8c2386df0c1`. 새 매장=토큰 발급(bank_sms_tokens INSERT)→앱에 입력.

### 새 업체 추가 표준 절차 (이 케이스로 확립 — 향후 레퍼런스)
① 중앙 네이버 아이디(cripiss/teraport)에 그 업체 스마트플레이스 **운영자 위임** → ② branch `naver_biz_id` 설정(코드 추가 0, 이미 업체별 스코프) → ③ **시술상품(services)+카테고리 등록**(네이버 매칭·AI 가격·매출) → ④ 카카오 **알림톡 senderKey 연동 + noti_config** → ⑤ **이벤트**(settings.events) → ⑥ 직원/멤버십 계정. 서버 멀티테넌트는 `_load_ai_settings(business_id)`·`_process_one` `_biz_id` 파생·`db_upsert` business_id·review_sync `sync_branch(business_id)`로 이미 업체별 분리됨(CLAUDE.md 참고).

---

## ⏳ [PENDING] 외국인 영어 알림톡 — 카카오 승인 후 wiring (2026-06-05)
**SMS는 완료·라이브** (케어·포인트 외국인 영어 발송 중). 알림톡 영어 24종 **검수 제출 완료, 카카오 승인 대기(3~5영업일)**. 승인되면 아래 2가지:
1. **noti_config에 tplCodeEn+msgTplEn 주입** (8지점 × rsv_confirm/rsv_1day/rsv_today). tplCode 매핑(강남/마곡/왕십리/용산/위례/잠실/천호/홍대):
   - rsv_confirm: UI_4318~4325 / rsv_1day: UI_4326~4333 / rsv_today: UI_4334~4341
   - msgTplEn = 등록한 영어 본문(CLAUDE.md 참고, rsv_today는 본문에 `https://sign.blissme.ai/?t=#{차트토큰}`)
   - `process_item`은 이미 `tplCodeEn` 지원 → 주입만 하면 외국인+알림톡 자동 영어.
2. **채팅 리마인더 중복 제거**(정우님: 알림톡 우선): `_send_chat_reminders`에서 한국폰 외국인이 영어 알림톡 받을 예정(noti에 tplCodeEn 존재)이면 채팅 리마인더 스킵. **tplCodeEn 게이트** → 승인 전엔 채팅 영어 유지.
- 승인 확인: 알리고 콘솔 또는 `template/list` API. 상세 = CLAUDE.md "외국인 고객 영어 SMS/알림톡" 항목.
- 서버 전용(React 0) — wiring도 DB(noti_config)+`_send_chat_reminders` 패치만, 버전업·배포 무관.

---

## ⚠️ [메인 세션에게] v3.7.986 버전 충돌 — 차트(B)가 너희 986 위에 섞임, 정합 완료 (2026-06-04)
> **동시 작업 충돌이 또 났습니다. 두 세션이 같은 메인 폴더에서 bliss-app을 동시에 배포 중 → 한 세션만 배포하도록 조율 필요.**

### ✅ 메인 세션 확인 완료 (2026-06-04)
- 로컬 HEAD == origin == `13baf59`(같은 폴더라 pull 불필요·이미 동기화). working tree clean(mockup/만).
- `BLISS_V=986`==`version.txt=986`==라이브 986, **라이브 번들 `index-DROY-fnb.js` == 현재 소스 재빌드 해시** → 메인 충전/빌링(94f4ac3) + 차트(e54b98c) **둘 다 라이브 반영, 유실 0**.
- ④ **CLAUDE.md에 차트 변경이력 기재 완료** (e54b98c 전문 → "v3.7.986 후속(B)" 항목으로 옮김).
- **재배포·재커밋 불필요**(이 doc 커밋만). 차트 UI 라이브 스팟체크는 정우님 권장(예약 열기→"차트"→단일카드, 앱 켜둔 직원은 새로고침 1회).
- 타임라인: 동의서 세션이 정우님 지시로 차트 발송 UI(B)를 만들던 중, 메인 세션이 `94f4ac3 v3.7.986(충전/빌링)`을 커밋·배포. **차트 변경이 미커밋 상태로 986 빌드에 섞여 라이브에 나감.** (메인 충전/빌링 코드는 그 빌드에 포함돼 **유실 0**.)
- **정합 처리**: 987 재bump는 너희와 또 충돌나서, 차트 변경을 **986 후속 커밋 `e54b98c`로** 묶음. **현재 라이브 == git == version 986, 메인 충전 + 차트 둘 다 반영.** 서버 번들 `index-DROY-fnb.js`에 차트 문구 포함 확인.
- **메인 세션 할 일**: ① `git pull`(origin=`e54b98c`, 차트 커밋 포함) ② **재배포 불필요**(라이브 이미 일치) ③ version.txt가 986→986이라 **이미 앱 켜둔 직원은 새로고침 1회 해야 차트 UI 반영**(원하면 다음 배포 때 자연 반영) ④ CLAUDE.md에 차트 변경이력 **미기재**(너희가 986 항목 동시편집 중이라 충돌 피해 건드리지 않음) → 커밋 `e54b98c` 메시지에 전문 있음, 원하면 CLAUDE.md에 옮겨줘.
- **차트(B) 내용**: 예약모달 "차트 보내기" 발송모달(`ConsentModal`)을 차트 모드일 때 체크박스 2개 → 단일 카드(신규=신규차트+오늘관리 / 기존=오늘관리만 자동 안내). `sendKind` prop, 동작·동의서앱·서버 당일링크 무변경. 빌드만 검증(데모 템플릿0·실사업장 로컬로그인불가로 화면 미검증 → **라이브 스팟체크 권장**: 예약 열기→"차트"→단일카드).

---

## ⚠️ [메인(배포) 세션에게] 비-메인 세션이 v3.7.984·985 직접 배포함 — git pull 먼저! (2026-06-04)
> **이 두 건은 배포세션(메인 폴더 전담)이 아니라 다른 세션(원래 consent/동의서 작업 중이던 세션)이 bliss-app 메인 폴더에서 직접 빌드·서버배포·CF퍼지·푸시했습니다.** 세션 경계(배포는 메인 세션만)를 넘은 것 — 기록 남깁니다. 되돌릴 수 없게 이미 라이브+git에 반영됨.

### ✅ 메인(배포) 세션 확인 완료 (2026-06-04)
- 동의서 세션이 **같은 메인 폴더에서 직접 작업**해서 로컬 HEAD가 이미 `6819639`(==origin/main). **별도 체크아웃이 아니라 pull 불필요였음** (위 "2커밋 뒤처짐"은 별도 폴더 가정).
- 전부 일치 확인: 로컬HEAD==origin, `BLISS_V=3.7.985`==`version.txt=3.7.985`==라이브 3.7.985, **라이브 JS 번들 `index-q75fIB8-.js` == 현재 소스 재빌드 해시**(984/985 코드가 실제 라이브에 반영됨, version.txt만 올린 사고 아님). working tree clean(mockup/ untracked만).
- **재배포·재커밋 불필요.** 끝.

### (원문) 메인 세션이 지금 해야 할 일 (순서대로) — 위에서 확인 완료, 참고용
1. ~~`git status` 후 커밋 안 된 작업 stash/commit~~ → clean.
2. ~~`git pull origin main`~~ → 같은 폴더라 이미 동기화.
3. **재배포 불필요** — 라이브·git·version.txt 전부 **3.7.985로 일관** ✓.

### 무엇이 바뀌었나 (커밋 `9519b8d` 984, `0ac7cfd` 985)
- **v3.7.984 — 요금제 "지점별 잔액+사용량" 섹션 게이트 fix** (`src/components/Admin/AdminPlan.jsx`): 섹션 게이트 `balances.length>0` → **`branches.length>0`**. **충전 한 번도 안 한 테넌트(데모·모든 신규)는 `billing_balances` 0행이라 섹션 통째 숨겨져 "+충전"·"월 이용료 카드 등록" 버튼이 안 보이던 닭-달걀 버그.** 지점만 있으면 0P·미가입·무료로 graceful 노출(충전 버튼=isMaster, 환불 버튼=잔액>0). → 정우님이 데모에서 "충전 버튼 왜 안 보이냐 바로 처리해" 한 게 발단. **로컬 dev server 데모 로그인 → 버튼 노출 시각 확인 완료.**
- **v3.7.985 — 공지&요청 배지 테넌트 전환 stale fix** (`src/pages/AppShell.jsx`): 수정요청 pending 배지 useEffect deps `[]` → **`[currentBizId]`** + 전환 진입 시 `setPendingReqCount(0)` 즉시 초기화 + `load` null-guard + Realtime 채널명 `requests_badge_{currentBizId}` biz별 분리. **로그아웃→데모 로그인 시 직전 사업장(실제 biz `bliss_requests_v1` pending 2건)이 데모(0)에 최대 120초(폴링주기) stale로 남던 버그.** 데모/실제 데이터는 SQL로 0/2 확인. (build+로직 검증 — 기존 hook/변수만 수정, 새 hook·import 0. **라이브에서 데모↔실제 전환 시 배지 즉시 0 되는지 스팟체크 권장.**)
- 둘 다 상세는 **CLAUDE.md 변경이력 v3.7.984 / v3.7.985** 참고.

### 주의
- 이번에 건드린 파일: `AdminPlan.jsx`, `AppShell.jsx`(BLISS_V 985 포함), `public/version.txt`, `CLAUDE.md`, `HANDOFF.md`. **진행 중이던 다른 작업과 같은 파일이면 pull 후 머지 확인.**
- 메인 폴더에 임시 `mockup/`(git ignore 대상, 직원 이동팝업 시안용)는 커밋 안 함 — 무시.
- 앞으로 bliss-app 배포는 메인 세션이 전담. (이번 건은 consent 세션이 데모 화면 디버깅하다 정우님 "바로 처리해" 지시로 진행됨.)

---

## ✅ [동의서 세션 인계] 처리 완료 (v3.7.983, 2026-06-04)
> 인계 5건 점검·처리 완료. 상세 CLAUDE.md v3.7.983.
> - #1 목록(is_active 자동필터, 활성 신규차트v3+컨디션v3 2개만) ✅확인 / #2 컨디션 id v3(앱 하드코딩 0, 동의서앱 소관) ✅해당없음 / #3 속눈썹 자동선택(없음) ✅해당없음 / #4 무료대여=신규차트1회서명 ✅정우님 OK / #5 **"차트" 원클릭 프리셋 구현**(ReservationModal: 활성 차트 폴더 템플릿=신규차트+컨디션 자동선택, 신규/기존은 동의서앱 자동). 산모(ct_maternity_v3) 미변경(별도).

## 🔔 [동의서 세션 인계 원문] 컨디션/속눈썹 차트 통합 (2026-06-04) — 처리완료, 참고용 보존
> 동의서 앱(bliss-consent) 세션에서 공유 DB(consent_templates)를 정리함. **발송 모달·번들 로직은 메인앱 소관**이라 확인/조정 필요.

### 동의서 세션에서 한 것 (DB, 이미 라이브 — 추가·이름변경·is_active뿐, 기존 서명기록 영향 0)
- **신규차트(ct_consent_full_ko_v3)**: 서명 단계에 「무료 대여 서비스 주의사항 동의」(마사지기·눈안마기·온열팩 저온화상 면책) + `agree_rental` 필드 **이동**(컨디션에서 가져옴) → 신규 고객이 1회 서명. + 문진에서 「8.음모 전체 제거」(full_removal) **제거**(컨디션 음모스타일 '누드핏=전부제거'와 중복) → 「외국인」을 8번으로 당김. + 유입경로(referral) 옵션 정리(네이버검색·인스타그램·구글검색·지도검색·지인소개·기타[직접입력]).
- **컨디션 체크리스트(ct_condition_v3)**: **서명 단계 제거**(이제 오늘관리+오늘컨디션 2스텝, 서명 없음 — 서명은 신규차트로 이동). care_type("오늘 어떤 관리")에 **「속눈썹 펌」 추가** + 선택 시 속눈썹 문진(펌경험·예민·눈상태·금기·컬·롯드)이 show_if로 따라붙음.
- **ct_condition_light_v3**: v3와 동일하게 맞춤(서명없음+속눈썹) + **is_active=false**(발송 모달에서 숨김).
- **ct_eyelash_ko_v2 (속눈썹 펌 신규차트)**: **is_active=false**(발송 모달에서 숨김) — 속눈썹은 컨디션 "오늘 관리"에 통합됨.

### 메인앱에서 확인/할 일
1. **발송 모달(ConsentModal) 목록 확인**: 「신규차트&체크리스트」 폴더에 이제 **신규차트 + 컨디션 체크리스트 1개**만 떠야 함(중복 컨디션·속눈썹 펌 신규차트 사라짐). is_active로 자동 필터되니 코드 변경 없이 반영될 것 — **확인만**.
2. **컨디션 번들 template_id 점검**: 재방문/신규 고객에게 동의서 보낼 때 어떤 컨디션 id를 묶는지 확인 → **ct_condition_v3로 통일** 권장. (light는 비활성·v3와 동일하게 맞춰뒀지만, id로 자동 번들하는 코드가 light를 가리키면 v3로 변경.) **임신 분기(ct_condition_v3 → ct_maternity_v3 swap)가 v3 기준**이라 v3로 보내야 산모 차트 전환 정상 동작.
3. **속눈썹 고객 발송**: 별도 "속눈썹 펌 신규차트" 없어짐 → 신규차트 + 컨디션(고객이 "오늘 관리"에서 속눈썹 펌 선택)으로 안내. 메인앱에 속눈썹 전용 차트 자동선택 로직 있으면 제거.
4. **무료 대여 주의사항 = 신규차트 1회 서명**으로 바뀜(재방문은 컨디션에 서명 없음). 정책 OK인지 확인 — 재방문 고객은 과거 컨디션 서명분으로 커버, 신규는 신규차트에서 서명.
5. **★ "차트 보내기" 버튼 하나로 통일 권장 (2026-06-04 동의서앱 라이브)**: 동의서 앱이 이제 **기존 고객(visits>0 또는 신규차트 작성기록)에게 신규차트를 자동 스킵**(컨디션만 렌더)하도록 구현됨(App.jsx 토큰 로드 시 visits 조회→번들에서 '신규차트' 제외). 따라서 ConsentModal에서 직원이 신규/기존을 매번 고를 필요 없이 **"차트 보내기" 한 번 = [신규차트+컨디션] 항상 전송**하면, 신규는 둘 다·기존은 컨디션만 자동 분기됨. ConsentModal을 그 방향(원클릭 프리셋)으로 단순화 권장.

### 산모(ct_maternity_v3)는 미변경 (별도 판단 대기)
- 산모 컨디션은 구조가 다름(산모님정보+컨디션+추가구매·서명, care_type 없음) → 속눈썹 통합·서명제거 미적용. 임신+속눈썹 케이스는 드물어 보류. 필요 시 동의서 세션에 요청.

---

## 🆕 네이버 리뷰 답글 시스템 + 구글 GBP 신청 (2026-06-01~02) ★다음 세션 핵심★
> 상세 시스템 구성은 memory `reference_bliss_naver_reviews` / `reference_bliss_google_gbp` 참고.

### 네이버 리뷰 (받은메세지함 '리뷰' 탭)
- **전부 라이브 배포 완료(v3.7.965~976)**: 리뷰 탭·수집(booking 방식)·답글등록·배지(has_reply=false·10분폴링)·바로가기·AI톤 few-shot(따라읽기 차단)·20대 여직원톤·이모지금지·응원형 시제·최근 매출메모 안부거리·등록 시 배지 즉시 -1·AutoTextarea·"네이버에 등록" 버튼·방문자명→예약 포커싱·AI 답글모델 gemini-3.5-flash. (이전 "미배포" 메모는 해소됨)
- **서버(이미 적용·재시작됨, git 미추적 `/home/ubuntu/naver-sync/`)**: `review_sync.py`(신규, 답글없는것+최근30일, 10분), `bliss_naver.py`(`/review-reply`·`/review-sync-now`·`_gbp_api_approval_checker` 스레드), `review_query_booking.graphql`·`review_reply_mutation.graphql`, nginx location에 review 경로 추가
- placeId(플레이스 전체 리뷰)는 강남만 권한·7지점 "플레이스 권한없음" → **booking(예약연동 리뷰) 방식으로 8지점 통일**

### 구글 GBP 리뷰 — API 승인 대기
- 승인 신청함 **case 5-2636000040443** (7~10영업일, `housewaxing@gmail.com` 메일). Cloud 프로젝트 `bliss-gmail-push`(37640356601), 강남점으로 신청
- 승인 메일 자동감지 → **텔레그램 알림 스레드 가동중**(`_gbp_api_approval_checker`, 24h 체크, 첫 체크 재시작+1h)
- **승인 후 할 일**: GBP API 8개 활성화 + OAuth(housewaxing 계정) + 서버 수집(`reviews.list`)/답글(`reviews.updateReply`) 엔드포인트 → `naver_reviews`에 `source='google'` 통합

### ⚠️ 워크플로우 사고 메모
- 이 작업 초반 worktree 전환 전 **main 폴더에서 직접 작업** → 메인 세션 v3.7.945 커밋에 네이버 리뷰 코드 혼입·배포됨(다행히 파일 안 겹쳐 무손상). 이후 worktree(`naver-review-rollout`) 전환했으나 일부 Edit가 main 절대경로로 감. 다음 세션은 worktree/main 경로 주의.

---

## 📌 현재 라이브: v3.7.983 (https://blissme.ai/version.txt) — 2026-06-04
> v3.7.982 받은메시지함 'AI 미룬 문의 확인 필요' 배지/필터 + v3.7.983 동의서 '차트 보내기' 원클릭. 상세 CLAUDE.md 변경이력. 미배포 bliss-app 코드 없음.

## 📌 (이전) 라이브: v3.7.976 — 2026-06-03
> v3.7.965~976 + 서버(ai_booking/bliss_naver) 변경 상세는 CLAUDE.md 변경이력 참고. 미배포 bliss-app 코드 없음(동기화 완료).
> **남은 내 영역 1건**: 희서 id_6f3bsl54sx — 체크리스트/신규차트 알림톡 문구 "구매하신 상품 관련" 분리 = ConsentModal 문서종류별 템플릿 분기 + **신규 카카오 템플릿 검수(3~5일) 필요**라 즉시 배포 불가(reviewing). 수연·경아 요청은 동의서앱(consent) 영역.

### ✅ 이번 세션 완료 (2026-06-01) — v3.7.939~964 (상세 CLAUDE.md 변경이력)
- **v3.7.958** 직원 타지점 이동 시 원지점 근무 사라짐 **버그 fix** — `normalizeSegments` wh null 안전접근(segHoursOf 미설정 시 TypeError→sort 파괴→from/until=null→hasActiveSeg=false). ⚠️ **라이브 확인 권장**: 현아(홍대→강남16:20이동) 오늘 날짜에서 홍대 직원이름 뜨는지.
- **수정요청 처리**: 콜라보 인플루언서 첫 답변 즉시 자동응답 OFF(서버 ai_booking, 마케팅팀 직접) + 만료일 빠른연장 버튼([+6개월][+1년][+2년], v3.7.957). **남은 요청**: ①·② 직원 타지점 이동 시 원지점 근무 사라짐(getEmpActiveSegments 종일 home세그먼트 미처리, v3.7.907 회귀 — **집중 세션 필요**) ⑤ 차트별 알림톡 멘트(템플릿 검수) ④·⑦ consent 위임.
- **v3.7.956** 매출 통계/관리 **디폴트 기간 = 이번 달 1일~말일**(정우님 "이번 달 한 달"). 마운트 시 periodKey=month면 1일~말일 강제(기존 세션 단일날짜 교정). 라벨 "6.1~6.30".
- **v3.7.955** 구독권 **회원가 자격 부여 연동** — 구독권 상품 `grants_member_price` ON 시 보유 고객이 무료대상 외 시술도 회원가 적용(`_subGrantsMember`). validPkgs 미포함 유지(우측 "+99회" 부작용 방지). 정우님 토글로 "정상가"→"회원가" 정책 전환.
- **v3.7.954** 블리스 AI 플로팅 버튼(✨) **임시 숨김**(`AppShell {false&&<FloatingAI/>}`) — 팀채팅 공지 발송 버튼 가림. ⏳ **후속: 위치 조정 후 복구 필요**(false→true).
- **v3.7.953** 네이버 "답글쓰기" 버튼 URL → 모바일(new-m) + `hasReply=false&menu=visitor`(미답변만 필터된 상태로 오픈). 작업세션 머지.
- **v3.7.952** 네이버 리뷰 미답변 배지 로직 정리(작업세션 머지) — 배지=`has_reply=false` 카운트(is_read 무관), 탭 열어도 안 꺼지고 실제 답글 수집 시에만 감소. NaverReviews onReviewChange/읽음처리 제거 + AppShell 배지 쿼리·폴링 10분.
- **v3.7.951** 구독권 카드 **테두리 제거**(배경색만) + **무료 적용 타이밍 버그 fix**(보유권 로드 전 시술 체크 시 무료 누락 → subFreeSvcIds 갱신 useEffect로 자동 보정).
- **v3.7.950** 예약모달 구독권 pill "무제한"→**유효기간 날짜**(`~2027-05-05`) 표시(정우님 "차라리 날짜를 써").
- **v3.7.949** 구독권 **표시 보강** — 매출입력 화면에 "구독권 보유 · {무료시술} 무제한 무료 (유효~날짜)" 카드(직원 인지) + 예약모달 보유권 pill "99회"→유효기간 날짜. 박현지님 라이브 무료 미적용은 구버전 캐시 원인(새로고침으로 해결 확인).
- **v3.7.948** 🎟 **구독권 신규 기능** — 보유 시 지정 시술(순수 브라질리언) 유효기간 내 **무제한 무료**. 회원권(annual)과 분리한 새 종류 `subscription`. 상품관리 "구독권" 토글+무료시술 다중선택+유효개월 / 매출등록 자동 0원("구독권 무료" 배지·원가 취소선) / 첫 무료 사용 시 유효기간 그날+1년−1일 시작 / 회원가 자격 X / 그 외 시술 정상가. `services.is_subscription`+`promo_config.subFreeServiceIds/subMonths`. **강남 구독권 상품(d8b8dd02) 설정 완료**(브라질리언 무료, 12개월) → 신규 판매부터 작동. 로컬 검증(데모) PASS. 상세 CLAUDE.md.
- **v3.7.939** 월별 매출 비교표 **전년 동월 대비 성장률**(주식색: 상승 빨강 `#e2231a`/하락 파랑 `#1565d8`) + **월별 고객수 비교표 신설**(신규/기존/외국인, 매출발생 기준, custTrend p_months 120·그래프는 slice(0,13)).
- **v3.7.940** 고객정보 저장 UX — 고객관리 onBlur 자동저장+"저장됨✓" 토스트(savedFlash) / 예약모달 "변경"→**"정보 저장"**(예약저장과 분리, commitBtn.click 제거) + 예약저장 onClick에 `if(editingCust) _persistCustEdits()` 보장(전화 저장 누락 fix).
- **v3.7.941 + 서버** **크리에이트립 받은메시지함 제외**(손님 메신저ID(`sns_id`)를 chat_channel로 저장→카톡 대화방 오표시. 서버 크리에이트립 chat_channel/chat_user_id 빈값 + 클라 chatResMap `source==='creatrip'` 제외 + 기존 6건 chat_* NULL) + `_send_booking_confirm` 손님 언어 분기(영어손님 영어 확정카드).
- **v3.7.942 + 서버** **AI 답변추천 '직원 지시 모드'** — 입력칸에 한국어 지시("홍대점 주소 알려줘")+[AI 답변 추천]→고객 언어로 작성·입력칸 채움. `ai_booking.py` `instruction` param(reply_lang 손님 메시지 기준+user_msg 지시블록 변환), `/ai-suggest` instruction 전달, `genAI` body `instruction:(reply||"").trim()`. 매장 주소는 [지점] 실제값만.
- **v3.7.943** **자주답변 지점별 분리**(`quick_replies_v1` 항목에 `branchId`, 표시=userBranches 포함/공용. 등록 폼에 지점 select) + **8지점 지점정보 한/영 16개 등록**(주소·전화·영업시간·교통·네이버/구글지도) + 용산 기존 3개 branchId 부여(총 19개) + 직원 공지.
- **v3.7.944** 패키지 미사용 검토 페이지 삭제(AdminPkgUnusedReview, 참조 전부 정리).
- **v3.7.945** 발송내역(알림톡/SMS/직원SMS) **이번달/지난달 필터** + 디폴트 이번달(AdminSmsLog·AdminAlimtalkLog `days` 'this'|'last'|숫자). 강남 id_v8cy7gh2d0 done.
- **v3.7.946~947** **요금제&사용내역 정돈**: 직원SMS 탭을 "발송 내역"에 통합(처음 서브탭 → 정우님 "한페이지로" 재요청 → **서브탭 제거하고 AdminAlimtalkLog 한 목록에 sms_send_log 병합**, channel='sms'/noti_key='직원발송'/params._staff_msg 정규화) + **`sms_send_log` RLS 정책 추가**(0건 원인=RLS활성+anon정책없음, `anon_all_sms_send_log`) + 탭/제목/통계 이모지 제거.

### 🟡 확인 대기 (정우님 — 다음 세션 이어받기)
- **⚠️ 박현지님(#32685) 구독권 데이터 정정** — 기존 구독권 2건이 쿠폰(`cpn_`)·99회·`service_id=null`·만료(2026-05-07)로 깨져 있고 5/6 구매분(110만)은 보유권 미등록 → 현재 무료 적용 안 됨. **정정 필요**: 5/6분을 구독권 보유권(`service_id=d8b8dd02`)으로 등록 + 깨진 2건 정리 + 메모 "27/05/05까지" 유효기간 해석(정책=첫 사용+1년이지만 이미 사용 중·수기관리). **라이브 실데이터라 정우님 확인 후 진행.**
- **구독권 후속 보강(선택)**: ① 고객 상세 보유권 탭에 구독권 "무제한·유효기간" 전용 표시(현재 annual로 분류돼 대략 표시됨) ② 데모 김서연 테스트 보유권(`pcd_demo_sub_test`) 정리 여부 ③ 같은 매출에서 구독권 사고+바로 무료사용(현재 기존 보유분만 무료, 신규구매분은 다음 방문부터).
- **직원 SMS 목록 "결과·메시지" 칸 메시지 표시** 확인 — 통합 후 직원 SMS(`params._staff_msg`)가 목록 메시지 칸에 잘 뜨는지. 비어 보이면 `AdminAlimtalkLog` 목록 렌더에 `_staff || _staff_msg` 표시 분기 추가 필요(렌더는 alimtalk_queue params 기준이라).
- **자주답변 지점정보 영문 주소** 정확성 — 도로명 로마자 직접 번역이라 실제 표기와 다를 수 있음(자주답변 [관리]→수정 가능).
- **인스타 App Review** — Meta 검수 대기 중(5/26 제출, 콘솔 "검토 진행 중" 확인됨). 승인되면 24h+ 인스타 손님 능동 발송 자동(서버 코드 준비됨). 로그상 5/28까지 403, 5/29+ 24h밖 케이스 없어 로그론 승인 확인 불가 → Meta 콘솔(Bliss Messaging appId 1591870165413712 → App Review)에서 직접 확인.
- 메모리 신규: `feedback_bliss_custom_dialogs`(경고·확인창은 커스텀 디자인 모달, native alert/confirm 금지).

---

## ✅ 완료 — 커플룸 자동 동반자 (정우님 "전부 다", v3.7.918~919) — 상세 CLAUDE.md
- **① 앱 (v3.7.918)**: 커플룸 태그 체크 시 신규·기존·모바일 무관 동반자 자동 2건 (handleSave isNewItem 제거 + exists 경로 동반자 INSERT).
- **② 서버 `ai_booking.py`**: AI 채팅예약 커플 감지(프롬프트 룰#15+`couple` 필드) → 커플룸태그+동반자 INSERT+reservation_groups. 검증 직접·end-to-end PASS. 백업 `bak_pre_couple_20260530_141815`.
- **③ 모바일 동반자 버튼 (v3.7.919)**: ReservationModal footer "동반자 추가" 버튼(PC·모바일) — TimelinePage `addCompanion()`로 Ctrl 드래그 복사와 동일 규칙(같은 시간·관리사·시술, cust 비움, group 묶음, 결제·로그 끊김). 일반(다인원) 동반자 수동 추가용. 검증 로컬 데스크탑·모바일 PASS.
- ✅ **별개 버그 fix**: ai_booking.py ai-suggest out `_h_noct` NameError → ai_booking_agent 스코프 정의 추가. 답변추천 out['booking'] 복구. (spawn_task chip은 dismiss 가능)

## 공지&요청 처리 (2026-05-30)
- ✅ **id_7g8h69xga7 정우님** (82 국제번호 한국고객 알림톡 미발송) — v3.7.923: 발송 시 +82→010 자동 정규화(앱 `toKrMobile`+queueAlimtalk+가드4곳 / 서버 alimtalk_thread+care_sms). 저장값 무변경. done. ⚠️ 서버 rsv_today/1day reminder 진입가드 82 차단여부 미점검(추가 대상).
- ✅ **id_3po2ckyzmj 신영** (커플룸 모바일 동반자) — v3.7.918~920 완료. done+답글.
- ✅ **id_p46r9t7dpd 강남** (노쇼 페널티 이력) — v3.7.921: 선불권/다회권 차감을 `package_transactions`에 기록(매출 sales는 기존부터 됨). done+답글.
- ✅ **id_rhh0b4expr 신영** (상담창 열어도 미응답 배너 안 사라짐) — **실제 버그**(처음 동작설명으로 오판, 정우님 "버그다" 지적). v3.7.922: `markRead`(대화 읽음) 직후 `onRead`가 배너 카운트(`unreadDelayedCount`)를 즉시 재계산하도록 `loadUnreadRef` 연결. 기존엔 Realtime/120초 폴링 의존이라 안 사라짐. done. ⚠️ 라이브 시각 확인 권장(데모 미읽 0).
- 🟡 **id_yuorqmcv48 소이** — ⓐ"페이스 추가"=차트·동의서(정우님 확인) → **consent 앱 위임(spawn_task)** / ⓑ외국인 번역 영/한 버튼=메시지함 번역 토글(자동/영어/끄기) 이미 존재 → 현 기능 안내 + 정확한 니즈 되묻기 답글. status=reviewing(consent 작업 + 니즈 확인 대기).

## 현재 버전
- **라이브: v3.7.925** (https://blissme.ai/version.txt) — 포인트 충전·환불을 지점 원장(manager)도 가능 + 계정별 자기 지점만(`AdminPlan` isOwner→isMaster, branches userBranches 필터). 정우님 "각 지점이 알아서 충전, 계정별로". 토스 충전 ENV(v3.7.924) 설정 후 manager 계정에 충전 버튼 미노출이던 것. 상세 CLAUDE.md v3.7.925.
- **라이브: v3.7.924** (https://blissme.ai/version.txt) — 전화번호 **저장** 정규화: +82 한국모바일(820/821) → 010. 기존 데이터 일괄(Flora·Loula 등 customers·reservations) + 앱 `db.js toDb("customers")` + 서버 자동생성 6곳(`_kr_mobile`). 발송 정규화(v3.7.923)와 합쳐 저장·표시·발송 모두 010. 정우님. 상세 CLAUDE.md v3.7.924.
- **라이브: v3.7.923** (https://blissme.ai/version.txt) — 알림톡/SMS 발송 시 +82 한국번호 → 010 자동 정규화(앱 `toKrMobile`+queueAlimtalk+가드 / 서버 alimtalk_thread+care_sms). 채팅(WhatsApp) 82 고객도 발송. 정우님 id_7g8h69xga7. 상세 CLAUDE.md v3.7.923.
- **라이브: v3.7.922** (https://blissme.ai/version.txt) — 미응답 배너 안 사라지는 버그 fix: 상담창 열어 읽으면(markRead) 배너(unreadDelayedCount) 즉시 재계산되도록 `loadUnreadRef` 연결(기존 Realtime/120초 폴링 의존 → 즉시). 신영 id_rhh0b4expr. 상세 CLAUDE.md v3.7.922.
- **라이브: v3.7.921** (https://blissme.ai/version.txt) — 노쇼·취소 페널티로 선불권/다회권 차감 시 보유권 거래내역(`package_transactions`)에 기록 → 매출+보유권 사용 이력 둘 다 노출(강남 id_p46r9t7dpd). 상세 CLAUDE.md v3.7.921.
- **라이브: v3.7.920** (https://blissme.ai/version.txt) — 동반자 추가 버튼을 footer(큰 버튼)에서 **고객정보 줄 [변경][고객정보↗][메시지] 옆 작은 [동반자]** 로 이동(정우님 "잘 안 쓰는 버튼 작게"). 데스크탑·모바일 검증. 상세 CLAUDE.md v3.7.920.
- **라이브: v3.7.919** — 커플룸 동반자 ③ 모바일 버튼(앱). PC Ctrl 드래그 복사와 동일하게 동반자 생성(같은 시간·관리사, group 묶음, 결제 끊김). **커플룸 자동 동반자 ①②③ 완결.** v3.7.920에서 버튼 위치만 고객정보 줄로 이동. 상세 CLAUDE.md v3.7.919.
- **라이브: v3.7.918** — 커플룸 자동 동반자 ①(앱): 커플룸 태그 체크 시 신규·기존·모바일 모두 동반자 2건 자동 (기존 isNewItem 신규만 제약 제거).
- **라이브: v3.7.917** — 데스크탑 상단 **"오늘" 버튼 제거**(날짜탭 "오늘"로 대체, 중복). 오늘 점프는 날짜탭 "오늘 30" 클릭으로. 상세 CLAUDE.md v3.7.917.
- **라이브: v3.7.916** — 타임라인 날짜 탭에 **"오늘" 표시**(정우님 "직원들이 오늘이 어느 칸인지 모른다"). 오늘 탭은 요일("토") 자리에 "오늘" 굵게+보라 강조, 나머지는 요일 유지. 상세 CLAUDE.md v3.7.916.
- **라이브: v3.7.915** — 직원 이동/근무 팝업 **라이브-시안 1:1 정렬**(정우님 "라이브와 시안 비교해봐" 후): **담당자 교체 맨 아래로**(근무시간 다음 → 푸터 위, segments IIFE 안 이동)·**칩 색점 가시화**(연한 강남데모 color → 진한 팔레트색)·**바 아래 양끝 중복시간 제거**(눈금만). 검증: 빌드OK·babel OK·서연 팝업 스크린샷 시안 거의 1:1. 시안(shot3)과 레이아웃 일치. 상세 CLAUDE.md v3.7.915.
- **라이브: v3.7.914** — **"타지점 종일 근무" 체크박스 복구**(v3.7.913 회귀 fix). v3.7.913에서 "시안에 없다"고 뺐으나 정우님 "왜 사라졌지" — 직원을 다른 지점으로 종일 보내는 필수 기능. 근무시간 select 다음에 원복(변수는 살아있었음). **교훈: 시안에 없다고 실제 기능 제거 금지, 시안은 레이아웃 참고용**. 상세 CLAUDE.md v3.7.914.
- **라이브: v3.7.913** — 직원 이동/근무 팝업 **재설계 4차**(정우님 "버튼위치·디자인 시안과 다르다, 다 똑같이 해" 후): **헤더 2줄**(이름 크게+부제)·**타지점 종일근무 체크박스 제거**(시안에 없음)·**푸터 `[오늘 휴무][취소][저장]` 한 줄 통합**(흩어진 휴무+취소+저장 합침). 검증: 빌드OK·babel OK·유진 팝업 시안 거의 일치(eval+스크린샷). ⏸️ 남은 차이: **담당자 교체 위치**(근무시간 다음→시안은 푸터 위, segments IIFE 안 이동 필요·데모 예약직원 없어 검증제약)·2구간 두 색 바. 상세 CLAUDE.md v3.7.913.
- **라이브: v3.7.912** — 직원 이동/근무 팝업 **재설계 3차**(정우님 "시안하고 너무 다르잖아" 후): **시간 눈금**(바 위 11·13·15…)+**섹션 라벨**("근무 지점·이동")+**드롭다운 시간행 → 칩**(색점+지점+시간텍스트+×, select 제거·시간조정은 바 드래그). 로직 무수정·렌더만. 검증: 빌드OK·babel OK·selectCount 2(칩 적용)·유진 팝업 시안 근접. ⚠️ **2구간 두 색 바·담당자교체는 데모 단일지점이라 못 봄 → 라이브 이동직원에서 확인**. ⏸️ 잔여: 타지점종일근무 체크(시안 없음)·푸터 한줄통합(commitDraft 스코프 위험). 상세 CLAUDE.md v3.7.912.
- **라이브: v3.7.911** — 직원 이동/근무 팝업 **재설계 2차**(정우님 "바뀐 게 없잖아" 후): **담당자교체 노란박스 → 접힘 토글**("담당자 교체 N건 ▾"), **이동추가 폼 3줄 → 접힘 토글**("+ 직접 시간 지정 추가 ▾", 바 드래그가 주 수단), **근무시간 큰 칩**(16px). 로직 무수정·렌더 조건부+스타일만. 검증: 빌드OK·babel OK·16px·이동폼 접힘 확인. ⚠️ **담당자교체 접힘·2구간 바는 데모 단일지점이라 못 봄 → 라이브 예약있는 직원(민정 등)에서 확인 필요**. 상세 CLAUDE.md v3.7.911.
- **라이브: v3.7.910** — 직원 이동/근무 팝업 **재설계 1차**(정우님 시안 승인 후 "일단 배포"): **시간 10분 통일**(5분/30분 혼재→10분: 근무시간·구간편집·이동추가) + **시각 바 크게**(height 26→44px, 구간 라벨 지점명+시간 2줄). 로직(저장·드래그·세그먼트) 무수정, 시각·시간단위만. Figma는 View 좌석(편집불가)이라 mockup HTML→Chrome headless 스크린샷으로 before/after 시안 제시 후 진행. 검증: 데모 빌드OK·콘솔0·10분확인·바44px확인·이동없으면 버튼만. ⚠️ **데모 단일지점이라 2구간(두 색) 바는 라이브 령은 등 실제 이동에서 확인 필요**. ⏸️ 다음단계: 시안의 드롭다운행/이동폼 제거→바 드래그 only·담당자교체 접기·섹션순서·모바일 터치드래그 검증(라이브 다지점서 신중히). 상세 CLAUDE.md v3.7.910.
- **라이브: v3.7.909** — 직원 이동/근무 팝업 **시각 정리**(정우님 "가로 길고 글자 작다"): 근무시간 드롭다운 full-stretch→좌측 컴팩트(flex 0 1 auto, fontSize 14), 라벨 10→12~13px, 세그먼트행 10→12px. 로직 안 건드림(스타일만). 상세 CLAUDE.md v3.7.909.
- **라이브: v3.7.908** — 직원 이동/근무 팝업 1차 정리(안전 즉효): 이동 없는 직원은 바·세그먼트·이동추가 폼 숨기고 `[+ 다른 지점으로 이동]` 버튼만(시간 3중복·빈폼 제거), 종일근무 🧳 이모지 제거. 인터랙티브 바 로직 보존(표시만 조건부). 검증: 데모 하늘 팝업 깔끔+버튼클릭→편집기 정상. ⏸️ **팝업 전체 재설계(인터랙티브 바/이동흐름 통일·담당자교체 접기·모바일 터치)는 집중 세션으로 보류** — 데모에 다지점 이동 시나리오 세팅 후. 상세 CLAUDE.md v3.7.908.
- **라이브: v3.7.907** — 직원 완전이동 시 home지점 유령 잔여컬럼 버그 fix(령은: 천호→잠실 종일이동인데 지점별 근무시간 달라 천호 21:30~22:00 유령 잔여). `getWorkingStaff` home처리에 `hasHomeSeg` 체크 — override에 home세그먼트 없으면 완전이동으로 보고 home컬럼 제거(지원은 home세그有라 무영향). 령은 실데이터 교차검증. ⚠️ **정우님 라이브에서 령은 5/30 확인 권장**(데모엔 령은 없어 실UI 검증 못함, 로직·무회귀만 확인). 상세 CLAUDE.md v3.7.907.
- **라이브: v3.7.906** — `onVisible`/`onOnline` reservations 30일 전체 재fetch에 **60초 throttle**(모바일 앱전환·재연결마다 ~10MB 중복 fetch 방지, RT+120s폴링이 커버). 검증: visibilitychange/online 3회→fetch 안 늘어남. ⚠️ `select=*` 컬럼축소는 보류 — `request_msg`가 타임라인 블록·모달·검색에 다 쓰여 안전한 드롭 불가(per-day-fetch 리팩토링+실데이터검증 필요). 상세 CLAUDE.md v3.7.906.
- **라이브: v3.7.905** — Realtime schedule_data **6채널→1 통합**(`schedule_data_all_rt` + schRtRef 레지스트리, 디바이스당 −5채널, 2026-05-23 장애 대응). 검증: 단일채널 joined·구6채널 제거·폴링폴백 유지·콘솔0. 서버(React무관, 이미 라이브): 콜라보 게이트 작별·거절 인식 fix(swanxdiary) + AI 정확도 감사 도구 `_ai_accuracy_audit.py`(진짜 정확도 ~4.0~4.3/5, 프롬프트 이미 한계). 상세 CLAUDE.md v3.7.905.
- **라이브: v3.7.904** — 코드점검 2차: ①데이터유실(SaleForm 고아고객 INSERT await+중단 / 보유권 생성실패 노출) ②타임라인 렌더 메모이즈(+2만행 날짜스캔 `todayReservations`). 상세 CLAUDE.md v3.7.904.
  - **⏸️ 남은 보류**: ⓐ allRooms→blocks→naverAssignments 메모이즈(드래그 부드러움 — 7클로저 전이 의존, deps 누락 시 stale, 프로파일링 동반). 코드점검 미착수: select=* 컬럼축소 / AI 모델 — **비싼 모델은 정확도 핵심레버 아님 확인(감사 결과), 무료 유지가 맞음** / Claude폴백 6/1 사용한도 차단.
- **라이브: v3.7.903** (https://blissme.ai/version.txt) — 코드점검 추천묶음: pdfjs 동적화(메인번들 2373→1822KB) + bank_deposits 4중복→단일소스(채널3→1·폴링4→1) + 죽은파일 9개 삭제. 서버 `ai_booking.py` RAG 게이팅(`_rag_should_search` — 인사·확인 메시지 임베딩 스킵, 백업 `bak_pre_raggate_20260529_224734`)도 라이브. 상세 CLAUDE.md v3.7.903. 미착수 묶음: Realtime 채널통합/렌더최적화/select축소/AI모델비용(Claude폴백 6/1차단)/fire-and-forget await화.
- **라이브: v3.7.889** (https://blissme.ai/version.txt) — 로컬 `BLISS_V`/`version.txt` 일치
- 2026-05-28 요청 4건 처리: ①강남 고객명 변경 저장 ②현아 자동번역(최근5건 합산) ④신영 오류신고 버튼 = v3.7.888 / ③대표 AI 범위게이트 = 서버 ai_booking.py 라이브. 전부 done+답글.
- v3.7.889: 예약 등록 시 이름+전화 중복 고객 경고 강화 (이름으로도 후보조회 + 전화 정규화 비교, 포맷 달라도 검출).
- **라이브: v3.7.890** — 요청 신규 5건: ①타임라인 직원 이름 사라짐(syncOverrideToSch 큐 직렬화) ⑤매출히스토리 소진 빨강마이너스+다담권 잔액 = v3.7.890 / ③장영수 차트=데이터수정 / ②음모왁 4지선다=consent 위임 / ④종이동의서 사진=보류. ①은 레이스라 재현 어려움 — 정우님 "경아·수연 서로 배정" 재확인 대기.
- **라이브: v3.7.891** — 예약모달 상단 고객정보에 **동의서·차트 "작성완료" 깜빡 칩**(chartDoneBlink) + 클릭 시 **이미지 뷰어**(`ConsentDocsViewer.jsx`, pdfjs→`<img>`, 탭·92dvh·z9500). 기존 텍스트 펼침 대체. ⚠️ **정우님 실 브라우저에서 PDF 이미지 표시 1회 확인 권장** — 프리뷰 헤드리스에선 `page.render()`가 멈춰 이미지 눈 확인 못 함(코드는 pdfjs 5.7 API상 정확·키오스크 동일 방식, 15초 타임아웃→PDF링크 fallback이라 최악에도 항상 열림).

## 🟡 진행 (2026-05-28) — 카카오 알림톡 알리고→엠포(UMS) 전환  ★다음 세션 이어받기★
**배경**: 엠포 카카오 알림톡 단가(5원)가 알리고보다 저렴 → 알림톡을 엠포로 전환(2026-05-28 정우님 결정). SMS는 이미 엠포 NPRO 사용 중.

**현재 상태**:
- **send-alimtalk Edge Function 배포 완료**(verify_jwt=false). send-sms와 동일 인증(`ums_token_cache` id='default', `/api/v1/auth` code"100" 24h 캐시) + POST `https://ums.emfo-api.co.kr/api/v1/send/alt` (callback=branch.sms_callback, senderKey, templateCode, type "ALT", message #{var}, receiverList[{phone,userKey,customFields}], buttons[], fallback{SMS/MMS}). sms_consent 필터, sms_send_log 기록, code"100"성공/"500"1회재시도.
- **등록 시트 작성 완료**: `~/Library/CloudStorage/SynologyDrive-bliss/엠포_알림톡_템플릿_등록시트.md` — 템플릿 10종 본문/변수/버튼 전부 정리(전부 "유틸리티" 카테고리). UMS 매뉴얼: 같은 폴더 `Ums_API_Manual_v2.pdf`.
- **⚠️ 엠포는 NPRO3 API가 발송 전용** — 템플릿/발신프로필 등록 API 없음. **콘솔(웹)에서만 등록 = 브라우저 조작 필요**.

**미완(다음 세션 할 일)**:
1. **엠포 콘솔에서 템플릿 등록** (`npro.emfo.co.kr` 카카오 템플릿 관리). 8지점 카카오 채널 → 지점별 senderKey 발급 + 10종 템플릿 각 지점 등록·검수 제출.
   - 브라우저 조작 메모: macOS Browser 1은 cert 경고(개인정보 보호 오류) + 미로그인이었음 → 진행 막힘. **Windows "하우스마케팅" 브라우저에 엠포 로그인되어 있음**(엠포 콘솔 스크린샷 출처). 또는 정우님이 직접 로그인 후 인계. 콘솔 접속 시 인증서 경고는 정우님이 통과시켜야 함.
   - 엠포 고객센터에 "기존 아리고 운영 템플릿 동일 본문, 8채널 일괄등록 지원하는지" 문의 권장(온보딩 일괄등록 흔함).
2. 등록 후 받을 것: **지점별 senderKey 8개 + 지점×템플릿 emfo templateCode**.
3. 받으면: 서버 `bliss_naver.py` alimtalk_thread 발송경로를 send-alimtalk Edge Function으로 점진 전환(branch별 senderKey+templateCode 매핑).
- 실행단가(엠포, VAT별도): 알림톡 5 / SMS 7.5 / LMS 25 / MMS 55. 이번달 지점별 합계: 알림톡1702/SMS410/LMS6 = 11,735원.

## ✅ 이번 세션 완료 (2026-05-28) — v3.7.867~887 (상세는 CLAUDE.md)
- **선불권 자동차감 순서 버그 fix**(SaleForm.jsx): 구매일순→**유효기간 임박순(FIFO)** 정렬 + 서비스금액 cap + deps에 selBranch/branchId. 마곡 이영은 실데이터 교정(기존권 차감, 신규권 보존).
- **매출관리 동의서 상태 아이콘**(SalesPage.jsx): 매출 리스트 행 고객명 옆 노트아이콘 3상태 — 미발송=회색+금지표시, 발송=무색, 서명완료=파란색(클릭→동의서 URL). 구매상품에 필요한 템플릿만 매칭(`_consentTplForName`). consent_tokens.prefill_data↔customer_consents.form_data↔sales(reservation_id 조인).
- **ConsentModal 지점표시**: prefill.branch 주입.
- **고객 상세 모달**: placeholder 텍스트 전부 제거 + 차트/동의서 응답 자동반영(빈 칸만: email/gender/phone) + "차트 응답" 카드.
- **요청사항**: 공지 댓글 기능(BlissRequests.jsx commentDrafts).
- **리마인더 개선(서버)**: is_ai=true 말머리 / "yes"등 짧은긍정→재질문 금지 / 인박스에 실제 템플릿 본문 표시 / ko "내일" 제거(전일=당일 한 템플릿 공용).

## 🟡 확인 부탁 (정우님, 이월)
- WhatsApp **ko 템플릿 `bliss_reminder_ko`** Meta에서 "내일" 제거 편집 중(검수 3~5일). en은 이미 정상.

## ✅ 이번 세션 완료 (2026-05-25~26) — 상세는 CLAUDE.md 변경이력 참고
- **v3.7.865** 총매출 포인트 제외(정책일 2026-05-26 컷오프, 과거 불변 / 클라 6곳+RPC 5개) + 포인트 유효기간 출처별(선불권 적립→권 유효기간 따라감, source_package_id 링크+첫사용 전파, 포워드만·소급 생략). 상세 CLAUDE.md.
- **(2026-05-26 서버, React 변경 0)** AI 자동예약 버그 수정 — "next 요일"→가장 가까운 그 요일 / 날짜확인 질문 정확 응답 / 시술매칭을 견고한 AI추출기(Gemini)로 통일+폴백 보강 / Gemini JSON 깨짐→GPT(gpt-4.1-mini) 교차폴백 / 안전망 C(매칭 0건 경고). 모델 실데이터 테스트로 **Gemini 3.5 Flash 1차 + gpt-4.1-mini 폴백이 최적** 확인(교체 안 함). 상세 CLAUDE.md.
- v3.7.862: 고객 상세 "예약 내역" 탭 → 예약모달 센터+빨강반짝 (모달 fetch `rows[0]` 버그 fix)
- v3.7.863: 매출 상세 2단(좌 시술표/우 메모, 관리내역 제거) · 패키지 당일 미사용 검토 페이지(사이드바 공지&요청 아래, 확인완료 버튼) · 매출저장 경고(패키지/선불권 당일 미사용) · 로그인 개편(흐린 랜딩 배경·footer 제거·닫기버튼·데모계정 안내·이모지→SVG)
- 서버 ai_booking.py: 콜라보 게이트 매장발신도 "마케팅 담당자 연락" 마무리 멘트(예약 안 잡음) — React 변경 0
- v3.7.864: **계정 인증 풀세트** — 회원가입 재설계(이메일+휴대폰인증+약관), 아이디 찾기, 비밀번호 찾기(이메일 임시비번/휴대폰 인증). DB(accounts.phone, account_signup phone, admin_reset_password RPC) + 서버 5개 엔드포인트 + nginx + SignupWizard/AuthHelpModal.

## 🟡 확인 부탁 (정우님)
- **계정 인증 실 발송 end-to-end 미테스트**: 실 SMS/실메일이 나가고 실계정 비번이 바뀌는 거라 끝까지 안 돌림. 본인 번호/메일로 ① 신규 가입 1회 ② 비번찾기(이메일/휴대폰) 1회 ③ 아이디찾기 1회 확인 권장.

## 🟡 진행 (2026-05-26) — 인스타·WhatsApp 24h 메시지 제한 대응
**WhatsApp 자동 재참여 — ✅ 완료·발송 검증됨** (서버 코드 배포 완료, React 변경 0 / 상세 CLAUDE.md):
- 템플릿 `bliss_reengage_ko`·`bliss_reengage_en` **승인 완료**(마케팅 카테고리, 활성·품질좋음).
- **테스트 발송 성공**: 821057028008(정우)로 `bliss_reengage_ko` 발송 → Meta 200 + status webhook `read` 확인. **"결제 구성 인도/액세스 불가"는 발송에 무관**(무료 한도 내 발송됨, WABA 결제수단 셋업 불필요).
- 코드 자동 작동: 24h 막힘(131047) → 재참여 핑 + 원문 held → 손님 답장 시 flush 자동전달, 48h 만료. 추가 작업 없음.

**Instagram 403 = 'Human Agent' 미승인** (코드 정상, 정우님 액션 필요):
- 원인 확정 — Meta 앱에 **Human Agent advanced access 미승인**이라 24h~7일 손님 응대 발송이 전부 403.
- **App Review 제출 완료 (2026-05-26, "검토 진행 중")**: 앱 "Bliss Messaging"(appId 1591870165413712)에서 권한 3개(instagram_business_basic·_manage_messages·Human Agent) 제출. 스크린캐스트(손님 IG DM→Bliss 받은메시지함→직원 직접 답장→IG 도착, 영어자막) + 사용설명 + 데이터처리(처리자 Teraport/Supabase(싱가포르)/Oracle, 책임주체 Teraport Inc.) + 앱설정(아이콘 1024·카테고리 비즈니스및페이지·도메인 blissme.ai·개인정보처리방침 https://blissme.ai/privacy.html·약관 https://blissme.ai/terms.html·데이터삭제 안내URL) + 검수자지침(데모 demo/demo1234) 전부 작성. **Meta 검토 ~10일 대기**. 승인되면 24h~7일 손님 응대 자동 작동. 콜라보 콜드DM은 정책상 영영 불가(인스타 앱에서 수동).

## ✅ (2026-05-26) Instagram 토큰 9개 전체 만료 장애 — 복구 완료 + 자동갱신 구축 (상세 CLAUDE.md)
- **장애**: 발송실패(401) = 9개 지점 IG 토큰이 60일째라 동시 만료. **재발급 9개 완료 + 검증 + 서버 반영(secrets.conf+app_secrets) + bliss-naver 재시작 → IG 발송 정상 복구.**
- **영구 방지**: `bliss-ig-refresh.timer`(매주 월 04:00 KST) 자동 토큰 갱신 구축·검증 완료. 실패 시 TG 경보. **다시는 60일 만료로 안 끊김.**
- **정우님 확인**: 천호(housewaxing_cheonho) Webhook "설정"(켬) 했는지 확인 — 꺼져 있으면 천호 DM 수신 안 됨.

## 🟡 진행 (이전 세션 이월) — 카카오 알림톡 차트링크: 버튼→본문텍스트 (검수 대기)
- rsv_today 알림톡 WL 버튼 URL을 카카오가 전달 시 제거 → 본문 변수 `#{차트링크}`로 전환. 신규 템플릿 등록+검수 요청(8지점 UI_1603~1610, 버튼 없음).
- **검수 승인 후**: ① `branches.noti_config.rsv_today` 8지점 tplCode/msgTpl 교체 + `buttons:[]` ② 서버 rsv_today 루프 + `_send_booking_confirm`에서 `#{차트링크}`에 `https://sign.blissme.ai/?t={token}` 전체 URL 주입 ③ 알리고 inspStatus 확인(본문 URL 카카오 반려 가능성). 등록 스크립트 `/tmp/aligo_reg_chartlink.py`.

## 🟡 진행 (2026-05-26) — 카카오 **확정(rsv_confirm)** 알림톡에 차트링크 추가 (검수 요청 완료)
**배경**: 카카오 예약 확정 알림톡(rsv_confirm)에 차트링크 없음 + 당일 오후 예약은 rsv_today(09시) 지나 차트링크 영영 못 받음. 카카오는 상담톡 자유발신 불가(messages 카카오 아웃바운드 0건) → 알림톡=검수 필수. 그래서 rsv_confirm 자체에 차트링크 추가(확정=즉시발송이라 당일 오후예약까지 커버).
**등록·검수요청 완료** (2026-05-26, 8지점 신규 템플릿 "확정안내_차트링크"). 본문 = 기존 rsv_confirm + **승인된 당일안내(UI_1603, status=APR)와 동일 형식** — URL을 고정이 아닌 **전체 변수 `▶ #{차트링크}`** 로(고정 URL은 카카오 반려 → 첫 등록 UI_1879~1886은 고정URL이라 삭제하고 재등록). 버튼 없음:
  - 강남 **UI_1890** / 마곡 UI_1891 / 왕십리 UI_1892 / 용산 UI_1894 / 위례 UI_1895 / 잠실 UI_1896 / 천호 UI_1897 / 홍대 UI_1898
  - 등록 스크립트: `/tmp/aligo_fix_rsvconfirm.py`. 검수중/승인된 당일안내는 그대로 둠.
**검수 승인 후 작업**: ① `branches.noti_config.rsv_confirm` 8지점 tplCode를 위 UI_189x로 교체 + msgTpl 동일 교체 ② rsv_confirm params에 **`#{차트링크}`** 추가 — 서버가 확정 시 차트 토큰 생성 후 **전체 URL(`https://sign.blissme.ai/?t={token}`)을 `#{차트링크}`에 주입**(당일안내 #{차트링크} 주입 로직과 동일, 기존/신규는 `_pick_chart_tpls`+is_new_cust 기준). 확정=즉시발송이라 당일오후 예약까지 커버.

## ⏭️ consent 세션 위임 (이월) — sign.blissme.ai "내 보유 현황" 버그 2건
**bliss-consent 앱(별도 레포 — 이 세션에서 안 건드림).**
1. 연간회원권 "99회 남음" → 회수 대신 "무제한"/유효기간 표시.
2. 보유권 카드 만료기한 표시(note `유효:YYYY-MM-DD` 또는 연간회원권은 구매일+1년).
