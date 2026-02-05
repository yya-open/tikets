/**
 * Simple schema migration manager for Cloudflare D1 (SQLite).
 * - Stores applied versions in schema_migrations table.
 * - Applies pending migrations in order.
 *
 * Usage: see /api/admin/migrate
 */

function splitSqlStatements(sql) {
  // Simple splitter: good enough for our migration scripts (no semicolons in strings).
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

const MIGRATIONS = [
  {
    version: 1,
    name: "create schema_migrations table",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations(
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: "performance indexes",
    sql: "-- Performance indexes for ticket system (safe to run multiple times)\n-- Recommended for large datasets to keep list/stats queries fast.\n\nCREATE INDEX IF NOT EXISTS idx_tickets_active_updated\nON tickets(is_deleted, updated_at_ts DESC, id DESC);\n\nCREATE INDEX IF NOT EXISTS idx_tickets_active_date_id\nON tickets(is_deleted, date, id);\n\nCREATE INDEX IF NOT EXISTS idx_tickets_deleted\nON tickets(is_deleted, deleted_at DESC, id DESC);\n",
  },
  {
    version: 3,
    name: "fts5 tickets index + triggers",
    sql: "-- Tickets Full-Text Search (FTS5) migration for Cloudflare D1 (SQLite)\n-- Creates tickets_fts virtual table + triggers to keep it in sync.\n-- Option 1 (recommended if it works in your D1): trigram tokenizer for substring-like search.\n--   If Option 1 fails (error about tokenizer/module), use Option 2 (unicode61).\n\n-- ============\n-- Option 1: trigram (best LIKE-like experience for Chinese/English substring search)\n-- ============\n-- CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(\n--   issue, department, name, solution, remarks, type,\n--   content='tickets', content_rowid='id',\n--   tokenize='trigram'\n-- );\n\n-- ============\n-- Option 2: unicode61 (safer compatibility; token-based, not substring)\n-- ============\nCREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(\n  issue, department, name, solution, remarks, type,\n  content='tickets', content_rowid='id',\n  tokenize='unicode61 remove_diacritics 2'\n);\n\n-- Keep FTS in sync with the base table.\nDROP TRIGGER IF EXISTS trg_tickets_fts_ai;\nDROP TRIGGER IF EXISTS trg_tickets_fts_ad;\nDROP TRIGGER IF EXISTS trg_tickets_fts_au;\n\nCREATE TRIGGER trg_tickets_fts_ai AFTER INSERT ON tickets BEGIN\n  INSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)\n  VALUES (new.id, new.issue, new.department, new.name, new.solution, new.remarks, new.type);\nEND;\n\nCREATE TRIGGER trg_tickets_fts_ad AFTER DELETE ON tickets BEGIN\n  INSERT INTO tickets_fts(tickets_fts, rowid, issue, department, name, solution, remarks, type)\n  VALUES('delete', old.id, old.issue, old.department, old.name, old.solution, old.remarks, old.type);\nEND;\n\nCREATE TRIGGER trg_tickets_fts_au AFTER UPDATE OF issue, department, name, solution, remarks, type ON tickets BEGIN\n  INSERT INTO tickets_fts(tickets_fts, rowid, issue, department, name, solution, remarks, type)\n  VALUES('delete', old.id, old.issue, old.department, old.name, old.solution, old.remarks, old.type);\n\n  INSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)\n  VALUES (new.id, new.issue, new.department, new.name, new.solution, new.remarks, new.type);\nEND;\n\n-- Backfill existing rows (safe to run multiple times after wiping the FTS index)\nINSERT INTO tickets_fts(rowid, issue, department, name, solution, remarks, type)\nSELECT id, issue, department, name, solution, remarks, type\nFROM tickets\nWHERE id NOT IN (SELECT rowid FROM tickets_fts);\n",
  },
];

export function latestSchemaVersion() {
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}

export async function getCurrentSchemaVersion(db) {
  // Ensure table exists (idempotent)
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));"
    )
    .run();

  const row = await db.prepare("SELECT MAX(version) AS v FROM schema_migrations;").first();
  return row?.v ? Number(row.v) : 0;
}

export async function listPendingMigrations(db) {
  const cur = await getCurrentSchemaVersion(db);
  return MIGRATIONS.filter((m) => m.version > cur);
}

export async function applyPendingMigrations(db) {
  // Ensure base table exists first
  await db.prepare(MIGRATIONS[0].sql).run();

  const pending = await listPendingMigrations(db);
  const applied = [];

  for (const m of pending) {
    const statements = splitSqlStatements(m.sql);
    const stmts = statements.map((s) => db.prepare(s.endsWith(';') ? s : (s + ';')));
    if (stmts.length) {
      await db.batch(stmts);
    }

    await db
      .prepare("INSERT INTO schema_migrations(version, name) VALUES(?, ?);")
      .bind(m.version, m.name)
      .run();

    applied.push({ version: m.version, name: m.name, statements: stmts.length });
  }

  return { applied, latest: latestSchemaVersion() };
}
