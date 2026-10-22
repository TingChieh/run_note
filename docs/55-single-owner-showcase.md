# 单账号公开展示与原生部署

> 后续扩展：当前已加入管理员受管账号、本人工作区和具名完整展示，并新增用户状态迁移。以下为单账号阶段的历史验收；当前使用及部署差异以 [用户管理与个人展示](56-admin-users-personal-showcase.md) 为准。

日期：2026-10-16。设计已由用户确认，允许公开指定站主的全部记录、完整轨迹和精确起终点，包括历史 private/unlisted 记录。

## 使用方式

- 直接访问首页，进入 `/dashboard`；记录列表/详情、足迹墙、足迹地图、统计、跑量目标与已成功 AI 报告均可匿名浏览。
- 直接输入 `/admin` 登录唯一站主，进入记录导入、编辑、删除、目标调整、AI 生成与设置。页面不提供登录/注册导航。旧 `/login`、`/register` 返回 404；注册 API 关闭。
- `SITE_OWNER_EMAIL` 默认 `tingchieh77@outlook.com`，后端精确匹配已存在的规范化邮箱。部署可通过进程环境覆盖；配置改变后需重启后端。前端不保存或自行选择 owner ID。
- 本功能不删除历史账号、不转移记录、不重置密码；历史其他账号不能登录，旧会话也不能使用本人接口。只有配置对应的一个账号能管理本站。
- 缺少站主时展示接口返回 503 `SHOWCASE_UNAVAILABLE`，不会取第一条用户，也不会自动建号。

## 接口与隐私

新增 GET-only `/api/v1/showcase`：`profile`、`activities`（含 categories、详情与 route）、`statistics/summary|calendar|trends|streaks`、`running-goals`、`footprints`（含 all、provinces）、`ai-reports`（含详情）。沿用响应信封、limit/offset、日期和指标口径，查询始终由服务端固定站主 ID。

展示 profile 仅含昵称与时区。活动通过独立白名单公开标题、分类、标签、时间与运动指标，路线公开完整 GeoJSON 和精确起终点。邮箱、用户名、owner ID、备注、质量原文、源文件名、原始 GPX/TCX、密码/会话/供应商密钥不公开。前端再次白名单重建，不能依赖隐藏按钮保护权限。

匿名报告只查询站主 `succeeded` 且未删除的历史，返回分析、聚合快照、时间与过时状态；不返回模型、提示词版本、供应商错误，不调用管理 context、recover、cleanup 或供应商，不提交读取事务。生成与删除仍走原认证接口；AI 对外请求继续仅含汇总白名单，不发送坐标、身份或源文件。

旧版 `/u/{username}`、`/public/activities/{id}`、`/shared/{token}` 保持原摘要授权与撤销规则，不返回路线。旧版的 private/unlisted/public 和主页开关**不会关闭本站展示**，界面已明确说明。地图轨迹始终在浏览器本地渲染，外部底图仅请求瓦片。

写接口继续在 FastAPI 的 identity/require_write 强制唯一管理员、CSRF 与 Origin 校验；SSR 代理固定源、同源 `/api/` 路径、七项头白名单和 11 MiB 限制均保留。即使生产 Caddy 直接将 `/api/*` 转发到后端，也不能绕过认证。

## 原生部署

> 2026-10-21 更新：模板已演进为 `/opt/run-note/current` 发布软链、域名由 `RUNNOTE_DOMAIN` 环境变量提供、API 2 worker 与沙箱加固，并新增备份/恢复演练与发布/回滚脚本。以 [生产部署基础设施](66-production-deployment.md) 为准；下列步骤保留为历史说明。

`infra/native/` 提供 Linux systemd 的 API/Web unit 和 Caddyfile 模板，路径假定 `/opt/run-note`、低权限用户 `runnote`，Node 路径需按主机安装位置核对。本次仅新增模板，尚未安装 unit、启动生产服务或配置公网域名。

1. 原生安装 PostgreSQL/PostGIS、Python 3.12、Node（满足前端 engines）、pnpm 11.25.0 和 Caddy。依赖使用后端锁文件与 `pnpm install --frozen-lockfile`，前端运行 `pnpm build`。
2. 优先恢复包含原站主与运动数据的受控备份。部署前备份并恢复演练，动态检查 `alembic heads/current`；需要升级时由操作者受控执行一次，禁止每个 worker 自动迁移。本功能没有新增数据库 Schema 或迁移。
3. 后端环境文件 `/etc/run-note/backend.env`（权限 600）由运维安全提供：`DATABASE_URL`、`APP_ENV=production`、`SITE_OWNER_EMAIL`、`SITE_ORIGIN=https://你的域名`、稳定的 `AUTH_RATE_HASH_KEY`（至少 32 字节）。可选 AI 变量仅提供给后端。不得把这些凭据复制进源码、unit 或前端环境。
4. 前端环境文件 `/etc/run-note/frontend.env` 只需 `INTERNAL_API_BASE_URL=http://127.0.0.1:8000`。Web unit 将 Node 绑定 loopback、设置 `PROTOCOL_HEADER=x-forwarded-proto` 与 `BODY_SIZE_LIMIT=11M`。该协议头只允许来自受控 Caddy，Caddy 模板会覆盖为 https；不开放 Node 端口，不扩大 SSR 头白名单、不配置宽松 trustedOrigins。
5. Caddyfile 替换域名。`/api/*` 保留路径代理到 8000，其余代理到 Node 3000；只向公网开放 Caddy 的 HTTPS/证书所需端口，数据库/API/Node 仅内部可达。API unit 禁用 Uvicorn 自动信任代理头。若为登录限流设置 `AUTH_TRUSTED_PROXIES`，仅允许已核对的 Caddy loopback IP，并保留 Caddy 对来源 IP 头的覆盖；默认不信任客户端转发头。
6. 在受控 shell 中加载同一后端环境，用 `backend/.venv/bin/python scripts/site-owner.py status` 只读检查账号与当前 schema。脚本不输出连接密码或密钥。
7. 只有全新站点缺少账号且确实要初始化时，操作者运行 `backend/.venv/bin/python scripts/site-owner.py create --username runner`。脚本要求交互输入目标库名、两次隐藏密码（12–128 字符）；已有站主立即拒绝，不重置密码或修改任何原账号，不自动迁移。**本次未在开发/生产库运行 create。** 部署恢复已有站主时无需此步骤，不能重开注册代替初始化。
8. 安装前先验证目标主机的 unit 路径与 `caddy validate`，再由操作者启动/切换服务。检查后端 live/ready 与 `/api/health`，还须检查 `/api/v1/showcase/profile`：数据库 ready 不等于指定站主已存在。

上线业务验收必须包括匿名所有主页面、完整轨迹与起终点、旧账号/匿名直接写请求拒绝、`/admin` 登录/导入/编辑/退出、HTTPS Secure/HttpOnly Cookie、真实域名 Origin/CSRF、底图失败降级和报告只读。日志不得记录密码、Cookie、源轨迹与真实坐标。备份恢复、回滚与 Linux HTTPS 行为须在实际环境另行验收；本地构建和合成 UI 不等于生产部署完成。

## 验证记录

测试仅使用合成 API 或显式允许的独立 `_test` 数据库，未修改开发库数据、密钥文件或现有开发服务。以下为本次实际执行结果，不代表真实站主数据或生产环境验收。

| 状态 | 命令 / 范围 | 本次结果 |
| --- | --- | --- |
| PASS | 后端 `.venv/bin/pytest tests/unit -q` | 302 passed，19.80s |
| PASS | 后端 `pytest tests/integration --ignore=tests/integration/test_migrations.py -q --tb=short` | 214 passed，92.56s；含展示、其他账号隔离、CSRF、报告只读及离线建号回归 |
| PASS | 新增展示集成 `pytest tests/integration/test_showcase.py -q` | 5 passed，1.27s（也包含在上行范围中，不重复计数） |
| PASS | 后端 `ruff check app migrations tests` / `ruff format --check app migrations tests` | All checks passed；147 files already formatted |
| PASS | `ruff check --config pyproject.toml ../scripts/site-owner.py` / 同配置 `ruff format --check`；脚本 `--help` | 检查通过；1 file already formatted；帮助正常退出 |
| PASS | 前端 `pnpm test` | 25 files、147 tests passed |
| PASS | 前端 `pnpm check` | 0 errors、0 warnings；包含新增 Playwright 配置 |
| PASS | 前端 `pnpm build` | adapter-node 生产构建成功；既有大 chunk 提示仍存在 |
| PASS | `playwright test --config playwright.showcase.config.ts` | 开发构建 Chrome 6 passed；桌面/手机、明暗、匿名/管理员、退出与公开路线 |
| PASS | `playwright test --config playwright.showcase-build.config.ts` | adapter-node 真实生产构建 Chrome 6 passed，使用合成 API，未连接开发库 |
| PASS | `playwright test --config playwright.activity-library.config.ts --grep-invert 'device metrics use readable icon cards'` | 38 passed，45.2s；记录管理、分类标签、TCX 与详情相关回归 |
| PASS | 六文件主 UI 回归：dashboard、p2、ui-shell、footprints、milestones、theme | 首轮 63 passed、2 failed；修正响应式断言等待与公开墙读取夹具后，两项分别重跑通过。没有宣称整组单次全绿 |
| PASS | dashboard-explorer、footprint-card-deck、milestones 的受影响读取回归 | 16 passed，28.3s；覆盖分页/缓存、迟到响应、重试、401、完整路线切换与足迹墙 |
| FAIL（原有） | `activity-metrics.spec.ts` 的 `device metrics use readable icon cards...` | 断言要求指标字号 ≥28px，实际 20px。HEAD 中原详情 CSS 同样是 `1.25rem`；本次未改该排版，也未将整套 UI 记作通过 |
| PASS | `git diff --check` | 无空白错误 |

主 UI 首轮的两项失败分别是视口切换后立即读取宽度的瞬态值，以及足迹墙仍拦截旧的本人活动列表路径。测试改为等待布局稳定、拦截 showcase 列表；没有放宽业务数量或匿名权限断言。最终新增生产构建测试配置的联合类型错误也已修正并重新执行类型检查与生产构建浏览器验收。

集成环境仅在测试进程注入 `TEST_DATABASE_URL`、`TEST_DATABASE_ALLOWED_TARGETS`、`APP_ENV=test`、`RUNNOTE_TEST_NO_MIGRATIONS=1`，使用原生 `127.0.0.1:5432/runnote_tcx_v2_20261015_test`。本次在核对真实库名、端口和版本后，仅对该独立测试库执行 `0009 → 0010` 升级；没有新增迁移、升级开发库或清理真实记录。后续完整回归没有重复迁移。测试夹具只离线创建合成站主，再走真实登录；没有正式注册后门。

桌面 1440px 明色和手机 390px 暗色合成详情截图已实际打开检查，路线与起终点标记可见、内容可读。完整轨迹/他人资源不可见另由 PostGIS 集成断言验证。两者仍不能替代指定真实账号的业务验收。

### 未运行与限制

- 未运行迁移专用集成 `test_migrations.py`、完整 UI 全集及旧真实后端前端 E2E。旧 E2E 的注册步骤与关闭注册冲突，未来执行前应改为独立测试库离线预置站主，不能临时开放正式注册。
- 未重启开发实例，未在真实站主账号上导入/编辑/删除或核对全部历史记录；未调用真实 AI 供应商。
- 当前主机没有 systemd/Caddy，部署模板未在 Linux、真实 HTTPS、生产 Origin/Cookie 与证书环境执行。未部署、未提交或推送；上线前按上文逐项验收。

### 改动范围

- 后端：Settings 唯一站主配置、统一身份与登录限制、注册关闭、新 showcase router/schema/service；未新增表。
- 前端：公开 API 客户端、SSR profile、公开布局导航、`/admin`、所有主页面读写权限与真实隐私提示。管理员编辑从本人接口读取备注，避免公开响应缺少备注造成覆盖。
- 运维与文档：`.env.example`、`scripts/site-owner.py`、`infra/native/`、README、AGENTS、设计/计划/本记录。
- 测试：新增展示单元/独立库/Chrome 用例；已有测试的读取路径、登录入口与隐私提示同步。历史多用户集成夹具改为离线创建合成站主，跨账号用不同站点配置，跨 worker 用同一配置；正式权限未增加测试绕过开关。

### 保留行为与边界

原指标算法、GPX/TCX/小米导入并发锁、本人写接口、CSRF、事务/归属校验、AI 同意与配额、摘要分享、主题和地图降级保留。工作区已有其他 UI/地图/设计系统修改保留，不全部归因于本功能。未提交、推送、部署；未重启开发服务，未进行真实站主账号浏览器验收，未调用真实 AI 供应商。
