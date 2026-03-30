---
paths:
  - "src/components/Timeline/**"
---

# 타임라인 코딩 규칙

- 직원 목록은 반드시 employees_v1에서 로드 (data.rooms 사용 금지)
- SCH_BRANCH_MAP으로 branch 키 → branch_id 매핑
- "지원(강남)" 상태는 parseSupportBranch()로 처리
- 블록 이동 시 staffUpdate는 모든 블록 타입에 적용 (네이버 예약뿐 아니라 내부일정/일반예약도)
- 내부일정 이동: 팝업 없이 바로 DB 저장
- 알림톡 조건: 시간 변경 + 010 고객만 팝업
- Realtime + 10초 폴링 병행
