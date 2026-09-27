## ADDED Requirements

### Requirement: MVP-001 Manual runtime is independent of automatic collection
Configured `BACKGROUND_JOBS_ENABLED=false` SHALL suppress automatic constructor/module-init provider requests and scheduled collectors. Explicit supported stored/manual operations and optional explicit display-FX collection SHALL remain usable. The flag SHALL NOT redefine existing authenticated legacy demand-read APIs as globally offline. Supported manual-account/CSV views SHALL cause no provider calls; legacy crypto SHALL remain segregated and excluded from supported MVP scope. True/unset startup characterization SHALL remain; enabled fiat HTTP collection SHALL have a10000ms timeout.

#### Scenario: MVP-001-A Start a manual installation
- **GIVEN** collection is configured false
- **WHEN** runtime services initialize and existing manual financial journeys execute
- **THEN** automatic price/rate/wallet collection does not run and exact financial results, unknown-versus-zero and provider-independent manual operations remain intact

#### Scenario: MVP-001-B Preserve configured compatibility
- **WHEN** background collection is true or unset
- **THEN** existing initialization remains enabled with bounded fiat HTTP timeout
- **AND** explicit display-FX collection retains its existing quota/provenance/precision contract

### Requirement: MVP-002 Only trusted tested immutable artifacts are promoted
GitHub Actions SHALL release the exact backend/frontend image digests tested for a successful trusted candidate commit/run. Invalid, incomplete, foreign, failed, skipped or mismatched provenance SHALL stop before deployment. It SHALL NOT rebuild different release images, rely on mutable latest tags, or execute untrusted PR code with deployment credentials. SSH identity SHALL be pinned from a trusted source.

#### Scenario: MVP-002-A Refuse an untrusted candidate or host
- **WHEN** a candidate lacks required successful gates, identities/digests do not agree, or SSH host verification fails
- **THEN** no server application/database mutation occurs

### Requirement: MVP-003 Preflight and recoverability precede mutation
Actions SHALL inspect actual origin, volumes, runtime/MFA configuration and schema read-only before deployment. A verified encrypted PostgreSQL backup with checksum and isolated successful restoration into a disposable database (never owner data) SHALL be required before mutating owner database data or activating the candidate. A reversible maintenance stop to quiesce writes SHALL recover the prior application pair on preparation failure against unchanged schema. Missing database, dump/encryption/restore failure SHALL fail closed; no skip override SHALL exist.

#### Scenario: MVP-003-A Failed preparation preserves the server
- **WHEN** preflight, dump, encryption or isolated restoration fails
- **THEN** the release stops without mutating owner tables, original volumes or authentication configuration, restoring any quiesced previous application pair with readiness/privacy checks when schema is unchanged

### Requirement: MVP-004 Explicit migration and compatible recovery
A server lock SHALL serialize release execution. Deployment SHALL invoke the existing explicit migration CLI and honor its legacy-schema refusal. Application updates SHALL NOT run compose down, prune recovery images or recreate original data volumes. Recovery SHALL restore both previous application digests only with verified schema compatibility; automatic old-database restoration SHALL NOT overwrite newer writes.

#### Scenario: MVP-004-A Refuse unsafe migration
- **WHEN** existing schema requires a destructive historical migration refused by preflight
- **THEN** release stops without bypassing preflight or modifying ledger/owner data

#### Scenario: MVP-004-B Recover a failed application update
- **WHEN** post-update readiness/privacy checks fail
- **THEN** compatible previous backend and frontend images are restored and checked, or execution stops with explicit operator recovery boundaries if compatibility is unknown

### Requirement: MVP-005 Verified manual MVP deployment
Required existing manual/authentication acceptance and production dependency/security gates SHALL pass for the candidate, without weaker financial, ownership, retry or provider assertions. The documented Router release findings SHALL be resolved. Actual deployment SHALL verify HTTPS readiness, minimal public health, anonymous private denial, real owner MFA/manual-screen access and logout. Evidence SHALL identify commit, both image digests, schema, actual results and unrun limits.

#### Scenario: MVP-005-A Finish the bounded release
- **WHEN** the candidate passes staged gates and Actions deploys it safely
- **THEN** existing manual + CSV capabilities work on the server with real authentication and recorded release/recovery evidence
- **AND** automatic networks, AI and whole-target completion are not claimed

### Requirement: MVP-006 PostgreSQL18 fresh installation preserves existing major versions
The new manual MVP installation SHALL use a pinned tested PostgreSQL18 image. Fresh acceptance SHALL execute the current migration ledger, retained exact financial/security journeys and encrypted backup/checksum/isolated restore with logical schema/data equality on PostgreSQL18. PostgreSQL16 rehearsal results SHALL remain historical evidence, not PostgreSQL18 verification. Existing PostgreSQL16 volumes and the protected preview SHALL remain untouched. Application promotion SHALL NOT implicitly change a database major version, relocate existing data or perform pg_upgrade; a major upgrade requires a separate data-preserving plan.

#### Scenario: MVP-006-A Verify a fresh PostgreSQL18 installation
- **GIVEN** read-only assessment proves no unexplained application data and fresh mode is explicitly selected
- **WHEN** PostgreSQL18 initializes a new dedicated volume
- **THEN** the mounted volume covers /var/lib/postgresql and PGDATA uses /var/lib/postgresql/18/docker
- **AND** actual PostgreSQL18 migration/schema and exact decimal/JSON/bytea data backup/restore evidence pass before release mutation

#### Scenario: MVP-006-B Refuse an implicit database major upgrade
- **GIVEN** an existing PostgreSQL16 installation or mismatched database major/layout
- **WHEN** a release candidate requests PostgreSQL18 or a different mount layout
- **THEN** preflight refuses before pulling/starting replacement database services, stopping applications, dumping or migrating
- **AND** existing volumes, data/configuration and preview remain unchanged; compatible same-major application release remains allowed

#### Scenario: MVP-006-C Refuse an incorrect fresh layout
- **WHEN** fresh mode requests PostgreSQL16, the old /var/lib/postgresql/data mount, or initialized major is not18
- **THEN** release refuses without implicitly treating old data as an empty PostgreSQL18 installation
