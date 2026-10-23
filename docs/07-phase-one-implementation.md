# 第一阶段实施与验证记录

验证日期：2026-10-12。范围仅为基础设施，不包含阶段二及以后业务。

## 1. 状态

项目骨架、依赖锁、健康检查、占位页面、迁移、测试与运行文档已交付。在独立的真实 PostgreSQL/PostGIS 实例上，迁移、空间函数、浏览器前后端通信和故障检查通过。

**最新本地环境验收通过**：本机 Homebrew PostgreSQL 18.6 已加载 PostGIS 3.6.4，现有 `.env` 对应的 `running_note` 已处于迁移 head，真实健康接口和浏览器联调通过。2026-10-12 按用户决定统一改为非容器化；容器启动和卷测试已从验收删除。仍需全新原生环境复现证据，原生数据持久性与迁移/测试标准保留。实际复验见第 8 节，方案调整见第 9 节。

第一阶段初次实施时保留原设计文档；本次非容器化调整更新了 README、需求/架构/路线及风险文档。没有实现认证、GPX、地图、日历统计、分享或 AI，没有创建业务表，没有 Git commit。

## 2. 实际架构与版本

前端浏览器 → 同源 `/api/health` → Vite 开发代理 → FastAPI Router → Health Service → SQLAlchemy Session → PostgreSQL/PostGIS。

业务指标与权限仍按设计留在后端，当前没有业务计算。后端模块内采用 Router/Service/Schema，公共配置与错误在 core，会话在 db，Model 层仅预留 Base。同步数据库服务使用同步路由，Session 每请求关闭，应用退出销毁连接池。

| 项目 | 锁定版本 |
| --- | --- |
| SvelteKit / Svelte | 3.0.1 / 5.57.2 |
| Vite / Svelte Vite 插件 / Node adapter | 8.3.4 / 7.3.1 / 6.0.0 |
| TypeScript / svelte-check | 6.0.3 / 4.7.6 |
| Tailwind / Tailwind Vite | 4.3.3 / 4.3.3 |
| pnpm / Vitest / Playwright | 11.25.0 / 5.0.3 / 1.64.0 |
| Python 验证运行时 | 3.12.15 |
| FastAPI / Uvicorn | 0.143.0 / 0.54.0 |
| Pydantic / pydantic-settings | 2.14.1 / 2.15.0 |
| SQLAlchemy / Alembic / psycopg | 2.1.4 / 1.20.0 / 3.3.6 |
| pytest / Ruff / httpx2 | 9.1.1 / 0.17.0 / 2.13.1 |
| 独立数据库验证 | PostgreSQL 18.6 / PostGIS 3.6.4 |
| 本地数据库管理 | Homebrew 原生服务，应用独立进程 |

Python 直接依赖精确固定，传递依赖在带 hash 的 requirements.lock 中固定；前端使用 pnpm-lock.yaml。实测 pnpm 工具调用的 Node 为 24.19.0，系统 Node 为 22.23.3；Node 22 的完整构建尚未在本次独立执行。

推荐使用当前锁定的兼容组合，不混用旧版配置。SvelteKit 3 已移除旧配置文件，故配置集中在 Vite 插件、TS 继承 `$app/tsconfig`、包 imports 使用 `#lib/*`。TypeScript 6 满足 Kit/check 的兼容范围；没有无理由引入其他框架。shadcn-svelte 本阶段只预留 components.json 和 UI 目录，不声称已安装或验证组件生成器。

## 3. 已实现 API 与迁移

| 接口 | 行为 |
| --- | --- |
| GET /api/v1/health/live | 200，仅检查 API 进程 |
| GET /api/v1/health/ready | DB SELECT 1、PostGIS 和 revision 均正常才 200，否则 503 |
| GET /api/health | ready 的兼容入口，前端实际请求 |

响应统一为 data/error/meta.request_id；404、参数错误、依赖错误、500 均脱敏。不回传数据库连接串或请求中的敏感原文。生成的 OpenAPI 快照见 openapi-phase-one.json。

初始迁移为 `0001_postgis`，只执行 `CREATE EXTENSION IF NOT EXISTS postgis`。downgrade 保留扩展，以免删除迁移前已存在的共享空间能力。API 查询超时 3 秒；迁移单独取消 statement_timeout，避免首次安装扩展被 API 的短超时中断。

## 4. 初次实施的实际执行与结果（历史）

所有单元、类型检查和构建均实际执行，数据库测试未用 SQLite 替代。

| 工作目录 / 命令 | 结果 |
| --- | --- |
| backend：`.venv/bin/pytest tests/unit -q` | 8 passed |
| backend：`TEST_DATABASE_URL=<独立测试库URL> .venv/bin/pytest -q` | 最终 11 passed（8 单元 + 3 集成），新空库通过 |
| backend：`.venv/bin/ruff check app migrations tests` | passed |
| backend：`.venv/bin/ruff format --check app migrations tests` | 23 files already formatted |
| backend：`DATABASE_URL=<独立测试库URL> .venv/bin/alembic upgrade head` | passed，重复执行无新迁移 |
| backend：`DATABASE_URL=<独立测试库URL> .venv/bin/alembic current` | 0001_postgis (head) |
| frontend：`pnpm install --frozen-lockfile` | 依赖安装通过，当前依赖配置可用于后续复现 |
| frontend：`pnpm test` | 5 passed |
| frontend：`pnpm check` | 0 errors / 0 warnings |
| frontend：`pnpm build` | passed，Node adapter 产物生成 |
| frontend：`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` | 2 passed，真实同源 API 请求与导航；Mock 503 页面状态 |
| root：`/private/tmp/run-note-compose/docker-compose --env-file .env -f infra/compose.dev.yml config --quiet` | 历史结果 exit 0；容器方案已停用，不再作为验收项 |
| root：`git check-ignore .env .cache/pnpm-store .pnpm-store backend/.venv frontend/node_modules frontend/build` | 均被忽略 |

首次测试暴露临时 PostGIS SQL 的动态库路径及扩展冷加载超时问题，修复临时库路径并取消迁移超时后，用另一个新空库重新执行全部后端测试通过。没有放宽 API 查询超时或跳过空间检查。

真实空间函数测试：WGS84 geography 两点 (0,0) 与 (0.01,0) 距离约 1113.194908 米，误差阈值 0.001 米。

独立集群使用 127.0.0.1:55432，数据位于 /private/tmp/run-note-verification-pg；PostGIS 使用临时便携库，仅用于验证，不作为项目依赖安装方式。测试库 run_note_test 和 run_note_cold_test 与用户库隔离。重启该集群后 verification_marker、PostGIS 和 Alembic revision 均保留；这验证原生 PostgreSQL 数据持久性，符合调整后对独立受控实例正常停止/启动的测试类型；后续仍需记录全新 Homebrew 环境的复现证据。

真实故障检查：停止独立数据库后，运行中的 Uvicorn `/api/health` 返回 503，live 返回 200，响应没有 DSN 或密码。随后停止本任务创建的 Uvicorn 和数据库，Playwright 自动创建的前端已退出。没有停止用户 PostgreSQL 服务。

构建与 E2E 有 NO_COLOR/FORCE_COLOR 环境冲突提示，类型检查无警告。E2E 产生一次 favicon.ico 404，不影响健康检查和页面导航。

## 5. 用户 .env 的连接检查历史

上一轮检查时，127.0.0.1:5432/running_note 尚未安装 PostGIS、尚无迁移，ready 为 503。**这不是最新状态**：本轮开始前 Homebrew 包、数据库扩展和迁移记录已存在。本轮只执行了非破坏性的 `upgrade head`（无新迁移），并实测 ready 为 200，详见第 8 节。

两轮均没有覆盖 `.env`；本轮对 `running_note` 没有业务表写入、删除或重建。当前应用角色为非超级用户，扩展已经安装，重复迁移无需提高应用角色权限。

## 6. 文件清单

相对已有设计文件，修改：`README.md`。原六份设计文档未修改。以下为新增源文件（不包括 .git、用户 .env、依赖、缓存、临时下载与生成构建）：

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `backend/alembic.ini`
- `backend/app/__init__.py`
- `backend/app/api/__init__.py`
- `backend/app/api/dependencies.py`
- `backend/app/core/__init__.py`
- `backend/app/core/config.py`
- `backend/app/core/errors.py`
- `backend/app/core/logging.py`
- `backend/app/core/responses.py`
- `backend/app/db/__init__.py`
- `backend/app/db/base.py`
- `backend/app/db/session.py`
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `backend/app/modules/__init__.py`
- `backend/app/modules/health/__init__.py`
- `backend/app/modules/health/router.py`
- `backend/app/modules/health/schema.py`
- `backend/app/modules/health/service.py`
- `backend/migrations/env.py`
- `backend/migrations/script.py.mako`
- `backend/migrations/versions/0001_enable_postgis.py`
- `backend/pyproject.toml`
- `backend/requirements.lock`
- `backend/tests/integration/test_database.py`
- `backend/tests/unit/test_config.py`
- `backend/tests/unit/test_health.py`
- `docs/openapi-phase-one.json`
- `frontend/components.json`
- `frontend/package.json`
- `frontend/playwright.config.ts`
- `frontend/pnpm-lock.yaml`
- `frontend/pnpm-workspace.yaml`
- `frontend/src/app.css`
- `frontend/src/app.d.ts`
- `frontend/src/app.html`
- `frontend/src/lib/api/health.ts`
- `frontend/src/lib/components/ui/README.md`
- `frontend/src/routes/+layout.svelte`
- `frontend/src/routes/+page.svelte`
- `frontend/src/routes/activities/+page.svelte`
- `frontend/src/routes/dashboard/+page.svelte`
- `frontend/src/routes/settings/+page.svelte`
- `frontend/tests/e2e/skeleton.spec.ts`
- `frontend/tests/unit/health.test.ts`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/vitest.config.ts`
- `infra/compose.dev.yml`
- `docs/07-phase-one-implementation.md`

## 7. 尚未验证事项与总体结论

- 全新 macOS 环境按更新后的 README 完整安装与启动：未验证。本机已经通过真实本地数据库与应用验收，独立原生实例的持久性有第 4 节历史证据，不能把已有环境通过当作全新环境复现。
- GitHub CI：已移除服务容器，改为 macOS runner 的 Homebrew 独立临时 PostgreSQL/PostGIS 集群；远端未执行。
- Node 22 完整流水线、shadcn 组件生成器：未单独验证；本阶段只要求 shadcn 预留结构。
- Linux + systemd + Caddy、HTTPS、生产备份恢复与应用回滚：计划阶段，属于阶段八。

Docker/Compose 安装、启动、镜像或容器卷测试不再是项目任务、阻塞或验收标准。已有 infra/compose.dev.yml 保留但停用。

**结论**：当前本地非容器化环境的 PostGIS、迁移、前后端通信、健康接口、自动化测试、类型检查和构建已通过。独立原生实例的数据重启持久性有历史证据；全新环境复现仍未验证，因此不把阶段一所有条件全部标为通过。没有开始第二阶段。

## 8. 2026-10-12 本地 Homebrew 环境复验

### 安全核对与兼容性

- `brew list --versions postgresql@18 postgis`：postgresql@18 18.6_1、postgis 3.6.4。本轮开始前已经安装，没有执行 brew install/upgrade/link，也没有切换 PostgreSQL 主版本。
- `pg_config --version`：PostgreSQL 18.6；sharedir 为 `/opt/homebrew/share/postgresql@18`，pkglibdir 为 `/opt/homebrew/lib/postgresql@18`。
- `postgis.control` 位于对应 PG18 的 extension 目录，default_version 为 3.6.4；动态库为 `postgis-3.dylib`（macOS，不是 Linux 的 .so）。符号链接指向 Homebrew Cellar 中的 PG18 构建。
- `otool -L` 核对 GEOS、PROJ、JSON-C 等依赖；最终以数据库 `PostGIS_Full_Version()` 成功和空间函数结果作为加载验收证据。返回 POSTGIS 3.6.4、PGSQL 180、GEOS 3.15.0、PROJ 9.9.0。PROJ 编译版本 9.8.1、运行版本 9.9.0，实际 geography 测距测试通过。
- `brew services list` 与监听查询确认本机 PostgreSQL 18 服务在 5432；只操作这一实例。应用角色无权读取 data_directory，记录该只读权限限制，没有授予额外权限或修改服务器配置。
- Settings 从现有 `.env` 解析目标为 127.0.0.1:5432/running_note，角色 run_note；不打印密码/完整 DSN。数据库 owner 为 run_note，角色不是超级用户。
- 迁移前核对 `0001_enable_postgis.py`、`migrations/env.py`：upgrade 仅 `CREATE EXTENSION IF NOT EXISTS postgis`，无 DROP/TRUNCATE/DELETE、无业务表创建或覆盖；Alembic 在线迁移读取同一 Settings。迁移前已存在 postgis 3.6.4 和 revision 0001_postgis。
- 迁移前后 public 表集合一致：alembic_version、spatial_ref_sys。没有已有业务表。扩展提供 geometry_columns/geography_columns 视图；spatial_ref_sys 为 8500 行，revision 唯一行是 0001_postgis。
- `.env` 前后 SHA256 相同。没有删除/重建任何已有数据库或数据目录，没有重启或停止用户 PostgreSQL，没有修改其他实例。

### 实际命令与结果

| 工作目录 / 命令或查询 | 本轮结果 |
| --- | --- |
| backend：`.venv/bin/alembic upgrade head` | exit 0，已在 head，无新增迁移 |
| backend：`.venv/bin/alembic current` | 0001_postgis (head) |
| running_note：`SELECT PostGIS_Full_Version()` | 扩展可加载，PostGIS 3.6.4 / PGSQL 180 |
| running_note：固定 geography 两点测距 | 1113.19490793 米，符合 0.001 米误差阈值 |
| backend：`.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000` | 使用现有 `.env` 成功启动 |
| GET /api/health、/api/v1/health/ready | 实际 HTTP 200；database=connected、postgis=enabled、schema=current |
| GET /api/v1/health/live | 实际 HTTP 200；status=ok |
| backend：通过 Python 子进程临时设置 TEST_DATABASE_URL 后运行 `.venv/bin/pytest -q` | 11 passed（8 单元、3 真实集成），无跳过 |
| backend：`.venv/bin/ruff check app migrations tests` | All checks passed |
| backend：`.venv/bin/ruff format --check app migrations tests` | 23 files already formatted |
| frontend：`pnpm test` | 5 passed |
| frontend：`pnpm check` | 0 errors / 0 warnings |
| frontend：`pnpm build` | exit 0，Node adapter 产物生成 |
| frontend：`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` | 2 passed，真实 running_note 后端与同源代理；模拟 503 页面状态 |

### 独立测试库与权限

`.env` 没有设置 TEST_DATABASE_URL。本轮在同一个已确认的 5432 实例创建了此前不存在的 `running_note_phase_one_test`，owner 为 run_note，保留供后续重复测试；没有使用或重建 running_note 作为测试库。

执行的非破坏性准备命令：

```bash
/opt/homebrew/opt/postgresql@18/bin/createdb -w -h 127.0.0.1 -p 5432 -U "$USER" -O run_note running_note_phase_one_test
/opt/homebrew/opt/postgresql@18/bin/psql -w -h 127.0.0.1 -p 5432 -U "$USER" -d running_note_phase_one_test -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

管理员仅在新测试库预装 PostGIS，没有提高应用账号权限；应用角色负责 Alembic 和 API 集成测试。测试连接通过现有 Settings 的 URL `.set(database='running_note_phase_one_test')` 构造，仅放入子进程环境，不写入 `.env` 或报告。

再次运行该库测试可在 backend 使用以下代码（不会打印凭据）：

```bash
.venv/bin/python - <<'PYTEST'
import os
import subprocess
from sqlalchemy.engine import make_url
from app.core.config import Settings
url = make_url(Settings().database_url).set(database='running_note_phase_one_test')
env = {**os.environ, 'TEST_DATABASE_URL': url.render_as_string(hide_password=False)}
raise SystemExit(subprocess.run(['.venv/bin/pytest', '-q'], env=env).returncode)
PYTEST
```

### 运行与范围

浏览器测试自动启动前端并在结束后退出；本轮临时启动的 Uvicorn 在验收后停止。用户原有 PostgreSQL 服务保持运行，测试库保留。构建有环境颜色变量提示，E2E 有 favicon 404，不影响上述用例；无类型诊断警告。

本地环境复验只更新实施记录，没有修改业务代码或现有 `.env`。随后按第 9 节调整文档与 CI；均没有开始第二阶段、提交或推送代码。

## 9. 2026-10-12 非容器化方案调整

### 检查到的容器相关文件与处理

| 文件 | 原用途 | 本次处理 |
| --- | --- | --- |
| infra/compose.dev.yml | 原 PostGIS 服务镜像、回环端口映射、命名数据卷与健康检查 | 文件内容完整保留，已停用；不作为当前运行入口 |
| .github/workflows/ci.yml | 后端集成测试使用 PostGIS 服务容器，前端执行 pnpm 检查 | 文件保留，后端改为 macOS/Homebrew 原生临时集群；不删除 workflow |

仓库没有实际 Dockerfile 或 compose.prod.yml，原架构树中的条目只是建议，现已移除建议。此轮不删除任何文件，不执行数据库操作或改服务配置。

### 调整后的开发、测试与部署

- 本地：macOS + Homebrew PostgreSQL 18.6 / PostGIS 3.6.4；Python backend/.venv 和 hash 锁文件；前端 pnpm。Vite 同源代理及应用分层保持一致。
- 测试：真实独立 PostgreSQL/PostGIS 测试库，禁止使用业务库或 SQLite 替代；CI 在独立 runner 初始化临时原生集群并停止自己创建的进程，不连接本机用户库。CI 中回环 trust 仅用于短时测试，生产使用受控凭据。
- 生产：Linux 原生 PostgreSQL/PostGIS；专用低权限用户、每个发布版本的虚拟环境和锁定构建产物；systemd 管理 Uvicorn/Node；Caddy 提供 HTTPS/同源入口。迁移为备份后单次受控步骤，生产配置留在阶段八实施。
- 数据：原生 PG 数据目录与代码/依赖目录分离；应用重装不触碰 PG 数据目录。Homebrew/Linux 系统包兼容性和版本差异需记录，升级主版本不能视为普通依赖重装。

### 调整后的第一阶段验收矩阵

| 必需条件 | 现有证据与状态 |
| --- | --- |
| README 可在全新原生环境复现安装、数据库准备及启动 | 已更新说明；全新环境复现待验证 |
| live 200、ready 200，依赖失败时 ready 503 且脱敏 | 第 4/8 节已验证，故障在独立实例测试 |
| 独立空库迁移、PostGIS 空间函数、重复迁移安全 | 第 4/8 节已验证 |
| 独立原生实例写入数据后正常停止/启动仍保留数据与 revision | 第 4 节已有真实测试证据，不重启日常库 |
| 浏览器同源 API 请求、页面及导航可用 | 第 8 节真实本地库浏览器测试通过 |
| .env 被忽略、不被覆盖，示例无真实密钥，必填配置校验 | 既有检查/测试通过，本轮仍保留 .env |
| 锁定依赖、单元/空间集成测试、类型检查、构建通过 | 第 8 节通过，CI 改动远端尚未执行 |

生产备份恢复、systemd 自动恢复/受控重启、HTTPS 与部署复现仍是阶段八必需验收，不能因为不使用容器而省略。所有既有测试结果保留为实际历史证据；本次文档调整不冒充再次运行功能验收。

### 修改范围

README.md、docs/01-requirements.md、docs/02-architecture.md、docs/05-development-roadmap.md、docs/06-risks-and-validation.md、docs/07-phase-one-implementation.md，另有 .github/workflows/ci.yml 移除容器执行路径、.env.example 移除仅用于 Compose 的 POSTGRES_* 配置（现有 .env 不变）。业务代码和历史 infra/compose.dev.yml 不变。

### 本次调整的静态检查

- 文档相对文件链接检查：通过。
- `.github/workflows/ci.yml` YAML 解析及多行 shell 的 `bash -n`：通过；不包含 services/image 容器启动配置。
- 修改前后 SHA256 核对：现有 `.env` 和历史 infra/compose.dev.yml 完全不变。
- 全仓相关文字复核：当前开发/部署/验收没有容器依赖；剩余容器表述为停用说明或明确标识的历史结果。
- 未重新运行应用测试或构建；本次改动为文档、示例配置和 CI，已有测试结果仍按其实际验证轮次保留，新的 CI 运行结果为未验证。


## 10. 2026-10-12 第一阶段 Git 基线检查

提交前分支为 `main`，仓库尚无提交，全部 60 个候选文件均为未跟踪文件。检查范围为第一阶段源代码、依赖锁、测试、既有设计文档及非容器化方案调整；后续阶段的内容仅为设计，不包含认证、用户业务模型、GPX 或其他第二阶段实现。历史 `infra/compose.dev.yml` 保留且停用。

### 本轮实际回归

| 检查 | 结果 |
| --- | --- |
| backend：`.venv/bin/pytest tests/unit -q` | PASS，8 passed |
| backend：`.venv/bin/ruff check app migrations tests` | PASS |
| backend：`.venv/bin/ruff format --check app migrations tests` | PASS，23 files already formatted |
| Python 已安装依赖兼容性 | PASS，使用 importlib.metadata / packaging 校验；虚拟环境没有 pip，`pip check` 不可用 |
| frontend：`pnpm test` | PASS，5 passed |
| frontend：`pnpm check` | PASS，0 errors / 0 warnings |
| frontend：`pnpm build` | PASS，Node 22.23.3，项目内 pnpm 11.25.0 |
| frontend：`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` | PASS，2 passed，真实同源健康请求、导航与模拟 503 展示 |
| live、ready、兼容健康入口 | PASS，通过 TestClient 查询现有数据库，均 200；仅执行 SELECT |
| OpenAPI 快照与当前 `create_app().openapi()` | PASS，完全一致 |
| Markdown 相对文件链接、代码围栏 | PASS，10 个文件链接存在，围栏成对 |
| CI YAML 解析、全部 10 个 run 步骤的 `bash -n` | PASS，无服务容器配置；未执行 workflow |
| 候选文件凭据扫描 | PASS，无私钥/常见 API 密钥标识；数据库凭据字面量仅为示例占位或单元测试假值；本地实际数据库密码未出现在候选文件中 |
| `.gitignore` 与提交范围 | PASS，`.env`、其他 `.env.*`、虚拟环境、依赖、缓存及构建产物均排除；仅允许 `.env.example` |

初次只读数据库连接被执行沙箱拒绝；允许访问本机端口后上述健康与浏览器检查通过，没有为此改动应用或数据库。测试产生的颜色环境提示和 favicon 404 不影响用例结果。临时 API 已退出，Playwright 启动的前端已退出，8000 / 5173 无监听。

本轮未运行会执行 Alembic 的数据库集成测试，未执行迁移、写入数据库、启停或修改 PostgreSQL 服务，未改写 `.env`。现有 `.env` 和停用 Compose 文件的 SHA256 与检查前一致。全新环境复现、数据库迁移/持久性复验和远端 CI 本轮 NOT VERIFIED；历史证据保留，不等同于重新完成全部阶段验收。

本轮通过的是本地版本基线提交检查。提交信息为 `chore: complete phase one project setup`，不推送，不开始第二阶段。提交哈希以 Git 提交结果为准，避免在提交内容中自引用。

### 基线提交文件清单（60 个）

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `backend/alembic.ini`
- `backend/app/__init__.py`
- `backend/app/api/__init__.py`
- `backend/app/api/dependencies.py`
- `backend/app/core/__init__.py`
- `backend/app/core/config.py`
- `backend/app/core/errors.py`
- `backend/app/core/logging.py`
- `backend/app/core/responses.py`
- `backend/app/db/__init__.py`
- `backend/app/db/base.py`
- `backend/app/db/session.py`
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `backend/app/modules/__init__.py`
- `backend/app/modules/health/__init__.py`
- `backend/app/modules/health/router.py`
- `backend/app/modules/health/schema.py`
- `backend/app/modules/health/service.py`
- `backend/migrations/env.py`
- `backend/migrations/script.py.mako`
- `backend/migrations/versions/0001_enable_postgis.py`
- `backend/pyproject.toml`
- `backend/requirements.lock`
- `backend/tests/integration/test_database.py`
- `backend/tests/unit/test_config.py`
- `backend/tests/unit/test_health.py`
- `docs/01-requirements.md`
- `docs/02-architecture.md`
- `docs/03-database-and-gpx.md`
- `docs/04-rest-api.md`
- `docs/05-development-roadmap.md`
- `docs/06-risks-and-validation.md`
- `docs/07-phase-one-implementation.md`
- `docs/openapi-phase-one.json`
- `frontend/components.json`
- `frontend/package.json`
- `frontend/playwright.config.ts`
- `frontend/pnpm-lock.yaml`
- `frontend/pnpm-workspace.yaml`
- `frontend/src/app.css`
- `frontend/src/app.d.ts`
- `frontend/src/app.html`
- `frontend/src/lib/api/health.ts`
- `frontend/src/lib/components/ui/README.md`
- `frontend/src/routes/+layout.svelte`
- `frontend/src/routes/+page.svelte`
- `frontend/src/routes/activities/+page.svelte`
- `frontend/src/routes/dashboard/+page.svelte`
- `frontend/src/routes/settings/+page.svelte`
- `frontend/tests/e2e/skeleton.spec.ts`
- `frontend/tests/unit/health.test.ts`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/vitest.config.ts`
- `infra/compose.dev.yml`
