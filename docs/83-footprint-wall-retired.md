# 83 足迹墙并入跑步记录（页面与视图切换退役）

日期：2026-11-02。接 [81](81-activities-views.md)（把“足迹墙”做成“跑步记录”的一个视图）和 [82](82-activity-timeline-preview.md)（列表改成时间线加预览栏）。跑步记录页现在已经带路线缩略图、日期、距离、用时和桌面右侧的地图预览，足迹墙的网格不再有独立价值，所以这一步把它收掉。

## 使用方式

- **“生成分享图”移到跑步记录页头**（`RoutePosterDialog`），位置与原来在足迹墙页头时相同；仍然只有登录者查看本人数据时才出现（工作区、站主看根展示、本人具名展示），匿名访客看不到。
- **视图切换（“列表 / 足迹墙”）删除**，`ActivityViews.svelte` 一并删除。
- **旧地址永久重定向（308）到同一视图下的跑步记录**，不带查询串：
  - `/activities/wall` → `/activities`
  - `/workspace/activities/wall` → `/workspace/activities`
  - `/p/{username}/activities/wall` → `/p/{username}/activities`
  
  三个视图下的 `wall/+page.svelte` 都换成了只含 `load` 的 `+page.server.ts`，旧链接和书签继续有效。
- **站点地图与页面描述**去掉了 `/activities/wall`。
- **`FootprintWall.svelte` 删除**（只有足迹墙页在用）。`WallCard` 与 `ActivityWallPreview` 保留：活动详情页的足迹卡片组还在用。预览里的“查看全部足迹”改为指向跑步记录，文字改成“查看全部记录”。
- **`RoutePosterDialog` 的主题探针只在固定日间/夜间外观时渲染**（与单次分享图对话框一致）。它是个隐藏的 `.sport-theme` 元素，原来总是渲染，在足迹墙页上没问题，搬到跑步记录页后让页面里出现第二个 `.sport-theme`，`sport-detail` 与 `theme` 两条断言页面外壳唯一的用例因此失败。
- **记录页上有两个与分享图有关的按钮**：页头的“生成分享图”（按全部或某个月份生成多条记录的海报）和右侧预览里针对当前这一条的按钮。后者为了不与页头按钮重名，文字改成“本次分享图”（`ActivityPosterDialog` 新增可选 `label`，默认仍是“生成分享图”，活动详情页不变）。

## 同一批次的其他调整

- **预览卡与第一条记录同高**：桌面右侧预览卡的上边与左边第一张记录卡的上边对齐，月份标题留在两者上方（取代之前“月份胶囊与预览标题同一行”）。预览卡 `margin-top` 取月份标题的高度（1.75rem）加 `--space-3`。
- **单条分享图按钮挪到预览头部**，紧挨“查看完整详情 →”，名称是“本次分享图”，只在本人管理视图且该记录有路线时出现；底部操作栏只剩“编辑记录”“删除记录”。
- **账户菜单有了跟随指针的玻璃滑块**（`AnchoredPanel` 的通用能力，见设计系统组件表）。
- **设置页**：“身心健康”开关从“个人资料”卡里挪出，与“公开个人主页”放进同一个面板（`aria-label="展示与功能开关"`），两行之间有分隔线。
- **深色页头与浅色同尺寸**：深色页头原来无底色、内边距也不同，切换外观时标题区会位移；现在深色同样是圆角填色卡片（`--header-tint: #3a3735`，`--header-tab-track: --background`，`--header-pad` 与浅色一致）。更新了深色组合基线 `composition-dark-darwin.png` 与 `composition-dark-mobile-darwin.png`。

- **删除三种整段时间的分享图样式**：「运动海报」「足迹手账」（带路线）与「动感斜纹」（纯数字）连同选择区里的缩略图、渲染分支和只有它们用的“路线小卡”网格变体一起删掉；留下经典足迹、极简画廊（带路线）和大字里程、跑步票根、半马勋章（纯数字）。单条记录的分享图（`ActivityPosterDialog`）有自己的样式集，没有改。

- **设置页和站点设置页的保存条**打开了 `SaveBar` 的 `glass`，悬浮时与身心健康页的保存条同一玻璃，停到底部时是普通卡片；`.site-save` 改成网格容器，让纤细的保存条靠右。
- **月份/日期选择的上一页、下一页**分到弹层的两端（‹ 在左、› 在右，中间是年份/月份选择），箭头从文字字符换成居中的 SVG。原来两个箭头并排放在右侧，靠中间的那个周围是平面，没有可折射的边缘，看起来是平的，与靠边的按钮不一致。
- **深色模式的控件不再用薄荷绿**：新增 `--control-accent` / `--control-accent-soft`（浅色等于 `--primary`，深色是中性浅灰），用在聚焦边框与外圈、日期/时间字段图标、步进器、日历与时间选择的箭头和文字按钮、悬停底；深色的 `--ring` 也改成中性灰。选中的月份/日期、链接、数字、进度、开关开启和数据颜色保持绿色（取“只收控件”方案，见令牌表）。
- **取消“关闭底图／开启底图”，“图层”挪到它的位置**：详情页与预览地图的“图层”现在在地图左上角（原关闭底图按钮处），足迹地图也在地图左上角（该页原来的“关闭底图”在地图上方的工具栏里，选择器没有跟过去，仍放在地图内）；底图始终开启，失败仍可“重试底图”。`createBasemapController` 去掉 `toggle` 与 `enabled`，`BasemapStatus` 不再有 `off`；`BasemapPicker` 不再自带绝对定位，由各地图放置，弹层按触发按钮在屏幕左半/右半决定向哪边展开。两处“关闭底图可停止后续瓦片请求”的隐私说明相应删除（底图仍只请求公开样式与当前视口瓦片，轨迹不外发）。
- 测试辅助 `openImport` 现在等导入区的高度动画结束再返回；原来返回时布局还在变，依赖几何位置的用例（`liquid-glass` 的“点击右侧空白”）会点到下面的预览。

## 接口与隐私

只涉及前端路由、导航与页面外壳，没有后端、接口、数据库、鉴权或公开数据边界的改动，也没有新增请求。分享图的数据读取方式没变：仍固定走需认证的本人接口，不读匿名展示接口，也不带坐标出站。重定向只拼接当前路径，不接受外部地址，也不转发查询串。

## 验证记录

见交付说明里的实际命令与结果。改动的测试：

- `tests/ui/activities.spec.ts`：删除“列表 / 足迹墙”两个视图的用例；新增“主导航只有一个入口、没有视图切换、分享图在页头且预览里的按钮名称不同”和“三个视图下的旧地址返回 308 并落到跑步记录”；详情页“返回”用例去掉足迹墙来源。
- `tests/ui/route-poster.spec.ts`：入口页面从足迹墙换成跑步记录（含公开主页与工作区）。
- `tests/ui/footprint-card-deck.spec.ts`：返回目标改为跑步记录列表的第 2 页，“查看全部足迹”改为“查看全部记录”。
- `tests/ui/milestones.spec.ts`：删除两条专测足迹墙网格与分页的用例。
- `tests/ui/dashboard-explorer.spec.ts`、`showcase.spec.ts`、`admin-users.spec.ts`、`seo-routes.spec.ts`、`site-settings.spec.ts`，以及单元测试 `seo`、`showcase`、`view-context`：去掉对足迹墙地址的引用。

实际运行（分支 `feat/retire-footprint-wall`，Chrome，合成 API，私有端口）：

- `pnpm check`：0 错误（683 个文件）；`pnpm test`：43 个文件、284 条通过；`pnpm build`：成功；设计系统像素对比：9 条通过（深色组合的桌面与手机两张基线因页头改动已刷新）。
- UI 完整回归（CI 配置的规格，加 wellbeing、site-settings、route-poster、route-groups、footprints、tcx、mifitness、admin-users、showcase、activity-*、ai-*、username 等）：**494 通过、4 跳过、11 失败**。11 个里：
  - 已知与本次无关的 5 个：`seo-routes.spec.ts:5`（写死端口 5191，本轮没有列入）、`wellbeing.spec.ts:885`、`:942`（date 相关，干净 `main` 上同样失败）、`:1538`（干净 `main` 上就不稳定）、`:2238`（#51 带进来的，断言写死 5191，页面实际正确跳到了仪表盘）；`dashboard-explorer.spec.ts:195`（慢读用例，在长跑里偶发）。
  - 本次引入的 6 个：`footprints.spec.ts:478`（亮/暗）与 `route-groups.spec.ts:174`（`/routes`、`/settings` 各亮/暗）。它们在屏蔽玻璃模块的情况下验证页面仍可用，而账户菜单的跟随指针滑块一开始静态导入了 `liquid-glass-indicator.ts`，模块被屏蔽就让整页无法水合。改为打开菜单时按需 `import()`（失败则不加滑块）后，这 6 个与 `top-navigation.spec.ts` 一起重跑：117 通过。
- 之前一轮里 `liquid-glass.spec.ts:6`、`activity-management.spec.ts:35` 的失败已按上面的原因修复（等导入区动画结束；删除后的地址允许带 `?id=`）；这两条没有在最后一轮长跑里再单独确认，只在修复前后各跑过。
- 取消“关闭底图”之后（最后一轮改动，在上面那次长跑之外单独跑）：`pnpm check` 0 错误（682 个文件）、`pnpm test` 通过、`pnpm build` 成功；`basemaps`、`footprints`、`map-framing`、`sport-detail`、`theme`、`liquid-glass` 共 76 条，`dashboard-explorer`、`route-groups`、`activities`、`footprint-card-deck`、`milestones`、`basemaps` 共 101 条，把“图层”放回足迹地图内之后 `footprints`、`basemaps`、`map-framing`、`theme` 共 53 条，均通过。预览里两个按钮改成同一 `.button-secondary` 样式后，`activities` 与 `footprint-card-deck` 63 条通过。这几轮都没有再跑完整回归。
- 没跑：WebKit/Firefox 项目、真实后端 e2e、生产环境；也没有在真实手机上验证。
