"""Offline global atlas integrity and Taiwan attribution checks."""

from app.modules.footprints import global_atlas as module


def test_taiwan_is_unified_under_china_in_offline_atlases():
    atlas = module._atlas()
    regions = atlas["regions"]
    cities = atlas["cities_by_code"]

    country_codes = {r["country_code"] for r in regions}
    assert "CHN" in country_codes
    assert not country_codes & {"TWN", "HKG", "MAC", "PGA"}

    china_regions = [r for r in regions if r["country_code"] == "CHN"]
    assert len(china_regions) == 34
    taiwan = atlas["regions_by_code"]["CN-710000"]
    assert taiwan["name"] == "台湾省"
    assert taiwan["short_name"] == "台湾"
    assert taiwan["country_code"] == "CHN"
    assert taiwan["country_name"] == "中国"

    taipei = next(c for c in cities.values() if c["short_name"] == "台北")
    assert taipei["country_code"] == "CHN"
    assert taipei["region_code"] == "CN-710000"


def test_overseas_cities_link_to_their_region_and_country():
    atlas = module._atlas()
    tokyo = next(
        c for c in atlas["point_cities"] if c["name"] == "东京" and c["country_code"] == "JPN"
    )
    assert tokyo["region_code"] == "JP-13"

    sf = next(
        c for c in atlas["point_cities"] if c["name"] == "旧金山" and c["country_code"] == "USA"
    )
    assert sf["region_code"] == "US-CA"


def test_boxes_overlap_handles_normal_and_antimeridian_boxes():
    assert module._boxes_overlap([120.0, 24.0, 122.0, 26.0], [119.0, 21.0, 123.0, 26.0])
    assert not module._boxes_overlap([10.0, 40.0, 11.0, 41.0], [119.0, 21.0, 123.0, 26.0])
    assert module._boxes_overlap([-179.5, -18.0, 179.5, -16.0], [177.0, -19.0, 180.0, -15.0])
