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
