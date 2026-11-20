# 月度与年度跑步报告实施计划（Issue #103）

关联设计：`docs/superpowers/specs/2026-11-20-period-reports-design.md`

## 阶段 1：基线验证与修改前截图

1. 确认当前分支测试基线（后端 unit、前端 vitest、Playwright `records.spec.ts`）。
2. 启动隔离合成 API + Vite（空闲端口），保存 `/records` 修改前基线截图（桌面 1440×900 浅/深、平板 768×1024、手机 390×844）。

## 阶段 2：后端 TDD（Schema + Service + Router + Contract）

1. 先写失败单元测试 `backend/tests/unit/test_period_report.py`（验证 `period_bounds`、未来截止、参数校验、路由注册），确认 RED。
2. 实现 `PeriodReport`（`statistics/schema.py`）、`period_bounds` 与 `period_report`（`statistics/service.py`），并在 `statistics/router.py` 注册本人只读端点 `/api/v1/statistics/report`（不新增匿名展示端点）；确认 unit test 转 GREEN。
3. 重新生成 `frontend/src/lib/api/generated/api.ts`，确认 `test_api_contract.py` 与 `test_architecture.py` 通过。
4. 启动隔离 PostGIS 18 `_test` 集群，迁移至 head，编写并运行集成测试 `backend/tests/integration/test_period_report.py`（含 `test_statistics.py` 2024 样本复用及全部边界场景）。

## 阶段 3：前端 TDD（API 契约 + 组件 + `/records` 集成）

1. 先写失败 Vitest 测试 `frontend/tests/unit/period-report.test.ts`，确认 RED。
2. 实现 `frontend/src/lib/api/period-report.ts`，补充 `frontend/tests/contract/api-types.ts` 契约断言，确认 Vitest 与 `pnpm check` GREEN。
3. 更新 `frontend/tests/fixtures/ui-api.mjs` 支持 `/statistics/report`。
4. 实现 `frontend/src/lib/components/PeriodReportCard.svelte`（确保切换请求在途时标题、日期、`aria-label` 与指标严格一致并给出状态提示）并集成到 `frontend/src/routes/records/+page.svelte`（按 `viewsOwnRecords` 仅对已登录查看本人记录渲染，保留匿名公开页原样），用 Prettier 格式化本次新增/改动文件。
5. 编写 Playwright UI 验收用例（扩展 `frontend/tests/ui/records.spec.ts`）与真实后端 E2E 用例（`frontend/tests/e2e/period-report.spec.ts`）。

## 阶段 4：全面验证、Visual QA 与文档交付

1. 运行全量质量检查：后端 ruff + unit + integration（PostGIS `_test`）、前端 vitest + svelte-check + build + Playwright UI + 真实后端 E2E + `design-system` 视觉回归检查。
2. 实机浏览器采集修改后 1440×900、768×1024、390×844 浅/深主题截图并核对版面、交互与控制台。
3. 编写中文功能与验收文档 `docs/90-period-reports.md`。
4. 核对 `git diff`、清理临时测试进程与临时数据库，提交并开指向 `main` 的 PR（关联 `#103`），回报协调者并跟进 CI。
