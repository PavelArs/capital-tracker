## 1. Predecessor and independent acceptance RED

- [x] 1.1 Finish verified archive of record-manual-opening-positions; reconcile this delta against canonical OPEN-003/MIG-002 without losing retained scenarios.
- [x] 1.2 Independently review the frozen API/persistence/arithmetic contract and map TRADE-001..006, OPEN-003-C and TRADE-MIG-001 to owned tests before implementation.
- [x] 1.3 Against the exact verified predecessor release image, authenticate with real password/MFA, prove /auth/me 200, create an eligible account and observe intended initialization 201 versus actual 404; do not import future services/query future tables as prerequisites.
- [x] 1.4 Observe separate real UI RED for the Russian journal action/form; record terminal commands, logs, image IDs and owned cleanup. Only then implement behavior. Retain all preceding passing assertions.

## 2. Exact inputs, arithmetic and additive persistence

- [x] 2.1 Write independent pure boundary/allocation tests for TRADE-002/003 before helpers: mandatory 250/100, fees 245/101, negative net/loss, >2^53, scale 30, 48/30 extrema, gross-plus-fee overflow, [0,0,1,0,1,0,1], conservation, split cumulative allocations and wide sums; never calculate expected values with the production helper.
- [x] 2.2 Implement strict raw parsers, signed atom formatting and bounded pure FIFO using BigInt and documented cumulative allocation; no dependency or generic framework.
- [x] 2.3 Coordinator adds the three tables/typed mappings and migration 14 per persistence.md, including composite RESTRICT identity FKs, deferred head FK, finite numeric/time checks and exact bounds; no previous row/schema rewrite or backfill.
- [x] 2.4 Extend isolated migration acceptance for fresh fourteen/replay and populated thirteen-to-fourteen preservation, keeping every prior populated upgrade and unsafe-history refusal oracle.

## 3. Atomic service and coherent protected API

- [x] 3.1 Implement explicit eligible journal initialization and common account-lock opening guard; test NULL pointer with retained history and real two-process opening/init race.
- [x] 3.2 Implement complete create/correct/terminal-void commands, shared trade key namespace, replay-before-CAS, caps, full-history validation and atomic version/head/journal commit.
- [x] 3.3 Implement repeatable-read current projections, bounded revision-pinned pages and immutable version pages, with owner-scoped labels and exact response contracts.
- [ ] 3.4 Wire private controllers into existing accounting/session/CSRF/quota boundaries and retain Russian-safe existing generic error handling without logging private inputs.
- [x] 3.5 Independently exercise actual production service with isolated PostgreSQL: duplicate/CAS/two-process competing-sale races, historical prefix refusal, all correction fields, chronology collisions, exact caps and old replay receipts.
- [ ] 3.6 Prove coherent concurrent reads and deferred-COMMIT rollback after version/head/state writes using a disposable fixture and independent stage probe; verify failed-key reuse and secret-free generic HTTP failure. No product fault endpoint.

## 4. Russian journal UI and real release acceptance

- [ ] 4.1 Add bounded journal API/components to protected account detail: explicit eligibility/coverage, separate opening versus journal revision labels, unchecked attestation, exact gross/fee/time/order form and paginated owned instrument picker.
- [ ] 4.2 Add explicit full correction/void and current summary/lots/sales/matches/version views with honest Russian precision/completeness labels; no cash/return/tax claims.
- [ ] 4.3 Preserve request keys across ambiguity, handle receipts by reading current state, preserve stale drafts with explicit reload/review, disable in-flight edits and guard route/request races and revision-drift pagination.
- [ ] 4.4 Run maintained actual HTTPS/Chromium journey for mandatory FIFO, fee/provenance checks, restart persistence, correction and original version; cover security/raw types/literal labels/replay/races/rollback and zero provider requests without mocking auth/backend/database.
- [ ] 4.5 Retain all predecessor security, financial, quota, migration, configuration and artifact oracles; do not clear admission state mid-case or weaken generic route quotas for expanded tests.

## 5. Independent review, verification and archive

- [ ] 5.1 Independent contexts review arithmetic/conservation, schema/transactions/read isolation and frontend receipt/draft/concurrency behavior; resolve concrete findings with regression evidence.
- [ ] 5.2 Run actual frozen install, production high/critical audit, backend/frontend lint/build/source tests, strict OpenSpec validation and complete isolated release-image acceptance; record actual counts/statuses/images, limitations and synthetic cleanup without production requests.
- [ ] 5.3 Document bounded USD journal behavior, eligibility/caps/allocation and remaining full-goal work, map all scenarios to real evidence, then archive only after verification passes. No production-readiness or full-accounting-completion claim.
