## ADDED Requirements

### Requirement: RAP-001 Approved release after green main CI
The CD workflow SHALL run a `release` mode when `CI` completes successfully for a push
to main, using that CI run id, the `existing` installation and the current main commit.
`release` SHALL validate candidate provenance exactly as promotion does, promote the
tested images, write the receipt, then send a preflight request and, only if it
succeeds, a deploy request, all in one job in the `production` environment. Manual
dispatch SHALL offer `release` with an explicit installation choice next to the
existing modes. A run whose CI commit is no longer the main head SHALL refuse.

#### Scenario: RAP-001-A Green main CI starts an approval-gated release
- **GIVEN** `CI` completed with conclusion success for a push to main
- **WHEN** the workflow_run event is evaluated
- **THEN** the deploy job runs in the `production` environment with mode `release`, the CI run id from the event and installation `existing`
- **AND** promotion, receipt writing, preflight and deploy run in that order, deploy only after preflight succeeds

#### Scenario: RAP-001-B Other CI outcomes cannot release
- **WHEN** CI failed or was cancelled, ran for a pull request, or ran for another branch
- **THEN** the deploy job does not run

#### Scenario: RAP-001-C Manual release keeps an explicit installation
- **WHEN** the owner dispatches the workflow manually
- **THEN** the modes are `release`, `inventory`, `promote`, `preflight` and `deploy`
- **AND** the installation choices are `existing`, `fresh`, `resume-fresh` and `resume-activation`

### Requirement: RAP-002 Environment-approved receipt in the request
The dispatcher SHALL accept, besides version 1, a version 2 request with exactly
`version`, `operation` (`preflight` or `deploy`), `commit`, `runId` and `receipt`
within the existing size limit. The embedded receipt SHALL pass the same validation
as an owner-installed receipt and the installed server files SHALL match its digests.
A version 2 request SHALL NOT read, require or consume owner-installed receipts.
Inventory SHALL stay version 1 only. Version 1 behaviour SHALL be unchanged.

#### Scenario: RAP-002-A Release with the receipt promoted in the same job
- **GIVEN** installed server files that match the receipt
- **WHEN** a version 2 preflight or deploy request carries a valid receipt for the same commit and run
- **THEN** the dispatcher runs the fixed runner with the receipt's installation and digests and a clean environment
- **AND** no owner-installed receipt is read or moved

#### Scenario: RAP-002-B Refuse a tampered or foreign embedded receipt
- **WHEN** a version 2 request lacks the receipt, carries extra fields, names inventory, carries a receipt for another commit or run, mutable or foreign images, unknown receipt fields, or digests that differ from the installed server files
- **THEN** the dispatcher refuses before starting any process

### Requirement: RAP-003 Resume an interrupted activation
The runner SHALL support an explicit `resume-activation` installation for a managed
runtime whose earlier release migrated the database and provisioned the owner but
never activated. Before any pull, stop, backup or write it SHALL require: no
`docker-compose.yml`, `.env.images` or `.release-managed-env` in the runtime
directory; a symlink-free `operator/recovery.json` from the confirmed MFA enrollment;
the running PostgreSQL major, volume and infrastructure images exactly as for
`existing`; the reviewed historical migrations in the ledger; and a provisioned
owner row. Deployment SHALL then stop any application containers, take the encrypted
backup with isolated restore and fingerprint, run migrations, start the candidate
pair, pass the privacy smoke and publish activation metadata including the managed
runtime marker. It SHALL NOT provision the owner or enroll MFA again, and SHALL NOT
pull, recreate or restart PostgreSQL or Redis. A failure SHALL stop the applications
and preserve the database. An `existing` release without activation metadata SHALL
refuse with a message naming `resume-activation`.

#### Scenario: RAP-003-A Complete the interrupted activation
- **GIVEN** a migrated database with a provisioned owner, `operator/recovery.json`, stopped applications and no activation metadata
- **WHEN** a `resume-activation` deploy runs
- **THEN** isolated restore precedes migration, the owner and MFA CLIs are not run, PostgreSQL and Redis are neither pulled nor started
- **AND** the candidate pair is started and `.env.images`, `docker-compose.yml` and `.release-managed-env` are published

#### Scenario: RAP-003-B Refuse a state that is not an interrupted activation
- **WHEN** activation metadata already exists, `operator/recovery.json` is missing, or no owner is provisioned
- **THEN** preflight and deploy refuse before pulling images, stopping applications, dumping or migrating

#### Scenario: RAP-003-C Existing release explains the missing activation
- **WHEN** an `existing` release finds no activated `docker-compose.yml` in the managed runtime
- **THEN** it refuses before Docker access and names `resume-activation`

### Requirement: RAP-004 IPv4 frontend health check
The production Compose frontend health check SHALL request `http://127.0.0.1:80/`,
matching the image health check and the IPv4-only Nginx listener, and SHALL NOT use
`localhost`.

#### Scenario: RAP-004-A Frontend health does not depend on localhost resolution
- **WHEN** the production Compose file is read
- **THEN** the frontend health check targets `http://127.0.0.1:80/` and no health check targets `localhost:80`

### Requirement: RAP-005 Refresh server files without re-keying
The installer SHALL provide `update`, run as root from a clean checkout, which
refreshes the dispatcher and the reviewed server files with the same path, owner and
mode checks as `install`. It SHALL require an existing installation and SHALL NOT
create or change the SSH principal, its key, the sudo rule, the registry
configuration or receipts.

#### Scenario: RAP-005-A Update only replaces reviewed files
- **GIVEN** a completed `install`
- **WHEN** `update` runs from a checkout with changed server files
- **THEN** the installed dispatcher and release files equal the checkout
- **AND** the authorized key, sudo rule and receipts are byte-identical and no account command runs

#### Scenario: RAP-005-B Update refuses without an installation or with unsafe paths
- **WHEN** the dispatcher was never installed, or an installation path is a symlink, writable by others or foreign-owned
- **THEN** update refuses before changing any file
