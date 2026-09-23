## 1. Contract and acceptance

- [x] 1.1 Independently review proposal/design/scenarios and strict-validate the change; record baseline, preservation and keep/reuse decisions.
- [x] 1.2 Write `historical-valuation.spec.ts` pure arithmetic/input acceptance, `historical-valuation-db.cjs` actual PostgreSQL coverage/snapshot/preservation checks, and two focused `historical-valuation.spec.ts` HTTPS API/UI cases; demonstrate real missing-route/UI RED before product changes (VAL-EXACT/GAPS/PRIVATE/UI).

## 2. Implementation

- [x] 2.1 Extract caller-owned historical loader while preserving passing historical characterization, implement scale60 valuation and private read endpoint (VAL-EXACT/PRECISION/GAPS/COVERAGE/SNAPSHOT/PRIVATE).
- [ ] 2.2 Implement Russian account-detail valuation with honest coverage, exact values, manual provenance, explicit refresh and stale-response guards (VAL-UI).

## 3. Review and verification

- [ ] 3.1 Independently review backend/SQL/arithmetic and UI diffs; address findings without weakening financial/security assertions.
- [ ] 3.2 Run changed/retained relevant unit checks, real PG valuation and retained historical fixtures, selected new HTTPS cases plus one retained historical browser journey, builds/lints, production dependency gate and strict OpenSpec. Record actual commands/results/images, failed attempts and unrun suites; full E2E not required.
- [ ] 3.3 Update concise user/verification docs and continuity, verify no schema/lock/owner-Nginx changes and isolated cleanup, then archive with installed OpenSpec and verify canonical synchronization.
