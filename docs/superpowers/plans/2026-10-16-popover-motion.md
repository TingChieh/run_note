# 浮层按钮来源动效实施计划

**目标：** 三类现有 Popover 从触发控件展开并收回。

**架构：** 共享 `popover-motion.ts` 只计算 CSS 来源几何；各消费者保留定位和状态。`liquid-glass-controls.css` 使用语义动效 Token 完成双向过渡。

**约束：** 当前工作区已有用户改动，原位小幅叠加；不改业务接口、数据库、依赖、导航结构；不提交或发布。本次在当前会话执行，不派发子代理。

- [x] 盘点 DatePicker、BasemapPicker、enhanceSelect 与共享 CSS；阅读设计系统及未提交状态。
- [x] 新增 `popover-motion.spec.ts` 与独立配置；首个真实 Chrome 用例确认旧日历展开来源偏离按钮 33px。
- [x] 新增 `preparePopoverMotion(panel)` 和 `positionPopoverMotion(panel, anchor, placement)`，使用布局尺寸避免动画测量反馈；接入三类调用方。
- [x] 增加进入/退出时长和 easing Token；CSS 保留原生退场与减少动态效果回退。
- [x] 执行定向动效、旧菜单/日历/底图回归、设计系统视觉基线、类型检查和生产构建。
- [x] 查看动画中间帧，更新组件/Token 规范、独立展示和编号验收记录；检查最终 diff，不提交。
