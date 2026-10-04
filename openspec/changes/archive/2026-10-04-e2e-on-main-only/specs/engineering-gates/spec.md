## ADDED Requirements

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

## MODIFIED Requirements

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
