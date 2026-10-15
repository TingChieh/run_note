# 常驻左侧菜单、右侧按需加载与紧凑目标

## 使用方式

- 私人页面菜单、记录详情和返回入口使用站内导航，左侧菜单和跑量目标保持同一实例；目标草稿、周期不随菜单切换消失。
- 路由资源等待时在右侧顶端显示细进度条，原内容继续可见；页面数据按已有局部加载状态展示。重复点击当前菜单不重新读取数据，前进/后退正常。
- 后台成功会话检查不再隐藏已加载内容；失败时仍关闭私人内容与身份显示，身份变化/退出仍跳转。
- 跑量目标压缩内边距、行间距和数值字号，保留周期、目标编辑、进度、统计说明以及 44px 控件。数值区固定最小高度，编辑不增高。桌面高度不超过 900px 时进一步压缩菜单和账户留白；极短屏、错误说明或展开统计范围时允许滚动。
- 小屏导航从顶部轻微缩放弹出，关闭收回；保留菜单实例，关闭立即停止键盘交互；Escape 和当前菜单激活后回到导航按钮。系统减少动态效果时取消动画。
- 主题按钮显示当前日间/夜间状态，悬停提示切换方向；自动按钮吸入/弹出细节见 `44-dashboard-compact-and-theme.md`。

## 改动范围

前端：`AppNavigation.svelte` 负责站内菜单、同菜单跳过、小屏 inert 与焦点；根 `+layout.svelte` 保留外壳、提供右侧真实导航进度和 pathname 生命周期、后台无闪动身份检查。`app.css` 添加进度/小屏过渡/短屏密度；`RunningGoal.svelte` 紧凑布局、独立摘要更新；`ThemeToggle.svelte` 当前模式与双向过渡。私人内部入口组件和页面移除强制整页加载；`ActivityActions.svelte` 删除后使用 goto。

活动列表页与详情操作在成功导入、编辑、删除后发出本地 `runnote-activities-changed`，仅更新常驻跑量摘要，不清空目标草稿。Mi Fitness 成功回调也触发该事件。

测试：`ui-shell.spec.ts` 补充常驻实例、草稿、局部加载、无文档请求、重复菜单、历史导航、后台核验、短屏与小屏动画验证；`activities.spec.ts` 验证文件选择保持可见、导入后摘要更新且草稿不丢；`theme.spec.ts` 验证当前模式与提示及窄屏。

## 接口与隐私

本次增量不修改后端、接口结构、数据库或服务配置；不扩大代理白名单、不读密钥、不写开发库。菜单使用 SvelteKit 已有路由拆包；页面按 pathname 更新，兼容现有 onMount 读取。普通导航与焦点检查不刷新侧栏跑量；只有用户选择新周期、重试或活动成功变化触发读取。后台鉴权失败隐藏私人内容及姓名邮箱，SSR、401 和跨标签退出保护保留。

## 验证记录

- 修改前新增 3 条定向回归全部失败：强制整页导航无局部进度，成功身份检查隐藏页面，1366×768 侧栏 scrollHeight=932px 超过768px；修改后同3条通过（4.8秒）。
- 小屏动画回归修改前失败（无中间过渡帧）；修改后验证实际 opacity 中间帧、关闭、实例保持、当前菜单焦点和减少动态效果，通过。
- 导入跑量回归修改前失败（导入后仍5km），修改后变为8km且目标草稿42保留，普通导航不重复读取摘要。
- 中间较大回归 66通过/5失败：旧文件选择测试还断言应隐藏、紧凑目标编辑增高1.7px、320px手动主题控件溢出，以及2条独立日期夹具被Vite文件路径限制拒绝。前三项已修正并定向验证；未为日期夹具扩大开发服务器文件权限。
- 修复后的7条定向回归全部通过（13.9秒），覆盖上述前三项、目标草稿、身份失败关闭、小屏动画及短屏布局。
- 静态代码审查初次发现常驻摘要陈旧与身份失败侧栏显示问题，已修正，复核无新阻断问题。

最终实际执行：

- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：adapter-node 构建成功，保留既有大 chunk 警告。
- `pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts theme.spec.ts milestones.spec.ts dashboard-explorer.spec.ts activities.spec.ts sport-detail.spec.ts footprints.spec.ts --grep-invert 'nested month and year menus|themed date picker supports' --output /tmp/runnote-navigation-final`：70通过/1失败（2.0分钟）。失败发生于已有登录 helper 在水合前填写表单，快照显示仍停留登录页；为登录 helper 增加就绪等待后复跑。
- `pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts --output /tmp/runnote-shell-final`：11通过（20.3秒），包含此前失败的统一外壳用例。
- `node /tmp/runnote-theme-absorb-preview.mjs`：桌面/手机自动按钮双向过渡、焦点、system 偏好和减少动态效果通过。
- `git diff --check`：通过。

截图已检查1366×768侧栏；独立日期夹具路径失败属于更大回归中的独立覆盖缺口，不将过滤运行描述为全套测试通过。UI 使用合成 API 与独立 Chrome；截图和日志位于 /tmp，不是开发环境或生产验收。未运行真实后端 E2E、后端/数据库测试和 Safari/Firefox。用户当前页面未被主动刷新；未提交、推送或部署。

最终视觉补验：`pnpm exec playwright test --config playwright.ui.config.ts ui-shell.spec.ts activities.spec.ts theme.spec.ts --grep 'compact goal|mobile menu supports|manual theme switches|successful imports update' --output /tmp/runnote-last-visual`：4通过（9.3秒）。短屏验证使用已保存的5km目标，包含进度条；1366×768、1440×900、1280×720 均无需侧栏滚动。小屏截图等待 opacity=1 后采集，避免把过渡中间帧误判为最终配色。
