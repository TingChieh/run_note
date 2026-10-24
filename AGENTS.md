# AGENTS.md — Run Note 工作指南

面向 AI 编码 Agent 的长期工作规范。只描述稳定、可验证、会影响实际改动的项目知识。
人类向的安装与背景说明见 `README.md`；两份文档职责不同，不要互相复制。
文档与代码冲突时一律以代码和实际查询结果为准。

## 1. 项目概览与技术栈

跑步数据管理与可视化分析系统（本科毕业设计）。前后端分离 + 模块化单体后端，PostgreSQL/PostGIS 为唯一持久化中心。

**非容器化是本项目的硬约束。** 开发与部署均使用 macOS/Linux 原生安装；`infra/compose.dev.yml` 是已停用的历史文件，不属于启动、测试或部署方案。不要引入 Docker/Compose，也不要用它来"方便地"起数据库。

- 后端：Python 3.12（`>=3.12,<3.13`）、FastAPI 0.143、Pydantic 2.14、SQLAlchemy 2.1（**同步**）、Alembic 1.20、psycopg3、GeoAlchemy2、gpxpy、defusedxml、argon2-cffi。依赖锁定在 `backend/requirements.lock`（`--require-hashes`）。
- 前端：SvelteKit 3 / Svelte 5（runes）、TypeScript 6（`strict`）、Vite 8、Tailwind 4、Vitest 5、Playwright 1.64、echarts 6、maplibre-gl 5。包管理器固定为 pnpm 11.25.0，Node `^22.17 || ^24`。
- 数据库：PostgreSQL 18 + PostGIS 3.6。
- 代码风格：Ruff，`line-length = 100`，lint 规则 `E,F,I,UP,B`。

## 2. 仓库结构

```text
backend/app/
  core/       配置(Settings)、统一响应、错误(ApiError)、日志、安全原语
  api/        依赖注入（get_session / get_identity / require_write）
  db/         Base、命名约定、会话工厂、schema 版本校验
  models/     模型集中注册入口
  modules/<feature>/   router / service / schema / model
backend/migrations/versions/   Alembic 版本（手写）
backend/tests/                 unit（无 DB）与 integration（真实 PostGIS）
frontend/src/
  lib/api/         按领域划分的接口层与响应校验（含 map-style 等地图样式逻辑）
  lib/server/      SSR 代理与后端调用（安全边界）
  lib/components/  Svelte 组件（含 system-theme.ts）
  lib/map/         底图控制器、足迹显示与配色
  lib/share/       路线海报数据与渲染
  lib/styles/      液态玻璃、弹层/卡片动效等共享样式与运行时
  settings-header.svelte.ts   设置页共享头部状态（与 SettingsTabs 配套）
  routes/          页面与 /api 代理端点
frontend/tests/    unit / ui / e2e / fixtures
scripts/           离线运维脚本（local-auth.py、site-owner.py）
infra/native/      原生部署资产：systemd 单元、Caddyfile、env 模板、ops/ 发布与备份脚本、tests/（见 docs/66）
docs/              设计与验收记录（中文）；docs/design-system/ 为 UI 规范
```

后端功能模块以 `backend/app/modules/` 目录为准（现有 activities、admin_users、ai_reports、auth、footprints、gpx、health、mifitness、running_goals、sharing、showcase、site_settings、statistics、tcx、users）；新增模块须按第 4 节注册。每个模块按自己的 `router/schema/service/model` 组织。**不要为每张表建立空壳 Repository/Manager/Factory**，简单查询直接写在模块 service 中；只有空间查询或确需复用的复杂查询才拆出 `queries.py`。

## 3. 架构边界

- **分层职责**：Router 只做 HTTP 参数、依赖、调用 service、返回信封；Service 承载业务规则、授权、SQL 与事务；Schema 只做校验；Model 只做映射。路由中**禁止**实现距离算法或多步骤事务。
- **同步执行**：服务层一律是同步的普通函数（不是 class）。常规路由用 `def`，由 FastAPI 线程池执行。**禁止在 `async def` 中直接跑同步 DB 或重计算**；上传入口若要 async，必须用 `run_in_threadpool` 卸载阻塞工作。
- **提交边界**：路由在 service 调用后 `db.commit()`；service 内部用 `db.flush()`。唯一例外是 AI 报告模块（它把 DB 写入与外部 HTTP 调用交错，自己在内部提交）。
- **会话**：每个请求一个 Session，通过 `get_session` 依赖提供，不存在全局 Session。不要新增 per-request commit 中间件。
- **时间**：统一使用 `request.app.state.clock()`，不要在业务代码里直接调用 `datetime.now()`。
- **权威数据在服务端**：前端不得成为唯一校验入口。地图（MapLibre）与图表（ECharts）只做呈现，**不生成权威运动指标**；距离、用时、配速以服务端聚合为准。前端 `lib/api/*` 是接口契约的消费者，不是业务逻辑的复制品。

## 4. 后端编码规范

### 响应、错误与输入

- 响应信封固定为 `{data, error, meta.request_id}`。`envelope()` 定义在 `activities/router.py` 与 `auth/router.py`，其余模块**导入复用**，不要重新定义。
- 错误统一 `raise ApiError(status_code, "CODE", "中文用户提示")`；可选 `retry_after=`（写入 `Retry-After` 头）与 `details=`。`details` 的键由 `app/core/errors.py` 中 `ApiError.__init__` 的 `allowed` 集合过滤（值须为 ≤200 字符的字符串），**新增键必须同步加入该集合**，否则会被静默丢弃。
- 错误码为大写蛇形领域码；`message` 是给用户看的中文，日志与标识符用英文。不向客户端暴露 SQL、堆栈、文件路径或供应商原文。
- 所有请求体继承 `StrictInput`（`extra="forbid"`, `strict=True`，定义于 `app/modules/users/schema.py`），未知字段必须被拒绝。
- 列表响应统一 `{items, total, limit, offset}`，查询参数是 **`limit`/`offset`**（不是 `page`/`page_size`；`docs/04-rest-api.md` 的该处说法已过时）。通用取值：`limit` 默认 20、上限 100，`offset` 默认 0、上限 1000000；`ai_reports` 列表为例外（默认 10、上限 50）。年份类查询统一 `ge=1900, le=2100`。
- PATCH 语义：字段全部可选，用 `model_dump(exclude_unset=True)` 应用，**不要用 `exclude_none`**，并校验至少提交一个字段。

### 模型与注册

- UUID 主键用 `default=uuid4`；每张用户数据表都有 `user_id = ForeignKey("users.id", ondelete="CASCADE")`；时间列一律 `DateTime(timezone=True)` + `server_default=func.now()`；枚举用 `String(n)` + 具名 `CheckConstraint`；几何用 GeoAlchemy2 WKT。**项目不使用 `relationship()`**，关联在查询中显式 join。
- 新增模型必须注册到 `app/models/__init__.py`，否则元数据不完整；**新增模块的 router 必须 `include_router` 注册到 `app/main.py`，否则路由静默不存在。** 模块 `__init__.py` 保持空文件，不做自动注册。
- 模块 router 沿用既有外形：多数为 `APIRouter(prefix="/api/v1/<name>", tags=["<name>"])`（`sharing` 因路径跨资源使用 `prefix="/api/v1"`），每个端点声明 `response_model=ApiResponse[X]`。

### 归属、并发与写入

- 归属校验在 service 层用 `owner` 过滤完成。按 ID 取本人资源时走 `owned_*` helper，**不存在与他人资源统一返回 404，绝不返回 403**，以免泄露存在性。
- 服务写操作前调用 `lock_owner(db, owner)` 锁定本人 users 行并递增 `activity_data_version`（用于把旧 AI 报告标记为过时）。
- **修改导入（GPX/TCX/小米运动健康）逻辑前先读现有并发控制**：每用户同时仅一个导入，用 `pg_try_advisory_lock` 在专用自动提交连接上取得，冲突返回 429 `IMPORT_BUSY`（`gpx/service.py`）。不要新增另一套导入互斥机制。
- 头像与站点图标/Logo 上传（`/api/v1/me/avatar`、`/api/v1/site/images/*`，`site_settings/images.py`）统一解码、方向校正、方形裁剪并重新编码为无元数据 PNG（单图上限 5 MiB），`ImageBodyLimit` 中间件在 multipart 解析前按 6 MiB 拦截请求体。新增图片上传入口必须复用 `normalize_image` 并把路径加入 `body_limit.PATHS`。
- 公开数据的接口规则见第 8 节。

## 5. 前端编码规范

### 框架与数据加载

- SvelteKit 3 的配置在 `vite.config.ts`（**没有 `svelte.config.js`**）。内部导入用 Node 子路径别名 `#lib/...` 且**带 `.ts` 扩展名**（如 `#lib/api/activities.ts`）；不要使用旧版 `$lib`。类型从 `$app/tsconfig` 继承。
- 服务端环境变量在 `src/env.ts` 用 `defineEnvVars` 声明，从 `$app/env/private` 导入；hooks 类型从 `@sveltejs/kit/hooks` 导入。**新增变量必须在 `defineEnvVars` 中声明**，前端可见的才设 `public: true`。Vite 配置了 `env: { dir: '..' }`，因此 `.env` 位于仓库根目录。
- 组件使用 Svelte 5 runes（`$props`/`$state`/`$derived`/`$effect`），props 用单次 `$props()` 解构并内联类型，回调命名 `onselect`/`onedit`/`ondelete`。**项目不使用 `createEventDispatcher`，也不使用 svelte store**。
- 页面数据在客户端 `onMount` 中通过 `lib/api` 加载；服务端 `load` 只提供 `locals.user`。读取路由信息用 `$app/state`，**不要用 `$app/stores`**。
- 组件里必须保留 `disposed` 清理标志（`onMount` 返回时置位，await 后赋值前检查）与单调请求令牌（丢弃过期响应）；遇到 401 一律清除私人状态并跳转登录。

### 接口层

- `lib/api/*` 必须做**运行时响应校验**（逐字段检查类型与范围），失败抛领域错误类（如 `ActivityError`），不要直接信任后端返回的结构。401 统一映射为"登录已过期"。
- 写操作必须先取 `/api/v1/auth/csrf`，再带 `X-CSRF-Token` 发送。
- 公共数据走**白名单重建**（如 `parsePublicActivity`），不要把后端响应整体展开。

### 地图、图表与主题

- **SSR 安全**：`maplibre-gl` 与 `echarts` 只能在 `onMount` 内 `await import(...)` 动态加载，禁止模块顶层导入或访问 `window`/`document`，否则 adapter-node 构建会失败。
- 外观默认跟随系统，支持手动明暗切换和恢复自动；偏好仅存本机 `runnote-theme`，由 `app.html` 在首屏解析为根元素 `data-theme`，`system-theme.ts` 负责后续同步。canvas/WebGL 绘制（地图、图表、海报）必须调用 `watchSystemTheme` 订阅实际外观（包含手动切换），并在卸载时取消订阅。
- 地图以本地数据优先：底图失败、超时或关闭都不得阻断轨迹渲染，应降级为本地背景。**不调用 `map.setStyle`，不重建 Map 实例**：本地层的主题切换只改 paint 属性（`lib/api/map-style.ts`）；外部底图的加载、切换、取消与降级统一交给 `lib/map/basemap-controller.ts`，只增删按代号命名空间化的 provider 层/源，插入在本地业务层之下。底图偏好存本机 `runnote-basemap`。新增地图组件复用该控制器与 `BasemapPicker`，不要另写一套。
- 可访问性沿用既有模式：容器加 `role="img"`/`role="region"` 与中文 `aria-label`，用 `data-testid` 暴露就绪/加载状态（如 `route-map-ready`），图表下方提供 `<details>` 完整数据表兜底，缺失值渲染 `—` 并附 `sr-only` 说明。

### UI 设计系统（强制流程）

- 开始 UI 工作先读 [Design System](docs/design-system/README.md)，再查 [组件](docs/design-system/components.md)、[Patterns](docs/design-system/patterns.md) 和 [Tokens](docs/design-system/tokens.md)。先定位可复用实现与相似页面，再新增能力。
- 样式基于 `src/app.css` 中的 CSS 自定义属性，通过 `@theme inline` 映射为 Tailwind 令牌（如 `bg-surface`、`text-muted-foreground`）。**颜色与稳定间距使用语义令牌，新增时扩展令牌，不要在组件里硬编码色值。** 通用组件类（`.button-secondary`、`.page-header` 等）放在 `app.css` 的 `@layer components`。
- 液态玻璃、弹层与按压动效复用 `lib/styles/` 下的既有实现（如 `createGlass`、`rn-glass-menu`、`popover-motion.ts`），不要重新实现一套材质或动画。
- 延续现有品牌、主题、材质和响应式；未经允许不得全局换肤或批量重写，避免重复样式与无目的的视觉创新。
- 新增通用组件时同步更新规范文档和独立 showcase；没有实际重复需求不创建空壳组件。`pnpm showcase` 是独立开发入口，**不得加入生产路由或导航**。
- 验证主题、响应式、交互/加载/空/错误状态、键盘与可见焦点；按 [验收记录](docs/50-ui-design-system.md) 区分合成 UI、视觉回归与真实业务验收。

## 6. 数据库、迁移与配置

- 迁移**手写**，不依赖 autogenerate。文件名与 `revision` 同为 `NNNN_snake_case`（四位序号 + 变更描述，序号连续递增），维护一条线性 `down_revision` 链；新增前先 `ls backend/migrations/versions/` 确认下一个序号。
- 升级必须实现，**降级要防御性**：存在真实数据时 `raise RuntimeError` 而不是破坏数据。
- 新增迁移后，`/api/v1/health/ready` 与 `/api/health` 会因 revision 不匹配返回 503，直到目标库执行 `alembic upgrade head`。启动时期望值由 `get_expected_revision()` 读取，要求 head 唯一。
- **不要引用文档里写死的 revision 号。** 迁移 head 用 `alembic heads` 动态查询，目标库当前版本用 `alembic current`。`README.md` 与设计文档中的 head 描述已多次滞后于代码。
- 配置集中在 `app/core/config.py`（`Settings`），环境文件是**仓库根目录的 `.env`**（前后端共用）。字段小写蛇形，环境变量为大写蛇形。`extra="ignore"`、`hide_input_in_errors=True` 必须保留。密钥用 `SecretStr`。
- `AUTH_RATE_HASH_KEY` 至少 32 字节，由 `scripts/local-auth.py` 管理，写入 Git 忽略的 `.env.auth-rate.key`（权限 600）。**不要输出、轮换或把它放进前端**。
- 开发库与测试库严格分离，迁移与集成测试只允许作用于独立的 `_test` 库（规则见第 9 节"数据库保护"）。

## 7. 常用命令

后端（工作目录 `backend/`，使用仓库内虚拟环境）：

```bash
.venv/bin/pytest tests/unit -q                 # 单元测试，无需数据库
.venv/bin/pytest -q                            # 全量；未配置测试库时集成用例会跳过
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
.venv/bin/alembic heads                        # 只读；查询迁移 head
.venv/bin/alembic current                      # 只读；核对数据库 revision
```

前端（工作目录 `frontend/`）：

```bash
pnpm test                                      # Vitest 单元测试
pnpm check                                     # svelte-kit sync + svelte-check 类型检查
pnpm build                                     # 生产构建（adapter-node）
pnpm showcase                                  # 设计系统独立 showcase（不进生产）
pnpm exec playwright test --config <file>      # 运行指定 Playwright 配置
pnpm test:e2e                                  # 默认 e2e，需后端已启动且测试库 ready
```

部署资产自检（仓库根目录；全部在隔离环境，不连生产）：

```bash
backend/.venv/bin/python -m unittest discover -s infra/native/tests   # 运维脚本单元测试
shellcheck -x --source-path=SCRIPTDIR infra/native/ops/*.sh infra/native/tests/*.sh
infra/native/tests/ops-e2e.sh <release.tar.gz>                      # 需 PG_BIN、PYTHON；临时集群里演练部署/迁移/回滚/恢复
infra/native/ops/ship.py [--dry-run] [--migrate]                          # 在你的电脑上一键发布已合并的 main（CI 全绿、迁移需显式 --migrate、先备份；配置在仓库之外，见 docs/66）
infra/native/ops/acceptance-check.py --base https://… --backend-env …          # 站主登录 + 合成 GPX 的上线验收（已有真实数据的站点上也安全；见 docs/66）
infra/native/ops/verify-release.sh <release.tar.gz>                       # 发布包自包含检查（build-release.sh 每次构建都会运行）
infra/native/tests/ops-e2e-instances.sh <release.tar.gz>             # 旧布局与第二实例并行：隔离、各自备份/回滚、站点模式（见 docs/66“同机多实例”）
infra/native/tests/offsite-e2e.sh                                   # 需 PG_BIN 与 restic；本地 restic 仓库演练异地备份的设置、上传、取回验证与损坏检测
infra/native/tests/caddy-instances.sh                                # 需 caddy；沙箱里的真实 Caddy 进程，验证 staging Basic Auth / production 维护页与上线
```

本地后端生命周期（仓库根目录，仅管理本仓库后端，默认端口 8001）：`./backend.command start|stop|restart|status|logs`。

**Shell 脚本写法（`infra/native/`）**：不要写 `A && B || C`（如 `[ -f x ] && [ -n y ] || die "…"`），一律用 `if …; then …; fi`。CI 上的 ShellCheck 版本比开发机旧，会对这种写法报 SC2015，而本机的 ShellCheck 放过它，结果只有推送后才发现。`tests/test_shell_style.py` 在本机就会拦住这个写法；推送前仍需跑上面的 `shellcheck` 命令与 `unittest`。macOS 自带 bash 3.2：不要用 `mapfile`，也没有 `timeout`。

`pnpm build` 会输出既有的大体积 chunk 警告，属已知状态，不是本次改动引入的失败。

## 8. 站主展示、受管账号与公开数据边界

### 账号与入口

- 唯一站主由后端 `SITE_OWNER_EMAIL` 指定（默认值见 `backend/app/core/config.py`；生产必须显式设置），账号缺失时展示接口返回 503，不回退到任意用户。唯一管理员由配置邮箱计算，不依赖可编辑角色字段。
- 匿名展示页面为 `/dashboard`、`/activities`（含详情和 wall）、`/footprints`、`/ai`；只在 `/admin` 提供管理员登录，旧 `/login` 与 `/register` 返回 404，注册 API 禁用。写操作仍由认证依赖与 CSRF/Origin 双重保护。
- 用户管理页 `/admin/users` 在导航中归属"设置"（与 `/settings`、`/settings/site` 同组，使用 `settings-header.svelte.ts` 共享头部），仅站主可管理账号；普通启用用户在 `/workspace/*` 管理本人，公开 `/p/{username}/*` 始终只读。历史普通账号默认停用且不公开，显式启用后可登录本人工作区。
- 禁用账号会撤销会话并关闭展示，重新启用不恢复旧状态；修改邮箱或重置密码撤销全部会话。站主的邮箱/启用/展示状态受保护。
- 空库初始化用离线 `scripts/site-owner.py`，不可重开注册或自动重置密码。
- 匿名 AI 仅查看已成功的报告，不调用管理 context、recover、cleanup 或供应商。
- 背景文档：部署模板见 `docs/55-single-owner-showcase.md`，权限/迁移/个人展示边界见 `docs/56-admin-users-personal-showcase.md`。

### 公开接口规则

- 公开接口使用**独立的字段白名单序列化**，不复用本人视图；必须在 SQL 中约束 subject ID，**不能接受客户端传入的 owner ID**。
- **完整展示**（允许全部记录含 private/unlisted、完整轨迹与精确起终点）只存在于：
  - 根 `/api/v1/showcase/*`：固定查询 `SITE_OWNER_EMAIL` 对应的站主；
  - 具名 `/api/v1/showcase/users/{username}/*`：仅限站主，或同时满足 `is_active AND showcase_enabled` 的用户。
- **旧版摘要分享**必须在 SQL 中强制 `visibility == "public"`，且不公开坐标。

### 私人数据边界

- 邮箱、账户用户名字段、备注、文件名、原始 GPX/TCX **不得**出现在公开响应、分享响应、外部地图 URL 或 AI 供应商请求中（具名展示 URL 中的 username 是公开标识，属例外）。
- 坐标与精确起终点不得扩展到旧版摘要分享、外部地图 URL 或 AI 请求。
- 底图只向 OpenFreeMap 请求公开样式、字体、sprite 与当前视口瓦片；轨迹 GeoJSON 始终留在浏览器内，不进入任何第三方请求。

## 9. 测试与验证

### 测试分层

前端三层测试用途不同，不要混用：

- `frontend/tests/unit` — Vitest，纯逻辑，`environment: 'node'`。
- `frontend/tests/ui` — 由 `playwright.ui.config.ts` 驱动：`node tests/fixtures/ui-api.mjs` 起**合成 API**（8191）+ vite dev（5191）+ 真实 Chrome。**不连真实后端、不碰数据库。**
- `frontend/tests/e2e` — `playwright.config.ts`，需要**真实后端与 ready 的独立测试数据库**。历史多用户用例仍依赖注册，当前模式运行前需改为离线预置站主与受管合成账号，不得重开注册。

后端：`backend/tests/unit` 不访问数据库；`backend/tests/integration` 需要独立 PostGIS 测试库。

### Playwright 特性配置

`frontend/` 下有多份 `playwright.*.config.ts`（完整清单以 `ls frontend/playwright.*.ts` 为准），均无对应 npm script，用 `pnpm exec playwright test --config <file>` 显式运行：

- 多数（如 `activity-*`、`tcx`、`basemaps`、`route-poster`、`site-settings`、`dashboard-explorer`、`popover-motion`、`ai-*`）继承 `playwright.ui.config.ts`，仅收窄 `testMatch`，走合成 API。
- `*-e2e.config.ts` 需要真实后端与测试库，适用下方数据库保护规则。
- `*-build.config.ts`（如 `showcase-build`、`admin-users-build`）是合成构建验收。
- `design-system.config.ts` 独立启动 showcase（5193）做像素级截图对比。
- `basemaps-live.config.ts` 会访问**真实底图供应商网络**，仅在需要验证外部服务时运行，不作为常规回归。

前端 UI 测试依赖合成 API：**新增后端接口若被 UI 使用，必须同时在 `frontend/tests/fixtures/ui-api.mjs` 或该 spec 的 `page.route()` 拦截中补齐**，否则整套 UI 用例会 404。

### 数据库保护

后端集成测试与 `playwright.*-e2e.config.ts` 适用同一规则：

- 只允许名字以 `_test` 结尾、且显式列入 `TEST_DATABASE_ALLOWED_TARGETS` 的库；`backend/tests/conftest.py` 会以只读连接核对实际库名与端口，不匹配直接拒绝。
- 优先复用既有测试库；确需新建时按 `README.md` 的步骤创建，库名必须以 `_test` 结尾并加入允许目标，绝不能改用开发库。
- **只在进程环境注入测试变量，不要修改 `.env`**。既有做法见 `docs/09-phase-two-progress.md` 的"运行测试"小节（在 `backend/` 下就地构造 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS` 后以子进程调用 `pytest`）。
- 未配置这些变量时集成用例会跳过，**跳过不等于通过**。

### 验证纪律

- 测试必须**真实执行**。无法执行时明确说明原因，**禁止声称测试通过**。
- **测试通过数量随开发变化，不要引用历史计数或据其判断当前状态**；每次改动后重新执行相关测试，并报告本次实际结果与命令输出。
- 先运行与改动相关的最小测试集作为快速反馈，交付前再补充回归范围；报告时分开说明"实际运行"与"未运行"。
- 前端改动需通过 `pnpm check`；后端改动需通过 Ruff 检查与格式检查。

## 10. 修改代码的工作流程

1. **先定位再改**：改动前先读相关 router/service/schema 与其调用方，确认既有约定，不要凭猜测新增模式。
2. **复用优先**：已存在的 `envelope`、`StrictInput`、`lock_owner`、`owned_*`、`lib/api` 工具、底图控制器与设计系统组件是既定模式。
3. **最小必要改动**：不做与任务无关的重构、不顺手"优化"周边代码。
4. **不要擅自变更**公共接口、响应结构、数据库 Schema 或既有业务行为。确有必要时先说明影响范围并取得确认。
5. **保护未提交修改**：工作区可能长期存在大量未提交改动，这是有意保留的状态。改动前先确认目标文件是否已有未提交修改，不要删除、覆盖或顺手清理。
6. **较大功能的文档流程**：
   - 设计：`docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`
   - 实施计划：`docs/superpowers/plans/YYYY-MM-DD-<slug>.md`
   - 完成后追加编号特性文档 `docs/NN-<slug>.md`：编号取 `docs/` 下已用最大编号 +1，用 `ls docs/` 现场确认，不要沿用文档里写死的编号。
   - 文档使用中文，需包含"使用方式 / 接口与隐私 / 验证记录"并给出真实证据。

## 11. 安全与禁止操作

- **不执行** `git commit` / `push` / `merge` / `rebase` / 建 tag，也不部署或操作生产环境，除非用户显式授权。获授权提交时显式选择文件，不要使用 `git add -A`；排除密钥、数据库归档、合成账号密码与临时浏览器证据。
- **不在开发库执行迁移**。开发库升级必须先获得用户明确授权，并遵循"备份 → 恢复演练 → 受控单次升级 → 复核"的顺序；降级不是默认回滚手段。
- 绝不清理、改写或删除开发库中的数据；任何测试写入都不得落在开发库。
- 绝不读取、输出或提交 `.env`、`.env.auth-rate.key` 等密钥文件内容，不把密钥写入代码、命令行参数、日志或文档。
- 不把真实 GPX/TCX 原文、坐标、轨迹或真实用户数据写入仓库、测试夹具或数据库；使用合成样本。
- **SSR 代理是安全边界**（`src/lib/server/backend.ts`）：目标源固定为 `INTERNAL_API_BASE_URL`，转发路径必须同源且以 `/api/` 开头，请求头只放行固定的 7 个（`cookie`、`origin`、`referer`、`x-csrf-token`、`content-type`、`accept`、`idempotency-key`）。**不要扩大该白名单，不要接受客户端传入的绝对地址，不要伪造 `Origin` 或信任 `X-Forwarded-*`。** 上传请求体上限 11 MiB，由 `Content-Length` 与流式计数双重校验；后端对图片上传另有 6 MiB 请求体限制（见第 4 节），代理上限不得作为放宽后端限制的理由。
- AI 供应商密钥只在服务端进程环境，不要放进 `PUBLIC_*` 或前端。默认无配置时功能应显示不可用，不要提供 Mock 开关绕过。
- 公开数据与私人数据边界见第 8 节。

## 12. 完成任务后的交付说明

报告需包含：

1. **改动范围**：具体文件与各自意图，区分后端/前端/文档/测试。
2. **验证结果**：实际执行的命令及其真实输出（通过/失败/跳过数量），明确列出**未运行**的检查。
3. **未确认事项与剩余风险**：例如"开发服务未重启，新接口未在运行实例上验证""真实 AI 供应商未配置"。
4. **未受影响的部分**：说明保留的既有行为、未改动的接口与数据。

不要夸大完成度：隔离测试库或合成 API 的通过，不等价于开发服务已加载新代码，也不等价于生产验收。

## 13. 关于局部 AGENTS.md

当前仅在仓库根目录维护本文件，没有子目录级 `AGENTS.md`。只有在某个子模块形成稳定且与根目录规则明显不同的约定时，才考虑新增局部文件，且需先说明必要性。**不要批量创建。**
