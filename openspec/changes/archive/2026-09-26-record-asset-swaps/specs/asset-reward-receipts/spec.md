# asset-reward-receipts Specification

## MODIFIED Requirements

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