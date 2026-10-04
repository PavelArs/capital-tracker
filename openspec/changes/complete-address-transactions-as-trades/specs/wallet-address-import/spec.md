## MODIFIED Requirements

### Requirement: ADDR-4 Private reads and honest missing data
The system SHALL serve addresses and their transactions only to the authenticated
owner (existing session, MFA, CSRF and origin rules), return 404 for unknown or
foreign ids and read transactions from PostgreSQL only, newest block first, paged by
`offset`/`limit` (default 50, maximum 100). Every transaction without an active linked
journal trade SHALL report `usdValue: null` with `usdValueStatus: "missing"`; a
transaction the owner completed reports its trade's USD value as defined by
`wallet-address-trade-completion`. The system SHALL never present a missing value as
zero and SHALL never derive a USD value from a price source.

#### Scenario: ADDR-PRIVATE Denials
- **GIVEN** anonymous and pending-MFA clients, a request without CSRF token and another owner's address id
- **WHEN** they list, register, sync or read transactions
- **THEN** the existing 401/403 denials apply, the foreign id returns 404 and no row is written or provider called.

#### Scenario: ADDR-UI Russian page shows imported history with missing values
- **GIVEN** the authenticated owner and a provider history of 60 transactions
- **WHEN** they open «Адреса кошельков», add the address and press «Загрузить транзакции»
- **THEN** the page reports «Загружено полностью» and 60 transactions, the newest rows show exact BTC amounts, direction and date, each shows «не указана» as its USD value, the summary reads «Без стоимости в USD: 60 из 60», and after a reload the same data is shown without a provider request.

#### Scenario: ADDR-MIGRATION Additive schema
- **GIVEN** a populated database at migration 22
- **WHEN** the migration CLI runs
- **THEN** it applies migration 23 creating only the two empty new tables, every previous row and schema object is unchanged, a rerun applies nothing, and the down migration refuses without changing data.
