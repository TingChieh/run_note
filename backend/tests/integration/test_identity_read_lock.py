"""Readers of one user must not queue behind each other; writers must still exclude readers."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.modules.footprints import router
from app.modules.users.model import User
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration


def test_a_slow_read_does_not_block_another_read_of_the_same_user(clients, monkeypatch):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    slow_started, release = Event(), Event()
    original = router.province_summary

    def slow(*args, **kwargs):
        slow_started.set()
        assert release.wait(timeout=20)
        return original(*args, **kwargs)

    monkeypatch.setattr(router, "province_summary", slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        province = pool.submit(a.get, "/api/v1/footprints/provinces")
        assert slow_started.wait(timeout=10)
        statistics = pool.submit(b.get, "/api/v1/statistics/calendar?year=2026")
        try:
            # The province request is still running, yet the statistics request completes.
            assert statistics.result(timeout=5).status_code == 200
        finally:
            release.set()
        assert province.result(timeout=20).status_code == 200


def test_shared_identity_lock_still_excludes_writers_but_not_other_readers(clients):  # noqa: F811
    a, _, _, app = clients
    owner = UUID(register(a))
    query = select(User.id).where(User.id == owner)
    with app.state.session_factory() as reader, app.state.session_factory() as other:
        reader.execute(query.with_for_update(read=True))
        other.execute(query.with_for_update(read=True, nowait=True))  # a second reader gets in
        other.rollback()
        with pytest.raises(OperationalError):  # a writer (FOR UPDATE) is refused while read
            other.execute(query.with_for_update(nowait=True))
        other.rollback()
        reader.rollback()
