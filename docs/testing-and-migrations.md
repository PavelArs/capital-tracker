# Local verification and explicit migrations

Use Node 22.21.1 (`nvm use`), pnpm 10.33.0 and Docker Compose. The existing
application is under incremental refactoring. Archived cookie-session verification
remains available in `replace-bearer-sessions`. The mandatory-MFA change passed local PostgreSQL checks and55 HTTPS Chromium cases;
its archived verification record gives exact images, commands and scope. This does
not establish production readiness.

## Reproducible checks

```sh
pnpm install --frozen-lockfile
pnpm verify:baseline
pnpm audit:production
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:e2e` builds from the root workspace lockfile, then runs migration tests,
artifact/network checks and Chromium through the actual application images,
HTTPS proxy, authentication, adapters and PostgreSQL. It creates/removes only
the fixed `capital-tracker-e2e` Compose project defined in tests/e2e/compose.yml.
Its PostgreSQL data is tmpfs and synthetic; every run resets that project.
It never invokes the production Compose file. Only 127.0.0.1:8443 is published.
Stop an interrupted run with `pnpm test:e2e:down` (synthetic data is discarded).

The browser origin is exactly `https://127.0.0.1:8443`, matching backend
`FRONTEND_URL`; the built client uses `VITE_API_URL=/api`. Substituting `localhost`
changes the origin and causes protected writes to fail. The HTTPS proxy supplies
the browser's secure endpoint; backend-only HTTP health checks remain internal.
HTTP Vite/backend development ports alone cannot support the Secure session cookie.

All backend dependencies use an internal Docker network. The proxy also joins a
separate ingress network so Docker Desktop can publish HTTPS to the browser host.
The fixture proxy terminates HTTPS CONNECT locally for three allowlisted provider
hosts and returns deterministic data without forwarding upstream. It binds the
CONNECT host, TLS SNI and HTTP Host; tunneled controls and unknown destinations fail.
Backend runtime trusts only the mounted public synthetic provider certificate via
NODE_EXTRA_CA_CERTS, while normal TLS verification stays enabled. Its separate TLS
private key is mounted only into the provider among running application services;
trusted short-lived seed/test tools also retain their whole-fixture-directory mounts.
The external provider service cannot read the MFA key. A real Axios transport probe
checks trusted/untrusted TLS, authority binding, controls and early disconnections.
No application/authentication response is mocked. Test-only
seed scripts, TLS material and the synthetic MFA key are mounted separately, excluded
from release images. The harness creates a private 32-byte key under ignored
`tests/e2e/.runtime/mfa-key` and mounts it read-only into runtime/CLI containers. On
Linux it adjusts only that synthetic file to container UID 1000 and mode 0400 so the
non-root process can read it. Never place a production key in this fixture directory.
The synthetic key/TLS files can remain after Compose cleanup; they are not production
secrets or database persistence.

Periodic jobs are disabled with BACKGROUND_JOBS_ENABLED=false to avoid wall-clock
races; startup fetches and explicit wallet refresh still use actual adapters.
Production defaults keep cron enabled. This setting is not an authentication bypass.

Playwright uses one Chromium worker and zero retries. Reports/traces/screenshots
contain synthetic data only. The retained portfolio cases cover direct anonymous denial
for the tested routes, real browser login, BTC wallet lifecycle with DB assertions
and backend restart, and ownership isolation. Browser fixtures now enroll the fixed
synthetic owner through the production MFA prepare/confirm CLI before each independent test. They confirm a
previous still-valid TOTP step using PostgreSQL time, then enter a fresh current code
through the browser. Additional same-window logins use actual unused CLI-issued
recovery codes. The fixture handles clock boundaries with bounded retries and does
not reset accepted counters, inject authenticated cookies or mock authentication.
It restarts the isolated backend between tests to reset the existing process-local
request limiter; persisted MFA lockout cases explicitly test behavior across restart.
These tests do not establish complete route coverage. Another browser engine,
scanners, full ASVS coverage and backup/restore exercises remain release work.

Session acceptance extends these journeys with real cookie rotation, profile
restoration, server logout, CLI revocation, authoritative idle/absolute expiry,
CSRF/Origin denial, default-deny routes and bounded/concurrent session creation.
The PostgreSQL checks distinguish expected session bookkeeping from preserved
owner/portfolio rows. Frontend adapter tests cover lazy/shared CSRF acquisition and
no automatic replay of failed writes; these unit checks do not replace HTTPS browser
or real database evidence. MFA acceptance adds password-only denial, pending/full
rotation, recovery-code use, replay/race rejection, malformed factor values, persisted
lockout and trusted replacement. Independent PostgreSQL/CLI checks exercise key
integrity, protected output files, rollback, limits and held-lock expiry. Financial
fingerprints exclude only deliberately changed authentication state, with separate
authentication-state assertions. Read the change's verification record for actual
results.

CI invokes the same pnpm test:e2e command in its required docker-build job. It has
not been run on GitHub in this session; local success is not a hosted CI claim.
The ninth required CI job runs `pnpm audit:production` after a frozen install.
It fails on high/critical production advisories and registry errors; lower-severity
findings remain visible in [the dependency security record](dependency-security.md).

## Build images directly

```sh
docker build -f backend/Dockerfile -t capital-tracker-backend:local .
docker build -f frontend/Dockerfile -t capital-tracker-frontend:local .
```

Both contexts are the repository root. The backend runs as UID 1000; final images
exclude repository test code and fixtures. `tests/e2e/artifacts.cjs` checks exact
running image IDs, fixture markers and published ports/internal networking.
The surrounding acceptance harness compares its checkout's Nginx bytes/type/permissions
before and after execution/cleanup, including failures, without changing that file.
`deploy/container-nginx.conf` serves built frontend assets; the existing owner `frontend/nginx.conf` is preserved as a separate host
configuration and is not copied into an image.

## Migration operation

Application startup uses synchronize:false, migrationsRun:false and
installExtensions:false. Startup cannot replace an explicit migration step.
The CLI requires DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_NAME; there are
no default connection credentials and no implicit .env loading. Supply values
through the process environment or explicit Node environment-file option:

```sh
pnpm --dir backend build
# From backend/, after reviewing the intended isolated database configuration:
node --env-file=.env dist/migrate.js show
node --env-file=.env dist/migrate.js
```

With inherited environment, `pnpm --dir backend migration:show` and
`pnpm --dir backend migration:run` invoke the same CLI. In the backend image use
`node backend/dist/migrate.js`. A migration connection needs DDL privileges;
runtime privilege separation still requires final deployment configuration.

A PostgreSQL advisory lock prevents cooperating migration commands overlapping;
a contending invocation fails safely. Fresh installation explicitly provisions
uuid-ossp and applies eleven migrations: eight historic migrations, the additive owner
binding, the session table and the MFA/session extension. A populated
fully migrated database is idempotent. Pending destructive historical migrations
on an existing application schema are refused even when its tables are empty.
The check runs before extension, ledger or application-table mutation. Raw database
error messages are suppressed because they can contain values or credentials.

Do not bypass preflight, edit migration ledger rows, or rewrite old migration files
to force an existing database through. Old migrations drop tables/delete wallets
and silently relabel unknown currencies. A separate export, encrypted backup,
restoration test and reviewed data-preserving upgrade plan is required for those
schemas. No existing owner database was accessed. There is no automatic migration
revert command: image rollback cannot restore deleted data or reverse schema changes.

The current manual CD workflow remains disabled by default and is not a supported
production release procedure. Explicit migration deployment, artifact promotion,
secrets, backups, rollback and server configuration remain in the release-hardening
sequence documented in brownfield-audit.md.

Owner authentication acceptance invokes the production CLI for bootstrap and recovery,
checks concurrent bootstrap and previous-schema preservation, and exercises real HTTPS
revocation and retired auth endpoints. CLI recovery revokes pending/full sessions
and candidate enrollment, clears MFA lockout, and preserves the confirmed factor and unused recovery codes in the credential
transaction. Migration fixtures include preceding eight-, nine- and ten-migration
schemas. The MFA upgrade must preserve users, owner/password and financial rows,
revoke old password-only session rows, create no implicit enrollment and remain
idempotent. Current binaries require all eleven migrations. Owner bootstrap must
be followed by explicit MFA prepare/confirm before browser login.

The application Compose file requires an explicit host `MFA_KEY_FILE` and non-secret
`MFA_KEY_ID`. It mounts the existing key read-only at `/run/secrets/ct-mfa-key`, with
`create_host_path: false`, and passes that container path to the backend. The operator
must provide a protected parent directory and a mode 0400/0600 raw 32-byte file
readable by UID 1000. Direct CLI processes use their own absolute key path; a separate
CLI container needs the corresponding mount. This configuration wiring has not
operated production and does not complete or verify the disabled release pipeline.
See [owner authentication](owner-authentication.md) for key permissions and mounting,
private enrollment/recovery outputs, uncertain-commit handling, pending/full cookies,
exact-origin requirements, replay limits and session expiry. No Docker command in
this guide is authorization to operate an existing owner database or production stack.
