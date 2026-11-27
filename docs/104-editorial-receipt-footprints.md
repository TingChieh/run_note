# 104 · Editorial Receipt Web 迁移（第三页）：个人足迹 `/footprints` 与城市探索 `/footprints/exploration`

延续 [101 · Editorial Receipt 第 1 阶段](101-editorial-receipt-phase1.md)、[102 · 跑步记录列表](102-editorial-receipt-activities.md)、[103 · 活动详情](103-editorial-receipt-activity-detail.md) 与 [brand.md](design-system/brand.md)（§2 档案页、§3–§6、W-02/W-04/W-06/W-09/W-11/W-17）的按页迁移计划，本 PR 将 Web 个人足迹页 `/footprints`（同步覆盖直接复用的 `/workspace/footprints`、`/p/[username]/footprints`）及城市探索页 `/footprints/exploration`（同步覆盖 `/workspace/footprints/exploration`）迁移至 Editorial Receipt 档案页语言。不新增或重复路由，不改动后端代码、数据库迁移、API 契约、权限、CSRF、数据计算、版本文件或发布流程。

## 使用方式

- **页面级 opt-in 与玻璃边界（`brand.md §8.1`）**：
  - `/footprints` 包裹在 `.editorial-page.footprints-page`，`/footprints/exploration` 包裹在 `.editorial-page.exploration-page`；两页内 `--radius-control` 为 `10px`，内容区按钮与视图切换采用平面印刷风格（无 Liquid Glass、无阴影），全局顶部悬浮玻璃导航（≥800px）与手机底部 Tab 栏（<800px）保持不变。
  - `FootprintMap` 与 `ExplorationMap` 新增可选 `appearance?: 'default' | 'sheet'`（默认 `'default'`，`/together` 等未迁移调用方保持原样）；在 `appearance="sheet"` 下，地图外框采用 `4px` 细框（`--radius-sheet`）并显式标注 `data-glass-overlay`，使地图内浮动控件（`BasemapPicker`、缩放控件、视野复位芯片、触屏确认条）继续保留 Liquid Glass 材质。
- **个人足迹 `/footprints`（轨迹叠加 / 运动热力图）**：
  - 复用 `PageHeader`（紧凑淡奶油黄/暖炭灰底色、28px `h1` + 单行等宽 `meta` 显示范围与路线计数、右侧平面「重新读取足迹」按钮），移除叙述性副标题（W-09）。
  - 页头下方改为 Editorial Receipt 下划线视图标签（`.footprints-tabs-bar` + `.underline-tabs`）：「轨迹叠加」「运动热力图」，并在已登录且具备管理权限（`page.data.user && view.manage`）时并排提供「城市探索」标签链接（匿名展示与 `/p/{username}/footprints` 仍隐藏该入口）；移除旧版页头内胶囊分段（`.settings-tabs`）与大面积按钮堆叠，显著提前地图首屏可见位置。
  - `FootprintMap appearance="sheet"` 在桌面端（≥1024px）将「回到全部足迹」与客户端识别的城市快跳按钮合并在同一紧凑工具栏（选中城市使用高对比墨色填充，窄屏 <1024px 维持「城市」折叠下拉选择器）；底图失败/后台更新失败/极区截断提示改为 3px 左边线状态条（`.status-strip`）；热图图例、可显示记录列表与热区数据表改用 `1px` 发丝线分组与等宽数字。
  - **数据诚实性说明**：静态原型 [web-footprints-1440-light.png](design-system/prototypes/screenshots/web-footprints-1440-light.png) 将轨迹/热图与城市里程/探索格网右栏合绘在同一概念稿中。在实际产品架构中，`/footprints` 为匿名可访问的公开展示入口，后端 `/api/v1/showcase/footprints/all` 仅返回轨迹/热图 GeoJSON、总活动数、可见活动数与生成时间，不包含城市里程分摊、年度筛选或 100 m 探索格网统计（这些数据属于需认证的 `/api/v1/me/footprints/exploration/*`）；遵循 `brand.md §1`「真实数据，不虚构图形」与本 PR 不改后端/API 的约束，`/footprints` 仅如实展示上述真实字段，完整的三联摘要、城市图鉴与逐月新探索格网图均在 `/footprints/exploration` 中承接。
- **城市探索 `/footprints/exploration`（对齐原型双栏账页）**：
  - 紧凑 `PageHeader`（等宽 `meta` 显示年份、边界内城市数与城市内里程，右侧平面「返回运动足迹」链接）+ 顶部筛选栏（左侧 `.underline-tabs` 切换「覆盖热图 / 首次探索」，右侧「范围」「年份」选择器）。
  - ≥1024px 采用左主右辅双栏（`minmax(0, 1fr) 22.5rem`，<1024px 降为单栏地图在上、摘要与列表在下）：
    - 左侧地图舞台去除 24px 白色卡片外框，以 `ExplorationMap appearance="sheet"`（`4px` 细框、桌面约 620px 高度、`BasemapPicker` 与视野复位按钮置于左上角玻璃浮层区）作为主体；下方保留精简图例与「关闭外部底图」入口。
    - 右侧依次为：① `2px` 墨色节线 + 竖发丝线三联摘要（`.fp-sum`，去除 W-02 彩色圆形图标与 24px 指标卡，完整保留全域/区域/边界城市/附近匹配城市四类语义与 `<dt>附近有记录</dt>`）；② `2px` 节线「城市图鉴」（下划线类别筛选「全部 / 跑过 / 附近」、搜索框、排序选择器、发丝线城市行、纯文字「首跑 / 附近」标记，以及按服务端 `distance_m` 计算的 `3px` 里程比例条）；③ `2px` 节线「覆盖趋势」（直角细柱、`--receipt-mark` 峰值黄柱配浅色 1px 墨色描边与峰值数字/粗体月标、零值 `2px` `--border` 短线，以及可展开的逐月数据表）。
    - 底部保留 `1px` 发丝线数据质量脚条（未分配跑量、无轨迹活动、未归入城市、附近有记录的城市）与可折叠「统计口径」。

## 改动范围

| 区域 | 文件 | 意图 |
| --- | --- | --- |
| 个人足迹主页面 | `frontend/src/routes/footprints/+page.svelte` | 迁移为 `.editorial-page.footprints-page`：紧凑页头 + 等宽 `meta`、下划线视图切换 + 权限受控「城市探索」标签、状态条、发丝线热图图例与说明 |
| 足迹地图组件 | `frontend/src/lib/components/FootprintMap.svelte` | 新增可选 `appearance?: 'default' \| 'sheet'`（默认 `'default'` 不影响 `/together`）：`4px` 地图外框、`data-glass-overlay` 玻璃边界、单行紧凑城市工具栏、墨色激活态、发丝线记录与热区表 |
| 城市探索主页面 | `frontend/src/routes/footprints/exploration/+page.svelte` | 迁移为 `.editorial-page.exploration-page`：去 24px 卡片与彩色指标图标，改为 `2px` 节线三联摘要（`.fp-sum`）、双栏地图 + 360px 右栏、下划线筛选、比例条城市图鉴、峰值黄直角柱趋势图与底部质量脚条 |
| 城市探索地图组件 | `frontend/src/lib/components/ExplorationMap.svelte` | 新增可选 `appearance?: 'default' \| 'sheet'`：`4px` 细框、桌面 620px 高度、`data-glass-overlay` 与左上角玻璃 `BasemapPicker` 浮层 |
| 测试与验收资产 | `frontend/tests/ui/footprints.spec.ts`、`frontend/tests/ui/city-exploration.spec.ts`、本文及 `docs/assets/2026-11-27-editorial-receipt-footprints/` | 将 `/footprints` 模式切换断言从旧 `.settings-tabs` 重定向至 `.underline-tabs` 契约（保留浅/深色、降低透明度与无玻璃模块回退全部用例，并补充 4px 地图框/10px 平面按钮/`data-glass-overlay` 断言）；将 `/footprints/exploration` 响应矩阵扩展至 320/390/768/1440 × 浅/深色并验证无彩色图标、三联摘要、峰值柱与比例条；留存修改前后合成截图 |

未改动：后端代码、数据库迁移、API 契约、权限与 CSRF、离线缓存逻辑、权威指标计算、版本号文件、`CHANGELOG.md`、发布 workflow、全局顶部导航、`/together` 中 `FootprintMap` 默认外观，以及未迁移的回顾/年度故事/设置页。

## 接口与隐私

不新增或修改任何接口路径、查询参数、权限或 CSRF 校验。`/footprints` 继续读取 `/api/v1/showcase/footprints/all`（含 `/p/{username}/footprints` 具名展示与 `/workspace/footprints`），离线缓存命名空间与 401 跳转不变；`/footprints/exploration` 继续读取需认证的 `/api/v1/me/footprints/exploration/*`，默认仅本地轮廓零外部瓦片请求。所有测试与截图均使用确定性合成数据，不含真实轨迹或用户信息。

## 验证记录（2026-11-27，本机 Linux，Node 24.18，Chrome，Playwright 1.65）

| 命令（`frontend/`） | 结果 |
| --- | --- |
| `./node_modules/.bin/svelte-kit sync && ./node_modules/.bin/svelte-check --tsconfig ./tsconfig.json` | 0 errors / 0 warnings |
| `./node_modules/.bin/stylelint "src/**/*.{css,svelte}" "tests/fixtures/**/*.{css,svelte}"` | 通过 |
| `./node_modules/.bin/vitest run` | 80 files / 528 tests passed |
| `./node_modules/.bin/vite build` | 成功（仅既有大体积 chunk 警告） |
| `node tests/fixtures/check-showcase-isolation.mjs` | PASS（1057 files，无 showcase 产物，5 路径均为 404） |
| `playwright test --config playwright.city-exploration.config.ts` | 13 passed / 0 failed（含 320/390/768/1440 × 浅/深色总览与城市下钻、URL 持久化、海外聚焦、触屏确认条、空/错/401） |
| `playwright test --config playwright.ui.config.ts tests/ui/footprints.spec.ts tests/ui/ui-shell.spec.ts tests/ui/liquid-glass.spec.ts` | 75 passed / 0 failed（覆盖 `/footprints` 全部 35 条回归、下划线切换与回退、低缩放聚合、键盘/焦点与玻璃边界） |
| `playwright test --config playwright.ui.config.ts tests/ui/basemaps.spec.ts tests/ui/map-framing.spec.ts tests/ui/theme.spec.ts tests/ui/mobile-tabbar.spec.ts tests/ui/first-read-preload.spec.ts` | 48 passed / 0 failed（底图切换、小环线取景、深浅主题、手机底部栏、首读预加载） |
| `playwright test --config playwright.together.config.ts` | 21 passed / 0 failed（确认 `/together` 复用 `FootprintMap` 默认外观未受影响） |
| `playwright test --config playwright.showcase.config.ts` | 7 passed / 0 failed（匿名展示只读与权限边界） |

### 视觉验收矩阵（合成数据，4 视口 × 浅/深色）

1440×900、768×1024、390×844、320×640 四档视口在浅色与深色模式下，`/footprints` 与 `/footprints/exploration` 横向溢出均为 0、控制台/页面错误为 0，无裁切、重叠或日期折行问题。

#### 1. 个人足迹 `/footprints`

| 视口 / 主题 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-1440-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-light.png) |
| 1440×900 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-1440-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-dark.png) |
| 768×1024 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-768-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-768-light.png) |
| 768×1024 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-768-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-768-dark.png) |
| 390×844 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-390-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-390-light.png) |
| 390×844 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-390-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-390-dark.png) |
| 320×640 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-320-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-320-light.png) |
| 320×640 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-footprints-320-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-footprints-320-dark.png) |

状态与整页核对：[1440 浅色整页](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-light-full.png)、[1440 深色整页](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-dark-full.png)、[运动热力图模式](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-light-heatmap.png)、[空状态](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-light-empty.png)、[错误状态](assets/2026-11-27-editorial-receipt-footprints/after-footprints-1440-light-error.png)。

#### 2. 城市探索 `/footprints/exploration`

| 视口 / 主题 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-1440-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-1440-light.png) |
| 1440×900 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-1440-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-1440-dark.png) |
| 768×1024 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-768-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-768-light.png) |
| 768×1024 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-768-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-768-dark.png) |
| 390×844 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-390-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-390-light.png) |
| 390×844 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-390-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-390-dark.png) |
| 320×640 浅色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-320-light.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-320-light.png) |
| 320×640 深色 | ![](assets/2026-11-27-editorial-receipt-footprints/before-exploration-320-dark.png) | ![](assets/2026-11-27-editorial-receipt-footprints/after-exploration-320-dark.png) |

整页与下钻态核对：[1440 浅色整页](assets/2026-11-27-editorial-receipt-footprints/after-exploration-1440-light-full.png)、[1440 深色整页](assets/2026-11-27-editorial-receipt-footprints/after-exploration-1440-dark-full.png)、[青岬市 100m 格网下钻态](assets/2026-11-27-editorial-receipt-footprints/after-exploration-1440-light-city.png)。

## 未验证项与剩余风险

- **真实后端 E2E（`playwright.config.ts`，含 `tests/e2e/city-exploration.spec.ts`）与后端集成测试**：未在本机运行（本机未配置独立 `_test` 库，且本次未改动后端/数据库/API）；已确认 `city-exploration.spec.ts` 中 `getByLabel('年份')` 与 `'2025 年每月新增格网'` 等选择器在迁移后完全兼容，完整 CI 结果以 PR 检查为准。
- **`design-system.spec.ts` 像素快照对比**：基线仅包含 macOS（`*-darwin.png`），未在 Linux 上执行像素级 diff（本次未改动设计系统 showcase 页面或基础组件默认外观）。
- **真机 Safari / WebKit**：本机 Linux 无 WebKit 系统库，未做真实 Safari 目视核对；所有浏览器视觉验收均基于 Chromium 合成 API 环境。
- **真实外部底图网络（`playwright.basemaps-live.config.ts`）**：未在本次常规回归中访问外部底图服务；本地矢量底图切换已由 `tests/ui/basemaps.spec.ts` 12/12 覆盖。
- **单页双路径与原型差异**：原型将轨迹/热图与城市探索右栏合绘于单张图，实际应用因 `/footprints` 面向匿名展示、`/footprints/exploration` 面向已登录本人且数据源独立而保持双路由分工，未虚构不可得的服务端字段。
