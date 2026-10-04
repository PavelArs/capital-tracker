## Why

The owner accepted a new information architecture for Personal Capital Tracker on
2026-10-04 (business requirements, `docs/product-requirements.md` change M1 and the
clickable prototype): a left sidebar with Dashboard, Portfolio, Transactions, Wallets
and Settings, English UI, dark-first theme. Every later screen (M2 onward) lands in
that shell, so it has to exist first, without hiding any screen the owner uses today.

## What Changes

- New application shell: left sidebar (232 px) with the five new sections in this
  order, a "Legacy" group holding every current screen, a sync indicator slot and the
  owner block with logout. English chrome: `Main navigation`, `Skip to content`,
  `Menu`, `Log out`.
- New routes `/dashboard`, `/portfolio`, `/transactions`, `/wallets` and
  `/preferences` (Settings). Until their own changes ship, the first four show an
  honest "coming next" state that names the legacy screen to use meanwhile.
- After login the private root opens `/dashboard` instead of `/manual-accounts`.
- Settings shows the theme choice System / Dark / Light; System is the default and
  follows the device. Existing preference storage (`localStorage.theme`) is reused.
- New design tokens from the accepted prototype (dark first, light variant) applied
  to the shell and new pages. Legacy screens keep their own styles and Russian text
  (decision D6).
- Legacy screens stay reachable under "Legacy" with unchanged URLs and labels:
  Ручные счета, Переводы между счетами, Вводы и выводы, Ручные цены, Адреса
  кошельков, Прибыль за период, Настройки, Прежний обзор, Активы, Криптокошельки.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `application-shell`: SHELL-001 entry and grouping change (root opens the new
  Dashboard; current screens move under "Legacy"); SHELL-002 keeps its accessibility
  contract with English control names; new SHELL-005 (five sections and honest
  placeholders), SHELL-006 (theme setting) and SHELL-007 (sync indicator slot).

## Impact

Frontend only: `App.tsx` routes, `components/Layout.*`, new `features/shell/` pages
and tokens, unit tests, and the E2E text of shell controls (`Main navigation`,
`Skip to content`, `Menu`, `Log out`) in existing specs. SHELL-UI is rewritten for the
new shell under its existing critical title, so the critical manifest is unchanged.

Data impact: none. No migration, schema, API, backend, dependency, lockfile or
`frontend/nginx.conf` change. Theme preference stays per browser in `localStorage`;
the `owner_settings` entity in the product requirements is left to the change that
first needs a server-side setting (M5 base currency).

Depends on: nothing (first change of the M1–M22 order). Later changes M2, M8, M10 and
M18 replace the placeholders.

Non-goals: dashboard numbers, base-currency switch, "Add transaction" button,
notification bell, real sync status, mobile layout redesign, new login look,
retiring or redirecting any legacy route, translating legacy screens.
