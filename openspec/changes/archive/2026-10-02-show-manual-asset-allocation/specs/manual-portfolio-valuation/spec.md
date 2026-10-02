## ADDED Requirements

### Requirement: MPV-4 Instrument allocation for a selected manual subset
The existing private selected-account preview SHALL return an `allocation` array grouped by instrument UUID across its covered selected accounts. Each row SHALL contain `instrumentId`, `instrumentName`, `instrumentSymbol`, exact decimal `quantity`, `valueUsd` (exact decimal or null), and `allocationPercent` (two-decimal string or null). Rows SHALL sort by instrument UUID, aggregate quantities and priced values with exact integer arithmetic retaining up to 60 fractional product places, and preserve distinct UUIDs even when symbols match. The existing account rows, price provenance, scope, authentication, CSRF, read-only snapshot and stale-intent behavior SHALL remain unchanged.

The percentage denominator SHALL be the complete selected-account `totalValueUsd`. If the preview is incomplete for any missing history or price, or the complete total is zero, every `allocationPercent` SHALL be null. Otherwise each share SHALL be rounded independently to two decimal places using nonnegative decimal half-up; displayed shares need not sum to exactly 100.00. An unpriced instrument SHALL keep its quantity but have null `valueUsd`; an explicitly zero-priced instrument SHALL keep a known zero value.

#### Scenario: MPV-ALLOC-001 Shared UUID and deterministic exact aggregation
- **GIVEN** two covered selected accounts hold 0.5 and 2 units of one UUID at an exact-time manual price of 123.456 USD
- **WHEN** the owner previews their valuation
- **THEN** one allocation row has quantity `2.5`, value `308.64`, and percentage `100.00`, while the existing account rows retain `61.728` and `246.912`
- **AND** the allocation row order is ascending instrument UUID regardless of account input order.

#### Scenario: MPV-ALLOC-002 Distinct UUIDs, exact fractions and independent rounding
- **GIVEN** different instrument UUIDs share a symbol, and tiny scale-30 quantity and price inputs yield scale-60 products
- **WHEN** a complete positive selected-account preview is calculated
- **THEN** UUIDs remain distinct, quantities and values retain all significant fractional digits, and each percentage is a two-decimal string rounded half-up from exact integer ratios
- **AND** independently rounded percentages are not adjusted to force a sum of `100.00`.

#### Scenario: MPV-ALLOC-003 Missing price and unavailable history
- **GIVEN** a covered account holds an unpriced instrument, or any selected account has missing or precoverage history
- **WHEN** the owner previews their valuation
- **THEN** each known held instrument remains in `allocation`, an unpriced row has its exact quantity and null value, and every allocation percentage is null
- **AND** unknown history creates no invented instrument row or zero holding.

#### Scenario: MPV-ALLOC-004 Known zero and zero total
- **GIVEN** every covered holding is explicitly zero-priced, or covered selected accounts have no positions
- **WHEN** the owner previews their valuation
- **THEN** zero-priced holdings remain as rows with `valueUsd: "0"`, no positions produce an empty array, and all present percentages are null because the complete total is zero.

#### Scenario: MPV-ALLOC-005 Accessible scoped table and stale intent
- **GIVEN** an authenticated owner requests the existing selected-account preview
- **WHEN** it succeeds, the Russian allocation table shows instrument, exact quantity, USD value and share, with unknown values and shares explicitly labeled
- **THEN** the table remains labeled as allocation of selected manual accounts and does not imply cash, connected wallets, observed balances or whole-portfolio coverage
- **AND** editing the selection or UTC instant clears the old allocation with the rest of the preview; a delayed old response cannot restore it.
