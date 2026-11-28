# 107 · Editorial Receipt 剩余 Web 路由迁移审计与验收记录（Item 147）

## 1. 范围与 PR 拆分

继六大参考页（`docs/101–106`：`dashboard`、`/activities`、`/activities/[id]`、`/footprints`、`/workspace/records/recap`、`/settings` 及 `/admin/users`）完成 Editorial Receipt 迁移后，本轮对 Item 147 列出的剩余 Web 路由（`records`、`routes`、`together`、`wellbeing`、`ai`、`admin`、`shared`、`privacy`、`workspace` 及其子路由与 `/p/[username]/*` 复用页）进行了逐页审计、迁移与多视口明暗模式验证。

为保持 Diff 可审阅且互不冲突，全部改动基于 `main`（`51a603cb`）拆分为 4 个文件零重叠的独立 PR：

| PR | 分支 | 覆盖路由 | 核心变更 |
| --- | --- | --- | --- |
| PR #168 | `TingChieh/editorial-records-story` | `/records`、`/workspace/records/story`（及 `/workspace/records`、`/p/[username]/records`） | 账页横幅 `RecordsBanner appearance="ledger"`、印刷柱 `RecordsChart appearance="receipt"`、`PeriodReportCard` 去 W-02 彩色徽章、年度故事票据纸序章与章节节线、分享弹层 `data-glass-overlay` |
| PR #169 | `TingChieh/editorial-routes-together` | `/routes`、`/routes/[id]`、`/together`（及 `/workspace/routes*`、`/p/[username]/routes*`） | `.underline-tabs` 排序/周期切换、账页路线卡片、`RouteMap appearance="sheet"`、Editorial Receipt 趋势折线、`/together` 主数字里程碑 + 4px 直角排行条 + `FootprintMap appearance="sheet"` |
| PR #170 | `TingChieh/editorial-ai-wellbeing` | `/ai`、`/wellbeing`（及 `/workspace/ai`、`/workspace/wellbeing`） | `/ai` 节线工作台 + 1px 栏分割 + 发丝线会话账页 + 等宽额度 + `.status-strip` + 4px 对话与块卡片；`/wellbeing` 页头/分区标签/趋势与总结头部对齐 Editorial Receipt，按 `web-audit.md §5` 与 `brand.md §6.11` 保留 `--well-*` 色彩、圆环交互组件与 `SaveBar` 浮动液态玻璃 |
| 本 PR | `TingChieh/runnote-editorial-remaining` | `/admin`（登录态/匿名态）、`/admin/users/[id]/activities*`、`/privacy`、`/activities/record`（及 `/workspace/activities/record`）、合规路由复核 + 本文档 | 站点管理节线入口、登录表单 Editorial Receipt 纸面与 44px 控件、管理员只读记录与详情账页、隐私政策 8 节去 24px 嵌套卡、实时记录页 Web 操作态清理 |

## 2. 路由覆盖审计表

| 路由 | 复用/入口 | 状态 | 处理方式与证据 |
| --- | --- | --- | --- |
| `/records`、`/workspace/records`、`/p/[username]/records` | `routes/records/+page.svelte` | 已迁移（PR #168） | `.editorial-page`、紧凑 `PageHeader`、`RecordsBanner appearance="ledger"`、`RecordsChart appearance="receipt"`、`PeriodReportCard` 发丝线分组 |
| `/workspace/records/recap` | `routes/workspace/records/recap/+page.svelte` | 已合规（无需改动） | 已由 PR #163 / #165（`docs/105`）完成 Editorial Receipt 票据页迁移 |
| `/workspace/records/story` | `routes/workspace/records/story/+page.svelte` | 已迁移（PR #168） | 票据页序章（`.receipt-sheet` / `.receipt-header` / `--text-period-hero` / `.receipt-perforation`）、`.underline-tabs` 年份切换、章节 01–05 节线、`StoryShareDialog` |
| `/routes`、`/workspace/routes`、`/p/[username]/routes` | `routes/routes/+page.svelte` | 已迁移（PR #169） | `.editorial-page`、`PageHeader meta`、`.underline-tabs` 排序、`RouteGroupCard` `--paper` / `--radius-sheet` 账页卡 |
| `/routes/[id]`、`/workspace/routes/[id]`、`/p/[username]/routes/[id]` | `routes/routes/[id]/+page.svelte` | 已迁移（PR #169） | `.editorial-page`、`.section-rule` 四联指标、`RouteMap appearance="sheet"`、`RouteGroupTrend` 印刷风折线、发丝线成绩表 |
| `/together` | `routes/together/+page.svelte` | 已迁移（PR #169） | `.editorial-page`、`.section-rule` 主数字里程碑、`.underline-tabs` 排行周期 + 4px 直角进度条、`FootprintMap appearance="sheet"`、`TogetherRecordSheet data-glass-overlay` |
| `/ai`、`/workspace/ai` | `routes/ai/+page.svelte` | 已迁移（PR #170） | `.editorial-page`、节线双栏工作台（移除 `.aux-panel` 24px 卡）、发丝线会话列表、等宽额度文本、`.status-strip` 提示与免责、`AssistantConsentCard` 圆点状态、`AssistantBlocks` 4px 块卡与 `TrendChart appearance="receipt"` |
| `/wellbeing`、`/workspace/wellbeing` | `routes/wellbeing/+page.svelte` | 部分迁移 + 显式保留（PR #170） | 页头、5 分区 `.underline-tabs`、趋势/总结头部 `.section-rule` + `.underline-tabs`、历史日历/备注 `--paper`/`--radius-sheet`、导出 `.section-hairline`；保留 `--well-*` 色彩、圆环控件与 `SaveBar` 浮动玻璃 |
| `/admin`（已登录） | `routes/admin/+page.svelte` | 已迁移（本 PR） | `.editorial-page`、紧凑 `PageHeader`（移除叙述性 `description`）、`.section-rule` 管理入口网格；同步更新 `admin-unified-design.spec.ts` |
| `/admin`（未登录） | `AuthForm.svelte` | 已迁移（本 PR） | `.auth-card`（位于 `.editorial-page` 之外以保留登录按钮液态玻璃契约；`--paper` / `--radius-sheet` / 2px 顶线）、`--header-tint` 介绍带、44px `.text-field` 与 44px 显示密码按钮；保留全部校验、聚焦与水合保护 |
| `/admin/users` | `routes/admin/users/+page.svelte` | 已合规（无需改动） | 已由 PR #164 / #167（`docs/106`）迁移，本轮四视口明暗视觉 QA 0 溢出复核通过 |
| `/admin/users/[id]/activities` 及 `[activityId]` | `AdminActivityPage.svelte` | 已迁移（本 PR） | `.editorial-page`、紧凑 `PageHeader`、`.status-strip` 只读提示、`.section-rule` 发丝线列表、详情页 `MetricSummary appearance="receipt"` + `RouteMap appearance="sheet"` + 发丝线心率与备注 |
| `/shared/[token]`、`/public/activities/[id]` | `PublicActivityPage.svelte` | 已合规（无需改动） | 已由 PR #161（`docs/103`）完成 `.editorial-page.public-detail-page`、`PageHeader meta`、`.section-rule` 与 `MetricSummary appearance="receipt"` 迁移 |
| `/privacy` | `routes/privacy/+page.svelte` | 已迁移（本 PR） | `.editorial-page`、紧凑 `PageHeader meta`、8 节 `.aux-panel` 改为 `.section-rule` / `.section-hairline`、`.deletion-callout` 4px 纸面 + 3px 左accent 线；保留全部法律披露原文、锚点与 `mailto:` |
| `/activities/record`、`/workspace/activities/record` | `RecordingWorkspace.svelte` | Web 操作态清理（本 PR） | `.editorial-page`、`.section-rule` / `.section-hairline`、圆点等宽状态行、4px 纸面上传队列、`<dialog data-glass-overlay>`；完整保留录制状态机与 Capacitor 能力 |
| `/workspace/dashboard`、`/workspace/activities*`、`/workspace/footprints*`、`/workspace/settings*`、`/p/[username]/*` | 直接复用对应核心页 | 已合规（无需改动） | 均直接复用已迁移的核心页面组件 |
| `/workspace`、`/activities/wall`、`/activities/shoes`（及 `workspace`/`/p` 别名） | 服务端重定向路由 | N/A（无独立 UI） | 仅执行 307/308 跳转，无渲染界面 |

## 3. N/A 与显式保留决策

1. **身心健康 `--well-*` 色彩、圆环交互组件与浮动液态玻璃 `SaveBar`**：依据 `docs/design-system/web-audit.md §5` 与 `docs/design-system/brand.md §6.11`，`--well-*` 每项一色与 `WellbeingTile` / `WellbeingDial` / `WellbeingSleep` / `WellbeingStockRing` 及 `SaveBar glass` 属于明确保留的临床/健康感知设计，不强行改为单色印刷样式；`WellbeingDayEditor` 服药弹层内 `.settings-tabs[data-lens="fixed"]` 亦保持不变。
2. **实时记录户外全屏模式（`brand.md §6.9`）**：`--rec-bg`、136px 距离主数字、锁屏按钮、长按结束等属于移动端户外全屏记录态规范，在 Web 端标记为 **N/A / 延后至独立移动端记录 PR**；本 PR 仅将 Web 端 `RecordingWorkspace.svelte` 对齐操作页节线、控件与队列规范，不改动录制状态机与离线上传契约。
3. **无后端/契约变更**：本轮未修改任何后端代码、API、数据库 schema、CSRF 策略、版本号或构建流水线，所有未提供的后端字段均未虚构。
4. **独立设计系统 Showcase 隔离**：`RecordsBanner` 与 `RecordsChart` 通过可选 `appearance` 属性启用 Editorial Receipt 样式，默认值不变，保证 `pnpm showcase` 及既有 macOS 快照不受影响。

## 4. 视觉 QA 与自动化验证

每个发生改动的路由均在 `1440×900`、`768×1024`、`390×844`、`320×640` × `light` / `dark`（8 组合）下完成 Chromium 截图人工核对与 `scrollWidth <= innerWidth` 零溢出校验，无 console/page error；所有 PR 均通过 `pnpm check`（0 error / 0 warning）、`pnpm lint:style`、`pnpm test`（80 文件全过）与 `pnpm build`，以及各领域 Playwright UI 套件验证。

### 未在本机环境验证项（透明声明）

- 真实 PostgreSQL/PostGIS 集成测试与 `playwright.config.ts` 真实后端 E2E（本轮无后端改动，依赖 GitHub Actions CI）。
- macOS 专用视觉快照 `playwright.design-system.config.ts`（当前运行环境为 Linux，无法生成/比对 `*-darwin.png`）。
- 真实 Safari / WebKit 浏览器渲染（本地仅使用 Chromium 通道）。
- `wellbeing.spec.ts` 中 7 条使用固定时刻 `08:00` 的用例在本机凌晨 04:30（Asia/Shanghai）运行时因“服药时间不能晚于现在”的实时时钟校验触发失败，以及 1 条硬编码端口 `5191` 的用例在隔离端口 `5193` 下预期不匹配；与改动相关的 2 条玻璃/SaveBar 回归用例均已单独复验 2/2 通过。
- `together.spec.ts:365` 在本地非离线环境下出现 1 次 OpenFreeMap 外部瓦片在前后截图间加载完成的竞态差异（经前后 canvas 截图比对确认轨迹与缩放完全未位移）。
