"""PULL-AGENT-INSTALL: the root installer of the release agent, in a disposable server.

Only the test copy redirects the fixed system paths into a temporary directory and
replaces id, install and systemctl with recording fixtures; the agent it installs is a
recording stand-in. Git, bash, file modes and symlink handling are real.
"""

import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
TOKEN = 'github_pat_' + 'A' * 40
GIT_IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid']

INSTALL_FIXTURE = r'''import json, os, pathlib, shutil, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with open(root / 'calls', 'a') as output:
    output.write(json.dumps(['install'] + args) + '\n')
def confined(path):
    candidate = pathlib.Path(path)
    if not candidate.resolve().is_relative_to(root):
        raise SystemExit('fixture refuses system write: ' + str(candidate))
    return candidate
mode = int(args[args.index('-m') + 1], 8)
if '-d' in args:
    for item in args[args.index('-m') + 2:]:
        path = confined(item)
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(mode)
else:
    target = confined(args[-1])
    shutil.copyfile(args[-2], target)
    target.chmod(mode)
'''

RECORD_FIXTURE = r'''import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with open(root / 'calls', 'a') as output:
    output.write(json.dumps([pathlib.Path(sys.argv[0]).name] + sys.argv[1:]) + '\n')
if pathlib.Path(sys.argv[0]).name == 'id':
    print('0')
sys.exit(int(os.environ.get('FIXTURE_AGENT_EXIT', '0')) if pathlib.Path(sys.argv[0]).name == 'deploy-agent' else 0)
'''


class InstallerFixture(unittest.TestCase):
    def setUp(self):
        previous = os.umask(0o022)
        self.addCleanup(os.umask, previous)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name).resolve()
        self.server = self.root / 'server'
        self.paths = {
            '/usr/local/libexec/capital-tracker': self.server / 'libexec',
            '/etc/capital-tracker': self.server / 'etc',
            '/var/lib/capital-tracker-agent': self.server / 'state',
            '/etc/systemd/system': self.server / 'systemd',
        }
        self.server.mkdir()
        (self.server / 'systemd').mkdir()
        self.make_checkout()
        self.make_bin()

    def make_checkout(self):
        self.checkout = self.root / 'checkout'
        (self.checkout / 'scripts').mkdir(parents=True)
        installer = (REPO / 'scripts/deploy-agent-install.sh').read_text()
        for real, fixture in self.paths.items():
            self.assertIn(real, installer)
            installer = installer.replace(real, str(fixture))
        (self.checkout / 'scripts/deploy-agent-install.sh').write_text(installer)
        (self.checkout / 'scripts/deploy-agent.py').write_text(RECORD_FIXTURE)
        shutil.copytree(REPO / 'deploy/agent', self.checkout / 'deploy/agent')
        subprocess.run(['git', 'init', '-q'], cwd=self.checkout, check=True)
        subprocess.run(['git', 'add', '-A'], cwd=self.checkout, check=True)
        subprocess.run(['git'] + GIT_IDENTITY + ['commit', '-q', '-m', 'agent'], cwd=self.checkout, check=True)

    def make_bin(self):
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name, body in (('install', INSTALL_FIXTURE), ('id', RECORD_FIXTURE), ('systemctl', RECORD_FIXTURE)):
            path = self.bin / name
            path.write_text('#!/usr/bin/python3\n' + body)
            path.chmod(0o755)

    def run_installer(self, *args, token=None):
        environment = {'PATH': '{}:/usr/bin:/bin'.format(self.bin), 'FIXTURE_ROOT': str(self.root),
                       'HOME': str(self.root), 'LANG': 'C.UTF-8', **getattr(self, 'extra_env', {})}
        return subprocess.run(['bash', str(self.checkout / 'scripts/deploy-agent-install.sh')] + list(args),
                              input=(token + '\n') if token is not None else '', env=environment,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def calls(self):
        path = self.root / 'calls'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def mode(self, path):
        return stat.S_IMODE(os.lstat(path).st_mode)

    @property
    def config(self):
        return self.server / 'etc/deploy-agent.json'

    @property
    def token(self):
        return self.server / 'etc/deploy-agent.token'


class InstallsInObserveMode(InstallerFixture):
    def test_install_publishes_agent_units_observe_config_and_private_token(self):
        result = self.run_installer('install', token=TOKEN)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'observe'})
        self.assertEqual(self.token.read_text(), TOKEN + '\n')
        self.assertEqual(self.mode(self.token), 0o600)
        self.assertEqual(self.mode(self.config), 0o644)
        agent = self.server / 'libexec/deploy-agent'
        self.assertEqual(agent.read_text(), (self.checkout / 'scripts/deploy-agent.py').read_text())
        self.assertEqual(self.mode(agent), 0o755)
        for unit in ('capital-tracker-deploy-agent.service', 'capital-tracker-deploy-agent.timer'):
            self.assertEqual((self.server / 'systemd' / unit).read_text(), (REPO / 'deploy/agent' / unit).read_text())
        state = self.server / 'state'
        self.assertEqual(self.mode(state), 0o700)
        remote = subprocess.run(['git', '-C', str(state / 'repo'), 'remote', 'get-url', 'origin'],
                                stdout=subprocess.PIPE, text=True, check=True).stdout.strip()
        self.assertEqual(remote, 'https://github.com/PavelArs/capital-tracker.git')
        self.assertEqual(self.mode(state / 'repo'), 0o700)
        calls = [call for call in self.calls() if call[0] != 'install' and call[0] != 'id']
        self.assertEqual(calls, [
            ['systemctl', 'daemon-reload'],
            ['deploy-agent', 'check'],
            ['systemctl', 'enable', '--now', 'capital-tracker-deploy-agent.timer'],
        ])
        self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_rejects_a_token_that_is_not_fine_grained_before_enabling(self):
        for value in ('ghp_' + 'A' * 36, TOKEN + ' extra', ''):
            with self.subTest(value=value):
                result = self.run_installer('install', token=value)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.token.exists())
                self.assertNotIn(['systemctl', 'enable', '--now', 'capital-tracker-deploy-agent.timer'], self.calls())

    def test_failed_access_check_leaves_the_timer_disabled(self):
        self.extra_env = {'FIXTURE_AGENT_EXIT': '1'}
        result = self.run_installer('install', token=TOKEN)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(['systemctl', 'enable', '--now', 'capital-tracker-deploy-agent.timer'], self.calls())

    def test_reinstall_keeps_the_mode_and_token(self):
        self.assertEqual(self.run_installer('install', token=TOKEN).returncode, 0)
        self.assertEqual(self.run_installer('active').returncode, 0)
        result = self.run_installer('install')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'active'})
        self.assertEqual(self.token.read_text(), TOKEN + '\n')

    def test_refuses_a_checkout_with_local_changes_before_any_change(self):
        (self.checkout / 'deploy/agent/capital-tracker-deploy-agent.timer').write_text('[Timer]\nOnCalendar=*:*:*\n')
        result = self.run_installer('install', token=TOKEN)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('local changes', result.stderr)
        self.assertEqual([call for call in self.calls() if call[0] != 'id'], [])

    def test_never_writes_through_a_symlink(self):
        (self.server / 'etc').mkdir()
        outside = self.root / 'outside.json'
        outside.write_text('untouched')
        os.symlink(str(outside), str(self.config))
        result = self.run_installer('install', token=TOKEN)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(outside.read_text(), 'untouched')


class ChangesModeTokenAndAgent(InstallerFixture):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.run_installer('install', token=TOKEN).returncode, 0)

    def test_switches_between_observe_and_active(self):
        self.assertEqual(self.run_installer('active').returncode, 0)
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'active'})
        self.assertEqual(self.run_installer('observe').returncode, 0)
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'observe'})
        self.assertNotEqual(self.run_installer('active', 'now').returncode, 0)

    def test_replaces_the_token_and_checks_it(self):
        replacement = 'github_pat_' + 'B' * 40
        result = self.run_installer('token', token=replacement)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.token.read_text(), replacement + '\n')
        self.assertEqual(self.mode(self.token), 0o600)
        self.assertEqual(self.calls()[-1], ['deploy-agent', 'check'])

    def test_update_refreshes_the_agent_and_keeps_mode_and_token(self):
        self.run_installer('active')
        (self.checkout / 'scripts/deploy-agent.py').write_text(RECORD_FIXTURE + '# updated\n')
        subprocess.run(['git'] + GIT_IDENTITY + ['commit', '-qam', 'update'], cwd=self.checkout, check=True)
        result = self.run_installer('update')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.server / 'libexec/deploy-agent').read_text().endswith('# updated\n'))
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'active'})
        self.assertEqual(self.token.read_text(), TOKEN + '\n')

    def test_mode_changes_need_an_installed_agent(self):
        (self.server / 'libexec/deploy-agent').unlink()
        self.assertNotEqual(self.run_installer('active').returncode, 0)
        self.assertEqual(json.loads(self.config.read_text()), {'mode': 'observe'})


if __name__ == '__main__':
    unittest.main()
