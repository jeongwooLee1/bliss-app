# HANDOFF

## 현재 버전
- **라이브: v3.7.831** (https://blissme.ai/version.txt) — 로컬 `BLISS_V`/`version.txt`와 일치
- **방문자(visitor) 디폴트 + primarySubject 토글**: 이미 라이브 배포됨 (`db.js` visitor_cust_id/primary_subject 매핑 + `ReservationModal` 토글 로직 전체)
- **서버 ai_booking.py / bliss_naver.py**: 2026-05-22~23 세션 패치 적용
- **⚠️ 변경이력 갭**: CLAUDE.md "완료된 작업 이력"은 **v3.7.784까지만** 문서화됨. v3.7.785~831(약 47개 버전)은 배포·커밋됐으나 changelog 항목 없음 (과거 세션이 버전업하며 이력 누락). 코드는 git에 들어있으나 상세 설명은 유실 — 해당 버전 작업 파악 시 `git log`/diff로 직접 확인 필요

## 2026-05-22~23 세션 (이어받기)

### ⚠️ 미배포 — 방문자(visitor) 디폴트 선택 fix (React, 로컬만)
**증상**: 네이버 예약(예약자≠방문자)을 타임라인에서 열면 방문자가 디폴트로 안 눌려 있음(예약자·방문자 둘 다 강조 안 됨).
**원인**: `db.js`에 `primary_subject` 매핑 누락 → 기존 예약 `item.primarySubject` 항상 undefined. 신규예약 분기(ReservationModal:527)엔 'visitor' 폴백 있는데 기존예약 분기(`{...item}`)엔 없음.
**수정 (로컬 — 빌드·배포·커밋 안 됨)**:
- `src/lib/db.js` DBMAP reservations에 `visitor_cust_id:"visitorCustId"`, `primary_subject:"primarySubject"` 추가 + DB_COLS에 `visitor_cust_id`,`primary_subject` 추가 (둘 다 DB 컬럼 존재 확인). → 기존 예약도 DB값 읽고, 토글 저장 시 영속화.
- `ReservationModal.jsx` 기존예약 분기(`return {...item,` 직후)에 `primarySubject: item?.primarySubject || (visitorName≠custName ? 'visitor':'reserver')` 폴백 추가.
**다음 행동**: 빌드 → 배포 → CF 퍼지 → BLISS_V+version.txt bump (다음 배포 묶음 포함). 검증: 네이버 예약(별도 방문자) 열어 방문자 강조 확인.

### 서버 — AI 예약 시술 매칭 over-capture fix (적용 완료, React 변경 0)
**증상** (Amanda Reigada 인스타): "full legs and eyebrows, Brazilian later" → 잡힌 시술 = 눈썹·다리절반·브라질리언·에너지 (브라질리언/에너지 오포함 + 다리 절반 오매칭). 정답 = 다리전체+눈썹.
**원인** (`ai_booking.py` `create_booking_from_ai`): 시술 매칭 `sn_combined`에 `booking.service`(AI 최종) **+ 대화 history 전체**를 합쳐 키워드 스캔 → 앞쪽 가격문의 단계 시술(브라질리언/에너지)·"나중에" 보류분까지 긁힘. "다리"는 절반/전체 구분 없이 첫 매칭.
**fix** (백업 `ai_booking.py.bak_pre_svcfinal_20260522_102446`):
- `sn_combined = sn_lower.strip()` — history aggregate 제거, `booking.service`(AI 최종 추출)만 매칭.
- `_resolve_svc(kw,ctx,svcs,finder)` 헬퍼 신규 — 다리/팔은 ctx의 전체/절반/full/half/whole 토큰으로 `다리 전체`↔`다리 절반` 구분(모호 시 전체). 한국어·영어 키워드 루프 둘 다 이 resolver 경유.
- 검증 6케이스 PASS (다리전체+눈썹 → 정확히 2건, 브라질리언/에너지 미포함). AI가 booking.service 비우면 기존 history regex fallback(~2092줄)이 채운 뒤 매칭.

### 서버 — 채팅 리마인드 외국고객 한글 발송 fix (적용 완료, React 변경 0)
**증상** (Monique, 호주 WhatsApp): 당일 09시 리마인드가 한글로 감 (하루전 18시는 영어 정상).
**원인** (`bliss_naver.py` `_send_chat_reminders`): 언어감지 쿼리가 `channel+account_id+user_id`로 첫 inbound 조회 → 당일 리마인드는 예약 `chat_account_id='whatsapp'`(범용값)인데 메시지 account_id는 실 phone ID(`1088922337632781`)라 매칭 0건 → 영/한 카운트 0 → 기본값 한국어.
**fix** (백업 `bliss_naver.py.bak_pre_langdetect_20260523_015939`): 언어감지 쿼리에서 `account_id` 필터 제거 → `channel+user_id+direction=in` 첫 5건으로 판정. user_id는 채널 내 고유라 정확. → 외국 고객 당일 리마인드도 영어.
**참고**: "9시"는 정상(당일 채팅 리마인드 설계 시각). 한글만 버그였고 fix됨. 다음 당일 리마인드부터 적용.

### ✅ 해결 — 네이버 예약 블록시간(dur) ≠ 매칭 시술합 (2026-05-23, 서버, React 변경 0)
**원인**: 신규 네이버 예약은 ai_analyze가 처음부터 dur=시술합으로 맞춤(정상). 문제는 **분석 후 시술/시술시간이 바뀐 기존 건** — `_should_analyze` 게이트(비용 절감, 5/15)가 재분석을 막아 dur이 stale. `dur`이 PRESERVE_FIELDS라 스크랩 하드코딩(45)도 안 덮고 재계산도 안 됨.
**fix** (`bliss_naver.py` `db_upsert`, 백업 `bak_pre_dursync_*`):
- row SELECT 2곳에 `selected_services,dur` 추가
- UPDATE 경로에 dur 재동기화 — schedule_log(수동 시간조정) 없으면, 기존 selected_services 시술합으로 `dur=max(svc_sum,30)` + `end_time` 자동 동기화. `_load_ai_settings()` 캐시된 services dur 맵 사용 → AI 재호출 0. 네이버 예약이 스크랩/변경될 때마다 자동 sync.
- 정책: 최소 30분 유지(`max(svc_sum,30)`), schedule_log 흔적은 보존(유저 결정).
**소급**: 오늘 이후 네이버 예약 4건 즉시 교정(스크립트 일회성). Tagnipez #1244388060 80→55(19:00–19:55), 1241696048 60→55, 1243404984 120→105, 1243690997 90→85. 재감사 결과 잔여 불일치 0건. 과거 예약은 유저 결정에 따라 미적용.
**자세한 내용은 CLAUDE.md 변경이력 참고.**

## 즉시 검증 — AI 영업시간 fallback (2026-05-21)
**fix 적용**: 영업시간(스케줄 윈도우 밖) + delay ON + 직원 미응답 시 AI가 받쳐주도록 게이트 순서 재배치. 라이브 자연 검증 필요.

**관찰 방법**:
1. 새 inbound 메시지 들어옴 (영업시간 + 직원이 1분 안에 답 안 함)
2. `pending_ai_replies` 테이블에 `status=pending` row 생기는지 확인
3. 1분 후 worker가 `status=sent`로 마킹 + 실제 outbound 발송되는지 확인
4. 만약 안 되면 — 서버 로그 `journalctl -u bliss-naver --since '5 minutes ago' | grep -E 'ai_booking|pending_ai_replies'`로 추적

**정책**:
- 야간(스케줄 윈도우 안): 즉시 AI (delay 무시)
- 영업시간 + delay ON: 1분 후 직원 미응답 시 AI fallback
- 영업시간 + delay OFF: AI 안 함
- active mode (AI ↔ 손님 진행 중): 시간 무관 즉시

## 미해결 — 혜경 마곡 11:30 (지은 id_ycxb65wni3)
**진단 완료**: `empWorkHours_v1`에 `혜경_br_k57zpkbx1_2026-05-20 = {start:"11:30", end:"21:30"}` **explicit 박혀 있음**. fallback 아님. 마곡점 영업시간(`timeline_settings.openTime=11:00 / closeTime=21:00`)은 정상.

→ 누군가가 혜경의 5/20 마곡 근무시간을 직접 11:30~21:30으로 박은 것 (앱 직원 시간 편집 popup 또는 race로 저장).

**단기 fix**: 정우님이 같은 popup에서 11:00~21:00으로 덮어 저장 → 즉시 정상화. 또는 직원 본인 시간을 직접 박은 게 의도였다면 그대로 둠.

**근본 fix 후보 (별도 트랙)**: popup race save 의심 (`setEmpWorkHours` diff-based merge가 v3.7.717에서 도입됐지만, 또 다른 경로로 잘못된 값이 박힐 수 있음). 정확한 재현 케이스 잡고 popup 저장 흐름 점검 필요.

## 미해결 — 이전 미답변 항목 (v3.7.780 이전 HANDOFF에서)

### 즉시 작업 — 카카오 채널 메뉴 URL 교체 (정우님)
손님 셀프 보유권/포인트 조회 페이지 ([mypage.html](https://blissme.ai/mypage.html)) 라이브 배포 완료. 8지점 카카오톡 채널 관리자에서 두 번째 메뉴 수동 변경 (강남 완료, 7지점 남음):
- 라벨: `💰 가격 안내` → `🎫 내 보유권·포인트`
- URL: `https://blissme.ai/prices.html?bid=*` → `https://blissme.ai/mypage.html`

### 진행 중 — 사전 차트/동의서 링크 당일 리마인드 첨부 (1단계, 카카오 검수 대기 3~5영업일)
**목표**: 당일 리마인드(rsv_today, 09:00)에 손님 셀프 차트·동의서 작성 링크를 첨부해 사전 작성 유도. consent 앱(sign.blissme.ai)은 같은 Supabase 공유, `?t=<token>` 링크만으로 셀프 작성 동작(consent 측 검증 완료, **bliss-consent 레포 건드리지 말 것**). 우리 몫 = 토큰 발급 + 알림톡 버튼 전달.

**채널 결정**: 알림톡(카카오) 리마인드에 **웹링크 버튼** 추가 → 카카오 검수. (별도 SMS 아님)

**서버 코드 (배포 완료, gate 상태)** — `bliss_naver.py` (백업 `bak_pre_prewrite_*`):
1. `reservation_reminder_thread._issue_pf_token(business_id, row)` 신규 — consent_tokens INSERT. token=`pf_`+uuid hex, customer_id=cust_id, template_ids=is_new_cust?`['ct_consent_full_ko_v2','ct_condition_v2']`:`['ct_condition_v2']`, template_id=template_ids[0], expires_at=예약일 23:59 KST, kiosk_id=null, lang='ko', prefill_data={reservation_id(=reservations.id), reservation_date, reservation_time}. **중복 방지**: 같은 예약(`prefill_data->>reservation_id`)의 미사용 토큰 있으면 재사용.
2. rsv_today select에 `is_new_cust` 추가.
3. rsv_today 루프: `tpl_cfg.buttons`에 `#{차트토큰}` 링크 버튼이 **설정돼 있을 때만** 토큰 발급 + `params['#{차트토큰}']` 주입 (gate — 검수 전엔 buttons:[]라 무동작).
4. `alimtalk_thread.process_item`: 버튼 linkMo/linkPc/linkIos/linkAnd에 params 치환(`_sub_btn`) → 발송 시 `#{차트토큰}`이 실제 토큰으로 치환.
- ※ **send API**(alimtalk/send)는 버튼 키 `linkMo/linkPc` 사용. **add API**(template/add)는 `linkM/linkP` 사용 — 다름. noti_config 버튼엔 linkMo/linkPc로 저장.

**알리고 등록 + 검수 요청 완료 (8지점, 본문 동일 + WL 버튼)** — tpl_name `당일안내_차트작성`:
| 지점 | tplCode | 지점 | tplCode |
|---|---|---|---|
| 강남 | UI_1221 | 잠실 | UI_1225 |
| 왕십리 | UI_1222 | 위례 | UI_1226 |
| 홍대 | UI_1223 | 용산 | UI_1227 |
| 마곡 | UI_1224 | 천호 | UI_1228 |
버튼: `차트 미리 작성하기` (WL/웹링크) → `https://sign.blissme.ai/?t=#{차트토큰}`. 본문 = 기존 rsv_today + "방문 전 아래 [차트 미리 작성하기] 버튼…" 1줄 추가.

**검수 승인 후 할 일 (task #42)**: branches 8지점 `noti_config.rsv_today` 일괄 UPDATE —
- `tplCode` → UI_1221~1228
- `msgTpl` → 신규 본문(차트 안내 1줄 포함)
- `buttons` → `[{"name":"차트 미리 작성하기","type":"WL","typeName":"웹링크","linkMo":"https://sign.blissme.ai/?t=#{차트토큰}","linkPc":"https://sign.blissme.ai/?t=#{차트토큰}"}]`
swap 즉시 서버 gate 활성 → 당일 09:00 리마인드에 토큰발급+버튼 발송 시작. 검수 결과는 알리고 `template/list` `inspStatus`(APR=승인)로 확인. (bliss_todos 리마인드 5/27 13:00 등록됨)
- ⚠️ 변수 버튼 URL이 카카오 반려되면(도메인 미검증 등) → 카카오 비즈니스에서 sign.blissme.ai 도메인 확인 필요 (별도).
- **2단계(작성완료→예약모달 차트 반영) / 3단계(매출 시 항목별 동의서 큐)는 추후.**

### 진행 중 — 다담권 pkg_pay 알림톡 유효기간 추가 (카카오 검수 대기, 3~5영업일)
신규 본문에 `유효 기간: ~ #{유효기간}` 추가한 v2 template 등록. 8지점 신규 tpl_code: **UI_0772**(강남) **UI_0773**(왕십리) **UI_0774**(홍대) **UI_0775**(마곡) **UI_0776**(잠실) **UI_0777**(위례) **UI_0778**(용산) **UI_0779**(천호).

**검수 승인 후 할 일**:
1. `branches.noti_config.pkg_pay` 8지점 일괄 교체 — `tplCode` + `msgTpl` 신규 본문
2. `SaleForm.jsx:3115` `unit==='won'` 분기 params에 `#{유효기간}` 추가 (`pkg.note`의 `유효:YYYY-MM-DD` 파싱, 없으면 "무제한")
3. 검수 반려 시 알리고 콘솔에서 사유 확인 → 본문 수정 후 재요청

**참고**: 알리고 콘솔 테스트 template `UI_0780-테스트조회_강남점` 잔존 (검수 미요청, 운영 영향 0). 카카오 정책상 "채널 추가" 버튼 사용 불가 → v2 template에는 버튼 미포함.

### 진행 중 — 예약 알림톡 엑셀 본문 전환 (카카오 검수 대기, 3~5영업일)
엑셀(`/Users/cripiss/Downloads/문자내용.xlsx`) 예약문자 3종 신규 template 24개 등록.

| 지점 | 예약확정 | 예약전날안내 | 당일취소안내 |
|---|---|---|---|
| 강남 | UI_0368 | UI_0369 | UI_0370 |
| 왕십리 | UI_0371 | UI_0372 | UI_0373 |
| 홍대 | UI_0374 | UI_0375 | UI_0376 |
| 마곡 | UI_0377 | UI_0378 | UI_0379 |
| 잠실 | UI_0380 | UI_0381 | UI_0382 |
| 위례 | UI_0383 | UI_0384 | UI_0385 |
| 용산 | UI_0386 | UI_0387 | UI_0388 |
| 천호 | UI_0389 | UI_0390 | UI_0391 |

**검수 승인 후 할 일**:
1. `noti_config` 업데이트 (승인된 것만):
   - `rsv_confirm`: 신규 tplCode + 본문(T1)
   - `rsv_1day`: 신규 tplCode + 본문(T2)
   - `rsv_cancel_today` 신규 키 추가: T3
   - `rsv_cancel`(사전취소) 기존 그대로
2. bliss 앱 — 취소 알림톡 3단 분기 (`queueAlimtalk` 호출부 `ReservationModal.jsx`·`TimelinePage.jsx`):
   - 사전취소 (예약일 ≠ 오늘) → `rsv_cancel`
   - 당일취소 + 당일예약 + 확정 후 1시간 이내 → `rsv_cancel` (무료취소 구간)
   - 그 외 당일취소 → `rsv_cancel_today` ★핵심
   - "확정 후 1시간" 기준시각 정의 확정 필요 (예약 `created_at` vs 별도 확정 timestamp)
   - 취소 알림톡은 알림톡만 발송 (SMS fallback 없음, 유저 확정)

### 미처리 수정요청
- **지은 id_n4j5e4ocmo** (예약풀기 오류) — status=reviewing, 더 큰 캡처 + 슬롯·직원 정보 대기
- **지은 id_ycxb65wni3** (혜경 11:30) — 위 "혜경 마곡 11:30" 진단 참고. status=reviewing로 답글 박혀 있음. 정우님 액션 후 done 전환
- **현아 id_eih96ttwa0** (커플패키지 운영방식) — 유저 보류 지시(2026-05-17), 제품쿠폰 우선. **상태**: v3.7.749~752로 정식 시스템(`services.is_couple` + `customer_shares` + 마이그레이션 페이지) 구현됨 → done 전환 가능 여부 확인

## 멤버십/직원계정 후속 (낮은 우선순위)
- OAuth(구글·카카오) 실계정 로그인 미검증
- `pick_membership` 화면 미검증 (멤버십 2개 이상 계정 부재)
- 모바일 하단탭 직원 공지는 `더보기` 안쪽 — `MobileBottomNav.mainItems`에 requests 포함 시 노출
- 직원이 타임라인 예약 블록 탭 → 예약모달 매출 버튼 노출 — role 시 매출/대화 차단 검토

## 동의서 요청→서명 흐름 점검 (워크트리 작업세션 예정)
**상태**: 코드 흐름(요청 `ConsentModal` → `consent_tokens` INSERT → `sign.blissme.ai` 서명 → `html2canvas`+`jsPDF` PDF → Storage → `customer_consents` INSERT → `consent_tokens.used_at` 마킹 → `ConsentPanel` realtime 이력)은 완성·정상 구현 확인. 단 **실사용 0건** — `customer_consents` 14건 전부 테스트 데이터.

**다음 할 일**:
- 라이브 e2e 테스트 — 테스트 고객으로 동의서 요청 → `sign.blissme.ai` 실제 서명 → PDF·이력 생성 확인 → 테스트 데이터 정리
- DB 4/20 개발초기 잔재(PDF 없는 4건 · orphan 고객 `cust_id_6cmcej4sk3` 4건) 정리 여부 판단

**참고**: 사인 앱 = `bliss-consent` 별도 프로젝트(`sign.blissme.ai`, 직원 담당). `bliss-consent/HANDOFF.md`만 4/20자로 낡음.

## 기타 미해결
- 카카오 예약 확정 알림톡(v3.7.735): 실발송 테스트 미실시
- **시크릿 키 settings 탈출 마무리**(2026-05-17 작업): 6키 env 전환 + `wa_token`·`ig` 토큰 → app_secrets 완료. **남은 일**: `businesses.settings`에서 6키 + `wa_token`·`ig_token`·`ig_tokens` 제거. 그 후 settings엔 `gemini_key`·`deepl_key`만 남음(클라이언트 사용, 서버화는 별도 큰 작업) → settings RLS 잠금 가능

## 참고 — 라이브 키 대기 (외부 의존)
토스 라이브 키 발급 시 Supabase Edge Functions ENV 3개 등록 필요:

| Key | Value | 비고 |
|---|---|---|
| `TOSS_BLISS_CLIENT_KEY` | `live_ck_*` | 공개 가능 |
| `TOSS_BLISS_SECRET_KEY` | `live_sk_*` | 프론트 노출 X |
| `TOSS_BLISS_IS_TEST` | `false` | 라이브 모드 |

송정윤 매니저(010-4928-1242) 토스 심사 답변 메일 회신 대기 중.

## 인수인계 체계
3계층 분리. 자세한 내용은 CLAUDE.md 참고.
