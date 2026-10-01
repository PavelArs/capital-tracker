## ADDED Requirements

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
