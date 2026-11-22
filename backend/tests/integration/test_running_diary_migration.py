"""Ownership and downgrade checks adapted from the item 23 migration spike."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.integration.test_migrations import activity, assert_downgrade_guard, rejected, user

pytestmark = pytest.mark.integration

DIARY = (
    "INSERT INTO activity_diaries (id,user_id,activity_id,rpe,mood,weather) "
    "VALUES (:id,:owner,:activity,:rpe,:mood,:weather)"
)
PHOTO = (
    "INSERT INTO activity_diary_photos (id,user_id,diary_id,png,width,height) "
    "VALUES (:id,:owner,:diary,:png,:width,80)"
)


def test_diary_constraints_and_account_cascade(clients):
    _, _, engine, _ = clients
    with engine.begin() as db:
        first, second = user(db), user(db)
        run = activity(db, first)
        diary = {
            "id": uuid4(),
            "owner": first,
            "activity": run,
            "rpe": 6,
            "mood": "neutral",
            "weather": "clear",
        }
        rejected(db, DIARY, {**diary, "owner": second})
        for field, value in (("rpe", 0), ("rpe", 11), ("mood", "calm"), ("weather", "unknown")):
            rejected(db, DIARY, {**diary, field: value})
        db.execute(text(DIARY), diary)
        rejected(db, DIARY, {**diary, "id": uuid4()})

        photo = {"id": uuid4(), "owner": first, "diary": diary["id"], "png": b"a", "width": 48}
        for field, value in (("owner", second), ("png", b""), ("width", 1101)):
            rejected(db, PHOTO, {**photo, field: value})
        db.execute(text(PHOTO), photo)
        db.execute(text("DELETE FROM users WHERE id = :id"), {"id": first})
        assert (
            db.scalar(text("SELECT id FROM activity_diaries WHERE id = :id"), {"id": diary["id"]})
            is None
        )
        assert (
            db.scalar(
                text("SELECT id FROM activity_diary_photos WHERE id = :id"), {"id": photo["id"]}
            )
            is None
        )
        assert db.scalar(text("SELECT id FROM users WHERE id = :id"), {"id": second}) == second


def test_running_diary_downgrade_refuses_existing_data(clients):
    _, _, engine, _ = clients
    with engine.begin() as db:
        owner = user(db)
        run = activity(db, owner)
        diary = uuid4()
        db.execute(
            text(DIARY),
            {"id": diary, "owner": owner, "activity": run, "rpe": 1, "mood": None, "weather": None},
        )
    try:
        assert_downgrade_guard(
            engine, "0032_running_diary", "Refusing to drop running diaries or photos"
        )
        with engine.connect() as db:
            assert (
                db.scalar(text("SELECT id FROM activity_diaries WHERE id=:id"), {"id": diary})
                == diary
            )
    finally:
        with engine.begin() as db:
            db.execute(text("DELETE FROM users WHERE id = :id"), {"id": owner})
