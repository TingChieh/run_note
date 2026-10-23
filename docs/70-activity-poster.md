# 70. 单次跑步分享图

在活动详情页为单次跑步生成 1080×1920 PNG，沿用足迹墙分享图的调色板、站点 Logo 与外观选择。纯前端、本机绘制，不改后端与数据库。设计见 `docs/superpowers/specs/2026-10-23-activity-poster-design.md`。

## 使用方式

- 入口：`/activities/[id]` 页面右上的「生成分享图」按钮，仅当记录有轨迹且查看者是本人（workspace、站主在根展示页、本人的具名展示页）时出现。
- 弹窗提供外观（跟随网站 / 日间 / 夜间）与四种样式：路线大图、运动海报、跑步票根、大字里程（不含轨迹）。可保存 PNG，浏览器支持时可系统分享。
- 实现：`lib/share/activity-poster-data.ts`（读取与变化检测）、`lib/share/activity-poster-render.ts`（canvas 绘制）、`lib/components/ActivityPosterDialog.svelte`。`route-drawing.ts` 抽出共用投影并新增 `routeEndpoints`；`posterPalette` 增加 `success` 令牌。

## 接口与隐私

- 只读本人接口：`GET /api/v1/activities/{id}`（读两次，生成后核对标题、里程、用时、配速、是否有轨迹，变化则报 `POSTER_DATA_CHANGED`）与 `GET /api/v1/activities/{id}/route`。不使用匿名展示接口，不新增后端接口。
- 用时、配速、里程取服务端字段，前端只做单位与显示格式化。
- 含轨迹的样式会画出起终点，界面明确提示；「大字里程」不含任何轨迹。图片在本机生成，不自动发送。不包含备注、文件名、邮箱。图上出现活动标题。

## 验证记录（2026-10-23，本机实际运行）

- `pnpm test`：32 个文件、192 项通过（含新增 `tests/unit/activity-poster.test.ts`）。
- `pnpm check`：0 错误、0 警告。
- `playwright --config playwright.activity-poster.config.ts`（合成 API）：4 项通过——四种样式渲染与 PNG 尺寸（1080×1920）、Esc 关闭并还原焦点、日夜间与手机宽度无横向滚动、无轨迹记录不显示按钮、读取失败后重试成功。
- `playwright --config playwright.route-poster.config.ts`：22 项通过，足迹墙分享图无回归。
- `pnpm build`：构建成功。
- 未运行：真实后端与真实浏览器的端到端验收、开发服务实例上的验证。
