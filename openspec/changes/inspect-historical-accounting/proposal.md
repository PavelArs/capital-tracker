## Why

The current account view calculates only the latest FIFO state. Target brief §9 also
requires historical holdings reconstructed from opening states and operations, with
old corrections reflected reproducibly. A small read-only account snapshot supplies
this foundation without claiming market value or investment performance.

## What Changes

- Add a protected, bounded account snapshot at an explicitly selected UTC instant,
  using current effective trade versions and the immutable journal baseline.
- Return exact quantities and remaining FIFO cost per instrument, plus cumulative
  journal totals through the selected instant. Include coverage and revision so the
  owner can distinguish reconstructed accounting from observed balances.
- Include executions at the selected instant. Refuse dates before coverage and
  accounts without an initialized journal rather than presenting unknowns as zero.
- Add a Russian account-detail view with explicit date selection, stale-response
  handling and revision-pinned pagination; preserve existing editing workflows.
- Non-goals: prices/FX, charts, market valuation, period profit, returns, external
  flows, transfers/swaps/rewards, unknown-cost disposal, baseline amendment, exports,
  providers, production release and final repository consolidation.

## Capabilities

### New Capabilities

- `historical-accounting`: Read a restated account accounting snapshot at an instant
  inside known journal coverage, with exact FIFO amounts and bounded coherent pages.

### Modified Capabilities

None. Existing journal, carry-in, CSV, opening and authentication contracts remain
unchanged; this adds a read-only projection and UI.

## Impact

The backend reuses the journal store and pure FIFO engine; the frontend adds a
read-only account section. Acceptance uses actual HTTPS authentication, application
and PostgreSQL. There is no schema migration, dependency, provider or deployment
change and no owner-data rewrite. Implementation depends on verified archival of
`seed-known-cost-carry-in`; preparation can proceed in an isolated worktree while
that release gate runs. Final consolidation remains governed by the existing plan.
