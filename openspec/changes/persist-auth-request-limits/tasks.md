## 1. Independent acceptance before behavior changes

- [x] 1.1 Independently review LIMIT-001..006 and complete deltas for exact charging, read-only sessions, timeout/commit/capacity semantics and preserved existing assertions.
- [x] 1.2 Add deterministic real two-replica HTTPS fixtures and independent LIMIT-001-A/B acceptance, then record expected429/actual401 RED on the preceding image without future-table prerequisites.
- [ ] 1.3 Write source-boundary and real PostgreSQL acceptance for LIMIT-002..006, including zero verifier calls, exact ledger deltas, held-lock time, capacity race, pool timeout and populated11-to12 preservation.

## 2. Bounded persistent admission

- [ ] 2.1 Add only migration12 ledger schema, constraints and expiry index; preserve all historical migrations and existing owner data (LIMIT-006-A).
- [ ] 2.2 Implement stable hashed policies and committed fixed-window admissions under bounded PostgreSQL locks/capacity using fresh database time (LIMIT-001/003/004).
- [ ] 2.3 Bound runtime pool acquisition and implement safe429/Retry-After/503 handling with no retry/fallback/late admission (LIMIT-005).
- [ ] 2.4 Integrate source admission in SessionGuard, read-only login/MFA authorization, DTO-then-account admission before credential verification, and skip old throttling only on the three handlers (LIMIT-002).
- [ ] 2.5 Adapt isolated tests with explicit between-case ledger reset and precise ledger deltas; preserve all63 previous cases and MFA5/restart/5 using genuine A/B/third-source traffic (LIMIT-006-B).
- [ ] 2.6 Document configuration, fixed-window charging, finite-capacity availability limitations, migration/rollback and distinction from existing MFA cooldown/general-route quotas.

## 3. Independent review and actual verification

- [ ] 3.1 Independently review code, migration, fixtures and oracles; fix demonstrated findings with meaningful regressions.
- [ ] 3.2 Pass frozen install, production audit, lint/build/unit and strict OpenSpec checks on the supported runtime.
- [ ] 3.3 Pass real PostgreSQL migration/concurrency/capacity/expiry/pool/CLI checks and full HTTPS Playwright on the exact two release-image replicas, without retries or weaker retained assertions.
- [ ] 3.4 Record actual RED/GREEN, image identities, no-owner-data/configuration change and cleanup evidence; sync/archive and checkpoint only after required verification passes.
