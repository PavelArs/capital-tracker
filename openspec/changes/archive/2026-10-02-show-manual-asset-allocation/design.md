## Context

The existing preview loads one selected set and exact-time prices in one read-only repeatable-read snapshot. `projectManualPortfolioValue` already computes per-account rows and an aggregate with scale-30 input atoms and scale-60 products. The new table is a view of this same selected manual subset.

## Goals / Non-Goals

**Goals:** An additive, deterministic instrument-UUID allocation contract with exact quantities and values, honest unknowns, and accessible Russian display.

**Non-Goals:** All-account or whole-portfolio coverage, observed balances, cash, new prices, providers, persistence, migrations, new routes or client-side financial arithmetic.

## Decisions

1. Build allocation from the covered accounts' existing projected position rows. Group by instrument UUID, summing quantities as scale-30 `bigint` atoms and values as scale-60 `bigint` products. Format with existing `formatAtoms` and `formatProduct`. Preserve the row's existing name and symbol as display metadata. Sort rows lexically by UUID. This avoids a second SQL read and shares the valuation's selected positions and price provenance. An independent backend aggregation from raw positions would duplicate price matching; frontend aggregation would move accounting into the browser.
2. Return top-level `allocation` with `instrumentId`, `instrumentName`, `instrumentSymbol`, `quantity`, `valueUsd`, and `allocationPercent`. A row's value is null if any constituent position lacks an exact price; zero saved prices remain known zero. Unknown account history produces no synthetic rows. This is additive to the existing response and leaves all per-account fields intact.
3. Calculate percentages only when the existing aggregate is complete and has positive value. Both numerator and denominator are scale-60 integers. Compute hundredths of a percent by `value * 10000 / total`, incrementing on a remainder of at least half the denominator. Format exactly two fractional digits. Independent half-up rounding can leave a displayed sum just above or below 100.00; no balancing mutation is made.
4. Render a semantic table under the current account table. The API supplies all financial values and shares as strings. The view formatter only substitutes Russian labels for null values. This preserves the existing asynchronous intent guard because allocation is within the same report object.

## Risks / Trade-offs

- Same UUID with inconsistent display metadata would take the first selected projected row. The UUID remains the identity; the database's instrument catalog supplies consistent metadata within the snapshot.
- An unavailable account may hide instruments, so percentages are null for every visible row. The table retains the selected-subset caveat and existing history counts.
- The 1..10 account bound and existing position caps bound grouping work. No external quota changes.

## Migration Plan

No schema or dependency change. The new response field is additive. Reverting the code restores the earlier preview contract; no data rollback is needed. Existing full-session, MFA, CSRF, no-store and owner checks remain at the existing endpoint. No production or Docker action in this change.

## Open Questions

None for the bounded selected-account view.
