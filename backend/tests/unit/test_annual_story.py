"""Unit tests for pure annual story helpers (no database required)."""

from app.modules.statistics.annual_story import (
    downsample_line,
    extract_lines,
    pick_route_name,
    sample_timeline_indices,
)


def test_downsample_line_preserves_endpoints_and_bounds_vertex_count():
    coords = [(float(i) * 0.001, float(i) * 0.001) for i in range(120)]
    thinned = downsample_line(coords, limit=48)
    assert len(thinned) == 48
    assert thinned[0] == coords[0]
    assert thinned[-1] == coords[-1]
    assert downsample_line(coords[:10], limit=48) == coords[:10]


def test_extract_lines_handles_linestring_multilinestring_and_invalid_inputs():
    single = extract_lines({"type": "LineString", "coordinates": [[120.1, 30.2], [120.2, 30.3]]})
    assert single == [[(120.1, 30.2), (120.2, 30.3)]]

    multi = extract_lines(
        {
            "type": "MultiLineString",
            "coordinates": [
                [[120.0, 30.0], [120.05, 30.05]],
                [[121.0, 31.0]],  # < 2 points dropped
                [[200.0, 30.0], [120.0, 95.0]],  # out-of-range coordinates dropped
            ],
        }
    )
    assert multi == [[(120.0, 30.0), (120.05, 30.05)]]
    assert extract_lines(None) == []
    assert extract_lines({"type": "Point", "coordinates": [120.0, 30.0]}) == []


def test_sample_timeline_indices_preserves_milestones_and_enforces_cap():
    indices, truncated = sample_timeline_indices(120, {0, 15, 99}, limit=366)
    assert not truncated
    assert indices == list(range(120))

    milestones = {5, 111, 287, 420}
    sampled, truncated = sample_timeline_indices(500, milestones, limit=366)
    assert truncated
    assert len(sampled) == 366
    assert sampled == sorted(sampled)
    assert 0 in sampled and 499 in sampled
    assert milestones.issubset(set(sampled))


def test_pick_route_name_prefers_most_common_then_most_recent():
    assert pick_route_name([]) == "常跑路线"
    assert pick_route_name(["  ", ""]) == "常跑路线"
    assert pick_route_name(["松风湖 6K", "湖畔晨跑", "松风湖 6K"]) == "松风湖 6K"
    # Ties prefer the latest title in chronological order.
    assert pick_route_name(["旧标题", "新标题"]) == "新标题"
