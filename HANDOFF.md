# HANDOFF

## 현재 버전
- **라이브: v3.7.749** (https://blissme.ai/version.txt) — 2026-05-18 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업 — 커플 패키지 기존 구매자 소급 적용 페이지
**상태**: 커플 패키지 신규 판매 흐름은 v3.7.749 배포 완료 (CLAUDE.md 참고). 다음으로 **기존 커플 패키지 구매자 소급 적용 페이지** 구현 중.
**할 일**: 이미 커플 패키지(`services.is_couple=true`)를 구매했지만 구버전 방식이라 보유권이 구매자 1명한테만 있는 케이스 — 관리 페이지에서 행별로 상대방을 지정하면 상대방 N회 보유권 + `customer_shares` + 양쪽 note `커플:<gid>`를 소급 생성. 식별: `customer_packages` 중 service가 커플 패키지인데 note에 `커플:` 없는 행. 관리설정 → 사업장 관리 하위 페이지로(`AdminLongValidityReview` 패턴 참고).

## 동의서 요청→서명 흐름 점검 — 워크트리 작업세션 예정 (2026-05-17)
**상태**: 코드 흐름(요청 `ConsentModal` → `consent_tokens` INSERT → `sign.blissme.ai` 서명 → `html2canvas`+`jsPDF` PDF → Storage → `customer_consents` INSERT → `consent_tokens.used_at` 마킹 → `ConsentPanel` realtime 이력)은 완성·정상 구현 확인. 단 **실사용 0건** — `customer_consents` 14건 전부 테스트 데이터(홍길동 `cust_test_hgd` · ilayda), 2026-04-24 이후 서명 기록 없음.
**다음 할 일**:
- 라이브 e2e 테스트 — 테스트 고객으로 동의서 요청 → `sign.blissme.ai` 실제 서명 → PDF·이력 생성 확인 → 테스트 데이터 정리
- DB 4/20 개발초기 잔재(PDF 없는 4건 · orphan 고객 `cust_id_6cmcej4sk3` 4건) — 현재 코드 버그 아님, 정리 여부만 판단
**참고**: 사인 앱 = `bliss-consent` 별도 프로젝트(`sign.blissme.ai`, 직원 담당). 로컬 사본 코드는 최신(키오스크 직원 직접 모드까지 반영), `bliss-consent/HANDOFF.md`만 4/20자로 낡음. 점검 시 라이브 사인앱에 접속함.

## 기타 미해결
- 카카오 예약 확정 알림톡: 실발송 테스트 미실시 — 카카오 테스트 예약 1건으로 검증 권장
- 시크릿 키 settings 탈출(2026-05-17, CLAUDE.md 참고): 6키 env 전환 완료 + `wa_token`·`ig` 토큰도 settings 의존 제거(Edge Function→`app_secrets` 테이블 / bliss_naver.py→env). **남은 일(동의서 세션)**: `businesses.settings`에서 6키 + `wa_token`·`ig_token`·`ig_tokens` 제거. 그 후 settings엔 `gemini_key`·`deepl_key`만 남음(클라이언트 사용, 서버화는 별도 큰 작업) → 그게 끝나야 settings RLS 잠금 가능

## 미처리 — 현아 커플패키지 질문 (id_eih96ttwa0, reviewing)
"커플패키지 3회: 한 분 매출로 3회 등록 + 다른 분 고객관리에서 3회 등록? 아니면 6회로 쉐어 사용?" — 운영 방식 결정 필요. **유저가 보류 지시 (2026-05-17)** — 제품쿠폰 건 우선 처리 후 보류. 답변 미작성.

## 참고 — 라이브 키 대기 (별도 트랙, 외부 의존)
토스 라이브 키 발급 시 Supabase Edge Functions ENV 3개 등록 필요:

| Key | Value | 비고 |
|---|---|---|
| `TOSS_BLISS_CLIENT_KEY` | `live_ck_*` | 공개 가능 (React 번들 OK) |
| `TOSS_BLISS_SECRET_KEY` | `live_sk_*` | 절대 프론트 노출 X |
| `TOSS_BLISS_IS_TEST` | `false` | 라이브 모드 |

등록: Supabase Dashboard → Project Settings → Edge Functions → Add new secret.
키 없는 상태에서 매장이 충전 시도하면 `503 TOSS_BLISS_* not configured`.
송정윤 매니저(010-4928-1242) 토스 심사 답변 메일 회신 대기 중.

## 인수인계 체계
3계층 분리. 자세한 내용은 CLAUDE.md 참고.
