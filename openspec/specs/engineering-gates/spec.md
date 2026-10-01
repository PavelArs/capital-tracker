# engineering-gates Specification

## Purpose
Require complete fail-closed engineering gates and contain legacy deployment while preserving retained behavior.
## Requirements
### Requirement: ENG-001 Complete fail-closed CI aggregation
The CI aggregate SHALL require exact success from backend lint, tests and build,
frontend lint, tests and build, Docker build, specification/tooling checks and
production dependency audit. It MUST run even when dependencies fail and MUST
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
- **AND** the actual gate CLI receives the complete required-job list and needs JSON

### Requirement: ENG-002 Controlled legacy deployment entry
Legacy deployment SHALL have no push trigger and SHALL require manual dispatch,
the main branch and an explicit owner-controlled rollout variable. This containment
MUST NOT be described as sufficient production readiness.

#### Scenario: ENG-002-A Automatic or unapproved rollout is unavailable
- **GIVEN** the legacy CD workflow and no rollout variable
- **WHEN** the workflow entry conditions are evaluated
- **THEN** push cannot trigger deployment and the initial job cannot run
- **AND** subsequent publishing/deployment jobs depend on that guarded job

#### Scenario: ENG-002-B Failure before deployment cannot invoke rollback
- **GIVEN** version calculation or image building fails and deployment never starts
- **WHEN** the workflow evaluates failure handlers
- **THEN** rollback does not run
- **AND** rollback requires successful version gating, failed deployment, and a nonempty previous image other than none

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
The release image/security job SHALL depend on successful production dependency audit and specification/engineering/security checks in addition to the retained backend/frontend build and test prerequisites. The release job and its prerequisites MUST NOT bypass failure through job-level conditions or continue-on-error. The existing fail-closed CI aggregate and image security gates SHALL remain required. Full acceptance and candidate export SHALL be retained behind the source-controlled temporary pause described in ENG-005.

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
- **GIVEN** all six release prerequisites succeed
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
