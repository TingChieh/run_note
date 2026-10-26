# 个人跑步纪录与趋势分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `GET /statistics/records` 聚合接口与 `/records` 页面（5K/10K 最佳、月度里程、配速趋势、训练频率、同期年度对比），并在 `/dashboard` 追加一张摘要卡。

**Architecture:** 在现有 `statistics` 模块内新增 `records.py`（纯函数 + 少量 SQL），复用 `service.py` 的可靠配速判定、`trends()`、`summary()`；同一 handler 以本人视图和展示视图两种形式暴露（展示端由 `named_router` 自动复制出具名版本）。前端新增 `lib/api/records.ts`（运行时校验）、一个通用图表组件和三份页面入口，数据在 `onMount` 加载。无数据库变更、无迁移。

**Tech Stack:** FastAPI + SQLAlchemy 2.1（同步）+ Pydantic 2；SvelteKit 3 / Svelte 5 runes、echarts 6（动态加载）、Vitest、Playwright（合成 API）。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-10-26-personal-records-design.md`。与其冲突时以本计划“规格修订”一节为准（实现前已同步进规格）。
- **不执行** `git commit` / `push` / 建分支以外的 git 写操作，除非用户显式授权；计划里的 “Checkpoint” 步骤只做 `git status` / `git diff` 核对，不提交。工作区有用户未提交改动，**不得覆盖、还原或顺手清理**；改 `frontend/src/routes/dashboard/+page.svelte` 前先 `git diff` 看现状，只用 Edit 追加两处锚点，不动其它内容。
- 不改 `.env`；不在开发库迁移或写入；本功能没有迁移。集成测试只在独立 `_test` 库、仅在进程环境注入变量（见 `docs/09-phase-two-progress.md` “运行测试”）；库不可用时报告“集成测试未运行”，不得声称通过。
- 服务层同步普通函数；时间用 `request.app.state.clock()`；路由 `db.commit()` 在 service 调用之后（本功能只读，沿用 `statistics/router.py` 既有写法）。
- 响应信封复用 `activities.router.envelope`；错误 `ApiError(422, "VALIDATION_ERROR", "中文提示")`；年份查询 `ge=1900, le=2100`。
- 展示端沿用 `reject_owner_override` 与 `Owner` 依赖；响应只含汇总数字和活动 ID（无标题、备注、文件名、坐标）。
- 前端：内部导入用 `#lib/...ts`（带扩展名）；Svelte 5 runes；不用 store / `createEventDispatcher` / `$app/stores`；`echarts` 只在 `onMount` 内动态 `import()`；保留 `disposed` 标志与单调请求令牌；401 清私人状态并跳转 `/admin?reason=expired&next=…`；颜色用语义令牌；图表下方 `<details>` 数据表；缺失值渲染 `—` 并附 `sr-only` 说明；canvas 绘制用 `watchSystemTheme` 订阅并在卸载时取消。
- 新增后端接口被 UI 使用时必须同步 `frontend/tests/fixtures/ui-api.mjs`。
- Ruff `line-length = 100`，规则 `E,F,I,UP,B`；前端改动需过 `pnpm check`。
- 报告必须区分“实际运行”与“未运行”，引用本次真实输出。

## 规格修订（实现以此为准）

1. `personal_bests` 是**有序列表** `[{category:"5km", best}, {category:"10km", best}]`，不是以 `"5km"` 为键的对象（键不是合法标识符，列表更易校验）。最佳成绩统计**全部历史**，不受 `year` 限制。
2. `comparison` 为 `{current, previous, delta}`（对应 `year` / `compare_year`），不是以年份为键。
3. 响应新增 `compare_cutoff_date`（`cutoff_date` 平移到 `compare_year` 后的日期，2 月 29 日 → 2 月 28 日），另有 `date_assignment: "activity_local_date"`。
4. dashboard 摘要卡的跳转用卡片头部的“查看全部”链接按钮（避免整卡嵌套链接的可访问性问题）。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `backend/app/modules/statistics/service.py`（改） | 抽出 `duration_expression()` / `eligible_expression()` 供复用，`expressions()` 行为不变 |
| `backend/app/modules/statistics/schema.py`（改） | 新增 `PersonalBest`、`CategoryBest`、`MonthPoint`、`WeekPoint`、`WeekdayPoint`、`YearTotals`、`ComparisonDelta`、`YearComparison`、`Records` |
| `backend/app/modules/statistics/records.py`（新） | 纯函数（年份解析、截止日、周/周内统计、差值）+ `personal_best()` + `build_records()` |
| `backend/app/modules/statistics/router.py`（改） | `GET /api/v1/statistics/records` |
| `backend/app/modules/showcase/router.py`（改） | `GET /api/v1/showcase/statistics/records`（具名版本由文件末尾循环自动复制） |
| `backend/tests/unit/test_records.py`（新） | 纯函数与路由注册单元测试 |
| `backend/tests/integration/test_records.py`（新） | 真实 PostGIS：排序、月度、对比、隔离 |
| `frontend/src/lib/api/records.ts`（新） | 类型、`parseRecords`、`readRecords`、格式化 |
| `frontend/src/lib/api/view-context.ts`（改） | `contextPath` 正则加入 `records` |
| `frontend/src/lib/seo.ts`（改） | `/records` 页面描述 |
| `frontend/src/lib/components/records-chart.ts`（新） | 纯函数 `buildChartOption` |
| `frontend/src/lib/components/records-chart-runtime.ts`（新） | echarts 按需注册（含 Legend） |
| `frontend/src/lib/components/RecordsChart.svelte`（新） | 通用图表 + 数据表兜底 |
| `frontend/src/lib/components/PersonalBests.svelte`（新） | 5K/10K 纪录卡 |
| `frontend/src/lib/components/RecordsSummaryCard.svelte`（新） | dashboard 摘要卡 |
| `frontend/src/routes/records/+page.svelte`、`routes/workspace/records/+page.svelte`、`routes/p/[username]/records/+page.svelte`（新） | 页面与两份包装入口 |
| `frontend/src/lib/components/AppNavigation.svelte`（改） | 导航项“跑步纪录” |
| `frontend/src/routes/dashboard/+page.svelte`（改，仅追加） | import + 摘要卡 |
| `frontend/tests/fixtures/ui-api.mjs`（改） | 合成 `/statistics/records` |
| `frontend/tests/unit/records.test.ts`、`records-chart.test.ts`、`view-context.test.ts`（改） | Vitest |
| `frontend/tests/ui/records.spec.ts`（新）、`frontend/playwright.ui.config.ts`（改 testMatch） | Playwright UI |
| `docs/NN-personal-records.md`（新） | 特性文档 |

---

### Task 1: 后端纯逻辑与 Schema

**Files:**
- Modify: `backend/app/modules/statistics/service.py:31-47`（`expressions()` 开头）
- Modify: `backend/app/modules/statistics/schema.py`
- Create: `backend/app/modules/statistics/records.py`
- Test: `backend/tests/unit/test_records.py`

**Interfaces:**
- Produces（`service.py`）：`duration_expression()` → SQLAlchemy 表达式 `coalesce(timer_seconds, elapsed_seconds)`；`eligible_expression()` → 布尔表达式（与现有 `eligible` 完全相同）。
- Produces（`schema.py`）：下方全部模型。
- Produces（`records.py`）：`OptionalYear`、`BEST_BANDS: dict[str, tuple[Decimal, Decimal]]`、`WEEKS = 26`、`resolve_years(today, year, compare_year) -> tuple[int, int]`、`year_cutoff(year, today) -> date`、`shift_to_year(day, year) -> date`、`weekly_active_days(activity_dates, today, weeks=WEEKS) -> list[WeekPoint]`、`weekday_counts(daily) -> list[WeekdayPoint]`、`month_points(trends) -> list[MonthPoint]`、`comparison_delta(current, previous) -> ComparisonDelta`。

- [ ] **Step 1: 写失败的单元测试**

创建 `backend/tests/unit/test_records.py`：

```python
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.errors import ApiError
from app.modules.statistics.records import (
    BEST_BANDS,
    WEEKS,
    comparison_delta,
    resolve_years,
    shift_to_year,
    weekday_counts,
    weekly_active_days,
    year_cutoff,
)
from app.modules.statistics.schema import WeekdayPoint, WeekPoint, YearTotals


def totals(year, count, distance, pace):
    return YearTotals(
        year=year,
        activity_count=count,
        distance_m=Decimal(distance),
        activity_days=count,
        avg_pace_seconds_per_km=None if pace is None else Decimal(pace),
    )


def test_best_bands_follow_the_distance_classifier():
    assert BEST_BANDS == {
        "5km": (Decimal(4000), Decimal(7500)),
        "10km": (Decimal(9000), Decimal(12000)),
    }


def test_years_default_to_today_and_the_year_before():
    assert resolve_years(date(2026, 10, 26), None, None) == (2026, 2025)
    assert resolve_years(date(2026, 10, 26), 2024, None) == (2024, 2023)
    assert resolve_years(date(2026, 10, 26), 2024, 2020) == (2024, 2020)


@pytest.mark.parametrize(("year", "compare"), [(2024, 2024), (1900, None), (None, 1899)])
def test_equal_or_out_of_range_comparison_year_is_rejected(year, compare):
    with pytest.raises(ApiError) as error:
        resolve_years(date(1900, 6, 1) if year == 1900 else date(2026, 10, 26), year, compare)
    assert error.value.status_code == 422
    assert error.value.code == "VALIDATION_ERROR"


def test_cutoff_is_today_for_the_current_year_and_year_end_otherwise():
    today = date(2026, 10, 26)
    assert year_cutoff(2026, today) == today
    assert year_cutoff(2025, today) == date(2025, 12, 31)
    assert year_cutoff(2027, today) == date(2027, 12, 31)


def test_leap_day_moves_to_february_28_only_when_needed():
    assert shift_to_year(date(2024, 2, 29), 2023) == date(2023, 2, 28)
    assert shift_to_year(date(2024, 2, 29), 2028) == date(2028, 2, 29)
    assert shift_to_year(date(2026, 10, 26), 2025) == date(2025, 10, 26)


def test_weekly_active_days_counts_distinct_days_and_ignores_future_and_old_weeks():
    today = date(2026, 10, 14)  # Wednesday
    days = [
        date(2026, 10, 12),
        date(2026, 10, 12),
        date(2026, 10, 13),
        date(2026, 10, 15),
        date(2026, 10, 5),
        date(2026, 4, 13),
    ]
    weeks = weekly_active_days(days, today)
    assert len(weeks) == WEEKS == 26
    assert weeks[-1] == WeekPoint(week_start=date(2026, 10, 12), active_days=2)
    assert weeks[-2] == WeekPoint(week_start=date(2026, 10, 5), active_days=1)
    assert weeks[0].week_start == date(2026, 10, 12) - timedelta(weeks=25)
    assert sum(week.active_days for week in weeks) == 3


def test_weekday_counts_start_on_monday_and_include_zero_days():
    daily = [(date(2024, 7, 1), 2), (date(2024, 7, 2), 1), (date(2024, 7, 8), 1)]
    points = weekday_counts(daily)
    assert [p.weekday for p in points] == list(range(7))
    assert [p.activity_count for p in points] == [3, 1, 0, 0, 0, 0, 0]
    assert points[0] == WeekdayPoint(weekday=0, activity_count=3)


def test_delta_subtracts_previous_and_keeps_missing_pace_missing():
    delta = comparison_delta(totals(2024, 8, "57500", "304.211"), totals(2023, 2, "15000", "346.667"))
    assert delta.activity_count == 6
    assert delta.distance_m == Decimal("42500")
    assert delta.avg_pace_seconds_per_km == Decimal("-42.456")
    assert comparison_delta(totals(2024, 1, "1", None), totals(2023, 1, "1", "300")).avg_pace_seconds_per_km is None


def test_records_route_is_registered_for_owner_showcase_and_named_showcase():
    from app.modules.showcase.router import named_router, router as showcase_router
    from app.modules.statistics.router import router as statistics_router

    for router in (statistics_router, showcase_router, named_router):
        assert any(route.path.endswith("/statistics/records") or route.path == "/api/v1/statistics/records" for route in router.routes)
```

- [ ] **Step 2: 运行确认失败**

Run（工作目录 `backend/`）：`.venv/bin/pytest tests/unit/test_records.py -q`
Expected: 收集阶段 `ImportError`（`records` 模块不存在）。

- [ ] **Step 3: 抽出可复用表达式**

`backend/app/modules/statistics/service.py`：在 `expressions()` 之前加入两个函数，并让 `expressions()` 使用它们。把

```python
def expressions():
    duration = func.coalesce(A.timer_seconds, A.elapsed_seconds)
    known = duration.is_not(None)
    eligible = (
        (A.distance_m > 0)
        & (duration > 0)
        & (A.timer_seconds.is_not(None) | A.temporal_quality.in_(["complete", "manual"]))
    )
```

替换为

```python
def duration_expression():
    return func.coalesce(A.timer_seconds, A.elapsed_seconds)


def eligible_expression():
    return (
        (A.distance_m > 0)
        & (duration_expression() > 0)
        & (A.timer_seconds.is_not(None) | A.temporal_quality.in_(["complete", "manual"]))
    )


def expressions():
    duration = duration_expression()
    known = duration.is_not(None)
    eligible = eligible_expression()
```

其余 `expressions()` 内容不动。

- [ ] **Step 4: 新增 Schema**

`backend/app/modules/statistics/schema.py`：顶部 import 增加 `from uuid import UUID`，文件末尾追加：

```python
class PersonalBest(BaseModel):
    activity_id: UUID
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal
    avg_pace_seconds_per_km: Decimal
    qualifying_count: int


class CategoryBest(BaseModel):
    category: Literal["5km", "10km"]
    best: PersonalBest | None


class MonthPoint(BaseModel):
    month: int
    activity_count: int
    distance_m: Decimal
    avg_pace_seconds_per_km: Decimal | None


class WeekPoint(BaseModel):
    week_start: date
    active_days: int


class WeekdayPoint(BaseModel):
    weekday: int
    activity_count: int


class YearTotals(BaseModel):
    year: int
    activity_count: int
    distance_m: Decimal
    activity_days: int
    avg_pace_seconds_per_km: Decimal | None


class ComparisonDelta(BaseModel):
    activity_count: int
    distance_m: Decimal
    activity_days: int
    avg_pace_seconds_per_km: Decimal | None


class YearComparison(BaseModel):
    current: YearTotals
    previous: YearTotals
    delta: ComparisonDelta


class Records(BaseModel):
    year: int
    compare_year: int
    cutoff_date: date
    compare_cutoff_date: date
    personal_bests: list[CategoryBest]
    monthly: list[MonthPoint]
    compare_monthly: list[MonthPoint]
    weekly: list[WeekPoint]
    weekday: list[WeekdayPoint]
    comparison: YearComparison
    date_assignment: Literal["activity_local_date"] = "activity_local_date"
```

- [ ] **Step 5: 实现纯函数（先不含 SQL）**

创建 `backend/app/modules/statistics/records.py`：

```python
"""Personal bests and same-period comparisons built from activity summaries only."""

from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Annotated

from fastapi import Query
from sqlalchemy import func, select

from app.core.errors import ApiError
from app.modules.activities.classify import DISTANCE_BANDS
from app.modules.activities.model import Activity as A
from app.modules.statistics import service
from app.modules.statistics.schema import (
    CategoryBest,
    ComparisonDelta,
    MonthPoint,
    PersonalBest,
    Records,
    Trends,
    WeekdayPoint,
    WeekPoint,
    YearComparison,
    YearTotals,
)

OptionalYear = Annotated[int | None, Query(ge=1900, le=2100)]
BEST_CATEGORIES = ("5km", "10km")
BEST_BANDS = {
    label: (low, high) for label, low, high in DISTANCE_BANDS if label in BEST_CATEGORIES
}
WEEKS = 26


def resolve_years(today: date, year: int | None, compare_year: int | None) -> tuple[int, int]:
    year = today.year if year is None else year
    compare_year = year - 1 if compare_year is None else compare_year
    if compare_year < 1900 or compare_year == year:
        raise ApiError(422, "VALIDATION_ERROR", "请选择不同且在 1900–2100 年内的对比年份")
    return year, compare_year


def year_cutoff(year: int, today: date) -> date:
    return today if year == today.year else date(year, 12, 31)


def shift_to_year(day: date, year: int) -> date:
    try:
        return day.replace(year=year)
    except ValueError:  # February 29 in a non-leap target year
        return day.replace(year=year, day=28)


def weekly_active_days(activity_dates, today: date, weeks: int = WEEKS) -> list[WeekPoint]:
    current = today - timedelta(days=today.weekday())
    starts = [current - timedelta(weeks=weeks - 1 - i) for i in range(weeks)]
    counts = dict.fromkeys(starts, 0)
    for day in set(activity_dates):
        monday = day - timedelta(days=day.weekday())
        if day <= today and monday in counts:
            counts[monday] += 1
    return [WeekPoint(week_start=start, active_days=counts[start]) for start in starts]


def weekday_counts(daily) -> list[WeekdayPoint]:
    counts = [0] * 7
    for day, count in daily:
        counts[day.weekday()] += count
    return [WeekdayPoint(weekday=i, activity_count=n) for i, n in enumerate(counts)]


def month_points(trends: Trends) -> list[MonthPoint]:
    return [
        MonthPoint(
            month=bucket.bucket_start.month,
            activity_count=bucket.activity_count,
            distance_m=bucket.distance_m,
            avg_pace_seconds_per_km=bucket.avg_pace_seconds_per_km,
        )
        for bucket in trends.buckets
    ]


def comparison_delta(current: YearTotals, previous: YearTotals) -> ComparisonDelta:
    missing = current.avg_pace_seconds_per_km is None or previous.avg_pace_seconds_per_km is None
    return ComparisonDelta(
        activity_count=current.activity_count - previous.activity_count,
        distance_m=current.distance_m - previous.distance_m,
        activity_days=current.activity_days - previous.activity_days,
        avg_pace_seconds_per_km=None
        if missing
        else current.avg_pace_seconds_per_km - previous.avg_pace_seconds_per_km,
    )
```

（`func`、`select`、`ROUND_HALF_EVEN`、`CategoryBest`、`PersonalBest`、`Records`、`YearComparison`、`service`、`A` 会在 Task 2 使用；若 Ruff 此时报未使用导入，先只导入本步用到的名字，Task 2 再补齐。）

- [ ] **Step 6: 运行单元测试与 Ruff**

Run（`backend/`）：
`.venv/bin/pytest tests/unit/test_records.py -q`
Expected: 除 `test_records_route_is_registered_…` 外全部 PASS（该用例在 Task 2 完成路由后通过）。
`.venv/bin/pytest tests/unit -q` — Expected: 既有单元测试不受影响。
`.venv/bin/ruff check app tests && .venv/bin/ruff format --check app tests` — 若格式化失败，用 `.venv/bin/ruff format app/modules/statistics tests/unit/test_records.py` 后重查。

- [ ] **Step 7: Checkpoint（不提交）**

Run: `git status --short backend` — 确认只出现本任务的文件（`service.py`、`schema.py`、`records.py`、`test_records.py`）。

---

### Task 2: 后端聚合、路由与集成测试

**Files:**
- Modify: `backend/app/modules/statistics/records.py`（追加 `year_totals`、`personal_best`、`build_records`）
- Modify: `backend/app/modules/statistics/router.py`
- Modify: `backend/app/modules/showcase/router.py`
- Test: `backend/tests/integration/test_records.py`

**Interfaces:**
- Consumes（Task 1）：全部 `records.py` 纯函数、`service.duration_expression/eligible_expression/trends/summary/query`。
- Produces：`build_records(db, owner, today: date, year: int | None = None, compare_year: int | None = None) -> Records`；路由 `GET /api/v1/statistics/records`、`GET /api/v1/showcase/statistics/records`（及具名版本），查询参数 `year`、`compare_year`。

- [ ] **Step 1: 写失败的集成测试**

创建 `backend/tests/integration/test_records.py`：

```python
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.modules.activities.model import Activity
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration

OWNER_RUNS = [
    ("2024-01-10", 5000, 1500, "complete"),
    ("2024-03-05", 5000, 1400, "complete"),
    ("2024-03-06", 4000, 1250, "complete"),
    ("2024-07-01", 10000, 3300, "complete"),
    ("2024-07-02", 10500, 3600, "complete"),
    ("2024-07-05", 10000, None, "incomplete"),
    ("2024-08-01", 8000, 2000, "complete"),
    ("2024-08-02", 5000, 1400, "complete"),
    ("2023-05-01", 5000, 1600, "complete"),
    ("2023-06-01", 10000, 3600, "complete"),
]


def add_run(db, user, day, distance, seconds, quality):
    row = Activity(
        user_id=user,
        source="gpx",
        title="Synthetic record run",
        activity_date=date.fromisoformat(day),
        date_source="timestamp",
        timezone="Asia/Shanghai",
        started_at=datetime(2023, 12, 31, 16, tzinfo=UTC),
        ended_at=None,
        distance_m=Decimal(distance),
        elapsed_seconds=seconds,
        avg_pace_seconds_per_km=None,
        temporal_quality=quality,
        quality_summary={"warnings": ["TIME_INCOMPLETE"] if seconds is None else []},
        metrics_version="gpx-v1",
    )
    db.add(row)
    db.flush()
    return row.id


@pytest.fixture
def records_history(clients):  # noqa: F811 -- imported pytest fixture
    a, b, engine, app = clients
    owner, other = register(a), register(b)
    ids = {}
    with app.state.session_factory.begin() as db:
        for run in OWNER_RUNS:
            ids[run[0]] = add_run(db, owner, *run)
        ids["other"] = add_run(db, other, "2024-01-01", 5000, 1000, "complete")
    return a, b, app, ids


QUERY = "year=2024&compare_year=2023"


def test_personal_bests_rank_by_pace_over_all_history(records_history):
    a, _, _, ids = records_history
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    five, ten = data["personal_bests"]
    assert [five["category"], ten["category"]] == ["5km", "10km"]
    # 2024-03-05 and 2024-08-02 tie on pace; the earlier date wins.
    assert five["best"]["activity_id"] == str(ids["2024-03-05"])
    assert Decimal(five["best"]["avg_pace_seconds_per_km"]) == Decimal("280")
    assert Decimal(five["best"]["duration_seconds"]) == Decimal("1400")
    assert five["best"]["qualifying_count"] == 5
    assert ten["best"]["activity_id"] == str(ids["2024-07-01"])
    assert ten["best"]["qualifying_count"] == 3  # the run without a duration is excluded


def test_monthly_weekday_and_year_comparison_for_a_past_year(records_history):
    a, _, _, _ = records_history
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert (data["year"], data["compare_year"]) == (2024, 2023)
    assert (data["cutoff_date"], data["compare_cutoff_date"]) == ("2024-12-31", "2023-12-31")
    assert [m["month"] for m in data["monthly"]] == list(range(1, 13))
    march = data["monthly"][2]
    assert march["activity_count"] == 2 and Decimal(march["distance_m"]) == 9000
    assert Decimal(march["avg_pace_seconds_per_km"]) == Decimal("294.444")
    assert data["monthly"][3]["avg_pace_seconds_per_km"] is None
    assert [d["activity_count"] for d in data["weekday"]] == [1, 2, 2, 1, 2, 0, 0]
    assert len(data["weekly"]) == 26
    assert len(data["compare_monthly"]) == 12
    current, previous, delta = (data["comparison"][k] for k in ("current", "previous", "delta"))
    assert (current["year"], current["activity_count"]) == (2024, 8)
    assert Decimal(current["distance_m"]) == 57500
    assert Decimal(current["avg_pace_seconds_per_km"]) == Decimal("304.211")
    assert (previous["year"], previous["activity_count"]) == (2023, 2)
    assert Decimal(previous["avg_pace_seconds_per_km"]) == Decimal("346.667")
    assert delta["activity_count"] == 6 and Decimal(delta["distance_m"]) == 42500
    assert Decimal(delta["avg_pace_seconds_per_km"]) == Decimal("-42.456")


def test_current_year_compares_up_to_the_owners_local_today(records_history):
    a, _, app, _ = records_history
    app.state.clock = lambda: datetime(2024, 3, 6, 12, tzinfo=UTC)
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert (data["cutoff_date"], data["compare_cutoff_date"]) == ("2024-03-06", "2023-03-06")
    current, previous, delta = (data["comparison"][k] for k in ("current", "previous", "delta"))
    assert current["activity_count"] == 3 and Decimal(current["distance_m"]) == 14000
    assert previous["activity_count"] == 0 and previous["avg_pace_seconds_per_km"] is None
    assert delta["avg_pace_seconds_per_km"] is None
    assert data["weekly"][-1] == {"week_start": "2024-03-04", "active_days": 2}


def test_defaults_validation_and_owner_isolation(records_history):
    a, b, _, ids = records_history
    default = a.get("/api/v1/statistics/records").json()["data"]
    assert default["compare_year"] == default["year"] - 1
    for query in ("year=2024&compare_year=2024", "year=1900", "year=1800"):
        assert a.get(f"/api/v1/statistics/records?{query}").status_code == 422
    mine = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    theirs = b.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert theirs["personal_bests"][0]["best"]["activity_id"] == str(ids["other"])
    assert theirs["personal_bests"][0]["best"]["qualifying_count"] == 1
    assert theirs["comparison"]["current"]["activity_count"] == 1
    assert mine != theirs


def test_showcase_serves_the_site_owner_and_rejects_owner_parameters(records_history):
    a, _, _, _ = records_history
    shown = a.get(f"/api/v1/showcase/statistics/records?{QUERY}")
    assert shown.status_code == 200
    assert shown.json()["data"] == a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    for key in ("owner", "user_id", "email", "username"):
        assert a.get(f"/api/v1/showcase/statistics/records?{QUERY}&{key}=x").status_code == 422
    text = shown.text
    for forbidden in ("Synthetic record run", "email", "filename", "notes"):
        assert forbidden not in text
```

- [ ] **Step 2: 运行确认失败**

按 `docs/09-phase-two-progress.md` “运行测试”在 `backend/` 构造 `TEST_DATABASE_URL` / `TEST_DATABASE_ALLOWED_TARGETS`（仅进程环境，不打印 DSN），执行 `pytest tests/integration/test_records.py -q`。
Expected: FAIL（404，路由未注册）。**若没有可用测试库**，记录“集成测试未运行”，本任务其余步骤照常，最终报告里如实列为未运行。

- [ ] **Step 3: 追加 SQL 与聚合到 `records.py`**

把 Task 1 末尾提到的导入补齐，并在文件末尾追加：

```python
def year_totals(db, owner, year: int, cutoff: date) -> YearTotals:
    summary = service.summary(db, owner, date(year, 1, 1), cutoff + timedelta(days=1))
    return YearTotals(
        year=year,
        activity_count=summary.activity_count,
        distance_m=summary.distance_m,
        activity_days=summary.activity_days,
        avg_pace_seconds_per_km=summary.avg_pace_seconds_per_km,
    )


def personal_best(db, owner, low: Decimal, high: Decimal) -> PersonalBest | None:
    """Fastest reliable whole activity within [low, high]; ties go to the earlier date."""
    duration = service.duration_expression()
    pace = duration * 1000 / A.distance_m
    row = db.execute(
        select(
            A.id,
            A.activity_date,
            A.distance_m,
            duration.label("duration_seconds"),
            func.count().over().label("qualifying_count"),
        )
        .where(
            A.user_id == owner,
            service.eligible_expression(),
            A.distance_m >= low,
            A.distance_m <= high,
        )
        .order_by(pace.asc(), A.activity_date.asc(), A.id.asc())
        .limit(1)
    ).one_or_none()
    if row is None:
        return None
    distance, seconds = Decimal(row.distance_m), Decimal(row.duration_seconds)
    return PersonalBest(
        activity_id=row.id,
        activity_date=row.activity_date,
        distance_m=distance,
        duration_seconds=seconds,
        avg_pace_seconds_per_km=(seconds * 1000 / distance).quantize(
            Decimal(".001"), rounding=ROUND_HALF_EVEN
        ),
        qualifying_count=row.qualifying_count,
    )


def build_records(
    db, owner, today: date, year: int | None = None, compare_year: int | None = None
) -> Records:
    year, compare_year = resolve_years(today, year, compare_year)
    cutoff = year_cutoff(year, today)
    compare_cutoff = shift_to_year(cutoff, compare_year)
    first, following = date(year, 1, 1), date(year + 1, 1, 1)
    monthly = service.trends(db, owner, first, following, "month")
    compare_monthly = service.trends(
        db, owner, date(compare_year, 1, 1), date(compare_year + 1, 1, 1), "month"
    )
    daily = service.query(db, owner, first, following, daily=True)
    current_week = today - timedelta(days=today.weekday())
    week_dates = db.scalars(
        select(A.activity_date)
        .where(
            A.user_id == owner,
            A.activity_date >= current_week - timedelta(weeks=WEEKS - 1),
            A.activity_date <= today,
        )
        .distinct()
    )
    current = year_totals(db, owner, year, cutoff)
    previous = year_totals(db, owner, compare_year, compare_cutoff)
    return Records(
        year=year,
        compare_year=compare_year,
        cutoff_date=cutoff,
        compare_cutoff_date=compare_cutoff,
        personal_bests=[
            CategoryBest(category=label, best=personal_best(db, owner, low, high))
            for label, (low, high) in BEST_BANDS.items()
        ],
        monthly=month_points(monthly),
        compare_monthly=month_points(compare_monthly),
        weekly=weekly_active_days(week_dates, today),
        weekday=weekday_counts((row["date"], row["activity_count"]) for row in daily),
        comparison=YearComparison(
            current=current, previous=previous, delta=comparison_delta(current, previous)
        ),
    )
```

- [ ] **Step 4: 注册本人路由**

`backend/app/modules/statistics/router.py`：把 `from app.modules.statistics.schema import Calendar, Summary, Trends` 改为 `from app.modules.statistics.schema import Calendar, Records, Summary, Trends`，在 `from app.modules.statistics import service` 下一行加 `from app.modules.statistics.records import OptionalYear, build_records`，并在 `trends` 路由之后追加：

```python
@router.get("/records", response_model=ApiResponse[Records])
def records(
    request: Request,
    identity: Identity,
    db: Database,
    year: OptionalYear = None,
    compare_year: OptionalYear = None,
):
    today = request.app.state.clock().astimezone(ZoneInfo(identity[1].timezone)).date()
    data = build_records(db, identity[1].id, today, year, compare_year)
    db.commit()
    return envelope(request, data)
```

- [ ] **Step 5: 注册展示路由**

`backend/app/modules/showcase/router.py`：`from app.modules.statistics.schema import Calendar, Summary, Trends` 改为含 `Records`；在其下一行加 `from app.modules.statistics.records import OptionalYear, build_records`（导入保持字母序，必要时让 Ruff 排序）；在 `statistics/trends` 路由之后、`statistics/streaks` 之前追加（必须在文件末尾的 `named_router` 复制循环之前）：

```python
@router.get("/statistics/records", response_model=ApiResponse[Records])
def records(
    request: Request,
    db: DB,
    owner: Owner,
    year: OptionalYear = None,
    compare_year: OptionalYear = None,
):
    today = request.app.state.clock().astimezone(ZoneInfo(owner.timezone)).date()
    return envelope(request, build_records(db, owner.id, today, year, compare_year))
```

- [ ] **Step 6: 运行测试与 Ruff**

Run（`backend/`）：
`.venv/bin/pytest tests/unit -q` — Expected: 全部 PASS，含 `test_records.py`（路由注册用例现在应通过）。
集成：同 Step 2 的环境注入后 `pytest tests/integration/test_records.py tests/integration/test_statistics.py tests/integration/test_showcase.py -q` — Expected: PASS（既有统计/展示用例验证 `service.py` 重构未改行为）。
`.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests` — Expected: 通过。

- [ ] **Step 7: Checkpoint（不提交）**

`git status --short backend` — 只应有 `service.py`、`schema.py`、`records.py`、两个 router、两个测试文件。

---

### Task 3: 前端接口层

**Files:**
- Create: `frontend/src/lib/api/records.ts`
- Modify: `frontend/src/lib/api/view-context.ts:11`
- Modify: `frontend/src/lib/seo.ts:1-13`
- Test: `frontend/tests/unit/records.test.ts`、`frontend/tests/unit/view-context.test.ts`

**Interfaces:**
- Consumes：后端响应结构（Task 2）；`ActivityError`、`request`、`Metric`、`formatDuration` 来自 `./activities`，`dashboardDistance` 来自 `./dashboard-format`。
- Produces（`records.ts`）：类型 `RecordCategory`、`PersonalBest`、`CategoryBest`、`MonthPoint`、`WeekPoint`、`WeekdayPoint`、`YearTotals`、`ComparisonDelta`、`Records`；函数 `parseRecords(v, year?, compareYear?) -> Records`、`readRecords(year?, compareYear?, fetcher = fetch) -> Promise<Records>`、`signedDistance(value: Metric) -> string`、`paceDelta(value: Metric) -> string`、常量 `CATEGORY_NAMES`、`CATEGORY_RANGES`。

- [ ] **Step 1: 写失败的 Vitest**

创建 `frontend/tests/unit/records.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { paceDelta, parseRecords, readRecords, signedDistance } from '../../src/lib/api/records';
import { pageDescription } from '../../src/lib/seo';

const best = { activity_id: '11111111-1111-4111-8111-111111111111', activity_date: '2024-03-05', distance_m: '5000.000', duration_seconds: '1400.000', avg_pace_seconds_per_km: '280.000', qualifying_count: 5 };
const months = (count = 0) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, activity_count: count, distance_m: String(count * 5000), avg_pace_seconds_per_km: count ? '300.000' : null }));
const totals = (year: number) => ({ year, activity_count: 2, distance_m: '10000', activity_days: 2, avg_pace_seconds_per_km: '300.000' });
function valid() {
  return {
    year: 2024, compare_year: 2023, cutoff_date: '2024-12-31', compare_cutoff_date: '2023-12-31', date_assignment: 'activity_local_date',
    personal_bests: [{ category: '5km', best }, { category: '10km', best: null }],
    monthly: months(1), compare_monthly: months(0),
    weekly: Array.from({ length: 26 }, (_, i) => ({ week_start: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10), active_days: i % 4 })),
    weekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i, activity_count: i })),
    comparison: { current: totals(2024), previous: totals(2023), delta: { activity_count: 0, distance_m: '-1500.5', activity_days: 0, avg_pace_seconds_per_km: null } }
  };
}
const respond = (data: unknown) => async () => Response.json({ data, error: null });

describe('records contract', () => {
  it('accepts a complete response and keeps missing values null', () => {
    const parsed = parseRecords(valid(), 2024, 2023);
    expect(parsed.personal_bests[1].best).toBeNull();
    expect(parsed.monthly[3].avg_pace_seconds_per_km).toBe('300.000');
    expect(parsed.compare_monthly[0].avg_pace_seconds_per_km).toBeNull();
  });
  it('rejects malformed shapes before they reach the page', () => {
    const cases: ((v: any) => void)[] = [
      v => { v.monthly.pop(); }, v => { v.weekly.pop(); }, v => { v.weekday[2].weekday = 5; },
      v => { v.personal_bests.reverse(); }, v => { v.personal_bests[0].best.activity_id = 'nope'; },
      v => { v.personal_bests[0].best.qualifying_count = 0; }, v => { v.monthly[0].distance_m = '-1'; },
      v => { v.cutoff_date = '2024-02-30'; }, v => { v.compare_year = 2024; }, v => { v.weekly[1].week_start = v.weekly[0].week_start; },
      v => { v.comparison.delta.distance_m = 'abc'; }, v => { v.date_assignment = 'utc'; }
    ];
    for (const mutate of cases) { const v = valid(); mutate(v); expect(() => parseRecords(v, 2024, 2023)).toThrow('无效响应'); }
  });
  it('rejects a response for another year than requested', () => {
    expect(() => parseRecords(valid(), 2025, undefined)).toThrow('无效响应');
    expect(() => parseRecords(valid(), 2024, 2022)).toThrow('无效响应');
  });
  it('requests the showcase path with only the given years', async () => {
    const seen: string[] = [];
    await readRecords(2024, 2023, async (url, init) => { seen.push(String(url)); expect(init?.cache).toBe('no-store'); return Response.json({ data: valid(), error: null }); });
    await readRecords(undefined, undefined, async url => { seen.push(String(url)); return Response.json({ data: valid(), error: null }); });
    expect(seen).toEqual(['/api/v1/showcase/statistics/records?year=2024&compare_year=2023', '/api/v1/showcase/statistics/records']);
  });
  it('maps an expired session to 401', async () => {
    await expect(readRecords(2024, 2023, async () => new Response('x', { status: 401 }))).rejects.toMatchObject({ status: 401 });
    await expect(readRecords(2024, 2023, respond({ nope: true }))).rejects.toThrow('无效响应');
  });
  it('formats signed distance and pace differences', () => {
    expect(signedDistance('42500')).toBe('+42.5 km');
    expect(signedDistance('-1500.5')).toBe('−1.5 km');
    expect(signedDistance(0)).toBe('0 km');
    expect(signedDistance(null)).toBe('—');
    expect(paceDelta('-42.456')).toBe('快 0:42 /km');
    expect(paceDelta('12')).toBe('慢 0:12 /km');
    expect(paceDelta(0)).toBe('持平');
    expect(paceDelta(null)).toBe('—');
  });
  it('describes the records page for search engines', () => {
    expect(pageDescription('/records', 200, 'fallback')).toContain('纪录');
    expect(pageDescription('/p/alice/records', 200, 'fallback')).toContain('纪录');
  });
});
```

在 `frontend/tests/unit/view-context.test.ts` 末尾追加（保持文件既有风格）：

```ts
describe('records path', () => {
  it('keeps the records page under named and workspace contexts', () => {
    expect(contextPath(viewContext('/p/alice/records'), '/records')).toBe('/p/alice/records');
    expect(contextPath(viewContext('/workspace/records'), '/records?year=2024')).toBe('/workspace/records?year=2024');
    expect(contextPath(viewContext('/records'), '/records')).toBe('/records');
  });
});
```
（若该文件顶部没有 `describe` 导入，先看文件头，补上 `describe` 到 vitest 的导入里。）

- [ ] **Step 2: 运行确认失败**

Run（`frontend/`）：`pnpm exec vitest run tests/unit/records.test.ts tests/unit/view-context.test.ts`
Expected: FAIL（模块不存在 / 路径未映射）。

- [ ] **Step 3: 实现 `records.ts`**

创建 `frontend/src/lib/api/records.ts`：

```ts
import { ActivityError, formatDuration, request, type Metric } from './activities';
import { dashboardDistance } from './dashboard-format';

export type RecordCategory = '5km' | '10km';
export interface PersonalBest { activity_id: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric; qualifying_count: number }
export interface CategoryBest { category: RecordCategory; best: PersonalBest | null }
export interface MonthPoint { month: number; activity_count: number; distance_m: Metric; avg_pace_seconds_per_km: Metric }
export interface WeekPoint { week_start: string; active_days: number }
export interface WeekdayPoint { weekday: number; activity_count: number }
export interface YearTotals { year: number; activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric }
export interface ComparisonDelta { activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric }
export interface Records {
  year: number; compare_year: number; cutoff_date: string; compare_cutoff_date: string; date_assignment: 'activity_local_date';
  personal_bests: CategoryBest[]; monthly: MonthPoint[]; compare_monthly: MonthPoint[]; weekly: WeekPoint[]; weekday: WeekdayPoint[];
  comparison: { current: YearTotals; previous: YearTotals; delta: ComparisonDelta };
}

export const CATEGORY_NAMES: Record<RecordCategory, string> = { '5km': '5K', '10km': '10K' };
export const CATEGORY_RANGES: Record<RecordCategory, string> = { '5km': '4.0–7.5 km', '10km': '9.0–12.0 km' };
const CATEGORIES: RecordCategory[] = ['5km', '10km'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const metric = (v: unknown, nullable = false) => v === null ? nullable : (typeof v === 'number' || typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0;
const signed = (v: unknown, nullable = false) => v === null ? nullable : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
function invalid(): never { throw new ActivityError('纪录服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE'); }

function validBest(v: unknown): boolean {
  return object(v) && typeof v.activity_id === 'string' && uuid.test(v.activity_id) && isoDate(v.activity_date) && metric(v.distance_m) && metric(v.duration_seconds)
    && metric(v.avg_pace_seconds_per_km) && count(v.qualifying_count) && Number(v.qualifying_count) >= 1;
}
const validMonths = (v: unknown) => Array.isArray(v) && v.length === 12 && v.every((item, i) => object(item) && item.month === i + 1 && count(item.activity_count) && metric(item.distance_m) && metric(item.avg_pace_seconds_per_km, true));
const validTotals = (v: unknown, year: number) => object(v) && v.year === year && count(v.activity_count) && metric(v.distance_m) && count(v.activity_days) && metric(v.avg_pace_seconds_per_km, true);

export function parseRecords(v: unknown, year?: number, compareYear?: number): Records {
  if (!object(v) || !Number.isInteger(v.year) || !Number.isInteger(v.compare_year) || v.year === v.compare_year) invalid();
  const data = v as Record<string, any>;
  if ((year !== undefined && data.year !== year) || (compareYear !== undefined && data.compare_year !== compareYear)) invalid();
  if (!isoDate(data.cutoff_date) || !isoDate(data.compare_cutoff_date) || data.date_assignment !== 'activity_local_date') invalid();
  if (!Array.isArray(data.personal_bests) || data.personal_bests.length !== 2 || !data.personal_bests.every((item: unknown, i: number) => object(item) && item.category === CATEGORIES[i] && (item.best === null || validBest(item.best)))) invalid();
  if (!validMonths(data.monthly) || !validMonths(data.compare_monthly)) invalid();
  if (!Array.isArray(data.weekly) || data.weekly.length !== 26 || !data.weekly.every((item: unknown, i: number, all: any[]) => object(item) && isoDate(item.week_start) && count(item.active_days) && Number(item.active_days) <= 7 && (i === 0 || item.week_start > all[i - 1].week_start))) invalid();
  if (!Array.isArray(data.weekday) || data.weekday.length !== 7 || !data.weekday.every((item: unknown, i: number) => object(item) && item.weekday === i && count(item.activity_count))) invalid();
  const c = data.comparison;
  if (!object(c) || !validTotals(c.current, data.year) || !validTotals(c.previous, data.compare_year) || !object(c.delta)
    || !Number.isSafeInteger(c.delta.activity_count) || !Number.isSafeInteger(c.delta.activity_days) || !signed(c.delta.distance_m) || !signed(c.delta.avg_pace_seconds_per_km, true)) invalid();
  return data as Records;
}

export async function readRecords(year?: number, compareYear?: number, fetcher: typeof fetch = fetch): Promise<Records> {
  const query = new URLSearchParams();
  if (year !== undefined) query.set('year', String(year));
  if (compareYear !== undefined) query.set('compare_year', String(compareYear));
  const suffix = query.toString();
  return parseRecords(await request(`/api/v1/showcase/statistics/records${suffix ? `?${suffix}` : ''}`, {}, fetcher), year, compareYear);
}

export function signedDistance(value: Metric): string {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${dashboardDistance(Math.abs(n))}`;
}

/** Negative seconds per km is faster. */
export function paceDelta(value: Metric): string {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return '—';
  const seconds = Math.round(Math.abs(n));
  return seconds === 0 ? '持平' : `${n < 0 ? '快' : '慢'} ${formatDuration(seconds)} /km`;
}
```

- [ ] **Step 4: 路径映射与页面描述**

`frontend/src/lib/api/view-context.ts`：把
`/^\/(dashboard|activities|footprints|routes|ai|settings)(\/|\?|#|$)/`
改为
`/^\/(dashboard|activities|footprints|records|routes|ai|settings)(\/|\?|#|$)/`。

`frontend/src/lib/seo.ts`：在 `descriptions` 中 `/\/footprints$/` 一行之后插入：
`  [/\/records$/, '查看 5K、10K 最佳成绩、月度里程、配速进步和训练频率，并与往年同期对比。'],`

- [ ] **Step 5: 运行测试**

Run（`frontend/`）：`pnpm exec vitest run tests/unit/records.test.ts tests/unit/view-context.test.ts tests/unit/seo.test.ts`
Expected: 全部 PASS。若 `signedDistance('-1500.5')` 的期望值因 `dashboardDistance` 的取整不同而失败，以 `dashboardDistance` 实际输出为准修正**测试期望**（实现不变）。
再跑 `pnpm test` — Expected: 既有单元测试不受影响。

- [ ] **Step 6: Checkpoint（不提交）**

`git status --short frontend/src/lib frontend/tests/unit`。

---

### Task 4: 图表组件、纪录卡与 `/records` 页面

**Files:**
- Create: `frontend/src/lib/components/records-chart.ts`
- Create: `frontend/src/lib/components/records-chart-runtime.ts`
- Create: `frontend/src/lib/components/RecordsChart.svelte`
- Create: `frontend/src/lib/components/PersonalBests.svelte`
- Create: `frontend/src/routes/records/+page.svelte`、`frontend/src/routes/workspace/records/+page.svelte`、`frontend/src/routes/p/[username]/records/+page.svelte`
- Modify: `frontend/src/lib/components/AppNavigation.svelte`
- Test: `frontend/tests/unit/records-chart.test.ts`

**Interfaces:**
- Consumes（Task 3）：`readRecords`、`Records`、`CATEGORY_NAMES`、`CATEGORY_RANGES`、`signedDistance`、`paceDelta`、`CategoryBest`。
- Produces：`ChartSpec`/`ChartSeries`/`ChartColors`/`buildChartOption`；`RecordsChart` props `{ spec: ChartSpec; label: string; columns: string[]; rows: string[][]; testid: string }`，容器 `data-testid={testid}` + `data-ready`，数据表 `data-testid={`${testid}-table`}`；`PersonalBests` props `{ bests: CategoryBest[] }`，卡片 `data-testid="pb-5km"` / `"pb-10km"`；页面 testid：`records-ready`、`records-empty`、`records-error`、`records-compare-distance`、`records-compare-count`、`records-compare-pace`、`records-year-message`。

- [ ] **Step 1: 写失败的 Vitest（纯函数）**

创建 `frontend/tests/unit/records-chart.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildChartOption, type ChartColors, type ChartSpec } from '../../src/lib/components/records-chart';

const colors: ChartColors = { foreground: '#111', muted: '#666', border: '#ddd', surface: '#fff', primary: '#27815c', secondary: '#4bb6df' };
const one: ChartSpec = { labels: ['1 月', '2 月'], series: [{ name: '2024 年', type: 'bar', color: 'primary', data: [3, null] }], yName: '里程（km）', format: v => `${v} km`, zeroBased: true };

describe('records chart option', () => {
  it('keeps missing values as gaps instead of zero', () => {
    const option: any = buildChartOption(one, colors, false);
    expect(option.series[0].data).toEqual([3, null]);
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.animation).toBe(false);
  });
  it('shows a legend only for several series and anchors count axes at zero', () => {
    expect((buildChartOption(one, colors, true) as any).legend.show).toBe(false);
    expect((buildChartOption(one, colors, true) as any).yAxis.min).toBe(0);
    const two: ChartSpec = { ...one, zeroBased: false, series: [...one.series, { name: '2023 年', type: 'line', color: 'secondary', data: [1, 2] }] };
    const option: any = buildChartOption(two, colors, true);
    expect(option.legend.show).not.toBe(false);
    expect(option.yAxis.min).toBeUndefined();
    expect(option.yAxis.scale).toBe(true);
    expect(option.series[1].itemStyle.color).toBe('#4bb6df');
  });
  it('formats tooltip values and renders gaps as a dash', () => {
    const option: any = buildChartOption(one, colors, true);
    expect(option.tooltip.valueFormatter(3)).toBe('3 km');
    expect(option.tooltip.valueFormatter(null)).toBe('—');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run（`frontend/`）：`pnpm exec vitest run tests/unit/records-chart.test.ts` — Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现图表纯函数与运行时**

创建 `frontend/src/lib/components/records-chart.ts`：

```ts
export interface ChartSeries { name: string; type: 'bar' | 'line'; data: (number | null)[]; color: 'primary' | 'secondary' }
export interface ChartSpec { labels: string[]; series: ChartSeries[]; yName: string; format: (value: number) => string; zeroBased: boolean }
export interface ChartColors { foreground: string; muted: string; border: string; surface: string; primary: string; secondary: string }

export function buildChartOption(spec: ChartSpec, colors: ChartColors, animate: boolean) {
  const several = spec.series.length > 1;
  return {
    animation: animate, animationDuration: 400, animationDurationUpdate: 400,
    textStyle: { color: colors.foreground },
    legend: several ? { top: 0, textStyle: { color: colors.muted } } : { show: false },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      valueFormatter: (value: number | null | undefined) => value === null || value === undefined ? '—' : spec.format(value)
    },
    grid: { left: 56, right: 20, top: several ? 48 : 40, bottom: 36 },
    xAxis: { type: 'category', data: spec.labels, axisLine: { lineStyle: { color: colors.border } }, axisTick: { lineStyle: { color: colors.border } }, axisLabel: { color: colors.muted, fontSize: 11 } },
    yAxis: {
      type: 'value', name: spec.yName, ...(spec.zeroBased ? { min: 0 } : { scale: true }),
      nameTextStyle: { color: colors.muted, align: 'left' }, axisLabel: { color: colors.muted, formatter: (value: number) => spec.format(value) }, splitLine: { lineStyle: { color: colors.border } }
    },
    series: spec.series.map(item => ({
      name: item.name, type: item.type, connectNulls: false, data: item.data, symbol: 'circle',
      itemStyle: { color: colors[item.color] }, lineStyle: { color: colors[item.color] }
    }))
  };
}
```

创建 `frontend/src/lib/components/records-chart-runtime.ts`：

```ts
import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
export { init };
```

- [ ] **Step 4: 通用图表组件**

创建 `frontend/src/lib/components/RecordsChart.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { buildChartOption, type ChartSpec } from './records-chart';
  let { spec, label, columns, rows, testid }: { spec: ChartSpec; label: string; columns: string[]; rows: string[][]; testid: string } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (name: string) => style.getPropertyValue(name).trim();
    chart.setOption(buildChartOption(spec, {
      foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'), surface: color('--surface'),
      primary: color('--chart-series'), secondary: color('--sport-blue')
    }, !window.matchMedia('(prefers-reduced-motion: reduce)').matches), { notMerge: true });
  }
  $effect(() => { spec; if (mounted) draw(); });
  onMount(() => {
    let disposed = false; let observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => {
      try {
        const ec = await import('./records-chart-runtime'); if (disposed) return;
        chart = ec.init(container); mounted = true; draw();
        observer = new ResizeObserver(() => chart?.resize()); observer.observe(container);
      } catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; }
    })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>
{#if message}<p role="status" class="text-sm text-muted-foreground">{message}</p>{/if}
<div bind:this={container} class="h-72 w-full" role="img" aria-label={`${label}，下方提供完整数据表`} data-testid={testid} data-ready={mounted ? 'true' : 'false'}></div>
<details class="mt-3" data-testid={`${testid}-table`}>
  <summary class="cursor-pointer text-sm text-primary">查看{label}数据表</summary>
  <div class="mt-3 max-h-80 overflow-auto">
    <table class="w-full text-left text-sm">
      <thead><tr>{#each columns as column}<th>{column}</th>{/each}</tr></thead>
      <tbody>{#each rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody>
    </table>
    {#if rows.some(row => row.includes('—'))}<p class="sr-only">表中“—”表示该项缺失或无法可靠计算。</p>{/if}
  </div>
</details>
```

- [ ] **Step 5: 纪录卡组件**

创建 `frontend/src/lib/components/PersonalBests.svelte`：

```svelte
<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  import { formatDate, formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { CATEGORY_NAMES, CATEGORY_RANGES, type CategoryBest } from '#lib/api/records.ts';
  let { bests }: { bests: CategoryBest[] } = $props();
  const view = useViewContext();
</script>
<div class="personal-bests" role="region" aria-label="5K 与 10K 最佳成绩">
  {#each bests as item (item.category)}
    {@const name = CATEGORY_NAMES[item.category]}
    <article class="pb-card" data-testid={`pb-${item.category}`}>
      <p class="pb-eyebrow">{name} 最佳</p>
      {#if item.best}
        <p class="pb-pace">{formatPace(item.best.avg_pace_seconds_per_km)}</p>
        <dl class="pb-facts">
          <div><dt>用时</dt><dd>{formatDuration(item.best.duration_seconds)}</dd></div>
          <div><dt>距离</dt><dd>{formatDistance(item.best.distance_m)}</dd></div>
          <div><dt>日期</dt><dd>{formatDate(item.best.activity_date)}</dd></div>
        </dl>
        <p class="pb-note">共 {item.best.qualifying_count} 次 {name} 级跑步，按配速排名；不含轨迹途中分段。</p>
        <a class="button-secondary" href={view.href(`/activities/${item.best.activity_id}`)}>查看这次跑步</a>
      {:else}
        <p class="pb-empty">还没有符合条件的 {name} 记录</p>
        <p class="pb-note">需要距离在 {CATEGORY_RANGES[item.category]} 且有可靠用时的整次跑步。</p>
      {/if}
    </article>
  {/each}
</div>
<style>
  .personal-bests { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--dashboard-card-gap); }
  .pb-card { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .pb-eyebrow { color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .pb-pace { color: var(--primary); font-size: 2rem; font-weight: var(--weight-semibold); line-height: 1.1; }
  .pb-facts { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  .pb-facts dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .pb-facts dd { font-weight: var(--weight-semibold); }
  .pb-note { color: var(--muted-foreground); font-size: var(--text-small); }
  .pb-empty { font-weight: var(--weight-semibold); }
  @media (max-width: 640px) { .personal-bests { grid-template-columns: minmax(0, 1fr); } }
</style>
```

（若 `--space-3`、`--space-4`、`--text-small`、`--weight-semibold` 之一在 `src/app.css` 不存在，改用 `grep -n "^\s*--space-\|--text-" frontend/src/app.css` 找到的最接近的现有令牌，不要硬编码数值。）

- [ ] **Step 6: `/records` 页面**

创建 `frontend/src/routes/records/+page.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import PersonalBests from '#lib/components/PersonalBests.svelte';
  import RecordsChart from '#lib/components/RecordsChart.svelte';
  import type { ChartSpec } from '#lib/components/records-chart.ts';
  import { ActivityError, formatDistance, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { readRecords as scoped_readRecords, paceDelta, signedDistance, type Records } from '#lib/api/records.ts';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 2);

  let data = $state<Records | null>(null), loading = $state(true), message = $state('');
  let yearInput = $state(''), compareInput = $state(''), inputMessage = $state('');
  let disposed = false, token = 0;

  async function load(year?: number, compareYear?: number) {
    const mine = ++token; loading = true; message = ''; data = null;
    try {
      const result = await readRecords(year, compareYear);
      if (disposed || mine !== token) return;
      data = result; yearInput = String(result.year); compareInput = String(result.compare_year);
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; data = null; window.location.replace('/admin?reason=expired&next=%2Frecords'); return; }
      message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  function apply() {
    const year = Number(yearInput), compare = Number(compareInput);
    if (!/^\d{4}$/.test(yearInput) || !/^\d{4}$/.test(compareInput) || year < 1900 || year > 2100 || compare < 1900 || compare > 2100) { inputMessage = '请输入 1900–2100 年'; return; }
    if (year === compare) { inputMessage = '对比年份不能与年份相同'; return; }
    inputMessage = ''; void load(year, compare);
  }
  onMount(() => { void load(); return () => { disposed = true; }; });

  const km = (value: number) => `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} km`;
  const metres = (value: string | number | null) => value === null ? null : Number(value) / 1000;
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1} 月`);
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const empty = $derived(!!data && data.personal_bests.every(item => !item.best) && data.monthly.every(m => m.activity_count === 0) && data.compare_monthly.every(m => m.activity_count === 0) && data.weekly.every(w => w.active_days === 0));

  const monthlySpec = $derived<ChartSpec | null>(data && { labels: months, series: [{ name: `${data.year} 年`, type: 'bar', color: 'primary', data: data.monthly.map(m => metres(m.distance_m)) }], yName: '里程（km）', format: km, zeroBased: true });
  const paceSpec = $derived<ChartSpec | null>(data && { labels: months, series: [{ name: `${data.year} 年`, type: 'line', color: 'primary', data: data.monthly.map(m => m.avg_pace_seconds_per_km === null ? null : Number(m.avg_pace_seconds_per_km)) }], yName: '配速（越低越快）', format: value => formatPace(value), zeroBased: false });
  const weeklySpec = $derived<ChartSpec | null>(data && { labels: data.weekly.map(w => w.week_start.slice(5)), series: [{ name: '每周训练天数', type: 'bar', color: 'primary', data: data.weekly.map(w => w.active_days) }], yName: '训练天数', format: value => `${value} 天`, zeroBased: true });
  const weekdaySpec = $derived<ChartSpec | null>(data && { labels: weekdays, series: [{ name: `${data.year} 年`, type: 'bar', color: 'primary', data: data.weekday.map(d => d.activity_count) }], yName: '活动次数', format: value => `${value} 次`, zeroBased: true });
  const compareSpec = $derived<ChartSpec | null>(data && { labels: months, series: [
    { name: `${data.year} 年`, type: 'line', color: 'primary', data: data.monthly.map(m => metres(m.distance_m)) },
    { name: `${data.compare_year} 年`, type: 'line', color: 'secondary', data: data.compare_monthly.map(m => metres(m.distance_m)) }
  ], yName: '月里程（km）', format: km, zeroBased: true });

  const monthRows = $derived(data ? data.monthly.map((m, i) => [months[i], String(m.activity_count), formatDistance(m.distance_m), formatPace(m.avg_pace_seconds_per_km)]) : []);
  const paceRows = $derived(data ? data.monthly.map((m, i) => [months[i], formatPace(m.avg_pace_seconds_per_km), String(m.activity_count)]) : []);
  const weekRows = $derived(data ? data.weekly.map(w => [w.week_start, `${w.active_days} 天`]) : []);
  const weekdayRows = $derived(data ? data.weekday.map(d => [weekdays[d.weekday], `${d.activity_count} 次`]) : []);
  const compareRows = $derived(data ? data.monthly.map((m, i) => [months[i], formatDistance(m.distance_m), formatDistance(data!.compare_monthly[i].distance_m)]) : []);
</script>
<svelte:head><title>{pageTitle('跑步纪录', page.data.site)}</title></svelte:head>
<PageHeader title="跑步纪录" description="5K / 10K 最佳成绩、月度里程、配速进步、训练频率与同期对比。" />
<div class="records-page">
  <form class="year-form" onsubmit={event => { event.preventDefault(); apply(); }} aria-label="选择对比年份">
    <label>年份 <input type="number" min="1900" max="2100" inputmode="numeric" bind:value={yearInput} aria-describedby="records-year-message" /></label>
    <label>对比年份 <input type="number" min="1900" max="2100" inputmode="numeric" bind:value={compareInput} aria-describedby="records-year-message" /></label>
    <button class="button-secondary" type="submit" disabled={loading}>查看</button>
    <p id="records-year-message" class="year-message" role="status" data-testid="records-year-message">{inputMessage}</p>
  </form>
  {#if loading}<PageSkeleton />{/if}
  {#if message}<div data-testid="records-error"><FeedbackState kind="error" title={message}><button class="button-secondary" onclick={() => { void load(Number(yearInput) || undefined, Number(compareInput) || undefined); }}>重新读取</button></FeedbackState></div>{/if}
  {#if data && empty}
    <div data-testid="records-empty"><FeedbackState title="记录一次跑步，让纪录开始积累"><a href={view.href('/activities')} class="button-primary">查看跑步记录</a></FeedbackState></div>
  {:else if data && monthlySpec && paceSpec && weeklySpec && weekdaySpec && compareSpec}
    <div class="records-sections" data-testid="records-ready">
      <section aria-labelledby="bests-title"><h2 id="bests-title">最佳成绩</h2><PersonalBests bests={data.personal_bests} /></section>
      <section class="records-card" aria-labelledby="monthly-title"><h2 id="monthly-title">{data.year} 年月度里程</h2>
        <RecordsChart spec={monthlySpec} label="月度里程" columns={['月份', '次数', '里程', '可靠配速']} rows={monthRows} testid="records-chart-monthly" /></section>
      <section class="records-card" aria-labelledby="pace-title"><h2 id="pace-title">配速进步趋势</h2>
        <p class="hint">每月所有可靠跑步的平均配速，不区分距离；缺少可靠用时的月份留空。</p>
        <RecordsChart spec={paceSpec} label="月度配速" columns={['月份', '可靠配速', '活动次数']} rows={paceRows} testid="records-chart-pace" /></section>
      <section class="records-card" aria-labelledby="frequency-title"><h2 id="frequency-title">训练频率</h2>
        <h3>最近 26 周每周训练天数</h3>
        <RecordsChart spec={weeklySpec} label="每周训练天数" columns={['周起始（周一）', '训练天数']} rows={weekRows} testid="records-chart-weekly" />
        <h3>{data.year} 年周内分布</h3>
        <RecordsChart spec={weekdaySpec} label="周内分布" columns={['星期', '活动次数']} rows={weekdayRows} testid="records-chart-weekday" /></section>
      <section class="records-card" aria-labelledby="compare-title"><h2 id="compare-title">{data.year} 年 vs {data.compare_year} 年同期</h2>
        <p class="hint">统计截至 {data.cutoff_date}（对比年为 {data.compare_cutoff_date}）。</p>
        <dl class="compare-metrics">
          <div><dt>累计里程</dt><dd data-testid="records-compare-distance">{dashboardDistance(data.comparison.current.distance_m)}<small>{data.compare_year} 年 {dashboardDistance(data.comparison.previous.distance_m)} · {signedDistance(data.comparison.delta.distance_m)}</small></dd></div>
          <div><dt>活动次数</dt><dd data-testid="records-compare-count">{data.comparison.current.activity_count} 次<small>{data.compare_year} 年 {data.comparison.previous.activity_count} 次 · {data.comparison.delta.activity_count > 0 ? '+' : data.comparison.delta.activity_count < 0 ? '−' : ''}{Math.abs(data.comparison.delta.activity_count)} 次</small></dd></div>
          <div><dt>平均配速</dt><dd data-testid="records-compare-pace">{formatPace(data.comparison.current.avg_pace_seconds_per_km)}<small>{data.compare_year} 年 {formatPace(data.comparison.previous.avg_pace_seconds_per_km)} · {paceDelta(data.comparison.delta.avg_pace_seconds_per_km)}</small>{#if data.comparison.current.avg_pace_seconds_per_km === null}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}</dd></div>
        </dl>
        <RecordsChart spec={compareSpec} label="月里程对比" columns={['月份', `${data.year} 年`, `${data.compare_year} 年`]} rows={compareRows} testid="records-chart-compare" /></section>
    </div>
  {/if}
</div>
<style>
  .records-page, .records-sections { display: grid; gap: var(--dashboard-card-gap); min-width: 0; }
  .records-card { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .records-card h3 { margin-top: var(--space-4); color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .hint { color: var(--muted-foreground); font-size: var(--text-small); }
  .year-form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
  .year-form input { width: 7rem; }
  .year-message { flex-basis: 100%; min-height: 1.25rem; color: var(--destructive, var(--muted-foreground)); font-size: var(--text-small); }
  .compare-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); margin: var(--space-4) 0; }
  .compare-metrics dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .compare-metrics dd { font-weight: var(--weight-semibold); }
  .compare-metrics small { display: block; color: var(--muted-foreground); font-weight: normal; }
  @media (max-width: 640px) { .compare-metrics { grid-template-columns: minmax(0, 1fr); } }
</style>
```

（`FeedbackState` 的 `kind` 取值与 `PageSkeleton` 的 props 以现有用法为准：dashboard 用 `kind="error"` / `kind="loading"`；若 `PageSkeleton` 需要必填 prop，照 dashboard 用法传入。`--destructive` 若不存在，改用 `app.css` 现有的错误色令牌。）

创建两份包装入口：

`frontend/src/routes/workspace/records/+page.svelte`
```svelte
<script lang="ts">
  import Content from "../../records/+page.svelte";
</script>
<Content />
```

`frontend/src/routes/p/[username]/records/+page.svelte`
```svelte
<script lang="ts">
  import Content from "../../../records/+page.svelte";
</script>
<Content />
```

- [ ] **Step 7: 导航入口**

`frontend/src/lib/components/AppNavigation.svelte`：用 Edit 把
`    { href: '/activities', label: '跑步记录',`
替换为
`    { href: '/records', label: '跑步纪录', path: 'M5 20V10 M12 20V4 M19 20v-7 M3 20h18' },\n    { href: '/activities', label: '跑步记录',`
（`old_string` 只包含这一段前缀，确保唯一；`active()` 的通用前缀判断已覆盖 `/records`、`/p/x/records`、`/workspace/records`，无需改。）

- [ ] **Step 8: 运行检查**

Run（`frontend/`）：
`pnpm exec vitest run tests/unit/records-chart.test.ts` — Expected: PASS。
`pnpm check` — Expected: 0 errors。有错误则按提示修（常见：`PageSkeleton`/`FeedbackState` props、`$derived<ChartSpec | null>` 的类型收窄），不要用 `any` 绕过。

- [ ] **Step 9: Checkpoint（不提交）**

`git status --short frontend`，确认只新增了本任务文件并修改了 `AppNavigation.svelte`（其余用户既有改动保持原样）。

---

### Task 5: dashboard 摘要卡、合成 API 与 UI 测试

**Files:**
- Create: `frontend/src/lib/components/RecordsSummaryCard.svelte`
- Modify: `frontend/src/routes/dashboard/+page.svelte`（仅追加两处）
- Modify: `frontend/tests/fixtures/ui-api.mjs`
- Modify: `frontend/playwright.ui.config.ts`
- Create: `frontend/tests/ui/records.spec.ts`

**Interfaces:**
- Consumes（Task 3/4）：`readRecords`、`signedDistance`、`Records`、`CATEGORY_NAMES`；页面 testid。
- Produces：`RecordsSummaryCard`（无 props），`data-testid="records-card"`，子项 `records-card-5km`、`records-card-10km`、`records-card-month`、`records-card-delta`。

- [ ] **Step 1: 摘要卡组件**

创建 `frontend/src/lib/components/RecordsSummaryCard.svelte`：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import { currentYear } from '#lib/api/statistics.ts';
  import { ActivityError, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { CATEGORY_NAMES, readRecords as scoped_readRecords, signedDistance, type Records } from '#lib/api/records.ts';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 2);
  let data = $state<Records | null>(null), loading = $state(true), message = $state('');
  let disposed = false, token = 0;
  const month = $derived(data ? Number(data.cutoff_date.slice(5, 7)) : 0);

  async function load() {
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readRecords(currentYear(page.data.showcase?.timezone ?? 'UTC'));
      if (!disposed && mine === token) data = result;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; data = null; window.location.replace('/admin?reason=expired&next=%2Fdashboard'); return; }
      data = null; message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; }; });
</script>
<section class="records-card" aria-labelledby="records-card-title" aria-busy={loading} data-testid="records-card">
  <div class="records-card-head">
    <div><p class="eyebrow">个人纪录</p><h2 id="records-card-title">最佳成绩与同期对比</h2></div>
    <a class="button-secondary" href={view.href('/records')}>查看全部</a>
  </div>
  {#if message}
    <p role="status">{message} <button class="button-secondary" onclick={() => { void load(); }}>重试</button></p>
  {:else if data}
    <dl class="records-card-metrics">
      {#each data.personal_bests as item (item.category)}
        <div><dt>{CATEGORY_NAMES[item.category]} 最佳</dt><dd data-testid={`records-card-${item.category}`}>{item.best ? formatPace(item.best.avg_pace_seconds_per_km) : '—'}{#if !item.best}<span class="sr-only">（暂无符合条件的记录）</span>{/if}</dd></div>
      {/each}
      <div><dt>{month} 月里程</dt><dd data-testid="records-card-month">{dashboardDistance(data.monthly[month - 1]?.distance_m ?? null)}</dd></div>
      <div><dt>较 {data.compare_year} 年同期</dt><dd data-testid="records-card-delta">{signedDistance(data.comparison.delta.distance_m)}</dd></div>
    </dl>
  {/if}
</section>
<style>
  .records-card { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .records-card-head { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: var(--space-3); }
  .eyebrow { color: var(--muted-foreground); font-size: var(--text-small); }
  .records-card-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); margin-top: var(--space-4); }
  .records-card-metrics dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .records-card-metrics dd { font-weight: var(--weight-semibold); }
  @media (max-width: 640px) { .records-card-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
```

- [ ] **Step 2: 向 dashboard 追加（不动其它内容）**

先 `git diff -- frontend/src/routes/dashboard/+page.svelte` 记录现状（用户未提交改动保持原样）。用 Edit 做两处精确替换：

1. `old_string`：`  import ActivityExplorer from '#lib/components/ActivityExplorer.svelte';`
   `new_string`：同一行 + 换行 + `  import RecordsSummaryCard from '#lib/components/RecordsSummaryCard.svelte';`
2. `old_string`：`  <details class="statistics-notes">`
   `new_string`：`  <RecordsSummaryCard />\n  <details class="statistics-notes">`

再次 `git diff` 确认本任务相对 Step 开头只多出这两处新增。

- [ ] **Step 3: 合成 API**

`frontend/tests/fixtures/ui-api.mjs`：在 `createServer(` 之前加入（紧跟 `siteFields` 常量之后）：

```js
/** @param {number} year @param {number} compare */
function recordsFixture(year, compare) {
  const empty = year === 1999;
  const months = (/** @type {boolean} */ filled) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, activity_count: filled && i < 6 ? 2 : 0, distance_m: filled && i < 6 ? String(10000 * (i + 1)) : '0', avg_pace_seconds_per_km: filled && i < 6 ? String(330 - i * 5) : null }));
  const totals = (/** @type {number} */ y, /** @type {boolean} */ filled) => ({ year: y, activity_count: filled ? 12 : 0, distance_m: filled ? '210000' : '0', activity_days: filled ? 10 : 0, avg_pace_seconds_per_km: filled ? '320.000' : null });
  const base = Date.UTC(2026, 4, 4);
  return {
    year, compare_year: compare, cutoff_date: `${year}-12-31`, compare_cutoff_date: `${compare}-12-31`, date_assignment: 'activity_local_date',
    personal_bests: [
      { category: '5km', best: empty ? null : { activity_id: '11111111-1111-4111-8111-111111111111', activity_date: '2026-03-05', distance_m: '5000.000', duration_seconds: '1650.000', avg_pace_seconds_per_km: '330.000', qualifying_count: 4 } },
      { category: '10km', best: null }
    ],
    monthly: months(!empty), compare_monthly: months(false),
    weekly: Array.from({ length: 26 }, (_, i) => ({ week_start: new Date(base + i * 7 * 86400000).toISOString().slice(0, 10), active_days: empty ? 0 : i % 4 })),
    weekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i, activity_count: empty ? 0 : i })),
    comparison: { current: totals(year, !empty), previous: totals(compare, false), delta: { activity_count: empty ? 0 : 12, distance_m: empty ? '0' : '210000', activity_days: empty ? 0 : 10, avg_pace_seconds_per_km: null } }
  };
}
```

在 `/statistics/trends` 分支之后（`const missingActivity` 之前）加入：

```js
  if (url.pathname.endsWith('/statistics/records')) {
    const year = Number(url.searchParams.get('year') ?? 2026), compare = Number(url.searchParams.get('compare_year') ?? year - 1);
    return send(recordsFixture(year, compare));
  }
```

`frontend/playwright.ui.config.ts`：在 `testMatch` 数组末尾（`'seo-routes.spec.ts'` 之后）加入 `'records.spec.ts'`。

- [ ] **Step 4: 写 UI 测试**

创建 `frontend/tests/ui/records.spec.ts`：

```ts
import { expect, test } from '@playwright/test';

test('records page shows bests, charts and data-table fallbacks', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByRole('heading', { name: '跑步纪录', level: 1 })).toBeVisible();
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByTestId('pb-5km')).toContainText('5:30 /km');
  await expect(page.getByTestId('pb-5km')).toContainText('共 4 次');
  await expect(page.getByTestId('pb-10km')).toContainText('还没有符合条件的 10K 记录');
  for (const id of ['monthly', 'pace', 'weekly', 'weekday', 'compare']) await expect(page.getByTestId(`records-chart-${id}`)).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('records-chart-monthly-table').locator('tbody tr')).toHaveCount(12);
  await expect(page.getByTestId('records-chart-weekly-table').locator('tbody tr')).toHaveCount(26);
  await expect(page.getByTestId('records-compare-distance')).toContainText('+210 km');
  await expect(page.getByTestId('records-compare-pace')).toContainText('—');
});

test('changing years asks the server and validates the inputs', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await page.getByLabel('年份', { exact: true }).fill('2024');
  await page.getByLabel('对比年份').fill('2024');
  await page.getByRole('button', { name: '查看' }).click();
  await expect(page.getByTestId('records-year-message')).toHaveText('对比年份不能与年份相同');
  const request = page.waitForRequest(r => r.url().includes('year=2024') && r.url().includes('compare_year=2023'));
  await page.getByLabel('对比年份').fill('2023');
  await page.getByRole('button', { name: '查看' }).click();
  await request;
  await expect(page.getByTestId('records-ready')).toContainText('2024 年 vs 2023 年同期');
});

test('a year without any run shows the empty state', async ({ page }) => {
  await page.goto('/records');
  await page.getByLabel('年份', { exact: true }).fill('1999');
  await page.getByLabel('对比年份').fill('1998');
  await page.getByRole('button', { name: '查看' }).click();
  await expect(page.getByTestId('records-empty')).toBeVisible();
});

test('an expired session leaves the page for the login screen', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', route => route.fulfill({ status: 401, json: { data: null, error: { message: '会话已过期' } } }));
  await page.goto('/records');
  await expect(page).toHaveURL(/\/admin\?reason=expired/);
});

test('dashboard summary card links to the records page', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('records-card');
  await expect(card.getByTestId('records-card-5km')).toContainText('5:30 /km');
  await expect(card.getByTestId('records-card-10km')).toContainText('—');
  await expect(card.getByTestId('records-card-delta')).toContainText('+');
  await card.getByRole('link', { name: '查看全部' }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByTestId('records-ready')).toBeVisible();
});

test('navigation lists the records entry and the mobile layout does not overflow', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '跑步纪录' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('records-ready')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 5: 运行 UI 测试与检查**

Run（`frontend/`）：
`pnpm check` — Expected: 0 errors。
`pnpm exec playwright test --config playwright.ui.config.ts tests/ui/records.spec.ts tests/ui/dashboard.spec.ts tests/ui/ui-shell.spec.ts --reporter=list` — Expected: 全部 PASS。
若 `dashboard.spec.ts` / `ui-shell.spec.ts` 因摘要卡或导航新增条目而失败（例如统计导航项数量、dashboard 布局断言），先判断是否由本改动引起，只修**与新增条目直接冲突的断言**，并在报告中列出改了哪些断言；`ui-shell.spec.ts` 有用户未提交改动，Edit 前先 `git diff` 并只做最小改动。
再跑完整 `pnpm exec playwright test --config playwright.ui.config.ts --reporter=list`，如实记录通过/失败/跳过数量（已知偶发不稳定项需单独说明，不要声称无关失败是本改动引起或无关，除非已验证）。

- [ ] **Step 6: 浏览器视觉核对**

用合成 API 启动 UI 配置的 dev server（`playwright.ui.config.ts` 自带 webServer；或用 `playwright` skill 截图）打开 `/records` 与 `/`，分别在浅色、深色（`page.emulateMedia({ colorScheme: 'dark' })` 或手动切换主题）和 390px 宽度截图，检查：图表文字对比度、图例不遮挡、卡片无溢出、键盘焦点可见。截图只放在 scratchpad，不进仓库。记录“已视觉核对 / 未核对”。

- [ ] **Step 7: Checkpoint（不提交）**

`git status --short` — 本任务文件加上用户既有改动；`git diff -- frontend/src/routes/dashboard/+page.svelte` 中本任务只增加两处。

---

### Task 6: 文档、全量验证与交付说明

**Files:**
- Create: `docs/NN-personal-records.md`（`NN` 现场确认）
- Modify（如需要）: `docs/superpowers/specs/2026-10-26-personal-records-design.md`

- [ ] **Step 1: 确认文档编号**

Run（仓库根目录）：`ls docs | grep -E '^[0-9]+' | sort -n | tail -3`。取最大编号 +1 作为 `NN`（计划写作时最大为 74，即 75；以现场结果为准）。

- [ ] **Step 2: 写特性文档**

创建 `docs/NN-personal-records.md`（中文），包含三节：
- **使用方式**：`/records`（及 `/workspace/records`、`/p/{username}/records`）各区块含义；年份/对比年份输入；dashboard 摘要卡；最佳成绩口径（整次活动、按配速、距离档 4.0–7.5 / 9.0–12.0 km、不含轨迹途中分段）；同期对比的截止日规则（当前年到今天、过去年全年、2 月 29 日→28 日）。
- **接口与隐私**：`GET /api/v1/statistics/records`、`GET /api/v1/showcase/statistics/records`、具名版本；查询参数；响应字段；只含汇总数字与活动 ID；不接受 owner 参数；无数据库变更。
- **验证记录**：只写本次**实际运行**的命令和结果（Step 3 的输出），未运行的项目单列“未运行”及原因。

- [ ] **Step 3: 全量验证**

后端（`backend/`）：
- `.venv/bin/pytest tests/unit -q`
- 集成（若有测试库，仅进程环境注入）：`pytest tests/integration/test_records.py tests/integration/test_statistics.py tests/integration/test_showcase.py -q`
- `.venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests`
- `.venv/bin/alembic heads`（只读，确认没有新增 head）

前端（`frontend/`）：
- `pnpm test`
- `pnpm check`
- `pnpm build`（既有大体积 chunk 警告属已知状态）
- `pnpm exec playwright test --config playwright.ui.config.ts --reporter=list`

CI 路径过滤：本改动只涉及 backend 与 frontend，不触及迁移、`scripts/`、依赖清单、`infra/`，所以不需要改 `infra/native/tests/test_ci_changes.py`。

- [ ] **Step 4: 规格回写**

打开 spec，确认其中 `personal_bests` 为列表、`comparison` 用 `current/previous`、含 `compare_cutoff_date`、最佳成绩说明为全部历史、摘要卡链接形态与“规格修订”一节一致；如有出入，直接改 spec。

- [ ] **Step 5: 交付报告**

按 AGENTS.md 第 12 节输出：改动范围（后端/前端/文档/测试分开列）、实际运行命令与真实结果、未运行项（如无测试库则集成测试、真实后端 e2e、开发服务未重启所以新接口未在运行实例上验证）、剩余风险、未受影响部分（无迁移、旧接口与响应结构不变、dashboard 既有内容未改）。**不提交、不推送**，等用户授权；如用户授权提交，按文件显式 `git add`，排除密钥与临时截图，提交信息末尾带系统给定的 Co-Authored-By 行。

---

## Self-Review

- **规格覆盖**：5K/10K 最佳（Task 1/2，`personal_best`+`BEST_BANDS`）；月度里程与配速趋势（`month_points`/`trends`，页面两张图）；训练频率（`weekly_active_days`/`weekday_counts`，两张图）；同期年度对比（`year_totals`/`comparison_delta`/`shift_to_year`，对比区与叠加曲线）；三套入口（Task 4 页面 + `contextPath`）；导航（Task 4 Step 7）；dashboard 摘要卡仅追加（Task 5）；合成 API（Task 5 Step 3）；owner 隔离与参数拒绝（Task 2 测试）；`<details>` 数据表、`—` 与 `sr-only`、`watchSystemTheme`、动态 import（Task 4）；文档与验证（Task 6）；不在范围内项未实现。
- **占位符扫描**：无 TBD/TODO；唯一“视现状确认”的是 `--space-*` 等令牌名与 `FeedbackState`/`PageSkeleton` props，已写明如何核对并给出替代规则。
- **类型一致性**：后端 `Records` 字段 ↔ 前端 `Records`/`parseRecords`（`personal_bests` 列表、`comparison.current/previous/delta`、`compare_cutoff_date`、`weekly` 26、`weekday` 7、`monthly`/`compare_monthly` 12）；`readRecords(year?, compareYear?, fetcher)` 与 `view.bind(…, 2)` 的 fetcher 下标一致；`RecordsChart` 的 `testid` 与 UI 测试的 `records-chart-*`、`*-table` 一致；`CATEGORY_NAMES` 在 `PersonalBests` 与摘要卡中同源。
