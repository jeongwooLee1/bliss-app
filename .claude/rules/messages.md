---
paths:
  - "src/components/Messages/**"
---

# 메시지 코딩 규칙

- Supabase REST API URL에 _t=Date.now() 같은 캐시버스터 파라미터 절대 추가 금지 (400 에러)
- 캐시 방지는 cache:"no-store" + Cache-Control:"no-cache" 헤더로만 처리
- 메시지 폴링: 5초 간격
- WhatsApp account_id: "whatsapp"
- markRead에서 onRead 콜백 호출 → 사이드바 배지 갱신 필수
