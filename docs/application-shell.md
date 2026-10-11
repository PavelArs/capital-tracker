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

There is no Legacy group in the sidebar and no Older screens card in Settings (G1). The manual
accounts and manual prices screens are gone: accounts are made in Add asset ("New account…") and
Add wallet, and the price of a hand-valued asset is changed with **Update price** on its asset
page. Their old URLs and those of the screens M20 retired open the section that replaced them:

| Old URL | Opens |
|---|---|
| `/legacy-overview`, `/capital-flows`, `/period-profit` | `/dashboard` |
| `/liabilities/*` | `/portfolio` |
| `/crypto`, `/wallet-addresses` | `/wallets` |
| `/owned-transfers` | `/transactions` |
| `/manual-accounts/*` | `/wallets` |
| `/manual-prices` | `/portfolio` |
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
(brand, owner avatar, **Log out**) over a swipeable strip of the five sections; the current
section is scrolled into view, the bar stays pinned to the top while the page scrolls, there is no menu button,
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

## Lists of twenty that grow, and answers kept across a reload

Every long list shows twenty rows and adds twenty more as the owner nears its end
(`features/shell/InfiniteScroll.tsx`: an IntersectionObserver, with a **Show more** button for a
keyboard and a screen reader, and "Showing 20 of 63" under the rows): Transactions (the day
headings and the phone layout continue under the rows already there; a transaction opened from
another page, or the next one to classify, grows the list to it), History (older changes are
asked for with the server's cursor), the Portfolio assets table, Wallets, a wallet's addresses,
assets and transactions, an asset's transactions, the proposals above Transactions, a wallet's
sync history, its token lists and the transactions in the address drawer. The rows already on
screen never go away while the list is open, so an open row and the scroll position stay put; a
changed filter or search starts again at twenty. A reload of the tab brings Transactions back with
the rows that were on screen and at the same scroll position (kept per tab in `sessionStorage`,
counts and offsets only); the other lists start again at twenty. A list that fits twenty has no
control. The server API is unchanged: the lists are cut in the browser, because the
filters, the chip counts and the classification flow need the whole list.

The last answer of each read is kept in memory for the session and, for the signed-in owner, in
the browser's IndexedDB (`api/read-cache.ts`, `api/read-store.ts`). After a reload the pages
paint those answers at once, and an answer fetched less than five minutes ago is used as it is
without asking the server. Anything older than fifteen minutes is dropped. Every change the
owner makes, a classification, a sync, a background sync that finished since the last status
read, a sign-in, a sign-out or a refused session empties it, in memory and in the browser. An
answer kept for another owner is never used and is deleted. Where the browser has no IndexedDB
or refuses it, the cache stays in memory as before.

The earlier Russian shell is described in the archived change
`2026-09-26-redesign-application-shell`. Verification for this change is in
`openspec/changes/archive/2026-10-04-add-app-shell/verification.md` (hosted CI run
37214714966 green).
