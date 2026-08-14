-- 007_trade_events.sql
-- schema.sql has defined trade_events since the Task 3B toast work, but it
-- was apparently never actually applied to production: a live test POST to
-- /api/trade-event on 2026-08-14 failed with "Could not find the table
-- 'public.trade_events' in the schema cache" (HTTP 500). The insert happens
-- BEFORE the ntfy notify() call in that route, so this alone explains every
-- missing fill alert to date, independent of the NTFY_TOPIC gap fixed
-- separately today — the request never got that far.
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
-- anon SELECT for Realtime; service_role INSERT from /api/trade-event
create policy "anon_read_trade_events"
  on trade_events for select using (true);
