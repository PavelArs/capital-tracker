## ADDED Requirements

### Requirement: MIG-001 Application startup cannot mutate schema
Application connections SHALL disable synchronization, automatic migrations and
implicit database extension installation.

#### Scenario: MIG-001-A Existing schema is not upgraded during startup
- **GIVEN** pending migrations on an existing database
- **WHEN** application TypeORM options are constructed and application starts
- **THEN** no migration, schema synchronization or extension installation is requested

### Requirement: MIG-002 Explicit migrations fail closed
The explicit migration CLI SHALL require database host, port, username, password and
name, execute actual TypeORM migrations under a PostgreSQL advisory lock, and exit
nonzero on errors. It MUST reject pending destructive legacy migrations on any
pre-existing application schema before mutating application tables or migration ledger.

#### Scenario: ISO-001 Fresh PostgreSQL migration and replay
- **GIVEN** an empty isolated PostgreSQL database and the release backend image
- **WHEN** the explicit migration command runs twice
- **THEN** the eight existing migrations are recorded exactly once and current tables exist
- **AND** the second run preserves data and migration records

#### Scenario: ISO-002 Unsafe prior schema is refused before mutation
- **GIVEN** a representative older schema containing an unsupported wallet and unknown currency with destructive migrations pending
- **WHEN** the explicit migration command runs
- **THEN** it exits nonzero with a preflight explanation
- **AND** original rows, schema and migration records remain unchanged

#### Scenario: MIG-002-A Incomplete database configuration
- **GIVEN** at least one required migration connection setting is absent
- **WHEN** the migration command starts
- **THEN** it exits nonzero before connecting, without printing credentials
