#!/usr/bin/python3 -I
"""Read-only proof of the one interrupted first installation; no Docker mutation."""

import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys

PROJECT = 'capital-tracker'
CONTAINERS = {'capital_tracker_db': 'postgres', 'capital_tracker_redis': 'redis'}
VOLUMES = {'capital-tracker_postgres_data': 'postgres_data', 'capital-tracker_redis_data': 'redis_data'}
NETWORK = 'capital-tracker_capital-tracker-network'
APP_CONTAINERS = {'capital_tracker_backend': 'backend', 'capital_tracker_frontend': 'frontend'}
RECEIPT_FIELDS = {'version', 'commit', 'runId', 'installation', 'backend', 'frontend',
                  'postgres', 'redis', 'files'}
OLD_FILES = {'runner', 'inventory', 'normalizer', 'compose', 'pins'}
ALLOWED_ROOT = {'.env.release', '.backup-key', '.mfa-key', '.owner-password.json',
                'operator', 'capital-vhost-before.conf', '.release.lock', 'releases', 'backups'}
REQUIRED_ROOT = {'.env.release', '.backup-key', '.mfa-key', '.owner-password.json',
                 'operator', '.release.lock', 'releases', 'backups'}
RUNTIME_KEYS = {'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'POSTGRES_IMAGE',
                'POSTGRES_EXPECTED_MAJOR', 'POSTGRES_VOLUME_TARGET', 'REDIS_IMAGE',
                'FRONTEND_URL', 'BACKEND_HOST_PORT', 'FRONTEND_HOST_PORT',
                'MFA_KEY_FILE', 'MFA_KEY_ID', 'TRUSTED_PROXY_IPS', 'OWNER_EMAIL',
                'BACKGROUND_JOBS_ENABLED', 'DISPLAY_FX_ENABLED'}
STATE_NAME = re.compile(r'\d{8}T\d{6}Z-\d+')
BACKUP_NAME = re.compile(r'[a-f0-9]{40}-\d{8}T\d{6}Z\.dump\.enc')


class Refusal(Exception):
    pass


def trusted_file(path):
    path = pathlib.Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise Refusal('untrusted historical receipt path')
    for component in (path, *path.parents):
        try:
            info = os.lstat(component)
        except OSError as error:
            raise Refusal('historical receipt unavailable') from error
        if (not (stat.S_ISREG(info.st_mode) if component == path else stat.S_ISDIR(info.st_mode))
                or info.st_uid != 0 or info.st_mode & 0o022):
            raise Refusal('untrusted historical receipt path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (os.lstat(path).st_dev, os.lstat(path).st_ino):
            raise Refusal('historical receipt changed while reading')
        content = os.read(descriptor, 65537)
        if len(content) > 65536:
            raise Refusal('historical receipt too large')
        return content
    finally:
        os.close(descriptor)


def no_duplicate_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Refusal('duplicate historical receipt key')
        value[key] = item
    return value


def historical_receipt(used_dir, pins):
    origin = pins['resumeOrigin']
    path = pathlib.Path(used_dir) / '{}-{}.json'.format(origin['commit'], origin['ciRunId'])
    raw = trusted_file(path)
    if hashlib.sha256(raw).hexdigest() != origin['usedReceiptSha256']:
        raise Refusal('historical consumed receipt hash differs')
    try:
        receipt = json.loads(raw, object_pairs_hook=no_duplicate_keys)
    except (ValueError, UnicodeDecodeError) as error:
        raise Refusal('historical receipt malformed') from error
    if (not isinstance(receipt, dict) or set(receipt) != RECEIPT_FIELDS
            or receipt['version'] != 1 or type(receipt['version']) is not int
            or receipt['commit'] != origin['commit'] or receipt['runId'] != origin['ciRunId']
            or receipt['installation'] != 'fresh'
            or receipt['postgres'] != pins['postgres']['registryDigest']
            or receipt['redis'] != pins['redis']['registryDigest']
            or not isinstance(receipt['files'], dict) or set(receipt['files']) != OLD_FILES
            or any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
                   for value in receipt['files'].values())):
        raise Refusal('historical consumed receipt has the wrong identity')
    return receipt


def runtime_settings(root):
    settings = {}
    for line in (pathlib.Path(root) / '.env.release').read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in settings:
            raise Refusal('invalid runtime configuration')
        settings[key] = value
    fixed = {'DB_USERNAME': 'capital_owner', 'DB_NAME': 'capital_tracker',
             'POSTGRES_EXPECTED_MAJOR': '18', 'POSTGRES_VOLUME_TARGET': '/var/lib/postgresql',
             'FRONTEND_URL': 'https://capital.pavelars.ru', 'BACKEND_HOST_PORT': '3100',
             'FRONTEND_HOST_PORT': '3101', 'MFA_KEY_FILE': str(pathlib.Path(root) / '.mfa-key'),
             'MFA_KEY_ID': 'capital-production-1', 'OWNER_EMAIL': 'owner@capital.pavelars.ru',
             'BACKGROUND_JOBS_ENABLED': 'false', 'DISPLAY_FX_ENABLED': 'false'}
    if set(settings) != RUNTIME_KEYS or any(settings.get(key) != value for key, value in fixed.items()) \
            or not re.fullmatch(r'[a-f0-9]{64}', settings.get('DB_PASSWORD', '')):
        raise Refusal('unexpected bootstrap database identity')
    return settings


def runtime_residue(root, pins, owner_uid=0):
    root = pathlib.Path(root)
    origin = pins['resumeOrigin']
    names = {entry.name for entry in root.iterdir()}
    if not REQUIRED_ROOT <= names or not names <= ALLOWED_ROOT:
        raise Refusal('unexpected or missing interrupted runtime entry')
    if any((root / name).is_symlink() for name in names):
        raise Refusal('linked runtime entry')
    if not (root / 'operator').is_dir() or any((root / 'operator').iterdir()):
        raise Refusal('operator state already exists')
    releases = root / 'releases'
    if releases.is_symlink() or not releases.is_dir() or {entry.name for entry in releases.iterdir()} != {origin['commit']}:
        raise Refusal('release state differs from interrupted attempt')
    states = list((releases / origin['commit']).iterdir())
    if not states or any(entry.is_symlink() or not entry.is_dir() or not STATE_NAME.fullmatch(entry.name)
                         or any(entry.iterdir()) for entry in states):
        raise Refusal('interrupted release state contains writes or unknown files')
    backups = root / 'backups'
    if backups.is_symlink() or not backups.is_dir():
        raise Refusal('missing encrypted backup directory')
    backup_names = {entry.name for entry in backups.iterdir()}
    dumps = {name for name in backup_names if BACKUP_NAME.fullmatch(name)
             and name.startswith(origin['commit'] + '-')}
    if not dumps or backup_names != dumps | {name + '.sha256' for name in dumps}:
        raise Refusal('interrupted encrypted backup set differs')
    for name in dumps:
        encrypted = backups / name
        checksum = backups / (name + '.sha256')
        if (not encrypted.is_file() or not checksum.is_file() or encrypted.is_symlink() or checksum.is_symlink()
                or encrypted.stat().st_uid != owner_uid or checksum.stat().st_uid != owner_uid
                or encrypted.stat().st_mode & 0o022 or checksum.stat().st_mode & 0o022):
            raise Refusal('untrusted encrypted backup entry')
        try:
            digest, recorded_path = checksum.read_text().strip().split(maxsplit=1)
        except ValueError as error:
            raise Refusal('invalid encrypted backup checksum') from error
        if recorded_path != str(encrypted) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise Refusal('encrypted backup checksum identity differs')
        with encrypted.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != digest:
            raise Refusal('encrypted backup checksum mismatch')
    settings = runtime_settings(root)
    if (settings.get('POSTGRES_IMAGE') != pins['postgres']['registryDigest']
            or settings.get('REDIS_IMAGE') != pins['redis']['registryDigest']):
        raise Refusal('runtime infrastructure references differ')
    try:
        peers = json.loads(settings['TRUSTED_PROXY_IPS'])
    except (KeyError, ValueError) as error:
        raise Refusal('missing recorded proxy peer') from error
    if (not isinstance(peers, list) or len(peers) != 1 or not isinstance(peers[0], str)
            or not re.fullmatch(r'(?:::ffff:)?(?:\d{1,3}\.){3}\d{1,3}', peers[0])
            or any(int(part) > 255 for part in peers[0].removeprefix('::ffff:').split('.'))):
        raise Refusal('invalid recorded proxy peer')
    return peers[0]


def docker(*args):
    result = subprocess.run(['docker', *args], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, check=False)
    if result.returncode:
        raise Refusal('Docker read-only inventory failed')
    return result.stdout.strip()


def docker_json(*args):
    try:
        value = json.loads(docker(*args))
    except ValueError as error:
        raise Refusal('Docker inspection returned malformed metadata') from error
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise Refusal('Docker inspection returned unexpected metadata')
    return value[0]


def resources(postgres_ref, redis_ref, root, allow_apps=False):
    expected_containers = set(CONTAINERS) | (set(APP_CONTAINERS) if allow_apps else set())
    if ({name for name in docker('ps', '-a', '--format', '{{.Names}}').splitlines()
         if name.startswith('capital_tracker_')} != expected_containers
            or set(docker('ps', '-a', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                          '--format', '{{.Names}}').splitlines()) != expected_containers
            or {name for name in docker('volume', 'ls', '--format', '{{.Name}}').splitlines()
                if 'capital' in name.lower() or 'tracker' in name.lower()} != set(VOLUMES)
            or set(docker('volume', 'ls', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                          '--format', '{{.Name}}').splitlines()) != set(VOLUMES)
            or {name for name in docker('network', 'ls', '--format', '{{.Name}}').splitlines()
                if 'capital' in name.lower() or 'tracker' in name.lower()} != {NETWORK}
            or set(docker('network', 'ls', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                          '--format', '{{.Name}}').splitlines()) != {NETWORK}):
        raise Refusal('application resource inventory differs')
    network = docker_json('network', 'inspect', NETWORK)
    if network.get('Name') != NETWORK or network.get('Labels', {}).get('com.docker.compose.project') != PROJECT \
            or network.get('Labels', {}).get('com.docker.compose.network') != 'capital-tracker-network':
        raise Refusal('application network identity differs')
    snapshot = {'network': [network.get('Id'), network.get('Created')]}
    identities = {}
    for name, service in CONTAINERS.items():
        container = docker_json('inspect', name)
        image_ref = postgres_ref if service == 'postgres' else redis_ref
        image = docker_json('image', 'inspect', image_ref)
        target = '/var/lib/postgresql' if service == 'postgres' else '/data'
        volume_name = 'capital-tracker_{}_data'.format(service)
        mounts = container.get('Mounts')
        if service == 'postgres':
            environment = container.get('Config', {}).get('Env', [])
            if not isinstance(environment, list):
                raise Refusal('PostgreSQL container environment is malformed')
            actual_env = {}
            for item in environment:
                key, separator, value = item.partition('=')
                if separator and key in ('POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD'):
                    if key in actual_env:
                        raise Refusal('duplicate PostgreSQL environment identity')
                    actual_env[key] = value
            settings = runtime_settings(root)
            if actual_env != {'POSTGRES_USER': settings['DB_USERNAME'], 'POSTGRES_DB': settings['DB_NAME'],
                              'POSTGRES_PASSWORD': settings['DB_PASSWORD']}:
                raise Refusal('runtime and PostgreSQL environment identities differ')
        if (container.get('Name') != '/' + name or container.get('Image') != image.get('Id')
                or container.get('Config', {}).get('Image') != image_ref
                or container.get('Config', {}).get('Labels', {}).get('com.docker.compose.project') != PROJECT
                or container.get('Config', {}).get('Labels', {}).get('com.docker.compose.service') != service
                or container.get('State', {}).get('Running') is not True
                or container.get('State', {}).get('Health', {}).get('Status') != 'healthy'
                or not isinstance(mounts, list) or len(mounts) != 1
                or mounts[0].get('Type') != 'volume' or mounts[0].get('Name') != volume_name
                or mounts[0].get('Destination') != target
                or set(container.get('NetworkSettings', {}).get('Networks', {})) != {NETWORK}
                or container['NetworkSettings']['Networks'][NETWORK].get('NetworkID') != network.get('Id')):
            raise Refusal('running infrastructure identity or health differs')
        volume = docker_json('volume', 'inspect', volume_name)
        if (volume.get('Name') != volume_name or volume.get('Driver') != 'local'
                or volume.get('Options') not in (None, {}) or volume.get('Scope') != 'local'
                or mounts[0].get('Source') != volume.get('Mountpoint')
                or volume.get('Labels', {}).get('com.docker.compose.project') != PROJECT
                or volume.get('Labels', {}).get('com.docker.compose.volume') != service + '_data'):
            raise Refusal('infrastructure volume identity differs')
        identities[name] = [container.get('Id'), container.get('Image'), volume.get('CreatedAt'),
                            volume.get('Mountpoint')]
    connected = {identities[name][0] for name in CONTAINERS}
    if allow_apps:
        for name, service in APP_CONTAINERS.items():
            app = docker_json('inspect', name)
            if (app.get('Name') != '/' + name
                    or app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project') != PROJECT
                    or app.get('Config', {}).get('Labels', {}).get('com.docker.compose.service') != service
                    or app.get('State', {}).get('Running') is not True
                    or set(app.get('NetworkSettings', {}).get('Networks', {})) != {NETWORK}
                    or app['NetworkSettings']['Networks'][NETWORK].get('NetworkID') != network.get('Id')):
                raise Refusal('activated application inventory differs')
            connected.add(app.get('Id'))
    if set(network.get('Containers', {})) != connected:
        raise Refusal('network membership differs')
    snapshot['containers'] = identities
    if docker('exec', 'capital_tracker_db', 'sh', '-c', 'cat "$PGDATA/PG_VERSION"') != '18':
        raise Refusal('PostgreSQL major differs')
    return snapshot


def clean_cluster(container, user, database):
    if (not (re.fullmatch(r'[a-z][a-z0-9_-]{0,62}', container)
             or re.fullmatch(r'[a-f0-9]{64}', container))
            or not all(re.fullmatch(r'[a-z][a-z0-9_]{0,62}', value) for value in (user, database))):
        raise Refusal('invalid cluster inspection identity')
    query = lambda db, sql: docker('exec', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                                   '-U', user, '-d', db, '-c', sql)
    if query(database, "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database") != \
            ','.join(sorted({'template0', 'template1', 'postgres', database})):
        raise Refusal('unexpected PostgreSQL database inventory')
    if query(database, "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ESCAPE '\\'") != user:
        raise Refusal('unexpected PostgreSQL role inventory')
    # Inspect each connectable bootstrap database; template0 rejects connections.
    sql = ("SELECT CASE WHEN "
           "(SELECT string_agg(nspname, ',' ORDER BY nspname) FROM pg_namespace) = "
           "'information_schema,pg_catalog,pg_toast,public' "
           "AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')=0 "
           "AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')=0 "
           "AND (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')=0 "
           "AND (SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension)='plpgsql' "
           "AND (SELECT count(*) FROM pg_largeobject_metadata)=0 "
           "AND (SELECT count(*) FROM pg_event_trigger)=0 "
           "AND (SELECT count(*) FROM pg_foreign_server)=0 "
           "AND (SELECT count(*) FROM pg_publication)=0 "
           "AND (SELECT count(*) FROM pg_subscription)=0 "
           "THEN 'clean' ELSE 'dirty' END")
    for db in sorted({'template1', 'postgres', database}):
        if query(db, sql) != 'clean':
            raise Refusal('PostgreSQL bootstrap database contains unexpected objects')


def verify(root, pins_path, used_dir, postgres_ref, redis_ref):
    pins = json.loads(pathlib.Path(pins_path).read_text())
    if (pins['postgres']['registryDigest'] != postgres_ref
            or pins['redis']['registryDigest'] != redis_ref):
        raise Refusal('candidate infrastructure differs from reviewed original')
    historical_receipt(used_dir, pins)
    peer = runtime_residue(root, pins)
    snapshot = resources(postgres_ref, redis_ref, root)
    settings = runtime_settings(root)
    clean_cluster('capital_tracker_db', settings['DB_USERNAME'], settings['DB_NAME'])
    snapshot['proxyPeer'] = peer
    return snapshot


def main(argv):
    try:
        if len(argv) == 5 and argv[1] == 'cluster':
            clean_cluster(*argv[2:])
            return 0
        if len(argv) not in (7, 8) or argv[1] not in ('preflight', 'compare', 'compare-active'):
            raise Refusal('use preflight|compare|compare-active ROOT PINS USED_DIR POSTGRES REDIS [SNAPSHOT]')
        _, operation, root, pins_path, used_dir, postgres_ref, redis_ref = argv[:7]
        if operation == 'preflight':
            if len(argv) != 7:
                raise Refusal('unexpected preflight snapshot')
            print(json.dumps(verify(root, pins_path, used_dir, postgres_ref, redis_ref), sort_keys=True))
        else:
            if len(argv) != 8:
                raise Refusal('compare requires the earlier snapshot')
            snapshot = json.loads(argv[7])
            if not isinstance(snapshot, dict) or set(snapshot) != {'network', 'containers', 'proxyPeer'}:
                raise Refusal('invalid infrastructure snapshot')
            if resources(postgres_ref, redis_ref, root, allow_apps=operation == 'compare-active') != \
                    {key: snapshot[key] for key in ('network', 'containers')}:
                raise Refusal('infrastructure changed during continuation')
        return 0
    except (Refusal, OSError, KeyError, TypeError, ValueError) as error:
        print('resume refused: {}'.format(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
