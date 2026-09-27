## Why

Account analytics currently stacks three similar date forms, repeated methodology
and long metadata before useful results. The owner requested a complete functional
frontend redesign; the next coherent step is choosing one analysis task and reading
its exact results with clear scope and usable mobile tables.

## What Changes

- Add a native analysis selector: valuation at a date initially, sampled value history,
  or accounting positions. Keep all original read controllers mounted and independent.
- Associate concise UTC/exact-price/sampling guidance with fields; disclose longer
  methodology while retaining visible limits and completeness distinctions.
- Put exact valuation totals/positions and chart/history evidence ahead of secondary
  provenance; preserve every exact value, unknown/zero distinction and version field.
- Unify scoped responsive styles and named keyboard-scroll regions for wide tables.

## Capabilities

### New Capabilities

- `account-analytics`: focused account analysis selection, retained intent and readable
  exact evidence across responsive themes.

### Modified Capabilities

None. Existing workspace retention, historical accounting, valuation and chart
calculation/security requirements remain unchanged.

## Impact

Depends on c3a4dbd and existing AccountWorkspace/TradeJournal integration. Affects their
analytics composition, the three read-tool presentations/styles, and relevant existing
browser journeys. No migrations or data edits; no backend/API/auth/provider/dependency
changes. Production pipeline inspected and retained in its manually gated state.
No chart algorithm, point/range-limit expansion, portfolio aggregate, provider collection,
production/preview deployment or project consolidation in this change.
