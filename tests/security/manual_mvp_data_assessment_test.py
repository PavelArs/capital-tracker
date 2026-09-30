"""Synthetic process checks for the read-only server assessment (Codex-authored RED, 2026-09-30)."""

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
if args[:2] == ['ps','-aq']: print('container-id')
elif args[:3] == ['volume','ls','-q']: print('volume-name')
elif args[:3] == ['network','ls','-q']: print('network-id')
elif args[:1] == ['inspect']:
    print('[{"Name":"/other","Config":{"Labels":null},"Mounts":[]}]')
elif args[:2] == ['volume','inspect']:
    print('[{"Name":"other_volume","Labels":null}]')
elif args[:2] == ['network','inspect']:
    print('[{"Name":"bridge","Labels":null}]')
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
