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

## 原生控件与共享类

| 审计范围 | 当前入口 | 必须保留的契约 |
| --- | --- | --- |
| Button / IconButton | 原生 button；主操作 `bg-primary text-primary-foreground`；次操作 `.button-secondary`；危险确认已有 `.delete-confirm` | 显式 type；导航用 a；异步禁用/aria-busy 由调用方管理；图标按钮有中文名称；不嵌套交互元素 |
| Input / Textarea / Select | 原生元素 + base + border/padding 工具类 | label、help/error 的 ID 关联、required/min/max/disabled；失败保留输入；单选 select 可被 action 增强，保留原生值与 change |
| File picker | `.file-pick`（`app.css`）：label 包裹视觉隐藏的原生 `input[type=file]`，子元素 `.file-pick-text/title/hint/tag`；`data-filled`、`data-dragging` 控制已选/拖入态 | 保留原生 input、label 名称与 `name`；选中后显示文件名、大小与识别出的格式；拖放由调用方处理（写入 `input.files` 后走同一 change 逻辑）；禁用时整体降为 50%；焦点环由 `:has(input:focus-visible)` 绘制。活动导入与 MifitnessImport 使用 |
| Checkbox / Radio | 原生 input，primary accent | 可见 label；同组 radio 使用共同 name 与 fieldset/legend；布尔值不自动等价于 Switch |
| Skeleton / Spinner | PageSkeleton / FeedbackState loading / 导航进度 | 避免重复同义组件；明确页面与区块加载范围 |
| Card / Panel | `.aux-panel`、`.dashboard-card` 与业务专用卡片 | 不按名字合并布局；普通表面不自动玻璃化 |
| Stack / Grid / Container / Section / Divider | `.aux-stack`、`.page-content`、原生 section、grid/flex、border | 使用语义区域/标题与 min-width:0；无需一个类包装一个 Svelte 组件 |
| Dialog / Popover / Dropdown | 原生 dialog；DatePicker Popover；select 增强 | dialog 标题/描述、Escape、取消、焦点恢复、失败留草稿；top layer 不靠 z-index；不要复制菜单引擎 |
| Tabs | 当前模式切换使用按钮组 aria-pressed | 没有 tabpanel 与方向键协议时不能加 role=tab |
| Pagination | 页面局部实现 | 保留 limit/offset/total、pending 和既有分页大小；页空后回退属于业务；不在通用控件内 fetch |
| DataTable | 原生 table + 局部 overflow；图表 details 数据兜底 | caption/列头/scope、缺失值；横向滚动只限容器 |

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
| RoutePosterDialog | 足迹墙领域操作，仅登录者查看本人数据时渲染（工作区、站主看根展示、本人具名展示），数据固定走需认证的本人接口；打开即显示标注“示例”的合成样例（不可保存），自动读取本人数据并按页面会话缓存，切换样式/外观仅本地重绘：全部/月份范围、经典足迹/极简画廊/运动海报/足迹手账四种带足迹海报与大字里程/跑步票根/半马勋章/动感斜纹四种不含轨迹的纯数字海报（分组展示）、跟随网站/日间/夜间图片外观（隐藏的 `data-poster-theme` 探针读取固定主题Token，不切换页面主题）、预览、PNG下载和可选系统文件分享；原生radio与SVG构图示意，切换仅重绘同一抽样，生成/分享期间禁用；复用当前主题Token，不作为通用Dialog |

详情足迹导航使用 `ActivityWallPreview`，复用 `WallCard` 的 `compact/onselect/selected/interactive` 选项与 `onauthrequired` 回调。简介作为区块页头（标题与说明在左、“查看全部足迹”在右），牌堆占满整宽。卡片宽12rem（窄容器10rem、极窄9rem），排成“扇形手牌”：浏览中心为抽出的牌，位置最高、原尺寸、不旋转；两侧按距离逐级下沉、每级缩小4%并向外旋转3.5°，浏览时由共享索引弹簧连续驱动，形成抽牌起落；间距保证每张侧牌中心不被悬停放大后的中心牌遮挡，宽屏最多7张，窄容器减少侧卡，首尾不循环。浏览卡片的日期带星期（`2026.10.04 周六`），默认标题 `跑步 · 日期` 只显示“跑步”以免与日期重复，缩略图为 3:2 且不显示水印；用时与配速合为一行不换行（`19:26 · 6:29 /km`），“用时/配速”标签保留为 `sr-only`，缺失值同样保留该行；堆叠网格拉伸为等高卡片，避免混合数据使选中卡片变矮。布局留出侧卡可点击中心，稳定窗口前后各1张缓冲，动画保留已读路径，结束后最多11张。只有浏览中心拥有明显的倾斜（约±11°/13°）、品牌色高光、视差与轻微浮起；指针事件挂在不随倾斜变形的卡位上，边缘悬停不会抖动；`selected`/`aria-pressed`仍表示当前实际详情记录，`centered`独立控制中央指针反馈。卡片保持实色表面，不使用玻璃卡片增强。触屏关闭倾斜，减少动态效果立即定位。

鼠标主键横拖、触屏横滑、触控板连续横滑和方向键只改变浏览窗口，不切换详情、URL、指标或大地图。点击卡片或两侧箭头才确认整条记录（原生按钮支持Enter/Space），保留来源返回状态。横向wheel每累计48px继续浏览，单事件/长拖动最多4格；组件按当前容量限制单次及在途位移，合并最新浏览意图并串行完成，纵向滚动保持原生。列表每次最多20条摘要，LRU最多3页60条，跨页按需补充，可继续浏览全部历史。限制针对列表返回量与摘要缓存，不代表SQL次数或路线请求数。侧卡路线缩略图仍进入视口自动加载，完整详情与大路线仅在确认记录后读取。确认切换时详情页不重建：读取期间页头与指标区降为60%不透明度，提交后黄色页头与面板外框保持不动，仅文字与数值以 `--motion-reveal` 淡入上浮；大地图保留同一 MapLibre 实例，新路线读取期间旧路线降透明度并居中提示“正在读取路线…”，到达后原地 `setData` 并以280ms取景过渡（减少动态效果时立即定位）；只有编辑操作区按记录重建以重置编辑状态。详见[最新验收与历史变更](../53-footprint-coverflow.md)。

这些可在业务内复用，但不直接挂到独立 fixture 中调用真实 API。图表要有中文区域名、就绪标识和完整表格兜底；地图底图失败不得阻断本地轨迹。

## B/C/D：规范、暂缓与缺失

Button 入口、字段组、dialog 表面和分页为阶段 4 候选；先证明至少两个用途与行为一致，再决定用共享类还是最小组件。首批不搬迁现有组件、不改业务消费者。

Badge 有可见性/标签等局部形式，暂不统一状态与装饰。`title` 不是可访问 Tooltip；真正出现复杂提示需求时先评估成熟无障碍基础设施。Switch、Toast、Drawer、通用 DataTable/ChartContainer、SearchToolbar 等无当前必需用例，不为齐名单实现。移动导航保持原文档流，不能擅自换成模态 Drawer。

## 展示与验证

所有 A 类纯组件的实际组合见 `frontend/tests/fixtures/ui-showcase/Showcase.svelte`。新增通用能力同时补示例、键盘/状态验证与必要视觉基线。依赖业务的消费者用现有合成 API spec；详细运行结果见 [验收](../50-ui-design-system.md)。

## 底图选择

所有按钮来源 Popover（增强 select、DatePicker、BasemapPicker）复用 `styles/popover-motion.ts`。显示前调用 `preparePopoverMotion`，定位完成后调用 `positionPopoverMotion`，传入触发控件矩形及面板最终 left/top；尺寸使用 offsetWidth/offsetHeight，不读取动画后的面板矩形。共享 CSS 从触发控件尺寸展开并收回，自动翻到上方或贴边时仍沿实际来源运动。原生关闭及键盘/焦点逻辑由消费者保留，reduced-motion 立即切换；通用能力展示见独立 showcase，验证命令 `pnpm exec playwright test --config playwright.popover-motion.config.ts`。

`BasemapPicker` 用于 RouteMap/FootprintMap 的重复底图选择，接受 `preference: auto|positron|dark|liberty`、`style`、`status`，可选 `onselect` 默认保存本机偏好。右上角入口复用 button-secondary，Popover 复用 rn-glass-menu / rn-menu-option、createGlass 与 createIndicator，不把每个选项增强成独立玻璃按钮。保留原生 Tab、Enter、Escape 与外点关闭、选择后焦点恢复；小屏浮层按视口定位。showcase 传纯本地回调，不访问地图或存储。

地图覆盖控件的容器标记 `data-glass-stable`：共享 glass action 保留已有 SVG atlas/裁剪，用同一弹簧缩放已存在的材质表面，避免在 WebGL 背景上按压时逐帧替换 backdrop-filter 地址。按钮原生点击区域与文字不缩放；普通按钮继续使用原来的光学形变。该标记只作用于按钮增强，不改变菜单浮层或地图渲染。
