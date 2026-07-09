import { requireAdminKey } from "../../_lib/auth.js";
import { jsonResponse, withErrorHandler } from "../../_lib/http.js";

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;
  await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
  return jsonResponse({ ok: true });
});

const handleGet = withErrorHandler(async ({ request, env }) => {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets_fts").first();
  return jsonResponse({ ok: true, fts_rows: Number(r?.n || 0) });
});

export const onRequestPost = handlePost;
export const onRequestGet = handleGet;
