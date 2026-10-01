## MODIFIED Requirements

### Requirement: MPV-1 Exact value for an explicit manual-account subset
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
