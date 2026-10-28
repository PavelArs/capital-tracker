# ADR-001: Architecture audit against the twelve system-design patterns

**Status:** Proposed
**Date:** 2026-10-28
**Deciders:** owner
**Source commit:** `c1bfad55` (main after PR #366)

## Context

Capital Tracker is a single-owner application: one person, one browser, one host.
Production runs from `docker-compose.yml` on that host: PostgreSQL 16, Redis 7, one
NestJS backend container, one nginx container serving the Vite build, and the owner's
host nginx in front (`deploy/nginx.conf`). Every background job is an in-process
`@Interval` timer inside the backend container. External data comes from free provider
tiers only (Kraken, CoinGecko, CBR, Etherscan, Blockscout, TronGrid, Blockbook, Solana
RPC, Esplora, Horizon, Bybit, T-Bank, Yandex SMTP).

This record evaluates the current system against the common "System design in 12
lines" checklist (slow reads → cache, write spikes → queue, and so on). The question for
each line is not "is the pattern applied" but "does this system need it, and if it does,
is the implementation sound". Four read-only review passes covered caching and
database access, writes and idempotency, provider resilience and rate limits, and
traffic, static files and observability. The claims below were spot-checked in the
code; nothing was measured against a running stack.

## Decision

Keep the single-host, single-process architecture. Do not add a queue, a load balancer,
read replicas, sharding, a CDN or distributed tracing: none has a demonstrated need for
one owner, and each would add a moving part the owner must operate. Fix the handful of
places where a pattern the system already relies on is incomplete or misleading (listed
under "Findings" and "Action items"), and remove Redis, which the backend depends on but
never uses.

## The twelve lines, scored

Status: **Present**, **Partial**, **Absent** or **Not needed**. Evidence is `file:line`
at the source commit.

| # | Pattern | Status | Where it lives | Verdict for this system |
|---|---|---|---|---|
| 1 | Slow reads → cache | Partial | Frontend stale-while-revalidate cache in `frontend/src/api/read-cache.ts:9` (memory + IndexedDB, 15 min), invalidated on any write (`frontend/src/api/client.ts:116,140,177`). Materialised `portfolio_snapshots` rebuilt every 5 min and 2 s after an edit (`backend/src/portfolio-snapshots/portfolio-snapshots.service.ts:449,150`). API responses are `Cache-Control: no-store` (`backend/src/main.ts:35`). Redis is registered (`backend/src/cache/cache.module.ts:17-21`) but no service reads or writes it; its only use is a health ping (`backend/src/cache/exchange-rates-cache.service.ts:5`). | The right caches exist (browser and snapshot table). Redis is a hard boot dependency (`docker-compose.yml:82-85`) with no function. The change detector that guards the snapshot table hashes about thirty owner tables and scans `price_observations` for `max("fetchedAt")` on every history read (`portfolio-snapshots.service.ts:139-143,806-810`); `fetchedAt` has no index. |
| 2 | Write spikes → queue | Not needed | No queue library. Six `@Interval` jobs run in the HTTP process; each takes `pg_try_advisory_xact_lock` and returns `busy` on overlap (`backend/src/prices/prices.service.ts:101-106`, `backend/src/wallet-addresses/wallet-sync.service.ts:76-82`). Snapshot rebuild uses a per-owner session lock (`portfolio-snapshots.service.ts:765-792`). | Writes are one owner's clicks plus hourly syncs. Advisory locks already give the serialisation a queue would. One misleading switch: `BACKGROUND_JOBS_ENABLED=false` in `docker-compose.yml:49` only sets `cronJobs: false` (`backend/src/app.module.ts:52`), and the repository has zero `@Cron` jobs. The real switch is `PRICE_COLLECTION_ENABLED` (`backend/src/config/env.validation.ts:32`). |
| 3 | Too much traffic → load balancer | Not needed | Host nginx → `127.0.0.1:3000` and `:3001` (`deploy/nginx.conf:40-53`); loopback-only ports, one replica per service, healthchecks and `restart: unless-stopped` (`docker-compose.yml`). Proxy trust is explicit: `trust proxy` off (`backend/src/main.ts:28`), `X-Forwarded-For` accepted only from `TRUSTED_PROXY_IPS` (`backend/src/auth/client-source.ts:64-92`). | One human. If a second replica were ever wanted, two things block it: the `@nestjs/throttler` limit is stored in process memory (`backend/src/auth/application-throttler.module.ts:12-19`), and the snapshot debounce timers are per process. Sessions, CSRF and auth limits are already in PostgreSQL, so nothing else does. |
| 4 | Read-heavy DB → read replicas | Not needed | Single connection, default pool of 10, no `replication` block (`backend/src/config/typeorm.config.ts:10-32`). | A replica would add lag to money figures for no load benefit. |
| 5 | Write-heavy DB → shard | Not needed | 95 tables over 75 raw-SQL migrations, append-only journals and version rows with `ownerId` first in every primary key (for example `backend/src/migrations/1790040000000-AddUsdTradeJournal.ts:54`). Largest table is `price_observations` at roughly 116k rows per year. | Nothing to shard. The schema is already tenant-keyed, which is all the headroom a personal app needs. |
| 6 | Slow queries → add indexes | Present, three gaps | Hot paths are covered: sessions by `tokenHash` (PK), request ids by `(ownerId, scope, requestId)`, ledger replay by `(ownerId, accountId)` prefix, latest price by `price_observations_latest (asset, quoteCurrency, observedAt DESC)` (`backend/src/migrations/1790800000000-AddHourlyPrices.ts:21`), wallet history by `(addressId, blockHeight DESC, txid)` (`1790400000000-AddWalletAddressImport.ts:40`). The ledger N+1 was removed in PR #364. | Gaps: (a) `max("fetchedAt")` on `price_observations` and `fx_rates` has no index and runs on every history read; (b) `wallet_address_transactions` has no index on `ownerId` although classification filters on it (`backend/src/accounting/chain-classification.service.ts:610-613`); (c) `fx_rates` lookups by `source, rateDate` skip the PK prefix (`backend/src/fx-rates/fx-rates.service.ts:316`). Only (a) costs anything today; `AddFetchedAtIndexes1798300000000` closes it. |
| 7 | Slow file loads → object storage + CDN | Not needed, one gap | Hashed `/assets/` served `immutable` for a year, `index.html` `no-cache` (`deploy/container-nginx.conf:11-19`). No file uploads: CSV import arrives as JSON text with a per-owner quota (`backend/src/accounting/csv-import.service.ts:222`); exports stream as attachments. | Object storage or a CDN would move private data off the device, which the owner's rules forbid. The gap: neither `deploy/container-nginx.conf` nor `deploy/nginx.conf` enables gzip, so bundles leave the container uncompressed unless the owner's host nginx compresses proxied responses (`frontend/nginx.conf:19-22` does, but it is not what the images use). |
| 8 | Temporary failures → retry with backoff | Partial | No shared HTTP helper; every client inlines `axios` with a timeout, `maxRedirects: 0` and `validateStatus: () => true`. In-call retry exists only for Kraken, CBR and the inflation sources, one attempt after a fixed 5 s (`backend/src/prices/price-providers.ts:196-201`, `backend/src/fx-rates/cbr-client.ts:113-121`). Everything else retries only at the next scheduled slot (15 min for wallets, `backend/src/wallet-addresses/chain-sync.ts:48`; hourly for prices). All calls are reads, so retries are safe. | Acceptable: a missed hour shows as a stale badge, never as zero. Two real gaps: password-reset mail has no retry (`backend/src/auth/password-reset.service.ts:68` only logs a warning), so a transient SMTP refusal burns one of the owner's three hourly links; the reset answer must stay fire-and-forget and identical for every address (`docs/owner-authentication.md:359-360`), so any fix stays asynchronous. And network errors are collapsed to `unavailable` without the error code, so `sync_sources` cannot tell DNS from a 503. |
| 9 | Too many requests → rate limiting | Present inbound, Partial outbound | Inbound: `ThrottlerGuard` 100 req/60 s per client, after `SessionGuard` so anonymous traffic spends no budget (`backend/src/auth/auth.module.ts:36-38`); auth routes use a PostgreSQL ledger under one advisory lock (`backend/src/auth/request-limits.service.ts:5-11,63`); session caps per `docs/owner-authentication.md:323-325`. No `limit_req` in nginx. Outbound: per-client minimum gaps (Kraken 2 s, Etherscan 400 ms, TronGrid 150/400 ms, Blockbook 500 ms, Solana 300 ms, Bybit 150 ms); 429 maps to `rate_limited` everywhere; per-pass caps of 40 requests and 25 s. | Volumes sit far under the free tiers. Two gaps: CoinGecko and T-Bank have no pacing at all (`backend/src/brokers/tbank-client.ts` has no `pauseMs`), and T-Bank makes one call per position back to back (`backend/src/brokers/broker-connections.service.ts:196`), so a single 429 fails the whole hourly run. `Retry-After` is parsed only to word the owner message (`backend/src/wallet-addresses/etherscan-client.ts:418-433`), never waited on. Inbound, an unauthenticated flood of `/auth/*` turns into lock contention in PostgreSQL before anything sheds it; a private host makes that unlikely. |
| 10 | One service failing → circuit breaker | Partial, hand-rolled and stateless | Kraken/CoinGecko alternate by even/odd hour and each fills the other's missing assets (`backend/src/prices/price-collection.ts:30-33,52-80`), per owner decision Q3. `EvmReader` sticks to Blockscout for 6 h after Etherscan answers `plan_required`, in memory only (`backend/src/wallet-addresses/evm-reader.ts:102-109`). Zcash walks `zec1`→`zec5`. User-facing reads never call a provider; prices older than 2 h are flagged on the dashboard (`frontend/src/features/dashboard/DashboardPage.tsx:443-447`). | The system degrades correctly: stored data keeps rendering, staleness is visible. What is missing is memory: a provider that failed is asked again at its next slot regardless. Harmless at these volumes. |
| 11 | Duplicate requests → idempotency keys | Present for financial commands | Each command table carries `requestId` with `UNIQUE(ownerId[, accountId], requestId)` and a canonical payload; same id and payload replays the first receipt, a different payload is a 409 (`backend/src/accounting/trade.service.ts:376`, `backend/src/deposits/deposits.service.ts:148-171`). Deleted deposits and goals move their ids to `retired_commands` (`backend/src/migrations/1797800000000-AddRetiredCommands.ts`). The frontend keeps one `crypto.randomUUID()` per attempt until success and never auto-retries unsafe methods (`frontend/src/features/accounting/feedback.ts:3-12`, `frontend/src/api/client.ts:79-90`). 26 of 73 write handlers have no key; all are PUT/DELETE by id, previews or auth, except `POST deposits/:id/rates`, which appends and would store a double click twice. | Sound. One violation of the project's own rule "one user action is one backend command": the add-asset dialog chains up to three browser writes, account → instrument → trade (`frontend/src/features/portfolio/AddAssetDialog.tsx:190,250,277`). Each step is idempotent on retry, but a failure after step one or two leaves an empty account or instrument with no compensating command. |
| 12 | Can't see what broke → logs, metrics, tracing | Present, tracing absent by choice | Pino JSON logs with a request id, query strings stripped and cookies, CSRF, passwords and API keys redacted (`backend/src/observability/logging.ts:20-59`); shipped to Loki by Alloy (`deploy/observability/alloy-logs.alloy`). Prometheus registry on loopback `:9464` (`backend/src/observability/metrics-server.ts:11-15`) with fourteen `ct_*` metrics and ten alert rules in `deploy/observability/capital-tracker.rules.yml`: backend down, restart loop, dependency down, stale prices and rates, failing or stale wallet sync, job errors, 5xx rate, pool waiting, memory. The exception filter logs twelve stack frames and no body (`backend/src/shared/filters/global-exception.filter.ts:46-53`). No OpenTelemetry. | Tracing is unnecessary for one process and one database; the request id is the trace. Gaps: the Docker and release healthchecks hit `/health`, which does not check the database (`backend/src/health/health.controller.ts:22-26`), so a backend with a dead database stays "healthy" to Compose; `global-exception.filter.ts:161` logs `request.ip`, which is always the proxy socket under `trust proxy` off; the frontend error card never shows the request id, so the owner cannot quote it; nothing records backup age, Redis evictions, per-provider error rates, disk space or TLS expiry. Backups are written only by `scripts/manual-mvp-release.sh:160` at release time; `.github/scripts/database-backup.sh` is a legacy manual script no workflow or timer calls. |

## Findings, ranked

1. **Data between releases has no backup.** The only `pg_dump` runs inside
   `scripts/manual-mvp-release.sh:160,246`; nothing schedules one, and no metric or alert
   knows the age of the last dump. Everything the owner enters between two releases
   lives in one Docker volume. (Line 12.)
2. **Redis is a boot dependency that does nothing.** `docker-compose.yml:82-85` refuses
   to start the backend without it; `backend/src/cache/cache.module.ts` registers it;
   no service uses it. It costs 128 MB, an AOF volume and a listening port. (Line 1.)
3. **`BACKGROUND_JOBS_ENABLED` is a no-op.** `backend/src/app.module.ts:52` toggles
   `cronJobs`, and there are no cron jobs. An operator who sets it to stop background
   traffic stops nothing; `PRICE_COLLECTION_ENABLED` is the real switch. (Line 2.)
4. **The snapshot change detector is the floor under every history read.**
   `portfolio-snapshots.service.ts:139-143,806-810` hashes about thirty owner tables and
   scans `price_observations` for `max("fetchedAt")` without an index before answering.
   The 145–637 ms figures recorded in PR #365 include this cost. (Lines 1 and 6.)
   Addressed by `AddFetchedAtIndexes1798300000000`, which indexes `fetchedAt` on
   `price_observations`, `fx_rates` and `broker_price_observations`, and by counting the
   rows of the fourteen append-only input tables instead of hashing them; tables whose
   rows are updated or deleted in place are still hashed row by row.
5. **Password-reset mail is never retried.** `backend/src/auth/password-reset.service.ts:68`
   logs a warning and stops; one of three hourly links is spent and no alert fires. The
   public answer is deliberately identical whether or not mail went out
   (`docs/owner-authentication.md:359-360`), so this is an operational gap, not a UI one.
   (Line 8.)
6. **Add-asset is a three-write browser chain.** `AddAssetDialog.tsx:190,250,277`
   breaks the one-action-one-command rule and can leave orphan rows. (Line 11.)
7. **T-Bank calls have no pacing.** One request per position with no gap
   (`broker-connections.service.ts:196`, `broker-price-sync.service.ts:276-283`); a 429
   fails the hour. (Line 9.)
8. **Static assets leave the container uncompressed.** No `gzip` in
   `deploy/container-nginx.conf` or `deploy/nginx.conf`. (Line 7.)
9. **Liveness ignores the database.** Compose and the release probe use `/health`,
   which does not touch PostgreSQL. (Line 12.)
10. **Error logs carry the wrong IP and the UI hides the request id.**
    `global-exception.filter.ts:161` and `frontend/src/components/ErrorBoundary.tsx:25-27`.
    (Line 12.)

Low-priority notes: no `ownerId` index on `wallet_address_transactions`; two lock orders
in the wallet domain (owner lock then row in classification, row only in sync adapters,
`chain-classification.service.ts:372,1493` versus `evm-sync.adapter.ts:227-245`), not a
deadlock today; `POST deposits/:id/rates` without a request id; network errors collapsed
to `unavailable` without the error code.

## Options considered

### Option A: keep the single-host design and close the gaps above (recommended)

| Dimension | Assessment |
|---|---|
| Complexity | Low: each fix is a small PR in files the owner already maintains |
| Cost | None; removing Redis reduces memory and attack surface |
| Scalability | Unchanged, and already far beyond one owner's load |
| Team familiarity | High |

**Pros:** no new infrastructure; every fix addresses an observed defect.
**Cons:** does not prepare for multiple users, which the auth invariants forbid anyway.

### Option B: adopt the checklist literally (queue, Redis cache layer, nginx rate limits, second replica, tracing)

| Dimension | Assessment |
|---|---|
| Complexity | High: BullMQ or similar, shared throttler storage, cache invalidation for money figures, OpenTelemetry collector |
| Cost | More containers on the same host; more things to patch and back up |
| Scalability | Headroom nobody will use |
| Team familiarity | Medium |

**Pros:** matches the textbook.
**Cons:** adds failure modes to a system whose whole risk is one owner losing data or
seeing a wrong figure; a cache in front of exact money values is a correctness hazard
the current snapshot table already avoids by hashing its inputs.

## Trade-off analysis

The checklist assumes load. This system's risks are different: losing the owner's data,
showing a figure better than the truth, and not noticing when a free provider stops
answering. The current design already handles the second and third with stored data,
staleness flags, advisory locks and idempotency keys. The first is the open gap, and no
line of the checklist covers it. Option A spends effort there and on removing a
component that exists only because the checklist says "add a cache".

## Consequences

- Easier: operating one fewer container; trusting the production environment switches;
  recovering from a mistake made between releases.
- Harder: nothing, provided Redis removal goes through the coordinator-owned files
  (`docker-compose.yml`, `env.production.example`, `deploy/`) in one reviewed change and
  the release dispatcher is updated as `docs/manual-mvp-release.md` requires.
- Revisit: if the owner ever adds a second household member, the in-memory throttler
  and the per-process timers are the first two things to move; if provider volumes grow,
  the stateless alternation in `price-collection.ts` should remember failures.

## Action items

1. [ ] Schedule an encrypted `pg_dump` between releases (host timer, same openssl recipe as `scripts/manual-mvp-release.sh`), prune old dumps, and export a backup-age metric with an alert rule. Owner approval: touches the production host.
2. [ ] Remove Redis: `backend/src/cache/`, the health indicator, `REDIS_*` validation in `backend/src/config/env.validation.ts:144-152`, the `redis` service and `depends_on` in `docker-compose.yml`, `tests/e2e/compose.yml` and the infrastructure pins. Owner approval: changes Compose and pins, so the dispatcher must be reinstalled before the release.
3. [ ] Make `BACKGROUND_JOBS_ENABLED` either gate the six interval jobs or disappear; update `backend/src/config/scheduling.spec.ts` to pin behaviour, not the option value, and fix the comment in `docker-compose.yml:49`.
4. [ ] Add an index on `price_observations ("fetchedAt")` (and `fx_rates`), or record the latest fetch time on the write path so `rebuild()` stops scanning.
5. [ ] Retry `sendPasswordReset` once after a short pause, still detached from the request so the public reset answer keeps identical content and timing for every address (PR-AUTH-3, `docs/owner-authentication.md:359-360`). Report a final failure only through protected diagnostics: a `ct_job_runs_total` outcome or a `ct_*` counter with an alert rule, never through the reset page or endpoint.
6. [ ] Replace the add-asset chain with one backend command that creates account, instrument and opening trade in a single transaction, or make the dialog stop at the account when a later step fails and say so.
7. [ ] Give `TBankClient` the same `lastRequestAt + pauseMs` gap the other clients use; also CoinGecko.
8. [ ] Add `gzip on; gzip_types application/javascript text/css image/svg+xml;` to `deploy/container-nginx.conf`.
9. [ ] Point the Compose healthcheck and release probe at a public readiness route that checks PostgreSQL, or add one.
10. [ ] Log the resolved client address in `GlobalExceptionFilter` and show `X-Request-Id` on the frontend error card.

## Verification record

Four read-only review passes over the source at `c1bfad55`, each with `file:line`
evidence, followed by a spot-check of every ranked finding against the code. Not run:
the application, any test, `EXPLAIN` against a live database, Prometheus, or a load
test. Timings quoted come from the commit messages of PRs #363 to #365, not from
measurements taken here. Whether the owner's live host nginx compresses proxied
responses was not checked; only the template in the repository was read.
