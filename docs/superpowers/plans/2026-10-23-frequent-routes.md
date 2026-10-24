# 常跑路线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把形状重合的多次跑步自动归为「同一条路线」，并提供列表页与详情页（次数、最佳/平均用时与配速、历次成绩趋势）。

**Architecture:** 足迹 worker 的 `run_scan` 里紧跟 `fill_province_caches` 增加 `fill_route_groups`：先为每个活动生成简化轨迹指纹（缓存表），再对每个用户按日期从旧到新用 PostGIS 50 米缓冲区覆盖率增量归类。组内不存聚合值，读取时由 SQL 聚合。后端提供工作区（`/api/v1/routes/groups*`）与展示（`/api/v1/showcase/routes/groups*`，具名版本由现有循环自动生成）只读接口；前端新增 `/routes`、`/routes/[id]`，经 `view-context` 同时服务根展示、`/workspace/*`、`/p/{username}/*`。

**Tech Stack:** FastAPI + SQLAlchemy 2.1（同步）+ PostGIS 3.6 + Alembic；SvelteKit 3 / Svelte 5 runes、maplibre-gl（复用 `RouteMap`）、echarts（复用 `trend-chart-runtime`）、Vitest、Playwright。

## Global Constraints

- 非容器化：不得引入 Docker/Compose。
- 设计文档：`docs/superpowers/specs/2026-10-23-frequent-routes-design.md`，与本计划冲突时以设计文档为准（本计划已按代码实情修正过设计文档）。
- 服务层同步普通函数；路由 `def`；路由在 service 之后 `db.commit()`，service 内用 `db.flush()`（本功能的 worker 在自己的事务里 `commit`，与 `fill_province_caches` 一致）。
- 响应信封 `envelope()` 从 `app/modules/activities/router.py` 导入，不重新定义；错误统一 `ApiError(status, "CODE", "中文提示")`；他人资源一律 404，绝不 403。
- 列表参数 `limit`(默认 20，上限 100)、`offset`(默认 0，上限 1000000)，响应 `{items, total, limit, offset}`。
- 迁移手写：下一个序号 `0015_route_groups`，`down_revision = "0014_activity_province_caches"`（动手前再 `ls backend/migrations/versions/` 确认）；降级有数据时 `raise RuntimeError`。新模型必须注册到 `app/models/__init__.py`；新 router 必须在 `app/main.py` `include_router`。
- 不使用 `relationship()`；时间列 `DateTime(timezone=True)` + `server_default=func.now()`；用户数据表有 `user_id` → `users.id` `ondelete="CASCADE"`。
- 时间一律 `request.app.state.clock()`，业务代码不调用 `datetime.now()`。
- 不在开发库执行迁移；集成测试只作用于名称以 `_test` 结尾、列入 `TEST_DATABASE_ALLOWED_TARGETS` 的库，只在进程环境注入测试变量，不修改 `.env`（做法见 `docs/09-phase-two-progress.md`“运行测试”）。测试库须先升级到新 head 才能运行集成测试，这一步需用户授权；未授权/未配置时集成用例会跳过，跳过不等于通过，必须如实报告。
- 公开数据：展示端点在 SQL 中固定 subject（站主或 `is_active AND showcase_enabled` 的用户），不接受客户端 owner；响应不含邮箱、备注、文件名、原始 GPX/TCX。
- 前端：内部导入用 `#lib/...ts`（带扩展名）；Svelte 5 runes，不用 store/`createEventDispatcher`/`$app/stores`；`maplibre-gl`、`echarts` 只能在 `onMount` 内动态导入；颜色用语义令牌；页面数据在 `onMount` 中加载，保留 `disposed` 标志与单调请求令牌，401 清除私人状态并跳转登录；`lib/api/*` 做运行时响应校验。
- 不执行 `git commit/push` 等，除非用户显式授权；计划中的 commit 步骤仅在用户授权后执行，且显式 `git add` 文件，不用 `git add -A`。工作区有他人未提交文件 `docs/superpowers/specs/2026-10-23-activity-poster-design.md`，不要动它。
- 先跑最小相关测试，最后补回归；报告“实际运行/未运行”，不引用历史计数。

## File Structure

后端（新增 `backend/app/modules/route_groups/`）：

| 文件 | 职责 |
|---|---|
| `__init__.py` | 空文件 |
| `model.py` | `RouteFingerprint`、`RouteGroup`、`RouteGroupMember` 三张表映射 |
| `groups.py` | 常量、指纹构建、归类、`fill_route_groups`（worker 调用） |
| `queries.py` | 读取用 SQL（列表/详情/building 标志） |
| `service.py` | 列表与详情的业务封装，返回 dict |
| `schema.py` | 响应模型 |
| `router.py` | 工作区只读接口 |

其他后端：`backend/migrations/versions/0015_route_groups.py`、`backend/app/models/__init__.py`（注册）、`backend/app/main.py`（`include_router`）、`backend/app/modules/footprints/worker.py`（`run_scan` 增加调用）、`backend/app/modules/showcase/router.py`（展示端点）。

前端：`frontend/src/lib/api/route-groups.ts`、`frontend/src/lib/api/view-context.ts`（路径前缀）、`frontend/src/lib/components/RouteGroupCard.svelte`、`frontend/src/lib/components/RouteGroupTrend.svelte`、`frontend/src/routes/routes/+page.svelte`、`frontend/src/routes/routes/[id]/+page.svelte` 及 `workspace/routes`、`p/[username]/routes` 的包装页、`AppNavigation.svelte`（导航入口）。

测试：`backend/tests/unit/test_route_groups_migration.py`、`backend/tests/unit/test_route_groups_units.py`、`backend/tests/integration/test_route_groups.py`、`frontend/tests/unit/route-groups.test.ts`、`frontend/tests/ui/route-groups.spec.ts`、`frontend/playwright.route-groups.config.ts`。

---

### Task 1: 数据模型与迁移

**Files:**
- Create: `backend/app/modules/route_groups/__init__.py`（空文件）
- Create: `backend/app/modules/route_groups/model.py`
- Create: `backend/migrations/versions/0015_route_groups.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/unit/test_route_groups_migration.py`

**Interfaces:**
- Produces: ORM 类 `RouteFingerprint`、`RouteGroup`、`RouteGroupMember`（表 `route_fingerprints`、`route_groups`、`route_group_members`），均已注册到 `Base.metadata`。后续任务以原始 SQL 访问这些表，列名见下方代码。

- [ ] **Step 1: 写失败的迁移单元测试**

`backend/tests/unit/test_route_groups_migration.py`：

```python
import importlib.util
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load():
    source = Path(__file__).parents[2] / "migrations/versions/0015_route_groups.py"
    spec = importlib.util.spec_from_file_location("route_groups_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ddl_matches_the_models_and_downgrade_refuses_to_drop_data(monkeypatch):
    from app.models import Base

    module = load()
    assert module.down_revision == "0014_activity_province_caches"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    for name in ("route_fingerprints", "route_groups", "route_group_members"):
        assert f"CREATE TABLE {name}" in sql
        assert all(column.name in sql for column in Base.metadata.tables[name].columns)
    assert sql.count("FOREIGN KEY(activity_id, user_id)") == 2
    assert "ix_route_fingerprints_geom" in sql and "gist" in sql
    assert "ix_route_group_members_group_id" in sql

    dropped = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert dropped == []
```

- [ ] **Step 2: 运行确认失败**

Run（工作目录 `backend/`）：`.venv/bin/pytest tests/unit/test_route_groups_migration.py -q`
Expected: FAIL（找不到 `0015_route_groups.py`）。

- [ ] **Step 3: 写模型**

`backend/app/modules/route_groups/model.py`：

```python
"""Replaceable derivatives that group an owner's runs along the same route."""

from datetime import datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RouteFingerprint(Base):
    """Simplified track of one activity; geom is NULL when it cannot take part in grouping."""

    __tablename__ = "route_fingerprints"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        Index("ix_route_fingerprints_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[UUID] = mapped_column()
    algorithm_version: Mapped[str] = mapped_column(String(32))
    geom: Mapped[WKBElement | None] = mapped_column(
        Geometry("MULTILINESTRING", srid=4326, spatial_index=False)
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteGroup(Base):
    __tablename__ = "route_groups"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    algorithm_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RouteGroupMember(Base):
    __tablename__ = "route_group_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint("coverage >= 0 AND coverage <= 1", name="coverage_range"),
        Index("ix_route_group_members_group_id", "group_id"),
    )

    activity_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[UUID] = mapped_column(ForeignKey("route_groups.id", ondelete="CASCADE"))
    coverage: Mapped[float] = mapped_column(Float)
```

创建空文件 `backend/app/modules/route_groups/__init__.py`。

- [ ] **Step 4: 写迁移**

`backend/migrations/versions/0015_route_groups.py`：

```python
"""Route fingerprints and groups for the frequent-routes summary."""

import geoalchemy2
import sqlalchemy as sa
from alembic import op

revision = "0015_route_groups"
down_revision = "0014_activity_province_caches"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "route_fingerprints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geometry(
                geometry_type="MULTILINESTRING",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeomFromEWKT",
                name="geometry",
            ),
            nullable=True,
        ),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_route_fingerprints_user_id", "route_fingerprints", ["user_id"])
    op.create_index(
        "ix_route_fingerprints_geom", "route_fingerprints", ["geom"], postgresql_using="gist"
    )
    op.create_table(
        "route_groups",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_route_groups_user_id", "route_groups", ["user_id"])
    op.create_table(
        "route_group_members",
        sa.Column("activity_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "group_id",
            sa.Uuid(),
            sa.ForeignKey("route_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("coverage", sa.Float(), nullable=False),
        sa.CheckConstraint("coverage >= 0 AND coverage <= 1", name="coverage_range"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_route_group_members_user_id", "route_group_members", ["user_id"])
    op.create_index("ix_route_group_members_group_id", "route_group_members", ["group_id"])


def downgrade():
    bind = op.get_bind()
    for table in ("route_group_members", "route_groups", "route_fingerprints"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise RuntimeError(f"Refusing to drop {table} that already holds data")
    op.drop_table("route_group_members")
    op.drop_table("route_groups")
    op.drop_table("route_fingerprints")
```

- [ ] **Step 5: 注册模型**

编辑 `backend/app/models/__init__.py`：在 `from app.modules.mifitness.model import MifitnessImport` 之后加

```python
from app.modules.route_groups.model import RouteFingerprint, RouteGroup, RouteGroupMember
```

并在 `__all__` 末尾加 `"RouteFingerprint", "RouteGroup", "RouteGroupMember",`。

- [ ] **Step 6: 运行确认通过并 lint**

Run: `.venv/bin/pytest tests/unit/test_route_groups_migration.py tests/unit/test_province_cache_migration.py -q` → PASS。
Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests` → 通过。
Run: `.venv/bin/alembic heads` → 只有一个 head `0015_route_groups`。

- [ ] **Step 7: Commit（需用户授权）**

```bash
git add backend/app/modules/route_groups/__init__.py backend/app/modules/route_groups/model.py backend/migrations/versions/0015_route_groups.py backend/app/models/__init__.py backend/tests/unit/test_route_groups_migration.py
git commit -m "feat: add route fingerprint and group tables"
```

---

### Task 2: 指纹构建与归类（含 worker 接入）

**Files:**
- Create: `backend/app/modules/route_groups/groups.py`
- Modify: `backend/app/modules/footprints/worker.py:77-88`（`run_scan` 末尾，`fill_province_caches` 之后）
- Test: `backend/tests/unit/test_route_groups_units.py`、`backend/tests/integration/test_route_groups.py`

**Interfaces:**
- Produces（`app/modules/route_groups/groups.py`）：
  - 常量 `ALGORITHM_VERSION = "route-groups-v1"`、`MIN_DISTANCE_M = 1000`、`DISTANCE_TOLERANCE = 0.15`、`BUFFER_M = 50`、`MIN_COVERAGE = 0.8`、`SIMPLIFY_DEGREES = 0.00005`、`FILL_BATCH = 20`
  - `lock_key(owner: UUID) -> int`
  - `reset_stale_versions(db) -> None`
  - `build_fingerprints(db, limit: int) -> int`（返回新建指纹行数）
  - `matching_groups(db, owner: UUID, activity_id: UUID, distance) -> list[tuple[UUID, float]]`（按覆盖率降序，仅 ≥ `MIN_COVERAGE`）
  - `assign_user(db, owner: UUID, limit: int) -> int`（返回本次归入的活动数；拿不到锁返回 0）
  - `fill_route_groups(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int`

- [ ] **Step 1: 写单元测试（无 DB）**

`backend/tests/unit/test_route_groups_units.py`：

```python
from uuid import uuid4

from app.modules.route_groups import groups


def test_lock_key_is_stable_per_owner_and_distinct_between_owners():
    first, second = uuid4(), uuid4()
    assert groups.lock_key(first) == groups.lock_key(first)
    assert groups.lock_key(first) != groups.lock_key(second)
    assert -(2**63) <= groups.lock_key(first) < 2**63


def test_thresholds_match_the_design():
    assert (groups.MIN_DISTANCE_M, groups.DISTANCE_TOLERANCE) == (1000, 0.15)
    assert (groups.BUFFER_M, groups.MIN_COVERAGE) == (50, 0.8)
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/unit/test_route_groups_units.py -q` → FAIL（模块不存在）。

- [ ] **Step 3: 写 `groups.py`**

```python
"""Group an owner's runs that follow the same route; every table here is a replaceable derivative."""

import hashlib
import logging
from uuid import UUID, uuid4

from sqlalchemy import text

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "route-groups-v1"
MIN_DISTANCE_M = 1000
DISTANCE_TOLERANCE = 0.15
BUFFER_M = 50
MIN_COVERAGE = 0.8
# About five metres; applied in degrees before the line is stored.
SIMPLIFY_DEGREES = 0.00005
FILL_BATCH = 20
MAX_OWNERS_PER_SCAN = 50


def lock_key(owner: UUID) -> int:
    # Separate namespace from import and footprint locks, including for the same user.
    return int.from_bytes(
        hashlib.sha256(b"route-groups:" + owner.bytes).digest()[:8], "big", signed=True
    )


def reset_stale_versions(db) -> None:
    """A new algorithm version rebuilds everything; members go with their groups."""
    params = {"version": ALGORITHM_VERSION}
    db.execute(text("DELETE FROM route_groups WHERE algorithm_version <> :version"), params)
    db.execute(text("DELETE FROM route_fingerprints WHERE algorithm_version <> :version"), params)
    # Groups whose runs were all deleted are no longer reachable from any member.
    db.execute(
        text(
            """DELETE FROM route_groups g
               WHERE NOT EXISTS (SELECT 1 FROM route_group_members m WHERE m.group_id = g.id)"""
        )
    )


def build_fingerprints(db, limit: int) -> int:
    """One row per activity, oldest first; geom stays NULL when the run cannot be grouped."""
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    result = db.execute(
        text(
            """INSERT INTO route_fingerprints (id, user_id, activity_id, algorithm_version, geom)
               SELECT gen_random_uuid(), a.user_id, a.id, :version,
                      CASE WHEN a.distance_m >= :min_distance THEN (
                          SELECT ST_Multi(ST_SimplifyPreserveTopology(
                                     ST_Collect(s.geom ORDER BY s.segment_index), :tolerance))
                          FROM activity_segments s
                          WHERE s.activity_id = a.id AND s.geom IS NOT NULL
                      ) END
               FROM activities a
               WHERE NOT EXISTS (SELECT 1 FROM route_fingerprints f WHERE f.activity_id = a.id)
               ORDER BY a.created_at, a.id
               LIMIT :limit
               ON CONFLICT (activity_id) DO NOTHING"""
        ),
        {
            "version": ALGORITHM_VERSION,
            "min_distance": MIN_DISTANCE_M,
            "tolerance": SIMPLIFY_DEGREES,
            "limit": limit,
        },
    )
    return result.rowcount


MATCH_SQL = text(
    """
WITH me AS (
    SELECT f.geom AS geom_4326,
           ST_Transform(f.geom, 3857) AS g,
           :buffer / cos(radians(ST_Y(ST_Centroid(f.geom)))) AS r
    FROM route_fingerprints f
    WHERE f.activity_id = :activity AND f.geom IS NOT NULL
), candidates AS (
    SELECT m.group_id, ST_Transform(f.geom, 3857) AS g
    FROM route_group_members m
    JOIN route_fingerprints f ON f.activity_id = m.activity_id AND f.geom IS NOT NULL
    JOIN activities a ON a.id = m.activity_id
    JOIN me ON f.geom && me.geom_4326
    WHERE m.user_id = :owner
      AND abs(a.distance_m - :distance) <= :tolerance * greatest(a.distance_m, :distance)
), scored AS (
    SELECT c.group_id,
           least(
               ST_Length(ST_Intersection(me.g, ST_Buffer(c.g, me.r))) / ST_Length(me.g),
               ST_Length(ST_Intersection(c.g, ST_Buffer(me.g, me.r))) / ST_Length(c.g)
           ) AS coverage
    FROM candidates c CROSS JOIN me
)
SELECT group_id, max(coverage) AS coverage
FROM scored
GROUP BY group_id
HAVING max(coverage) >= :min_coverage
ORDER BY max(coverage) DESC, group_id
"""
)


def matching_groups(db, owner: UUID, activity_id: UUID, distance) -> list[tuple[UUID, float]]:
    rows = db.execute(
        MATCH_SQL,
        {
            "buffer": BUFFER_M,
            "activity": activity_id,
            "owner": owner,
            "distance": distance,
            "tolerance": DISTANCE_TOLERANCE,
            "min_coverage": MIN_COVERAGE,
        },
    ).all()
    return [(group_id, float(coverage)) for group_id, coverage in rows]


def assign_user(db, owner: UUID, limit: int) -> int:
    """Place the owner's oldest ungrouped runs; one transaction per owner via an advisory lock."""
    db.execute(text("SET LOCAL statement_timeout = '10000ms'"))
    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key(owner)}):
        return 0
    pending = db.execute(
        text(
            """SELECT f.activity_id, a.distance_m
               FROM route_fingerprints f JOIN activities a ON a.id = f.activity_id
               WHERE f.user_id = :owner AND f.geom IS NOT NULL AND f.algorithm_version = :version
                 AND NOT EXISTS (
                     SELECT 1 FROM route_group_members m WHERE m.activity_id = f.activity_id)
               ORDER BY a.activity_date, a.created_at, a.id
               LIMIT :limit"""
        ),
        {"owner": owner, "version": ALGORITHM_VERSION, "limit": limit},
    ).all()
    for activity_id, distance in pending:
        matches = matching_groups(db, owner, activity_id, distance)
        if matches:
            target, coverage = matches[0]
            others = [group_id for group_id, _ in matches[1:]]
            if others:
                # The run bridges groups that were separate: keep the earliest-created one.
                ordered = db.execute(
                    text(
                        "SELECT id FROM route_groups WHERE id = ANY(:ids) ORDER BY created_at, id"
                    ),
                    {"ids": [target, *others]},
                ).scalars().all()
                target = ordered[0]
                merged = ordered[1:]
                db.execute(
                    text("UPDATE route_group_members SET group_id = :target WHERE group_id = ANY(:old)"),
                    {"target": target, "old": merged},
                )
                db.execute(text("DELETE FROM route_groups WHERE id = ANY(:old)"), {"old": merged})
        else:
            target, coverage = uuid4(), 1.0
            db.execute(
                text(
                    "INSERT INTO route_groups (id, user_id, algorithm_version) "
                    "VALUES (:id, :owner, :version)"
                ),
                {"id": target, "owner": owner, "version": ALGORITHM_VERSION},
            )
        db.execute(
            text(
                "INSERT INTO route_group_members (activity_id, user_id, group_id, coverage) "
                "VALUES (:activity, :owner, :group, :coverage)"
            ),
            {"activity": activity_id, "owner": owner, "group": target, "coverage": coverage},
        )
    return len(pending)


def fill_route_groups(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int:
    """Bounded, restart-safe pass: stale cleanup, fingerprints, then grouping per owner."""

    def stopped():
        return stop_event is not None and stop_event.is_set()

    done = 0
    with session_factory() as db:
        reset_stale_versions(db)
        db.commit()
    while not stopped():
        with session_factory() as db:
            built = build_fingerprints(db, limit)
            db.commit()
        if not built:
            break
        done += built
    with session_factory() as db:
        owners = list(
            db.scalars(
                text(
                    """SELECT DISTINCT f.user_id FROM route_fingerprints f
                       WHERE f.geom IS NOT NULL AND NOT EXISTS (
                           SELECT 1 FROM route_group_members m WHERE m.activity_id = f.activity_id)
                       LIMIT :owners"""
                ),
                {"owners": MAX_OWNERS_PER_SCAN},
            )
        )
    for owner in owners:
        while not stopped():
            with session_factory() as db:
                assigned = assign_user(db, owner, limit)
                db.commit()
            if not assigned:
                break
            done += assigned
    return done
```

注意：`db.scalars(text(...))` 取单列在 SQLAlchemy 2 下可用；`ST_Collect(... ORDER BY ...)` 是聚合内排序，PostGIS 支持。

- [ ] **Step 4: 运行单元测试与 Ruff**

Run: `.venv/bin/pytest tests/unit/test_route_groups_units.py -q` → PASS。
Run: `.venv/bin/ruff format app/modules/route_groups` 后 `.venv/bin/ruff check app/modules/route_groups` → 通过。`ruff format` 不会折 SQL 字符串里的长行，E501 报错时手工在 SQL 内折行（只改空白，不改语义）。

- [ ] **Step 5: 写集成测试**

`backend/tests/integration/test_route_groups.py`（先写指纹与归类相关测试；读接口测试在 Task 3 追加到同一文件）：

```python
"""Route grouping against a real PostGIS test database: synthetic loops only."""

from datetime import date
from math import cos, hypot, radians
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.modules.activities.model import Activity
from app.modules.route_groups import groups
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration  # clients is requested by name

LON, LAT = 121.47, 31.23
METRES = 111_320


def ring(width_m=300, height_m=300, *, east_m=0.0, north_m=0.0, start=0, reverse=False, step_m=20):
    """A closed rectangular loop as (lon, lat) points, optionally shifted, rotated or reversed."""
    scale = METRES * cos(radians(LAT))
    corners = [(0, 0), (width_m, 0), (width_m, height_m), (0, height_m)]
    points = []
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
        count = max(1, round(hypot(x1 - x0, y1 - y0) / step_m))
        points += [
            (x0 + (x1 - x0) * i / count, y0 + (y1 - y0) * i / count) for i in range(count)
        ]
    points = points[start:] + points[:start]
    if reverse:
        points = points[::-1]
    points.append(points[0])
    return [
        (LON + (east_m + x) / scale, LAT + (north_m + y) / METRES) for x, y in points
    ]


def add_run(app, owner, coords, *, day, distance_m=1200, seconds=360, title="Synthetic run"):
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=owner,
            source="gpx",
            title=title,
            activity_date=day,
            date_source="manual",
            timezone="UTC",
            distance_m=distance_m,
            elapsed_seconds=seconds,
            timer_seconds=seconds,
            avg_pace_seconds_per_km=seconds / (distance_m / 1000),
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        identifier = str(activity.id)
        wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in coords) + ")"
        db.execute(
            text(
                """INSERT INTO activity_segments
                   (id, activity_id, segment_index, source_track_index, source_segment_index,
                    break_reason, point_count, geom)
                   VALUES (:sid, :id, 0, 0, 0, 'source_segment', :n, ST_GeomFromText(:wkt, 4326))"""
            ),
            dict(sid=str(uuid4()), id=identifier, n=len(coords), wkt=wkt),
        )
    return identifier


def quiet(*test_clients):
    """Stop the background workers so the test decides when the fill runs."""
    for client in test_clients:
        client.app.state.footprint_worker.stop()


def fill(app):
    return groups.fill_route_groups(app.state.session_factory)


def members(app, owner):
    with app.state.session_factory() as db:
        rows = db.execute(
            text("SELECT activity_id, group_id FROM route_group_members WHERE user_id = :o"),
            {"o": UUID(owner)},
        ).all()
    return {str(activity): group for activity, group in rows}


def test_same_loop_reversed_rotated_and_jittered_shares_one_group(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    first = add_run(app, owner, ring(), day=date(2025, 1, 1))
    second = add_run(app, owner, ring(reverse=True), day=date(2025, 1, 3), distance_m=1230)
    third = add_run(app, owner, ring(start=7, north_m=8), day=date(2025, 1, 5), distance_m=1190)
    assert fill(app) >= 3
    found = members(app, owner)
    assert set(found) == {first, second, third}
    assert len(set(found.values())) == 1


def test_a_shifted_loop_or_a_very_different_length_is_a_different_route(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    base = add_run(app, owner, ring(), day=date(2025, 2, 1))
    shifted = add_run(app, owner, ring(east_m=400), day=date(2025, 2, 2))
    longer = add_run(app, owner, ring(), day=date(2025, 2, 3), distance_m=2400)
    fill(app)
    found = members(app, owner)
    assert len({found[base], found[shifted], found[longer]}) == 3


def test_short_and_trackless_runs_get_an_empty_fingerprint_and_no_group(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    short = add_run(app, owner, ring(), day=date(2025, 3, 1), distance_m=500)
    fill(app)
    assert members(app, owner) == {}
    with app.state.session_factory() as db:
        geom_is_null = db.scalar(
            text("SELECT geom IS NULL FROM route_fingerprints WHERE activity_id = :a"),
            {"a": UUID(short)},
        )
    assert geom_is_null is True
    assert fill(app) == 0  # nothing is recomputed


def test_a_loop_shifted_within_the_buffer_joins_and_one_beyond_it_does_not(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    base = add_run(app, owner, ring(), day=date(2025, 4, 1))
    near = add_run(app, owner, ring(east_m=20), day=date(2025, 4, 2))
    far = add_run(app, owner, ring(east_m=900), day=date(2025, 4, 3))
    fill(app)
    found = members(app, owner)
    assert found[base] == found[near]
    assert found[far] != found[base]


def test_deleting_runs_removes_members_and_empty_groups_on_the_next_fill(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    only = add_run(app, owner, ring(), day=date(2025, 5, 1))
    fill(app)
    assert only in members(app, owner)
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM activities WHERE id = :a"), {"a": UUID(only)})
    fill(app)
    with app.state.session_factory() as db:
        remaining = db.scalar(
            text("SELECT count(*) FROM route_groups WHERE user_id = :o"), {"o": UUID(owner)}
        )
    assert remaining == 0


def test_grouping_never_crosses_owners(clients):  # noqa: F811
    a, b, _, app_a = clients
    quiet(a, b)
    owner_a = register(a)
    owner_b = register(b)
    mine = add_run(app_a, owner_a, ring(), day=date(2025, 6, 1))
    theirs = add_run(b.app, owner_b, ring(), day=date(2025, 6, 2))
    fill(app_a)
    assert members(app_a, owner_a)[mine] != members(app_a, owner_b)[theirs]


def test_the_footprint_worker_scan_also_fills_route_groups(clients):  # noqa: F811
    from app.db.schema import get_expected_revision
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    run = add_run(app, owner, ring(), day=date(2025, 7, 1))
    run_scan(app.state.session_factory, app.state.clock(), get_expected_revision())
    assert run in members(app, owner)
```

- [ ] **Step 6: 运行集成测试，确认失败**

在已授权、已升级到 `0015_route_groups` 的 `_test` 库上，按 `docs/09-phase-two-progress.md`“运行测试”构造 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS` 后（只在进程环境注入）运行：

`.venv/bin/pytest tests/integration/test_route_groups.py -q`
Expected: 最后一个测试 FAIL（`run_scan` 尚未调用 `fill_route_groups`），其余可能已 PASS。若测试库不可用，明确记录“集成测试未运行”，本步以单元测试和代码评审代替，不得声称通过。

- [ ] **Step 7: 接入 `run_scan`**

编辑 `backend/app/modules/footprints/worker.py`：在文件顶部 `from app.modules.footprints.snapshot import (...)` 之后加

```python
from app.modules.route_groups.groups import fill_route_groups
```

在 `run_scan` 中 `fill_province_caches` 的 `try/except` 之后、`return published` 之前加

```python
    try:
        fill_route_groups(session_factory, stop_event=stop_event)
    except Exception as error:
        # Reads work without it; the next scan retries without leaking details.
        logger.warning("Route group fill unavailable (%s)", type(error).__name__)
```

- [ ] **Step 8: 运行测试与 lint**

Run: `.venv/bin/pytest tests/unit -q` → 全部通过（含 `test_footprint_worker_wake.py`、`test_footprint_snapshots.py`）。
Run（有测试库时）: `.venv/bin/pytest tests/integration/test_route_groups.py tests/integration/test_province_cache.py tests/integration/test_footprint_snapshots.py -q` → 通过；报告真实通过/跳过数。
Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests` → 通过。

若阈值与合成样本不符（例如 `east_m=40` 的两条环线覆盖率低于 0.8），先在 Python 里用 `matching_groups` 打印覆盖率定位，再调整测试样本而不是放宽阈值；阈值改动必须同步设计文档并提升 `ALGORITHM_VERSION`。

- [ ] **Step 9: Commit（需用户授权）**

```bash
git add backend/app/modules/route_groups/groups.py backend/app/modules/footprints/worker.py backend/tests/unit/test_route_groups_units.py backend/tests/integration/test_route_groups.py
git commit -m "feat: group runs along the same route in the background scan"
```

---

### Task 3: 工作区只读接口

**Files:**
- Create: `backend/app/modules/route_groups/schema.py`、`queries.py`、`service.py`、`router.py`
- Modify: `backend/app/main.py`（`import` 与 `include_router`）
- Test: `backend/tests/integration/test_route_groups.py`（追加）

**Interfaces:**
- Consumes: Task 1 的表；Task 2 的 `groups.MIN_COVERAGE` 无需；使用 `MIN_RUNS`（在本任务 `queries.py` 定义 `MIN_RUNS = 2`）。
- Produces（`service.py`）：
  - `list_groups(db, owner: UUID, limit: int, offset: int, sort: str) -> dict`，键 `items,total,limit,offset,building`
  - `group_detail(db, owner: UUID, identifier: UUID) -> dict`（不存在抛 `ApiError(404, "ROUTE_NOT_FOUND", "路线不存在")`）
- Produces（HTTP）：`GET /api/v1/routes/groups?limit&offset&sort=count|recent|distance`、`GET /api/v1/routes/groups/{id}`，响应 `ApiResponse[RouteGroupList]` / `ApiResponse[RouteGroupDetail]`。

- [ ] **Step 1: 追加失败的集成测试**

向 `backend/tests/integration/test_route_groups.py` 追加：

```python
def read(client, path):
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_listing_shows_only_routes_run_at_least_twice_with_aggregates(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_run(app, owner, ring(), day=date(2025, 8, 1), seconds=400, title="早晨")
    add_run(app, owner, ring(reverse=True), day=date(2025, 8, 8), seconds=360, distance_m=1210)
    add_run(app, owner, ring(east_m=900), day=date(2025, 8, 9))  # a single run: not listed
    fill(app)
    data = read(a, "/api/v1/routes/groups")
    assert (data["total"], data["limit"], data["offset"], data["building"]) == (1, 20, 0, False)
    item = data["items"][0]
    assert item["run_count"] == 2
    assert (item["first_date"], item["last_date"]) == ("2025-08-01", "2025-08-08")
    assert float(item["best_duration_seconds"]) == 360 and float(item["avg_duration_seconds"]) == 380
    assert len(item["shape"]) == 1 and len(item["shape"][0]) >= 4
    assert set(item) == {
        "id", "run_count", "first_date", "last_date", "median_distance_m",
        "best_duration_seconds", "avg_duration_seconds", "best_pace_seconds_per_km",
        "avg_pace_seconds_per_km", "shape",
    }


def test_detail_lists_runs_newest_first_and_other_owners_get_404(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    register(b)
    first = add_run(app, owner, ring(), day=date(2025, 9, 1), title="第一次")
    second = add_run(app, owner, ring(), day=date(2025, 9, 2), title="第二次")
    fill(app)
    group = read(a, "/api/v1/routes/groups")["items"][0]["id"]
    detail = read(a, f"/api/v1/routes/groups/{group}")
    assert [run["activity_id"] for run in detail["runs"]] == [second, first]
    assert detail["runs"][0]["title"] == "第二次" and 0 < detail["runs"][0]["coverage"] <= 1
    response = b.get(f"/api/v1/routes/groups/{group}")
    assert response.status_code == 404 and response.json()["error"]["code"] == "ROUTE_NOT_FOUND"
    assert a.get(f"/api/v1/routes/groups/{uuid4()}").status_code == 404


def test_listing_pages_sorts_and_flags_unprocessed_runs_as_building(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    for day in (1, 2, 3):
        add_run(app, owner, ring(), day=date(2025, 10, day))
    for day in (4, 5):
        add_run(app, owner, ring(east_m=900), day=date(2025, 10, day), distance_m=1700)
    assert read(a, "/api/v1/routes/groups")["building"] is True  # nothing processed yet
    fill(app)
    by_count = read(a, "/api/v1/routes/groups?sort=count")["items"]
    assert [item["run_count"] for item in by_count] == [3, 2]
    by_distance = read(a, "/api/v1/routes/groups?sort=distance")["items"]
    assert [item["run_count"] for item in by_distance] == [2, 3]
    page = read(a, "/api/v1/routes/groups?limit=1&offset=1")
    assert (page["total"], len(page["items"])) == (2, 1)
    assert a.get("/api/v1/routes/groups?sort=nope").status_code == 422
    assert a.get("/api/v1/routes/groups?owner=x").status_code == 422
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/integration/test_route_groups.py -q -k "listing or detail"` → FAIL（404/路由不存在）。无测试库则记录未运行。

- [ ] **Step 3: 写 schema**

`backend/app/modules/route_groups/schema.py`：

```python
from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class RouteGroupItem(BaseModel):
    id: UUID
    run_count: int = Field(ge=2)
    first_date: date
    last_date: date
    median_distance_m: Decimal
    best_duration_seconds: Decimal | None
    avg_duration_seconds: Decimal | None
    best_pace_seconds_per_km: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    # Lines of [lon, lat] pairs, simplified; used for thumbnails and the detail map.
    shape: list[list[list[float]]]


class RouteGroupList(BaseModel):
    items: list[RouteGroupItem]
    total: int = Field(ge=0)
    limit: int
    offset: int
    building: bool


class RouteRun(BaseModel):
    activity_id: UUID
    title: str
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    coverage: float = Field(ge=0, le=1)


class RouteGroupDetail(RouteGroupItem):
    runs: list[RouteRun]
```

这是展示端点共用的字段白名单：只含上述字段，不含备注、文件名、邮箱、原始 GPX。

- [ ] **Step 4: 写 queries**

`backend/app/modules/route_groups/queries.py`：

```python
"""Read-side SQL: groups are aggregated from their member activities at read time."""

from sqlalchemy import text

MIN_RUNS = 2
ORDER = {
    "count": "agg.run_count DESC, agg.last_date DESC, agg.group_id",
    "recent": "agg.last_date DESC, agg.run_count DESC, agg.group_id",
    "distance": "agg.median_distance_m DESC, agg.group_id",
}

AGGREGATES = """
WITH members AS (
    SELECT m.group_id, a.id AS activity_id, a.activity_date, a.distance_m,
           COALESCE(a.timer_seconds, a.elapsed_seconds) AS duration,
           a.avg_pace_seconds_per_km AS pace
    FROM route_group_members m JOIN activities a ON a.id = m.activity_id
    WHERE m.user_id = :owner {group_filter}
), agg AS (
    SELECT group_id, count(*) AS run_count, min(activity_date) AS first_date,
           max(activity_date) AS last_date,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_m) AS median_distance_m,
           min(duration) AS best_duration_seconds, avg(duration) AS avg_duration_seconds,
           min(pace) AS best_pace_seconds_per_km, avg(pace) AS avg_pace_seconds_per_km
    FROM members GROUP BY group_id HAVING count(*) >= :min_runs
)
"""

SELECT_GROUPS = """
SELECT agg.group_id AS id, agg.run_count, agg.first_date, agg.last_date,
       agg.median_distance_m, agg.best_duration_seconds, agg.avg_duration_seconds,
       agg.best_pace_seconds_per_km, agg.avg_pace_seconds_per_km, rep.shape
FROM agg
JOIN LATERAL (
    SELECT (ST_AsGeoJSON(f.geom, 5)::json -> 'coordinates') AS shape
    FROM members mm JOIN route_fingerprints f ON f.activity_id = mm.activity_id
    WHERE mm.group_id = agg.group_id
    ORDER BY abs(mm.distance_m - agg.median_distance_m), mm.activity_date, mm.activity_id
    LIMIT 1
) rep ON true
"""


def list_rows(db, owner, limit, offset, sort):
    order = f" ORDER BY {ORDER[sort]} LIMIT :limit OFFSET :offset"
    sql = AGGREGATES.format(group_filter="") + SELECT_GROUPS + order
    return db.execute(
        text(sql), {"owner": owner, "min_runs": MIN_RUNS, "limit": limit, "offset": offset}
    ).mappings().all()


def count_groups(db, owner):
    sql = AGGREGATES.format(group_filter="") + "SELECT count(*) FROM agg"
    return db.scalar(text(sql), {"owner": owner, "min_runs": MIN_RUNS})


def group_row(db, owner, group):
    sql = AGGREGATES.format(group_filter="AND m.group_id = :group") + SELECT_GROUPS
    return db.execute(
        text(sql), {"owner": owner, "group": group, "min_runs": MIN_RUNS}
    ).mappings().first()


def run_rows(db, owner, group):
    return db.execute(
        text(
            """SELECT a.id AS activity_id, a.title, a.activity_date, a.distance_m,
                      COALESCE(a.timer_seconds, a.elapsed_seconds) AS duration_seconds,
                      a.avg_pace_seconds_per_km, m.coverage
               FROM route_group_members m JOIN activities a ON a.id = m.activity_id
               WHERE m.user_id = :owner AND m.group_id = :group
               ORDER BY a.activity_date DESC, a.started_at DESC NULLS LAST, a.id"""
        ),
        {"owner": owner, "group": group},
    ).mappings().all()


def has_unprocessed(db, owner):
    return bool(
        db.scalar(
            text(
                """SELECT EXISTS (
                       SELECT 1 FROM activities a
                       WHERE a.user_id = :owner
                         AND NOT EXISTS (
                             SELECT 1 FROM route_fingerprints f WHERE f.activity_id = a.id))
                   OR EXISTS (
                       SELECT 1 FROM route_fingerprints f
                       WHERE f.user_id = :owner AND f.geom IS NOT NULL
                         AND NOT EXISTS (
                             SELECT 1 FROM route_group_members m
                             WHERE m.activity_id = f.activity_id))"""
            ),
            {"owner": owner},
        )
    )
```

- [ ] **Step 5: 写 service**

`backend/app/modules/route_groups/service.py`：

```python
from uuid import UUID

from app.core.errors import ApiError
from app.modules.route_groups import queries


def list_groups(db, owner: UUID, limit: int, offset: int, sort: str) -> dict:
    return {
        "items": [dict(row) for row in queries.list_rows(db, owner, limit, offset, sort)],
        "total": queries.count_groups(db, owner),
        "limit": limit,
        "offset": offset,
        "building": queries.has_unprocessed(db, owner),
    }


def group_detail(db, owner: UUID, identifier: UUID) -> dict:
    row = queries.group_row(db, owner, identifier)
    if row is None:
        raise ApiError(404, "ROUTE_NOT_FOUND", "路线不存在")
    return {**row, "runs": [dict(run) for run in queries.run_rows(db, owner, identifier)]}
```

- [ ] **Step 6: 写 router 并注册**

`backend/app/modules/route_groups/router.py`：

```python
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.route_groups import service
from app.modules.route_groups.schema import RouteGroupDetail, RouteGroupList

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


@router.get("/groups", response_model=ApiResponse[RouteGroupList])
def list_groups(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    sort: Literal["count", "recent", "distance"] = "count",
):
    if set(request.query_params) - {"limit", "offset", "sort"}:
        raise ApiError(422, "VALIDATION_ERROR", "路线查询包含不支持的参数")
    return envelope(request, service.list_groups(db, identity[1].id, limit, offset, sort))


@router.get("/groups/{identifier}", response_model=ApiResponse[RouteGroupDetail])
def group_detail(
    identifier: UUID,
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    return envelope(request, service.group_detail(db, identity[1].id, identifier))
```

编辑 `backend/app/main.py`：在 `from app.modules.footprints.worker import FootprintWorker` 附近按字母序加 `from app.modules.route_groups.router import router as route_groups_router`；在 `app.include_router(footprints_router)` 之后加 `app.include_router(route_groups_router)`。

- [ ] **Step 7: 运行测试与 lint**

Run: `.venv/bin/ruff format app tests && .venv/bin/ruff check app migrations tests`。
Run: `.venv/bin/pytest tests/unit -q` → 通过。
Run（有测试库）: `.venv/bin/pytest tests/integration/test_route_groups.py -q` → 全部通过；报告真实数字。

- [ ] **Step 8: Commit（需用户授权）**

```bash
git add backend/app/modules/route_groups/schema.py backend/app/modules/route_groups/queries.py backend/app/modules/route_groups/service.py backend/app/modules/route_groups/router.py backend/app/main.py backend/tests/integration/test_route_groups.py
git commit -m "feat: read-only frequent route endpoints"
```

---

### Task 4: 展示端点（站主与具名展示）

**Files:**
- Modify: `backend/app/modules/showcase/router.py`（在 `footprint_range` 之后、`reports` 之前加两个端点）
- Test: `backend/tests/integration/test_route_groups.py`（追加）

**Interfaces:**
- Consumes: Task 3 的 `service.list_groups` / `service.group_detail`、`schema.RouteGroupList` / `RouteGroupDetail`。
- Produces: `GET /api/v1/showcase/routes/groups`、`GET /api/v1/showcase/routes/groups/{identifier}`，以及由现有 `for existing_route in router.routes` 循环自动生成的 `/api/v1/showcase/users/{username}/routes/groups*`（无需额外代码）。

- [ ] **Step 1: 追加失败的测试**

```python
def test_showcase_serves_only_the_site_owner_and_rejects_owner_overrides(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    for day in (1, 2):
        add_run(app, owner, ring(), day=date(2025, 11, day))
    fill(app)
    data = read(a, "/api/v1/showcase/routes/groups")
    assert data["total"] == 1
    group = data["items"][0]["id"]
    detail = read(a, f"/api/v1/showcase/routes/groups/{group}")
    assert len(detail["runs"]) == 2
    assert a.get("/api/v1/showcase/routes/groups?owner=1").status_code == 422
    assert a.get(f"/api/v1/showcase/routes/groups/{uuid4()}").status_code == 404


def test_named_showcase_follows_showcase_enabled_and_never_leaks_other_users(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    for day in (1, 2):
        add_run(app, owner, ring(), day=date(2025, 12, day))
    fill(app)
    with app.state.session_factory() as db:
        username = db.scalar(text("SELECT username FROM users WHERE id = :o"), {"o": UUID(owner)})
    data = read(a, f"/api/v1/showcase/users/{username}/routes/groups")
    assert data["total"] == 1
    assert a.get("/api/v1/showcase/users/nobody_here/routes/groups").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/integration/test_route_groups.py -q -k showcase` → FAIL（404）。

- [ ] **Step 3: 加端点**

在 `backend/app/modules/showcase/router.py` 的 import 区加：

```python
from app.modules.route_groups import service as route_groups
from app.modules.route_groups.schema import RouteGroupDetail, RouteGroupList
```

在 `footprint_range` 之后加：

```python
@router.get("/routes/groups", response_model=ApiResponse[RouteGroupList])
def route_groups_listing(
    request: Request,
    db: DB,
    owner: Owner,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    sort: Literal["count", "recent", "distance"] = "count",
):
    return envelope(request, route_groups.list_groups(db, owner.id, limit, offset, sort))


@router.get("/routes/groups/{identifier}", response_model=ApiResponse[RouteGroupDetail])
def route_group_detail(identifier: UUID, request: Request, db: DB, owner: Owner):
    return envelope(request, route_groups.group_detail(db, owner.id, identifier))
```

`reject_owner_override` 已作为 router 依赖，`owner`/`user_id`/`email`/`username` 查询参数会 422；subject 固定来自 `Owner`，不接受客户端 owner ID。

- [ ] **Step 4: 运行测试与 lint**

Run: `.venv/bin/ruff format app tests && .venv/bin/ruff check app migrations tests`。
Run: `.venv/bin/pytest tests/unit tests/integration/test_showcase.py tests/integration/test_route_groups.py -q`（集成部分需测试库）→ 通过；如实报告跳过数。

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add backend/app/modules/showcase/router.py backend/tests/integration/test_route_groups.py
git commit -m "feat: show frequent routes on owner and named showcases"
```

---

### Task 5: 前端接口层（校验、路径前缀）

**Files:**
- Create: `frontend/src/lib/api/route-groups.ts`
- Modify: `frontend/src/lib/api/view-context.ts:9`（`contextPath` 正则增加 `routes`）
- Test: `frontend/tests/unit/route-groups.test.ts`；`frontend/tests/unit/view-context.test.ts`（追加）

**Interfaces:**
- Produces（`route-groups.ts`）：
  - 类型 `RouteGroupItem`、`RouteGroupList`、`RouteRun`、`RouteGroupDetail`、`RouteSort = 'count' | 'recent' | 'distance'`
  - `class RouteGroupError extends Error { constructor(message: string, public status = 422) }`
  - `parseRouteGroupList(v: unknown): RouteGroupList`、`parseRouteGroupDetail(v: unknown): RouteGroupDetail`
  - `readRouteGroups(sort: RouteSort, limit: number, offset: number, signal: AbortSignal, fetcher?: typeof fetch): Promise<RouteGroupList>`
  - `readRouteGroup(id: string, signal: AbortSignal, fetcher?: typeof fetch): Promise<RouteGroupDetail>`
  - `shapeRoute(shape: Coordinate[][]): Route`（供 `routeDrawing` 与 `RouteMap` 使用）
- 请求路径固定写 `/api/v1/showcase/routes/groups…`，由 `view.fetch`（`contextAPI`）改写到工作区或具名展示。

- [ ] **Step 1: 写失败的单元测试**

`frontend/tests/unit/route-groups.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseRouteGroupDetail, parseRouteGroupList, readRouteGroups, shapeRoute, RouteGroupError } from '../../src/lib/api/route-groups.ts';

const id = '11111111-1111-4111-8111-111111111111';
const item = { id, run_count: 3, first_date: '2025-01-01', last_date: '2025-02-01', median_distance_m: '5000.000', best_duration_seconds: '1500.000', avg_duration_seconds: '1560.5', best_pace_seconds_per_km: '300.000', avg_pace_seconds_per_km: '312.1', shape: [[[121.47, 31.23], [121.48, 31.24], [121.47, 31.23]]] };
const list = { items: [item], total: 1, limit: 20, offset: 0, building: false };
const run = { activity_id: id, title: '晨跑', activity_date: '2025-02-01', distance_m: '5000.000', duration_seconds: '1500.000', avg_pace_seconds_per_km: '300.000', coverage: 0.93 };

describe('route group parsing', () => {
  it('accepts a valid list and detail', () => {
    expect(parseRouteGroupList(list).items[0].run_count).toBe(3);
    expect(parseRouteGroupDetail({ ...item, runs: [run] }).runs[0].coverage).toBe(0.93);
  });
  it('rejects malformed fields', () => {
    for (const bad of [
      { ...list, items: [{ ...item, run_count: 1 }] },
      { ...list, items: [{ ...item, id: 'nope' }] },
      { ...list, items: [{ ...item, first_date: '2025-13-40' }] },
      { ...list, items: [{ ...item, shape: [[[200, 31]]] }] },
      { ...list, items: [{ ...item, median_distance_m: 'abc' }] },
      { ...list, building: 'no' },
      { ...list, total: -1 },
      null,
    ]) expect(() => parseRouteGroupList(bad)).toThrow(RouteGroupError);
    expect(() => parseRouteGroupDetail({ ...item, runs: [{ ...run, coverage: 2 }] })).toThrow(RouteGroupError);
  });
  it('keeps only whitelisted fields', () => {
    const parsed = parseRouteGroupList({ ...list, items: [{ ...item, email: 'x@example.com' }] });
    expect('email' in parsed.items[0]).toBe(false);
  });
});

describe('route group requests', () => {
  it('reads through the showcase path and maps 401 to an expired login', async () => {
    const urls: string[] = [];
    const ok = (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response(JSON.stringify({ data: list, error: null })); }) as typeof fetch;
    await readRouteGroups('recent', 10, 20, new AbortController().signal, ok);
    expect(urls[0]).toBe('/api/v1/showcase/routes/groups?sort=recent&limit=10&offset=20');
    const denied = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    await expect(readRouteGroups('count', 20, 0, new AbortController().signal, denied)).rejects.toMatchObject({ status: 401, message: '登录已过期' });
  });
});

describe('shapeRoute', () => {
  it('builds a route whose endpoints are the first and last coordinates', () => {
    const route = shapeRoute(item.shape as [number, number][][]);
    expect(route.features).toHaveLength(1);
    expect(route.start).toEqual([121.47, 31.23]);
    expect(route.end).toEqual([121.47, 31.23]);
  });
});
```

并向 `frontend/tests/unit/view-context.test.ts` 追加用例，断言 `contextPath(viewContext('/p/runner/routes'), '/routes')` 为 `'/p/runner/routes'`，`contextPath(viewContext('/workspace/routes'), '/routes/abc')` 为 `'/workspace/routes/abc'`（先 `Read` 该文件按其已有导入与写法对齐）。

- [ ] **Step 2: 运行确认失败**

Run（`frontend/`）: `pnpm exec vitest run tests/unit/route-groups.test.ts tests/unit/view-context.test.ts` → FAIL（模块不存在、前缀断言失败）。

- [ ] **Step 3: 写 `route-groups.ts`**

```ts
import type { Coordinate, Metric, Route } from './activities.ts';

export type RouteSort = 'count' | 'recent' | 'distance';
export interface RouteGroupItem { id: string; run_count: number; first_date: string; last_date: string; median_distance_m: Metric; best_duration_seconds: Metric; avg_duration_seconds: Metric; best_pace_seconds_per_km: Metric; avg_pace_seconds_per_km: Metric; shape: Coordinate[][] }
export interface RouteGroupList { items: RouteGroupItem[]; total: number; limit: number; offset: number; building: boolean }
export interface RouteRun { activity_id: string; title: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric; coverage: number }
export interface RouteGroupDetail extends RouteGroupItem { runs: RouteRun[] }
export class RouteGroupError extends Error { constructor(message: string, public status = 422) { super(message); } }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid: () => never = () => { throw new RouteGroupError('路线服务返回了无效响应，请重试', 502); };
const calendarDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const count = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
function metric(v: unknown, nullable: boolean): Metric {
  if (v === null && nullable) return null;
  const parsed = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1e9) return invalid();
  return v as Metric;
}
function shape(v: unknown): Coordinate[][] {
  if (!Array.isArray(v) || v.length === 0) return invalid();
  return v.map(line => {
    if (!Array.isArray(line) || line.length < 2) return invalid();
    return line.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(x => typeof x !== 'number' || !Number.isFinite(x)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return invalid();
      return [point[0], point[1]] as Coordinate;
    });
  });
}
function parseItem(v: unknown): RouteGroupItem {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !count(v.run_count, 2) || !calendarDate(v.first_date) || !calendarDate(v.last_date) || v.first_date > v.last_date) return invalid();
  return { id: v.id, run_count: v.run_count, first_date: v.first_date, last_date: v.last_date, median_distance_m: metric(v.median_distance_m, false), best_duration_seconds: metric(v.best_duration_seconds, true), avg_duration_seconds: metric(v.avg_duration_seconds, true), best_pace_seconds_per_km: metric(v.best_pace_seconds_per_km, true), avg_pace_seconds_per_km: metric(v.avg_pace_seconds_per_km, true), shape: shape(v.shape) };
}
function parseRun(v: unknown): RouteRun {
  if (!object(v) || typeof v.activity_id !== 'string' || !uuid.test(v.activity_id) || typeof v.title !== 'string' || !calendarDate(v.activity_date) || typeof v.coverage !== 'number' || !(v.coverage >= 0 && v.coverage <= 1)) return invalid();
  return { activity_id: v.activity_id, title: v.title, activity_date: v.activity_date, distance_m: metric(v.distance_m, false), duration_seconds: metric(v.duration_seconds, true), avg_pace_seconds_per_km: metric(v.avg_pace_seconds_per_km, true), coverage: v.coverage };
}
export function parseRouteGroupList(v: unknown): RouteGroupList {
  if (!object(v) || !Array.isArray(v.items) || !count(v.total) || !count(v.limit, 1) || !count(v.offset) || typeof v.building !== 'boolean') return invalid();
  return { items: v.items.map(parseItem), total: v.total, limit: v.limit, offset: v.offset, building: v.building };
}
export function parseRouteGroupDetail(v: unknown): RouteGroupDetail {
  if (!object(v) || !Array.isArray(v.runs)) return invalid();
  return { ...parseItem(v), runs: v.runs.map(parseRun) };
}
/** A route-shaped view of a simplified group shape, for `routeDrawing` and `RouteMap`. */
export function shapeRoute(lines: Coordinate[][]): Route {
  const last = lines[lines.length - 1];
  return {
    type: 'FeatureCollection',
    features: lines.map((coordinates, segment_index) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { segment_index, point_count: coordinates.length } })),
    start: lines[0][0],
    end: last[last.length - 1]
  };
}
async function request(path: string, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin', signal });
  if (response.status === 401) throw new RouteGroupError('登录已过期', 401);
  let body: unknown;
  try { body = await response.json(); } catch { throw new RouteGroupError('无法读取常跑路线，请稍后重试', response.ok ? 502 : response.status); }
  if (!object(body)) return invalid();
  if (!response.ok || body.error) throw new RouteGroupError(object(body.error) && typeof body.error.message === 'string' ? body.error.message : '无法读取常跑路线，请稍后重试', response.status);
  return body.data;
}
export async function readRouteGroups(sort: RouteSort, limit: number, offset: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RouteGroupList> {
  const query = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
  return parseRouteGroupList(await request(`/api/v1/showcase/routes/groups?${query}`, signal, fetcher));
}
export async function readRouteGroup(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RouteGroupDetail> {
  if (!uuid.test(id)) throw new RouteGroupError('路线不存在', 404);
  return parseRouteGroupDetail(await request(`/api/v1/showcase/routes/groups/${id}`, signal, fetcher));
}
```

编辑 `frontend/src/lib/api/view-context.ts` 的 `contextPath` 正则：`(dashboard|activities|footprints|ai|settings)` → `(dashboard|activities|footprints|routes|ai|settings)`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run tests/unit/route-groups.test.ts tests/unit/view-context.test.ts` → PASS；再 `pnpm test`（全部单元）与 `pnpm check` → 无错误。

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add frontend/src/lib/api/route-groups.ts frontend/src/lib/api/view-context.ts frontend/tests/unit/route-groups.test.ts frontend/tests/unit/view-context.test.ts
git commit -m "feat: frontend contract for frequent routes"
```

---

### Task 6: 列表页、详情页与导航

**Files:**
- Create: `frontend/src/lib/components/RouteGroupCard.svelte`、`frontend/src/lib/components/RouteGroupTrend.svelte`
- Create: `frontend/src/routes/routes/+page.svelte`、`frontend/src/routes/routes/[id]/+page.svelte`
- Create: `frontend/src/routes/workspace/routes/+page.svelte`、`frontend/src/routes/workspace/routes/[id]/+page.svelte`
- Create: `frontend/src/routes/p/[username]/routes/+page.svelte`、`frontend/src/routes/p/[username]/routes/[id]/+page.svelte`
- Modify: `frontend/src/lib/components/AppNavigation.svelte:35`（导航项）
- Test: `frontend/tests/ui/route-groups.spec.ts`、`frontend/playwright.route-groups.config.ts`

**Interfaces:**
- Consumes: Task 5 的 `readRouteGroups`、`readRouteGroup`、`shapeRoute`、`RouteGroupError`、类型；既有 `routeDrawing`（`#lib/api/route-drawing.ts`）、`formatDistance`/`formatDuration`/`formatPace`（`#lib/api/activities.ts`）、`useViewContext`、`PageHeader`/`FeedbackState`/`PageSkeleton`、`RouteMap`、`trend-chart-runtime`、`watchSystemTheme`。
- Produces: 页面 `/routes`、`/routes/[id]` 及其 `/workspace/*`、`/p/{username}/*` 包装；`data-testid`：`route-list`、`route-card`、`route-building`、`route-detail-ready`、`route-run-row`。

- [ ] **Step 1: 写失败的 Playwright 规格与配置**

`frontend/playwright.route-groups.config.ts`：

```ts
import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({ ...base, testMatch: ['route-groups.spec.ts'] });
```

`frontend/tests/ui/route-groups.spec.ts`（先 `Read` `tests/fixtures/activities.ts` 与 `tests/ui/footprints.spec.ts` 确认 `loginRunner`、`installActivities`、`installBasemaps` 的用法后按其写法对齐）：

```ts
import { expect, test, type Page } from '@playwright/test';
import { loginRunner, installActivities } from '../fixtures/activities';
import { installBasemaps } from '../fixtures/basemaps';

const id = '11111111-1111-4111-8111-111111111111';
const shape = [[[121.47, 31.23], [121.474, 31.23], [121.474, 31.233], [121.47, 31.233], [121.47, 31.23]]];
const item = { id, run_count: 3, first_date: '2025-01-01', last_date: '2025-02-01', median_distance_m: '1200.000', best_duration_seconds: '360.000', avg_duration_seconds: '380.000', best_pace_seconds_per_km: '300.000', avg_pace_seconds_per_km: '316.667', shape };
const runs = [
  { activity_id: id, title: '周末环湖', activity_date: '2025-02-01', distance_m: '1200.000', duration_seconds: '360.000', avg_pace_seconds_per_km: '300.000', coverage: 0.96 },
  { activity_id: '22222222-2222-4222-8222-222222222222', title: '晨跑', activity_date: '2025-01-01', distance_m: '1200.000', duration_seconds: '400.000', avg_pace_seconds_per_km: '333.333', coverage: 1 },
];

async function fixture(page: Page, scenario: 'ready' | 'empty' | 'building' | 'error' = 'ready') {
  const requests: URL[] = [];
  await installActivities(page);
  await installBasemaps(page);
  await page.route('**/api/v1/showcase/routes/groups?**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (scenario === 'error') return route.fulfill({ status: 503, json: { data: null, error: { message: '路线暂不可用，请重试' } } });
    const items = scenario === 'empty' || scenario === 'building' ? [] : [item];
    return route.fulfill({ json: { data: { items, total: items.length, limit: 20, offset: 0, building: scenario === 'building' }, error: null } });
  });
  await page.route(`**/api/v1/showcase/routes/groups/${id}`, route => route.fulfill({ json: { data: { ...item, runs }, error: null } }));
  return requests;
}

test('lists routes with counts and best time, and links to the detail', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  const card = page.getByTestId('route-card').first();
  await expect(card).toContainText('3 次');
  await expect(card).toContainText('6:00');
  await card.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/routes/${id}$`));
  await expect(page.getByTestId('route-detail-ready')).toBeVisible();
  await expect(page.getByTestId('route-run-row')).toHaveCount(2);
});

test('sorting asks the server and keeps the choice in the URL', async ({ page }) => {
  const requests = await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  await page.getByRole('button', { name: '最近跑过' }).click();
  await expect.poll(() => requests.some(url => url.searchParams.get('sort') === 'recent')).toBe(true);
  await expect(page).toHaveURL(/sort=recent/);
});

test('shows empty, building and error states with a retry', async ({ page }) => {
  await fixture(page, 'empty'); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByText('还没有跑过两次以上的路线')).toBeVisible();
  const building = await page.context().newPage();
  await fixture(building, 'building'); await loginRunner(building);
  await building.goto('/routes');
  await expect(building.getByTestId('route-building')).toBeVisible();
  const failing = await page.context().newPage();
  await fixture(failing, 'error'); await loginRunner(failing);
  await failing.goto('/routes');
  await expect(failing.getByText('路线暂不可用，请重试')).toBeVisible();
  await expect(failing.getByRole('button', { name: '重新读取' })).toBeVisible();
});

test('works in dark mode and on a phone width without horizontal scroll', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec playwright test --config playwright.route-groups.config.ts` → FAIL（`/routes` 404）。（需本机已装 Chrome/Playwright 浏览器；不可用时如实记录未运行。）

- [ ] **Step 3: 写 `RouteGroupCard.svelte`**

```svelte
<script lang="ts">
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { routeDrawing } from '#lib/api/route-drawing.ts';
  import { shapeRoute, type RouteGroupItem } from '#lib/api/route-groups.ts';
  let { group, href }: { group: RouteGroupItem; href: string } = $props();
  const drawing = $derived(routeDrawing(shapeRoute(group.shape)));
  const name = $derived(`约 ${formatDistance(group.median_distance_m)} 路线`);
</script>
<article class="route-card" data-testid="route-card">
  <svg viewBox="0 0 360 220" role="img" aria-label={`${name}的路线轮廓`}>{#each drawing.paths as path}<path d={path} />{/each}</svg>
  <div class="body">
    <h2><a {href}>{name}</a></h2>
    <p class="count"><strong>{group.run_count} 次</strong><span>{group.first_date} – {group.last_date}</span></p>
    <dl>
      <div><dt>最佳用时</dt><dd>{formatDuration(group.best_duration_seconds)}</dd></div>
      <div><dt>平均用时</dt><dd>{formatDuration(group.avg_duration_seconds)}</dd></div>
      <div><dt>最佳配速</dt><dd>{formatPace(group.best_pace_seconds_per_km)}</dd></div>
    </dl>
  </div>
</article>
<style>
  .route-card { display: grid; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; min-width: 0; }
  svg { display: block; width: 100%; aspect-ratio: 360/220; padding: .65rem; background: var(--route-thumbnail); }
  svg path { fill: none; stroke: var(--primary); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .body { display: grid; gap: .5rem; padding: 1rem; }
  h2 { font-size: 1rem; font-weight: 650; }
  h2 a { color: var(--foreground); }
  h2 a::after { content: ''; position: absolute; inset: 0; }
  .route-card { position: relative; }
  .count { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .25rem; font-size: .875rem; }
  .count span, dt { color: var(--muted-foreground); font-size: .8125rem; }
  dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  dd { font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
```

- [ ] **Step 4: 写列表页**

`frontend/src/routes/routes/+page.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RouteGroupCard from '#lib/components/RouteGroupCard.svelte';
  import { readRouteGroups as scoped_readRouteGroups, RouteGroupError, type RouteGroupList, type RouteSort } from '#lib/api/route-groups.ts';
  const view = useViewContext();
  const readRouteGroups = view.bind(scoped_readRouteGroups, 4);
  const SORTS: { value: RouteSort; label: string }[] = [{ value: 'count', label: '跑得最多' }, { value: 'recent', label: '最近跑过' }, { value: 'distance', label: '距离最长' }];
  let sort = $state<RouteSort>('count');
  let data = $state<RouteGroupList | null>(null), loading = $state(false), message = $state('');
  let requestId = 0, disposed = false, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  async function load(silent = false) {
    clearTimeout(timer); timer = undefined;
    const id = ++requestId; controller?.abort(); controller = new AbortController();
    if (!silent) { loading = true; message = ''; }
    try {
      const result = await readRouteGroups(sort, 20, 0, controller.signal);
      if (disposed || id !== requestId) return;
      data = result; message = '';
      if (result.building) timer = setTimeout(() => { void load(true); }, 5000);
    } catch (cause) {
      if (disposed || id !== requestId || controller.signal.aborted) return;
      if (cause instanceof RouteGroupError && cause.status === 401) { data = null; window.location.replace('/admin?reason=changed'); return; }
      if (silent && data) return;
      message = cause instanceof Error ? cause.message : '无法读取常跑路线，请重试';
    } finally { if (!disposed && id === requestId) loading = false; }
  }
  function choose(next: RouteSort) {
    if (next === sort) return;
    sort = next; data = null;
    void goto(view.href(`/routes?${new URLSearchParams({ sort })}`), { state: page.state, shallow: true, replace: true }).catch(() => {});
    void load();
  }
  onMount(() => {
    disposed = false;
    const requested = new URLSearchParams(window.location.search).get('sort');
    sort = SORTS.some(item => item.value === requested) ? (requested as RouteSort) : 'count';
    void load();
    return () => { disposed = true; ++requestId; clearTimeout(timer); controller?.abort(); };
  });
</script>
<svelte:head><title>{pageTitle('常跑路线', page.data.site)}</title></svelte:head>
<PageHeader title="常跑路线" description="形状重合的跑步会自动归为同一条路线。" />
<div class="routes-page">
  <div class="sort-row" role="group" aria-label="排序方式">
    {#each SORTS as item}<button type="button" aria-pressed={sort === item.value} onclick={() => choose(item.value)}>{item.label}</button>{/each}
  </div>
  {#if loading}<PageSkeleton title="正在读取常跑路线…" />{/if}
  {#if message}<FeedbackState kind="error" title={message}><button class="button-secondary" onclick={() => load()}>重新读取</button></FeedbackState>{/if}
  {#if data}
    {#if data.building}<div data-testid="route-building"><FeedbackState kind="loading" title="正在整理路线…"><p>新导入的记录会在后台自动归类，页面会自动更新。</p></FeedbackState></div>{/if}
    {#if data.items.length === 0 && !data.building}
      <FeedbackState title="还没有跑过两次以上的路线"><p>同一条路线跑过两次以上后会出现在这里。</p></FeedbackState>
    {:else}
      <p class="total" aria-live="polite">共 <strong>{data.total}</strong> 条常跑路线</p>
      <div class="grid" data-testid="route-list">{#each data.items as group (group.id)}<RouteGroupCard {group} href={view.href(`/routes/${group.id}`)} />{/each}</div>
    {/if}
  {/if}
</div>
<style>
  .routes-page { display: grid; gap: var(--space-4); margin-top: var(--space-6); min-width: 0; }
  .sort-row { display: inline-flex; gap: .25rem; background: var(--muted); padding: .25rem; border-radius: var(--radius-control); justify-self: start; max-width: 100%; flex-wrap: wrap; }
  .sort-row button { min-height: 2.75rem; padding: .5rem 1rem; font-weight: 600; border-radius: .45rem; color: var(--muted-foreground); }
  .sort-row button[aria-pressed='true'] { color: var(--primary-foreground); background: var(--primary); }
  .sort-row button:not([aria-pressed='true']):hover { color: var(--primary); background: var(--surface); }
  .total { color: var(--muted-foreground); font-size: .875rem; }
  .grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); }
</style>
```

- [ ] **Step 5: 写趋势图组件**

`frontend/src/lib/components/RouteGroupTrend.svelte`（用 `trend-chart-runtime` 的折线图；下方 `<details>` 完整数据表；缺失值 `—`；`watchSystemTheme` 订阅并卸载时取消）：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { formatDuration, type Metric } from '#lib/api/activities.ts';
  import type { RouteRun } from '#lib/api/route-groups.ts';
  let { runs }: { runs: RouteRun[] } = $props();
  const ordered = $derived([...runs].sort((a, b) => a.activity_date.localeCompare(b.activity_date)));
  const minutes = (value: Metric) => value === null ? null : Number(value) / 60;
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container), color = (name: string) => style.getPropertyValue(name).trim();
    const foreground = color('--foreground'), muted = color('--muted-foreground'), border = color('--border');
    chart.setOption({
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      textStyle: { color: foreground },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: color('--surface'), borderColor: border, textStyle: { color: foreground }, valueFormatter: (value: number | null) => value === null ? '—' : formatDuration(value * 60) },
      grid: { left: 55, right: 20, top: 30, bottom: 50 },
      xAxis: { type: 'category', data: ordered.map(run => run.activity_date), axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted } },
      yAxis: { type: 'value', name: '用时（分钟）', scale: true, nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: border } } },
      series: [{ name: '用时', type: 'line', connectNulls: false, data: ordered.map(run => minutes(run.duration_seconds)), itemStyle: { color: color('--chart-series') }, lineStyle: { color: color('--chart-series') } }]
    }, { notMerge: true });
  }
  $effect(() => { ordered; if (mounted) draw(); });
  onMount(() => {
    let disposed = false, observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => {
      try { const ec = await import('./trend-chart-runtime'); if (disposed) return; chart = ec.init(container); mounted = true; draw(); observer = new ResizeObserver(() => chart?.resize()); observer.observe(container); }
      catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; }
    })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>
{#if message}<p role="status">{message}</p>{/if}
<div bind:this={container} class="h-72 w-full" role="img" aria-label="历次用时趋势，下方提供完整数据表"></div>
<details class="mt-3"><summary class="cursor-pointer text-sm text-primary">查看趋势数据</summary>
  <div class="mt-3 max-h-80 overflow-auto"><table class="w-full text-left text-sm"><thead><tr><th>日期</th><th>用时</th></tr></thead><tbody>
    {#each ordered as run}<tr class="border-t border-border"><td class="py-2">{run.activity_date}</td><td>{run.duration_seconds === null ? '—' : formatDuration(run.duration_seconds)}{#if run.duration_seconds === null}<span class="sr-only">未记录用时</span>{/if}</td></tr>{/each}
  </tbody></table></div>
</details>
```

- [ ] **Step 6: 写详情页**

`frontend/src/routes/routes/[id]/+page.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import RouteGroupTrend from '#lib/components/RouteGroupTrend.svelte';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { readRouteGroup as scoped_readRouteGroup, shapeRoute, RouteGroupError, type RouteGroupDetail } from '#lib/api/route-groups.ts';
  const view = useViewContext();
  const readRouteGroup = view.bind(scoped_readRouteGroup, 2);
  let data = $state<RouteGroupDetail | null>(null), loading = $state(true), message = $state('');
  let requestId = 0, disposed = false, controller: AbortController | undefined;
  const route = $derived(data ? shapeRoute(data.shape) : null);
  async function load() {
    const id = ++requestId; controller?.abort(); controller = new AbortController();
    loading = true; message = '';
    try {
      const result = await readRouteGroup(page.params.id ?? '', controller.signal);
      if (disposed || id !== requestId) return;
      data = result;
    } catch (cause) {
      if (disposed || id !== requestId || controller.signal.aborted) return;
      if (cause instanceof RouteGroupError && cause.status === 401) { data = null; window.location.replace('/admin?reason=changed'); return; }
      data = null; message = cause instanceof Error ? cause.message : '无法读取路线，请重试';
    } finally { if (!disposed && id === requestId) loading = false; }
  }
  onMount(() => { disposed = false; void load(); return () => { disposed = true; ++requestId; controller?.abort(); }; });
</script>
<svelte:head><title>{pageTitle('常跑路线详情', page.data.site)}</title></svelte:head>
<PageHeader title={data ? `约 ${formatDistance(data.median_distance_m)} 路线` : '常跑路线'} description={data ? `${data.first_date} – ${data.last_date} · 共 ${data.run_count} 次` : undefined} />
<div class="detail">
  <a class="button-secondary back" href={view.href('/routes')}>返回常跑路线</a>
  {#if loading}<PageSkeleton title="正在读取路线…" />{/if}
  {#if message}<FeedbackState kind="error" title={message}><button class="button-secondary" onclick={load}>重新读取</button></FeedbackState>{/if}
  {#if data && route}
    <div data-testid="route-detail-ready" class="stack">
      <dl class="facts">
        <div><dt>最佳用时</dt><dd>{formatDuration(data.best_duration_seconds)}</dd></div>
        <div><dt>平均用时</dt><dd>{formatDuration(data.avg_duration_seconds)}</dd></div>
        <div><dt>最佳配速</dt><dd>{formatPace(data.best_pace_seconds_per_km)}</dd></div>
        <div><dt>平均配速</dt><dd>{formatPace(data.avg_pace_seconds_per_km)}</dd></div>
      </dl>
      <RouteMap {route} spacious />
      <section aria-label="历次用时趋势"><h2>历次用时</h2><RouteGroupTrend runs={data.runs} /></section>
      <section aria-label="历次成绩"><h2>成绩列表</h2>
        <div class="table-wrap"><table><thead><tr><th>日期</th><th>标题</th><th>距离</th><th>用时</th><th>配速</th></tr></thead><tbody>
          {#each data.runs as run (run.activity_id)}
            <tr data-testid="route-run-row"><td>{run.activity_date}</td><td><a href={view.href(`/activities/${run.activity_id}`)}>{run.title || '未命名活动'}</a></td><td>{formatDistance(run.distance_m)}</td><td>{run.duration_seconds === null ? '—' : formatDuration(run.duration_seconds)}</td><td>{formatPace(run.avg_pace_seconds_per_km)}</td></tr>
          {/each}
        </tbody></table></div>
      </section>
    </div>
  {/if}
</div>
<style>
  .detail, .stack { display: grid; gap: var(--space-4); min-width: 0; }
  .detail { margin-top: var(--space-6); }
  .back { justify-self: start; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .75rem; }
  dt { color: var(--muted-foreground); font-size: .8125rem; }
  dd { font-weight: 650; font-variant-numeric: tabular-nums; }
  h2 { font-weight: 650; margin-bottom: .5rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; text-align: left; font-size: .875rem; }
  th, td { padding: .5rem .75rem .5rem 0; white-space: nowrap; }
  tbody tr { border-top: 1px solid var(--border); }
</style>
```

- [ ] **Step 7: 写包装页与导航入口**

六个包装页内容均为：

```svelte
<script lang="ts">
  import Content from "<相对路径>";
</script>
<Content />
```

| 文件 | `<相对路径>` |
|---|---|
| `routes/workspace/routes/+page.svelte` | `../../routes/+page.svelte` |
| `routes/workspace/routes/[id]/+page.svelte` | `../../../routes/[id]/+page.svelte` |
| `routes/p/[username]/routes/+page.svelte` | `../../../routes/+page.svelte` |
| `routes/p/[username]/routes/[id]/+page.svelte` | `../../../../routes/[id]/+page.svelte` |

（对照既有 `routes/p/[username]/footprints/+page.svelte` 的 `../../../footprints/+page.svelte` 逐级核对；`pnpm check` 会在路径错误时报错。）

编辑 `frontend/src/lib/components/AppNavigation.svelte`：在 `{ href: '/footprints', ... }` 之后加

```ts
    { href: '/routes', label: '常跑路线', path: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5' },
```

- [ ] **Step 8: 运行测试**

Run（`frontend/`）: `pnpm check` → 无错误。
Run: `pnpm test` → 单元全部通过。
Run: `pnpm exec playwright test --config playwright.route-groups.config.ts` → 全部通过。若选择器因既有组件结构不符失败，调整规格选择器，不放宽可访问性断言。
Run: `pnpm build` → 成功（既有 chunk 警告属已知）。
手动检查：浅/深色、375 px 宽度、键盘 Tab 可达排序按钮与卡片链接且焦点可见；未能在真实浏览器中检查的项如实列为“未运行”。

- [ ] **Step 9: Commit（需用户授权）**

```bash
git add frontend/src/lib/components/RouteGroupCard.svelte frontend/src/lib/components/RouteGroupTrend.svelte frontend/src/lib/components/AppNavigation.svelte frontend/src/routes/routes frontend/src/routes/workspace/routes frontend/src/routes/p/\[username\]/routes frontend/tests/ui/route-groups.spec.ts frontend/playwright.route-groups.config.ts
git commit -m "feat: frequent routes list and detail pages"
```

---

### Task 7: 文档与交付验证

**Files:**
- Create: `docs/NN-frequent-routes.md`（编号取 `ls docs/` 现有最大编号 +1；当前最大为 69，现场再确认）
- Modify: 若 `docs/design-system/` 的 patterns 文档列出“卡片网格 + 排序切换”类模式，则补一行引用 `RouteGroupCard`（先 `grep -n "FootprintMap\|卡片" docs/design-system/patterns.md`，没有对应小节则不改）

**Interfaces:** 无新增接口。

- [ ] **Step 1: 汇总真实验证证据**

依次实际运行并记录输出（不引用历史数字）：

```bash
cd backend && .venv/bin/pytest tests/unit -q
.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests
.venv/bin/alembic heads
# 有授权的 _test 库时（环境变量只在进程内注入）：
.venv/bin/pytest tests/integration/test_route_groups.py tests/integration/test_showcase.py tests/integration/test_province_cache.py tests/integration/test_footprint_snapshots.py -q
cd ../frontend && pnpm test && pnpm check && pnpm build
pnpm exec playwright test --config playwright.route-groups.config.ts
```

- [ ] **Step 2: 写 `docs/NN-frequent-routes.md`**

中文，必须含三节：

1. **使用方式**：入口 `/routes`（根展示）、`/workspace/routes`、`/p/{username}/routes`；归类在导入后由后台完成，列表带“正在整理路线”；仅列出跑过 ≥2 次的路线；阈值（1 km、15%、50 米、80%）与算法版本 `route-groups-v1`。
2. **接口与隐私**：四组端点（工作区与展示，含具名）、参数、响应字段白名单；说明公开展示按完整展示规则含轨迹、旧版摘要分享不涉及；未包含邮箱、备注、文件名、原始 GPX；`building` 语义；首次升级后的全量归类由 worker 分批完成。
3. **验证记录**：粘贴 Step 1 的真实命令与输出摘要，分别列出“实际运行”“因无授权测试库/浏览器而未运行”的项；列出剩余风险：阈值在真实数据上的效果未验证、开发库迁移需用户授权并遵循“备份 → 恢复演练 → 受控单次升级 → 复核”、桥接组被删除后不会自动拆分。

- [ ] **Step 3: 交付说明**

按 AGENTS.md 第 12 节输出：改动范围（后端/前端/文档/测试分列）、验证结果（真实命令与数量）、未确认事项（开发服务未重启，新接口未在运行实例上验证；开发库未升级到 `0015_route_groups`，升级前 `/api/health` 会因 revision 不匹配返回 503）、未受影响部分（既有足迹、省份缓存、分享图行为与接口未改）。

- [ ] **Step 4: Commit（需用户授权）**

```bash
git add docs/NN-frequent-routes.md docs/superpowers/specs/2026-10-23-frequent-routes-design.md docs/superpowers/plans/2026-10-23-frequent-routes.md
git commit -m "docs: frequent routes design, plan and verification record"
```
