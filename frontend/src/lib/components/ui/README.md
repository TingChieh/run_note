# RunNote 基础 UI 规范

沿用 Svelte 5 与 Tailwind 4，无新增依赖。设计变量集中在 `src/app.css`。

- `PageHeader`：`title`、可选 `description` 和 `actions` snippet。
- `FeedbackState`：`kind` 为 `loading / success / error / empty`，必需 `title`、可选 children snippet（重试或入口）。错误使用 alert，其余使用 polite status；文本与图形共同区分状态，遵守减少动画偏好。
- `AppNavigation`：桌面固定侧栏；1024px 以下展开菜单。标准链接、aria-current、aria-expanded、Escape 返回开关焦点。
- 主要按钮复用 `bg-primary`，次要操作使用 `button-secondary`；已有边框按钮和表单控件共享交互与焦点样式。
- 卡片复用 `rounded-xl border border-border bg-white`；标题、内容宽度和间距遵循全局变量。日历和数据表的横向滚动限制在原有局部容器。

P0 仅接入必要共享框架，不迁移业务区域到另一套组件库。

## Activities P1 轻量复用

- `MetricSummary`：语义化 dl，items 为 label/value/testId，compact 用于活动卡片；缺失值保留“—”并提供辅助技术说明。只展示已格式化值，不参与计算。
- `ActivityCard`：私人列表中的日期、标题、可见性和三个核心指标；沿用现有格式化函数与详情链接。
