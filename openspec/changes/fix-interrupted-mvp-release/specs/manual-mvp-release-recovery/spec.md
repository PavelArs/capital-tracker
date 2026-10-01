## ADDED Requirements

### Requirement: MRR-001 Final PostgreSQL readiness gates restore
The release runner MUST establish bounded loopback-TCP readiness of the final PostgreSQL server before decrypting or restoring a backup. It MUST explicitly fail after the configured 60 attempts if readiness is not reached, before restore, migrations, owner creation, or app activation. The isolated restore-side `pg_restore` and fingerprint `pg_dump` MUST connect with `-h 127.0.0.1`; the source production dump may retain its existing socket connection.

#### Scenario: MRR-001-A Socket-only init server is not restore-ready
- **WHEN** the init hook exposes a socket-ready temporary server while `pg_isready -h 127.0.0.1 -U postgres` fails
- **THEN** the runner waits for final loopback-TCP readiness before decrypting or invoking `pg_restore`
- **AND** `pg_restore -h 127.0.0.1` and isolated `pg_dump -h 127.0.0.1` succeed before any migration or activation

#### Scenario: MRR-001-B Final server never becomes ready
- **WHEN** all 60 bounded TCP readiness attempts fail
- **THEN** the runner exits nonzero with an explicit readiness failure before decrypt or restore
- **AND** no migration, owner creation, or app activation occurs

### Requirement: MRR-002 Resume only the verified interrupted fresh installation
The dispatcher and runner MUST accept an explicit `resume-fresh` mode only when a newly approved candidate receipt identifies the current candidate and references the exact historical consumed receipt for the interrupted attempt. Preflight MUST verify the whole project resource inventory, original PG18/Redis containers, volumes, network, mounts, running image identities and health, trusted proxy peer, and empty application schema with no migrations, owner rows, or activation. It MAY allow only corroborated residues from the failed attempt; unknown, missing, extra, or drifted state MUST cause refusal. `fresh` MUST continue to refuse existing initialized resources, and `existing` MUST remain reserved for an activated prior release.

On the host, the resume operation MUST preserve initialized PG18/Redis resources and their original immutable image identities, and MUST NOT pull, bring up, recreate, or replace infrastructure. Candidate app images MAY be pulled. Before any migration, owner/MFA work, or activation, it MUST create and verify a fresh encrypted backup and complete an isolated restore with logical fingerprint equality. Any failure MUST preserve PG/Redis and data, stop only application services if present, and require manual recovery.

#### Scenario: MRR-002-A Valid interrupted attempt resumes without infrastructure mutation
- **WHEN** historical receipt, new candidate receipt, all original resource/image identities, empty schema, proxy trust, and allowed residues match
- **THEN** resume uses only the candidate app images and original running PG18/Redis resources
- **AND** verified encrypted backup and isolated restore/fingerprint precede every migration or activation
- **AND** the app-absent TLS preflight does not report the release as deployed

#### Scenario: MRR-002-B Historical provenance or state proof is absent or mismatched
- **WHEN** either receipt is missing/invalid, the old receipt identity differs, resources are missing/extra, image/mount/project/network identity drifts, infrastructure is unhealthy, schema contains app data, activation exists, or runtime contents are unknown
- **THEN** resume exits nonzero without infrastructure pull/up/recreate, migration, owner creation, or app activation
- **AND** existing PG/Redis resources and data remain preserved with no fallback to `fresh`

#### Scenario: MRR-002-C Resume fails after writes begin
- **WHEN** a migration, owner, or app step fails after verified backup and restore
- **THEN** PG/Redis remain running and their data is preserved
- **AND** only application services are stopped and manual recovery is required

### Requirement: MRR-003 Acceptance pins original PostgreSQL provenance
For `resume-fresh`, CI MUST authenticate to the private registry with job-scoped read access, use the exact reviewed original PostgreSQL digest and origin revision, and MUST test, scan, and export that image alongside new candidate application images. It MUST skip rebuilding PostgreSQL and use `compose up --no-build`. The candidate receipt MUST carry unchanged original PG/Redis digests and provenance; CD MUST promote candidate apps only. CI MUST include real PostgreSQL 18 evidence for readiness/restore before issuing a successful receipt and verify the pinned source image identity is unchanged before and after acceptance.

#### Scenario: MRR-003-A New candidate is accepted against original PostgreSQL
- **WHEN** CI accepts a `resume-fresh` candidate
- **THEN** it pulls and tests the exact pinned original PG image without rebuilding it
- **AND** scan/export and receipt retain its original provenance while app artifacts identify the candidate source
- **AND** CD does not promote or replace PostgreSQL or Redis
