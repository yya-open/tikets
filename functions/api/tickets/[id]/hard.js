import { requireEditKey } from "../../../_lib/auth.js";
import { jsonResponse, errorJson, withErrorHandler } from "../../../_lib/http.js";

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

const handleDelete = withErrorHandler(async ({ params, request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return errorJson("bad id", { status: 400 });

  const r = await env.DB.prepare("DELETE FROM tickets WHERE id=?").bind(id).run();
  const changes = Number(r?.meta?.changes ?? 0);
  if (changes === 0) return errorJson("not_found", { status: 404 });
  return jsonResponse({ ok: true, hard: true });
});

export const onRequestDelete = handleDelete;
