# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
Bliss 하우스왁싱 예약관리 앱.

## 레포지토리
- **bliss-app** (이 폴더): Vite+React 신규 앱
- **bliss**: jeongwooLee1/bliss — 기존 운영 앱 (index.html 모놀리식)

## 서버
- Oracle Cloud: 158.179.174.30
- Supabase biz_id: `biz_khvurgshb`
- 라이브 URL: https://blissme.ai (Cloudflare DNS → 158.179.174.30)
- GitHub Pages: 비활성화 (구 시스템 차단)
- Nginx: `/etc/nginx/sites-enabled/bliss` → `/var/www/html/bliss-app/`

## 로컬 개발
- `npx vite --force` → localhost:5173

## 배포
```bash
cd /c/Users/TP005/bliss-app
rm -rf dist && npx vite build
ssh bliss-server "sudo rm -rf /var/www/html/bliss-app/*"
scp -r dist/* bliss-server:/tmp/bliss-app/
ssh bliss-server "sudo rm -rf /tmp/bliss-app/*"
scp -r dist/* bliss-server:/tmp/bliss-app/
ssh bliss-server "sudo cp -r /tmp/bliss-app/* /var/www/html/bliss-app/ && sudo chown -R www-data:www-data /var/www/html/bliss-app"
```
주의: /tmp/bliss-app/ 초기화 필수 (구버전 JS 누적 방지)

## 서버 프로세스
- `bliss-naver.service` — 네이버 스크래핑 + WhatsApp webhook + send_queue 폴링 + AI 분석
- `bliss-relay.service` — CMD relay
- 코드 위치: `/home/ubuntu/naver-sync/bliss_naver.py`
- 재시작: `ssh bliss-server "sudo systemctl restart bliss-naver"`

## 네이버 세션 갱신
세션 만료 시 로컬에서 실행:
```
cd C:\Users\TP005\naver-sync
python login_local.py
```
playwright로 네이버 로그인 → 세션 파일 서버 전송 → 서비스 재시작

## 주요 아키텍처

### 파일 구조
- `src/pages/AppShell.jsx` — 메인 라우팅, 데이터 로딩, 사이드바
- `src/components/Timeline/TimelinePage.jsx` — 타임라인 (직원 컬럼, 예약 블록)
- `src/components/Reservations/ReservationsPage.jsx` — 예약목록, 매출, 통계, 고객관리, 사용자관리, 관리설정(AdminPage), Admin 하위 컴포넌트 모두 포함
- `src/components/Messages/MessagesPage.jsx` — 받은메시지함 (네이버/WhatsApp/카카오 등)
- `src/components/Schedule/SchedulePage.jsx` — 직원 근무표 (구 standalone, iframe으로 사용)
- `src/lib/sb.js` — Supabase fetch wrapper
- `src/lib/supabase.js` — Supabase client (window._sbClient 설정)
- `src/lib/db.js` — DB 스키마 매핑, fromDb/toDb
- `src/lib/useData.js` — useEmployees, useSchHistory, useAppData 훅
- `src/lib/constants.js` — T(테마), SCH_BRANCH_MAP, MALE_EMPLOYEES

### 데이터 흐름

#### 직원 근무표 → 타임라인 컬럼
- 직원 목록: `schedule_data` 테이블 key=`employees_v1` (이름 기반 ID: "경아", "서현" 등)
- 근무표: `schedule_data` 테이블 key=`schHistory_v1` (직원별 날짜별 근무/휴무/지원)
- 타임라인은 employees_v1에서 직원 로드 → schHistory로 출근 여부 판단 → 컬럼 생성
- `SCH_BRANCH_MAP`: 근무표 branch 키("gangnam") → 실제 branch_id("br_4bcauqvrb") 매핑
- **"지원(강남)"** 상태 → parseSupportBranch()로 지점명 파싱 → 해당 지점 컬럼에 표시, 원래 지점에서 제거
- 지점명 매칭: branches 테이블의 name/short에서 "점", "본점", "하우스왁싱 " 접두사 제거하여 유연 매핑

#### 담당자 관리 vs 직원 근무표
- `rooms` 테이블: 담당자(룸). name이 "1" 같은 룸 번호 — 직원 이름 아님!
- `employees_v1`: 근무표용 직원 데이터. 타임라인 컬럼의 실제 소스
- 주의: BASE_EMP_LIST를 data.rooms에서 만들면 안 됨. employees_v1에서 가져와야 함

#### 메시지 시스템
- `messages` 테이블: 모든 채널(네이버/WhatsApp/카카오 등) 메시지 저장 (구 naver_messages에서 리네임)
- `send_queue` 테이블: 발송 대기열 → 서버가 폴링하여 실제 발송
- WhatsApp account_id: "whatsapp" (네이버 account_id와 다른 체계)
- 사이드바 배지: WhatsApp 등 소셜 채널도 미읽 카운트에 포함해야 함
- 메시지 폴링: 5초 간격, cache:"no-store" + Cache-Control:"no-cache" 헤더
- **주의**: Supabase REST API에 `_t=Date.now()` 같은 캐시버스터 쿼리 파라미터 넣으면 400 에러 (컬럼으로 해석됨)

#### AI 자동응대
- 서버 `bliss_naver.py`의 `ai_auto_reply()` 함수 — webhook으로 수신 시 자동 답변
- **현재 비활성화**: `return ""` 추가로 막아놓음 (테스트 중)
- 앱 내 AI 버튼(수동): MessagesPage genAI() — 시술가격표 + 자동응대 프롬프트 + 고객 패키지 잔여 주입
- AI 설정: businesses.settings에 `gemini_key`, `ai_rules`, `ai_chat_prompt` 저장
- AdminAISettings: 3개 탭 (API 키 / 분석 규칙 / 자동 응대)

#### 고객 패키지 (다회권)
- `customer_packages` 테이블: customer_id, service_name, total_count, used_count
- AI 응대 시 고객 이름으로 매칭 → 잔여 회수를 프롬프트에 주입
- 고객관리 페이지에서 구매/차감/삭제 가능

#### Realtime
- `window._sbClient = supabase` (supabase.js에서 설정)
- 이게 없으면 모든 Realtime 구독 실패 → 폴링 fallback만 동작
- 타임라인 schHistory: Realtime + 10초 폴링 병행
- 메시지: Realtime + 5초 폴링 병행
- 배지 카운트: Realtime + 10초 폴링 병행

### 서버 bliss_naver.py 주요 설정
- `_load_ai_settings()`: businesses.settings에서 gemini_key, wa_token, wa_phone_number_id 등 로드 (5분 캐시)
- WhatsApp 발송: wa_token, wa_phone_number_id가 캐시에 포함되어야 함
- 자동응답 비활성화: `ai_auto_reply()` 함수 첫 줄 `return ""`

## 작업 완료 알림
모든 작업 완료 시 텔레그램 알림 전송 (.env에서 토큰 로드):
```
source .env && curl -s "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" -d "chat_id=${TG_CHAT}" --data-urlencode "text=작업 완료"
```

## 인수인계 체계
3계층 분리. 역할이 겹치면 안 됨.
- **CLAUDE.md** (이 파일): 영속 프로젝트 컨텍스트. 아키텍처, 파일구조, 데이터흐름, 금지규칙, 환경정보(서버/Supabase/CF), 변경 이력. 자격증명·환경정보는 여기에만 둔다.
- **HANDOFF.md**: 현재 진행 중 작업 상태. 다음 세션이 바로 이어받을 수 있도록 "무엇을/왜/다음 행동"만 기록. 작업 완료 시 요약을 CLAUDE.md "변경 이력"에 승격하고 HANDOFF.md는 "없음" 상태로 리셋. 환경·자격증명 중복 금지.
- **~/.claude/.../memory/**: 유저 전역 메모리. 유저 선호·피드백·외부 레퍼런스만. bliss 작업 상태는 넣지 않는다.

새 세션 시작 시 CLAUDE.md → HANDOFF.md 순으로 읽는다.

## 필수 규칙
- 작업 진행 상태·대기 항목은 HANDOFF.md에, 영속 정보는 CLAUDE.md에 기록
- 작업 완료 시 CLAUDE.md 변경이력 추가 + HANDOFF.md 리셋 + `git add CLAUDE.md HANDOFF.md && git commit -m "docs: update" && git push`

## 절대 금지
- memo 필드에 네이버 데이터 쓰기
- API 키 코드에 노출
- Supabase REST API URL에 임의 쿼리 파라미터 추가 (400 에러 유발)

## 완료된 작업 이력

### 관리설정 & 사용자관리 활성화
- AppShell에서 구 AdminPage(components/Admin/) 대신 ReservationsPage의 완성된 AdminPage 사용
- UsersPage 플레이스홀더 → 실제 구현으로 연결
- ReservationsPage에 8개 Admin 하위 컴포넌트 이식 (AdminPlaces, AdminWorkers, AdminSaleItems, AdminProductItems, AdminResSources, AdminNoti, AdminAISettings, AdminServiceTags)
- DataTable 컴포넌트 추가

### 타임라인 직원 컬럼 동적화
- 하드코딩 BASE_EMP_LIST → employees_v1에서 동적 로드
- SCH_BRANCH_MAP으로 branch 키 → branch_id 매핑
- "지원(강남)" 상태 파싱 → 해당 지점 컬럼에 직원 표시

### schHistory Realtime 개선
- INSERT + UPDATE 모두 감지
- 폴링 10초 병행
- window._sbClient 설정 (supabase.js)

### AI 자동응대 개선
- AdminAISettings에 "자동 응대" 탭 추가
- genAI에 시술 가격표 자동 주입 (data.services 동적)
- 자동응대 프롬프트 (ai_chat_prompt) DB 저장/로드
- 거짓 정보 방지 지시 추가
- 고객 패키지 잔여 조회 (findCustPkgInfo) → AI 프롬프트 주입

### AI Book (QuickBookModal)
- bliss/index.html에서 QuickBookModal 이식
- 브라우저 뒤로가기 지원 (popstate)

### 타임라인 설정 바텀시트
- createPortal로 document.body에 렌더링 (overflow clipping 방지)

### 메시지 시스템
- 5초 폴링 추가 (Realtime 실패 대비)
- Supabase 캐시버스터 _t= 파라미터 제거 (400 에러 원인)
- Cache-Control 헤더로 캐시 방지
- markRead에서 onRead 콜백 호출 → 사이드바 배지 갱신
- 사이드바 배지: WhatsApp 등 소셜 채널 미읽 카운트 포함
- 배지 10초 폴링 추가

### 서버 수정
- WhatsApp 발송: _load_ai_settings()에 wa_token, wa_phone_number_id 캐시 추가
- AI 자동응답 비활성화 (테스트 중)
- Nginx: /bliss-app/ location 추가

## 대기 중 작업 (라이브 전환 시)

### AI 자동 예약 전체 활성화
- 현재: `ai_booking.py`에 `TEST_ALLOWED_USERS`로 테스트 계정만 허용
- 라이브 시: `TEST_ALLOWED_USERS` 블록 제거 → 모든 고객 메시지에 AI 자동응답
- 사용자에게 확인 후 진행

### 인스타그램 DM 연동 완료
- 전지점 인스타 계정 연동 (IG tokens DB에 등록)
- AI 자동 예약 접수 (ai_booking.py)
- 에코 메시지 저장 (인스타/네이버톡 모두)
- 확정톡 채널 분기 (인스타→DM, 네이버→네이버톡)
- memo에 @username + 하우스왁싱 계정명 표시

### 도메인 + HTTPS
- blissme.ai 도메인 구매 (Cloudflare, 2028-03-28 만료)
- HTTPS: Cloudflare Proxy (Full SSL)
- HTTP→HTTPS 자동 리다이렉트
- GitHub Pages 비활성화 (구 시스템 차단)

### 네이버칼럼 → 미배정칼럼 전환
- 칼럼명: "네이버" → "미배정"
- 필터: roomId/staffId 없는 모든 예약 표시
- 확정 여부 무관, 담당자 배정 전까지 미배정칼럼 유지

### 모바일 UI 개선
- 하단탭: 타임라인|매출|메시지함|고객|더보기
- 매출통계를 매출관리 안 탭으로 통합
- 모바일 헤더/버전넘버 정리
- 좌우 패딩 6px, 하단탭 bottom:16px

### Oracle→Supabase 동기화
- oracle_sync.py: 증분 동기화 (최근 7일 매출 + 30일 고객)
- Windows Task Scheduler: 매일 새벽 3시 (BlissOracleSync)
- Oracle DSN: googlea.withbiz.co.kr:5063/ORA11GHW (로컬 PC에서만 접속 가능)

### 코드 리팩터링 완료
- Phase 1: common/index.jsx — 공통 UI 12개
- Phase 2: AppShell 2248→1261줄 (SalesPage, CustomersPage, Nav 분리)
- Phase 3: ReservationsPage 3005→755줄 (Admin 10개 파일 분리)
- Phase 4: TimelinePage 2253→1897줄 (QuickBook, Settings 분리)
- Phase 5: ReservationModal 2033→1290줄 (SaleForm 분리)

### Supabase 인프라
- RLS: 전 테이블 18개 활성화
- RPC: get_sales_summary, get_sales_by_branch, get_today_stats
- Materialized View: daily_sales_mv (매 시간 갱신)
- Edge Functions 6개 배포 (check-pending, send-message, daily-report, noshow-check, daily-reminder, birthday-greeting)
- DB Webhook: send_queue INSERT → send-message trigger
- pg_cron 7개: check-pending, daily-report, noshow-check, refresh-sales-mv, inactive-custs, cleanup-queue, weekly-report
- Vault + Edge Secrets (TG_TOKEN, TG_CHAT)
- Supabase Access Token: sbp_cb8a6191cdc34424538cb5d696d371c8739c2c29
- Realtime Publication: reservations, schedule_data, messages, send_queue, customers, sales
- 폴링 전부 제거 → Realtime만 사용 (Egress 절감)
- Cloudflare 캐시 퍼지 필요 시: Dashboard → Caching → Purge Everything

### v1.4.0 블록 이동 핵심 버그 수정 (2026-03-29)
- **원인**: staffUpdate가 isNaverBlock(네이버 예약)일 때만 적용. 내부일정/일반예약은 staffUpdate={}로 무시되어, 칼럼 이동 시 roomId만 변경되고 staffId가 빈값으로 남아 양쪽 칼럼 필터에 걸려 중복 표시
- **수정**: staffUpdate를 모든 블록에 적용 (직원칼럼→staffId 설정, 미배정→초기화)
- 내부일정 이동: 팝업 없이 바로 DB 저장
- 칼럼만 이동(시간 동일): 팝업 없이 바로 저장
- 시간 변경 + 010 고객만 알림톡 팝업

### 보유권 결제수단 통합
- 결제수단 버튼 앞에 보유권 버튼 배치 (🎫 다담권 / 🎟 다회권)
- 클릭 한 번으로 즉시 차감 (입력 필드 없음)
- 그라데이션 오렌지 디자인

### AI 가격표 학습
- 여성/남성 전체 가격표 프롬프트에 포함
- 풀바디/풀페이스 = 패키지 가격, 부위별 합산 금지
- 가격 질문 시 남녀 둘 다 즉시 안내, 성별 묻지 않기
- 메시지함 AI(genAI) 프롬프트에도 동일 적용

### Cloudflare 캐시 문제 해결
- 배포 후 Cloudflare가 오래된 index.html 캐싱 → 새 JS 로드 안 됨
- 해결: nginx no-cache 헤더 + index.html 메타태그 + Cloudflare Purge
- 배포 후 반드시 Cloudflare 캐시 퍼지 필요

### 서버 OpenSSL 충돌 해결
- oracledb 설치 시 cryptography 업그레이드 → 시스템 pyOpenSSL과 충돌 → 서버 크래시
- 해결: sudo pip3 install pyOpenSSL cryptography --upgrade

### 고객관리 가입일 + 문자수신 동의 (2026-03-29)
- DB 컬럼: join_date(text), sms_consent(boolean, 디폴트 true)
- 고객 등록/수정 모달: 가입일 date picker + 동의/거부 버튼
- 리스트: 가입일 표시 + 수신거부 시 빨간 태그
- 신규 고객 디폴트: 오늘 날짜 + 수신동의

### 동명이인 매칭 방지 (2026-03-29)
- 매출 히스토리 로드 시 이름 fallback 검색 제거 (동명이인 메모 잘못 매칭 방지)
- 고객 검색: 전화번호+이름 OR 조건으로 동시 검색

### 알림톡 조건 정리 (2026-03-29)
- 내부일정: 알림톡 절대 안 물어봄
- 전화번호 없음/010 아닌 번호: 안 물어봄
- 미배정→배정(칼럼 이동): 안 물어봄
- 시간 변경 + 010 고객만 팝업 표시

### 알리고 SMS 통합 & 케어 SMS 자동발송 (2026-04-24, v3.7.38)
- `alimtalk_queue.channel` 컬럼으로 알림톡/SMS 분기 (기본 'alimtalk')
- 서버 `alimtalk_thread`가 channel='sms'이면 `https://apis.aligo.in/send/` 로 발송 (key/user_id/sender/receiver/msg)
- 응답 성공: 알림톡 `code=0`, SMS `result_code=1`
- `care_sms_scheduler_thread` 5분 주기 — 각 지점 noti_config의 after_Nd 항목(N=5/10/21/35/53) 을 sendTime±2분 창에 발송
- `care_sms_log(reservation_id, days_after)` UNIQUE 로 중복 방지
- 국내 휴대폰(010~019)만, `customers.sms_consent !== false` 만 발송
- UI: AdminNoti 시술후 케어 알림 상세는 SMS 모드 (tplCode 숨김, 바이트 카운터, 테스트 전송 버튼)
- 알리고 크레덴셜은 기존 알림톡 설정(aligoKey/aligoId/senderPhone) 재사용

### Slash Commands (2026-03-29~30)
- `/deploy` — 빌드 → 서버 배포 → CF 퍼지 안내
- `/sync` — Oracle→Supabase 동기화
- `/check` — 서버 상태 + 로그 확인
- `/restart` — 서버 서비스 재시작 (bliss-naver, bliss-relay)
- `/logs` — 서버 로그 조회 (인자: 분 수, 기본 10분)
- `/naver-login` — 네이버 세션 갱신 (playwright)
- `/build` — 빌드만 실행 (배포 없이)

### Claude Code 확장 적용 (2026-03-30)
- **Hooks**: 작업 완료 시 텔레그램 알림 자동 전송, .env 편집 차단, Notification 텔레그램 전달
- **Rules**: 경로별 코딩 규칙 (timeline, messages, supabase, server)
- **settings.local.json**: 허용 규칙 간소화

### 버그 6건 수정 (2026-03-30)
- 직원근무표 → 타임라인 리얼타임 전달: 직원 추가/근무데이터 변경 시 타임라인에 실시간 반영
- 타임라인 설정 디폴트: 글자크기 13, 불투명도 50%
- 예약모달 수동입력 시 출근직원 목록: 현재 출근 직원만 정확히 표시
- 미배정칼럼 등록 시 이중 등록 해결: 다른 칼럼에 중복 기록 방지
- 시술상품관리 카테고리 순서 변경 시 리스트 즉시 반영
- 네이버 예약 변경건 데이터 반영 (김민진 건 포함)

### 근무표 락 상태 DB 저장 (2026-03-30)
- `lockStatus_v1` 키로 schedule_data 테이블에 월별 락 상태 저장
- 구조: `{ "YYYY-MM": { confirmed: bool, lockedDates: [] } }`
- 페이지 로드 시 DB에서 복원 → 새로고침해도 락 유지
- 월 변경 시 해당 월의 락 상태 자동 로드/해제
- 락 버튼 + 확정 해제 배너 모두 DB 저장 연동

### 근무표 드래그/Shift 복수 선택 + 전체 근무 버튼 (2026-03-30)
- 드래그로 여러 셀 선택 → 파란 하이라이트 → 벌크 편집 모달
- Shift+클릭으로 직사각형 범위 선택
- "전체 근무" 버튼: 잠금 날짜 제외하고 모든 셀에 "근무" 채움
- 이월 락 보호: 이전 달 확정 시 이월 날짜가 다음 달에서도 잠금 유지
- check-square 아이콘 추가

### 남자직원 주간 로테이션 지점 배치 (2026-03-30)
- `maleRotation_v1` 키로 schedule_data에 저장
- 구조: `{ empId: { branches: ["yongsan","magok","hongdae"], startDate: "2026-03-30" } }`
- 주 단위(월~일) 로테이션: `(날짜 - startDate) / 7` → branches 인덱스
- 근무표: 남자직원 근무일 셀에 지점명 태그 표시
- 근무표 설정: 남자직원 섹션에 로테이션 지점 순서 + 시작일 설정 UI
- 타임라인: useMaleRotation() 훅으로 로드 → BASE_EMP_LIST에서 동적 branch_id 매핑
- 재윤: 용산→마곡→홍대, 주용: 천호→위례→잠실 (3/30부터)

### naver_messages → messages 테이블 리네임 (2026-03-31)
- DB RPC `rename_naver_to_messages` 실행으로 테이블 리네임 완료
- 서버 코드 (bliss_naver.py, ai_booking.py): naver_messages → messages 전체 치환
- 앱 코드 (MessagesPage.jsx, AppShell.jsx, ReservationModal.jsx, TimelinePage.jsx): 전체 치환
- Realtime Publication도 messages로 변경 필요 (Supabase Dashboard에서 수동 확인)

### 이메일 필드 추가 (2026-03-31)
- DB: customers.email, reservations.cust_email 컬럼 추가
- DBMAP: email, custEmail 매핑
- 고객관리: 이메일 입력 필드 (이미 추가됨)
- 예약 모달: 고객명/연락처 아래 이메일 필드 추가
- 자동 고객 매칭 시 이메일도 가져옴

### 예약-채팅 연동 (2026-03-31)
- reservations 테이블: chat_channel, chat_account_id, chat_user_id 컬럼
- ai_booking.py: 예약 생성 시 채팅 정보 자동 저장
- 예약 모달 → 💬 대화보기 → 메시지함 해당 대화방 자동 이동
- 메시지함 → 📅 예약 라벨 → 타임라인 예약 모달로 이동
- 확정 버튼: chat 필드에서 직접 채널/user_id 읽어서 발송 (memo 파싱 불필요)

### 인스타 확정 메시지 발송 수정 (2026-03-31)
- SB_URL/SB_KEY import 누락 수정 (ReferenceError)
- 서버 send_queue_thread: Instagram DM 발송 이미 지원
- ai_booking.py: chat_channel/chat_account_id/chat_user_id 예약에 저장

### Cloudflare Browser Cache TTL (2026-03-31)
- "4 hours" → "Respect Existing Headers"로 변경
- nginx no-cache 헤더가 제대로 적용됨
- 배포 후 캐시 문제 해결

### 변경 예약 확정대기 버그 3-in-1 수정 (2026-04-08)
서버 `bliss_naver.py` 패치 (`bak_fix_pending` 백업):
- **action=new/change 강제 pending 버그**: `_process_one`에서 `action in ("new","change")`일 때 API가 `naver_cancelled`/`naver_changed`를 반환해도 `status="pending"`으로 강제 덮어쓰던 로직 수정. API가 종결 상태 반환 시 그것을 존중, 그 외에만 pending.
- 증상: `pending_rescrape_thread`가 action="new"로 재큐잉 → 네이버에서 취소/변경됐어도 pending으로 되돌아감. 변경 직후 새 예약도 confirmed로 저장되는 부작용.
- **rescrape NameError**: `pending_rescrape_thread` log.info에서 `row.get(cust_name,)` → `row.get('cust_name','')` 수정 (bareword 참조 버그).
- **db_upsert 디버그 코드 제거**: `_tb.print_stack()`, `[DEBUG_INSERT]`, `[MEMO_TRACE]`, memo hunter 스레드, `/tmp/bliss_insert_trace.log` 쓰기 전부 삭제.
- 테스트: 이정우 #1203449737 (변경 후 새 예약) → `confirmed`로 잘못 저장되던 것을 코드 수정 후 DB 수동으로 pending 교정.

### AI 분석 프롬프트 설정페이지 전체제어 (2026-04-08)
- 서버 `bliss_naver.py`: `_load_ai_settings()`에 `ai_analyze_prompt` 캐시, `ai_analyze_reservation()`에서 settings 프롬프트 있으면 전체 사용·비어있으면 하드코딩 fallback, 플레이스홀더 `{tags}{services}{cust_name}{visit_count}{naver_text}{custom_rules}`, `JSON_INSTRUCT`만 자동 부착
- 앱 `AdminAISettings.jsx`: "분석 규칙" 탭 상단에 "분석 프롬프트 (전체)" textarea 카드, `analyzePrompt` state, `businesses.settings.ai_analyze_prompt` 로드/저장
- 기존 `ai_rules` 리스트는 `{custom_rules}` 변수로 주입(하위호환)

### ReservationModal 고객 UX 개선 (2026-04-08)
- **변경 버튼 인라인 편집**: 기존 정보 유지한 채 이름·연락처 바로 편집. "완료"·"다른고객" 2단 버튼. 이름/전화 수정 시 custId 자동 해제
- **고객정보 ↗ 버튼**: `f.custId` 있을 때 노출. 클릭 시 모달 닫고 CustomersPage로 이동하면서 해당 고객 자동 검색·상세 패널 오픈. `pendingOpenCust` state를 AppShell → Timeline → ReservationModal → CustomersPage로 pipe
- **성별 자동 백필**: `custId` 있는데 `custGender` 비어있을 때 로컬 `data.customers`에서 우선 찾고, 없으면 `sb.get` 서버 조회 후 백필 (이메일도 동일)
- **아바타 남/여 표시**: 기존 이름 이니셜 → "남"/"여"/"?" 텍스트로 교체. 중복된 성별 배지 제거
- **미배정 드롭다운 옵션**: `<option value="|">미배정</option>` 기본옵션 추가 (예약 모드 + 내부일정 모드 2곳). 브라우저가 첫 option으로 fallback해 "지점명-첫직원"(예: "왕십리점-소연")으로 잘못 표시되던 버그 수정

### TimelinePage 블록 성별 백필 (2026-04-08)
- 예약 블록 렌더 시 `block.custGender`가 비어있으면 `block.custId`로 `data.customers`에서 성별 가져와 표시
- 이전: 네이버 예약처럼 `cust_gender=''`인 건 타임라인 블록에 "남/여" 안 보였음

### SaleForm 보유권 전액 차감 버그 수정 (2026-04-08)
- 증상: 시술가격 = 보유권 차감액일 때 `grandTotal = 0` → `grandTotal<=0` 체크에 걸려 alert만 뜨고 return → 매출등록 안 되고 **패키지 차감도 안 됨**
- 수정: 체크를 `svcTotal + prodTotal <= 0`(실제 시술/제품 선택 여부)로 변경. 보유권 전액 차감 시에도 매출등록·패키지 차감 정상 진행
- 참고: DB PATCH 자체는 정상 작동 확인(서버에서 직접 테스트)

### 고객관리 서버 페이지네이션 + 무한 스크롤 + 단일 고객 모드 (2026-04-08 오후)
- **AppShell 초기 로드 limit**: customers 500 → 100으로 축소 (타임라인/예약모달 자동매칭용만 유지)
- **CustomersPage 서버 페이지네이션**: PAGE_SIZE=50, 스크롤 하단 근접 시 다음 페이지 자동 로드
- **서버 쿼리**: `business_id/bid(userBranches)/is_hidden/검색 첫 토큰 OR ilike(name,name2,phone,phone2,memo,cust_num)` + 정렬 `join_date.desc.nullslast,created_at.desc` → DB 레벨에서 필터·정렬
- **클라이언트 AND 필터**: 다단어 검색 시 첫 토큰은 서버, 나머지는 클라이언트에서 AND 매칭
- **보유권 batch 로드**: 페이지 로드 시 해당 50명의 `customer_packages`를 IN 쿼리 1번으로 batch → N+1 방지
- **단일 고객 모드**: 예약모달 "고객정보 ↗" 클릭 → `pendingOpenCust`로 id 전달 → `lockSingleRef` + `singleMode` state로 리스트 자동 로드 차단 → `id=eq.{cust_id}`로 정확히 1건만 조회해서 상세 패널 즉시 오픈
- **"← 전체 목록" 버튼**: 단일 고객 모드일 때 헤더 좌측 표시, 클릭하면 락 해제 + 상세 닫기 + 전체 리스트 리로드. 검색어 입력·매장 변경 시에도 자동 해제
- **race condition 방지**: `pendingOpenCust` 처리 중 useEffect가 리스트 리로드 경합으로 단일 고객을 덮어쓰던 버그 해결

### 고객관리 테이블 개선 (2026-04-08 오후)
- 컬럼: 고객번호(monospace) · 등록일 · 이름(성별+name2+수신거부+숨김 배지) · 연락처(phone2 보조) · 매장 · 방문수 · 최근방문 · **보유권**(🎫 다담권 잔액 / 🎟 다회권 남은회차 pill, 연간/소진 제외) · 액션
- 정렬: `join_date.desc.nullslast,created_at.desc` (오라클 JOINDATE = 실제 가입 시각 기준, 없으면 bliss createdAt)
- cust_num은 text 타입이라 문자열 정렬 시 "9993 > 55721"로 뒤집혀서 정렬 기준으로 부적합 — join_date 사용이 정답

### oracle_sync.py 안정화 (2026-04-08 오후)
- SB_KEY 만료된 JWT → `sb_publishable_3H-KTP0MoV_KuY74ocbefw_3Ze5xBJj`로 교체
- Oracle MEMBER 테이블에 `NAME2` 컬럼 없음 확인 (컬럼 목록: NO/NAME/NICKNAME/SEXDIV/TEL/EMAIL/ADDRESS1/BIRTHDAY/JOINDATE/LASTDATE/MEMO/HIDDENNAME 등). SELECT에서 NAME2 제거, name2는 항상 null
- JOINDATE 동기화 추가 (신규/업데이트 양쪽)
- 수동 실행 결과: 신규 8명, 업데이트 998명, 매출 44건 추가

### 네이버 403 시간대 예약 일괄 재분석 (2026-04-08 오후)
- 2026-04-08 오전 Gemini API PERMISSION_DENIED로 `selected_services=[]`로 저장된 32건 발견
- 서버 직접 `ai_analyze_reservation()` 호출로 재분석: 2건 시술 매칭, 13건 태그만, 17건 여전히 빔 (이벤트 상품명이 원문이라 AI 매칭 불가 — HANDOFF에 기록)

### SaleForm 보유권 전액 차감 매출등록 버그 (2026-04-08)
- 증상: 시술가=보유권 차감액일 때 `grandTotal=0` → `<=0` 체크 걸려 alert만 뜨고 return → 매출등록·패키지 차감 모두 실패
- 수정: 체크를 `svcTotal + prodTotal <= 0`로 변경. 보유권 전액 차감 시에도 정상 진행

### ReservationModal 고객 UX 개선 (2026-04-08)
- **변경 버튼 인라인 편집**: 기존 정보 유지한 채 이름·연락처 바로 편집. "완료"·"다른고객" 2단 버튼
- **고객정보 ↗ 버튼**: `f.custId` 있을 때 노출. 클릭 시 모달 닫고 CustomersPage 단일 고객 모드 오픈
- **성별 자동 백필**: `custId` 있는데 `custGender` 비어있으면 로컬 `data.customers`에서 찾고 없으면 서버 조회
- **아바타 남/여 표시**: 이름 이니셜 → "남"/"여"/"?"
- **미배정 드롭다운 옵션**: `<option value="|">미배정</option>` 기본옵션 추가. `roomId=staffId=''`일 때 브라우저가 첫 option(예: "왕십리점-소연")으로 fallback하던 버그 해결
- **보유권 pill 표시**: 유효한 다담권/다회권을 고객칩 아래 pill로 (소진/연간권은 제외, 유저 요청에 따라 간결하게)

### TimelinePage 블록 성별 백필 (2026-04-08)
- `block.custGender` 비어있으면 `block.custId`로 `data.customers`에서 찾아 "남/여" 표시

### 예약목록 네이버 예약정보 검색 확장 (2026-04-08)
- 기존: custName/custPhone/serviceName/staffName만
- 추가: reservationId, memo, requestMsg(네이버 JSON 전체), ownerComment, visitorName/Phone, custEmail
- 예: "음모왁싱", "재방문", "1203011" 등 네이버 원문 키워드로도 검색

### 매출 통계/관리 지점 필터 (2026-04-08)
- SalesPage, StatsPage 지점 드롭다운에 `userBranches` 필터 적용 (권한 없는 지점 미노출)

### Cloudflare 퍼지 자동화 (2026-04-08)
- `.env`에 `CF_ZONE`/`CF_TOKEN` 저장되어 있음
- `/deploy` 슬래시 커맨드에 퍼지 로직 포함
- **수동 배포 시에도 마지막 단계로 반드시 퍼지 실행** (memory feedback 저장)
- 명령: `source .env && curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" -d '{"purge_everything":true}'`

### customers 스키마 확장 (2026-04-08)
- SQL 실행 완료: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 text, cust_num2 text, name2 text`
- db.js DBMAP/DB_COLS에 추가 반영

### 고객관리 테이블 뷰 + name2 / 매출등록 고객검색 확장 (2026-04-08)
- 고객관리 리스트: 카드형 → **DataTable 테이블 뷰**로 전환. 컬럼: 등록일 · 이름 · 연락처 · 매장 · 방문수 · 최근방문
- 이름 컬럼에 `name2` 괄호 표기, 연락처 컬럼에 `phone2` 보조 표시
- Oracle NAME2 동기화 완료 후 기존 고객도 자동으로 `name2`가 채워짐
- 매출등록 고객 검색(`SaleForm`): 기존 단일 필드(name 또는 phone) → `name/name2/phone/phone2` OR 부분 검색으로 확장. 숫자/한글 자동 판별 제거
- customers 스키마: `phone2`, `cust_num2`, `name2` 컬럼 추가 (SQL 완료)

### 고객관리 phone2 / 다단어 검색 / joinDate 정렬 (2026-04-08)
- `db.js`: customers DBMAP/DB_COLS에 `phone2`, `cust_num2`, `join_date`, `sms_consent` 추가 (기존에 DB_COLS 누락으로 join_date/sms_consent가 저장 안 되던 문제도 함께 복구)
- CustomersPage:
  - 다단어 부분 검색: 공백 구분 토큰 AND 매칭 (예: "정우 8008" → 이름+전화에 각각 포함되면 매치). name/phone/phone2/memo/custNum/custNum2 전부 대상
  - 정렬: `joinDate` 우선 최신순, 없으면 `createdAt` 최신순
  - 리스트: `phone` 뒤 `/ phone2` 표시
- CustModal: "연락처 2 (선택)" 입력 필드 추가 (동일 고객 병합용)
- **DB 스키마 변경 필요**: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 text, ADD COLUMN IF NOT EXISTS cust_num2 text;` (HANDOFF.md 참고)

### oracle_sync.py JOINDATE 동기화 (2026-04-08)
- 신규/업데이트 양쪽에 `join_date` 필드 반영 (`JOINDATE` → `YYYY-MM-DD` 문자열)
- 다음 Windows Task Scheduler 실행(새벽 3시)부터 반영

### 매출 통계/관리 지점 드롭다운 필터 (2026-04-08)
- SalesPage, StatsPage 지점 select에서 `data.branches`를 `userBranches`로 필터 (권한 없는 지점 미노출)

### Cloudflare 퍼지 자동화 (2026-04-08)
- `.env`에 이미 `CF_ZONE` / `CF_TOKEN` 저장되어 있고 `/deploy` 슬래시 커맨드에 퍼지 로직 존재
- **수동 배포 시에도 마지막 단계로 반드시 퍼지 실행** (memory feedback 저장)
- 명령: `source .env && curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" -d '{"purge_everything":true}'`

### 회원가(Member Pricing) 시스템 (2026-04-13)
- DB: services 테이블에 `member_price_f`, `member_price_m` integer 컬럼 추가
- 10개 시술에 회원가 설정 (브라질리언 계열, 케어, 풀페이스, 속눈썹 등)
- db.js: DBMAP/DB_COLS에 memberPriceF/memberPriceM 매핑
- SaleForm: `_defPrice()` 함수 — 보유권 자격에 따라 회원가 자동 적용
- 회원가 자격: 다담권/다회권/연간회원권/연간할인권 보유 시 (에너지이용권/제품구매권 제외)
- AdminSaleItems: 회원가 표시(→화살표) + 편집 폼 입력 필드
- ReservationModal: 시술 가격에 회원가 반영

### 매출 리스트 상세 표시 + AI 디버그 정리 (2026-04-13)
- SalesPage: sale_details 레이지 로딩 + PaySummary 컴포넌트 (결제수단 표시)
- 프로덕션 코드에서 debug alert()/console.log() 전량 제거
- oracle_sync.py: 이름 없는 매출 Oracle MEMBER 직접 조회 fallback
- sale_details 중복 237K건 + sales 중복 60K건 삭제 (FK 처리 포함)

### 설정마법사 대화형 완성 + 버그 수정 (2026-04-14)
- photo_upload/complete 스텝에 systemPrompt 추가 → 전 스텝 Gemini 대화 가능
- 한국어 IME Enter: onKeyDown → onKeyUp (isComposing 문제)
- 수동모드(parsedData._manual) 분기 수정
- employees_v1 upsert로 중복키(23505) 해결
- login_local.py: CDP Network.getAllCookies로 NID_AUT 캡처 (httpOnly 대응)
- 서버 AI 메모 쓰기(owner_comment) 비활성화

### 매출 편집/상세 대형 리팩토링 (2026-04-17, v3.1.0 → v3.1.9)

#### 매출 상세(sale_details) 테이블 전면 개편
- SalesPage: 매출 행 확장 시 sale_details 테이블 렌더링 재설계 (시술/제품명 · 금액 · 수량 · 🗑 삭제)
- 항목별 🗑 삭제 버튼 — `sb.del("sale_details", id)` + detailMap state 동기화
- sale_details 결제수단 비율 분배 제거 — `cash/card/bank/point` 모두 0으로 저장, 유저가 직접 정리

#### 매출 편집 모드(openFullEdit → DetailedSaleForm editMode=true)
- **순수 기록 모드** — 고객 보유권·패키지 거래·포인트 잔액은 절대 변경 안 함 (`customer_packages`/`package_transactions`/`point_transactions` 미수정)
- **결제수단 금액은 수정 가능** — 원래 누락됐던 경우 교정용. 저장 시 `sales.svc_cash/transfer/card/point` + `prod_*` 전부 업데이트
- **기존 값 자동 프리필** — 편집 모달 열 때 `reservation`에서 결제수단 값 + 체크된 탭 자동 복원
- **existingDetails → items 자동 프리필** — sale_details 읽어서 시술·제품·추가시술·할인·보유권 사용까지 전부 체크 상태로 복원
- **금액 변동 경고창** — 원래 값과 다르면 confirm으로 변경 내역 및 총합 차이 표시 후 진행 여부 물음
- **"저장 후 계속" 버튼** — 신규 모드 전용. 저장 후 모달 유지 + formKey 증가로 폼 리마운트(완전 초기화) → 연속 등록 가능
- **할인(`[할인]`) + 보유권 사용(`[보유권 사용]`/`[보유권 차감]`) 행도 sale_details에 기록** — 편집 재진입 시 복원 위해

#### 중복 매출 방지
- `_submitLock` ref로 저장 중 클릭 차단 (3초 락). 문준현 67초 간격 중복 사례 분석 후 도입
- 동일 금액 기반 중복 판정은 오검지 위험 커서 제외. 실제 원인은 "처리 중 재클릭" → submitLock이 근본 대책

#### 할인 필드 UX 개선
- `SaleDiscountRow`: input 항상 활성화, 금액 입력 시 자동 체크 / 0으로 지우면 자동 해제
- 편집 모드에서 체크 안 된 상태로 disabled 보이던 문제 해결

#### 고객번호(cust_num) 누락 버그 수정 + 일괄 backfill
- **DB 41건 backfill** — `UPDATE sales SET cust_num = customers.cust_num WHERE empty` 일괄 수정
- **루트 원인**: `selectCust`가 `custNum` 안 세팅 + `data.customers` 페이지네이션 제한으로 `localCust=undefined` → `fetchNextCustNum` 실패 시 빈값 저장
- **수정**: 매출 저장 직전 `cust.id`만 있고 `custNum` 비어있으면 `setData` 유무 무관하게 서버에서 cust_num 즉시 조회 보정
- **UI**: SalesPage에 "고객번호" 별도 컬럼 추가(monospace, 80px), 없는 경우 빨간색 "없음" 표시

#### TDZ 에러 수정
- 편집 모드 `isPkgUseSubmit` 변수 선언 전 참조 → 압축 후 `Cannot access 'k' before initialization` 오류
- 편집 메모에서 `[패키지 사용]` 접두사 참조 제거 (편집 모드엔 불필요)

#### extra_svc/extra_prod 라벨 저장 버그
- `items.extra_svc.name` (undefined) → `items.extra_svc.label` 사용
- 신규 매출 + 편집 양쪽 반영

### 주의사항 (다음 세션에서 참고)
- Cloudflare 캐시: 배포 후 반드시 Purge Everything (Dashboard → blissme.ai → Caching)
- schedule.html: 서버 배포 시 /var/www/html/bliss-app/schedule.html 별도 복사 필요
- Supabase Free Plan: Egress 한도 초과 상태 (4/24 리셋). 폴링 제거 완료로 해결
- 서버 pyOpenSSL: oracledb 설치 시 충돌 주의 (이미 해결)
- prev_reservation_id: BLISS_PRESERVE_FIELDS에 포함 (confirm 시 덮어쓰기 방지)
- reservation_id: NULLS NOT DISTINCT unique constraint → AI 예약에 고유값 필수
- 매출 편집 시 sales 테이블 금액 필드도 업데이트됨 (v3.1.4~). 금액 변동 경고창으로 실수 방지 (v3.1.5)
- 매출 있는데 cust_num 비어있는 케이스 0건 확인 완료 (v3.1.9 backfill 기준)

### 포인트·이벤트 시스템 개편 (2026-04-19~20, v3.3.51 → v3.3.81)

#### 범용 이벤트 엔진
- `src/lib/eventEngine.js` 신규 모듈: `evaluateTrigger()` + `applyEvents()`
- 트리거 3종 (`new_first_sale` / `prepaid_recharge` / `pkg_repurchase`), 보상 6종 (`point_earn` / `discount_pct` / `discount_flat` / `coupon_issue` / `prepaid_bonus` / `free_service`), 기준 5종 (`svc` / `svc_prod` / `prepaid_amount` / `category` / `services`)
- 매장별 커스텀 하드코딩 절대 금지 — `DEFAULT_EVENTS` 전부 제거, 매장마다 UI로 생성
- 마스터 스위치 `businesses.settings.events_master_enabled` (현재 전 매장 false)
- **2중 잠금**: 마스터 ON + 개별 이벤트 ON + 조건 충족 모두 만족해야 반영
- memory 기록: `feedback_bliss_multitenant.md`

#### 이벤트 관리 UI (관리설정 → 이벤트 관리, `coupons` 라우트)
- `AdminEvents.jsx` 새 컴포넌트 + `AdminCoupons`는 내부 탭 하나로 재사용
- "쿠폰 관리" → **"이벤트 관리"** 리네임
- 2개 탭: 💥 이벤트 등록 / 🎫 쿠폰 등록
- 스위치 토글 + 카드 내부 ON/OFF + 커스텀 이벤트 추가/삭제/수정
- CatPicker/SvcPicker (카테고리/시술 복수 선택) — 쿠폰 엔진과 동일 UX
- 배지: 🟢 반영중 (엔진 지원) / ⚪ 미구현 (지원 외)

#### 포인트 유효기간 + 히스토리
- DB: `point_transactions.expires_at/source/expired_tx_id` 컬럼 추가
- pg_cron `record_expired_points()` 매일 00:05 KST 만료 처리
- `type='expire'` 트랜잭션으로 히스토리만 기록 (잔액 계산에서 제외)
- 고객관리 PointPanel 적립 시 유효기간 선택 (없음/1/3/6/12개월), 만료 배지 표시

#### 10% 쿠폰 → 포인트 소급 전환 (마이그레이션)
- 관리설정 → 데이터 관리 → 포인트 설정 (임시, 안정화 후 삭제 예정)
- 2개 탭: 📝 매출메모 소급 / 🎫 유효 쿠폰 보유자
- Materialized view `point_migration_candidates` (매출 메모 regex 파싱) + `refresh_point_migration_candidates()` RPC
- View `point_coupon_holders` (유효 쿠폰 대상자)
- 처리 결과: 280명 / 2,842,452P (시술만 10%, 제품 제외, 패키지 구매자 제외)
- 쿠폰 172장 삭제, 유효 0장, 만료 1,092장만 기록 보관

#### SaleForm 매출등록 반영
- 이벤트 엔진 호출 → pointEarn / 할인 / 쿠폰 자동 발행 자동 적용
- 외부선결제가 제품 없는 매출에서 시술합계에 포함 (`extToSvc`)
- 쿠폰·포인트 카테고리는 SVC_LIST에서 제외 (구매 대상 아님)
- 매출 등록 시 쿠폰 수동 발행 UI (수량 선택) + 고객관리에도 드롭다운
- 포인트 사용 UI 2줄 레이아웃, 전액 버튼, 콤마 포맷
- 매출 등록 시 예약 시술시간 자동 조정: 축소만 허용 (수연 수정요청 id_tgvgfsjvoz)

#### 팀채팅 서버 저장 + 공지 배너 (v3.3.55~60)
- DB: `team_chat_messages` 테이블 + Realtime publication
- ChatInput에 📣 확성기 토글 → `is_announce=true` 메시지는 전체 배너
- 배너 클릭 dismiss → localStorage 기록, 재접속해도 복원 안 됨
- 24시간 내 dismiss 안 된 공지는 재접속 시 복원
- 모바일에서는 사이드바 대신 **받은메시지함** 페이지에 탭 추가
- 사이드바 채팅 영역: 2줄 헤더 → 한 줄(팀채팅/이름/펼치기) 컴팩트, #·아바타·온라인카운트 제거

#### 네이버 스크래퍼 신규 고객 자동 생성 (서버 수정)
- `/home/ubuntu/naver-sync/bliss_naver.py` (bak_cust_autocreate 백업)
- 전화번호로 기존 고객 매칭 실패 시 → customers 테이블에 INSERT
- **cust_num은 비움** — 매출 발생 시 앱 SaleForm의 `fetchNextCustNum`이 부여
- 예약 cust_id에 새 고객 ID 연결
- 유령 고객 3명 수동 복구 (Elaine 70079, 홍유진, Amy Lin)

#### 타임라인·예약 UX 수정
- 빈 지원 칼럼 제거 (getWorkingStaff: segments에 원래 지점 없고 내용 없으면 push 안 함, v3.3.51)
- 막대바 양끝 시간이 직원 근무시간 반영 (empWorkHours 다층 키 lookup, v3.3.51)
- 근무표 미등록 직원은 타임라인 제외 (dayStatus 없으면 return, v3.3.51)
- 지원 partial 축소 처리: 수연 왕십리(11~18:30)+강남(18:30~) 케이스 정상 (v3.3.54)
- 모바일 롱프레스 즉시 floating preview + pop-in 애니 + 진동 패턴 (v3.3.52~53)
- 예약 모달 데스크탑 X 버튼 추가 (v3.3.64)
- 예약금완료 태그 저장 버그 수정 (ReservationModal.jsx:1400 자동 제거 로직 삭제)

#### 고객관리 다토큰 검색 (v3.3.74)
- "이정 8008" 처럼 이름 부분 + 전화 부분 AND 검색
- 서버에서 전 토큰 AND 필터 (`and=(or(...),or(...))`) — 기존 첫 토큰만 서버 방식은 100건 페이지 벗어나 누락

#### 외부 플랫폼 설정
- `businesses.settings.external_platforms` — 서울뷰티/크리에이트립/입금 저장
- 매출 등록 시 "입금(계좌이체)" 드롭다운 옵션 추가

#### 수정요청 처리 (전부 done)
- id_mj1wxf0q69 서현 · id_ubcyc5lojp 민아 · id_tgvgfsjvoz 수연 · id_c8cj6n04hl 정우 10% 쿠폰 · id_xe85iyyvcj 미진 · id_puhjs8t4lv 소이 · id_821i3dfsdq 미진

### 주의사항 (v3.3.81 이후 참고)
- **멀티테넌트 원칙**: 매장 특화 하드코딩 금지. 이벤트/쿠폰은 설정 기반 범용 엔진만 (memory 기록)
- 이벤트 엔진 마스터 스위치 현재 OFF (관리설정 → 이벤트 관리 상단 🔴)
- 템플릿 이벤트 없음 (유저가 직접 생성)
- `10%추가적립쿠폰` 만료분 1,092장 DB에 기록용 보관 (삭제 요청 올 때까지 유지)
- `events` 배열에 `evt_custom_*` ID가 커스텀, 그 외는 템플릿(지금은 없음)
- `prepaid_bonus` 보상: 현재 엔진이 금액만 계산, 다담권 잔액 실제 가산 로직은 미구현 (다음 단계)

### 이벤트 엔진 v2 — 스키마 확장 (2026-04-21, v3.4.0 → v3.5.37)
- 트리거 5종: `new_first_sale` / `prepaid_purchase` / `pkg_purchase` / `annual_purchase` / `any_sale`
- 조건 빌더: `servicesAny/All/None` · `categoriesAny` · `prepaid/pkg/annualServiceIds` · `amountMin/Max` · `customerHasActive{Prepaid/Pkg/Annual}`
- 보상 최대 3개/이벤트: `point_earn` (base: svc/svc_prod/prepaid_amount/pkg_amount/category/services/fixed/net_pay) / `discount_pct` / `discount_flat` / `coupon_issue` / `prepaid_bonus` / `free_service`
- 2-pass 평가: 1pass 할인/쿠폰/보너스 → netAmount 계산 → 2pass point_earn (net_pay 반영)
- 할인 풀별 cap: `discountFlat` / `discountFlatPkg` / `discountFlatPrepaid` / `discountFlatAnnual` 독립
- 레거시 정규화: `rewardType` 단일 → `rewards[]` 래핑. `prepaid_recharge`/`pkg_repurchase` → `*_purchase` + `customerHasActive*` 조건 자동 추가
- UI: 매출등록에 "🎉 적용된 이벤트" 보라 박스 (이벤트명 + 보상 요약)

### 쉐어 기능 (2026-04-21, v3.5.0 → v3.5.37)
- `customer_shares` 테이블: `{id, business_id, cust_id_a, cust_id_b}`
- **보유권별 쉐어 공유 토글** — `customer_packages.note`에 `| 쉐어:Y` 플래그
- 기본값 OFF: 명시적으로 켜야 쉐어 대상 됨. 개인권 노출 방지
- 매출등록 시 본인 vs 쉐어 **소유자별 분리** (v3.5.37 groupKey = `이름∷self|shared_{cust_id}`)
- **쉐어 남녀 보정금** — 여자 소유 다회권을 남자 사용 시 회당 +33,000원 자동 추가
- 고객관리 쉐어 탭 + ShareCustModal (다토큰 검색 + 신규 고객 즉석 생성)

### 공지 & 요청 (2026-04-21, v3.5.0)
- 사이드바 `수정 요청` → `📢 공지 & 요청`
- `bliss_notices_v1` (공지) + `bliss_requests_v1` (요청) schedule_data 분리 저장
- 공지 이미지 **다중 첨부** (images 배열, Ctrl+V 지원)
- 등록 후에도 마스터가 이미지별 편집/삭제 가능
- `imageData`(단일) → `images`(배열) 자동 호환

### MarkupEditor (2026-04-21, v3.5.35)
- `src/components/common/MarkupEditor.jsx`
- 도구: 펜(자유선) / 사각형 / 화살표 / 텍스트
- 색상 6종 (빨강/노랑/초록/파랑/검정/흰색) + 굵기 4단계 (2/4/8/12)
- Undo / Clear / Save (원본 해상도 PNG)
- 마우스/터치 모두 지원, ESC 닫기
- 공지·수정요청 양쪽에서 사용 (신규 + 등록된 이미지 모두 편집 가능)

### UX 개선 (v3.5.0 → v3.5.37)
- **모든 모달 ESC 닫기**: ReservationModal · DetailedSaleForm · ASheet · QuickBookModal · Reservations Modal · SmartDatePicker
- **AI 자동답변 시각화**: 🤖 보라 아바타 + "🤖 AI 자동응답" 배지 (MessagesPage 2곳)
- **유효 패키지 최초 구매지점 이니셜** (N/W/H/M/J/R/Y/C): 타임라인 블록·예약모달·고객리스트 고객명 앞 배지
- **당일취소/당일변경 카운트 분리**: 고객관리 상세 통계 (`updated_at.date === reservation.date`)
- **케어 카테고리 행 클릭 토글**: 브라질리언과 동일한 UX + +/- 버튼 분리
- **매출 확인 모드 (viewOnly)**: 예약모달에서 기존 매출 확인 시 읽기전용 + "매출관리에서만 수정" 안내

### 구매지점 제한 시도 → 롤백 (v3.5.31 → v3.5.32)
- 다담권/다회권/연간권 구매지점에서만 사용하도록 제한
- `customer_packages.note` `매장:XX` 플래그 기반 + `canUsePkgAtBranch()` 헬퍼
- **롤백 이유**: 데이터 불완전 (`매장:마곡/홍대` 복수값, 잘못된 지점명)
- 현재: 제한 해제, `canUsePkgAtBranch()` 항상 `true`
- **규칙 확정**: "구매지점에서만 사용 / 회원가는 전 지점" — 전수조사 후 재활성화 예정 (id_ebgbebctt3)

### 세션 복구 시스템 — 서버 Phase 1 (2026-04-21)
- `/home/ubuntu/naver-sync/session_recovery.py` 신규 모듈
- Supabase `schedule_data` 기반:
  - `session_status_v1`: `{status, since, reason, last_alert_at, alert_count}`
  - `captcha_request_v1`: `{req_id, image_b64, created_at}`
  - `captcha_answer_v1`: `{req_id, answer, created_at}`
- 텔레그램 알림 스케줄러: 주간(09:00~23:55) 5분마다 / 야간(00:00~08:59) 1회만 / 야간→주간 전환 시 즉시 재알림
- Flask 엔드포인트 4개 (port 5055):
  - `GET /session-status`, `POST /session-status` (복구 알림)
  - `POST /captcha-request` (로컬이 스크린샷 제출 → 텔레그램 전송)
  - `GET /captcha-answer?req_id=XXX` (로컬이 답변 폴링)
  - `POST /captcha-clear` (정리)
- 기존 TG bot에 캡차 답변 인터셉트 (pending 상태일 때 non-/ 메시지를 답변으로 저장)
- **env.conf 포맷 수정**: systemd `Environment=` 프리픽스 추가 (기존 TG 봇 동작 불능이었음)
- **Keepalive 주기 24h → 2h**
- **API 204 응답도 auto_relogin 트리거** (기존 401/403만)
- **Phase 2-4 보류**: 로컬 watchdog.py + login_local.py 캡차 자동화 + Task Scheduler

### AI FAQ 250개 등록 (2026-04-21)
- `businesses.settings.ai_faq` 배열
- 카테고리별: 사후관리&트러블 40 / 남성고객 41 / 매장편의 40 / 위생안전 40 / 임산부 40 / 주기효과 40 / 기타 9
- 구조: `[{q, a, active, category}]`

### 버그 수정 (v3.5.x)
- **React #300 Rules of Hooks** (v3.5.27): `ReservationModal._overlayDownRef`가 early return 뒤 → hook count 변동. 앞으로 이동
- **SaleForm prepaid 잔액 파싱 fallback**: `잔액:` 없으면 `total_count - used_count` 사용 (구버전 데이터)
- **다회권 setPkgQty 본인+쉐어 분리** (v3.5.37): 동명 패키지에 소유자 다른 것 섞이는 문제 해결

### v3.6.0 → v3.6.11 (2026-04-21)

#### 클로드 AI (v3.6.0)
- `src/components/BlissAI/` 신규 디렉토리
  - `BlissAI.jsx` 메인 멀티세션 채팅
  - `contextBuilder.js` FAQ + 정적 컨텍스트
  - `dataQuery.js` 고객/매출/예약 조회 + LLM intent 분류
  - `actionSchemas.js` 21개 쓰기 액션 스키마
  - `actionRunner.js` 쓰기 실행 + 감사 로그
  - `ActionConfirmCard.jsx` diff 확인 UI
- 설정마법사 흡수 → 대화형 모드
- 권한: 브랜드 대표만 쓰기, 지점은 읽기
- Gemini 2.5 Flash, FAQ 250개 (`businesses.settings.ai_faq`)

#### 긴급 수정 (v3.6.1 ~ v3.6.5)
- 구매지점 이니셜 배지 제거 (v3.6.1)
- **settings JSON 문자열 스프레드로 이벤트 15개/FAQ 250개 소멸 사고 + 복구** (v3.6.2)
- 회원가 초기값 계산 누락 수정 (v3.6.2~3): useMemo 파싱 + custPkgs 로드 후 재계산
- 일정변경 로그를 memo → `schedule_log` 컬럼 분리 + 기존 17건 마이그레이션 (v3.6.4)
- 이벤트 "유효한 연간/패키지/다담권 보유" 만료 체크 버그 — `expires_at` 미존재, `note` "유효:YYYY-MM-DD" 파싱으로 대체 (v3.6.5)

#### 이벤트 엔진 확장 (v3.6.6 ~ v3.6.8)
- 결제수단 섹션 추가: `paymentUsesPrepaid/paymentFullPrepaid/paymentUsesPoint/paymentUsesCoupon` TriFlag 조건 (v3.6.6~7)
- TriFlag 재클릭 해제, 편집폼 인라인 배치, 라벨 간결화 (v3.6.8)

#### 고객관리 정렬 (v3.6.9)
- `cust_num_int` generated column 추가 → PostgREST 숫자 정렬
- `includeNoNum` 토글 (디폴트 OFF) — 매출 없는 고객 숨김

#### 🎁 체험단 무료 제공 (v3.6.10 → v3.6.11)
- **DB**: `sales.svc_comped` / `sales.prod_comped` integer 컬럼
- **db.js**: DBMAP/DB_COLS에 매핑 추가
- **SaleForm**:
  - 예약태그에 "체험" 포함 시(`hasCompedTag`) 활성화
  - 체크된 시술·제품 행에 🎁 토글 버튼 → `items[id].comped`
  - `svcCompedTotal/prodCompedTotal` 집계 → `svcPayTotal/prodPayTotal/grandTotal` 차감
  - `sale_details.service_name`에 `[체험단] ` 프리픽스 → editMode 재진입 시 복원
  - 금액 변경 경고창 labelMap에 체험단 포함
  - **v3.6.11: 시술 헤더 위 주황 안내 배너** (hasCompedTag=true일 때 상시 노출)
- **SalesPage**: 매출 확장 행에 `🎁 체험단` 배지

### 주의사항 (v3.6.11 이후 참고)
- **배포 모드: 모아서 한 번에** — 수정 누적 → "배포" 신호 시 한 번에
- **배포 시 BLISS_V + version.txt 반드시 함께 bump** (불일치 시 무한 reload 루프)
- **settings 수정 시 반드시 JSON.stringify 후 저장** — 문자열 스프레드 금지 (v3.6.2 사고)
- **구매지점 제한은 현재 OFF** — 데이터 전수조사 선행 필요
- **세션 복구 Phase 2-4 보류** — 로컬 watchdog + captcha 자동화 미완
- **`login_local.py`는 수동 실행** — 세션 만료 시 텔레그램 알림만 나옴 (자동 복구 미완)

### v3.7.0 → v3.7.2 — 예약/매출/구매지점/회원가 리팩토링 (2026-04-22)

#### 예약 상태 기본값 변경: `confirmed` → `reserved`
- 서버 `bliss_naver.py` STATUS_MAP 전체 `confirmed → reserved` (AB00, RC02/03/04/RC08 + default). 보호 로직은 reserved/confirmed 둘 다 허용 (기존 데이터 호환)
- 앱: TimelinePage Auto-fix `pending → reserved`, ReservationModal AI 예약 확정 버튼도 `reserved`로 저장
- 유저 정책: "예약중(reserved)이 디폴트, 진행(confirmed)은 수동"

#### 타임라인 UX
- `selDate` sessionStorage 제거, `useState(todayStr())` — 새로고침·재진입 시 항상 오늘
- 새로고침 시 스크롤도 현재시각으로 (`performance.navigation.type === 'reload'` 감지 → `tl_scroll` sessionStorage 초기화)
- 사이드바 좌상단 이름 클릭 → `/timeline` 이동 + 새로고침
- 근무시간 편집 드롭다운 30분 → 10분 단위 (6:00~23:50)
- 근무외 시간 빈 슬롯 onClick에 `isDragging.current` 체크 추가 (블록 드래그 후 새 모달 뜨던 버그)

#### 데이터 로드
- AppShell reservations 초기 로드 `limit=3000` → 과거 180일 + `limit=20000` (단기 해결)
- 장기 Lazy-load 리팩토링은 HANDOFF에 PENDING

#### 회원가 적용 규칙 관리 페이지 (신규) — `AdminMemberPriceRules.jsx`
- 관리설정 → 사업장 관리 → "회원가 적용 규칙"
- `businesses.settings.member_price_rules` = `{ annualEnabled, prepaidMin, excludeServiceIds[] }`
- 연간회원권/선불권 자격 토글 + 선불권별 제외 체크박스 (바프권 30만 같은 상품)
- SaleForm에서 `_excludedSvcNames` Set으로 판정 시 제외

#### 타지점 이용 시 회원가 인정 (id_ebgbebctt3)
- SaleForm에서 보유권 로드를 2갈래로 분리:
  - `validPkgs` — 전 지점 유효 보유권 → `isMemberPrice` 판정용
  - `activePkgs` — `canUsePkgAtBranch` 통과 필터 → 차감/사용용
- 타지점 구매 보유권: 사용 불가, 회원가만 인정

#### 보유권 구매지점 교정 2,178건
- 단일지점 방문 고객 교정 2,058건 (sales.bid 기반 UPDATE)
- 강남점 디폴트 fallback 교정 118건 — 매출 있는 고객 중 강남점 매출 없는데 `branch_id=강남점`인 케이스 → 최다 방문 지점으로
- 김도윤(48996) 2건 왕십리 개별 교정
- 남은 12건은 매출 기록 없는 직원/테스트 계정 (보류)

#### 구매지점 조사 view 확장 (`customer_pkgs_branch_audit`)
- `reason` 컬럼 추가: `null` / `mismatch` / `no_sales`
- 유효기간 만료 제외 (`note`의 `유효:YYYY-MM-DD` 문자열 비교, 잘못된 날짜 방어)
- `current_bid` 컬럼 추가
- `AdminBranchAudit`에 reason 탭 3개 + reason 배지

#### RPC 생성 `auto_assign_pkg_by_sale_event(p_biz_id, p_dry_run)` (PENDING 실제 적용)
- 유효기간에서 -12개월로 예상 구매일 추정
- `sale_details.service_name ILIKE '%첫단어%'` + 날짜 ±60일 내 매출 찾기
- 가장 가까운 sale의 `bid`로 업데이트
- Dry-run 11건 매칭 / 58건 no_match

#### 당일 취소 페널티 로직 (id_imgr471swt-6)
- ReservationModal에서 `status === "cancelled"` 신규 전환 + `f.date === todayStr()` + custId 있을 때
- confirm 팝업 후:
  - 포인트 + 선불권 ≥ 33,000: 포인트 → 선불권 순 차감
  - 부족 시: 다회권 1회 차감 (유효기간 빠른 것 우선)
- **매출 자동 기록**: sales + sale_details INSERT, memo에 차감 상세
  - `service_name`: "당일취소 페널티" / "당일취소 페널티 (다회권: XXX 1회)"
  - `svc_point`: 포인트 차감액, `external_prepaid`: 선불권 차감액

#### 수정요청 6건 status=done 일괄 처리 (DB)
- id_uqokfx24ki, id_o3vgbpcf7l, id_2t1n4mbjbe, id_jre7s0tma6, id_ebgbebctt3, id_imgr471swt

### 주의사항 (v3.7.2 이후 참고)
- **구매지점 제한(`canUsePkgAtBranch`) 이미 작동 중** — NULL 허용, 동일지점/그룹/예외만 통과. 이전 HANDOFF "제한 해제" 기록은 폐기
- **서버 네이버 예약 저장: `reserved`** — `confirmed`(진행)은 유저 수동 변경만. 기존 `confirmed` 데이터도 보호 로직에서 호환
- **회원가 규칙 수정 시 `businesses.settings` 전체 parse → 수정 → stringify** (JSON 문자열 내부)
- **v3.7.0이 서버에 덮어써지는 경쟁 케이스 발생** — v3.7.1 재배포로 복구. 배포 후 `curl live version.txt` 반드시 검증
- **WhatsApp rate limit**: 24h 단위로 걸림. 1회라도 여러번 재요청하면 같은 번호 OTP 전부 차단 (SMS + 음성 통화 둘 다)

### v3.7.391 → v3.7.408 — 베타 격리 + 동반자 묶음 + 핫픽스 (2026-05-03)

#### 베타 타임라인 데이터 격리 (v3.7.395)
- `reservations.is_beta boolean default false` 컬럼 + `idx_reservations_is_beta` partial index
- AppShell의 reservations 5개 fetch (초기 + visibilitychange + online + 60초 폴링 + 과거 lazy load) 모두 `&is_beta=eq.false` 필터
- Realtime 핸들러에서 `payload.new.is_beta === true`면 라이브 state 업데이트 차단
- TimelinePage가 `betaGroupMode=true`일 때 `data` prop을 `_liveData`로 받고 useMemo wrap → `_betaReservations` 별도 fetch (30초 폴링) 후 reservations만 교체
- `setData` wrap: 베타 모드면 reservations 변경만 `_setBetaReservations`에 격리, 다른 필드(고객·매출 등) 변경은 무시 → 라이브 보호
- 베타에서 만든 예약 핸들러: 알림톡 큐 INSERT 차단(3곳), 자동 고객 생성 SKIP, ReservationModal 매출등록 버튼 disabled
- ReservationModal·TimelinePage handleSave에 `if (betaGroupMode) item.isBeta = true` 강제 마킹 + sb.upsert 시 재마킹

#### 동반자 묶음 — Ctrl/Cmd 복사로 통일 (v3.7.397 → v3.7.404)
- 처음에 베타 모달 안에 동반자 추가 카드 UI (companion state) 만들었다가 v3.7.398에서 **완전 제거**. 묶음은 Ctrl 복사 하나로 일원화.
- TimelinePage handleDragStart에 `isCopyDragRef` ref + Ctrl/Cmd 키 캡처. mousemove마다 갱신, drop 시점에 분기.
- 복사 시 새 reservation INSERT, 원본은 그대로. 끊는 필드: `reservation_id`(새 부여) + `prev_reservation_id` + 매출 자동 끊김(reservation_id 새 거) + `scheduleLog`/`tsLog` 초기화
- **Ctrl 복사 후 동반자 N 자동 suffix**: base name = `이정우 동반자2 → 이정우`, 같은 날 같은 base name 카운트 = 새 동반자 번호. cust_id/phone/email/gender/num 모두 비움(친구=별도 사람)
- **Ctrl 복사 시 reservation_group_id 자동 부여**: 원본 group 없으면 새로 만들고 원본+복사본 둘 다 같은 group_id로(원본 UPDATE + 복사본 INSERT). 원본도 메모리 setData로 즉시 반영
- **블록 색 도트**: 같은 group_id 멤버 2명 이상이면 이름 앞에 작은 색 원 표시. group_id 해시로 색 결정(8색 팔레트), 같은 묶음 = 같은 색
- **커플룸 태그(`bvkgtel09`) 자동 동반자** (v3.7.403): selected_tags에 커플룸 포함 + 신규 등록 시 같은 staff/time/dur로 동반자 1명 자동 INSERT, room_type='shared'. 이미 같은 base name 동반자 있으면 재추가 안 함
- **PGRST102 회피** (v3.7.404): bulk upsert 시 row마다 toDb 키 집합 다르면 PostgREST 거부. 모든 row 키 합집합 계산 후 빠진 키는 null로 채워 정규화

#### 매출 확인 모달 보유권 차감 스냅샷 복원 (v3.7.400 → v3.7.401)
- snapshot.input에 `pkgUse`만 저장하고 `pkgItems`(다회권 UI 체크 상태)는 누락 → viewOnly에서 좌측 "📦 보유 패키지 ✓ N회 사용" 배지가 안 떴음
- snapshot 저장 시 `pkgItems`도 포함 (신규 매출)
- 복원 시 snapshot에 `pkgItems` 있으면 set, 구버전(snapshot에 pkgItems 없음) fallback: `pkgUse` → `pkgItems` 자동 동기화 useEffect (custPkgs로 다회권/다담권 판정, 다회권만 pkgItems 채움)
- existingDetails 처리: `[보유권 사용]`/`[보유권 차감]` 행 → custPkgs service_name 매칭 → pkgUse/pkgItems 자동 복원

#### 미배정 칼럼 클릭 정확 배치 (v3.7.402)
- 빈 셀 클릭 시 미배정 칼럼이면 `roomId=""` 비워서 → 자동 배치 알고리즘이 같은 시간대 충돌로 **다른 미배정 칼럼**에 떨어뜨리던 버그
- handleCellClick에서 미배정/일반 룸 클릭 시 `room.id`(예: `nv_{bid}_0`) 유지 → naverAssignments Phase 1(명시 배치)이 클릭한 칼럼에 정확히 표시
- handleSave에서 `nv_*` ID 정리 로직 제거(blank_/st_만 정리), DB에도 `nv_*` 그대로 저장. 컬럼 수 변경 시 fallback은 자동 배치

#### last_date 컬럼 오타 fix (서버 + 클라이언트)
- `customers` 테이블에 `last_date` 컬럼은 없음 — `last_visit`. PostgREST 400 → customer=None → `is_new_customer` trigger가 `(not customer)`로 항상 True → **모든 매칭된 기존 고객한테 신규 태그 부여**
- 서버 `bliss_naver.py` `fetch_customer_summary` SELECT `last_date` → `last_visit` 정정 + bliss-naver 재시작
- 클라이언트 `ReservationModal.jsx`도 같은 오타 → 정정 + `lastDate` 별칭 매핑(tagAutoTrigger 호환)
- DB backfill 11건 (오늘+ 네이버 예약, visits>0인데 신규 태그 잘못 부여된 케이스 정리)

#### AI 프롬프트 "상담 후" 규칙 반전 (v3.7.408 동시 서버 패치)
- 기존: "'상담 후' 표현이 있으면 앞에 나온 부위를 시술로 선택" → "페이스상담후" 메모를 "풀페이스"로 잘못 매칭
- 변경: "'상담', '상담후', '상담 후' 표현이 들어간 부위는 미정 상태이므로 매칭하지 마세요"
- 서버 sed로 적용 + 재시작. 기존 잘못 매칭된 selected_services는 backfill 안 함 (유저 결정)

#### ★기존상담 트리거 활성 보유권 체크 (v3.7.391)
- `package_expired` 트리거 의미 변경: 만료 보유권 1건 이상 + **활성 보유권 0개**(다담권 잔액>0 또는 다회권/연간권 잔여>0 + 비만료)인 경우만
- 활성 단골 고객(다담권 잔액 있는 등)은 ★기존상담 부착 X
- 클라이언트 `tagAutoTrigger.js` + 서버 `_at_has_active_pkg` 동시 적용

#### 쿠폰 식별 단순화 (v3.7.390)
- `_at_is_coupon`/`_isCoupon`에서 note의 `쿠폰SEQ:` 패턴 제거 — 네이버 결제 추적용 SEQ라 실제 쿠폰 여부 X
- service_name에 "쿠폰" 키워드만 매칭 (왁싱 PKG의 쿠폰SEQ:534042 같은 케이스 오분류 방지 → ★마지막회차 트리거 정상 동작)

#### 막기 컬럼 헤더 SVG (v3.7.408)
- 회색 원 + 가로 막대(no-entry) → 초록 원(네이버 #03C75A 50%) + 흰 N + 우측 상단 빨강 금지 도트
- 유저 제공 SVG (Z:\bliss\네이버막기.zip) 그대로 인라인 적용

#### 막힘 슬롯 동그라미 가시성 (v3.7.394)
- 30분 가이드 박스(불투명 #E8F5E9, zIndex:2)가 막힘 인디케이터(zIndex:1) 위를 덮어 동그라미가 가려짐
- 인디케이터 zIndex 1 → 3 (가이드 위로)

#### 신규예약 알림 배너 (v3.7.405 → v3.7.406)
- 한 번에 모든 외부 채널로 확장(v3.7.405) → 즉시 롤백(v3.7.406) 네이버만 유지
- pending/request → 🟠 확정대기 (주황), reserved/confirmed → 🆕 새 예약 (초록)
- 라벨 옆 작은 "네이버" 배지 추가, 20초 자동 사라짐, 클릭하면 즉시 닫힘

#### 사이드바 베타 메뉴 가시성 (v3.7.392 → v3.7.393)
- 메뉴 조건 `owner||super` → `isMaster`(manager 포함) 확장
- Sidebar.jsx의 카테고리 화이트리스트에 `timeline-beta` 누락이라 nav 들어와도 안 보였음 — 추가

#### scheduleLog array TypeError 핫픽스 (v3.7.399)
- v3.7.398에서 Ctrl 복사 시 `scheduleLog: []`(array)로 저장 → DB jsonb로 저장돼 fetch 시 array 그대로 반환 → ReservationModal `(item.scheduleLog || "").trim()`에서 TypeError → 베타·라이브 모두 페이지 진입 즉시 크래시
- `scheduleLog: ""` 빈 문자열로 변경 + ReservationModal에서 array도 안전하게 join("\n") 후 trim

#### 공지 등록
- "👥 동반자 빠른 등록 — Ctrl 드래그 복사 + 커플룸 자동 동반자" 게시 (`schedule_data.bliss_notices_v1` 배열 맨 앞)
- value는 string으로 저장된 JSON 배열이라 `(value #>> '{}')::jsonb` parse → jsonb 조작 → `to_jsonb(merged::text)`로 다시 stringify

### 주의사항 (v3.7.408 이후 참고)
- **베타 페이지 = 데이터 격리 sandbox** — 베타에서 만든 모든 예약은 `is_beta=true`로 저장되어 라이브 어디에도 안 보임. 베타에서 매출 등록·알림톡·고객 자동생성 모두 차단. 네이버 스크래퍼는 항상 라이브(`is_beta=false`)
- **Ctrl/Cmd 드래그 = 복사** (라이브·베타 공통). 동반자N suffix 자동, cust_id 비움, group_id 자동 묶음
- **커플룸 태그 부착 + 저장 시 동반자 자동 INSERT** (신규 등록만, 기존 동반자 있으면 재추가 안 함)
- **bulk upsert 시 키 집합 정규화 필수** (PGRST102 "All object keys must match" 회피)
- **last_visit 컬럼 사용** (last_date 아님) — customers 테이블 query 작성 시 주의
- **AI 분석 프롬프트의 "상담" 키워드 = 매칭 금지** (정반대 규칙)
- **scheduleLog는 string** (DB jsonb 회피) — 배열로 저장하면 .trim() 호출에서 크래시

### v3.7.493 → v3.7.502 — AI 메모리 + 외부플랫폼 + 체험단 + cron fix (2026-05-06)

#### 타임라인 / 직원 칼럼
- **moveEmpCol 핵심 fix**: hidden 직원이 새 visible order 끝에 붙어 절대순서 망가뜨리던 버그. swap된 두 ID만 위치 교환 + hidden 원위치 유지
- **외국 영문 ALL-CAPS 이름 정규화**: "ATWOOD LAUREN ELIZABETH" → "Atwood Lauren Elizabeth" (한글 섞이면 그대로)

#### 예약 모달
- **삭제 확인 모달 커스텀화**: 모바일 native confirm() 미표시 이슈 해결
- **외부 플랫폼(Trazy/Creatrip/SeoulBeauty) 인식**: ReservationModal `isNaverItem` 판정에 외부 플랫폼 prefix·source 추가, 삭제·"✓ 확정" 버튼 정상 동작

#### 매출관리 페이지
- 검색 하단 카드 2줄 제거, "합 계" 행 헤더 직후 sticky 배치

#### 메시지함
- **번역 토글 3-state**: 자동/강제영어/OFF, localStorage
- **번역 진행 중 ON-AIR 표시** (빨간 점 1초 깜빡 + "번역 중…")
- **사이드바 클릭 시 첫 화면 리셋** (inboxResetKey 카운터)
- **발신 직원 디폴트 = 지점명** + 수동 선택 localStorage 저장
- **버튼 디자인 통일** (Bliss SVG 아이콘): sparkles/languages/calendar
- `/ai-suggest` 엔드포인트 신설 — ✨ AI 버튼이 state 기반 멀티턴 플로우 사용 (suggest_only=True)

#### 매출 등록 / 체험단
- **체험단(0원 매출) 고객 → 신규로 판단**: SaleForm `custHasSale` 조회에 `total>0` 필터
- **체험단 매출 모달 자동화**: 시술 클릭 → comped + 0원, 🎁 클릭 → 정상가 복원 (유료로)
- **체크박스 + 🎁/분/금액 컬럼 정렬 표준화** (이름·🎁·분·금액 4컬럼)
- 페어 행(절반/전체)도 동일 정렬 + 체크박스 + 🎁
- 🎁 이모지 → Lucide gift SVG 아이콘

#### AI 자동 응대 (ai_booking.py)
- **모델 우선순위**: claude-haiku-4-5 → gpt-4o-mini → gemini-2.5-flash (3-tier hybrid)
- **멀티턴 messages 배열 호출**: 단일 prompt → 진짜 conversation messages array
- **chat_booking_state 시스템 메모리**: 대화별 누적 정보(branch/service/date/time/...) — AI 추출 못한 정보를 시스템이 누적
- **언어 룰**: 첫 대화 언어로 끝까지 (이중 모드 제거)
- **시간 처리 강화**: 모호 표현(evening/morning) → ask_info, 명시 숫자만 영업시간 기준 PM/AM 자동
- **상담 후 시술 매칭 차단**: request_msg에 "페이스 상담"/"바디 상담" 발견 시 selected_services에서 해당 카테고리 시술 강제 제거 (AI 룰 무시 보강)

#### AI 분석 비용 절감
- rescrape 시 ai_analyze 재호출 차단 — `selected_services` 있으면 절대 재분석 X (5분 주기 ai_call 90% 감소 예상)
- `reservations.ai_input_hash` 컬럼 추가

#### Edge Functions / cron 인증 fix (큰 버그)
- **alert-stale Edge Function 신설**: 5분 경과 확정대기/미읽 메시지 → 텔레그램 알림 (1회만)
- **pg_cron 4개 인증 fix**: `net.http_post` 3번째 인자가 headers가 아니라 URL params였음 → 모든 호출 401 → named param `headers :=`로 재등록 (alert-stale, check-pending, daily-report, weekly-report)
- `reservations.tg_alerted_at` / `messages.tg_alerted_at` 컬럼 + 부분 인덱스

#### 자동 태그 트리거
- **★마지막회차 = 패키지 카테고리 보유권만 평가** (에너지테라피·바디 등 다른 카테고리 잔여로 잘못 부착 방지)
- **★기존상담 / customer_inactive_days**: hasPaidSale=false면 OFF
- `is_new_customer`: visits=0 OR hasPaidSale=false (체험단 0원 매출 신규 처리)

#### 외부 플랫폼 메일 처리 (서버)
- **Trazy/Creatrip/SeoulBeauty 모두 INSERT 실패하던 버그 fix**: `service_name` 컬럼 reservations에 없음 → `request_msg`로 변경
- **Creatrip HTML 파싱 fix**: `_strip_creatrip_html()` 추가 (HTML 태그 제거 후 정규식 매칭)

#### 네이버 고객 매칭 안정화 (서버)
- **orphan cust_id 방지**: find_cust_by_phone 실패 → INSERT도 실패 → orphan 저장되던 흐름 fix
- 신규 생성 직전 재시도 매칭 + INSERT 응답 status_code 확인 + race recover + 최종 실패 시 cust_id="" fallback

#### 알림톡 billing fix (서버)
- **알림톡 billing 0건 버그 fix**: `noti` 변수 scope 문제 (process_item 내부 → 외부 참조 NameError) → `get_branch_cfg` 재조회로 fix

#### 공지 이미지 중복 fix
- BlissRequests 부모 div + 자식 textarea 양쪽 onPaste 핸들러 → 1장 paste = 2번 업로드 → 부모 핸들러 제거

### 주의사항 (v3.7.502 이후 참고)
- **AI 모델 우선순위**: claude-haiku-4-5(메인) → gpt-4o-mini → gemini-2.5-flash. claude_key/openai_key/gemini_key 모두 businesses.settings에 저장
- **chat_booking_state 메모리 시스템**: 대화 turn마다 booking 정보 누적 → AI가 추출 못한 정보도 시스템이 보강
- **rescrape AI 비용 절감**: selected_services 있으면 재분석 금지 (어떤 변경에서도)
- **모든 cron net.http_post는 `headers :=` named param 사용** (3번째 인자 = URL params, 헤더 아님)
- **외부 플랫폼 예약 reservation_id prefix**: `trazy_*`, `creatrip_*`, `seoulbeauty_*`, `cusmetic_*` — 이런 ID는 네이버 아닌 것으로 판정해야 (isNaverItem 룰)
- **★마지막회차 트리거**: 패키지 카테고리(`c1fbbbff-`)만 평가. 회원권은 별도 트리거 필요 (membership_expiring_days, 미구현)
- **Anthropic Claude 크레딧 자동 충전 $5→$30**, 결제는 Anthropic Console
- **체험단 0원 매출 = 신규 고객으로 판단** (SaleForm custHasSale + tagAutoTrigger hasPaidSale 양쪽 적용)
- **외국인 ALL-CAPS 이름은 자동 타이틀케이스로 표시** (네이버 여권명 → "Lauren Atwood")

### v3.7.503 → v3.7.547 (2026-05-07 ~ 09)

#### 매출/결제 일반화
- **시술 차감 → 제품 spill 일반화** (v3.7.534, SaleForm:1709): 시술쪽 모든 차감(보유권/외부선결제/포인트/이벤트/일반할인) 합산이 svcTotal 초과하면 잉여분이 prodPayTotal로 spill. grandTotal == svcPay+prodPay 항상 일치. v3.3.50 이전 동작(다담권으로 제품 결제) 복원.
- **타지점 구매 보유권 표시(비활성)** (v3.7.532, SaleForm): inactive 보유권 회색·🔒 배지로 노출. 직원이 잔여 인지 가능, 차감 차단.
- **회원가 자동 적용 정책 정정** — 풀페이스+음모왁싱 묶음 시 풀페이스 회원가 적용은 매장 운영 정책으로 확정 (시스템 변경 X).

#### 보유권 디자인
- **보유권 시안 3 (Two-tone Split)** (v3.7.535, ReservationModal): 라벨/값 분리, 잔액 한국식 짧은 단위(`38.1만`/`5천`), 이모티콘 제거.

#### 영수증 기능
- **영수증** (v3.7.539~543, SaleForm viewOnly·editMode): [영수증] 버튼 1개 → 미리보기 모달 → 텍스트 복사·저장 / 이미지 복사·저장 (canvas 직접 그리기, 외부 라이브러리 X). 메모는 내부 문서라 제외. 보유권 사용은 영수증 상단(고객 정보 다음). 가로 폭 26자 모바일 카톡 fit.

#### 메시지함 / AI / 번역
- **사이드바 unread 배지 IG/WA account_id 분기 fix** (v3.7.535·537): 강남/홍대 IG account_id가 다른 지점은 본인 지점만 카운트. WhatsApp 공유 번호는 양쪽 공통(의도). settings.ig_branch_override 추가 IG 매핑도 적용 (강남 추가 IG `17841455170480955`).
- **AI 예약등록 사이드 패널 자동 닫힘** (v3.7.538, MessagesPage·AppShell): AdminInbox onClosePanel prop. fallback 이동 시 메시지함 사이드 패널 자동 닫힘.
- **(서버) ai_booking manual 우회** (ai_booking.py): manual=True 호출은 [미디어]/[reaction] 가드 우회. /ai-book user_msg는 직전 10건 중 첫 텍스트 메시지 선택 (last가 [미디어]여도 의미 있는 텍스트 분석).
- **(서버) AI 상대 날짜 자동 처리** (ai_booking.py): 오늘/내일/모레/글피·today/tomorrow는 시스템이 즉시 변환. AI가 placeholder("Please provide exact date for today")로 재질문 절대 금지 룰 명시.
- **(서버) 콜라보/체험단 사전 게이트** (ai_booking.py): 메시지 도착 → AI 호출 전 thread outbound 메시지 검사. `체험단`, `collab`, `collaboration`, `influencer`, `Instagram Reels review` 키워드 1개라도 발견 시 → AI 호출 X, 마케팅팀 안내 멘트만 자동 발송 (한/영 자동 분기, 평일 10~17시 KST). 직원 수동 클릭(manual=True)은 우회.
- **언어 룰 — 마지막 메시지 기준** (서버 ai_booking + 클라이언트 MessagesPage): 첫 대화 언어 고정 X. 매 응답마다 마지막 inbound 메시지 언어 재판정. 한+영 혼용 시 영어 우선 (영어 알파벳 5자 이상이면 영어 응답).
- **LINE 메시지 처리** — 토큰 갱신 + LINE webhook에 번역 호출 추가 + ai_booking detect_lang 한+영 혼용 룰. (LINE 상담완료 비공식 우회는 chat_id 매핑 장벽으로 보류 — 정식 챗봇 통합 방향)
- **이모티콘 → I 아이콘 (Phase A1+A2)** (v3.7.535·539): SaleForm·ReservationModal·MessagesPage·TimelinePage 헤더/배지 약 30곳 SVG 통일.

#### 매출 메모 textarea 스크롤 점프 fix
- **textarea inline ref → useRef + useLayoutEffect** (v3.7.533, SaleForm): 매 렌더 height="auto" reset이 textarea 내부 scrollTop 점프시키던 버그. grow-only로 변경.

#### 동반자/Ctrl 복사
- **내부일정 group_id 도트 제외** (v3.7.532, TimelinePage): Ctrl/Cmd 드래그 복사 시 isSchedule이면 reservation_group_id 부여 안 함 + 도트 렌더 가드.

#### 태그·예약경로 통합
- **태그·경로 관리 통합** (v3.7.536, AdminServiceTags): 탭 [예약/내부일정/예약경로] 3개. reservation_sources 같은 row UI로 통일. maxWidth:720, 우측 액션 한 그룹 컴팩트.
- **예약경로 BRAND 라인/왓츠앱 추가** (v3.7.535·라인 DB src_line) — partner.talk.naver.com 매장 핸들 8개도 캡처해 둠 (HANDOFF 기록).

#### 자동태그 트리거 시스템 확장
- **트리거 조건 확장** (v3.7.545, tagAutoTrigger.js):
  - `package_low_count`(★마지막회차)에 `categoryIds`(다중 카테고리) + `serviceIds`(특정 시술 다중) + `matchReservationService`(예약 시술과 같은 카테고리/시술만 평가) 추가.
  - `package_expired`(★기존상담)에 `categoryIds` 추가.
  - param.type 카탈로그(`number`/`bool`/`category_multi`/`service_multi`).
- **자동태그 설정 UI 분리** (v3.7.546~547, AdminServiceTags): 태그 편집창의 자동 부여 트리거 영역 제거. 헤더에 [⚡ 자동태그 설정] 버튼 1개 → 별도 ASheet에서 [태그 드롭다운 → 조건 → 저장] 1대1 편집 흐름. service_multi는 카테고리별 그룹핑 chip 다중 선택.

#### 연계지점 권한 일관성
- **userBranches 자동 머지** (v3.7.546, AppShell): useEffect로 같은 branchGroup 멤버를 userBranches에 자동 추가. 모든 컴포넌트(예약·매출·고객·메시지·관리설정 등) prop 변경 없이 양 지점 데이터 접근/수정.
- **TimelinePage accessibleBids 머지** (v3.7.538): 네이버 예약막기 + 매출조회 등.

#### 사용자 요청 처리 (bliss_requests)
- 정우 동반자 도트, 지은 prod 할인 spill, 서현 다담권 제품 결제, 현아 신규쿠폰·연계지점 막기·네이버 톡톡 자동완료, 김기덕 ★마지막회차 오부착 정책 등 다수 처리·답변.

#### 요금제 페이지 정정
- **pricing.html 실제 요금제로 교체** (v3.7.537): Trial 0원·14일 / Starter 33,000 / Pro 77,000. 크레딧 단가 표(알림톡 10P / SMS 20P,60P / WhatsApp 1P / AI 5P / 메시지함 1P) 명시.

### 주의사항 (v3.7.547 이후 참고)
- **★마지막회차 트리거**는 매장이 관리설정 → 태그 관리 → [⚡ 자동태그 설정]에서 카테고리/시술/예약 매칭 모드를 직접 설정 가능. 디폴트는 패키지+회원권 카테고리 전체.
- **연계지점 권한**: AppShell useEffect가 userBranches를 자동 확장. 새 prop 추가 X. branchGroups 변경 시 즉시 반영.
- **ai_booking 콜라보 게이트**: 매장이 보낸 outbound 메시지에 키워드(`체험단`/`collab`/`collaboration`/`influencer`/`Instagram Reels review`)가 한 번이라도 들어가면 그 대화방은 영구 콜라보 분기 (수동 manual=True 호출은 우회).
- **언어 룰**: 마지막 inbound 메시지 언어 기준 매 응답마다 재판정. 한+영 혼용 시 영어 우선(en≥5).
- **AI 예약등록 manual**: [미디어]/[reaction] 가드 우회됨. /ai-book endpoint가 직전 10건 중 첫 텍스트 메시지를 user_msg로 사용.
- **영수증**: SaleForm viewOnly·editMode일 때만 [영수증] 버튼 노출. canvas 직접 그리기(외부 라이브러리 X), monospace 폰트, 가로 26자.
- **NHN KCP 카드사 심사 통과** (2026-05-07): 영세 가맹점 수수료(일반 3.2%/중소3 2.72%/중소2 2.47%), 신용카드 건당 100만, 정산 월4회, 등록비/연회비 0. 다음 단계: 계약서 제출 → 보증보험 200만 가입 → 포트원 V2 채널 등록 → Bliss 관리설정 키 입력 → 테스트 결제.
- **네이버 톡톡 상담완료 자동 연동 보류**: POST /chatapi/ct/partner/{handle}/chat/{chatId}/end (200 OK 확인) + 매장 핸들 8개 확보(강남 w4jmdh, 마곡 w4lf15, 왕십리 w4h6dw, 용산 w4gsgn, 위례 w4l272, 잠실 w4ls78, 천호 w45f9j, 홍대 w5wyqh). chat_id(4자) ↔ messages.user_id(22자) 매핑이 nchat socket으로만 전달되어 HTTP 추출 불가. 정식 챗봇 통합(handover_v1)으로 전환 예정 (별도 1~2주 일정).

### 서버 ai_booking.py 응급 복구 (2026-05-12, React 변경 0)
**증상**
- 자동응답이 history에 이미 있는 정보(시술/이름/날짜) 재질문 — Monique WhatsApp thread에서 발견
- 메시지함 [예약] 버튼 클릭 시 `/ai-book` 500 (실제 예약 INSERT 0건)

**원인** (회귀)
- 2026-05-10 11:52 UTC 시점 `/home/ubuntu/naver-sync/ai_booking.py`가 92KB → 41KB로 **대규모 롤백**
- 사라진 기능: `chat_booking_state` load/save (시스템 메모리), `force/manual/suggest_only` kwargs, 멀티턴 messages 배열, 3-tier 모델, BRANCH_KEYWORDS, 영→한 시술명 매핑, check_availability ±10시간 search
- `/ai-book` endpoint가 `ai_booking_agent(force=True, manual=True)` 호출 → `unexpected keyword argument` 500
- `chat_booking_state` 테이블 마지막 row 2026-05-09 22:46 KST 이후 0건 누적 (코드에 INSERT/UPDATE 자체 없음 = 시스템 메모리 죽음)

**fix**
- `ai_booking.py.bak_addr_20260506_162116` (5/6 07:21 풀버전 1664줄) 베이스로 풀 복원
- 5/7~5/9 surgical 변경 cherry-pick:
  - 콜라보/체험단 사전 게이트 — outbound 메시지에 `체험단`·`collab`·`collaboration`·`influencer`·`Instagram Reels review` 키워드 발견 시 AI 호출 차단, 마케팅팀 안내 멘트 자동 발송 (한·영 분기, manual=True 우회)
  - 상담 후 매칭 차단 — prompt 룰 + `create_booking_from_ai`에서 `([가-힣A-Za-z]{1,12})\s*(?:상담\s*후?|consult(?:ation)?)` regex로 매칭 텍스트에서 해당 부위 키워드 제거 (예: "페이스 상담후" → 풀페이스 잘못 매칭 방지)
  - manual=True 호출 시 [미디어]/[reaction] 가드 우회
  - 언어 룰 — 마지막 inbound 메시지 기준 매 응답마다 재판정 + en≥5 영어 우선 (v3.7.547)
- 언어 회귀 추가 보강:
  - prompt `[⛔ 응답 언어 = {reply_lang}]` 블록 — 양 언어 병기 절대 금지, reply_lang 100% 준수
  - `[말투]` 한국어/영어 예시 분리, "Hi there! 😊 This is House Waxing." 등 영어 예시 추가
  - `[규칙] 8` 의 이중언어 옵션 표현 제거

**적용**
- 서버 직접 (ssh + scp + `sudo systemctl restart bliss-naver`)
- React 앱 변경 0건 → `BLISS_V` / `version.txt` bump 불필요, CF 퍼지 불필요
- 작업세션(worktree-ai-autoreply-fix) 직접 적용. 워크트리는 React 빌드 trigger 없는 backend-only 작업이라 본 워크트리에 commit된 코드 없음

**검증** (직접 ai_booking_agent 호출 + chat_booking_state 검사)
- 10건 smoke test: KR 인사 / EN 인사 / 한·영 혼용 / KR 가격 / EN brazilian Gangnam / 멀티턴 (history+신규 누적) / 콜라보 게이트 / 상담후 매칭 차단 / 상대 날짜 / Monique 재현 — 모두 정상
- 언어 재테스트 10건: EN 다양한 길이/패턴 / 혼용 / KR — 9 PASS / 1 edge case (단답 "Yes"는 en=3<5라 한국어로 fallback)

**서버 백업 (롤백 시 복원)**
- `/home/ubuntu/naver-sync/ai_booking.py.bak_pre_restore_20260511_231750` (롤백된 41KB 상태)
- `/home/ubuntu/naver-sync/ai_booking.py.bak_pre_langfix_20260511_234159` (lang fix 직전 1697줄)

### 주의사항 (2026-05-12 이후 참고)
- **서버 `ai_booking.py`는 bliss-app git에 추적되지 않음** — 별도 `/home/ubuntu/naver-sync/` git repo. ssh + scp + systemctl restart로 직접 적용. CF 퍼지 무관.
- **chat_booking_state 시스템 메모리는 다시 동작 중** — 매 응답마다 `_state_load → AI 호출 → booking JSON에서 추출 → _state_save` 흐름. ✓ 표시된 필드는 prompt에서 "절대 재질문 금지" 강조.
- **언어 룰**: 마지막 inbound 메시지 기준 + 영어 5자 이상 + en ≥ ko → "영어". reply_lang 결정 후 prompt에 강하게 박힘. 단발 단답(en<5)은 한국어로 fallback.
- **콜라보 게이트는 영구**: outbound에 한 번이라도 키워드 들어가면 그 thread는 영구 콜라보 분기. 해제하려면 `messages` 테이블에서 해당 outbound row 삭제 또는 키워드 제거.
- **잔여 미반영 (낮은 우선순위)**: ① "before/after Npm" 같은 시간 **범위 표현**은 ask_info 강제 룰 미적용 (현재 AI가 booking date에 그대로 넣을 가능성). ② 5/7~5/9 변경 중 LINE 메시지 처리 / detect_lang LINE 분기.

### v3.7.643 → v3.7.710 (2026-05-12 ~ 13)

#### 헤더 시계 + 로비 풀스크린 (v3.7.643~645)
- **`public/clock.html`** 매장 로비 디스플레이용 풀스크린 시계 (Orbitron 디지털 폰트, 다크 블루 #0F1E5C)
- 좌우 반전 토글(셀카 호환), 화면 클릭 시 자동 풀스크린, 1초 단위 갱신
- TimelinePage 헤더 14일 탭 끝(`월 25`)에 🕐 버튼 — 클릭 시 `/clock.html` iframe 풀스크린 오버레이, ESC로 닫힘

#### 토스페이먼츠 풀스택 결제 (v3.7.700, 2026-05-12)
- **AdminPaymentSettings 탭 분리**: [토스페이먼츠 직결 (추천)] / [포트원 V2 (다중 PG)]. 매장별 `branches.payment_settings.tosspayments = { client_key, secret_key, is_test }` 입력.
- **ReservationModal 예약금 청구·환불 UI 활성화**: `chargeDeposit` 결제링크 발송 + `refundDeposit` 환불 버튼. `{false && ...}` 숨김 제거.
- **PaymentApp.jsx 토스 V2 SDK 분기**: `info.provider === 'tosspayments'`면 `TossPayments(clientKey).payment({customerKey:'ANONYMOUS'}).requestPayment({method:'CARD', amount:{currency,value}, ..., successUrl, failUrl})` 호출, redirect 방식. 기존 PortOne SDK fallback 유지.
- **Edge Functions 7개 신규/업데이트**:
  - `payment-info` v3 — 토스 키 우선 반환 (없으면 포트원 fallback). `provider` 필드 추가
  - `payment-confirm` v3 — `paymentKey` 받으면 `POST /v1/payments/confirm` + Basic auth (`btoa(secret_key+':')`) 호출. status `DONE` 검증 후 `reservations.deposit_paid_at` 기록
  - `payment-webhook` 신규 — 토스 webhook 수신 (PAYMENT_STATUS_CHANGED / CANCEL_STATUS_CHANGED / DEPOSIT_CALLBACK / BILLING_DELETED). paymentKey로 토스 결제 조회 API 재호출하여 검증 (토스 추천 방식). `payment_webhook_log` 테이블에 멱등성 로그
  - `payment-cancel` 신규 — 환불 전액/부분. `Idempotency-Key: cancel-{order_id}-{amount|full}` 중복 방지
  - `billing-issue` 신규 — SDK `requestBillingAuth`로 받은 `authKey` → `POST /v1/billing/authorizations/issue`로 `billingKey` 발급 + `billings` 테이블 INSERT + `customers.sns_accounts` 매핑
  - `billing-charge` 신규 — `POST /v1/billing/{billingKey}` 자동청구 + `billing_charges` 트랜잭션 로그
  - `payment-lookup` 신규 — `paymentKey`/`orderId`로 토스 조회 + DB 대조 (매장 디버그용)
- **DB 테이블 3개 신규**:
  - `payment_webhook_log` (event_type, payload jsonb, received_at) — 멱등성·디버깅
  - `billings` (billing_key, customer_key, card_company, card_number_masked, status, purpose) — 충전형 자동결제용 키 저장
  - `billing_charges` (billing_id FK, order_id UNIQUE, amount, status, payment_key, approved_at, raw_response) — SaaS 구독·자동충전 트랜잭션
- **`reservation_payments`** 컬럼 `payment_provider` 디폴트 `'tosspayments'` 확정

#### 브랜드 + SEO (v3.7.700)
- **파비콘 하우스왁싱 → Bliss 보라 B**: `favicon.svg` (보라 그라데이션 #5b21b6→#a78bfa + 흰 B), `favicon.ico` 다중 해상도(16/32/48/64), `logo.png` 512px, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` 180px 모두 재생성
- **`manifest.json` 일반화**: name "Bliss · 뷰티샵 예약관리" (하우스왁싱 제거), maskable purpose 추가
- **`index.html` 풀 SEO**: title + description + keywords (예약프로그램·뷰티샵 예약관리·매출관리·살롱 예약 시스템·왁싱샵·미용실·네일샵·알림톡 자동발송·AI 예약·카카오·인스타 DM 등) + Open Graph(11개 메타) + Twitter Card + JSON-LD `SoftwareApplication`(featureList 11개 + Offer 3개 Trial/Starter/Pro + publisher 테라포트)
- **정적 페이지 5개 SEO 보강**: about/pricing/privacy/terms/refund — description/keywords/OG/canonical/favicon 링크. pricing.html에 Product/AggregateOffer JSON-LD 추가
- **`robots.txt`** 신규 — 공개 페이지만 index, `/pay/` `/admin` 등 disallow
- **`sitemap.xml`** 신규 — 6 URL (메인 + 정적 5개)

#### 보유권 유효기간 검토 메뉴 (v3.7.710, 2026-05-13)
- **`AdminLongValidityReview.jsx` 신규** — 1년 초과 잔존 보유권 검토·수정·삭제 도구
- `customer_packages.note`의 `유효:YYYY-MM-DD`가 cutoff(오늘 + 364일) 이후 + 잔액 ≥ 1 활성 보유권 필터
- 지점별·검색·편집 모달
- 관리설정 → 사업장 관리 → "보유권 유효기간 검토" (slug `long-validity`)

#### 서버 ai_booking.py 5종 버그 fix (2026-05-13, React 변경 0)
**증상**:
- 외국인 손님(McKayla, Bebe 등) WhatsApp 변경 요청에 반복 질문 + 새 예약 잡아버림
- AI 예약 시 customer 매칭 안 됨

**fix**:
1. **`find_existing_booking`에 `channel + user_id` 1순위 매칭 추가** — 외국인·신규 고객도 phone 없이 변경 처리 가능. `reservations?chat_channel=eq.{ch}&chat_user_id=eq.{uid}&status=in.(confirmed,reserved,pending,request)&date=gte.{today}` 쿼리 추가
2. **`_enrich_service_name` 신규** — reservation의 `selected_services`(UUID 배열) → `services` 테이블에서 이름 조회 후 `service_name` 필드에 주입. 변경 시 AI가 시술 인식 가능
3. **[기존 예약] 블록에 `_ex.bid` 기반 branch 이름 재조회** — WA 공통 채널처럼 prompt의 `branch_name`이 "(미정)"이어도 기존 예약의 bid로부터 정확한 지점명 주입
4. **외국인 이메일 강제 요구 룰 #12 약화** — "WhatsApp/IG/카카오/LINE 채널은 user_id로 식별. phone/email 둘 다 없어도 book 가능. 이메일/연락처 강제 요청 금지"
5. **변경 요청 가드 (#9 + ★)** — [기존 예약] 블록 있으면 → `action=book` 직행, branch/service/date/time/custName/custPhone 모두 기존 값 그대로 복사 + 변경된 부분만 새 값. [기존 예약] 없으면 → `action=chat`, "예약 변경은 담당자가 직접 확인 후 안내드릴게요". **새 예약 임의 생성 금지**
6. **`dur` int 안전 처리** — `int(booking.get("dur","")) or 45` → 빈 문자열일 때 ValueError 차단

**검증**:
- 로컬 자동 prompt 검증 22건 중 17 PASS (핵심 4건 — TEST 1 외국인 첫 예약 / TEST 2 변경 시 [기존 예약] 주입 / TEST 3 변경 가드 / TEST 4 한국인 첫 예약 — 모두 ✅)
- 라이브에서 즉시 작동 확인 — WhatsApp `19254081516` (미국 손님 Bebe) 변경 요청을 `find_existing chat 매칭: whatsapp/19254081516 → ai_6xzb4m5t0fwy` 로그로 정확히 처리, 기존 cancel + 새 예약 등록 + customer + sns_accounts 동반 생성
- Bebe 4 시나리오 read-only 시뮬레이션 — 변경/확인/취소/단순 인사 모두 정상

**서버 백업**:
- `/home/ubuntu/naver-sync/ai_booking.py.bak_pre_bugfix_<timestamp>` (롤백용)

#### Claude 모델: Sonnet → Haiku 전환 (2026-05-13, 비용 70% 절감)
**발견**:
- `ai_booking.py` + `bliss_naver.py` 기본값이 `claude-sonnet-4-5`로 박혀 있어, 메모리에 "Haiku 메인"이라 적힌 것과 달리 실제로 Sonnet 호출 중
- 5/7~5/8 시점 ai_analyze + 메시지함 작업 등으로 Sonnet 호출 폭증 → 이번 달 5/13 기준 누적 **$26.29** (Sonnet 4.6 분이 대부분)
- 1회당 Sonnet 4.6 ~$0.062 vs Haiku 4.5 ~$0.020 (3배 차이)

**적용**:
- **env.conf** (`/etc/systemd/system/bliss-naver.service.d/env.conf`)에 `Environment=CLAUDE_MODEL=claude-haiku-4-5` 추가
- `ai_booking.py:80` + `bliss_naver.py:68` 디폴트값을 `claude-haiku-4-5`로 변경 (env 누락 대비 이중 안전)
- `bliss_naver.py.bak_pre_haiku_<timestamp>` 백업
- `daemon-reload` + `systemctl restart bliss-naver` 적용

**예상 효과**:
- 월간 480건 호출 가정: $30 → **$9.6** (70% 절감, 월 ~$20 절감)
- Anthropic Console에서 1시간 후 Haiku 4.5 그래프 증가 + Sonnet 그래프 멈춤으로 확인 가능

#### MCP 추가 + 메모리 업데이트
- `tosspayments-integration-guide` MCP 추가 (`~/.claude.json`) — V2 SDK·결제승인·빌링·링크페이 docs 검색 가능
- memory `reference_tosspayments.md` 신규 — 송정윤(010-4928-1242), 수수료 영세 1.6% 등 메인 PG 정보
- memory `reference_nhn_kcp.md` → "(보류/폐기 검토)"로 변경 — 정기결제만 허가, 일반결제 불가
- `MEMORY.md` 인덱스 토스/KCP 두 줄 교체

### 주의사항 (v3.7.710 이후 참고)
- **결제 PG: 토스페이먼츠 직결이 메인** — 매장이 토스 가맹 후 client_key/secret_key 직접 입력. NHN KCP는 사실상 폐기 검토 단계
- **결제 흐름**: `chargeDeposit` (reservation_payments INSERT + send_queue로 결제링크 카톡/SMS 발송) → 손님 결제 → `payment-webhook` 자동 수신 → 매장 DB `deposit_paid_at` 반영. success page 안 봐도 처리됨
- **빌링키 발급 흐름**: SDK `payment.requestBillingAuth({customerKey, successUrl, failUrl})` → successUrl로 `authKey` 받음 → `POST /functions/v1/billing-issue` → `billingKey` 발급 + `billings` 테이블 + `customers.sns_accounts` 매핑
- **빌링 자동청구**: SaaS 월구독료(매장→Bliss) 또는 멤버십 자동충전(손님→매장)에 활용. `POST /functions/v1/billing-charge` 호출. **스케줄링은 매장이 직접** (pg_cron 활용)
- **토스 webhook URL**: `https://dpftlrsuqxqqeouwbfjd.supabase.co/functions/v1/payment-webhook` — 매장이 토스 개발자센터에서 직접 등록 필요
- **find_existing_booking** — channel+user_id 1순위 매칭 추가. AI 예약 시 chat_user_id로 정확히 매칭
- **CLAUDE_MODEL 환경변수 + 코드 디폴트 모두 `claude-haiku-4-5`** — Sonnet 호출 차단. 응답 품질 떨어지면 `env.conf` 한 줄 변경으로 다시 Sonnet 가능
- **이번 달 누계 비용**: $26.29 (Sonnet 위주) → 다음 달부터 ~$10 예상 (Haiku 전환 효과)
- **5/7~5/8 비용 폭증의 진짜 원인**: 외부플랫폼 도입 + 영수증 기능 + 메시지함 작업 + 시뮬레이션 등으로 ai_analyze + ai_booking 호출이 평소 대비 5~10배. Sonnet 4.6 사용까지 겹쳐 일평균 $0.5 → $10 으로 폭증. Haiku 전환 + rescrape 차단 (selected_services 있으면 재분석 금지)으로 재발 방지

### v3.7.717 → v3.7.718 (2026-05-13 ~ 14)

#### v3.7.717 — TimelinePage empWorkHours race condition fix (지은 id_4dd4t9na07)
**증상**: 지은 "서현, 수연 출근시간이 계속 체인지됩니다. 오늘만 3번째 바꿨는데 계속 둘이 바껴염"

**원인**: `setEmpWorkHours`의 race fix가 `{ ...serverLatest, ...localPrev }` spread로 의도와 반대 작동 — 뒤가 앞을 덮는 JS spread 규칙 때문에 stale localPrev가 serverLatest를 통째로 덮어 다른 사용자 변경이 매번 소실. (코드 주석엔 "다른 사용자 변경 보존"이라 적혀있지만 실제 동작은 정반대)

**Diff-based merge로 교체**:
```js
const next = typeof updater === "function" ? updater(localPrev) : updater;
const changedKeys = new Set();
for (const k of Object.keys(next)) {
  if (JSON.stringify(next[k]) !== JSON.stringify(localPrev[k])) changedKeys.add(k);
}
const deletedKeys = Object.keys(localPrev).filter(k => !(k in next));
const finalToSave = { ...serverLatest };
for (const k of changedKeys) finalToSave[k] = next[k];
for (const k of deletedKeys) delete finalToSave[k];
// POST finalToSave (전체 next 아님) + return finalToSave (UI도 다른 사용자 변경 즉시 반영)
```

**효과**: 다중 사용자 동시 편집 시 누구의 변경도 손실 X. 지은 요청 status=`reviewing` 답글 박고 배포 후 `done`으로 전환.

#### v3.7.718 — 🔵 포인트 충전·환불 시스템 (토스 가맹 심사 대응)

토스페이먼츠 가맹 심사 피드백 2건 (블리스 이용자→테라포트 본사 크레딧 결제):
1. "기본 제공 포인트 환불 모호" → 해결
2. "포인트 구매 로직 없음" → 신규 구현

**1. 무료 P 제거 — features.js**:
- `trial.monthly_credit: 1000 → 0` (무료 체험은 P 미제공)
- Starter(3000P)/Pro(7000P)는 월 구독료 결제 대가라 유지

**2. AdminPlan UI**:
- 지점별 잔액 카드에 `+충전` / `환불 신청` 버튼
- 충전 모달: 1만/3만/5만 칩 → `reservation_payments` INSERT (`purpose='topup'`) → `/pay/{orderId}` 새탭 결제 (PaymentApp.jsx 재사용)
- 환불 모달: 잔액 한도내 금액 + 사유 입력 → `point-refund` Edge Function 호출

**3. Edge Functions** (Dashboard 직접 배포):
- **`payment-info` v4**: `rp.purpose === 'topup'` 분기 → 매장 키 대신 `TOSS_BLISS_CLIENT_KEY` ENV 사용. `branch_name`을 "{지점명} 포인트 충전"으로 가공
- **`payment-confirm` v5**: topup 분기 — 토스 confirm + `billing_payments` INSERT (`pg_tx_id` UNIQUE 멱등성) + `billing_balances` 가산 (없으면 INSERT, 있으면 balance += amount)
- **`point-refund` v1 신규** (verify_jwt=true):
  - 잔액 한도내 검증 → `billing_payments` topup completed row를 created_at 역순 조회 → 환불 잔여액만큼 차례대로 토스 cancel API 호출
  - Partial cancel (`cancelAmount`) 또는 full cancel 자동 선택
  - `Idempotency-Key: refund-{paymentId}-{cancelAmt}` 중복 방지
  - billing_payments에 refund row INSERT (`kind='refund'`, `amount_krw=-N`, `points_credited=-N`)
  - billing_balances balance 차감

**4. PaymentApp.jsx**: `purpose === 'topup'` 분기 — 결제 화면 제목 "포인트 충전", orderName은 `${branch_name}` (이미 v4에서 가공)

**5. DB**:
- `billing_payments.pg_tx_id UNIQUE` 제약 (webhook 중복 호출 방지)
- `idx_reservation_payments_purpose_topup` partial 인덱스 (`WHERE purpose='topup'`)

**6. 환불 정책** (refund.html — 기존에 이미 적합):
- 충전일 1년 이내 미사용분만 환불, 사용분 제외
- 영업일 1~3일 카드 환불

**라이브 키 발급 후 활성화 — Supabase Edge Functions ENV 3개**:
- `TOSS_BLISS_CLIENT_KEY` = `live_ck_*` (또는 테스트 모드 시 `test_ck_*`)
- `TOSS_BLISS_SECRET_KEY` = `live_sk_*`
- `TOSS_BLISS_IS_TEST` = `false`

키 없을 때 충전 시도하면 `503 TOSS_BLISS_* not configured` 응답.

**토스 답변 메일 발송 완료** (5/14, 송정윤 매니저 010-4928-1242). 답변 대기 중.

### 주의사항 (v3.7.718 이후 참고)
- **`monthly_credit` 의미**: SaaS 월 구독료 결제 대가로 받는 P. **무료 제공 X** (Trial은 0). 환불 정책상 잔여분만 환불 가능
- **충전 결제 받는 주체 = 테라포트 본사** (각 매장 결제 키 ≠ 본사 결제 키). 본사 키는 ENV `TOSS_BLISS_*`에 별도 등록
- **충전·환불은 AdminPlan에서만** (관리설정 → 요금제·잔액). 손님 결제 페이지(PaymentApp)는 동일 SDK 재사용
- **point-refund 멱등성**: `Idempotency-Key`로 중복 환불 방지. 토스 `ALREADY_CANCELED_PAYMENT` 응답 시 skip
### v3.7.719 → v3.7.720 (2026-05-14)

#### KB 입금문자 자동 동기화 (v3.7.719)
- **DB 신규 `bank_deposits`**: id/business_id/bid/account_masked/transferer_name/amount/balance/sms_sent_at/parsed_at/status(pending|matched|ignored)/matched_sale_id/matched_reservation_id/matched_at/matched_by/raw_text/source. UNIQUE(account_masked,sms_sent_at,amount,balance)로 중복 INSERT 차단. RLS+anon_all_bank_deposits 정책. Realtime publication 추가
- **Mac launchd 데몬** `mac-daemon/kb_sms_poll.py` + `com.bliss.kb-sync.plist` (60초 주기) — `~/Library/Messages/chat.db` sqlite 폴링 → KB SMS 정규식 파싱 → 강남점 매핑 계좌(`809101**812`) + 입금만 필터 → Supabase REST `Prefer: resolution=ignore-duplicates`로 INSERT. state는 `~/.bliss-kb-sync/state.json`의 last_rowid로 증분. 로그 `~/.bliss-kb-sync/poll.log`. TG_TOKEN/TG_CHAT 재사용해 에러 알림
- **Full Disk Access**: `/usr/bin/python3`은 stub이라 무용 → 실제 바이너리 `/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app`에 부여 필요. plist도 직접 binary 경로로 호출
- **bliss UI**:
  - 메시지함 3번째 탭 `🏦 입금문자` (`MessagesPage.jsx`의 `MessagesWithTeamTab`만 — forceCompact/모바일에서 노출). pending count badge
  - 신규 `BankDeposits.jsx` — 미매칭/매칭됨/무시 필터 칩, 카드(잔액 비공개), [매출 매칭] [무시] 버튼
  - 매칭 모달 — 매출 + 예약 동시 후보, 금액 일치 매출 강조, 입금시각 ±3h 예약 자동 표시, 검색어 입력 시 ±30일 이름 검색으로 확장 (서버 ilike). [매출 매칭]/[예약 매칭] 분리
  - `AppShell.jsx` 상단 노란 배너 — 미매칭 입금 N건 + 최근 입금자 미리보기, 클릭 시 메시지함 사이드 패널 + 입금문자 탭 자동 오픈 (`window.__bliss_inbox_initial_tab` + `bliss:inbox_tab` 이벤트)
  - 사이드바 받은메시지함 배지 합산 — `unreadMsgCount + teamChatUnread + pendingDepositCount` (10초 폴링 + Realtime)
  - 폴링 깜빡임 fix — 30초 주기 + 동일 데이터면 setState 스킵 + initial-only loading
- **이모지 → Bliss SVG 통일**: 메시지함 탭 3개(msgSq/users/building) + 배너(building) + 매칭 모달(clock/calendar/banknote)

#### 토스 심사 응답 (v3.7.719 동시 처리)
- **`billing_balances` 13개 row balance=0 일괄 reset** (실제 결제 충전 0건 확인 후 진행)
- **trial 매장 6개 monthly_credit 0** (Pro 매장 7개는 7000 유지). features.js 정책 변경 + DB 동기화로 "기본제공 P 환불 모호" 항목 해소

#### 공지 글 편집 (v3.7.720, 신영 요청)
- `BlissRequests.jsx` `editingNoticeId` state + `startEditNotice` 함수. 마스터 권한으로 공지 카드 아래 `[공지 수정]` 버튼 → 폼에 기존 데이터 prefill + 편집 모드. acks/createdAt 보존 + editedAt/editedBy 추가. 폼 헤더/등록 버튼 라벨 동적 분기

#### 18일 신규고객 케어 SMS (v3.7.720, 지은 요청)
- **DB 신규 RPC `get_care_sms_targets_first_only(p_bid, p_target_date)`** — 신규 고객(첫 매출일=p_target_date) AND 첫 매출에 패키지/회원권/선불권 카테고리(`c1fbbbff-`/`sc_membership`/`1s18w2l46`) 또는 `is_package=true` 시술 미포함. 010~ phone + 강남점 bid 필터. sale_details는 service_id 없음 → service_name ILIKE 매칭으로 카테고리 판정
- **서버 `bliss_naver.py`**: `CARE_DAYS = [5, 10, 18, 21, 35, 53]` + `CARE_KEY_MAP`에 `18: "after_18d_first_only"`. `process_branch`에서 `n == 18` 분기 — `get_care_sms_targets_first_only` 호출. 백업 `bak_pre_after18d_*`. `systemctl restart bliss-naver` 적용
- **UI `AdminNoti.jsx`**: 시술후 케어 알림에 `after_18d_first_only` 항목 추가 (라벨 "시술 후 18일 (신규·1회)", 설명 "신규 고객 + 패키지/금액권 미구매 + 1회만 방문한 고객 대상", hasTime+sms)
- **강남점 `noti_config.after_18d_first_only`**: `on=true` + sendTime `10:00` + msgTpl(지은 요청 본문 그대로) DB 직접 세팅

#### 처리 완료 요청 (status=done)
- id_c5xc851cdd 신영 (공지 글 편집)
- id_jw8gbhs0x7 지은 (18일 신규고객 SMS)

### 주의사항 (v3.7.720 이후 참고)
- **bank_deposits 매장↔계좌 매핑은 데몬 `.env`의 `BLISS_KB_ACCOUNTS` JSON에서 관리** — Phase 2(다른 매장 추가) 때 `branches.bank_accounts jsonb` 컬럼 추가하면서 데몬이 DB 조회하도록 전환 예정
- **launchd 데몬 위치**: `mac-daemon/` 폴더에 `kb_sms_poll.py` + `com.bliss.kb-sync.plist` + `install.sh`. `~/Library/LaunchAgents/`에 plist 복사 + `launchctl load`로 등록. 60초 주기. plist의 `ProgramArguments`는 진짜 Python 바이너리 경로 사용 (Xcode CLT의 stub `/usr/bin/python3` 아님)
- **chat.db `text` vs `attributedBody`**: macOS Data Detector가 시간 지난 메시지를 attributedBody(NSKeyedArchiver bplist)로 재인코딩 → 한글 멀티바이트 추출 어려움. 폴링 60초 주기로 fresh 메시지(text 형식)일 때 잡는 게 핵심. attributedBody 백필 필요 시 `typedstream` Python 라이브러리 검토
- **18일 신규고객 RPC는 신규 판정을 `MIN(date)=p_target_date`로 함** — 같은 고객의 모든 매출 중 가장 이른 날짜가 18일 전이면 신규로 인정. 따라서 18일 전 첫 매출 + 그 이후 추가 매출 없는 케이스만 잡힘. 18일 전 첫 매출 + 17일 전 재방문은 제외 (첫 매출 날짜만 보고 판정 못 함 → 알림 보내야 할 시점에는 오늘 = first_date+18 이라 다른 매출 있는지 별도 검증 안 함; 본 룰의 의도는 "신규고객 + 1회만 받음"이므로 RPC가 정확)
- **공지 편집 시 acks 보존** — 직원이 이미 확인 누른 공지를 마스터가 수정해도 acks는 그대로. 단순 오타 수정용. 핵심 변경이면 새 공지로 등록 권장

### 서버 ai_booking.py — history regex fallback (2026-05-14, React 변경 0)
**증상**: Mckayla(5/13 05:08 KST) 사례 재발견 — AI가 history에서 service/branch 추출 못 해 booking JSON에 빈값으로 줌 → `_state_merge`가 누적 못함 → 다음 turn에서 같은 정보 또 묻기 → 손님 짜증

**원인**: 5/13 02:16 UTC fix(state_block + lang 마지막 메시지 기준 재판정)는 적용됐지만, AI가 추출 자체를 안 한 정보는 `[현재 누적 정보]` 블록에도 안 들어감 → 안전장치 부재

**fix**: `_state_merge` 호출 직전 (1832줄) history regex fallback 추가 — booking이 None/빈 dict여도 history_text에서 service/branch 직접 매칭해 booking dict 채움. `_state_merge`는 채워진 booking을 그대로 누적
- service: services_cache 한국어 시술명 매칭 → 영어 키워드(eyebrow/brazilian/bikini/full body/full face/underarm/leg/arm) → 한국어 매핑
- branch: 영문(gangnam/wangsimni 등) + 한글(강남본점/왕십리점 등) 양방향 키워드 매칭

**적용**: 서버 직접 (백업 `bak_pre_regex_fb_20260514_225502`, `systemctl restart bliss-naver`). React 변경 0건이라 BLISS_V/version.txt bump 불필요, CF 퍼지 무관.

**효과**: AI Haiku가 history에서 키워드를 놓쳐도 코드가 booking에 강제 주입 → state 누적 보장 → 다음 turn에서 같은 정보 재질문 차단. Mckayla 같은 사고 재발 방지.

### 모델 전환: Haiku → Sonnet 4.5 (2026-05-14, React 변경 0)
**배경**: 4모델(Haiku/Sonnet/Gemini 2.5 Flash/Gemini 3.1 Pro) × 10 실제 메시지 시뮬레이션 결과:
- 응답 빈 응답(parse fail) 카운트: Sonnet 0건 / Haiku 1건 / Gemini 3.1 Pro 4건 / Gemini 2.5 Flash 5건
- Gemini 계열이 한국어 복잡 history + ai_booking JSON 형식에서 불안정 (40-50% 빈 응답)
- 번역 정확도: Sonnet > Gemini 3.1 Pro > GPT-4o-mini > DeepL (DeepL 시제·동사 누락·추측 오류 다수 → 사용자가 "엉망"이라 평가한 원인)

**변경**:
- `env.conf`: `CLAUDE_MODEL=claude-sonnet-4-5` + `CLAUDE_TRANSLATE_MODEL=claude-sonnet-4-5` 추가
- `ai_booking.py:334`: `_ai_ask_msgs` 메인 호출 모델 `claude-haiku-4-5` → `claude-sonnet-4-5`
- 폴백 chain (변경 없음): Sonnet → gpt-4o-mini → Gemini Flash

**예상 비용**: 월 ₩13,000~20,000 (한도 65~100%, prompt caching hit률 따라). cache hit 50% 가정 시 ~₩15,700. 프로세스 재시작으로 즉시 적용. React 변경 0건.

**백업**: `ai_booking.py.bak_pre_sonnet_*`, `env.conf.bak_*`

### 카카오 챗봇 자유텍스트 AI 분석 (2026-05-15, React 변경 0)
**배경**: 카카오 챗봇 `/kakao-booking` 기존엔 BRANCH_MAP·CAT_MAP 정형 매핑만 (4개 카테고리). "비키니라인 정리만", "음모+겨드랑이", "풀바디 5/18 오후3시" 같은 자유 텍스트엔 시술 매칭 실패 → memo만 등록되고 selected_services 빈값.

**fix**: bliss_naver.py에 새 helper 함수 + /kakao-booking patch
- `_ai_extract_booking_info(text, cust_name, visit_count) -> dict` 신규 — `ai_analyze_reservation`과 동일 prompt·로직 (Gemini 2.5 Flash, 무료) 재사용. 반환: `{service_ids, tag_ids, gender, requested_time, special_notes}`
- `/kakao-booking` 수정 — `utterance + service_name` 합쳐서 helper 호출 → 결과를 reservation INSERT body에 반영:
  - `selected_services` ← AI 매칭 시술 ID 배열
  - `selected_tags` ← AI 매칭 태그 ID (체험/리뷰/이벤트/인플/기존상담 자동 차단)
  - `cust_gender` ← 정형 매핑 우선, AI fallback
  - `time` ← `requested_time` 추출됐으면 사용 (안 되면 "10:00" 디폴트)
  - `memo` ← `[AI 특이사항] ...` 추가

**검증** (8가지 자연어 케이스):
- "음모왁싱이랑 겨드랑이" → 시술 2건 (브라질리언+겨드랑이) ✅
- "풀바디. 5월 18일 오후 3시" → 시술 1건 + 시각 15:00 자동 추출 ✅
- "비키니라인 정리만" → 비키니 ✅
- "브라질리언 + 풀페이스 패키지" → 패키지 1건 ✅
- "음부쪽 처음. 영어 가능한 분?" → 시술 + 특이사항 "첫 시술이라 무서워함. 영어 직원 필요" ✅
- "I want a brazilian wax with eyebrows" → 시술 2건 (한+영 혼용) ✅
- "눈썹만 5/18 오후 5시" → 시술 1건 + 시각 17:00 ✅

**비용**: Gemini 2.5 Flash 무료 한도 안 (월 ~30~50건 추가 호출 예상). 추가 비용 없음.

**적용**: 서버 직접 patch + `systemctl restart bliss-naver`. 백업 `bak_pre_kakao_ai_*`. React 변경 0건.

### /book-submit 카카오 예약 폼 AI 분석 추가 (2026-05-15)
**배경**: `/kakao-booking`(챗봇) 외에 `/book-submit` (카카오 채널 예약 폼)도 별도 endpoint. 손님이 `service` 카테고리 + `memo`(요청사항 자유텍스트) 둘 다 입력 가능. 기존엔 memo가 그냥 평문으로만 들어가고 시술 매칭 안 됨.

**fix**: `/book-submit`에도 동일 `_ai_extract_booking_info(service+memo)` 호출 → reservation INSERT body에:
- `selected_services` ← AI 매칭 시술 ID
- `selected_tags` ← AI 매칭 태그 (시스템 메타 차단)
- `cust_gender` ← 폼 입력 우선, AI fallback
- `memo` ← `[AI 특이사항] ...` 추가

**검증** (6 form 케이스 — service+memo 조합):
- "페이스 + 눈썹+인중+턱" → 시술 3건 ✅
- "바디 + 겨드랑이+다리. 알레르기" → 시술 2건 + 특이사항 "알레르기" ✅
- **"브라질리언 + memo에 '풀바디 영어 가능한 분'" → 풀바디로 재매칭** + 특이사항 ✅
- "(service 비움) + 비키니라인만" → 비키니 ✅

손님이 카테고리는 잘못 골랐어도 memo의 자유텍스트로 정확히 시술 매칭됨.

**비용**: 같은 Gemini 2.5 Flash 무료. 백업 `bak_pre_book_submit_ai_*`.

### 번역 메인을 GPT-4o-mini로 변경 (2026-05-15)
**배경**: 번역 4모델 시뮬 결과:
- DeepL (기존 1차): "Yes please" → "네, 그렇게 해주세요" (추측 오류) / "Можете 10:00" → "오전 10시" (동사 누락) / "tidy up" → "정리만 했을 뿐이에요" (시제 오류) 등 **다수 오류**
- Sonnet 4.5: 가장 자연스럽지만 ~₩4,000/월
- Gemini 2.5 Flash: 짧은 문장 OK, 긴 문장 maxOutputTokens 짤림
- Gemini 2.5 Pro: **빈 응답 10/10** (reasoning 모델이라 thinking에 토큰 소진, 출력 part 비어있음)
- **GPT-4o-mini: 자연스러움 100% 정확 + 0.8-2초 + 월 ~₩170**

**fix**: `translate_to_korean`에서 DeepL 호출 부분 통째로 제거 → GPT-4o-mini가 메인.
- 메인: GPT-4o-mini (자연 구어체)
- 폴백: Claude Sonnet 4.5 (CLAUDE_TRANSLATE_MODEL — 기존 폴백 경로 유지)

**비용 절감**: ~₩3,975/월 → ~₩170/월 (DeepL 무료였지만 품질 낮아 GPT-4o-mini로 교체. 절감보단 품질 향상이 핵심). 전체 합계 **~₩11,420/월** (한도 57%).

**검증** (실제 함수 호출):
- "Thank you!" → "감사합니다!"
- "Yes please" → "네, 부탁해요."
- "Можете 10:00" → "10시 가능해요." (DeepL은 "오전 10시"로 동사 누락했던 것)
- "5/13 5pm Gangnam eyebrows" → "5월 13일 오후 5시 강남에서 눈썹 왁싱 예약이에요."
- "I am a woman! And juste a bikini Line tidy up!" → "저는 여성이고, 비키니 라인 정리만 하고 싶어요!" (시제 정확)

**적용**: 서버 직접 patch + `systemctl restart bliss-naver`. 백업 `bak_pre_translate_gpt_*`. React 변경 0건.

### Irina 사고 fix — 8개 지점 전체 주소 + 정보문의 룰 강화 (2026-05-15)
**사고**: Irina Costea (WhatsApp +41774030638) — 이미 5/15 10:00 강남본점 예약 확정.
- 5/14 23:13 주소 문의 → AI가 "Address: Gangnam Main Branch, Seoul" 모호하게만 답
- 23:14 손님 "complete address" 재문의 → AI가 "10:00은 어렵습니다, 09:30은?" **시간 변경 제안으로 오해**
- 5/15 07:58 손님 "What is the correct address" → AI가 "8F, 652 Nonhyeon-ro" hallucination (실제: 5층, 학동로30길 16)
- 5/15 08:03 손님 정확한 주소 제시 → AI "Yes correct!" + "새 예약 받겠다" — 이미 예약 있는데도

**원인 2건**:
1. **WhatsApp 공통 채널은 `account_id → branch_id` 매핑 없음** → `branch_info` 빈값 → `branch_detail_block` 비어있음 → AI가 주소 모름 → 추측
2. AI prompt에 "변경 요청 가드" 룰만 강력하고 "정보 문의 ≠ 변경" 룰 없음 → 주소 문의를 변경 요청으로 오해

**fix**:
- `ai_booking.py`에 **`all_branches_block`** 추가 (line 1135 부근) — 8개 지점 전체 주소·전화를 매 prompt에 포함. branch_id 결정 안 돼도 모든 지점 주소 답변 가능
- "[모든 지점 주소·전화 — 손님이 어느 지점이든 정확히 답할 것. 절대 추측·생성·hallucinate 금지]" 헤더로 강조
- 변경 요청 룰에 ★ 단순 정보 문의(주소·전화·영업시간·가격·지점위치)는 변경 요청 아님 명시. "What's the address?", "주소가 뭐예요?", "complete address" 등 예시 추가. action=chat 강제
- 손님이 이미 예약 있고 주소 묻는 경우 → "이미 예약된 [지점] 주소: [정확한 주소]" 형식 응답 룰

**검증**: "강남점 주소가 어떻게 되나요?" → "하우스왁싱 강남본점 주소는 서울시 강남구 학동로30길 16 남강빌딩 5층입니다!" ✅. 영어 케이스는 시뮬 시점 Anthropic Sonnet API Overloaded(529)로 GPT 폴백, GPT는 default fallback 답변. Sonnet 회복 시 정상 동작 기대.

**적용**: 서버 직접 patch + `systemctl restart bliss-naver`. 백업 `bak_pre_branch_addr_*`. React 변경 0건.

### 차감 로직 비활성화 (2026-05-15, 토스 심사 응답)
**배경**: 5/14에 billing_balances 모두 0으로 reset했으나 24시간 만에 AI 사용 차감으로 다시 음수(-110~-3,030)로 빠짐. 토스 심사 답변 일관성 위해 "balance 영영 0" 보장 필요.

**fix**: `deduct_billing` RPC 수정 — validation 유지, billing_usage_logs는 기록(사용량 트래킹) but **balance UPDATE 부분만 제거**.
- INSERT billing_usage_logs ... points_charged=0 (무료 표시)
- UPDATE/INSERT billing_balances 부분 통째로 삭제
- balance·monthly_credit 모두 0 유지
- 부활 시 RPC 정의를 원래 형태로 복원하면 됨 (코드는 동일)

**효과**:
- billing_balances 영영 0
- 토스 심사 "기본 제공 P 환불 모호" 항목 완전 해소 (balance 0 + 차감 없음 = 환불 대상 없음)
- 비용은 본사가 부담 (Anthropic Claude / OpenAI 직접 결제)

**migration**: `disable_deduct_billing_balance`. 검증: deduct_billing 호출 후 balance 여전히 0 ✅.

### v3.7.722 — 사이드바 보유 P/플랜 표시 hide (2026-05-15)
**배경**: 차감 비활성화 + balance 0이라도 사이드바에 "프로 ~12/31 0P" 같은 표시 남음 → 토스 심사 답변 일관성 위해 표시 자체 제거.

**fix**: `Sidebar.jsx` line 48-61 plan/balance 카드 블록을 `{false && ...}`로 감쌈. UI에서 안 보임. 부활 시 false → true.

**적용**: v3.7.722 라이브 배포 (https://blissme.ai/version.txt 검증). AdminPlan(충전·환불 페이지)은 토스 심사 본문 화면이라 그대로 유지.

### ai_analyze_reservation 무한 재호출 버그 fix (2026-05-15, 서버)
**증상**: billing_usage_logs에서 ai_call이 폭증. 같은 reservation_id가 48시간에 284-309번 호출 (10분에 1번 꼴). 5/14 일일 3,127건 / 예약 52건 = **예약당 평균 60번** 분석.

**원인**: bliss_naver.py line 1515 SELECT 쿼리 버그
- `?id=eq.{rid}` ← 잘못. `rid`는 **`reservation_id`** (네이버 ID)
- reservations 테이블의 `id`는 다른 값 (`ai_xxx` 등)
- 항상 빈 결과 반환 → `_existing={}` → `_has_analyzed=False` & `_existing_hash=""` → `_should_analyze=True` 항상 → 매 cron마다 재분석
- PATCH (line 2050)는 `reservation_id=eq.{rid}`로 정상이라 hash는 저장됐지만 SELECT 시 못 찾음 → 가드 무효화

**fix**: `?id=eq.{rid}` → `?reservation_id=eq.{rid}` 한 줄 수정. `sed -i` + `systemctl restart bliss-naver`. 백업 `bak_pre_aigate_fix_*`.

**예상 효과**: 일일 ai_call 3,127건 → ~50건 (98% 감소). 예약당 정확히 1번 분석. 실제 사용량 통계도 정상화 (어드민이 logs로 추적).

**유의**: deduct_billing은 이미 비활성화 상태라 매장 balance엔 영향 X. logs는 어드민 사용량 추적용으로 유지.

### v3.7.727 — 토스 심사 응답 + 예약폼 UI + 초기로드 버그 fix (2026-05-15)
- features.js/pricing.html: Starter/Pro `monthly_credit` 0, 크레딧 포함 문구 제거 (토스 구독형 빌링 정책 — 구독료에 크레딧 미포함, P는 별도 충전)
- book.html: 예약 폼 한 줄 row 레이아웃 컴팩트화 + 지점명 헤더 + 로고 `logo-housewaxing.png` 교체
- TimelinePage: 취소 예약(cancelled/naver_cancelled)은 당일 취소만 표시(위약금 판단용), 사전 취소는 숨김. naver_changed 구예약은 항상 숨김
- SaleForm: 쿠폰/동시발행 보유권 만료일 = 발행일+N개월의 하루 전 (패키지 규칙과 일치)
- AppShell: 초기 reservations/sales 로드 `sb.get` → `sb.getAll` 페이지네이션 (db-max-rows 1000 잘림으로 5/2 등 과거 데이터 누락 버그 fix). team_chat 미읽 카운트에 business_id 필터 추가

### v3.7.728 — 데이터 로딩 on-demand fetch 버그 3건 fix (2026-05-15)
**배경**: HANDOFF에 "on-demand 데이터 로딩 전환 대규모 리팩토링"이 다음 작업으로 적혀 있었으나, 실제 코드 조사 결과 on-demand 메커니즘은 이미 구현돼 있었음 (TimelinePage selDate fetch / SalesPage 기간 fetch). 전제가 outdated → 대규모 리팩토링 대신 실제 버그 3건만 핀포인트 수정.

**Fix A — TimelinePage on-demand fetch 잘림** (TimelinePage.jsx:309)
- selDate ±7일 윈도우 fetch가 `sb.get(limit=5000)` 사용 → PostgREST db-max-rows(1000) 서버 캡에 잘림
- 14일 윈도우(~3700건)가 1000건 넘으면 date.desc 정렬상 최신 ~4일치만 와서 selDate(윈도우 중앙) 데이터 누락
- `sb.getAll` 페이지네이션으로 교체 (SalesPage 기간 fetch는 이미 getAll — 동일하게 통일)

**Fix B — 포그라운드/온라인 복귀 시 전체 reservations 통째 reload** (AppShell.jsx onVisible/onOnline)
- visibilitychange·online 핸들러가 날짜 필터 없는 `sb.getAll("reservations")` → 전 history 매번 reload. 모바일 PWA 백그라운드 복귀마다 발생 → 데이터 늘수록 느려짐 + Egress 낭비 (실제 "통째 로드" 문제)
- 최근 30일 범위(`date=gte`)로 제한 + replace→윈도우 분할 merge: 30일 윈도우 안은 fetch 결과로 교체(삭제 반영), 윈도우 밖(on-demand 로드분)은 보존

**Fix C — 죽은 코드 제거** (AppShell.jsx)
- `loadHistoricalInBackground` 함수가 정의만 있고 호출 0건 → 제거
- loadAllFromDb 주석의 "30일 이전은 loadHistoricalInBackground가 백그라운드로 보충" → 사실과 다름 → "TimelinePage가 날짜 이동 시 on-demand로 보충"으로 정정

**적용**: v3.7.728 라이브 배포 (version.txt 검증, CF 퍼지 success). 로컬 빌드 검증 후 배포. 화면 변화 없는 데이터 로딩 내부 로직.

**유의**: 전역 `data.reservations`는 세션 캐시로 유지 (on-demand가 이미 동작하므로 들어낼 필요 없음). HANDOFF의 "on-demand 대규모 리팩토링" 항목은 폐기.

### 카카오 예약폼(book.html) 전면 개편 (2026-05-15)
React 앱과 무관한 정적 페이지(`public/book.html`)만 수정 — BLISS_V/version.txt bump 없음 (라이브 React 앱은 v3.7.728 유지).

- **헤더**: 퍼플 그라데이션 브랜드 밴드 + 로고 흰 타일. "하우스왁싱" 텍스트 중복 제거 — 카카오 상단바·h1·매장명 3회 노출 → 1회(상단바)만. 헤더는 `[로고] 강남본점`(매장명 단축, `replace(/^하우스왁싱\s*/,"")`)
- **방문 날짜**: 입력칸 높이 46px 통일. 네이티브 `<input type=date>`는 년도 숨김 불가 → 투명 오버레이(`.date-field`) + 커스텀 표시("M월 D일", 년도 제거) + 달력 아이콘 + `showPicker()` (appearance:none이라 탭만으론 안 열림)
- **방문 시간**: `<select>` 드롭다운 → 4열 버튼 그리드(`.time-grid`/`.time-btn`). 막힌 시간(`/book-slots` 응답)은 회색 비활성 버튼. 선택값은 hidden input
- **시술 부위**: 7개 → 13개 (브라질리언·비키니·케어·겨드랑이·눈썹·인중·다리반·다리전체·팔반·팔전체·헤어라인·에너지테라피·스킨케어), 칩 폰트 13px
- **누락 항목 경고**: `novalidate` + 항목별 인라인 빨간 문구(`.err-msg`) 노출 + 첫 누락 항목으로 스크롤. 입력 시 경고 자동 해제
- **적용**: 빌드·서버 배포·CF 퍼지. `blissme.ai/book.html` 검증 완료. `/book-slots` 서버 엔드포인트(naver_block_state 기반 막힌시간 반환)는 기존 구현 그대로 사용
- **후속 조정**: 헤더 밴드 연한 라벤더(`#C4B5FD→#DDD6FE`) + 진보라 글씨로 톤다운(흰 글씨는 연한 배경에서 가독성 불가), 로고 흰 타일 제거, `logo-housewaxing.png` 3061px·318KB → 128px·11KB 리사이즈(로딩 지연 해결), 푸터에 매장 전화 링크

### book.html 푸터 문의 전화 지점별 분기 (2026-05-16)
- 푸터 문의 전화가 전 지점 공용 하드코딩(`02-515-5141`)이던 것을 `?branch=` 쿼리 기준 지점별 분기로 변경
- `BRANCH_TEL` 맵 8개 지점 — `branches.sms_callback`(문자 발신번호) 값 (DB 대조 검증 완료, 하이픈만 추가)
- 지점 미지정(`?branch=` 없음) 시 푸터 문의 줄(`#telWrap`) 숨김
- 정적 페이지(`public/book.html`)만 수정 — React 앱 v3.7.728 유지, BLISS_V/version.txt bump 없음. 배포는 서버 복사 + CF 퍼지

### v3.7.729 — 팀채팅 배지 본인글 제외 + 매출입력 시술자 휴무 노출 (2026-05-16)

#### 사이드바 "받은메시지함" 배지 — 팀채팅 본인 글 제외
- 증상: 팀 채팅에 본인이 글을 쓰면 본인 사이드바 배지에 미읽 1로 잡혀 안 사라짐 (받은메시지·입금 0건인데 배지 1)
- 원인: 사이드바 합산 배지의 팀채팅 카운트 쿼리(`AppShell.jsx`)가 `created_at > last_read`만 보고 본인 글을 제외 안 함. 팀채팅 화면 내부 카운트(`useTeamChat.unreadCount`)는 `user_id !== currentUserId`로 제외하는데 사이드바용 별도 쿼리만 누락
- fix: 쿼리에 `user_id=neq.{localStorage.bliss_team_chat_user_id}` 필터 추가 — 화면 내부 로직과 일치

#### 매출입력 시술자 드롭다운 — 휴무 직원 노출
- 증상: 휴무 직원도 매출 등록 대상이 될 수 있는데, 시술자 선택 드롭다운에서 완전히 제외(`getEffBranch`가 null 반환 → skip)돼 선택 불가
- fix: `SaleForm.jsx` — 휴무/휴무(꼭)/무급 직원을 `getOffInfo`로 홈 지점 판정해서 해당 지점 그룹 맨 아래에 `(휴무)`/`(무급)` 표시로 노출. 근무 직원이 위, 휴무 직원이 아래. 선택 가능(매출 등록 가능)

### v3.7.730 — 매출 강조 버그 2건 (2026-05-16)

#### 신규 매출이 타임라인 강조에 실시간 미반영 (새로고침해야 강조됨)
- 증상: 39만원+ 결제 시 강조색을 설정해도 새로고침 전엔 타임라인 블록에 강조 안 됨
- 원인: 타임라인 매출 강조는 `data.sales`로 판정하는데, `data.sales`는 앱 시작 시 1회만 로드(`AppShell.jsx`) + `sales` Realtime 구독 없음 + `SaleForm`이 매출 등록 후 `setData` 미호출 → 새 매출이 전역 `data.sales`에 안 들어감
- fix: `SaleForm.jsx` — `sb.insert("sales")` 성공 직후 `fromDb`로 변환해 `setData`로 `data.sales`에 추가. 강조 판정(`salesByResId` memo + `saleDetailsByResId` effect)이 즉시 재계산됨. (편집 모드의 금액 수정은 별도 — 미적용)

#### 매출 강조 시술 체크박스(svcIds/catIds) 저장 안 됨
- 증상: 매출 강조 설정에서 시술 체크박스를 체크해도 저장 안 되고 사라짐
- 원인: `TimelinePage.jsx:2191` 초기 로드 — 매출 강조가 🌐(전 지점 공통)인 경우 DB의 `s.hl`에서 `min/color/mode`만 복원하고 `svcIds`/`catIds`를 누락. DB엔 정상 저장돼 있으나 로드 코드가 버림
- fix: 로드 시 `svcIds`/`catIds`도 함께 복원 (화면 내부 state 모양과 일치)

### AI FAQ 마취크림 안내 추가 + 수정요청 id_o6tib4mrmq 완료 (2026-05-16)
- `businesses.settings.ai_faq`에 마취크림 FAQ 2건(한·영) 추가 — "마취크림 사용 안 함, 한국 살롱에서 사용 금지". 자동응답 AI(`ai_booking.py`)가 `ai_faq`를 최우선 참조 → 서버 5분 캐시 후 반영 (배포·재시작 불필요)
- 정우님 수정요청 `id_o6tib4mrmq` 2건(메시지 배지 / AI 마취크림) 모두 처리 → `bliss_requests_v1`에서 status=done + reply 작성
- 참고: `ai_faq`가 비어 있던 건 사고가 아님 — FAQ가 2026-05-03에 RAG 학습문서(`documents`/`document_chunks`)로 이전됐기 때문. 아래 RAG 항목 참고

### ai_booking.py RAG 학습문서 연동 (2026-05-16, React 변경 0)
**배경**: FAQ 250개가 2026-05-03에 `ai_faq`(settings 필드) → RAG 학습문서로 이전됨 (`documents`/`document_chunks` 테이블 — `housewaxing_faq.md` 19청크 + 왁싱교재 PDF + 이미지). 하지만 RAG 검색(`aiDocs.js` searchDocs / `match_documents` RPC)을 쓰는 건 BlissAI(직원 인앱 도구)뿐 — 고객 자동응답 AI(`ai_booking.py`)는 `ai_faq`만 읽고 RAG 코드가 없어, FAQ 지식을 통째로 잃은 상태였음 (임산부·사후관리·통증 등에 "담당자 확인 후 안내"만 응답).

**fix**: `ai_booking.py`에 `_rag_search_docs(question)` 추가 —
- 질문을 Gemini 임베딩(`gemini-embedding-001` 768차원, 폴백 `text-embedding-004`) → `match_documents` RPC(threshold 0.45 / top 5)로 관련 청크 검색
- 결과를 `docs_block`으로 만들어 프롬프트 `{faq_block}` 다음에 주입. 헤더에 "FAQ와 동일 효력" 명시 + 지어내기금지 규칙도 `[FAQ]/[학습 문서]`로 보강
- 실패 시 빈 문자열 반환 → 자동응답 막지 않음 (graceful). `aiDocs.js` searchDocs와 동일 임베딩 모델·우선순위 사용(쿼리/문서 임베딩 공간 일치)
- 매 메시지마다 임베딩 1회 + RPC 1회 (~0.5초, 비용 미미)

**검증**: `_rag_search_docs` 단독 3건(임산부/사후관리/마취크림) 정상 청크 회수. end-to-end(`ai_booking_agent` suggest_only) — "임산부 왁싱 돼요?" → 학습문서 기반 자연스러운 실답변 생성 확인 (이전엔 "담당자 확인").

**적용**: 서버 직접 (백업 `ai_booking.py.bak_pre_rag_20260516_135830`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF 퍼지 불필요.

**유의**: 자동응답 AI는 이제 `ai_faq`(faq_block) + RAG 학습문서(`docs_block`) 둘 다 사용. 마취크림 같은 빠른 단건은 `ai_faq`, 대량 지식은 RAG 학습문서 업로드(관리설정 → AI 학습문서)가 권장 경로. RAG는 `ai_booking.py`(자동응답)·BlissAI(직원 인앱) 양쪽에서 동작.

### ai_booking.py 자동응답 톤 개선 — 인사 반복·정보표 남발 fix (2026-05-16, React 변경 0)
**증상** (정우님 인스타 DM 자동응답 스크린샷):
- 연속 메시지마다 "안녕하세요/Hi there" 인사 반복
- 8개 지점 주소가 한 줄로 이어 붙어 엉망 (줄바꿈 안 됨)
- "내일 예약 가능한 시간 있나요?" 같은 단순 문의에도 7개 항목 정보표를 통째로 던지고 매 턴 반복

**원인**: 프롬프트에 *"★★★ 첫 메시지부터 모든 메시지 응답에 일괄 정보 요청 표 동봉 ★★★"* 가 강하게 박혀 있었음 (원래 'API 1턴 절감' 목적) + 인사 1회 제한 룰 없음 + 지점 목록 줄바꿈 룰 없음.

**fix** (`ai_booking.py` 프롬프트 6곳):
- 인사는 대화 전체 첫 응답 1회만 — `[대화]` history에 이미 AI 응답 있으면 인사 생략 (말투 섹션)
- 여러 지점 안내 시 한 줄에 한 지점씩 줄바꿈 규칙 추가
- 정보 요청을 3분류로 재정의: (1) 단순 문의(가격·위치·"가능한 시간 있나요?") → 질문에만 답, 표 금지 (2) 예약 의사 확정 → 빠진 정보 1회 묶음 요청 (3) 인사·잡담 → 가볍게. **"예약" 단어만으로 (2) 판정 금지** — "예약 가능한가요?"는 (1)
- 가격 문의에 정보표 강제 동봉 제거 → 가격 + "예약 도와드릴까요?" 가볍게
- 정보표는 대화당 1회 (history에 이미 보냈으면 재동봉 금지)

**검증**: suggest_only 5케이스 — 단순문의/지점목록/가격문의 → 표 없이 대화형, 예약확정 → 표 1회, 2턴째 → 재인사 없음. 모두 정상.

**적용**: 서버 직접 (백업 `ai_booking.py.bak_pre_prompt_*`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF 퍼지 불필요.

### 네이버 예약 source='네이버'(한글) 혼입 → 확정대기 안 풀림 fix (2026-05-16, React 변경 0)
**증상**: 유정민(강남, 예약 `1237756370`) 변경예약이 네이버에서 확정돼도 블리스 타임라인 "확정대기"가 안 사라짐. 새로고침해도 무효.
**원인**:
- 해당 예약의 `reservations.source`가 `네이버`(한글) — 정상은 `naver`(영문). 30분 재스크랩(`pending_rescrape_thread`)이 `source=eq.naver`만 조회 → 한글 source 예약을 영영 못 찾음 → 네이버 상태 변화 미반영. 타임라인 새로고침은 DB 재조회일 뿐이라 무효
- 769건이 `source=네이버`로 잘못 저장돼 있었음. `bliss_naver.py` `_process_one`의 `new_row`에서 `"source":"naver"`가 `**data` **앞**에 있어, scrape `data`에 `source` 키가 섞이면 덮어씀. UPDATE 경로(`update = data - PRESERVE_FIELDS`)도 동일하게 한글 source를 씀
**fix**:
- DB: `source='네이버'` → `'naver'` 일괄 정정 (769건)
- `bliss_naver.py` INSERT: `new_row`에서 `"source":"naver"`를 `**data` **뒤로** 이동 → 항상 `naver`
- `bliss_naver.py` UPDATE: `source`를 `BLISS_PRESERVE_FIELDS`에 추가 → scrape이 `source` 덮어쓰지 않음
- 유정민 `1237756370`: status `pending → reserved` (실제 예약 건, 확정대기 배너 즉시 해제)
**적용**: 서버 직접 (백업 `bliss_naver.py.bak_pre_source_*`) + `systemctl restart bliss-naver`. React 변경 0.
**⚠️ 미해결 (별도 트랙)**: 로그에 `[naver-confirm] rid=1237756370 → 409 RT47 MANDATORY_VALIDATOR_ERRORS` 2회 — 블리스가 네이버 확정 API 호출 시 거부당함. 변경예약 확정 관련 추정. 추가 조사 필요 (HANDOFF 기록). → **아래 항목에서 해결**

### 네이버 확정 + 새로고침 동기화 + source 컨벤션 정리 (2026-05-16, React 변경 0)
**RT47 정체**: `1237756370` 재확인 결과 — 네이버에서 `RC03`(확정됨). RT47은 변경예약이 **갓 생성된 직후** 네이버 확정 API가 잠깐 거부하는 일시 현상. 시간이 지나거나 직원이 네이버에서 직접 확정하면 풀림.

**확정 함수(`naver_confirm_booking`) fix**:
- `409 ALREADY_CONFIRMED` → 성공 처리(`return True`). 이전엔 실패(HTTP 500) — 직원이 네이버에서 먼저 확정했거나 확정 버튼 두 번 누르면 에러로 보이던 버그
- `409 RT47 / MANDATORY_VALIDATOR_ERRORS` → raw JSON 대신 안내 메시지 ("네이버에서 아직 확정 전, 잠시 후 자동 반영 또는 직접 확정")

**타임라인 새로고침 버튼 = 새로고침 + 동기화**: `TimelinePage.jsx:3762` → `naverPollNow` → `/naver-poll-now` → `naver_poll_branch_now`. 그런데 `naver_poll_branch_now`가 **신규 예약 INSERT + prev-chain만** 처리하고, **기존 예약의 status는 재확인 안 함** → 새로고침해도 확정대기 안 풀리던 진짜 이유.
- fix: `naver_poll_branch_now`에 — 네이버 목록의 예약이 DB에 이미 있고 status가 `pending`/`request`면 → 그 자리에서 인라인 재스크랩(`_process_one(..., via_queue=False)`). 보통 1~3건이라 새로고침 +1~2초. 이제 새로고침 = 확정대기 즉시 정리
- `_process_one`에 `via_queue` 파라미터 추가 — 큐 워커 외 인라인 호출 시 `task_done()` 스킵 (`task_done() called too many times` 방지)

**source 컨벤션 불일치 (중요)**: `reservations.source`는 두 값이 공존 — 네이버 스크래퍼(`_process_one`)는 `naver`(영문), React 앱 예약경로 드롭다운(`ReservationModal.jsx` `DEFAULT_SOURCES`)은 `네이버`(한글). 즉 직원이 네이버 예약을 모달에서 저장하면 `source`가 `네이버`로 바뀜 — 버그 아니라 설계 불일치.
- fix: 서버 재스크랩 쿼리 3곳(`pending_rescrape_thread` ×2 + 미래취소 동기화) `source=eq.naver` → `source=in.(naver,네이버)`. 어느 컨벤션이든 재스크랩이 잡음 → 확정대기 stuck 영구 차단
- `source` 한 컨벤션으로 통일(앱 라벨/값 분리)은 추후 과제 — 재스크랩 관대화로 기능상 무해해서 시급하지 않음

**적용**: 서버 직접 (`bliss_naver.py` 백업 `bak_pre_confirm_*`/`bak_pre_pollresc_*`) + `systemctl restart`. React 변경 0. 검증: `naver_poll_branch_now` 인라인 재스크랩 — pending 예약 status 갱신 + `source` 보존 정상.

### 네이버 고객 매칭 — 개명 케이스 전화 단일매칭 허용 (2026-05-16, React 변경 0)
**배경**: 정시온(개명 전 정미영, 전화·이메일 동일)이 네이버 예약 시 기존 고객(8229번)과 매칭 안 되고 새 고객으로 중복 생성됨. 원인 — `bliss_naver.py` `find_cust_by_phone`이 전화 단일매칭이어도 이름이 다르면 `return None`(번호공유 다른사람 판단) → 신규 생성.
**fix** (정우님 지시 — 개명/오타 대응, "전화만 같아도 매칭, 이름 다르면 메모"):
- `find_cust_by_phone`: 전화가 **정확히 1명**과 일치 + 이름 불일치 → `None` 대신 `{**row, "_name_mismatch": True}` 반환. 멀티매칭(여러 명 전화 공유)은 여전히 `None` (김잔듸/김시아식 오염 방어 유지)
- `_process_one` 호출부: `_name_mismatch` 플래그 있으면 → 예약 `schedule_log`(변경 이력 별도 필드, 예약모달에 노출)에 "⚠️ 네이버 예약 이름 X ≠ 기존 등록명 Y, 개명 확인 후 정리 필요" 기재. INSERT 시 1회 박힘(`schedule_log`는 PRESERVE_FIELDS라 이후 rescrape에 보존). 직원이 예약 열 때 확인. (고객 `memo` 아닌 별도 필드 — 정우님 지시)
**머지 처리**: 정시온/정미영 중복 — 8229번(이력 10건) 레코드 살려 이름 '정시온'으로 변경 + 예약 재연결 + 빈 레코드 삭제
**미구현**: 일반 2-of-3(전화/이메일/이름 2개 일치) 매칭 — 카카오 예약폼·AI 예약 경로용, 별도 트랙
**적용**: 서버 직접 (백업 `bak_pre_custmatch_*`) + `systemctl restart`. React 변경 0.
**미해결**: ★기존상담 태그가 만료보유권 아닌 케이스(재방문 선언)에도 붙는 트리거 버그 — 별도 확인 필요

### v3.7.731 — 매출 등록 시 리스트 중복 표시 fix (2026-05-16)
**증상**: 매출 등록 시 매출관리 리스트에 같은 매출이 2개로 떴다가 1개로 정리됨 (중복 깜빡임).
**원인**: v3.7.730 Bug A 수정 때 `SaleForm`에 `setData(data.sales += inserted)`를 추가했는데 — 부모 onSubmit 핸들러(`SalesPage.handleSave` / `ReservationModal.handleSaleSubmit`)가 **이미** `data.sales`에 매출을 추가하고 있었음. SaleForm + 부모 = 이중 추가 → 중복.
**fix**: `SaleForm`의 v3.7.730 `setData` 블록 제거. `data.sales` 로컬 반영은 부모 핸들러 전담 (원래 설계 — `handleSave` 주석 "여기선 로컬 state 갱신만").
**참고**: v3.7.730 Bug A("신규 매출 타임라인 강조 미반영") 진단이 불완전했음 — 부모 핸들러가 `data.sales`를 갱신하므로 강조는 원래 동작함. SaleForm 추가는 불필요했고 중복 회귀만 유발.

### v3.7.732 — 매출관리 매출등록 시 다담권/보유권 미표시 fix (2026-05-16, 지은 id_cmpqb28taa)
**증상**: 다담권 잔액 있는 고객인데 매출관리 → 매출등록에서 다담권(선불잔액) 사용 UI가 안 뜸. 타임라인 매출등록은 정상.
**원인**: `SaleForm`의 `activePkgs`(현 지점 사용가능 보유권)가 `canUsePkgAtBranch(p, branchId, …)` — `branchId` **prop**으로 지점 필터. 매출관리는 다지점 권한(연계지점 머지 포함)이면 `branchId`로 빈 값(`_defaultBid=""`)을 넘김 → 보유권 전부 inactive로 걸러짐 → `prepaidPkgs` 0건 → 다담권 UI `if(prepaidBal<=0) return null`로 숨김. 타임라인은 예약 지점이 `branchId`로 박혀 정상.
**fix**: `SaleForm.jsx:757/759` — `canUsePkgAtBranch(p, branchId, …)` → `canUsePkgAtBranch(p, (selBranch || branchId), …)`. 폼에서 직원이 고른 지점(`selBranch`) 기준으로 보유권 사용 가능 판정. 타임라인은 `selBranch`가 `branchId`로 초기화되므로 동일 동작(무회귀).

### v3.7.733 — 모바일 레이아웃 2건 + 진행중 status 회귀 fix (2026-05-16)

#### 매출입력 폼 모바일 상단 행 찌그러짐 (SaleForm)
- 증상: 모바일(375px) 매출입력에서 `[고객명 라벨][고객검색][시술자][지점]` 4개가 한 줄 flex라, 시술자(142px)·지점(112px) 고정폭이 줄을 다 차지 → 고객검색 입력칸이 32px로 찌그러짐 → 드롭다운도 32px라 "이정우"가 한 글자씩 세로로 깨짐
- fix: `SaleForm.jsx:3075` 고객정보 래퍼 div에 `minWidth:200` 추가 → 모바일에서 1행 `고객명+검색칸(전체폭)`, 2행 `시술자+지점`으로 자동 줄바꿈. 데스크탑(780px 모달)은 `flex:1`이 200을 넘겨 늘어나 무영향(무회귀)

#### 고객 상세 모달이 테이블 프레임에 갇힘 (CustomersPage, iOS Safari)
- 증상: 고객관리 → 고객 클릭 → 상세 모달이 모바일에서 페이지 헤더·필터 아래에 끼어 렌더링, 모달 헤더(이름+닫기 ✕)가 화면 밖으로 밀려 안 보임 ("프레임 속에 갇힘")
- 원인: 상세 모달이 고객 테이블의 `<tr><td>` 안에서 렌더링됨. `position:fixed`인데 iOS Safari에서 테이블 조상(transform/스크롤 컨테이너)이 fixed 기준을 viewport→조상으로 바꿔 모달이 셀 프레임에 갇힘
- fix: `CustomersPage.jsx:1860` 모달 오버레이를 `createPortal(…, document.body)`로 감쌈 → 테이블 조상 체인 탈출, `position:fixed`가 viewport 기준 정상 동작. (타임라인 설정 바텀시트와 동일 패턴, `createPortal` 이미 import됨)

#### 진행중(confirmed) status가 네이버 재스크랩으로 예약중 회귀 (서버, 현아 id_52i0ud24c9)
- 증상: 직원이 고객 방문 시 예약을 '진행중'으로 바꾸면 자꾸 '예약중'으로 되돌아감
- 원인: `bliss_naver.py` 재스크랩 UPDATE 가드 [보호1~4]에 **DB=confirmed → 스크랩 reserved 회귀**를 막는 가드 없음. `confirmed`(진행중)는 네이버 STATUS_MAP에 없는 Bliss 전용 수동 상태인데 `status`가 `BLISS_PRESERVE_FIELDS`에 없어 매 재스크랩(5분 폴링·새로고침)마다 네이버 상태(`reserved`)로 덮어써짐
- fix: `bliss_naver.py`에 **[보호5]** 추가 — `cur_status=="confirmed"` & `new_status in ("reserved","pending")`이면 `data`에서 `status` 키 제거 → 진행중 보존. 네이버 취소/변경(`naver_cancelled`/`naver_changed`)은 그대로 confirmed 덮어쓰기 허용. 서버 직접 패치(백업 `bak_pre_confirm_protect_*`) + `systemctl restart bliss-naver`
- 처리 완료: 현아 `id_52i0ud24c9` status=done + reply

**적용**: v3.7.733 라이브 배포(version.txt 검증, CF 퍼지 success). 서버 패치는 같은 타이밍에 별도 적용(React 빌드와 무관 트랙).

### v3.7.734 — 고객 상세 모달 모바일 스크롤 멈춤 fix (2026-05-16)
**증상**: 모바일 고객 상세 모달에서 스크롤이 내려가다 멈춰서 위아래로 안 움직임 (iOS).
**원인**: 모달 안에 스크롤 영역이 5겹 중첩 — `cust-fs-grid`(메인) + `cust-fs-info-grid`(정보카드) + 메모 div + 포인트내역 div + 매출내역 div 각각 `overflow:auto`. iOS Safari가 터치 스크롤을 안쪽 영역에 가둬 멈춤. 기존 모바일 CSS(`.cust-fs-left > *` overflow:visible)는 카드(직계 자식)만 해제하고 그 안쪽 콘텐츠 div는 못 잡았음.
**fix**: 모바일(`@media max-width:767px`)에서 단일 스크롤 구조로 전환 — 매출입력 모달과 동일 패턴.
- 오버레이 div에 `className="cust-fs-overlay"` 부여 → 모바일에서 `display:block; overflow-y:auto`로 **유일한 스크롤 컨테이너**
- `.cust-fs-modal`: `height:100vh` → `height:auto; min-height:100%` (콘텐츠 높이만큼 자라고 오버레이가 스크롤). `overflow:visible` 추가 — 모달의 `overflow:hidden`(데스크탑 라운드 클리핑용)이 sticky 헤더의 기준을 모달로 잡아버려 헤더가 안 따라오던 것 해제
- `.cust-fs-grid`: `overflow-y:auto` → `overflow:visible` (더 이상 스크롤러 아님)
- `.cust-fs-grid div { overflow:visible; max-height:none }` — 내부 div 중첩 스크롤 전부 해제 (div만 타겟 → input/textarea/select/button 높이 무영향)
- 헤더는 `position:sticky`로 스크롤 중 상단 고정 → 닫기(✕) 항상 노출
**검증**: 로컬 375px — 단일 스크롤(위아래 자유, 멈춤 없음), 헤더 고정, ✕ 닫기 작동. 데스크탑 1280px — 2단 grid 레이아웃 그대로(미디어쿼리 `max-width:767px` 스코프라 무영향).
**적용**: v3.7.734 라이브 배포(version.txt 검증, CF 퍼지 success). React only.
