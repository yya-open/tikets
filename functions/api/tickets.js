import { requireEditKey } from "../_lib/auth.js";
import { isPublicCacheableGet, jsonResponse, errorJson, parseJsonBody, respondCachedJson, withErrorHandler } from "../_lib/http.js";
import { parseTicketListQuery } from "../_lib/ticket-query-params.js";
import { listTickets } from "../_lib/ticket-repository.js";
import { createTicket } from "../_lib/ticket-write-repository.js";
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

  const result = await createTicket(env.DB, checked.data, Date.now());
  return jsonResponse({ ok: true, ...result }, { status: 201 });
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