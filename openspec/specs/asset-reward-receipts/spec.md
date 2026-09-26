# asset-reward-receipts Specification

## Purpose
Record owner-attested asset rewards with exact quantity, independently known or unknown
acquisition basis and income, immutable lifecycle and connected FIFO provenance. References
to persistence.md use the [archived wire and persistence contract](../../changes/archive/2026-09-24-record-asset-rewards/persistence.md).
## Requirements
### Requirement: REWARD-001 Explicit exact receipt and distinct unknown declarations
The application SHALL record already received owner-attested asset rewards as separate
acquisition events with owned account/instrument identity, explicit UTC chronology, category,
quantity and independently nullable acquisition basis and income value. Known0 SHALL remain
distinct from null. Unclassified reward subtype SHALL remain visible and require review;
other SHALL mean a reviewed category. No reward SHALL become a synthetic buy, external flow,
market price or inferred tax basis. The API SHALL follow persistence.md's exact contract.

#### Scenario: REWARD-001-A Basis income and market value remain independent
- **GIVEN** an initialized account with a reward of2units, null basis and declared income40
- **WHEN** historical holdings are valued using an explicit exact-time unit price5
- **THEN** quantity is2, basis null and market value10, while recorded income remains40
- **AND** purchases, sale gains, external-flow rows and provider counters do not change
- **WHEN** a second reward explicitly has basis0 and income0
- **THEN** both known zeros remain exact strings and distinct from unknown

#### Scenario: REWARD-001-B Invalid or ambiguous input does not invent economics
- **WHEN** raw numeric/omitted cost fields, excess precision, unknown fields, missing reward attestation,
  invalid category/date/order or foreign account/instrument are submitted
- **THEN** malformed input returns400 and valid foreign identities generic404 without request-key use
- **AND** unclassified reward subtype remains labelled unresolved and is excluded from the known
  categorized-income subtotal, making its complete income total null

### Requirement: REWARD-002 FIFO preserves quantity cost evidence and reward provenance
Reward quantity SHALL enter FIFO at its effective instant, preserve original acquisition
coordinates through partial sales/onward/return transfers and remain usable when basis is
unknown. Affected cost/realized totals SHALL be null with exact known subtotals and explicit
missing counts; only fully costed sales SHALL contribute to known realized subtotal.
Unchanged all-known trade/carry/transfer histories SHALL retain their prior results.

#### Scenario: REWARD-002-A Known basis and partial sale conserve declared cost
- **GIVEN** a reward2units with declared basis100 and income70
- **WHEN**1unit is sold for80 with0sale fee
- **THEN** consumed basis50, realized30 and remaining basis50 are exact; gross buys stay0
- **AND** reward income70 remains separate, original reward ID/version retained

#### Scenario: REWARD-002-B Mixed unknown sale never reports optimistic profit
- **GIVEN** a known buy1unit/cost10 followed by reward2units/unknown basis
- **WHEN** a sale1.5units/gross30 consumes both and a separate fully costed sale realizes7
- **THEN** mixed sale cost and realized are null, known consumed subtotal10 and one missing match
- **AND** known realized subtotal includes only7, never the mixed sale's30minus10
- **AND** remaining reward1.5units has unknown cost, while an explicit0basis reward is fully costed

#### Scenario: REWARD-002-C Unknown fragments survive transfer fees and round trips
- **GIVEN** an unknown-basis reward3units in A
- **WHEN** A credits2units to B with0.25same-asset fee and B returns1unit
- **THEN** A holds1.75 and B1, all moved/fee bases remain null, original intervals are conserved
- **AND** fee quantity is counted once without becoming a trade fee or external-flow entry
- **WHEN** that reward's basis is later corrected to12
- **THEN** fee basis is1, A remaining basis7 and B basis4, with original receipts unchanged

### Requirement: REWARD-003 Immutable connected lifecycle is atomic and replay safe
Reward create/correction/void candidate replay SHALL include every effective swap in the connected component. If a changed reward lot feeds a swap, the whole reward and swap history is validated atomically; dependent swap results and participant pins restate without modifying old swap receipts.

The system SHALL implement full create/correct/terminal-void under owner-before-account locks,
validate whole old/candidate histories, enforce shared pins and bounds, append complete
versions and advance every affected account once. Replay SHALL precede live CAS/cap checks;
old receipts and unrelated rows SHALL remain unchanged. Account identity cannot be corrected.

#### Scenario: REWARD-003-A Upstream correction restates recipient sale
- **GIVEN** A's reward2/basis100 has sent1unit to B, which sold it for80
- **WHEN** A corrects reward basis to120 using current pins/version
- **THEN** B's cost becomes60 and realized20, both pins advance once and old pages/previews fail409
- **AND** trade version counts and prior reward/transfer/CSV receipts remain unchanged
- **WHEN** the reward is reduced below consumed quantity, moved after consumption or voided
- **THEN**409 preserves every accounting row and pin; a valid unconstrained void is terminal

#### Scenario: REWARD-003-B Durable replay and real transaction races
- **WHEN** two real processes send identical or conflicting commands at one expected revision
- **THEN** identical requests save one version and replay200; conflicts yield one201andone409
- **AND** replay after subsequent revisions/cap exhaustion returns the exact original receipt
- **WHEN** a deferred constraint fails at COMMIT after journal/head/version writes
- **THEN** all writes and request identity roll back, with an independent post-write witness

#### Scenario: SWAP-REWARD-REPLAY
- **GIVEN** a swap consumes a reward-origin lot
- **WHEN** the reward's declared basis is corrected
- **THEN** the complete connected candidate recalculates the swap's principal or fee allocation and result, advances affected pins once, and leaves the prior swap receipt unchanged

### Requirement: REWARD-004 Coherent bounded history and completeness
Coherent reward and connected history reads SHALL include effective swaps once and preserve swap-origin provenance and separate swap summaries. Unknown swap consideration remains unknown and SHALL NOT be converted to known zero by reward projections or pagination.

All reward/current/historical/provenance/valuation/CSV reads SHALL use one coherent bounded
snapshot and include rewards before paging. Price completeness SHALL remain independent of
cost/category completeness. The persistence contract bounds SHALL apply before materializing
an oversized history; no silent truncation or amount rounding is permitted.

#### Scenario: REWARD-004-A Real snapshot and exact capacity
- **GIVEN** a real PostgreSQL read paused after its repeatable-read snapshot and a concurrent
  reward correction affecting transferred holdings
- **WHEN** the writer commits and the reader continues
- **THEN** the first response is wholly old, a later request wholly new and stale pins return409
- **AND** owner1000active/10000versions and every account revision ceiling accept their exact
  boundary, refuse the next command atomically and still allow old request replay
- **AND** series/selected valuation load rewards once, expose full holdings and request no provider

#### Scenario: SWAP-REWARD-READ
- **GIVEN** a reward-origin fragment participates in a swap and later sale
- **WHEN** a connected reward or allocation read is made
- **THEN** reward and swap evidence share one coherent revision; unknown swap consideration remains unknown rather than becoming zero or a reward income amount

### Requirement: REWARD-005 Protected Russian review retains user intent
The application SHALL provide the Russian reviewed create/correct/void workflow in manual
account detail, render unknown versus known0 honestly, preserve reward origin evidence and
retain an ambiguous command for explicit identical retry. Input/account/revision changes
SHALL invalidate stale review without discarding another form's unsaved draft.

#### Scenario: REWARD-005-A Actual owner records and resolves missing cost
- **GIVEN** an owner authenticated through real password/MFA and a manual account
- **WHEN** the owner reviews and records quantity2, unknown basis and income40
- **THEN** the page shows the saved reward and unknown basis without synthetic trade totals
- **WHEN** the owner corrects basis to0 and later voids an unconstrained reward
- **THEN** exact0 and terminal-void status render correctly and old versions remain readable
- **AND** an actually committed but lost response is retried with identical key/body/pins,
  returning200 without duplicate quantity; late responses never restore stale review

### Requirement: REWARD-006 Additive storage and private boundaries preserve data
Migration21 SHALL create empty constrained reward state without changing prior rows, and
refuse destructive downgrade. Full sessions, Origin/CSRF and no-store protections SHALL
cover every route; anonymous/pending/foreign access SHALL reveal no private data.

#### Scenario: REWARD-006-A Actual migration and denial preserve predecessor data
- **GIVEN** a populated20migration synthetic PostgreSQL database with prior economic and auth rows
- **WHEN** migration21 and no-op replay run
- **THEN** all prior rows/schema and command receipts remain intact; new reward tables start empty
- **AND** SQL invalid numeric/owner/head writes fail and downgrade refuses data removal
- **WHEN** anonymous/pending/expired/revoked or invalid Origin/CSRF requests hit reward routes
- **THEN**401/403 denies them without data; valid foreign lookups use the generic404 envelope
