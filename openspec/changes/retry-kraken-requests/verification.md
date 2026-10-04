# Verification: retry-kraken-requests

Local sandbox, 2026-10-04, branch based on main 00df0e4. Node 26.10.0, pnpm 12.9.1,
PostgreSQL 16 (CI uses 18). Kraken and CoinGecko are unreachable from the sandbox; the
probe uses the repository's local provider stub.

## RED

`pnpm --dir backend exec jest src/prices/price-providers.spec.ts` with `KrakenClient`
accepting the new `retryPauseMs` option but not yet using it: 5 failed, 28 passed.

- PRC-RETRY repeats a pair that failed once and keeps its price (ETH missing, 2 requests instead of 3).
- PRC-RETRY repeats a daily request that failed once (failure returned after 1 request).
- PRC-7 waits between requests and before a retry (no retry request).
- reports an asset that fails while keeping the others (each failing pair asked once, not twice).
- reports a failed daily request (1 request instead of 2).

"PRC-RETRY never repeats an unreadable answer" already passed, as expected.

## GREEN

- `pnpm --dir backend test --runInBand`: 70 suites, 1794 tests passed.
- `pnpm --dir backend lint`: no errors; the touched files keep their one existing warning (`noPrototypeBuiltins` in `CoinGeckoClient`).
- `pnpm --dir backend build`: passed.
- `tests/e2e/prices-db.cjs` on local PostgreSQL 16: 13 of 13 PASS, including PRC-FALLBACK (each failing Kraken pair now requested twice before CoinGecko) and PRC-BACKFILL-RETRY (failed ETH daily request retried once in the same run).
- `tests/e2e/migrations.cjs` on local PostgreSQL 16: PASS (no migration in this change).
- `node scripts/acceptance-shards.test.cjs`: 59 passed.
- `OPENSPEC_TELEMETRY=0 pnpm exec openspec validate --all --strict --no-interactive`: passed.

Hosted CI on the pull request is pending (task 3.2). Release acceptance, including
`prices-db`, runs on main after merge.
