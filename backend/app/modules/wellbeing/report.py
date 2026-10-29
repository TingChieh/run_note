"""Clinic-visit summary and CSV export.

Pure summarisation of what the user actually logged: no diagnosis, no dosing advice, and the
symptom/dose relationship is only an objective time order, never a causal claim.
"""

import csv
import io
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from app.modules.wellbeing.model import DailyEntry, DoseEvent, SymptomEvent
from app.modules.wellbeing.schema import DoseView, SymptomStat, SymptomView
from app.modules.wellbeing.service import (
    RATING_FIELDS,
    account_zone,
    check_range,
    dose_view,
    range_entries,
    range_events,
    symptom_stats,
    symptom_view,
    today_for,
)

PRECEDING_WINDOW = timedelta(hours=24)
CsvKind = Literal["entries", "doses", "symptoms"]


class RatingStat(BaseModel):
    key: str
    answered_days: int
    mean: float | None
    min: int | None
    max: int | None
    first: int | None
    last: int | None


class WeekStat(BaseModel):
    week_start: date
    entries: int
    mood_mean: float | None
    anxiety_mean: float | None


class SleepStat(BaseModel):
    answered_days: int
    mean_hours: float | None
    min_hours: float | None
    max_hours: float | None
    quality_answered_days: int
    mean_quality: float | None


class DoseChange(BaseModel):
    date: date
    taken_at: datetime
    pills: float | None
    dose_amount: float | None
    dose_unit: str | None
    kind: Literal["first_in_range", "changed"]


class MedicationStat(BaseModel):
    name: str
    dose_count: int
    scheduled_count: int
    as_needed_count: int
    total_pills: float
    first_taken_at: datetime
    last_taken_at: datetime
    timeline: list[DoseChange]


class PrecedingDose(BaseModel):
    medication_name: str
    minutes_before: int


class SymptomEventView(SymptomView):
    preceding_dose: PrecedingDose | None


class NoteView(BaseModel):
    date: date
    note: str


class Coverage(BaseModel):
    days_in_range: int
    days_with_entry: int
    days_without_entry: int
    missing_dates: list[date]
    unanswered: dict[str, int]


class Report(BaseModel):
    start: date
    end: date
    timezone: str
    generated_on: date
    coverage: Coverage
    ratings: list[RatingStat]
    weekly: list[WeekStat]
    sleep: SleepStat
    medications: list[MedicationStat]
    doses: list[DoseView]
    symptoms: list[SymptomStat]
    symptom_events: list[SymptomEventView]
    notes: list[NoteView]


def _number(value) -> float | None:
    return None if value is None else float(value)


def _mean(values: list[float], digits: int = 1) -> float | None:
    return round(sum(values) / len(values), digits) if values else None


def _rating_stats(entries: list[DailyEntry]) -> list[RatingStat]:
    stats = []
    for key in RATING_FIELDS:
        answered = [(row.entry_date, getattr(row, key)) for row in entries]
        values = [value for _, value in answered if value is not None]
        stats.append(
            RatingStat(
                key=key,
                answered_days=len(values),
                mean=_mean(values),
                min=min(values, default=None),
                max=max(values, default=None),
                first=values[0] if values else None,
                last=values[-1] if values else None,
            )
        )
    return stats


def _weekly(entries: list[DailyEntry]) -> list[WeekStat]:
    weeks: dict[date, list[DailyEntry]] = {}
    for row in entries:
        weeks.setdefault(row.entry_date - timedelta(days=row.entry_date.weekday()), []).append(row)
    return [
        WeekStat(
            week_start=start,
            entries=len(rows),
            mood_mean=_mean([r.mood for r in rows if r.mood is not None]),
            anxiety_mean=_mean([r.anxiety for r in rows if r.anxiety is not None]),
        )
        for start, rows in sorted(weeks.items())
    ]


def _sleep(entries: list[DailyEntry]) -> SleepStat:
    hours = [float(row.sleep_hours) for row in entries if row.sleep_hours is not None]
    quality = [row.sleep_quality for row in entries if row.sleep_quality is not None]
    return SleepStat(
        answered_days=len(hours),
        mean_hours=_mean(hours, 2),
        min_hours=min(hours, default=None),
        max_hours=max(hours, default=None),
        quality_answered_days=len(quality),
        mean_quality=_mean(quality),
    )


def _medications(doses: list[DoseEvent]) -> list[MedicationStat]:
    grouped: dict[str, list[DoseEvent]] = {}
    for dose in doses:
        grouped.setdefault(dose.medication_name, []).append(dose)
    result = []
    for name, items in grouped.items():
        timeline: list[DoseChange] = []
        previous: tuple | None = None
        for dose in items:
            current = (dose.pills, dose.dose_amount, dose.dose_unit)
            if current != previous:
                timeline.append(
                    DoseChange(
                        date=dose.entry_date,
                        taken_at=dose.taken_at,
                        pills=_number(dose.pills),
                        dose_amount=_number(dose.dose_amount),
                        dose_unit=dose.dose_unit,
                        kind="first_in_range" if previous is None else "changed",
                    )
                )
            previous = current
        result.append(
            MedicationStat(
                name=name,
                dose_count=len(items),
                scheduled_count=sum(1 for d in items if d.regimen == "scheduled"),
                as_needed_count=sum(1 for d in items if d.regimen == "as_needed"),
                total_pills=float(sum((d.pills or 0) for d in items)),
                first_taken_at=items[0].taken_at,
                last_taken_at=items[-1].taken_at,
                timeline=timeline,
            )
        )
    return sorted(result, key=lambda stat: stat.first_taken_at)


def _preceding(event: SymptomEvent, doses: list[DoseEvent]) -> PrecedingDose | None:
    """The latest dose logged before the onset time: an ordering fact, not a cause."""
    if event.onset_at is None:
        return None
    earlier = [
        d
        for d in doses
        if d.taken_at <= event.onset_at and event.onset_at - d.taken_at <= PRECEDING_WINDOW
    ]
    if not earlier:
        return None
    last = max(earlier, key=lambda d: d.taken_at)
    return PrecedingDose(
        medication_name=last.medication_name,
        minutes_before=int((event.onset_at - last.taken_at).total_seconds() // 60),
    )


def build_report(db, user, start: date, end: date, now: datetime) -> Report:
    check_range(start, end)
    entries = range_entries(db, user.id, start, end)
    doses, symptoms = range_events(db, user.id, start, end)
    recorded = {row.entry_date for row in entries}
    span = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    missing = [day for day in span if day not in recorded]
    unanswered = {
        key: sum(1 for row in entries if getattr(row, key) is None)
        for key in (*RATING_FIELDS, "sleep_hours")
    }
    return Report(
        start=start,
        end=end,
        timezone=user.timezone,
        generated_on=today_for(user, now),
        coverage=Coverage(
            days_in_range=len(span),
            days_with_entry=len(entries),
            days_without_entry=len(missing),
            missing_dates=missing,
            unanswered=unanswered,
        ),
        ratings=_rating_stats(entries),
        weekly=_weekly(entries),
        sleep=_sleep(entries),
        medications=_medications(doses),
        doses=[dose_view(dose) for dose in doses],
        symptoms=symptom_stats(symptoms),
        symptom_events=[
            SymptomEventView(**symptom_view(e).model_dump(), preceding_dose=_preceding(e, doses))
            for e in symptoms
        ],
        notes=[NoteView(date=row.entry_date, note=row.note) for row in entries if row.note],
    )


def _clock(hours) -> str:
    """A sleep duration as h:mm for people reading the spreadsheet (minutes are exact)."""
    if hours is None:
        return ""
    minutes = round(float(hours) * 60)
    return f"{minutes // 60}:{minutes % 60:02d}"


_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value) -> str:
    """Neutralise spreadsheet formulas in user text; other values are written verbatim."""
    if value is None:
        return ""
    text = str(value)
    return "'" + text if text.startswith(_FORMULA) else text


def csv_rows(db, user, kind: CsvKind, start: date, end: date) -> list[list[str]]:
    check_range(start, end)
    zone = account_zone(user)
    if kind == "entries":
        rows = [
            [
                "日期",
                "开心程度(0-10,越高越好)",
                "焦虑(0-10,越高越重)",
                "精力(0-10,越高越好)",
                "注意力(0-10,越高越好)",
                "日常功能(0-10,越高越好)",
                "睡眠时长(小时)",
                "睡眠时长(时:分)",
                "睡眠质量(0-10,越高越好)",
                "备注",
            ]
        ]
        for row in range_entries(db, user.id, start, end):
            rows.append(
                [
                    row.entry_date.isoformat(),
                    safe_cell(row.mood),
                    safe_cell(row.anxiety),
                    safe_cell(row.energy),
                    safe_cell(row.focus),
                    safe_cell(row.functioning),
                    "" if row.sleep_hours is None else f"{row.sleep_hours:.2f}",
                    _clock(row.sleep_hours),
                    safe_cell(row.sleep_quality),
                    safe_cell(row.note),
                ]
            )
        return rows
    doses, symptoms = range_events(db, user.id, start, end)
    if kind == "doses":
        rows = [["日期", "服药时间", "药物", "颗数", "剂量", "单位", "类型", "备注"]]
        for dose in doses:
            rows.append(
                [
                    dose.entry_date.isoformat(),
                    dose.taken_at.astimezone(zone).isoformat(timespec="minutes"),
                    safe_cell(dose.medication_name),
                    "" if dose.pills is None else f"{dose.pills.normalize():f}",
                    "" if dose.dose_amount is None else f"{dose.dose_amount.normalize():f}",
                    safe_cell(dose.dose_unit),
                    "常规" if dose.regimen == "scheduled" else "按需",
                    safe_cell(dose.note),
                ]
            )
        return rows
    rows = [
        ["日期", "症状", "严重程度(0-10)", "出现时间", "持续(分钟)", "影响正常生活", "此前最近服药"]
    ]
    for event in symptoms:
        preceding = _preceding(event, doses)
        rows.append(
            [
                event.entry_date.isoformat(),
                safe_cell(event.symptom),
                "" if event.severity is None else str(event.severity),
                ""
                if event.onset_at is None
                else event.onset_at.astimezone(zone).isoformat(timespec="minutes"),
                safe_cell(event.duration_minutes),
                {True: "是", False: "否", None: ""}[event.affects_daily_life],
                ""
                if preceding is None
                else safe_cell(f"{preceding.medication_name}，{preceding.minutes_before} 分钟前"),
            ]
        )
    return rows


def render_csv(rows: list[list[str]]) -> bytes:
    """UTF-8 with BOM so Excel opens the Chinese headers correctly."""
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")
