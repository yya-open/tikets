/**
 * POST /api/import/preview
 * Safe merge import (dry-run).
 *
 * Merge rule: only overwrite existing row when incoming.updated_at is strictly newer.
 * - If incoming.updated_at is empty/missing, it will NEVER overwrite existing rows.
 * - New ids will be inserted.
 *
 * Supported payload:
 * 1) Array of records
 * 2) { active: [...], trash: [...] }
 * 3) Wrappers: {records|data|tickets|items}
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
  if (Array.isArray(payload)) {
    return { active: payload, trash: [] };
  }
  if (payload && typeof payload === "object") {
    // New format
    if (Array.isArray(payload.active) || Array.isArray(payload.trash)) {
      return {
        active: Array.isArray(payload.active) ? payload.active : [],
        trash: Array.isArray(payload.trash) ? payload.trash : [],
      };
    }
    // Wrappers
    const active = pickFirstNonEmptyArray(payload.records, payload.data, payload.tickets, payload.items);
    const trash = pickFirstNonEmptyArray(payload.deleted, payload.recycle_bin);
    return { active, trash };
  }
  return null;
}

function normalizeRecord(r, forcedDeleted = null) {
  const obj = r && typeof r === "object" ? r : {};
  const idNum = Number(obj.id ?? obj.ID ?? obj.Id);
  const id = Number.isFinite(idNum) ? idNum : null;

  const updatedAt = String(obj.updated_at ?? obj.updatedAt ?? "").trim();
  const isDeletedRaw = Number(obj.is_deleted ?? obj.isDeleted ?? obj.__is_deleted ?? 0) ? 1 : 0;
  const is_deleted = forcedDeleted === null ? isDeletedRaw : forcedDeleted;

  const deletedAtRaw = String(obj.deleted_at ?? obj.deletedAt ?? "").trim();
  const deleted_at = is_deleted ? deletedAtRaw : "";

  return {
    id,
    date: String(obj.date ?? "").trim(),
    issue: String(obj.issue ?? "").trim(),
    department: String(obj.department ?? ""),
    name: String(obj.name ?? ""),
    solution: String(obj.solution ?? ""),
    remarks: String(obj.remarks ?? ""),
    type: String(obj.type ?? ""),
    updated_at: updatedAt,
    is_deleted,
    deleted_at,
  };
}

function normalizeAll(parsed) {
  const active = (parsed?.active || []).map((r) => normalizeRecord(r, 0));
  const trash = (parsed?.trash || []).map((r) => normalizeRecord(r, 1));

  // If payload is array-only but records carry is_deleted, respect it.
  const all = [...active, ...trash].map((r) => {
    if (parsed?.trash && parsed?.trash.length) return r;
    // array-only mode: allow record-level is_deleted
    return r;
  });

  return {
    active,
    trash,
    all,
  };
}

async function getColumns(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(tickets)").all();
  const cols = new Set();
  for (const r of results || []) cols.add(String(r.name));
  return cols;
}

// Keep preview compatible with old DB schema (some deployments may miss these columns).
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

  // Run sequentially; ALTER TABLE can be picky inside transactions.
  for (const s of stmts) {
    await s.run();
  }
}

async function fetchExistingMap(env, ids) {
  const map = new Map();
  if (!ids.length) return map;

  // Cloudflare D1 / SQLite has a limit on the number of bound parameters.
  // Keep it conservative to avoid "too many SQL variables".
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `SELECT id, updated_at FROM tickets WHERE id IN (${placeholders})`;
    const { results } = await env.DB.prepare(sql).bind(...chunk).all();
    for (const row of results || []) {
      map.set(Number(row.id), String(row.updated_at ?? "").trim());
    }
  }
  return map;
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  // Make preview resilient on older databases.
  try {
    await ensureSoftDeleteColumns(env);
  } catch (e) {
    return jsonResponse({ ok: false, error: `schema upgrade failed: ${String(e)}` }, { status: 500 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parsePayload(payload);
  if (!parsed) {
    return jsonResponse({ ok: false, error: "Expected an array or {active,trash}" }, { status: 400 });
  }

  const norm = normalizeAll(parsed);
  const incoming = norm.all;
  const ids = [...new Set(incoming.map((r) => r.id).filter((id) => Number.isFinite(id)))];

  let existingMap;
  try {
    existingMap = await fetchExistingMap(env, ids);
  } catch (e) {
    return jsonResponse({ ok: false, error: `db query failed: ${String(e)}` }, { status: 500 });
  }

  let inserts = 0;
  let updates = 0;
  let skips = 0;
  let skipped_newer_or_equal = 0;

  for (const r of incoming) {
    if (!Number.isFinite(r.id)) {
      inserts++;
      continue;
    }
    const existingUpdatedAt = existingMap.get(r.id);
    if (existingUpdatedAt === undefined) {
      inserts++;
      continue;
    }
    const hasIncomingUpdatedAt = !!r.updated_at;
    if (!hasIncomingUpdatedAt) {
      skips++;
      skipped_newer_or_equal++;
      continue;
    }
    // Lexicographic compare works for both "YYYY-MM-DD HH:MM:SS" and ISO8601.
    if (r.updated_at > (existingUpdatedAt || "")) {
      updates++;
    } else {
      skips++;
      skipped_newer_or_equal++;
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
