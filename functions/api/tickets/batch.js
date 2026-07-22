import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, withErrorHandler } from "../../_lib/http.js";
import { batchUpdateTickets } from "../../_lib/ticket-write-repository.js";

const VALID_STATUSES = ["待处理", "处理中", "已解决", "已关闭"];
const MAX_BATCH_SIZE = 200;

function parseBatchUpdate(body) {
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((id) => Number.isFinite(id)) : [];
  if (!ids.length) return { error: ["no_ids", "ids 数组为空或无效"] };
  if (ids.length > MAX_BATCH_SIZE) return { error: ["too_many_ids", "单次批量更新最多 200 条"] };

  const rawUpdates = body.updates || {};
  const updates = {};
  if (rawUpdates.status) {
    if (!VALID_STATUSES.includes(rawUpdates.status)) return { error: ["invalid_status", "无效的状态值"] };
    updates.status = rawUpdates.status;
  }
  // assignee 规则：
  //   - 未传字段 / 传空串 => 不改动负责人（避免"只改状态"意外清空负责人）
  //   - 传 null           => 显式清空负责人
  //   - 传非空字符串       => 更新为该值（trim 后仍非空才生效）
  if (rawUpdates.assignee === null) {
    updates.assignee = "";
  } else if (typeof rawUpdates.assignee === "string") {
    const trimmed = rawUpdates.assignee.trim();
    if (trimmed) updates.assignee = trimmed;
  }
  if (!Object.keys(updates).length) return { error: ["no_updates", "未指定需要更新的字段"] };

  return { ids, updates };
}

const handlePut = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const batch = parseBatchUpdate(parsed.data);
  if (batch.error) {
    const [code, detail] = batch.error;
    return errorJson(code, { code, detail });
  }

  const updated = await batchUpdateTickets(env.DB, { ...batch, nowTs: Date.now() });
  return jsonResponse({ ok: true, updated, total: batch.ids.length });
});

export const onRequestPut = handlePut;