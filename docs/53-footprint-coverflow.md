# 本次足迹卡片：双侧 3D 堆叠

## 使用方式

活动详情的“本次足迹卡片”保持原来的介绍、按钮、白绿配色、圆角、边框、阴影、字体及 9rem 卡片基础宽度。按最新要求，所有卡片统一显示尺寸，取消侧卡缩小、后移和 Y 轴侧转，保留重叠排列、弹簧移动及中央指针反馈。两侧各最多四张真实记录，按实际容器宽度减少侧卡，320/390px 手机仅显示中央卡片。新记录在左、旧记录在右，首尾有界，不复制或循环；边界缺少记录的一侧自然留空。下方增量章节保留各轮历史证据，以文末最新修正为准。

拖动、触摸横滑、触控板横滑及方向键只浏览卡片；点击卡片、左右箭头或在聚焦卡片上按 Enter/Space 才确认切换整条跑步记录。浏览中心与当前详情分别记录，滑动不改标题、指标、大地图或 URL。刷新后返回原列表或足迹墙页码的行为保留。纵向手势仍用于页面滚动，横滑后抑制误点击。

中央卡片跟随鼠标轻微双轴倾斜（X 轴 5°、Y 轴 6°），附低透明度白色高光和小幅路线/文字视差，鼠标离开以弹簧恢复。侧卡不启用指针反馈。触屏关闭倾斜；减少动态效果时立即定位并关闭指针反馈，导航仍可使用。保留项目既有手动/系统外观，不引入玻璃卡片或新动画依赖。

## 改动范围

- 前端 `src/lib/components/ActivityWallPreview.svelte`：右侧居中堆叠、按宽度调整窗口与缓冲卡、过渡结束清理、方向键/触摸入口；保留既有列表缓存、排序、请求令牌、错误与完整记录回调。
- 前端 `src/lib/styles/coverflow.ts`：封装几何、共享索引弹簧及输入 action。按透视投影后的卡片边缘限制水平位移，避免越过视口与箭头。`windowVersion` 使同中心的异步 resize 结果也能触发清理。
- 前端 `src/lib/styles/card-tilt.ts`、`src/lib/components/WallCard.svelte`：复用原卡片内容，以局部 CSS 变量实现中央倾斜、高光与克制视差；指针移动不写 Svelte 页面状态。
- 测试 `tests/unit/coverflow.test.ts`、`tests/ui/footprint-card-deck.spec.ts`：几何、连续旋转、中央反馈、两侧选择、连续切换、键盘、真实 Chrome touch、减少动态效果、resize 清理与卸载等。
- 文档：设计、计划、组件目录和本验收记录。原 `51-footprint-card-deck.md` 保留为前一版本的历史证据。

初版没有修改活动详情页面；后续懒加载增量更新了该页面的路线加载时序，见文末。后端、接口契约、数据库、代理或依赖清单均未修改。共享工作区中的底图、设计系统与其他既有修改均保留。

## 接口与隐私

复用本人活动列表、详情与路线接口，不重写足迹业务或生成权威运动指标。切换保持单请求在途保护；动画中的后续成功切换直接重定向同一弹簧，不排动画队列。路线缩略图仍是浏览器内 SVG，不增加外部服务请求。

减少动态效果、空闲 resize 与正常动画结束都清理离场窗口；不可见缓冲卡 `inert` 且 `aria-hidden`。卸载停止弹簧、移除指针/键盘/媒体监听器、释放 pointer capture 并断开 observer。401、过期响应丢弃、失败重试和原生按钮语义保留。

## 验证记录

2026-10-16，原生 Node/pnpm、真实 Chrome、合成 API。UI 配置继承仓库 `playwright.ui.config.ts`，使用独立 8292/5292 端口和临时 Vite 缓存，不连接开发数据库。

| 实际执行 | 本次结果 |
| --- | --- |
| `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts` | 20 passed，35.3s |
| 最后 CSS 选择器修正后，上述配置加 `--grep 'rapid changes\|coverflow reduces\|reduced motion prunes'` | 3 passed，8.7s |
| `pnpm exec playwright test --config /private/tmp/runnote-coverflow-regression.config.ts` | 81 passed / 1 failed，2.8m；覆盖卡片、活动列表/管理、足迹地图、里程碑、运动详情及主题 |
| 上述扩展配置加 `--grep 'device theme applies'` | 失败的登录主题草稿用例单独复测 1 passed，8.5s |
| `pnpm test` | 24 files / 142 tests passed；含 4 项 Coverflow 几何测试 |
| `pnpm check` | 最终 0 errors / 0 warnings |
| `pnpm build` | adapter-node 构建成功，保留既有大 chunk 提示 |
| 本次 tracked 路径 `git diff --check` 与新增文件空白检查 | 通过 |
| 全仓 `git diff --check` | 退出 2：未在本次编辑范围的 `map-style.ts:74` 有 EOF 空行，保留原样 |

扩展运行的失败为 `theme.spec.ts:87`：登录页明暗切换后邮箱草稿预期值未保留；没有更改相关源文件或该用例，单独复测通过。原因未确认，不能据复测把原扩展运行记为全绿。运行中还观察到既有 `replaceState` 弃用提示。

实现前真实浏览器断言曾证明侧卡未旋转、缺少视差与方向键；旋转连续性测试曾测出接近中央时约 28° 的跳变，现改为从 0 连续增长。审查发现减少动态效果下旧节点累积，新增连续浏览测试实际红灯（10 > 9）后修复；resize 收缩也补了节点清理断言。最终审查没有新增重要问题。

实际检查宽度 1920/1100/768/390/320，断言卡片投影位于右侧视口内、箭头与视口分离、主卡内容无遮挡、页面不横向溢出。20 项专项含真实触摸横滑/纵向滚动、快速反向、首尾、跨列表页、同日期排序、401、迟到路线、失败重试、刷新及原墙页返回。人工查看了桌面、触屏与深色截图。

本地截图位于 `/private/tmp/runnote-coverflow-evidence/`：`coverflow-1920.png`、`coverflow-390.png`、`coverflow-320.png`、`coverflow-touch.png`、`coverflow-boundary.png`、`stack-mobile-dark.png`。均为合成数据，不写入仓库。

## 未运行与验收边界

未运行真实后端 E2E、数据库测试、后端测试、Safari/Firefox 或真实手机硬件验收；未重启开发服务，未提交、推送或部署。Chrome 合成 API 验收不等于真实业务库和生产验收。测试与构建针对当前共享工作区，其他并行改动的历史验证见各自文档。

## 后续增量：点击懒加载与九卡

按追加要求，宽屏最多显示 9 张（中央 1 张、两侧各 4 张），比初版增加两张；卡片尺寸与原有样式不变，窄屏继续按容器空间减少卡片。

`WallCard.deferRoute` 转交 `RouteThumbnail.deferred`，仅在详情卡片启用。未选中的路线不再自动下载，显示“选择后加载路线”；选中后复用详情的路线请求，已绘制且仍留在窗口中的缩略图可继续显示。普通足迹墙仍按进入视口加载。

详情 `switchActivity` 按点击读取目标详情，提交指标、卡片与 shallow URL 后独立调用 `loadRoute`。路线等待、失败及重试仅影响路线区域；下载期间可以继续选择记录，原有请求令牌隔离迟到路线，401 清理与来源返回不变。后端、接口与数据库无变化。

新增 Chrome 断言验证：全体相邻记录均有轨迹时，首屏仍只请求当前记录路线；目标路线人为延迟时，卡片、指标、URL 和可操作状态先更新；路线到达后绘制。另一用例验证慢路线期间继续切换，旧响应不能覆盖新详情。新增九卡几何测试先实际红灯（半径 3 而非 4），浏览器先实际红灯（7 张而非 9），再完成实现。

本轮前端变更为 `coverflow.ts`、`ActivityWallPreview.svelte`、`WallCard.svelte`、`RouteThumbnail.svelte` 与详情 `+page.svelte`，测试为 Coverflow 单测和卡片 UI；设计/计划/组件目录同步更新。没有重写足迹业务或引入依赖。

2026-10-16 本轮实际验证：

- `pnpm exec playwright test --config /private/tmp/runnote-coverflow-regression.config.ts footprint-card-deck.spec.ts activities.spec.ts activity-management.spec.ts milestones.spec.ts sport-detail.spec.ts`：59 passed（1.5m），其中卡片 22 项；合成 API + 真实 Chrome，无数据库写入。
- `pnpm exec vitest run tests/unit/coverflow.test.ts`：5 passed；`pnpm test`：24 files / 143 tests passed。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：退出 0，adapter-node 构建完成；保留既有大 chunk 提示，日志 `/private/tmp/runnote-coverflow-lazy-build.log`。
- 全仓 `git diff --check`：退出 0，本轮复核时此前其他文件的空白问题已不存在。
- 只读审查无新增重要问题。桌面 9 卡和手机截图已人工查看，证据位于 `/private/tmp/runnote-coverflow-lazy-evidence/`。

本轮没有重跑主题与足迹地图整套测试；未运行真实后端/数据库 E2E、其他浏览器或部署验收。原有明暗模式与卡片尺寸保留；没有提交或推送。

## 后续修正：侧卡恢复自动路线预览

用户截图指出侧卡全部显示“选择后加载路线”。原因是上次把点击懒加载同时用于了缩略图，详情堆叠统一传入 `deferRoute`，阻止了 `RouteThumbnail` 原有的视口加载。

取消 `ActivityWallPreview` 的该开关，并从 `WallCard` / `RouteThumbnail` 移除这一轮新增的 deferred 选项及占位文案，恢复进入视口自动绘制路线。仍只读取有界卡片窗口（含相邻缓冲），不加载全部历史；九卡排列、点击后完整详情/大路线独立加载、原页返回及后端接口均保留。

浏览器用例改用九条都含路线的记录，修复前实际失败于第一张侧卡缺少路线 SVG；修复后逐张验证九个预览，且未选中时不请求各自完整活动详情。点击后人为延迟大路线，仍验证记录/URL/卡片先切换，路线到达后显示。桌面截图已人工查看，保存于 `/private/tmp/runnote-nine-route-previews.png`。

2026-10-16 本轮实际执行 `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts`：22 passed（31.4s），覆盖自动预览、慢路线切换、手机输入和来源页返回。其他验证和限制沿用本节补充记录，不将上轮扩展测试计作本轮执行。

本轮 `pnpm test`：24 files / 143 tests passed；`pnpm check`：0 errors / 0 warnings；`pnpm build`：退出 0、adapter-node 完成，仍有既有大 chunk 提示；`git diff --check`：退出 0。未运行真实后端/数据库 E2E 或上轮 59 项扩展回归，未重启开发服务、提交或部署。没有后端、接口与数据库改动。

## 后续增量：桌面滑动与有界列表缓存

卡片区域新增鼠标主键左右拖动、触控板横向滑动，继续保留触屏横滑、方向键、箭头和侧卡点击。每次拖动最多切换一条；横向 wheel 累计 48px 后切换一条，同方向惯性事件不连续触发，180ms 没有横向事件后视为新手势，反向可立即返回。只处理卡片视口内以水平方向为主的 wheel，保留纵向页面滚动和 Ctrl 缩放；首尾有界，无循环和越界详情请求。卸载移除全部新增监听器并释放捕获。

加载限制区分如下：

- 同屏最多 9 张，容器不足时减少；稳定窗口前后各缓冲 1 张，最多挂载 11 张。
- 每次列表请求 `limit=20`；列表摘要采用 LRU，最多缓存 3 页（60 条），命中近页不重复查询。继续向两侧浏览仍可查看全部记录；旧页被淘汰，回到该范围才按需重读。
- 初次直接打开较旧记录时沿用已有二分定位，可能需要多次列表请求；不会一次下载全部历史。窗口从本次读取结果组装，不依赖可能被淘汰的缓存。
- 动画中保留实际可见位置、上一目标和新窗口之间的已读路径卡片，避免快速跨卡时缺卡；瞬态节点可超过 11，结束后清理到稳定窗口。保留已有节点不产生额外的历史批量预读。
- 路线缩略图继续进入视口自动加载；完整详情和大路线仍由既有选择逻辑独立读取。20/60 的限制针对列表返回量与摘要缓存，不是 SQL 语句数量上限，也不是路线请求数量上限。

前端增量仅涉及 `ActivityWallPreview.svelte`（LRU 和过渡路径保留）、`styles/coverflow.ts`（输入处理），交互测试新增在 `footprint-card-deck.spec.ts`，设计/计划/组件目录同步更新。保留白绿卡片、尺寸、左侧介绍、路线预览、数据源、鉴权、迟到响应隔离、整条记录切换以及来源页码返回；后端、接口、数据库和依赖均未修改。

实现前新增拖动、wheel 和四页缓存淘汰用例均实际红灯。首次兼容回归发现触屏隐式 capture 转移时，子卡冒泡的 lostpointercapture 会错误取消手势；现仅处理导航节点自身的捕获丢失。审查后新增停帧再连续跨四张的用例，实际复现中间卡缺失（最近卡距中央 94.7px），再修正为保留完整已读移动路径。只读复审未发现新增重要问题。

2026-10-16 最终验证（合成 API 8292 + Vite 5292 + 真实 Chrome，无数据库连接）：

| 实际命令 | 本轮结果 |
| --- | --- |
| `pnpm exec playwright test --config /private/tmp/runnote-coverflow-regression.config.ts footprint-card-deck.spec.ts activities.spec.ts activity-management.spec.ts milestones.spec.ts sport-detail.spec.ts` | 65 passed（1.6m），其中卡片 28 项 |
| `pnpm test` | 24 files / 143 tests passed |
| `pnpm check` | 0 errors / 0 warnings |
| `pnpm build` | 退出 0，adapter-node 完成；保留既有大 chunk 提示，日志 `/private/tmp/runnote-coverflow-bounded-build.log` |
| `git diff --check` + 本轮新增源文件/文档逐行尾空白检查 | 通过 |

实际覆盖鼠标左右拖动、横滑惯性只触发一次、间隔后同向继续、立即反向、原生纵向滚动、首尾无越界请求、240 条历史仅随窗口读页、4 页往返触发 LRU 淘汰后重读、24 次连续切换、停帧跨卡动画路径、触屏、键盘、窄屏、减少动态效果、401/失败重试及原墙页返回。最终桌面九卡与手机截图人工检查通过，证据位于 `/private/tmp/runnote-coverflow-regression-results/` 对应用例目录的 `nine-route-previews.png` 与 `coverflow-touch.png`。过程中仍观察到既有 SvelteKit replaceState 弃用提示。

本轮未运行真实后端/数据库 E2E、后端测试、整套主题/足迹地图测试、Safari/Firefox 或真实手机硬件验收；未重启开发服务，未提交、推送或部署。合成 API 浏览器验收不能证明真实业务库的 SQL 性能上限。

## 最新修正：等大卡片、连续浏览与确认选择分离

本节取代前文“滑动切换记录”“每个手势仅一条”以及侧卡逐级缩小的行为描述。

所有卡片统一宽高与投影大小，侧卡不再缩小、后移或侧转。复用原有白绿卡片、内容比例、重叠、共享弹簧和中央指针倾斜/高光/视差。按容器空间调整可见数量，宽屏最多九张；间距保证侧卡中心仍可点击，手机单卡窗口保留真实水平位移。

浏览中心 `browseIndex` 与当前记录 `selectedIndex` 分开：鼠标拖动、触摸横滑、触控板及方向键只移动浏览中心，不调用详情切换回调，不改当前记录、指标、大地图或 URL。点击任意卡片才选择该记录；左右按钮选择浏览中心相邻记录；聚焦卡片可用 Enter/Space 确认。已选中的卡片仍以原有绿色边框与 `aria-pressed` 标识；点击它可重新居中，无需重读详情。

触控板每累计 48px 继续浏览，单事件最多推进四张；拖动按距离推进一至四张。实际单次浏览目标按可见半径限制，读取串行进行，在途的新输入合并为最新有界目标，完成后继续推进，避免加载期间手势被全部丢弃。反向和原生纵向滚动保留；失败停止队列并按浏览操作重试，401 和卸载清理状态。不存在“总共只能查看 60 条”的限制，只有真实历史首尾边界。

加载保护继续采用每页 `limit=20`、三页 LRU 最多 60 条摘要；稳定挂载最多 11 张，动画结束后清理路径节点。进入视口的路线缩略图自动加载，完整详情/大路线仅在确认选择后加载。以上限制不是后端 SQL 数量或所有路线请求的统一上限。

本轮前端文件为 `ActivityWallPreview.svelte`（分离浏览/选择、串行读取队列）、`styles/coverflow.ts`（等大几何与持续输入）、`WallCard.svelte`（独立的居中反馈属性）；测试为 `tests/unit/coverflow.test.ts`、`tests/ui/footprint-card-deck.spec.ts`。同步设计、计划、组件目录及本记录。后端、接口、数据库、依赖、来源返回与原有授权逻辑保持原样，共享工作区其他改动保留。

2026-10-16 本轮实际执行，Chrome 使用合成 API 8292 + Vite 5292，不连接真实后端或数据库：

| 实际命令 | 本轮结果 |
| --- | --- |
| `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts` | 31 passed（47.7s） |
| `pnpm exec playwright test --config /private/tmp/runnote-coverflow-regression.config.ts footprint-card-deck.spec.ts activities.spec.ts activity-management.spec.ts milestones.spec.ts sport-detail.spec.ts` | 68 passed（1.9m） |
| `pnpm test` | 24 files / 143 tests passed |
| `pnpm check` | 0 errors / 0 warnings |
| `pnpm build` | 退出 0，adapter-node 完成；保留既有大 chunk 提示，日志 `/private/tmp/runnote-coverflow-browse-build.log` |

浏览器覆盖等大投影、持续 wheel 连移五张、四十次浏览跨页后仍保留原详情、慢分页期间继续接收输入且不重复读取该页、浏览失败重试、点击已选侧卡重新居中、拖动/触摸不改详情与 URL、点击/箭头/键盘确认，以及原有 LRU 淘汰、401、迟到路线、来源页返回和减少动态效果。实现前对应断言实际复现拖动改详情、wheel 惯性只动一次、卡片宽度相差约 72px 及手机水平位移为零。等大布局初版遮挡侧卡中心，已调整容器半径计算，并通过点击回归。只读复审无新增重要发现。

本轮桌面九卡与手机截图已人工查看：`/private/tmp/runnote-coverflow-regression-results/` 对应用例目录下的 `nine-route-previews.png` 与 `coverflow-touch.png`。本轮仍观察到既有 SvelteKit replaceState 弃用提示。未运行真实后端/数据库 E2E、后端测试、整套主题/足迹地图测试、Safari/Firefox 或真实手机硬件验收；未重启开发服务、提交、推送或部署。

## 截图反馈修正：缺失指标导致卡片变矮

2026-10-16 用户截图显示，缺失用时/配速的中央卡片仍比相邻完整记录矮。上轮只统一了空间变换，尺寸回归使用相同指标数据，未覆盖内容自身撑开高度的差异。实际根因是 `.wall-facts` 使用可换行 flex：完整指标自动排成两行，而“用时 — / 配速 —”能并排占一行；堆叠网格又使用 `align-items:start`，允许各卡片保持不同内容高度。

本轮只改两处样式：`WallCard.svelte` 中交互卡片的用时/配速始终上下各一行；`ActivityWallPreview.svelte` 中堆叠网格拉伸同排卡片为等高。没有固定写死卡片高度，没有改变普通足迹墙卡片的指标排列，也没有修改浏览/确认选择、懒加载、缓存、接口或数据库。

新增 `footprint-card-deck.spec.ts` 的混合指标回归，使用完整指标、缺失指标、100 小时记录、长标题以及有/无路线的合成数据。修复前真实 Chrome 失败，实测高度差 `23.796875px`；修复后在 1920/1100/390 宽度验证所有挂载卡片高度差小于 1px，用时/配速各自独占一行且无裁切，再选择长时记录复核高度。桌面/手机截图已人工查看，位于 `/private/tmp/runnote-card-deck-final-results/footprint-card-deck-mixed--4e1bd-ights-and-fact-rows-aligned/equal-mixed-metrics-{1920,390}.png`。

本轮实际执行：

- `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts --grep 'mixed missing'`：修复前 1 failed；修复后 1 passed（3.9s）。
- `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts`：32 passed（49.3s），合成 API + 真实 Chrome。
- `pnpm test`：24 files / 143 tests passed。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：退出 0，adapter-node 完成，保留既有大 chunk 提示；日志 `/private/tmp/runnote-card-height-build.log`。
- `git diff --check` 及本轮新增文件逐行尾空白检查：通过。

32 项浏览器断言均通过，但运行日志仍有 SvelteKit replaceState 弃用提示，并出现一次 MapLibre `Cannot read properties of undefined (reading 'projection')` 渲染错误；根因未确认，本轮未修改地图实现，不将测试通过表述为控制台无错误。未运行真实后端/数据库 E2E、后端测试、全部其他 UI 套件或 Safari/Firefox；未重启开发服务、提交、推送或部署。共享工作区其他未提交改动保留。

## 授权提交前的独立快照复核

2026-10-16 用户明确要求“提交推送”。仅暂存足迹墙密集分页、来源返回、紧凑详情、等大卡片浏览与确认选择交互，以及相关测试和本系列设计/计划/验收文档，共 29 个文件。对布局、全局样式、玻璃增强入口、UI 配置及共用夹具按差异片段暂存，其他底图、设计系统、弹窗/导航动画和 `AGENTS.md` 改动保留在工作区；不纳入密钥、数据库文件、截图或临时配置。

从暂存区导出独立快照 `/private/tmp/runnote-footprint-publish-3issptnb`，复用本机已安装依赖，不读取/复制 `.env`，不连接真实后端或数据库。快照使用自己的 SvelteKit `$app` 生成类型；最初整体链接 node_modules 时类型目录解析到了原工作区，拆出本地生成目录后检查通过。直接调用安装好的 CLI，避免 pnpm 对临时目录触发自动依赖检查/安装。

| 在快照 frontend 目录实际执行 | 结果 |
| --- | --- |
| `./node_modules/.bin/svelte-kit sync && ./node_modules/.bin/svelte-check --tsconfig ./tsconfig.json` | 0 errors / 0 warnings |
| `./node_modules/.bin/vitest run` | 21 files / 135 tests passed；不包含留在工作区的其他功能单测 |
| `./node_modules/.bin/vite build` | 退出 0，adapter-node 完成，保留既有大 chunk 提示；日志 `/private/tmp/runnote-footprint-publish-build.log` |
| `./node_modules/.bin/playwright test --config /private/tmp/runnote-footprint-publish.playwright.config.ts` | 69 passed（1.8m）；活动列表/管理、原页返回、卡片、里程碑及运动详情，真实 Chrome + 合成 API |
| `git diff --cached --check`、显式文件清单与新增内容密钥特征检查 | 通过 |

本次独立快照未包含其他线程的 OpenFreeMap 底图升级，仍沿用已提交的 OSM 底图实现。浏览器运行观察到既有 replaceState 弃用提示；未运行真实后端/数据库 E2E、Safari/Firefox、部署或生产验收。此前章节的“未提交/未推送”是各轮实现完成时的历史状态，本节记录用户授权后的提交前检查。
