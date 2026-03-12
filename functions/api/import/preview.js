import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse, errorResponse, readJson } from '../../_lib/http.js';
import { assertImportSchemaReady, fetchExistingVersionMap, normalizeImportPayload, parseImportPayload, shouldOverwrite, validateImportRecords } from '../../_lib/ticket_import.js';

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
      extra: { missing: schema.missing, hint: 'Run /api/admin/oneclick or /api/admin/migrate first. Preview is now read-only and no longer patches schema.' },
    });
  }

  const ids = normalized.all.map((r) => r.id).filter((id) => Number.isFinite(id));
  const existingMap = await fetchExistingVersionMap(env.DB, ids);

  let inserts = 0;
  let updates = 0;
  let skips = 0;
  let skipped_newer_or_equal = 0;

  for (const row of normalized.all) {
    if (!Number.isFinite(row.id)) {
      inserts += 1;
      continue;
    }
    const existing = existingMap.get(row.id);
    if (!existing) {
      inserts += 1;
      continue;
    }
    if (shouldOverwrite(existing, row)) {
      updates += 1;
    } else {
      skips += 1;
      skipped_newer_or_equal += 1;
    }
  }

  return jsonResponse({
    ok: true,
    dry_run: true,
    totals: {
      incoming: normalized.all.length,
      active: normalized.active.length,
      trash: normalized.trash.length,
      inserts,
      updates,
      skips,
      skipped_newer_or_equal,
    },
  });
}
