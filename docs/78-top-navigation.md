# 78 私人页面顶部导航

日期：2026-10-31。设计见 `docs/superpowers/specs/2026-10-30-top-navigation-design.md`，计划见 `docs/superpowers/plans/2026-10-30-top-navigation.md`。同一批工作还包含暖炭灰深色外观（见 `docs/77-dark-theme-warm-charcoal.md`）、Clear 玻璃默认值与统一细滚动条。本地实现，尚未发布到生产。前段保留原阶段记录，最终结果见本文末尾的「2026-10-31 续接验收」。

## 使用方式

- **顶部条**：私人页面（含 `/workspace/*`、`/settings`、`/admin/users`）左侧的绿色侧栏改为顶部悬浮玻璃条，距视口顶部与左右 14px（`--top-navigation-offset`），高 4rem（`--top-navigation-height`），宽对齐内容区。左是 Logo 加站点名，中间是导航项，右边是账户区。绿色只留给 Logo 方块与当前项；内容区把原来侧栏的 15rem 宽度还了回去。站点副标题只在手机菜单里显示。公开页面（`/p/{username}/*`、匿名展示）的顶部导航不变。
- **三档响应式，壳层断点 B = 800px**：≥1360px 图标加文字；800–1359px 只有图标（每项保留 `title` 与 `aria-label`，页面名称由页头标题呈现，当前项由横向滑块标出）；<800px 是手机栏加文档流菜单（结构、动画、焦点管理与 `inert` 不变）。普通启用账户会多出第 9 个入口“本人工作区”，9 个入口带文字在任何桌面宽度都放不下，所以入口达到 9 个时所有 ≥800px 的宽度都是图标版（`aside` 带 `data-dense`）。≥800px 的页面切换动画由上下滑改为左右滑，<800px 保持上下。
- **docked / floating 两态**：页面内容还没有滚到条下面时是不透明的 `--surface` 卡片（docked，无模糊无阴影）；内容在条下面经过时进入 floating，用与身心健康保存栏同一玻璃配方：`--glass-edge` 亮边、淡底色（`--glass-opacity` 的 75%，默认 .12 时约 9%）、`--glass-sheen` 内高光、`--glass-shadow` 轻阴影，再加折射（Chromium）。文字与品牌名不加光晕。悬浮时未选中的标签改用前景色（灰色在黄色页头上太弱），当前项保持原色。WebKit 无法折射，改用磨砂玻璃（`.rn-frosted-glass`：`blur(14px) saturate(1.5)` 的真实背景模糊加约 60% 的 `--surface` 底色，亮边与较轻阴影保留），Firefox 保留模糊回退；降低透明度与强制色下始终是实心卡片。
- **进度环与目标弹层**：账户区从左到右是进度环、主题切换（图标）、头像。进度环显示当前周期目标完成度，点开是玻璃弹层，内容复用原来的 `RunningGoal`（周期、目标、已完成、统计范围说明，可调整）；未设目标是虚线空环加“+”；公开展示的只读视图只显示不可改；身份确认中不显示。手机菜单里目标卡以内联形态（`AnchoredPanel inline`）保留。
- **头像菜单**：点头像打开玻璃弹层：姓名与模式（管理员模式 / 本人工作区 / 个人跑步展示）、设置（仅可管理的视图显示）、退出登录。Escape 或点外部关闭并把焦点还给头像；当前在设置或用户管理页时头像带主色描边。按压头像时头像随玻璃一起形变（`--glass-press`）。手机菜单仍是原来的内联账户块。
- **手机栏与菜单统一配色**：`--surface` 底、`--border` 边、`--foreground` 文字，Logo 方块用新令牌 `--sport-brand` 加白字，不再整块绿色；深色外观跟随暖炭灰。`--sport-sidebar` 现在没有任何样式读取它（令牌保留，文档仍引用；站点设置预览已改成顶部条缩略样）。
- 设计系统文档（README、components、patterns、tokens）已同步；独立 showcase 新增“锚定弹层与进度环”区块（`AnchoredPanel`、inline 示例、`GoalRing` 的未设置 / 0% / 62% / 100% 四个状态），只用合成数据。
- **固定条下的内容**：≥800px 时顶部条是 `position: fixed`，页面里吸顶的元素（身心健康历史的日历卡、站点设置的预览列）把 `top` 设为条的下沿再加 1rem（`--top-navigation-offset` + `--top-navigation-height` + `--space-4`）；只有身心健康历史的日历卡相应缩小 `max-height`。`html` 在有顶部条时带 `scroll-padding-top`（条下沿加 `--space-2`，共 86px），Tab 聚焦、跳到主要内容链接与 `scrollIntoView` 不会停在条后面。手机（<800px）条不固定，保持原值。保存条的吸底不受影响。

## 接口与隐私

不改接口、权限、CSRF、隐私边界、数据计算、数据库与迁移，不新增请求，不新增偏好项。进度环只显示已有的跑量与目标（来自原 `RunningGoal` 的读取），头像菜单只显示当前账户已有的信息（显示名、模式、设置与退出入口）。公开页面与匿名展示的数据、导航与白名单不变；外部底图仍只向 OpenFreeMap 请求公开样式与视口瓦片。showcase 不进生产路由，隔离脚本仍确认构建产物里没有展示标识。

## 验证记录

命令均在 `frontend/` 下于 2026-10-31 实际执行。Playwright 用独立端口 8291/5291（临时配置 `playwright.tmp-8291.config.ts`，按次改 `testMatch`），不触碰他人占用的 8191/5191，不连真实后端与开发库；设计系统基线用 `playwright.design-system.config.ts`（5193）。以下数字都来自本次命令输出，不引用历史计数。

### 静态检查、单元测试与构建

| 命令 | 结果 |
| --- | --- |
| `pnpm check` | 680 个文件，0 错误，0 警告 |
| `pnpm test`（Vitest） | 43 个文件、282 个用例全部通过 |
| `pnpm build` | 退出码 0（既有大 chunk 警告属已知状态） |
| `node tests/fixtures/check-showcase-isolation.mjs`（8191、5194 空闲，在上面的构建之后运行） | 退出码 0：产物 696 个文件无展示标识；`/showcase`、`/ui-showcase`、`/tests/fixtures/ui-showcase/`、`/main.ts`、`/login` 均返回 404 |

隔离脚本此前在“等待 5194 上 `/login` 返回 200”处超时（`/login` 现在按项目规则是 404），后面的 404 检查从未真正运行；现在改为等待 `/admin` 返回 200，并把 `/login` 加进应为 404 的路径。

### 导航相关 UI 规格（合成 API，Chrome）

第一次整套运行（17 个规格，`--reporter=json`，用时约 562 秒）：**288 通过、3 跳过（`crossbrowser-glass` 自带的 skip）、6 失败**。各规格：

| 规格 | 通过 / 失败 / 跳过 |
| --- | --- |
| top-navigation | 45 / 2 / 0 |
| ui-shell | 21 / 1 / 0 |
| liquid-glass | 16 / 0 / 0 |
| crossbrowser-glass | 6 / 0 / 3 |
| site-settings | 9 / 0 / 0 |
| admin-users | 8 / 0 / 0 |
| dashboard | 5 / 0 / 0 |
| records | 9 / 0 / 0 |
| records-banner | 10 / 0 / 0 |
| milestones | 13 / 0 / 0 |
| activities | 16 / 0 / 0 |
| sport-detail | 6 / 0 / 0 |
| footprints | 28 / 0 / 0 |
| theme | 9 / 0 / 0 |
| showcase | 6 / 0 / 0 |
| scrollbars | 5 / 1 / 0 |
| wellbeing | 76 / 2 / 0 |

6 个失败的处理（逐项重跑后判断，没有改任何规格或源码来掩盖）：

- `top-navigation` “crossing the desktop breakpoint rebuilds the lens on the other axis”、“801px: floating top bar…”，`ui-shell` “all P0 route shells fit…”，`scrollbars` “the range switches and the time picker wheels…”：第二次运行 `top-navigation`、`ui-shell`、`scrollbars`、`wellbeing` 四个规格（151 用例）时 `ui-shell`（22）与 `scrollbars`（6）全过、`top-navigation` 又冒出另一项（“on a phone the goal stays inline…”），随后整份 `top-navigation.spec.ts` 连续两次运行均为 **47 通过、0 失败**。失败信息是 `/admin?next=%2Fsettings` 登录页按钮仍是 disabled、`goto` 被中断、点击“打开导航”发生在水合之前，都是页面还没水合完就操作的时序问题（开发服务器冷启动或机器负载高时更明显），不是布局或逻辑回归。注意：单独用 `-g` 只跑“crossing the desktop breakpoint…”一条时，在冷启动的开发服务器上连续 4 次稳定失败（点击“打开导航”早于水合，菜单没打开，导航仍 `inert`，按角色找不到）；在该用例里先等水合（例如等头像菜单或手机菜单里的“退出登录”按钮变为可用）后连续 4 次通过。这是规格本身缺水合等待的问题，已在后续修正：该用例在调整视口前先等 `header[data-auth-ready="true"]`（冷服务器上修正前 2/2 失败，修正后 3/3 通过）；`loginRunner`（`tests/fixtures/activities.ts`）登录跳转的 URL 等待放宽到 15 秒并在结尾等同一个水合标记，`ui-shell` 的 `login` 同样放宽到 15 秒；深色“当前链接可读”用例在读取颜色前等 `document.getAnimations()` 全部结束，避免读到颜色过渡的中间值（修正前加了水合等待后 2/10 失败，修正后浅色加深色 30/30 通过）。修正后 `top-navigation`、`ui-shell`、`scrollbars` 三个文件完整运行两次，均为 75 通过、0 失败（47 + 22 + 6）。没有改任何产品代码；`wellbeing:1461`、`1535` 属时间相关，未处理。
- `wellbeing.spec.ts:1461`（“summary: a custom range of several months…”，两次运行都失败，期望 ≥3 实得 2）：与日期相关的已知失败，不是本次改动。
- `wellbeing.spec.ts:1535`（“summary: side effects and notes share one row…”）：第一次运行失败（期望 ≤1 实得 81.98），第二次运行通过；时间或负载相关的偶发，未处理。
- 其余 wellbeing 用例在第一次运行为 76 通过，第二次运行为 77 通过；之前记录里与当日时间相关的 `wellbeing.spec.ts:1356` 这次没有失败，其他依赖时间的服药表单用例需要白天重跑再确认。

`records-banner` 的“mid-width”用例原先在 1100px 视口断言“5K、10K 并排，累计条在下”。顶部导航去掉左侧 15rem 栏后 1100px 的内容区变宽（1034px），横幅按自身容器宽度（54rem 内容宽）切换版式，三张卡片同排，断言不再适用。实测（视口宽度，横幅宽度，版式）：640px 竖排；700 / 800 / 900 / 960px 两列加整宽累计条（累计条高 71px，无溢出）；1000px 起三列（1000 / 1024 / 1100 / 1280px 均无溢出）。规格改为在 800、900、960px 三个视口各断言一遍原有条件，没有放宽；没有发现真实布局缺陷。

### WebKit 与跨浏览器（顶部条改为磨砂玻璃之后）

用 `playwright.crossbrowser.config.ts` 的临时副本（端口 8391/5391，只保留 `webkit` 与 `iphone-15` 两个项目，Firefox 未安装不运行）把整份 `crossbrowser-glass.spec.ts` 跑在 Playwright WebKit 引擎里：**15 通过、5 跳过、0 失败**（含“in WebKit the floating top bar is frosted glass…”，桌面 WebKit 项目运行，iPhone 项目按规格自带条件跳过）。同一批规格在 Chromium（Chrome 通道）：`top-navigation` 47、`ui-shell` 22、`liquid-glass` 16、`crossbrowser-glass` 6 通过 + 4 跳过，合计 **91 通过、4 跳过、0 失败**。

### 设计系统基线（`playwright.design-system.config.ts`）

**8 通过、1 失败。** 失败的是浅色 `composition-light`（期望 1290x408，实得 1290x398，约 11000 个像素不同）：与 HEAD 干净导出上就已存在的字号漂移一致（见 `docs/77`），差异图只有标题与数字的字号偏移，不是本次改动。深色两张（桌面、手机）基线与当前渲染一致、整条通过，**没有更新任何快照**。新增的展示区块在被截图的 `visual-reference` 元素之外，所以不改变快照。浅色基线仍是过期状态，需用户决定是否刷新。

### 截图与手工查看

展示页“锚定弹层与进度环”区块在浅色与深色下各打开一次弹层查看（进度环、弹层、inline 示例、四个状态，390px 宽无横向溢出，Escape 关闭并把焦点还给触发按钮）；顶部条、头像菜单、floating 玻璃与手机栏的截图由前序实现任务各自查看，本次没有重做。

### 未运行

- 真机 Safari、Firefox（未安装 Firefox 浏览器，`firefox` 项目没有运行）：整套 UI 规格默认只在 Chrome 通道运行，其 3 个跳过项是规格自带的 skip。
- 真实后端 e2e 与其他 `*-e2e.config.ts`、`*-build.config.ts`（如 `showcase-build`、`admin-users-build`）、`basemaps-live`（真实底图网络）、`seo-routes`（写死 5191）、`dashboard-explorer`、其余 `playwright.*.config.ts` 特性配置。
- 经典（非覆盖式）滚动条的真机渲染：测试里的 Chrome 以 `--hide-scrollbars` 运行，从未画出经典滚动条；15px 经典滚动条的余量只来自断点实测的模拟。
- 开发服务（他人窗口的 8191/5191）没有重启，新样式只在隔离端口上验证，不等价于生产验收。

### 剩余风险

- 1360px 阈值是实测后从原估的 1280px 调整的：8 个带文字入口在 1280–1339px 会压到账户区，1360px 时与账户区仅约 36px 间隙，换字体或渲染差异时余量很小。
- WebKit 的悬浮顶部条是磨砂玻璃（模糊加约 60% 底色），不如 Chromium 的折射清透；这是用户接受的取舍。WebKit 只在 Playwright 的 WebKit 引擎里验证过，没有真机 Safari；Firefox 未安装，没有运行。
- 9 个入口的普通账户在 800–1359px 与 ≥1360px 都只有图标（`data-dense`），入口名称只靠 `title`/`aria-label` 与页头标题。
- 字号放大（系统或浏览器字号）下的顶部条间距没有测；壳层断点 800px 在 9 项账户下，模拟 15px 滚动条后余量约 14.5px。
- 浅色 `composition-light` 像素基线的偏差早于本改动，仍未刷新。
- `--glass-press` 现在在每个玻璃控件上都带初始值 0.000 的行内样式，不影响显示。
- 站点设置“预览”小面板（`.preview-side`）已改成顶部条的缩略样：`--surface` 底、`--border` 边、药丸圆角，Logo 方块用 `--sport-brand`（上传了 Logo 则显示图片），站点名用 `--foreground`，副标题用 `--muted-foreground`；类名与交互不变。

## 改动文件

这一批（顶部导航，含同一工作区里的暖炭灰深色、Clear 玻璃默认值与统一细滚动条）涉及的文件如下；这是实现范围，实际提交状态以 Git 为准。

**前端源码**：`frontend/src/app.css`、`src/lib/components/AppNavigation.svelte`、`AnchoredPanel.svelte`（新）、`GoalRing.svelte`（新）、`RunningGoal.svelte`、`WellbeingDayEditor.svelte`、`src/lib/styles/liquid-glass.ts`、`liquid-glass.css`、`liquid-glass-controls.css`、`liquid-glass-indicator.ts`、`liquid-glass-knob.ts`、`liquid-glass-settings.ts`、`liquid-glass-slider.ts`、`menu-glass.ts`、`src/lib/api/map-style.ts`、`src/routes/admin/users/+page.svelte`、`src/routes/records/+page.svelte`。

**测试与夹具**：`frontend/tests/ui/top-navigation.spec.ts`（新）、`scrollbars.spec.ts`（新）、`tests/fixtures/top-navigation.ts`（新）、`tests/fixtures/ui-showcase/Showcase.svelte`、`tests/fixtures/check-showcase-isolation.mjs`、`tests/ui/` 下的 `activities`、`crossbrowser-glass`、`dashboard`、`design-system`、`footprints`、`liquid-glass`、`milestones`、`records`、`records-banner`、`route-poster`、`showcase`、`site-settings`、`sport-detail`、`theme`、`ui-shell`、`wellbeing` 各规格，`tests/ui/design-system.spec.ts-snapshots/composition-dark-darwin.png` 与 `composition-dark-mobile-darwin.png`（深色任务更新），`tests/unit/liquid-glass-settings.test.ts`，`frontend/playwright.ui.config.ts`（`testMatch` 加入新规格）。临时配置 `frontend/playwright.tmp-8291.config.ts`（未跟踪，仅本地）不属于交付物。

**文档**：`docs/78-top-navigation.md`（本文，新）、`docs/design-system/README.md`、`components.md`、`patterns.md`、`tokens.md`、`docs/36-liquid-glass-dev-tuner.md`、`docs/37-official-glass-buttons.md`、`docs/77-dark-theme-warm-charcoal.md`（新）、`docs/superpowers/specs/2026-10-30-top-navigation-design.md`、`docs/superpowers/plans/2026-10-30-top-navigation.md`（新）、暖炭灰的设计与计划文档（新）。`docs/design-system/ui-audit.md` 未改。

## 2026-10-31 续接验收

恢复「UI改造」会话后，核对了原始 JSONL、当前代码及最终修复报告。最终修复的 11 项已通过只读复审：吸顶日历与站点预览避让固定导航、私人壳层的滚动定位偏移、两个新规格的默认 CI 覆盖、站点预览配色、断点与模糊说明、无效断言、0% 进度环、弹层挂载前的原生触发门控、目标弹层辅助函数和调参文档。接口、权限、数据库与导入实现没有改动。

### 本轮实际执行

以下命令在 `frontend/` 执行。UI 回归仅连接内存合成 API，不连接真实后端或数据库。启动前核实端口空闲；35 组回归使用 8191/5191，其后的串行复跑与 WebKit 使用 8391/5391。临时配置由现有配置派生，仅调整 `testMatch`、端口和输出目录，结束后删除。

| 命令 / 范围 | 真实结果 |
| --- | --- |
| `pnpm check` | 0 错误、0 警告 |
| `pnpm test` | 43 个文件、282 个用例通过 |
| `pnpm build` | 退出码 0；保留既有大 chunk 警告 |
| `node tests/fixtures/check-showcase-isolation.mjs` | 退出码 0；696 个产物文件无展示标识，5 个禁止的生产路径均为 404 |
| `pnpm exec playwright test --config playwright.codex-resume.config.ts --reporter=line,json`：默认 UI 规格，加使用 `loginRunner` 的合成规格（排除 `basemaps-live`），共 35 组 | 470 通过、4 跳过、9 失败，19.1 分钟；逐项处理见下，不将其记为整套通过 |
| 修正后 `mifitness.spec.ts`，隔离临时配置 `--repeat-each 3` | 21 通过，31.9 秒 |
| 修正后串行复跑 `mifitness`、`showcase`、`wellbeing`，临时配置 `playwright.codex-probe.config.ts --reporter=line,json` | 91 通过、0 失败、0 跳过，3.7 分钟；包含首次运行的全部失败项 |
| `playwright.crossbrowser.config.ts` 的隔离临时副本，只运行 `webkit`、`iphone-15` | 15 通过、5 跳过、0 失败，28.4 秒 |
| `pnpm exec playwright test --config playwright.design-system.config.ts` | 8 通过、1 失败；浅色基线仍未刷新，见下 |
| 临时合成截图规格：1440×900 停靠/悬浮顶部条、390×844 手机菜单，浅深色各一组 | 1 通过；6 张截图均已查看，标题、导航和账户区可读，手机菜单沿文档流展开 |

默认 UI 配置没有覆盖所有特性规格；本轮主动补跑了使用共享登录夹具的规格，包括 activity 系列、AI 日期/设备指标、TCX、小米导入、常跑路线、海报和 showcase。`seo-routes` 与 `dashboard-explorer` 本轮也执行通过，不能继续将前段「未运行」视为最终状态。

### 首次失败的处理

- 小米导入 6 项：trace 证实 `setInputFiles` 在文件框仍为 `disabled`、组件尚未挂载时就写入文件，随后预览一直不可用。测试 setup 现在先等待 JSON 文件框可用。该等待又暴露两处旧定位：选中文件后标签改为文件名，原先按「跑步汇总 JSON」查找会失效；改为匹配始终可见的 `running_summaries.json` 提示。导入顺序、重复确认、重试、401 清理、请求内容与忙碌状态断言均保留。只有 `tests/ui/mifitness.spec.ts` 改动，产品导入逻辑未动。
- 身心健康月份分页 1 项：原用「最近 61 天」却要求至少三个自然月，2026-09-01 至 2026-10-31 实际只有两个月。改为预置完整 91 天、选择前 90 天至今天并断言 91 个日期节点，保留至少三个月、翻页、滑动、边界按钮和早期记录详情断言。这是测试数据修正，没有修改日期分组逻辑。
- showcase 登录等待与身心健康按钮动画各 1 项：没有修改其业务逻辑或断言；在后续串行的 91 用例运行中均通过。首次登录未跳转、按钮点击时发生导航的确切原因尚未证实，不将单次复跑通过表述为根因已经修复。
- 上述测试修正与最终修复均经独立只读复审，未发现阻断问题。

### 浅色基线与未验证范围

干净的 `HEAD=3f6d4c2` 导出到临时目录后，用 5293 端口复现浅色截图失败：当前与干净 HEAD 都是 1290×398，而旧基线为 1290×408。两次实际渲染的 RGB 差异仅位于右上角玻璃按钮（本次默认玻璃参数变化），其余区域一致。已查看桌面和手机的候选图；手机标题折行也是已有字号变化的一部分。候选图只生成在临时目录，仓库的两张浅色基线保持原样，因此设计系统仍有 1 项失败。本轮未更新任何快照。

未运行真实后端 e2e、真实底图网络、生产验收、Firefox（未安装）与真机 Safari；未验证经典滚动条的真机绘制及 Linux 字体下的 1360px 余量。公开页面的账户头像仍沿用被查看跑者的展示资料，而非另取登录者头像；本轮未改动该行为。没有推送、合并、迁移或部署。
