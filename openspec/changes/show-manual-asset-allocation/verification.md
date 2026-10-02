# Verification — show-manual-asset-allocation

## Scope and acceptance mapping

MPV-ALLOC-001..004 map to `backend/src/accounting/manual-portfolio-valuation.spec.ts`: shared UUID aggregation and order, same-symbol isolation, scale-60 values, half-up tie and independent rounding, missing prices/history, known zero, empty positions and priced unknown-cost reward. MPV-ALLOC-005 maps to `frontend/src/features/manual-portfolio-valuation/ManualPortfolioValuation.test.tsx`: the labelled table, exact/unknown cells and clearing after a UTC edit. The prior account/selection tests remain intact.

Separate real PostgreSQL and HTTPS assertions extend the existing manual-portfolio acceptance journeys in QA commits `804dc24` and `3538775`, integrated as `d4be9ef` and `18e3616`. The follow-up preserves expected values while matching the instrument row header and three data cells. They retain the existing privacy, snapshot, provider and no-write oracles. Runtime execution remains pending; local Docker is unavailable.

## Actual local results

Environment: Node 22.23.2, pnpm 10.33.0, frozen install reported passing by root. Baseline on unchanged source was 63/63 backend MPV + historical valuation tests and 3/3 frontend view tests, reported by root.

Intended RED before implementation: `jest accounting/manual-portfolio-valuation.spec.ts --runInBand --coverage=false` ran 36 tests: four new allocation assertions failed because `allocation` was absent, while 32 existing assertions passed. `vitest run .../ManualPortfolioValuation.test.tsx --coverage=false` failed its new case because the labelled allocation table was absent. Root independently reproduced those expected failures.

After implementation:

| Check | Result |
| --- | --- |
| Targeted backend Jest file | 37/37 passed, including five new allocation checks (2.224 s) |
| Two targeted frontend Vitest files | 4/4 passed (1.22 s) |
| Backend Nest build | Passed |
| Frontend TypeScript and Vite build | Passed; existing large-chunk warning |
| Strict OpenSpec `validate --all` | 49 passed, 0 failed |
| Backend/frontend affected-file Biome | Passed after formatting |
| Production dependency audit | Initial agent attempt unavailable (registry DNS `ENOTFOUND`); root network-enabled rerun passed, exit 0, zero HIGH/critical and one MODERATE finding |

Root verified the integrated source at `1c878f1`: backend MPV and historical valuation 68/68 passed (2.112 s), frontend allocation/view 4/4 passed (1.14 s), production audit passed as above, PostgreSQL probe syntax and diff checks passed. Playwright discovery lists the two retained MPV journeys; discovery is not execution.

Independent agent review approved `4a52f9f..1c878f1` for a draft PR with no behavioral blocker. It reviewed exact arithmetic, half-up ties, UUID separation, unknown cost independence, incomplete/zero shares, private snapshot reuse, stale intent and semantic browser assertions. These results are unit/component and compile evidence, not PostgreSQL or HTTPS runtime acceptance. Full 174-case E2E and production/Docker startup were not run; the selected critical profile is planned for the integrated source. Do not archive until required runtime acceptance passes.
