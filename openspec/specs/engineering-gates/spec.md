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
