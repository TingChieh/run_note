# 第二阶段实际开发进度

日期：2026-10-12。**仅 S2-01 已完成；S2-02 至 S2-08 未开始。** 实施依据为 [第二阶段计划](08-phase-two-implementation-plan.md#s2-01冻结规则依赖和测试环境)。原计划保留规划时的未完成复选框，本文件记录实际状态，不将准备工作写成整阶段业务完成。

## 执行前检查与范围

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

canonical 在清洗前保留源 tracks/segments/点序，坐标7位、UTC毫秒 half-even、固定紧凑 UTF-8 JSON，加版本前缀后哈希；不包含高程/文件名/元数据。完整细则和容差见样本 README。未来写业务模型前仍须同步 docs/03 的旧重复点细则。

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

- S2-02至S2-08未开始：认证/上传/解析/指标/指纹/事务/业务表及新增迁移均未实现，不宣称整阶段通过。
- 黄金预期尚未用于不存在的业务模块；15秒子进程deadline、并发隔离、50k点导入性能等留对应步骤验证。
- 远程GitHub CI只核对配置与shell语法，未触发实际运行；未在全新机器完整复现锁安装。
- 本步无UI功能变更，未重跑浏览器E2E，也未启动前后端服务做浏览器联调；真实健康API已通过既有TestClient+独立PostGIS集成回归。
- 不自动执行第二个步骤、数据库迁移发布、部署或Git提交。
