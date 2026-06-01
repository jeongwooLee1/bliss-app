# HANDOFF

## 📌 현재 라이브: v3.7.954 (https://blissme.ai/version.txt) — 2026-06-01

### ✅ 이번 세션 완료 (2026-06-01) — v3.7.939~954 (상세 CLAUDE.md 변경이력)
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
