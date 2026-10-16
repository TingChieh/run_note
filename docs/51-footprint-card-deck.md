# 详情足迹堆叠与完整记录切换

## 使用方式

活动详情保留左侧标题、说明及“查看全部足迹”，右侧按实际宽度放置相邻跑步记录。卡片宽 9rem，仅在边缘重叠 0.5rem，避免日期、标题和距离被遮挡；层级从选中卡片向两侧递减。卡片数量随区域宽度调整，取消固定三张。最新记录位于左侧，最旧记录位于右侧，首尾不循环。

左右箭头位于卡片区域两端，不再显示底部计数或“查看该记录”。点击卡片或箭头直接切换完整跑步记录：标题、指标、路线、管理、分享和详情 URL 同步更新。内部切换替换当前历史条目，刷新后读取当前记录，返回仍到原活动列表或足迹墙页码。

切换使用 keyed FLIP 与进入/离开过渡，选中卡片抬高，并跟随鼠标小幅倾斜、移出复位。触屏或减少动态效果时关闭倾斜，减少动态效果时也关闭位移动画。原生按钮保留键盘焦点、中文名称与读屏状态。

## 改动范围

- 前端 `src/lib/components/ActivityWallPreview.svelte`：详情专用响应式堆叠、两端控件、层级、动画、分页缓存、完整记录切换回调与失败重试；按 20 条缓存列表页，通过日期及 UUID 倒序二分定位，不下载全部历史。
- 前端 `src/lib/components/WallCard.svelte` 与 `src/lib/styles/card-tilt.ts`：紧凑卡片、原生选择按钮、选中态指针倾斜与生命周期清理；普通足迹墙仍使用链接。
- 前端 `src/lib/styles/liquid-glass.ts`、`liquid-glass.css`：卡片在增强逻辑和材质样式中均保持实色表面；排除选择器不增加特异性，避免覆盖地图按钮专用样式。
- 前端 `src/routes/activities/[id]/+page.svelte`：读取目标详情与路线后 shallow replace 当前 URL，管理/分享按 ID 重建，保留卡片缓存与来源返回状态，丢弃过期详情及路线响应。
- 前端 `src/routes/+layout.svelte`：shallow 记录切换不触发整页骨架和隐藏。
- 测试 `tests/ui/footprint-card-deck.spec.ts`：卡片几何、可点击性、响应式容量、动画、完整记录切换、跨页缓存、错误/401、刷新与原页返回；加入默认 UI 测试入口。
- 文档：设计、计划、组件目录及本验收记录。

## 接口与隐私

复用本人活动列表、详情和路线接口；后端、接口契约、数据库 Schema、运动指标算法和公开分享权限未变。路线缩略图使用浏览器内路线 SVG，不新增底图服务请求；当前卡片复用详情路线。

读取切换期间保留原记录，并禁用重复操作。详情失败保留原 URL 与内容，可重试；目标路线失败时展示目标记录与路线重试入口。401 清除私人内容与缓存并跳转登录，disposed 与单调请求令牌隔离过期响应。所有 UI 验证均使用合成记录与合成轨迹，不访问开发数据库。

## 验证记录

2026-10-16，真实 Chrome + 合成 API，独立 8292/5292 服务与 Vite 缓存。临时配置继承 `playwright.ui.config.ts`；测试仍使用仓库内源文件。

| 实际执行 | 结果 |
| --- | --- |
| `pnpm exec playwright test --config /private/tmp/runnote-card-deck-regression.config.ts` | 101 passed、2 failed；覆盖活动管理、列表/墙返回、足迹地图、路线、主题、玻璃控件与页面壳 |
| `pnpm exec playwright test --config /private/tmp/runnote-card-deck-final.config.ts` | 最终专项 11 passed（18.7s），包含卡片内容左缘与中心可见性、宽度容量变化 |

扩展回归的两项失败分别为：响应式测试从 1440 到 1920 时受内容最大宽度限制，容量同为 5，断言错误；已将测试改为跨越实际容量阈值的 1280→1920，最终专项通过。另一项为 `ui-shell.spec.ts` 的侧栏高度检查：1366×768 下 scrollHeight 806 > clientHeight 768，单独复测仍失败，本次未改动侧栏几何，不将扩展回归报告为全绿。

材质排除曾增加选择器特异性、覆盖地图按钮背景；已改为 `:where(:not(.wall-card))`，地图玻璃控件专项及最终扩展回归中的该项均通过。窄屏深色、桌面选中中间/边界截图已人工检查。代码审查未发现确定的严重或重要逻辑问题。

| 其他实际执行 | 结果 |
| --- | --- |
| `pnpm test` | 22 files、136 tests passed |
| `pnpm check` | 首次 24 errors / 3 files，复测 25 errors / 5 files，0 warnings；报错均位于本次未编辑的底图模块或底图测试，未通过 |
| `pnpm build` | 退出 1；底图模块变动期间，RouteMap / FootprintMap 引用的旧 map-style 导出缺失，共 8 个构建错误 |
| `git diff --check` | 全仓检查退出 2，map-style.ts 尾部新增空行；本次卡片、材质、详情、布局和 UI 配置相关 tracked 路径检查退出 0 |

执行中观察到工作区新增 BasemapPicker、basemap-controller、底图测试等文件，map-style.ts、RouteMap、FootprintMap 也继续变化；这些不属于本次编辑范围，保留原样。卡片专项的通过对应上述最终 Chrome 运行时点；不能据此宣称随后变化中的整个工作区已通过类型检查、构建或运行验收。

未运行真实后端 E2E、后端测试、数据库测试或生产验收；合成 UI 验证不等同于真实用户数据链路验收。未提交、推送或部署，保留其他未提交修改。
