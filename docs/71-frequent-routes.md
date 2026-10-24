# 71 常跑路线

日期：2026-10-24。设计与计划见 `docs/superpowers/specs/2026-10-23-frequent-routes-design.md` 与 `docs/superpowers/plans/2026-10-23-frequent-routes.md`。

## 使用方式

- 入口：根展示 `/routes`（匿名可访问）、本人工作区 `/workspace/routes`、具名展示 `/p/{username}/routes`；每个列表页都有对应的详情页 `.../routes/{id}`，导航在“足迹”之后新增“常跑路线”。
- 归类由后台 worker 在导入之后完成（跟在省份缓存之后，同一线程、同一次唤醒），不在导入请求内计算。尚有活动未处理时，列表顶部显示“正在整理路线”并轮询；轮询遇到一次瞬时错误后会继续重试。
- 只列出跑过 2 次及以上的路线；同一路线的成绩、最佳/平均用时与配速、跑过次数均在读取时由 SQL 聚合，不落库。
- 归类规则（常量集中在 `backend/app/modules/route_groups/groups.py`，算法版本 `route-groups-v2`，版本变化即全量重算）：
  - 参与归类的最小距离 1 km；两次跑步距离相差不超过 15%（相对较大者）；
  - 轨迹先去重复点再按约 5 米简化为指纹，指纹顶点数上限 2000（超限只再做一次 10 倍更粗的简化，仍超限则不参与）；简化后长度不足 100 米的指纹同样不参与；
  - 50 米缓冲区的互相覆盖率，取两个方向的较小值，达到 80% 视为同一路线；与方向、起点无关，反向跑、换起点的环线归为一组。
- 列表排序：`count`（跑过次数，默认）、`recent`（最近一次）、`distance`（距离）。详情页含地图（复用底图控制器）、历次用时趋势图（附数据表兜底）和成绩表，缺失值显示“—”。

## 接口与隐私

四组只读 GET 端点（`limit` 默认 20、上限 100；`offset` 默认 0、上限 1000000；`sort` 取 `count|recent|distance`；本人工作区列表出现其他查询参数返回 422，展示端点与各详情端点不做该检查，见“已知后续事项”）：

| 范围 | 列表 | 详情 |
| --- | --- | --- |
| 本人工作区 | `/api/v1/routes/groups` | `/api/v1/routes/groups/{id}` |
| 根展示（站主） | `/api/v1/showcase/routes/groups` | `/api/v1/showcase/routes/groups/{id}` |
| 具名展示 | `/api/v1/showcase/users/{username}/routes/groups` | `/api/v1/showcase/users/{username}/routes/groups/{id}` |

- 列表响应 `{items, total, limit, offset, building}`。每项字段白名单（`schema.py`）：`id`、`run_count`、`first_date`、`last_date`、`median_distance_m`、`best_duration_seconds`、`avg_duration_seconds`、`best_pace_seconds_per_km`、`avg_pace_seconds_per_km`、`shape`（简化折线，用于缩略图与详情地图）。
- 详情在此基础上增加 `runs`，每项仅含 `activity_id`、`title`、`activity_date`、`distance_m`、`duration_seconds`、`avg_pace_seconds_per_km`、`coverage`。
- `building: true` 表示该用户仍有未完成指纹或未入组的活动，当前结果可能不完整；它不阻塞读取。
- 他人资源或不存在的 id 一律 404，不返回 403。展示端点由 SQL 固定 subject：根展示固定为 `SITE_OWNER_EMAIL` 对应的站主，具名展示限站主或同时 `is_active AND showcase_enabled` 的用户；不接受客户端传入的 owner（根展示上传 owner 覆盖参数返回 422）。
- 公开展示遵循“完整展示”规则，响应含完整轨迹形状；旧版摘要分享未涉及，行为不变。
- 响应不含邮箱、备注、文件名、原始 GPX/TCX。
- 首次升级后的全量归类由后台 worker 分批完成（每批 20 个活动、每次扫描最多 50 个用户，可中断、可重入）；单个用户或单条活动出错被隔离，不阻塞其他用户。

## 验证记录

测试库为 `running_note_phase_one_test`（已在 `0015_route_groups`）；环境变量只在 Python 子进程中注入，未修改 `.env`，未运行 alembic，未触碰开发库 `running_note`。每次集成运行后均检查 `pg_stat_activity` 与 `ps`，无残留后端。

### 实际运行（2026-10-24）

| 命令 | 结果 |
| --- | --- |
| 后端 `.venv/bin/pytest tests/unit -q` | 379 passed |
| 后端 `.venv/bin/ruff check app migrations tests` | All checks passed |
| 后端 `.venv/bin/ruff format --check app migrations tests` | 187 files already formatted |
| 后端 `.venv/bin/alembic heads`（只读） | `0015_route_groups (head)`，唯一 head |
| 集成（测试库）`test_route_groups.py`、`test_showcase.py`、`test_province_cache.py`、`test_footprint_snapshots.py`、`test_gpx_import.py`、`test_mifitness_import.py` | 109 passed，0 failed，0 skipped |
| 集成（测试库）整个 `tests/integration` 一次（修复前） | 276 passed，1 failed，1 skipped，用时 162.86 s；修复提交 5ca13a7 之后未再整目录重跑 |
| 集成（测试库）修复语句计数用例后的 7 文件序列 | 113 passed |
| 集成（测试库）`test_gpx_import.py` + `test_route_groups.py` | 70 passed |
| 集成（测试库）最后一轮修复后 `test_route_groups.py`、`test_footprint_snapshots.py`、`test_gpx_import.py`、`test_province_cache.py`、`test_showcase.py` | 95 passed，0 failed，0 skipped |
| 前端 `pnpm test` | 33 个文件，198 passed |
| 前端 `pnpm check` | 0 errors，0 warnings |
| 前端 `pnpm build` | 成功（既有大体积 chunk 警告属已知状态） |
| `pnpm exec playwright test --config playwright.route-groups.config.ts`（合成 API） | 9 passed |

整个集成目录当时的 1 个失败：`tests/integration/test_gpx_import.py::test_fifty_thousand_distinct_points_persist_in_batches`，断言 `len(statements) < 250` 实得 373。后续调查（`.superpowers` 任务报告）：计数监听挂在与应用共享的 API 引擎上，应用自己的后台 footprint worker 扫描（含新增的 `fill_route_groups`）在之前的测试留下待处理工作时会把语句计入。证据：该文件单独运行 88 条；先跑 `test_route_groups.py` 后 107 条；再跑另外六个文件后 324 条；而 5 万点插入本身只需约 50 条。已分类的部分里指纹 63、分组 56、省份缓存 2，另有 153 条未归类。因此“多出的语句来自后台扫描”是强烈的迹象，但并未被完全证明。测试侧修复（提交 5ca13a7）：该用例开头停止应用的 worker。修复后同一 7 文件序列 113 passed，`test_gpx_import.py` + `test_route_groups.py` 70 passed。**修复后没有重新运行整个 `tests/integration` 目录**，所以“整目录全绿”尚未被验证。

整目录运行中的 1 个 skipped 是 `tests/integration/test_migrations.py` 中依赖 `TEST_SNAPSHOT_DATABASE_URL` 的参数化用例（该变量未设置），与本功能无关。

后端另做了一处失败处理修正：指纹计算仅因 `statement_timeout`（`QueryCanceled`）失败时不再写入永久的 NULL 指纹，该活动不写行，下一次扫描会重试；其他错误仍写 NULL 指纹。新增集成用例覆盖超时与普通错误两条路径。指纹是派生数据，该改动只影响失败处理，不改变阈值与算法输出，因此没有升级 `ALGORITHM_VERSION`。卡片焦点环也补了不支持 `:has()` 时的降级（内部链接保留默认轮廓）。

### 未运行

- 真实浏览器下的暗色、键盘操作、焦点环与 375 px 视觉检查（只有合成 API 下的 `scrollWidth` 与 `data-theme=dark` 断言）。
- `/workspace/routes` 与 `/p/{username}/routes` 两个包装页没有专门的 UI 用例。
- 对真实后端的 e2e（`*-e2e.config.ts`）；ECharts 画布本身未做断言。
- 开发库未升级，也未做任何读写；新接口未在运行中的开发实例上验证（开发服务未重启）。
- 真实用户数据上的归类效果（阈值是否合适）未验证；包含数百次跑步的大组上 MATCH 的开销未测。
- design-system 文档与独立 showcase 未更新（本次没有新增通用组件）。

### 剩余风险与已知次要问题

- 开发库 revision 低于代码 head（`0015_route_groups`），升级前 `/api/health` 与 `/api/v1/health/ready` 因 revision 不匹配返回 503。升级开发库需要用户明确授权，并按“备份 → 恢复演练 → 受控单次升级 → 复核”的顺序，降级不是默认回滚手段。
- 阈值（15%、50 米、80%）只在合成样本上验证。已入组的“桥接”活动被删除后，组不会自动拆分。
- 每个用户的 except 只记录日志，会吞掉丢失连接类错误；回退产生的单跑步组不会再被重新考虑合并；MATCH 与组内全部成员比较，成本随组大小增长（见下）；`assign_user` 的锁在最坏情况下最多持有约 20 x 10 秒；关闭服务时不会取消正在执行的 MATCH。
- 总数 `total` 与内连接 LATERAL 在某成员缺少指纹几何时可能不一致；根展示的 owner 覆盖 422 检查仅在根路由上有测试，具名路由未单独断言。
- 测试缺口：`sort=recent`、offset 越界、空用户、单次跑步 404、中位数与配速数值等断言不足；404 用例不断言错误码；迁移单测的列检查只是子串匹配；前端 `readRouteGroup` 对非 UUID、错误信封、非 JSON 的路径未测；卡片的 `:has()` 焦点环没有专门用例。
- 性能事件：首版指纹使用 `ST_SimplifyPreserveTopology`，在 30 万点的轨迹上使 PostgreSQL 长时间无响应，需要重启测试库实例。改为 `ST_RemoveRepeatedPoints` 加 `ST_Simplify` 并设置 2000 顶点上限后，在测试库中清空约 70 个待处理活动（含 30 万与 20 万点的轨迹）不到 1 秒。教训：针对用户轨迹的 SQL 必须是线性时间，因为 `statement_timeout` 无法中断 GEOS 的计算。

### 已知后续事项

- MATCH 与组内全部成员比较，成本随组大小增长，从未在数百次跑步的组上测量。
- `fill_route_groups` 没有单次扫描的耗时上限：首次全量归类可能推迟下一次足迹快照扫描。
- 滚动发布时若两个 `ALGORITHM_VERSION` 同时存在，每次扫描会互相删除对方的派生数据；目前只运行一个应用实例。
- 单链接合并可能形成链式合并；桥接跑步被删除后，已发生的合并不会撤销。
- 展示列表与各详情端点不拒绝未知查询参数，而本人工作区列表会返回 422。
- 公开页的轮询端点每 5 秒执行两个 NOT EXISTS 扫描。
- 若有一批 20 个以上持续超时的活动排在最前面，同一次扫描里排在它们之后的活动要等超时活动被处理或下一轮才能得到指纹（按创建时间排序、超时行不落库）。
- 测试缺口：`sort=recent`、offset 越界、空用户、单次跑步 404、仅根路由有 422 owner 覆盖用例、`/workspace` 与 `/p/{username}` 包装页没有 UI 用例、没有真实浏览器下的暗色/键盘/375 px 检查。

## 未受影响的部分

既有足迹、省份缓存、活动分享图及旧版摘要分享的接口与行为未改动；本次未改动 `ActivityPosterDialog.svelte` 或任何海报文件。
