/**
 * POST /api/import/apply
 * Safe merge import (apply).
 *
 * Merge rule: only overwrite existing row when incoming.updated_at is strictly newer.
 * If incoming.updated_at is empty/missing, it will NEVER overwrite existing rows.
 */

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function getEditKeyFromRequest(request) {
  const url = new URL(request.url);
  return (
    request.headers.get("X-EDIT-KEY") ||
    request.headers.get("x-edit-key") ||
    url.searchParams.get("key") ||
    ""
  );
}

function requireEditKey(request, env) {
  const expected = String(env.EDIT_KEY || "");
  if (!expected) {
    return new Response("Server misconfigured: EDIT_KEY is not set", { status: 500 });
  }
  const provided = getEditKeyFromRequest(request);
  if (provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}


async function tryRebuildFTS(env) {
  // External-content FTS5 may need rebuild after bulk changes (import).
  // If tickets_fts doesn't exist, silently ignore.
  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
    return { ok: true };
  } catch (e) {
    const msg = String(e || "");
    if (/no such table: tickets_fts/i.test(msg) || /no such module: fts5/i.test(msg)) {
      return { ok: false, skipped: true };
    }
    return { ok: false, error: msg };
  }
}

function pickFirstNonEmptyArray(...arrs) {
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) return a;
  }
  for (const a of arrs) {
    if (Array.isArray(a)) return a;
  }
  return [];
}

function parsePayload(payload) {
  let active = [];
  let trash = [];

  if (Array.isArray(payload)) {
    active = payload;
  } else if (payload && typeof payload === "object") {
    active = pickFirstNonEmptyArray(payload.active, payload.records, payload.data, payload.tickets, payload.items);
    trash = pickFirstNonEmptyArray(payload.trash, payload.deleted, payload.recycle_bin);
  } else {
    throw new Error("Expected an array or {active,trash}");
  }

  return { active, trash };
}

function normalizeRecord(r, forceDeletedFlag) {
  const obj = r && typeof r === "object" ? r : {};
  const idNum = Number(obj.id ?? obj.ID ?? obj.Id);
  const id = Number.isFinite(idNum) ? idNum : null;

  const updatedAt = String(obj.updated_at ?? obj.updatedAt ?? "").trim();
  const tsRaw = obj.updated_at_ts ?? obj.updatedAtTs ?? obj.updatedAtTS ?? obj.updated_atTs;
  const tsNum = Number(tsRaw);
  const updated_at_ts = (Number.isFinite(tsNum) && tsNum > 0) ? Math.trunc(tsNum) : parseUpdatedAtToTs(updatedAt);

  const isDeleted = forceDeletedFlag != null
    ? (forceDeletedFlag ? 1 : 0)
    : (Number(obj.is_deleted ?? obj.isDeleted ?? 0) ? 1 : 0);

  const deletedAtRaw = String(obj.deleted_at ?? obj.deletedAt ?? "").trim();

  return {
    id,
    date: String(obj.date ?? obj.日期 ?? obj.time ?? obj.createdAt ?? "").trim(),
    issue: String(obj.issue ?? obj.问题 ?? obj.question ?? obj.title ?? obj.subject ?? "").trim(),
    department: String(obj.department ?? obj.dept ?? obj.部门 ?? obj.departmentName ?? ""),
    name: String(obj.name ?? obj.owner ?? obj.person ?? obj.姓名 ?? obj.handler ?? ""),
    solution: String(obj.solution ?? obj.method ?? obj.处理方法 ?? obj.fix ?? ""),
    remarks: String(obj.remarks ?? obj.remark ?? obj.备注 ?? obj.note ?? ""),
    type: String(obj.type ?? obj.类型 ?? obj.category ?? ""),
    updated_at: updatedAt,
    updated_at_ts,
    has_version: (updated_at_ts > 0) || (updatedAt.length > 0),
    is_deleted: isDeleted,
    deleted_at: deletedAtRaw,
  };
}

function normalizeAll({ active, trash }) {
  const normActive = Array.isArray(active) ? active.map((r) => normalizeRecord(r, 0)) : [];
  const normTrash = Array.isArray(trash) ? trash.map((r) => normalizeRecord(r, 1)) : [];

  // Allow array-only import where records may already contain is_deleted.
  const all = [];
  for (const r of normActive) all.push(r);
  for (const r of normTrash) all.push(r);
  return { active: normActive, trash: normTrash, all };
}


function parseUpdatedAtToTs(updatedAt) {
  const s = String(updatedAt || "").trim();
  if (!s) return 0;

  const p = Date.parse(s);
  if (Number.isFinite(p)) return p;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const hh = Number(m[4]), mm = Number(m[5]), ss = Number(m[6]);
    return Date.UTC(y, mo, d, hh, mm, ss);
  }
  return 0;
}

async function getColumns(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(tickets)").all();
  const cols = new Set();
  for (const r of results || []) cols.add(String(r.name));
  return cols;
}

async function ensureSoftDeleteColumns(env) {
  const cols = await getColumns(env);
  const stmts = [];

  if (!cols.has("updated_at")) {
    stmts.push(env.DB.prepare("ALTER TABLE tickets ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"));
  }
  if (!cols.has("updated_at_ts")) {
    stmts.push(env.DB.prepare("ALTER TABLE tickets ADD COLUMN updated_at_ts INTEGER DEFAULT 0"));
  }
  if (!cols.has("is_deleted")) {
    stmts.push(env.DB.prepare("ALTER TABLE tickets ADD COLUMN is_deleted INTEGER DEFAULT 0"));
  }
  if (!cols.has("deleted_at")) {
    stmts.push(env.DB.prepare("ALTER TABLE tickets ADD COLUMN deleted_at TEXT"));
  }

  if (stmts.length > 0) {
    // Run sequentially (ALTER TABLE doesn't like being inside a txn in some SQLite builds)
    for (const s of stmts) {
      await s.run();
    }
  }

  // Backfill updated_at_ts for legacy rows
  try {
    await env.DB.prepare(
      `UPDATE tickets
       SET updated_at_ts = CAST(strftime('%s', updated_at) AS INTEGER) * 1000
       WHERE (updated_at_ts IS NULL OR updated_at_ts = 0)
         AND updated_at IS NOT NULL AND TRIM(updated_at) <> ''`
    ).run();
  } catch {}
}

async function fetchExistingUpdatedMap(env, ids) {
  const map = new Map();
  const uniq = Array.from(new Set(ids)).filter((v) => Number.isFinite(v));
  // D1 / SQLite bound parameter limit can be relatively low. Use a conservative chunk size.
  const CHUNK = 100;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const part = uniq.slice(i, i + CHUNK);
    if (part.length === 0) continue;
    const placeholders = part.map(() => "?").join(",");
    const sql = `SELECT id, updated_at_ts, updated_at FROM tickets WHERE id IN (${placeholders})`;
    const { results } = await env.DB.prepare(sql).bind(...part).all();
    for (const r of results || []) {
      const id = Number(r.id);
      if (Number.isFinite(id)) map.set(id, { ts: Number(r.updated_at_ts ?? 0) || 0, s: String(r.updated_at ?? "") });
    }
  }
  return map;
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parsePayload(payload);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }

  const norm = normalizeAll(parsed);
  const incoming = norm.all;

  // Basic validation
  const bad = incoming.find((r) => !r.date || !r.issue);
  if (bad) {
    return jsonResponse({ ok: false, error: "date & issue required for all records" }, { status: 400 });
  }

  // Ensure schema supports recycle bin fields.
  try {
    await ensureSoftDeleteColumns(env);
  } catch (e) {
    return jsonResponse({ ok: false, error: `schema upgrade failed: ${String(e)}` }, { status: 500 });
  }

  // Fetch existing updated_at for preview-like stats
  const ids = incoming.map((r) => r.id).filter((v) => Number.isFinite(v));
  const existingMap = await fetchExistingUpdatedMap(env, ids);

  // Upsert statement (new schema)
  // - updated_at: use incoming updated_at on insert; if missing/empty -> datetime('now')
  // - DO UPDATE: only when incoming has_updated_at=1 AND excluded.updated_at is strictly newer.
  const upsert = env.DB.prepare(
    `INSERT INTO tickets (
        id, date, issue, department, name, solution, remarks, type,
        is_deleted, deleted_at, updated_at, updated_at_ts
     ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, CASE WHEN ?=1 THEN COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP) ELSE NULL END,
        COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP),
        CASE WHEN ?=1 THEN ? ELSE ? END
     )
     ON CONFLICT(id) DO UPDATE SET
        date=excluded.date,
        issue=excluded.issue,
        department=excluded.department,
        name=excluded.name,
        solution=excluded.solution,
        remarks=excluded.remarks,
        type=excluded.type,
        is_deleted=excluded.is_deleted,
        deleted_at=excluded.deleted_at,
        updated_at=excluded.updated_at,
        updated_at_ts=excluded.updated_at_ts
     WHERE (?=1) AND COALESCE(excluded.updated_at_ts,0) > COALESCE(tickets.updated_at_ts,0)`
  );

  // D1's db.batch() already executes the statements in a single transaction.
  // So keep batches <= 100 statements and DO NOT include BEGIN/COMMIT.
  const BATCH = 90;
  let inserts = 0;
  let updates = 0;
  let skips = 0;
  let skipped_newer_or_equal = 0;

  for (let i = 0; i < incoming.length; i += BATCH) {
    const chunk = incoming.slice(i, i + BATCH);

    // Build statements
    const stmts = [];
    for (const r of chunk) {
      const prev = r.id != null ? existingMap.get(r.id) : null;
      const hasVer = r.has_version ? 1 : 0;
      const nowTs = Date.now();
      const incomingTs = Number(r.updated_at_ts ?? 0) || 0;
      const tsForInsert = incomingTs > 0 ? incomingTs : nowTs;

      // For deleted records without deleted_at, backend will fill now (insert-time) via SQL.
      stmts.push(
        upsert.bind(
          r.id,
          r.date,
          r.issue,
          r.department,
          r.name,
          r.solution,
          r.remarks,
          r.type,
          r.is_deleted,
          r.is_deleted,
          r.deleted_at,
          r.updated_at,
          hasVer,
          incomingTs,
          tsForInsert,
          hasVer
        )
      );

      // Stats (best-effort, based on current snapshot)
      const prevTs = prev ? (Number(prev.ts) || 0) : 0;
      const prevStr = prev ? String(prev.s || "") : "";

      if (r.id == null || !existingMap.has(r.id)) {
        inserts++;
        if (r.id != null) existingMap.set(r.id, { ts: (incomingTs > 0 ? incomingTs : nowTs), s: r.updated_at || "" });
      } else if (hasVer && ((incomingTs > 0 && incomingTs > prevTs) || (incomingTs === 0 && String(r.updated_at || "") > prevStr))) {
        updates++;
        existingMap.set(r.id, { ts: incomingTs > 0 ? incomingTs : nowTs, s: r.updated_at });
      } else {
        skips++;
        skipped_newer_or_equal++;
      }
    }

    try {
      await env.DB.batch(stmts);
    } catch (e) {
      return jsonResponse({ ok: false, error: `import apply failed: ${String(e)}` }, { status: 500 });
    }
  }

    }
  }

  // A1: auto-heal FTS index after successful bulk import
  let fts_rebuild = null;
  if (inserts + updates > 0) {
    const rr = await tryRebuildFTS(env);
    // Don't fail the import if rebuild fails; surface it for observability.
    fts_rebuild = rr;
  }

  return jsonResponse({
    ok: true,
    ...(fts_rebuild ? { fts_rebuild } : {}),
    totals: {
      incoming: incoming.length,
      active: norm.active.length,
      trash: norm.trash.length,
      inserts,
      updates,
      skips,
      skipped_newer_or_equal,
    },
  });
}
