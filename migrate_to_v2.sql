-- Upgrade existing tickets table to support soft delete (recycle bin).
-- Run in D1 Console.

ALTER TABLE tickets ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE tickets ADD COLUMN deleted_at TEXT;
