from collections import Counter
from datetime import date
from uuid import uuid4

import pytest

from app.core.errors import ApiError
from app.modules.footprints.exploration import (
    GridHistory,
    YearGrid,
    cells,
    detail,
    markers,
    parse_optional_year,
)


class StubReads:
    def __init__(self, payloads):
        self.payloads = payloads

    def read(self, owner, version, kind, build):
        key = kind if isinstance(kind, str) else kind[0] if len(kind) == 1 else kind
        return self.payloads.get(kind, self.payloads.get(key, ("ready", None)))


def test_parse_optional_year():
    assert parse_optional_year(None) is None
    assert parse_optional_year("all") is None
    assert parse_optional_year("2025") == 2025
    assert parse_optional_year("1900") == 1900
    assert parse_optional_year("2100") == 2100
    for bad in ("", "1899", "2101", "abc", "2025a"):
        with pytest.raises(ApiError) as exc:
            parse_optional_year(bad)
        assert exc.value.status_code == 422


def test_markers_builds_boundary_and_nearby_with_year_flags():
    owner = uuid4()
    all_catalog = {
        "items": [
            {
                "code": "310000",
                "name": "上海市",
                "region_name": "上海市",
                "kind": "boundary",
                "first_date": date(2024, 5, 1),
                "last_date": date(2026, 2, 1),
                "activity_count": 10,
                "distance_m": 50000.0,
            },
            {
                "code": "GN-1850147",
                "name": "东京",
                "region_name": "东京都",
                "kind": "nearby",
                "first_date": date(2026, 1, 10),
                "last_date": date(2026, 1, 10),
                "activity_count": 1,
                "distance_m": None,
            },
        ],
        "regions": [{"code": "CN-310000", "name": "上海市"}],
        "activity_count": 11,
        "boundary_count": 1,
        "nearby_count": 1,
    }
    reads = StubReads({"catalog": ("ready", all_catalog)})

    cumulative = markers(reads, owner, 3, None)
    assert cumulative["status"] == "ready"
    assert cumulative["year"] is None
    assert len(cumulative["items"]) == 2
    sh, tokyo = cumulative["items"]
    assert sh["country_code"] == "CHN"
    assert sh["region_code"] == "CN-310000"
    assert sh["bounds"] is not None
    assert sh["is_new_in_year"] is False
    assert tokyo["kind"] == "nearby"
    assert tokyo["bounds"] is None
    assert tokyo["distance_m"] is None

    # Year parameter keeps all visited cities/regions as context and only flags new ones.
    for_2026 = markers(reads, owner, 3, 2026)
    assert len(for_2026["items"]) == 2
    assert len(for_2026["regions"]) == 1
    sh_26, tokyo_26 = for_2026["items"]
    assert sh_26["first_date"] == date(2024, 5, 1)
    assert sh_26["activity_count"] == 10
    assert sh_26["is_new_in_year"] is False
    assert tokyo_26["is_new_in_year"] is True

    # A year with zero activities/new cells still returns all historical markers as muted context.
    for_2020 = markers(reads, owner, 3, 2020)
    assert len(for_2020["items"]) == 2
    assert all(not item["is_new_in_year"] for item in for_2020["items"])
    assert for_2020["regions"] == all_catalog["regions"]

    pending = markers(StubReads({"catalog": ("pending", None)}), owner, 3, None)
    assert pending["status"] == "pending"
    assert pending["items"] == []


def test_all_years_detail_and_cells_aggregate_across_years():
    owner = uuid4()
    y24 = YearGrid()
    y24.add(100, 200, 2, True)
    y25 = YearGrid()
    y25.add(100, 200, 3, False)
    y25.add(101, 200, 1, True)
    all_grid = YearGrid()
    all_grid.add(100, 200, 5, True)
    all_grid.add(101, 200, 1, True)
    history = GridHistory(
        first_year=2024,
        months=Counter({(2024, 3): 1, (2025, 6): 1}),
        years={2024: y24, 2025: y25},
        all_grid=all_grid,
        size=3,
    )
    reads = StubReads({("global", "all"): ("ready", history)})

    all_detail = detail(reads, owner, 1, "global", "all", 2026, date(2026, 2, 1), all_years=True)
    assert all_detail["cumulative_cells"] == 2
    assert all_detail["new_cells"] == 2
    assert all_detail["months"][2]["new_cells"] == 1
    assert all_detail["months"][5]["new_cells"] == 1

    all_cells = cells(reads, owner, 1, "global", "all", 2026, None, 12, "heatmap", all_years=True)
    assert sorted(all_cells["cells"]) == [(100, 200, 5), (101, 200, 1)]

    y25_cells = cells(reads, owner, 1, "global", "all", 2025, None, 12, "new", all_years=False)
    assert y25_cells["cells"] == [(101, 200, 1)]
