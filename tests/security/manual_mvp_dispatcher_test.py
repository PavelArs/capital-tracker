"""MVP-007: adversarial contracts for the root-owned SSH dispatcher."""

import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock


SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/manual-mvp-dispatcher.py"
spec = importlib.util.spec_from_file_location("manual_mvp_dispatcher", SOURCE)
dispatcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)


class DispatcherRequestAcceptance(unittest.TestCase):
    def setUp(self):
        self.request = {"version": 1, "operation": "deploy", "commit": "a" * 40, "runId": "123"}

    def parse(self, data):
        return dispatcher.read_request(io.BytesIO(data))

    def receipt(self):
        return {
            "version": 1, "commit": self.request["commit"], "runId": self.request["runId"],
            "installation": "fresh", "backend": "ghcr.io/pavelars/capital-tracker-backend@sha256:" + "b" * 64,
            "frontend": "ghcr.io/pavelars/capital-tracker-frontend@sha256:" + "c" * 64,
            "postgres": "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64,
            "redis": "redis@sha256:" + "e" * 64,
            "files": {name: "f" * 64 for name in ("runner", "inventory", "normalizer", "compose", "pins")},
        }

    def test_accepts_only_data_request(self):
        self.assertEqual(self.parse(json.dumps(self.request).encode()), self.request)

    def test_rejects_shell_path_image_environment_and_unknown_fields(self):
        for extra in ("command", "path", "compose", "backend", "postgres", "env", "args"):
            with self.subTest(extra=extra):
                self.assertRaises(dispatcher.Refusal, self.parse, json.dumps({**self.request, extra: "sh -c id"}).encode())

    def test_rejects_duplicate_keys_trailing_data_and_oversized_input(self):
        for data in (
            b'{"version":1,"version":1,"operation":"deploy","commit":"' + b"a" * 40 + b'","runId":"123"}',
            json.dumps(self.request).encode() + b"\n{}",
            b" " * 4097,
        ):
            with self.subTest(data=data[:40]):
                self.assertRaises(dispatcher.Refusal, self.parse, data)

    def test_rejects_unapproved_operation_and_malformed_identity(self):
        for replacement in (
            {"operation": "shell"}, {"operation": "docker"}, {"commit": "A" * 40},
            {"commit": "a" * 39}, {"runId": "0"}, {"runId": "01"}, {"runId": 123},
        ):
            with self.subTest(replacement=replacement):
                self.assertRaises(dispatcher.Refusal, self.parse, json.dumps({**self.request, **replacement}).encode())

    def test_rejects_requested_deploy_without_independent_receipt(self):
        with self.assertRaises(dispatcher.Refusal):
            dispatcher.validate_receipt(self.request, None)

    def test_rejects_receipt_for_other_run_commit_or_installation(self):
        receipt = self.receipt()
        for replacement in ({"commit": "b" * 40}, {"runId": "124"}, {"installation": "other"}):
            with self.subTest(replacement=replacement):
                with self.assertRaises(dispatcher.Refusal):
                    dispatcher.validate_receipt(self.request, {**receipt, **replacement})

    def test_rejects_unpinned_or_altered_images(self):
        receipt = self.receipt()
        for field in ("backend", "frontend", "postgres", "redis"):
            with self.subTest(field=field):
                with self.assertRaises(dispatcher.Refusal):
                    dispatcher.validate_receipt(self.request, {**receipt, field: "alpine:latest"})
        swapped = {**receipt, "backend": receipt["frontend"], "frontend": receipt["backend"]}
        foreign = {**receipt, "frontend": "ghcr.io/other/capital-tracker-frontend@sha256:" + "c" * 64}
        both_foreign = {
            **receipt,
            "backend": "ghcr.io/other/capital-tracker-backend@sha256:" + "b" * 64,
            "frontend": "ghcr.io/other/capital-tracker-frontend@sha256:" + "c" * 64,
        }
        for changed in (swapped, foreign, both_foreign):
            with self.assertRaises(dispatcher.Refusal):
                dispatcher.validate_receipt(self.request, changed)

    def test_rejects_unknown_receipt_fields_and_invalid_file_hash(self):
        receipt = self.receipt()
        for changed in ({**receipt, "shell": "id"}, {**receipt, "files": {**receipt["files"], "runner": "0"}}):
            with self.assertRaises(dispatcher.Refusal):
                dispatcher.validate_receipt(self.request, changed)

    def test_invokes_only_fixed_runner_with_clean_environment(self):
        receipt = self.receipt()
        with mock.patch.dict(os.environ, {"BASH_ENV": "/tmp/attacker", "RELEASE_ROOT": "/tmp/attacker"}):
            with mock.patch.object(dispatcher, "verify_installation"), mock.patch.object(dispatcher, "check_trusted_tree"), mock.patch.object(dispatcher, "check_trusted_file", return_value=("0" * 64, b"")):
                argv, environment = dispatcher.build_command(self.request, dispatcher.Config(), receipt)
        self.assertEqual(argv[:3], ["/bin/bash", str(dispatcher.RELEASE_DIR / dispatcher.FILES["runner"]), "deploy"])
        self.assertEqual(argv[3:], [self.request["commit"], receipt["backend"], receipt["frontend"]])
        self.assertNotIn("BASH_ENV", environment)
        self.assertEqual(environment["RELEASE_ROOT"], "/opt/capital-tracker")
        self.assertEqual(environment["RELEASE_COMPOSE_FILE"], str(dispatcher.RELEASE_DIR / dispatcher.FILES["compose"]))

    def test_checks_root_owned_runtime_inputs_before_privileged_runner(self):
        receipt = self.receipt()
        with mock.patch.object(dispatcher, "verify_installation"), mock.patch.object(dispatcher, "check_trusted_tree") as tree:
            with mock.patch.object(dispatcher, "check_trusted_file", return_value=("0" * 64, b"")) as checked:
                dispatcher.build_command(self.request, dispatcher.Config(), receipt)
        paths = {str(call.args[0]) for call in checked.call_args_list}
        self.assertIn("/opt/capital-tracker", {str(call.args[0]) for call in tree.call_args_list})
        self.assertTrue({"/opt/capital-tracker/.env", "/opt/capital-tracker/.env.release", "/opt/capital-tracker/.backup-key"} <= paths)

    def test_rejects_modified_installed_file_and_unreviewed_pins(self):
        receipt = self.receipt()
        with tempfile.TemporaryDirectory() as directory:
            files = {}
            for name in dispatcher.FILES:
                path = pathlib.Path(directory) / dispatcher.FILES[name]
                path.write_bytes(b"reviewed")
                files[name] = path
                receipt["files"][name] = __import__("hashlib").sha256(b"reviewed").hexdigest()
            pins = {"postgres": json.loads((SOURCE.parents[1] / "deploy/manual-mvp-infrastructure-pins.json").read_text())["postgres"], "redis": {"registryDigest": receipt["redis"]}}
            files["pins"].write_text(json.dumps(pins))
            receipt["files"]["pins"] = __import__("hashlib").sha256(files["pins"].read_bytes()).hexdigest()
            config = dispatcher.Config(release_dir=directory, owner_uid=os.getuid(), stop_at=directory)
            dispatcher.verify_installation(receipt, config)
            files["compose"].write_bytes(b"attacker")
            self.assertRaises(dispatcher.Refusal, dispatcher.verify_installation, receipt, config)
            files["compose"].write_bytes(b"reviewed")
            pins["redis"]["registryDigest"] = "redis@sha256:" + "0" * 64
            files["pins"].write_text(json.dumps(pins))
            receipt["files"]["pins"] = __import__("hashlib").sha256(files["pins"].read_bytes()).hexdigest()
            self.assertRaises(dispatcher.Refusal, dispatcher.verify_installation, receipt, config)


class TrustedFileAcceptance(unittest.TestCase):
    def test_rejects_symlink_and_writable_file_or_ancestor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            file = root / "runner"
            file.write_text("fixed")
            dispatcher.check_trusted_file(file, os.getuid(), stop_at=root)
            file.chmod(0o666)
            self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_file, file, os.getuid(), root)
            file.chmod(0o600)
            link = root / "link"
            link.symlink_to(file)
            self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_file, link, os.getuid(), root)
            root.chmod(0o777)
            self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_file, file, os.getuid(), root)

    def test_rejects_receipt_write_access_for_deploy_principal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text("{}")
            receipt.chmod(0o666)
            self.assertRaises(dispatcher.Refusal, dispatcher.check_trusted_file, receipt, os.getuid(), root)


if __name__ == "__main__":
    unittest.main()
