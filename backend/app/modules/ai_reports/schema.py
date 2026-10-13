import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AnalysisText(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    trend_summary: str = Field(min_length=1, max_length=3000)
    recommendations: list[str] = Field(min_length=1, max_length=6)
    limitations: str = Field(min_length=1, max_length=1500)

    @model_validator(mode="after")
    def qualitative_only(self):
        texts = [self.trend_summary, *self.recommendations, self.limitations]
        if sum(map(len, texts)) > 6000 or any(not t.strip() or len(t) > 3000 for t in texts):
            raise ValueError("Analysis text exceeds limits")
        if len(self.model_dump_json()) > 10000:
            raise ValueError("Encoded analysis text exceeds storage limit")
        # Numerical facts belong exclusively to the immutable server snapshot.
        # Conservative Unicode numeric rejection also covers Chinese financial
        # numerals, circled digits and Roman numerals regardless of unit spelling.
        # 参/參 also appear in ordinary words such as 参考; reject their quantity use.
        english = (
            r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
            r"hundred|thousand|half|double|triple)\b"
        )
        qualitative_words = re.compile(
            r"进一步|進一步|下一步|一致|一般|一起|一旦|一贯|一貫|统一|統一|万一|萬一|千万不要|千萬不要"
        )
        checked = [qualitative_words.sub("", t) for t in texts]
        if any(
            any(c.isnumeric() and c not in "参參" for c in t)
            or re.search(
                r"[<>%％]|百分之|半|两|兩|[参參]\s*(?:组|組|回|次|公里|米|分钟|分鐘|秒|小时|小時|天|周|倍)|"
                + english,
                t,
                re.I,
            )
            for t in checked
        ):
            raise ValueError("AI output must contain qualitative text only")
        return self


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date_from: date
    date_to: date
    consent_to_send_summary: bool = Field(strict=True)

    @field_validator("consent_to_send_summary")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("Explicit summary consent is required")
        return value


class ReportView(BaseModel):
    id: UUID
    date_from: date
    date_to: date
    status: Literal["pending", "succeeded", "failed"]
    stats_snapshot: dict
    analysis: AnalysisText | None
    model: str
    prompt_version: str
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None
    is_stale: bool


class ReportList(BaseModel):
    items: list[ReportView]
    total: int
    limit: int
    offset: int


class AnalysisContext(BaseModel):
    configured: bool
    model: str | None
    daily_limit: int
    attempts_today: int
    remaining_today: int
    date_from: date
    date_to: date
    stats_snapshot: dict


class ProviderResult(BaseModel):
    analysis: AnalysisText
    input_tokens: int | None = Field(default=None, ge=0, le=10000000)
    output_tokens: int | None = Field(default=None, ge=0, le=10000000)
