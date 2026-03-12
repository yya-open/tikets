CREATE TABLE IF NOT EXISTS schema_migrations(
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  issue TEXT NOT NULL,
  department TEXT,
  name TEXT,
  solution TEXT,
  remarks TEXT,
  type TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_at_ts INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_date_id ON tickets(is_deleted, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_deletedat_id ON tickets(is_deleted, deleted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
CREATE INDEX IF NOT EXISTS idx_tickets_active_updated ON tickets(is_deleted, updated_at_ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_active_date_id ON tickets(is_deleted, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_deleted ON tickets(is_deleted, deleted_at DESC, id DESC);
