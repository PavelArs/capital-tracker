# Verification record

The actual failed production CD run `36914835760` created PG18/Redis containers, volumes, and network, then logged a missing `pg_restore` socket. The source accepted Unix-socket readiness, which can include PostgreSQL's temporary init server, and fell through after exhausted attempts. The entrypoint race is an evidence-based inference, not a proven host log diagnosis. The recovery code keeps the existing resources intact and adds an explicit separately approved `resume-fresh` path; no production retry has run.

## Test-first evidence

- Before the readiness edit, `pnpm --dir backend exec jest src/engineering/manual-mvp-orchestration.spec.ts --runInBand --testNamePattern='MRR-001'` failed both new process cases: socket-only readiness was accepted and never-ready attempts fell through. After the edit, both passed. This is process-level evidence, not real PostgreSQL evidence.
- Before receipt implementation, `python3 -B -m unittest tests.security.manual_mvp_receipt_test.ReceiptAcceptance.test_resume_receipt_requires_original_infrastructure_and_consumed_origin` failed because `resumeOrigin` was absent. The targeted case passed after implementation.
- The historical receipt fixture is the exact published, public, no-secret JSON for old main `0f479b3955aba1cf351a29e897c7ffbdc9909638` and CI run `36900868365`; its SHA256 is `56db9c19cfc8f5c5d08359e5f53f9c2122f369857123172f1e29168f4d61ebc3`. It is provenance only and cannot authorize a new deployment.

## Local checks

- `python3 -B -m unittest discover -s tests/security -p '*_test.py'`: 80 tests ran, one pre-existing root-only fixture skipped (local unprivileged run). A complete initial run found one old dispatcher test fixture lacking the new pin shape; the fixture was updated and the rerun passed.
- Focused orchestration and validator Jest suites: 63/63 passed, including positive and negative resume process cases and all retained fixed runner cases. `pnpm test:engineering` passed 196/196 Jest checks and 4/4 Node checks after its changed CI step name was reflected in the static contract test. The hosted PostgreSQL fixture has syntax/static checks only locally because Docker is unavailable.
- Strict OpenSpec validation: 48/48 items passed, including `fix-interrupted-mvp-release`.
- Shell/Node syntax and `git diff --check` passed. The unchanged full manual E2E suite remains available; its local PostgreSQL build path is preserved.

## Required external gates

Hosted CI must still run the exact pinned private PG18 fixture, the 20-case real critical acceptance, all four image scans, and manifest/receipt gates for the new main commit. Then an owner must review and approve a distinct single-use receipt, run read-only host preflight, and supervise the resume deploy. Until those actual gates pass, production is not recovered and this change must not be described as deployed.

The first PR CI run `36976380731` stopped at Backend Lint & Format: Biome reported two errors and 77 warnings over 243 files. The run's other completed audit, specification/engineering, and application test jobs passed; image build and the real PG/critical acceptance never ran. Locally, Biome identified formatting in two changed engineering test files. Commit `722553d` formatted only those files; their TypeScript ASTs are identical before and after, the three changed-file Biome check passes, and `pnpm --dir backend lint` exits zero with the 77 existing warnings. A new hosted CI run is required for the updated commit.

## Merged-main release evidence — 2026-10-02

PR #27 CI run `36977222334` completed **10/10 jobs successfully** on synthetic source `33c80104fb19623827ec8ef9067445e1f4f281e0`; its selected critical acceptance passed **20/20**, including MRR-001-A/B. This is PR-source evidence, not the result for the merged main commit.

Merged main `1826a8014694ad5894bd60ea95800253ff569adf` then ran hosted CI `36980010964`. Eight prerequisite jobs succeeded, while the release job and aggregate CI status failed at the real critical acceptance: **19 passed, 1 failed in 17.4 minutes**. The sole failure was CSV-006-A: the admission fixture returned `live=false` when `tests/e2e/admission-fixtures.ts` required a live delta. MRR-001-A/B passed. The failure log is `/private/tmp/capital-tracker-main-ci-36980010964-release-110752574666.log`; it contains the failing assertion and full Playwright result. The bounded fixture fix is under diagnosis. This evidence does not identify a product contract defect and does not authorize weakening the assertion or changing the CSV contract.

No valid receipt, candidate export, image scan, promotion, or new deployment resulted from the failed merged-main run. The prior production deploy `36914835760` remains failed during restore after creating PostgreSQL/Redis resources; preserve those resources and their data. No fresh bootstrap, retry, prune, reset, removal, or recreation has occurred. Local Docker remains unavailable. Task 3.3 remains unchecked, the OpenSpec change remains active, and other active changes remain unarchived. This hosted failure does not supersede the historical PR-source pass or establish recovery/deployment.
