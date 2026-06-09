-- ============================================================
-- Trading Monitor — Supabase Schema
-- Mirrors main.py field names exactly so NT8 addon needs
-- zero changes to its payload keys.
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── ACCOUNTS ────────────────────────────────────────────────
-- One row per NT8 account; upserted on every update
create table if not exists accounts (
  account_id            text primary key,          -- NT8 account name e.g. "Apex-SIM-1234"

  -- Live fields (mirror main.py empty_account)
  dollar_open           numeric(14,2) default 0,   -- unrealized / open PnL
  dist_to_daily_loss    numeric(14,2) default 0,
  drawdown_auto         numeric(14,2) default 0,   -- trailing threshold
  total_available       numeric(14,2) default 0,   -- equity / net liq
  trailing_max          numeric(14,2) default 0,
  dist_drawdown         numeric(14,2) default 0,
  unrealized_pnl        numeric(14,2) default 0,
  realized_pnl          numeric(14,2) default 0,
  net_liq               numeric(14,2) default 0,   -- alias for total_available

  -- Computed / persisted state (mirror account_state.json)
  peak_balance          numeric(14,2) default 0,
  day_start_balance     numeric(14,2) default 0,
  day_date              text default '',

  -- Metadata
  source                text default 'ninjatrader', -- 'ninjatrader' | 'computed'
  nt_fields             text[] default '{}',        -- fields NT8 sent directly
  last_update           timestamptz default now(),
  status                text default 'active'       -- active | breached | stale
    check (status in ('active','breached','stale'))
);

-- ── ALERTS ──────────────────────────────────────────────────
create table if not exists alerts (
  id            uuid primary key default gen_random_uuid(),
  account_id    text references accounts(account_id) on delete cascade,
  alert_type    text not null
    check (alert_type in (
      'drawdown_warning','daily_loss','dist_drawdown_low',
      'disconnect','copier_fail','risk_breach'
    )),
  severity      text default 'warning'
    check (severity in ('info','warning','critical')),
  message       text not null,
  is_read       boolean default false,
  triggered_at  timestamptz default now()
);

create index if not exists alerts_unread_idx
  on alerts(is_read, triggered_at desc);

-- ── CONNECTION LOGS ──────────────────────────────────────────
create table if not exists connection_logs (
  id          uuid primary key default gen_random_uuid(),
  account_id  text references accounts(account_id) on delete cascade,
  event_type  text not null
    check (event_type in ('connected','disconnected','reconnecting','error')),
  message     text,
  occurred_at timestamptz default now()
);

create index if not exists conn_logs_account_idx
  on connection_logs(account_id, occurred_at desc);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table accounts        enable row level security;
alter table alerts          enable row level security;
alter table connection_logs enable row level security;

-- Authenticated users (dashboard) → read everything
create policy "auth_read_accounts"
  on accounts for select using (auth.role() = 'authenticated');

create policy "auth_read_alerts"
  on alerts for select using (auth.role() = 'authenticated');

create policy "auth_update_alerts"
  on alerts for update using (auth.role() = 'authenticated');

create policy "auth_read_conn_logs"
  on connection_logs for select using (auth.role() = 'authenticated');

-- Service-role key (used by /api/update) bypasses RLS automatically —
-- no extra policy needed.

-- ── ACCESS LOGS (Task 2A) ───────────────────────────────────
-- Written async by middleware on every /api/* hit
create table if not exists access_logs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip         text not null,
  route      text not null,
  method     text not null,
  success    boolean not null default false
);

create index if not exists access_logs_ip_created_idx on access_logs(ip, created_at desc);
create index if not exists access_logs_created_idx    on access_logs(created_at desc);

alter table access_logs enable row level security;

-- ── PASSKEY CREDENTIALS (Task 2B) ───────────────────────────
-- Stores WebAuthn public-key credentials per device
create table if not exists passkey_credentials (
  id             uuid primary key default gen_random_uuid(),
  credential_id  text not null unique,
  public_key     text not null,         -- base64
  counter        bigint not null default 0,
  device_type    text,                  -- 'singleDevice' | 'multiDevice'
  backed_up      boolean default false,
  transports     text[] default '{}',
  created_at     timestamptz default now()
);

alter table passkey_credentials enable row level security;
-- Only service-role key can read/write

-- ── APP SETTINGS (Task 2C killswitch) ───────────────────────
create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

-- Seed killswitch default to off
insert into app_settings (key, value) values ('killswitch', 'false')
  on conflict (key) do nothing;

alter table app_settings enable row level security;

-- ── TRADE EVENTS (Task 3B toasts) ──────────────────────────
-- NT8 addon inserts here when a fill occurs; dashboard subscribes via Realtime
create table if not exists trade_events (
  id             uuid primary key default gen_random_uuid(),
  account_id     text references accounts(account_id) on delete cascade,
  event_type     text not null check (event_type in ('open','close','partial')),
  symbol         text not null,
  direction      text not null check (direction in ('long','short','flat')),
  quantity       integer default 1,
  pnl            numeric(14,2),   -- filled on close events
  total_accounts integer default 1,
  occurred_at    timestamptz default now()
);

create index if not exists trade_events_occurred_idx on trade_events(occurred_at desc);
alter table trade_events enable row level security;
-- anon SELECT for Realtime; service_role INSERT from /api/update
create policy "anon_read_trade_events"
  on trade_events for select using (true);

-- ── USER PREFERENCES (Task 3C column picker) ────────────────
create table if not exists user_preferences (
  id            uuid primary key default gen_random_uuid(),
  preference_key text not null unique,
  value         jsonb not null,
  updated_at    timestamptz default now()
);

alter table user_preferences enable row level security;

-- ── TASK 6: Tradovate live columns on accounts ──────────────
-- Run these ALTER statements after table creation:
-- alter table accounts add column if not exists tradovate_trailing_drawdown numeric(14,2);
-- alter table accounts add column if not exists tradovate_realized_pnl      numeric(14,2);
-- alter table accounts add column if not exists tradovate_unrealized_pnl    numeric(14,2);
-- alter table accounts add column if not exists tradovate_margin_used       numeric(14,2);
-- alter table accounts add column if not exists tradovate_daily_pnl         numeric(14,2);
-- alter table accounts add column if not exists tradovate_synced_at         timestamptz;

-- ── ACCOUNT EVENTS (Task 5) ─────────────────────────────────
-- Risk breach readings, auto-lockouts, quarantine events
create table if not exists account_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  text references accounts(account_id) on delete cascade,
  event_type  text not null
    check (event_type in ('risk_breach','auto_locked','manual_unlock','quarantined','dequarantined','session_locked')),
  message     text,
  occurred_at timestamptz default now()
);

create index if not exists account_events_account_idx on account_events(account_id, occurred_at desc);
alter table account_events enable row level security;

-- Add locked/quarantined columns to accounts (run ALTER separately if table exists)
-- alter table accounts add column if not exists locked boolean default false;
-- alter table accounts add column if not exists quarantined boolean default false;
-- alter table accounts add column if not exists last_seen_at timestamptz;

-- ── WARMUP LOG ──────────────────────────────────────────────
-- Written by the Supabase keep-warm Edge Function (Task 1A)
create table if not exists warmup_log (
  id           uuid primary key default gen_random_uuid(),
  pinged_at    timestamptz not null default now(),
  status       text not null,   -- 'ok' | 'http_NNN' | 'error'
  response_ms  integer not null default 0
);

create index if not exists warmup_log_pinged_at_idx on warmup_log(pinged_at desc);

alter table warmup_log enable row level security;
-- Only service-role key can write; no read policy needed for anon
-- (read it directly from Supabase dashboard when debugging)


-- ── REALTIME ─────────────────────────────────────────────────
-- Enable Realtime for the tables the dashboard subscribes to
alter publication supabase_realtime add table accounts;
alter publication supabase_realtime add table alerts;
