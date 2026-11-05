# ADR-002: Module boundaries, a background worker and readiness for more than one owner

**Status:** Proposed
**Date:** 2026-11-04
**Deciders:** owner
**Source commit:** `bdabff7` (main after PR #405)
**Companions:** [ADR-001](architecture-audit.md) (system-level patterns: caching, queues, backups, pacing, health checks) and the [code quality audit](code-quality-audit.md) (duplication and maintainability). This record does not repeat their findings.

## Context

The owner asked whether it is time to move to microservices, and said the application may later serve more than one person. This record answers three questions:

1. Should the backend be split into services? If not, what boundaries should the monolith keep?
2. What should leave the HTTP process for a background worker, and when?
3. How far is the data model from serving several owners, and what is the additive path there?

Multi-user is out of scope today. The brief says "One owner, no public registration, no sharing, no multi-tenant features" (`capital-tracker-openspec-prompt.md:20`), PR-AUTH-1 in `docs/product-requirements.md` says "One owner, created only by the CLI; no signup route", and `docs/business-requirements.md` §18 lists multi-user as out of the MVP. Changing that is an owner decision. This record does not change it. It describes what a change would take, so the owner can decide with the cost in view.

### The system today

| Part | Size at `bdabff7` | Notes |
|---|---|---|
| Backend | about 54,000 lines in `backend/src` without specs (3,500 of them migrations), 20 top-level folders, 18 Nest modules, 31 controllers, 132 routes | One NestJS process serves HTTP, runs six `@Interval` jobs and exposes metrics on loopback `:9464`. |
| Frontend | about 37,000 lines in `frontend/src` without tests, 14 feature folders | React and Vite, served by nginx in its own container. |
| Database | 76 migrations, PostgreSQL 16 | Single schema. |
| Tests | 54 containerized PostgreSQL probes (`tests/e2e/*-db.cjs`), 36 Playwright specs | Critical profile on every PR, full suite nightly (`.github/workflows/full-acceptance.yml`). |
| Deployment | Three Compose services (`postgres`, `backend`, `frontend`) behind the owner's host nginx | Release through `cd.yml` after the owner's approval, then the dispatcher on the server (`docs/manual-mvp-release.md`). Redis was removed in #370 (ADR-001 item 2). Daily encrypted backups with a backup-age alert landed in #369 and a dashboard panel in #387 (ADR-001 item 1); installing the host timer is the owner's step, which the repository cannot show. ADR-001's checklist is not ticked for either. |

Backend module sizes (lines without specs):

| Module | Lines | Role |
|---|---|---|
| `accounting` | 21,067 (104 files) | Ledger commands, FIFO, valuation, operation list, chain classification, CSV import, audit history. The hub. |
| `wallet-addresses` | 11,299 (50 files) | Seven sync adapters (Bitcoin, EVM chains, Solana, Stellar, Tron, Zcash, Bybit) and their provider clients. |
| `brokers` | 4,387 | T-Bank connection, import and prices. |
| `migrations` | 3,534 | Raw SQL. |
| `auth` | 2,538 | Sessions, MFA, password reset, request limits. |
| `deposits` | 2,042 | Bank deposits and accounts. |
| `portfolio-snapshots` | 1,980 | Materialized history. |
| `owner-export` | 1,290 | Backup export. |
| `prices`, `inflation`, `goals`, `fx-rates`, `observability`, `sync-status`, `shared`, `entities`, `config`, `owner-settings`, `health` | 70 to 1,182 each | |

## Decision

1. **No microservices.** Keep one backend codebase and one database. Revisit only on a trigger listed under "When to revisit".
2. **Keep a modular monolith, and make its boundaries explicit.** First freeze the current module graph with a test, so no new cycle appears. Then remove the few cycles that come from misplaced shared code. Leave the accounting core alone unless a feature already touches it.
3. **Prepare a worker process, and start it only on a measured trigger.** The worker is the same image with a second entry point, not a new service. The preparation is one small change.
4. **Keep the schema tenant-ready, and do not build multi-user until the owner decides to.** The data is already keyed by owner. The blockers are in authentication, owner provisioning, provider quotas and the absence of a route-level isolation check. Each has an additive path, listed below.

## Findings

### 1. Backend coupling

Module-to-module imports (count of import lines, specs excluded):

| Module | Depends on |
|---|---|
| `accounting` | `shared` 29, `wallet-addresses` 24, `fx-rates` 10, `prices` 7, `owner-settings` 3, `inflation` 3, `entities` 3, `portfolio-snapshots` 2, `deposits` 2, `brokers` 2 |
| `brokers` | `accounting` 40, `shared` 4, `fx-rates` 4, and five more with one each |
| `portfolio-snapshots` | `accounting` 15, `fx-rates` 6, `inflation` 3, `deposits` 2, `shared` 2, and three more |
| `wallet-addresses` | `accounting` 10, `sync-status` 3, `shared` 2, `prices` 2, and three more |
| `deposits` | `accounting` 7, `portfolio-snapshots` 4, `inflation` 3, `fx-rates` 3, `shared` 2 |
| `owner-export` | `accounting` 5, `wallet-addresses` 2, and three more |
| `goals` | `accounting` 2, `portfolio-snapshots` 2, `shared` 2, `fx-rates` 1, `deposits` 1 |
| `fx-rates` | `accounting` 1, `sync-status` 1, `prices` 1, `observability` 1 |
| `inflation` | `fx-rates` 3, `accounting` 1, `sync-status` 1, `shared` 1, `observability` 1 |
| `sync-status` | `accounting` 1, `prices` 1, `shared` 1 |
| `owner-settings` | `accounting` 2, `shared` 1, `fx-rates` 1 |
| `prices` | `wallet-addresses` 3, `sync-status` 1, `observability` 1 |
| `config`, `health`, `shared` | `auth` 1 each |

Direct two-module cycles (eleven), and where they come from:

- **`accounting` ↔ `wallet-addresses`.** `accounting` imports `wallet-addresses/chain-assets` from 9 files and `evm-chains` once (the asset and network catalogue), plus `token-visibility`, `token-left-out`, `stake-tables`, `bybit-records` (3 each), `wallet-removal` and `tron-legs`. `wallet-addresses` imports `accounting` 10 times.
- **`accounting` ↔ `deposits`, `portfolio-snapshots`, `brokers`.** `accounting` imports `deposits/deposit-valuation` and `deposit-store`, `portfolio-snapshots/real-profit` (2) and `brokers/broker-provenance` (2); each of those modules imports `accounting` heavily (7, 15 and 40 lines).
- **`accounting` ↔ `fx-rates`, `inflation`, `owner-settings`.** `accounting` uses them (`fx-rates` 10; `inflation/inflation-math` 2 and `inflation.service` 1; `owner-settings.service` 3). They import `accounting` only for `accounting/money.ts` (`canonicalDecimalToAtoms`, `formatAtoms`) and `accounting/input.ts` (`parseUuid`, `parseDecimal`). These two files are a shared kernel that lives inside one domain; moving them breaks these three cycles.
- **`prices` ↔ `wallet-addresses`.** `prices` imports `chain-assets`, `chain-tokens` and `evm-chains` (the same catalogue); `wallet-addresses/token-left-out` imports `prices/market-price.store` and `price-collection`. `prices` does not import `accounting`; `accounting` imports `prices` 7 times (`market-price.store` 4, `price-catalog` 2, `price-collection` 1).
- **`deposits` ↔ `portfolio-snapshots`.** `deposits` imports `capital-flows`, `real-profit` and `snapshot-series`; `portfolio-snapshots` imports `deposits/deposit-valuation`.
- **`prices` ↔ `sync-status`.** `prices.service` imports `sync-status/sync-source`; `sync-status.service` imports `STALE_AFTER_MS` from `prices/price-collection`.
- **`auth` ↔ `shared`.** `shared/filters/global-exception.filter.ts:11` imports `auth/request-limits.service`; `auth` imports `shared/decorators`.

`config → auth` (`parseTrustedProxyIps`) and `health → auth` (`@Public()`) are one-way. The boundary gate in the plan should take its baseline from the code, not from this list.

What this means: the modules are folders that share one database transaction, not independent components. Ledger writes and the FIFO checks they trigger run inside one PostgreSQL transaction under one per-owner advisory lock (`lockAccountingOwner`, `backend/src/accounting/accounting-lock.ts`, taken by 16 services), and valuation reads the ledger, prices and rates from the same database. Splitting along today's folders would turn in-process calls inside a money transaction into network calls, which is the strongest argument against microservices here.

### 2. Frontend coupling

- `features/portfolio/format` (26 imports from other features) and `features/portfolio/currency` (12) are the app-wide money formatting. AGENTS.md already names `format.ts` as the formatter, but it lives inside one feature.
- `features/shell` holds shared building blocks used across features: `Skeleton` (17), `icons` (16 relative imports, more through the `@features/shell/icons` alias, including 4 files in `frontend/src/ui`, so the shared UI layer already depends on a feature), `PageHeader` (13), `useCachedRead` (11), `AssetIcon` (10), `InfiniteScroll` (9), `inflation-basis` (8), `useAccountClasses` (6).
- `AddTransactionDialog` and `add-transaction` in `features/portfolio` are used by four other features.
- The read cache is already scoped by owner: IndexedDB rows carry the owner id, are dropped when another owner appears and are cleared on sign-out (`frontend/src/api/read-cache.ts:93-148`). That is ready for more than one person using the same browser.

### 3. Background work

| Job | Interval | Lock | Owners |
|---|---|---|---|
| Market prices (`prices.service.ts:68`) | 5 min tick, hourly collection | advisory `7_340_600_001` | global data |
| CBR rates (`fx-rates.service.ts:141`) | 5 min | advisory `…002` | global data |
| Inflation (`inflation.service.ts:115`) | 30 min | advisory `…021` | global data |
| Broker prices (`broker-price-sync.service.ts:76`) | 5 min | advisory `…031` | loops over every connection |
| Wallet sync (`wallet-sync.service.ts:54`) | 1 min tick, each wallet when due | advisory `…011` | due wallets of every owner, 20 per tick; each wallet sync stops after 25 s or an adapter-specific request cap |
| Snapshots (`portfolio-snapshots.service.ts:550`) | 5 min | per-owner session lock | loops over every owner; one owner's failure does not stop the others |
| Snapshot refresh after a change (`refreshSoon`, `portfolio-snapshots.service.ts:565`) | 2 s debounce, in-process `setTimeout` | per owner | the owner who wrote |

All six jobs run in the HTTP process. Their locks are PostgreSQL advisory locks, so a second process could run them without double work. Three things are process-local:

- `refreshSoon` is a timer in the process that served the write. It is gated by `PRICE_COLLECTION_ENABLED`, the same switch as the scheduled jobs (`portfolio-snapshots.service.ts:545-566`). If the scheduled jobs moved to a worker by turning that switch off in the HTTP process, the after-change refresh would silently stop too, and the next Dashboard read would rebuild while the page waits.
- Provider pacing: each client keeps its `lastRequestAt` in memory (for example `etherscan-client.ts:282`, `trongrid-client.ts:351`, `bybit-client.ts:445`). With a worker running scheduled syncs while the HTTP process serves "Sync now", the two processes would pace independently against the same free-tier keys.
- The inbound throttler stores its counters in memory (ADR-001 pattern 3; `auth/application-throttler.module.ts`). That matters only for a second HTTP replica, which nobody needs.

Several routes call a provider inside the request: `POST wallet-addresses/:id/sync`, and the T-Bank routes that connect, check, list positions or operations, preview and import (`broker-connections.service.ts:136,184,188,196,242,265`).

Nothing has measured whether a job slows the owner's clicks. Node runs JavaScript on one thread, so a long FIFO rebuild or chain classification during a tick delays every request until it yields. The metrics to watch already exist: `collectDefaultMetrics` (`backend/src/observability/metrics.ts:10`) exports `nodejs_eventloop_lag_p99_seconds`, which the Grafana dashboard already plots (`deploy/observability/grafana/capital-tracker-dashboard.json:1116`), next to job duration panels built on `ct_job_duration_seconds`. Nothing records whether a job is running at a given moment, so request latency cannot yet be split into "during a job" and "outside a job".

### 4. Deployment cost of every extra deployable

Each new runtime component adds an image or a Compose service with its own healthcheck, an entry in the release scripts and pins, a dispatcher reinstall on the server (`scripts/manual-mvp-dispatcher-install.sh update`, run by the owner as root), acceptance shards in `ci.yml` and the nightly suite, and its own logs and alerts. This is the operational price of a split, on a host the owner runs alone. A worker that reuses the backend image pays it once, and only for Compose, release and pins; a set of microservices pays it per service.

### 5. Readiness for more than one owner

**Already in place**

- Owner data is keyed by owner. Of the 76 application tables the migrations leave (ADR-001's "95" counted tables that were later dropped), 64 carry `"ownerId"`, and `backend/src/owner-export/backup-tables.ts` lists 58 owner tables, "each keyed by ownerId". Many of them use a uuid `id` primary key, and the wallet tables start theirs with `"addressId"`; what they share is the `"ownerId"` column every query filters by.
- Shared market data is global on purpose: `price_observations`, `fx_rates`, `inflation_months`, `chain_tokens` and the price and rate rows of `sync_sources`. More owners do not multiply it.
- Identity comes from the session on every request: 120 handler parameters use `@CurrentUser()` (`backend/src/shared/decorators/current-user.decorator.ts`), and services take the owner id explicitly.
- Write serialization is per owner (`lockAccountingOwner`), so owners do not block each other.
- Background jobs already loop over all owners and isolate failures.
- At least 22 of the 54 PostgreSQL probes (a keyword count that misses some) already include a second owner and check, at the service layer, that it cannot see or change the first owner's rows.
- Provider credentials are per owner and encrypted (`bybit_accounts`, `broker_connections`; `tbank-token-box.ts`, `bybit-key-box.ts`).
- Per-owner settings exist (`owner_settings`: main currency, dust threshold; `inflation_personal_rates`, `inflation_manual_months`).
- The export is per owner.

**Blockers**

| # | Blocker | Evidence | Additive path |
|---|---|---|---|
| B1 | Credentials and MFA are singletons. | `owner_auth` and `owner_mfa` have `PRIMARY KEY … CHECK (id = 1)` (`1789990000000-AddOwnerBinding.ts:8`, `1790010000000-AddOwnerMfa.ts:7`). Code reads them by `id = 1`: `session.service.ts` (joins at 102 and 286; queries at 142, 235, 304), `mfa.service.ts` (17 queries, mostly on `owner_mfa`), `password-reset.service.ts` (42, 98, 108) and `owner-cli.ts` (27, 60-64). | New per-user tables (for example `user_credentials` keyed by `userId` with `credentialVersion`, and `user_mfa` with the `owner_mfa` columns), filled from the singleton rows in the same migration. Code moves to the new tables in the same PR. The singleton tables stay as they are until the owner approves dropping them. Needs a security review and an update of `docs/owner-authentication.md`. |
| B2 | Owner provisioning allows one owner. | `owner bootstrap` refuses when an `owner_auth` row exists (`owner-cli.ts:27-33`), and the singleton check enforces it. The brief, PR-AUTH-1 and BRD §18. | Only after the owner decides: an `owner:add` CLI command. Owners stay CLI-created; no signup route. |
| B3 | Free provider quotas are shared. | Etherscan, Blockscout, TronGrid, CoinGecko and Zcash Blockbook keys are global environment values (`backend/src/config/env.validation.ts`); due wallets of all owners share one queue ordered by `nextRunAt` (`wallet-sync.service.ts:83-88`), 20 per tick. | Fine for a household. For more owners: round-robin due wallets across owners so one owner's many wallets cannot starve another, and accept slower sync. Paid tiers are excluded by the project rules. Each provider's free-tier terms would need checking before inviting other people; that was not checked here. |
| B4 | Isolation depends on every query. | About 600 `.query(` calls in `backend/src` (specs and migrations excluded), each responsible for its own `"ownerId" = $n`. No row-level security. | Now: a probe that signs in as a second owner and calls every owner-scoped route with the first owner's ids, expecting 404. The routes can come from the controller scan `auth/route-inventory.spec.ts` already does, or from Nest's router at runtime. Later, only with public sign-up: PostgreSQL row-level security as a second line. |
| B5 | No way to remove an owner. | Export exists; deletion of an owner and all their rows does not. | A CLI command that exports, then deletes every table keyed by the owner, including the `notBackedUp` ones (stored credentials, sessions, snapshots, sync runs, `wallet:` rows of `sync_sources`) and the user row. It is destructive by design and needs the owner's approval when it is built. |
| B6 | Someone else's financial data on the owner's server. | Not a code issue. | The owner decides whether he wants that responsibility (personal-data law, backups, support). |

Nothing in this list needs a destructive migration.

## Options considered

### Option A: modular monolith with a worker on a trigger (recommended)

| Dimension | Assessment |
|---|---|
| Complexity | Low. Each step is a small PR in existing files. |
| Cost | None. The worker, if ever started, reuses the backend image. |
| Scalability | One host serves one owner, or a household, with room to spare; the worker removes the only plausible contention. |
| Operations | One more Compose service at most. |

### Option B: microservices (for example auth, ledger, prices, wallet sync, brokers)

| Dimension | Assessment |
|---|---|
| Complexity | High. FIFO, valuation and snapshots read the ledger, prices and rates in one transaction; a split needs either a shared database (a distributed monolith) or copies of data kept in sync by events. |
| Cost | Several images, healthchecks, release pins, acceptance shards and dispatcher updates; a message broker or HTTP between services. |
| Correctness | New failure modes for money figures: partial writes across services, stale copies of prices or rates. Idempotent single commands (one action, one backend command) become sagas. |
| Benefit | Independent deployment and scaling. One owner and a coordinated set of agent threads need neither. |

It also goes against the brief's "implement incrementally… do not generate the entire application in one unreviewable change" (`capital-tracker-openspec-prompt.md:344`) and AGENTS.md's "One change per PR".

### Option C: build multi-user now

Rejected until the owner decides. It changes the brief and an owner decision (PR-AUTH-1), which AGENTS.md puts under "Ask the owner first", and a security boundary, and nothing needs it yet. The cheap parts that help either way (the isolation probe for B4, the boundary gate) are in Phase 1.

## When to revisit

Start the worker (Phase 3) when any of these holds for a week:

- `nodejs_eventloop_lag_p99_seconds` above 0.2 s while a job runs;
- read-route p95 in `ct_http_request_duration_seconds` during job runs at least twice its p95 outside them (needs a job-in-progress gauge, step 8);
- a job's `ct_job_duration_seconds` close to its interval;
- the owner decides to add owners (B2), since jobs then grow with the number of owners.

Consider a separate service only if a part needs a different runtime (for example a Python model), a separate owner or release cadence, or scaling the worker cannot give. None applies today.

## Plan

Each step is one small PR. Refactors keep the existing tests unchanged as the baseline.

**Phase 1: boundaries (now; no behaviour change)**

1. Module-boundary gate: `backend/src/engineering/module-boundaries.spec.ts` records today's module graph, generated from the code with its current cycles as the baseline, and fails on any new edge or cycle. A matching check for `frontend/src/features`. S.
2. Move `accounting/money.ts` and the generic parsers in `accounting/input.ts` (`parseUuid`, `parseDecimal`) to `backend/src/shared/`, and update the path AGENTS.md names for `money.ts`. Removes four edges into `accounting` (from `fx-rates`, `inflation`, `sync-status`, `owner-settings`) and breaks three cycles. S.
3. Move the asset and network catalogue (`wallet-addresses/chain-assets`, `evm-chains`, `chain-tokens`) into its own module that `prices`, `accounting` and `wallet-addresses` depend on. Removes `prices → wallet-addresses` and 10 of the 24 `accounting → wallet-addresses` imports; that cycle remains. M.
4. Frontend: move `features/portfolio/format` and `currency` to `frontend/src/shared/`, and the shared shell parts (`Skeleton`, `icons`, `PageHeader`, `AssetIcon`, `InfiniteScroll`, `useCachedRead`) to `frontend/src/ui/` or `shared/`. Update the path AGENTS.md names for `format.ts`. S each.
5. Isolation probe (B4): a containerized probe that calls every owner-scoped route as a second owner with the first owner's ids. Useful today as a guard against a missed `"ownerId"` filter. Register it in `scripts/acceptance-shards.cjs` and its test. M.
6. Remaining cycles (`accounting` with `wallet-addresses`, `deposits`, `portfolio-snapshots`, `brokers`; `deposits` with `portfolio-snapshots`; `prices` with `wallet-addresses` and `sync-status`; `auth` with `shared`): fix one when a feature PR touches it, by moving the shared function to the lower module. No dedicated refactor.

**Phase 2: worker readiness (now; small)**

7. Give `refreshSoon` its own condition, separate from the scheduled-job switch, so jobs can stop in the HTTP process without losing the after-change refresh. S.
8. Alert rules on event-loop lag and job duration (the panels already exist), and a `ct_job_in_progress` gauge if the latency-during-jobs trigger stays. Touches `deploy/observability/`, a coordinator-owned path. S.

**Phase 3: worker (only on a trigger)**

9. `backend/src/worker.ts`: `NestFactory.createApplicationContext` with `ScheduleModule` and the six job modules, no HTTP listener, metrics on its own loopback port. The HTTP process stops registering the schedule. Decide how the two processes share provider pacing (for example, route "Sync now" through the worker, step 11). S–M.
10. A Compose `worker` service from the same image, plus release scripts and pins. Needs the owner's server step (`manual-mvp-dispatcher-install.sh update`), stated in the PR. M.
11. If manual "Sync now" or broker import becomes slow, or pacing must be shared: a PostgreSQL table of requested runs that the worker takes with `FOR UPDATE SKIP LOCKED`. No Redis or broker. It is a migration (one open migration PR at a time; the table goes in `notBackedUp`, and the migration counts in `tests/e2e` go up). M.

**Phase 4: more than one owner**

12. Now, whatever the owner decides: a rule in AGENTS.md that every owner table has `"ownerId" NOT NULL` and every query filters by it, and that a new global table is listed in `notBackedUp` with its reason. Docs, S.

The remaining steps wait for the owner's decision.

13. Per-user credentials and MFA (B1). A migration with new tables (`backupTables` or `notBackedUp`, migration counts). M–L, with security review.
14. `owner:add` CLI command (B2) and the matching change to PR-AUTH-1. S–M.
15. Fair wallet-sync scheduling across owners (B3). S–M.
16. Owner removal command (B5). M, owner approval.
17. Row-level security, only if public sign-up is ever wanted. L.

## What not to do

- No microservices, no database per service, no schema or database per tenant: the shared schema keyed by `"ownerId"` already works, and the export is per owner.
- No Redis, BullMQ, Kafka or another broker for jobs: advisory locks and a PostgreSQL table cover the need.
- No Kubernetes, service mesh, API gateway or separate identity service.
- No wholesale rewrite of `accounting` to clean up its boundaries; move code only where a cycle comes from misplaced shared code, or when a feature already touches the area.
- No multi-user code before the owner's decision, and no public sign-up without a separate decision.
- No monorepo tooling (Nx, Turborepo) just for boundaries: a Jest spec is enough.

## Decisions for the owner

1. Accept this record: modular monolith, worker only on a trigger, no microservices.
2. Who the other users would be, if any: nobody for now (recommended), a few people added by CLI, or public sign-up.
3. If there will be other users: are their portfolios fully separate (recommended), or shared within a household? Sharing is a different and larger model.
4. The worker trigger thresholds above, or other ones.
5. When to run Phase 1: the boundary gate (step 1) now, so the graph stops getting worse, and the moves when lanes are free (recommended), or after the current feature wave.

## Verification record

Read-only audit of `main` at `bdabff7`. Commands run: line counts per module with `find` and `wc`; module-to-module import counts with `grep` over `from '../<module>/` (specs excluded); table classification by parsing `CREATE TABLE` blocks in `backend/src/migrations` (a heuristic; `backup-tables.ts` is the authoritative list); `grep` for `@Interval`, advisory-lock keys, `owner_auth`, `@CurrentUser()`, `.query(`, and second-owner cases in `tests/e2e`. An independent reviewer then fact-checked every concrete claim against the code; its corrections (module and controller counts, the full cycle list, primary keys, the step 2 and 3 effects, pacing, provider calls in requests, metric names, B1, B2 and B5 evidence, scope citations) are applied above. Not run: the application, any test, `EXPLAIN`, Prometheus queries or a load test. No event-loop lag or job-duration figures were read from production, so whether jobs slow requests today is unknown. Provider free-tier terms were not checked.
