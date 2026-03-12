import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse } from '../../_lib/http.js';
import { applyPendingMigrations, getCurrentSchemaVersion, latestSchemaVersion, listPendingMigrations } from '../../_lib/schema_migrate.js';
import { tryRebuildFts } from '../../_lib/ticket_import.js';

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(String(name)).first();
  return !!row?.name;
}

async function getIndexes(db, tableName) {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?").bind(String(tableName)).all();
  return rows?.results || [];
}

export async function onRequestPost({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;

  const out = { ok: true, now: new Date().toISOString(), steps: {} };

  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const pending = await listPendingMigrations(env.DB);
    const result = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);
    out.steps.migrate = { ok: true, before, after, latest: latestSchemaVersion(), pending_before: pending.map((m) => ({ version: m.version, name: m.name })), applied: result.applied || [] };
  } catch (e) {
    out.steps.migrate = { ok: false, error: String(e) };
  }

  try {
    out.steps.fts_rebuild = await tryRebuildFts(env.DB);
  } catch (e) {
    out.steps.fts_rebuild = { ok: false, error: String(e) };
  }

  try {
    const schema = { current: await getCurrentSchemaVersion(env.DB), latest: latestSchemaVersion() };
    const ftsExists = await tableExists(env.DB, 'tickets_fts');
    let ftsCount = null;
    if (ftsExists) {
      const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM tickets_fts').first();
      ftsCount = Number(row?.c ?? 0) || 0;
    }
    const existingIndexes = new Set((await getIndexes(env.DB, 'tickets')).map((r) => String(r.name || '')));
    const expected = ['idx_tickets_active_updated', 'idx_tickets_active_date_id', 'idx_tickets_deleted'];
    out.steps.selfcheck = { ok: true, schema, fts: { exists: ftsExists, count: ftsCount }, indexes: { expected, missing: expected.filter((name) => !existingIndexes.has(name)) } };
  } catch (e) {
    out.steps.selfcheck = { ok: false, error: String(e) };
  }

  const okStep = (v) => v && v.ok === true;
  out.ok = okStep(out.steps.migrate) && okStep(out.steps.selfcheck) && (!!out.steps.fts_rebuild && (out.steps.fts_rebuild.ok === true || out.steps.fts_rebuild.skipped === true));
  return jsonResponse(out, { status: out.ok ? 200 : 500 });
}
