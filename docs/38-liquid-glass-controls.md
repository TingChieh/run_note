# 液态玻璃导航、菜单与滑块

## 使用方式

现有绿色侧栏保持竖向结构、图标、名称、路由与移动导航，选中胶囊随鼠标/焦点弹性移动，离开后回到当前页面。滑块保留原生 range，按压时玻璃拇指膨胀，释放回弹；点击区域保持不变。

普通单选下拉框右侧统一显示主题箭头按钮，按压缩小、松开回弹，展开时箭头旋转。点击文字区或箭头均可打开/收起；选项、外部点击、Escape、Tab 也可关闭。上下方向键移动、Enter/Space 确认，支持字符检索。禁用控件同时禁用箭头。

菜单和日历增加展开/收起动画。年/月菜单挂在所属日历内，避免打开子菜单时关闭日历、坐标落到左上角；菜单滚动不牵动页面。长年份菜单的玻璃副本仅覆盖可见视口，避免滚动后选中高亮消失。年/月之间增加间距、焦点环内收；紧凑日期控件单独预留箭头空间，在 320px 屏幕仍显示完整年月。

菜单选中填充改为随玻璃透明度调节的半透明主题色，避免实色遮挡背景；补充验证见 `39-inline-goals-and-menu-transparency.md`。

交互控件和选中指示器统一使用胶囊圆角，菜单/卡片沿用 24px 令牌；颜色来自既有主题，深色模式跟随系统。系统减少动态效果时取消弹性形变与过渡；减少透明度、强制颜色时保留原生操作。

开发模式“玻璃调节”包含透明度、折射强度、弯折带宽、边缘曲率、折射率、色散、模糊程度、边缘高光、高光宽度、光照角度，共 10 项，支持即时更新、本浏览器记忆、预设和恢复默认。旧存储自动补齐新增默认参数，非法值回退、越界值截断。生产构建不显示调节器、不读取开发调节存储。

调节区照片按钮的按压弹簧同时驱动局部背景放大/压缩、折射及高光，松开恢复，避免仅轮廓变化而内部背景静止。普通控件沿用实际 backdrop 折射并联动光学参数。

## 改动范围

- 前端 `lib/styles/liquid-glass.ts` 协调增强/卸载与按压背景；`liquid-glass-indicator.ts` 处理胶囊弹性和滚动副本；`liquid-glass-slider.ts` 处理原生 range 装饰；`liquid-glass-select.ts`、`liquid-glass-select-toggle.ts` 处理菜单、键盘、定位及箭头。
- `liquid-glass-controls.css` 统一几何、主题和动画；原 `liquid-glass.css` 排除菜单选项/箭头，避免叠加多层按钮材质。`DatePicker.svelte` 仅调整定位尺寸读取和年月间距。
- `LiquidGlassTuner.svelte` / `liquid-glass-settings.ts` 补齐光学设置；上游核心引擎未修改，类型声明及来源说明补充。
- 测试修改 `tests/ui/liquid-glass.spec.ts`、`tests/ui/footprints.spec.ts`、`tests/unit/liquid-glass-settings.test.ts`；设计和计划位于 `docs/superpowers/`。

## 接口与隐私

没有修改后端、API 响应、数据库、认证、权限、SSR 代理或环境配置。原生 select/range 继续拥有值、Svelte 绑定和事件，未更改业务筛选与导入行为。

装饰仅复制固定导航标签、选项文字、滑块轨道；不复制私人页面 DOM、地图、坐标或轨迹。照片背景副本仅来自明确标记的开发调节区。引擎本地运行，不新增第三方请求。未提交、推送或部署，保留用户原有未跟踪 `AGENTS.md`。

## 验证记录

2026-10-15，在原生本地环境中执行；UI 使用合成 API 8191 + Vite 5191 + Chrome，不连接真实后端和数据库。

- 先观察到嵌套菜单关闭父日历、缺少双向动画、长年份副本不覆盖选中项、缺少主题箭头、按压背景保持 scale=1 的失败，随后分别修复。事件记录确认动画引发的 `pointerenter` 曾覆盖键盘选择，改为实际 `pointermove` 驱动。
- `pnpm exec playwright test -c playwright.ui.config.ts --reporter=dot`：86 passed（2.0m）。覆盖活动、仪表盘、导航、主题、足迹、目标等全部该配置用例。
- 全站回归后补查减少动态效果与紧凑年月样式；专项命令 `pnpm exec playwright test -c playwright.ui.config.ts liquid-glass.spec.ts footprints.spec.ts -g 'themed arrow|sampled backdrop|nested month' --reporter=dot`：3 passed（11.5s）。减少动态效果测试先确认按压 scale=0.88 失败，修复后为 1。
- 最终 `pnpm exec playwright test -c playwright.ui.config.ts liquid-glass.spec.ts footprints.spec.ts --reporter=dot`：21 passed（33.2s）；包含上述最终调整。最终再次执行 `pnpm check` 仍为 0 errors / 0 warnings。
- `pnpm test`：18 files / 110 tests passed。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：成功，adapter-node 完成；仅有既有大 chunk 提示。
- 生产 client JS 搜索 `runnote:dev-liquid-glass`、`Liquid Glass 调节`、`glass-debug-background` 无匹配。核心引擎 SHA-256 保持 `92a62e5b80cfa7e03912b13bdc53aff1c0ae367a5f296de1327e0f62f0579210`。
- 已查看合成数据的 320px 月份菜单、390px 深色菜单、长年份高亮、照片按压截图；无页面横向溢出，年月文字完整、焦点环不重叠。截图位于 Git 忽略的 `frontend/test-results/`，测试重跑会更新。

未运行真实 Safari/Firefox/iOS 验收、真实后端 e2e 或数据库测试；Chrome 内模拟非 Blink 分支只验证回退逻辑。任意背景上的真正折射依赖 Chrome，其他引擎使用上游磨砂回退；原生多选、带 optgroup 的 select 保留原控件。未重启真实开发服务或进行生产部署。4187 独立效果预览已关闭，未重新打开。

### 文件格式菜单空白误触修正

“文件格式”使用包裹 select 的 label，其块级 flex 布局占满整行。Chrome 会把标签右侧空白的点击转交给 select，因此空白也能打开菜单。仅将 `activities/+page.svelte` 中 `.import-format` 的宽度设为 `fit-content`，并保留 `max-width: 100%`、原间距及换行；文字标签、控件和箭头仍可正常操作。没有修改菜单事件、导入接口或文件处理。

`liquid-glass.spec.ts` 新增实际点击回归，覆盖 1440/390/320px：右侧空白不打开菜单、可见标签仍打开菜单、点击空白关闭菜单。该用例在修复前因 `aria-expanded` 意外为 true 失败；修复后通过。

验证：`pnpm exec playwright test -c playwright.ui.config.ts liquid-glass.spec.ts activities.spec.ts --reporter=dot` 为 23 passed / 1 failed（28.1s），失败项为活动详情页的横向溢出检查。该详情用例单独运行仍失败，临时撤去本次宽度修正后也同样失败，确认并非本次修正引入；已恢复宽度修正，没有改动详情页。最终 `pnpm exec playwright test -c playwright.ui.config.ts liquid-glass.spec.ts -g 'ignores empty space|themed arrow' --reporter=dot` 为 2 passed（4.1s）。`pnpm check` 为 0 errors / 0 warnings，`git diff --check` 通过。均为合成 API + Chrome，未运行完整构建、真实后端或其他浏览器验收；详情页溢出仍待另行处理。
