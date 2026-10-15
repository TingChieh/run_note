"""Native-process worker: one bounded task at a time, PostgreSQL deduplicates replicas."""

import logging
from threading import Event, Lock, Thread

from sqlalchemy import and_, or_, select, text

from app.modules.footprints.model import FootprintSnapshot
from app.modules.footprints.snapshot import (
    ALGORITHM_VERSION,
    REFRESH_INTERVAL,
    build_user_snapshot,
)
from app.modules.users.model import User

SCAN_INTERVAL_SECONDS = 60
logger = logging.getLogger(__name__)


class WorkerStop(Event):
    """Cancellation also interrupts a running PostgreSQL statement during shutdown."""

    def __init__(self):
        super().__init__()
        self._lock = Lock()
        self._connection = None

    def attach(self, connection):
        with self._lock:
            self._connection = connection.connection.driver_connection
            if self.is_set():
                self._connection.cancel()

    def detach(self):
        with self._lock:
            self._connection = None

    def set(self):
        super().set()
        with self._lock:
            if self._connection is not None:
                try:
                    self._connection.cancel()
                except Exception:
                    logger.warning("Footprint worker cancellation could not reach PostgreSQL")


def run_scan(session_factory, now, expected_revision, *, limit=10, stop_event=None):
    """One restart-safe scan. Never writes derivatives until this release's schema is ready."""
    with session_factory() as db:
        if db.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != [
            expected_revision
        ]:
            return 0
        due = or_(
            FootprintSnapshot.id.is_(None),
            FootprintSnapshot.target_version.is_distinct_from(User.activity_data_version),
            and_(FootprintSnapshot.state == "failed", FootprintSnapshot.retry_at <= now),
            and_(
                FootprintSnapshot.state != "failed",
                or_(
                    FootprintSnapshot.state == "building",
                    FootprintSnapshot.source_version.is_distinct_from(User.activity_data_version),
                    FootprintSnapshot.algorithm_version.is_distinct_from(ALGORITHM_VERSION),
                    FootprintSnapshot.generated_at.is_(None),
                    FootprintSnapshot.generated_at <= now - REFRESH_INTERVAL,
                ),
            ),
        )
        owners = list(
            db.scalars(
                select(User.id)
                .outerjoin(FootprintSnapshot, FootprintSnapshot.user_id == User.id)
                .where(due)
                .order_by(FootprintSnapshot.attempt_at.asc().nullsfirst(), User.id)
                .limit(limit)
            )
        )
    published = 0
    for owner in owners:
        if stop_event is not None and stop_event.is_set():
            break
        try:
            published += build_user_snapshot(session_factory, owner, now, stop_event=stop_event)
        except Exception as error:
            # Includes connection/readiness loss; next scan retries without leaking data in logs.
            logger.warning("Footprint worker task unavailable (%s)", type(error).__name__)
    return published


class FootprintWorker:
    def __init__(self, session_factory, clock, expected_revision):
        self.session_factory = session_factory
        self.clock = clock
        self.expected_revision = expected_revision
        self.stop_event = WorkerStop()
        self.thread = Thread(target=self._run, name="footprint-snapshots", daemon=True)

    def _run(self):
        while not self.stop_event.is_set():
            try:
                run_scan(
                    self.session_factory,
                    self.clock(),
                    self.expected_revision,
                    stop_event=self.stop_event,
                )
            except Exception as error:
                logger.warning("Footprint worker scan unavailable (%s)", type(error).__name__)
            self.stop_event.wait(SCAN_INTERVAL_SECONDS)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread.ident is None:
            return
        # Each statement is bounded; cancel also interrupts the currently active build.
        self.thread.join(timeout=12)
        if self.thread.is_alive():
            logger.warning("Footprint worker is still stopping after bounded shutdown")
