# 75 个人记录

日期：2026-10-26。设计与计划见 `docs/superpowers/specs/2026-10-26-personal-records-design.md` 与 `docs/superpowers/plans/2026-10-26-personal-records.md`。

## 使用方式

- 入口：根展示 `/records`（匿名可访问）、本人工作区 `/workspace/records`、具名展示 `/p/{username}/records`。导航在“数据汇总”之后新增“个人记录”。`/records` 需要应用外壳，所以 `frontend/src/routes/+layout.svelte` 的 `appLayout` 正则加入了 `records`。
- 页面区块：
  - **5K / 10K 最佳成绩**：两张卡，显示配速、用时、距离、日期，以及该档位符合条件的跑步次数；“查看这次跑步”跳到对应活动详情。没有符合条件的记录时显示“还没有符合条件的 5K / 10K 记录”。
  - **月度里程**与**配速趋势**：所选年份 12 个月。没有可靠配速的月份显示断点，不插值。
  - **每周训练天数**：最近 26 周（周一起算，含本周），缺失周补 0。
  - **周内分布**：所选年份内周一至周日各自的活动次数。
  - **同期对比**：所选年份与对比年份的累计里程、活动次数、平均配速及差值，附月里程叠加折线图。每张图下方都有 `<details>` 完整数据表，缺失值显示“—”并附 `sr-only` 说明。
- 年份与对比年份输入：两个 4 位数字输入框，范围 1900–2100，两者不能相同；默认年份为站主时区的当前年，对比年份默认为前一年。输入不合法时在表单下方提示，不发请求。
- dashboard 摘要卡：`/dashboard` 末尾追加一张卡，显示 5K / 10K 最佳配速、本月里程和较对比年同期的里程差；卡片头部的“查看全部”链接按钮跳到 `/records`（不用整卡链接，避免嵌套链接的可访问性问题）。dashboard 既有内容未改。摘要卡请求不带 `year`，由服务端决定当前年。
- `/records` 刻意不在 `SITEMAP_PATHS` 中（与 `/routes` 一致），`seo.ts` 只为它增加了页面描述。
- 最佳成绩口径：
  - 统计**全部历史**，不受所选年份影响。
  - 只看**整次活动**，不做轨迹滑窗；长跑途中最快的 5 km / 10 km 不计入。
  - 距离档取自 `activities/classify.py` 的 `DISTANCE_BANDS`：5km 档 4.0–7.5 km，10km 档 9.0–12.0 km（含边界）。
  - 活动必须满足统计模块既有的“可靠”条件（距离 > 0、用时 > 0、有计时器或时间质量为 complete/manual）。
  - 按**平均配速**升序排名，并列取日期较早者，再按 id 保证确定性。不按总用时排序，否则 4 km 短跑会胜过 5 km。不做距离外推，展示的是该次活动的实际距离与用时。
- 同期对比的截止日：所选年份是站主时区的当前年时，截止到今天；所选年份是过去的年份时取全年。对比年份的截止日是同一月日平移到对比年份（2 月 29 日在非闰年按 2 月 28 日）。页面标注“统计截至 …（对比年为 …）”。
- 对比年份是当前年而所选年份不是（如 `year=2025&compare_year=2026`）时，两边使用同一个日历日：对比年截止到今天，所选年截止到今天平移到该年，不拿过去的整年去比当前年的未完成部分（由纯函数 `resolve_cutoffs` 推导）。
- `compare_monthly` 是“同期”序列：按对比年的截止日截断（截止月只含截止日及之前的活动），其后的月份补 0（次数 0、里程 0、配速 `null`），仍恒为 12 项；过去年份的行为不变。`monthly`（所选年份）保持完整日历年。
- 月里程叠加图在各序列自己的截止月之后留空（截止月本身完整显示），数据表对应单元格显示“—”，所以当前年尚未到来的月份不会被画成 0。

## 接口与隐私

三组只读 GET 端点，查询参数相同：

| 范围 | 路径 |
| --- | --- |
| 本人工作区 | `/api/v1/statistics/records` |
| 根展示（站主） | `/api/v1/showcase/statistics/records` |
| 具名展示 | `/api/v1/showcase/users/{username}/statistics/records` |

- 查询参数：`year`、`compare_year`，均 `ge=1900, le=2100`；`year` 缺省为站主时区的当前年，`compare_year` 缺省为 `year - 1`；两者相同返回 422 `VALIDATION_ERROR`。
- 响应信封 `{data, error, meta.request_id}`，`data` 字段：
  - `year`、`compare_year`、`cutoff_date`、`compare_cutoff_date`、`date_assignment`（固定为 `activity_local_date`，日期按活动本地日期归属）；
  - `personal_bests`：有序列表 `[{category: "5km", best}, {category: "10km", best}]`，`best` 为 `null` 或 `{activity_id, activity_date, distance_m, duration_seconds, avg_pace_seconds_per_km, qualifying_count}`；
  - `monthly`、`compare_monthly`：各 12 项 `{month, activity_count, distance_m, avg_pace_seconds_per_km}`；
  - `weekly`：26 项 `{week_start, active_days}`；`weekday`：7 项 `{weekday, activity_count}`，周一为 0；
  - `comparison`：`{current, previous, delta}`，分别对应 `year`、`compare_year` 和二者之差（`year` 减 `compare_year`），任一侧配速缺失时配速差值为 `null`。
- 指标全部在服务端 SQL 中计算，复用统计模块的 `eligible` 判定与 `trends`/`summary` 查询；前端只呈现，不计算权威运动指标。“当前日”取 `request.app.state.clock()` 转站主时区。
- 响应只含汇总数字和活动 ID，不含标题、备注、文件名、坐标、轨迹、邮箱。三个端点的返回字段相同。
- 展示端点沿用 `reject_owner_override`，由 SQL 固定 subject（根展示固定为 `SITE_OWNER_EMAIL` 对应的站主，具名展示限站主或同时 `is_active AND showcase_enabled` 的用户），不接受客户端传入的 owner；本人端点只读本人数据。
- 无数据库变更、无迁移、无新后端模块；实现位于 `backend/app/modules/statistics/records.py`，路由挂在既有 `statistics` 与 `showcase` router 上。

## 验证记录

后端集成测试使用测试库 `running_note_phase_one_test`；环境变量只在 Python 子进程中注入，未修改 `.env`，未运行 alembic 迁移，未触碰开发库。

### 实际运行（2026-10-26，最终修复轮之后）

| 命令 | 结果 |
| --- | --- |
| 后端 `.venv/bin/pytest tests/unit -q` | 424 passed |
| 后端 `.venv/bin/ruff check app migrations tests` | All checks passed |
| 后端 `.venv/bin/ruff format --check app migrations tests` | 204 files already formatted |
| 集成（测试库）`test_records.py`、`test_statistics.py`、`test_showcase.py`、`test_admin_users.py` | 22 passed |
| 集成（测试库）整个 `tests/integration` | 322 passed，1 skipped，用时 195.41 s |
| 前端 `pnpm test` | 38 个文件，223 passed |
| 前端 `pnpm check` | 636 FILES，0 errors，0 warnings |
| 前端 `pnpm build` | 成功（既有大体积 chunk 警告属已知状态） |
| `playwright.ui.config.ts` 仅 `records.spec.ts` + `dashboard.spec.ts` | 12 passed |
| `playwright.showcase.config.ts` | 6 passed（修正 `showcase.spec.ts` 过时的 `/dashboard` 期望后；修正前 2 passed，4 failed） |
| `playwright.showcase-build.config.ts`（先 `pnpm build`） | 6 passed（同上） |
| `playwright.admin-users.config.ts` | 8 passed（修正 `admin-users.spec.ts` 的过时标签后；修正前单独运行 7 passed，1 failed，并行时另有一次 `:106` 偶发失败） |
| `playwright.admin-users-build.config.ts` | 8 passed（同上） |
| `playwright.ui.config.ts` 全套 | 第一次：200 passed，1 failed，3 skipped（6.7 min）；第二次：199 passed，2 failed，3 skipped（10.0 min） |
| `git diff --check` | 无输出，退出码 0 |

整目录集成运行中的 1 个 skipped 是 `tests/integration/test_migrations.py`，需要 `TEST_SNAPSHOT_DATABASE_URL`（未设置），与本功能无关。后端集成测试使用测试库，环境变量只在 pytest 子进程中注入。

最终修复轮新增的后端覆盖：当前年 `compare_monthly` 在对比截止日截断且补 0 到 12 项；`year` 为过去年、`compare_year` 为当前年时两边同截止日；无活动年份与无任何活动用户的空形状，且 `comparison.current` 与 `/statistics/summary` 一致；两年相同返回 `VALIDATION_ERROR`；具名展示启用时 `/statistics/records` 返回 200，关闭展示后返回 404（`test_admin_users.py`）；`resolve_cutoffs` 的单元测试。

**顺手修复的两处既有过时用例（与本功能无关，#13 之后未跟进）：**

- `showcase.spec.ts:7`：页面清单里的 `/dashboard` 改为 `/`（`src/routes/dashboard/+page.server.ts` 自 #13 起 308 重定向到 `/`，原断言 URL 以 `/dashboard` 结尾）。
- `admin-users.spec.ts:164`：`getByLabel('新密码', { exact: true })` 改为 `getByLabel('新密码（至少 12 位）', { exact: true })`，与设置页现有标签一致。
- 两处各是一行断言修改，修后上述四套配置（dev 与 build）均全部通过；未改动被测页面。

**全套 UI 运行中的偶发失败：** 第一次的 `dashboard-explorer.spec.ts:202`（390px）几何位置不等，之前一轮在 1440px 也出现过；该用例单独重复 24 次全过，整个文件也通过。第二次整套耗时 10 min，`activities.spec.ts:24` 与 `:63` 在 30 s 超时，`activities.spec.ts` 单独运行 16 passed。判断为整套并行运行下的负载型不稳定，但没有做根因调查，也不能完全排除摘要卡加载带来的布局影响。

### 未运行

- 对真实后端的 e2e（`*-e2e.config.ts`）、`design-system.config.ts`（像素截图对比）、`basemaps-live.config.ts`（访问真实底图网络）。
- 视觉检查：只看过合成 API 下浅色/深色 × 桌面/390px 的截图以及输入框焦点环；键盘操作和真实数据下的视觉未检查。ECharts 画布本身未做像素断言。
- 开发库未升级，也未做任何读写；新接口未在运行中的开发实例上验证（开发服务未重启）。
- 真实用户数据上的纪录结果未验证（只用合成数据）。
- `docs/design-system` 与独立 showcase 未更新：本次没有新增通用组件。
- CI（GitHub Actions）未运行；改动只涉及 backend 与 frontend，不触及迁移、`scripts/`、依赖清单、`infra/`，所以不需要改 `infra/native/tests/test_ci_changes.py`。

### 实现中超出原计划的改动

- `frontend/src/routes/+layout.svelte`：`appLayout` 正则加入 `records`，否则 `/records` 没有应用外壳。
- `frontend/tests/ui/dashboard.spec.ts`：该文件对 `**/api/v1/showcase/statistics/**` 的 mock 会把 `/streaks` 之外的请求都当作趋势请求，新增的 `/records` 请求会被误当 `/trends`；现在对 `/records` 与 `/streaks` 一样 `route.fallback()`，交给 `ui-api.mjs` 的合成端点。
- 同期对比图的截止月之后置空（见“使用方式”）。
- 最终审查后的修复：`compare_monthly` 按对比截止日截断；`compare_year` 为当前年时两边同截止日；摘要卡不再自带年份；`PersonalBests` 去掉冗余 `role="region"`（页面区块 `aria-labelledby="bests-title"` 已提供名称）。

## 未受影响的部分

既有 `summary`、`trends`、`streaks` 等统计接口的响应结构与数字、旧版摘要分享、足迹、常跑路线的接口与行为未改动；dashboard 既有内容未改；无数据库 Schema 变化。
