# 按附近地物自动命名跑步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新导入的跑步在标题为默认标题时，由后台根据轨迹附近的本地地物改成「湖边跑步」等；已有记录通过离线脚本预览、应用、还原。

**Architecture:** 离线脚本把 OSM 区域文件中的湖/河/海/公园/操场导入本地表 `place_features`（geography）。导入服务在创建活动的同一事务里把默认标题的活动写入队列表 `activity_place_names`（`pending`）；`run_scan` 在 `fill_route_groups` 之后调用 `fill_place_titles` 处理 `pending`：沿轨迹每约 200 米采样，统计各类别 100 米内的份额，达标则乐观更新标题。历史记录由 `scripts/backfill-place-titles.py` 复用同一识别函数，默认只预览。

**Tech Stack:** FastAPI + SQLAlchemy 2.1（同步）+ PostGIS 3.6 + Alembic；本机 `osmium` 命令行（仅离线脚本）；pytest。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-10-23-place-titles-design.md`。与本计划冲突时以设计文档为准。
- 非容器化：不得引入 Docker/Compose。
- 隐私：不向任何第三方发送坐标/轨迹；识别只读本地表；名称只含类别词。
- 服务层同步普通函数；时间用 `request.app.state.clock()`（离线脚本不属于业务代码，允许在脚本里取当前时间用于日志文件名）。
- 迁移手写，下一个序号 `0016_place_titles`，`down_revision = "0015_route_groups"`（动手前 `ls backend/migrations/versions/` 与 `alembic heads` 确认）；降级有数据时 `raise RuntimeError`。新模型注册到 `app/models/__init__.py`。**新增迁移后必须同步更新 `backend/tests/unit/test_schema.py` 中写死的 head 与表集合**（上一轮因漏做出现过回归）。
- 枚举用 `String(n)` + 具名 `CheckConstraint`；不使用 `relationship()`；时间列 `DateTime(timezone=True)` + `server_default=func.now()`；`place_features` 是全局参考数据（无 `user_id`），`activity_place_names` 是用户数据（`user_id` CASCADE）。
- 写活动标题前 `lock_owner(db, owner)`（`app/modules/activities/service.py`）并让 `activity_data_version += 1`。
- 改名条件：仅当标题恰好等于 `跑步 · {activity_date}`；用乐观条件 `WHERE title = '跑步 · ' || activity_date::text`。
- 不在开发库执行迁移；集成测试只作用于名称以 `_test` 结尾、列入 `TEST_DATABASE_ALLOWED_TARGETS` 的库，只在进程环境注入测试变量，不修改 `.env`，不打印 DSN/密钥。补全脚本 `--apply` 对开发库/生产库都需用户明确授权并先备份；助手不运行 `--apply`，不部署。
- 不把真实 OSM 数据、真实轨迹写入仓库或测试夹具；只用合成数据。
- 先跑最小相关测试，最后补回归；报告“实际运行/未运行”，集成用例被跳过不等于通过。
- 提交：用户已授权本次执行中按任务提交（显式 `git add` 文件，不用 `-A`，不 push，提交信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾）。

## File Structure

| 文件 | 职责 |
|---|---|
| `backend/app/modules/place_titles/__init__.py` | 空文件 |
| `backend/app/modules/place_titles/model.py` | `PlaceFeature`、`ActivityPlaceName` 映射 |
| `backend/app/modules/place_titles/rules.py` | 类别词表、阈值、`choose_category`、`default_title`（纯函数，无 DB） |
| `backend/app/modules/place_titles/queue.py` | `enqueue`（仅依赖 sqlalchemy，供导入服务引用，避免循环导入） |
| `backend/app/modules/place_titles/service.py` | `has_places`、`measure_shares`、`resolve`、`apply_title`、`fill_place_titles` |
| `backend/app/modules/place_titles/backfill.py` | `collect`、`apply_proposals`、`revert_log`（供脚本与测试调用） |
| `backend/app/modules/place_titles/osm.py` | OSM 特征 → 类别映射、GeoJSON 行解析、`import_region`（供脚本与测试调用） |
| `scripts/osm-places.py` | 离线：调用 `osmium` 并导入 `place_features` |
| `scripts/backfill-place-titles.py` | 离线：预览 / 应用 / 还原 |
| `backend/migrations/versions/0016_place_titles.py` | 两张表 |

修改：`backend/app/models/__init__.py`、`backend/tests/unit/test_schema.py`、`backend/app/modules/footprints/worker.py`（`run_scan`）、`backend/app/modules/gpx/service.py`（`import_track`）、`backend/app/modules/mifitness/service.py`。

测试：`backend/tests/unit/test_place_titles_migration.py`、`test_place_titles_rules.py`、`test_place_titles_osm.py`，`backend/tests/integration/test_place_titles.py`。

---

### Task 1: 数据模型与迁移

**Files:**
- Create: `backend/app/modules/place_titles/__init__.py`（空）、`model.py`
- Create: `backend/migrations/versions/0016_place_titles.py`
- Modify: `backend/app/models/__init__.py`、`backend/tests/unit/test_schema.py`
- Test: `backend/tests/unit/test_place_titles_migration.py`

**Interfaces:**
- Produces: 表 `place_features(id, category, geom, region, imported_at)`、`activity_place_names(activity_id PK, user_id, state, category, share, applied_title, algorithm_version, updated_at)`；ORM 类 `PlaceFeature`、`ActivityPlaceName`。

- [ ] **Step 1: 写失败的迁移单元测试**

`backend/tests/unit/test_place_titles_migration.py`（照 `test_route_groups_migration.py` 的写法）：

```python
import importlib.util
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load():
    source = Path(__file__).parents[2] / "migrations/versions/0016_place_titles.py"
    spec = importlib.util.spec_from_file_location("place_titles_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ddl_matches_the_models_and_downgrade_refuses_to_drop_data(monkeypatch):
    from app.models import Base

    module = load()
    assert module.down_revision == "0015_route_groups"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    for name in ("place_features", "activity_place_names"):
        assert f"CREATE TABLE {name}" in sql
        assert all(column.name in sql for column in Base.metadata.tables[name].columns)
    assert "geography(GEOMETRY,4326)" in sql.replace(" ", "")
    assert "ix_place_features_geom" in sql and "gist" in sql
    assert "FOREIGN KEY(activity_id, user_id)" in sql and "ON DELETE CASCADE" in sql
    assert "'pending'" in sql and "'done'" in sql and "'skipped'" in sql
    assert "'lake'" in sql and "'stadium'" in sql

    dropped = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert dropped == []
```

- [ ] **Step 2: 运行确认失败**

Run（`backend/`）：`.venv/bin/pytest tests/unit/test_place_titles_migration.py -q` → FAIL（找不到迁移文件）。

- [ ] **Step 3: 写模型**

`backend/app/modules/place_titles/model.py`：

```python
"""Local place features and the naming queue; both are replaceable derivatives."""

from datetime import datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geography, WKBElement
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlaceFeature(Base):
    """Reference geometry from a locally imported OpenStreetMap region; no names or tags."""

    __tablename__ = "place_features"
    __table_args__ = (
        CheckConstraint(
            "category IN ('lake','river','sea','park','stadium')", name="category"
        ),
        Index("ix_place_features_geom", "geom", postgresql_using="gist"),
        Index("ix_place_features_region", "region"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    category: Mapped[str] = mapped_column(String(16))
    geom: Mapped[WKBElement] = mapped_column(
        Geography("GEOMETRY", srid=4326, spatial_index=False)
    )
    region: Mapped[str] = mapped_column(String(64))
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ActivityPlaceName(Base):
    __tablename__ = "activity_place_names"
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint("state IN ('pending','done','skipped')", name="state"),
        CheckConstraint("share IS NULL OR (share >= 0 AND share <= 1)", name="share_range"),
        Index("ix_activity_place_names_state", "state"),
    )

    activity_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    state: Mapped[str] = mapped_column(String(10), server_default="pending")
    category: Mapped[str | None] = mapped_column(String(16))
    share: Mapped[float | None] = mapped_column(Float)
    applied_title: Mapped[str | None] = mapped_column(String(120))
    algorithm_version: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

创建空文件 `backend/app/modules/place_titles/__init__.py`。

- [ ] **Step 4: 写迁移**

`backend/migrations/versions/0016_place_titles.py`：

```python
"""Local place features and the queue that names runs after nearby places."""

import geoalchemy2
import sqlalchemy as sa
from alembic import op

revision = "0016_place_titles"
down_revision = "0015_route_groups"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_features",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geography(
                geometry_type="GEOMETRY",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=False,
        ),
        sa.Column("region", sa.String(64), nullable=False),
        sa.Column(
            "imported_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("category IN ('lake','river','sea','park','stadium')", name="category"),
    )
    op.create_index("ix_place_features_geom", "place_features", ["geom"], postgresql_using="gist")
    op.create_index("ix_place_features_region", "place_features", ["region"])
    op.create_table(
        "activity_place_names",
        sa.Column("activity_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("state", sa.String(10), server_default="pending", nullable=False),
        sa.Column("category", sa.String(16), nullable=True),
        sa.Column("share", sa.Float(), nullable=True),
        sa.Column("applied_title", sa.String(120), nullable=True),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("state IN ('pending','done','skipped')", name="state"),
        sa.CheckConstraint("share IS NULL OR (share >= 0 AND share <= 1)", name="share_range"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_activity_place_names_user_id", "activity_place_names", ["user_id"])
    op.create_index("ix_activity_place_names_state", "activity_place_names", ["state"])


def downgrade():
    bind = op.get_bind()
    for table in ("activity_place_names", "place_features"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise RuntimeError(f"Refusing to drop {table} that already holds data")
    op.drop_table("activity_place_names")
    op.drop_table("place_features")
```

- [ ] **Step 5: 注册模型并更新写死的 head 测试**

`backend/app/models/__init__.py`：在 `from app.modules.mifitness.model import MifitnessImport` 之后加 `from app.modules.place_titles.model import ActivityPlaceName, PlaceFeature`，并在 `__all__` 末尾加 `"ActivityPlaceName", "PlaceFeature",`（保持 isort：`place_titles` 排在 `mifitness` 之后、`route_groups` 之前）。

`backend/tests/unit/test_schema.py`：先 `grep -n "0015_route_groups\|route_groups" backend/tests/unit/test_schema.py` 找到写死 head 与表集合的位置，把 head 期望改为 `0016_place_titles`，把 `place_features`、`activity_place_names` 加入表集合（保持各用例原意；若用例枚举完整迁移链则在末尾追加 `0016_place_titles`）。

- [ ] **Step 6: 运行并 lint**

Run: `.venv/bin/pytest tests/unit -q` → 全部通过（含 `test_schema.py`）。
Run: `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests` → 通过。
Run: `.venv/bin/alembic heads` → 只有一个 head `0016_place_titles`。

- [ ] **Step 7: Commit**

```bash
git add backend/app/modules/place_titles/__init__.py backend/app/modules/place_titles/model.py backend/migrations/versions/0016_place_titles.py backend/app/models/__init__.py backend/tests/unit/test_schema.py backend/tests/unit/test_place_titles_migration.py
git commit -m "feat: add place feature and place name queue tables"
```

---

### Task 2: 命名规则（纯函数）

**Files:**
- Create: `backend/app/modules/place_titles/rules.py`
- Test: `backend/tests/unit/test_place_titles_rules.py`

**Interfaces:**
- Produces（`rules.py`）：
  - 常量 `ALGORITHM_VERSION = "place-titles-v1"`、`STEP_M = 200`、`MAX_SAMPLES = 500`、`RADIUS_M = 100`、`MIN_SHARE = 0.4`、`MIN_DISTANCE_M = 1000`
  - `CATEGORIES = ("sea", "lake", "river", "park", "stadium")`（即并列时的优先级顺序）
  - `TITLE_WORDS: dict[str, str]`（`sea`→`海边跑步` 等）
  - `choose_category(total: int, near: dict[str, int]) -> tuple[str, float] | None`
  - `title_for(category: str) -> str`
  - `default_title(activity_date: date) -> str`

- [ ] **Step 1: 写失败的测试**

`backend/tests/unit/test_place_titles_rules.py`：

```python
from datetime import date

import pytest

from app.modules.place_titles import rules


def test_default_title_matches_the_importers():
    assert rules.default_title(date(2025, 3, 9)) == "跑步 · 2025-03-09"


def test_title_words_cover_every_category():
    assert rules.TITLE_WORDS == {
        "sea": "海边跑步",
        "lake": "湖边跑步",
        "river": "河边跑步",
        "park": "公园跑步",
        "stadium": "操场跑步",
    }
    assert set(rules.CATEGORIES) == set(rules.TITLE_WORDS)
    assert rules.title_for("lake") == "湖边跑步"


def test_the_largest_share_wins_when_it_reaches_the_threshold():
    assert rules.choose_category(10, {"lake": 6, "river": 3}) == ("lake", 0.6)


def test_a_share_below_the_threshold_names_nothing():
    assert rules.choose_category(10, {"lake": 3}) is None
    assert rules.choose_category(10, {"lake": 4}) == ("lake", 0.4)  # boundary is inclusive


def test_ties_follow_the_fixed_priority():
    assert rules.choose_category(10, {"park": 5, "sea": 5})[0] == "sea"
    assert rules.choose_category(10, {"stadium": 5, "river": 5})[0] == "river"
    assert rules.choose_category(10, {"river": 5, "lake": 5})[0] == "lake"


def test_empty_or_invalid_inputs_name_nothing():
    assert rules.choose_category(0, {"lake": 1}) is None
    assert rules.choose_category(10, {}) is None
    assert rules.choose_category(10, {"unknown": 9}) is None
    with pytest.raises(ValueError):
        rules.title_for("unknown")
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/unit/test_place_titles_rules.py -q` → FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`backend/app/modules/place_titles/rules.py`：

```python
"""Pure naming rules: which nearby place category names a run, and the title it gets."""

from datetime import date

ALGORITHM_VERSION = "place-titles-v1"
STEP_M = 200
# Upper bound on sampled points per run, so a very long track cannot blow up the join.
MAX_SAMPLES = 500
RADIUS_M = 100
MIN_SHARE = 0.4
MIN_DISTANCE_M = 1000
# Order is also the tie-break priority.
CATEGORIES = ("sea", "lake", "river", "park", "stadium")
TITLE_WORDS = {
    "sea": "海边跑步",
    "lake": "湖边跑步",
    "river": "河边跑步",
    "park": "公园跑步",
    "stadium": "操场跑步",
}


def default_title(activity_date: date) -> str:
    """The title the importers give a run when the user did not name it."""
    return f"跑步 · {activity_date}"


def title_for(category: str) -> str:
    if category not in TITLE_WORDS:
        raise ValueError(f"Unknown place category: {category}")
    return TITLE_WORDS[category]


def choose_category(total: int, near: dict[str, int]) -> tuple[str, float] | None:
    """Highest share of sampled points near a category, if it reaches MIN_SHARE."""
    if total <= 0:
        return None
    best = None
    for category in CATEGORIES:
        share = near.get(category, 0) / total
        if share >= MIN_SHARE and (best is None or share > best[1]):
            best = (category, share)
    return best
```

（`>` 保证并列时保留先出现的高优先级类别。）

- [ ] **Step 4: 运行并 lint**

Run: `.venv/bin/pytest tests/unit/test_place_titles_rules.py -q` → PASS。`ruff check` 与 `ruff format --check` → 通过。

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/place_titles/rules.py backend/tests/unit/test_place_titles_rules.py
git commit -m "feat: place title naming rules"
```

---

### Task 3: 识别、入队与后台命名

**Files:**
- Create: `backend/app/modules/place_titles/queue.py`、`service.py`
- Modify: `backend/app/modules/footprints/worker.py`（`run_scan` 中 `fill_route_groups` 之后）、`backend/app/modules/gpx/service.py`（`import_track`）、`backend/app/modules/mifitness/service.py`
- Test: `backend/tests/integration/test_place_titles.py`

**Interfaces:**
- Consumes: Task 1 的表；Task 2 的 `rules`。
- Produces：
  - `queue.enqueue(db, owner: UUID, activity_id: UUID) -> None`（`INSERT … ON CONFLICT DO NOTHING`，`pending`，当前 `ALGORITHM_VERSION`）
  - `service.has_places(db) -> int`
  - `service.measure_shares(db, activity_id: UUID) -> tuple[int, dict[str, int]]`（采样点总数，各类别靠近的采样点数）
  - `service.resolve(db, activity_id: UUID) -> tuple[str, float] | None`（距离不足 `MIN_DISTANCE_M` 返回 `None`）
  - `service.apply_title(db, owner: UUID, activity_id: UUID, new_title: str) -> bool`
  - `service.fill_place_titles(session_factory, *, limit=20, stop_event=None) -> int`
  - 导入端：GPX/TCX/小米运动健康在创建默认标题活动的同一事务内调用 `enqueue`。

- [ ] **Step 1: 写失败的集成测试**

`backend/tests/integration/test_place_titles.py`（需 `_test` 库；沿用 `test_route_groups.py` 的 `ring`、`add_run`、`quiet` 写法，先 `Read` 该文件复制这三个辅助函数的定义到本文件，保持各文件自包含；`add_run` 需额外支持 `title` 参数，默认 `None` 表示使用默认标题 `rules.default_title(day)`）：

```python
"""Place-based run naming against a real PostGIS test database: synthetic geometry only."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.modules.place_titles import queue, rules, service
from tests.integration.test_gpx_import import clients, register, upload  # noqa: F401

pytestmark = pytest.mark.integration  # clients is requested by name

# ring(), add_run(), quiet() copied from test_route_groups.py; add_run(title=None) stores
# rules.default_title(day) when no title is given.


def add_place(app, category, polygon_lonlat, region="synthetic-test"):
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in polygon_lonlat) + "))"
    with app.state.session_factory.begin() as db:
        db.execute(
            text(
                "INSERT INTO place_features (id, category, geom, region) "
                "VALUES (gen_random_uuid(), :c, ST_GeogFromText(:w), :r)"
            ),
            {"c": category, "w": f"SRID=4326;{wkt}", "r": region},
        )


def clear_places(app, region="synthetic-test"):
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM place_features WHERE region = :r"), {"r": region})


def box_around_ring(margin_m=0, shift_east_m=0):
    """A lake-sized box that fully covers the synthetic 300 m loop (plus margin)."""
    from math import cos, radians

    scale = METRES * cos(radians(LAT))
    west, east = LON - (margin_m - shift_east_m) / scale, LON + (300 + margin_m + shift_east_m) / scale
    south, north = LAT - margin_m / METRES, LAT + (300 + margin_m) / METRES
    return [(west, south), (east, south), (east, north), (west, north), (west, south)]


def queue_state(app, activity):
    with app.state.session_factory() as db:
        return db.execute(
            text("SELECT state, category, applied_title FROM activity_place_names WHERE activity_id=:a"),
            {"a": UUID(activity)},
        ).first()


def title_of(app, activity):
    with app.state.session_factory() as db:
        return db.scalar(text("SELECT title FROM activities WHERE id=:a"), {"a": UUID(activity)})


def enqueue(app, owner, activity):
    with app.state.session_factory.begin() as db:
        queue.enqueue(db, UUID(owner), UUID(activity))


def fill(app):
    return service.fill_place_titles(app.state.session_factory)


def test_a_run_along_a_lake_is_renamed_and_the_data_version_moves(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "lake", box_around_ring(margin_m=0))
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 1, 1))
    enqueue(app, owner, activity)
    with app.state.session_factory() as db:
        before = db.scalar(text("SELECT activity_data_version FROM users WHERE id=:o"), {"o": UUID(owner)})
    assert fill(app) >= 1
    assert title_of(app, activity) == "湖边跑步"
    assert queue_state(app, activity) == ("done", "lake", "湖边跑步")
    with app.state.session_factory() as db:
        after = db.scalar(text("SELECT activity_data_version FROM users WHERE id=:o"), {"o": UUID(owner)})
    assert after == before + 1
    clear_places(app)


def test_far_from_any_place_or_too_short_or_user_named_is_left_alone(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "lake", box_around_ring(margin_m=0, shift_east_m=5000))  # 5 km away
    owner = register(a)
    far = add_run(app, owner, ring(), day=date(2025, 2, 1))
    short = add_run(app, owner, ring(), day=date(2025, 2, 2), distance_m=500)
    named = add_run(app, owner, ring(), day=date(2025, 2, 3), title="我的晨跑")
    for activity in (far, short, named):
        enqueue(app, owner, activity)
    fill(app)
    assert title_of(app, far) == rules.default_title(date(2025, 2, 1))
    assert title_of(app, short) == rules.default_title(date(2025, 2, 2))
    assert title_of(app, named) == "我的晨跑"
    assert [queue_state(app, x)[0] for x in (far, short, named)] == ["skipped"] * 3
    clear_places(app)


def test_an_empty_place_table_keeps_the_queue_pending(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    with app.state.session_factory() as db:
        if service.has_places(db):
            pytest.skip("shared test database already holds place features")
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 3, 1))
    enqueue(app, owner, activity)
    assert fill(app) == 0
    assert queue_state(app, activity)[0] == "pending"


def test_the_priority_between_categories_follows_the_share(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "park", box_around_ring(margin_m=0))
    add_place(app, "sea", box_around_ring(margin_m=0))  # equal shares: sea wins
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 4, 1))
    enqueue(app, owner, activity)
    fill(app)
    assert title_of(app, activity) == "海边跑步"
    clear_places(app)


def test_a_title_edited_after_queueing_is_not_overwritten(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "river", box_around_ring(margin_m=0))
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 5, 1))
    enqueue(app, owner, activity)
    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='改过了' WHERE id=:a"), {"a": UUID(activity)})
    fill(app)
    assert title_of(app, activity) == "改过了"
    assert queue_state(app, activity)[0] == "skipped"
    clear_places(app)


def test_imports_without_a_title_are_queued_and_titled_imports_are_not(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    register(a)
    plain = upload(a)  # equator-six.gpx with no title field
    assert plain.status_code in (200, 201), plain.text
    activity = plain.json()["data"]["activity"]["id"]
    assert queue_state(app, activity)[0] == "pending"
    titled = upload(a, file="equator-six.gpx", fields={"title": "自己的名字"}, raw=None)
    # A duplicate upload is rejected; that is fine: only a new, titled activity matters here.
    if titled.status_code in (200, 201):
        assert queue_state(app, titled.json()["data"]["activity"]["id"]) is None


def test_the_footprint_scan_also_names_pending_runs(clients):  # noqa: F811
    from app.db.schema import get_expected_revision
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "lake", box_around_ring(margin_m=0))
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 6, 1))
    enqueue(app, owner, activity)
    run_scan(app.state.session_factory, app.state.clock(), get_expected_revision())
    assert title_of(app, activity) == "湖边跑步"
    clear_places(app)
```

实施者须按真实文件调整：`box_around_ring` 里不要 `import` 自身模块，直接引用同文件的 `LAT/LON/METRES`（从 `test_route_groups.py` 复制常量）；`upload()` 的参数与重复检测行为以 `tests/integration/test_gpx_import.py` 实际定义为准（若第二次上传因重复被拒，用 `fixtures/gpx/` 下另一份样例文件）；若某个断言因样例几何与阈值不符失败，先用 `service.measure_shares` 打印份额定位，调整测试样例而不是放宽阈值。

追加一条集成测试（长轨迹有界，来自常跑路线构建时的一次真实事故：对 30 万点轨迹做不可中断的长查询会拖垮 PostgreSQL）：构造一条约 100 km 长、10 万个点的合成轨迹（`generate_series` 生成缓慢折线即可，`distance_m` 取 ≥ 1000），在地物表放一个覆盖其中一段的 `lake` 面，调用 `service.measure_shares`，断言返回的采样点总数 `total <= rules.MAX_SAMPLES + 5` 且语句在几秒内完成；同时在 `test_place_titles_rules.py` 里断言 `MAX_SAMPLES == 500`。

- [ ] **Step 2: 运行确认失败**

在已授权升级到 `0016_place_titles` 的 `_test` 库上（只在进程环境注入 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS`，做法见 `docs/09-phase-two-progress.md`“运行测试”）：

`.venv/bin/pytest tests/integration/test_place_titles.py -q` → FAIL（`service`/`queue` 不存在）。若没有测试库，如实记录“集成测试未运行”，不得声称通过。

- [ ] **Step 3: 写 `queue.py`**

```python
"""Queue entry written inside the import transaction; kept free of other module imports."""

from uuid import UUID

from sqlalchemy import text

from app.modules.place_titles.rules import ALGORITHM_VERSION


def enqueue(db, owner: UUID, activity_id: UUID) -> None:
    db.execute(
        text(
            """INSERT INTO activity_place_names (activity_id, user_id, state, algorithm_version)
               VALUES (:activity, :owner, 'pending', :version)
               ON CONFLICT (activity_id) DO NOTHING"""
        ),
        {"activity": activity_id, "owner": owner, "version": ALGORITHM_VERSION},
    )
```

- [ ] **Step 4: 写 `service.py`**

```python
"""Name runs after nearby places: measure, decide, then update only still-default titles."""

import logging
from uuid import UUID

from sqlalchemy import text

from app.modules.activities.service import lock_owner
from app.modules.place_titles import rules

logger = logging.getLogger(__name__)
FILL_BATCH = 20

SHARES_SQL = text(
    """
WITH line AS (
    SELECT ST_Collect(s.geom ORDER BY s.segment_index) AS g,
           ST_Length(ST_Collect(s.geom ORDER BY s.segment_index)::geography) AS len
    FROM activity_segments s
    WHERE s.activity_id = :activity AND s.geom IS NOT NULL
), parts AS (
    SELECT p.geom AS geom, line.len AS len
    FROM line, LATERAL ST_Dump(line.g) AS p WHERE line.g IS NOT NULL
), samples AS (
    SELECT row_number() OVER () AS n, d.geom AS pt
    FROM (
        SELECT ST_LineInterpolatePoints(
                   parts.geom,
                   least(1.0, greatest(:step, parts.len / :max_samples)
                              / nullif(ST_Length(parts.geom::geography), 0)),
                   true
               ) AS pts
        FROM parts
    ) q, LATERAL ST_Dump(q.pts) AS d
), near AS (
    SELECT f.category, count(DISTINCT s.n) AS points
    FROM samples s
    JOIN place_features f ON ST_DWithin(f.geom, s.pt::geography, :radius)
    GROUP BY f.category
)
SELECT (SELECT count(*) FROM samples) AS total,
       coalesce((SELECT json_object_agg(category, points) FROM near), '{}'::json) AS near
"""
)


def has_places(db) -> int:
    return db.scalar(text("SELECT count(*) FROM place_features"))


def measure_shares(db, activity_id: UUID) -> tuple[int, dict[str, int]]:
    total, near = db.execute(
        SHARES_SQL,
        {
            "activity": activity_id,
            "step": rules.STEP_M,
            "max_samples": rules.MAX_SAMPLES,
            "radius": rules.RADIUS_M,
        },
    ).one()
    return int(total), {category: int(points) for category, points in near.items()}


def resolve(db, activity_id: UUID) -> tuple[str, float] | None:
    distance = db.scalar(
        text("SELECT distance_m FROM activities WHERE id = :activity"), {"activity": activity_id}
    )
    if distance is None or distance < rules.MIN_DISTANCE_M:
        return None
    total, near = measure_shares(db, activity_id)
    return rules.choose_category(total, near)


def apply_title(db, owner: UUID, activity_id: UUID, new_title: str) -> bool:
    """Optimistic: only a title that still equals the importer default is replaced."""
    user = lock_owner(db, owner)
    changed = db.execute(
        text(
            """UPDATE activities SET title = :title, updated_at = now()
               WHERE id = :activity AND user_id = :owner
                 AND title = '跑步 · ' || activity_date::text"""
        ),
        {"title": new_title, "activity": activity_id, "owner": owner},
    ).rowcount
    if changed:
        user.activity_data_version += 1
        db.flush()
    return bool(changed)


def _finish(db, activity_id, state, category=None, share=None, title=None):
    db.execute(
        text(
            """UPDATE activity_place_names
               SET state = :state, category = :category, share = :share,
                   applied_title = :title, algorithm_version = :version, updated_at = now()
               WHERE activity_id = :activity"""
        ),
        {
            "state": state,
            "category": category,
            "share": share,
            "title": title,
            "version": rules.ALGORITHM_VERSION,
            "activity": activity_id,
        },
    )


def fill_place_titles(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int:
    """Resolve queued runs; leaves them pending until some place data has been imported."""
    done = 0
    while stop_event is None or not stop_event.is_set():
        with session_factory() as db:
            if not has_places(db):
                return done
            db.execute(text("SET LOCAL statement_timeout = '10000ms'"))
            rows = db.execute(
                text(
                    """SELECT activity_id, user_id FROM activity_place_names
                       WHERE state = 'pending'
                       ORDER BY updated_at, activity_id
                       LIMIT :limit FOR UPDATE SKIP LOCKED"""
                ),
                {"limit": limit},
            ).all()
            if not rows:
                return done
            for activity_id, owner in rows:
                found = resolve(db, activity_id)
                if found is None:
                    _finish(db, activity_id, "skipped")
                    continue
                category, share = found
                title = rules.title_for(category)
                if apply_title(db, owner, activity_id, title):
                    _finish(db, activity_id, "done", category, share, title)
                else:
                    _finish(db, activity_id, "skipped", category, share)
            db.commit()
            done += len(rows)
    return done
```

注意：`apply_title` 里 `lock_owner` 会 `FOR UPDATE` 锁 users 行；同一批内多个活动属同一用户时在同一事务内重复加锁是安全的。若 `activities` 没有 `updated_at` 列，去掉 `updated_at = now()`（先 `grep -n updated_at backend/app/modules/activities/model.py` 确认；模型里存在则保留）。

- [ ] **Step 5: 接入 worker**

`backend/app/modules/footprints/worker.py`：在 `from app.modules.route_groups.groups import fill_route_groups` 之后加 `from app.modules.place_titles.service import fill_place_titles`；在 `run_scan` 中 `fill_route_groups` 的 `try/except` 之后、`return published` 之前加

```python
    try:
        fill_place_titles(session_factory, stop_event=stop_event)
    except Exception as error:
        # Titles stay pending and the next scan retries without leaking details.
        logger.warning("Place title fill unavailable (%s)", type(error).__name__)
```

（若分支上尚无 `fill_route_groups`，以 `fill_province_caches` 的 `try/except` 为锚点。）

- [ ] **Step 6: 导入入队**

`backend/app/modules/gpx/service.py`：顶部加 `from app.modules.place_titles.queue import enqueue as enqueue_place_title`；在 `import_track` 的 `with db.begin():` 块里，`persist_segments(...)` 之后、`user.activity_data_version += 1` 之前加

```python
                if not title:
                    enqueue_place_title(db, owner, activity.id)
```

`backend/app/modules/mifitness/service.py`：顶部加同样的导入；在 `if enrich_activity_id is None:` 创建活动的分支里，`if derived:` 的 `persist_segments(...)` 之后加

```python
                    enqueue_place_title(db, owner, activity.id)
```

（小米导入的默认标题始终是 `跑步 · {date}`；仅在有轨迹 `derived` 时才入队。实施前先 `Read` 两处上下文确认缩进与事务边界，入队必须与活动创建在同一事务内。TCX 与批量导入走 `import_track`，无需另改，用测试确认。）

- [ ] **Step 7: 运行测试与 lint**

Run: `.venv/bin/pytest tests/unit -q` → 全部通过。
Run: `.venv/bin/ruff format app tests && .venv/bin/ruff check app migrations tests`（`ruff format` 不折 SQL 字符串里的长行，E501 时手工折行）。
Run（有测试库）: `.venv/bin/pytest tests/integration/test_place_titles.py tests/integration/test_gpx_import.py tests/integration/test_mifitness_import.py tests/integration/test_route_groups.py -q` → 通过；报告真实通过/跳过数。

- [ ] **Step 8: Commit**

```bash
git add backend/app/modules/place_titles/queue.py backend/app/modules/place_titles/service.py backend/app/modules/footprints/worker.py backend/app/modules/gpx/service.py backend/app/modules/mifitness/service.py backend/tests/integration/test_place_titles.py
git commit -m "feat: name new runs after nearby places in the background"
```

---

### Task 4: OSM 地物导入脚本

**Files:**
- Create: `backend/app/modules/place_titles/osm.py`、`scripts/osm-places.py`
- Test: `backend/tests/unit/test_place_titles_osm.py`、`backend/tests/integration/test_place_titles.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `place_features`。
- Produces（`osm.py`）：
  - `classify(properties: dict, geometry_type: str) -> str | None`
  - `MIN_AREA_M2 = {"lake": 10000, "park": 5000}`
  - `parse_line(line: str) -> tuple[str, dict] | None`（把一行 GeoJSON-seq 解析为 `(geometry_json, properties)`，非 Feature 返回 `None`）
  - `import_region(db, region: str, lines: Iterable[str]) -> dict[str, int]`（同一事务：先删该 `region` 再插入；返回各类别写入数）

- [ ] **Step 1: 写失败的单元测试**

`backend/tests/unit/test_place_titles_osm.py`：

```python
import json

from app.modules.place_titles import osm


def test_classify_maps_osm_tags_to_categories():
    cases = [
        ({"natural": "water", "water": "lake"}, "Polygon", "lake"),
        ({"natural": "water", "water": "reservoir"}, "MultiPolygon", "lake"),
        ({"natural": "water", "water": "river"}, "Polygon", "river"),
        ({"waterway": "river"}, "LineString", "river"),
        ({"waterway": "canal"}, "LineString", "river"),
        ({"natural": "coastline"}, "LineString", "sea"),
        ({"natural": "bay"}, "Polygon", "sea"),
        ({"leisure": "park"}, "Polygon", "park"),
        ({"leisure": "nature_reserve"}, "MultiPolygon", "park"),
        ({"leisure": "stadium"}, "Polygon", "stadium"),
        ({"leisure": "track", "sport": "running"}, "LineString", "stadium"),
    ]
    for properties, geometry, expected in cases:
        assert osm.classify(properties, geometry) == expected, properties


def test_classify_ignores_everything_else():
    assert osm.classify({"natural": "water", "water": "pond"}, "Polygon") is None
    assert osm.classify({"leisure": "track", "sport": "cycling"}, "LineString") is None
    assert osm.classify({"highway": "residential"}, "LineString") is None
    assert osm.classify({"natural": "water"}, "Point") is None
    assert osm.classify({"leisure": "park"}, "Point") is None
    assert osm.classify({}, "Polygon") is None


def test_parse_line_handles_record_separators_and_non_features():
    feature = {
        "type": "Feature",
        "properties": {"natural": "water", "water": "lake", "name": "ignored"},
        "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
    }
    parsed = osm.parse_line("\x1e" + json.dumps(feature) + "\n")
    assert parsed is not None
    geometry, properties = parsed
    assert json.loads(geometry)["type"] == "Polygon"
    assert properties["water"] == "lake"
    assert osm.parse_line("\n") is None
    assert osm.parse_line(json.dumps({"type": "FeatureCollection"})) is None
    assert osm.parse_line("not json") is None
```

- [ ] **Step 2: 运行确认失败**

Run: `.venv/bin/pytest tests/unit/test_place_titles_osm.py -q` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `osm.py`**

```python
"""Map OpenStreetMap features to place categories; used by the offline import script."""

import json
from collections import Counter
from collections.abc import Iterable

from sqlalchemy import text

MIN_AREA_M2 = {"lake": 10000, "park": 5000}
SIMPLIFY_DEGREES = 0.0001  # about ten metres
AREAL = {"Polygon", "MultiPolygon"}
LINEAR = {"LineString", "MultiLineString"}
BATCH = 500


def classify(properties: dict, geometry_type: str) -> str | None:
    areal, linear = geometry_type in AREAL, geometry_type in LINEAR
    if properties.get("natural") == "water" and areal:
        water = properties.get("water")
        if water in ("lake", "reservoir"):
            return "lake"
        if water == "river":
            return "river"
        return None
    if properties.get("waterway") in ("river", "canal") and linear:
        return "river"
    if properties.get("natural") == "coastline" and linear:
        return "sea"
    if properties.get("natural") == "bay" and areal:
        return "sea"
    if properties.get("leisure") in ("park", "nature_reserve") and areal:
        return "park"
    if properties.get("leisure") == "stadium" and areal:
        return "stadium"
    if (
        properties.get("leisure") == "track"
        and properties.get("sport") == "running"
        and (linear or areal)
    ):
        return "stadium"
    return None


def parse_line(line: str) -> tuple[str, dict] | None:
    """One GeoJSON-seq line; osmium prefixes records with an ASCII record separator."""
    try:
        feature = json.loads(line.strip().lstrip("\x1e"))
    except ValueError:
        return None
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        return None
    geometry, properties = feature.get("geometry"), feature.get("properties")
    if not isinstance(geometry, dict) or not isinstance(properties, dict):
        return None
    return json.dumps(geometry), properties


INSERT_SQL = text(
    """INSERT INTO place_features (id, category, geom, region)
       SELECT gen_random_uuid(), :category, g.geog, :region
       FROM (
           SELECT ST_Multi(ST_SimplifyPreserveTopology(
                      ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326), :tolerance))::geography AS geog
       ) g
       WHERE :min_area IS NULL OR ST_Area(g.geog) >= :min_area"""
)


def import_region(db, region: str, lines: Iterable[str]) -> dict[str, int]:
    """Replace one region atomically; tags other than the category are never stored."""
    db.execute(text("DELETE FROM place_features WHERE region = :region"), {"region": region})
    written: Counter = Counter()
    for line in lines:
        parsed = parse_line(line)
        if parsed is None:
            continue
        geometry, properties = parsed
        geometry_type = json.loads(geometry).get("type", "")
        category = classify(properties, geometry_type)
        if category is None:
            continue
        inserted = db.execute(
            INSERT_SQL,
            {
                "category": category,
                "region": region,
                "geometry": geometry,
                "tolerance": SIMPLIFY_DEGREES,
                "min_area": MIN_AREA_M2.get(category) if geometry_type in AREAL else None,
            },
        ).rowcount
        written[category] += inserted
    return dict(written)
```

- [ ] **Step 4: 写脚本**

`scripts/osm-places.py`（写法照 `scripts/site-owner.py`：`sys.path` 指向 `backend`，不打印 DSN，写库前输入库名确认，非交互终端拒绝）：

```python
#!/usr/bin/env python3
"""Import lakes, rivers, coast, parks and running tracks from a local OSM extract."""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.schema import get_expected_revision
from app.modules.place_titles.osm import import_region

FILTERS = [
    "nwr/natural=water,coastline,bay",
    "nwr/waterway=river,canal",
    "nwr/leisure=park,nature_reserve,stadium,track",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path, help="OSM .osm.pbf extract downloaded beforehand")
    parser.add_argument("--region", required=True, help="Label for this extract, e.g. zhejiang")
    args = parser.parse_args()
    if shutil.which("osmium") is None:
        raise SystemExit("未找到 osmium 命令行工具，请先安装 osmium-tool；未做任何更改")
    if not args.pbf.is_file():
        raise SystemExit("找不到指定的 OSM 文件；未做任何更改")
    settings = Settings()
    target = make_url(settings.database_url)
    label = f"{target.host}:{target.port or 5432}/{target.database}"
    engine = create_engine(settings.database_url, hide_parameters=True)
    try:
        with Session(engine) as db:
            if db.scalars(text("SELECT version_num FROM alembic_version")).all() != [
                get_expected_revision()
            ]:
                raise SystemExit("Schema is not current; no changes made")
            if not sys.stdin.isatty():
                raise SystemExit("Import requires an interactive terminal; no changes made")
            if (
                input(f"Replace region '{args.region}' at {label}? Type the database name: ")
                != target.database
            ):
                raise SystemExit("Cancelled; no changes made")
            with tempfile.TemporaryDirectory() as work:
                filtered, lines = Path(work) / "filtered.osm.pbf", Path(work) / "features.geojsons"
                subprocess.run(
                    ["osmium", "tags-filter", str(args.pbf), *FILTERS, "-o", str(filtered)],
                    check=True,
                )
                subprocess.run(
                    ["osmium", "export", str(filtered), "-f", "geojsonseq", "-o", str(lines)],
                    check=True,
                )
                with lines.open(encoding="utf-8") as handle:
                    written = import_region(db, args.region, handle)
            db.commit()
        print(f"Region '{args.region}' replaced at {label}: {written}")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 追加集成测试（`import_region` 的 SQL）**

向 `backend/tests/integration/test_place_titles.py` 追加（用合成 GeoJSON 行，不用真实 OSM）：

```python
def test_import_region_replaces_filters_by_area_and_stores_no_tags(clients):  # noqa: F811
    import json

    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    big = [[121.0, 31.0], [121.0, 31.01], [121.01, 31.01], [121.01, 31.0], [121.0, 31.0]]
    tiny = [[121.0, 31.0], [121.0, 31.0001], [121.0001, 31.0001], [121.0001, 31.0], [121.0, 31.0]]

    def line(properties, ring_):
        return "\x1e" + json.dumps(
            {"type": "Feature", "properties": properties,
             "geometry": {"type": "Polygon", "coordinates": [ring_]}}
        ) + "\n"

    lines = [
        line({"natural": "water", "water": "lake", "name": "x"}, big),
        line({"natural": "water", "water": "lake"}, tiny),  # below the area threshold
        line({"highway": "path"}, big),
    ]
    region = f"synthetic-{uuid4().hex[:8]}"
    with app.state.session_factory.begin() as db:
        assert osm.import_region(db, region, lines) == {"lake": 1}
    with app.state.session_factory.begin() as db:
        assert osm.import_region(db, region, lines[:1]) == {"lake": 1}  # replaced, not appended
        count = db.scalar(
            text("SELECT count(*) FROM place_features WHERE region = :r"), {"r": region}
        )
        assert count == 1
        columns = set(db.scalars(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='place_features'"
        )))
        assert columns == {"id", "category", "geom", "region", "imported_at"}
        db.execute(text("DELETE FROM place_features WHERE region = :r"), {"r": region})
```

- [ ] **Step 6: 运行与 lint**

Run: `.venv/bin/pytest tests/unit/test_place_titles_osm.py -q` → PASS。
Run（有测试库）: `.venv/bin/pytest tests/integration/test_place_titles.py -q` → 通过。
Run: `.venv/bin/ruff check app migrations tests ../scripts && .venv/bin/ruff format --check app migrations tests ../scripts/osm-places.py`。脚本文件名含连字符，不能被导入，不为它写导入式测试；`osmium` 调用部分在文档的验证记录中如实标注“未用真实 OSM 文件运行”，除非本机已装 `osmium` 并用合成 `.osm` 小文件演练过。

- [ ] **Step 7: Commit**

```bash
git add backend/app/modules/place_titles/osm.py scripts/osm-places.py backend/tests/unit/test_place_titles_osm.py backend/tests/integration/test_place_titles.py
git commit -m "feat: offline OSM place import"
```

---

### Task 5: 历史记录补全脚本（预览 / 应用 / 还原）

**Files:**
- Create: `backend/app/modules/place_titles/backfill.py`、`scripts/backfill-place-titles.py`
- Test: `backend/tests/integration/test_place_titles.py`（追加）

**Interfaces:**
- Consumes: Task 3 的 `service.resolve`、`service.apply_title`、`rules`。
- Produces（`backfill.py`）：
  - `@dataclass Proposal(activity_id: UUID, owner: UUID, activity_date: date, old_title: str, category: str | None, share: float | None, new_title: str | None)`
  - `collect(db, limit: int | None = None) -> list[Proposal]`：候选 = 标题仍为默认标题、且队列状态不是 `done` 的活动，按日期升序。
  - `apply_proposals(session_factory, proposals: list[Proposal], log_path: Path) -> dict[str, int]`：对 `new_title` 非空的逐条 `apply_title`；成功的写 `done` 队列行并追加 JSON 日志；返回 `{"applied": n, "changed_meanwhile": n, "unmatched": n}`。
  - `revert_log(session_factory, log_path: Path) -> dict[str, int]`：仅当当前标题仍等于日志里的新标题时还原；返回 `{"reverted": n, "skipped": n}`。

- [ ] **Step 1: 追加失败的集成测试**

```python
def test_backfill_previews_without_writing_then_applies_and_reverts(clients, tmp_path):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    add_place(app, "lake", box_around_ring(margin_m=0))
    owner = register(a)
    lakeside = add_run(app, owner, ring(), day=date(2025, 7, 1))
    named = add_run(app, owner, ring(), day=date(2025, 7, 2), title="我的晨跑")
    with app.state.session_factory() as db:
        proposals = [p for p in backfill.collect(db) if str(p.owner) == owner]
    assert [str(p.activity_id) for p in proposals] == [lakeside]  # user-named run is not a candidate
    assert proposals[0].new_title == "湖边跑步"
    assert title_of(app, lakeside) == rules.default_title(date(2025, 7, 1))  # preview wrote nothing

    log = tmp_path / "log.json"
    result = backfill.apply_proposals(app.state.session_factory, proposals, log)
    assert result == {"applied": 1, "changed_meanwhile": 0, "unmatched": 0}
    assert title_of(app, lakeside) == "湖边跑步" and title_of(app, named) == "我的晨跑"
    with app.state.session_factory() as db:
        assert [p for p in backfill.collect(db) if str(p.owner) == owner] == []  # done: not repeated

    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='手改' WHERE id=:a"), {"a": UUID(named)})
    assert backfill.revert_log(app.state.session_factory, log) == {"reverted": 1, "skipped": 0}
    assert title_of(app, lakeside) == rules.default_title(date(2025, 7, 1))
    assert backfill.revert_log(app.state.session_factory, log) == {"reverted": 0, "skipped": 1}
    clear_places(app)


def test_backfill_leaves_unmatched_runs_retryable_and_skips_edited_titles(clients, tmp_path):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    clear_places(app)
    owner = register(a)
    run = add_run(app, owner, ring(), day=date(2025, 8, 1))
    with app.state.session_factory() as db:
        proposals = [p for p in backfill.collect(db) if str(p.owner) == owner]
    assert proposals and proposals[0].new_title is None  # no places imported: nothing matches
    result = backfill.apply_proposals(app.state.session_factory, proposals, tmp_path / "l.json")
    assert result["unmatched"] == 1 and result["applied"] == 0
    with app.state.session_factory() as db:  # still a candidate once places exist
        assert [str(p.activity_id) for p in backfill.collect(db) if str(p.owner) == owner] == [run]
```

- [ ] **Step 2: 运行确认失败**

`.venv/bin/pytest tests/integration/test_place_titles.py -q -k backfill` → FAIL（模块不存在）；无测试库则如实记录未运行。

- [ ] **Step 3: 实现 `backfill.py`**

```python
"""One-off naming of existing runs: preview first, apply explicitly, revert from a log."""

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

from app.modules.place_titles import rules, service


@dataclass
class Proposal:
    activity_id: UUID
    owner: UUID
    activity_date: date
    old_title: str
    category: str | None
    share: float | None
    new_title: str | None


def collect(db, limit: int | None = None) -> list[Proposal]:
    rows = db.execute(
        text(
            """SELECT a.id, a.user_id, a.activity_date, a.title
               FROM activities a
               LEFT JOIN activity_place_names n ON n.activity_id = a.id
               WHERE a.title = '跑步 · ' || a.activity_date::text
                 AND (n.activity_id IS NULL OR n.state <> 'done')
               ORDER BY a.activity_date, a.id
               LIMIT :limit"""
        ),
        {"limit": limit},
    ).all()
    proposals = []
    for activity_id, owner, activity_date, title in rows:
        found = service.resolve(db, activity_id)
        category, share = found if found else (None, None)
        proposals.append(
            Proposal(
                activity_id,
                owner,
                activity_date,
                title,
                category,
                share,
                rules.title_for(category) if category else None,
            )
        )
    return proposals


def _record(db, proposal: Proposal, state: str, title: str | None):
    db.execute(
        text(
            """INSERT INTO activity_place_names
                   (activity_id, user_id, state, category, share, applied_title, algorithm_version)
               VALUES (:activity, :owner, :state, :category, :share, :title, :version)
               ON CONFLICT (activity_id) DO UPDATE SET
                   state = EXCLUDED.state, category = EXCLUDED.category, share = EXCLUDED.share,
                   applied_title = EXCLUDED.applied_title,
                   algorithm_version = EXCLUDED.algorithm_version, updated_at = now()"""
        ),
        {
            "activity": proposal.activity_id,
            "owner": proposal.owner,
            "state": state,
            "category": proposal.category,
            "share": proposal.share,
            "title": title,
            "version": rules.ALGORITHM_VERSION,
        },
    )


def apply_proposals(session_factory, proposals: list[Proposal], log_path: Path) -> dict[str, int]:
    counts = {"applied": 0, "changed_meanwhile": 0, "unmatched": 0}
    log = []
    for proposal in proposals:
        if proposal.new_title is None:
            counts["unmatched"] += 1  # not recorded, so a later run can try again
            continue
        with session_factory() as db:
            if service.apply_title(db, proposal.owner, proposal.activity_id, proposal.new_title):
                _record(db, proposal, "done", proposal.new_title)
                counts["applied"] += 1
                log.append(
                    {
                        "activity_id": str(proposal.activity_id),
                        "old_title": proposal.old_title,
                        "new_title": proposal.new_title,
                    }
                )
            else:
                counts["changed_meanwhile"] += 1
            db.commit()
        # Rewrite after every change so an interrupted run still leaves a usable log.
        log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    if not log_path.exists():
        log_path.write_text("[]", encoding="utf-8")
    return counts


def revert_log(session_factory, log_path: Path) -> dict[str, int]:
    counts = {"reverted": 0, "skipped": 0}
    for entry in json.loads(log_path.read_text(encoding="utf-8")):
        with session_factory() as db:
            owner = db.scalar(
                text("SELECT user_id FROM activities WHERE id = :a"),
                {"a": UUID(entry["activity_id"])},
            )
            if owner is None:
                counts["skipped"] += 1
                continue
            from app.modules.activities.service import lock_owner

            user = lock_owner(db, owner)
            changed = db.execute(
                text(
                    """UPDATE activities SET title = :old, updated_at = now()
                       WHERE id = :a AND title = :new"""
                ),
                {"old": entry["old_title"], "new": entry["new_title"], "a": UUID(entry["activity_id"])},
            ).rowcount
            if changed:
                user.activity_data_version += 1
                db.execute(
                    text(
                        "UPDATE activity_place_names SET state = 'skipped', applied_title = NULL, "
                        "updated_at = now() WHERE activity_id = :a"
                    ),
                    {"a": UUID(entry["activity_id"])},
                )
            counts["reverted" if changed else "skipped"] += 1
            db.commit()
    return counts
```

把函数内的 `from app.modules.activities.service import lock_owner` 提到文件顶部导入区（Ruff 的 I 规则会要求排序；放顶部即可）。`updated_at` 列存在与否沿用 Task 3 Step 4 的确认结果。

- [ ] **Step 4: 写脚本**

`scripts/backfill-place-titles.py`：

```python
#!/usr/bin/env python3
"""Name existing runs after nearby places: preview by default, write only with --apply."""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.schema import get_expected_revision
from app.modules.place_titles import backfill, service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the new titles")
    parser.add_argument("--revert", type=Path, metavar="LOG", help="restore titles from a log")
    parser.add_argument("--log-dir", type=Path, default=Path.cwd())
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    if args.apply and args.revert:
        raise SystemExit("--apply and --revert cannot be combined; no changes made")
    settings = Settings()
    target = make_url(settings.database_url)
    # Never print the connection URL, password or credentials.
    label = f"{target.host}:{target.port or 5432}/{target.database}"
    engine = create_engine(settings.database_url, hide_parameters=True)
    factory = sessionmaker(engine, class_=Session, expire_on_commit=False)
    try:
        with factory() as db:
            if db.scalars(text("SELECT version_num FROM alembic_version")).all() != [
                get_expected_revision()
            ]:
                raise SystemExit("Schema is not current; no changes made")
            if args.revert is None and not service.has_places(db):
                raise SystemExit("没有已导入的地物数据（先运行 scripts/osm-places.py）；未做任何更改")
            proposals = [] if args.revert else backfill.collect(db, args.limit)
        if args.revert:
            confirm(label, target.database, "Revert titles from the log")
            print(backfill.revert_log(factory, args.revert))
            return
        matched = [p for p in proposals if p.new_title]
        for proposal in matched:
            print(f"{proposal.activity_date} · {proposal.old_title} → {proposal.new_title}")
        print(
            f"候选 {len(proposals)} 条，命中 {len(matched)} 条，"
            f"未命中 {len(proposals) - len(matched)} 条（目标 {label}）"
        )
        if not args.apply:
            print("仅预览，未写入数据库；确认后加 --apply，并请先备份数据库")
            return
        confirm(label, target.database, "Apply the titles above (have you taken a backup?)")
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        log_path = args.log_dir / f"place-titles-{stamp}.json"
        print(backfill.apply_proposals(factory, proposals, log_path))
        print(f"还原日志：{log_path}")
    finally:
        engine.dispose()


def confirm(label, database, question):
    if not sys.stdin.isatty():
        raise SystemExit("This action requires an interactive terminal; no changes made")
    if input(f"{question} at {label}? Type the database name: ") != database:
        raise SystemExit("Cancelled; no changes made")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 运行与 lint**

Run（有测试库）: `.venv/bin/pytest tests/integration/test_place_titles.py -q` → 通过。
Run: `.venv/bin/ruff check app migrations tests ../scripts && .venv/bin/ruff format --check app migrations tests ../scripts/backfill-place-titles.py`。
脚本本身只做冒烟：`.venv/bin/python ../scripts/backfill-place-titles.py --help` 能打印帮助即可。**不得对开发库运行预览或 `--apply`**（预览会读取开发库；需用户授权后由用户运行）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/place_titles/backfill.py scripts/backfill-place-titles.py backend/tests/integration/test_place_titles.py
git commit -m "feat: preview, apply and revert place titles for existing runs"
```

---

### Task 6: 文档与交付验证

**Files:**
- Create: `docs/NN-place-titles.md`（编号 = `ls docs/` 最大编号 +1；写文档时现场确认）
- Modify: `README.md`（若 README 列出离线脚本，则追加两个脚本的一行说明；先 `grep -n "site-owner" README.md`，没有该清单则不改）

**Interfaces:** 无新增接口。

- [ ] **Step 1: 汇总真实验证证据**

依次实际运行并记录输出（不引用历史数字）：

```bash
cd backend && .venv/bin/pytest tests/unit -q
.venv/bin/ruff check app migrations tests ../scripts && .venv/bin/ruff format --check app migrations tests
.venv/bin/alembic heads
# 有授权的 _test 库时（环境变量只在进程内注入）：
.venv/bin/pytest tests/integration/test_place_titles.py tests/integration/test_gpx_import.py tests/integration/test_mifitness_import.py tests/integration/test_route_groups.py tests/integration/test_province_cache.py -q
.venv/bin/python ../scripts/backfill-place-titles.py --help
.venv/bin/python ../scripts/osm-places.py --help
```

- [ ] **Step 2: 写 `docs/NN-place-titles.md`**

中文，必须含三节：

1. **使用方式**：先用 `osmium` 准备区域文件并运行 `scripts/osm-places.py <文件> --region <标签>` 导入（可多省份、可重复，同标签整体替换）；之后新导入的默认标题跑步由后台自动命名；已有记录先 `scripts/backfill-place-titles.py` 预览，确认并备份后加 `--apply`，需要时 `--revert <日志>` 还原；类别词表与阈值（200 米、100 米、0.4、1 km、湖 10,000 m²、公园 5,000 m²）；只改默认标题，用户改过的永不覆盖。
2. **接口与隐私**：无新增 HTTP 接口、响应结构不变；全程本地计算，无外部请求；`place_features` 只存类别与简化几何，不存 OSM 名称与标签；OSM 数据来源与许可（OpenStreetMap contributors，ODbL）；补全脚本对开发库/生产库写数据需用户授权并先备份。
3. **验证记录**：粘贴 Step 1 的真实命令与输出摘要；分别列“实际运行”与“因无授权测试库/未安装 osmium 而未运行”的项；剩余风险：阈值在真实数据上的效果未验证、`osmium` 导出的真实 OSM 文件未演练、小米运动健康入队仅由集成测试覆盖（如实说明是否运行）、开发库升级到 `0016_place_titles` 前 `/api/health` 返回 503。

- [ ] **Step 3: 交付说明**

按 AGENTS.md 第 12 节输出：改动范围（后端 / 脚本 / 文档 / 测试分列）、验证结果、未确认事项、未受影响部分（无 HTTP 接口变更、历史记录不会被后台自动改动）。

- [ ] **Step 4: Commit**

```bash
git add docs/NN-place-titles.md docs/superpowers/specs/2026-10-23-place-titles-design.md docs/superpowers/plans/2026-10-23-place-titles.md
git commit -m "docs: place titles design, plan and verification record"
```
