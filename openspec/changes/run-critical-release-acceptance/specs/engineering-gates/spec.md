## MODIFIED Requirements

### Requirement: ENG-004 Release work requires successful early gates
The release image/security job SHALL depend on successful production dependency audit and specification/engineering/security checks in addition to the retained backend/frontend build and test prerequisites. The release job and its prerequisites MUST NOT bypass failure through job-level conditions or continue-on-error. The existing fail-closed CI aggregate and image security gates SHALL remain required. The reviewed critical real acceptance and candidate export SHALL follow these prerequisites under ENG-005.

#### Scenario: ENG-004-A Audit failure prevents expensive release work
- **GIVEN** backend/frontend builds and tests succeed but `dependency-audit` fails because a high-severity production advisory or registry error is reported
- **WHEN** the CI scheduler evaluates `docker-build`
- **THEN** the job is skipped before dependency installation, browser installation, image preparation or critical real acceptance starts
- **AND** the always-running aggregate rejects the failed audit and skipped release result

#### Scenario: ENG-004-B Specification failure cannot bypass release prerequisites
- **GIVEN** the production audit and application prerequisites succeed but `spec-check` fails or either early gate is cancelled or skipped
- **WHEN** the CI scheduler evaluates the release job
- **THEN** its six explicit prerequisites and default successful-dependency scheduling prevent it from starting
- **AND** no job-level conditional or continue-on-error bypass permits release work

#### Scenario: ENG-004-C Successful prerequisites retain complete release verification
- **GIVEN** all six release prerequisites succeed
- **WHEN** the release job runs
- **THEN** it retains the 180-minute budget, all fixed real acceptance probes and four exact-image security checks
- **AND** the final CI aggregate still requires all nine jobs to succeed

### Requirement: ENG-005 Critical real release acceptance is required for a candidate
CI SHALL run the reviewed critical release profile after its existing early prerequisites. The profile SHALL preserve every fixed isolated HTTPS/provider, PostgreSQL migration/domain, CLI/MFA, startup, artifact, image scan and cleanup check; only browser selection is reduced. The critical selection SHALL include the exact declared financial/owner-authentication cases and real CSV committed-response-loss/session-expiry/401/MFA recovery, with one worker and zero retries. Discovery and execution MUST reject empty, duplicate, missing, ambiguous, extra, skipped, unexecuted or failed cases. A successful machine-readable receipt SHALL bind the `critical` profile, source commit, CI run, manifest hash, exact selected file/title identities and passing results. Candidate export/upload and promotion/preflight/deployment MUST reject absent, malformed, stale or mismatched critical step/receipt provenance before publishing or server access. `pnpm test:e2e` SHALL remain the full manual suite and cannot be represented by a critical receipt. The unchanged non-E2E audit/spec/image/security gates remain mandatory. This source profile does not replace actual production backup/restore or server acceptance.

#### Scenario: ENG-005-A Exact critical selection executes real acceptance
- **GIVEN** the reviewed 20-case manifest and successful early CI gates
- **WHEN** critical acceptance starts
- **THEN** Playwright discovery finds exactly one test for each declared file/title, including CSV-006-B real auth recovery
- **AND** every fixed real pre-browser probe runs before the selected browser cases, with existing cleanup afterward
- **AND** a receipt is emitted only when all selected cases genuinely pass

#### Scenario: ENG-005-B Missing or partial evidence cannot promote
- **GIVEN** a missing/duplicate/ambiguous test, skipped/failed/unexecuted case, wrong profile/commit/run/manifest, or missing/failed named CI step
- **WHEN** candidate export or CD provenance validation runs
- **THEN** it stops before publishing images or server access
- **AND** a green image scan or generic CI success cannot substitute for the exact critical receipt

#### Scenario: ENG-005-C Full regression remains available
- **GIVEN** an engineer invokes `pnpm test:e2e`
- **WHEN** the isolated acceptance runner reaches Playwright
- **THEN** it runs the full retained browser suite under the existing one-worker, zero-retry configuration
- **AND** any unrun full-suite coverage is reported honestly during a critical release
