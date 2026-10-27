# UI 页面模式

先按最相似的现有页面组合组件，再决定是否需要新抽象。以下是现有规则的规范化，不授权重写业务页面。组件与 Token 详见 [components](components.md)、[tokens](tokens.md)。

## 1. 仪表盘

适用：个人跑步总览。参考 [dashboard](../../frontend/src/routes/dashboard/+page.svelte)。结构：PageHeader → 累计/年度指标 dl → GoalOverview 与 ProvinceMap → RecordsBanner（个人记录横幅）→ ActivityExplorer → CalendarGrid/TrendChart。数据汇总里的“概览条”（年度指标、个人记录横幅）统一为同一种写法：一张平面卡片 + 等宽列 + 列间 `--border` 发丝线，运动色只出现在圆形徽章上；不要在卡片里再嵌带底色的块，也不要把一排指标拆成各自带边框的小卡片。各页面入口只在侧栏与手机菜单出现，数据汇总不再重复一组“功能入口”卡片。目标卡（年度/月度/周目标与连续记录）在桌面上等宽等高，进度与对比贴卡底，卡下不再加口径小字（口径统一放在页尾“统计口径与数据质量”）。“运动趋势”与个人记录的月度图同一种图表语言（`trend-chart.ts` 复用 `records-chart.ts` 的高亮规则）：小号说明 + 标题，周期与指标用分段按钮，图表不画网格线和数值轴，柱子圆角、最高一期全色并标数值，配速为反向纵轴的折线，下方 `<details>` 完整数据表。

每区独立 loading/error/retry，保留已成功内容；年份只影响对应统计，不能重置累计省份。保留 URL 选中项与页面位置。摘要用彩色指标锚点和表面卡片，不把所有信息压成后台表格。

反例：一个接口失败隐藏整页；把全站新布局从另一个 UI 库的 dashboard 模板复制过来；筛选年份时丢失目标草稿。

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

适用：账户资料、公开范围、站点与用户管理。参考 [settings](../../frontend/src/routes/settings/+page.svelte)、[site](../../frontend/src/routes/settings/site/+page.svelte)、[用户管理](../../frontend/src/routes/admin/users/+page.svelte)。结构：根布局渲染的 PageHeader（黄色页头，底部为玻璃分段标签）→ 页面内容。

页面级模式/排序切换（`/footprints` 的地图模式、`/routes` 的排序）沿用同一外观：在页面自己的 `PageHeader` 的 `footer` 插槽里放 `.settings-tabs` 按钮组（`role="group"`、中文 `aria-label`、`aria-pressed`），不再在页面内自写 `.mode-switch` 样式。按钮版标签不会被全局按钮材质涂上白底（由 `liquid-glass.css` 的 `:where(:not(.settings-tabs > button))` 排除保证）；增强器不可用时选中项回落为主色填充，不会留下无底色的白字。表格工具栏里的列表筛选（如用户管理）仍用 `.compact-switch`。

- **账户设置**：顶部身份卡（头像、昵称、用户名、邮箱/时区/主页标签）→ 两列 `.settings-grid`（个人资料、公开个人主页含开关）→ 账户安全（修改密码默认折叠）。
- **站点设置**：左列站点文字与“默认外观”卡片选项，右列吸顶的实时预览与图标上传；手机上纵排。
- **用户管理**：一行工具栏（搜索、状态分段、总数）→ 紧凑表格（首字母头像、两个开关、行内小按钮）→ 分页与折叠说明。
- **保存方式**：有草稿的设置用 SaveBar，只在有改动时出现；需要立即生效的布尔值（登录启用、公开展示）用开关直接写入并就地更新这一行，不重新读取整张表。外观是本机即时偏好，不能因此把公开设置改成自动保存。
- **切换**：设置分区之间切换保留页头与标签栏，不显示骨架屏；读取提示延迟 250ms 才出现，且只在还没有任何数据时显示；筛选或翻页读取期间不要禁用整张表的按钮，否则每个按钮都会闪一次。
- **解释性文字**：长说明折叠进 `details`，不要在页面顶部堆提示条。

反例：整页重读来更新一行开关；每次保存都弹确认再关闭；在表格里同时保留“启用/禁用”按钮和开关；为统一表单外观把只读账户信息做成可编辑 input。

## 6. 图表与数据分析

适用：趋势、日历、地图、AI 汇总。参考 [TrendChart](../../frontend/src/lib/components/TrendChart.svelte)、[RouteMap](../../frontend/src/lib/components/RouteMap.svelte)、[footprints](../../frontend/src/routes/footprints/+page.svelte)、[AI](../../frontend/src/routes/ai/+page.svelte)。结构：标题与范围 → 图表/地图 → 完整数据表或统计说明 → 独立降级提示。

聚合指标以服务端为准。canvas/WebGL 只在 onMount 动态导入，watchSystemTheme 更新 paint/option 并清理订阅；切换外观保留选择、相机与实例。地图底图可关，失败不阻断本地轨迹；数据表 details 提供无图形兜底。AI 生成是显式动作，展示不发供应商请求。

个人记录页 [/records](../../frontend/src/routes/records/+page.svelte) 是“先讲人话，再给数字”的样本：PageHeader → RecordsBanner（hero）→ 一句无边框总结（今年里程与去年同期，数字取服务端 `yearly`）→ 月度卡片（标题右侧 `.settings-tabs` 按钮组切换里程/配速，图表去掉网格线与纵轴，只给最大月份或最快月份标数值，其余柱为 `--primary` 的柔和透明度）→ 逐年回顾与训练规律两张卡并排（每张卡不足 28rem（按该行自身宽度）时上下堆叠）。逐年横条与周点、周内小柱都是页面私有的 CSS 图形，用 `--primary` 的 `color-mix` 档位表达强弱，进行中的年份用同色斜纹，正负变化用文字与符号表达。连续卡片不超过三层，每个图形下都有 `<details>` 数据表。

反例：浏览器重算权威距离/配速；主题切换重建地图；用空数据/错误截图冒充非空图表成功；把真实轨迹放进 fixture。

## 7. 加载、空、错误与成功

适用：所有异步区域。结构：页面初次加载用 PageSkeleton，区块用 FeedbackState，局部保存用现有 status/alert。明确区分初次加载、保留旧数据刷新、可重试失败与真正无数据。

error 为 alert，其他状态 polite；文本与图形共同表意。缺失 `—`，有效零值 0；未知数据不是空集合。组件清理保留 disposed/请求令牌，401 清除私人状态并跳登录。重试按钮重试同一种安全业务动作，写失败不能无提示重复写。

反例：空数据渲染为异常；每次刷新骨架覆盖可用数据；把 missing 变成 0；反馈只有颜色，没有文本。

## 8. 桌面与移动适配

适用：所有私人/公开页面。参考 [app.css](../../frontend/src/app.css)、[AppNavigation](../../frontend/src/lib/components/AppNavigation.svelte)。桌面固定侧栏，1024px 以下使用文档流菜单；公开页面独立顶部导航。内容和栅格项 min-width:0，动作可换行，表格只在局部滚动。

验证 320/390/768/1024/1440px、关键断点两侧与桌面低高度；长中文、长数值不溢出。保留 DOM 阅读顺序、skip link、Escape/焦点恢复及常用 44px 目标；密集日历按间距和适用例外评估。足迹墙按容器查询，不能仅看 viewport。

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
