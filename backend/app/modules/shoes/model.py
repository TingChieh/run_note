from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Shoe(Base):
    __tablename__ = "shoes"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_shoes_id_user_id"),
        CheckConstraint("char_length(btrim(name)) BETWEEN 1 AND 80", name="name_length"),
        CheckConstraint("char_length(notes) <= 1000", name="notes_length"),
        CheckConstraint(
            "initial_distance_m >= 0 AND initial_distance_m < 1000000000", name="initial_range"
        ),
        CheckConstraint(
            "replacement_distance_m > 0 AND replacement_distance_m < 1000000000",
            name="replacement_range",
        ),
        CheckConstraint("retired_on >= purchased_on", name="date_order"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    brand: Mapped[str | None] = mapped_column(String(60))
    model: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(Text)
    purchased_on: Mapped[date | None] = mapped_column(Date)
    retired_on: Mapped[date | None] = mapped_column(Date)
    initial_distance_m: Mapped[Decimal] = mapped_column(Numeric(12, 3), server_default="0")
    replacement_distance_m: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
