---
description: 네이버 세션 갱신 (로컬 playwright 로그인)
allowed-tools: Bash
---

네이버 세션이 만료되었을 때 갱신합니다:

1. `cd /c/Users/TP005/naver-sync && python login_local.py` 로컬에서 playwright로 네이버 로그인
2. 로그인 성공하면 세션 파일이 서버로 자동 전송됨
3. `ssh bliss-server "sudo systemctl restart bliss-naver"` 서비스 재시작
4. 재시작 후 상태 확인

로그인 과정에서 오류가 나면 사용자에게 브라우저 수동 로그인을 안내하세요.
