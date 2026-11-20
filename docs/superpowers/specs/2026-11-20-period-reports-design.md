# 月度与年度跑步报告设计（Issue #103）

日期：2026-11-20

## 背景与目标

当前「个人记录」页（`/records`、`/workspace/records`、`/p/{username}/records`，见 `docs/75-personal-records.md`）已提供全部历史最佳成绩横幅、连续月度柱/折线图、逐年回顾与训练规律，但缺少**单一选定自然月或自然年的报告详情**：

- 现有 `/statistics/records` 的 `MonthPoint` 与 `YearRow` 不包含 `duration_sum_seconds`（总用时），也无法按任意自然月/自然年查看完整指标与缺失值覆盖情况。
- 现有 `docs/75` 第 29 行记录了一项已知遗留：`records` 的逐年回顾中当前年行汇总包含未来日期活动，而同期对比截止至当天。

目标：在现有「个人记录」页内，沿用既有扁平卡片、设计令牌与交互控件，补足可切换自然月与自然年的跑步报告区块，呈现**跑步次数、总里程、总用时、平均配速**四项首要指标，并在服务端以明确半开区间和当前周期截止边界保证口径一致。

## 变更边界与约束

- **无数据库变更、无迁移**。
- **不改动现有接口的既有行为**：`/statistics/summary`、`/statistics/records`、`/statistics/calendar`、`/statistics/trends`、`/statistics/streaks` 保持原结构与原测试契约不变；`docs/75` 中 `records` 全部历史时间线的已知行为不动，仅在新增的周期报告接口与界面中严格执行当前周期截止边界。
- **统计口径唯一事实源**：复用 `backend/app/modules/statistics/service.py` 的 `expressions()`、`finalize()`、`summary()`：
  - 日期归属：`activity_date`（活动本地日期，`date_assignment = "activity_local_date"`）。
  - 计时优先：`COALESCE(timer_seconds, elapsed_seconds)`。
  - 配速资格：`distance_m > 0 AND duration > 0 AND (timer_seconds IS NOT NULL OR temporal_quality IN ('complete', 'manual'))`。
  - 平均配速：距离加权 `(sum(eligible_duration) * 1000 / sum(pace_eligible_distance_m))`，`ROUND_HALF_EVEN` 量化到 `0.001` 秒/公里；无有效记录为 `null`。
  - 总用时：`known_duration_count == 0` 时为 `null`，否则为已知用时之和。
- **权限与隐私不变**：
  - 本次仅面向**已登录用户查看本人记录**开放（遵循 Issue #103 授权范围与 `AGENTS.md` 公开接口白名单约定），不新增匿名或具名展示的周期报告接口：
    - 后端仅注册本人只读端点 `GET /api/v1/statistics/report`（需认证 `get_read_identity`，仅查本人，未登录返回 401）。
    - `/api/v1/showcase/statistics/report` 与 `/api/v1/showcase/users/{username}/statistics/report` 不存在（返回 404）。
    - 前端在 `records/+page.svelte` 中通过 `viewsOwnRecords(page.url.pathname, page.data.user)` 门控（仅本人工作区 `/workspace/records`、站主登录看 `/records`、本人登录看 `/p/{username}/records` 渲染 `PeriodReportCard` 并直连 `/api/v1/statistics/report`）；匿名访问或登录非本人展示页时保持原有公开「个人记录」布局与文案不变。
  - 响应仅包含聚合指标与日期范围，不含标题、备注、文件名、坐标、邮箱或身心健康字段。

## 后端接口设计

### 路由与参数

- `GET /api/v1/statistics/report`（仅已登录本人，未登录返回 401）

查询参数：
- `period`: `"month" | "year"`（必填）
- `year`: `int`（必填，`1900 <= year <= 2100`）
- `month`: `int | None = None`（`1 <= month <= 12`；`period == "month"` 时必填，否则 422；`period == "year"` 时传入则 422）

### 半开区间与当前周期截止规则

以所属用户时区下的服务端时钟日期 `today = request.app.state.clock().astimezone(ZoneInfo(owner.timezone)).date()` 为准：

1. 自然周期半开区间 `[period_start, period_end)`：
   - 月度：`[YYYY-MM-01, 次月 1 日)`（12 月为 `[YYYY-12-01, (YYYY+1)-01-01)`；闰年 2 月为 `[YYYY-02-01, YYYY-03-01)`，包含 2 月 29 日）。
   - 年度：`[YYYY-01-01, (YYYY+1)-01-01)`。
2. 周期状态与有效查询区间 `[date_from, date_to)`：
   - **已结束的历史周期**（`period_end <= today`）：`is_partial = False`，`cutoff_date = None`，`[date_from, date_to) = [period_start, period_end)`，调用 `service.summary(db, owner, date_from, date_to)`。
   - **进行中的当前周期**（`period_start <= today < period_end`）：`is_partial = True`，`cutoff_date = today`，`[date_from, date_to) = [period_start, min(period_end, today + 1 day))`，调用 `service.summary(db, owner, date_from, date_to)`，排除晚于 `today` 的未来日期活动。
   - **尚未开始的未来周期**（`period_start > today`）：`is_partial = False`，`cutoff_date = None`，`date_from = date_to = period_start`，返回 `service.finalize({})`（0 次、0 米、用时与配速为 `null`），不泄露未来日期活动。

### 响应结构

`PeriodReport(Summary)`（继承 `Summary` 全部字段，确保零口径漂移）：

```text
PeriodReport(Summary)
  period: "month" | "year"
  year: int
  month: int | null
  date_from: date
  date_to: date
  is_partial: bool
  cutoff_date: date | null
  today: date
  # 以下继承自 Summary：
  activity_count, distance_m, activity_days, duration_sum_seconds,
  known_duration_count, missing_duration_count, pace_eligible_count,
  pace_eligible_distance_m, avg_pace_seconds_per_km, quality_warning_count,
  date_assignment ("activity_local_date")
```

## 前端设计

- **位置**：位于「个人记录」页（`frontend/src/routes/records/+page.svelte`）顶部 `RecordsBanner` + 一句话总结下方、月度柱状图上方；即便账号尚无任何活动也保持可用，便于查看空周期状态。
- **组件与视觉复用**（遵守 `docs/design-system/`）：
  - 独立业务组件 `PeriodReportCard.svelte`，外观为 `.records-card` 扁平表面卡（`--surface`、`--border`、`--radius-card`）。
  - 标题行右侧采用 `.settings-tabs` 玻璃分段按钮切换「月度 / 年度」（`role="group"`、`aria-pressed`）。
  - 工具栏复用 `DatePicker granularity="month"` 选月、原生年份下拉 + 上下步进按钮选年，以及非当前周期时的「回到本月 / 回到今年」快捷按钮。
  - 四项首要指标（跑步次数、总里程、总用时、平均配速）采用与数据汇总 `.annual-metrics` / `RecordsBanner` 一致的发丝线分隔横条 + 圆形运动色图标（`--sport-blue` / `--sport-green` / `--sport-yellow-accent` / `--sport-coral`），缺失值显示 `—` 并附 `.sr-only` 说明。
  - 响应式容器查询：宽屏 4 列、平板 2×2、手机 1 列堆叠，不出现横向溢出。
  - 状态完整区分：初次加载（`FeedbackState kind="loading"`，显示所请求周期）、保留旧数据刷新（显示已加载报告的周期标题、日期范围、`aria-label` 与指标并降不透明度，同时以 `role="status"` 状态标签明确提示「正在读取 `<目标周期>`…」避免标题与数据错配）、空周期（`FeedbackState kind="empty"`）、错误与重试（`FeedbackState kind="error"`，清除旧数据且不影响页面其余区块）、401 清理私人状态并跳转 `/admin?reason=expired&next=...`、乱序响应丢弃过期令牌。
- **API 契约层**：新增 `frontend/src/lib/api/period-report.ts`，通过 `parsePeriodReport` 做严格运行时校验，并同步重新生成 `frontend/src/lib/api/generated/api.ts`、补充 `frontend/tests/contract/api-types.ts` 与 `frontend/tests/fixtures/ui-api.mjs`。

## 验证计划

1. 后端单元测试：周期边界（跨月、跨年、闰年 2 月、平年 2 月、当前周期截止日、月末/年末当天、未来周期、1900/2100 边界、参数 422 校验、路由注册与架构约束）。
2. 后端集成测试（独立 PostGIS `_test` 库）：复用 `test_statistics.py` 2024 样本验证 1 月（3 次 / 6 km / 1500 秒 / 375 秒每公里）与全年（4 次 / 6 km / 1500 秒 / 375 秒每公里），覆盖跨月、跨年、闰日、空周期、缺失计时、零距离、设备计时优先、当前周期未来数据截止、跨账号隔离与展示端白名单。
3. 前端单元测试（Vitest）：`parsePeriodReport` 校验与范围格式化、`api-contract.test.ts`、`architecture.test.ts`。
4. 前端浏览器 UI 测试（Playwright 合成 API）与真实后端 E2E 测试：周期切换、加载/空/错误/重试/401 状态、三档视口（1440×900、768×1024、390×844）、明暗主题、控制台零错误与无横向溢出，保留前后截图证据。
