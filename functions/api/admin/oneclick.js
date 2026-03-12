import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse } from "../../_lib/http.js";
import { applyPendingMigrations, getCurrentSchemaVersion, latestSchemaVersion, listPendingMigrations } from "../../_lib/schema_migrate.js";

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(String(name)).first();
  return Boolean(row?.name);
}

async function getIndexes(db, tableName) {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?").bind(String(tableName)).all();
  return rows?.results || [];
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const out = { ok: true, now: new Date().toISOString(), steps: {} };
  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const pending = await listPendingMigrations(env.DB);
    const applied = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);
    out.steps.migrate = { ok: true, before, after, latest: latestSchemaVersion(), pending_before: pending.map((m) => ({ version: m.version, name: m.name })), applied: applied.applied || [] };
  } catch (e) {
    out.steps.migrate = { ok: false, error: String(e) };
  }

  try {
    if (await tableExists(env.DB, "tickets_fts")) {
      await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
      out.steps.fts_rebuild = { ok: true };
    } else {
      out.steps.fts_rebuild = { ok: true, skipped: true, reason: "tickets_fts not found" };
    }
  } catch (e) {
    out.steps.fts_rebuild = { ok: false, error: String(e) };
  }

  try {
    const indexes = await getIndexes(env.DB, "tickets");
    const existing = new Set(indexes.map((x) => x.name).filter(Boolean));
    const expected = ["idx_tickets_active_updated", "idx_tickets_active_date_id", "idx_tickets_deleted"];
    out.steps.selfcheck = {
      ok: true,
      schema: { current: await getCurrentSchemaVersion(env.DB), latest: latestSchemaVersion() },
      fts: { exists: await tableExists(env.DB, "tickets_fts") },
      indexes: { expected, missing: expected.filter((name) => !existing.has(name)) },
    };
  } catch (e) {
    out.steps.selfcheck = { ok: false, error: String(e) };
  }

  out.ok = Boolean(out.steps.migrate?.ok && out.steps.selfcheck?.ok && (out.steps.fts_rebuild?.ok || out.steps.fts_rebuild?.skipped));
  return jsonResponse(out, { status: out.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
}
