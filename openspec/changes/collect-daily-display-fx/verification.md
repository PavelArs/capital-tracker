# Daily display FX verification

Status: implemented, independently reviewed and targeted GREEN; archive pending.

## Baseline and scope

At a09af5a, retained `pnpm --dir backend test --runInBand --coverage=false
valuation-history historical-valuation historical-accounting` passed95/4 in1.79s.
Raw log `/private/tmp/capital-next-baseline.log`. Active changes initially empty;
20 canonical specs. Owner Nginx edit and all existing data/worktrees preserved.
Node host22.23.2, image22.21.1, pnpm10.33.0, OpenSpec1.2.0, PG16.10.

Keep: exact USD accounting/manual prices/chart, Nest/TypeORM/PostgreSQL, Axios,
Jest/Vitest/Playwright, existing GHCR/Compose topology and protected deployment flag.
Simplify: new daily FX uses PostgreSQL storage/coordination instead of repeating
legacy in-memory patterns. Remove: nothing in this slice; legacy consumers retain
behavior until separately migrated. Schema18→19 is additive; no dependency change.
User deferred chart/max-period review until overall completion; no change here.

Sol researched official provider documentation and identified a viable no-key daily
FX source with cached end-use permission. Root rechecked official pages2026-09-24.
Scope is private indicative conversion, no reusable rate feed/redistribution. No
live source request, account creation, credential access or paid service activation.

## Selected checks

- Pure exact parser/product/time/cooldown edge cases plus retained valuation suites.
- Actual PG: fresh19 and populated18 preservation/replay, exact complete batches,
  duplicate/correction rejection, RR read/fingerprints, separate-connection lease
  race/fencing/crash budget and failed transaction with last-good preservation.
- Actual outbound adapter against controlled external fixture: valid, malformed,
  rate-limited, redirect, timeout and bounded data; no mocked backend/authentication.
- Two new HTTPS API/UI cases plus retained VCH-UI, real password/MFA/backend/PG,
  strict negative inputs/CSRF, exact values, zero provider-on-read and late results.
- Relevant frontend tests, builds/lints/scoped TS, production dependency gate,
  migration current-version fixture updates and strict OpenSpec validation.

Full E2E/full backend, full older-schema matrix, hostedCI, release scans and production
are not selected. Existing CI tests/gates remain. New schema migration requires
real fresh19 and populated18 upgrade evidence even though full matrix is unrun.

## RED / implementation / GREEN

Independent contract review (Sol) corrected a fixed-window budget proposal to the
last three actual reservation timestamps, ensuring the promised rolling24h cap.
It also required connection-time direct DNS address validation and an explicitly
opted-in trusted egress-proxy boundary; root incorporated both. Replay compares
provider fields while preserving the original fetchedAt. No remaining contract
blocker. Strict21 items (20 canonical + active change) passed. Production dependency
audit exit0, two existing moderate findings/no high or critical; raw log
`/private/tmp/capital-fx-audit.log`. No lock change.

### Behavioral RED before implementation

At a620174 the two new Playwright cases ran through actual HTTPS, password/MFA,
backend and PostgreSQL against the preceding accepted images, before any new
product implementation. Exit1, two expected failures: anonymous GET expected401
but received404; Settings navigation `Курсы для отображения` was absent (10s).
Missing modules/tables were not used as RED. One worker, zero retries.
`/private/tmp/capital-fx-red.log` and `/private/tmp/capital-fx-red-artifacts`.

- Backend `sha256:9dcf0eaf717e063e7b198265498057471066dbdf57732aa23f41b2c9205d28e0`
- Frontend `sha256:c9456cdf239a2a6b05e12a58b4e070d7930f1dcd407932f489f6f579b04b9d1e`

### Implementation and independent review

Root implemented migration19, provider/domain/service/API in add57b4. The unchanged
scale60 product helper moved to accounting/money.ts; retained95 characterization
tests passed. Sol UI07616a3 integrated as bf4660a; root857db02 distinguished no-data
failure text from last-good-data failure. Luna acceptance8286db4 integrated99c4f6c;
root a620174 strengthened exact web-first table values and failed-refresh retention.
Separate worktrees and bounded file ownership; no dependency/deployment replacement.

Sol reviewed backend/provider/SQL/concurrency/privacy and reported no product
blocker; root reviewed frontend and acceptance. A further independent PG-oracle
review found that replaced-token fencing did not prove same-token expiry, and an
arbitrary caught Error did not prove deferred COMMIT failure. Root fb60e10 added
actual same-token expiry, untouched successor-health assertions, a nontransactional
sequence witness proving the deferred INSERT trigger ran, exact P0001 failure and
whole completion-state rollback. No assertion was weakened. Downgrade refusal now
also has an all-table fingerprint oracle.

### Source checks

- Targeted backend command `pnpm --dir backend test --runInBand --coverage=false
  display-fx valuation-history historical-valuation historical-accounting`:
  152tests/6suites PASS in1.965s (57new +95retained),
  `/private/tmp/capital-fx-backend-unit.log`.
- Sol frontend `pnpm --dir frontend test`:101tests/12files PASS in3.21s.
- Both production builds PASS; frontend retains the existing >500kB bundle warning.
  Root `/private/tmp/capital-fx-frontend-build.log`; backend build exited0.
- Backend/frontend lint PASS with77/29 existing warnings;
  `/private/tmp/capital-fx-backend-lint.log` and `capital-fx-frontend-lint.log`.
- Scoped backend/frontend Biome and strict/noUnused E2E TypeScript PASS.
  `node --check` for changed CJS fixtures and `git diff --check` PASS.
- Sol added two focused actual-provider wiring tests in bab9c58 (integrated9323ad6):
  fixed endpoint/direct `proxy:false`, connection-agent lookup rejects mixed public/
  private DNS answers, explicit trusted proxy omits that agent. Only external DNS/
  Axios boundaries mocked. Root reran `pnpm --dir backend test --runInBand
  --coverage=false display-fx`:59tests/2suites PASS in1.714s,
  `/private/tmp/capital-fx-provider-final.log`. These are two additional cases;
  the earlier152-case aggregate is not represented as a rerun with154.

### Actual PostgreSQL and outbound adapter

First attempt at857db02: fresh19/populated replay PASS, then the populated18 setup
failed because `createPreviousSchema` still allowed only versions8..16. This was
a fixture defect, not application RED or a passed upgrade. No later families ran
on that attempt. `/private/tmp/capital-fx-db-attempt1.log`, exit1. Root144c770 added18
to that guard without changing the preservation oracle and wired the new PG
fixture into the retained full acceptance runner.

Second attempt at144c770: `/private/tmp/capital-fx-db.cjs`, log
`/private/tmp/capital-fx-db-attempt2.log`, exit0:

- MIG-002-A missing connection settings refused before connection.
- ISO-001 actual fresh19 migration and populated no-op replay PASS.
- DFX-MIGRATE actual populated18→19 CLI PASS: all previous rows/schema/session/
  admissions/encrypted MFA/recovery state unchanged; new tables empty; replay no-op.
- All five FX PG families PASS: exact scale60 and immutable replay, two real pools
  racing and rolling budget/restart, actual adapter failures/redirect/5s timeout/429,
  last-good retention, fencing/rollback and genuine RR barrier with zero-provider reads.
- Retained `historical-valuation-db.cjs`: VAL-EXACT/GAPS/PRIVATE, VAL-COVERAGE,
  VAL-SNAPSHOT and VAL-PRECISION all PASS.

After the independent oracle findings, only affected FX families were rerun at
fb60e10 with `/private/tmp/capital-fx-db-final.cjs`; log
`/private/tmp/capital-fx-db-final.log`, exit0. All five strengthened families plus
explicit DFX-MIGRATE downgrade refusal PASS. Replaced lease state, expired original
lease, deferred trigger execution and data/health rollback are separately asserted.
Same backend image across both successful PG runs:
`sha256:514843fb64d028cdbe63deda161654147d203b750faba5dd6c9cac32f1dba2d7`.

These runs use actual compiled service/adapter and PostgreSQL16.10, a fixed-host
external HTTPS fixture through the explicitly trusted egress proxy, and synthetic
tmpfs databases. Only external providers are controlled. No owner data or live
provider was accessed. Direct-mode DNS filtering is separate unit coverage; proxy
integration is not evidence of direct-mode real network resolution. All test
containers/networks were removed in each harness finally block.

### HTTPS and final archive

At fb60e10, `/private/tmp/capital-fx-green.cjs` built both images, migrated/seeded
the disposable database and ran:

`pnpm exec playwright test tests/e2e/display-fx.spec.ts
tests/e2e/valuation-history.spec.ts --grep 'DFX-|VCH-UI:' --workers=1`

Exit0, **3/3 in38.9s**, one worker, zero retries: DFX-API, DFX-UI and retained VCH-UI.
Real HTTPS edge/password/MFA/session/backend/PostgreSQL; only external providers
stubbed. The delayed browser response is `route.fetch()` from the actual backend,
not a fabricated payload. Exact conversion, unavailable/zero distinction,
failed-refresh stale retention, denied anonymous/pending/CSRF/extra fields, provider
counter preservation and stale-intent handling are asserted. Containment/artifact
checks PASS. `/private/tmp/capital-fx-green.log` and
`/private/tmp/capital-fx-green-artifacts` contain synthetic-only evidence.

- Backend `sha256:514843fb64d028cdbe63deda161654147d203b750faba5dd6c9cac32f1dba2d7`
  (identical to both successful PG runs).
- Frontend `sha256:83370644fb9133219770465629851a07b3db933984f9a629d3c592fd5e24df71`

No unexpected HTTPS GREEN failure. All labeled containers and networks removed;
live `docker ps -a`/`docker network ls` inventory empty after cleanup. Owner Nginx
mode0644/size1348/SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`
and lock SHA256
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`
match the preserved baseline. No folder deletion, owner-data access, paid activation,
remote push, hostedCI, live-provider availability check or production rollout.
The wider brief remains incomplete; chart maximum-period review stays deferred.
