# Purchase currency verification

Status: local RED/GREEN, real PostgreSQL probes and independent review ran in a cloud
sandbox. Hosted CI (critical browser acceptance including PCUR-UI, release image gate) is
the authority for the browser case and is recorded below once it runs.

Base: `main` at `f63be8cffa20139e6e4112f4b75639637c9d581b` (after #31). Node 22.22.0
(engine range `>=22.21.1 <23`), pnpm 10.33.0, OpenSpec 1.2.0, local PostgreSQL 16.14.
One additive migration (`AddTradePaymentRecords1790500000000`, migration 24). No
dependency, lockfile, image or `frontend/nginx.conf` change.

## Check manifest

| Scenario | Checks |
|---|---|
| PCUR-MIGRATE | `purchase-currency-db.cjs` (fresh 24, FK 23503, CHECK 23514, down refuses); `migrations.cjs` populated13..21-to24 row/schema preservation with the new table empty; every other probe's migration count and fingerprint |
| PCUR-SHAPE | Backend unit projection (no `payment` key for USD, canonical strings for RUB); probe read-back of journal and versions |
| PCUR-RUB | Backend unit (file-wide RUB, decimal-comma rate cell and setting); probe confirm, exact payment row, FIFO cost, changed rate → 409, rollback void keeps the payment; critical PCUR-UI |
| PCUR-MIXED | Backend unit (USD without payment, USDT at 1, RUB 30000 at 77.9568, USD rate 1); probe confirm |
| PCUR-ERRORS | Backend unit (missing/invalid currency or rate, converted zero, overflow, contradictory settings 400); probe nonconfirmable batch (409) and 400 without writes |
| PCUR-COMPAT | Backend unit (no `payment`/`rate` keys added); probe recomputes the legacy preview hash and canonical payload formula for USD-only settings; existing `csv-import-db.cjs` fixtures unchanged |
| PCUR-UI | Frontend `PurchaseCurrency.test.tsx` (8 tests: default USD labels unchanged, RUB rate input and relabelling, currency column disables file-wide choice, settings payload, preview and journal paid text); critical Playwright `purchase-currency.spec.ts` (hosted CI only) |

## RED (before implementation)

- `pnpm --dir backend exec jest purchase-currency --coverage=false`: 19 failed / 21 with
  assertion diffs (type-only stubs and a throwing `convertPaidToUsd` kept it compiling);
  the 2 passing were the USD-compat cases that must stay true.
- `pnpm --dir frontend exec vitest run PurchaseCurrency`: 8 failed / 8 (missing currency
  selector, rate input, labels and paid text).
- `purchase-currency-db.cjs` on the pre-change build: FAIL at PCUR-MIGRATE (latest
  migration `AddAssetSwaps1790300000000`, expected `AddTradePaymentRecords1790500000000`);
  the pre-change compiled `parseCsvPreview` refused `payment` with 400.
- Two of my own expectations were wrong at RED and were corrected, not loosened:
  `0.000000005 / 1.0000000001` rounds to `0` (added the stronger case
  `0.000000005 / 0.9999999999 → 0.00000001`), and the decimal-comma test needed quantity
  `0,01`.
- Existing `csv-parser.spec.ts` expectations changed with the contract: lowercase or padded
  `usd` now reports `invalid-currency` (was `currency-not-usd`), `EUR` without a rate
  reports `missing-rate`, and `USDT` is valid with a payment at rate 1.

## GREEN (after rebase onto `f63be8c`, same sandbox)

| Command | Result |
|---|---|
| `pnpm --dir backend test --runInBand` | 1647 passed |
| `pnpm --dir frontend test` | 144 passed (coverage thresholds passed) |
| `pnpm lint` | exit 0; 77 backend / 27 frontend warnings, same as baseline |
| `pnpm --dir backend build` / `pnpm --dir frontend build` | exit 0 |
| `pnpm test:engineering` | 196 Jest + 10 Node checks passed |
| `pnpm specs:validate` | 51/51 strict |
| `purchase-currency-db.cjs` | PASS PCUR-COMPAT/SHAPE, PCUR-RUB, PCUR-MIXED, PCUR-ERRORS, PCUR-MIGRATE |
| `migrations.cjs` | PASS populated13/14/15/16/18/21-to24 |
| `wallet-addresses-db.cjs`, `auth-limits-db.cjs` | PASS (24 migrations) |
| `asset-rewards(-bounds)`, `asset-swaps-bounds`, `historical-accounting`, `historical-valuation`, `linked-twr`, `manual-portfolio-valuation`, `manual-usd-prices`, `owned-transfers(-bounds)`, `period-profit`, `twr-preview`, `valuation-history`, `xirr-preview` probes | exit 0 |
| `display-fx-db`, `mfa-db`, `sessions-db` (with CI's backend environment: MFA key file, display-FX flags, provider proxy) | exit 0 |
| `client-source-startup.cjs` after `migrate.js` (24 applied) and `seed.cjs` | PASS (24 migrations, latest `AddTradePaymentRecords1790500000000`) |

Probes ran against a throwaway local PostgreSQL 16 cluster with the repository's own
migrations, the compiled backend linked at `/app/backend`, isolated `DB_*` settings and the
synthetic `providers.cjs` fixture on `providers:8080` with a throwaway TLS certificate.

Six probes fail at a referenced-deletion RESTRICT SQLSTATE stage on local PostgreSQL 16:
`csv-import-db` (CSV-007-A), `usd-trades-db` (TRADE-006-B), `carry-in-db` (CARRY-006-A),
`external-usd-flows-db` (FLOW-MIG-001), `manual-opening-db` (OPEN-004) and `asset-swaps-db`
(SWAP-006, expects 23001). Unchanged `main` at `f63be8c`, built and run the same way in the
same sandbox, fails all six too (CI uses PostgreSQL 18), so this is environmental, not a
regression; hosted CI is the authority for them.

## Not run here

- `pnpm test:e2e` and `pnpm test:e2e:critical`: Docker image builds fail on the sandbox TLS
  proxy. PCUR-UI runs in hosted CI's critical acceptance (manifest 21 → 22).
- Screenshots in `docs/screenshots/purchase-currency/` are component renders with synthetic
  data in local Chromium, not the full app.

## Review

REVIEW_RESULT

## Hosted CI

HOSTED_RESULT
