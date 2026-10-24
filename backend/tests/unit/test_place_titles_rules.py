from datetime import date

import pytest

from app.modules.place_titles import rules


def test_default_title_matches_the_importers():
    assert rules.default_title(date(2025, 3, 9)) == "跑步 · 2025-03-09"


def test_title_words_cover_every_category():
    assert rules.TITLE_WORDS == {
        "sea": "海边跑步",
        "lake": "湖边跑步",
        "river": "河边跑步",
        "park": "公园跑步",
        "stadium": "操场跑步",
    }
    assert set(rules.CATEGORIES) == set(rules.TITLE_WORDS)
    assert rules.title_for("lake") == "湖边跑步"


def test_the_largest_share_wins_when_it_reaches_the_threshold():
    assert rules.choose_category(10, {"lake": 6, "river": 3}) == ("lake", 0.6)


def test_a_share_below_the_threshold_names_nothing():
    assert rules.choose_category(10, {"lake": 3}) is None
    assert rules.choose_category(10, {"lake": 4}) == ("lake", 0.4)  # boundary is inclusive


def test_ties_follow_the_fixed_priority():
    assert rules.choose_category(10, {"park": 5, "sea": 5})[0] == "sea"
    assert rules.choose_category(10, {"stadium": 5, "river": 5})[0] == "river"
    assert rules.choose_category(10, {"river": 5, "lake": 5})[0] == "lake"


def test_empty_or_invalid_inputs_name_nothing():
    assert rules.choose_category(0, {"lake": 1}) is None
    assert rules.choose_category(10, {}) is None
    assert rules.choose_category(10, {"unknown": 9}) is None
    with pytest.raises(ValueError):
        rules.title_for("unknown")


def test_sampling_is_bounded():
    assert rules.MAX_SAMPLES == 500
