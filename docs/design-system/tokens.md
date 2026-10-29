# Design Tokens

唯一来源：[app.css](../../frontend/src/app.css)。材质几何在 [liquid-glass.css](../../frontend/src/lib/styles/liquid-glass.css) 与 [controls](../../frontend/src/lib/styles/liquid-glass-controls.css)，引擎参数在 [settings](../../frontend/src/lib/styles/liquid-glass-settings.ts)。不建立 `--ds-*` 平行色板。

## 主题与层叠

读取顺序：`:root` 基础 → `.sport-theme` 运动壳层 → `:root[data-theme="dark"]` 同时覆盖根与运动壳层。颜色应在实际元素上解析，不能只读根元素。Tailwind 通过 `@theme inline` 映射：`bg-background`、`bg-surface`、`bg-card`、`text-foreground`、`text-muted-foreground`、`bg-primary`、`text-primary-foreground`、`border-border`、`ring-ring`、`text-destructive`、`text-warning`、`bg-warning-soft`。

`--color-surface: var(--surface)` 为本批新增兼容映射；`--color-card` 保留，两个名称同源。其余颜色值和主题选择器不改。不要重排 layer、删掉材质 `!important` 或只改类名而丢失增强 selector。

## Colors

下表是实际运动壳层的 light/dark；没有覆盖时继承 root。完整原始值仍以源文件为准。

| Token | light | dark | 用途 |
| --- | --- | --- | --- |
| `--background` | #f6f7f4 | #101a16 | 页面底色 |
| `--surface` | #ffffff | #1b2922 | 卡片、字段、浮层基础 |
| `--foreground` | #202d23 | #e4eee7 | 正文 |
| `--muted-foreground` | #5c695e | #b1c3b6 | 次级文字 |
| `--muted` | #eff2e9 | #26362d | 次级区域 |
| `--border` | #e0e6da | #405348 | 分界与边框 |
| `--primary` | #17745c | #77d4ac | 主操作、选择 |
| `--primary-hover` | #105d49 | #9ce4c3 | hover |
| `--primary-soft` | #e8f6df | #233e30 | 轻选择表面 |
| `--swatch-light-bg` / `--swatch-light-fg` | #f6f7f4 / #202d23 | 同左（不随主题变化） | 站点设置“默认外观”卡片里的浅色迷你预览 |
| `--swatch-dark-bg` / `--swatch-dark-fg` | #101a16 / #e4eee7 | 同左（不随主题变化） | 同上，深色迷你预览 |
| `--primary-foreground` | #ffffff | #10251b | 主操作文字 |
| `--ring` | #17745c | #9ce4c3 | 可见焦点 |
| `--control-hover-border` | #91aca0 | #8da996 | 字段 hover |
| `--sport-sidebar` | #218538 | #173c2b | 导航 |
| `--sport-nav-hover` | #0000000a | #ffffff12 | 导航 hover |
| `--sport-nav-active` | #e8f6df | #2a5138 | 当前导航 |
| `--sport-nav-active-ink` | #18592a | #daf3c8 | 当前导航文字 |
| `--sport-yellow` | #f5c519 | #58471e | 页头表面 |
| `--sport-heading-ink` | #20332b | #ffe9a5 | 页头文字 |
| `--sport-detail-ink` | #263120 | #ffe9a5 | 详情文字 |
| `--sport-heading-border` | #b5a43d | #9c884f | 业务标题边界 |

非运动根元素的正文 #1e302b、次级文字 #596b63、muted #eef2f0、border #dbe4df、primary-soft #e7f3ed；不要把根值误写为所有页面现值。

| 状态组（foreground / soft / border） | light | dark |
| --- | --- | --- |
| `--error / --error-soft / --error-border` | #a52b32 / #fff1f1 / #efc9cc | #ffadb1 / #40252a / #91525c |
| `--success / --success-soft / --success-border` | #176448 / #ecf7ef / #bcdcca | #9fe1b6 / #203d2c / #4c8362 |
| `--warning / --warning-soft / --warning-border` | #805412 / #fff8e9 / #ead7b3 | #f5d391 / #3a3020 / #806b41 |

装饰色 `--sport-green` #86a912、`--sport-blue` #4bb6df、`--sport-coral` #f06373、`--sport-yellow-accent` #f5c519、`--sport-ink` #20332b 保持稳定；不是状态色，也不是深色页头色。

身心健康小组件色 `--well-mood/anxiety/energy/focus/function/sleep/sleep-quality/effects/note/dose`（浅 #7a6bd6/#d9692f/#c99700/#2b8cc4/#2e9e63/#178f93/#4a67d8/#c2485a/#b8508c/#6f8f1c，深 #b3a8ff/#ffab80/#ffd75e/#7cc7f2/#7fdba5/#6fe0dc/#9db1ff/#ff9aa8/#f2a1c8/#c3e66b）：每个小组件一种色，用作拨盘、图标圆盘与强调，仅 `WellbeingTile` 系列使用，不是状态色。

数据颜色：`--calendar-0..4`（浅 #edf0ed/#8dcc9c/#4ca76a/#227b49/#105332，深 #26342c/#347247/#60aa72/#90cc96/#c7edb5）、`--calendar-ring/label/active-label/strong-label`、`--chart-series`（#27815c/#77d4ac）、`--route-thumbnail`、`--province-unvisited/sea`、`--comparison-down`。计数色阶、轨迹区分色、未知区域颜色各有含义，不能统一替换为主色；当前地图专项色板见 `src/lib/map/footprint-colors.ts`。

## Typography

字体栈不变：`--font-body` 为 system-ui / Apple / Segoe UI / PingFang SC / Microsoft YaHei / sans-serif。组件里的 `font-size`、`font-weight`、`letter-spacing`、`line-height` 只引用下表 token；Tailwind 的 `text-xs`…`text-4xl` 与 `font-normal|medium|semibold|bold` 在 `@theme` 里对齐同一阶梯。禁止 550/650/750：苹方没有这些档，macOS 上数字会比中文更粗。

| Token | 值 | 角色 |
| --- | --- | --- |
| `--text-caption` | .75rem / 12px | 眉题、日期、角标、图例 |
| `--text-small` | .875rem / 14px | 次要说明、按钮、表单标签 |
| `--text-body` | 1rem / 16px | 正文；足迹墙卡片标题（唯一允许比 18 更小的卡片标题） |
| `--text-card` | 1.125rem / 18px | 卡片标题，字重 semibold |
| `--text-section` | 1.25rem / 20px | 区块 h2、行内数字 |
| `--text-stat` | 1.75rem / 28px | 卡片大数字 |
| `--text-title` / `--text-sport-title` | 2.5rem / 40px | 页面 h1、主数字 |
| `--text-display` | 3rem / 48px | 特大展示数字 |

| Token | 值 | 角色 |
| --- | --- | --- |
| `--weight-regular` | 400 | 正文、输入内容 |
| `--weight-medium` | 500 | 标签、未选中导航 |
| `--weight-semibold` | 600 | 标题、按钮、当前导航 |
| `--weight-bold` | 700 | h1 与大数字 |
| `--weight-title` / `--weight-sport-title` | 引用 bold | 页面 h1 |

行高只有五档：`--line-height-solid: 1`（图标与单行居中）、`--line-height-tight: 1.15`（大数字）、`--line-height-title: 1.25`（h1）、`--line-height-heading: 1.4`（h2/h3 与控件）、`--line-height-body: 1.65`（正文）。中文标题字距为 0（`--tracking-title` / `--tracking-heading`）。仅全大写拉丁短标用 `--tracking-caps: .12em`。大数字加 `tabular-nums`。

同类元素：所有区块 h2 为 20/600；卡片标题为 18/600，足迹墙为 16/600；大数字按 hero 40、卡片 28、行内 20，一律 700。日历月份小标题保持 14，它是格内标签而不是卡片标题。海报画布用像素坐标排版，字重仍只能是 400/500/600/700。

## Spacing、Radius 与布局

| 既有 Token | 值 | 典型用途 |
| --- | --- | --- |
| `--space-1/2/3/4/6/8/12` | .25/.5/.75/1/1.5/2/3rem | 内边距、字段、模块与页面留白 |
| `--radius-control` | .75rem | 字段和基础控件 |
| `--radius-field` | .625rem | 紧凑文本框 `.text-field` |
| `--radius-card` | 1.5rem | 内容卡片、页头 |
| `--radius-pill` | 9999px | 胶囊与材质控件 |
| `--radius-glass-control/panel` | 引用 pill/card | 材质 CSS 中的最终几何 |
| `--sidebar-width` | 15rem | 桌面导航 |
| `--content-width` | 86rem | 内容最大宽度 |

常用控件最小高度 2.75rem（44px）；页面水平 padding 为 clamp(1rem,3vw,3rem)。`.aux-panel` 的 padding 为 clamp(1rem,3vw,1.5rem)。不为 .7rem、1.4rem 等业务光学值自动取整。

## Surfaces 与 Shadows

普通表面：surface + border + radius-card；浮层在此基础上加阴影。`--surface-backdrop: rgb(0 0 0 / .5)` 与 `--shadow-popover: 0 12px 40px var(--shadow-popover-color)` 为本批语义角色；颜色 `--shadow-popover-color:#1e302b26` 保留 DatePicker 原值，本批不更改深色阴影强度。既有 dialog 尚未迁移至 backdrop 角色。

玻璃：`--glass-surface/hover`、`--glass-edge/sheen/reflection/rim/shadow`、`--glass-fill-base`、`--glass-action-tint-factor/foreground`、`--glass-danger-foreground/ink` 均已有浅深色定义。运动壳层还通过 color-mix 组合实际材质，不能只看 root 的半透明静态值。完整阴影几何保持在材质 CSS，不为“一致”合并不同层。

`--glass-opacity` 默认 .14；其余折射/弹簧参数继续由 `DEFAULT_GLASS_SETTINGS` 管理。普通卡片不使用折射；reduced-transparency/forced-colors 回退沿用现有 CSS/action。

## Motion

| Token / 实现 | 值 | 状态 |
| --- | --- | --- |
| `--transition-control` | 150ms ease | 已有，控件颜色/边框 |
| `--motion-reveal` | 180ms ease-out | 新增，原淡入等值引用 |
| `--motion-page-enter` | 420ms cubic-bezier(.22,.61,.36,1) | 新增，原页面进入等值引用 |
| `--motion-popover-enter-duration/ease` | 380ms / cubic-bezier(.2,1.22,.32,1) | 菜单、日期从触发控件展开，轻微回弹 |
| `--motion-popover-exit-duration/ease` | 220ms / cubic-bezier(.4,0,.7,1) | 收回触发控件，保留原生 top layer 退场 |
| `--motion-enter` | 320ms cubic-bezier(.22,.61,.36,1) | 反馈条、工具栏、认证卡、`.stagger` 子项进场（淡入加上移） |
| `--motion-stagger` | 45ms | `.stagger` 子项错峰间隔，最多 12 档 |
| `--motion-hover` | 200ms cubic-bezier(.22,.61,.36,1) | 卡片抬升、日期格等悬停过渡 |
| 其他 Svelte transition | 按源码 easing | 保留，不强制并轨 |
| 引擎 spring | JS 物理参数 | 保留，不复制为 CSS duration |

全局 `prefers-reduced-motion: reduce` 禁用动画、过渡与平滑滚动；JS 动效也须遵循。不得为了快照取消生产中的偏好处理。

## Breakpoints 与 Z-index

断点是源码常量，不用 `var()` 写普通媒体查询：

| 边界 | 现有用途 |
| --- | --- |
| 360px | 极窄导航文案收起 |
| 480px | 骨架与局部密度 |
| 640px | 表单/页头动作换行、指标纵排、公开导航收敛 |
| 768px | DatePicker 全宽及局部布局 |
| 1024px | 私人侧栏/手机展开导航切换 |
| 1200px | 指标图标横排恢复 |
| 桌面高度 ≤900px | 侧栏密度降低以保留账户区域 |

足迹墙采用自己的容器查询；不以 viewport 断点替代。验证边界两侧，不只验证一台手机。

本批全局角色：`--z-navigation-progress:40`、`--z-dev-tools:50`、`--z-skip-link:100`，与原值相同。前两种导航/跳转层已在 app.css 等值使用；dev-tools 用于既有 tuner。玻璃内部 -1/1/2/3/4/5 是局部层叠，不参加全局排序。原生 dialog/popover 属 top layer，不能通过增大 z-index 修复其焦点或覆盖问题。

## 可访问性与变更规则

保留 2px 可见焦点和 3px offset；侧栏、密集日历和地图有专用焦点规则。新文字与表面组合目标 ≥4.5:1，关键图形/焦点按适用标准核对；玻璃需检查实际背景合成，不能只计算主色值。审计记录的部分不透明色对通过不代表全站认证。没有授权不更改现有品牌颜色来“修复”未定位的问题。
