"""Offline unit tests for RunNote's unified version source, CHANGELOG, and release workflow.

backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import importlib.util
import json
import re
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("runnote_version", REPO / "scripts" / "version.py")
assert spec is not None and spec.loader is not None
ver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ver
spec.loader.exec_module(ver)


def _make_fake_repo(root: Path, version: str = "2.7.0", min_mobile: str = "2.6.0") -> None:
    sv = ver.parse_semver(version)
    (root / "VERSION").write_text(f"{sv}\n", encoding="utf-8")

    (root / "backend" / "app" / "modules" / "mobile_auth").mkdir(parents=True)
    (root / "backend" / "pyproject.toml").write_text(
        f'[project]\nname = "run-note-backend"\nversion = "{sv}"\n',
        encoding="utf-8",
    )
    (root / "backend" / "app" / "modules" / "mobile_auth" / "service.py").write_text(
        f'MIN_MOBILE_APP_VERSION = "{min_mobile}"\n',
        encoding="utf-8",
    )

    (root / "frontend").mkdir(parents=True)
    (root / "frontend" / "package.json").write_text(
        json.dumps({"name": "run-note-frontend", "version": str(sv)}, indent=2) + "\n",
        encoding="utf-8",
    )

    (root / "android" / "native" / "app").mkdir(parents=True)
    (root / "android" / "package.json").write_text(
        json.dumps({"name": "runnote-android", "version": str(sv)}, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "android" / "native" / "app" / "build.gradle").write_text(
        textwrap.dedent(
            f"""\
            android {{
                defaultConfig {{
                    versionCode {sv.android_version_code}
                    versionName "{sv}"
                }}
            }}
            """
        ),
        encoding="utf-8",
    )


class SemVerAndVersionCodeTests(unittest.TestCase):
    def test_valid_semver_and_prereleases(self):
        self.assertEqual(str(ver.parse_semver("2.7.0")), "2.7.0")
        self.assertFalse(ver.parse_semver("2.7.0").is_prerelease)
        for sample in ("2.7.0-alpha.1", "2.7.0-beta.2", "2.7.0-rc.10", "0.1.0"):
            parsed = ver.parse_semver(sample)
            self.assertEqual(str(parsed), sample)
            self.assertEqual(parsed.is_prerelease, "-" in sample)

    def test_invalid_semver_rejected(self):
        for bad in (
            "",
            "2.7",
            "v2.7.0",
            "02.7.0",
            "2.07.0",
            "2.7.0-alpha.0",
            "2.7.0-alpha.01",
            "2.7.0-dev.1",
            "2.7.0-rc",
            "2.7.0+meta",
            "210.0.0",
            "2.100.0",
            "2.7.100",
            "2.7.0-rc.100",
        ):
            with self.assertRaises(ValueError, msg=f"should reject {bad!r}"):
                ver.parse_semver(bad)

    def test_android_version_code_is_strictly_monotonic_across_prereleases_and_finals(self):
        legacy_2_6_0_code = 20600
        sequence = [
            "2.6.0",
            "2.6.1-alpha.1",
            "2.6.1-alpha.2",
            "2.6.1-beta.1",
            "2.6.1-rc.1",
            "2.6.1-rc.2",
            "2.6.1",
            "2.7.0-alpha.1",
            "2.7.0-beta.1",
            "2.7.0-rc.1",
            "2.7.0",
            "2.7.1-alpha.1",
            "2.7.1",
            "3.0.0-alpha.1",
            "3.0.0",
            "209.99.99",
        ]
        parsed = [ver.parse_semver(v) for v in sequence]
        codes = [sv.android_version_code for sv in parsed]
        self.assertGreater(codes[0], legacy_2_6_0_code)
        self.assertLessEqual(codes[-1], 2_100_000_000)
        for prev_sv, curr_sv, prev_code, curr_code in zip(
            parsed, parsed[1:], codes, codes[1:], strict=False
        ):
            self.assertLess(prev_sv, curr_sv)
            self.assertLess(
                prev_code,
                curr_code,
                f"versionCode not monotonic: {prev_sv} ({prev_code}) -> {curr_sv} ({curr_code})",
            )

    def test_bump_transitions(self):
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "patch")), "2.7.1")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "minor")), "2.8.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "major")), "3.0.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "alpha")), "2.7.1-alpha.1")
        self.assertEqual(
            str(ver.compute_bump(ver.parse_semver("2.7.0"), "rc", "2.8.0")), "2.8.0-rc.1"
        )
        self.assertEqual(
            str(ver.compute_bump(ver.parse_semver("2.8.0-alpha.1"), "alpha")), "2.8.0-alpha.2"
        )
        self.assertEqual(
            str(ver.compute_bump(ver.parse_semver("2.8.0-alpha.2"), "beta")), "2.8.0-beta.1"
        )
        self.assertEqual(
            str(ver.compute_bump(ver.parse_semver("2.8.0-beta.1"), "rc")), "2.8.0-rc.1"
        )
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.8.0-rc.1"), "final")), "2.8.0")
        with self.assertRaises(ValueError):
            ver.compute_bump(ver.parse_semver("2.8.0-rc.1"), "beta")
        with self.assertRaises(ValueError):
            ver.compute_bump(ver.parse_semver("2.8.0"), "final")


class ConsistencyAndSyncTests(unittest.TestCase):
    def test_real_repo_has_zero_version_drift(self):
        self.assertEqual(ver.check_consistency(REPO), [])

    def test_drift_in_every_manifest_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_fake_repo(root, "2.7.0")
            self.assertEqual(ver.check_consistency(root), [])

            # Backend pyproject drift
            (root / "backend/pyproject.toml").write_text(
                '[project]\nname = "run-note-backend"\nversion = "2.6.0"\n', encoding="utf-8"
            )
            self.assertTrue(any("pyproject.toml" in e for e in ver.check_consistency(root)))
            ver.sync_versions(ver.parse_semver("2.7.0"), root)
            self.assertEqual(ver.check_consistency(root), [])

            # Frontend package.json drift
            (root / "frontend/package.json").write_text('{"version": "2.6.0"}\n', encoding="utf-8")
            self.assertTrue(any("frontend/package.json" in e for e in ver.check_consistency(root)))
            ver.sync_versions(ver.parse_semver("2.7.0"), root)

            # Android package.json drift
            (root / "android/package.json").write_text('{"version": "2.5.0"}\n', encoding="utf-8")
            self.assertTrue(any("android/package.json" in e for e in ver.check_consistency(root)))
            ver.sync_versions(ver.parse_semver("2.7.0"), root)

            # Android build.gradle versionCode drift
            gradle = root / "android/native/app/build.gradle"
            gradle.write_text(gradle.read_text(encoding="utf-8").replace("20700999", "20700"))
            self.assertTrue(any("versionCode" in e for e in ver.check_consistency(root)))
            ver.sync_versions(ver.parse_semver("2.7.0"), root)

            # MIN_MOBILE_APP_VERSION higher than VERSION
            (root / "backend/app/modules/mobile_auth/service.py").write_text(
                'MIN_MOBILE_APP_VERSION = "2.8.0"\n', encoding="utf-8"
            )
            self.assertTrue(any("MIN_MOBILE_APP_VERSION" in e for e in ver.check_consistency(root)))

    def test_sync_supports_prerelease_across_all_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_fake_repo(root, "2.7.0")
            rc = ver.parse_semver("2.8.0-rc.1")
            ver.sync_versions(rc, root)
            self.assertEqual(ver.check_consistency(root), [])
            gradle = (root / "android/native/app/build.gradle").read_text(encoding="utf-8")
            self.assertIn('versionName "2.8.0-rc.1"', gradle)
            self.assertIn("versionCode 20800301", gradle)


class TagAndChangelogValidationTests(unittest.TestCase):
    def test_validate_release_tag_succeeds_and_extracts_notes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_fake_repo(root, "2.7.0-rc.1")
            changelog = root / "CHANGELOG.md"
            changelog.write_text(
                textwrap.dedent(
                    """\
                    # Changelog

                    ## [Unreleased]

                    ### Added
                    - Future item

                    ## [2.7.0-rc.1] - 2026-11-27

                    ### Added
                    - Release candidate verification item.

                    ## [2.6.0] - 2026-11-26 (untagged baseline)
                    - Old baseline.
                    """
                ),
                encoding="utf-8",
            )
            notes_out = root / "notes.md"
            gh_out = root / "github_output.txt"
            rc = ver.main(
                [
                    "--repo",
                    str(root),
                    "validate-tag",
                    "v2.7.0-rc.1",
                    "--changelog",
                    str(changelog),
                    "--notes-out",
                    str(notes_out),
                    "--github-output",
                    str(gh_out),
                ]
            )
            self.assertEqual(rc, 0)
            self.assertIn(
                "Release candidate verification item.", notes_out.read_text(encoding="utf-8")
            )
            self.assertNotIn("Future item", notes_out.read_text(encoding="utf-8"))
            out_text = gh_out.read_text(encoding="utf-8")
            self.assertIn("version=2.7.0-rc.1\n", out_text)
            self.assertIn("version_code=20700301\n", out_text)
            self.assertIn("prerelease=true\n", out_text)
            self.assertIn("apk_name=runnote-android-v2.7.0-rc.1-vc20700301.apk\n", out_text)

    def test_validate_release_tag_rejects_mismatches_and_bad_changelog(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_fake_repo(root, "2.7.0")
            changelog = root / "CHANGELOG.md"
            changelog.write_text(
                "## [Unreleased]\n- Pending\n\n"
                "## [2.7.0] - 2026-11-27 (untagged baseline)\n- Bad\n",
                encoding="utf-8",
            )
            # Missing leading 'v'
            with self.assertRaises(ValueError):
                ver.validate_release_tag("2.7.0", repo=root, changelog=changelog)
            # Tag mismatch against VERSION
            with self.assertRaises(ValueError):
                ver.validate_release_tag("v2.7.1", repo=root, changelog=changelog)
            # Extra suffix on changelog heading is refused for formal tag
            with self.assertRaises(ValueError):
                ver.validate_release_tag("v2.7.0", repo=root, changelog=changelog)
            # Empty section refused
            changelog.write_text("## [2.7.0] - 2026-11-27\n\n### Added\n\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                ver.validate_release_tag("v2.7.0", repo=root, changelog=changelog)
            # Invalid calendar date refused
            changelog.write_text("## [2.7.0] - 2026-02-30\n- Bad date\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                ver.validate_release_tag("v2.7.0", repo=root, changelog=changelog)

    def test_real_changelog_structure_and_guardrails(self):
        text = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("## [Unreleased]", text)
        for section in (
            "### Added",
            "### Changed",
            "### Fixed",
            "### Breaking",
            "### Upgrade notes",
        ):
            self.assertIn(section, text)
        # 2.6.0 is an untagged baseline, so validate-tag must refuse it as a formal entry.
        with self.assertRaises(ValueError):
            ver.extract_changelog_entry(REPO / "CHANGELOG.md", "2.6.0")


class WorkflowAndIgnorePolicyTests(unittest.TestCase):
    def test_release_workflow_triggers_permissions_and_pinning(self):
        workflow_path = REPO / ".github" / "workflows" / "release.yml"
        text = workflow_path.read_text(encoding="utf-8")

        # Parse YAML when PyYAML is available in the environment.
        try:
            import yaml  # type: ignore[import-untyped]
        except ImportError:
            yaml = None
        if yaml is not None:
            parsed = yaml.safe_load(text)
            on_block = parsed.get("on") if "on" in parsed else parsed.get(True)
            self.assertIsInstance(on_block, dict)
            self.assertEqual(set(on_block.keys()), {"push", "workflow_dispatch"})
            self.assertEqual(on_block["push"], {"tags": ["v*"]})
            self.assertEqual(parsed["permissions"], {"contents": "read"})
            jobs = parsed["jobs"]
            self.assertEqual(jobs["publish-release"]["permissions"], {"contents": "write"})
            self.assertIn("refs/tags/v", jobs["publish-release"]["if"])
            self.assertIn("android-release", jobs["publish-release"]["needs"])

        # Every `uses:` action must be pinned to a full 40-char commit SHA.
        uses_lines = re.findall(r"^\s*-?\s*uses:\s*([^\s#]+)", text, re.MULTILINE)
        self.assertGreaterEqual(len(uses_lines), 10)
        for action in uses_lines:
            self.assertRegex(
                action,
                r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}$",
                f"workflow action is not pinned to a 40-char SHA: {action}",
            )

        # Must prevent overwriting existing releases and publish atomically via draft.
        self.assertIn("gh release view", text)
        self.assertIn("--draft", text)
        self.assertIn("--draft=false", text)
        self.assertIn("apksigner", text)
        self.assertIn("audit-apk-permissions.py", text)
        self.assertIn("sha256sum -c", text)

    def test_signing_artifacts_are_gitignored(self):
        root_ignore = (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()
        android_ignore = (REPO / "android" / ".gitignore").read_text(encoding="utf-8").splitlines()
        for pattern in (
            "*.jks",
            "*.keystore",
            "*.p12",
            "keystore.properties",
            "*.jks.b64",
            "*.apk",
        ):
            self.assertIn(pattern, root_ignore, f"{pattern} missing from root .gitignore")
            self.assertIn(pattern, android_ignore, f"{pattern} missing from android/.gitignore")


if __name__ == "__main__":
    unittest.main()
