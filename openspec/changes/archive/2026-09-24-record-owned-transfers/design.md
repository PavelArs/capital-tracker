## Context

At6532faa, original-coordinate lot intervals are verified through255unit tests,
retained actualPG trade/carry-in and two HTTPS journeys. Actual transfer commands
are absent. Existing FIFO, CSV and historical stores replay one account; incoming
basis cannot be snapshotted permanently because source corrections must propagate.

The draft received an independent financial/architecture review. Its coverage, fee
labels and allocation paging findings are incorporated in persistence.md and the
delta specs. Executable acceptance and genuine RED are still required before
product implementation. This document is not verification evidence.

## Goals / Non-Goals

**Goals:** persistent internal movements with complete connected replay, original
provenance/intervals, exactly once fee consumption, immutable commands, historical
restatement, CAS/replay safety and Russian review/retry workflow.
**Non-goals:** sending funds, keys/signing, external providers, cash ledger, swaps,
rewards, unknown-cost journal conversion, chain observations, transfer CSV import,
chart periods/layout, production or original-folder consolidation. These remain
in the full goal rather than being declared delivered by this change.

## Decisions

### Economic representation

A command moves one owned instrument UUID between two distinct initialized owned
manual accounts. `quantity` is the amount credited to the receiver. A separately
declared `feeInstrumentId` and `feeQuantity` are consumed from the sender AFTER the
principal debit and BEFORE the receiver credit. Zero fee requires null fee identity;
positive fee may use the principal instrument or another owned held instrument.
No fee is charged to the receiver. The movement is at or after both accounts'
coverageFrom; historical reads at that instant include principal and fee atomically. No synthetic buy/sell or external USD flow.

Fee USD output is the removed historical cost basis, explicitly labelled as such;
it is not an inferred market fee value or tax result. Trade realized P/L stays
separate. Remaining inventory falls by the actual fee quantity, so later valuation
reflects its actual absence. No duplicate fee subtraction from portfolio profit.

Intervals retain originalQ/C/[start,end), origin account and immutable trade/version
or carry-in lot/opening source. A fragment becomes available only upon arrival,
then FIFO sorts by original acquisition instant/order, origin account/kind/id and
range start. Original identity disambiguates equal chronology across accounts.
Repeated/roundtrip movement never rebases cost and never makes holdings available
before arrival. Principal and fee matches expose origin and last-arrival transfer
identity without an ever-growing copied path; full replay reconstructs provenance.

### Shared replay

Refactor the existing buy/sell projector around a small reusable per-account book;
keep old calculateFifo as its compatible wrapper. A connected event runner merges
trades and transfer events by UTCms/order. Equal time/order is forbidden within
any touched account, including both transfer legs. Equal keys in disjoint accounts
commute; deterministic identity tie-breaking is only for these independent events.
Baselines precede covered events, never create trade/flow totals.

Use the shared runner in trade current/mutation, CSV preview/confirm/rollback and
historical state readers; valuation/history/manual-portfolio inherit those exact
positions inside their existing one RR READ ONLY snapshot. Load a connected ledger
once per requested series, not once per point. Old trade/CSV edits replay dependent
accounts and reject any negative prefix; no sender freeze or one-hop restriction.

Keep legacy DTO shapes for accounts without transfer history. Participant journals
and historical results add explicit transfer summaries (basis in/out, fee asset
quantities/basis) and the revision budget. Received lot/match variant is tagged
`sourceKind: transfer` with original provenance/coordinates and latest arrival;
trade-only and baseline variants remain unchanged. Fee matches are separate from
sale matches. Old local trade lists/immutable receipts retain their identities.

### Revisions, concurrency and immutable receipts

Sol's independent architecture review recommends preserving currentRevision as the
shared numeric CAS/read pin. Source trade consumes one tick; CSV source retains its
existing contiguousN range; every other affected connected account receives one tick
in that same transaction. A transfer create/correct/void ticks all affected accounts
once. Void must invalidate union of old/new components, including disconnected nodes.
Old request replay precedes currentCAS/cap and returns unchanged saved receipts.

Local versionCount counts actual persisted trade versions, not passive invalidation
ticks. Explicitly expose/document the10000 JOURNAL REVISION budget for participants:
a passive tick consumes capacity and can block a connected write earlier than10000
local versions. Preserve the local1000active-trade and10000saved-version upperbounds;
do not silently present revision usage as local saved versions. All affected revision
budgets are checked before writes. Saved trade/CSV receipt ordinal ranges remain
unchanged, with legal gaps after transfer/remote invalidations. Existing CSV preview
hash includes currentRevision, so upstream changes invalidate old previews naturally.

Acquire an owner-scoped pg_advisory_xact_lock before ANY economic account-row lock
in trade/carry-in/CSV/transfer and legacy opening mutation paths. Lock involved account rows in sorted
UUID order. Read current committed state after lock acquisition; no global manager
escape. Existing race acceptance must witness both advisory and row waits where
applicable, not merely lower its expected contender count. Reads use one snapshot.

### Additive persistence and routes

Additive migration20 adds owner transfer journal, transfer identities/heads and
complete immutable versions; same owner/account/instrument compositeFKs, finite
numeric/time checks, unique owner/request and owner/journal revision, deferred head
integrity, terminal void and explicit downgrade refusal. Existing rows unchanged.
Store commands only, no derived cost fragments. Account pair is fixed on identity;
correction may change instrument/time/order/quantity/fee. Other identity pairs require
a separate reviewed movement, avoiding hidden topology edits through correction.

Private routes: POST /accounting/transfers; POST /:id/corrections and
/:id/voids; GET /transfers (pinned owner-transfer-journal paging of current command
heads), /:id/versions (immutable history), /:id/allocation (current-effective derived
principal/fee provenance with source/destination account revisions). Structural400,
foreign/notfound404, stale/cap/history409; normal owner/MFA/CSRF/origin/no-store.
Exact payload/replay, transfer version, dual accountCAS and allocation paging fields
are fixed in persistence.md. Allocation pages return at most100 rows, require both
account pins after page0 and never expose only a page subtotal.

Owner transfer journal counts at most1000active transfers/10000versions. Affected old/new union and
read component limits:32accounts,10000active trades total,
100carrylots/account,1000active transfer events,100000allocation matches during replay.
Reject capacity explicitly with409, never truncate a financial result. Each old
and candidate replay separately counts principal, fee and sale matches before
appending, stopping before the bound. Existing unconnected maxima remain valid.

### Russian workflow

Dedicated protected page avoids resetting an unrelated trade draft. Explain that
this records an ALREADY performed owned transfer and sends no funds. Explicitly
load/review both account journal states, select instrument and optional fee asset,
UTC/order/credited quantity, attest ownership/internal movement and save. Freeze the
submitted command/requestId after ambiguous transport failure; explicit retry sends
the identical command and treats its immutable receipt separately from current state.
Correction/void requires review of current transfer version and both account revisions.
Show exact recorded data and separately refreshed allocation/fee basis, provenance,
and links to account views. No localStorage, automatic submit or provider request.

## Acceptance oracles

1. A buys1for100 and1for200. Transfer1.5 A->B plus same-asset fee0.1 leaves A0.4/basis80,
   B1.5/basis200 and fee0.1/basis20; trade gain/external flows unchanged. B sells1.2for360:
   consumed basis140, realized220, B0.3/basis60. Correct A's first buy to120: linked sale
   basis160/realized200, remaining bases unchanged, new pins and old receipts unchanged.
2. Q3/C1atom, move2 then return1: original intervals survive. Sale of returned prefix
   still consumes0basis before final original tail1atom; every atom conserved.
3. Older A lot arrives at B AFTER B's earlier sale: that earlier sale uses B's own
   inventory; a later sale consumes the received older lot before newer B inventory.
4. Transfer chains, same-ms ordering, different fee UUID/same symbol, insufficient
   fee holdings, historical prefix deficit, stale dualCAS and connected cap refusal.
5. Source CSV correction/rollback propagates or refuses atomically; pinned recipient
   page/CSV preview becomes409; real RR read during a committed correction stays coherent.
6. Actual separate PostgreSQL races/replay/deferredCOMMIT rollback and existing row
   preservation; additive fresh20/populated19 migration/replay/downgrade refusal.
7. Two HTTPS cases: real protected API financial/private boundaries and Russian
   create/review/correction/void/retry journey. Keep math/graph permutations below E2E.

## Risks / Trade-offs

Connected replay expands critical accounting scope. Bound input/derived work, retain
unchanged financial/security assertions and verify migration+realPG+selectedHTTPS.
No approximation or silent partial component. Source correction can fail because a
recipient would go negative or its revision budget is exhausted; explain both honestly.
Current prices/market fee values remain explicit gaps; this records known-cost journals.

Wire DTOs and bounds are in persistence.md. Independent review accepted the financial
oracles and required coverage of BOTH accounts, explicit feeConsumedBasisUsd wording
and allocation paging; all three are included. No implementation before actual RED;
no archive until required verification passes.
