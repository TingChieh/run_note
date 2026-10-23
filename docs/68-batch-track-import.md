# 轨迹文件批量导入

## 使用方式

`/activities` 的导入卡片现在可以一次选择多个**同一种格式**的 GPX 或 TCX 文件（也可以把多个文件拖进选择区）。

- **选 1 个文件**：与以前完全一致，标题、时区、补录日期、TCX 时间解释都可用，按钮仍是“导入 GPX / 导入 TCX”。
- **选多个文件**：格式按扩展名自动判断。若混入不同扩展名或不支持的扩展名，页面提示“请分开导入同一种格式的 GPX 或 TCX 文件”，不会发送任何请求。
  - 标题和补录日期被禁用（它们只对单个文件有意义），文件格式下拉框也被禁用；时区会应用到每个文件；TCX 时间解释使用页面当前选择，对整批生效。
  - 点击“导入 N 个 GPX/TCX”后依次导入。进度显示“正在导入第 i / N 个：文件名”，并有“停止”按钮。停止只是不再发送后面的文件，正在进行的那个文件会等它结束，已完成的保留。
  - 结束后显示汇总：成功、重复跳过、失败，以及停止时的“未处理”数量；失败的文件按文件名列出中文原因，并提供“重试失败项”（只重发失败的，已成功和已重复的不会再发）。导入时带提示（如缺少时间）的文件只显示合计数量，详情在活动详情页查看。
- 整批结束（含停止）后才刷新一次活动列表，并只触发一次 `runnote-activities-changed`，而不是每个文件刷新一次。

## 改动范围

仅前端与测试，没有改后端、接口、数据库或依赖。

- `frontend/src/lib/import-queue.ts`（新增）：纯逻辑队列。严格串行；结果分为成功、重复（409 且带已有活动 ID）、失败、未处理；`429 IMPORT_BUSY` 按固定 1 秒（与后端 `Retry-After: 1` 一致）最多重试 5 次；`401` 立即停止并把剩余标为未处理；超过 10 MiB 的文件不发请求直接记为失败；只处理状态为 `pending` 的条目，所以重试不会重发已完成的文件。
- `frontend/src/lib/components/ImportBatchPanel.svelte`（新增）：进度、汇总、失败清单与按钮。进度条用语义令牌自绘，带 `role="progressbar"`，减少动态效果时无过渡。
- `frontend/src/routes/activities/+page.svelte`：文件选择框加 `multiple`；`pickChanged` 记录多选并做格式检测；新增 `runBatch`；`submit` 在多选时分流；单文件分支一行未改。401 沿用页面原有的 `fail()`（清除私人状态并跳转登录）。页面卸载时中止队列，保留 `disposed` 标志。
- 测试：`frontend/tests/unit/import-queue.test.ts`（11 个用例）、`frontend/tests/ui/activity-batch-import.spec.ts`（5 个用例）；`frontend/playwright.activity-library.config.ts` 的 `testMatch` 增加新 spec。
- 文档：设计 `docs/superpowers/specs/2026-10-23-batch-track-import-design.md`，计划 `docs/superpowers/plans/2026-10-23-batch-track-import.md`，以及本文件。

## 接口与隐私

- 后端接口、响应结构、数据库、SSR 代理请求头白名单与 11 MiB 上限均未改动。每个文件仍经现有 `uploadGpx` / `uploadTcx`，各自先取 CSRF 再上传。
- 后端每用户同一时间只允许一个导入，所以队列只能串行；并发上传没有收益，也没有实现。
- 文件名只保存在页面内存里用于进度与失败清单，不写入本机存储，也不发往除既有导入接口以外的任何地址。
- 每个文件仍各自提交一次数据版本更新；足迹 worker 在导入提交后会被唤醒，并把 1 秒内连续的唤醒合并为一次扫描（提交 `e578c77`），不会每个文件重建一遍快照。
- 不做：并发上传、断点续传、文件夹递归选择、逐文件编辑标题或补录日期、GPX 与 TCX 混合批量。

## 验证记录

2026-10-23，本机，真实 Chrome + 合成 API（`playwright.ui.config.ts` 基础配置），不连接任何数据库。

| 实际执行 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit/import-queue.test.ts`（先在实现前运行） | 先失败（模块不存在），实现后 11 passed |
| `pnpm check` | 0 errors / 0 warnings（574 files） |
| `pnpm test`（Vitest 全量） | 31 files / 187 tests passed |
| `pnpm exec playwright test --config playwright.activity-library.config.ts activity-batch-import.spec.ts` | 5 passed：多选依次导入且刷新一次、重复跳过与失败重试只重发失败项、停止后未处理、混合格式被拒与批量禁用字段、单文件流程不变且手机宽度无溢出 |
| 同一配置的整套活动相关用例（含上面 5 个） | 42 passed / 2 failed（见下） |
| 手动截图检查（桌面 1280 与手机 390，临时用例，已删除） | 进度条配色与页面一致；手机下提示文案不再被截断（据此缩短了空状态提示） |

### 已有的失败（与本次改动无关）

整套活动相关用例里有 2 个失败：`tcx.spec.ts:6`（导入步骤之后在手机视口里查找仪表盘日历日面板）和 `activity-metrics.spec.ts:9`（要求某个尺寸不小于 28）。我临时撤掉对 `routes/activities/+page.svelte` 的改动，在原始代码上分别重跑，**两个用例同样失败**，所以不是本次改动引入的。它们与提交 `89405ac`（手机宽度下隐藏年度日历）的时间点吻合，推测是仍按旧布局编写的断言，**这只是推测，我没有进一步定位或修改它们**。

### 未运行

- 后端测试（本次未改后端）。
- 真实后端上的导入 e2e（`playwright.*-e2e.config.ts`，需要独立测试库）：数百个文件的真实耗时没有测量，批量导入的总时长仍是线性的，每个文件受后端单次导入耗时限制。
- 开发服务未重启，新界面没有在运行实例上手动验证；部署后才会在线上生效。

## 剩余风险

- 数百个文件串行导入的总时长仍取决于后端单文件耗时（解析提速见提交 `e578c77`）。若仍不满足，下一步是评估新增批量接口（需要新的公共接口与测试库验证）。
- 停止后“未处理”的文件不会随“重试失败项”重新导入，需要重新选择；重复文件会被安全地跳过。
