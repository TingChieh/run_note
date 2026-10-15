"""Snapshot visibility, retry policy and migration contracts without database access."""

import importlib.util
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

NOW = datetime(2026, 10, 15, tzinfo=UTC)


def test_all_route_exists_with_declared_response_schema():
    from app.modules.footprints.router import router

    route = next((r for r in router.routes if r.path == "/api/v1/footprints/all"), None)
    assert route is not None, "all-record snapshot route must be registered"
    assert route.response_model is not None


def test_snapshot_visibility_rejects_stale_or_old_algorithm_data():
    from app.modules.footprints.snapshot import ALGORITHM_VERSION, snapshot_view

    row = SimpleNamespace(
        source_version=4,
        algorithm_version=ALGORITHM_VERSION,
        generated_at=NOW,
        tracks={"mode": "tracks"},
        heatmap={"mode": "heatmap"},
        state="building",
        target_version=4,
    )
    assert snapshot_view(row, 4, "tracks") == {
        "status": "ready",
        "generated_at": NOW,
        "refreshing": True,
        "refresh_failed": False,
        "result": {"mode": "tracks"},
    }
    assert snapshot_view(row, 5, "tracks")["result"] is None
    row.state = "failed"
    row.target_version = 5
    assert snapshot_view(row, 5, "tracks")["status"] == "failed"
    assert snapshot_view(row, 4, "heatmap")["status"] == "ready"
    row.target_version = 4
    assert snapshot_view(row, 4, "heatmap")["refresh_failed"] is True
    assert snapshot_view(row, 5, "heatmap")["refresh_failed"] is False
    row.algorithm_version = "old"
    assert snapshot_view(row, 4, "tracks")["result"] is None
    assert snapshot_view(None, 4, "tracks")["status"] == "pending"


def test_refresh_due_obeys_daily_refresh_retry_backoff_and_new_versions():
    from app.modules.footprints.snapshot import ALGORITHM_VERSION, refresh_due, retry_delay

    row = SimpleNamespace(
        source_version=4,
        algorithm_version=ALGORITHM_VERSION,
        generated_at=NOW,
        state="idle",
        target_version=4,
        retry_at=None,
    )
    assert not refresh_due(row, 4, NOW + timedelta(hours=23))
    assert refresh_due(row, 4, NOW + timedelta(hours=24))
    row.state = "failed"
    row.retry_at = NOW + timedelta(minutes=5)
    assert not refresh_due(row, 4, NOW)
    assert refresh_due(row, 5, NOW)
    assert refresh_due(None, 0, NOW)
    assert retry_delay(1) == timedelta(seconds=60)
    assert retry_delay(20) == timedelta(hours=1)


def test_new_migration_ddl_matches_owner_constraints_and_refuses_data_loss(monkeypatch):
    from app.models import Base

    source = Path(__file__).parents[2] / "migrations/versions/0010_footprint_snapshots.py"
    assert source.exists(), "snapshot migration must exist"
    spec = importlib.util.spec_from_file_location("footprints_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0009_mifitness_imports"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={
            "as_sql": True,
            "output_buffer": output,
            "target_metadata": Base.metadata,
        },
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    for name in ("footprint_activity_caches", "footprint_snapshots"):
        table = Base.metadata.tables[name]
        assert f"CREATE TABLE {name}" in sql
        assert all(c.name in sql for c in table.constraints if c.name)
    assert "FOREIGN KEY(activity_id, user_id)" in sql
    mutations = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: mutations.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert mutations == []


def test_worker_shutdown_before_start_is_safe_and_never_starts_database_work():
    from app.modules.footprints.worker import FootprintWorker

    worker = FootprintWorker(None, lambda: NOW, "release")
    worker.stop()
    assert worker.stop_event.is_set()
    assert not worker.thread.is_alive()


def test_worker_shutdown_interrupts_scan_wait_without_waiting_a_minute(monkeypatch):
    from threading import Event

    from app.modules.footprints import worker as module

    scanned = Event()
    monkeypatch.setattr(module, "run_scan", lambda *a, **kw: scanned.set())
    worker = module.FootprintWorker(None, lambda: NOW, "release")
    worker.start()
    assert scanned.wait(timeout=2)
    worker.stop()
    assert not worker.thread.is_alive()


def test_build_budget_distinguishes_shutdown_from_retryable_timeout(monkeypatch):
    from threading import Event

    from app.modules.footprints import snapshot

    event = Event()
    monkeypatch.setattr(snapshot, "monotonic", lambda: 100)
    snapshot._check_budget(event, 101)
    with pytest.raises(TimeoutError):
        snapshot._check_budget(event, 100)
    event.set()
    with pytest.raises(snapshot.SnapshotBuildStopped):
        snapshot._check_budget(event, 101)


def test_worker_cancel_interrupts_only_active_connection_and_detaches():
    from app.modules.footprints.worker import WorkerStop

    cancelled = []
    driver = SimpleNamespace(cancel=lambda: cancelled.append(True))
    connection = SimpleNamespace(connection=SimpleNamespace(driver_connection=driver))
    stop = WorkerStop()
    stop.attach(connection)
    stop.set()
    assert cancelled == [True]
    stop.detach()
    stop.set()
    assert cancelled == [True]


def test_snapshot_and_import_jobs_use_independent_per_user_lock_namespaces():
    from uuid import UUID

    from app.modules.footprints.snapshot import task_lock_key
    from app.modules.gpx.service import lock_key

    owner = UUID("20000000-0000-0000-0000-000000000001")
    other = UUID("20000000-0000-0000-0000-000000000002")
    assert task_lock_key(owner) != lock_key(owner)
    assert task_lock_key(owner) != task_lock_key(other)


@pytest.mark.parametrize("mode,excluded", [("tracks", "heatmap"), ("heatmap", "tracks")])
def test_snapshot_read_selects_only_requested_geometry_payload(mode, excluded):
    from uuid import UUID

    from app.modules.footprints.snapshot import read_all_footprints

    statements = []

    class Connection:
        def execute(self, statement):
            statements.append(str(statement))
            return SimpleNamespace(one=lambda: (0, None))

    assert read_all_footprints(Connection(), UUID(int=1), mode)["status"] == "pending"
    assert f"footprint_snapshots.{mode}" in statements[0]
    assert f"footprint_snapshots.{excluded}" not in statements[0]


def test_interrupted_advisory_acquisition_discards_unknown_lock_connection():
    from uuid import UUID

    from app.modules.footprints.snapshot import build_user_snapshot

    invalidations = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, *args):
            # The server may have acquired a session lock before cancellation hid its result.
            raise RuntimeError("interrupted acquisition")

        def rollback(self):
            pass

        def invalidate(self):
            invalidations.append(True)

    factory = SimpleNamespace(kw={"bind": SimpleNamespace(connect=lambda: Connection())})
    with pytest.raises(RuntimeError, match="interrupted acquisition"):
        build_user_snapshot(factory, UUID(int=1), NOW)
    assert invalidations == [True]
