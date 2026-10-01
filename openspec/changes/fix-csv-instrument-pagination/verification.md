# CSV pagination verification

## Predecessor RED

Product worktree/unit predecessor: `48e466aff71ccc30719c9727c8a155a10a6ab6e7`. Actual real-runtime RED revision: `61ce07072e09b095e73ce693f0ad8a6738031661`. The real populated-catalog CSV-006-A journey fails at the unchanged `csv-import-fixtures.ts:289` progress assertion: first load-more returns HTTP200 with the same 50 instrument choices and cursor `00000000-0000-4000-8000-000000001050`, without visible growth. Exact network receipt: `/private/tmp/capital-mvp-ci4-csv-pagination-red.json`; trace/error-context: `/private/tmp/capital-mvp-ci4-selected-results/csv-import-journey-CSV-006-c5b43-lls-back-the-complete-batch-chromium`. This is real HTTPS/MFA/backend/PostgreSQL evidence supplied by the central runtime, not a component mock.

Before product changes, Node22.21.1 with installed Vitest4.1.2 ran `vitest run src/features/accounting/CsvMapping.test.tsx src/pages/ManualAccountDetail.test.tsx`: **6 expected failures / 2 files**, exit1. Log: `/private/tmp/capital-csv-pagination-unit-red.log`. Acceptance source and contract were frozen in commit `075cffc` before implementation. Exact failures include expected stored cursor1050 but received undefined, delegated callback expected1 but actual0, load-more still present after exhausted parent state, and absent parent loading/initial-error retry UI. Unit API/child-boundary mocks are narrower evidence than real runtime.

## Scoped GREEN

ManualAccountDetail remains the single catalog owner. Its existing server cursor, choices, loading and error now reach CsvMapping through TradeJournal and CsvImports. CsvMapping renders parent choices and invokes the parent callback; its duplicate loader/state have been removed. Catalog-only updates do not remount or reset CSV intent.

With Node22.21.1 and the installed local dependencies (Vitest4.1.2, Vite7.3.1), the following checks exited0:

- Frontend `node node_modules/vitest/vitest.mjs run src/features/accounting/CsvMapping.test.tsx src/features/accounting/CsvImports.test.tsx src/pages/ManualAccountDetail.test.tsx src/features/accounting/AccountOperations.test.tsx src/features/accounting/AccountWorkspace.test.tsx`: **12 passed / 5 complete files**, without a scenario/test-name filter. Log: `/private/tmp/capital-csv-pagination-unit-green.log`. This comprises the 6 semantic acceptance regressions observed RED before implementation, 2 added CsvImports characterizations for the exact original File/mapping and completed retained receipt UUID across catalog loading/error/retry, and 4 retained workspace/operations tests. There is no separate TradeJournal unit test file. The added receipt characterization waits for the exact receipt UUID in the current status before capturing its DOM node; its initial observer captured transient loading status and was corrected without changing product behavior.
- Frontend `node node_modules/typescript/bin/tsc`: strict frontend types pass. Log: `/private/tmp/capital-csv-pagination-types.log` (empty on success).
- Frontend `node node_modules/vite/bin/vite.js build`: production build passes. Log: `/private/tmp/capital-csv-pagination-build.log`. The existing large-bundle warning remains.
- `node frontend/node_modules/@biomejs/biome/bin/biome check --config-path frontend/biome.json` on the 4 changed product files and 3 focused test files: **7 files checked, no fixes**. Log: `/private/tmp/capital-csv-pagination-style.log`.
- `OPENSPEC_TELEMETRY=0 openspec validate fix-csv-instrument-pagination --strict --no-interactive`: valid. Log: `/private/tmp/capital-csv-pagination-spec.log`.

The `node` in these commands was explicitly `/Users/pavelars/.nvm/versions/node/v22.21.1/bin/node`. Local dependency directories were reused via temporary worktree symlinks; no dependency files were changed or packages installed.

## Remaining gates

Independent review and a newly rebuilt exact linux/amd64 frontend running the retained HTTPS/PostgreSQL CSV journey/recovery cases with a catalog exceeding50 remain required and unrun by this worktree. No Docker, network, deployment or broad E2E run is performed by this worktree. The release change, SQL/backend/financial logic and existing `csv-import-fixtures.ts` progress assertion are untouched; do not archive yet.
