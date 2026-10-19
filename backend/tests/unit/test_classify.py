import pytest

from app.modules.activities.classify import classify_distance


@pytest.mark.parametrize(
    ("distance", "expected"),
    [
        (None, ""),
        (0, ""),
        (2499, ""),
        (2500, "3km"),
        (3999.9, "3km"),
        (4000, "5km"),
        (7500, "5km"),
        (8000, ""),
        (9000, "10km"),
        (10050, "10km"),
        (15000, ""),
        (21097.5, "半马"),
        (30000, ""),
        (42195, "全马"),
        (50000, ""),
    ],
)
def test_classify_distance(distance, expected):
    assert classify_distance(distance) == expected
