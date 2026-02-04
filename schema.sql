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
  -- v2: recycle bin (soft delete)
  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT
);

-- Helpful indexes for pagination & filtering
CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_date_id ON tickets(is_deleted, date, id);
CREATE INDEX IF NOT EXISTS idx_tickets_isdeleted_deletedat_id ON tickets(is_deleted, deleted_at, id);
CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
