# 个人记录与趋势分析设计

## 背景与目标

仪表盘已有年度汇总、运动日历和周/月趋势（距离、次数、耗时、配速），但没有回答这些问题：5K / 10K 最快跑过多少、配速这一年有没有进步、训练是否规律、今年和去年同期相比如何。

目标：新增“个人记录”能力，覆盖 5K / 10K 最佳成绩、月度里程、配速进步趋势、训练频率、同期年度对比；在 `/dashboard` 追加一张摘要卡，完整内容放在新页面 `/records`。

## 已确认的决定

- **最佳成绩口径：整次活动。** 只统计距离落在 5km / 10km 档位的整次跑步，不做轨迹滑窗（“长跑途中最快 10K”不计入，留作以后单独立 spec）。不需要读 `activity_points`。
- **页面位置：** 新页面 `/records`，同时提供 `/workspace/records` 与 `/p/[username]/records`；`/dashboard` 只在末尾追加一张摘要卡，既有内容不动。
- **历史对比口径：** 同期年度对比（`year` 对比 `compare_year`，默认去年）。
- **接口：** 一个聚合接口，指标全部在服务端 SQL 中计算；前端不计算权威运动指标。
- 无数据库变更，无迁移，无新模块；扩展现有 `statistics` 模块。

## 后端

### 新文件 `backend/app/modules/statistics/records.py`

复用 `service.py` 的 `expressions()`（`eligible` 判定）、`query()` / `finalize()` / `trends()`，不重复实现配速规则。

**5K / 10K 最佳**

- 档位取 `activities/classify.py` 的 `DISTANCE_BANDS` 中的 `5km`（4000–7500 m）与 `10km`（9000–12000 m），边界规则与 `classify_distance` 一致（5km 档含 4000 m）。
- 只统计满足 `eligible`（距离 > 0、用时 > 0、有计时器或时间质量为 complete/manual）的活动。
- 按平均配速（用时 ÷ 距离）升序取第一名，并列取日期较早者，再按 `id` 保证确定性。不按总用时排序，否则 4 km 短跑会胜过 5 km。
- 统计**全部历史**，不受 `year` 限制。不做距离外推，返回实际距离、用时、配速、日期、活动 ID，以及该档位符合条件的总次数 `qualifying_count`。无记录时该档为 `null`。

**月度里程与配速趋势**

- 选定 `year` 的 12 个月，直接使用 `trends(period="month")` 的桶：`activity_count`、`distance_m`、`avg_pace_seconds_per_km`。
- 没有可靠配速的月份为 `null`，不插值。配速是所有可靠跑步的月平均，不区分距离。

**训练频率**

- `weekly`：最近 26 周（周一起算，含本周）每周的训练天数 `activity_days`，缺失周补 0。
- `weekday`：选定年内周一至周日各自的活动次数。
- 日期按活动本地日期（`activity_date`），与现有统计一致。

**同期年度对比**

- `year` 为站主时区的当前年时，两边都截止到今天的月日（2 月 29 日按 2 月 28 日处理）；`year` 为过去的年份时，两边都取全年。
- 返回 `cutoff_date`（`year` 的截止日）与 `compare_cutoff_date`（平移到 `compare_year` 后的日期），并返回两个年份各自的 12 个月序列，以及截止日内的累计里程、次数、可靠平均配速和差值（`year` 减 `compare_year`）。任一侧配速缺失时配速差值为 `null`。
- 对比年份是当前年而所选年份不是（例如 `year=2025&compare_year=2026`）时，两边使用同一个日历日：`compare_cutoff_date` 为今天，`cutoff_date` 为今天平移到 `year`（2 月 29 日在非闰年按 2 月 28 日）；不拿过去的整年去比当前年的未完成部分。纯函数 `resolve_cutoffs(today, year, compare_year)` 负责推导两个截止日。
- `compare_monthly` 是“同期”序列：以 `compare_cutoff_date` 为界查询（截止月只含截止日及之前的活动），之后的月份补 0 值（次数 0、里程 0、配速 `null`），长度仍恒为 12。过去年份的截止日是 12 月 31 日，行为不变。`monthly`（所选年份）仍为完整日历年的 12 个月。
- “当前日”使用 `request.app.state.clock()` 转站主时区，不直接调用 `datetime.now()`。

### Schema 与响应

`schema.py` 新增 `Records` 及其子模型（`PersonalBest`、`MonthPoint`、`WeekPoint`、`WeekdayPoint`、`YearComparison`）。响应沿用 `ApiResponse[Records]` 信封。

```text
Records
  year, compare_year, cutoff_date, compare_cutoff_date, date_assignment
  personal_bests: [{ category: "5km", best }, { category: "10km", best }]   # 有序列表，best 可为 null
  monthly: [MonthPoint]                # 12 项
  compare_monthly: [MonthPoint]        # compare_year 的 12 个月，用于叠加曲线
  weekly: [WeekPoint]                  # 26 项，week_start / active_days
  weekday: [WeekdayPoint]              # 7 项，周一为 0
  comparison: { current: YearTotals, previous: YearTotals, delta: ComparisonDelta }
PersonalBest
  activity_id, activity_date, distance_m, duration_seconds,
  avg_pace_seconds_per_km, qualifying_count
```

### 路由

| 路径 | 说明 |
| --- | --- |
| `GET /api/v1/statistics/records` | 本人视图（`statistics/router.py`，沿用该文件的鉴权依赖） |
| `GET /api/v1/showcase/statistics/records` | 站主展示（根） |
| `GET /api/v1/showcase/users/{username}/statistics/records` | 具名展示 |

查询参数：`year`、`compare_year`，均 `ge=1900, le=2100`；`compare_year` 缺省为 `year - 1`；二者不得相同（422 `VALIDATION_ERROR`）。`year` 缺省为站主时区当前年。

展示端沿用 `reject_owner_override` 与 `Owner` 依赖，subject 由服务端确定，不接受客户端 owner。本人视图与展示视图的返回字段相同，均为汇总数字与活动 ID，不含轨迹、坐标、备注、文件名、邮箱，与已开放的 `showcase/activities/{id}` 的公开范围一致。

## 前端

- `frontend/src/lib/api/records.ts`：`readRecords(year, compareYear?)`，运行时逐字段校验（类型、范围、12 / 26 / 7 的长度、`year` 与 `compare_year` 回显一致），失败抛 `ActivityError`，401 映射“登录已过期”。
- `view-context.ts`：`contextPath` 的路径正则加入 `records`；`contextAPI` 无需改，因为 workspace 映射到 `/api/v1/statistics/records`。
- `routes/+layout.svelte`：`appLayout` 正则加入 `records`，使 `/records` 获得应用外壳（实现时发现的必要改动）。
- 路由：`routes/records/+page.svelte`（站主根）、`routes/workspace/records/+page.svelte`、`routes/p/[username]/records/+page.svelte`，按 `dashboard` 三份入口现有的复用方式组织，数据在 `onMount` 加载，保留 `disposed` 标志与单调请求令牌。
- 组件（`lib/components/`）：
  - `PersonalBests.svelte`：5K / 10K 纪录卡，空状态“还没有 5K 记录”，点击跳到对应活动详情。
  - `RecordsChart.svelte`（配 `records-chart.ts` 图表规格与 `records-chart-runtime.ts` 动态加载 echarts）：月度里程、配速趋势、每周训练天数、周内分布、年度叠加曲线；`watchSystemTheme` 订阅外观，每张图下有 `<details>` 数据表，缺失值渲染 `—` 并附 `sr-only` 说明。同期对比图把各序列截止月份之后的月份置空（截止月本身完整显示），数据表中对应单元格显示 `—`。
  - `RecordsSummaryCard.svelte`：dashboard 摘要卡，显示 5K / 10K 最佳、本月里程、同期里程涨跌，卡片头部的“查看全部”链接按钮跳到 `/records`（避免整卡嵌套链接）。
- 导航：`AppNavigation.svelte` 在“数据汇总”之后加“个人记录”入口。
- dashboard：只在 `dashboard/+page.svelte` 末尾追加摘要卡，不动已有未提交内容。
- 样式：语义令牌，复用现有卡片类与液态玻璃实现；不新增通用组件规范条目时无需改 `docs/design-system`，如摘要卡被判定为通用组件再同步。

## 错误处理与边界

- 无任何活动：全部数组长度不变，数值为 0 / `null`，页面显示空状态而不是报错。
- 两年相同、年份越界：422 `VALIDATION_ERROR`，中文提示。
- 配速缺失显示 `—`，不用 0 或平均值填充。
- 底图、外部服务不涉及；图表加载失败时数据表仍可读。

## 测试

- 后端单元（无 DB）：档位边界与排序规则（4000 m 归 5km、并列处理、短跑不胜出）、同期截止日（闰日、过去年份取全年）、`year == compare_year` 拒绝、空数据形状。
- 后端集成（需独立 `_test` 库，仅进程环境注入，不改 `.env`）：owner 隔离、展示端不接受 owner 参数、纪录与现有 `summary` 数字一致。库不可用时明确说明“未运行”。
- 前端 Vitest：`records.ts` 解析的合法 / 非法响应、`contextPath` 新路径。
- Playwright UI（合成 API）：在 `tests/fixtures/ui-api.mjs` 补 `/statistics/records` 与 showcase 路径；覆盖 `/records` 渲染、空状态、dashboard 摘要卡跳转、明暗主题与手机宽度。
- 提交前：`pnpm check`、相关 Playwright 配置、Ruff 检查与格式检查，如实报告运行与未运行项。

## 文档

实现完成后追加 `docs/NN-personal-records.md`（编号按当时 `ls docs/` 的最大编号 + 1），包含“使用方式 / 接口与隐私 / 验证记录”。

## 不在范围内

轨迹滑窗最佳成绩；按距离档位单独的配速趋势；半马 / 全马纪录；数据库变更与缓存表；任意区间对比。
