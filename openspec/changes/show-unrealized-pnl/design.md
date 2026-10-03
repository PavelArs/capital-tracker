## Context

`projectValuation` (backend/src/accounting/historical-valuation.ts) values positions
from `projectHistoricalFifo` with exact bigint arithmetic: quantities, prices and
costs are scale-30 decimals, values are scale-60 products. Account valuation and the
selected-accounts preview both call it; valuation history calls it too but drops
items and must stay unchanged.

## Goals / Non-Goals

Goals: add the difference between value and FIFO cost, and its ratio, wherever a
position value is already shown; keep amounts exact and gaps explicit.
Non-goals: see proposal. No new endpoint, query parameter, table or provider.

## Decisions

1. **Separate pure projection.** `projectUnrealized(valuation)` takes the result of
   `projectValuation` and returns it with per-item and total unrealized fields.
   Account valuation and the selected-accounts projection call it; valuation history
   keeps calling `projectValuation` alone, so its response is untouched.
   Alternative (extend `projectValuation`) would leak fields into VCH points.
2. **Exact signed difference.** value (scale 60) minus cost (scale 30 lifted to 60),
   formatted by a new signed scale-60 formatter in `money.ts`. Existing
   `formatProduct` is unsigned and stays as is.
3. **Return rounding.** The ratio is non-terminating in general, so it is a display
   figure: bigint division, half away from zero, two fixed fractional digits
   (matching the spreadsheet's -21.99 %). Zero cost gives null, never infinity.
4. **Unknown cost is null, not partial.** `HistoricalPosition.costUsd` is already null
   when any held quantity lacks basis. Using `knownCostSubtotalUsd` would overstate
   profit, so the item result is null and `unknownCostCount` explains it.
5. **Totals all-or-nothing.** Like `totalValueUsd`, totals exist only when every
   contributing item has a result. Partial unrealized sums are not returned because
   they read as complete profit figures.
6. **UI reuses backend strings.** No client arithmetic on money; the view only picks
   labels and the explanation for nulls.

## Risks / Trade-offs

- Response shape grows: strict-key E2E assertions for VAL-API and MPV-API are updated
  to include the new keys with exact expected values (assertions are extended, not
  relaxed).
- Rounded percent can differ from a spreadsheet that rounds differently at the third
  digit; the exact USD difference stays authoritative.

## Migration Plan

None: additive read-only fields. Rollback is reverting the code; no data to restore.
