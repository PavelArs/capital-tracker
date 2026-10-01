# Verification — isolate-release-acceptance

Date: 2026-09-21. Base repository commit 9c78d80036d6314e8902dc54adb0e26d30d156a2;
local working-tree changes under review, no remote push or deployment. Node 22.21.1,
pnpm 10.33.0, OpenSpec 1.2.0, Playwright 1.63.0, Docker daemon 29.5.3.

## Acceptance evidence

| Contract | Executable evidence | Actual result |
|---|---|---|
| MIG-001-A | backend/src/config/typeorm.config.spec.ts, actual application configuration | RED: migrationsRun true, installExtensions absent; GREEN after fix |
| MIG-002-A | tests/e2e/migrations.cjs, each absent DB_* variable invokes actual release CLI | All five rejected before connection without credential disclosure |
| MIG-002 concurrency | Same test holds PostgreSQL advisory lock, invokes CLI, compares snapshots, then releases | Contention rejected without mutation; next migration succeeds |
| ISO-001 | Same test on new real PostgreSQL DB, actual eight migration classes; insert row; repeat CLI; compare all schema/data/ledger snapshots | Pass |
| ISO-002 | Same test with first four actual migrations and unknown ZZZ asset/Solana wallet; additional empty prior-schema fixture; compare all snapshots | Both refused before mutation, pass |
| Migration diagnostics | config/migration-logger.spec.ts calls actual TypeORM logger with synthetic private marker | RED exposed marker despite logging:false; explicit safe logger GREEN |
| ISO-003-A/B | tests/e2e/portfolio.spec.ts through HTTPS, release backend/frontend and actual PostgreSQL | Anonymous tested private endpoints denied; real password login pass |
| ISO-004-A/B | Same browser suite creates 1.25 BTC from fixture, asserts exact PG decimal string, reloads/restarts backend, refreshes to 2 BTC, deletes/reloads | Pass with actual adapter/provider HTTP boundary |
| ISO-004-C | Real browser login; use legitimately issued token for foreign-wallet read/delete/refresh; compare DB row and provider request log | 404, no mutation/outbound refresh, pass |
| ISO-005-A | tests/e2e/artifacts.cjs inspects exact running image IDs, both images' files, network/ports and owner Nginx checksum | Pass |
| ISO-005-B | config/scheduling.spec.ts reads actual AppModule scheduler registration | RED explicit false still enabled; GREEN default/false/true (3 cases). Browser explicit refresh still reaches real adapter |

`pnpm test:e2e` final run exited 0. Four Chromium tests passed in 9.5 seconds,
zero retries. Stack teardown removed all synthetic containers and both networks.
Log `/tmp/capital-isolated-e2e-rerun.log`; synthetic report `playwright-report/`.
Migration tests run externally mounted inside the release backend image and never
copy test files into that image. PostgreSQL uses disposable tmpfs, no owner volumes.

Exact running images inspected and browser-tested:

- Backend: sha256:5089c2a3ebd5a2ca1144982f6e17e0bdb2c94d4e61d2b129068f73e3aaa222cd
- Frontend: sha256:ce5ae330a9883528ee97a9ac395c533856266462f5263a73c4487fabe8cabed3

These are local image IDs, not published registry digests or promotion evidence.

## RED and environment failures

- Old command `node dist/typeorm-data-source.js migration:run` returned exit 0 with
  every DB_* setting absent. An executable assert.notEqual(status,0) failed as
  intended before the real migration CLI was implemented. Old command only exported
  a datasource; no migration was executed.
- Startup options, logger disclosure and periodic scheduling recorded intended
  failed assertions before corresponding fixes. Existing wallet/login behaviors
  are characterization: no artificial RED was manufactured.
- First full isolated run passed real migrations and backend artifact checks but
  all four browser tests failed ERR_CONNECTION_REFUSED. Internal-only proxy network
  did not publish reachable host ingress on Docker Desktop. This is environment
  failure, not behavior RED. A separate ordinary ingress network was added only
  to proxy; backend/dependencies remain internal-only. Host HTTPS readiness polling
  now precedes browser execution. Separate host curl and final real tests passed.

## Independent review and regression

QA contexts independently wrote migration/config and browser tests; separate review
examined implementation, oracles, Docker, networks and CI. Findings resolved:

1. TypeORM logging:false still prints raw migration failure messages -> explicit
   no-op logger, synthetic marker regression RED/GREEN.
2. Unlock failure could skip connection cleanup -> nested finally guarantees release
   and datasource destruction attempts. Reviewed exception paths.
3. Old workflow contexts incompatible with root-context Dockerfiles -> CI invokes
   the same local E2E command; CD explicitly uses root context and Dockerfile path.
4. Initial artifact gate inspected only backend -> frontend static/config scan,
   Nginx syntax, exact running image and original owner file SHA256 check added.

Final reviewer found no blocking issues for this scoped change after inspecting
actual passing logs. No review claims final application or release security.

`pnpm verify:baseline` exited 0: strict OpenSpec, lint, both builds, 264 backend
Jest tests, 59 frontend Vitest tests. Existing lint warnings/bundle-size warning
remain; frontend effective coverage is 35.41% statements and 18.75% branches.
Log `/tmp/capital-isolation-regression.log`. `pnpm test:engineering` rerun after CI
wiring: 142 pass, log `/tmp/capital-engineering-e2e-wiring.log`.
Both Docker builds completed frozen installs and image inspections; bcrypt native
hash/compare worked and backend ran as UID 1000. `git diff --check` and supported
strict OpenSpec validation pass at archive.

## Remaining limits

No owner database, remote server, live provider, production credential or private
portfolio accessed. No hosted GitHub run, publication or production deployment.
The legacy CD workflow remains disabled by default and still needs replacement
of unsafe backup/artifact/promotion steps before owner-authorized rollout.

Existing old schemas with unsafe pending migrations are deliberately refused;
data-preserving conversion, encrypted backup/restore and owner inventory remain
required. Tests do not authorize destructive owner-data migration. Runtime DB role
separation, full route/auth security, mandatory MFA/revocable sessions, scanner/ASVS
coverage, second browser, financial accounting, stored history, network adapters,
AI and final recovery readiness remain in the full target. No full-goal completion.
