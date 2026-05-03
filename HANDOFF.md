# HANDOFF

## 현재 버전
- **라이브: v3.7.408** (https://blissme.ai/version.txt) — 2026-05-03 배포
- 다음 빌드 시 `BLISS_V` (AppShell.jsx) + `public/version.txt` 둘 다 함께 bump 필수

## 현재 작업
**없음** — 새 세션에서 이어받기

---

## 최근 작업 요약 (2026-05-03)

v3.7.391 → v3.7.408 — 자세한 내용은 CLAUDE.md "v3.7.391 → v3.7.408" 섹션 참고.

핵심 변경:
- 베타 타임라인 데이터 격리 (`is_beta` 컬럼, 라이브 5개 fetch 필터, Realtime 차단)
- 동반자 묶음: Ctrl/Cmd+드래그 복사 (이름 자동 suffix, group_id 자동, 색 도트 매칭) + 커플룸 태그 자동 동반자
- 매출 확인 모달 보유권 차감 스냅샷 복원 (`pkgItems`)
- 미배정 칼럼 클릭 시 명시 배치 (`nv_*` ID 유지)
- `last_date` 컬럼 오타 fix (서버 + 클라이언트) — 신규 태그 잘못 부여 11건 backfill 정리
- AI 프롬프트 "상담" 키워드 매칭 금지로 반전
- ★기존상담 트리거 활성 보유권 체크 (단골 보호)
- 막기 컬럼 헤더 SVG 변경 (초록 N + 빨강 금지 도트)
- 신규예약 알림 배너 — 네이버만, pending/reserved 라벨 분리
- PGRST102 회피 (bulk upsert 키 정규화)
- scheduleLog array TypeError 핫픽스 (v3.7.398 → v3.7.399)

---

## 보류 중 / 차후 검토
- **이준하 토탈 PKG 회수** — 직원 메모 "토탈4+소급1=5"인데 DB total_count=6. 직원과 상의 후 결정
- **AI 분석 잘못 매칭된 selected_services backfill** — 유저가 그대로 두라고 결정
- **호버 그룹 하이라이트** — 동반자 색 도트 1차 적용. 호버 시 같은 그룹 outline 강조는 추후
