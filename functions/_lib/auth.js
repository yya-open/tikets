import { jsonResponse } from "./http.js";

export function getEditKeyFromRequest(request) {
  return request.headers.get("X-EDIT-KEY") || request.headers.get("x-edit-key") || "";
}

export function getAdminKeyFromRequest(request) {
  return request.headers.get("X-ADMIN-KEY") || request.headers.get("x-admin-key") || getEditKeyFromRequest(request);
}

async function sha256(input) {
  const enc = new TextEncoder();
  return await crypto.subtle.digest("SHA-256", enc.encode(String(input)));
}

async function timingSafeEqualString(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([sha256(provided), sha256(expected)]);
  if (typeof crypto?.subtle?.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }

  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(expectedHash);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireKey({ request, expected, provided, missingMessage, invalidCode }) {
  const expectedValues = (Array.isArray(expected) ? expected : [expected])
    .map((value) => String(value || ""))
    .filter(Boolean);

  if (!expectedValues.length) {
    return jsonResponse(
      { ok: false, error: "server_misconfigured", code: "server_misconfigured", message: missingMessage },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
  let valid = false;
  for (const expectedValue of expectedValues) {
    valid = (await timingSafeEqualString(provided, expectedValue)) || valid;
  }
  if (!provided || !valid) {
    return jsonResponse(
      { ok: false, error: invalidCode, code: invalidCode },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }
  return null;
}

export async function requireEditKey(request, env) {
  return await requireKey({
    request,
    expected: [env?.EDIT_KEY, env?.ADMIN_KEY],
    provided: String(getEditKeyFromRequest(request) || ""),
    missingMessage: "EDIT_KEY or ADMIN_KEY is not set",
    invalidCode: "invalid_edit_key",
  });
}

export async function requireAdminKey(request, env) {
  const expected = String(env?.ADMIN_KEY || env?.EDIT_KEY || "");
  return await requireKey({
    request,
    expected,
    provided: String(getAdminKeyFromRequest(request) || ""),
    missingMessage: "ADMIN_KEY or EDIT_KEY is not set",
    invalidCode: "invalid_admin_key",
  });
}
