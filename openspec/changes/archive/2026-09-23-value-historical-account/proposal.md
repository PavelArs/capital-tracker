## Why

The owner can reconstruct past holdings and store dated manual prices, but cannot
yet see their combined USD value. A bounded account-level view connects these
verified capabilities while making missing prices explicit.

## What Changes

- Read-only historical account valuation from effective trades/carry-in and manual
  prices at exactly the requested UTC instant, in one database snapshot.
- Exact quantity-times-price arithmetic, complete totals only when every position
  has a price, and an explicitly partial priced subtotal otherwise.
- Russian account-detail review with refresh and stale-response protection.
- Keep existing accounting/price editors, identity, auth and deployment; simplify
  shared snapshot loading through a caller-owned transaction. Remove no feature/data.

## Capabilities

### New Capabilities
- `historical-account-valuation`: Exact, private, database-only point valuation.

### Modified Capabilities
None. Historical accounting and manual price contracts remain compatible.

## Impact

Depends on archived historical-accounting, known-cost-carry-in and manual-usd-prices.
Touches accounting read services, a new GET route, account-detail UI and targeted
tests. No schema, dependency, provider, CI/CD, production or stored-data change.
The inspected GHCR/Compose pipeline remains contained pending release hardening.

Non-goals: all-account aggregation, observed blockchain balances, current-price
fallback, interpolation, charts/ranges, unknown-cost holdings valuation, profit,
XIRR/TWR automation, FX, provider ingestion, migration or project consolidation.
