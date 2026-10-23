from uuid import uuid4

from app.modules.route_groups import groups


def test_lock_key_is_stable_per_owner_and_distinct_between_owners():
    first, second = uuid4(), uuid4()
    assert groups.lock_key(first) == groups.lock_key(first)
    assert groups.lock_key(first) != groups.lock_key(second)
    assert -(2**63) <= groups.lock_key(first) < 2**63


def test_thresholds_match_the_design():
    assert (groups.MIN_DISTANCE_M, groups.DISTANCE_TOLERANCE) == (1000, 0.15)
    assert (groups.BUFFER_M, groups.MIN_COVERAGE) == (50, 0.8)
