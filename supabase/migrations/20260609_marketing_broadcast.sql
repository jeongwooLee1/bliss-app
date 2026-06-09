-- 마케팅 단체 발송 (Phase 1: 문자) — 캠페인 + 발송 로그
-- RLS ENABLE + anon_all_* (application-level 인증, reference_supabase_rls 패턴)

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id             text PRIMARY KEY,
  business_id    text NOT NULL,
  bid            text,                              -- 발신 지점 (sms_callback 소유)
  name           text,                              -- 캠페인 이름 (선택)
  segment        text NOT NULL DEFAULT 'all',       -- all/new/repeat/vip/churned/noshow/pkg
  segment_params jsonb DEFAULT '{}'::jsonb,          -- joinFrom/joinTo 등
  message        text NOT NULL DEFAULT '',           -- 원본 본문 (광고문구 미포함, 발송 시 부착)
  is_ad          boolean DEFAULT false,             -- 광고성 여부
  optout_080     text,                              -- 광고 무료수신거부 번호 스냅샷
  channel        text DEFAULT 'sms',                -- sms (Phase2: friendtalk)
  image_url      text,                              -- Phase2 이미지
  scheduled_at   timestamptz,                       -- null = 즉시
  status         text DEFAULT 'draft',              -- draft/scheduled/sending/done/failed/canceled
  target_count   int DEFAULT 0,                     -- 발송 대상(유효) 수
  sent_count     int DEFAULT 0,
  fail_count     int DEFAULT 0,
  created_by     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_marketing_campaigns ON marketing_campaigns;
CREATE POLICY anon_all_marketing_campaigns ON marketing_campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_mkt_camp_biz ON marketing_campaigns(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_camp_due ON marketing_campaigns(scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS marketing_sends (
  id          text PRIMARY KEY,
  campaign_id text NOT NULL,
  business_id text,
  customer_id text,
  phone       text,
  status      text DEFAULT 'sent',                  -- sent/failed/skipped
  fail_reason text,
  sent_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE marketing_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_marketing_sends ON marketing_sends;
CREATE POLICY anon_all_marketing_sends ON marketing_sends FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_mkt_sends_camp ON marketing_sends(campaign_id);
-- Phase3 전환 추적: 발송 후 N일 내 예약/매출 join 용
CREATE INDEX IF NOT EXISTS idx_mkt_sends_conv ON marketing_sends(business_id, customer_id, sent_at);
