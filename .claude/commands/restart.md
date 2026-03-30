---
description: 블리스 서버 서비스 재시작 (bliss-naver, bliss-relay)
allowed-tools: Bash
---

블리스 서버 서비스를 재시작합니다:

1. `ssh bliss-server "sudo systemctl restart bliss-naver"` 네이버 스크래핑/WhatsApp 서비스 재시작
2. `ssh bliss-server "sudo systemctl restart bliss-relay"` CMD relay 서비스 재시작
3. 재시작 후 상태 확인: `ssh bliss-server "sudo systemctl status bliss-naver --no-pager | head -5; sudo systemctl status bliss-relay --no-pager | head -5"`

결과를 요약해서 알려주세요.
