"""Synthetic process checks for the read-only server assessment (Codex-authored RED, 2026-09-30)."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'manual-mvp-data-assessment.sh'


class AssessmentTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='capital-assessment-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.project = self.directory / 'project'
        self.project.mkdir()
        (self.project / '.env').write_text('DB_HOST=postgres\n')
        binary = self.directory / 'bin'
        binary.mkdir()
        docker = binary / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]
if os.environ.get('DOCKER_FAILURE') == 'yes':
    print('SENSITIVE_DOCKER_ERROR',file=sys.stderr)
    sys.exit(1)
if args[:2] == ['ps','-aq']: print(os.environ.get('CONTAINER_IDS', 'container-id'))
elif args[:3] == ['volume','ls','-q']: print(os.environ.get('VOLUME_NAMES', 'volume-name'))
elif args[:3] == ['network','ls','-q']: print(os.environ.get('NETWORK_IDS', 'network-id'))
elif args[:1] == ['inspect']:
    print(os.environ.get('CONTAINERS', '[{"Id":"container-id","Name":"/other","Config":{"Labels":null},"Mounts":[]}]'))
elif args[:2] == ['volume','inspect']:
    print(os.environ.get('VOLUMES', '[{"Name":"volume-name","Labels":null}]'))
elif args[:2] == ['network','inspect']:
    print(os.environ.get('NETWORKS', '[{"Id":"network-id","Name":"bridge","Labels":null}]'))
else: sys.exit(2)
''')
        docker.chmod(0o700)
        source = SCRIPT.read_text().replace(
            "[[ $(id -u) == 0 ]] || { echo 'Root inspection required'; exit 1; }",
            ': # Test copy only: synthetic project and Docker inventory.',
        ).replace('root=/opt/capital-tracker', f'root={self.project}')
        self.script = self.directory / 'assessment.sh'
        self.script.write_text(source)

    def run_assessment(self, **overrides):
        env = {**os.environ, 'PATH': f'{self.directory / "bin"}:{os.environ["PATH"]}', **overrides}
        return subprocess.run(
            ['bash', str(self.script)], capture_output=True, text=True, env=env, timeout=10
        )

    def test_null_docker_labels_are_unlabelled(self):
        result = self.run_assessment()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('fresh_setup_gate=passed', result.stdout)
        self.assertIn('database_target_classes=local_dedicated', result.stdout)

    def inventory(self):
        return {
            'CONTAINERS': [{'Id': 'container-id', 'Name': '/other', 'Config': {'Labels': None}, 'Mounts': []}],
            'VOLUMES': [{'Name': 'volume-name', 'Labels': None}],
            'NETWORKS': [{'Id': 'network-id', 'Name': 'bridge', 'Labels': None}],
        }

    def assert_inventory_blocked(self, **overrides):
        before = (self.project / '.env').read_bytes()
        result = self.run_assessment(**{key: json.dumps(value) if key in self.inventory() else value
                                        for key, value in overrides.items()})
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('reason=inventory_unavailable', result.stdout)
        self.assertIn('phase=docker_inventory', result.stdout)
        self.assertNotIn('fresh_setup_gate=passed', result.stdout)
        self.assertNotIn('SENSITIVE', result.stdout + result.stderr)
        self.assertEqual((self.project / '.env').read_bytes(), before)
        self.assertEqual(set(p.name for p in self.project.iterdir()), {'.env'})

    def test_inspect_requires_complete_list_inventory(self):
        for kind in self.inventory():
            for invalid in ({}, [], None, False, 0, '', ['SENSITIVE_RECORD']):
                with self.subTest(kind=kind, invalid=invalid):
                    self.assert_inventory_blocked(**{kind: invalid})
            records = self.inventory()[kind]
            with self.subTest(kind=kind, invalid='duplicate'):
                self.assert_inventory_blocked(**{kind: records + records})

    def test_inspect_requires_matching_identity_and_name(self):
        for kind, records in self.inventory().items():
            identity = 'Name' if kind == 'VOLUMES' else 'Id'
            for field in {identity, 'Name'}:
                for invalid in (None, False, 0, [], {}, '', 'SENSITIVE_FOREIGN'):
                    # An ordinary foreign name is valid for ID-addressed resources.
                    if field == 'Name' and kind != 'VOLUMES' and invalid == 'SENSITIVE_FOREIGN':
                        continue
                    with self.subTest(kind=kind, field=field, invalid=invalid):
                        self.assert_inventory_blocked(**{kind: [{**records[0], field: invalid}]})
                with self.subTest(kind=kind, field=field, invalid='missing'):
                    self.assert_inventory_blocked(**{kind: [{k: v for k, v in records[0].items() if k != field}]})

    def test_labels_require_null_or_string_dictionary(self):
        for kind, records in self.inventory().items():
            for invalid in (False, 0, [], '', 'SENSITIVE_LABEL', {'com.docker.compose.project': False}, {'SENSITIVE_KEY': []}):
                record = {**records[0]}
                target = record
                if kind == 'CONTAINERS':
                    target = record['Config'] = dict(record['Config'])
                target['Labels'] = invalid
                with self.subTest(kind=kind, invalid=invalid):
                    self.assert_inventory_blocked(**{kind: [record]})
            record = {**records[0]}
            target = record
            if kind == 'CONTAINERS':
                target = record['Config'] = dict(record['Config'])
            del target['Labels']
            with self.subTest(kind=kind, invalid='missing'):
                self.assert_inventory_blocked(**{kind: [record]})

    def test_container_config_requires_dictionary(self):
        record = self.inventory()['CONTAINERS'][0]
        for invalid in (None, False, 0, [], '', 'SENSITIVE_CONFIG', {}):
            with self.subTest(invalid=invalid):
                self.assert_inventory_blocked(CONTAINERS=[{**record, 'Config': invalid}])
        self.assert_inventory_blocked(CONTAINERS=[{k: v for k, v in record.items() if k != 'Config'}])

    def test_mounts_require_null_or_list_with_string_type_and_source(self):
        record = self.inventory()['CONTAINERS'][0]
        for invalid in (False, 0, '', {}, 'SENSITIVE_MOUNTS', [None], [{}], [{'Type': 'bind'}],
                        [{'Type': False, 'Source': 'SENSITIVE_SOURCE'}], [{'Type': 'bind', 'Source': []}],
                        [{'Type': '', 'Source': '/other'}], [{'Type': 'bind', 'Source': ''}]):
            with self.subTest(invalid=invalid):
                self.assert_inventory_blocked(CONTAINERS=[{**record, 'Mounts': invalid}])
        self.assert_inventory_blocked(CONTAINERS=[{k: v for k, v in record.items() if k != 'Mounts'}])

    def test_null_mounts_and_empty_label_dictionaries_are_valid(self):
        inventory = self.inventory()
        inventory['CONTAINERS'][0]['Mounts'] = None
        inventory['CONTAINERS'][0]['Config']['Labels'] = {}
        inventory['VOLUMES'][0]['Labels'] = {}
        inventory['NETWORKS'][0]['Labels'] = {}
        result = self.run_assessment(**{key: json.dumps(value) for key, value in inventory.items()})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_empty_listed_inventory_is_valid(self):
        result = self.run_assessment(CONTAINER_IDS='', VOLUME_NAMES='', NETWORK_IDS='')
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_inventory_identity_matching_is_complete_and_unambiguous(self):
        for kind, listing in (('CONTAINERS', 'CONTAINER_IDS'), ('VOLUMES', 'VOLUME_NAMES'), ('NETWORKS', 'NETWORK_IDS')):
            record = self.inventory()[kind][0]
            identity = 'Name' if kind == 'VOLUMES' else 'Id'
            original = record[identity]
            other = {**record, identity: 'second-resource'}
            for requested, records in ((original + ' ' + original, [record, record]),
                                       (original + ' second-resource', [record, record]),
                                       (original + ' second-resource', [record]),
                                       (original + ' second-resource', [record, {**other, identity: 'SENSITIVE_FOREIGN'}])):
                with self.subTest(kind=kind, requested=requested, records=records):
                    self.assert_inventory_blocked(**{kind: records, listing: requested})
            result = self.run_assessment(**{kind: json.dumps([other, record]), listing: original + ' second-resource'})
            self.assertEqual(result.returncode, 0, result.stdout)
        record = self.inventory()['CONTAINERS'][0]
        prefix = 'a' * 12
        self.assert_inventory_blocked(CONTAINER_IDS=prefix + ' ' + 'a' * 13,
                                      CONTAINERS=[{**record, 'Id': prefix + 'b' * 52},
                                                  {**record, 'Id': 'a' * 13 + 'c' * 51}])

    def test_null_labels_and_null_mounts_preserve_env_without_execution(self):
        inventory = self.inventory()
        inventory['CONTAINERS'][0]['Mounts'] = None
        contents = 'DB_HOST=postgres\nPASSWORD=SENSITIVE_ENV\n'
        (self.project / '.env').write_text(contents)
        result = self.run_assessment(**{key: json.dumps(value) for key, value in inventory.items()})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('SENSITIVE_ENV', result.stdout + result.stderr)
        self.assertEqual((self.project / '.env').read_text(), contents)
        self.assertEqual(set(p.name for p in self.project.iterdir()), {'.env'})
        marker = self.project / 'executed'
        contents += f'CANARY=$(touch {marker})\n'
        (self.project / '.env').write_text(contents)
        result = self.run_assessment()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('reason=configuration_requires_private_review', result.stdout)
        self.assertFalse(marker.exists())
        self.assertEqual((self.project / '.env').read_text(), contents)

    def test_short_docker_ids_match_full_inspect_ids(self):
        inventory = self.inventory()
        inventory['CONTAINERS'][0]['Id'] = 'a' * 64
        inventory['NETWORKS'][0]['Id'] = 'b' * 64
        result = self.run_assessment(CONTAINER_IDS='a' * 12, NETWORK_IDS='b' * 12,
                                     **{key: json.dumps(value) for key, value in inventory.items()})
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_application_resources_and_bind_mounts_block_fresh_setup(self):
        for kind, field in (('CONTAINERS', 'Name'), ('VOLUMES', 'Labels'), ('NETWORKS', 'Labels'), ('CONTAINERS', 'Mounts')):
            inventory = self.inventory()
            record = inventory[kind][0]
            if field == 'Name':
                record[field] = '/capital_tracker_db'
            elif field == 'Labels':
                record[field] = {'com.docker.compose.project': 'capital-tracker'}
            else:
                record[field] = [{'Type': 'bind', 'Source': str(self.project / 'SENSITIVE_DATA')}]
            with self.subTest(kind=kind, field=field):
                result = self.run_assessment(**{key: json.dumps(value) for key, value in inventory.items()})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('reason=existing_application_data_references', result.stdout)
                self.assertNotIn('SENSITIVE_DATA', result.stdout + result.stderr)

    def test_unknown_mount_type_with_project_source_blocks_fresh_setup(self):
        inventory = self.inventory()
        inventory['CONTAINERS'][0]['Mounts'] = [{'Type': 'SENSITIVE_UNKNOWN_TYPE', 'Source': str(self.project / 'SENSITIVE_DATA')}]
        result = self.run_assessment(**{key: json.dumps(value) for key, value in inventory.items()})
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('reason=existing_application_data_references', result.stdout)
        self.assertNotIn('SENSITIVE', result.stdout + result.stderr)

    def test_docker_failure_is_classified_without_stderr(self):
        result = self.run_assessment(DOCKER_FAILURE='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('reason=inventory_unavailable', result.stdout)
        self.assertIn('phase=docker_inventory', result.stdout)
        self.assertNotIn('SENSITIVE_DOCKER_ERROR', result.stdout + result.stderr)

    def test_invalid_env_encoding_has_safe_phase_and_class(self):
        (self.project / '.env').write_bytes(b'DB_HOST=postgres\nPASSWORD=\xff\n')
        result = self.run_assessment()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('reason=assessment_unavailable', result.stdout)
        self.assertIn('phase=env_read', result.stdout)
        self.assertIn('error_class=UnicodeError', result.stdout)
        self.assertNotIn('PASSWORD', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
