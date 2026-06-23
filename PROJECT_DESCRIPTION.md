# 项目说明：工单记录系统

## 一句话概述
这是一个基于 **Cloudflare Pages + D1** 的工单记录系统，用于集中管理工单录入、查询筛选、统计分析、导入导出、回收站恢复和系统字典维护。

## 项目定位
这个项目本质上是一个轻量级的工单台账系统，适合内部运维、IT 支持、办公室服务台等场景。它把原本可能散落在本地浏览器 `localStorage` 或零碎表格里的工单数据，统一迁移到云端数据库 D1 中，前端通过 Pages Functions 提供 API 完成数据读写。

## 技术架构
- 前端：`index.html` + `admin.html` + `assets/` 下的原生 JavaScript / CSS
- 后端：Cloudflare Pages Functions，路由集中在 `functions/api/`
- 数据库：Cloudflare D1，底层是 SQLite
- 搜索能力：支持普通 `LIKE` 模糊查询，也支持 FTS5 全文检索
- 导出能力：Excel、JSON、ZIP
- 测试：Node.js 原生测试，覆盖查询、校验、导入和 SQL 迁移

## 核心功能
### 1. 工单管理
- 新增工单
- 编辑工单
- 软删除、恢复、彻底删除
- 批量恢复、批量删除、批量导出

### 2. 查询与统计
- 按日期、类型、部门、姓名、关键词筛选
- 回收站视图
- 月份视图
- 统计图表和类型分布统计
- 支持分页和游标分页

### 3. 导入导出
- 导入预览：先看差异，再决定是否应用
- 安全导入：避免覆盖比云端更新的数据
- 备份导出：JSON、按月导出、年度 ZIP 打包
- Excel 导出：当前筛选结果、统计汇总、按月分 Sheet 导出

### 4. 系统管理
- 写入/管理员口令校验：通过 `X-EDIT-KEY` 保护写操作，通过 `ADMIN_KEY` 保护高危管理操作
- 管理员页面：健康检查、字典管理、一键初始化 / 自检
- 故障类型字典：统一维护工单类型，前端下拉选项自动读取
- Schema 迁移：支持数据库升级、FTS 重建与版本检查

## 数据模型
主要表是 `tickets`，字段包括：
- `id`
- `date`
- `issue`
- `department`
- `name`
- `solution`
- `remarks`
- `type`
- `updated_at`
- `updated_at_ts`
- `is_deleted`
- `deleted_at`

另外还有：
- `schema_migrations`：记录迁移版本
- `ticket_type_dict`：故障类型字典
- `tickets_fts`：全文搜索索引

## API 概览
主要接口包括：
- `GET /api/tickets`
- `POST /api/tickets`
- `PUT /api/tickets/:id`
- `DELETE /api/tickets/:id`
- `PUT /api/tickets/:id/restore`
- `DELETE /api/tickets/:id/hard`
- `GET /api/stats`
- `POST /api/import/preview`
- `POST /api/import/apply`
- `GET /api/health`
- `GET/POST /api/admin/migrate`
- `GET/POST /api/dictionaries/types`
- `POST /api/fts/rebuild`

## 现有特点
1. 读取接口支持边缘缓存，适合频繁刷新列表和统计页。
2. 写操作统一依赖共享口令，降低误操作风险。
3. 导入时会比较云端和本地版本，优先保护更新的数据。
4. 数据库迁移和 FTS 重建已经被单独抽出来，便于部署后自检。
5. 测试覆盖了查询构造、校验、导入差异和 SQL 拆分，说明项目已经考虑到后续维护。

## 一句话评价
这是一个“能落地”的内部工单系统：功能围绕实际运维场景展开，数据模型清晰，管理功能完整，且已经具备迁移、检索、备份和健康检查这些比较成熟的生产化能力。
