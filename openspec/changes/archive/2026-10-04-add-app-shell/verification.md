# Application shell (M1) verification

Status: complete. Local RED/GREEN and independent review ran in a cloud sandbox;
hosted CI run 37214714966 on `dc50e4f` passed every job, including critical release
acceptance (21 cases, SHELL-UI and SWAP-UI among them) and the release image gate.

Base: `main` at `f63be8c`. Node 22.22.0 (engine `>=22.21.1 <23`), pnpm 10.33.0,
OpenSpec 1.2.0. No migration, schema, API, backend, dependency, lockfile, Dockerfile or
`frontend/nginx.conf` change.

## Check manifest

| Scenario | Checks |
|---|---|
| SHELL-001-A | `Layout.test.tsx` (section order, open Legacy group with all ten URLs and labels, no liabilities); critical `SHELL-UI` (login lands on `/dashboard`, Legacy links, account creation through Legacy, old overview notice, assets tabs) |
| SHELL-002-A/B | `Layout.test.tsx` (`Main navigation`, `Skip to content`, `Menu` with aria-controls/expanded, `Log out`, single current destination); `SHELL-UI` at 360/768/1280/1440; critical `SWAP-UI` compact-menu remount check with the renamed `Menu` |
| SHELL-005-A | `SectionPlaceholder.test.tsx` (heading, "not built yet", legacy link, no "portfolio is empty", no numbers, no fetch/XHR); `SHELL-UI` opens all four placeholders and asserts zero `/api/` requests |
| SHELL-006-A/B | `SettingsPage.test.tsx` with a controllable `matchMedia` and storage; `SHELL-UI` with emulated dark/light device and reload |
| SHELL-007-A | `Layout.test.tsx`; `SHELL-UI` |
| Other critical cases | Mechanical renames only (`Skip to content`, `Menu`, `Log out`); critical selection resolves 21/21 cases from `playwright test --list` via `critical-release-profile.cjs select` |

## RED (before implementation)

`pnpm --dir frontend exec vitest run src/components/Layout.test.tsx src/features/shell`
with empty stubs for `SectionPlaceholder` and `SettingsPage`: 13 failed / 14. Layout:
`expected 'Основная навигация' to be 'Main navigation'`, no `Menu` button, no section
links, no `Legacy` group, no current destination, no sync slot. Placeholders: no
heading `Dashboard`/`Portfolio`/`Transactions`/`Wallets`. Settings: no heading
`Settings`, no radio `Dark`, no `Legacy settings` link. The one pass was the section
inventory check against the stub map.

Browser RED for the rewritten `SHELL-UI` is the predecessor behaviour (login opened
`/manual-accounts`, Russian control names); it is not executed in the sandbox.

## GREEN (after implementation, same sandbox)

| Command | Result |
|---|---|
| `pnpm --dir frontend test` | 29 files, 147 tests passed (baseline 27/136; −3 old Layout tests, +14 new) |
| `pnpm --dir frontend lint` | exit 0, 27 warnings (same as baseline) |
| `pnpm --dir frontend build` | exit 0 (tsc + Vite) |
| `pnpm test:engineering` | 196 Jest + 10 Node checks passed |
| `pnpm specs:validate` | 51/51 strict |
| `tsc --noEmit --strict` on `application-shell.spec.ts` | clean |
| `playwright test --list` | 175 tests in 46 files; critical profile selects 21 |

Backend is untouched; its suites were not re-run locally (hosted CI runs them).

## Screenshots

`docs/screenshots/app-shell/`: Vite production build in Chromium with stubbed
`/api/auth/me` and `/api/accounting/accounts` responses (synthetic owner and three
sample accounts). They show presentation only; the real login, PostgreSQL and HTTPS
path is the hosted `SHELL-UI` case.

## Independent review

A separate review context read the diff against the spec. No blocking findings.
Resolved: `SHELL-UI` theme steps now follow SHELL-006-A (dark device first) and
SHELL-006-B (explicit Light survives a device change and reload); the zero-request
check waits instead of relying on `networkidle` after client navigation; compact
layout no longer reorders the owner block visually against tab order; `ThemeContext`
applies `data-theme` in a layout effect so the dark-first tokens do not flash for a
light choice; Biome formatting of the spec; task file name. Kept: only the Wallets
placeholder link is followed in the browser; the other three hrefs are asserted.

## Unrun checks

Full `pnpm test:e2e`, critical acceptance, real PostgreSQL probes (no data path
changed) and the release image gate: hosted CI only.

## Hosted CI

Run 37214714966 on `dc50e4f6ec66dfe3fcc6ff9934a5ca45a64632da`: all 10 jobs succeeded
(backend/frontend lint, build and tests, specification and engineering gates,
production dependency audit, Release Images and Security with critical acceptance,
CI Status). The change was archived afterwards with the installed CLI.
