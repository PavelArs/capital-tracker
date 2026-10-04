## 1. Acceptance tests first

- [x] 1.1 Component test: a valuation requested before the journal loads is shown when computed at the loaded revision, dropped at another revision (`HistoricalValuation.test.tsx`).
- [x] 1.2 Helper tests for the shared revision rules (`journal-revision.test.ts`).
- [x] 1.3 Record the expected failure (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 Shared helper and its use in the three analytics tools.

## 3. Verification

- [x] 3.1 Frontend tests, lint, typecheck, build and strict spec validation GREEN; record results.
- [x] 3.2 Hosted CI green on the PR, including VAL-UI and VCH-UI in critical acceptance. (PR run 37220925062 and main run 37225929714, both with VAL-UI and VCH-UI passing.)
