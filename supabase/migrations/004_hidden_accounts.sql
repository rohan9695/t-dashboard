-- 004_hidden_accounts.sql
-- Soft-hide accounts that NT8 no longer reports instead of requiring a manual
-- DELETE in Supabase. Never auto-deleted — just filtered out of the dashboard.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
