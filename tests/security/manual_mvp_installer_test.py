"""MVP-007: run the installer against a disposable server and command fixtures.

Only the test copy redirects fixed paths and the trusted uid/root boundary. The
production installer has no configurable privileged destinations. lstat, modes,
symlinks, file copies and subprocess execution use the real temporary filesystem.
"""

import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
INSTALLER = REPO / "scripts/manual-mvp-dispatcher-install.sh"
COMMIT = "a" * 40

COMMAND_FIXTURE = r'''import hashlib, json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
def record():
    with open(root / 'mutations', 'a') as output:
        output.write(json.dumps([name] + args) + '\n')
def confined(path):
    candidate = pathlib.Path(path)
    if not candidate.is_relative_to(root):
        raise SystemExit('fixture refuses system write: ' + str(candidate))
    return candidate
if name == 'id':
    print('0' if args == ['-u'] else 'capital-release')
elif name == 'getent':
    print('capital-release:x:1000:1000::' + str(root / 'server/var/lib/capital-release') + ':/bin/sh')
elif name in ('useradd', 'usermod', 'visudo'):
    record()
elif name == 'install':
    record()
    mode = int(args[args.index('-m') + 1], 8)
    if '-d' in args:
        index = args.index('-m') + 2
        for item in args[index:]:
            path = confined(item)
            path.mkdir(parents=True, exist_ok=True)
            path.chmod(mode)
    else:
        target = confined(args[-1])
        shutil.copyfile(args[-2], target)
        target.chmod(mode)
        if os.environ.get('FIXTURE_BAD_INSTALL') == '1' and target.name == 'manual-mvp-dispatcher.next':
            target.chmod(0o777)
elif name == 'mv':
    record()
    os.replace(confined(args[-2]), confined(args[-1]))
elif name == 'sha256sum':
    for item in args:
        print(hashlib.sha256(pathlib.Path(item).read_bytes()).hexdigest() + '  ' + item)
elif name == 'git':
    if 'rev-parse' in args:
        print('a' * 40)
elif name in ('sshd', 'sudo'):
    pass
else:
    raise SystemExit('unexpected fixture command: ' + name)
'''


class InstallerProcessAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name).resolve()
        self.server = self.root / "server"
        for relative in ("usr/local/libexec", "etc/sudoers.d", "var/lib"):
            (self.server / relative).mkdir(parents=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("id", "getent", "useradd", "usermod", "install", "mv", "sha256sum", "git", "sshd", "sudo", "visudo"):
            command = self.bin / name
            command.write_text('#!' + sys.executable + '\n' + COMMAND_FIXTURE)
            command.chmod(0o755)
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        for relative in ("scripts/manual-mvp-dispatcher.py", "scripts/manual-mvp-release.sh", "scripts/manual-mvp-inventory.sh", "scripts/normalize-release-snapshot.awk", "docker-compose.yml", "deploy/manual-mvp-infrastructure-pins.json"):
            target = self.checkout / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / relative, target)
        self.key = self.root / "key.pub"
        self.key.write_text("ssh-ed25519 AAAATEST fixture\n")
        self.libexec = self.server / "usr/local/libexec/capital-tracker"
        self.receipts = self.server / "etc/capital-tracker/release-receipts"
        self.home = self.server / "var/lib/capital-release"

    def tearDown(self):
        self.temp.cleanup()

    def run_installer(self, operation="install", *, real_root_uid=False, bad_install=False):
        source = INSTALLER.read_text()
        source = source.replace('source=$(cd "$(dirname "$0")/.." && pwd -P)', 'source=' + str(self.checkout))
        for original in ("/var/lib/capital-release", "/usr/local/libexec/capital-tracker", "/etc/capital-tracker", "/etc/sudoers.d/capital-release", "/opt/capital-tracker", "/var/snap/docker/common/capital-tracker", "/snap/docker/current"):
            source = source.replace(original, str(self.server) + original)
        source = source.replace("/usr/bin/python3", sys.executable)
        source = source.replace(".pending-$$", ".pending-fixture")
        # Test-only rewrites. No overrides exist in the privileged production script.
        source = source.replace('TRUST_ROOT = pathlib.Path("/")', 'TRUST_ROOT = pathlib.Path(' + repr(str(self.server)) + ')')
        if not real_root_uid:
            source = source.replace("ROOT_UID = 0", "ROOT_UID = " + str(os.getuid()))
        script = self.checkout / "scripts/installer-fixture.sh"
        script.write_text(source)
        argument = self.key if operation == "install" else self.root / "receipt.json"
        environment = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "FIXTURE_ROOT": str(self.root), "TMPDIR": str(self.root), "FIXTURE_BAD_INSTALL": "1" if bad_install else "0"}
        return subprocess.run(["/bin/bash", str(script), operation, str(argument)], capture_output=True, text=True, env=environment)

    def mutations(self):
        path = self.root / "mutations"
        return path.read_text() if path.exists() else ""

    def assert_clean_refusal(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.root / "dispatcher-executed").exists(), "untrusted dispatcher executed")
        self.assertEqual(self.mutations(), "", result.stdout + result.stderr)
        self.assertIn("Refusing", result.stdout + result.stderr)

    def test_native_snap_config_is_scoped_and_preserves_auth(self):
        native = self.server / "snap/docker/current/bin/docker"
        native.parent.mkdir(parents=True)
        native.write_text("synthetic native Docker")
        native.chmod(0o755)
        config = self.server / "etc/capital-tracker/docker-config"
        config.mkdir(parents=True, mode=0o700)
        settings = config / "config.json"
        settings.write_text(json.dumps({"auths": {"ghcr.io": {"auth": "synthetic"}}}))
        settings.chmod(0o600)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads(settings.read_text())
        self.assertEqual(data["cliPluginsExtraDirs"], [str(self.server / "snap/docker/current/usr/libexec/docker/cli-plugins")])
        self.assertEqual(data["auths"], {"ghcr.io": {"auth": "synthetic"}})
        self.assertNotIn("synthetic", result.stdout + result.stderr)

    def test_config_and_pending_config_symlinks_refuse_before_authorization(self):
        config = self.server / "etc/capital-tracker/docker-config"
        config.mkdir(parents=True, mode=0o700)
        target = self.root / "unrelated-config"
        target.write_text("preserved")
        for name in ("config.json", "config.json.next"):
            with self.subTest(name=name):
                link = config / name
                link.symlink_to(target)
                try:
                    self.assert_clean_refusal(self.run_installer())
                    self.assertEqual(target.read_text(), "preserved")
                finally:
                    link.unlink()

    def test_refresh_preserves_private_registry_authentication(self):
        config = self.server / "etc/capital-tracker/docker-config"
        config.mkdir(parents=True, mode=0o700)
        settings = config / "config.json"
        settings.write_text(json.dumps({"auths": {"ghcr.io": {"auth": "synthetic"}}}))
        settings.chmod(0o600)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(settings.read_text())["auths"], {"ghcr.io": {"auth": "synthetic"}})
        self.assertEqual(settings.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("synthetic", result.stdout + result.stderr)

    def test_rejects_writable_existing_ancestors_before_any_mutation(self):
        for relative in ("usr", "usr/local", "usr/local/libexec", "etc", "etc/sudoers.d", "var", "var/lib"):
            with self.subTest(relative=relative):
                parent = self.server / relative
                parent.chmod(0o777)
                try:
                    self.assert_clean_refusal(self.run_installer())
                finally:
                    parent.chmod(0o755)
                    (self.root / "mutations").unlink(missing_ok=True)

    def test_rejects_symlinked_existing_ancestors_before_any_mutation(self):
        for relative in ("usr/local/libexec", "etc/sudoers.d", "var/lib"):
            with self.subTest(relative=relative):
                parent = self.server / relative
                moved = parent.with_name(parent.name + "-real")
                parent.rename(moved)
                parent.symlink_to(moved, target_is_directory=True)
                try:
                    self.assert_clean_refusal(self.run_installer())
                finally:
                    parent.unlink()
                    moved.rename(parent)
                    (self.root / "mutations").unlink(missing_ok=True)

    def test_rejects_real_foreign_owner_before_any_mutation(self):
        if os.getuid() == 0:
            os.chown(self.server / "usr/local/libexec", 1000, 1000)
        # On an unprivileged runner the fixture itself is genuinely foreign to root.
        self.assert_clean_refusal(self.run_installer(real_root_uid=True))

    def test_rejects_untrusted_custom_directories_and_pending_files(self):
        paths = (self.home, self.home / ".ssh", self.libexec, self.libexec / "release", self.receipts,
                 self.home / ".ssh/authorized_keys.next", self.libexec / "manual-mvp-dispatcher.next",
                 self.server / "etc/sudoers.d/capital-release.next")
        for path in paths:
            with self.subTest(path=path):
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.name.endswith(".next"):
                    path.write_text("attacker controlled")
                else:
                    path.mkdir(exist_ok=True)
                path.chmod(0o777)
                try:
                    self.assert_clean_refusal(self.run_installer())
                finally:
                    if path.is_dir():
                        path.chmod(0o755)
                    else:
                        path.unlink(missing_ok=True)
                    (self.root / "mutations").unlink(missing_ok=True)

    def test_rejects_non_directory_parent_before_any_mutation(self):
        parent = self.server / "usr/local/libexec"
        parent.rmdir()
        parent.write_text("not a directory")
        self.assert_clean_refusal(self.run_installer())

    def test_rejects_symlinked_custom_targets_and_staging_leaves(self):
        target = self.root / "protected"
        target.write_text("untouched")
        for path in (self.home, self.libexec, self.receipts,
                     self.home / ".ssh/authorized_keys.next", self.libexec / "manual-mvp-dispatcher.next",
                     self.libexec / "release/manual-mvp-release.sh.next",
                     self.server / "etc/sudoers.d/capital-release.next"):
            with self.subTest(path=path):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(target)
                try:
                    self.assert_clean_refusal(self.run_installer())
                    self.assertEqual(target.read_text(), "untouched")
                finally:
                    path.unlink(missing_ok=True)
                    (self.root / "mutations").unlink(missing_ok=True)

    def write_receipt(self):
        mapping = {"runner": "manual-mvp-release.sh", "inventory": "manual-mvp-inventory.sh",
                   "normalizer": "normalize-release-snapshot.awk", "compose": "docker-compose.yml",
                   "pins": "manual-mvp-infrastructure-pins.json"}
        pins = json.loads((REPO / "deploy/manual-mvp-infrastructure-pins.json").read_text())
        receipt = {"version": 1, "commit": COMMIT, "runId": "123", "installation": "fresh",
                   "backend": "ghcr.io/pavelars/capital-tracker-backend@sha256:" + "b" * 64,
                   "frontend": "ghcr.io/pavelars/capital-tracker-frontend@sha256:" + "c" * 64,
                   "postgres": "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64, "redis": pins["redis"]["registryDigest"],
                   "files": {key: hashlib.sha256((self.libexec / "release" / name).read_bytes()).hexdigest()
                             for key, name in mapping.items()}}
        path = self.root / "receipt.json"
        path.write_text(json.dumps(receipt))
        return path

    def test_approve_installs_a_valid_receipt_after_fresh_install(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = self.write_receipt()
        result = self.run_installer("approve")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        installed = self.receipts / (COMMIT + "-123.json")
        self.assertEqual(installed.read_bytes(), receipt.read_bytes())
        self.assertEqual(installed.stat().st_mode & 0o777, 0o600)

    def test_approve_rejects_symlinked_pending_receipt_before_any_mutation(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.write_receipt()
        (self.root / "mutations").unlink()
        protected = self.root / "protected-receipt"
        protected.write_text("untouched")
        (self.receipts / ".pending-fixture").symlink_to(protected)
        self.assert_clean_refusal(self.run_installer("approve"))
        self.assertEqual(protected.read_text(), "untouched")

    def test_fresh_install_publishes_expected_restricted_files(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        dispatcher = self.libexec / "manual-mvp-dispatcher"
        self.assertEqual(dispatcher.read_bytes(), (REPO / "scripts/manual-mvp-dispatcher.py").read_bytes())
        self.assertEqual(dispatcher.stat().st_mode & 0o777, 0o755)
        key = (self.home / ".ssh/authorized_keys").read_text()
        self.assertEqual(key, 'restrict,command="sudo -n ' + str(dispatcher) + '" ssh-ed25519 AAAATEST fixture\n')
        sudoers = self.server / "etc/sudoers.d/capital-release"
        self.assertIn(str(dispatcher) + ' ""', sudoers.read_text())
        self.assertEqual(sudoers.stat().st_mode & 0o777, 0o440)

    def test_newly_installed_dispatcher_is_verified_before_authorization(self):
        result = self.run_installer(bad_install=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Refusing", result.stdout + result.stderr)
        self.assertFalse((self.server / "etc/sudoers.d/capital-release").exists())
        self.assertFalse((self.home / ".ssh/authorized_keys").exists())

    def test_approve_rejects_untrusted_dispatcher_before_loading_or_writing(self):
        self.receipts.mkdir(parents=True)
        self.libexec.mkdir(parents=True)
        dispatcher = self.libexec / "manual-mvp-dispatcher"
        dispatcher.write_text('from pathlib import Path\nPath(' + repr(str(self.root / "dispatcher-executed")) + ').touch()\n')
        (self.root / "receipt.json").write_text("{}")
        for path in (self.libexec.parent, dispatcher, self.receipts.parent, self.receipts):
            with self.subTest(path=path):
                path.chmod(0o777)
                try:
                    self.assert_clean_refusal(self.run_installer("approve"))
                finally:
                    path.chmod(0o755 if path.is_dir() else 0o644)
                    (self.root / "mutations").unlink(missing_ok=True)
                    (self.root / "dispatcher-executed").unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
