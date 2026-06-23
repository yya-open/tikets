import { requireAdminKey } from "../_lib/auth.js";
import { jsonResponse } from "../_lib/http.js";
import { getCurrentSchemaVersion, latestSchemaVersion } from "../_lib/schema_migrate.js";

async function tableExists(db, name) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(String(name)).first();
  return Boolean(row?.name);
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;

  try {
    const ticketCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM tickets").first();
    const deletedCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM tickets WHERE is_deleted=1").first().catch(() => ({ c: 0 }));
    const typeDictExists = await tableExists(env.DB, "ticket_type_dict");
    const typeDictCount = typeDictExists ? await env.DB.prepare("SELECT COUNT(*) AS c FROM ticket_type_dict").first().catch(() => ({ c: 0 })) : { c: 0 };
    const typeDictEnabledCount = typeDictExists ? await env.DB.prepare("SELECT COUNT(*) AS c FROM ticket_type_dict WHERE is_enabled=1").first().catch(() => ({ c: 0 })) : { c: 0 };
    const payload = {
      ok: true,
      now: new Date().toISOString(),
      database: { ok: true },
      schema: { current: await getCurrentSchemaVersion(env.DB), latest: latestSchemaVersion() },
      fts: { exists: await tableExists(env.DB, "tickets_fts") },
      dictionaries: {
        ticket_types: {
          exists: typeDictExists,
          total: Number(typeDictCount?.c ?? 0) || 0,
          enabled: Number(typeDictEnabledCount?.c ?? 0) || 0,
        },
      },
      counts: { tickets: Number(ticketCount?.c ?? 0) || 0, deleted: Number(deletedCount?.c ?? 0) || 0 },
      build: { version: "phase2-ui-health-validation" },
    };
    return jsonResponse(payload, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
