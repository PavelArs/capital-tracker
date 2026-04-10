# Capital Tracker

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
- **Auth** - Registration, login, email verification, password reset (JWT + bcrypt)
- **Exchange Rates** - Auto-updated fiat and crypto rates, Redis-cached

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm (`corepack enable`)
- Docker and Docker Compose
- PostgreSQL + Redis (or use Docker)

### Development

```bash
# Start database and cache
docker compose up postgres redis -d

# Install dependencies
pnpm install

# Backend (port 3000)
cd backend
cp .env.example .env    # edit with your settings
pnpm dev

# Frontend (port 3001)
cd frontend
cp .env.example .env
pnpm dev
```

### Docker (full stack)

```bash
# Development (with source mounts, uses docker-compose.override.yml)
cp docker-compose.override.example.yml docker-compose.override.yml
docker compose up -d

# Production (image-based, no overrides on server)
docker compose up -d
```

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
| `pnpm migration:run` | Run pending migrations |

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
  auth/           JWT auth, registration, email verification, password reset
  assets/         Asset CRUD (Stock/Flow types)
  liabilities/    Liability CRUD
  crypto/         Wallet tracking, balance updates, price fetching
  currencies/     Exchange rates, currency preferences (Redis-cached)
  metrics/        Net worth, runway, FL-ratio calculations
  cache/          Redis cache module
  health/         Health check endpoint
  email/          Nodemailer email service
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
   JWT_SECRET=<random-secret>
   FRONTEND_URL=https://<your-domain>
   SMTP_HOST=<smtp-host>
   SMTP_PORT=465
   SMTP_USER=<smtp-user>
   SMTP_PASSWORD=<smtp-password>
   EOF
   ```

3. Copy and configure nginx:
   ```bash
   cp deploy/nginx.conf /etc/nginx/sites-available/capital-tracker
   # Edit: replace <your-domain> with your actual domain
   ln -s /etc/nginx/sites-available/capital-tracker /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

4. Push to `main` - CI/CD will automatically build, push images to ghcr.io, and deploy.

### CI/CD Pipeline

- **CI** (on PR to main): lint, test, build for both backend and frontend, Docker build verification
- **CD** (on push to main): semantic versioning, build + push images to ghcr.io, SSH deploy with health check, automatic rollback on failure, database backup before deploy

## API Endpoints

Interactive API docs available at `/api/docs` (development only).

| Group | Endpoints |
|-------|-----------|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email` |
| Assets | `GET/POST /assets`, `GET/PATCH/DELETE /assets/:id` |
| Liabilities | `GET/POST /liabilities`, `GET/PATCH/DELETE /liabilities/:id` |
| Crypto | `GET/POST /crypto`, `GET/DELETE /crypto/:id`, `PATCH /crypto/:id/update-balance`, `GET /crypto/prices`, `POST /crypto/token-prices` |
| Currencies | `GET /currencies/list`, `GET /currencies/convert`, `POST /currencies/hide`, `POST /currencies/show` |
| Metrics | `GET /metrics?currency=USD`, `GET /metrics/history?days=30&currency=USD` |
| Health | `GET /health` |

## External APIs

- **Exchange rates:** [ExchangeRate-API](https://api.exchangerate-api.com) (free tier)
- **ETH balances/tokens:** Public RPC endpoints (LlamaRPC, Ankr, PublicNode)
- **BTC balances:** [Blockstream API](https://blockstream.info/api)
- **Crypto prices:** [CoinGecko API](https://api.coingecko.com) (free tier)

## License

MIT
