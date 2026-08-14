-- 006_replikanto_status.sql
-- The NT8 addon now reads Replikanto's own link state (nt8/AccountMonitor.cs)
-- and sends it as "_replikanto" with every batch. This column is where the
-- server stores it so the dashboard can display it directly instead of
-- inferring a copier failure from leader-in-position-followers-flat.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS replikanto_status text;
