# usd-fifo-trades Specification

## MODIFIED Requirements

### Requirement: TRADE-002 Exact bounded USD execution inputs
Swap events SHALL share the account chronology namespace with trades, transfers, and rewards. Each swap SHALL atomically debit outgoing principal, consume any held fee after that debit and before crediting the incoming asset, and credit gross incoming quantity less any incoming-asset fee. Its effective key SHALL be unique account-wide and at or after coverage. A same-account swap SHALL use distinct outgoing and incoming instrument UUIDs.

Every execution SHALL identify a manual owned instrument UUID, buy/sell side, explicit
UTC-normalized millisecond instant, explicit same-instant integer order, positive
quantity/gross USD and nonnegative USD fee. Amounts SHALL retain numeric(78,30) raw
string boundaries and explicit SQL finite checks. All declared raw types and unknown
fields SHALL be validated before coercion. Effective chronology SHALL be unique per
account and at/after coverage. Same symbols MUST NOT merge identities or account lots.

Transfer events SHALL have an explicit effective UTC-millisecond instant and same-instant order
at or after both participant coverage instants. Their chronology key SHALL be unique against
trade and transfer events in each touched account; equal keys on disjoint accounts may commute.

Reward events SHALL occupy the same account chronology namespace as trades/transfers and obey coverage, raw type and precision rules.

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

#### Scenario: REWARD-TRADE-ORDER
- **WHEN** a reward overlaps a trade/transfer time/order or predates coverage
- **THEN** the entire command is409 without persistence; distinct account keys remain independent

#### Scenario: SWAP-TRADE-CHRONO
- **GIVEN** a covered account has a trade at a specific instant and order
- **WHEN** a swap is recorded at that same chronology key, or before coverage
- **THEN** the whole swap is rejected without persistence; a unique key at or after coverage records both legs as one event

### Requirement: TRADE-003 Exact inspectable FIFO and conserved fees
A swap SHALL preserve principal and fee FIFO intervals and original lot coordinates. Its declared considerationUsd is the same total for outgoing proceeds and gross incoming original basis; null remains unknown independently of outgoing basis, and explicit zero is known zero. Incoming-asset fees consume only the new swap lot prefix; held fees consume existing inventory after principal. Swap realized results and source summaries SHALL remain separate from actual USD trade totals, and swaps SHALL NOT create USD cash flow or synthetic trade rows.

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

A reward SHALL be an explicit acquisition origin, never a synthetic buy. Original cost may be unknown; affected cost/realized fields SHALL be null with basisCoverage as defined in record-asset-rewards/persistence.md. Quantity and exact known basis intervals remain conserved; known realized subtotal includes only fully costed sales. Connected sums SHALL retain at least83atom digits rather than reuse raw input bounds.

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

#### Scenario: REWARD-TRADE-BASIS
- **WHEN** a sale consumes a known buy and an unknown-basis reward
- **THEN** consumedCostUsd and realizedUsd are null with known cost subtotal and missing count; all old all-known oracles remain exact

#### Scenario: SWAP-TRADE-FIFO
- **GIVEN** outgoing inventory has known basis100, consideration is120, incoming gross quantity is2 and there is no fee
- **WHEN** the owner records the already-executed swap
- **THEN** the outgoing disposal result is20 and the incoming lot has original basis120
- **WHEN** consideration is unknown instead
- **THEN** the incoming basis remains unknown; neither unknown nor an explicit known0 is substituted for the other

### Requirement: TRADE-004 Atomic immutable corrections, voids and receipts
Trade, transfer, reward, CSV confirm, and CSV rollback candidates SHALL replay all active swaps across the affected connected component. Swap create/correct/void SHALL validate complete old and candidate connected histories and advance each affected journal pin once; local trade version counts and trade totals SHALL exclude swap versions/results. Exact command replay SHALL return the immutable original receipt before live pin/capacity checks.

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

Reward create/correct/void SHALL participate in the same connected replay/invalidation and revision ceilings. Trade and CSV mutations SHALL include current rewards when validating history; actual trade version counts exclude reward versions.

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

#### Scenario: REWARD-TRADE-RESTATEMENT
- **WHEN** a reward correction changes a source cost underlying a recipient sale
- **THEN** the recipient result restates, both pins advance and old receipts remain immutable

#### Scenario: SWAP-TRADE-REPLAY
- **GIVEN** a swap consumes an original lot and a later sale consumes the received swap lot
- **WHEN** the source trade is corrected and the candidate connected history remains valid
- **THEN** swap allocation and dependent sale results restate atomically, all affected pins advance once, and the old swap receipt remains unchanged
- **AND** a candidate with a negative historical prefix is rejected without changing any participant

### Requirement: TRADE-005 Coherent bounded derived reads
Every connected snapshot SHALL load effective swaps once and include their complete FIFO effects and swap-specific evidence before bounded pagination. Pinned continuations SHALL be invalidated by any connected mutation, including swap changes; the FIFO calculation SHALL never use truncated pages.

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

Reward-origin lots/matches SHALL retain reward identity/version/category and original coordinates, whether local or transferred. Nullable costs SHALL carry explicit completeness in full totals and never be omitted as zero; current-effective rewards load in the same connected snapshot.

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

#### Scenario: REWARD-TRADE-PAGES
- **WHEN** a paged sale allocation contains an unknown-cost reward fragment
- **THEN** its cost is null with provenance and full untruncated summary; upstream reward correction invalidates continuation

#### Scenario: SWAP-TRADE-SNAPSHOT
- **GIVEN** a connected read has established a PostgreSQL snapshot before a swap correction commits on another connection
- **WHEN** the read loads effective heads and derived positions
- **THEN** it returns the complete pre-correction swap state, while a later read returns the complete corrected state and an old continuation is rejected as stale

### Requirement: TRADE-006 Protected honest Russian journal journey
The system SHALL expose a Russian journal section in protected manual account detail,
explicit empty-origin attestation, gross/fee/time/order entry, full correction/void,
current results and bounded provenance. It SHALL label realized journal results and
remaining recorded cost, not portfolio return, fiat cash, market value or tax compliance.
Existing opening accounts SHALL remain intact. Eligible known-cost accounts SHALL
offer the explicit reviewed carry-in journey; unsupported unknown/mismatched cost SHALL
remain visible. A referenced opening SHALL be displayed as historical baseline evidence,
not another current holding added to seeded journal inventory. Baseline immutability
in this slice SHALL be disclosed before acceptance.
Private routes SHALL retain full MFA, session/CSRF, existing quotas and owner isolation.
No provider, legacy observation or external-flow mutation SHALL occur.

The Russian journal SHALL render unknown cost/profit as unknown with the known subtotal explicitly labelled partial, and reward origin as reward rather than a fabricated buy. Swap-origin lots and matches SHALL be rendered as swaps with their swap identity/version and original provenance, not as fabricated USD buys or sales.

#### Scenario: TRADE-006-A Real UI, replay receipt and stale draft
- **GIVEN** actual password/MFA login through the release application
- **WHEN** the owner initializes an eligible account and enters the mandatory three trades through forms
- **THEN** exact 250/100/0.5 results and lot provenance survive both backend restarts and reload
- **AND** correcting the older buy shows 230/100 with its old version retained
- **AND** successful or replayed receipts trigger a current-state read, not replacement by an old result
- **AND** stale 409 preserves the draft with Russian feedback and explicit review before resubmission; writes disable edits and stale route responses cannot change another account

#### Scenario: TRADE-006-C Refresh cannot silently rebase a selected mutation
- **GIVEN** a correction draft or void confirmation refers to version 1 and another request corrects that trade to version 2
- **WHEN** the owner refreshes the journal without submitting the draft
- **THEN** the draft remains unchanged and the refreshed complete target is displayed for explicit review before a new command can use the newer journal revision
- **AND** a target now terminally void cannot silently turn the selected mutation into a create

#### Scenario: TRADE-006-D Read conflicts cannot discard an unresolved command
- **GIVEN** a real correction commits but its response is lost before browser delivery
- **WHEN** a stale revision-pinned read returns 409 and the owner refreshes and reviews the journal
- **THEN** unchanged explicit retry still sends the complete original command, including its original request key, target and expected revision
- **AND** the API returns the original receipt with 200, no duplicate version is created and a fresh current-state read supplies the displayed results
- **AND** a replay refused by authentication, CSRF or admission does not establish the original outcome; the unresolved command, draft and target remain protected for a later exact replay
- **AND** an ambiguous initialization keeps the opening editor blocked until current journal state is known

#### Scenario: TRADE-006-B Retained security and privacy
- **WHEN** anonymous/pending clients, invalid Origin/CSRF, foreign IDs, mass assignment or literal malicious labels exercise new routes
- **THEN** statuses remain 401/403/generic 404/400 as appropriate, labels render as text and unauthorized requests cannot mutate accounting data
- **AND** invalid Origin/CSRF does not touch sessions; valid private authorization may touch only its documented lastSeenAt outside the accounting transaction
- **AND** local errors preserve 401 redirect/403 handling, no private values enter logs, and legacy/auth/factor/admission rows and provider request counts retain their existing oracles

#### Scenario: REWARD-TRADE-UI
- **WHEN** a current result contains both known0 and unknown-basis reward lots
- **THEN** the owner sees distinct0/unknown labels and exact reward/transfer provenance

#### Scenario: SWAP-TRADE-UI
- **GIVEN** a real owner reviews a connected result containing a swap-origin lot or allocation
- **WHEN** the protected Russian journal displays it
- **THEN** the swap remains visibly distinct from USD trades, unknown consideration differs from known zero, and original swap/instrument identities remain inspectable
- **AND** the existing USD trade draft remains unchanged
