# 75 个人记录

日期：2026-10-26 上线（PR #37），2026-10-27 改版。设计与计划见 `docs/superpowers/specs/2026-10-26-personal-records-overview-design.md` 与 `docs/superpowers/plans/2026-10-26-personal-records-overview.md`；#37 的初版设计见同目录 `2026-10-26-personal-records-design.md`。

> **本次改版是对 #37 的修订：个人记录改为“全部历史总览”。** 去掉年份与对比年份（查询参数、输入框、两年叠加曲线、截止日规则全部移除）；5K / 10K 最佳成绩加入“比第一次快了多少”；数据汇总页（`/dashboard`）的摘要卡换成整行的 `RecordsBanner`，`/records` 用同一套扁平卡片语言重做。接口响应结构随之变化（见下），前端是唯一使用方，前后端在同一个 PR 发布。无数据库变更、无迁移。

## 使用方式

- 入口：根展示 `/records`（匿名可访问）、本人工作区 `/workspace/records`、具名展示 `/p/{username}/records`；导航在“数据汇总”之后有“个人记录”。`/records` 需要应用外壳，所以 `frontend/src/routes/+layout.svelte` 的 `appLayout` 正则含 `records`；它刻意不在 `SITEMAP_PATHS` 中（与 `/routes` 一致），`seo.ts` 只为它提供页面描述。
- **数据汇总（`/dashboard`）**：一条通栏的 `RecordsBanner`（compact），由 `RecordsBannerLoader` 读取接口，位于目标 / 足迹地图区块之后、活动浏览之前。三列以发丝线分隔：**5K 最佳**、**10K 最佳**、**累计**（累计里程、次数、活动日、起始月份、平均配速）。右上角“查看全部”跳到 `/records`。读取失败时只在横幅位置显示错误与“重试”，页面其余部分不受影响；401 清空私人状态并跳转登录；加载中的占位与横幅等高，页面不跳动。同时调整：年度指标改为一张横条卡（四个指标，同样用发丝线分隔），并删除了与侧栏 / 手机菜单重复的“功能入口”区块。
- **`/records`**，自上而下：
  1. 页头；
  2. 顶部 `RecordsBanner`（hero，同样三列）；
  3. 一句人话总结，例如“今年已跑 X km，比去年同期多 Y km”；无活动时是鼓励文案并给出“查看跑步记录”入口；
  4. **月度卡**：“里程 | 配速”分段切换的同一张图，横轴是从第一次跑步所在月到当前月的连续月份；去掉网格线与纵轴刻度，柱子圆角，最大月份用强调色；配速为折线、纵轴反向（越高越快），没有可靠配速的月份留空断开、不插值；
  5. **逐年回顾**与**训练规律**两张卡并排（容器查询：每张至少 28rem 才并排，否则上下叠放）：
     - 逐年回顾：最新年份在前的排行列表，横条长度是该年里程相对最长一年的比例；进行中的年份标“进行中”，涨跌写“较去年同期”，其余年份写“较上一年”；首年没有涨跌；
     - 训练规律：最近 26 周每周跑步天数的圆点（0、1–2、3–4、5+ 天四档，语义令牌配色）+ 周内分布 7 根小柱（全部历史），并给出最常跑的星期（仅在一天或并列两天时才点名）。
  6. 图与卡片下方的 `<details>` 保留完整数据表，缺失值显示“—”并附 `sr-only` 说明。
- 最佳成绩口径（5K / 10K，未改动）：
  - 统计**全部历史**；只看**整次活动**，不做轨迹滑窗，长跑途中最快的 5 km / 10 km 不计入。
  - 距离档取自 `activities/classify.py` 的 `DISTANCE_BANDS`：5km 档 4.0–7.5 km，10km 档 9.0–12.0 km（含边界）。
  - 活动必须满足统计模块既有的“可靠”条件（距离 > 0、用时 > 0、有计时器或时间质量为 complete/manual）。
  - 按**平均配速**升序排名，并列取日期较早者，再按 id 保证确定性；不按总用时排序，否则 4 km 短跑会胜过 5 km；不做距离外推。
- **比首次快多少**：`first` 是该档位最早的一次可靠跑步（同一档位与可靠条件，按日期、开始时间（缺失排后）、id 升序取第一）。`pace_gain_seconds_per_km = first 配速 − best 配速`，量化到 0.001 秒。最佳与首次是同一次活动、任一侧缺失、或差值不为正时为 `null`，页面不显示对比：只跑过一次时提示“再跑一次，就能和这次比一比”，多次但最快的仍是第一次时提示“最快的一次仍是第一次”；进步不足 0.5 秒/km（四舍五入后为 0）时提示“和第一次几乎一样快”。横幅里的进度线只是示意（首次与最佳两点，线段长度按进步幅度映射，介于 20 % 与 100 %），数值以服务端为准。
- 月度时间线：从第一次活动所在月到当前月（含）连续，没有活动的月份补 0 / 配速 `null`；当前月即便没有活动也包含。没有任何活动时为空数组。若有未来日期的活动，时间线会延伸到该月，不报错。
- 逐年行：从首次活动年到当前年升序，中间没有活动的年份补零；`is_partial = (year == 当前年)`。非当前年的 `delta` 对比上一年全年（`delta_basis = "previous_year"`）；当前年对比上一年**截至今天同月日**的同期汇总（`"previous_year_same_period"`，2 月 29 日在非闰年按 2 月 28 日）；首年 `delta` 与 `delta_basis` 为 `null`。配速差任一侧缺失时为 `null`，负值表示更快。
- 动效：横幅首次进入视口时配速从首次值回落到最佳值、累计里程从 0 数到总数、进度线绘出（约 1.1 秒）。默认状态就是最终值（SSR、减少动态效果、打印、无 `IntersectionObserver` 时都直接显示最终值），读屏始终读最终值。
- 已知的小遗留（未处理）：当前年的那一行按全年统计，包含日期晚于今天的活动（未来日期的跑步）；而它的“较去年同期”涨跌截止到今天，所以两者在存在未来日期活动时口径不同。真实数据中几乎不会出现，若要处理需让当前年的汇总也截止到今天。

## 接口与隐私

三组只读 GET 端点，**没有查询参数**（多余的参数被忽略，不再校验）：

| 范围 | 路径 |
| --- | --- |
| 本人工作区 | `/api/v1/statistics/records` |
| 根展示（站主） | `/api/v1/showcase/statistics/records` |
| 具名展示 | `/api/v1/showcase/users/{username}/statistics/records` |

- 响应信封 `{data, error, meta.request_id}`，`data`（以 `backend/app/modules/statistics/schema.py` 的 `Records` 为准）：
  - `personal_bests`：固定 `[5km, 10km]`，每项 `{category, best, first, pace_gain_seconds_per_km}`；`best` 为 `null` 或 `{activity_id, activity_date, distance_m, duration_seconds, avg_pace_seconds_per_km, qualifying_count}`；`first` 为 `null` 或 `{activity_id, activity_date, distance_m, duration_seconds, avg_pace_seconds_per_km}`；
  - `totals`：`{activity_count, distance_m, activity_days, avg_pace_seconds_per_km, first_activity_date}`，全部历史，后两项可为 `null`；
  - `monthly`：`[{month_start (YYYY-MM-01), activity_count, distance_m, avg_pace_seconds_per_km}]`，连续、升序，无活动时 `[]`；
  - `weekly`：最近 26 周（周一起算，含本周）`[{week_start, active_days}]`，缺失周补 0；`weekday`：7 项 `[{weekday, activity_count}]`，周一为 0，全部历史；
  - `yearly`：`[{year, activity_count, distance_m, activity_days, avg_pace_seconds_per_km, is_partial, delta, delta_basis}]`，`delta` 为 `{activity_count, distance_m, avg_pace_seconds_per_km}`（可为负）；
  - `date_assignment`：固定 `activity_local_date`，日期按活动本地日期归属。
- 与 #37 相比：删除了 `year`、`compare_year`、`cutoff_date`、`compare_cutoff_date`、`compare_monthly`、`comparison`；`monthly` 项的 `month` 改为 `month_start` 且不再固定 12 项；新增 `totals`、`yearly`，`personal_bests` 项新增 `first` 与 `pace_gain_seconds_per_km`。
- 指标全部在服务端 SQL 中计算，复用统计模块的 `eligible` 判定与 `expressions()` / `finalize()`；月度序列用按月分组的 SQL，不受 `validate_range` 的 5 年上限影响，缺失月份在 Python 中补零。前端 `lib/api/records.ts` 做运行时校验（`monthly` 连续性、`yearly` 升序等），失败抛 `ActivityError`；前端只呈现，不计算权威运动指标。“当前日”取 `request.app.state.clock()` 转所属用户时区。
- **隐私边界不变**：响应只含汇总数字、日期与活动 ID，不含标题、备注、文件名、坐标、轨迹、邮箱。三个端点的返回字段相同。
- 展示端点沿用 `reject_owner_override`，由 SQL 固定 subject（根展示固定为 `SITE_OWNER_EMAIL` 对应的站主，具名展示限站主或同时 `is_active AND showcase_enabled` 的用户），不接受客户端传入的 owner；本人端点只读本人数据。
- 无数据库变更、无迁移、无新后端模块；实现位于 `backend/app/modules/statistics/records.py`，路由挂在既有 `statistics` 与 `showcase` router 上。前端合成 API（`frontend/tests/fixtures/ui-api.mjs`）已同步新结构。

## 验证记录

后端集成测试使用测试库 `running_note_phase_one_test`；环境变量只在 pytest 子进程中注入，未修改 `.env`，未运行 alembic 迁移，未触碰开发库。下表只列 2026-10-27 文档任务中实际运行的命令。

### 实际运行（2026-10-27）

| 命令 | 结果 |
| --- | --- |
| 后端 `.venv/bin/pytest tests/unit -q` | 430 passed（24.03 s） |
| 后端 `.venv/bin/ruff check app migrations tests` | All checks passed |
| 后端 `.venv/bin/ruff format --check app migrations tests` | 204 files already formatted |
| 后端 `.venv/bin/alembic heads`（只读） | 唯一 head：`0016_place_titles` |
| 后端整个 `tests/integration`（测试库，环境变量只注入 pytest 子进程） | 328 passed，1 skipped，用时 326.78 s |
| 前端 `pnpm test` | 229 passed（229） |
| 前端 `pnpm check` | 637 FILES，0 errors，0 warnings |
| 前端 `pnpm build` | 成功（既有大体积 chunk 警告属已知状态） |
| `playwright.ui.config.ts` 完整运行 | 212 passed，3 skipped，0 failed（7.5 min） |
| `playwright.showcase.config.ts` / `playwright.showcase-build.config.ts` | 各 6 passed |
| `playwright.admin-users.config.ts` / `playwright.admin-users-build.config.ts` | 各 8 passed |
| `playwright.design-system.config.ts` | 6 passed，2 failed（见下） |
| `git diff --check` | 无输出，退出码 0 |

- 集成运行中的 1 个 skipped 是 `tests/integration/test_migrations.py`，需要 `TEST_SNAPSHOT_DATABASE_URL`（未设置），与本功能无关。
- `design-system.config.ts` 的 2 个失败是浅色 / 深色 `composition` 快照：期望 1290×408 px，实际 1290×398 px。这两个失败在本次文档任务之前就已存在，再次运行结果相同，没有新增失败；基线截图未更新。
- 完整 UI 运行的 3 个 skipped 为用例自身的 skip 标记，未逐一核对来源。

### 未运行

- 对真实后端的 e2e（`*-e2e.config.ts`）、`basemaps-live.config.ts`（访问真实底图网络）。
- `backend/.venv/bin/python -m unittest discover -s infra/native/tests` 与其它 `infra/` 自检：本次不涉及 `infra/`、迁移、`scripts/`、依赖清单，未运行。
- 视觉检查：本次文档任务未做新的人工截图检查（深浅色、桌面 / 手机宽度、真实数据）；ECharts 画布未做像素断言。
- 开发库未升级，也未做任何读写；新接口未在运行中的开发实例上验证（开发服务未重启）；真实用户数据上的记录结果未验证（只用合成数据）。
- CI（GitHub Actions）未运行；改动涉及 backend 与 frontend，不触及迁移、`scripts/`、依赖清单、`infra/`，因此不需要改 `infra/native/tests/test_ci_changes.py`。


## 未受影响的部分

既有 `summary`、`trends`、`streaks` 等统计接口的响应结构与数字、旧版摘要分享、足迹、常跑路线的接口与行为未改动；5K / 10K 最佳成绩的口径未改动；无数据库 Schema 变化。
