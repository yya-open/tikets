export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function requestWantsFresh(request) {
  const url = new URL(request.url);
  const fresh = String(url.searchParams.get("fresh") || url.searchParams.get("_fresh") || "").toLowerCase();
  if (["1", "true", "yes"].includes(fresh)) return true;

  const cacheControl = String(request.headers.get("cache-control") || "").toLowerCase();
  const pragma = String(request.headers.get("pragma") || "").toLowerCase();
  return (
    cacheControl.includes("no-cache") ||
    cacheControl.includes("no-store") ||
    cacheControl.includes("max-age=0") ||
    pragma.includes("no-cache")
  );
}

export function isPublicCacheableGet(request) {
  if ((request.method || "GET").toUpperCase() !== "GET") return false;
  const editKey = request.headers.get("x-edit-key") || request.headers.get("X-EDIT-KEY");
  const adminKey = request.headers.get("x-admin-key") || request.headers.get("X-ADMIN-KEY");
  if (String(editKey || "").trim() || String(adminKey || "").trim()) return false;
  return !requestWantsFresh(request);
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(input)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function respondCachedJson(request, payload, { maxAge = 30, status = 200, headers = {} } = {}) {
  const body = JSON.stringify(payload);
  const etag = `W/"${await sha256Hex(body)}"`;
  const responseHeaders = {
    "content-type": "application/json; charset=UTF-8",
    "cache-control": `public, max-age=${Math.max(0, Math.trunc(maxAge))}`,
    etag,
    vary: "accept-encoding",
    ...headers,
  };

  const inm = request.headers.get("if-none-match") || request.headers.get("If-None-Match") || "";
  if (inm === etag) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  return new Response(body, { status, headers: responseHeaders });
}

// ===== 错误处理工具 =====

/**
 * 生成标准化的错误 JSON 响应。
 * 格式: { ok: false, error: string, code?: string, detail?: string }
 */
export function errorJson(error, { code, detail, status = 400, headers = {} } = {}) {
  const payload = { ok: false, error: String(error) };
  if (code) payload.code = code;
  if (detail) payload.detail = String(detail);
  return jsonResponse(payload, { status, headers });
}

/**
 * 安全解析请求 JSON 体。解析失败返回标准 400 错误响应。
 * 返回 { ok: true, data } 或 { ok: false, response }（Response 对象）。
 */
export async function parseJsonBody(request) {
  try {
    const data = await request.json();
    return { ok: true, data };
  } catch {
    return { ok: false, response: errorJson("invalid_json", { code: "invalid_json", status: 400 }) };
  }
}

/**
 * 高阶函数：包裹 handler，统一捕获异常并返回标准 500 错误。
 * 用法: export const onRequestGet = withErrorHandler(async ({ request, env, params }) => { ... });
 */
export function withErrorHandler(handler) {
  return async function (ctx) {
    try {
      return await handler(ctx);
    } catch (e) {
      console.error("Unhandled error:", e);
      return errorJson(String(e), { code: "internal_error", status: 500 });
    }
  };
}
