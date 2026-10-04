## MODIFIED Requirements

### Requirement: OPEN-001 Private manual accounts and instrument identity
The system SHALL provide owner-scoped manual accounts and manual UUID instrument
identities with duplicate labels allowed. Labels MUST NOT imply chain identity, and
MUST NOT imply fiat or provider identity except where `asset-classification` (AST-1,
AST-2) derives an asset's type and price source from its declared type and ticker.
Empty accounts SHALL show revision 0 and no opening. All routes SHALL retain
full-owner session/CSRF protection, parameterized owner-scoped access and no provider calls.

#### Scenario: OPEN-001-A Exact manual opening survives a real restart
- **GIVEN** an owner logged in through actual password and MFA forms
- **WHEN** the owner creates a manual account and opening positions through Russian protected pages
- **THEN** quantity 9007199254740993.000000000000000001 with known total USD cost 123.450000000000000001 and quantity 0.000000000000000001 with unknown cost survive API/PostgreSQL/restart/reload exactly as strings
- **AND** legacy financial rows remain unchanged and accounting page/API operations make no provider requests before or after restart
- **AND** the retained startup price warmup is measured separately as exactly one existing BTC/ETH CoinGecko request per restarted backend, without attributing it to accounting operations

#### Scenario: OPEN-001-B Identity and bounded discovery remain explicit
- **WHEN** two instruments share a symbol and one instrument is reused across two manual accounts
- **THEN** distinct UUIDs remain distinct and accounts retain separate positions without automatic aggregation
- **AND** current and historical position responses include immutable owner-scoped instrument names/symbols even beyond the first instrument page
- **AND** empty accounts remain usable and account/instrument lists use exclusive UUID pagination default 50 / max 100 with no unbounded nested history
