# linked-twr-preview Specification

## Purpose
Provide a private read-only, revision-pinned manual linked TWR preview from complete
owner external flows and reviewed preflow valuations, with exact rational linking,
explicit gaps/capacity limits and transient Russian review controls.

## Requirements
### Requirement: LTWR-1 Complete revision-pinned boundary plan
GET `/accounting/portfolio/twr-boundaries` SHALL strictly accept from/to, use one
owner RR READ ONLY snapshot and return the complete sorted set of strictly interior
nonzero net external-flow instants, netted by UTC millisecond, with coverage/revision.
At most32 boundaries SHALL be offered; larger sets SHALL return explicit unavailable
`too-many-boundaries`, actual count and an empty list without truncating calculations.

#### Scenario: LTWR-PLAN Simultaneous flows and complete heads
- **GIVEN** corrected/voided owner flows exceeding one page, same-ms cancellation, from/to flows and foreign records
- **WHEN** a covered plan is requested
- **THEN** only effective owner nonzero-net interior instants appear in order, from net is separate and to is excluded
- **AND** exactly32 boundaries is ready while33 is explicitly unavailable with no partial list

### Requirement: LTWR-2 Exact geometrically linked period return
POST `/accounting/portfolio/linked-twr-preview` SHALL accept strictly reviewed profit
inputs, expectedJournalRevision and up to32 unique normalized interior boundary
valuations. It SHALL compare the revision in the same full snapshot before semantic
boundary matching. It SHALL multiply exact rational preflow/previous-postflow factors
and the terminal factor, then subtract1 and round once to12 places, nearest/ties away
from zero; percent SHALL be100 times the published rate, with canonical strings.

#### Scenario: LTWR-LINK Contribution does not inflate return
- **GIVEN** opening1000, preflow valuation1100, intermediate contribution1000 and closing2310
- **WHEN** the owner supplies the matching revision and reviewed boundary value
- **THEN** period return is0.21/21percent and exact profit310
- **AND** an additional boundary at2520 with withdrawal520 and terminal2200 yields0.452/45.2percent and profit720

#### Scenario: LTWR-PRECISION No subperiod rounding
- **GIVEN** exact fractional factors, high-precision money, positive/negative rounding ties or32 boundaries
- **WHEN** a supported preview is calculated
- **THEN** factors link without intermediate rounding and the final arithmetic-only absolute rate error is at most5e-13
- **AND** zero final/boundary numerator is valid only when every subsequent denominator remains positive

### Requirement: LTWR-3 Honest unavailable and private read-only behavior
Structural invalidity, duplicates or extraneous boundary instants SHALL return400;
stale revision/missing coverage SHALL return409. Missing required values, >32
boundaries, nonpositive adjusted opening or nonpositive after-flow capital SHALL
produce explicit unavailable reasons and null rates while preserving exact profit.
Plan and preview SHALL enforce existing owner/MFA/origin/CSRF/no-store protections,
make no financial write/provider request, and keep all existing preview behavior.

#### Scenario: LTWR-GAPS Missing values and capital gaps remain visible
- **GIVEN** a missing boundary value, zero/negative adjusted initial capital, or nonpositive capital after an interior withdrawal
- **WHEN** a valid reviewed preview is requested
- **THEN** the appropriate unavailable reason and null rates are returned with exact profit and boundary diagnostics
- **AND** a zero earlier factor does not bypass validation of later capital gaps

#### Scenario: LTWR-PRIVATE Strict authenticated boundary
- **GIVEN** anonymous/password-only sessions, missing/invalid CSRF or hostile origin, invalid amounts/arrays/fields, or foreign-owner rows
- **WHEN** plan or preview is requested
- **THEN** applicable401/403/400 denials and no-store apply, and successful owned results exclude foreign influence
- **AND** all financial rows/provider state remain unchanged

#### Scenario: LTWR-SNAPSHOT Concurrent correction invalidates subsequent use
- **GIVEN** a matching prepared revision and preview paused after its actual PostgreSQL journal read
- **WHEN** another connection commits a correction changing the required flow boundary
- **THEN** the paused preview retains its original coherent result and revision
- **AND** the next request with the old revision returns409 before boundary-set matching
- **AND** explicit preparation and review of current data permits a new result

### Requirement: LTWR-4 Explicit Russian boundary review
The existing protected period screen SHALL offer an independent linked-TWR section,
explicitly load a boundary plan, display its revision/net flows, collect whole-portfolio
preflow USD valuations and require review. It SHALL display same-response exact profit,
revision and rounded period return or explicit unavailable state. It SHALL disclose
manual/unreconciled data, capacity and timing, and SHALL NOT auto-submit or persist data.

#### Scenario: LTWR-UI Review, stale revision and late responses
- **GIVEN** real password/MFA authentication and the1000/1100/+1000/2310 fixture
- **WHEN** the owner explicitly loads boundaries, enters1100 and confirms review
- **THEN** the interface shows21percent and exact profit310
- **AND** edits clear results/review, period changes discard plan/values, and409 requires explicit reload
- **AND** late actual GET/POST responses cannot restore superseded plans or results
- **AND** the existing endpoint TWR journey passes unchanged

