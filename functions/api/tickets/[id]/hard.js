import { requireEditKey } from "../../../_lib/auth.js";
import { jsonResponse } from "../../../_lib/http.js";

/**
 * DELETE /api/tickets/:id/hard  -> permanently delete a ticket
 */
function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export async function onRequestDelete({ params, request, env }) {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad id" }, { status: 400 });

  const r = await env.DB.prepare("DELETE FROM tickets WHERE id=?").bind(id).run();
  const changes = Number(r?.meta?.changes ?? 0);
  if (changes === 0) {
    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  }
  return jsonResponse({ ok: true, hard: true });
}
