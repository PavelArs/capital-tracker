## MODIFIED Requirements

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
