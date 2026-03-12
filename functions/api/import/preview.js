import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse } from "../../_lib/http.js";
import { diffImport, fetchExistingMap, normalizeImportPayload, parseImportPayload, pickExamples, summarizeDiff, summarizeImport } from "../../_lib/import_common.js";

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json", code: "invalid_json" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const parsed = parseImportPayload(payload);
  if (!parsed) {
    return jsonResponse({ ok: false, error: "Expected an array or {active,trash}" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const normalized = normalizeImportPayload(parsed);
  const incomingSummary = summarizeImport(normalized.all);
  const existingMap = await fetchExistingMap(env, normalized.all.map((row) => row.id));
  const details = diffImport(existingMap, normalized.all);
  const totals = summarizeDiff(details, incomingSummary);

  return jsonResponse({ ok: true, totals, examples: pickExamples(details), note: "preview is read-only and will not mutate schema or data" }, { headers: { "cache-control": "no-store" } });
}
