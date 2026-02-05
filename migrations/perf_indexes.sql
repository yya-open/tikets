-- Performance indexes for ticket system (safe to run multiple times)
-- Recommended for large datasets to keep list/stats queries fast.

CREATE INDEX IF NOT EXISTS idx_tickets_active_updated
ON tickets(is_deleted, updated_at_ts DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_active_date_id
ON tickets(is_deleted, date, id);

CREATE INDEX IF NOT EXISTS idx_tickets_deleted
ON tickets(is_deleted, deleted_at DESC, id DESC);
