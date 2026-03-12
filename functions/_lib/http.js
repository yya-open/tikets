export function jsonResponse(data, { status = 200, headers = {}, cacheControl = 'no-store' } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': cacheControl,
      ...headers,
    },
  });
}

export function errorResponse(error, { status = 400, code = '', extra = {}, headers = {} } = {}) {
  return jsonResponse(
    {
      ok: false,
      error: String(error || 'request_failed'),
      ...(code ? { code } : {}),
      ...extra,
    },
    { status, headers }
  );
}

export async function readJson(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: errorResponse('Invalid JSON', { status: 400, code: 'bad_json' }) };
  }
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(input)));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function respondCachedJson(request, payload, { status = 200, maxAge = 30, headers = {} } = {}) {
  const body = JSON.stringify(payload);
  const etag = `W/\"${await sha256Hex(body)}\"`;
  const outHeaders = {
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': `public, max-age=${Math.max(0, Math.trunc(maxAge))}, s-maxage=${Math.max(0, Math.trunc(maxAge))}, stale-while-revalidate=300`,
    etag,
    vary: 'accept-encoding',
    ...headers,
  };
  const inm = request.headers.get('if-none-match') || request.headers.get('If-None-Match') || '';
  if (inm === etag) {
    return new Response(null, { status: 304, headers: outHeaders });
  }
  return new Response(body, { status, headers: outHeaders });
}

export function isPublicGetRequest(request) {
  if (String(request.method || 'GET').toUpperCase() !== 'GET') return false;
  const k = request.headers.get('x-edit-key') || request.headers.get('X-EDIT-KEY') || request.headers.get('x-editkey');
  return !(k && String(k).trim());
}
