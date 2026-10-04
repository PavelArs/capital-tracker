# Verification: tag-release-versions

All checks ran in the cloud sandbox on 2026-10-04 against branch
`claude/unrealized-pnl-hw9vnz` (base main `74604d9`), unless marked otherwise.

## RED (tests written first, workflow unchanged)

`jest src/engineering/{release-versions,gates,release-approval}.spec.ts`: 9 failed,
184 passed. Failing: RVR-001-A (no naming step), RVR-001-B both (only commit-SHA tags
were pushed, the malformed version was not refused), RVR-002-A all four (no reported
version, outputs or tag job), ENG-002-A and RAP-001-A (job list `['deploy']`).
RVR-002-B passed before the change only because the tag job did not exist; it now
passes on the regex and same-commit checks.

## GREEN

- Backend: 63 suites, 1649 tests passed (`pnpm --dir backend test --runInBand`).
- Engineering gates: `pnpm test:engineering` 196 + 10 passed.
- Backend lint: 77 existing warnings, no errors; `tsc --noEmit` clean.
- Strict OpenSpec validation: 52/52.
- The tests execute the real workflow steps with synthetic `git` history, `docker`
  and `gh`; no registry or GitHub API was contacted.

## Not run

- Hosted CI on the PR (pending).
- A real promotion and Git tag: they happen only on the first approved release after
  merge (task 3.3).
