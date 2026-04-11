# HANDOFF

현재 진행 중인 작업의 인수인계 상태.

## 작성 규칙
- 자격증명·환경정보·아키텍처는 여기 넣지 않는다 (→ CLAUDE.md)
- "무엇을 / 왜 / 다음 행동"만 기록한다

---

## 2026-04-10~11 완료

### 네이버 세션 자동 갱신
- login_auto.py (비대화식 Playwright) + Windows Task Scheduler 매주 일 03:00
- 서버 keepalive 6시간마다 (04/10/16/22시) + 알림 Gmail→텔레그램 전환
- 주의: CAPTCHA 뜨면 수동 login_local.py 필요 (login_auto.py는 CAPTCHA 자동 해결 불가)

### 서버 복구 (bliss_naver.py)
- Supabase 키: 레거시→publishable (4/8 비활성화 대응)
- server_id 고정 (oracle IP 분기 제거)
- Gmail 앱 비밀번호 갱신: `yhnz ibej giha sgnr` (.env에 저장)
- /gmail-push 엔드포인트 복원 (Google Apps Script push 수신)
- /instagram, /whatsapp, /naver-talk 엔드포인트 복원
- 주의: 서버 코드 수정 시 원본(a96156a^ 커밋)을 기반으로 할 것. 중간 커밋들에 코드 손실 있음

### AI 통합
- 모델 통일: gpt-4o-mini→gemini-2.5-flash (서버+프론트 전체)
- AI hallucination fuzzy ID 보정 (1-2글자 차이 자동 보정)
- Gemini 키 시스템 제공 (__systemGeminiKey 우선, 개별 설정 불필요)
- AI 설정 메뉴 owner/super만 접근, 시스템 키 있으면 API 탭 숨김

### 회원가입 / 온보딩
- 회원가입 일반화: 하우스왁싱 특화 제거, 지점 없이 가입 허용
- 설정 마법사: AI 대화형 온보딩 (사진/엑셀/텍스트 드래그드롭 + Gemini Vision)
- Google 소셜 로그인: OAuth 연동 완료 (자동 계정 생성 + 설정 마법사 자동 시작)
- 소셜 로그인 로직: AppShell 초기화 시 supabase.auth.getSession() → app_users 매핑/자동 생성
- app_users 테이블에 email 컬럼 추가 (Supabase SQL Editor)

### 버그 수정
- reservation_sources insert→upsert (중복키 에러)
- SchedulePage React.useCallback 미import (React not defined 에러)
- service_categories에 use_yn 컬럼 없는 문제 (설정 마법사)

---

## 2026-04-11 완료

### 카카오 소셜 로그인 완료
- 비즈 앱 전환 완료 (주식회사 테라포트, 632-81-02070)
- 동의항목 account_email "선택 동의" 설정 완료 (동의 목적: 회원 식별 및 로그인 계정 연동)
- Supabase Client Secret 수정: 카카오 "플랫폼 키 > REST API 키 수정 > 클라이언트 시크릿" 값 사용
  - 기존: REST API Key 중복 입력 (cef0d988...) → code exchange 실패
  - 수정: 실제 클라이언트 시크릿 코드 (5owAOa1G67WdwRhH7VKikS0cRFbPpsAJ) 입력
- 카카오 로그인 테스트 성공: cripiss@kakao.com → "이정우님의 사업장" 자동 생성 + 설정 마법사 시작
- 참고: 카카오 앱 아이콘(bliss_logo.png) 등록은 이전 세션에서 완료됨

### 타임라인 지점 표시 설정
- TimelineSettings에 지점별 토글 버튼 UI 추가
- allBranchList, viewBids, toggleView props 전달
- isMaster: 전 지점 토글 가능, 일반: accessibleBids 내 토글

### alimtalk_thread watchdog 추가
- watchdog에 t7(alimtalk) 생존 체크 + 자동 재시작 추가
- 상태 로그에 alimtalk 상태 포함
- 폴링 디버그 로그 (처음 3회 + 매 1시간)
- naver-sync repo push 완료 → crontab 자동 동기화

### 고객관리 예약통계 표시
- 상세 패널에 예약횟수/노쇼/당일취소 카운트 표시
- reservations 테이블에서 cust_id 기준 조회 (status 기반 집계)

### 참고: Google OAuth 설정
- Google Cloud 프로젝트: bliss-492906
- Client ID: 483655734800-mbus7qgbdhsr5hdjprub7vmfhekeecdj.apps.googleusercontent.com
- Redirect URI: https://dpftlrsuqxqqeouwbfjd.supabase.co/auth/v1/callback
- Supabase Site URL: https://blissme.ai/bliss-app/
- Supabase Redirect URL: https://blissme.ai/bliss-app/**

### 서버 코드 주의사항
- bliss_naver.py 수정 시 반드시 원본 기반(git show a96156a^:bliss_naver.py)으로 작업
- crontab이 매분 git fetch → bliss_naver.py 변경 감지 시 자동 restart
- .env 파일에 GMAIL_APP_PASSWORD 등 환경변수 저장 (코드에 하드코딩 X)
- 서버 패치 후 반드시 git push → crontab이 동기화될 때까지 대기

---

## 2026-04-09 완료 (CLAUDE.md 승격 대기)

- 예약목록 필터 실시간 반영 버그 수정 (resPage 리셋)
- 고객관리: 이메일 칼럼, 성별 수정 에러(23505), 수정 즉시 반영, 숨김 제거, 보유권 만료 구분
- 검색 통일: 전 검색창 ilike 부분일치 + email/cust_num 추가
- 예약목록 성별 백필 (genderMap + 469건 cust_id 링크 + 86건 cust_gender)
- 권한 체계: isMaster=owner|super만, manager 관리메뉴 접근 가능(브랜드멤버/사용자관리 제외)
- AdminPlaces userBranches 필터, 알림톡/메시지 userBranches 필터
- 담당자관리 페이지 삭제
- 하드코딩→DB: naver_account_id, instagram_account_id, whatsapp_account_id
- _BR_ACC/_ACC_NAME/branchAccMap 3곳 제거 → data.branches 동적
- AdminPlaces에 외부 서비스 연동 UI + booking_notice + alt_phone
- 알림톡 전체 구현: queueAlimtalk, 9개 트리거(rsv_confirm/change/cancel/1day/today/aftercare, pkg/tkt/annual)
- 전 지점 알림톡 설정 (지점별 senderKey, 공통 aligoKey)
- 시술후 케어 알림 5개 등록 (UG_8978~8982, 카카오 심사중)
- r.html 예약확인 페이지: 네이버 지도(ncpKeyId=20e46c5nm6) + 안내문구 DB + 지도 링크
- URL: jeongwoolee1.github.io → blissme.ai/bliss-app/r.html
- 시술상품 정렬: 카테고리sort→시술sort 2단계 + 줄바꿈 방지
- 제품관리 빈 화면 수정 (productItems→products 키 통일)
- 직원출근표 잠금 풀림 수정 (월 이동 시 DB 재로드)
- 관리설정 받은메시지함 중복 제거
- 강남점 안내문구/대체연락처 설정
- 전 지점 알림톡 OFF (테스트 완료 후 대기)

---

## 작업: 시술후 케어 알림톡 (5/10/21/35/53일)
**상태**: 알리고 등록 완료, 카카오 심사 대기 (2~3일).

### 상황
- UG_8978(5일), UG_8979(10일), UG_8980(21일), UG_8981(35일), UG_8982(53일)
- AdminNoti UI "시술후 케어 알림" 섹션 추가됨
- 전 지점 noti_config에 after_5d~53d ON (but 전체 알림톡 OFF 상태)
- reminder_thread에 트리거 추가됨 (completed 예약 기준)

### 다음 행동
- 카카오 심사 승인 확인 → 알림톡 ON으로 전환

---

## 작업: 고객관리 권한 + 노쇼 카운트
**상태**: 미착수.

### 요구사항
- 브랜드 묶인 지점은 고객정보 공유 (읽기), 수정은 각 지점/어드민만
- 예약횟수, 노쇼, 당일취소 카운트 표시

---

## 작업: 매출관리 상세내역
**상태**: 미착수.

### 요구사항
- 현금/입금/카드 내역 표시
- 오라클 시술 세부내역 동기화 (oracle_sync.py)

---

## 기존 작업

### 박유라 #1203011690 변경 예약 수동 연결
**상태**: 유저 액션 대기 (네이버에서 새 예약번호 확인 필요)

### "재방문) 와본적 있어요" 시술 매칭
**상태**: 유저 결정 대기 (3가지 선택지)

### Gemini 403 재발 방지
**상태**: 일시적 복구. Google Cloud Console 확인 필요.

---

## 참고: 네이버 지도 API
- Client ID: 20e46c5nm6
- 파라미터: ncpKeyId (ncpClientId 아님 — 변경됨)
- API: Dynamic Map + Geocoding
- Web URL: https://blissme.ai
