## Why

The owner can inspect one historical account valuation but cannot compare dates.
A bounded database-only series and chart make stored history useful without
claiming continuous price coverage or querying external providers.

## What Changes

- Private account valuation series for a custom range up to30 days, sampled at
  the start, every24 hours, and the exact end, with at most31 points.
- Exact totals and explicit missing-price counts/partial subtotals in a Russian
  table; a scatter chart renders only complete points without interpolation.
- One coherent database transaction, loading the ledger once and batching price
  reads, reusing existing accounting and exact valuation arithmetic.

## Capabilities

### New Capabilities
- `account-valuation-history`: Bounded historical account series and honest chart.

### Modified Capabilities
None. Existing point valuation, accounting and manual price contracts stay intact.

## Impact

Depends on historical-account-valuation, historical-accounting and manual-usd-prices.
Keep Chart.js already installed, existing React/Nest modules, price storage and
auth. Simplify caller-owned batch reads. Remove nothing. No migration, data rewrite,
provider, dependency, deployment or original-project consolidation change. Existing
GHCR/Compose containment was inspected and remains unchanged.

Non-goals: automatic prices/backfill, continuous coverage, all-account wealth,
cash/profit/returns, FX, zoom, long-range resolution presets or today's-balance
backcasting. Later changes can expand range/resolution with measured bounds.
