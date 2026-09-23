# Local verification and explicit migrations

Use Node 22.21.1 (`nvm use`), pnpm 10.33.0 and Docker Compose. The existing
application is under incremental refactoring. Archived cookie-session verification
remains available in `replace-bearer-sessions`. The mandatory-MFA change passed local PostgreSQL checks and55 HTTPS Chromium cases;
its archived verification record gives exact images, commands and scope. This does
not establish production readiness.

## Reproducible checks

For incremental work, use a reviewed check list based on the changed code and its
critical risks. The owner changed this policy on2026-09-23: a full browser suite is
not mandatory for every change. Run relevant unit/integration tests, actual PostgreSQL
probes and the affected critical Playwright journeys. Record the exact selection and
what was not run. Keep the existing full runner and CI gates for broader regression
and release checks; a targeted result must not be described as a full release pass.

Within an initialized isolated acceptance stack, Playwright accepts concrete files
or file:line selectors, for example:

```sh
pnpm exec playwright test tests/e2e/historical-accounting.spec.ts --workers=1
```

This command needs the real synthetic HTTPS/authentication/PostgreSQL environment
described below; it does not create that environment itself. `pnpm test:e2e` still
builds, runs and cleans up the complete suite. Test-pyramid review is separate work:
retain critical browser paths, move suitable permutations to lower levels, and remove
redundant cases only after equivalent assertions are demonstrably covered. No tests
or CI gates were deleted as part of the policy change.

The isolated proxy runs the actual `deploy/nginx.conf` template with only synthetic
domain, certificate path and upstream authority substitutions. Its `/api/` routing
and forwarding policy are therefore exercised by all browser tests. Two additional
Node clients have distinct fixed IPs on an internal client-only network; only the
proxy joins both this network and the backend network. They carry the public TLS
certificate, no DB settings or MFA keys. Real socket addresses and Docker topology
are asserted, and the client verifies HTTPS certificates. The helper's direct HTTP
mode is restricted to negative trusted/untrusted-peer tests using existing images.
Fixed synthetic subnets are checked for overlap with unrelated Docker networks
before startup; a collision aborts without changing those networks.
The synthetic two-server upstream uses a 64 KiB shared Nginx zone so all workers
share routing state. Readiness still proves both real backend addresses through
the access log; it never substitutes a successful sibling for the other replica.

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
On macOS, run `caffeinate -is pnpm test:e2e` to prevent sleep for the duration of
the command (the system-sleep assertion requires AC power). Sleep invalidates
wall-clock session and CLI timing checks; a suspended run is not acceptance evidence.

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
The synthetic profile also sets the supported EXCHANGE_RATES_CACHE_TTL to86400000ms
(one day), retaining rates loaded by the real application throughout the bounded
suite. The production default remains ten minutes. This makes warm-cache restart
checks deterministic: they still require exactly two crypto constructor requests
and zero accounting-triggered requests, without accepting arbitrary FX refreshes.
Release-artifact checks verify that both real backend containers use this setting.
These scenarios do not claim to verify cache-expiry behavior.

Playwright uses one Chromium worker and zero retries. Reports/traces/screenshots
contain synthetic data only. The retained portfolio cases cover direct anonymous denial
for the tested routes, real browser login, BTC wallet lifecycle with DB assertions
and backend restart, and ownership isolation. Browser fixtures now enroll the fixed
synthetic owner through the production MFA prepare/confirm CLI before each independent test. They confirm a
previous still-valid TOTP step using PostgreSQL time, then enter a fresh current code
through the browser. Additional same-window logins use actual unused CLI-issued
recovery codes. The fixture handles clock boundaries with bounded retries and does
not reset accepted counters, inject authenticated cookies or mock authentication.
Request-limit acceptance uses two real backend replicas sharing
the same PostgreSQL service. Restarting either replica must preserve exhausted
CSRF, password and MFA windows and the normalized claimed-email window; tests
must use explicit expected ledger deltas rather than clearing the ledger between
phases. Persisted MFA lockout cases remain independent and continue across restart.
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

## Persistent request-limit acceptance

Acceptance exercises the actual rendered `deploy/nginx.conf` template and two real backend replicas sharing
the same PostgreSQL instance. Exercise 30/60s source admission for CSRF, 5/60s
source admission for password login, 5/60s source admission for MFA and the
10/600s normalized claimed-email admission. Verify the source and account windows
are shared across replicas and restarts, fixed at their first PostgreSQL timestamp,
and never reset by success, recovery, enrollment or denial. A re-login refused by
admission must remain read-only, with no session touch, credential lookup or
verifier call; ordinary credential and factor failures retain their existing
verification and counter behavior.

Assert the charge order: valid source admission precedes authentication work;
the claimed-email admission follows valid DTO, session, Origin and CSRF checks.
Malformed trusted-source metadata and malformed JSON rejected by the HTTP parser
spend zero admissions. Verify both source-IP and claimed-email subjects are stored
only as SHA-256 digests, with no implication of anonymity.

The real database checks must cover the 4096-live-row cap, pruning only expired
rows, never evicting a live budget, continued use of an existing under-limit
subject at capacity, the two-process last-slot race and the additive migration
from populated migration 11 to migration 12. Keep the
existing MFA five-attempt challenge retirement and ten-failure owner cooldown in
the same test flow; do not clear the request ledger to make that flow pass.

HTTP assertions must require generic 429, `no-store` and integer `Retry-After`
(1–60 seconds for source windows and 1–600 seconds for account/capacity), and
generic 503/no-store for the actual HTTP held-lock case. Separate real PostgreSQL
query, commit and pool-failure probes verify safe service exceptions, transaction
cleanup and absence of retries. Admission uses `connectTimeoutMS=5000` for every
runtime PostgreSQL pool checkout. There is no automatic retry, memory fallback,
Redis fallback or late admission after a pool/lock refusal; releasing a resource only affects a later explicit request.
These bounded resources limit availability; there is no availability guarantee.

The verified run passed all 74 HTTPS Chromium cases without retries, including
all 63 retained cases and 11 new LIMIT cases, plus real migration/CLI/PostgreSQL
probes. Browser execution took 21.7 minutes locally; the image acceptance CI job
has a 35-minute bound to accommodate these real restarts and a clean build.
The nine required gates and their commands remain unchanged. Hosted CI and
production deployment were not run. See the [archived evidence](../openspec/changes/archive/2026-09-22-persist-auth-request-limits/verification.md).

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
uuid-ossp and applies seventeen migrations: eight historic migrations, the additive
owner binding, the session table, the MFA/session extension and the additive
request admission ledger, four manual-accounting tables, three USD journal tables,
three CSV import tables, the carry-in baseline table/journal opening reference and two external USD flow tables. A populated fully
migrated database is idempotent. The twelfth through seventeenth migrations preserve
all existing rows. Pending destructive historical migrations
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
transaction. Migration fixtures include preceding eight-, nine-, ten-, eleven- and twelve-migration
schemas. The eleven-to-twelve upgrade preserves every existing session and factor
row, adds an empty request ledger and replays without changes. The populated
twelve-to-thirteen fixture also preserves live admission scopes and every old
schema/sequence definition, creating four empty accounting tables. The MFA upgrade must preserve users, owner/password and financial rows,
revoke old password-only session rows, create no implicit enrollment and remain
idempotent. The populated thirteen-to-fourteen fixture preserves all preceding
financial, opening, authentication and admission rows/schema and adds three empty
journal tables. The populated fourteen-to-fifteen fixture also preserves real buy/sell,
correction/void and replay history while adding three empty CSV import tables.
The populated fifteen-to-sixteen fixture also retains CSV draft/committed/rolled-back
originals, settings, commands and provenance, with every previous journal column
unchanged and the new nullable opening reference explicitly NULL.
The populated sixteen-to-seventeen fixture additionally retains original carry-in
lots and their allocation phase, old exact sale results, original receipts and every
previous schema object. Only two empty external-flow tables and the migration ledger
entry are added. Current binaries require all seventeen migrations. Old images cannot interpret a new
carry-in origin: do not mix old/new binaries or assume binary rollback is safe after
initialization. No destructive down migration is provided. Owner bootstrap must
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


## Manual opening acceptance

See [manual accounting](manual-accounting.md) for its bounded API contract. The
independent manual-opening-db.cjs fixture invokes the actual migrated production
service against a fresh allowlisted synthetic database. It verifies exact numeric
strings, strict pre-storage scale/type validation, finite/null/composite-owner SQL
constraints, two-process races, replay-before-CAS and real deferred-COMMIT rollback.
The separate migrations.cjs fixture verifies a fully populated predecessor12.

New Playwright cases use real password/MFA, private Russian forms, HTTPS and the
same PostgreSQL database. They must preserve all previous financial/security tests,
check actual string roundtrips/restart/history and zero provider calls, and verify
safe denied requests and commit failure without private values in response/logs.
The 2026-09-23 complete run passed all 85 cases without retries in 17.6 minutes,
plus the real database/CLI/migration/artifact prerequisites. Exact commands/images
and the earlier failed run are recorded in the [archived evidence](../openspec/changes/archive/2026-09-23-record-manual-opening-positions/verification.md).
Only legitimate authorized session activity may differ before a controller failure;
invalid Origin/CSRF cannot touch session activity. Source spies or direct error-filter
probes do not replace actual authenticated HTTP acceptance.

To reduce repeated readiness delay, synthetic backend health checks run every2s
including startup; their command, timeout5s, start period30s and retries6 remain
those of the exact release image. Artifact checks compare the complete effective
policy. Actual process restart, direct health and upstream evidence remain required.
Production Compose/images do not inherit the test cadence. Full retained acceptance
validates this fixture-only refactor; no artificial failure is manufactured.

## USD trade acceptance

See [USD trade journal](usd-trade-journal.md) for exact inputs, empty-origin eligibility,
FIFO allocation, immutable corrections and workload caps. The independent
usd-trades-db.cjs fixture executes the compiled production service against real
PostgreSQL, including distinct-process competing sales, deferred-COMMIT rollback,
replay at exact caps and read-only repeatable-read projections during a concurrent
correction. Migration acceptance retains every preceding upgrade and adds a populated
13-to-14 preservation rehearsal; no opening is converted into a lot.

The complete 2026-09-23 gate passed 101 Chromium cases in 21.7 minutes, one worker and
zero retries: all 85 preceding cases and 16 USD cases. Actual forms/authentication,
HTTPS, both backend replicas and PostgreSQL exercise exact results, provenance,
restart, denied writes and uncertain-response recovery. Four independently reviewed
UI regressions pass, including a real committed response whose delivery is aborted
and an actual CSRF-denied retry. No application response or authentication is mocked.
The [archived verification](../openspec/changes/archive/2026-09-23-record-usd-fifo-trades/verification.md)
retains genuine earlier failures, exact images, source/audit results and limitations.
This is local evidence; hosted CI and final release/security/recovery gates remain.

## CSV import acceptance

The verified `import-usd-trades-csv` slice adds bounded private originals, explicit
mapping, whole-history preview, atomic acceptance and conditional batch rollback.
The independent `csv-import-db.cjs` fixture runs the compiled production services
against real PostgreSQL: strict limits and SQL ownership, sale-first FIFO, replay,
process races sharing the manual account lock, coherent read-only snapshots and
complete-write witnesses for deferred COMMIT failure. All prior migration and
manual/USD fixtures remain in the same `pnpm test:e2e` entry point.

CSV Playwright cases use actual HTTPS, PostgreSQL, password/MFA and both application
replicas. They cover Russian forms, immutable originals/provenance after restart,
exact proxy and multipart boundaries, private errors/logs and response-loss recovery.
A lost response is produced only after the actual server has committed; an independent
SQL witness checks the receipt before delivery is aborted. Denied retries reach the
real CSRF/session checks. Request scheduling may be delayed to exercise stale reads;
application and authentication responses are never fabricated.

The [archived verification](../openspec/changes/archive/2026-09-23-import-usd-trades-csv/verification.md)
records genuine RED, review regressions and their resolution. The complete local
release gate passed all 124 Chromium cases (101 retained and 23 new), with one worker
and zero retries, plus all real migration/PostgreSQL/authentication prerequisites.
A full browser document reload clears ephemeral command recovery; tests distinguish
it from in-app data refresh and SPA navigation, including session-expiry login.
Neither local acceptance nor this documentation authorizes production deployment.

## External USD flows

See [external USD flows](external-usd-flows.md) for declared coverage, exclusions,
exact period totals and original-command recovery. The focused verification uses
pure input/arithmetic tests, real PostgreSQL races/rollback/RR/limits/constraints,
fresh and populated16 migration preservation, and a small HTTPS set. The full
runner includes `external-usd-flows-db.cjs` for CI. Browser flow cases alone use
an exact synthetic-database-guarded fixture to clear the two new flow tables
between independent cases, because an owner can have only one immutable origin.
No case resets its own accounting or admission state midway through a journey.

## Manual period profit

See [manual period profit](period-profit-preview.md). The focused contract uses 54
new pure cases and 57 retained flow cases, four actual PostgreSQL profit families
plus the eight retained flow families, and just two new HTTPS Playwright cases
plus one retained flow journey. The browser cases cover actual password/MFA,
private calculation, strict inputs, exact values, manual review, late responses
and delivery failure; they never fabricate backend or authentication responses.
The verified focused browser run passed 3/3 in 36.8s, one worker and zero retries.
The full CI runner also includes `period-profit-db.cjs`; no existing test is removed.
No migration is added; the fresh guarded fixture uses existing migration 17.

## Conventional XIRR preview

See [XIRR preview](xirr-preview.md). The scoped pure command is:

```sh
pnpm --dir backend test --runInBand --coverage=false xirr.spec period-profit.spec portfolio-flow.spec portfolio-flow-input.spec
```

It covers 139 cases across four suites: 28 XIRR cases and 111 retained cases.
The real PostgreSQL checks are `xirr-preview-db.cjs` and retained
`period-profit-db.cjs`; the real HTTPS Playwright checks are
`xirr-preview.spec.ts` and `period-profit.spec.ts` (four cases total). The E2E
runner is wired for these checks. The focused PostgreSQL run passed three XIRR
and four retained profit families. The four HTTPS cases passed in 47.4s, one
worker and zero retries. No migration is added; fresh fixtures use migration17.
`xirr-benchmark.cjs` separately exercises64 dates spanning1970–9999 in the pinned
backend image:4,564ms with506 timer ticks on this host, without a latency SLA.
See the [verification record](../openspec/changes/archive/2026-09-23-preview-conventional-xirr/verification.md)
for actual commands, predecessor failures, image identities and unrun checks.

## Manual USD price history

See [manual USD price points](manual-usd-prices.md). Current schema is migration18;
existing fixture current-version assertions include its exact migration name.
`manual-usd-prices-db.cjs` is part of the full runner and verifies fresh18,
populated17 upgrade preservation, immutable correction/void/replay, two-pool CAS,
RR consistency, exact values, ownership and cap constraints. The retained migration
suite also passed: supported previous8–16 upgrades to18, fresh/replay, config/lock
checks and unsafe legacy refusals. No migration is run against owner data.

Focused command `pnpm --dir backend test --runInBand --coverage=false
manual-price-input.spec input.spec accounting.service.spec` passed488 cases/10
suites (55 new,433 retained). New two-case `manual-usd-prices.spec.ts` plus retained
OPEN-001-A/OPEN-002-A passed3/3 in44.7s, one worker/zero retries. After strengthening
the existing UI case with failed-refresh-after-save assertions, only that case
was repeated:1/1 in13.5s against identical images. All requests exercise actual
password/MFA/backend/PostgreSQL; delayed/lost delivery follows real `route.fetch()`.
No existing E2E case or CI gate was removed. See the [verification record](../openspec/changes/archive/2026-09-23-record-manual-usd-prices/verification.md).


## Historical account valuation

See [historical valuation](historical-valuation.md). The selected pure command
`pnpm --dir backend test --runInBand --coverage=false historical-valuation
historical-accounting manual-price-input` passed123 cases/4 suites (31 new,
92 retained). The new `historical-valuation-db.cjs` passed four scenario families
against actual PostgreSQL; retained `historical-accounting-db.cjs` also passed,
protecting the extracted caller-owned read loader. No migration was added;
fresh isolated fixtures use existing migration18.

Only three HTTPS cases were selected: new VAL-API and VAL-UI plus retained
HIST-004-A UI snapshot. They passed3/3 in37.8s, one worker and zero retries, with
real password/MFA/backend/PostgreSQL and external-provider-only stubs. The full
runner includes the new PG fixture and discovers both new browser cases; all old
cases remain. See the [verification record](../openspec/changes/archive/2026-09-23-value-historical-account/verification.md)
for the exact filter, predecessor RED, image IDs, reviews and unrun checks.
