## MODIFIED Requirements

### Requirement: VCH-1 Bounded exact account series
The system SHALL return a coherent read-only historical valuation series for one
owned account for normalized from/to instants at most30 elapsed days apart. It
SHALL sample the start, every24 hours and the exact end once, at most31 sorted
unique points. Holdings SHALL use inclusive effective trades and immutable carry-in,
not today's balances. Manual price selection, exact scale60 arithmetic and null
versus zero semantics SHALL match the existing point valuation contract.

Every sampled point SHALL reconstruct current-effective positions through the complete connected
transfer history at that point instant, respecting transfer arrival and original lot intervals.
The existing30-day period, sampling schedule, exact-time pricing and gap behavior SHALL remain
unchanged. Each point SHALL include the complete connected position set up to13,200 original
lots without per-point paging or truncation.

#### Scenario: VCH-TIMELINE Historical quantities, gaps and corrections
- **GIVEN** coverageJan1, buy1 onJan2, buy1 onJan3, sale1.5 onJan4, and manual exact-midnight prices100 onJan2 and300 onJan4
- **WHEN** the owner requests Jan1 through Jan4 inclusive
- **THEN** totals are0,100,null,150 respectively; Jan3 has missingPriceCount1 and pricedSubtotalUsd0
- **WHEN** Jan3 receives price0 or Jan4 is corrected to320 and the series is refreshed
- **THEN** those totals become0 and160 respectively, while original rows/receipts remain preserved.

#### Scenario: VCH-RANGE Exact interval endpoints and validation
- **GIVEN** valid UTC or offset-equivalent instants
- **WHEN** a36-hour period or equal endpoints are requested
- **THEN** samples are start,start+24h,end or a single point respectively, without duplicates or local-DST shifting
- **AND** reversed, longer-than30-day, invalid, duplicate or unexpected query fields return400; absent/precoverage history409 and foreign/unknown account404.

#### Scenario: TRANSFER-VCH-TIMELINE Points follow arrival and preserve lot identity
- **GIVEN** an original lot moves between covered accounts between two existing chart sample instants
- **WHEN** separate bounded histories for the source and recipient accounts are requested across those
  instants
- **THEN** the source point loses the moved quantity at the effective instant and the recipient point gains
  it, with the same original lot basis and no duplicated point inventory

### Requirement: VCH-2 Coherent private database history
The system SHALL load history once and batch exact-time prices in one owner-scoped
RR READ ONLY transaction. It SHALL preserve authentication, MFA, origin and no-store
boundaries, make zero provider calls and mutate no business data. Existing point
valuation and historical accounting endpoints SHALL retain their behavior.

A chart request SHALL load the connected journal once inside its existing single REPEATABLE READ
transaction, then evaluate all unchanged sample instants from that snapshot. All relevant
source, recipient, transfer and price revisions SHALL be coherent; the established point count
and period bounds SHALL not multiply connected-ledger queries. A series SHALL omit
point-specific transferSummary from its top-level metadata; it SHALL NOT present
the first sample's transfer basis as a whole-period total.

#### Scenario: VCH-SNAPSHOT Concurrent restatement and supported maxima
- **GIVEN** real PostgreSQL and a series read paused after anchoring its snapshot
- **WHEN** another connection commits trade and price corrections before remaining reads
- **THEN** every point in the paused series is wholly old state and a new request is wholly new state
- **AND**31 points across100 initial lots plus1000 active trades remain exact without per-point database round trips or early truncation.

#### Scenario: VCH-PRIVATE Admission and repeated read preservation
- **GIVEN** actual HTTPS clients, PostgreSQL fingerprints and external-provider counters
- **WHEN** anonymous/MFA-pending clients request series or the owner requests foreign/malformed inputs
- **THEN**401/404/400 denials expose no portfolio data with private no-store responses
- **WHEN** the admitted owner reopens history or changes its period
- **THEN** business rows and provider counters remain unchanged; only normal auth bookkeeping may change.

#### Scenario: TRANSFER-VCH-SNAPSHOT Connected chart points share one revision
- **GIVEN** a real bounded series read pauses after its snapshot while an upstream source correction commits
- **WHEN** the series finishes calculating all points
- **THEN** every point reflects the same complete old connected state, and a new series reflects the new
  state without repeated per-point connected-history loads
