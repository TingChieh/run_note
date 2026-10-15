# 菜单加载与城市定位 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在当前会话内逐项执行；保留既有脏工作区，不创建提交。

**Goal:** 菜单导航及页面读取时显示骨架屏并淡入，个人足迹提供仅移动地图的城市入口。

**Architecture:** 复用 SvelteKit navigating 和各页面原有 loading 分支。地图在现有实例上调用相机方法，本地城市边界在 Worker 中匹配当前足迹，不依赖新接口。2026-10-16 根据用户补充，手机使用菜单，电脑展示全部有记录城市。

**Tech Stack:** Svelte 5、SvelteKit 3、MapLibre 5、Playwright Chrome。

## Global Constraints

- 用户已批准骨架屏＋淡入和城市定位保留全部足迹。
- 使用现有 CSS 令牌；减少动态效果时无动画；不人为延迟。
- 不改 API/数据库、授权、侧栏持久性与目标草稿；不调用外部地理编码。
- 不提交、推送、迁移或部署。现有主工作区包含功能所依赖的未提交代码，按用户要求原地保留。

### Task 1: 菜单与页面加载

**Files:** 新增 `frontend/src/lib/components/PageSkeleton.svelte`；修改 `frontend/src/routes/+layout.svelte`、`frontend/src/app.css`、五处主数据加载分支（dashboard/activities/ai/footprints 页面和 FootprintWall）；修改 `frontend/tests/ui/ui-shell.spec.ts`、`footprints.spec.ts`。

**Interfaces:** PageSkeleton 接受 `title?: string`；导航使用只读 navigating；页面继续使用既有 loading。

- [x] 延迟路由模块测试中断言 `navigation-skeleton` 可见、旧设置标题隐藏、侧栏同一实例和目标草稿42保留；另延迟足迹 API，断言页面骨架等到实际数据返回。
- [x] 运行 `pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts footprints.spec.ts --grep 'private navigation|page loading skeleton'`，确认新断言因功能缺失而失败。
- [x] 实现布局骨架与旧内容隐藏/inert；PageSkeleton 提供主题令牌占位、role=status；CSS `page-reveal` 和 `content-reveal` 使用短淡入，减少动态效果时 animation:none。替换主数据读取分支，不改保存/生成进度。
- [x] 重跑上面的测试，验证成功及动态效果偏好。

### Task 2: 城市定位

**Files:** 新增 `frontend/src/lib/data/china-cities.json` 及来源说明、`frontend/scripts/generate-city-atlas.py`、`frontend/src/lib/map/footprint-cities.ts`、`footprint-cities.worker.ts`、`frontend/tests/unit/footprint-cities.test.ts`；修改 `frontend/src/lib/components/FootprintMap.svelte`、`frontend/tests/ui/footprints.spec.ts`。

**Interfaces:** `locateFootprintCities(geometries, regions): CityLocations` 返回 `{cities:{code,name,bounds}[],unlocatedBounds}`。Worker 只接收 `$state.snapshot` 后的几何，不接收身份或文件信息；FootprintMap 对外 props 不变。

- [x] 新增 tracks/heatmap 两种模式的 UI 测试：两城合成数据，手机只显示城市菜单，桌面平铺北京/上海且不显示无记录广州；关闭底图后比较定位及复位画面，检查快照请求、全部记录/热区未变。覆盖 320/390/768/1440px、明暗和减少动态效果。
- [x] 运行新 UI 测试，确认预设城市入口不满足新需求；单元测试先因缺少匹配模块失败。
- [x] 实现离线城市边界与相交算法；避免跨断点/日期变更线虚构城市，识别超出覆盖的区域。`map.fitBounds(city.bounds, {padding:40,maxZoom:16,duration:...})`，减少动态效果时 duration:0。Worker 卸载终止，失败可重试；保持 map/source 不变。
- [x] 重跑城市测试与相关完整 UI 文件，运行 `pnpm check`、`pnpm build`；记录真实数量、警告与未运行范围。
- [x] 补充 `docs/49-menu-loading-city-locate.md`，包含使用方式、接口与隐私、验证记录；核对新增改动与原始备份，保留用户修改。
