import { requireEditKey } from "../../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../../../_lib/http.js";
import { normalizeTypeName } from "../../../_lib/ticket_types.js";

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? Math.trunc(id) : null;
}

function parseSortOrder(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function tableMissing(error) {
  return /no such table: ticket_type_dict/i.test(String(error?.message || error));
}

const handlePut = withErrorHandler(async ({ params, request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return errorJson("bad_id", { code: "bad_id", status: 400 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const name = normalizeTypeName(body?.name);
  if (!name) {
    return errorJson("validation_error", { code: "validation_error", detail: "类型名称不能为空", status: 400 });
  }

  const sortOrder = parseSortOrder(body?.sort_order ?? body?.sortOrder, 0);
  const enabled = Number(body?.is_enabled ?? body?.enabled ?? 1) ? 1 : 0;
  try {
    const current = await env.DB.prepare("SELECT id, name FROM ticket_type_dict WHERE id=?").bind(id).first();
    if (!current) return errorJson("not_found", { code: "not_found", status: 404 });

    const oldName = String(current.name || "");
    const r = await env.DB
      .prepare("UPDATE ticket_type_dict SET name=?, sort_order=?, is_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(name, sortOrder, enabled, id)
      .run();
    if (Number(r?.meta?.changes || 0) === 0) return errorJson("not_found", { code: "not_found", status: 404 });

    let ticketAffected = 0;
    if (oldName && oldName !== name) {
      const tr = await env.DB
        .prepare("UPDATE tickets SET type=?, updated_at=CURRENT_TIMESTAMP, updated_at_ts=? WHERE type=?")
        .bind(name, Date.now(), oldName)
        .run();
      ticketAffected = Number(tr?.meta?.changes || 0);
    }
    return jsonResponse({ ok: true, ticket_affected: ticketAffected });
  } catch (e) {
    if (tableMissing(e)) return errorJson("schema_not_ready", { code: "schema_not_ready", status: 409 });
    throw e;
  }
});

const handleDelete = withErrorHandler(async ({ params, request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return errorJson("bad_id", { code: "bad_id", status: 400 });

  try {
    const r = await env.DB
      .prepare("UPDATE ticket_type_dict SET is_enabled=0, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(id)
      .run();
    if (Number(r?.meta?.changes || 0) === 0) return errorJson("not_found", { code: "not_found", status: 404 });
    return jsonResponse({ ok: true, disabled: true });
  } catch (e) {
    if (tableMissing(e)) return errorJson("schema_not_ready", { code: "schema_not_ready", status: 409 });
    throw e;
  }
});

export const onRequestPut = handlePut;
export const onRequestDelete = handleDelete;
