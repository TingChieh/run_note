# 累计省份足迹按活动缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让累计省份汇总的耗时与历史长度脱钩：每条活动只做一次省份空间相交并缓存，汇总变成对小表的聚合。

**Architecture:** 新表 `activity_province_caches`（每活动一行，存省级编码数组与边界文件版本）。`province_summary` 聚合有效缓存行，并对缺失活动现场计算（GET 不写库）。足迹 worker 的扫描循环在 schema 校验通过后补算缺失行。接口与返回结构不变。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2.1（同步）、Alembic、PostgreSQL 18 + PostGIS 3.6、pytest。

设计依据：`docs/superpowers/specs/2026-10-23-province-cache-design.md`

## Global Constraints

- 代码风格 Ruff，`line-length = 100`，规则 `E,F,I,UP,B`；后端改动必须通过 `ruff check app migrations tests` 与 `ruff format --check app migrations tests`。
- 服务层是同步普通函数；常规路由用 `def`；路由在 service 之后 `db.commit()`，service 内部只用 `db.flush()`（worker 在自己的会话里 `commit()`，与既有 `snapshot.py` 一致）。
- 新模型必须注册到 `app/models/__init__.py`；UUID 主键 `default=uuid4`；用户数据表带 `user_id = ForeignKey("users.id", ondelete="CASCADE")`；时间列 `DateTime(timezone=True)` + `server_default=func.now()`；不使用 `relationship()`。
- 迁移手写，文件名与 `revision` 同为 `NNNN_snake_case`，线性 `down_revision`；降级要防御性，存在数据时 `raise RuntimeError`。
- **不在开发库或线上库执行迁移。** 所有迁移和集成测试只在独立的 `_test` 库上进行；只在进程环境注入 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS`，不修改 `.env`；不读取或输出 `.env`。运行 `alembic` 时必须在进程环境里把 `DATABASE_URL` 指向隔离库，并在运行前确认目标。
- 响应结构、接口地址、前端均不变；公共响应不得包含坐标、标题、文件名。
- 日志与标识符用英文，不记录坐标、标题或供应商原文。
- 提交与推送需要用户授权。各任务末尾的 Commit 只在已授权时执行，显式列出文件，不使用 `git add -A`。
- 验证纪律：测试必须真实执行并如实报告；集成测试被跳过不等于通过。

## File Structure

| 文件 | 责任 |
| --- | --- |
| Modify `backend/app/modules/footprints/model.py` | 新增 `ActivityProvinceCache` 模型 |
| Modify `backend/app/models/__init__.py` | 注册新模型 |
| Create `backend/migrations/versions/0014_activity_province_caches.py` | 建表与防御性降级 |
| Modify `backend/app/modules/footprints/provinces.py` | 图集版本与名称、`compute_province_codes`、`store_province_codes`、`fill_province_caches`，并把 `province_summary` 改为聚合缓存 + 现场计算缺失 |
| Modify `backend/app/modules/footprints/worker.py` | `run_scan` 末尾补算省份缓存 |
| Create `backend/tests/integration/test_province_cache.py` | 缓存行为的集成测试 |
| Create `docs/NN-province-cache.md` | 完成后的特性文档（编号现场确认） |

---

### Task 0: 准备一次性隔离测试库

**Files:** 无仓库改动；所有文件放在 scratchpad 或 `/tmp`，用完删除。

- [ ] **Step 1: 创建隔离 PostGIS 集群（仅 127.0.0.1，信任认证，端口 55477）**

```bash
S="<scratchpad 目录>"; B=/opt/homebrew/opt/postgresql@18/bin
rm -rf "$S/pg" && mkdir -p "$S/pg"
$B/initdb -D "$S/pg/data" -A trust -U bench >/dev/null
$B/pg_ctl -D "$S/pg/data" -o "-c listen_addresses=127.0.0.1 -c port=55477 -c unix_socket_directories=/tmp" -l "$S/pg/log" -w start
$B/createdb -h 127.0.0.1 -p 55477 -U bench rn_iso_test
$B/psql -h 127.0.0.1 -p 55477 -U bench -d rn_iso_test -qc "CREATE EXTENSION IF NOT EXISTS postgis;"
```

Expected: `服务器进程已经启动`，无报错。

- [ ] **Step 2: 确认迁移目标是隔离库，再迁移到当前 head**

在 `backend/` 下：

```bash
export DATABASE_URL="postgresql+psycopg://bench@127.0.0.1:55477/rn_iso_test"
.venv/bin/python -c "
from sqlalchemy.engine import make_url
from app.core.config import Settings
u = make_url(Settings().database_url); print('migration target:', u.host, u.port, u.database)"
```

Expected: `migration target: 127.0.0.1 55477 rn_iso_test`。**如果不是，立即停止。**

```bash
.venv/bin/alembic upgrade head && .venv/bin/alembic current
unset DATABASE_URL
```

Expected: 显示当前 head（本任务开始时为 `0013_backfill_distance_category`）。运行 pytest 时必须 `unset DATABASE_URL`，项目的数据库保护要求测试库名不同于 `DATABASE_URL`。

- [ ] **Step 3: 约定后续命令使用的环境变量**

```bash
export TEST_DATABASE_URL="postgresql+psycopg://bench@127.0.0.1:55477/rn_iso_test"
export TEST_DATABASE_ALLOWED_TARGETS="127.0.0.1:55477/rn_iso_test"
```

- [ ] **Step 4: 确认基线测试可在隔离库上运行**

Run: `.venv/bin/pytest tests/integration/test_province_performance.py tests/integration/test_milestones.py -q`
Expected: 3 passed。

---

### Task 1: 模型、迁移与注册

**Files:**
- Modify: `backend/app/modules/footprints/model.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/migrations/versions/0014_activity_province_caches.py`

**Interfaces:**
- Produces: `ActivityProvinceCache`（表 `activity_province_caches`，列 `id, user_id, activity_id, atlas_version, province_codes, generated_at`），供 Task 2~4 使用。

- [ ] **Step 1: 先确认下一个迁移序号**

Run: `ls backend/migrations/versions | tail -3 && .venv/bin/alembic heads`
Expected: head 为 `0013_backfill_distance_category`；若已有更高序号，把本任务的文件名、`revision` 与 `down_revision` 相应顺延。

- [ ] **Step 2: 在 `model.py` 增加模型**

在 `backend/app/modules/footprints/model.py` 的 import 里加入 `ARRAY`：

```python
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
```

在 `FootprintActivityCache` 之后加入：

```python
class ActivityProvinceCache(Base):
    """Provinces one activity passes through; a pure derivative of its stored segments."""

    __tablename__ = "activity_province_caches"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[UUID] = mapped_column()
    atlas_version: Mapped[str] = mapped_column(String(64))
    province_codes: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

- [ ] **Step 3: 注册模型**

在 `backend/app/models/__init__.py`：

```python
from app.modules.footprints.model import (
    ActivityProvinceCache,
    FootprintActivityCache,
    FootprintSnapshot,
)
```

并在 `__all__` 末尾加入 `"ActivityProvinceCache",`。

- [ ] **Step 4: 手写迁移**

创建 `backend/migrations/versions/0014_activity_province_caches.py`：

```python
"""Per-activity province derivatives for the cumulative province summary."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0014_activity_province_caches"
down_revision = "0013_backfill_distance_category"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "activity_province_caches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("atlas_version", sa.String(64), nullable=False),
        sa.Column("province_codes", ARRAY(sa.Integer()), nullable=False),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_activity_province_caches_user_id", "activity_province_caches", ["user_id"]
    )


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT 1 FROM activity_province_caches LIMIT 1"))
        .first()
        is not None
    ):
        raise RuntimeError("Refusing to drop province caches that already hold data")
    op.drop_index("ix_activity_province_caches_user_id", table_name="activity_province_caches")
    op.drop_table("activity_province_caches")
```

- [ ] **Step 5: 在隔离库上升级并核对表结构**

```bash
export DATABASE_URL="postgresql+psycopg://bench@127.0.0.1:55477/rn_iso_test"
.venv/bin/alembic upgrade head && .venv/bin/alembic current; unset DATABASE_URL
/opt/homebrew/opt/postgresql@18/bin/psql -h 127.0.0.1 -p 55477 -U bench -d rn_iso_test -c '\d activity_province_caches'
```

Expected: current 为 `0014_activity_province_caches (head)`；`\d` 显示六列、唯一约束、复合外键 `ON DELETE CASCADE`、`user_id` 索引。

- [ ] **Step 6: 迁移与模型一致性、Ruff**

Run: `.venv/bin/pytest tests/integration/test_migrations.py -q` 与 `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests`
Expected: 迁移测试通过（若其中有需要独立快照库的用例被跳过，如实记录）；Ruff 通过。

- [ ] **Step 7: Commit（仅在用户授权后）**

```bash
git add backend/app/modules/footprints/model.py backend/app/models/__init__.py backend/migrations/versions/0014_activity_province_caches.py
git commit -m "feat: add the per-activity province cache table"
```

---

### Task 2: 计算、存储与补算函数

**Files:**
- Modify: `backend/app/modules/footprints/provinces.py`
- Create: `backend/tests/integration/test_province_cache.py`

**Interfaces:**
- Consumes: `ActivityProvinceCache`（Task 1）。
- Produces（后续任务依赖这些确切名字）:
  - `atlas_version() -> str`、`province_names() -> dict[int, str]`
  - `compute_province_codes(db, owner: UUID, activity_ids: list[UUID]) -> dict[UUID, list[int]]`（每个传入的 ID 都有键，没有命中时为 `[]`，列表升序）
  - `store_province_codes(db, owner: UUID, codes: dict[UUID, list[int]]) -> None`（`ON CONFLICT (activity_id) DO UPDATE`，不 `commit`）
  - `fill_province_caches(session_factory, *, limit: int = 50, stop_event=None) -> int`（返回写入行数）

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/integration/test_province_cache.py`：

```python
"""Per-activity province cache: same answers as the live pass, without repeating it."""

from uuid import UUID

import pytest
from sqlalchemy import text

from app.modules.footprints import provinces as module
from tests.integration.test_footprints import add_activity
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration  # clients is requested by name

SHANGHAI = [(121.45, 31.20), (121.50, 31.25)]
BEIJING = [(116.30, 39.90), (116.45, 39.95)]
ABROAD = [(10.0, 50.0), (10.01, 50.01)]


def cache_rows(app, owner):
    with app.state.session_factory() as db:
        return db.scalar(
            text("SELECT count(*) FROM activity_province_caches WHERE user_id=:o"),
            {"o": UUID(owner)},
        )


def read(client, year=None):
    response = client.get("/api/v1/footprints/provinces" + (f"?year={year}" if year else ""))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def counts(data):
    return {p["code"]: p["activity_count"] for p in data["provinces"]}


def test_compute_and_fill_store_the_codes_each_activity_passes_through(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    both = add_activity(app, owner, [SHANGHAI, BEIJING], geographic=True)
    abroad = add_activity(app, owner, [ABROAD], geographic=True)
    with app.state.session_factory() as db:
        codes = module.compute_province_codes(db, UUID(owner), [UUID(both), UUID(abroad)])
    assert codes == {UUID(both): [110000, 310000], UUID(abroad): []}
    # The test database is shared, so other tests' activities may be filled as well.
    assert module.fill_province_caches(app.state.session_factory) >= 2
    assert cache_rows(app, owner) == 2
    assert module.fill_province_caches(app.state.session_factory) == 0  # nothing left to do
    with app.state.session_factory() as db:
        stored = dict(
            db.execute(
                text(
                    "SELECT activity_id, province_codes FROM activity_province_caches "
                    "WHERE user_id=:o"
                ),
                {"o": UUID(owner)},
            ).all()
        )
    assert stored == {UUID(both): [110000, 310000], UUID(abroad): []}
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py -q`
Expected: FAIL，`AttributeError: module ... has no attribute 'compute_province_codes'`。

- [ ] **Step 3: 实现**

在 `backend/app/modules/footprints/provinces.py`：

把顶部 import 区改为（在原有基础上增加 `hashlib`、`uuid4`、`func`、`insert`、`ActivityProvinceCache`、`logging`）：

```python
import hashlib
import json
import logging
from datetime import date
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.footprints.model import ActivityProvinceCache

ATLAS_FILE = Path(__file__).parent / "data/china-provinces.geojson"
FILL_BATCH = 50
logger = logging.getLogger(__name__)
```

（保留原有的 `from app.modules.footprints.service import MAX_POINTS...` 已在上一次修复中删除，不要加回。）

把原来的 `atlas()` 替换为下面这组函数（`atlas()` 的名字与返回值保持不变，别处仍在使用）：

```python
@lru_cache(maxsize=1)
def _features():
    data = json.loads(ATLAS_FILE.read_text())
    return [
        {
            "code": f["properties"]["adcode"],
            "name": f["properties"]["name"],
            "geometry": f["geometry"],
        }
        for f in data["features"]
        if f["properties"]["name"]
    ]


@lru_cache(maxsize=1)
def atlas():
    return json.dumps(_features())


@lru_cache(maxsize=1)
def atlas_version():
    """Content hash: replacing the boundary file makes every cached row outdated."""
    return hashlib.sha256(ATLAS_FILE.read_bytes()).hexdigest()[:16]


@lru_cache(maxsize=1)
def province_names():
    return {feature["code"]: feature["name"] for feature in _features()}
```

在 `province_summary` 之前加入计算与存储函数：

```python
# The same spatial rules as the original cumulative query, restricted to chosen activities.
HITS = """WITH regions AS MATERIALIZED (
    SELECT (r->>'code')::int AS code,
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r->'geometry'),4326)) AS geom
    FROM jsonb_array_elements(CAST(:atlas AS jsonb)) r
), selected AS MATERIALIZED (
    SELECT a.id AS activity_id,s.point_count,COALESCE(s.geom,p.position) AS geom
    FROM activities a JOIN activity_segments s ON s.activity_id=a.id
    LEFT JOIN activity_points p ON p.segment_id=s.id
        AND s.point_count=1 AND p.point_index=0
    WHERE a.user_id=:owner AND a.id=ANY(:ids)
), edges AS (
    SELECT s.activity_id,e.geom FROM selected s
        CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
        WHERE s.point_count>1 AND ST_XMax(Box3D(s.geom))-ST_XMin(Box3D(s.geom))>180
), routes AS MATERIALIZED (
    -- Ordinary stored segments retain every edge and gap.
    SELECT activity_id,geom FROM selected
        WHERE ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))<=180
    UNION ALL
    -- Shift individual crossing edges; shifting a whole segment can create a false
    -- 359-to-1 edge through China. The atlas is east of Greenwich.
    SELECT activity_id,CASE WHEN ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))>180
        THEN ST_ShiftLongitude(geom) ELSE geom END AS geom FROM edges
), hits AS MATERIALIZED (
    SELECT DISTINCT r.code,s.activity_id FROM regions r JOIN routes s
        ON ST_Intersects(r.geom,s.geom)
) SELECT activity_id,code FROM hits"""


def compute_province_codes(db, owner, activity_ids):
    """Province codes per activity (ascending); every requested ID gets a key."""
    result = {activity_id: [] for activity_id in activity_ids}
    if not activity_ids:
        return result
    params = {"owner": owner, "ids": list(activity_ids), "atlas": atlas()}
    for activity_id, code in db.execute(text(HITS), params):
        result[activity_id].append(code)
    return {activity_id: sorted(codes) for activity_id, codes in result.items()}


def store_province_codes(db, owner, codes):
    version = atlas_version()
    for activity_id, provinces in codes.items():
        statement = insert(ActivityProvinceCache).values(
            id=uuid4(),
            user_id=owner,
            activity_id=activity_id,
            atlas_version=version,
            province_codes=provinces,
        )
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["activity_id"],
                set_={
                    "atlas_version": version,
                    "province_codes": provinces,
                    "generated_at": func.now(),
                },
            )
        )


def fill_province_caches(session_factory, *, limit=FILL_BATCH, stop_event=None):
    """Compute rows that are missing or outdated, oldest activities first.

    Idempotent and safe across workers: a concurrent writer only overwrites with equal data.
    """
    filled = 0
    while stop_event is None or not stop_event.is_set():
        with session_factory() as db:
            db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
            rows = db.execute(
                text("""SELECT a.user_id, a.id FROM activities a
                    LEFT JOIN activity_province_caches c
                        ON c.activity_id=a.id AND c.atlas_version=:version
                    WHERE c.id IS NULL ORDER BY a.created_at, a.id LIMIT :limit"""),
                {"version": atlas_version(), "limit": limit},
            ).all()
            if not rows:
                return filled
            by_owner = {}
            for owner, activity_id in rows:
                by_owner.setdefault(owner, []).append(activity_id)
            for owner, ids in by_owner.items():
                store_province_codes(db, owner, compute_province_codes(db, owner, ids))
            db.commit()
            filled += len(rows)
    return filled
```

- [ ] **Step 4: 运行确认通过**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py tests/integration/test_milestones.py tests/integration/test_province_performance.py -q`
Expected: 全部通过（`province_summary` 尚未改动，旧测试仍走旧路径）。注意：隔离库在测试之间不清空，`fill_province_caches` 是全局补算，所以断言只针对本测试自己的用户行数。

- [ ] **Step 5: Ruff**

Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests`
Expected: 通过；若格式检查失败，运行 `.venv/bin/ruff format` 对改动文件格式化后重跑。

- [ ] **Step 6: Commit（仅在用户授权后）**

```bash
git add backend/app/modules/footprints/provinces.py backend/tests/integration/test_province_cache.py
git commit -m "feat: compute and store the provinces each activity passes through"
```

---

### Task 3: 汇总改为聚合缓存并现场计算缺失

**Files:**
- Modify: `backend/app/modules/footprints/provinces.py`（替换 `province_summary`）
- Modify: `backend/tests/integration/test_province_cache.py`（追加用例）

**Interfaces:**
- Consumes: Task 2 的 `atlas_version`、`province_names`、`compute_province_codes`。
- Produces: 行为不变的 `province_summary(db, owner, year=None)`，返回结构仍为 `{year, total: 34, activity_count, located_activity_count, provinces: [{code, name, activity_count}]}`。

- [ ] **Step 1: 追加失败的测试**

在 `test_province_cache.py` 末尾追加：

```python
def test_cached_summary_equals_the_live_one_and_skips_the_spatial_pass(clients, monkeypatch):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], day=date(2025, 3, 1), geographic=True)
    add_activity(app, owner, [SHANGHAI, BEIJING], day=date(2025, 3, 2), geographic=True)
    add_activity(app, owner, [ABROAD], day=date(2025, 3, 3), geographic=True)
    live = read(a)  # nothing cached yet: every activity is computed for the request
    assert (counts(live), live["activity_count"], live["located_activity_count"]) == (
        {310000: 2, 110000: 1},
        3,
        2,
    )
    assert [p["name"] for p in live["provinces"]] == ["北京市", "上海市"]
    assert module.fill_province_caches(app.state.session_factory) == 3

    def forbidden(*args, **kwargs):
        raise AssertionError("the spatial pass must not run when every row is cached")

    monkeypatch.setattr(module, "compute_province_codes", forbidden)
    assert read(a) == live


def test_missing_activities_are_computed_for_the_request_without_writing(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    module.fill_province_caches(app.state.session_factory)
    add_activity(app, owner, [BEIJING], geographic=True)  # imported after the last fill
    data = read(a)
    assert (counts(data), data["activity_count"], data["located_activity_count"]) == (
        {310000: 1, 110000: 1},
        2,
        2,
    )
    assert cache_rows(app, owner) == 1  # a GET never writes


def test_outdated_atlas_versions_count_as_missing_and_are_refreshed(clients, monkeypatch):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    module.fill_province_caches(app.state.session_factory)
    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activity_province_caches SET atlas_version='old'"))
    calls = []
    original = module.compute_province_codes
    monkeypatch.setattr(
        module,
        "compute_province_codes",
        lambda *args, **kwargs: calls.append(1) or original(*args, **kwargs),
    )
    assert counts(read(a)) == {310000: 1} and calls
    assert module.fill_province_caches(app.state.session_factory) == 1
    with app.state.session_factory() as db:
        versions = db.scalars(text("SELECT atlas_version FROM activity_province_caches")).all()
    assert versions == [module.atlas_version()]


def test_year_filter_and_deleted_activities(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    old = add_activity(app, owner, [SHANGHAI], day=date(2024, 6, 1), geographic=True)
    add_activity(app, owner, [BEIJING], day=date(2025, 6, 1), geographic=True)
    module.fill_province_caches(app.state.session_factory)
    data = read(a, 2025)
    assert (data["year"], data["activity_count"], counts(data)) == (2025, 1, {110000: 1})
    assert counts(read(a)) == {310000: 1, 110000: 1}
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM activities WHERE id=:id"), {"id": UUID(old)})
    assert cache_rows(app, owner) == 1  # the cache row followed its activity
    assert counts(read(a)) == {110000: 1}
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py -q`
Expected: `test_outdated_atlas_versions_count_as_missing_and_are_refreshed` FAIL：旧实现从不调用 `compute_province_codes`，所以断言里的 `calls` 为空。其余新用例在旧实现下可能通过（旧实现同样不写库、结果相同），它们的作用是在 Step 4 之后防止回归。

- [ ] **Step 3: 替换 `province_summary`**

把 `backend/app/modules/footprints/provinces.py` 里整个 `province_summary` 函数替换为：

```python
def province_summary(db, owner, year=None):
    """Aggregate cached per-activity provinces; compute live only for activities not cached."""
    params = {"owner": owner, "version": atlas_version()}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date>=:start AND a.activity_date<:end"
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        activities = db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id=:owner{date_filter}"), params
        )
        counts, located = {}, 0
        cached = db.execute(
            text(f"""SELECT c.province_codes FROM activity_province_caches c
                JOIN activities a ON a.id=c.activity_id
                WHERE c.user_id=:owner AND c.atlas_version=:version{date_filter}"""),
            params,
        ).scalars()
        for codes in cached:
            located += bool(codes)
            for code in codes:
                counts[code] = counts.get(code, 0) + 1
        missing = db.execute(
            text(f"""SELECT a.id FROM activities a
                LEFT JOIN activity_province_caches c
                    ON c.activity_id=a.id AND c.atlas_version=:version
                WHERE a.user_id=:owner AND c.id IS NULL{date_filter}"""),
            params,
        ).scalars().all()
        if missing:
            for codes in compute_province_codes(db, owner, missing).values():
                located += bool(codes)
                for code in codes:
                    counts[code] = counts.get(code, 0) + 1
        names = province_names()
        return {
            "year": year,
            "total": 34,
            "activity_count": activities,
            "located_activity_count": located,
            "provinces": [
                {"code": code, "name": names[code], "activity_count": counts[code]}
                for code in sorted(counts)
            ],
        }
    except DBAPIError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "57014":
            raise ApiError(422, "PROVINCE_LIMIT", "省份足迹计算较慢，请稍后重试") from None
        raise
```

- [ ] **Step 4: 运行确认通过**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py tests/integration/test_milestones.py tests/integration/test_province_performance.py -q`
Expected: 全部通过，包括 Step 2 里失败的那个用例。

- [ ] **Step 5: Ruff 与单元测试**

Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests && .venv/bin/pytest tests/unit -q`
Expected: 全部通过。

- [ ] **Step 6: Commit（仅在用户授权后）**

```bash
git add backend/app/modules/footprints/provinces.py backend/tests/integration/test_province_cache.py
git commit -m "perf: aggregate cached province rows for the cumulative province summary"
```

---

### Task 4: worker 补算

**Files:**
- Modify: `backend/app/modules/footprints/worker.py`
- Modify: `backend/tests/integration/test_province_cache.py`

**Interfaces:**
- Consumes: `fill_province_caches`（Task 2）。
- Produces: `run_scan` 在每次扫描末尾补算省份缓存；其返回值（已发布的足迹快照数）与既有测试保持不变。

- [ ] **Step 1: 追加失败的测试**

```python
def test_a_worker_scan_fills_missing_province_rows(clients):  # noqa: F811
    from app.modules.footprints.worker import run_scan

    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    assert cache_rows(app, owner) == 0
    run_scan(
        app.state.session_factory,
        app.state.clock(),
        app.state.expected_revision,
        limit=0,  # no snapshot work: this scan only exercises the province fill
    )
    assert cache_rows(app, owner) == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py -q -k worker_scan`
Expected: FAIL（`assert 0 == 1`）。

- [ ] **Step 3: 实现**

在 `backend/app/modules/footprints/worker.py` 的 import 区加入：

```python
from app.modules.footprints.provinces import fill_province_caches
```

在 `run_scan` 末尾、`return published` 之前加入：

```python
    try:
        fill_province_caches(session_factory, stop_event=stop_event)
    except Exception as error:
        # Reads compute missing rows themselves; the next scan retries without leaking details.
        logger.warning("Province cache fill unavailable (%s)", type(error).__name__)
```

- [ ] **Step 4: 运行确认通过，并复跑 worker 相关测试**

Run: `.venv/bin/pytest tests/integration/test_province_cache.py tests/integration/test_footprint_snapshots.py tests/unit/test_footprint_worker_wake.py -q`
Expected: 全部通过。

- [ ] **Step 5: Ruff**

Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests`
Expected: 通过。

- [ ] **Step 6: Commit（仅在用户授权后）**

```bash
git add backend/app/modules/footprints/worker.py backend/tests/integration/test_province_cache.py
git commit -m "feat: fill missing province caches from the footprint worker scan"
```

---

### Task 5: 全量验证、特性文档与清理

**Files:**
- Create: `docs/NN-province-cache.md`

- [ ] **Step 1: 全量后端测试**

Run（`backend/`，保持 Task 0 的 `TEST_*` 变量，且 `DATABASE_URL` 未设置）: `.venv/bin/pytest -q -p no:cacheprovider`
Expected: 全部通过（记录实际通过与跳过数量）；`.venv/bin/ruff check app migrations tests` 与 `.venv/bin/ruff format --check app migrations tests` 通过。

- [ ] **Step 2: 用你的量级再测一次耗时（合成数据，不连真实库）**

在隔离库里造出约 1000 条活动、约 114 万点后，比较改前（现场全量计算）与改后（全部缓存）的 `province_summary` 耗时，记录两组真实数字写入文档。若不做这一步，文档里不得写任何耗时数字。

- [ ] **Step 3: 写特性文档（中文）**

先 `ls docs | grep -E '^[0-9]+' | sort -n | tail -1` 确认最大编号，新文档用它 +1。必须包含 `## 使用方式`、`## 接口与隐私`、`## 验证记录`，并写明：上线步骤（备份 → 恢复演练 → 受控单次升级 `alembic upgrade head` → 复核；回填由 worker 自动完成，期间读取路径现场计算，行为与升级前一致）、接口与返回结构不变、缓存只含省级编码、未运行项（线上迁移、真实数据耗时、开发服务未重启）。

- [ ] **Step 4: 清理隔离集群**

```bash
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D "$S/pg/data" stop -m fast; rm -rf "$S/pg"
```

Expected: `服务器进程已经关闭`；`pgrep -fl 55477` 无输出。

- [ ] **Step 5: Commit（仅在用户授权后）**

```bash
git add docs/NN-province-cache.md
git commit -m "docs: record the per-activity province cache"
```

---

## Self-Review

- **Spec coverage:** 新表与列、级联、版本哈希（Task 1、Task 2 `atlas_version`）；读取 = 聚合缓存 + 现场计算缺失 + GET 不写库（Task 3）；稳态不再做空间计算（Task 3 第一个用例，用打桩证明）；worker 补算与幂等（Task 2 `fill_province_caches`、Task 4）；上线与回填、降级拒绝（Task 1、Task 5 文档）；错误处理——超时仍为 `PROVINCE_LIMIT`、过期版本视为缺失（Task 3 第三个用例）、补算失败只记日志（Task 4）；无轨迹或图集外活动计入总数不计入命中（Task 2、Task 3 第一个用例）；年份过滤与删除级联（Task 3 第四个用例）；返回结构不变（Task 3，前端校验的字段全部保留）。
- **Placeholder scan:** 没有 TBD/TODO；唯一待现场确定的是特性文档编号（Task 5 给了命令）与 scratchpad 路径（`<scratchpad 目录>`，执行时填入会话的 scratchpad）。
- **Type consistency:** `compute_province_codes`、`store_province_codes`、`fill_province_caches`、`atlas_version`、`province_names` 在 Task 2 定义，Task 3、4 的调用拼写一致；`ActivityProvinceCache` 的列名与迁移一致。
