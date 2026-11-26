"""Offline unit tests for android/scripts/audit-apk-permissions.py."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "android" / "scripts" / "audit-apk-permissions.py"
spec = importlib.util.spec_from_file_location("audit_apk_permissions", SCRIPT)
audit_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_mod)


class ApkPermissionAuditTests(unittest.TestCase):
    def test_parses_standard_and_sdk_scoped_permissions(self):
        sample = (
            "package: com.tingchieh.runnote\n"
            "uses-permission: name='android.permission.INTERNET'\n"
            "uses-permission-sdk-23: name='android.permission.ACCESS_BACKGROUND_LOCATION'\n"
            "uses-permission-sdk-33: name='android.permission.POST_NOTIFICATIONS'\n"
        )
        self.assertEqual(
            audit_mod.parse_permissions(sample),
            {
                "android.permission.INTERNET",
                "android.permission.ACCESS_BACKGROUND_LOCATION",
                "android.permission.POST_NOTIFICATIONS",
            },
        )

    def _run_audit_with_output(self, stdout: str) -> int:
        with tempfile.NamedTemporaryFile(suffix=".apk") as fake_apk:
            fake_done = mock.Mock(stdout=stdout)
            with (
                mock.patch.object(audit_mod, "find_aapt2", return_value="/usr/bin/aapt2"),
                mock.patch.object(audit_mod.subprocess, "run", return_value=fake_done),
            ):
                return audit_mod.audit(Path(fake_apk.name))

    def test_fails_closed_on_empty_output(self):
        self.assertEqual(self._run_audit_with_output("package: com.tingchieh.runnote\n"), 1)

    def test_fails_closed_when_internet_missing(self):
        self.assertEqual(
            self._run_audit_with_output("uses-permission: name='android.permission.ACCESS_NETWORK_STATE'\n"),
            1,
        )

    def test_rejects_sdk_23_forbidden_permission(self):
        sample = (
            "uses-permission: name='android.permission.INTERNET'\n"
            "uses-permission-sdk-23: name='android.permission.ACCESS_BACKGROUND_LOCATION'\n"
        )
        self.assertEqual(self._run_audit_with_output(sample), 1)

    def test_accepts_minimal_allowlisted_permissions(self):
        sample = (
            "uses-permission: name='android.permission.INTERNET'\n"
            "uses-permission: name='android.permission.ACCESS_NETWORK_STATE'\n"
            "uses-permission-sdk-23: name='android.permission.POST_NOTIFICATIONS'\n"
        )
        self.assertEqual(self._run_audit_with_output(sample), 0)


if __name__ == "__main__":
    unittest.main()
