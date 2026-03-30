---
description: 블리스 서버 실시간 로그 조회 (최근 N분)
allowed-tools: Bash
---

블리스 서버 로그를 조회합니다. 인자가 있으면 해당 분 수만큼, 없으면 최근 10분:

$ARGUMENTS 가 있으면 해당 값(분), 없으면 10분을 기본값으로 사용합니다.

1. `ssh bliss-server "sudo journalctl -u bliss-naver --since '$MINUTES min ago' --no-pager | tail -50"` 최근 로그
2. 에러가 있으면 별도로 하이라이트: `ssh bliss-server "sudo journalctl -u bliss-naver --since '$MINUTES min ago' --no-pager | grep -i 'error\|fail\|exception\|traceback' | tail -20"`

에러가 있으면 원인 분석, 없으면 정상 동작 확인 메시지를 알려주세요.
