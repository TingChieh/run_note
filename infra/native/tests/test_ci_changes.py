"""Offline tests for .github/scripts/changed_areas.py: which CI jobs a change may skip.

backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import importlib.util
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "changed_areas", REPO / ".github" / "scripts" / "changed_areas.py"
)
changed_areas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changed_areas)

ALL = {"backend": True, "frontend": True, "infra": True}
NONE = {"backend": False, "frontend": False, "infra": False}


class Classify(unittest.TestCase):
    def test_documentation_only_runs_no_area(self):
        for files in (
            ["docs/66-production-deployment.md"],
            ["README.md", "README.en.md", "AGENTS.md", "LICENSE"],
            ["docs/assets/screenshot.png"],
        ):
            self.assertEqual(changed_areas.classify(files), NONE, files)

    def test_frontend_only_skips_backend_and_infra(self):
        self.assertEqual(
            changed_areas.classify(["frontend/src/routes/+layout.svelte", "docs/x.md"]),
            {"backend": False, "frontend": True, "infra": False},
        )

    def test_backend_only_skips_frontend_and_infra(self):
        self.assertEqual(
            changed_areas.classify(["backend/app/modules/ai_reports/provider.py"]),
            {"backend": True, "frontend": False, "infra": False},
        )

    def test_infra_only_skips_both_application_areas(self):
        self.assertEqual(
            changed_areas.classify(["infra/native/ops/backup.sh"]),
            {"backend": False, "frontend": False, "infra": True},
        )

    def test_migrations_scripts_and_manifests_also_run_the_release_rehearsal(self):
        for path in (
            "backend/migrations/versions/0017_x.py",
            "scripts/site-owner.py",
            "backend/requirements.lock",
            "frontend/package.json",
            "frontend/pnpm-lock.yaml",
        ):
            self.assertTrue(changed_areas.classify([path])["infra"], path)

    def test_mixed_changes_union_their_areas(self):
        self.assertEqual(
            changed_areas.classify(["frontend/src/app.css", "backend/app/core/config.py"]),
            {"backend": True, "frontend": True, "infra": False},
        )

    def test_the_ci_definition_itself_runs_everything(self):
        for path in (".github/workflows/ci.yml", ".github/scripts/changed_areas.py"):
            self.assertEqual(changed_areas.classify([path]), ALL, path)

    def test_unknown_paths_run_everything(self):
        for path in (".gitignore", "pyproject.toml", "backend.command", "Makefile"):
            self.assertEqual(changed_areas.classify([path, "docs/a.md"]), ALL, path)

    def test_no_file_list_runs_everything(self):
        self.assertEqual(changed_areas.classify([]), ALL)

    def test_a_readme_inside_a_code_directory_is_still_documentation(self):
        # README.md files anywhere are documentation, even under a code directory.
        self.assertEqual(changed_areas.classify(["backend/tests/fixtures/gpx/README.md"]), NONE)


class ChangedFiles(unittest.TestCase):
    def test_events_without_a_usable_diff_yield_nothing(self):
        self.assertEqual(changed_areas.changed_files("workflow_dispatch", "a", "b"), [])
        self.assertEqual(changed_areas.changed_files("push", "0" * 40, "b" * 40), [])
        self.assertEqual(changed_areas.changed_files("push", "a" * 40, ""), [])

    def test_unreachable_base_yields_nothing_so_everything_runs(self):
        self.assertEqual(changed_areas.changed_files("push", "1" * 40, "2" * 40), [])


if __name__ == "__main__":
    unittest.main()
