# 公共组件与复用目录

源码位于 `frontend/src/lib/components/`；保留原路径，不另建平行导出层。组件 API 使用 Svelte 5 `$props`、Snippet 和 `onselect/onedit/ondelete` 回调风格。样式入口是 `app.css`、组件 scoped style 及既有材质 action。

## A：直接复用

| 实现 | 实际 API / 默认值 | 状态、语义与消费者 |
| --- | --- | --- |
| [PageHeader](../../frontend/src/lib/components/PageHeader.svelte) | `title:string`；`description?:string`；`actions?:Snippet` | 输出 h1；无动作时不创建空容器。运动壳层黄色背景；640px 以下动作全宽。dashboard/activities/settings/AI 等使用；详情 hero 保持独立 |
| [FeedbackState](../../frontend/src/lib/components/FeedbackState.svelte) | `kind?:'loading'\|'success'\|'error'\|'empty'`，默认 empty；`title:string`；`children?:Snippet` | error 为 alert/assertive，其余 status/polite；图标 aria-hidden。重试按钮由调用方提供；不能让组件猜测业务请求 |
| [PageSkeleton](../../frontend/src/lib/components/PageSkeleton.svelte) | `title?:string`，默认“正在加载页面…” | status/polite/aria-busy，装饰骨架 aria-hidden；reduced-motion 停止呼吸动画。用于初次页面加载，刷新保留旧内容时不强制替换 |
| [MetricSummary](../../frontend/src/lib/components/MetricSummary.svelte) | `items:{label:string,value:string,testId?:string,icon?:…}[]`；`compact=false`；`appearance='sport'`（可选 default）；`stacked=false` | dl/dt/dd，value 已格式化；不计算指标。`—` 附缺失说明。compact 无卡片外框；stacked 作用于 sport。ActivityCard、详情、公开详情复用 |
| [DatePicker](../../frontend/src/lib/components/DatePicker.svelte) | `label:string`；`value=$bindable('')`；`min='1900-01-01'`；`max='2100-12-31'`；`timezone='UTC'`；`required=false`；`disabled=false`；`granularity='date'|'month'`；`onselect?(value)` | 原生 date/month + Popover；month 模式值为 `YYYY-MM`，3×4 月份格、年份选择与上/下一年，方向键按月/行，Home/End 行首尾，PageUp/Down 按年，底部清除/本月，label/controls/expanded/dialog。方向键按日/周，Home/End 按周，PageUp/Down 按月，Enter 选择，Escape 回触发器。AI 日期范围、分享图统计月份使用；日期解释与验证仍由领域调用方负责 |
| [TimePicker](../../frontend/src/lib/components/TimePicker.svelte) | `label:string`；`value=$bindable('')`（`HH:mm`）；`max=''`（`HH:mm`，其后的时间置灰不可选）；`now=''`（“现在”按钮用）；`required=false`；`disabled=false`；`onselect?(value)` | 与 DatePicker 同一套：输入框是纯文本的 24 小时输入（键入数字时自动补冒号，不用浏览器自带的时间框——各浏览器样子不同，Firefox 还会多出自己的时钟图标；可直接键入、读屏），时钟按钮打开 Popover（**纯色实底、不用玻璃材质**；弹出/收回动效照搬日历弹层、定位复用 `popover-motion`，面板里的按钮都带 `data-date` 不被液态玻璃接管）。弹层里上方是大号的当前时间，下面“时/分”两列滚轮：选中的时间固定在每列正中间（一条主色的横带），列表在它下面上下滚动，**滚到哪一项就选中哪一项**（滚动中实时更新、停下后吸附到整行；比 `max` 晚的项置灰，滚过头会退回到允许的最晚时间），也可以点某一项让它滑到中间；底部“现在/完成”，没有额外的提示小字；选项带 `data-date` 以免液态玻璃洗掉填充；上下键逐项、PageUp/Down 跳 5、Home/End 首尾，Esc 关闭回触发器。身心健康里的服药时间使用（日期固定为所在日，只选时间）；时区与“不能晚于现在”的业务判断仍由调用方负责 |
| [ThemeToggle](../../frontend/src/lib/components/ThemeToggle.svelte) | `compact=false` | 挂载前禁用，手动浅深色与“自动”；恢复自动把焦点留在切换按钮。偏好仅本机；不接受服务器用户主题配置 |
| [ImageUpload](../../frontend/src/lib/components/ImageUpload.svelte) | `label:string`；`src:string\|null`；`fallback:string`；`shape?:'circle'\|'square'`（默认 square）；`busy=false`；`error=''`；`hint=''`；`onselect(file)`；`onremove()` | 头像/站内标志/浏览器图标上传。原生 file input + label；accept 仅 png/jpeg/webp；预览失败回退字符；移除/恢复默认按钮；错误 role=alert；busy 禁用；挂载前禁用，隐藏 input 获得焦点时在 label 显示焦点环。设置页（账户、站点）消费，校验与裁剪由服务端负责 |

`SettingsTabs`（`current:'account'|'site'`）用于账户设置与站点设置之间的分区切换，遵循“模式切换用链接组 + `aria-current`，不加 `role=tab`”；站点设置链接仅管理员可见，固定指向 `/settings/site`，账户链接随工作区上下文。

MetricSummary 的 icon 枚举：`distance/duration/elapsed/pace/count/days/heart/calories/steps`。默认项图形为路线；compact 不绘图标。不要将未格式化秒数、米或 nullable 值直接传入 value。

```svelte
<script lang="ts">
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  let { onretry }: { onretry: () => void } = $props();
</script>

<PageHeader title="训练记录" description="浏览已导入的记录">
  {#snippet actions()}<a class="button-secondary" href="/activities">管理记录</a>{/snippet}
</PageHeader>
<MetricSummary items={[{ label: '距离', value: '0.00 km', icon: 'distance' }, { label: '配速', value: '—', icon: 'pace' }]} />
<FeedbackState kind="error" title="读取失败">
  <button type="button" class="button-secondary" onclick={onretry}>重试</button>
</FeedbackState>
```

这里的重试必须是读取操作；删除/付费生成不能复用普通读失败重试。

## 个人记录横幅 RecordsBanner

[RecordsBanner](../../frontend/src/lib/components/RecordsBanner.svelte) 是页面的“主角”横幅：整行宽，一张与数据汇总其它卡片同款的平面卡片，内部三列——5K 最佳、10K 最佳、跑步总览——每列一个圆形运动色徽章、一个大数字加几句人话，不做成表格。它只负责呈现，所有数字来自服务端 `personal_bests` 与 `totals`；取数、加载与失败由调用方负责（数据汇总用 [RecordsBannerLoader](../../frontend/src/lib/components/RecordsBannerLoader.svelte)）。

| 项 | 契约 |
| --- | --- |
| API | `bests: CategoryBest[]`（固定 5km、10km 两项）；`totals: Totals`；`variant?: 'compact' \| 'hero'`，默认 compact；`href?: string`，有值时标题行右侧出现玻璃胶囊“查看全部 →”（`a.button-secondary`，由根 liquidGlass 增强；无障碍名称“查看全部个人记录”）；`year?: number`，当前年份，记录日期不在这一年时才带出年份 |
| 外框 | `<section aria-labelledby>` 指向自身标题（`$props.id()` 生成，页面上多个横幅互不冲突）：与 `.dashboard-card` 相同的 `--surface` 底、`--border` 描边、`--radius-card`、`--space-6` 内边距；标题沿用“弱色 eyebrow（`--text-caption`）+ `--text-section` 标题”的写法，不加图标 |
| 分栏 | 三列等宽，列间只画 `--border` 发丝线，不再嵌套带底色的块（避免卡片套卡片）。每列的运动色只出现在左上角 2.5rem 圆形徽章上（`--sport-green`、`--sport-blue`、`--sport-yellow-accent`，与年度指标卡的图标同款），徽章内为“5K”“10K”“累计”，文字 `--sport-ink` |
| 数字 | 大数字用 `--text-stat`（hero 用 `--text-display`），`--foreground`；单位、标签与说明为 `--muted-foreground`；进步线与“比第一次快了…”用 `--primary`，首次点空心、最佳点实心。没有渐变、水印或背景涂鸦，装饰完全交给版式和留白 |
| 5K / 10K | 圆形徽章（“5K”“10K”）+ 弱色“最佳配速”→ 配速大数字（`--text-stat` 粗体等宽；hero `--text-display`；手机 `--text-title`）→ 弱色人话两行（“3 月 5 日，5.0 km，用了 27:30”“共跑过 4 次 5K 级”）→ 进步轨道与“比第一次快了 42 秒 / km”。配速是服务端的 `avg_pace_seconds_per_km`，前端不计算
| 进步轨道 | 仅当 `first` 与 `pace_gain_seconds_per_km` 都有时出现：`--border` 底轨 + `--primary` 圆头实线；首次为空心点，最佳为实心点加柔和外圈。长度为 `progressSpan × 16rem`（`pace_gain / first.pace`，提升 25% 即满长，下限 20%），并限制在 10rem 到栏宽之间。纯表现，不产生新指标；`role="img"` + 中文 `aria-label`（“首次配速 6:12，最佳配速 5:30，快了 42 秒每公里”） |
| 总览 | 标签“累计 · 全部里程”→ 累计里程大数字 + `km` → “共 44 次 · 42 个活动日”“从 2025 年 1 月开始”“平均配速 5:47 /km”（无可靠配速时省略）。三栏时数字在上、事实沉到底部并以一条发丝线分隔，与旁边较高的 5K/10K 平衡；宽度不足 54rem 时变为 5K/10K 下方的整行横条，事实连成一行；手机上收为两行 |
| 空状态 | 徽章变为 `--tone` 描边的空心圆，标签为“等你来跑”，大数字位置为“还没有 5K 记录”（`--text-card`），下方“跑一次 4.0–7.5 km 的整次跑步，就会出现在这里”（按逗号分成两个不拆开的短语，避免中文在词中间折行）；总览无活动时为“还没有跑步记录 / 第一次跑步之后，这里会开始累计你的里程”。三块始终存在。只有一次合格记录时提示“再跑一次 5K，就能和这次比一比”；最快仍是第一次时提示“最快的一次仍是第一次” |
| 布局 | 容器查询（按横幅自身宽度）：≥54rem 三列等宽等高、列间发丝线；36–54rem 两列并排 + 总览横条（上方发丝线）；<36rem 三段堆叠，段间发丝线 |
| 动效 | 最终值是默认状态：SSR、无 JS、`prefers-reduced-motion: reduce`、无 IntersectionObserver、打印（`beforeprint` 立即结束，`@media print` 取消轨道动画）以及动画以外的任何时刻都显示服务端数值。横幅任意部分进入视口（threshold 0；挂载时已在视口内则在首帧前开始）才播放一次：配速从首次配速数到最佳、累计里程从 0 数到总数、轨道从左向右画出、最佳点最后出现（约 1.1s，ease-out）；1.6s 兜底计时器保证后台标签页暂停 rAF 时也不会停在中间值。读屏始终读 `sr-only` 中的最终值，动画数字 `aria-hidden` |
| 对比度 | 正文、标签均落在 `--surface` 上，沿用全站令牌的对比度；徽章 `--sport-ink` 在三种运动色上 ≥4.9:1（琥珀 6.75） |
| hero | 用于 `/records` 顶部：标题改为“最佳成绩”，大数字升为 `--text-display`，其余与 compact 相同 |
| 测试标识 | `records-banner`、`records-banner-5km`、`records-banner-10km`、`records-banner-total`、`records-banner-gain-5km` / `-10km`；Loader 的占位与错误为 `records-banner-slot`；播放中根元素带 `play` 类。合成 UI：`tests/ui/records-banner.spec.ts`；showcase 变体：`tests/ui/design-system.spec.ts`（`playwright.design-system.config.ts`） |

RecordsBannerLoader：`onMount` 读取 `readRecords()`，保留 `disposed` 与请求令牌；加载中显示与横幅同框、近似同高的 `FeedbackState kind="loading"`（桌面 18rem、手机 34rem；与横幅同为 `--surface` 外框）防止下方跳动；失败时在横幅位置显示 `FeedbackState kind="error"`（“个人记录暂时读不到”+ 原因 + 重试），其余数据汇总内容不受影响；401 清空并跳转 `/admin?reason=expired&next=%2Fdashboard`。

独立展示见 showcase 的“个人记录横幅”区块（两项都有、仅 5K 且 10K 只跑过一次、还没有任何跑步、hero、手机宽度）。

## 原生控件与共享类

| 审计范围 | 当前入口 | 必须保留的契约 |
| --- | --- | --- |
| Button / IconButton | 原生 button；主操作 `bg-primary text-primary-foreground`；次操作 `.button-secondary`；危险确认已有 `.delete-confirm` | 显式 type；导航用 a；异步禁用/aria-busy 由调用方管理；图标按钮有中文名称；不嵌套交互元素 |
| Input / Textarea / Select | 原生元素 + `.text-field`（`app.css`，36px 高、`--radius-field`、主色聚焦环；设置页、站点设置、用户管理已采用，其余页面仍用 base + 工具类） | label、help/error 的 ID 关联、required/min/max/disabled；失败保留输入；单选 select 可被 action 增强，保留原生值与 change |
| File picker | `.file-pick`（`app.css`）：label 包裹视觉隐藏的原生 `input[type=file]`，子元素 `.file-pick-text/title/hint/tag`；`data-filled`、`data-dragging` 控制已选/拖入态 | 保留原生 input、label 名称与 `name`；选中后显示文件名、大小与识别出的格式；拖放由调用方处理（写入 `input.files` 后走同一 change 逻辑）；禁用时整体降为 50%；焦点环由 `:has(input:focus-visible)` 绘制。活动导入与 MifitnessImport 使用 |
| Checkbox / Radio | 原生 input，primary accent；单选组也可做成整卡可点的选项（站点设置“默认外观”：`.theme-tile`，原生 radio 透明铺满整卡） | 可见 label；同组 radio 使用共同 name 与 fieldset/legend；布尔值不自动等价于 Switch，见下文“开关” |
| Skeleton / Spinner | PageSkeleton / FeedbackState loading / 导航进度 | 避免重复同义组件；明确页面与区块加载范围 |
| Card / Panel | `.aux-panel`、`.dashboard-card`、设置页的 `.settings-block` / `.identity-card` 与业务专用卡片 | 不按名字合并布局；普通表面不自动玻璃化 |
| Stack / Grid / Container / Section / Divider | `.aux-stack`、`.page-content`、原生 section、grid/flex、border | 使用语义区域/标题与 min-width:0；无需一个类包装一个 Svelte 组件 |
| Dialog / Popover / Dropdown | 原生 dialog；DatePicker Popover；select 增强 | dialog 标题/描述、Escape、取消、焦点恢复、失败留草稿；top layer 不靠 z-index；不要复制菜单引擎 |
| Tabs / 分段控件 | 设置分区用 `.settings-tabs`（链接，`aria-current="page"`）；页面级的模式/排序切换（个人足迹的轨迹/热力图、常跑路线的排序）同样放进 `PageHeader` 的 `footer` 插槽，容器写 `<div class="settings-tabs" role="group" aria-label="…">`，子项为 `type="button"` + `aria-pressed`；表格工具栏内的列表筛选用 `.mode-switch.compact-switch`（按钮，`aria-pressed`）；两者共用玻璃指示器，见下文“玻璃分段” | 没有 tabpanel 与方向键协议时不能加 role=tab；当前项靠 aria-current / aria-pressed 表达，不靠颜色 |
| Pagination | 页面局部实现（用户管理用 `.user-pager` + `.button-compact`） | 保留 limit/offset/total、pending 和既有分页大小；页空后回退属于业务；不在通用控件内 fetch |
| DataTable | 原生 table + 局部 overflow；图表 details 数据兜底 | caption/列头/scope、缺失值；横向滚动只限容器 |

## 设置页与开关相关组件

以下为设置、站点与用户管理三页重复出现后沉淀的共享件，实现与验收见 [63-settings-ui-refresh](../63-settings-ui-refresh.md)。独立展示见 showcase 的“开关、分段与紧凑文本框”区块。

| 名称 | 入口 | 契约 |
| --- | --- | --- |
| SaveBar 玻璃态 | `SaveBar` 的可选 `glass` 属性（默认关闭，仅身心健康页使用；设置页等保持原样） | 栏悬浮在其容器之上、覆盖着下方内容时挂 `attachMenuGlass`（与玻璃菜单同一配方：Chromium 折射、WebKit 静态边缘、Firefox 模糊）；容器已滚到底、栏停在自然位置时为无模糊无阴影的普通卡片。栏保持纤细并靠右；页面可用 `--save-min` 给它一个最小宽度（身心健康页设为一列小组件的宽度，与最后一列左右对齐，放不下时按内容收缩）；手机上占满宽度。判断依据是容器底边是否仍低于视口粘性线，随滚动、缩放和容器尺寸变化重新计算；降低透明度与强制色下不挂玻璃。根元素带 `data-glass="floating"\|"docked"` 供测试 |
| 身心健康小组件 | `WellbeingTile`（外框：卡片、3rem 实色圆形图标、名称、可选 `actions`/`dashed`/`span`）、`WellbeingDial`（270° 圆形拨盘，隐藏的原生 range 承担键盘与读屏，旋钮用 `liquid-glass-knob.ts`，点中间数值弹出小输入框）、`WellbeingScale`、`WellbeingSleep`（双圆环：外圈小时、内圈分钟）；“今天吃的药”是同一外框里的单个组件（`WellbeingDayEditor`） | 一行三个（≥900px），窄屏两个/一个；每个小组件一种色（`--well-*`，`wellbeing-tones.ts`）与图标，名称下不放小字；未填写显示实色空环与 `—`，不是半透明；列表型小组件的添加/编辑用原生 dialog（`.dose-dialog`，样式随组件，沿用用户管理对话框的外观），不在卡片里展开，也不另开整行表单；弹窗里选择项用 `aria-pressed` 的 chip，选中态用描边加浅底（全局玻璃按钮材质会冲淡实心填充）；药物页每种药是一个同款小组件，`WellbeingStockRing` 用圆环显示剩余药量（占一盒或一个月用量的比例，圆心写数字，不足一周变警示色），弹窗外壳统一为 `WellbeingDialog`；趋势里的“副作用”小组件（`WellbeingSideEffects`，网格里的一格）左边是所选范围（7/14/30 天）的日历、右边写那天的内容，日期用历史日历的小圆环（`data-date` 保持不被玻璃增强）；仅身心健康页使用 |
| 玻璃滑块 | `span.rn-slider > input[type="range"]`（`liquid-glass-controls.css`）；`liquid-glass-slider.ts` 的 `enhanceSlider` 由根 `liquidGlass` action 自动增强（`LiquidGlassTuner` 使用） | 输入必须有可读名称（`aria-label`）；原生 range 保留在下层承担键盘与读屏，装饰层（轨道、玻璃滑块、焦点环）`aria-hidden`；滑块 36×24，按下放大带弹簧，高度 2.75rem；代码改值后装饰层不会自动跟随，需派发 `change` 事件（`WellbeingScale` 的做法，且只监听 `input` 以免回写）；“未填写”这类没有默认值的答案用外层 `.rn-slider` 变淡表达，不要把中间位置当成答案 |
| 开关 | `button.rn-switch[role="switch"]` + `.rn-switch-track` / `.rn-switch-static`（`liquid-glass-controls.css`）；`liquid-glass-switch.ts` 的 `enhanceSwitch` 由根 `liquidGlass` action 自动增强 | 必须有 `aria-checked` 与可读名称（`aria-label` 或 `aria-labelledby`）；锁定态用原生 `disabled` 并在名称里说明原因；几何为上游 LgSwitch：轨道 64×28、滑块 36×24，按下放大并带弹簧拉伸；玻璃配方独立为 `switchOptics`（折射 0.43 倍、色散不低于 0.12），不随意改全局配方；`prefers-reduced-transparency`/强制色下回退静态滑块；开关表示“立即生效”的布尔值，需要草稿加保存的设置不要用立即写入 |
| 玻璃分段 | `.settings-tabs`、`.compact-switch` 容器内的直接子 `a` / `button`；`enhanceSegmented`（`liquid-glass-indicator.ts`，`createIndicator` 的水平模式）自动增强 | 当前项只用 `aria-current="page"` 或 `aria-pressed="true"` 表达；玻璃块跟随指针/焦点，离开后回到当前项，点击后留在被点项直到页面或状态更新；其内部不得再套 `.rn-glass-control`，因此 `.compact-switch > button` 已从按钮增强选择器中排除；`.settings-tabs > button` 同样不增强为 `.rn-glass-control`；它不受全局按钮材质影响，靠的是 `liquid-glass.css` 里零特异性的 `:where(:not(.settings-tabs > button))` 排除（覆盖阴影/过渡、预增强渐变、降低透明度与强制颜色下的 `background-color` 与 `background-image`、悬停底色，而不是靠未分层的特异性或引入顺序）；`liquid-glass-controls.css` 中让标签透明的 `!important` 规则只在容器带 `.rn-liquid-navigation` 时生效，所以增强器关闭（降低透明度、首屏尚未增强、模块加载失败）时按钮回落到 `app.css` 的主色填充（`--primary` 底、`--primary-foreground` 字）；样式必须写在未分层的 `liquid-glass-controls.css`，不要放进 `@layer components`。标签按钮高度为 2.5rem（40px），与既有设置页标签一致，是有意的紧凑点击区，小于旧足迹切换的 2.75rem |
| 设置页头 | 根 `routes/+layout.svelte` 渲染一份 `PageHeader`（含 `footer` 插槽里的 `SettingsTabs`），覆盖 `/settings`、`/settings/site`、`/admin/users` 与 `/workspace/settings` | 页头与标签栏在这几页之间切换时不重建；各页面不再自带 `PageHeader`；页头动作由页面通过 `useSettingsHeader()`（`lib/settings-header.svelte.ts`）登记，离开时清理；设置分区之间切换不显示骨架屏、不淡入（`quiet-swap`） |
| SaveBar | `lib/components/SaveBar.svelte`：`form`、`dirty`、`busy`、`message`、`error`、`label`、`busyLabel`、`ondiscard` | 悬浮保存条，仅在有未保存更改、保存中或有结果/错误时出现，用 `unfoldBar` 展开收起；提交按钮用 `type="submit"` 加 `form` 属性关联表单；`message` 由调用方 6 秒后清除；状态文字是 `role="status"`，错误是 `FeedbackState` 的 alert |
| `.text-field` | `app.css`（components 层）；token `--radius-field` | 36px 高，聚焦为主色边框加 3px 光晕，`aria-invalid="true"` 变错误色；textarea 最小 5.5rem、仅纵向拉伸；设置页、站点设置、用户管理已采用 |
| `.button-compact` | `.button-secondary.button-compact` | 32px 高、13px 字，用于表格行与分页，不替代主操作按钮 |
| 展开动效 | `lib/styles/reveal-from-left.ts`：`revealFromLeft`、`unfoldBar` | `revealFromLeft` 让相邻按钮从左侧按钮后滑出（可传 `delay`，节点加 `data-reveal` 以便找到锚点）；`unfoldBar` 让条形区域连同高度、边距、透明度一起展开，避免下方内容跳动；均在“减少动态效果”时为 0 时长 |
| ImageUpload `size` | `size="lg"` | 圆形头像预览放大到 6rem；默认 `md` 不变 |

设置页布局类：`.settings-stack`、`.settings-grid`（桌面两列）、`.settings-block`（卡片内标题、`.block-hint`、`.block-field`、`.block-title-row`、`.block-details`、`.status-badge`）、`.identity-card`（身份卡）、站点设置的 `.site-layout`（左表单、右吸顶预览与图标）与 `.site-preview`、`.theme-tile`。用户管理工具栏类：`.user-toolbar`、`.toolbar-search`、`.toolbar-count`、`.user-pager`、`.user-cell` / `.user-avatar`。它们都只用语义令牌，不新增颜色。

字段建议组合如下（原生能力，无新增 FormField 组件）：

```svelte
<div class="grid gap-2">
  <label for="training-name">训练名称</label>
  <input id="training-name" class="border border-border px-3 py-2"
    aria-describedby="training-help" required />
  <p id="training-help" class="text-muted-foreground">失败时保留输入内容。</p>
</div>
```

只有错误存在时设置 aria-invalid，并将错误 ID 加入 describedby；不要把长帮助文字包进 label 改变控件名称。增强 select 也采用独立 `label for`，避免动态插入的箭头按钮进入同一个 label。

## 材质 action 的调用契约

根布局已调用 [liquidGlass](../../frontend/src/lib/styles/liquid-glass.ts)。独立展示在根 `.sport-theme` 调用一次；嵌套组件不要再增强一次。保留 `.button-primary`、`button.bg-primary`、`.save`、`.apply-button`、`.delete-confirm`、`.mode-switch button[aria-pressed]` 等识别规则。危险按钮用现有危险确认语义；红色文字示例本身不承担真实删除。

动态增强不能移动 Svelte 拥有的标签/图标 DOM，不能复制私人 DOM；action 负责清理 observer、监听器与光学实例。无折射能力或偏好减少透明度时保留可操作的原生语义与回退。参数调试继续用现有 LiquidGlassTuner，不另写参数系统。

## 业务组件保留原职责

| 实现组 | 保留理由 |
| --- | --- |
| AppNavigation / AuthForm / RunningGoal / GoalOverview | 路由、账户、授权、持久化与目标读取；不属于无副作用 primitive |
| ActivityCard / ActivityEditor / ActivityActions / MifitnessImport | 活动管理、事务、CSRF、时间与导入状态 |
| ActivityExplorer / FootprintWall / WallCard / CalendarGrid | 活动筛选、分页、日历与展示墙；保留 URL、选择和容器布局 |
| RouteThumbnail / RouteMap / FootprintMap / ProvinceMap / TrendChart | 数据、地图/图表生命周期及隐私；主题只更新实例，不重建 |
| DeviceMetrics / AnalysisFacts / SharePanel / PublicActivityPage | 领域指标、公开白名单和分享边界 |
| RoutePosterDialog | 足迹墙领域操作，仅登录者查看本人数据时渲染（工作区、站主看根展示、本人具名展示），数据固定走需认证的本人接口；打开即显示标注“示例”的合成样例（不可保存），自动读取本人数据并按页面会话缓存，切换样式/外观仅本地重绘：全部/月份范围、经典足迹/极简画廊/运动海报/足迹手账四种带足迹海报与大字里程/跑步票根/半马勋章/动感斜纹四种不含轨迹的纯数字海报（分组展示）、跟随网站/日间/夜间图片外观（隐藏的 `data-poster-theme` 探针读取固定主题Token，不切换页面主题）、预览、PNG下载和可选系统文件分享；原生radio与SVG构图示意，切换仅重绘同一抽样，生成/分享期间禁用；复用当前主题Token，不作为通用Dialog；与 ActivityPosterDialog 共用 `.poster-dialog`（`app.css`）：对话框不超过视口（`dvh`，`vh` 兜底），标题与“关闭”固定，宽屏左右两列各自滚动、预览按可用高度缩小保持 9:16，保存/分享按钮在选项列底部 sticky 常驻；宽度<720px 或高度≤500px（横屏手机）堆叠，仅内容区整体滚动、标题仍固定；`@layer components` 中的 `app.css` 规则会输给组件自带的未分层 CSS，故堆叠时的 padding 与 `grid-template-columns` 写在各对话框自己的媒体查询里 |

详情足迹导航使用 `ActivityWallPreview`，复用 `WallCard` 的 `compact/onselect/selected/interactive` 选项与 `onauthrequired` 回调。简介作为区块页头（标题与说明在左、“查看全部足迹”在右），牌堆占满整宽。卡片宽12rem（窄容器10rem、极窄9rem），排成“扇形手牌”：浏览中心为抽出的牌，位置最高、原尺寸、不旋转；两侧按距离逐级下沉、每级缩小4%并向外旋转3.5°，浏览时由共享索引弹簧连续驱动，形成抽牌起落；间距保证每张侧牌中心不被悬停放大后的中心牌遮挡，宽屏最多7张，窄容器减少侧卡，首尾不循环。浏览卡片的日期带星期（`2026.10.04 周六`），默认标题 `跑步 · 日期` 只显示“跑步”以免与日期重复，缩略图为 3:2 且不显示水印；用时与配速合为一行不换行（`19:26 · 6:29 /km`），“用时/配速”标签保留为 `sr-only`，缺失值同样保留该行；堆叠网格拉伸为等高卡片，避免混合数据使选中卡片变矮。布局留出侧卡可点击中心，稳定窗口前后各1张缓冲，动画保留已读路径，结束后最多11张。只有浏览中心拥有明显的倾斜（约±11°/13°）、品牌色高光、视差与轻微浮起；指针事件挂在不随倾斜变形的卡位上，边缘悬停不会抖动；`selected`/`aria-pressed`仍表示当前实际详情记录，`centered`独立控制中央指针反馈。卡片保持实色表面，不使用玻璃卡片增强。触屏关闭倾斜，减少动态效果立即定位。

鼠标主键横拖、触屏横滑、触控板连续横滑和方向键只改变浏览窗口，不切换详情、URL、指标或大地图。点击卡片或两侧箭头才确认整条记录（原生按钮支持Enter/Space），保留来源返回状态。横向wheel每累计48px继续浏览，单事件/长拖动最多4格；组件按当前容量限制单次及在途位移，合并最新浏览意图并串行完成，纵向滚动保持原生。列表每次最多20条摘要，LRU最多3页60条，跨页按需补充，可继续浏览全部历史。限制针对列表返回量与摘要缓存，不代表SQL次数或路线请求数。侧卡路线缩略图仍进入视口自动加载，完整详情与大路线仅在确认记录后读取。确认切换时详情页不重建：读取期间页头与指标区降为60%不透明度，提交后黄色页头与面板外框保持不动，仅文字与数值以 `--motion-reveal` 淡入上浮；大地图保留同一 MapLibre 实例，新路线读取期间旧路线降透明度并居中提示“正在读取路线…”，到达后原地 `setData` 并以280ms取景过渡（减少动态效果时立即定位）；只有编辑操作区按记录重建以重置编辑状态。详见[最新验收与历史变更](../53-footprint-coverflow.md)。

这些可在业务内复用，但不直接挂到独立 fixture 中调用真实 API。图表要有中文区域名、就绪标识和完整表格兜底；地图底图失败不得阻断本地轨迹。

## B/C/D：规范、暂缓与缺失

Button 入口、字段组、dialog 表面和分页为阶段 4 候选；先证明至少两个用途与行为一致，再决定用共享类还是最小组件。首批不搬迁现有组件、不改业务消费者。

Badge 有可见性/标签等局部形式，暂不统一状态与装饰。`title` 不是可访问 Tooltip；真正出现复杂提示需求时先评估成熟无障碍基础设施。Toast、Drawer、通用 DataTable/ChartContainer、SearchToolbar 等无当前必需用例，不为齐名单实现。移动导航保持原文档流，不能擅自换成模态 Drawer。

## 展示与验证

所有 A 类纯组件的实际组合见 `frontend/tests/fixtures/ui-showcase/Showcase.svelte`。新增通用能力同时补示例、键盘/状态验证与必要视觉基线。依赖业务的消费者用现有合成 API spec；详细运行结果见 [验收](../50-ui-design-system.md)。

## 底图选择

所有按钮来源 Popover（增强 select、DatePicker、BasemapPicker）复用 `styles/popover-motion.ts`。显示前调用 `preparePopoverMotion`，定位完成后调用 `positionPopoverMotion`，传入触发控件矩形及面板最终 left/top；尺寸使用 offsetWidth/offsetHeight，不读取动画后的面板矩形。共享 CSS 从触发控件尺寸展开并收回，自动翻到上方或贴边时仍沿实际来源运动。原生关闭及键盘/焦点逻辑由消费者保留，reduced-motion 立即切换；通用能力展示见独立 showcase，验证命令 `pnpm exec playwright test --config playwright.popover-motion.config.ts`。

`BasemapPicker` 用于 RouteMap/FootprintMap 的重复底图选择，接受 `preference: auto|positron|dark|liberty`、`style`、`status`，可选 `onselect` 默认保存本机偏好。右上角入口复用 button-secondary，Popover 复用 rn-glass-menu / rn-menu-option、createGlass 与 createIndicator，不把每个选项增强成独立玻璃按钮。保留原生 Tab、Enter、Escape 与外点关闭、选择后焦点恢复；小屏浮层按视口定位。showcase 传纯本地回调，不访问地图或存储。

地图覆盖控件的容器标记 `data-glass-stable`：共享 glass action 保留已有 SVG atlas/裁剪，用同一弹簧缩放已存在的材质表面，避免在 WebGL 背景上按压时逐帧替换 backdrop-filter 地址。按钮原生点击区域与文字不缩放；普通按钮继续使用原来的光学形变。该标记只作用于按钮增强，不改变菜单浮层或地图渲染。

跨浏览器玻璃：`.history-card` 与 `.wall-card` 这类大卡片不加 `backdrop-filter`。Chromium 仍用 `backdrop-filter: url()` 折射。WebKit 只给主按钮留一层模糊，其余控件用 `.rn-glass-static` / `.rn-static-glass`（半透明底色加 inset 高光）。Firefox 保留原来的 `backdrop-filter` 模糊回退。导航选中胶囊在 WebKit 上用裁切后的底色，不用 `filter: url()`。弹窗打开锁定页面滚动；菜单在视口高度变化时重新定位，只有宽度变化才关闭。触屏（`(hover: none) and (pointer: coarse)`）保留原生 select。不支持 `overflow-clip-margin` 时装饰层改为 `overflow: visible`。支持基线为 iOS 17+；没有 `showPopover` 时日期和底图退回原生控件。
