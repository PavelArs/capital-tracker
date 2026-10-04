## 1. Contract and acceptance

- [x] 1.1 Strict-validate the change and record the frontend baseline (tests, lint, build).
- [x] 1.2 Add frontend unit acceptance: `Layout.test.tsx` (SHELL-001 order and Legacy group, SHELL-002 names, SHELL-007 slot), `SectionPlaceholder.test.tsx` (SHELL-005 text, link, no request), `SettingsPage.test.tsx` (SHELL-006 A/B with a controllable `matchMedia`); run them and record the expected failures before implementation.
- [x] 1.3 Rewrite the critical `SHELL-UI` Playwright case for the new shell under its existing title (login lands on `/dashboard`, sections, placeholders, Legacy, theme setting, 360/768/1280/1440, logout) and replace shell control names (`Main navigation`, `Skip to content`, `Menu`, `Log out`) in other specs; browser RED/GREEN comes from hosted CI because Docker is unavailable in the sandbox.

## 2. Implementation

- [x] 2.1 Add shell tokens (dark and light) and the new `Layout` with sections, Legacy group, sync slot and owner block, keeping the compact menu contract (SHELL-001, SHELL-002, SHELL-007).
- [x] 2.2 Add routes and placeholder pages for Dashboard, Portfolio, Transactions and Wallets; root redirects to `/dashboard` (SHELL-005).
- [x] 2.3 Add Settings at `/preferences` with the System / Dark / Light control on `ThemeContext` (SHELL-006).

## 3. Review and verification

- [x] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [x] 3.2 Run frontend lint, build and unit tests, backend unchanged checks as needed, and strict OpenSpec locally; capture screenshots (dark and light, 1440 and 1280); record what ran where in `verification.md`.
- [x] 3.3 Archive with the installed CLI only after hosted critical acceptance is green, and confirm canonical spec sync.
