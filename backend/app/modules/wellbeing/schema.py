import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.modules.users.schema import StrictInput

# Control characters (NUL breaks PostgreSQL text); newlines and tabs stay valid in notes.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LINE_BREAK = re.compile(r"[\n\r\t]")

ENTRY_FIELDS = (
    "mood",
    "anxiety",
    "energy",
    "focus",
    "functioning",
    "sleep_hours",
    "sleep_quality",
    "note",
)

Rating = Annotated[int, Field(ge=0, le=10)]
Regimen = Literal["scheduled", "as_needed"]
# JSON carries dates and instants as strings; strict mode would reject them for date types.
Day = Annotated[date, Field(strict=False)]
Instant = Annotated[datetime, Field(strict=False)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16)]
Symptom = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
CountUnit = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8)]
Ident = Annotated[UUID, Field(strict=False)]
Pills = Annotated[Decimal, Field(gt=0, le=1000, decimal_places=2)]
SideEffects = Annotated[list[Symptom], Field(max_length=20)]
ClockTime = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


def _decimal(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("必须是数字")
    return Decimal(str(value))


def _text(value, *, multiline: bool):
    if not isinstance(value, str):
        return value
    if _CONTROL.search(value) or (not multiline and _LINE_BREAK.search(value)):
        raise ValueError("包含不允许的控制字符")
    return value


def _distinct(names: list[str]) -> list[str]:
    """Side-effect names without repeats (any case); the first spelling and the order stay."""
    seen: set[str] = set()
    result = []
    for name in names:
        if name.lower() not in seen:
            seen.add(name.lower())
            result.append(name)
    return result


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise ValueError("时间必须包含时区")
    return value


class _Texts(StrictInput):
    """Shared text and timestamp rules for the dose and symptom payloads."""

    @field_validator(
        "medication_name",
        "dose_unit",
        "symptom",
        "name",
        "strength_unit",
        "count_unit",
        "side_effects",
        check_fields=False,
        mode="before",
    )
    @classmethod
    def single_line(cls, value):
        if isinstance(value, list):
            return [_text(item, multiline=False) for item in value]
        return _text(value, multiline=False)

    @field_validator("note", check_fields=False, mode="before")
    @classmethod
    def multi_line(cls, value):
        value = _text(value, multiline=True)
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("taken_at", "onset_at", "based_on", check_fields=False, mode="before")
    @classmethod
    def instant_is_text(cls, value):
        if value is not None and not isinstance(value, str):
            raise ValueError("时间必须是 ISO 字符串")
        return value

    @field_validator("taken_at", "onset_at", "based_on", check_fields=False)
    @classmethod
    def instant_is_aware(cls, value):
        return _aware(value)

    @field_validator(
        "dose_amount",
        "sleep_hours",
        "strength_amount",
        "default_pills",
        "pills",
        check_fields=False,
        mode="before",
    )
    @classmethod
    def numeric(cls, value):
        return value if value is None else _decimal(value)


class EntryInput(_Texts):
    """Full replacement of one day's state: every answer is optional and unanswered means NULL."""

    mood: Rating | None = None
    anxiety: Rating | None = None
    energy: Rating | None = None
    focus: Rating | None = None
    functioning: Rating | None = None
    sleep_hours: Decimal | None = Field(default=None, ge=0, le=24, decimal_places=2)
    sleep_quality: Rating | None = None
    note: str | None = Field(default=None, max_length=2000)
    # Optional write guard. Omitted: save unconditionally. null: the editor loaded an empty day.
    # A timestamp: the editor loaded that version; a newer save elsewhere makes this one a 409.
    based_on: Instant | None = None

    @model_validator(mode="after")
    def something_answered(self):
        values = [getattr(self, name) for name in ENTRY_FIELDS]
        if all(value is None or value == "" for value in values):
            raise ValueError("至少填写一项")
        return self


class DoseInput(_Texts):
    """One intake: a number of pills (strength per pill converts it), or an amount and unit."""

    medication_name: Name
    medication_id: Ident | None = None
    pills: Pills | None = None
    dose_amount: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=3)
    dose_unit: Unit | None = None
    taken_at: Instant
    regimen: Regimen = "scheduled"
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def has_a_quantity(self):
        if (self.dose_amount is None) != (self.dose_unit is None):
            raise ValueError("剂量需要同时填写数值和单位")
        if self.pills is None and self.dose_amount is None:
            raise ValueError("请填写颗数，或剂量和单位")
        return self


class DosePatch(_Texts):
    medication_name: Name = Field(default=None)
    medication_id: Ident | None = None
    pills: Pills = Field(default=None)
    dose_amount: Decimal = Field(default=None, gt=0, le=100000, decimal_places=3)
    dose_unit: Unit = Field(default=None)
    taken_at: Instant = Field(default=None)
    regimen: Regimen = Field(default=None)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        required = ("medication_name", "pills", "dose_amount", "dose_unit", "taken_at", "regimen")
        for name in required:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError("该字段不能为空")
        return self


class BatchDoseInput(_Texts):
    """Back-fill several days at once: every listed time on every day of the range."""

    medication_id: Ident
    pills: Pills | None = None
    start_date: Day
    end_date: Day
    times: Annotated[list[ClockTime], Field(min_length=1, max_length=6)]
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def ordered_and_distinct(self):
        if self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        if len(set(self.times)) != len(self.times):
            raise ValueError("时间点不能重复")
        return self


class BatchDoseResult(BaseModel):
    created: int
    skipped_existing: int
    skipped_future: int


class SymptomInput(_Texts):
    entry_date: Day
    dose_id: Ident | None = None
    symptom: Symptom
    severity: Rating | None = None
    onset_at: Instant | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=10080)
    affects_daily_life: bool | None = None


class SymptomPatch(_Texts):
    entry_date: Day = Field(default=None)
    symptom: Symptom = Field(default=None)
    severity: Rating | None = None
    onset_at: Instant | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=10080)
    affects_daily_life: bool | None = None

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        for name in ("entry_date", "symptom"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError("该字段不能为空")
        return self


class EntryView(BaseModel):
    entry_date: date
    mood: int | None
    anxiety: int | None
    energy: int | None
    focus: int | None
    functioning: int | None
    sleep_hours: float | None
    sleep_quality: int | None
    note: str | None
    updated_at: datetime


class DoseView(BaseModel):
    id: UUID
    entry_date: date
    medication_name: str
    medication_id: UUID | None
    pills: float | None
    dose_amount: float | None
    dose_unit: str | None
    taken_at: datetime
    regimen: Regimen
    note: str | None


class SymptomView(BaseModel):
    id: UUID
    entry_date: date
    dose_id: UUID | None
    symptom: str
    severity: int | None
    onset_at: datetime | None
    duration_minutes: int | None
    affects_daily_life: bool | None


class DayView(BaseModel):
    date: date
    today: date
    timezone: str
    entry: EntryView | None
    doses: list[DoseView]
    symptoms: list[SymptomView]


class DaySummary(BaseModel):
    date: date
    has_entry: bool
    dose_count: int
    symptom_count: int


class EntryList(BaseModel):
    items: list[EntryView]
    total: int
    limit: int
    offset: int


class MedicationInput(_Texts):
    name: Name
    count_unit: CountUnit = "颗"
    pills_per_box: Annotated[int, Field(ge=1, le=10000)] | None = None
    strength_amount: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=3)
    strength_unit: Unit | None = None
    default_pills: Pills | None = None
    regimen: Regimen = "scheduled"
    side_effects: SideEffects = Field(default_factory=list)

    @model_validator(mode="after")
    def strength_pair(self):
        if (self.strength_amount is None) != (self.strength_unit is None):
            raise ValueError("规格需要同时填写数值和单位")
        return self

    @field_validator("side_effects")
    @classmethod
    def distinct_names(cls, value):
        return _distinct(value)


class MedicationPatch(_Texts):
    name: Name = Field(default=None)
    count_unit: CountUnit = Field(default=None)
    pills_per_box: Annotated[int, Field(ge=1, le=10000)] | None = None
    strength_amount: Decimal | None = Field(default=None, gt=0, le=100000, decimal_places=3)
    strength_unit: Unit | None = None
    default_pills: Pills | None = None
    regimen: Regimen = Field(default=None)
    side_effects: SideEffects = Field(default=None)

    @field_validator("side_effects")
    @classmethod
    def distinct_names(cls, value):
        return None if value is None else _distinct(value)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        for name in ("name", "count_unit", "regimen", "side_effects"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError("该字段不能为空")
        return self


class RestockInput(_Texts):
    """Pills added to the stock: whole boxes (needs the box size) and/or loose pills."""

    boxes: Annotated[int, Field(ge=0, le=10000)] = 0
    pills: Decimal = Field(default=Decimal(0), ge=0, le=100000, decimal_places=2)

    @model_validator(mode="after")
    def something_added(self):
        if self.boxes == 0 and self.pills == 0:
            raise ValueError("请填写盒数或颗数")
        return self


class CountInput(_Texts):
    """A stocktake: what is really on the shelf now."""

    boxes: Annotated[int, Field(ge=0, le=10000)] = 0
    pills: Decimal = Field(default=Decimal(0), ge=0, le=100000, decimal_places=2)


class SymptomNameInput(_Texts):
    name: Symptom


class SymptomNameView(BaseModel):
    id: UUID
    name: str
    event_count: int


class StockView(BaseModel):
    pills: float
    boxes: int | None
    loose_pills: float | None
    avg_daily_pills: float | None
    days_left: float | None


class MedicationView(BaseModel):
    id: UUID
    name: str
    count_unit: str
    pills_per_box: int | None
    strength_amount: float | None
    strength_unit: str | None
    default_pills: float | None
    regimen: Regimen
    side_effects: list[str]
    dose_count: int
    last_taken_at: datetime | None
    stock: StockView | None


class Deleted(BaseModel):
    deleted: Literal[True] = True


class TrendDay(BaseModel):
    date: date
    mood: int | None
    anxiety: int | None
    energy: int | None
    focus: int | None
    functioning: int | None
    sleep_hours: float | None
    sleep_quality: int | None
    dose_count: int
    symptom_count: int
    symptom_max_severity: int | None


class SymptomStat(BaseModel):
    symptom: str
    count: int
    days: int
    avg_severity: float | None
    max_severity: int | None
    affects_daily_life_count: int


class Trends(BaseModel):
    days: int
    start: date
    end: date
    timezone: str
    recorded_days: int
    series: list[TrendDay]
    symptoms: list[SymptomStat]
