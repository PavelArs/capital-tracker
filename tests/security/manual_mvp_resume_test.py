"""Read-only continuation gates against adversarial host and cluster metadata."""

import importlib.util
import json
import pathlib
import tempfile
import unittest
import hashlib
import os
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[2] / 'scripts/manual-mvp-resume.py'
spec = importlib.util.spec_from_file_location('manual_mvp_resume', SOURCE)
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)
POSTGRES = 'ghcr.io/pavelars/capital-tracker-postgres@sha256:' + 'a' * 64
REDIS = 'redis@sha256:' + 'b' * 64
NETWORK = resume.NETWORK
PG = 'capital_tracker_db'
RD = 'capital_tracker_redis'


class ClusterProof(unittest.TestCase):
    def test_historical_consumed_receipt_is_provenance_not_new_approval(self):
        raw = (pathlib.Path(__file__).parent / 'fixtures/old-consumed-receipt.json').read_bytes()
        pins = json.loads((SOURCE.parents[1] / 'deploy/manual-mvp-infrastructure-pins.json').read_text())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), pins['resumeOrigin']['usedReceiptSha256'])
        with patch.object(resume, 'trusted_file', return_value=raw):
            self.assertEqual(resume.historical_receipt('/used', pins)['installation'], 'fresh')
            wrong = json.loads(json.dumps(pins))
            wrong['resumeOrigin']['ciRunId'] = '36914835760'
            with self.assertRaises(resume.Refusal):
                resume.historical_receipt('/used', wrong)

    def test_refuses_unexpected_database_role_or_object_before_writes(self):
        def baseline(*args):
            query = args[-1]
            if 'FROM pg_database' in query:
                return 'capital_tracker,postgres,template0,template1'
            if 'FROM pg_roles' in query:
                return 'capital_owner'
            return 'clean'

        with patch.object(resume, 'docker', side_effect=baseline):
            resume.clean_cluster(PG, 'capital_owner', 'capital_tracker')
        for change in ('unknown_database', 'owner_role', 'application_object'):
            def changed(*args):
                query = args[-1]
                if change == 'unknown_database' and 'FROM pg_database' in query:
                    return baseline(*args) + ',unknown'
                if change == 'owner_role' and 'FROM pg_roles' in query:
                    return 'capital_owner,owner'
                if change == 'application_object' and 'FROM pg_namespace' in query:
                    return 'dirty'
                return baseline(*args)
            with self.subTest(change=change), patch.object(resume, 'docker', side_effect=changed):
                with self.assertRaises(resume.Refusal):
                    resume.clean_cluster(PG, 'capital_owner', 'capital_tracker')


class InfrastructureProof(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.settings = {'DB_USERNAME': 'capital_owner', 'DB_NAME': 'capital_tracker',
                         'DB_PASSWORD': 'c' * 64, 'POSTGRES_IMAGE': POSTGRES,
                         'POSTGRES_EXPECTED_MAJOR': '18', 'POSTGRES_VOLUME_TARGET': '/var/lib/postgresql',
                         'REDIS_IMAGE': REDIS, 'FRONTEND_URL': 'https://capital.pavelars.ru',
                         'BACKEND_HOST_PORT': '3100', 'FRONTEND_HOST_PORT': '3101',
                         'MFA_KEY_FILE': str(self.root / '.mfa-key'), 'MFA_KEY_ID': 'capital-production-1',
                         'TRUSTED_PROXY_IPS': '["172.1.2.3"]', 'OWNER_EMAIL': 'owner@capital.pavelars.ru',
                         'BACKGROUND_JOBS_ENABLED': 'false', 'DISPLAY_FX_ENABLED': 'false'}
        self.write_settings()
        self.pg_id = 'a' * 64
        self.redis_id = 'b' * 64
        self.net_id = 'n' * 64
        self.pg_image = 'sha256:' + 'd' * 64
        self.redis_image = 'sha256:' + 'e' * 64
        self.metadata = {
            ('network', 'inspect', NETWORK): {'Name': NETWORK, 'Id': self.net_id,
                'Created': 'old', 'Labels': {'com.docker.compose.project': resume.PROJECT,
                'com.docker.compose.network': 'capital-tracker-network'},
                'Containers': {self.pg_id: {}, self.redis_id: {}}},
        }
        for name, service, ref, image_id, container_id, volume, target in (
            (PG, 'postgres', POSTGRES, self.pg_image, self.pg_id,
             'capital-tracker_postgres_data', '/var/lib/postgresql'),
            (RD, 'redis', REDIS, self.redis_image, self.redis_id,
             'capital-tracker_redis_data', '/data'),
        ):
            environment = ['POSTGRES_USER=capital_owner', 'POSTGRES_DB=capital_tracker',
                           'POSTGRES_PASSWORD=' + 'c' * 64] if service == 'postgres' else []
            self.metadata[('inspect', name)] = {'Name': '/' + name, 'Id': container_id,
                'Image': image_id, 'Config': {'Image': ref, 'Env': environment,
                'Labels': {'com.docker.compose.project': resume.PROJECT,
                           'com.docker.compose.service': service}},
                'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                'Mounts': [{'Type': 'volume', 'Name': volume, 'Destination': target,
                            'Source': '/durable/' + volume}],
                'NetworkSettings': {'Networks': {NETWORK: {'NetworkID': self.net_id}}}}
            self.metadata[('image', 'inspect', ref)] = {'Id': image_id}
            self.metadata[('volume', 'inspect', volume)] = {'Name': volume, 'Driver': 'local',
                'CreatedAt': 'old', 'Mountpoint': '/durable/' + volume, 'Scope': 'local', 'Options': None,
                'Labels': {'com.docker.compose.project': resume.PROJECT,
                           'com.docker.compose.volume': service + '_data'}}

    def tearDown(self):
        self.tmp.cleanup()

    def write_settings(self):
        (self.root / '.env.release').write_text(''.join(key + '=' + value + '\n'
                                                       for key, value in self.settings.items()))

    def docker(self, *args):
        if args == ('ps', '-a', '--format', '{{.Names}}') or args == (
                'ps', '-a', '--filter', 'label=com.docker.compose.project=capital-tracker',
                '--format', '{{.Names}}'):
            return PG + '\n' + RD
        if args[0:2] == ('volume', 'ls'):
            return 'capital-tracker_postgres_data\ncapital-tracker_redis_data'
        if args[0:2] == ('network', 'ls'):
            return NETWORK
        if args == ('exec', PG, 'sh', '-c', 'cat "$PGDATA/PG_VERSION"'):
            return '18'
        raise AssertionError(args)

    def inspected(self, *args):
        return self.metadata[args]

    def check(self):
        with patch.object(resume, 'docker', side_effect=self.docker), \
                patch.object(resume, 'docker_json', side_effect=self.inspected):
            return resume.resources(POSTGRES, REDIS, self.root)

    def test_exact_running_infrastructure_passes_and_drift_refuses(self):
        baseline = self.check()
        self.assertEqual(set(baseline['containers']), {PG, RD})
        for metadata, path, changed in (
            (('inspect', PG), ('State', 'Health', 'Status'), 'unhealthy'),
            (('inspect', PG), ('Mounts', 0, 'Name'), 'other_data'),
            (('inspect', PG), ('Image',), 'sha256:' + 'f' * 64),
            (('inspect', RD), ('Config', 'Labels', 'com.docker.compose.project'), 'other'),
            (('network', 'inspect', NETWORK), ('Id',), 'replacement'),
        ):
            node = self.metadata[metadata]
            for key in path[:-1]:
                node = node[key]
            original = node[path[-1]]
            node[path[-1]] = changed
            try:
                with self.subTest(path=path), self.assertRaises(resume.Refusal):
                    self.check()
            finally:
                node[path[-1]] = original
        self.settings['DB_USERNAME'] = 'another'
        self.write_settings()
        with self.assertRaises(resume.Refusal):
            self.check()
        self.settings['DB_USERNAME'] = 'capital_owner'
        self.settings['FRONTEND_URL'] = 'https://another.invalid'
        self.write_settings()
        with self.assertRaises(resume.Refusal):
            self.check()

    def test_interrupted_residue_refuses_activation_unknown_file_and_schema_marker(self):
        pins = json.loads((SOURCE.parents[1] / 'deploy/manual-mvp-infrastructure-pins.json').read_text())
        pins['postgres']['registryDigest'] = POSTGRES
        pins['redis']['registryDigest'] = REDIS
        origin = pins['resumeOrigin']['commit']
        for name in ('.backup-key', '.mfa-key', '.owner-password.json', '.release.lock'):
            (self.root / name).write_text('fixture')
        (self.root / 'operator').mkdir()
        state = self.root / 'releases' / origin / '20261001T193100Z-123'
        state.mkdir(parents=True)
        backup = self.root / 'backups' / (origin + '-20261001T193100Z.dump.enc')
        backup.parent.mkdir()
        backup.write_bytes(b'encrypted fixture')
        checksum = hashlib.sha256(backup.read_bytes()).hexdigest()
        (backup.parent / (backup.name + '.sha256')).write_text(checksum + '  ' + str(backup) + '\n')
        self.assertEqual(resume.runtime_residue(self.root, pins, os.getuid()), '172.1.2.3')
        for path in (self.root / '.env.images', self.root / 'unrelated'):
            path.write_text('unexpected')
            with self.subTest(path=path), self.assertRaises(resume.Refusal):
                resume.runtime_residue(self.root, pins, os.getuid())
            path.unlink()
        marker = state / 'migrations-before'
        marker.write_text('write began')
        with self.assertRaises(resume.Refusal):
            resume.runtime_residue(self.root, pins, os.getuid())


if __name__ == '__main__':
    unittest.main()
