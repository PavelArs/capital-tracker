## Context

The existing opening model preserves an explicit coverage instant, exact quantity
and known/unknown aggregate cost. The USD journal deliberately requires a separately
attested empty origin, so retained opening accounts cannot currently sell holdings.
The CSV change extends that same journal without inventing an acquisition history.
Its complete release gate and archive are prerequisites to this implementation.

The target brief requires reproducible FIFO and visible unknown costs. An aggregate
opening cannot establish original acquisition lots or their prior partial-disposal
allocation. This change accepts those facts only as explicit owner-supplied evidence,
reconciles them to one immutable opening snapshot and preserves both sources.

## Goals / Non-Goals

**Goals:** A bounded Russian preview/review/initialize journey for known-cost opening
accounts; exact FIFO for subsequent manual/CSV trades; immutable baseline provenance,
old-request replay, coherent read snapshots and data-preserving migration16.

**Non-Goals:** Unknown-cost sales, inferred historical dates/fees, baseline amendment
or reset, transfers, cash flows, swaps, price history, portfolio returns, lot-file
imports, provider integration, production rollout and final repository consolidation.
Baseline correction remains required later work; the UI must prominently disclose
that initialization locks this reviewed baseline in the current slice.

## Decisions

### 1. Pin the opening, coverage and meaning of the baseline

A new initialization references the current owned opening revision, never a moving
aggregate or an arbitrary earlier snapshot. Coverage is exactly that snapshot's
asOf. Interpret the baseline as inventory immediately before every covered execution,
including executions at the same instant. The owner must explicitly attest the
original lot details; acquisition timestamps cannot be after the boundary.

One to100 lots must exactly cover the opening's instrument set. Every opening cost
must be explicitly known, including known zero. For each instrument, sums of remaining
lot quantity and remaining basis must equal the opening position precisely. Reject
missing/extra instruments, unknown cost, duplicate effective lot chronology and one-atom
mismatches. No proportional cost spreading, inferred acquisition dates or residual
balancing row is permissible. Opening accounts with unsupported data keep their prior
behavior and readable history. Empty-origin initialization retains all old exclusions.

A separate server preview performs the same normalization/reconciliation without writes.
The initialization revalidates under the owned account lock against the supplied opening
revision; no saved mutable preview or provisional lots are needed. Exact wire/schema
choices are reviewed in persistence.md before acceptance authorship.

### 2. Preserve original allocation coordinates

Each supplied lot retains original quantity Q, original total USD basis C (including
acquisition fees exactly once), remaining quantity R, original acquisition instant
and explicit same-instant order. Require 0 < R <= Q and C >= 0 with existing78-atom-digit
raw decimal bounds. Compute D=Q-R, allocated=floor(C*D/Q), remaining basis=C-allocated.
Seed the pure FIFO queue with those cumulative disposal/allocation offsets.

For original4 units/cost2 atoms with1 unit already disposed, three subsequent one-unit
disposals allocate [1,0,1] atoms. Rebasing the remaining3 units/cost2 atoms would allocate
[0,1,1], so remaining values alone cannot replace Q/C. Historical disposed quantities
are allocation evidence, not newly recorded past sales or realized profit.

Carry-in enters inventory before all covered trades, with per-instrument lot order
fixed by declared acquisition chronology. It does not increase gross buys, buy fees,
external flows or trade/version counts. Expose initial recorded basis separately;
remaining cost includes unconsumed baseline. Existing exact arithmetic and negative-
chronological-prefix rejection remain. With100 baseline lots plus1000 active trades,
allow82 derived atom digits; per-input78 and allocation-product156 limits remain.

### 3. Preserve one calculation path and clear provenance

Extend the existing pure FIFO input with explicit readonly baseline lots; do not turn
lots into synthetic buy trades. Add a small caller-owned EntityManager baseline reader
beside the journal persistence helpers. Manual writes and every CSV preview, confirm,
rollback and current derived read must load the same baseline inside their existing
write transaction or REPEATABLE READ READ ONLY snapshot. No global source.manager
read or separate cache is allowed within those operations.

Old empty-origin response shapes and receipts remain exact, including their buyTradeId/
buyVersion provenance. New carry-in lot/match variants carry an explicit origin tag and
immutable lot/opening identity, never fictitious trade IDs. Keep all current bounded
paging and revision checks; baseline details have their own bounded projection.
The journal revision continues to count immutable trade versions only. Initialization
is revision0, and CSV ranges still advance byN. Baseline mutation must not be squeezed
into that ordinal namespace in a later implementation shortcut.

### 4. Atomic initialization and immutable replay

The existing account row lock serializes opening replacement, empty initialization,
carry-in initialization and later trades/imports. A previously accepted exact origin
command returns its original receipt before mutable current-state checks. Changed
payload/kind under an accepted key conflicts. No failed initialization reserves a key.
New initialization atomically writes its origin, immutable lot set and any required
snapshot reference. A genuine deferred COMMIT probe must witness the complete state,
then prove rollback and successful original-key retry.

Once initialized, new opening writes remain blocked even after every trade is void.
Existing accepted opening commands remain replayable without rewinding the pointer.
The opening is historical baseline evidence; current inventory comes from seeded FIFO,
so the UI must not add the two holdings views. Trade corrections and CSV rollback still
recompute the complete supported history. Initial lot amendment/reset is unavailable
and clearly disclosed; it needs a separate future revision/reconciliation design.

### 5. Retain privacy, input caps and explicit client intent

Use existing full-owner/MFA guards, Origin/CSRF, request quotas and safe static errors.
Reject raw unknown fields and coercion before storage, with generic ownership failures.
The current100KiB JSON envelope and existing account/journal caps stay unchanged;
1..100 lots bound parsing and calculation. No source is sent to a provider.

A Russian form loads the current opening, accepts explicit original lot evidence,
shows exact reconciled values/errors and requires a current successful preview plus
explicit irreversible-baseline acknowledgement. Editing any input/account invalidates
preview; late requests cannot re-enable obsolete acceptance. Retain unknown original
initialization across in-app refresh/SPA navigation and denied retries, without auto-
submitting a new key. Known receipt plus failed current read remains blocked until
successful refresh. Explain the existing browser-document lifetime of local recovery.

## Risks / Trade-offs

- Wrong owner-supplied history -> exact snapshot reconciliation, prominent immutable
  review, no claim that arithmetic validates the factual acquisition evidence.
- Incorrect partial-lot rounding -> independent atom-sized cumulative-offset vectors,
  full conservation and exact remaining-cost comparisons.
- Inconsistent manual/CSV results -> one baseline reader/pure calculator and real
  cross-path sale/rollback acceptance plus coherent concurrent-read checks.
- API provenance regression -> unchanged empty-origin golden characterizations and
  explicit tagged new variants; never weaken old exact-field assertions.
- Scope growth into a second ledger -> additive origin/lot persistence only; defer
  transfer, external-flow, unknown-cost and baseline-amendment contracts explicitly.

## Migration Plan

After the verified CSV archive and genuine predecessor-image missing-carry-in API/UI
RED, root adds migration16. Preserve all prior rows, CSV originals/settings/receipts/
provenance, owner/session/MFA/admission state, constraints and sequences. Add only the
reviewed lot/origin fields and constraints needed for the new variant; widen the
existing origin-kind check without rewriting old records. Rehearse fresh16/replay,
all earlier refusal/upgrade cases and a populated15 including both CSV terminal states.

Do not deploy or operate an owner database. Application rollback retains baseline
records and the upgraded schema; an older binary that cannot interpret carry-in must
not serve that data as empty-origin inventory. Document this compatibility boundary;
no destructive down/reset or automatic image rollback promise is appropriate.

## Open Questions

Wire projections, canonical tuples, lot identity, shared helper seams and explicit
new schema constraints are reviewed in persistence.md. Acceptance review and the
actual predecessor catalog check remain. Reconcile all affected specification blocks
against the actual archived CSV canonical specs before predecessor RED execution.
Independent tests may be authored in an isolated worktree from this frozen contract
while that predecessor gate finishes; no carry-in product code is changed. No implementation
or migration is authorized by a draft artifact alone; the established ATDD prerequisites
remain mandatory. No new owner permission or external service is required for this
isolated reversible preparation.
