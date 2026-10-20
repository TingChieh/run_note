# 设置、站点与用户管理界面改版

日期：2026-10-20。仅前端改动：不改接口、权限、CSRF、数据库或隐私边界。设计规范见 `docs/design-system/`（components、patterns、tokens 已同步）。

## 使用方式

- **页头与分区标签**：`/settings`、`/settings/site`、`/admin/users`（及 `/workspace/settings`）共用根布局里的一份黄色页头，底部是玻璃分段标签。分区之间切换保留页头与标签栏，不显示骨架屏、不淡入；玻璃块跟随指针/焦点，点击后停在被点项。
- **账户设置**：顶部身份卡（头像、昵称、用户名、邮箱/时区/主页标签）；下面两列：个人资料、公开个人主页（开关，需点保存才生效）；账户安全默认折叠，点“修改密码”展开。有未保存更改时底部浮出保存条（放弃/保存），保存成功后显示结果约 6 秒后消失。长说明折叠在“展示与隐私说明”里。
- **站点设置**（仅站主）：左侧站点文字与“默认外观”三张卡片（跟随系统/浅色/深色，仍是原生 radio），右侧吸顶的实时预览（侧栏标志、标题、副标题、页脚标语）与图标上传；同样用保存条。
- **用户管理**（仅站主）：一行工具栏（搜索、全部/已启用/已禁用分段、总数）；表格每行有首字母头像，“登录状态”“个人展示”均为开关，点击立即写入并就地更新这一行。站主行的两个开关固定为开且不可调节。重置密码、编辑仍是行内小按钮；公开展示时“查看展示”“复制链接”从左侧按钮后滑出，不公开时收起，列宽固定以免左右跳动。选中用户时批量工具栏展开/收起带高度动画。
- **公开展示与登录开关不再弹确认窗**。这是有意的产品决定：开启公开展示会公开该用户全部记录、完整轨迹与精确起终点，请操作者自行确认。重置密码与批量删除仍保留确认对话框。

## 接口与隐私

- 没有新增或修改任何后端接口、响应结构、权限或数据库对象。开关沿用既有 `PATCH /api/v1/admin/users/{id}`（`is_active` / `showcase_enabled`）并用返回的用户对象替换本行，不再整表重读。
- 站点设置预览只在浏览器内渲染标题、副标题、标语与已上传的站点标志，不发起新请求；账户设置里的邮箱等私人字段仍只出现在本人页面，不进入任何公开响应。
- 站主的启用与展示状态依旧受后端保护，界面上的锁定开关只是呈现，不是校验入口。

## 实现要点

- 新增：`lib/components/SaveBar.svelte`、`lib/settings-header.svelte.ts`、`lib/styles/liquid-glass-switch.ts`、`lib/styles/reveal-from-left.ts`（`revealFromLeft`、`unfoldBar`）。
- 修改：`liquid-glass-indicator.ts`（`createIndicator` 增加水平模式与 `enhanceSegmented`）、`liquid-glass.ts`（增强选择器）、`liquid-glass-settings.ts`（`switchOptics`）、`liquid-glass-controls.css`、`app.css`（`.settings-*`、`.text-field`、`.button-compact` 等）、`PageHeader.svelte`（`footer` 插槽）、`ImageUpload.svelte`（`size`）、`routes/+layout.svelte`（设置页头与 quiet-swap）。
- 开关按上游 LgSwitch（liquidglass.dev，仓库固定提交见 `lib/vendor/liquidglass/README.md`）的几何与弹簧：轨道 64×28、滑块 36×24、弹簧 420/30，按下放大（本项目取宽 50、高 40）；玻璃配方独立为 `switchOptics`。分段玻璃块复用侧栏导航的 `createIndicator`。
- 经验：全局按钮样式带 `!important` 渐变/阴影，会在玻璃块后透出白框，因此分段控件的覆盖写在未分层的 `liquid-glass-controls.css` 并提高选择器优先级，且 `.compact-switch > button` 不再被增强成独立玻璃按钮。读取期间不要给整张表的按钮切换 `disabled`，否则每个按钮会闪一次。

## 验证记录

以下均为本次实际执行（合成 API / 独立展示，未连真实后端，未碰任何数据库）：

- `pnpm check`：0 错误 0 警告。`pnpm build`（adapter-node）成功完成。
- 合成 UI 测试：`ui-shell`、`admin-users`、`site-settings`、`p2`、`theme`、`footprints` 等相关文件分批运行，最近一次相关集合 49 条全过；设计系统 `playwright.design-system.config.ts`：7 条通过（含新增“开关、分段与保存条保持原生语义”，原有视觉基线无差异）。
- 整套合成 UI 测试曾在改版中途整套跑过一次：165 通过、1 失败（`liquid-glass.spec.ts` 的“官方按钮表面独立于原生点击区域压缩”，差 0.0002 像素）；把全部改动暂存后在同样的文件集合里同样失败，单独运行则通过，判断为既有的偶发失败。此后又改了动画、根布局与切换逻辑，没有再整套重跑，只重跑了相关文件。
- 测试改动：`admin-users.spec.ts`（开关替代按钮、分段与“搜索”替代下拉与“筛选”、改密码先展开）、`p2.spec.ts`（复选框改开关）、`ui-shell.spec.ts`（悬停保存按钮前先修改昵称，因为保存条无改动时不出现）、`design-system.spec.ts`（新增一条）。
- 手工量化：用 `MutationObserver` 与逐帧采样确认——设置分区切换时页头与标签栏为同一 DOM、玻璃块 279 帧内无缺失；改前切换时出现骨架屏、容器透明度降到 0；筛选切换时不再有按钮的 `disabled` 翻转造成的半透明闪烁。

**未运行 / 未确认**：深色主题下的新界面未人工检查；真实浏览器里的动画整体观感只做了截图与采样；未运行后端测试、真实后端 e2e（`*-e2e.config.ts`）；窄屏下用户管理仍是横向滚动表格，没有改成卡片。
