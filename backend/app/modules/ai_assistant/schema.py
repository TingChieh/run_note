"""StrictInput tool argument schemas, UI block schemas, and internal service views."""

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.responses import ExactView
from app.modules.users.schema import StrictInput

# Tool arguments arrive as JSON from the model; ISO date and UUID strings are parsed while
# remaining strict for integers, booleans, strings, and forbidding all unknown fields.
ToolDate = Annotated[date, Field(strict=False)]
ToolUUID = Annotated[UUID, Field(strict=False)]

RecordSection = Literal["personal_bests", "totals", "yearly", "weekday", "weekly", "monthly"]
ActivitySort = Literal["date_desc", "date_asc", "distance_desc", "pace_asc"]
FootprintScope = Literal["china", "global"]
RouteGroupSort = Literal["count", "recent", "distance"]
TrendPeriod = Literal["week", "month", "year"]
ReportPeriod = Literal["month", "year"]


class RunningSummaryInput(StrictInput):
    date_from: ToolDate | None = None
    date_to: ToolDate | None = None

    @model_validator(mode="after")
    def both_or_neither(self):
        if (self.date_from is None) != (self.date_to is None):
            raise ValueError("date_from and date_to must either both be provided or both omitted")
        if (
            self.date_from is not None
            and self.date_to is not None
            and self.date_from >= self.date_to
        ):
            raise ValueError("date_to must be after date_from")
        return self


class RunningTrendsInput(StrictInput):
    date_from: ToolDate
    date_to: ToolDate
    period: TrendPeriod = "week"
    include_device_metrics: bool = False

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.date_from >= self.date_to:
            raise ValueError("date_to must be after date_from")
        return self


class PeriodReportInput(StrictInput):
    period: ReportPeriod
    year: int = Field(ge=1900, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)

    @model_validator(mode="after")
    def check_month(self):
        if self.period == "month" and self.month is None:
            raise ValueError("month is required when period is 'month'")
        if self.period == "year" and self.month is not None:
            raise ValueError("month is not allowed when period is 'year'")
        return self


class PeriodWindowInput(StrictInput):
    date_from: ToolDate
    date_to: ToolDate
    label: str | None = Field(default=None, min_length=1, max_length=40)

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.date_from >= self.date_to:
            raise ValueError("date_to must be after date_from")
        return self


class ComparePeriodsInput(StrictInput):
    period_a: PeriodWindowInput
    period_b: PeriodWindowInput


class PersonalRecordsInput(StrictInput):
    sections: list[RecordSection] = Field(
        default_factory=lambda: ["personal_bests", "totals", "yearly"],
        min_length=1,
        max_length=6,
    )

    @field_validator("sections")
    @classmethod
    def unique_sections(cls, value: list[RecordSection]) -> list[RecordSection]:
        return list(dict.fromkeys(value))


class StreaksAndGoalsInput(StrictInput):
    pass


class SearchActivitiesInput(StrictInput):
    date_from: ToolDate | None = None
    date_to: ToolDate | None = None
    category: str | None = Field(default=None, max_length=30)
    min_distance_m: int | None = Field(default=None, ge=0, le=1_000_000)
    max_distance_m: int | None = Field(default=None, ge=0, le=1_000_000)
    sort: ActivitySort = "date_desc"
    limit: int = Field(default=10, ge=1, le=20)

    @field_validator("category", mode="before")
    @classmethod
    def trim_category(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def check_bounds(self):
        if (
            self.date_from is not None
            and self.date_to is not None
            and self.date_from >= self.date_to
        ):
            raise ValueError("date_to must be after date_from")
        if (
            self.min_distance_m is not None
            and self.max_distance_m is not None
            and self.min_distance_m > self.max_distance_m
        ):
            raise ValueError("min_distance_m cannot exceed max_distance_m")
        return self


class ActivityDetailInput(StrictInput):
    activity_id: ToolUUID


class FootprintSummaryInput(StrictInput):
    scope: FootprintScope = "china"
    year: int | None = Field(default=None, ge=1900, le=2100)
    limit: int = Field(default=20, ge=1, le=34)


class FrequentRoutesInput(StrictInput):
    sort: RouteGroupSort = "count"
    limit: int = Field(default=5, ge=1, le=10)
    group_id: ToolUUID | None = None


class UIBlock(ExactView):
    type: Literal[
        "metrics_card",
        "trend_chart",
        "period_card",
        "comparison_card",
        "records_summary",
        "records_chart",
        "goals_streaks_card",
        "activity_list",
        "activity_detail_card",
        "footprint_summary_card",
        "route_group_list",
    ]
    data: dict[str, Any]


class ConsentView(BaseModel):
    consented: bool
    consent_version: str | None
    required_version: str
    consented_at: datetime | None
    revoked_at: datetime | None


class QuotaStatusView(BaseModel):
    daily_message_limit: int
    messages_today: int
    remaining_messages_today: int
    daily_token_budget: int
    tokens_today: int
    remaining_tokens_today: int
    site_daily_token_budget: int
    site_tokens_today: int
    site_budget_exhausted: bool


class ConversationView(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime


class MessageView(BaseModel):
    id: UUID
    conversation_id: UUID
    role: Literal["user", "assistant"]
    status: Literal["pending", "streaming", "succeeded", "failed", "cancelled"]
    content: str | None
    tool_calls_summary: list[dict[str, Any]]
    ui_blocks: list[UIBlock]
    model: str | None
    prompt_version: str | None
    error_code: str | None
    input_tokens: int | None
    output_tokens: int | None
    cached_input_tokens: int | None
    created_at: datetime
    finished_at: datetime | None
    is_stale: bool
