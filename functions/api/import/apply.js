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
    has_updated_at: updatedAt.length > 0,
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
    const sql = `SELECT id, updated_at FROM tickets WHERE id IN (${placeholders})`;
    const { results } = await env.DB.prepare(sql).bind(...part).all();
    for (const r of results || []) {
      const id = Number(r.id);
      if (Number.isFinite(id)) map.set(id, String(r.updated_at ?? ""));
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
        is_deleted, deleted_at, updated_at
     ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, CASE WHEN ?=1 THEN COALESCE(NULLIF(?,''), datetime('now')) ELSE NULL END,
        COALESCE(NULLIF(?,''), datetime('now'))
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
        updated_at=excluded.updated_at
     WHERE (?=1) AND COALESCE(excluded.updated_at,'') > COALESCE(tickets.updated_at,'')`
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
      const hasUpd = r.has_updated_at ? 1 : 0;

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
          hasUpd
        )
      );

      // Stats (best-effort, based on current snapshot)
      if (r.id == null || !existingMap.has(r.id)) {
        inserts++;
        if (r.id != null) existingMap.set(r.id, r.updated_at || "");
      } else if (hasUpd && String(r.updated_at || "") > String(prev || "")) {
        updates++;
        existingMap.set(r.id, r.updated_at);
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

  return jsonResponse({
    ok: true,
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
