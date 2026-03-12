import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse } from "../../_lib/http.js";
import { diffImport, fetchExistingMap, normalizeImportPayload, parseImportPayload, summarizeDiff, summarizeImport } from "../../_lib/import_common.js";

async function tryRebuildFTS(env) {
  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
    return { ok: true };
  } catch (e) {
    if (/no such table/i.test(String(e || ""))) return { ok: true, skipped: true };
    return { ok: false, error: String(e) };
  }
}

export async function onRequestPost({ request, env }) {
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
  const incomingSummary = summarizeImport(normalized.all);
  const existingMap = await fetchExistingMap(env, normalized.all.map((row) => row.id));
  const details = diffImport(existingMap, normalized.all);
  const totals = summarizeDiff(details, incomingSummary);

  if (totals.invalid > 0) {
    return jsonResponse({ ok: false, error: "validation_error", code: "validation_error", totals, examples: { invalid: details.invalid.slice(0, 10) } }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const nowTs = Date.now();
  const insertStmt = env.DB.prepare(
    `INSERT INTO tickets (
      id, date, issue, department, name, solution, remarks, type,
      is_deleted, deleted_at, updated_at, updated_at_ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), ?)`
  );
  const updateStmt = env.DB.prepare(
    `UPDATE tickets SET
      date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
      is_deleted=?, deleted_at=?, updated_at=COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), updated_at_ts=?
     WHERE id=?`
  );

  const statements = [];
  for (const row of normalized.all) {
    if (!row.date || !row.issue) continue;
    const existing = Number.isFinite(row.id) ? existingMap.get(row.id) : null;
    if (!existing) {
      statements.push(insertStmt.bind(row.id, row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.is_deleted, row.deleted_at || null, row.updated_at, row.updated_at_ts || nowTs));
    } else {
      const shouldUpdate = details.updates.some((item) => item.id === row.id);
      if (!shouldUpdate) continue;
      statements.push(updateStmt.bind(row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.is_deleted, row.deleted_at || null, row.updated_at, row.updated_at_ts || nowTs, row.id));
    }
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
  const fts = await tryRebuildFTS(env);
  return jsonResponse({ ok: true, totals, applied: statements.length, fts }, { headers: { "cache-control": "no-store" } });
}
