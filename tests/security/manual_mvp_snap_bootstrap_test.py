"""MVP-007: fresh Docker Snap bootstrap with real disposable filesystem checks.

Only the script copy redirects fixed system paths and trusted root uid. Commands
and chown requests are recorded; no root, Docker, network or system writes occur.
Receipt validation is separately covered and replaced here by a trusted fixture.
"""

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
BASH = shutil.which("bash", path="/opt/homebrew/bin:/usr/local/bin:" + os.environ["PATH"])
COMMAND = r'''import json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
base = pathlib.Path(os.environ['FIXTURE_ROOT'])
def record():
    with open(base / 'mutations', 'a') as output:
        output.write(json.dumps([name] + args) + '\n')
def confined(value):
    path = pathlib.Path(value)
    if not path.is_relative_to(base):
        raise SystemExit('fixture refuses system write')
    return path
if name == 'id':
    print('0' if args == ['-u'] else 'capital-release')
elif name == 'git':
    print('a' * 40)
elif name in ('docker', 'ss', 'openssl'):
    pass
elif name == 'install':
    record()
    if '-d' not in args:
        raise SystemExit('unexpected install')
    mode = int(args[args.index('-m') + 1], 8)
    for value in args[args.index('-m') + 2:]:
        path = confined(value)
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(mode)
elif name == 'cp':
    record()
    shutil.copy2(confined(args[-2]), confined(args[-1]))
elif name == 'ln':
    record()
    confined(args[-1]).symlink_to(confined(args[-2]))
elif name == 'unlink':
    record()
    confined(args[-1]).unlink()
elif name in ('nginx', 'systemctl'):
    record()
else:
    raise SystemExit('unexpected fixture command: ' + name)
'''

# chown cannot be performed by an unprivileged runner. Capture the exact requested
# identities rather than silently mapping the container/root ownership contract.
PYTHON_FIXTURE = '''import os, pwd, types, json
def fixture_chown(path, uid, gid):
    candidate = os.path.abspath(path)
    if not candidate.startswith(os.environ['FIXTURE_ROOT'] + os.sep):
        raise SystemExit('fixture refuses system chown')
    with open(os.path.join(os.environ['FIXTURE_ROOT'], 'ownership'), 'a') as output:
        output.write(json.dumps([candidate, uid, gid]) + '\\n')
os.chown = fixture_chown
pwd.getpwnam = lambda account: types.SimpleNamespace(pw_uid=0 if account == 'root' else 1234, pw_gid=0 if account == 'root' else 1234)
'''


class SnapBootstrapProcessAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name).resolve()
        self.server = self.base / "server"
        self.runtime = self.server / "var/snap/docker/common/capital-tracker"
        self.ancestor = self.runtime.parent
        self.ancestor.mkdir(parents=True)
        self.server.chmod(0o755)
        for path in (self.server / "var", self.server / "var/snap", self.server / "var/snap/docker", self.ancestor):
            path.chmod(0o755)
        self.legacy = self.server / "opt/capital-tracker"
        self.legacy.mkdir(parents=True)
        self.legacy_bytes = {".env": b"UNUSED_TEMPLATE=preserve\n", ".gitignore": b"*\n"}
        for name, value in self.legacy_bytes.items():
            (self.legacy / name).write_bytes(value)
        for relative in ("etc/nginx/sites-enabled", "etc/nginx/sites-available", "etc/letsencrypt/live/capital.pavelars.ru"):
            (self.server / relative).mkdir(parents=True)
        for name in ("fullchain.pem", "privkey.pem"):
            (self.server / "etc/letsencrypt/live/capital.pavelars.ru" / name).write_text("fixture")
        self.site = self.server / "etc/nginx/sites-available/capital.pavelars.ru"
        self.site.write_bytes(b"inactive vhost preserved\n")
        self.checkout = self.base / "checkout"
        (self.checkout / "scripts").mkdir(parents=True)
        (self.checkout / "deploy").mkdir()
        shutil.copyfile(REPO / "deploy/nginx.conf", self.checkout / "deploy/nginx.conf")
        (self.checkout / "scripts/manual-mvp-receipt.py").write_text(
            "import types\n"
            "dispatcher = types.SimpleNamespace(Config=lambda: None, check_registry_config=lambda config: None)\n"
            "def validate_bootstrap_receipt(*args): pass\n")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        for name in ("id", "git", "docker", "ss", "openssl", "install", "cp", "ln", "unlink", "nginx", "systemctl"):
            path = self.bin / name
            path.write_text("#!" + sys.executable + "\n" + COMMAND)
            path.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def run_bootstrap(self, *, real_root_uid=False, account="root"):
        source = (REPO / "scripts/manual-mvp-server-bootstrap.sh").read_text()
        for path in ("/var/snap/docker/common", "/opt/capital-tracker", "/etc/nginx", "/etc/letsencrypt", "/etc/capital-tracker"):
            source = source.replace(path, str(self.server) + path)
        source = re.sub(r"^PATH=.*$", "PATH=" + str(self.bin) + ":/usr/bin:/bin", source, flags=re.MULTILINE)
        source = source.replace("/usr/bin/python3", sys.executable)
        source = source.replace('TRUST_ROOT = pathlib.Path("/")', 'TRUST_ROOT = pathlib.Path(' + repr(str(self.server)) + ')')
        if not real_root_uid:
            source = source.replace("ROOT_UID = 0", "ROOT_UID = " + str(os.getuid()))
        source = re.sub(r"(<<'(?:PYTHON|PY)'\n)", lambda match: match[0] + PYTHON_FIXTURE, source)
        script = self.checkout / "scripts/bootstrap-fixture.sh"
        script.write_text(source)
        result = subprocess.run([
            BASH, str(script), account,
            "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64,
            "redis@sha256:" + "e" * 64, str(self.base / "reviewed-receipt.json"),
        ], env={**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                "FIXTURE_ROOT": str(self.base)}, capture_output=True, text=True, timeout=15)
        return result

    def assert_legacy_preserved(self):
        self.assertEqual(sorted(path.name for path in self.legacy.iterdir()), sorted(self.legacy_bytes))
        for name, value in self.legacy_bytes.items():
            self.assertEqual((self.legacy / name).read_bytes(), value)

    def assert_before_mutation_refusal(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.base / "mutations").exists(), result.stdout + result.stderr)
        self.assertFalse((self.base / "ownership").exists(), result.stdout + result.stderr)
        self.assertEqual(self.site.read_bytes(), b"inactive vhost preserved\n")
        self.assert_legacy_preserved()

    def test_fresh_fixed_snap_runtime_and_mfa_bind_preserve_legacy_bytes(self):
        result = self.run_bootstrap()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(self.runtime.is_dir(), "bootstrap must use the Docker Snap managed root")
        self.assert_legacy_preserved()
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o700)
        for name in (".env.release", ".backup-key", ".mfa-key", ".owner-password.json"):
            self.assertEqual((self.runtime / name).lstat().st_mode & 0o777, 0o600)
        self.assertEqual((self.runtime / ".mfa-key").stat().st_size, 32)
        self.assertIn("MFA_KEY_FILE=" + str(self.runtime / ".mfa-key") + "\n", (self.runtime / ".env.release").read_text())
        ownership = dict((path, (uid, gid)) for path, uid, gid in map(json.loads, (self.base / "ownership").read_text().splitlines()))
        for name in (".env.release", ".backup-key", ".owner-password.json"):
            self.assertEqual(ownership[str(self.runtime / name)], (0, 0))
        self.assertEqual(ownership[str(self.runtime / ".mfa-key")], (1000, 1000))
        commands = list(map(json.loads, (self.base / "mutations").read_text().splitlines()))
        installs = {command[-1]: command for command in commands if command[0] == "install"}
        for path, identity in ((self.runtime, "root"), (self.runtime / "operator", "1000")):
            command = installs[str(path)]
            self.assertIn(command[command.index("-o") + 1], (identity, "0") if identity == "root" else (identity,))
            self.assertIn(command[command.index("-g") + 1], (identity, "0") if identity == "root" else (identity,))

    def test_symlinked_snap_ancestor_refuses_before_install_or_nginx(self):
        moved = self.ancestor.with_name("common-real")
        self.ancestor.rename(moved)
        self.ancestor.symlink_to(moved, target_is_directory=True)
        self.assert_before_mutation_refusal(self.run_bootstrap())

    def test_deployment_account_refuses_before_install_or_nginx(self):
        self.assert_before_mutation_refusal(self.run_bootstrap(account="capital-release"))

    def test_group_writable_snap_ancestor_refuses_before_install_or_nginx(self):
        self.ancestor.chmod(0o775)
        self.assert_before_mutation_refusal(self.run_bootstrap())

    def test_real_foreign_owner_refuses_before_install_or_nginx(self):
        if os.getuid() == 0:
            self.skipTest("unprivileged fixture required for real foreign-owner oracle")
        self.assert_before_mutation_refusal(self.run_bootstrap(real_root_uid=True))

    def test_populated_target_refuses_before_install_or_nginx(self):
        self.runtime.mkdir()
        protected = self.runtime / "unexplained-owner-data"
        protected.write_bytes(b"preserve")
        self.assert_before_mutation_refusal(self.run_bootstrap())
        self.assertEqual(protected.read_bytes(), b"preserve")


if __name__ == "__main__":
    unittest.main()
