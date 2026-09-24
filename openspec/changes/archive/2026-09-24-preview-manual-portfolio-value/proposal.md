## Why

Stored USD valuation currently works for one manual account at a time. The owner
needs an exact combined view of selected tracked accounts without treating missing
history or prices as zero or implying that untracked wallets/cash are included.

## What Changes

- Private read-only preview for one to ten explicitly selected manual accounts at
  one UTC instant, using a single PostgreSQL snapshot and exact stored manual prices.
- Per-account coverage and valuation plus a combined priced subtotal. A total is
  available only when every selected account is covered and all holdings are priced.
- Russian account-selection form on the existing manual-accounts page, with exact
  values, missing-data reasons, explicit refresh and protection from late responses.
- Scoped pure/real PostgreSQL coverage and two critical HTTPS API/UI cases.

## Capabilities

### New Capabilities
- `manual-portfolio-valuation`: Exact valuation of an explicitly selected set of manual accounts.

### Modified Capabilities
None. Individual-account valuation, histories, chart range, USD accounting and FX
display contracts remain unchanged.

## Impact

Add a bounded accounting read service/controller and frontend panel, reusing the
existing historical projector and exact-price store. No migration, dependency or
deployment change. Preserve all financial rows, current GHCR/Compose pipeline,
owner Nginx edit and unrelated work.

Non-goals: automatic all-portfolio/net-worth totals, allocation chart, inferred cash,
wallet observations, cross-account reconciliation/transfers, provider requests,
historical FX or chart maximum-period changes. Each selected manual account is
counted once; the owner must select nonoverlapping tracked holdings. This builds on
verified historical-account valuation and does not resolve untracked-data gaps.
