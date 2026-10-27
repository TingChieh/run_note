# 个人记录改为“总览”：去掉年份、进入数据汇总、统一卡片

## 背景与目标

线上的“个人记录”（docs/75）有三个问题：

1. 要选年份和对比年份，用户想看的其实是“总的来看”。
2. 数据汇总（dashboard）里看不到个人记录：摘要卡被追加在页面最底部，且尺寸、字号与上方的目标卡不一致。
3. `/records` 太“数据化”：一屏全是图表和表格。

目标：个人记录改为全部历史的总览；5K / 10K 最佳成绩与累计总览以一条整行横幅出现在数据汇总里；`/records` 用同一套扁平卡片语言，少表格、多结论，并加入“比首次更快”的进步对比。

## 已确认的决定

- 去掉 `year` / `compare_year`、年份输入框、两年叠加曲线、截止日规则。
- 月度里程与配速：从**第一次跑步的月份到当前月**的连续月度时间线（无记录的月份补 0 / 空值）。
- 周内分布改为全部历史；最近 26 周训练天数保留。
- “历史对比”改为**逐年汇总**：每年一行/一张卡（里程、次数、活动天数、平均配速、相对上一年的涨跌）。进行中的当前年份标“进行中”，涨跌与“去年同期”比较，不拿残年去比整年。
- 5K / 10K 最佳成绩口径不变（全部历史、整次活动、按配速、4.0–7.5 km / 9.0–12.0 km）；新增**首次**记录与“较首次快多少”。
- 新增 `RecordsBanner`（整行横幅），dashboard 与 `/records` 共用；同步更新设计规范与独立 showcase。
- 无数据库变更、无迁移。接口结构变更：线上前端是唯一使用方，前后端同一个 PR 发布。

## 后端

`GET /api/v1/statistics/records`、`GET /api/v1/showcase/statistics/records`（及具名版本）不再接收 `year`/`compare_year`（多余的查询参数被忽略，展示端 `reject_owner_override` 不变）。`build_records(db, owner, today)`。

```text
Records
  personal_bests: [CategoryBest]        # 固定 [5km, 10km]
  totals: Totals                        # 全部历史：activity_count, distance_m, activity_days,
                                        #   avg_pace_seconds_per_km|null, first_activity_date|null
  monthly: [MonthPoint]                 # month_start(YYYY-MM-01), activity_count, distance_m, avg_pace|null
                                        #   从首次活动所在月到当前月（含），连续；无活动时为 []
  weekly: [WeekPoint]                   # 最近 26 周，同现有
  weekday: [WeekdayPoint]               # 7 项，全部历史
  yearly: [YearRow]                     # 从首次活动年到当前年，年份升序；无活动时为 []
  date_assignment: "activity_local_date"
CategoryBest
  category: "5km"|"10km"
  best: PersonalBest|null               # 同现有（含 qualifying_count）
  first: FirstRun|null                  # 该档最早一次可靠跑步：activity_id, activity_date,
                                        #   distance_m, duration_seconds, avg_pace_seconds_per_km
  pace_gain_seconds_per_km: Decimal|null  # first 配速 − best 配速；best 与 first 是同一次活动或缺失时为 null
YearRow
  year, activity_count, distance_m, activity_days, avg_pace_seconds_per_km|null
  is_partial: bool                      # year == 当前年
  delta: YearDelta|null                 # 首年为 null
  delta_basis: "previous_year"|"previous_year_same_period"|null
YearDelta: activity_count(int, 可负), distance_m(Decimal, 可负), avg_pace_seconds_per_km(Decimal|null, 可负，负=更快)
```

- `delta_basis`：非当前年用上一年全年；当前年用上一年截至“今天同月日”（2 月 29 日 → 28 日）的同期汇总。
- 月度序列用按月分组的 SQL（复用 `service.expressions()` / `finalize()`），不受 `validate_range` 的 5 年上限影响；缺失月份在 Python 里补零。
- 隐私边界不变：只含汇总数字、日期与活动 ID。

## 前端

### 设计原则（用户反馈后调整）

同一区域卡片最多连放两层；每页一个“主角”；能不用卡片就不用；先讲人话再给数字。因此不做通用 `MetricCard` 与等大卡片网格，改为一条整行的 **`RecordsBanner`**（扁平卡片内三列、发丝线分隔；`compact` 用于数据汇总，`hero` 用于 `/records`）。

### RecordsBanner

三列（5K、10K、累计总览），其中 5K / 10K 每列：号码布徽章（圆形，写“5K”/“10K”，绿/蓝运动色；无记录时描边空心）→ 配速大数字 → 人话一行（“3 月 5 日，5.0 km，用了 27:30”）→ 进步线（首次配速与最佳配速两点，线段长度按进步幅度映射，纯表现）与一句“比第一次快了 42 秒/km”。无记录时显示邀请文案（“跑一次 4.0–7.5 km 的整次跑步，就会出现在这里”）。样式只用设计令牌，字号用 `--text-*`，与目标卡的圆角/内边距一致。

### 数据汇总

保持里程碑区（目标卡 + 足迹地图）不变；在其后、活动浏览之前放一条 `RecordsBanner`（compact，“查看全部”链接到 `/records`）。移除原先的 `RecordsSummaryCard`，并移除与侧栏/手机菜单重复的“功能入口”卡片区。

### `/records` 页面

1. 顶部 `RecordsBanner`（hero）。
2. 一句人话总结（无边框纯文字；累计数字已在横幅的第三列）。
3. 月度：一张图，“里程 | 配速”分段切换；去网格线与纵轴刻度，柱子圆角，最大月份强调色。
4. 逐年回顾（带横条的排行列表，进行中的年份标注并与“去年同期”比较）与训练规律（最近 26 周圆点 + 周内 7 根小柱）并排。
5. 每块下方保留 `<details>` 完整数据表（缺失值 `—` + `sr-only` 说明）。

页面卡片层数不超过 3 层，其间夹无边框的总结句。视觉统一为扁平卡片（与数据汇总同一语言，见 docs/design-system/patterns.md “概览条”）。

### 其它

- `frontend/tests/fixtures/ui-api.mjs` 同步新结构；`records.spec.ts`、`dashboard.spec.ts` 等 UI 用例更新；新增数据汇总横幅三列等宽等高的断言。
- 文档：更新 `docs/75-personal-records.md`（使用方式 / 接口与隐私 / 验证记录），设计规范 `docs/design-system/components.md` 记录 `RecordsBanner`，独立 showcase 增加示例。

## 错误处理与边界

- 无任何活动：`monthly`、`yearly` 为空数组，卡片显示空状态，页面显示鼓励文案，不报错。
- 首次与最佳是同一次活动（只跑过一次）：`pace_gain_seconds_per_km` 为 `null`，不显示对比行。
- 配速缺失显示 `—`；前端对 `monthly` 连续性与 `yearly` 升序做校验，失败抛 `ActivityError`。
- 卡片读取失败只降级该区域，数据汇总其它内容保持可用。

## 测试

后端单元（月度补零、逐年与同期汇总、首次与配速提升、空数据）、后端集成（独立 `_test` 库：排序、首次、月度连续、逐年、隔离、展示端）、前端 Vitest（解析、格式化）、Playwright UI（合成 API：数据汇总横幅三列等宽等高、`/records` 渲染与空状态、手机宽度无横向滚动、深浅色截图人工核对）。

## 不在范围内

年份选择、任意区间对比、轨迹滑窗最佳成绩、半马/全马记录、数据库变更。
