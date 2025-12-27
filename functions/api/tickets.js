/**
 * GET  /api/tickets                -> list active tickets
 * GET  /api/tickets?trash=1        -> list deleted tickets (recycle bin)
 * POST /api/tickets                -> create ticket
 *
 * D1 binding name: DB
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());

  // New schema (soft delete)
  const sql = trash
    ? "SELECT * FROM tickets WHERE is_deleted=1 ORDER BY deleted_at DESC, id DESC"
    : "SELECT * FROM tickets WHERE is_deleted=0 ORDER BY date DESC, id DESC";

  try {
    const { results } = await env.DB.prepare(sql).all();
    return jsonResponse(results ?? []);
  } catch (e) {
    // Backward compatible fallback (old schema without is_deleted/deleted_at)
    const { results } = await env.DB
      .prepare("SELECT * FROM tickets ORDER BY date DESC, id DESC")
      .all();
    return jsonResponse(results ?? []);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const date = String(body?.date ?? "").trim();
  const issue = String(body?.issue ?? "").trim();
  if (!date || !issue) {
    return jsonResponse({ ok: false, error: "date & issue required" }, { status: 400 });
  }

  const department = String(body?.department ?? "");
  const name = String(body?.name ?? "");
  const solution = String(body?.solution ?? "");
  const remarks = String(body?.remarks ?? "");
  const type = String(body?.type ?? "");

  const r = await env.DB
    .prepare(
      `INSERT INTO tickets (date, issue, department, name, solution, remarks, type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(date, issue, department, name, solution, remarks, type)
    .run();

  return jsonResponse({ ok: true, id: r?.meta?.last_row_id ?? null }, { status: 201 });
}
