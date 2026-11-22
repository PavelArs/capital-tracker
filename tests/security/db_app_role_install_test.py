"""DBROLE-INSTALL: the owner's one-time command that creates the backend's runtime role.

A recording docker stand-in answers for the PostgreSQL container and keeps every SQL text it
receives; id is a stand-in so the root check can run unprivileged. Bash, OpenSSL, flock, file
modes and symlink handling are real. All credentials here are synthetic.
"""

import fcntl
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'scripts/db-app-role-install.sh'

DOCKER_FIXTURE = r'''import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
args = sys.argv[1:]
sql = sys.stdin.read() if args[:2] == ['exec', '-i'] else ''
with open(root / 'docker-calls', 'a') as output:
    output.write(json.dumps({'args': args, 'sql': sql}) + '\n')
if args[0] == 'inspect':
    print(os.environ.get('FIXTURE_RUNNING', 'true'))
elif 'FROM pg_roles' in sql:
    print(os.environ.get('FIXTURE_EXISTING', '0'))
elif 'CREATE ROLE' in sql:
    sys.exit(int(os.environ.get('FIXTURE_CREATE_EXIT', '0')))
'''

RUNTIME = 'DB_USERNAME=capital\nDB_PASSWORD=synthetic-migration-password\nFRONTEND_URL=https://mvp.example.invalid\n'


class RuntimeRoleInstall(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name).resolve()
        self.release = self.root / 'release'
        self.release.mkdir()
        self.runtime = self.release / '.env.release'
        self.runtime.write_text(RUNTIME)
        self.runtime.chmod(0o600)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.bin / 'docker-fixture.py').write_text(DOCKER_FIXTURE)
        self.fake('docker', 'exec python3 "$(dirname "$0")/docker-fixture.py" "$@"')
        self.fake('id', 'echo "${FIXTURE_UID:-0}"')

    def fake(self, name, body):
        path = self.bin / name
        path.write_text('#!/usr/bin/env bash\n' + body + '\n')
        path.chmod(0o700)

    def install(self, **env):
        result = subprocess.run(
            ['bash', str(SCRIPT)], capture_output=True, text=True, timeout=30,
            env={**os.environ, 'PATH': '{}:{}'.format(self.bin, os.environ['PATH']),
                 'RELEASE_ROOT': str(self.release), 'FIXTURE_ROOT': str(self.root), **env})
        calls_file = self.root / 'docker-calls'
        calls = [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []
        return result, calls

    def added_password(self):
        added = self.runtime.read_text()[len(RUNTIME):]
        match = re.fullmatch(r'DB_APP_USERNAME=capital_app\nDB_APP_PASSWORD=([a-f0-9]{64})\n', added)
        self.assertIsNotNone(match, added)
        return match.group(1)

    def assert_unchanged(self):
        self.assertEqual(self.runtime.read_text(), RUNTIME)
        self.assertEqual([path.name for path in self.release.iterdir() if path.name != '.release.lock'],
                         ['.env.release'])

    def test_creates_a_login_role_without_administrative_attributes_and_names_it_in_the_runtime_file(self):
        result, calls = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        password = self.added_password()
        create = [call for call in calls if 'CREATE ROLE' in call['sql']]
        self.assertEqual(len(create), 1)
        self.assertEqual(
            create[0]['sql'].strip(),
            "CREATE ROLE capital_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION "
            "NOBYPASSRLS NOINHERIT PASSWORD '{}';".format(password))
        # The existence check runs first and carries no password.
        self.assertLess(next(i for i, call in enumerate(calls) if 'FROM pg_roles' in call['sql']),
                        calls.index(create[0]))
        for call in calls:
            if call['args'][0] == 'exec':
                self.assertEqual(call['args'][:3], ['exec', '-i', 'capital_tracker_db'])
                self.assertEqual(call['args'][3:5], ['sh', '-c'])
                self.assertIn('-U "$POSTGRES_USER" -d "$POSTGRES_DB"', call['args'][5])
        self.assertIn('Created the runtime database role capital_app', result.stdout)
        self.assertEqual(stat.S_IMODE(self.runtime.stat().st_mode), 0o600)

    def test_never_prints_the_password_or_passes_it_as_an_argument(self):
        result, calls = self.install()
        password = self.added_password()
        self.assertNotIn(password, result.stdout + result.stderr)
        for call in calls:
            self.assertNotIn(password, ' '.join(call['args']))

    def test_ends_a_runtime_file_without_a_final_newline_before_appending(self):
        self.runtime.write_text(RUNTIME.rstrip('\n'))
        result, _ = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.runtime.read_text().startswith(RUNTIME + 'DB_APP_USERNAME=capital_app\n'))

    def test_refuses_a_runtime_file_that_already_names_a_runtime_role(self):
        for line in ('DB_APP_USERNAME=other\n', 'DB_APP_PASSWORD=synthetic\n'):
            with self.subTest(line=line):
                self.runtime.write_text(RUNTIME + line)
                result, calls = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('already names a runtime role', result.stderr)
                self.assertEqual(calls, [])
                self.assertEqual(self.runtime.read_text(), RUNTIME + line)

    def test_refuses_an_existing_role_before_any_password_exists(self):
        result, calls = self.install(FIXTURE_EXISTING='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('role capital_app already exists', result.stderr)
        self.assertFalse(any('CREATE ROLE' in call['sql'] for call in calls))
        self.assert_unchanged()

    def test_a_failed_create_leaves_the_runtime_file_unchanged(self):
        result, _ = self.install(FIXTURE_CREATE_EXIT='3')
        self.assertNotEqual(result.returncode, 0)
        self.assert_unchanged()

    def test_refuses_a_missing_or_linked_runtime_file(self):
        target = self.root / 'elsewhere'
        target.write_text(RUNTIME)
        for linked in (False, True):
            with self.subTest(linked=linked):
                if self.runtime.exists() or self.runtime.is_symlink():
                    self.runtime.unlink()
                if linked:
                    self.runtime.symlink_to(target)
                result, calls = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('private runtime file', result.stderr)
                self.assertEqual(calls, [])
        self.assertEqual(target.read_text(), RUNTIME)

    def test_refuses_while_a_release_or_backup_holds_the_server_lock(self):
        with open(self.release / '.release.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result, calls = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('holds the server lock', result.stderr)
        self.assertEqual(calls, [])
        self.assert_unchanged()

    def test_refuses_a_stopped_database(self):
        result, calls = self.install(FIXTURE_RUNNING='false')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('capital_tracker_db is not running', result.stderr)
        self.assertEqual([call['args'][0] for call in calls], ['inspect'])
        self.assert_unchanged()

    def test_refuses_without_root(self):
        result, calls = self.install(FIXTURE_UID='1000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('run as root', result.stderr)
        self.assertEqual(calls, [])
        self.assert_unchanged()


if __name__ == '__main__':
    unittest.main()
