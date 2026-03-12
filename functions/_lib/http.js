export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      ...headers,
    },
  });
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
