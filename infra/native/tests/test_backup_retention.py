"""Local and off-site retention of backup.sh, with stubbed PostgreSQL and restic tools.

The pre-deploy backup (ship-<release>) must have its own quota: however many deploys happen, the
nightly and pre-migration dumps are never pushed out. No database, network or secrets are used.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

OPS = Path(__file__).resolve().parents[1] / "ops"

STUBS = {
    "pg_dump": (
        '#!/bin/sh\nfor a in "$@"; do '
        'case "$a" in --file=*) echo dump > "${a#--file=}";; esac; done\n'
    ),
    "pg_restore": "#!/bin/sh\necho 'TABLE DATA public alembic_version'\n",
    "psql": "#!/bin/sh\nexit 0\n",
    "restic": '#!/bin/sh\necho "$*" >> "$RESTIC_LOG"\n',
}


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name, body in STUBS.items():
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.backups = self.tmp / "backups"
        self.backups.mkdir()
        self.restic_log = self.tmp / "restic.log"
        self.clock = 1_700_000_000

    def env(self, **extra):
        env = {
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "BACKUP_DIR": str(self.backups),
            "PGDATABASE": "rn_test",
            "RESTIC_LOG": str(self.restic_log),
            "RESTIC_REPOSITORY": "stub",
            "HOME": str(self.tmp),
        }
        env.update(extra)
        return env

    def seed(self, label, n):
        for i in range(n):
            f = self.backups / f"rn_test-202601{i:02d}T000000Z-{label}.dump"
            f.write_text("old")
            self.touch(f)

    def touch(self, f):
        self.clock += 60
        os.utime(f, (self.clock, self.clock))

    def backup(self, label, **extra):
        done = subprocess.run(
            [str(OPS / "backup.sh"), "--label", label],
            env=self.env(**extra),
            capture_output=True,
            text=True,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        newest = Path(done.stdout.strip().splitlines()[-1])
        self.touch(newest)
        return newest

    def names(self, glob):
        return sorted(p.name for p in self.backups.glob(glob))


class LocalRetention(Harness):
    def test_deploy_backups_never_push_out_nightlies(self):
        self.seed("nightly", 14)
        self.seed("pre-seed", 3)
        nightlies = self.names("*-nightly.dump")
        for i in range(25):
            self.backup(f"ship-REL{i}")
        self.assertEqual(self.names("*-nightly.dump"), nightlies)
        self.assertEqual(len(self.names("*-pre-*.dump")), 3)
        ships = self.names("*-ship-REL*.dump")
        self.assertEqual(len(ships), 10)
        self.assertTrue(any(n.endswith("-ship-REL24.dump") for n in ships))
        self.assertFalse(any(n.endswith("-ship-REL14.dump") for n in ships))

    def test_a_ship_backup_does_not_use_the_migration_quota_either(self):
        self.seed("pre-seed", 10)
        for i in range(12):
            self.backup(f"ship-REL{i}")
        self.assertEqual(len(self.names("*-pre-*.dump")), 10)

    def test_nightly_quota_is_unchanged(self):
        self.seed("nightly", 14)
        self.backup("nightly")
        self.assertEqual(len(self.names("*-nightly.dump")), 14)

    def test_the_ship_quota_is_configurable_and_removes_side_files(self):
        for i in range(4):
            self.backup(f"ship-REL{i}", KEEP_SHIP="2")
        self.assertEqual(len(self.names("*-ship-REL*.dump")), 2)
        self.assertEqual(len(self.names("*-ship-REL*.dump.sha256")), 2)
        self.assertEqual(len(self.names("*-ship-REL*.dump.list")), 2)


class OffsiteRetention(Harness):
    def commands(self):
        return self.restic_log.read_text().splitlines()

    def test_ship_snapshots_share_a_tag_and_are_trimmed_by_host_only(self):
        self.backup("ship-REL1", KEEP_SHIP="7")
        backup, forget = self.commands()
        self.assertIn("--tag ship-REL1 --tag ship --tag rn_test", backup)
        # restic's default grouping (host,paths) would keep every snapshot: paths always differ.
        self.assertEqual(forget, "forget --tag ship,rn_test --group-by host --keep-last 7 --prune")

    def test_nightly_snapshots_are_not_tagged_ship_and_keep_their_policy(self):
        self.backup("nightly")
        backup, forget = self.commands()
        self.assertNotIn("--tag ship", backup)
        self.assertIn("forget --tag nightly --keep-daily 7", forget)

    def test_migration_snapshots_are_not_forgotten_automatically(self):
        self.backup("pre-REL1")
        self.assertEqual(len(self.commands()), 1)


class ShipBackupScript(Harness):
    def setUp(self):
        super().setUp()
        self.ops = self.tmp / "ops"
        self.ops.mkdir()
        for name in ("ship-backup.sh", "lib.sh", "envfile.py", "instance.py"):
            shutil.copy(OPS / name, self.ops / name)
        fake = self.ops / "backup.sh"
        fake.write_text('#!/bin/sh\necho "$*|hc=${HEALTHCHECK_URL:-unset}" > "$OUT"\n')
        fake.chmod(0o755)
        self.out = self.tmp / "out"

    def run_script(self, *args):
        return subprocess.run(
            [str(self.ops / "ship-backup.sh"), *args],
            env=self.env(OUT=str(self.out), HEALTHCHECK_URL="https://hc.example.test/x"),
            capture_output=True,
            text=True,
        )

    def test_it_labels_the_backup_ship_with_a_drill_and_leaves_the_nightly_heartbeat_alone(self):
        done = self.run_script("20261026T120000Z-abc1234")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(
            self.out.read_text().strip(), "--label ship-20261026T120000Z-abc1234 --drill|hc=unset"
        )

    def test_it_refuses_a_missing_or_unsafe_release_id(self):
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertNotEqual(self.run_script("../x; rm").returncode, 0)
        self.assertFalse(self.out.exists())


RUNUSER_STUB = """#!/usr/bin/env python3
# Stand-in for `runuser -u postgres -- CMD`: the database account is a different user, so the
# command must be executable and every directory on its path must be searchable by "other".
import os
import stat
import sys

args = sys.argv[1:]
assert args[:3] == ["-u", "postgres", "--"], args
cmd = args[3:]
path = os.path.realpath(cmd[0])
mode = os.stat(path).st_mode
if not (mode & stat.S_IROTH and mode & stat.S_IXOTH):
    sys.exit(f"runuser: failed to execute {cmd[0]}: Permission denied")
# Only the test's own tree is judged, not the machine's private temp directories above it.
root = os.path.realpath(os.environ["STUB_ROOT"])
directory = os.path.dirname(path)
while directory.startswith(root):
    if not os.stat(directory).st_mode & stat.S_IXOTH:
        sys.exit(f"runuser: failed to execute {cmd[0]}: Permission denied")
    directory = os.path.dirname(directory)
os.execvp(cmd[0], cmd)
"""


class ShipBackupAsDatabaseAccount(Harness):
    """ship.py uploads the release under root's home (mode 700); the backup runs as postgres."""

    def setUp(self):
        super().setUp()
        self.tmp.chmod(0o755)  # mkdtemp makes it private; only the staging directory must be
        self.stage = self.tmp / "stage"
        self.stage.mkdir()
        self.ops = self.stage / "rel" / "ops"
        self.ops.mkdir(parents=True)
        self.stage.chmod(0o700)
        for name in ("ship-backup.sh", "lib.sh", "envfile.py", "instance.py"):
            shutil.copy(OPS / name, self.ops / name)
        fake = self.ops / "backup.sh"
        fake.write_text('#!/bin/sh\necho "$0|$*" > "$OUT"\n')
        fake.chmod(0o755)
        (self.bin / "id").write_text(
            '#!/bin/sh\n[ "$1" = "-u" ] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"\n'
        )
        (self.bin / "runuser").write_text(RUNUSER_STUB)
        for name in ("id", "runuser"):
            (self.bin / name).chmod(0o755)
        self.scratch = self.tmp / "scratch"
        self.scratch.mkdir()
        self.scratch.chmod(0o755)
        self.out = self.tmp / "out"

    def run_script(self):
        return subprocess.run(
            [str(self.ops / "ship-backup.sh"), "REL1"],
            env=self.env(
                OUT=str(self.out), RUNNOTE_TMPDIR=str(self.scratch), STUB_ROOT=str(self.tmp)
            ),
            capture_output=True,
            text=True,
        )

    def test_the_backup_runs_from_a_copy_the_database_account_can_reach(self):
        done = self.run_script()
        self.assertEqual(done.returncode, 0, done.stderr)
        ran_from, args = self.out.read_text().strip().split("|")
        self.assertTrue(ran_from.startswith(str(self.scratch)), ran_from)
        self.assertFalse(ran_from.startswith(str(self.stage)))
        self.assertEqual(args, "--label ship-REL1 --drill")

    def test_the_copy_is_removed_afterwards(self):
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_the_copy_is_removed_and_the_exit_status_kept_when_the_backup_fails(self):
        (self.ops / "backup.sh").write_text("#!/bin/sh\nexit 7\n")
        self.assertEqual(self.run_script().returncode, 7)
        self.assertEqual(list(self.scratch.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
