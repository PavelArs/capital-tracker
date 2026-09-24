## MODIFIED Requirements

### Requirement: TRANSFER-001 Recorded internal movements preserve ownership and basis
The application SHALL record a reviewed already performed movement between two distinct owned initialized manual journals, atomically debit the credited principal and explicit fee from the sender, credit only principal to the receiver, and preserve exact original FIFO lot provenance and coordinates without creating a trade gain or external flow.

`quantity` means principal credited to the receiver. Fee consumption follows
principal debit and precedes receiver credit. Positive fee requires an owned
held instrument UUID; zero fee requires null fee instrument. Same-symbol assets
remain distinct. Consumed fee basis is historical acquisition cost, explicitly
labelled `feeConsumedBasisUsd`, never a market fee valuation or duplicated expense.
Received fragments become available only on arrival, then FIFO uses original
acquisition ordering. Repeat/onward/return transfers retain original intervals.

Reward origins SHALL preserve original known-or-unknown acquisition basis and category through movement, fees and return. Unknown consumed basis SHALL remain null with exact known subtotal/evidence; quantity and known0 remain exact.

#### Scenario: TRANSFER-001-A Principal and same-asset fee conserve basis
- **GIVEN** A bought1 unit for100USD and1 for200USD, and B is declared empty
- **WHEN** an owned transfer credits1.5 units to B with0.1 unit fee from A
- **THEN** A holds0.4 with80USD basis, B holds1.5 with200USD basis and fee consumed basis is20USD
- **AND** both trade realized totals and external-flow rows remain unchanged
- **WHEN** B sells1.2 units for360USD without a sale fee
- **THEN** B consumes140USD basis, realizes220USD and retains0.3 units with60USD basis

#### Scenario: TRANSFER-001-B Return fragments retain rounding phase
- **GIVEN** an original lot of3 units and1 scale30 USD atom of cost
- **WHEN** A moves2 units to B and B returns1 unit to A
- **THEN** A holds original ranges[0,1) with0 cost and[2,3) with1 atom while B holds[1,2) with0 cost
- **AND** A's later first sale consumes0 basis and its final original tail consumes1 atom, without rebasing or manufacturing cost

#### Scenario: TRANSFER-001-C Arrival controls availability
- **GIVEN** A's January1 lot arrives at B on January4 and B bought its own lot on January2
- **WHEN** history includes B's January3 sale and another sale on January5
- **THEN** the earlier sale uses only B's then-available lot and the later sale consumes the older arrived A lot first

#### Scenario: TRANSFER-001-D Fee identity and insufficiency are exact
- **GIVEN** two owned instrument UUIDs share a symbol and the transfer fee uses the second UUID
- **WHEN** principal uses the first UUID and fee holdings of the second are sufficient
- **THEN** only the respective holdings are consumed and fee quantities/basis remain separately identified
- **WHEN** the sender lacks any required principal or fee at the historical prefix
- **THEN** the whole command returns409 and no principal, fee, head, version or revision change persists

#### Scenario: REWARD-TRANSFER-UNKNOWN
- **WHEN** unknown-cost reward portions fund principal and fee
- **THEN** both affected basis totals remain null; quantities and original reward intervals survive onward/return movement

### Requirement: TRANSFER-003 Connected histories rebuild under one transaction
The application SHALL replay the affected owned-account graph after transfer, source trade or CSV history changes, reject any invalid prefix atomically, and invalidate all dependent account revisions while keeping immutable command receipts and original CSV bytes unchanged.

Acquire the owner transaction advisory lock before economic account-row locks,
then account locks in UUID order. Source trade advances one tick; source CSV retains
its existing N consecutive command ticks; other affected accounts advance once.
Transfer commands advance every affected account once. Use the union of old/new
components, including nodes disconnected by void. Actual local saved-version count
is separate from the10000 journal-revision budget, which includes passive ticks.
All affected budgets must permit a write. Replay of saved commands precedes live caps.

Reward mutations SHALL acquire the same owner-first locks, validate all connected dependent prefixes and advance each affected account once without adding local trade versions. Reward heads SHALL be included in every trade/CSV/transfer replay.

#### Scenario: TRANSFER-003-A Source cost restatement reaches later receiver sale
- **GIVEN** TRANSFER-001-A including B's sale and immutable earlier command receipts
- **WHEN** A's first buy cost is corrected from100 to120USD
- **THEN** B's sale consumes160USD basis and realizes200USD; A/B remaining bases stay80/60USD and the fee basis stays20USD
- **AND** both account pins advance, old pinned receiver pages/CSV previews return409 and original receipts remain identical

#### Scenario: TRANSFER-003-B Deficit and CSV rollback are atomic
- **GIVEN** incoming fragments support later sales or onward transfers, including a confirmed source CSV batch
- **WHEN** correcting/voiding a source trade or rolling back the batch leaves any dependent historical prefix negative
- **THEN**409 returns and all accounts, transfer/trade versions, batches, provenance and pins remain unchanged
- **AND** a sufficient valid alternative rebuilds the whole dependent chain without frozen source history or a one-hop restriction

#### Scenario: TRANSFER-003-C Actual concurrent commands and commit failure
- **GIVEN** separate PostgreSQL connections submit conflicting same-owner transfer/trade/CSV writes
- **WHEN** the owner advisory and account locks serialize those transactions
- **THEN** one valid CAS succeeds, stale contenders fail and exact replay returns the saved receipt
- **WHEN** a deferred constraint fails at COMMIT after inserts and pin updates
- **THEN** no part of the command persists, including request-key use or any passive account tick

#### Scenario: TRANSFER-003-D Voiding a bridge invalidates both resulting components
- **GIVEN** a valid bridge movement connects two otherwise independent groups
- **WHEN** voiding it yields valid remaining histories
- **THEN** every member of the old/new union advances once, including now-disconnected accounts, and old read/preview pins fail
- **AND** capacity exhaustion in any affected account rejects the whole command before writes

#### Scenario: REWARD-TRANSFER-RESTATEMENT
- **WHEN** an upstream reward cost is corrected or its consumed quantity is removed
- **THEN** valid costs restate downstream; invalid deficits reject the entire command without changing pins or receipts

### Requirement: TRANSFER-004 Bounded projections remain coherent and exact
The application SHALL expose bounded private transfer history and provenance pages, current/historical holdings and valuations from one repeatable-read snapshot, with explicit capacity failures and no truncated financial results.

Owner limits are1000 active transfers/10000 transfer versions. Each affected union
or read component is bounded by32 accounts/10000 active trades/1000 active transfers,
plus existing1000 active trades and100 carry-in lots per account. Each full old or
candidate replay stops before exceeding100000 principal/fee/sale allocation matches.
Held fragments are separately bounded by100000 per replay. Derived lot/match/history
page offsets extend to99999, raw trade-head offsets remain9999; all at most14200
distinct connected positions are valued. Paged output is limited to100 records; noninitial current pages require the exact
relevant pin(s). Derived monetary sums retain all scale30 atoms even beyond input
precision. Series retains current31-point maximum and loads its ledger once.

Each component additionally SHALL contain at most1000active rewards within their owner cap. Maximum distinct connected positions is14200 with existing offsets. Unknown basis SHALL have the nullable totals/evidence specified by record-asset-rewards while exact quantity/price valuation remains available.

#### Scenario: TRANSFER-004-A Bounded pinned allocation differs from command history
- **GIVEN** a transfer consumes more than100 original fragments
- **WHEN** the owner reads allocation pages using both current account pins
- **THEN** each page has at most100 rows, deterministic principal-then-fee ordering and exact full allocation totals
- **WHEN** source history is corrected between pages
- **THEN** the old allocation pin returns409 while immutable version pages and saved receipts remain readable and unchanged

#### Scenario: TRANSFER-004-B One real database snapshot covers linked values
- **GIVEN** a repeatable-read history/valuation request is held at a real PostgreSQL barrier
- **WHEN** another connection commits a source correction affecting receiver holdings
- **THEN** every point/account in the first request uses the original coherent state and a subsequent request uses the new state
- **AND** inclusive transfer-time prefixes contain both legs and fee, precoverage baselines never appear early, and provider request count stays zero

#### Scenario: TRANSFER-004-C Limits reject without partial results
- **GIVEN** a candidate exceeds a component/account/version/match bound or a dependent journal has exhausted its revision budget
- **WHEN** the candidate is evaluated
- **THEN** explicit409 returns without truncated allocations, partial holdings, writes or request-key reservation
- **AND** valid inputs at the limits and untouched single-account maxima remain exact

#### Scenario: REWARD-TRANSFER-READ
- **WHEN** an allocation has mixed known and unknown reward portions
- **THEN** every page has the same full nullable totals and known subtotals from one snapshot, with pins covering source reward changes
