# 第二阶段实际开发进度

日期：2026-10-12。**S2-01、S2-02 已完成本步本地验收；S2-03 至 S2-08 未开始。** 实施依据为 [第二阶段计划](08-phase-two-implementation-plan.md#s2-01冻结规则依赖和测试环境)。原计划保留规划时的未完成复选框，本文件记录实际状态，不将准备或存储层工作写成整阶段业务完成。

## S2-01 执行前检查与范围（历史记录）

- 已阅读 README、docs/01–08 和现有配置、健康检查、数据库连接及测试；仓库和已检查的上级路径未发现 AGENTS.md。
- 当前分支 main；阶段一基线 HEAD 与本地 origin/main 均为 `0fece5be8b2aed3e4c146d4f6e73f7928f53324b`（`chore: complete phase one project setup`）。未联网刷新远端引用，不宣称远端最新状态。
- 开始前 README、docs/05 已有修改，docs/08 已存在且未跟踪。保留这些工作；本步仅在 README 增加进度导航和新测试说明，未改 docs/05、docs/08。
- 只读核对开发库：`127.0.0.1:5432/running_note`，PostgreSQL 18.6（Homebrew）、PostGIS 3.6.4、Alembic `0001_postgis`。测试后开发库仍只有 public 下 `alembic_version`、`spatial_ref_sys`，版本未变。
- 使用已有独立库 `running_note_phase_one_test`，同一 PostgreSQL 服务、不同数据库。连接角色为现有 run_note；本步没有创建迁移角色或更改角色权限。当前测试只运行已有阶段一迁移，后续新增 DDL 须另行核对迁移权限。
- 未覆盖真实 .env；未删除、重建或清空数据库，未更改数据库服务配置。无新增迁移、模型、业务接口、前端功能或服务启动。
- 顺序依赖保持为 S2-01 准备 → S2-02 模型/迁移 → S2-03 认证 → S2-04 解析 → S2-05 指标/指纹 → S2-06 导入/归属 → S2-07 前端 → S2-08 整阶段验收。本次止于第一步。

## S2-01 实现与验收

| 计划要求 | 实际结果 | 状态 |
| --- | --- | --- |
| 黄金样本覆盖第9节所有分类，规则可追溯 | 41 个静态合成 GPX、7 个大输入配方、17 个后续验收情景；覆盖空间、时间、异常、安全、指纹、认证、并发、迁移和浏览器分类 | PASS：准备层 |
| 冻结算法/canonical/时间规则 | [样本规则](../backend/tests/fixtures/gpx/README.md)明确 parser、metrics、fingerprint 版本、精确序列化、距离模型及独立预期 | PASS |
| .venv 兼容依赖及 hash lock | 6 个直接依赖精确锁定，安装共46包；原锁中的包版本全部保留，新增10包（含4个传递依赖）；兼容检查通过 | PASS |
| 显式独立测试目标，误指开发库在 DDL 前拒绝 | 会话级 autouse 守卫先校验 DSN，再只读校验实际库名/端口；17项测试含4个真实 pytest 子进程的 DDL 前拒绝场景 | PASS |
| 真实空间测试不得 skip | 全部后端34项通过，其中3项在真实独立 PostGIS 库运行，0 skip | PASS |

上述 PASS 不表示用户认证、GPX 解析、Haversine、业务指纹或持久化已经实现。manifest 的 expected 是后续验收目标，其文件 SHA-256 只校验测试输入完整性。

### 规则与样本

冻结 parser=`gpx-parser-v1`、metrics=`gpx-v1`、fingerprint=`canonical-v1`。权威距离仍为 PostGIS WGS84 geography，Haversine 为独立球面对照。总耗时含暂停/段间间隔；不完整或无效时间不产生伪精确配速。保留源段边界，异常坐标前后断开；NULL 时间不构成可信重复点，跨 NULL 的可信时间倒退仍判 invalid。

canonical 在清洗前保留源 tracks/segments/点序，坐标7位、UTC毫秒 half-even、固定紧凑 UTF-8 JSON，加版本前缀后哈希；不包含高程/文件名/元数据。完整细则和容差见样本 README。写业务模型前需同步 docs/03 的旧重复点细则；该同步已在 S2-02 完成。

普通样本仅使用合成坐标和时间。大输入由测试辅助生成器创建，覆盖50000/50001点、1000/1001段、10MiB精确/超限与深XML；不提交大文件。6项生成器测试验证实际数量/字节边界，不代替未来解析器测试。深XML不能保证必定耗时15秒，后续超时验证仍需可控故障注入。

### 依赖核实

环境：Python 3.12.15、原有 backend/.venv；本机 pnpm 12.11.2，前端依赖/锁未变。

| 新增直接依赖 | 锁定版本 | 明确用途 |
| --- | --- | --- |
| gpxpy | 1.6.2 | 后续GPX对象解析 |
| defusedxml | 0.7.1 | 后续安全XML预检 |
| argon2-cffi | 25.1.0 | 后续Argon2id密码哈希 |
| GeoAlchemy2 | 0.20.0 | 后续SQLAlchemy空间字段 |
| python-multipart | 0.0.32 | 后续FastAPI上传 |
| email-validator | 2.3.0 | 后续Pydantic邮箱校验 |

已核实包版本、安装兼容性及基本功能：实际哈希/验证、安全XML实体拒绝、六点GPX读取、EmailStr和空间类型构建等。未引入 Shapely、容器或新服务。锁生成与同步实际命令（backend 目录）：

```bash
UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip compile pyproject.toml --extra dev --python .venv/bin/python --generate-hashes --output-file requirements.lock --quiet
UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip sync requirements.lock --python .venv/bin/python
UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip check --python .venv/bin/python
```

uv 缓存路径是本次沙箱可写临时路径，不是部署要求。原默认缓存访问受限，改用可写缓存后执行成功。

### 测试库安全边界

`IntegrationSettings` 独立于运行应用的 Settings。测试URL必须为 PostgreSQL psycopg、包含host/user/database、数据库名以 `_test` 结尾，并显式匹配 `TEST_DATABASE_ALLOWED_TARGETS` 的 `host:port/database`。保守要求库名不同于开发库名，即使改别名、角色、主机或端口也拒绝同名目标；连接query覆盖参数一律拒绝。缺失测试DSN时旧集成测试会跳过，不能算数据库验收成功。

有 integration 标记的测试运行时，会话级 autouse fixture 在模块/会话迁移 fixture 前执行，只读连接确认 `current_database()` 和服务端口，连接/语句限时3秒，错误不包含凭据。单元测试包括常见误配置，以及模块/会话级DDL哨兵证明误指 `running_note` 或同名 `_test` 库被提前拒绝。TDD过程中先观察到缺少校验/守卫导致失败，再实现并回归通过。

CI原先开发/测试DSN相同，新守卫会拒绝；因此仅将临时原生集群的开发库改为 `run_note_ci`，保留独立 `run_note_test` 并配置允许目标。该调整为新安全标准的必要适配，不部署或操作本机服务。

## 运行测试

需先按 README 准备独立测试库和 PostGIS。以下命令仅在进程环境注入测试变量，读取现有 .env，不写回文件；不要改成开发库名称。backend 目录实际执行：

```bash
.venv/bin/python - <<'PY'
import os
import subprocess
from sqlalchemy.engine import make_url
from app.core.config import Settings

url = make_url(Settings().database_url).set(database="running_note_phase_one_test")
env = {
    **os.environ,
    "TEST_DATABASE_URL": url.render_as_string(hide_password=False),
    "TEST_DATABASE_ALLOWED_TARGETS": f"{url.host}:{url.port or 5432}/{url.database}",
}
raise SystemExit(subprocess.run([".venv/bin/pytest", "-q", "--tb=short"], env=env).returncode)
PY
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
UV_CACHE_DIR=/private/tmp/run-note-uv-cache uv pip check --python .venv/bin/python
```

此脚本适用于本机已确认的 IPv4 目标。不要打印 env/明文DSN。集成 fixture 使用其测试URL执行已有 `alembic upgrade head`，本次测试库已在 `0001_postgis`，无新版本或业务表变更。

| 实际检查命令/操作 | 结果 |
| --- | --- |
| `pytest -q --tb=short`（上述独立库环境） | 34 passed，0 skipped；31单元（原8+安全17+生成器6），3真实DB集成 |
| `ruff check app migrations tests` | All checks passed |
| `ruff format --check app migrations tests` | 28 files already formatted |
| `uv pip check --python .venv/bin/python`（临时缓存） | 46 packages，全部兼容 |
| frontend：`pnpm test` | 5 passed |
| frontend：`pnpm check` | 0 errors，0 warnings |
| frontend：`pnpm build` | 成功，adapter-node；仅颜色环境变量提示 |
| backend：`alembic upgrade head --sql` | 已审阅，仅阶段一 Alembic/PostGIS初始化SQL，无DROP；未对开发库执行 |
| 只读查询开发库version/extversion/revision/public表 | PG18.6、PostGIS3.6.4、0001_postgis，表结构未变 |
| 样本manifest/静态GPX哈希与安全XML、CI YAML/10段shell语法 | 通过；恶意实体样本被拒绝 |
| 修改文档的本地文件链接/代码围栏、`git diff --check` | 通过；受保护文件哈希一致，原锁版本保留 |

后端没有另行配置静态类型检查器，本次执行现有 Ruff 和测试，不将其冒称 Python 静态类型检查。前端类型检查已执行。

## 文件变更

修改：

- `backend/pyproject.toml`、`backend/requirements.lock`：新增有明确用途的依赖及带hash锁。
- `backend/app/core/config.py`：新增独立集成测试目标配置校验。
- `.env.example`：只新增测试目标允许列表说明/空变量。
- `.github/workflows/ci.yml`：分开CI临时开发/测试库并配置允许目标。
- `README.md`：进度导航、安全测试配置和运行记录链接，保留原有修改。

新增：

- `backend/tests/conftest.py`：DDL前安全守卫。
- `backend/tests/unit/test_test_database_safety.py`、`test_fixture_generation.py`：安全与生成器测试。
- `backend/tests/fixtures/gpx/README.md`、`manifest.json`、`generate_limits.py` 及41个 `.gpx`：规则/预期/合成输入；完整样本文件名见manifest。
- `docs/09-phase-two-progress.md`：本实施与验收记录。

已有 dirty 的 docs/05、未跟踪的 docs/08 不是本次改写的文件。真实 .env、docs/05、docs/08 和历史 infra/compose.dev.yml 与任务开始哈希一致；历史容器文件未使用或删除。未提交或推送Git。

## 未验证与后续边界

- 本段为 S2-01 当时边界；S2-02 模型/迁移结果见下节。S2-03 至 S2-08 仍未开始，认证/上传/解析/指标/指纹/导入事务均未实现，不宣称整阶段通过。
- 黄金预期尚未用于不存在的业务模块；15秒子进程deadline、并发隔离、50k点导入性能等留对应步骤验证。
- 远程GitHub CI只核对配置与shell语法，未触发实际运行；未在全新机器完整复现锁安装。
- 本步无UI功能变更，未重跑浏览器E2E，也未启动前后端服务做浏览器联调；真实健康API已通过既有TestClient+独立PostGIS集成回归。
- 不自动执行第二个步骤、数据库迁移发布、部署或Git提交。


## S2-02：新增模型、迁移和 ready 回归

日期：2026-10-12。状态：**PASS，本步本地验收完成**。未执行开发库升级，不自动开始 S2-03。

### 执行前检查与数据库隔离

- 开始时 `git status --short --branch` 为干净的 `main...origin/main`。S2-01 已在本地提交 `bcfd14d`（`test: establish phase two fixtures and safety guards`）；本次不存在未提交的 S2-01 变更。未刷新远端引用，未提交或推送。
- 只读确认开发库目标 `127.0.0.1:5432/running_note`，角色 `run_note` 无 CREATEDB、无超级用户权限；public 只有 `alembic_version`、`spatial_ref_sys`，revision 为 `0001_postgis`。
- 使用 Homebrew PostgreSQL 18 的 `pg_dump -Fc` 只读备份阶段一开发库，再用原生 `initdb` / `pg_ctl` 在临时目录建立独立实例，监听 `127.0.0.1:55439`，不操作日常实例。测试管理员只属于临时实例，没有修改日常角色或权限。
- 空库 `runnote_s2_empty_test` 用于红绿验证；另建 `runnote_s2_fresh_test`（预检 public 表为空）实际验证从零升级。`runnote_s2_snapshot_test` 从上述 dump 以 `pg_restore --no-owner --no-privileges` 恢复，升级前添加合成旧表 `legacy_sentinel`，验证旧表数据保留。
- 所有目标均以 `_test` 结尾，通过 S2-01 的 `IntegrationSettings`、允许列表与 DDL 前只读身份守卫。第二个快照目标也独立校验允许列表及实际库名/端口。测试不执行 downgrade、DROP、TRUNCATE 或重建已有数据库；约束/旧版本场景只在可回滚测试事务中修改合成记录。
- 离线 SQL 已人工审阅：从 `0001_postgis` 开始只新增七张业务表及约束/索引，更新 Alembic 元数据；无删除或修改旧业务表、无删除扩展。新迁移的 downgrade 明确会删除第二阶段数据，只保留标准迁移定义，本次从未执行。
- `.env`、依赖及锁、GPX 样本、前端、CI、数据库服务配置保持不变；没有使用 Docker、启动应用服务或执行开发库迁移。

### 实现

- `0001_postgis → 0002_auth → 0003_gpx_storage` 为唯一迁移链。前者新增 users / auth_sessions / auth_rate_buckets，后者新增 activities / gpx_imports / activity_segments / activity_points。
- 模型采用现有共享 `db.base.Base`，由 `models/__init__.py` 汇总并在应用创建时加载，避免独立导入段模型时外键目标未注册。使用 UUID、timestamptz、numeric(12,3)、JSONB、bytea 及固定 SRID 4326 的二维 Point / LineString。
- 约束覆盖身份/会话唯一值、非负计数、分类及有限非负指标、时序/配速的基本跨字段一致性、原文字节数/10 MiB上限、用户内 raw 唯一、非空 canonical 的用户/规则版本内部分唯一、来源 owner 的复合外键、段序唯一及点复合主键。
- 空几何、错误类型/SRID、越界坐标被拒绝；单点段 geom=NULL，双点同位置的零长度线允许保存。仅段线建 GiST，点不建空间索引。段内连续序、点表总数和派生线点序一致性仍由后续导入服务保证，不宣称跨行 CHECK 已解决。
- 保留 NULL 时间/高程及点时间微秒精度；原文模型默认 deferred，未来摘要查询还必须使用响应字段白名单。本步没有解析、计算指标、认证、导入或公开接口。
- `db/schema.py` 从发布包 migrations 发现唯一 Alembic head；无 head 或多 head 拒绝应用创建。期望 revision 缓存在 app.state；ready 要求数据库所有 revision 行恰好等于该唯一 head，拒绝旧值、未知值、空集和多行。live 不访问数据库。
- Alembic 注册完整 metadata，autogenerate 只管理默认 schema 下的已声明表，过滤 PostGIS 自带对象及未知旧表。迁移语句预算60秒、锁等待5秒，避免沿用 API 的3秒预算或无限等待 DDL 锁。
- 同步 docs/03 已冻结的 NULL 重复点、跨 NULL 时间倒退规则及 `csrf-ip` scope 描述，没有修改 S2-01 的规则版本或预期样本。

### 测试过程与结果

先写独立预期：新增 schema 单元测试出现5项预期失败；两条真实升级路径出现新 head 缺失、旧 ready 返回200的预期失败。离线检查修正生成代码缺少 JSONB 导入；后续冻结六点样本的 ORM 保存测试暴露完整 metadata 未在应用创建时加载，修正后全量回归通过。

测试运行在 backend 目录，测试变量只注入进程环境，开发 DATABASE_URL 仍读取现有 `.env`。本次原生临时实例存活期间的全量命令：

```bash
TEST_DATABASE_URL=postgresql+psycopg://s2_admin@127.0.0.1:55439/runnote_s2_empty_test \
TEST_SNAPSHOT_DATABASE_URL=postgresql+psycopg://s2_admin@127.0.0.1:55439/runnote_s2_snapshot_test \
TEST_DATABASE_ALLOWED_TARGETS=127.0.0.1:55439/runnote_s2_empty_test,127.0.0.1:55439/runnote_s2_snapshot_test \
.venv/bin/pytest -q --tb=short tests/integration/test_migrations.py tests/unit tests/integration/test_database.py
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
.venv/bin/alembic upgrade head --sql
```

全新空库验证时将主测试目标及允许列表中的 `runnote_s2_empty_test` 换成 `runnote_s2_fresh_test`。缺少任一隔离目标导致 skip 不算迁移验收通过。临时实例完成后已用仅指向本次 data 目录的 `pg_ctl -w -m fast stop` 停止，`lsof -nP -iTCP:55439 -sTCP:LISTEN` 无监听；复跑需重新准备明确允许的隔离库；不要把命令改指开发库。迁移测试接受已在 head 的测试库以便回归，但从零/旧 revision 路径的首次验证必须使用新空库/阶段一恢复副本。

| 检查 | 实际结果 |
| --- | --- |
| 全部后端测试 | 74 passed，0 failed，0 skipped：36单元、38真实PostGIS集成 |
| Ruff check | All checks passed |
| Ruff format --check | 41 files already formatted |
| 两个升级目标 `alembic check` | 无新增 autogenerate 操作；包含旧哨兵表时亦通过 |
| 空库/快照升级与重复 upgrade | 新 head 正确；重复 upgrade 的 public 对象 OID/名称摘要不变 |
| 阶段一旧表/PostGIS数据 | 哨兵值保留；全部 spatial_ref_sys 的排序内容 MD5 保持一致 |
| 存储边界与正常场景 | owner FK、raw/canonical唯一、NULL canonical跨行、坐标/SRID/类型、原文字节、指标及段计数异常被拒绝；匿名会话、默认私有、单点/零长线和微秒时间可存 |
| S2-01 `equator-six.gpx` 存储 | 源序和段内序0–5、经纬度、NULL高程及 geography 1113.194908m独立参考通过；不等于解析/指标服务已实现 |
| ready/live | 旧/未知/空/多行 revision：ready503；head：ready200；live200 |
| 前端 test/check/build | NOT RUN：本步无前端变更；S2-01的5项历史通过记录仍保留 |

### 对照 S2-02 验收

| 既定验收要求 | 结果 |
| --- | --- |
| 隔离空库与阶段一快照两种路径升级到 head | PASS：全新空库和实际 dump 恢复副本均到0003_gpx_storage |
| 重复 upgrade 无变化 | PASS：两种路径复跑，public对象摘要无变化 |
| 旧表数据/空间参考保留 | PASS：旧表哨兵及完整空间参考摘要保留 |
| 错误 SRID / owner FK / 唯一指纹受约束 | PASS：真实DB拒绝错误写入；跨用户同指纹和NULL canonical可保存 |
| 旧 revision ready503、升级后200、live不受影响 | PASS：真实PostGIS + TestClient验证，额外覆盖空/多行/未知revision |

### 实际文件变更与边界

新增：

- `backend/app/modules/users/{__init__.py,model.py}`、`auth/{__init__.py,model.py}`、`activities/{__init__.py,model.py}`、`gpx/{__init__.py,model.py}`。
- `backend/app/db/schema.py`。
- `backend/migrations/versions/0002_auth.py`、`0003_gpx_storage.py`。
- `backend/tests/unit/test_schema.py`、`backend/tests/integration/test_migrations.py`。

修改：

- `backend/app/models/__init__.py`、`backend/app/main.py`：完整注册与发布head缓存。
- `backend/app/modules/health/service.py`、`router.py`：精确revision校验，保持API响应格式。
- `backend/migrations/env.py`：metadata注册、autogenerate过滤和有界DDL预算。
- `backend/tests/integration/test_database.py`：回归基准改为新发布head。
- `docs/03-database-and-gpx.md`：同步S2-01冻结细则；本文件：记录S2-02结果。

最终只读复核：开发库与恢复升级副本均为 PostgreSQL 18.6 / PostGIS 3.6.4；`spatial_ref_sys` 均8500行，完整排序内容 MD5 均为 `4ab5e67a617dc441caefce6ae9ccdc4c`。临时实例数据/备份保留在 `/private/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-lvn7zll3`，未删除备份。

**部署边界**：开发库最终仍为 `0001_postgis`，仅有阶段一两张表。若现在启动新版后端并指向该库，ready503是本计划要求的版本不匹配行为；本次没有启动新版服务或对开发库升级。目标库正式升级、Linux/远程CI、重启持久化及整阶段验收尚未验证，留S2-08；S2-03认证及后续逻辑未开发。


## S2-02 本地开发环境收尾：预检停止

日期：2026-10-12。状态：**历史 BLOCKED：当时实际开发库 revision 与给定基线不符，后续操作停止；用户随后确认新基线，本阻断已解除，最终收尾结果见下节**。本节为当前只读观察；前文 `0001_postgis` 是上一轮任务结束时的历史记录。

- 已重新阅读 docs/08、docs/09，检查 Git 工作区。已有 S2-02 模型/迁移/测试及文档改动均保留；本次仅追加本进度记录，未改业务代码、迁移或 `.env`。
- `.env` 的 DATABASE_URL 与进程 Settings 一致（未输出密码），配置目标为 `127.0.0.1:5432/running_note`、角色 `run_note`、development 模式，无连接 query 覆盖。
- 真实只读身份：`current_database()=running_note`、`current_user=run_note`、`inet_server_addr()=127.0.0.1/32`、`inet_server_port()=5432`；PostgreSQL 18.6（Homebrew）、PostGIS 3.6.4。
- 预检原期望 `0001_postgis`，但 `SELECT version_num FROM alembic_version` 实际只有 `0003_gpx_storage`。随后只读复核 `alembic heads`、`alembic current` 均为 `0003_gpx_storage (head)`。并未由本次执行迁移，不推断此前升级的来源、时间或验收结果。
- public 当前已有全部七张业务表：users、auth_sessions、auth_rate_buckets、activities、gpx_imports、activity_segments、activity_points；另有 alembic_version、spatial_ref_sys。核对时无其他数据库连接。
- 两个迁移已审阅：upgrade 的 Alembic 操作仅 create_table、create_index 及约束命名辅助 f；没有 DROP TABLE、DROP COLUMN、数据清空或其他破坏性 upgrade 操作。downgrade 中确实存在 drop_table，本次不会执行。离线 SQL 审阅步骤尚未执行，不以源代码审阅冒称完整 SQL 验证。
- 按 docs/08 第10节“若实际库与预期不符立即停止”，在版本预检处停止所有后续数据库操作。没有执行 pg_dump、创建备份目录、恢复备份、upgrade、downgrade、业务约束验收或启动后端；未修改 PostgreSQL 服务配置，未连接远程生产数据库，未删除/重建数据库。

本次实际命令（backend 目录，Python查询通过 `.venv/bin/python` / SQLAlchemy读取当前 Settings；所有身份查询连接启用 `default_transaction_read_only=on`、`statement_timeout=3000`）：

```bash
git status --short --branch
.venv/bin/alembic heads
.venv/bin/alembic current
```

只读查询：

```sql
SELECT current_database(), current_user, inet_server_addr()::text,
       inet_server_port(), current_setting('server_version'),
       (SELECT extversion FROM pg_extension WHERE extname='postgis');
SELECT version_num FROM alembic_version;
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename;
SELECT application_name, state, xact_start FROM pg_stat_activity
WHERE datname=current_database() AND pid<>pg_backend_pid();
```

| 收尾项目 | 本次结果 |
| --- | --- |
| 工作区与 `.env` 保护、数据库身份核对 | PASS，实际身份为指定本机开发库 |
| 迁移 source upgrade 安全审查 | PASS，无破坏性操作；downgrade未执行 |
| 迁移前版本 | 实际0003_gpx_storage，与给定0001_postgis基线不符 |
| 项目外完整备份与有效性验证 | NOT RUN，版本预检停止后未执行 |
| 开发库 upgrade | NOT RUN，本次未迁移；观测结束时仍为0003_gpx_storage |
| 新业务外键、唯一约束、空间函数实际验收 | NOT VERIFIED，本次只核对表名与扩展版本 |
| 启动后端及 live / ready / health | NOT RUN |

需先确认此前开发库升级情况，或明确以当前已在 head 的开发库为新基线完成备份恢复验证、约束核对及健康接口验收。未提交或推送 Git，未开始 S2-03。


## S2-02 本地开发环境最终收尾验收

日期：2026-10-12（Asia/Shanghai）。状态：**PASS：当前已在 head 的开发环境收尾验收完成**。用户明确确认 `0003_gpx_storage (head)` 为新的已核实基线后继续，不再对开发库执行任何 upgrade / downgrade。本结论覆盖本步存储/备份恢复/本地健康检查，不代表第二阶段业务全部完成。

### 基线、工作区与只读检查

- 指定本地目标与实际连接一致：`127.0.0.1:5432/running_note`、角色 `run_note`、development 模式；PostgreSQL 18.6（Homebrew）、PostGIS 3.6.4。`.env` 与 Settings 的数据库URL一致，无query覆盖；未输出密码。
- 开始与结束 revision 均为 `0003_gpx_storage (head)`，代码也为唯一相同head。本次没有执行迁移，既有迁移发生时间/执行者不在本次证据范围。
- 七张业务表均已存在且目前0行；`alembic_version` 为1行，`spatial_ref_sys` 为8500行。对全部9张表核对行数及排序后的完整行JSON摘要；备份、恢复和健康请求后再次只读复核，开发库数据/列/约束/索引/几何元数据快照一致。
- 只读检查通过：5条外键（含来源owner复合FK）均含CASCADE定义，7条业务唯一约束；本次catalog查询覆盖的public表约束共105条，均已验证；段/点几何为二维LineString/Point、SRID4326。
- 必需索引已确认：会话user_id/expires_at、活动owner/date/id降序、段activity_id及geom GiST、点复合主键、raw唯一与非空canonical的用户/版本内部分唯一。没有新增点级GiST。
- 现有 `run_note` 对七张业务表均有 SELECT/INSERT/UPDATE/DELETE 权限；本次只读核对权限，不通过试写来证明权限，未增加角色权限。
- 沿用上一轮对 `0002_auth` / `0003_gpx_storage` upgrade 的源代码审阅：只有新增对象，无破坏性upgrade；本次不执行downgrade。已有未提交S2-02变更均保留，通过开始/结束文件SHA256比较确认：除本次要求更新的本进度记录外，既有tracked/untracked文件及`.env`不变。未修改业务代码、依赖或数据库服务配置。

### 项目外备份与实际恢复

备份目录：`/Users/tingchieh/Backups/RunNote/20261012T192819+0800`，目录权限0700。

自定义格式完整数据库备份：`/Users/tingchieh/Backups/RunNote/20261012T192819+0800/running_note.dump`，文件权限0600。无表/schema筛选，非schema-only或data-only。该备份为单个数据库的pg_dump，未备份全实例的全局角色/服务配置。

SHA-256：`8bc92010e5b92246774f220d5e308efddae19df869d9029504344280de74b920`。同时保留 `archive-list.txt` 与 `verification.json`，后者记录脱敏数据库身份、表行数/内容摘要、约束、列、索引、几何元数据及HTTP验收结果，不含连接密码。

- `pg_dump` 退出0；`pg_restore --list` 退出0，目录可解析且包含表/数据/约束/索引。没有仅凭文件大小或SHA256宣称可恢复。
- 在新临时目录用原生initdb / pg_ctl启动独立PostgreSQL 18.6实例，监听127.0.0.1:55441；创建新库 `runnote_s2_restore_test`，从上述归档以 `--exit-on-error --single-transaction` 实际恢复，pg_restore退出0。未覆盖任何既有数据库。
- 恢复时使用 `--no-owner --no-privileges` 将对象映射给临时实例的restore_admin角色，不在临时实例创建日常角色。因此本次证明表/数据/约束/索引/空间扩展可恢复，不宣称原owner/ACL与全局角色已复原。
- 恢复库和开发库的全部表、行数/完整行内容摘要、列类型/非空属性、索引定义、Alembic revision、geometry_columns一致。约束名称、类型、验证状态均一致。
- 初次逐字比较发现6处CHECK表达式deparse差异：数组整体转换变为逐元素转换，以及AND括号归并。对每个差异表达式分别执行只读 `EXPLAIN (FORMAT JSON,COSTS OFF)`，规范化执行计划完全相同，确认不是缺失/失效约束；未改写任一数据库的约束。其他约束定义文本一致。不能将完整查询计划在无统计信息恢复库上的差异当作约束语义差异；本次比较仅用于实际变化的6条CHECK。
- 两库均通过 `ST_Distance` / `ST_Length` geography检查：0.01°赤道距离分别为1113.19490793m与1113.1949079327358m，符合1113.194908m独立参考（误差<0.001m）。
- 验证完成后先向用户报告保留恢复库方案，再停止本次临时实例；未删除恢复库、目录或备份。恢复实例数据保留于 `/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/data`，`lsof`确认55441无监听。日常5432服务保持运行。

### 实际命令

以下为实际执行的CLI参数。备份密码仅从当前Settings注入pg_dump子进程的PGPASSWORD环境，未放命令行、文档或写回`.env`；Homebrew工具位于 `/opt/homebrew/opt/postgresql@18/bin`。source/restore catalog查询使用SQLAlchemy只读连接（`default_transaction_read_only=on`，query预算10秒），无HTTP DDL或create_all。

```bash
pg_dump -h 127.0.0.1 -p 5432 -U run_note -d running_note \
  --format=custom --file '/Users/tingchieh/Backups/RunNote/20261012T192819+0800/running_note.dump'
pg_restore --list '/Users/tingchieh/Backups/RunNote/20261012T192819+0800/running_note.dump'
initdb -D '/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/data' -A trust -U restore_admin --no-locale --encoding=UTF8
pg_ctl -D '/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/data' -l '/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/postgres.log' \
  -o '-p 55441 -k /var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/socket -h 127.0.0.1' -w start
```

只在这个独立临时实例的postgres库执行：

```sql
CREATE DATABASE runnote_s2_restore_test;
```

```bash
pg_restore -h 127.0.0.1 -p 55441 -U restore_admin \
  --dbname runnote_s2_restore_test --no-owner --no-privileges \
  --exit-on-error --single-transaction '/Users/tingchieh/Backups/RunNote/20261012T192819+0800/running_note.dump'
pg_ctl -D '/var/folders/nq/btgfkmq15c78jyqcz4zpt1lh0000gn/T/runnote-s2-restore-99m7iyh2/data' -w -m fast stop
lsof -nP -iTCP:55441 -sTCP:LISTEN
```

backend目录：

```bash
.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
.venv/bin/alembic current
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

健康接口实际用Python标准库 `urllib.request.urlopen(..., timeout=5)` 请求并解析JSON，依次请求：

```text
http://127.0.0.1:8000/api/v1/health/live
http://127.0.0.1:8000/api/v1/health/ready
http://127.0.0.1:8000/api/health
```

### 健康验收与最终状态

| 实际检查 | 结果 |
| --- | --- |
| live | HTTP200，data={"status":"ok"} |
| ready | HTTP200，status=ok、database=connected、postgis=enabled、schema=current |
| health | HTTP200，与ready相同 |
| 响应规范 | 三接口error=null，Cache-Control=no-store，X-Request-ID与meta.request_id一致 |
| 服务运行 | 本次启动Uvicorn，PID12215，127.0.0.1:8000监听；保留运行供本地开发 |
| 开发库版本/数据 | 验收前后均0003_gpx_storage；全部数据/结构只读快照一致 |
| 备份有效性 | PASS：dump退出0、list退出0、实际恢复退出0、数据与结构验收通过 |
| 本次Git提交/推送及后续开发 | 未执行；S2-03至S2-08未开始 |

仍未验证：七张业务表为空，本次未验证包含真实用户/GPX业务记录的数据恢复；原owner/ACL和全局角色恢复、恢复实例重启持久化、Linux/远程CI/HTTPS、浏览器业务联调及整阶段验收未覆盖。上一轮74项测试是此前实施证据，本次无业务代码变化，未重新运行测试或前端构建；本步以真实备份/恢复、开发库只读catalog核对和真实HTTP验收为证据。


## S2-01 / S2-02 Git 检查点

日期：2026-10-12。用户明确授权建立本地提交，不推送，不迁移，不进入S2-03。

- 分支为main。第一阶段基线 `0fece5b` 和已有S2-01提交 `bcfd14d488ccf85431e08d9f90359ecc3ba3f713` 均保留在祖先链，不reset/rebase，不重复提交S2-01。S2-01包含依赖/安全守卫/测试样本及规划文档，原有提交信息为 `test: establish phase two fixtures and safety guards`。
- 本次检查点归档S2-02的七表模型、0002/0003迁移定义、完整模型注册、唯一head/ready校验、迁移环境过滤/有界预算、对应测试、冻结规则说明和本地备份恢复/健康验收记录。未新增认证、上传、解析或其他S2-03后续功能。
- `.gitignore`补充自定义数据库归档、常见密钥格式和根/后端临时目录；14个虚拟敏感/临时路径的 `git check-ignore --no-index` 校验通过，`.env.example`仍允许跟踪。审核全部待提交文本，没有实际数据库密码、私钥/常见令牌特征、备份二进制、虚拟环境或临时检查脚本；备份继续位于项目外，不提交。
- 本轮实际检查：`git diff --check`；backend `.venv/bin/pytest -q tests/unit --tb=short`（36 passed）；`ruff check app migrations tests`通过；`ruff format --check app migrations tests`（41文件格式符合）；frontend `pnpm test`（5 passed）、`pnpm check`（0错误/警告）、`pnpm build`成功。构建只有既有NO_COLOR/FORCE_COLOR环境提示。
- 对已运行的本地后端只读HTTP复核live/ready/health：均200、error=null，live status=ok，ready/health database=connected、postgis=enabled、schema=current。
- 本轮未运行真实DB集成测试，因为现有fixtures会调用 `alembic upgrade head`，与本次“不执行数据库迁移”约束冲突。之前74项全量测试和38项真实DB集成证据仍以S2-02实施记录为准，不冒称本轮重新执行。未改PostgreSQL服务，未重新启动测试实例或恢复数据。
- 本节随本次S2-02提交归档，实际hash以 `git log` 和完成报告为准；不将尚未执行的远端push/CI写成通过。
