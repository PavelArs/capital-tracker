# CSV pagination verification

## Predecessor RED

Base: `48e466aff71ccc30719c9727c8a155a10a6ab6e7`. The real populated-catalog CSV-006-A journey fails at the unchanged `csv-import-fixtures.ts:289` progress assertion: first load-more returns HTTP200 with the same 50 instrument choices and cursor `00000000-0000-4000-8000-000000001050`, without visible growth. Exact network receipt: `/private/tmp/capital-mvp-ci4-csv-pagination-red.json`; trace/error-context: `/private/tmp/capital-mvp-ci4-selected-results/csv-import-journey-CSV-006-c5b43-lls-back-the-complete-batch-chromium`. This is real HTTPS/MFA/backend/PostgreSQL evidence supplied by the central runtime, not a component mock.

Before product changes, Node22.21.1 with installed Vitest4.0.14 ran `vitest run src/features/accounting/CsvMapping.test.tsx src/pages/ManualAccountDetail.test.tsx`: **6 expected failures / 2 files**, exit1. Log: `/private/tmp/capital-csv-pagination-unit-red.log`. Exact failures include expected stored cursor1050 but received undefined, delegated callback expected1 but actual0, load-more still present after exhausted parent state, and absent parent loading/initial-error retry UI. Unit API/child-boundary mocks are narrower evidence than real runtime.

## Remaining gates

Product implementation, focused GREEN and scoped lint/build/types/spec validation are pending. Independent review and a newly rebuilt exact linux/amd64 frontend running the retained HTTPS/PostgreSQL CSV journey/recovery cases with a catalog exceeding50 remain required. No Docker, network, deployment or broad E2E run is performed by this worktree. The release change and existing `csv-import-fixtures.ts` progress assertion are untouched; do not archive yet.
