"""Every shell script that dumps the database keeps its files private (Codex Security finding #15)."""

import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DUMP = re.compile(r'\bpg_dump(all)?\b')
PRIVATE = re.compile(r'^umask 0?077\s*(#.*)?$')
SHELL = re.compile(r'^#!\s*\S*\b(ba|da|z)?sh\b')


def tracked_shell_scripts():
    listed = subprocess.run(
        ['git', 'ls-files', '-z'],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout.decode()
    for name in filter(None, listed.split('\0')):
        path = ROOT / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        if path.suffix in ('.sh', '.bash') or SHELL.match(text):
            yield path, text


def dumps_without_private_umask(text):
    """True when a pg_dump runs before any top-level `umask 077` line."""
    for line in text.splitlines():
        if PRIVATE.match(line):
            return False
        if DUMP.search(line.split('#', 1)[0]):
            return True
    return False


class DatabaseDumpScriptsTest(unittest.TestCase):
    def test_the_check_reads_order(self):
        self.assertTrue(dumps_without_private_umask('pg_dump db > out\numask 077\n'))
        self.assertTrue(dumps_without_private_umask('pg_dumpall > out\n'))
        self.assertFalse(dumps_without_private_umask('umask 077\npg_dump db > out\n'))
        self.assertFalse(dumps_without_private_umask('# pg_dump is not run here\n'))

    def test_every_script_that_dumps_the_database_sets_a_private_umask_first(self):
        scripts = list(tracked_shell_scripts())
        self.assertTrue(
            any(DUMP.search(text) for _, text in scripts),
            'expected the maintained backup scripts to be found',
        )
        open_dumps = [
            str(path.relative_to(ROOT)) for path, text in scripts if dumps_without_private_umask(text)
        ]
        self.assertEqual(open_dumps, [])


if __name__ == '__main__':
    unittest.main()
