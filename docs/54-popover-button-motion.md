# 菜单从按钮展开与收回

## 使用方式

地图图层、全站增强下拉选项、日期选择器及其年月选项，现在从各自触发控件的位置和尺寸展开，380ms 轻微回弹；选择、Esc、再次点击或原生外点关闭时用 220ms 收回。日期面板仍沿用原定位方式，运动来源是右侧日历图标。上方展开和贴边位置也按实际按钮计算。系统启用减少动态效果时立即切换。

可在 `frontend/` 执行 `pnpm showcase` 查看独立展示，或在已有开发前端刷新页面查看业务入口。不会为展示新增生产路由。

## 改动范围

| 文件 | 本次意图 |
| --- | --- |
| `frontend/src/lib/styles/popover-motion.ts` | 共享布局测量、按钮来源几何及首次/快速重开准备 |
| `frontend/src/lib/styles/liquid-glass-controls.css` | 双向缩放与位移，保留原生 display/overlay 退场，关闭后禁止指针交互 |
| `frontend/src/app.css` | 新增四个 Popover 进入/退出时长与 easing 语义 Token |
| `frontend/src/lib/styles/liquid-glass-select.ts` | 全站增强 select 接入共享来源计算，保留选择及键盘逻辑 |
| `frontend/src/lib/components/DatePicker.svelte` | 以日历图标作为展开与收回来源 |
| `frontend/src/lib/components/BasemapPicker.svelte` | 以稳定的图层按钮容器作为来源，保持原定位 |
| `frontend/tests/ui/popover-motion.spec.ts`、`frontend/playwright.popover-motion.config.ts` | 独立真实 Chrome 动效/焦点/响应式检查和中间帧证据 |
| `frontend/tests/fixtures/ui-showcase/Showcase.svelte` | 在既有实际组件示例说明统一动效 |
| `docs/design-system/components.md`、`tokens.md` 及同名设计/计划 | 更新共享规范与验收路径 |

以上多个文件已有未提交修改；本次仅叠加上述内容，未清理既有工作区。

## 接口与隐私

无后端、公共接口、鉴权、CSRF、数据库 Schema、日期范围/时区或供应商调用改动。没有读取密钥或真实轨迹，没有数据库写入或开发库迁移。测试使用内存合成 API 或独立静态展示；AI 用例的生成请求也由合成 API 响应，不调用真实供应商。

保留原生 Popover top layer、嵌套年月选项、焦点恢复、选项禁用与原生 select 绑定。文档流导航、城市展开区、details 和删除确认 dialog 保持原行为。没有新增依赖、提交、推送或部署。

## 验证记录

2026-10-16，本次实际执行，以下命令工作目录为 `frontend/`：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm exec playwright test --config playwright.popover-motion.config.ts --max-failures=1`（实现前） | FAIL：旧日历起点中心距按钮水平偏移 33px；1 failed，3 did not run |
| `pnpm exec playwright test --config playwright.popover-motion.config.ts` | PASS：5 passed；浅深色、日历/嵌套年份、选中收回、原生外点、Esc、快速重开、焦点、320/390/1440 宽度与 reduced-motion |
| `pnpm exec playwright test --config playwright.design-system.config.ts` | PASS：6 passed，包含已有浅深色桌面/移动视觉基线，无更新基线 |
| `pnpm exec playwright test --config playwright.ui.config.ts liquid-glass.spec.ts basemaps.spec.ts` | PASS：25 passed，玻璃菜单、选择/键盘、地图数据/相机/标记/主题及底图故障回归 |
| `pnpm exec playwright test --config playwright.ai-datepicker.config.ts` | PASS：2 passed，日期语义、键盘、响应式与 busy 禁用 |
| `pnpm test` | PASS：24 files、143 tests passed |
| `pnpm check` | PASS：0 errors、0 warnings |
| `pnpm build` | PASS：adapter-node 完成；已有大体积 chunk 警告 |
| `pnpm exec playwright test --config playwright.popover-motion.config.ts --grep 'capture actual' --output /private/tmp/run-note-popover-motion-20261016` | PASS：1 passed，单独保留中间帧供人工检查；不重复计入上述 38 个 UI 用例 |
| 根目录 `git diff --check` | PASS，无空白错误 |

首轮普通沙箱启动展示服务因 `listen EPERM 127.0.0.1:5193` 未能运行；随后使用获准的本机测试进程执行上述 Chrome 测试。不是跳过后宣称通过。

已实际查看日历和图层菜单的 15% / 50% / 85% 进入帧及关闭中间帧：日历从右侧图标移向下方左对齐面板，图层菜单在空间不足时从按钮向上展开，退出向各自按钮收回。临时证据目录：`/private/tmp/run-note-popover-motion-20261016/popover-motion-capture-act-675f7-r-the-calendar-and-map-menu/`，不纳入仓库。退出帧同时验证 `pointer-events: none`。独立只读代码审查未发现本次范围内的可操作缺陷。

## 未确认事项与剩余风险

- NOT VERIFIED：Safari、Firefox、iOS 真机的本轮动效；当前动态几何与视觉证据来自真实 Chrome。
- NOT VERIFIED：真实后端/数据库 E2E、真实用户业务验收；本次 UI 验证使用合成数据。
- 未重启已有开发/生产服务，未验证用户现有浏览器是否已加载新资源；未提交或发布。
- 回归有既有 `replaceState` 弃用提示；底图故障用例包含预期 glyph 请求失败警告，均未导致失败。
