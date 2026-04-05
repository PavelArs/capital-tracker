# MVP Simplification & Production Readiness

**Date:** 2026-04-05
**Status:** Approved
**Goal:** Refactor Capital Tracker into a lean personal finance MVP (fiat + BTC/ETH with ERC-20 tokens), production-ready for self-hosting behind nginx on a personal server with automated CI/CD via GitHub Actions and ghcr.io.

---

## Architecture Overview

**Deployment topology:**
```
[Internet] → [nginx on host (TLS + routing)]
                ├─ /api/*  → Docker: backend (port 3000)
                └─ /*      → /var/www/capital-tracker/ (static files)

Docker Compose (3 services):
  ├─ postgres:16
  ├─ redis:7
  └─ backend (NestJS)

Frontend: static build served directly by host nginx
```

**Kept modules:** auth, assets, liabilities, crypto, currencies, metrics, cache, health, email, shared.

**Removed modules:** subscriptions, capitals, reports, invitation codes.

---

## PR1 — Simplify: Remove Dead Modules

### Backend Removals

**Full module deletion:**
- `subscriptions/` — module, controller, service, entity
- `capitals/` — module, controller, service, DTOs, entity
- `reports/` — module, controller, service, DTOs, entity

**Entity deletion:**
- `InvitationCode` entity (file + all references)
- `Subscription` entity
- `Capital` entity
- `Report` entity

**Auth simplification:**
- Remove invitation code validation from `auth.service.ts` register flow — registration becomes open (email + password only)
- Remove `SubscriptionGuard` and `@RequireSubscription` decorator
- Remove `subscriptionType` field from `User` entity

**App module cleanup:**
- Remove module imports for subscriptions, capitals, reports from `app.module.ts`

### Frontend Removals

**Pages removed:**
- `pages/Metrics.tsx` — route and nav link removed
- `pages/Subscriptions.tsx` — route and nav link removed

**Components/features removed:**
- Any capitals-related UI in Settings
- Invitation code management in Settings
- Subscription management UI

**API layer cleanup:**
- Remove API functions for subscriptions, capitals, reports
- Remove related TypeScript types from `shared/types/`

**i18n cleanup:**
- Remove translation keys for deleted features (both EN and RU locales)

### Database Migration

Single reversible migration:
- Drop tables: `subscription`, `capital`, `report`, `invitation_code`
- Drop column from `user`: `subscriptionType` (and any subscription-related columns)

### Test Updates

- Remove or update tests that reference deleted modules/entities
- Auth service tests: update register tests to remove invitation code assertions

---

## PR2 — Crypto Cleanup + Dashboard Polish

### Crypto Changes

**CryptoType enum cleanup:**
- Keep: `BITCOIN`, `ETHEREUM`
- Remove: `POLYGON`, `BSC`, `AVALANCHE`, `SOLANA`, `ARBITRUM`, `OPTIMISM`, `BASE`, `CUSTOM`
- Migration: delete any `crypto_wallet` rows with removed types (safety net)

**ERC-20 token support audit:**
- Verify `CryptoUpdateService` correctly fetches ERC-20 token balances via `eth_call` against fallback RPC endpoints (LlamaRPC, Ankr, PublicNode)
- Verify `CryptoPricesService.getBulkTokenPrices` correctly resolves token prices via CoinGecko
- Fix any issues found during audit

**Logging migration:**
- Inject Pino logger into `CryptoUpdateService` constructor
- Replace all `console.log` / `console.error` calls with `this.logger.info` / `this.logger.error`

### Dashboard Polish

**Dynamic currency selector:**
- Replace hardcoded `['USD', 'EUR', 'RUB']` in `Dashboard.tsx` with data from `GET /currencies` (filtered by user preferences)
- Use existing `UserCurrencyPreference` system — user controls visible currencies in Settings

**Cleanup:**
- Remove any leftover Metrics page references (imports, routes, nav links, API functions, i18n keys) not caught in PR1

---

## PR3 — Production Infrastructure

### Docker Compose

**Split into two files:**
- `docker-compose.yml` — production config (3 services: postgres, redis, backend)
- `docker-compose.override.yml` — dev overrides (source mounts, debug ports)

Docker Compose automatically merges `docker-compose.override.yml` when present, so `docker compose up` works for both dev and prod (prod servers don't have the override file).

**Production compose (3 services):**
- `postgres:16-alpine` — persistent volume, healthcheck
- `redis:7-alpine` — persistent volume, healthcheck
- `backend` — image from ghcr.io, depends on postgres + redis, healthcheck via `/health`

**Frontend container removed entirely** — static files served by host nginx.

**Backend Dockerfile improvements:**
- Add `HEALTHCHECK` directive: `curl -f http://localhost:3000/health`
- Run as non-root user (`USER node`)

### CI Pipeline (on PR to main)

Keep current structure, remove frontend Docker build step:
- `backend-lint`, `backend-format`, `backend-test`, `backend-build`
- `frontend-lint`, `frontend-format`, `frontend-test`, `frontend-build`
- `ci-status` gate job

### CD Pipeline (on push to main)

**Backend image:**
1. Build backend Docker image
2. Push to `ghcr.io/<github-user>/capital-tracker-backend` with tags: semver, commit-sha-short, `latest`

**Frontend static files:**
1. Build frontend (`npm run build`)
2. SCP `dist/` contents to `DEPLOY_HOST:/var/www/capital-tracker/`

**Deploy backend:**
1. SSH into server
2. `cd /opt/capital-tracker && docker compose pull && docker compose down && docker compose up -d`
3. Health check: poll `http://localhost:3000/health` (6 attempts, 5s interval)
4. On failure: rollback to previous backend image tag, restart

**Database backup** (keep existing logic):
- `pg_dump | gzip > backups/` before deploy, retain last 10

**Notifications:**
- Telegram notification on success/failure (keep if configured, skip if secrets not set)

**Remove:** All Yandex Cloud registry references, `YC_*` secrets.

**New GitHub Actions secrets:**
- `DEPLOY_SSH_KEY` — SSH private key for server access
- `DEPLOY_HOST` — server IP/hostname
- `DEPLOY_USER` — SSH user
- `GHCR_TOKEN` — or use default `GITHUB_TOKEN` with `packages:write` permission

### Nginx Host Config Template

Committed to `deploy/nginx.conf` as a reference template (not auto-deployed):

```nginx
server {
    listen 80;
    server_name <your-domain>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <your-domain>;

    ssl_certificate /etc/letsencrypt/live/<your-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # API → backend container
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend static files
    location / {
        root /var/www/capital-tracker;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

---

## Notes

- **Frontend API URL:** In production, `VITE_API_URL` should be set to `/api` (relative) so requests go through host nginx. In dev it stays `http://localhost:3000`.
- **Nginx template** is a reference only — user configures it on the host manually, replacing `<your-domain>` with their actual domain.
- **Database backups** are retained from the existing CD pipeline (pg_dump before deploy, keep last 10).

---

## Out of Scope

- Payment processing / subscription billing
- Additional blockchain integrations beyond BTC + ETH
- Multi-portfolio (capitals) feature
- Report generation
- AI recommendations
- Mobile app
