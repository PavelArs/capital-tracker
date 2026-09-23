## Why

Exact opening balances do not establish acquisition chronology or realized results.
The next useful accounting slice must record actual USD buys and sells and prove
FIFO on known history before introducing CSV import into that model.

## What Changes

- Add an owner-attested empty-origin journal to eligible manual accounts, with an
  explicit coverage instant. Absence of an opening alone never implies zero holdings.
- Record manual USD spot buys/sells with exact quantities, actual gross USD totals,
  separate USD fees and explicit same-instant execution ordering. No fiat balance
  or external cash-flow classification is inferred from those legs.
- Derive inspectable FIFO matches, remaining quantities/cost and realized journal
  results using bounded exact integer arithmetic and documented cumulative allocation
  at the existing 30-decimal quantum. Retain every rounding remainder in its lot.
- Preserve trade identities and immutable complete correction/void revisions;
  recompute candidate history atomically and refuse any negative historical prefix.
  Keep request replay, optimistic journal revisions and bounded private reads.
- Add Russian protected journal forms and honest eligibility/coverage/precision
  labels. Existing opening accounts stay intact and explicitly lack FIFO support
  until a separate carry-in-lot/provenance contract exists.
- Guard opening writes once an explicit journal depends on its empty origin; resolve
  initialization/opening races on the same account lock.

Non-goals: CSV, opening-to-lot conversion, legacy balance conversion, swaps, token/FX
fees, transfers, cash balances, external flows, price/valuation, portfolio returns,
AI, dependencies, production rollout or folder consolidation. They remain later work.

## Capabilities

### New Capabilities

- `usd-fifo-trades`: Exact owner-scoped USD executions, inspectable FIFO, immutable
  corrections, explicit empty-origin coverage and deterministic fee/allocation rules.

### Modified Capabilities

- `manual-opening-positions`: Refuse opening writes after journal initialization;
  keep prior opening history and disclose dependent journal eligibility in the UI.
- `explicit-migrations`: Add one data-preserving journal migration after the verified
  thirteen-migration predecessor and rehearse populated upgrade/replay.

## Impact

A narrow accounting trade service and pure atom/FIFO helpers, additive persistence,
existing protected account UI integration, independent arithmetic and PostgreSQL
race/rollback tests, and real HTTPS Playwright. Reuse current exact-input/session/CSRF
boundaries and manual UUID identities. Introduce no provider calls, paid service,
package or generic event framework.

Implementation depends on verified archive of record-manual-opening-positions.
This proposal is prepared in its own worktree while that predecessor's 85-case
release-image verification runs. No trade implementation or owner data change is
authorized by preparing artifacts; the next behavior still requires actual RED.
