# 73. 字号与字重阶梯

全站文字只使用一套字号和字重。字体栈不变。不改接口、数据库或后端。

## 使用方式

组件里的 `font-size`、`font-weight`、`letter-spacing`、`line-height` 只引用 `frontend/src/app.css` 的 token。Tailwind 的 `text-xs`…`text-4xl` 与 `font-normal|medium|semibold|bold` 在 `@theme` 中对齐同一阶梯。`pnpm lint:style` 与 `tests/unit/typography-scale.test.ts` 拒绝写死的字号、550/650/750，以及任意的 `text-[…]` / `font-[…]`。

| Token | 值 | 角色 |
| --- | --- | --- |
| `--text-caption` | 12px | 眉题、日期、角标、图例 |
| `--text-small` | 14px | 次要说明、按钮、表单标签 |
| `--text-body` | 16px | 正文；足迹墙卡片标题 |
| `--text-card` | 18px | 卡片标题 |
| `--text-section` | 20px | 区块 h2、行内数字 |
| `--text-stat` | 28px | 卡片大数字 |
| `--text-title` | 40px | 页面 h1、主数字 |
| `--text-display` | 48px | 特大展示数字 |

字重只有 `--weight-regular` 400、`--weight-medium` 500、`--weight-semibold` 600、`--weight-bold` 700。`--weight-title` 与 `--weight-sport-title` 引用 bold。

行高五档：1、1.15、1.25、1.4、1.65。中文标题字距为 0。只有全大写拉丁短标使用 `--tracking-caps: .12em`。

同类元素：

- 区块 h2：20 / 600。原先 dashboard 一页混用 16/600 与 20/700。
- 卡片标题：18 / 600。足迹墙网格里的紧凑卡片是 16 / 600。详情页底部的窄足迹卡用 14 / 600 并换行，避免 390px 宽时被省略号截断。日历月份格内标签保持 14，它不是卡片标题。
- 大数字：hero、目标、页面主距离 40 / 700；汇总卡片与足迹墙距离 28 / 700；活动列表与详情侧栏的行内数字 20 / 700。一律 `tabular-nums`。宽度 ≤640px 时，活动详情页的 h1 和首屏距离降到 28 / 700，390px 宽时标题回到一行。
- 登录页 h1 与其他页面同为 40 / 700。原先登录页是 30 / 600。
- 按钮：14 / 600。dashboard 上原先 20 / 600 的年份箭头、16 / 400 的功能入口和日历日格、16 / 600 的目标按钮，都收到这一档。
- 详情页底部的足迹卡片标题允许换行，并随卡片宽度在 14–16px 之间缩放。用时/配速行与大数字同样用流式字号，上限仍是阶梯上的 12 和 28。足迹墙网格里的紧凑卡片在窄列上仍用省略号。

海报画布按像素坐标排版，不套用 CSS 字号阶梯；字重仍只能是 400/500/600/700。弹簧刚度等非文字数值不受这套规则约束。

## 接口与隐私

无新接口。不读取、不展示额外的私人字段。分享图仍在浏览器内绘制。

## 验证记录

同一套合成数据、1440×1000 视口下，收敛后的计算样式：

| 元素 | 收敛前 | 收敛后 |
| --- | --- | --- |
| 页面 h1 | 40px / 750，字距 -1.4px；登录页 30px / 600 | 40px / 700，字距 0 |
| dashboard 区块 h2 | 16px / 600 与 20px / 700 并存 | 全部 20px / 600 |
| 活动卡片标题 | 20px / 700 | 18px / 600 |
| 足迹墙卡片标题 | 14px / 650 | 16px / 600 |
| 目标数字 | 48px / 750 | 40px / 700 |
| 汇总卡片数字 | 38.4px / 700 | 28px / 700 |
| 足迹墙距离 | 24px / 750 | 28px / 700 |
| 活动列表数字 | 20px / 700 | 20px / 700 |
| 详情侧栏数字 | 20px / 700 | 20px / 700 |

2026-10-24 在本机实际运行：

- `pnpm check`：0 错误、0 警告。
- `pnpm test`：34 个文件、201 项通过。
- `pnpm lint:style`：通过。`tests/unit/typography-scale.test.ts` 含在上面的 201 项里。
- `pnpm build`：构建成功。既有的大于 500 kB chunk 警告仍在。
- `pnpm exec playwright test --config playwright.ui.config.ts`：167 项通过。
- 320px 宽的设置页：分区标签的玻璃指示层会比标签条多出几像素，把 `scrollWidth` 撑到 328。指示层限制在标签条内，页头允许收缩。`tests/ui/ui-shell.spec.ts` 的移动菜单用例连跑 10 次通过，断言未放宽。
- 390px 宽的活动详情：h1 与首屏距离为 28px / 700，标题「上海世纪公园晨跑」为一行。底部足迹卡标题换行，不再出现省略号。
- dashboard 按钮统一为 14px / 600，包括年份箭头、功能入口、日历日格、目标按钮和下拉箭头。

2026-10-24 复查后再次运行：

- `pnpm check`：0 错误、0 警告。
- `pnpm test`：34 个文件、201 项通过。
- `pnpm lint:style`：通过。
- `pnpm build`：构建成功。既有的大于 500 kB chunk 警告仍在。
- `pnpm exec playwright test --config playwright.ui.config.ts`：167 项通过。
- `pnpm exec playwright test --config playwright.ui.config.ts tests/ui/ui-shell.spec.ts -g "mobile menu supports keyboard" --repeat-each=10`：10 项通过。
- 足迹卡片高度：`tests/ui/footprint-card-deck.spec.ts` 的 mixed metrics 用例通过。窄卡用时/配速改为 `--text-caption-fluid`，标题和大数字分别用 `--text-body-fluid`、`--text-stat-fluid`。

2026-10-24 流式字号后再运行：

- `pnpm check`：0 错误、0 警告。
- `pnpm test`：34 个文件、201 项通过。
- `pnpm lint:style`：通过。
- `pnpm build`：构建成功。既有的大于 500 kB chunk 警告仍在。
- `pnpm exec playwright test --config playwright.ui.config.ts`：167 项通过。

未在 macOS 上用苹方复看。字重上限 600/700 是针对「苹方最高 600、可变字体数字更粗」的代码层修正。设计系统像素快照（`playwright.design-system.config.ts`）未作为本次回归运行。开发服务与生产站点未加载这套改动。未 rebase `main`。

2026-10-24 将 `origin/main`（含 #13、#16）merge 进本分支后，#13 的写死排版改为 token，布局保留：

- 登录 `.auth-lead` / `.auth-help`：`.875rem` → `--text-small`（14px）。
- 足迹条 `.strip-page span`：`1.5rem` / `line-height: 1` → `--text-section`（20px）/ `--line-height-solid`。
- 字重 650 → `--weight-semibold`，750 → `--weight-bold`。字距 `-.035em` → `0`。
- 足迹墙网格标题保持 16 / 600，距离保持 28 / 700。窄足迹卡仍用 `--text-body-fluid`、`--text-stat-fluid`、`--text-caption-fluid`。
- 侧栏品牌分组、导航行固定 3.5rem、足迹地图按视口高度、路线水印改为 SVG 遮罩，这些来自 #13 的布局都保留。导航字号用 `--text-body`（16px）。

合并后再次运行：

- `pnpm check`：0 错误、0 警告。
- `pnpm test`：35 个文件、205 项通过。
- `pnpm lint:style`：通过。
- `pnpm build`：构建成功。既有的大于 500 kB chunk 警告仍在。
- `pnpm exec playwright test --config playwright.ui.config.ts`：172 项通过。
- 合成数据下，390 与 1440 宽的登录、数据汇总、跑步记录、活动详情、足迹墙都没有横向溢出。390 宽详情标题「河畔晨跑」为 28px / 700、一行。足迹墙卡片标题 16px / 600，距离 28px / 700。登录标题 40px / 700，说明与密码提示 14px。

未 rebase，未推送 `main`。设计系统像素快照未跑。开发服务与生产站点未加载这次合并。
