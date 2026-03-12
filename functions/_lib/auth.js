import { jsonResponse } from "./http.js";

export function getEditKeyFromRequest(request) {
  return request.headers.get("X-EDIT-KEY") || request.headers.get("x-edit-key") || "";
}

export function requireEditKey(request, env) {
  const expected = String(env?.EDIT_KEY || "");
  if (!expected) {
    return jsonResponse(
      { ok: false, error: "server_misconfigured", code: "server_misconfigured", message: "EDIT_KEY is not set" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
  const provided = String(getEditKeyFromRequest(request) || "");
  if (!provided || provided !== expected) {
    return jsonResponse(
      { ok: false, error: "invalid_edit_key", code: "invalid_edit_key" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }
  return null;
}
