# Verification: e2e-on-main-only

All checks ran in the cloud sandbox on 2026-10-04 against branch
`claude/e2e-on-main-only` (base main `38b48be`), unless marked otherwise.

## RED (tests written first, workflow unchanged)

`jest src/engineering/gates.spec.ts`: 4 failed, 183 passed. Failing: ENG-006-A job
condition (none), ENG-006-A aggregate rejected a pull request with a skipped release
job, ENG-001-D and ENG-004 job-condition assertions (now expect exactly
`github.event_name == 'push'`). ENG-006-B already passed because the unchanged
aggregate required the release job for every event.

## GREEN

- Engineering gates: `jest src/engineering/gates.spec.ts` 187 passed;
  `pnpm test:engineering` 205 + 10 passed.
- Backend: 63 suites, 1658 tests passed (`pnpm --dir backend test --runInBand`).
- Security: `pnpm test:security` 93 tests OK (3 skipped, as before).
- Backend lint: 77 existing warnings, no errors; `tsc --noEmit` clean.
- Strict OpenSpec validation: 54/54. `ci.yml` parses as YAML.
- The aggregate tests execute the real `ci-status` step with the event rendered as
  `pull_request`, `push`, `workflow_dispatch`, empty and `pull_request_target`.

## Not run

- Hosted CI: pending on the PR (the release job is expected to be skipped there) and
  on the first main push after merge (the release job is expected to run).
