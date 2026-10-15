# 首页紧凑布局与累计足迹实施计划

目标：收紧目标/省份卡片与运动足迹高度，首页省份按本人全部历史汇总。

设计：复用省份空间查询，把 year 改为可选；省略时返回 year=null，保留现有年度调用。首页移除年份依赖。地图完整等比缩小，目标卡片减少内边距；运动足迹局部采用紧凑指标行与视口高度地图，不裁切数据、不限制整个面板高度。小屏继续自然滚动。

约束：保留现有未提交改动、鉴权/隐私与查询资源上限；不迁移开发库，不提交 Git。

- [x] 定位调用链、已有样式与测试，新增累计契约测试并观察失败。
- [x] 修改 footprints/router.py、provinces.py 与 milestones.ts，保留按年兼容。
- [x] 调整 ProvinceMap、GoalOverview、ActivityExplorer 和 RouteMap 的局部样式，首页使用累计地图。
- [x] 补齐合成 API 与 milestones UI 测试，验证切换年份不改变累计地图。
- [x] 按用户后续要求增强日历颜色，增加 ThemeToggle 与系统/本机偏好同步，保留地图和图表实例。
- [x] 执行真实 PostGIS 测试（仅版本匹配的独立测试库）、前端单元/UI/类型检查/构建及 Ruff，检查桌面和移动端截图。
- [x] 在 docs/44-dashboard-compact-and-theme.md 中记录实际结果与未验证边界。
