#!/usr/bin/python3 -I
"""Pull-based production release agent, run as root once a minute by a systemd timer.

Nothing reaches the server from outside: the agent asks GitHub. It releases only when all
of these hold for one run of the deploy workflow:

- the run is this repository's `.github/workflows/cd.yml` on `main`, it is running, and
  its commit is the current head of `main`;
- the owner approved it in the `production` environment;
- the current attempt of that run uploaded a release request: the promoted receipt with
  the image digests and the hashes of the server files;
- the receipt names that commit, a successful main-push CI run of that commit and an
  existing installation;
- the server files of that commit, fetched into the agent's own clone, match the receipt.

It then runs the release runner from that clone (preflight, then deploy) and reports the
outcome as the commit status `production-release`, which the waiting deploy job reads.
Each attempt of a deploy run is released at most once.

Right before the runner starts, and again between its preflight and deploy, the agent
checks that the run still waits and that main has not moved. An outcome GitHub could not
take is posted again by later passes.

Mode, from /etc/capital-tracker/deploy-agent.json:
  observe  verify everything above, also for just-finished runs, and log what would be
           released; never release, post or take the server lock
  active   release as above

Usage: deploy-agent [run|check]
  run    one pass (the systemd service)
  check  confirm that the token can read this repository's Actions, then exit
"""

import contextlib
import datetime
import fcntl
import hashlib
import io
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib

REPOSITORY = 'PavelArs/capital-tracker'
APPROVER = 'PavelArs'
ENVIRONMENT = 'production'
DEPLOY_WORKFLOW = '.github/workflows/cd.yml'
CI_WORKFLOW = '.github/workflows/ci.yml'
DEPLOY_EVENTS = ('workflow_run', 'workflow_dispatch')
API = 'https://api.github.com'
CLONE_URL = 'https://github.com/' + REPOSITORY + '.git'
RUN_URL = 'https://github.com/' + REPOSITORY + '/actions/runs/{}'
# The deploy job uploads this artifact when it waits for the agent. Observe mode also
# watches the receipt of today's SSH release, so the agent can be checked before it acts.
REQUEST_ARTIFACT = 'server-release-request'
OBSERVED_ARTIFACTS = (REQUEST_ARTIFACT, 'manual-mvp-release-receipt')
STATUS_CONTEXT = 'production-release'
MODES = ('observe', 'active')

CONFIG_FILE = pathlib.Path('/etc/capital-tracker/deploy-agent.json')
TOKEN_FILE = pathlib.Path('/etc/capital-tracker/deploy-agent.token')
STATE_DIR = pathlib.Path('/var/lib/capital-tracker-agent')
RUNTIME_DIR = pathlib.Path('/var/snap/docker/common/capital-tracker')
DOCKER_CONFIG_DIR = pathlib.Path('/etc/capital-tracker/docker-config')
SNAP_PLUGINS_DIR = '/snap/docker/current/usr/libexec/docker/cli-plugins'
SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/docker/current/bin'
RUNTIME_FILES = ('.env.release', '.backup-key')
# Bootstrap gives the container user (uid 1000) its MFA key and the operator directory.
APPLICATION_UID = 1000
APPLICATION_OWNED = ('.mfa-key', 'operator')

# Server files the release runs, by receipt name. The receipt carries their hashes.
FILES = {
    'runner': 'scripts/manual-mvp-release.sh',
    'inventory': 'scripts/manual-mvp-inventory.sh',
    'normalizer': 'scripts/normalize-release-snapshot.awk',
    'compose': 'docker-compose.yml',
    'pins': 'deploy/manual-mvp-infrastructure-pins.json',
    'resume': 'scripts/manual-mvp-resume.py',
}
AGENT_SOURCE = 'scripts/deploy-agent.py'

MAX_API_BYTES = 8 * 1024 * 1024
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 64 * 1024
MAX_FILE_BYTES = 1024 * 1024
MAX_TREE_ENTRIES = 100000
# Shorter than the deploy job's wait for the server, so a waiting job is still there.
LOCK_WAIT_SECONDS = 40 * 60
LOCK_RETRY_SECONDS = 30
GIT_TIMEOUT_SECONDS = 600
# Unreported outcomes are retried for a day; the deploy job has long given up by then.
MARKER_RETRY_SECONDS = 24 * 60 * 60
MARKER_STATES = ('started', 'success', 'failure', 'observed')
STOPPED_DURING_RELEASE = 'The agent stopped during this release; see journalctl -u capital-tracker-deploy-agent'
STOPPING = 'the agent is stopping (shutdown, a stop or the unit timeout)'
LOCK_KEPT = 'the daily backup or another release kept the server lock'

COMMIT = re.compile(r'[a-f0-9]{40}')
RUN_ID = re.compile(r'[1-9][0-9]{0,19}')
SHA256 = re.compile(r'[a-f0-9]{64}')
TOKEN = re.compile(r'github_pat_[A-Za-z0-9_]{20,255}')
RECEIPT_NAME = re.compile(r'([a-f0-9]{40})-([1-9][0-9]{0,19})\.json')
IMAGES = {
    name: re.compile(r'ghcr\.io/pavelars/capital-tracker-' + name + r'@sha256:[a-f0-9]{64}')
    for name in ('backend', 'frontend', 'postgres')
}
RECEIPT_KEYS = {'version', 'commit', 'runId', 'installation', 'backend', 'frontend', 'postgres', 'files'}


class Refusal(Exception):
    """A check failed: this run must not be released."""


class Unavailable(Exception):
    """GitHub or git could not be reached; the next pass tries again."""


class Config:
    def __init__(self, config_file=CONFIG_FILE, token_file=TOKEN_FILE, state_dir=STATE_DIR,
                 runtime_dir=RUNTIME_DIR, docker_config_dir=DOCKER_CONFIG_DIR, clone_url=CLONE_URL,
                 owner_uid=0, stop_at=None, application_uid=APPLICATION_UID,
                 lock_wait=LOCK_WAIT_SECONDS, lock_retry=LOCK_RETRY_SECONDS):
        self.config_file = pathlib.Path(config_file)
        self.token_file = pathlib.Path(token_file)
        self.state_dir = pathlib.Path(state_dir)
        self.runtime_dir = pathlib.Path(runtime_dir)
        self.docker_config_dir = pathlib.Path(docker_config_dir)
        self.clone_url = clone_url
        self.owner_uid = owner_uid
        self.stop_at = stop_at
        self.application_uid = application_uid
        self.lock_wait = lock_wait
        self.lock_retry = lock_retry

    @property
    def repo_dir(self):
        return self.state_dir / 'repo'


def _full(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Refusal('duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(name):
    raise Refusal('non-finite JSON number')


def parse_json(data, kind=dict):
    try:
        value = json.loads(data.decode('utf-8'), object_pairs_hook=_reject_duplicates,
                           parse_constant=_reject_constant)
    except Refusal:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise Refusal('malformed JSON') from error
    if not isinstance(value, kind):
        raise Refusal('unexpected JSON shape')
    return value


# Trust checks: the agent runs as root, so nothing it reads or writes through may be
# replaceable by another account.

def _check_owner_and_mode(info, owner_uid, private=False):
    if info.st_uid not in (owner_uid, 0):
        raise Refusal('untrusted owner')
    if info.st_mode & (0o077 if private else 0o022):
        raise Refusal('group or world accessible' if private else 'group or world writable')


def _check_ancestors(path, owner_uid, stop_at):
    stop = pathlib.Path(stop_at) if stop_at is not None else None
    for parent in path.parents:
        info = os.lstat(parent)
        if not stat.S_ISDIR(info.st_mode):
            raise Refusal('trusted ancestor is not a directory')
        _check_owner_and_mode(info, owner_uid)
        if stop is not None and parent == stop:
            return
    if stop is not None:
        raise Refusal('trusted boundary is not an ancestor')


def check_trusted_dir(path, cfg, private=False):
    try:
        info = os.lstat(path)
        if not stat.S_ISDIR(info.st_mode):
            raise Refusal('{} is not a directory'.format(path))
        _check_owner_and_mode(info, cfg.owner_uid, private)
        _check_ancestors(pathlib.Path(path), cfg.owner_uid, cfg.stop_at)
    except OSError as error:
        raise Refusal('{} is unavailable'.format(path)) from error


def check_trusted_tree(path, cfg, application_owned=()):
    """Every entry is a non-symlink directory or regular file that only root can change.

    Top-level names in ``application_owned`` (and their subtrees) may belong to the
    application user instead; they stay symlink-free and not group/world writable.
    """
    check_trusted_dir(path, cfg)
    try:
        count = 0
        pending = [(str(path), False)]
        while pending:
            directory, delegated = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    count += 1
                    if count > MAX_TREE_ENTRIES:
                        raise Refusal('trusted tree too large')
                    info = entry.stat(follow_symlinks=False)
                    entry_delegated = delegated or (directory == str(path) and entry.name in application_owned)
                    if stat.S_ISDIR(info.st_mode):
                        pending.append((entry.path, entry_delegated))
                    elif not stat.S_ISREG(info.st_mode):
                        raise Refusal('{}: not a directory or regular file'.format(entry.path))
                    try:
                        _check_owner_and_mode(info, cfg.application_uid if entry_delegated else cfg.owner_uid)
                    except Refusal as refusal:
                        raise Refusal('{}: {}'.format(entry.path, refusal)) from None
    except OSError as error:
        raise Refusal('trusted tree {} unavailable'.format(path)) from error


def read_regular_file(path, limit=MAX_FILE_BYTES):
    """Read a regular file without following a symlink at its last component."""
    try:
        descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError as error:
        raise Refusal('{} is missing or a symlink'.format(path)) from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise Refusal('{} is not a regular file'.format(path))
        data = os.read(descriptor, limit + 1)
        while len(data) <= limit:
            chunk = os.read(descriptor, limit + 1 - len(data))
            if not chunk:
                break
            data += chunk
        if len(data) > limit:
            raise Refusal('{} is too large'.format(path))
        return info, data
    finally:
        os.close(descriptor)


def read_trusted_file(path, cfg, private=False):
    info, data = read_regular_file(path)
    _check_owner_and_mode(info, cfg.owner_uid, private)
    try:
        _check_ancestors(pathlib.Path(path), cfg.owner_uid, cfg.stop_at)
    except OSError as error:
        raise Refusal('{} is unavailable'.format(path)) from error
    return data


def read_mode(cfg):
    config = parse_json(read_trusted_file(cfg.config_file, cfg))
    if set(config) != {'mode'} or config['mode'] not in MODES:
        raise Refusal('configuration must be {"mode": "observe"} or {"mode": "active"}')
    return config['mode']


def read_token(cfg):
    token = read_trusted_file(cfg.token_file, cfg, private=True).decode('ascii', 'replace').strip()
    if not _full(TOKEN, token):
        raise Refusal('the token file must hold one fine-grained GitHub token')
    return token


# GitHub access. The token goes only to api.github.com; redirects are never followed with it.

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_limited(response, limit):
    data = response.read(limit + 1)
    if len(data) > limit:
        raise Refusal('GitHub response too large')
    return data


class GitHub:
    def __init__(self, token, opener=None):
        self._token = token
        self._opener = opener or urllib.request.build_opener(_NoRedirect)

    def _send(self, method, path, body=None, limit=MAX_API_BYTES):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(API + path, data=data, method=method, headers={
            'Accept': 'application/vnd.github+json',
            'Authorization': 'Bearer ' + self._token,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'capital-tracker-deploy-agent',
        })
        if data is not None:
            request.add_header('Content-Type', 'application/json')
        name = path.split('?')[0]
        try:
            with self._opener.open(request, timeout=30) as response:
                return response.status, _read_limited(response, limit), response.headers
        except urllib.error.HTTPError as error:
            if error.code in (302, 307):
                return error.code, b'', error.headers
            raise Unavailable('GitHub {} {} answered {}'.format(method, name, error.code)) from None
        except (urllib.error.URLError, OSError) as error:
            raise Unavailable('GitHub {} {} unreachable: {}'.format(method, name, error)) from None

    def get(self, path, kind=dict):
        status, body, _ = self._send('GET', path)
        if status != 200:
            raise Unavailable('GitHub GET {} answered {}'.format(path.split('?')[0], status))
        return parse_json(body, kind)

    def post(self, path, body):
        status, _, _ = self._send('POST', path, body)
        if status not in (200, 201):
            raise Unavailable('GitHub POST {} answered {}'.format(path, status))

    def download(self, path):
        status, body, headers = self._send('GET', path, limit=MAX_ARTIFACT_BYTES)
        if status == 200:
            return body
        location = headers.get('Location', '') if status in (302, 307) else ''
        if not location.startswith('https://'):
            raise Unavailable('artifact download did not redirect to HTTPS storage')
        # The signed storage URL needs no credentials: never forward the token there.
        request = urllib.request.Request(location, headers={'User-Agent': 'capital-tracker-deploy-agent'})
        try:
            with self._opener.open(request, timeout=60) as response:
                return _read_limited(response, MAX_ARTIFACT_BYTES)
        except (urllib.error.URLError, OSError) as error:
            raise Unavailable('artifact storage unreachable: {}'.format(error)) from None


def _repo(value):
    return value.get('full_name') if isinstance(value, dict) else None


def _time(value):
    if not isinstance(value, str):
        raise Refusal('missing timestamp')
    try:
        parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise Refusal('malformed timestamp') from error
    if parsed.tzinfo is None:
        raise Refusal('timestamp without time zone')
    return parsed


def main_head(github):
    ref = github.get('/repos/{}/git/ref/heads/main'.format(REPOSITORY))
    target = ref.get('object')
    sha = target.get('sha') if isinstance(target, dict) else None
    if not _full(COMMIT, sha):
        raise Unavailable('the head of main is unavailable')
    return sha


def deploy_runs(github, mode):
    # Observe mode also looks at finished runs: the dispatcher's release often ends within
    # a minute of its receipt upload, before a pass sees it running.
    query = 'status=in_progress&per_page=20' if mode == 'active' else 'per_page=5'
    data = github.get('/repos/{}/actions/workflows/cd.yml/runs?branch=main&{}'.format(REPOSITORY, query))
    runs = data.get('workflow_runs')
    if not isinstance(runs, list):
        raise Unavailable('malformed deploy run list')
    return [run for run in runs if isinstance(run, dict)]


def check_run(run, mode):
    """Return (run id, attempt, attempt start) of a deploy run of main in this repository."""
    if run.get('path') != DEPLOY_WORKFLOW:
        raise Refusal('not the deploy workflow')
    if _repo(run.get('repository')) != REPOSITORY or _repo(run.get('head_repository')) != REPOSITORY:
        raise Refusal('run of another repository')
    if run.get('head_branch') != 'main' or run.get('event') not in DEPLOY_EVENTS:
        raise Refusal('not a deploy of main')
    if run.get('status') not in (('in_progress',) if mode == 'active' else ('in_progress', 'completed')):
        raise Refusal('run is not in progress')
    run_id, attempt = run.get('id'), run.get('run_attempt')
    if type(run_id) is not int or not _full(RUN_ID, str(run_id)) or type(attempt) is not int or attempt < 1:
        raise Refusal('malformed run identity')
    if not _full(COMMIT, run.get('head_sha')):
        raise Refusal('malformed run commit')
    return run_id, attempt, _time(run.get('run_started_at'))


def find_request_artifact(github, run_id, started, names):
    """The release request uploaded by this attempt, or None while the job has not uploaded it.

    ``names`` are in order of preference: observe mode takes the request artifact over
    the dispatcher's receipt when a run has both.
    """
    data = github.get('/repos/{}/actions/runs/{}/artifacts?per_page=100'.format(REPOSITORY, run_id))
    artifacts = data.get('artifacts')
    if not isinstance(artifacts, list):
        raise Unavailable('malformed artifact list')
    found = {name: [] for name in names}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or artifact.get('name') not in names:
            continue
        source = artifact.get('workflow_run')
        if not isinstance(source, dict) or source.get('id') != run_id:
            raise Refusal('artifact of another run')
        # Earlier attempts left their own artifacts; only this attempt's request counts.
        if artifact.get('expired') is not False or _time(artifact.get('created_at')) < started:
            continue
        if type(artifact.get('id')) is not int or artifact['id'] < 1:
            raise Refusal('malformed artifact id')
        found[artifact['name']].append(artifact)
    for name in names:
        if len(found[name]) > 1:
            raise Refusal('several release requests in one attempt')
        if found[name]:
            return found[name][0]
    return None


def check_approval(github, run_id):
    approvals = github.get('/repos/{}/actions/runs/{}/approvals'.format(REPOSITORY, run_id), kind=list)
    for approval in approvals:
        if not isinstance(approval, dict) or approval.get('state') != 'approved':
            continue
        user, environments = approval.get('user'), approval.get('environments')
        if (isinstance(user, dict) and user.get('login') == APPROVER and isinstance(environments, list)
                and any(isinstance(item, dict) and item.get('name') == ENVIRONMENT for item in environments)):
            return
    raise Refusal('{} has not approved this run in {}'.format(APPROVER, ENVIRONMENT))


def validate_receipt(receipt):
    if set(receipt) != RECEIPT_KEYS:
        raise Refusal('unexpected receipt fields')
    if type(receipt['version']) is not int or receipt['version'] != 1:
        raise Refusal('unsupported receipt version')
    if not _full(COMMIT, receipt['commit']) or not _full(RUN_ID, receipt['runId']):
        raise Refusal('malformed receipt identity')
    if receipt['installation'] != 'existing':
        raise Refusal('the agent releases only an existing installation')
    for field, pattern in IMAGES.items():
        if not _full(pattern, receipt[field]):
            raise Refusal('unpinned {} image'.format(field))
    files = receipt['files']
    if not isinstance(files, dict) or set(files) != set(FILES):
        raise Refusal('unexpected receipt file set')
    if not all(_full(SHA256, digest) for digest in files.values()):
        raise Refusal('malformed file digest')
    return receipt


def read_receipt_archive(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        members = archive.infolist()
        if len(members) != 1:
            raise Refusal('the release request must hold exactly one receipt')
        member = members[0]
        name = RECEIPT_NAME.fullmatch(member.filename)
        if name is None or member.is_dir() or member.file_size > MAX_RECEIPT_BYTES:
            raise Refusal('unexpected receipt file in the release request')
        with archive.open(member) as handle:
            content = handle.read(MAX_RECEIPT_BYTES + 1)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, zlib.error, NotImplementedError, ValueError,
            OSError, RuntimeError, EOFError) as error:
        raise Refusal('unreadable release request') from error
    if len(content) > MAX_RECEIPT_BYTES:
        raise Refusal('receipt too large')
    receipt = validate_receipt(parse_json(content))
    if (receipt['commit'], receipt['runId']) != name.groups():
        raise Refusal('receipt name differs from its content')
    return receipt


def check_ci_run(github, receipt):
    run = github.get('/repos/{}/actions/runs/{}'.format(REPOSITORY, receipt['runId']))
    if not (run.get('path') == CI_WORKFLOW and run.get('event') == 'push' and run.get('head_branch') == 'main'
            and run.get('head_sha') == receipt['commit'] and run.get('status') == 'completed'
            and run.get('conclusion') == 'success' and _repo(run.get('repository')) == REPOSITORY
            and _repo(run.get('head_repository')) == REPOSITORY):
        raise Refusal('the receipt does not name a successful main CI run of this commit')


def ensure_still_waiting(github, run_id, attempt, head):
    """Right before the runner changes anything: the job still waits and main has not moved."""
    run = github.get('/repos/{}/actions/runs/{}'.format(REPOSITORY, run_id))
    if run.get('status') != 'in_progress' or run.get('run_attempt') != attempt:
        raise Refusal('the deploy run no longer waits for this release')
    if run.get('head_sha') != head or main_head(github) != head:
        raise Refusal('main moved on during the release')


# The agent's own clone of the repository, fetched at the approved commit only.

def _git(cfg, *args, run=subprocess.run):
    environment = {'PATH': SAFE_PATH, 'HOME': str(cfg.state_dir), 'LANG': 'C.UTF-8',
                   'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    try:
        result = run(['git', '-C', str(cfg.repo_dir)] + list(args), env=environment, stdin=subprocess.DEVNULL,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=GIT_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Unavailable('git {} failed: {}'.format(args[0], error)) from None
    if result.returncode != 0:
        detail = result.stderr.decode('utf-8', 'replace').strip().splitlines()
        raise Unavailable('git {} failed: {}'.format(args[0], detail[-1] if detail else result.returncode))
    return result.stdout.decode('utf-8', 'replace').strip()


def checkout(cfg, commit):
    check_trusted_dir(cfg.repo_dir, cfg, private=True)
    if _git(cfg, 'remote', 'get-url', 'origin') != cfg.clone_url:
        raise Refusal('the agent clone fetches from an unexpected remote')
    _git(cfg, 'fetch', '--quiet', '--no-tags', '--depth=1', 'origin', commit)
    _git(cfg, 'checkout', '--quiet', '--force', '--detach', commit)
    _git(cfg, 'clean', '-qffdx')
    if _git(cfg, 'rev-parse', 'HEAD') != commit:
        raise Refusal('the agent clone is not at the approved commit')


def verify_checkout(cfg, receipt):
    for name, relative in sorted(FILES.items()):
        _, content = read_regular_file(cfg.repo_dir / relative)
        if hashlib.sha256(content).hexdigest() != receipt['files'][name]:
            raise Refusal('{} of this commit differs from the approved receipt'.format(relative))


def check_runtime(cfg):
    """The runner reads and writes throughout the runtime directory as root."""
    check_trusted_tree(cfg.runtime_dir, cfg, APPLICATION_OWNED)
    for name in RUNTIME_FILES:
        read_trusted_file(cfg.runtime_dir / name, cfg)
    if not os.path.lexists(str(cfg.runtime_dir / '.release-managed-env')):
        read_trusted_file(cfg.runtime_dir / '.env', cfg)
    # Registry login stays in its dedicated directory, without plugins of its own.
    if os.path.lexists(str(cfg.docker_config_dir)):
        check_trusted_tree(cfg.docker_config_dir, cfg)
        if os.path.lexists(str(cfg.docker_config_dir / 'cli-plugins')):
            raise Refusal('registry configuration must not contain CLI plugins')
        settings = cfg.docker_config_dir / 'config.json'
        if os.path.lexists(str(settings)):
            value = parse_json(read_trusted_file(settings, cfg))
            if value.get('cliPluginsExtraDirs', [SNAP_PLUGINS_DIR]) != [SNAP_PLUGINS_DIR]:
                raise Refusal('unapproved extra CLI plugin directory')


def runner_command(cfg, operation, receipt):
    """The fixed argv and complete environment of the release runner from the clone."""
    environment = {
        'PATH': SAFE_PATH, 'HOME': '/root', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
        'DOCKER_CONFIG': str(cfg.docker_config_dir),
        'RELEASE_ROOT': str(cfg.runtime_dir),
        'RELEASE_RUNTIME_FILE': str(cfg.runtime_dir / '.env.release'),
        'RELEASE_BACKUP_KEY_FILE': str(cfg.runtime_dir / '.backup-key'),
        'RELEASE_INSTALLATION': receipt['installation'],
        'RELEASE_POSTGRES_IMAGE': receipt['postgres'],
        'RELEASE_COMPOSE_FILE': str(cfg.repo_dir / FILES['compose']),
    }
    argv = ['/bin/bash', str(cfg.repo_dir / FILES['runner']), operation, receipt['commit']]
    if operation == 'deploy':
        argv += [receipt['backend'], receipt['frontend']]
    return argv, environment


class StopRequest:
    """SIGTERM (shutdown, systemctl stop, the unit's start timeout) asks the pass to stop.

    The agent does not die on it: systemd signals the runner too, and the runner's cleanup
    (the rollback to the previous pair) writes to the agent's pipe, so the agent keeps
    reading until the runner exits. It only starts nothing new.
    """

    def __init__(self):
        self.requested = False

    def __call__(self, signum, frame):
        self.requested = True

    def check(self):
        if self.requested:
            raise Refusal(STOPPING)


STOP = StopRequest()


def run_runner(argv, environment, log, popen=subprocess.Popen):
    """Stream the runner's output to the journal; return its exit code and last line."""
    STOP.check()
    last = ''
    process = popen(argv, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, cwd='/')
    for raw in process.stdout:
        line = raw.decode('utf-8', 'replace').rstrip()
        log(line)
        if line.strip():
            last = line.strip()
    return process.wait(), last


def release_lock_is_free(cfg):
    """Probe the runner's server lock (which the daily backup also takes) without keeping it."""
    try:
        descriptor = os.open(str(cfg.runtime_dir / '.release.lock'),
                             os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError as error:
        raise Refusal('the server release lock is unavailable') from error
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        return True
    except BlockingIOError:
        return False
    finally:
        os.close(descriptor)


def wait_for_release_lock(cfg, log, deadline, sleep=time.sleep):
    """Wait while the daily backup or another release holds the runner's server lock."""
    while True:
        STOP.check()
        if release_lock_is_free(cfg):
            return
        if time.monotonic() >= deadline:
            raise Refusal(LOCK_KEPT)
        log('Waiting for the server release lock (daily backup or another release)')
        sleep(cfg.lock_retry)


def ready_to_run(cfg, github, log, run_id, attempt, head, deadline, sleep):
    """The lock is free, the job still waits and main has not moved, all just now.

    This narrows, not closes, the window before the runner's own `flock -n`: a backup
    starting in the moment between this probe and the runner still fails the runner.
    """
    while True:
        wait_for_release_lock(cfg, log, deadline, sleep=sleep)
        ensure_still_waiting(github, run_id, attempt, head)
        # The check above takes a moment; the daily backup may have started meanwhile.
        if release_lock_is_free(cfg):
            return
        if time.monotonic() >= deadline:
            raise Refusal(LOCK_KEPT)


def _describe(text):
    text = re.sub(r'[^\x20-\x7e]', '', text).strip()
    return text[:140].rstrip() or 'No output'


def report(github, commit, run_id, state, description):
    github.post('/repos/{}/statuses/{}'.format(REPOSITORY, commit), {
        'state': state, 'context': STATUS_CONTEXT, 'description': _describe(description),
        'target_url': RUN_URL.format(run_id),
    })


# Run markers: one file per handled run attempt, named <mode>-<run id>-<attempt>, holding
# the outcome and whether GitHub has it. An existing marker means "never handle again".

def _runs_dir(cfg):
    directory = cfg.state_dir / 'runs'
    try:
        os.mkdir(str(directory), 0o700)
    except FileExistsError:
        pass
    check_trusted_dir(directory, cfg, private=True)
    return directory


def _marker(cfg, mode, run_id, attempt):
    return cfg.state_dir / 'runs' / '{}-{}-{}'.format(mode, run_id, attempt)


def _write_temporary(path, marker):
    temporary = path.with_name('.{}.{}'.format(path.name, os.getpid()))
    with contextlib.suppress(FileNotFoundError):
        os.unlink(str(temporary))
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump(marker, handle)
    return temporary


def claim(cfg, mode, run_id, attempt, marker):
    """Record a run attempt as handled; False when an earlier pass already handled it."""
    path = _runs_dir(cfg) / _marker(cfg, mode, run_id, attempt).name
    temporary = _write_temporary(path, marker)
    try:
        os.link(str(temporary), str(path))
        return True
    except FileExistsError:
        return False
    finally:
        os.unlink(str(temporary))


def update_marker(path, marker):
    os.replace(str(_write_temporary(path, marker)), str(path))


def read_marker(path):
    _, data = read_regular_file(path, MAX_RECEIPT_BYTES)
    marker = parse_json(data)
    if (set(marker) != {'commit', 'runId', 'state', 'description', 'reported'} or not _full(COMMIT, marker['commit'])
            or type(marker['runId']) is not int or marker['state'] not in MARKER_STATES
            or not isinstance(marker['description'], str) or type(marker['reported']) is not bool):
        raise Refusal('malformed run marker {}'.format(path.name))
    return marker


def deliver(github, log, path, marker):
    """Post a finished outcome; an unreachable GitHub leaves it for the next pass."""
    try:
        report(github, marker['commit'], marker['runId'], marker['state'], marker['description'])
    except (Unavailable, Refusal) as error:
        log('Could not report deploy run {} yet: {}'.format(marker['runId'], error))
        return
    update_marker(path, dict(marker, reported=True))


def deliver_pending_outcomes(cfg, github, log, now=time.time):
    """Report outcomes an earlier pass could not post, and releases a stopped pass left open."""
    directory = cfg.state_dir / 'runs'
    if not os.path.lexists(str(directory)):
        return
    _runs_dir(cfg)
    for name in sorted(os.listdir(str(directory))):
        path = directory / name
        if not name.startswith('active-') or now() - os.lstat(str(path)).st_mtime > MARKER_RETRY_SECONDS:
            continue
        try:
            marker = read_marker(path)
        except Refusal as refusal:
            log(str(refusal))
            continue
        if marker['reported']:
            continue
        if marker['state'] == 'started':
            # This pass holds the agent lock, so the pass that started it has stopped.
            marker = dict(marker, state='failure', description=STOPPED_DURING_RELEASE)
            update_marker(path, marker)
            log('Deploy run {}: {}'.format(marker['runId'], STOPPED_DURING_RELEASE))
        deliver(github, log, path, marker)


def _note_agent_version(cfg, log):
    try:
        installed = pathlib.Path(__file__).read_bytes()
        _, source = read_regular_file(cfg.repo_dir / AGENT_SOURCE)
    except (OSError, Refusal):
        return
    if installed != source:
        log('Note: this commit changes the agent itself; run scripts/deploy-agent-install.sh update from it')


def run_pass(cfg, github, mode, log, popen=subprocess.Popen, sleep=time.sleep):
    names = OBSERVED_ARTIFACTS if mode == 'observe' else (REQUEST_ARTIFACT,)
    if mode == 'active':
        deliver_pending_outcomes(cfg, github, log)
    head = main_head(github)
    for run in deploy_runs(github, mode):
        # Observe mode lists every status; a run still queued or waiting for approval is not news.
        if mode == 'observe' and run.get('status') not in ('in_progress', 'completed'):
            continue
        try:
            run_id, attempt, started = check_run(run, mode)
        except Refusal as refusal:
            log('Skipping deploy run {}: {}'.format(run.get('id'), refusal))
            continue
        # Observe mode reads finished runs too; only the head of main is of interest there.
        if os.path.lexists(str(_marker(cfg, mode, run_id, attempt))) or (mode == 'observe' and run['head_sha'] != head):
            continue
        try:
            artifact = find_request_artifact(github, run_id, started, names)
            if artifact is None:
                continue
            check_approval(github, run_id)
        except Refusal as refusal:
            log('Skipping deploy run {}: {}'.format(run_id, refusal))
            continue
        return handle(cfg, github, mode, log, run, artifact, head, popen, sleep)
    return 0


def handle(cfg, github, mode, log, run, artifact, head, popen, sleep):
    """Release (or, in observe mode, check) one approved request exactly once."""
    run_id, attempt = run['id'], run['run_attempt']
    path = _marker(cfg, mode, run_id, attempt)
    try:
        if run['head_sha'] != head:
            raise Refusal('commit {} is no longer the head of main'.format(run['head_sha'][:12]))
        receipt = read_receipt_archive(github.download(
            '/repos/{}/actions/artifacts/{}/zip'.format(REPOSITORY, artifact['id'])))
        if receipt['commit'] != head:
            raise Refusal('the receipt names another commit')
        check_ci_run(github, receipt)
        checkout(cfg, receipt['commit'])
        verify_checkout(cfg, receipt)
        check_runtime(cfg)
    except Refusal as refusal:
        # The run's own commit: that is where its waiting job looks, and the head of main
        # must not show a failure before its own run is even approved.
        description = 'Refused: {}'.format(refusal)
        marker = {'commit': run['head_sha'], 'runId': run_id, 'state': 'failure',
                  'description': _describe(description), 'reported': mode == 'observe'}
        if claim(cfg, mode, run_id, attempt, marker):
            log('Deploy run {} attempt {}: {}'.format(run_id, attempt, description))
            if mode == 'active':
                deliver(github, log, path, marker)
        return 2
    identity = 'commit {} (deploy run {} attempt {}, CI run {}, approved by {})'.format(
        head, run_id, attempt, receipt['runId'], APPROVER)
    if mode == 'observe':
        marker = {'commit': head, 'runId': run_id, 'state': 'observed', 'description': '', 'reported': True}
        if claim(cfg, mode, run_id, attempt, marker):
            _note_agent_version(cfg, log)
            log('Observe mode: would release {}: backend {}, frontend {}'.format(
                identity, receipt['backend'], receipt['frontend']))
        return 0
    marker = {'commit': head, 'runId': run_id, 'state': 'started', 'description': '', 'reported': False}
    if not claim(cfg, mode, run_id, attempt, marker):
        return 0
    _note_agent_version(cfg, log)
    log('Releasing {}'.format(identity))
    try:
        report(github, head, run_id, 'pending', 'Server release started')
    except (Unavailable, Refusal) as error:
        log('Could not report the start: {}'.format(error))
    try:
        # One lock wait for preflight and deploy together, so the deploy job's timeout can
        # cover it: deploy starts within LOCK_WAIT_SECONDS of the first wait or not at all.
        deadline = time.monotonic() + cfg.lock_wait
        ready_to_run(cfg, github, log, run_id, attempt, head, deadline, sleep)
        code, last = run_runner(*runner_command(cfg, 'preflight', receipt), log, popen=popen)
        if code == 0:
            ready_to_run(cfg, github, log, run_id, attempt, head, deadline, sleep)
            code, last = run_runner(*runner_command(cfg, 'deploy', receipt), log, popen=popen)
    except Refusal as refusal:
        code, last = 2, 'Refused: {}'.format(refusal)
        log(last)
    except Unavailable as error:
        # Without the final check, nothing is released.
        code, last = 2, 'Not released, GitHub unavailable for the final check: {}'.format(error)
        log(last)
    except OSError as error:
        code, last = 1, 'The release runner could not start: {}'.format(error)
        log(last)
    marker = dict(marker, state='success' if code == 0 else 'failure', description=_describe(last))
    update_marker(path, marker)
    log('Release {}: {}'.format('succeeded' if code == 0 else 'failed', identity))
    deliver(github, log, path, marker)
    return 0 if code == 0 else 1


def check(github, mode, log):
    """Use every read a release makes: the token must reach main, runs, approvals and artifacts."""
    head = main_head(github)
    data = github.get('/repos/{}/actions/workflows/cd.yml/runs?branch=main&per_page=1'.format(REPOSITORY))
    runs = data.get('workflow_runs')
    if isinstance(runs, list) and runs and isinstance(runs[0], dict) and type(runs[0].get('id')) is int:
        run_id = runs[0]['id']
        github.get('/repos/{}/actions/runs/{}/approvals'.format(REPOSITORY, run_id), kind=list)
        artifacts = github.get('/repos/{}/actions/runs/{}/artifacts?per_page=100'.format(REPOSITORY, run_id))
        for artifact in artifacts.get('artifacts') or []:
            if (isinstance(artifact, dict) and artifact.get('name') in OBSERVED_ARTIFACTS
                    and artifact.get('expired') is False and type(artifact.get('id')) is int):
                github.download('/repos/{}/actions/artifacts/{}/zip'.format(REPOSITORY, artifact['id']))
                log('Downloaded the release request of deploy run {}.'.format(run_id))
                break
    github.get('/repos/{}/commits/{}/statuses?per_page=1'.format(REPOSITORY, head), kind=list)
    log('GitHub access works: main is at {}; deploy runs, approvals, artifacts and commit statuses are readable. Mode: {}.'.format(head, mode))
    log('Writing the {} commit status is first used by an active release.'.format(STATUS_CONTEXT))
    return 0


@contextlib.contextmanager
def agent_lock(cfg):
    descriptor = os.open(str(cfg.state_dir / 'agent.lock'),
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        os.close(descriptor)


def _log(line):
    print(line, flush=True)


def main(argv=None, cfg=None, github=None, log=_log, popen=subprocess.Popen, sleep=time.sleep):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) > 1 or (argv and argv[0] not in ('run', 'check')):
        log('Usage: deploy-agent [run|check]')
        return 2
    command = argv[0] if argv else 'run'
    cfg = cfg or Config()
    try:
        if os.geteuid() != cfg.owner_uid:
            raise Refusal('run the agent as root')
        check_trusted_dir(cfg.state_dir, cfg, private=True)
        mode = read_mode(cfg)
        github = github or GitHub(read_token(cfg))
        if command == 'check':
            return check(github, mode, log)
        STOP.requested = False
        previous = signal.signal(signal.SIGTERM, STOP)
        try:
            with agent_lock(cfg) as acquired:
                if not acquired:
                    return 0
                return run_pass(cfg, github, mode, log, popen=popen, sleep=sleep)
        finally:
            signal.signal(signal.SIGTERM, previous)
    except Refusal as refusal:
        log('Refused: {}'.format(refusal))
        return 2
    except Unavailable as error:
        log('Unavailable: {}'.format(error))
        return 1


if __name__ == '__main__':
    sys.exit(main())
