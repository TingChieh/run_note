from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, select
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.modules.activities.model import Activity
from app.modules.activities.service import lock_owner, owned_activity
from app.modules.shoes.model import Shoe
from app.modules.shoes.schema import ShoeActivity, ShoeBinding, ShoeRef, ShoeView


def not_found():
    return ApiError(404, "RESOURCE_NOT_FOUND", "跑鞋不存在")


def owned_shoe(db, owner, identifier):
    shoe = db.scalar(select(Shoe).where(Shoe.id == identifier, Shoe.user_id == owner))
    if shoe is None:
        raise not_found()
    return shoe


def totals_query(owner):
    distance = func.coalesce(func.sum(Activity.distance_m), Decimal(0))
    total = Shoe.initial_distance_m + distance
    reminder = case(
        (Shoe.retired_on.is_not(None), None),
        (total >= Shoe.replacement_distance_m, "due"),
        (total >= Shoe.replacement_distance_m * Decimal("0.9"), "near"),
    )
    return (
        select(Shoe, distance, func.count(Activity.id), reminder)
        .outerjoin(Activity, and_(Activity.user_id == Shoe.user_id, Activity.shoe_id == Shoe.id))
        .where(Shoe.user_id == owner)
        .group_by(Shoe.id)
    )


def view(row):
    shoe, distance, count, reminder = row
    total = shoe.initial_distance_m + distance
    return ShoeView(
        id=shoe.id,
        name=shoe.name,
        brand=shoe.brand,
        model=shoe.model,
        notes=shoe.notes,
        purchased_on=shoe.purchased_on,
        retired_on=shoe.retired_on,
        initial_distance_m=shoe.initial_distance_m,
        replacement_distance_m=shoe.replacement_distance_m,
        activity_distance_m=distance,
        total_distance_m=total,
        activity_count=count,
        reminder=reminder,
        remaining_distance_m=shoe.replacement_distance_m - total if reminder == "near" else None,
        created_at=shoe.created_at,
        updated_at=shoe.updated_at,
    )


def detail(db, owner, identifier):
    row = db.execute(totals_query(owner).where(Shoe.id == identifier)).one_or_none()
    if row is None:
        raise not_found()
    return view(row)


def listing(db, owner, status, order, limit, offset):
    filters = []
    if status == "active":
        filters.append(Shoe.retired_on.is_(None))
    elif status == "retired":
        filters.append(Shoe.retired_on.is_not(None))
    query = totals_query(owner).where(*filters)
    if order == "name":
        sorting = (func.lower(Shoe.name), Shoe.id)
    else:
        reminder = query.selected_columns[3]
        sorting = (
            reminder.asc().nulls_last(),
            Shoe.retired_on.desc().nulls_last(),
            Shoe.created_at.desc(),
            Shoe.id.desc(),
        )
    rows = db.execute(query.order_by(*sorting).limit(limit).offset(offset))
    total = db.scalar(select(func.count()).select_from(Shoe).where(Shoe.user_id == owner, *filters))
    return {"items": [view(row) for row in rows], "total": total, "limit": limit, "offset": offset}


def activities(db, owner, identifier, limit, offset):
    owned_shoe(db, owner, identifier)
    filters = (Activity.user_id == owner, Activity.shoe_id == identifier)
    rows = db.execute(
        select(Activity.id, Activity.title, Activity.activity_date, Activity.distance_m)
        .where(*filters)
        .order_by(Activity.activity_date.desc(), Activity.id.desc())
        .limit(limit)
        .offset(offset)
    )
    total = db.scalar(select(func.count()).select_from(Activity).where(*filters))
    return {
        "items": [ShoeActivity.model_validate(row._mapping) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def fields(payload, *, exclude_unset=False):
    values = payload.model_dump(exclude_unset=exclude_unset, exclude={"retired"})
    for field in ("initial_distance_m", "replacement_distance_m"):
        if values.get(field) is not None:
            values[field] = Decimal(values[field])
    return values


def create(db, owner, payload):
    lock_owner(db, owner)
    shoe = Shoe(user_id=owner, **fields(payload))
    db.add(shoe)
    db.flush()
    db.refresh(shoe)
    return detail(db, owner, shoe.id)


def update(db, owner, identifier, payload, now):
    user = lock_owner(db, owner)
    shoe = owned_shoe(db, owner, identifier)
    for field, value in fields(payload, exclude_unset=True).items():
        setattr(shoe, field, value)
    if payload.retired is True and shoe.retired_on is None:
        shoe.retired_on = now.astimezone(ZoneInfo(user.timezone)).date()
    elif payload.retired is False:
        shoe.retired_on = None
    if shoe.purchased_on and shoe.retired_on and shoe.purchased_on > shoe.retired_on:
        raise ApiError(422, "SHOE_DATE_ORDER", "购入日期不能晚于退役日期")
    db.flush()
    db.refresh(shoe)
    return detail(db, owner, identifier)


def delete(db, owner, identifier):
    lock_owner(db, owner)
    shoe = owned_shoe(db, owner, identifier)
    db.delete(shoe)
    try:
        db.flush()
    except IntegrityError as error:
        if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != (
            "fk_activities_shoe_id_shoes"
        ):
            raise
        raise ApiError(409, "SHOE_IN_USE", "仍有关联活动，请先解绑或退役跑鞋") from None


def binding_view(shoe):
    return ShoeBinding(
        shoe=ShoeRef(id=shoe.id, name=shoe.name, retired_on=shoe.retired_on) if shoe else None
    )


def binding(db, owner, identifier):
    activity = owned_activity(db, owner, identifier)
    shoe = owned_shoe(db, owner, activity.shoe_id) if activity.shoe_id else None
    return binding_view(shoe)


def bind(db, owner, identifier, shoe_id):
    lock_owner(db, owner)
    activity = owned_activity(db, owner, identifier)
    shoe = owned_shoe(db, owner, shoe_id) if shoe_id else None
    if shoe and shoe.retired_on and activity.shoe_id != shoe_id:
        raise ApiError(409, "SHOE_RETIRED", "跑鞋已退役，请选择使用中的跑鞋")
    activity.shoe_id = shoe_id
    db.flush()
    return binding_view(shoe)
