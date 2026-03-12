import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse } from "../../_lib/http.js";
import {
  applyPendingMigrations,
  getCurrentSchemaVersion,
  latestSchemaVersion,
  listPendingMigrations,
} from "../../_lib/schema_migrate.js";

export async function onRequestGet({ env }) {
  try {
    const current = await getCurrentSchemaVersion(env.DB);
    const latest = latestSchemaVersion();
    const pending = (await listPendingMigrations(env.DB)).map((m) => ({ version: m.version, name: m.name }));
    return jsonResponse({ ok: true, current, latest, pending }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;
  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const result = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);
    return jsonResponse({ ok: true, before, after, latest: latestSchemaVersion(), applied: result.applied || [] }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
