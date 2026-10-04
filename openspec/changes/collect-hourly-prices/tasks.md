## 1. Contract and acceptance

- [ ] 1.1 Write proposal, design and PRC-1..6 scenarios; strictly validate.
- [ ] 1.2 Write acceptance tests before behavior: Jest client tests against a local HTTP server (PRC-PARSE), Jest planner tests with fake providers (PRC-FALLBACK, PRC-ALTERNATE, PRC-SOURCES), the real PostgreSQL probe `tests/e2e/prices-db.cjs` through `tests/e2e/providers.cjs` (PRC-HOURLY, PRC-FALLBACK, PRC-IDEMPOTENT, PRC-APPEND-ONLY, PRC-BACKFILL, PRC-BACKFILL-RETRY, PRC-STALE, PRC-SOURCES, PRC-OFF) and migration probe updates (PRC-MIGRATION).
- [ ] 1.3 Run them against stubs (module, routes and migration present, behavior empty) and record the expected assertion failures.

## 2. Implementation

- [ ] 2.1 Additive migration 24 `AddHourlyPrices1790600000000` (PRC-3, PRC-6).
- [ ] 2.2 Catalog, Kraken and CoinGecko clients (PRC-1).
- [ ] 2.3 Planner, service, backfill, schedule and switch (PRC-2, PRC-4).
- [ ] 2.4 Read model `GET /prices` with freshness and sync status (PRC-5).

## 3. Review and verification

- [ ] 3.1 Independent review of schema, clients and collection; fix findings without weakening assertions.
- [ ] 3.2 Run scoped checks locally (lint, build, unit tests, real PostgreSQL probe, migration probe) and record results in `verification.md`.
- [ ] 3.3 Hosted CI green on the PR head; record run id.

## 4. Archive

- [ ] 4.1 After 3.3 passes, strictly validate and archive with the OpenSpec CLI.
