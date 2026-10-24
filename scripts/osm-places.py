#!/usr/bin/env python3
"""Import lakes, rivers, coast, parks and running tracks from a local OSM extract."""

import argparse
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.schema import get_expected_revision
from app.modules.place_titles.osm import RegionImportError, import_region

FILTERS = [
    "nwr/natural=water,coastline,bay",
    "nwr/waterway=river,canal",
    "nwr/leisure=park,nature_reserve,stadium,track",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path, help="OSM .osm.pbf extract downloaded beforehand")
    parser.add_argument("--region", required=True, help="Label for this extract, e.g. zhejiang")
    args = parser.parse_args()
    # Local checks first: nothing below may touch the database before they pass.
    if shutil.which("osmium") is None:
        raise SystemExit("未找到 osmium 命令行工具，请先安装 osmium-tool；未做任何更改")
    if not args.pbf.is_file():
        raise SystemExit("找不到指定的 OSM 文件；未做任何更改")
    if not sys.stdin.isatty():
        raise SystemExit("导入需要交互式终端；未做任何更改")
    settings = Settings()
    target = make_url(settings.database_url)
    # Never print the connection URL, password or credentials.
    label = f"{target.host}:{target.port or 5432}/{target.database}"
    engine = create_engine(settings.database_url, hide_parameters=True, pool_pre_ping=True)
    try:
        # Short session: check the revision, then release the connection before the long osmium
        # runs so no transaction is left idle for minutes.
        with Session(engine) as db:
            current = db.scalars(text("SELECT version_num FROM alembic_version")).all()
            db.rollback()
        engine.dispose()  # no pooled connection sits idle through the osmium runs
        if current != [get_expected_revision()]:
            raise SystemExit("数据库结构不是最新版本；未做任何更改")
        if (
            input(f"Replace region '{args.region}' at {label}? Type the database name: ")
            != target.database
        ):
            raise SystemExit("已取消；未做任何更改")
        skipped: Counter = Counter()
        with tempfile.TemporaryDirectory() as work:
            filtered, lines = Path(work) / "filtered.osm.pbf", Path(work) / "features.geojsons"
            try:
                subprocess.run(
                    ["osmium", "tags-filter", str(args.pbf), *FILTERS, "-o", str(filtered)],
                    check=True,
                )
                subprocess.run(
                    ["osmium", "export", str(filtered), "-f", "geojsonseq", "-o", str(lines)],
                    check=True,
                )
            except subprocess.CalledProcessError:
                raise SystemExit("osmium 执行失败；未做任何更改") from None
            # No database connection is open above. A fresh transaction replaces the region and
            # commits right after the file has been read.
            with Session(engine) as db, lines.open(encoding="utf-8") as handle:
                try:
                    written = import_region(db, args.region, handle, skipped)
                except RegionImportError as error:
                    db.rollback()
                    raise SystemExit(str(error)) from None
                db.commit()
        print(f"Region '{args.region}' replaced at {label}: {written}")
        if skipped:
            print(f"Skipped features by reason: {dict(skipped)}")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
