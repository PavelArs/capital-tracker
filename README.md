# Capital Tracker

> Brownfield refactor in progress. Read [the audit](docs/brownfield-audit.md) before
> starting against existing data. Explicit migration preflight refuses unsafe legacy upgrades.
> Production deployment is disabled by default and is not release-ready.
> The target contract is [the refactor brief](capital-tracker-openspec-prompt.md).
> The owner's current product target (2026-10-04) is the [business requirements](docs/business-requirements.md)
> and the derived [product requirements and change order](docs/product-requirements.md).

## Verification during the refactor

Use Node 26.12.1 (`nvm use`) and pinned pnpm 12.9.1:

```bash
pnpm install --frozen-lockfile
pnpm verify:baseline
pnpm audit:production
```

This runs specification validation, lint, builds and Jest/Vitest checks. It covers source-level checks. Run `pnpm test:e2e` for isolated real images, PostgreSQL
and HTTPS Chromium verification; security scans and recovery are still pending. See
[provider feasibility](docs/provider-feasibility.md) and the active OpenSpec change
for limits and actual evidence. See [testing and migrations](docs/testing-and-migrations.md)
for exact isolated commands and migration requirements. See [owner provisioning](docs/owner-authentication.md)
for existing-user adoption, recovery and the current cookie/CSRF/MFA contract.
The required production dependency audit fails on high/critical findings or registry
errors. See [dependency security](docs/dependency-security.md) for the dated results
and remaining lower-severity findings.
The verified [manual accounting](docs/manual-accounting.md) slice passed real
PostgreSQL checks and all 85 HTTPS Chromium cases, including 74 retained cases.
The [USD trade journal](docs/usd-trade-journal.md) passed all 101 HTTPS Chromium
cases (85 retained and 16 new), plus real PostgreSQL and migration checks.
The [reviewed CSV import](docs/csv-imports.md) slice (its screen and endpoints were removed on 2026-10-10; stored batches stay readable) added explicit mapping, whole-batch
preview/confirmation, retained source provenance and conditional rollback to the USD
journal. All 124 HTTPS Chromium cases passed (101 retained and 23 new), together
with real PostgreSQL and migration checks. Full release hardening and the remaining
accounting scope are still pending.
The verified [known-cost opening lots](docs/known-cost-carry-in.md) slice passed all
133 HTTPS Chromium cases (124 retained and nine new), real PostgreSQL/migration
checks and independent review. Remaining accounting/history/provider work and full
release hardening are still pending.
The [historical accounting view](docs/historical-accounting.md) reconstructs exact
positions and FIFO cost at a selected instant from the current corrected journal.
Its targeted verification passed seven new and two retained critical HTTPS cases,
plus real PostgreSQL checks; the complete 140-case browser suite was not rerun under
the owner's updated testing policy. Remaining product and release work is pending.
The [external USD flow journal](docs/external-usd-flows.md) records explicit
contributions/withdrawals with exact period totals, immutable correction history
and safe original-command recovery. Four new and two retained critical HTTPS
scenarios, real PostgreSQL and populated-schema migration checks passed. It does
not yet calculate portfolio profit, XIRR or TWR.
The bounded [TWR preview](docs/endpoint-twr.md) adds period returns for reviewed
manual endpoints when no intermediate net external flow needs another valuation.
Missing intermediate valuations produce an explicit unavailable result. General
linked TWR and automatic portfolio performance remain pending.
Original project folders/data remain untouched.

Capital tracking application with manual-account workflows and retained legacy asset, crypto-wallet and financial-metrics screens during the incremental refactor.

The [application shell](docs/application-shell.md) follows the owner-accepted
prototype (change M1 of `docs/product-requirements.md`): an English left sidebar with
Dashboard, Portfolio, Transactions, Wallets and Settings, and every current screen
under "Legacy" with its URL unchanged. New sections are placeholders until their own
changes ship.

## Tech Stack

- **Backend:** NestJS, TypeScript, TypeORM, PostgreSQL, Redis
- **Frontend:** React, Vite, TypeScript, Chart.js, i18next (EN/RU)
- **Tooling:** pnpm, Biome (lint + format), Jest/Vitest
- **Infrastructure:** Docker Compose, GitHub Actions CI/CD, ghcr.io, nginx

## Features

- **Legacy Assets** - CRUD with Stock (balance sheet) and Flow (income) asset types, multi-currency support
- **Saved Liabilities** - Records and the private API are retained; the retired editor is replaced by a notice linking old bookmarks to manual accounts
- **Crypto Wallets** - Bitcoin and Ethereum address tracking with live balance updates, ERC-20 token support
- **Financial Metrics** - Net worth, runway, FL-ratio (passive income coverage), category distributions
- **Dashboard** - Charts, history (30 days), dynamic currency selector
- **Auth** - CLI-only owner bootstrap/recovery and MFA enrollment, Argon2id, mandatory TOTP or single-use recovery codes, revocable PostgreSQL cookie sessions and CSRF protection
- **Exchange Rates** - Auto-updated fiat and crypto rates, Redis-cached

## Quick Start

### Prerequisites

- Node.js 26+
- pnpm (`corepack enable`)
- Docker and Docker Compose
- PostgreSQL + Redis (or use Docker)

### Development

Use the disposable HTTPS acceptance stack below for complete authenticated checks.
For source development, configure a separate disposable PostgreSQL/Redis instance,
run explicit migrations and provision its owner as described in
[owner authentication](docs/owner-authentication.md). The CLI requires all current migrations, a protected server MFA key and confirmed CLI
enrollment; the additive accounting migrations preserve existing data.

`FRONTEND_URL` must be the exact HTTPS browser origin, without a trailing slash or
path. Use `VITE_API_URL=/api` through an HTTPS proxy forwarding to the backend.
`pnpm --dir backend dev` and `pnpm --dir frontend dev` provide source watch servers,
but their HTTP ports alone cannot support Secure-cookie login. The acceptance
origin is `https://127.0.0.1:8443`; `localhost` is a different origin.

### Docker acceptance stack

```bash
# Build and verify the disposable stack with release images, HTTPS and PostgreSQL
pnpm test:e2e

# Production rollout remains disabled pending release hardening.
# Check the active change's verification record for actual results.
```

The legacy `docker-compose.override.example.yml` is not compatible with the current
HTTPS authentication path and is not the supported acceptance setup. Its services
still require a separately configured TLS proxy and disposable database. Prefer
the isolated acceptance stack; never use legacy production Compose for tests.

## Common Commands

### Backend (`cd backend`)

| Command                   | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                | Start dev server with watch mode                            |
| `pnpm build`              | Build NestJS application                                    |
| `pnpm test`               | Run tests with coverage                                     |
| `pnpm lint`               | Biome lint + format check                                   |
| `pnpm check`              | Auto-fix lint + format issues                               |
| `pnpm migration:generate` | Generate TypeORM migration                                  |
| `pnpm migration:run`      | Explicit preflight and migration; requires DB_* environment |

### Frontend (`cd frontend`)

| Command      | Description                         |
| ------------ | ----------------------------------- |
| `pnpm dev`   | Start Vite dev server               |
| `pnpm build` | TypeScript check + production build |
| `pnpm test`  | Run tests with coverage             |
| `pnpm lint`  | Biome lint + format check           |
| `pnpm check` | Auto-fix lint + format issues       |

## Architecture

```
backend/src/
  auth/           Owner provisioning, Argon2id, cookie sessions, CSRF/default-deny
  assets/         Asset CRUD (Stock/Flow types)
  liabilities/    Liability CRUD
  crypto/         Wallet tracking, balance updates, price fetching
  currencies/     Exchange rates, currency preferences (Redis-cached)
  metrics/        Net worth, runway, FL-ratio calculations
  cache/          Redis cache module
  health/         Health check endpoint
  observability/  Prometheus metrics, JSON request logging with request ids
  entities/       TypeORM entities
  migrations/     Database migrations

frontend/src/
  pages/          Manual accounting, retained legacy screens and retired-liability notice
  components/     Reusable UI components
  features/       Feature-specific components (asset cards, wallet forms, etc.)
  contexts/       Auth, Error, Theme contexts
  api/            Axios API layer
  i18n/           English and Russian locales
```

## Production Deployment

### Infrastructure

The app is designed to run on a personal server with:

- **nginx** on the host for TLS termination and reverse proxy
- **Docker Compose** for services (postgres, redis, backend, frontend)
- **GitHub Actions** CI/CD with ghcr.io container registry

### Setup

1. Configure GitHub Actions secrets:
   - `DEPLOY_SSH_KEY` - SSH private key for server access
   - `DEPLOY_HOST` - Server IP or hostname
   - `DEPLOY_USER` - SSH user
   - (Optional) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` for deploy notifications

2. On the server:

   ```bash
   # Create app directory
   mkdir -p /opt/capital-tracker
   cd /opt/capital-tracker

   # Create .env with production values
   cat > .env << EOF
   DB_USERNAME=postgres
   DB_PASSWORD=<strong-password>
   DB_NAME=capital_tracker
   FRONTEND_URL=https://<your-domain>
   EOF
   ```

3. Copy and configure nginx:

   ```bash
   cp deploy/nginx.conf /etc/nginx/sites-available/capital-tracker
   # Edit: replace <your-domain> with your actual domain
   ln -s /etc/nginx/sites-available/capital-tracker /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

4. Production rollout is disabled by default. Do not enable `PRODUCTION_ROLLOUT_ENABLED`
   until the release-hardening change and isolated recovery tests are complete and
   the owner explicitly authorizes rollout. The retained manual workflow is legacy
   containment, not an approved release procedure.

### CI/CD Pipeline

- **CI** (PRs and pushes to main): lint, test, build, Docker builds and engineering/security gates; aggregate requires every job to succeed.
- **CD**: legacy manual workflow gated by main branch and explicit rollout variable; disabled by default pending release hardening. It still has known backup, artifact and deployment limitations documented in the audit.

## API Endpoints

These are backend paths; the HTTPS proxy exposes them under `/api/`. No HTTP
Swagger/documentation endpoint is mounted, including in development.

| Group       | Endpoints                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | `GET /auth/csrf`, `POST /auth/login`, `POST /auth/mfa`, `GET /auth/me`, `POST /auth/logout`                                         |
| Capital returns | `POST /accounting/accounts/:accountId/capital-returns/:id/voids` takes `{requestId, expectedJournalRevision}` and removes an imported capital return through an immutable void version (201; the same command replays its receipt with 200). The owner accounting lock and journal revision protect concurrent changes; deletion is refused when later spending needs the returned cash. |
| Accounting  | `GET /accounting/operations` uses `source: broker` for imported trades, rewards and capital returns; `GET /accounting/audit-history` uses `actor: broker` for their initial versions (later owner changes remain `owner`). `/accounting/...`: accounts, instruments, trades, operations, transfers, chain transactions, proposed transfers and duplicates, manual prices (`POST /accounting/instruments/:id/usd-prices` takes `priceUsd`, or `price` with `currency` USD, EUR or RUB; a hand value keeps the currency it was set in; in the price list each price states its own `quoteCurrency`, and the list's `quoteCurrency` is the asset's valuation currency), portfolio value and history; `GET /accounting/hidden-assets` and `PUT`/`DELETE /accounting/hidden-assets/:id` hide an asset from the portfolio and show it again; `GET /accounting/accounts` gives each account's `connection`: `{ provider: 'tbank', imported }` for a broker account read with a T-Bank token (`imported` says whether a history import was written into it), otherwise null; never the token or the T-Bank account number; `DELETE /accounting/accounts/:id` stops tracking a wallet that holds no recorded transaction; `GET /accounting/accounts/:id/trades/:tradeId/void-check` names the later operation a deletion of that trade would leave short (`dependent`, or null) without changing anything, and a trade refused because it is itself larger than the account holds says `An account does not hold enough for this trade` |
| Deposits    | `/deposits`: bank deposits entered once with their terms (`GET`/`POST /deposits`, `GET`/`DELETE /deposits/:id`); `kind` is `term-deposit` (the default, with an end date and a rate) or `account` (a savings or current account: no end date, payout `daily` or `monthly`, `ratePercent` optional and `null` when none is entered, so no rate is shown or counted: an account whose rates do not reach back to its opening day answers `interestMissing: true` (the interest of the days before its first rate is unknown, not 0), and on a day with no rate in force `accrued`, `due`, `interestEarned` and `nextPayout` are `null` and the balance is only what was put in less what was taken out; cumulative `due`, `interestEarned` and `interestPosted` stay null after a later first rate; noncapitalizing accounts can state independently covered current accrual, nominal periods and forecasts, but their period gains after inflation stay null while earlier interest is missing; capitalized accounts suppress every dependent interest figure and period because the missing interest would itself earn interest; `interestPaidOut` keeps recorded payout amounts; incomplete account history omits the exact-value chart and per-asset portfolio shares; missing-rate movement leniency applies only to capitalized principal withdrawals or noncapitalized interest payouts; an explicit `0` rate from the opening day clears it; the list's `interestMissingCount` and the portfolio's `interestMissingDepositCount` say how many such accounts the totals count that way); `POST /deposits/preview` takes the body of `POST /deposits` without `requestId` and returns, without reading or writing anything, the balance and interest at the end of the term (`atMaturity`, `null` without an end date) and the first interest date with its interest and whether it is added to the deposit or paid out (`firstPayout` with `treatment` `capitalized` or `payable`, `null` when no interest date comes by the end of the term, or within four months without one) as exact decimal strings, and answers 422 for a start date after today in Moscow; `POST /deposits/:id/movements`, `DELETE /deposits/:id/movements/:movementId`, `POST /deposits/:id/rates` and `POST /deposits/:id/checks` record top-ups, withdrawals and interest paid out, a rate change and a balance read in the bank (creating a deposit, recording a movement and saving a check take a client `requestId`, and a retry of the same request returns the original result); interest and value in USD/EUR/RUB are computed on every read; deleted deposit, movement and check request IDs remain retired and cannot recreate data |
| Goals       | `/goals`: savings goals measured against the whole portfolio (`GET`/`POST /goals`, `GET`/`PUT`/`DELETE /goals/:id`); a goal holds a target sum in USD/EUR/RUB, an optional deadline, the expected yearly return and an optional monthly contribution (creating a goal takes a client `requestId`, and a retry of the same request returns the original goal; at most 20 per owner; replaying the request of a deleted goal returns 409). Progress, a verdict (`reached`, `on-track`, `behind`, `overdue`, `open`, `unknown`) and the pessimistic / base / optimistic cases (the base return ±4 points) are computed on every read: the monthly contribution a deadline needs (rounded up to the cent and paid on the same day each month, the first one a month from today), the months and date the plan reaches the target, the projected value and gap at the deadline, and for a goal without a deadline the value after ten years of payments (`projectedIn10Years`). `progress.percent` is the real share of the target, above 100 once it is passed, and `progress.stalePrices` counts the held assets valued at a stored market price older than 2 hours. The deadline is a Moscow day that counts in full: a goal is `overdue` from the next day, and an edit that keeps its date is accepted on and after it, while a new or moved date must be after today. `POST /goals/preview` takes the same terms without a name or `requestId` in the JSON body (plus an optional `goalId` from the edit dialog, so a kept date is judged as saving would judge it) and answers 200 with what a goal with these terms would show now (no `id`, `name` or `createdAt`), under the same deadline rules; it stores nothing, and the terms stay out of the URL. `GET /goals/:id/insights` returns completed-month net contributions, 3/6/12-month averages, estimated pace and one-year growth for the priced portfolio subset. `GET /goals/:id/forecast` gives the three cases month by month for the goal's chart: from today on each monthly payment day to the deadline (closing on the deadline itself, so the last point is the goal's projection there), or without a deadline until a year past the month the base case gets there (at least two years, at most fifty), every n-th month beyond 240 points; empty while the portfolio has no value in the goal's currency or once the deadline has passed; `stalePrices` counts the held assets the forecast valued at a stored price older than 2 hours |

| Brokers     | `/brokers/:accountId/connection`: the read-only T-Bank (T-Invest API) token of a broker account. `POST …/check` lists the open T-Bank accounts a token reaches, `PUT …` stores the token (encrypted with a key derived from the MFA key file, never returned) with the T-Bank account to read (409 when another broker account already reads that T-Bank account), `GET …` shows whether a connection exists (last four characters of the token, the T-Bank account, when it was saved), `DELETE …` removes it, `GET …/positions` lists what the saved token reads in that account now (nothing is recorded; T-Bank gives no positions for an Invest Box), `GET …/operations` lists every executed operation of that account's history, oldest first, with the filled quantity and the fills (date, quantity, price) of each trade and what each would become (buy, sell, bond repayment, income, fee, tax, deposit, withdrawal, transfer, or unsupported for a type it does not know) and counts of each (nothing is recorded), `GET …/import-preview` (or `POST` with optional owner-declared opening lots) lists the journal entries that history would become (a trade's broker fee joins it, counting a fee row that repeats another (same type and amount) once only when the trade's own commission is exactly that total, since T-Bank can list one fee twice; T-Bank times are kept to the whole second, since T-Bank stamps cash operations to the second and fills to fractions of one, so money that arrives in a second comes before money spent in it; an order filled at several times becomes one part per fill time, priced by its own fills, a later part named `<operation id>#<n>`; money paid in or out, taxes and other fees move cash; dividends and coupons are rewards of cash, each naming the share that paid it (`paidBy`); dollars and euros bought or sold on the exchange for rubles (`USD000UTSTOM`, `USD000000TOD`, `EUR_RUB__TOM`, `EUR_RUB__TOD`) are cash of that currency bought or sold with rubles (`cash`) and never combined, while other currencies and gold on the exchange are assets like securities; a bond paid back in full is a sale of every unit the history holds of it then, since T-Bank gives no quantity for repayments; a bond paid back in part is a capital return (`record: 'capital-return'`): the cash comes in as a lot of its own and the cost of the units held is lowered by the amount, spread over the units held then (each unit's share), never shown as income, and listed as not held when the history shows no units then; trades combined by Moscow day, then month, only when the account's trades would pass the 1000 limit, never across a sale and a buy of one share; rewards are never combined, and the preview says whether the trades fit the account's 1000 limit and whether the rewards and capital returns fit their journals, counting the owner's in every account), what it cannot record and why (including an amount whose sign does not fit its kind, a trade T-Bank gives no instrument type for, dollars or euros bought with the same currency, a trade or repayment that moved units for no money, a trade, fill or repayment with a negative quantity, an order whose fills miss part of its quantity or, at several times, lack a price above zero, differ in price currency or would leave a part costing less than the smallest unit, a dividend settled through a card (`DIV_EXT`), whose external payout needs reconciliation, and a sale of more than the history holds; buys of a share at the same instant as its sale count first, unless that order leaves the history short of cash or shares, when the operation order is used; the buys that may cover such a sale, up to the units it sold, are listed too, since whether they close a short or start a holding is unknown), whether the app account already holds history the import would add to (a standing trade, reward, swap or capital return, a transfer, an opening snapshot or carried-in history), what stands in the way of writing it (`problems`: a skipped operation that moved money or shares, an operation of that T-Bank account already imported into any account, no Bank of Russia rate for a date, an amount out of range, a sale whose fee is more than it brought, a sale or buy that spends more than the account holds then (a buy pays all it cost from the account's cash), too many rewards, capital returns or entries) and a `previewHash` that also pins the amounts at the rates stored then and those problems (nothing is recorded); `POST …/import` (`{requestId, previewHash}`) writes that history into the account's empty records in one command, only when the account holds no history and the history is still the one previewed: securities become assets priced by hand, named by their ticker (a T-Bank venue ticker such as `TITR@` reads as `TITR`), linked to their T-Bank instrument and asset UID for later imports (a later import in another account reuses the asset an earlier one linked to the same T-Bank asset UID, such as a fund held on the exchange in one account and on T-Bank's own venue in another, when one of its operations names the asset (current holdings carry no asset UID, and a link saved before asset UIDs were kept learns its asset only when an import names its instrument UID again), and is refused with 409 when T-Bank names that asset as another security type or the saved links disagree; the preview hash covers each operation's asset UID and the saved assets it resolves to), trades settle in the account's RUB, USD or EUR cash, and each T-Bank operation is recorded with the entry it became (201 with the receipt; a retry of the same request returns it with 200; 409 when the account holds history, the preview changed or a problem stands). A token that can trade is refused, so is a token for an account that is not the owner's live broker account. `POST /brokers/tbank/accounts` (`{token}`) lists the open T-Bank accounts one read-only token reaches (each says whether one of the owner's broker accounts already reads it; nothing is stored), and `POST /brokers/tbank/connect` (`{token, accounts: [{brokerAccountId, requestId, name}]}`) makes a broker account for each picked T-Bank account and connects it with the token, all in one transaction, so no token is entered by hand per account (201 when an account was made; a retry with the same request ids returns the accounts it made with 200 and writes nothing, so it never replaces a stored token; 409 when a T-Bank account is already read by another broker account, a request id was used for a different name or T-Bank account, or the account was removed or disconnected since; 422 when the token does not reach a picked account; a token that can trade is refused) A buy paid by card (`BUY_CARD`) spends the account's cash, since T-Bank lists the card's money as paid in just before it; a sale paid out to a card (`SELL_CARD`) records its proceeds outside broker cash. Reported non-virtual cash and security quantities must match the imported FIFO result in both directions, using explicit known-cost opening lots when earlier holdings are missing from returned trades. Import preview shortfalls identify the deficient asset and exact available, required and missing quantities; skipped operations include their ticker and order timestamp for reconciliation. Share, bond and ETF trading modes with the same documented position UID, and venues of the same documented asset UID (a fund bought on the exchange and sold on T-Bank's own venue), use one holding identity; the original provider UID and the canonical identity are both bound into the preview hash. Conflicting or ambiguous position metadata blocks import. CurrencyBy UID and ISO metadata distinguishes cash from gold or other currency-type assets; missing metadata blocks import; their quantities and metadata are pinned by the preview hash. External card dividends require reconciliation and block import. Import also stops when current holdings cannot be verified (including closed or Invest Box accounts), rather than treating unavailable positions as empty. |
| Inflation   | `GET /inflation` (per currency: the official source, the months it reaches, twelve-month inflation with `trailingYearEstimated` true when one of its twelve months is an estimate, the owner's own annual rate and typed-in months), `GET /inflation/factor?currency=&from=&to=&basis=official\|personal` (how many units at `to` buy what one unit bought at `from`; `estimated` marks a span past the latest month, over a month estimated before a later typed-in one, or on the owner's own rate), `PUT /inflation/personal-rates/:currency` (`{annualPercent}` or `null` to remove), `PUT`/`DELETE /inflation/months/:currency/:month` (a month's change in percent typed in by hand; it replaces the published one; `PUT` answers 400 for a month after the current Moscow month). `GET /accounting/portfolio/history` also returns `real`: the profit to date after official inflation and after the owner's own rate, with every deposit and withdrawal carried to today by the inflation since its day (`null` where a deposit lies before the inflation history or a price or rate is missing; with no own rate for the currency the own-rate reading is the official one, flagged `ownRate: false`). Aggregate nominal and real unrealized P&L exclude real-estate account holdings from both profit and its cost denominator, alongside bank deposits; net worth, whole cost basis, realized P&L and individual asset readings keep those holdings. The aggregate real `costBasis` can be null while investment P&L remains readable when only property cost is unknown. `GET /accounting/portfolio` returns `real` the same way, for the portfolio and for each asset: the cost of the held lots in today's money (`costBasis`) and the profit over it, after official inflation and after the owner's own rate. It also lists `rates`, the Bank of Russia rates its values use (none when the report currency has no rate from the last 15 days), and `staleRates`, each currency whose latest stored rate is older than that, with the rate's date; amounts in such a currency are not converted. `GET /accounting/portfolio/assets/:instrumentId/lots` (optional `currency`) lists the lots of one asset still held, newest first, each with what it cost (`paid`), its original payment currency (`paidCurrency`), whether that cost is the unchanged full entered native payment in the report currency (`paidExact`; false for prorated, converted or capital-return-adjusted costs), its value now, the nominal profit and a `real` reading after official inflation and after the owner's own rate (`inflationPercent` since its day, `costBasis` in today's money, `unrealizedPnl`; `null` for a lot with no cost, rate or inflation figure; the own-rate reading is the official one, flagged `ownRate: false`, with no own rate); `complete` is false while an account's history starts later; an unknown or hidden asset is 404 |
| Wallets     | `GET/POST /wallet-addresses`, `PATCH /wallet-addresses/:id` (POST and PATCH take `accountId` or `newAccount` `{ requestId, name, kind? }`, which makes the wallet in the same transaction, so a refused address leaves no empty wallet; a retry with the same `requestId` uses the wallet it made, a changed one or a wallet removed since is 409), `DELETE /wallet-addresses/:id` (stop tracking an address; its history stays), `POST /wallet-addresses/:id/sync`, `GET /wallet-addresses/:id/sync-runs`, `POST /wallet-addresses/:id/balance-gap`, `GET /wallet-addresses/:id/transactions` |
| Market data | `GET /prices`, `GET /fx-rates`, `GET /sync-status`                                                                                  |
| Settings    | `GET/PUT /owner-settings`, `GET /export/csv`, `GET /export/backup`                                                                  |
| Health      | Public `GET /health` (minimal liveness); private `GET /health/details`                                                              |
| Metrics     | Internal only: Prometheus `GET /metrics` on `METRICS_PORT` (default 9464), a separate listener that Compose publishes on the server's loopback only |

Private endpoints use the Secure/HttpOnly/SameSite=Strict host-only session cookie.
All writes, including login/MFA/logout, require the exact configured Origin and
`X-CSRF-Token`; the browser client obtains it lazily and retains it only in memory.
Password verification creates only pending MFA state; a valid factor grants full
access. Each stage rotates the session, server logout revokes it, and CLI recovery revokes all
owner sessions. Legacy bearer credentials are not accepted. Full sessions expire
24 hours after sign-in with no idle timeout; the combined anonymous/pending five-minute
pool is capped at 512 and authenticated sessions at 10. HTTP startup requires exact
`TRUSTED_PROXY_IPS` configuration. CSRF, password and MFA admissions use shared PostgreSQL fixed windows: exactly
30/60s, 5/60s and 5/60s per verified source, plus 10/600s per normalized
claimed email for login. See
[owner authentication](docs/owner-authentication.md) for configuration, caps and
remaining protection requirements. Source IP and claimed-email subjects are
stored as bounded SHA-256 digests. These unsalted digests do not anonymize
guessable identifiers.

## External APIs

- **Crypto prices (hourly):** [Kraken](https://api.kraken.com), then [CoinGecko](https://api.coingecko.com) (free tier)
- **USD/EUR/RUB rates:** [Bank of Russia](https://www.cbr.ru) daily rates
- **Inflation (monthly):** the [OECD](https://sdmx.oecd.org) all-items consumer price index of the United States (a CSV of the US statistics, as the BLS site itself refuses automated requests) for USD and [Eurostat](https://ec.europa.eu/eurostat) euro-area HICP (`prc_hicp_minr`) for EUR, and the Bank of Russia's [annual inflation table](https://www.cbr.ru/hd_base/infl/) for RUB (monthly changes are rebuilt from the year-over-year figures, so a single month can be off by the usual seasonal swing and a month typed in by the owner replaces it); no keys. Months not yet published are estimated at the trailing twelve-month rate and marked as estimates, also a month with no figure between the latest published month and a later month typed in by the owner
- **Bitcoin history:** [Blockstream Esplora](https://blockstream.info/api)
- **Ethereum history:** [Etherscan](https://api.etherscan.io) (free key). The same key and API (`chainid`) also read Base, Arbitrum One, OP Mainnet, Polygon, BNB Smart Chain and Avalanche C-Chain, each added as a wallet of its own. Etherscan's free plan does not serve OP Mainnet, Base, BNB Smart Chain or Avalanche C-Chain: OP Mainnet and Base then fall back to [Blockscout](https://docs.blockscout.com): with the free key `BLOCKSCOUT_API_KEY` through its PRO API (one key, `chain_id`), without it through their public explorers, which limit keyless requests hard (429 or 403). BNB Smart Chain and Avalanche C-Chain report that the plan does not cover them
- **Solana history:** public RPC `https://api.mainnet-beta.solana.com`
- **Bybit account:** [Bybit V5 API](https://api.bybit.com) with the owner's read-only key, stored encrypted
- **Tron history and staking:** [TronGrid](https://api.trongrid.io) (free tier; optional free key `TRONGRID_API_KEY`); TRX that contracts send into a wallet, which TronGrid's account list omits, is found through [Tronscan](https://tronscan.org)'s public list (no key)
- **Stellar history:** SDF's public [Horizon](https://horizon.stellar.org) (no key; keeps about one year of history)
- **Zcash history:** [Blockbook](https://github.com/trezor/blockbook) at NOWNodes (free key `ZCASH_BLOCKBOOK_API_KEY`) or at the address in `ZCASH_BLOCKBOOK_URL` (a provider with the key in its path); without either Trezor's public instances, which answer 403 to servers; transparent addresses only, shielded balances cannot be read

The old asset, liability, crypto wallet, currency, display-rate and metrics APIs were removed
in M20; their tables and rows stay in the database and leave with the JSON backup.

## License

MIT
