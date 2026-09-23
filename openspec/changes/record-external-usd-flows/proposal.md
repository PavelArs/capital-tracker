## Why

The exact trade journal reconstructs quantities and FIFO cost, but trades are not
investor cash flows. The target brief requires dated external contributions and
withdrawals before portfolio profit or returns can be computed correctly.

## What Changes

- Add an explicit, owner-scoped journal of external USD contributions/withdrawals,
  with a declared coverage boundary, immutable command receipts, corrections/voids,
  bounded exact period totals and revision-pinned pages.
- Add protected Russian entry/review. Distinguish recorded external USD flows from
  trades, internal transfers, initial holdings, household income and asset balances.
- Add migration17 without altering or backfilling existing financial/authentication
  rows. Existing FIFO, import, opening and historical-position contracts stay intact.
- Verify one critical browser journey and focused privacy/recovery cases through
  real HTTPS/MFA/PostgreSQL; put arithmetic/range permutations and concurrency at
  the appropriate pure/PostgreSQL level instead of expanding every browser matrix.

Non-goals: updating cash/asset balances, in-kind or non-USD flows, fees, transfers,
swaps, rewards, blockchain reconciliation, price/valuation history, profit, XIRR/TWR,
CSV flow import, owner-data migration, dependency/provider/deployment replacement.
Recording a USD declaration alone must not claim any of those capabilities.

## Capabilities

### New Capabilities

- `external-usd-flows`: explicit external cash-flow classification, exact dated
  immutable history, private bounded reads/writes and safe Russian review.

### Modified Capabilities

- `explicit-migrations`: fresh schema now records17 migrations and adds a populated16
  preservation scenario. Existing account/authentication behavior stays unchanged.

## Impact

Reuse NestJS accounting admission, exact decimal/time parsing, PostgreSQL transaction
patterns, existing API client and React components. Use two additive flow tables,
not legacy floating-point asset/income/metrics rows. No new package or service.
This slice follows archived historical-accounting atf69c059. The inspected existing
Compose/Nginx/GHCR pipeline remains; no production operation or folder consolidation.
