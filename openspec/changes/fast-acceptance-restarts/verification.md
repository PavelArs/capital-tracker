# Verification: fast-acceptance-restarts

All checks ran in the cloud sandbox on 2026-10-04 against branch
`claude/unrealized-pnl-hw9vnz` (base main `38b48be`), unless marked otherwise.

## Evidence for the cause

From the log of job 111491240409 (green run 37220925062), step "Run critical real
release acceptance" 17:35:34 → 18:04:55:
- 21 browser cases took 18 min 23 s (`21 passed (18.4m)`); each case's auto fixture
  (`tests/e2e/mfa-fixtures.ts`) restarts both backends, 4 cases restart again.
- Fixture start to restart completion took 12.0–13.1 s every time.
- Teardown stopped the backend in exactly 10 s (`Stopping 18:04:34` → `Stopped 18:04:44`).
- `backend/Dockerfile` runs `CMD ["node", "backend/dist/main.js"]` as PID 1; the test
  Compose sets no `init`; `backend/src` has no `enableShutdownHooks` or SIGTERM handler
  for the server. Inferred: SIGTERM is ignored and Docker's 10 s timeout ends in SIGKILL.

## RED (test written first, harness unchanged)

`jest src/engineering/acceptance-restarts.spec.ts`: 2 failed. Received
`replicas.ts: docker(...compose, 'restart', ...services);`.

## GREEN

- Engineering test ISO-006-A: 2 passed.
- Backend: 64 suites, 1651 tests passed (`pnpm --dir backend test --runInBand`).
- Engineering gates: `pnpm test:engineering` 196 + 10 passed.
- Backend lint: 77 existing warnings, no errors; Biome clean on both changed files.
- Strict OpenSpec validation: 54/54.
- `docker compose restart --help` lists `-t, --timeout int` (local CLI 2026-10-04).

## Not run

- Playwright critical acceptance (Docker is unavailable in the sandbox; hosted CI
  only). The saving (about 4 minutes) is an estimate until hosted CI measures it.
