# AI 分析日期复用统一选择器

日期：2026-10-15。

## 使用方式

AI 跑步分析的开始日期、结束日期改为复用已有 DatePicker；点击日历图标可选择年月和日期，支持方向键、Enter 与 Esc。保留原「开始日期（周一）」「结束日期（周一，不含）」含义和默认最近四个完整自然周。

此前 AI 页直接使用两个原生 input，没有接入共用组件。此次只替换控件，并给 DatePicker 增加默认关闭的 disabled 属性：AI 正在生成或有待确认请求时，日期输入与日历触发按钮同时禁用，已打开的面板关闭。其它调用方默认行为不变。

## 接口与隐私

前端沿用 from/to 绑定、用户时区、required、busy/pending 条件和既有统计依据读取入口，不改后端接口或自然周校验。仅选择日期不会自动生成分析或调用供应商。没有发送原始轨迹或新增数据字段。

## 验证记录

- RED：`pnpm exec playwright test --config playwright.ai-datepicker.config.ts --grep 'AI ranges'`，1 failed；原页面缺少「选择开始日期（周一）」按钮。
- PASS：`pnpm exec playwright test --config playwright.ai-datepicker.config.ts`，2 passed in 4.9s，真实 Chrome + 合成 API，不连接真实后端或供应商。验证鼠标/键盘选日、提交日期范围正确、选日不调用 AI、生成期间禁用两个输入与按钮，以及 320/390/768/1440px 日历不溢出。
- PASS：生产 adapter-node + 合成 API 下 `pnpm exec playwright test --config /private/tmp/runnote-ai-datepicker-built.config.ts`，2 passed in 3.4s。独立端口 8194/5194，等待弹层淡入完成后再测量和截图；沙箱内首次运行因端口 EPERM 未启动测试，使用本机端口权限重跑成功。
- PASS：前端完整 `pnpm test`，123 passed（19 文件）；`pnpm check`，0 errors / 0 warnings；`pnpm build` 成功，仅已知大 chunk 提示。足迹/p2/主题合成 Chrome 回归共 31 passed，其中保留 AI 日期键盘交互测试。
- 控件静态复查未发现重要问题。已目视 [桌面日历](/Users/tingchieh/.codex/visualizations/2026/10/15/01a14002-959f-7bd0-a695-f04997d80774/ai-datepicker-desktop.png) 与 [手机日历](/Users/tingchieh/.codex/visualizations/2026/10/15/01a14002-959f-7bd0-a695-f04997d80774/ai-datepicker-mobile.png)。

开发服务是否已加载新页面没有在真实账号上验证；本轮不调用付费供应商、不修改数据库与环境文件。
