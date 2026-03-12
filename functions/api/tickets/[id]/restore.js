/**
 * PUT /api/tickets/:id/restore  -> restore a soft-deleted ticket
 */
function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function getEditKeyFromRequest(request) {
  const url = new URL(request.url);
  return (
    request.headers.get("X-EDIT-KEY") ||
    request.headers.get("x-edit-key") ||
    url.searchParams.get("key") ||
    ""
  );
}

function requireEditKey(request, env) {
  const expected = String(env.EDIT_KEY || "");
  if (!expected) {
    return new Response("Server misconfigured: EDIT_KEY is not set", { status: 500 });
  }
  const provided = getEditKeyFromRequest(request);
  if (provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

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
      // either not found or not deleted
      const q = await env.DB.prepare("SELECT id, is_deleted FROM tickets WHERE id=?").bind(id).all();
      const row = q?.results?.[0];
      if (!row) return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
      return jsonResponse({ ok: true, already: true });
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: "schema_missing", hint: "Your tickets table needs is_deleted/deleted_at columns." },
      { status: 500 }
    );
  }
}
