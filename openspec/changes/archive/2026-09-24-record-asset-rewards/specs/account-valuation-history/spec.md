## MODIFIED Requirements

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

The once-loaded connected ledger SHALL include effective rewards. A reward correction SHALL invalidate dependent series pins; per-point rewardSummary is omitted while quantity/cost evidence remains correct.

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

#### Scenario: REWARD-VCH-ONCE
- **WHEN** a bounded series spans a reward and a later connected sale
- **THEN** one reward history load serves every point, inclusive quantities and unknown cost stay correct, with no provider request
