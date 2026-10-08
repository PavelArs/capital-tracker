# Application shell

Status: change `add-app-shell` (M1 of [product requirements](product-requirements.md)
once PR #37 lands; visual reference is the owner-accepted prototype of 2026-10-04).

After password and TOTP the app opens **Dashboard**. The left sidebar lists the new
sections in this order:

| Section | URL | State in M1 |
|---|---|---|
| Dashboard | `/dashboard` | placeholder, links to manual accounts |
| Portfolio | `/portfolio` | placeholder, links to manual accounts |
| Transactions | `/transactions` | placeholder, links to manual accounts |
| Wallets | `/wallets` | placeholder, links to wallet addresses |
| Settings | `/preferences` | theme: System / Dark / Light |

Placeholders say the section is not built yet, show no numbers and make no requests.
Their own changes replace them (M2/M4, M6, M8, M10, M18).

**Legacy** (open by default, collapsible) holds the screens no new section covers yet,
with their Russian names and unchanged URLs: manual accounts (CSV import, swaps) and manual
prices. Legacy screens keep their own styles and language (decision D6). M20 retired the
others; their old URLs open the section that replaced them:

| Old URL | Opens |
|---|---|
| `/legacy-overview`, `/capital-flows`, `/period-profit` | `/dashboard` |
| `/assets/*`, `/liabilities/*` | `/portfolio` |
| `/crypto`, `/wallet-addresses` | `/wallets` |
| `/owned-transfers` | `/transactions` |
| `/settings` | `/preferences` |

Theme: System is the default and follows the device; Dark or Light is stored in this
browser (`localStorage.theme`) and survives reload. The shell and new pages use the
prototype's tokens (`frontend/src/features/shell/tokens.css`), dark first, system font.

The sidebar foot holds the sync status (M11, from `GET /api/sync-status`): "All synced"
with the last successful sync, "Syncing…", or "N sources need attention" with the
others' last sync and each reason in its tooltip; it opens Wallets. Then comes the owner block with **Log out**. Below 960 px the sidebar collapses behind
**Menu** (Escape closes it and returns focus); **Skip to content** jumps to the main
area. Desktop 1440 and 1280 show the full sidebar.

The earlier Russian shell is described in the archived change
`2026-09-26-redesign-application-shell`. Verification for this change is in
`openspec/changes/archive/2026-10-04-add-app-shell/verification.md` (hosted CI run
37214714966 green).
