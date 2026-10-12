import importlib.util
from pathlib import Path

import pytest
from defusedxml import ElementTree

path = Path(__file__).parents[1] / "fixtures/gpx/generate_limits.py"
spec = importlib.util.spec_from_file_location("generate_limits", path)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


@pytest.mark.parametrize(
    ("case_id", "tag", "count"),
    [
        ("point-limit-exact", "trkpt", 50000),
        ("point-limit-exceeded", "trkpt", 50001),
        ("segment-limit-exact", "trkseg", 1000),
        ("segment-limit-exceeded", "trkseg", 1001),
    ],
)
def test_generated_limit_input_contains_exact_source_count(case_id, tag, count):
    root = ElementTree.fromstring(generator.build_fixture(case_id))
    assert len(list(root.iter("{http://www.topografix.com/GPX/1/1}" + tag))) == count


@pytest.mark.parametrize(
    ("case_id", "size"),
    [("byte-limit-exact", 10485760), ("byte-limit-exceeded", 10485761)],
)
def test_generated_byte_boundary_is_valid_xml_with_exact_size(case_id, size):
    data = generator.build_fixture(case_id)
    assert len(data) == size
    assert ElementTree.fromstring(data).tag == "{http://www.topografix.com/GPX/1/1}gpx"
