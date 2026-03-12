import { requireEditKey } from '../_lib/auth.js';
import { jsonResponse } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  return jsonResponse({ ok: true });
}
