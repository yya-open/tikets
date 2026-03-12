import { requireEditKey } from '../_lib/auth.js';
import { jsonResponse, errorResponse, readJson } from '../_lib/http.js';
import { assertImportSchemaReady, assignSequentialIds, normalizeImportPayload, parseImportPayload, tryRebuildFts, validateImportRecords } from '../_lib/ticket_import.js';

function buildStageInsert(db, row) {
  return db.prepare(
    `INSERT INTO tickets_import_stage (
      id, date, issue, department, name, solution, remarks, type,
      updated_at, updated_at_ts, is_deleted, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), ?, ?, ?)`
  ).bind(
    row.id,
    row.date,
    row.issue,
    row.department,
    row.name,
    row.solution,
    row.remarks,
    row.type,
    row.updated_at || '',
    Number(row.updated_at_ts || 0) || Date.now(),
    row.is_deleted,
    row.is_deleted ? (row.deleted_at || row.updated_at || new Date().toISOString()) : null,
  );
}

export async function onRequestPut({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = parseImportPayload(body.value);
  if (!parsed) {
    return errorResponse('Expected an array or {active,trash}', { status: 400, code: 'bad_payload' });
  }

  const normalized = normalizeImportPayload(parsed);
  const withIds = assignSequentialIds(normalized.all);
  const validationError = validateImportRecords(withIds);
  if (validationError) {
    return errorResponse(validationError, { status: 400, code: 'invalid_record' });
  }

  const schema = await assertImportSchemaReady(env.DB);
  if (!schema.ok) {
    return errorResponse('schema_not_ready', {
      status: 409,
      code: 'schema_not_ready',
      extra: { missing: schema.missing, hint: 'Run /api/admin/oneclick or /api/admin/migrate first. Full import no longer patches schema.' },
    });
  }

  await env.DB.prepare(`DROP TABLE IF EXISTS tickets_import_stage`).run();
  await env.DB.prepare(`
    CREATE TABLE tickets_import_stage (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      issue TEXT NOT NULL,
      department TEXT,
      name TEXT,
      solution TEXT,
      remarks TEXT,
      type TEXT,
      updated_at TEXT,
      updated_at_ts INTEGER,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT
    )
  `).run();

  try {
    const BATCH = 90;
    for (let i = 0; i < withIds.length; i += BATCH) {
      const chunk = withIds.slice(i, i + BATCH);
      await env.DB.batch(chunk.map((row) => buildStageInsert(env.DB, row)));
    }

    await env.DB.prepare('DELETE FROM tickets').run();
    await env.DB.prepare(`
      INSERT INTO tickets (
        id, date, issue, department, name, solution, remarks, type,
        updated_at, updated_at_ts, is_deleted, deleted_at
      )
      SELECT id, date, issue, department, name, solution, remarks, type,
             updated_at, updated_at_ts, is_deleted, deleted_at
      FROM tickets_import_stage
      ORDER BY id ASC
    `).run();

    const fts = await tryRebuildFts(env.DB);
    return jsonResponse({ ok: true, inserted: withIds.length, mode: 'replace_via_stage', fts });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'full_import_failed' });
  } finally {
    try { await env.DB.prepare('DROP TABLE IF EXISTS tickets_import_stage').run(); } catch {}
  }
}
