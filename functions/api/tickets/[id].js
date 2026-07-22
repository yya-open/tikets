import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../../_lib/http.js";
import { softDeleteTicket, updateTicket } from "../../_lib/ticket-write-repository.js";
import { validateTicketPayload } from "../../_lib/validation.js";

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

const handlePut = withErrorHandler(async ({ params, request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return errorJson("bad id", { status: 400 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const checked = validateTicketPayload(parsed.data, { requireVersion: true });
  if (!checked.ok) {
    return jsonResponse(
      { ok: false, error: "validation_error", code: "validation_error", fields: checked.errors },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const result = await updateTicket(env.DB, { id, ticket: checked.data, body: parsed.data, nowTs: Date.now() });
  if (result.status === "not_found") return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  if (result.status === "deleted") return jsonResponse({ ok: false, error: "deleted" }, { status: 410 });
  if (result.status === "missing_version") {
    return jsonResponse(
      { ok: false, error: "missing_version", hint: "send a positive updated_at_ts for concurrency control" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  if (result.status === "version_unavailable") {
    return jsonResponse(
      { ok: false, error: "version_unavailable", detail: "数据库缺少 updated_at_ts，无法安全执行并发更新" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  if (result.status === "conflict") {
    const { status: _status, ...conflict } = result;
    return jsonResponse({ ok: false, error: "conflict", ...conflict }, { status: 409 });
  }

  return jsonResponse({ ok: true, updated_at: result.updated_at, updated_at_ts: result.updated_at_ts });
});

const handleDelete = withErrorHandler(async ({ params, request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return errorJson("bad id", { status: 400 });

  const result = await softDeleteTicket(env.DB, id, Date.now());
  if (result.status === "not_found") return errorJson("not_found", { status: 404 });
  if (result.status === "already_deleted") return jsonResponse({ ok: true, already: true, soft: true });
  if (result.status === "failed") return errorJson("delete_failed", { status: 500 });
  return jsonResponse({ ok: true, soft: true });
});

export const onRequestPut = handlePut;
export const onRequestDelete = handleDelete;