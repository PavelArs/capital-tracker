## Why

The owner wants to see what the whole portfolio is worth now and what each asset has
earned, without choosing accounts first and without typing prices by hand (BR 3, 11;
PR-VAL-1..3; change M4 in `docs/product-requirements.md`). Today valuation exists only
for explicitly selected manual accounts at an exact instant with manual prices
(`manual-portfolio-valuation`), and the Portfolio section lists asset classifications
without quantities or values. M2 classified every asset with a price source and M3
collects hourly market prices, so the pieces now exist to value everything.

## What Changes

- `GET /accounting/portfolio`: one read-only valuation of every owned manual account at
  the current instant. Per asset across all accounts: quantity, price with its source
  and freshness, value, allocation share, cost basis, average buy price (cost of the
  remaining known-cost FIFO lots divided by their quantity), unrealized P&L and realized
  P&L (FIFO sales and swaps, Q2), plus the holding in each account.
- Valuation rule from the product model: a `market` asset uses the latest stored
  observation at or before now from any provider (stale after 2 hours, still used and
  marked); a `manual` asset uses its latest manual USD price at or before now; USD cash
  is worth 1; EUR and RUB cash and anything without a price are "no price" (EUR/RUB
  rates arrive in M5). Missing is never zero: the total becomes incomplete and the
  priced subtotal is reported separately.
- Totals: value, cost basis, unrealized and realized P&L; allocation by asset, by asset
  type and by account.
- Portfolio screen: summary (current value, cost basis, unrealized and realized P&L),
  allocation card with grouping by asset, type or account, and the assets table
  (amount, price, value, allocation, average buy price, unrealized P&L) with the type
  filter and "Add asset" from M2.
- Asset details screen `/portfolio/:assetId`: price and its freshness, amount, value,
  average buy price, cost basis, unrealized and realized P&L, an unknown-cost note and
  holdings per account.

## Non-goals

- No EUR/RUB accounting or main-currency setting (M5); everything is in USD.
- No snapshots, charts or period change (M6, M7); no operations list on the asset page
  (M8); no dashboard (M16).
- Wallet-address chain transactions are not holdings yet (M10–M12): only the manual
  account journals are valued, as today.
- No schema change and no migration. The legacy valuation endpoints and screens keep
  their contracts.

## Capabilities

### New Capabilities
- `portfolio-valuation`: whole-portfolio valuation with automatic prices, per-asset
  cost basis, average buy price and P&L, allocation, and the Portfolio and Asset
  details screens.

### Modified Capabilities
- `asset-classification`: AST-3 Portfolio list now shows valued holdings instead of a
  classification-only table.

## Impact

- Backend: new `portfolio-valuation` projection, price store, service and controller in
  the accounting module; the market price read is shared with `GET /prices`.
- Frontend: Portfolio page rewritten on the new endpoint; new Asset details route.
- Tests: Jest projection acceptance, frontend component tests, real PostgreSQL probe
  `tests/e2e/portfolio-valuation-db.cjs` (critical shard), critical browser case
  `PORTFOLIO-UI`, SHELL-UI updated for the new table.
- Data: none; reads only.
