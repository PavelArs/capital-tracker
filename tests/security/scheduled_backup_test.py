"""Synthetic process checks for the scheduled encrypted backup (no real server or data)."""

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'scheduled-backup.sh'
SYNTHETIC_KEY = 'synthetic-backup-key-' + 'k' * 32
DAY = 24 * 3600


class ScheduledBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='capital-scheduled-backup-')
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.root = directory / 'root'
        self.backups = self.root / 'backups'
        self.backups.mkdir(parents=True)
        self.metrics = directory / 'textfile'
        self.key = self.root / '.backup-key'
        self.key.write_text(SYNTHETIC_KEY)
        self.key.chmod(0o400)
        self.bin = directory / 'bin'
        self.bin.mkdir()
        # Fake Docker: the container runs unless CONTAINER_ABSENT is set; pg_dump emits synthetic bytes.
        self.fake('docker', '''#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if os.environ.get('CONTAINER_ABSENT') == 'yes':
    print('Error: No such object: capital_tracker_db', file=sys.stderr)
    sys.exit(1)
if args[:2] == ['inspect', 'capital_tracker_db']:
    print('true')
elif args[:2] == ['exec', 'capital_tracker_db']:
    sys.stdout.buffer.write(b'PGDMP synthetic custom-format dump')
    if os.environ.get('PG_DUMP_FAIL') == 'yes':
        sys.exit(1)
else:
    sys.exit(2)
''')
        # Fake flock records its arguments; FLOCK_TIMEOUT=yes simulates a release holding the lock.
        self.calls = directory / 'calls'
        self.fake('flock', f'''#!/bin/sh
echo "flock $*" >>'{self.calls}'
[ "$FLOCK_TIMEOUT" = yes ] && exit 1
exit 0
''')
        # Fake mv records its arguments, then renames with the real mv.
        self.fake('mv', f'''#!/bin/sh
echo "mv $*" >>'{self.calls}'
exec '{shutil.which('mv')}' "$@"
''')

    def fake(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o700)

    def run_backup(self, **overrides):
        env = {
            **os.environ,
            'PATH': f'{self.bin}:{os.environ["PATH"]}',
            'RELEASE_ROOT': str(self.root),
            'BACKUP_METRICS_DIR': str(self.metrics),
            **overrides,
        }
        return subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env=env, timeout=60)

    def dump(self, name, age_days):
        path = self.backups / name
        path.write_bytes(b'synthetic')
        (self.backups / f'{name}.sha256').write_text('synthetic\n')
        stamp = time.time() - age_days * DAY
        os.utime(path, (stamp, stamp))
        return path

    def test_service_unit_points_at_the_managed_release_root(self):
        repository = SCRIPT.parents[1]
        bootstrap = (repository / 'scripts' / 'manual-mvp-server-bootstrap.sh').read_text()
        managed_root = next(
            line.split('=', 1)[1] for line in bootstrap.splitlines() if line.startswith('root=')
        )
        safe_path = next(
            line.split('=', 1)[1] for line in bootstrap.splitlines() if line.startswith('PATH=')
        )
        self.assertIn('/snap/docker/current/bin', safe_path)
        unit = (repository / 'deploy' / 'backup' / 'capital-tracker-backup.service').read_text()
        self.assertIn(f'Environment=RELEASE_ROOT={managed_root}\n', unit)
        self.assertIn(f'Environment=PATH={safe_path}\n', unit)
        self.assertRegex(unit, r'(?m)^After=.*\bsnap\.docker\.dockerd\.service\b')
        readme = (repository / 'deploy' / 'backup' / 'README.md').read_text()
        self.assertIn(f'{managed_root}/.backup-key', readme)
        self.assertIn(f'{managed_root}/backups/scheduled-', readme)

    def test_backup_is_encrypted_checksummed_and_decryptable(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        dumps = sorted(self.backups.glob('scheduled-*.dump.enc'))
        self.assertEqual(len(dumps), 1)
        self.assertRegex(dumps[0].name, r'^scheduled-\d{8}T\d{6}Z\.dump\.enc$')
        self.assertNotIn(b'PGDMP', dumps[0].read_bytes())
        check = subprocess.run(['sha256sum', '-c', f'{dumps[0]}.sha256'], capture_output=True)
        self.assertEqual(check.returncode, 0)
        # The release's restore path decrypts it with the same parameters and key.
        plain = subprocess.run(
            ['openssl', 'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000',
             '-pass', f'file:{self.key}', '-in', str(dumps[0])],
            capture_output=True,
        )
        self.assertEqual(plain.stdout, b'PGDMP synthetic custom-format dump')
        self.assertNotIn(SYNTHETIC_KEY, result.stdout + result.stderr)

    def test_retention_keeps_newest_seven_and_never_touches_release_dumps(self):
        old = [self.dump(f'scheduled-202601{day:02d}T030000Z.dump.enc', 100 - day) for day in range(1, 11)]
        release = self.dump(f'{"a" * 40}-20250101T000000Z.dump.enc', 400)
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        remaining = sorted(p.name for p in self.backups.glob('scheduled-*.dump.enc'))
        # The new dump plus the six newest old ones: every old dump is past the 30-day window.
        self.assertEqual(len(remaining), 7)
        self.assertEqual([p.name for p in old[4:]], remaining[:6])
        for pruned in old[:4]:
            self.assertFalse(pruned.exists())
            self.assertFalse(Path(f'{pruned}.sha256').exists())
        self.assertTrue(release.exists())
        self.assertTrue(Path(f'{release}.sha256').exists())

    def test_retention_keeps_dumps_younger_than_the_window(self):
        young = [self.dump(f'scheduled-202610{day:02d}T030000Z.dump.enc', 20) for day in range(1, 11)]
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(path.exists() for path in young))

    def test_metric_file_is_written_atomically_with_the_right_names(self):
        before = int(time.time())
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p.name for p in self.metrics.iterdir()], ['capital_tracker_backup.prom'])
        metric = self.metrics / 'capital_tracker_backup.prom'
        values = dict(line.split() for line in metric.read_text().splitlines() if not line.startswith('#'))
        self.assertEqual(set(values), {'ct_backup_last_success_timestamp_seconds', 'ct_backup_last_size_bytes'})
        self.assertGreaterEqual(int(values['ct_backup_last_success_timestamp_seconds']), before)
        dump = next(self.backups.glob('scheduled-*.dump.enc'))
        self.assertEqual(int(values['ct_backup_last_size_bytes']), dump.stat().st_size)
        self.assertEqual(metric.stat().st_mode & 0o777, 0o644)
        # node_exporter reads only *.prom: the file is renamed into place from a hidden temp file
        # in the same directory, so it is never half-read.
        moves = [line.split() for line in self.calls.read_text().splitlines() if line.startswith('mv ')]
        self.assertEqual(len(moves), 1)
        source, target = Path(moves[0][-2]), Path(moves[0][-1])
        self.assertEqual(source.parent, self.metrics)
        self.assertRegex(source.name, r'^\.capital_tracker_backup\.prom\.\w+$')
        self.assertEqual(target, metric)
        # A non-root node_exporter must be able to list a directory the script creates.
        self.assertEqual(self.metrics.stat().st_mode & 0o777, 0o755)

    def test_absent_container_fails_loudly_without_writing(self):
        result = self.run_backup(CONTAINER_ABSENT='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('container capital_tracker_db is not running', result.stderr)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertFalse(self.metrics.exists())

    def test_missing_key_fails_without_writing(self):
        self.key.unlink()
        result = self.run_backup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('private backup key unavailable', result.stderr)
        self.assertEqual(list(self.backups.iterdir()), [])


    def test_readable_key_fails_without_writing(self):
        self.key.chmod(0o644)
        result = self.run_backup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('private backup key unavailable', result.stderr)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertFalse(self.metrics.exists())

    def test_release_holding_the_lock_fails_without_writing(self):
        result = self.run_backup(FLOCK_TIMEOUT='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('a release held the server lock for an hour', result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(), ['flock -w 3600 9'])
        self.assertTrue((self.root / '.release.lock').is_file())
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertFalse(self.metrics.exists())

    def test_failed_dump_removes_the_partial_file(self):
        result = self.run_backup(PG_DUMP_FAIL='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pg_dump or encryption did not finish', result.stderr)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertFalse(self.metrics.exists())


if __name__ == '__main__':
    unittest.main()
