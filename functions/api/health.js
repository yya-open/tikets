import { respondCachedJson } from "../_lib/http.js";
import { getCurrentSchemaVersion, latestSchemaVersion } from "../_lib/schema_migrate.js";

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(String(name)).first();
  return Boolean(row?.name);
}

export async function onRequestGet({ request, env }) {
  try {
    const ticketCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM tickets").first();
    const deletedCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM tickets WHERE is_deleted=1").first().catch(() => ({ c: 0 }));
    const payload = {
      ok: true,
      now: new Date().toISOString(),
      database: { ok: true },
      schema: { current: await getCurrentSchemaVersion(env.DB), latest: latestSchemaVersion() },
      fts: { exists: await tableExists(env.DB, "tickets_fts") },
      counts: { tickets: Number(ticketCount?.c ?? 0) || 0, deleted: Number(deletedCount?.c ?? 0) || 0 },
      build: { version: "phase2-ui-health-validation" },
    };
    return respondCachedJson(request, payload, { maxAge: 15 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
  }
}
