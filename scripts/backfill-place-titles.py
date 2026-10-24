#!/usr/bin/env python3
"""Name existing runs after nearby places: preview by default, write only with --apply."""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.db.schema import get_expected_revision
from app.modules.place_titles import backfill, service


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def confirm(label, database, question):
    answer = input(f"{question}，目标 {label}。请输入数据库名确认：")
    if answer != database:
        raise SystemExit("已取消；未做任何更改")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the new titles")
    parser.add_argument("--revert", type=Path, metavar="LOG", help="restore titles from a log")
    parser.add_argument("--log-dir", type=Path, default=Path.cwd(), help="where the log goes")
    parser.add_argument("--limit", type=positive, default=None, help="at most this many runs")
    args = parser.parse_args()
    # Local checks first: nothing below may touch the database before they pass.
    if args.apply and args.revert:
        raise SystemExit("--apply 与 --revert 不能同时使用；未做任何更改")
    if (args.apply or args.revert) and not sys.stdin.isatty():
        raise SystemExit("写入或还原需要交互式终端；未做任何更改")
    if args.revert:
        try:
            entries = backfill.load_log(args.revert)
        except backfill.BackfillLogError as error:
            raise SystemExit(f"{error}；未做任何更改") from None
    if args.apply and not args.log_dir.is_dir():
        raise SystemExit("日志目录不存在；未做任何更改")
    settings = Settings()
    target = make_url(settings.database_url)
    # Never print the connection URL, password or credentials.
    label = f"{target.host}:{target.port or 5432}/{target.database}"
    engine = create_engine(settings.database_url, hide_parameters=True, pool_pre_ping=True)
    factory = sessionmaker(engine, class_=Session, expire_on_commit=False)
    try:
        # Short sessions: each is closed before any prompt, so no transaction sits idle.
        with factory() as db:
            current = db.scalars(text("SELECT version_num FROM alembic_version")).all()
        if current != [get_expected_revision()]:
            raise SystemExit("数据库结构不是最新版本；未做任何更改")
        if args.revert:
            print(f"日志共 {len(entries)} 条（目标 {label}）")
            confirm(label, target.database, "按日志还原标题")
            print(backfill.revert_log(factory, args.revert))
            return
        with factory() as db:
            has_places = service.has_places(db)
        if not has_places:
            raise SystemExit("没有已导入的地物数据（先运行 scripts/osm-places.py）；未做任何更改")
        proposals = backfill.collect(factory, limit=args.limit)
        matched = [p for p in proposals if p.new_title]
        for proposal in matched:
            print(f"{proposal.activity_date} · {proposal.old_title} → {proposal.new_title}")
        print(
            f"候选 {len(proposals)} 条，命中 {len(matched)} 条，"
            f"未命中 {len(proposals) - len(matched)} 条（目标 {label}）"
        )
        if not args.apply:
            print("仅预览，未写入数据库；确认后加 --apply，并请先备份数据库")
            return
        if not matched:
            print("没有可改名的记录；未做任何更改")
            return
        confirm(label, target.database, "写入上述标题（请确认已备份数据库）")
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        log_path = args.log_dir / f"place-titles-{stamp}.json"
        print(f"还原日志：{log_path}")
        print(backfill.apply_proposals(factory, proposals, log_path))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
