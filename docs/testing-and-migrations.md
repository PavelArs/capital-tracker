# Local verification and explicit migrations

Use Node 26.10.0 (`nvm use`), pnpm 12.9.1 and Docker Compose. The existing
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

For the owner-authorized manual + CSV release exception, `pnpm test:e2e:critical`
selects the reviewed critical browser profile while retaining the acceptance runner's
real PostgreSQL/domain/migration, provider transport/TLS, CLI/MFA, startup-refusal
and artifact checks. Its browser subset does not establish that the full 174-case
suite passed. The full `pnpm test:e2e` command and every test file remain available
for broad regression. See [`critical-release-coverage.md`](critical-release-coverage.md)
for selected risks and excluded browser-layer coverage. Encrypted backup/restore,
off-host recovery and server deployment checks remain separate mandatory release
gates; the browser runner does not perform them. CI must bind the successful critical
gate receipt to the candidate source and exact manifest before candidate export or
promotion. A paused, skipped or partial critical gate cannot produce release evidence.

Since 2026-10-05 (owner decision) every check runs on pull requests: lint, unit tests,
builds, specification gates, the dependency audit, `Build Release Images`, the six
`Critical acceptance (<shard>)` jobs, `Image Security Scan` and
`Acceptance Receipt and Image Security`. A
manual run of the CI workflow (`workflow_dispatch`, any branch) runs the same suite. A
push to main runs no tests: `Build Release Images` builds and exports the deploy
candidate and `Merged Pull Request CI` (`scripts/check-merged-pr-ci.cjs`) requires that
the pull request merged as that commit had a successful newest CI run on its final head
with every shard, the scan job, the receipt job and `CI Status` green (it waits while that run is
still going). If that pull request run cannot prove it (it failed, or it predates a job
the suite now requires, as when a pull request merged without merging main after a CI
layout change), start a manual CI run on main while that commit is its head; once it is green with every
required job, re-run the failed jobs of the push run and the gate accepts the manual run
instead (owner decision 2026-10-05). The newest manual run of the commit decides, and a
run missing any shard, the scan job, the receipt job or `CI Status` is refused like a
pull request run. Only a push run on main can be deployed; pull request and dispatched
runs are review evidence only. A pull request tested while behind main proves its own merge
result, not the main tree after later merges; keep branches up to date before merging
when that matters.

In CI the critical profile runs in parallel shards on images built once:

- `Build Release Images` pulls and verifies the pinned PostgreSQL and Redis images,
  runs `node scripts/acceptance.mjs images --manifest release-images/manifest.json`
  (the same Compose build of backend and frontend) and uploads `docker save` of the
  four images, compressed with zstd, with their schema-v3 manifest; the manifest also goes
  alone into `release-images-manifest` for the receipt job. On the owner's self-hosted
  runners the archive goes to the shared image store `/srv/ci-images/<run id>/` instead
  of the artifact (the private repository's artifact storage cannot hold it); its
  checksum stays in the artifact and every consumer verifies it before loading
  ([self-hosted runners](self-hosted-runner.md)).
- Each shard loads them, refuses any ID that differs from the manifest and runs
  `node scripts/acceptance.mjs critical --shard <name> --images release-images/manifest.json`
  on its own stack. `probes-1` and `probes-2` run the 31 real checks of the serial
  runner, each check in exactly one shard (`scripts/acceptance-shards.cjs` holds the
  list and the assignment; the shard with client source startup migrates and seeds
  first). `browser-1..4` take the manifest cases whose index modulo 4 is 0, 1, 2 or 3, after
  migration, seed, application start, the HTTPS ingress check and the artifact check.
  Each shard writes `test-results/critical-shard-<name>.json`. Browser shards restore
  the Playwright browser from an Actions cache keyed on the installed Playwright version
  (a push to main refreshes it in `Warm Playwright Browser Cache`, which gates nothing).
- `Image Security Scan` loads and verifies the same images beside the shards, scans all
  four with Trivy and enforces the high/critical gate.
- `Acceptance Receipt and Image Security` runs after the shards and the scan passed. It
  merges the receipts with `node scripts/acceptance-shards.cjs merge …` into the unchanged
  `test-results/critical-release-acceptance.json` only if every shard tested the
  manifest images for this commit and run and the checks and cases are covered exactly
  once and passed; then it verifies the receipt.

Shard mode needs a CI run id and prebuilt images; locally keep using
`pnpm test:e2e:critical` (serial, builds its own images) or `pnpm test:e2e`. Print the
split with `node scripts/acceptance-shards.cjs plan`.

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

Pull request and main CI run only the critical subset (`critical-acceptance` shards).
The full `pnpm test:e2e` suite runs in `.github/workflows/full-acceptance.yml`: nightly
on main, on demand (Run workflow), and on a pull request that changes that file. It is
not a required check; a red nightly run is a regression to fix.
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
uuid-ossp and applies nineteen migrations: eight historic migrations, the additive
owner binding, the session table, the MFA/session extension and the additive
request admission ledger, four manual-accounting tables, three USD journal tables,
three CSV import tables, the carry-in baseline table/journal opening reference and two external USD flow tables, manual USD price history and daily display FX. A populated fully
migrated database is idempotent. The twelfth through nineteenth migrations preserve
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
entry are added. The populated seventeen-to-eighteen fixture retains prior accounting,
flow, authentication and admission state while adding manual USD price history.
Migration19 adds only two daily display-FX tables; fresh19 and populated18
preservation/replay checks are required for this change. Current binaries require all
nineteen migrations. Old images cannot interpret a new
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

See [manual USD price points](manual-usd-prices.md). That feature added migration18;
its archived acceptance verified fresh18 and populated17 upgrades. Current schema
is migration20 after the additive owned-transfer tables.
`manual-usd-prices-db.cjs` is part of the full runner and now expects fresh20,
populated17 upgrade preservation through20, immutable correction/void/replay, two-pool CAS,
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


## Daily display FX

See [daily display conversion](daily-display-fx.md) and the archived
[verification record](../openspec/changes/archive/2026-09-24-collect-daily-display-fx/verification.md).
Migration19 adds two tables for immutable provider observations and persistent
collection coordination. Startup does not create or synchronize them; migration
remains an explicit CLI operation. The current PostgreSQL fixture requires a fresh20
database and a populated18 upgrade preserving prior rows, schema, sequences and
session data. The migration fixture also checks replay and refuses unsafe legacy
histories.

M20 removed the display FX module with the other legacy modules (assets, liabilities, crypto,
currencies, metrics). Its unit tests, DFX-API case and `display-fx-db` probe went with it; the
migration and its tables stay, and the migration fixtures keep checking them.

These focused command examples assume the isolated acceptance environment is
initialized where required; they do not provision it. Actual selected PostgreSQL
checks and all three HTTPS cases passed (38.9s, one worker, zero retries). The
verification record records the initial migration-fixture failure, its correction,
stronger expiry/rollback oracles, image identities and unrun gates. This is scoped
evidence, not a full-suite or release/production claim.

## Historical account valuation

See [historical valuation](historical-valuation.md). The selected pure command
`pnpm --dir backend test --runInBand --coverage=false historical-valuation
historical-accounting manual-price-input` passed123 cases/4 suites (31 new,
92 retained). The new `historical-valuation-db.cjs` passed four scenario families
against actual PostgreSQL; retained `historical-accounting-db.cjs` also passed,
protecting the extracted caller-owned read loader. No migration was added;
the archived acceptance used schema18 at that time. Current fresh fixtures use
migration20.

Only three HTTPS cases were selected: new VAL-API and VAL-UI plus retained
HIST-004-A UI snapshot. They passed3/3 in37.8s, one worker and zero retries, with
real password/MFA/backend/PostgreSQL and external-provider-only stubs. The full
runner includes the new PG fixture and discovers both new browser cases; all old
cases remain. See the [verification record](../openspec/changes/archive/2026-09-23-value-historical-account/verification.md)
for the exact filter, predecessor RED, image IDs, reviews and unrun checks.

## Manual portfolio valuation preview

See [manual portfolio valuation](manual-portfolio-valuation.md) and the archived
[verification record](../openspec/changes/archive/2026-09-24-preview-manual-portfolio-value/verification.md).
The preview reuses migration19 without schema or dependency changes. Its explicit
one-to-ten account selection bounds snapshot work; no catalog page is silently
added. One read-only repeatable-read transaction covers account history and exact
manual prices. The result makes missing coverage and price gaps explicit, makes no
business writes, and makes no provider requests.

Scoped commands:

```sh
pnpm --dir backend test --runInBand --coverage=false manual-portfolio-valuation
pnpm exec playwright test tests/e2e/manual-portfolio-valuation.spec.ts tests/e2e/historical-valuation.spec.ts --grep 'MPV-|VAL-UI:' --workers=1
```

In the already-started isolated Compose environment, the actual PostgreSQL fixture
can be run separately:

```sh
docker compose -p capital-tracker-e2e -f tests/e2e/compose.yml run --rm --no-deps \
  -v "$PWD/tests/e2e:/tests:ro" -e NODE_PATH=/app/backend/node_modules migrate \
  env -u TRUSTED_PROXY_IPS node /tests/manual-portfolio-valuation-db.cjs
```

The fixture creates its fixed database only after verifying it is absent. Never
point it at owner data or reuse its existing fixture. Three new PostgreSQL families
and four retained historical-valuation families passed in
`/private/tmp/capital-mpv-db.log`. Both MPV HTTPS cases and retained VAL-UI passed3/3
in37.0s, one worker and zero retries (`/private/tmp/capital-mpv-green.log`). The browser
selection includes retained VAL-UI to check that the new
route does not change individual account valuation. No full-suite or release-pass
claim is made; consult the verification record for exact images and remaining gates.

## Account valuation history

See [account valuation history](valuation-history.md). Targeted backend tests use:

```sh
pnpm --dir backend test --runInBand --coverage=false valuation-history historical-valuation historical-accounting
```

These passed 95 cases across four suites (27 new and 68 retained). Frontend tests
passed 98 cases across 11 files, including chart precision, zero, missing points,
UTC spacing and no connecting lines. New `valuation-history-db.cjs` passed three
families against real PostgreSQL: timeline/validation/privacy, concurrent coherent
snapshots, and 31 samples across the supported maximum history. Four retained
`historical-valuation-db.cjs` families also passed. No migration was added.

After isolated build/migrate/seed/artifact checks, the selected browser command was:

```sh
pnpm exec playwright test tests/e2e/valuation-history.spec.ts tests/e2e/historical-valuation.spec.ts --grep 'VCH-|VAL-UI:' --workers=1
```

It passed 3/3 in 38.3s, one worker and zero retries, with actual password/MFA/backend/
PostgreSQL. The UI case covers exact values, a gap-only table without a chart,
period changes, zero-price refresh and a delayed real response preserving the draft.
The full runner includes the new PG fixture; existing cases and CI gates remain.
The [verification record](../openspec/changes/archive/2026-09-24-chart-account-valuations/verification.md)
records genuine predecessor RED, independent reviews, images and unrun checks.


## Owned-account transfers

Migration20 adds only transfer journals, identities and immutable versions. The
[transfer guide](owned-transfers.md) and [verification record](../openspec/changes/archive/2026-09-24-record-owned-transfers/verification.md)
describe the exact scope, actual failures/fixes and successful targeted checks.
`owned-transfers-db.cjs` tests production services on real PostgreSQL: connected
finance/correction/void, CSV, snapshots, replay, constraints, deferred COMMIT,
process races and account/owner capacity. Its `--limits-only` option permits a
focused capacity rerun. `owned-transfers-bounds-db.cjs` verifies1101 priced positions,
10001 accessible lot/match fragments, pinned allocation, coherent selected portfolio
and once-only series loads. Both are included in the full acceptance runner.

The migration fixture's `--economic-predecessors` selection verifies fresh20 plus
populated14/15/16/18 upgrades. Native SQL constructs prior-schema economic fixtures;
current services verify actual post-upgrade receipts/journals/CSV/carry-in results.
It never installs new tables in the predecessor or makes production ignore absent
schema. Manual-price fixtures separately retain populated17 upgrade coverage.

Two new HTTPS cases cover protected API economics and the Russian review/create/
ambiguous-delivery identical retry/correction/void journey. Three retained trade,
carry-inCSV and private-history cases were selected; the whole E2E suite was not
repeated. Only external providers are stubbed. Full suite/release gates remain.

## Asset swap schema preservation

For the current schema22, `migrations.cjs --from21` selects fresh/no-op checks and
the immediately preceding populated schema21 upgrade. The full migration runner
also includes this predecessor. Run the fixture inside the isolated test Compose
migrate container with `/tests` mounted and `NODE_PATH=/app/backend/node_modules`,
as for the other PostgreSQL fixtures; never point it at owner data.

`migration-reward-predecessor.cjs` constructs native prior-schema reward/transfer
rows and frozen receipts. Current services verify their identical replay and
transferred reward basis after upgrade. Shared predecessor fixtures retain real
encrypted MFA, sessions/recovery/admissions, legacy financial rows, trades, CSV
bytes/receipts, carry-in, flows and exact manual prices. Display FX rows are populated
too. Every old row/schema object is compared; new swap tables are empty. Repeated
migration is a no-op, and destructive downgrade is refused without changes.

`asset-swaps-db.cjs` additionally checks55 direct SQL refusals with exact SQLSTATE
and full-row rollback checks, positive null/zero/30-digit and fee controls, and an
actual deferred COMMIT failure witness. This focused gate passed on2026-09-26;
see the active swap verification record.

The later scoped swap runtime checkpoint also passed on2026-09-26. Main fixture now
has6families including connected CSV funding/sales/rollback, reward/transfer
dependencies and four real concurrent RR/read-only history/series/selected-portfolio/CSV
preview reads. Review added a rejected earlier CSV sale that would strand a later swap;
its exact error envelope and every business row remain unchanged. Every chart/selected-account request materializes nonempty swap history once.
The new `asset-swaps-bounds-db.cjs` has6families: four separate-process races through
actual owner advisory locks;1000active swaps;10000owner versions with spare local
ticks; local/passive10000revision budgets; connected1001 refusal before row loading;
and102allocation fragments across3pages with complete totals/upstream pin invalidation.
Both fixtures are included in the full runner. No browser case was added for these
database boundaries. Independent review/final scoped verification/archive completed
on2026-09-26; see the archived swap record and docs/reviews/2026-09-26-verification.md.

Release hardening still required: shared accounting advisory locks have no dedicated
transaction-local lock-wait timeout. Serialization tests release the lock explicitly;
they do not prove bounded refusal. A separate change must define the timeout policy,
verify timely private failure under a held owner lock, preserve every row/request key
and prove successful explicit retry after release. Do not present current behavior
as a verified bounded wait.
