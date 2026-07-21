import { requireEditKey } from "../_lib/auth.js";
import { isPublicCacheableGet, jsonResponse, errorJson, parseJsonBody, respondCachedJson, withErrorHandler } from "../_lib/http.js";
import { parseTicketListQuery } from "../_lib/ticket-query-params.js";
import { listTickets } from "../_lib/ticket-repository.js";
import { validateTicketPayload } from "../_lib/validation.js";

/**
 * GET  /api/tickets
 * POST /api/tickets
 *
 * Query behavior, response fields, cache policy, and legacy-schema fallback
 * are delegated to focused modules under functions/_lib.
 */
const handleGet = withErrorHandler(async ({ request, env }) => {
  const options = parseTicketListQuery(new URL(request.url).searchParams);
  const result = await listTickets(env.DB, options);

  const payload = {
    data: result.data,
    page: options.page,
    pageSize: options.pageSize,
    total: result.total,
  };
  if (result.supportsCursor) {
    payload.next_cursor = result.next_cursor;
    payload.prev_cursor = result.prev_cursor;
  }

  return await respondCachedJson(request, payload, { maxAge: 30 });
});

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const checked = validateTicketPayload(parsed.data);
  if (!checked.ok) {
    return errorJson("validation_error", { code: "validation_error", detail: null, status: 400 });
  }

  const { date, issue, department, name, solution, remarks, type, status, priority, assignee, due_date, closed_at } = checked.data;
  const nowTs = Date.now();
  const closedAtValue = status === "已关闭" ? (closed_at || new Date(nowTs).toISOString()) : null;

  let result;
  try {
    result = await env.DB
      .prepare(
        `INSERT INTO tickets (
           date, issue, department, name, solution, remarks, type,
           status, priority, assignee, due_date, closed_at,
           updated_at, updated_at_ts
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, status, priority, assignee, due_date || null, closedAtValue, nowTs)
      .run();
  } catch (error) {
    const message = String(error?.message || error);
    if (!/no such column/i.test(message) && !/table tickets has no column/i.test(message)) {
      throw error;
    }

    result = await env.DB
      .prepare(
        `INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, nowTs)
      .run();

    return jsonResponse(
      { ok: true, id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs, schema_warning: "workflow_fields_missing" },
      { status: 201 }
    );
  }

  return jsonResponse({ ok: true, id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs }, { status: 201 });
});

export const onRequestPost = handlePost;

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  if (!isPublicCacheableGet(request)) {
    return await handleGet({ request, env });
  }

  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("x-edge-cache", "HIT");
    return new Response(hit.body, { status: hit.status, headers });
  }

  const response = await handleGet({ request, env });
  if (response?.status !== 200) return response;

  const cacheControl = response.headers.get("cache-control") || "";
  if (/s-maxage=\d+/i.test(cacheControl)) {
    await cache.put(cacheKey, response.clone());
    return response;
  }

  const headers = new Headers(response.headers);
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 30;
  headers.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`);

  const cacheableResponse = new Response(response.body, { status: response.status, headers });
  await cache.put(cacheKey, cacheableResponse.clone());
  return cacheableResponse;
}