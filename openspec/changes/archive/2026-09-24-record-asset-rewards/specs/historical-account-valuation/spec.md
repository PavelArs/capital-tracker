## MODIFIED Requirements

### Requirement: VAL-1 Exact historical position valuation
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
