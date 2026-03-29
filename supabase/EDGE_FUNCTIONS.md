# Supabase Edge Functions 가이드

모든 함수는 비활성 상태. 활성화하려면 아래 절차 수행.

## 배포 (Supabase CLI)
```bash
supabase functions deploy check-pending
supabase functions deploy send-message
supabase functions deploy daily-reminder
supabase functions deploy daily-report
supabase functions deploy noshow-check
supabase functions deploy birthday-greeting
```

## 활성화 (Supabase Dashboard → SQL Editor)

### 1. pending 예약 재확인 (30분마다)
```sql
SELECT cron.schedule('check-pending', '*/30 * * * *',
  $$SELECT net.http_post(
    'https://dpftlrsuqxqqeouwbfjd.supabase.co/functions/v1/check-pending',
    '{}',
    '{"Authorization":"Bearer eyJhbG..."}'::jsonb
  )$$
);
```

### 2. send_queue 즉시 발송 (DB Webhook)
Dashboard → Database → Webhooks → Create:
- Table: `send_queue`
- Events: `INSERT`
- Type: Supabase Edge Function → `send-message`

### 3. 예약 리마인더 (매일 10시)
```sql
SELECT cron.schedule('daily-reminder', '0 10 * * *',
  $$SELECT net.http_post(...)$$
);
```

### 4. 매출 리포트 (매일 22시)
```sql
SELECT cron.schedule('daily-report', '0 22 * * *',
  $$SELECT net.http_post(...)$$
);
```
환경변수 필요: TG_TOKEN, TG_CHAT

### 5. 노쇼 체크 (매 시간)
```sql
SELECT cron.schedule('noshow-check', '0 * * * *',
  $$SELECT net.http_post(...)$$
);
```

### 6. 생일 축하 (매일 9시)
```sql
SELECT cron.schedule('birthday-greeting', '0 9 * * *',
  $$SELECT net.http_post(...)$$
);
```
전제: customers 테이블에 birthday(MM-DD) 컬럼, 알림톡 생일 템플릿

## 비활성화
```sql
SELECT cron.unschedule('check-pending');
```
