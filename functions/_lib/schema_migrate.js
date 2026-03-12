const BASE_SCHEMA_SQL = `
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
`;

const PERF_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_tickets_active_updated
ON tickets(is_deleted, updated_at_ts DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_active_date_id
ON tickets(is_deleted, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_deleted
ON tickets(is_deleted, deleted_at DESC, id DESC);
`;

const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
  issue, department, name, solution, remarks, type,
  content='tickets', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

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

INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild');
`;

const MIGRATIONS = [
  { version: 1, name: 'init base schema', sql: BASE_SCHEMA_SQL },
  { version: 2, name: 'performance indexes', sql: PERF_INDEX_SQL },
  { version: 3, name: 'fts5 tickets index + triggers', sql: FTS_SQL },
];

function splitSqlStatements(sql) {
  const s = String(sql || '');
  const out = [];
  let cur = '';
  let i = 0;
  let inS = false;
  let inD = false;
  let inLineComment = false;
  let inBlockComment = false;
  let beginDepth = 0;

  function isWordChar(ch) {
    return /[A-Za-z0-9_]/.test(ch);
  }
  function readWordAt(pos) {
    if (pos < 0 || pos >= s.length) return '';
    if (!/[A-Za-z_]/.test(s[pos])) return '';
    let j = pos;
    while (j < s.length && isWordChar(s[j])) j++;
    return s.slice(pos, j).toUpperCase();
  }

  while (i < s.length) {
    const ch = s[i];
    const next = i + 1 < s.length ? s[i + 1] : '';
    if (inLineComment) {
      cur += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === '*' && next === '/') {
        cur += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (!inS && !inD) {
      if (ch === '-' && next === '-') {
        cur += ch + next;
        i += 2;
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        cur += ch + next;
        i += 2;
        inBlockComment = true;
        continue;
      }
    }
    if (!inD && ch === "'") {
      cur += ch;
      if (inS && next === "'") {
        cur += next;
        i += 2;
        continue;
      }
      inS = !inS;
      i++;
      continue;
    }
    if (!inS && ch === '"') {
      cur += ch;
      inD = !inD;
      i++;
      continue;
    }
    if (!inS && !inD) {
      const prev = i - 1 >= 0 ? s[i - 1] : '';
      if (!isWordChar(prev) && /[A-Za-z_]/.test(ch)) {
        const word = readWordAt(i);
        if (word === 'BEGIN') beginDepth++;
        else if (word === 'END' && beginDepth > 0) beginDepth--;
      }
    }
    if (!inS && !inD && beginDepth === 0 && ch === ';') {
      const stmt = cur.trim();
      if (stmt) out.push(stmt + ';');
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  const tail = cur.trim();
  if (tail) out.push(tail.endsWith(';') ? tail : `${tail};`);
  return out;
}

async function ensureMigrationsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`).run();
}

export function latestSchemaVersion() {
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}

export async function getCurrentSchemaVersion(db) {
  await ensureMigrationsTable(db);
  const row = await db.prepare('SELECT MAX(version) AS v FROM schema_migrations;').first();
  return row?.v ? Number(row.v) : 0;
}

export async function listPendingMigrations(db) {
  const current = await getCurrentSchemaVersion(db);
  return MIGRATIONS.filter((m) => m.version > current);
}

export async function applyPendingMigrations(db) {
  await ensureMigrationsTable(db);
  const pending = await listPendingMigrations(db);
  const applied = [];
  for (const m of pending) {
    const statements = splitSqlStatements(m.sql).map((stmt) => db.prepare(stmt));
    if (statements.length) await db.batch(statements);
    await db.prepare('INSERT INTO schema_migrations(version, name) VALUES(?, ?)').bind(m.version, m.name).run();
    applied.push({ version: m.version, name: m.name, statements: statements.length });
  }
  return { applied, latest: latestSchemaVersion() };
}

export { BASE_SCHEMA_SQL, PERF_INDEX_SQL, FTS_SQL };
