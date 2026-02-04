-- Tickets Full-Text Search (FTS5) migration for Cloudflare D1 (SQLite)
-- Creates tickets_fts virtual table + triggers to keep it in sync.
-- Option 1 (recommended if it works in your D1): trigram tokenizer for substring-like search.
--   If Option 1 fails (error about tokenizer/module), use Option 2 (unicode61).

-- ============
-- Option 1: trigram (best LIKE-like experience for Chinese/English substring search)
-- ============
-- CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
--   issue, department, name, solution, remarks, type,
--   content='tickets', content_rowid='id',
--   tokenize='trigram'
-- );

-- ============
-- Option 2: unicode61 (safer compatibility; token-based, not substring)
-- ============
CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
  issue, department, name, solution, remarks, type,
  content='tickets', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep FTS in sync with the base table.
DROP TRIGGER IF EXISTS trg_tickets_fts_ai;
DROP TRIGGER IF EXISTS trg_tickets_fts_ad;
DROP TRIGGER IF EXISTS trg_tickets_fts_au;

CREATE TRIGGER trg_tickets_fts_ai AFTER INSERT ON tickets BEGIN
  INSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)
  VALUES (new.id, new.issue, new.department, new.name, new.solution, new.remarks, new.type);
END;

CREATE TRIGGER trg_tickets_fts_ad AFTER DELETE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, issue, department, name, solution, remarks, type)
  VALUES('delete', old.id, old.issue, old.department, old.name, old.solution, old.remarks, old.type);
END;

CREATE TRIGGER trg_tickets_fts_au AFTER UPDATE OF issue, department, name, solution, remarks, type ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, issue, department, name, solution, remarks, type)
  VALUES('delete', old.id, old.issue, old.department, old.name, old.solution, old.remarks, old.type);

  INSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)
  VALUES (new.id, new.issue, new.department, new.name, new.solution, new.remarks, new.type);
END;

-- Backfill existing rows (safe to run multiple times after wiping the FTS index)
INSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)
SELECT id, issue, department, name, solution, remarks, type
FROM tickets
WHERE id NOT IN (SELECT rowid FROM tickets_fts);
