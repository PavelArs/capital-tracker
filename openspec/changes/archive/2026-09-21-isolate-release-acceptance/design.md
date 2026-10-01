## Context

The archived engineering baseline documents migration/image/auth gaps. Release
verification needs real PostgreSQL and browser execution before changing auth.
This change repairs infrastructure boundaries and preserves current successful
login/wallet behavior as characterization; it does not endorse stateless JWT auth.

## Goals / Non-Goals

Goals: explicit safe migration command, reproducible images free of test fixtures,
HTTPS browser-to-application-to-PostgreSQL tests with isolated outbound providers.
Non-goals: production rollout, legacy destructive upgrade approval, secure-auth or
accounting replacement. No modifications to previously applied migration files.

## Decisions

- Keep separate images built from workspace-root contexts with exact pnpm and the
  committed lockfile. Backend final image contains production dependencies and dist,
  no test code. Add tsconfig.build exclusions. Preserve owner frontend/nginx.conf;
  add dedicated container static-server config.
- Application TypeORM options keep synchronize false and disable migrationsRun
  and implicit extension installation. Dedicated CLI requires explicit DB_* settings
  and uses installed TypeORM to actually execute migrations with failure exit status.
- Before mutation, reject pending destructive historical migrations on any pre-existing
  application schema, even if currently empty. Fresh isolated installs may execute
  the historic chain; provision uuid-ossp explicitly with migration privilege.
  Fully migrated prior schema is accepted idempotently. A separate reviewed
  data-preserving upgrade change is required for blocked older databases.
- Serialize cooperating migration commands using a PostgreSQL advisory lock. No
  default localhost database/password fallback for the migration command. No automatic
  migration rollback. Missing config/preflight failure leaves application tables and
  migration ledger unchanged.
- Test-only Compose has an explicit unique project name, disposable volumes, internal
  network for all backend dependencies, plus a separate proxy ingress network and only
  a loopback HTTPS proxy port. The proxy needs this second network on Docker Desktop
  for published host ingress; backend services retain no external route. Retain Redis until a later scoped removal.
  All app outbound HTTP goes to controlled external-provider fixtures; verify no live
  egress. Real backend/auth/database responses are never stubbed.
- Test seed code is mounted externally into a one-off container and requires an explicit
  synthetic database identity. Real bcrypt hash and verified synthetic owner are seeded,
  then the browser logs in with that password. No JWT injection, email skip flag or
  production seed/reset endpoint. Fixture files never enter release images.
- Periodic scheduling can be disabled through BACKGROUND_JOBS_ENABLED=false for
  operational maintenance and deterministic isolation; default is enabled. Startup
  adapter calls remain real and go through fixtures. This is not an auth/data bypass.
- Chromium Playwright uses labels/roles and web-first assertions, retries zero. Run
  authentication checks in Firefox before later releases. Capture only synthetic traces.

## Risks / Trade-offs

- Old migration chain is destructive -> only fresh synthetic DB executes it here;
  real old schemas are refused pending backup and separately reviewed upgrade.
- Hardcoded provider endpoints/startup calls -> internal network plus outbound fixture
  proxy or test CA aliases established before app starts; no fixture bypass in product.
- Current UI/auth may expose existing defects -> record and specify fixes; never
  replace real backend responses to make tests pass.
- Local Docker network access requires tool escalation -> use explicit isolated files
  and project names; never use default production Compose volumes/containers.

## Migration Plan

Operators must invoke the explicit migration command before app startup. This change
is not deployed. Compatibility of existing data is tested using synthetic fixtures,
not owner data. Reverting application code is not database rollback. No destructive
migration approval or restoration over newer writes is implicit.

## Open Questions

Full legacy-data conversion needs owner inventory/export and a separate migration
plan. Release security scans, secure auth and final recovery exercises remain open.
