/**
 * DELETE /api/tickets/:id/hard  -> permanently delete a ticket
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

export async function onRequestDelete({ params, request, env }) {
  const auth = requireEditKey(request, env);
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
