# Capital Tracker

> Brownfield refactor in progress. Read [the audit](docs/brownfield-audit.md) before
> starting against existing data. Explicit migration preflight refuses unsafe legacy upgrades.
> Production deployment is disabled by default and is not release-ready.
> The target contract is [the refactor brief](capital-tracker-openspec-prompt.md).

## Verification during the refactor

Use Node 22.21.1 (`nvm use`) and pinned pnpm 10.33.0:

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
The active [known-cost opening lots](docs/known-cost-carry-in.md) change has passed
real PostgreSQL checks, nine focused HTTPS scenarios and independent review; its
complete release gate and archival remain pending.
Original project folders/data remain untouched.

Personal finance application for tracking assets, liabilities, crypto wallets (BTC + ETH with ERC-20 tokens), and generating financial metrics.

## Tech Stack

- **Backend:** NestJS 11, TypeScript, TypeORM, PostgreSQL 16, Redis 7
- **Frontend:** React 18, Vite, TypeScript, Chart.js, i18next (EN/RU)
- **Tooling:** pnpm, Biome (lint + format), Jest/Vitest
- **Infrastructure:** Docker Compose, GitHub Actions CI/CD, ghcr.io, nginx

## Features

- **Assets & Liabilities** - CRUD with Stock (balance sheet) and Flow (income) asset types, multi-currency support
- **Crypto Wallets** - Bitcoin and Ethereum address tracking with live balance updates, ERC-20 token support
- **Financial Metrics** - Net worth, runway, FL-ratio (passive income coverage), category distributions
- **Dashboard** - Charts, history (30 days), dynamic currency selector
- **Auth** - CLI-only owner bootstrap/recovery and MFA enrollment, Argon2id, mandatory TOTP or single-use recovery codes, revocable PostgreSQL cookie sessions and CSRF protection
- **Exchange Rates** - Auto-updated fiat and crypto rates, Redis-cached

## Quick Start

### Prerequisites

- Node.js 22+
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

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with watch mode |
| `pnpm build` | Build NestJS application |
| `pnpm test` | Run tests with coverage |
| `pnpm lint` | Biome lint + format check |
| `pnpm check` | Auto-fix lint + format issues |
| `pnpm migration:generate` | Generate TypeORM migration |
| `pnpm migration:run` | Explicit preflight and migration; requires DB_* environment |

### Frontend (`cd frontend`)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | TypeScript check + production build |
| `pnpm test` | Run tests with coverage |
| `pnpm lint` | Biome lint + format check |
| `pnpm check` | Auto-fix lint + format issues |

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
  pages/          Route pages (Dashboard, Assets, Liabilities, Crypto, Settings)
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

- **CI** (PRs and pushes to main): lint, test, build, Docker builds and pinned OpenSpec checks; aggregate requires every job to succeed.
- **CD**: legacy manual workflow gated by main branch and explicit rollout variable; disabled by default pending release hardening. It still has known backup, artifact and deployment limitations documented in the audit.

## API Endpoints

These are backend paths; the HTTPS proxy exposes them under `/api/`. No HTTP
Swagger/documentation endpoint is mounted, including in development.

| Group | Endpoints |
|-------|-----------|
| Auth | `GET /auth/csrf`, `POST /auth/login`, `POST /auth/mfa`, `GET /auth/me`, `POST /auth/logout` |
| Assets | `GET/POST /assets`, `GET/PATCH/DELETE /assets/:id` |
| Liabilities | `GET/POST /liabilities`, `GET/PATCH/DELETE /liabilities/:id` |
| Crypto | `GET/POST /crypto`, `GET/DELETE /crypto/:id`, `PATCH /crypto/:id/update-balance`, `GET /crypto/prices`, `POST /crypto/token-prices` |
| Currencies | `GET /currencies/list`, `GET /currencies/convert`, `POST /currencies/hide`, `POST /currencies/show` |
| Metrics | `GET /metrics?currency=USD`, `GET /metrics/history?days=30&currency=USD` |
| Health | Public `GET /health` (minimal liveness); private `GET /health/details` |

Private endpoints use the Secure/HttpOnly/SameSite=Strict host-only session cookie.
All writes, including login/MFA/logout, require the exact configured Origin and
`X-CSRF-Token`; the browser client obtains it lazily and retains it only in memory.
Password verification creates only pending MFA state; a valid factor grants full
access. Each stage rotates the session, server logout revokes it, and CLI recovery revokes all
owner sessions. Legacy bearer credentials are not accepted. Sessions have thirty
minutes idle/twelve hours absolute expiry; the combined anonymous/pending five-minute
pool is capped at 512 and authenticated sessions at 10. HTTP startup requires exact
`TRUSTED_PROXY_IPS` configuration. CSRF, password and MFA admissions use shared PostgreSQL fixed windows: exactly
30/60s, 5/60s and 5/60s per verified source, plus 10/600s per normalized
claimed email for login. See
[owner authentication](docs/owner-authentication.md) for configuration, caps and
remaining protection requirements. Source IP and claimed-email subjects are
stored as bounded SHA-256 digests. These unsalted digests do not anonymize
guessable identifiers.

## External APIs

- **Exchange rates:** [ExchangeRate-API](https://api.exchangerate-api.com) (free tier)
- **ETH balances/tokens:** Public RPC endpoints (LlamaRPC, Ankr, PublicNode)
- **BTC balances:** [Blockstream API](https://blockstream.info/api)
- **Crypto prices:** [CoinGecko API](https://api.coingecko.com) (free tier)

## License

MIT
