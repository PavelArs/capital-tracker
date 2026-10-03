## 1. Contract and acceptance

- [ ] 1.1 Write proposal, design and ADDR-1..4 scenarios; strictly validate.
- [ ] 1.2 Write acceptance tests before behavior: Jest input/adapter/sync tests against a local HTTP fixture server, the real PostgreSQL probe `tests/e2e/wallet-addresses-db.cjs`, Esplora fixtures in `tests/e2e/providers.cjs`, Playwright `tests/e2e/wallet-addresses.spec.ts` (ADDR-UI, ADDR-PRIVATE) and frontend page tests.
- [ ] 1.3 Run them against a stub module (routes and migration present, behavior empty) and record the expected assertion failures.

## 2. Implementation

- [ ] 2.1 Additive migration 23 and entity-free SQL service (ADDR-MIGRATION, ADDR-DB).
- [ ] 2.2 Address validation and registration (ADDR-ADD).
- [ ] 2.3 Esplora client, walk-state sync, amounts and failure outcomes (ADDR-SYNC-*, ADDR-AMOUNTS).
- [ ] 2.4 Private reads and Russian page with missing USD values (ADDR-PRIVATE, ADDR-UI).

## 3. Review and verification

- [ ] 3.1 Independent review of schema, sync state machine and UI; fix findings without weakening assertions.
- [ ] 3.2 Run scoped checks locally (lint, build, unit tests, real PostgreSQL probes, migration probe) and record results in `verification.md`.
- [ ] 3.3 Hosted CI: critical acceptance including ADDR-UI green on the PR head; record run id.

## 4. Archive

- [ ] 4.1 After 3.3 passes, strictly validate and archive with the OpenSpec CLI.
