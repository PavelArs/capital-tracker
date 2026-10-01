## Why

The manual-price page mixes instrument selection, long result history and a distant editor, while row actions do not guide keyboard focus to their review panel. The required frontend redesign needs a direct entry workflow with accessible exact-price evidence and safe explicit recovery.

## What Changes

- Put the editor after instrument selection and visible recovery/status messages, before saved-price/history evidence.
- Keep manual/unreconciled/isolated-point scope visible and expose full rules through a native disclosure; associate UUID/time/exact-price guidance with fields.
- Guide void/history actions to the corresponding heading; cancel/close returns to the initiating live enabled control, and closing history invalidates pending reads.
- Retain real table semantics with contained keyboard scrolling and restrained responsive light/dark presentation.

## Capabilities

### New Capabilities

- `manual-price-workbench`: focused manual price entry, predictable review/history navigation and responsive exact evidence.

### Modified Capabilities

None. Existing manual-usd-prices accounting, immutable history, private API, revision and recovery requirements remain unchanged.

## Impact

ManualPrices.tsx/CSS and the existing PRICE-UI/PRICE-RECOVERY acceptance journey. Depends on archived manual prices/application shell. Non-goals: backend/API/auth, provider collection, valuation calculations, dependencies, data/migrations, production/preview rollout or consolidation. Preserve all existing rows, owner Nginx edit and durable preview.
