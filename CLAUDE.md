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
- `naver_messages` 테이블: 모든 채널(네이버/WhatsApp/카카오 등) 메시지 저장
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

## 필수 규칙
- 매 작업 완료 후 CLAUDE.md에 변경된 내용 업데이트
- 업데이트 후 반드시 실행: `git add CLAUDE.md && git commit -m "docs: update" && git push`

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

### 코드 리팩터링 (진행중)
- Phase 1 완료: src/components/common/index.js — 공통 UI 컴포넌트 라이브러리
- Phase 2~6 예정: AppShell/ReservationsPage/Timeline/Modal 분리
