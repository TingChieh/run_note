# 用户多选与批量删除设计

日期：2026-10-18。用户要求在 `/admin/users` 增加多选与批量删除。已确认：删除为**永久删除**（级联清除该用户全部数据）；多选**仅限当前页**；**任意非站主账号**均可删除，无需先停用。以下为已确认设计。

站点设置（标题、icon、头像等）是独立子项目，另起设计文档，不在本文范围内。

## 方案比较

1. 推荐：新增批量接口 `POST /api/v1/admin/users/batch-delete`，单事务全有或全无。结果确定，前端无需处理部分失败。
2. 新增 `DELETE /api/v1/admin/users/{id}`，前端循环调用。中途失败会留下部分删除，提示与重试都难以说清，不采用。

## 接口与隐私

`POST /api/v1/admin/users/batch-delete`

- 依赖：`require_admin_write`（仅站主，CSRF + Origin 校验）。
- 请求体继承 `StrictInput`：`{ "ids": [UUID, ...] }`，1–100 个，不允许重复，未知字段拒绝（422）。
- 成功：200，信封 `data = { "deleted": true, "deleted_count": n }`，`n` 为本次实际删除行数。形状与既有 `POST /api/v1/activities/batch-delete` 一致。
- 列表中含站主 → 409 `OWNER_PROTECTED`「不能删除站主账号」，整批不删除。
- 不存在的 ID 静默忽略（如已在其他标签页删除），重复提交安全；不区分"不存在"与其他情况，不泄露存在性。
- 响应只返回计数，不回显邮箱或其他账号资料。

## 服务端实现

位于 `admin_users/service.py` 的 `delete_many(db, ids, settings)`，router 在调用后 `db.commit()`：

1. `SELECT … FROM users WHERE id IN (:ids) ORDER BY id FOR UPDATE`：按固定顺序加锁，避免与并发导入/编辑死锁；导入事务持有 `lock_owner` 行锁时等待其结束。
2. 锁定行中任一 `is_admin(user, settings)` → 抛 409，事务由依赖回滚。
3. `DELETE FROM users WHERE id IN (锁定行 ID)`，由数据库 `ON DELETE CASCADE` 清除 activities、gpx/tcx/mifitness 导入与原始文件、footprints、ai_reports、running_goals、分享、auth_sessions。会话随之删除，被删用户的已登录浏览器下一次请求即 401。
4. 返回 `{"deleted": True, "deleted_count": len(锁定行)}`。

不改数据库结构，不新增迁移。所有与用户相关的外键均已为 `CASCADE`，包括 `mifitness_imports` 指向 activities 的复合外键 `(activity_id, user_id)`，已核对模型与迁移（`0009_mifitness_imports.py`、`mifitness/model.py`）。

## 前端

`/admin/users` 页与 `lib/api/admin-users.ts`：

- 接口层新增 `deleteAdminUsers(ids, fetcher)`：先取 CSRF，再带 `X-CSRF-Token` 发送；运行时校验 `deleted === true` 且 `deleted_count` 为 0 到 `ids.length` 之间的整数，失败抛 `AdminUserError`；401 沿用"登录已过期"并跳转 `/admin?reason=expired`。
- 表格首列复选框（中文 `aria-label`「选择 昵称 @用户名」）；站主行不渲染复选框。表头复选框全选/取消当前页可选行，部分选中时设置 `indeterminate`。
- 有选中项时表格上方显示操作栏：「已选 N 个」+ 危险按钮「删除所选」。
- 确认用原生 `<dialog>`（沿用现有编辑/确认对话框的焦点记忆与返回）：列出将删除的账号（昵称 + @用户名），说明「将永久删除这些账号及其全部运动记录、轨迹、原始文件、AI 报告和分享链接，无法恢复」；需输入「删除」后确认按钮才可用；提交期间禁用。
- 成功：提示「已删除 N 个用户」，清空选择并重新加载当前页；当前页被删空时沿用既有回退上一页逻辑。失败：错误显示在对话框内，选择保留。
- 翻页、筛选、重新加载后清空选择；`disposed` 与请求令牌沿用页面现有实现。
- 样式使用既有语义令牌与 `.delete-confirm` 等危险操作样式，不新增色值。

## 测试

- 后端 unit：schema 拒绝空列表、超过 100、重复 ID、非 UUID、未知字段。
- 后端 integration（仅 `_test` 库）：删除普通用户后其活动、导入、AI 报告、目标、会话均为 0；含站主时 409 且无任何行被删；不存在 ID 被忽略并计数正确；非站主账号调用返回 403；缺 CSRF 被拒绝；AI 报告写入期间用户被删时安全失败（非 500、无残留）。
- 前端 unit：`deleteAdminUsers` 的请求路径、CSRF 头与响应校验。
- 合成 API：`tests/fixtures/ui-api.mjs` 补齐 batch-delete。
- UI（`admin-users.spec.ts`）：逐行选择、全选/半选、站主行不可选、未输入「删除」时不可确认、删除后列表刷新与提示、翻页清空选择、键盘操作与焦点返回。

## 验证记录

已实现并验证，完整记录见 [docs/60-admin-users-batch-delete.md](../../60-admin-users-batch-delete.md)。本次实际结果：

- `backend/`：`.venv/bin/pytest tests/unit -q`：327 passed。
- `backend/`：`ruff check app migrations tests`：All checks passed；`ruff format --check`：154 files already formatted。
- `backend/`：独立 `_test` 库（进程内注入环境变量）`pytest tests/integration/test_admin_users.py tests/integration/test_ai_reports.py`：22 passed，0 skipped。
- `frontend/`：`pnpm test`：28 files、171 tests passed；`pnpm check`：0 errors、0 warnings；`pnpm build`：成功（既有大 chunk 警告）。
- `frontend/`：`pnpm exec playwright test --config playwright.admin-users.config.ts`：8 passed（合成 API）。

未运行：`ui-shell.spec.ts`（3 项既有无关失败）、默认 e2e、其余后端集成文件；开发服务未重启，运行实例未加载新接口；未触碰开发库，无迁移。
