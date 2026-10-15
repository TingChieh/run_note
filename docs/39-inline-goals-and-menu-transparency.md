# 目标原位编辑与菜单选中透明度

## 使用方式

首页年度、月度、周目标及侧栏跑量目标点击“设置/调整”后，直接在原目标数字位置输入，顶部原按钮区域显示“保存/取消”，不再向下展开另一行表单。正常编辑时卡片高度保持不变；校验、网络错误仍会显示必要提示。

编辑中的输入框常驻细边框和轻微主题底色，失焦后仍能辨认可编辑区域；聚焦时加强边框与底色。

输入自动聚焦并选中原数值，Enter 保存，Escape 取消并返回调整按钮。统计仍在加载或加载失败时也能设置目标；统计返回时保留正在编辑的输入框、草稿和焦点。保存失败保留草稿及已确认目标，保存成功沿用原有组件同步，不增加成功提醒。

所有增强下拉菜单的选中胶囊使用半透明主题色，保留现有圆角、轮廓与弹性动画。开发模式“玻璃调节”的透明度越高，选中填充越通透；浅色、深色模式均采用对应主题色。

## 改动范围

- 前端 `GoalOverview.svelte`、`RunningGoal.svelte`：原位编辑、顶部操作、键盘与焦点处理；数值行保持稳定 DOM，避免统计响应打断输入。侧栏按钮保持单行，输入在可用宽度内收缩。
- 前端 `liquid-glass-controls.css`：新增菜单选中材质令牌，替换原先完全不透明的 `--primary-soft` 填充。
- 测试 `milestones.spec.ts`：320/390/768/1440px 卡片高度、原数值行位置、页面溢出、取消不写入、Enter 保存、慢统计响应后焦点及同步。
- 测试 `liquid-glass.spec.ts`：浅深色选中层 alpha 小于 1，并实测玻璃调节改变选中透明度；等待菜单展开动画结束后截图。
- 文档：本记录与 `superpowers/plans/2026-10-15-inline-goals.md`。

## 接口与隐私

沿用现有目标 API、CSRF、校验、归属权限、时区统计与跨组件同步。没有修改后端、接口契约、数据库、认证、代理、环境配置或私有数据流。没有迁移、提交、推送或部署；保留原有未提交修改及用户的 `AGENTS.md`。

## 验证记录

2026-10-15，使用原生本地合成 API 8191 + Vite 5191 + Chrome，不连接真实后端或数据库。

- 修复前，选中填充 alpha 实测 255/255；修复后在浅深色验证半透明，并通过调节器验证透明度联动。
- 首次目标布局检查发现侧栏头部两个按钮因 152px 可用宽度而换行，导致卡片增高约 21.56px；修复为紧凑单行按钮。
- 代码审查发现统计加载前后分支可能重建输入框并丢失焦点，已改为稳定单一数值行，并补充两个 pending-response 回归。
- `pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts sport-detail.spec.ts liquid-glass.spec.ts --reporter=dot`：最终 29 passed（38.5s）。此前一次菜单测试先于渐进增强初始化点击，修正为等待增强类后，最终全部通过。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：成功，adapter-node `✔ done`；仅有既有大 chunk、NO_COLOR 提示。
- `git diff --check`：通过。`lsof -nP -iTCP:4187 -sTCP:LISTEN` 无监听。
- 已检查 `frontend/test-results/` 中浅/深色选中菜单、390px 原位编辑、桌面年度目标及侧栏截图。输入保持在原数值行，卡片不因正常编辑增高，未出现页面横向溢出；截图由合成数据生成，目录被 Git 忽略，重跑会更新。

未运行真实后端 e2e、数据库测试、真实 Safari/Firefox/iOS 验收；本次未重新运行纯逻辑单元测试（未修改其逻辑）。未重启真实开发服务。4187 独立效果预览保持关闭。

### 失焦编辑边界补充验证

同日修正 `GoalOverview.svelte` 与 `RunningGoal.svelte` 的输入框无显式边框、底色与卡片相同的问题。仅调整边框和背景，未更改输入尺寸或保存逻辑。既有 UI 用例补充 Tab 移出后的浅深色截图：`pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts -g 'goal editors replace' --reporter=dot` 为 1 passed（6.3s）；`pnpm check` 为 0 errors / 0 warnings，`git diff --check` 通过。已查看 390px 浅深色年度目标与深色侧栏截图。此次未重跑完整构建、全套回归或真实后端测试。

### 目标操作按钮统一

首页年/月/周目标与侧栏跑量目标的“设置/调整/保存/取消”统一复用 `button-secondary`，使用与开发调节区“普通按钮”相同的胶囊圆角、玻璃材质和既有按压弹簧。保留目标卡片紧凑字号与布局，没有替换按钮事件或保存流程。

验证：`pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts -g 'goal editors replace|home has real period' --reporter=dot` 为 2 passed（9.4s）；`pnpm check` 为 0 errors / 0 warnings。已检查浅色目标总览、390px 深色编辑态和深色侧栏截图。此次未重新运行完整构建、全站回归或真实后端测试。

### 保存按钮从调整入口弹出

首页与侧栏的保存按钮改为持久保留玻璃层，从原调整入口附近以 8% 尺寸向左弹出，放大超过正常尺寸后回弹；取消或保存成功后反向缩回原入口。放大回弹 420ms、收回 220ms，零宽轨道与间距过渡 320ms，透明度 180ms；减少动态效果时关闭过渡。收起状态设置 inert、aria-hidden 并禁用提交按钮，避免不可见按钮进入键盘焦点或触发提交。新增共享样式位于 `liquid-glass-controls.css`，不修改目标 API 或保存同步逻辑。

验证：新增动画回归先在原直接插入/删除实现上失败；小尺寸弹出断言在旧 70% 缩放实现上也失败。最终 Chrome 检查起始缩放小于 20%、放大回弹超过 100%、展开/收回的插值透明度与减少动态效果。测试恢复动态效果偏好后先等待隐藏控件回到初始缩放，避免把偏好切换过渡误当作按钮弹出。`pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts sport-detail.spec.ts --reporter=dot` 最终 17 passed（33.6s），覆盖布局高度、目标保存/失败草稿/同步及慢统计响应焦点；`pnpm check` 为 0 errors / 0 warnings，`git diff --check` 通过。已检查 390px 深色编辑态、侧栏与收起状态截图；动画通过实际 CSS 过渡插值验证。未重跑完整构建、全站回归、真实后端或 Safari/Firefox 验收。

### 目标文本框同步弹出

首页年/月/周目标与侧栏目标的原位输入框增加双向过渡：进入编辑时以 8% 尺寸放大并淡入，420ms 内展开宽度并回弹，后面的 km 随实际宽度平滑向右移动。成功保存、取消或 Escape 时，220ms 内缩小并收回宽度，km 同步向左归位，结束后恢复目标文字。焦点轮廓跟随输入框；卡片高度、自动聚焦、选中文字、保存失败保留草稿等行为不变。系统开启减少动态效果时直接切换。

`goal-input-transition.ts` 统一控制原生输入框的宽度、内边距、透明度和缩放；两个目标组件复用该过渡。`liquid-glass-controls.css` 在退出期间暂时隐藏只读目标，待输入框退出后显示，避免文字重叠。退出期间由 Svelte 将输入框设为 inert。

验证：`pnpm exec playwright test -c playwright.ui.config.ts milestones.spec.ts sport-detail.spec.ts --reporter=dot` 为 17 passed（40.6s），覆盖目标编辑布局、焦点、取消及保存流程；最终 `pnpm check` 为 0 errors / 0 warnings，`git diff --check` 通过。已查看 390px 深色编辑态截图。此次没有新增测试；既有回归不单独断言文本框的中间动画帧。未运行完整构建、真实后端、Safari/Firefox 或全站回归。
