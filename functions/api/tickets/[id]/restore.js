import { requireEditKey } from "../../../_lib/auth.js";
import { jsonResponse } from "../../../_lib/http.js";

/**
 * PUT /api/tickets/:id/restore  -> restore a soft-deleted ticket
 */
function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export async function onRequestPut({ params, request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad id" }, { status: 400 });

  try {
    const nowTs = Date.now();

    // Prefer schema with updated_at_ts; fall back gracefully if column missing.
    let r;
    try {
      r = await env.DB
        .prepare(
          `UPDATE tickets
           SET is_deleted=0,
               deleted_at=NULL,
               updated_at=CURRENT_TIMESTAMP,
               updated_at_ts=?
           WHERE id=? AND is_deleted=1`
        )
        .bind(nowTs, id)
        .run();
    } catch {
      r = await env.DB
        .prepare(
          `UPDATE tickets
           SET is_deleted=0,
               deleted_at=NULL,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND is_deleted=1`
        )
        .bind(id)
        .run();
    }

    const changes = Number(r?.meta?.changes ?? 0);
    if (changes === 0) {
      const q = await env.DB.prepare("SELECT id, is_deleted FROM tickets WHERE id=?").bind(id).all();
      const row = q?.results?.[0];
      if (!row) return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
      return jsonResponse({ ok: true, already: true });
    }

    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse(
      { ok: false, error: "schema_missing", hint: "Your tickets table needs is_deleted/deleted_at columns." },
      { status: 500 }
    );
  }
}
