## ADDED Requirements

### Requirement: MPV-1 Exact value for an explicit manual-account subset
The system SHALL value1..10 unique selected owned manual accounts at one UTC instant
from stored effective history and exact-time manual USD prices. It SHALL retain
per-account provenance and exact decimal strings, with no provider call or inferred
cash, observed wallet balance or whole-portfolio claim.

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

### Requirement: MPV-2 Private bounded snapshot without mutations
The preview SHALL use one read-only repeatable-read PostgreSQL snapshot across all
selected accounts and price versions. Authentication, full MFA, CSRF, no-store,
strict request fields and owner-scoped selection SHALL apply. Invalid saved history
SHALL fail rather than being hidden as an ordinary coverage gap.

#### Scenario: MPV-PRIVATE Strict selection and isolation
- **WHEN** an anonymous/MFA-pending client, missing-CSRF request, foreign/missing ID, duplicate ID, over10 selection or extra input/query attempts a preview
- **THEN** the actual backend denies it with401/403/404/400 as applicable, without data disclosure, provider requests or business writes
- **AND** one foreign ID denies the entire mixed request rather than returning the owned subset.

#### Scenario: MPV-SNAPSHOT Concurrent correction and pure reads
- **GIVEN** a preview has begun its PostgreSQL snapshot
- **WHEN** another connection corrects a selected account or exact-time price
- **THEN** the in-flight preview remains internally consistent with the earlier snapshot and a later preview sees the correction
- **AND** repeated previews change no stored business rows and make zero provider requests.

### Requirement: MPV-3 Russian selection and trustworthy asynchronous results
The manual-accounts page SHALL offer explicit account selection and UTC preview,
exact per-account/aggregate values, coverage explanations and manual-subset caveats.
Editing selection/time or leaving the view SHALL invalidate older pending results
without disturbing account creation or catalog paging.

#### Scenario: MPV-UI Exact display and stale intent
- **GIVEN** real login with MFA, multiple manual accounts and stored exact prices
- **WHEN** the owner selects accounts and explicitly requests a preview
- **THEN** the Russian summary/table show the exact sum and any missing-data reasons
- **WHEN** a real response is delayed and the owner changes selection or time
- **THEN** the old result stays cleared and cannot overwrite the new intent; only an explicit fresh preview supplies a result.
