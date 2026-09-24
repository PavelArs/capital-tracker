## MODIFIED Requirements

### Requirement: TRADE-002 Exact bounded USD execution inputs
Every execution SHALL identify a manual owned instrument UUID, buy/sell side, explicit
UTC-normalized millisecond instant, explicit same-instant integer order, positive
quantity/gross USD and nonnegative USD fee. Amounts SHALL retain numeric(78,30) raw
string boundaries and explicit SQL finite checks. All declared raw types and unknown
fields SHALL be validated before coercion. Effective chronology SHALL be unique per
account and at/after coverage. Same symbols MUST NOT merge identities or account lots.

Transfer events SHALL have an explicit effective UTC-millisecond instant and same-instant order
at or after both participant coverage instants. Their chronology key SHALL be unique against
trade and transfer events in each touched account; equal keys on disjoint accounts may commute.

#### Scenario: TRADE-002-A Precision and chronology survive restart
- **WHEN** amounts above 2^53, quantity 0.000000000000000000000000000001 and valid 48/30 boundaries are submitted in reverse chronological API order
- **THEN** exact canonical strings survive PostgreSQL/restart and FIFO uses explicit time/order, never arrival order or UUID
- **AND** equivalent offsets normalize to the same instant, duplicate-looking trades with distinct keys/order remain separate, and duplicate effective chronology returns 409
- **AND** same-symbol UUIDs and separate accounts retain independent queues

#### Scenario: TRADE-002-B Invalid values and unsupported operations fail before mutation
- **WHEN** raw numbers, arrays, malicious objects, whitespace, exponent/comma/NaN forms, excess raw scale, overflow, gross 0, invalid dates, unsafe integer order/revision, unknown currency/owner/server fields or pre-coverage executions are submitted
- **THEN** syntax/type failures return 400 and pre-coverage returns 409 without any trade, version, head, revision or request-key write
- **AND** buy gross plus fee overflow returns 400 before persistence without reserving a request key
- **AND** direct PostgreSQL NaN/infinities/null identity/value writes fail constraints

#### Scenario: TRANSFER-TRADE-ORDER Transfer chronology uses both account journals
- **GIVEN** a transfer touches two covered account histories with explicit trade/transfer event order
- **WHEN** its effective key duplicates an event in either participant account or predates either coverage
  instant
- **THEN** the movement is rejected atomically; the same key on disjoint accounts remains independent

### Requirement: TRADE-003 Exact inspectable FIFO and conserved fees
The system SHALL calculate with exact scale-30 integer atoms, without floating-point
amount arithmetic. Buy basis SHALL be gross plus buy fee; sale net SHALL be gross
minus sale fee, including negative net. Sale fees SHALL enter once. FIFO allocation
SHALL use the difference of floor(C*q/Q) at successive cumulative disposed quantities
of each original lot, giving the final disposal its remainder. Results SHALL expose
actual trade-backed buy/sell UUID AND version provenance, canonical signed strings
and known zero distinctly. Carry-in matches SHALL instead identify their immutable
lot/opening source, without a fabricated buy UUID/version.
Aggregate outputs SHALL allow up to 82 atom digits and intermediate products 156 digits,
covering the unchanged1000 active trade limit plus at most100 carry-in lots. A carry-in
origin SHALL seed original quantity/cost and prior-disposal/allocation offsets under
CARRY-002; it SHALL NOT create purchase, fee, sale or external-flow totals. Its initial
recorded basis SHALL be explicit, with remaining basis included in current inventory
and tagged lot/match provenance. Existing empty-origin outputs SHALL remain exact.

Transfer-created inventory SHALL retain the source lot original quantity, cost, half-open
interval, origin trade/version or carry-in identity, and latest arrival transfer. It becomes
available only at arrival and then participates in FIFO using its original acquisition
time/order, then origin account/kind/id and interval start. A transfer and its separately
declared fee-asset consumption SHALL NOT create synthetic buys, sells, trade fee totals,
realized trade gains or external USD flows; transfer basis in/out and removed fee basis remain
separately identified.

#### Scenario: TRADE-003-A Mandatory FIFO and fees
- **WHEN** buys of 1 for gross 100 and 1 for gross 200 precede sale of 1.5 for gross 450, all fees 0
- **THEN** matches consume first buy 1/basis 100 and second buy 0.5/basis 100, realized is 250, and remaining quantity/cost are 0.5/100
- **WHEN** the buy fees are 1 and 2 and sale fee is 3 instead
- **THEN** consumed basis is 202, net is 447, realized is 245 and remaining basis is 101
- **AND** per-lot quantities/costs and per-sale matches reconcile independently

#### Scenario: TRADE-003-B Allocation quantum, losses and wide totals
- **WHEN** a lot of 3 units/cost 1 is sold in three unit portions
- **THEN** match bases are 0.333333333333333333333333333333, 0.333333333333333333333333333333 and 0.333333333333333333333333333334
- **WHEN** a lot of 7 units/cost 0.000000000000000000000000000003 is sold in seven unit portions
- **THEN** allocated basis atoms are [0,0,1,0,1,0,1] and total original cost is conserved
- **AND** equal cumulative disposal yields equal cumulative basis regardless of split pattern
- **AND** buy gross 10/fee 2 then sale gross 1/fee 3 yields net -2 and realized -14; zero results are 0, never -0
- **AND** derived sums beyond 48 integer digits remain exact strings without input-validator truncation

#### Scenario: TRANSFER-TRADE-INTERVAL Original basis survives movement and return
- **GIVEN** a source lot of3 quantity atoms and1 cost atom whose prefix of2 atoms is moved and1 is later
  returned
- **WHEN** the returned original prefix and the retained original tail are sold in FIFO order
- **THEN** interval costs remain0 then1, every original cost atom is conserved, and no movement creates
  trade or external-flow totals
- **AND** received inventory is unavailable before its transfer arrival and keeps the original source
  identity and interval

### Requirement: TRADE-004 Atomic immutable corrections, voids and receipts
The system SHALL serialize all journal writes on the owned account row, check request
replay before CAS, and atomically append a complete version, change its head and advance
the journal revision after validating the entire candidate effective history. Correction
SHALL allow all execution fields to change. Void SHALL preserve a complete terminal
version; no restore/delete SHALL exist. Any negative historical prefix SHALL reject
the entire command even if final inventory is positive. Trade command identity SHALL
be unique owner/account/requestId across create/correct/void; canonical payload includes
kind, target, expected revision and execution. Receipts SHALL be immutable, never rewind
heads, and never claim to be current state. Limits SHALL be 1,000 active trades and
10,000 versions including voids; rejected commands consume no key or capacity.
Single-trade commands SHALL retain their existing behavior. An explicitly accepted
CSV command MAY append N consecutive version ordinals in one atomic transaction,
advancing the current journal revision by N only at commit. Its complete candidate
history SHALL be validated as a whole; source-row order MUST NOT become economic
chronology or imply separately committed intermediate FIFO snapshots. Batch command
identity SHALL remain separate from server-generated individual version keys.
The same active/version bounds SHALL apply without truncation or partial acceptance.

Trade create/correction/void SHALL replay the complete affected connected account component
through its transfer events and reject any negative historical prefix atomically. A transfer
create/correction/void SHALL replay the union of its old and new components and advance each
distinct affected journal once. Existing currentRevision remains the shared CAS/pin: a local
trade command advances its source journal once and each other affected participant once per
command, regardless of paths. CSV keeps its contiguous N source revision range; each passive
connected participant advances once. Local versionCount counts only persisted trade versions,
never passive invalidation ticks. Each participant also has a separate 10,000 journal-revision
ceiling checked before writes.

#### Scenario: TRADE-004-A Historical changes rebuild or roll back fully
- **GIVEN** the mandatory three-trade history
- **WHEN** the first buy gross changes from 100 to 120
- **THEN** realized becomes 230 and remaining cost stays 100; restoring gross 100 restores 250/100 while old versions remain readable
- **AND** valid changes of instrument, side, quantity, time and order rebuild all affected queues
- **WHEN** a consumed purchase is voided/reduced/moved after its sale, or an earlier sale exceeds holdings by one atom despite a later buy
- **THEN** 409 preserves the whole previous history and results
- **AND** voiding an unconstrained sale restores lots while preserving origin; correction/second void of a terminal void returns 409 except exact request replay

#### Scenario: TRADE-004-B Cross-process races and old replay
- **WHEN** two real processes race identical commands or different commands against one expected revision
- **THEN** identical commands commit one version and replay 200, while distinct commands have one 201 and one 409 with no overspend
- **AND** changed payload/kind/target under a used key returns 409
- **AND** old create/correct/void replay returns its original receipt before stale CAS without rewinding current state
- **AND** canonical decimal/UUID/time variants replay equivalently, while distinct accounts retain independent keys

#### Scenario: TRADE-004-C Commit failure and exact capacity
- **WHEN** a real deferred constraint fails after version/head/journal writes
- **THEN** commit returns safe generic 500, every accounting write/key rolls back, and private input/SQL does not appear in logs
- **AND** an independent nontransactional fixture probe proves the post-write path occurred; removal of the fixture allows explicit same-key retry once
- **WHEN** a command would create active trade 1001 or immutable version 10001
- **THEN** it returns 409 without partial mutation; exact boundaries 1000 and 10000 work, void history still counts and prior replay still works

#### Scenario: CSV-TRADE-001 Atomic version ranges preserve single-command semantics
- **WHEN** a source-ordered batch lists a sale before its chronologically earlier purchases
- **THEN** the complete valid candidate commits all N versions together and current reads see the final revision rather than an invalid provisional source prefix
- **AND** source links and the immutable batch receipt identify the complete accepted revision range
- **AND** every existing manual command, exact allocation, replay-before-CAS, cap, correction/void and coherent-read assertion remains passing across the internal persistence extraction

#### Scenario: TRANSFER-TRADE-RESTATEMENT Correction propagates with separate revisions
- **GIVEN** a source buy has supplied an original lot portion later transferred to a recipient and sold
- **WHEN** the source buy is corrected and connected replay remains valid
- **THEN** the recipient sale basis and realized result are recomputed from the original lot coordinates,
  source currentRevision advances once, each other affected journal advances once, and recipient
  local trade versionCount is unchanged
- **WHEN** the correction creates an invalid historical prefix or any affected journal would exceed its
  revision ceiling
- **THEN** the whole command is refused without changing versions, heads, receipts or revisions

### Requirement: TRADE-005 Coherent bounded derived reads
Every derived response SHALL identify its calculation journalRevision and obtain
revision, heads, complete effective history and labels from one coherent snapshot.
For a carry-in origin, its immutable baseline SHALL be loaded through the same snapshot
manager and seed the complete calculation before pagination. New carry-in provenance
variants SHALL not fabricate buyTradeId/buyVersion or change empty-origin field sets.
The API SHALL follow the [API and persistence
contract](../../changes/archive/2026-09-23-record-usd-fifo-trades/persistence.md) bounded
envelopes: raw persisted trade heads default50/max100 at offsets0..9999; derived lots,
realizations and per-sale matches default50/max100 at offsets0..99999; versions default10/max20
exclusive beforeVersion. Every continuation SHALL pin the connected journal revision; nonzero
offset requires that revision and stale supplied revisions return409 without partial results.
FIFO calculation MUST NOT use a truncated page. No unbounded nested matches/history SHALL be
returned.

A derived response involving transfers SHALL load the relevant connected ledger once and
calculate all participant histories inside the caller-owned coherent snapshot. Every affected
account result and continuation remains pinned to its currentRevision; an upstream trade or
transfer mutation SHALL make old affected pins stale without truncating FIFO calculation.


#### Scenario: TRADE-005-A Concurrent correction never mixes revisions
- **WHEN** a real concurrent old-buy correction overlaps bounded result reads
- **THEN** every result equals the complete old or new revision, including summary, lots and provenance, never mixed heads/costs
- **AND** continuation at an obsolete revision returns 409; the client discards accumulated pages before explicit reload
- **AND** owned labels remain available beyond the first instrument picker page and immutable version pages retain their original fields

#### Scenario: TRANSFER-TRADE-SNAPSHOT Connected read remains one coherent revision
- **GIVEN** a real reader has established its read-only snapshot for a connected source and recipient while
  another connection corrects an upstream trade and commits
- **WHEN** the reader finishes loading transfers, trade heads, labels and lot provenance
- **THEN** it returns the complete old connected state; a later request returns the complete new state, and
  an old affected continuation is rejected as stale
- **AND** a sale consuming10001 original fragments can read its final match at pinned offset10000 with
  limit1; offset99999 is accepted and empty, while a raw-head offset beyond9999 is rejected
