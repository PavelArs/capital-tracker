# Asset classification (M2) verification

Status: local checks complete; hosted CI is the authority for critical browser
acceptance and the probes that need the Compose network. Archive follows a green
hosted run.

Base: `main` at `692be87` (M1 shell merged). Node 22.22.0 (engine `>=22.21.1 <23`),
pnpm 10.33.0, OpenSpec 1.2.0. One additive migration (`ClassifyAssets1790700000000`,
migration 24). No dependency, lockfile, Dockerfile or `frontend/nginx.conf` change.

## Check manifest

| Scenario | Checks |
|---|---|
| AST-NEW | `asset-classification.spec.ts` (create stores and lists manual/RUB/manual); probe `asset-classification-db.cjs` (AST-NEW through the compiled service on PostgreSQL, listed once, replay 200); `PortfolioPage.test.tsx`; critical `SHELL-UI` adds a manual RUB deposit and checks the row after reload |
| AST-RULES | Unit table of derived sources, contradictions and invalid raw fields (ASCII-only ticker uppercasing included); probe: 400 refusals write nothing, PostgreSQL rejects eight invalid direct inserts |
| AST-TYPES | Probe upgrades a populated 23-migration database: BTC and lowercase `eth` become crypto/USD/market, cash `USD` and unlabelled rows manual/USD/manual; every other row, column and constraint unchanged; portfolio valuation identical; replay applies 0; `down()` refuses. `migrations.cjs` checks all predecessor stages to 24 |
| AST-LEGACY | Unit: exact legacy parse and replay payload; probe: a pre-migration request replays 200 after the upgrade; old writers get the manual defaults |
| AST-UI | `PortfolioPage.test.tsx` (7 tests: list, sorting, filters, add, retry with the same request id, filter cleared for a new row, focus trap/return and no close mid-save, empty/loading/error); critical `SHELL-UI` (heading, `aria-current`, add, reload, Manual filter) |
| SHELL-005-A | `SectionPlaceholder.test.tsx` (three placeholders); `SHELL-UI` placeholder loop without Portfolio |
| OPEN-001-A | `manual-opening.spec.ts` asserts a USD-ticker legacy instrument stays manual/USD/manual |

## RED (before implementation)

- Backend unit acceptance against a stub `classifyAsset`: 13 failed.
- Frontend `PortfolioPage.test.tsx` against a stub page: 5 failed.
- Probe `asset-classification-db.cjs` on the pre-change build: `Migrations applied: 0`.
- Review fixes: 3 unit cases (non-ASCII ticker) and 2 component tests (filter, focus/save)
  failed before their fixes.

## GREEN (after implementation, cloud sandbox)

| Command | Result |
|---|---|
| `pnpm --dir backend test --runInBand` | 62 suites, 1655 passed before the review fixes (baseline 61/1626); `jest src/accounting` 873 passed after them |
| `pnpm --dir frontend test` | 30 files, 153 passed |
| `pnpm --dir backend lint` / `pnpm --dir frontend lint` | exit 0; 77 and 27 warnings, as on main |
| `pnpm --dir backend build` / `pnpm --dir frontend build` | exit 0 |
| `pnpm test:engineering` | 196 Jest + 10 Node checks passed |
| `pnpm specs:validate` | 51/51 strict |
| `tsc --noEmit --strict` on changed e2e TypeScript | clean |
| Critical selection | 21/21 cases from 175 listed tests |

Real-PostgreSQL probes ran against a local PostgreSQL 16 with the compiled backend and
the synthetic provider (`providers.cjs`, self-signed certificate). Passing:
`asset-classification-db`, `migrations`, `auth-limits-db`, `historical-accounting-db`,
`period-profit-db`, `xirr-preview-db`, `twr-preview-db`, `linked-twr-db`,
`manual-usd-prices-db`, `historical-valuation-db`, `valuation-history-db`,
`manual-portfolio-valuation-db`, `owned-transfers-db`, `owned-transfers-bounds-db`,
`asset-rewards-db`, `asset-rewards-bounds-db`, `asset-swaps-bounds-db`.
Not conclusive locally (they need the Compose network, proxy, MFA key or a
RESTRICT behaviour this local cluster does not reproduce on `main` either):
`manual-opening-db`, `usd-trades-db`, `csv-import-db`, `carry-in-db`,
`external-usd-flows-db`, `asset-swaps-db`, `wallet-addresses-db`, `display-fx-db`,
`provider-proxy`, `owner-cli`, `sessions-db`, `mfa-db`, `mfa-expiry`,
`client-source-startup`. Hosted CI runs all of them.

## Screenshots

`docs/screenshots/classify-assets/`: Vite production build in Chromium with stubbed
`/api/auth/me` and `/api/accounting/instruments` responses (synthetic owner and sample
assets). Presentation only; the real login, PostgreSQL and HTTPS path is `SHELL-UI`.

## Independent review

A separate review context read the diff against the spec. No blocking findings. Fixed:
the classification check now also rejects fiat without a ticker and crypto with a fixed
price source (two direct-SQL cases added to the probe); tickers are uppercased
ASCII-only so the server and PostgreSQL `upper()` agree; adding an asset clears a filter
that would hide it; the dialog traps Tab, returns focus to its opener and cannot be
closed while saving; `SHELL-UI` asserts Portfolio's `aria-current` and the Manual filter.

## Hosted CI

Pending.
