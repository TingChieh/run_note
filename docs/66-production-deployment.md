# 生产部署基础设施（阶段 1）

日期：2026-10-21。范围：仓库内的部署资产、Linux CI、备份与恢复演练、发布与回滚脚本和运维文档。**未部署、未连接任何服务器、未触碰真实密钥或开发库**；业务代码没有改动。外部条件（服务器、域名、预算）尚未确定，因此所有脚本都对路径和连接参数做了环境变量化，并用隔离环境演练过。

## 使用方式

### 目标形态

单台 Linux（推荐 Ubuntu 24.04 LTS）全原生：

```text
Internet --443--> Caddy ──/api/*──> 127.0.0.1:8000  uvicorn（systemd，2 worker）
                        └─其余───> 127.0.0.1:3000  Node adapter-node（systemd）
PostgreSQL 18 + PostGIS 3.6（仅本机） ←  每晚 pg_dump + 真实恢复演练 → restic 异地
```

服务器目录：

```text
/opt/run-note/releases/<id>/   每个发布自带 backend/ frontend/build ops/ infra/ 与 backend/.venv
/opt/run-note/current          → 当前发布（软链）
/opt/run-note/previous         → 上一发布（软链）
/etc/run-note/{backend,frontend,backup}.env   0600/0640，root 持有
/var/backups/run-note/         本机备份（0700，postgres 持有）
```

### 一次性准备（以下命令尚未在真实服务器执行）

1. 用户与目录：`useradd --system --home /opt/run-note --shell /usr/sbin/nologin runnote`；`install -d -o root -g root /opt/run-note/releases /etc/run-note`。
2. 软件：PostgreSQL 18 + PostGIS（PGDG apt 源）、Python 3.12、Node（满足 `^22.17 || ^24`，如 NodeSource，二进制须位于 `/usr/bin/node`）、Caddy（官方 apt 源）、`restic`、`curl`。pnpm 只在构建机需要。
3. **数据库必须先由超级用户建好扩展**：迁移 `0001` 执行 `CREATE EXTENSION IF NOT EXISTS postgis`，而 PostGIS 不是 trusted extension，应用角色无权创建。

   ```bash
   sudo -u postgres psql -c "CREATE ROLE runnote LOGIN"          # 然后 \password runnote
   sudo -u postgres createdb -O runnote runnote
   sudo -u postgres psql -d runnote -c "CREATE EXTENSION IF NOT EXISTS postgis"
   ```
4. 环境文件：把 `infra/native/env/*.env.example` 复制到 `/etc/run-note/`，去掉 `.example`，替换所有 `CHANGE_ME`。`AUTH_RATE_HASH_KEY` 在服务器上用 `openssl rand -base64 48` 生成，**不要**经由聊天、仓库或命令行参数传递。JSON 值必须用单引号（`AUTH_TRUSTED_PROXIES='["127.0.0.1"]'`）。
5. 单元与 Caddy：把 `runnote-*.service/.timer` 复制到 `/etc/systemd/system/`；Caddyfile 放 `/etc/caddy/Caddyfile`，用 `systemctl edit caddy` 设置 `Environment=RUNNOTE_DOMAIN=你的域名`，先 `caddy validate` 再重载；`systemctl enable runnote-api runnote-web runnote-backup.timer`。
6. 防火墙只放行 22、80、443；SSH 禁用密码登录。

### 构建与首次部署

```bash
# CI 或工作站（需 pnpm、node、git，工作区必须干净）
pnpm --dir frontend install --frozen-lockfile
infra/native/ops/build-release.sh --out ./dist-release      # 输出 run-note-<id>.tar.gz 及 .sha256

# 服务器：先取出该发布自带的 ops/，再用它安装（新版逻辑安装新版本）
mkdir -p /tmp/rn-stage && tar -xzf run-note-<id>.tar.gz -C /tmp/rn-stage --strip-components=1   # 只用其中的 ops/
sudo /tmp/rn-stage/ops/deploy.sh --migrate run-note-<id>.tar.gz   # 空库首次初始化也必须显式 --migrate（见下表）
sudo -u runnote /opt/run-note/current/backend/.venv/bin/python /opt/run-note/current/scripts/site-owner.py status
```

恢复已有站主数据库时用上述 `status` 核对；只有全新空站才在受控终端运行 `site-owner.py create`（见 docs/55）。

### 日常发布

| 情况 | 命令 | 行为 |
| --- | --- | --- |
| 发布不含迁移 | `deploy.sh <tarball>` | 校验配置 → 解包+建 venv → 比较 schema → 切软链 → 重启 → 冒烟（API ready + Node 代理可达）→ 失败且 schema 未变时自动回到上一发布 |
| 发布含迁移 | `deploy.sh --migrate <tarball>` | 先停服务 → 备份 → **真实恢复演练（行数严格相等）** → `alembic upgrade head`（单次，非每 worker）→ 切软链 → 启动 → 冒烟 |
| 忘记 `--migrate` | — | 拒绝，库与软链均不变 |
| **空库首次初始化** | `deploy.sh --migrate <tarball>` | 数据库**没有 schema**时的专用路径：停服务 → **再次确认仍为空** → `alembic upgrade head`（单次）→ 核对 revision 等于发布 head → 切软链 → 启动 → 冒烟。**不做备份与恢复演练**（没有数据可保护） |
| 空库但没带 `--migrate` | — | 拒绝，不会在普通部署中隐式建 schema |
| 库比发布新 | — | 拒绝（这是回滚，不是发布） |

保留最近 5 个发布（`KEEP_RELEASES` 可调），永不删除 `current` 与 `previous`。

#### 首次初始化与普通迁移的区别

| | 首次初始化（空库） | 普通迁移（已有 schema） |
| --- | --- | --- |
| 判定 | `schema_compat.py db-state` 返回 `empty` | `db-state` 返回 `revision <rev>`，且落后于发布 head |
| 备份 + 严格恢复演练 | 无（没有数据） | 有，失败则不迁移 |
| 必须 `--migrate` | 是 | 是 |
| 失败后 | Alembic 在单个事务内迁移，失败会整体回滚，库仍为空，可直接重试 | 保留迁移前备份，按"回滚决策"处理 |

`empty` 的判定很严格：**缺少 `alembic_version` 不等于空**。必须同时满足：没有 `alembic_version` 表；扩展只有 `plpgsql` 与预先创建的 `postgis`；在非系统 schema 中没有任何**非扩展成员**的表、视图、序列、复合类型、函数、类型、额外 schema 或大对象。PostGIS 自带的对象（如 `spatial_ref_sys`、`geometry_columns`、`geometry_dump`、`valid_detail`）不计入。以下情形一律拒绝，不做任何修改：已有业务对象但无版本表；有 `alembic_version` 表但没有行或有多行（迁移状态不明）；存在其他扩展；数据库版本不在本发布的迁移链中（视为回滚）。

### 回滚决策

应用对 schema 要求**精确匹配**：`alembic_version` 必须等于发布的唯一 head，否则 `/api/health` 返回 503，足迹后台 worker 也不写入（`app/db/schema.py`、`modules/health/service.py`、`footprints/worker.py`）。降级迁移遇到真实数据会 `RuntimeError`（`0011`、`0012`），`0013` 为空操作。因此：

| 目标发布的 head 与库的关系 | `rollback.sh` 行为 |
| --- | --- |
| 相同（未经过迁移） | 直接切软链并重启，冒烟通过才算完成 |
| 库更新（回滚跨过迁移） | **拒绝**。选项一：前向修复（推荐，新发布）。选项二：`--restore-db <迁移前备份>`，**放弃该备份之后的所有写入** |

`--restore-db` 的流程：校验备份 sha256 → 要求手工键入库名确认 → 在旁边的临时库恢复并核对 revision 与目标发布一致 → 停服务 → 把现网库改名为 `<库>_pre_rollback_<时间>`（保留，供找回后来写入的数据）→ 临时库改名上线 → 切软链启动。任何一步失败都不会留下无库的状态。

**迁移编写约定（给后续开发）**：每个会带迁移的发布都应说明是否可前向修复；优先 expand/contract（先加后删，不在同一发布里破坏旧代码依赖的结构）；迁移不得假设可降级。

### 备份与恢复演练

- `runnote-backup.timer` 每晚 03:15（含 15 分钟随机延迟）执行 `backup.sh --label nightly --drill`：`pg_dump -Fc` → sha256 → `pg_restore --list` → **恢复到临时库并比对** → restic 异地（配置后）→ 保留策略 → 心跳（`HEALTHCHECK_URL`）。
- 恢复演练（`restore-drill.sh`）校验：校验和；`pg_restore --exit-on-error` 完整恢复；revision 与现网一致；`PostGIS_Version()` 可用；表集合与每表索引数一致；逐表行数（`--strict-counts` 时必须相等，部署时服务已停止才使用）；每个几何列可查询。仅 `--list` 不算通过。
- 异地保留：每日 7、每周 4、每月 6（`restic forget --prune`，只作用于 `nightly` 标签）。本机保留 14 份夜间备份、10 份迁移前备份。
- 手动演练：`sudo -u postgres env PGDATABASE=runnote /opt/run-note/current/ops/restore-drill.sh <dump>`。**至少每季度从异地仓库取回备份、在另一台机器上演练一次**——本机演练证明备份可用，不证明异地副本可取回。
- 备份包含全部私人数据（含精确轨迹、密码哈希、会话）：目录 0700，异地必须加密，**不得**放入仓库（`.gitignore` 已忽略 `*.dump`）。

### 配置校验

`ops/envfile.py check <文件> --kind backend|frontend` 不经 shell 读取 EnvironmentFile，并在后端复用应用自己的 `Settings` 校验，额外拒绝：占位符残留、`APP_ENV!=production`、缺少 `AUTH_TRUSTED_PROXIES` 的 `127.0.0.1`、非回环数据库主机、`TEST_DATABASE_*`、`PUBLIC_*`、文件对 other 可读。输出只含字段名，不含值。`deploy.sh` 在创建 venv 之前就先做廉价检查，建好 venv 后再做完整检查。

## 接口与隐私

- **无业务接口、响应结构、数据库 schema 变更。** 新增的只有 `infra/`、CI 与文档。
- **登录限流复核结论（读 `rate_limit.py`、`auth/router.py`，并实测）**：`client_ip` 仅当 TCP 对端在 `AUTH_TRUSTED_PROXIES` 中才从右向左解析 `X-Forwarded-For`；默认 `[]` 时所有请求的来源都是 Caddy 的 `127.0.0.1`。`/api/v1/auth/csrf`（60 次/小时/IP）与登录（60 次/15 分钟/IP）因此会变成**全站共享配额**。Caddy 模板用 `header_up X-Forwarded-For {remote_host}` 覆盖该头，所以配置 `AUTH_TRUSTED_PROXIES='["127.0.0.1"]'` 后取到的是真实访客 IP。实测见验证记录。模板已内置该值，`envfile.py` 缺失即拒绝。
- **迁移逻辑复核结论**：`migrations/env.py` 为迁移单独设 `statement_timeout=60s`、`lock_timeout=5s`（应用连接是 3s），故迁移必须在应用停止后执行（脚本已如此）；启动期望值取唯一 head；`0011` 默认把历史普通账号设为停用/不公开；`0013` 是数据回填且不可降级。**迁移不会、也不应由应用启动触发。**
- Caddy **不开启访问日志**：URI 可能含 `/shared/<token>`；API 自身的日志过滤器会脱敏，Caddy 的不会。
- 响应头：HSTS（`max-age=31536000`，未加 `includeSubDomains`/`preload`）、`nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`（仅在应用未设置时）、`Permissions-Policy`、`Content-Security-Policy-Report-Only`。CSP 先 Report-Only，因 SvelteKit 内联脚本与底图主机（`tiles.openfreemap.org`）需在真实域名下确认后再升级。底图域名与 docs/52 一致，轨迹不进入任何第三方请求。
- 站主展示仍公开完整轨迹与精确起终点（既有设计，未改变）。
- Node 绑定 loopback，仅 Caddy 能设置 `x-forwarded-proto`；SSR 代理白名单、11 MiB 上限与 `INTERNAL_API_BASE_URL` 固定源均未改动。

## 验证记录

以下均为本次实际执行，环境为 macOS 开发机，PostgreSQL 18.6（Homebrew）+ PostGIS，在**临时目录里新建的独立集群**（非开发库）。命令工作目录为独立 worktree。

| 状态 | 命令 / 范围 | 实际结果 |
| --- | --- | --- |
| PASS | `backend/.venv/bin/python -m unittest discover -s infra/native/tests` | 17 tests OK（环境文件解析、生产 Settings 校验且不泄露值、schema 关系含"库更新于发布→ahead"、双 head 拒绝、仓库真实 head 唯一） |
| PASS | `shellcheck -x --source-path=SCRIPTDIR infra/native/ops/*.sh infra/native/tests/*.sh` | 无告警 |
| PASS | `ruff check` / `ruff format --check`（`--config backend/pyproject.toml`，作用于 `infra/native` 的 `.py`） | All checks passed；4 files already formatted |
| PASS | `ops/build-release.sh --allow-dirty` | 产出 tarball（约 5.5 MB）与 `.sha256`；含 `RELEASE`、`ops/`、`backend/requirements.lock`、`frontend/build/index.js`；未含 `__pycache__` |
| PASS | 发布内的 `frontend/build` 在**无 node_modules** 的目录中用 Node 22 启动 | `/api/health` 经 Node 代理 200；`/login` 404；`/` 303 |
| PASS | 以 `APP_ENV=production` + 环境文件经 `envfile.py exec` 启动 `uvicorn --workers 2` | `/api/v1/health/ready` 200，schema current |
| PASS | 登录限流实测（`/api/v1/auth/csrf`，同一 uvicorn 配置，仅差 `AUTH_TRUSTED_PROXIES`） | 配置 `["127.0.0.1"]`：来源 A 60×200 + 2×429，来源 B 3×200；**未配置**：来源 A 同上，来源 B 3×**429**（共享桶） |
| PASS | `backup.sh --drill --strict-counts` | 导出、校验和、真实恢复、比对全部通过，临时库自动清理 |
| PASS | 恢复演练负向用例 | 现网在备份后新增一行 + `--strict-counts` → FAIL；文件被改动 → 校验和失败；revision 被人为改动 → FAIL |
| PASS | `tests/ops-e2e.sh`（10 步） | 缺少 `AUTH_TRUSTED_PROXIES` 被拒且未安装任何内容；落后 schema 不带 `--migrate` 被拒且库不变；`--migrate` 触发备份+严格计数演练+迁移；同 schema 发布无多余备份；`rollback previous` 仅切换；跨迁移回滚被拒；`--restore-db` 恢复到迁移前且后来写入保留在 `_pre_rollback_` 副本；冒烟失败自动回到上一发布 |
| PASS | `pnpm exec playwright test --config playwright.ui.config.ts theme.spec.ts`（worktree，真实 Chrome） | 7 passed（仅用于确认 worktree 中合成 UI 配置可运行） |
| 发现并修复 | Phase 2C 审计（服务器演练前） | 空库首次 `deploy.sh --migrate` 会在迁移前的备份步骤失败（`backup.sh` 要求 dump 含 `alembic_version` 数据；空库没有该表），Phase 1 的 e2e 只覆盖"旧 schema 有数据"的库，漏掉了这条路径。已新增 `db-state` 判定与专用首次初始化路径（见"首次初始化与普通迁移的区别"）。真实 PostGIS 上首次跑暴露了第二处：PostGIS 的复合类型 `geometry_dump`/`valid_detail` 的扩展归属记录在类型而非关系上，被误判为业务对象（方向是保守的——会拒绝而不是放行），已修正 |
| PASS | `ops-e2e.sh` 新增"首次初始化"场景（临时集群，预建 PostGIS 空库） | 空库不带 `--migrate` 被拒；有业务表的无版本库被拒且表未动；有 `alembic_version` 表但无行被拒；含其他扩展被拒；首次初始化中迁移失败整体回滚、库仍为空、无备份产生；随后用正常发布重试成功，迁移到 head 且无备份/演练；初始化后同 schema 发布无需 `--migrate`。原有 10 步（升级、备份演练、回滚拒绝、恢复回滚、冒烟失败自动返回）全部仍通过 |
| PASS | `unittest discover -s infra/native/tests` | 23 tests OK（新增 6 项 `db-state` 判定：空库、缺版本表但有对象、大对象/多余扩展、版本表无行/多行、有版本表时不被重新标为空） |
| 发现并修复 | e2e 首轮 | `deploy.sh` 的 EXIT trap 在成功时返回非零，会使成功部署被报告为失败；已修复并重跑通过。回滚的首版先重命名现网库再建新库，建库失败会留下无库状态；已改为"旁路恢复并核验后再改名交换" |

### Linux CI 验证（GitHub Actions，ubuntu-24.04，PR 分支 `deploy/phase1-infra`）

在 push / pull_request 触发的运行中，全部任务通过（`backend-macOS` 仅在 main 上运行，PR 中为跳过）：

| 任务 | 结果 | 范围 |
| --- | --- | --- |
| `backend` | 通过 | PGDG PostgreSQL 18 + PostGIS 隔离集群（端口 55432，`jit=off`），仅对 `TEST_DATABASE_URL` 执行 `alembic upgrade head`，`ruff check` / `ruff format --check`，`pytest`（共 625 项通过 CI；本机同一套件为 624 passed、1 skipped，CI 未单独统计跳过数，该跳过项未逐一核实） |
| `frontend` | 通过 | `pnpm test`、`pnpm check`、`pnpm build` |
| `frontend-ui` | 通过 | 合成 API + Chrome，167 项通过 |
| `infra` | 通过 | shellcheck、ops 单元测试、Caddy validate、`systemd-analyze verify`、Linux 上 `--require-hashes` 安装、构建发布包、`ops-e2e.sh` 全部 10 步、上传 tarball |

CI 暴露的问题与根因（均已修复，且没有跳过、没有加长超时、没有放宽断言）：

- **测试库未迁移**：多数集成用例默认库已迁移，CI 的空集群没有；加入对隔离测试库的 `alembic upgrade head`。
- **PostgreSQL JIT**：PGDG 构建带 LLVM，首次执行昂贵的 PostGIS 查询时 JIT 编译会拖慢到超过 3 秒语句超时（Homebrew 构建无 LLVM，所以本机不复现）。CI 集群与生产建议均设 `jit=off`；设置后两个只在 Linux 失败的计时用例通过。
- **UI 测试的同步问题（仅测试文件）**：玻璃按钮在入场动画中量取位置；嵌套月份/年份下拉的箭头按钮覆盖下拉框右侧，Linux 字体更窄时中心点被拦截（两处点击改为点标签区）；城市定位还原的地图截图比较时包含了玻璃控件边缘（比较时隐藏地图控件）。
- **脚本问题**：`tar -tzf | head -1` 在 `pipefail` 下因 SIGPIPE 失败（改为 `sed` 读完整输出）；shellcheck 的 SC2015；runner 缺少 `/usr/bin/node`（仅影响 systemd verify，CI 中补链接）。

已知未消除的不确定性：`frontend-ui` 中的 `basemaps.spec.ts` 长用例（本机约 15 秒）曾在一次运行中触发 30 秒超时，其余运行均通过；未定位到具体步骤，视为 runner 负载抖动，若复现需单独调查。

### 未运行 / 无法验证

- Linux 上的 `systemd-analyze verify`、`caddy validate`、PGDG 安装、`--require-hashes` 安装和 e2e 已由 CI 覆盖（见上）。但 e2e 仍用 shim 替代 `systemctl`/`runuser`/`chown`，**真实 systemd 单元启动、真实 `runuser` 与角色所有权路径未在真实服务器上演练**。
- 未验证：restic 异地上传与取回、`HEALTHCHECK_URL` 心跳、`runnote-backup.timer` 实际触发、真实域名下 HTTPS/Cookie/Origin/CSRF、CSP Report-Only 在真实页面的违规情况、`statement_timeout=3s` 对大 GPX 导入在目标规格上的影响。
- 本地 `tests/ops-e2e.sh` 用 `postgres` 超级用户和 `DB_OWNER=postgres`；真实服务器上的 `runnote` 角色所有权调整只在脚本里写了，未在真实角色上演练。
- CI 动作按当时 `v4`/`v5` 标签解析到的 commit SHA 固定（来自 GitHub API），上游已有更新主版本（checkout v7 等），升级需单独评估。

## 改动范围与保留行为

- 新增/修改：`infra/native/`、两个 UI 测试文件的同步修正（`frontend/tests/ui/liquid-glass.spec.ts`、`footprints.spec.ts`，仅测试）、`.github/scripts/annotate_failures.py`、（单元、Caddyfile、`env/`、`ops/`、`tests/`、README）、`.github/workflows/ci.yml`、本文档与设计/计划文档、`README.md`/`AGENTS.md` 的指引。
- 未改：`backend/`、`frontend/` 业务源码，数据库 schema，迁移，现有 API，`backend.command`（仍是本地开发脚本）、`compose.dev.yml`（已停用）。
- 本阶段**未实现自动 CD**（无 SSH 部署 job）；`build-release.sh` 与 `deploy.sh` 已把部署做成可手动、可审阅的两步。

## 已知待办（未在本分支处理）

- **认证身份锁**：`require_identity` 对每个认证请求（含纯读）执行 `SELECT … FOR UPDATE` 并持有到请求提交；实测同一用户的读请求在另一个慢读期间被阻塞（空闲 16 ms → 约 1.8 s），持锁超过 3 秒的语句超时即报错。拟议方案为仅对纯读路径去掉行锁、写路径保留，并补并发回归测试；这是业务代码改动，需独立分支与确认，**未在本分支实施**。
