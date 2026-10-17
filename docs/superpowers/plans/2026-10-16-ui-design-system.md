# RunNote UI Design System 分阶段实施计划

日期：2026-10-16。状态：**阶段 1–3 已实施并完成验证记录；完整 UI 回归有一项既有失败，阶段 4 未执行**。没有新增依赖、业务迁移、Git commit 或部署。实际结果见 [验收记录](../../50-ui-design-system.md)。

依据：[审计](../../design-system/ui-audit.md)、[设计提案](../specs/2026-10-16-ui-design-system-design.md)。推荐方案 B：复用现有实现，先建立文档、等值 Token 与隔离展示，再小范围验证迁移价值。

## Scope

- In：延续既有品牌、语义 Token、组件清单、8 类页面模式、仅开发使用的 showcase、Agent 索引、渐进迁移与验证。
- Out：全量重写、替换 UI 框架、全局换肤、图标全替换、新业务功能、后端/API/数据库变更、生产部署、Git 提交/推送。
- 范围保护：实施前重新检查当前未提交修改，尤其 app.css、导航/布局、足迹地图/墙、活动接口与夹具；本轮记录不能作为覆盖新修改的依据。

## Action items

- [x] 清点路由、组件消费者、全局/局部样式、主题、玻璃增强、测试与依赖。
- [x] 输出 `docs/design-system/ui-audit.md`，按 A/B/C/D 区分复用、规范、暂缓问题和缺失能力。
- [x] 浏览器核对代表性浅深色/移动端页面，并运行类型与最小壳层基线。
- [x] 确认设计提案 B 与下述第一实施批次（用户回复“确认”）。
- [x] 建立正式 Design System 文档、兼容 Token 与独立 showcase，不迁移业务页面。
- [x] 固定视觉、交互、生产隔离验收，审阅第一批具体差异；记录完整回归的既有侧栏失败。
- [ ] 选取重复样式的少量试点，决定实际需要的公共组件并迁移。
- [ ] 完成回归与验收记录，逐页迁移剩余规则或登记暂缓项。

## 阶段 0：审计与确认（本轮）

产物：审计、设计提案、本计划。当前检查为 `pnpm check` 0 errors/0 warnings，3 条既有 Chrome 壳层用例通过；人工查看了合成环境桌面浅深色、手机页面和日历浮层。详细范围、截图、未运行检查见审计。

确认点：批准进入阶段 1–3。此批准不包含后端/API/数据库变更、全局视觉改变或批量业务迁移。阶段 4 先给出试点 diff 和前后对照，再决定扩大范围。

## 阶段 1：形成可执行规范与 Agent 索引

目标：让新页面能够先查已有规则，不产生运行时差异。

计划文件：

| 文件 | 内容 |
| --- | --- |
| `docs/design-system/README.md` | 阅读顺序、核心视觉语言、复用决策流程、完成检查及变更规则 |
| `docs/design-system/tokens.md` | 每类 Token 的现值/主题覆盖/用途/禁止用法/源码来源；严格区分新增提案与有效名称 |
| `docs/design-system/components.md` | 已有 props、状态、语义/键盘、样式入口、消费者、业务边界、示例与暂不实现清单 |
| `docs/design-system/patterns.md` | 审计中的 8 类 Pattern，包含真实页面引用、组合示例、交互规则与反例 |
| `frontend/src/lib/components/ui/README.md` | 改为上述规范的简短索引，删除已过时的 bg-white 推荐，不搬迁组件 |
| `AGENTS.md` | 追加简洁强制流程与文档链接，保留原文其他规则 |

验收：文档引用、示例 props、Token 名称能在当前源码找到；“推荐但未实现”明确标识；不把 business component 称为无副作用 UI primitive。

## 阶段 2：补齐兼容 Token（只做等值变更）

主要目标文件：`frontend/src/app.css`；少量明确消费者是否需要等值引用在 diff 中列出。

1. 补 `--color-surface: var(--surface)` 等已存在语义变量的 Tailwind 映射，保留 `--color-card` 和全部现有值/类名。
2. 为重复的排版、浮层/遮罩、阴影、时长/曲线和全局层级建立最小角色，记录每项原值与来源。
3. 断点先规范表而不全站替换；不得用普通 CSS 变量写无效媒体查询，保留足迹墙容器查询和桌面高度规则。
4. 对状态、数据、装饰色分组登记；不碰热图算法/着色，不覆盖正在开发的 footprint-colors/display。
5. 不重排 CSS layer，不删除 `!important`，不重写玻璃适配，不改变默认光学参数，不“一键清理魔法数字”。

验收：代表页面的最终背景/文字/圆角/尺寸、主题切换和控件材质无非预期变化；浅深色的语义映射有效。正文 4.5:1、关键图形/焦点以适用标准核对；半透明控件检查实际合成结果。

风险控制：先建立计算样式与截图基线再应用等值引用；发现层叠差异时只撤销本批变更，不动用户已有修改。

## 阶段 3：独立 Showcase 与回归基础

目标：可直观看到组件状态和布局组合，同时不在生产 SvelteKit 路由中增加内部页面。

计划位置（待阶段开始时核对冲突）：

- `frontend/tests/fixtures/ui-showcase/{index.html,main.ts,Showcase.svelte}`：独立 Svelte 入口，复用真实基础组件、CSS、主题和玻璃 action；仅合成静态 props。
- `frontend/vite.showcase.config.ts`：复用已有 Svelte/Tailwind 插件；独立入口与输出目录，不改生产 routes/static。
- `frontend/package.json`：添加明确绑定 loopback 的开发展示命令；不新增依赖，不改变生产 build/start。
- `frontend/playwright.design-system.config.ts`、`frontend/tests/ui/design-system.spec.ts` 及对应快照目录：独立展示测试，不连后端/数据库。

展示范围：

| 分组 | 必需样例 |
| --- | --- |
| 页头/布局 | 短/长标题、有无 description/actions；PageHeader + 面板 + 表单 + 状态组合 |
| 状态 | FeedbackState loading/success/error/empty + retry 示例；PageSkeleton |
| 指标 | MetricSummary default/sport/compact/stacked、长数值、0 与缺失值 |
| 控件 | 现有主/次/危险按钮与图标按钮的原生写法；输入、textarea、select、checkbox/radio 的现有样式和 disabled/focus/busy |
| 日期/外观 | DatePicker min/max/required/disabled/键盘/窄屏；ThemeToggle 手动/自动，浅深色两组截图 |
| 材质/降级 | 使用当前默认参数；reduced-motion、reduced-transparency、forced-colors；不复制 tuner 参数面板 |

独立入口不伪造 `$app/state`。AppNavigation、ActivityExplorer、FootprintWall 等依赖 SvelteKit/业务的组件，留在原路由 + 既有合成 API/spec 夹具中测试。非空地图/图表成功态不能用错误页截图代替。

生产隔离验收：主 `pnpm build` 成功；启动 adapter-node（指向合成 API）访问约定展示路径为 404；检查主构建不含 showcase 唯一标识与展示资源；业务导航不增加入口。对外展示不是“隐藏链接”，而是与生产入口分离。

本阶段完成后提供具体 diff、浅深色截图和隔离证据供用户复核。

## 阶段 4：有限试点整理公共实现

前置：阶段 1–3 通过且当前并行 UI 工作已重新核对。先确定两个以内的真实重复点，避免顺手将所有页面改写。

推荐顺序：

1. 主操作样式入口与小型字段/容器组合：先比较 dashboard 的局部 `.button-primary`、settings 的原生主按钮、全局 secondary、玻璃 selector，确认是否样式类已足够。
2. 原生 dialog 的表面与焦点约定：比较活动列表和 ActivityActions，仅统一可复用层，不迁移删除/编辑事务。
3. Pagination 或 Panel 仅在至少两处用途与行为一致后决定是否新增组件。页数显示、回调、pending、空集合边界明确；不改变既有 `limit/offset` 和分页大小。

候选文件：`frontend/src/lib/components/ui/` 下按必要性新增，既有组件不搬家；消费者仅限审阅过的少量页面。不得在本阶段重构所有数据加载或绕开 disposed/request token/401 约定。

需验证：按钮默认 type、不嵌套交互元素、异步禁用与草稿保留、dialog Escape/取消/失败重试/关闭后焦点，链接与 button 区别，玻璃增强恰好一层。改动组件同步文档与 showcase。

扩大迁移前：逐文件给出改动理由和真实前后截图；若出现布局/品牌变化或需要新复杂控件基础设施，先取得单独确认。

## 阶段 5：回归、迁移清单与交付

每个组件/页面标记 A（直接复用）、B（已规范/待迁移）、C（保留已知问题）、D（缺失但有/无实际需求），不以“组件数”衡量完成度。

计划验证命令（**以下未因写计划而执行**）：

```bash
# 工作目录 frontend
pnpm check
pnpm test
pnpm build
pnpm exec playwright test --config playwright.design-system.config.ts
pnpm exec playwright test --config playwright.ui.config.ts

# 涉及特性时，显式运行对应已有配置
pnpm exec playwright test --config playwright.activity-management.config.ts
pnpm exec playwright test --config playwright.ai-datepicker.config.ts
```

实际运行前核对配置文件是否存在及 testMatch；新增 spec 不一定被默认 UI 配置收录。新增业务接口使用必须补对应合成夹具；本方案原则上无需新增业务接口。

验证矩阵：

| 维度 | 要求 |
| --- | --- |
| 外观 | light/dark/system 首屏、实时与跨页签；切换保留草稿、地图/图表实例及选择 |
| 响应式 | 320/390/768/1024/1440px，另测关键断点两侧；侧栏低高度、长文案/数字；表格只局部滚动 |
| 状态 | default/hover/focus/active/selected/disabled/busy、空/失败/成功、缺失/零值 |
| 可访问性 | 键盘顺序、skip、可见焦点、label/help/error、dialog/popover Escape/焦点恢复、语义状态 |
| 图表/地图 | 非空合成数据、底图失败与关闭、主题更新、表格兜底；不外发真实轨迹 |
| 视觉差异 | 固定合成数据/时间/主题/默认玻璃参数；确定就绪再截图，审阅基线后才允许更新 |
| 兼容性 | Chrome 正常与降级；Safari/Firefox 的 Popover/select/材质回退可执行则实测，否则 NOT VERIFIED |
| 安全边界 | showcase 不进入生产产物；公开页面无私人壳层/字段；不调用真实 AI、不写开发库 |

结束时现场确认 docs 最大编号后追加特性文档，包含使用方式、接口与隐私、实际命令/数量、截图、迁移清单与剩余问题。报告区分 PASS/FAIL/BLOCKED/NOT VERIFIED；合成 UI 通过不等于真实后端或生产验收。

## 回退与未解决事项

- 每批只处理列明的文件；回退只移除本批新增 Token/组件/入口并恢复本批消费者改动，不用 git reset/clean，不动他人未提交内容。
- 正式规范和展示已经落地，现有 API 按源码登记；用户列举但无当前需求的组件不实施，候选迁移保留在阶段 4。
- 当前足迹墙、活动接口与测试仍有外部改动；后续需重新核对它们的成功态和新布局，不把本轮早先错误态观察当作最终缺陷结论。
- 玻璃控件合成对比度、密集日历目标、跨浏览器和屏幕阅读器属于待验证项；本轮没有证据支持全站可访问性认证。
- 当前方案不需要公共接口或数据库调整。如后续发现必要性，列清影响后单独确认，不能借 Design System 迁移隐含变更业务。

## 实施进度

阶段 1 文档和 AGENTS 索引已建立；阶段 2 补 surface 映射及全局排版/动效/层级的等值角色，DatePicker 阴影和 tuner 层级按原值引用；阶段 3 独立 Vite 展示、专用缓存、六条交互/视觉用例、四张快照和生产隔离脚本已建立。

首轮两张桌面组合基线在 Token 修改前生成并目视审阅，修改后零像素差异。移动端浅深色基线同样已审阅。生产隔离脚本是实际执行后的可复用验证入口；完整命令、失败定位和待验证项统一见验收文档。

阶段 4 没有执行；Button/Panel/分页等候选仍保留原业务实现。没有执行 Git commit、push、数据库操作或部署。
