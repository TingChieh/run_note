# 首页紧凑布局、累计省份与明暗切换

日期：2026-10-15。

## 使用方式

- 首页目标卡片减少内边距，省份地图完整等比缩小，减少整组卡片被地图撑出的空白。
- “运动足迹”缩减标题和指标卡片高度，地图随视口高度调整。1366×768、1440×900、1920×1080、1024×768 的合成样本可完整容纳整块足迹；移动端保持自然滚动，不裁切指标。
- 后续按截图调整：去掉足迹指标下的“时间完整”等质量文案；桌面指标网格与地图外框上下对齐、等分行高，最后一项步数铺满整行。仅调整 `ActivityExplorer.svelte` 的显示，详情页质量说明与后端指标不变。复测 `pnpm check` 为 0 errors/0 warnings，`dashboard-explorer.spec.ts` 为 14 passed（21.5 秒）；已检查合成桌面/手机截图与当前 Chrome 热更新后的文案，未为此次样式调整重跑生产构建或后端测试。
- 再次按截图移除首页运动足迹中的整块“设备指标”（最高/最低心率、最大步频等附加指标），活动详情与导入预览保留原显示。改动仅涉及 `ActivityExplorer.svelte`、现有首页 UI 断言与本文档；当前 Chrome 已确认该区块消失。重新运行 `pnpm check`：0 errors/0 warnings；`dashboard-explorer.spec.ts`：14 passed（21.5 秒）。本次未重跑构建、后端测试或完整 E2E，接口与数据库数据不变。
- 首页“足迹地图”显示全部时间的累计省份，切换运动日历年份不会影响它；无路线和境外记录不点亮省份。
- 运动日历使用更明显的五档绿色，减弱空白日期，并排除通用玻璃高光/阴影对数据颜色的覆盖。移动端日期文字保留足够对比度。
- 桌面侧栏、移动端顶栏、登录/公开页提供太阳/月亮按钮切换明暗；手动选择后显示“自动”按钮，用来恢复跟随系统。刷新与跨页签保留偏好，不丢失当前表单草稿。

## 接口与隐私

`GET /api/v1/footprints/provinces` 不传 year 时汇总本人的全部记录，返回既有字段，`year` 为 null；传入有效 year 时仍按该年统计，范围校验保持 1900–2100。

后端移除累计查询的日期条件；普通路线使用完整轨迹段与省界相交，仅横跨日期变更线候选段仍逐边展开、单独移位。归属过滤、跨日期变更线语义、SQL 超时、点数/轨迹段预算不变。结果仍不返回坐标、活动 ID 或原文。累计历史超过既有资源上限时仍可能返回限制错误。

外观偏好仅保存为浏览器本机 `runnote-theme` 的 light/dark 枚举，自动模式移除此键；不修改用户资料、接口或数据库。首屏在 `app.html` 解析外观，后续由 `system-theme.ts` 同步系统和 storage 事件。既有 `watchSystemTheme` 订阅实际主题，地图/图表只更新颜色，不重建实例。

## 改动范围

- 后端：`footprints/router.py`、`footprints/provinces.py` 支持省略年份；没有新增模型或迁移。
- 前端：`milestones.ts` 校验累计返回；`ProvinceMap` 与首页解绑年份；`GoalOverview`、`ActivityExplorer`、`RouteMap` 紧凑布局；`CalendarGrid`、`app.css`、`liquid-glass.css` 提升日历辨识度。
- 外观：新增 `ThemeToggle.svelte`；`system-theme.ts`、根布局、`AppNavigation`、`app.html`、玻璃装饰订阅实现切换、持久化和清理。`AGENTS.md` 的外观约定按本次用户新要求同步。
- 测试：省份前端契约与真实后端集成、累计 UI 夹具、桌面高度/移动端溢出、主题切换及五档日历对比度；临时诊断用例已移除。

## 验证记录

| 实际执行 | 结果 |
| --- | --- |
| frontend `pnpm test` | 19 文件，121 passed |
| frontend `pnpm check` | 0 errors，0 warnings |
| frontend `pnpm build` | adapter-node 成功；既有大 chunk 警告 |
| frontend `pnpm exec playwright test --config playwright.ui.config.ts theme.spec.ts milestones.spec.ts dashboard-explorer.spec.ts` | 最终 33 passed；真实 Chrome + 合成 API |
| frontend `pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts liquid-glass.spec.ts` | 21 passed；导航、移动端与玻璃控件回归 |
| backend `.venv/bin/pytest tests/unit -q --tb=short` | 274 passed；本地模拟 HTTP，无真实供应商调用 |
| backend `pytest -q tests/integration/test_milestones.py --tb=short`，仅进程注入独立测试库 | 1 passed：累计/年度、用户隔离、匿名 401、无坐标泄露 |
| backend `.venv/bin/ruff check app migrations tests` | All checks passed |
| backend `.venv/bin/ruff format --check app migrations tests` | 133 files already formatted |
| `git diff --check` | 通过 |

数据库验证先只读核对实际库名和端口。旧 `running_note_phase_one_test` revision 不满足现有测试夹具，因此未在该库继续测试；复用 `runnote_tcx_v2_20261015_test`，仅在此独立测试库应用已有迁移，从当次 0007 升到动态 head（当次 0009），没有修改开发库。测试变量只注入子进程，未改 `.env`。

初次普通沙箱执行本地 HTTP 测试遇到端口绑定限制，提升为允许本地连接后复测通过。布局初测发现窄屏箭头溢出、空路线切换高度差异，修正后通过。审查发现深色一级日历日期文字对比 3.90:1；去除颜色过渡中间帧的测试误判后复现失败，调整色值后五档文字均达到 4.5:1。

未运行：全量真实数据库集成、真实后端 Playwright E2E、Safari/Firefox、生产验收。日常后端已按下述故障修复记录重启并完成当前 Chrome 页面的运行验证。原有未提交修改、私人数据、鉴权/代理白名单与图表数据计算保持；没有提交或部署。

## 累计地图超时与统计联动失败修复

真实运行时累计地图出现 422，日历、年度统计、记录列表同时出现 500。日志堆栈确认这些 500 位于 `require_identity` 获取用户行锁处，并非统计聚合 SQL 本身缓慢。原有省份查询将所有路线逐边展开，累计历史导致空间比较超出 5 秒；该请求在身份校验时取得的用户行锁一直持有，其他并发请求等待同一行锁，超过默认 3 秒后失败。

最小修复位于 `backend/app/modules/footprints/provinces.py`：经度包围盒宽度不超过 180 度的普通轨迹直接用完整存储段做相交判定，保留每一条边和轨迹段之间的间断；其余轨迹仍沿用逐边跨日期变更线处理。未采样、未简化轨迹，未放宽鉴权、用户行锁或超时时间，也未修改数据库结构。

新增 `backend/tests/integration/test_province_performance.py`，仅使用独立测试库与合成坐标：200 个轨迹段、共 20 万点的跨省路线，在省份请求取得身份锁后并发加载日历。修复前真实执行失败，错误为统计请求等待 users 行锁超时；修复后两个接口均返回 200。既有省份集成测试继续覆盖累计/年度、单点、无路线、跨日期变更线、匿名访问与用户隔离。

本次实际验证：

- 独立 `runnote_tcx_v2_20261015_test` 中运行 `pytest tests/integration/test_province_performance.py tests/integration/test_milestones.py -q --tb=short`：2 passed，2.11 秒；未执行迁移。
- 后端 `pytest tests/unit -q --tb=short`：274 passed，20.64 秒。普通沙箱首轮因本地模拟 HTTP 端口受限失败，允许本地连接后复测通过。
- Ruff check：All checks passed；format check：134 files already formatted。
- 前端 `pnpm check`：0 errors、0 warnings；`git diff --check` 通过。本次超时修复没有新增前端代码改动。
- 当前开发数据只读复核：累计地图原查询超过 5 秒而失败，优化后约 0.24 秒；年度日历约 0.016 秒、累计摘要约 0.005 秒。只输出耗时与成功状态，未保存真实坐标或个人数据。
- 使用 `./backend.command restart` 加载修复，随后 status 确认本仓库后端运行、数据库已就绪；后端与前端 health 均为 200。
- 刷新用户当前 Chrome 数据汇总页后，年度摘要、累计省份地图、运动足迹和日历均正常显示，原有错误提示消失；对应后端省份、日历、摘要及活动列表请求均为 200，重启后检查时日志无 ERROR。
- 独立只读代码审查未发现阻塞问题，确认普通完整轨迹段与逐边相交的省份集合等价，跨日期变更线分支和资源预算保持。

开发库未执行迁移、测试写入或清理操作；页面正常读取沿用已有会话机制。未运行全量数据库集成、真实后端 Playwright E2E、其他浏览器或生产验收。极端跨日期变更线历史和超过既有点数预算的数据仍可能触发资源限制，不能据本次样本推断所有数据规模的性能。

## 主题按钮收放与当前状态文字

“自动”按钮切回系统偏好时缩小并向左侧模式按钮收回；再次手动切换时弹出。点击自动后焦点回主按钮，减少动态效果时取消过渡。模式文字与图标表示当前状态：深色显示“夜间模式”与月亮，浅色显示“日间模式”与太阳；悬停提示说明点击后的目标模式，aria-label 保留明确的切换操作。

独立合成 API + Chrome 动画诊断（`node /tmp/runnote-theme-absorb-preview.mjs`）已实际验证桌面 1440px 和手机 390px：弹出开始宽 2.64px，中间帧 30.83px；收回由 44px 到中间帧 23.32px，中心向主按钮移动，system 偏好与焦点正确；减少动态效果通过。诊断服务器使用 5192/8192，结束后关闭；未操作用户当前浏览器。相关最终导航/主题回归见 `45-persistent-navigation.md`。
