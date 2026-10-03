# Unrealized profit/loss verification

Status: local RED/GREEN, real PostgreSQL probes and independent review done in a cloud
sandbox; hosted critical browser acceptance passed 20/20 (VAL-UI and MPV-UI included).
The release image gate is pending a frontend base-image fix. Keep the change active until
the whole hosted run is green, then archive.

Base: `main` at `4a52f9f4f74543b4f199b88b3cf7d3784db4ec22`. Node 22.22.0 (engine range
`>=22.21.1 <23`), pnpm 10.33.0, OpenSpec 1.2.0, local PostgreSQL 16.14. No migration,
schema, dependency, lockfile, deployment or `frontend/nginx.conf` change.

## Check manifest

| Scenario | Checks |
|---|---|
| UPNL-EXCEL | Backend unit `unrealized-pnl.spec.ts` (owner's spreadsheet row 0.00918359 at 84945 vs 1000 → -219.89994745, -21.99) |
| UPNL-GAPS | Backend unit (missing price, unknown basis, zero cost, empty account); REWARD-API E2E extended with real unknown-basis and zero-cost rewards |
| UPNL-PORTFOLIO | Backend unit; `manual-portfolio-valuation-db.cjs` real PostgreSQL probe; MPV-API E2E exact keys and values |
| UPNL-1/2 via account valuation | `historical-valuation-db.cjs` real PostgreSQL probe; VAL-API E2E exact body |
| UPNL-UI | Frontend component test `HistoricalValuation.test.tsx`, view test `manual-portfolio-view.test.ts`; critical VAL-UI and MPV-UI browser cases extended (titles unchanged, manifest unchanged) |
| Rounding/precision | Unit cases for half-away-from-zero, no negative zero, scale-60 sub-cent result |
| UPNL-UI-BROWSER | Critical VAL-UI and MPV-UI cases (hosted CI only) |
| VCH unchanged | `valuation-history.ts` untouched; existing valuation-history unit tests pass |

## RED (before implementation)

- `pnpm --dir backend exec jest unrealized-pnl --coverage=false`: 5 failed / 5, each a
  missing `unrealizedPnlUsd`/`unrealizedReturnPercent`/`unknownCostCount` in
  `projectManualPortfolioValue` output (assertion diffs, not compile errors).
- `pnpm --dir frontend exec vitest run HistoricalValuation.test.tsx manual-portfolio-view.test.ts`:
  4 failed / 7 (3 pre-existing passed); missing "Нереализованная прибыль, USD" summary,
  missing explanation text, missing view fields.
- Real PostgreSQL probes on the pre-change backend build (implementation files stashed,
  backend rebuilt): `historical-valuation-db.cjs` and `manual-portfolio-valuation-db.cjs`
  exit 1 at the response key assertion, missing `unknownCostCount`, `unrealizedPnlUsd`,
  `unrealizedReturnPercent`.

## GREEN (after implementation, same sandbox)

| Command | Result |
|---|---|
| `pnpm --dir backend test --runInBand` | 59 suites, 1578 tests passed (baseline 1564 + 14 new) |
| `pnpm --dir frontend test` | 26 files, 133 tests passed (coverage thresholds passed) |
| `pnpm --dir backend lint` / `pnpm --dir frontend lint` | exit 0; 77 / 27 warnings, same counts as baseline |
| `pnpm --dir backend build` / `pnpm --dir frontend build` | exit 0 |
| `pnpm test:engineering` | 196 Jest + 10 Node checks passed |
| `pnpm specs:validate` | 49/49 strict |
| `node tests/e2e/historical-valuation-db.cjs` | PASS VAL-EXACT/GAPS/PRIVATE, VAL-COVERAGE, VAL-SNAPSHOT, VAL-PRECISION |
| `node tests/e2e/manual-portfolio-valuation-db.cjs` | PASS MPV-EXACT/GAPS/PRIVATE, MPV-SNAPSHOT, MPV-PRECISION/BOUND |

The two probes ran against a throwaway local PostgreSQL 16 cluster with the repository's
own migrations (22 rows), the compiled backend linked at `/app/backend`, exact isolated
`DB_*` settings, and a synthetic provider fixture on `providers:8080` that recorded no
requests. This is real database evidence for the changed services, not browser evidence.

## Not run here

- `pnpm test:e2e` and `pnpm test:e2e:critical`: Docker image builds fail on the sandbox
  TLS proxy. The extended VAL-UI and MPV-UI cases run in hosted CI's critical acceptance;
  VAL-API, MPV-API and REWARD-API run only in the full suite, which is not executed per
  change (owner instruction 2026-09-23).
- `pnpm audit:production`: no dependency change.

## Independent review

A separate read-only reviewer context checked arithmetic, every test oracle by hand,
spec/test consistency, Playwright strict-mode hazards from the new labels,
`inspectAnalysis` expectations and the unchanged valuation history. No blocking issue.
Resolved findings: the UPNL-UI scenario named the wrong null-cell text ("Нет точной
цены" would collide with the price cell under strict mode), so the spec now states
"Нужна точная цена"/"Неизвестна себестоимость" and dash rules; the browser evidence was
split into its own UPNL-UI-BROWSER scenario with the values the critical cases assert;
MPV-UI now also asserts the second row's return cell. No assertion was weakened.

## Hosted CI (PR #30)

- Run 37141674685 attempt 1 on `e1c7d6f`: nine jobs green; critical acceptance 19/20,
  SWAP-UI failed at `asset-swaps.spec.ts:591` (trade draft quantity empty after swap
  navigation). The same assertion failed on PR #29; this diff touches no swap/trade code.
- Attempt 2 (one re-run of failed jobs): critical acceptance 20/20 with verified receipt,
  including the extended VAL-UI and MPV-UI cases. The image gate then failed.
- Local Trivy 0.74.0 scan of the pinned bases found the only surviving HIGH finding in
  the frontend nginx base: CVE-2026-103111, `pcre2` 10.48-r0, fixed in 10.49-r0. Redis
  is clean; postgres and node findings are in `gosu` and bundled npm, which the
  Dockerfiles remove; `pnpm-lock.yaml` has no HIGH/CRITICAL findings. The frontend
  `release` stage now requires `pcre2>=10.49-r0`; only hosted CI can build it.
