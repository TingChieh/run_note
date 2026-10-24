"""One-off naming of existing runs: preview first, apply explicitly, revert from a log.

Lock order is the same as everywhere else: users row first, then the queue row. Measuring
(the expensive part) never holds a lock, and every write is its own short transaction.
"""

import json
import logging
import os
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal
from uuid import UUID

from sqlalchemy import text

from app.modules.activities.service import lock_owner
from app.modules.place_titles import rules, service

logger = logging.getLogger(__name__)
PAGE_SIZE = 200


class BackfillLogError(ValueError):
    """The revert log is unreadable or malformed."""


Reason = Literal["matched", "no_match", "too_short", "edited", "retry", "error"]
REASON_LABELS = {
    "matched": "命中",
    "no_match": "附近无地物",
    "too_short": "太短",
    "edited": "标题已被改过",
    "retry": "测量超时",
    "error": "测量出错",
}


@dataclass
class Proposal:
    activity_id: UUID
    owner: UUID
    activity_date: date
    old_title: str
    category: str | None
    share: float | None
    new_title: str | None
    reason: Reason = "matched"


def _candidate_page(session_factory, owner, after, size):
    """Short read-only transaction; keyset on (activity_date, id)."""
    with session_factory() as db:
        return db.execute(
            text(
                f"""SELECT a.id, a.user_id, a.activity_date, a.title
                    FROM activities a
                    LEFT JOIN activity_place_names n ON n.activity_id = a.id
                    WHERE a.title = {service.DEFAULT_TITLE_SQL}
                      AND (n.activity_id IS NULL OR n.state <> 'done')
                      AND (CAST(:owner AS uuid) IS NULL OR a.user_id = :owner)
                      AND (CAST(:day AS date) IS NULL OR (a.activity_date, a.id) > (:day, :id))
                    ORDER BY a.activity_date, a.id
                    LIMIT :size"""
            ),
            {
                "owner": owner,
                "day": after[0] if after else None,
                "id": after[1] if after else UUID(int=0),
                "size": size,
            },
        ).all()


def collect(session_factory, owner: UUID | None = None, limit: int | None = None):
    """Read-only preview: candidates are default-titled runs whose queue state is not 'done'.

    Candidates are paged and each run is measured in its own short read session, so no
    transaction stays open across the set and no row lock is taken.
    """
    proposals: list[Proposal] = []
    after = None
    while limit is None or len(proposals) < limit:
        size = PAGE_SIZE if limit is None else min(PAGE_SIZE, limit - len(proposals))
        rows = _candidate_page(session_factory, owner, after, size)
        if not rows:
            break
        for activity_id, run_owner, activity_date, title in rows:
            outcome = service._measure(session_factory, run_owner, activity_id)
            category, share = (outcome[1], outcome[2]) if outcome[0] == "found" else (None, None)
            if outcome[0] == "found":
                reason: Reason = "matched"
            elif outcome[0] == "retry":
                reason = "retry"
            else:
                reason = outcome[1]
            proposals.append(
                Proposal(
                    activity_id,
                    run_owner,
                    activity_date,
                    title,
                    category,
                    share,
                    rules.title_for(category) if category else None,
                    reason,
                )
            )
        after = (rows[-1][2], rows[-1][0])
        if len(rows) < size:
            break
    return proposals


def _record_done(db, proposal: Proposal):
    db.execute(
        text(
            """INSERT INTO activity_place_names
                   (activity_id, user_id, state, category, share, applied_title, algorithm_version)
               VALUES (:activity, :owner, 'done', :category, :share, :title, :version)
               ON CONFLICT (activity_id) DO UPDATE SET
                   state = 'done', category = EXCLUDED.category, share = EXCLUDED.share,
                   applied_title = EXCLUDED.applied_title,
                   algorithm_version = EXCLUDED.algorithm_version, updated_at = now()"""
        ),
        {
            "activity": proposal.activity_id,
            "owner": proposal.owner,
            "category": proposal.category,
            "share": proposal.share,
            "title": proposal.new_title,
            "version": rules.ALGORITHM_VERSION,
        },
    )


def _write_log(log_path: Path, entries: list[dict]):
    """Atomic and private (0600): a reader or a crash never sees a half-written log."""
    temporary = log_path.with_name(log_path.name + ".tmp")
    temporary.unlink(missing_ok=True)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(entries, ensure_ascii=False, indent=2))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, log_path)
    try:  # best effort: make the rename itself durable
        directory = os.open(log_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError:
        pass


def default_log_dir() -> Path:
    """Outside the repository: the log holds real activity ids and titles."""
    base = os.environ.get("XDG_STATE_HOME")
    root = Path(base) if base and Path(base).is_absolute() else Path.home() / ".local" / "state"
    return root / "run_note" / "place-titles"


def ensure_private_dir(path: Path) -> None:
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def is_inside(path: Path, root: Path) -> bool:
    return path.resolve().is_relative_to(root.resolve())


class LogWriteError(RuntimeError):
    """The log could not be updated after a title was already changed in the database."""

    def __init__(self, counts: dict[str, int], activity_id: UUID):
        super().__init__("log write failed")
        self.counts = counts
        self.activity_id = activity_id


def format_summary(kind: str, counts: dict[str, int]) -> str:
    """Chinese one-line summary for "apply" or "revert"."""
    if kind == "apply":
        return (
            f"已改名 {counts.get('applied', 0)} 条 / 期间已被修改 "
            f"{counts.get('changed_meanwhile', 0)} 条 / 失败 {counts.get('failed', 0)} 条 / "
            f"未命中 {counts.get('unmatched', 0)} 条"
        )
    if kind == "revert":
        return (
            f"已还原 {counts.get('reverted', 0)} 条 / 已跳过（不存在或标题已变）"
            f"{counts.get('skipped', 0)} 条 / 失败 {counts.get('failed', 0)} 条"
        )
    raise ValueError(kind)


def format_preview(proposals: list[Proposal]) -> str:
    tally = Counter(p.reason for p in proposals)
    parts = "，".join(f"{label} {tally.get(key, 0)} 条" for key, label in REASON_LABELS.items())
    return f"候选 {len(proposals)} 条：{parts}"


def apply_proposals(session_factory, proposals: list[Proposal], log_path: Path) -> dict[str, int]:
    counts = {"applied": 0, "changed_meanwhile": 0, "unmatched": 0, "failed": 0}
    entries: list[dict] = []
    _write_log(log_path, entries)
    for proposal in proposals:
        if proposal.new_title is None:
            counts["unmatched"] += 1  # not recorded, so a later run can try again
            continue
        try:
            with session_factory() as db:
                # Users row first (importers and deletion lock in this order), then the queue
                # row inside _record_done. apply_title re-takes the same lock harmlessly.
                lock_owner(db, proposal.owner)
                if service.apply_title(
                    db, proposal.owner, proposal.activity_id, proposal.new_title
                ):
                    _record_done(db, proposal)
                    db.commit()
                    changed = True
                else:
                    db.rollback()
                    changed = False
        except Exception as error:  # one failing run must not stop the others
            logger.warning("place title backfill failed for one run (%s)", type(error).__name__)
            counts["failed"] += 1
            continue
        if not changed:
            counts["changed_meanwhile"] += 1
            continue
        counts["applied"] += 1
        entries.append(
            {
                "activity_id": str(proposal.activity_id),
                "old_title": proposal.old_title,
                "new_title": proposal.new_title,
            }
        )
        # Rewrite after every change so an interrupted run still leaves a usable log.
        try:
            _write_log(log_path, entries)
        except OSError:
            raise LogWriteError(counts, proposal.activity_id) from None
    return counts


def load_log(log_path: Path) -> list[dict]:
    """Read and validate a revert log; raises BackfillLogError before anything is changed."""
    try:
        data = json.loads(log_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise BackfillLogError("无法读取还原日志，或日志不是有效的 JSON") from None
    if not isinstance(data, list):
        raise BackfillLogError("还原日志格式不正确")
    entries = []
    for entry in data:
        if not isinstance(entry, dict) or not all(
            isinstance(entry.get(key), str) for key in ("activity_id", "old_title", "new_title")
        ):
            raise BackfillLogError("还原日志格式不正确")
        try:
            UUID(entry["activity_id"])
        except ValueError:
            raise BackfillLogError("还原日志格式不正确") from None
        entries.append({key: entry[key] for key in ("activity_id", "old_title", "new_title")})
    return entries


def revert_log(session_factory, log_path: Path) -> dict[str, int]:
    counts = {"reverted": 0, "skipped": 0, "failed": 0}
    for entry in load_log(log_path):
        activity = UUID(entry["activity_id"])
        try:
            with session_factory() as db:
                owner = db.scalar(
                    text("SELECT user_id FROM activities WHERE id = :a"), {"a": activity}
                )
                if owner is None:
                    counts["skipped"] += 1
                    continue
                user = lock_owner(db, owner)  # users row first, then the queue row
                changed = db.execute(
                    text(
                        """UPDATE activities SET title = :old, updated_at = now()
                           WHERE id = :a AND title = :new"""
                    ),
                    {"old": entry["old_title"], "new": entry["new_title"], "a": activity},
                ).rowcount
                if changed:
                    user.activity_data_version += 1
                    db.execute(
                        text(
                            "UPDATE activity_place_names SET state = 'skipped', "
                            "applied_title = NULL, updated_at = now() WHERE activity_id = :a"
                        ),
                        {"a": activity},
                    )
                db.commit()
                counts["reverted" if changed else "skipped"] += 1
        except Exception as error:
            logger.warning("place title revert failed for one run (%s)", type(error).__name__)
            counts["failed"] += 1
    return counts
