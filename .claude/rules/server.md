---
paths:
  - "**/*naver*.py"
  - "**/bliss_naver.py"
---

# 서버 코딩 규칙

- ai_auto_reply() 함수: 현재 return ""로 비활성화 상태, 수정 시 확인 필요
- _load_ai_settings(): wa_token, wa_phone_number_id 캐시에 반드시 포함
- 서버 코드 수정 후 반드시 ssh bliss-server "sudo systemctl restart bliss-naver"
- pyOpenSSL/cryptography 패키지 충돌 주의
