import { requireAdminKey } from "../../_lib/auth.js";
import { jsonResponse } from "../../_lib/http.js";

/**
 * POST /api/fts/rebuild
 * Rebuild FTS index (admin, requires ADMIN_KEY or EDIT_KEY fallback).
 */
export async function onRequestPost({ request, env }) {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;

  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
    return jsonResponse({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;

  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets_fts").first();
    return jsonResponse({ ok: true, fts_rows: Number(r?.n || 0) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
