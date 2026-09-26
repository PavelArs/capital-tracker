# historical-account-valuation Specification

## MODIFIED Requirements

### Requirement: VAL-1 Exact historical position valuation
Historical positions SHALL include effective swaps at their inclusive event instant, using net received quantity and exact outgoing debit from the complete connected FIFO history. Valuation SHALL use only exact-time stored prices; consideration, basis, and realized swap result are not substitutes for market price or value.

The system SHALL value a single account's reconstructed positive positions at an
explicit instant using only effective manual USD prices at that exact UTC instant.
It SHALL retain UUID identity, inclusive accounting boundaries, immutable carry-in
allocation and current-effective-history basis. Products/sums SHALL be canonical
exact decimal strings with up to60 fractional digits, without intermediate rounding.

Positions SHALL be reconstructed from the connected transfer-aware history at the selected
instant: a received fragment is unavailable before arrival, and its quantity, original
acquisition identity and exact basis remain those of its source lot. A movement SHALL not
duplicate the same inventory or fabricate an observed price.

Reward quantities SHALL be valued from the existing exact-time manual prices independently of nullable acquisition basis or declared income. Unknown basis SHALL retain explicit cost evidence without changing price completeness.

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

#### Scenario: TRANSFER-VAL-MOVEMENT Valuation follows an effective internal move
- **GIVEN** a known source lot is transferred to another covered account before a manual exact-time price
  point
- **WHEN** each account is valued at the same instant
- **THEN** only the recipient includes the moved quantity, using the same exact price identity and original
  lot basis, and the sum across both accounts counts that inventory once

#### Scenario: REWARD-VAL-INDEPENDENT
- **WHEN** a reward2/unknown basis/income40 is priced at5
- **THEN** value is10 and cost null; income40 never becomes cost, price or market value

#### Scenario: SWAP-VAL-POSITIONS
- **GIVEN** a covered account swaps outgoing quantity for a different instrument and both have exact-time manual prices
- **WHEN** the owner values the account at the swap instant
- **THEN** outgoing and net incoming quantities follow event ordering and only their exact stored prices determine market value; consideration is not added as cash

### Requirement: VAL-3 Coherent private database reads
The coherent valuation snapshot SHALL load effective swaps with trades, transfers, rewards, carry-in, and manual prices. A connected swap correction or void SHALL not permit mixed old/new positions or revisions.

The system SHALL read the entire valuation in one owner-scoped RR READ ONLY
transaction with existing bounded history, allowlisted query/response and auth,
MFA, origin and no-store controls. Reads SHALL make no provider calls or business
row/receipt/import mutations. Foreign/unknown accounts SHALL return404; invalid
IDs, duplicate dates and unexpected query keys SHALL return400.

A valuation SHALL load the connected transfer ledger once in the same owner-scoped REPEATABLE
READ snapshot as trades, carry-in baselines and manual price versions. A mutation anywhere
upstream that affects the selected account SHALL advance its shared journal pin and prevent a
mixed old/new position result.

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

#### Scenario: TRANSFER-VAL-SNAPSHOT Correction preserves coherent recipient value
- **GIVEN** a real valuation snapshot is established while another connection corrects a source trade whose
  lot was transferred
- **WHEN** the valuation completes its connected replay and reads manual prices
- **THEN** it returns the wholly old position/revision state, and a later request returns the wholly
  corrected state without changing the manual price history

#### Scenario: SWAP-VAL-SNAPSHOT
- **GIVEN** an account valuation snapshot is established while a connected swap correction commits
- **WHEN** the original request finishes
- **THEN** it is wholly consistent with the old effective holdings and prices, and a subsequent request sees the new connected revision