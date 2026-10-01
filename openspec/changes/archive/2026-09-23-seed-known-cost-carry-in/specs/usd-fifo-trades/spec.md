## MODIFIED Requirements

### Requirement: TRADE-001 Explicit eligible empty-origin journal
Declared-empty initialization SHALL require an owner-attested empty origin before accepting trades,
using the routes/projections in the [API and persistence contract](../../changes/archive/2026-09-23-record-usd-fifo-trades/persistence.md). Initialization SHALL require literal
boolean assertEmpty true, an explicit valid coverageFrom, a NULL opening pointer and
NO opening snapshot history. Absence of an opening alone MUST NOT imply empty holdings.
Known, unknown and known-zero aggregate opening cost MUST NOT become synthetic lots.
Initialization/opening writers SHALL lock the same owned account row before eligibility
checks. The origin SHALL survive all later corrections and voids. A separately attested
known-cost carry-in origin SHALL be available under CARRY-001..006, pinned to a current
opening and explicitly supplied original lots. It SHALL NOT change this empty-origin
endpoint's exclusions or synthesize lots from an aggregate opening.

#### Scenario: TRADE-001-A Explicit initialization and immutable retry
- **GIVEN** a manual account without opening history and a real full-owner session
- **WHEN** the owner explicitly attests empty positions at a valid coverage instant
- **THEN** one journal starts at revision 0, no trade/opening is fabricated, and 201 returns its immutable origin
- **AND** equivalent UUID/time replay returns the original origin 200 while changed payload or another initialization key returns 409 without mutation
- **AND** missing, false, string, numeric or object assertions return 400

#### Scenario: TRADE-001-B Opening exclusion and real race
- **WHEN** declared-empty initialization targets known-positive, known-zero, unknown-cost or NULL-pointer-with-retained-history accounts
- **THEN** it returns 409 and preserves all existing rows
- **WHEN** two real processes race declared-empty initialization against the first opening on an eligible account
- **THEN** exactly one returns 201, the other 409, and no committed state contains both histories
- **AND** voiding every trade never re-enables opening writes

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

### Requirement: TRADE-005 Coherent bounded derived reads
Every derived response SHALL identify its calculation journalRevision and obtain
revision, heads, complete effective history and labels from one coherent snapshot.
For a carry-in origin, its immutable baseline SHALL be loaded through the same snapshot
manager and seed the complete calculation before pagination. New carry-in provenance
variants SHALL not fabricate buyTradeId/buyVersion or change empty-origin field sets.
The API SHALL follow the [API and persistence contract](../../changes/archive/2026-09-23-record-usd-fifo-trades/persistence.md) bounded envelopes: current trades/lots/realizations/
per-sale matches default 50 / max 100 with revision-pinned offset continuation; versions
default 10 / max 20 exclusive beforeVersion. Nonzero offset SHALL require a revision;
stale supplied revision SHALL return 409 without partial results. FIFO calculation
MUST NOT use a truncated page. No unbounded nested matches/history SHALL be returned.

#### Scenario: TRADE-005-A Concurrent correction never mixes revisions
- **WHEN** a real concurrent old-buy correction overlaps bounded result reads
- **THEN** every result equals the complete old or new revision, including summary, lots and provenance, never mixed heads/costs
- **AND** continuation at an obsolete revision returns 409; the client discards accumulated pages before explicit reload
- **AND** owned labels remain available beyond the first instrument picker page and immutable version pages retain their original fields

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
