# 按标准赛事距离自动分类

提交：`2b18f4d`。本特性无独立的设计与计划文档，属小范围改动。

## 使用方式

- GPX、TCX、小米运动健康导入时，若请求未指定分类，系统按总距离自动写入 `activities.category`。GPX 与 TCX 共用 `gpx/service.py` 的 `import_track`，小米运动健康在 `mifitness/service.py` 的 `import_record` 中调用同一函数 `classify_distance`（`activities/classify.py`）。
- 分类带（米，含端点，另有说明除外）：

  | 分类 | 范围 |
  |------|------|
  | `3km` | 2500 ≤ 距离 < 4000 |
  | `5km` | 4000 ≤ 距离 ≤ 7500 |
  | `10km` | 9000 ≤ 距离 ≤ 12000 |
  | `半马` | 20000 ≤ 距离 ≤ 22500 |
  | `全马` | 41000 ≤ 距离 ≤ 44000 |

  4000 m 归入 `5km`；分类带之间的间隙（如 8000 m、15000 m、30000 m）以及距离为空或低于 2500 m 时保持空字符串，前端显示"未分类"。
- 用户随后手动修改分类（`PATCH` 活动）不受影响，自动分类只在导入时写入一次。
- 迁移 `0013_backfill_distance_category` 对已有数据只回填 `category = ''` 的活动，已有分类（含手动设置）不覆盖。
- 前端 `ActivityExplorer` 历史条原先同时显示距离与分类，距离与卡片其他位置重复，现仅显示分类（无分类时显示"未分类"）。

## 接口与隐私

- 不新增接口、不改变响应结构；`category` 仍是既有字段（`max_length=30`）。
- 分类只使用服务端已计算的距离，不引入坐标、文件名等私人字段，公开与分享视图的字段白名单不变。
- 迁移 `0013` 是纯数据回填，升级后 `/api/v1/health/ready` 在目标库执行 `alembic upgrade head` 前会返回 503（revision 不匹配）。
- 降级为空操作：自动写入与手动设置的分类无法区分，为避免破坏数据不做还原。
- 开发库升级须按"备份 → 恢复演练 → 受控单次升级 → 复核"的顺序，由操作者显式授权后执行。本文记录时尚未对开发库执行此迁移。

## 未实施项

- 不支持用户自定义分类带，也没有按分类的批量重新计算入口。
- 已有的非空分类不会被重新分类。
- 回填迁移的分类带与 `classify.py` 中的 `DISTANCE_BANDS` 是两份独立定义，修改其一须同步另一份。

## 验证记录

2026-10-20 实际运行：

后端（`backend/`，测试变量只注入进程环境，目标为独立测试库 `running_note_phase_one_test`，未改 `.env`、未触碰开发库）：

- 首次全量 `pytest -q`：587 通过、1 跳过、37 个错误。错误全部来自集成 fixture 的 `alembic_version` 断言（库在 `0012_site_settings`，期望 `0013_backfill_distance_category`），原因是该测试库未升级，不是代码缺陷。
- 对该 `_test` 库执行 `alembic upgrade head` 后 `alembic current` 为 `0013_backfill_distance_category (head)`；这同时是 0013 迁移在真实 PostGIS 测试库上的一次升级执行。
- 重跑全量 `pytest -q`：624 通过、1 跳过、0 失败。
- `ruff check app migrations tests` 通过；`ruff format --check app migrations tests`：172 个文件格式符合。
- `alembic heads`：`0013_backfill_distance_category (head)`。

前端（`frontend/`）：

- `pnpm check`：570 个文件，0 个错误，0 个警告。
- `pnpm test`：30 个文件、176 个用例通过。
- `pnpm build` 成功。
- Playwright（合成 API）：`dashboard-explorer` 19 通过；`activity-library` 38 通过、1 失败。失败用例为 `activity-metrics.spec.ts:9`（指标 `dd` 字号期望 ≥28，实际 20），与 `docs/62-motion-polish.md` 记录的是同一个已有问题，与本特性无关。

未运行：

- 开发库的 `alembic current` / 升级（按规范需用户显式授权，本文不记录其状态）。
- 没有专门断言"导入后 `category` 被自动写入"或"回填不覆盖手动分类"的集成用例；全量集成通过只说明导入与迁移链路未被破坏，不构成对这两条行为的直接证据。
- 其余 Playwright 配置、真实后端 e2e、视觉回归截图。
