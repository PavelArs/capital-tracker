## MODIFIED Requirements

### Requirement: CARRY-002 Exact original-lot reconciliation and allocation
Carry-in SHALL preserve original Q/C and remaining R. Prior disposal SHALL be Q-R;
prior allocated cost SHALL be floor(C*(Q-R)/Q), using exact scale30 integer atoms.
Remaining basis SHALL be C minus that allocated cost. Per owned instrument, sums of
R and remaining basis SHALL exactly equal the referenced opening position, with no
missing/extra instrument, inferred cost, pro-rata repair or one-atom tolerance.

The FIFO queue SHALL start with those cumulative offsets. Subsequent disposal SHALL
use the existing cumulative-floor difference and final-remainder rule. Previously
disposed quantities/costs SHALL NOT be presented as newly recorded historical sales
or profit. Raw values SHALL retain numeric(78,30) strict string boundaries; derived
sums SHALL support82 atom digits and allocation products156. All old empty-origin
arithmetic and1000-active/10000-version journal limits SHALL remain.

When a carried lot is transferred, its original Q/C and interval coordinates SHALL continue
unchanged through every split and return; the recipient fragment does not become a newly rebased
carry-in or trade lot. Its availability begins only at arrival, after which FIFO uses original
acquisition chronology and the existing carry-in allocation phase.

#### Scenario: CARRY-002-A Partial original lots preserve allocation phase
- **GIVEN** original quantity4, original basis0.000000000000000000000000000002 and remaining quantity3, matching a known opening
- **WHEN** three subsequent unit sales consume the carried lot
- **THEN** allocated basis atoms are exactly[1,0,1], total2, and final quantity/cost are0
- **AND** replaying the accepted request with rebased original quantity3/cost2 atoms conflicts because it changes the original evidence
- **AND** before acceptance arithmetic reconciliation alone does not establish which owner-supplied historical claim is factually correct
- **AND** explicit zero basis allocates zero without being treated as unknown, and same-symbol instrument UUIDs remain distinct queues

#### Scenario: CARRY-002-B Reconciliation refuses missing or contradictory evidence
- **WHEN** quantity or computed remaining cost differs from the opening by one atom, an instrument is missing/extra/foreign, chronology duplicates, or remaining quantity exceeds original
- **THEN** documented400/404/409 or bounded preview errors preserve all tables and never distribute a difference across other lots
- **AND** exact48/30 raw bounds, partial quantities and100-lot boundaries are independently exercised without floating-point amount arithmetic

#### Scenario: TRANSFER-CARRY-INTERVAL Carried allocation phase survives movement
- **GIVEN** an original carry-in lot4 units/cost2 atoms with1 unit already disposed, of which1 remaining
  unit is moved and later returned
- **WHEN** subsequent unit sales consume the returned and retained original portions
- **THEN** the allocation phase remains[1,0,1] where applicable, carried basis is neither rebased nor
  double counted, and the immutable opening and origin stay unchanged

### Requirement: CARRY-003 Atomic immutable initialization and replay
Carry-in, opening replacement, empty initialization and later journal writers SHALL
serialize on the same owned account lock. Canonical accepted origin replay SHALL
precede mutable opening/state checks and return the original receipt without rewinding
anything. Equivalent decimal/UUID/time representations and lot-array order SHALL
canonicalize deterministically; changed accepted payload or kind SHALL conflict.

A new origin and its complete immutable lot set SHALL commit together at journal
revision0. Failed validation or COMMIT SHALL reserve no request key or partial lot.
Original lots and the referenced opening SHALL remain immutable in this slice; there
SHALL be no baseline reset/amend/delete endpoint or inferred correction. New opening
writes SHALL stay blocked after initialization, while old opening receipts remain
replayable under their existing identity rules. Normal trade correction/void and CSV
rollback SHALL continue to validate the complete supported seeded history.

Carry-in initialization and other existing opening/journal writers SHALL acquire the
owner-scoped advisory lock before any account-row lock. Connected writer paths SHALL lock
affected account rows in sorted UUID order, then read committed history and validate the
complete connected component; no global manager escape or partial origin write is permitted.
Accepted carry-in and opening receipt behavior remains unchanged.

#### Scenario: CARRY-003-A Real races and old requests retain one baseline
- **WHEN** real independent processes race the same carry-in command or carry-in against opening replacement at one expected opening revision
- **THEN** identical commands commit once and replay200; conflicting changes produce one consistent winner and a409 without losing-key reservation
- **AND** old accepted origin/opening receipts replay after later trades and CSV rollback without rewriting baseline, journal or opening pointers

#### Scenario: CARRY-003-B A deferred COMMIT failure is fully recoverable
- **WHEN** a real deferred constraint fails after every origin/lot/reference write
- **THEN** an independent nontransactional stage witness proves the complete path, HTTP returns private generic500, all transactional rows remain unchanged and no key is reserved
- **AND** removing only the isolated failure fixture permits explicit original-key retry once, followed by immutable200 replay

#### Scenario: TRANSFER-CARRY-LOCK Carry-in and connected writer use one lock order
- **GIVEN** a real carry-in/opening writer and a competing connected transfer writer target accounts owned
  by the same owner
- **WHEN** each writer follows the shared owner-lock then sorted account-row lock order
- **THEN** they serialize without deadlock or mixed baseline/history, and a rejected contender reserves no
  key or changes any account

### Requirement: CARRY-004 One coherent baseline across journal and CSV
Manual and CSV calculations SHALL load the same immutable baseline through their
caller's EntityManager inside the existing transaction/snapshot. Preview, current
results, rollback review and baseline reads SHALL retain coherent read-only REPEATABLE
READ semantics. No calculation SHALL use a global manager escape, truncated page or
separately timed baseline. CSV original identity, exact settings, atomic ranges,
rollback eligibility and replay-before-live-state rules SHALL remain unchanged.

Baseline inventory SHALL not be converted into trade heads or counted against trade
version ordinals. Initial basis SHALL be explicit and separate from covered purchase
totals; remaining cost SHALL include unconsumed baseline. Carry-in lots/matches SHALL
have a tagged immutable lot/opening provenance variant, never a fake buyTradeId/version.
For accounts without transfer history, all old empty-origin response shapes SHALL
remain exact. All immutable receipts SHALL remain exact. New projections
SHALL retain bounded pages and documented current-journal revision pins.

Manual and CSV calculations SHALL load transfer history and connected participant heads through
the same caller EntityManager and snapshot as the immutable baseline. Transfers SHALL move
carried positions between accounts without changing the baseline, creating covered buy/sale
totals, or introducing an external flow.

#### Scenario: CARRY-004-A Manual and imported sales consume identical lots
- **GIVEN** the reviewed100/200 carry-in baseline
- **WHEN** equivalent manual and CSV sale1.5/gross450 are separately previewed/accepted against equivalent accounts
- **THEN** both produce250 realized and100 remaining cost, with correct tagged lot matches and no baseline purchase totals
- **AND** CSV preview writes nothing; its conditional rollback restores baseline quantity/cost while retaining original bytes, create/void evidence and accepted receipts
- **AND** correcting a covered transaction recomputes the same baseline, and concurrent read barriers never mix old/new journal results

#### Scenario: TRANSFER-CARRY-SNAPSHOT Baseline and received lots share one snapshot
- **GIVEN** a covered carry-in source lot has been moved to a recipient and a manual or CSV sale consumes it
- **WHEN** the read calculates the connected account histories
- **THEN** source and recipient results use the same immutable carry-in interval and connected revision,
  with no mixed snapshot, fabricated buy or changed opening evidence
