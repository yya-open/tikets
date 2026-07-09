import { requireAdminKey, requireEditKey } from "../_lib/auth.js";
import { jsonResponse, withErrorHandler } from "../_lib/http.js";

const handleGet = withErrorHandler(async ({ request, env }) => {
  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "").toLowerCase();
  const denied = scope === "admin"
    ? await requireAdminKey(request, env)
    : await requireEditKey(request, env);
  if (denied) return denied;
  return jsonResponse({ ok: true, scope: scope === "admin" ? "admin" : "edit" });
});

export const onRequestGet = handleGet;
