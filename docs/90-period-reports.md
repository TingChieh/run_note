# 90 月度与年度跑步报告

日期：2026-11-20（Issue #103）。设计与实施计划见 `docs/superpowers/specs/2026-11-20-period-reports-design.md` 与 `docs/superpowers/plans/2026-11-20-period-reports.md`。

> 在既有「个人记录」页（`docs/75-personal-records.md`）内，为**已登录用户查看本人记录**新增可切换**自然月**与**自然年**的周期报告区块，沿用扁平卡片语言、设计令牌与现有控件，呈现跑步次数、总里程、总用时与平均配速四项首要指标。匿名展示与他人的公开主页保持原样不变。无数据库变更、无迁移。

## 使用方式

- **入口与可见边界**：遵循 Issue #103 的已登录用户授权范围，通过 `viewsOwnRecords(page.url.pathname, page.data.user)` 门控，仅在已登录用户查看本人记录时显示（本人工作区 `/workspace/records`、站主登录后的 `/records`、本人登录后的 `/p/{username}/records`）。位于顶部 `RecordsBanner` 与一句人话总结下方、月度柱状图上方；账号尚无任何记录时同样可展示空周期状态。匿名访客与已登录非本人访客看到的公开「个人记录」页布局、文案与请求均保持原样不变。
- **周期切换**：
  - 标题行右侧使用 `.settings-tabs` 分段按钮在「月度 / 年度」间切换。
  - 月度模式复用 `DatePicker granularity="month"` 与上下月步进按钮，选择 1900-01 至当前月之间的自然月；年度模式提供年份下拉选择与上下年步进按钮。浏览历史周期时提供「回到本月 / 回到今年」快捷按钮。
- **核心指标与缺失值**：
  - 采用与数据汇总 `.annual-metrics` / `RecordsBanner` 一致的发丝线分隔横条与圆形运动色徽章，展示**跑步次数**、**总里程**、**总用时**、**平均配速**。
  - 宽屏（容器 ≥ 52rem）四列并排，平板（30–52rem）2×2，手机（< 30rem）单列堆叠。
  - 缺少有效用时或有效距离时显示 `—` 并附 `.sr-only` 说明；底部附注列出活动天数、有效计时覆盖说明与当前周期截止日期。
- **状态与切换一致性**：
  - 初次加载显示 `FeedbackState kind="loading"`，标题标明所请求周期。
  - 周期切换请求在途时，保留旧报告版面（降不透明度），但显示的周期标题、日期范围、`进行中` 标记、空状态标题与指标容器 `aria-label` 全部严格绑定已加载的 `report`，绝不用新周期标签标注旧周期数据；同时以可见且带 `role="status"` 的状态标签（`正在读取 <目标周期>…`）明确告知正在加载的新周期；快速切换时通过单调请求令牌丢弃乱序旧响应。
  - 空周期显示 `FeedbackState kind="empty"`；读取失败清除旧数据并仅在报告区块内显示错误与「重试」按钮，不影响页面其余内容；401 清空私人状态并跳转 `/admin?reason=expired&next=...`。

## 接口与隐私

仅注册本人认证只读 GET 端点，响应信封 `{data, error, meta.request_id}`：

| 范围 | 路径 |
| --- | --- |
| 本人认证视图 | `/api/v1/statistics/report` |

- **不新增匿名/公开展示报告端点**：`/api/v1/showcase/statistics/report` 与 `/api/v1/showcase/users/{username}/statistics/report` 不存在（返回 404）；匿名请求 `/api/v1/statistics/report` 返回 401。既有公开 `/api/v1/showcase/statistics/records` 与 `/api/v1/showcase/users/{username}/statistics/records` 保持不变。
- **查询参数**：`period=month|year`（必填）、`year`（1900–2100，必填）、`month`（1–12；月度必填，年度不可传入，非法组合返回 422 `VALIDATION_ERROR`）。
- **统计口径与半开区间**：全部复用 `backend/app/modules/statistics/service.py` 的 `summary()`、`expressions()`、`finalize()`：
  - 日期按 `activity_date`（`date_assignment = "activity_local_date"`）；计时优先取 `timer_seconds`，缺失时回退 `elapsed_seconds`；平均配速按有效距离加权（`ROUND_HALF_EVEN` 量化到 `0.001` 秒/公里）；无已知用时或无配速资格记录时返回 `null`。
  - 自然月半开区间为 `[YYYY-MM-01, 次月 1 日)`（含闰年 2 月 29 日，12 月止于次年 1 月 1 日不含）；自然年为 `[YYYY-01-01, (YYYY+1)-01-01)`。
  - **当前周期与未来数据边界**：以 `request.app.state.clock()` 转换所属用户时区得到 `today`。当前月/当前年返回 `is_partial = true`、`cutoff_date = today`，查询区间收敛为 `[period_start, min(period_end, today + 1 day))`，排除晚于 `today` 的未来日期活动；尚未开始的未来周期返回空区间 `[period_start, period_start)` 与零值汇总。
  - 关于 `docs/75` 第 29 行的已知遗留（`records` 逐年回顾中当前年汇总未截断未来日期）：已核实 `test_records.py` 明确断言 `records` 全部历史时间线可延伸到未来日期；本次保持 `records` 既有契约不变，仅在新增的周期报告接口与界面中保证当前周期严格截止到 `today`。
- **响应结构**：`PeriodReport(Summary)`，在 `Summary` 全部字段基础上补充 `period`、`year`、`month`、`date_from`、`date_to`、`is_partial`、`cutoff_date`、`today`。前端 `frontend/src/lib/api/period-report.ts` 直连 `/api/v1/statistics/report` 并执行运行时校验，同步生成 `frontend/src/lib/api/generated/api.ts` 与 `frontend/tests/contract/api-types.ts` 契约断言。
- **权限与隐私**：由 `get_read_identity` 与 `A.user_id == owner` 隔离跨账号数据，未登录返回 401；响应仅含聚合统计与日期范围，不含标题、备注、文件名、坐标、邮箱或身心健康数据。

## 验证记录

后端集成测试与真实后端 E2E 均在隔离临时 PostgreSQL 18 + PostGIS 3.7 集群（独立 `run_note_test` 库，进程环境变量注入）中执行，未修改 `.env`，未触碰开发库；完成后已停止并清理临时集群。

### 实际运行（2026-11-20，一轮审查修复后复验）

| 命令 | 结果 |
| --- | --- |
| `cd backend && .venv/bin/python -m app.contract.typescript --check` | 退出码 0（契约最新） |
| `cd backend && .venv/bin/ruff check app migrations tests` | All checks passed |
| `cd backend && .venv/bin/ruff format --check app migrations tests` | 261 files already formatted |
| `cd backend && .venv/bin/alembic heads`（只读） | `0030_global_footprint_caches (head)` |
| 后端定向单元 `pytest tests/unit/test_period_report.py tests/unit/test_architecture.py tests/unit/test_api_contract.py -q` | 40 passed（1.83 s） |
| 后端定向 PostGIS 18 集成 `pytest tests/integration/test_period_report.py tests/integration/test_statistics.py tests/integration/test_records.py tests/integration/test_showcase.py -q -rs` | 31 passed（12.18 s） |
| 后端全量 `pytest -q -rs`（单元 + 独立 PostGIS 18 集成） | 978 passed, 1 skipped（`test_migrations.py` 快照库未配置）, 0 failed（317.38 s） |
| `cd frontend && pnpm test` | 57 test files, 377 passed, 0 failed |
| `cd frontend && pnpm check` | 0 errors, 0 warnings |
| `cd frontend && pnpm lint:style` | 退出码 0 |
| `cd frontend && pnpm build` | 构建成功（adapter-node；既有大体积 chunk 提示未新增错误） |
| 定向 UI 测试 `playwright.ui.config.ts tests/ui/records.spec.ts tests/ui/records-banner.spec.ts --reporter=list` | 24 passed, 0 failed（28.3 s；含匿名无入口、非空→非空、空→非空、失败重试、乱序响应与三档视口明暗主题） |
| 全量合成 API UI 测试 `playwright.ui.config.ts --reporter=line` | 356 passed, 4 skipped, 0 failed（14.5 m） |
| 全量真实后端 E2E `pnpm test:e2e --reporter=line`（含 `tests/e2e/period-report.spec.ts`） | 14 passed, 0 failed（52.9 s） |
| 视觉检查（隔离合成 API + Vite，Chromium）：1440×900 / 768×1024 / 390×844 × 浅/深色（共 18 张：匿名页、延迟切换刷新态、切换完成态） | 全部 0 横向溢出、0 console error、0 page error；已人工复核截图，匿名页与基线一致，切换刷新态标题/范围/`aria-label`/指标完全对齐 |

### 未运行

- `infra/` 运维脚本自检与发布演练（`ops-e2e*.sh`、`offsite-e2e.sh`、`caddy-instances.sh`）：本次未改动 `infra/`、迁移、`scripts/` 或依赖清单。
- `playwright.design-system.config.ts`：初版已确认 7 passed / 2 failed（Linux 环境缺少 `*-linux.png` 基线，仓库仅提交 `*-darwin.png`），本次修复未改动公共设计系统组件，未重跑或重录基线。
- `playwright.basemaps-live.config.ts`（需外网底图服务）、真机 Safari / Firefox 视觉复核。
- 未触碰开发库或生产环境。

## 未受影响的部分

既有 `summary`、`calendar`、`trends`、`streaks`、`records`（含根展示与具名展示）接口响应结构与数字、匿名「个人记录」公开页布局与文案、足迹、常跑路线、分享海报、AI 分析、身心健康日记与数据库 Schema 均未改动。
