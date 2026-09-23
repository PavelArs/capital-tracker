## Context

Manual openings provide exact aggregate quantities and known/unknown USD cost, not
acquisition chronology. The preceding change was verified and archived as
2026-09-23-record-manual-opening-positions (e2080aa). Implementation of this change
still requires genuine predecessor-image RED.
The target brief requires FIFO and rebuilding derived history after old edits. This
bounded vertical slice proves those behaviors through real Russian UI, HTTPS and PG.
The normative API/storage contract is in `persistence.md`; stable scenarios are in specs.

## Goals / Non-Goals

**Goals:** Explicit empty-origin provenance; exact manual USD buys/sells and fees;
inspectable deterministic FIFO; atomic backdating/correction/void; immutable receipts;
coherent bounded reads; preserved owner isolation and all preceding data.

**Non-Goals:** CSV/import framework, carry-in lots, opening conversion, provider or
legacy aggregation, swaps, transfers, non-USD fees, fiat settlement balances, flows,
valuation, tax compliance, portfolio returns, dependencies or production rollout.

## Decisions

### Explicit eligible origin, shared lock

A journal requires `assertEmpty: true` and an explicit coverage instant. Eligibility
requires BOTH a NULL opening pointer and no opening snapshot history. An absent
opening is not proof of zero holdings. Known, unknown and known-zero opening accounts
remain ineligible. No synthetic purchase is generated. Initialization and opening
writes lock the same owned account row first; one racing operation wins and the
other returns 409. Existing opening request replay keeps its preceding semantics;
new opening writes are blocked after journal initialization, including after all
trades are voided. The journal origin persists independently of the opening pointer.

### Small journal, full deterministic rebuild

Use three additive tables and typed persistence mappings, a narrow trade service,
raw-input parsers and a pure BigInt atom/FIFO helper inside the existing accounting
module. No generic repository, event bus, cache/materialized-lot or import abstraction.
Authoritative history is immutable complete versions with stable trade heads.
Correction can change every execution field; void copies the last execution and
marks a terminal inactive version. Reinstatement is not supported. Every command
rebuilds the complete candidate effective history, including old/new instrument
queues, before atomic commit. Unsupported historical prefixes return 409 even if
final inventory would be positive. Arrival order/UUID never determines chronology.

Bounds: at most 1,000 effective active trades and 10,000 immutable trade versions per
account, including voids. The journal revision counts committed versions, starting
at 0. At the version cap every new command, including void, is refused; replay still
works. This explicit limitation avoids an unbounded append path disguised as delete.
A future larger-history contract must address these limits before CSV. Reads never
truncate the history used for calculation.

### Exact arithmetic and explicit quantum

Inputs retain numeric(78,30): at most 48 integer and 30 fractional digits, raw plain
strings validated before PG typmod rounding; finite positive quantity/gross, finite
nonnegative fee. Gross zero is unsupported. Buy basis = gross + fee and must fit
78 atom digits before writes. Sell net = gross - fee can be negative. Sale fee is
deducted once. Signed result formatting produces canonical `0`, never `-0`.

Use built-in BigInt at S = 10^30 atoms, without JavaScript Number amount arithmetic
or a new dependency. For original lot quantity Q, basis C and cumulative disposal q,
allocated(q) = floor(C*q/Q). Each match receives the difference from the preceding
cumulative allocation. Full depletion receives the exact remaining atoms. Do not
recompute a rounded remaining unit price. Intermediate products can require 156
digits; aggregate magnitudes are bounded by 81 atom digits at the selected workload
cap. Output sums can exceed 48 integer digits and must not pass through the narrower
input parser. Let M = 10^78 - 1, with B buys and S sells, B + S <= 1000.
Each buy basis is at most M; each sale net lies in [-M,M]; consumed basis is at
most B*M. Thus realized lies between -(S+B)*M and S*M and every specified
aggregate magnitude is less than 10^81. Positive products C*q <= M^2 < 10^156.
All quantity/cost operands of division are nonnegative; signed results
use subtraction. Individual 30-place allocations are documented quantization, not
infinitely precise or tax-compliant results.

For buys 1/100 and 1/200 then sale 1.5/gross 450, basis 200, realized 250 and remaining
basis 100. With buy fees 1/2 and sell fee 3: basis 202, net 447, realized 245, remaining
101. Buy 3/gross 1 then three unit sales allocates .333…333, .333…333, .333…334.
Buy 7/gross 0.000000000000000000000000000003 then seven unit sales allocates atoms
[0,0,1,0,1,0,1]. These known zero match costs never become unknown.

Primary semantics: [PostgreSQL 16 numeric](https://www.postgresql.org/docs/16/datatype-numeric.html)
rounds declared scale before storage and orders NaN above ordinary numbers; explicit
finite SQL checks and pre-storage scale validation are required.
[ECMAScript BigInt division](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint-divide)
truncates toward zero, equivalent to floor only for these nonnegative operands.

### Atomic commands and coherent reads

Lock order is owned account FOR UPDATE, then its journal/head/version work; never
lock journal before account. Parse raw inputs once before SQL. Under that lock,
check idempotent replay before CAS/cap checks, form candidate history, validate all
chronological prefixes, then write version/head/journal revision in one transaction.
A rejected request consumes no identity. Real commit failure rolls everything back;
reuse existing generic 500/log privacy. No automatic mutation retry after ambiguity.

Derived reads use an explicit read-only REPEATABLE READ transaction to read journal
revision, all effective heads/versions and owned labels from one snapshot. A supplied
revision must match that snapshot or return 409. Each page carries that revision;
continuation never combines pages across corrections. Retained version history is
not a promise of arbitrary historical FIFO queries. Read Committed alone is inadequate:
[PostgreSQL 16 isolation](https://www.postgresql.org/docs/16/transaction-iso.html).

### Protected Russian UI and existing boundaries

Reuse manual-account detail at `/manual-accounts/:id`, with a journal section and
bounded instrument picker. Account discovery remains unchanged. Explain eligibility
and require an unchecked explicit empty-position attestation. Show coverage in UTC,
actual gross USD total, separate USD fee and same-instant order; do not ask for a
rounded unit-price calculation. One trade form supports create and explicit full
correction; void requires a review of the target. Opening revision and journal revision have separate explicit labels, never one
shared counter. Current results, paginated lots,
sales/matches and immutable versions use exact strings and joined instrument labels.

Labels include “Журнал сделок в USD”, “Позиции были пустыми”,
“Реализованный результат по журналу сделок” and “Остаточная учётная стоимость”.
Explain 30-decimal allocation, declared coverage and unsupported opening carry-in.
Do not label this as portfolio return, market value, USD cash or tax report.

Keep a request key across transport ambiguity; changing the draft starts a new key.
After any success/replay, treat the result as a receipt and fetch current journal;
never set current state from an old receipt. Preserve drafts on 409, require explicit
current-state review before another write and never auto-submit. Disable editable
fields during writes; route-generation/request-sequence guards reject stale responses.
On page revision drift, discard accumulated pages and explicitly reload. Preserve
Russian local errors, existing 401 redirect and 403 CSRF handling without transport
framework changes. All routes remain full-MFA private with session/CSRF and existing
quotas; valid authorization can touch session lastSeenAt before the accounting TX.

## Risks / Trade-offs

- [Aggregate opening cannot establish FIFO] → refuse every opening-history account;
  later carry-in provenance is a separate slice, never convert unknown cost to zero.
- [Full rebuild is bounded, not scalable import architecture] → enforce caps before
  writing and paginate projections; independently test exact boundary behavior.
- [Allocation policy affects individual matches] → expose provenance and remainder,
  use independent rational/integer expectations and conservation assertions.
- [Concurrent updates mix reads or overspend] → shared account lock, revision CAS,
  repeatable-read snapshots and revision-pinned continuation.
- [Ambiguous response or commit] → immutable request receipts and explicit replay;
  no client-side automatic mutation retry.

## Migration Plan

After verified predecessor archive and actual RED, add migration 14
`AddUsdTradeJournal1790040000000`. It creates only the three new empty tables/constraints;
no owner selection, origin assertion, lot backfill or earlier schema/row modification.
Rehearse populated 13→14, fresh migration/replay and every previous refusal/upgrade.
Rollback of a released binary must not drop recorded trades: retain additive schema,
stop journal writes and use an explicit reviewed forward repair. No automated down
migration or production deployment is part of this change. Coordinator owns migration,
shared module/UI wiring and harness; backend, frontend and independent tests have
separate worktrees and file ownership. Independent review precedes full release-image
acceptance, evidence and archive. Artifact validation alone proves no behavior.

## Open Questions

No unresolved behavior choices are delegated to implementation. Workload/empty-origin
limits are deliberate product limitations documented above. Root reconciles the active
manual delta into canonical specs after that predecessor is verified and archived.
