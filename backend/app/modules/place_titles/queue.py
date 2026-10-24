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
