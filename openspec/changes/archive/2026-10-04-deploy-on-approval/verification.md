# Verification: deploy-on-approval

All checks below ran in the cloud sandbox on 2026-10-04 against branch
`claude/unrealized-pnl-hw9vnz` (base main `2316772`), unless marked otherwise.

## RED (tests written first, implementation absent)

- Engineering specs (`jest src/engineering/{manual-mvp-orchestration,release-approval,gates}.spec.ts`):
  13 failed, 216 passed. Failing: RAP-003-A (both), RAP-003-C, ENG-002-A (both),
  ENG-002-B (both), RAP-001-A (three), RAP-001-C, RAP-002-A, RAP-004-A. The failures
  were the expected missing behaviour: no `workflow_run` trigger or `release` mode, the
  runner exiting 2 for `resume-activation`, `existing` exiting without a message, and
  the Compose health check on `localhost:80`.
- Security tests (`python3 -m unittest discover -s tests/security`): 12 errors, all
  `Refusal: unexpected request fields` (version 2 unsupported) or the unknown
  `resume-activation` installation.
- Installer tests: 3 failures, all printing the old usage line (no `update`).
- RAP-003-B refusals and the version 2 flow refusals already passed before the change,
  because an unknown installation or request version is refused outright. They now
  pass on the specific checks (verified by their refusal messages in the runner and
  by the installed-file digest checks in the dispatcher).

## GREEN

- Backend: 60 suites, 1593 tests passed (`pnpm --dir backend test --runInBand`);
  previously 1578, plus 15 new.
- Engineering gates: `pnpm test:engineering` 196 + 10 passed.
- Security tests: 93 ran (80 before, 13 new), OK; 3 skipped (root-only or non-root-only cases).
- ENG-002 and ENG-005-B gate assertions were rewritten to the new step conditions
  (`env.RELEASE_MODE`) with the same exact-match strictness; none were removed.
- Backend lint: 0 errors, 77 warnings (unchanged from main). Backend build and
  `tsc --noEmit` passed.
- OpenSpec: `openspec validate --all --strict` 50/50 passed.

## Not run here

- Hosted CI (Playwright critical acceptance, image scans): pending on the PR.
- The real `workflow_run` trigger and environment approval only exist on GitHub after
  merge; the step script was executed locally with a synthetic `ssh`.
- The server `update`, `resume-activation` preflight/deploy and the frontend health
  fix have not run on the host. The IPv6 `localhost` cause of the 2026-10-02 failure
  is an inference from configuration, not an observed host log.

## Hosted CI and first approved release (2026-10-04)

- PR run 37218242193 passed the same tree; main CI 37218384482 failed VAL-UI on a
  frontend race fixed by `fix-analytics-journal-race`.
- First dispatch (run 37227454002, `release` + `resume-activation`) failed with
  `refused: unexpected request fields`: the server still ran the pre-change dispatcher.
  The owner ran the installer `update` as root from a clean `3bdceea` checkout; the
  seven installed files matched that commit's SHA-256. The re-run reached preflight,
  which refused `Activation resume refused: a release is already activated; use
  existing`: the server already had the activation metadata, so the interrupted
  activation recorded on 2026-10-02 had been completed before this change. Neither
  refusal changed server state.
- Main CI 37225929714 on `3bdceea` (main through #45): every job green, including
  critical release acceptance and image scans.
- Deploy Manual MVP run 37227344833 (automatic `workflow_run`, attempt 2, approved by
  the owner in the `production` environment, installation `existing`): provenance,
  promotion, preflight and deploy succeeded; one migration applied after the encrypted
  backup, backend and frontend healthy, release verified. The tag job created
  `v2026.10.04-3bdceea` on `3bdceea`. The owner confirmed the new sidebar on the live
  site.
