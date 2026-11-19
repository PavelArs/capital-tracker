"""Every shell script that dumps the database keeps its files private (Codex Security finding #15)."""

import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DUMP = re.compile(r'\bpg_dump\b')
PRIVATE = re.compile(r'^umask 0?077$', re.MULTILINE)


def tracked_shell_scripts():
    listed = subprocess.run(
        ['git', 'ls-files', '-z', '--', '*.sh'],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout.decode()
    return [ROOT / name for name in listed.split('\0') if name]


class DatabaseDumpScriptsTest(unittest.TestCase):
    def test_every_script_that_dumps_the_database_sets_a_private_umask(self):
        dumping = [path for path in tracked_shell_scripts() if DUMP.search(path.read_text())]
        self.assertTrue(dumping, 'expected the maintained backup scripts to be found')
        open_dumps = [
            str(path.relative_to(ROOT)) for path in dumping if not PRIVATE.search(path.read_text())
        ]
        self.assertEqual(open_dumps, [])


if __name__ == '__main__':
    unittest.main()
