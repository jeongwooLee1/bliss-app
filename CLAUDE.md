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
