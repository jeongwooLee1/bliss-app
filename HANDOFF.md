# HANDOFF

## 현재 버전
- **라이브: v3.7.864** (https://blissme.ai/version.txt) — 로컬 `BLISS_V`/`version.txt` 일치

## ✅ 이번 세션 완료 (2026-05-25~26) — 상세는 CLAUDE.md 변경이력 참고
- **(2026-05-26 서버, React 변경 0)** AI 자동예약 버그 수정 — "next 요일"→가장 가까운 그 요일 / 날짜확인 질문 정확 응답 / 시술매칭을 견고한 AI추출기(Gemini)로 통일+폴백 보강 / Gemini JSON 깨짐→GPT(gpt-4.1-mini) 교차폴백 / 안전망 C(매칭 0건 경고). 모델 실데이터 테스트로 **Gemini 3.5 Flash 1차 + gpt-4.1-mini 폴백이 최적** 확인(교체 안 함). 상세 CLAUDE.md.
- v3.7.862: 고객 상세 "예약 내역" 탭 → 예약모달 센터+빨강반짝 (모달 fetch `rows[0]` 버그 fix)
- v3.7.863: 매출 상세 2단(좌 시술표/우 메모, 관리내역 제거) · 패키지 당일 미사용 검토 페이지(사이드바 공지&요청 아래, 확인완료 버튼) · 매출저장 경고(패키지/선불권 당일 미사용) · 로그인 개편(흐린 랜딩 배경·footer 제거·닫기버튼·데모계정 안내·이모지→SVG)
- 서버 ai_booking.py: 콜라보 게이트 매장발신도 "마케팅 담당자 연락" 마무리 멘트(예약 안 잡음) — React 변경 0
- v3.7.864: **계정 인증 풀세트** — 회원가입 재설계(이메일+휴대폰인증+약관), 아이디 찾기, 비밀번호 찾기(이메일 임시비번/휴대폰 인증). DB(accounts.phone, account_signup phone, admin_reset_password RPC) + 서버 5개 엔드포인트 + nginx + SignupWizard/AuthHelpModal.

## 🟡 확인 부탁 (정우님)
- **계정 인증 실 발송 end-to-end 미테스트**: 실 SMS/실메일이 나가고 실계정 비번이 바뀌는 거라 끝까지 안 돌림. 본인 번호/메일로 ① 신규 가입 1회 ② 비번찾기(이메일/휴대폰) 1회 ③ 아이디찾기 1회 확인 권장.

## 🟡 진행 (이전 세션 이월) — 카카오 알림톡 차트링크: 버튼→본문텍스트 (검수 대기)
- rsv_today 알림톡 WL 버튼 URL을 카카오가 전달 시 제거 → 본문 변수 `#{차트링크}`로 전환. 신규 템플릿 등록+검수 요청(8지점 UI_1603~1610, 버튼 없음).
- **검수 승인 후**: ① `branches.noti_config.rsv_today` 8지점 tplCode/msgTpl 교체 + `buttons:[]` ② 서버 rsv_today 루프 + `_send_booking_confirm`에서 `#{차트링크}`에 `https://sign.blissme.ai/?t={token}` 전체 URL 주입 ③ 알리고 inspStatus 확인(본문 URL 카카오 반려 가능성). 등록 스크립트 `/tmp/aligo_reg_chartlink.py`.

## ⏭️ consent 세션 위임 (이월) — sign.blissme.ai "내 보유 현황" 버그 2건
**bliss-consent 앱(별도 레포 — 이 세션에서 안 건드림).**
1. 연간회원권 "99회 남음" → 회수 대신 "무제한"/유효기간 표시.
2. 보유권 카드 만료기한 표시(note `유효:YYYY-MM-DD` 또는 연간회원권은 구매일+1년).
