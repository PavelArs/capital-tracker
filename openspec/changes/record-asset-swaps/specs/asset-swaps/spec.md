## ADDED Requirements

### Requirement: SWAP-001 Exact atomic exchange with explicit evidence
The application SHALL record an owner-attested already-executed exchange between two
different owned instrument UUIDs in one eligible manual account. Outgoing principal and
gross incoming quantities SHALL be positive exact numeric(78,30) strings. Declared total
USD consideration SHALL be an explicit nonnegative exact string or null;0 and unknown
remain distinct. One operation SHALL NOT invent cash trades, rewards, external flows,
market prices or tax treatment. Inputs SHALL use strict UUIDv4, explicit timezone/Gregorian
millisecond precision, order0..2147483647 and allowlisted complete fields without coercion.

#### Scenario: SWAP-001-A Crypto to stablecoin is an internal exchange
- **GIVEN** A buys1TOKEN for100USD and1TOKEN for200USD on successive dates
- **WHEN** A exchanges1.5TOKEN for450STABLE with consideration450USD and zero fee
- **THEN** A retains0.5TOKEN/basis100 and450STABLE/basis450 and swap realized250
- **AND** actual USD trade buys remain300, sale totals remain0 and external flows remain unchanged
- **AND** stablecoin quantity does not by itself establish a1USD price

#### Scenario: SWAP-001-B Unknown consideration and known zero are distinct
- **GIVEN** A has1TOKEN/basis100
- **WHEN** A exchanges1TOKEN for3OTHER with consideration null
- **THEN** OTHER quantity is3, its basis and swap realized are null, while consumed principal basis is100
- **WHEN** the same operation is corrected to explicit consideration0
- **THEN** incoming basis is known0 and swap realized is-100; old receipt remains unchanged

#### Scenario: SWAP-001-C Invalid complete fields cannot reserve a key
- **WHEN** input omits consideration, uses the same UUID on both legs, a raw number amount,
  impossible date, unknown field, invalid fee coupling, excess precision or nonexistent owned instrument
- **THEN** it returns400 for invalid fields or generic404 for a valid missing/foreign resource,
  with no identity/version/key/pin change

### Requirement: SWAP-002 Explicit fee origin conserves exact FIFO basis
Swap processing SHALL debit outgoing principal first. A positive `held` fee SHALL consume
available FIFO inventory before acquisition. A positive `incoming` fee SHALL use the
incoming instrument and consume only the prefix of the new original lot, up to its gross
quantity, leaving older holdings untouched. Zero fee SHALL require null source/instrument.
Incoming original basis SHALL equal consideration, including unknown. Dedicated swap
realized SHALL equal consideration minus principal consumed basis minus fee consumed basis;
any required unknown makes that result null. Consumed fee basis SHALL NOT be treated as
market fee value, capitalized again or included in trade/transfer fee totals.

#### Scenario: SWAP-002-A Withheld fee does not consume older target lots
- **GIVEN** A holds1OTHER/basis1 and1TOKEN/basis100
- **WHEN** A exchanges1TOKEN for gross3OTHER at consideration150 with incoming fee0.1OTHER
- **THEN** old1OTHER/basis1 remains unchanged and the new lot retains original3/basis150,
  interval[0.1,3], remaining2.9/basis145
- **AND** fee basis is5 and swap realized45; no extra cost or gain is recorded
- **WHEN** the same fee is explicitly held instead
- **THEN** old OTHER remaining is0.9/basis0.9, new OTHER3/basis150, fee basis0.1 and swap realized49.9

#### Scenario: SWAP-002-B Principal precedes held fee and all prefixes must fund it
- **GIVEN** A holds1TOKEN/basis100 then1TOKEN/basis200
- **WHEN** A exchanges1.5TOKEN for450OTHER at450USD with held fee0.1TOKEN
- **THEN** principal basis is200, fee basis20, swap realized230, remaining TOKEN0.4/basis80 and OTHER450/basis450
- **WHEN** any fee/principal prefix lacks inventory or an incoming fee exceeds gross receipt
- **THEN** the complete command is refused without either leg, version or pin persisting

#### Scenario: SWAP-002-C Unknown outgoing costs do not poison known incoming evidence
- **GIVEN** an unknown-basis reward provides1TOKEN
- **WHEN** A exchanges it for3OTHER at declared150USD with zero fee
- **THEN** principal basis and realized are null, fee basis is known0, incoming basis is known150
- **AND** known realized subtotal excludes the incomplete operation's150USD proceeds

#### Scenario: SWAP-002-D Fractional and full incoming fee conserve original coordinates
- **GIVEN** a gross3-unit incoming lot has declared basis0.000000000000000000000000000001
- **WHEN** incoming fee1unit precedes partial sale/owned transfer of remaining intervals
- **THEN** fee/remaining/later consumed bases allocate from the original coordinates and sum exactly to the declared basis
- **WHEN** incoming fee equals the gross quantity
- **THEN** no new lot remains and its full original basis is consumed once as fee

### Requirement: SWAP-003 Immutable connected lifecycle and replay
Create/full correction/terminal void SHALL store complete immutable versions and original
receipts. Exact replay SHALL return200 with the original receipt before live CAS/cap checks;
a new successful command returns201. Conflicting request reuse, stale version/pin, chronology
collision or invalid downstream history SHALL return409 atomically. Account identity SHALL
not change; correction can replace both instruments, quantities, time/order, consideration
and fee fields. Owner lock precedes sorted connected account locks; old/candidate histories
and every participant revision budget SHALL validate. Each affected pin advances once;
actual trade version counts stay unchanged. Deferred commit failure SHALL release all writes
and permit subsequent valid reuse of the uncommitted key.

#### Scenario: SWAP-003-A Correction restates descendants without changing receipts
- **GIVEN** a swap acquires3OTHER/basis150, transfers2 to B, and B sells1 for80USD
- **WHEN** valid correction changes consideration to180
- **THEN** B sale basis changes50 to60 and realized30 to20; both journal pins advance once
- **AND** original swap/transfer/sale receipts remain unchanged
- **WHEN** a void would strand the dependent transfer or sale
- **THEN** the void returns409 with all heads, pins and versions unchanged

#### Scenario: SWAP-003-B Replay and concurrent commands are deterministic
- **WHEN** two real processes submit identical commands through the owner lock
- **THEN** exactly one version persists and both receive the same receipt
- **WHEN** different commands race using the same journal pin or request key
- **THEN** one commits and the conflicting command returns409 without partial state
- **AND** an exact saved replay still succeeds after later corrections, terminal void or capacity exhaustion

#### Scenario: SWAP-003-C Cross-operation collisions and rollback are atomic
- **WHEN** a candidate swap collides with a trade/reward/transfer chronology key or a
  deferred SQL constraint fails at COMMIT after provisional head/version/pin updates
- **THEN** no candidate state persists; existing rows/receipts and private CSV bytes remain unchanged
- **AND** safe subsequent use of an uncommitted request key succeeds

### Requirement: SWAP-004 Coherent bounded connected projections
Connected replay SHALL include swaps exactly once, preserve original swap identity/version/
interval through sales and owned transfers, and expose independent consideration/principal/
fee/realized completeness. A source `swapSummary` SHALL aggregate only effective prefix
operations; a retained void identity yields an empty summary, and recipients SHALL NOT
duplicate source results. Existing summary fields remain actual USD trade results. Known
subtotals and unknown counts SHALL be explicit; no mixed incomplete result contributes
partial proceeds to known realized subtotal. Reads SHALL be private read-only repeatable-read
snapshots and materialize connected swaps once per chart/selected portfolio request.
Limits SHALL bound owner/account/component active swaps at1000 and owner/account versions
at10000, retaining other documented replay and revision bounds. Complete totals precede
paging and all relevant counts precede row loads; excess is refused, never truncated.

#### Scenario: SWAP-004-A Atomic historical prefixes and transfer provenance
- **WHEN** an as-of query is before the exchange then exactly at it
- **THEN** before has neither leg/fee; at includes both and fee together with exact positions
- **WHEN** incoming lot portions move through B and return
- **THEN** original swap identity/version/coordinates persist and only latest arrival changes
- **AND** source result appears once; unchanged predecessor histories retain their original DTO shape

#### Scenario: SWAP-004-B Bounds and once-only coherent reads
- **WHEN** the1000th active swap is valid then the1001st is attempted, or a new version
  would exceed an owner/account10000version or passive participant10000revision budget
- **THEN** the valid boundary commits and the excess refuses atomically; original replay still works
- **WHEN** a writer commits while another connection reads a chart or selected portfolio
- **THEN** the reader sees one coherent snapshot, counts/loads each connected swap history once,
  preserves full totals across pages, and makes zero external provider requests

### Requirement: SWAP-005 Protected Russian review preserves intent
The manual-account journal SHALL offer a distinct Russian swap editor with exact values,
two instrument UUIDs, explicit fee source, known/unknown consideration and attestation of
an already-executed exchange. Review SHALL display the complete normalized intended command,
current journal pin and target version; it SHALL not claim to be a computed quote. Changed
inputs, account/pin refresh and late responses SHALL invalidate stale review. Ambiguous
delivery SHALL preserve a frozen original command/key/pins across SPA remount and offer only
explicit identical retry. Correction and terminal void require renewed review. The separate
trade draft SHALL survive swap refresh. UI SHALL label trade-only versus swap results, original
versus current evidence, missing values and consumed historical fee basis honestly.

#### Scenario: SWAP-005-A Real owner records reviews retries and revises
- **GIVEN** actual password/MFA authentication and funded manual account
- **WHEN** the owner reviews and records an exchange, loses the actual committed response,
  navigates away/back and explicitly retries
- **THEN** the frozen same request returns the original receipt with no extra operation
- **WHEN** the owner reviews a correction/void while a real older response is delayed and
  another operation advances the current pin
- **THEN** the late response cannot restore stale review, and input/trade drafts survive

### Requirement: SWAP-006 Additive persistence and private boundaries
All swap routes SHALL require existing full owner sessions, Origin/CSRF for mutations,
private no-store and generic foreign-resource denial. Strict storage constraints SHALL
couple owner/account/instruments and identities/versions, retain exact numeric/null evidence
and prevent invalid heads. Fresh and populated schema21 upgrades SHALL add swap tables
without altering prior owner/auth/financial/import rows or receipts. No production/reset
endpoint, disclosure, provider call, spending action or destructive down migration is allowed.

#### Scenario: SWAP-006-A Protected real HTTP and SQL boundaries
- **WHEN** anonymous/password-only/missing-CSRF clients call swap routes, or a full owner
  requests a missing/foreign swap/account/instrument
- **THEN** access is denied with existing generic no-store security envelopes and no private data/write
- **WHEN** direct SQL attempts cross-owner references, invalid fee coupling, numeric values
  or a missing current head
- **THEN** the transaction fails without changing valid stored state

#### Scenario: SWAP-006-B Fresh upgrade and replay preserve prior state
- **WHEN** migration22 runs against fresh and representative populated schema21 databases
- **THEN** valid swap storage exists, all prior rows/receipts/auth state/CSV bytes are preserved,
  and a repeated migration is a no-op
- **AND** previous trade/reward/transfer command replay returns the saved original receipts
