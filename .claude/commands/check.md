---
description: 서버 상태 + 최근 로그 확인
allowed-tools: Bash
---

블리스 서버 상태를 확인합니다:

1. 서버 프로세스: `ssh bliss-server "sudo systemctl status bliss-naver --no-pager | head -10"`
2. 최근 에러: `ssh bliss-server "sudo journalctl -u bliss-naver --since '30 min ago' --no-pager | grep -i 'error\|fail\|Error' | tail -10"`
3. 최근 활동: `ssh bliss-server "sudo journalctl -u bliss-naver --since '5 min ago' --no-pager | tail -10"`
4. 배포 버전: `ssh bliss-server "grep 'index-' /var/www/html/bliss-app/index.html"`

결과를 요약해서 알려주세요.
