import time

from app.modules.footprints import worker as module


def test_wake_triggers_a_scan_well_before_the_interval_and_stop_is_prompt(monkeypatch):
    scans = []
    monkeypatch.setattr(module, "run_scan", lambda *args, **kwargs: scans.append(time.monotonic()))
    monkeypatch.setattr(module, "WAKE_COALESCE_SECONDS", 0.05)
    worker = module.FootprintWorker(None, lambda: None, "rev")
    worker.start()
    deadline = time.monotonic() + 2
    while not scans and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(scans) == 1  # initial scan; the next regular one is 60 s away
    worker.wake()
    deadline = time.monotonic() + 2
    while len(scans) < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(scans) == 2
    started = time.monotonic()
    worker.stop()
    assert time.monotonic() - started < 2
    assert not worker.thread.is_alive()


def test_wake_without_a_worker_is_a_no_op():
    class State:
        pass

    class App:
        state = State()

    module.wake_footprint_worker(App())


def test_activity_update_delete_and_batch_delete_wake_footprint_worker(monkeypatch):
    from datetime import UTC, datetime
    from types import SimpleNamespace
    from uuid import UUID

    from app.modules.activities import router as activity_router
    from app.modules.activities.schema import ActivityBatchDelete, ActivityUpdate

    woken = []
    committed = []
    monkeypatch.setattr(activity_router, "wake_footprint_worker", lambda app: woken.append(app))
    monkeypatch.setattr(activity_router, "envelope", lambda _request, data: data)
    monkeypatch.setattr(activity_router.service, "update_activity", lambda *_args: {"ok": "update"})
    monkeypatch.setattr(activity_router.service, "delete_activity", lambda *_args: {"ok": "delete"})
    monkeypatch.setattr(
        activity_router.service, "delete_activities", lambda *_args: {"ok": "batch"}
    )

    app = SimpleNamespace(state=SimpleNamespace(clock=lambda: datetime(2026, 10, 15, tzinfo=UTC)))
    request = SimpleNamespace(app=app, state=SimpleNamespace(request_id="req"))
    identity = (None, SimpleNamespace(id=UUID(int=1)))
    db = SimpleNamespace(commit=lambda: committed.append(True))
    activity_id = UUID(int=2)

    activity_router.update_activity(
        activity_id, ActivityUpdate(title="改名"), request, identity, db
    )
    activity_router.delete_activity(activity_id, request, identity, db)
    activity_router.delete_activities(ActivityBatchDelete(ids=[activity_id]), request, identity, db)

    assert len(committed) == 3
    assert woken == [app, app, app]
