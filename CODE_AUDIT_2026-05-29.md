# Bliss 전체 코드 점검 보고서 (READ-ONLY 감사)

- 작성일: 2026-05-29 (KST)
- 점검 대상 버전: **3.7.902** (`public/version.txt` = `BLISS_V` 일치 확인)
- 점검 범위: 프론트엔드(bliss-app), 서버 AI 엔진(`ai_booking.py`), Supabase 트래픽
- **상태: 코드 변경 0건. 발견 사항만 정리. 어떤 항목을 실제로 손볼지 정우님 확인 후 진행.**

> 본 보고서는 정우님 요청("퍼포먼스/불필요 코딩/보안/AI 프롬프트 모순/서버 트래픽/로딩시간 싹다 천천히 점검")을
> 6개 관심사로 묶어 우선순위순으로 정리한 것입니다.
> CLAUDE.md 변경 이력과 교차 확인하여 **이미 완료된 작업은 재추천하지 않았습니다.**

---

## 0. 요약 — 우선순위 TOP (효과 큰 순)

| # | 항목 | 분류 | 효과 | 위험도 | 비고 |
|---|------|------|------|--------|------|
| 1 | pdfjs 정적 import → 동적 전환 | 로딩 | 메인 번들 ~1.2MB 감소 | 중 | ConsentDocsViewer 의존성 주의 |
| 2 | `bank_deposits` 폴링·채널 중복 제거 | 트래픽 | 폴링/채널 2→1 | 낮 | DepositsAlertBanner ↔ 사이드바 배지 |
| 3 | Realtime 채널 통합 (Phase 2 미완) | 트래픽 | DB 커넥션 압력 직접 감소 | 중 | 2026-05-23 장애 근본원인 |
| 4 | `sb.get`/`sb.getAll` `select=*` 좁히기 (Phase 3) | 트래픽 | 응답 크기·전송량 감소 | 중 | loadReservations ~10MB |
| 5 | TimelinePage 미메모이즈 핫스팟 | 성능 | 렌더 CPU 감소 | 중 | blocks 필터, allRooms flatMap |
| 6 | Gemini/DeepL 키 클라 노출 | 보안 | 키 유출 위험 | 중 | businesses.settings 경유 |
| 7 | 확정 죽은 파일 제거 | 불필요코드 | 번들·유지보수 | 낮 | translator.js 등 |
| 8 | AI 시스템 프롬프트 모순 정리 | AI | 토큰·일관성 | 낮 | 서버 ai_booking.py |

---

## 1. 로딩 시간 (콜드 로드)

### 1-1. [최우선] pdfjs 정적 import가 메인 번들에 ~1.2MB 고정
- 위치: `src/lib/aiDocs.js` 상단
  - `import * as pdfjsLib from 'pdfjs-dist'`
  - `import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`
- 문제: `aiDocs.js`가 MessagesPage / BlissAI / FloatingAI 등 **공통 경로에서 import**되므로
  pdfjs(~1.2MB)가 메인 번들에 고정됨. `ConsentDocsViewer.jsx`의 동적 import 노력이 **무력화**됨.
- 배경: v3.7.743에서 mammoth/xlsx/jszip은 동적 전환 완료. **pdfjs만 누락.**
- 권장: pdfjs를 동적 import로 전환. 단, ConsentDocsViewer(v3.7.891/895)가
  `aiDocs`의 정적 존재에 의존하므로 **의존성 끊고 분리 필요** (단순 전환 시 깨질 수 있음).
- 효과: 메인 번들 현재 ~2,098KB → pdfjs 분리 시 ~900KB대 기대.

### 1-2. 번들 현황 (참고, 이미 개선된 부분)
- v3.7.743 동적 import 다이어트로 2,932KB → 2,098KB (~28% 감소) — **완료됨, 재작업 불필요.**
- nginx 정적 자산 캐싱(v3.7.743 후속)도 적용됨 — **완료.**
- 남은 큰 덩어리는 pdfjs(1-1).

---

## 2. Supabase / 서버 트래픽 (2026-05-23 장애 근본원인 영역)

> 2026-05-23 장애 = Postgres 커넥션 풀 고갈("connection pool cannot serve them fast enough").
> 원인: 디바이스당 Realtime 채널 과다 + `reservations.*` 풀페치 빈번 + 짧은 폴링 다수.
> v3.7.837 "Phase 1"에서 다수 폴링을 120s+로 완화. **Phase 2(채널 통합)/Phase 3(select 축소)는 미완.**

### 2-1. [높음] `bank_deposits` 폴링·채널 중복
- 위치: `AppShell.jsx`
- 문제: **DepositsAlertBanner**와 **사이드바 배지**가 동일 테이블/필터에 대해
  각각 120s 폴링 + Realtime 채널을 따로 보유 → 같은 데이터 2배 호출.
- 권장: 단일 소스로 통합(한 곳에서 구독→props/context로 전달). 폴링 2→1, 채널 2→1.

### 2-2. [높음] Realtime 채널 과다 (Phase 2 미완)
- 현황(대략):
  - `AppShell.jsx` ~9개 채널
  - `TimelinePage.jsx` ~7개 채널
  - `useData.js` `schedule_data` 채널 3개(분리됨 → 통합 후보)
- 문제: 디바이스당 채널 수가 커넥션 풀 압력의 직접 원인. 매장에서 여러 기기 동시 사용 시 곱연산.
- 권장:
  - 같은 테이블 다중 채널 → 단일 채널 + 클라이언트측 필터 분기로 통합.
  - `useData.js`의 `schedule_data` 3채널 → 1채널.
  - 통합 후 폴링 폴백 간격 재검토.

### 2-3. [중] `select=*` 하드코딩 (Phase 3 미완)
- 위치: `src/lib/sb.js` — `sb.get`(line 22), `sb.getAll`(line 34) 둘 다 `select=*` 고정.
- 문제: 모든 컬럼 전송. 특히 `AppShell.jsx`의 백그라운드 `loadReservations`
  (~30일/~8000행/~10MB)가 전 컬럼을 끌어옴.
- 권장: 호출부별로 필요한 컬럼만 select. 최소한 loadReservations 같은 대량 페치부터 컬럼 화이트리스트 적용.
- 주의: `sb.get` 1000행, `sb.getAll` 1000행/페이지 페이지네이션은 정상(PostgREST db-max-rows=1000). **페이지네이션 자체는 v3.7.728/744/756에서 수정 완료** — 재작업 불필요.

### 2-4. (참고) 폴링 간격
- v3.7.837 Phase 1에서 다수 폴링 120s+로 완화 — **완료.**
- 메시지 폴링 5초는 운영 요구사항(규칙 문서화됨) — 유지.
- TimelinePage 베타 폴링 30s `select=*` (2-3과 연계해 컬럼 축소 검토).

---

## 3. 프론트엔드 성능 (렌더링)

### 3-1. [중] `TimelinePage.jsx` 미메모이즈 핫스팟 (~5000-6000줄)
- React.memo 0개, 가상화(virtualization) 없음.
- 매 렌더마다 재계산되는 비싼 연산:
  - **blocks 필터: 전체 reservations 순회 (최악)** → `useMemo` 의존성 고정 필요.
  - `allRooms` flatMap → `useMemo` 후보.
- 권장: 핫스팟 `useMemo`/`useCallback` + 행/슬롯 컴포넌트 `React.memo`. 장기적으로 가상 스크롤 검토.

### 3-2. [낮] 중복 객체 키 버그
- 위치: `TimelinePage.jsx` settings 버튼 style 객체 —
  `background`, `border`, `borderRadius`, `padding`이 **각각 두 번 선언**(뒤 값이 앞을 덮음).
- 영향: 동작은 하지만 의도 불명확/유지보수 혼란. 정리 권장.

### 3-3. [낮] console.* 잔존
- `TimelinePage.jsx`에 ~61개 `console.*`. 프로덕션 빌드에서 제거 또는 빌드시 strip 설정 검토.

---

## 4. 보안

> 보안 감사 결론: **실제로 손볼 가치 있는 건 1건(클라 노출 키)**, 나머지는 의도된 설계이거나 낮음/정보성.

### 4-1. [중] Gemini/DeepL 키가 클라이언트에 노출
- 경로: 매장별 `businesses.settings.gemini_key` →
  `window.__geminiKey` / `window.__systemGeminiKey` / `localStorage.bliss_gemini_key`
  → `nameTransliterate.js` 등에서 `fetch(${GEMINI_URL}?key=${geminiKey})` 클라 직접 호출.
- 시스템 키: `businesses` `code=eq.__system__`의 `system_gemini_key` 읽기(AppShell ~609/621/2007).
- 위험: 브라우저 네트워크/스토리지에서 키 추출 가능 → 키 오남용/과금 위험.
- 권장: Gemini 호출을 **서버 프록시(엣지/서버)로 이전**하여 키를 클라에서 제거.
  최소한 키 권한·쿼터 제한 + 키 회전 가능 상태 유지.
- 참고: `SB_KEY`(publishable, sb.js)는 **공개 설계가 맞음** — 문제 아님.

### 4-2. [낮/정보성] 기타
- `main.jsx` innerHTML 에러 표시 → 브라우저 내부 에러 문자열(사용자 입력 아님). 코스메틱.
- `.env`(gitignore, untracked, VITE_ 아님) — 실 TG_TOKEN/CF_TOKEN 보유, bash 배포용.
  파일 권한 `rwxrwxrwx`(world-readable) → **로컬 위생상 `chmod 600` 권장** (프론트 노출과 무관).
- 인증: `auth_login_v2` RPC + `localStorage.bliss_session` — application-level 인증(설계대로).
- 새 테이블 추가 시 RLS `ENABLE` + `anon_all_X` 정책 유지 규칙은 준수 중.

---

## 5. 불필요한 코드 (죽은 코드)

> 제거 전 각 파일 importer 재확인 필수. 아래는 후보 + 확정 표기.

### 5-1. [확정] `src/lib/translator.js`
- 이번 점검에서 **importer 0개 확정**(`grep "translator" src/` → 자기 자신만).
- 내부 DeepL 호출은 도달 불가(unreachable). 안전 제거 가능.

### 5-2. [후보] 미참조 파일 (제거 전 재확인)
- `src/lib/AuthContext.jsx` (CLAUDE.md v3.7.761 dead 표기)
- `src/pages/LoginPage.jsx`
- `src/lib/useReservations.js`
- `src/lib/groq.js`
- `src/components/Chat/mockData.js`
- 구 Admin 버전: `TagSettings.jsx` / `WorkerSettings.jsx` / `BranchSettings.jsx` / `ServiceSettings.jsx`
  (ReservationsPage AdminPage로 대체됨)
- `CustomersPage.jsx`의 `openSaleFullEdit` (호출부 없음, CLAUDE.md v3.7.738 확인)

### 5-3. [제거 금지] 의도된 `{false && ...}` 블록
- `Sidebar.jsx:49` — plan/balance 카드 숨김(토스 심사용 v3.7.722)
- `AdminAISettings.jsx` — API 키 섹션 숨김(v3.7.870)
- → **죽은 코드 아님. 손대지 말 것.**

---

## 6. AI 응답 프롬프트 (서버 `ai_booking.py`, ~3,036줄 / 시스템 프롬프트 ~390줄)

> 서버 파일은 bliss-app git에 없음(별도 repo). AI 모델 = **Gemini 3.5 Flash + gpt-4.1-mini 폴백**으로
> 확정·최적 상태(CLAUDE.md 2026-05-26) → **모델은 지시 없이 변경 금지.** 아래는 프롬프트 텍스트 정리 건만.

### 6-1. 모순/중복 (정리 후보)
- 성별 규칙 ~6회 반복 + "물어봐 vs 묻지마" 긴장. (현 정책: 성별 물어보되 강요 금지, 빈값 진행 — feedback 반영)
- 연락처 optional/required 긴장(어디선 필수, 어디선 선택).
- 예약 확정 안내 문구 3회 복붙.

### 6-2. 스테일/잔재 (정리 후보)
- 옛 모델 언급 주석.
- orphan 태그 라인 `(v3.7.408)`.
- 디버그 breadcrumb `id_tixg5pc9nf`.
- 규칙 번호 매김 혼재.
- 8개 지점 하드코딩 리스트 → DB `{branches}` 블록 사용으로 대체 권장(멀티테넌트 원칙).

### 6-3. 주의
- v3.7.408 이후 multilang/RAG/이탈수정/게이트 등 **수많은 surgical 편집**이 누적됨.
  위 항목 중 일부는 이미 해소됐을 수 있으므로 **실제 수정 전 현재 서버 파일과 라인 단위 재대조 필수.**

---

## 7. 후속 진행 방법 (정우님 결정 대기)

각 항목은 독립적으로 적용 가능합니다. 손볼 항목을 골라주시면:
- 프론트 변경: 로컬(localhost:5173) 컨펌 → 배포세션에서 빌드/배포/퍼지/버전업/커밋·푸시 일괄.
- 서버(ai_booking.py): ssh+scp+`systemctl restart bliss-naver` (React 변경 0 → 버전업/퍼지 불필요).

**추천 착수 순서(저비용·고효과):**
1) 2-1 bank_deposits 중복 제거 (위험 낮, 트래픽 즉효)
2) 1-1 pdfjs 동적화 (로딩 즉효, 의존성 주의)
3) 5-1 translator.js 제거 (확정 안전)
4) 2-2 Realtime 채널 통합 (장애 근본원인, 신중)
5) 4-1 Gemini 키 서버 프록시화 (보안, 설계 변경)
