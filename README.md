# 跑步数据管理与可视化分析系统

软件工程本科毕业设计：**基于 Web 的跑步数据管理与可视化分析系统的设计与实现**。

当前已实现第一阶段代码骨架：前端布局和占位页、健康检查、数据库连接及初始 PostGIS 迁移。尚未实现用户认证、GPX、地图、统计、分享或 AI。实际验收结果及未验证事项见[第一阶段实施记录](docs/07-phase-one-implementation.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [需求分析与范围](docs/01-requirements.md) | 需求与业务规则 |
| [系统架构与目录设计](docs/02-architecture.md) | 模块边界、职责、拟定目录 |
| [数据库与轨迹数据设计](docs/03-database-and-gpx.md) | 后续业务表、轨迹与算法方案 |
| [REST API 设计](docs/04-rest-api.md) | 后续接口与权限设计 |
| [开发阶段与验收标准](docs/05-development-roadmap.md) | 八阶段任务和验收条件 |
| [技术风险、测试与毕业交付](docs/06-risks-and-validation.md) | 风险、性能及毕业交付 |
| [第一阶段实施记录](docs/07-phase-one-implementation.md) | 实际版本、文件清单、命令结果与限制 |
| [第一阶段 OpenAPI](docs/openapi-phase-one.json) | 已实现 API 的生成快照 |
| [第二阶段技术方案与实施计划](docs/08-phase-two-implementation-plan.md) | 认证、GPX、轨迹存储、指标、去重、安全迁移及逐步验收 |
| [第二阶段开发进度](docs/09-phase-two-progress.md) | 仅 S2-01 的规则、依赖、样本和测试环境准备；其余步骤未开始 |

前六份文档起始于 2026-10-09 的设计基线，开发与部署方案于 2026-10-12 调整为非容器化；其中未实现业务仍属于后续阶段。实际验证状态以实施记录为准。

## 本地启动

本项目统一使用非容器化方案：macOS + Homebrew PostgreSQL 18 / PostGIS 3.6、Python 3.12 独立虚拟环境、Node.js 22.17+（22 LTS）或 24 LTS、pnpm 11.25.0。当前本机数据库版本为 PostgreSQL 18.6 / PostGIS 3.6.4。

以下命令从仓库根目录开始。已有 `.env` 时不要复制覆盖。

```bash
test -e .env || cp .env.example .env
```

编辑新环境的 `.env`，将 `DATABASE_URL` 中的密码占位符替换为实际密码，使用 `postgresql+psycopg://`，特殊字符需 URL 编码。已有配置不覆盖。

检查现有 Homebrew 环境（只读）：

```bash
brew list --versions postgresql@18 postgis
brew services list
/opt/homebrew/opt/postgresql@18/bin/pg_config --version
/opt/homebrew/opt/postgresql@18/bin/pg_config --sharedir
/opt/homebrew/opt/postgresql@18/bin/pg_config --pkglibdir
```

当前数据库 `running_note` 已可用，无需重新安装、初始化或修改服务配置。**仅在全新 macOS 环境**，先核对 Homebrew 配方、依赖和 PostgreSQL 主版本，再安装并启动：

```bash
brew install postgresql@18 postgis python@3.12 node@22
brew services start postgresql@18
```

Homebrew 的包版本会更新；安装前核对是否能提供目标 PostgreSQL/PostGIS 兼容版本，不直接升级现有实例。Apple Silicon 常用前缀为 `/opt/homebrew`；其他环境通过 `brew --prefix postgresql@18` 获取路径。pnpm 按 `frontend/package.json` 中的 packageManager 版本安装，不混用其他前端包管理器。

新环境由数据库管理员创建应用角色和数据库，并在**指定库**启用 PostGIS；应用角色保持非超级用户。角色密码通过交互式命令或安全配置设置，不写入代码、命令历史或文档。示例中的角色/库名仅适用于全新且尚未创建的环境：

```sql
CREATE ROLE run_note LOGIN;
-- 在 psql 中使用交互式命令 \password run_note 设置密码。
CREATE DATABASE running_note OWNER run_note;
-- 使用管理员连接 running_note 后执行：
CREATE EXTENSION IF NOT EXISTS postgis;
```

扩展文件必须匹配 PostgreSQL 18，数据库中的 `SELECT PostGIS_Full_Version()` 应成功。Homebrew 数据目录独立于项目代码、`.venv` 和 node_modules；重装应用依赖不能清理数据库目录。现有实例不执行上述创建步骤。

后端（独立终端）：

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/alembic upgrade head
.venv/bin/alembic current
.venv/bin/uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8000
```

迁移只启用 PostGIS 并记录 Alembic 版本，不创建业务表。缺少必填数据库配置会拒绝启动。服务可启动不等于数据库已就绪。

前端（另一终端）：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://127.0.0.1:5173>，首页会实际请求 `/api/health`。Vite 把同源 `/api` 转发给 `.env` 中的 `INTERNAL_API_BASE_URL`，数据库 URL 和密码不进入浏览器配置。占位页为 `/activities`、`/dashboard`、`/settings`。

健康接口及 API 文档：

```bash
curl -i http://127.0.0.1:8000/api/v1/health/live
curl -i http://127.0.0.1:8000/api/health
curl -i http://127.0.0.1:8000/api/v1/health/ready
```

- live：进程存活返回 200，不查询数据库。
- ready 与 `/api/health`：数据库、PostGIS 与当前迁移均就绪才返回 200，否则返回统一的脱敏 503。
- OpenAPI UI：<http://127.0.0.1:8000/docs>。

后端统一返回 `{data,error,meta.request_id}`，每个请求带 `X-Request-ID` 和 `Cache-Control: no-store`。

## 检查与测试

后端：

```bash
cd backend
.venv/bin/pytest tests/unit -q
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
```

集成测试使用单独的 PostgreSQL/PostGIS 数据库，名称以 `_test` 结尾；会执行迁移，不能指向业务库。本机已经有 `running_note_phase_one_test`，不重复创建。

全新测试环境由管理员创建独立测试库，并仅在该库启用扩展。命令使用管理员身份连接已确认的目标实例（管理员用户名按实际环境替换）：

```bash
createdb -h 127.0.0.1 -p 5432 -U <管理员角色> -O run_note running_note_phase_one_test
psql -h 127.0.0.1 -p 5432 -U <管理员角色> -d running_note_phase_one_test -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

测试需要 `TEST_DATABASE_URL` 和显式允许目标的 `TEST_DATABASE_ALLOWED_TARGETS`（例如 `127.0.0.1:5432/running_note_phase_one_test`，多目标用逗号分隔）。测试库名称必须不同于 `DATABASE_URL` 中的数据库名；即使另一个端口/主机也不能用同名库。连接 URL 不允许 query 覆盖参数，守卫还会以只读连接验证实际库名与端口，失败时先于集成测试 DDL 拒绝。

可仅通过进程环境提供这两个变量，不必修改已有 `.env`；安全执行脚本见[第二阶段进度记录](docs/09-phase-two-progress.md#运行测试)。第一阶段历史记录的旧脚本未包含新增允许目标变量，不再直接作为当前运行命令。配置完成后：

```bash
cd backend
.venv/bin/pytest -q
```

未设置测试 URL 时，3 个集成用例会跳过，不能视为数据库验收通过。

前端：

```bash
cd frontend
pnpm test
pnpm check
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

E2E 要求后端已启动且数据库 ready；测试自动启动前端。使用已安装 Chrome 时可替换为 `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`，无需下载 Chromium。

## 结构与实现边界

- `frontend/`：SvelteKit 3 / Svelte 5 / TypeScript，Tailwind 4；`src/lib/components/ui` 与 `components.json` 仅预留 shadcn-svelte 结构。
- `backend/app/core`：环境、响应、错误与日志；`api`：依赖；`db`：会话和 Base；`models`：模型层预留；`modules/health`：Router、Service、Schema。
- `backend/migrations`：Alembic；`backend/tests`：单元和真实 PostGIS 集成测试。
- `.github/workflows/ci.yml`：原生 Homebrew 临时测试集群与前端检查流程。
- `infra/compose.dev.yml`：保留的历史配置，已停用，不属于启动、测试或部署方案。

SvelteKit 3 的实际配置位于 `vite.config.ts`，TS 继承 `$app/tsconfig`，原生包导入别名为 `#lib/*`。这些是锁定版本的兼容配置，未沿用旧版 `$lib` 或 `svelte.config.js`。

## 生产部署计划

Linux 主机原生安装 PostgreSQL/PostGIS、Python、Node.js 与 Caddy。应用以专用低权限用户运行；后端使用独立 `.venv`，前端使用 pnpm 锁文件构建后的 `frontend/build`。systemd 分别管理 Uvicorn 和 SvelteKit Node 服务，Caddy 负责 HTTPS 与同源路由：`/api/*` 保留路径转发至 API，其他请求转发至 Node。

数据库、API 和 Node 端口仅内部可达，只有 Caddy 对公网开放。部署时先核对版本、备份数据库，在受控单次步骤执行 Alembic，再启动/切换应用；不让各 worker 自行迁移。密钥通过受控环境文件提供，不写入 unit 或仓库。systemd/Caddy 配置、HTTPS、备份恢复与版本回滚在阶段八实施和实测，目前仅为计划。

## 停止本地服务

前后端终端使用 Ctrl-C。数据库由 Homebrew 独立管理，停止应用不需要停止数据库。本次文档调整不修改或重启现有 PostgreSQL 服务。持久性测试在独立受控实例进行，避免影响正在使用的数据库。

`.env`、虚拟环境、依赖目录及生成产物均被 Git 忽略。历史容器文件保留但停用；本项目不使用 Docker、Compose 或其他容器方案。第一阶段 Git 基线检查与本轮回归结果见实施记录第 10 节；不自动推送远程仓库。
