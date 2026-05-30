# HANDOFF

## 현재 버전
- **라이브: v3.7.912** (https://blissme.ai/version.txt) — 직원 이동/근무 팝업 **재설계 3차**(정우님 "시안하고 너무 다르잖아" 후): **시간 눈금**(바 위 11·13·15…)+**섹션 라벨**("근무 지점·이동")+**드롭다운 시간행 → 칩**(색점+지점+시간텍스트+×, select 제거·시간조정은 바 드래그). 로직 무수정·렌더만. 검증: 빌드OK·babel OK·selectCount 2(칩 적용)·유진 팝업 시안 근접. ⚠️ **2구간 두 색 바·담당자교체는 데모 단일지점이라 못 봄 → 라이브 이동직원에서 확인**. ⏸️ 잔여: 타지점종일근무 체크(시안 없음)·푸터 한줄통합(commitDraft 스코프 위험). 상세 CLAUDE.md v3.7.912.
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
