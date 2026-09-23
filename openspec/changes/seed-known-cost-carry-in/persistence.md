# Proposed known-cost carry-in contract

Design only; implementation requires the CSV archive and genuine predecessor API/UI
RED. This companion specifies a bounded first baseline, not complete accounting or
baseline amendment. Root owns migration/DDL and final contract freeze. Approved design choices and remaining seam freeze work are collected in §9.

## 1. Scope and unchanged contracts

A carry-in initializes an existing manual account from its current, immutable opening
snapshot plus explicitly supplied acquisition-lot details. The opening itself never
establishes acquisition dates, original quantities, original costs or prior disposals.
Every current position must have known cost; known zero is valid, unknown/null is not.
No partial adoption of a mixed known/unknown opening is supported.

`coverageFrom` equals that opening's `asOf`, without a second client-supplied instant.
Baseline holdings exist immediately before all journal executions at or after that
instant. Acquisitions may equal the boundary; baseline lots at that instant still
precede all journal executions there. This ordering is explicit, not a fabricated
pre-boundary millisecond. Prior realized results and historical fees are not inferred.

Keep every old empty-origin request, canonical payload, receipt and JSON projection
exactly unchanged. The empty-origin initialization still excludes ALL opening history.
Keep trade and CSV version ordinal/revision semantics: carry-in initialization creates
journal revision 0 and no trade/version/CSV command. Existing create/correct/void,
CSV confirmation/rollback and accepted receipt semantics remain intact.

The baseline is immutable even after all trades are void or lots are exhausted.
There is no reset/edit/delete endpoint in this slice. The UI discloses this before
acceptance. A later bounded amendment change must preserve origin evidence, append
lot versions and introduce an explicit calculation-revision contract; it cannot
silently replace lots at the same journal revision or weaken old replay semantics.
Ordinary trade corrections continue to recalculate against the pinned baseline.

## 2. Raw input and exact reconciliation

Raw bodies are plain JSON objects with exactly their allowlisted own fields; reject
null, arrays, coercion objects and unknown fields before normalization. All declared
strings retain their raw types; integer fields never accept strings/booleans.

All new paths extend `/accounting/accounts/:accountId/trade-journal/carry-in`;
HTTPS adds `/api`. Full owner session/MFA, existing source attribution, quotas,
Origin/CSRF for POST, private/no-store responses and safe error envelopes apply.
The existing 100 KiB JSON-body limit remains. Direct service calls enforce bounded
raw shapes/arrays/strings too; 100 lots do not promise that every padded raw encoding
fits the HTTP limit. No new transport, dependency, file or provider is introduced.

`CarryInLotInput = {instrumentId,acquiredAt,orderWithinTimestamp,
originalQuantity,originalCostUsd,remainingQuantity}` with exactly these own fields.

- UUIDv4 normalizes lowercase. Timestamp uses existing explicit-offset strict
  Gregorian years 1970..9999, 1..3 fractional digits and UTC millisecond normalization.
- Explicit raw integer order 0..2147483647. Normalized `(acquiredAt,orderWithinTimestamp)`
  must be unique across the account's entire submitted baseline, including different
  instruments. No UUID/input-array arrival order decides FIFO.
- Q=`originalQuantity` and R=`remainingQuantity` are positive canonical decimals;
  C=`originalCostUsd` is nonnegative. All use existing numeric(78,30), 256 raw-character
  bounds, no Number conversion, rounding, coercion, signs, commas or exponent notation.
  Require 0<R<=Q; exhausted historical lots are not baseline holdings.
- C is the original total acquisition basis including acquisition fees once. There
  is no supplied unit price, alternate currency, separate historical fee or total
  remaining-cost override. The owner must provide known original information.
- Normalize the complete 1..100 lots and sort by acquiredAt then integer order.
  Equivalent UUID/time/decimal spellings and reordered input arrays are the same command.
  Assign canonical ordinal 1..N after sorting. Distinct orders preserve identical-looking lots.
- `expectedOpeningRevision` is a raw integer 1..2147483647. It must equal the current
  non-null account pointer for a new initialization. The pointed snapshot must exist
  under the same owner/account; NULL pointer with retained history is not eligible.

For scale30 integer atoms calculate D=Q-R, A=floor(C*D/Q), K=C-A. D is prior disposal,
A prior allocated cost, K carried cost. A/K are exact derived atoms, not floating
amounts. Future disposal q consumes floor(C*(D+q)/Q)-A cumulatively; successive matches
use differences from that cumulative amount and final disposal conserves all K.
Neither D nor A enters post-coverage sale quantities, consumed cost or realized profit.

Under one coherent opening view require, for EACH opening instrument, sum(R) equal
its quantity and sum(K) equal its known totalCostUsd, exactly. Instrument sets must
match; no missing/extra position or tolerance. Every lot's acquiredAt<=coverageFrom.
Unknown costs are refused, not completed from a supplied zero. Foreign instrument
UUIDs are generic 404 before private reconciliation output; owned-but-extra instruments
are a reviewed mismatch. Overlarge intermediate sums are exact derived strings and
must not be run through the narrower per-input decimal parser.

## 3. Discovery, preview and initialization

GET base returns `CarryInState = {accountId,eligible,ineligibilityReason,
opening,origin}`. `opening` is the existing complete Opening projection
(snapshot plus at most 100 labeled positions) or null. Before initialization it is the
current pointed snapshot; after carry-in it is the pinned source snapshot, independent
of any later invalid moving-pointer state. It is baseline evidence, not live holdings.
`origin` is CarryInOrigin only
for an initialized carry-in account; otherwise null. All fields share one read-only
REPEATABLE READ transaction with the owned account, journal and referenced snapshot.

Eligibility reasons in precedence order: `already-initialized`, `no-current-opening`,
`unknown-cost`; otherwise null/eligible true. Any existing journal is already initialized,
including an empty-origin journal; its old origin remains discoverable through the
unchanged GET `/trade-journal`. Existing `JournalState` before initialization is not
expanded or relabeled: `opening-history` still explains EMPTY-origin exclusion. The
new discovery route separately explains explicit carry-in eligibility.

POST `/preview` body `{expectedOpeningRevision,lots}` returns 200 CarryInPreview.
No attestation/key is consumed, no state is stored, and no hash/token is issued.
A missing/unknown-cost opening, existing journal or stale expected revision returns 409.
Syntactically valid candidate mismatches return200 with `canInitialize:false`:

`CarryInPreview = {accountId,openingRevision,coverageFrom,canInitialize,issues,
lots,reconciliation,carryInCostUsd}`.

- `lots` are the full canonical lot inputs plus ordinal, instrumentName,
  instrumentSymbol, priorDisposedQuantity, priorAllocatedCostUsd and carriedCostUsd.
  No server lot IDs are assigned during preview.
- `reconciliation` is the instrument union, ordered by lowercase UUID, with
  `{instrumentId,instrumentName,instrumentSymbol,openingQuantity,openingCostUsd,
  carriedQuantity,carriedCostUsd}`. An owned extra instrument has null opening values;
  a missing instrument has carriedQuantity/carriedCostUsd strings `0`. Actual opening-position costs
  are never null here because an unknown-cost opening is already ineligible.
- `issues` has `{code,instrumentId,ordinal}`; irrelevant location fields are null.
  Order: `acquisition-after-coverage` by ordinal, then `extra-instrument`,
  `missing-instrument`, `quantity-mismatch`, `cost-mismatch`, each by instrument UUID.
  Missing/extra instruments do not also receive derivative quantity/cost issues.
  `canInitialize` is true iff issues is empty. `carryInCostUsd` sums all submitted K;
  it is a proposed baseline amount, never a partial valid-subset calculation or profit.

POST base body `{requestId,expectedOpeningRevision,lots,assertReviewed:true}` returns
201 new / 200 exact accepted replay, with CarryInOrigin. `assertReviewed` is literal
boolean true, attesting complete known original lots, exact reconciliation and the
immutable baseline limitation. Preview is an aid, not an authorization capability;
a valid direct initialization is allowed after the same server validation.

`CarryInOrigin = {accountId,requestId,originKind:'known-cost-carry-in',
coverageFrom,openingRevision,lotCount,carryInCostUsd,createdAt}`.
This immutable receipt contains no live journal revision/results. Counts/cost are
projected from the pinned immutable baseline; there is no derived FIFO cache.
Generated lot IDs are retrieved separately and remain stable on replay/restart.

Malformed envelope/type/array/UUID/date/amount/order, duplicate normalized chronology,
R>Q, missing/false/wrong-type attestation or lot count outside 1..100 returns 400.
A foreign/absent account/instrument is generic 404. Existing initialization, stale
opening, unknown cost, absent current opening or complete reconciliation failure is409.
Storage failure is generic 500; the unchanged JSON transport cap may return 413.
No original private values, canonical payload or SQL detail is logged/reflected.

## 4. Canonical replay and transaction order

Initialize canonicalPayload is UTF-8 JSON.stringify of the following tuple, no whitespace:
`['ct-known-cost-carry-in-v1',expectedOpeningRevision,true,lots.map(l=>
[l.instrumentId,l.acquiredAt,l.orderWithinTimestamp,l.originalQuantity,
l.originalCostUsd,l.remainingQuantity])]` using the normalized chronological list.
Exclude requestId, generated IDs, labels and calculated totals. There is no previewHash:
the immutable opening revision and complete normalized payload determine all reviewed
results; final reconciliation still runs under the write lock. No mutable price/rate
or provider context is involved.

Use the existing one-row owner/account initialization namespace shared across origin
kinds. It remains distinct from trade and CSV command request namespaces. Different
accounts may reuse a key. Existing empty-origin canonical JSON and receipts are not
rewritten or passed through the new tuple normalizer.

New carry-in order: raw normalize -> transaction -> owned account FOR UPDATE -> read
existing journal. If initialized, matching carry-in kind/key/canonicalPayload returns
its immutable receipt using ONLY stored baseline evidence. Changed key/payload/kind
returns 409. Do not consult current opening eligibility/pointer/cost, input instrument
availability, current trades, supported future policy or capacity before exact replay.
The old empty initializer must similarly replay its old kind/key/payload unchanged and
reject cross-kind reuse; no endpoint can replace the other origin.

For a new journal: verify current opening revision and full owner-scoped lot identity,
read current snapshot/positions, validate known costs/chronology/reconciliation, insert
journal at revision 0 plus all baseline rows, commit, then return receipt. No prefix,
account opening-pointer write, trade version or external flow is created. Defer success
publication until COMMIT; failure reserves no key/lot IDs. Two initializers or an
opening replacement serialize on the same account row. Opening writes retain old
accepted replay before the journal dependency refusal.

## 5. Stored evidence and additive migration16

Recommended migration name `AddKnownCostCarryIn1790060000000`. Preserve all preceding
rows/tables/indexes/constraints, except the explicitly widened origin-kind constraint
and new nullable journal link/indexes. No historical migration edits, backfill,
extension, startup migration or destructive down behavior. Populated15 fixtures must
include committed/rolled-back CSV originals/commands/links and all auth/financial state.
For old journal rows, compare every preexisting column value unchanged and separately
assert new openingRevision is NULL; adding this key to to_jsonb(row) is the sole allowed
row-shape difference, not permission to exclude journal rows from preservation checks.

Add nullable `openingRevision integer` to account_trade_journals. Widen origin CHECK
with explicit two-branch non-null semantics:
`(originKind='declared-empty' AND openingRevision IS NULL) OR
(originKind='known-cost-carry-in' AND openingRevision IS NOT NULL AND openingRevision>0)`.
Do not rely on SQL UNKNOWN to reject null. Add FK(ownerId,accountId,openingRevision)
to account_opening_snapshots(ownerId,accountId,revision), RESTRICT; add unique
(ownerId,accountId,openingRevision) for the baseline composite reference. Existing
empty journals receive only SQL NULL and retain their exact public projection.

New `account_carry_in_lots`, all columns NOT NULL:
`id uuid`, `ownerId uuid`, `accountId uuid`, `openingRevision integer`,
`ordinal integer`, `instrumentId uuid`, `acquiredAt timestamptz(3)`,
`orderWithinTimestamp integer`, `originalQuantity numeric(78,30)`,
`originalCostUsd numeric(78,30)`, `remainingQuantity numeric(78,30)`,
`createdAt timestamptz(3)` default clock_timestamp().

PK(id); unique(ownerId,accountId,id), unique(ownerId,accountId,ordinal),
unique(ownerId,accountId,acquiredAt,orderWithinTimestamp). FK ownerId->users.id;
FK(ownerId,accountId,openingRevision)->journal same fields;
FK(ownerId,accountId,openingRevision,instrumentId)->account_opening_positions
(ownerId,accountId,revision,instrumentId). All RESTRICT. This binds each lot to the
exact owned source position and prohibits carry-in rows for empty-origin journals.
Ordinal1..100, openingRevision>0, order>=0; Q/R>0, R<=Q, C>=0; explicitly reject
numeric NaN and both infinities. Times finite, acquiredAt within existing1970..9999
bounds, createdAt finite. UUID IDs are generated once by the application during the
successful initialization; never hashes of private quantities/costs.

Cross-row complete-set/sum reconciliation, minimum one lot, acquiredAt<=source asOf,
coverageFrom=source asOf and append-only application behavior are transaction/service
invariants under account locking, not falsely claimed as cross-table SQL CHECKs.
SQL uniqueness and ordinal bounds enforce at most 100 lots. No stored D/A/K duplicates:
derive them from immutable Q/C/R. No public baseline UPDATE/DELETE endpoint.

## 6. Current FIFO, projections and historical provenance

Read initial lots through a small caller-owned EntityManager helper. Never open a
second transaction or use DataSource.manager from a current RR calculation. Every
manual candidate/read and CSV preview/confirm/rollback uses the same initial lots
and active trade heads. An empty origin supplies zero lots and retains byte-equivalent
old projections and calculations. CSV hashes need no origin field change: baseline
is immutable per account, initial revision remains0 and account ID already domains
its preview hash. Amendment must revisit that assumption before implementation.

Seed queues by canonical baseline chronology with original Q/C, disposed D, allocated A;
then process all covered trades. Existing eight-field Summary remains exact in shape.
Post-coverage buy/sale/fee totals exclude carry-in. ConsumedCostUsd includes only
post-coverage disposals; realizedUsd=netSalesUsd-consumedCostUsd;
remainingCostUsd=carryInCostUsd+grossBuysUsd+buyFeesUsd-consumedCostUsd.
CarryInOrigin displays initial cost separately, never as new purchases or market value.
Do not sum quantities across different instruments. Existing realization and trade
version projections remain unchanged.

GET `/trade-journal` retains its four existing outer keys. For carry-in ONLY, its
journal is `{...CarryInOrigin,journalRevision,activeTradeCount,versionCount,limits,
summary}`. Counts/limits describe trade heads/versions, excluding the immutable lot
baseline. Existing empty-origin JournalState remains identical, including its origin.

Existing buy Lot and Match shapes remain unchanged in every account. New variants:

- `CarryInLot = {sourceKind:'carry-in',lotId,openingRevision,ordinal,instrumentId,
  instrumentName,instrumentSymbol,acquiredAt,orderWithinTimestamp,originalQuantity,
  originalCostUsd,carriedQuantity,carriedCostUsd,remainingQuantity,remainingCostUsd}`.
  Carried fields are immutable baseline R/K; remaining fields reflect covered trades.
- `CarryInMatch = {sourceKind:'carry-in',sellTradeId,sellVersion,lotId,openingRevision,
  ordinal,quantity,costUsd}`. No buyTradeId/buyVersion or fictitious purchase exists.

The current `/trade-lots` page is a union of old buy lots and nondepleted CarryInLots;
carry-in lots precede covered buys, internally ordered by acquisition chronology.
Current matches use sale chronology/FIFO order and the corresponding union. Existing
revision-pinned default 50/max 100 pagination is unchanged; calculate the FULL input,
never a page. Trade lists and immutable trade-version pages contain no baseline rows.

GET new `/carry-in/lots` returns immutable retained provenance, including exhausted
lots: `{accountId,openingRevision,items,nextAfterOrdinal}`. Query `{afterOrdinal?,limit?}`
uses canonical integer strings, ordinal 0..100 default 0, limit 1..100 default 50; unknown
keys/wrong raw types400. Each immutable item is
`{lotId,ordinal,instrumentId,instrumentName,instrumentSymbol,acquiredAt,
orderWithinTimestamp,originalQuantity,originalCostUsd,carriedQuantity,
priorDisposedQuantity,priorAllocatedCostUsd,carriedCostUsd}`. It deliberately uses
carriedQuantity for baseline R and has no current remainingQuantity/remainingCostUsd.
Never reuse the current-lot projection to hide that distinction.
Response order is ordinal; exclusive continuation, null at end. A valid cursor within
0..100 but beyond the retained lot count returns empty;101 or malformed raw text returns400. No journalRevision needed because this evidence never changes. Owned
accounts without a carry-in origin return409. Read owner/journal/lots/labels in one RR.

## 7. Bounds, identity and UI safeguards

At most 100 initial lots plus 1000 active trades are calculation inputs. Initial lots
never spend trade/version capacity; all existing 1000/10000 limits and exact replay at
caps stay unchanged. Each original basis has at most 78 atom digits, so a loose 1100-lot
sum requires 82 derived atom digits; signed sales/fees/profit stay within 82 too.
Cumulative allocation products remain at most 156 digits. No derived total is stored
in numeric(78,30) or validated by the narrower input parser. Keep existing wide-value
and split/residual tests and add independent carry-in offset/82-digit vectors.

Instrument UUIDs and owner/account scope remain identity; symbols, filenames and
historical labels establish neither chain identity nor actual USD cash. Present the
referenced opening as historical baseline evidence alongside reconstructed holdings,
not a second additive balance. Unknown-cost accounts remain available as manual
openings with an honest unavailable carry-in/sales explanation.

The new Russian UI requires explicit preview and review checkbox before first submit,
invalidates preview on every field/source-opening edit, and submits the exact complete
original command. No automatic retry. Same in-app refresh/route/SPA401 recovery rules
as the CSV slice; no private browser storage, and full document reload is not pending
command persistence. Prior ambiguity survives reads and denied 401/403/429/400/404;
only accepted receipt or exact original POST 409 after replay lookup resolves it.
A known receipt followed by failed fresh reads stays blocked until current review.

## 8. Minimal service/test seam

Proposed `CarryInService(DataSource)` methods: `state(ownerId,accountId)`,
`preview(ownerId,accountId,raw)`, `initialize(ownerId,accountId,raw)` returning
`{created,value:CarryInOrigin}`, and `listLots(ownerId,accountId,rawQuery={})`.
Raw bodies/queries parse once in service; no global implicit coercion exceptions.
Controller owns no arithmetic/transactions. Input helper names and the extended pure
FIFO signature must be frozen with independent test authors before implementation.

Required real tests cover original-versus-rebased partial allocation; exact opening
reconciliation/knownzero/unknown refusal; acquisition at boundary before same-time
covered sale; common-lock races/replay/deferred COMMIT rollback; populated15 upgrade;
RR/continuation; manual and CSV sale/correction/rollback against same initial lots;
actual auth/CSRF/foreign/raw input failures; Russian preview and immutable-origin
warning, retained source labels and no provider calls. Missing modules/tables are
prerequisites, not behavioral RED. No owner database is involved.

## 9. Approved choices and explicitly deferred work

Root approved these bounded choices during design review; they require no additional
user authorization:
1. No preview hash/state; full canonical payload+immutable source revision+attestation.
2. Server-generated UUID IDs with normalized chronology ordinals; no deterministic
   financial-data UUIDs and no preview-generated persisted identities.
3. Separate discovery and immutable-lot pages; existing JSON shapes unchanged except
   a new carry-in journal branch and explicit carry-in Lot/Match variants.
4. One baseline table and journal link; the documented cross-row invariants stay
   application-enforced within the common lock, without speculative trigger framework.

Before implementation, independently review this full wire/schema contract against
root specifications, freeze input/pure-calculation helper signatures with test authors,
and confirm the exact migration constraint names. No competing alternative interface
is intended; these are remaining review tasks, not permission to guess during coding.

Initial baseline correction is deliberately unsupported, not solved forever by an
immutable origin. Before claiming the full brief complete, a follow-up must distinguish
immutable origin identity from versioned lot evidence; advance a calculation token
independently of existing trade/CSV version counts or explicitly migrate that contract;
recompute full affected history; retain previous receipts/lot references and reject
invalid corrections atomically. Never reuse opening replacement or a changed current
pointer as a hidden amendment, and never advise duplicating the account as a correction.
