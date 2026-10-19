# 动效补全与统一设计

日期：2026-10-19

## 背景

全站已有页面切换、弹层、液态玻璃、卡片倾斜等动效，但条件渲染内容、原生对话框、列表、悬停与图表仍为瞬间切换，观感生硬。本次按现有风格补全，不全局换肤。

## 现状盘点

已有：`page-reveal` 页面方向进入、`navigation-progress`、`PageSkeleton` 呼吸、移动端侧栏 `@starting-style`、`popover-motion`、液态玻璃控件、`card-tilt`/`coverflow`、地图 `fitBounds`、全局 `prefers-reduced-motion` 兜底。

## 待完善项

P0
1. `FeedbackState` 及各处 `{#if}` 反馈条瞬间出现。
2. `RoutePosterDialog` 的 `<dialog>` 与 `::backdrop` 无进出场。
3. `/admin/users` 批量选择工具栏瞬间出现。

P1
4. 活动列表、指标卡、历史条缺少错峰进场。
5. 公开展示页内容无进场。
6. `SettingsTabs` 激活态硬切。
7. `+error`、`/admin`、`AuthForm` 无进场。
8. `ActivityCard`、`CalendarGrid` 悬停与按压反馈弱。
9. `TrendChart` 关闭了 ECharts 动画。

P2
10. 骨架屏到内容的衔接。
11. 按钮 `disabled`/`busy` 切换无过渡。
12. 全局过渡未覆盖 `opacity`、`box-shadow`。

## 方案

- 新增令牌：`--motion-enter`、`--motion-stagger`、`--motion-hover`，复用既有 `--motion-*` 与 `prefers-reduced-motion`。
- 新增通用类 `.stagger`（子元素按序号错峰淡入上移，最多 12 档）；`FeedbackState`、`.selection-toolbar`、`.auth-card` 用 CSS 进场动画。
- `<dialog>` 用 `@starting-style` 加 `transition-behavior: allow-discrete`（含 `overlay`、`display`）实现进出场，不改 JS 的 `showModal()`/`close()`。
- `ActivityCard` 悬停轻微抬升加阴影；`.button-secondary` 与主按钮增加按压缩放；`CalendarGrid` 日期格增加过渡。
- `TrendChart` 开启 ECharts 动画，时长 400ms，`prefers-reduced-motion` 下关闭。
- 不引入 Svelte `transition:|global`：全局离场会拖慢路由卸载，因此条件内容只做进场，不做离场。
- `SettingsTabs` 各分区是独立路由，指示器无法跨页滑动，改为激活态进入时的淡入缩放。

## 不做

不改后端、接口、数据与业务行为；不新增依赖；不改地图与海报的 canvas 逻辑。

## 验证

`pnpm check`、`pnpm test`，以及合成 API 的相关 Playwright UI 用例；真实记录见 `docs/62-motion-polish.md`。
