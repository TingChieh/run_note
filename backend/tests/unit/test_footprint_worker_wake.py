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
