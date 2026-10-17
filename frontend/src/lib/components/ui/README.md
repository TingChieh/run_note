# RunNote 公共 UI 索引

正式规范：[Design System](../../../../../docs/design-system/README.md) · [组件与 API](../../../../../docs/design-system/components.md) · [Patterns](../../../../../docs/design-system/patterns.md) · [Tokens](../../../../../docs/design-system/tokens.md)。

既有组件保留在父目录：PageHeader、FeedbackState、PageSkeleton、MetricSummary、DatePicker、ThemeToggle。原生控件、`button-secondary`、`aux-panel` 和 `liquidGlass` 也是复用入口，不必逐个包装成组件。

普通表面使用 `bg-surface` / `bg-card` 或 `var(--surface)`；禁止以固定 `bg-white` 作为新卡片规范。先查真实消费者与 Pattern，保持主题、状态和材质选择器契约。

在 `frontend/` 执行 `pnpm showcase` 查看独立组件展示，执行 `pnpm exec playwright test --config playwright.design-system.config.ts` 验证。展示不注册生产路由。新增通用能力同步正式文档与展示；业务分页、事务、接口、授权和日期解释留在原调用方。
