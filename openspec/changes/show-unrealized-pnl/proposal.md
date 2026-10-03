## Why

The owner tracks each purchase in a spreadsheet with "current value", "difference"
and "return %" columns. The app already reconstructs FIFO cost basis and values
positions with exact-time manual USD prices, but never shows their difference, so
the owner cannot see unrealized profit or loss without leaving the app.

## What Changes

- Account valuation (`GET /accounting/accounts/:id/valuation`) adds, per position,
  exact `unrealizedPnlUsd` (value minus remaining FIFO cost) and a rounded
  `unrealizedReturnPercent`, plus account totals and an `unknownCostCount`.
- Selected-accounts valuation (`POST /accounting/manual-valuation-preview`) adds the
  same fields per position, per account and for the selected aggregate.
- Missing exact price or unknown cost yields `null`, never a guessed number; a total
  exists only when every position has both value and known cost.
- Russian UI shows the new columns and totals in the account valuation form and the
  selected-accounts panel, using the owner's spreadsheet vocabulary.
- Additive response fields only; no existing field changes meaning.

## Capabilities

### New Capabilities
- `unrealized-profit-loss`: exact unrealized P&L and rounded return for valued positions, accounts and selected-account aggregates.

### Modified Capabilities
None. VAL and MPV requirements remain true; their responses gain additive fields
defined by the new capability. Valuation history (VCH) is unchanged.

## Impact

Depends on `historical-account-valuation`, `manual-portfolio-valuation`,
`historical-accounting` and `manual-usd-prices`. Backend: pure projection in
`backend/src/accounting`, used by the two existing valuation services. Frontend:
`HistoricalValuation.tsx`, the selected-accounts panel and their API types.

Data impact: none. No migration, schema change, stored row, provider call or new
dependency. Reads stay in the existing read-only REPEATABLE READ snapshots.

Non-goals: automatic or "latest" prices, per-asset aggregation across accounts,
per-lot (per-purchase) rows, realized/unrealized combined totals, FX display of the
new amounts, address import and spreadsheet import. Those follow as separate changes.
