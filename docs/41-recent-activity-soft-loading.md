# 运动足迹最近 20 条与柔和切换

## 使用方式

数据汇总页的运动足迹移除年月选择器，按当前分类加载最近 20 条记录，跨月展示；每条记录的日期保留。左右切换只在这 20 条内进行，到末条后禁用下一条。

切换分类或记录时保留原有地图与数据，等待新详情和路线就绪后，标题及指标数值先淡出再同步替换、淡入。指标卡片背景保持稳定；地图沿用现有实例及视野缓动，后续路线更新不再展示首次绘制提示框。慢请求使用延迟出现的轻量提示；系统开启减少动态效果时跳过数值动画。

## 改动范围

- 前端：`ActivityExplorer.svelte` 删除月份与追加分页，保留分类、记录日期、错误重试及请求令牌保护；调整标题和数值切换。
- 前端：`RouteMap.svelte` 为嵌入地图区分首次绘制与后续更新，减少切换提示闪烁。
- 测试：`dashboard-explorer.spec.ts` 更新最近 20 条行为，覆盖跨月记录、分类慢请求、日期保留及指标动画。
- 文档：更新 `34-dashboard-activity-explorer.md` 的当前用法，并保留历史验收记录；补充本次设计及实施计划。

## 接口与隐私

复用现有 `readActivities(fetch, 0, undefined, category)`，请求 `limit=20`、`offset=0`，不传年月范围。列表排序继续由后端决定，没有修改接口契约、数据库、鉴权、归属校验或公开数据范围。私人状态仍在 401 时清除；过期响应被请求令牌丢弃。分类请求失败时保留旧内容并提供重试，加载或失败期间禁用旧详情链接。

未修改后端或数据库，未操作开发库，未提交、推送或部署；保留工作区中其他已有改动。

## 验证记录

2026-10-15，在 `frontend/` 实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec playwright test -c playwright.dashboard-explorer.config.ts -g 'recent records span\|slow category reads' --reporter=dot` | 修改前 2 项失败，分别证明旧实现按月限制记录、分类请求提前清空内容 |
| `pnpm exec playwright test -c playwright.dashboard-explorer.config.ts -g 'record details fade' --reporter=dot` | 修改前 1 项失败，指标数值没有动画 |
| `pnpm exec playwright test -c playwright.dashboard-explorer.config.ts --reporter=dot` | 最终 18 项通过，31.5 秒 |
| `pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts sport-detail.spec.ts --reporter=dot` | 17 项通过，37.6 秒 |
| `pnpm check` | 0 errors、0 warnings |
| `pnpm build` | 退出码 0，adapter-node 构建完成；存在项目既有的大体积 chunk 提示 |
| `git diff --check` | 通过 |

UI 验证使用合成 API（8191）、Vite（5191）与真实 Chrome，未连接真实后端或数据库。检查桌面浅色及手机深色截图，确认年月入口移除、记录日期保留、最近 20 条计数及地图/指标布局。

未运行真实后端端到端验收、完整 UI 套件、Safari/Firefox/iOS 浏览器检查或后端测试。本次没有纯逻辑改动，未新增或运行单元测试。合成环境通过不代表真实开发服务或生产环境已经验收。
