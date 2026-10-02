# Verification — show-manual-asset-allocation

## Scope and acceptance mapping

MPV-ALLOC-001..004 map to `backend/src/accounting/manual-portfolio-valuation.spec.ts`: shared UUID aggregation and order, same-symbol isolation, scale-60 values, half-up tie and independent rounding, missing prices/history, known zero, empty positions and priced unknown-cost reward. MPV-ALLOC-005 maps to `frontend/src/features/manual-portfolio-valuation/ManualPortfolioValuation.test.tsx`: the labelled table, exact/unknown cells and clearing after a UTC edit. The prior account/selection tests remain intact.

Separate real PostgreSQL and HTTPS assertions extend the existing manual-portfolio acceptance journeys in QA commits `804dc24` and `3538775`, integrated as `d4be9ef` and `18e3616`. The follow-up preserves expected values while matching the instrument row header and three data cells. They retain the existing privacy, snapshot, provider and no-write oracles. The original integrated allocation source passed hosted runtime acceptance as recorded below; the subsequent designer-led UI source requires its own run. Local Docker remains unavailable.

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

## Hosted allocation acceptance and image blocker

PR #29 [CI run 37008110156](https://github.com/PavelArs/capital-tracker/actions/runs/37008110156) tested synthetic PR merge source `c4da0476ce29758f231388ab9e4fd5d8b0712ffe`, distinct from branch head `8e9ee3862fa93009de04ef2de5ceecc74c45006b` and base main `4a52f9f4f74543b4f199b88b3cf7d3784db4ec22`. The eight prerequisite jobs passed. Real PostgreSQL probes logged `PASS MPV-EXACT/GAPS/PRIVATE`, `PASS MPV-SNAPSHOT`, and `PASS MPV-PRECISION/BOUND` (72 ms observation, not an SLA). Critical HTTPS Playwright acceptance passed 20/20, including both retained MPV journeys, in 26 minutes.

Root downloaded the canonical receipt at `/private/tmp/capital-allocation-ci-37008110156/critical-release-acceptance.json` and ran `node scripts/critical-release-profile.cjs verify <receipt> c4da0476ce29758f231388ab9e4fd5d8b0712ffe 37008110156`; it exited 0 with “Exact critical release acceptance receipt verified”. The receipt binds manifest SHA `bb02aa94a7ec221f74ad47cc974a21599bd98d2f6dcf68deaed3607715c30a28`. Public filtered logs are at `/private/tmp/capital-allocation-ci-37008110156-public.log`.

The workflow nevertheless **FAILED** its exact-image security gate: frontend Alpine 3.24.2 contains `pcre2` 10.48-r0, HIGH `CVE-2026-103111`, with fixed version 10.49-r0 reported by the scanner. Backend, PostgreSQL and Redis had zero HIGH/critical findings; PostgreSQL retained one MEDIUM. Candidate export was skipped. These results establish functional runtime acceptance for the stated source, not successful CI, a valid release candidate, or a new deployment. Keep the image gate unchanged and this change unarchived until the reviewed combined source passes required verification.

The later design/UI and actual Tab/viewport/theme assertions are absent from that tested source. Their six real-application screenshots and new browser assertions remain pending a new run; synthetic design-reference renders are separate evidence.
