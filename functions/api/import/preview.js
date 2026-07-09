import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, parseJsonBody, withErrorHandler } from "../../_lib/http.js";
import { diffImport, fetchExistingMap, normalizeImportPayload, parseImportPayload, pickExamples, summarizeDiff, summarizeImport } from "../../_lib/import_common.js";

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const parsedPayload = parseImportPayload(payload);
  if (!parsedPayload) {
    return jsonResponse({ ok: false, error: "Expected an array or {active,trash}" }, { status: 400 });
  }

  const normalized = normalizeImportPayload(parsedPayload);
  const incomingSummary = summarizeImport(normalized.all);
  const existingMap = await fetchExistingMap(env, normalized.all.map((row) => row.id));
  const details = diffImport(existingMap, normalized.all);
  const totals = summarizeDiff(details, incomingSummary);

  return jsonResponse({ ok: true, totals, examples: pickExamples(details), note: "preview is read-only and will not mutate schema or data" });
});

export const onRequestPost = handlePost;
