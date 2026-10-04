# Verification: fix-analytics-journal-race

All checks ran in the cloud sandbox on 2026-10-04 against branch
`claude/fix-analytics-journal-race` (base main `74604d9`), unless marked otherwise.

## Failure observed

Main CI run 37218384482, critical acceptance: VAL-UI failed at
`historical-valuation.spec.ts:332` (`Нет точной цены` not visible within 10 s) after
the valuation response was 200 with `completeness: incomplete`. 20 other cases passed.
PR run 37218242193 on the identical tree passed all 21. The failure screenshot could
not be downloaded here (artifact storage is blocked by the sandbox proxy).

## RED

`vitest run src/features/accounting/HistoricalValuation.test.tsx`: 1 failed, 3 passed.
The new case "shows a result requested before the journal loaded when it matches the
loaded revision" found no table: the journal arriving after the request dropped the
result. The companion case (other revision dropped) passed before and after.

## GREEN

- Frontend: 30 files, 154 tests passed (`pnpm --dir frontend test`), including 4 race
  and 5 helper tests.
- Frontend lint: no new findings in the changed files (27 existing warnings overall);
  `tsc --noEmit` clean; production build succeeded.
- Strict OpenSpec validation passed.

## Not run

- Playwright critical acceptance (needs Docker; hosted CI only). The root cause is
  inferred from the component logic and reproduced in the component test, not observed
  in the failed run's trace.

## Hosted CI (2026-10-04)

- PR run 37220925062 green on every job, critical acceptance including VAL-UI and
  VCH-UI.
- Main CI 37225929714 on `3bdceea` green on every job; the release reached
  production as `v2026.10.04-3bdceea`.
