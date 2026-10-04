# Hourly market prices verification

Status: implemented; local checks below passed; hosted CI pending on the draft PR.
The change stays active until hosted CI is green on the PR head.

Baseline: main `24c3ce1`, then main `692be87` (PR #38) merged in. Branch
`claude/m3-collect-hourly-prices-ipqvo8`.
Environment: cloud container, Node 22.22.0, pnpm 10.33.0, PostgreSQL 16.14 (local
throwaway cluster), the real `tests/e2e/providers.cjs` stub with a self-signed
certificate. Docker image builds are blocked here, so `pnpm test:e2e` and the
critical profile cannot run locally. The sandbox egress proxy refuses
`api.kraken.com`, `api.coingecko.com` and `docs.kraken.com`, so there was no live
provider call: client parsing follows the providers' documented response shapes
(Kraken OHLC `[time, open, high, low, close, vwap, volume, count]` with the last entry
uncommitted and at most 720 entries; CoinGecko `simple/price` with
`include_last_updated_at`).

## Risk-based check manifest

| Scenarios | Check | Where |
| --- | --- | --- |
| PRC-PARSE | `price-providers.spec.ts` against a real local HTTP server (no axios mock) | local |
| PRC-FALLBACK, PRC-ALTERNATE, PRC-SOURCES (planner), freshness, due rule | `price-collection.spec.ts` with fake providers | local |
| PRC-HOURLY, PRC-FALLBACK, PRC-ALTERNATE, PRC-IDEMPOTENT, PRC-SOURCES, PRC-OFF, PRC-BACKFILL, PRC-BACKFILL-RETRY, PRC-STALE, PRC-APPEND-ONLY, schedule and lock, interrupted source | `tests/e2e/prices-db.cjs`: real PostgreSQL, real migration CLI, requests through `HTTPS_PROXY` to `tests/e2e/providers.cjs` | local, hosted CI |
| PRC-MIGRATION | `tests/e2e/migrations.cjs` (fresh 24, populated 11..21 to 24 preservation and replay) and the probe's `down` refusal; migration counts in every probe | local, hosted CI |
| `GET /prices` session requirement | global `SessionGuard` (no public decorator on the controller); no HTTP E2E in this change because there is no UI | review |

PRC-OUTAGE and the incomplete-total half of PRC-NONE are E2E criteria of the
Dashboard and Portfolio screens and are verified when those screens use prices
(M4/M6/M16).

## RED before behavior (commit 5f243c0)

The prices module had the routes, migration, catalog and signatures but no behavior.

- Jest `src/prices`: 41 failed, 1 passed of 42. Failures are assertion failures, e.g.
  Kraken `quotes: []` instead of the 84945.1 candle close, `primaryProvider` returning
  `kraken` for an odd hour, freshness `none` for a fresh instant. The one pass is
  `freshness(null)` = `none`, which the stub happened to return.
- PostgreSQL probe: migrations applied 24, then 0; PRC-MIGRATION passed (the migration
  was real), then `AssertionError: No price is null, never 0` because the stub read
  returned no assets.

## GREEN (commit fdc0ced, then review fixes)

- `pnpm --dir backend test --runInBand`: 63 suites, 1669 tests passed (after review fixes).
- `pnpm --dir backend lint`: no errors (77 existing warnings in unrelated files).
- `pnpm --dir backend build` and `tsc --noEmit`: passed.
- `tests/e2e/prices-db.cjs`: every stage PASS (PRC-MIGRATION, PRC-OFF, PRC-HOURLY with
  641 closed days x 8 assets backfilled, PRC-IDEMPOTENT, PRC-ALTERNATE, PRC-FALLBACK,
  PRC-SOURCES, schedule and lock, PRC-APPEND-ONLY, interrupted source, PRC-STALE,
  PRC-BACKFILL-RETRY, and after review the midnight daily/hourly coexistence stage).
- `tests/e2e/migrations.cjs`: exit 0, 16 PASS lines including populated 13/14/15/16/18/21
  to 24.
- Count-bump spot checks: `wallet-addresses-db`, `display-fx-db` (with
  `DISPLAY_FX_TRUST_PROXY=true`), `owned-transfers-db`, `asset-rewards-db`,
  `manual-usd-prices-db` passed.
- `openspec validate collect-hourly-prices --strict`: valid.

## Independent review

A separate review context read the whole diff (no edits). Findings and outcomes:

1. High: the primary key lacked `kind`, so yesterday's daily close and the 23:00 hourly
   close (both at midnight) collided and `ON CONFLICT DO NOTHING` dropped one; the probe
   would also fail between 00:00 and 01:59 UTC. Fixed: `kind` is in the primary key;
   new probe stage stores both at today's midnight.
2. Medium: the due check ran before the lock, so two processes could run the same hour
   back to back. Fixed: `tick` decides due-ness under the lock.
3. Low-medium: a tick seconds after the hour could run before the previous candle
   closed. Fixed: due no earlier than five minutes past the hour (unit-tested).
4. Low: Kraken public throttling (`EGeneral:Too many requests`) read as `unavailable`.
   Fixed and unit-tested as `rate_limited`.
5. Low: a failed session unlock could return a pooled connection still holding the lock.
   Fixed: transaction-scoped advisory lock released by rollback or connection end.
6. Tests: the concurrency check depended on timing; replaced by a deterministic stage in
   which another connection holds the lock (`busy`, no provider request), then frees it.
   `GET /prices` over HTTP remains uncovered here (no UI yet); the first screen that
   reads it (M4) adds the HTTP/E2E check.

## Unrun checks

- Playwright E2E and the critical profile: hosted CI only.
- Remaining PostgreSQL probes with only a count change: hosted CI only.
- No live Kraken or CoinGecko call (sandbox egress); the first live run happens after
  the owner deploys this change (production Compose sets `PRICE_COLLECTION_ENABLED`,
  guarded by `price-deployment.spec.ts`).

## Provider coverage

All eight catalog assets have a Kraken USD pair (`XBTUSD`, `ETHUSD`, `SOLUSD`,
`ZECUSD`, `TRXUSD`, `XLMUSD`, `USDTUSD`, `USDCUSD`) and a CoinGecko id (`bitcoin`,
`ethereum`, `solana`, `zcash`, `tron`, `stellar`, `tether`, `usd-coin`) according to
the providers' published listings; not confirmed live from this sandbox. Any asset a
provider stops serving shows as `missing_assets` in its sync source and is taken from
the other provider.
