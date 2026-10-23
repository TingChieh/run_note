# UI Design System：阶段 1–3 实施与验收

日期：2026-10-16。范围：用户确认后的正式规范、等值 Token、独立展示和验证基础。阶段 4 的业务组件/页面迁移未执行。未提交 Git、推送或部署。

## 使用方式

从 [Design System](design-system/README.md) 开始，按 [组件](design-system/components.md) → [Patterns](design-system/patterns.md) → [Tokens](design-system/tokens.md) 查找实现。审计和分阶段计划保留在 [ui-audit](design-system/ui-audit.md)、[plan](superpowers/plans/2026-10-16-ui-design-system.md)。

工作目录 `frontend/`：

```bash
pnpm showcase
# 浏览 http://127.0.0.1:5193，结束按 Ctrl-C
pnpm exec playwright test --config playwright.design-system.config.ts
pnpm build
node tests/fixtures/check-showcase-isolation.mjs
```

展示与主开发服务可并存：独立入口、专用 Vite 优化缓存、独立 dist 输出，无生产导航入口。不要将它添加为生产路由。生产隔离脚本占用 8191/5194，运行前确保没有其他合成 UI 测试占用；占用时脚本拒绝执行，不停止已有服务。

## 改动范围

| 类别 | 文件与意图 |
| --- | --- |
| 文档 | `docs/design-system/{README,tokens,components,patterns}.md`：视觉不变量、实际 API、八类布局模式、已有/新增 Token 与边界；审计/提案/计划同步状态 |
| Agent 索引 | 根 `AGENTS.md` 仅增加短 UI 流程；`components/ui/README.md` 改为正式规范索引，移除旧 bg-white 推荐 |
| 全局样式 | `frontend/src/app.css` 补 `--color-surface` 同源映射；排版、动效、阴影、遮罩和层级角色沿用原值、选择器顺序与优先级 |
| 现有组件 | DatePicker 阴影改为等值 Token；LiquidGlassTuner 的 50 层级改为语义引用；props、事件与布局不改 |
| 展示 | `vite.showcase.config.ts`、`tests/fixtures/ui-showcase/`、package `showcase` 脚本：复用真实六个组件、原生控件、根主题和 liquidGlass action，不新增依赖 |
| 测试 | 独立 Playwright 配置、六条展示用例、四张桌面/移动浅深色快照；`check-showcase-isolation.mjs` 检查生产 404 与产物隔离 |
| 后端 | 本批无改动 |

工作区原有全局 CSS、导航、活动、足迹地图/墙、API 与测试的未提交修改均保留。app.css 本批差异以开始实施时保存的文件副本核对，不能将整个 `git diff` 归属于本任务。实施期间另外观察到业务测试修改，本批没有覆盖它们。

## 接口与隐私

独立展示只用合成静态 props，测试确认没有 `/api/` 请求；不挂载需要 SvelteKit `$app/state` 或领域接口的业务组件。无真实轨迹、坐标、用户信息、文件名、账号密码或供应商请求进入展示/快照。

生产隔离验证使用已有内存 API 与本机 adapter-node，仅处理合成数据。没有连接真实后端、写开发库、执行迁移、读取密钥或修改环境文件。公开白名单、CSRF、SSR 代理、权限、服务端指标与主题偏好流程不变。

## 验证记录

以下均为本批实际执行，命令在 `frontend/` 下；Playwright 使用已安装 CLI，无新增下载。

| 状态 | 命令 / 检查 | 结果与范围 |
| --- | --- | --- |
| PASS | `pnpm check` | 最终 0 errors / 0 warnings；新增隔离脚本的 JSDoc 类型已补齐 |
| PASS | `pnpm test` | 22 files、134 tests passed；无数据库 |
| PASS | `node node_modules/@playwright/test/cli.js test --config playwright.design-system.config.ts` | 6 passed (4.0s)；主题持久化/自动/草稿、日期键盘和边界、窄屏、强制色焦点、减少透明度/动画、原生值和反馈；四张基线比较 |
| PASS | `node node_modules/@playwright/test/cli.js test --config playwright.ai-datepicker.config.ts` | 2 passed (5.8s)；真实页面 + 合成接口的日期键盘、窄屏、只读预览及生成中禁用 |
| FAIL（既有） | `node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts` | 最终重跑 114 passed / 1 failed (3.1m)；失败为低高度侧栏，详见下文。不能称完整 UI 全绿 |
| PASS | `pnpm build` | adapter-node 构建成功，退出 0；保留既有 >500kB chunk 警告 |
| PASS | `pnpm exec vite build --config vite.showcase.config.ts` | 独立展示构建成功 (406ms)，输出 `dist/ui-showcase`，与生产 build 分离 |
| PASS | `node tests/fixtures/check-showcase-isolation.mjs` | 357 个主产物无展示标识/资源；`/showcase`、`/ui-showcase`、`/tests/fixtures/ui-showcase/`、`/main.ts` 全部 404，正常 login 可用；本次进程已自动关闭 |
| PASS | 浏览器人工检查（内置 Chromium） | 桌面浅深色、390px 深色日期浮层、Escape 恢复触发焦点；390px document.scrollWidth=innerWidth=390；结束恢复 system 与默认 viewport、关闭临时 tab |
| PASS | 代表业务页改动前后计算样式对照（临时 Playwright 探针） | 两端各 1 passed (4.5s / 4.7s)；仪表盘/设置 × 浅深色 × 390/1440px，共 8 组、92 个元素样本、1288 个属性值完全一致；探针已清理 |
| PASS | 只读代码审阅 | 本批等值引用、生产入口与规范事实未发现阻塞问题；跨浏览器/读屏仍留待验证 |
| PASS | 收尾静态检查 | `git diff --check` 通过；8 份设计/验收文档本地链接无缺失；临时探针已移除；清理后 `pnpm check` 再次 0 errors / 0 warnings |

展示响应式自动覆盖 320/390/639/640/768/1023/1024/1440px；320px 日期浮层边界在视口内。正文语义表面在两主题计算对比度 ≥4.5:1，仅证明该不透明样本，不代表全站或玻璃最终合成符合 WCAG。

### 视觉与等值证据

两张桌面组合基线在 Token 改动前生成，人工检查后固定；补 Token 后以 `maxDiffPixels:0` 原基线比较通过。第一次独立入口遗漏了组件 Tailwind 扫描，辅助说明意外可见；修正 fixture 的 `@source` 后重新审阅，未改业务组件。移动端浅深色基线亦逐张目视。

基线位置：`frontend/tests/ui/design-system.spec.ts-snapshots/`，包含 `composition-{light,dark}{,-mobile}-darwin.png`。它们用于后续组件组合回归，不代替全站截图或真实业务验收。更新前必须审阅差异，不能用放宽阈值隐藏变化。

另用同一份当前业务源码建立临时副本，只将 app.css、DatePicker 和 LiquidGlassTuner 恢复为本批实施前保存的版本；两端分别以既有合成 API + Chrome 运行临时配置 `playwright.ds-equivalence.tmp.config.ts`。比较 `/dashboard?year=2026`、`/settings` 在 light/dark 与 390/1440px 的 8 组计算样式，覆盖背景、文字、边框、圆角、内边距、宽度、排版、层级、阴影和动画。比较通过后删除仓库内临时配置和探针，不将它们作为正式测试入口。该对照隔离本批三处生产源码改动，不宣称覆盖其他并行修改或全站所有状态。

计算样式原始 JSON 与比较摘要保存在本机证据目录：

- [改动前样式](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-design-system-prechange-styles.json)
- [当前样式](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-design-system-current-styles.json)
- [逐值比较摘要](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-design-system-style-equivalence.json)

人工浏览器证据（合成内容，不进入仓库）：

- [桌面浅色展示](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-showcase-desktop-light.png)
- [移动深色控件](local-evidence/2026/10/16/01a14356-8298-77a3-9e56-5c7d4279ec66/ui-showcase-mobile-dark.png)

### 既有失败与运行干扰

`ui-shell.spec.ts` 的 `compact goal and complete desktop navigation fit common laptop heights` 在 1366×768 期望侧栏无内部滚动，实际 scrollHeight=806、clientHeight=768。使用当前源文件建立不含本批 app.css/DatePicker/tuner 改动的临时副本后，同样复现 806 > 768，确认不是本批 Token 改动引入。保留现有可滚动导航，不扩大范围重做低高度布局，也不修改断言掩盖失败。

首轮完整回归为 109 passed / 5 failed，涉及趋势 canvas、详情地图尺寸和侧栏。期间有其他业务测试变更及多个 Vite 入口；五条独立重跑在当前与改动前副本均得到 4 passed / 1 failed。展示现使用专用优化缓存以避免开发入口干扰，最终完整重跑只剩上述侧栏失败。未把四条短暂失败武断归为同一根因。

运行中仍出现既有 `replace_state_deprecated`、NO_COLOR/FORCE_COLOR 提示，以及部分壳层夹具未覆盖 AI/公开成功接口的 404；相关成功流程通过各自 spec 拦截覆盖，不能仅凭壳层测试宣称接口成功。

## 迁移计划与剩余问题

| 分类 | 本批结果 / 下一步 |
| --- | --- |
| A 直接复用 | 六个公共组件和原生/CSS/action 体系已登记与展示，保持 API/路径，不重新造轮子 |
| B 待统一 | Button 入口、字段组、dialog 表面、分页：阶段 4 按至多两个真实重复点给出消费者 diff 和前后视觉，另行决定迁移 |
| C 暂缓问题 | 低高度侧栏失败；Unicode 光学差异、密集目标、原生 Popover/select 跨浏览器、旧路由警告；不在本批顺手重构 |
| D 已补/暂缺 | 正式规范、组件总览、四张自动视觉基线、生产隔离已补；无需求的 Toast/Drawer/Tooltip/DataTable 等仍不实现 |

NOT VERIFIED：Safari/Firefox、屏幕阅读器、完整全站玻璃合成对比度、真实数据库 E2E、后端测试、真实 AI 供应商和生产部署。未运行 `playwright.activity-management*.config.ts` 专项；本批没有修改管理行为，相关现有对话框交互包含在默认 UI 材质用例中。合成测试与本机产物检查不能外推为真实后端或生产验收。

现有 5183/8001 开发服务未由本批重启或关闭；本批测试与展示的临时进程在检查后结束。未来阶段 4 仍须先重新确认并行修改状态，未经允许不执行全局视觉修改或业务迁移。

## 后续修正：文件入口空白

用户随后通过 `file://` 打开展示源码，未经过 Vite 编译，空的挂载容器无法显示组件。已在源码 HTML 加入静态启动说明和 HTTP 链接，运行入口挂载前清除说明；同步明确文档访问方式。本次仅修改展示入口和说明，没有改业务 UI。

重新执行 `pnpm check`：0 errors / 0 warnings；独立展示 build 退出 0（327ms）；`git diff --check` 通过。内置浏览器实际打开 `http://127.0.0.1:5193/`，确认页头、指标、表单控件、反馈、变体与布局组合存在，并保存运行截图。此次没有重跑完整 UI/业务 E2E，先前结果不能视为本次重跑。

此次交付有意保留 5193 本机展示服务与浏览器页签供用户查看；此前“临时进程已结束”描述的是上一轮验收结束时的状态。
