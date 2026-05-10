# Refactor Notes

## Current Cleanup

- Unified write authentication through `functions/_lib/auth.js`; write endpoints now accept `X-EDIT-KEY` only.
- Added backend support for the frontend `department`, `name`, and `status` filters on both `/api/tickets` and `/api/stats`.
- Qualified ticket columns in FTS-backed queries to avoid ambiguity when filtering by `type`.
- Fixed keyword searches with cursor params so keyword mode falls back to offset pagination cleanly.
- Removed stale old-schema fallback code that appended keyword filters to the wrong bind arrays.
- Changed frontend edit-key storage to `sessionStorage`, so the key only lives for the current browser session.
- Extracted shared ticket query helpers to `functions/_lib/ticket_query.js`.
- Added no-dependency Node tests for query helpers, ticket validation, import diffing, and SQL splitting.
- Added a System Management panel with health refresh and ticket type dictionary management.
- Added `ticket_type_dict` schema migration and `/api/dictionaries/types` APIs; dictionary renames sync existing ticket `type` values.

## Still Not Included

- No audit log or per-user operation history.
- No full frontend module-system migration; the app still uses ordered browser scripts and global state.
