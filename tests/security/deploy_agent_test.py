"""PULL-AGENT: the root release agent releases only an owner-approved deploy run, once.

GitHub is a fake that serves recorded API shapes; git, the file system, ownership and
mode checks, the zip archive and the server lock are real, in a disposable directory.
The release runner itself is replaced by a recording process.
"""

import copy
import email.message
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
import urllib.error
import zipfile


REPO = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deploy_agent', REPO / 'scripts/deploy-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

R = agent.REPOSITORY
RUN_ID = 900
CI_RUN = '800'
ARTIFACT_ID = 77
IMAGES = {
    'backend': 'ghcr.io/pavelars/capital-tracker-backend@sha256:' + 'b' * 64,
    'frontend': 'ghcr.io/pavelars/capital-tracker-frontend@sha256:' + 'c' * 64,
    'postgres': 'ghcr.io/pavelars/capital-tracker-postgres@sha256:' + 'd' * 64,
}
GIT_IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid']


def git(*args, cwd):
    subprocess.run(['git'] + list(args), cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def archive(name, content):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as output:
        output.writestr(name, content)
    return buffer.getvalue()


class FakeGitHub:
    def __init__(self):
        self.responses = {}
        self.archives = {}
        self.gets = []
        self.posts = []
        self.downloads = []

    def get(self, path, kind=dict):
        self.gets.append(path)
        key = path.split('?')[0]
        if key not in self.responses:
            raise AssertionError('unexpected GET ' + path)
        value = copy.deepcopy(self.responses[key])
        if not isinstance(value, kind):
            raise agent.Refusal('unexpected JSON shape')
        return value

    def post(self, path, body):
        self.posts.append((path, body))

    def download(self, path):
        self.downloads.append(path)
        return self.archives[path]


class FakeProcess:
    def __init__(self, lines, code):
        self.stdout = iter(lines)
        self.code = code

    def wait(self):
        return self.code


class FakePopen:
    def __init__(self, *codes):
        self.codes = list(codes)
        self.calls = []

    def __call__(self, argv, env, **options):
        self.calls.append((argv, env, options))
        code = self.codes.pop(0)
        last = b'Release verified\n' if code == 0 else b'Isolated backup restore fingerprint mismatch\n'
        return FakeProcess([b'step output\n', last], code)


class AgentFixture(unittest.TestCase):
    def setUp(self):
        previous = os.umask(0o022)
        self.addCleanup(os.umask, previous)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name).resolve()
        self.root.chmod(0o755)
        self.uid = os.getuid()
        self.make_origin()
        self.make_server()
        self.cfg = agent.Config(
            config_file=self.root / 'etc/deploy-agent.json', token_file=self.root / 'etc/deploy-agent.token',
            state_dir=self.state, runtime_dir=self.runtime, docker_config_dir=self.root / 'etc/docker-config',
            clone_url=self.clone_url, owner_uid=self.uid, stop_at=self.root, application_uid=self.uid,
            lock_wait=60, lock_retry=1)
        self.github = FakeGitHub()
        self.serve()
        self.logs = []
        self.sleeps = []

    def make_origin(self):
        self.origin = self.root / 'origin'
        self.origin.mkdir()
        git('init', '-q', cwd=self.origin)
        for name, relative in agent.FILES.items():
            path = self.origin / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# synthetic {}\n'.format(name))
        (self.origin / agent.AGENT_SOURCE).write_text('# synthetic agent\n')
        git('add', '-A', cwd=self.origin)
        git(*GIT_IDENTITY, 'commit', '-q', '-m', 'release candidate', cwd=self.origin)
        self.commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.origin, check=True,
                                     stdout=subprocess.PIPE).stdout.decode().strip()
        self.clone_url = 'file://' + str(self.origin)

    def make_server(self):
        etc = self.root / 'etc'
        etc.mkdir()
        (etc / 'deploy-agent.json').write_text('{"mode": "active"}\n')
        token = etc / 'deploy-agent.token'
        token.write_text('github_pat_' + 'A' * 40 + '\n')
        token.chmod(0o600)
        docker = etc / 'docker-config'
        docker.mkdir()
        (docker / 'config.json').write_text(json.dumps({'auths': {}, 'cliPluginsExtraDirs': [agent.SNAP_PLUGINS_DIR]}))
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        self.state.chmod(0o700)
        repo = self.state / 'repo'
        git('init', '-q', str(repo), cwd=self.root)
        repo.chmod(0o700)
        git('remote', 'add', 'origin', self.clone_url, cwd=repo)
        self.runtime = self.root / 'runtime'
        self.runtime.mkdir()
        for name in ('.env.release', '.backup-key', '.release-managed-env', '.mfa-key'):
            (self.runtime / name).write_text('synthetic\n')
        (self.runtime / 'operator').mkdir()
        (self.runtime / 'operator/recovery.json').write_text('{}\n')

    def receipt(self, **changes):
        receipt = {
            'version': 1, 'commit': self.commit, 'runId': CI_RUN, 'installation': 'existing', **IMAGES,
            'files': {name: hashlib.sha256((self.origin / relative).read_bytes()).hexdigest()
                      for name, relative in agent.FILES.items()},
        }
        receipt.update(changes)
        return receipt

    def run_object(self, **changes):
        run = {
            'id': RUN_ID, 'run_attempt': 1, 'path': agent.DEPLOY_WORKFLOW, 'event': 'workflow_run',
            'repository': {'full_name': R}, 'head_repository': {'full_name': R}, 'head_branch': 'main',
            'status': 'in_progress', 'head_sha': self.commit, 'run_started_at': '2026-11-19T10:00:00Z',
        }
        run.update(changes)
        return run

    def serve(self, run=None, artifact=None, approvals=None, ci_run=None, receipt=None, name=None):
        responses = self.github.responses
        responses['/repos/{}/git/ref/heads/main'.format(R)] = {'object': {'sha': self.commit}}
        responses['/repos/{}/actions/workflows/cd.yml/runs'.format(R)] = {'workflow_runs': [run or self.run_object()]}
        responses['/repos/{}/actions/runs/{}/artifacts'.format(R, RUN_ID)] = {'artifacts': [artifact or {
            'id': ARTIFACT_ID, 'name': agent.REQUEST_ARTIFACT, 'expired': False,
            'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID},
        }]}
        responses['/repos/{}/actions/runs/{}/approvals'.format(R, RUN_ID)] = approvals if approvals is not None else [{
            'state': 'approved', 'comment': '', 'user': {'login': agent.APPROVER},
            'environments': [{'name': agent.ENVIRONMENT}],
        }]
        responses['/repos/{}/actions/runs/{}'.format(R, CI_RUN)] = ci_run or {
            'path': agent.CI_WORKFLOW, 'event': 'push', 'head_branch': 'main', 'head_sha': self.commit,
            'status': 'completed', 'conclusion': 'success', 'repository': {'full_name': R},
            'head_repository': {'full_name': R},
        }
        content = receipt if isinstance(receipt, bytes) else json.dumps(receipt or self.receipt()).encode()
        self.github.archives['/repos/{}/actions/artifacts/{}/zip'.format(R, ARTIFACT_ID)] = archive(
            name or '{}-{}.json'.format(self.commit, CI_RUN), content)

    def set_mode(self, mode):
        (self.root / 'etc/deploy-agent.json').write_text(json.dumps({'mode': mode}))

    def run_agent(self, popen=None):
        self.popen = popen or FakePopen(0, 0)
        return agent.main(['run'], cfg=self.cfg, github=self.github, log=self.logs.append,
                          popen=self.popen, sleep=self.sleeps.append)

    def statuses(self):
        return [(body['state'], body['description']) for _, body in self.github.posts]


class ReleasesApprovedRuns(AgentFixture):
    def test_active_mode_runs_preflight_then_deploy_from_the_approved_commit(self):
        self.assertEqual(self.run_agent(), 0)
        (preflight, env, options), (deploy, deploy_env, _) = self.popen.calls
        runner = str(self.state / 'repo/scripts/manual-mvp-release.sh')
        self.assertEqual(preflight, ['/bin/bash', runner, 'preflight', self.commit])
        self.assertEqual(deploy, ['/bin/bash', runner, 'deploy', self.commit, IMAGES['backend'], IMAGES['frontend']])
        self.assertEqual(env, deploy_env)
        self.assertEqual(env, {
            'PATH': agent.SAFE_PATH, 'HOME': '/root', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
            'DOCKER_CONFIG': str(self.root / 'etc/docker-config'), 'RELEASE_ROOT': str(self.runtime),
            'RELEASE_RUNTIME_FILE': str(self.runtime / '.env.release'),
            'RELEASE_BACKUP_KEY_FILE': str(self.runtime / '.backup-key'),
            'RELEASE_INSTALLATION': 'existing', 'RELEASE_POSTGRES_IMAGE': IMAGES['postgres'],
            'RELEASE_COMPOSE_FILE': str(self.state / 'repo/docker-compose.yml'),
        })
        self.assertEqual(options['cwd'], '/')
        self.assertEqual((self.state / 'repo/scripts/manual-mvp-release.sh').read_text(), '# synthetic runner\n')

    def test_reports_pending_then_success_on_the_commit_with_the_run_link(self):
        self.run_agent()
        self.assertEqual(self.statuses(), [('pending', 'Server release started'), ('success', 'Release verified')])
        path, body = self.github.posts[-1]
        self.assertEqual(path, '/repos/{}/statuses/{}'.format(R, self.commit))
        self.assertEqual(body['context'], 'production-release')
        self.assertEqual(body['target_url'], 'https://github.com/{}/actions/runs/{}'.format(R, RUN_ID))

    def test_releases_each_run_attempt_once(self):
        self.run_agent()
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(self.popen.calls, [])
        self.assertEqual(len(self.github.downloads), 1)

    def test_a_rerun_attempt_with_its_own_request_releases_again(self):
        self.run_agent()
        self.serve(run=self.run_object(run_attempt=2, run_started_at='2026-11-19T11:00:00Z'), artifact={
            'id': ARTIFACT_ID, 'name': agent.REQUEST_ARTIFACT, 'expired': False,
            'created_at': '2026-11-19T11:05:00Z', 'workflow_run': {'id': RUN_ID},
        })
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(len(self.popen.calls), 2)

    def test_failed_runner_reports_failure_with_its_last_line(self):
        self.assertEqual(self.run_agent(FakePopen(0, 1)), 1)
        self.assertEqual(self.statuses()[-1], ('failure', 'Isolated backup restore fingerprint mismatch'))

    def test_failed_preflight_never_deploys(self):
        self.assertEqual(self.run_agent(FakePopen(1)), 1)
        self.assertEqual([call[0][2] for call in self.popen.calls], ['preflight'])
        self.assertEqual(self.statuses()[-1][0], 'failure')

    def test_waits_for_the_daily_backup_lock_before_releasing(self):
        lock = os.open(str(self.runtime / '.release.lock'), os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX)

        def release_lock(seconds):
            self.sleeps.append(seconds)
            fcntl.flock(lock, fcntl.LOCK_UN)

        self.popen = FakePopen(0, 0)
        code = agent.main(['run'], cfg=self.cfg, github=self.github, log=self.logs.append,
                          popen=self.popen, sleep=release_lock)
        self.assertEqual(code, 0)
        self.assertEqual(self.sleeps, [1])
        self.assertEqual(len(self.popen.calls), 2)

    def test_gives_up_when_the_lock_stays_held(self):
        self.cfg.lock_wait = 0
        lock = os.open(str(self.runtime / '.release.lock'), os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX)
        self.assertEqual(self.run_agent(), 1)
        self.assertEqual(self.popen.calls, [])
        self.assertEqual(self.statuses()[-1], ('failure', 'Refused: the daily backup or another release kept the server lock'))

    def test_status_description_is_printable_and_short(self):
        self.assertEqual(agent._describe('\x1b[31mfailed\x1b[0m ' + 'x' * 200), ('[31mfailed[0m ' + 'x' * 200)[:140])
        self.assertEqual(agent._describe('\n'), 'No output')


class ObserveMode(AgentFixture):
    def setUp(self):
        super().setUp()
        self.set_mode('observe')

    def test_logs_what_it_would_release_and_changes_nothing(self):
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(self.popen.calls, [])
        self.assertEqual(self.github.posts, [])
        self.assertTrue(any(line.startswith('Observe mode: would release commit ' + self.commit) for line in self.logs))
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(len([line for line in self.logs if line.startswith('Observe mode')]), 1)

    def test_watches_the_receipt_of_the_current_ssh_release(self):
        self.serve(artifact={'id': ARTIFACT_ID, 'name': 'manual-mvp-release-receipt', 'expired': False,
                             'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID}})
        self.run_agent()
        self.assertTrue(any(line.startswith('Observe mode: would release') for line in self.logs))

    def test_logs_a_refusal_once_without_reporting(self):
        self.serve(receipt=self.receipt(installation='fresh'))
        self.assertEqual(self.run_agent(), 2)
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(len([line for line in self.logs if line.startswith('Refused deploy run')]), 1)
        self.assertEqual(self.github.posts, [])

    def test_active_marker_is_separate_from_observe_marker(self):
        self.run_agent()
        self.set_mode('active')
        self.run_agent()
        self.assertEqual(len(self.popen.calls), 2)


class IgnoresUnapprovedOrStaleRuns(AgentFixture):
    def assert_ignored(self):
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(self.popen.calls, [])
        self.assertEqual(self.github.downloads, [])
        self.assertEqual(self.github.posts, [])

    def test_active_mode_ignores_the_ssh_release_receipt(self):
        self.serve(artifact={'id': ARTIFACT_ID, 'name': 'manual-mvp-release-receipt', 'expired': False,
                             'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID}})
        self.assert_ignored()

    def test_requires_the_owner_approval_in_production(self):
        for approvals in (
            [],
            [{'state': 'approved', 'user': {'login': 'someone-else'}, 'environments': [{'name': 'production'}]}],
            [{'state': 'approved', 'user': {'login': agent.APPROVER}, 'environments': [{'name': 'staging'}]}],
            [{'state': 'rejected', 'user': {'login': agent.APPROVER}, 'environments': [{'name': 'production'}]}],
        ):
            with self.subTest(approvals=approvals):
                self.serve(approvals=approvals)
                self.assert_ignored()

    def test_requires_a_running_deploy_of_the_head_of_main(self):
        for change in (
            {'head_sha': 'e' * 40}, {'status': 'completed'}, {'status': 'waiting'},
            {'head_branch': 'release/manual-mvp'}, {'event': 'pull_request'},
            {'path': '.github/workflows/ci.yml'}, {'repository': {'full_name': 'someone/fork'}},
            {'head_repository': {'full_name': 'someone/fork'}}, {'id': '900'}, {'run_attempt': 0},
        ):
            with self.subTest(change=change):
                self.serve(run=self.run_object(**change))
                self.assert_ignored()

    def test_waits_while_this_attempt_has_not_uploaded_its_request(self):
        for artifact in (
            {'id': ARTIFACT_ID, 'name': agent.REQUEST_ARTIFACT, 'expired': False,
             'created_at': '2026-11-19T09:59:59Z', 'workflow_run': {'id': RUN_ID}},
            {'id': ARTIFACT_ID, 'name': agent.REQUEST_ARTIFACT, 'expired': True,
             'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID}},
            {'id': ARTIFACT_ID, 'name': 'critical-release-acceptance', 'expired': False,
             'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID}},
        ):
            with self.subTest(artifact=artifact):
                self.serve(artifact=artifact)
                self.assert_ignored()
                self.assertFalse(any(path.endswith('/approvals') for path in self.github.gets))

    def test_refuses_an_artifact_of_another_run(self):
        self.serve(artifact={'id': ARTIFACT_ID, 'name': agent.REQUEST_ARTIFACT, 'expired': False,
                             'created_at': '2026-11-19T10:05:00Z', 'workflow_run': {'id': RUN_ID + 1}})
        self.assert_ignored()

    def test_agent_lock_held_by_another_pass_does_nothing(self):
        lock = os.open(str(self.state / 'agent.lock'), os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX)
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(self.github.gets, [])


class RefusesInvalidRequests(AgentFixture):
    def assert_refused(self, reason):
        self.assertEqual(self.run_agent(), 2)
        self.assertEqual(self.popen.calls, [])
        self.assertEqual(len(self.github.posts), 1)
        state, description = self.statuses()[0]
        self.assertEqual(state, 'failure')
        self.assertIn(reason, description)
        self.assertEqual(self.run_agent(), 0)
        self.assertEqual(len(self.github.posts), 1)

    def test_refuses_receipts_the_agent_must_not_release(self):
        cases = (
            (self.receipt(installation='fresh'), 'only an existing installation'),
            (self.receipt(backend='ghcr.io/someone/backend@sha256:' + 'b' * 64), 'unpinned backend image'),
            (self.receipt(postgres='postgres:18'), 'unpinned postgres image'),
            ({**self.receipt(), 'command': 'sh'}, 'unexpected receipt fields'),
            (self.receipt(version=2), 'unsupported receipt version'),
            (self.receipt(files={'runner': 'f' * 64}), 'unexpected receipt file set'),
        )
        for index, (receipt, reason) in enumerate(cases):
            with self.subTest(reason=reason):
                self.github.posts.clear()
                self.serve(run=self.run_object(run_attempt=index + 1), receipt=receipt)
                self.assert_refused(reason)

    def test_refuses_a_receipt_for_another_commit(self):
        self.serve(receipt=self.receipt(commit='e' * 40), name='{}-{}.json'.format('e' * 40, CI_RUN))
        self.assert_refused('another commit')

    def test_refuses_a_receipt_whose_name_differs_from_its_content(self):
        self.serve(name='{}-{}.json'.format(self.commit, '801'))
        self.assert_refused('name differs')

    def test_refuses_archives_with_other_or_extra_files(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as output:
            output.writestr('{}-{}.json'.format(self.commit, CI_RUN), json.dumps(self.receipt()))
            output.writestr('extra.json', '{}')
        self.github.archives['/repos/{}/actions/artifacts/{}/zip'.format(R, ARTIFACT_ID)] = buffer.getvalue()
        self.assert_refused('exactly one receipt')

    def test_refuses_duplicate_json_keys(self):
        content = json.dumps(self.receipt())[:-1] + ', "commit": "{}"}}'.format(self.commit)
        self.serve(receipt=content.encode())
        self.assert_refused('duplicate JSON key')

    def test_refuses_without_a_successful_main_ci_run_of_the_commit(self):
        for index, change in enumerate(({'conclusion': 'failure'}, {'head_sha': 'e' * 40},
                                        {'event': 'pull_request'}, {'path': agent.DEPLOY_WORKFLOW})):
            with self.subTest(change=change):
                self.github.posts.clear()
                ci_run = {'path': agent.CI_WORKFLOW, 'event': 'push', 'head_branch': 'main', 'head_sha': self.commit,
                          'status': 'completed', 'conclusion': 'success', 'repository': {'full_name': R},
                          'head_repository': {'full_name': R}, **change}
                self.serve(run=self.run_object(run_attempt=index + 1), ci_run=ci_run)
                self.assert_refused('successful main CI run')

    def test_refuses_server_files_that_differ_from_the_receipt(self):
        files = self.receipt()['files']
        self.serve(receipt=self.receipt(files={**files, 'compose': '0' * 64}))
        self.assert_refused('docker-compose.yml of this commit differs')

    def test_refuses_a_symlinked_server_file_in_the_commit(self):
        (self.origin / 'docker-compose.yml').unlink()
        os.symlink('/etc/hostname', str(self.origin / 'docker-compose.yml'))
        git('add', '-A', cwd=self.origin)
        git(*GIT_IDENTITY, 'commit', '-q', '-m', 'symlink', cwd=self.origin)
        self.commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.origin, check=True,
                                     stdout=subprocess.PIPE).stdout.decode().strip()
        files = {name: 'f' * 64 for name in agent.FILES}
        self.serve(run=self.run_object(), receipt=self.receipt(files=files))
        self.assert_refused('missing or a symlink')

    def test_refuses_a_runtime_tree_another_account_could_redirect(self):
        for index, damage in enumerate(('symlink', 'writable')):
            with self.subTest(damage=damage):
                self.github.posts.clear()
                target = self.runtime / 'releases'
                if damage == 'symlink':
                    os.symlink('/etc', str(target))
                else:
                    target.unlink()
                    target.mkdir()
                    target.chmod(0o777)
                self.serve(run=self.run_object(run_attempt=index + 1))
                self.assert_refused('releases')

    def test_refuses_registry_configuration_with_extra_plugins(self):
        (self.root / 'etc/docker-config/config.json').write_text(json.dumps({'cliPluginsExtraDirs': ['/tmp/plugins']}))
        self.assert_refused('unapproved extra CLI plugin directory')

    def test_refuses_a_clone_with_another_remote(self):
        git('remote', 'set-url', 'origin', 'https://example.invalid/fork.git', cwd=self.state / 'repo')
        self.assert_refused('unexpected remote')


class Configuration(AgentFixture):
    def run_check(self):
        return agent.main(['check'], cfg=self.cfg, github=self.github, log=self.logs.append)

    def test_check_reads_main_deploy_runs_and_statuses(self):
        self.github.responses['/repos/{}/commits/{}/statuses'.format(R, self.commit)] = []
        self.assertEqual(self.run_check(), 0)
        self.assertIn('Mode: active', self.logs[0])

    def test_refuses_a_token_others_can_read(self):
        (self.root / 'etc/deploy-agent.token').chmod(0o640)
        self.assertEqual(agent.main(['run'], cfg=self.cfg, log=self.logs.append), 2)
        self.assertIn('group or world accessible', self.logs[-1])

    def test_refuses_a_token_that_is_not_fine_grained(self):
        token = self.root / 'etc/deploy-agent.token'
        token.write_text('ghp_' + 'A' * 36 + '\n')
        self.assertEqual(agent.main(['run'], cfg=self.cfg, log=self.logs.append), 2)
        self.assertIn('fine-grained', self.logs[-1])

    def test_refuses_unknown_modes_and_fields(self):
        for value in ({'mode': 'deploy'}, {'mode': 'active', 'repository': 'someone/fork'}, ['active']):
            with self.subTest(value=value):
                (self.root / 'etc/deploy-agent.json').write_text(json.dumps(value))
                self.assertEqual(self.run_agent(), 2)
                self.assertEqual(self.github.gets, [])

    def test_refuses_a_state_directory_others_can_read(self):
        self.state.chmod(0o755)
        self.assertEqual(self.run_agent(), 2)
        self.assertIn('group or world accessible', self.logs[-1])

    def test_refuses_arguments(self):
        self.assertEqual(agent.main(['deploy'], cfg=self.cfg, log=self.logs.append), 2)
        self.assertEqual(agent.main(['run', 'now'], cfg=self.cfg, log=self.logs.append), 2)


class FakeResponse:
    def __init__(self, status, body=b'', headers=None):
        self.status = status
        self.body = io.BytesIO(body)
        self.headers = headers or {}

    def read(self, size):
        return self.body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def redirect(location):
    headers = email.message.Message()
    headers['Location'] = location
    return urllib.error.HTTPError(agent.API + '/zip', 302, 'Found', headers, None)


class GitHubClient(unittest.TestCase):
    TOKEN = 'github_pat_' + 'A' * 40

    def test_sends_the_token_only_to_the_api(self):
        opener = FakeOpener(redirect('https://storage.example.invalid/artifact?sig=x'), FakeResponse(200, b'zip'))
        self.assertEqual(agent.GitHub(self.TOKEN, opener).download('/repos/{}/actions/artifacts/1/zip'.format(R)), b'zip')
        api, storage = opener.requests
        self.assertEqual(api.full_url, agent.API + '/repos/{}/actions/artifacts/1/zip'.format(R))
        self.assertEqual(api.get_header('Authorization'), 'Bearer ' + self.TOKEN)
        self.assertEqual(storage.full_url, 'https://storage.example.invalid/artifact?sig=x')
        self.assertFalse(storage.has_header('Authorization'))

    def test_refuses_a_redirect_away_from_https(self):
        opener = FakeOpener(redirect('http://storage.example.invalid/artifact'))
        with self.assertRaises(agent.Unavailable):
            agent.GitHub(self.TOKEN, opener).download('/repos/{}/actions/artifacts/1/zip'.format(R))
        self.assertEqual(len(opener.requests), 1)

    def test_never_follows_redirects_with_the_token(self):
        handlers = agent.GitHub(self.TOKEN)._opener.handlers
        self.assertTrue(any(isinstance(handler, agent._NoRedirect) for handler in handlers))
        self.assertIsNone(agent._NoRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://elsewhere'))

    def test_api_errors_and_oversized_answers_are_not_trusted(self):
        error = urllib.error.HTTPError(agent.API, 403, 'Forbidden', email.message.Message(), None)
        with self.assertRaises(agent.Unavailable):
            agent.GitHub(self.TOKEN, FakeOpener(error)).get('/repos/{}'.format(R))
        with self.assertRaises(agent.Refusal):
            agent.GitHub(self.TOKEN, FakeOpener(FakeResponse(200, b' ' * (agent.MAX_API_BYTES + 1)))).get('/x')

    def test_posts_json(self):
        opener = FakeOpener(FakeResponse(201, b'{}'))
        agent.GitHub(self.TOKEN, opener).post('/repos/{}/statuses/{}'.format(R, 'a' * 40), {'state': 'success'})
        request = opener.requests[0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'state': 'success'})
        self.assertEqual(request.get_header('Content-type'), 'application/json')


class SystemdUnits(unittest.TestCase):
    def test_service_runs_the_installed_agent_once_per_timer_tick(self):
        service = (REPO / 'deploy/agent/capital-tracker-deploy-agent.service').read_text()
        timer = (REPO / 'deploy/agent/capital-tracker-deploy-agent.timer').read_text()
        installer = (REPO / 'scripts/deploy-agent-install.sh').read_text()
        self.assertIn('Type=oneshot', service)
        self.assertIn('ExecStart=/usr/bin/python3 -I /usr/local/libexec/capital-tracker/deploy-agent run', service)
        self.assertIn('agent=$libexec/deploy-agent', installer)
        self.assertIn('libexec=/usr/local/libexec/capital-tracker', installer)
        self.assertIn('OnCalendar=*-*-* *:*:00', timer)
        self.assertIn('WantedBy=timers.target', timer)


if __name__ == '__main__':
    unittest.main()
