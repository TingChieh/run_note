"""Private wellbeing journal.

Nothing here logs or returns diary content outside the owner's own responses. Writes never call
``lock_owner``: the journal is unrelated to running data, so it must not mark AI reports stale.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.modules.wellbeing.model import (
    DailyEntry,
    DoseEvent,
    SymptomEvent,
    SymptomName,
)
from app.modules.wellbeing.schema import (
    ENTRY_FIELDS,
    DayView,
    DoseView,
    EntryInput,
    EntryList,
    EntryView,
    SymptomInput,
    SymptomNameInput,
    SymptomNameView,
    SymptomPatch,
    SymptomStat,
    SymptomView,
    TrendDay,
    Trends,
)

EARLIEST = date(2000, 1, 1)
MAX_RANGE_DAYS = 366
CLOCK_SKEW = timedelta(minutes=10)
RATING_FIELDS = ("mood", "anxiety", "energy", "focus", "functioning", "sleep_quality")


def account_zone(user) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def today_for(user, now: datetime) -> date:
    return now.astimezone(account_zone(user)).date()


def check_day(day: date, today: date | None = None) -> None:
    """Dates are account-local; the diary has no past floor beyond 2000 and no future entries."""
    if day < EARLIEST:
        raise ApiError(422, "INVALID_DATE", "日期过早，请重新选择")
    if today is not None and day > today:
        raise ApiError(422, "FUTURE_DATE", "不能记录未来的日期")


def check_instant(moment: datetime | None, now: datetime) -> None:
    if moment is None:
        return
    if moment > now + CLOCK_SKEW:
        raise ApiError(422, "FUTURE_TIME", "时间不能晚于现在")
    if moment.date() < EARLIEST:
        raise ApiError(422, "INVALID_DATE", "时间过早，请重新选择")


def check_range(start: date, end: date) -> None:
    check_day(start)
    if end < start:
        raise ApiError(422, "INVALID_RANGE", "结束日期不能早于开始日期")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(422, "RANGE_TOO_LARGE", "日期范围最多 366 天")


def _number(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


def entry_view(row: DailyEntry) -> EntryView:
    return EntryView(
        entry_date=row.entry_date,
        **{name: getattr(row, name) for name in RATING_FIELDS},
        sleep_hours=_number(row.sleep_hours),
        note=row.note,
        updated_at=row.updated_at,
    )


def dose_view(row: DoseEvent) -> DoseView:
    return DoseView(
        id=row.id,
        entry_date=row.entry_date,
        medication_name=row.medication_name,
        medication_id=row.medication_id,
        pills=_number(row.pills),
        dose_amount=_number(row.dose_amount),
        dose_unit=row.dose_unit,
        taken_at=row.taken_at,
        regimen=row.regimen,
        note=row.note,
    )


def symptom_view(row: SymptomEvent) -> SymptomView:
    return SymptomView(
        id=row.id,
        entry_date=row.entry_date,
        symptom=row.symptom,
        severity=row.severity,
        onset_at=row.onset_at,
        duration_minutes=row.duration_minutes,
        affects_daily_life=row.affects_daily_life,
    )


def day_doses(db, owner: UUID, day: date) -> list[DoseEvent]:
    return list(
        db.scalars(
            select(DoseEvent)
            .where(DoseEvent.user_id == owner, DoseEvent.entry_date == day)
            .order_by(DoseEvent.taken_at, DoseEvent.id)
        )
    )


def day_symptoms(db, owner: UUID, day: date) -> list[SymptomEvent]:
    return list(
        db.scalars(
            select(SymptomEvent)
            .where(SymptomEvent.user_id == owner, SymptomEvent.entry_date == day)
            .order_by(SymptomEvent.onset_at.nulls_last(), SymptomEvent.created_at, SymptomEvent.id)
        )
    )


def read_day(db, user, day: date, now: datetime) -> DayView:
    check_day(day)
    entry = db.scalar(
        select(DailyEntry).where(DailyEntry.user_id == user.id, DailyEntry.entry_date == day)
    )
    return DayView(
        date=day,
        today=today_for(user, now),
        timezone=user.timezone,
        entry=None if entry is None else entry_view(entry),
        doses=[dose_view(row) for row in day_doses(db, user.id, day)],
        symptoms=[symptom_view(row) for row in day_symptoms(db, user.id, day)],
    )


def save_entry(db, user, day: date, payload: EntryInput, now: datetime) -> EntryView:
    """Idempotent: the unique (user, day) key makes a repeated or concurrent save an update.

    With ``based_on`` the write is also conditional, so a stale editor cannot silently replace a
    version saved from another tab or device.
    """
    check_day(day, today_for(user, now))
    values = {name: getattr(payload, name) for name in ENTRY_FIELDS}
    key = [DailyEntry.user_id, DailyEntry.entry_date]
    statement = insert(DailyEntry).values(id=uuid4(), user_id=user.id, entry_date=day, **values)
    if "based_on" not in payload.model_fields_set:
        row = db.scalars(
            statement.on_conflict_do_update(
                index_elements=key, set_={**values, "updated_at": func.now()}
            ).returning(DailyEntry)
        ).one()
    elif payload.based_on is None:
        row = db.scalars(
            statement.on_conflict_do_nothing(index_elements=key).returning(DailyEntry)
        ).first()
    else:
        row = db.scalars(
            update(DailyEntry)
            .where(
                DailyEntry.user_id == user.id,
                DailyEntry.entry_date == day,
                DailyEntry.updated_at == payload.based_on,
            )
            .values(**values, updated_at=func.now())
            .returning(DailyEntry)
        ).first()
    if row is None:
        raise ApiError(409, "ENTRY_CHANGED", "这一天的记录已在其他位置更新，请刷新后再保存")
    return entry_view(row)


def delete_entry(db, owner: UUID, day: date) -> None:
    removed = db.execute(
        delete(DailyEntry).where(DailyEntry.user_id == owner, DailyEntry.entry_date == day)
    ).rowcount
    if not removed:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")


def list_entries(
    db, owner: UUID, start: date | None, end: date | None, limit: int, offset: int
) -> EntryList:
    conditions = [DailyEntry.user_id == owner]
    if start is not None:
        conditions.append(DailyEntry.entry_date >= start)
    if end is not None:
        conditions.append(DailyEntry.entry_date <= end)
    total = db.scalar(select(func.count()).select_from(DailyEntry).where(*conditions)) or 0
    rows = db.scalars(
        select(DailyEntry)
        .where(*conditions)
        .order_by(DailyEntry.entry_date.desc())
        .limit(limit)
        .offset(offset)
    )
    return EntryList(
        items=[entry_view(row) for row in rows], total=total, limit=limit, offset=offset
    )


def day_marks(db, owner: UUID, start: date, end: date) -> list[dict]:
    """Per-day presence flags for a calendar: which dates carry any record."""
    check_range(start, end)
    marks: dict[date, dict] = {}

    def mark(day: date) -> dict:
        return marks.setdefault(
            day, {"date": day, "has_entry": False, "dose_count": 0, "symptom_count": 0}
        )

    for (day,) in db.execute(
        select(DailyEntry.entry_date).where(
            DailyEntry.user_id == owner, DailyEntry.entry_date.between(start, end)
        )
    ):
        mark(day)["has_entry"] = True
    for model, key in ((DoseEvent, "dose_count"), (SymptomEvent, "symptom_count")):
        for day, count in db.execute(
            select(model.entry_date, func.count())
            .where(model.user_id == owner, model.entry_date.between(start, end))
            .group_by(model.entry_date)
        ):
            mark(day)[key] = count
    return [marks[day] for day in sorted(marks)]


def owned_dose(db, owner: UUID, identifier: UUID) -> DoseEvent:
    row = db.scalar(select(DoseEvent).where(DoseEvent.id == identifier, DoseEvent.user_id == owner))
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    return row


def owned_symptom(db, owner: UUID, identifier: UUID) -> SymptomEvent:
    row = db.scalar(
        select(SymptomEvent).where(SymptomEvent.id == identifier, SymptomEvent.user_id == owner)
    )
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    return row


def create_symptom(db, user, payload: SymptomInput, now: datetime) -> SymptomView:
    check_day(payload.entry_date, today_for(user, now))
    check_instant(payload.onset_at, now)
    row = SymptomEvent(user_id=user.id, **payload.model_dump())
    db.add(row)
    db.flush()
    remember_symptom(db, user.id, payload.symptom)
    return symptom_view(row)


def update_symptom(db, user, identifier: UUID, payload: SymptomPatch, now: datetime) -> SymptomView:
    row = owned_symptom(db, user.id, identifier)
    changes = payload.model_dump(exclude_unset=True)
    if "entry_date" in changes:
        check_day(changes["entry_date"], today_for(user, now))
    if "onset_at" in changes:
        check_instant(changes["onset_at"], now)
    for name, value in changes.items():
        setattr(row, name, value)
    db.flush()
    db.refresh(row)
    return symptom_view(row)


def delete_symptom(db, owner: UUID, identifier: UUID) -> None:
    db.delete(owned_symptom(db, owner, identifier))
    db.flush()


def symptom_name_views(db, owner: UUID) -> list[SymptomNameView]:
    """The user's own side-effect names for one-tap choices, with how often each was logged."""
    usage = (
        select(func.lower(SymptomEvent.symptom).label("key"), func.count().label("total"))
        .where(SymptomEvent.user_id == owner)
        .group_by(func.lower(SymptomEvent.symptom))
        .subquery()
    )
    rows = db.execute(
        select(SymptomName, usage.c.total)
        .outerjoin(usage, usage.c.key == func.lower(SymptomName.name))
        .where(SymptomName.user_id == owner)
        .order_by(usage.c.total.desc().nulls_last(), SymptomName.created_at, SymptomName.name)
        .limit(200)
    )
    return [SymptomNameView(id=r.id, name=r.name, event_count=total or 0) for r, total in rows]


def create_symptom_name(db, owner: UUID, payload: SymptomNameInput) -> SymptomNameView:
    row = SymptomName(user_id=owner, name=payload.name)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        raise ApiError(409, "SYMPTOM_NAME_EXISTS", "已经有同名的副作用（不区分大小写）") from None
    return next(view for view in symptom_name_views(db, owner) if view.id == row.id)


def delete_symptom_name(db, owner: UUID, identifier: UUID) -> None:
    """Removes the one-tap choice only; logged side effects keep their own copy of the name."""
    row = db.scalar(
        select(SymptomName).where(SymptomName.id == identifier, SymptomName.user_id == owner)
    )
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    db.delete(row)
    db.flush()


def remember_symptom(db, owner: UUID, name: str) -> None:
    db.execute(
        insert(SymptomName).values(id=uuid4(), user_id=owner, name=name).on_conflict_do_nothing()
    )


def symptom_stats(events: list[SymptomEvent]) -> list[SymptomStat]:
    grouped: dict[str, list[SymptomEvent]] = {}
    for event in events:
        grouped.setdefault(event.symptom, []).append(event)
    stats = []
    for name, items in grouped.items():
        # Severity is optional: only the events that were scored count towards the figures.
        scores = [item.severity for item in items if item.severity is not None]
        stats.append(
            SymptomStat(
                symptom=name,
                count=len(items),
                days=len({item.entry_date for item in items}),
                avg_severity=round(sum(scores) / len(scores), 1) if scores else None,
                max_severity=max(scores) if scores else None,
                affects_daily_life_count=sum(1 for item in items if item.affects_daily_life),
            )
        )
    return sorted(
        stats,
        key=lambda stat: (
            -stat.count,
            -(stat.max_severity if stat.max_severity is not None else -1),
            stat.symptom,
        ),
    )


def range_events(db, owner: UUID, start: date, end: date):
    doses = db.scalars(
        select(DoseEvent)
        .where(DoseEvent.user_id == owner, DoseEvent.entry_date.between(start, end))
        .order_by(DoseEvent.taken_at, DoseEvent.id)
    ).all()
    symptoms = db.scalars(
        select(SymptomEvent)
        .where(SymptomEvent.user_id == owner, SymptomEvent.entry_date.between(start, end))
        .order_by(SymptomEvent.entry_date, SymptomEvent.onset_at.nulls_last(), SymptomEvent.id)
    ).all()
    return list(doses), list(symptoms)


def range_entries(db, owner: UUID, start: date, end: date) -> list[DailyEntry]:
    return list(
        db.scalars(
            select(DailyEntry)
            .where(DailyEntry.user_id == owner, DailyEntry.entry_date.between(start, end))
            .order_by(DailyEntry.entry_date)
        )
    )


def trends(db, user, days: int, now: datetime) -> Trends:
    """Daily series for the last ``days`` account-local days. Unanswered fields stay None."""
    end = today_for(user, now)
    start = end - timedelta(days=days - 1)
    entries = {row.entry_date: row for row in range_entries(db, user.id, start, end)}
    doses, symptoms = range_events(db, user.id, start, end)
    dose_counts: dict[date, int] = {}
    for dose in doses:
        dose_counts[dose.entry_date] = dose_counts.get(dose.entry_date, 0) + 1
    by_day: dict[date, list[SymptomEvent]] = {}
    for event in symptoms:
        by_day.setdefault(event.entry_date, []).append(event)
    series = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        row = entries.get(day)
        events = by_day.get(day, [])
        series.append(
            TrendDay(
                date=day,
                **{name: getattr(row, name) if row else None for name in RATING_FIELDS},
                sleep_hours=_number(row.sleep_hours) if row else None,
                dose_count=dose_counts.get(day, 0),
                symptom_count=len(events),
                symptom_max_severity=max(
                    (e.severity for e in events if e.severity is not None), default=None
                ),
            )
        )
    return Trends(
        days=days,
        start=start,
        end=end,
        timezone=user.timezone,
        recorded_days=len(entries),
        series=series,
        symptoms=symptom_stats(symptoms),
    )
