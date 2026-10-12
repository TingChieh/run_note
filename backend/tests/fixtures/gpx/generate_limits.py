"""Build large synthetic test inputs without committing large files."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).parent
PREFIX = (
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" '
    'creator="RunNote synthetic limits">'
)
POINT = '<trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time></trkpt>'


def build_fixture(case_id: str) -> bytes:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    recipe = next(case["recipe"] for case in manifest["cases"] if case["id"] == case_id)
    count = recipe["count"]
    match recipe["kind"]:
        case "point-limit":
            content = PREFIX + "<trk><trkseg>" + POINT * count + "</trkseg></trk></gpx>"
        case "segment-limit":
            content = (
                PREFIX
                + "<trk><trkseg>"
                + POINT
                + "</trkseg>"
                + "<trkseg/>" * (count - 1)
                + "</trk></gpx>"
            )
        case "byte-limit":
            start = PREFIX + "<!--"
            end = "--><trk><trkseg>" + POINT + "</trkseg></trk></gpx>"
            content = start + "x" * (count - len(start) - len(end)) + end
        case "processing-budget":
            content = (
                PREFIX
                + "<extensions>"
                + "<layer>" * count
                + "x"
                + "</layer>" * count
                + "</extensions><trk><trkseg>"
                + POINT
                + "</trkseg></trk></gpx>"
            )
        case _:
            raise ValueError("Unknown synthetic fixture recipe")
    return content.encode("utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case_id")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.output.open("xb") as output:
        output.write(build_fixture(args.case_id))
