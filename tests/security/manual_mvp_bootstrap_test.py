"""Privileged bootstrap rejects unsafe metadata without importing caller modules."""

import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class BootstrapImportBoundary(unittest.TestCase):
    def test_receipt_refusal_does_not_execute_cwd_or_pythonpath_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            fake_bin = base / "bin"
            fake_bin.mkdir()
            # Exercise only the pre-mutation receipt boundary without real root.
            fake_id = fake_bin / "id"
            fake_id.write_text("#!/bin/sh\nprintf '0\\n'\n")
            fake_id.chmod(0o755)
            sentinel = base / "shadow-executed"
            for name in ("json", "pathlib", "subprocess"):
                (base / (name + ".py")).write_text(
                    "open({!r}, 'w').write('executed')\nraise RuntimeError('shadow module')\n".format(str(sentinel))
                )
            environment = {**os.environ, "PATH": str(fake_bin) + ":/usr/bin:/bin", "PYTHONPATH": str(base)}
            result = subprocess.run([
                "/bin/bash", str(ROOT / "scripts/manual-mvp-server-bootstrap.sh"), "capital-release",
                "ghcr.io/pavelars/capital-tracker-postgres@sha256:" + "d" * 64,
                "redis@sha256:" + "e" * 64, str(base / "missing-receipt.json"),
            ], cwd=base, env=environment, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(sentinel.exists(), result.stdout + result.stderr)
            self.assertIn("Bootstrap receipt validation refused", result.stderr)


if __name__ == "__main__":
    unittest.main()
