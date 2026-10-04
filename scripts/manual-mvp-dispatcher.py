#!/usr/bin/python3 -I
"""Fixed server-side command for the restricted manual MVP SSH principal.

Installed root-owned and invoked only through an SSH forced command plus an exact
sudo rule without arguments. The client supplies one small JSON data request on
stdin; it never supplies commands, paths, images, environment or files. Image
digests, installation mode and reviewed server-file hashes come from an owner-
installed receipt for the exact requested commit and CI run (version 1), or from the
receipt promoted in the same environment-approved Actions job (version 2). A version 1
deploy consumes its receipt before the runner starts, so that approval cannot be
replayed; a version 2 request needs a new environment approval for every run. Either
way the installed server files must match the receipt, so only root decides what runs.
"""

import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys

MAX_REQUEST_BYTES = 4096
MAX_TRUSTED_FILE_BYTES = 1024 * 1024
MAX_TREE_ENTRIES = 100000

RELEASE_DIR = pathlib.Path('/usr/local/libexec/capital-tracker/release')
RECEIPTS_DIR = pathlib.Path('/etc/capital-tracker/release-receipts')
DOCKER_CONFIG_DIR = pathlib.Path('/etc/capital-tracker/docker-config')
RUNTIME_DIR = pathlib.Path('/var/snap/docker/common/capital-tracker')
RUNTIME_FILES = ('.env.release', '.backup-key')
# Bootstrap gives the container user (uid 1000, `node`) its MFA key and the operator
# output directory. Only these exact runtime paths may belong to that account; the
# runner never writes through them as root and symlinks remain refused everywhere.
APPLICATION_UID = 1000
APPLICATION_OWNED = ('.mfa-key', 'operator')
REGISTRY_NAMESPACE = 'pavelars'

# Installed names are fixed; the runner locates the normalizer beside itself.
FILES = {
    'runner': 'manual-mvp-release.sh',
    'inventory': 'manual-mvp-inventory.sh',
    'normalizer': 'normalize-release-snapshot.awk',
    'compose': 'docker-compose.yml',
    'pins': 'manual-mvp-infrastructure-pins.json',
    'resume': 'manual-mvp-resume.py',
}
OPERATIONS = ('inventory', 'preflight', 'deploy')
APPROVED_OPERATIONS = ('preflight', 'deploy')
INSTALLATIONS = ('existing', 'fresh', 'resume-fresh', 'resume-activation')
SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/docker/current/bin'
SNAP_PLUGINS_DIR = pathlib.Path('/snap/docker/current/usr/libexec/docker/cli-plugins')

COMMIT = re.compile(r'[a-f0-9]{40}')
RUN_ID = re.compile(r'[1-9][0-9]{0,19}')
SHA256 = re.compile(r'[a-f0-9]{64}')
APPLICATION_IMAGE = {
    name: re.compile(r'ghcr\.io/' + REGISTRY_NAMESPACE + '/capital-tracker-' + name + r'@sha256:[a-f0-9]{64}')
    for name in ('backend', 'frontend')
}
INFRASTRUCTURE_IMAGE = {
    'postgres': re.compile(r'ghcr\.io/' + REGISTRY_NAMESPACE + r'/capital-tracker-postgres@sha256:[a-f0-9]{64}'),
    'redis': re.compile(r'redis@sha256:[a-f0-9]{64}'),
}

REQUEST_KEYS = {'version', 'operation', 'commit', 'runId'}
APPROVED_REQUEST_KEYS = REQUEST_KEYS | {'receipt'}
RECEIPT_KEYS = {
    'version', 'commit', 'runId', 'installation',
    'backend', 'frontend', 'postgres', 'redis', 'files',
}
RESUME_ORIGIN = {
    'commit': '0f479b3955aba1cf351a29e897c7ffbdc9909638',
    'ciRunId': '36900868365',
    'usedReceiptSha256': '56db9c19cfc8f5c5d08359e5f53f9c2122f369857123172f1e29168f4d61ebc3',
}
RESUME_POSTGRES = 'ghcr.io/pavelars/capital-tracker-postgres@sha256:c6a966be9561266a345c4c705a01a20fb82a061c3827e95b39e7127f7527f58f'


class Refusal(Exception):
    pass


def _reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Refusal('duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(name):
    raise Refusal('non-finite JSON number')


def parse_json(data):
    if not isinstance(data, bytes):
        raise Refusal('expected bytes')
    try:
        text = data.decode('utf-8')
        # json.loads rejects any trailing value after optional whitespace.
        value = json.loads(text, object_pairs_hook=_reject_duplicates, parse_constant=_reject_constant)
    except Refusal:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise Refusal('malformed JSON') from error
    if not isinstance(value, dict):
        raise Refusal('expected JSON object')
    return value


def _is_int(value, expected):
    return type(value) is int and value == expected


def _full(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def read_request(stream):
    data = stream.read(MAX_REQUEST_BYTES + 1)
    if len(data) > MAX_REQUEST_BYTES:
        raise Refusal('request too large')
    request = parse_json(data)
    approved = _is_int(request.get('version'), 2)
    if set(request) != (APPROVED_REQUEST_KEYS if approved else REQUEST_KEYS):
        raise Refusal('unexpected request fields')
    if not (approved or _is_int(request['version'], 1)):
        raise Refusal('unsupported request version')
    if request['operation'] not in (APPROVED_OPERATIONS if approved else OPERATIONS):
        raise Refusal('unapproved operation')
    if approved and not isinstance(request['receipt'], dict):
        raise Refusal('independent release receipt required')
    if not _full(COMMIT, request['commit']):
        raise Refusal('malformed commit')
    if not _full(RUN_ID, request['runId']):
        raise Refusal('malformed run id')
    return request


def validate_receipt(request, receipt):
    if not isinstance(receipt, dict):
        raise Refusal('independent release receipt required')
    resume = receipt.get('installation') == 'resume-fresh'
    if set(receipt) != (RECEIPT_KEYS | {'resumeOrigin'} if resume else RECEIPT_KEYS):
        raise Refusal('unexpected receipt fields')
    if not _is_int(receipt['version'], 1):
        raise Refusal('unsupported receipt version')
    if receipt['commit'] != request['commit'] or receipt['runId'] != request['runId']:
        raise Refusal('receipt belongs to another commit or run')
    if receipt['installation'] not in INSTALLATIONS:
        raise Refusal('unapproved installation mode')
    if resume and (receipt['commit'] == RESUME_ORIGIN['commit'] or receipt['runId'] == RESUME_ORIGIN['ciRunId']):
        raise Refusal('resume requires a distinct candidate approval')
    if resume and (receipt['resumeOrigin'] != RESUME_ORIGIN or receipt['postgres'] != RESUME_POSTGRES):
        raise Refusal('resume receipt differs from the interrupted installation')
    for field, pattern in APPLICATION_IMAGE.items():
        if not _full(pattern, receipt[field]):
            raise Refusal('unpinned application image')
    for field, pattern in INFRASTRUCTURE_IMAGE.items():
        if not _full(pattern, receipt[field]):
            raise Refusal('unpinned infrastructure image')
    files = receipt['files']
    if not isinstance(files, dict) or set(files) != set(FILES):
        raise Refusal('unexpected receipt file set')
    for digest in files.values():
        if not _full(SHA256, digest):
            raise Refusal('malformed file digest')
    return receipt


def _check_owner_and_mode(info, owner_uid):
    if info.st_uid not in (owner_uid, 0):
        raise Refusal('untrusted owner')
    if info.st_mode & 0o022:
        raise Refusal('group or world writable')


def _normalized(path):
    path = pathlib.Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise Refusal('trusted path must be absolute and normalized')
    return path


def _check_ancestors(path, owner_uid, stop_at):
    stop = pathlib.Path(stop_at) if stop_at is not None else None
    for parent in path.parents:
        parent_info = os.lstat(parent)
        if not stat.S_ISDIR(parent_info.st_mode):
            raise Refusal('trusted ancestor is not a directory')
        _check_owner_and_mode(parent_info, owner_uid)
        if stop is not None and parent == stop:
            return
    if stop is not None:
        raise Refusal('trusted boundary is not an ancestor')


def check_trusted_tree(path, owner_uid, stop_at=None, application_owned=(), application_uid=None):
    """Require a directory whose whole subtree only the owner (or root) can change.

    Every entry must be a non-symlink directory or regular file, owner/root-owned and
    not group/world writable, so a privileged process cannot be redirected through it.
    Top-level names in ``application_owned`` (and their subtrees) may instead belong to
    ``application_uid``; they are still symlink-free and not group/world writable.
    """
    path = _normalized(path)
    try:
        info = os.lstat(path)
        if not stat.S_ISDIR(info.st_mode):
            raise Refusal('trusted path is not a directory')
        _check_owner_and_mode(info, owner_uid)
        _check_ancestors(path, owner_uid, stop_at)
        count = 0
        pending = [(str(path), False)]
        while pending:
            directory, delegated = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    count += 1
                    if count > MAX_TREE_ENTRIES:
                        raise Refusal('trusted tree too large')
                    entry_info = entry.stat(follow_symlinks=False)
                    entry_delegated = delegated or (directory == str(path) and entry.name in application_owned)
                    if stat.S_ISDIR(entry_info.st_mode):
                        pending.append((entry.path, entry_delegated))
                    elif not stat.S_ISREG(entry_info.st_mode):
                        raise Refusal('untrusted entry type in {}'.format(directory))
                    allowed = application_uid if entry_delegated and application_uid is not None else owner_uid
                    try:
                        _check_owner_and_mode(entry_info, allowed)
                    except Refusal as refusal:
                        raise Refusal('{}: {}'.format(entry.path, refusal))
    except OSError as error:
        raise Refusal('trusted tree unavailable') from error


def check_trusted_file(path, owner_uid, stop_at=None):
    """Return the SHA256 of a regular file that only the owner (or root) can replace.

    The file and every ancestor up to ``stop_at`` (or ``/``) must be non-symlink,
    owner/root-owned and not group/world writable. Content is hashed through a
    descriptor opened without following links and matched to the checked inode.
    """
    path = _normalized(path)
    try:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode):
            raise Refusal('trusted path is not a regular file')
        _check_owner_and_mode(info, owner_uid)
        _check_ancestors(path, owner_uid, stop_at)
        descriptor = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0))
    except OSError as error:
        raise Refusal('trusted file unavailable') from error
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino) or not stat.S_ISREG(opened.st_mode):
            raise Refusal('trusted file changed during verification')
        chunks = []
        size = 0
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_TRUSTED_FILE_BYTES:
                raise Refusal('trusted file too large')
            chunks.append(chunk)
    finally:
        os.close(descriptor)
    content = b''.join(chunks)
    return hashlib.sha256(content).hexdigest(), content


class Config:
    def __init__(self, release_dir=RELEASE_DIR, receipts_dir=RECEIPTS_DIR,
                 docker_config_dir=DOCKER_CONFIG_DIR, owner_uid=0, stop_at=None,
                 runtime_dir=RUNTIME_DIR, application_uid=APPLICATION_UID):
        self.release_dir = pathlib.Path(release_dir)
        self.receipts_dir = pathlib.Path(receipts_dir)
        self.docker_config_dir = pathlib.Path(docker_config_dir)
        self.owner_uid = owner_uid
        self.stop_at = stop_at
        self.runtime_dir = pathlib.Path(runtime_dir)
        self.application_uid = application_uid


def _installed(config, name):
    return config.release_dir / FILES[name]


def _receipt_path(request, config):
    return config.receipts_dir / '{}-{}.json'.format(request['commit'], request['runId'])


def load_receipt(request, config):
    path = _receipt_path(request, config)
    if not os.path.lexists(str(path)):
        raise Refusal('independent release receipt required')
    _, content = check_trusted_file(path, config.owner_uid, config.stop_at)
    return validate_receipt(request, parse_json(content))


def consume_receipt(request, config):
    """Move an approved receipt out of reach before deploying; retries need re-approval."""
    path = _receipt_path(request, config)
    used = config.receipts_dir / 'used'
    try:
        if not os.path.lexists(str(used)):
            os.mkdir(str(used), 0o700)
        check_trusted_tree(used, config.owner_uid, config.stop_at)
        os.replace(str(path), str(used / path.name))
    except OSError as error:
        raise Refusal('approved receipt could not be consumed') from error


def verify_installation(receipt, config):
    """Every reviewed server file must match the receipt; pins must match its images."""
    for name, expected in sorted(receipt['files'].items()):
        digest, content = check_trusted_file(_installed(config, name), config.owner_uid, config.stop_at)
        if digest != expected:
            raise Refusal('installed {} differs from the reviewed receipt'.format(name))
        if name == 'pins':
            pins = parse_json(content)
            source = pins.get('postgres')
            if (not isinstance(source, dict)
                    or set(source) != {'tag', 'dockerfile', 'dockerfileSha256', 'baseRegistryDigest', 'registryDigest', 'originRevision'}
                    or source['tag'] != 'capital-tracker-postgres:acceptance'
                    or source['dockerfile'] != 'deploy/postgres.Dockerfile'
                    or not _full(SHA256, source['dockerfileSha256'])
                    or source['baseRegistryDigest'] != 'postgres@sha256:d8703cd7fba306b9fec9268ecedfa8a966846c053036a60e3635791957eb2f66'
                    or source['registryDigest'] != RESUME_POSTGRES
                    or source['originRevision'] != RESUME_ORIGIN['commit']
                    or pins.get('resumeOrigin') != RESUME_ORIGIN):
                raise Refusal('invalid reviewed PostgreSQL source pins')
            if receipt['installation'] == 'resume-fresh' and receipt['postgres'] != source['registryDigest']:
                raise Refusal('resume PostgreSQL differs from reviewed original')
            # The derived PostgreSQL digest comes from owner approval, never its base pin.
            # The hash above binds the separately reviewed source inputs.
            for service in ('redis',):
                entry = pins.get(service)
                if not isinstance(entry, dict) or entry.get('registryDigest') != receipt[service]:
                    raise Refusal('receipt infrastructure differs from reviewed pins')


def check_snap_plugins(config):
    """Allow only the root-managed Snap revision link, then verify its real tree."""
    path = SNAP_PLUGINS_DIR
    revision = path.parents[3]  # /snap/docker/current, the one system-managed link.
    stop = pathlib.Path(config.stop_at) if config.stop_at is not None else pathlib.Path('/')
    try:
        chain = [path] + list(path.parents)
        for component in chain:
            info = os.lstat(component)
            if component == revision and stat.S_ISLNK(info.st_mode):
                if info.st_uid not in (0, config.owner_uid):
                    raise Refusal('untrusted Snap revision owner')
            else:
                if not stat.S_ISDIR(info.st_mode):
                    raise Refusal('untrusted Snap plugin ancestor')
                _check_owner_and_mode(info, config.owner_uid)
            if component == stop:
                break
        else:
            raise Refusal('trusted boundary is not an ancestor')
        check_trusted_tree(path.resolve(strict=True), config.owner_uid, config.stop_at)
        native = (revision / 'bin/docker').resolve(strict=True)
        info = os.lstat(native)
        if not stat.S_ISREG(info.st_mode):
            raise Refusal('untrusted native Snap client')
        _check_owner_and_mode(info, config.owner_uid)
        _check_ancestors(native, config.owner_uid, config.stop_at)
    except OSError as error:
        raise Refusal('trusted Snap plugins unavailable') from error


def check_registry_config(config):
    # Never use root's general registry login or plugins from the private config.
    if os.path.lexists(str(SNAP_PLUGINS_DIR.parents[3] / 'bin/docker')):
        check_snap_plugins(config)
    if not os.path.lexists(str(config.docker_config_dir)):
        return
    check_trusted_tree(config.docker_config_dir, config.owner_uid, config.stop_at)
    if os.path.lexists(str(config.docker_config_dir / 'cli-plugins')):
        raise Refusal('registry configuration must not contain CLI plugins')
    settings = config.docker_config_dir / 'config.json'
    if os.path.lexists(str(settings)):
        _, content = check_trusted_file(settings, config.owner_uid, config.stop_at)
        value = parse_json(content)
        if 'cliPluginsExtraDirs' in value:
            if value['cliPluginsExtraDirs'] != [str(SNAP_PLUGINS_DIR)]:
                raise Refusal('unapproved extra CLI plugin directory')
            check_snap_plugins(config)


def build_command(request, config, receipt=None):
    """Return the fixed argv and complete environment for an approved request."""
    environment = {'PATH': SAFE_PATH, 'HOME': '/root', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
                   'DOCKER_CONFIG': str(config.docker_config_dir), 'RELEASE_ROOT': str(config.runtime_dir)}
    check_registry_config(config)
    if request['operation'] == 'inventory':
        check_trusted_file(_installed(config, 'inventory'), config.owner_uid, config.stop_at)
        return ['/bin/bash', str(_installed(config, 'inventory'))], environment
    if receipt is None:
        raise Refusal('independent release receipt required')
    verify_installation(receipt, config)
    # The privileged runner reads and writes throughout the runtime directory, so no
    # other account may own or be able to redirect any entry there.
    check_trusted_tree(config.runtime_dir, config.owner_uid, config.stop_at,
                       APPLICATION_OWNED, config.application_uid)
    for name in RUNTIME_FILES:
        check_trusted_file(config.runtime_dir / name, config.owner_uid, config.stop_at)
    if receipt['installation'] == 'existing' and not os.path.lexists(str(config.runtime_dir / '.release-managed-env')):
        check_trusted_file(config.runtime_dir / '.env', config.owner_uid, config.stop_at)
    environment.update({
        'RELEASE_ROOT': str(config.runtime_dir),
        'RELEASE_RUNTIME_FILE': str(config.runtime_dir / '.env.release'),
        'RELEASE_BACKUP_KEY_FILE': str(config.runtime_dir / '.backup-key'),
        'RELEASE_INSTALLATION': receipt['installation'],
        'RELEASE_POSTGRES_IMAGE': receipt['postgres'],
        'RELEASE_REDIS_IMAGE': receipt['redis'],
        'RELEASE_COMPOSE_FILE': str(_installed(config, 'compose')),
        'RELEASE_RESUME_HELPER': str(_installed(config, 'resume')),
        'RELEASE_PINS_FILE': str(_installed(config, 'pins')),
        'RELEASE_USED_RECEIPTS_DIR': str(config.receipts_dir / 'used'),
    })
    argv = ['/bin/bash', str(_installed(config, 'runner')), request['operation'], request['commit']]
    if request['operation'] == 'deploy':
        argv += [receipt['backend'], receipt['frontend']]
    return argv, environment


def dispatch(request, config, run):
    approved = request['version'] == 2
    if approved:
        # The environment-approved job promoted this receipt; it never touches owner receipts.
        receipt = validate_receipt(request, request['receipt'])
    else:
        receipt = None if request['operation'] == 'inventory' else load_receipt(request, config)
    argv, environment = build_command(request, config, receipt)
    if request['operation'] == 'deploy' and not approved:
        consume_receipt(request, config)
    return run(argv, environment)


def _run(argv, environment):
    return subprocess.run(argv, env=environment, stdin=subprocess.DEVNULL, cwd='/', check=False).returncode


def main(argv=None, stdin=None):
    argv = sys.argv if argv is None else argv
    stdin = sys.stdin.buffer if stdin is None else stdin
    try:
        if len(argv) != 1:
            raise Refusal('arguments are not accepted')
        if os.geteuid() != 0:
            raise Refusal('dispatcher must run through its exact sudo rule')
        request = read_request(stdin)
        print('dispatch operation={} commit={} run={}'.format(
            request['operation'], request['commit'], request['runId']), file=sys.stderr, flush=True)
        return dispatch(request, Config(), _run)
    except Refusal as refusal:
        print('refused: {}'.format(refusal), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
