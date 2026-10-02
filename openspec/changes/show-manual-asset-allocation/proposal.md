## Why

The selected manual-account valuation shows an exact total but requires opening individual accounts to see how that value is distributed among instruments. An allocation table can expose that distribution using the same bounded, exact-instant evidence without implying whole-portfolio coverage.

## What Changes

- Add an instrument-UUID aggregate allocation array to the existing private selected-account valuation response.
- Show quantities, exact USD values, and two-decimal percentage shares in a Russian table beside the existing account summary.
- Keep unknown prices and incomplete coverage visible: an unpriced instrument has unknown value, and any incomplete or zero-total preview has unknown percentages for every row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `manual-portfolio-valuation`: extend the selected manual-account snapshot and UI with an exact instrument allocation, preserving existing scope and provenance.

## Impact

Additive response contract in `backend/src/accounting/manual-portfolio-valuation.ts`, corresponding frontend API type and valuation view/table. No new endpoint, data migration, dependency, provider call, cash inference, automatic pricing, wallet integration, whole-portfolio claim, or deployment change. Depends on the existing selected-account preview and exact money helpers.
