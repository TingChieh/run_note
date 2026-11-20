# GPX 轨迹动态回放实施计划

设计见 [2026-11-20-gpx-replay-design.md](../specs/2026-11-20-gpx-replay-design.md)。

1. 后端：在 `gpx/queries.py` 增加 `replay_points`（逐点测地边长）；新建 `gpx/replay.py`（时间插值、真实/模拟判定、运动时间、平滑配速）；在 `activities/{schema,service,router}.py` 增加 `/replay`；在 `showcase/{router,service}.py` 增加展示端点并做白名单重建。
2. 后端测试：`tests/unit/test_replay.py`；`tests/integration/test_replay.py`；在 `test_showcase.py` 中补展示端点与他人记录 404 的断言（`test_cross_user_access.py` 会自动发现新路由）。
3. 重新生成前端契约 `api.ts`；在 `tests/contract/api-types.ts` 中增加两条回放断言。
4. 前端：`lib/api/replay.ts`、`lib/replay/{engine,playback,replay-map}.ts`、`map-style.ts::applyReplayTheme`、`ReplayPlayer.svelte`、`ActivityReplayDialog.svelte`，并在详情页加入口。
5. 前端测试：`tests/unit/replay.test.ts`（含 5 万点性能）；`tests/ui/activity-replay.spec.ts` 加入 `playwright.ui.config.ts`（CI 运行的合成 UI 套件），并在 `tests/fixtures/activities.ts` 中补合成回放数据。
6. 文档：本计划、设计说明、`docs/89-gpx-replay.md`，以及 `design-system/components.md` 的组件条目。
7. 验证：Ruff、后端单元测试、隔离 `_test` 库上的相关集成测试、`svelte-check`、Vitest、合成 UI 套件。
