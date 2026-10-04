# Verification: extend-owner-session-lifetime

All checks ran in the cloud sandbox on 2026-10-04 against branch
`claude/session-lifetime-24h-ulutoz` (base main `0b1c1ed`), unless marked otherwise.

## Cause

`backend/src/auth/session.service.ts` invalidated a full session thirty minutes after
its last request (`IDLE_MS`, plus the matching prune in `creationLock`) and at most
twelve hours after sign-in (`ABSOLUTE_MS`, cookie `maxAge` 12 h in
`auth.controller.ts`). Leaving the app open for more than thirty minutes therefore
returned the owner to sign-in. Both values are code constants, not configuration.

## RED

`jest src/auth/session.service.spec.ts` before the change: 3 failed, 1 passed.
- "stays valid after hours without activity within the day": expected `true`, got `false` (idle timeout).
- "stores a full session with a one-day deadline": expected `86400000`, got `43200000`.
- "gives the browser cookie the same one-day lifetime": cookie `maxAge` was `43200000`.
- "expires at the absolute deadline one day after sign-in" passed before and after.

## GREEN

- `pnpm --dir backend test --runInBand`: 66 suites, 1736 tests passed.
- `pnpm --dir backend lint`: 77 warnings, the same count as main; the changed files
  have no findings. `pnpm --dir backend build` succeeded.
- Biome check clean on the changed acceptance files; `playwright test --list` lists the
  new SES-001-C cases.
- Strict OpenSpec validation passed.

## Not run here

- Browser acceptance and the real-PostgreSQL `sessions-db` probe (Docker is not
  available in the sandbox; they run on main after merge). The SES-001-C browser
  cases are not part of the critical release manifest; the `sessions-db` probe
  (probes-2) and the CSV-006-B and MFA-002-B browser cases cover this change in
  main CI.

## Hosted CI (2026-10-04)

- PR run 37231611775 green on every job on the merged head `756fa5c`.
- Main CI 37232077464 on `af107d8` green on every job, including the `sessions-db`
  probe and the critical browser acceptance shards.
