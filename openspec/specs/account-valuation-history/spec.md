# account-valuation-history Specification

## Purpose
Provide a coherent bounded history of one account's tracked position values using
exact-time manual USD prices, with exact totals, explicit gaps and a Russian chart.
## Requirements
### Requirement: VCH-1 Bounded exact account series
Each historical sample SHALL include the current-effective connected swap events at that instant, with incoming fees and original FIFO provenance reflected in quantities. Exact-time prices alone determine value; swap consideration/result SHALL not be added as a separate holding or cash flow. The existing sampling schedule and bounds remain unchanged.

The system SHALL return a coherent read-only historical valuation series for one
owned account for normalized from/to instants at most30 elapsed days apart. It
SHALL sample the start, every24 hours and the exact end once, at most31 sorted
unique points. Holdings SHALL use inclusive effective trades and immutable carry-in,
not today's balances. Manual price selection, exact scale60 arithmetic and null
versus zero semantics SHALL match the existing point valuation contract.

Every sampled point SHALL reconstruct current-effective positions through the complete connected
transfer history at that point instant, respecting transfer arrival and original lot intervals.
The existing30-day period, sampling schedule, exact-time pricing and gap behavior SHALL remain
unchanged. Each point SHALL include the complete connected position set up to15,200 original
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

#### Scenario: SWAP-VCH-SERIES
- **GIVEN** a chart range includes the exact instant of an effective swap and exact-time prices for both instruments
- **WHEN** the bounded series is requested
- **THEN** points before and after the swap use the respective holdings, existing sample bounds remain unchanged, and swap consideration is not counted as cash or price

### Requirement: VCH-2 Coherent private database history
A chart request SHALL load the connected ledger once per snapshot including effective swaps, and every sample SHALL derive from that same complete history. Swap changes SHALL not cause repeated per-point loads or mixed revisions.

The system SHALL load history once and batch exact-time prices in one owner-scoped
RR READ ONLY transaction. It SHALL preserve authentication, MFA, origin and no-store
boundaries, make zero provider calls and mutate no business data. Existing point
valuation and historical accounting endpoints SHALL retain their behavior.

A chart request SHALL load the connected journal once inside its existing single REPEATABLE READ
transaction, then evaluate all unchanged sample instants from that snapshot. All relevant source, recipient, transfer, reward, swap and price revisions SHALL be
coherent; the established point count and period bounds SHALL not multiply connected-ledger queries. A series SHALL omit
point-specific transferSummary and swapSummary from its top-level metadata; it SHALL NOT present
the first sample's transfer basis or swap summary as a whole-period total.

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

#### Scenario: SWAP-VCH-LOAD
- **GIVEN** a bounded series crosses multiple swaps and one connected swap correction commits after the read snapshot begins
- **WHEN** every point is calculated
- **THEN** all points use the same pre-correction connected ledger; a later series uses the corrected ledger without reloading it per point

### Requirement: VCH-3 Honest Russian chart and table
The system SHALL offer an account-detail Russian custom-period form, exact table
and UTC scatter chart of complete sampled valuations only. Zero SHALL be plotted;
incomplete values and partial subtotals SHALL never become chart totals. Chart
coordinates SHALL be a display-only approximation, with no connecting lines,
silent interpolation or fabricated continuous coverage. Exact strings SHALL stay
available in table/tooltips. No complete values SHALL retain the gap table and an
explicit unavailable-chart state. Stale intent SHALL invalidate results and late
responses SHALL not overwrite a changed period/account or unsaved trade draft.

#### Scenario: VCH-UI Actual history, period switch and refresh
- **GIVEN** an owner signed in through real password/MFA and VCH-TIMELINE data
- **WHEN** they open history, change its period, then save the missing zero price and refresh
- **THEN** the table shows all exact sampled values/gaps, the actual chart plots only complete values including zero, and provider counters do not change
- **WHEN** an actual read response is delayed and the period changes
- **THEN** the late result stays discarded and unsaved trade input is preserved.

#### Scenario: VCH-CHART Rendering precision and missing values
- **GIVEN** complete values including0 and a scale60 tiny value alongside an incomplete point with nonzero partial subtotal
- **WHEN** chart data are prepared and rendered
- **THEN** only complete values become coordinates, all exact table/tooltip strings remain unchanged, and no line bridges the missing date
- **AND** an all-incomplete series shows an unavailable chart and its full table.
