import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse, errorResponse } from '../../_lib/http.js';
import { applyPendingMigrations, getCurrentSchemaVersion, latestSchemaVersion, listPendingMigrations } from '../../_lib/schema_migrate.js';

export async function onRequestGet({ env }) {
  try {
    const current = await getCurrentSchemaVersion(env.DB);
    const pending = await listPendingMigrations(env.DB);
    return jsonResponse({ ok: true, current, latest: latestSchemaVersion(), pending: pending.map((m) => ({ version: m.version, name: m.name })) });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'migrate_status_failed' });
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const result = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);
    return jsonResponse({ ok: true, before, after, ...result });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'migrate_apply_failed' });
  }
}
