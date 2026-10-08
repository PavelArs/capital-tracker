# Critical release acceptance coverage

The shortened profile is an owner-authorized real acceptance path for the manual +
CSV release. It is intended to preserve the highest-risk finance and authentication
journeys while keeping the existing full regression suite available. The reviewed
source inventory at `/private/tmp/capital-critical-profile-inventory.md` maps the
browser candidates and real PostgreSQL probes; it is planning evidence only. The
implementation, CI wiring, 20-case manifest and receipt contract are source-complete
at `0823122ec202f7fd69e3bb89711200a6214b1949` and independently approved; 196 Jest
checks and four Node acceptance checks passed. The hosted/runtime profile remains
unrun, so this document reports no release acceptance pass.

## Browser journeys selected

The reviewed selection contains 32 manifest entries: the original 19 browser cases,
CSV-006-B session-renewal recovery, since 2026-10-03 ADDR-UI wallet-address import and,
since 2026-10-04, PORTFOLIO-UI whole-portfolio valuation, CURRENCY-UI three-currency accounting
and CHART-PERIODS portfolio snapshots on the dashboard, and since 2026-10-05 OPS-UI operations
list, FLOW-SPLIT-UI market versus flows and MANUAL-OPS-UI manual operations, WAL-UI wallets
bound to accounts, CLS-UI blockchain transaction classification, since 2026-10-06, XFER-UI
transfers between own wallets and, since 2026-10-08, RESET-UI password reset by email and SEC-UI security settings. Each entry may cover more than one scenario ID; these are
browser journeys over the actual frontend, proxy, backend and isolated PostgreSQL,
using synthetic owner data and provider fixtures.

| Scenario IDs | Critical assertion retained |
|---|---|
| MFA-002-A/B | Password alone leaves private data denied; TOTP plus CSRF establishes the owner session. |
| SES-001-B | Logout revokes a copied session credential and replay fails. |
| SES-002-A | Missing CSRF or foreign Origin cannot read owner currencies or change preferences. |
| OPEN-001-A / OPEN-002-A | Opening amounts preserve the distinction between unknown and zero cost across restart/history. |
| TRADE-003-A / TRADE-006-A | FIFO proceeds, cost and profit stay exact; pending edits lock; restart and correction history remain consistent. |
| SWAP-UI | A committed exchange survives lost response and SPA remount without duplicate posting. |
| REWARD-UI | Unknown basis and zero remain distinct; category and receipt-bound retry intent persist. |
| TRANSFER-UI | Review, retry, correction and terminal void preserve transfer receipts and basis. |
| CSV-006-A | Sale-first import preserves FIFO/provenance and replay safety; whole-batch rollback works. |
| FLOW-004-A | Flow initialization, contribution, correction and review remain distinct from trades. |
| PRICE-UI / PRICE-RECOVERY | Price retry preserves a committed command; late responses cannot overwrite newer state. |
| VAL-UI | Account totals remain exact and refresh/late replies preserve the trade draft. |
| VCH-UI | Empty and zero chart history render correctly; late period replies do not lose drafts or show stale data. |
| MPV-UI | Selected portfolio totals and missing-price gaps are accurate; stale replies are ignored. |
| PROFIT-UI / PROFIT-LATE | Profit preview stays tied to reviewed inputs after edits, errors and delayed replies. |
| XIRR-UI / XIRR-LATE | Available/unavailable rates stay tied to reviewed inputs. |
| TWR-UI | Return handles missing flow valuation and invalidates delayed stale results. |
| SHELL-UI | Owner MFA login/logout, responsive keyboard access and honest legacy scope. |
| CSV-006-B | A committed CSV confirm survives session expiry, 401, MFA reauthentication and SPA return without duplicate posting. |
| ADDR-UI / ADDR-PRIVATE | Bitcoin address history imports through the Esplora fixture in three pages; anonymous, missing-CSRF and foreign requests are denied; every USD value is shown as missing, never zero. |
| PORTFOLIO-UI | Whole-portfolio value, average buy price, cost basis, unrealized and realized P&L and allocation come from real accounts and a stored price; anonymous and query-carrying reads are refused. |
| CURRENCY-UI | The main currency saved in Settings survives logout and MFA login; the Portfolio and Asset screens show value, cost and P&L in EUR and RUB from stored Bank of Russia rates, cost at the purchase date's rate; anonymous, missing-CSRF and unknown-currency requests are refused. |
| CHART-PERIODS / SNAP-REBUILD / DASH-MAIN | The dashboard opens on one month and shows the net worth, change and chart the backend returned, the five largest held assets and the allocation the valuation returned, and the attention block once its checks answered; each period 24H, 7D, 1M, 3M, 1Y and ALL asks once and stays inside its range; ALL starts on Jan 1, 2025; a backdated buy rebuilds later daily snapshots by exactly its value; anonymous and unknown-query reads are refused. |
| OPS-UI | A manual buy, a CSV-imported buy and an Esplora-fixture chain receipt appear in one Transactions list with date, type, asset, amount, value, account, status and source; asset and status filters leave only matching rows; the drawer shows the raw chain facts; anonymous and query-carrying reads are refused. |
| FLOW-SPLIT-UI / FLOW-SPLIT-DEPOSIT / FLOW-SPLIT-MIXED / PROFIT-ALL-TIME | A buy paid from outside adds its gross plus fee to the month's deposits and a sale its net proceeds to withdrawals; market effect is the change minus net flow; net invested steps by exactly those amounts; profit to date is net worth minus all-time net invested in every period; the dashboard shows that profit line, the period's market and net-deposit split and the net invested line the backend returned. |
| MANUAL-OPS-UI / OPS-ADD-BUY / OPS-OVERSPEND / OPS-DELETE-GUARD / OPS-DELETE | A buy saved in the Add transaction window starts the journal of an account that had none; a sale shows what the account holds on its date, refuses more and fills it with Use all; deleting the purchase later sales spend is refused naming the sale and changes nothing; a confirmed deletion removes the sale from the list and its history keeps the void. |
| WAL-UI / WAL-NO-SECRETS / WAL-DUP / WAL-ACCOUNT / WAL-PAGE / WAL-RENAME / SYNC-RECONCILE / SYNC-STATUS | Add wallet clears a pasted seed phrase without sending it and refuses an Ethereum address; a Bitcoin address joins a new wallet with a name, its whole Esplora-fixture history loads, the chain balance shows and differs from the wallet's recorded transactions; adding it again opens the wallet that tracks it; renaming it in the drawer is stored; at 390 px the rows fit without horizontal scroll; with prices synced 12 minutes ago, a sync refused by the provider (503) is stored as failed, so after a reload the row says "Sync failed" with the reason and the age of the shown balance, and the sidebar says "1 source needs attention" and "Others synced 12 min ago"; the wallet's own page lists the address and its chain transactions, renaming the wallet keeps the address in it, and Transactions names the wallet and address on its chain rows. |
| CLS-UI / CLS-COUNT / CLS-BUY / CLS-HIDE / CLS-RESYNC / CLS-RECLASSIFY | The sidebar and the Dashboard count blockchain transactions to classify and Review opens them; a receipt of a wallet bound to an account is classified as a buy paid in USDT with only the fields a buy needs, and the next one of that wallet opens with only outgoing types; a payment is hidden without a type; the list shows the buy's value and the Hidden status without a second row for the recorded buy; a resync keeps both answers; changing the buy to income starts from the saved answer; at 390 px the rows fit without horizontal scroll. |
| XFER-UI / XFER-AUTO / XFER-CAPITAL / XFER-MANUAL | Two addresses in two wallets share one transaction: once the receipt that funded the sender is a buy, the send and the receipt are one transfer between the wallets that nobody had to classify, listed once as sender → receiver with "Auto: own wallets" and the drawer note; the receiver's coins keep the sender's cost basis and only the network fee leaves; a send to an unregistered address is linked by hand to a manual exchange wallet, which then holds the coins at their cost with no deposit; at 390 px the rows fit without horizontal scroll. |
| SEC-UI / SEC-CODES / SEC-SESSIONS | Two browsers signed in with recovery codes appear in Settings → Security as "Chrome on Linux" (this browser) and "Safari on iPhone" with 8 of 10 codes unused; a TOTP from the authenticator makes ten new codes shown once, the dialog closes only after "I have saved these codes", the count reads 10 of 10 after a reload and an old code no longer completes a sign-in; "Log out everywhere" ends both browsers, this one returns to the login page and no owner session remains. |
| RESET-UI / RESET-REQUEST / RESET-USE / RESET-REUSE / RESET-LIMIT | "Forgot password?" on the login page asks for an email; an unknown and the owner's email get the same 202, body and "Check your email" page, and only the owner's request delivers one message through the synthetic Yandex SMTP fixture with a link that lives 30 minutes; the link sets a new password, the other browser's session is signed out, the used link is refused, the old password fails and the new one still needs the TOTP code; past the per-client limit a request is refused with Retry-After and no link is made or sent. |

The separate inventory identifies additional browser coverage not selected here:
two-replica competing-sale/initialization journeys, browser-visible persistent lockout
and expiry, and safe HTTPS 500 presentation for deferred opening rollback. Their core
database invariants remain in real PostgreSQL probes; the additional browser layer
covers replica/HTTPS/SPA presentation behavior. This is a narrower browser set, not a
claim that those broader tests are absent or previously passed.

An independent source review inspected handlers for the 19 selected entries and
CSV-006-B. It found only unchanged `route.fetch` responses or browser delivery loss
after a real backend response, with no synthetic own-backend or authentication
decision in those inspected handlers. This is a bounded source audit, not a blanket
claim about every test file, nor execution evidence.

## Acceptance gates outside the browser selection

The browser profile is not a substitute for the existing real PostgreSQL acceptance
probes. The runner must retain the populated migration and auth-limit fixtures,
`manual-opening-db`, `usd-trades-db`, `csv-import-db`, `mfa-db` and other applicable
domain PostgreSQL probes, migration checks, seed/readiness checks and startup refusal
checks. These exercise persistence, concurrency, rollback and authentication state at
the database/service boundary. Synthetic external provider fixtures and the real
transport/TLS checks remain part of acceptance; external providers themselves are not
live-tested.

CLI MFA/session checks and release-artifact/network/image checks also remain mandatory.
They verify actual command behavior and the built delivery boundary, respectively.
The command is `pnpm test:e2e:critical`; it writes
`test-results/critical-release-acceptance.json`. The candidate-bound receipt records schema
version, profile, commit, CI run ID, manifest SHA-256, and each selected file/title
with its passed status. CI verifies the receipt against the exact source, run and
manifest and requires the named critical gate before candidate export/promotion.
Receipt verification proves the selected browser cases ran and passed; it does not
by itself prove the separate database/provider/CLI/artifact runner gates or
backup/restore and server gates passed. Runtime execution remains unrun.

The full `pnpm test:e2e` suite and all existing test files remain available for broad
regression and the full release profile. The historical full-suite count is 174 test
cases; a shortened-profile pass does not claim those 174 passed. Cleanup of redundant
coverage remains separate work and must preserve meaningful assertions before any
later removal.

Encrypted backup/restore is a separate release gate, not part of the acceptance
runner. `scripts/manual-mvp-release.sh` performs encrypted database backup, isolated
disconnected restore and fingerprint comparison. Off-host custody/key recovery and
the real-server restore/deployment checks remain separate operational evidence.

## Evidence status

This map is source-planning documentation. It records no new runtime result, CI pass,
candidate artifact, promotion or deployment. Consult
[`docs/deployment-security-verification.md`](deployment-security-verification.md)
for the current release checkpoint and required host/backup gates.
