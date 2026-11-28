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
        self.assertEqual(str(ver.parse_semver("2.10.0")), "2.10.0")
        self.assertNotEqual(str(ver.parse_semver("2.10.0")), "2.1.0")
        self.assertFalse(ver.parse_semver("2.7.0").is_prerelease)
        for sample in (
            "2.6.1",
            "2.6.10",
            "2.10.0",
            "2.11.0",
            "2.99.0",
            "2.7.0-alpha.1",
            "2.7.0-beta.2",
            "2.10.0-rc.10",
            "2.99.0-rc.1",
            "0.1.0",
        ):
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
            "2.010.0",
            "2.6.010",
            "2.06.1",
            "2.1\u0660.0",
            "2.7.0-rc.1\u0661",
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
            "2.1.0",
            "2.6.0",
            "2.6.1-alpha.1",
            "2.6.1-alpha.2",
            "2.6.1-beta.1",
            "2.6.1-rc.1",
            "2.6.1-rc.2",
            "2.6.1",
            "2.6.2",
            "2.6.9",
            "2.6.10-alpha.1",
            "2.6.10-beta.1",
            "2.6.10-rc.1",
            "2.6.10",
            "2.7.0-alpha.1",
            "2.7.0-beta.1",
            "2.7.0-rc.1",
            "2.7.0",
            "2.7.1-alpha.1",
            "2.7.1",
            "2.9.9",
            "2.9.10",
            "2.10.0-alpha.1",
            "2.10.0-beta.1",
            "2.10.0-rc.1",
            "2.10.0",
            "2.11.0",
            "2.99.0-alpha.1",
            "2.99.0-rc.1",
            "2.99.0",
            "2.99.99",
            "3.0.0-alpha.1",
            "3.0.0",
            "209.99.99",
        ]
        parsed = [ver.parse_semver(v) for v in sequence]
        codes = [sv.android_version_code for sv in parsed]
        self.assertGreater(ver.android_version_code("2.6.0"), legacy_2_6_0_code)
        self.assertEqual(ver.android_version_code("2.6.1"), 20601999)
        self.assertEqual(ver.android_version_code("2.6.10"), 20610999)
        self.assertEqual(ver.android_version_code("2.7.0"), 20700999)
        self.assertEqual(ver.android_version_code("2.10.0"), 21000999)
        self.assertEqual(ver.android_version_code("2.99.0"), 29900999)
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
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.6.9"), "patch")), "2.6.10")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "patch")), "2.7.1")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "minor")), "2.8.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.9.0"), "minor")), "2.10.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.10.0"), "minor")), "2.11.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.98.0"), "minor")), "2.99.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "major")), "3.0.0")
        self.assertEqual(str(ver.compute_bump(ver.parse_semver("2.7.0"), "alpha")), "2.7.1-alpha.1")
        self.assertEqual(
            str(ver.compute_bump(ver.parse_semver("2.9.0"), "rc", "2.10.0")), "2.10.0-rc.1"
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
            ver.compute_bump(ver.parse_semver("2.99.0"), "minor")
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

    def test_sync_supports_prerelease_and_multidigit_minor_patch_without_normalizing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_fake_repo(root, "2.7.0")
            for target, expected_code in (
                ("2.6.10", 20610999),
                ("2.8.0-rc.1", 20800301),
                ("2.10.0", 21000999),
                ("2.99.0", 29900999),
            ):
                ver.sync_versions(ver.parse_semver(target), root)
                self.assertEqual((root / "VERSION").read_text(encoding="utf-8").strip(), target)
                self.assertEqual(ver.check_consistency(root), [])
                gradle = (root / "android/native/app/build.gradle").read_text(encoding="utf-8")
                self.assertIn(f'versionName "{target}"', gradle)
                self.assertIn(f"versionCode {expected_code}", gradle)


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
            # Non-ASCII digits in tag or changelog date refused
            changelog.write_text("## [2.7.0] - 2026-11-2\u0667\n- Bad date\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                ver.validate_release_tag("v2.7.0", repo=root, changelog=changelog)
            with self.assertRaises(ValueError):
                ver.parse_tag("v2.1\u0660.0")
            with self.assertRaises(ValueError):
                ver.parse_tag("v2.7.0-rc.1\u0661")

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


class CertPinVerificationTests(unittest.TestCase):
    SAMPLE_DIGEST = "328a9f7990ab55fa9563ae976736b97dc5c91d3591f91c93d9be4404691239ad"
    SAMPLE_COLON = (
        "32:8A:9F:79:90:AB:55:FA:95:63:AE:97:67:36:B9:7D:"
        "C5:C9:1D:35:91:F9:1C:93:D9:BE:44:04:69:12:39:AD"
    )
    SAMPLE_APKSIGNER = textwrap.dedent(
        f"""\
        Verifies
        Verified using v1 scheme (JAR signing): false
        Verified using v2 scheme (APK Signature Scheme v2): true
        Verified using v3 scheme (APK Signature Scheme v3): true
        Signer #1 certificate DN: CN=RunNote, O=RunNote, C=CN
        Signer #1 certificate SHA-256 digest: {SAMPLE_DIGEST}
        Signer #1 certificate SHA-1 digest: 0123456789abcdef0123456789abcdef01234567
        """
    )
    SAMPLE_V3_DIGEST = "8c3ea62a1b9843f177fb6d15dfbcb06ea419f87bc7d0ee32a9d08f20698f637c"
    SAMPLE_V3_COLON = (
        "8C:3E:A6:2A:1B:98:43:F1:77:FB:6D:15:DF:BC:B0:6E:"
        "A4:19:F8:7B:C7:D0:EE:32:A9:D0:8F:20:69:8F:63:7C"
    )
    SAMPLE_V3_PUBKEY_DIGEST = "e7bc21138ab5241cd48cfba4749366ff90e0d0946ffc5c215206bdd32cc933fa"
    SAMPLE_V3_APKSIGNER = textwrap.dedent(
        f"""\
        Verifies
        Verified using v1 scheme (JAR signing): false
        Verified using v2 scheme (APK Signature Scheme v2): false
        Verified using v3 scheme (APK Signature Scheme v3): true
        Verified using v3.1 scheme (APK Signature Scheme v3.1): false
        Verified using v3.2 scheme (APK Signature Scheme v3.2): false
        Verified using v4 scheme (APK Signature Scheme v4): false
        Verified for SourceStamp: false
        V3.0 Signer: certificate DN: CN=RunNote, OU=Android, O=RunNote, L=Unknown, ST=Unknown, C=CN
        V3.0 Signer: certificate SHA-256 digest: {SAMPLE_V3_DIGEST}
        V3.0 Signer: certificate SHA-1 digest: 9bd751ad8849d1f9f90fdb3ad6f057ebb7cf4398
        V3.0 Signer: certificate MD5 digest: 8a2c85bc31db06546d8d7f7b6e4a9862
        V3.0 Signer: key algorithm: RSA
        V3.0 Signer: key size (bits): 4096
        V3.0 Signer: public key SHA-256 digest: {SAMPLE_V3_PUBKEY_DIGEST}
        V3.0 Signer: public key SHA-1 digest: c157a443a246b126a69ee0dddf962ee78f3c1bfb
        V3.0 Signer: public key MD5 digest: c15d787c6d4bcf32a0491dbe6aa93bf0
        """
    )

    def test_verify_cert_pin_accepts_colon_and_hex_formats(self):
        self.assertEqual(
            ver.verify_cert_pin(self.SAMPLE_APKSIGNER, self.SAMPLE_DIGEST),
            self.SAMPLE_DIGEST,
        )
        self.assertEqual(
            ver.verify_cert_pin(self.SAMPLE_APKSIGNER, self.SAMPLE_COLON),
            self.SAMPLE_DIGEST,
        )

    def test_verify_cert_pin_accepts_v3_only_output_with_hex_and_colon_pins(self):
        self.assertEqual(
            ver.verify_cert_pin(self.SAMPLE_V3_APKSIGNER, self.SAMPLE_V3_DIGEST),
            self.SAMPLE_V3_DIGEST,
        )
        self.assertEqual(
            ver.verify_cert_pin(self.SAMPLE_V3_APKSIGNER, self.SAMPLE_V3_COLON),
            self.SAMPLE_V3_DIGEST,
        )
        v31_output = self.SAMPLE_V3_APKSIGNER.replace("V3.0 Signer:", "V3.1 Signer:")
        self.assertEqual(
            ver.verify_cert_pin(v31_output, self.SAMPLE_V3_COLON),
            self.SAMPLE_V3_DIGEST,
        )

    def test_verify_cert_pin_accepts_duplicate_v2_and_v3_lines_for_same_cert(self):
        dual_scheme_output = textwrap.dedent(
            f"""\
            Verifies
            Verified using v2 scheme (APK Signature Scheme v2): true
            Verified using v3 scheme (APK Signature Scheme v3): true
            Signer #1 certificate SHA-256 digest: {self.SAMPLE_V3_DIGEST}
            Signer #1 public key SHA-256 digest: {self.SAMPLE_V3_PUBKEY_DIGEST}
            V3.0 Signer: certificate SHA-256 digest: {self.SAMPLE_V3_COLON}
            V3.0 Signer: public key SHA-256 digest: {self.SAMPLE_V3_PUBKEY_DIGEST}
            """
        )
        self.assertEqual(
            ver.verify_cert_pin(dual_scheme_output, self.SAMPLE_V3_DIGEST),
            self.SAMPLE_V3_DIGEST,
        )
        self.assertEqual(
            ver.verify_cert_pin(dual_scheme_output, self.SAMPLE_V3_COLON),
            self.SAMPLE_V3_DIGEST,
        )

    def test_verify_cert_pin_rejects_multiple_distinct_cert_digests(self):
        v2_and_v3_distinct = textwrap.dedent(
            f"""\
            Verifies
            Signer #1 certificate SHA-256 digest: {self.SAMPLE_DIGEST}
            V3.0 Signer: certificate SHA-256 digest: {self.SAMPLE_V3_DIGEST}
            """
        )
        with self.assertRaises(ValueError) as ctx:
            ver.verify_cert_pin(v2_and_v3_distinct, self.SAMPLE_V3_DIGEST)
        self.assertIn("2 distinct digests", str(ctx.exception))

        two_v2_signers = textwrap.dedent(
            f"""\
            Verifies
            Signer #1 certificate SHA-256 digest: {self.SAMPLE_DIGEST}
            Signer #2 certificate SHA-256 digest: {self.SAMPLE_V3_DIGEST}
            """
        )
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(two_v2_signers, self.SAMPLE_DIGEST)

        two_v3_signers = textwrap.dedent(
            f"""\
            Verifies
            V3.0 Signer: certificate SHA-256 digest: {self.SAMPLE_DIGEST}
            V3.1 Signer: certificate SHA-256 digest: {self.SAMPLE_V3_DIGEST}
            """
        )
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(two_v3_signers, self.SAMPLE_V3_DIGEST)

    def test_verify_cert_pin_rejects_mismatch_malformed_and_missing(self):
        wrong = "0" * 64
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(self.SAMPLE_APKSIGNER, wrong)
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(self.SAMPLE_V3_APKSIGNER, wrong)
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(self.SAMPLE_APKSIGNER, "not-a-sha256")
        with self.assertRaises(ValueError) as missing_ctx:
            ver.verify_cert_pin("Verifies\nNo digest line\n", self.SAMPLE_DIGEST)
        self.assertIn("V3.x Signer:", str(missing_ctx.exception))
        self.assertIn("Signer #N", str(missing_ctx.exception))

        for bad_output in (
            "Verifies\nV3.0 Signer: certificate SHA-256 digest: not-a-sha256\n",
            "Verifies\nV3.0 Signer: certificate SHA-256 digest: deadbeef\n",
            "Verifies\nV3.0 Signer: certificate SHA-256 digest:   \n",
            (
                f"Signer #1 certificate SHA-256 digest: {self.SAMPLE_DIGEST}\n"
                "V3.0 Signer: certificate SHA-256 digest: malformed!\n"
            ),
        ):
            with self.assertRaises(ValueError, msg=f"should reject {bad_output!r}"):
                ver.verify_cert_pin(bad_output, self.SAMPLE_DIGEST)

    def test_verify_cert_pin_ignores_public_key_sha256_lines(self):
        pubkey_only = textwrap.dedent(
            f"""\
            Verifies
            Signer #1 public key SHA-256 digest: {self.SAMPLE_V3_PUBKEY_DIGEST}
            V3.0 Signer: public key SHA-256 digest: {self.SAMPLE_V3_PUBKEY_DIGEST}
            """
        )
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(pubkey_only, self.SAMPLE_V3_PUBKEY_DIGEST)
        with self.assertRaises(ValueError):
            ver.verify_cert_pin(self.SAMPLE_V3_APKSIGNER, self.SAMPLE_V3_PUBKEY_DIGEST)

    def test_cli_verify_cert_pin_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_file = Path(tmp) / "apksigner.txt"
            out_file.write_text(self.SAMPLE_APKSIGNER, encoding="utf-8")
            rc_ok = ver.main(
                [
                    "verify-cert-pin",
                    "--expected",
                    self.SAMPLE_COLON,
                    "--input-file",
                    str(out_file),
                ]
            )
            self.assertEqual(rc_ok, 0)
            rc_bad = ver.main(
                [
                    "verify-cert-pin",
                    "--expected",
                    "f" * 64,
                    "--input-file",
                    str(out_file),
                ]
            )
            self.assertEqual(rc_bad, 1)
            v3_file = Path(tmp) / "apksigner_v3.txt"
            v3_file.write_text(self.SAMPLE_V3_APKSIGNER, encoding="utf-8")
            rc_v3_ok = ver.main(
                [
                    "verify-cert-pin",
                    "--expected",
                    self.SAMPLE_V3_COLON,
                    "--input-file",
                    str(v3_file),
                ]
            )
            self.assertEqual(rc_v3_ok, 0)


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
            self.assertIn("refs/heads/main", jobs["android-release"]["if"])
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

        # Must prevent overwriting existing releases, restrict dispatch to main, verify cert pin,
        # and publish atomically via draft.
        self.assertIn("refs/heads/main", text)
        self.assertIn("ANDROID_SIGNING_CERT_SHA256", text)
        self.assertIn("verify-cert-pin", text)
        self.assertIn("gh release view", text)
        self.assertIn("--draft", text)
        self.assertIn("--draft=false", text)
        self.assertIn("apksigner", text)
        self.assertNotIn('apksigner" verify --verbose --print-certs "$raw_apk" | tee', text)
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
