# 动效补全实施计划

设计见 `docs/superpowers/specs/2026-10-19-motion-polish-design.md`。

1. `app.css`：新增动效令牌、`.stagger`、`feedback-enter`、`.auth-card` 进场、按钮按压与悬停过渡、全局过渡补 `opacity`/`box-shadow`。
2. `RoutePosterDialog.svelte`：对话框与遮罩的进出场过渡。
3. `admin/users`：工具栏进场，表格行错峰。
4. 列表错峰：`activities` 列表、`MetricSummary`、`ActivityExplorer` 历史条、公开页列表。
5. `SettingsTabs` 激活态动画；`ActivityCard`、`CalendarGrid` 悬停反馈。
6. `TrendChart` 开启动画。
7. 更新 `docs/design-system/tokens.md`、`patterns.md`，补 UI 测试；运行 `pnpm check` 与 `pnpm test`。
8. 完成后追加 `docs/62-motion-polish.md`（使用方式、接口与隐私、验证记录）。
