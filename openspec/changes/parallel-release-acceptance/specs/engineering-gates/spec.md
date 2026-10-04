## ADDED Requirements

### Requirement: ENG-007 Release images are built once and critical acceptance runs in verified parallel shards
CI SHALL build the backend and frontend acceptance images once, pull and verify the
pinned PostgreSQL and Redis images, record all four image IDs in a schema-v3 manifest
bound to the commit and CI run, and pass the saved images to the release jobs. Critical
acceptance SHALL run in the shards `probes-1`, `probes-2`, `browser-1`, `browser-2` and
`browser-3`, each on its own runner and isolated stack. Every shard and the final job
MUST refuse loaded images whose IDs, platform or PostgreSQL revision differ from the
manifest, and a shard MUST NOT build images. Every canonical real check SHALL be
assigned to exactly one probe shard and run there in canonical order, with migration and
seed before client source startup; browser cases SHALL be split by manifest index modulo
three. Each shard SHALL keep the checkout Nginx preservation and Compose cleanup and
SHALL publish a receipt with the commit, run, shard, the image IDs it tested and either
its exact ordered checks or its Playwright results. The final job MUST merge receipts
into the unchanged critical receipt only when one receipt exists per shard, every shard
tested the manifest image IDs for the expected commit and run, the probe lists cover the
canonical list exactly once in order, and the browser results cover the manifest exactly
once with one passing result per case.

#### Scenario: ENG-007-A Images are built once and their identity is proven everywhere
- **GIVEN** the build job built and saved the four images with their manifest
- **WHEN** a shard or the final job loads them
- **THEN** it verifies the tar checksum and every image ID, platform and PostgreSQL revision against the manifest for this commit and run before acceptance, merge or scans
- **AND** a missing or different image stops the job without building or pulling a replacement

#### Scenario: ENG-007-B Probe shards run every canonical check exactly once
- **GIVEN** the 31 canonical real checks of the serial critical runner
- **WHEN** the two probe shards run
- **THEN** each runs its assigned checks with the unchanged commands in canonical order and the shard with client source startup migrates and seeds first
- **AND** a missing, extra, duplicated or reordered check in any receipt fails the merge

#### Scenario: ENG-007-C Browser shards are derived from the manifest
- **GIVEN** the critical manifest
- **WHEN** browser shard `browser-n` selects its cases
- **THEN** it selects the manifest cases whose index modulo three is n-1 through exact discovery and runs them with one worker, no retries and the JSON reporter after migration, seed, application start, the HTTPS ingress check and the artifact check
- **AND** the union of the three shards is exactly the manifest

#### Scenario: ENG-007-D The final job merges only complete identical evidence
- **GIVEN** the shard receipts of one run
- **WHEN** one is missing or duplicated, names another commit or run, tested other image IDs, misses or repeats a check or case, or reports a failed, skipped, retried or erroring case
- **THEN** the merge fails and no critical receipt, scan result or candidate is produced
- **AND** a complete merge writes the critical receipt with the unchanged schema, which is verified before the scans and candidate export

#### Scenario: ENG-007-E CD requires every release job of the run
- **GIVEN** a successful push run on main
- **WHEN** CD validates its provenance
- **THEN** it requires `Build Release Images`, every `Critical acceptance (<shard>)` job with a successful `Run critical real release acceptance` step, and the final job's successful merge and receipt verification steps
- **AND** a run from any event other than push is refused

## MODIFIED Requirements

### Requirement: ENG-001 Complete fail-closed CI aggregation
The CI aggregate SHALL require exact success from backend lint, tests and build,
frontend lint, tests and build, the release image build, the critical acceptance shards,
the release image/security job, specification/tooling checks and production dependency
audit, except that the three release jobs are not required for pull requests (ENG-006).
It MUST run even when dependencies fail and MUST reject missing or malformed results.

#### Scenario: ENG-001-A Every required job succeeds
- **GIVEN** all eleven required jobs have completed successfully
- **WHEN** the aggregate evaluates their results
- **THEN** it exits successfully

#### Scenario: ENG-001-B A required job is not successful
- **GIVEN** one required job has failure, cancelled, skipped, missing, null or unknown status and the others succeed
- **WHEN** the aggregate evaluates results
- **THEN** it exits nonzero and names the unsuccessful job
- **AND** release/specification/dependency-audit results receive the same treatment as application checks, and the shard matrix counts as one job whose combined result must be success

#### Scenario: ENG-001-C Invalid input cannot pass
- **GIVEN** malformed JSON, a non-object result, or an empty/duplicate required list
- **WHEN** the aggregate CLI runs
- **THEN** it exits nonzero

#### Scenario: ENG-001-D Workflow wiring covers all gates
- **GIVEN** the repository CI workflow
- **WHEN** pull requests, pushes to main or manual dispatches run it
- **THEN** the aggregate has every required job as a dependency and runs with always()
- **AND** the actual gate CLI receives the needs JSON and the complete required-job list, which omits the three release jobs only for pull requests

### Requirement: ENG-004 Release work requires successful early gates
The release image build job SHALL depend on successful production dependency audit and specification/engineering/security checks in addition to the retained backend/frontend build and test prerequisites; the critical acceptance shards SHALL depend on the image build, and the release image/security job on the image build and every shard. The release jobs and their prerequisites MUST NOT bypass failure through job-level conditions or continue-on-error; each release job's only job-level condition is the ENG-006 event condition, which keeps default successful-dependency scheduling. The existing fail-closed CI aggregate and image security gates SHALL remain required. The reviewed critical real acceptance and candidate export SHALL follow these prerequisites under ENG-005 and ENG-007.

#### Scenario: ENG-004-A Audit failure prevents expensive release work
- **GIVEN** backend/frontend builds and tests succeed but `dependency-audit` fails because a high-severity production advisory or registry error is reported
- **WHEN** the CI scheduler evaluates `release-images`
- **THEN** it and the dependent shards and `docker-build` are skipped before image preparation, browser installation or critical real acceptance starts
- **AND** the always-running aggregate rejects the failed audit and the skipped release results

#### Scenario: ENG-004-B Specification failure cannot bypass release prerequisites
- **GIVEN** the production audit and application prerequisites succeed but `spec-check` fails or either early gate is cancelled or skipped
- **WHEN** the CI scheduler evaluates the release jobs
- **THEN** the image build's six explicit prerequisites and default successful-dependency scheduling prevent it, and therefore every later release job, from starting
- **AND** no job-level conditional or continue-on-error bypass permits release work

#### Scenario: ENG-004-C Successful prerequisites retain complete release verification
- **GIVEN** all six release prerequisites succeed on an event other than a pull request
- **WHEN** the release jobs run
- **THEN** the release image/security job retains the 180-minute budget, all fixed real acceptance probes run in the shards, and the four exact-image security checks run on the built images
- **AND** the final CI aggregate still requires all eleven jobs to succeed

### Requirement: ENG-005 Critical real release acceptance is required for a candidate
CI SHALL run the reviewed critical release profile after its existing early prerequisites, in the parallel shards of ENG-007 on images built once. The profile SHALL preserve every fixed isolated HTTPS/provider, PostgreSQL migration/domain, CLI/MFA, startup, artifact, image scan and cleanup check; only browser selection is reduced. The critical selection SHALL include the exact declared financial/owner-authentication cases and real CSV committed-response-loss/session-expiry/401/MFA recovery, with one worker and zero retries in every browser shard. Discovery and execution MUST reject empty, duplicate, missing, ambiguous, extra, skipped, unexecuted or failed cases, in each shard and in the merged result. A successful machine-readable receipt SHALL bind the `critical` profile, source commit, CI run, manifest hash, exact selected file/title identities and passing results; it is written only by merging verified shard receipts. Candidate export/upload and promotion/preflight/deployment MUST reject absent, malformed, stale or mismatched critical step/receipt provenance before publishing or server access. `pnpm test:e2e` SHALL remain the full manual suite and cannot be represented by a critical receipt; `pnpm test:e2e:critical` SHALL remain the serial local profile. The unchanged non-E2E audit/spec/image/security gates remain mandatory. This source profile does not replace actual production backup/restore or server acceptance.

#### Scenario: ENG-005-A Exact critical selection executes real acceptance
- **GIVEN** the reviewed 21-case manifest and successful early CI gates
- **WHEN** critical acceptance starts
- **THEN** Playwright discovery in each browser shard finds exactly one test for each of its declared file/title cases, and together the shards cover every case including CSV-006-B real auth recovery
- **AND** every fixed real pre-browser probe runs in a probe shard with the existing cleanup afterward
- **AND** a receipt is emitted only when all selected cases genuinely pass

#### Scenario: ENG-005-B Missing or partial evidence cannot promote
- **GIVEN** a missing/duplicate/ambiguous test, skipped/failed/unexecuted case, wrong profile/commit/run/manifest, a missing or failed shard, or a missing/failed named CI step
- **WHEN** candidate export or CD provenance validation runs
- **THEN** it stops before publishing images or server access
- **AND** a green image scan or generic CI success cannot substitute for the exact critical receipt

#### Scenario: ENG-005-C Full regression remains available
- **GIVEN** an engineer invokes `pnpm test:e2e`
- **WHEN** the isolated acceptance runner reaches Playwright
- **THEN** it runs the full retained browser suite under the existing one-worker, zero-retry configuration
- **AND** any unrun full-suite coverage is reported honestly during a critical release

### Requirement: ENG-006 Release acceptance runs on pushes to main only
The release jobs SHALL run for every CI event except `pull_request`: pushes to main and
manual dispatch of any branch. The release jobs are the image build, the critical
acceptance shards and the release image/security job. Each release job's only job condition SHALL be the event not
being `pull_request`, keeping default successful-dependency scheduling. The CI aggregate
SHALL accept skipped release jobs only for the `pull_request` event and SHALL require
their success for every other event. Deployment MUST still require a successful push run
on main; a manually dispatched run is evidence for review only.

#### Scenario: ENG-006-A Pull requests skip release acceptance
- **GIVEN** a pull request to main whose eight other required jobs succeed
- **WHEN** CI runs
- **THEN** the three release jobs are skipped and the aggregate succeeds
- **AND** any other required job that fails, is cancelled or reports an unknown result still fails the aggregate

#### Scenario: ENG-006-B Every other event requires release acceptance
- **GIVEN** a push to main, a manual dispatch, or any event other than `pull_request`
- **WHEN** any of the three release jobs did not succeed
- **THEN** the aggregate fails and names that job

#### Scenario: ENG-006-C A manual run cannot deploy
- **GIVEN** a successful manually dispatched CI run of the deployed commit
- **WHEN** CD validates candidate provenance
- **THEN** it refuses the run because its event is not push
