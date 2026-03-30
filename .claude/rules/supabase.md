---
paths:
  - "src/lib/**"
---

# Supabase/DB 규칙

- window._sbClient = supabase (supabase.js에서 설정) — 없으면 Realtime 구독 실패
- REST API URL에 임의 쿼리 파라미터 추가 금지
- memo 필드에 네이버 데이터 쓰기 금지
- API 키 코드에 노출 금지
- reservation_id: NULLS NOT DISTINCT unique constraint → AI 예약에 고유값 필수
- prev_reservation_id: BLISS_PRESERVE_FIELDS에 포함
