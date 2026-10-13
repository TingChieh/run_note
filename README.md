# 跑步数据管理与可视化分析系统

软件工程本科毕业设计：**基于 Web 的跑步数据管理与可视化分析系统的设计与实现**。

当前已实现第一阶段骨架及第二阶段 S2-01–S2-06 的本地业务：存储模型/迁移、后端认证、会话安全、限流、资料接口及 GPX 解析/指标/原子导入。已接入前端注册、登录、退出、当前用户展示及私人页面保护。现已交付 GPX 安全解析/原子导入、本人活动列表/详情与 MapLibre 分段路线及起终点；刷新可重读。现已接入可降级的 OpenStreetMap 道路底图、年度运动日历与后端聚合基础统计（ECharts周/月趋势）；分享与 AI 尚未实现。现已交付个人足迹地图、多轨迹叠加与固定网格经过记录数热力图；最新结果见[足迹与热力图验收](docs/13-footprints-heatmap-acceptance.md)。实际验收和未验证事项见[第二阶段进度](docs/09-phase-two-progress.md)。

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
| [第二阶段开发进度](docs/09-phase-two-progress.md) | S2-01–S2-06 及本轮最小前端/路线的实际证据与边界 |
| [S2-03 本地认证验收](docs/10-s2-03-local-auth-acceptance.md) | 前端认证、本地密钥、真实浏览器、关闭判断与未验证范围 |
| [GPX 导入与地图验收](docs/11-gpx-import-map-acceptance.md) | 实际接口、页面、215项后端测试、浏览器上传/刷新/隔离及变更文件 |
| [足迹与热力图验收](docs/13-footprints-heatmap-acceptance.md) | 固定网格、完整路线相交、本人轨迹叠加与Chrome证据 |
| [日历统计与底图验收](docs/12-calendar-statistics-map-acceptance.md) | 年度日历、ECharts趋势、本人数据聚合、瓦片服务及浏览器证据 |

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
.venv/bin/alembic current
# 既有开发库已在 0003_gpx_storage，不执行迁移。
cd ..
backend/.venv/bin/python scripts/local-auth.py init
backend/.venv/bin/python scripts/local-auth.py serve
```

当前迁移 head 为 `0003_gpx_storage`，包含 PostGIS 与七张业务表；既有开发库已在 head，不需重复升级。缺少必填数据库配置会拒绝启动。服务可启动不等于数据库已就绪。

S2-03 认证还需在服务端进程环境安全配置 `AUTH_RATE_HASH_KEY`（至少32字节随机密钥，所有 worker 和重启使用同一值），`SITE_ORIGIN` 必须精确匹配浏览器来源。生产要求 HTTPS 来源与密钥，否则拒绝启动；development 缺密钥时健康检查可用，认证接口返回503。现有 `.env` 不自动修改；密钥轮换会使旧限流桶不再命中。默认不信任转发IP；明确的反向代理环境才配置 `AUTH_TRUSTED_PROXIES`（JSON数组，精确IP）。

本地脚本首次创建独立 `.env.auth-rate.key`（Git 忽略，权限600）：随机48字节生成64个URL-safe字符，读取要求UTF-8至少32字节。密钥只用于限流标识HMAC-SHA256，不是密码或会话签名密钥；没有强制hex/base64格式。脚本保留已有文件、重启复用值、显式进程环境优先，不输出密钥、不改 `.env`、不迁移。不要把密钥放入前端或命令行参数，不要为绕过限流轮换它。默认精确来源为 `http://127.0.0.1:5173`，不要混用localhost。

本轮保留原有8000/5173服务（认证缺密钥），可用认证实例为 **http://127.0.0.1:5183**（API8001）。实例仍运行时直接访问，不重复启动；停止后分别从仓库根目录启动：

```bash
# 终端一：复用本地密钥，仅启动API
backend/.venv/bin/python scripts/local-auth.py serve --port 8001 --site-origin http://127.0.0.1:5183
# 终端二：进程环境覆盖内部API目标，不改.env
cd frontend
INTERNAL_API_BASE_URL=http://127.0.0.1:8001 pnpm dev --port 5183
```

注册受每IP每小时10次的真实限制。此前认证及本轮GPX浏览器验收均使用正常注册，未重置计数；配额用尽后等待窗口结束。反复浏览器测试应使用已有且版本正确的独立测试库，不清理开发库。

前端（另一终端）：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://127.0.0.1:5173>，首页会实际请求 `/api/health`。SvelteKit 服务端把同源 `/api` 转发给服务端环境中的 `INTERNAL_API_BASE_URL`（进程环境优先于 `.env`），数据库 URL 和密码不进入浏览器配置。`/login`、`/register` 可直接使用；`/settings` 编辑昵称、简介和公开主页开关；`/activities` 可上传并查询本人跑步记录，`/activities/{id}` 展示指标和路线；`/dashboard` 展示年度日历、运动统计与周/月趋势，`/footprints` 支持个人路线叠加、年份/日期范围筛选和运动热力图，私人页面均需登录。公开主页 `/u/{username}`、单条公开记录 `/public/activities/{id}`、令牌摘要分享 `/shared/{token}` 可匿名浏览；在记录详情管理 private/unlisted/public 和创建/撤销分享。本轮分享完全不公开坐标与精确起终点，公开主页仅统计 public 记录。关闭主页不会撤销独立分享或单条公开记录，须单独撤销链接/设为私人。认证 Cookie 为 HttpOnly、SameSite=Lax；不在 localStorage 存凭证或用户资料。

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

未设置独立测试 URL 时，数据库集成用例会跳过，不能视为数据库验收通过。

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

- `frontend/`：认证页面、请求级SSR身份、同源API代理与私人页面保护；SvelteKit 3 / Svelte 5 / TypeScript，Tailwind 4；`src/lib/components/ui` 与 `components.json` 仅预留 shadcn-svelte 结构。
- `backend/app/core`：环境、响应、错误与日志；`api`：依赖；`db`：会话和 Base；`models`：模型层预留；`modules/health`：Router、Service、Schema。
- `backend/migrations`：Alembic；`backend/tests`：单元和真实 PostGIS 集成测试。
- `.github/workflows/ci.yml`：原生 Homebrew 临时测试集群与前端检查流程。
- `infra/compose.dev.yml`：保留的历史配置，已停用，不属于启动、测试或部署方案。

SvelteKit 3 的实际配置位于 `vite.config.ts`，TS 继承 `$app/tsconfig`，原生包导入别名为 `#lib/*`；服务端变量通过 `src/env.ts` 声明并从 `$app/env/private` 导入，hooks 类型从 `@sveltejs/kit/hooks` 导入。这些是锁定版本的兼容配置，未沿用旧版 `$lib` 或 `svelte.config.js`。

## 生产部署计划

Linux 主机原生安装 PostgreSQL/PostGIS、Python、Node.js 与 Caddy。应用以专用低权限用户运行；后端使用独立 `.venv`，前端使用 pnpm 锁文件构建后的 `frontend/build`。systemd 分别管理 Uvicorn 和 SvelteKit Node 服务，Caddy 负责 HTTPS 与同源路由：`/api/*` 保留路径转发至 API，其他请求转发至 Node。

数据库、API 和 Node 端口仅内部可达，只有 Caddy 对公网开放。部署时先核对版本、备份数据库，在受控单次步骤执行 Alembic，再启动/切换应用；不让各 worker 自行迁移。密钥通过受控环境文件提供，不写入 unit 或仓库。systemd/Caddy 配置、HTTPS、备份恢复与版本回滚在阶段八实施和实测，目前仅为计划。

## 停止本地服务

前后端终端使用 Ctrl-C。数据库由 Homebrew 独立管理，停止应用不需要停止数据库。本次文档调整不修改或重启现有 PostgreSQL 服务。持久性测试在独立受控实例进行，避免影响正在使用的数据库。

`.env`、虚拟环境、依赖目录及生成产物均被 Git 忽略。历史容器文件保留但停用；本项目不使用 Docker、Compose 或其他容器方案。第一阶段 Git 基线检查与本轮回归结果见实施记录第 10 节；不自动推送远程仓库。

本轮公开主页与分享的隔离库迁移、权限矩阵和真实 Chrome 证据见 [验收记录](docs/14-public-sharing-acceptance.md)。开发库仍停留0003，本轮未对其迁移；使用新版本连接开发库前需单独备份并应用0004迁移。
