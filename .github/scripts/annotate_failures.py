#!/usr/bin/env python3
"""Turn failures into GitHub annotations so they are readable without downloading logs.

  annotate_failures.py junit REPORT.xml      one ::error:: per failed/errored pytest case
  annotate_failures.py tail FILE [LINES]     the last LINES (default 40) of a captured log

Diagnostics only: it never changes a step's pass/fail result.
"""

import sys
import xml.etree.ElementTree as ET

LIMIT = 1500


def clean(text: str) -> str:
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"junit", "tail"}:
        print(__doc__)
        return 2
    if argv[1] == "junit":
        failed = 0
        for case in ET.parse(argv[2]).getroot().iter("testcase"):
            for kind in ("failure", "error"):
                node = case.find(kind)
                if node is not None:
                    failed += 1
                    name = f"{case.get('classname', '')}::{case.get('name', '')}"
                    body = (node.get("message") or "") + "\n" + (node.text or "")
                    print(f"::error title=pytest {kind}::{clean(name + chr(10) + body[-LIMIT:])}")
        print(f"{failed} failing pytest case(s)")
        return 0
    lines = open(argv[2], encoding="utf-8", errors="replace").read().splitlines()
    count = int(argv[3]) if len(argv) > 3 else 40
    print(f"::error title=log tail::{clean(chr(10).join(lines[-count:])[-LIMIT * 3 :])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
