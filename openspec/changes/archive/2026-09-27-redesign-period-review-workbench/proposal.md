## Why

The period-profit page makes the owner pass long method explanations and an always-expanded secondary TWR editor to inspect a simple reviewed calculation. The required frontend redesign needs a compact, readable hierarchy without changing the meaning or precision of any metric.

## What Changes

- Keep manual/unreconciled/temporary scope visible; move full method explanations into native keyboard-accessible disclosure.
- Group existing period/valuation inputs and distinguish profit, annualized XIRR and period-only TWR actions/results. Lead results with the exact metric and retain all evidence and unavailable reasons.
- Make the mounted linked-TWR workflow available on demand without losing its boundary values, review, result or in-flight invalidation safeguards when only its disclosure is toggled.
- Apply restrained responsive light/dark presentation and keyboard-contained boundary tables.

## Capabilities

### New Capabilities

- `period-review-workbench`: focused reviewed period input, distinct exact result hierarchy and retained on-demand linked-TWR workflow.

### Modified Capabilities

None. Existing profit/XIRR/endpoint-TWR/linked-TWR financial, privacy and stale-read contracts remain unchanged.

## Impact

Frontend PeriodProfit.tsx/CSS and LinkedTwr.tsx plus extensions to existing selected acceptance journeys. Depends on archived period-preview capabilities and application shell; no backend/API, dependencies, data, migrations or deployment changes. Non-goals: new metrics, automated valuations, chart maximum-period expansion, whole-portfolio implementation, production/preview rollout or consolidation. Preserve owner Nginx edit and all existing user/preview data.
