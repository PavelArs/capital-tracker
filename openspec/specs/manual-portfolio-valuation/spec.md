# manual-portfolio-valuation Specification

## Purpose
Provide exact database-only USD valuation for an explicitly selected set of manual accounts, preserving coverage and price gaps within one private snapshot.
## Requirements
### Requirement: MPV-1 Exact value for an explicit manual-account subset
Selected-account positions SHALL include effective swaps exactly once at their recorded time. Swap consideration and realized result SHALL not be added as cash, an external contribution/withdrawal, or market value; only explicitly stored prices value resulting holdings.

The system SHALL value1..10 unique selected owned manual accounts at one UTC instant
from stored effective history and exact-time manual USD prices. It SHALL retain
per-account provenance and exact decimal strings, with no provider call or inferred
cash, observed wallet balance or whole-portfolio claim.

For each selected account, positions SHALL reflect its complete connected transfer-aware history
at the requested instant. A movement only relocates owned inventory between accounts; when both
participants are selected, principal is counted once in aggregate. Any separately consumed fee
asset remains absent from the sender inventory and is not assigned a market value or external
flow.

Selected accounts SHALL include reward quantities with independent cost/price completeness. Only explicit prices determine market value; reward income and basis never substitute for prices or create external flows.

#### Scenario: MPV-EXACT Shared identity and exact aggregate
- **GIVEN** selected accounts hold0.5 and2 units of the same instrument UUID, priced123.456 at the requested instant
- **WHEN** the owner previews those accounts
- **THEN** values are61.728 and246.912 and the exact total is308.64
- **AND** a distinct instrument UUID with the same symbol never borrows that price; each selected account is counted once.

#### Scenario: MPV-GAPS Unknown coverage and price versus zero
- **GIVEN** a selected account has no journal, begins coverage after the instant, or holds an unpriced instrument
- **WHEN** the preview is computed
- **THEN** it identifies each gap, reports only the known priced subtotal and leaves the aggregate total null
- **AND** a covered empty account or explicitly zero-priced position is known zero, while unknown history has no invented position count or zero value.

#### Scenario: TRANSFER-MPV-SELECTED Selected accounts do not duplicate moved holdings
- **GIVEN** a known lot is transferred between two selected accounts and an exact-time manual USD price
  exists
- **WHEN** the selected-account preview is calculated before and after arrival
- **THEN** account values move with the lot while aggregate principal value counts it once, with no
  synthetic cash, trade or external-flow entry

#### Scenario: REWARD-MPV-NODOUBLE
- **WHEN** a reward partly moves between two selected accounts
- **THEN** aggregate value counts currently held quantities once and preserves unknown cost evidence; source income is not duplicated

#### Scenario: SWAP-MPV-SELECTED
- **GIVEN** selected accounts include a swap and exact prices for the resulting holdings
- **WHEN** the selected-account valuation is calculated
- **THEN** resulting asset quantities are valued once from stored prices, while consideration/result creates neither a cash position nor an external flow

### Requirement: MPV-2 Private bounded snapshot without mutations
The selected-account snapshot SHALL load each required connected history once including effective swaps, even when a connected source lies outside the selected subset. A concurrent swap mutation SHALL leave the established snapshot wholly old and a later preview wholly current.

The preview SHALL use one read-only repeatable-read PostgreSQL snapshot across all
selected accounts and price versions. Authentication, full MFA, CSRF, no-store,
strict request fields and owner-scoped selection SHALL apply. Invalid saved history
SHALL fail rather than being hidden as an ordinary coverage gap.

The single read-only repeatable-read snapshot SHALL include each selected account and its
required connected transfer component, loading that ledger once. A write to any upstream
participant after the snapshot begins SHALL not mix newer transfer or source heads into older
valuations.

#### Scenario: MPV-PRIVATE Strict selection and isolation
- **WHEN** an anonymous/MFA-pending client, missing-CSRF request, foreign/missing ID, duplicate ID, over10 selection or extra input/query attempts a preview
- **THEN** the actual backend denies it with401/403/404/400 as applicable, without data disclosure, provider requests or business writes
- **AND** one foreign ID denies the entire mixed request rather than returning the owned subset.

#### Scenario: MPV-SNAPSHOT Concurrent correction and pure reads
- **GIVEN** a preview has begun its PostgreSQL snapshot
- **WHEN** another connection corrects a selected account or exact-time price
- **THEN** the in-flight preview remains internally consistent with the earlier snapshot and a later preview sees the correction
- **AND** repeated previews change no stored business rows and make zero provider requests.

#### Scenario: TRANSFER-MPV-SNAPSHOT Selected subset uses coherent connected heads
- **GIVEN** a PostgreSQL snapshot includes a selected recipient whose source account is outside the selected
  subset
- **WHEN** the source commits a correction after the reader snapshot is established
- **THEN** the selected subset result remains coherent with its original connected revision and subsequent
  preview sees the corrected value

#### Scenario: SWAP-MPV-SNAPSHOT
- **GIVEN** a selected recipient depends on a connected source swap outside the selected account set
- **WHEN** that source swap is corrected after the preview snapshot begins
- **THEN** the established preview is wholly old and a later preview is wholly current, with no repeated connected-history load per selected account

### Requirement: MPV-3 Russian selection and trustworthy asynchronous results
The manual-accounts page SHALL offer explicit account selection and UTC preview,
exact per-account/aggregate values, coverage explanations and manual-subset caveats.
Editing selection/time or leaving the view SHALL invalidate older pending results
without disturbing account creation or catalog paging. The supplementary panel SHALL
start collapsed and offer a clear valuation action. Collapsing the panel SHALL only
hide it, preserving selection, time and current results without changing the intent
or issuing another request; page navigation SHALL still invalidate older responses.

#### Scenario: MPV-UI Exact display and stale intent
- **GIVEN** real login with MFA, multiple manual accounts and stored exact prices
- **WHEN** the owner selects accounts and explicitly requests a preview
- **THEN** the Russian summary/table show the exact sum and any missing-data reasons
- **WHEN** a real response is delayed and the owner changes selection or time
- **THEN** the old result stays cleared and cannot overwrite the new intent; only an explicit fresh preview supplies a result.

#### Scenario: MPV-UI-DISCLOSURE Preserve a deliberate valuation
- **GIVEN** a real exact selected-account preview
- **WHEN** the owner collapses and reopens the valuation panel
- **THEN** selected accounts, UTC time, exact result and missing-data explanations remain
- **AND** no extra preview or business mutation is issued

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
