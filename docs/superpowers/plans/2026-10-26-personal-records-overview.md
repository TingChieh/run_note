# 个人记录总览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“个人记录”改成全部历史的总览：去掉年份选择，5K/10K 最佳卡片（含“比首次更快”）进入数据汇总的等大卡片网格，`/records` 以统一卡片语言重做。

**Architecture:** 后端在现有 `statistics/records.py` 上改造响应结构（月度时间线、逐年汇总、首次记录）；前端新增 `RecordsBanner`（整行横幅，compact 用于数据汇总、hero 用于 `/records`），不再增加等大小卡片，避免卡片连放过多层。

**Tech Stack:** FastAPI + SQLAlchemy 2.1（同步）+ Pydantic 2；SvelteKit 3 / Svelte 5 runes、echarts 6（动态加载）、Vitest、Playwright（合成 API）。

**Spec:** `docs/superpowers/specs/2026-10-26-personal-records-overview-design.md`（实现以其为准）。已上线版本的说明见 `docs/75-personal-records.md`、`docs/superpowers/specs/2026-10-26-personal-records-design.md`。

## Global Constraints

- 不执行 `git commit` / `push` / 建分支以外的 git 写操作；不碰 `.env`；无迁移；不在开发库写入。集成测试只在独立 `_test` 库，且仅在进程环境注入变量（见 `docs/09-phase-two-progress.md` “运行测试”，不打印 DSN）。
- 后端：同步 service；响应信封复用 `activities.router.envelope`；展示端沿用 `reject_owner_override` + `Owner`；只返回汇总数字、日期与活动 ID；Ruff 行宽 100。
- 前端：`#lib/...ts` 带扩展名（同目录兄弟文件沿用现有相对导入）；Svelte 5 runes；不用 store / `createEventDispatcher` / `$app/stores`；echarts 只在 `onMount` 内动态 `import()`；`disposed` 标志 + 单调请求令牌；401 清私人状态并跳转登录；只用语义令牌，不硬编码色值，字号用 `--text-*` 令牌（`typography-scale` 单测会拦截裸 `rem` 字号）；`role`/`aria-label` 中文；图表下 `<details>` 数据表，缺失值 `—` + `sr-only` 说明；`watchSystemTheme` 订阅并取消。
- 开始 UI 工作前先读 `docs/design-system/README.md`、`components.md`、`patterns.md`、`tokens.md`；复用现有实现，不重造材质。
- 新增通用组件同步更新 `docs/design-system/components.md` 与独立 showcase（`pnpm showcase`，入口见 `frontend/vite.showcase.config.ts`），不得进入生产路由或导航。
- 新增/改动被 UI 使用的后端接口必须同步 `frontend/tests/fixtures/ui-api.mjs`。
- 另有窗口可能占用 UI 测试端口 8191/5191（见记忆 ui-tests-port-clash）：运行前检查 `lsof -iTCP:8191 -iTCP:5191`；被占用时用临时配置改 8291/5291 并在结束后删除，不要杀别人的进程。`seo-routes.spec.ts` 在其它端口会失败（硬编码 5191）。
- 报告必须区分“实际运行”和“未运行”，引用真实输出。

## File Structure

| 文件 | 变更 |
| --- | --- |
| `backend/app/modules/statistics/schema.py` | 去掉对比相关模型；新增 `FirstRun`、`Totals`、`YearDelta`、`YearRow`；`MonthPoint` 改为 `month_start`；`CategoryBest` 加 `first`/`pace_gain_seconds_per_km`；`Records` 新结构 |
| `backend/app/modules/statistics/records.py` | 重写：`monthly_series`、`yearly_rows`、`first_run`、`totals`、`build_records(db, owner, today)`；保留 `personal_best`、`weekly_active_days`、`weekday_counts`、`shift_to_year`、`BEST_BANDS`、`WEEKS` |
| `backend/app/modules/statistics/router.py`、`showcase/router.py` | 去掉 `year`/`compare_year` 参数 |
| `backend/tests/unit/test_records.py`、`tests/integration/test_records.py`、`tests/integration/test_admin_users.py` | 按新结构改写 |
| `frontend/src/lib/api/records.ts` | v2 类型/解析/格式化 |
| `frontend/src/lib/components/RecordsBanner.svelte`（新） | 个人记录横幅（compact/hero 两种），5K/10K 两块 |
| `frontend/src/lib/components/RecordsBannerLoader.svelte`（新） | dashboard 用的取数包装 |
| `frontend/src/lib/components/RecordsSummaryCard.svelte`、`PersonalBests.svelte` | 删除 |
| `frontend/src/lib/components/records-chart.ts` | 去掉 `nullAfterCutoff`，其余保留 |
| `frontend/src/routes/dashboard/+page.svelte` | 去掉摘要卡挂载，给 `GoalOverview` 传 `<RecordsCards />` |
| `frontend/src/routes/records/+page.svelte` | 重做 |
| 新小组件（如 `YearCard.svelte`、`RhythmCard.svelte`，实现者按需） | `/records` 逐年卡、训练规律卡 |
| `frontend/tests/fixtures/ui-api.mjs`、`tests/ui/records.spec.ts`、`tests/ui/dashboard.spec.ts`、`tests/unit/records.test.ts`、`records-chart.test.ts` | 同步 |
| `docs/design-system/components.md`、showcase、`docs/75-personal-records.md` | 同步 |

---

### Task 1: 后端 v2

**Files:** 见上表后端部分。

**Interfaces — Produces（精确响应结构，Task 2+ 依赖）：**

```text
Records
  personal_bests: [CategoryBest]   # 固定 [5km, 10km]
  totals: Totals
  monthly: [MonthPoint]
  weekly: [WeekPoint]              # 26 项（同现有）
  weekday: [WeekdayPoint]          # 7 项，全部历史
  yearly: [YearRow]
  date_assignment: "activity_local_date"
CategoryBest   { category, best: PersonalBest|null, first: FirstRun|null, pace_gain_seconds_per_km: Decimal|null }
PersonalBest   { activity_id, activity_date, distance_m, duration_seconds, avg_pace_seconds_per_km, qualifying_count }   # 同现有
FirstRun       { activity_id, activity_date, distance_m, duration_seconds, avg_pace_seconds_per_km }
Totals         { activity_count:int, distance_m:Decimal, activity_days:int, avg_pace_seconds_per_km:Decimal|null, first_activity_date:date|null }
MonthPoint     { month_start:date, activity_count:int, distance_m:Decimal, avg_pace_seconds_per_km:Decimal|null }
YearRow        { year:int, activity_count:int, distance_m:Decimal, activity_days:int, avg_pace_seconds_per_km:Decimal|null,
                 is_partial:bool, delta: YearDelta|null, delta_basis: "previous_year"|"previous_year_same_period"|null }
YearDelta      { activity_count:int, distance_m:Decimal, avg_pace_seconds_per_km:Decimal|null }
```

规则（均需单元/集成测试覆盖）：

- `build_records(db, owner, today: date) -> Records`，不再有年份参数；删除 `resolve_years`、`year_cutoff`、`resolve_cutoffs`、`padded_month_points`、`comparison_delta`、`OptionalYear` 等只服务旧对比的代码（`shift_to_year` 保留）。两个 router 删除 `year`/`compare_year` 参数与对应导入。
- **首次**：`first_run(db, owner, low, high)`：与 `personal_best` 同样的 `eligible_expression()` 与距离区间，按 `activity_date ASC, id ASC` 取第一条。`pace_gain_seconds_per_km = first.pace − best.pace`（`Decimal`，保留 3 位）；`first` 或 `best` 缺失，或二者 `activity_id` 相同，则为 `null`；若结果 ≤ 0（首次已是最佳以外的情形不会出现，但防御）也置 `null`。
- **月度**：`monthly_series(db, owner, today)`：

  ```python
  month = func.date_trunc("month", A.activity_date)
  rows = db.execute(
      select(month.label("m"), *service.expressions()).where(A.user_id == owner).group_by("m").order_by("m")
  ).mappings().all()
  ```

  用 `service.finalize(row)` 得到 `activity_count/distance_m/avg_pace`；起点 = 首个有数据月，终点 = `max(最后有数据月, today 所在月)`；中间缺失月份补 `activity_count=0, distance_m=Decimal(0), avg_pace=None`；无任何活动返回 `[]`。注意 `date_trunc` 返回 datetime，转 `date`。
- **逐年**：`yearly_rows(db, owner, today)`：`extract("year", A.activity_date)` 分组，复用 `service.expressions()`/`finalize`；年份范围从首年到 `max(末年, today.year)` 补空年（里程 0，次数 0，配速 None）。第一行 `delta=None, delta_basis=None`；其余行 `delta = 本年 − 上一年`（配速两侧都有才算，否则 `None`）。`is_partial = (year == today.year)`；当前年行的 `delta` 改用上一年“同期”：`service.summary(db, owner, date(year-1,1,1), shift_to_year(today, year-1) + timedelta(days=1))`，`delta_basis="previous_year_same_period"`；其余年 `delta_basis="previous_year"`。若当前年是首年，`delta=None`。
- **totals**：`service.finalize(service.query(db, owner)[0])`（无日期区间，不触发 `validate_range`），`first_activity_date = db.scalar(select(func.min(A.activity_date)).where(A.user_id == owner))`。
- **weekday**：全部历史（`service.query(db, owner, daily=True)` 按日聚合后 `weekday_counts`；注意无区间参数时 `query` 返回所有日）。`weekly` 同现有。
- 展示端与本人端返回字段完全相同；不接受 owner 参数的行为不变。

- [ ] **Step 1: 改写单元测试**（`tests/unit/test_records.py`）：删除旧的年份/截止日/差值测试，保留 `BEST_BANDS`、`weekly_active_days`、`weekday_counts`、`shift_to_year`、路由注册测试；新增对纯函数的测试——把“补零月份”“逐年补空年与 delta 计算”“pace_gain 计算”写成可单测的纯函数（例如 `fill_months(rows, today)`、`build_year_rows(rows, today, same_period_previous)`、`pace_gain(best, first)`），先写失败测试再实现。
- [ ] **Step 2: 改写集成测试**（`tests/integration/test_records.py`，保留 `OWNER_RUNS` 里的 2024/2023 数据并按需增加 2025 与当前年的数据；时钟用 `app.state.clock = lambda: datetime(...)` 固定）：断言排序/并列/资格数仍成立；`first` 为该档最早日期；`pace_gain` 数值；`monthly` 从首月连续到当前月且中间补零；`yearly` 升序、`delta` 与 `delta_basis`（含当前年同期）；`weekday` 为全部历史；空用户 `[]`；owner 隔离；展示端与本人端一致、拒绝 owner 参数；422 用例随参数删除而移除；`test_admin_users.py` 的具名展示 200/404 断言保留。
- [ ] **Step 3: 实现**（schema → records → routers），逐步让测试变绿。
- [ ] **Step 4: 运行**：`.venv/bin/pytest tests/unit -q`；集成（独立 `_test` 库，进程环境注入）`test_records.py test_statistics.py test_showcase.py test_admin_users.py`；`ruff check` 与 `ruff format --check`（`app migrations tests`）；`alembic heads` 仍为单 head。测试库不可用时如实报告“集成未运行”。

---

### Task 2: 前端接口层与合成 API

**Files:** `frontend/src/lib/api/records.ts`、`frontend/tests/fixtures/ui-api.mjs`、`frontend/tests/unit/records.test.ts`、`frontend/tests/ui/records.spec.ts`（仅让它先能跑，Task 4 再重写）。

**Interfaces — Consumes：** Task 1 的响应结构。**Produces：**

- 类型：`Records`、`CategoryBest`、`PersonalBest`、`FirstRun`、`Totals`、`MonthPoint`（`month_start: string`）、`WeekPoint`、`WeekdayPoint`、`YearRow`、`YearDelta`。
- `parseRecords(v: unknown): Records`；`readRecords(fetcher = fetch): Promise<Records>`（无年份参数，路径 `/api/v1/showcase/statistics/records`；`view.bind(readRecords, 0)` 即可，fetcher 为第 0 个参数）。
- 保留 `CATEGORY_NAMES`、`CATEGORY_RANGES`、`signedDistance`、`paceDelta`；新增 `monthLabel(month_start: string): string`（`2026-03-01` → `2026-03`）、`paceGainText(seconds: Metric): string`（`42` → `快 0:42 /km`，≤0 或 null → `''`）。

校验要点：`personal_bests` 恰为 `[5km, 10km]`，`first` 为 null 或合法；`monthly` 的 `month_start` 都是每月 1 日、严格按月连续递增、可空数组；`yearly` 年份严格 +1 递增、可空数组、非首行 `delta` 合法、`is_partial` 仅最后一行（当前年）可为 true；`weekly` 26、`weekday` 7（同现有）；`totals` 各字段类型/范围；delta 允许负数（沿用 `signed`）。

- [ ] **Step 1: 写失败的 Vitest**（`records.test.ts` 改写）：合法 payload 通过；各类畸形（月份不连续、年份跳年、`yearly` 里非末行 `is_partial`、`first` 字段缺失、`pace_gain` 非法、数组长度、负数里程等）抛“无效响应”；请求路径无查询参数；401 → status 401；`signedDistance`/`paceDelta`/`monthLabel`/`paceGainText` 的格式化；SEO 描述断言保持。
- [ ] **Step 2: 实现 `records.ts`**。
- [ ] **Step 3: 更新 `ui-api.mjs` 的 `recordsFixture()`** 为新结构（固定数据：5K 有最佳 + 首次，10K 最佳为 null；`monthly` 覆盖跨年的连续月份（例如 2025-01 到 2026-10，共 22 个月）；`yearly` 两行（2025 全年、2026 进行中，带 `previous_year_same_period`）；`weekly` 26；`weekday` 7）。提供一个能触发空状态的开关（例如 `?empty=1` 查询参数，仅合成 API 识别），以及保留供测试使用的 503/401 路由模拟。
- [ ] **Step 4: 运行** `pnpm exec vitest run tests/unit/records.test.ts` 与 `pnpm test`、`pnpm check`（此时页面/卡片组件尚引用旧类型会报错；本任务允许先把引用旧 API 的 `records/+page.svelte`、`RecordsSummaryCard.svelte`、`PersonalBests.svelte` 临时最小适配或留给后续任务，但 `pnpm check` 在 Task 4 结束时必须为 0 错误；请在报告里列出当前遗留的类型错误）。

---

### Task 3: 记录横幅与数据汇总（先做，截图给用户确认后再做 Task 4）

**设计原则（用户反馈）：** 同一区域卡片最多连放两层；每页一个“主角”（记录横幅，用柔和强调色底，与普通卡片拉开层次）；能不用卡片就不用；先讲人话再给数字。因此**不做 `MetricCard`**，只做一个 `RecordsBanner` 组件，数据汇总用紧凑版、`/records` 用放大版（Task 4）。

**Files:** `RecordsBanner.svelte`（新）、`GoalOverview.svelte`（不改）、`dashboard/+page.svelte`、删除 `RecordsSummaryCard.svelte`、新 UI 测试、`docs/design-system/components.md`（登记组件）、独立 showcase 示例。

**RecordsBanner**（props：`bests: CategoryBest[]`、`variant?: 'compact' | 'hero'`（默认 compact）、`href?: string`）：

- 根元素 `<section aria-label="个人记录">` 整行宽，底色 `--primary-soft`（或设计令牌里最接近的柔和强调色；先读 `tokens.md`），`--border` 描边，`--radius-card`，内边距与目标卡一致（`--space-4`，手机 1.15rem）；标题行 `个人记录`（图标 + `--text-section`，弱色）右侧“查看全部 →”链接（有 `href` 时）。
- 内部两个等宽区块（5K、10K），桌面左右并排、中间一条细分隔线，手机上下堆叠；两块高度一致。
- 每块结构：
  1. **号码布徽章**：圆形，内写文字“5K”/“10K”（`--text-small` 粗体），5K 用 `--sport-green` 底、10K 用 `--sport-blue` 底、文字用 `--sport-ink`（参照现有 `.feature-icon`/`.week-day.active` 的配色，先查这些令牌的深浅色定义）；无记录时徽章为描边空心灰圆。
  2. **主数字**：配速 `5:30`（`--text-title` 粗体等宽数字）+ 单位 `/km`（`--text-body` 弱色）。
  3. **人话一行**（`--text-small` 弱色）：`{M} 月 {D} 日，{x.x} km，用了 {用时}`（用时用 `formatDuration`，日期用本地日期字符串解析，不做时区转换）。
  4. **进步线**（仅当 `first` 与 `pace_gain_seconds_per_km` 都有）：一条细横线，左端空心点标“首次 {pace}”，右端实心点标“最佳 {pace}”，两点之间线段用 `--primary` 加粗；两点间距按 `pace_gain / first.pace` 的比例映射到 20%–100% 的线长（clamp，纯表现，不产生新指标）；下方一句“比第一次快了 {mm:ss}”（`paceGainText` 的人话版，如“比第一次快了 42 秒 / km”）。进步线用 `role="img"` + 中文 `aria-label`（如“首次配速 6:12，最佳配速 5:30，快了 42 秒每公里”）。
  5. 无记录：主数字位置显示“还没有 5K 记录”，下方“跑一次 4.0–7.5 km（10K：9.0–12.0 km）的整次跑步，就会出现在这里”（`CATEGORY_RANGES`）。
- 暗色与亮色都要保证文字对比度；不硬编码色值；字号只用 `--text-*` 令牌。
- testid：`records-banner`、`records-banner-5km`、`records-banner-10km`、`records-banner-gain-5km`（进步线）。

**RecordsBanner 的数据装载**放在一个很薄的包装组件 `RecordsBannerLoader.svelte`（dashboard 用）：`onMount` 调 `readRecords()`（`disposed` + 令牌；401 → `/admin?reason=expired&next=%2Fdashboard`）；加载中显示与横幅同高的占位（`FeedbackState kind="loading"`，防止布局跳动）；失败时横幅位置显示一张错误提示（`FeedbackState kind="error"` + 重试），其余 dashboard 内容不受影响。

**dashboard**：`.milestone-section`（目标卡 + 地图）之后、`ActivityExplorer` 之前放 `<RecordsBannerLoader />`（`href` 经 `view.href('/records')`）；删除 `RecordsSummaryCard` 的 import 与挂载；`goal-explanation` 文案不变。**同时移除“功能入口”卡片区**（见下）。

**移除数据汇总里的“功能入口”卡片区**：见 brief 末尾“Task 3 补充”。

- [ ] **Step 1: 写 UI 测试**（合成 API）：`/` 上 `records-banner` 出现在里程碑区之后、整行宽；两块等高等宽（±1px）；5K 块含 `5:30`、进步线与“比第一次快了”文案、含指向 `/records` 的链接；10K 块为空状态文案；手机 390px 上下堆叠且无横向滚动；记录接口 503 时横幅位置显示错误提示 + 重试，其余卡片正常；dashboard 上没有名为“功能入口”的 navigation；`dashboard.spec.ts:70` 与 `ui-shell.spec.ts:399/418` 改为断言“主要导航”。
- [ ] **Step 2: 实现并让测试通过**；Playwright 截图（浅/深色 × 1440/390，以及 5K 有记录 + 10K 空；两者都有；两者都空三种数据）到 `/private/tmp/claude-501/-Users-tingchieh-cs-learning-run-note/daf81e23-a986-4230-a393-31ab7641a774/scratchpad/shots/`，逐张查看，自行迭代到“整齐、有层次、不像报表”，并在报告里描述每张图的观察。
- [ ] **Step 3: 设计规范与 showcase**：`components.md` 登记 `RecordsBanner`（props、两种 variant、外观契约与空状态）；独立 showcase 增加示例（有记录 / 无记录 / 仅 5K / 手机宽度）；`pnpm showcase` 能启动。
- [ ] **Step 4: 运行** `pnpm check`（此时 `/records` 页面仍是 v1，会有遗留类型错误，列出即可）、`pnpm test`、新 spec、`dashboard.spec.ts`、`ui-shell.spec.ts`。

---

### Task 4: `/records` 页面重做（Task 3 的横幅被用户确认后再执行）

**Files:** `routes/records/+page.svelte`、`RecordsBanner.svelte`（hero 变体）、`RecordsChart.svelte` / `records-chart.ts`（减负）、新小组件（逐年排行、训练规律）、`tests/ui/records.spec.ts`、`tests/unit/records-chart.test.ts`。

**页面结构（每页一个主角，卡片不连放超过 3 层，能不用卡片就不用）：**

1. **横幅（hero）**：`RecordsBanner variant="hero"`——比 compact 更大：徽章更大、主数字更大、进步线更长更醒目。
2. **累计数字行（无边框、非卡片）**：一行三个大数字，细竖线分隔：累计里程 / 共 N 次 / 活动 M 天（`totals`），下面一句人话总结（今年已跑 Y km，比去年同期多/少 Z km，取自 `yearly` 当前年行及其 `delta`；无上一年则省略；无活动用鼓励文案并显示 `records-empty`）。testid `records-summary`、`records-totals`。
3. **月度**（一张图，用现有分段控件“里程 | 配速”切换，容器 `<div class="settings-tabs" role="group" aria-label="月度指标">` 子项 `type="button"` + `aria-pressed`，见 components.md）：x 轴 `monthLabel`；柱状（里程）/ 折线（配速，缺失为空隙）；**去掉网格线与纵轴刻度，只留悬浮提示**；柱子圆角，最大值那个月用强调色、其余柔和同色（颜色来自令牌）。图下 `<details>` 数据表（含两个指标）。
4. **逐年回顾（排行列表）与训练规律并排**（桌面两列，手机上下）：
   - 逐年回顾：每年一行：年份 | 横条（长度 = 该年里程 / 最大年里程，色块用令牌）| 里程 | 涨跌标签（`↗ +12%` 不要自己算百分比：用 `delta.distance_m` 展示“+X km”，进行中的年份显示“进行中”标签与“较去年同期 ±X km”，条形用斜纹/淡色表示“未跑完”）。最近年在前。`<details>` 数据表。
   - 训练规律：最近 26 周圆点一排（按 `active_days` 0 / 1–2 / 3–4 / 5+ 四档用令牌配色）+ 周内分布 7 根小柱（CSS）；每个点/柱有 `title` 与中文 `aria-label`；`<details>` 数据表。
5. 保留 `disposed` + 令牌 + 401 跳转（`next` 用 `encodeURIComponent(window.location.pathname)`）；错误态 `records-error` + 重试；加载 `PageSkeleton`；无年份表单、无对比图。
6. testid：`records-ready`、`records-empty`、`records-error`、`records-summary`、`records-totals`、`records-banner*`、`records-chart-monthly` 及 `-table`、`records-years`（列表）与 `records-year-<year>`、`records-rhythm`。

- [ ] **Step 1: 写失败的 UI 测试**（`records.spec.ts` 改写）：横幅（hero）、累计数字行与总结句、月度图（`data-ready=true`、分段控件切换里程/配速并更新数据表列、数据表行数 22）、逐年列表（2 行；2026 行有“进行中”与“较去年同期”）、训练规律（26 圆点 + 7 柱）、空状态、503 重试、401 跳转、手机无横向滚动、导航入口名称为“个人记录”。更新 `records-chart.test.ts`（删除 `nullAfterCutoff` 用例；新增“柱子最大值着色”等纯函数用例）。
- [ ] **Step 2: 实现并让测试通过**；截图（浅/深色 × 1440/390，含空数据与有数据）到 scratchpad，逐张查看并迭代，报告里描述观察。
- [ ] **Step 3: 运行** `pnpm check`（0 错误）、`pnpm test`、`pnpm build`、`records.spec.ts`、`dashboard.spec.ts`、`ui-shell.spec.ts`、完整 `playwright.ui.config.ts`（如实记录偶发项，单独重跑核对）。

---

### Task 5: 文档与全量验证

- [ ] **Step 1:** 更新 `docs/75-personal-records.md`：使用方式（总览、数据汇总里的两张卡、`/records` 结构、最佳成绩与“比首次”口径、逐年与同期规则）、接口与隐私（新响应结构、不再有年份参数）、验证记录（只写本次实际运行的命令与结果；未运行项单列并说明原因）。在文档开头注明本次对 #37 的改版。
- [ ] **Step 2:** 全量验证并记录真实数字：后端单元、后端集成（独立 `_test` 库全量）、Ruff 检查与格式检查、`alembic heads`；前端 `pnpm test`、`pnpm check`、`pnpm build`；`playwright.ui.config.ts` 完整运行；`playwright.showcase.config.ts`、`playwright.admin-users.config.ts`（dev 与 build）；`git diff --check`。
- [ ] **Step 3:** 自查本计划与 spec 的覆盖（每条 spec 要求能指向实现与测试），在报告列出缺口。

---

## Self-Review

- 覆盖：去年份（Task 1/2/4）、月度时间线（Task 1）、逐年汇总与同期（Task 1/4）、首次对比（Task 1/3/4）、数据汇总等大卡片（Task 3）、`/records` 去数据化（Task 4）、通用组件 + 设计规范 + showcase（Task 3）、文档（Task 5）。
- 类型一致：`CategoryBest.first/pace_gain_seconds_per_km`、`YearRow.delta/delta_basis`、`MonthPoint.month_start`、`Totals.first_activity_date` 在后端 schema、前端 `records.ts`、合成 API、测试中保持同名。
