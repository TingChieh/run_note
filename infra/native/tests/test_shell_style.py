"""Style gate for the shell scripts, independent of the installed ShellCheck version.

CI runs an older ShellCheck than the one on a developer machine. It reports SC2015 ("A && B || C
is not if-then-else") for lines the newer one accepts, and the failure only shows up after a push.
This test rejects the pattern everywhere, so it fails locally first.

    backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import re
import unittest
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[1]
SCRIPTS = sorted([*(NATIVE / "ops").glob("*.sh"), *(NATIVE / "tests").glob("*.sh")])
CONDITION = re.compile(r"^\s*(if|elif|while|until)\b")


def strip_quoted(line: str) -> str:
    """Drop quoted strings and $(...) so only the control operators remain."""
    line = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
    line = re.sub(r"'[^']*'", "''", line)
    line = re.sub(r"\[\[.*?\]\]", "[[ ]]", line)  # `&&` inside [[ ]] is one test, not a chain
    while True:
        shorter = re.sub(r"\$\([^()]*\)", "$()", line)
        if shorter == line:
            return line
        line = shorter


class ShellStyle(unittest.TestCase):
    def test_scripts_are_found(self):
        self.assertGreaterEqual(len(SCRIPTS), 10)

    def test_no_and_then_or_chain_outside_conditions(self):
        offenders = []
        for path in SCRIPTS:
            for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                line = raw.split(" #", 1)[0] if not raw.lstrip().startswith("#") else ""
                if not line.strip() or CONDITION.match(line):
                    continue
                code = strip_quoted(line)
                if re.search(r"&&.*\|\|", code):
                    offenders.append(f"{path.relative_to(NATIVE.parents[1])}:{number}: {raw.strip()}")
        self.assertEqual(
            offenders,
            [],
            "write `if ...; then ...; fi` instead of `A && B || C` (SC2015 on CI's ShellCheck)",
        )


if __name__ == "__main__":
    unittest.main()
