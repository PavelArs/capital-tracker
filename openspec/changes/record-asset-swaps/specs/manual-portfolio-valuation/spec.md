# manual-portfolio-valuation Specification

## MODIFIED Requirements

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