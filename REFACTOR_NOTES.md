<<<<<<< HEAD
# P0 / P1 重构清单（已落代码）

## P0
- 统一写入鉴权：所有写接口统一走 `functions/_lib/auth.js`，只接受 `X-EDIT-KEY` 请求头，不再支持 `?key=`。
- 迁移初始化收口：`functions/_lib/schema_migrate.js` 的 v1 现在直接包含完整基础 schema，空库可通过 `/api/admin/migrate` 或 `/api/admin/oneclick` 一次起表。
- `import/preview` 改为纯只读：只做 dry-run，不再 `ALTER TABLE` 或回填数据。
- `import/apply` 不再偷偷修 schema：如果库没迁移到位，会返回 `schema_not_ready`，提示先跑 migrate/oneclick。
- 全量覆盖导入改为 staging 模式：先写 `tickets_import_stage`，成功后再替换正式表，避免“先删库后失败”。
- 统一错误结构：写接口统一返回 JSON 错误体，前端可稳定识别 `403 / schema_not_ready / invalid_record`。

## P1
- 统一分页策略：`/api/tickets` 改为 offset 分页，去掉前后端混用 cursor/offset 的复杂度。
- 列表/统计缓存统一：`/api/tickets` 和 `/api/stats` 都使用 ETag + edge cache；前端 GET 不再强制 `no-store`。
- 前端口令改为 `sessionStorage`：降低长期驻留风险，不再用 `localStorage` 长期保存共享口令。
- 前端兼容 403：口令错误统一按 403 处理并引导重新设置。

## 这次明确没有做的
- 没有新增审计日志 / 操作人记录。
- 没有把前端彻底拆成多文件模块，仍保留单页结构，只做最小兼容调整。
=======
# Phase 3 notes

- Frontend added modular helpers: `ticket-api.js`, `ticket-errors.js`, `ticket-filters.js`.
- Added list filters for `department` and `name`.
- `/api/tickets` now uses offset pagination only and no longer returns cursor navigation fields.
- Import preview now includes per-field diff examples for updates/skips.
- Unified frontend error mapping for auth, validation, conflict and not found errors.
- Health build version: `phase3-modular-filters-diff`.
>>>>>>> 2cfc828c8d2fb1c793bf59672e4a403ed7dd2d03
