# RunNote UI 审计

日期：2026-10-16。状态：**阶段 0 审计完成；用户随后确认阶段 1–3，现已实施**。下文保留审计时点事实与历史验证，当前有效规则见 [Design System](README.md)，实施结果见 [验收](../50-ui-design-system.md)。

审计阶段仅新增文档，不修改样式、组件、路由、AGENTS.md、依赖、接口或数据库。“已有”表示审计时点代码事实；“建议”表示当时提出的后续工作，完成状态以验收文档为准。

## 1. 结论与审计边界

RunNote 已形成自己的设计语言：绿色运动空间导航、黄色内容页头、偏暖的浅色背景、绿色系深色主题、24px 大圆角内容卡片、胶囊控件、彩色圆形指标图标，以及控件上的 Liquid Glass 材质与弹性反馈。应保留这些特征，在现有令牌和组件上补全规范。

优先解决的是样式入口与规则不清晰，而不是缺少一整套 UI 框架。现有基础由 **CSS 类、原生 HTML、Svelte 组件、客户端增强 action** 共同构成；不能把“没有同名 Svelte 文件”解释成“能力不存在”。

现场清点：13 个 `+page.svelte`、28 个公共目录内的 Svelte 组件；根布局额外管理导航、身份校验、主题和页面过渡。已检查全体页面的组件引用、组件 props/展示结构、全局和局部样式，以及 UI 测试配置。没有读取密钥文件或真实运动数据。

基线为 `main` 上的**当前工作区**，不是仅 HEAD。开始时已有全局 CSS、导航、布局、足迹页、地图及测试修改；审计中又出现活动接口消费者、足迹墙、卡片、夹具和测试的外部修改。末次静态复核已纳入 `WallCard.compact`、足迹墙 24 条分页与容器查询；早先浏览器截图不能证明这批后续变更的成功态。实施前必须重新取状态和对应视觉基线，不得覆盖这些修改。

相关文件：`frontend/src/app.css`、`frontend/src/routes/+layout.svelte`、`frontend/src/lib/components/`、`frontend/src/lib/styles/`、`frontend/src/app.html`、`frontend/vite.config.ts`、`frontend/package.json`、`frontend/tests/ui/`。

## 2. 技术栈与已有文档

- SvelteKit 3 / Svelte 5 runes / TypeScript 6 / Vite 8 / Tailwind 4；adapter-node，配置位于 `vite.config.ts`。
- 图表 ECharts 6、地图 MapLibre GL 5；在客户端动态导入。没有安装通用 UI 组件框架、Storybook 或无障碍组件库。
- Liquid Glass 使用仓库内固定版本的 MIT 引擎，来源与提交记录在 `frontend/src/lib/vendor/liquidglass/README.md`。它是现有视觉的一部分，无需重新引入或升级引擎。
- 已有 `frontend/src/lib/components/ui/README.md`；组件文件实际位于其父目录，`ui/` 目前只有说明。不能为了目录整齐批量搬迁组件。
- `docs/18-v1.1-ui-ux-plan.md`、`docs/25-v1.1-sport-design-rollout.md`、`docs/35-liquid-glass-buttons.md` 至 `docs/39-inline-goals-and-menu-transparency.md`、`docs/44-dashboard-compact-and-theme.md`、`docs/45-persistent-navigation.md`、`docs/47-ai-shared-date-picker.md` 可追溯设计演变；历史截图与测试计数不是当前验收。

## 3. 页面、路由与调用关系

下表路径相对于 `frontend/src/routes/`。

| 路由 | 当前组合 | 设计角色与保留点 |
| --- | --- | --- |
| `/` | `+page.server.ts` 重定向 `/dashboard`；`+page.svelte` 为占位 | 延续入口、查询参数和鉴权行为，不建立第二个首页 |
| `/dashboard` | PageHeader、GoalOverview、ProvinceMap、ActivityExplorer、CalendarGrid、TrendChart、FeedbackState、PageSkeleton | 最完整的品牌样本：年度指标、目标、省份图、功能入口、路线浏览、日历与趋势 |
| `/activities` | PageHeader、ActivityCard、ActivityEditor、MifitnessImport、反馈/骨架、原生 dialog | 导入与活动管理；不能把业务事务抽到 Button 或 Card |
| `/activities/[id]` | 专用 sport-hero、ActivityActions、MetricSummary、RouteMap、DeviceMetrics、WallCard、SharePanel | 有意采用“指标 + 大路线”详情布局，保留专用 hero，不强塞进通用页头 |
| `/activities/wall` | PageHeader → FootprintWall → WallCard → RouteThumbnail | 足迹画廊；当前工作区新增 compact 与容器查询，需单独稳定基线 |
| `/footprints` | PageHeader、FootprintMap、反馈/骨架、模式切换与图例 | 全部记录快照、轨迹/热图、底图降级与城市定位；不同于单活动地图 |
| `/ai` | PageHeader、DatePicker、AnalysisFacts、反馈/骨架 | 日期范围 → 统计依据 → 用户确认生成 → 报告/历史；展示页面不能触发供应商调用 |
| `/settings` | PageHeader、`.aux-panel`、原生表单、FeedbackState | 账户只读信息 + 资料/公开设置；保留 dirty、busy 与保存反馈 |
| `/login`、`/register` | AuthForm | 公共壳层、居中窄卡片、黄色 intro；复用同一表单 |
| `/u/[username]` | PageHeader、MetricSummary、CalendarGrid、公开记录列表 | 独立公开视图，无私人侧栏 |
| `/public/activities/[id]`、`/shared/[token]` | 同一 PublicActivityPage → PageHeader、MetricSummary、FeedbackState | 白名单运动摘要，无坐标、精确起终点或私人管理操作 |

根布局通过 `isProtected()` 和会话状态选择私人侧栏/公共顶部导航；`sport-theme` 当前作用于两类壳层，不再只是早期的详情样例开关。`AppNavigation` 使用 SVG 图标、`aria-current`、移动端展开菜单与 Escape 焦点恢复；当前未提交版本还包含按导航顺序进入页面的方向动画。

公共组件依赖关系的关键部分：

```text
+layout → AppNavigation → RunningGoal / ThemeToggle
        → PageSkeleton / FeedbackState / liquidGlass(action)
        → DEV 动态加载 LiquidGlassTuner
activities → ActivityCard → MetricSummary / RouteThumbnail
           → ActivityEditor（ActivityActions 也复用）
dashboard → ActivityExplorer → RouteMap / RouteThumbnail / MetricSummary
wall → FootprintWall → WallCard → RouteThumbnail
public activity / shared → PublicActivityPage → MetricSummary
```

## 4. 视觉语言与 Token 现状

### 4.1 颜色与主题

`app.css` 已有语义变量，Tailwind `@theme inline` 将部分变量映射为工具类。**应继续以这些变量为唯一颜色来源，不做第二套 `--ds-*` 色板。** `.sport-theme` 覆盖部分根变量，深色选择器同时覆盖根与运动壳层；只看 `:root` 会读错实际页面值。

| 含义 | 当前浅色（运动壳层） | 当前深色 | 既有变量 |
| --- | --- | --- | --- |
| 页面背景 | `#f6f7f4` | `#101a16` | `--background` |
| 内容表面 | `#ffffff` | `#1b2922` | `--surface` |
| 正文 / 次级文字 | `#202d23` / `#5c695e` | `#e4eee7` / `#b1c3b6` | `--foreground` / `--muted-foreground` |
| 主操作 / 主操作文字 | `#17745c` / 白 | `#77d4ac` / `#10251b` | `--primary` / `--primary-foreground` |
| 边框 | `#e0e6da` | `#405348` | `--border` |
| 导航表面 | `#218538` | `#173c2b` | `--sport-sidebar` |
| 页头 / 页头文字 | `#f5c519` / `#20332b` | `#58471e` / `#ffe9a5` | `--sport-yellow` / `--sport-heading-ink` |
| 错误 | `#a52b32` | `#ffadb1` | `--error` 及 soft/border |
| 成功 | `#176448` | `#9fe1b6` | `--success` 及 soft/border |
| 警告 | `#805412` | `#f5d391` | `--warning` 及 soft/border |

还存在 `--sport-green/blue/coral/yellow-accent/ink` 指标装饰色、`--calendar-0..4`、`--chart-series`、省份与轨迹缩略图颜色。装饰色、状态色和数据色不能互换；热图色阶对应记录数，不应因为统一主色而改成单色。

主题链路已现场复核：`app.html` 首屏读取本机 `runnote-theme` → 根元素 `data-theme` / `data-theme-preference` → `initializeTheme()` 同步系统与 storage → `watchSystemTheme()` 通知 canvas/WebGL。支持手动浅深色、恢复自动及跨标签页同步；不能按旧文档将它收回为仅系统模式。

### 4.2 字体、排版和图标

- 系统字体栈 `--font-body`，没有扫描到额外字体下载或 `@font-face`。中文与拉丁文字延续现有系统字体。
- 已有 `--text-body: 1rem`、`--text-small: .8125rem`、`--text-title: clamp(1.75rem, 2.5vw, 2.25rem)`。实际运动页头另用 `clamp(1.75rem, 3vw, 2.5rem)`，详情 hero 也有自己的字号。
- 正文行高 1.65，h1 为 1.25、字距 -.035em、字重 650；运动页头 750。h2/h3 行高 1.4；局部仍使用 .75/.8/.8125/.875/.9375rem 及 550/600/650/700/750，未形成完整语义排版层级。
- 指标使用 `font-variant-numeric: tabular-nums`，突出距离/次数，单位随数值展示；缺失值是 `—`，不是 0。
- 导航、ThemeToggle、DatePicker、MetricSummary 使用内联 SVG（常见 20/24/26px，线宽 1.7/1.8/2）。仪表盘、目标、入口仍使用 `↗ ▦ ◷ ♨ ✦` 等 Unicode；盒子居中不保证不同字体下光学居中。先登记图标语义、尺寸与容器，再按明确问题逐个处理，不能全量替换品牌装饰。

### 4.3 间距、尺寸和圆角

- 已有间距 4/8/12/16/24/32/48px：`--space-1/2/3/4/6/8/12`。多处局部 `1rem/1.5rem/.75rem` 是同值重复，可渐进引用既有变量；`.7rem/1.15rem/1.4rem` 等可能是已确认的光学校准，不能直接四舍五入。
- `--content-width: 86rem`、`--sidebar-width: 15rem`，内容水平 padding 使用 clamp；`.aux-panel` 与 `.dashboard-card` 都承担内容表面。
- `--radius-control: .75rem`、`--radius-card: 1.5rem`、`--radius-pill: 9999px`；玻璃控件再通过 `--radius-glass-control/panel` 映射。实际主要/次要按钮最终多为胶囊，不能仅按基础规则记录为 12px。
- 常用按钮、输入和原生增强控件目标高度 2.75rem（44px）。生成的 select 箭头与地图缩放各有 32px 几何，日历密集数据点更小；这些不是可直接批量改成 44px 的通用按钮。

### 4.4 表面、阴影、透明度与动效

- 内容卡片通常是表面色 + 1px 边框 + 24px 圆角，页面背景低对比。普通卡片不需要额外增加玻璃效果。
- `liquid-glass.css` 负责材质、fallback 与独立光学/染色/阴影层；`liquid-glass-controls.css` 负责导航指示器、select、range、popover 和目标按钮几何；`liquid-glass.ts` 客户端动态增强实际原生控件，使用 MutationObserver 等管理生命周期。
- `--glass-*` 已区分 surface、hover、edge、sheen、rim、shadow 等。默认参数来自 `liquid-glass-settings.ts`，开发调节持久化仅在 DEV 生效。不要把这些可调引擎参数再复制成另一套 CSS 配置。
- 实际折射能力依浏览器而异：引擎说明为 Chrome 背景折射、其他引擎磨砂回退；底纹副本仅用于明确标记的开发预览，不复制私人 DOM 或地图。
- 阴影“颜色”已令牌化，但完整阴影表达式分散在材质 CSS、DatePicker、ActivityExplorer 和 tuner；DatePicker 的 `#1e302b26`、对话框 `rgb(0 0 0 / .5)` 等尚未语义化。
- 已有 `--transition-control: 150ms ease`。另有淡入 180ms、popover/箭头 200–220ms、菜单 320ms、目标与主题按钮 360–420ms、当前导航进入 420ms；JS spring 与 Svelte easing 应保留其行为，不能强行全部改成 150ms。
- 已处理 `prefers-reduced-motion`；材质另处理 reduced-transparency、forced-colors。后续 Token 提炼要保留 CSS 与 JS 两侧的降级，不能只覆盖 CSS 动画。

### 4.5 响应式与层级

| 现有边界 | 用途 |
| --- | --- |
| 359px 以下 | 导航文案、数字字号等极窄屏调整 |
| 479px 以下 | 骨架密度、旧足迹墙/预览单列 |
| 639px 以下 / 640px 起 | 表单、指标、页头操作区与列表单列/多列 |
| 767px 以下 / 768px 起 | 仪表盘密度、地图高度、辅助提示与部分栅格 |
| 1023px 以下 / 1024px 起 | 移动导航/固定侧栏、路线浏览布局 |
| 1199px 以下 / 1200px 起 | 目标/省份卡片与活动详情的双列切换 |
| 桌面高度 ≤900px | 侧栏垂直空间调整，属于当前既有修改 |
| 足迹墙容器 24/36/48/72rem | 当前工作区密集墙的 2/3/4/6 列；以容器宽度决定，不能替换成视口断点 |

层级目前是裸值：skip link 100、导航进度 40、开发 tuner 50；玻璃局部层 -1/1/2/3/4/5。原生 `<dialog>.showModal()` 与 Popover 在浏览器 top layer，不能用全局 z-index 的大小推导遮盖关系。MapLibre 自有 stacking context 也需要单独验证。

## 5. 组件能力盘点与处理分类

分类：**A 直接复用；B 统一规范；C 有问题或风险但暂缓修改；D 真正缺失**。D 不等于必须新增，只有实际需求成立才实施。

| 审计项 | 已有实现 | 分类与建议 |
| --- | --- | --- |
| Button / IconButton | 原生 button/a、`.button-secondary`、Tailwind 主按钮、局部 `.save/.apply-button`、玻璃 action | B：先统一主操作样式入口；保留按钮/链接语义。按复用收益决定薄组件，不提前规定万能 polymorphic API |
| Input / Textarea / Select | 原生表单、全局 base；select 有渐进增强 | A/B：保留 required/min/max/label/bind/value/disabled；先规范字段容器与错误关联，不重写 select |
| Checkbox / Radio / Switch | 原生 checkbox/radio 主题规则，设置/选择栏有 checkbox；暂无独立 Switch | A/D：checkbox 可复用原生；不为完整名单将它改成开关；Radio 记录规范即可 |
| Badge / Tooltip | ActivityCard 可见性、详情 route-tag、省份标签；`title` 提示 | B/C：区分状态与装饰；title 不是完整可访问 Tooltip，新需求出现再评估 |
| Skeleton / Spinner | PageSkeleton、FeedbackState loading、导航进度 | A：不新建三个同义 LoadingState；局部骨架扩展须先有用例 |
| Card / Panel | `.aux-panel`、`.dashboard-card`、多种局部业务卡片 | A/B：首先复用现有表面；需要可组合容器时再提炼一个最小 Panel，不强行合并所有卡片 |
| Divider / Stack / Grid / Container / Section | 原生 section、border、grid/flex、page-content、aux-stack | A：工具类/共享类已足够，无需逐个包装 Svelte 组件 |
| PageHeader | title、description、actions snippet | A：直接沿用；特殊详情 hero 保留 |
| Dialog | 活动列表的编辑/批量删除、ActivityActions 单条删除，均原生 dialog | B：重复表面/焦点规则可收敛；业务保存、删除和重试留在原调用方 |
| Drawer | 移动导航为文档流展开，并非模态 Drawer | D（暂不做）：不改变当前交互模型 |
| Dropdown / Popover | 既有 select 增强、DatePicker 的原生 Popover API | A/C：直接复用，有跨浏览器和无障碍验证债务；不要另写通用菜单引擎 |
| Tabs | 足迹模式是 aria-pressed 按钮组 | B：记录“模式切换”模式；不添加 role=tab 却缺少面板/键盘协议 |
| Toast | 页面内 FeedbackState 与 status/alert | D（暂不做）：保存结果留在上下文，不引入通知总线 |
| Pagination | 活动、日历当天记录、公开列表、AI 历史、足迹墙、热图等局部实现 | B：候选纯呈现组件，接收 offset/limit/total/busy；不统一业务分页大小或接管请求 |
| DataTable | 图表/热图/facts 等原生 table 与局部 overflow 容器 | A/D：先规范 caption/th/scope/溢出；没有排序筛选表格需求，不建通用 DataTable 引擎 |
| StatCard | MetricSummary，多调用方；仪表盘年度指标为局部 dl | A/B：复用 MetricSummary；年度摘要有独立 4 列与图标比例，迁移前比较真实布局 |
| EmptyState / ErrorState / LoadingState | FeedbackState 四种 kind，含 children snippet；PageSkeleton | A：已有统一能力，文档使用既有命名 |
| ChartContainer | TrendChart 含加载、主题更新与完整表格；RouteMap/FootprintMap 为业务组件 | A/D：先写组合规则；不存在多个通用图表需求，不创建空壳 ChartContainer |
| FilterBar / SearchToolbar | dashboard 工具栏、ActivityExplorer 分类、AI 日期范围 | B/D：筛选模式已有；没有统一搜索需求，不新增输入框和后端搜索 |
| FormSection / DetailPanel / SettingsGroup / DashboardSection | aux-panel、表单标题、详情 workspace 与 dashboard-card | B：先形成 Pattern 与 snippet 组合示例，重复稳定后再抽组件 |

业务专用组件保留：AuthForm、ActivityCard/Editor/Actions、MifitnessImport、RunningGoal、GoalOverview、ActivityExplorer、FootprintWall、WallCard、RouteThumbnail、RouteMap、FootprintMap、ProvinceMap、CalendarGrid、TrendChart、DeviceMetrics、AnalysisFacts、SharePanel、PublicActivityPage。可复用不等于基础 UI；其中的归属、数据加载、日期、公开范围不能下沉到通用控件。

## 6. 不一致、重复与优先级

| 编号 | 证据与影响 | 建议处理 |
| --- | --- | --- |
| UI-01 | `components/ui/README.md` 推荐 `bg-white` 卡片；当前主题需要 `var(--surface)`。`@theme inline` 有 `--color-card`，没有 `--color-surface`，因此不能假设 `bg-surface` 已有效 | B，优先修正文档并补同源映射；不批量替换页面 |
| UI-02 | 按钮同时用 `button.bg-primary`、`.button-secondary`、局部 `.button-primary/.save/.apply-button`；玻璃代码依赖这些选择器 | B，统一入口前先列出材质识别契约；仅改类名可能丢失材质或重复描画 |
| UI-03 | CSS 存在 base、运动壳层、深色、非 layer 状态规则、材质 `!important` 与 scoped style 多层覆盖 | B/C，先文档化最终样式及优先级，避免一次重排 CSS；重复本身不证明视觉错误 |
| UI-04 | 列表与详情删除 dialog 的 padding/radius/backdrop 相似，宽度却有 34rem 与 28rem 等差别 | B，可共享容器规则并保留尺寸变体，不合并删除事务 |
| UI-05 | 阴影几何、排版角色、动效、断点、层级未形成完整语义登记 | B，以等值引用渐进补齐；JS 引擎常量不为凑 Token 而外提 |
| UI-06 | Unicode 指标图标与 SVG 混用 | C，登记平台字体差异；无明确缺陷时保留，不进行全站图标换肤 |
| UI-07 | 热图图例色值在 footprints 页面，地图着色也存在独立数据色定义；新增 footprint-colors/display 是已有未提交工作 | C，须先核对当前变更，分清热图计数色与轨迹区分色；不得统一成错误的同一色板 |
| UI-08 | 当前 UI 测试有截图留证，但扫描 `frontend/tests/ui` 未发现 `toHaveScreenshot` 基线断言 | D，缺少稳定的自动视觉差异检测；截图生成不能当作视觉回归通过 |
| UI-09 | LiquidGlassTuner 为开发材质预览，没有全组件变体、状态、Pattern 总览 | D，新增独立 showcase，复用组件而不是复制调节器或安装新框架 |
| UI-10 | Chrome 是现有 UI 默认浏览器；Popover、嵌套 listbox、折射 fallback、强制色有兼容性边界 | C，保留现有实现，实施时补有针对性的兼容与键盘验证，不宣称跨浏览器合规 |
| UI-11 | AI 与公开成功态依赖 spec 级 page.route；基础合成 API 不覆盖全部接口；足迹墙审计中有夹具/契约调整 | C，showcase 采用静态合成展示数据；业务回归使用相应夹具，不能从壳层测试推断成功态 |
| UI-12 | `replaceState` 产生 SvelteKit 弃用提示 | C，非本轮设计体系阻塞项，保留现有 URL 状态行为，不顺手改路由逻辑 |

## 7. 已有 UI Patterns

下表是提炼结果，后续 `patterns.md` 应展开为带代码片段的正式规范。反例是未来实现禁止的偏离，不代表现有页面全部存在这些问题。

| 模式 / 适用场景 | 布局与组件组合 | 交互规则 | 反例 |
| --- | --- | --- | --- |
| 仪表盘 / 个人运动总览 | PageHeader → 累计与年度 dl → 目标/省份 → 功能入口 → ActivityExplorer → 日历/趋势 | 每区独立 loading/error/retry；日历年份不改变累计省份；保留 URL 选择 | 将所有内容改为密集管理后台表格，或一个失败隐藏全部模块 |
| 列表、筛选 / 管理与浏览记录 | 页头操作 → 导入/筛选 → 状态 → 卡片列表 → 分页；展示墙可采用容器栅格 | 不隐藏未保存导入草稿；筛选与翻页保留既有范围，批量选择仅本页 | 为统一 toolbar 增加不存在的搜索接口；卡片链接内嵌按钮 |
| 详情 / 活动指标与路线 | 返回链接 → 黄色业务 hero → 管理区 → 指标/路线 workspace → 设备/质量/足迹/分享 | 地图失败不隐藏指标，删除需确认；大屏左右布局、小屏纵向 | 用通用 Panel 接管活动读取/删除，或公开详情直接复用私人整页 |
| 创建、编辑 / 导入与资料修改 | 原生 form → label/input + help → 可选 details → 操作区 → FeedbackState | busy 防重复提交；失败保留草稿；字段错误关联输入；Dialog 关闭恢复焦点 | 保存失败清空输入；只靠颜色提示错误；Button 自己发业务请求 |
| 设置 / 资料与公开范围 | PageHeader → 账户只读 aux-panel → 分组表单 → 保存结果 | 清楚区分当前编辑值与已保存状态；公开设置沿用既有提示 | 用普通外观 Switch 偷换公开范围含义，或修改后自动保存 |
| 图表与分析 / 日历、趋势、AI、地图 | 标题/筛选 → 图表或地图 → 完整表格/统计说明 → 独立降级提示 | 服务端聚合权威；canvas 主题订阅与清理；底图可关闭，AI 生成明确确认 | 前端重算权威配速；主题切换重建地图；展示例子发真实供应商请求 |
| 状态 / 空、载入、失败、成功 | 页面级 PageSkeleton；区块级 FeedbackState；局部 status/alert | 明确初次加载/刷新旧数据/可重试失败；`—` 表缺失；401 清除私人状态 | 空数据画成错误；未知指标显示 0；读失败重试再次发删除请求 |
| 响应式 / 私人和公共壳层 | 桌面侧栏、手机展开导航；公共顶部导航；内容 min-width:0；局部表格滚动 | 保留 DOM 阅读顺序、Escape/焦点、44px 常用控件与密集数据例外；小屏操作换行 | 页面级横向溢出、全局 overflow:hidden 掩盖问题、手机菜单强改模态 Drawer |

## 8. 可访问性与对比度

已有保障：全局 2px focus-visible + 3px offset，skip link，导航 aria-current/expanded，反馈 alert/status，数字缺失说明，地图区域名称，图表表格兜底，dialog 标题/描述及焦点恢复，DatePicker 方向键/Home/End/PageUp/PageDown 与 Escape。

本次按 WCAG 相对亮度公式计算**不透明 Token 色对**：浅色正文/表面 14.37:1、次级文字/表面 5.77:1、白字/绿色导航 4.69:1、页头文字/黄色 8.21:1；深色正文/表面 12.75:1、次级文字/表面 8.18:1、页头 7.47:1。样本色对满足普通正文 4.5:1 目标；这不是全站 WCAG 认证。

玻璃最终合成背景、hover/disabled、数据色、焦点图形仍需在实际材质和状态下检查。密集日历小目标需按间距和适用例外评估，不把所有小尺寸直接判定不合格，也不盲目扩大后破坏全年密度。未运行屏幕阅读器或完整无障碍自动扫描。

## 9. 本次验证与使用方式

阅读顺序：本审计 → [设计提案](../superpowers/specs/2026-10-16-ui-design-system-design.md) → [分阶段计划](../superpowers/plans/2026-10-16-ui-design-system.md)。本轮未生成正式 `README.md/components.md/patterns.md/tokens.md`，避免将未确认方案伪装成生效规范。

### 实际执行

| 检查 | 当前结果与范围 |
| --- | --- |
| 源码、引用、样式与测试配置扫描 | PASS；13 页面/28 组件清点，含主题、玻璃适配、公开壳层和已有测试 |
| `cd frontend && pnpm check` | PASS；`svelte-check found 0 errors and 0 warnings` |
| 下方 Chrome 壳层基线命令（frontend 下） | PASS；3 passed (12.3s)，真实 Chrome + 合成 API，无数据库；覆盖 320/390/768/1024/1440px 壳层 |
| 浏览器人工视觉核对（Codex 内置浏览器，合成 API 8191 + Vite 5191） | 已目视 1440×1000 仪表盘浅深色、390×844 仪表盘/设置/AI 日期浮层；390px 列表/足迹墙/足迹/AI 壳层无页面横向溢出；设置另检查 320/768/1024px |
| 手工键盘与状态 | 手机菜单 Escape 后焦点回“打开导航”；日期 Popover Escape 后回触发器；390px 日历浮层宽 320px、左右边界在视口内；手动浅深色完成后恢复 system |

```bash
node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts ui-shell.spec.ts --grep 'desktop sidebar|mobile menu supports keyboard|all P0 route shells'
```

基础合成 API 的 AI/公开接口 404、早先足迹墙契约不匹配已明确观察；它们只提供了错误态/壳层证据，**没有证明这些业务成功态**。Chrome 测试仍输出现有 `replace_state_deprecated` 与环境颜色警告。

本地证据（不进入仓库，均为合成数据）：

- [浅色仪表盘](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-audit-dashboard-light.jpg)
- [深色仪表盘](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-audit-dashboard-dark.jpg)
- [手机仪表盘](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-audit-dashboard-mobile.jpg)
- [手机日期浮层](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-audit-datepicker-mobile.jpg)
- [浏览器观察记录](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-audit-observations.json)

### 未运行 / 尚未确认

NOT VERIFIED：完整前端单元/UI 回归、生产构建、后端测试、真实数据库 E2E、真实 AI 供应商、公开成功态、非空活动/地图/图表全状态、Safari/Firefox、屏幕阅读器、正式视觉快照对比。由于仅新增文档，不将这些未运行项记为失败，也不宣称已建立完整 Design System。

Playwright CLI 包解析因 registry DNS 不可用，手工浏览器核对改用已有内置浏览器；自动基线测试使用仓库已安装 Playwright，无新增依赖。初次本地端口受沙箱限制，允许本地监听后启动成功；没有涉及数据库。

## 10. 接口、隐私与未受影响部分

本轮新增文档不改变接口、数据计算、鉴权、CSRF、SSR 代理白名单、主题持久化、地图/图表生命周期、现有交互或响应式规则。不读取 `.env` 等密钥，不导入真实 GPX/TCX，不调用供应商，不执行迁移、提交、推送或部署。已有 5183/8001 服务保持运行；本轮启动的 5191/8191 合成服务与临时浏览器页在核对结束后关闭。外部并行修改的行为不属于本轮交付承诺。
