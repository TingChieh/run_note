# RunNote UI Design System 设计提案

日期：2026-10-16。状态：**用户已确认方案 B 的阶段 1–3，已实施；阶段 4 业务迁移未执行**。实际验收见 [记录](../../50-ui-design-system.md)。

事实依据：[UI 审计](../../design-system/ui-audit.md)。本提案将现有视觉变成可查找、可复用、可验证的规则，不重新选择品牌色、字体、主题或导航模型。

## 使用方式与方案选择

| 方案 | 收益 | 成本与边界 |
| --- | --- | --- |
| A：仅整理文档 | 运行时风险最低，适合作为当前第一阶段 | 重复样式和缺少视觉回归的问题仍在，不能作为全部任务的完成态 |
| **B：兼容现有实现，渐进补齐（推荐）** | 保留现有类名、组件与最终视觉；补令牌、隔离展示、有限试点、Agent 规则 | 每步都需基线比较；组件只按真实复用需求增加 |
| C：一次替换为新组件库/全站统一组件 API | 获得外部库的统一 API | 玻璃 action、全局选择器、原生控件与业务状态迁移面大；偏离本任务，不采用 |

已确认的第一实施批次仅包含正式规范、等值 Token 补齐与隔离展示。业务页面迁移是下一批次，须先检查该批具体 diff 与视觉差异。

## 1. 设计不变量

1. 保留绿色导航、黄色页头、暖灰背景、绿色系深色、彩色指标锚点、24px 卡片与胶囊控件。
2. 保留玻璃独立材质层、当前 spring/按压反馈及原生控件渐进增强；不重新实现折射引擎，不升级上游。
3. 保留私人/公开壳层隔离、详情专用 hero、地图底图降级、日历密度、图表数据兜底及主题切换时的实例/状态。
4. 通用组件只承担语义、布局、视觉和交互约定；业务读取、写入、授权、格式化与时间归属留在原层。
5. 未确认的视觉差异必须回到用户审阅，不能把快照更新当作修复。

## 2. Token 设计

继续以 `frontend/src/app.css` 的语义变量和 `@theme inline` 为源。保留全部现有名称与值；例如补 `--color-surface: var(--surface)` 映射，不新增独立色值，也不重命名已有 `--color-card`。

| 类别 | 处理方式 |
| --- | --- |
| Colors | 登记 root → sport-theme → dark 的实际覆盖；补已有变量缺失的 Tailwind 映射；状态成组记录 foreground/soft/border；数据色独立 |
| Typography | 从现有角色提取 caption/label/section-title/metric 等；分别保留页头与详情 hero 的 fluid 值；逐条说明等值来源 |
| Spacing | 先复用现有 space 系列；仅对跨组件稳定重复值补语义别名，光学校准局部值保留理由 |
| Radius | 保留 control/card/pill 和 glass aliases；允许缩略图、密集日历有用途明确的局部几何 |
| Shadows / Surfaces | 增加少量控件、浮层、遮罩角色；将完整阴影表达式与颜色分开登记；普通 Panel 不自动玻璃化 |
| Motion | 登记 control/fade/overlay/page-enter 的现有时长与曲线；CSS 可等值引用；JS spring/easing 不强制复制为 CSS Token |
| Breakpoints | 文档登记现有 360/480/640/768/1024/1200px 配对规则与高度条件；容器查询另列。CSS 自定义属性不能直接用于普通媒体查询，不写无效 `@media (min-width: var(...))` |
| Z-index | 导航进度、开发浮层、skip-link 的命名角色；玻璃局部层单独解释；dialog/popover 属 top layer，不通过增加 z-index 解决 |

第一批“补齐”只允许增加映射/等值引用，不修改原 Token 数值，不重排 CSS 优先级，不全站替换类名。任何新命名须在 `tokens.md` 标明“已有/新增别名/待迁移”，避免文档与运行时混淆。

## 3. 组件体系与 API

直接登记现有 PageHeader、FeedbackState、PageSkeleton、MetricSummary、DatePicker、ThemeToggle。保持现有 props/回调，Svelte 5 `$props` + Snippet，沿用 `onselect/onedit/ondelete`，不引入 dispatcher/store 或重复包装导出层。

Button、字段组、Panel、Dialog 表面、Pagination 是候选收敛项。第一批只统一文档和展示，第二批选择少量真实重复点再确定是否新增 `.svelte`：

- Button 保留原生 type、disabled、焦点与链接导航语义；busy 由调用方管理，声明不会隐式提交或发请求；保持玻璃 selector 契约。
- FormField 若新增，仅处理 label/help/error 的 ID 与布局，内容用 snippet；不接管表单值、日期解析或业务校验。
- Panel 若新增，仅提供语义容器、标题/操作/内容组合；不追加每页不同的 padding/颜色开关。
- Dialog 优先复用原生 dialog，仅收敛表面、尺寸和可访问交互；保存与删除失败仍由业务控制，关闭焦点回原触发器或合理后继。
- Pagination 若新增，用 `limit/offset/total/busy/onselect` 表达；渲染与请求分离，保留 20/24/10 等既有业务分页尺寸。

不主动新增 Drawer、Toast 总线、通用 DataTable、搜索系统、Tooltip 引擎、万能布局包装层。没有成熟复杂交互需求时无需安装依赖；以后确需新复杂控件时先评估原生/现有实现，再评估成熟无障碍基础设施。

## 4. UI Patterns 与 Agent 规则

正式 `patterns.md` 分别覆盖仪表盘、列表筛选、详情、表单、设置、图表分析、状态、响应式。每项固定写适用场景、布局、组件组合、交互/状态、反例、真实源码入口。

新增 `docs/design-system/README.md`、`components.md`、`patterns.md`、`tokens.md` 后，将 `components/ui/README.md` 更新为短索引，避免维护两套冲突标准。根 `AGENTS.md` 仅增加简短流程：先读规范 → 查组件 → 查相似页面 → 使用现有语义令牌 → 保持品牌与主题 → 新通用组件同步文档/展示 → 验证响应式、状态、主题、键盘和可访问性；未经授权不改全局视觉。不复制或覆盖其他项目规则，不新增局部 AGENTS.md。

## 5. Showcase 与生产隔离

推荐**仓库内独立 Vite + Svelte 测试展示入口**，例如 `frontend/tests/fixtures/ui-showcase/` 与独立 `frontend/vite.showcase.config.ts`。复用已安装的 Svelte Vite/Tailwind 插件与真实组件，不安装 Storybook。

- 入口不在 `src/routes`、不在 `static`、不从生产根布局导入；默认仅绑定 loopback。主 `pnpm build` 只编译应用，部署产物中不应有展示入口。
- 使用既有 app.css / sport-theme / liquidGlass action、ThemeToggle 与主题同步；使用合成静态 props，不请求真实账号、后端或供应商。
- 展示页头（有无 actions/长标题）、FeedbackState 四状态、骨架、MetricSummary compact/stacked/缺失值、日期选择器、主题按钮、原生控件 default/hover/focus/disabled/busy 示例与布局组合。
- 只将**可独立渲染**组件放入独立入口。依赖 `$app/state`、路由或业务 API 的 AppNavigation/ActivityExplorer/FootprintWall 等仍在 SvelteKit 5191 + 合成 API 的既有测试中验证；不在展示入口伪造 SvelteKit 运行时。
- 浅深色通过实际根主题切换，同一组件/材质使用同一有效主题。需要并排比较时由测试生成两张图，不靠嵌套容器冒充 canvas 的根主题。
- 沿用 LiquidGlassTuner，不复制它为第二套参数系统。视觉测试固定默认参数、主题、视口、日期/静态展示数据、动画偏好；清除测试 origin 的旧偏好，等待字体与增强就绪后截图。
- 断言展示构建/主构建彼此隔离：主 adapter-node 的展示路径返回 404，客户端产物不包含展示标识；仅“没有菜单链接”或 `if (DEV)` 隐藏 UI 不算隔离证明。

隔离入口支持基础组件/Pattern 的静态组合；非空地图、图表和公开视图的业务基线继续复用现有 spec 级夹具，不复制业务数据请求层。

## 6. 接口与隐私

不新增后端接口、配置变量、Schema 或迁移，不改变响应、CSRF、SSR 代理、安全白名单、公开数据边界。展示中的运动数值和文案使用合成数据；坐标/真实轨迹/账号/备注不得成为展示样本或快照。AI 示例只展示静态报告，生成逻辑不接线。

## 7. 验证与完成标准

- 每批运行 `pnpm check`；运行受影响组件/页面的最小 Chrome UI 集，交付运行单元、相关回归与 `pnpm build`。
- 展示覆盖浅深色、320/390/768/1024/1440px、长文案/缺失值/错误与禁用、键盘顺序/焦点恢复、reduced-motion；玻璃补 reduced-transparency/forced-colors。
- 引入少量确定性的 `toHaveScreenshot` 基线，优先展示页和两类真实页面组合；另外保留几何、DOM 和交互断言，不依赖截图单一证据。
- Token 等值提炼前后比较计算样式/尺寸与截图；仅由预期抗锯齿引起的差异应记录，不能设置宽阈值吞掉布局回归。
- Safari/Firefox 验证 Popover、select 降级与材质 fallback；无法运行时记 NOT VERIFIED，不把 Chrome 结果外推。
- 完成后的编号特性文档在实施结束时现场确认 `docs/` 最大编号再创建，不预先占号。

方案形成时的验证证据见审计第 9 节；确认后的阶段 1–3 已实施，实际覆盖范围与剩余问题见 [验收](../../50-ui-design-system.md)。阶段 4 的业务抽象仍为候选，不能据本提案视为已落地。
