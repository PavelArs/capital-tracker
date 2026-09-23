## MODIFIED Requirements

### Requirement: MIG-002 Explicit migrations fail closed
The explicit migration CLI SHALL require database host, port, username, password and
name, execute actual TypeORM migrations under a PostgreSQL advisory lock, and exit
nonzero on errors. It MUST reject pending destructive legacy migrations on any
pre-existing application schema before mutating application tables or migration ledger.

#### Scenario: ISO-001 Fresh PostgreSQL migration and replay
- **GIVEN** an empty isolated PostgreSQL database and the release backend image
- **WHEN** the explicit migration command runs twice
- **THEN** all sixteen migrations are recorded exactly once and current tables exist
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

#### Scenario: TRADE-MIG-001 Populated opening predecessor remains identical
- **GIVEN** a populated thirteen-migration isolated schema with known/unknown opening history, manual identities, prior financial data and live owner/MFA/session/request-limit state
- **WHEN** actual migration 14 and replay run in the release image
- **THEN** every prior row, column/index/constraint, enum/extension and migration sequence state is preserved except the one new migration ledger increment
- **AND** the three new journal tables are empty, no origin/lot/owner is invented and replay changes nothing
- **AND** all prior upgrade semantics and destructive-history preflight refusals remain enforced

#### Scenario: CSV-MIG-001 Populated journal predecessor remains identical
- **GIVEN** a populated fourteen-migration isolated schema with explicit journal origins, corrected/void trade history, known/unknown openings and live financial/owner/MFA/session/admission data
- **WHEN** actual migration15 and replay run through the release image
- **THEN** every preceding row, column/index/constraint, enum/extension and prior migration sequence state is preserved except the one new migration ledger increment
- **AND** three empty import tables appear with exact byte/state/range/composite identity constraints, no original or accounting entry is invented, and replay changes nothing
- **AND** fresh installation, every previous populated upgrade and all unsafe historical preflight refusals retain their existing assertions

#### Scenario: CARRY-MIG-001 Populated CSV history survives baseline extension
- **GIVEN** a populated fifteen-migration isolated schema containing known/unknown openings, empty-origin journals, corrected/void trades, draft/committed/rolled-back CSV originals and live owner/MFA/session/admission data
- **WHEN** actual migration16 and replay run in the release image
- **THEN** every preceding row, original byte/settings/receipt/provenance, schema object and sequence definition is preserved, aside from explicitly reviewed additive origin constraints and the migration ledger advancement
- **AND** new carry-in storage starts empty, no aggregate is converted and old accepted commands replay identically
- **AND** fresh16 and every earlier populated upgrade/unsafe-history refusal remain passing; no owner database or destructive downgrade is used
