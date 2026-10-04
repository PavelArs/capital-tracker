"""MVP-007: end-to-end dispatcher decisions against installed files and receipts."""

import hashlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/manual-mvp-dispatcher.py"
spec = importlib.util.spec_from_file_location("manual_mvp_dispatcher_flow", SOURCE)
dispatcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)

COMMIT = "a" * 40
RUN_ID = "123"
POSTGRES = "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64
REDIS = "redis@sha256:" + "e" * 64


class Installation:
    """A private temporary server layout mirroring the root-owned production paths."""

    def __init__(self, directory):
        self.root = pathlib.Path(directory)
        self.release = self.root / "release"
        self.receipts = self.root / "receipts"
        self.docker = self.root / "docker-config"
        self.runtime = self.root / "runtime"
        for path in (self.release, self.receipts, self.runtime):
            path.mkdir(mode=0o755)
        for name in (*dispatcher.RUNTIME_FILES, ".env"):
            (self.runtime / name).write_text("synthetic")
            (self.runtime / name).chmod(0o600)
        contents = {
            "runner": b"#!/usr/bin/env bash\necho runner\n",
            "inventory": b"#!/usr/bin/env bash\necho inventory\n",
            "normalizer": b"{ print }\n",
            "compose": b"services: {}\n",
            "pins": json.dumps({**json.loads((SOURCE.parents[1] / "deploy/manual-mvp-infrastructure-pins.json").read_text()), "redis": {"registryDigest": REDIS}}).encode(),
            "resume": b"#!/usr/bin/python3 -I\n",
        }
        self.hashes = {}
        for name, content in contents.items():
            path = self.release / dispatcher.FILES[name]
            path.write_bytes(content)
            path.chmod(0o644)
            self.hashes[name] = hashlib.sha256(content).hexdigest()
        self.config = dispatcher.Config(self.release, self.receipts, self.docker, os.getuid(), self.root, self.runtime)

    def receipt(self, **changes):
        receipt = {
            "version": 1, "commit": COMMIT, "runId": RUN_ID, "installation": "fresh",
            "backend": "ghcr.io/pavelars/capital-tracker-backend@sha256:" + "b" * 64,
            "frontend": "ghcr.io/pavelars/capital-tracker-frontend@sha256:" + "c" * 64,
            "postgres": POSTGRES, "redis": REDIS, "files": dict(self.hashes),
        }
        receipt.update(changes)
        return receipt

    def install_receipt(self, receipt, raw=None):
        path = self.receipts / "{}-{}.json".format(COMMIT, RUN_ID)
        path.write_bytes(raw if raw is not None else json.dumps(receipt).encode())
        path.chmod(0o600)
        return path


def request(operation):
    return {"version": 1, "operation": operation, "commit": COMMIT, "runId": RUN_ID}


class DispatchFlowAcceptance(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.install = Installation(self.directory.name)
        self.calls = []

    def tearDown(self):
        self.directory.cleanup()

    def run_dispatch(self, operation):
        def runner(argv, environment):
            self.calls.append((argv, environment))
            return 0
        return dispatcher.dispatch(request(operation), self.install.config, runner)

    def test_inventory_runs_only_the_fixed_read_only_script(self):
        self.assertEqual(self.run_dispatch("inventory"), 0)
        argv, environment = self.calls[0]
        self.assertEqual(argv, ["/bin/bash", str(self.install.release / "manual-mvp-inventory.sh")])
        self.assertEqual(set(environment), {"PATH", "HOME", "LANG", "LC_ALL", "DOCKER_CONFIG", "RELEASE_ROOT"})

    def test_deploy_uses_only_receipt_values_and_a_clean_environment(self):
        receipt = self.install.receipt()
        self.install.install_receipt(receipt)
        os.environ["CAPITAL_DISPATCH_LEAK"] = "must-not-pass"
        try:
            self.assertEqual(self.run_dispatch("deploy"), 0)
        finally:
            del os.environ["CAPITAL_DISPATCH_LEAK"]
        argv, environment = self.calls[0]
        self.assertEqual(argv, [
            "/bin/bash", str(self.install.release / "manual-mvp-release.sh"), "deploy", COMMIT,
            receipt["backend"], receipt["frontend"],
        ])
        self.assertEqual(environment["RELEASE_INSTALLATION"], "fresh")
        self.assertEqual(environment["RELEASE_POSTGRES_IMAGE"], POSTGRES)
        self.assertEqual(environment["RELEASE_REDIS_IMAGE"], REDIS)
        self.assertEqual(environment["RELEASE_COMPOSE_FILE"], str(self.install.release / "docker-compose.yml"))
        self.assertNotIn("CAPITAL_DISPATCH_LEAK", environment)
        # Never fall back to root's general registry credentials.
        self.assertEqual(environment["DOCKER_CONFIG"], str(self.install.docker))
        self.assertEqual(environment["RELEASE_ROOT"], str(self.install.runtime))
        self.assertEqual(environment["RELEASE_RUNTIME_FILE"], str(self.install.runtime / ".env.release"))
        self.assertEqual(environment["RELEASE_BACKUP_KEY_FILE"], str(self.install.runtime / ".backup-key"))

    def test_fresh_and_managed_existing_preflight_do_not_require_legacy_env(self):
        (self.install.runtime / ".env").unlink()
        self.install.install_receipt(self.install.receipt())
        self.assertEqual(self.run_dispatch("preflight"), 0)
        self.install.install_receipt(self.install.receipt(installation="existing"))
        with self.assertRaises(dispatcher.Refusal):
            self.run_dispatch("preflight")
        (self.install.runtime / ".release-managed-env").write_text("generated-runtime-only")
        self.assertEqual(self.run_dispatch("preflight"), 0)

    def test_preflight_passes_no_application_images(self):
        self.install.install_receipt(self.install.receipt(installation="existing"))
        self.run_dispatch("preflight")
        argv, environment = self.calls[0]
        self.assertEqual(argv[2:], ["preflight", COMMIT])
        self.assertEqual(environment["RELEASE_INSTALLATION"], "existing")

    def test_refuses_missing_symlinked_or_writable_receipt(self):
        for operation in ("preflight", "deploy"):
            with self.subTest(operation=operation):
                self.assertRaises(dispatcher.Refusal, self.run_dispatch, operation)
        target = self.install.root / "elsewhere.json"
        target.write_text(json.dumps(self.install.receipt()))
        (self.install.receipts / "{}-{}.json".format(COMMIT, RUN_ID)).symlink_to(target)
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        (self.install.receipts / "{}-{}.json".format(COMMIT, RUN_ID)).unlink()
        self.install.install_receipt(self.install.receipt()).chmod(0o666)
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        self.assertEqual(self.calls, [])

    def test_refuses_duplicate_keys_in_receipt(self):
        receipt = json.dumps(self.install.receipt())
        self.install.install_receipt(None, raw=('{"installation":"existing",' + receipt[1:]).encode())
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        self.assertEqual(self.calls, [])

    def test_refuses_installed_file_that_differs_from_receipt(self):
        self.install.install_receipt(self.install.receipt())
        for name in dispatcher.FILES:
            with self.subTest(name=name):
                path = self.install.release / dispatcher.FILES[name]
                original = path.read_bytes()
                path.write_bytes(original + b"\n# altered\n")
                self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
                path.write_bytes(original)
        self.assertEqual(self.calls, [])

    def test_refuses_receipt_infrastructure_that_differs_from_pins(self):
        other = "redis@sha256:" + "0" * 64
        self.install.install_receipt(self.install.receipt(redis=other))
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        self.assertEqual(self.calls, [])

    def test_refuses_replaceable_runtime_secret_or_directory(self):
        self.install.install_receipt(self.install.receipt())
        for name in dispatcher.RUNTIME_FILES:
            with self.subTest(name=name):
                path = self.install.runtime / name
                path.chmod(0o666)
                self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
                path.chmod(0o600)
        (self.install.runtime / ".backup-key").unlink()
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        (self.install.runtime / ".backup-key").write_text("synthetic")
        self.install.runtime.chmod(0o777)
        try:
            self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        finally:
            self.install.runtime.chmod(0o755)
        self.assertEqual(self.calls, [])

    def test_deploy_consumes_its_receipt_so_it_cannot_be_replayed(self):
        self.install.install_receipt(self.install.receipt())
        self.run_dispatch("preflight")
        self.assertEqual(self.run_dispatch("deploy"), 0)
        self.assertFalse((self.install.receipts / "{}-{}.json".format(COMMIT, RUN_ID)).exists())
        self.assertTrue((self.install.receipts / "used" / "{}-{}.json".format(COMMIT, RUN_ID)).exists())
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "preflight")
        self.assertEqual(len(self.calls), 2)

    def test_refuses_foreign_or_linked_entry_anywhere_in_runtime_directory(self):
        self.install.install_receipt(self.install.receipt())
        nested = self.install.runtime / "releases" / "previous"
        nested.mkdir(parents=True)
        (nested / "state").write_text("synthetic")
        self.run_dispatch("preflight")
        (nested / "state").chmod(0o646)
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "preflight")
        (nested / "state").chmod(0o600)
        (nested / "link").symlink_to("/etc/shadow")
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "preflight")
        self.assertEqual(len(self.calls), 1)

    @unittest.skipIf(os.geteuid() == 0, "root-owned files always satisfy the check")
    def test_only_named_runtime_paths_are_delegated_to_the_application_account(self):
        runtime = self.install.runtime
        (runtime / ".mfa-key").write_bytes(b"k" * 32)
        (runtime / ".mfa-key").chmod(0o600)
        (runtime / "operator").mkdir(mode=0o700)
        (runtime / "operator" / "recovery.json").write_text("{}")
        me = os.getuid()
        # Delegated paths are checked against the application uid, everything else against root/owner.
        self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_tree, runtime, me, self.install.root,
                          dispatcher.APPLICATION_OWNED, me + 4242)
        dispatcher.check_trusted_tree(runtime, me, self.install.root, (), None)
        (runtime / "operator" / "link").symlink_to("/etc/shadow")
        self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_tree, runtime, me, self.install.root,
                          dispatcher.APPLICATION_OWNED, me)

    @unittest.skipUnless(os.geteuid() == 0, "requires root to assign the application uid")
    def test_application_uid_is_accepted_only_at_delegated_paths(self):
        runtime = self.install.runtime
        (runtime / ".mfa-key").write_bytes(b"k" * 32)
        (runtime / "operator").mkdir(mode=0o700)
        (runtime / "operator" / "enrollment.json").write_text("{}")
        for path in (runtime / ".mfa-key", runtime / "operator", runtime / "operator" / "enrollment.json"):
            os.chown(path, 1000, 1000)
        config = dispatcher.Config(self.install.release, self.install.receipts, self.install.docker,
                                   0, self.install.root, runtime, 1000)
        dispatcher.check_trusted_tree(runtime, 0, self.install.root, dispatcher.APPLICATION_OWNED, 1000)
        (runtime / ".env").write_text("synthetic legacy env")
        os.chown(runtime / ".env", 1000, 1000)
        self.install.install_receipt(self.install.receipt())
        self.assertRaises(dispatcher.Refusal, dispatcher.dispatch,
                          {"version": 1, "operation": "preflight", "commit": COMMIT, "runId": RUN_ID},
                          config, lambda argv, env: 0)

    def test_refuses_docker_cli_plugins_in_registry_configuration(self):
        self.install.install_receipt(self.install.receipt())
        (self.install.docker / "cli-plugins").mkdir(parents=True)
        self.assertRaises(dispatcher.Refusal, self.run_dispatch, "preflight")
        self.assertEqual(self.calls, [])

    def test_refuses_writable_release_directory(self):
        self.install.install_receipt(self.install.receipt())
        self.install.release.chmod(0o777)
        try:
            self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy")
            self.assertRaises(dispatcher.Refusal, self.run_dispatch, "inventory")
        finally:
            self.install.release.chmod(0o755)
        self.assertEqual(self.calls, [])

    def test_uses_registry_credentials_only_from_trusted_root_configuration(self):
        self.install.install_receipt(self.install.receipt())
        self.install.docker.mkdir(mode=0o700)
        auth = self.install.docker / "config.json"
        auth.write_text("{}")
        auth.chmod(0o600)
        self.run_dispatch("preflight")
        self.assertEqual(self.calls[0][1]["DOCKER_CONFIG"], str(self.install.docker))
        auth.chmod(0o666)
        self.assertRaisesRegex(dispatcher.Refusal, "config.json: group or world writable", self.run_dispatch, "preflight")
        self.assertEqual(len(self.calls), 1)


class EnvironmentApprovedFlowAcceptance(unittest.TestCase):
    """RAP-002: the approved job's receipt replaces the owner-installed file."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.install = Installation(self.directory.name)
        (self.install.runtime / ".release-managed-env").write_text("generated-runtime-only")
        self.calls = []

    def tearDown(self):
        self.directory.cleanup()

    def run_dispatch(self, operation, receipt):
        def runner(argv, environment):
            self.calls.append((argv, environment))
            return 0
        request = {"version": 2, "operation": operation, "commit": COMMIT, "runId": RUN_ID, "receipt": receipt}
        parsed = dispatcher.read_request(io.BytesIO(json.dumps(request).encode()))
        return dispatcher.dispatch(parsed, self.install.config, runner)

    def test_release_runs_the_fixed_runner_without_an_installed_receipt(self):
        receipt = self.install.receipt(installation="existing")
        self.assertEqual(self.run_dispatch("preflight", receipt), 0)
        self.assertEqual(self.run_dispatch("deploy", receipt), 0)
        (_, preflight), (argv, environment) = self.calls
        self.assertEqual(self.calls[0][0][2:], ["preflight", COMMIT])
        self.assertEqual(argv, [
            "/bin/bash", str(self.install.release / "manual-mvp-release.sh"), "deploy", COMMIT,
            receipt["backend"], receipt["frontend"],
        ])
        self.assertEqual(environment["RELEASE_INSTALLATION"], "existing")
        self.assertEqual(preflight["RELEASE_INSTALLATION"], "existing")
        self.assertEqual(environment["DOCKER_CONFIG"], str(self.install.docker))
        # Nothing is read from or written to the owner-installed receipt directory.
        self.assertEqual(list(self.install.receipts.iterdir()), [])

    def test_release_ignores_an_owner_installed_receipt_for_the_same_run(self):
        self.install.install_receipt(self.install.receipt(installation="fresh"))
        self.run_dispatch("deploy", self.install.receipt(installation="existing"))
        self.assertEqual(self.calls[0][1]["RELEASE_INSTALLATION"], "existing")
        self.assertTrue((self.install.receipts / "{}-{}.json".format(COMMIT, RUN_ID)).exists())
        self.assertFalse((self.install.receipts / "used").exists())

    def test_refuses_embedded_receipt_that_differs_from_installed_files(self):
        for name in dispatcher.FILES:
            with self.subTest(name=name):
                receipt = self.install.receipt()
                receipt["files"] = {**receipt["files"], name: "0" * 64}
                self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy", receipt)
        self.assertEqual(self.calls, [])

    def test_refuses_foreign_identity_or_infrastructure(self):
        for changes in ({"commit": "b" * 40}, {"runId": "124"}, {"redis": "redis@sha256:" + "0" * 64}):
            with self.subTest(changes=changes):
                self.assertRaises(dispatcher.Refusal, self.run_dispatch, "deploy", self.install.receipt(**changes))
        self.assertEqual(self.calls, [])

    def test_resume_activation_passes_its_installation_to_the_runner(self):
        (self.install.runtime / ".release-managed-env").unlink()
        (self.install.runtime / ".env").unlink()
        self.assertEqual(self.run_dispatch("preflight", self.install.receipt(installation="resume-activation")), 0)
        self.assertEqual(self.calls[0][1]["RELEASE_INSTALLATION"], "resume-activation")


class EntryPointAcceptance(unittest.TestCase):
    def test_refuses_arguments_before_reading_input(self):
        stdin = io.BytesIO(json.dumps(request("inventory")).encode())
        self.assertEqual(dispatcher.main(["dispatcher", "--shell"], stdin), 2)
        self.assertEqual(stdin.tell(), 0)

    @unittest.skipIf(os.geteuid() == 0, "requires an unprivileged test user")
    def test_refuses_to_run_without_root(self):
        self.assertEqual(dispatcher.main(["dispatcher"], io.BytesIO(json.dumps(request("inventory")).encode())), 2)


if __name__ == "__main__":
    unittest.main()
