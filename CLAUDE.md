# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Capital Tracker — a full-stack personal finance application for tracking assets, liabilities, crypto wallets, DeFi positions, and generating financial metrics. Monorepo with separate `backend/` (NestJS) and `frontend/` (React + Vite) directories.

## Common Commands

### Backend (`cd backend`)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with watch mode (port 3000) |
| `pnpm build` | Build NestJS application |
| `pnpm test` | Run Jest tests with coverage |
| `pnpm test -- <pattern>` | Run a single test file (e.g. `pnpm test -- auth.service`) |
| `pnpm lint` | Biome lint + format check |
| `pnpm lint:fix` | Auto-fix Biome issues |
| `pnpm check` | Biome check + auto-fix (lint + format) |
| `pnpm migration:generate` | Generate TypeORM migration (build first, outputs to `src/migrations/`) |
| `pnpm migration:run` | Run pending migrations |
| `pnpm migration:revert` | Revert last migration |

### Frontend (`cd frontend`)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server (port 3001) |
| `pnpm build` | TypeScript check + Vite production build |
| `pnpm test` | Run Vitest tests with coverage |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Biome lint + format check |
| `pnpm lint:fix` | Auto-fix Biome issues |
| `pnpm check` | Biome check + auto-fix (lint + format) |

### Infrastructure

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services (postgres, redis, backend, frontend) |
| `docker compose up postgres redis -d` | Start only DB and cache for local dev |

## Architecture

### Backend (NestJS 11, TypeScript)

**Module-based architecture** — each domain has its own NestJS module under `backend/src/`:
- `auth/` — JWT authentication (Passport), registration, email verification, password reset
- `assets/` — Asset management (Stock/Flow types)
- `liabilities/` — Liability tracking
- `crypto/` — Cryptocurrency wallet management
- `currencies/` — Currency rates and conversions (cached in Redis)
- `metrics/` — Financial metrics calculation
- `capitals/` — Capital snapshots
- `defi/` — DeFi position tracking
- `subscriptions/` — Subscription management
- `reports/` — Financial report generation
- `ai-recommendations/` — AI-powered financial recommendations
- `email/` — Nodemailer-based email service
- `cache/` — Redis cache module (ioredis)
- `health/` — Health check endpoints
- `shared/` — Decorators (`@CurrentUser`), DTOs, global exception filter, custom exceptions

Each module follows the pattern: `module.ts` → `controller.ts` → `service.ts` + DTOs + `*.spec.ts` tests.

**Database:** PostgreSQL 16 with TypeORM 0.3. Entities live in `backend/src/entities/`. Migrations in `backend/src/migrations/` — `synchronize: false`, migrations run automatically on startup.

**Path aliases:** `@shared/*`, `@config/*`, `@entities/*` (defined in `tsconfig.json`).

**API docs:** Swagger at `/api/docs` (development only).

**Security:** Helmet, CORS, ThrottlerGuard (100 req/min general, 5 req/min for auth endpoints), bcrypt for passwords.

**Logging:** Pino with structured logging and sensitive field redaction.

### Frontend (React 18, Vite, TypeScript)

**Feature-based structure** under `frontend/src/`:
- `api/` — Axios client with interceptors (auto token injection, 401 redirect)
- `components/` — Reusable UI components
- `contexts/` — AuthContext, ErrorContext, ThemeContext
- `features/` — Feature-specific components
- `hooks/` — Custom React hooks
- `i18n/` — i18next with English and Russian locales
- `pages/` — Route pages
- `shared/` — TypeScript types
- `utils/` — Utility functions

**Path aliases:** `@/*`, `@api`, `@api/*`, `@components/*`, `@pages/*`, `@contexts/*`, `@utils/*`, `@shared/*`, `@hooks/*`, `@features/*` (defined in both `tsconfig.json` and `vite.config.ts`).

**Routing:** React Router v6. Public routes: login, register, forgot-password, reset-password, verify-email. Protected routes use a `PrivateRoute` component.

**Charts:** Chart.js with react-chartjs-2.

### Testing

- **Backend:** Jest. Test files use `.spec.ts` suffix. Coverage collected only from `*.service.ts` files.
- **Frontend:** Vitest with jsdom + Testing Library. Test files use `.test.ts` suffix. Coverage thresholds: 90% for branches, functions, lines, statements.

### CI/CD

CI (`.github/workflows/ci.yml`) runs on PRs to main: lint, format check, tests, and build for both backend and frontend, plus Docker build verification.

CD (`.github/workflows/cd.yml`) deploys on push to main: semantic versioning, Docker images to Yandex Container Registry, SSH deploy to Yandex Cloud VM with automatic rollback on health check failure.

## Git Conventions

- **Conventional Commits** required: `<type>(scope): description`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`
- Branch naming: `<type>/<description>` (e.g. `feat/add-google-auth`)
- All git text (commits, PRs, reviews) must be in English
- No direct commits to `main` — use pull requests

## Code Style

- **Biome** for linting and formatting (replaces ESLint + Prettier)
- **pnpm** as package manager (replaces npm)
- Single quotes, trailing commas (`all`), 100 char print width, 2-space indent
- `noExplicitAny: warn`, `noUnusedVariables: error`, `noUnusedImports: error`
- Backend has `unsafeParameterDecoratorsEnabled` for NestJS decorators
- Config files: `backend/biome.json`, `frontend/biome.json`

## Environment

Copy from `backend/.env.example` and `frontend/.env.example`. Key variables:
- Backend: `DB_*`, `JWT_SECRET`, `SMTP_*`, `REDIS_*`, `FRONTEND_URL`
- Frontend: `VITE_API_URL` (default: `http://localhost:3000`)

Env validation is centralized in `backend/src/config/env.validation.ts`.
