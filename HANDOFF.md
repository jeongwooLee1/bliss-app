# HANDOFF

## 현재 버전
- **라이브: v3.7.730** (https://blissme.ai/version.txt) — 2026-05-16 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수
- 변경 이력은 [CLAUDE.md](./CLAUDE.md) 참고

## 진행 중 작업
정우님 수정요청 `id_o6tib4mrmq` 2건 중 1건 미처리:
- **AI 마취크림 안내** — 자동응답 AI가 "마취크림 사용 안 함 (한국 살롱 금지)"라고 답하도록.
  서버/DB 작업(AI FAQ 또는 ai_booking 프롬프트)이라 React 배포와 별개. 유저 컨펌 대기 중.
- (배지 버그·시술자 휴무 노출은 v3.7.729로 처리 완료)

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
