## Context

At base `a661fc4`, `docker-build` waits for four application build/test jobs but has no dependency on `dependency-audit` or `spec-check`. The existing nine-job aggregate fails closed, yet that final result cannot prevent expensive acceptance work from starting earlier.

## Goals / Non-Goals

**Goals:** Require both early gates to succeed before release work starts, retain application prerequisites and reject bypasses through executable workflow policy tests.

**Non-Goals:** Remediate dependencies, delete the full 174-case browser suite, change its one worker/zero retries or 180-minute job timeout, weaken image security gates, run local Docker/server operations or claim hosted verification.

## Decisions

Add the two jobs to the existing `docker-build.needs` list. Retain no job-level `if`, so GitHub Actions' default successful-dependency scheduling applies; reject `continue-on-error` at the release job and prerequisite jobs. An `always()` condition would defeat skipped-on-failure scheduling; moving the audit into a release step would waste setup cost and obscure the existing independent gate.

Test the parsed actual workflow's exact six-prerequisite graph and absent job-level conditions rather than simulate Actions scheduling. Existing ENG-001/DEP-001 tests execute the real aggregate command for failure/cancelled/skipped/missing outcomes. These policy tests prove wiring; a hosted run remains separate evidence. GitHub's documented `needs` behavior is at https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds.

## Risks / Trade-offs

- Successful runs wait for specification/security checks before release setup; those jobs already run in parallel and are required for release acceptance.
- An audit outage blocks release work as intended; neither advisories nor registry errors are suppressed.
- Future intentional graph changes require updating the exact prerequisite oracle with a reviewed contract change.

No schema migration, provider quota, credentials or data impact. Rollback is reverting this bounded workflow dependency change; aggregate fail-closed behavior remains required.

## Owner-requested temporary E2E pause

The owner's 2026-10-01 override requests temporarily omitting E2E in CI and restoring it later. A committed workflow environment string `CI_E2E_ENABLED: "false"` gates browser installation and the unchanged complete `pnpm test:e2e` command on exact string `true`. While paused, an explicit synthetic Compose build creates backend/frontend/PostgreSQL scan images with the checkout revision; infrastructure verification and all four scans/enforcement remain unconditional. The existing runner bundles database migration/accounting probes, provider fixture setup, HTTPS startup and browser tests, so none of those runtime probes are executed during this pause. No runtime-success claim is made from image build/scan success.

Rename the job `Release Images and Security` so its successful result describes the checks actually performed. Candidate export/upload additionally require `success()` and the named `real-acceptance` step's successful conclusion. This prevents skipped acceptance or a failed prior security step from exporting release artifacts; reports upload only for enabled acceptance.

CD retains all existing run/commit/main/provenance rules, requires the new job name, and executes an additional actual API step-result check for `Run full real acceptance` success. This guard applies to all non-inventory modes before downloads, publishing or server access. Tests execute this actual embedded Node validation with synthetic jobs JSON, including a successful obsolete job name, so skipped/absent/failed/cancelled/unknown acceptance is rejected even when every job conclusion is successful.

Restoration: change the committed flag to string `true` in a reviewed change and update the temporary-default acceptance assertion/spec accordingly. The full runner and candidate export path remain available without reconstructing removed code. A successful new trusted main CI run with full acceptance is still required before promotion/preflight/deployment; paused CI cannot supply it. Independent review approved this design before implementation; final source review remains required.
