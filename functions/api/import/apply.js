import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../../_lib/http.js";
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

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const parsedPayload = parseImportPayload(payload);
  if (!parsedPayload) {
    return errorJson("Expected an array or {active,trash}", { status: 400 });
  }

  const normalized = normalizeImportPayload(parsedPayload);
  const incomingSummary = summarizeImport(normalized.all);
  const existingMap = await fetchExistingMap(env, normalized.all.map((row) => row.id));
  const details = diffImport(existingMap, normalized.all);
  const totals = summarizeDiff(details, incomingSummary);

  if (totals.invalid > 0) {
    return errorJson("validation_error", { code: "validation_error", status: 400 });
  }

  const nowTs = Date.now();
  const insertStmt = env.DB.prepare(
    `INSERT INTO tickets (
      id, date, issue, department, name, solution, remarks, type,
      status, priority, assignee, due_date, closed_at,
      is_deleted, deleted_at, updated_at, updated_at_ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), ?)`
  );
  const updateStmt = env.DB.prepare(
    `UPDATE tickets SET
      date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
      status=?, priority=?, assignee=?, due_date=?, closed_at=?,
      is_deleted=?, deleted_at=?, updated_at=COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), updated_at_ts=?
     WHERE id=?`
  );

  const updateIds = new Set(details.updates.map((item) => item.id));
  let applied = 0;
  let attempted = 0;
  let statements = [];
  async function flushBatch() {
    if (!statements.length) return;
    const batchSize = statements.length;
    attempted += batchSize;
    try {
      await env.DB.batch(statements);
      applied += batchSize;
      statements = [];
    } catch (error) {
      const failure = {
        ok: false,
        code: "import_apply_partial_failure",
        detail: "导入过程中有批次失败；此前成功提交的批次不会自动回滚。",
        attempted,
        applied,
        failed: batchSize,
        error: String(error?.message || error),
      };
      statements = [];
      return failure;
    }
  }

  for (const row of normalized.all) {
    if (!row.date || !row.issue) continue;
    const existing = Number.isFinite(row.id) ? existingMap.get(row.id) : null;
    if (!existing) {
      statements.push(insertStmt.bind(row.id, row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.status, row.priority, row.assignee, row.due_date || null, row.closed_at || null, row.is_deleted, row.deleted_at || null, row.updated_at, row.updated_at_ts || nowTs));
    } else {
      if (!updateIds.has(row.id)) continue;
      statements.push(updateStmt.bind(row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.status, row.priority, row.assignee, row.due_date || null, row.closed_at || null, row.is_deleted, row.deleted_at || null, row.updated_at, row.updated_at_ts || nowTs, row.id));
    }
    if (statements.length >= 100) {
      const failure = await flushBatch();
      if (failure) return errorJson("import_apply_partial_failure", { status: 409, ...failure });
    }
  }

  const failure = await flushBatch();
  if (failure) return errorJson("import_apply_partial_failure", { status: 409, ...failure });
  const fts = await tryRebuildFTS(env);
  return jsonResponse({ ok: true, totals, attempted, applied, fts });
});

export const onRequestPost = handlePost;
