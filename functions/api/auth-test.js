import { requireAdminKey, requireEditKey } from "../_lib/auth.js";
import { jsonResponse } from "../_lib/http.js";

/**
 * GET /api/auth-test -> verify edit key.
 * GET /api/auth-test?scope=admin -> verify admin key.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "").toLowerCase();
  const denied = scope === "admin"
    ? await requireAdminKey(request, env)
    : await requireEditKey(request, env);
  if (denied) return denied;
  return jsonResponse({ ok: true, scope: scope === "admin" ? "admin" : "edit" }, { headers: { "cache-control": "no-store" } });
}
