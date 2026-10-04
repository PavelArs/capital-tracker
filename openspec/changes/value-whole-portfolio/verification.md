# Whole-portfolio valuation (M4) verification

Status: local checks complete; hosted PR checks pending; main CI (probe and
`PORTFOLIO-UI`) runs after merge.

Base: `main` at `beb8cd3` (M3 prices merged). Node 22.22.0 (engine `>=22.21.1 <23`),
pnpm 10.33.0, OpenSpec 1.2.0. No migration (count stays 25). No dependency, lockfile,
Dockerfile, Compose or `frontend/nginx.conf` change. All fixtures and screenshots use
synthetic data only.

## Check manifest

| Scenario | Checks |
|---|---|
| PV-TOTAL | Probe `portfolio-valuation-db.cjs` (three accounts, a transfer between two, a not-started account; total 10000 through the compiled service); Jest PV-ALLOC/PV-TOTAL |
| PV-PRIVATE | Probe: a foreign owner's 5 BTC never counted, unchanged fingerprint, 400 for any query string, no provider requests; `PORTFOLIO-UI` anonymous 401 and `?at=` 400 |
| PV-MARKET | Jest (780.10005255, −219.89994745, −21.99); probe (latest observation at or before now, a future row ignored) |
| PV-STALE | Jest; probe stale count 1; component test (stale note and row caption) |
| PV-NONE / PV-FIXED | Jest; probe SOL no-price, RUB no-rate, USD 10; component tests (No price, No rate, totals Incomplete) |
| PV-MANUAL | Probe: 2300, then a voided 9999, then 2099 → 2099 used; `PORTFOLIO-UI` manual price 80000 |
| PV-BR11 | Jest; `PORTFOLIO-UI` (1.2 for 66000 at 80000: average 55000, value 96000, +30000, 45.45%) |
| PV-REALIZED | Jest (sale and swap, swap attributed to the outgoing asset); probe realized 800 |
| PV-UNKNOWN-COST | Jest; probe 409 for corrupted history; component test (cost basis unknown with known subtotal) |
| PV-ALLOC | Jest (asset 42/23/20/15, type 62/23/15, account 59/41); probe by account 79/21; `PORTFOLIO-UI` groupings |
| PV-UI | `PortfolioPage.test.tsx` (4 PV-UI tests: summary, rows and groupings; stale and unknown; asset page; missing rate, unknown asset, failed load); critical `PORTFOLIO-UI` |
| AST-UI (AST-3 modified) | `PortfolioPage.test.tsx` (5 tests: add deposit, filters, retry with the same request id, filter cleared for a new row, dialog focus); `SHELL-UI` updated for the new columns |

## RED (before implementation)

- Jest `portfolio-valuation.spec.ts` against a typed stub projection: 9 failed of 9.
- Probe `portfolio-valuation-db.cjs` against the stub build: failed on the first
  deep-equal of response keys (PV-TOTAL).
- Frontend `PortfolioPage.test.tsx` against the M2 page and a stub `AssetPage`: 9 failed.

## GREEN (after implementation, cloud sandbox)

| Command | Result |
|---|---|
| `pnpm --dir backend test --runInBand` | 69 suites, 1785 passed; `jest src/accounting src/prices` 926 passed after the review fixes |
| `pnpm --dir frontend test` | 31 files, 164 passed after the review fixes (162 before) |
| `pnpm --dir backend lint` / `pnpm --dir frontend lint` | exit 0; 77 and 27 warnings, as on main |
| `pnpm --dir backend build` / `pnpm --dir frontend build` | exit 0 |
| `pnpm test:engineering` | 245 Jest + 23 Node checks passed (critical selection 22/22 from 176 listed tests, browser split 8/7/7) |
| `pnpm specs:validate` | 57/57 strict (main now carries one more change) |
| `tsc --noEmit --strict` on `portfolio-valuation.spec.ts` and `application-shell.spec.ts` | clean |
| Biome format (frontend config) on the changed e2e TypeScript | clean |

Real-PostgreSQL probes ran locally on PostgreSQL 16 with the compiled backend:
`portfolio-valuation-db` (both checks), `manual-portfolio-valuation-db`,
`historical-valuation-db` and `asset-classification-db` pass. `prices-db` passed
after the market-price query moved to `prices/market-price.store.ts`; a later rerun was
not repeated because its scratch databases already existed locally. Browser cases
(`PORTFOLIO-UI`, `SHELL-UI`) were not run here (no Docker in the sandbox); they run in
main CI after merge.

## Independent review

A separate reviewer read the whole diff, reran the unit and component tests and
recomputed every scenario number; nothing blocking. Fixed, each with a test that failed
first (1 Jest assertion, 2 component tests):

- `allocation.complete` is now false when an account history starts later, and the
  allocation note names that cause.
- The cost-basis note says "an account history starts later" instead of "part has no
  purchase price" when that is the only gap.
- Portfolio loads ignore a reply that is not the newest, and a failed refresh after
  adding an asset keeps the values shown with a "could not refresh" alert.
- An amount below 0.00000001 shows "<0.00000001", never "0".
- `design.md` tie-break wording and the PV-5 price labels now match the code.

Left as is: allocation shares are rounded one by one and can sum to 99.99; display
formatting goes through `Number()` (exact strings stay in the API); each connected
component re-reads the owner's transfer heads (performance only); swap realized P&L is
covered in Jest through the projection, not through the probe; the PV-PRIVATE
MFA-pending 403 relies on the global owner guard every accounting route uses; no new test covers it for this route.
`PORTFOLIO-UI` and `SHELL-UI` now replay every account of the shared acceptance owner,
so a case that leaves unreplayable history for that owner would fail them with 409.

## Screenshots

Captured from the production build with the API stubbed by synthetic data, in
`docs/screenshots/value-whole-portfolio/`: `portfolio-1440-dark.png`,
`portfolio-gaps-1440-dark.png`, `asset-1440-dark.png`, `asset-no-rate-1440-dark.png`,
`portfolio-1280-light.png`, `portfolio-390-dark.png`, `asset-390-dark.png`.

## Not done here

- Hosted PR checks and main CI with the probe and `PORTFOLIO-UI`.
- Archive after main CI is green.
