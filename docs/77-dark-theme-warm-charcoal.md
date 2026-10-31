# 77 深色外观改为暖炭灰

日期：2026-10-30。设计见 `docs/superpowers/specs/2026-10-30-dark-theme-warm-charcoal-design.md`，计划见 `docs/superpowers/plans/2026-10-30-dark-theme-warm-charcoal.md`。本地实现，尚未发布到生产。下文保留本阶段的历史结果，最终修复后的验证见 [顶部导航续接验收](78-top-navigation.md#2026-10-31-续接验收)。

## 使用方式

- 用法没有变化：外观仍按 `runnote-theme` 偏好和系统外观决定，手动明暗切换与恢复自动照旧；没有新增设置项。
- 深色下的页面、卡片、边框、文字、悬浮玻璃由偏绿的深森林色改为中性偏暖的炭灰（背景 `#292725`、卡片 `#33312f`，越悬浮越浅），薄荷绿 `#77d4ac` 与黄色页头只用于强调。令牌值见 `docs/design-system/tokens.md`。
- 深色令牌块同时服务 `[data-poster-theme="dark"]`，路线海报与活动海报的夜间版随之换色。
- 桌面顶部条里的玻璃按钮改用中性玻璃令牌（浅色下也随之变成中性白玻璃）；新增 `--sport-brand` 作为 Logo 方块底色；本地路线地图的深色背景由 `#19271f` 改为 `#302e2c`（`frontend/src/lib/api/map-style.ts` 里 `createRouteMapStyle` 与 `applyMapTheme` 共用同一个 `routeMapBackground`），路线线条与点颜色不变。
- 数据颜色不变：`--calendar-1..4`、`--chart-series`、轨迹区分色、`--well-*`、状态色前景与边框。

## 接口与隐私

不改接口、权限、数据与迁移，不新增请求。外部底图仍只向 OpenFreeMap 请求公开样式与视口瓦片，轨迹 GeoJSON 仍留在浏览器内。

## 验证记录

命令均在 `frontend/` 下实际执行；Playwright 用独立端口 8291/5291（临时配置 `playwright.tmp-8291.config.ts`），不触碰他人占用的 8191/5191，不连后端与开发库。

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 679 个文件，0 错误，0 警告 |
| `pnpm test`（Vitest） | 43 个文件、281 个用例全部通过 |
| `pnpm build` | 成功（既有大 chunk 警告属已知状态） |
| UI 规格合集（top-navigation、ui-shell、milestones、activities、sport-detail、liquid-glass、crossbrowser-glass、admin-users、dashboard、records、theme、site-settings、wellbeing、dashboard-explorer） | 231 通过、3 跳过（规格自带的 skip）、2 失败，见下 |
| 地图、海报与相关规格（footprints、map-framing、basemaps、footprint-card-deck、records-banner、p2、tcx、activity-metrics、route-poster、activity-poster） | 147 通过、1 失败，见下 |
| `playwright.design-system.config.ts` | 8 通过、1 失败（浅色基线，见下） |

失败项的处理：

- `dashboard-explorer` “slow reads”：已知的偶发项，未处理。
- `top-navigation` “当前链接在深色顶部条上可读”：整套里失败一次（读取到颜色过渡中间值 235,235,232，目标 242,240,238），单独重跑 3 次均通过（每次 2 通过）。判断为主题切换后颜色过渡的时序偶发，未改规格。
- `records-banner` “mid-width ... totals strip”：稳定失败（重跑 2 次）。原因是工作区里尚未提交的顶部导航改动移除了 15rem 侧栏，1100px 视口的内容区变宽（1034px）后三张卡片同排，规格仍假定“两张并排、总计条在下”。同一规格在 HEAD 的干净导出上通过。与本次换色无关，属顶部导航改动需要另行处理的规格；本次未改。
- `route-poster` “海报外观可固定为日间或夜间”：原先硬编码旧夜间色（背景 16,26,22；卡片 27,41,34；页头 88,71,30），本次随令牌改为 41,39,37 / 51,49,47 / 84,69,29（意图不变：夜间海报取深色令牌），改后通过。

### 像素基线

- 先在 `git archive HEAD` 导出的干净副本（独立端口 5293）上渲染同一规格：**HEAD 上浅色、深色两张 `composition-*` 基线本来就已失败**，实际渲染 1290x398，基线是 1290x408，从截图看是展示页的标题、数字比基线小一档，推测与此前的字号阶梯统一（`856fcc5`）有关、基线没有随之刷新（未逐提交二分确认）；深色手机基线同理（实际 358x844，基线 358x810，标题在 390px 宽度下折行）。这些漂移与本次改动无关。
- 工作区与 HEAD 的浅色实际渲染逐像素相同（差异包围盒为空），说明本次令牌改动没有改变浅色展示页。
- 深色：逐张查看了基线图与新渲染图，除上述既有布局漂移外，变化只有配色：背景、卡片、玻璃按钮、说明文字改为暖炭灰，页头为 `#54451d` 黄褐，成功提示仍是浅绿底（`--success-soft` 色相不变，属状态色）。已用 `-g "dark component composition" --update-snapshots` 只更新了 `composition-dark-darwin.png` 与 `composition-dark-mobile-darwin.png` 两张，**已审阅**；这两张因此同时记录了既有的字号漂移（手机图里标题折成两行）。
- 浅色基线 `composition-light-darwin.png` 与 `composition-light-mobile-darwin.png` **没有更新**，仍是过期状态，需用户决定是否刷新。浅色用例因此在截图断言处中止，后面的 `rgb(255, 255, 255)` 与对比度断言、手机截图在本次没有被执行。
- 深色用例更新后整条通过，包括新值 `rgb(51, 49, 47)` 和对比度 ≥ 4.5 断言。

### 截图（已查看，存于会话临时目录）

深色路线海报对话框、深色活动海报对话框（1440x800）、深色活动详情页的本地路线地图：表面均为暖炭灰，无残留绿色底面，文字清晰，海报预览里黄褐页头与薄荷路线可读；本地地图背景为 `#302e2c`，路线与起终点标记可读。另在前一轮用合成数据查看过深色的仪表盘、活动列表、身心健康、设置、移动菜单（361px）与浅色仪表盘，浅色除顶部条按钮变中性白玻璃外无变化。

### 未运行与未确认

- Safari / WebKit：未验证。顶部条玻璃使用 SVG 折射与 `backdrop-filter`，Safari、iOS 与 Firefox 的深色呈现没有逐一检查（`crossbrowser-glass` 规格只在 Chrome 通道运行）。
- `node tests/fixtures/check-showcase-isolation.mjs`：8191、5194 空闲，已运行；构建产物的展示标识检查通过，随后在“等待 5194 上 `/login` 返回 200”处超时。按项目规则旧 `/login` 已返回 404，该脚本的就绪探测已过时，后四个 404 检查没有执行。这是既有问题，本次未改。
- 真实后端 e2e（`*-e2e.config.ts`）、`seo-routes`、`basemaps-live`（真实底图网络）、`showcase-build`、`admin-users-build` 等配置未运行。
- 外部 OpenFreeMap `dark` 底图与本地背景 `#302e2c` 之间切换会有轻微色差，接受。
- 站点设置“预览”小面板（`.preview-side`）原先仍用旧的绿色侧栏色 `--sport-sidebar`，后来在 `docs/78` 的收尾修正里改成顶部导航的缩略样（`--surface` 底、`--border` 边、`--sport-brand` Logo 方块、`--foreground` 站点名），此条已解决。
- 开发服务（他人窗口的 8191/5191）未重启，新样式只在隔离端口上验证过，不等价于生产验收。
