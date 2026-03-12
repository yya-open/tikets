import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse, errorResponse, readJson } from '../../_lib/http.js';
import { assertImportSchemaReady, fetchExistingVersionMap, normalizeImportPayload, parseImportPayload, shouldOverwrite, tryRebuildFts, validateImportRecords } from '../../_lib/ticket_import.js';

function buildUpsertStatement(db, row) {
  const versionTs = Number(row.updated_at_ts || 0) || Date.now();
  return db.prepare(
    `INSERT INTO tickets (
      id, date, issue, department, name, solution, remarks, type,
      is_deleted, deleted_at, updated_at, updated_at_ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), ?)
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
      updated_at_ts=excluded.updated_at_ts`
  ).bind(
    row.id,
    row.date,
    row.issue,
    row.department,
    row.name,
    row.solution,
    row.remarks,
    row.type,
    row.is_deleted,
    row.is_deleted ? (row.deleted_at || row.updated_at || new Date().toISOString()) : null,
    row.updated_at || '',
    versionTs,
  );
}

export async function onRequestPost({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = parseImportPayload(body.value);
  if (!parsed) {
    return errorResponse('Expected an array or {active,trash}', { status: 400, code: 'bad_payload' });
  }

  const normalized = normalizeImportPayload(parsed);
  const validationError = validateImportRecords(normalized.all);
  if (validationError) {
    return errorResponse(validationError, { status: 400, code: 'invalid_record' });
  }

  const schema = await assertImportSchemaReady(env.DB);
  if (!schema.ok) {
    return errorResponse('schema_not_ready', {
      status: 409,
      code: 'schema_not_ready',
      extra: { missing: schema.missing, hint: 'Run /api/admin/oneclick or /api/admin/migrate first. Import apply no longer patches schema.' },
    });
  }

  const ids = normalized.all.map((r) => r.id).filter((id) => Number.isFinite(id));
  const existingMap = await fetchExistingVersionMap(env.DB, ids);

  const toWrite = [];
  let inserts = 0;
  let updates = 0;
  let skips = 0;
  let skipped_newer_or_equal = 0;

  for (const row of normalized.all) {
    const existing = Number.isFinite(row.id) ? existingMap.get(row.id) : null;
    if (!Number.isFinite(row.id) || !existing) {
      inserts += 1;
      toWrite.push(row);
      continue;
    }
    if (shouldOverwrite(existing, row)) {
      updates += 1;
      toWrite.push(row);
    } else {
      skips += 1;
      skipped_newer_or_equal += 1;
    }
  }

  const BATCH = 90;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const chunk = toWrite.slice(i, i + BATCH);
    await env.DB.batch(chunk.map((row) => buildUpsertStatement(env.DB, row)));
  }

  const fts = await tryRebuildFts(env.DB);
  return jsonResponse({
    ok: true,
    totals: {
      incoming: normalized.all.length,
      active: normalized.active.length,
      trash: normalized.trash.length,
      inserts,
      updates,
      skips,
      skipped_newer_or_equal,
    },
    fts,
  });
}
