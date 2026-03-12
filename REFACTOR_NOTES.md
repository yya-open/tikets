# Phase 3 notes

- Frontend added modular helpers: `ticket-api.js`, `ticket-errors.js`, `ticket-filters.js`.
- Added list filters for `department` and `name`.
- `/api/tickets` now uses offset pagination only and no longer returns cursor navigation fields.
- Import preview now includes per-field diff examples for updates/skips.
- Unified frontend error mapping for auth, validation, conflict and not found errors.
- Health build version: `phase3-modular-filters-diff`.
