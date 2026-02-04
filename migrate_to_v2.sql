-- Upgrade existing tickets table to support recycle bin (soft delete).
-- Run in D1 Console.
--
-- If you already ran v2 before, the ALTER TABLE lines may error; you can ignore those and just run the CREATE INDEX lines.

ALTER TABLE tickets ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE tickets ADD COLUMN deleted_at TEXT;
ALTER TABLE tickets ADD COLUMN updated_at_ts INTEGER DEFAULT 0;

-- Backfill updated_at_ts for existing rows (best-effort)
UPDATE tickets
SET updated_at_ts = CAST(strftime('%s', updated_at) AS INTEGER) * 1000
WHERE (updated_at_ts IS NULL OR updated_at_ts = 0)
  AND updated_at IS NOT NULL AND TRIM(updated_at) <> '';

-- Helpful indexes for pagination & filtering
CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_date_id ON tickets(is_deleted, date, id);
CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_deletedat_id ON tickets(is_deleted, deleted_at, id);
CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
