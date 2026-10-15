# AGENTS.md — Run Note 工作指南

面向 AI 编码 Agent 的长期工作规范。只描述稳定、可验证、会影响实际改动的项目知识。
人类向的安装与背景说明见 `README.md`；两份文档职责不同，不要互相复制。

## 项目概览与技术栈

跑步数据管理与可视化分析系统（本科毕业设计）。前后端分离 + 模块化单体后端，PostgreSQL/PostGIS 为唯一持久化中心。

**非容器化是本项目的硬约束。** 开发与部署均使用 macOS/Linux 原生安装；`infra/compose.dev.yml` 是已停用的历史文件，不属于启动、测试或部署方案。不要引入 Docker/Compose，也不要用它来"方便地"起数据库。

- 后端：Python 3.12（`>=3.12,<3.13`）、FastAPI 0.143、Pydantic 2.14、SQLAlchemy 2.1（**同步**）、Alembic 1.20、psycopg3、GeoAlchemy2、gpxpy、defusedxml、argon2-cffi。依赖锁定在 `backend/requirements.lock`（`--require-hashes`）。
- 前端：SvelteKit 3 / Svelte 5（runes）、TypeScript 6（`strict`）、Vite 8、Tailwind 4、Vitest 5、Playwright 1.64、echarts 6、maplibre-gl 5。包管理器固定为 pnpm 11.25.0。
- 数据库：PostgreSQL 18 + PostGIS 3.6。
- 代码风格：Ruff，`line-length = 100`，lint 规则 `E,F,I,UP,B`。

## 仓库结构与模块职责

```text
backend/app/
  core/       配置(Settings)、统一响应、错误(ApiError)、日志、安全原语
  api/        依赖注入（get_session / get_identity / require_write）
  db/         Base、命名约定、会话工厂、schema 版本校验
  models/     模型集中注册入口
  modules/<feature>/   router / service / schema / model
backend/migrations/versions/   Alembic 版本（手写）
backend/tests/               unit（无 DB）与 integration（真实 PostGIS）
frontend/src/
  lib/api/         按领域划分的接口层与响应校验
  lib/server/      SSR 代理与后端调用
  lib/components/  Svelte 组件
  routes/          页面与 /api 代理端点
frontend/tests/  unit / ui / e2e
docs/            设计与验收记录（中文）
```

每个后端功能模块按自己的 `router/schema/service/model` 组织。**不要为每张表建立空壳 Repository/Manager/Factory**，简单查询直接写在模块 service 中；只有空间查询或确需复用的复杂查询才拆出 `queries.py`。

## 架构边界与依赖约束

- **分层职责**：Router 只做 HTTP 参数、依赖、调用 service、返回信封；Service 承载业务规则、授权、SQL 与事务；Schema 只做校验；Model 只做映射。路由中**禁止**实现距离算法或多步骤事务。
- **同步执行**：服务层一律是同步的普通函数（不是 class）。常规路由用 `def`，由 FastAPI 线程池执行。**禁止在 `async def` 中直接跑同步 DB 或重计算**；上传入口若要 async，必须用 `run_in_threadpool` 卸载阻塞工作。
- **提交边界**：路由在 service 调用后 `db.commit()`；service 内部用 `db.flush()`。唯一例外是 AI 报告模块（它把 DB 写入与外部 HTTP 调用交错，自己在内部提交）。
- **会话**：每个请求一个 Session，通过 `get_session` 依赖提供，不存在全局 Session。不要新增 per-request commit 中间件。
- **时间**：统一使用 `request.app.state.clock()`，不要在业务代码里直接调用 `datetime.now()`。
- **公共接口**：前端不得成为唯一校验入口。地图（MapLibre）与图表（ECharts）只做呈现，**不生成权威运动指标**；距离、用时、配速以服务端聚合为准。
- 前端 `lib/api/*` 是接口契约的消费者，不是业务逻辑的复制品。

## 编码规范与既有实现模式

### 后端

- 响应信封固定为 `{data, error, meta.request_id}`。`envelope()` 定义在 `activities/router.py` 与 `auth/router.py`，其余模块**导入复用**，不要重新定义。
- 错误统一 `raise ApiError(status_code, "CODE", "中文用户提示")`；可选 `retry_after=`（写入 `Retry-After` 头）与 `details=`。`details` 的键受白名单过滤，**新增键必须同步修改 `app/core/errors.py` 的白名单集合**，否则会被静默丢弃。
- 错误码为大写蛇形领域码；`message` 是给用户看的中文，日志与标识符用英文。不向客户端暴露 SQL、堆栈、文件路径或供应商原文。
- 所有请求体继承 `StrictInput`（`extra="forbid"`, `strict=True`，定义于 `app/modules/users/schema.py`），未知字段必须被拒绝。
- 列表响应统一 `{items, total, limit, offset}`，查询参数是 **`limit`/`offset`**（不是 `page`/`page_size`；`docs/04-rest-api.md` 的该处说法已过时）。通用取值：`limit` 默认 20、上限 100，`offset` 默认 0、上限 1000000；`ai_reports` 列表为例外（默认 10、上限 50）。年份类查询统一 `ge=1900, le=2100`。
- PATCH 语义：字段全部可选，用 `model_dump(exclude_unset=True)` 应用，**不要用 `exclude_none`**，并校验至少提交一个字段。
- 模型：UUID 主键用 `default=uuid4`；每张用户数据表都有 `user_id = ForeignKey("users.id", ondelete="CASCADE")`；时间列一律 `DateTime(timezone=True)` + `server_default=func.now()`；枚举用 `String(n)` + 具名 `CheckConstraint`；几何用 GeoAlchemy2 WKT。**项目不使用 `relationship()`**，关联在查询中显式 join。
- 新增模型必须注册到 `app/models/__init__.py`，否则元数据不完整；**新增模块的 router 必须 `include_router` 注册到 `app/main.py`（现有 11 处），否则路由静默不存在。** 模块 `__init__.py` 保持空文件，不做自动注册。
- 模块 router 沿用既有外形：多数为 `APIRouter(prefix="/api/v1/<name>", tags=["<name>"])`（`sharing` 因路径跨资源使用 `prefix="/api/v1"`），每个端点声明 `response_model=ApiResponse[X]`。
- **修改导入（GPX/TCX）逻辑前先读现有并发控制**：每用户同时仅一个导入，用 `pg_try_advisory_lock` 在专用自动提交连接上取得，冲突返回 429 `IMPORT_BUSY`（`gpx/service.py`）。不要新增另一套导入互斥机制。
- 服务写操作前调用 `lock_owner(db, owner)` 锁定本人 users 行并递增 `activity_data_version`（用于把旧 AI 报告标记为过时）。
- 归属校验在 service 层用 `owner` 过滤完成。按 ID 取本人资源时走 `owned_*` helper，**不存在与他人资源统一返回 404，绝不返回 403**，以免泄露存在性。
- 公开接口使用**独立的字段白名单序列化**，不复用本人视图；公开查询必须在 SQL 中强制 `visibility == "public"`。当前设计完全不公开坐标与精确起终点。

### 前端

- SvelteKit 3 的配置在 `vite.config.ts`（**没有 `svelte.config.js`**）。内部导入用 Node 子路径别名 `#lib/...` 且**带 `.ts` 扩展名**（如 `#lib/api/activities.ts`）；不要使用旧版 `$lib`。类型从 `$app/tsconfig` 继承。
- 服务端环境变量在 `src/env.ts` 用 `defineEnvVars` 声明，从 `$app/env/private` 导入；hooks 类型从 `@sveltejs/kit/hooks` 导入。**新增变量必须在 `defineEnvVars` 中声明**，前端可见的才设 `public: true`。Vite 配置了 `env: { dir: '..' }`，因此 `.env` 位于仓库根目录。
- 组件使用 Svelte 5 runes（`$props`/`$state`/`$derived`/`$effect`），props 用单次 `$props()` 解构并内联类型，回调命名 `onselect`/`onedit`/`ondelete`。**项目不使用 `createEventDispatcher`，也不使用 svelte store**。
- 页面数据在客户端 `onMount` 中通过 `lib/api` 加载；服务端 `load` 只提供 `locals.user`。读取路由信息用 `$app/state`，**不要用 `$app/stores`**。
- 组件里必须保留 `disposed` 清理标志（`onMount` 返回时置位，await 后赋值前检查）与单调请求令牌（丢弃过期响应）；遇到 401 一律清除私人状态并跳转登录。
- 样式基于 `src/app.css` 中的 CSS 自定义属性，通过 `@theme inline` 映射为 Tailwind 令牌（如 `bg-surface`、`text-muted-foreground`）。**新增颜色/间距应扩展令牌，不要在组件里硬编码色值。** 通用组件类（`.button-secondary`、`.page-header` 等）放在 `app.css` 的 `@layer components`。
- 外观默认跟随系统，支持手动明暗切换和恢复自动；偏好仅存本机 `runnote-theme`，由 `app.html` 在首屏解析为根元素 `data-theme`，`system-theme.ts` 负责后续同步。canvas/WebGL 绘制（地图、图表）必须调用 `watchSystemTheme` 订阅实际外观（包含手动切换），并在卸载时取消订阅。
- **SSR 安全**：`maplibre-gl` 与 `echarts` 只能在 `onMount` 内 `await import(...)` 动态加载，禁止模块顶层导入或访问 `window`/`document`，否则 adapter-node 构建会失败。
- `lib/api/*` 的接口层必须做**运行时响应校验**（逐字段检查类型与范围），失败抛领域错误类（如 `ActivityError`），不要直接信任后端返回的结构。401 统一映射为"登录已过期"。写操作必须先取 `/api/v1/auth/csrf`，再带 `X-CSRF-Token` 发送。
- 公共数据走**白名单重建**（如 `parsePublicActivity`），不要把后端响应整体展开。
- 地图/图表以本地数据优先：底图或瓦片失败不得阻断轨迹渲染；主题切换只改 paint 属性，不重建实例。
- 地图与图表组件沿用既有可访问性模式：容器加 `role="img"`/`role="region"` 与中文 `aria-label`，用 `data-testid` 暴露就绪/加载状态（如 `route-map-ready`），图表下方提供 `<details>` 完整数据表兜底，缺失值渲染 `—` 并附 `sr-only` 说明。

## 常用命令

后端（工作目录 `backend/`，使用仓库内虚拟环境）：

```bash
.venv/bin/pytest tests/unit -q                 # 单元测试，无需数据库
.venv/bin/pytest -q                            # 全量；未配置测试库时集成用例会跳过
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
.venv/bin/alembic current                      # 只读；核对数据库 revision
```

前端（工作目录 `frontend/`）：

```bash
pnpm test          # Vitest 单元测试
pnpm check         # svelte-check 类型检查
pnpm build         # 生产构建（adapter-node）
pnpm test:e2e      # Playwright，需后端已启动且数据库 ready
```

本地后端生命周期（仓库根目录，仅管理本仓库后端，默认端口 8001）：`./backend.command start|stop|restart|status|logs`。

`pnpm build` 会输出既有的大体积 chunk 警告，属已知状态，不是本次改动引入的失败。

## 数据库、迁移与配置

- 迁移**手写**，不依赖 autogenerate。文件名与 `revision` 同为 `NNNN_snake_case`（四位序号 + 变更描述，序号连续递增），维护一条线性 `down_revision` 链；新增前先 `ls backend/migrations/versions/` 确认下一个序号。
- 升级必须实现，**降级要防御性**：存在真实数据时 `raise RuntimeError` 而不是破坏数据。
- 新增迁移后，`/api/v1/health/ready` 与 `/api/health` 会因 revision 不匹配返回 503，直到目标库执行 `alembic upgrade head`。启动时期望值由 `get_expected_revision()` 读取，要求 head 唯一。
- 配置集中在 `app/core/config.py`（`Settings`），环境文件是**仓库根目录的 `.env`**（前后端共用）。字段小写蛇形，环境变量为大写蛇形。`extra="ignore"`、`hide_input_in_errors=True` 必须保留。密钥用 `SecretStr`。
- 开发库与测试库严格分离（唯一约束说明见"测试与验证要求"）。迁移与集成测试只允许作用于独立的 `_test` 库。
- `AUTH_RATE_HASH_KEY` 至少 32 字节，由 `scripts/local-auth.py` 管理，写入 Git 忽略的 `.env.auth-rate.key`（权限 600）。**不要输出、轮换或把它放进前端**。
- **不要引用文档里写死的 revision 号。** 迁移 head 用 `alembic heads` 动态查询，目标库当前版本用 `alembic current`。`README.md` 与设计文档中的 head 描述已多次滞后于代码，冲突时一律以代码与实际查询结果为准。

## 修改代码时的工作流程

1. **先定位再改**：改动前先读相关 router/service/schema 与其调用方，确认既有约定，不要凭猜测新增模式。
2. **复用优先**：优先使用现有组件、工具与服务；已存在的 `envelope`、`StrictInput`、`lock_owner`、`owned_*`、`lib/api` 工具是既定模式。
3. **最小必要改动**：不做与任务无关的重构、不顺手"优化"周边代码。
4. 较大功能遵循既有文档工作流：设计写 `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`，实施计划写 `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`，完成后追加编号特性文档 `docs/NN-<slug>.md`（编号取 `docs/` 下已用的最大编号 +1，用 `ls docs/` 现场确认，不要沿用文档里写死的编号）。文档使用中文，需包含"使用方式 / 接口与隐私 / 验证记录"并给出真实证据。
5. **不要擅自变更**公共接口、响应结构、数据库 Schema 或既有业务行为。确有必要时先说明影响范围并取得确认。
6. **不要删除或覆盖用户已有的未提交修改**，也不要顺手清理工作区。工作区可能长期存在大量未提交改动，这是有意保留的状态；改动前先确认目标文件是否已有未提交修改。

## 测试与验证要求

三层前端测试，用途不同，不要混用：

- `frontend/tests/unit` — Vitest，纯逻辑，`environment: 'node'`。
- `frontend/tests/ui` — Playwright `tests/ui`，由 `playwright.ui.config.ts` 驱动：`node tests/fixtures/ui-api.mjs` 起**合成 API**（8191）+ vite dev（5191）+ 真实 Chrome。**不连真实后端、不碰数据库。**
- `frontend/tests/e2e` — `playwright.config.ts`，需要**真实后端与 ready 的数据库**，会注册合成账号并导入记录。
- `backend/tests/unit` 不访问数据库；`backend/tests/integration` 需要独立 PostGIS 测试库。

**数据库保护**（后端集成测试与 `playwright.*-e2e.config.ts` 适用同一规则）：只允许名字以 `_test` 结尾、且显式列入 `TEST_DATABASE_ALLOWED_TARGETS` 的库；`backend/tests/conftest.py` 会以只读连接核对实际库名与端口，不匹配直接拒绝。优先复用既有的测试库；确需新建时按 `README.md` 的步骤创建，库名必须以 `_test` 结尾并加入允许目标，绝不能改用开发库。

**安全运行集成测试**：只在进程环境注入测试变量，**不要修改 `.env`**。既有做法见 `docs/09-phase-two-progress.md` 的"运行测试"小节（在 `backend/` 下就地构造 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS` 后以子进程调用 `pytest`）。未配置这些变量时集成用例会跳过，**跳过不等于通过**。

**Playwright 特性配置**：`playwright.activity-*.config.ts`、`playwright.tcx*.config.ts` 等继承 `playwright.ui.config.ts`，仅收窄 `testMatch`；用 `pnpm exec playwright test --config <file>` 显式运行，没有对应的 npm script。

前端 UI 测试依赖合成 API：**新增后端接口若被 UI 使用，必须同时在 `frontend/tests/fixtures/ui-api.mjs` 或该 spec 的 `page.route()` 拦截中补齐**，否则整套 UI 用例会 404。

验证纪律：

- 测试必须**真实执行**。无法执行时明确说明原因，**禁止声称测试通过**。
- **测试通过数量随开发变化，不要引用历史计数或据其判断当前状态**；每次改动后重新执行相关测试，并报告本次实际结果与命令输出。
- 绝不清理、改写或删除开发库中的数据；任何测试写入都不得落在开发库。
- 只运行与改动相关的最小测试集作为快速反馈，交付前再补充回归范围；报告时分开说明"实际运行"与"未运行"。
- 前端改动需通过 `pnpm check`；后端改动需通过 Ruff 检查与格式检查。

## 安全、数据保护与禁止操作

- **不执行** `git commit` / `push` / `merge` / `rebase` / 建 tag，也不部署或操作生产环境。提交一律由用户显式授权。这是本项目跨多轮一致约定的规则。
- **不在开发库执行迁移**。开发库升级必须先获得用户明确授权，并遵循"备份 → 恢复演练 → 受控单次升级 → 复核"的顺序；降级不是默认回滚手段。
- 绝不读取、输出或提交 `.env`、`.env.auth-rate.key` 等密钥文件内容，不把密钥写入代码、命令行参数、日志或文档。
- 不把真实 GPX/TCX 原文、坐标、轨迹或真实用户数据写入仓库、测试夹具或数据库；使用合成样本。
- **SSR 代理是安全边界**（`src/lib/server/backend.ts`）：目标源固定为 `INTERNAL_API_BASE_URL`，转发路径必须同源且以 `/api/` 开头，请求头只放行固定的 7 个（`cookie`、`origin`、`referer`、`x-csrf-token`、`content-type`、`accept`、`idempotency-key`）。**不要扩大该白名单，不要接受客户端传入的绝对地址，不要伪造 `Origin` 或信任 `X-Forwarded-*`。** 上传请求体上限 11 MiB，由 `Content-Length` 与流式计数双重校验。
- 私人数据边界：坐标、精确起终点、邮箱、用户名、备注、文件名、原始轨迹**不得**出现在公开接口、分享响应、外部地图 URL 或 AI 供应商请求中。地图只向底图服务请求视口瓦片，轨迹 GeoJSON 始终留在浏览器内。
- AI 供应商密钥只在服务端进程环境；不要放进 `PUBLIC_*` 或前端。默认无配置时功能应显示不可用，不要提供 Mock 开关绕过。
- 提交前若被授权提交，显式选择文件，不要使用 `git add -A`；排除密钥、数据库归档、合成账号密码与临时浏览器证据。

## 完成任务后的交付说明

报告需包含：

1. **改动范围**：具体文件与各自意图，区分后端/前端/文档/测试。
2. **验证结果**：实际执行的命令及其真实输出（通过/失败/跳过数量），明确列出**未运行**的检查。
3. **未确认事项与剩余风险**：例如"开发服务未重启，新接口未在运行实例上验证""真实 AI 供应商未配置"。
4. **未受影响的部分**：说明保留的既有行为、未改动的接口与数据。

不要夸大完成度：隔离测试库或合成 API 的通过，不等价于开发服务已加载新代码，也不等价于生产验收。

## 关于局部 AGENTS.md

当前仅在仓库根目录维护本文件；没有子目录级 `AGENTS.md`。只有在某个子模块形成稳定且与根目录规则明显不同的约定时，才考虑新增局部文件，且需先说明必要性。**不要批量创建。**
