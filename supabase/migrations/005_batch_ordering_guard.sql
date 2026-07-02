-- 005_batch_ordering_guard.sql
-- Triple-host fan-out means multiple independent hosts can write the same
-- account row concurrently. Without ordering info, whichever write lands
-- last wins -- even if it carries older/stale NT8 data. This column lets
-- the server refuse a batch that's older than what's already stored.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_batch_ts bigint NOT NULL DEFAULT 0;
