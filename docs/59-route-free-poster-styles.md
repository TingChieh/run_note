# 分享图新增不含轨迹样式

日期：2026-10-17。在 [58-route-poster-styles](58-route-poster-styles.md) 基础上增加四种只展示统计数字的样式，避免轨迹过多时大量小路线显得密集、引起不适。本轮未提交、推送或部署。

## 使用方式

足迹墙点击「生成分享图」，样式选择区分为两组：「带足迹路线」（原四种）与「不含轨迹 · 只展示数字」：

| 样式 | 生成效果 |
| --- | --- |
| 大字里程 | 超大公里数、绿色强调条、三行右对齐统计 |
| 跑步票根 | 存根卡片、虚线撕口、清单行、合计里程与装饰条码 |
| 半马勋章 | 公里数页头、双色圆环中央显示折算半马次数、底部次数/天数 |
| 动感斜纹 | 绿底黄斜纹色带、大号公里数与三列统计 |

选择不含轨迹的样式时：说明文字改为「当前样式只绘制统计数字」，隐私提示改为「图片只包含统计数字，不含路线形状」，预览下方不显示「随机展示 K/N 条轨迹」与「换一组轨迹」。与原样式之间切换仍只在本地重绘同一份数据，可随时切回带足迹样式。

## 接口与隐私

后端、接口、数据库、`route-poster-data.ts` 均无改动。为保持「切换样式不重新请求」，生成预览时仍按原规则读取抽样路线；因此所选范围完全没有轨迹时仍会提示没有可用轨迹（既有行为，未改变）。新样式只绘制范围、公里数、次数、活动天数和半马折算；票根条码由这些可见数字派生，纯装饰，不编码活动ID或任何额外信息。输出仍为 1080×1920 PNG，仅像素。

## 改动范围

- `frontend/src/lib/share/route-poster-render.ts`：样式列表增加 `routes` 标记与 `posterHasRoutes`，新增四种构图及对齐、票根撕口、数字+单位辅助绘制。
- `frontend/src/lib/components/RoutePosterDialog.svelte`：分组展示、新样式SVG示意（主题Token）、不含轨迹时的文案与按钮条件显示。
- `frontend/tests/ui/route-poster.spec.ts`：新增浅/深色两项用例。
- `docs/design-system/components.md`：RoutePosterDialog 条目更新。

## 验证记录

在 `frontend/` 真实执行（合成API 8191 + Vite 5191 + Chrome，不连真实后端/数据库）：

- `pnpm exec playwright test --config playwright.route-poster.config.ts --reporter=line`：17 passed（含新增2项与原15项）。新用例逐一切换四种不含轨迹样式，校验PNG签名与尺寸、四份SHA-256互不相同、底部1888～1920行为纯背景、切换期间请求序列不变、轨迹文案与「换一组轨迹」隐藏，切回经典足迹后恢复。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm test`：28 files，168 passed。
- `pnpm build`：完成（既有大体积chunk提示）。
- `git diff --check`：无空白错误。
- 人工查看浅/深色八张PNG与桌面选择区截图：文字无重叠，单位紧随数字。

## 未验证

真实账户数据、真实系统分享、Safari/Firefox、生产环境、完整UI总集与后端测试均未运行；开发服务未重启。

## 补充：图片外观可单独选择

样式上方新增「图片外观」：跟随网站（默认，与原行为一致）/ 日间 / 夜间，适用于全部八种样式。选择日间或夜间后，生成的PNG固定使用该主题配色，网站自身主题不变，之后系统或手动切换网站主题也不会改动已固定外观的图片；切换外观只在本地重绘，不重新请求或重新抽样。关闭再打开保留当前选择，刷新恢复「跟随网站」，不新增本地存储。样式缩略示意仍跟随网站主题。

实现：`src/app.css` 中浅色 `:root` 规则增加 `[data-poster-theme="light"]`，深色规则增加 `[data-poster-theme="dark"]` 及其 `.sport-theme` 后代，并让 `:root[data-theme="dark"] .sport-theme` 排除浅色探针内的 `.sport-theme`。对话框放一个隐藏的两层探针（外层带主题属性、内层 `.sport-theme`），`posterPalette` 从探针读取语义Token；没有复制任何色值。

验证（`frontend/`，合成API + Chrome）：

- `pnpm exec playwright test --config playwright.route-poster.config.ts --reporter=line`：18 passed。新增用例在浅色网站选夜间、在深色网站选日间、再切回跟随网站，逐像素核对背景/卡片/黄色页头与两套Token一致，确认 `html[data-theme]` 不变、请求序列不变、票根样式同样生效、重开保留选择。
- `pnpm exec playwright test --config playwright.ui.config.ts tests/ui/theme.spec.ts tests/ui/ui-shell.spec.ts`：16 passed / 3 failed。失败为 ui-shell 的导航登出、侧栏草稿、笔记本高度三项；临时撤回本次 `app.css` 改动后同样3项失败，属既有问题，与本改动无关。
- `pnpm check` 0 errors / 0 warnings；`pnpm test` 168 passed；`pnpm build` 完成；`git diff --check` 无问题。

## 补充：统计月份改用项目日期选择器

「指定月份」不再使用浏览器原生月份弹层，改用 `DatePicker` 新增的 `granularity="month"` 模式（值仍为 `YYYY-MM`，原生 month 输入仍可直接键入）：年份选择与上/下一年、3×4 月份格、当前月描边、已选月份主色、清除/本月；方向键按月、上下按行、Home/End 行首尾、PageUp/Down 按年，Esc 只关闭日历不关闭分享对话框并把焦点还给触发器。新增 `onselect` 回调用于切换月份时清除旧图；生成/分享期间禁用。月份格复用 `data-date` 标记，因此液态玻璃不会覆盖选中色（第一次实现未加此标记时，选中月份文字不可见，已修复）。DatePicker 默认 `date` 模式行为不变；独立 showcase 未新增月份示例（避免改动像素基线）。窗口滚动监听改为捕获阶段，使弹层在对话框内部滚动时也重新定位。

## 补充：分享图权限

「生成分享图」只在登录且查看本人数据时出现：`/workspace/*`、站主登录后的根展示、已登录用户访问自己的 `/p/{username}/*`。匿名访客、登录用户查看站主或他人的展示页均不渲染按钮与对话框；离开本人视图（如退出登录）时取消进行中的生成。

生成时无论当前页面是哪种视图，抽样、路线与统计一律请求需认证的本人接口 `/api/v1/activities`、`/api/v1/activities/{id}/route`、`/api/v1/statistics/summary`，不再走匿名 `/api/v1/showcase/*`。后端由 `get_identity` 校验会话并按本人 `user_id` 过滤，因此即使绕过界面也只能拿到自己的数据；会话过期按既有逻辑跳转登录。后端无改动。注意：公开展示接口本身仍匿名可读（展示页需要），这里限制的是分享图功能，不改变展示数据的公开范围。

验证（`frontend/`，合成API + Chrome）：

- `pnpm exec playwright test --config playwright.route-poster.config.ts`：22 passed。新增：匿名访客在根与具名展示墙均无按钮、无路线请求，匿名请求本人统计接口得到401；站主看他人具名展示无按钮；新建合成受管账号登录后在根展示和站主具名页无按钮、在自己的具名页与工作区可生成且请求不含 `/showcase/`；三种视图下站主生成的所有请求都是本人接口。另把 `allowed` 临时改为恒真，两项权限用例均失败，确认用例有效后已恢复。月份日历：点击选择、键盘、Esc、320px不溢出。
- `playwright.ai-datepicker.config.ts` 2 passed、`popover-motion` 5 passed、`design-system` 6 passed（像素基线未变）。
- 回归 `playwright.ui.config.ts`：dashboard-explorer 14、footprint-card-deck 32 全部通过；activities 15 passed / 1 failed（导入请求计数 2≠1），milestones 11 passed / 1 failed（足迹墙页退出登录后未跳转 `/admin?reason=logout`）。后者与 ui-shell 中既有的退出登录失败症状相同（在无分享图的 `/activities` 页同样复现），并在临时让对话框无条件渲染、去掉新增 effect 时仍然失败，判断为既有问题。
- `pnpm check` 0/0；`pnpm test` 168 passed；`pnpm build` 完成；`git diff --check` 无问题。
- 一次 route-poster 全量运行出现1项偶发失败，随后连续3次全量 19/19 通过，未定位具体用例。

## 补充：即时预览与按需读取

不再需要点击「生成预览」。打开对话框立即用内置合成样例（`src/lib/share/route-poster-sample.ts`：48 条程序生成的闭合曲线和虚构统计，不来自任何真实轨迹，不发请求）绘制当前样式，并标注「示例效果，非你的数据」；样例状态下「保存 PNG」禁用、不提供系统分享。同时自动读取本人数据：

- 不含轨迹样式只需统计总数：仅 1 个请求（`/api/v1/statistics/summary`，月份范围为带日期的同一接口）。
- 带足迹样式才读取全量列表与最多 120 条抽样路线（与原规则一致）；路线结果同时包含统计总数，可直接用于不含轨迹样式。
- 结果按统计范围缓存在当前页面：关闭再打开、切换样式或外观都只在本地重绘（实测切换约 20–145 ms），不重复请求；切换范围/月份会清空缓存并自动重新读取；「换一组轨迹」重新抽样，新结果到达前保留旧图。刷新页面后重新读取。
- 读取期间样式与外观仍可点击，样例即时切换；可「取消读取」，取消或失败后显示「读取我的数据」重试。会话过期仍跳转登录。

修复：对话框关闭事件是异步派发的，快速关闭后立即重新打开时，迟到的 close 事件会停止新会话，导致预览停在“正在绘制预览…”。现在 close 事件发现对话框已重新打开时忽略。该问题由新用例在全量运行中 2/2 复现，修复后全量连续 4 次 22/22 通过。

验证（`frontend/`，合成API + Chrome）：

- `pnpm exec playwright test --config playwright.route-poster.config.ts`：连续 4 次 22 passed。改写/新增覆盖：打开即显示样例且不可保存；读取期间切换样式（含不含轨迹样式）立即重绘且请求序列不变；不含轨迹样式读取时请求序列恰为 `['/api/v1/statistics/summary']`；之后切到带足迹样式才请求路线；关闭重开同范围零请求；月份切换自动重读；失败显示提示并保留样例，重试成功；取消会中止进行中的路线请求；其余原有导出、主题、分享降级、权限用例保留。
- `playwright.ai-datepicker` 2 passed、`design-system` 6 passed；`pnpm check` 0/0；`pnpm test` 168 passed；`pnpm build` 完成；`git diff --check` 无问题。

未验证：真实后端网络延迟下的读取时长、长期缓存的数据新鲜度（同一页面内新导入的记录需刷新页面或切换范围后才会出现在分享图中）、Safari/Firefox。
