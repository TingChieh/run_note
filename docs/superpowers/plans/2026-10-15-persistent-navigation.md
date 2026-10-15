# 常驻导航与紧凑跑量目标实施计划

**目标：** 菜单切换只更新右侧，左侧目标草稿保持，普通后台检查不闪动，侧栏在常见桌面高度下装得下。

**架构：** 沿用 SvelteKit 客户端路由与根布局；`$app/state.navigating` 提供真实加载状态。右侧按 pathname 建立生命周期边界，兼容现有 onMount 加载。

**技术栈：** Svelte 5 runes、SvelteKit 3、CSS 令牌、Playwright 合成 API。

**约束：** 保留 dirty 修改，不提交、不推送、不迁移、不读密钥、不主动刷新用户页面。后台鉴权失败仍关闭私人内容，401、SSR 和跨标签退出保护保留。

- [x] 在 `frontend/tests/ui/ui-shell.spec.ts` 补回归：延迟 activities 路由模块；断言右侧加载状态、保留旧页面、侧栏 DOM 和目标草稿相同、无文档请求；重复菜单点击不重取活动；前进后退与移动导航保留。
- [x] 在同文件补延迟成功会话核验，检查已加载页面不隐藏；补 1366×768 / 1440×900 侧栏完整可见和目标紧凑验证。先执行确认原实现失败。
- [x] `AppNavigation.svelte` 移除强制 reload；同路径无修饰点击 preventDefault。私人内部链接统一使用站内导航，公开/分享链接保持既有行为。
- [x] `+layout.svelte` 增加真实导航进度与 pathname key；后台会话检查不预先隐藏内容，广播核验和失败保护保留。`app.css` 添加进度样式和短屏留白调整。
- [x] `RunningGoal.svelte` 压缩内边距、行间距、数值字号，保留 44px 点击目标与编辑功能；测试最大目标值以及编辑不增高。
- [x] 执行 `pnpm check`；执行 ui-shell、theme、milestones、dashboard-explorer、activities、sport-detail、footprints 的 UI 回归，按失败证据修复；执行 `pnpm build`。
- [x] 检查 diff，更新主题动效记录与编号特性文档，记录真实命令、结果与未验证范围。不提交代码。

后续追加：手机菜单弹出/收回、inert与焦点；主题当前状态文字；活动变更后摘要局部更新且保留草稿。实际失败与通过记录见 docs/45-persistent-navigation.md。
