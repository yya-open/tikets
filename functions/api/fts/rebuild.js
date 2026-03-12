/**
 * POST /api/fts/rebuild
 * Rebuild FTS index (admin, requires x-edit-key).
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

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  try {
    await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function onRequestGet({ request, env }) {
  // allow quick health check, still requires key
  const auth = requireEditKey(request, env);
  if (auth) return auth;
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets_fts").first();
    return jsonResponse({ ok: true, fts_rows: Number(r?.n || 0) });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500 });
  }
}
