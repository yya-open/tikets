import { errorResponse } from './http.js';

export function getEditKeyFromRequest(request) {
  return (
    request.headers.get('x-edit-key') ||
    request.headers.get('X-EDIT-KEY') ||
    request.headers.get('x-editkey') ||
    request.headers.get('X-Edit-Key') ||
    ''
  ).trim();
}

export function requireEditKey(request, env) {
  const expected = String(env?.EDIT_KEY || '').trim();
  if (!expected) {
    return errorResponse('server_misconfigured', {
      status: 500,
      code: 'server_misconfigured',
      extra: { hint: 'EDIT_KEY is not set' },
    });
  }
  const provided = getEditKeyFromRequest(request);
  if (!provided) {
    return errorResponse('missing_edit_key', {
      status: 403,
      code: 'missing_edit_key',
      extra: { hint: 'Provide X-EDIT-KEY header. Query-string keys are no longer supported.' },
    });
  }
  if (provided !== expected) {
    return errorResponse('invalid_edit_key', { status: 403, code: 'invalid_edit_key' });
  }
  return null;
}
