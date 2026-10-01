# Verification: gate-release-work-on-audit

Base: `a661fc46453b2244ca78d26f3411b97b922d8790`. Worktree:
`/Users/pavelars/Projects/temp/capital-tracker-ci-audit-gate`, branch `fix/ci-audit-gate`.
Date: 2026-10-01. No archive or release-completion claim.

## Acceptance scope and actual RED

ENG-004-A/B policy tests parse the actual workflow, require all six prerequisites,
reject job-level bypasses, and execute the real aggregate with early-gate failure,
cancelled or skipped plus skipped release. Before YAML implementation, ENG-004
ran three selected tests: one intended failure (actual prerequisite graph omitted
`dependency-audit` and `spec-check`), two passes, 165 unrelated tests skipped.
After the minimal needs change, the full gate file passed 168/168.

The owner then explicitly requested temporarily omitting CI E2E. Independent
reviewer `/root/axios_review` approved the proposed reversible pause/build/scan/CD
guard design before its implementation, requiring export to depend on successful
acceptance rather than the flag alone.

ENG-005-A/B/C tests inspect actual conditional wiring and execute the CD workflow's
embedded Node provenance validator against real synthetic `jobs.json` files. The
fixtures include all successful current jobs and a successful obsolete acceptance
job name; this must not substitute for successful full-acceptance step evidence.
Before pause implementation, nine selected tests produced seven intended failures:
missing false default, missing export guard and five wrongly accepted acceptance
results (absent, skipped, failure, cancelled and unknown). Security scan preservation
and true-success characterization passed; 168 unrelated tests were skipped.

An earlier isolated invocation lacked TypeScript type resolution and ran zero tests;
that environment failure is not RED. Explicit installed integration typeRoots fixed
the invocation without disabling diagnostics or changing dependencies. An initial
provenance fixture lacked the obsolete required job name and therefore could not
demonstrate the step-result bypass; the final actual RED above corrected that fixture
before implementation.

## Actual GREEN and commands

Node `v22.23.2`; pinned pnpm `10.33.0` verified via the cached executable directory
`/Users/pavelars/Library/pnpm/.tools/pnpm/10.33.0/bin`. No install, dependency,
package manifest or lockfile mutation. Existing integration Jest/ts-jest dependencies
were used read-only with this command from the isolated worktree:

```sh
NODE_PATH=/Users/pavelars/Projects/temp/capital-tracker-mvp/backend/node_modules:/Users/pavelars/Projects/temp/capital-tracker-mvp/node_modules /Users/pavelars/.nvm/versions/node/v22.23.2/bin/node /Users/pavelars/Projects/temp/capital-tracker-mvp/backend/node_modules/jest/bin/jest.js --config backend/package.json --rootDir /Users/pavelars/Projects/temp/capital-tracker-ci-audit-gate/backend/src --globals '{"ts-jest":{"tsconfig":{"typeRoots":["/Users/pavelars/Projects/temp/capital-tracker-mvp/backend/node_modules/@types"],"types":["node","jest"]}}}' --runInBand --no-coverage engineering/gates --silent
```

Result: **195/195 PASS**, two suites, 7.932 seconds on the final assertion revision
(earlier expanded scope: 7.032 seconds). The standalone final gate file
also passed 177/177 before the final report/build preservation assertions. ts-jest
warned that CLI `globals` configuration is deprecated; no diagnostic suppression.

Scoped Biome check, using `backend` configuration, and `git diff --check` pass.
An earlier root-directory Biome invocation used its default formatting; rerunning
with the actual backend configuration and formatting the changed file corrected it.
OpenSpec 1.2.0 actual `new change`, artifact `status`/`instructions` and `instructions
apply` were used; all artifacts are ready. Strict all validation passes 46/46 items:

```sh
OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive
/Users/pavelars/Projects/temp/capital-tracker-mvp/backend/node_modules/.bin/biome check --config-path backend backend/src/engineering/gates.spec.ts
git diff --check
```

## Preservation, restoration and limits

The manual `pnpm test:e2e` script/runner, 174 retained browser scenarios,
`workers: 1`, `retries: 0`, 180-minute CI budget, application prerequisites,
infrastructure verification, four Trivy scans and exact-image enforcement remain.
Candidate export/upload are retained behind enabled successful full acceptance and
prior successful checks. The nine-job aggregate and its command are unchanged.
Read-only CD inventory remains available; non-inventory modes require actual
successful full-acceptance step provenance before any download/publishing/server step.

Restore through a reviewed source change setting `CI_E2E_ENABLED: "true"`, updating
the temporary-default test/spec and running trusted current-main complete CI.
Setting a repository variable cannot override this committed workflow switch.

`git diff a661fc4 -- package.json pnpm-lock.yaml playwright.config.ts scripts/acceptance.mjs tests/e2e`
is empty. Lockfile SHA256 remains
`7db95986acc2a8c4fbef9bf9be34c7296b51fe2aa821bcc215db5d8e36f289ba`.

Policy checks prove the workflow graph/conditions and actual CD validation command,
not hosted scheduler execution or runtime security. No local Docker, actual image
build/scan, hosted CI, production audit, database migration/accounting probe,
HTTPS/TLS/authentication/browser run, promotion, server access, deployment or remote
push was performed. During paused CI the bundled real PostgreSQL and HTTPS/browser
acceptance checks do not run; green paused CI is not release candidate evidence.
Full product/MVP release remains incomplete. Archive is intentionally unperformed.

## Independent source review and remaining hosted gate

Root reported independent review **APPROVED** for frozen source commit
`f46d72ecefddd20bf47b68259c657cc4e628d529`. The independent reviewer reran the two
affected engineering gate suites on Node `v22.23.2`: **195/195 PASS**, 6.797 seconds.
Local source review tasks 2.3 and 3.4 are complete. This follow-up changes only
OpenSpec tasks/evidence; the approved workflow and test source remain unchanged.

Task 2.4 remains open for actual hosted CI scheduler behavior, the explicit paused
backend/frontend/PostgreSQL image build, all four image scans/security enforcement,
skipped browser/candidate steps and a successful final aggregate. The change stays
**ACTIVE** until this required hosted CI gate passes; do not archive it on local
policy evidence alone. Even a green paused CI run remains distinct from full
acceptance and cannot produce/promote a tested release candidate.
