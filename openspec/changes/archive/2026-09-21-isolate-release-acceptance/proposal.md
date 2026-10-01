## Why

Unit mocks cannot prove migrations, login, proxy routing or persistence. Existing
images ignore the lockfile, include compiled tests, and copy a host-only Nginx config.
The migration command is a no-op while application startup runs destructive history.

## What Changes

- Build both existing applications reproducibly from the workspace lockfile and exclude test fixtures from release images.
- Separate the container static-server config from the preserved owner host Nginx edit.
- **BREAKING** Stop application-startup migrations; add explicit migration execution that refuses unsafe legacy pending migrations on populated schemas.
- Add an isolated Compose stack with PostgreSQL, Redis, HTTPS proxy and controlled outbound provider fixtures on an internal network.
- Run real Playwright browser login and wallet persistence/anonymous-denial characterization through release-candidate images; no backend/auth mocks.
- Add reusable migration and E2E scripts for local execution and subsequent CI integration.

Non-goals: final owner/MFA/session replacement, fixing accounting/provider domain
bugs, owner-database upgrade approval or production release. Existing auth behavior
is characterized only; known security gaps remain blocked for production.
Dependency: archived establish-brownfield-baseline. Data impact: synthetic databases
only during verification; no owner data/schema changes, no rewriting old migrations.

## Capabilities

### New Capabilities
- `isolated-release-acceptance`: real isolated image/migration/browser verification.
- `explicit-migrations`: explicit migration execution, safe startup and legacy preflight refusal.

### Modified Capabilities
None. Existing engineering gates remain unchanged until executable harness succeeds.

## Impact

Dockerfiles, build exclusions, dedicated container/proxy config, TypeORM startup/config
and migration runner, test-only Compose/fixtures, Playwright and scripts. Keep pnpm,
frameworks, registry, data volumes and unrelated owner edits.
