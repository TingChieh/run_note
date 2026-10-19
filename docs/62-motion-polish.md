# 动效补全与统一

设计：`docs/superpowers/specs/2026-10-19-motion-polish-design.md`；计划：`docs/superpowers/plans/2026-10-19-motion-polish.md`。

## 使用方式

- 新令牌 `--motion-enter`、`--motion-stagger`、`--motion-hover`（见 `design-system/tokens.md`）。
- `.stagger` 加在列表、指标卡、表格 `tbody` 上，子项错峰进场。已用于：活动列表、`ActivityExplorer` 历史条、`/admin/users` 表格。`MetricSummary` 不用：活动详情页会原地重建它，错峰会造成整页刷新感。
- 已补动效：`FeedbackState`、认证卡、批量选择工具栏、海报对话框与遮罩、`ActivityCard` 悬停抬升、`CalendarGrid` 日期格、`SettingsTabs` 激活态、`.button-secondary` 按压缩放、`TrendChart`（400ms，减少动态时关闭）、全局过渡补 `opacity`/`box-shadow`。

- 仪表盘日历：当天活动并入日历卡片，用分割线隔开；首次点击用 `slide` 展开，再点其他日期保留旧内容并淡出、新内容原地淡入（无位移），卡片高度用 `ResizeObserver` 平滑过渡。
- 活动详情页路线占位里的反馈条不做进场，避免切换活动时闪烁。

## 接口与隐私

仅前端样式与组件改动，不涉及后端、接口、数据与隐私边界。

## 未实施项

- `SettingsTabs` 各分区是独立路由，未做跨页滑动指示器。
- 骨架屏与真实内容的交叉淡出、公开展示页的独立内容动画未做；公开页仍使用布局层的整页进入动画。
- 条件内容只做进场，没有离场动画。

## 验证记录

2026-10-19 实际运行：

- `pnpm check`：0 个错误，0 个警告。
- `pnpm test`：30 个文件、176 个用例通过。
- Playwright（合成 API）：`route-poster` 22 通过，`admin-users` 8 通过，`dashboard-explorer` 19 通过，`site-settings` 9 通过，`activity-library` 38 通过、1 失败；后续调整后重跑 `dashboard`、`dashboard-explorer`、`sport-detail`、`activities` 均通过。
- 失败用例为 `activity-metrics.spec.ts:9`（指标 `dd` 字号期望 ≥28，实际 20）。暂存本次改动后同样失败，是已有问题，与本次无关。

未运行：其余 Playwright 配置、真实后端 e2e、`pnpm build`、视觉回归截图（`design-system.config.ts`）。也未在浏览器中人工观看动效。
