# 用户批量删除

日期：2026-10-18。设计见 `docs/superpowers/specs/2026-10-18-admin-users-batch-delete-design.md`，实施计划见 `docs/superpowers/plans/2026-10-18-admin-users-batch-delete.md`。

## 使用方式

站主进入「用户管理」（`/admin/users`）：

1. 勾选当前页的普通账号。站主行不渲染复选框；表头复选框可全选或取消当前页可选行，部分选中时显示半选状态。
2. 选中后表格上方出现操作栏（「已选 N 个」「清除选择」「删除所选」）。
3. 点击「删除所选」打开确认对话框，核对将被删除的账号列表（昵称 + @用户名），输入「删除」后「永久删除」按钮才可用。
4. 成功后提示「已删除 N 个用户」，清空选择并重新加载当前页（当前页被删空时沿用既有回退上一页逻辑）。失败时错误显示在对话框内，选择保留。

多选仅限当前页：翻页、筛选或刷新都会清空选择。删除是永久的，任意非站主账号均可删除，无需先停用。

## 接口与隐私

`POST /api/v1/admin/users/batch-delete`

- 权限：仅站主，依赖 `require_admin_write`（CSRF + Origin 校验）；普通用户返回 403，缺少 CSRF 被拒绝。
- 请求：`{"ids": [...]}`，继承 `StrictInput`，1–100 个不重复 UUID，未知字段返回 422。
- 响应：`{"deleted": true, "deleted_count": n}`，`n` 为本次实际删除的行数；形状与既有 `POST /api/v1/activities/batch-delete` 一致。响应只返回计数，不回显邮箱或其他账号资料。
- 含站主的整批请求返回 409 `OWNER_PROTECTED`，一个账号都不删除。
- 不存在的 ID 静默忽略（例如已在其他标签页删除），重复提交安全，也不泄露存在性。
- 实现：`admin_users/service.py` 的 `delete_many` 先按 ID 顺序 `SELECT … FOR UPDATE` 加锁，检查站主后单条 `DELETE`，router 随后 `db.commit()`。整批在一个事务中，全有或全无。
- 数据清除依赖数据库 `ON DELETE CASCADE`：活动、GPX/TCX/小米运动健康导入与原始文件、足迹、AI 报告、跑步目标、分享与登录会话随用户一并删除。被删用户已登录的浏览器下一次请求即 401。AI 报告写入期间用户被删时，请求以受控错误结束（实测为 503 `AI_TIMEOUT`，非 500），不留残留行。
- 前端 `deleteAdminUsers(ids)`（`lib/api/admin-users.ts`）先本地校验 1–100 个不重复 UUID，再取 CSRF 并带 `X-CSRF-Token` 发送，运行时校验 `deleted === true` 与 `deleted_count` 的范围。
- 无数据库迁移，无新增配置，未改动 SSR 代理白名单。

## 实施中的偏差

- 合成 API 与响应形状按既有活动批量删除对齐为 `{deleted, deleted_count}`。
- 后端集成用例中，上传活动默认为私有，创建分享前增加了一步把活动改为 `public` 的设置，不改变被验证的语义。
- UI 用例 `admin-users.spec.ts` 不在 `playwright.ui.config.ts` 的 `testMatch` 内，需用 `playwright.admin-users.config.ts` 运行。用例开头增加了等待站主行可见的断言，避免页面未水合就点击。
- 新按钮样式命名为 `.delete-submit`：`.delete-confirm` 已被既有确认对话框的提交按钮使用，复用会改变其外观。`.delete-list` 的左内边距用 `--space-6`（`--space-5` 未定义）。

## 验证记录

测试仅使用合成数据；后端集成只注入进程环境变量，指向显式列入允许目标的独立测试库 `runnote_tcx_v2_20261015_test`（名称以 `_test` 结尾），未修改 `.env`，未触碰开发库。

| 状态 | 命令 / 范围 | 本次实际结果 |
| --- | --- | --- |
| PASS | `backend/`：`.venv/bin/pytest tests/unit -q` | 327 passed，19.99s |
| PASS | `backend/`：`.venv/bin/ruff check app migrations tests` | All checks passed |
| PASS | `backend/`：`.venv/bin/ruff format --check app migrations tests` | 154 files already formatted |
| PASS | `backend/`：`pytest -q --tb=short tests/integration/test_admin_users.py tests/integration/test_ai_reports.py`（进程内注入 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS`） | 22 passed，0 skipped，4.24s；含批量删除级联、站主保护、缺 CSRF/非站主拒绝与 AI 写入期间删号 |
| PASS | `frontend/`：`pnpm test` | 28 files、171 tests passed |
| PASS | `frontend/`：`pnpm check` | 549 files，0 errors，0 warnings |
| PASS | `frontend/`：`pnpm build` | adapter-node 构建成功，保留既有大 chunk 警告 |
| PASS | `frontend/`：`pnpm exec playwright test --config playwright.admin-users.config.ts` | 8 passed，11.6s；含「站主在当前页选择账号并永久删除」，走合成 API |

终审后补充修复：`auth/service.py` 的 `require_identity` 在锁定用户行返回空（该用户正被批量删除、会话已级联删除）时直接返回 401 `AUTH_REQUIRED`，避免对已删除会话 `refresh` 导致 500。修复后复验：

| 状态 | 命令 / 范围 | 本次实际结果 |
| --- | --- | --- |
| PASS | `backend/`：`.venv/bin/pytest tests/unit -q` | 328 passed（新增 1 项删号竞态 401 单测） |
| PASS | `backend/`：`ruff check` / `ruff format --check`（app migrations tests） | All checks passed；154 files already formatted |
| PASS | `backend/`：`pytest -q --tb=short tests/integration/test_auth.py tests/integration/test_admin_users.py tests/integration/test_ai_reports.py`（同一测试库，进程内注入） | 50 passed，0 skipped，8.14s |

未运行或未覆盖：

- `ui-shell.spec.ts`：存在 3 项与本改动无关的既有失败，未运行。
- 默认 e2e（`playwright.config.ts`）及各 `*-e2e.config.ts`、`basemaps-live.config.ts`：未运行。
- 后端全量集成（`tests/integration` 其余文件）：只运行了上表列出的文件。
- 本地开发服务未重启，运行中的实例尚未加载新接口，新接口未在运行实例上验证。
- 未触碰开发库，无迁移，未执行 `alembic upgrade`。
- UI 验证来自合成 API，不等同真实业务验收；窄屏截图为 Task 4 实施时的临时人工检查，未留存证据。
