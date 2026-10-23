# 菜单加载与有记录城市定位

日期：2026-10-16。仅改前端，基于当前已有未提交功能继续增量修改。

## 使用方式

菜单切换时侧栏和目标草稿保持原实例，右侧在实际导航期间显示骨架屏，导航结束立即移除并淡入。活动列表、年度日历、足迹墙、个人足迹和 AI 统计依据的读取也使用骨架占位；保存、上传、后台生成等进度继续保留原有提示。不制造固定等待时间，系统减少动态效果时取消动画。

个人足迹完成城市识别后：

- 电脑（宽度至少 1024px）直接展示所有与当前几何记录相交的城市/地区按钮，自动换行。
- 手机与窄屏（小于 1024px）点击“城市”，从菜单选择已有记录的城市，再点击“定位城市”。
- 点击入口后定位该城市范围内记录的包围范围，路线、热区、记录列表与汇总始终保留。“回到全部足迹”恢复完整概览。
- 没有记录的城市不展示。未覆盖的几何提供“未识别区域”入口；识别失败可单独重试，地图继续可用。

## 接口与隐私

没有新增或修改后端接口、响应结构、权限、数据库、统计口径或环境变量。城市按钮复用当前 `/api/v1/footprints/all?mode=...` 快照的几何，不为定位请求另一份足迹，也不重新创建地图或数据源。

新增城市边界来自项目省份地图同源的 DataV 公共可视化数据。生成后包含 369 个市级可视化区域，直辖市及港澳的区合并为城市入口；省级台湾轮廓和海域不冒充城市。来源、下载哈希及生成命令见 `frontend/src/lib/data/china-cities.README.md`。

城市识别在本地 Worker 中执行，Svelte 响应式数据先取快照再结构化克隆；不向 DataV、外部地理编码或 AI 发送用户轨迹。Worker 完成和卸载时终止，过期结果不能写回页面。底图继续沿用 OpenStreetMap 视口瓦片和既有开关。

边界按 0.002 度容差简化，仅作导航估算。边界附近、简化轨迹与热区网格可能使城市识别有差异，不应作为精确行政归属或城市活动次数。境外和台湾的城市级划分未覆盖；这类记录仍保留在地图和未识别区域中。

城市 Worker 构建文件约 2.85 MB，预压缩 Brotli 约 472 KiB、gzip 约 812 KiB；它在足迹地图挂载时单独加载和执行，不进入普通菜单页的主包。大数据历史的设备端性能仍需真实数据与低端设备验收。

## 改动范围

- 前端加载：`PageSkeleton.svelte`、根布局、`app.css`，以及 activities/dashboard/ai/footprints 页和 `FootprintWall.svelte` 的主读取分支与内容淡入。
- 前端城市：`FootprintMap.svelte`、`map/footprint-cities.ts`、`map/footprint-cities.worker.ts`、城市边界与生成脚本。
- 测试：`ui-shell.spec.ts` 保留侧栏/草稿测试并验证骨架；`footprints.spec.ts` 验证真实延迟、两城定位、响应式入口、失败重试与未覆盖区域；`footprint-cities.test.ts` 验证空间相交。`dashboard.spec.ts` 的足迹入口 URL 断言对齐既有 `?mode=tracks` 行为。
- 网站图标：`frontend/static/favicon.ico` 逐字节复制用户指定文件，`app.html` 配置全站 favicon。
- 文档：设计、计划和本验收记录。后端及用户既有未提交修改未纳入本次修改范围。

## 验证记录

实际执行（工作目录为 `frontend/`）：

- `pnpm test`：20 个测试文件、129 项通过，0 失败。
- `pnpm check`：0 errors、0 warnings。
- `pnpm build`：退出码 0，adapter-node 完成。保留 chunk 大小警告；本次新增的城市 Worker 体积单独列于上方。
- `pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts footprints.spec.ts activities.spec.ts dashboard.spec.ts dashboard-explorer.spec.ts p2.spec.ts`：69 项通过，0 失败、0 跳过（1.7 分钟）。合成 API 8191 + 前端 5191 + 本机真实 Chrome，不连接开发数据库。
- `git diff --check`：退出码 0。favicon 与指定源文件 `cmp` 一致。

Chrome 验证了 320/390/768/1440px 与明暗外观；手机菜单支持键盘，桌面只展示合成记录中的北京/上海，没有广州等无记录城市。轨迹与热图分别比较了定位前后、复位后的真实地图截图，复位画面一致；快照请求数量、全部记录/热区数量和画布实例保持不变。识别失败重试未重新读取快照，未覆盖区域可以定位。

骨架测试实际延迟路由模块和足迹 API，确认占位覆盖真实加载，侧栏同一实例与目标草稿42保留；减少动态效果下骨架与淡入均无动画。另有 6 项城市纯逻辑用例包含实际本地边界的北京/上海/广州匹配。

截图与原始测试日志保存在 [本次证据目录](local-evidence/2026/10/15/01a1402c-a46d-7e52-812d-a7874961ad7b)：`menu-navigation-skeleton.png`、`footprints-page-skeleton.png`、`city-panel-*`、`city-*-before/beijing/restored.png`、`menu-city-ui-verification.log`、`menu-city-unit-verification.log`。截图仅含合成数据。UI 日志仍有 replaceState 弃用及隐藏图表零尺寸提示，不将这些提示解释成业务验收通过。

红绿验证记录：新骨架/城市入口用例最初因缺少相应功能失败；新增城市识别模块测试最初因模块不存在失败。真实 Chrome 揭示了选择框名称受增强箭头影响、截图边缘像素和 Worker 不能直接克隆响应式 Proxy，已分别修正并复验。

未运行真实后端 E2E、数据库测试、Safari/Firefox 或生产环境验收；未重启用户原有 5183/8001 服务，未提交、推送、迁移或部署。
