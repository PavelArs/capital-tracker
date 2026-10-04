## Why

The first production collection after the M3 deploy (v2026.10.04-af107d8, 2026-10-04
20:53Z) stored current prices for every asset, but the one-time Kraken daily backfill
failed for ETH, ZEC, XLM and USDC (`prices:backfill` failed, `unavailable`, "No history
for ETH, ZEC, XLM, USDC"). Those are exactly the second, fourth, sixth and eighth of the
eight back-to-back requests, and the same pairs answered the hourly requests a few
seconds later. The same run's hourly Kraken read also missed USDT, which CoinGecko then
supplied. Kraken answered some requests sent 1.1 seconds apart with a failure; the exact
provider answer is not recorded, so the cause (throttling or a dropped connection) is
inferred from the pattern. The backfill already retries failed assets in the next
hourly run, but every run that crosses a transient Kraken failure loses that asset's
Kraken price for the hour.

## What Changes

- Kraken requests are sent at least 2 seconds apart (was 1.1).
- A Kraken request that fails with `rate_limited` or `unavailable` is repeated once
  after 5 seconds; only a second failure counts as a failure. Malformed answers
  (`invalid_response`) are not repeated.
- Nothing else changes: CoinGecko, storage, sync status and the backfill rules stay.

## Capabilities

### Modified Capabilities
- `market-prices`: new requirement PRC-7 (Kraken pacing and one retry).

## Impact

Backend `KrakenClient` only. No API, schema, migration or configuration change. An
hourly Kraken read takes at least 14 seconds instead of about 8, plus 5 seconds per
retried pair.
