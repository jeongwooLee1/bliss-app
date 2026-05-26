# HANDOFF

## 현재 버전
- **라이브: v3.7.866** (https://blissme.ai/version.txt) — 로컬 `BLISS_V`/`version.txt` 일치

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
