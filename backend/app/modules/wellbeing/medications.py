"""The user's medicines, their stock on hand, and doses logged against them.

Stock is a ledger, not a stored number: restocks and counts (盘点) add pills, every dose logged
with a pill count subtracts them. Editing or deleting a dose therefore corrects the stock by itself.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.modules.wellbeing.model import DoseEvent, Medication, StockMovement, SymptomEvent
from app.modules.wellbeing.schema import (
    BatchDoseInput,
    BatchDoseResult,
    CountInput,
    DoseInput,
    DosePatch,
    DoseView,
    MedicationInput,
    MedicationPatch,
    MedicationView,
    RestockInput,
    StockView,
)
from app.modules.wellbeing.service import (
    CLOCK_SKEW,
    MAX_RANGE_DAYS,
    account_zone,
    check_day,
    check_instant,
    dose_view,
    today_for,
)

RECENT_DAYS = 14
MAX_BATCH = 1000
ZERO = Decimal(0)


def _number(value) -> float | None:
    return None if value is None else float(value)


def owned_medication(db, owner: UUID, identifier: UUID, *, lock: bool = False) -> Medication:
    statement = select(Medication).where(Medication.id == identifier, Medication.user_id == owner)
    row = db.scalar(statement.with_for_update() if lock else statement)
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    return row


def _sums(db, model, owner: UUID, *conditions) -> dict[UUID, Decimal]:
    key = model.medication_id
    value = StockMovement.pills if model is StockMovement else DoseEvent.pills
    rows = db.execute(
        select(key, func.sum(value))
        .where(model.user_id == owner, key.is_not(None), value.is_not(None), *conditions)
        .group_by(key)
    )
    return {k: v for k, v in rows}


def _stock_view(med: Medication, ledger, taken, recent) -> StockView | None:
    if med.id not in ledger:
        return None
    pills = ledger[med.id] - taken.get(med.id, ZERO)
    box = med.pills_per_box
    boxes = int(pills // box) if box and pills >= 0 else None
    loose = float(pills - boxes * box) if boxes is not None else None
    average = float(recent.get(med.id, ZERO)) / RECENT_DAYS
    days = None
    if average > 0:
        days = 0.0 if pills <= 0 else round(float(pills) / average, 1)
    return StockView(
        pills=float(pills),
        boxes=boxes,
        loose_pills=loose,
        avg_daily_pills=round(average, 2) if average > 0 else None,
        days_left=days,
    )


def medication_views(db, owner: UUID, now: datetime) -> list[MedicationView]:
    """The user's medicine list, newest use first, with stock and how long it should last."""
    ledger = _sums(db, StockMovement, owner)
    taken = _sums(db, DoseEvent, owner)
    recent = _sums(db, DoseEvent, owner, DoseEvent.taken_at >= now - timedelta(days=RECENT_DAYS))
    usage = (
        select(
            DoseEvent.medication_id.label("key"),
            func.count().label("total"),
            func.max(DoseEvent.taken_at).label("last"),
        )
        .where(DoseEvent.user_id == owner, DoseEvent.medication_id.is_not(None))
        .group_by(DoseEvent.medication_id)
        .subquery()
    )
    rows = db.execute(
        select(Medication, usage.c.total, usage.c.last)
        .outerjoin(usage, usage.c.key == Medication.id)
        .where(Medication.user_id == owner)
        .order_by(usage.c.last.desc().nulls_last(), Medication.created_at, Medication.name)
        .limit(200)
    )
    return [
        MedicationView(
            id=med.id,
            name=med.name,
            count_unit=med.count_unit,
            pills_per_box=med.pills_per_box,
            strength_amount=_number(med.strength_amount),
            strength_unit=med.strength_unit,
            default_pills=_number(med.default_pills),
            regimen=med.regimen,
            side_effects=list(med.side_effects or []),
            dose_count=total or 0,
            last_taken_at=last,
            stock=_stock_view(med, ledger, taken, recent),
        )
        for med, total, last in rows
    ]


def medication_view(db, owner: UUID, identifier: UUID, now: datetime) -> MedicationView:
    return next(view for view in medication_views(db, owner, now) if view.id == identifier)


def _name_taken() -> ApiError:
    return ApiError(409, "MEDICATION_EXISTS", "已经有同名的药物（不区分大小写）")


def create_medication(db, owner: UUID, payload: MedicationInput, now: datetime) -> MedicationView:
    row = Medication(user_id=owner, **payload.model_dump())
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        raise _name_taken() from None
    return medication_view(db, owner, row.id, now)


def update_medication(
    db, owner: UUID, identifier: UUID, payload: MedicationPatch, now: datetime
) -> MedicationView:
    row = owned_medication(db, owner, identifier)
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, name, value)
    if (row.strength_amount is None) != (row.strength_unit is None):
        raise ApiError(422, "VALIDATION_ERROR", "规格需要同时填写数值和单位")
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        raise _name_taken() from None
    return medication_view(db, owner, row.id, now)


def delete_medication(db, owner: UUID, identifier: UUID) -> None:
    """Removes the entry and its stock ledger; logged doses keep their own copy of the name."""
    db.delete(owned_medication(db, owner, identifier))
    db.flush()


def _pills_on_hand(db, owner: UUID, med: Medication) -> Decimal:
    ledger = _sums(db, StockMovement, owner).get(med.id, ZERO)
    return ledger - _sums(db, DoseEvent, owner).get(med.id, ZERO)


def _whole_pills(med: Medication, boxes: int, pills: Decimal) -> Decimal:
    if boxes and not med.pills_per_box:
        raise ApiError(422, "NO_BOX_SIZE", "先在药物里填写“每盒几颗”，才能按盒数计算")
    return Decimal(boxes) * (med.pills_per_box or 0) + pills


def restock(
    db, owner: UUID, identifier: UUID, payload: RestockInput, now: datetime
) -> MedicationView:
    med = owned_medication(db, owner, identifier, lock=True)
    db.add(
        StockMovement(
            user_id=owner,
            medication_id=med.id,
            kind="restock",
            pills=_whole_pills(med, payload.boxes, payload.pills),
        )
    )
    db.flush()
    return medication_view(db, owner, med.id, now)


def count_stock(
    db, owner: UUID, identifier: UUID, payload: CountInput, now: datetime
) -> MedicationView:
    """Set what is on the shelf: the ledger gets the difference, so history stays auditable."""
    med = owned_medication(db, owner, identifier, lock=True)
    delta = _whole_pills(med, payload.boxes, payload.pills) - _pills_on_hand(db, owner, med)
    has_ledger = med.id in _sums(db, StockMovement, owner)
    if delta != 0 or not has_ledger:
        # Even a first count of zero opens the ledger, so the medicine shows "none left".
        if delta == 0:
            db.add(
                StockMovement(
                    user_id=owner, medication_id=med.id, kind="adjust", pills=Decimal("0.01")
                )
            )
            db.add(
                StockMovement(
                    user_id=owner, medication_id=med.id, kind="adjust", pills=Decimal("-0.01")
                )
            )
        else:
            db.add(StockMovement(user_id=owner, medication_id=med.id, kind="adjust", pills=delta))
        db.flush()
    return medication_view(db, owner, med.id, now)


def resolve_medication(
    db, owner: UUID, *, medication_id: UUID | None, name: str, pills, regimen: str
) -> Medication:
    """The listed medicine a dose belongs to; a new name joins the list."""
    if medication_id is not None:
        return owned_medication(db, owner, medication_id)
    found = db.scalar(
        select(Medication).where(
            Medication.user_id == owner, func.lower(Medication.name) == name.lower()
        )
    )
    if found is not None:
        return found
    db.execute(
        insert(Medication)
        .values(id=uuid4(), user_id=owner, name=name, default_pills=pills, regimen=regimen)
        .on_conflict_do_nothing()
    )
    return db.scalar(
        select(Medication).where(
            Medication.user_id == owner, func.lower(Medication.name) == name.lower()
        )
    )


def _amount(med: Medication, pills, amount, unit):
    """Amount and unit of a dose: as given, else pills times the strength of one pill."""
    if amount is not None:
        return amount, unit
    if pills is not None and med.strength_amount is not None:
        return pills * med.strength_amount, med.strength_unit
    return None, None


def create_dose(db, user, payload: DoseInput, now: datetime) -> DoseView:
    check_instant(payload.taken_at, now)
    med = resolve_medication(
        db,
        user.id,
        medication_id=payload.medication_id,
        name=payload.medication_name,
        pills=payload.pills,
        regimen=payload.regimen,
    )
    amount, unit = _amount(med, payload.pills, payload.dose_amount, payload.dose_unit)
    row = DoseEvent(
        user_id=user.id,
        medication_id=med.id,
        medication_name=med.name,
        entry_date=payload.taken_at.astimezone(account_zone(user)).date(),
        pills=payload.pills,
        dose_amount=amount,
        dose_unit=unit,
        taken_at=payload.taken_at,
        regimen=payload.regimen,
        note=payload.note,
    )
    db.add(row)
    db.flush()
    return dose_view(row)


def owned_dose(db, owner: UUID, identifier: UUID) -> DoseEvent:
    row = db.scalar(select(DoseEvent).where(DoseEvent.id == identifier, DoseEvent.user_id == owner))
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    return row


def update_dose(db, user, identifier: UUID, payload: DosePatch, now: datetime) -> DoseView:
    row = owned_dose(db, user.id, identifier)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("medication_id") is not None:
        owned_medication(db, user.id, changes["medication_id"])  # someone else's medicine is a 404
    for name, value in changes.items():
        setattr(row, name, value)
    # Pills convert to an amount by the strength of the medicine they are linked to,
    # so a new count or a new link recalculates it.
    relinked = "medication_id" in changes and row.pills is not None
    if (
        ("pills" in changes or relinked)
        and "dose_amount" not in changes
        and "dose_unit" not in changes
    ):
        med = db.get(Medication, row.medication_id) if row.medication_id else None
        row.dose_amount, row.dose_unit = (
            _amount(med, row.pills, None, None) if med is not None else (None, None)
        )
    if "taken_at" in changes:
        check_instant(row.taken_at, now)
        row.entry_date = row.taken_at.astimezone(account_zone(user)).date()
        # Side effects noted for this dose move to the dose's new day with it.
        db.execute(
            update(SymptomEvent)
            .where(SymptomEvent.dose_id == row.id)
            .values(entry_date=row.entry_date)
        )
    db.flush()
    db.refresh(row)
    return dose_view(row)


def delete_dose(db, owner: UUID, identifier: UUID) -> None:
    db.delete(owned_dose(db, owner, identifier))
    db.flush()


def batch_doses(db, user, payload: BatchDoseInput, now: datetime) -> BatchDoseResult:
    """Back-fill: every listed time on every day of the range, skipping what is already logged."""
    med = owned_medication(db, user.id, payload.medication_id)
    pills = payload.pills if payload.pills is not None else med.default_pills
    if pills is None:
        raise ApiError(422, "NO_PILL_COUNT", "请填写每次几颗，或先在药物里设置“每次默认颗数”")
    check_day(payload.start_date)
    check_day(payload.end_date, today_for(user, now))
    days = (payload.end_date - payload.start_date).days + 1
    if days > MAX_RANGE_DAYS:
        raise ApiError(422, "RANGE_TOO_LARGE", "日期范围最多 366 天")
    if days * len(payload.times) > MAX_BATCH:
        raise ApiError(422, "BATCH_TOO_LARGE", f"一次最多补录 {MAX_BATCH} 条")
    zone: ZoneInfo = account_zone(user)
    existing = set(
        db.scalars(
            select(DoseEvent.taken_at).where(
                DoseEvent.user_id == user.id,
                DoseEvent.medication_id == med.id,
                DoseEvent.entry_date.between(
                    payload.start_date - timedelta(days=1), payload.end_date + timedelta(days=1)
                ),
            )
        )
    )
    amount, unit = _amount(med, pills, None, None)
    created = skipped_existing = skipped_future = 0
    for offset in range(days):
        day: date = payload.start_date + timedelta(days=offset)
        for clock in payload.times:
            taken = datetime(
                day.year, day.month, day.day, int(clock[:2]), int(clock[3:]), tzinfo=zone
            )
            if taken > now + CLOCK_SKEW:
                skipped_future += 1
            elif taken in existing:
                skipped_existing += 1
            else:
                db.add(
                    DoseEvent(
                        user_id=user.id,
                        medication_id=med.id,
                        medication_name=med.name,
                        entry_date=taken.astimezone(zone).date(),
                        pills=pills,
                        dose_amount=amount,
                        dose_unit=unit,
                        taken_at=taken,
                        regimen=med.regimen,
                        note=payload.note,
                    )
                )
                existing.add(taken)
                created += 1
    db.flush()
    return BatchDoseResult(
        created=created, skipped_existing=skipped_existing, skipped_future=skipped_future
    )
