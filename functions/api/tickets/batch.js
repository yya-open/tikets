import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../../_lib/http.js";

/**
 * PUT /api/tickets/batch — 批量更新工单（状态 / 负责人）
 */
const handlePut = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (!ids.length) return errorJson("no_ids", { code: "no_ids", detail: "ids 数组为空或无效" });
  if (ids.length > 200) return errorJson("too_many_ids", { code: "too_many_ids", detail: "单次批量更新最多 200 条" });

  const rawUpdates = body.updates || {};
  const setClauses = [];
  const bindVars = [];
  const nowTs = Date.now();

  const validStatuses = ["待处理", "处理中", "已解决", "已关闭"];
  if (rawUpdates.status && rawUpdates.status !== "") {
    if (!validStatuses.includes(rawUpdates.status)) {
      return errorJson("invalid_status", { code: "invalid_status", detail: "无效的状态值" });
    }
    setClauses.push("status=?");
    bindVars.push(rawUpdates.status);
  }

  if (rawUpdates.assignee !== undefined) {
    setClauses.push("assignee=?");
    bindVars.push(String(rawUpdates.assignee || "").trim());
  }

  if (!setClauses.length) return errorJson("no_updates", { code: "no_updates", detail: "未指定需要更新的字段" });

  setClauses.push("updated_at=CURRENT_TIMESTAMP");
  setClauses.push("updated_at_ts=?");

  const placeholders = ids.map(() => "?").join(",");
  const sql = "UPDATE tickets SET " + setClauses.join(", ") + " WHERE id IN (" + placeholders + ") AND is_deleted=0";
  const allBinds = bindVars.concat(nowTs, ids);
  const r = await env.DB.prepare(sql).bind(...allBinds).run();
  const updated = Number(r?.meta?.changes ?? 0);
  return jsonResponse({ ok: true, updated: updated, total: ids.length });
});

export const onRequestPut = handlePut;