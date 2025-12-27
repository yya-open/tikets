CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  issue TEXT NOT NULL,
  department TEXT,
  name TEXT,
  solution TEXT,
  remarks TEXT,
  type TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
