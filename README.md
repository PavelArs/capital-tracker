# Capital Tracker

> Brownfield refactor in progress. Read [the audit](docs/brownfield-audit.md) before
> starting against existing data. Explicit migration preflight refuses unsafe legacy upgrades.
> Production deployment is disabled by default and is not release-ready.
> The target contract is [the refactor brief](capital-tracker-openspec-prompt.md).
> The owner's current product target (2026-10-04) is the [business requirements](docs/business-requirements.md)
> and the derived [product requirements and change order](docs/product-requirements.md).

## Verification during the refactor

Use Node 26.10.0 (`nvm use`) and pinned pnpm 12.9.1:

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
The [reviewed CSV import](docs/csv-imports.md) slice adds explicit mapping, whole-batch
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
| Accounting  | `/accounting/...`: accounts, instruments, trades, operations, transfers, chain transactions and proposed transfers, CSV imports, manual prices, portfolio value and history |
| Wallets     | `GET/POST /wallet-addresses`, `PATCH /wallet-addresses/:id`, `POST /wallet-addresses/:id/sync`, `POST /wallet-addresses/:id/balance-gap`, `GET /wallet-addresses/:id/transactions` |
| Market data | `GET /prices`, `GET /fx-rates`, `GET /sync-status`                                                                                  |
| Settings    | `GET/PUT /owner-settings`, `GET /export/csv`, `GET /export/backup`                                                                  |
| Health      | Public `GET /health` (minimal liveness); private `GET /health/details`                                                              |

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
- **Bitcoin history:** [Blockstream Esplora](https://blockstream.info/api)
- **Ethereum history:** [Etherscan](https://api.etherscan.io) (free key)
- **Solana history:** public RPC `https://api.mainnet-beta.solana.com`
- **Bybit account:** [Bybit V5 API](https://api.bybit.com) with the owner's read-only key, stored encrypted
- **Tron history and staking:** [TronGrid](https://api.trongrid.io) (free tier; optional free key `TRONGRID_API_KEY`); TRX that contracts send into a wallet, which TronGrid's account list omits, is found through [Tronscan](https://tronscan.org)'s public list (no key)
- **Stellar history:** SDF's public [Horizon](https://horizon.stellar.org) (no key; keeps about one year of history)
- **Zcash history:** Trezor's public [Blockbook](https://github.com/trezor/blockbook) instances (no key; transparent addresses only, shielded balances cannot be read)

The old asset, liability, crypto wallet, currency, display-rate and metrics APIs were removed
in M20; their tables and rows stay in the database and leave with the JSON backup.

## License

MIT
