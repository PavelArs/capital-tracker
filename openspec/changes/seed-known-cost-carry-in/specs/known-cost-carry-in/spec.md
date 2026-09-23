## ADDED Requirements

### Requirement: CARRY-001 Explicit known-cost opening origin
The system SHALL allow a separately reviewed carry-in journal origin only for an owned
manual account with a current opening snapshot, no existing journal, and exclusively
known opening costs. The command SHALL pin expectedOpeningRevision and use that
snapshot's asOf as coverageFrom. It SHALL require literal owner attestation of original
lot evidence and current immutable-baseline review. No opening or absence of trades
SHALL automatically imply an acquisition history. The API/schema SHALL follow the
reviewed persistence.md contract. Existing declared-empty initialization SHALL retain
all old exclusions, projections and receipt semantics.

The baseline SHALL mean inventory immediately before all covered executions, including
those at the coverage instant. Each of1..100 lots SHALL supply an owned instrument,
original acquisition instant/order, original positive quantity, original nonnegative
USD basis including acquisition fees, and positive remaining quantity no greater than
original quantity. Acquisition MUST NOT be after coverage. Chronology SHALL be explicit
and unique across the account's baseline, without ordering by generated UUIDs.

#### Scenario: CARRY-001-A Explicit opening lots unlock a real covered sale
- **GIVEN** an owned opening of2 TOKEN units with known total cost300 at the coverage boundary
- **WHEN** the owner previews and explicitly confirms original lots1/cost100 then1/cost200 through actual password/MFA HTTPS forms
- **THEN** a carry-in journal starts at revision0 with initial cost300 and quantity2, no buy/sell version, no purchase/fee/flow total and no realized profit
- **AND** a later real sale1.5/gross450/fee0 yields realized250, remaining quantity0.5/cost100, with explicit carry-in provenance surviving backend restart
- **AND** the retained opening is historical baseline evidence, not a second holding added to the current journal

#### Scenario: CARRY-001-B Unsupported or unreviewed origins remain intact
- **WHEN** initialization has absent/stale opening, unknown cost, missing/false/coerced review assertion, unsupported raw fields, existing origin or acquisition after coverage
- **THEN** documented400/409 refusals create no origin, lot, trade, key or pointer mutation and preserve every prior opening
- **AND** known zero remains distinct from unknown cost, and a voided or exhausted journal cannot be reset or initialized again

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

#### Scenario: CARRY-003-A Real races and old requests retain one baseline
- **WHEN** real independent processes race the same carry-in command or carry-in against opening replacement at one expected opening revision
- **THEN** identical commands commit once and replay200; conflicting changes produce one consistent winner and a409 without losing-key reservation
- **AND** old accepted origin/opening receipts replay after later trades and CSV rollback without rewriting baseline, journal or opening pointers

#### Scenario: CARRY-003-B A deferred COMMIT failure is fully recoverable
- **WHEN** a real deferred constraint fails after every origin/lot/reference write
- **THEN** an independent nontransactional stage witness proves the complete path, HTTP returns private generic500, all transactional rows remain unchanged and no key is reserved
- **AND** removing only the isolated failure fixture permits explicit original-key retry once, followed by immutable200 replay

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
All old empty-origin response shapes and receipts SHALL remain exact. New projections
SHALL retain bounded pages and documented current-journal revision pins.

#### Scenario: CARRY-004-A Manual and imported sales consume identical lots
- **GIVEN** the reviewed100/200 carry-in baseline
- **WHEN** equivalent manual and CSV sale1.5/gross450 are separately previewed/accepted against equivalent accounts
- **THEN** both produce250 realized and100 remaining cost, with correct tagged lot matches and no baseline purchase totals
- **AND** CSV preview writes nothing; its conditional rollback restores baseline quantity/cost while retaining original bytes, create/void evidence and accepted receipts
- **AND** correcting a covered transaction recomputes the same baseline, and concurrent read barriers never mix old/new journal results

### Requirement: CARRY-005 Protected Russian review preserves original intent
The protected account UI SHALL distinguish opening evidence, carry-in initialization
and current holdings. It SHALL show exact original/remaining lot values, reconciliation
errors, current opening revision/coverage and a prominent immutable-baseline limitation
before confirmation. Unknown cost SHALL remain visibly unsupported, never zero.
Only a current successful preview plus explicit owner action SHALL permit initialization.

Input/account changes SHALL invalidate preview and late responses SHALL not restore
obsolete consent. An uncertain initialization SHALL retain its full original operation,
key and expected opening revision across in-app refresh/SPA navigation and denied retry,
with edits locked and no automatic resubmission. A known receipt followed by a failed
current read SHALL remain visible and block new writes until successful refresh.
The UI SHALL disclose that full document reload/tab closure discards local recovery.

#### Scenario: CARRY-005-A Review, loss and conflict do not silently change the origin
- **WHEN** the owner edits a preview, opening state changes concurrently, or an actual accepted response is lost before delivery and a real retry is denied
- **THEN** obsolete previews cannot initialize, drafts remain explicit, and original-key retry after real authentication/CSRF recovery returns its original receipt without another baseline
- **AND** current data comes from fresh reads, and full reload is not misrepresented as persistent recovery of an unknown key

### Requirement: CARRY-006 Private bounded extension preserves existing data
All carry-in routes SHALL require actual full owner authentication and existing
Origin/CSRF/source/quota controls; foreign identities SHALL use generic404. Strict
raw inputs and the existing100KiB JSON envelope SHALL bound allocation. Private lots,
amounts, SQL and parser details SHALL not enter failure bodies/logs; labels SHALL be
literal text. No provider, external-flow, legacy observation or owner data mutation
SHALL occur as a side effect.

Migration16 SHALL add only reviewed baseline mappings/constraints and preserve all
prior populated schema/rows, CSV originals/settings/commands/provenance, immutable
journal history and authentication/admission state. Old opening and empty-origin
characterizations SHALL remain passing. No destructive down/reset or production
rollout SHALL be performed to verify this change.

#### Scenario: CARRY-006-A Real privacy and populated upgrade remain intact
- **WHEN** anonymous/pending clients, invalid Origin/CSRF, foreign account/lot/instrument references or mass assignment exercise each new route family
- **THEN** documented401/403/404/400 refusals expose no private baseline and preserve accounting plus the documented authentication bookkeeping boundaries
- **AND** actual fresh16/replay, populated15-to16 and every prior upgrade/refusal pass in isolated release images with unchanged old financial/security assertions
- **AND** SQL finite/composite/RESTRICT constraints, private canaries, workload boundaries and zero accounting provider requests have independent evidence

#### Scenario: CARRY-006-B JSON transport bounds return a private client refusal
- **GIVEN** a valid reviewed lot preview padded with JSON whitespace to exactly102400 UTF-8 bytes
- **WHEN** the authenticated owner submits that preview through the real HTTPS application
- **THEN** it returns200 without persisting accounting data
- **WHEN** an initialization body exceeds102400 bytes by one
- **THEN** the actual parser refusal returns413 with a fixed public message, never500 or submitted body/parser detail
- **AND** every accounting row is unchanged and the original request key remains available for explicit bounded retry
- **AND** unrelated errors containing status-like fields still receive the existing generic500 response
