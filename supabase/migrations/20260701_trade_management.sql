-- 거래관리(도매 구매주문) 모듈
-- 지점 → 구매신청 → 입금 → 입금확인(자동/수동) → 배송 → 완료
-- 본사 전용 관리 + 지점 직원 신청. business_id 스코프, RLS bliss_session_ok() 게이트.

-- ── 공급자(발행 주체: 네추럴룩 / 테라포트) ──
create table if not exists trade_suppliers (
  id          text primary key,
  business_id text not null,
  name        text not null,
  rep         text default '',
  biz_no      text default '',
  address     text default '',
  biz_type    text default '',
  biz_item    text default '',
  bank        text default '',
  is_default  boolean default false,
  sort        int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_trade_suppliers_biz on trade_suppliers(business_id);

-- ── 도매 제품 ──
create table if not exists trade_products (
  id          text primary key,
  business_id text not null,
  code        text default '',
  name        text not null,
  spec        text default '1',
  unit        text default '1',
  price       bigint default 0,
  active      boolean default true,
  sort        int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_trade_products_biz on trade_products(business_id);

-- ── 거래처(매출처=지점 / 매입처) ──
create table if not exists trade_customers (
  id          text primary key,
  business_id text not null,
  branch_id   text,                       -- 블리스 지점 연동 (nullable: 외부 매입처)
  code        text default '',
  name        text not null,
  rep         text default '',
  biz_no      text default '',
  phone       text default '',
  mobile      text default '',
  fax         text default '',
  address     text default '',
  biz_type    text default '',
  biz_item    text default '',
  type        text default '매출처',       -- 매출처 | 매입처
  open_date   text default '',
  sort        int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_trade_customers_biz on trade_customers(business_id);
create index if not exists idx_trade_customers_branch on trade_customers(branch_id);

-- ── 주문(구매신청 → 배송 워크플로우) ──
-- status: requested(신청/입금대기) | paid(입금확인) | shipped(배송) | done(완료) | cancelled(취소)
create table if not exists trade_orders (
  id            text primary key,
  business_id   text not null,
  order_no      text default '',
  supplier_id   text,
  customer_id   text,
  branch_id     text,                     -- 신청 지점
  tx_date       date default current_date,
  tax_type      text default '별도',
  items         jsonb default '[]'::jsonb,-- [{code,name,spec,unit,qty,price,supply,tax,total}]
  total_qty     bigint default 0,
  total_supply  bigint default 0,
  total_tax     bigint default 0,
  grand_total   bigint default 0,
  memo          text default '',
  status        text default 'requested',
  requested_by  text default '',          -- 신청 직원명
  requested_at  timestamptz default now(),
  paid_at       timestamptz,
  confirmed_by  text default '',          -- 입금확인 처리자
  shipped_at    timestamptz,
  shipped_by    text default '',
  done_at       timestamptz,
  matched_deposit_id text,                -- 자동매칭된 입금문자
  invoiced      boolean default false,    -- 세금계산서 발행(엑셀 export)됨
  created_at    timestamptz default now()
);
create index if not exists idx_trade_orders_biz on trade_orders(business_id);
create index if not exists idx_trade_orders_status on trade_orders(business_id, status);
create index if not exists idx_trade_orders_branch on trade_orders(branch_id);

-- ── 모듈 설정(본사 담당자 알림 등) ──
create table if not exists trade_settings (
  business_id       text primary key,
  manager_name      text default '',
  manager_phone     text default '',      -- 신청 알림 SMS 수신 담당자
  notify_enabled    boolean default true,
  default_supplier_id text,
  updated_at        timestamptz default now()
);

-- ── 입금문자 → 주문 자동매칭 링크 컬럼 ──
alter table bank_deposits add column if not exists matched_trade_order_id text;

-- ── RLS (기존 민감테이블 동일 패턴) ──
do $$
declare t text;
begin
  foreach t in array array['trade_suppliers','trade_products','trade_customers','trade_orders','trade_settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', 'bliss_session_'||t, t);
    execute format('create policy %I on %I for all using ((select bliss_session_ok())) with check ((select bliss_session_ok()))', 'bliss_session_'||t, t);
    execute format('grant all on %I to anon, authenticated', t);
  end loop;
end $$;

-- ── 입금문자 자동매칭 트리거 ──
-- 신규 미매칭 입금(pending, deposit_kind 미지정)이 들어오면
-- 같은 business_id의 requested 주문 중 grand_total = amount 가 "유일"하면 자동 입금확인.
create or replace function trade_auto_match_deposit() returns trigger as $$
declare
  v_order_id text;
  v_cnt int;
begin
  if new.status is distinct from 'pending' then return new; end if;
  if new.deposit_kind is not null then return new; end if;
  if coalesce(new.amount,0) <= 0 then return new; end if;

  select count(*), min(id) into v_cnt, v_order_id
  from trade_orders
  where business_id = new.business_id
    and status = 'requested'
    and grand_total = new.amount;

  if v_cnt = 1 then
    update trade_orders
      set status = 'paid', paid_at = now(),
          confirmed_by = '자동매칭', matched_deposit_id = new.id
      where id = v_order_id;
    new.status := 'matched';
    new.deposit_kind := 'trade';
    new.matched_trade_order_id := v_order_id;
    new.matched_at := now();
    new.matched_by := 'trade_auto';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_trade_auto_match on bank_deposits;
create trigger trg_trade_auto_match
  before insert on bank_deposits
  for each row execute function trade_auto_match_deposit();
