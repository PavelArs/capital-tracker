# Simple date entry verification

Status: local checks complete; hosted CI critical acceptance pending on the PR.

Base: `main` at `f63be8c` (after #31). Node 22.22.0 (engine `>=22.21.1 <23`), pnpm
10.33.0, OpenSpec 1.2.0. No backend, API, migration, schema, dependency, lockfile or
`frontend/nginx.conf` change.

## Check manifest

| Scenario | Checks |
|---|---|
| DATE-1-A..D | `frontend/src/features/accounting/DateEntry.test.tsx` (trade form) |
| DATE-1 typing/reset edge cases (review findings) | `frontend/src/components/common/DateTimeField/DateTimeField.test.tsx` |
| DATE-2-A/B, draft defaults | `DateEntry.test.tsx` (valuation, accounting snapshot, history, trade/swap drafts) |
| DATE-1 through the real backend | Local HTTPS stack (below): journal start, date-only trade, trade with UTC time, price at today, valuation at today |
| Browser regression of affected forms | Updated Playwright cases (23 files); critical cases run in hosted CI only |

## RED (before implementation)

`pnpm --dir frontend exec vitest run src/features/accounting/DateEntry.test.tsx`: 7 failed /
7, each an assertion failure (no date group/input named «Дата сделки», «Дата оценки»,
«Дата среза», «Начало периода»; DATE-1-D found the ISO hint text).

After independent review, `DateTimeField.test.tsx` was added first and failed 4 / 5:
intermediate 00:00 vanished while typing, seconds segment collapsed, a time survived a
parent reset, and a zone-less instant was read as local time. The fifth (re-entering a
cleared date keeps its time) already passed.

## GREEN (same sandbox)

| Command | Result |
|---|---|
| `pnpm --dir frontend exec vitest run --coverage=false` | 29 files, 149 tests passed |
| `pnpm --dir frontend lint` | 0 errors, 27 warnings (identical count on unchanged base) |
| `pnpm --dir frontend exec tsc --noEmit -p .` and `pnpm --dir frontend build` | passed |
| `OPENSPEC_TELEMETRY=0 pnpm exec openspec validate simplify-date-entry --strict --no-interactive` | valid |
| `pnpm exec playwright test --list` | 174 tests in 45 files load |
| `tsc --noEmit` over `tests/e2e/*.ts` (ad-hoc config) | 0 errors before and after |

## Real browser against the real backend

Throwaway local stack, not CI evidence: PostgreSQL 16 cluster under `/var/tmp`, Redis,
compiled backend with explicit migrations, owner created by `owner-cli` with MFA via
`mfa-cli`, Vite HTTPS origin `https://127.0.0.1:8443`, headless Chromium (`ru-RU`, UTC),
real password + TOTP login. Observed request bodies and results:

- journal start 01.06.2025 sent `coverageFrom: 2025-06-01T00:00:00.000Z` (201);
- trade 13.06.2025 without time sent `occurredAt: 2025-06-13T00:00:00.000Z` (201);
- trade 11.07.2025 14:30:15 sent `2025-07-11T14:30:15.000Z` (201);
- manual price with the default date sent `observedAt: 2026-10-04T00:00:00.000Z` (201);
- account valuation with the default date returned value 1629.55005255 and unrealized
  -540.44994745 (-24.91 %); the accounting snapshot at 30.06.2025 rendered;
- no horizontal page overflow at 360 px.

Screenshots: `docs/screenshots/simple-dates/`.

## Independent review

A separate review context found: time input text collapsing while typing (fixed), a time
surviving a form reset (fixed), missing guidance on the selected-accounts form (fixed),
lot time hint not associated (fixed), narrow-width grid minimum (fixed with auto-fit), a
zone-less value read as local time (fixed). Accepted as known: same-day entries default
to order 0 and collide with an existing operation at 00:00 UTC (backend 409, unchanged);
the follow-up trade-form change addresses order. «История указанной даты» on the price
page is now enabled because the date starts filled in.

## Not run here

`pnpm test:e2e` / `test:e2e:critical` (Docker builds are blocked in the cloud sandbox);
hosted CI runs the critical profile. The full 174-case suite was not run.
