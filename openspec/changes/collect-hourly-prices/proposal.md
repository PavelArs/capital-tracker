## Why

The new Personal Capital Tracker values the whole portfolio and draws its history
chart from prices kept in the app's own database, so history does not depend on any
provider staying available (BR 5, 16; PR-PRC-1..3, PR-SYN-1; change M3 in
`docs/product-requirements.md`). Today the legacy `crypto-prices.service` keeps
CoinGecko prices in memory only, and production runs with background jobs disabled.

## What Changes

- A fixed market catalog for the MVP assets: BTC, ETH, SOL, ZEC, TRX, XLM, USDT and
  USDC, each with its Kraken pair and CoinGecko id, quoted in USD.
- Two keyless free providers behind one interface: Kraken public OHLC (the last
  closed hourly candle) and CoinGecko `simple/price` (an optional free Demo key is
  sent when configured). Each hour the primary provider alternates (even UTC hours
  Kraken, odd hours CoinGecko); assets the primary does not deliver are asked from
  the other provider.
- New append-only table `price_observations` (asset, quote currency, price,
  observed at, source, kind, fetched at), unique per asset, quote currency, source
  and observed instant; replays add nothing and rows can never be updated or deleted.
- One-time backfill from 2025-01-01 from Kraken daily candles (owner decision Q3/Q4;
  CoinGecko is not used for history).
- New table `sync_sources` with one row per background source (`prices:kraken`,
  `prices:coingecko`, `prices:backfill`): state, last attempt, last success, error
  code and readable message, next run. One failing source never blocks another.
- `GET /prices`: the latest price per catalog asset with its freshness (`fresh`
  up to 2 hours old, `stale` when older, `none` when never observed, never 0) and the
  price sources' states. This is the read model the later Portfolio, Dashboard and
  "prices unavailable" states use.
- Switch `PRICE_COLLECTION_ENABLED` (default `false`), independent of
  `BACKGROUND_JOBS_ENABLED`, so prices can run without the legacy jobs.

## Non-goals

- No UI change; the Dashboard chart, Portfolio values and "updated 3 h ago" badges
  come in M4/M6/M16 (PRC-OUTAGE and the incomplete-total part of PRC-NONE are E2E
  criteria of those screens).
- No Bank of Russia fiat rates (M5) and no use of prices in valuation yet (M4).
- No change to the production Compose file or release scripts; turning collection
  on in production is a separate, owner-approved deploy configuration step.
- Legacy `crypto` module, manual USD prices and display FX keep their contracts.

## Capabilities

### New Capabilities
- `market-prices`: hourly provider prices with alternation and failover, append-only
  storage, daily backfill, per-asset freshness and per-source sync status.

### Modified Capabilities
None.

## Impact

- Backend: new `prices` module (catalog, Kraken and CoinGecko clients, collection
  planner, service, controller), one additive migration
  `1790800000000-AddHourlyPrices`, two optional environment variables.
- Data: two new tables only; no existing row, table or constraint changes.
- Tests: Jest unit tests for clients and planner, real PostgreSQL probe
  `tests/e2e/prices-db.cjs` through the provider stub, migration probe counts.
- Dependencies: change M2 (`classify-assets`) will link an asset to a catalog code;
  this change does not depend on its schema.
