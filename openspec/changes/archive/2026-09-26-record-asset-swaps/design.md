## Context

Schema21 has exact USD trades, original-coordinate carry-in/transfer lots and nullable
reward bases. Connected replay validates every current-effective event in a shared
account chronology. Owner advisory locking serializes economic writes before sorted
account row locking; reads use one repeatable-read read-only transaction. Baseline385
relevant backend tests passed before this change. No active predecessor change remains.

The inspected pipeline retains separate NestJS/React images, Compose/Nginx and GHCR.
CI runs real acceptance; old production workflow remains gated pending separate release
hardening. No replacement or deployment is needed for this accounting capability.

## Goals / Non-Goals

**Goals:** One manual atomic exchange with honest missing evidence, exact FIFO and fee
provenance, immutable correction/retry, connected restatement and Russian review.

**Non-Goals:** See proposal. This is an investment bookkeeping convention, not a tax
report. No inference from stablecoin symbols, market prices, outgoing basis or balances.

## Decisions

### One identity, two different instruments, explicit consideration

Use a dedicated swap identity/version aggregate. Independent USD buy/sell rows would
invent cash legs, allow half corrections and cannot represent unknown proceeds. The
same-account operation records outgoing principal and gross incoming quantity. Nullable
`considerationUsd` is the owner's declared total USD exchange consideration, simultaneously
outgoing proceeds and incoming original acquisition basis. Explicit0 is known. Missing
consideration creates an unknown-basis incoming lot, even if the outgoing basis is known.
Conversely a known consideration creates a known incoming lot from unknown outgoing basis.

### Fees have explicit source and are counted once

`feeSource` is null, `held` or `incoming`. Zero fee requires null source/instrument.
Positive held fees consume historical FIFO inventory after principal debit and before
incoming credit; they may use either swap asset or a third instrument, but require
available pre-acquisition holdings. Positive incoming fees must use the incoming
instrument and cannot exceed gross incoming quantity. They consume only the original
new acquisition's prefix interval, never an older lot of the same asset. Equal fee/gross
is valid and leaves no new holding. The remaining lot retains its original quantity,
basis and coordinates; no net-quantity rebasing or double rounding.

The dedicated swap result is consideration minus consumed principal basis minus consumed
fee basis. The fee cost is historical acquisition cost, not an inferred USD market fee.
Do not capitalize it again or create an extra fee-disposal gain. Per-operation result is
null when any required component is unknown. This convention conserves book profit plus
remaining basis; show the convention explicitly in UI and guide. Avoid a configurable
tax-policy framework. Principal, fee, consideration and realized evidence are independent;
known realized subtotal sums only fully known operations, never unmatched known proceeds.

### Extend the existing replay and provenance

`OwnedAccountInput.swaps` contains current active `FifoSwap` rows; absence means empty.
Add a swap event to full chronological replay and a `swap` origin/local lot/local sale
match to the existing unions. Transfers preserve the original swap identity/version and
interval, with separate latest arrival. Shared-key collisions with trades/rewards/transfers
are rejected. Full corrected histories, not only visible prefixes, must remain valid.
Allocation items distinguish principal and fee and retain source identity/coordinates.

Keep old `summary` fields as actual USD trade totals; add `swapSummary` and swap allocations
instead of falsely reporting synthetic purchases/sales. Remaining cost includes all lots.
Existing UI labels must make trade-only realized scope clear and display swap results
separately. Historical positions, prices, charts, selected valuations, cash flows and
period profit use actual holdings; exchange consideration/result is not added to value or
external flows. Empty source summaries persist when all swap identities are void. Recipient
accounts do not duplicate swap results merely by receiving an originating lot.

### Reuse immutable commands and connected transactions

Follow reward command shape with strict allowlisted inputs, normalized payload including
pins, saved complete versions/labels and terminal void. Exact replay precedes current
CAS/capacity checks. All old/candidate connected histories and participant budgets are
validated before inserting a version and advancing each affected pin once. A failed
statement or deferred COMMIT rolls everything back, including key reservation. Trade
version counts stay actual trade versions. CSV confirm/rollback must load effective swaps
and refuse newly impossible prefixes without changing private source bytes.

Read counts before rows; include at most1000active swaps per owner/account/component and
10000swap versions per owner/account. Keep32accounts,10000component trades,1000transfers,
1000rewards,100000matches/held fragments and10000shared revision ticks. Reads and chart
materialization load each connected history once in their existing snapshot. Return full
totals with bounded pages, no hidden first-page truncation. See persistence.md for wire
names, pagination, limits and version structure.

### Owner review and failure recovery

The journal gets a separate controlled swap editor. Review shows both UUIDs/quantities,
fee mode, unknown versus known0 consideration, UTC time/order, target version and current
journal pin; it is input review, not an unimplemented simulated trade quote. Writes perform
authoritative FIFO validation. Changed input, account, refreshed pin or late-response
generation invalidates review. Freeze command/key/pins and visible evidence during
ambiguous delivery and across SPA remount; retry only explicitly and identically. Preserve
the separate USD trade draft. Full browser reload is not durable command recovery.

## Risks / Trade-offs

- Incoming fee versus held fee changes FIFO → require explicit source; independently test
  an older same-instrument lot. No price-provider or tax-policy inference.
- New origin union touches retained consumers → characterize old shapes, update every
  narrowing/rendering site and verify transfer, CSV and valuation regressions.
- Historical correction can invalidate another account → union replay, owner serialization
  and all-participant revision capacity; real processes/SQL locks verify races.
- More evidence can inflate chart payloads → chart points omit swap summary metadata while
  retaining exact holdings and cost; load/count once per snapshot.
- Bounded manual operations are not chain reconciliation → visible manual provenance;
  reconciliation remains explicit future work.

## Migration Plan

Migration22 adds `account_swaps` and `account_swap_versions` only, composite owner/account/
instrument constraints, exact numeric checks, immutable version identity, unique request
namespace and deferred current-head reference. Existing tables/rows/receipts are preserved.
Verify fresh22 and populated21 (actual auth, prices, trades, rewards, transfers, CSV bytes),
no-op rerun, SQL constraints and deferred COMMIT rollback. Never run against owner DB.
No automatic destructive down migration; previous images cannot safely write a swap-bearing
ledger. Retain data and stop for explicit compatibility/recovery planning instead of claiming
image rollback reverses schema or ignores economic events.

## Open Questions

No external decision blocks this manual slice. Broader import, automatic reconciliation,
provider history retention, complete portfolio/cash reporting and production readiness
remain open whole-project requirements.
