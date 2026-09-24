## ADDED Requirements

### Requirement: VCH-1 Bounded exact account series
The system SHALL return a coherent read-only historical valuation series for one
owned account for normalized from/to instants at most30 elapsed days apart. It
SHALL sample the start, every24 hours and the exact end once, at most31 sorted
unique points. Holdings SHALL use inclusive effective trades and immutable carry-in,
not today's balances. Manual price selection, exact scale60 arithmetic and null
versus zero semantics SHALL match the existing point valuation contract.

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

### Requirement: VCH-2 Coherent private database history
The system SHALL load history once and batch exact-time prices in one owner-scoped
RR READ ONLY transaction. It SHALL preserve authentication, MFA, origin and no-store
boundaries, make zero provider calls and mutate no business data. Existing point
valuation and historical accounting endpoints SHALL retain their behavior.

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
