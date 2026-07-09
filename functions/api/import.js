import { requireAdminKey } from "../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../_lib/http.js";
import { normalizeImportPayload, parseImportPayload } from "../_lib/import_common.js";

async function tryRebuildFTS(env) {
  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
  } catch {}
}

const handlePut = withErrorHandler(async ({ request, env }) => {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const confirmation = String(payload?.confirm || payload?.confirmation || "").trim();
  if (confirmation !== "REPLACE_ALL_TICKETS") {
    return errorJson("confirmation_required", {
      code: "confirmation_required",
      detail: "Set confirm to REPLACE_ALL_TICKETS to replace all cloud tickets.",
      status: 400,
    });
  }

  const parsedPayload = parseImportPayload(payload);
  if (!parsedPayload) {
    return errorJson("Expected an array or {active,trash}", { status: 400 });
  }

  const normalized = normalizeImportPayload(parsedPayload);
  const invalid = normalized.all.filter((row) => !row.date || !row.issue);
  if (invalid.length) {
    return errorJson("validation_error", { code: "validation_error", status: 400 });
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
      status TEXT DEFAULT '待处理',
      priority TEXT DEFAULT '普通',
      assignee TEXT,
      due_date TEXT,
      closed_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_at_ts INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT
    )
  `;
  await env.DB.prepare(createStageSql).run();
  await env.DB.prepare("DELETE FROM tickets_stage").run();

  const insertStage = env.DB.prepare(
    `INSERT INTO tickets_stage (
       id, date, issue, department, name, solution, remarks, type,
       status, priority, assignee, due_date, closed_at,
       updated_at, updated_at_ts, is_deleted, deleted_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?,''), CURRENT_TIMESTAMP), ?, ?, ?)`
  );
  for (let i = 0; i < normalized.all.length; i += 100) {
    const chunk = normalized.all.slice(i, i + 100).map((row) => insertStage.bind(row.id, row.date, row.issue, row.department, row.name, row.solution, row.remarks, row.type, row.status, row.priority, row.assignee, row.due_date || null, row.closed_at || null, row.updated_at, row.updated_at_ts || Date.now(), row.is_deleted, row.deleted_at || null));
    if (chunk.length) await env.DB.batch(chunk);
  }

  await env.DB.prepare("DELETE FROM tickets").run();
  await env.DB.prepare(`INSERT INTO tickets (
    id, date, issue, department, name, solution, remarks, type,
    status, priority, assignee, due_date, closed_at,
    updated_at, updated_at_ts, is_deleted, deleted_at
  )
  SELECT
    id, date, issue, department, name, solution, remarks, type,
    status, priority, assignee, due_date, closed_at,
    updated_at, updated_at_ts, is_deleted, deleted_at
  FROM tickets_stage ORDER BY id`).run();
  await tryRebuildFTS(env);

  return jsonResponse({ ok: true, inserted: normalized.all.length, active: normalized.active.length, trash: normalized.trash.length, mode: "replace_all_via_stage" });
});

export const onRequestPut = handlePut;
