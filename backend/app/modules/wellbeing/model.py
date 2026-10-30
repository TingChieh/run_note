from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

RATINGS = ("mood", "anxiety", "energy", "focus", "functioning", "sleep_quality")


def _ratings() -> tuple[CheckConstraint, ...]:
    return tuple(
        CheckConstraint(f"{name} IS NULL OR {name} BETWEEN 0 AND 10", name=f"{name}_range")
        for name in RATINGS
    )


class DailyEntry(Base):
    """One state record per user and local day; every answer is optional and stored as NULL."""

    __tablename__ = "wellbeing_daily_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_date", name="uq_wellbeing_daily_entries_user_date"),
        *_ratings(),
        CheckConstraint(
            "sleep_hours IS NULL OR sleep_hours BETWEEN 0 AND 24", name="sleep_hours_range"
        ),
        CheckConstraint("note IS NULL OR char_length(note) <= 2000", name="note_length"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    mood: Mapped[int | None] = mapped_column(SmallInteger)
    anxiety: Mapped[int | None] = mapped_column(SmallInteger)
    energy: Mapped[int | None] = mapped_column(SmallInteger)
    focus: Mapped[int | None] = mapped_column(SmallInteger)
    functioning: Mapped[int | None] = mapped_column(SmallInteger)
    sleep_hours: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    sleep_quality: Mapped[int | None] = mapped_column(SmallInteger)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DoseEvent(Base):
    __tablename__ = "wellbeing_dose_events"
    __table_args__ = (
        Index("ix_wellbeing_dose_events_user_date", "user_id", "entry_date"),
        Index("ix_wellbeing_dose_events_medication", "medication_id"),
        CheckConstraint("char_length(medication_name) >= 1", name="name_present"),
        CheckConstraint("char_length(dose_unit) >= 1", name="unit_present"),
        CheckConstraint("dose_amount > 0 AND dose_amount <= 100000", name="amount_range"),
        CheckConstraint("pills IS NULL OR (pills > 0 AND pills <= 1000)", name="pills_range"),
        CheckConstraint(
            "pills IS NOT NULL OR (dose_amount IS NOT NULL AND dose_unit IS NOT NULL)",
            name="has_quantity",
        ),
        CheckConstraint("regimen IN ('scheduled','as_needed')", name="regimen_values"),
        CheckConstraint("note IS NULL OR char_length(note) <= 500", name="note_length"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    medication_name: Mapped[str] = mapped_column(String(80))
    dose_amount: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    dose_unit: Mapped[str | None] = mapped_column(String(16))
    # Pill count of this dose and the medicine it was taken from; the stock ledger counts these.
    pills: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    medication_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("wellbeing_medications.id", ondelete="SET NULL")
    )
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    regimen: Mapped[str] = mapped_column(String(12))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SymptomEvent(Base):
    __tablename__ = "wellbeing_symptom_events"
    __table_args__ = (
        Index("ix_wellbeing_symptom_events_user_date", "user_id", "entry_date"),
        Index("ix_wellbeing_symptom_events_dose", "dose_id"),
        CheckConstraint("char_length(symptom) >= 1", name="symptom_present"),
        CheckConstraint("severity BETWEEN 0 AND 10", name="severity_range"),
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 10080",
            name="duration_range",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    # The dose this side effect was noted for; deleting the dose takes its side effects with it.
    dose_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("wellbeing_dose_events.id", ondelete="CASCADE")
    )
    symptom: Mapped[str] = mapped_column(String(40))
    severity: Mapped[int | None] = mapped_column(SmallInteger)
    onset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    affects_daily_life: Mapped[bool | None] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Medication(Base):
    """A medicine the user takes: box size, strength of one pill, usual pills per dose.
    Dose events keep their own copy of the name, so renaming or removing an entry never rewrites
    history. The stock on hand is not stored here; it is the sum of the stock ledger minus the
    pills of the doses logged against this medicine."""

    __tablename__ = "wellbeing_medications"
    __table_args__ = (
        Index("uq_wellbeing_medications_user_name", "user_id", text("lower(name)"), unique=True),
        CheckConstraint("char_length(name) >= 1", name="name_present"),
        CheckConstraint("char_length(count_unit) >= 1", name="count_unit_present"),
        CheckConstraint(
            "pills_per_box IS NULL OR (pills_per_box >= 1 AND pills_per_box <= 10000)",
            name="box_size_range",
        ),
        CheckConstraint(
            "strength_amount IS NULL OR (strength_amount > 0 AND strength_amount <= 100000)",
            name="strength_range",
        ),
        CheckConstraint(
            "(strength_amount IS NULL) = (strength_unit IS NULL)", name="strength_pair"
        ),
        CheckConstraint(
            "default_pills IS NULL OR (default_pills > 0 AND default_pills <= 1000)",
            name="default_pills_range",
        ),
        CheckConstraint("regimen IN ('scheduled','as_needed')", name="regimen_values"),
        CheckConstraint("cardinality(side_effects) <= 20", name="side_effects_count"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    count_unit: Mapped[str] = mapped_column(String(8), server_default="颗")
    pills_per_box: Mapped[int | None] = mapped_column(Integer)
    strength_amount: Mapped[Decimal | None] = mapped_column(Numeric(9, 3))
    strength_unit: Mapped[str | None] = mapped_column(String(16))
    default_pills: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    regimen: Mapped[str] = mapped_column(String(12), server_default="scheduled")
    # Side effects the user links to this medicine (shown as one-tap choices when logging one).
    side_effects: Mapped[list[str]] = mapped_column(ARRAY(String(40)), server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StockMovement(Base):
    """Stock ledger: a restock adds pills; a count (盘点) adds the counted difference."""

    __tablename__ = "wellbeing_stock_movements"
    __table_args__ = (
        Index("ix_wellbeing_stock_movements_medication", "medication_id"),
        CheckConstraint("kind IN ('restock','adjust')", name="kind_values"),
        CheckConstraint("pills <> 0", name="pills_nonzero"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    medication_id: Mapped[UUID] = mapped_column(
        ForeignKey("wellbeing_medications.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(8))
    pills: Mapped[Decimal] = mapped_column(Numeric(9, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SymptomName(Base):
    """A side effect the user wants as a one-tap choice; events keep their own copy of the name."""

    __tablename__ = "wellbeing_symptom_names"
    __table_args__ = (
        Index("uq_wellbeing_symptom_names_user_name", "user_id", text("lower(name)"), unique=True),
        CheckConstraint("char_length(name) >= 1", name="name_present"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
