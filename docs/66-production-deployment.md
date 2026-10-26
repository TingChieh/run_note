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
| 发布不含迁移 | `deploy.sh <tarball>` | 校验配置 → 在最终目录解包+建 venv（并以应用用户实际执行 `uvicorn --version`）→ 比较 schema → 切软链 → 重启 → 冒烟（API ready + Node 代理可达）→ 失败且 schema 未变时自动回到上一发布 |
| 发布含迁移 | `deploy.sh --migrate <tarball>` | 先停服务 → 备份 → **真实恢复演练（行数严格相等）** → `alembic upgrade head`（单次，非每 worker）→ 切软链 → 启动 → 冒烟 |
| 忘记 `--migrate` | — | 拒绝，库与软链均不变 |
| **空库首次初始化** | `deploy.sh --migrate <tarball>` | 数据库**没有 schema**时的专用路径：停服务 → **再次确认仍为空** → `alembic upgrade head`（单次）→ 核对 revision 等于发布 head → 切软链 → 启动 → 冒烟。**不做备份与恢复演练**（没有数据可保护） |
| 空库但没带 `--migrate` | — | 拒绝，不会在普通部署中隐式建 schema |
| 库比发布新 | — | 拒绝（这是回滚，不是发布） |

保留最近 5 个**完整**发布（`KEEP_RELEASES` 可调），永不删除 `current` 与 `previous`。

#### 发布目录的生命周期

Python 虚拟环境**不可重定位**：`bin/uvicorn` 等入口脚本的第一行写死了创建时解释器的绝对路径。因此发布在**最终目录** `releases/<id>/` 内构建，之后不再移动（旧实现先在 `.partial-<id>` 里建 venv 再改名，入口脚本指向已不存在的路径，`runnote-api` 以 `203/EXEC` 启动失败；见验证记录）。

| 阶段 | 目录状态 |
| --- | --- |
| 解包、建 venv、配置与 schema 检查、（首次初始化 / 备份演练 / 迁移） | `releases/<id>/` 存在，**没有** `.deploy-complete` 标记；任何失败或中断前的错误退出都会删除它 |
| 全部检查通过，紧接着切换 `current` 之前 | `chown -R root:root`、`chmod -R go-w`，最后写入 `.deploy-complete`，并解除清理保护 |
| 之后（冒烟失败等） | 绝不删除该发布；是否回到上一发布见"回滚决策" |

没有 `.deploy-complete` 的目录**不是发布**：`deploy.sh` 遇到同名目录会拒绝并要求人工确认后删除（不会自动删除，也不会在其上覆盖）；`rollback.sh` 拒绝切换过去；保留策略不把它计入，也不会因它而淘汰完好的旧发布；冒烟失败时也不会自动"回到"这样的上一发布。如果进程被强杀（来不及清理），会留下这样的目录，这是预期的、可识别的状态。

#### 首次初始化与普通迁移的区别

| | 首次初始化（空库） | 普通迁移（已有 schema） |
| --- | --- | --- |
| 判定 | `schema_compat.py db-state` 返回 `empty` | `db-state` 返回 `revision <rev>`，且落后于发布 head |
| 备份 + 严格恢复演练 | 无（没有数据） | 有，失败则不迁移 |
| 必须 `--migrate` | 是 | 是 |
| 失败后 | Alembic 在单个事务内迁移，失败会整体回滚，库仍为空，可直接重试 | 保留迁移前备份，按"回滚决策"处理 |

`empty` 的判定很严格：**缺少 `alembic_version` 不等于空**。必须同时满足：没有 `alembic_version` 表；扩展只有 `plpgsql` 与预先创建的 `postgis`；在非系统 schema 中没有任何**非扩展成员**的表、视图、序列、复合类型、函数、类型、额外 schema 或大对象。PostGIS 自带的对象（如 `spatial_ref_sys`、`geometry_columns`、`geometry_dump`、`valid_detail`）不计入。以下情形一律拒绝，不做任何修改：已有业务对象但无版本表；有 `alembic_version` 表但没有行或有多行（迁移状态不明）；存在其他扩展；数据库版本不在本发布的迁移链中（视为回滚）。

### 同机多实例（staging + production）

一台服务器可以同时运行多套互相隔离的实例。**不带 `RUNNOTE_INSTANCE` 的一切行为与此前完全相同**（那是"旧布局"，现有 staging 就是它，不需要任何改动）；新增的实例通过一个显式的配置文件描述。

#### 为什么不用 systemd 模板单元（`%i`）
`%i` 只能原样代入一个字符串，而一个实例要同时表达"单元名 A、系统用户 B、数据库 C、目录 D"，这些命名规则不同。靠推导规则代入，"差不多对"正是一个实例读到另一个实例文件的来源。所以每个实例用**一个显式的配置文件**写出全部名字，再由 `ops/instance.py` 从 `templates/` 渲染出**具体的**单元文件。用旧布局的值渲染出来的单元与现有 `runnote-*.service` **逐字节相同**（有单元测试保证）。

#### 命名对照（注意相似拼写）

| | 旧布局（现有 staging） | production 实例 |
| --- | --- | --- |
| 配置 | 无（内置默认） | `/etc/run-note-instances/production.conf` |
| 域名 | staging.example.com | run.example.com |
| 程序目录 | `/opt/run-note` | `/opt/run-note-production` |
| 配置/密钥目录 | `/etc/run-note`（`root:runnote`） | `/etc/run-note-production`（0750 `root:run_note`） |
| 备份目录 | `/var/backups/run-note` | `/var/backups/run-note-production`（0700 postgres） |
| 系统用户/组 | `runnote` | `run_note` |
| 数据库 / 角色 | `runnote_rehearsal` / `runnote` | `run_note` / `run_note` |
| 端口（回环） | API 8000，Node 3000 | API 8100，Node 3100 |
| 单元 | `runnote-api`、`runnote-web`、`runnote-backup` | `runnote-production-api`、`-web`、`-backup` |
| 备份时间 | 03:15 UTC，随机延迟 15 分钟 | 03:15 **香港时间**（`Asia/Hong_Kong`），无随机延迟 |

`instance.py check` 拒绝与旧布局或其他实例**共享任何**目录、用户、组、数据库名、角色、端口、单元名或域名（含嵌套目录），拒绝未知/重复/缺失的键，文件名必须等于 `INSTANCE`。

#### 隔离模型
- **操作系统**：每个实例独立的系统用户和组；配置目录 `0750 root:<实例组>`，环境文件 `0640 root:<实例组>`。staging 的用户不是 `run_note` 组成员，进不了 `/etc/run-note-production`，读不到生产的数据库密码和 `AUTH_RATE_HASH_KEY`（反之亦然）。
- **数据库**：每个实例自己的角色和库，`init-instance.sh` 对新库 `REVOKE ALL … FROM PUBLIC` 后只授权给它自己的角色，所以别的角色连这个库就被拒绝。**旧布局的库保持 PostgreSQL 默认（PUBLIC 可连接）**，生产角色能连进去，但读不了它的表、也不能在其中建对象（表属主是 `runnote`）。想把旧库也收紧，需要对该库执行 `REVOKE CONNECT ON DATABASE <库> FROM PUBLIC; GRANT CONNECT ON DATABASE <库> TO runnote;`——这是对现有 staging 的改动，本阶段未做。
- **环境文件与实例绑定**：`deploy.sh` 以 `envfile.py check` 加上 `--expect-db-name/--expect-db-user/--expect-origin-host/--expect-api-port`，数据库名、登录角色、`SITE_ORIGIN` 主机、前端指向的 API 端口必须等于该实例自己的定义，否则在做任何改动前拒绝。
- **脚本上下文一致**：`deploy.sh`、`rollback.sh`、`backup.sh`、`restore-drill.sh`、`init-instance.sh`、`set-site-mode.sh` 都通过 `lib.sh` 读同一份实例定义。实例模式下**没有任何值回落到旧布局默认值**，环境里残留的 `RUNNOTE_ROOT`/`APP_USER`/`API_URL` 等与之冲突会直接报错；备份与恢复演练要求 `PGDATABASE` 等于实例的库，否则拒绝。
- **发布、备份、恢复、回滚互相独立**：各自的发布目录与 `current/previous`、各自的备份目录与保留策略、各自的部署锁；`rollback.sh` 在 production 里找不到旧布局才有的发布 id。

#### 反向代理（Caddy）
仓库 `Caddyfile` 现在由可复用片段 `(runnote_app)`（参数为 API 与 Node 上游端口）和旧布局站点块组成：旧站点（`{$RUNNOTE_DOMAIN}`，上游 8000/3000）行为不变，并在站点内 `import /etc/caddy/access.d/*.caddy`——staging 的 Basic Auth 放在这里，**只属于该站点**；其他实例的站点由 `instance.py` 渲染到 `/etc/caddy/sites.d/<实例>.caddy`（被 `import /etc/caddy/sites.d/*.caddy` 引入）。production 站点**不使用 Basic Auth**，保留应用自身的认证、CSRF、限流和（关闭的）注册。

站点有两种模式，由 `ops/set-site-mode.sh <实例> maintenance|live` 切换：
- `maintenance`：对该域名返回 503 的"即将上线"页，**不代理任何上游**；证书照常签发。随时允许。
- `live`：只有在 ① 当前发布完整（有 `.deploy-complete`）② API 与 Node 在实例端口上就绪 ③ **配置的站主账号已存在** 时才允许；生成的站点文件连同整个 Caddyfile 一起 `caddy validate`，失败则恢复原文件、不重载。

#### 发布包布局与自包含检查
运维工具**始终从解包后的发布包里运行**（不是从仓库检出里）。两种布局都受支持，`instance.py` 只根据**自身所在位置**解析模板，不依赖当前工作目录，也不写死任何主机路径：

| 布局 | 脚本 | 模板 |
| --- | --- | --- |
| 仓库（开发与测试） | `infra/native/ops/instance.py` | `infra/native/templates/` |
| 发布包（运维） | `<release>/ops/instance.py` | `<release>/infra/native/templates/` |

找不到一套**完整**的模板时拒绝，并列出查过的两个位置和缺哪些文件。`init-instance.sh` 在创建任何东西之前先把单元渲染到临时目录（预检），所以损坏的发布包或有问题的实例定义会在没有产生用户、数据库、密钥之前就被发现，而不是半途失败后留下残局。

`ops/verify-release.sh` 是每个发布包的出厂检查，`build-release.sh` 每次构建都会运行，不通过就**删除发布包**并让构建失败：
1. 部署工具需要的全部文件都在发布包里（`ops/` 全部脚本、`infra/native/` 的 Caddyfile、单元、六个模板、`production.conf.example`、环境示例、`scripts/site-owner.py`、`scripts/osm-places.py`、`scripts/backfill-place-titles.py` 等），`ops/` 的八个 shell 脚本（`bash -n`）、`ops/acceptance-check.py` 与这三个 `scripts/` 离线脚本（均用 `py_compile`）可执行且语法正确，缺失、不可执行、语法错误都会点名拒绝，Caddyfile 含 `(runnote_app)` 与 `sites.d` 导入。
2. 在**空的工作目录**里用发布包自带的 `ops/instance.py` 真实渲染：旧布局渲染结果与发布包里的现有单元逐字节一致；示例 `production.conf` 通过 `check`；production 的 `maintenance` 与 `live` 站点各渲染出完整的 5 个文件。
3. 发布包里不得有 macOS 元数据（以 `._` 开头的 AppleDouble 伴生文件、`.DS_Store`、含 NUL 字节的 `*.py`），检查分三层，任一命中都点名拒绝：(a) **在解包前**，用 Python `tarfile` 列出已完成的 tarball 的条目并检查（macOS 的 `tar -t` 会隐藏 `._*`，解包时还可能中止）；(b) 解包后再用 `find` 检查整棵树（含隐藏文件），并逐个检查 `*.py` 是否含 NUL 字节；(c) 构建端预防：`build-release.sh` 在暂存目录里删除 `._*` 与 `.DS_Store`，打包时设置 `COPYFILE_DISABLE=1`，并在 bsdtar 支持时（探测后）加 `--no-mac-metadata --no-xattrs`。起因：在 macOS 上构建时，带扩展属性（`com.apple.provenance`）的源文件会让 bsdtar 写入 `._*` 伴生文件（几乎全是 NUL），Alembic 会加载 `migrations/versions` 下的每个 `*.py`，迁移检查因 `source code string cannot contain null bytes` 失败；因为部署在切换之前就中止，生产不受影响。

`set-site-mode.sh` 另有一道前置检查：服务器上的主 Caddyfile 必须就是当前的 Run Note Caddyfile（含 `(runnote_app)` 片段并 `import <sites 目录>/*.caddy`），否则拒绝。旧版（多实例之前）的 Caddyfile 不会导入实例站点，若不拦住，"维护页"会校验通过、重载成功，却什么也不会提供。安装新 Caddyfile 时，把 staging 的 Basic Auth 片段放到 `/etc/caddy/access.d/`，先 `caddy validate` 再重载。

#### 一个新实例的初始化顺序（以 production 为例）
先把发布包解开并进入其中（`tar -xzf run-note-<id>.tar.gz && cd run-note-<id>`），下面的 `ops/…` 都指该发布包里的脚本。
1. 把 `infra/native/instances/production.conf.example` 复制为 `/etc/run-note-instances/production.conf`（root 拥有、0644，**不含密钥**），`python3 ops/instance.py check`。
2. `sudo ops/init-instance.sh production --owner-email <站主邮箱>`：创建系统用户和组、目录及权限、数据库角色与库（管理员预装 PostGIS）、三个环境文件（密钥在服务器上生成，不打印）、安装（**不启用、不启动**）systemd 单元。已有任何同名对象则拒绝，绝不覆盖。
3. 构建发布包，用发布包自带的 `ops/` 执行：`sudo env RUNNOTE_INSTANCE=production ./ops/deploy.sh --migrate run-note-<id>.tar.gz`（空库首次初始化，必须显式 `--migrate`）。
4. `sudo systemctl enable runnote-production-api runnote-production-web`；`sudo ops/set-site-mode.sh production maintenance`（域名此时只显示维护页，证书开始签发）。
5. **站主由负责人在服务器上交互式创建**（需要终端）：`cd /opt/run-note-production/current && runuser -u run_note -- backend/.venv/bin/python ops/envfile.py exec /etc/run-note-production/backend.env -- backend/.venv/bin/python scripts/site-owner.py create`。
6. 验收（在 `maintenance` 期间可通过回环或临时放开验证）：健康检查、登录、会话、CSRF、限流、合成数据功能。
7. 手动跑一次备份并核对：`sudo systemctl start runnote-production-backup.service`；确认 `/var/backups/run-note-production` 里有 dump 且演练通过；再 `sudo systemctl enable --now runnote-production-backup.timer`。
8. **上线**：`sudo ops/set-site-mode.sh production live`。站主不存在时该命令会拒绝，域名继续显示维护页。
9. **退回**：`sudo ops/set-site-mode.sh production maintenance`，即刻回到维护页，不影响数据库与服务。

**离线脚本随发布包交付**：`scripts/osm-places.py`（导入 OSM 地物）与 `scripts/backfill-place-titles.py`（补全已有跑步的地点标题，默认只预览）与 `site-owner.py` 同在 `current/scripts/`，无需手工拷贝或建符号链接。运行方式与 `site-owner.py` 相同（用法与确认提示见 docs/72）：`cd /opt/run-note-production/current && runuser -u run_note -- backend/.venv/bin/python ops/envfile.py exec /etc/run-note-production/backend.env -- backend/.venv/bin/python scripts/osm-places.py <文件.osm.pbf> --region <标签>`。脚本靠 `scripts/` 与 `backend/` 相邻来定位后端代码，因此必须从发布包内运行。注意 `backfill-place-titles.py --apply` 还需要 `--log-dir` 指向服务账号可写的私有目录（服务账号 HOME 不可写，默认日志目录建不出来），做法见 docs/72 的“在生产服务器上运行”。

日常发布、回滚、备份恢复对实例与旧布局的区别只有一个前缀：在命令前加 `RUNNOTE_INSTANCE=production`（备份定时器单元已内置）。

#### 限制与未覆盖
- 两个实例共用同一个 PostgreSQL 集群、同一个超级用户账号、同一个 Caddy 进程、同一台机器的内存与 IP；这是"隔离"而不是"独立硬件"。
- 旧布局的库保留默认的 PUBLIC 可连接（见上）。
- 退役旧布局（staging）时，需要从服务器的 `Caddyfile` 删掉旧站点块并移除 `access.d` 下的片段，同时 `systemctl disable --now runnote-api runnote-web runnote-backup.timer`；Caddyfile 里 `{$RUNNOTE_DOMAIN}` 为空会导致校验失败（旧配置继续生效，不会中断）。
- 在执行下文"异地备份"之前，该实例的备份**没有异地副本**，没有异地灾难恢复能力。

### 一键发布（`ops/ship.py`）

在**维护者的电脑上**运行，通过 SSH 驱动服务器，把已合并的 `main` 发布出去。它做的就是手工发布的那套检查，并在不满足时**拒绝**（退出码 2，服务器上什么都没动）：

```bash
infra/native/ops/ship.py --dry-run          # 只做本地检查 + 构建，不碰服务器
infra/native/ops/ship.py                    # 发布（部署前会询问确认；--yes 跳过）
infra/native/ops/ship.py --migrate          # 本次带数据库迁移时才允许
```

顺序与拒绝条件：
1. 本地工作树干净、在 `main`、与 `origin/main` 完全一致。
2. 该提交的**每个** CI job 都成功（只读调用 GitHub API，使用 git 已保存的凭据；`--wait-ci 秒数` 可等待 CI 结束）。
3. 自已部署的提交以来是否有迁移文件变化：有就必须显式加 `--migrate`，否则拒绝；已部署的提交不是目标的祖先（即这是回退而不是发布）也拒绝。
4. 构建发布包（`build-release.sh`，自带自包含检查）。
5. 上传、校验 SHA-256，并在服务器上运行 `verify-release.sh`。
6. 先做一次**带真实恢复演练的备份**（直接运行新发布包的 `ops/ship-backup.sh`，标签 `ship-<发布 id>`，**不是** `nightly`，也不触发每晚的心跳），再用新发布包自带的 `deploy.sh` 部署（`--migrate` 原样传递；`deploy.sh` 自己仍然负责迁移前备份、严格演练和失败保护）。
7. 验证：发布目录有完成标记、两个服务 active、没有旧发布的进程、回环健康检查 200、数据（活动数、用户数）没有减少、公网 HTTPS 的健康检查与页面 200，并打印回滚命令。

**配置在仓库之外，不会提交任何个人信息**：`RUNNOTE_SSH_HOST`（必填，`~/.ssh/config` 里的别名即可）、`RUNNOTE_INSTANCE`（默认 `production`）、`RUNNOTE_STAGE_DIR`（默认 `/root/run-note-stage`）、`RUNNOTE_GITHUB_REPO`（默认从 `origin` 推导），从环境变量读取，其次从 `~/.config/run-note/deploy.env`（`KEY=VALUE`）。域名、端口、路径来自服务器上的 `/etc/run-note-instances/<实例>.conf`。

它**不会**：自动触发（只在你运行时执行）、改动数据库结构（迁移只由 `deploy.sh --migrate` 完成）、碰密钥或环境文件、在失败时自动回滚数据库。回滚同 schema 的发布用 `rollback.sh previous`；涉及迁移的回滚见"回滚决策"。

### 上线验收脚本（`ops/acceptance-check.py`）

随每个发布包一起交付（`<release>/ops/acceptance-check.py`，`verify-release.sh` 会检查它在发布包里、可执行、能编译）。它以站主身份登录，导入**一条纯合成 GPX**，检查私有视图与匿名展示，删除这条记录，登出并证明旧会话已失效，共约 37 项。**可以在已经有真实数据的站点上安全运行。**

```bash
# 站点已公开（经反向代理）：
python3 ops/acceptance-check.py --base https://run.example.com --backend-env /etc/run-note-production/backend.env
# 站点故意还在维护页、未公开：直连 Node（带上代理会带的 Host / X-Forwarded-Proto / Origin）：
python3 ops/acceptance-check.py --loopback-port 3100 --domain run.example.com --backend-env /etc/run-note-production/backend.env
```
站主密码在隐藏提示里输入（自动化测试才用 `RN_ACCEPTANCE_PASSWORD`），只留在内存，不打印、不写盘；报告里只有检查项名称和 PASS/FAIL，没有 Cookie、令牌、邮箱或凭据。

对已有真实数据的安全性：
- 所有断言都限定在**探针日期 2000-01-15 / 探针年份 2000** 内，并且和导入前的**基线**比较（总数 +1、回到基线），不使用绝对数字。
- 开跑前这个日期和年份必须是空的；否则**拒绝运行（退出码 2），什么都不改**。
- 清理放在 `finally` 里，任何检查失败也会删除探针活动。
- 每次运行会让足迹快照重建两次（导入一次、删除一次）。数据量大的站点这是后台开销，不影响请求。
- 回环模式只改变**测试客户端**（允许在回环 http 上发送 Secure Cookie）；服务端的任何安全设置、CSRF、Cookie 属性都不变。
- 取 CSRF 令牌失败（例如每 IP 每小时 60 次的额度用尽，429）时，只显示状态码、错误码和 `Retry-After`，**立即停止**，不会继续发无效登录。

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
- 异地保留：每日 7、每周 4、每月 6（`restic forget --tag nightly,<库名> --group-by host --prune`，只作用于 `nightly` 标签；restic 每个周期除最新一份外还会多留最旧的一份）。本机保留 14 份夜间备份（`KEEP_NIGHTLY`）、10 份迁移前备份（`KEEP_PRE`）、10 份发布前备份（`KEEP_SHIP`）；三类按标签各自计数，互不挤占。
- 发布前备份（`ship.py` 触发，标签 `ship-<发布 id>`）：异地快照带共同标签 `ship`，上传后执行 `restic forget --tag ship,<库名> --group-by host --keep-last <KEEP_SHIP> --prune`。必须 `--group-by host`：restic 默认按 `host,paths` 分组，而每个备份的文件路径都含时间戳，默认分组下每个快照自成一组，`--keep-*` 一份都不会删。
- 手动演练：`sudo -u postgres env PGDATABASE=runnote /opt/run-note/current/ops/restore-drill.sh <dump>`。**至少每季度从异地仓库取回备份、在另一台机器上演练一次**——本机演练证明备份可用，不证明异地副本可取回。
- 备份包含全部私人数据（含精确轨迹、密码哈希、会话）：目录 0700，异地必须加密，**不得**放入仓库（`.gitignore` 已忽略 `*.dump`）。

### 异地备份（Cloudflare R2 + restic）

目的：服务器整机丢失（磁盘损坏、被入侵、误删主机）时，仍能从另一处取回数据。restic 在**本机加密后**再上传，R2 只保存密文；加密密码只在服务器上生成，**丢失即无法恢复异地备份**。

**你在 Cloudflare 一侧做的事（一次性）**
1. 注册 Cloudflare 账号，开通 R2（可能需要绑定付款方式；免费额度 10 GB-月、免出站流量，当前备份体量远低于此）。
2. 创建存储桶（例如 `run-note-backup`），**不要**开启公开访问。
3. 创建 API 令牌：R2 → Manage API Tokens → 权限选 **Object Read & Write**，范围**限定到这个存储桶**。记下 Account ID、Access Key ID、Secret Access Key（Secret 只显示一次）。

**在服务器上配置（一次性，由你本人在终端输入密钥，不经过聊天或命令行参数）**
```bash
ssh -t <服务器> 'sudo RUNNOTE_INSTANCE=production /opt/run-note-production/current/ops/offsite.sh setup'
```
它依次：询问 Account ID / 存储桶 / 访问密钥（密钥为隐藏输入）→ 在服务器生成 restic 密码（`<备份目录>/restic.password`，0600、属 postgres；**不放在 `/etc/run-note-*`**，因为该目录只有 root 和应用组能进入，夜间上传和取回验证是以 postgres 身份运行的，读不到那里的文件）→ `restic init` → **成功后**才把设置写入 `backup.env`（失败不留半成品）→ 上传首份备份 → 立即做一次**取回验证**（`verify`）→ 在终端显示一次加密密码，请存入密码管理器后回车。已配置过的实例会拒绝重复执行。

如果 `setup` 在创建仓库之后、首份备份完成之前中断，用 `offsite.sh finish` 续上（它也会把留在配置目录里的旧位置密码文件移到上述位置），不要重新 `setup`。

此后每晚的 `backup.sh` 自动上传（见上节保留策略）。

**取回验证（可随时运行，也适合放进定期检查）**
```bash
sudo RUNNOTE_INSTANCE=production /opt/run-note-production/current/ops/offsite.sh verify
```
依次做：`restic check`；最新快照不超过 36 小时（`--max-age-hours N` 调整，说明夜间上传停了）；把最新快照**从异地真实取回**到临时目录；校验 sha256；对取回的 dump 跑 `restore-drill.sh`（恢复到临时库并与现网比对，`--no-drill` 可跳过）。全部满足才退出 0，临时目录用完即删。

**已知边界**
- 服务器持有可写、可删的访问密钥：服务器若被入侵，攻击者可以删除异地副本。R2 的对象锁定/保留策略能否缓解**尚未验证**；重要时刻可再手工下载一份离线保存。
- `nightly` 快照按每日 7/每周 4/每月 6 清理，`ship` 快照保留最近 10 份；迁移前（`pre-*`）快照不会自动清理，体量很小，需要时用 `restic forget` 手工处理。
- **`nightly` 的异地清理曾经没有生效（已修复）**：旧命令用 restic 默认分组（`host,paths`），而每个备份的路径都含时间戳，每个快照自成一组，`--keep-*` 一份都不删。生产上的 dry-run 实测：12 份 nightly 分成 12 组，保留 12、删除 0；加 `--group-by host` 后保留 3、删除 9（全是 10 月 24、25 日多次发布产生的同日重复）。现已改为 `--group-by host`，上线后的第一次夜间备份会删除这批重复快照。
- 切换到 `ship-*` 标签之前（含）已经标成 `nightly` 的部署备份不会被改标签，它们会随每晚备份依次被本机保留策略挤出。
- 更换密钥或迁移到新桶：用 `setup --reconfigure --repository <新位置>` 指向一个**新的空**仓库；不会读取或改写旧仓库。

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
| PASS | 多实例：`unittest discover -s infra/native/tests` | 53 tests OK（新增 30 项）：用旧布局值渲染出的单元与现有 `runnote-*.service/.timer` **逐字节相同**；示例配置有效且与旧布局不相交；12 种与旧布局的冲突（用户、组、角色、端口、目录、单元名、库名）、嵌套目录、两实例共享端口/用户/库/域名、未知/重复/缺失键、端口越界、`..` 路径、文件名与 INSTANCE 不符、`legacy` 保留名全部被拒；渲染结果中用户、路径、端口、单元名、依赖、备份时间（`03:15:00 Asia/Hong_Kong`，无随机延迟）正确且不含旧布局名；`lib.sh` 旧布局默认值不变，实例模式下全部来自配置、环境冲突覆盖报错、未知实例不回落；`envfile.py` 的实例期望校验且不回显密码 |
| PASS | 多实例：`ops-e2e-instances.sh`（临时 PostgreSQL 集群，旧布局与 production 并行） | 共享端口/用户/库的第二实例被拒；`init-instance.sh` 创建用户、组、目录（etc 0750、环境文件 0640、备份 0700）、角色（非超级用户）、库（PostGIS 由管理员安装）、三个环境文件和单元，**不启动不启用**，生成的密钥不出现在输出或命令日志里，两实例的 `AUTH_RATE_HASH_KEY` 不同；对已有对象拒绝覆盖；legacy 角色连 production 库被拒，production 角色读不了旧库的表也不能建对象；production 环境指向旧库/旧 API 端口、环境里残留旧布局变量、在 production 上下文备份旧库、用 production 的 dump 对旧库做恢复演练，全部在改动前被拒；production 首次初始化（空库 + `--migrate`，无备份）后只重启 production 自己的两个单元，旧布局状态不变；已安装的 production 发布用真实 `uvicorn` 与 `node` 在**自己的端口**上就绪、数据库已连接；production 的失败迁移（有迁移前备份，写入自己的备份目录）不影响旧布局；两个实例各自备份到各自目录；production 回滚只在自己的发布间切换，旧布局才有的发布 id 被拒；`set-site-mode.sh` 先维护页，站主不存在时拒绝上线，Caddy 校验失败时恢复原站点且不重载，上线后站点代理自己的端口且不含 Basic Auth |
| PASS | 多实例：`caddy-instances.sh`（真实 Caddy 2.11.7 进程，高端口，沙箱目录） | staging 仍要求 Basic Auth 且只代理旧上游；production 维护页返回 503、带 Retry-After、不到达任何上游、不要求认证；上线后 production 只代理自己的上游、无需 Basic Auth、带齐安全响应头且无 `Server` 头；production 上线后 staging 仍要求 Basic Auth；伪造的 `X-Forwarded-For` 对两个站点都被真实对端地址覆盖 |
| PASS | 原有 `ops-e2e.sh`（旧布局，未改动） | 全部步骤仍通过，证明向后兼容 |
| 回归敏感性 | 变异检查 | 去掉 `lib.sh` 的环境冲突检查、去掉 `backup.sh` 的数据库守卫、去掉 `init-instance.sh` 对 PUBLIC 的 `REVOKE`，各自被对应测试发现（注意 e2e 执行的是发布包内的 `ops/`，变异后必须重新构建发布包） |
| PASS | 一键发布：`unittest discover -s infra/native/tests` | 98 tests OK（新增 22）：缺少服务器地址、不安全的主机/实例/目录值被拒；配置优先级（环境变量 > 配置文件 > 默认值）；实例定义缺键或含异常字符被拒；脏工作树、非 `main`、与 `origin/main` 不一致被拒；迁移文件变化被检出，未知或非祖先的已部署提交被拒而不是猜测；CI 全绿/跳过通过，失败、进行中、没有运行都被报告；整条流程用假服务器验证命令顺序（上传 → 备份 → 部署 → 验证）、`--dry-run` 不碰服务器、红色 CI 或缺少 `--migrate` 或已部署或未确认都在上传之前拒绝、备份失败不进入部署、部署未完成与数据减少/服务异常/公网错误都判失败并给出回滚命令；工具文本不含任何个人信息 |
| PASS | 一键发布：对真实服务器的只读演练 | 真实的本地预检、真实的 CI 读取、真实的 SSH 读取实例定义与已部署提交，在已部署的提交上按设计拒绝（"nothing to ship"），服务器无任何改动 |
| 发现并修复 | 把验收脚本整理进仓库时 | 原脚本在空站上写的断言（"列表恰好 1 项""总数回到 0""统计恰好为 1"）在已有数据的站点上不成立，而且**统计摘要接口根本不认 `year` 参数**（只认 `date_from`/`date_to`），空站上"恰好为 1"碰巧通过而掩盖了这一点。新工具改为探针日期 + 基线相对断言，摘要改用区间查询，开跑前先要求探针日期为空 |
| PASS | `acceptance-check.py`：`unittest discover -s infra/native/tests` | 76 tests OK（新增 9）：合成 GPX 格式正确且全部点在探针日期；multipart 内容；`read_kv`；用法错误（目标二选一、回环模式缺域名、公共 http 原点）被拒；回环模式带上 `Host`、`X-Forwarded-Proto: https`、不带 Basic Auth，并把 `__Host-` Secure Cookie 在回环 http 上发回；写请求带站点 Origin 与 CSRF 令牌，关闭时不带 |
| PASS | `acceptance-check.py` 在本机隔离环境、**预置 3 条活动**的站点上 | 第 4 次运行 37/37 通过，预置数据原样保留，探针日期回到空，无存活会话。（第 2 次运行曾在足迹快照一项超时 150 秒，之后三次未复现，原因未查明，属于后台 worker 的偶发时序；默认等待放宽到 180 秒，超时仍如实报 FAIL）|
| 发现并修复 | 生产初始化前的真实服务器检查 | `instance.py` 假定模板在 `ops/` 旁边的 `templates/`（仓库布局），而发布包里模板在 `infra/native/templates/`，`init-instance.sh` 与 `set-site-mode.sh` 在发布包里无法渲染。双实例 e2e 当时直接从仓库布局调用这两个脚本，所以没发现。修复：按脚本自身位置解析两种布局；`init-instance.sh` 预检；`verify-release.sh` 出厂检查；`set-site-mode.sh` 校验主 Caddyfile；e2e 改为从解包后的发布包运行 |
| PASS | 发布包布局：`unittest discover -s infra/native/tests` | 67 tests OK（新增 14）：发布包布局下从任意工作目录渲染；实例渲染 5 个文件；候选位置只由脚本位置决定；整个模板目录缺失、缺一个模板、占位符损坏、`ops/` 被移到无模板处都被拒绝并点名；第一候选不完整时落到完整的第二候选；`verify-release.sh` 接受完整发布包，缺任一必需资源（脚本、模板、示例配置、Caddyfile、单元、`site-owner.py`）、脚本不可执行或语法错误、Caddyfile 不能承载实例、旧布局渲染与现有单元不一致、文件不存在，都被拒绝并点名。这些新测试在旧版 `instance.py` 上全部失败（6 失败 + 2 报错） |
| PASS | 发布包布局：`build-release.sh` 出厂检查 | 用旧版 `instance.py` 构建时，构建在自包含检查处失败并**丢弃发布包**（目录里不留任何产物） |
| PASS | 发布包布局：`ops-e2e-instances.sh` 改为从解包后的发布包运行 | `instance.py`、`init-instance.sh`、`set-site-mode.sh`、`deploy.sh` 都取自 `tar -xzf` 解出的发布包（测试先断言发布包里模板不在 `ops/` 旁边）；模板缺失的损坏发布包在创建任何用户、目录、数据库对象之前被拒绝并点名模板；未知实例定义目录被拒且不创建目录；旧版 Caddyfile 下 `set-site-mode.sh` 被拒且不写站点文件；其余隔离步骤全部仍通过 |
| 发现并修复 | Phase 2C 真实服务器首次部署 | 首次初始化成功，但 `runnote-api` 以 `status=203/EXEC` 无法启动：`bin/uvicorn` 的 shebang 是 `#!…/releases/.partial-<id>/backend/.venv/bin/python`。根因是 venv 在 `.partial-<id>` 内创建后整个目录被 `mv` 成正式目录。迁移能成功是因为脚本用 `python -m alembic`，不经过入口脚本；Phase 1 的 e2e 用 `fake_health.py` 代替真实 API，从未执行过发布包里的 `uvicorn`。修复：在最终目录构建，完成标记 `.deploy-complete`，见"发布目录的生命周期" |
| 发现并修复 | 在 macOS 上构建的发布包部署时（生产事故） | 发布包带 126 个 `._*` AppleDouble 文件；Alembic 加载 `migrations/versions` 时报 `source code string cannot contain null bytes`，部署在切换之前中止，生产仍在上一发布（无服务器别名/域名写入仓库）。修复：构建端 `COPYFILE_DISABLE=1`、探测后加 `--no-mac-metadata --no-xattrs`、暂存目录清理；出厂检查在解包前按归档清单、解包后用 `find` 与逐文件 NUL 扫描拒绝并点名。实测：给 `migrations/versions/*.py` 加扩展属性后，旧脚本构建出含 16 个 `._` 条目的包且旧检查**通过**；新脚本构建 907 条目、`._` 为 0、解包后 0 个 `._` 文件与 0 个含 NUL 的 `.py`，新检查拒绝旧式包（16 found，点名前 3 个）。`unittest discover -s infra/native/tests` 103 tests OK；三个拒绝子用例（AppleDouble、`.DS_Store`、NUL 的 `.py`）要求输出含相对路径与数量，在去掉路径输出的 `verify-release.sh` 上失败，在旧版（`origin/main`）上 3 个子用例失败；新构建的包通过 `ops-e2e.sh`（临时 PG18 集群）。**未运行**：Linux CI 上的 GNU tar 路径、`ops-e2e-instances.sh`、`offsite-e2e.sh`、`caddy-instances.sh` |
| PASS | `ops-e2e.sh` 新增（临时集群） | 部署后断言 `uvicorn` 的 shebang 等于最终发布路径、无 `.partial` 残留、有完成标记；**用已安装发布里的真实 `uvicorn` 与 `node` 启动**，`/api/v1/health/ready` 与 Node 代理 `/api/health` 均 200；首次初始化的迁移失败后 `releases/` 为空（无半成品）；存在未完成的同名目录时 `deploy.sh` 拒绝且不删除，`rollback.sh` 拒绝切换。原有全部步骤（首次初始化各拒绝场景、升级+演练、回滚拒绝、恢复回滚、冒烟失败自动返回）仍通过 |
| 回归敏感性 | 把旧版 `deploy.sh` 放回同一套 e2e | 新测试在旧代码上失败，报出 `#!…/.partial-…` 的 shebang，证明它能抓到这个缺陷 |
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
- 未验证：真实 R2 上的 restic 上传与取回（`ops/offsite.sh` 在本地 restic 仓库上经 CI 演练，S3/R2 传输与 `AWS_DEFAULT_REGION=auto` 须在首次 `setup` 时实地确认）、`HEALTHCHECK_URL` 心跳、`runnote-backup.timer` 实际触发、真实域名下 HTTPS/Cookie/Origin/CSRF、CSP Report-Only 在真实页面的违规情况、`statement_timeout=3s` 对大 GPX 导入在目标规格上的影响。
- 本地 `tests/ops-e2e.sh` 用 `postgres` 超级用户和 `DB_OWNER=postgres`；真实服务器上的 `runnote` 角色所有权调整只在脚本里写了，未在真实角色上演练。
- CI 动作按当时 `v4`/`v5` 标签解析到的 commit SHA 固定（来自 GitHub API），上游已有更新主版本（checkout v7 等），升级需单独评估。

### 发布前备份改用 `ship-*` 标签（验证记录）

背景：`ship.py` 过去启动服务器上的备份服务，其 `ExecStart` 固定为 `--label nightly`，于是每次发布前的备份都占用 14 份夜间备份的名额；实测某天多次发布后，本机 18 份备份里 16 份来自同一天。现在 `ship.py` 直接运行已上传、已校验的新发布包里的 `ops/ship-backup.sh`，不需要改服务器上的单元文件。

| 结果 | 检查 | 实测 |
| --- | --- | --- |
| PASS | `unittest discover -s infra/native/tests` | 113 tests OK（新增 `test_backup_retention.py` 9 项与 `test_ship.py` 1 项） |
| 回归敏感性 | 把旧版 `backup.sh` 放回同一套单元测试 | 3 项失败/出错（25 次发布前备份后夜间备份被挤出；`KEEP_SHIP` 配额不存在；异地快照没有 `ship` 标签与 `--group-by host`） |
| PASS | `shellcheck -x --source-path=SCRIPTDIR infra/native/ops/*.sh infra/native/tests/*.sh` | 无输出 |
| PASS | `offsite-e2e.sh`（临时 PG18 集群 + 本地 restic 仓库）新增 5b | 连续 4 次 `ship-*` 上传（`KEEP_SHIP=2`）后异地恰好 2 份 `ship` 快照、最新一份在、`nightly` 快照数不变，随后 `offsite.sh verify` 通过 |
| PASS | `ops-e2e.sh <发布包>`（临时 PG18 集群，10 步 + 新增 5b） | 5b：先 1 次迁移前备份、2 份 nightly，再做 6 次 `ship-backup.sh`（含真实恢复演练，`KEEP_SHIP=3`）；nightly 与迁移前备份文件清单不变，`ship` 备份恰好 3 份且最新一份保留 |
| 实测 | restic 默认分组 | 4 个路径各异的快照，`forget --tag … --keep-last 2 --dry-run` 不删任何一份；加 `--group-by host` 后删除最旧 2 份（见"已知边界"） |
| **未运行** | 真实服务器上的发布、`ops-e2e-instances.sh`、`caddy-instances.sh` | 部署后的只读核对见 PR 说明 |

### 首次真实发布暴露的问题（2026-10-26）与修复

`ship.py` 首次使用 `ship-backup.sh` 发布时，在部署之前的备份步骤失败：`runuser: failed to execute /root/run-note-stage/…/rel/ops/backup.sh: Permission denied`。发布包上传在 root 家目录下（权限 700），脚本以 `postgres` 身份运行其中的 `backup.sh`，进不了该目录。线上未受影响：失败发生在 `deploy.sh` 之前，仍是上一版本，服务 active，数据与迁移版本不变，未产生备份文件。

隔离演练没有发现，因为它的上传目录不在权限 700 的目录下，且不是以 root 切换到另一个账号运行。

修复：`ship-backup.sh` 先把自己所在的 `ops/` 目录复制到 `/var/tmp` 下的私有临时目录（`RUNNOTE_TMPDIR` 可覆盖，供测试使用）并设为可读，再以 `postgres` 运行副本里的 `backup.sh`（`restore-drill.sh`、`lib.sh` 与它在同一目录），结束后删除副本，退出码保持不变。

| 结果 | 检查 | 实测 |
| --- | --- | --- |
| PASS | `unittest discover -s infra/native/tests` | 128 tests OK（新增 `ShipBackupAsDatabaseAccount` 3 项：用替身 `runuser` 模拟“其他账号必须能进入路径上每个目录并执行脚本”；覆盖从副本运行、成功后删除副本、失败时删除副本并保留退出码） |
| 回归敏感性 | 把 `ship-backup.sh` 改回直接运行上传目录里的 `backup.sh` | 3 项全部失败（`Permission denied`） |
| PASS | `shellcheck -x --source-path=SCRIPTDIR infra/native/ops/*.sh infra/native/tests/*.sh` | 无输出 |
| PASS | `ops-e2e.sh <发布包>`（修复后的提交 `1e4d133` 构建，临时 PG18 集群） | 全部步骤通过，含 5b：6 次 `ship-backup.sh` 后 nightly 与迁移前备份不变、`ship` 备份被限制为 3 份 |
| **未运行** | 真实服务器发布（以 root 经 SSH 运行）、`ops-e2e-instances.sh`、`offsite-e2e.sh`、`caddy-instances.sh` | 真实发布后的只读核对见 PR 说明 |

### 修复 `nightly` 异地清理分组（验证记录）

| 结果 | 检查 | 实测 |
| --- | --- | --- |
| 实测（生产，只读 dry-run） | `restic forget --dry-run --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 6` | 12 个分组、保留 12、删除 0（旧策略从未生效） |
| 实测（生产，只读 dry-run） | 同上加 `--group-by host` | 保留 3、删除 9；被删的 9 份是 10 月 24、25 日同日重复；每天最后一份与最近的夜间备份都在 |
| PASS | `unittest discover -s infra/native/tests` | 128 tests OK（`test_backup_retention.py` 的 nightly 断言改为精确匹配新命令） |
| PASS | `shellcheck -x --source-path=SCRIPTDIR infra/native/ops/*.sh infra/native/tests/*.sh` | 无输出 |
| PASS | `offsite-e2e.sh` 新增 5c（真实 restic 本地仓库） | 同一天 3 份 nightly（08/12/20 点）经夜间备份后剩 08、20 两份（中间一份被删） |
| 回归敏感性 | 把旧版 `backup.sh` 放回 | `offsite-e2e.sh` 在 5c 失败："left: 08 12 20" |
| **未运行** | 真实服务器发布、`ops-e2e.sh` 与其余 e2e | 本次只改 forget 命令 |

## 改动范围与保留行为

- 新增/修改（多实例）：`ops/instance.py`、`ops/init-instance.sh`、`ops/set-site-mode.sh`、`templates/`、`instances/`，以及 `lib.sh`/`deploy.sh`/`rollback.sh`/`backup.sh`/`restore-drill.sh`/`envfile.py`/`Caddyfile` 的实例上下文；
- 新增/修改：`infra/native/`、两个 UI 测试文件的同步修正（`frontend/tests/ui/liquid-glass.spec.ts`、`footprints.spec.ts`，仅测试）、`.github/scripts/annotate_failures.py`、（单元、Caddyfile、`env/`、`ops/`、`tests/`、README）、`.github/workflows/ci.yml`、本文档与设计/计划文档、`README.md`/`AGENTS.md` 的指引。
- 未改：`backend/`、`frontend/` 业务源码，数据库 schema，迁移，现有 API，`backend.command`（仍是本地开发脚本）、`compose.dev.yml`（已停用）。
- 本阶段**未实现自动 CD**（无 SSH 部署 job）；`build-release.sh` 与 `deploy.sh` 已把部署做成可手动、可审阅的两步。

## 已知待办（未在本分支处理）

- **认证身份锁**：`require_identity` 对每个认证请求（含纯读）执行 `SELECT … FOR UPDATE` 并持有到请求提交；实测同一用户的读请求在另一个慢读期间被阻塞（空闲 16 ms → 约 1.8 s），持锁超过 3 秒的语句超时即报错。拟议方案为仅对纯读路径去掉行锁、写路径保留，并补并发回归测试；这是业务代码改动，需独立分支与确认，**未在本分支实施**。
