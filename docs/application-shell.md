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
| `/liabilities/*` | `/portfolio` |
| `/crypto`, `/wallet-addresses` | `/wallets` |
| `/owned-transfers` | `/transactions` |
| `/settings` | `/preferences` |

The old asset screens under `/assets/*` have no redirect: the web server serves the built
bundle under that prefix (`deploy/container-nginx.conf`), so they were only ever opened
from inside the app and a reload there already answered 404.

Theme: System is the default and follows the device; Dark or Light is stored in this
browser (`localStorage.theme`) and survives reload. The shell and new pages use the
prototype's tokens (`frontend/src/features/shell/tokens.css`), dark first, system font.

The sidebar foot holds the sync status (M11, from `GET /api/sync-status`): "All synced"
with the last successful sync, "Syncing…", or "N sources need attention" with the
others' last sync and each reason in its tooltip; it opens Wallets. Then comes the owner block with **Log out**. Below 960 px the sidebar becomes one slim bar
(brand, owner avatar, **Log out**) over a swipeable strip of the five sections, with the
Legacy links at its end; the current section is scrolled into view, there is no menu button,
and the sync status and the owner's email stay on the wide layout (the header bell and Wallets
already say what needs attention). **Skip to content** jumps to the main area. Desktop 1440
and 1280 show the full sidebar. On phones (under 560 px) a page header is the title, then the
currency switch with **Add transaction** on one row, then the page's own buttons.

The bell in every page header (between the currency switch and **Add transaction**) holds what
needs the owner: old prices or rates, blockchain transactions to classify, wallets that failed
to sync and wallets whose balance differs from their transactions. It shows the count and, on a
click, a panel (a popover on wide screens, a sheet over the page on phones) with one row and one
action per problem, or "Everything is up to date". The shell reads the sources once for all
pages (`features/shell/attention-context.tsx`) and again every minute and after a sync or an
answer.

The earlier Russian shell is described in the archived change
`2026-09-26-redesign-application-shell`. Verification for this change is in
`openspec/changes/archive/2026-10-04-add-app-shell/verification.md` (hosted CI run
37214714966 green).
