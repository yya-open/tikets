import { requireEditKey } from "../_lib/auth.js";
import { jsonResponse } from "../_lib/http.js";
import { normalizeImportPayload, parseImportPayload } from "../_lib/import_common.js";

async function tryRebuildFTS(env) {
  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
  } catch {}
}

export async function onRequestPut({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json", code: "invalid_json" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const parsed = parseImportPayload(payload);
  if (!parsed) {
    return jsonResponse({ ok: false, error: "Expected an array or {active,trash}" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const normalized = normalizeImportPayload(parsed);
  const invalid = normalized.all.filter((row) => !row.date || !row.issue);
  if (invalid.length) {
    return jsonResponse({ ok: false, error: "validation_error", code: "validation_error", invalid: invalid.slice(0, 10) }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const createStageSql = `
    CREATE TABLE IF NOT EXISTS tickets_stage (
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
    )
  `;
  await env.DB.prepare(createStageSql).run();
  await env.DB.prepare("DELETE FROM tickets_stage").run();

  const insertStage = env.DB.prepare(
    `INSERT INTO tickets_stage (id, date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts, is_deleted, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), ?, ?, ?)`
  );
  for (let i = 0; i < normalized.all.length; i += 100) {
    const chunk = normalized.all.slice(i, i + 100).map((row) => insertStage.bind(row.id, row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.updated_at, row.updated_at_ts || Date.now(), row.is_deleted, row.deleted_at || null));
    if (chunk.length) await env.DB.batch(chunk);
  }

  await env.DB.prepare("DELETE FROM tickets").run();
  await env.DB.prepare(`INSERT INTO tickets (id, date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts, is_deleted, deleted_at) SELECT id, date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts, is_deleted, deleted_at FROM tickets_stage ORDER BY id`).run();
  await tryRebuildFTS(env);

  return jsonResponse({ ok: true, inserted: normalized.all.length, active: normalized.active.length, trash: normalized.trash.length, mode: "replace_all_via_stage" }, { headers: { "cache-control": "no-store" } });
}
