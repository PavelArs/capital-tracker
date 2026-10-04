# engineering-gates Specification

## Purpose
Require complete fail-closed engineering gates and contain legacy deployment while preserving retained behavior.
## Requirements
### Requirement: ENG-001 Complete fail-closed CI aggregation
The CI aggregate SHALL require exact success from backend lint, tests and build,
frontend lint, tests and build, Docker build, specification/tooling checks and
production dependency audit, except that the Docker build (release) job is not
required for pull requests (ENG-006). It MUST run even when dependencies fail and MUST
reject missing or malformed results.

#### Scenario: ENG-001-A Every required job succeeds
- **GIVEN** all nine required jobs have completed successfully
- **WHEN** the aggregate evaluates their results
- **THEN** it exits successfully

#### Scenario: ENG-001-B A required job is not successful
- **GIVEN** one required job has failure, cancelled, skipped, missing, null or unknown status and the others succeed
- **WHEN** the aggregate evaluates results
- **THEN** it exits nonzero and names the unsuccessful job
- **AND** Docker/specification/dependency-audit results receive the same treatment as application checks

#### Scenario: ENG-001-C Invalid input cannot pass
- **GIVEN** malformed JSON, a non-object result, or an empty/duplicate required list
- **WHEN** the aggregate CLI runs
- **THEN** it exits nonzero

#### Scenario: ENG-001-D Workflow wiring covers all gates
- **GIVEN** the repository CI workflow
- **WHEN** pull requests or pushes to main run it
- **THEN** the aggregate has every required job as a dependency and runs with always()
- **AND** the actual gate CLI receives the needs JSON and the complete required-job list, which omits the release job only for pull requests

### Requirement: ENG-002 Controlled legacy deployment entry
Deployment SHALL have no push trigger. It SHALL start only by manual dispatch or by
`workflow_run` after a successful `CI` run for a push to main, and every run SHALL use
the `production` environment so its protection rules (the owner's required reviewer)
gate the job before any credential is available. Image promotion, receipt generation,
preflight and deployment SHALL require the main branch; outside main only read-only
inventory of one owner-pinned release commit is permitted. The workflow SHALL reach
the server only through the restricted data-only release dispatcher (MVP-007) and
SHALL NOT use the shared Docker-capable deployment key, upload files or execute a
remote shell. Failed-update recovery is performed server-side under MVP-004 rather
than by a workflow rollback job. This containment MUST NOT be described as sufficient
production readiness.

#### Scenario: ENG-002-A Automatic or unapproved rollout is unavailable
- **GIVEN** the manual MVP CD workflow
- **WHEN** the workflow entry conditions are evaluated
- **THEN** push cannot trigger deployment, a CI run that failed or ran for a pull request or another branch cannot start it, and only inventory of the pinned release commit can run outside main
- **AND** every run waits for the `production` environment, and promotion, preflight and deployment require validated successful candidate provenance for the exact main commit

#### Scenario: ENG-002-B Deployment cannot use a general server shell
- **WHEN** the workflow contacts the server
- **THEN** it sends only a generated request with version, operation, commit, run id and, for version 2, the receipt promoted in the same job, to the restricted dispatcher principal
- **AND** the request carries no command, path, file content, environment or image other than the receipt's validated digests

### Requirement: ENG-003 Evidence and retained characterization
The repository SHALL document baseline commands, pre-existing failures, data risks
and keep/simplify/remove decisions. It SHALL retain executable characterization
for private guard denial and ownership-scoped wallet access without changing behavior.

#### Scenario: CHAR-AUTH-001 Absent or malformed authentication
- **GIVEN** the real global session guard
- **WHEN** the guard evaluates absent or malformed session cookies
- **THEN** the guard denies access with UnauthorizedException and attaches no authenticated identity

#### Scenario: CHAR-WALLET-001 A wallet is not owned by the caller
- **GIVEN** lookup is constrained by the caller's owner ID
- **WHEN** the owner-scoped wallet does not exist
- **THEN** reading, deleting or refreshing the wallet fails without outbound provider refresh

#### Scenario: ENG-003-A Honest verification
- **GIVEN** baseline command results and independent review findings
- **WHEN** the audit and verification records are written
- **THEN** executed checks, failures and unexecuted database/browser checks are distinguished
- **AND** no schema migration, data deletion or production rollout is performed

### Requirement: ENG-004 Release work requires successful early gates
The release image/security job SHALL depend on successful production dependency audit and specification/engineering/security checks in addition to the retained backend/frontend build and test prerequisites. The release job and its prerequisites MUST NOT bypass failure through job-level conditions or continue-on-error; the release job's only job-level condition is the ENG-006 push-event condition, which keeps default successful-dependency scheduling. The existing fail-closed CI aggregate and image security gates SHALL remain required. Full acceptance and candidate export SHALL be retained behind the source-controlled temporary pause described in ENG-005.

#### Scenario: ENG-004-A Audit failure prevents expensive release work
- **GIVEN** backend/frontend builds and tests succeed but `dependency-audit` fails because a high-severity production advisory or registry error is reported
- **WHEN** the CI scheduler evaluates `docker-build`
- **THEN** the job is skipped before dependency installation, browser installation, image preparation or full real acceptance starts
- **AND** the always-running aggregate rejects the failed audit and skipped release result

#### Scenario: ENG-004-B Specification failure cannot bypass release prerequisites
- **GIVEN** the production audit and application prerequisites succeed but `spec-check` fails or either early gate is cancelled or skipped
- **WHEN** the CI scheduler evaluates the release job
- **THEN** its six explicit prerequisites and default successful-dependency scheduling prevent it from starting
- **AND** no job-level conditional or continue-on-error bypass permits release work

#### Scenario: ENG-004-C Successful prerequisites retain complete release verification
- **GIVEN** all six release prerequisites succeed on a push to main
- **WHEN** the release job runs
- **THEN** it retains the 180-minute budget and image security checks, with full acceptance and candidate export available only when ENG-005 enables them
- **AND** the final CI aggregate still requires all nine jobs to succeed

### Requirement: ENG-005 Temporary CI E2E pause cannot produce release evidence
CI SHALL define source-controlled `CI_E2E_ENABLED` as the string `false` during the owner-requested temporary pause. Browser installation and full real acceptance SHALL run only when that flag is exactly `true`. Paused CI MUST explicitly build backend, frontend and PostgreSQL images, verify infrastructure pins and retain all four image scans and high/critical enforcement. Candidate image export/upload SHALL require enabled successful full acceptance. Promotion, preflight and deployment MUST reject a CI run lacking successful full-acceptance step provenance; read-only inventory SHALL remain available. The manual full E2E command and retained suite SHALL remain unchanged.

#### Scenario: ENG-005-A Paused CI builds and scans without browser acceptance
- **GIVEN** the committed flag is `false`
- **WHEN** all six image job prerequisites succeed
- **THEN** CI builds the three application/infrastructure images and scans backend, frontend, PostgreSQL and Redis with the existing security enforcement
- **AND** browser installation, full acceptance and candidate export/upload do not run

#### Scenario: ENG-005-B Green paused CI is rejected by release provenance
- **GIVEN** all required CI jobs succeed but the named full-acceptance step is skipped, absent, cancelled or failed
- **WHEN** promotion, preflight or deployment validates candidate provenance
- **THEN** it exits nonzero before candidate download, publishing or server access
- **AND** successful image scans cannot substitute for full acceptance evidence

#### Scenario: ENG-005-C Explicit source restoration enables complete acceptance
- **GIVEN** a reviewed source change sets `CI_E2E_ENABLED` to the string `true`
- **WHEN** all prerequisites and the unchanged complete real acceptance command succeed
- **THEN** candidate export/upload becomes available after image security enforcement
- **AND** release provenance requires the successful full-acceptance step along with the retained required jobs

### Requirement: ENG-006 Release acceptance runs on pushes to main only
The release image/security job SHALL run only for pushes to main; it runs critical
real acceptance, image scans and candidate export. Its only job condition SHALL be
the event being `push` (the push trigger is limited to main), keeping default
successful-dependency scheduling. The CI aggregate SHALL accept a skipped release job
only for the `pull_request` event and SHALL require its success for every other event.

#### Scenario: ENG-006-A Pull requests skip release acceptance
- **GIVEN** a pull request to main whose eight other required jobs succeed
- **WHEN** CI runs
- **THEN** the release job is skipped and the aggregate succeeds
- **AND** any other required job that fails, is cancelled or reports an unknown result still fails the aggregate

#### Scenario: ENG-006-B Every other event requires release acceptance
- **GIVEN** a push to main, or any event other than `pull_request`
- **WHEN** the release job did not succeed
- **THEN** the aggregate fails and names `docker-build`

