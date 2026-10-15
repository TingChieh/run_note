# 跟随设备夜间模式实施计划

**目标：** 首屏、路由切换及设备外观实时变化均自动应用对应主题。

**架构：** 页面通过 CSS 媒体查询覆盖语义变量；Canvas 和 WebGL 组件在挂载时监听同一媒体查询，只更新绘制颜色。沿用 Svelte 5、Tailwind 4、ECharts 和 MapLibre，无新增依赖。

**约束：** 不修改 API、数据库、认证及私人数据处理；不提交或推送；保留浅色表现。直接在本次已获授权的工作目录实施。

## 1. 浏览器回归检查

- [x] 新建 `frontend/tests/ui/theme.spec.ts`，检查深色首屏、浅深实时切换、表单草稿保留、正文与卡片对比度、手机溢出、图表文字和地图主题。
- [x] 在 `frontend/playwright.ui.config.ts` 注册文件。
- [x] 执行 `node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts theme.spec.ts`，确认现有页面因仍为浅色而失败。

## 2. CSS 与固定颜色适配

- [x] 在 `frontend/src/app.css` 定义警告、状态边框、日历档位、缩略图、省份与标题区域的语义变量。在 `@media (prefers-color-scheme: dark)` 中同时覆盖 `:root` 与 `.sport-theme`，使用深背景与可读文字。
- [x] `frontend/src/app.html` 声明 `<meta name="color-scheme" content="light dark" />`。
- [x] 目标、日历、省份、缩略图、活动警告及错误／AI 提示使用变量；标题与图标各有独立前景色，避免降低标题亮度后图标失去对比度。

## 3. 绘图同步

- [x] 增加 `frontend/src/lib/components/system-theme.ts`：`watchSystemTheme(update: (dark: boolean) => void): () => void` 在挂载时监听并返回清理函数。
- [x] `TrendChart.svelte` 在 `draw()` 读取容器主题变量，为轴、网格、提示和系列赋色；监听时重新绘制现有实例。
- [x] `map-style.ts` 增加 `applyMapTheme(map: Map, dark: boolean): void`，仅更新已存在的背景、底图与路线图层绘制属性。
- [x] 两个地图在图层建立后及媒体查询变化时应用主题，销毁时移除监听。保持地图视野、选择及底图开关状态。

## 4. 验证与交付

- [x] 重跑主题浏览器测试并检查桌面／手机截图；补充地图底图成功及失败场景。
- [x] 运行 `node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts` 完整 UI 回归。
- [x] 运行 `pnpm check`、`pnpm test`、`pnpm build`，检查退出码和错误。
- [x] `git diff --check` 并审阅改动，更新验收记录，只报告有证据的完成范围。
