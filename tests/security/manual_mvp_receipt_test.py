"""MVP-007: CI receipts bind the reviewed repository files to the dispatcher."""

import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


receipts = load("manual_mvp_receipt", "scripts/manual-mvp-receipt.py")
dispatcher = receipts.dispatcher

COMMIT = "f" * 40
BACKEND = "ghcr.io/pavelars/capital-tracker-backend@sha256:" + "b" * 64
POSTGRES = "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64
FRONTEND = "ghcr.io/pavelars/capital-tracker-frontend@sha256:" + "c" * 64


class ReceiptAcceptance(unittest.TestCase):
    def test_resume_receipt_requires_original_infrastructure_and_consumed_origin(self):
        pins = json.loads((ROOT / receipts.SOURCES["pins"]).read_text())
        original_postgres = "ghcr.io/pavelars/capital-tracker-postgres@sha256:c6a966be9561266a345c4c705a01a20fb82a061c3827e95b39e7127f7527f58f"
        expected_origin = {
            "commit": "0f479b3955aba1cf351a29e897c7ffbdc9909638",
            "ciRunId": "36900868365",
            "usedReceiptSha256": "56db9c19cfc8f5c5d08359e5f53f9c2122f369857123172f1e29168f4d61ebc3",
        }
        self.assertEqual(pins["resumeOrigin"], expected_origin)
        receipt = receipts.build_receipt(COMMIT, "77", "resume-fresh", BACKEND, FRONTEND, original_postgres)
        self.assertEqual(receipt["installation"], "resume-fresh")
        self.assertEqual(receipt["resumeOrigin"], expected_origin)
        self.assertEqual(receipt["postgres"], pins["postgres"]["registryDigest"])
        for changed in (
            {**receipt, "resumeOrigin": {**expected_origin, "ciRunId": "36914835760"}},
            {**receipt, "postgres": POSTGRES},
            {**receipt, "resumeOrigin": None},
        ):
            with self.subTest(changed=changed):
                self.assertRaises(dispatcher.Refusal, dispatcher.validate_receipt,
                                  {"version": 1, "operation": "deploy", "commit": COMMIT, "runId": "77"}, changed)
        for old_identity in ({"commit": expected_origin["commit"]}, {"runId": expected_origin["ciRunId"]}):
            changed = {**receipt, **old_identity}
            request = {"version": 1, "operation": "deploy", "commit": changed["commit"], "runId": changed["runId"]}
            with self.assertRaises(dispatcher.Refusal):
                dispatcher.validate_receipt(request, changed)

    def test_repository_receipt_is_accepted_by_an_identical_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            release, receipts_dir = base / "release", base / "receipts"
            release.mkdir(mode=0o755)
            receipts_dir.mkdir(mode=0o755)
            for name, source in receipts.SOURCES.items():
                target = release / dispatcher.FILES[name]
                shutil.copyfile(ROOT / source, target)
                target.chmod(0o644)
            output = receipts_dir / "{}-77.json".format(COMMIT)
            self.assertEqual(receipts.main(["receipt", COMMIT, "77", "fresh", BACKEND, FRONTEND, POSTGRES, str(output)]), 0)
            output.chmod(0o600)
            pins = json.loads((ROOT / receipts.SOURCES["pins"]).read_text())
            self.assertEqual(json.loads(output.read_text())["postgres"], POSTGRES)
            calls = []
            runtime = base / "runtime"
            runtime.mkdir(mode=0o755)
            for name in dispatcher.RUNTIME_FILES:
                (runtime / name).write_text("synthetic")
                (runtime / name).chmod(0o600)
            config = dispatcher.Config(release, receipts_dir, base / "docker", os.getuid(), base, runtime)
            request = {"version": 1, "operation": "deploy", "commit": COMMIT, "runId": "77"}
            dispatcher.dispatch(request, config, lambda argv, env: calls.append(argv) or 0)
            self.assertEqual(calls[0][-2:], [BACKEND, FRONTEND])

    def test_refuses_mutable_or_malformed_inputs(self):
        for arguments in (
            (COMMIT, "77", "fresh", "ghcr.io/pavelars/backend:latest", FRONTEND),
            (COMMIT, "77", "upgrade", BACKEND, FRONTEND),
            (COMMIT.upper(), "77", "fresh", BACKEND, FRONTEND),
            (COMMIT, "077", "fresh", BACKEND, FRONTEND),
            (COMMIT, "77", "fresh", BACKEND, BACKEND),
        ):
            with self.subTest(arguments=arguments):
                self.assertRaises(dispatcher.Refusal, receipts.build_receipt, *arguments, POSTGRES)


    def test_bootstrap_receipt_requires_trusted_exact_fresh_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            receipt = receipts.build_receipt(COMMIT, "77", "fresh", BACKEND, FRONTEND, POSTGRES)
            path = base / "reviewed.json"
            path.write_text(json.dumps(receipt))
            path.chmod(0o600)
            redis = receipt["redis"]
            self.assertEqual(receipts.validate_bootstrap_receipt(path, POSTGRES, redis, COMMIT, owner_uid=os.getuid(), stop_at=base), receipt)
            for postgres in ("postgres@sha256:" + "d" * 64, POSTGRES[:-1] + "0"):
                self.assertRaises(dispatcher.Refusal, receipts.validate_bootstrap_receipt, path, postgres, redis, COMMIT, owner_uid=os.getuid(), stop_at=base)
            path.chmod(0o666)
            self.assertRaises(dispatcher.Refusal, receipts.validate_bootstrap_receipt, path, POSTGRES, redis, COMMIT, owner_uid=os.getuid(), stop_at=base)
            path.chmod(0o600)
            link = base / "linked.json"
            link.symlink_to(path)
            self.assertRaises(dispatcher.Refusal, receipts.validate_bootstrap_receipt, link, POSTGRES, redis, COMMIT, owner_uid=os.getuid(), stop_at=base)
            for changes in ({"installation": "existing"}, {"commit": "invalid"}, {"commit": "0" * 40}, {"runId": "01"}, {"extra": True}, {"files": {**receipt["files"], "pins": "0" * 64}}):
                path.write_text(json.dumps({**receipt, **changes}))
                self.assertRaises(dispatcher.Refusal, receipts.validate_bootstrap_receipt, path, POSTGRES, redis, COMMIT, owner_uid=os.getuid(), stop_at=base)

    def test_receipt_rejects_official_base_and_foreign_final_postgres(self):
        for postgres in ("postgres@sha256:" + "d" * 64, "ghcr.io/other/capital-tracker-postgres@sha256:" + "d" * 64):
            self.assertRaises(dispatcher.Refusal, receipts.build_receipt, COMMIT, "77", "fresh", BACKEND, FRONTEND, postgres)


if __name__ == "__main__":
    unittest.main()
