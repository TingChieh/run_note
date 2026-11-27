# UI 页面模式

先按最相似的现有页面组合组件，再决定是否需要新抽象。Editorial Receipt 的页面骨架与场景分级见 [brand.md §2、§4](brand.md#2-场景分级)。以下是现有规则的规范化，不授权重写业务页面。组件与 Token 详见 [components](components.md)、[tokens](tokens.md)。

## 1. 仪表盘

适用：个人跑步总览（Editorial Receipt 档案页，第 1 阶段已迁移）。参考 [dashboard](../../frontend/src/routes/dashboard/+page.svelte)。结构：`.editorial-page` → PageHeader（紧凑黄色色带；`meta` 写年份与“截至 MM.DD”，右侧连体年份步进器）→ `.milestone-section`：年度距离主数字（`--text-period-hero`）+ 三个竖发丝线分隔的辅助数字 + 累计一行，其下 GoalOverview 压成一条四栏 → 运动趋势（`.underline-tabs`、`TrendChart appearance="receipt"`）与 `ProvinceMap appearance="ledger"`（≥1024px 7:5 并排）→ 运动日历（<768px 隐藏）→ RecordsBanner → ActivityExplorer → 统计口径 details。主区块（里程碑、趋势、地理）用 2px 节线，其余 1px 发丝线；区块间 48px，不用卡片、彩色图标或阴影。手机上同一 DOM 顺序即使用顺序：年度数字 → 目标进度 → 趋势 → 地图 → 记录 → 浏览。

每区独立 loading/error/retry，保留已成功内容；年份只影响对应统计，不能重置累计省份。保留 URL 选中项与页面位置；年度数字与趋势区预留高度，数据到达时下方区块不跳动。

反例：一个接口失败隐藏整页；把全站新布局从另一个 UI 库的 dashboard 模板复制过来；筛选年份时丢失目标草稿；为了“丰富”给指标加彩色圆形图标或把一组指标拆成小卡片。

## 2. 列表、筛选与浏览

适用：记录管理、活动浏览、画廊。参考 [activities](../../frontend/src/routes/activities/+page.svelte)、[ActivityExplorer](../../frontend/src/lib/components/ActivityExplorer.svelte)、[FootprintWall](../../frontend/src/lib/components/FootprintWall.svelte)。结构：页头操作 → 导入/筛选 → 局部反馈 → 卡片集合 → 分页。展示墙按容器可用宽度排布。

筛选、分页保留既有 limit/offset 与范围；批量选择仅本页，异步动作期间禁用重复操作。筛选变化明确清理不再适用的选择；导入未提交草稿不因普通读取刷新丢失。搜索只在已有业务支持时增加；不要为展示组件新增搜索接口。

反例：卡片整体链接内嵌编辑/删除按钮；一页选择扩展成未加载的“全部”；请求竞争用旧响应覆盖新筛选。

## 3. 详情

适用：单条活动。参考 [activity detail](../../frontend/src/routes/activities/[id]/+page.svelte)、[PublicActivityPage](../../frontend/src/lib/components/PublicActivityPage.svelte)。结构：返回入口 → 黄色业务 hero → 管理区 → MetricSummary/RouteMap workspace → 设备、质量、足迹和分享模块。

宽屏指标/路线分区，小屏按阅读顺序纵排；地图降级时指标保持可读。删除使用原生 dialog，确认、取消、失败重试与焦点回退沿用业务实现。公开详情只接白名单公开数据，不复制私人整页或管理操作。

反例：让通用 Panel 拉取或删除活动；把详情 hero 强制换成 PageHeader；为地图跳转构造包含真实轨迹坐标的外部 URL。

## 4. 创建与编辑表单

适用：导入、活动编辑、资料和日期范围。参考 [ActivityEditor](../../frontend/src/lib/components/ActivityEditor.svelte)、[AI 页面](../../frontend/src/routes/ai/+page.svelte)。结构：语义 form → label/控件/help/error → 可选 details → 操作 → FeedbackState。

busy 时防重复提交，失败保留草稿，字段错误与输入关联。写入前后端均校验；DatePicker 只选择日期，业务仍决定时区与范围含义。普通按钮显式 type=button，提交按钮 type=submit。dialog 关闭恢复触发焦点；成功后的草稿处理由业务决定。

反例：只用红色说明失败；保存失败清空字段；按钮组件内部发业务请求；把 AI 生成重试当作无成本的读取重试。

## 5. 设置分组

适用：账户资料、跑鞋、目标与隐私、站点与用户管理。参考 [settings](../../frontend/src/routes/settings/+page.svelte)、[shoes](../../frontend/src/routes/settings/shoes/+page.svelte)、[preferences](../../frontend/src/routes/settings/preferences/+page.svelte)、[site](../../frontend/src/routes/settings/site/+page.svelte)、[用户管理](../../frontend/src/routes/admin/users/+page.svelte)。结构：根布局渲染的 PageHeader（黄色页头，底部为玻璃分段标签）→ 页面内容。

页面级模式/排序切换（`/footprints` 的地图模式、`/routes` 的排序）沿用同一外观：在页面自己的 `PageHeader` 的 `footer` 插槽里放 `.settings-tabs` 按钮组（`role="group"`、中文 `aria-label`、`aria-pressed`），不再在页面内自写 `.mode-switch` 样式。按钮版标签不会被全局按钮材质涂上白底（由 `liquid-glass.css` 的 `:where(:not(.settings-tabs > button))` 排除保证）；增强器不可用时选中项回落为主色填充，不会留下无底色的白字。表格工具栏里的列表筛选（如用户管理）仍用 `.compact-switch`。

- **账户总览**（`/settings`）：顶部身份卡（头像、昵称、用户名、邮箱/时区/主页标签）→ 个人管理摘要条（`.settings-hub-strip`，独立加载跑鞋提醒数、周/月/年跑量目标、公开与功能状态，单项失败不阻塞资料编辑，一键跳转对应分区）→ 个人资料与用户名卡片 → 账户安全（修改密码默认折叠）。
- **跑鞋**（`/settings/shoes`）：全宽 3:7 列表/详情体验，页头动作区放“添加跑鞋”，退役前弹出原生 `<dialog>` 确认；活动详情仍保留轻量跑鞋绑定入口并提供“管理跑鞋 →”跳转；旧路径 `/activities/shoes` 与 `/workspace/activities/shoes` 303 重定向至对应设置分区。
- **目标与隐私**（`/settings/preferences`）：周/月/年跑量目标统一编辑卡片 → 展示与隐私/功能开关（`个人完整展示` 只读状态 + `公开个人主页` / `身心健康` / `加入一起跑步` 经 SaveBar 保存）→ 数据与记录入口卡片（导入与管理跑步记录、开启身心健康时的身心健康就诊报告）。
- **站点设置**：左列站点文字与“默认外观”卡片选项，右列吸顶（≥1024px，停在固定顶部条下方 1rem）的实时预览与图标上传；预览是顶部导航条的缩略样（`--surface` 底、`--border` 边、`--sport-brand` Logo 方块、站点名与副标题）；手机上纵排。
- **用户管理**：一行工具栏（搜索、状态分段、总数）→ 紧凑表格（首字母头像、两个开关、行内小按钮）→ 分页与折叠说明。
- **保存方式**：有草稿的设置用 SaveBar，只在有改动时出现；需要立即生效的布尔值（登录启用、公开展示）用开关直接写入并就地更新这一行，不重新读取整张表。外观是本机即时偏好，不能因此把公开设置改成自动保存。
- **切换**：设置分区之间切换保留页头与标签栏，不显示骨架屏；读取提示延迟 250ms 才出现，且只在还没有任何数据时显示；筛选或翻页读取期间不要禁用整张表的按钮，否则每个按钮都会闪一次。
- **解释性文字**：长说明折叠进 `details`，不要在页面顶部堆提示条。

反例：整页重读来更新一行开关；每次保存都弹确认再关闭；在表格里同时保留“启用/禁用”按钮和开关；为统一表单外观把只读账户信息做成可编辑 input。

## 6. 图表与数据分析

适用：趋势、日历、地图、AI 汇总。参考 [TrendChart](../../frontend/src/lib/components/TrendChart.svelte)、[RouteMap](../../frontend/src/lib/components/RouteMap.svelte)、[footprints](../../frontend/src/routes/footprints/+page.svelte)、[AI](../../frontend/src/routes/ai/+page.svelte)。结构：标题与范围 → 图表/地图 → 完整数据表或统计说明 → 独立降级提示。

聚合指标以服务端为准。canvas/WebGL 只在 onMount 动态导入，watchSystemTheme 更新 paint/option 并清理订阅；切换外观保留选择、相机与实例。地图底图可关，失败不阻断本地轨迹；数据表 details 提供无图形兜底。AI 生成是显式动作，展示不发供应商请求。

跑步记录页 [/activities](../../frontend/src/routes/activities/+page.svelte)：PageHeader（右侧是整段时间的“生成分享图”，没有视图切换）→ 标题行（“我的活动（N）”，右侧“导入轨迹”与“编辑”）→ 折叠的导入区（GPX/TCX 与 Mi Fitness，高度动画展开/收起，收起时 `inert` 且不可见但仍挂载，所以选好的文件不丢；记录为空、导入进行中或有结果提示时自动展开）→ 列表。桌面（≥1024px）是左右两栏：左栏固定 26rem 的 `ActivityTimeline`，右栏 `ActivityPreview`；选中项写进地址 `?id=`（`replaceState`），上下方向键换选中项，Ctrl/Cmd/中键点击照常打开详情页；窄屏只有时间线，点击进入详情页。见 [82](../82-activity-timeline-preview.md)。

个人记录页 [/records](../../frontend/src/routes/records/+page.svelte) 是“先讲人话，再给数字”的样本：PageHeader → RecordsBanner（hero）→ 一句无边框总结（今年里程与去年同期，数字取服务端 `yearly`）→ 月度卡片（标题右侧 `.settings-tabs` 按钮组切换里程/配速，图表去掉网格线与纵轴，只给最大月份或最快月份标数值，其余柱为 `--primary` 的柔和透明度）→ 逐年回顾与训练规律两张卡并排（每张卡不足 28rem（按该行自身宽度）时上下堆叠）。逐年横条与周点、周内小柱都是页面私有的 CSS 图形，用 `--primary` 的 `color-mix` 档位表达强弱，进行中的年份用同色斜纹，正负变化用文字与符号表达。连续卡片不超过三层，每个图形下都有 `<details>` 数据表。

反例：浏览器重算权威距离/配速；主题切换重建地图；用空数据/错误截图冒充非空图表成功；把真实轨迹放进 fixture。

## 7. 加载、空、错误与成功

适用：所有异步区域。结构：页面初次加载用 PageSkeleton，区块用 FeedbackState，局部保存用现有 status/alert。明确区分初次加载、保留旧数据刷新、可重试失败与真正无数据。

error 为 alert，其他状态 polite；文本与图形共同表意。缺失 `—`，有效零值 0；未知数据不是空集合。组件清理保留 disposed/请求令牌，401 清除私人状态并跳登录。重试按钮重试同一种安全业务动作，写失败不能无提示重复写。

反例：空数据渲染为异常；每次刷新骨架覆盖可用数据；把 missing 变成 0；反馈只有颜色，没有文本。

## 8. 桌面与移动适配

适用：所有私人/公开页面。参考 [app.css](../../frontend/src/app.css)、[AppNavigation](../../frontend/src/lib/components/AppNavigation.svelte)。桌面（800px 起）为悬浮顶部条，800px 以下是顶部手机栏加底部标签栏 `今天 | 记录 | 开跑 | 探索 | 我的`（见 [components](components.md) 的“手机底部标签栏”）；公开页面独立顶部导航。外壳模式见下。内容和栅格项 min-width:0，动作可换行，表格只在局部滚动。

验证 320/390/768/1024/1440px、关键断点两侧与桌面低高度；长中文、长数值不溢出。保留 DOM 阅读顺序、skip link、Escape/焦点恢复及常用 44px 目标；密集日历按间距和适用例外评估。按容器查询的组件（如活动详情页的足迹卡片）不能仅看 viewport。

外壳模式（私人页面）：整页是“顶部条 + 内容区”，没有左侧栏，内容区宽度只受 `--content-width` 与页面水平 padding 限制，`.content-column` 的 `padding-top: 5rem` 为顶部条留位，`navigation-progress` 整宽。顶部条从左到右是 Logo 加站点名、导航项、账户区；账户区顺序固定为**进度环 → 主题切换（图标）→ 头像菜单**（进度环弹层放跑量目标，头像菜单放姓名与模式、设置、退出登录）。三档：≥1360px 图标加文字，800–1359px 只有图标，入口达到 9 个时所有桌面宽度都是图标版（`data-dense`）；每个图标项必须保留 `title` 与 `aria-label`，页面名称由页头标题呈现。页面滚动到内容经过条的下方时条进入 floating 玻璃态，其余时候是不透明卡片（见 [components](components.md) 的“顶部导航与锚定弹层”）。<800px 顶部只有手机栏（Logo、主题切换），一级导航在底部标签栏；进度环不在手机外壳里（目标在今天页与“目标与隐私”），身心健康、AI 助手与退出登录在“我的”（账户总览）底部的“更多”分组，个人足迹/常跑路线/个人记录/一起跑步由“探索”的分区标签切换。需要固定在底部的操作栏用 `--bottom-chrome` 避让标签栏与安全区。新增页面不要自带导航或固定在顶部的第二条栏；需要悬浮提示或操作栏时避开 `--top-navigation-height` 加上下间距，并确认 floating 态下文字不被条遮住。页面切换动画：≥800px 左右滑，方向由顶部条顺序决定；手机标签切换使用默认淡入。

滚动条：全站只有一套细滚动条（令牌 `--scrollbar-thumb`，见 [Tokens](tokens.md)），由 `app.css` 的 `@layer base` 统一提供，组件不要自己设置滚动条颜色或宽度；只有已有的内部横滑/滚轮控件（`.settings-tabs` 窄屏、`WellbeingReportTimeline` 月份翻页、`TimePicker` 滚轮）用 `scrollbar-width: none` 自行隐藏。内部滚动只在内容可能很长且容器高度确实要固定时才允许：数据表、地图/历史记录列表、批量导入失败清单、对话框与弹层（按视口限高）、固定尺寸的日详情面板。内容天然只有几条的列表（如“今天吃的药”）不设 `max-height` + `overflow` 做高度保护，让卡片随内容变高。不要把滚动容器当防御性上限；`overflow-y: auto` 会让 `overflow-x` 一并变成 auto，几像素的装饰溢出（液态玻璃按钮的玻璃层会超出按钮约 6px，最多 12px）就会冒出横向或纵向滚动条，需要让滚动容器自己留出内边距（用等量负外边距抵回）或约束宽度，而不是靠隐藏滚动条。需要横向滚动的表格与条带保留滚动，并用 `role="region"` 加中文 `aria-label`；不需要横向滚动的卡片及其所有祖先不得出现横向可滑动（触控板左右滑不能移动内容或带动页面）。

反例：用 body overflow:hidden 掩盖页面横溢；CSS 重排造成视觉/键盘顺序相反；把手机导航改成未确认的模态 Drawer；硬把密集日历全部放大导致全年视图失效。

## 组合起点

```svelte
<PageHeader title="页面标题" description="简明说明" />
<div class="aux-stack">
  <section class="aux-panel" aria-labelledby="section-title">
    <h2 id="section-title">区域标题</h2>
    <!-- 已有领域内容，或 FeedbackState；读取和状态仍留在调用方 -->
  </section>
</div>
```

DashboardSection/SettingsGroup/FormSection/DetailPanel 是组合角色，目前不需要四个万能包装组件。只有多个消费者的结构和行为长期相同，才进入有限试点。新增页面验收同时记录主题、窄屏、键盘、状态和实际接口边界；不能以截图漂亮代替功能验收。

## 进场与错峰动效

- 条件渲染的反馈条（`FeedbackState`）、批量工具栏、认证卡使用 `motion-enter` 进场；只做进场，不用 `transition:|global`，避免拖慢路由卸载。
- 列表、指标卡、表格行容器加 `.stagger`，子项按序号错峰淡入上移。
- 原生 `<dialog>` 用 `@starting-style` 加 `allow-discrete`（`overlay`、`display`）实现进出场与遮罩渐变。
- 所有动效在 `prefers-reduced-motion: reduce` 下关闭。

### 公开页面手机账户入口

正常渲染公开顶栏的路由为未登录的 `/admin`（登录页）、`/shared/[token]` 和 `/public/activities/[id]`；已登录的 `/admin` 与 `/p/[username]/*` 使用应用导航。手机上使用悬浮圆角顶栏，主题按钮旁的导航菜单提供“一起跑步”；未登录时另有“跑步记录”，已登录时提供“我的运动统计”和弱化显示的“退出登录”。桌面入口仍在顶栏，退出沿用布局的会话检查、错误提示与跳转逻辑。

已登录 `/admin` 复用 `app-shell`、`AppNavigation` 与标准内容宽度，菜单与数据汇总等页面一致；路径没有匹配项时不高亮任何导航。正文为 `PageHeader` → `aux-stack` → 带标题的 `aux-panel`，原有管理入口仅在卡片的响应式网格中呈现，不加入顶栏或菜单；账户身份与公开展示说明保留。
