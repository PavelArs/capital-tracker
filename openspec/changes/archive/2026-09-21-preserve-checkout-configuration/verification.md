# Verification: preserve-checkout-configuration

2026-09-21. Only harness preservation changed; runtime images/authentication and
financial behavior are unchanged.

- Actual RED/characterization: `/tmp/capital-preservation-red.log`. The unchanged
  artifact script inspected the actual isolated images/network and passed with the
  original local Nginx file. In a disposable checkout-shaped directory containing
  the tracked Nginx bytes, that same script failed its machine-specific checksum
  assertion. The original file was never edited. The temporary directory and
  synthetic Docker stack were removed.
- `pnpm verify:baseline`: exit0, `/tmp/capital-preservation-baseline.log`. Strict
  six-item OpenSpec validation, builds/lint,314 backend tests/14 suites and69 frontend
  tests/9 files passed. This includes18 independent real temporary-file preservation
  cases. Two initial test failures were native fs Error realm comparisons; replacing
  those comparisons with exact ENOENT assertions preserved the failure/no-repair
  oracle. They are not claimed as behavior RED.
- `pnpm test:e2e`: exit0, `/tmp/capital-preservation-image.log`. All existing
  PostgreSQL migrations/CLI/session checks and34 HTTPS Chromium cases passed in3.3m,
  zero retries. The guard reported preservation only after complete cleanup.
- Exact tested images remain backend
  `sha256:182da8ffadafdba439fec2ac68c81e02babe15601d49cae69bbbe59249ec39fa`
  and frontend
  `sha256:b2a85d0990ccb1b4cc4de689b6de3a327a8987fe801188231b6f4bcd07bb9cc1`.
- Owner configuration remains SHA256
  `115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`, mode0644.
  It is not required as a portable CI baseline and remains outside refactor commits.

Independent QA (`gate_acceptance`) wrote tests before implementation; implementation
was bounded to three scripts (`provider_feasibility`). Independent security review
(`audit_security`) found no blocking issue and confirmed every existing image/network
assertion remained. Root reviewed wiring and executed actual Docker acceptance.

ISO-005-C/D map to scripts/preserve-file.cjs and engineering/gates-preservation.spec.ts;
acceptance.mjs wraps TLS generation, build, tests and cleanup. Failed checks never
overwrite or restore the observed file. Before/after comparison does not detect
transient changes restored before completion, and forced process termination cannot
execute JavaScript finally. Those are explicit limits, not claims of continuous
filesystem monitoring.

No production/owner data access, deployment or folder consolidation occurred. Hosted
CI has not run. Mandatory MFA and the rest of the brief remain active work.
