## ADDED Requirements

### Requirement: VAL-1 Exact historical position valuation
The system SHALL value a single account's reconstructed positive positions at an
explicit instant using only effective manual USD prices at that exact UTC instant.
It SHALL retain UUID identity, inclusive accounting boundaries, immutable carry-in
allocation and current-effective-history basis. Products/sums SHALL be canonical
exact decimal strings with up to60 fractional digits, without intermediate rounding.

#### Scenario: VAL-EXACT Known historical value and corrected price
- **GIVEN** covered buys1/cost100 and1/cost200 followed by sale1.5/gross450, and exact-time manual price300
- **WHEN** the owner values the account at the sale instant
- **THEN** quantity0.5, cost100 and value150 are returned with complete total150 and the used price revision
- **WHEN** the exact-time price is corrected to320
- **THEN** an explicit refresh returns160 with the new price revision, while old receipts remain unchanged.

#### Scenario: VAL-PRECISION Tiny products and full supported history
- **GIVEN** quantity0.000000000000000000000000000001 and price of the same size
- **WHEN** the account is valued at that exact price instant
- **THEN** its nonzero value is exactly one unit at decimal scale60
- **AND** supported maximum quantities/prices and100 carry-in lots plus1000 active trades remain exact and fully included before returning the bounded complete position set.

### Requirement: VAL-2 Honest missing coverage and known zero
The system SHALL distinguish missing/voided exact-time prices from known price0.
Missing positive positions SHALL yield null values and null total, with an explicitly
partial exact priced subtotal and missing count. It SHALL never substitute cost,
another UUID, a prior/future price or inferred1USD. No positions SHALL mean complete0.
Absent accounting coverage or precoverage requests SHALL return409, without mutation.

#### Scenario: VAL-GAPS Same symbol, stale point, void and zero
- **GIVEN** two distinct same-symbol held instruments and only one exact-time price
- **WHEN** valuation is requested
- **THEN** the unpriced UUID has null price/value, missingPriceCount1 and totalValueUsd=null; only the priced row contributes to pricedSubtotalUsd
- **WHEN** the second receives explicit price0
- **THEN** the total becomes complete; voiding either exact point makes it incomplete again, even with adjacent older/newer points.

#### Scenario: VAL-COVERAGE Empty and carry-in boundaries
- **GIVEN** a declared-empty journal, a known-cost carry-in journal and an account without a journal
- **WHEN** each is valued at coverage
- **THEN** the empty journal returns complete0, carry-in precedes inclusive trades and uses the actual quantity even at zero acquisition cost, and unavailable history returns409
- **AND** any precoverage request returns409 rather than inventing zero holdings.

### Requirement: VAL-3 Coherent private database reads
The system SHALL read the entire valuation in one owner-scoped RR READ ONLY
transaction with existing bounded history, allowlisted query/response and auth,
MFA, origin and no-store controls. Reads SHALL make no provider calls or business
row/receipt/import mutations. Foreign/unknown accounts SHALL return404; invalid
IDs, duplicate dates and unexpected query keys SHALL return400.

#### Scenario: VAL-SNAPSHOT Concurrent prices and trades
- **GIVEN** an actual PostgreSQL valuation paused after establishing its snapshot
- **WHEN** a competing connection commits a price correction and trade correction
- **THEN** the paused response is wholly old quantities/prices/revisions, and a new request is wholly committed state.

#### Scenario: VAL-PRIVATE Admission and preservation
- **GIVEN** actual HTTPS clients and PostgreSQL fingerprints/provider counters
- **WHEN** anonymous or MFA-pending clients read valuation, or the owner requests foreign account or malformed/duplicate query
- **THEN**401,404 or400 denials expose no accounting data with private no-store behavior
- **WHEN** the admitted owner repeats valid reads
- **THEN** business rows and provider counters remain unchanged; only normal session/admission bookkeeping can change.

### Requirement: VAL-4 Russian read-only account review
The system SHALL expose a protected Russian account-detail valuation form with
exact amounts, selected UTC instant, coverage, revisions and manual exact-point
limitations. It SHALL identify account-only tracked positions, distinguish partial
subtotal from total, invalidate stale intent, ignore late responses, permit explicit
refresh and preserve parent trade-edit state. No browser persistence is introduced.

#### Scenario: VAL-UI Actual browser review and stale intent
- **GIVEN** an owner logged in via real password/MFA and incomplete exact-time prices
- **WHEN** they calculate the selected account value, add the missing exact price and explicitly refresh
- **THEN** the real UI changes from incomplete subtotal to complete total using PostgreSQL values, with literal labels and exact strings
- **WHEN** a real read response is delayed and the instant/account is changed
- **THEN** the late result cannot repopulate the view and no valuation write is issued or unsaved trade edit reset.
