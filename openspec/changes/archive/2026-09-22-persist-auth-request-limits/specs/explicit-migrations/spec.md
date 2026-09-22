## MODIFIED Requirements

### Requirement: MIG-002 Explicit migrations fail closed
The explicit migration CLI SHALL require database host, port, username, password and
name, execute actual TypeORM migrations under a PostgreSQL advisory lock, and exit
nonzero on errors. It MUST reject pending destructive legacy migrations on any
pre-existing application schema before mutating application tables or migration ledger.

#### Scenario: ISO-001 Fresh PostgreSQL migration and replay
- **GIVEN** an empty isolated PostgreSQL database and the release backend image
- **WHEN** the explicit migration command runs twice
- **THEN** all twelve migrations are recorded exactly once and current tables exist
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

#### Scenario: OWN-MIG-001 Additive owner schema preserves current data
- **GIVEN** a database at the preceding eight-migration version with synthetic users and wallets
- **WHEN** the owner-binding migration runs
- **THEN** users and wallets remain byte-for-byte equivalent and the new owner table is empty
- **AND** no existing account is silently selected as owner

#### Scenario: SES-MIG-001 Existing owner and portfolio data are preserved
- **GIVEN** a database at the preceding nine-migration version with a bound owner and wallets
- **WHEN** the session migration runs
- **THEN** the new session table is empty and all existing user, owner and portfolio rows remain unchanged

#### Scenario: MFA-MIG-001 Mandatory MFA upgrade revokes legacy sessions
- **GIVEN** the preceding ten-migration schema with owner, financial data and password-only sessions
- **WHEN** the MFA migration and replay run
- **THEN** owner/password/financial rows remain unchanged, old transient sessions are revoked and no factor is implicitly enrolled
