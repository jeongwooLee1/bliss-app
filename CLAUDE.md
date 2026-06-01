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

⚠️ **배포 ≠ 커밋.** 위 배포(빌드·서버·CF퍼지·버전업) 후 **반드시 git commit + push까지 함께** 실행한다 (묻지 말고 자동). 배포만 하고 커밋을 빼먹으면 라이브와 git이 어긋나 소스 백업이 누락됨 (2026-05-28 v3.7.878~887 라이브만 가고 git 누락 사고). 배포 묶음의 마지막 단계:
```bash
git add CLAUDE.md HANDOFF.md package.json package-lock.json public/version.txt src/
git commit -m "<버전+요약>"   # CLAUDE.md 변경이력 + HANDOFF 갱신 포함
git push
```

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

### v3.7.735 — 카카오 채널 예약 확정 알림톡 미발송 fix (2026-05-16, 현아 보고)
**증상**: 카카오 채널(챗봇·예약폼)로 예약한 고객한테 알림톡이 안 감.
**원인**: 카카오 예약은 서버 엔드포인트(`/kakao-booking`, `/book-submit`)가 `status='request'`로 reservations INSERT만 하고 알림톡을 큐에 안 넣음. `rsv_confirm`(예약 확정) 알림톡은 직원이 확정할 때 큐에 들어가야 하는데 — 수동 예약은 앱이 넣고, 네이버는 자체 알림이 있음 — 카카오 예약을 확정하는 경로(타임라인 칼럼 배정 / 모달 상태변경+저장)엔 그 코드가 없었음. 모달 "예약 확정" 버튼만 원래부터 `rsv_confirm` 적재.
**fix** (앱 — 기존 `rsv_cancel` 전환감지 패턴 동일):
- `ReservationModal.jsx` — 카카오 예약(`reservationId` `kakao_*`)이 `item.status==='request'` → `f.status` `reserved/confirmed`로 저장될 때 `queueAlimtalk('rsv_confirm')`
- `TimelinePage.jsx` — 카카오 예약을 직원 칼럼으로 드래그해 자동확정(request→reserved)할 때 동일 적재
- 두 경로 상호배타(확정 후엔 status가 request 아님) → 중복발송 없음. `queueAlimtalk`이 010 번호만 통과시킴
**유의**: `rsv_confirm`은 수동 예약과 같은 noti_key·params·큐를 씀 → 강남점 noti_config에 이미 켜져 있어 동일하게 발송됨. 실발송 테스트는 실고객 알림톡 우려로 미실시 — 카카오 테스트 예약으로 확인 권장.
**적용**: v3.7.735 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.736 — 고객 상세 모달 하위 모달(쉐어·문자발송) 가려짐 fix (2026-05-16, 긴급)
**증상**: 고객 상세에서 보유권 쉐어 "+ 쉐어 고객 추가" 눌러도 아무것도 안 뜸.
**원인**: v3.7.733에서 고객 상세 모달을 `createPortal`로 `document.body`에 올림(z 3000, 루트 stacking context). 그런데 ShareCustModal(z 9999)은 CustomersPage 안에 그대로 렌더 → 앱 레이아웃 컨테이너가 `position:fixed`(= stacking context, z auto≈0)라 ShareCustModal의 9999가 그 안에 갇힘 → 컨텍스트 전체가 body의 고객 모달(z 3000)보다 아래 → 떠 있지만 가려짐. SendSmsModal(z 9000)도 동일 회귀.
**fix**: `CustomersPage.jsx` — `ShareCustModal`·`SendSmsModal` 렌더를 `createPortal(…, document.body)`로 감쌈. 루트 컨텍스트로 나가 각자 z(9999/9000) > 3000 → 고객 모달 위에 정상 표시.
**검증**: 로컬 데스크탑·모바일 — 쉐어 추가 모달·검색창 정상 노출(`elementsFromPoint` 최상위 = ShareCustModal 검색 input).
**미해결(별도·기존 이슈)**: ConsentModal(z 1000)·매출편집 SaleForm(z 200/500)은 고객 모달(3000)보다 z가 낮아 — v3.7.733 이전부터 고객 상세에서 열면 가려짐. portal + z 조정 필요(이번 회귀 아님, 별도 처리).
**적용**: v3.7.736 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.737 — 새로고침 초기 로딩 속도 개선 (2026-05-16)
**증상**: 새로고침 후 화면 뜨는 시간이 예전보다 훨씬 느림.
**원인**: v3.7.727에서 `loadAllFromDb`의 초기 reservations 로드를 `sb.get`(1회·1000건 cap) → `sb.getAll`(전체 페이지네이션)로 변경. 측정 결과 — 최근 30일+미래 예약 8,320건, `getAll`이 1000건씩 **9회 연속 요청**, **10.2MB**(`select=*`), 이 fetch만 **~3.3초**. 이게 `Promise.all` 안에 묶여 첫 렌더를 막음.
**fix** (`AppShell.jsx`):
- `loadAllFromDb` 블로킹 `Promise.all`에서 reservations 제거 → `reservations: []` 반환. 나머지 12개 쿼리(전부 소규모)는 빠르게 끝남
- `loadReservations(bizId)` 함수 신설 — 30일+미래 reservations getAll
- `handleLogin`·`handleEnterBiz`에서 `setPhase("app")`(첫 렌더) **직후** `loadReservations()`를 백그라운드 호출 → 완료 시 `setData`로 `data.reservations` 보충 (id 기준 merge — TimelinePage on-demand 로드분 보존)
- 첫 화면(타임라인)은 자체 on-demand fetch로 동작 → 전역 reservations 없어도 정상
**효과**: 첫 화면 렌더에서 ~3.3초 제거. 예약목록·신규예약 배너·배지는 첫 렌더 2~3초 뒤 채워짐(트레이드오프 — 타임라인 동작엔 무영향).
**검증**: 로컬 — 타임라인 정상 렌더, 신규고객 배너 정상 표시(백그라운드 로드 확인), 콘솔 에러 0.
**적용**: v3.7.737 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.738 — 고객 상세 동의서 모달(ConsentModal) 가려짐 fix (2026-05-16)
**증상**: 고객 상세 → 동의서 탭 → "새 동의서 요청" 눌러도 모달이 고객 모달 뒤에 가려짐.
**원인**: v3.7.736의 ShareCustModal과 동일 — v3.7.733에서 고객 모달을 body로 portal(z 3000) 후, ConsentModal은 CustomersPage 안(앱 레이아웃 `position:fixed` stacking context)에 그대로 렌더. 게다가 ConsentModal z가 1000이라 portal해도 3000보다 낮음.
**fix**: `ConsentModal.jsx` 오버레이 z `1000 → 9000`. `CustomersPage.jsx`의 ConsentModal 렌더를 `createPortal(…, document.body)`로 감쌈. 루트 컨텍스트 + z 9000 > 3000 → 정상 노출.
**참고**: "매출 편집"도 가려진다고 추정했으나 — `openSaleFullEdit`(고객 모달에서 매출 전체편집 여는 함수)는 **호출처 없는 죽은 코드**. 고객 상세 매출 내역 패널은 펼쳐 보기 전용(편집 버튼 없음). 매출 편집은 고객 모달 위로 안 뜸 → 수정 불필요(SaleForm zIndex prop 추가 시도는 되돌림). `editSale`은 고객목록 우클릭 메뉴(`_newMode`)로만 열리며 그땐 고객 모달 없음.
**검증**: 로컬 모바일 — 동의서 요청 모달 정상 노출(`elementsFromPoint` 최상위 = ConsentModal).
**적용**: v3.7.738 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.739 — 고객 상세 모달 모바일 디자인 정리 (2026-05-17)
**배경**: 고객 상세 풀스크린 모달이 모바일에서 — 폰트 크기 제각각, 정보 입력칸 폭 좁음(이메일 잘림), 포인트 메모칸이 글 못 쓸 만큼 찌그러짐.
**수정** (`CustomersPage.jsx` — 전부 `@media max-width:767px` 스코프, 데스크탑 무영향):
- **정보 입력 grid 2열 → 1열** — 390px를 둘로 쪼개 칸당 ~160px라 이메일 등 잘리던 것 해소. 각 칸 전체폭 + 줄간격 5→9px
- **정보 라벨 폰트 9px → 12px 통일** — iOS 줌 방지로 입력값은 16px 강제인데 라벨만 9px이라 제각각. `.cust-fs-info-grid span/button` 12px
- **포인트 입력줄 줄바꿈** — `금액` input이 `flex:0 0 90px`인데도 기본 `size=20`×16px로 193px로 벌어져 메모칸이 74px로 찌그러짐. `.pt-row` flex-wrap + `.pt-amt`/`.pt-note`(order·`flex:1 1 100%`)로 1줄 `금액·P·저장` / 2줄 `메모 전체폭(327px)`
- **보유권 드롭다운(`+패키지 추가`·`쿠폰 발행`) 14px → 12px** — iOS 줌 방지 16px 규칙에서 `select` 제외(네이티브 피커라 줌 안 일어남) → index.html 전역 `select.inp{font-size:14px!important}`가 드러남 → `.cust-fs-modal select.inp` 12px로 눌러줌
**검증**: 로컬 dev server 로그인 → 고객 상세 모달, 모바일(375px) 4건 모두 정상 + 데스크탑(1280px) 레이아웃 무영향. 콘솔 에러 0.
**적용**: v3.7.739 라이브 배포(version.txt 검증 3.7.739, CF 퍼지 success). React only.

### 서버 — 진행중(confirmed) 상태 보호 로직 전체 무력화 버그 fix (2026-05-17, React 변경 0)
**증상**: 직원이 예약을 '진행중'으로 바꿔도 네이버 갱신·새로고침·5분 스크랩마다 '예약중'으로 되돌아감 (수연 `id_x5suun048w` / 앞서 현아 `id_52i0ud24c9`도 동일 증상).
**원인**: `bliss_naver.py` `db_upsert`의 기존 예약 조회 SELECT가 `id,room_id,staff_id,cust_id,selected_tags`만 가져오고 **`status`를 안 가져옴** → `cur_status = row.get("status","")`가 **항상 빈 문자열** → 상태 보호 로직 [보호1~5] 전부 `cur_status=="..."` 조건이 거짓 → 단 한 번도 작동 안 함. v3.7.733에서 [보호5](confirmed→reserved 회귀 차단)를 넣었지만 이 SELECT 누락 때문에 죽어 있었음.
**fix**: `db_upsert`의 SELECT 2곳(기본 조회 + race 재조회)에 `status, naver_confirmed_dt, naver_cancelled_dt` 추가 → [보호1~5] 전부 정상 작동.
**검증**: 서버 로그 — `[protect5] #1238365148 confirmed → reserved 회귀 차단 → status 보존`이 스크랩마다(04:07·08·12) 정상 발화(문지수 + #1238047503 등). 유저가 타임라인 네이버갱신·새로고침으로 진행중 유지 직접 확인.
**적용**: 서버 직접 패치(백업 `bliss_naver.py.bak_pre_status_select_20260517_130428`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF퍼지 불필요. 수정요청 `id_x5suun048w`(수연) status=done + reply 처리.

### 서버 — 신규 고객 자동 생성 시 customers.memo 자동텍스트 제거 (2026-05-17, React 변경 0)
**배경**: 네이버·카카오 예약 등으로 고객이 자동 생성될 때 `customers.memo`에 "네이버 신규 예약 자동 생성" 같은 보일러플레이트가 박혀, 매출 히스토리·고객 상세의 "고객 메모"에 그대로 노출. 직원이 쓸 메모칸을 자동텍스트가 차지 — 불필요(CLAUDE.md 절대금지 "memo 필드에 네이버 데이터 쓰기"와도 배치).
**수정** (`bliss_naver.py` — customers INSERT 5곳에서 `memo` 키 제거):
- 네이버 신규 고객 (`"네이버 신규 예약 자동 생성"`)
- 네이버 방문자 (`"네이버 방문자 자동 생성 (예약자: …)"`)
- 카카오 예약폼 `/book-submit` (`"카카오 폼 신규 예약 자동 생성"`)
- Trazy 신규 고객 (`"Trazy 유입 / 국적: …"`)
- 크리에이트립 신규 고객 (`"크리에이트립 유입 (…)"`)
→ 신규 고객 memo는 NULL로 생성 → 직원이 직접 작성. 국적 등은 예약(`reservations`) memo에 그대로 남아 정보 손실 없음.
**이미 깨끗**: `ai_booking.py`의 AI 예약 고객 생성(`cust_row`)엔 memo 필드 자체가 없음 — 수정 불필요.
**안 건드림**: 예약(`reservations`) memo의 소스 태그(`[AI예약]`·`[카카오 챗봇 예약 접수]` 등)·AI 특이사항 `owner_comment` — 예약 출처 파악용이라 유지(유저 확인).
**기존 DB 정리**: 자동텍스트만 있고 직원 메모 0건인 고객 55명(네이버신규 51·방문자 1·카카오폼 1·Trazy 2) `memo = NULL` 일괄 처리. 정리 후 잔존 0건 확인.
**적용**: 서버 직접 패치(백업 `bliss_naver.py.bak_pre_memo_clean_20260517_100137`) + `systemctl restart bliss-naver`(scraper/gmail/alimtalk/ai 전부 alive 확인). React 변경 0 → 버전업·CF퍼지 불필요.

### v3.7.740 — AI 예약등록(메시지함) 4건 fix (2026-05-17)
메시지함 ✨ "AI 예약등록"의 "정보 부족" fallback 경로(`MessagesPage.aiBook` → 타임라인 예약 모달) 정리.
- **A. 직원 메모 자동텍스트 제거**: fallback이 예약 모달 직원 메모에 `[AI 자동예약—정보부족 보류분]`+AI응답+`[원문]`을 자동 prefill하던 것 제거(`MessagesPage.jsx` `_prefill.memo` 삭제). 직원 메모 빈칸 시작.
- **B. AI 예약 시간 14:00 오류**: fallback이 시간 못 받으면 `'14:00'` 하드코딩 → 엉뚱한 시각. `_parseTime`/`_timeGuess` 추가 — 대화 **전체**에서 시각 정규식 추출(HH:MM·"N시 M분"·"N시반", 영업시간 11~21시 고려해 오전/오후 표기 없는 1~9시는 오후 추정). 못 찾으면 빈칸(직원이 채움). 서버는 `time`을 REQUIRED로 정상 처리 — 서버 변경 없음.
- **C. 예약경로 = 채널명**: fallback이 예약 `source`를 `'ai_book_fallback'`로 박던 것 제거 → 대화 채널명 매핑(`_SRC_BY_CH`: 네이버톡톡/인스타/WhatsApp/카톡/LINE/텔레그램). 서버 `ai_booking.py` `CHANNEL_SOURCE_MAP`도 `naver "네이버"→"네이버톡톡"` + kakao/line/telegram 추가(직접 AI 예약 경로도 동일). DB `reservation_sources`에 "네이버톡톡"·"텔레그램" 신규 등록.
- **D. 받은메시지함 "연결" 버튼**: AI 예약등록 fallback으로 타임라인 모달에서 신규 고객 생성 시 `customers.sns_accounts`에 채팅 채널/user_id 미기입 → 대화↔고객 미연결("연결" 버튼 노출). `ReservationModal` `onSave`에 `chatChannel/chatAccountId/chatUserId` 전달 + `TimelinePage.handleSave` 신규 고객 `newCust.snsAccounts` 채움 → 받은메시지함 자동 매칭.
**적용**: v3.7.740 라이브 배포(version.txt 검증, CF 퍼지 success). 서버 `ai_booking.py` 직접 패치(백업 `ai_booking.py.bak_pre_srcmap_20260517_120119`) + `systemctl restart bliss-naver`. DB `reservation_sources` INSERT 2건(네이버톡톡·텔레그램).

### v3.7.741 — AI 예약등록 추출 시각, 타임라인 시간단위로 스냅 (2026-05-17)
v3.7.740의 대화 시각 추출(`_timeGuess`)에 — 추출 시각을 타임라인 "시간단위"(`tl_settings.tu` 공유설정, 5/10/15/30/60분)에 맞춰 스냅 추가.
- `MessagesPage.aiBook` fallback에 `_snapTime` 추가: `localStorage.tl_settings.tu`(기본 5) 단위로 가장 가까운 시각에 스냅. `parsed.time`(서버 AI 추출)·`_timeGuess`(대화 정규식 추출) 둘 다 스냅 후 모달 prefill.
- 예: 시간단위 30분 → 11:35는 11:30, 11:50은 12:00. 5분 → 11:35 그대로(거의 무변).
- 적용: 직원 ✨ AI 예약등록 버튼의 "정보부족 → 타임라인 모달" 경로. 서버 자동응대 AI 예약(`ai_booking.py`)은 미적용(현재 시간단위 5분이라 효과 동일 — 필요 시 별도 패치).
**적용**: v3.7.741 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.742 — 타임라인 보유권/쿠폰명, 마스터 현재 이름으로 표시 (2026-05-17)
**증상**: 시술·쿠폰 이름을 변경해도(예: `에너지테라피 60분`→`에너지60분`) 타임라인 블록의 보유권/쿠폰 pill에 옛 이름이 그대로. 타임라인 ↻·브라우저 새로고침해도 안 바뀜.
**원인**: 타임라인 보유권 pill(`custPkgMap`)이 `customer_packages.service_name`을 그대로 표시 — 이 필드는 발급 당시 이름 **스냅샷**이라 마스터(`services`) 이름을 바꿔도 안 따라감.
**fix** (`TimelinePage.jsx` 보유권 로드 effect): `customer_packages` SELECT에 `service_id` 추가 → `service_id`로 `data.services`의 **현재 이름을 우선 사용**, 매칭 안 되면 기존 스냅샷 `service_name` fallback. 의존성에 `data?.services` 추가. → 시술·쿠폰명 변경 시 (브라우저 새로고침 후) 타임라인에 자동 반영.
**유의**: `service_id` 없는 구 보유권은 여전히 스냅샷 이름. 고객 상세 보유권 탭(`PkgCard`)·매출폼 등 다른 화면은 미적용 — 동일 증상이면 같은 패턴 적용 필요.
**적용**: v3.7.742 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### v3.7.743 — 메인 JS 번들 경량화 (앱 콜드 로드 속도 개선) (2026-05-17)
**배경**: 앱 새로고침(콜드 로드)이 느리다는 보고. 조사 — `loadAllFromDb`(데이터 로드)는 이미 가벼움(sales 14일·customers 100·예약은 백그라운드). 진짜 원인은 메인 JS 번들 2.9MB.
**원인**: `aiDocs.js`가 `mammoth`·`xlsx`·`jszip`(문서 파싱 라이브러리, "AI 학습문서 업로드" 전용)을 top-level static import → `aiDocs.js`를 MessagesPage·BlissAI·FloatingAI도 import하므로 이 무거운 libs가 자주 쓰는 화면 경로를 통해 항상 메인 번들에 포함됨.
**fix**: `aiDocs.js`의 mammoth/xlsx/jszip을 각 추출 함수(`extractDOCX`/`extractXLSX`/`extractPPTX`/`extractHWPX`) 안에서 `await import(...)` dynamic import로 변경. 문서를 실제 파싱할 때만 로드.
**효과**: 메인 번들 `index-*.js` **2,932KB → 2,098KB** (−834KB, gzip 849→606KB, ~28%↓). xlsx(429KB)·jszip(97KB)·mammoth(~398KB)는 별도 청크로 분리 — 학습문서 업로드 시에만 로드. 콜드 로드 시 JS 파싱량 ~834KB 감소.
**유의**: 학습문서 업로드(`AdminAIDocs`)는 첫 1회 lib 청크 다운로드(~1초) 후 정상 동작. 추가 경량화는 관리설정·BlissAI 페이지 `React.lazy` 코드스플릿(별도 작업).
**적용**: v3.7.743 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### 서버(nginx) — 빌드 에셋 캐싱 활성화 → 앱 로딩 속도 대폭 개선 (2026-05-17, React 변경 0)
**증상**: 앱 새로고침이 느림. v3.7.743 번들 경량화로도 체감이 안 됨.
**원인**: `/etc/nginx/sites-enabled/bliss`의 `location /`가 **모든 파일**에 `Cache-Control: no-cache, no-store`를 붙임 — 해시 파일명의 빌드 에셋(`/assets/*.js,css`)까지. → 브라우저·Cloudflare 둘 다 JS를 캐시 안 함 → 앱 열 때마다 605KB JS를 매번 재다운로드(`cf-cache-status: BYPASS`). v3.7.743으로 번들을 줄여도 "매번 재다운로드"라 체감 안 됐던 것.
**fix**: `location /assets/` 블록 추가 — `Cache-Control: public, max-age=31536000, immutable`. Vite 빌드 에셋은 콘텐츠 해시 파일명이라 내용 바뀌면 이름도 바뀜 → 영구 캐시 안전. `index.html`은 `location /`에서 `no-cache` 유지(새 배포 정상 반영).
**효과**: 에셋이 브라우저 캐시(1년 immutable) + Cloudflare 엣지(`cf-cache-status: HIT`)에 저장 → 첫 방문 후 모든 재방문·새로고침은 JS 재다운로드 없이 즉시. 배포 시엔 index.html(no-cache)이 새 해시 에셋을 가리켜 자동 갱신.
**적용**: nginx 설정 직접 수정(백업 `/home/ubuntu/bliss_nginx.bak_20260517_150158`) + `nginx -t` 통과 + `systemctl reload nginx`. React·버전 변경 0.
**유의**: nginx `sites-enabled/`에 백업 파일을 두면 nginx가 그 파일까지 로드해 `duplicate default server` 충돌 → 백업은 반드시 `sites-enabled/` 밖에 둘 것.

### v3.7.744 — 타임라인 당일 예약 즉시 로드 (블록 표시 속도 개선) (2026-05-17)
**증상**: nginx 캐싱(v3.7.743 후속)으로 앱 셸은 빨라졌으나 — 타임라인 예약 블록이 여전히 늦게(~3초) 뜸.
**원인**: 타임라인 블록은 `data.reservations`(AppShell 백그라운드 `loadReservations`)에 의존 — 이건 30일 전~미래 전체 8,247건/~10MB를 한 번에 받음(무거운 컬럼 하나가 아니라 건수×컬럼수). 그게 다 와야 블록 표시. ※ 이 전체 로드는 v3.7.727 "과거 날짜(5/1·5/2 등) 예약 누락" fix로 도입된 것 — 유지 필수.
**fix**: `TimelinePage`에 effect 1개 추가(additive) — `selDate` **당일 예약만**(`date=eq.selDate`, 수백 건) 먼저 빠르게 fetch → `setData` merge → 당일 블록 즉시 표시. 기존 전체 백그라운드 로딩·on-demand fetch는 **그대로 유지** → 과거 날짜 누락 fix 영향 0. 중복은 id로 dedup, betaGroupMode 제외.
**적용**: v3.7.744 라이브 배포(version.txt 검증, CF 퍼지 success). React only.

### 서버 — AI 자동응답 다국어 지원 (고객 언어 그대로 응답) (2026-05-17, React 변경 0)
**증상**: 네덜란드어 손님에게 AI가 영어로 답함. 러시아어·일본어·중국어 손님은 더 심각 — 한글도 영문자도 아니라 "한국어"로 판정돼 AI가 한국어로 답함.
**원인**: `ai_booking.py` 언어 감지가 한글 vs 영문자(a-z) 2종만 카운트 → `reply_lang`이 "영어"/"한국어" 둘 뿐. Cyrillic/CJK는 둘 다 0 → else "한국어".
**fix**: `reply_lang`을 `"한국어"` / `"고객 언어"`로 재정의 — 한글이 우세하면 한국어, 아니면 "고객 언어"(AI가 고객 메시지 언어를 직접 판별·매칭). 프롬프트 `[⛔ 응답 언어]` 블록·`[말투]` 예시·예약 템플릿 라벨을 "고객 언어면 고객이 쓴 그 언어로 100% 답(영/일/중/러/네덜란드어 등), 한국어 금지, 한 답변 내 언어 혼용 금지"로 수정.
**검증**: `suggest_only` 스모크 6건 — 네덜란드어/러시아어/일본어/중국어/한국어/영어 입력 → 전부 해당 언어로 응답 확인(일·중은 지점명·예약 7항목 양식까지 그 언어로 번역).
**적용**: 서버 직접 패치(백업 `ai_booking.py.bak_pre_multilang_20260517_152244`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF퍼지 불필요.

### v3.7.745 — 증정 쿠폰 즉시 사용 + 보유 쿠폰 ID 매칭 (2026-05-17, 현아 id_tp4i4vym0m)
**증상**: 다담권 100만원권 구매 시 딸려오는 8만원 제품쿠폰을 매출등록에서 못 씀. 보유 중이던 제품전용 쿠폰도 적용 안 됨.
**원인 1 — 쿠폰 이름 불일치**: 매출등록 쿠폰 엔진이 `customer_packages.service_name`으로 쿠폰 상품(`services`)을 **이름 매칭**. 유저가 시술상품명을 짧게(`제품전용 8만원쿠폰`→`제품전용 8만`) 바꿔서, 보유 쿠폰 행(835장)·이벤트 설정의 옛 이름이 현재 상품명과 안 맞음 → `promoConfig`(80,000원 제품할인) 로드 실패 → 적용 안 됨. `_pkgType`/`couponEligibleMap`/`couponResults` 3곳 전부 이름 매칭.
**원인 2 — 발행 자체 실패**: 이벤트 `coupon_issue` 보상의 `couponName`이 옛 이름이라, 매출 저장 시 `find(s=>s.name===couponName)`이 쿠폰 상품을 못 찾고 발행을 조용히 건너뜀.
**원인 3 — 같은 매출 사용 불가**: 발행돼도 쿠폰 엔진은 `custPkgs`(기존 보유분)만 봄. 이번 매출에서 막 발행된 쿠폰은 목록에 없어 같은 건에서 못 씀.
**fix (SaleForm.jsx)**:
- 쿠폰→상품 해석을 **이름 대신 `service_id` 우선**(폴백 이름)으로 변경 — `_pkgType`·`couponEligibleMap`·`couponResults`. 보유 쿠폰 835장이 이름 길이와 무관하게 정상 적용.
- **`eventIssuedCoupons` 신규** — `eventResult.issueCoupons`(이번 매출에서 발행될 쿠폰)를 쿠폰 상품 `promoConfig`로 해석 → 같은 매출에서 즉시 할인 적용. `evtCouponDiscountOnProd/OnSvc`를 `grandTotal`/`prodPayTotal`/`svcPayTotal`/`svcAfterAllDiscounts`에 반영(spill 불변식 유지). 매출등록 쿠폰 칸에 `[증정·즉시사용]` 라벨 + 체크 토글(`eventCouponOff`).
- 저장 시: 같은 매출 즉시사용분(첫 장)은 `customer_packages` `used_count:1` + note `매출{id} 동시사용`(유효대기 연결 건너뜀), `[쿠폰 할인]` sale_detail 기록. 미사용분은 기존 유효대기 로직 유지.
- 다담권 100만뿐 아니라 **모든 패키지 구매 증정 쿠폰**(에너지 등)이 동일하게 같은 매출 즉시 사용.
**fix (데이터 — businesses.settings)**: 이벤트 7개 `coupon_issue` 보상의 `couponName`을 현재 시술상품명으로 보정 (`제품전용 8만원쿠폰`→`제품전용 8만`, `제품전용 3만원쿠폰`→`제품전용 3만`, `에너지테라피 20분`→`에너지20분`, `에너지테라피 60분`→`에너지60분`). jsonb surgical update(이벤트 `name`·다른 설정 무변경), 이벤트 18개 유지 검증.
**적용**: v3.7.745 라이브 배포(version.txt 검증, CF 퍼지 success). React + DB 데이터 보정.
**유의**: 쿠폰 엔진은 이제 `customer_packages.service_id`로 쿠폰 상품을 해석 — 시술상품명을 바꿔도 안 깨짐. 단 `service_id` 없는 구버전 쿠폰 행은 이름 폴백. 이벤트 `coupon_issue` 보상은 여전히 `couponName`(문자열)로 쿠폰을 지목 — 쿠폰 상품명을 또 바꾸면 이벤트 설정의 `couponName`도 같이 바꿔야 함(ID 참조로 전환은 추후 과제).

### 서버 — 발신 메시지 한국어 표시 개선 (역번역 맥락 주입 + 원본 재사용) (2026-05-17, React 변경 0)
**증상**: 매장이 영어로 보낸 발신 메시지 밑에 표시되는 한국어(직원용)가 앞뒤 맥락 없이 어색하게 번역됨 (WhatsApp 등 외국어 고객 대화).
**원인**: `_augment_out_translation`이 발신 영어를 `translate_to_korean(text)`로 역번역 — (a) `prev_context`(대화 맥락) 미주입: 수신 메시지 번역은 `_thread_context`를 넣는데 발신 역번역만 빠짐 → 한 메시지만 떼어 번역, (b) send_queue에 직원이 친 한국어·AI 한국어 원본(`translated_text`)이 있어도 무시하고 영어를 round-trip 기계번역 → 멀쩡한 원본 버리고 품질 저하.
**fix** (`bliss_naver.py`): `_augment_out_translation(text, orig_ko, account_id, user_id)` — `orig_ko`(send_queue row의 `translated_text`)가 한국어면 역번역 없이 그대로 사용, 없을 때만 `_thread_context` 대화 맥락 넣어 역번역. 호출부 3곳(WhatsApp/LINE/Naver send_queue_thread) + echo 핸들러 2곳(Naver echo·IG echo)의 `translate_to_korean`에 `prev_context` 주입.
**적용**: 서버 직접 패치(백업 `bliss_naver.py.bak_pre_outtr_*`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF퍼지 불필요.
**유의**: "AI 답변 추천" + 번역자동 모드는 앱(`MessagesPage.sendTranslated`)이 AI 영어를 send_queue `translated_text`로 보내서 `orig_ko` 재사용이 안 됨 → 맥락 역번역으로 폴백(이전보다는 개선). 앱이 AI 한국어 원본(`aiKoDraft`)을 넘기게 하는 건 별도 React 작업.

### v3.7.746 — 모바일 타임라인 드래그 자동 스크롤 시 블록 추적 fix (2026-05-17)
**증상**: 모바일에서 예약 블록을 잡고 화면 가장자리로 끌면 타임라인은 자동 스크롤되는데, 블록 미리보기·드롭 대상이 스크롤을 안 따라감 → 손가락 멈춘 채 스크롤되면 블록이 제자리에 멈춰 보이고 놓으면 엉뚱한 위치에 떨어짐.
**원인**: `TimelinePage.handleDragStart`의 `_autoScrollLoop`가 `sr.scrollTop/scrollLeft`만 변경하고, 드래그 스냅·미리보기 계산(`onDragMove`)을 재실행하지 않음. `onDragMove`는 `touchmove`에서만 호출되는데, 손가락이 가장자리에서 멈추면 `touchmove`가 안 와서 스크롤만 진행되고 블록 위치는 고정.
**fix**: `_autoScrollLoop`에서 스크롤이 일어나면(`moved`) 저장된 포인터로 `onDragMove`를 재호출(터치는 `{touches:[pt]}` 합성 이벤트) — 스크롤 델타가 스냅 계산(`scrollDeltaY`)에 반영돼 블록·드롭 대상이 스크롤을 따라감.
**적용**: v3.7.746 라이브 배포(version.txt 검증, CF 퍼지 success). React only. 터치 드래그라 브라우저 자동검증은 미실시 — 실제 모바일에서 확인 권장.

### 서버 — 백엔드 시크릿 키 6종 env 우선 전환 (businesses.settings 노출 차단) (2026-05-17, React 변경 0)
**배경**: `businesses.settings`가 Supabase anon 공개라 거기 저장된 API 키가 외부 노출됨. 백엔드(Python)에서만 쓰는 키 6종을 환경변수로 이전.
**대상 키 6종**: `openai_key`, `anthropic_key`(=claude_key), `wa_token`, `telegram_token`, `line_channel_token`, `line_channel_secret`. (`gemini_key`/`deepl_key`는 클라이언트도 사용 → 이번 범위 외)
**코드** (`bliss_naver.py` 8곳 + `ai_booking.py` 2곳): `cfg.get("X")` → `os.environ.get("BLISS_X","") or cfg.get("X")` (env 우선·settings 폴백). `_load_ai_settings` 캐시 빌드 6곳 + `api_key_val` + TG_TOKEN + `get_anthropic_key()` + ai_booking `_cache` 2곳. settings 폴백이 살아있어 무중단.
**env**: 오라클 서버 systemd drop-in `/etc/systemd/system/bliss-naver.service.d/secrets.conf` (root 600) 신규 작성 — `BLISS_OPENAI_KEY`·`BLISS_ANTHROPIC_KEY`·`BLISS_WA_TOKEN`·`BLISS_TELEGRAM_TOKEN`·`BLISS_LINE_CHANNEL_TOKEN`·`BLISS_LINE_CHANNEL_SECRET` 6개. 값은 현 `businesses.settings`에서 그대로 복사(서버 스크립트가 Supabase→파일 직접 기록). `daemon-reload` + `bliss-naver` 재시작.
**검증**: 6키 전부 라이브 read-only API 검증 PASS — OpenAI `/v1/models`, Anthropic `/v1/messages`, WhatsApp Graph `/me`, Telegram `getMe`, LINE `/bot/info`. 서비스 active, 로그 정상.
**백업**: `bliss_naver.py.bak_pre_envkeys_*`, `ai_booking.py.bak_pre_envkeys_*`
**미완(별도 트랙 — 동의서 세션)**: `businesses.settings`에서 위 6키 제거 + RLS 정리. 제거 전까지는 settings·env 둘 다 유효(env 우선). `mac-daemon`은 이 키들과 무관(KB 입금문자 폴러).

### 서버/Supabase — wa_token·ig 토큰 settings 의존 제거 (send-message Edge Function + bliss_naver.py) (2026-05-17, React 변경 0)
**배경**: 위 6키 env 전환의 후속. `wa_token`·`ig_token`·`ig_tokens`는 `send-message` Edge Function이 `businesses.settings`에서 읽고 있어 settings에서 못 지웠음 — 이번에 그 의존도 제거.
**`app_secrets` 테이블 신규**: `(key, value, updated_at)`. **RLS ON + 정책 없음**(의도) — anon/publishable 키로 못 읽고 `service_role`만 우회. `wa_token`·`ig_token`·`ig_tokens`를 `settings→app_secrets`로 **DB 내부 복사**(셸에 값 노출 0). anon(publishable) 읽기 시도 → `[]` 차단 확인. ※ 이 테이블엔 `anon_all` 정책 추가 금지(시크릿 저장소).
**`send-message` Edge Function v8**: `wa_token`·`ig_token`·`ig_tokens`를 `app_secrets`(service_role)에서 읽고 settings 폴백. `wa_phone_number_id`(비-시크릿)·`naver_messages` insert 등 나머지 로직 무변경.
**`bliss_naver.py`**: `ig_token`→`BLISS_IG_TOKEN`(env), `ig_tokens`(dict)→`BLISS_IG_TOKENS_B64`(base64 — systemd Environment에 JSON 직접 못 넣어 base64) env 우선·settings 폴백. systemd `secrets.conf`에 2개 추가(총 8개), `bliss-naver` 재시작.
**검증**: `app_secrets` 3키 적재 + anon 차단 확인, Edge Function v8 ACTIVE, `bliss-naver` active + ig env 로드, base64 라운드트립 OK.
**백업**: `bliss_naver.py.bak_pre_igenv_*`
**미완(동의서 세션)**: `businesses.settings`에서 `wa_token`·`ig_token`·`ig_tokens` 제거 가능해짐 — 제거하면 settings엔 `gemini_key`·`deepl_key`만 남음(클라이언트가 직접 사용 → 서버화 전엔 못 뺌, 별도 큰 작업). 시크릿 0개 돼야 settings 컬럼 RLS 잠금 가능.

### 서버 — db_upsert SELECT에 schedule_log/time/date 추가 (수동 시간변경 보호 가드 복구) (2026-05-18, React 변경 0)
**배경**: 수연 요청 `id_f19sih2au8` — "블리스에서 예약 시간 옮기면 되돌아감".
**발견**: `db_upsert`의 "수동 시간변경 보호" 가드(`if row.schedule_log: drop time/date`)가 `row.get("schedule_log")`/`time`/`date`를 비교하는데, `db_upsert`의 SELECT가 그 컬럼들을 안 가져와서 가드가 죽어 있었음(오늘 고친 status-SELECT 누락 버그와 동일 부류). `time`은 `BLISS_PRESERVE_FIELDS`에 있어 무사했지만 `date`(다른 날로 이동)는 무방비 — 재스크랩이 되돌림.
**fix**: `db_upsert` SELECT 2곳(기본 + race 재조회)에 `schedule_log,time,date` 추가 → 가드 복구. 이제 schedule_log(수동 이동 흔적) 있으면 time·date 둘 다 재스크랩에서 보존.
**적용**: 서버 직접 패치(백업 `bliss_naver.py.bak_pre_selfix_*`) + `systemctl restart`. React 변경 0.
**유의**: `time` 자체는 PRESERVE_FIELDS로 4/10부터 이미 보존돼 옴 — 서버 재스크랩은 `time`을 안 되돌림(이승혜 예약 DB 데이터로 확인: 직원이 옮긴 값 그대로 살아있음). 수연이 본 'time 되돌림'은 서버 재스크랩 경로가 아니라 클라이언트(타임라인) 쪽 의심 — `handleSave`의 이동-저장이 `sb.update(...).catch(console.error)` fire-and-forget(저장 실패 시 무경고·무재시도)이라 네트워크 실패 시 조용히 유실 가능. 정확한 재현 케이스 확보 후 추가 조사 필요(별도).

### v3.7.747 — 새로고침 로딩 오버레이 + 요금제 지점별 사용내역 정확 집계 (2026-05-18)

#### 새로고침 버튼 중앙 로딩 표시
상단 네이버 갱신 버튼 클릭 시 — 아무 피드백이 없어 "안 되는 줄" 오해. `isRefreshing`(선언만 돼 있고 미사용이던 state) 재활용 → 클릭 시 화면 중앙에 회전 스피너 + "네이버 갱신 중…" 오버레이(`createPortal`로 body에). 갱신 끝나 `window.location.reload()` 될 때까지 유지.

#### 요금제 지점별 사용내역 — 1000행 캡 버그 fix
**증상**: 요금제 화면 지점별 사용내역에서 홍대점 알림톡 0·SMS 없음 등 집계가 엉망.
**원인**: `AdminPlan`이 `billing_usage_logs`를 이번 달 전체·행 제한 없이 fetch → PostgREST가 1000행에서 잘림. 이번 달 로그 ~23,000건 중 `ai_call`이 ~94%(약 22,000건)라 그 1000칸을 ai_call이 거의 다 차지 → alimtalk·sms·whatsapp 지점별 집계가 사실상 랜덤·대부분 0. (DB 데이터는 정상 — 표시만 깨짐)
**fix**: RPC `get_billing_usage_summary(p_business_id, p_since)` 신규 — `billing_usage_logs`를 서버에서 per-branch·per-kind로 집계(`sum(count)`/`sum(points_charged)`, 결과 ~32행)해 반환. `AdminPlan`이 행 fetch 대신 이 RPC 사용 + `usageByBranch`를 `cnt`/`points`로. 1000행 캡 무관, 전 지점 정확.
**검수**: 전 8지점 알림톡·SMS·AI호출 데이터 정상 확인(홍대점 알림톡 111·SMS 30 등). WhatsApp은 강남점만(205) — 공통 단일번호라 발송 과금이 전부 강남 귀속(설계), 비강남 0이 정상.
**적용**: v3.7.747 라이브 배포(version.txt 검증, CF 퍼지 success). RPC는 DB에 이미 생성됨.
**미완(별도)**: `AdminAlimtalkLog`(`limit=500`)·`AdminSmsLog` 상세 탭도 같은 부류 — `alimtalk_queue`를 캡된 목록으로 받아 지점별 정산 합계를 내므로 긴 기간 조회 시 부정확. 같은 식으로 집계 RPC화 필요.

### billing 데이터 정리 + v3.7.748 (2026-05-18)

#### billing_usage_logs `ai_call` 버그 중복분 21,334행 삭제 (DB only, 코드 변경 0)
- 요금제 페이지 지점별 `ai_call`이 실제의 ~130배로 부풀려 보인다는 보고. 조사 결과 — 5/15에 고친 `ai_analyze_reservation` 무한 재호출 버그(`?id=eq.{rid}`→`?reservation_id=eq.{rid}`)가 5/4~5/15 동안 쌓은 과거 잔재.
- `ai_analyze_reservation` 21,728행 = 실제 분석 예약 394건 + 중복 21,334행 (예: 예약 #1220472177 한 건이 908번 청구). 5/15 14시 이후 재호출 0건 → fix는 정상 작동 중.
- `ref_table='ai_analyze_reservation'`에서 `ref_id`당 가장 이른 1행만 남기고 21,334행 DELETE. 이번달 `ai_call` 21,882→548, `ai_analyze_reservation` 394행. `deduct_billing` 비활성이라 재무 영향 0(순수 어드민 사용량 표시 정확화).
- **유의**: `billing_usage_logs`는 5/4부터 기록 시작 + 5/4~5/15 구간은 중복 삭제됨 → 그 구간 `ai_call` 통계는 지점당 1건/예약만 남음(정상).

#### billing_balances 음수 잔액 3개 지점 → 0 (DB only)
- 요금제 페이지 왕십리·천호·용산점 잔액이 `-5P`로 표시. 5/14 전 지점 0 리셋 후 `deduct_billing` 비활성화(5/15) 직전 틈에 3개 지점이 5P씩 차감된 채 멈춤.
- `billing_balances`에서 `biz_khvurgshb` 음수 3행 → `balance=0`. 토스 심사 "balance 영영 0" 정책과 일치, 실결제 0건이라 환불 무관.

#### v3.7.748 — 요금제 사용내역 이번달/지난달 + 쉐어 검색
- **RPC `get_billing_usage_summary`에 `p_until timestamptz default null` 상한 인자 추가** — `created_at < p_until` 조건. default null이라 기존 2-arg 호출 호환. DROP + 3-arg로 재생성(migration `billing_usage_summary_add_until`).
- **AdminPlan.jsx — "지점별 잔액 + 사용량" 섹션에 `[이번 달][지난달]` 토글**: `monthSel` state, 선택 월 경계로 `p_since`/`p_until` 계산해 usage 재집계. `loadBilling`(월 무관: 구독·잔액·차감히스토리)과 `loadUsage`(월 의존) 분리, `loadUsage`는 `[biz.id, monthSel]` effect. 섹션 라벨·지점별 "사용 NNN P" 문구도 선택 월 반영. (참고: `billing_usage_logs`가 5/4부터라 지난달=4월은 0P 표시 — 정상)
- **CustomersPage.jsx ShareCustModal — 쉐어 고객 추가 검색을 메인 고객검색과 동일하게**: 검색 필드 `["name","name2","phone","phone2","email","cust_num"]`→`["name","name2","phone","phone2","email","memo","cust_num"]`(`memo` 추가, buildFilter와 동일 필드셋), `limit` 20→200(메인 검색 `PAGE_SIZE×4`와 동일). 증상="회원번호 검색 안 됨" — 번호는 `phone`/`phone2` 부분일치 충돌이 심해 `created_at` 최신순 `limit=20`에서 실제 `cust_num` 매칭이 밀려나던 게 핵심 원인. `memo`에 적힌 번호도 이제 검색됨.
- **적용**: v3.7.748 라이브 배포(version.txt 검증 3.7.748, CF 퍼지 success). RPC·migration은 DB에 이미 적용됨.

### v3.7.749 — 커플 패키지 (멀티테넌트, 2026-05-18)
커플 패키지 = 패키지(다회권) 상품 중 "커플" 플래그가 켜진 것. 매출등록 시 구매자 + 상대방을 지정하면 각자에게 회수가 분리 발급됨.
- **DB**: `services.is_couple boolean default false` 컬럼 추가 (migration `services_add_is_couple`). `db.js` DBMAP/DB_COLS에 `is_couple↔isCouple` 매핑.
- **AdminSaleItems**: 패키지(다회권) 상품 편집 시 "커플 패키지" 토글. `is_couple` 저장(패키지 아니면 false 강제). 목록에 "커플 패키지" 배지.
- **SaleForm**: `newCouplePkgs` 감지 → 커플 패키지 체크 시 "커플 상대방 지정" UI(ShareCustModal 재사용). 저장 시 `customer_packages` **2행** — 구매자 N회 + 상대방 N회(각자 독립), 둘 다 note에 `커플:<gid>`(8자 그룹ID `cg*`). `customer_shares` 1행 연결(중복 시 생략). 상대방 행은 `_newTriggerPkgIds`에 미포함 → 이벤트/쿠폰은 구매자 1건만. 상대방 미선택 시 저장 차단. editMode/viewOnly에선 커플 UI 숨김.
- **CustomersPage**: 커플 보유권 카드(note에 `커플:`)에 "파트너변경" 버튼 → ShareCustModal로 새 상대방 선택 → 짝(sibling) 보유권 행을 새 고객으로 이전(`customer_id` UPDATE) + `customer_shares` 재지정. sibling이 이미 사용한 회차 있으면 경고.
- **ShareCustModal 분리**: CustomersPage 인라인 정의를 `src/components/Customers/ShareCustModal.jsx`로 추출(CustomersPage↔SaleForm 순환 import 회피). `titleLabel` prop 추가. 검색 필드는 메인 고객검색과 동일(`memo` 포함, limit 200).
- **멀티테넌트**: 코드에 특정 상품 ID·매장명 하드코딩 0. `is_couple` 플래그로만 분기 — 어느 매장이든 자기 패키지 상품을 시술상품관리에서 커플로 지정.
- **적용**: v3.7.749 라이브 배포(version.txt 검증, CF 퍼지 success).
- **유의**: 커플 보유권 2행은 note의 `커플:<gid>`로 묶임 — 파트너 변경 시 이 gid로 짝 행 식별. 신규 구매분만 적용 — 기존 커플 패키지 구매자 소급 적용은 v3.7.750 마이그레이션 페이지 참고.

### v3.7.750 — 커플 패키지 기존 구매자 소급 적용 페이지 (2026-05-18)
- 신규 `AdminCouplePkgMigrate.jsx` — 관리설정 → 사업장 관리 → "커플 패키지 소급 적용" (slug `couple-pkg-migrate`)
- `services.is_couple=true` 상품을 구버전 방식(보유권 1행)으로 구매한 케이스(`customer_packages` 중 service가 커플 상품인데 note에 `커플:` 없음)를 표로 모음. 고객/시술명 검색 지원
- 행별 "상대방 지정" → `ShareCustModal`로 상대방 선택 → 상대방에게 같은 회수 보유권 INSERT(`used_count=0`) + 기존행·신규행 둘 다 note에 `커플:<gid>` + `customer_shares` 연결(중복 시 생략). 처리된 행은 목록에서 제거
- `AdminPage.jsx`: import + `TAB_SLUGS`(`couple-pkg-migrate`) + 사업장 관리 메뉴 항목 + 렌더 등록
- 멀티테넌트 — `is_couple` 플래그로만 대상 판별, 하드코딩 0. 어느 매장이든 자기 커플 상품 구매자가 자동으로 대상에 잡힘
- **적용**: v3.7.750 라이브 배포(version.txt 검증, CF 퍼지 success)

### v3.7.751 — 팀채팅 공지 배너 닫기 버튼 fix (2026-05-18)
- 증상: 상단 공지 마퀴 배너의 닫기 `×`가 안 눌림 — 마퀴가 중간중간 멈춰도 마찬가지
- 원인: `×` 버튼이 흐르는 마퀴(`transform` 애니메이션) 안에 있어, 애니메이션 요소의 보이는 위치 ↔ 클릭 판정 위치가 어긋남
- **fix** (`AppShell.jsx` `AnnouncesMarquee`): 닫기 버튼을 마퀴 바깥(배너 오른쪽 끝 고정 위치)으로 분리 — 애니메이션 영향 없어 클릭 정확. 누르면 현재 표시 중인 공지 전체 dismiss(세션 단위, 기존 동작). 마퀴 내부 개별 `×` 제거. 배너 구조를 flex(마퀴 viewport + 고정 닫기버튼)로 재편, mask는 viewport에만
- hover/touch 시 마퀴 일시정지 추가(읽기 편의) — 마우스 떼면 재개, 터치는 6초 후 자동 재개
- **적용**: v3.7.751 라이브 배포(version.txt 검증, CF 퍼지 success)

### v3.7.752 — 커플 패키지 페이지: 보유 현황 전체 표시 (2026-05-18)
- `AdminCouplePkgMigrate` 개편 — 미적용 건만 보여주던 것 → 커플 패키지 보유 건 **전체** 표시(연결완료 포함). 다 처리하면 빈 화면이던 문제 해소
- 컬럼: 고객·연락처·**지점**·커플 패키지·회차·구매일·상태. 상단 **지점 필터** 드롭다운 + 카운트 "보유 N건 · 미적용 M건"
- 상태: 미적용 행은 주황 배경 + `[상대방 지정]` 버튼 / 연결완료는 초록 배지 `커플 연결 완료 · ↔ 상대방이름`(같은 `커플:<gid>` sibling 조회로 상대방 표시)
- `applyPartner`: 처리 후 행 제거 대신 로컬 state 업데이트(해당 행 상태 갱신 + 상대방 행 추가) → 처리해도 목록에 남아 현황 확인 가능
- **적용**: v3.7.752 라이브 배포(version.txt 검증, CF 퍼지 success)

### v3.7.753 — 수정요청 fix: 매출 상세 보유권 사용 라인 / 시간 이동 되돌림 (2026-05-18)
- **민정 `id_xzq2s91ewv`** — 패키지 구매 + 즉시 1회 사용 시 매출 상세에 `[보유권 사용]` 라인이 안 뜨던 문제(보유권 차감 자체는 정상). `SaleForm` sale_details 생성에 `usePkgToday`(구매 즉시 사용) 기반 `[보유권 사용]` 라인 추가 — 0원, qty=사용수, `item_kind=pkg_use`. 편집 모드는 `^\[보유권` 가드로 items 프리필 제외 + sale_details 재생성 안 함 → 무영향
- **수연 `id_f19sih2au8`** — 타임라인 시간 이동 시 이전으로 되돌아감. 원인: `confirmChange`(알림톡 팝업 경로 이동 저장)가 이동값을 state(`data.reservations`의 `r`)에서 읽는데, 팝업이 떠 있는 동안 폴링/Realtime이 state를 이동 전 DB값으로 덮으면 옛 시간이 저장됨. 팝업 없는 즉시저장 경로는 드래그 스냅(`snap`)을 직접 써서 정상이었음. **fix**: `confirmChange` move 블록을 스냅(`d`) 기준으로 재작성 — time/room/bid/staff/dur 전부 `d`(snap)에서 계산, `r`는 fallback. 저장 후 state도 스냅 기준 재반영
- 수정요청 3건 전부 done 처리 (현아 `id_eih96ttwa0` 커플 패키지 — v3.7.749~752로 구현 완료)
- **적용**: v3.7.753 라이브 배포(version.txt 검증, CF 퍼지 success)
- **유의**: 수연 시간이동 건은 명확한 재현 케이스 없이 코드 분석으로 잡은 fix(팝업 경로의 stale-state 읽기) — 재발 시 추가 조사 필요

### mac-daemon — 입금문자 데몬 다중 은행 확장 (KB + 하나) (2026-05-18)
입금문자 데몬(`mac-daemon/kb_sms_poll.py`)이 KB 전용 → KB·하나은행 다중 은행 지원으로 확장. (React 앱 무관 — 버전업·배포 없음)
- **하나은행 입금 SMS 형식**: `하나,MM/DD HH:MM \n 계좌마스킹 \n 입금{금액}원 \n 입금자명 \n 잔액{잔액}원` — 발신번호 `+8215991111`. KB와 다름(입금+금액 한 줄, 이름이 금액 뒤, "원" 접미사). `HANA_PATTERN` 신규
- `BANKS` 리스트 구조 — `{name, sender, parse, source}`. 발신번호로 은행 판별, 은행 추가 쉬움. `fetch_messages`는 `h.id IN (KB,하나 발신번호)` 조회
- **천호점 하나은행 계좌** `129******15407` → `br_xu60omgdf` 매핑 (`.env BLISS_KB_ACCOUNTS` — 은행 무관 공용 맵, 마스킹 계좌번호가 키)
- **attributedBody fallback 추가** — macOS가 수신 직후 본문을 `text`→`attributedBody`(NSKeyedArchiver 바이너리)로 옮겨, `text`만 읽던 기존 데몬은 폴링 타이밍 놓친 문자를 누락했음. `msg_body()`가 `text` 비면 attributedBody에서 UTF-8 본문 런 추출. `fetch_messages`에서 `text IS NOT NULL` 필터 제거
- 검증: 하나 1원 테스트 입금(이정우) → `bank_deposits` 천호점(`br_xu60omgdf`) 정상 기록 확인
- launchd 재등록 불필요 — plist는 동일 스크립트를 60초마다 실행, 다음 주기에 새 코드·`.env` 자동 적용
- `bank_deposits.source`: KB=`kb_sms`, 하나=`hana_sms`

### v3.7.754 — 입금문자 카드에 지점명 표시 (2026-05-18)
- 메시지함 입금문자 탭(`BankDeposits`)의 입금 카드가 어느 지점 입금인지 안 보이던 문제 — 상태 배지 옆에 지점명 칩 추가 (`branches`에서 `d.bid`로 조회). `[미매칭] [천호점] 이정우` 형태
- 입금문자 목록은 기존부터 `userBranches` 기준 지점 필터 (`bid=in.(userBranches)`) — 다른 지점 입금은 안 보이고, 연계지점(branchGroup 자동 머지)은 함께 보임. 대표 계정은 userBranches가 전 지점이라 모두 표시 → 지점 칩이 특히 유용
- **적용**: v3.7.754 라이브 배포(version.txt 검증, CF 퍼지 success)

### 서버 — 외국 번호 고객 중복 생성 버그 fix (2026-05-18, React 변경 0)
- **증상**: 네이버 예약 외국 고객이 고객관리에 수십 건 중복 — Taevion(태국 `+66837777677`) 32건, rania(미국 `+16146877948`) 12건. 5분 재스크랩마다 1건씩 신규 생성
- **원인**: `bliss_naver.py` `find_cust_by_phone` 전화 정규화가 한국 번호 위주 — 외국 번호의 `+`를 떼고 숫자만으로 조회 후보 생성. DB 저장값은 `+` 포함(`+66...`)이라 후보와 불일치 → 매번 "기존 고객 없음" → 신규 INSERT. (`+82`만 국제형식 후보 추가, 그 외 국가번호 미처리). 중복이 쌓이면 멀티매칭으로 더 못 잡아 폭주
- **fix**: `find_cust_by_phone` `_candidates`에 원본 전화(`_raw_phone` — `+` 포함)와 `'+' + _digits` 추가 → 외국 번호도 정상 매칭. `/book-submit`·AI예약·방문자 매칭 등 `find_cust_by_phone` 호출 전부 혜택
- **정리**: Taevion 32→1, rania 12→1. 가장 오래된 레코드(= 예약·매출이 가리키던 것) 유지, 나머지 삭제. sales/customer_packages/customer_shares 참조는 전부 keeper를 가리켜 안전
- **적용**: 서버 직접 패치(백업 `bliss_naver.py.bak_pre_intlphone_*`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·배포 불필요

### mac-daemon — 입금문자 데몬 수협은행 파서 추가 (2026-05-18)
- 입금문자 데몬(`kb_sms_poll.py`)에 **수협은행** 파서 추가 — KB·하나·수협 3개 은행 지원
- 수협 SMS 형식: `수협MM/DD,HH:MM \n 계좌마스킹 \n 입금{금액}원 \n 잔액{잔액}원 \n 입금자명` — KB·하나와 또 다름(헤더 `수협`, **입금자명이 잔액 뒤 맨 끝 줄**). `SH_PATTERN` 신규, `BANKS`에 수협(`+8215881515`, `sh_sms`) 추가
- 등록 계좌 6개(`.env BLISS_KB_ACCOUNTS`): 강남 `809101**812`·왕십리 `924501**300`·잠실 `651401**014`(KB) / 천호 `129******15407`·위례 `364******62607`(하나) / 용산 `001*-****-*088`(수협)
- 검증: 수협 1원 테스트(이정우) → `bank_deposits` 용산점 정상 기록
- `bank_deposits.source`: KB=`kb_sms`, 하나=`hana_sms`, 수협=`sh_sms`

### mac-daemon — 우리은행 파서 추가 + 잔액 옵셔널 (2026-05-18)
- 입금문자 데몬에 **우리은행** 파서(`WOORI_PATTERN`, 발신 `+8215885000`, `woori_sms`) 추가 — KB·하나·수협·우리 **4개 은행** 지원
- 우리 SMS 형식: `우리 MM/DD HH:MM \n 계좌 \n 입금 {금액}원 \n 입금자명` — **잔액 줄 자체가 없음** → balance=0
- **발견**: 계좌마다 SMS의 잔액 표시 여부가 다름 — 새로 개통한 계좌(잠실 KB·위례 하나)는 잔액 줄이 없음. KB·하나·수협 패턴의 잔액 매칭을 전부 **옵셔널**로 변경(`_money()` 헬퍼 — None이면 0)
- **8개 지점 전 계좌 등록 완료** (`.env BLISS_KB_ACCOUNTS`): 강남·왕십리·잠실·홍대(KB) / 천호·위례(하나) / 용산(수협) / 마곡(우리)
- 검증: 우리·KB·하나·수협 1원 테스트 전부 `bank_deposits` 해당 지점 정상 기록
- ⚠️ launchd가 데몬을 주기 실행하므로, 데몬 코드 편집 중에는 구버전 코드가 메시지를 소비할 수 있음 — 편집 후 누락분은 `~/.bliss-kb-sync/state.json`의 `last_rowid`를 되돌려 재처리(UNIQUE 제약으로 중복 INSERT는 무시됨)
- **폴링 간격 60초 → 15초 단축** (입금문자 반영 지연 최소화). `com.bliss.kb-sync.plist` `StartInterval`. 변경 시 `~/Library/LaunchAgents/`에 복사 후 `launchctl unload`+`load` 재등록 필요

### v3.7.755 — 입금문자 탭 콤팩트 + 무시 경고창 제거 (2026-05-18)
- `BankDeposits` 카드 콤팩트화 — 금액을 헤더 줄(이름·시각 옆)로 합쳐 한 줄 제거, padding 10→7·gap 6→5·배지 폰트 축소
- `ignoreDeposit` — "무시" 버튼 클릭 시 `window.confirm` 제거 → 즉시 무시 처리 (되돌리기 버튼 confirm은 유지)
- **적용**: v3.7.755 라이브 배포(version.txt 검증, CF 퍼지 success)

### v3.7.756 — 예약 실시간 동기화 폴링 fallback 1000행 캡 버그 fix (2026-05-18)
**증상**: 새 네이버 예약이 앱 화면에 자동으로 안 뜨고 새로고침해야 보임. 서버(Gmail push→DB)는 정상(예약 9초 만에 DB 수신 확인) — 클라이언트 표시 문제.
**원인**: `AppShell.jsx` 예약 실시간 동기화는 Realtime 구독 + 60초 폴링 fallback 2중 구조. Realtime 웹소켓은 태블릿 백그라운드 전환·네트워크 끊김으로 자주 죽음 → 폴링이 받쳐줘야 하는데, 폴링 쿼리가 `sb.get(...limit=5000)` 사용. `sb.get`은 PostgREST `db-max-rows`(1000) 서버 캡에 잘림(v3.7.728·744에서 고친 것과 동일 부류) + `order` 절도 없음. 폴링 범위(오늘-3 ~ 오늘+60일) 예약이 1,074건 → 최신 예약 ~74건이 폴링이 가져오는 1000건 밖으로 밀려나 Realtime 죽은 상태에선 영영 미반영.
**fix**: 폴링 쿼리 `sb.get` → `sb.getAll`(전체 페이지네이션) + `order=date.desc,time.asc` 추가. `onVisible`/`onOnline` 핸들러는 이미 `getAll` 사용 — 폴링만 누락이었음. 이제 Realtime이 죽어도 새 예약이 최대 60초 안에 자동 반영.
- **적용**: v3.7.756 라이브 배포(version.txt 검증 3.7.756, CF 퍼지 success). 화면 변화 없는 내부 데이터 로직.

### v3.7.757 — 받은메시지함 사이드 패널 모바일 화면 잘림 fix (2026-05-18)
**증상**: 모바일에서 상단 노란 "미매칭 입금 N건" 배너를 누르면 받은메시지함 사이드 패널이 화면 오른쪽으로 잘려 나옴.
**원인**: 사이드 패널(`AppShell.jsx` `.msg-panel`)이 데스크탑 기준 인라인 스타일 `left:200`(사이드바 폭)·`width:340`로 고정. `setPage("messages")`는 모바일이면 풀스크린 라우팅으로 분기하지만, `DepositsAlertBanner onOpen`(입금 배너 클릭)은 분기 없이 `setMessagesPanelOpen(true)` 직접 호출 → 폰(~390px)에서 패널이 `x=200`부터 `340px` 폭으로 그려져 ~150px 잘림.
**fix**: `index.html`에 `.msg-panel` 모바일 미디어쿼리 추가 — `@media (max-width:767px)`에서 `left:0 / width:100% / max-width:100% !important`로 풀스크린. 인라인 스타일을 `!important`로 오버라이드. JS 변경 0, 데스크탑(≥768px) 무영향.
- **적용**: v3.7.757 라이브 배포(version.txt 검증 3.7.757, CF 퍼지 success).

### v3.7.758 — 입금문자 카드사 정산 입금 분류·숨김 (2026-05-18)
**배경**: 입금문자 탭에 카드사 정산 입금(`KB109251201`·`NH16699618`·`신한13028239` 등)이 미매칭으로 떠 배너·배지 알림 발생. 매장은 고객 계좌이체 입금만 확인하면 됨 → 카드정산은 화면·알림에서 제외 요청.
**분류 규칙 (시스템 규칙, AI 불필요)**: 카드사 정산 입금은 입금자명에 **숫자 포함** 또는 **'카드' 키워드** — 실제 고객 이체는 사람 이름이라 숫자 없음. 결정적(deterministic) 분류라 AI 불필요. 오분류 시 입금문자 탭 '카드정산' 필터에서 [미매칭으로 되돌리기]로 복구 가능(안전밸브).
**구현**:
- DB: `bank_deposits_status_check` 제약에 `'card'` 값 추가(migration `bank_deposits_status_add_card`). 기존 카드정산 3건 `status='pending'→'card'` 일괄 전환.
- 데몬 `mac-daemon/kb_sms_poll.py`: `is_card_settlement(name)` 분류기 추가 — 카드정산이면 INSERT 시 `status='card'`. 로그에 `[카드정산]` 태그.
- `BankDeposits.jsx`: `STATUS_LABEL/BG/FG`에 `card` 추가(인디고 배지), 필터 칩에 '카드정산' 추가. 기본 '전체' 필터·카운트는 `status='card'` 제외 → 카드정산은 '카드정산' 칩에서만 노출.
- 배너(`DepositsAlertBanner`)·배지(`pendingDepositCount`)는 이미 `status=eq.pending`만 조회 → `status='card'`는 **자동 제외**, AppShell 변경 0.
- **적용**: v3.7.758 라이브 배포(version.txt 검증 3.7.758, CF 퍼지 success). 데몬은 launchd 다음 주기에 새 코드 자동 적용(재등록 불필요).
**유의**: 분류 규칙은 데몬 INSERT 시점에 1회 적용(`status` 고정). 규칙 변경 시 과거 행은 별도 UPDATE 필요. 숫자·'카드' 둘 다 없는 카드정산(드묾)은 고객 입금으로 분류됨 → '무시'하거나 키워드 추가.

### v3.7.759 — 모바일 하단 탭바 사라짐 fix (2026-05-18)
**증상**: 모바일에서 하단 탭바(타임라인/매출/메시지함/고객/더보기)가 사라져 안 돌아옴.
**원인**: `MobileBottomNav`는 `isChatOpen`이 true면 `return null`. `isChatOpen`은 받은메시지함에서 대화 스레드를 열 때(`MessagesPage.selectThread`) true가 되는데, false 복귀는 대화 안의 ← 뒤로가기 버튼 1곳뿐. 받은메시지함 패널을 × 버튼으로 닫으면(`onClosePanel`) `isChatOpen`이 true로 남아 → 타임라인 등 다른 페이지에서도 하단바가 영영 숨김. v3.7.757(모바일 패널 풀스크린)로 패널이 실제로 쓰이게 되면서 노출된 기존 버그.
**fix**: `AppShell.jsx`에서 `MobileBottomNav`에 넘기는 값을 `isChatOpen && (messagesPanelOpen || page === "messages")`로 좁힘 — 메시지함을 보고 있지 않으면 stale 플래그와 무관하게 하단바 표시. 파생값 한 줄, stale state 자체는 안 건드림(메시지함 안 볼 땐 영향 0).
- **적용**: v3.7.759 라이브 배포(version.txt 검증 3.7.759, CF 퍼지 success).

### v3.7.760 — 타지점 이동 시 직원 근무시간이 지점 운영시간보다 우선 (2026-05-18)
**증상**: 12~22시 근무 직원이 강남점→왕십리점(운영 11~21시)으로 이동하면 퇴근 시각이 21시로 잘림. 직원 본인 근무시간 무시.
**원인** (TimelinePage 3곳 — 타지점(비-홈) 컬럼만 직원 시간을 지점 운영시간으로 클립. 홈 지점은 클립 없음):
- `segHoursOf`: 이동 세그먼트의 시작/끝 시각 fallback이 `직원+지점별 → branchDefault`라 직원 본인 일반 근무시간(`empWorkHours[empId]`/`_date`)이 누락 → 지점 운영시간이 채워짐.
- `getEmpActiveSegments`: `branchId !== baseBid`이면 `start=max(직원,지점)`, `end=min(직원,지점)` 교집합 클립 → `end=min(22,21)=21`.
- 근무시간 설정 팝업: 동일 min/max 클립.
**fix** (유저 확정 — "직원 근무시간이 더 강하게", 시작·종료 모두 직원 우선):
- `segHoursOf` fallback 체인에 `empWorkHours[empId+"_"+date] || empWorkHours[empId]` 추가(branchDefault 앞) → `getEmpBaseHours`와 동일 우선순위.
- `getEmpActiveSegments`: 비-base 클립 블록 제거 → `wh = empWh || branchHours`.
- 설정 팝업: 클립 분기 제거 → `savedWh = explicitWh || empBaseWh || branchHours || 기본값`. 미사용 `_baseBid` 제거.
- 결과: 직원 근무시간이 있으면 타지점에서도 그대로 사용, 지점 운영시간은 직원 시간이 아예 없을 때만 fallback (홈 지점과 동일 규칙).
- **적용**: v3.7.760 라이브 배포(version.txt 검증 3.7.760, CF 퍼지 success).

### v3.7.761 — 멤버십 모델 + 직원 모바일 계정 (2026-05-19)
직원이 모바일에서 본인 근무시간(타임라인)을 확인하는 기능. 인증 레이어를 계정↔멤버십 모델로 재구축.

**모델 전환** — 기존 `app_users` 한 행이 [계정+사업장+역할]을 묶던 구조 → 분리:
- **`accounts`** (신규, 신원): `id, login_id(unique), password_hash, password, name, email`. 자격증명 테이블이라 **RLS 켜고 정책 없음**(기본 거부) — `SECURITY DEFINER` RPC로만 접근.
- **`app_users`** = 이제 "멤버십"(계정↔사업장 관계). 컬럼 추가: `account_id`(→accounts), `emp_name`(근무표 직원 연결), `status`(`active`/`pending`/`rejected`, 기본 active). 한 account가 멤버십 N개 → 한 사람이 A매장 직원·B매장 사장 가능. 테이블명 유지(33곳 참조 보존). `login_id` unique 제약 없음 → 멤버십이 계정 login_id 공유.
- 기존 17행 마이그레이션: 행마다 account 1 + membership 1, 전부 active. status 컬럼 default로 기존 행 자동 active.
- 별도 "요청 테이블" 없음 — `status='pending'` 멤버십 행 자체가 곧 등록 요청.

**RPC 4종** (전부 SECURITY DEFINER):
- `auth_login_v2(login_id, password)` → `{account, memberships[]}`. 기존 `auth_login`은 유지(미사용).
- `account_signup(login_id, password, name, email)` → accounts 행만 생성(사업장 미생성). 중복 시 `login_id_taken`.
- `staff_join_request(account_id, store_code)` → `businesses.code`로 사업장 찾아 pending 멤버십 INSERT. `store_not_found`/`already_member`.
- `auth_oauth(email, provider_login, name)` → OAuth용. account 찾기/생성(사업장 미생성).

**클라이언트** (`AppShell.jsx` — 실제 인증은 전부 AppShell, `AuthContext.jsx`는 죽은 코드):
- `mapMembership(m, account)` — 멤버십+계정 → currentUser 형태(기존 필드 유지, 앱 나머지 무변경).
- `handleAccountLogin(account, memberships)` — 활성 1개 → 바로 진입 / 여러개 → `pick_membership` / pending만 → `staff_pending` / 0개 → `no_membership`.
- `Login` — `auth_login_v2` 호출. `SignupWizard` — 단일 스텝 account 생성(구 2스텝 사업장 등록 제거). OAuth 핸들러 — `auth_oauth` 사용, 자동 사업장생성 제거.
- `AccountGate` 신규 — pick_membership(매장 선택) / staff_pending(승인 대기) / no_membership(매장코드 합류 요청 + 내 사업장 만들기) 3화면.
- `StaffRequestsBanner` 신규 — owner/manager/super에게 pending 멤버십 배너+모달, 수락(근무표 직원 선택→active·emp_name·branch_ids 전지점)/거절. `app_users` anon-writable이라 PATCH 직결.
- 직원 권한: `role==='staff'` → nav = 타임라인·공지만, 라우트 가드(그 외 경로 → /timeline), DepositsAlertBanner 미노출, 타임라인 날짜탭 D-3~D+3(7일)·changeDate 클램프.

**검증**: 로컬 dev server(라이브 Supabase 연결)로 가입→합류요청→승인대기→승인후 앱로드→직원 nav제한→타임라인 7일 전 경로 통과, 콘솔 에러 0. 테스트 계정 정리 완료.
- **적용**: v3.7.761 라이브 배포(version.txt 검증 3.7.761, CF 퍼지 success). DB 마이그레이션 4건은 additive로 이미 적용됨.
**유의**:
- `app_users`는 이제 의미상 "멤버십" (테이블명만 유지). `currentUser.id` = 멤버십 id, `currentUser.account_id` = 계정 id.
- `accounts`는 RLS 정책 없음(잠금) — 직접 SELECT/INSERT 불가, RPC로만. `anon_all` 정책 추가 금지(시크릿).
- 매장코드 = `businesses.code`. 직원에게 코드를 알려줘야 합류 요청 가능. 마스터/지점계정 누구든 수락 가능.
- 미검증(별도): OAuth 실계정 로그인, pick_membership(현재 멤버십 2개 이상 계정 없음). 모바일 하단탭에서 직원 공지는 '더보기' 안쪽.
- 구 `auth_login` RPC·`SignupWizard` 사업장 생성 로직은 제거/대체됨 — 신규 사업장은 AccountGate "내 사업장 만들기"로.

### 서버 — AI 자동응대 콧속 왁싱 시술 안 함 룰 추가 (2026-05-19, React 변경 0)
**증상**: 자동응대 AI가 "콧속/코 안쪽 왁싱 되나요?" 질문에 "한다"고 잘못 답함. 메뉴에 없는 부위 + 점막 염증·감염 위험으로 어느 지점에서도 시술 안 함.
**fix 2겹**:
1. **`businesses.settings.ai_faq` 한·영 1쌍 추가** (jsonb append, 4건으로 증가) — Q "콧속 왁싱 되나요?"/"Do you do inner nose waxing?" + A "콧속 점막 염증 위험으로 시술 안 함, 안전상 메뉴에 없음". `category="위생안전"`. 마취크림 룰(2026-05-16)과 동일 패턴, 5분 캐시 후 자동 반영
2. **`ai_booking.py` 프롬프트 본문에 `[⛔ 콧속 왁싱 = 시술 안 함]` 블록 추가** — "상담" 키워드 매칭 금지 룰(v3.7.408) 다음·확정 멘트 금지 룰 앞. 콧속/코 안쪽/콧털/코털/nose hair/nostril/inner nose 키워드 시 ① service 매칭 금지(풀페이스/눈썹/인중 등으로 잘못 매칭 차단) ② action=chat 강제 ③ 한·영 응답 예시 박음 ④ ★ 눈썹·인중·입술 주변 등 코 바깥 얼굴 부위 매칭은 정상(콧속 한정 룰 명시)
**검증** (suggest_only 5건): KR 콧속 2건 → "콧속 왁싱은 점막 염증 위험으로 시술 안 해요, 안전상 메뉴에 없음" / EN 2건 → "We don't offer inner nose (nostril) waxing, mucous membrane is sensitive, not on our menu" / 회귀 "눈썹 왁싱 가격" → 정상가 45,000원 매칭 ✅. 5/5 PASS.
**적용**: ai_faq는 Supabase 직접 jsonb update (5분 캐시 후 반영). `ai_booking.py` 서버 직접 패치(백업 `ai_booking.py.bak_pre_nose_20260519_231537`) + `systemctl restart bliss-naver` 즉시 반영. React 변경 0 → 버전업·배포 불필요.
**유의**: 자동응대 AI는 `ai_faq`(빠른 단건) + RAG 학습문서(`documents`/`document_chunks`, 대량 지식) 둘 다 우선 참조. 콧속 같은 단건 안전 룰은 ai_faq가 표준 경로 — 코드 변경 없이 캐시만 만료되면 반영. 프롬프트 본문 박기는 매칭 차단(service_ids에 잘못 들어가는 것 방지)까지 강제할 때 추가로 함.

### v3.7.770 — 회원번호(cust_num) 폰트 통일 + 누적 묶음 배포 (2026-05-19)

#### 회원번호 폰트 통일 (ReservationModal 4곳)
**증상**: 예약 모달 상단 고객정보의 `#50976` (cust_num)이 흐린 회색 + 0에 사선 있는 monospace 폰트라 가독성 낮음.
**fix** (`ReservationModal.jsx` 4곳):
- 사진 위치 [:1912](src/components/Timeline/ReservationModal.jsx:1912) (CopySpan `#{custNum}`): `color:#999 → T.text`, `fontFamily:"monospace"` 제거, `fontWeight:700` 추가
- 고객 검색 후보 칩 [:1975](src/components/Timeline/ReservationModal.jsx:1975), [:2120](src/components/Timeline/ReservationModal.jsx:2120) (배경 있는 pill): `color:T.textSub → T.text`, `monospace` 제거, `fontWeight:600 → 700`
- 매출 모드 상단 [:3313](src/components/Timeline/ReservationModal.jsx:3313) (이름 옆 `#{custNum}`): `color:#999 → T.text`, `monospace` 제거, `fontWeight:600 → 700`
- **시행착오**: 첫 시도에 `fontVariantNumeric:"tabular-nums"`로 자릿수 정렬 보존하려 했는데 — iOS/macOS SF Pro에서 `tabular-nums`가 **SF Pro Tabular 변형(슬래시드 제로)** 트리거. 다시 사선이 들어왔음. `tabular-nums` 빼고 본문 폰트 기본 0(사선 없음) 사용. 5자리 cust_num은 자릿수 정렬 효과 미미해서 빼도 무해
- 결과: 본문 시스템 폰트(-apple-system/Pretendard 등) 상속 + 700 굵게 + T.text 진한색. 0에 사선 없음

#### 누적 묶음 배포 (이번 배포에 같이 나간 코드 완료분)
- **`BankDeposits.jsx` 입금문자 매칭 실액션** (HANDOFF에 "코드 완료, 다음 배포 때 반영"이었던 것): 매칭이 status='matched'만 찍던 no-op → 실제 액션 — 입금→예약 매칭 시 `external_prepaid` 자동 가산 + `external_platform="계좌이체"` + `schedule_log`에 `[예약금] {입금자} {액}원 입금 · MM/DD HH:mm` + `예약금완료` 태그(`PREPAID_TAG_ID`) 자동 추가. 매칭 카드에 `→ 예약 {date time 이름}` / `→ 매출 {date 이름}` 연결정보 표시(`matchedInfo` batch fetch). `rollbackReservation()`으로 매칭 해제 시 선결제 차감 원복 + 로그 라인 제거 + 태그/계좌이체 경로 제거
- **케어 카탈로그 변경** (`AdminNoti.jsx`): `after_53d` 항목 제거, `after_1d_first_only`·`after_18d_first_only`·`after_60d` 추가. 18일 신규고객 SMS는 RPC `get_care_sms_targets_first_only` 기반(2026-05-18 작업과 연결)
- **주의 사항 (네이버 예약 external_prepaid race)**: 네이버 예약에 매칭 시 서버 재스크랩이 `external_prepaid`를 덮을 수 있음. `schedule_log`는 PRESERVE라 안전. 입금문자 매칭은 대부분 카운터/카카오 예약 대상이라 실무 영향 적음. 필요 시 서버 `BLISS_PRESERVE_FIELDS`에 `external_prepaid` 추가 검토 (별도)

**적용**: v3.7.770 라이브 배포(version.txt 검증 3.7.770, CF 퍼지 success). React only. cust_num 폰트는 데스크탑·모바일 모두 ReservationModal 진입 시 즉시 반영(자동 새로고침 로직 따라). HANDOFF의 "예약 알림톡 엑셀 본문 전환 — 카카오 검수 대기" 항목은 외부 의존이라 그대로 유지.

### v3.7.771 — 회원번호 폰트 앱 전역 통일 + 커플 메모 검수 페이지 (2026-05-19)

#### cust_num monospace 제거 — 앱 전역 9곳
v3.7.770의 ReservationModal 4곳에 이어 — 나머지 화면도 통일. `fontFamily:"monospace"`만 제거(SF Pro 기본 0 = 사선 없음). 색·굵기·크기는 각 위치 원래 의도 유지. `tabular-nums` 미추가 (SF Pro Tabular = 슬래시드 제로 회피, v3.7.770 시행착오 학습).
- [ShareCustModal.jsx:89](src/components/Customers/ShareCustModal.jsx:89) (쉐어 검색 결과 nano)
- [CustomersPage.jsx:1854](src/components/Customers/CustomersPage.jsx:1854) (테이블 td xs/800) · [:1964](src/components/Customers/CustomersPage.jsx:1964) (이름 옆 sm/textSub) · [:2185](src/components/Customers/CustomersPage.jsx:2185) (쉐어 칩)
- [SalesGridPage.jsx:557](src/components/Sales/SalesGridPage.jsx:557) (매출 그리드 테이블)
- [SaleSummary.jsx:136](src/components/Sales/SaleSummary.jsx:136) (제목 옆 13/textSub)
- [AdminLongValidityReview.jsx:210](src/components/Admin/AdminLongValidityReview.jsx:210), [AdminCouplePkgMigrate.jsx:200](src/components/Admin/AdminCouplePkgMigrate.jsx:200) (관리 페이지 테이블)
- [TimelinePage.jsx:5385](src/components/Timeline/TimelinePage.jsx:5385) (타임라인 예약 블록 안 cust_num)
- [SaleForm.jsx:3247](src/components/Timeline/SaleForm.jsx:3247) (매출 폼 고객 헤더)

#### 커플 메모 검수 페이지 신규 — `AdminCoupleMemoReview.jsx`
**배경**: 정식 customer_shares·`customer_packages.note`의 `커플:<gid>` 마킹 시스템(v3.7.749~752)이 도입되기 전 — 매장 직원이 `customers.memo`에 "커플패키지/커플 프리패스/<번호 이름>님과 커플..." 같은 자유 텍스트로 커플 관계를 적어두던 케이스가 존재. 정식 데이터로 안 옮겨진 짝꿍 연결을 검수·마이그레이션할 도구 필요.
**구현**: 관리설정 → 사업장 관리 → "커플 메모 검수" (slug `couple-memo-review`, `AdminCouplePkgMigrate` 옆)
- 키워드 5종 ILIKE OR 검색: `커플패키지`/`커플 패키지`/`커플프리패스`/`커플 프리패스`/`커패`
- 테이블 컬럼: 고객 · 연락처 · 매장 · 메모 발췌(키워드 노란 형광펜·"전체 보기" 토글) · 활성 보유권(💑 = note에 `커플:` 이미 마킹) · 짝꿍 연결
- 짝꿍 미연결 행은 주황 배경 + `[짝꿍 지정]` 버튼. 연결 완료는 `↔ 짝꿍 이름` 배지 + 복수 짝꿍 지원(`+추가`)
- 짝꿍 지정 = `ShareCustModal` 재사용 → `customer_shares` UPSERT (중복 시 생략, 양방향 a/b lookup)
- 검색·매장 필터 + 상단 카운트(매칭 N명·짝꿍 미연결 M명) + `userBranches` 자동 필터
- **분업 원칙**: 이 페이지는 **메모 텍스트 기반 짝꿍 연결만 담당**. `customer_packages.note`의 `커플:<gid>` 마킹 + 상대방 보유권 분리 발급은 별도 페이지(`AdminCouplePkgMigrate` — `services.is_couple=true` 상품 기반)
- 데이터 규모 — 키워드 매칭 ~6건 내외(현재 강남점 기준)
- 권한: `isMaster`만 (owner/manager)

**적용**: v3.7.771 라이브 배포(version.txt 검증 3.7.771, CF 퍼지 success). React only. 신규 페이지 진입 시 자동으로 매칭 고객·짝꿍 관계·활성 보유권 일괄 fetch. 콘솔 에러 0건 확인.

### v3.7.772 — 타임라인 직원 설정 팝업 화면 밖 잘림 fix (2026-05-20, 지은 id_sq9lg62bn6)
**증상**: 데스크탑 타임라인에서 **마지막 직원 컬럼(우측 끝)** 헤더 클릭 시 뜨는 "○○ · 직원 이동/근무" 설정 팝업이 화면 밖으로 밀려 잘림. 취소·변경 없음·오늘 휴무 등 하단 버튼이 viewport 밖으로 나가서 누를 수 없음.
**원인** ([TimelinePage.jsx:4237](src/components/Timeline/TimelinePage.jsx:4237)): 데스크탑 분기에서 left 보정이 `Math.min(x, innerWidth-200)`로 200px만 확보. 실제 패널 폭이 ~360px이라 ~160px가 잘림. 세로 잘림 안전장치(maxHeight)도 없었음.
**fix**: 데스크탑 분기 스타일 한 줄 보정 — left/top 클램프 + 패널 폭 명시 + 세로 스크롤.
- `left: Math.max(8, Math.min(x, innerWidth-388))` (380 패널 폭 + 8 마진 기준, 최소 8)
- `top: Math.max(8, Math.min(y+8, innerHeight-120))` (세로도 화면 안 클램프)
- `width: 'min(360px, calc(100vw - 16px))'` (`minWidth:200` 대체 — 명시 폭으로 콘텐츠 길어져도 일정)
- `maxHeight: 'calc(100vh - 24px)' + overflowY:'auto'` (콘텐츠 긴 케이스 세로 잘림 차단)
- 모바일(`<768px`) 풀스크린 분기는 기존 그대로 무영향
**적용**: v3.7.772 라이브 배포(version.txt 검증 3.7.772, CF 퍼지 success). React only. 콘솔 에러 0건 확인. 지은 요청 `id_sq9lg62bn6` status=done + reply 처리.

### v3.7.773 — AI 자동응답 미응답 N분 후 지연 답변 (2026-05-20)
**배경**: 기존 자동응답은 메시지 인입 즉시 발송 (채널 ON + 시간 윈도우 안). 정우님 요청 — "직원이 N분 안에 답하지 않을 때만 AI가 폴백 답변" 기능 추가. 직원이 응대할 기회 우선 보장 + 누락 시 AI가 받쳐줌.
**설계 — 지연 큐 + worker**:
1. 메시지 인입 webhook이 `ai_booking_agent` 호출 → 기존 채널/시간 게이트 통과 후 **delay 분기**: `ai_auto_reply_delay.enabled && minutes>0`이면 즉시 응답 대신 `pending_ai_replies` 테이블에 row INSERT(`scheduled_at=now+N분`), `return ""`. 같은 thread(channel+account_id+user_id)에 이미 pending row 있으면 `canceled_by_followup` 마킹(=새 메시지 인입 시 카운트 재시작)
2. 새 worker thread `pending_ai_replies_worker` (60초 주기): `status=pending & scheduled_at<=now` 행 가져와 처리 — (a) `trigger_created_at` 이후 같은 thread 직원 outbound 발송 있으면 `canceled_by_staff` (b) 없으면 마지막 inbound 메시지 + `ai_booking_agent(_from_worker=True)` 재호출 → 응답 발송 + `status=sent`
3. `_from_worker=True`/`force=True`/`manual=True`/`suggest_only=True`는 delay 분기 우회 (직원 [추천]/[예약등록] 클릭 등 수동 호출 즉시 동작)
4. 채널·시간 게이트는 그대로 유지 (worker 호출 시점에도 한 번 더 적용 — 시간 윈도우 밖이면 `canceled_by_gate`로 폐기)
**구현**:
- DB: 신규 테이블 `pending_ai_replies` (id/business_id/channel/account_id/user_id/trigger_msg_id/trigger_created_at/scheduled_at/status/created_at/processed_at/response_text/error_msg) + `idx_pending_ai_replies_due`(scheduled_at, status=pending partial) + `idx_pending_ai_replies_thread` + RLS `anon_all_pending_ai_replies`. migration `pending_ai_replies_init`
- 서버 `ai_booking.py` ([line ~932 직후](#)): signature에 `_from_worker=False` 추가, schedule check 통과 후 delay 분기 추가. 호출 사이트(IG/WA/네이버/카카오/LINE webhook 5곳) 변경 0 — 함수 안에서 분기 처리
- 서버 `bliss_naver.py`: `pending_ai_replies_worker()` 함수 + thread 시작(`t_par`, daemon, name=`pending_ai_replies`) `t_rsv_remind` 직후
- 앱 `MessagesPage.jsx`: AI 자동대답 패널(메시지함 사이드)에 카드 추가 — `⏳ 미응답 N분 후 자동 답변` 토글 + 분 입력 (1~60). `settings.ai_auto_reply_delay = {enabled, minutes}`. 2곳(default + forceCompact 모드) 동일 마크업
**검증**: 서버 로그 `[pending_ai_replies_worker] 시작` 확인. 앱 콘솔 에러 0. 라이브 version.txt = 3.7.773. CF 퍼지 success.
**백업**: `/home/ubuntu/naver-sync/ai_booking.py.bak_pre_delayreply_20260520_082922`, `bliss_naver.py.bak_pre_delayreply_20260520_082922`
**유의**:
- delay 설정이 **활성화돼 있는 동안엔 모든 인입 메시지가 지연 큐로 들어감** — 즉시 응답 X. OFF로 돌리면 기존 즉시 응답 동작 복귀
- 한 thread에서 손님이 추가 메시지 보내면 기존 pending이 `canceled_by_followup`되고 새 pending으로 갱신 → N분 카운트 마지막 메시지 기준으로 재시작
- worker 호출 시점에 채널·시간 게이트가 OFF면 답변 안 함 (`canceled_by_gate`). 즉 영업시간 종료 직전 메시지 + N분 후 영업종료 → AI 답변 X (의도된 동작)
- `pending_ai_replies` 테이블은 디버그·감사용. status 분포로 worker 동작 확인 가능 (`sent`/`canceled_by_staff`/`canceled_by_followup`/`canceled_by_gate`/`error`)

### v3.7.774 — 지연 분 input backspace 막힘 fix (2026-05-20)
**증상** (정우님 모바일 보고): "미응답 N분 후 자동 답변" 카드의 분 input에서 "1"을 backspace로 지우려 해도 즉시 다시 "1"이 채워져 지워지지 않음 → 두 자리 숫자 입력 불가.
**원인** ([MessagesPage.jsx](src/components/Messages/MessagesPage.jsx)): onChange가 `Number(e.target.value)||1` 폴백 + `Math.max(1, …)` 강제 → 빈 문자열 입력 순간 즉시 1로 덮어써짐. 자유 편집 불가.
**fix**: 빈 값을 허용하는 controlled 패턴으로 교체.
- value: `aiDelay.minutes === '' ? '' : (minutes||1)` — 빈 문자열 상태를 렌더
- onChange: 빈 값이면 `setAiDelay({minutes:''})`만 (DB 저장 X) / 유효 숫자면 `saveAiDelay({minutes: clamp(1,60, floor(n))})`
- onBlur: 빈 값/0이면 `saveAiDelay({minutes:1})`로 보정 (디폴트 폴백)
- `Math.floor` 추가 — 소수점 입력(예: "1.5") 차단
- 2곳(default + forceCompact 모드) 동일 마크업이라 `replace_all`로 일괄
**검증**: 콘솔 에러 0, 빌드 OK, 라이브 version.txt = 3.7.774, CF 퍼지 success

### 서버 — AI 자동응대 등록 고객 호칭 (2026-05-20, React 변경 0)
**요청**: AI 자동응답이 `customers.sns_accounts`에 등록된 단골 고객한테 답할 때 이름을 호칭으로 사용 (예: "Christina님 안녕하세요" / "Hi Christina").
**fix** (`ai_booking.py`):
1. **등록 고객 lookup** (`_cust_history` 분기 다음): `customers.sns_accounts cs [{channel, user_id}]` PostgREST 매칭 — 채널 무관(공통/매장별 모두). 매칭되면 `{id, cust_num, name, gender, visit_count, last_visit}` 추출 (방문수·최근일은 sales 테이블 별도 조회)
2. **prompt 블록 신설** `registered_cust_block` — `[등록 고객 — sns_accounts 자동 매칭. 정보 재질문 절대 금지]` 헤더 + 이름·고객번호·성별·이력 + 호칭 룰 (한국어 "○○님" / 영어 "Hi {first_name}" / 일·중·기타 자연스러운 호칭). prompt template `{registered_cust_block}\n{cust_history_block}` 위치 — 채널 정보 블록 다음
3. 기존 `_cust_history`(공통 채널 + 이전 예약 lookup)와 별개로 동작 — sns_accounts 매칭이 더 강력 + 모든 채널 적용. 둘 다 매칭 시 두 블록 동시 노출 (모순 없음, 서로 보완)
**검증** (suggest_only + force):
- Christina(`cust_xhsbaoat9`, WhatsApp 447512320540) KR 응대 → "안녕하세요~ **Christina님**! 😊 네, 예약 가능해요!" ✅
- EN 응대 → "**Hi Christina!** 😊 Yes, we have availability tomorrow…" ✅
**적용**: 서버 직접 패치 (`ai_booking.py.bak_pre_namesalute_20260520_085800`) + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF 퍼지 불필요. worker thread 정상 재기동 확인.
**유의**:
- `sns_accounts` 매칭은 `customers` 테이블에 `[{channel, user_id, account_id, linked_at}]` JSON 배열 있을 때만. 매칭 실패 = 등록 안 된 고객 → 기존 그대로 (호칭 없음 / "고객님")
- 외국인 이름 first name 추출은 단순 `split()[0]`. 복합 이름 등 edge case는 풀네임 대체 가능
- 등록 고객은 prompt에 `정보 재질문 금지` 룰 포함 → AI가 이름·연락처·이메일 재질문 자동 차단

### v3.7.775 — 모바일 풀스크린 패널 열려도 하단탭 표시 (2026-05-20)
**증상** (정우님 모바일 보고): 받은메시지함 풀스크린 패널(입금문자/팀채팅/받은메시지 리스트) 상태에서 하단탭바(타임라인·매출·메시지함·고객·더보기)가 화면에서 사라짐.
**원인**: v3.7.757에서 모바일 패널을 풀스크린(`bottom:0`)으로 만들면서 z-index 400으로 깔림 → 하단탭(z-index 100)이 패널에 가려짐. v3.7.759의 isChatOpen 분기는 채팅방 진입 시 hide 의도였는데 — 패널 열림만으로도 가려지는 부수 효과.
**fix**:
1. **AppShell**: `isChatOpen` state useEffect로 `document.body.dataset.msgChatOpen` 토글 (`messagesPanelOpen` 패턴과 동일)
2. **index.html CSS**: 모바일(`max-width:767px`)에서 채팅방 미진입(`body[data-msg-chat-open="closed"]`)이면 패널 `bottom:76px` (하단탭 영역 비움), 채팅방 진입(`open`)이면 `bottom:0` (풀스크린, 하단탭은 isChatOpen으로 자동 hide)
3. MobileBottomNav 자체는 무변경 — `isChatOpen={isChatOpen && (messagesPanelOpen || page==="messages")}` 그대로
**결과**:
- 받은메시지/팀채팅/입금문자 리스트 상태: 패널이 viewport 상단 ~ 하단탭 위까지 + 하단탭 동시 표시 → 다른 페이지로 즉시 이동 가능
- 채팅방 깊이 진입 상태: 패널 풀스크린 + 하단탭 자동 hide (기존 그대로)
**적용**: v3.7.775 라이브 배포 (version.txt 3.7.775, CF 퍼지 success). 로컬 모바일 viewport 시뮬레이션 한계로 자동 검증 부분적 — 모바일 라이브에서 직접 확인 권장.

### v3.7.776 — 네이버 막기 전체 토글 일부 누락 fix (2026-05-20)
**증상** (정우님 보고): 타임라인 네이버 예약 막기 슬롯 popup에서 "전체 막기"/"전체 풀기" 클릭 시 N개 슬롯 중 1~2개가 적용 안 되고 남음.
**원인** ([TimelinePage.jsx:5836](src/components/Timeline/TimelinePage.jsx:5836) `toggleAll`): 각 item마다 `/naver-toggle-slot` 직렬 await 호출 → N건 read-modify-write. 일부 호출이 네이버 partner API 일시 오류로 실패하면 옵티미스틱이 그 슬롯만 롤백 → "부분 적용" 상태. alert는 떴지만 N건 N번 떠서 인지 어려움.
**fix**:
1. **서버 신규 endpoint** `/naver-toggle-slot-bulk` ([bliss_naver.py:4811](#)) — `{biz_id, item_ids[], date, time, block}` 받아 직렬 처리 + 결과 dict 반환 (`{ok, results:{itemId:{ok,msg}}}`). 각 item 실패는 try/except로 격리, 다른 item에 영향 0
2. **클라이언트 `toggleAll` 재작성**:
   - 변경 대상(`targets`) 사전 추출 — 이미 원하는 상태/비활성/운영외 제외
   - 옵티미스틱 **일괄 적용** (한 번에 setNaverBlockState)
   - bulk endpoint 한 번 호출 → 결과 받기
   - 실패한 item만 핀포인트 롤백 + **알림 한 번에 통합** ("N건 막기 실패 (네이버 일시 오류): A, B, C…")
   - 전체 fetch 실패면 전부 롤백
3. 단일 슬롯 `toggleOne`은 기존 그대로 (popup 내 개별 토글용)
**검증**: 콘솔 에러 0, 서버 재시작 후 `[pending_ai_replies_worker] 시작` 정상 + bulk endpoint route 등록 확인
**적용**: v3.7.776 라이브 배포 (version.txt 3.7.776, CF 퍼지 success). 서버 `bliss_naver.py` 직접 패치(`bak_pre_toggle_bulk_20260520_101231`) + `systemctl restart bliss-naver`. 실제 동작 검증은 라이브 타임라인에서 "전체 막기/풀기" 시도로 확인 필요.
**유의**: 옵티미스틱이 `items[itemId]` undefined인 케이스는 silent skip (popup이 그 item을 표시 안 했다는 뜻). 일반적으로 popup itemIds = 화면 노출 item 동일 → undefined 발생 안 함. 발생 시 서버 결과로 다음 popup 진입에서 최신 상태 fetch

### v3.7.777 — 보유권 금액형 판정 통일 (isMoneyPkg 헬퍼) (2026-05-20)
**증상** (정우님 보고, 방유림 #16954 화면): 예약 모달 보유권 pill에 "바프권 30만 **69950회**" 표시. 실제는 잔액 69,950원 금액형인데 "회수"로 잘못 분류.
**원인**: 12개 callsite에 흩어져 있던 금액형 판정 키워드가 `다담`/`선불`/`10%추가적립`만 매칭 → **"바프권" 누락** → `(total_count - used_count) = 69,950`을 회수로 표시.
**fix** (헬퍼 통일):
1. `src/lib/utils.js`에 `isMoneyPkg(p)` 신규 헬퍼:
   - 1순위: `note`에 `/잔액\s*:/` 패턴 → 금액형 확정 (잔액이 실제로 기록된 row = 금액 보유권의 확실한 식별자)
   - 2순위: 이름 키워드 fallback (`다담`/`선불`/`바프`/`프리패스`/`10%추가적립`) — 발급 직후 잔액 미기입/구버전 데이터 대응
2. callsite 12곳 일괄 교체:
   - `ReservationModal.jsx`: 7곳 (171·178·953·1257·1469·1518·2374) — pill 표시·차감 페널티·체크박스 필터 등
   - `CustomersPage.jsx`: 2곳 (506·1101) — 보유권 카드 타입 분류
   - `SaleForm.jsx`: 3곳 (737·991·1084) — 매출등록 시 prepaid/multi 구분
3. 미래에 새 금액권 이름(예: "차징권") 추가 시에도 — note에 `잔액:` 자동 기록되므로 자동 매핑
**예상 효과**: 방유림 보유권 pill — "바프권 30만 **6.99만**" (한국식 짧은 단위) 또는 "69,950"으로 정상 표시. 매출등록 시 바프권 잔액 차감 흐름도 정상 작동.
**검증**: 콘솔 에러 0, 빌드 OK, 라이브 version.txt = 3.7.777, CF 퍼지 success. UI 표시는 모바일·데스크탑 라이브에서 방유림 예약 모달 직접 확인 권장.
**유의**:
- `isMoneyPkg`는 `customer_packages.note`의 `잔액:` 패턴이 1순위라 — 매출등록·환불 시 note가 정확히 유지되는 게 전제. 이미 동작하던 패턴이라 회귀 없음
- 비-멀티테넌트 위반 0: 키워드는 어느 매장이든 동일 (`다담/선불/바프/프리패스`는 일반적 금액권 명칭). 특정 매장 ID 하드코딩 없음
- `tagAutoTrigger.js`, `AdminMemberPriceRules.jsx`, `BlissAI/contextBuilder.js`의 다담/바프 키워드는 별개 의미(자동태그·카테고리 매핑·AI 컨텍스트)라 통일 대상 아님

### v3.7.778 — 사이드바 팀채팅 미읽 카운트 제거 (2026-05-20)
**요청** (정우님): 사이드바 "받은메시지함" 배지에 팀채팅 미읽이 합산되던 것 → 합산에서 빼기.
**fix** (`AppShell.jsx`):
- `teamChatUnread` state + 10초 폴링 fetch + Realtime 구독 useEffect 통째로 제거 (dead code 정리)
- 사이드바 배지 합산 2곳: `unreadMsgCount + teamChatUnread + pendingDepositCount` → `unreadMsgCount + pendingDepositCount`
- 받은메시지함 안 팀채팅 탭의 미읽 표시는 별도 hook(`useTeamChat.unreadCount`)이 담당 — 영향 0
**적용**: v3.7.778 라이브 배포(version.txt 3.7.778, CF 퍼지 success). 빌드 통과(syntax/타입 OK). dev HMR에서 일시 React 에러 보였으나 ErrorBoundary catch 후 정상 재마운트 — prod 무영향 확인.

### v3.7.779 — 보유권 pill 라벨에서 trailing 충전금액 제거 (2026-05-20)
**증상** (정우님 보고, 윤성욱 #52745 화면): 예약 모달 보유권 pill에 "다담권 47.8만" 정상 표시 / "다담권 100만 15.6만" 비정상(충전금액+잔액 둘 다 표시).
**원인** ([ReservationModal.jsx:956](src/components/Timeline/ReservationModal.jsx:956)): `cleanName = n.split("(")[0].trim()`이 괄호만 떼고 service_name 그대로 라벨로 사용. service_name이 "다담권"이면 OK, "다담권 100만"이면 "100만"이 라벨에 그대로 포함 → 옆 잔액과 함께 "다담권 100만 15.6만"으로 보임.
**fix** (line 957-961 prepaid 케이스): 라벨 만들 때 trailing 충전금액 정규식으로 제거.
```js
const prepaidLabel = cleanName.replace(/\s+[\d][\d,]*(\.\d+)?\s*(만원?|천|원)?\s*$/, "").trim();
```
- "다담권 100만" → "다담권"
- "바프권 30만" → "바프권"
- "프리패스권 50만" → "프리패스권"
- "다담권 1,000,000원" → "다담권"
- "다담권"(트레일링 금액 없음) → 변화 없음
- "재생 PKG 5회"(회수형) → 영향 0 (회수형 라벨은 별도 분기)
**검증** preview_eval 10/10 PASS + 빌드 syntax/타입 OK + 라이브 version.txt = 3.7.779. CF 퍼지 success. annual·multi 분기 라벨은 그대로 (회수형에 "5회" 등 의미 있는 정보라).

### 다담권 pkg_pay 알림톡 유효기간 추가 — 알리고 신규 template 등록 (2026-05-20)
**요청** (정우님): 보유권(다담권) 차감 알림톡에 남은 유효기간 안내 추가. 다회권(`tkt_pay`/`UG_6292`)은 이미 "유효 기간: 시작일 ~ 종료일" 들어있음. 다담권(`pkg_pay`/`UG_6288`)만 누락 → 신규 template 등록 + 카카오 검수.
**제약**: 카카오 알림톡은 사전 승인 template만 발송 가능 → 본문 변경 = **신규 template 등록 + 카카오 검수**(3-5영업일). 본문 코드 수정만으로 발송 거절됨.
**진행**:
1. **신규 본문 합의** — 기존 `pkg_pay` 본문에 `유효 기간: ~ #{유효기간}` 한 줄 추가
2. **8지점 × 1종 알리고 template 등록** — `kakaoapi.aligo.in/akv10/template/add/` API. 신규 tpl_code: `UI_0772`~`UI_0779`. 카카오 정책상 "채널 추가" 버튼 불가 → 버튼 미포함
3. **8지점 검수 요청** — `kakaoapi.aligo.in/akv10/template/request/` API, param 이름 `tpl_code`. 8건 모두 "검수요청을 하였습니다" 응답
4. **승인 대기** — 카카오 검수 3-5영업일
**승인 후 후속**:
- `branches.noti_config.pkg_pay`의 `tplCode`/`msgTpl` 8지점 일괄 교체
- `SaleForm.jsx:3115` `unit==='won'` 분기 params에 `#{유효기간}` 키 추가 (`pkg.note`의 `유효:YYYY-MM-DD` 파싱, 없으면 "무제한")
- HANDOFF.md에 매핑표 + 승인 후 작업 상세 명시
**유의**:
- 알리고 콘솔에 테스트 template `UI_0780-테스트조회_강남점` 1건 남음 (검수 미요청, 운영 영향 0) — 정우님 콘솔 수동 삭제 권장
- 알리고 API 응답 `code`가 문자열 `"0"` (숫자 0이 아님). 등록 스크립트 ok 판정에 주의
- "채널 추가" 버튼은 일부 카테고리에서 카카오 거절 — 향후 신규 template 등록 시 버튼 미포함 권장
**스크립트 (로컬 Mac)**: `/tmp/aligo_register_pkg_pay_v2.py` (등록) + `/tmp/aligo_pkg_pay_v2_finalize.py` (list + request)

### v3.7.780 — 손님 셀프 보유권/포인트 조회 페이지 (SMS 인증) (2026-05-20)
**요청** (정우님): 카카오 채널 채팅창 하단 메뉴 2번째 "💰 가격 안내" 제거 → "🎫 내 보유권/포인트" 신규 페이지. 손님이 전화번호 인증 후 본인 보유권·포인트 셀프 확인.
**구현 — 3개 파트**:
1. **서버 신규 endpoint 2개** (`bliss_naver.py`):
   - `/customer-verify-send`: 전화번호 받아 SMS 인증코드(6자리) 발송. rate limit 1분, 메모리 캐시 `_cust_verify_codes`. 발송은 `send-sms` Edge Function(UMS NPRO3, 강남점 발신번호) 재사용
   - `/customer-verify-check`: 코드 검증 + `customers` 매칭(phone OR phone2) → `customer_packages` 활성(잔여>0 + 미만료) + `point_transactions` 잔액(earn − deduct − expire) → 응답 dict
   - 보안: 코드 10분 만료, 5회 틀리면 lock, 사용 후 재사용 차단
2. **신규 페이지** [`public/mypage.html`](public/mypage.html):
   - Step 1 — 전화번호 입력(자동 하이픈) → "인증코드 받기"
   - Step 2 — 6자리 코드 입력(`autocomplete="one-time-code"` iOS SMS 자동 채우기 지원) + 10분 카운트다운 + "번호 다시 입력"
   - Step 3 — 결과: 고객명·고객번호 + 보유권 카드(금액형/회수형 자동 구분 + 유효기간) + 포인트 잔액 카드. "다른 번호로 다시 조회"
   - 디자인: 블리스 보라 톤(book.html 패턴), 모바일 first(maxWidth 480), noindex/nofollow
3. **카카오 채널 메뉴 URL 교체** (정우님 수동 작업): 8지점 채널 관리자에서 두 번째 메뉴 "💰 가격 안내" → "🎫 내 보유권/포인트" 라벨 + URL `/prices.html?bid=*` → `/mypage.html`
**적용**: v3.7.780 라이브 배포(version.txt 3.7.780, CF 퍼지 success). 페이지 [https://blissme.ai/mypage.html](https://blissme.ai/mypage.html) 200. 서버 재시작 후 endpoint 정상 기동.
**유의**:
- 인증코드 캐시는 메모리(서버 재시작 시 휘발) — 10분 만료라 큰 영향 X
- `customers` 매칭은 8지점 통합(business_id) — 매장 무관 본인 전체 보유권/포인트 표시
- 한 전화번호에 여러 고객 매칭 시 첫 번째 행만 표시 (단순화) — 동일인 다른 매장 등록 케이스
- SMS 1건 비용 발생(UMS NPRO3 SMS) — 인증 시도마다 발생. rate limit으로 남용 방지
- 카카오 채널 메뉴는 카카오톡 채널 관리자 페이지 수동 변경 (8지점 각각). API 자동화 없음

### v3.7.781 → v3.7.784 + AI 게이트 fix (2026-05-20 ~ 21)

#### v3.7.781~783 — 대화 카드 AI 자동응대 상태 배지 (2026-05-20)
- 메시지함 대화 카드에 AI 상태 배지 표시 — `🤖 N초 후 자동응답`(pending) / `🤖 AI 응대중`(sent + 그 후 직원 outbound 없음). 5초 폴링으로 `pending_ai_replies` 조회 후 `aiBadgeMap`.
- **AI active 모드** 도입 (서버): 같은 thread에 최근 `sent` row 있고 그 후 직원 outbound 없으면 → delay 분기 우회 → 손님 추가 메시지 즉시 응답. 직원 개입(outbound) 시 자동 reset.
- **outbound echo is_ai 전파 fix** (v3.7.783, 서버): 네이버·WhatsApp·LINE·Instagram 5개 outbound echo INSERT에 `is_ai` 누락 — AI 본인 outbound가 "직원 outbound"로 카운트돼 active 모드가 곧바로 reset되던 버그. `is_ai: bool(row.get("is_ai"))` 전파. 클라이언트 `hasStaffAfter` 판정에도 `&& !m.is_ai` 추가.

#### v3.7.784 — AI 예약신청 라벨/카운트 분리 (2026-05-20)
- 타임라인 상단 배너 라벨이 `request`(AI) + `pending`(네이버 확정대기) 합산 카운트로 "AI 예약신청 N건"만 표시되던 것 분리.
- 3-way 표시: `ai>0 && nv>0 → "AI N · 확정대기 M"` / `ai만 → "AI 예약신청 N건"` / `nv만 → "확정대기 N건"`.

#### AI 자동응대 게이트 순서 변경 — 영업시간 직원 미응답 fallback (2026-05-21, 서버, React 변경 0)
**증상**: Liv (WhatsApp 447782560390) 영업시간 KST 10:05 inbound 메시지 11분 무응답. 설정상 미응답 1분 후 AI 자동 답변 ON.

**원인**: `ai_booking.py`의 게이트 순서가 (1) 채널 (2) **시간 윈도우 차단** (3) delay 분기. 정우님 설정 = 야간 22:00~09:00이 윈도우 안이고 영업시간(10:18 KST)은 윈도우 밖 → (2)에서 차단되어 delay 분기 진입 자체 X → enqueue 안 됨. worker 호출 `_from_worker=True`도 같은 게이트에서 또 차단됨.

**fix**: 게이트 재배치 (`ai_booking.py.bak_pre_gate_*` 백업):
- 시간 윈도우 계산 결과를 차단 대신 `_within_schedule` 변수에 담음
- delay 분기 재설계 — 영업시간(`_within_schedule=False`) + delay ON + not active mode → `pending_ai_replies` enqueue. 야간(`_within_schedule=True`)이거나 active mode면 즉시 응답 (delay는 영업시간 전용 fallback)
- 영업시간 + delay OFF + not active → 차단 (기존 동작 유지)
- worker `_from_worker=True` 호출: 시간 게이트 우회 (1분 후 영업시간이어도 정상 응답 발송) — `if not _from_worker and not suggest_only` 블록 안에서만 차단·enqueue 처리

**적용**: 서버 직접 패치 + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF퍼지 불필요. 라이브 검증은 새 inbound 메시지(영업시간 + 직원 미응답) 자연 작동 관찰 또는 `pending_ai_replies` row 추적.

**정책 요약**:
- 야간(스케줄 윈도우 안): 즉시 AI 응답 (delay 무시 — 직원 부재 default라 fallback 의미 없음)
- 영업시간(윈도우 밖) + delay ON: 1분 후 직원 미응답 시 AI fallback
- 영업시간 + delay OFF: AI 안 함 (직원 100% 응대)
- active mode (AI가 한 번 답한 thread + 직원 outbound 없음): 시간 무관 즉시 (대화 흐름 보존)

### 서버 — 네이버 예약 블록시간(dur) = 시술합 자동 동기화 (2026-05-23, React 변경 0)
**증상** (Tagnipez #1244388060): 브라질리언(45)+케어(10)=55분 매칭인데 블록 dur=80분으로 어긋남. 다수 네이버 예약이 block_dur ≠ svc_dur_sum (55·60·80·105 제각각).
**원인**: 신규 네이버 예약은 `ai_analyze_reservation`이 처음부터 `dur=max(시술합,30)`으로 맞춤(정상). 문제는 **분석 후 시술/시술시간이 바뀐 기존 건** — `_should_analyze` 게이트(selected_services 있으면 재분석 skip, 비용 절감 5/15 도입)가 재분석을 막아 dur이 stale로 남음. `dur`이 `BLISS_PRESERVE_FIELDS`라 스크랩 INSERT 하드코딩값(45)도 안 덮고 시술합 재계산도 안 됨. +5/+15 패턴은 시술 duration이 나중에 수정됐는데 기존 예약 dur은 옛 값 유지된 흔적.
**fix** (`bliss_naver.py` `db_upsert`, 백업 `bak_pre_dursync_20260523_120510`):
- row SELECT 2곳에 `selected_services,dur` 추가
- UPDATE 경로의 `update` 빌드 후 dur 재동기화 블록 추가 — `schedule_log`(수동 시간조정 흔적) 없고, 기존 `selected_services` 시술합 > 0 이고, 현재 dur ≠ `max(시술합,30)`이면 → `update["dur"]` + `update["end_time"]`(시작시각+dur) 세팅. 시술 dur 맵은 `_load_ai_settings()` 캐시 재사용 → **AI 재호출 0, 비용 0**.
- 네이버 예약이 스크랩/변경될 때마다 dur이 현재 시술합으로 자동 sync. `db_upsert`에 `re` 최상위 import 없어 블록 내 `import re as _re_dur` 로컬 import 사용.
**정책** (유저 결정): 최소 블록 30분 유지(`max(svc_sum,30)`), schedule_log 수동조정 흔적은 보존.
**소급** (유저 결정 — 오늘 이후만): 일회성 스크립트로 오늘+ 네이버 예약 dur≠시술합 4건 즉시 교정 — #1244388060 80→55(19:00–19:55), #1241696048 60→55, #1243404984 120→105, #1243690997 90→85. 재감사 결과 잔여 불일치 0건. 과거 예약은 미적용(유저 결정).
**적용**: 서버 직접 (scp + `py_compile` + `systemctl restart bliss-naver`, 전 스레드 정상 기동 확인). React 변경 0 → 버전업·CF퍼지 불필요.
**유의**:
- 재동기화는 **스크랩/변경 시점에만** 발화 (`db_upsert` UPDATE 경로). reserved 미래 예약이 재스크랩 안 되면 즉시 반영 안 됨 — 그래서 기존 backlog은 backfill로 처리. 신규·변경 건은 자동.
- 클라이언트(앱)에서 직원이 시술 수동 편집 시 dur 재계산은 별도(React) — 다만 다음 네이버 스크랩 때 서버가 sync하므로 5~30분 내 보정됨.
- `_load_ai_settings` services는 "N회"(다회권/보유권) 제외 — dur 합산에서 보유권은 0 기여(정상).

### 서버 — AI 지연응답: 직원 응대중 thread에서 "답변 필요 여부" 판정 게이트 (2026-05-23, React 변경 0)
**증상** (cece WhatsApp 33783699257): 고객이 몸이 안 좋아 예약 연기 요청 → 직원이 수동 응대("일정 확정되면 연락주세요, 건강 기도할게요") → 고객 "Okay I will! Thank you so much!"(단순 인사) → **AI 지연응답이 끼어들어** 잔존 `request` 예약(16:30 홍대 눈썹+윗입술)을 "오늘 4:30 뵙길 기대"라고 확정조로 발송. 직원이 "방금 건 챗봇 오입력" 정정.
**원인**: `pending_ai_replies_worker`의 직원 응대 감지가 **트리거 메시지 이후(`created_at > trigger`)의 직원 outbound만** 검사. 직원이 트리거 직전에 마무리 멘트를 했고 고객 "Okay"는 그에 대한 인사인데, 그 이후 직원 outbound가 없어 `canceled_by_staff`에 안 걸리고 AI fallback 발화. AI는 잔존 request 예약을 활성으로 보고 확정.
**fix** (`bliss_naver.py`, 백업 `bak_pre_needsreply_20260523_123745`):
- `_msg_needs_reply(text, prev_context)` 헬퍼 신규 — 고객 메시지가 '업체 답변 필요(질문/예약요청)'인지 '답변 불필요(인사·마무리·동의·감사)'인지 Gemini 2.5 Flash(무료)로 판정. 질문 신호 휴리스틱 + Gemini. 실패/불확실 시 False(미발송 — 어차피 직원 응대중이라 안전).
- worker step 2.5 추가 — **직원(비-AI)이 최근 30분 내 outbound 있는(=수동 응대중) thread**면, 고객 마지막 메시지를 `_msg_needs_reply`로 판정. 답변 불필요면 `canceled_by_staff`로 마킹 + 미발송. 질문/예약요청이면 평소대로 AI 발화.
- 유저 결정: 전면 억제가 아니라 "직원이 응대 중일 때 메시지가 답변 필요한지 분석 후 필요할 때만 답". 프롬프트(예약 확정조 차단) 변경은 안 함 — 직원 응대중 게이트만으로 충분(유저 결정).
**검증**: standalone 6케이스 — "Okay I will! Thank you!"·"감사합니다 알겠어요"·"고맙습니다 :)" → NO(미발송), "네 5/25 3시로 변경해주세요"·"Can I book brazilian tomorrow 3pm?"·"주소가 어디에요?" → YES(발화). 전부 정답.
**적용**: 서버 직접 (scp + `py_compile` + `systemctl restart`, worker 정상 기동 확인). React 변경 0.
**유의**:
- 게이트는 delay 경로(worker)에만. active mode(AI 연속 응대 중 즉시 응답)는 직원 outbound 시 이미 reset되므로 별개. 직원 미관여 thread는 기존대로 AI가 인사 포함 전부 응대.
- 판정은 직원 outbound가 최근 30분 내일 때만 발동 — 직원이 오래전 답하고 빠진 thread는 평소처럼 AI fallback.
- status는 새 값 대신 기존 `canceled_by_staff` 재사용(CHECK 제약 위험 회피, 의미상 "사람 응대중") — 사유는 로그로 구분.
- cece 잔존 예약: 16:00·16:30 cancelled 2건 + 16:30 `request` 1건(ai_q1d68zept012) 잔존 — 고객이 연기 중이라 오늘 방문 안 함. 정리 여부는 직원 판단(미조치).

### v3.7.832 — 타임라인 연속 예약 블록 구분 (현아 id_r9e93t77fm) (2026-05-23)
**요청**: "타임라인에 고객 테두리 라인 있으면 좋겠어요. 지금은 2~3개 붙어있으면 한 사람처럼 보여요."
**fix** (유저 지시 — 테두리 대신 블록 사이 빈 공간): `TimelinePage.jsx` 예약 블록 height `Math.max(h-1,10)` → `Math.max(h-3,10)`. 블록 시작 위치(`top:y`=시작시각)는 그대로 두고 높이만 줄여 → 연속 예약 블록 아래에 ~3px gap 생김 → 시간축 정렬·드래그/리사이즈 계산 무영향. 테두리(border)는 미추가(색박스 무테두리 원칙 + 유저 지시).
**적용**: v3.7.832 라이브 배포(version.txt 검증 3.7.832, CF 퍼지 success). 로컬 dev server 컨펌 후 배포. 현아 요청 status=done + reply 처리.
**유의**: gap은 세로 연속(시간 연달은) 블록 사이에 생김 — 가로 동시간대(`_totalCols>1`)는 기존 left/width spacing 유지. gap 크기 조정 필요 시 `h-3`의 3 조정.

### 서버 — AI 고객 세션 기록 통합 (회원권·포인트·예약 단일 source of truth) (2026-05-23, React 변경 0)
**배경**: ① 회원권 잔여 문의에 AI가 "담당자 확인"으로 미룸(신하엘 사례). ② cece 사례처럼 취소된 예약을 AI가 "그날 뵙죠"로 재확인. 유저 지시: 흩어진 컨텍스트를 **하나의 세션 기록으로 취합**해 AI가 그 하나만 보고 답변·예약·변경·취소 모든 결정을 내리게 (실수 방지). AI는 이미 예약 생성/변경/취소(`cancel_booking`, action=book/cancel)를 다 수행 중 — 문제는 정보가 블록 4~5개로 흩어진 것.
**fix** (`ai_booking.py`, 백업 `ai_booking.py.bak_pre_session_20260523_142125`):
- **고객 프로필 조회 확장** (`customer_packages_block` → 종합 프로필): 보유권(만료·소진도 "(만료)/(소진)"으로 표시, 숨기지 않음) + **포인트 잔액**(earn−deduct/expire) + **예약 날짜별**(예정/취소 구분). 매칭되면 custId를 `chat_booking_state`에 저장 → 다음 턴부터 그 사람으로 고정.
- **전화 매칭 안전화**: phone/phone2 + 숫자형·하이픈형. 1명이면 바로 사용(유저 지시 "전화 일치 시 바로 답"). **여러 명이 같은 번호 공유** 시 대화에서 받은 이름으로 좁히고, 그래도 모호하면 공개 보류(남의 회원권 노출 방지 — `feedback_bliss_no_phone_matching` 반영).
- **단일 `[고객 세션 기록]` 통합**: 흩어진 5블록(registered_cust/cust_history/existing_bookings/프로필/state)을 하나의 헤더 아래로 묶고, 프롬프트에 "이 하나가 유일한 source of truth, 취소됨 예약은 활성 아님" 명시. 하위 섹션 헤더([기존 예약]/[현재 누적 정보])는 보존 → 기존 book/cancel 룰 참조 유지.
**검증** (suggest_only 6흐름): 신규예약 ✓ / 변경(기존예약 기반) ✓ / 예약확인(기록에서 정확) ✓ / 취소 ✓ / 회원권(유효·만료 정직) ✓ / 취소건 재확인 방지("활성 예약 없음") ✓.
**적용**: 서버 직접 (scp + py_compile + `systemctl restart`, 전 스레드 정상). React 변경 0 → 버전업·CF퍼지 불필요.
**유의**:
- 예약·변경·취소 **실행 로직 자체는 무변경** — 통합 블록은 AI가 "정확한 정보를 보고 결정"하게 하는 read 쪽. 실행(create_booking_from_ai/cancel_booking)은 그대로.
- 회원권/예약은 매 턴 DB live 조회(저장 스냅샷은 stale되므로) → 항상 최신. custId만 state에 저장.
- 같은 번호 공유 + 동명이인이면 회원권 공개 보류(담당자) — 안전 우선.

### 서버 — AI 예약 가용성: capacity 거절 제거, 네이버 예약막기만 거절 (2026-05-23, React 변경 0)
**증상** (Judylyn 인스타): "AI 답변 추천"이 11시를 "예약 어렵다"며 11:30을 제안 → 11시에 자리 있는데 왜 거절? + 제안한 11:30도 이상.
**원인**: `check_availability`가 **룸 수(`max(len(rooms),3)`=강남 3)로 동시 수용량을 잡고**, 요청 구간에 겹치는 예약 "건수"가 그 이상이면 거절. (1) 직원 이동/재배치로 실제론 더 받을 수 있는데 거절 (2) `naver_changed`(변경되어 사라진 예약)까지 카운트 (3) 겹치는 "건수"≠동시 예약수라 긴 시술서 과다 거절 (4) 대안 시간 탐색도 같은 버그. 실제 강남 내일 데이터: 11:30 한 칸이 **네이버 예약막기**였고, 이 예약이 5개 시술 ~115분이라 11:30을 지나가서 거절된 것 — capacity가 아니라 막기 문제.
**fix** (유저 원칙 — `feedback_bliss_no_capacity_reject`): 자리 꽉 참으로 **거절 안 함**. 받아서 확정대기(request, 자동예약 status 이미 request)로 넣고 직원이 판단. **거절은 오직 네이버 예약막기 — 시술 구간 `[start, start+dur)`이 막힌 30분 슬롯과 하나라도 겹치면 거절** (유저 확정 2026-05-23: 막힌 시간을 지나가야 하면 거절).
- `_branch_blocked_bits(branch_id, date)` 신규 — branch `naver_biz_id` → `bliss_naver.naver_block_state`(lazy import, 순환·스레드 무해) → 48비트(30분, '0'=막힘) 통합. 120초 캐시.
- `check_availability`: 시술 구간이 막힌 슬롯과 겹치면 거절 + 시술 '전체'가 안 막히는 가장 가까운 시작 제안, 안 겹치면 받음. 막기정보 없음/조회실패 시 fail-open(받음).
**검증** (강남 내일 실데이터, 11:30만 막힘): 11:00 dur115 → 거절·대안 12:00 ✓ / 11:00 dur25 → 받음(11:25 종료) ✓ / 11:30 → 거절·대안 12:00 ✓ / 12:00·09:30 dur115 → 받음 ✓.
**적용**: 서버 직접 (백업 `ai_booking.py.bak_pre_avail_20260523_145452` → 윈도우 기준 재배포 `bak_pre_winblock_20260523_145834`) + restart. React 변경 0.
**유의**: 거절 기준 = 시술 구간이 막힌 슬롯과 겹침(start만이 아니라 dur 전체 윈도우). naver_block_state는 네이버 partner API 호출(시술 item별) → 120초 캐시로 완화, 세션 만료 시 fail-open.

### v3.7.833 — 색상 선택 칸 전부 자체 컬러피커(ColorField)로 통일 (2026-05-23)
**배경**: iOS 네이티브 `<input type="color">`가 현재 색을 잘 안 보여주고(특히 격자 탭) 세밀 조정 불편 — 유저: "기존 선택된 색이 안 떠서 디테일 수정 불가". 색상 칸 전부 자체 선택기로 교체 요청.
**fix**: `src/components/common/ColorField.jsx` 신규 — 현재색 큰 미리보기 + **hex 직접 입력** + **색조 슬라이더 + 채도/명도(SV) 박스**(디테일) + 자주 쓰는 색 팔레트(16). 터치(pointer) 드래그 지원, `createPortal`(모달 안에서도 안 잘림). hex 정규화(#abc→#aabbcc, 알파 제거). 네이티브 피커 미사용.
- 교체 11곳/6파일: `TimelineSettings`(매출강조색·예약상태색 ×2) · `AdminServiceTags`(태그색, 중복 텍스트 입력 제거) · `AdminSaleItems`(배지 글자/배경 ×2 + 일괄 ×2) · `TagSettings` · `BranchSettings` · `EditCellModal`(근무표 셀 태그색). 핸들러 `e=>...e.target.value` → `c=>...c`로.
**적용**: v3.7.833 라이브 배포(version.txt 검증 3.7.833, CF 퍼지 success). 로컬 dev server 후 배포. 로그인 필요 화면이라 직접 캡처검증은 못 함(빌드 통과).
**유의**: 색 변환(hex/rgb/hsv) + SV박스/색조 드래그는 표준 구현, 외부 라이브러리 0. swatchStyle prop으로 각 위치 크기 맞춤. EyeDrop(스포이드)은 기존대로 별도 유지.

### v3.7.834 — 타임라인 지점 네비게이션(키보드·휠·터치) + 블록갭 2px + 디폴트값 (2026-05-23)
**타임라인 지점 이동** (`TimelinePage.jsx` — scrollRef 컨테이너):
- 공통 헬퍼 `_computeNavStops(sr)`: 정지 지점 = 각 지점 첫 컬럼 시작(offsetLeft − timeLabelsW) + **지점이 화면(clientWidth−timeLabelsW)보다 넓으면 그 지점 끝까지 보는 위치(rightEdge−clientWidth) 추가**. `_navStep(sr, forward)` = 다음/이전 정지점으로 smooth scroll + `navLockRef` 550ms(자석 스냅 충돌 방지).
- **키보드**: ←/→ `_navStep`, ↑/↓ 한 화면씩(`clientHeight−headerH`). 입력칸 포커스·드래그·숨김 시 무시.
- **마우스 휠**: 가로(deltaX 우세 또는 Shift+휠) → `_navStep` 1지점/제스처(380ms 쿨다운). 세로는 네이티브.
- **터치(모바일)**: 가로 스와이프(>40px) → `_navStep`. axis 판정 후 가로만 preventDefault(세로 스크롤·블록 탭/드래그 보존). 블록 위(`.tl-block`)·드래그 중 제외.
- **멈춤 자석 스냅**(스크롤바 등): 멈추면 가까운 정지점에 스냅(경계 ~110px 이내만, navLock·세로무시 가드).
- 블록 갭 `Math.max(h-3,10)` → `Math.max(h-2,10)` (연속 예약 구분).
- **타임라인 디폴트값 갱신**(`tlDef` 폴백 + `STATUS_CLR_DEFAULT`): 현재 운영값으로 — sh 8→10, rh 14→10, cw 160→100, fs 13→12, op 50→80 (eh 23·tu 5 동일). 상태색상 디폴트 = 예약중 `#d0d4ed`·진행 `#4a7cc8`·완료 `#6ab56a`·취소 `#e8b830`·노쇼 `#ef5350`(저장된 공통설정값). 매출강조(hl)는 매장별이라 제외.
**적용**: v3.7.834 라이브 배포(version.txt 검증, CF 퍼지 success). 직원 공지(`bliss_notices_v1` 맨 앞) "🖐️ 타임라인 지점 빨리 넘기기" 게시 — 스와이프·방향키·휠 + 블록갭 + AI 회원권/취소 안내, 쉬운 말로.
**유의**: 디폴트는 저장된 설정 없는 기기에만 적용(기존 기기는 localStorage/공통설정 우선). 정지점은 키보드·휠·터치 공통. 넓은 지점은 끝까지 본 뒤 다음 지점.

### v3.7.835 — 막기 헤더 키움 + 분 가로선 제거 + 직원 이름 변경(전 기록 이전) (2026-05-23)
- **B. 막기 컬럼 헤더**: N 아이콘 SVG 14→18px (`TimelinePage.jsx`, isBlockCol 헤더).
- **C. 타임라인 가로선**: `gridBg`에서 30분(`#f0f0f0`)·슬롯(`#f5f5f5`) 선 제거, **정시선(`#e8e8e8`)만** 유지.
- **D. 직원 이름 변경** (`EmpSettingsModal.jsx` + `SchedulePage.jsx`): 직원 id=이름이라 이름 변경 = 모든 기록 이전. 직원별 근무 설정 카드에 "✎ 이름" 버튼 → 새이름 입력 → 확인창(예약 N·매출 M건) → `onRenameEmp` 마이그레이션:
  - `employees_v1`(id+name), `schHistory_v1`(월별 이름키), `empSettings_v1`, `maleRotation_v1`, `empWorkHours_v1`(이름_지점_날짜 prefix), `reservations.staff_id`, `sales.staff_name` 전부 old→new 일괄. supabase 클라이언트로 처리, 완료 후 reload.
- **A(공지·요청 뱃지)는 유저 보류.**
**적용**: v3.7.835 라이브 배포(version.txt 검증, CF 퍼지 success).
**유의**:
- 직원 id=이름은 레거시. 이름 변경은 위 우회 마이그레이션. 고유 ID 도입 리팩토링은 **유저 결정으로 보류**(나중에 별도 — 모든 참조 이름→ID 전환 필요, 대규모).
- 이름 변경은 라이브 DB 직접 수정(로컬 dev도 같은 DB). 동명이인 새 이름은 차단.

### v3.7.836 — 모바일 가로 스와이프 빠른 동작 fix (touch-action pan-y) (2026-05-23)
**증상**: 모바일 가로 스와이프 — 느리면 지점 이동 걸리는데 **빠르면 안 걸림**.
**원인**: 빠른 플릭 시 브라우저가 가로 네이티브 스크롤을 먼저 시작 → 단계이동 핸들러의 preventDefault가 한발 늦어 무효 → 멀리 날아가 멈춤-자석스냅(경계 ~110px) 도 못 잡음.
**fix** (`TimelinePage.jsx` scrollRef 컨테이너): `touchAction:"pan-y"` 추가 → 가로 네이티브 스크롤 자체 차단 → 빈 영역 가로 스와이프는 속도 무관 항상 터치 단계이동 핸들러로 진입. 세로 스크롤 유지.
**적용**: v3.7.836 라이브 배포(version.txt 검증, CF 퍼지 success).
**유의(미해결)**: **예약 블록 위에서 시작한 스와이프**는 아직 단계이동 안 됨 — 블록 touchstart가 `stopPropagation`(line 2785, 롱프레스 드래그용) + 블록 `touchAction:"pan-x pan-y"`라 가로 네이티브 스크롤 허용. 블록 위 스와이프까지 잡으려면 캡처단계 감지 + 블록 touch-action을 pan-y로 변경 필요(드래그/탭 회귀 위험으로 보류). 빈 영역(미배정·블록 사이·헤더) 스와이프는 정상.

### 서버 — AI 예약 확정 멘트 톤 변경 (대기 → 확정) (2026-05-23, React 변경 0)
**요청**: AI 예약 등록 후 "예약 접수완료, 직원이 곧 확인" → 손님이 "확정된 거 맞나요?" 불안. **"예약 완료됐습니다, 변동사항 생기면 직원이 다시 연락"** 톤으로. 전 채널(인스타·카톡 등) 공통.
**fix** (`ai_booking.py` 프롬프트 4곳 + 하드코딩 fallback 1곳, 백업 `bak_pre_confirmtone_20260523_193757`): "예약 접수완료! 담당자 확인 후 확정 안내" / "Booking received! confirm shortly" → **"예약 완료됐습니다! 혹시 변동사항이 생기면 담당 직원이 다시 연락드릴게요" / "Your booking is confirmed! If anything changes, our staff will reach out."** line 2102의 "절대 예약 확정이라고 하지 않기" 규칙 제거.
**유의**: 예약 status는 그대로 `request`(확정대기 — 직원이 타임라인서 봄). **고객 메시지만** 확정 톤으로(안심). action≠book일 때 확정표현 금지 규칙은 유지. 검증: KR/EN 예약 시뮬 → "예약 완료됐습니다 ... 변동사항 생기면 연락" 정상.
**적용**: 서버 직접 (scp + `systemctl restart`). React 변경 0 → 버전업·CF퍼지 불필요.

### 🚨 Supabase DB 과부하 장애 + 폴링 다이어트 (2026-05-23, v3.7.837)
**장애**: 저녁 피크(KST 19시대) Supabase Postgres가 과부하로 hang — 모든 쿼리 statement timeout, 관리자 연결도 timeout, 앱 전체 다운. compute는 Small. **스스로 회복**(쿼리 멈춤 풀림). 재시작 불필요였음.
**진단** (Supabase 로그 직접 확인):
- postgres 로그: `canceling statement due to statement timeout` 다수.
- realtime 로그: **`connection pool cannot serve them fast enough` / `IncreaseSubscriptionConnectionPool: Too many database timeouts` / `UnableToConnectToTenantDatabase`** → **DB 연결 풀 고갈**. Realtime이 연결 못 얻음 → 클라 재연결 → 더 많은 연결 → 죽음의 소용돌이.
- pg_stat_statements(12분 창): Realtime WAL/sub_tables = 분당 ~280회(38%), `reservations.*` 전체조회 분당 35회, schedule_data 분당 122, messages 64. **앱이 연결을 과도하게 요구하는 구조**가 근본 (정상 사용으로 안 터짐 — 유저 지적 정확).
**근본 원인**: ① 폴링 인터벌 20개+ 중 다수가 5~30초 + Realtime과 중복 ② Realtime 채널 기기당 8~10개 ③ `reservations.*` 전체 컬럼 30일치 반복 fetch. 기기 수 × 이 모든 게 피크에 연결 풀 초과.
**Phase 1 fix (이번 배포)**: Realtime 백업 있는 폴링 전부 **120초+**로 — AppShell(staff_req·입금×2·미읽·요청·예약 fallback·data reload), MessagesPage(미읽카운트 10s→120s, AI배지 5s→30s), TimelinePage(미읽 500건 10s→120s·extraCols·naverColShifts), useTeamChat 30s→120s, BankDeposits 30s→120s. DB 아닌 폴링(알람체크·버전reload)은 유지.
**남은 Phase**: ② Realtime 채널 통합(8~10개→소수), ③ `reservations.*` → 필요 컬럼만. **선제 모니터링**(매일 Supabase 사용량 체크+TG 알림) + **서버 이원화(failover)** 별도 트랙.
**메모**: `feedback_supabase_load_diet` + `project_supabase_compute` 갱신.

#### 같은 배포에 함께 (v3.7.837)
- **모바일 swipe**: v3.7.836 `touch-action:pan-y`가 빈영역 외에서 "안 움직임" 유발 → pan-y·터치 단계이동 제거, **네이티브 스크롤 + 멈추면 가까운 지점 항상 스냅**(거리제한 제거)로 변경.
- **SaleForm 제품쿠폰 fix** (현아 버그): 새 다담권 즉시차감 상한(`svcAfterAllDiscounts`)에 `evtCouponDiscountOnProd` 누락 → 제품전용 쿠폰 80,000이 제품 아닌 다담권에 붙던 것 → `- evtCouponDiscountOnProd` 추가.

### v3.7.862 → v3.7.864 — 매출상세 2단·패키지 미사용 검토·로그인 개편·계정 인증(가입/아이디·비번찾기) (2026-05-25~26)

#### v3.7.862 — 고객 상세 예약내역 → 예약모달 센터+빨강반짝
- CustomersPage 고객 상세에 "예약 내역" 탭(매출 내역 옆). 예약 행 클릭 → 타임라인 예약모달 오픈.
- TimelinePage pendingOpenRes: 모달 케이스도 `_highlightOnly`와 동일한 정밀 센터 스크롤 + 빨강 테두리 반짝(`blissHlBlink`). 모달 진입 fetch 버그(`rows[0]` 배열 처리) 수정.

#### v3.7.863 — 매출상세 2단 + 패키지 미사용 검토 + 로그인 개편
- **SalesPage 매출 상세 2단**: 상단 결제수단 요약 유지, 그 아래 좌(시술/제품 표)·우(메모) 2컬럼 flex. 🏷 관리내역(태그) 블록 제거(유저 요청).
- **신규 페이지 `AdminPkgUnusedReview.jsx`** "패키지 당일 미사용 검토" — 관리설정 아님, **사이드바 "공지&요청" 아래** 독립 메뉴(`pkgunused`, /pkg-unused, isMaster). nav(AppShell)+Sidebar 시스템 카테고리+PAGE_ROUTES 등록.
  - 로직: `package_transactions` charge(앱 기록 구매) 중 **구매 당일 차감 없는 건**. 제외조건 = 연간권 / 같은날 deduct(날짜+sale_id) / 삭제된 패키지(orphan, pmap에 없음) / 같은 패키지 2개이상 보유 / 구매매출에 실제 시술 라인 있음(브라질리언 등). **`sb.getAll` 페이지네이션 필수**(PostgREST 1000행 캡으로 최신 차감 누락 버그 fix). 현재 ~11건.
  - 지점필터 + 검색 + 고객정보↗ 버튼(setPendingOpenCust→customers) + **확인완료 버튼**(schedule_data `pkg_unused_reviewed_v1`에 package_id 배열 저장, 기본 숨김, 토글 표시).
- **SaleForm 저장 경고**: 신규 등록에서 패키지/선불권 구매했는데 당일 사용(차감) 0이면 confirm. 판정 = `newPkgInstantDeduct>0`(선불권) 또는 `usePkgToday[svc.id]>0`(다회권) 둘 다 없을 때. editMode 제외.
- **로그인 화면 개편**(AppShell Login): `/landing.html` iframe 흐린 배경(blur9px)+그라데이션 오버레이 / PG footer(정책·사업자정보) 제거(메인에 있음) / 닫기(×)버튼→`/` / 카카오·구글 이모지→SVG(msgSq + 공식 Google G).

#### 서버 — AI 콜라보 게이트 매장발신 마무리 멘트 (React 변경 0)
- `ai_booking.py`: 매장이 먼저 협업 제안한 대화(_outbound_collab)가 기존 "AI 침묵"이었는데 → **마케팅 담당자 안내 마무리 멘트 발송**(예약 안 잡음). 한/영 분기. 인플루언서 콜라보 대화방은 AI가 예약 절대 안 잡고 "담당자 출근 후 연락" 안내. 백업 `bak_pre_collab_outbound`.

#### v3.7.864 — 계정 인증: 회원가입 재설계 + 아이디/비밀번호 찾기
- **DB**(migration `accounts_phone_and_reset`): `accounts.phone` 추가. `account_signup(p_login_id,p_password,p_name,p_email,p_phone)` — phone 정규화 저장(하위호환). `admin_reset_password(login_id,new_password)` bcrypt 재설정 RPC(anon/authenticated REVOKE — service_role 전용). auth는 `crypt(pw, password_hash)` 검증(bcrypt).
- **서버 엔드포인트 5개**(bliss_naver.py, 백업 `bak_pre_acctauth`): `/account-verify-send`(SMS 6자리, `_cust_verify_codes`에 `acct:`prefix 재사용, NPRO send-sms), `/account-verify-check`, `/account-find-id`(phone+code→login_id, name 추가필터), `/account-reset-sms`(인증후 admin_reset_password 호출, 멀티계정 시 login_id 요구), `/account-reset-email`(임시비번 생성→admin_reset_password→Gmail SMTP 발송, 계정/이메일 없으면 sent:false로 노출최소화). 헬퍼 `_acct_resp`/`_acct_verify_code` 모듈레벨 추가.
  - **nginx**: location regex에 5개 경로 추가(백업 `/home/ubuntu/bliss_nginx.bak_acctauth_*`, sites-enabled 밖).
- **SignupWizard 재설계**(참고: 공비서 화면): 아이디·비번+확인(영문+숫자 8~20)·이름·이메일(필수)·휴대폰 인증(전송→코드→확인)·약관(전체동의+이용약관/개인정보 필수+마케팅 선택). 인증완료+필수약관 동의 시 가입버튼 활성.
- **AuthHelpModal**(로그인 "아이디 찾기·비밀번호 찾기" 링크): 아이디찾기=이름+휴대폰인증→login_id 표시+자동채움. 비번찾기 2탭=이메일(임시비번 발송)/휴대폰(인증→새비번). `acctApi('account-*')` 헬퍼 + `_normPhone`/`_fmtPhone`.
- **검증**: account_signup(email+phone)·admin_reset_password·엔드포인트 라우팅(phone_format/missing_fields/sent:false)·기존 demo 로그인 무결성 — 전부 PASS. ⚠️ **실 SMS/실메일 end-to-end 미테스트**(실문자·실메일 발송+실계정 비번변경 우려) — 정우님 본인 번호/메일로 1회 확인 권장.

#### 주의사항 (v3.7.864 이후)
- **신규 가입 비번 규칙 = 영문+숫자 8~20자** (기존 계정·demo는 무관, 기존 로그인 안 깨짐).
- **계정 비번 = `accounts.password_hash`(bcrypt)** — 재설정은 `admin_reset_password` RPC(service_role)만. 구 UsersPage는 `app_users.password`(레거시) 기록이라 계정 로그인과 별개(추후 정리 대상).
- **기존 계정 자가 재설정**: 이메일 5/20·전화 0이라 기존 계정은 메일/전화 등록된 것만 가능, 나머지는 본사 문의 폴백. 신규 가입자는 둘 다 받아 전부 가능.
- **계정 SMS 인증** = NPRO(강남 발신번호 br_4bcauqvrb) 재사용, 건당 SMS 비용. 코드 10분 만료 메모리 캐시(`acct:`+phone).

### AI 자동예약 — 날짜·시술매칭 다중 버그 수정 (2026-05-26, 서버, React 변경 0)
**발단**: Christina(WhatsApp) 대화 — AI가 "next tuesday"를 5/27(수)로 잘못 잡고, 시술도 엉뚱하게 등록(턱), 고객 날짜확인 질문에 엉뚱 응답.

**원인·수정 (`ai_booking.py`, 백업 `bak_pre_{nextweekday,svcmatch,safetyC}_*`)**:
1. **상대 요일** — "this/next/이번주/다음주 ○요일" 전부 **가장 가까운 미래 그 요일**로 매핑(+7일 금지). 외국 손님 'next Tuesday'=다가오는 화요일 관행. (요일↔날짜 모순은 기존 14일 캘린더 표가 차단)
2. **날짜확인 질문** — 기존 예약 블록에 **요일+오늘/내일/N일뒤 라벨** 자동 주입 + "오늘이냐 내일이냐?"류 질문 → 날짜+요일 명확히 답하라는 규칙 추가("confirmed for 11:00"식 날짜 누락 금지).
3. **시술 매칭을 견고한 AI추출기(`bliss_naver._ai_extract_booking_info`, Gemini)로 통일** — 브리틀 키워드 테이블(`SVC_ENG_TO_KOR`) 대체. 키워드 폴백도 보강(`upper lip→인중`, `half/full arm→팔 절반/전체`, 한국어 키워드에 `인중·팔`). lazy import로 순환 회피.
4. **안전망 C** — AI 예약 시술매칭 0건이면 `schedule_log`에 "⚠ 시술 자동인식 실패 — 직원 확인" 경고. AI 예약은 `request`(확정대기)라 직원이 검토.

**`bliss_naver.py` `_ai_extract_booking_info` 견고화 (백업 `bak_pre_gptfallback_*`)**: Gemini가 깨진 JSON(Unterminated string) 반환 시 → ① 제어문자 제거 재시도 ② **GPT(gpt-4.1-mini) 교차 재추출** → 둘 다 실패면 graceful 빈값. 카카오/폼 예약도 같이 견고해짐.

**모델 리서치+실데이터 10건 테스트 결론 (중요)**: 더 싼 모델 교체 검토했으나 **기각**. 실측 — **Gemini 3.5 Flash(현행)=9/10 최고**, Gemini 2.5 Flash-Lite=~5/10(half→전체 오류, JSON 깨짐, 스키마도 못 막음), GPT-4.1-nano=4/10(바우처·다담권 오매칭 위험). 폴백 비교 — **gpt-4.1-mini=8/8 최적**, gemini-3-flash=API 404(불가), claude-haiku-4.5=다부위 legs 누락. → **결론: Gemini 3.5 Flash 1차 + gpt-4.1-mini 폴백 = 현 구성이 최적, 교체 안 함.**

**유의**: 서버 `ai_booking.py`/`bliss_naver.py`는 bliss-app git 미추적(별도 `/home/ubuntu/naver-sync/`). ssh+scp+`systemctl restart bliss-naver`로 적용. React 변경 0 → 버전업·CF퍼지 불필요.

### v3.7.865 — 총매출 포인트 제외(정책일 컷오프) + 포인트 유효기간 출처별 (2026-05-26)

#### Phase A — 총매출에서 포인트 제외 (정책일 `2026-05-26`부터, 과거 불변)
**배경**: "포인트는 돈 안 받은 것이니 총매출에서 빼라. 단 그동안 건 그대로, 앞으로만." 결제수단으로 포인트 사용은 그대로 허용(svc_point 기록 OK), 총매출 집계에서만 제외.
- **중요 사실**: `sales.svc_point`는 2025-09-11 이후 0건 — 현재 "포인트 사용"은 `point_transactions`(deduct)로만 기록되고 sales엔 차감 후 금액만 들어가 **이미 총매출에서 빠져 있음**. svc_point 경로(결제수단 포인트)는 미사용. 그래서 이 변경은 **미래에 포인트를 결제수단으로 쓸 경우 대비 + 정책 명문화**.
- **컷오프 방식**: 매출 `date >= '2026-05-26'`이면 총매출/시술/제품에서 `svc_point+prod_point` 제외. 이전은 포함(과거 연·월 총매출 숫자 불변). 포인트는 '포인트' 열에 항상 표시.
- **클라이언트** `SalesPage.jsx`: 모듈 상수 `POINT_EXCL_FROM='2026-05-26'` + `exclPt(sale,v)` 헬퍼. 마감정산 rowTot / 매출리스트 footer / 일별그룹 / 개별행 / 통계차트(일·연) 6곳 적용. `SalesGridPage.jsx` amt도 동일.
- **서버 RPC**(migration `sales_total_exclude_point_from_20260526`): `get_sales_stats_summary`·`get_sales_summary`·`get_sales_by_branch`·`get_sales_monthly`·`get_sales_yearly`의 total/svc/prod에 `CASE WHEN date::date >= DATE '2026-05-26' THEN 0 ELSE svc_point END`. svc_point/prod_point 필드는 표시용 전액 반환. external_prepaid는 실수금이라 항상 포함.
- 통계 요약 카드(시술·제품·총매출)는 RPC `t` 기반이라 RPC만으로 자동 반영.

#### Phase B — 포인트 유효기간 출처별 (선불권 적립 → 권 유효기간 따라감)
**원칙**: 선불권(다담·바프·다회·연간) 구매 이벤트로 **추가 적립된 포인트**는 그 선불권의 유효기간을 따라감. 선불권 미사용=유효기간 없음(null=무기한) → 첫 사용으로 유효 찍히면 연결 포인트도 그 날짜로 전파. 일반 적립(신규고객 10% 등)은 현행(발행+개월). **비례 분배 아님** — 각 선불권 구간 이벤트가 정해진 고정 적립액(30k/50k/70k/100k/300k/500k)을 줌, 그 권에 직접 연결.
- **DB**(migration `point_transactions_add_source_package_id`): `point_transactions.source_package_id` + 부분 인덱스.
- **`eventEngine.js`**: `applyEvents` 결과에 `pointEarnByEvent: [{eventId,trigger,earn}]` 추가(이벤트별 적립액).
- **`SaleForm.jsx`**: 선불권 생성 루프(다담/다회/연간)에서 `_earnLinkPkgs=[{id,faceVal,expISO}]` 수집(expISO=구매 즉시 사용 시 유효일, 미사용이면 null). 적립 write 재작성 — 선불권 트리거(`prepaid/pkg/annual_purchase`) 적립은 권별 연결(`source_package_id`+`expires_at`=권 유효일/null), 나머지는 현행. 다중 권은 면가 내림차순↔적립액 내림차순 페어링. 수동 수정(`pointEarnManualRef`) 시 연결 안 함(현행).
- **첫 사용 전파**: `_firstUsePkgIds` 소비부에서, 선불권 첫 사용 시 `point_transactions`(`source_package_id`=권, `expires_at IS NULL`)의 expires_at을 첫사용+1년-1일로 UPDATE.
- **소급(백필) 생략**: 기존 적립 630건(2026-04-17~)은 선불권 링크 정보 없음(customer_packages에 sale_id 없음) → 추정 매칭 위험 + 1개월치라 **포워드만** 적용(유저 승인). 기존 포인트는 현 만료일 유지.

**유의**:
- 총매출 포인트 제외는 **정책일 컷오프** — 과거 데이터 절대 안 바뀜. 정책일 변경은 `POINT_EXCL_FROM`(클라) + RPC의 `DATE '2026-05-26'`(5개 함수) 동시 수정.
- Phase B는 **앞으로 적립되는 선불권 포인트만** 권 유효기간 따라감. 다회권/연간권 구매 이벤트는 현재 point_earn 없이 할인·쿠폰만 줘서 실제 연결은 다담/바프 위주(코드는 다회·연간도 대비).
- 향후 선불권 상품 추가 시: 충전 구간 이벤트(point_earn fixed)만 등록하면 자동으로 권에 연결됨.

### v3.7.866 — 입금문자 매칭 후보 2건 fix (2026-05-26)
`BankDeposits.jsx` MatchModal 매칭 후보 누락:
- **예약 후보**: `isStarted`(예약 시작시각 ≤ 입금시각이면 제외)가 **같은 날 이미 시작/완료된 예약을 전부 제외** → 시술 후 계좌이체 결제 케이스(입금 12:38, 예약 12:10 completed)에서 예약이 안 떴음. → **과거 날짜 예약만 제외**(`r.date < depDate`)로 완화, 같은 날 예약은 시각 무관 표시.
- **고객 직접 매칭**: 동명이인 많을 때(예: "유민" 54명) `limit=20` **무정렬**이라 정작 입금 당사자(이름 정확 "유민")가 잘려 안 보였음. → `limit 80` 받아 **관련도 정렬**(이름정확5 > 전화/번호정확4 > 이름시작3 > 부분2 > 그외1) 후 상위 25명. 입금 당사자가 최상단 노출.

### 서버 — IG/네이버 AI 예약: 손님 명시 지점 우선 (계정 지점 오등록 fix) (2026-05-26, React 변경 0)
**증상**: 강남 IG 계정으로 온 ailemasousa222가 "용산점으로 예약해주세요" 요청 → AI 영어 답변은 "Yongsan"으로 맞게 했지만, 예약이 **강남점으로 먼저 등록**됨(`ai_s5l580gcfk44`) + "📍강남점" 한국어 카드 발송 → "실수로 자동발송" 사과 후 용산으로 재예약(`ai_odf9e92br8g2`) → 강남 카드 또 발송. 손님 혼란.
**원인**: `create_booking_from_ai` 지점 결정이 **1차 ACC_BRANCH(계정→지점)** 를 쓰고, booking.branch(LLM 추출) 재해석은 `not branch_id or whatsapp`일 때만 → IG는 계정 지점(강남)이 있어 손님 요청 지점(용산) 무시.
**fix** (`ai_booking.py`, 백업 `bak_pre_igbranch_*`): 지점 결정에 **1.5차** 추가 — 손님이 대화에서 명시한 지점(`booking.branch`)이 유효하고 계정 지점과 다르면 **그 지점 우선**(`_match_branch_by_name`로 검증). 명시 없으면 기존대로 계정 지점. 검증: "Yongsan/용산/our Yongsan branch"→용산, "Gangnam/강남"→강남 정상.
**효과**: IG/네이버 계정이 특정 지점이어도 손님이 다른 지점 요청 시 처음부터 정확히 예약 → 강남 오등록·재예약 churn·카드 오표기 재발 안 함. 카드 `_bname`은 예약 bid 기준이라 자동 정상화. ailemasousa222 현재 예약은 이미 용산(정상) — 데이터 수정 불필요.

### 서버 — IG 발신 메시지 is_ai(AI/직원 말머리) 누락 fix (2026-05-26, React 변경 0)
**증상**: AI 자동응답·예약확정 카드가 인박스에서 'AI' 말머리로 안 보임(직원처럼 보임). DB상 `messages.is_ai=false`인데 실제 AI/시스템 발신.
**원인**: IG는 Meta가 발신을 echo로 돌려줄 때 `send_queue`와 매칭해 is_ai/직원정보를 가져옴. 1차 exact `message_text` 매칭 + 폴백의 `len(echo)==len(send_queue)` 체크가 **이모지·URL·줄바꿈 인코딩 차이**로 실패 → is_ai/staff 통째 누락(false). (send_queue는 is_ai=true 정상, echo 매칭만 실패). 네이버·WA·LINE은 send_queue row에서 직접 INSERT라 무관.
**fix** (`bliss_naver.py`, 백업 `bak_pre_igaiflag_*`): IG echo 폴백을 **최근 120초 sent 중 '접두어 20자 일치' 우선, 없으면 최신건**으로 견고화(길이 동일 체크 제거, limit 5). is_ai/sent_by_staff 안정 전파.
**데이터 정정**: ailemasousa222 대화 2026-05-26 발신 6건(직원 null·AI 확정) `is_ai=true` 백필.
**유의**: 과거 전체 is_ai=false 메시지의 전역 백필은 안 함 — 과거 staff/AI 구분이 불확실(staff도 is_ai=false)해 오라벨 위험. 포워드 fix로 신규는 정상. 필요 시 send_queue(is_ai=true) 재매칭 백필 별도 검토.

### 서버 — 기존 고객한테 신규차트 가던 문제 fix (예약 등록 시 is_new_cust 판단 정확화) (2026-05-26, React 변경 0)
**증상**: 신규=신규차트(ct_consent_full_ko_v2), 기존=컨디션차트(ct_condition_v2)만 가야 하는데 **기존 고객한테 신규차트** 발송.
**원인**: `_pick_chart_tpls` 로직은 정상. 예약의 `is_new_cust`가 기존 고객인데 true로 찍힘 → AI가 기존 고객을 못 알아보고 **새 고객 레코드(cust_ai_*) 생성**(매칭 실패). 예) Park yuka(#54869, 01059654529)인데 AI가 "Yuka"로만 받아 새 레코드 → `_cust_created=true`라 is_new_cust=true → 신규차트.
**설계 원칙**(유저 지적): 신규/기존 판단은 **예약 등록 시 한 번(`is_new_cust`)** 만 하고 태그·차트 모두 그걸 사용. 차트가 따로 또 판단하면 안 됨.
**fix** (`ai_booking.py` `create_booking_from_ai`, 백업 `bak_pre_isnewphone_*`): is_new_cust 판단에 **전화 기반 보정** 추가 — `_cust_created`거나 cust_id 매출 없어도, **같은 전화에 cust_num 보유 고객(=기존 등록)이 있으면 `is_new_cust=False`**. 이 한 번의 판단이 신규태그 + 차트선택 공통 기준. (차트 쪽 `_chart_is_new` 별도 안전장치는 만들었다가 **폐기**·되돌림 — 단일 판단 원칙.)
**미해결(근본·별도)**: AI 매칭 실패로 인한 **중복 고객 레코드** 자체는 남음(전화 일치하는데 이름 달라 매칭 실패). 매칭 개선(2026-05-16 find_cust_by_phone의 _name_mismatch 패턴을 AI 예약 고객생성에도 적용) + Yuka류 중복 병합은 별도 트랙. is_new_cust는 이제 전화로 보정되므로 차트·태그는 정상.
→ **(2026-05-26 후속 완료)** AI 예약 고객생성에 **전화 단독 매칭**(이름 달라도 1명이면 연결, cust_num 보유 1명 우선) 추가 + **기존 중복 8건 병합**(예약·sns·토큰·동의서 정식고객 재연결 후 삭제, 권후남/박현남=번호공유 다른사람은 제외). 아래 항목 참고.

### 서버 — AI 예약: ① 답변추천 자동예약 ② 회원번호(cust_num) 대화추출 매칭 (2026-05-26, React 변경 0)
**발단**: zerotokorea(인스타, 홍대, 회원 #52059) — 직원이 "AI 답변 추천"을 눌러 "Perfect! confirmed" 멘트가 나갔는데 **예약 0건 + 기존고객 연결 안 됨**.
**원인**: ① "AI 답변 추천"=`/ai-suggest`(suggest_only=True)는 **예약 생성을 skip**하고 답변만 → "confirmed" 멘트만 나가 거짓말. (`/ai-book`=AI 예약등록은 정상 작동 확인) ② cust_num 매칭이 **프로필명("55054 Naush" 형태)만** 보고 **대화 본문("membership number ... 52059")은 안 봄** → #52059 못 찾아 새 고객(cust_ai_*) 생성.
**fix** (`ai_booking.py`, 백업 `bak_pre_custnum_suggest_*`):
  - **B (답변추천 자동예약)**: `ai_booking_agent`에서 예약 가능 상황(`_proceed`=action=book+가용)이면 `suggest_only`여도 `create_booking_from_ai` 호출(기존 skip 제거). → 답변추천 눌러도 정보 완비면 실제 예약 생성 → "확정" 멘트가 진실. 정보 부족(action≠book)이면 진입 안 함(답변만). 유저 요청: "예약 가능 상황이면 답변추천이 예약등록까지".
  - **A (연락처 묻기)**: 회원번호를 대화에서 추출하려 했으나(유저 지적: "고객이 회원번호를 말할 이유가 없다") **철회**. 대신 프롬프트 룰 #12를 "**연락처(휴대폰/이메일) 한 번 물어보기**"로 변경 — 기존 "연락처 강제 금지"(2026-05-13)에서 "물어보되 강요·재요구 금지, 안 주면 빈 값 진행"으로. 연락처를 받으면 기존 phone/email 매칭으로 확실히 기존 고객 연결(중복 방지). 정석은 sns_accounts(채팅 user_id↔고객 1회 연결 후 자동매칭) — 1회 연결되면 이후 자동.
**데이터 정정**: zerotokorea 건 — `/ai-book` 호출로 예약 생성됐던 중복 고객(cust_ai_*)을 **#52059(Yisel sandoval)** 로 재연결 + 인스타 sns 이전 + 중복 삭제. → 이후 zerotokorea 대화는 sns_accounts로 자동 매칭됨.

### 서버 — 차트 템플릿 v2(폐기) → v3(정식) 통일 (2026-05-26, React 변경 0)
**발견**: 차트가 경로마다 버전이 갈림 — **매장 키오스크는 v3**(`ct_condition_v3`/`ct_consent_full_ko_v3`, is_active=true 정식), **AI 예약확정 발송 링크는 v2**(is_active=**false** 폐기). 서버 `_pick_chart_tpls`가 v2를 하드코딩한 채 안 바뀜 → 발송 링크로 받는 고객은 **폐기된 구버전 차트**를 받음(최근 30일 ct_condition_v2 34건). 김미진 케이스 추적 중 발견.
**fix** (`bliss_naver.py` `_pick_chart_tpls`, 백업 `bak_pre_chartv3_*`): `NEW=ct_consent_full_ko_v3`, `COND=ct_condition_v3`로 교체. 발송 링크도 키오스크와 동일 현재 정식 v3. (ct_addons_v3는 is_active=false라 발송 제외 — 키오스크 부가용)
**유의**: consent_templates의 is_active로 현재 정식 버전 확인 가능. 김미진(기존) 본인 건은 키오스크 토큰(v3 풀세트)이 이미 생성돼 있고 메시지 발송은 없었음 — 별도.

### 서버 — AI 고객 전화 매칭 보강 + 차트 템플릿 DB 자동추종 (2026-05-26, React 변경 0)
**①AI 고객 매칭 (`ai_booking.py` create_booking_from_ai, 백업 `bak_pre_phonematch_*`)**: 기존 phone+name 정확일치/email/sns 매칭 다음에 **전화 매칭** 단계 추가. AI가 이름을 부분만 받아(예: "Park yuka"→"Yuka") 매칭 실패하고 중복 레코드 만들던 문제 해결.
  - 전화 정확히 1명 → 그 고객 연결 (이름 달라도).
  - 여러 명이어도 **cust_num(기존 등록) 보유 고객이 정확히 1명**이면 그 고객 연결 (AI가 만든 중복 레코드[cust_num 빈값]는 자동 배제 → 실제 기존고객 연결). 번호공유 다수(cust_num 2+)면 skip→신규 (feedback_bliss_no_phone_matching 존중).
  - 검증: 01059654529 → 후보 2명(Park yuka #54869 + AI중복 "Yuka") → Park yuka 연결.
**②차트 템플릿 DB 자동추종 (`bliss_naver.py` `_active_chart_tpls`, 백업 `bak_pre_dyntpl_*`)**: `_pick_chart_tpls`가 하드코딩 대신 `consent_templates.is_active=true`에서 현재 신규/컨디션 템플릿 ID를 조회(5분 캐시, 실패 시 v3 폴백). 키오스크/consent 앱이 버전업해도 서버 발송이 자동 동기화 → v2/v3 드리프트 재발 방지.
**미해결(별도)**: Yuka류 **기존 중복 레코드 병합**(이미 생긴 cust_ai_* → #54869로 reservation 재연결 + 중복 삭제)은 데이터 정리 트랙. 매칭 보강으로 미래 신규 중복은 안 생김.

### 서버 — WhatsApp 24h 윈도우 자동 재참여 + Instagram 403 원인규명 (2026-05-26, React 변경 0)
**배경**: 인스타·WhatsApp 24시간 메시지 제한으로 발송 실패 다발(2주 WA 16건·IG 15건). 원인 데이터 규명 후 채널별로 분리 대응.

**WhatsApp `131047 Re-engagement` (16건)** — 24h 지난 뒤 직원/AI 자유텍스트 발송이 막힘. **자동 재참여 시스템 구현**:
- **재참여 템플릿 2개 등록**(브라우저로 Meta WhatsApp Manager 직접): `bliss_reengage_ko`/`bliss_reengage_en`. **승인 완료(마케팅)** + 정우 번호로 테스트 발송 → Meta 200 + `read` 검증. ⚠️ Meta가 "재참여" 문구를 **마케팅 카테고리로 강제 분류**(유틸리티 통과 불가 — 정우님 동의). 변수 없는 정적 본문(편집기 중괄호 자동완성 이슈 회피). WABA business_id `408896146297631`, asset_id(WABA) `1236360581538660`. **참고: "결제 구성=인도/액세스 불가"는 발송 무관**(무료 한도 내 발송, 결제수단 셋업 불필요 확인). bliss_reminder_ko/en은 등록만 돼 있고 코드 미연결(보낸 0개).
- **서버 `bliss_naver.py`** (백업 `bak_pre_wareengage_*`):
  - status webhook에서 **131047 실패 감지** → `_wa_trigger_reengage(wamid)`: 원문을 send_queue `status='held'`로 보류 + 원문 메시지 `error_reason`에 안내 표시 + 재참여 템플릿(고객 언어 `detect_lang` 기준 ko/en, 1시간 내 중복발송 방지) 큐잉.
  - **인바운드 핸들러**: WA 메시지 수신 시 그 유저의 `held` → `pending` flush(24h 창 재개 → 원문 자동 전달).
  - **send_queue_thread**: `held` 48h 경과 → `expired`(오래된 원문 발송 방지). 템플릿 발송 시 **무변수면 components 생략** + 이름 `_en` 접미사로 언어 결정.
  - 루프 방지: 재참여 템플릿 본문(`WA_REENGAGE_BODIES`) 실패는 트리거 스킵.
- **비파괴적**: 템플릿 승인 전에도 held/flush(원문 보류·재전달)는 작동, 재참여 핑만 승인 후 발송.
- ⚠️ **승인 후 확인 필요**: WhatsApp이 "비즈니스 발신 메시지에 결제수단 필요" 경고 → 마케팅 템플릿 실발송에 WABA 결제수단 등록 필요할 수 있음.

**Instagram `403` (15건)** — 응답 *"To use 'Human Agent', your use of this endpoint must be reviewed and approved"*. 코드는 이미 HUMAN_AGENT 태그 정상 부착 중 → **Meta 앱에 'Human Agent' 기능 미승인**이 원인. 실패 다수는 **매장발 콜라보 콜드DM**(인플루언서 먼저 보내기)으로 인스타 정책상 API 불가(별개). **코드 변경 불가 — Meta App Review 제출(정우님) 필요**. 승인되면 24h~7일 손님 응대 자동 작동. App Review 제출 양식 = 권한 3개(instagram_business_basic·_manage_messages·Human Agent) 사용설명 3건 작성·저장 완료(브라우저), 남은 건 데모 스크린캐스트 업로드 + 데이터처리 답변 + 최종제출(정우님). 앱: "Bliss Messaging" appId `1591870165413712`.

### 서버 — Instagram 토큰 9개 전체 만료 장애 + 자동갱신 구축 (2026-05-26, React 변경 0)
**장애**: 발송실패(401) 보고 → 조사 결과 **9개 지점 IG 토큰 전부 동일 시각(05-26 00:20~00:30 PDT) 만료** — 60일 전 일괄 발급분이 동시 만료. 전 지점 IG DM 발송(자동응답·직원답장) 다운. 자동갱신 로직 부재가 근본 원인.
**즉시 복구**: Meta 앱(Bliss Messaging) → Instagram API 설정 → "액세스 토큰 생성"에서 9개 계정 토큰 재발급(정우님), 각 토큰 `graph.instagram.com/me`로 검증 후 user_id 매핑 → `secrets.conf` `BLISS_IG_TOKENS_B64`(+`BLISS_IG_TOKEN` 기본=강남) 교체 + `app_secrets.ig_tokens`(Edge Function용) 동기화 → bliss-naver 재시작. 9개 전부 OK 검증.
  - 계정 매핑: 강남=**housewaxing_official**(17841400218759830)·용산=_ys(17841445864668171)·잠실(17841449388904548)·마곡(17841424994371009)·홍대(17841424540907024)·왕십리(17841451286389128)·천호(17841456275137877)·위례(17841448925225432)·housewaxing_seoul(17841455170480955). (+9familydaddy 개인계정 미사용)
**영구 방지 — 자동갱신**: `/home/ubuntu/naver-sync/ig_token_refresh.py` + systemd `bliss-ig-refresh.timer`(**매주 일 19:00 UTC=월 04:00 KST**). 각 토큰 `refresh_access_token`(ig_refresh_token)으로 +60일 연장 → secrets.conf 재기록 + bliss-naver 재시작. 갱신 실패(만료임박/무효) 시 TG 경보(chat 5771685751). 실행 검증: 9개 전부 +59d 갱신 성공.
**유의**: bliss_naver는 **anon(publishable) 키**라 app_secrets 못 씀 → 자동갱신은 secrets.conf(env, 실제 발송 경로)만 갱신. app_secrets는 수동 1회 동기화(Edge Function IG 발송은 사실상 bliss_naver가 전담). IG Login 토큰 user_id = 웹훅 account_id(messages.account_id)와 동일.
**미해결(부차)**: bliss_naver `_ig_use_human_agent` 24h 체크의 `datetime.fromisoformat`가 5자리 마이크로초 타임스탬프('.62133')에서 ValueError → 경고만 뜨고 태그 스킵(401 원인 아님). 별도 fix 대상.

### 서버 — 채팅채널 예약 리마인더 보강 (WhatsApp 템플릿 + 스킵규칙 + IG 창체크) (2026-05-27, React 변경 0)
**배경**: 카카오 리마인더(한국폰, rsv_1day 18시/rsv_today 09시)와 별개로, 채팅채널(WhatsApp/IG/LINE/네이버톡) 예약 손님(주로 외국인)에게도 리마인더 필요. `_send_chat_reminders`+`chat_reminder_thread`가 이미 있었으나 4가지 미흡 → 보강(백업 `bak_pre_chatrem_*`):
1. **전날 리마인더 14시 → 18시** (카카오 rsv_1day와 동일 시각). 당일 09시(동일).
2. **스킵규칙**: ① 예약을 "리마인더 발송일(오늘 KST)"에 한 건 → 방금 예약이라 불필요(스킵). ② 한국 휴대폰(010/8210) → 카카오 중복이라 스킵. (created_at·cust_phone select 추가)
3. **WhatsApp은 승인 템플릿(bliss_reminder_ko/en)으로** — 일반텍스트는 24h 밖 131047 실패. template_params=[이름, 날짜(언어별포맷), 시간, 지점(영어 시 영문명)].
4. **Instagram은 24h 창 열린 손님만**(마지막 inbound 24h 이내), 닫히면 스킵. LINE/네이버톡은 plain text best-effort.
**정책 핵심**: 리마인더=능동발송. **WhatsApp·카카오만 "승인 템플릿 푸시"라 항상 발송 가능.** Instagram은 능동발송 불가·"24h 창 열린(=최근 대화) 손님"에게만. Human Agent 승인돼도 그건 "응답 기한 7일 연장"이지 능동 리마인더 허가 아님. 네이버톡 상담채널이라 능동 제한적(best-effort).
**중복방지**: `reminder_sent_log`(reservation_id, reminder_type). **검증**: 2026-05-28 대상 WhatsApp 3건 중 1건(당일예약) 스킵→2건, 네이버 1건(한국폰) 스킵→0건. 블라스트 없음.

### 서버 — AI 자동응답 예약 게이트 강화 (성급예약·성별·비키니범위·질문우선) (2026-05-27, React 변경 0)
**배경**: Mia(WhatsApp) 사례 — 손님이 "female ... bikini wax" + 가용 문의 중인데 AI가 ① 정보(이름·지점·날짜·시간) 받자마자 **즉시 예약** ② "female" 명시했는데 **성별 미캡처** ③ 비키니/브라질리언 **범위 미확인** ④ 가격 질문에 "확정됐어요"로 **답 회피**(손님 2번 물음) ⑤ 날짜 "28 or 29" 임의로 28 선택.
**원인**: 프롬프트 `[예약 필수정보 체크리스트]`의 "이것만 있으면 book 실행"(날짜·시간·시술)이 "예약 의사 확인" 룰을 눌러 성급 예약 유발. 비키니 범위 게이트 부재. 질문우선 룰 부재.
**fix** (`ai_booking.py` 프롬프트 5곳, 백업 `bak_pre_gates_*`):
- ① 성별: "I'm a female traveler"/"as a woman" 등 **서술·맥락에서도 gender 캡처** 룰 + 예시.
- ② **비키니/브라질리언 범위 게이트(예약 전 필수)**: 외국 손님 'bikini'=전체제거(=한국 브라질리언) 오해 많음 → book 전 "비키니=팬티라인 / 브라질리언=전체 제거, 어느 쪽?" 1회 확인(scope 확인이지 옵션 업셀 아님 — 그건 여전히 금지).
- ③ **성급예약 방지**: "이것만 있으면 book" → "예약 의사·게이트 통과 시에만 book". 가용/가격 문의 단계면 예약 말고 답부터. 날짜 복수면 임의선택 금지·확인.
- ④ **질문 우선**: 마지막 메시지가 질문(가격·시간·위치)이면 그 질문에 먼저 답, "확정됐어요"로 회피 금지.
- ⑤ 자기소개형 메시지 추출 보강(예시 명시).
**검증** (Mia 대화 재현, 부작용0 하니스 `_test_mia.py`, prod gemini-3.5-flash):
- 가격질문 → 여/남 가격+소요시간 답 후 "예약할까요?" ✅
- 명확한 비키니 예약요청 → action=ask_info, gender=F 캡처, 비키니 범위 게이트 발동("bikini=panty line vs Brazilian, which?") ✅, 성급예약 안 함 ✅
- 잔여 한계: gemini-3.5-flash가 **여러 턴 전 서술 메시지의 성별·시술을 항상 끌어오진 못함** → 재질문 발생(무해 — 성급예약 대신 한번 더 묻는 안전 방향, blind 예약은 안 함). 최근/명확하면 정상 캡처.

### 서버 — AI 예약 churn fix: 멱등성(중복 예약·취소 방지) (2026-05-27, React 변경 0)
**증상** (Liah Goyal WhatsApp): 손님이 "Thank you!" 같은 비-예약 메시지를 보낼 때마다 AI가 예약을 **계속 다시 생성** → 예약 6건 생성·5건 취소 + "Done! confirmed" 중복 발송 + 취소건 성별 M으로 깨짐(손님은 F). 변경 1번인데 취소 다발.
**원인**: 최근 변경(답변추천 자동예약 + 세션기록 기반 예약 + active 모드)에서 **멱등성·의도 게이트가 빠짐**. 대화에 예약정보가 다 모여 있으면 메시지마다 `action=book`+`_is_change`→`_proceed=True`→`create_booking_from_ai`가 기존 예약 취소+재생성. 예약 "변경"=취소+재생성이라 인사 한 번에 취소 1건씩 churn.
**fix** (`ai_booking.py`, 백업 `bak_pre_churn_*`):
1. **`create_booking_from_ai` 멱등**: `find_existing_booking` 결과가 신규 booking과 **동일(bid·date·time)** 이면 → 취소·재생성하지 말고 `return existing["id"]`. (defense-in-depth)
2. **action=book 핸들러 멱등**: `_is_change`인데 기존 예약과 같은 날짜·시간·지점이면 → `_proceed=False` + 답변이 "확정/Done/confirm"이면 "이미 예약돼 있어요 😊"로 교체(중복 confirm 차단).
3. **프롬프트 CASE B 가드**: [기존 예약]과 같은 날짜·시간이면 다시 book 금지. 감사/인사/"곧 봬요"/단순질문 → action=chat(예약 동작 금지). 실제로 날짜·시간 바꿀 때만 book.
**검증** (`_test_churn.py`, create/cancel mock, 실DB 예약 1건 setup·삭제): "Thank you!" → create 0·cancel 0 (churn 없음, AI가 "You're welcome"로 chat 처리) ✅ / "4pm으로 변경" → create 1 (정상 변경) ✅.
**적용**: 서버 직접 패치 + `systemctl restart bliss-naver`. React 변경 0 → 버전업·CF퍼지 불필요.

### v3.7.867 — 프리랜서 소속제거 + 동의서 문자발송 + 만료패키지 숨김 (2026-05-27, 요청 처리)
공지&요청 6건 처리 묶음 배포.
- **프리랜서 소속 없는 공유 명단** (지은 id_4kx5wgvimj, `TimelinePage.jsx`): 새 프리랜서는 `branch:""`(소속 없음)으로 생성 + 만든 지점에 그날만 exclusive override로 배치. 다른 지점/날짜엔 각 지점 '직원 추가' 목록에서 선택→이동(기존 doAdd exclusive 경로 재사용). 목록·이동 패널에 "프리랜서·소속없음" 표시. 같은 이름 재생성 차단(목록에서 선택 유도). **혜진(유일 프리랜서) `branch:""` 마이그레이션** — 이미 5/30+ 전부 강남 배정돼 있어 소속만 떼면 강남에만 뜨고 홍대 소속 표시 사라짐(기존 지원/override 로직 그대로 활용, 엔진 변경 최소).
- **동의서 문자(SMS) 발송** (신영 id_xdbby2br6e, `ConsentModal.jsx`): 동의서 모달에 `📱 문자로 보내기` 추가 — consent_token 생성 후 `send-sms` Edge Function으로 손님 폰에 링크 SMS. 휴대폰(010~) 있는 고객만 노출. **예약 모달에서도** (`ReservationModal.jsx`) 고객정보 줄의 차트 배지를 `동의서 보내기/재전송` 버튼으로 → 같은 ConsentModal(createPortal) 오픈, `reservationId` 연동으로 차트 상태 갱신. 카카오 알림톡 템플릿은 검수 후 추가 예정(SMS가 우선·폴백).
- **만료 패키지 숨김** (지은 id_zl2g6fglfv, `ReservationModal.jsx`): 예약등록 '보유 패키지' 목록 + 패키지 자동감지 필터에 `유효:YYYY-MM-DD < today` 제외 추가. 만료권(예: 36536 김경민 토탈PKG 유효:2025-10-20)이 "1회 남음"으로 뜨던 것 차단.
- **세기 2건**(id_23e6pmzv1n 용산→강남 오등록 / id_vhhi3xtppd 인스타 발송실패)는 직전 세션 서버 fix(손님 명시지점 우선 + IG 토큰 갱신)로 해결됨 → done 답글.
- **현아 현장결제**(id_inybvy85wv): `businesses.settings.external_platforms`에 '현장결제' 추가(jsonb surgical).
- **미반영(별도 — consent 앱)**: 미진·재윤·보령 3건은 동의서/차트 앱(bliss-consent 별도 레포) 수정이라 pending 유지.
**적용**: v3.7.867 라이브 배포(version.txt 검증, CF 퍼지 success). 혜진 마이그레이션 + 요청 6건 done은 DB 직접.

### 동의서(결제 동의서) 알림톡 템플릿 등록·검수 제출 (2026-05-27, 승인 대기)
신영 동의서 수동발송을 SMS→알림톡으로 전환 위해 신규 템플릿 8지점 등록+검수 요청 (pkg_pay 패턴, 알리고 API).
- **용도**: 패키지·선불권 등 **결제(구매) 관련 동의서** 수동 발송 (시술 전 차트 아님). 매장에서 못 받은 결제 동의서를 손님 폰으로 보내 서명받기.
- **본문**: `안녕하세요, 하우스왁싱입니다.\n\n[지점] #{사용자명}\n\n#{고객명}님, 구매하신 상품(패키지·선불권 등) 관련 동의서를 안내드립니다.\n아래 링크에서 내용 확인 후 서명 부탁드립니다.\n▶ #{동의서링크}\n\n문의 사항은 매장으로 연락 부탁드립니다.` (버튼 없음, 변수 #{사용자명}/#{고객명}/#{동의서링크})
- **tpl_code 매핑** (8지점, status REQ 검수중): 강남 UI_2146 · 마곡 UI_2147 · 왕십리 UI_2148 · 용산 UI_2149 · 위례 UI_2151 · 잠실 UI_2152 · 천호 UI_2153 · 홍대 UI_2154
- **승인 후 후속 (PENDING)**:
  1. `ConsentModal.jsx` send()에 `via='alimtalk'` 추가 — 동의서 token 발급 후 `alimtalk_queue`에 noti_key(신규 'consent_doc' 등) + params(#{사용자명}=지점명, #{고객명}, #{동의서링크}=`https://sign.blissme.ai/?t={token}`) 적재. UI 버튼 `💬 알림톡`(우선) + `📱 문자`(폴백). 휴대폰 없으면 QR.
  2. 8지점 `noti_config`에 새 키(예: `consent_doc`) {on:true, tplCode:지점별코드, msgTpl:위 본문} 추가 — `alimtalk_thread`가 noti_key로 tplCode/params 조회·발송.
- **참고**: 별도로, 차트링크 자동발송 템플릿(확정안내_차트링크 UI_1890등 / 당일안내_차트링크 UI_1603등)도 8지점 승인 완료 — rsv_confirm/rsv_today에 `#{차트링크}` 연결하는 wiring 별도 대기(시술 전 차트용, 결제 동의서와 별개).

**알리고 등록 시 주의**: 응답 `code` 문자열 "0"=성공. add 응답 `data.templtCode`로 코드 회수. template/request의 param명은 `tpl_code`. senderKey는 지점별 상이(8개 카톡 채널).

### 서버 — AI 길/위치 질문 회피 fix + v3.7.868 직원 수동발송 말머리 fix (2026-05-27)
Liah(WhatsApp) 후속 2건.
**A. 서버 `ai_booking.py` (라이브, React 0)** — 길·찾아오는법 질문에 AI가 "You're all set/곧 뵐게요"만 반복:
- 원인: churn fix(2026-05-27)에서 넣은 멱등 응답("You're all set")이 **질문 답변까지 덮음**. 손님이 "Is it easy to find from the street?" 물어도 예약확정 멘트로 회피.
- fix: ① 멱등 응답 override를 **질문이 아닐 때만**(단순 인사·동의) 적용 — 질문이면 AI 답을 안 덮음(`_is_q` 휴리스틱). ② 프롬프트 강화 — 주소·전화·영업시간뿐 아니라 **찾아오는 길·교통·주차·엘리베이터·건물/층** 질문도 action=chat + [현재 지점 상세]/[모든 지점 주소·전화] 기반 실제 안내, "예약확정 멘트로 회피 절대 금지".
- 검증: "find from the street?" → "Wangsimni Branch is easy to find! 3rd floor at 311-1 Wangsimni-ro" (회피 X, churn 0) ✅. 백업 `bak_pre_dir_*` + `systemctl restart`.
**B. v3.7.868 `MessagesPage.jsx` (라이브)** — AI 답변추천 후 직원이 고쳐 보냈는데 "AI 자동응답" 말머리로 박힘:
- 원인: "AI 답변 추천"(genAI)이 `replyIsAi=true` 세팅 → 직원이 입력칸 고쳐도 플래그 안 꺼짐 → is_ai=true로 발송.
- fix: textarea onChange(직원이 한 글자라도 편집) 시 `setReplyIsAi(false)` — 그대로 보내면 AI, 고치면 직원 발송. (2곳)
**휴무 신청 기능 보류**: `OffRequestCard.jsx` + `BlissRequests.jsx` 통합(공지에 얹는 휴무 신청 — 담당자가 직원별 날짜 대신 입력→마감 시 schHistory "휴무(꼭)" 일괄 기록)을 만들었으나, 정우님이 설계 재검토 요청 → **진입 버튼만 숨김(코드 보존, 진입점 없어 비활성)**. 재개 시 BlissRequests 새공지 버튼 옆 휴무신청 버튼만 복구하면 동작.

### v3.7.869 — 지점별 건물·접근 정보(AI 주입) + AI설정 정리 (2026-05-27)
**배경**: AI가 손님 "엘리베이터 있어요?/주차 돼요?"에 **건물 세부를 지어냄**(DB엔 주소·전화만 있고 건물정보 없음). 지점별 건물정보를 저장해 AI가 그것만 보고 답하게.
**A. 지점별 건물·접근 정보 (DB + UI + 서버 주입)**:
- DB: `branches.access_info jsonb` 컬럼 (migration `branches_add_access_info`). db.js DBMAP `access_info↔accessInfo`.
- UI: `AdminPlaces.jsx`(관리설정→예약장소 관리) 지점 편집에 "건물·접근 안내" 섹션 — 주차/엘리베이터·계단/대중교통/위치설명/네이버지도/구글지도/기타. 비워두면 AI가 "담당자 확인"으로 답.
- 서버 `ai_booking.py`: branches 캐시 SELECT에 `access_info` 추가 + `_fmt_access_block()` 헬퍼 → **현재 지점(branch_detail_block) + 기존 예약 지점(_ex_bid, WA 공통채널 대비) 둘 다 주입**. 프롬프트에 "★이 내용만★ 사용, 없는 항목은 지어내지 말고 담당자 확인". 백업 `bak_pre_access_*`.
- 검증: 왕십리 access_info=[엘베 없음·계단 3층 / 외부 유료주차] 세팅 후 "Is there an elevator?" → "Wangsimni does not have an elevator, please use the stairs to the 3rd floor" / "주차?" → "외부 유료주차장 이용" ✅ (지어내기 X).
- **남은 일(정우님)**: 왕십리 외 7개 지점 건물정보를 예약장소 관리에서 입력. (왕십리는 예시로 입력해둠)
**B. AI 설정 페이지 정리** (`AdminAISettings.jsx`):
- 삭제(숨김): "메시지함 자동응대 프롬프트"(ai_chat_prompt)·"네이버 예약 AI 분석 프롬프트"(ai_analyze_prompt) — 둘 다 **서버가 안 읽음**(서버 코드 프롬프트로 동작). 편집해도 효과 0이라 혼란만 줘서 제거. (state/save 함수는 호환 위해 코드 보존)
- API 키: (v3.7.870) **섹션 전체 숨김** — Gemini 키는 운영자(테라포트)가 시스템 전역으로 관리, 매장 사용자는 쓸 일 없음. AI 설정 화면에서 API 키 섹션 제거({false &&}로 보존). 시스템 키는 그대로 작동.

### v3.7.871 — FAQ를 RAG 검색형(항목별 편집)으로 전환 + 214개 이관 (2026-05-27)
**배경**: FAQ가 두 군데로 갈려 혼란 — 설정 `ai_faq`(6개, 직접 주입) vs 학습문서 `housewaxing_faq.md`(~250, RAG). 직접 주입은 항목 늘면 매 응답 프롬프트 폭증(비용·속도). 정우님: 200개 더 추가 시 옳은 구조? → **RAG 검색형으로 통일** (수백 개도 비용 일정).
**구조**: FAQ 항목을 `document_chunks`(전용 FAQ 문서 `doc_faq_{biz}`)에 1항목=1청크로 저장 + 임베딩. 서버 `_rag_search_docs`(match_documents)가 이미 청크 전체 검색 → **서버 검색 코드 변경 0**. ★핵심(core) 항목만 `settings.ai_faq`에도 동기화해 항상 직접 주입(안전 단답 보장).
- **임베딩 일관성**: 편집기·이관·서버쿼리 전부 `gemini-embedding-2 / 768` 동일 (편집기·이관 RETRIEVAL_DOCUMENT, 쿼리 RETRIEVAL_QUERY). 기존 학습문서와 같은 공간 → 검색 정확.
- **신규 라이브러리** `src/lib/faqStore.js`: loadFaqItems/saveFaqItem(임베딩 후 upsert)/updateFaqMeta(메타만, 재임베딩 X)/deleteFaqItem/bulkImportFaq.
- **AdminAISettings FAQ 섹션 재작성**: 인덱스 기반 → chunkId 기반. 항목별 추가/수정/삭제(임베딩) + ON/OFF·★핵심 토글(메타만) + 검색/카테고리 + "기존 FAQ 이관" 버튼.
- **이관 완료(서버 스크립트 `/tmp/migrate_faq.py`, gemini-embedding-2)**: 레거시 ai_faq 6(core) + housewaxing_faq.md 파싱 208 = **214개** document_chunks 생성, 구 housewaxing_faq.md 문서·청크 삭제. 검증: `_rag_search_docs` 4개 질문 모두 실제 Q&A 반환 ✅.
**적용**: v3.7.871 라이브 배포(version.txt 검증, CF 퍼지 success). 이관은 서버에서 1회 실행 완료(클라 임베딩과 동일 모델이라 일관).
**유의**: 새 FAQ는 AI 설정 → FAQ에서 항목별로 추가(자동 임베딩 → RAG 검색). ★핵심은 소수만(마취크림·콧속 등 절대 틀리면 안 되는 안전 단답). 수백 개 추가해도 프롬프트엔 관련된 top5 + 핵심만 들어가 비용 일정.

### v3.7.872 — 요청 처리 묶음 (메시지함 시간·추가시술 적립·예약금 태그) + 고객 병합 (2026-05-27)
공지&요청 자동 처리 가능분.
- **메시지함 시간 표기** (신영 id_l47143d65l 일부): `MessagesPage.fmtTime` — 24h "7:53" → **"오전/오후 7:53"** + 오늘 아니면 **날짜(M/D)** 붙임(작년이면 연도). (같은 요청의 'AI 학습 체크 UI'는 화면 설계 필요 → reviewing, 별도 논의)
- **추가시술 금액 첫방문 10% 적립 포함** (현아 id_bqtjtnw55y): "첫방문 10% 적립"이 `base:net_pay + baseCategoryIds`(카테고리 필터)라 **카테고리 없는 추가시술(어깨 3만 등)이 적립 base에서 빠지던 버그**. `eventEngine.baseAmount` 카테고리/시술필터 분기에 `ctx.extraSvcTotal` 포함(특정 시술ID 필터가 아닐 때). SaleForm ctx에 `extraSvcTotal:_extraSvcAddTotal` 추가.
- **외부선결제 입력 시 예약금완료 태그 자동** (신영 id_4m33q2cpux): `SaleForm` 저장 시 externalPrepaid>0 + 플랫폼 선택돼 있으면 예약 `selected_tags`에 `PREPAID_TAG_ID` 자동 부착(중복 방지). 입금문자 매칭(BankDeposits)과 동일한 태그.
- **고객 병합** (현아 id_7hd6j0bl2e): cust_num 55554·70259 동일인(Violette Drks)→ 70259 매출 1건을 55554로 이전 + sns 병합 + 70259 삭제 (DB 직접).
- **세기 외국인 길/건물 질문 반복** (id_gyxzxokvny): 직전 서버 fix(길/건물 안티-할루시네이션 + 멱등응답 완화 + 지점 access_info)로 해결됨 → done 답글.
- **미진/재윤/보령**(consent 앱)·**신영 AI학습 UI**: reviewing(별도 — consent 레포 / 설계 논의).
**적용**: v3.7.872 라이브 배포(version.txt 검증, CF 퍼지 success).

### v3.7.873 — 우클릭 "수정 요청" (화면 캡처 + 바로 등록) (2026-05-27)
- 신규 `src/components/common/QuickRequest.jsx` — AppShell 전역 마운트(전 직원). **우클릭 → "📝 수정 요청"** 메뉴 → 클릭 시 현재 화면 캡처(html2canvas) + 내용 입력 팝업 → `bliss_requests_v1`에 바로 등록(이미지 첨부 = uploadImageToStorage 'requests', name=현재 직원, page=경로).
- 캡처: `html2canvas` 신규 의존성(^1.4.1) — **동적 import**(트리거 시에만 로드, 별도 청크 202KB → 메인 번들 무게 0). 뷰포트 영역만 캡처, `data-quickreq` 요소(메뉴·팝업) 제외.
- 입력칸/textarea/contentEditable 위 우클릭은 **기본 메뉴 유지**(붙여넣기 등) — 그 외 영역만 수정요청 메뉴. z-index 99999(모든 모달 위).
- 캡처 실패해도 내용만으로 등록 가능(graceful). 등록 후 "✓ 수정요청 등록됨" 토스트.
**적용**: v3.7.873 라이브 배포(version.txt 검증, CF 퍼지 success). ⚠️ 프리뷰 로그아웃 상태라 전체 플로우 자동검증 미실시 — 라이브(로그인)에서 우클릭→수정요청 직접 확인 권장.
**유의**: html2canvas는 DOM 렌더 방식이라 iframe(근무표 등)·크로스도메인 이미지는 캡처에서 빈칸일 수 있음(정상 한계). 텍스트·일반 UI는 정상 캡처.

### v3.7.874 — 수정요청 처리 (상단 아이콘 툴팁) + 홍소희 입금 매칭 (2026-05-27)
- **상단 아이콘 툴팁** (강남 id_g30ak3ujnx): 받은메시지함 ↗(외부 채널 열기) title을 "↗ OO앱에서 이 고객 대화 열기"로 명확화 + 타임라인 'AI Book'·설정(톱니) 버튼에 title 추가. (네이버갱신·시계 버튼은 이미 title 있음)
- **홍소희 예약금 매칭** (지은 id_65iswcoqxz, DB): 입금자명이 **'홍송희'(소→송 오타)**로 들어와 예약(홍소희, 5/28)과 자동매칭 안 됨 → 입금 bd_ea07d1c1f를 예약 id_3wbpofkkhn에 수동 매칭(status=matched) + 예약금완료 태그 확인. (예약엔 선결제 33,000 이미 기록돼 있었음)
- **강남 '테스트'** (id_y85wlf2hqf): 우클릭 수정요청 동작 테스트 → done.
- **남음**: 신영 id_l47143d65l(AI 학습 체크 UI) — 설계 논의 필요, reviewing 유지.
**적용**: v3.7.874 라이브 배포(version.txt 검증, CF 퍼지 success).
- 유지: FAQ(ai_faq, 자동응답 실사용)·학습문서(RAG).
**서버 — AI 길/건물 질문 안티-할루시네이션 강화**(직전, React 0): 주소·층·전화·영업시간만 데이터로 답하고, 엘베·주차·계단·간판·출구·도보 등 저장 안 된 건물 세부는 "담당자 확인"(추측 금지). access_info 있으면 그걸로 정확히 답.
**적용**: v3.7.869 라이브 배포(version.txt 검증, CF 퍼지 success). 서버 패치 + migration은 별도 적용 완료.
**유의**: 지점 건물정보는 RAG가 아니라 **예약 지점에 묶인 필드**라 지점 안 섞임(RAG는 유사도라 8지점 헷갈림 위험 — 의도적으로 필드 방식 채택). access_info는 현재 지점·기존예약 지점 둘 다 주입(WA 공통채널은 branch_id 미해결이라 기존예약 bid로 보강).

### v3.7.888 — 요청 처리 4건 (고객명 변경 / 자동번역 / AI 범위게이트 / 오류신고 버튼) (2026-05-28)
공지&요청 대기 4건 처리. ①②④ React(v3.7.888 배포), ③ 서버(ai_booking.py 라이브).
- **① 강남 고객명 변경 저장 버그** (id_g2n7orbp8p, `ReservationModal.jsx`): 편집 모드(변경) 저장이 예약 `cust_name`만 갱신하고 **customers 테이블 본 레코드(name)는 안 바꿈** → 모달 재진입 시 custId로 customers.name을 다시 불러와 옛 이름으로 덮어쓰던 버그("소민구"가 "구소민"으로 안 바뀜). fix: 공통 헬퍼 `_persistCustEdits()` — 편집 저장 시 custId 있고 이름/전화/이메일/성별/이름2가 스냅샷 대비 바뀌었으면 `sb.update("customers", …)` + 로컬 `data.customers` 동기화. 저장 버튼 2곳(일반/방문자 통합 액션바)에서 호출.
- **② 현아 자동번역 발송 누락** (id_3xihixs9v6, `MessagesPage.jsx sendTranslated`): auto 모드 번역 판정(`_enPriority`)이 **마지막 인바운드 1건의 영문 글자 수**만 봄 → 영어권 손님이 "12?"·"ok"·이모지 같은 짧은 답을 마지막에 보내면 영문<5라 번역이 꺼져 **한글이 그대로 외국 손님에게 발송**. fix: 최근 인바운드 **5건을 합쳐** 영어권 판정(`_en>=5 || (_en>0 && _ko===0)`). 서버 실패 fallback이 아니라 애초에 번역 시도를 안 한 케이스였음.
- **③ 대표 AI 비키니/브라질리언 범위게이트 과발동** (id_tixg5pc9nf, 서버 `ai_booking.py`, React 0): v3.7.868 범위 게이트가 시술이 "비키니·브라질리언·음모/하의"면 무조건 범위 질문 → 손님이 "Brazilian" 명시했는데도 또 물어 짜증. fix: 프롬프트를 **조건부**로 — "브라질리언/Brazilian" 명시 시 범위 재질문 금지·바로 book, "bikini"·모호할 때만 1회 확인. 백업 `ai_booking.py.bak_pre_gatefix_20260528_042244`, `systemctl restart bliss-naver`.
- **④ 신영 오류신고 버튼 (임시안)** (id_l47143d65l, `MessagesPage.jsx`): 원 요청은 AI 학습 체크 UI였으나 임시로 — 메시지 대화창 버튼행(AI 답변추천/번역/AI 예약등록 옆)에 **🚨 오류신고** 버튼 추가. 클릭 → html2canvas 자동 화면캡처 + 최근 대화 4건 → `bliss_requests_v1`에 **"AI 고객응대오류"**(kind:'ai_error')로 원클릭 접수. QuickRequest 인프라(uploadImageToStorage+bliss_requests_v1) 재사용. 메시지함 오전/오후·날짜 표기는 이미 v3.7.872 완료. 실시간 학습 체크 UI는 향후 별도 기능.
- 요청 4건 `bliss_requests_v1` status=done + 매장 직원 톤 답글. 배포: v3.7.888 라이브(version.txt 검증, CF 퍼지 success) + git commit/push.

### v3.7.889 — 예약 등록 시 이름+전화 중복 고객 경고 강화 (2026-05-28)
**증상**(정우님): 예약 등록 시 이름·연락처가 동일한 고객이 중복으로 신규 생성됨. 동일인이면 경고가 떠야 함.
**원인** (`TimelinePage.jsx` handleSave 신규고객 생성부): 전화 중복 경고는 이미 있었으나 — ① 서버 조회가 `phone.eq.{숫자}` **정확일치**라 기존 고객 전화가 하이픈 등 다른 포맷으로 저장돼 있으면 못 잡음 ② 로컬 캐시 100건 제한으로 그 밖 고객 누락 → 이름+전화 같아도 중복 생성.
**fix**: 신규 고객 생성 직전 중복 검출 강화 — **이름(`name.eq`)으로도 후보를 서버 조회** + 전화는 **JS에서 정규화 비교**(`_normP`, phone·phone2, 하이픈·공백 무시)라 저장 포맷 달라도 일치 판정. 경고 분기: 이름+전화 둘 다 같으면 "⚠️ 이름·연락처가 모두 같은 고객이 이미 있습니다 (중복 등록 주의)" + [확인]기존 연결/[취소]그래도 신규 / 전화만 같으면 기존 "동일 번호" 경고 / **이름만 같고 전화 다름은 경고 안 함**(동명이인 — `feedback_bliss_no_phone_matching` 원칙). 네이버/카카오/AI 예약(서버 자동생성)은 별도 `find_cust_by_phone` 경로라 무관 — 이번 건은 앱 직접 등록 경로.

### v3.7.890 — 요청 처리: 타임라인 직원 이름 사라짐 + 매출히스토리 소진/잔액 (2026-05-28)
공지&요청 신규 5건 중 ①⑤ React(v3.7.890), ③ 데이터수정, ② consent세션 위임, ④ 보류.
- **① 타임라인 직원 이동 시 원 근무지 이름 사라짐** (id_9f4hu0sw4z, `TimelinePage.jsx`): `syncOverrideToSch`가 schHistory_v1 **전체 blob을 read-modify-write**(fetch→한 칸 patch→upsert) → "경아·수연 서로 이동/배정"처럼 **연속 호출 시 뒤 호출 fetch가 앞 write 전에 읽어 앞 배정을 덮어씀** → 한쪽 이름 사라짐. fix: `_schSyncQueue` ref 프로미스 큐로 read-modify-write **직렬화**(앞 작업 write 완료 후 다음 fetch). v3.7.717 empWorkHours 레이스와 동류. ⚠️ 레이스 타이밍이라 로컬 재현 어려움 — 정우님 "경아·수연 서로 배정" 재확인 요청. setEmpBranchOverride(empOverride_v1)는 React updater로 순차 병합이라 별개(미변경).
- **③ 장영수 차트가 동의서에 안 뜸** (id_6z15o3qsrv, 데이터 수정·배포무관): 장영수가 동일전화 중복고객 2개(cust_2xcqzjs00w 고아 / cust_naver_myembuz1a5 #70609 예약보유). 신규차트+컨디션차트가 고아 고객에 form_data.reservation_id=null로 묶여 예약(flgpo4wker)에서 안 보임. 차트 2건+토큰 실고객+예약 재연결(form_data.reservation_id=flgpo4wker), 고아 is_hidden=true. chartInfo 코드 정상 — 원인=키오스크/동의서 경로 중복 고객(consent 앱 영역).
- **⑤ 매출 히스토리 소진 마이너스 + 다담권 잔액** (id_0ck973k84l, `ReservationModal.jsx` 매출히스토리 패널): 소진 항목(다담권 pkg_deduct·패키지 pkg_use·포인트)을 **빨강(#C62828) 마이너스**로 표기(다담권 −110,000원 / 패키지 −1회 / 포인트 −X원, 포인트는 total>0이어도 항상). 패널 상단에 **"다담권 남은 잔액"** 배지 — `custPkgsInfo`에서 `isMoneyPkg` + note `잔액:` 합계(만료 `유효:` 제외). 충전금 잔액 = 현재 잔액(per-sale 과거잔액 아님).
- **② 신규차트 음모왁 4지선다** (id_0pjoyafwt0): sign.blissme.ai(bliss-consent 별도 레포) 작업 → consent 세션 위임(spawn_task). status=reviewing.
- **④ 종이 동의서 사진 저장** (id_5cbyzefgtx): 첨부 위치 설계 필요 → 보류. status=reviewing.

### v3.7.891 — 예약모달 상단 "작성완료" 칩 + 동의서·차트 이미지 뷰어 (2026-05-28)
**요청**: 예약 모달 상단 고객정보에, 동의서·차트 작성완료 시 깜빡이는 표시 + 클릭하면 (키오스크처럼) 문서를 **이미지로 바로** 보기.
- **신규 `src/components/Consent/ConsentDocsViewer.jsx`**: 키오스크(`bliss-consent/.../ConsentDocsViewer.jsx`)를 bliss-app 스타일(인라인+`T` 토큰+`I` 아이콘+`SB_URL`/`sbHeaders` fetch)로 이식. `customer_consents?customer_id=eq.{custId}`(signed_at desc, limit 8) → pdfjs로 PDF를 이미지(`<img>`) 렌더. 문서 여러 건이면 탭(활성만 lazy 렌더). 92dvh / `min(940px,96vw)`. `createPortal`(body), z-index 9500, ESC/배경클릭/닫기.
  - **pdfjs(v5.7) 워커 경로 — `?url` 동적 import** (`new URL(bare, import.meta.url)`는 Vite에서 bare 스펙 해석 안 됨 → 무한 로딩. aiDocs.js와 동일 방식). pdfjs는 `await import`(동적) — aiDocs가 이미 정적 import라 메인 번들 무게 증가 없음.
  - **적응형 scale**: 고정 scale 2.1은 원본이 큰 PDF에서 캔버스 22MP+ → 렌더 멈춤. `목표폭 1400 / 원본폭` 기준(clamp 0.8~2.2) + 한 변 상한 `MAX_DIM 2600`.
  - **render 타임아웃 15초 → PDF 링크 fallback**: 어떤 환경에서도 무한 로딩 방지(`task.cancel()` + `Promise.race`). 렌더 실패/지연 시 "📄 PDF 새 창에서 열기".
  - pdfjs 5.7 render: `{ canvas, viewport }`(canvas가 주 파라미터, canvasContext는 하위호환).
- **ReservationModal.jsx 상단 고객정보**: 이름줄의 기존 "차트 작성완료" 버튼(텍스트 펼침, "PDF 없음")을 **깜빡이는 칩**으로 교체 — `chartInfo?.status==="signed"`일 때 `className="chart-done-blink"` + 라벨 "동의서·차트 작성완료" + 눈 아이콘. 클릭 시 `ConsentDocsViewer` 오픈(`customerId=chartInfo.consent.customer_id||f.custId`, `focusConsentId`로 이 예약 차트 기본 탭). 미서명 시 "동의서 보내기/재전송" 버튼은 그대로.
  - 기존 텍스트 펼침(`chartExpand`) + 미사용 `CHART_LABELS`/`_fmtChartVal` 죽은 코드 제거.
- **index.html**: `@keyframes chartDoneBlink`(차분한 초록 글로우, 1.8s) + `.chart-done-blink` + `prefers-reduced-motion` 무효화.
- **검증(로컬 dev)**: 칩 노출·깜빡임(chartDoneBlink) + 클릭→뷰어 오픈 + pdfjs 워커 로드·PDF fetch(560KB)·파싱·렌더 시작 + 타임아웃 폴백(PDF 링크) 전부 확인. ⚠️ 실제 PDF 래스터화 이미지는 프리뷰 **헤드리스 브라우저**에서 `page.render()`가 멈춰 눈으로 확인 못 함(기본 canvas는 정상 → 헤드리스 한계, 코드는 pdfjs 5.7 API상 정확·키오스크 동일 방식). **실 브라우저에서 이미지 표시 1회 확인 권장** — 실패해도 PDF 링크 fallback으로 항상 열림.
- 검증용 임시 동의서(데모 사업장 1건) 삽입→확인→삭제 완료.

### v3.7.892 — 고객 관리 헤더 총원 정확 카운트 (2026-05-29)
**요청**(정우님): 고객 관리 헤더가 "87명+"(로드된 페이지 수)만 표시 → 실제 총원을 보여달라.
**fix** (`CustomersPage.jsx`): `totalCount` state 추가. fetchPage `reset` 시 현재 필터(buildFilter) 기준 `count=exact` 쿼리(raw fetch + `Prefer: count=exact` + `Range: 0-0` → `Content-Range` 헤더 `/총합` 파싱)로 정확 총원 집계. 헤더 `{custs.length}명{hasMore?+}` → `총 {totalCount}명`(있으면)/폴백. 검색·매장·가입일 필터 반영, reset 시 1회(스크롤마다 X). longValOnly(RPC)·집계 실패 시 폴백. 전체 매장 40,522명(2026-05-29). 표 컬럼 ▼필터(클라이언트)는 헤더 총원 미반영.

### v3.7.893 — 고객통계 탭 + 스크롤 1개 + 카운트 필터 + 매출 차감후잔액 (2026-05-29)
- **고객통계 탭** (`CustomerStats.jsx` 신규 + CustomersPage [고객 목록 | 고객 통계] 탭): 월별 방문 추이(그래프+표) + 선택 월 지점별. **내국인/외국인 각각 신규·기존·소계 + 총합** 분리. 기간 버튼 1/2/3년/전체. 막대그래프(신규 보라/기존 연보라 누적, 월 클릭→지점별 갱신). ⚠️ **RPC 2개로 분리**(get_customer_visit_trend 월당1행 / get_customer_visit_branch 선택월 지점당1행) — 단일 RPC는 120개월×8지점×4≈3840행이 PostgREST 1000행 캡에 잘려 2022-08에서 끊기던 버그. 방문=매출발생(sales date), 신규=생애 첫 방문 달(지점무관), 외국인=customers.name에 한글 없음. (구 get_customer_visit_stats는 미사용)
- **고객 스크롤 2→1** (CustomersPage): DataTable 내부 maxHeight 제거 → 바깥 scrollRef 하나만 세로 스크롤.
- **카운트 필터 반영** (CustomersPage): 헤더 카운트가 검색·매장은 count=exact 서버 총원, **컬럼 ▼필터(excelFilters) 활성 시엔 필터된 개수**(custs.length) 표시. `_anyExcelActive` 판정 추가.
- **매출등록 차감 후 선불잔액** (id_23yjtpfsuk, SaleForm): "선불잔액 차감 -N" 아래 "차감 후 선불잔액: M원"(현재 잔액−오늘 차감) 표시 — 고객 잔여금 안내용.

### 서버 — 당일/전날 채팅 리마인더 010 손님 둘 다 발송 (2026-05-29, React 변경 0)
**요청**(정우님): 외국 손님(WhatsApp 등)이 010 연락처를 줬을 때, 카카오 알림톡(rsv_today/rsv_1day)만 가고 채팅 채널엔 안 가서 직원이 WhatsApp으로 수동 재발송하던 문제. "둘 다 보내라".
**진단**: 당일 리마인더 자체는 정상(카카오 rsv_today 오늘 43건 08:50 done, Tal도 카카오로 받음). 단 `_send_chat_reminders` **스킵②가 010이면 채팅 리마인더 전체 스킵**(카카오 중복 방지)이라, WhatsApp 손님이 채팅으론 못 받음. journalctl이 UTC라 09:00 KST 발송이 "00:00"으로 찍혀 처음엔 시각 오해.
**fix** (`bliss_naver.py` `_send_chat_reminders` 스킵②): 010이어도 **channel이 whatsapp/instagram/line이면 채팅 리마인더 발송(카카오+채팅 둘 다)**, **naver(네이버톡)만 010이면 스킵**(카카오와 둘 다 한국 채널이라 중복). 백업 `bak_pre_reminderdual_20260529_025627`, `systemctl restart bliss-naver`. 단 채팅 발송되려면 예약에 chat_channel 또는 고객 sns_accounts에 채널 연결이 있어야 함(수동 예약·미연결이면 여전히 카카오만).
**위임**: 키오스크 "예약 고객 선택" 화면에 손님별 QR 표시(폰으로 동의서 작성) → bliss-consent 세션(별도 레포).

### v3.7.894 — 예약모달 동의서/차트 상태 트랙 분리 + 미발송 방지 (2026-05-29)
**배경**(김경림 미수신 조사 결론): 동의서 발송 시스템·템플릿(UI_2146)·레코드는 정상(다른 고객 22건 발송 성공). 김경림은 `consent_doc` 큐가 **0건** — 즉 발송이 시작조차 안 됨. 원인 2겹:
1. **chartInfo가 동의서+차트를 한 덩어리로 봄** — status가 signed/sent/none 하나뿐. 당일 알림톡(rsv_today)이 자동으로 보낸 **차트**(`ct_condition_v2/v3`) 토큰 때문에 status=`sent` → 버튼이 **"동의서 재전송"**으로 잘못 표시(실제론 동의서 한 번도 안 보냄).
2. **"동의서 재전송" 버튼은 모달만 열 뿐** 재발송 아님. 모달에서 ①템플릿 선택 ②보내기 클릭을 안 끝내면 토큰·큐 0 + **에러도 없이** 닫힘 → "눌렀는데 안 갔다".
**fix** (`ReservationModal.jsx` + `ConsentModal.jsx`):
- **차트/동의서 트랙 분리** — chartInfo = `{ chart:{status,consent,tplIds}, doc:{...} }`. 분류 = 템플릿 폴더("신규차트&체크리스트"→차트 / "동의서"→동의서) + 이름 + ID패턴(`condition|eyelash|consent_full|chart`) 3중. 구버전 `ct_condition_v2`·비활성 템플릿도 정확히 분류(consent_templates 전체+folders fetch). `customer_consents.template_id/template_name`으로 작성본도 트랙 분류.
- **트랙별 독립 UI 동시 표시**: 작성완료=🟢깜빡칩(클릭→해당 문서 뷰어 포커스) / 발송됨=재전송 / 미발송=보내기. 예: 김경림 = 차트 표시 + **"동의서 보내기"** 동시.
- **재전송 = 이전 토큰 템플릿 미리선택**(`initialSelectedIds`=그 트랙 last token tplIds)으로 모달 오픈 → 한 번 더 확인 후 보내기(유저 결정).
- **미발송 방지**: ConsentModal `handleClose` — `!result && selectedIds>0`이면 "아직 보내기 전입니다…" confirm. 배경클릭·×·ESC 전부 가드. 발송 실패는 모달 alert(조용한 실패 제거).
- 뷰어: `docViewerFocus`로 클릭한 트랙의 작성본을 focusConsentId로.
**유의**: 분류는 폴더명 기준(멀티테넌트 안전). 차트가 `none`이면 "차트 보내기"도 노출(보통 rsv_today 자동발송이라 sent). 재전송 preselect가 비활성 템플릿이면 모달에 체크 안 보일 수 있음(차트 재전송 edge — 동의서는 활성 템플릿이라 정상).

### 서버 — 당일 늦은 예약 차트링크 알림톡 캐치업 (2026-05-29, React 변경 0)
**문제**: 당일안내(rsv_today, UI_1221~1228)에 차트 링크가 들어있지만 **09:00 KST 배치 1회만** 발송(`reservation_reminder_thread` `in_today_window`). 윤정현(당일 12:35 예약→14:00)처럼 **아침 배치 후 들어온 당일 예약은 차트 링크 누락** → 예약 모달 "차트 보내기"(미발송) 상태로 남음.
**fix** (`bliss_naver.py` `reservation_reminder_thread`, 백업 `bak_pre_todaycatchup_20260529_041914`): **새 카카오 템플릿 불필요**(검수 3~5일 회피) — 이미 승인된 UI_1221~1228 재사용. 캐치업 추가:
- `in_today_catchup = 09:11~21:00 KST` 매 폴링(5분)마다, `_process_window(today, "rsv_today", future_only=True, created_since=오늘09:10KST)` 호출.
- `created_since`(쿼리 `created_at=gte.{UTC ISO Z}`)로 **아침 배치 이후 생성된 당일 예약만** 조회 → 부하 최소(보통 0~수건).
- `future_only`: 시술 시작시간 30분+ 지난 예약 스킵.
- dedup `reservation_remind_log`(reservation_id+noti_key)로 **1회만**. 발송 시 차트 토큰(pf_) 발급 → 예약 모달이 자동 "차트 발송됨"으로.
**검증**: 재시작 후 첫 폴링(13:21 KST)에 윤정현(강남 14:00)+이진화(위례 16:30) 각 1통 발송 `done`, 차트 토큰 생성 확인. 데모 0건(격리). React 변경 0 → 버전업·CF퍼지 불필요.
**v3 정렬 완료** (2026-05-29, 백업 `bak_pre_v3chart_20260529_043747`): rsv_today 차트 토큰이 `["ct_condition_v2"]` 하드코딩이라 키오스크(v3)와 드리프트 + 신규고객도 컨디션만 받던 문제 → `_issue_pf_token(..., None, ...)`으로 변경해 내부 `_pick_chart_tpls(is_new_cust, same_day=True)` 사용. 활성 템플릿(`_active_chart_tpls`, is_active 기준 v3) 자동 추종 + 신규/기존 구분(당일+기존=컨디션 v3 / 당일+신규=신규차트+컨디션 v3). 모닝배치·캐치업 양쪽 적용. 기존 발송분(윤정현 v2 토큰)은 그대로 유효, 이후 신규 발송만 v3.

### v3.7.895 — 예약모달 차트/동의서 버튼 3상태 색 + 뷰어 이미지 렌더 fix (2026-05-29)
**① 버튼 라벨/색** (`ReservationModal.jsx` + `index.html`): "동의서·차트 작성완료" 긴 라벨 → **[차트] [동의서] 짧게 분리 + 색으로 상태 표현**:
- 작성완료(서명 들어옴) = **솔리드 녹색**(#059669) 채움, 클릭→작성본 뷰어
- 발송됨·미서명 = **녹↔회 교차 깜박**(`@keyframes docPendingBlink`, steps(1) 1.3s), 클릭→재전송
- 미발송 = **회색**(#E5E7EB), 클릭→보내기
- (기존 chart-done-blink 글로우는 미사용 — signed는 정적 솔리드)
**② 뷰어 이미지 렌더 fix** (`ConsentDocsViewer.jsx`): "작성완료 클릭 시 이미지 대신 'PDF 새 창에서 열기' 폴백"이 뜨던 버그. 원인 — v3.7.891 포팅 때 `page.render({ canvas, viewport })`로 바꿨는데 **pdfjs 5.7은 `canvas`만 주면 렌더가 안 끝남**(15초 타임아웃→폴백). **키오스크(bliss-consent, 검증됨)와 동일하게 `page.render({ canvasContext: canvas.getContext('2d'), viewport })`로 되돌림** → 이미지 정상 렌더. (워커는 bliss-app은 `?url` 유지 — `new URL(bare,…)`는 bliss-app Vite에서 무한로딩, aiDocs와 동일 방식)
**적용**: v3.7.895 라이브 배포(version.txt 검증, CF 퍼지 success). ⚠️ pdfjs 실제 래스터 이미지는 헤드리스에서 검증 불가 — 실 브라우저 1회 확인 권장(키오스크 동일 코드라 신뢰도 높음).

### v3.7.896 — 요청 처리: 직원 이동 시 근무시간 유지 + 최무성 마지막회차 태그 (2026-05-29)
- **직원 이동 시 출퇴근시간 바뀜** (강남 id_bwf2bxp0it, `TimelinePage.jsx`): 근무시간이 `empWorkHours[empId_지점_날짜]` 지점별 키로 저장되는데, 타지점 이동 시 그 지점 세그먼트의 시간 룩업이 **이동한 지점 운영시간으로 폴백**해 처음 설정한 시간(예: 홍대 10~20시)이 강남 운영시간으로 바뀌어 보임. v3.7.760이 base(empId/empId_date) 폴백은 넣었지만 **home(원소속) 지점 키 폴백이 빠짐**. fix: 3곳(`segHoursOf`·`getEmpActiveSegments`·이동/근무 팝업 근무시간 표시)의 폴백 체인에 `empWorkHours[empId_homeBid_date] || empWorkHours[empId_homeBid]`를 branchDefault 직전에 추가(additive — 기존 케이스 무영향, 타지점 이동 케이스만 원래 시간 유지). homeBid=BASE_EMP_LIST home branch.
- **최무성 ★마지막회차 태그 안 붙음** (강남 id_p3acru8wrh, 데이터): 최무성(#54464) 토탈 PKG 5회 중 4회 사용=1회 남음(마지막회차 맞음). 트리거·설정·데이터 다 정상이고 ★마지막회차는 최근 3일 4건에 정상 부착 중 — **시스템 문제 아님**. 원인=태그는 예약 분석 시점(13:44, 1회)에만 계산되고 그 후 회차가 줄어도 재평가 안 함(rescrape는 selected_services 있으면 재분석 skip). 예약 `kioom2xvq3` selected_tags에 `8vacfofam` 수동 추가. **미해결(한계)**: 예약 등록 후 회차가 마지막회차로 떨어지는 케이스 자동 갱신 — 추후 별도(서버 rescrape 시 auto_tag 재평가 또는 클라 live 계산).
**적용**: v3.7.896 라이브 배포(version.txt 검증, CF 퍼지 success). ⚠️ 직원이동 근무시간은 드래그 인터랙션이라 헤드리스 검증 불가 — 실제 이동(홍대→강남) 시 10~20시 유지되는지 확인 권장(additive 폴백이라 회귀 위험 낮음). 요청 2건 done + 답글.

### v3.7.897 — AI 답변추천 자동예약 가시화 (피드백 + 타임라인 포커스) (2026-05-29)
**배경**(정우님 보고): "AI 답변 추천"이 v3.7.864부터 예약 가능 상황이면 예약까지 자동 등록하는데, **화면에 아무 표시가 없어** 등록된 줄 모르고 또 등록 → 중복(Devona 5/30 잠실, 답변추천+자동응답 2건). 요구: ①세션연결 ②신규/기존 태그 ③자동등록 시 타임라인 블록 포커싱.
**진단**: ①세션연결은 이미 됨(예약 chat_channel/user_id + 고객 sns_accounts). ②신규 태그도 답변추천 경로(`manual=True`→`create_booking_from_ai`의 `_new_tags`)에선 정상 부착됨(중복분은 자동응답 경로라 is_new 오판). 진짜 빈틈 = ③ 시각 피드백 0 → 중복.
**fix**:
- **서버** (`ai_booking.py`+`bliss_naver.py`, 백업 `bak_pre_suggestout_20260529_063239`): `ai_booking_agent(out=None)` 추가. suggest_only 자동예약이 rid 만들면 `out['booking']={id,date,time,bid,branch_name,is_new,status,changed}` 채움(예약+지점 1회 조회). `/ai-suggest`가 `{ok,reply,booking}` 반환. 멱등은 기존 `create_booking_from_ai`(같은 채널·날짜·시간이면 existing 반환)로 커버 — 순차 재클릭 시 중복 안 생김.
- **클라** (`MessagesPage.jsx`, v3.7.897): `aiBooked` state. 답변추천 응답에 booking 있으면 입력창 위에 녹색 알림 "✅ 예약 등록됨 — MM-DD HH:MM 지점 (신규) [타임라인에서 보기]". 버튼 = `setPendingOpenRes({id,reservation_id,date,time,bid,status,_highlightOnly:true}); setPage("timeline")` → 그 블록으로 이동·반짝(v3.7.862 메커니즘 재사용). 기본·컴팩트 두 레이아웃 다. 대화 변경/리셋/발송 시 clear.
**Devona 중복 정리**: 신규 태그 정확한 답변추천분(`ai_27fnt7ozxp0k`, English speaker 메모 병합) 유지, 자동응답 중복분(`ai_4fd37ac77a38`) 삭제.
**적용**: v3.7.897 라이브 배포(version.txt 검증, CF 퍼지 success) + 서버 재시작. ⚠️ 인박스→타임라인 포커스는 헤드리스 검증 불가 — 답변추천 후 알림·버튼 실제 동작 확인 권장.

### 서버 — AI 예약: 기존/신규 물어보기 + 등록 연락처로 매칭 + 직원확인 메모 (2026-05-29, React 변경 0)
**배경**(정우님 보고): Devona(WhatsApp +17725770005)가 사실 기존 고객 "디보나" #53746(010-4419-1205, 7회)인데, 채팅 번호 ≠ 등록 번호라 AI가 **새 고객 중복 생성**. 외국 번호로 채팅하는 기존 고객 일반 문제.
**Devona 데이터 병합**: #53746(`cust_6a9ljtstg`)에 WhatsApp sns_accounts + phone2(+17725770005) 이전, 예약 재연결 + 신규태그 제거(기존고객), AI 중복레코드(`cust_ai_27fnt7ozxp0k`) 삭제. → 이후 Devona WhatsApp 메시지 #53746 자동매칭.
**AI 흐름 fix** (`ai_booking.py`, 백업 `bak_pre_existingask_20260529_064434`):
- 프롬프트 규칙 14 추가: 예약 정보(성별·연락처) 물을 때 **'처음/기존 방문 여부'도 함께** 질문. 기존이면 **등록 성함·연락처**를 받아 custName·custPhone에 + `existing_claim="true"`. (등록 번호로 검색 → 외국 번호 채팅이라도 기존 고객 연결, 중복 방지). 강요 금지·한 번만.
- JSON 스키마에 `existing_claim` 필드 추가.
- `create_booking_from_ai`: `existing_claim=true`인데 `_cust_created`(검색 실패로 새로 등록)면 → `schedule_log`에 "⚠ 기존 방문이라 하셨으나 검색 안 됨 → 새로 등록. 동일인 확인·병합 필요" 경고(예약모달에 노출, 직원 검토). 시술경고(_svc_warn)와 병합.
- 매칭 자체는 기존 `create_booking_from_ai`(phone/sns/name+phone)가 그대로 — 등록 번호 받으면 phone 매칭으로 연결.
**유의**: 서버 직접 패치(React 0 → 버전업·CF퍼지 불필요). 대화형 동작(AI가 기존/신규 자연스럽게 묻는지)은 실제 채팅에서 검증 권장 — 프롬프트 추가는 additive·메모는 _cust_created+existing_claim일 때만이라 회귀 위험 낮음.

### 서버 — AI 고객요약: 깨꼼=왁싱 인식 + 성격 텍스트→하트 (2026-05-29, React 변경 0)
**배경**(정우님): AI 분석이 매출메모 "깨꼼(브)"를 브라질리언으로 못 알아봐 "브라질리언 가끔"으로 과소집계. + 성격 "좋음"이 ❤️로 안 뜸.
**원인**: `gen_cust_summary`(ai_booking.py)의 ①`_SUMMARY_EXCLUDE`에 "깨끗꼼꼼"이 들어 있어 깨꼼(브) 브라질리언 매출이 시술 집계서 통째 제외 ②약어 사전에 깨꼼 없음 ③성격 파서가 "성격타입:[1-4]" 숫자만 인식("성격: 좋음" 텍스트면 ❤️ 못 붙고 💙 기본).
**fix** (백업 `bak_pre_summaryfix_20260529_071435`):
- `_SUMMARY_EXCLUDE`에서 "깨끗꼼꼼" 제거(실제 왁싱 시술명 → 집계 포함).
- 약어 사전에 `깨꼼/깨꼿꼼/깨끗꼼꼼=왁싱(괄호 부위 약어로 판단, '깨꼼(브)'=브라질리언)` 추가.
- 성격 파서에 텍스트 인식 추가: 좋음/착함/친절/순함=❤️, 무난/보통=🧡, 예민/까다=💛 (숫자 성격타입 1/2/3-4=❤️/🧡/💛는 기존, 없음=💙).
- Devona #53746 강제 재생성 → "시술: 눈썹, 브라질리언, 깨끗꼼꼼 / 특이: … / ❤️" 확인. (다른 고객 요약은 신규 방문/AI상담 시 lazy 재생성되며 점진 반영 — 일괄 재생성은 비용상 안 함)
**유의**: 성격타입→하트(❤️1/🧡2/💛3-4/💙없음)는 이미 구현돼 있었음 — 이번엔 텍스트도 인식하게 확장. "깨끗꼼꼼"이 부위 없이 단독 service_name인 매출은 요약에 '깨끗꼼꼼'으로도 표기될 수 있음(부위는 메모에만) — 브라질리언과 합치는 추가 튜닝은 별도.
- **후속(2026-05-29)**: 정우님 요청으로 깨끗꼼꼼/깨꼼을 '브라질리언'으로 펼치지 말고 **요약에 '깨꼼'으로 표기**(매장 통용명), 메모에 부위 약어 있어도 별도 '브라질리언' 항목 안 만듦. 백업 `bak_pre_kkaom_20260529_072158`. Devona 재생성 → "시술: 눈썹, 깨꼼 / … / ❤️" 확인.

### v3.7.898 — 요청 4건: 플로팅 팝업 제거 / 외국어 네이버정보 번역 / 등록줄 정리 / AI요약 재생성 (2026-05-29)
- **① 우상단 신규예약·확정대기 플로팅 팝업 제거** (id_t3z46erh6e, `AppShell.jsx`): 네이버 신규예약 Realtime 시 생성하던 `top:20px;right:20px` 플로팅 div 제거(예약 state 추가는 유지). 알림은 상단 막대배너(TimelinePage 확정대기/신규고객)로만.
- **② 외국인 네이버 예약정보 한국어 번역** (id_b6rafsw34s): 일본어 등 외국어 request_msg를 한국어로. 서버 신규 엔드포인트 `/translate-ko`(translate_to_korean 래퍼, 백업 `bak_pre_transko_*`) + `ReservationModal` 네이버정보 박스에 "한국어 번역" 버튼(외국어 감지 시 노출, `/translate-ko` 호출→번역 블록 표시). on-demand(자동 아님)로 비용 최소.
- **③ '등록' 줄 글꼴/이모지** (id_1r9e13kbxj, `ReservationModal`): 등록 시각·일정변경 로그의 `monospace` 폰트 제거(블리스 기본 폰트) + 로그 줄 앞 달력/시계 이모지(📅🗓⏰ 등) 표시 시 제거(⚠ 경고는 유지). 등록 라벨은 기존 I 캘린더 SVG.
- **④ AI요약 특이사항·성격 누락** (id_kqn9z84uxr, 서버): 대부분 고객이 옛 형식 요약(특이·하트 없음)이라 누락돼 보임. 코드(깨꼼 인식·특이 요약·성격 하트)는 직전 fix로 정상 — **근래(오늘~+2일) 예약 고객 요약을 신규형식 아닌 것만 재생성**(env 로드 sudo 스크립트, CAP 150, 신규형식은 스킵). 나머지는 방문/상담 시 자동 갱신(비용상 전체 일괄 안 함, feedback_bliss_avoid_bulk_paid_api).
**적용**: v3.7.898 라이브(version.txt 검증, CF 퍼지 success) + 서버 `/translate-ko` 재시작. ⚠️ 헤드리스라 번역버튼·팝업제거는 실제 화면 확인 권장.

### v3.7.899 — 요청 후속 3건: 네이버정보 자동번역 / 등록 아이콘 제거 / 요약 self-heal (2026-05-29)
정우님 후속(Tal Achvat #55734) — ①번역을 버튼 말고 자동으로 ②등록줄 이모지 여전히 보임 ③분석에 특이·성격 여전히 없음.
- **① 외국어 네이버 예약정보 자동 번역** (`ReservationModal`): 버튼 제거 → **모달 열 때 외국어 감지 시 자동 `/translate-ko` 호출**, sessionStorage(`naverko_{rid}`) 캐시로 재호출 비용 방지. 번역 중엔 헤더에 "한국어 번역 중…", 완료 시 번역 블록 표시.
- **② 등록 줄 달력 아이콘 제거**: 등록 줄의 `<I name="calendar">` SVG 제거(글꼴은 v3.7.898에서 monospace 제거 완료). 이제 "등록  날짜"만.
- **③ AI요약 특이·성격 self-heal**: 서버 신규 `/regen-summary`(gen_cust_summary force, 백업 `bak_pre_regenep_*`) + 모달 열 때 요약이 **옛 형식(시술:/하트 없음)이면 자동 재생성**→표시·data 동기화. 완료 예약(배치 제외분)·미방문 고객도 **열람 시 자동 갱신**(view-triggered self-heal, 빈값은 서버 lazy). 전체 일괄 안 함(비용).
**적용**: v3.7.899 라이브(검증, CF퍼지 success) + 서버 `/regen-summary` 재시작.

### v3.7.900 — AI 분석 호버 시에만 표시 (고객 민감정보 보호) (2026-05-29)
정우님: AI 분석에 고객 은밀한 특이정보(부위 등)가 너무 적나라하게 노출됨. `ReservationModal` AI 분석 박스 — 기본 `filter:blur(7px)`+`userSelect:none`로 가림, 헤더에 "👁 올리면 보기" 힌트. `aiReveal` state를 onMouseEnter(호버) 시 true / onMouseLeave 시 false, onClick 토글(터치 대응). 호버/탭 시에만 선명하게. 적용: v3.7.900 라이브.

### v3.7.901 — 시술 선택 검색창 (예약모달 + 매출입력) (2026-05-29)
정우님: 시술상품 옆 검색창으로 바로 검색, 매출입력 카테고리도 검색.
- **ReservationModal 시술상품 드롭다운**: 패널 상단에 검색 input(`svcSearch`) — 이름·카테고리 즉시 필터. 검색 중엔 보유패키지 블록 숨김 + "검색 결과 없음" 표시. (SVC_LIST.map을 필터된 _list로)
- **SaleForm(매출입력) 시술 섹션**: "시술 (N)" 헤더 아래 검색 input(`svcSearch`) — `catGroups`·`uncatSvcs`의 svc를 이름으로 필터(`_svcMatch`), 빈 카테고리는 자동 숨김, **검색 중엔 매칭 카테고리 자동 펼침**(isOpen=_svcQ?true:isCatOpen). 결과 없으면 "검색 결과 없음".
**적용**: v3.7.901 라이브(version.txt 검증, CF 퍼지 success). React only. 헤더 검색 1개로(각 카테고리별 다중 검색창 대신 — 카테고리 가로질러 필터+자동펼침이 더 편함).

### v3.7.903 — 코드 점검 추천 묶음: 번들 경량화 + bank_deposits 통합 + 죽은코드 정리 (+ 서버 RAG 게이팅) (2026-05-29)
전체 코드 점검(읽기전용 감사 확장 — 서버부하·퍼포먼스·AI모델·프롬프트·버그/독소코드 6영역) 후 "즉효·저위험 묶음" 적용. React 3건 v3.7.903 배포 + 서버 1건 라이브.
- **② pdfjs 정적→동적** (`aiDocs.js`): `import * as pdfjsLib`/worker 정적 import 제거 → `extractPDF()`에서 `_getPdfjs()` 동적 import(모듈 1회 로드 캐시). **메인 번들 2,373→1,822KB**(gzip 606→521), pdfjs는 `pdf-*.js`(458KB)+worker(1.23MB)로 분리 → 학습문서 PDF 파싱 때만 로드. mammoth/xlsx/jszip(v3.7.743)과 동일 패턴, ConsentDocsViewer는 이미 동적이라 무관.
- **④ 죽은 파일 9개 삭제** (importer 0개 직접 재확인): `lib/translator.js`·`lib/useReservations.js`·`lib/groq.js`·`Chat/mockData.js`·`pages/LoginPage.jsx`·`Admin/{TagSettings,WorkerSettings,BranchSettings,ServiceSettings}.jsx`. ⚠️ `AuthContext.jsx`는 main.jsx가 import → 살아있음(삭제 안 함). `{false&&}` 숨김 블록도 유지(의도된 것).
- **① bank_deposits 4중복 → 단일 소스 통합**: 같은 "미매칭 입금 count"를 4곳(AppShell 배너+사이드바 배지, MessagesPage 탭 배지, BankDeposits 탭)에서 따로 페치하던 것 → AppShell 배지 effect를 단일 소스로(count+latest 산출, `depositLatest` state 추가), `DepositsAlertBanner`는 표시전용(props `count`/`latest`), MessagesPage 배지는 `depositPending` props 소비(자체 폴링 제거, `onDepositChange` 로컬 즉시갱신 유지). **Realtime 채널 3→1, 폴링 4→1**(BankDeposits 탭은 열렸을 때만 1채널 유지). 2026-05-23 커넥션풀 고갈 부하 경감(근본해결=schedule_data 7채널 통합, 별도 묶음).
- **③ (서버 ai_booking.py, React 무관) RAG 게이팅**: `docs_block = _rag_search_docs(user_msg)`가 "네/감사/ok/👍" 등 인사·확인 메시지에도 매번 임베딩+match_documents(~0.5초) 호출하던 것 → `_rag_should_search(msg)` 게이트(질문`?`·주제어·긴 메시지는 검색, 짧은 인사·확인만 스킵, 애매하면 검색·graceful 폴백). 자동응답 응답속도↓. 게이트 20/20 스모크 PASS. 백업 `ai_booking.py.bak_pre_raggate_20260529_224734`, `systemctl restart bliss-naver`(active). 서버 변경이라 버전업·CF퍼지 무관.
- **검증**: 로컬 dev(데모 로그인) 부팅→타임라인→메시지함→입금문자 전경로 콘솔에러 0. 빌드 OK(삭제 9파일 깨진 import 0). 라이브 version.txt=3.7.903, CF 퍼지 success.
- **점검 결과 미착수 묶음(다음 후보)**: ⓐ Realtime `schedule_data` 7채널(TimelinePage 5+useData 2)→1 통합 ⓑ TimelinePage `allRooms`/`blocks`/`naverAssignments` useMemo+`React.memo`+가상화(렌더 핫스팟) ⓒ `select=*` 컬럼축소(loadReservations ~10MB) ⓓ AI 모델·비용 A/B(Gemini 3.5 Flash 출력비 $9/M=직전 3배) + **Claude 폴백 ~6/1 사용한도 차단(최후 안전망 없음)** 해소 ⓔ fire-and-forget DB쓰기(handleSave 2653·confirmChange 3556·SaleForm 패키지생성 2731/2783/2876·고객INSERT 2568·CustomersPage 931) await화 — 결제·보유권 유실 방지(High). 보고서 `CODE_AUDIT_2026-05-29.md`.

### v3.7.904 — 데이터 유실 버그 차단 + 타임라인 렌더 메모이즈 (코드점검 2차) (2026-05-29)
코드점검 후속 — 데이터 유실 + 렌더 최적화 "안전 묶음"만 적용. (Realtime 채널통합·allRooms 메모이즈는 핵심화면 검증 한계로 별도 집중작업 보류)
- **데이터 유실 (SaleForm)**: ① 신규고객 매출 시 `customers` INSERT가 `.then().catch` fire-and-forget이라, 실패해도 `cust.id`로 매출이 계속 진행돼 **존재하지 않는 고객을 가리키는 고아 매출**이 생기던 버그 → **await + 실패 시 매출 중단**(showAlert). ② 보유권(다담/다회/연간) 생성 insert 3곳 `.catch(console.error)` → `_dbWarn("보유권")` 헬퍼(비차단 사용자 알림) — 결제했는데 보유권 DB 누락을 직원이 인지·재확인 가능.
- **렌더 최적화 (TimelinePage, 의존성 명확한 것만)**: `SVC_LIST`·`allBranchList`·`accessibleBids`·`branchesToShow` useMemo화 + **2만행 reservations 날짜 스캔을 `todayReservations` useMemo(`[data?.reservations,selDate]`)로 분리** → 드래그·알람틱 등 잦은 리렌더에서 전체 재스캔 방지. blocks는 todayReservations에서 필터(동작 불변).
- **검증**: 로컬 dev(데모) — 타임라인 렌더 + 날짜이동(29↔30) 시 블록 정확 갱신 + 콘솔 에러 0. 빌드 OK. 라이브 3.7.904, CF 퍼지 success.
- **보류 (별도 집중작업 — 핵심화면 검증 한계)**: ⓐ `allRooms`→`blocks`→`naverAssignments` 메모이즈(드래그 부드러움 효과 크지만 `getWorkingStaff`/`getEmpOverride`/`normalizeSegments`/`getEmpActiveSegments`/`getEmpBaseHours`/`parseSupportBranch`/`sortStaffByOrder` 7개 클로저 전이 의존 — schHistory·empOverride·empWorkHours·reservations·empList·extraCols·naverColShifts·empColOrder 중 1개라도 deps 누락 시 타임라인 stale) ⓑ schedule_data Realtime 6채널(notices·employees·schHistory·extraCols·naverColShifts·empColOrder)→1 통합(6핸들러 단일 디스패치 — 실시간 라우팅 검증 필요, 실패 시 120s 폴링 폴백이라 soft). 둘 다 프로파일링/실시간경로 검증 가능한 세션에서.
- **안 건드린 것**: 정렬·토글·태그생성 등 fire-and-forget ~40곳은 실패해도 복구되는 무해 케이스라 의도적으로 유지.

### v3.7.905 — Realtime schedule_data 6채널→1 통합 + (서버) 콜라보 게이트·AI 정확도 감사 (2026-05-30)

#### Realtime 채널 통합 (TimelinePage, React) — 2026-05-23 커넥션풀 장애 대응
- TimelinePage가 schedule_data를 **6개 채널**(tl_notices·employees_all_rt·schedule_data_rt·extra_cols_rt·naver_col_shifts_rt·emp_col_order_rt)로 따로 구독하던 것 → **단일 채널 `schedule_data_all_rt`** 로 통합. **디바이스당 schedule_data 채널 6→1 (−5)**.
- 방식: `schRtRef`(useRef) 레지스트리 — 각 effect가 채널 생성 대신 `schRtRef.current["<key>"]=loader` 등록(채널·unsubscribe 제거, 폴링 폴백은 유지). 단일 채널이 `business_id=eq.{biz}` 필터로 전 키 수신 후 `payload.new.key`로 dispatch. dispatch가 payload 전달 → schHistory의 `onSchChange(payload)`도 호환, 나머지 loader는 인자 무시.
- 등록 7키: bliss_notices_v1 / employees_v1·empSettings_v1(reload 공유) / schHistory_v1 / extraCols_v1 / naverColShifts_v1 / empColOrder_v1.
- **검증**(로컬 dev 데모): 타임라인 렌더·날짜이동 정상, 콘솔 에러 0, `getChannels()` 확인 — 구 6채널 0개·신규 1채널 **state="joined"**(실시간 구독 성공). 폴링 폴백(30s/120s/300s) 그대로라 라우팅 누락 시에도 soft. 라이브 v3.7.905, CF 퍼지 success.
- **유의**: 단일 채널은 전 schedule_data 키를 수신해 클라에서 key dispatch(미등록 키 무시). maleRotation 등 다른 키는 각자 채널(useData/useMaleRotation)이 처리 — 중복 없음. `let channel/empCh = null` 일부 미사용 잔재는 무해(빌드 정상).

#### (서버 ai_booking.py, React 무관, 이미 라이브) 콜라보 게이트 작별·거절 인식
- 버그: `_outbound_collab`(매장이 콜라보 언급한 적 있는 thread)이면 손님이 거절·작별("Will do! Thanks", "지금 한국에 없어요")해도 **매 메시지에 "마케팅 담당자 연락" 반복**(swanxdiary 사례 — 정확도 감사 매 회 등장).
- fix: `_outbound_collab` 분기에 `_bye`(작별·감사·거절 키워드) + `_engage`(방문·수락·예약 의사) + `_is_q`(질문) 판정 추가 → **작별·거절이고 질문/방문의사 없으면** 마케팅 반복 대신 가볍게 마무리("감사합니다! 언제든 연락 주세요"/"Thank you! Take care"). 수락·질문은 기존 마케팅 안내 유지.
- 검증: 정확도 감사에서 swanxdiary(작별) 2→5점, uni.korea(콜라보 수락) 5점 유지. 서버 직접 패치 + `systemctl restart`(active). 백업 `ai_booking.py.bak_collabfix_*`. React 변경 0 → 버전·CF 무관.

#### (서버) AI 자동응답 정확도 감사 — 도구 구축 + 결론
- **`_ai_accuracy_audit.py`**(서버 보존, 재사용): 실제 최근 대화를 **production-replica**(실제 account/user/channel → 기존예약·세션기록 실데이터 조회, `_load_history` monkeypatch로 잘라낸 대화, 쓰기 전부 mock=부작용0)로 운영 에이전트가 답하게 → **봇이 실제 받은 전체 프롬프트를 심판(무료 Gemini)에게 주고** 사실 정확도 채점. 비용 0.
- **결론**: 진짜 production 정확도 **≈4.0~4.3/5**(27건 중 21~25건 정확). 무료 Gemini 3.5 Flash로 양호. **프롬프트는 이미 한계** — 강화 2라운드(환각차단·과확정/작별) 무효(심판 노이즈 ±0.2가 개선폭보다 큼). 처음 본 "환각" 다수는 심판 오판(첫방문가·매장명·FAQ·기존예약 미인지)이었고 심판 보강하니 사라짐(=프롬프트가 이미 처리 중). 남은 갭=테스트 아티팩트(과거 대화를 오늘로 재생)+심판 노이즈+콜라보 게이트(위 fix). **정확도 향상의 핵심 레버는 비싼 모델이 아니라 프롬프트/데이터/게이트** — 비용 안 써도 됨(정우님 직감 맞음).
- 미배포(검증 한계로 보류): allRooms 체인 메모이즈(드래그). 향후 `_ai_accuracy_audit.py`로 변경 후 재측정 가능.

### v3.7.906 — reservations 전체 재fetch throttle (모바일 중복 10MB fetch 방지) (2026-05-30)
- `AppShell` `onVisible`(앱 포그라운드 복귀)·`onOnline`(재연결) 핸들러가 **매번 30일 전체 reservations(~10MB, default `select=*`) 재fetch**하던 것 → **60초 throttle** 추가(`lastResFull` 공유 변수). 60초 내 이미 전체 동기화했으면 스킵 — 모바일 PWA 앱 전환·짧은 끊김마다 ~10MB 중복 fetch 방지. 그 사이는 reservations RT 구독 + 120s 폴링(최근 3일)이 커버 → 데이터 동기화 손실 없음. >60초 백그라운드 후엔 정상 전체 재동기화.
- **검증**(로컬 dev): visibilitychange·online 3회씩 발생시켜도 `/reservations?` fetch 수 2→2 (스킵 정상). 부팅·렌더·콘솔0. 라이브 3.7.906, CF 퍼지 success.
- **`select=*` 컬럼 축소는 보류(안전한 빠른 win 아님)**: 가장 큰 컬럼 `request_msg`(네이버 원문)가 **타임라인 블록 표시**([TimelinePage.jsx:5488](src/components/Timeline/TimelinePage.jsx:5488), 긴 예약)·ReservationModal·ReservationsPage 검색에 모두 사용됨 → 대량 로드에서 드롭하면 네이버정보 표시 깨짐. 안전히 하려면 "30일 대량 로드는 request_msg 제외 + 당일/검색은 포함"하는 per-day-fetch 리팩토링 필요 + 실 네이버데이터 검증 필요(데모엔 없음). 커넥션풀(장애 원인)은 채널통합으로 이미 해결됐고 이건 egress 최적화라 별도 신중 작업으로 분리.

### v3.7.907 — 직원 완전이동 시 home지점 유령 잔여컬럼 버그 fix (지점별 근무시간 상이) (2026-05-30)
**증상**(정우님, 령은): 천호 직원을 잠실로 종일 이동시켰는데 — 타임라인/이동창에 **천호 컬럼이 21:30~22:00 유령 잔여**로 남고, 근무시간이 12:00~22:00로 잘못 표시되며 이동 창에 잠실+천호로 split 표시.
**근본원인**(령은 실데이터 Supabase 직접 조회로 확정): 령은은 **지점별 근무시간이 다름** — 천호 `empWorkHours`=12:00~22:00, 잠실=11:30~21:30. 5/30 override=`[{잠실 11:30~21:30}]`(완전이동, home세그먼트 없음, exclusive 플래그 없음). `getWorkingStaff`의 home지점 처리(else/지원 분기)가 override에 home세그먼트가 없어도 `getEmpActiveRange(home)`로 **시간 mismatch에서 생긴 잔여구간(잠실 끝 21:30 ~ 천호 근무끝 22:00)**을 계산 → 천호 컬럼에 령은을 다시 표시. 그 컬럼에서 이동창 열면 근무시간이 천호값(12:00~22:00)으로 뜨고 `visualSegs`가 21:30~22:00을 home으로 또 채움.
**fix**([TimelinePage.jsx:995](src/components/Timeline/TimelinePage.jsx:995) getWorkingStaff): home지점 처리에서 `const hasHomeSeg = ov.segments.some(s=>s.branchId===branchId)` 추가 → `if (exclusive || !hasHomeSeg)`로 **override에 home세그먼트가 아예 없으면(=완전이동) home 컬럼 제거**(exclusive와 동일 취급). 지원(부분이동)은 `doAdd`가 home세그먼트를 명시 포함하므로 영향 없음(hasHomeSeg=true → 기존 로직). 완전이동은 home세그먼트 미포함 → 시간 mismatch와 무관하게 home 잔여 안 띄움.
**검증**: 령은 전 override 날짜 교차검증(5/20·5/23 지원=home세그有 정상, 5/30·6/9·6/10 완전이동=home세그無 → home제거 정상). 데모 타임라인 무회귀 + 콘솔0. 라이브 3.7.907.
**유의**: override 있는 직원 중 home세그먼트 없는 완전이동만 영향. 일반(override無)·지원(home세그有) 무영향. request_msg 데이터 변경 안 함(코드만). 잠실 컬럼 이동창은 잠실 근무시간(11:30~21:30) 정상 표시.

### v3.7.908 — 직원 이동/근무 팝업 1차 정리 (공통 케이스 단순화, 안전 즉효) (2026-05-30)
**배경**: 정우님 UI 평가 요청 → 팝업이 ~550줄 인터랙티브 위젯(드래그 분할 바·페이더, 이동방식 4개 혼재, 시간 3중복)이라 전체 재설계는 위험·검증한계로 **집중 세션**에 분리. 이번엔 **안전 즉효(공통 케이스 정리)만** (정우님 선택).
- **이동 없는 직원 = 깔끔하게**: `getEmpMovePopup` 세그먼트 IIFE에서 `hasRealMove = segs.some(s=>s.branchId!==baseBranch)` + `showMoveUI = hasRealMove || empMovePopup.expandMove` 추가 → **실제 이동 없으면 시각 바·세그먼트 행·이동추가 폼 전부 숨기고 `[+ 다른 지점으로 이동]` 버튼만** 표시(클릭 시 expandMove로 편집기 펼침). 시간 3중복(상단 근무시간/바/세그먼트행)·빈 이동폼·장식 바 제거. **인터랙티브 바·페이더·세그먼트편집·이동추가·저장/취소·오늘휴무 로직은 전부 보존**(렌더만 조건부 — `{showMoveUI ? <>...</> : <버튼/>}`).
- **이모지 → 제거**: `타지점 종일 근무`의 🧳 제거(이모지 금지 규칙). 
- **검증**(로컬 dev 데모): 하늘(이동없음) 팝업 → 바/세그먼트/폼 숨김 + "+ 다른 지점으로 이동" 버튼만, 콘솔0. 버튼 클릭 → 편집기(바·세그먼트·이동추가) 정상 등장. 라이브 3.7.908, CF 퍼지 success.
- **보류(집중 세션)**: 인터랙티브 바/이동 흐름 **전체 재설계**(체크박스+바+세그먼트행+이동추가폼 4중복 → 단일 흐름 통일) · 담당자교체 접기 · 모바일 터치 드래그 검증 · 작별/거절 등 UX. 데모에 다지점 이동 시나리오 세팅 후 진행 권장.

### v3.7.909 — 직원 이동/근무 팝업 시각 정리 (가로 sprawl·작은 글자) (2026-05-30)
**배경**(정우님): "쓸데없이 가로로 너무 길고 글자 너무 작다, 안 예쁨". 로직 재설계 아닌 **타이포·레이아웃만**(저위험).
- **근무시간 드롭다운 sprawl 제거**: `selSt` `flex:1`(폭 꽉 채움, 값 좌측·화살표 우측 빈 가운데) → `flex:"0 1 auto" + minWidth:92 + fontSize:14 + padding 7/11` → `[11:00] ~ [21:00]` 좌측 컴팩트 묶음.
- **글자 키움**: 라벨(근무시간·담당자교체·이동추가) 10→12~12.5px, 세그먼트 행 드롭다운 selSt 10→12px. 담당자교체 라벨 아이콘 10→12.
- **검증**(로컬 dev 데모, 정우님 요청으로 컨펌은 생략·자체 화면확인): 하늘 팝업 근무시간 컴팩트+큼·라벨 읽기 좋아짐·콘솔0. 라이브 3.7.909, CF 퍼지 success.
- **유의**: 인터랙티브 바·이동 로직 안 건드림(스타일만). 전체 재설계는 위 v3.7.908 보류 항목 그대로.

### v3.7.910 — 직원 이동/근무 팝업 재설계 1차: 10분 통일 + 바 크게 (2026-05-30)
**배경**: 정우님이 v3.7.909(글자 크기만)에 "큰 차이 못 느끼겠다, 차라리 피그마에 넣고 수정받자" → Figma 계정이 **View 좌석(편집 불가)**이라 거기서 작업 불가 → 대신 **재설계 시안을 이미지로 제작·제시**(mockup HTML→Chrome headless 스크린샷, before/after). 정우님 시안 승인 후 "일단 배포해봐".
**방침**: 위젯(~550줄, 드래그·페이더·insertAt·저장 로직 얽힘)을 한 번에 갈아엎으면 직원 근무배치 마비 위험 → **로직(저장·드래그·세그먼트 계산) 무수정, 시각·시간단위만** 시안에 맞춤(집중세션 보류건의 안전 1차).
- **시간 10분 통일**(5분/30분 혼재 → 10분): 근무시간 `hours`(`*12+1,(i%12)*5`→`*6+1,(i%6)*10`), 구간편집 `TIME_OPTS`(`24*12,(i%12)*5`→`24*6,(i%6)*10`), 이동추가 from/until(`48,(i%2)*30`→`24*6,(i%6)*10`). 정우님 "직원시간 10분단위" 요구.
- **시각 바 크게**: height 26→44, radius 6→8. 구간 라벨을 지점명(12.5px)+시간(9.5px) **2줄**로(기존 지점명만 10px). 좁은 구간 라벨 자동 생략(w>9 이름, w>13 시간).
- **발견**: 바 드래그(razor)로 이동구간 추가 + 페이더 핸들로 경계 조정이 **이미 구현돼 있음** → 시안의 "바 중심"이 기술적으로 이미 됨.
- **검증**(로컬 dev 데모, [TimelinePage.jsx:4335+](src/components/Timeline/TimelinePage.jsx:4335)): 빌드 OK·콘솔0·근무시간 옵션 10분 간격(10:00·10:10·10:20…) 확인·바 44px+2줄 라벨("강남데모 11:00~21:00") 확인·이동 없는 직원은 "+ 다른 지점으로 이동" 버튼만(v3.7.908 단순화 작동). **데모는 단일 지점(강남데모)이라 2구간(두 색) 바는 검증 불가 → 라이브 실제 이동(령은 등)에서 확인 필요**.
- **다음 단계(보류)**: 시안의 "구간목록 드롭다운행 + 이동추가폼 제거 → 바 드래그 only 통일"·담당자교체 접기·섹션 순서(저장 푸터로)·모바일 터치 드래그 검증. 라이브 다지점서 드래그 안정성 확인하며 단계적. 정밀 시간편집(드롭다운) 제거는 신중.
- **mockup 도구**: 시안은 `bliss-app/mockup/index.html`(임시, git 미포함) + `/Users/cripiss/TP005/.claude/launch.json`에 정적서버 `mockup`(port 8899) 등록. Chrome headless `--screenshot`으로 이미지화(playwright 브라우저 미설치라 chrome 사용).
- 배포: v3.7.910 라이브(version.txt 검증, CF 퍼지 success).

### v3.7.911 — 직원 이동/근무 팝업 재설계 2차: 담당자교체·이동추가 폼 접기 + 근무시간 큰 칩 (2026-05-30)
**배경**: v3.7.910(10분+바) 배포 후 정우님 "뭐야 바뀐 게 없잖아"(민정 단일 강남점 화면 캡처) — 바·시간만 건드리고 정작 눈에 띄는 **담당자교체 노란박스·이동추가폼**이 그대로라 체감 0. 시안처럼 "걷어내기".
- **담당자 교체 접기**: 상시 노란박스(맨 위 차지) → **접힘 토글**("담당자 교체 (예약 N건) ▾", 기본 접힘·펼치면 노란배경). `empMovePopup.showReplace`. select·스왑 로직 그대로.
- **이동 추가 폼 접기**: 지점/시작/종료 select 3줄 상시노출 → **접힘 토글**("+ 직접 시간 지정 추가 ▾", 기본 접힘). `empMovePopup.showAddMove`. 바 드래그(razor)가 주 추가수단, 이 폼은 정밀입력 백업.
- **근무시간 큰 칩**: selSt fontSize 14→16·weight 600→700·padding 7/11→9/13·minWidth 92→100.
- 로직(저장·드래그·세그먼트·스왑·추가) 전부 무수정, 렌더 조건부+스타일만.
- **검증**(로컬 dev 데모): 빌드 OK·babel PARSE_OK·근무시간 16px·이동추가 "직접 시간 지정 추가" 접힘헤더·이동폼 select 숨김(selectCount 4=근무2+구간2)·바 존재. 담당자교체 접힘은 코드 적용(유진 예약없어 미표시). ⚠️ **데모 단일지점이라 2구간 바·담당자교체 실제 모습은 라이브 예약있는 직원(민정 등)에서 확인 필요**.
- **삽질 메모**: 5 Edit 후 첫 `vite build`가 rolldown 에러(dist 충돌 일시) → `rm -rf dist && build`로 exit=0. babel parser PARSE_OK로 syntax 무결 입증. HMR은 stale 누적(에러로그 남음)이라 reload+eval로 검증.
- 배포: v3.7.911 라이브(version.txt 검증, CF 퍼지 success).
- ⏸️ 남은: 드롭다운 구간행→칩(정밀편집 바로 이관 신중)·섹션순서(저장 푸터로—commitDraft 스코프라 위험)·모바일 터치드래그 검증.

### v3.7.912 — 직원 이동/근무 팝업 재설계 3차: 시간눈금 + 섹션라벨 + 드롭다운행→칩 (2026-05-30)
**배경**: v3.7.911 후 정우님 "니가 준 시안하고 너무 다르잖아"(현아 홍대 단일구간 캡처). 차이 — ① 현아는 이동 없어 바 한 색(시안 두 색은 실제 이동 케이스) ② 시안에 없던 드롭다운 시간행 잔존. 시안 핵심 시각요소 입힘.
- **시간 눈금**: 바 위 `11 13 15 17 19 21`(근무시간 범위 균등, ~2시간 간격 자동 step). 시안 핵심 요소.
- **섹션 라벨**: showMoveUI 블록 상단 "근무 지점 · 이동"(보라).
- **드롭다운 구간행 → 칩**: 색점+지점명(13.5px 굵게)+시간텍스트(`11:00 ~ 21:00`)+[기본 근무 / ×삭제]. select 제거. **시간 미세조정은 바 드래그(10분 스냅)·페이더로**. removeSeg(×)·바 드래그(updateSeg) 로직 그대로, 정밀편집 select UI만 제거.
- 로직(저장·드래그·세그먼트·페이더) 무수정, 렌더만 교체.
- **검증**(로컬 dev 데모, eval+스크린샷 뷰포트 1280x1600): 빌드 OK·babel PARSE_OK·섹션라벨·시간눈금row·기본근무칩·이동추가접힘·바 존재·**selectCount 2**(근무시간만, 구간 select 0=칩 적용). 유진 팝업 시안 근접 확인. ⚠️ 데모 단일지점이라 2구간 두 색 바·담당자교체는 라이브 확인.
- 배포: v3.7.912 라이브(version.txt 검증, CF 퍼지 success).
- ⏸️ 남은(시안과 잔여 차이): 타지점 종일근무 체크박스(시안엔 없음)·푸터 한 줄 통합(저장 commitDraft 스코프라 위험)·2구간 두 색 바(이동 직원 라이브 확인).

### v3.7.913 — 직원 이동/근무 팝업 재설계 4차: 헤더 2줄 + 종일근무 체크 제거 + 푸터 통합 (2026-05-30)
**배경**: v3.7.912 후 정우님 "버튼 위치/디자인 시안과 다르다, 시안대로 다 똑같이 왜 안 해". 부분수정 중단, 시안(shot3) 레이아웃에 정렬.
- **헤더 2줄**: "{staffId} · 직원 이동/근무" 한 줄(12px) → 이름(16px 굵게) + "직원 이동 · 근무"(11.5px) 2줄.
- **타지점 종일근무 체크박스 제거**: 시안에 없음. 종일 이동은 이동추가 폼(지점 선택+시간 비움)으로. 관련 변수(isDayMove·onDayMoveToggle 등)는 미사용으로 남김(무해). "10분 단위" 안내 추가.
- **푸터 통합**: 흩어진 [취소][저장](segments IIFE) + [오늘 휴무](별도 블록) → **`[오늘 휴무][취소][저장]` 한 줄**(segments IIFE 푸터). 휴무 핸들러를 푸터 버튼으로 옮김, 기존 휴무 블록 제거. commitDraft/cancelDraft 스코프 유지 위해 푸터를 segments IIFE 안에 둠.
- **검증**(로컬 dev 데모, eval+스크린샷 1280x1600): 빌드 OK·babel PARSE_OK. 유진 팝업 = 헤더2줄·근무시간 큰칩+10분단위·종일근무체크 없음·섹션라벨·눈금·바·칩·이동추가접힘·**푸터 한 줄**. 시안 거의 일치 확인.
- 배포: v3.7.913 라이브(version.txt 검증, CF 퍼지 success).
- ⏸️ 남은(시안 잔여 차이): **담당자 교체 위치**(예약 있을 때 근무시간 다음 표시 → 시안은 푸터 위. segments IIFE 안으로 이동 필요, 데모에 예약직원 없어 검증 제약)·2구간 두 색 바(이동 직원 라이브 확인).

### v3.7.914 — "타지점 종일 근무" 체크박스 복구 (v3.7.913 회귀 fix) (2026-05-30)
**배경**: v3.7.913에서 "시안에 없다"고 타지점 종일근무 체크박스를 제거했으나, 정우님 "차지점 종일 근무가 왜 사라졌지" — 직원을 오늘 다른 지점으로 통째 보내는 **필수 기능**(시안이 단순화하며 빠뜨린 것). 즉시 복구.
- 근무시간 IIFE 안(근무시간 select 다음)에 체크박스 + 지점 select 원복. 폰트 키움(11→12.5/13). 변수(isDayMove·onDayMoveToggle·dayMoveBid·onDayMoveBranchChange)는 v3.7.913에서 렌더만 제거·정의는 유지했어서 그대로 재사용.
- **교훈**: 시안(mockup)은 기능 단순화본 — 시안에 없다고 실제 기능을 제거하면 안 됨. 시안은 레이아웃/디자인 참고용, 기능은 보존.
- 검증: 빌드 OK·babel PARSE_OK. 배포: v3.7.914 라이브(version.txt 검증, CF 퍼지 success).

### v3.7.915 — 직원 이동/근무 팝업 재설계 5차: 라이브-시안 1:1 정렬 (담당자교체 맨 아래·칩 색점·양끝 중복 제거) (2026-05-30)
**배경**: 정우님 "라이브 배포 디자인과 시안을 서로 열고 비교해봐". 대조 결과 차이 3건 — ① 담당자교체 위치(근무시간 다음 → 시안은 맨 아래) ② 바 아래 양끝 시간이 눈금과 중복 ③ 칩 색점이 안 보임(강남데모 color 연함).
- **담당자 교체 맨 아래로**: 근무시간 IIFE 다음(바 위)에 있던 담당자교체 블록 제거 → segments IIFE 안 푸터 바로 위(바·칩·이동추가 다음)로 이동. borderBottom→borderTop. 변수(rsvList·candidates) segments IIFE 스코프서 재계산. 시안 순서(근무시간→바→담당자교체→푸터)와 일치.
- **칩 색점 가시화**: 칩 색점 `br.color||T.primary` → 바와 동일 isLight(평균>205) 판정 + 연한 색이면 해시 팔레트. 강남데모처럼 연한 color는 진한 팔레트색 → 흰 배경서도 보임.
- **양끝 중복 시간 제거**: 바 아래 `11:00 … 21:00`(양끝)이 위 눈금과 중복 → 제거, 드래그 중 시간 bubble(insertAt)만 조건부 유지.
- **검증**(로컬 dev 데모, 서연 팝업=예약 있어 담당자교체 노출): 빌드 OK·babel PARSE_OK·스크린샷 — 담당자교체 맨 아래·칩 파란 점·양끝 사라짐·selectCount 2. 시안 거의 1:1.
- **유의**: 바(연보라 br.color)와 칩 점(파랑 팔레트) 색이 미세하게 다름(칩 점은 가시성 위해 진한 색 강제). 거슬리면 칩 점에 바 색+테두리로 통일 검토.
- 배포: v3.7.915 라이브(version.txt 검증, CF 퍼지 success).

### v3.7.916 — 타임라인 날짜 탭에 "오늘" 표시 (2026-05-30)
**배경**: 정우님 "토 30 네모칸 중 오늘이 어딘지 직원들이 잘 모른다". 14일 날짜 탭에서 오늘 칸을 명확히.
- 날짜 탭 렌더([TimelinePage.jsx:3957](src/components/Timeline/TimelinePage.jsx:3957))에 `isToday = (i + _off === 0)` 추가. 오늘이면 요일("토") 자리에 **"오늘"** 표시(다른 날은 요일 유지). 오늘 글자 굵게(800) + 미선택 시 보라(T.primary)로 강조. 선택+오늘이면 기존 보라 배경+흰 글자.
- 검증: 빌드 OK·babel PARSE_OK·dev 스크린샷 "오늘 30" 보라 배경 확인. 배포: v3.7.916 라이브(version.txt 검증, CF 퍼지 success).

### v3.7.917 — 데스크탑 상단 "오늘" 버튼 제거 (날짜탭 "오늘"로 대체) (2026-05-30)
**배경**: v3.7.916으로 날짜 탭에 "오늘"이 생겨, 상단 날짜 네비 옆 별도 "오늘" 버튼(`setSelDate(todayStr)`, `hide-mobile`이라 데스크탑 전용)이 중복 → 정우님 요청으로 제거. 오늘 점프는 날짜 탭의 "오늘 30" 클릭으로 대체.
- [TimelinePage.jsx:3907](src/components/Timeline/TimelinePage.jsx:3907) chevR(다음날) 버튼 다음의 `<button …>오늘</button>` 제거.
- 검증: 빌드 OK·babel PARSE_OK. 배포: v3.7.917 라이브(version.txt 검증, CF 퍼지 success).

### v3.7.918 — 커플룸 자동 동반자 ①(앱): 신규만 → 신규·기존·모바일 (2026-05-30)
**배경**: 신영 요청(`bliss_requests_v1` id_3po2ckyzmj) "커플룸 체크했는데 동반자 안 생김. PC는 Ctrl 복사로 되지만 모바일 어렵다". 정우님 "AI/모바일 커플룸 시 예약 2건 자동" 요청.
**조사(보고서)**: 커플룸 태그(`bvkgtel09`, 전 지점 공통·114건 사용) 예약 중 **자동 동반자 단 2건**. 원인 2곳 —
  - ① 앱 `handleSave`의 커플룸 자동 동반자(`2576`)가 `isNewItem`(신규 등록만) 조건 → 실무는 "예약 먼저 만들고 나중에 커플룸 체크"(=기존 수정)라 안 걸림.
  - ② 서버 `ai_booking.py`는 커플룸 태그 자체를 안 붙임(`selected_tags=_new_tags=신규고객태그만`, 1220/1239). AI가 커플 의도 감지 안 함.
  - [데이터: source별 — naver/네이버 57건 동반자0, 앱수동(전화/카톡/워크인/문자/인스타/빈) 56건 동반자2]
- **① 앱 fix(이 배포)**: `2580` 조건에서 `isNewItem &&` 제거 → 커플룸 태그 붙으면 신규·기존 무관 동반자 생성(이미 동반자 있으면 `_alreadyHasCompanion` skip). `setData` exists(기존) 경로에도 `_coupleCompanion`을 allItems push + 로컬 reservations 추가. **handleSave는 PC·모바일 공통**이라 모바일에서 커플룸 체크 시에도 자동 2건.
- 검증: 빌드 OK·babel PARSE_OK. 배포 v3.7.918.
- **⏳ 남은(같은 요청, 정우님 "전부 다" 선택)**:
  - **② 서버 `ai_booking.py` ✅ 완료**: `create_booking_from_ai`에 커플룸 동반자 추가 — 프롬프트 JSON에 `couple` 필드 + 룰 #15(커플/커플룸/둘이서/two of us 감지). `couple=true`면 본인 row에 커플룸태그(`bvkgtel09`)+`reservation_group_id` 부여 + INSERT 후 동반자 row INSERT("OO 동반자1", cust 비움, 같은 group, 커플룸 태그) + `reservation_groups` INSERT(room_type 'shared'). **신규예약만**(not existing — 변경 시 중복 방지). 백업 `ai_booking.py.bak_pre_couple_20260530_141815`. **검증**: ⓐ create_booking 직접 호출(couple=true) → 2건 PASS ⓑ end-to-end(AI "강남 브라질리언 커플로 예약" 채팅 → couple 추출 → 본인+동반자1 2건, 같은 grp, 커플룸 태그) PASS. 둘 다 테스트 데이터 정리. React 무관(서버 직접).
  - ✅ **같이 fix(별개 기존 버그)**: ai-suggest out 처리 `_h_noct` NameError → `ai_booking_agent` 스코프(3075)에 `_h_noct` 정의 1줄 추가. 답변추천 out['booking'] 복구(타임라인 포커스, v3.7.897). 배포 전 백업에도 있던 기존 버그(커플룸 무관). 백업 `bak_pre_hnoct_*`. 검증: end-to-end 재실행 → `out booking:{'id':'ai_...}` 채워짐 확인.
  - **③ 모바일**: 예약 모달(ReservationModal)에 "동반자 추가" 버튼 — Ctrl 드래그 복사(`3068 !isTouch`라 모바일 불가)의 모바일 대체. 일반(비커플룸) 동반자 수동 추가용.

### v3.7.919 — 커플룸 동반자 ③ 모바일 동반자 버튼 (커플룸 작업 완결) (2026-05-30)
**배경**: ③ 모바일 동반자 버튼 — 신영 요청(id_3po2ckyzmj)의 마지막 조각. PC는 Ctrl 드래그 복사로 동반자를 만들지만 `TimelinePage.jsx:3072 isCopyDragRef = !isTouch && (ctrlKey||metaKey)`라 모바일(터치)에선 불가 → 버튼으로 대체.
**구현**:
- `TimelinePage.jsx`에 `addCompanion(baseItem)` 함수 신설 — Ctrl 드래그 복사(3220~3289)와 동일 규칙을 **같은 자리**(time/room/staff/dur/bid/services 유지)에 적용. `onAddCompanion` prop으로 모달에 전달.
  - 동반자 번호: `{baseName} 동반자N` (baseName=이름에서 `\s*동반자\d+\s*$` 제거, 같은 date·같은 base 카운트가 N). endTime은 time+dur로 재계산(폼 endTime은 기본값이라 신뢰 안 함).
  - `reservation_group_id`: 원본에 없으면 새로 만들고(`rg_`, roomType `separate`) 원본도 UPDATE → 블록 색 도트로 묶임. 있으면 재사용.
  - 친구=별도 사람: custId/phone/email/gender/num + visitor* 비움, primarySubject `reserver`, isNewCust false.
  - 결제 끊김: isPrepaid/externalPrepaid/externalPlatform/totalPrice/npayMethod 0 + "예약금완료" 태그 제거. 반복·scheduleLog·tsLog 리셋. reservationId `manual_`+newId, prevReservationId null. setData + sb.upsert.
- `ReservationModal.jsx`: props에 `onAddCompanion` + footer(삭제 다음, 저장 앞)에 **"동반자 추가"** 버튼(`I name="userPlus"`, 보라 outline). 노출 조건 `item?.id && !isSchedule && (f.custName||"").trim() && onAddCompanion`(저장된 예약·비내부일정·고객명 有, `!isReadOnly` 블록 안이라 열람전용 자동 숨김). 클릭 → `onAddCompanion(f)` + `onClose()`(모달 닫고 타임라인에 표시).
**정책**(정우님 확인): 노출 = **PC·모바일 둘 다**(PC는 Ctrl 드래그도 유지). 추가 후 **모달 닫기**. 원본 예약의 시술·태그 상속(Ctrl 복사와 동일) — 커플룸 예약에서 누르면 커플룸 태그도 따라감. 커플룸 자동 동반자는 ①(handleSave)이 처리하므로 이 버튼은 **일반(다인원) 동반자 수동 추가용**.
**검증**(로컬 dev 데모): 빌드 OK(exit 0). 데스크탑·모바일 둘 다 버튼 노출(모바일 4버튼 한 줄 fit). 클릭 → `안준서 동반자1` 생성(같은 시간·관리사, group 묶임)·모달 닫힘 확인. 테스트 데이터(동반자 1건 + 그룹 1개) eval로 정리 완료. 콘솔 에러 0(Realtime CHANNEL_ERROR는 로컬 환경 기존 이슈, 무관).
**적용**: v3.7.919 라이브 배포(version.txt 검증, CF 퍼지 success).
**→ 커플룸 자동 동반자 작업 ①(v3.7.918 앱)·②(서버 ai_booking.py)·③(v3.7.919 모바일 버튼) 전부 완료.**
**유의**: `addCompanion`은 baseItem=모달 폼(`f`) 기준 — 저장된 예약을 base로 친구 1명 복제. 신규 등록(item.id 없음)·내부일정엔 버튼 미노출. 동반자에 매출·예약금은 안 따라감(결제는 원본 귀속, Ctrl 복사와 동일).

### v3.7.920 — 동반자 추가 버튼 footer→고객정보 줄로 이동 (축소) (2026-05-30)
**배경**(정우님): v3.7.919에서 "동반자 추가"를 footer에 [매출완료][매출취소][삭제][저장]과 **동급 크기**로 넣었더니 "잘 쓰지도 않는 버튼을 그렇게 크게 만들면 안 된다, 고객정보쪽에 조그맣게 만들던가".
**fix** (`ReservationModal.jsx`): footer의 큰 동반자 버튼 제거 → 고객정보 액션 줄 `[변경][고객정보↗][메시지]`에 **`[동반자]`** 작은 텍스트 버튼(flex:1·`I name="userPlus"`·12px·borderLeft 구분선)으로 합류. buttonRow 2곳(방문자 케이스 ~2283 + 일반 케이스 ~2452) 둘 다. 노출 조건 동일(`item?.id && !isSchedule && (f.custName||"").trim() && onAddCompanion`). 클릭 동작(`onAddCompanion(f)`+`onClose()`)·생성 로직(`addCompanion`) 무변경.
**검증**(로컬 dev 데모): 데스크탑·모바일 둘 다 고객정보 줄 `[변경][고객정보↗][메시지][동반자]` 한 줄 fit, footer는 `[매출등록][삭제][저장]`만(동반자 빠짐). 콘솔 에러 0.
**적용**: v3.7.920 라이브 배포(version.txt 검증, CF 퍼지 success).

### v3.7.921 — 노쇼·취소 페널티 선불권/다회권 차감을 보유권 거래내역에 기록 (강남 id_p46r9t7dpd) (2026-05-30)
**요청**(강남): "노쇼 패널티 차감도 이력란에 떴으면 좋겠습니다. 메모만 달리고 이력엔 차감된 내역이 없어요."
**원인**: `runPenaltyDeduction`(ReservationModal)의 페널티 차감이 결제수단별로 기록 비대칭 — 선결제(externalPrepaid)·포인트/선불권/다회권 어느 경로든 `sales`(매출)는 기록(1681~ 블록)하지만, **선불권/다회권은 `customer_packages` 잔액만 UPDATE하고 `package_transactions`(보유권 사용 이력)에 deduct를 안 남김** → 고객 보유권 거래내역에 페널티 차감이 안 보임(포인트는 `point_transactions`에 기록돼 보임).
**fix**: 선불권 차감 루프(`잔액:` UPDATE) + 다회권 차감(`used_count` UPDATE) 직후에 `package_transactions` deduct INSERT 추가 — `CustomersPage.recordPkgTx` 컬럼 패턴 동일(type=`deduct`, unit=`won`(선불권)/`count`(다회권), amount, balance_before/after, note=`{사유} 페널티 (예약 …)`, created_at). 정우님 결정 "매출 + 보유권내역 둘 다".
**결과**: 노쇼·취소 페널티로 선불권/다회권 차감 시 — 매출관리·고객 매출 히스토리(sales, 기존) + 고객 보유권 사용 내역(package_transactions, 신규) 둘 다 표시.
**검증**: 빌드 OK. 실제 노쇼+차감 시나리오는 데모 재현 비용이 커서 코드 리뷰·빌드로 검증(INSERT 패턴은 CustomersPage `recordPkgTx`와 동일, balance_after ≥ 0 보장).
**적용**: v3.7.921 라이브 배포(version.txt 검증, CF 퍼지 success).
**유의**: 매출(sales) 페널티 기록은 원래부터 동작 중이었음(강남이 본 "이력"은 보유권 사용 내역). 차감 경로는 포인트→선불권→다회권 순(33,000원 기준). 보유권 거래내역 표시는 고객 상세 보유권 탭(`PkgCard`/`pkgHistoryMap`)에서 확인.

### v3.7.922 — 미응답 배너 안 사라지는 버그 fix (대화창 읽음 → 배너 즉시 갱신) (신영 id_rhh0b4expr) (2026-05-30)
**버그**(신영 — v3.7.921에서 "현재 동작 정상"으로 오판했으나 정우님 "버그다" 지적, 재확인 결과 실제 버그): 상단 미응답 배너("답변 확인")가 **상담창(대화)을 열어 읽어도 안 사라짐**. 기대 동작 = 대화창 열기(읽음 처리) → 배너 즉시 해제.
**원인**: 배너 카운트 `unreadDelayedCount`(AppShell)는 `is_read=false`인 1분+ 미읽 IN 메시지 개수. 대화창 열면 `markRead`(MessagesPage:619)가 DB `is_read:true` PATCH + `onRead(unreadCount)` 호출하지만 — AppShell의 `onRead` 콜백이 **사이드바 배지(`unreadMsgCount`)만** 줄이고 배너(`unreadDelayedCount`)는 안 건드림. 배너는 Realtime UPDATE(`is_read===true`) 이벤트(1682)나 **120초 폴링**(1686)에만 의존 → Realtime 불안정 시 최대 120초간 안 사라짐(체감 "안 사라짐").
**fix** (`AppShell.jsx`): `loadUnreadRef`(useRef) 신설 → useEffect 안에서 배너 재계산 함수(`load`) 저장 → `onRead` 콜백 2곳(AdminInbox forceCompact 패널 + `/messages` Route)에서 `loadUnreadRef.current()` 즉시 호출 추가. `markRead`의 DB PATCH(await 완료) 직후 `onRead` → 배너 재fetch(`is_read=false` 필터) → 읽음 반영 → 즉시 해제. Realtime/폴링과 무관하게 대화창 열면 바로 사라짐.
**검증**: 빌드 OK, HMR 콘솔 에러 0. 데모에 미읽 IN 메시지 0건이라 배너 자체가 안 떠 시각 검증은 불가 — 로직 검증(`markRead: await PATCH → onRead(unreadCount>0) → loadUnreadRef.current() → load → setUnreadDelayedCount` 경로 정확). additive 변경(onRead에 호출 1개 추가)이라 회귀 위험 낮음.
**적용**: v3.7.922 라이브 배포(version.txt 검증, CF 퍼지 success).
**유의**: 라이브에서 미응답 배너 뜬 대화를 열어 즉시 사라지는지 1회 확인 권장(데모 검증 제약). 배너 기준은 여전히 "1분+ 미읽 IN 메시지"(마지막 방향 아님) — 대화창 열어 읽으면 해제, 고객이 새 메시지 보내면 다시 뜸(정상). AI 자동응답 여부와 무관.

### v3.7.923 — 알림톡/SMS 발송 시 +82 한국번호 → 010 정규화 (정우님 id_7g8h69xga7) (2026-05-30)
**요청**(정우님): "이 고객 연락처가 82로 시작하는 한국 모바일인데 국제번호로 되어 있어 알림톡이 안 가는 것 같다. 010으로 바꿔서 (발송되게) 기재하면 어떤가."
**원인**: 알림톡/SMS 발송 가드가 `010` 시작 번호만 통과 — 채팅(WhatsApp 등) user_id나 외국 거주 고객의 `+82 10...`(`8210...`) 형식은 정규화 시 `821012...`로 시작해 발송에서 누락. customers/reservations 저장값엔 82 형식 **0건** → 채팅 연동 고객 cust_phone이 82인 케이스로 추정.
**fix**:
- 앱 `utils.js` `toKrMobile(p)` 헬퍼 신설 — `821xxx`(+82 한국모바일, len≥11) → `010xxx`/`011xxx`, `820xxx` → `0xxx`.
- `sb.js queueAlimtalk`: phone을 toKrMobile 정규화 후 010 체크 + queue에 정규화된 번호 저장(inline, utils 미import — 순환 회피).
- 앱 발송 가드 4곳(TimelinePage `validPhone` ×3 [2800·3380·5695]·ReservationModal rsv_confirm 조건 [3300]): `startsWith("010")` → `toKrMobile(...).startsWith("010")` (82 형식도 발송 대상 포함). TimelinePage·ReservationModal에 `toKrMobile` import 추가.
- 서버 `bliss_naver.py`(백업 `bak_82norm_*`, scp 방식 — 로컬 받아 ast.parse 검증 후 업로드): `alimtalk_thread` 발송 phone(`phone_clean`, 2295 — 모든 alimtalk_queue 발송 최종 관문) + `care_sms` 진입(`ph_digits`, 2668)에 `if startswith("82") and len≥11: "0"+[2:]` 정규화(find_cust_by_phone 276의 동일 패턴). `systemctl restart bliss-naver`(active).
**검증**: 앱 빌드 OK·HMR 콘솔 0. 서버 ast.parse syntax OK·재시작 active. 실 발송(82 고객 카카오 알림톡)은 라이브 실데이터 필요 — 코드 검증.
**적용**: v3.7.923 라이브 배포 + 서버 patch.
**유의**: 저장값(customers.phone) **무변경** — 발송 시점에만 010 변환(정우님 "기재" 제안이지만 저장 데이터엔 82가 없어 발송 변환이 정답). WhatsApp user_id 등 82 채팅 고객도 이제 알림톡 발송. ⚠️ rsv_today/1day reminder 등 다른 서버 발송 경로의 **진입 가드**(010 체크)는 미점검 — `alimtalk_thread` 최종 정규화(2295)로 발송 자체는 방어되나, 진입에서 82를 막으면 queue 미적재 가능(추가 점검 대상). 정우님 케이스(예약모달 직원 확정 rsv_confirm)는 앱 queueAlimtalk로 커버. **(→ v3.7.924에서 저장값도 정규화하기로 정정 — 아래 참고)**

### v3.7.924 — 전화번호 저장 정규화: +82 한국모바일 → 010 (정우님) (2026-05-30)
**배경**(정우님): v3.7.923 발송 정규화 후 "이런 고객(Flora `8201077363978`) 저장값 자체를 정규화하는 게 낫지 않냐". + v3.7.923에서 customers `821%`만 조회해 "0건"이라 한 게 **누락** — 실제 케이스는 `820`(=`+82 010`, 0 두 번) 형식이라, `^82[01]`로 재조회하니 customers.phone 2건(Flora·Loula)+phone2 1건+reservations 2건.
**처리**:
- **기존 데이터 일괄**(DB): customers.phone/phone2 + reservations.cust_phone `^82[01]`(한국 모바일) → `82` 떼고 010. Flora `8201077363978`→`01077363978`, Loula `+8201039186019`→`01039186019`. `82` 비모바일 1건(유선/외국)은 제외.
- **앱 입력**(`db.js toDb("customers")`): f 반환 직전에 phone/phone2 정규화(`821→010`/`820→010`, 그 외 형식 보존). 앱 customers 저장 대부분이 toDb 경유 → 단일 지점 커버.
- **서버 자동생성**(`bliss_naver.py`+`ai_booking.py`, 백업 `bak_phonenorm`): `_kr_mobile(p)` 헬퍼(모듈 레벨) + customers INSERT 6곳(네이버신규 `_new_phone`·방문자 `_v_phone_raw`·카카오 `_phone_norm`·Trazy `phone`·기타신규 `phone`·AI예약 `phone`) phone 적용. scp 받아 ast.parse 검증 후 업로드·재시작(active).
**검증**: 앱 빌드·HMR 콘솔 0, 서버 ast.parse OK·active, 기존 데이터 SELECT로 정규화 확인.
**적용**: v3.7.924 라이브 배포 + 서버 patch.
**유의**: 발송 정규화(v3.7.923)=발송 시점, 이번(v3.7.924)=저장 시점 → 82 고객이 저장·표시·발송 모두 010으로 통일. `toDb` 정규화는 `82` 형식만 변환(010·하이픈 등 기존 형식은 그대로 보존 — \D 제거는 82 케이스에만). reservations.cust_phone **입력** 정규화는 toDb("reservations")엔 미적용(표시는 customers.phone 우선·발송은 v3.7.923 커버, 기존 데이터만 일괄 정규화함) — 필요 시 추가.

### v3.7.925 — 포인트 충전·환불을 지점 원장(manager)도 + 계정별 자기 지점만 (정우님) (2026-05-30)
**배경**(정우님): "각 지점이 알아서 충전, 계정별로". 토스 충전 ENV(v3.7.924) 설정 후 충전 버튼이 안 보임 — `AdminPlan` 충전·환불 버튼이 `isOwner`(owner/super)만이라 지점 원장(manager) 계정은 미노출(8지점 계정은 전부 manager, owner는 `housewaxing` 대표 1개뿐). 또 지점 목록이 `data.branches` 전체라 계정 무관 전 지점 노출. (참고: 화면 "OP"는 잔액 "0P"가 폰트상 O처럼 보인 것)
**fix** (`AdminPlan.jsx`): ① `isMaster = isOwner || role==='manager'` 추가 ② `branches`를 `userBranches`로 필터(각 계정 자기 지점만, userBranches 빈 배열이면 전체 fallback) ③ 충전·환불 버튼 가드 `isOwner`→`isMaster`. 요금제 변경(290 isOwner)·변경 함수(94 isOwner alert)는 owner 유지.
**멀티테넌트**: 충전=각 매장(테넌트) 운영자가 **자기 지점** 충전 — 지점 원장(manager) 포함. owner 1명이 8지점 충전 관리는 비현실적. 각 계정은 자기 `userBranches` 지점만 보고 충전. [[feedback_bliss_multitenant]]
**적용**: v3.7.925 라이브 배포. (충전 ENV `TOSS_BLISS_*`는 v3.7.924 설정 완료 → 이제 manager 계정으로 충전 테스트 가능)
**유의**: 환불도 manager 가능(자기 지점 잔액 한도 + 사유 + confirm 가드로 완화). 요금제 변경만 owner 전용. 데모는 owner 계정이라 manager 충전 시각 검증은 라이브(지점 계정 로그인)에서 확인.

### v3.7.926 — 월 이용료(구독) 자동결제 시스템 (지점별·가입일 기준) (2026-05-31)
매장→Bliss 본사(테라포트) **월 이용료**를 빌링키 자동결제로 신규 구축. 충전(topup)과 동일한 본사 키(`TOSS_BLISS_*`) 사용, 지점별 카드 등록. (정우님 "월이용결제 만들어" + 설계 답변: 지점별 + 가입일 기준 매월)
- **설계 결정**(정우님): ① 청구 단위 = **지점별**(각 지점 자기 카드 → 자기 플랜 금액) ② 금액 = 각 지점 `billing_subscriptions.price_monthly`(현재 전 지점 Pro 77,000) ③ 첫 결제 = **등록 즉시** + 이후 매월 등록일(가입일) 자동.
- **핵심 구조**: billing-issue/charge가 원래 **매장 키**(`branches.payment_settings`, 손님 정기결제용)만 썼음 → 월 이용료는 매장→본사 결제라 **본사 키 분기 추가**(payment-confirm topup 분기와 동일 패턴). `purpose==='subscription'`이면 본사 키, 그 외는 기존 매장 키(무회귀).
- **Edge Functions**:
  - `billing-issue` v8 — subscription이면 본사 키로 빌링키 발급. 지점당 활성 카드 1개(기존 active는 `replaced`). billings INSERT 후 `billing_subscriptions`에 `billing_id` 연결 + `auto_renew=true` + `next_billing_at=now`(즉시 청구 대상) + `subscription-charge` 내부 호출(service role, 등록 즉시 첫 결제). 반환에 `firstCharge` 포함.
  - `billing-charge` v7 — `bill.purpose==='subscription'`이면 본사 키 청구, 그 외 매장 키.
  - `payment-info` v11 — `?billing=1&branchId=X` 카드등록 분기(본사 client key + `customer_key=sub_{branchId}` + `price_monthly` 반환). verify_jwt=false.
  - `subscription-charge` v2 (신규) — 구독 청구. 단일(`{branchId}`/`{subscriptionId}`) 또는 **batch(`{}`: 도래한 모든 구독, pg_cron용)**. 중복청구 방지(`next_billing_at` 미래면 skip). 성공 시 `next_billing_at += 1개월`(월말 보정, 1/31→2월 말일). 내부에서 `billing-charge`를 service role로 호출. verify_jwt=true.
- **DB**: `ALTER TABLE billing_subscriptions ADD COLUMN billing_id text`(연결 카드 = billings.id).
- **pg_cron** `subscription-billing-daily` — 매일 02:00 KST(`0 17 * * *` UTC), `subscription-charge`에 `{}` POST(batch). anon JWT(다른 cron과 동일 패턴, headers := named param).
- **프론트**(v3.7.926 빌드):
  - `PaymentApp.jsx` — `/pay/billing/:branchId`(BillingRegister: payment-info billing → `tp.payment({customerKey}).requestBillingAuth({successUrl,failUrl})`) + `/pay/billing-success`(BillingSuccess: `billing-issue` 호출 → `firstCharge` 결과 표시). `SB_KEY` 상수 추가(billing-issue verify_jwt=true 호출 Authorization). 라우트 순서: billing-success·billing/:branchId를 `:orderId` 앞.
  - `AdminPlan.jsx` — 지점별 카드에 "월 이용료 카드 등록/변경" 버튼(`/pay/billing/{br.id}` 새 탭) + 등록 상태(`sub.billing_id` 있으면 "카드 등록됨 · 다음 MM/DD" 초록, 없으면 "카드 미등록"). `isMaster`(manager 포함, 자기 지점만). `fmtBillDate` 헬퍼.
- **로컬 검증**: `/pay/billing/br_4bcauqvrb` 카드 등록 화면 정상(강남점 77,000원·매월 자동 결제·카드 등록 버튼). 빌링 관련 콘솔 에러 0(RT CHANNEL_ERROR는 로컬 환경 무관).
- **유의**:
  - **카드사 심사(약 6월 중순, 6/13~18) 전엔 첫 결제가 `REJECT_CARD_COMPANY`로 거절** — 카드 등록은 되고 BillingSuccess가 "카드사 심사 완료 후 첫 결제" 안내. 충전과 동일(심사 끝나면 재작업 없이 자동 작동). 송정윤 매니저 010-4928-1242.
  - **멀티테넌트**: 본사 키는 ENV(`TOSS_BLISS_*`) 단일, 지점별 `billing_subscriptions`로 분리. 손님 정기결제(매장 키)와 키 경로 완전 분리. 하드코딩 0.
  - 청구 시각 = 매장 등록일 기준 매월 같은 날(02:00 KST 배치). next_billing_at이 "즉시 청구 대상" 플래그 역할(now면 청구, 미래면 skip).
  - billing-issue verify_jwt=true → PaymentApp success가 anon SB_KEY로 호출. subscription-charge verify_jwt=true → billing-issue 내부(service role) + pg_cron(anon JWT) 호출.

### v3.7.927 — 고객 세그먼트 프리셋 (공비서 비교 갭반영 ①) (2026-05-31)
공비서(gongbiz.kr) 전체 비교(NAS `SynologyDrive/bliss/gongbiseo/` 분석문서) 후 도출한 갭 4종(①고객 프리셋 ②자동충전 ③통계 대시보드 ④연간결제) 중 **①** 반영. 고객관리에 원클릭 세그먼트 필터.
- `CustomersPage.jsx`: 검색·매장 줄 아래 프리셋 버튼 **7종**(전체/신규/재방문/단골/이탈/노쇼주의/보유권). `preset` state + `buildFilter` 조건 분기. useEffect deps에 preset 추가.
  - 신규 `visits≤1` / 재방문 `≥2` / 단골 `≥10` / 이탈 `visits≥1 & last_visit < today-90일 & last_visit≥2020` / 노쇼 `no_show_count≥1`
  - **보유권**: RPC `get_customers_with_active_pkg(biz,bid,search,offset,limit)` — `customer_packages` 잔여(`total_count-used_count>0`) EXISTS. longValOnly처럼 fetchPage가 RPC 분기, count=exact는 폴백("N명+"). RLS: customers anon SELECT 통과(SECURITY INVOKER STABLE).
- 기존 다중선택(`smsSel`)+`✉ 일괄문자`와 연동 → 세그먼트 골라 일괄 발송(공비서 동일 흐름, 블리스는 일괄문자 이미 있었음).
- **유의**: 보유권 잔여 판정은 `total_count-used_count>0` 단순식 — 금액형(다담권) 잔액은 note 기반이라 일부 부정확 가능, 만료 보유권도 잔여>0이면 포함. 정밀화는 후속. 단골 10회·이탈 90일 등 기준은 코드 상수라 조정 쉬움.
- 남은 갭 **②자동충전·③통계 대시보드·④연간결제**는 후속(②④는 카드사 심사 후 실청구).

### v3.7.928 — 매출통계 기간대비% (공비서 갭반영 ③ 일부) (2026-05-31)
공비서 통계 대시보드 갭 중 기간대비 증감 반영. 블리스 매출통계는 이미 풍부(총매출/시술/제품/상품권/일평균/객단가 + 일별·월별·연도별 차트 + 지점·매니저·결제수단·외국인 신규기존)라 실질 갭은 기간대비%였음.
- `SalesPage.jsx` StatsPage: `prevTotal` state + useEffect — 선택 기간과 **같은 길이의 직전 동기간** `get_sales_stats_summary` 1회 더 호출(같은 vb/biz). Summary Cards 위에 "지난 동기간 대비 ▲N%" 배너(증가 초록 ECFDF5/감소 빨강 FEF2F2 + 이전 금액). periodKey='all'(전체기간)·기간 미설정은 비교대상 없어 미표시.
- **후속(③ 나머지)**: 재방문율·시간 활용률(예약 dur 합/영업시간)은 별도 RPC 필요 — 미반영. ④연간결제·②자동충전(카드 심사 후 실청구)도 후속.

### 케어 SMS 단문화 + 포인트 소멸 임박 알림 (2026-05-31, 서버+DB, React 변경 0)
**케어 SMS 전멸 원인 규명 (강남 요청 id_cs1l36okk7 done)**: 케어 본문이 **장문(248자)**이라 UMS SMS 한도(**EUC-KR 90Byte/한글 ~45자**) 초과 → UMS가 `code:"100"`(성공)만 주고 `data:[]`(미발송)로 떨굼. 최근 10일 **801건 전멸**. 직원이 케어 문구를 길게 바꿔서 발생(5/16 이전엔 33~41자 단문 성공 이력). **`_is_success`가 `data` 비면 failed로 본 건 매뉴얼상 올발랐음**(실제 미발송). UMS 매뉴얼: `/send/sms`=EUC-KR 90Byte, code 100=성공이나 길이초과 시 data 빈 채 미발송.
- **`send-sms` v14**: 단문 전용. (v13에서 90Byte 초과 시 LMS(`/send/mms` 파일無) 자동전환 넣었다가 **정우님 "장문 안돼"(비용)로 롤백**). 90Byte 초과 시 경고 로그만.
- **케어 단문 7개 등록**(8지점 `noti_config`): after_1d_first_only/5d/10d/18d_first_only/21d/35d/60d 전부 90Byte 이내 단문으로 교체(5/16 이전 슬로건 톤 + `[하우스왁싱]` 태그). EUC-KR byte 검증 후 `jsonb_set` 일괄 UPDATE.
**포인트 소멸 임박 알림 (정우님 추가, D-30·D-10)**:
- RPC `get_expiring_points_targets(p_biz, p_day)` — `point_transactions` earn 중 `expires_at::date = today+p_day` & 잔액>0(=earn−deduct−expire) 고객. phone(010~)+sms_consent+미숨김. 소멸금액=`min(exp_amount, balance)`.
- `point_expiry_sms_log` 테이블 `UNIQUE(customer_id,tier,exp_date)` 중복방지.
- `bliss_naver.py` **`point_expiry_thread`** — 매일 **10:30 KST**(10:30~10:40 1회) D-30·D-10 RPC → 로그 선점 INSERT(UNIQUE 충돌=skip) → `send-sms` 직접 호출(publishable key, 지점 발신번호). 본문 `[하우스왁싱] OO님, 적립 포인트 N원이 M일 후 소멸돼요! 방문해서 사용하세요`(긴 외국이름+999만원도 89byte 단문). 백업 `bak_pexp_*`, 재시작 active 확인.
- 오늘 기준 대상: D-30 7명/9.8만P, D-10 6명/6만P → 내일 10:30 첫 발송.
**유의**: 케어·포인트 SMS는 UMS `/send/sms`(EUC-KR 90Byte) 단문 전용 — **본문 길이 관리 필수**(초과 시 `data:[]` 미발송, 직원이 noti_config 케어 문구 길게 바꾸면 또 전멸). LMS는 비용상 미사용. send-sms는 v14 단문 전용. 포인트 알림 실발송 검증은 내일 10:30(`point_expiry_sms_log`로 확인).

### v3.7.939 — 월별 매출/고객수 비교표 전년 동월 대비 성장률 (2026-05-31)
- 월별 매출 비교표: 각 연도 금액 옆에 **전년 동월 대비 %** (주식식 — 상승 빨강 `#e2231a` / 하락 파랑 `#1565d8`). 진행중인 달은 예상매출 기준 비교. 가장 오래된 연도는 비교 대상 없어 % 미표시.
- **월별 고객수 비교표 신설** (월별 매출표 바로 아래): 연도×월 피벗, 각 셀에 신규(보라)/기존(회색)/외국인(주황) 3분류 + 각 전년 동월 대비 %. 매출발생 기준(체험단 0원 제외, get_customer_visit_trend 그대로). 외국인 = fn+fo.
- `custTrend` get_customer_visit_trend `p_months` 13→120 (연도 비교용 충분), 추이 누적막대 그래프는 `slice(0,13)`로 최근 13개월 유지. custYoy useMemo로 연도×월 피벗.

### v3.7.940 — 고객정보 수정 저장 UX (저장됨✓ + 예약모달 변경 누락 버그) (2026-06-01)
요청 2건(강남점) 처리.
- **고객관리(CustomersPage)**: 칸 onBlur 자동저장(기존)에 "저장됨✓" 토스트 추가(`savedFlash`, fixed). 저장 피드백 부재 해소(자동저장은 원래 되고 있었음).
- **예약모달(ReservationModal) "변경" 버튼**: 고객정보(이름·연락처) 수정 기능임을 명확화.
  - ① 변경 모드 칸만 수정하고 변경 "저장"을 안 누른 채 예약 저장하면 `_persistCustEdits` 누락 → 예약저장 onClick에 `if(editingCust) _persistCustEdits()` 보장(전화 저장 안 되던 버그 fix).
  - ② 변경 "저장" 버튼 → "정보 저장"으로 라벨 변경 + `commitBtn.click` 제거 → 고객정보만 저장, 예약 저장과 분리(모달 유지).
  - ③ `_persistCustEdits` 성공 시 "저장됨✓" 토스트.
- 경고창 원칙 메모리화(`feedback_bliss_custom_dialogs`): native alert/confirm 금지, 디자인 모달.
- 요청 done: id_80o771s0cp(예약모달 변경), id_fqys5owuev(고객관리 저장).

### 서버 — AI 예약등록 확정 카드 손님 언어 분기 (2026-06-01, React 변경 0)
**증상**(정우님): WhatsApp 영어 손님(Shashank)에게 "AI 예약등록" 했는데 확정 카드가 **한국어**로 나감.
**원인**: `bliss_naver.py` `_send_booking_confirm`(5091)의 확정 카드("OO님, 예약이 등록되었습니다 📍🗓 변동사항이...")가 **손님 언어 판정 없이 한국어 하드코딩**. ai_booking.py의 reply_lang(AI 응답 언어)과 별개로, /ai-book 성공 시 이 카드가 코드로 생성·발송됨.
**fix**: `_send_booking_confirm`에 손님 언어 판정 추가 — 마지막 inbound 3건 한글 우세 여부(`_ko>=2 and _ko>=_oth`). 영어권이면 영어 확정 카드(날짜 "Mon, Jun 1" + 시간 "11:00 AM" + 차트 안내 영어 + "your booking is confirmed! ... Let us know if anything changes!"). 한국어 손님은 기존 카드.
**적용**: 서버 직접(백업 `bak_booking_lang_*`) + `systemctl restart bliss-naver`(active). React 변경 0 → 버전업·CF퍼지 불필요.

### v3.7.941 + 서버 — 크리에이트립 예약 받은메시지함 제외 (2026-06-01)
**증상**(정우님): 크리에이트립 손님 Renee(카톡 ID renee.h)가 받은메시지함에 카톡 대화방으로 떠서 "카톡도 없는데 카톡으로 이어지는 것처럼" 보임.
**원인**: 크리에이트립 메일 파싱(`bliss_naver.py`)이 손님이 적은 메신저(`sns_type`/`sns_id`)를 chat_channel/chat_user_id로 저장 → 받은메시지함이 `reservations.chatChannel` 기반(`chatResMap`)으로 대화방 생성. 카톡은 개인 ID라 우리가 먼저 메시지 못 보냄(친구 아님).
**fix**(정우님 결정 — 크리에이트립 전부 제외): 서버 크리에이트립 처리 chat_channel/chat_user_id 빈값 + 클라 `chatResMap`에 `r.source==='creatrip'` 제외 + 기존 6건(Renee·Chie·David·Clara·Loula·Carly) chat_* NULL 정정.
**적용**: v3.7.941 라이브 + 서버 재시작(active, 백업 `bak_creatrip_chat_*`). 직전 확정카드 영어 분기도 같은 서버 배포에 포함.

### v3.7.942 + 서버 — AI 답변추천 '직원 지시 모드' (입력칸 지시 → 고객 언어 작성) (2026-06-01)
**요청**(정우님): 직원이 입력칸에 "홍대점 주소 알려줘" 같이 한국어로 지시를 쓰면, AI가 그 내용을 정리해 고객 언어로 작성해 전달.
**구현**(정우님 결정 — 별도 버튼 X, 입력칸에 글 있으면 'AI 답변 추천'이 자동 반영):
- 클라 `MessagesPage.genAI`: /ai-suggest body에 `instruction: (reply||"").trim()` 추가(입력칸 값). 결과는 setReply로 입력칸에 채움 → 직원 검토 후 발송.
- 서버 `bliss_naver.py` /ai-suggest: `payload.instruction` → `ai_booking_agent(instruction=...)`.
- 서버 `ai_booking.py` `ai_booking_agent`: `instruction` 파라미터. instruction이면 ① reply_lang을 손님 마지막 메시지 기준(직원 한국어 지시는 언어판정서 제외) ② user_msg를 "★직원 지시 모드 — 이 내용을 고객 언어로 작성, 예약 처리 말고 안내만, 주소·정보는 [지점] 실제값만, 지어내지 말 것" 블록으로 변환. suggest_only=True라 예약 INSERT 안 됨.
- 매장 주소·전화·건물안내는 이미 프롬프트의 [지점] 실제값 사용(지어내기 차단).
**적용**: v3.7.942 라이브 + 서버 재시작(active, 백업 `bak_instr_*`).

### v3.7.943 — 자주답변 지점별 분리 + 8지점 지점정보 등록 + AI지시모드 공지 (2026-06-01)
- **자주답변 지점별 분리**: `quick_replies_v1` 항목에 `branchId` 추가. 표시=branchId가 현재 `userBranches`에 포함(또는 branchId 없는 공용)만 노출. 등록 시 [관리] 폼에 지점 select(userBranches 필터, "전체 공용" 옵션). 멀티테넌트: 업체간은 business_id로 이미 격리, 그 안에서 지점간 분리(강남↔천호).
- **8지점 지점정보 자주답변 16개(한/영)** 등록: 주소·전화·영업시간·교통·주차·네이버지도·구글지도. 영문 주소 번역, 영업시간 `timeline_settings`(강남 11~22, 나머지 11~21).
- 기존 용산 자주답변 3개(예약금3.3·커플예약금·당일취소패널티) → `branchId='br_ybo3rmulv'`(용산) 부여. 총 19개.
- **공지**(bliss_notices_v1 맨 앞): AI 답변추천 직원 지시 모드 + 자주답변 지점정보/분리 안내(직원용).

### v3.7.944 — 패키지 미사용 검토 페이지 삭제 (2026-06-01)
정우님 요청으로 "패키지 당일 미사용 검토" 페이지(`AdminPkgUnusedReview`, `/pkg-unused`) 제거. AppShell(import·nav 항목·Route·PAGE_ROUTES) + Sidebar 시스템 카테고리에서 `pkgunused` 참조 전부 삭제 + 파일 `git rm`.

### v3.7.945 — 발송내역에 이번달/지난달 필터 (강남 id_v8cy7gh2d0) (2026-06-01)
요청: 알림톡/SMS 발송탭·직원 SMS 발송탭에 이번달/지난달 필터 없음.
- `AdminSmsLog`(직원 SMS 발송 이력 sms_send_log)·`AdminAlimtalkLog`(알림톡·SMS 자동 발송내역 alimtalk_queue): days('최근 N일') 필터에 **'이번 달'/'지난달' 옵션 추가 + 디폴트 'this'(이번 달)**. days state가 `'this'|'last'|숫자` 혼용 → since/until 월경계 계산(this=이달1일~now, last=지난달1일~이달1일, 숫자=최근N일). q에 `created_at lt until` 추가.
- 요금제 화면(AdminPlan) 지점별 사용량은 이미 [이번 달][지난달] 토글(디폴트 이번달)이 있었음(v3.7.748).

### v3.7.946 — 요금제&사용내역 UI 정돈 + 직원SMS 탭 통합 (2026-06-01)
정우님 요청(요금제&사용내역 4개 탭 UI 개선 + 직원 SMS 탭 정리).
- **직원 SMS 발송 탭(AdminSmsLog) → "발송 내역" 탭(AdminAlimtalkLog) 안 서브탭 [알림톡·자동 SMS][직원 발송 SMS] 로 통합**. 탭 4→3개. (직원 SMS 월 1656건 활발 → 제거 대신 통합). subTab 'sms' 진입 시 alimtalk+staff로 정규화(useEffect).
- 탭 라벨·제목·통계 이모지 제거(💳📨📤📊 ✅❌) → 텍스트+색상(굵게). UI 이모지 금지 원칙.

### v3.7.947 — 직원 SMS를 발송내역에 한 목록 통합 + RLS fix (2026-06-01)
정우님: 직원 SMS 발송 이력 0건(데이터는 1810건 있음) + 서브탭 말고 한 페이지 통합 요청.
- **0건 원인 = `sms_send_log` RLS 활성인데 anon 정책 없음** → 앱(anon)이 못 읽음. `CREATE POLICY anon_all_sms_send_log FOR ALL USING(true) WITH CHECK(true)` 추가([[reference_supabase_rls]] 패턴 누락분).
- v3.7.946 서브탭([알림톡·자동][직원발송]) 제거 → **AdminAlimtalkLog 한 목록에 직원 SMS(sms_send_log) 병합**. load에서 sms_send_log도 fetch → alimtalk_queue 형식 정규화(channel='sms', noti_key='직원발송', params._staff_msg, _staff) → created_at desc 병합. 채널필터 전체/SMS일 때만 병합. 지점별 카운트·검색·통계에 자동 포함.
- AdminPlan import AdminSmsLog는 미사용(유지, 무해).

### v3.7.948 — 구독권 (유효기간 내 지정 시술 무제한 무료) 신규 기능 (2026-06-01)
**배경**(정우님): "구독권"을 사면 유효기간 내 브라질리언 왁싱이 무제한 무료인데, 이를 처리하는 코드가 없어 구독권 보유 고객의 매출(브라질리언 0원)을 등록 못 함. 기존 보유권 어디에도 "보유 시 특정 시술 무제한 무료" 개념이 없었음(다회권=회수차감/선불권=금액차감/회원권=할인/쿠폰=할인). 구독권 상품은 이미 회원권 카테고리로 등록돼 있었으나 `annual`로 분류돼 회원가(할인)만 적용됐음.
**정책**(정우님 확정): ① 무료 대상 = 순수 브라질리언만(조합 제외, 단 코드 하드코딩 X·관리설정 지정) ② 유효기간 = 구매 시 미설정 → **첫 무료 사용 시점부터 1년−1일** 자동 시작(선불권 첫사용 패턴 동일) ③ 무료 대상 외 시술 = 정상가(구독권은 회원가 자격 안 줌).
**구현 — 구독권을 회원권(annual)과 분리한 새 종류 `subscription`으로**:
- **DB**: `services.is_subscription boolean default false`(migration `services_add_is_subscription`). 무료 시술·유효개월은 `promo_config`에 저장(`subFreeServiceIds[]`, `subMonths` 기본 12). `db.js` DBMAP/DB_COLS에 `is_subscription↔isSubscription`.
- **AdminSaleItems**: 상품 편집창 토글 "구독권 (무제한 무료)" + ON 시 "무료 제공 시술 다중선택(카테고리별 chip, 쿠폰 svc picker 패턴 재사용)" + "유효기간(개월)". 저장 시 `isSubscription` + `promo_config.subFreeServiceIds/subMonths`.
- **SaleForm**:
  - `_pkgType`에 `subscription` 추가(is_subscription service). `validPkgs`에서 제외(회원가·차감 대상 아님), `_isAnnualSvc`에서 제외(회원가 자격 X).
  - `subPkgs`/`subFreeMap`/`subFreeSvcIds` useMemo — 유효기간 내(미설정=사용전=유효) 구독권 보유권 + 무료 시술ID→pkgId 매핑.
  - `toggle`: 무료 대상 시술 체크 시 자동 `subFree=true`(amount=원가 유지 — 매출기록·차감용).
  - `svcSubFreeTotal`(subFree 시술 원가 합) → `grandTotal` 차감 + `_svcDeductsAll` 포함 → 결제 0. **comped 코드는 안 건드리고 독립 플래그**(comped는 amount=0 방식, 구독권은 원가+차감 방식 — sale_details에 원가 남기려고).
  - 신규 구독권 구매(`newSubscriptionPurchases`) → `customer_packages` 발급(total/used 0=무제한, 유효기간 미설정). `_isAnnualSvc`/`newPkgPurchases` 중복 분류 안 됨. `pureSvcTotal`에서도 제외.
  - **첫 무료 사용 → 유효기간 시작**: subFree 시술의 `subFreeMap` pkgId가 유효기간 미설정이면 그날+subMonths−1일 기록 + `used_count+1`(무제한이라 차감 아닌 사용횟수 누적·통계). `package_transactions`에 사용 기록(amount 0).
  - **sale_details**: subFree 시술 → `[구독권] {시술명}` 원가(unit_price>0) 기록 + 결제 0([체험단] 패턴 동일).
  - **UI(SaleSvcRow)**: subFree 시 파란 행 + "구독권 무료" 배지 + 원가 취소선 + "무료" 표시(amount는 원가지만 화면엔 무료로 직원 인지).
- **검증**(로컬 dev, 데모 김서연에 구독권 부여): 브라질리언 체크 → "구독권 무료" 배지 + 154,000 취소선 + **총 결제금액 0원** ✓. 조합(케어/궁테라피/풀바디)은 정상가 유지 → "순수 브라질리언만" 정확 ✓. (저장 끝단 sale_details·유효기간은 데모에 근무직원 0이라 시술자선택 막혀 UI 마지막 클릭만 미실시 — 코드는 검증된 `_firstUsePkgIds` 패턴 동일.)
- **강남 구독권 상품**(`d8b8dd02`) is_subscription=true + 브라질리언(`rjdigkgac`) 무료·12개월 설정 완료 → 신규 구독권 판매부터 라이브 작동.
**유의**:
- 구독권 식별 = `services.is_subscription` 플래그. customer_packages는 `service_id`로 services 조회(없으면 service_name 매칭). **service_id=null 구버전 구독권 보유권은 무료 적용 안 됨** → service_id 연결 정정 필요.
- **박현지님(#32685) 기존 구독권 2건은 깨진 데이터**(쿠폰 `cpn_`·99회·service_id=null·유효기간 만료 2026-05-07) + 5/6 구매분(110만)은 보유권 미등록 → **데이터 정정 별도 필요**(정우님 확인 후): 5/6 구매분을 구독권 보유권(service_id=d8b8dd02)으로 등록 + 깨진 2건 정리 + 메모 "27/05/05까지" 유효기간 해석.
- 무료는 전 지점 적용(구매지점 제한 미적용 — 1차). 멀티테넌트: 시술명 하드코딩 0, 관리설정에서 매장별 구독권 상품·무료시술 지정.
- 데모 구독권(`demo_d8b8dd02`)도 시연용 설정됨 + 김서연 테스트 보유권(`pcd_demo_sub_test`) — 정리 미정.

### v3.7.949 — 구독권 표시 보강 (매출입력 카드 + 예약모달 무제한) (2026-06-01)
- **매출입력(SaleForm)**: 시술 목록 위에 구독권 보유 안내 카드 — "구독권 보유 · {무료시술명} 무제한 무료 (유효 ~YYYY-MM-DD / 첫 사용 시 1년 시작)". 직원이 "이 고객 브라질리언 무제한 무료"임을 바로 인지(`subPkgs` 기반, `_subSvcOf`로 promo_config.subFreeServiceIds → 시술명).
- **예약모달(ReservationModal)** 보유권 요약 pill: 구독권이 `else` 분기로 빠져 "99회"로 잘못 표시되던 것 → `_buildPkgSummary`에 `isSub`(service_id→services.is_subscription) 분기 추가 → **"무제한"**(유효기간 있음) / "사용 전"(미설정). 정우님 "구독권 99회 이거 아니잖아" 지적.
- **라이브 작동 확인**: v3.7.948 배포 후 박현지님 무료 미적용은 **정우님 브라우저 구버전 JS 캐시**가 원인이었음(서버 코드는 정상). 강한 새로고침 후 브라질리언 "구독권 무료" 0원 정상 작동 확인. total_count=99(수동 등록 기본값)여도 subscription은 횟수 무관(무료 정상).

### v3.7.950 — 예약모달 구독권 pill 유효기간 날짜 표시 (2026-06-01)
정우님 "차라리 날짜를 써" — v3.7.949에서 구독권 pill을 "무제한"으로 했으나 만료일 표시로 변경. `_buildPkgSummary` isSub value: `~${expM[1]}`(예: `구독권 ~2027-05-05`), 유효기간 미설정이면 "사용 전".

### v3.7.951 — 구독권 카드 테두리 제거 + 무료 적용 타이밍 버그 fix (2026-06-01)
- **테두리 제거**(정우님 "테두리선 넣지 말라고"): 매출입력 구독권 안내 카드 `border` 제거, 배경색(#eff6ff)만 ([[feedback_bliss_no_border_on_color_box]]).
- **무료 미적용 타이밍 버그**: 보유권(custPkgs) fetch 완료 전에 무료대상 시술을 먼저 체크하면 `subFreeSvcIds`가 비어 있어 `subFree`가 안 걸리고 정상가(154,000)로 남던 문제. → `subFreeSvcIds` 갱신 시 useEffect로 **이미 체크된 무료대상 시술을 자동 subFree 보정**. 정우님 스샷(브라질리언 체크인데 154,000) 원인.

### v3.7.952 — 네이버 리뷰 미답변 배지 로직 정리 (작업세션 머지) (2026-06-01)
작업세션(리뷰답변코드)에서 main 폴더 직접 작업한 것을 배포세션이 커밋·배포.
- **배지 기준 = `has_reply=false` 카운트(is_read 무관)**. 탭 열어도 배지 안 꺼짐 — 네이버에서 실제 답글이 수집(has_reply=true)될 때만 배지 감소.
- `NaverReviews.jsx`: 탭 진입 시 미답변 리뷰 `is_read=true` 읽음처리 블록 제거 + `onReviewChange` prop 제거(미사용).
- `AppShell.jsx`: 사이드바 리뷰 배지 쿼리에서 `is_read=eq.false` 조건 제거(`has_reply=eq.false`만) + 폴링 5분→**10분**.
- 유의: `MessagesPage.jsx:2057`의 `onReviewChange` 호출부는 남아있으나 NaverReviews가 prop을 안 받아 무시됨(무해). 배지는 AppShell `pendingReviewCount`(10분 폴링) 기준.

### v3.7.953 — 네이버 "답글쓰기" 버튼 미답변 필터 URL (작업세션 머지) (2026-06-01)
`NaverReviews.jsx openNaver`: 네이버 리뷰 답글쓰기 버튼 URL을 `new.smartplace`→**모바일 `new-m.smartplace`** + `?hasReply=false&menu=visitor`로 변경 → 클릭 시 네이버에서 **미답변 리뷰만 필터된 상태**로 열림(답글 작업 편의). 외부 URL이라 preview 검증 불가, 빌드만 확인.

### v3.7.954 — 블리스 AI 플로팅 버튼 임시 숨김 (2026-06-01)
정우님 "블리스ai 때문에 버튼을 못눌러 일단 숨겨" — 팀 채팅 하단 공지 발송 영역을 FloatingAI ✨ 버튼(우하단 fixed)이 가려 클릭 방해. `AppShell.jsx:2488` `<FloatingAI/>`를 `{false && ...}`로 숨김. **임시** — 복구는 false→true. ⏳ **후속**: FloatingAI 위치를 공지 입력 영역과 안 겹치게 조정 후 복구(또는 입력 영역 z-index/패딩 조정). import는 유지(미사용 경고 무해).

### v3.7.955 — 구독권 회원가 자격 부여 연동 (2026-06-01)
정우님이 구독권 상품에 "회원가 자격 부여"(`grants_member_price`) 토글 ON → **구독권 보유 고객이 무료대상(브라질리언) 외 시술도 회원가 적용**. 어제 "그 외 시술 정상가" 정책을 토글로 "회원가"로 전환.
- **발견**: `services.grants_member_price` 컬럼을 SaleForm이 원래 안 봄(이름 기반 자격만) + 구독권은 `validPkgs`에서 제외돼 이중으로 막혀 있었음.
- **fix**: `_subGrantsMember`(유효 구독권 중 grants_member_price ON 보유 여부) 신설 → `isMemberPriceFor`/`_computeIsMemberCustomer` 맨 앞에서 체크(잔액 무관 회원가). `validPkgs`엔 구독권 **미포함 유지**(차감·우측 보유권 표시에 "+99회" 부작용 방지). 강남·데모 구독권 grants_member_price=true 설정됨.
- 로컬 검증: 구독권 보유 김서연 "간단" 66,000→44,000(회원) 적용 + 우측 "+99회" 미표시 확인.

### v3.7.956 — 매출 통계/관리 디폴트 기간 = 이번 달 1일~말일 (2026-06-01)
정우님 "디폴트는 이번 달 한 달이라고 했잖아" — 디폴트가 `startDate=이번달1일, endDate=오늘`이라 오늘이 6/1이면 "6.1" 단일로 보였음. `SalesPage`에 마운트 useEffect 추가 — `periodKey==="month"`면 startDate=이번달1일, endDate=**이번달 말일**로 설정(기존 sessionStorage 단일날짜 값도 마운트 시 교정). 라벨 "6.1 ~ 6.30". 일 평균은 "매출 발생 일수"(RPC days) 기준이라 영향 없음, 미래 매출 0이라 합계 동일.

### 수정요청 처리 (2026-06-01) — 콜라보 자동응답 OFF + 만료일 빠른연장 (v3.7.957)
공지&요청 미처리 7건 중 처리. ("빠른 건부터" — 1·2 직원이동버그는 회귀위험·데모검증불가라 집중 세션 보류, 4·7은 consent 앱 위임.)
- **id_97nsuoms2b 대표 (서버, React 무관)**: 인플루언서 협업 대화 첫 답변에 몇 초 만에 "마케팅 담당자 연락" 자동응답 → 부자연. `ai_booking.py` `_outbound_collab` 분기를 `return ""`로(자동응답 OFF, 마케팅팀 직접 응대). manual(직원 ✨추천)은 게이트(`if not manual`) 우회라 추천은 그대로. `_inbound_collab`(손님이 콜라보 문의)은 안내 멘트 유지. 백업 `bak_collaboff_*`, restart. done+답글.
- **id_stf36ptp7m 강남 (v3.7.957)**: 고객 보유권 **만료일 수정 UX** — date input에서 기존 날짜가 남아 직접 입력 시 밀리는 문제. `PkgCard` 만료일 편집에 `onFocus` 전체선택 + **빠른 연장 버튼 [+6개월][+1년][+2년]**(오늘 기준, 타이핑 없이 클릭). done+답글(밀림 여전하면 재확인 요청).
- ⏳ 남음: **1·2 직원 타지점 이동 시 원지점 근무 사라짐**(현아 6/1 = 홍대{null,null}+강남{16:20,21}, getEmpActiveSegments가 종일 home세그먼트를 활성구간으로 못 풀어 사라짐. v3.7.907 회귀. 집중 세션 필요), **5 차트별 알림톡 멘트**(체크리스트/신규차트에 "구매 상품 안내" 오표기, 카카오 템플릿 검수 가능성), **4 동의서 중복·7 페이스추가**(consent 앱 위임).

### v3.7.958 — 타임라인 직원 타지점 이동 시 원지점 근무 사라짐 버그 fix (2026-06-01)
수정요청 1·2 (지은/강남 id_uk93cuje82/id_pmcdasxob0): 직원을 타지점으로 이동하면 원지점 직원 이름이 사라지는 버그.
**원인**: `normalizeSegments`의 `segHoursOf(branchId)` 반환값 `wh`가 null일 때(empWorkHours 미설정 + branch timelineSettings 없음) `wh.start`/`wh.end`에 접근해 TypeError → sort 깨짐 → 세그먼트 from/until이 null 그대로 → `mySeg.from !== mySeg.until` = `null !== null = false` → `hasActiveSeg=false` → 원지점 직원 컬럼 working에 미추가 → 사라짐.
**fix**: `wh.start`/`wh.end` → `wh?.start||"11:00"` / `wh?.end||"21:00"` null 안전 접근 + sort도 동일 방어. additive 변경이라 기존 동작(wh 있는 경우) 완전 보존.
**유의**: 데모에 실제 이동직원 없어 로컬 검증 제한적. 라이브에서 현아(홍대→강남 16:20 이동)로 확인 권장.

### v3.7.959 — 네이버 리뷰 "블리스에서 답글 직접 달기" (작업세션 머지) (2026-06-01)
작업세션(리뷰답변코드)이 main 폴더 작업 → 배포세션 빌드·배포. 서버 `/review-reply` 엔드포인트는 작업세션이 이미 배포·재시작 완료.
- `NaverReviews.jsx`: `submitReply(r)` 추가 — `blissme.ai/review-reply`로 `{reviewId, bizId, text}` POST → 성공 시 목록에서 제거(setReviews filter) + draft 삭제. 실패 시 에러 표시.
- "복사 후 네이버에서 붙여넣기" 안내 → **"블리스에서 달기" 버튼**(네이버 그린 #03C75A + N 아이콘). 블리스 안에서 바로 네이버 리뷰 답글 등록.
- React만 빌드·배포(서버는 이미 적용). 빌드 검증 통과. 네이버 답글 등록은 라이브 실제 리뷰로 확인 권장(데모 리뷰 데이터 없음).

### v3.7.960 — 네이버 리뷰 답글 UI 개선 + 방문자 고객 바로가기 (작업세션 머지) (2026-06-01)
- AI 답글 프롬프트: 작성자 닉네임/실명 사용 금지 → "고객님" 호칭(개인정보 보호). 리뷰 내용 위주 언급.
- 답글 textarea 항상 표시 + 버튼 단순화: [답글쓰기](블리스에서 직접 등록) + [AI 초안] 2개로 (기존 복사/다시/달기 3버튼 정리).
- 리뷰 헤더에 방문자 이름 칩 → 클릭 시 `visitor_name`으로 고객 검색 후 고객 상세 오픈(setPendingOpenCust). 네이버 바로가기 링크(모바일 미답변 필터)도 헤더에.
- prop 배선: MessagesPage/AppShell → NaverReviews에 setPage/setPendingOpenCust 전달.

### v3.7.961 + 서버 — 네이버 리뷰 배지 안 줄어듦 버그 fix + 버튼 라벨 (2026-06-01)
정우님: 네이버에서 직원이 직접 답변 달았는데 블리스 리뷰 배지(16)가 안 줄어듦.
**원인**: ① `review_sync.py sync_branch`가 "최근 30일 + 답글없는것"만 수집하고 답변완료 갱신도 30일 컷오프(`if dt<since: break`)에 걸려 중단 → 옛 미답변 건 영구 잔존. ② 더 결정적: DB에 옛날 수집된 리뷰 `review_id`가 네이버 현재 API의 review_id와 불일치(stale) → 답변완료 매칭 실패. 네이버엔 전 지점 미답변 0건인데 블리스 DB엔 17건 잔존.
**fix (서버 `review_sync.py`)**: `sync_branch` 재작성 — 답변완료(`hasReply=true`) review_id는 **30일 컷오프 무관 끝까지 스캔**(최대 40페이지)해서 DB `has_reply=true` 갱신(100개씩 청크 PATCH). 신규 미답변 upsert만 30일 유지. 백업 `review_sync.py.bak_replysync_*`. **검증**: 강남 3건→260건 스캔.
**데이터 정리**: 네이버 전 지점 미답변 0건 확인 후, DB 잔존 미답변 17건(stale review_id, 네이버 현재 리뷰에 없음)을 `has_reply=true` 일괄 정리 → 배지 0.
**v3.7.961 (React)**: NaverReviews 답글 등록 버튼 라벨 "답글쓰기" → **"네이버에 등록"**(textarea에 작성 후 네이버 등록임을 명확히, 정우님).
**유의**: 미래 네이버 review_id 체계가 또 바뀌면 stale 재발 가능 — 그땐 "네이버 전체 미답변 0이면 DB도 0" 식 동기화 보강 검토.

### v3.7.962 — 네이버 리뷰 방문자명 클릭 → 최근 예약 블록 포커싱 (2026-06-01)
정우님: 리뷰 방문자명(김윤지·이서연 등) 클릭 시 무반응(기존 v3.7.960은 고객 검색 후 상세 오픈인데 name 정확일치 0건이면 아무 동작 안 함) → "고객의 최근 예약 블록을 포커싱"으로 변경.
- `NaverReviews` visitor_name 클릭 핸들러 재작성: ① 이름으로 customers 조회(cust_id) → ② 최근 예약(cust_id 우선, 없으면 cust_name, is_schedule=false, date·time desc limit 1) → `setPendingOpenRes({...,_highlightOnly:true})` + `setPage('timeline')`로 타임라인 예약 블록 포커싱+빨강 강조. 예약 없으면 고객 상세, 매칭 실패면 고객관리 페이지 폴백.
- prop 배선: MessagesPage MessagesWithTeamTab → NaverReviews에 `setPendingOpenRes` 전달(AppShell→AdminInbox는 기존).

### 서버 — AI active mode 30분 시간 윈도우 추가 (영업시간 지연 무시 버그 fix) (2026-06-01, React 변경 0)
정우님: 영업시간엔 미응답 3분 후 AI 답변(직원 우선)인데 실시간으로 답하고 있음.
**원인**: `ai_booking.py` active mode 판정(AI가 한 번 답한 thread + 그 후 직원 outbound 없으면 즉시 응답)에 **시간 제한이 없었음** → 8일 전(5/22) AI 답변 하나로 영구 active → 영업시간 3분 지연 무시하고 즉시 응답.
**fix**: active mode를 **최근 30분 이내 AI 답변**일 때만 인정(`processed_at` 30분 윈도우). 그 이상 지난 대화는 새 대화로 보고 영업시간 delay(3분) 정상 적용. 연속 대화 흐름(방금 AI가 답하고 손님이 바로 추가 질문)만 즉시 유지.
**적용**: 서버 직접(백업 `ai_booking.py.bak_activewindow_*`) + restart. React 변경 0 → 버전업·CF퍼지 불필요.
**정책 정리**: ① 야간(스케줄 윈도우): 즉시 ② 영업시간+delay ON: 3분 후 직원 미응답 시 AI ③ active mode(최근 30분 연속 대화): 즉시 ④ 영업시간+delay OFF: 차단.

### v3.7.963 — 리뷰 방문자명 클릭 예약 포커싱 fix (cust_name+bid 매칭) (2026-06-01)
정우님: v3.7.962 후에도 리뷰 고객명 클릭 시 예약 포커싱 안 되고 고객 상세만 열림.
**원인**: v3.7.962 핸들러가 `cust_id=eq.{custId}`로 예약 조회했는데 **reservations에 cust_id가 비어있는 경우가 많음**(cust_name으로만 연결, rsv_by_id=0) → 예약 0건 → 폴백 고객상세. + 동명이인(김윤진 11명)이라 customers name=eq limit=1로 엉뚱한 사람 cust_id 잡힘.
**fix**: 핸들러를 **`cust_name=eq.{visitor_name}&bid=eq.{리뷰 bid}`** 최근 예약 조회로 변경(cust_id 의존 제거, 같은 지점으로 동명이인 좁힘). 지점 예약 없으면 지점 무관 최근 예약, 그것도 없으면 고객관리 페이지 폴백. setPendingOpenRes로 타임라인 블록 포커싱.
**유의**: cust_name 완전일치 + 같은 지점 기준. 동명이인이 같은 지점에 여러 명이면 가장 최근 예약자로 감(드묾). 리뷰 데이터에 전화 등 정밀 키 없어 이름+지점이 최선.

### v3.7.964 — 리뷰 방문자명 예약 포커싱: 숨김 예약(naver_changed) 제외 (2026-06-01)
정우님: v3.7.963 후에도 채승주 안 뜸.
**원인**: 채승주 최근 예약이 `status=naver_changed`(변경되어 사라진 구예약) — 타임라인은 naver_changed를 항상 숨김(v3.7.727)이라 setPendingOpenRes로 가리켜도 블록이 없어 포커싱 실패.
**fix**: 핸들러 예약 조회에 `status=not.in.(naver_changed,naver_cancelled)` 추가 → 타임라인에 실제 표시되는 예약만 포커싱. 채승주는 6/1 completed 예약으로 정상 점프.

### v3.7.965 — 네이버 리뷰 AI 답글: 고객 최근 방문 메모 참고 안부 (작업세션 머지) (2026-06-01)
작업세션(naver-review-rollout)이 main 직접 작업 → 배포세션 빌드·배포.
- `NaverReviews.jsx` AI 답글 생성 시: visitor_name이 customers와 **정확히 1명** 매칭되면 최근 매출 memo 2건(최대 500자) 조회 → 프롬프트에 "[고객 최근 방문 메모]" 주입. 메모에 여행·이사·경조사 등 **가벼운 안부거리**가 명확하면 답글 끝에 한 문장 자연스럽게 덧붙임. 단 시술부위·패키지·금액·횟수·신체·건강 등 민감/내부 정보는 답글에 절대 미사용, 안부거리 없으면 생략.
- React only. 동명이인(2명+)이면 메모 조회 안 함(오매칭 방지).

### 서버 — AI 답변추천 직원 지시 모드 버그 fix (지시 무시하고 제멋대로 답하던 문제) (2026-06-01, React 변경 0)
**증상**(정우님): 메시지창 입력칸에 "신규고객 할인 이벤트를 알려줘" 쓰고 [AI 답변 추천] 눌렀는데, AI가 **직원 글을 무시하고 고객 마지막 메시지에만 반응**(지 하고 싶은 말만 함). v3.7.942 직원 지시 모드가 사실상 작동 안 함.
**원인** (`ai_booking.py` 순서 버그): `chat_messages`(AI에 보낼 멀티턴 배열)가 **1588줄**에서 원본 user_msg(=고객 마지막 메시지)로 빌드됨 → instruction 재작성은 **1624줄**(그 후)에서 `user_msg`만 바꾸고 `chat_messages`는 안 건드림. AI 호출(2756 `_final_user=chat_messages[-1]`)은 chat_messages를 쓰므로 **직원 지시가 AI에 영영 안 닿음**. 클라이언트(`instruction` 전송)·엔드포인트(`/ai-suggest`)·프롬프트(이벤트/할인 정보 1816~1942줄 완비) 다 정상 — 오직 이 동기화 누락.
**fix**: instruction 블록에서 user_msg 재작성 후 `chat_messages[-1]`(마지막 user 턴)을 그 지시로 **교체**(없으면 append). 지시 wrapper에 ① "직원 지시가 대화흐름·고객메시지보다 우선" 강조 ② 참고용 고객 직전 메시지 임베드(맥락 보존) ③ 지시 무관한 말(예약권유 등) 덧붙이기 금지 추가.
**검증**(라이브 suggest_only, 부작용0): 실제 인스타 thread(영어 고객)에 "신규고객 할인 이벤트를 알려줘" 지시 → AI가 브라질리언 5만/8만 할인 + 10% 적립을 정확히 **고객 언어(영어)로** 작성. 지시 정확 수행 + 고객 언어 유지 확인.
**적용**: 서버 직접(백업 `ai_booking.py.bak_pre_instrsync_*`) + `systemctl restart bliss-naver`(active). React 변경 0 → 버전업·CF퍼지 불필요.
**유의**: 직원 지시는 한국어로 쓰더라도 발송 메시지는 **고객 언어**로 작성됨(reply_lang = 고객 마지막 메시지 기준). 가격·이벤트·할인은 프롬프트 실제값만 사용(지어내기 금지). suggest_only라 예약 INSERT 안 됨(answer만 입력칸에 채워짐 → 직원 검토 후 발송).

### v3.7.966 — 네이버 리뷰 AI 답글 말투 변경 (사장님체 → 20대 여직원 캐주얼) (작업세션 머지) (2026-06-01)
작업세션(naver-review-rollout)이 main 직접 작업 → 배포세션 빌드·배포.
- `NaverReviews.jsx` AI 답글 프롬프트: "왁싱샵 사장님, 진심 어린 존댓말" → **"20대 여직원, 밝고 친근하며 살짝 캐주얼한 말투"**("~해요", "~하셨다니 너무 좋아요", "ㅎㅎ", "넘 감사해요" 톤). 딱딱한 문어체("~보람을 느낍니다" 등) 금지 명시. 이모지·이모티콘 **절대 금지**(텍스트만, 'ㅎㅎ' 정도 허용 — 기존 0~1개 허용에서 강화). 고객 호칭 "고객님"·닉네임 미사용·리뷰 내용 콕 집어 감사·재방문 캐주얼 유도는 유지.
- React only.
- ⚠️ 직전 v3.7.965 배포 시 `AppShell.jsx` BLISS_V를 git add 누락(version.txt만 커밋) → git이 3.7.964로 어긋나 있던 것 이번에 함께 정리(라이브는 정상이었음). [[feedback_bliss_commit_with_deploy]]

### v3.7.967 — 네이버 리뷰 AI 답글 안부 문구 시점 보정 (작업세션 머지) (2026-06-01)
작업세션(naver-review-rollout) main 직접 작업 → 배포세션 빌드·배포.
- `NaverReviews.jsx` 고객 메모 기반 안부 한 문장: 여행 등 **이미 했는지/예정인지 시점 불확실**하면 과거형("다녀오셨어요?") 금지 → 응원·기원 미래형("제주도 여행 즐겁게 잘 다녀오세요!", "즐거운 여행 되시길 바라요!")으로. 민감/내부정보 미사용·안부거리 없으면 생략은 유지.
- React only.

### v3.7.968 — 네이버 리뷰 답글: 배지 즉시감소 + 입력창 자동높이 + 프롬프트 개선 (작업세션 머지) (2026-06-01)
작업세션(naver-review-rollout) main 직접 작업 → 배포세션 빌드·배포.
- **배지 즉시 감소**: 답글 등록(submitReply 성공) 시 `onReplyDone` → MessagesPage `setReviewPending(-1)` + `onReviewReplied` → AppShell `setPendingReviewCount(-1)`. 사이드바·탭 리뷰 배지가 답글 즉시 줄어듦(기존엔 10분 폴링/네이버 동기화 기다려야 했음). AdminInbox 2곳(패널·/messages) 배선.
- **입력창 자동 높이**: 답글 textarea → `AutoTextarea`(내용 따라 높이 자동 확장, 최소 60px). 고정 3행 → 긴 답글도 잘림 없이.
- **프롬프트 개선**: ① 리뷰 문장 큰따옴표 그대로 인용 금지(핵심 느낌만 내 말로) ② 진부한 상투어("정말 감동받았어요"·"믿고 찾아주셔서") 대신 그 리뷰에만 맞는 구체적 한마디.
- React only.

### v3.7.969 — 네이버 리뷰 답글 프롬프트 few-shot 예시 추가 (작업세션 머지) (2026-06-01)
작업세션(naver-review-rollout) → 배포세션 빌드·배포. `NaverReviews.jsx` AI 답글 프롬프트에 **나쁜 예/좋은 예** 추가 — 나쁜 예(리뷰 큰따옴표 따라읽기+진부함) vs 좋은 예(핵심 느낌만 내 말로 캐주얼하게). 따라읽기 금지 룰 강화. React only.
