# 单次跑步分享图设计

日期：2026-10-23

## 目标

在活动详情页为单次跑步生成可保存、可系统分享的 1080×1920 PNG，风格与足迹墙分享图一致。纯前端、本机生成，不改后端与数据库。

## 入口与权限

- `/activities/[id]` 页头加「生成分享图」按钮，仅当 `activity.has_route` 为真时显示（「大字里程」样式不含轨迹，但入口统一随有轨迹的活动出现）。
- 权限与 `RoutePosterDialog` 相同：登录本人（workspace）、站主在根展示页、本人在自己的具名展示页。其余情况不渲染。
- 数据一律通过已登录的本人接口读取，不使用匿名展示接口。

## 数据（`lib/share/activity-poster-data.ts`）

- `readActivity`、`readRoute` 各读一次；用时、配速、里程取服务端字段（`activityDuration`、`avg_pace_seconds_per_km`、距离），前端不重算。
- 渲染前再读一次活动，里程、用时、配速任一变化则抛 `ActivityError(409, 'POSTER_DATA_CHANGED')`，提示「记录已变化，请重新生成分享图」。
- 新增 `routeEndpoints`：把 `route.start` / `route.end` 按 `routeDrawing` 同一投影与缩放映射到绘图框。`routeDrawing` 保持不变（刻意不含端点）。
- 「大字里程」样式不请求轨迹。
- 401 清除状态并跳转登录，沿用足迹墙弹窗逻辑。

## 绘制（`lib/share/activity-poster-render.ts`）

四种样式：路线大图、运动海报、大字里程、跑步票根。复用 `posterPalette`、`loadPosterLogo`、`watchSystemTheme`，支持「跟随网站 / 日间 / 夜间」。品牌名与 Logo 取站点设置。只绘制数据字段，不加装饰性文案与 emoji。输出为纯像素 PNG，不含原始轨迹或用户元数据。

## 弹窗（`ActivityPosterDialog.svelte`）

- 复用足迹墙弹窗的样式类与清理模式（`disposed` 标志、单调请求令牌）。
- 无范围选择；有外观、样式、保存 PNG、系统分享。
- 提示：含轨迹样式写「图片包含路线形状和起终点，请确认后分享」；大字里程写「图片只包含统计数字，不含路线形状」；均注明本机生成、不自动发送。

## 隐私

允许绘制起终点（用户已确认），仅限本人登录后生成。不包含备注、文件名、邮箱。活动标题是否出现在图上在实施时按用户意见处理（默认使用活动标题）。

## 测试

- 单元（Vitest）：数据加载（变化检测、无轨迹、401）、起终点投影、格式化。
- UI（Playwright，合成 API）：按钮显隐、四种样式、主题切换、保存与错误态。需同步补 `frontend/tests/fixtures/ui-api.mjs`。
- 检查：`pnpm test`、`pnpm check`。

## 文档

完成后追加 `docs/NN-activity-poster.md`（编号现场确认），含使用方式、接口与隐私、验证记录。
